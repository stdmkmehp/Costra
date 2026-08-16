# Costra · prod bootstrap 脚本集（v1.5.1）

> 把 [`prod-bootstrap-compose.md`](../prod-bootstrap-compose.md) v1.5.1 全流程脚本化 · 60-90 min 手动操作 → 5-10 min 一键部署。
>
> **设计原则**：每个脚本独立可跑 + 幂等 + 失败时给出回退指引 + 关键决策点参数化。

---

## 目录结构

```
infra/scripts/
├── README.md                  # 本文件
├── deploy-all.sh              # ⭐ 主入口（编排 9 步）
├── lib/
│   ├── common.sh              # 公共库（日志 / 交互 / 密码生成 / 校验）
│   └── mail.sh                # 邮件公共库（curl SMTPS → QQ · 见 docs/ops/mail-notification.md §3）
├── 01-preflight.sh            # 前置检查（OS / Docker / 端口 / DNS）
├── 02-prepare-dirs.sh         # 建目录 + chown（修 redis 权限坑）
├── 03-generate-env.sh         # 生成密码 + 写 server.env
├── 04-build-server.sh         # build server 镜像
├── 05-start-stack.sh          # pull 镜像 + 起 3 服务 + 等 healthy
├── 06-migrate.sh              # 跑 migrations（dump→migrate→verify）
├── 07-issue-cert.sh           # 签证书 + sed 取消 SSL 注释
├── 08-finalize-nginx.sh       # nginx -t + up nginx + cron 续期
├── 09-verify-gates.sh         # 闸门 5 条验证
│
├── redeploy.sh                # ⭐ 安全重部署（备份镜像 + 构建 + migration +回滚）
├── backup-db.sh               # DB/avatars 备份（pg_dump + gzip · 支持主/从库目标 · 原子发布 + flock）
├── import-holidays.sh         # 节假日 JSON → workday_calendars 表（--target prod|verify · 幂等 upsert）
├── migrate-ledger-asset.sh    # 停服迁移 · 账本资产回填（--target prod|verify · --verify 仅校验 · 幂等）
├── maintenance.sh             # ⭐ 主库定时任务入口（backup-avatars / replication-check / purge-* / error-report / perf-*）
│
├── setup-replication-primary.sh  # PG 主库流复制配置（机器① · 幂等 · 见 pg-standby-backup 方案）
├── setup-replication-standby.sh  # PG 从库搭建（机器② · pg_basebackup + hot standby）
├── install-standby-cron.sh       # 从库 cron 安装（机器② · check + backup 组合 · 幂等）
├── recover-primary-from-standby.sh # 双阶段反向恢复主库（prepare / activate / status）
├── check-replication.sh          # PG 主从复制健康检查（cron · 异常 exit 1 + 企业微信告警）
├── report-error-logs.sh          # /data/logs ≥error 级日志每日扫描 + 邮件推送（offset 增量 · 见 mail-notification.md）
├── monitor-perf.sh               # 宿主机性能采集（每小时 TSV）+ 24h/7d 汇总邮件（每日 · 复用 report.env）
└── apply-host-tuning.sh          # 宿主机内核参数（sysctl + THP · status/apply/revert · 幂等）
```

> 宿主机侧配置源文件统一放 `infra/host/`（`sysctl-99-costra.conf` / `disable-thp.service`），
> 与 `infra/logrotate/costra-ops` 同一模式：仓库是事实源，由脚本 `install` 到系统路径，机器上不手改。

---

## 运维定时任务（maintenance.sh · 日常）

> 与一次性 bootstrap（9 步）不同，`maintenance.sh` 是**长期运行的定时任务统一入口**：crontab 只调它，用子命令区分。详见 [`docs/db/maintenance-cron-plan.md`](../../docs/db/maintenance-cron-plan.md)。

```bash
# 一次性：生成 /etc/cron.d/costra-maintenance（用 ${COSTRA_ROOT} 展开真实路径）
./maintenance.sh install-cron          # 先 --dry-run 预览

# 手动执行（cron 亦调这些）：
./maintenance.sh backup                # 全量 DB+avatars（仅手动 · DB 备份职责已迁从库）
./maintenance.sh backup-avatars        # 仅打包 avatars（prod cron 唯一备份任务）
./maintenance.sh replication-check     # 配置复制后检查槽/WAL/纯异步状态
./maintenance.sh purge-idempotency     # 清过期幂等键（每日 · 过期 +30 天审计保留）
./maintenance.sh purge-sessions        # 清已过期 session（每日 · 过期 +30 天审计保留）
./maintenance.sh purge-invites         # 清过期邀请（每日 · 过期 +30 天审计保留）
./maintenance.sh purge-all             # 顺序跑全部 purge
./maintenance.sh error-report          # 扫 /data/logs ≥error 级日志并邮件推送（每日 05:17 · 零命中发平安邮件作心跳 · 需 /data/conf/report.env 配 SMTP_*）
./maintenance.sh error-report --test-send   # 通道冒烟：跳过扫描发一封测试邮件（465 出站验证）
./maintenance.sh perf-collect          # 采集一行宿主机性能（每小时 03 分 · 落 /data/logs/maintenance/perf-metrics.log）
./maintenance.sh perf-report           # 汇总最近 24h 逐时/峰值 + 7 天日均与平均变化并邮件推送（每日 05:13 · 复用 report.env）
./maintenance.sh list                  # 列出可用任务

# 预览不改（purge 跑 SELECT count 预览将删行数）：
./maintenance.sh purge-idempotency --dry-run
```

清理任务依赖 migration `0009_session_index_fix.sql`（把 `idx_user_sessions_expires` 改为无谓词，使 `purge-sessions` 走索引而非全表扫）。

---

## 节假日数据导入（import-holidays.sh · 每年）

> 每年底国务院发布下一年放假安排后，跑 `fetch-holidays.mjs` 生成 JSON → 提交仓库 → 部署时用 `import-holidays.sh` 导入 DB。详见 [`workday-recurring-tech-spec.md`](../../docs/design/workday-recurring-tech-spec.md) §11。

```bash
# 先用开发机跑 fetch（不操作 DB）
node scripts/fetch-holidays.mjs 2027

# verify 隔离库验证导入效果
./import-holidays.sh 2027

# 导入 prod（高危 · 强制 confirm · 建议先 backup-db.sh）
./import-holidays.sh --target prod 2027

# 一路 yes（CI / 已确认场景）
./import-holidays.sh --target prod 2027 -y

# 只看会跑什么
./import-holidays.sh --dry-run
```

| 参数 | 含义 |
|---|---|
| `--target prod\|verify` | 目标容器（默认 verify） |
| `--dry-run` | 只打印不执行 |
| `-y` / `--yes` | 跳过 confirm（prod 慎用） |
| 位置参数 `2027` | 指定年份（可多个 · 默认全部） |

---

## PG 从库（异步流复制 · 备份 · 只读）

> 方案文档：[`docs/ops/pg-standby-backup.md`](../../docs/ops/pg-standby-backup.md)。机器①由 `maintenance.sh install-cron` 安装主库槽/WAL检查；机器②由 `install-standby-cron.sh` 安装从库新鲜度门禁与备份 cron。

```bash
# 机器①（主库）：低峰窗口执行 · 唯一一次 PG recreate
./setup-replication-primary.sh --apply-compose

# 机器②（从库）：一次性搭建（basebackup + 启动 hot standby）
./setup-replication-standby.sh

# 日常：健康检查（主库/从库机器均可跑 · cron 每小时）
./check-replication.sh
```

| 脚本 | 机器 | 次数 | 说明 |
|---|---|---|---|
| `setup-replication-primary.sh` | ① | 一次性/恢复 | replicator（重跑不旋密）+ slot + managed HBA + 异步断言；lost 槽和密码轮换均需显式 flag |
| `setup-replication-standby.sh` | ②（staging） | 首次/修复 | 空目录 basebackup；repair 复验 manifest 并重建身份；凭据预置模式只原子换 passfile、不重启 |
| `install-standby-cron.sh` | ②（staging） | 一次性/变更 | 幂等写 `/etc/cron.d/costra-standby`（check && backup 组合 · 落 `/data/slave/backups`）+ logrotate；防呆校验容器与 standby.env |
| `recover-primary-from-standby.sh` | ① | 灾难恢复 | `prepare/activate/status` 双阶段持久状态；候选验证、来源停机门禁、PGDATA 可续作切换 |
| `check-replication.sh` | ①/② | cron | 主库查 slot/WAL/async；从库查 latest-end→receive→replay；webhook 同时验 HTTP 与 `errcode` |

> 机器② = staging 机器 + 分析机（三栈并存）：从库与 staging 栈、分析栈资源全面错开（project `costra-standby` / 容器 `costra-standby-pg` / 数据 `/data/pgsql-standby` / 端口 `15433`，注意分析栈占 `15432` 仅差 1 / env `standby.env`），详见方案 §2.1。**严禁**用 prod 的 `server.env` 覆盖 staging 的 `server.env`。

从库备份（落分析栈的 `DUMP_INBOX`，analytics 链路即时打通）：

```bash
COSTRA_ENV_FILE=/data/conf/standby.env ./backup-db.sh --db-only \
  --container costra-standby-pg --prefix standby --backup-dir /data/slave/backups
```

机器②不保存 `PG_COSTRA_PW`；备份与检查均走容器内 Unix socket。`backup-db.sh` 以 `flock` 防重入，先写隐藏 partial，校验后原子发布 `0600` 最终文件。cron 必须用 `check-replication.sh && backup-db.sh` 串联，见方案 §5.2。

---

## 宿主机内核参数（apply-host-tuning.sh · 一次性 + 按需体检）

> 基线文档：[`docs/ops/host-kernel-tuning.md`](../../docs/ops/host-kernel-tuning.md)。
> 判据是**"在宿主机设了是否有效"**：绝大多数网络栈 sysctl 是 per-netns 的，compose 默认
> bridge 下宿主机调它们对业务链路无效。最终只落 5 项 + 关 THP（`swappiness` /
> `dirty_ratio` / `dirty_background_ratio` / `default_qdisc=fq` / `tcp_congestion_control=bbr`）。
> 全程不 recreate 容器，无服务中断窗口。

```bash
# 只读体检（默认任务）· 逐项对比期望值/生效值 + 覆盖冲突 + THP + bbr 可用性
./apply-host-tuning.sh status

# 预览将做什么（含会从哪个文件删掉哪些冲突 key）
./apply-host-tuning.sh apply --dry-run

# 执行（bbr 前置检查 → 安装 conf → 清冲突 → sysctl --system → THP unit → 校验）
./apply-host-tuning.sh apply

# 回滚（移除 Costra 管理的配置 · 冲突文件备份需人工挑选回填）
./apply-host-tuning.sh revert
```

| 任务 | 作用 |
|---|---|
| `status` | 只读；退出码 `0`=全符合期望 / `1`=有偏差。含**三层验证**：配置层 + 运行层（`tc qdisc`、`lsmod`、`nsenter` 查 nginx 容器 netns 算法）+ 持久层 |
| `apply` | 7 步幂等：bbr preflight → 安装 → 清覆盖冲突 → `sysctl --system` → `tc qdisc replace` → THP unit → 校验 |
| `revert` | 移除 `99-costra.conf`、`disable-thp.service`、`modules-load.d/costra-bbr.conf` |

**期望值、冲突 key、bbr 前置检查都从 `infra/host/sysctl-99-costra.conf` 自动解析**，
不维护第二份清单：往 conf 加参数后校验与清理自动跟随，无需改脚本。清理只删**同名** key，
机器上其他既有设置（`tcp_max_tw_buckets` / `tcp_slow_start_after_idle` / `gc_thresh3` /
`sysrq` / `printk` / IPv6 开关）原样保留。

> ⚠️ `sysctl --system` 按字典序加载，`/etc/sysctl.d/99-sysctl.conf` 与 `/etc/sysctl.conf`
> 排在 `99-costra.conf` **之后**，同名 key 会把我们的值覆盖回去——这就是 `apply` 第 3 步存在的原因。
>
> ⚠️ **读回 sysctl 值 ≠ 功能生效**。`default_qdisc` 只影响新建设备（已 up 网卡需
> `tc qdisc replace`）；`tcp_congestion_control` 是 per-netns 且已存在的容器 netns 不更新
> → **bbr 必须额外 `docker compose up -d nginx` recreate 一次**（nginx 已配 `sysctls:`）。
> bbr 还依赖宿主机 `modprobe tcp_bbr`，缺模块时 sysctl 值仍在但实际跑 cubic。详见基线文档 §3.5/§3.5.1。
>
> ⚠️ 机器缺 `tc` 时（精简镜像可能未装，安装 `iproute`/`iproute2`），status 的运行层 qdisc
> 检查与 apply 第 5 步会**降级跳过并提示**而非失败，qdisc 于重启后由 sysctl 值生效。
>
> ⚠️ `tcp_keepalive_time` / `somaxconn` 那类 per-netns 参数**永不继承宿主机**（用内核编译期
> 默认值），recreate 也没用，必须显式写 `sysctls:`；且需同步改 nginx `listen backlog=`。
> 当前网络栈空载故不做，触发条件见基线文档 §5.3。

---

## 停服迁移 · 账本资产回填（migrate-ledger-asset.sh · 一次性）

> 部署 migration 0012（ledgers 新增 balance_cents / balance_baseline_seq / balance_version）后，在停服窗口把所有 ledgers 的 balance 回填为历史 entries 净值。详见 [`asset-and-budget-spec.md`](../../docs/design/asset-and-budget-spec.md) §6。

```bash
# 先在 verify 隔离库演练（默认 target=verify）
./migrate-ledger-asset.sh
./migrate-ledger-asset.sh --verify          # 仅校验不回填

# 对 prod 跑（高危 · 必 confirm + 建议先 backup-db.sh）
./migrate-ledger-asset.sh --target prod
./migrate-ledger-asset.sh --target prod --verify

# 一路 yes（CI / 已确认场景）
./migrate-ledger-asset.sh --target prod -y

# 只看会跑什么
./migrate-ledger-asset.sh --dry-run
```

| 参数 | 含义 |
|---|---|
| `--target prod\|verify` | 目标容器（默认 verify） |
| `--verify` | 仅校验不回填（对比 balance_cents + baseline_seq 与 entries 净值） |
| `--dry-run` | 只打印不执行 |
| `-y` / `--yes` | 跳过 confirm（prod 慎用） |

幂等：回填后 `balance_baseline_seq` 已是 `MAX(change_seq)`，重跑 delta=0 无影响。

---

## 安全重部署（redeploy.sh · 日常更新）

> 日常更新 server代码时使用。支持**镜像备份 + 可选构建 + 可选 migration + 失败自动回滚**，确保更新失败不会对玩家数据和服务造成影响。

### 核心安全机制

1. **镜像备份**：构建新镜像前，先 `docker tag` 备份当前运行镜像（方便回滚）
2. **最小停机窗口**：构建成功后才停服务
3. **Migration 前 DB 备份**：复用 `backup-db.sh --db-only`（pg_dump + gzip + 完整性校验 · 只备份 DB · 最小化停机 · 不可跳过）
4. **失败自动回滚**：migration 失败 → 复用 `restore-db.sh --no-restart` 还原 DB → 老镜像拉起服务
5. **感知 postgres 重启**：若需重启 postgres，先启动 postgres 并等待 healthy 后再跑 migration

### 典型用法

```bash
# 最简：只重启 server（不构建 · 不跑 migration）
./redeploy.sh

# 本地构建 + 重启 server
./redeploy.sh --build-mode local

# 构建 + 跑全部 migration + 重启
./redeploy.sh --build-mode local --migrate

# 指定某几个 migration 文件
./redeploy.sh --build-mode local --migrate \
    --migration-files "server/db/migrations/0011_recurring_entries.sql"

# 从私有仓库拉镜像 + migration
./redeploy.sh --build-mode registry \
    --registry-image weizhao/costra-server:v2.0 \
    --migrate

# 需要重启 postgres 的场景（migration 会在 postgres 重启后执行）
./redeploy.sh --build-mode local --restart-psql --migrate

# 只重启 nginx（不动 server）
./redeploy.sh --restart-nginx --no-restart-server

# 自动确认（CI / 已确认场景）
./redeploy.sh --build-mode local --migrate -y
```

### 参数速查

| 参数 | 含义 |
|---|---|
| `--build-mode<local\|load\|registry>` | 构建模式（不传则跳过构建） |
| `--image-tar<path>` | load 模式：tar.gz 路径 |
| `--registry-image <full>` | registry 模式：完整镜像名 |
| `--migrate` | 启用 migration（构建后、启动前执行） |
| `--migration-files <paths>` | 指定 SQL 文件（逗号分隔 · 相对于项目根） |
| `--migration-dir <dir>` | 指定 migration 目录（默认 `server/db/migrations`） |
| `--restart-nginx` | 额外重启 nginx |
| `--restart-redis` | 额外重启 redis |
| `--restart-psql` | 额外重启 postgres |
| `--no-restart-server` | 不重启 server |
| `--timeout <seconds>` | healthy 超时（默认 90s） |

### Migration 失败回滚流程

```
Migration SQL 执行失败
  ↓
1. 调用 restore-db.sh --no-restart 还原数据库（DROP schema + 单事务恢复 + 重装扩展 + 验证）
2. docker tag 恢复老镜像
3. docker compose up -d 用老镜像拉起所有服务
  ↓
服务恢复到更新前状态 · exit 1
```

---

## 快速开始

### 全新部署（首台 prod 机器）

```bash
ssh root@<prod-ip>
cd /root/Costra/infra/scripts

chmod +x *.sh lib/*.sh

# 一键全流程
./deploy-all.sh \
    --email you@example.com \
    --build-mode local \
    --wx-app-secret '<32 字符微信 AppSecret>' \
    -y
```

### 备机 / 迁移机器（复用现有 server.env + 证书）

```bash
# 假设已经从主 prod scp 过来：
#   /data/conf/server.env       （来自主 prod · scp 过来）
#   /tmp/letsencrypt.tar.gz     （主 prod 上 tar czf - /etc/letsencrypt | scp ...）
#   /tmp/costra-server.tar.gz   （主 prod 上 docker save | gzip | scp ...）

./deploy-all.sh \
    --reuse-secrets \
    --import-cert /tmp/letsencrypt.tar.gz \
    --build-mode load \
    --image-tar /tmp/costra-server.tar.gz \
    -y
```

### 用 Docker Hub / 私有仓库

```bash
docker login   # 一次性配置

./deploy-all.sh \
    --email you@example.com \
    --build-mode registry \
    --registry-image weizhao/costra-server:v1.5.1-20260525 \
    --wx-app-secret '<32 字符密钥>' \
    -y
```

---

## 单步执行 / 调试

每个脚本都可以独立跑，调试时很有用。

```bash
# 只跑前置检查
./01-preflight.sh

# 只重做证书（保留现有部署）
./07-issue-cert.sh --use-existing

# 只重启 nginx + 重跑 cron
./08-finalize-nginx.sh

# 只跑闸门验证
./09-verify-gates.sh

# 跳过前两步（已经做过）
./deploy-all.sh --from 03 ...

# 跳过指定步骤（逗号分隔）
./deploy-all.sh --skip 01,06 ...
```

---

## 关键参数速查

### 通用（所有脚本支持）

| 参数 | 含义 |
|---|---|
| `--dry-run` | 只打印命令不执行 |
| `-y` / `--yes` | 跳过交互确认 |
| `-h` / `--help` | 显示帮助 |

### deploy-all.sh

| 参数 | 含义 |
|---|---|
| `--email <addr>` | 证书邮箱（首次签证必选） |
| `--domain <name>` | 域名（默认 costra.cloud） |
| `--reuse-secrets` | 复用现有 server.env（不重生成密码） |
| `--wx-app-secret <val>` | 微信小程序密钥（避免交互输入） |
| `--use-existing-cert` | 复用现有 /etc/letsencrypt 证书 |
| `--import-cert <tar.gz>` | 从 tar 导入证书 |
| `--build-mode <local\|load\|registry>` | server 镜像构建方式 |
| `--image-tar <path>` | load 模式：tar.gz 路径 |
| `--registry-image <full>` | registry 模式：完整镜像名 |
| `--from <01-09>` | 从指定步骤开始 |
| `--skip <01,02>` | 跳过指定步骤 |

### 03-generate-env.sh（密码相关）

| 参数 | 含义 |
|---|---|
| `--reuse-secrets` | 复用现有 server.env |
| `--pg-pw <val>` | 指定 PG 密码（避免随机生成） |
| `--redis-pw <val>` | 指定 Redis 密码 |
| `--jwt-secret <val>` | 指定 JWT 密钥 |
| `--wx-app-secret <val>` | 指定微信密钥 |

### 07-issue-cert.sh（证书相关）

| 参数 | 含义 |
|---|---|
| `--email <addr>` | 证书邮箱 |
| `--use-existing` | 复用现有证书（仅校验） |
| `--import-tar <path>` | 从 tar.gz 导入证书 |

---

## 三种典型场景

### 场景 1：新机器全新部署

```bash
./deploy-all.sh --email you@example.com --build-mode local --wx-app-secret 'xxx' -y
```

预计耗时：5-10 min（不含 `npm ci` build 时长）

### 场景 2：迁移机器（旧机器证书 + 密码 + 镜像都要复用）

#### Step 1 · 在旧机器导出资源

```bash
# 旧机器
tar czf /tmp/letsencrypt.tar.gz -C /etc letsencrypt/
scp /data/conf/server.env root@<新机器>:/data/conf/
scp /tmp/letsencrypt.tar.gz root@<新机器>:/tmp/

docker save costra-server:latest | gzip > /tmp/costra-server.tar.gz
scp /tmp/costra-server.tar.gz root@<新机器>:/tmp/
```

#### Step 2 · 在新机器一键

```bash
ssh root@<新机器>
cd /root/Costra/infra/scripts

./deploy-all.sh \
    --reuse-secrets \
    --import-cert /tmp/letsencrypt.tar.gz \
    --build-mode load \
    --image-tar /tmp/costra-server.tar.gz \
    --skip 06 \
    -y
```

> ⚠️ 注意：迁移场景已带数据 (`/data/pgsql`)，**不应再跑 06 migrate**（可能重复执行 migration 导致冲突）。
> 因此加 `--skip 06`。如果是空数据迁移，去掉这个 flag。

预计耗时：3-5 min（不需 build · 不需签证书）

### 场景 3：CI/CD 自动部署

```bash
# 假设镜像已推到私有仓库
./deploy-all.sh \
    --reuse-secrets \
    --use-existing-cert \
    --build-mode registry \
    --registry-image ${CI_REGISTRY_IMAGE}:${CI_COMMIT_SHA} \
    --skip 01 \
    -y
```

> 在 CI 已经验证过环境的情况下可以 `--skip 01`。

---

## 失败处理

### 任一步骤失败会显示

```
[ERROR]  [05] 步骤失败 · 终止部署
[ERROR]  可以单独重跑这一步：./05-start-stack.sh ...
[ERROR]  也可以 --from 05 从这一步重新开始
```

### 常见失败 → 排查指引

| 步骤 | 现象 | 排查 |
|---|---|---|
| 01 | 端口 80/443 被占用 | 看 `ss -tlnp` 谁在用，让出端口 |
| 02 | chown 失败 | 必须 root 跑（`sudo` 或 `su -`） |
| 03 | 缺 WX_APP_SECRET | 加 `--wx-app-secret <val>` 或交互式输入 |
| 04 | local build 几千秒不动 | 改用 `--build-mode load` 或 `registry` |
| 05 | redis Restarting | 99% 是 02 chown 漏做（参考手册 §8 Q8） |
| 05 | server unhealthy | `docker logs costra-server --tail 50` |
| 07 | 80 端口冲突 | 脚本自动 `rm -sf nginx`，仍冲突看其他进程 |
| 08 | dry-run 续期失败 | 检查 `/etc/letsencrypt/renewal/<domain>.conf` 是否切到 webroot |
| 09 | 闸门 1 (https/healthz) FAIL | nginx 健康但代理不通：`docker exec costra-nginx wget -qO- http://server:8080/healthz` |

详细 FAQ 见 [`prod-bootstrap-compose.md` §8](../prod-bootstrap-compose.md)。

---

## 与手册的关系

| 文档 | 角色 |
|---|---|
| [`prod-bootstrap-compose.md`](../prod-bootstrap-compose.md) | **权威文档** · 完整流程 + 决策背景 + 7 坑 FAQ |
| `infra/scripts/` (本目录) | **快速路径** · 把手册流程脚本化 |

**两者的关系**：
- 脚本失败时 → 看手册对应章节排查
- 手册改动时 → 脚本里的步骤序号也要同步
- 新手第一次部署 → 建议看一遍手册再跑脚本（理解每步在做什么）

---

## v1.5.1 沉淀的踩坑全部嵌入脚本

| 坑 | 嵌入位置 |
|---|---|
| 坑 1: `tr -d` 缺 `\n` 输出两行 | `lib/common.sh::gen_password` 强制 `\n` |
| 坑 2: 2核2G build 4000s+ | `04-build-server.sh` 内存检查 + 推荐 load/registry |
| 坑 3: redis 权限 fatal | `02-prepare-dirs.sh` 强制 chown + verify · `05-start-stack.sh` 失败时指向 §8 Q8 |
| 坑 4: tsx ESM/CJS 混用 | 已在 `server/Dockerfile` v1.5.1 修复 |
| 坑 5: localhost IPv6 | 已在 `docker-compose.prod.yml` v1.5.1 修复 |
| 坑 6: nginx restart 17 次 | `05-start-stack.sh` 只起 3 服务 · `07-issue-cert.sh` 自动 `rm -sf nginx` |
| 坑 7: cron `-T` + standalone 撞 80 | `08-finalize-nginx.sh` 加 `-T` + 自动切 webroot renewal |

---

## 修改 / 扩展脚本

### 改路径默认值

`lib/common.sh` 顶部的 `: "${COSTRA_ROOT:=...}"` 都可以通过环境变量覆盖：

```bash
COSTRA_ROOT=/opt/costra COSTRA_DOMAIN=other.com ./deploy-all.sh ...
```

### 新增步骤

1. 写 `10-xxx.sh` · 模仿 `09` 结构（顶部 source common.sh + 解析参数 + 主流程）
2. 在 `deploy-all.sh` 的 `STEPS` 数组里加一行 `"10:10-xxx.sh"`
3. 如果有特殊参数透传，在 deploy-all.sh 的 case 分支里加

---

> **维护**：v1.5.1 · 2026-05-26 · 与手册同版本号
> **测试机器**：tlinux 3.3 + Docker 24.x + docker compose v2 (49.235.216.20)
