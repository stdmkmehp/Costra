# Costra DB Schema v1

> **卡号**: COSTRA-021 · **Owner**: Backend-Agent · **更新**: 2026-04-21
> **约束来源**: `ADR-0004` §8 金额 / §10 时区 / §12 审计；`docs/charter.md` §13 工程约束
> **迁移脚本**: `server/db/migrations/0001_init.sql` + `0002_seed_system_categories.sql`
> **运行环境**: PostgreSQL 15，`TIMESTAMPTZ` 强制 UTC 存储

---

## 1. 设计原则

| # | 原则 | 说明 |
|---|---|---|
| P1 | **金额分存** | 所有金额字段使用 `BIGINT`（分），币种 `CHAR(3)` ISO-4217；严禁浮点 |
| P2 | **时间 UTC** | 所有时间字段使用 `TIMESTAMPTZ`，服务端统一按 UTC 存取；用户时区存 `users.timezone`，仅前端/报表层转换 |
| P3 | **软删除** | 全表 `deleted_at TIMESTAMPTZ NULL`；应用层查询默认 `WHERE deleted_at IS NULL` |
| P4 | **乐观锁** | 全表 `version INTEGER NOT NULL DEFAULT 1`；写入时 `WHERE version = :old` 并 `version = version + 1` |
| P5 | **共享/私有互斥** | 流水、账户、分类存在 `user_id` **或** `family_id`，二选一（CHECK 约束） |
| P6 | **增量游标** | `sync_versions` 表记录每个 (user/family, entity) 的最大 `version`，支持增量拉取 |
| P7 | **审计可追溯** | 家庭成员/角色变更、敏感写入写入 `audit_logs`，含 `actor_user_id + action + before/after(JSONB)` |
| P8 | **UUID 主键** | 全表 `UUID` 主键（`gen_random_uuid()`），避免泄露规模与便于离线生成 |

---

## 2. ER 总览

```
┌─────────┐      ┌─────────────────┐      ┌───────────┐
│  users  │◄─────┤ family_members  ├─────►│ families  │
└────┬────┘      └─────────────────┘      └─────┬─────┘
     │                                          │
     │                                          │
     ▼                                          ▼
┌─────────────┐  (owner = user_id OR family_id) ┌──────────┐
│  accounts   │◄──────────────────────────────►│ categories│
└──────┬──────┘                                 └─────┬────┘
       │                                              │
       └──────────┬───────────────────────────────────┘
                  ▼
          ┌───────────────┐
          │ ledger_entries│
          └───────┬───────┘
                  │
        ┌─────────┴──────────┐
        ▼                    ▼
 ┌──────────────┐    ┌────────────────┐
 │ sync_versions│    │   audit_logs   │
 └──────────────┘    └────────────────┘

附：subscribe_tokens（订阅消息一次性凭证）、feature_flags（运行时 Flag）
```

---

## 3. 表结构明细

### 3.1 `users` 用户

| 列 | 类型 | 说明 |
|---|---|---|
| `id` | UUID PK | `gen_random_uuid()` |
| `wx_openid` | TEXT UNIQUE NOT NULL | 微信 openid（登录主键） |
| `wx_unionid` | TEXT UNIQUE | 开放平台 unionid（可空） |
| `nickname` | TEXT NOT NULL | 昵称 |
| `avatar_url` | TEXT | 头像 URL |
| `timezone` | TEXT NOT NULL DEFAULT `'Asia/Shanghai'` | IANA 时区 |
| `created_at / updated_at / deleted_at / version` | 标准字段 | 见 P3/P4 |

索引：`idx_users_updated_at` on `updated_at`。

---

### 3.2 `families` 家庭

| 列 | 类型 | 说明 |
|---|---|---|
| `id` | UUID PK | — |
| `name` | TEXT NOT NULL | 家庭名称 |
| `invite_code` | TEXT UNIQUE NOT NULL | 6 位邀请码（大写字母+数字） |
| `owner_user_id` | UUID NOT NULL REFERENCES `users(id)` | 创建者 |
| `member_count` | INTEGER NOT NULL DEFAULT 1 | 冗余计数（由触发器维护） |
| `created_at / updated_at / deleted_at / version` | 标准字段 | — |

索引：`idx_families_owner` on `owner_user_id`。

---

### 3.3 `family_members` 家庭成员关联

| 列 | 类型 | 说明 |
|---|---|---|
| `id` | UUID PK | — |
| `family_id` | UUID NOT NULL REFERENCES `families(id)` | — |
| `user_id` | UUID NOT NULL REFERENCES `users(id)` | — |
| `role` | TEXT NOT NULL CHECK (role IN ('owner','admin','member')) | — |
| `joined_at` | TIMESTAMPTZ NOT NULL DEFAULT `now()` | — |
| `created_at / updated_at / deleted_at / version` | 标准字段 | — |

唯一键：`UNIQUE(family_id, user_id)`（排除软删）。索引：`idx_fm_user` on `user_id`。

---

### 3.4 `accounts` 资金账户

| 列 | 类型 | 说明 |
|---|---|---|
| `id` | UUID PK | — |
| `user_id` | UUID | 私有账户 |
| `family_id` | UUID | 家庭账户 |
| `name` | TEXT NOT NULL | 账户名 |
| `type` | TEXT NOT NULL CHECK (type IN ('cash','bank','credit','ewallet','other')) | — |
| `currency` | CHAR(3) NOT NULL DEFAULT `'CNY'` | ISO-4217 |
| `initial_balance_cents` | BIGINT NOT NULL DEFAULT 0 | 初始余额（分） |
| `is_archived` | BOOLEAN NOT NULL DEFAULT false | — |
| `created_at / updated_at / deleted_at / version` | 标准字段 | — |

约束：`CHECK ((user_id IS NOT NULL) <> (family_id IS NOT NULL))`（P5 互斥）。
索引：`idx_accounts_user / idx_accounts_family`。

---

### 3.5 `categories` 分类

| 列 | 类型 | 说明 |
|---|---|---|
| `id` | UUID PK | — |
| `user_id` | UUID | 用户自定义 |
| `family_id` | UUID | 家庭自定义 |
| `is_system` | BOOLEAN NOT NULL DEFAULT false | 系统预置（owner 为空） |
| `parent_id` | UUID REFERENCES `categories(id)` | 两级分类（最多 2 级） |
| `name` | TEXT NOT NULL | — |
| `icon` | TEXT | 图标键（对齐 `docs/design/design-system.md`） |
| `kind` | TEXT NOT NULL CHECK (kind IN ('expense','income','transfer')) | — |
| `sort_order` | INTEGER NOT NULL DEFAULT 0 | — |
| `created_at / updated_at / deleted_at / version` | 标准字段 | — |

约束：系统分类 `is_system=true AND user_id IS NULL AND family_id IS NULL`；否则 P5 互斥。
索引：`idx_categories_scope` on `(COALESCE(user_id, family_id), kind)`。

---

### 3.6 `ledger_entries` 流水主表（核心）

| 列 | 类型 | 说明 |
|---|---|---|
| `id` | UUID PK | — |
| `user_id` | UUID | 私有流水 |
| `family_id` | UUID | 家庭流水 |
| `creator_user_id` | UUID NOT NULL REFERENCES `users(id)` | 记录人 |
| `account_id` | UUID NOT NULL REFERENCES `accounts(id)` | — |
| `category_id` | UUID NOT NULL REFERENCES `categories(id)` | — |
| `kind` | TEXT NOT NULL CHECK (kind IN ('expense','income','transfer')) | — |
| `amount_cents` | BIGINT NOT NULL CHECK (amount_cents > 0) | 绝对值（分） |
| `currency` | CHAR(3) NOT NULL DEFAULT `'CNY'` | — |
| `occurred_at` | TIMESTAMPTZ NOT NULL | 业务发生时间（UTC 存储） |
| `note` | TEXT | 备注（≤200 字符） |
| `tags` | TEXT[] | 标签（≤5 个） |
| `media_keys` | TEXT[] | 附件对象存储 key |
| `transfer_peer_entry_id` | UUID REFERENCES `ledger_entries(id)` | 转账配对（kind='transfer' 时必填） |
| `created_at / updated_at / deleted_at / version` | 标准字段 | — |

约束：`CHECK ((user_id IS NOT NULL) <> (family_id IS NOT NULL))`。
**关键索引**（AC-1 明确要求）：
- `idx_ledger_user_occurred` on `(user_id, occurred_at DESC)` WHERE `deleted_at IS NULL`
- `idx_ledger_family_occurred` on `(family_id, occurred_at DESC)` WHERE `deleted_at IS NULL`
- `idx_ledger_account` on `account_id`
- `idx_ledger_category` on `category_id`
- `idx_ledger_updated` on `updated_at`（增量同步用）

---

### 3.7 `sync_versions` 同步游标

| 列 | 类型 | 说明 |
|---|---|---|
| `id` | UUID PK | — |
| `scope_type` | TEXT NOT NULL CHECK (scope_type IN ('user','family')) | — |
| `scope_id` | UUID NOT NULL | user_id 或 family_id |
| `entity` | TEXT NOT NULL CHECK (entity IN ('ledger_entries','accounts','categories','families','family_members')) | — |
| `max_version` | BIGINT NOT NULL DEFAULT 0 | 该实体的最大 version |
| `updated_at` | TIMESTAMPTZ NOT NULL DEFAULT `now()` | — |

唯一键：`UNIQUE(scope_type, scope_id, entity)`。

---

### 3.8 `audit_logs` 审计

| 列 | 类型 | 说明 |
|---|---|---|
| `id` | UUID PK | — |
| `actor_user_id` | UUID NOT NULL REFERENCES `users(id)` | 操作者 |
| `action` | TEXT NOT NULL | 如 `family.member.add` / `ledger.delete` |
| `target_type` | TEXT NOT NULL | 实体类型 |
| `target_id` | UUID | 实体 ID |
| `before` | JSONB | 变更前快照 |
| `after` | JSONB | 变更后快照 |
| `metadata` | JSONB | 附加信息（ip/ua/trace_id） |
| `created_at` | TIMESTAMPTZ NOT NULL DEFAULT `now()` | — |

索引：`idx_audit_actor_created` on `(actor_user_id, created_at DESC)`、`idx_audit_target` on `(target_type, target_id)`。

---

### 3.9 `subscribe_tokens` 订阅消息一次性 token

| 列 | 类型 | 说明 |
|---|---|---|
| `id` | UUID PK | — |
| `user_id` | UUID NOT NULL REFERENCES `users(id)` | — |
| `template_id` | TEXT NOT NULL | 微信订阅消息模板 ID |
| `scene` | TEXT NOT NULL | `budget_warn` / `family_invite` / `weekly_digest` |
| `consumed_at` | TIMESTAMPTZ | 已使用时间 |
| `expires_at` | TIMESTAMPTZ NOT NULL | 过期时间 |
| `created_at` | TIMESTAMPTZ NOT NULL DEFAULT `now()` | — |

索引：`idx_subtoken_user_scene` on `(user_id, scene)`。

---

### 3.10 `feature_flags` 运行时 Flag

| 列 | 类型 | 说明 |
|---|---|---|
| `key` | TEXT PK | Flag 键 |
| `enabled` | BOOLEAN NOT NULL DEFAULT false | 全局开关 |
| `rollout_percent` | INTEGER NOT NULL DEFAULT 0 CHECK (0..100) | 百分比灰度 |
| `payload` | JSONB | Flag 附带配置 |
| `updated_at` | TIMESTAMPTZ NOT NULL DEFAULT `now()` | — |

---

## 4. 预置数据（`0002_seed_system_categories.sql`）

系统预置分类（`is_system=true`）：
- **支出**：餐饮、交通、购物、居家、娱乐、医疗、教育、人情、其他
- **收入**：工资、奖金、理财、红包、报销、其他
- **转账**：账户互转（单独一条）

---

## 5. 迁移与回滚

| 脚本 | 方向 | 说明 |
|---|---|---|
| `0001_init.sql` | up | 建表 + 索引 + 触发器 |
| `0002_seed_system_categories.sql` | up | 预置分类 |
| `0001_init.down.sql` | down（v0.2 交付） | `DROP TABLE ... CASCADE` 全量回滚 |

**命名约定**：`NNNN_<slug>.sql` / `NNNN_<slug>.down.sql`，编号幂等可重跑。

---

## 6. 增量同步契约（与 OpenAPI 对齐）

- 客户端携带 `?since_version=<N>&entity=ledger_entries`
- 服务端返回：`entries[]`（version > N）、`server_version`（当前 max_version）
- 冲突策略：见 `docs/api/conflict-strategy.md`（LWW-by-updated_at + 审计留痕）

---

## 7. 下一步

- v0.2 追加：账单周期表 `budget_periods`、预算表 `budgets`（Epic-D）
- v0.3 追加：附件元数据表 `attachments`（独立于 `ledger_entries.media_keys`）

**变更必走**：`docs/changelog.md` 追加条目 + ADR 更新（如涉及金额/时区/软删等 P1-P4 变动）。
