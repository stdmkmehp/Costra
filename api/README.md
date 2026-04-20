# API 契约区

本目录是 **前后端共享的事实源（Single Source of Truth）**。

- `openapi.yaml`：RESTful 接口契约（由 Backend-Agent 维护，iOS-Agent 消费）
- `asyncapi.yaml`：WebSocket / 推送契约（可选）
- `CHANGELOG.md`：契约变更记录（破坏性变更必须走 ADR）

**规则**：
1. 代码实现之前，先在此提交契约变更 PR。
2. 任何字段名 / 类型 / 状态码变更，必须由 PM-Agent 发起"契约评审"闸门 G3。
3. OpenAPI diff 由 CI 自动检测，破坏性变更阻塞合并。
