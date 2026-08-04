# 2026-07-21 · analytics/ 行为分析项目全量实现 · brief

## 1. 任务摘要

按 `docs/ops/analytics-daily-tech-spec.md` v0.1.1 全量实现 `analytics/` 行为分析项目。新建独立顶层目录，与 prod infra 完全隔离。

## 2. 交付清单

| 文件 | 说明 |
|---|---|
| `analytics/docker-compose.yml` | 独立 postgres:15，容器名 costra-analyze-pg，端口 127.0.0.1:15432 |
| `analytics/.env.example` | 全量配置示例（checked-in） |
| `analytics/package.json` | nodemailer + marked，type=module |
| `analytics/.gitignore` | 排除 .env / reports / .tmp / node_modules |
| `analytics/config.mjs` | 阈值配置（users=5/ledgers=5/entries=20/invites=5/active=8） |
| `analytics/scripts/analyze.sh` | 主入口（6步骤骨架 + ERR trap + STDOUT_MODE） |
| `analytics/scripts/lib/common.sh` | 独立公共库（log/die/load_env/file_mtime · 不 source infra/） |
| `analytics/scripts/lib/parse-args.sh` | --dump/--window/--anchor/--stdout/-h 解析 |
| `analytics/scripts/pick-dump.sh` | 选定 dump（自动最新 or 指定 · 无 dump 发告警邮件） |
| `analytics/scripts/restore-schema.sh` | gunzip \| sed \| psql → 临时 schema + sanity check |
| `analytics/scripts/run-queries.sh` | 显式清单执行 SQL（不 glob） |
| `analytics/scripts/render.mjs` | CSV → template → md + subject.txt（双模式：get-path-only / 实际渲染） |
| `analytics/scripts/send-mail.mjs` | md → HTML → QQ SMTP |
| `analytics/scripts/send-failure-mail.mjs` | ERR trap + no-dump 告警邮件 |
| `analytics/scripts/check-syntax.mjs` | 语法自检脚本（24 项） |
| `analytics/sql/10-summary.sql` ~ `90-anomaly.sql` | 7 个 SQL（spec §6 全文） |
| `analytics/templates/common.mjs` | fmtAmount/fmtBadge/fmtCategory/parseCsv/sparkline 等 |
| `analytics/templates/daily.mjs` | 日报 template（< 2d） |
| `analytics/templates/range.mjs` | 区间报告 template（2d~7d） |
| `analytics/templates/weekly.mjs` | 周报 template（≥ 7d · sparkline） |
| `analytics/cron/costra-analyze` | /etc/cron.d/ 配置（日报 23:59 · 周报 周日 23:58） |
| `analytics/README.md` | 完整部署/使用文档 |

## 3. 验证结果

- **Bash 语法检查**：6 个 .sh 文件全部通过（`bash -n`）
- **JS 语法检查**：9 个 .mjs 文件全部通过（`node --check`）
- **check-syntax.mjs 综合自检**：24/24 通过
- **日报渲染端到端**：mock 12 条 entries → 正确渲染表格 + 汇总 + 分账本 + 分类 Top5
- **截断逻辑**：27 条 > 阈值 20 → "条数超过阈值（20），仅列前 20" 正确触发
- **周报 sparkline**：`▁▁▁▁▁▁█`（07-21 峰值 12 条）正确
- **区间报告**：3d window → range template 正确选择
- **duration 解析**：24h/7d/30d/15m/168h 全部正确
- **macOS 兼容**：file_mtime_iso / iso_to_epoch / epoch_to_readable 均在 macOS 验证通过

## 4. 与 spec 的差异（更正确的设计）

| # | 差异点 | 说明 |
|---|---|---|
| D1 | `render.mjs` 双模式（`--get-path-only` + `--out`） | spec 骨架里 analyze.sh 先调 render 获取路径再渲染。实现时合并为同一脚本的两个模式，减少代码重复 |
| D2 | `analyze.sh` 通过 `source pick-dump.sh` 而非 `bash` 调用 | pick-dump.sh 需要 export 变量到父 shell，source 是正确做法 |
| D3 | sparkline bucket 以 anchor 当天为最后一天 | spec 未明确，但语义上"7d 窗口"应包含 anchor 当天（07-15~07-21），实现修正了初版的 off-by-one |
| D4 | `send-failure-mail.mjs` 接受 `--inbox-list` 字符串参数 | bash 里多行字符串传参用字符串更简单，避免临时文件 |
| D5 | `check-syntax.mjs` 额外脚本 | spec 未要求，但 §9（执行能在本机做的测试）明确要求，主动补充 |

## 5. 后续建议

- Phase 1：用户在 analyze host 上 `cp .env.example .env && vim .env && docker compose up -d`
- Phase 2：`./scripts/analyze.sh --stdout` 验收 md 格式（MAIL_TO=PLACEHOLDER 自动 stdout 模式）
- Phase 3：填真实 MAIL_TO → 收到邮件闭环
- Phase 4：`sudo cp cron/costra-analyze /etc/cron.d/costra-analyze` → 观察一周
- v0.2 FU：留存曲线（需跨 dump 历史对比）
