# Costra DB Schema v1.2

> **卡号**: COSTRA-021 · **Owner**: Backend-Agent · **更新**: 2026-06-01（COSTRA-217 二级分类 + shared_type · Sprint-3）
> **约束来源**: `ADR-0004` §8 金额 / §10 时区 / §12 审计；`docs/charter.md` §13 工程约束；`../api/id-strategy.md`（UUID v7 事实源）
> **迁移脚本**: `server/db/migrations/0001_init.sql` + `0002_seed_system_categories.sql` + `0008_categories_hierarchy_seed.sql` + `0009_entries_shared_type.sql`
> **运行环境**: PostgreSQL 15，`TIMESTAMPTZ` 强制 UTC 存储；主键 UUID v7 由应用层 `newId()` 生成（见 [`ADR-0006`](../../.team/decisions/ADR-0006-backend-runtime-and-primary-store.md)）
> **docker-compose**: 仓库根 `/docker-compose.yml`（MVP 基线 `postgres:15-alpine` + `redis:7-alpine`，端点 `5432/6379`；本地一键起: `docker compose up -d pg redis`）
>
> **v1.2 变更**（2026-06-01 COSTRA-217）：
> - categories 加 `parent_id`（二级树）+ `is_direct_default`（直选默认归属）+ CONSTRAINT TRIGGER 禁止三级/自引用 + 替换唯一索引含 parent_id + partial unique index is_direct_default
> - entries 加 `shared_type` ENUM('personal','shared') + CHECK 约束（仅 expense 允许）+ 索引 idx_entries_shared_type
> - 系统分类 seed 升级为二级体系（11 一级 + 62 二级 = 73 条 · clean rebuild：清空旧系统分类后全量插入）
>
> **v1.1 变更**（2026-04-23 Round-2）：
> - P0-1 · `categories.kind` → `categories.type`、`ledger_entries.kind` → `ledger_entries.type`，CHECK 枚举统一 `('income','expense','transfer')`（与 OpenAPI `Category.type` / `Entry.type` 对齐；API 同轮补 `transfer`）
> - P1-1 · `idx_categories_scope` 复合索引扩展为 `(COALESCE(user_id, family_id), type, sort_order)`，覆盖 `ORDER BY sort_order` 主查询路径
> - P1-3 · `ledger_entries.transfer_peer_entry_id` 明确 `ON DELETE SET NULL`，应用层保证"转账组两条同步软删"
> - P1-4 · `feature_flags.rollout_percent` CHECK 从 `(0..100)` 修正为 `BETWEEN 0 AND 100`
> - P2-4 · `subscribe_tokens.scene` 枚举与 OpenAPI 对齐：`budget_alert` / `family_activity` / `weekly_digest`
> - 新增 `ledger_entries.to_account_id`（转入账户）+ 索引，支撑 OpenAPI `Entry.to_account_id` 字段（COSTRA-020 Round-2 同轮引入）


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
| P8 | **UUID 主键** | 全表 `UUID` 主键，**UUID v7（时间有序，应用层 `newId()` 生成）**，便于离线生成、天然按创建时间粗排序、避免泄露规模。详见 [`../api/id-strategy.md`](../api/id-strategy.md)。MVP 阶段应用层依赖 `uuidv7` npm 包；后续切到 PG 16+ `pg_uuidv7` 扩展做 DEFAULT（见末尾 **下一步** 章节）。

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
| `id` | UUID PK | 应用层 `newId()`（UUID v7） |
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
| `type` | TEXT NOT NULL CHECK (type IN ('cash','bank_card','credit_card','e_wallet','prepaid_card','other')) | v1.1 扩展 `bank` → `bank_card`/`credit_card`；`ewallet` → `e_wallet`；补 `prepaid_card`——与 OpenAPI `Account.kind` 枚举 6 项对齐（API 端为历史便利沿用 `kind` 字段名；**DB 与 API 此处字段名有意保持差异**，由服务层固定映射 `account.type ↔ Account.kind`） |
| `currency` | CHAR(3) NOT NULL DEFAULT `'CNY'` | ISO-4217 |
| `initial_balance_cents` | BIGINT NOT NULL DEFAULT 0 | 初始余额（分） |
| `is_archived` | BOOLEAN NOT NULL DEFAULT false | — |
| `created_at / updated_at / deleted_at / version` | 标准字段 | — |

约束：`CHECK ((user_id IS NOT NULL) <> (family_id IS NOT NULL))`（P5 互斥）。
索引：`idx_accounts_user / idx_accounts_family`。

**余额派生规则（v1.1 P2-2 显式化）**：
- `balance = initial_balance_cents + Σ(ledger_entries 净流入) - Σ(ledger_entries 净流出)`
- 其中 `type='income'` 贡献 `+amount_cents`；`type='expense'` 贡献 `-amount_cents`；`type='transfer'` 对 `account_id` 贡献 `-amount_cents`，对 `to_account_id` 贡献 `+amount_cents`
- 服务端按需实时聚合（非物化列）；MVP 不加触发器，通过 `/accounts` GET 端点响应时计算
- OpenAPI `Account.balance` 字段即为该派生值（只读）

---

### 3.5 `categories` 分类

| 列 | 类型 | 说明 |
|---|---|---|
| `id` | UUID PK | — |
| `user_id` | UUID | 用户自定义 |
| `family_id` | UUID | 家庭自定义 |
| `is_system` | BOOLEAN NOT NULL DEFAULT false | 系统预置（owner 为空） |
| `parent_id` | UUID REFERENCES `categories(id)` ON DELETE RESTRICT | **COSTRA-217 新增**：二级分类父级（最多 2 级）；CONSTRAINT TRIGGER 禁止三级 + 禁止自引用 |
| `name` | TEXT NOT NULL | — |
| `icon` | TEXT | 图标键。系统分类迁移后（`0007_category_icon_keys.sql`）存**语义 icon_key**（如 `dining`/`transport`），端侧经 `miniprogram/services/iconMap.ts` 映射为 costra-icons 字体字形；历史单字仅作为旧 seed/回滚兼容。映射见 `scripts/icon-font/icon-registry.json` |
| `color` | TEXT | 颜色键（COSTRA-217 seed 使用） |
| `type` | TEXT NOT NULL CHECK (type IN ('income','expense','transfer')) | v1.1 P0-1：原 `kind` 改名 `type` 与 OpenAPI `Category.type` 对齐；同步补 `transfer` 枚举 |
| `sort_order` | INTEGER NOT NULL DEFAULT 0 | — |
| `is_direct_default` | BOOLEAN NOT NULL DEFAULT false | **COSTRA-217 新增**：全局二级展示区直选默认归属标记；同名二级中只有最日常/最高频的设 true |
| `created_at / updated_at / deleted_at / version` | 标准字段 | — |

约束：
- 系统分类 `is_system=true AND user_id IS NULL AND family_id IS NULL`；否则 P5 互斥
- CONSTRAINT TRIGGER `chk_categories_max_two_levels`：最多两层 + 禁止自引用（DEFERRABLE INITIALLY DEFERRED）
- Partial unique index `uq_categories_direct_default`：同一 scope 下同名二级分类只有一个 `is_direct_default=true`

索引（COSTRA-217 更新）：
- `uq_categories_family_name_type_parent` on `(COALESCE(family_id, '00000000…'), name, type, COALESCE(parent_id, '00000000…'))` WHERE `deleted_at IS NULL` — 替代旧 `uq_categories_family_name_type`，含 parent_id 维度
- `idx_categories_type_parent_sort` on `(type, parent_id, sort_order)` WHERE `deleted_at IS NULL` — 按 type+parent 拉取分类主路径
- `idx_categories_scope` on `(COALESCE(user_id, family_id), type, sort_order)` — v1.1 P1-1 扩展

---

### 3.6 `ledger_entries` 流水主表（核心）

| 列 | 类型 | 说明 |
|---|---|---|
| `id` | UUID PK | — |
| `user_id` | UUID | 私有流水 |
| `family_id` | UUID | 家庭流水 |
| `creator_user_id` | UUID NOT NULL REFERENCES `users(id)` | 记录人 |
| `account_id` | UUID NOT NULL REFERENCES `accounts(id)` | 收支：资金账户；转账：转出账户 |
| `to_account_id` | UUID REFERENCES `accounts(id)` | **v1.1 新增**：仅 `type='transfer'` 必填，转入账户；CHECK 要求与 `account_id` 不同 |
| `category_id` | UUID NOT NULL REFERENCES `categories(id)` | — |
| `type` | TEXT NOT NULL CHECK (type IN ('income','expense','transfer')) | v1.1 P0-1：原 `kind` 改名 `type` 与 OpenAPI `Entry.type` 对齐 |
| `amount_cents` | BIGINT NOT NULL CHECK (amount_cents > 0) | 绝对值（分） |
| `currency` | CHAR(3) NOT NULL DEFAULT `'CNY'` | — |
| `occurred_at` | TIMESTAMPTZ NOT NULL | 业务发生时间（UTC 存储） |
| `note` | TEXT | 备注（≤200 字符） |
| `tags` | TEXT[] | 标签（≤5 个） |
| `media_keys` | TEXT[] | 附件对象存储 key |
| `transfer_peer_entry_id` | UUID REFERENCES `ledger_entries(id)` ON DELETE SET NULL | 转账配对（`type='transfer'` 时必填）；v1.1 P1-3：明确 `ON DELETE SET NULL`；应用层必须把"转账组两条流水"放在同一事务内一起软删 |
| `shared_type` | entry_shared_type ENUM ('personal','shared') NULL | **COSTRA-217 新增**：公共/个人支出标记；仅 expense 允许有值；income/transfer 必须为 NULL；DB 无 DEFAULT，服务层必须显式写入 |
| `created_at / updated_at / deleted_at / version` | 标准字段 | — |

约束：
- `CHECK ((user_id IS NOT NULL) <> (family_id IS NOT NULL))` — 私有/家庭互斥
- `CHECK (type <> 'transfer' OR (to_account_id IS NOT NULL AND to_account_id <> account_id))` — transfer 必带不同对端账户
- `CHECK (type = 'transfer' OR to_account_id IS NULL)` — 非 transfer 必须 to_account_id 为 NULL
- `CHECK (shared_type IS NULL OR type = 'expense')` — **COSTRA-217 新增**：仅 expense 允许 shared_type

**shared_type 默认规则**（COSTRA-217 §2.B.3 · 服务层判定 · DB 无 DEFAULT）：
- expense 未传 shared_type 时：personal family → `'personal'`；shared family → `'shared'`
- 无法判定 family kind 时：返回标准错误且不写 DB（dispatch §2.B.3 硬约束：不得静默猜测）

**关键索引**（AC-1 明确要求 + v1.1 新增 + COSTRA-217 新增）：
- `idx_ledger_user_occurred` on `(user_id, occurred_at DESC)` WHERE `deleted_at IS NULL`
- `idx_ledger_family_occurred` on `(family_id, occurred_at DESC)` WHERE `deleted_at IS NULL`
- `idx_ledger_account` on `account_id`
- `idx_ledger_to_account` on `to_account_id` WHERE `to_account_id IS NOT NULL` —— **v1.1 新增**，支撑按"转入账户"筛选与余额聚合
- `idx_ledger_category` on `category_id`
- `idx_ledger_updated` on `updated_at`（增量同步用）
- `idx_entries_shared_type` on `(ledger_id, shared_type)` WHERE `shared_type IS NOT NULL AND deleted_at IS NULL` —— **COSTRA-217 新增**，家庭页公共/个人支出拆解查询

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
| `scene` | TEXT NOT NULL CHECK (scene IN ('budget_alert','family_activity','weekly_digest')) | v1.1 P2-4：与 OpenAPI `/notifications/subscribe-template.scene` 对齐（原 `budget_warn`/`family_invite` 改为 `budget_alert`/`family_activity`） |
| `status` | TEXT NOT NULL DEFAULT `'pending'` CHECK (status IN ('pending','sent','expired','revoked')) | v1.1 新增：与 OpenAPI `SubscribeMessageJob.status` 对齐 |
| `consumed_at` | TIMESTAMPTZ | 已使用时间（status=sent 时必填） |
| `expires_at` | TIMESTAMPTZ NOT NULL | 过期时间（created_at + 7 天，对齐微信规则） |
| `created_at` | TIMESTAMPTZ NOT NULL DEFAULT `now()` | — |

索引：`idx_subtoken_user_scene` on `(user_id, scene)`；`idx_subtoken_status_expires` on `(status, expires_at)` WHERE `status='pending'`（用于扫"到期未发"的清理 job）。

---

### 3.10 `feature_flags` 运行时 Flag

| 列 | 类型 | 说明 |
|---|---|---|
| `key` | TEXT PK | Flag 键 |
| `enabled` | BOOLEAN NOT NULL DEFAULT false | 全局开关 |
| `rollout_percent` | INTEGER NOT NULL DEFAULT 0 CHECK (rollout_percent BETWEEN 0 AND 100) | v1.1 P1-4：原 `CHECK (0..100)` 非 PG 合法语法，修正为 `BETWEEN 0 AND 100` |
| `payload` | JSONB | Flag 附带配置 |
| `updated_at` | TIMESTAMPTZ NOT NULL DEFAULT `now()` | — |

---

## 4. 预置数据

### 4.1 旧预置分类（`0002_seed_system_categories.sql` · 已被 0008 清空）

旧 12 条扁平系统分类（`is_system=true`）已被 `0008_categories_hierarchy_seed.sql` 开头 `DELETE FROM categories WHERE is_system = true AND family_id IS NULL` 清空，不再保留。开发阶段 clean rebuild，不考虑旧数据兼容。

### 4.2 二级分类体系（`0008_categories_hierarchy_seed.sql` · COSTRA-217）

系统预置分类升级为二级树结构（11 一级 + 62 二级 = 73 条 · 55 条 `is_direct_default=true`）：

**支出一级**：餐饮、交通、购物、生活、旅行、文娱、汽车、其他
**收入一级**：职业收入、投资与资产、意外所得

Clean rebuild 策略：0008 开头清空旧系统分类，全量插入新二级分类体系，所有分类使用新 ID，不保留旧分类 ID。

直选默认归属映射（`is_direct_default=true` 的同名二级）：餐饮→餐饮-餐饮、机票→交通-机票、零食→餐饮-零食、买菜→餐饮-买菜、饮料→餐饮-饮料

---

## 5. 迁移与回滚

| 脚本 | 方向 | 说明 |
|---|---|---|
| `0001_init.sql` | up | 建表 + 索引 + 触发器（v1.1：`categories.type` / `ledger_entries.type` / `ledger_entries.to_account_id` / `rollout_percent BETWEEN` / `subscribe_tokens.scene` 新枚举与 `status` 四态） |
| `0002_seed_system_categories.sql` | up | 预置分类（使用 v1.1 后的 `type` 列名） |
| `0001_init.down.sql` | down（v0.2 交付） | `DROP TABLE ... CASCADE` 全量回滚 |
| **`0003_v1_1_rename_kind_to_type.sql`** | up | **v1.1 补丁**：若 Sprint-0 开发库曾基于 v1 建表，使用此脚本做 `ALTER TABLE ... RENAME COLUMN kind TO type` 并重建 `idx_categories_scope`、加 `ledger_entries.to_account_id` 与对应索引、改 `subscribe_tokens.scene` CHECK、`feature_flags.rollout_percent` CHECK |
| `0003_v1_1_rename_kind_to_type.down.sql` | down | 反向 RENAME 回滚（仅用于紧急回退） |
| **`0008_categories_hierarchy_seed.sql`** | up | **COSTRA-217**：categories 加 `parent_id` + `is_direct_default` + CONSTRAINT TRIGGER 二级约束 + 替换唯一索引含 parent_id + partial unique index is_direct_default + 清空旧系统分类 + 全量插入二级分类 seed（11 一级 + 62 二级 = 73 条 · clean rebuild） |
| **`0009_entries_shared_type.sql`** | up | **COSTRA-217**：创建 `entry_shared_type` ENUM + entries 加 `shared_type` 列 + CHECK 约束 `shared_type IS NULL OR type = 'expense'` + 索引 `idx_entries_shared_type` |
| **`0007_category_icon_keys.sql`** | up | **COSTRA-ICON-KEY**：把系统分类 `icon` 列由单字就地刷为语义 icon_key（幂等 UPDATE，按 名+type+父 定位，`family_id IS NULL`）。`0001/0004` 历史 seed 保留单字基线**不改**，靠本迁移在 migrations 顺序执行末尾统一收敛 fresh + existing 环境 |

> 注：上表编号沿用历史文档口径，与实际 `server/db/migrations/` 目录可能不完全一致；以目录实际文件为准。

**命名约定**：`NNNN_<slug>.sql` / `NNNN_<slug>.down.sql`，编号幂等可重跑。

**MVP 上线前**：由于 Sprint-0 开发库尚未承接生产数据，Backend-Agent 的实施路径是**直接重建 0001_init.sql 到 v1.1 形态**（覆写而非 0003 补丁），0003 补丁脚本**仅作为"已有 v1 数据环境"的救生圈**保留在迁移目录里不执行。此决定见 `.team/decisions/D-012-db-v1-1-migration-shortcut.md`（TBD，Round-2 后若通过则补建）。

---

## 6. 增量同步契约（与 OpenAPI 对齐）

- 客户端携带 `?since_version=<N>&entity=ledger_entries`
- 服务端返回：`entries[]`（version > N）、`server_version`（当前 max_version）
- 冲突策略：见 `docs/api/conflict-strategy.md`（LWW-by-updated_at + 审计留痕）

---

## 6.1 角色矩阵（v1.1 P2-1）

DB `family_members.role` 与 OpenAPI 三处角色字段的三端一致性：

| 场景 | 字段 | 枚举 | 含义 |
|---|---|---|---|
| 家庭成员（长期在籍） | `family_members.role` · `FamilyMember.role` | `owner` / `admin` / `member` | MVP 仅区分三档；admin 可 CRUD 流水但不可解散家庭 |
| 成员邀请时（临时） | `FamilyInvite.role` | `member` / `viewer` | **viewer 角色在 family_members 表中不落地**；MVP 不提供"只读旁观成员"入口——`FamilyInvite.role=viewer` 当前**预留不启用**，Sprint-2 Epic-B 再激活 |
| 审计日志操作者 | `audit_logs.actor_user_id` | user_id | 不含 role（role 在 actor 的 family_members 记录里查） |

**结论**：四个角色 `owner` / `admin` / `member` / `viewer` 中，前三在 DB 与 API 都落地；`viewer` 当前仅 API 有 enum、DB 无持久化——若 Sprint-2 启用，需要在 `family_members.role` CHECK 中加入 `viewer`。

## 6.2 审计日志脱敏清单（v1.1 P2-3）

写入 `audit_logs.before/after` 与 `metadata` 前必须脱敏的字段（由应用层统一中间件处理）：

| 字段 | 脱敏规则 |
|---|---|
| `users.wx_openid` / `wx_unionid` | 全量移除（不得入 audit） |
| 手机号 / email | 掩码中间四/六位 |
| `refresh_token` / `access_token` | 全量移除 |
| `subscribe_tokens.template_id` | 保留 |
| `accounts.*` | 全量保留 |
| `ledger_entries.note` | 全量保留（用户自愿内容） |
| `metadata.ip` | v4 抹尾一段（`1.2.3.0`）；v6 抹后 80 bit |
| `metadata.ua` | 全量保留 |

实施见合规 Epic-G 与 `docs/compliance/audit-desensitize.md`（TBD，由合规侧建卡跟进）。

---

## 7. 下一步

- v0.2 追加：账单周期表 `budget_periods`、预算表 `budgets`（Epic-D）
- v0.3 追加：附件元数据表 `attachments`（独立于 `ledger_entries.media_keys`）
- v0.4 追加：主键生成下沉到 DB——升级 PG 到 16+ 并启用 `pg_uuidv7` 扩展，把各表 `DEFAULT` 改为 `gen_random_uuid_v7()`，应用层 `newId()` 保留用于离线生成（`client_ref_id` 场景）

**变更必走**：`docs/changelog.md` 追加条目 + ADR 更新（如涉及金额/时区/软删等 P1-P4 变动）。
