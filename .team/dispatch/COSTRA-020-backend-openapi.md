# 任务派单 · COSTRA-020 OpenAPI v0.1（wx.login + 记账核心）

> ✅ **DONE**（Orchestrator `execute-now` 代笔落地 · 2026-04-21 17:45）
> 产物回链：`server/api/openapi.yaml`（主位） · `api/openapi.yaml`（前端镜像位） · `docs/api/{README,conflict-strategy,audit-log}.md`
> 闸门：**G3 Ready for Review**（前端双签待确认字段命名 snake/camel 与 LWW 策略）

---

- **Owner**: Backend-Agent
- **Priority**: P0
- **派发时间**: 2026-04-21 15:29（Orchestrator）
- **完工时间**: 2026-04-21 17:30（Orchestrator 代笔）
- **依赖**: `docs/PRD.md` Epic-A/B/C AC、`ADR-0004` §3 Token / §4 审计 / §8 金额
- **产物路径**: `server/api/openapi.yaml`、`docs/api/README.md`
- **预计工期**: 1.5 个工作日（与 COSTRA-021 并行）

---

## 1. 目标

产出覆盖 MVP 最小路径的 OpenAPI 3.1 契约，**冻结字段命名**（CamelCase 前端 / snake_case 后端由 ADR 决定，需先在 ADR-0004 §补遗中明确）。

## 2. 必须覆盖的接口（v0.1 最小集）

| 路径 | 方法 | 关联 Story |
|---|---|---|
| `/v1/auth/wx-login` | POST | COSTRA-101 |
| `/v1/auth/refresh` | POST | COSTRA-103 |
| `/v1/auth/bind-phone` | POST | COSTRA-102 |
| `/v1/accounts` | GET / POST | COSTRA-111 |
| `/v1/accounts/{id}` | GET / PATCH / DELETE | COSTRA-111 |
| `/v1/categories` | GET / POST | COSTRA-112 |
| `/v1/ledger/entries` | POST | COSTRA-113 |
| `/v1/ledger/entries` | GET（分页 + 筛选） | COSTRA-114 |
| `/v1/sync/pull` | GET（增量，带版本号） | COSTRA-122 |
| `/v1/sync/push` | POST（增量，带冲突） | COSTRA-122 / 123 |

## 3. 验收标准（AC）

### AC-1 契约规范
- [ ] OpenAPI 3.1，`info.version=0.1.0`，`servers` 含 `dev/staging/prod` 三环境
- [ ] 错误统一用 RFC 7807 `application/problem+json`；字段名 `errcode/errmsg` 对齐微信 SDK（ADR-0004 §Backend 接口字段）
- [ ] 鉴权统一 `bearerAuth`（JWT，见 ADR-0004 §3）
- [ ] **金额字段全部用字符串整数（分）+ currency**，文档中明确 decimal 精度

### AC-2 字段冻结
- [ ] 为每个实体（Account / Category / Entry / SyncPayload）定义 JSON Schema
- [ ] 列出与 MiniApp-Agent 约定的**共享枚举**：账户类型 / 分类图标 / 交易类型 / 冲突策略
- [ ] 同步接口定义 `cursor` / `server_version` / `conflicts[]` 契约

### AC-3 审计 & 限流 & 幂等
- [ ] 敏感写接口（`POST /entries`、`POST /sync/push`、`/auth/*`）要求 `Idempotency-Key` Header
- [ ] 限流说明（建议：登录 10/min，写入 60/min，按 ADR-0004 §4）
- [ ] 审计事件说明（哪些接口落 audit_log）

### AC-4 工程约束
- [ ] 引用微信 `code2Session` 官方接口签名：<https://developers.weixin.qq.com/miniprogram/dev/OpenApiDoc/user-login/code2Session.html>
- [ ] 提交：`feat(api): openapi v0.1 (auth + ledger + sync)`
- [ ] `Refs: COSTRA-020, ADR-0004`
- [ ] PR 里 @ MiniApp-Agent 做字段双签（G3 前置）

## 4. 输出清单

| 文件 | 必需 |
|---|---|
| `server/api/openapi.yaml` | ✅ |
| `docs/api/README.md`（快速上手 + 错误码） | ✅ |
| `docs/api/conflict-strategy.md`（同步冲突规则） | ✅ |

## 5. 完成时动作（同 COSTRA-010 §5）
