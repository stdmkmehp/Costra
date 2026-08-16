# Costra Analyze · 用户行为日报分析工具

基于 standby 从库导出的 pg_dump 快照（prod 数据副本），生成 Costra 用户行为日报/周报/任意区间报告，并通过 QQ 邮箱发送。

**版本**: v0.1 · 技术方案: `docs/ops/analytics-daily-tech-spec.md`

---

## 架构概览

```
宿主机 cron/manual
      │
      ▼
scripts/analyze.sh  # 薄 wrapper：docker compose up + exec analyzer
      │
      ▼
costra-analyze-node:/app/scripts/analyze-in-container.sh
      │
      ├─ 读取 DUMP_INBOX/*.sql.gz（只读）
      ├─ psql -h postgres 重建 costra_report_work
      ├─ 跑 sql/*.sql → /tmp/costra-analyze/<run>/*.csv
      ├─ render.mjs → REPORTS_DIR/*.md
      └─ send-mail.mjs → QQ SMTP
```

**与 prod 完全隔离**（见 spec §0）：
- 独立 docker-compose（两个按需启停容器：`costra-analyze-pg` + `costra-analyze-node`，端口 `127.0.0.1:15432`）
- 独立 DB/用户（`analyze/analyze`，vs prod 的 `costra/costra`）
- 分析工作库固定为 `costra_report_work`，每次分析开头 `DROP + CREATE`，结束再次 `DROP`
- 独立日志目录（`/data/logs/analyze/`）
- 独立 cron 文件（`/etc/cron.d/costra-analyze`）
- 唯一依赖：standby 备份 cron 直落同机 `${DUMP_INBOX}` 的 `.sql.gz` dump 文件

---

## 快速开始

### 1. 前置条件

- Docker + Docker Compose
- **宿主机不需要 Node.js / npm / gzip / psql**——这些都在 `costra-analyze-node` 容器中执行

### 2. 部署

```bash
# 建议路径（不要放 prod 目录子目录）
sudo mkdir -p /opt/costra-analyze
sudo cp -r . /opt/costra-analyze/
cd /opt/costra-analyze

# 配置（env 事实源在 /data/conf，不进部署目录）
sudo install -m 0600 .env.example /data/conf/analytics.env
sudo vim /data/conf/analytics.env   # 填入真实值（PG_PASSWORD、SMTP 配置）

# 创建必要目录（按 analytics.env 配置）
mkdir -p /data/slave/backups
mkdir -p /data/analyze/report
mkdir -p /data/logs/analyze
chmod 755 /data/logs/analyze

# 预热构建镜像（可选但推荐：避免首次 analyze.sh 时 build 太久）
docker compose build
```

> **容器按需启停**：`analyze.sh` 每次运行会自行 `up -d`，跑完后立即 `stop`
> 释放 CPU/内存给同机其它服务。因此**不需要手动 `docker compose up -d`**；
> 平时 `docker compose ps` 显示 `Exited` 是正常状态，不是故障。

### 3. 验收（stdout 模式）

```bash
# 先保持 MAIL_TO=PLACEHOLDER@example.com

# 需要一份 dump 文件（正常由 standby 备份 cron 自动产出；也可手动放入）
cp /path/to/standby-YYYYMMDD-HHMMSS.sql.gz /data/slave/backups/

# 运行（stdout 模式，不发邮件）
cd /opt/costra-analyze
./scripts/analyze.sh --stdout

# 检查输出格式是否满意
```

### 4. 开启邮件

```bash
# 填入真实收件人
sudo vim /data/conf/analytics.env
# 修改: MAIL_TO=your@email.com
# 修改: SMTP_USER=yourqq@qq.com
# 修改: SMTP_PASS=your_16char_authcode

# 测试发送
./scripts/analyze.sh
```

### 5. 配置 cron

```bash
# 安装 cron 文件
sudo cp cron/costra-analyze /etc/cron.d/costra-analyze
sudo chmod 644 /etc/cron.d/costra-analyze

# 验证
cat /etc/cron.d/costra-analyze
```

---

## CLI 参数

```
用法: analyze.sh [选项]

选项:
  --dump   <file>    指定 dump 文件（默认: DUMP_INBOX 内 mtime 最新的 .sql.gz）
  --window <dur>     分析窗口时长（默认: 24h）
                     格式: <数字><单位>，单位: m(分钟) h(小时) d(天)
                     示例: 24h, 7d, 30d, 168h, 15m
  --anchor <ISO>     分析窗口右端时间（默认: dump 文件的 mtime）
                     格式: ISO 8601，例如 2026-07-21T23:59:00+08:00
  --stdout           强制输出到 stdout，不发邮件
  -h, --help         显示帮助
```

**分析窗口** = `[anchor - window, anchor)`（右端点不包含）

**Template 选择**：
- `window < 2d` → 日报（`reports/daily/YYYY-MM-DD.md`）
- `2d ≤ window < 7d` → 区间报告（`reports/range/START_END.md`）
- `window ≥ 7d` → 周报（`reports/weekly/YYYY-Www.md`）

### 常见用法

```bash
# 默认（最新 dump · 24h · anchor=dump mtime）
./scripts/analyze.sh

# 最近 7 天（周报）
./scripts/analyze.sh --window 7d

# 回看昨天（万一 cron 挂了）
./scripts/analyze.sh --anchor "$(date -d 'yesterday 23:59' -Iseconds)"   # Linux
./scripts/analyze.sh --anchor "$(date -v-1d '+%Y-%m-%dT23:59:00+08:00')" # macOS

# 看上周
./scripts/analyze.sh --window 7d --anchor 2026-07-14T23:59:00+08:00

# 看这个月（30d 走 range template）
./scripts/analyze.sh --window 30d

# 指定特定 dump 文件
./scripts/analyze.sh --dump /data/slave/backups/standby-20260715-2117.sql.gz

# 调试（stdout + 不发邮件）
./scripts/analyze.sh --stdout
```

---

## 目录结构

```
analytics/
├── docker-compose.yml          # 独立 PG + analyzer 双容器
├── Dockerfile.analyzer         # node + bash + gzip + postgresql-client
├── .env.example                # 配置示例（checked-in · 实际配置安装到 /data/conf/analytics.env）
├── package.json                # 依赖: nodemailer + marked
├── config.mjs                  # 阈值配置（users=5/ledgers=5/entries=20/invites=5/active=8）
├── scripts/
│   ├── analyze.sh              # 宿主机薄 wrapper
│   ├── analyze-in-container.sh # 容器内真实分析入口
│   ├── lib/
│   │   ├── common.sh           # 公共函数（log/die/load_env/file_mtime）
│   │   └── parse-args.sh       # 参数解析（--dump/--window/--anchor/--stdout）
│   ├── pick-dump.sh            # 选定 dump 文件
│   ├── restore-database.sh     # gunzip | psql → 一次性临时数据库（原样恢复）
│   ├── run-queries.sh          # 按显式清单执行 SQL（不 glob）
│   ├── render.mjs              # CSV → template → markdown
│   ├── send-mail.mjs           # markdown → HTML → SMTP
│   └── send-failure-mail.mjs   # 失败/无 dump 告警邮件
├── sql/
│   ├── 10-summary.sql          # 各维度汇总（含手动/自动记账区分）
│   ├── 20-new-users.sql        # 新增用户明细（含来源/家庭数/首笔记账耗时）
│   ├── 30-new-ledgers.sql      # 新增账本明细（含已软删·家庭成员数·成员昵称）
│   ├── 40-new-entries.sql      # 新增记账明细（含 source: auto/manual）
│   ├── 50-new-invites.sql      # 新增邀请明细
│   ├── 60-active-users.sql     # 活跃/低活跃用户（7天≥5天/2~4天）
│   ├── 65-auto-only-users.sql  # 仅自动记账预警（7d/14d/30d）
│   ├── 70-retention.sql  # 留存率（7日/30日）
│   ├── 80-daily-trend.sql    # 过去7天每日趋势数据（柱状图用）
│   └── 90-anomaly.sql       # 异常信号（高频用户/账本）├── templates/
│   ├── common.mjs              # 格式化辅助（fmtAmount/fmtBadge/parseCsv/sparkline）
│   ├── daily.mjs               # 日报 template（< 2d）
│   ├── range.mjs               # 区间报告 template（2d~7d）
│   └── weekly.mjs              # 周报 template（≥ 7d · 含 sparkline）
├── cron/
│   └── costra-analyze          # 日报 23:59 · 周报周日 23:50 · flock 防并发
└── reports/                    # 本地调试输出目录（正式输出看 REPORTS_DIR）
```

正式报告按 `/data/conf/analytics.env`（`REPORTS_DIR`）写入：

```
/data/analyze/report/daily/YYYY-MM-DD.md
/data/analyze/report/weekly/YYYY-Www.md
/data/analyze/report/range/START_END.md
```

> `${DUMP_INBOX}` 中由 standby 备份 cron 产出的备份文件始终按只读数据源处理；分析工具不会删除、移动或重命名这些文件。

---

## 配置说明（/data/conf/analytics.env）

配置文件事实源为 `/data/conf/analytics.env`（0600，独立于部署目录，与机器② 的 `server.env`/`standby.env` 同目录约定）；可用环境变量 `ANALYTICS_ENV_FILE` 覆盖（本机开发：`ANALYTICS_ENV_FILE=./.env ./scripts/analyze.sh`）。`analyze.sh` 在宿主机加载后经 compose 单文件只读挂载映射为容器内 `/app/.env`，容器内脚本与 `.mjs` 统一读该路径。

| 变量 | 说明 | 默认/示例 |
|---|---|---|
| `DUMP_INBOX` | standby 备份直落目录 | `/data/slave/backups` |
| `REPORTS_DIR` | 报告输出目录 | `/data/analyze/report` |
| `LOG_DIR` | 每次运行的独立日志目录 | `/data/logs/analyze` |
| `PG_CONTAINER` | 容器名 | `costra-analyze-pg` |
| `PG_DB` | 数据库名 | `analyze` |
| `PG_USER` | 数据库用户 | `analyze` |
| `PG_PASSWORD` | 数据库密码 | _(随机 32 字符)_ |
| `SMTP_HOST` | SMTP 服务器 | `smtp.qq.com` |
| `SMTP_PORT` | SMTP 端口 | `465` |
| `SMTP_USER` | QQ 邮箱账号 | `yourqq@qq.com` |
| `SMTP_PASS` | QQ 授权码（16位） | _(非 QQ 密码)_ |
| `MAIL_FROM` | 发件人 | `yourqq@qq.com` |
| `MAIL_TO` | 收件人 | `PLACEHOLDER@example.com` → 填真实邮箱 |
| `MAIL_CC` | 抄送（可空） | |
| `THRESHOLD_USERS` | 用户阈值（可选） | `5`（默认） |
| `THRESHOLD_LEDGERS` | 账本阈值（可选） | `5`（默认） |
| `THRESHOLD_ENTRIES` | 记账阈值（可选） | `20`（默认） |
| `THRESHOLD_INVITES` | 邀请阈值（可选） | `5`（默认） |
| `THRESHOLD_ACTIVE` | 活跃用户阈值（可选） | `8`（默认） |

---

## 报告格式

### 日报示例

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
...
```

### 邮件 Subject 规则

- 日报：`Costra 日报 · YYYY-MM-DD · dump@MM-DD HH:MM · +U用户 +L账本 +E记账（¥xxx）+I邀请`
- 周报：`Costra 周报 · YYYY-Www · START→END · +U +L +E +I`
- 区间：`Costra 报告 · Xd · START→END · +U +L +E +I`

Subject 中的 `dump@` 时间戳是**隐性活性指标**——连续两天时间戳不推进说明 standby 备份链路可能挂了。

---

## 部署验收清单（隔离检查）

```bash
# 1. 目录不重叠（在部署根执行）
[[ "$(pwd -P)" != /root/Costra* ]] && echo "OK: 路径隔离"

# 2. 容器名正确（按需启停模式下容器平时 Exited · 用 ps -a）
docker ps -a --format '{{.Names}}' | grep -q 'costra-analyze-pg' && echo "OK: 容器名"

# 3. 端口正确（15432，不是 5432）· 按需启停模式下端口仅在分析运行期间监听
#    检查时先 ./scripts/analyze.sh --stdout 跑起来，或改用 ps -a 确认容器存在
ss -ltnp | grep -q '127.0.0.1:15432' && echo "OK: 端口隔离"  # Linux
# macOS: netstat -an | grep 15432

# 4. 日志目录独立
[[ -d /var/log/costra-analyze ]] && echo "OK: 日志目录"

# 5. cron 文件独立
[[ -f /etc/cron.d/costra-analyze ]] && echo "OK: cron 文件"
```

---

## 故障排查

### dump 为空/缺失

```bash
# 检查 inbox 目录
ls -la /data/slave/backups/

# 手动触发（会发送无 dump 告警邮件或打印告警）
./scripts/analyze.sh --stdout
```

### 容器未启动 / 状态为 Exited

容器采用**按需启停**：`analyze.sh` 运行期间自动启动，跑完自动停止。
`docker compose ps` 显示 `Exited` 是正常状态，无需干预。

排查实际故障时：

```bash
# 查看容器状态与最近日志
docker compose ps -a
docker compose logs postgres
docker compose logs analyzer

# 手动触发一次完整运行（会自行 up / 跑完 stop）
./scripts/analyze.sh --stdout
```

### SMTP 失败

```bash
# 检查 QQ 邮箱是否开启 SMTP 服务
# 检查授权码（不是 QQ 密码）
# 测试连接
curl -v smtp://smtp.qq.com:465 --ssl-reqd -u yourqq@qq.com:authcode
```

### 手动清理残留临时数据库

正常失败、`SIGINT`、`SIGTERM` 都会自动清理；机器断电后若有残留可手动处理：

```bash
docker compose exec postgres psql -U analyze -d analyze \
  -c "SELECT datname FROM pg_database WHERE datname LIKE 'costra_report_%';"

docker compose exec postgres psql -U analyze -d analyze \
  -c "DROP DATABASE IF EXISTS costra_report_work WITH (FORCE);"
```

---

## 技术说明

### 资源策略：按需启停 + limits（v0.2.4）

分析栈与 staging 栈、PG standby 从库共机，且每天仅 cron 触发两次（日报 23:59 / 周报周日 23:50）、单次运行几分钟，常驻不划算：

- **按需启停**：compose 里 `restart: "no"`；`analyze.sh` 启动容器、跑完（无论成败，含 Ctrl+C）`docker compose stop` 释放 CPU/内存。宿主机重启后容器不自动拉起，下次 cron 触发时自行恢复。
- **资源封顶**：PG `memory: 512M / cpus: 0.5`，analyzer `memory: 256M / cpus: 0.5`，防止分析窗口内恢复 dump 的峰值与 staging（3.0G）、standby（768M）叠加撑爆整机内存。
- 整机资源配额与错峰约定见 `docs/ops/pg-standby-backup.md` §2.1。

### 一次性数据库恢复（spec §5.3）

每次运行创建独立的 `costra_report_<hash>` 数据库，将 prod dump **原样**恢复后执行查询，完成或失败时删除。这样不会修改 dump 中的 DDL、`COPY` 数据或用户备注，也不会接触 prod 数据库。恢复后会查询 5 张核心表做 sanity check。

### 显式 SQL 清单（spec §5.4）

`run-queries.sh` 不 glob 遍历 `sql/`，而是维护显式数组。新增 SQL 必须同步：
1. 添加 `sql/<name>.sql`
2. 在 `run-queries.sh` 的 `SQL_FILES` 数组追加
3. 在 `render.mjs` 消费 `${name}.csv`

### 时间窗口与陈旧快照

- 查询统一采用半开区间 `[anchor-window, anchor)`，相邻报表不会重复计入边界记录。
- 自动模式若最新 dump 已超过 48 小时，会发送告警且不生成陈旧报告。
- 手动 `--dump` 允许分析历史快照，但会显示醒目警告。
- `--anchor` 必须显式携带 `+08:00` 或 `Z` 时区。

### 阈值规则

超过阈值时，报告中该节显示前 N 条明细 + 分维度统计，不会丢失汇总数据。
阈值可在 `/data/conf/analytics.env` 中覆盖（`THRESHOLD_USERS` 等），留空则使用 `config.mjs` 默认值。

---

## 变更日志

- **v0.1（2026-07-21）**：首版实现，覆盖 spec v0.1.1 全部功能
