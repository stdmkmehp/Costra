# Costra 用户行为日报分析 · 技术方案 v0.2.4

- 作者：Ops
- 日期：2026-07-21（修订：2026-08-14）
- 版本历史：
  - **v0.1（2026-07-21）**：首版 · 三轮方案讨论定稿 · 位置无关 · CLI 三参数正交 · 三 template（daily/range/weekly）· QQ SMTP · 失败邮件兜底 · 无 healthchecks 探针
  - **v0.1.1（2026-07-21）**：显式化 prod 隔离约束（新增 §0）· `run-queries.sh` 从遍历 glob 改为显式清单
  - **v0.2（2026-07-21）**：完成代码落地 · 恢复隔离由 sed 改写 schema 升级为原样恢复到一次性数据库 · 时间窗口统一为半开区间 · 增加陈旧 dump 拦截、flock、信号清理与安全文本渲染
  - **v0.2.1（2026-07-21）**：删除 scp 备份文件自动清理能力 · inbox 改为永久只读数据源 · 生命周期由外部备份策略负责
  - **v0.2.2（2026-07-24）**：将 node 运行环境移入独立 Docker 容器 · 宿主机不再需要 Node.js · 新增 `costra-analyze-node` 常驻容器（node:18-alpine + 预装 npm 依赖）
  - **v0.2.3（2026-08-04）**：宿主机入口降级为 thin wrapper · 完整分析编排迁入 analyzer 容器 · 宿主机不再需要 Node/gzip/psql · 固定工作库 `costra_report_work` 每次开头强制重建、结束清理
  - **v0.2.4（2026-08-14）**：容器改按需启停（`restart: "no"` · `analyze.sh` 跑完自动 `docker compose stop`）+ 加 `deploy.resources.limits`（PG 512M/0.5CPU · node 256M/0.5CPU），释放资源给同机 staging 栈与 standby 从库

> 本文只描述"落地实现"，覆盖目标 / 输入约定 / CLI 抽象 / 目录布局 / 主流程 / SQL 全文 / 渲染 template / 邮件通道 / 失败告警 / cron 配置 / 工作量。

---

## 0. 与 prod 的隔离约束（硬边界 · 不可违反）

本项目**完全独立于 Costra prod 部署**，不与 prod 共享任何运行时资源或工程文件。以下约束在整个方案中必须严格遵守：

### 0.1 独立的工程根

- 本项目目录（`${ANALYZE_HOME}`）**独立于 prod 部署路径** `/root/Costra`
- 建议路径：`/opt/costra-analyze`（明确与 prod 的 `/root/Costra` 完全无交叉），**不要**放到 prod 目录任何子目录中
- 不 `git clone` Costra 主仓库，仅从主仓库**复制 schema 定义参考**（本 tech-spec 已内嵌）

### 0.2 独立的 Docker 资源

- 独立的 `docker-compose.yml`（本项目根目录），**不修改也不 include** `infra/docker-compose.prod.yml`
- 独立的 compose project name（默认 = 目录名 `costra-analyze`），与 prod compose project `costra` 隔离
- 独立的容器名 `costra-analyze-pg`（与 prod 的 `costra-postgres` 完全不同）
- 独立的端口 `127.0.0.1:15432`（prod 用 5432 / 未暴露）
- 独立的 named volume `costra-analyze_analyze-pg-data`（compose project 前缀自动隔离）
- 独立的 DB 名/用户 `analyze/analyze`（prod 用 `costra/costra`）
- 只**复用 postgres:15 官方镜像**（来自 Docker Hub 公共仓库，非 prod 私有构建）
- 独立 compose 内**按需启停**：`restart: "no"` 不常驻，`analyze.sh` 跑完自动 `docker compose stop`；并设 `deploy.resources.limits` 封顶分析窗口峰值（与 staging 栈、standby 从库共机的配额见 `docs/ops/pg-standby-backup.md` §2.1）

### 0.3 独立的脚本

- 独立的 `scripts/lib/common.sh`，**不 source** `infra/scripts/lib/common.sh`
- 独立的日志目录 `/var/log/costra-analyze/`（不写入 prod 的 `/data/logs/`）
- 独立的 cron 文件 `/etc/cron.d/costra-analyze`（不修改 prod 的 `/etc/cron.d/costra` 或 `costra-*`）

### 0.4 对 prod 的唯一依赖

- **只依赖 prod scp 过来的 `.sql.gz` dump 文件**，其他一切自持
- Dump 文件到达 `${DUMP_INBOX}` 后，本项目**只读**这些文件，不修改、不重命名、不移动、**不删除**
- 备份文件的保留和清理由外部备份策略负责，不属于行为分析工具职责

### 0.5 部署验收清单

部署完成后，以下检查全部为 OK 才算隔离到位：

```bash
# 1. 目录不重叠
[[ "${ANALYZE_HOME}" != /root/Costra* ]] || die "路径与 prod 重叠"

# 2. 容器名不冲突
docker ps -a --format '{{.Names}}' | grep -qE '^costra-analyze-pg$'   # 存在
docker ps -a --format '{{.Names}}' | grep -qvE '^costra-postgres$'    # 或 prod 就没跑（在独立 host 上应该 grep -qv 直接 true）

# 3. 端口不冲突（本机监听 15432，不监听 5432）
#    ⚠️ 按需启停模式下端口仅在分析运行期间监听，此项请在运行 analyze.sh 时检查
ss -ltnp | grep -q '127.0.0.1:15432'

# 4. 日志目录独立
[[ -d /var/log/costra-analyze ]]

# 5. cron 文件独立
[[ -f /etc/cron.d/costra-analyze ]]
```

**若 analyze host 与 prod 是不同机器**（推荐 · 也是 scp 场景的天然假设），§0.5 的容器名/端口冲突检查天然通过。若两者同机（不推荐，仅 dev/测试场景），上述所有隔离约束仍然生效，因命名/端口全不同，可共存。

---

## 1. 目标与非目标

### 1.1 目标

- 在**独立于生产**的一台机器（下称 `analyze host`）上，基于 prod 每 4 小时 scp 过来的 `pg_dump` 快照，生成 Costra 用户行为日报/周报/任意区间报告，并邮件送达。
- 支持 CLI 手动触发任意时间窗回看（`--window 24h/7d/30d`、`--anchor <ISO datetime>`）。
- cron 默认每天日报 + 每周周报，脚本本体对"当前时刻"无感知，触发方式与分析窗口彻底解耦。
- 所有可读输出禁止出现 UUID，只出昵称/账本名/分类名；账本带 `[家庭]/[个人]` 徽标；分类带父子路径。
- **少则全展、多则截断 + 统计**：阈值内条目全列，超阈值列前 N + 分维度统计。
- 失败不静默：脚本失败或未取到 dump，均发告警邮件；主邮件 subject 内嵌 dump 时间戳。
- **位置无关**：所有路径进 `.env`，脚本可在任意 Linux/Mac 机器部署。

### 1.2 非目标

- 不做实时（分钟级）分析——用 dump 已经天然滞后 0~4 小时。
- 不做 web dashboard——纯文件 + 邮件。
- 不做数据仓库（星型模型/宽表）——直接从 prod dump 恢复的原始 schema 上跑 SQL；规模足够小（MB 级），无需预聚合。
- 不做多用户分发/权限——收件人一人，硬编码在 `.env`。
- 不做实时告警（推送/短信）——邮件已足够，SMTP 出站全断的场景（预估 <10%）接受"隔几天翻日志"兜底（用户明确决定不接 healthchecks.io）。

---

## 2. 输入约定与假设

### 2.1 Prod 侧（不改动）

- `backup-db.sh` cron `17 1,5,9,13,17,21 * * *` 每 4 小时生成 `/data/backups/scheduled-YYYYMMDD-HHMMSS.sql.gz`
- 生成后 `scp` 到 analyze host 目录（下称 `${DUMP_INBOX}`），保留 14 天
- Dump 是 `pg_dump -U costra -d costra --no-owner --no-acl` 的 gzip 输出（明文 SQL）

### 2.2 Analyze host 侧的假设

- 宿主机只需要 Docker + Docker Compose；**不需要 Node.js / npm / gzip / psql**。
- `costra-analyze-node` 容器内置 `bash + gzip + postgresql-client + Node.js`，完整分析编排都在该容器中执行。
- `costra-analyze-pg` 容器仅提供 PostgreSQL；每次分析通过 service name `postgres` 连接。
- `${DUMP_INBOX}` 目录中始终至少有一份最近 24 小时内的 `.sql.gz`；若为空，脚本告警邮件并 exit 0（不算失败）

### 2.3 Schema 假设

**核心表 & 字段**（来自 `server/db/migrations/0001_init.sql`）：

| 表 | 关键字段 | 分析用途 |
|---|---|---|
| `users` | id, nickname, has_completed_profile, created_at, deleted_at | 新增用户 · 昵称展示 |
| `families` | id, name, kind, owner_id, created_at, deleted_at | 账本徽标（`kind=personal/shared`）· owner nickname |
| `family_members` | family_id, user_id, role, joined_at, left_at | family scope（暂未用于日报，保留） |
| `family_invites` | id, family_id, inviter_id, used_at, used_by, created_at | 邀请转化 |
| `ledgers` | id, family_id, name, created_at, deleted_at | 账本名 · 归属家庭 |
| `entries` | id, ledger_id, amount, currency, type, shared_type, category_id, occurred_at, created_by, created_at, deleted_at | 新增记账（切片维度：type、shared_type、ledger、created_by、category）|
| `categories` | id, name, parent_id | 分类名 · 父子路径 |

**时间语义**：所有 `created_at` 是录入时刻，`TIMESTAMPTZ`；分析统一用 `created_at`（不用 `occurred_at`），因为"用户行为日报"关心的是**"什么时候被录入系统"**而不是"发生在哪天"。

**时区**：SQL 一律 `AT TIME ZONE 'Asia/Shanghai'`，避免 UTC 造成的跨零点漂移。

---

## 3. CLI 抽象

### 3.1 三参数正交模型

脚本的输入永远是 3 件事（不管 cron 触发还是手动跑），彼此正交：

| 参数 | 含义 | 默认 |
|---|---|---|
| `--dump <file>` | 用哪份 dump 做数据源 | `${DUMP_INBOX}` 内 mtime 最大的 `.sql.gz` |
| `--window <duration>` | 分析回看多久 | `24h` |
| `--anchor <ISO>` | 分析窗口右端 | `--dump` 文件的 mtime |

**分析窗口** = `[anchor - window, anchor)`（左闭右开），SQL 用 `:window_start` / `:window_end` 两个 `TIMESTAMPTZ` 参数过滤。半开区间可以避免连续补跑的相邻报告重复统计边界记录。

**Duration 字面量**：`24h / 7d / 30d / 168h / 15m`，由 `lib/parse-args.sh` 用简单正则解析（`^([0-9]+)(m|h|d)$`）成毫秒数。

### 3.2 CLI 示例

```bash
# 默认：最新 dump · 最近 24h · anchor=dump mtime
./analyze.sh

# 最近 7 天（当天最新 dump）
./analyze.sh --window 7d

# 回看 2026-07-15 那天（24h 窗口，右端为 anchor）
./analyze.sh --window 24h --anchor 2026-07-15T23:59:00+08:00

# 完整指定
./analyze.sh --dump /var/lib/costra-analyze/inbox/scheduled-20260721-2117.sql.gz \
             --window 24h \
             --anchor 2026-07-21T21:17:23+08:00

# stdout 模式（MAIL_TO=PLACEHOLDER 时自动进入 · 或显式 --stdout）
./analyze.sh --stdout
```

### 3.3 参数解析规则

- 三参数完全可组合，任何一个都可省略；
- `--anchor` 不指定时从 `--dump` 的 mtime 派生；`--dump` 不指定时挑目录最新；
- Duration ≥ 7d 时渲染层走 weekly template；2d~6d 走 range；< 2d 走 daily；
- `--stdout` 强制打印到 stdout 不发邮件（用于验收和调试）；
- `MAIL_TO` 值以 `PLACEHOLDER` 开头时**自动进入 stdout 模式**（渐进式验收）；
- `-h/--help` 输出参数说明。

---

## 4. 目录布局

**位置无关**——所有路径通过 `.env` 配置。下面是**建议布局**（可整体挪到任意目录）：

```
${ANALYZE_HOME}/                       # 建议 /opt/costra-analyze · 不放 prod 目录任何子目录（见 §0.1）
├── docker-compose.yml                 # 独立 PG + analyzer 双容器 · 不复用 prod compose（§0.2）
├── Dockerfile.analyzer                # node + bash + gzip + postgresql-client
├── .env                               # 全部配置（chmod 600 · gitignore）
├── .env.example                       # checked-in
├── package.json                       # node 依赖：nodemailer + marked
├── scripts/
│   ├── analyze.sh                     # 宿主机 thin wrapper：compose up + exec analyzer
│   ├── analyze-in-container.sh        # 容器内真实分析入口
│   ├── lib/
│   │   ├── common.sh                  # log_step/log_info/die，独立实现，不 source infra/scripts/lib
│   │   └── parse-args.sh              # --dump/--window/--anchor/--stdout/-h
│   ├── pick-dump.sh                   # 挑 dump（默认最新 · 支持指定）
│   ├── restore-database.sh            # gunzip | psql -h postgres → costra_report_work
│   ├── run-queries.sh                 # 按 SQL_FILES 显式清单跑 · 不做 glob 遍历（§5.4）
│   ├── render.mjs                     # csv → template → md（daily/range/weekly）
│   ├── send-mail.mjs                  # md → html → SMTP
│   └── send-failure-mail.mjs          # 独立失败告警邮件（trap 调用）
├── sql/
│   ├── 10-summary.sql
│   ├── 20-new-users.sql
│   ├── 30-new-ledgers.sql
│   ├── 40-new-entries.sql
│   ├── 50-new-invites.sql
│   ├── 60-active-users.sql            # DAU
│   └── 90-anomaly.sql
├── templates/
│   ├── daily.mjs                      # < 2d 窗口
│   ├── range.mjs                      # 2d ≤ window < 7d
│   ├── weekly.mjs                     # ≥ 7d 窗口 · 含 sparkline
│   └── common.mjs                     # 表格/数字/金额格式化辅助
├── config.mjs                         # 阈值 5/5/20/5/8 · 截断规则
└── reports/
    ├── daily/2026-07-21.md
    ├── weekly/2026-W29.md             # ISO 周编号
    └── range/2026-07-01_2026-07-31.md
```

### 4.1 `.env` 全量字段

```ini
# ─── 路径 ─────────────────────────────
DUMP_INBOX=/data/slave/backups           # prod scp 落点 · 只读挂载进 analyzer
REPORTS_DIR=/data/analyze/report         # 报告输出目录
LOG_DIR=/data/logs/analyze               # 运行日志目录

# ─── PG / 容器 ────────────────────────
PG_CONTAINER=costra-analyze-pg           # 宿主机 wrapper 兼容字段
NODE_CONTAINER=costra-analyze-node
PG_DB=analyze
PG_USER=analyze
PG_PASSWORD=<random-32chars>
REPORT_DB=costra_report_work             # 固定工作库 · 每次分析强制重建

# ─── SMTP (QQ 邮箱) ───────────────────
SMTP_HOST=smtp.qq.com
SMTP_PORT=465
SMTP_USER=<QQ号>@qq.com
SMTP_PASS=<QQ授权码 16位>
MAIL_FROM=<QQ号>@qq.com
MAIL_TO=PLACEHOLDER@example.com          # 用户后期填真实邮箱
MAIL_CC=                                 # 空

# ─── 阈值覆盖（可选 · 留空用 config.mjs 默认）
THRESHOLD_USERS=
THRESHOLD_LEDGERS=
THRESHOLD_ENTRIES=
THRESHOLD_INVITES=
THRESHOLD_ACTIVE=
```

`.env.example` 是 checked-in 版本，`.env` 由用户 `cp && vim` 生成，`chmod 600`，`.gitignore` 排除。

---

## 5. 主流程

### 5.1 主流程

**宿主机 `scripts/analyze.sh` 仅做 thin wrapper**：
1. 加载 `.env`，创建 `DUMP_INBOX / REPORTS_DIR / LOG_DIR`；
2. `docker compose up -d --build postgres analyzer` 按需启动两个容器（`restart: "no"`，不常驻）；
3. `docker compose exec -T analyzer bash /app/scripts/analyze-in-container.sh "$@"` 进入容器执行真实分析；
4. 无论成败（含 Ctrl+C / SIGTERM）`docker compose stop postgres analyzer` 释放 CPU/内存——由 trap `EXIT/INT/TERM` 保证执行。

**容器内 `scripts/analyze-in-container.sh` 负责完整编排**：
1. 读取 `/app/.env`，创建 `/tmp/costra-analyze/<run>` 和日志文件；
2. `pick_dump` 从 `${DUMP_INBOX}` 选择快照；
3. 固定工作库 `costra_report_work`：开头 `DROP DATABASE IF EXISTS ... WITH (FORCE)` + `CREATE DATABASE`；
4. `gunzip -c dump | psql -h postgres -d costra_report_work` 原样恢复；
5. 显式执行 7 个 SQL → CSV → render.mjs → `${REPORTS_DIR}`；
6. stdout 或 QQ SMTP；成功/失败/信号中断都 DROP 工作库并删除 `/tmp`。

### 5.2 `pick-dump.sh` 逻辑

- 若 `--dump` 已指定：检查存在性、可读性和 `.sql.gz` 后缀；允许历史快照，但超过 48 小时会打印警告。
- 否则从 `${DUMP_INBOX}` 按 mtime 选择最新 `.sql.gz`，Linux/macOS 都使用 tab 分隔时间和路径，支持路径含空格。
- 自动模式无文件或最新文件超过 48 小时：发送无 dump 告警，设置 `NO_DUMP=1`，主脚本正常退出且不生成报告。
- 成功输出 `DUMP_FILE / DUMP_MTIME_EPOCH / DUMP_MTIME_ISO`。

### 5.3 `restore-database.sh` 逻辑 · **关键点**

每次运行都重建固定工作库 `costra_report_work`，并将 dump **原样**恢复：

```bash
psql -h postgres -U "${PG_USER}" -d "${PG_DB}" \
  -c "DROP DATABASE IF EXISTS costra_report_work WITH (FORCE);"
psql -h postgres -U "${PG_USER}" -d "${PG_DB}" \
  -c "CREATE DATABASE costra_report_work OWNER ${PG_USER};"

gunzip -c "${DUMP_FILE}" \
  | psql -h postgres -U "${PG_USER}" -d costra_report_work \
      -v ON_ERROR_STOP=1 --quiet
```

**为什么不用 sed 改写 schema**：SQL dump 的 `COPY` 数据里可能合法出现 `public.`，文本替换会修改真实业务数据；固定工作库能完整保留 dump 内容，并保证每次分析都从空库重建。恢复后查询 `users/families/ledgers/entries/categories` 五张核心表做 sanity check；成功、失败、`SIGINT`、`SIGTERM` 都执行 `DROP DATABASE ... WITH (FORCE)`。

### 5.4 `run-queries.sh` 逻辑（显式清单 · 不做 glob 遍历）

**设计要点**：`sql/` 目录和 `render.mjs` 已经存在隐式契约（缺文件 → render 崩、多文件 → render 忽略），"遍历目录"是**幻觉的通用性**。改为**显式清单**——新增 SQL 必须同步声明，让契约显式：

```bash
#!/usr/bin/env bash
set -Eeuo pipefail

# SQL 显式清单 · 顺序即执行顺序
# ⚠️ 新增查询时：
#   1. 在 sql/ 目录添加 <name>.sql 文件
#   2. 在此清单追加 <name>
#   3. 在 render.mjs 消费 ${name}.csv
# 缺一步则 die，不接受隐式约定
SQL_FILES=(
  "10-summary"
  "20-new-users"
  "30-new-ledgers"
  "40-new-entries"
  "50-new-invites"
  "60-active-users"
  "90-anomaly"
)

for name in "${SQL_FILES[@]}"; do
  sql_file="${ANALYZE_ROOT}/sql/${name}.sql"
  [[ -f "${sql_file}" ]] || die "SQL 缺失: ${sql_file}"

  log_info "  → ${name}"
  psql -h "${PG_HOST}" -U "${PG_USER}" -d "${REPORT_DB}" \
    -v ON_ERROR_STOP=1 \
    -v window_start="${WINDOW_START_ISO}" \
    -v window_end="${WINDOW_END_ISO}" \
    --csv < "${sql_file}" > "${TMP_DIR}/${name}.csv"
done
```

**为什么不用 `for sql in sql/*.sql`**：
- glob 依赖 shell 排序（字典序），顺序是**隐性约束**；显式数组顺序即事实源。
- 遗漏 SQL 文件时 `for` 静默跳过，`render.mjs` 崩在读文件的位置（错误定位滞后）；显式清单**立即 die 在缺失点**。
- 多余 SQL 文件（比如 debug 时随手加的 `99-scratch.sql`）会被 glob 拉进来跑，产生无用 csv；显式清单只跑声明过的。
- 未来加查询强制**同步 render.mjs**——契约显式化，减少"忘了改 render"这类漏洞。

每个 SQL 直接在本次 `REPORT_DB` 中运行，只接收 `window_start / window_end`。输出 RFC 4180 CSV（含表头），`render.mjs` 支持 quoted comma、双引号转义和字段内换行；文件缺失或解析失败立即触发告警，不能伪装为零新增。

---

## 6. SQL 全文

所有查询统一采用 `created_at >= window_start AND created_at < window_end` 的半开窗口，不输出 UUID。以下 SQL 为设计示例；已落地版本以 `analytics/sql/*.sql` 为事实源。

### 6.1 `10-summary.sql`

```sql
WITH
  u AS (SELECT count(*) c FROM users
        WHERE deleted_at IS NULL
          AND created_at >= :'window_start'::timestamptz AND created_at < :'window_end'::timestamptz),
  l AS (SELECT count(*) c FROM ledgers
        WHERE deleted_at IS NULL
          AND created_at >= :'window_start'::timestamptz AND created_at < :'window_end'::timestamptz),
  e AS (SELECT count(*) c, coalesce(sum(amount), 0) sum_amount FROM entries
        WHERE deleted_at IS NULL
          AND created_at >= :'window_start'::timestamptz AND created_at < :'window_end'::timestamptz),
  i AS (SELECT count(*) c,
               count(*) FILTER (WHERE used_at IS NOT NULL) used_c
        FROM family_invites
        WHERE created_at >= :'window_start'::timestamptz AND created_at < :'window_end'::timestamptz),
  a AS (SELECT count(DISTINCT created_by) c FROM entries
        WHERE deleted_at IS NULL
          AND created_at >= :'window_start'::timestamptz AND created_at < :'window_end'::timestamptz)
SELECT u.c AS new_users,
       l.c AS new_ledgers,
       e.c AS new_entries,
       e.sum_amount AS new_entries_amount_cents,
       i.c AS new_invites,
       i.used_c AS new_invites_used,
       a.c AS active_users
FROM u, l, e, i, a;
```

### 6.2 `20-new-users.sql`

```sql
SELECT
  u.nickname,
  u.created_at,
  u.has_completed_profile,
  (SELECT count(*) FROM entries e
   WHERE e.created_by = u.id
     AND e.deleted_at IS NULL
     AND e.created_at >= :'window_start'::timestamptz AND e.created_at < :'window_end'::timestamptz
  ) AS entries_in_window
FROM users u
WHERE u.deleted_at IS NULL
  AND u.created_at >= :'window_start'::timestamptz AND u.created_at < :'window_end'::timestamptz
ORDER BY u.created_at ASC;
```

### 6.3 `30-new-ledgers.sql`

```sql
SELECT
  l.name AS ledger_name,
  f.name AS family_name,
  f.kind AS family_kind,             -- 'personal' | 'shared'
  owner.nickname AS owner_nickname,
  l.created_at
FROM ledgers l
JOIN families f ON f.id = l.family_id
JOIN users owner ON owner.id = f.owner_id
WHERE l.deleted_at IS NULL
  AND l.created_at >= :'window_start'::timestamptz AND l.created_at < :'window_end'::timestamptz
ORDER BY l.created_at ASC;
```

### 6.4 `40-new-entries.sql`

**拿全量**（不做 SQL 层截断），渲染层按阈值决定"全展 vs 前 N + 统计"。

```sql
SELECT
  e.created_at,
  e.occurred_at,
  e.type,                            -- 'income'/'expense'/'transfer'
  e.shared_type,                     -- 'personal'/'shared'/NULL
  e.amount,                          -- cents
  e.currency,
  substring(coalesce(e.note, '') for 40) AS note_short,
  l.name AS ledger_name,
  f.kind AS family_kind,
  u.nickname AS created_by_nickname,
  parent.name AS category_parent,
  cat.name AS category_name
FROM entries e
JOIN ledgers l ON l.id = e.ledger_id
JOIN families f ON f.id = l.family_id
JOIN users u ON u.id = e.created_by
LEFT JOIN categories cat ON cat.id = e.category_id
LEFT JOIN categories parent ON parent.id = cat.parent_id
WHERE e.deleted_at IS NULL
  AND e.created_at >= :'window_start'::timestamptz AND e.created_at < :'window_end'::timestamptz
ORDER BY e.created_at ASC;
```

### 6.5 `50-new-invites.sql`

```sql
SELECT
  i.created_at,
  i.used_at,
  inviter.nickname AS inviter_nickname,
  used_user.nickname AS used_by_nickname,
  f.name AS family_name,
  f.kind AS family_kind,
  CASE WHEN i.used_at IS NOT NULL
       THEN EXTRACT(EPOCH FROM (i.used_at - i.created_at))::bigint
       ELSE NULL
  END AS accepted_in_seconds
FROM family_invites i
JOIN users inviter ON inviter.id = i.inviter_id
JOIN families f ON f.id = i.family_id
LEFT JOIN users used_user ON used_user.id = i.used_by
WHERE i.created_at >= :'window_start'::timestamptz AND i.created_at < :'window_end'::timestamptz
ORDER BY i.created_at ASC;
```

### 6.6 `60-active-users.sql`

活跃 = 窗口内有 entry created。这里不用 `user_sessions.last_refresh_at`（每次 sync 都写，噪音大），保持简单。

```sql
SELECT
  u.nickname,
  count(*) AS entries_count,
  sum(e.amount) AS entries_amount_cents,
  max(e.created_at) AS last_entry_at
FROM entries e
JOIN users u ON u.id = e.created_by
WHERE e.deleted_at IS NULL
  AND e.created_at >= :'window_start'::timestamptz AND e.created_at < :'window_end'::timestamptz
GROUP BY u.id, u.nickname
ORDER BY entries_count DESC;
```

### 6.7 `90-anomaly.sql`

轻量异常信号，先埋点，后续再根据实际数据调阈值。

```sql
WITH per_user AS (
  SELECT created_by, count(*) c
  FROM entries
  WHERE deleted_at IS NULL
    AND created_at >= :'window_start'::timestamptz AND created_at < :'window_end'::timestamptz
  GROUP BY created_by
),
per_ledger AS (
  SELECT ledger_id, count(*) c
  FROM entries
  WHERE deleted_at IS NULL
    AND created_at >= :'window_start'::timestamptz AND created_at < :'window_end'::timestamptz
  GROUP BY ledger_id
)
SELECT 'high_entry_user' AS kind, u.nickname AS ref, pu.c AS metric
FROM per_user pu JOIN users u ON u.id = pu.created_by
WHERE pu.c > 50
UNION ALL
SELECT 'high_entry_ledger', l.name, pl.c
FROM per_ledger pl JOIN ledgers l ON l.id = pl.ledger_id
WHERE pl.c > 100;
```

---

## 7. 渲染 template

### 7.1 `config.mjs`（阈值配置）

```javascript
export const DEFAULT_THRESHOLDS = {
  users: 5, ledgers: 5, entries: 20, invites: 5, active: 8,
};

export function loadThresholds(env) {
  return {
    users:   parseInt(env.THRESHOLD_USERS   || DEFAULT_THRESHOLDS.users,   10),
    ledgers: parseInt(env.THRESHOLD_LEDGERS || DEFAULT_THRESHOLDS.ledgers, 10),
    entries: parseInt(env.THRESHOLD_ENTRIES || DEFAULT_THRESHOLDS.entries, 10),
    invites: parseInt(env.THRESHOLD_INVITES || DEFAULT_THRESHOLDS.invites, 10),
    active:  parseInt(env.THRESHOLD_ACTIVE  || DEFAULT_THRESHOLDS.active,  10),
  };
}
```

### 7.2 `templates/common.mjs`（格式化辅助）

- `fmtAmount(cents)` → `¥12,340.56`
- `fmtBadge(kind)` → `[个人]` 或 `[家庭]`
- `fmtCategory(parent, name)` → `餐饮/外卖`（parent 为 null 时只出 `外卖`）
- `fmtTime(iso, fmt='mm-dd HH:MM')` → 手动格式化，避免引入 dayjs/luxon（node 内置 Date 足够）
- `fmtNickname(nick)` → 截断到 16 字符 + `…`
- `parseCsv(text)` → 简单实现（不处理跨行 quoted，Costra 场景够用；如后续昵称含引号需要升级）

### 7.3 三 template 决策规则（`render.mjs` 里）

```javascript
const dayMs = 86400_000;
const template = windowMs >= 7 * dayMs ? 'weekly'
              : windowMs >= 2 * dayMs ? 'range'
              :                          'daily';
```

- 输出路径也由此决定：
  - `daily` → `${REPORTS_DIR}/daily/YYYY-MM-DD.md`（用 anchor 的 YYYY-MM-DD）
  - `weekly` → `${REPORTS_DIR}/weekly/YYYY-Www.md`（用 anchor 所在的 ISO 周编号）
  - `range` → `${REPORTS_DIR}/range/${startDate}_${endDate}.md`

### 7.4 daily template

**结构**：
1. **顶部头部**：标题 + 分析窗口 + 数据源
2. **一句话摘要**（来自 10-summary.csv）
3. **§ 用户**：条数 + 明细/截断
4. **§ 账本**：条数 + 明细/截断
5. **§ 记账**：条数 + 明细表/截断+统计
6. **§ 邀请**：条数 + 明细
7. **§ 活跃用户**（DAU）：明细/截断
8. **§ 异常信号**（若有）

**详略分级规则**（对每一节独立判断）：

```javascript
function renderSection(items, threshold, renderFull, renderTruncated) {
  if (items.length === 0) return '无\n';
  if (items.length <= threshold) return renderFull(items);
  return renderTruncated(items, threshold);   // 前 N 明细 + 分维度统计
}
```

**详略示例**（少·常态）见 §7.6。

**详略示例**（多·超阈值 · 记账 87 条）：

```markdown
## 记账（87）
条数超过阈值（20），仅列前 10：

| 时间 | 账本 | 分类 | 金额 | 记账人 | 备注 |
|---|---|---|---|---|---|
| 07-21 08:22 | 家庭日常 [家庭] | 餐饮/外卖 | ¥15.00 | 张小明 | 早餐 |
| ... (10 条) |

**汇总**：87 条 · 总额 ¥12,340.00 · 支出 78 · 收入 7 · 转账 2 · shared 30（34%）
**分账本**：家庭日常 45 条 ¥5,600 · 出差账本 28 条 ¥5,200 · 我的账本 14 条 ¥1,540
**分类 Top5**：餐饮 22 · 交通 18 · 购物 15 · 生活 12 · 其他 10
```

### 7.5 range template

- 明细一律不列（除非条数极少）
- 结构：顶部头部 + summary + 5 小节统计（用户列表/账本列表/记账统计/邀请列表/活跃 Top）
- 与 daily 的区别：**记账区永远走统计版**（明细太多不利于阅读），其他区仍按阈值判断

### 7.6 weekly template（≥ 7d）

- 顶部头部 + summary + 5 小节
- **额外新增**：**每日 sparkline**——用 unicode `▁▂▃▄▅▆▇█` 拼一根 7 位/N 位的折线，展示每日 entry 条数分布，让你一眼看出"哪天最活跃"
- 关键指标：留存（前 7 日新增用户里有几个今天还有 entry），需要跨 dump 分析——**v0.1 暂不做，v0.2 再补**（因单份 dump 里只能看到当前状态，无法回溯"7 天前是不是新用户"）
- 明细策略同 range

**sparkline 实现**（约 10 行）：

```javascript
function sparkline(counts) {
  if (counts.length === 0) return '';
  const bars = '▁▂▃▄▅▆▇█';
  const max = Math.max(...counts);
  if (max === 0) return bars[0].repeat(counts.length);
  return counts.map(c => bars[Math.floor((c / max) * (bars.length - 1))]).join('');
}
// e.g. [3, 5, 2, 8, 1, 6, 4] → "▂▄▁█▁▆▃"
```

### 7.7 完整 daily 样例（少 · 常态）

```markdown
# Costra 日报 · 2026-07-21 周二
分析窗口：07-20 21:17 → 07-21 21:17（最近 24h · 数据源 dump@07-21 21:17）

> DAU 4 · 新用户 1 · 新账本 0 · 新记账 12（¥460.00）· 新邀请 1（已使用 1）

## 用户（1）
- 王小美 · 07-20 22:15 · 未完成资料 · 窗口内记账 3 条

## 账本（0）
无新增

## 记账（12）
| 时间 | 账本 | 分类 | 金额 | 记账人 | 备注 |
|---|---|---|---|---|---|
| 07-21 08:22 | 家庭日常 [家庭] | 餐饮/早餐 | ¥15.00 | 张小明 | 豆浆油条 |
| 07-21 09:15 | 我的账本 [个人] | 交通/公交地铁 | ¥4.00 | 王小美 | — |
| ... |

**分账本**：家庭日常 8 条 ¥340.00 · 我的账本 4 条 ¥120.00

## 邀请（1）
- 张小明 → 家庭"张家" · 已被 王小美 接受（耗时 12min）

## 活跃用户（4）
- 张小明 · 8 条 ¥340.00
- 王小美 · 3 条 ¥100.00
- 李二 · 1 条 ¥20.00

## 异常信号
无
```

---

## 8. 邮件通道

### 8.1 依赖

`package.json`：

```json
{
  "name": "costra-analyze",
  "type": "module",
  "private": true,
  "dependencies": {
    "nodemailer": "^6.9.0",
    "marked": "^12.0.0"
  }
}
```

只两个依赖，无 lockfile 也能 `npm i` 起来。node ≥ 18 内置 `fetch` 和 `URL`。

### 8.2 `send-mail.mjs` 结构（约 80 行）

- 读 `.env`（用 `dotenv` 或手写 6 行解析器）
- 读 report md
- 从 md 首行标题 + summary 行提取 **subject 字段**（正则或干脆在 render.mjs 里额外输出一份 `${TMP_DIR}/subject.txt`，更稳）
- `marked(md)` 得 html
- 拼接 inline style：
  ```html
  <style>
    body { font-family: -apple-system, "PingFang SC", sans-serif; font-size: 14px; color: #1c1b1a; }
    table { border-collapse: collapse; margin: 8px 0; }
    th, td { border: 1px solid #ddd; padding: 4px 8px; text-align: left; }
    th { background: #f1f2ec; }
    code { background: #f5f5f5; padding: 2px 4px; border-radius: 3px; }
  </style>
  ```
- `nodemailer.createTransport({ host, port, secure: port==465, auth: {user, pass} })`
- `sendMail({ from, to, cc, subject, text: mdRaw, html })`
- 成功 → 打印 `messageId`，失败 → 非零 exit（触发主脚本 trap）

### 8.3 subject 命名规则

- daily：`Costra 日报 · YYYY-MM-DD · dump@MM-DD HH:MM · +U 用户 +L 账本 +E 记账（¥xxx）+I 邀请`
- weekly：`Costra 周报 · YYYY-Www · YYYY-MM-DD→YYYY-MM-DD · +U +L +E +I`
- range：`Costra 报告 · Xd · YYYY-MM-DD→YYYY-MM-DD · +U +L +E +I`

**关键**：subject 里塞 dump 时间戳（`dump@07-21 21:17`），让用户扫一眼就知道数据快照多新——这是替代 healthchecks 的"隐性活性指标"，连续两天 dump 时间戳不推进就能察觉 prod scp 挂了。

### 8.4 失败邮件（`send-failure-mail.mjs`）

trap ERR 时调用，subject：`⚠️ Costra 分析失败 · <exit_code>@<line>`；body：附上 `tail -50` 的日志 + 关键环境变量（不含 secret）。

**特例**：pick-dump 拿不到 dump 时**不走 ERR trap**（因为不是错误），而是直接 `send-failure-mail --reason no-dump` 后 `exit 0`。

---

## 9. cron 配置（analyze host · 独立于 prod cron · §0.3）

```cron
# /etc/cron.d/costra-analyze · 独立文件 · 不修改 prod cron
SHELL=/bin/bash
PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin

59 23 * * * root flock -w 1800 /var/lock/costra-analyze.lock /opt/costra-analyze/scripts/analyze.sh --window 24h >> /var/log/costra-analyze/daily.log 2>&1
50 23 * * 0 root flock -w 1800 /var/lock/costra-analyze.lock /opt/costra-analyze/scripts/analyze.sh --window 7d >> /var/log/costra-analyze/weekly.log 2>&1
```

**约束**：
- cron 路径是部署后字面绝对路径；`flock` 防止日报、周报和手动任务并发恢复。
- 日志独立存放在 `/var/log/costra-analyze/`，每次运行另有 run 级日志供失败邮件截取。
- 分析工具不配置备份清理 cron；`${DUMP_INBOX}` 内文件始终只读保留。

---

## 10. 手动补跑 / 回看

### 10.1 常见用法

```bash
# 看昨天（万一 cron 那次挂了）
./analyze.sh --anchor "$(date -d 'yesterday 23:59' -Iseconds)"

# 看上周
./analyze.sh --window 7d --anchor 2026-07-14T23:59:00+08:00

# 看这个月（30d 会走 range template）
./analyze.sh --window 30d

# 用某份特定 dump（比如 prod scp 挂了几天补齐后想按当天点跑）
./analyze.sh --dump /var/lib/costra-analyze/inbox/scheduled-20260715-2117.sql.gz --window 24h

# 只出到 stdout 不发邮件（调试）
./analyze.sh --stdout
```

### 10.2 幂等语义

- 同一天多次跑 → 写到同一路径 `reports/daily/YYYY-MM-DD.md`（**覆写**）
- 每次跑都重建固定工作库 `costra_report_work`；`flock` 防并发，成功/失败/信号中断都会 DROP
- 邮件每次跑都发一封（**不去重**）——因为发多封的成本 ≈ 0，而"防重复"逻辑会引入状态管理的复杂度，不划算

---

## 11. Docker Compose 定义

`docker-compose.yml`：

```yaml
name: costra-analyze
services:
  postgres:
    image: postgres:15
    container_name: costra-analyze-pg
    restart: "no"                # 按需启停 · 宿主机重启不自动拉起
    ports:
      - "127.0.0.1:15432:5432"
    environment:
      POSTGRES_DB: ${PG_DB:-analyze}
      POSTGRES_USER: ${PG_USER:-analyze}
      POSTGRES_PASSWORD: ${PG_PASSWORD:-change_me}
    volumes:
      - analyze-pg-data:/var/lib/postgresql/data
    deploy:
      resources:
        limits:
          memory: 512M
          cpus: '0.5'

  analyzer:
    build:
      context: .
      dockerfile: Dockerfile.analyzer
    container_name: costra-analyze-node
    restart: "no"                # 按需启停 · 宿主机重启不自动拉起
    working_dir: /app
    volumes:
      - .:/app
      - ${DUMP_INBOX}:${DUMP_INBOX}:ro
      - ${REPORTS_DIR}:${REPORTS_DIR}
      - ${LOG_DIR}:${LOG_DIR}
    depends_on:
      postgres:
        condition: service_healthy
    deploy:
      resources:
        limits:
          memory: 256M
          cpus: '0.5'

volumes:
  analyze-pg-data:
```

- `postgres` 只 bind `127.0.0.1`，任何情况下不对外。
- `analyzer` 承载完整分析编排，宿主机只负责 `docker compose exec`。
- `${DUMP_INBOX}` 只读挂载；`${REPORTS_DIR}` 和 `${LOG_DIR}` 读写挂载。
- named volume 只保存分析 PG 基础实例；工作库 `costra_report_work` 每次分析都会重建并清理。
- **按需启停 + 资源封顶（v0.2.4）**：`restart: "no"` 不常驻，`analyze.sh` 跑完 `docker compose stop` 释放资源；`deploy.resources.limits` 限制分析窗口峰值，避免与同机 staging 栈（3.0G）、standby 从库（768M）叠加超限。

---

## 12. 工作量估算

| 阶段 | 内容 | 工时 |
|---|---|---|
| S1 | 目录骨架 + docker-compose + `.env.example` + `common.sh` | 1h |
| S2 | `analyze.sh` 主流程 + `parse-args.sh` + `pick-dump.sh` | 1.5h |
| S3 | `restore-database.sh`（原样恢复 + sanity check + 信号清理）| 1h |
| S4 | 7 个 SQL 编写 + 容器内 psql 查询打通 | 1.5h |
| S5 | `render.mjs` + `common.mjs` + `daily.mjs` | 2h |
| S6 | `range.mjs` + `weekly.mjs` + sparkline | 1h |
| S7 | `send-mail.mjs` + `send-failure-mail.mjs` + subject 规则 | 1h |
| S8 | trap ERR + no-dump 告警 + 日志文案打磨 | 0.5h |
| S9 | cron 配置 + `.gitignore` + README | 0.5h |
| S10 | 端到端首跑 · stdout 模式验收 md 格式 · 用户确认后填真实邮箱 · 收到邮件闭环 | 1h |
| **合计** | | **~11h（1.5 工作日）** |

---

## 13. 分阶段落地建议

**Phase 0（已完成）**：tech-spec 评审与独立 `analytics/` 代码实现
**Phase 1**：复制 `analytics/` 到 analyze host → `npm ci` → 启动独立 compose
**Phase 2**：保留 `MAIL_TO=PLACEHOLDER`，用真实 dump 跑 `analyze.sh --stdout` 验收报告
**Phase 3**：填真实 QQ SMTP / `MAIL_TO`，收到 HTML 邮件闭环
**Phase 4**：安装独立 cron → 观察一周
**Phase 5（可选）**：后续版本补留存指标与更多异常规则

---

## 14. 风险与已知限制

| # | 风险 | 概率 | 影响 | 缓解 |
|---|---|---|---|---|
| R1 | 临时数据库因机器断电残留 | 低 | 中 | ERR/INT/TERM 清理；断电后可按 `costra_report_%` 手动清理 |
| R2 | QQ 邮箱 SMTP 授权码过期/被封 | 低 | 高 | subject dump 时间戳作为隐性活性指标；授权码更新后无需改代码 |
| R3 | prod scp 中断但 inbox 仍有旧文件 | 中 | 高 | 自动模式拦截超过 48 小时的最新 dump，告警且不出陈旧报告 |
| R4 | dump 内含 partition table (`audit_logs_y2026m*`) restore 时可能因分区 attach 顺序报错 | 低 | 中 | pg_dump 默认输出会带 `CREATE TABLE ... PARTITION OF` 语句，PG 15 支持；首次跑失败则改用 `--exclude-table='audit_logs*'` 过滤（audit_logs 不参与分析） |
| R5 | 单个 SQL 报错整体崩溃 | 低 | 低 | trap 触发失败邮件 · 便于用户调试；每个 SQL 独立文件便于定位 |
| R6 | scp 备份持续累积占满磁盘 | 中 | 高 | 分析工具不删除备份；由外部备份策略负责容量监控和生命周期管理 |
| R7 | v0.1 无留存指标 | - | - | v0.2 加（需要跨 dump 对比历史用户 vs 现活跃）|

---

## 15. 未列入本版本（后续可能追加）

- **留存曲线**：D1/D7/D30 留存（依赖历史 dump 或加一张"每日活跃用户快照表"）
- **周同比 / 月同比**：需要跨窗口对比数据
- **图表**：md 里可以嵌 `data:image/svg+xml;base64,…` 折线图（复用小程序里的 svg-chart 方案）
- **告警渠道多元化**：把日报同时推到 Server 酱 / 企业微信 webhook（如果 SMTP 稳定性观察到问题）
- **数据仓库化**：如果分析 SQL 变复杂，可以把宽表 materialize 到 analyze host 本地 PG（脱离每天 restore 的模型），代价是引入 migration 双写复杂度

---

**当前状态：代码已落地到独立 `analytics/` 目录。** 下一步部署验收焦点：
1. 用真实 dump 完成一次恢复与 stdout 报告核对；
2. 评审三种 template 的详略呈现；
3. 填写 QQ SMTP 授权码与最终 `MAIL_TO`，验证 HTML 邮件；
4. 安装独立 cron 后观察一周。
