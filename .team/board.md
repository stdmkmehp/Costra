# Costra 任务看板

> 由 PM-Agent 维护，所有 Agent 可读，状态流转必须经过 Orchestrator。
> 约定流转：`Backlog → Todo → Doing → Review → Done`，Blocked 为横向态。

最后更新：`2026-04-21 17:45`（Orchestrator · `execute-now` 模式完成五条线 artifact 交付 / 7 卡全部进入 Review）

---

## 🗂 Backlog（需求池，详见 backlog.json）
- Epic-A 账号体系（微信登录）
- Epic-B 单人记账
- Epic-C 本地存储 + 云同步
- Epic-D 家庭共享（邀请码 + 微信分享 + 订阅消息）
- Epic-E 预算 / 周期账单
- Epic-F 统计报表
- Epic-G 上线与运营（微信审核 / 分阶段发布）

## 📋 Todo
_（Sprint-0 已全部就绪；Sprint-1 任务待 G2/G3 审批后填充）_

## 🔄 Doing
_（空）_

## 👀 Review（2026-04-21 17:45 · `execute-now` 批量回收）

| 卡号 | 标题 | Owner | 产物主路径 | 闸门 |
|---|---|---|---|---|
| COSTRA-010 | 信息架构 + 用户故事地图 | Design-Agent | `docs/design/ia.md` · `docs/design/user-story-map.md` · `docs/design/flows/*.md` | G2 待评 |
| COSTRA-011 | 设计系统 v0.1 + 分享卡片 | Design-Agent | `docs/design/tokens.json` · `docs/design/design-system.md` · `docs/design/share-cards/*.md` | G2 待评 |
| COSTRA-020 | OpenAPI v0.1 + 错误/冲突/审计 | Backend-Agent | `server/api/openapi.yaml` · `api/openapi.yaml` · `docs/api/*.md` | G3 待双签 |
| COSTRA-021 | DB Schema v1 + docker-compose | Backend-Agent | `server/db/migrations/*.sql` · `server/docker-compose.yml` · `docs/db/schema.md` | G3 待评 |
| COSTRA-030 | 小程序工程骨架 + 登录 Mock 闭环 | MiniApp-Agent | `miniprogram/**` · `project.config.json` · `tsconfig.json` · `package.json` · `.eslintrc.json` · `.husky/*` · `miniprogram/README.md` | G2/G3 后 |
| COSTRA-040 | CI/CD 占位流水线 + mp-ci 脚本 | DevOps-Agent | `.github/workflows/*.yml` ×4 · `scripts/mp-ci/*.mjs` ×5 · `docs/devops/*.md` ×3 · `.env.example` | G5 Preempt |
| COSTRA-050 | 测试策略 + 冒烟 + 微信审核自查 | QA-Agent | `docs/qa/test-strategy.md` · `docs/qa/smoke-cases.md` · `docs/qa/wechat-review-checklist.md` | G2/G3 后 |

## 🚧 Blocked
_（无硬阻塞。COSTRA-040 "真实上传链路激活"仍依赖外部资源，详见 `docs/devops/secrets.md §激活清单`；占位流水线不受影响。）_

## ✅ Done
- [D] COSTRA-001 项目章程与目标对齐   @PM-Agent   · 2026-04-21 G1 通过 · charter.md v2.2
- [D] COSTRA-002 PRD v0.1（MVP · 小程序版）   @PM-Agent   · 2026-04-21 G1 通过 · docs/PRD.md
- [D] COSTRA-003 技术栈 ADR 评审   @PM-Agent   · 2026-04-21 G1 通过

---

## 🚦 闸门状态

| 闸门 | 状态 | 发起者 | 链接 |
|---|---|---|---|
| **G1 PRD** | ✅ **Approved** · 2026-04-21 15:22 | PM-Agent | `docs/PRD.md` v0.1 |
| **G2 设计** | 🟢 **Ready for Review** · 2026-04-21 17:45 | Design-Agent | `docs/design/` |
| **G3 契约** | 🟢 **Ready for Review**（前端双签待确认） · 2026-04-21 17:45 | Backend-Agent | `docs/api/` · `api/openapi.yaml` |
| G4 合并 | ⬜ 未开始（待 Sprint-1） | — | — |
| **G5 发布** | 🟣 **Preempt-Ready** · 占位流水线已落地 | DevOps-Agent | `.github/workflows/*` · `docs/devops/` |

---

## 🔗 `execute-now` 成果速览

```
execute-now 启动：2026-04-21 15:44
execute-now 完成：2026-04-21 17:45
耗时：约 2 小时（Orchestrator 代笔，非异步 Agent）
产物文件总数：约 70+（不含 .gitkeep）
0 字节残留：0（已核查）
```

关键节点：
- **Design 线**：9 份 Markdown + 1 份 tokens.json；IA / 故事地图 / 4 条流程时序 / 设计系统 / 4 套分享卡片
- **Backend 线**：2 份 OpenAPI（主位 + 镜像位）+ 3 份 API 文档 + 2 份 SQL 迁移 + docker-compose + schema 文档
- **MiniApp 线**：`miniprogram/` 完整骨架（主包 4 页 + 分包 4 页 + services ×6 + utils ×2 + tokens 桥接 + components 占位）+ 根工程配置（TS / ESLint / Prettier / husky / commitlint / package.json / README）
- **DevOps 线**：4 个 workflow（pr-check / main-build / mp-preview / mp-release）+ 5 个 mp-ci 脚本（preview / upload / size-check / analyze / build-check + _lib）+ 3 份手册 + `.env.example` 对齐
- **QA 线**：测试策略 v0.1 / 17 条冒烟用例 / 微信审核 12 大类自查清单

---

## 📌 外部资源进度（charter §9 同步，无变化）

| 资源 | 状态 |
|---|---|
| 微信小程序 AppID（生产） | ✅ `wxf8b0d3e3a83f9941` |
| 小程序类目 | ✅ 生活 → 记账工具 |
| 微信小程序 AppID（体验） | ⏳ 待 Human |
| 企业主体认证 | ⏳ 待 Human |
| 订阅消息模板 ×3 | ⏳ 待 Human |
| 服务器域名 + ICP + HTTPS | ⏳ 待 Human |
| `miniprogram-ci` robot key | ⏳ 待 Human |
| 《用户隐私保护指引》 | ⏳ 待 Human（`miniprogram/pages-family/privacy/index.wxml` 占位待替换） |

---

## 🧭 下一次 Human 介入节点

1. **G2 设计评审**：审 `docs/design/` 全集，尤其 `ia.md` / `user-story-map.md` / 4 条 flows
2. **G3 契约双签**：审 `api/openapi.yaml` + `docs/api/conflict-strategy.md`，确认字段命名（snake/camel）与冲突策略
3. **MiniApp 骨架验证**：用微信开发者工具导入仓库根，确认 Mock 登录闭环能跑
4. **DevOps 占位流水线 Review**：审 `.github/workflows/*` 与 `docs/devops/*`
5. **QA 策略 Review**：审测试分层与冒烟集
6. **（可选）补齐资源清单** → 激活 COSTRA-040 真实上传链路

---

## 💤 Orchestrator 状态

- **MODE**：`wait`（全部 Review 态，等 Human 批量评审）
- **中断条件**：Human 给出 `approve:COSTRA-xxx` / `revise:COSTRA-xxx` / `status` / `next-sprint` 等指令
- **保存点**：所有产物已落盘，conversation 可随时中断续作
