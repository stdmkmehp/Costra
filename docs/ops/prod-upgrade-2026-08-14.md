# Costra · 2026-08-14 prod 更新操作流程（日志轮转 + 内核调优 → 主从复制）

> **状态**：待执行
> **日期**：2026-08-14
> **适用机器**：机器① prod（49.235.216.20 · `/root/Costra`）、机器② staging/从库/分析机（172.17.16.4）
> **关联基线**：[`host-kernel-tuning.md`](host-kernel-tuning.md)（内核调优）、[`pg-standby-backup.md`](pg-standby-backup.md)（主从复制）、[`../design/logging-strategy-spec.md`](../design/logging-strategy-spec.md) §5（日志轮转）

本次更新内容跨四个域：**服务器日志统一落盘 + 宿主机 logrotate**、**宿主机内核参数（sysctl + THP + bbr）**、**PG 主从复制**、**分析栈按需启停 + 资源封顶**。按停机影响拆成两个阶段：

- **阶段一**：配置调整 + 一次停服重启，让日志策略、内核调优、新 cron 表全部生效，**并顺带绑定 PG 内网复制端口**；
- **阶段二**：主从复制部署（**全程在线、零重启**——端口与 WAL 护栏在阶段一已落地，阶段二只剩在线 SQL 与 `pg_reload_conf`）。

无 DB schema 变更（无 migration）、无小程序变更。

---

## §0 变更清单与生效条件（review 结论）

| 组 | 文件 | 变更要点 | 生效动作 | 停机 |
|---|---|---|---|---|
| 日志 | `server/src/logger.ts` + `config/env.ts` + `package.json` | pino-roll → `pino/file` 单目标写固定文件 `server.log`，不再双写 stdout；`COSTRA_LOG_FILE` 默认值改为 `…/server.log` | **重建 server 镜像 + recreate** | 是 |
| 日志+复制 | `infra/docker-compose.prod.yml` postgres | `logging_collector=on` + 固定 `postgresql.log` + 关 PG 自身切分；新增 `max_slot_wal_keep_size=10GB`；新增内网端口映射（**阶段一即绑真实 LAN IP**，见硬顺序 4） | **recreate postgres（阶段一）** | 是 |
| 日志 | 同上 redis | 恢复 `--logfile /var/log/redis/redis.log` | **recreate redis** | 是 |
| 日志 | `infra/nginx/conf.d/*.prod/.staging` | access/error 日志从 `/dev/stdout|stderr` 改回文件 | **改 live 配置 + recreate nginx** | 是 |
| 日志 | `infra/logrotate/costra-ops`（新增） | 唯一轮转事实源（daily + maxsize 20M · 14 份 · copytruncate） | `maintenance.sh install-cron` 安装 | 否 |
| 内核 | `infra/host/*` + `apply-host-tuning.sh`（新增） | 5 项 sysctl + THP→never + bbr 模块持久化 + 主网卡 `tc qdisc replace` | 脚本在线执行 | 否 |
| 内核 | compose nginx `sysctls: bbr` | per-netns，已存在容器不继承 | **recreate nginx**（前置：宿主机已 `modprobe tcp_bbr`，否则 nginx 启动失败 = 期望的 fail fast） | 是 |
| 运维 | `maintenance.sh` | 新 cron 表（备份改 27 分 · purge 集中 4 点 · **新增 purge-invites** · 条件化 replication-check）；install-cron 兼装 logrotate + touch 日志文件 | `install-cron` 重装 | 否 |
| 运维 | `02-prepare-dirs.sh` | `/data/logs/postgres` owner 999 → **70**（postgres:15-alpine uid） | **必须先于 postgres recreate 执行** | 否 |
| 运维 | `backup-db.sh` | 原子发布（partial→rename）+ flock + umask 077 + `--container/--backup-dir`（从库用） | 下次备份自动生效 | 否 |
| 运维 | `lib/common.sh` | uid 拆分（alpine 70 / debian 999）+ `replace_pg_hba_managed_block` | 被各脚本引用 | 否 |
| 复制 | `setup-replication-{primary,standby}.sh`、`check-replication.sh`、`recover-primary-from-standby.sh`、`docker-compose.standby.yml`、`standby.env.example`（均新增） | 见 `pg-standby-backup.md` §2.5 | **阶段二** | **无（全在线 · `pg_reload_conf`）** |
| 分析 | `analytics/docker-compose.yml` + `analyze.sh` | `restart: "no"` 按需启停 + limits（PG 512M/node 256M）+ 跑完自动 stop | 机器② `up -d` recreate 一次 | 否（机器②） |
| 文档 | `logging-strategy-spec.md` §5、`maintenance-cron-plan.md`、`prod-bootstrap-compose.md`、`analytics-daily-tech-spec.md` v0.2.4、`pg-replication-setup.md`（删除） | 与代码同步 | — | — |

### 五条硬顺序（违反即失败或告警噪音）

1. **`apply-host-tuning.sh apply`（内含 `modprobe tcp_bbr`）必须先于 nginx recreate**——compose 给 nginx 声明了 `sysctls: bbr`，宿主机未加载模块时容器启动直接失败（设计如此，fail fast）。
2. **`02-prepare-dirs.sh`（chown 70:70 `/data/logs/postgres`）必须先于 postgres recreate**——`logging_collector=on` 后 PG（uid 70）要写该目录，仍是 999 会 permission denied。
3. **nginx live 配置只能手工 sed 两行日志路径**——`05-start-stack.sh` 不覆盖已存在的 live conf；仓库模板是 SSL 注释状态，直接 `cp` 覆盖会丢已启用的 SSL。
4. **复制配置拆分投放：两个内网 IP（`PG_PRIMARY_LAN_IP`/`PG_STANDBY_LAN_IP`）在阶段一窗口前就加进 server.env**（阶段一的 PG recreate 顺带绑定内网端口，阶段二因此零重启）；**唯独 `REPLICATOR_PW` 留到阶段二再加**——`install-cron` 的 replication-check 闸门按"三件套齐全"判定，缺密码时该检查自动跳过（窗口期零告警噪音）；而密码只被脚本运行时直读、不 compose 插值、不进容器环境，后加无需任何重启。安全组 `/32` 放行同样留到阶段二，此前内网端口虽绑定但外部不可达。
5. **阶段一窗口前必须确认 `PG_PRIMARY_LAN_IP` 就在本机网卡上、且 env 无行尾注释**——否则 compose 绑定失败会让 `redeploy.sh` 在停服之后失败，停服时间被无谓拉长。

### Review 附注（非阻塞）

- 各脚本/文档中 `docker logs <container>` 的排障提示仍有效（entrypoint 早期残留仍走 json-file），但运行期日志本体在 `/data/logs/` 文件里，排障先看文件。
- 旧 pino-roll 产物（`server.1.log`、`server.YYYY-MM-DD.log`）不被 `costra-ops` 的 `server.log` 模式覆盖，切换后需手工清理（§2.3）。
- `purge-invites` 是**新增**的每日物理删除任务（过期 +30 天），随新 cron 表上线，符合 `maintenance-cron-plan.md` 设计。
- staging 模板日志同样改为落盘；staging 栈的 live 配置更新与 recreate 不在本次范围，另行排期。

---

## §1 阶段一：配置调整 + 停服更新重启（机器①）

**目标**：日志策略、内核调优、新 cron 表一次生效。**停机窗口**：仅 §2.2 一次，预计 1~3 分钟。

### §2.0 发布前（本地）

```bash
# dev 合入 main 并推送（prod 从 main 拉取）；确认 pre-commit（lint + typecheck）与 CI 全绿
git checkout main && git merge dev && git push origin main
```

### §2.1 窗口前准备（全部在线执行 · 无停机）

按顺序执行，**不要调换**：

```bash
ssh root@49.235.216.20
cd /root/Costra && git pull
cd infra/scripts

# ── 1. 内核调优（在线热生效 · 对应硬顺序 1）──
./apply-host-tuning.sh status            # 体检：首次跑必然有偏差，退出码 1 属预期
./apply-host-tuning.sh apply --dry-run   # 预览：会删哪些冲突 key、改哪些值
./apply-host-tuning.sh apply             # modprobe tcp_bbr + 装 sysctl/THP unit + tc qdisc replace
# 完成后即生效：THP→never、dirty_ratio、fq、bbr 模块（bbr 对 nginx 用户生效待 recreate）

# ── 2. 修 PG 日志目录 owner（对应硬顺序 2）──
./02-prepare-dirs.sh -y                  # /data/logs/postgres 999 → 70:70

# ── 3. server.env：预置两个复制内网 IP（对应硬顺序 4/5 · 不加 REPLICATOR_PW）──
grep -n COSTRA_LOG_FILE /data/conf/server.env
# 预期无输出（03-generate-env 从不写该键，新默认值 /var/log/costra/server.log 自动生效）；
# 若有输出则删除该行（env 注释必须独占一行，严禁行尾内联注释）

cat >> /data/conf/server.env <<'EOF'

# === PG 异步流复制 · 内网端口预绑定（REPLICATOR_PW 留待阶段二追加）===
# 机器①（prod）VPC 内网 IP
PG_PRIMARY_LAN_IP=172.17.0.3
# 机器②（staging 机器）VPC 内网 IP
PG_STANDBY_LAN_IP=172.17.16.4
EOF

# 预检（任一失败必须先修正再进窗口，否则 compose 绑定失败、停服时间被拉长）：
hostname -I | tr ' ' '\n' | grep -qxF '172.17.0.3'   # 主库 IP 必须在本机网卡上
grep -nE '^[A-Z_]+=.*[#[:space:]]' /data/conf/server.env   # 应无输出（无行尾注释/空格）
df -h /data    # 余量 ≥ 15G（max_slot_wal_keep_size=10GB 非严格上限）

# ── 4. 安装 logrotate + 新 cron 表 ──
command -v logrotate >/dev/null || yum install -y logrotate   # 宿主机需已装 logrotate
./maintenance.sh install-cron
# 做三件事：重写 /etc/cron.d/costra-maintenance（备份 27 分/purge 4 点/新增 purge-invites；
# 缺 REPLICATOR_PW → 闸门不通过，replication-check 自动跳过 · 属预期零告警噪音）
# + 安装 /etc/logrotate.d/costra-ops + touch 四个 maintenance-*.log
logrotate -d /etc/logrotate.d/costra-ops   # 语法/匹配预检（-d 不实际轮转）

# ── 5. 更新 nginx live 配置（对应硬顺序 3 · 只改两行）──
cp -p /data/conf/nginx/costra.cloud.conf \
     /data/conf/nginx/costra.cloud.conf.bak.$(date +%Y%m%d-%H%M%S)
sed -i \
  -e 's|access_log /dev/stdout;|access_log /var/log/nginx/access.log;|' \
  -e 's|error_log /dev/stderr warn;|error_log /var/log/nginx/error.log warn;|' \
  /data/conf/nginx/costra.cloud.conf
diff /data/conf/nginx/costra.cloud.conf.bak.* /data/conf/nginx/costra.cloud.conf  # 确认仅两行
docker exec costra-nginx nginx -t          # 借运行中容器校验新配置（bind mount 已生效于文件系统）

# ── 6. 窗口前 DB 备份（在线 pg_dump · 不停机）──
./backup-db.sh --prefix pre-upgrade-20260814 -y
```

> 可选：提前 `./04-build-server.sh --mode local -y` 预构建镜像（`redeploy.sh` 本身也是先构建后停服，不预构建同样安全）。

### §2.2 停服窗口（低峰执行）

```bash
cd /root/Costra/infra/scripts
./redeploy.sh --build-mode local --restart-psql --restart-redis --restart-nginx --timeout 180 -y
```

一条命令完成：备份当前 server 镜像（tag 备份）→ 在线构建新镜像 → 逆序停（nginx→server→redis→postgres）→ 依序 recreate 起（postgres→redis→server→nginx）→ 等四容器 healthy。

本次 recreate 使以下变更同时落地：PG collector 写 `postgresql.log` + WAL 护栏 + **绑定 `172.17.0.3:5432`（为阶段二流复制预备，安全组放行前外部不可达）**、redis 写 `redis.log`、server 新镜像写 `server.log`、nginx 写 `access/error.log` + netns 内 bbr。

### §2.3 验收（逐项打勾）

```bash
# 1. 服务面
docker ps                              # 四容器全 healthy
curl -sS https://costra.cloud/healthz

# 2. 日志落盘（五类文件都应存在且在增长）
ls -l /data/logs/server/server.log \
      /data/logs/redis/redis.log \
      /data/logs/postgres/postgresql.log \
      /data/logs/nginx/access.log /data/logs/nginx/error.log
tail -3 /data/logs/server/server.log   # JSON 行正常输出

# 3. docker logs 应只剩 entrypoint 早期残留（运行期日志不再进来）
docker logs costra-postgres --tail 5

# 4. logrotate 预检
logrotate -d /etc/logrotate.d/costra-ops

# 5. 内核调优三层验证（内置全项：含 nginx netns bbr）
./apply-host-tuning.sh status          # 退出码 0 = 全过
# 有真实用户连接后做逐连接实证：
nsenter -t $(docker inspect -f '{{.State.Pid}}' costra-nginx) -n ss -tin | grep -o bbr | head -3

# 5b. 复制端口已预绑（阶段二的 PG recreate 因此省掉）
docker port costra-postgres 5432/tcp   # 期望：127.0.0.1:5432 与 172.17.0.3:5432 两条
docker exec costra-postgres psql -U costra -d costra -tAc "SHOW max_slot_wal_keep_size"   # 10GB
# 负向验证（在机器② 执行）：安全组未放行，此刻内网 5432 必须不可达
timeout 3 bash -c '</dev/tcp/172.17.0.3/5432' && echo '异常：5432 已可达' || echo 'OK：安全组未放行'

# 6. 清理旧 pino-roll 残留（确认 server.log 正常写入后再删）
ls /data/logs/server/                  # 确认旧文件名后删除
rm -f /data/logs/server/server.1.log /data/logs/server/server.20*.log

# 7. 业务冒烟：小程序登录 / 记账 / 同步 / 统计页
```

### §2.4 阶段一回滚

| 层 | 操作 |
|---|---|
| server 镜像 | `docker tag <BACKUP_TAG> costra-server:latest && docker compose -f docker-compose.prod.yml --env-file /data/conf/server.env up -d server`（BACKUP_TAG 见 redeploy 输出） |
| compose 配置 | `git checkout <旧 commit> -- infra/docker-compose.prod.yml` 后 `./redeploy.sh --restart-psql --restart-redis --restart-nginx -y` |
| nginx live | `cp -p /data/conf/nginx/costra.cloud.conf.bak.<ts> /data/conf/nginx/costra.cloud.conf` + recreate nginx |
| 内核 | `./apply-host-tuning.sh revert`（注意：被清理的冲突 key 不自动还原，备份在 `/data/conf/host-tuning-backups/`；THP 需手动 echo 或重启复位） |
| cron | 还原 `/etc/cron.d/costra-maintenance.bak.*`；`rm /etc/logrotate.d/costra-ops` |

---

## §3 阶段二：主从复制部署（机器① + 机器②）

**完整细节以 [`pg-standby-backup.md`](pg-standby-backup.md) 为唯一基线**，本节是带顺序的操作卡。阶段一的 PG recreate 已预绑内网复制端口并设好 WAL 护栏，故**阶段二对 prod 全程在线、零重启**：主库配置只有在线 SQL（角色 / 复制槽）与 pg_hba 原子替换 + `pg_reload_conf`；唯一重负载是 basebackup 期间主库只读 IO（异步，零写入影响），避开业务峰值即可。

### §3.1 前置实测（两机 · 对应 §9 验收项 0）

```bash
# 机器①
df -h /data                            # 余量 ≥ 15G（max_slot_wal_keep_size=10GB 非严格上限）
# 机器②
nproc; free -h                         # 可用内存 ≥ 1G
df -h /data                            # 余量 ≥ 20G
# 两机路由三查（§2.2）：ip route get 对端 IP 必须走 eth0；docker 网络不得占用 172.17.x.x
```

腾讯云控制台：机器① 安全组放行 **TCP 5432 · 来源 `172.17.16.4/32`**（精确单机，严禁 `/16`）。

### §3.2 机器② 准备（staging 栈在线 · 无影响）

```bash
ssh root@<机器②>
cd /root/Costra && git pull

# 分析栈新策略生效（restart:"no" + limits）：recreate 一次后保持停止态
cd analytics
docker compose up -d && docker compose ps && docker compose stop
./scripts/analyze.sh --stdout          # 可选：验证按需启停闭环（跑完自动 stop）

# 内核调优（机器② 同适用 · 可选但推荐）
# ⚠️ 若该机 /etc/sysctl.d/99-costra.conf 已有仓库未收录的自定义项（如历史 swap 配置），
#    先合并进仓库 infra/host/sysctl-99-costra.conf 再 apply，否则会被覆盖（host-kernel-tuning.md §7）
cd ../infra/scripts && ./apply-host-tuning.sh apply

# standby.env 落地（§2.4）：只含 3 个键 · 严禁复制 PG_COSTRA_PW · 注释独占一行
cp ../standby.env.example /data/conf/standby.env
vi /data/conf/standby.env              # 待 §3.3 生成密码后填入 REPLICATOR_PW 与两个内网 IP
chmod 0600 /data/conf/standby.env
```

### §3.3 机器① env 补密码 + 主库在线配置（对应 §2.3 / §3 · 零重启）

> **为什么只有 `REPLICATOR_PW` 留到阶段二**（两个内网 IP 已在阶段一预置并绑定）：
> ① 阶段一已跑过 `install-cron`，其 replication-check 闸门按"三件套齐全"判定——
> 缺密码时检查自动跳过，阶段一与窗口期零告警噪音；
> ② 密码只被脚本运行时直读（不参与 compose 插值、不需要进容器环境），补加无需任何重启。

```bash
ssh root@49.235.216.20
# 生成复制密码（同时录入密码管理器；稍后填进机器② standby.env）
openssl rand -base64 32 | tr -d '/+=\n'

cat >> /data/conf/server.env <<'EOF'
# 复制专用账号密码（双 IP 已于阶段一预置）
REPLICATOR_PW=<上面生成的值>
EOF

# 安全组放行（若 §3.1 尚未做）：机器① 入方向 TCP 5432 · 来源 172.17.16.4/32

cd /root/Costra/infra/scripts
./setup-replication-primary.sh --dry-run    # 看计划
./setup-replication-primary.sh              # 不带 --apply-compose：运行态检查直接通过，全在线
# 脚本第 [3/6] 步实测 docker port 已含 172.17.0.3:5432、max_slot_wal_keep_size=10GB
#（阶段一 recreate 已生效）→ COMPOSE_EFFECTIVE=1 → 跳过 recreate，后续全在线：
# replicator 最小权限角色 + 物理复制槽 costra_standby + pg_hba managed block + pg_reload_conf + 自检
```

随后把 `REPLICATOR_PW` 填入机器② 的 `/data/conf/standby.env`。

### §3.4 机器② 从库搭建（对应 §4）

```bash
cd /root/Costra/infra/scripts
./setup-replication-standby.sh --dry-run
./setup-replication-standby.sh
# basebackup（1~5 分钟）→ manifest 校验 → standby.signal/primary_conninfo/passfile →
# 收紧 pg_hba → 启动 costra-standby-pg → 硬校验 recovery=t / streaming / hot_standby_feedback=off
```

### §3.5 备份与监控接入（对应 §5 / §6）

```bash
# 机器①：重跑 install-cron —— 三件套已齐，本次会加入每 5 分钟 replication-check
cd /root/Costra/infra/scripts && ./maintenance.sh install-cron

# 机器②：写 /etc/cron.d/costra-standby + 装 logrotate（完整命令块见 §5.2，照抄执行）
#   · 每 5 分钟 check-replication.sh --container costra-standby-pg
#   · 每 4h（47 分错峰）check && backup-db.sh --db-only --container costra-standby-pg \
#       --prefix standby --backup-dir /data/slave/backups（落 analytics DUMP_INBOX）
#   · install infra/logrotate/costra-ops → /etc/logrotate.d/
# ⚠️ 机器② 严禁运行 maintenance.sh install-cron（purge-* 会误操作 staging 栈）

# 可选：两侧 env 加 WECOM_WEBHOOK_URL（企业微信群机器人）接告警
```

### §3.6 阶段二验收（§9 全项 · 重点三项）

| 重点 | 验证 |
|---|---|
| 项 6 · 从库宕机主库无感 | 机器② `docker stop costra-standby-pg` → 机器① 正常记账 1 分钟 → start 后自动追平 |
| 项 9 · 备份可还原 | 用最新 `standby-*.sql.gz` 跑 `replay-db.sh`，抽样比对行数 |
| 项 11 · 新鲜度门禁 | 停从库后手动跑 `check && backup` 组合 → check exit 1 且**不产出**备份 |

其余项（主从一致性、staging/分析栈不受影响、权限边界、日常发布不触发 PG recreate）按 §9 表格逐项过。

### §3.7 阶段二回滚

按 `pg-standby-backup.md` §10：机器② `down` 从库 + 归档数据目录 + 删 cron/env；机器① 删槽、删 replicator、清 pg_hba managed block、删 server.env 三行（含两个 IP）、重跑 `install-cron`。内网端口绑定保留无害（安全组已收回即不可达）；如需彻底还原 compose 端口映射，留待下次例行发布顺带 recreate postgres，**不单独安排重启**。

---

## §4 时间线建议

| 窗口 | 内容 | 业务影响 |
|---|---|---|
| T0 任意时段 | §2.1 全部准备（内核调优 / chown / logrotate / cron / nginx conf / 备份） | 无 |
| T0 低峰 | §2.2 一次停服重启（1~3 分钟） | **短暂 5xx** |
| T0+观察 24h | 看日志增长、logrotate 首日轮转、`dmesg`、`docker stats` | 无 |
| T1 任意时段 | 阶段二 §3.1~§3.5 全程在线（机器② 为主 + 机器① 在线 SQL/reload；basebackup 只读 IO 避开业务峰值即可） | 无 |
| T1+一周 | §3.6 验收 + 观察 lag / `wal_status` / 告警通道 | 无 |

---

## §5 变更记录

| 日期 | 变更 |
|---|---|
| 2026-08-14 | 初版：覆盖日志统一落盘 + logrotate、宿主机内核调优（sysctl/THP/bbr）、分析栈按需启停的「一次停服」阶段一，以及主从复制独立部署的阶段二。 |
| 2026-08-14 | v2：复制配置拆分投放——双内网 IP 提前到阶段一（PG recreate 顺带绑复制端口），仅 `REPLICATOR_PW` 留到阶段二（闸门按三件套齐全判定 → 窗口期零告警；密码脚本直读、补加无重启）。**阶段二不再带 `--apply-compose`，对 prod 零重启**。新增硬顺序 5（窗口前校验主库 IP 在本机网卡）。 |
