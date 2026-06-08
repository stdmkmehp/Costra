# D-010 · COSTRA-100 G3 补齐交付（含 COSTRA-113 搭车）

- **签发**：Backend-Agent（Orchestrator 触发）
- **时间**：2026-04-23 17:50
- **触发**：Human `开干 COSTRA-100`
- **关联**：D-006 §5（5 项补齐）· D-008（主体策略搭车）· G3 闸门 approve-with-follow-up 闭环

---

## 1. 交付清单（6 份产物）

| # | 类型 | 路径 | 作用 |
|---|---|---|---|
| 1 | 文档 | `docs/api/error-codes.md` | 21 条错误码字典 + 客户端重试矩阵 + 文案映射 + QA 断言 + DevOps 告警规则 |
| 2 | 代码 | `server/src/errors/ErrorCode.ts` | TS 枚举 + HTTP 状态映射 + 重试策略映射 + 守卫函数 |
| 3 | 文档 | `docs/api/ttl-policy.md` | 全链路 TTL 总表（access/refresh/invite/幂等/审计/游标/限流） |
| 4 | 契约 | `server/api/openapi.yaml` | 注入 `ErrorCode` 枚举；`Error.code` 引用枚举；`AuthTokenPair` 加 `access_token_ttl_sec` + `refresh_token_ttl_sec`（`expires_in` 标 deprecated） |
| 5 | 文档 | `docs/api/id-strategy.md` | UUIDv7（服务端）· client_ref_id（UUIDv4，客户端本地）· Idempotency-Key（UUIDv4，写请求级）三层 ID 规范 |
| 6 | 文档 | `docs/api/sync-protocol.md` | `/sync/push` + `/sync/pull` 完整批协议 · 3 态 results · 端到端时序 · 并发保证 · QA 钩子 |
| 7（搭车） | 代码 | `server/src/config/subject.ts` | D-008 主体配置加载器 + 模板占位渲染 |
| 8（搭车） | 配置 | `server/.env.production.example` | SUBJECT_* 段（个人 / 公司两套模板） |
| 9 | 文档 | `docs/api/README.md` | 更新错误码章节链接 + 相关文档索引 |

---

## 2. 关键决策点

### 2.1 ID 策略选 UUIDv7（而非 ULID / Snowflake）
- 与现有 OpenAPI `format: uuid` **零契约变更**
- 时间有序，B-tree 索引写放大问题消失
- 标准化（RFC 9562），生态成熟

### 2.2 TTL 字段命名：废弃 `expires_in`，引入 `access_token_ttl_sec` + `refresh_token_ttl_sec`
- 原 `expires_in` 只盖 access，不表达 refresh
- 新字段显式语义 + 统一秒数单位
- `expires_in` 保留为 deprecated，v0.2 移除，过渡期客户端两者可读

### 2.3 错误码 21 条定版
- 覆盖 400/401/403/404/409/410/422/429/5xx 全谱
- **客户端以 `code` 判分支**写入契约铁律
- `BUSINESS_RULE_VIOLATION` 用 `details.rule` 枚举承接业务差异化，避免错误码膨胀

### 2.4 Sync Protocol 的 3 态 result（ok / conflict / rejected）
- 批次整体 200；部分失败不中断批
- `conflict` 和 `rejected` 语义严格分离：前者走合并，后者走业务反馈

### 2.5 COSTRA-113 搭车实装
- `loadSubjectConfig()` 启动期冻结
- `renderSubjectTemplate()` 提供给服务端渲染隐私指引 / 用户协议 / 审计 data_controller 字段

---

## 3. OpenAPI 破坏性变更评估

| 变更 | 类型 | 影响 |
|---|---|---|
| 新增 `ErrorCode` 枚举 | 非破坏 | 新 schema，不影响旧客户端 |
| `Error.code` 从 string → ErrorCode 枚举 | **半破坏** | 服务端实际返回值没变（一直是这些字符串）；但强 codegen 的客户端会收紧类型。MiniApp 尚未启用 codegen，当前零影响 |
| `AuthTokenPair.required` 加 `access_token_ttl_sec` / `refresh_token_ttl_sec` | **半破坏** | 旧客户端（Sprint-0 Mock）不读这俩字段，无影响；Sprint-1 真实登录起强制读 |
| `expires_in` → deprecated | 非破坏 | 字段仍在，小版本号不变；v0.2 移除走 ADR |

**综合结论**：**v0.1.0-draft → v0.1.1-draft**（小版本升级，无需 G3 二次评审）。

---

## 4. Follow-up（不在本卡内，下个 Sprint 处理）

- `server/src/` 目录的其他基础设施（`AppError` 类 / 全局 errorHandler / JWT 签发器 / idGen）落地 → COSTRA-101（登录实装）里顺手做
- MiniApp 侧 `utils/error-mapper.ts` 对齐 21 条 code → COSTRA-102（真实登录端到端）
- DB 迁移：`ledger_entries` 加 `client_ref_id + UNIQUE(created_by, client_ref_id)` → COSTRA-103 / 104 内合入
- OpenAPI mirror CI 校验（server/ 与 api/ 两份一致）→ 首次 Sprint-1 CI 配置时验证

---

## 5. 看板流转

- COSTRA-100 Doing → **Review**
- COSTRA-113 Doing → **Review**（搭车交付）
- G3 闸门：approve-with-follow-up → 待 Human Review 本批后置为纯 Approved

---

## 6. 待 Human Review 项

1. 错误码字典是否覆盖你预期的场景（尤其 `BUSINESS_RULE_VIOLATION.rule` 枚举是否完整）
2. TTL 取值是否接受（access 2h / refresh 30d / invite 24h 默认）
3. UUIDv7 作为服务端主键是否 OK（可选 v4 回退，但会吃索引写放大）
4. `/sync/push` 批量上限 200 条、单 op 8KB 是否符合你对小程序离线场景的预估

**批复指令**：
- `approve:COSTRA-100` → 两卡 Review → Done，G3 转纯 Approved
- `revise:COSTRA-100 <改哪>` → 打回重做
- `block:COSTRA-100 <理由>` → 挂起进 Blocked
