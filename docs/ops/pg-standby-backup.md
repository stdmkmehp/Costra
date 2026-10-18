# Costra · PG 从库实施方案（异步流复制 · 备份 · 只读 · 不切换）

> **状态**：📋 实施方案 · 待执行
> **日期**：2026-08-13
> **目标**：现有单机（机器① · prod）的 PG 在机器② 上搭一个 **hot standby 从库**，用于 ① 备份线上数据 ② 不影响主库的只读查询/分析。
> **硬性约束（需求定案）**：
> - 不要求强一致：接受秒级甚至稍久的数据差异（**纯异步流复制**）。
> - **从库绝不反向影响主库**：从库宕机/断网/积压，主库写入零感知、零等待。
> - **主库宕机 = 服务不可用（接受）**：不做故障切换、不 promote、从库不对外服务。
> - 从库仅内网可达，不进 nginx、不挂域名。
>
> **部署位置（重要）**：机器② = **staging 机器 + 分析机**（主机名 `costra-prod-slave`，域名 stg.costra.cloud），该机器上**已有两套栈**：staging 服务栈（project `costra`，与 prod 同构）与分析栈（project `costra-analyze`，`analytics/docker-compose.yml`）。从库是**第三套**，与前两套资源全面错开：
>
> | 资源 | staging 服务栈 | 分析栈 | 从库（本方案） |
> |---|---|---|---|
> | compose project | `costra` | `costra-analyze` | `costra-standby` |
> | PG 容器名 | `costra-postgres` | `costra-analyze-pg` | `costra-standby-pg` |
> | PG 镜像 | `postgres:15-alpine`（uid 70） | `postgres:15`（uid **999**） | `postgres:15-alpine`（uid 70） |
> | PG 数据 | `/data/pgsql` | named volume `analyze-pg-data` | `/data/pgsql-standby` |
> | PG 日志 | `/data/logs/postgres` | （容器内） | `/data/logs/standby` |
> | PG 宿主机端口 | `127.0.0.1:5432` | `127.0.0.1:15432` | `127.0.0.1:15433` + 内网 `15433` |
> | env 文件 | `/data/conf/server.env` | `/data/conf/analytics.env` | `/data/conf/standby.env`（独立） |
>
> **红线：严禁用 prod 的 `server.env` 覆盖 staging 机器的 `server.env`**——从库所需配置放独立的 `standby.env`（§2.4）。
>
> **注意端口邻位**：分析栈占 `15432`，从库占 `15433`，仅差 1。调整任一方端口前必须 `ss -tlnp` 复查。
>
> **注意两种 postgres 镜像并存**：分析栈用 debian 变体（uid 999），主库/从库用 alpine（uid **70**）。`chown` 数据目录时用错 uid 会导致 PG 起不来（`common.sh` 已按变体拆成 `UID_POSTGRES_ALPINE` / `UID_POSTGRES_DEBIAN`）。
>
> **文档沿革**：本文取代已删除的 `pg-replication-setup.md`（2026-07-08 · 同步主从 + 手动降级 + promote 方案）。该方案因需求定案为"从库绝不反向影响主库"而未执行——同步提交会让从库故障阻塞主库写入，与红线直接冲突。其中仍然有效的内容已并入本文：基础设施做法（§3/§4）、日常运维命令对照（§12）、以及"为什么不做同步复制 + 未来若要升级同步的完整路径"（§13）。**本文是唯一执行基线**。

---

## §0 关键结论（先看这 6 条）

1. **异步流复制是 PG 15 开箱能力**：主库默认 `wal_level=replica`、`max_wal_senders=10`、`max_replication_slots=10`、`hot_standby=on`，几乎不用动。
2. **主库必须显式改的只有 2 处**（已改入 `docker-compose.prod.yml`）：
   - `ports` 追加内网网卡映射 `${PG_PRIMARY_LAN_IP:-127.0.0.2}:5432:5432`（让从库连进来）；
   - `command` 追加 `max_slot_wal_keep_size=10GB`（护栏：防从库久挂时复制槽让主库 WAL 无限堆积撑爆磁盘）。
   - 这两处是 docker 层改动，**落地时主库容器 recreate 一次**（PG 重启秒级~十几秒），建议低峰执行。
3. **主库其余复制配置全部在线完成**（不重启）：建 `replicator` 复制账号、建物理复制槽、pg_hba 放行、reload——由 `setup-replication-primary.sh` 一键完成且幂等。
4. **从库不 initdb、不跑 migration**：数据目录由 `pg_basebackup` 从主库物理复制；manifest 通过后，脚本确定性写入 `standby.signal`、`primary_conninfo` 和持久 passfile。之后 schema/数据全经复制流自动同步。
5. **备份迁移（2026-08-14 定案）**：DB 备份职责整体迁到从库——机器② 复用 `backup-db.sh --db-only` 跑每 6h 的 `pg_dump` cron，落 `/data/slave/backups`；主库不再跑定时备份（原 `backup-avatars` 已随头像 COS 化退役 · 2026-10-17 · 见 `docs/design/cos-offload-phase2-avatar.md` §9）。
6. **不引入任何切换/降级机制**：主库宕机后原样恢复当主库（见 §8 恢复手册）；从库挂了主库毫无感知，从库回来自动追平。

---

## §1 架构与数据流

```
┌─ 机器①（现有 prod · 49.235.216.20 · 2核4G）────────────────┐
│  docker compose (docker-compose.prod.yml)                    │
│  ┌───────────┐  写 WAL        ┌──────────────┐               │
│  │  server   │ ─────────────▶ │  postgres    │ 内网:5432     │
│  │  (业务)   │   本地读        │  (主库)      │─────────────┐ │
│  └───────────┘                └──────┬───────┘             │ │
│                                      │ 流复制（异步 · 仅内网） │ │
└──────────────────────────────────────┼───────────────────────┼─┘
                                       ▼                       ▼
┌─ 机器②（staging 机器 · stg.costra.cloud · 同 VPC）──────────┐ │
│  ┌─ staging 服务栈（可能运行 · project: costra）─────────┐ │ │
│  │  costra-postgres(/data/pgsql · 127.0.0.1:5432) +       │ │ │
│  │  costra-server + costra-nginx + costra-redis           │ │ │
│  └───────────────────────────────────────────────────────┘ │ │
│  ┌─ 从库（本方案 · project: costra-standby）─────────────┐ │ │
│  │  costra-standby-pg (hot standby · 只读)  ◀──────────────┘ │
│  │  数据 /data/pgsql-standby · 端口 15433 · standby.env      │
│  └─────────────────────────────────────────────────────────┘ │
│      ▲ 本机容器内只读查询   ▲ 每 6h pg_dump（backup-db.sh）     │
│      │（Unix socket）        │ 每 1h check-replication.sh       │
└──────────────────────────────────────────────────────────────┘
```

**数据一致性模型**：主库 commit 只等本地 WAL 落盘（从库完全不在写入路径上）→ 主库写延迟零增加；从库持续异步追赶，常态 lag 亚秒~秒级。主库故障时丢失 lag 窗口内的已确认写入——这是选异步的明确代价，已在需求中接受。

**明确不做的事**：不设 `synchronous_standby_names`（初始化与监控硬断言为空）、不做降级脚本、不做 promote、不做 `pg_rewind`、不给从库配 nginx/域名。

---

## §2 前置准备（机器 + 网络 + 配置）

### §2.1 机器②（从库 = staging 机器 + 分析机）

- **机器② 主机名 `costra-prod-slave`**（stg.costra.cloud，内网 `172.17.16.4`），与机器①（`172.17.0.3`）同 VPC 不同子网，经 VPC 路由互通。
- **机器② 上三栈并存**，从库必须与前两套全面隔离（已固化在代码里，无需手工操心）：

| 资源 | staging 栈 | 分析栈 | 从库 | 隔离载体 |
|---|---|---|---|---|
| compose project | `costra` | `costra-analyze` | `costra-standby` | `docker-compose.standby.yml` 顶层 `name` |
| 容器名 | `costra-postgres` | `costra-analyze-pg` | `costra-standby-pg` | compose `container_name` |
| 数据目录 | `/data/pgsql` | named volume | `/data/pgsql-standby` | compose volumes |
| 日志目录 | `/data/logs/postgres` | （容器内） | `/data/logs/standby` | compose volumes |
| 宿主机端口 | `127.0.0.1:5432` | `127.0.0.1:15432` | `127.0.0.1:15433` / 内网 `15433` | compose ports |
| env 文件 | `/data/conf/server.env` | `/data/conf/analytics.env` | `/data/conf/standby.env` | 独立文件（§2.4） |
| docker 网段 | `172.19.0.0/16` | `172.20.0.0/16` | compose 自动分配 | docker 自动避让 VPC 段 |

- **前提**：staging 栈已按既有流程部署（docker / clone 仓库 / `02-prepare-dirs.sh` 均已就绪），本方案**复用**这些，不重建。
- **staging 的 `server.env` 不要定义 `PG_PRIMARY_LAN_IP`/`PG_STANDBY_LAN_IP`/`REPLICATOR_PW`**（保持现状即可）；即使误定义了，staging PG 也只是多绑一个内网端口，无复制配置、无实际影响。但**严禁把 prod 的 `server.env` 覆盖到 staging 机器**。此外 `setup-replication-primary.sh` 已加"本机网卡必须含 `PG_PRIMARY_LAN_IP`"防呆，在机器② 误跑会直接拒绝。
- **资源配额（2026-08-14 决策更新：分析栈加 limits + 按需启停）**：
  - staging 栈 limits 合计 3.0G（server 1G + redis 768M + pg 1G + nginx 256M）；
  - 分析栈（`costra-analyze-pg` 非 alpine `postgres:15` + `costra-analyze-node`）自 v0.2.4 起 **`restart: "no"` 按需启停**——`analyze.sh` 跑完即 `docker compose stop`，仅分析窗口内占用资源；并加 `deploy.resources.limits`（PG 512M/0.5CPU + node 256M/0.5CPU），不再是常驻的无限制不确定项；
  - 从库保持 **`memory: 768M` + `shared_buffers=256MB`**（低于主库的 1G），并与主库其余调优参数逐项对齐。
  - **运维约束**：① 从库备份 cron 继续与分析窗口错峰（分析窗口峰值约 768M，仍是全机内存峰值时段）；② 上线后看一次 `docker stats --no-stream` 复核；③ 若出现 OOM kill，优先降从库 `memory`→`512M` + `shared_buffers`→`128MB`（二者必须联动）；分析栈 limits 已封顶，不再调整。
- **待确认**：机器② 的 CPU/内存规格与 `/data` 余量尚未实测。执行 §4 前请先跑 `nproc; free -h; df -h /data`，确认可用内存 ≥ 1G、`/data` 余量 ≥ 20G。
- **机器① 磁盘要求（易漏）**：`max_slot_wal_keep_size=10GB` 在 checkpoint 时限制复制槽保留的 WAL，不是字节级严格磁盘上限，实际 `pg_wal` 可短暂超过该值。执行 §3 前仍要求 `df -h /data` 余量 **≥ 15G**，并依赖主库每小时的 `safe_wal_size` 检查与整盘监控；不能把 15G 当成数学保证。

### §2.2 云安全组 + 内网路由前置校验

腾讯云控制台 → 机器① 安全组 → 入方向规则放行：**TCP 5432 · 来源 = `172.17.16.4/32`**（精确到单机，**不要**放 `172.17.0.0/16`，那等于对整个 VPC 开放）。主库永远不放开 0.0.0.0。

> ⚠️ **本项目 VPC 网段为 `172.17.0.0/16`（prod `172.17.0.3` · staging `172.17.16.4`），与 Docker 默认网桥网段重合**（docker0 默认 `172.17.0.1/16`，compose 自建网络默认地址池 `172.17.0.0/16`~`172.31.0.0/16`）。若某台机器上 docker 占用了 `172.17.x.x`，去往对端的流量会被路由进本地网桥而**不出机器**，表现为"安全组已放行但连不上"或更糟的"连到本机某容器"。
>
> **本项目已实测通过（2026-08-13）**，两机 docker 均已自动避让：
>
> | 检查 | prod（172.17.0.3） | staging（172.17.16.4） |
> |---|---|---|
> | `ip route get <对端>` | `via 172.17.0.1 dev eth0` ✅ | `via 172.17.16.1 dev eth0` ✅ |
> | docker 网段 | `bridge 172.18` / `costra_default 172.25` | `bridge 172.18` / `costra_default 172.19` / `costra-analyze_default 172.20` |
> | 是否占用 172.17.x.x | 无 ✅ | 无 ✅ |
>
> 两机 gateway 不同（`172.17.0.1` vs `172.17.16.1`）说明处于同 VPC 的不同子网，经 VPC 路由互通——不影响方案，但确认了 `pg_hba` / 安全组必须用 `/32` 而非同子网假设。
>
> **复查命令**（换机器、加机器、重装 docker 后都要重跑）：
>
> ```bash
> ip route get 172.17.0.3      # 在 staging 上执行 · 下一跳必须是 eth0
> ip route get 172.17.16.4     # 在 prod 上执行
> docker network ls -q | xargs -r docker network inspect \
>   -f '{{.Name}} {{range .IPAM.Config}}{{.Subnet}} {{end}}'
> ```
>
> docker 的避让是**运行时探测**而非固化配置。建议（非阻塞的独立加固项）在两机 `/etc/docker/daemon.json` 显式钉死 `"default-address-pools": [{"base":"172.18.0.0/12","size":24}]`，把"碰巧不冲突"变成"结构上不可能冲突"。

### §2.3 server.env 增加三项（机器① 先做）

> ⚠️ **格式红线：env 文件严禁行尾内联注释**。`docker compose --env-file` 与脚本里的 `cut -d= -f2-` 都不剥离行尾 `#`，`PG_PRIMARY_LAN_IP=10.0.x.x  # 注释` 会被整串当成 IP → 主库 `docker compose up` 因非法 bind IP 直接失败，从库 TCP 探测也必然失败。注释一律独占一行。

```bash
# 生成复制专用密码（base64 去特殊字符 · 存密码管理器）
openssl rand -base64 32 | tr -d '/+=\n'
# 示例输出：xK3m...（43 字符）

cat >> /data/conf/server.env <<'EOF'

# === PG 异步流复制（pg-standby-backup 方案）===
# 注释独占一行 · 严禁写在 KEY=VALUE 行尾
REPLICATOR_PW=<上一步生成值>
# 机器①（prod）VPC 内网 IP
PG_PRIMARY_LAN_IP=10.0.x.x
# 机器②（staging 机器）VPC 内网 IP
PG_STANDBY_LAN_IP=10.0.y.y
EOF
```

> - 三项不影响 `03-generate-env.sh --reuse-secrets` 的必填校验；但**之后若重跑 03-generate-env 全新生成会覆盖丢失这三项**，生成后需重加（建议在此处做注释备份）。
> - `PG_PRIMARY_LAN_IP` = 机器① VPC 内网 IP；`PG_STANDBY_LAN_IP` = **机器②（staging 机器）** VPC 内网 IP，均在腾讯云控制台「实例-内网 IP」查看。
> - 可选：追加 `WECOM_WEBHOOK_URL=<企业微信群机器人>` 供 §6 监控告警用。

### §2.4 机器② 的 standalone env 文件（standby.env）

**机器② 就是 staging 机器，绝不能用 prod 的 `server.env` 覆盖它的 `server.env`**（staging 服务栈依赖它跑）。从库所需配置放**独立文件** `/data/conf/standby.env`，模板已入仓：`infra/standby.env.example`。

```bash
# ── 机器①（prod）上只导出复制所需的 3 个键 ──
grep -E '^(REPLICATOR_PW|PG_PRIMARY_LAN_IP|PG_STANDBY_LAN_IP)=' /data/conf/server.env
# 严禁把 PG_COSTRA_PW 复制到机器②

# ── 机器②（staging 机器）上从模板落地 ──
cd /root/Costra && git pull
cp infra/standby.env.example /data/conf/standby.env
vi /data/conf/standby.env      # 填入上一步的 3 个真实值（注释独占一行）
chmod 0600 /data/conf/standby.env

# 自检：3 个必填键非空；不得出现 prod 业务密码键或内联注释/空格
grep -E '^(REPLICATOR_PW|PG_PRIMARY_LAN_IP|PG_STANDBY_LAN_IP)=..*' /data/conf/standby.env
! grep -q '^PG_COSTRA_PW=' /data/conf/standby.env
grep -nE '^[A-Z_]+=.*[#[:space:]]' /data/conf/standby.env    # 应无输出
```

> - `standby.env` 只含复制专用密码、主从 IP 和可选 webhook；**不复制 `PG_COSTRA_PW`、JWT/WX/REDIS 等业务密钥**。
> - 备份和健康检查通过容器内 Unix socket 连接，不需要业务密码；`COSTRA_ENV_FILE` 仅用于读取可选 webhook 和 compose 的 IP。

### §2.5 本次仓库变更清单

> ⚠️ **落地前必须先提交并推送**，否则 §3.1 / §4 的 `git pull` 拿不到任何东西。

| 文件 | 变更 |
|---|---|
| `infra/docker-compose.prod.yml` | 主库 ports 加内网映射 + command 加 `max_slot_wal_keep_size=10GB` |
| `infra/docker-compose.standby.yml` | **新增** · 从库编排（hot standby · `hot_standby_feedback=off` · 300s 冲突容忍 · memory 768M） |
| `infra/standby.env.example` | **新增** · 从库最小 env 模板（不含 `PG_COSTRA_PW`） |
| `infra/scripts/setup-replication-primary.sh` | **新增** · 主库配置（managed HBA · 异步断言 · lost 槽/密码轮换均显式执行） |
| `infra/scripts/setup-replication-standby.sh` | **新增** · 从库搭建（临时 `.pgpass` · managed HBA · recovery/streaming 硬校验） |
| `infra/scripts/recover-primary-from-standby.sh` | **新增** · `prepare/activate/status` 双阶段主库反向恢复 |
| `infra/scripts/check-replication.sh` | **新增** · 双侧健康检查（slot/WAL/async + latest-end/receive/replay 新鲜度） |
| `infra/scripts/backup-db.sh` | 加从库目标参数、脚本锁、0600 权限、partial 校验后原子发布 |
| `infra/logrotate/costra-ops` | **新增** · 宿主机统一日志轮转模板（运维脚本 + 主从 PG collector + server/redis/nginx 落盘日志），由两机分别安装 |
| `infra/scripts/lib/common.sh` | `UID_POSTGRES=999`（对 alpine 是错的且无人引用）拆为 `UID_POSTGRES_ALPINE=70` / `UID_POSTGRES_DEBIAN=999` |
| `infra/scripts/README.md` | 索引补 3 个新脚本 + 新增「PG 从库」章节 |

---

## §3 阶段 A：主库改造（机器①）

### §3.1 拉取仓库变更

```bash
cd /root/Costra && git pull          # 拿到 compose 变更 + 新脚本
```

**先确认 §2.3 的三项 env 已追加**（compose 端口映射依赖 `PG_PRIMARY_LAN_IP`；未定义时 fallback 绑 `127.0.0.2` 环回，不报错但复制连不上——脚本会拦住）。

### §3.2 执行主库配置脚本

```bash
cd /root/Costra/infra/scripts

# 先 dry-run 看计划
./setup-replication-primary.sh --dry-run

# 正式执行：校验 + 在线配置（replicator 账号 / 复制槽 / pg_hba / reload）
./setup-replication-primary.sh

# 若脚本提示"容器尚未绑定内网端口"→ 说明 compose 变更未落地，低峰窗口执行：
./setup-replication-primary.sh --apply-compose
```

脚本会按序做 6 件事并自检：读 env → 断言 `synchronous_standby_names` 为空 → 校验 compose 端口/WAL 护栏 → 不存在时建 `replicator`（重跑默认不旋密）→ 建或检查物理槽（`lost` 必须显式重建）→ 原子维护首条 TCP HBA 规则前的 managed block，reload 失败自动回滚。

**预期自检输出**：

```
  replicator 角色 : replicator (repl=t, login=t)
  复制槽          : costra_standby (active=f)      ← 从库接入后变 t
  WAL 护栏        : 10GB
  wal_level       : replica
  端口绑定        : 127.0.0.1:5432 / 10.0.x.x:5432
```

> **关于唯一一次主库重启**：`--apply-compose` 触发 recreate（约 5~15 秒）。窗口内 server 到库连接瞬断后由 pg 连接池自动重连，健康检查短暂波动，建议低峰执行。**recreate 之后任何日常发布（redeploy.sh）不会再触发 postgres 重启**（compose 定义不再变化）。

### §3.3 主库侧验证

```bash
docker exec costra-postgres psql -U costra -d costra -c \
  "SELECT slot_name, active, restart_lsn FROM pg_replication_slots;"
```

主库侧至此完成。**尚未有从库连接前，复制槽 `active=f` 属正常。**

---

## §4 阶段 B：从库搭建（机器②）

### §4.1 执行从库搭建脚本

```bash
cd /root/Costra/infra/scripts

./setup-replication-standby.sh --dry-run

# 正式执行（basebackup 前会 confirm）
./setup-replication-standby.sh
```

脚本按序（全程避开 staging 栈资源）：读最小 `standby.env` + 本机 IP 防呆 → 准备空数据目录 → 校验端口/主库连通 → 临时 `.pgpass` 执行不带 `-R` 的 `pg_basebackup` → 验证 manifest → 原子生成持久 passfile/recovery config → 原子维护 managed HBA → 启动并硬校验 recovery、streaming、`hot_standby_feedback=off`。

> **staging 栈不受影响**：脚本只动 `costra-standby` project 的资源。若 basebackup 后中断，修复原因后可带 `--repair-existing`；脚本会复验 manifest，再幂等重建 standby 身份，不会盲信半成品或静默重拉数据。

### §4.2 pg_basebackup 参数说明（关键坑位）

| 参数 | 作用 |
|---|---|
| `--user postgres` | 以镜像内 postgres 用户（**alpine 版 uid=70**，非 debian 版 999）跑，避免生成 root 属主文件；脚本会预先 `chown 70:70 /data/pgsql-standby` |
| 不使用 `-R` | 避免临时 passfile 路径写入 recovery config；manifest 通过后由脚本原子生成 `standby.signal`、`primary_conninfo` 与持久 `.replication.pgpass` |
| `-Xs` | 边备份边流式拉 WAL，保证一致性；脚本在任何配置修改前运行 `pg_verifybackup` |
| `-S costra_standby` | 绑定主库侧物理复制槽（从库断连期间主库保留其 WAL） |
| `-d application_name=costra_standby` | **必须**，监控/排障按此名识别 |

### §4.3 从库侧验证

```bash
# 1. 容器日志应出现流复制启动标志（最直观的判据）
docker logs costra-standby-pg --tail 30 | grep -i "started streaming WAL from primary"

# 2. recovery 模式（容器内 Unix socket，无需业务密码）
docker exec costra-standby-pg \
  psql -U costra -d costra -tAc "SELECT pg_is_in_recovery();"                    # → t

# 3. 流复制状态
docker exec costra-standby-pg psql -U costra -d costra -c \
  "SELECT status, sender_host, slot_name FROM pg_stat_wal_receiver;"              # → streaming

# 4. 复制槽已激活（回机器① 查）
#    pg_replication_slots 中 costra_standby 的 active 变为 t · wal_status=reserved
```

> **从库绝不执行的既有脚本**（会破坏 standby 语义或误伤同机 staging 栈）：
> - `06-migrate.sh` —— migration 经复制流自动到达，从库是只读的，跑必失败；
> - `reset-db.sh` / `restore-db.sh` —— 写操作，且默认容器名指向 staging 的 `costra-postgres`；
> - `maintenance.sh install-cron` —— 见 §5.2 说明。

### §4.4 主从一致性抽样

```bash
# 机器①：当前 WAL 与 sender 视角
./check-replication.sh
# 机器②：latest_end_lsn（上游最近告知）→ receive → replay 三段进度
./check-replication.sh --container costra-standby-pg
# 两侧均 exit 0；不要靠两条文本 LSN 恰好相等判断健康
```

---

## §5 备份体系

### §5.1 职责划分

| 备份 | 位置 | 内容 | 输出目录 | 频率 | 状态 |
|---|---|---|---|---|---|
| ~~`maintenance.sh backup-avatars`~~ | 机器① 主库 | — | — | — | **已退役**（2026-10-17 · 头像 COS 化，对象多 AZ 冗余无需 tar 备份；`maintenance.sh backup` 入口仍可手动备份 DB） |
| `backup-db.sh --db-only --container costra-standby-pg --prefix standby --backup-dir /data/slave/backups` | 机器② 从库 | pg_dump | **`/data/slave/backups`** | 每 6h（cron 27 分） | **DB 备份主责**（2026-08-14 起由 prod 迁入） |

- 从库备份复用现有 `backup-db.sh`：`--container` 指定从库容器，`--prefix standby` 区分文件名，`--backup-dir` 直接落到分析栈的 `DUMP_INBOX`。三个参数默认值均保持原样，**主库既有调用零影响**。
- **直接落 `/data/slave/backups` = analytics 链路即时打通**（团队决策）：`/data/conf/analytics.env` 的 `DUMP_INBOX=/data/slave/backups`，而 `analytics/scripts/pick-dump.sh` 是按 `*.sql.gz` + mtime 取最新、**不锁前缀**，因此 `standby-*.sql.gz` 天然被识别；compose 里该目录是 `:ro` 挂载，分析侧不会删改这些文件（符合"`analytics/` 只读 `.sql.gz`"的既有约定）。
  - 由此**数据分析链路完全脱离主库**：不再需要从机器① scp dump 过来。
  - `backup-db.sh` 的清理逻辑按 `${BACKUP_PREFIX}-*` 精确匹配，只会清 `standby-*`，**不会碰**历史 scp 过来的 `scheduled-*` 文件。
- 从库 `pg_dump` 不停 replay，对主库零影响。`max_standby_streaming_delay=300s` 只降低 recovery conflict 取消概率，并不保证成功；脚本会捕获失败且不发布 `*.sql.gz`，下一轮重试。
- `backup-db.sh` 以隐藏 partial 写入并校验，最后原子 rename；analytics 只会看到完整归档。脚本自身 `flock` 防 cron/人工重入，目录 `0700`、归档 `0600`。
- **注意 `/data/slave/backups` 的权限**：既有 `02-prepare-dirs.sh` 对 `/data/backups` 设了 `chmod 0700`；`/data/slave/backups` 由分析栈约定管理，首次执行前确认 root 可写（`touch /data/slave/backups/.wtest && rm -f $_`）。

### §5.2 从库 cron 安装

机器② 的 cron 由 `infra/scripts/install-standby-cron.sh` 幂等安装（仓库是唯一事实源，**不要**手写 `/etc/cron.d/costra-standby`）：

```bash
cd /root/Costra/infra/scripts
./install-standby-cron.sh --dry-run   # 预览将写入的 cron 内容
./install-standby-cron.sh             # 正式安装（cron + 日志文件 + 备份目录 + logrotate + restart crond）
```

脚本生成的 `/etc/cron.d/costra-standby` 设计要点：

1. `COSTRA_ENV_FILE` 前缀只为读取 `standby.env` 的可选 webhook；SQL 走容器内 Unix socket，不读取 `PG_COSTRA_PW`。
2. **备份前串联健康检查**：从库若失联或仍在追历史 WAL，`pg_dump` 依然可能产出格式正常但陈旧的文件；门禁用 latest-end/receive/replay 三段进度 fail closed。
3. **与分析栈错峰**：备份固定在 27 分；必须避开分析窗口——分析栈恢复 dump 时是全机内存峰值。
4. `backup-db.sh` 自带 `flock`，cron 外层无需再加锁；整条组合用 `{ check && backup; } >>log 2>&1`，确保检查和备份输出进入同一日志（`/data/logs/maintenance/standby-backup.log`）。
5. **staging 数据刷新（每天 6:27）**：`restore-staging-from-prod.sh -y` 紧跟 6:00 备份窗口之后，用 `/data/slave/backups` 最新 `standby-*.sql.gz` 自动刷新本机 staging 栈（Redis FLUSHALL → 委托 restore-db.sh 单事务恢复），`-y` 全链路自动确认，无人值守；日志落 `/data/logs/maintenance/staging-restore.log`。恢复脚本自带机器②防呆（要求 `costra-standby-pg` 容器存在），不串联 check 门禁——备份 cron 已保证仅复制健康才产出新备份，即便当天未产出也只会用到更旧备份（对 staging 无害）。头像已 COS 化（2026-10-17）：恢复后 staging 库内头像 URL 指向 prod 头像桶（公有读 · 正常显示），原 avatars 归档恢复段已移除。

> 防呆：脚本要求本机存在 `costra-standby-pg` 容器与 `/data/conf/standby.env`，在机器① 或未搭建从库时直接拒绝。logrotate 模板与主库共用（`infra/logrotate/costra-ops`）由脚本一并安装。从库机器**不要**运行 `maintenance.sh install-cron`：其 purge-* 会误操作 staging 栈并在只读副本失败。

---

## §6 日常监控（check-replication.sh）

`check-replication.sh` 自动探测本机角色，主库/从库机器均可运行：

| 视角 | 检查项 | 默认阈值 | 异常动作 |
|---|---|---|---|
| 主库 | `synchronous_standby_names` | 必须为空 | exit 1 + 企业微信告警 |
| 主库 | 复制槽是否存在及 `wal_status` | 缺失 / `unreserved` / `lost` 异常 | 同上（处置不同，见下） |
| 主库 | 复制槽 `safe_wal_size` | < 2GB（`--safe-wal-min-bytes`） | 同上 |
| 主库 | 从库连接 | 必须唯一 `async/streaming` | 同上 |
| 主库 | `replay_lag` | > 60s（`--max-lag-seconds`） | 同上 |
| 从库 | `hot_standby_feedback` | 必须为 `off` | 同上 |
| 从库 | walreceiver / 最近消息 | 唯一 streaming；消息 ≤120s | 同上 |
| 从库 | latest-end→receive→replay 三段积压 | 任一段 >256MB 或 LSN 为空 | 同上，并阻断备份 |

**复制槽 `wal_status` 是 `max_slot_wal_keep_size=10GB` 护栏的唯一可观测出口**，四个状态的处置动作完全不同，务必区分：

| `wal_status` | 含义 | 处置 |
|---|---|---|
| `reserved` | 所需 WAL 在 `max_wal_size` 内 | 健康，无需动作 |
| `extended` | 超出 `max_wal_size`，仍在 10GB 护栏内 | 仅 warn，关注从库是否在追平 |
| `unreserved` | **已越过护栏，WAL 正在被回收** | **仍有救**：立刻抢救从库还能追平，再拖变 `lost` |
| `lost` | 所需 WAL 已被删除 | **从库无法追平，必须重做 `pg_basebackup`**（§8.3） |

> 只报"从库失联"无法区分 `unreserved` / `lost`，而这两者一个是"赶紧救"、一个是"救不回来了只能重做"。`safe_wal_size` 低水位告警（默认剩余 < 2GB，即护栏的 20%）用于在进入 `unreserved` **之前**就发出预警。

> **关于 `--receiver-timeout` 的判据**（别按"10s"理解）：`10s` 是 `wal_receiver_status_interval`，方向是**从库 → 主库**上报。主库 → 从库的 keepalive 由 `wal_sender_timeout`（默认 60s）的一半决定，因此空闲期 `last_msg_receipt_time` 落后 ~30s 属正常，默认阈值 120s 留足余量。

```bash
# 机器①（主库）手动跑：默认容器 costra-postgres · 读 server.env
cd /root/Costra/infra/scripts && ./check-replication.sh

# 机器②（从库）手动跑：容器 + env 文件都要换（三栈隔离）
cd /root/Costra/infra/scripts && \
  COSTRA_ENV_FILE=/data/conf/standby.env ./check-replication.sh --container costra-standby-pg
```

机器② cron 已在 §5.2 给出。机器①必须重新执行 `maintenance.sh install-cron`：当 `server.env` 的 `REPLICATOR_PW` 与主从 IP 三项均非空时，它会加入每小时的 `replication-check`；缺任一项则跳过并打印提示。

**企业微信告警**：在机器① 的 `server.env` 或机器② 的 `standby.env` 加一行 `WECOM_WEBHOOK_URL=https://qyapi.weixin.qq.com/cgi-bin/webhook/send?key=xxx`（群机器人），异常时自动推送文本消息；未配置则仅日志 + 非零退出码。

---

## §7 从库只读查询指南

```bash
# 机器② 上只允许通过容器内 Unix socket 做人工只读查询
docker exec -it costra-standby-pg psql -U costra -d costra
```

standby 的 managed HBA 显式拒绝全部普通 TCP 数据库连接，`15433` 只为 §8.2 灾难恢复时机器①的物理 `pg_basebackup` 保留；对应安全组默认关闭。不要在机器②保存 `PG_COSTRA_PW`。

注意事项：

- **只读**：recovery 模式下任何写语句报 `cannot execute ... in a read-only transaction`——这是特性不是故障。
- **禁止在从库执行**：migration、purge、任何 DDL/DML。定时清理任务只在主库跑（§5.2 已规避）。
- **重查询放从库**：报表/统计/大范围 `SELECT` 建议从库执行，主库只承接业务路径。
- **lag 感知**：查询结果滞后于主库（常态秒级）。对 lag 敏感的逻辑先查 `pg_last_wal_replay_lsn()` 判断新鲜度。
- analytics 项目继续走 dump 导入（§5.1），不要直连从库改造其 pipeline。

---

## §8 主库故障与恢复手册

**故障语义（需求定案）**：主库宕机 → 服务不可用（接受）→ 不切换、不 promote → 恢复路径是"修好主库/重建主库"。

### §8.1 场景 A：主库机器/容器故障，数据目录完好

```bash
# 机器①
docker compose -f /root/Costra/infra/docker-compose.prod.yml \
  --env-file /data/conf/server.env up -d postgres
# server 连库自动重连 · 健康检查恢复后业务自动回来
```

从库侧无需任何操作：standby 与主库断连后自动重试，主库恢复即自动追平（期间主库为它保留 WAL，受 10GB 护栏保护）。

### §8.2 场景 B：主库数据目录损坏 / 磁盘全丢（从库数据 = 唯一数据源）

**RPO 预期：恢复到从库已回放的最新位置；故障前尚未复制/回放的写入确认丢失。**

> **硬前置**：原主库保持 `full_page_writes=on`（本项目默认满足）。本流程由同一负责人串行执行，不在两机并发推进。

#### 0. 在机器②冻结恢复点

先等待已接收 WAL 全部回放并记录 LSN；若 120 秒仍未相等，停止操作并人工决定 RPO，不能跳过：

```bash
for i in $(seq 1 120); do
  CAUGHT_UP=$(docker exec costra-standby-pg psql -U costra -d costra -tAc \
    "SELECT pg_last_wal_receive_lsn() IS NOT NULL AND pg_last_wal_receive_lsn() = pg_last_wal_replay_lsn();")
  [[ "${CAUGHT_UP}" == "t" ]] && break
  sleep 1
done
[[ "${CAUGHT_UP}" == "t" ]] || { echo 'standby 尚未回放完已接收 WAL，停止恢复'; exit 1; }
docker exec costra-standby-pg psql -U costra -d costra -c \
  "SELECT pg_last_wal_receive_lsn(), pg_last_wal_replay_lsn(), now();"
```

然后在腾讯云临时放行机器① `172.17.0.3/32` → 机器② TCP `15433`；平时该规则必须不存在。

#### 1. 机器①执行持久化 `prepare`

不要手工移动 `/data/pgsql` 或拼接临时变量。脚本会持久记录阶段，停止业务与 cron、优雅停止旧 PG，从 standby 拉到独立候选目录，验证 manifest，再剥离 recovery 身份；SSH 中断后可先 `status`，再重跑 `prepare` 续作。

```bash
cd /root/Costra/infra/scripts
./recover-primary-from-standby.sh prepare --standby-caught-up
./recover-primary-from-standby.sh status
```

`prepare` 不覆盖原 `/data/pgsql`；候选目录和状态文件分别位于 `/data/pgsql.restore.<stamp>` 与 `/data/conf/costra-primary-recovery.state`。反向 basebackup 不指定永久槽，也不带 `-R`；`pg_verifybackup` 必须早于 recovery 配置清理。

#### 2. 停止来源 standby，删除临时安全组，再执行 `activate`

候选验证成功后，先在机器②停止旧 standby，并立即删除“机器① → 机器②:15433”临时安全组；新主库启动时不允许旧数据源仍在线：

```bash
# 机器②
cd /root/Costra/infra
docker compose -f docker-compose.standby.yml --env-file /data/conf/standby.env down

# 删除腾讯云临时 15433 安全组后，在机器①执行：
cd /root/Costra/infra/scripts
./recover-primary-from-standby.sh activate \
  --source-standby-stopped \
  --reverse-rule-removed
```

`activate` 会先验证 15433 已不可达，再校验候选 marker/manifest，原子归档旧 PGDATA，确认新库 `pg_is_in_recovery()=false`，重建主库复制契约，等待 API healthy，最后才恢复 cron。两阶段都可依状态文件安全续作；脚本从不删除旧 PGDATA。

#### 3. 全量重建从库

旧 standby 不得原地接回旧 timeline。先归档旧目录，再从新主库全量重做：

```bash
# 机器②
STAMP=$(date +%Y%m%d-%H%M%S)
[[ -d /data/pgsql-standby ]] && mv /data/pgsql-standby "/data/pgsql-standby.old.${STAMP}"
mkdir -p /data/pgsql-standby && chown 70:70 /data/pgsql-standby
cd /root/Costra/infra/scripts
./setup-replication-standby.sh
./check-replication.sh --container costra-standby-pg

# 机器①：最终确认槽 active、唯一 async streaming、同步候选为空
cd /root/Costra/infra/scripts && ./check-replication.sh
```

> 来源 standby 的 `standby.signal` 与 `postgresql.auto.conf` 会被复制，必须显式清除；不带 `-R` 不会自动剥离它们。`pg_verifybackup` 必须早于这些合法修改。旧 standby 全量重建用于绕开 timeline 与缺失 WAL 的复杂状态。

### §8.3 场景 C：从库故障

主库无任何感知与影响（本方案的核心理由）。从库恢复路径（全部避开 staging 栈资源）：

```bash
# 数据目录完好、主库槽未 lost：直接重启，健康检查会确认追赶状态
cd /root/Costra/infra
docker compose -f docker-compose.standby.yml --env-file /data/conf/standby.env up -d
cd scripts && ./check-replication.sh --container costra-standby-pg

# 数据目录损坏但主库槽仍可用：停止并归档旧目录，直接全量重做
cd /root/Costra/infra
docker compose -f docker-compose.standby.yml --env-file /data/conf/standby.env down
mv /data/pgsql-standby /data/pgsql-standby.corrupt.$(date +%Y%m%d-%H%M%S)
mkdir -p /data/pgsql-standby && chown 70:70 /data/pgsql-standby
cd scripts && ./setup-replication-standby.sh
```

若机器①的 `check-replication.sh` 报 `wal_status=lost`，必须先形成完整闭环，不能只清从库目录：

```bash
# 1. 机器②已 down 后，机器①显式重建 lost 槽（非 lost 时脚本不会破坏性重建）
cd /root/Costra/infra/scripts
./setup-replication-primary.sh --recreate-lost-slot

# 2. 机器②归档旧目录并重新 basebackup
cd /root/Costra/infra
mv /data/pgsql-standby /data/pgsql-standby.lost.$(date +%Y%m%d-%H%M%S)
mkdir -p /data/pgsql-standby && chown 70:70 /data/pgsql-standby
cd scripts && ./setup-replication-standby.sh

# 3. 两侧最终检查
./check-replication.sh --container costra-standby-pg
# 回机器①再执行：/root/Costra/infra/scripts/check-replication.sh
```

---

## §9 验收清单

| # | 验收项 | 命令/方法 | 预期 |
|---|---|---|---|
| 0 | 前置实测 | 机器①② `df -h /data`（①≥15G）· 机器② `nproc; free -h`（可用 ≥1G）· §2.2 路由三查 | 全部达标 |
| 1 | 主库复制配置 | `setup-replication-primary.sh` 自检输出 | replicator / 槽 / 10GB 护栏 / 内网端口绑定全就绪 |
| 2 | 从库 recovery | 机器② `docker exec costra-standby-pg ... SELECT pg_is_in_recovery()` | `t` |
| 3 | 流复制 | 机器② `pg_stat_wal_receiver.status` | `streaming` |
| 4 | 复制槽激活 | 机器① `pg_replication_slots` | `costra_standby` active=t · `wal_status=reserved` |
| 5 | 数据同步 | 两侧运行 `check-replication.sh` | 主库唯一 async/streaming；从库 latest-end/receive/replay 三段积压均在阈值内 |
| 6 | **从库宕机不影响主库** | 机器② `docker stop costra-standby-pg` → 机器① 正常记账 1 分钟 → 机器② `docker start` | 主库全程无感知；从库起后自动追平 |
| 7 | **staging + 分析栈不受从库影响** | 机器② staging 服务全链路（登录/记账/同步）冒烟 + `analytics/scripts/analyze.sh` 跑一次 | 从库起/停前后两栈行为完全一致 |
| 8 | 从库备份产出 | 机器② `COSTRA_ENV_FILE=/data/conf/standby.env ./backup-db.sh --db-only --container costra-standby-pg --prefix standby --backup-dir /data/slave/backups` | 产出 `/data/slave/backups/standby-*.sql.gz` + gzip 校验通过 |
| 9 | **备份可还原（恢复演练）** | 用最新 `standby-*.sql.gz` 执行 `infra/scripts/replay-db.sh <dump>`，抽样比对 `users`/`ledgers`/`entries` 行数 | 隔离验证库还原成功且行数吻合 |
| 10 | analytics 消费从库备份 | 机器② `analytics/scripts/analyze.sh`（不指定 `--dump`，自动取 inbox 最新） | 自动选中 `standby-*.sql.gz` 并出报告 |
| 11 | 备份新鲜度门禁 | 机器② `docker stop costra-standby-pg` 后手动跑 §5.2 那条 `check && backup` 组合 | check exit 1 → **不产出**备份文件 |
| 12 | 双侧监控与 cron | 两侧健康检查；机器① `maintenance.sh install-cron --dry-run`；机器②检查 `/etc/cron.d/costra-standby` | 健康 exit 0；两机均每小时检查；失联 exit 1 + 告警 |
| 13 | 权限边界 | 机器②尝试普通 TCP `psql -h <主库> -U costra`；机器②本地 `docker exec ... psql` | 前者被 HBA 拒绝；后者 Unix socket 可用 |
| 14 | 主库日常发布 | 机器① `./redeploy.sh`（常规发布流程） | 不触发 postgres recreate · 复制不断 |

> **验收项 6 是本方案最核心的验收**：用真实操作证明"从库无论如何故障，主库都零影响"。
> **验收项 9 同样不可跳过**：只验证"备份能产出"而不验证"备份能还原"，整个备份体系仍处于未验证状态。
> **验收项 11** 用来证明"复制坏掉时不会继续产出看似正常的陈旧备份"，是防静默劣化的关键验收。

---

## §10 回滚（不再需要从库时）

```bash
# ── 机器② · 拆从库（staging 栈全程不受影响）──
cd /root/Costra/infra
docker compose -f docker-compose.standby.yml --env-file /data/conf/standby.env down
mv /data/pgsql-standby /data/pgsql-standby.retired.$(date +%Y%m%d)   # 保留数据 · 确认无用后删除
rm -f /etc/cron.d/costra-standby /data/conf/standby.env

# ── 机器① · 清复制配置 ──
docker exec costra-postgres psql -U costra -d costra -c \
  "SELECT pg_drop_replication_slot('costra_standby');"
docker exec costra-postgres psql -U costra -d costra -c "DROP ROLE replicator;"
sed -i '/^# BEGIN COSTRA MANAGED REPLICATION$/,/^# END COSTRA MANAGED REPLICATION$/d' \
  /data/pgsql/pg_hba.conf
# 删除 server.env 中 REPLICATOR_PW / PG_PRIMARY_LAN_IP / PG_STANDBY_LAN_IP 三行
docker exec costra-postgres psql -U costra -d costra -c "SELECT pg_reload_conf();"

# 重装主库 maintenance cron（REPLICATOR_PW 删除后会自动移除 replication-check）
cd /root/Costra/infra/scripts && ./maintenance.sh install-cron

# compose 还原（git revert 本次 compose 变更）后 recreate 一次：
cd /root/Costra/infra
docker compose -f docker-compose.prod.yml --env-file /data/conf/server.env up -d postgres
# server.env 中 REPLICATOR_PW / PG_PRIMARY_LAN_IP / PG_STANDBY_LAN_IP 应删除
```

---

## §11 推荐落地顺序（稳妥路径）

0. **前置实测**（§9 验收项 0）：机器①② `df -h /data`、机器② `nproc; free -h; ss -tlnp`、§2.2 路由三查。
1. **机器②（staging 机器 + 分析机）确认**：staging 栈与分析栈运行正常 → 确认 `/data/conf/server.env` 未被污染 → 从模板创建独立 `standby.env`（§2.4）。
2. **机器① env**：追加复制三项（§2.3）→ `git pull`（§3.1）。
3. **机器① 主库配置**：低峰窗口 `./setup-replication-primary.sh --apply-compose`（一次重启）→ 自检（§3.2）。
4. **机器② 从库搭建**：`./setup-replication-standby.sh` → 验证 streaming（§4）。
5. **验收**：按 §9 全项过一遍，重点验收项 6（从库宕机主库无感）+ 项 7（staging/分析栈不受影响）+ 项 9（备份可还原）。
6. **备份 + 双侧监控**：机器①重跑 `maintenance.sh install-cron`，机器②装 §5.2 cron；两机安装 logrotate → 配告警 → 观察一周 lag 与 `wal_status`。
7. **归档**：把 §8 恢复手册转存团队运维手册/密码管理器备注（含 REPLICATOR_PW 与 standby.env 的存放位置）。

---

## §12 日常运维命令变化对照

从库上线**不改变任何既有运维习惯**。这张表用来回答"装了从库之后，我平时敲的命令要不要变"：

| 场景 | 从库上线前 | 从库上线后 |
|---|---|---|
| 机器① 日常启动整栈 | `05-start-stack.sh` / `docker compose -f docker-compose.prod.yml up -d` | **完全不变** |
| 机器① 日常发布 | `redeploy.sh` | **完全不变**（compose 定义已稳定，不再触发 postgres recreate → 复制不断） |
| 机器① server/redis/nginx | — | **完全不变**（复制是 PG 层的事，server 仍连 compose service name `postgres`） |
| 机器① migration | `06-migrate.sh` | **不变**（只在主库跑，DDL 经 WAL 自动到从库） |
| 机器① 备份 | `maintenance.sh backup`（cron 27 分 · DB + avatars） | DB 备份迁从库；prod 不再跑定时备份（`backup-avatars` 亦随头像 COS 化于 2026-10-17 退役）；`backup` 入口仍可手动执行 |
| 机器② 备份 | 无 | `install-standby-cron.sh` 幂等安装：check && backup 组合 cron（27 分 · 落 `/data/slave/backups`） |
| 机器① 监控 | 无复制监控 | `maintenance.sh install-cron` 在复制三件套完整时加入 `replication-check` |
| 机器① 一次性变更 | — | ① `--apply-compose` 首次落地 ② 日常重跑不旋密 ③ lost 槽与密码轮换分别用显式 flag |
| 机器② 从库启动 | 无 | ① `setup-replication-standby.sh`（一次性 basebackup）② 之后 `docker compose -f docker-compose.standby.yml --env-file /data/conf/standby.env up -d`（**不 initdb、不 migrate**） |
| 机器② staging 栈 / 分析栈 | 各自既有命令 | **完全不变**（project / 容器 / 目录 / 端口 / env 六维隔离，见 §2.1） |

### §12.1 复制密码轮换（非日常操作）

主库脚本重跑默认**不修改**既有 replicator 密码，避免让从库 PGDATA 内 passfile 静默失效。确需轮换时按以下顺序，且两机使用同一个新值：

1. 机器②只更新 `/data/conf/standby.env`；**不要手改 PGDATA**。执行 `setup-replication-standby.sh --repair-existing --prepare-credentials-only`：运行中 standby 的数据文件早已偏离初始 manifest，因此该模式故意不跑 `pg_verifybackup`、不改 recovery config，只确认现有 `primary_conninfo` 已引用持久 passfile，再以旧文件回滚保护原子预置新 `.replication.pgpass`，且不重启当前连接。
2. 机器①更新 `/data/conf/server.env`，执行 `setup-replication-primary.sh --rotate-replicator-password`；脚本把不可回滚的 `ALTER ROLE ... PASSWORD` 延后到槽/HBA 全部 preflight 通过之后。若此步失败且主库密码未提交，应立即把两机 env 恢复旧值，并重跑机器② `--repair-existing --prepare-credentials-only` 还原旧 passfile。
3. 机器②短暂执行 `docker restart costra-standby-pg`，再运行从库 `check-replication.sh`；只有 walreceiver 自动恢复 streaming 才证明新凭据有效。
4. 回机器①运行 `check-replication.sh`，确认唯一 `async/streaming`。

**为什么只需要重启一次**：`ports` 与 `command` 属 docker 层定义，改了必须 recreate 容器；而复制本身所需的一切（`replicator` 角色、物理复制槽、`pg_hba.conf` 放行）全是 **reload 级**操作，`setup-replication-primary.sh` 用 `pg_reload_conf()` 在线完成。所以首次方案对主库的侵入 = 一次秒级重启。密码轮换时重启的是 standby，用来验证新凭据重连。

---

## §13 决策记录：为什么不做同步复制（含未来升级路径）

> 本节保留自已删除的 `pg-replication-setup.md`（2026-07-08）。那份方案设计的是**同步提交 + 从库故障手动降级 + 手动 promote**，评估后未执行。记录在此，避免将来重复讨论或误以为"漏做了同步"。

### §13.1 为什么放弃同步复制

同步复制（`synchronous_standby_names = 'FIRST 1 (costra_standby)'`）的收益是 **RPO = 0**：主库 commit 必须等从库确认 WAL 落盘，故障时零数据丢失。代价是：

- **主库写入路径上多了一台机器**。从库宕机 / 网络抖动 / 磁盘卡顿，主库的每个 `COMMIT` 都会**无限期阻塞**，直到从库恢复或人工降级。记账写入直接不可用。
- 这与需求红线**"从库绝不反向影响主库，从库宕机主库要照常工作"**正面冲突。
- 原方案为此配了降级脚本（`maintenance.sh sync-degrade/sync-restore`，在线 `ALTER SYSTEM` 改 `synchronous_standby_names` 后 reload）。但降级本身需要人在场、需要监控先发现——在人未响应的那几分钟里，服务已经写不进去了。
- 备选的 quorum 方案（`ANY 1 (s1, s2)` + 两台从库）能同时保住 RPO=0 和可用性，但要再加一台机器，对当前规模（DAU < 100）明显过度。

**结论**：本方案选异步。代价是 RPO = lag 窗口（常态亚秒~秒级），已在需求中明确接受；换来的是"从库怎么坏都不影响主库"这个硬保证。

### §13.2 若将来要升级为同步，需要做什么

前提条件（缺一不可）：① 已有第二台从库（否则单从库同步 = 单点阻塞主库）；② lag 监控与告警已稳定运行一段时间；③ 已完成降级演练。

改动点：

1. **`synchronous_standby_names` 绝不能写进 compose 的 `command`**。降级/恢复需要在线改这个参数，而 `command` 里的 `-c` 参数优先级高于 `ALTER SYSTEM`，两者会打架。正确做法是用 `ALTER SYSTEM SET` 设置，让 `postgresql.auto.conf` 成为该参数的唯一事实源：
   ```sql
   ALTER SYSTEM SET synchronous_standby_names = 'ANY 1 (costra_standby, costra_standby2)';
   SELECT pg_reload_conf();
   ```
   > 对比：`max_slot_wal_keep_size=10GB` 写在 `command` 里是安全的——它是静态护栏，从不需要在线调整。**判据：需要在线改的参数走 `ALTER SYSTEM`，永不变的护栏走 `command`。**
2. `application_name` 必须与 `synchronous_standby_names` 里的名字**逐字匹配**，否则同步不生效而主库看起来一切正常（静默失效）。本方案的 `pg_basebackup -d "application_name=costra_standby"` 已经满足，不用改。
3. 验证判据从 `state='streaming'` 变为 `sync_state='sync'`（查 `pg_stat_replication`），`check-replication.sh` 需相应扩展。
4. 必须先异步跑通、再切同步：异步阶段即使配置有误也不会阻塞主库写入，这是把首次落地风险降到最低的关键顺序。
5. 需要补降级机制（`sync-degrade` / `sync-restore`）与**自动**降级触发条件，而非纯手动。

### §13.3 同时被放弃的两项（一并记录）

- **promote / 故障切换**：需求定案"主库宕机 = 服务不可用（接受）"，故不做 promote、不做应用侧切库。本方案的恢复路径是 §8「修好主库 / 从从库反向重建主库」。
- **`pg_rewind`**（主库故障恢复后作为从库重新挂回，避免全量 basebackup）：它要求主库开启 `wal_log_hints=on` 或数据校验和，当前 `docker-compose.prod.yml` **两者都没开**。本方案数据量小，§8 一律走"全量重做"，比 rewind 更可靠且无需改主库配置。若将来数据量增长到全量 basebackup 不可接受，再评估开 `wal_log_hints`（需一次重启）。
