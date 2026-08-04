# devops-ops · state.md

> 角色规则来源：`.team/agents/05-devops-agent.md`
> 公共契约：`.team/agents/COMMON-CONTRACT.md` §0 / §0-Bis / §8ter
> Schema：`.team/members/README.md §2`
> 初始化：2026-05-02 19:24

---

## §1 角色身份

装扮型 subagent · 每次 spawn 全新上下文 · 装扮成 devops-ops（旧 DevOps-Agent）执行基建 / CI / 发布职责。

- 角色文件：`.team/agents/05-devops-agent.md`
- 不走审查 subagent · Human 直审（涉及生产 / 密钥 / 域名）

## §2 当前关注（active tasks）

- Todo: COSTRA-114（开发服务器 bootstrap 手册 · I-003 未开工）
- 其他: COSTRA-108（miniprogram-ci 演练）/ COSTRA-117（husky v10 兼容）
- **2026-05-23**：路径 α Phase-1 prod-bootstrap 手册 v1.0 + prod-readiness-checklist v1.0 落盘（与 D-026 同对话轮交付 · Orchestrator 兜底落档 · 见 D-026 §6.1 incident 备注 · 等 Human SSH 49.235.216.20 跑 §1~§8）
- **2026-07-21**：`analytics/` 行为分析项目全量实现（spec v0.1.1 · 24 项语法检查通过 · 端到端 mock 渲染验收通过）

## §3 交付历史索引

- （无 · 从下一次装扮开始记录）
- 2026-05-23：`infra/prod-bootstrap.md` v1.0 + `infra/wechat/prod-readiness-checklist.md` v1.0（Orchestrator 兜底交付 · devops-ops 装扮档工具白名单错配 incident 见 D-026 §6.1 · 候选 Sprint-3 末 Retro 议题 #6）
- 2026-07-21：`analytics/` 行为分析项目全量实现（见 history/2026-07-21-analytics-impl-brief.md）

## §4 最近决策影响

- `D-018 SBAI v1.0`
- `D-009 域名红线`
- COSTRA-115 DNS + 白名单 CI 收官
- **`D-023 prod 入口回归根域`**（2026-05-18）
- **`D-026 staging-prod 合并接受方案 + 工程纪律 4 条`**（2026-05-23 · C1 灰度隔离 / C2 mock 防护 / C3 DB 操作三件套 / C4 测试数据隔离）

## §5 工作区 + 权限

可写目录：`infra/` / 各模块 `.github/workflows/` / `scripts/devops/` / `.team/members/devops-ops/`
禁写：其他目录 · 特别是 `server/` 与业务代码

## §6 遗留问题 / FU / 债务

- husky v10 DEPRECATED 警告（COSTRA-117 处理）
- 开发服务器 `49.235.216.20` 2026-07-23 到期提醒
- **2026-05-23 prod-bootstrap §10 后续加固 7 条 FU**（候选 Sprint-4 头部专项加固 sprint · 累计 13 pt）：
  - FU-PROD-NON-ROOT-USER（P1 1pt · systemd User 改非特权用户）
  - FU-PROD-LOG-ROTATE（P2 1pt · /var/log/costra logrotate）
  - FU-PROD-PG-BACKUP（P1 2pt · 每日 dump 到腾讯云 COS）
  - FU-PROD-MONITORING（P2 3pt · Prometheus + AlertManager）
  - FU-PROD-CI-DEPLOY（P1 3pt · 自动 deploy + 回滚）
  - **FU-PROD-CI-MOCK-GUARD**（P0 1pt · whitelist-check.mjs 规则 E · D-026 §2.3 C2 静态扫描）
  - FU-PROD-FW-AUDIT（P0 2pt · D-009 §2.4 防火墙 + fail2ban + SSH 改非 22 端口一次性补齐）

## §7 最近更新时间戳

- 2026-07-21T21:00:00+08:00 · analytics/ 行为分析项目全量实现 · spec v0.1.1 全覆盖
- 2026-05-23T20:30:00+08:00 · 路径 α Phase-1 prod-bootstrap 落档 · D-026 配套交付（Orchestrator 兜底）
- 2026-05-02T19:24:00+08:00 · 初始化骨架（by Orchestrator）
