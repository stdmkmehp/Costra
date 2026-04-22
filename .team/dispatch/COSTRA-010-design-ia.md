# 任务派单 · COSTRA-010 信息架构 + 用户故事地图

> ✅ **DONE**（Orchestrator `execute-now` 代笔落地 · 2026-04-21 17:45）
> 产物回链：`docs/design/ia.md` · `docs/design/user-story-map.md` · `docs/design/flows/{login,add-entry,family-invite,budget-subscribe-msg}.md`
> 闸门：**G2 Ready for Review**（待 Human 评审）

---

- **Owner**: Design-Agent
- **Priority**: P0
- **Parent Epic**: 跨 Epic-A~G 总览
- **派发时间**: 2026-04-21 15:29（Orchestrator）
- **完工时间**: 2026-04-21 17:10（Orchestrator 代笔）
- **依赖**: `docs/PRD.md` v0.1 ✅、`docs/charter.md` v2.2 ✅、`ADR-0004` ✅
- **产物路径**: `docs/design/ia.md`、`docs/design/user-story-map.md`（可含配套 mermaid/drawio）
- **预计工期**: 1 个工作日（与 COSTRA-011 并行）

---

## 1. 目标

把 PRD 里的 Epic-A~G / 21 个 Story 翻译成**小程序端可落地**的三件套：
1. **信息架构图（IA）**：TabBar、页面树、分包归属
2. **用户故事地图（User Story Map）**：骨干 Activities → Tasks → Stories 的三层网格
3. **关键流程时序**：微信登录、记一笔、家庭邀请、订阅消息下发 4 条核心链路

## 2. 输入

- `docs/PRD.md` §Epic-A~G（AC 以此为准）
- `docs/charter.md` §6 目标用户 / §13 工程约束
- `.team/decisions/ADR-0004-miniapp-runtime-details.md`（**分包策略要对齐**：主包 `pages/`，分包 `pages-stat/`（统计）、`pages-family/`（家庭））
- 微信官方文档 · [页面路由与分包](https://developers.weixin.qq.com/miniprogram/dev/framework/subpackages/)

## 3. 验收标准（AC）

### AC-1 IA 完整性
- [ ] 列出 **TabBar 3~4 项**（建议：首页记账 / 家庭 / 统计 / 我的），给出每个 tab 的默认路由
- [ ] 页面树覆盖 PRD 全部 21 个 Story，每个叶子页面标注：
  - 所属分包（main / pages-stat / pages-family）
  - 依赖的 API 调用（占位，如 `POST /v1/ledger/entries`）
  - 是否需要登录态
- [ ] 主包体积预算 ≤ 1.5MB（预留 0.5MB 给后续）；分包单个 ≤ 2MB

### AC-2 User Story Map
- [ ] 三层结构：Backbone（活动）→ Walking Skeleton（MVP 最小路径）→ Release Slice（R1/R2 切片）
- [ ] MVP 最小路径至少覆盖：登录 → 记一笔 → 查看流水 → 加入家庭 → 看月度统计
- [ ] 每个 Story 节点标注 COSTRA-xxx、估点、Epic 归属

### AC-3 核心流程时序
- [ ] 4 张 mermaid `sequenceDiagram`：
  1. 微信登录（MiniApp ↔ Backend ↔ 微信 `code2Session`）
  2. 记一笔 + 本地先写 + 异步同步（含冲突兜底）
  3. 家庭邀请（生成邀请码 → 分享卡片 → 被邀成员接受）
  4. 预算超支订阅消息下发（后端 cron → 订阅消息 API → 小程序跳转）
- [ ] 每张图标注耗时预算（首屏 ≤ 2s、接口 ≤ 800ms）

### AC-4 工程约束遵循（§13）
- [ ] 所有引用的微信能力必须附官方文档锚点 URL
- [ ] 交付时按 Conventional Commits 提交：`feat(design): IA + user story map v0.1`
- [ ] `Refs: COSTRA-010` / 若影响契约补 `Impacts: COSTRA-020`

## 4. 输出清单

| 文件 | 必需 |
|---|---|
| `docs/design/ia.md` | ✅ |
| `docs/design/user-story-map.md` | ✅ |
| `docs/design/flows/login.md`（含 mermaid） | ✅ |
| `docs/design/flows/add-entry.md` | ✅ |
| `docs/design/flows/family-invite.md` | ✅ |
| `docs/design/flows/budget-subscribe-msg.md` | ✅ |

## 5. 完成时动作

1. 向 `.team/messages/2026-04-21.jsonl` 追加：
   ```json
   {"from":"Design-Agent","to":"Orchestrator","type":"artifact_ready","task_id":"COSTRA-010",...}
   ```
2. 登记 `.team/tool_calls/2026-04-21.jsonl`
3. Git 提交 + 在消息里带 commit sha
4. 等待 Orchestrator 推进到 Review；**不要自行置 Done**
