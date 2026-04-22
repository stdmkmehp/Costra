# 任务派单 · COSTRA-050 测试策略 + 冒烟用例模板（含微信审核自查）

> ✅ **DONE**（Orchestrator `execute-now` 代笔落地 · 2026-04-21 17:45）
> 产物回链：`docs/qa/test-strategy.md` · `docs/qa/smoke-cases.md`（S-001~S-017 共 17 条） · `docs/qa/wechat-review-checklist.md`（A~L 12 大类）
> 闸门：**G2/G3 后可生效**（Sprint-1 起每个 PR 走 QA Gate 模板）
> 与 DevOps 对齐：PR 的 required status check 名 `ci/pr-check` 已统一。

---

- **Owner**: QA-Agent
- **Priority**: P1
- **派发时间**: 2026-04-21 15:29（Orchestrator）
- **完工时间**: 2026-04-21 17:27（Orchestrator 代笔）
- **依赖**: `docs/PRD.md` Epic-A~G AC、`ADR-0004`、`.team/engineering-guidelines.md`
- **产物路径**: `docs/qa/test-strategy.md`、`docs/qa/smoke-cases.md`、`docs/qa/wechat-review-checklist.md`
- **预计工期**: 1 个工作日

---

## 1. 目标

把 PRD 的 AC + NFR 翻译成**可执行的测试层次 + 冒烟集 + 微信审核自查清单**；为 Sprint-1 起每个 Story 的 PR 提供 QA checklist 模板。

## 2. 验收标准（AC）

### AC-1 测试策略
- [ ] 分层：单元（≥70% 覆盖 business / utils）、集成（API 契约 + DB）、E2E（微信开发者工具自动化 + miniprogram-automator）、非功能（性能 / 安全 / 兼容）
- [ ] 工具链建议（Jest / Vitest / supertest / miniprogram-automator / k6 / ZAP）
- [ ] **PR QA Gate 模板**：每个 PR 的 QA checklist（必须勾选项）

### AC-2 冒烟用例模板
- [ ] 至少 15 条冒烟（每次发布必跑），覆盖：
  - 登录闭环（COSTRA-101/103）
  - 记一笔全流程（COSTRA-113）+ 本地兜底
  - 流水筛选（COSTRA-114）
  - 家庭邀请扫码/分享卡片（COSTRA-201）
  - 订阅消息授权 → 下发（COSTRA-203/301/302）
  - 冷启 < 2s、主包体积、API 超时
- [ ] 每条用例给出：前置条件 / 步骤 / 期望结果 / 失败严重度

### AC-3 微信审核自查清单
- [ ] 基于官方审核指南产出 checklist：<https://developers.weixin.qq.com/miniprogram/product/>
- [ ] 包含：类目合规、隐私协议、头像昵称新规（2023-09 起）、订阅消息模板审核、用户身份证/手机号等敏感信息处理
- [ ] 产出 `docs/qa/wechat-review-checklist.md`

### AC-4 工程约束
- [ ] 所有微信规则引用官方锚点
- [ ] 提交：`test(qa): test strategy v0.1 + smoke cases + review checklist`
- [ ] `Refs: COSTRA-050, Epic-G`

## 3. 完成时动作（同 COSTRA-010 §5）
