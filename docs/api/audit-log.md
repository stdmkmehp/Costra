# 审计日志（Audit Log）

> **目标**：记录所有对持久化状态产生变更的动作，满足合规、排障、家庭场景的"谁改了什么"可追溯。
> **Owner**：Backend-Agent · **留存**：≥ 180 天（分区表，冷数据归档）

---

## 1. 触发时机

所有成功完成的写操作（HTTP 2xx）**异步**写一条审计。失败写操作（4xx/5xx）**不写**，但记 trace 日志。

**覆盖端点**（非穷举，见 OpenAPI `tags`）：
- `/auth/*`（登录 / 刷新 / 登出）
- `/users/me` PATCH
- `/families/*` POST / PATCH / DELETE，邀请相关
- `/ledgers` POST / PATCH / DELETE
- `/categories` POST / PATCH / DELETE
- `/entries` POST / PATCH / DELETE
- `/budgets` POST / PATCH / DELETE
- `/sync/push`（每条 op 产生一条）

---

## 2. 日志结构

```
audit_logs (
  id              uuid primary key,
  occurred_at     timestamptz not null default now(),
  actor_user_id   uuid not null,
  family_id       uuid,         -- 命中家庭范围的必填
  entity          text not null, -- 'entry' / 'family' / ...
  entity_id       uuid,
  action          text not null, -- 'create' / 'update' / 'delete' / 'login' / ...
  before_version  int,
  after_version   int,
  diff            jsonb,        -- 字段级 diff（仅 update 填）
  client          jsonb,        -- { platform, version, ua, ip_hash }
  trace_id        text,
  idempotency_key text
)
```

### diff 示例

```json
{
  "amount": { "from": 10000, "to": 12000 },
  "note":   { "from": "午饭", "to": "午饭+咖啡" }
}
```

---

## 3. 查询能力（MVP）

- **家庭内时间线**：`family_id` + 时间倒序（供"家庭活动流"页）
- **单实体历史**：`entity + entity_id` + 时间升序（供"修改记录"面板）
- **按操作人**：`actor_user_id`（合规场景）

> MVP **不提供** 回滚按钮；审计仅用于查看。

---

## 4. 隐私与合规

- `client.ip_hash`：IP 不落库原文，仅存 HMAC-SHA256（密钥按季轮换）
- `diff.note`：可能含用户明文，按"一般个人信息"分类存储（非敏感个人信息）
- 删除/退出家庭时，**本人产生的审计保留**（合规需要），对"普通查看者"在家庭 UI 不再可见
- 用户行使"删除账号"权利时：审计中 `actor_user_id` 匿名化为 `anon-<hash>`，原字段保留 90 天以应对争议

---

## 5. 留存与清理

- 分区：按月分区表（`audit_logs_y2026m04` ...）
- 热数据：近 180 天在线可查
- 冷数据：180 天以后归档至对象存储（gzip + parquet），可按需导出

---

## 6. 与 QA / DevOps 的握手

- **QA**：冒烟用例 ${smoke_audit_01}：新建一条 entry → 查询 `audit_logs` 存在 1 条 `action=create`，`diff is null`
- **DevOps**：Grafana 看板需展示 `audit_logs` 每分钟写入速率、5xx 异常占比
