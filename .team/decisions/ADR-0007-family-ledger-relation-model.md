# ADR-0007：family / ledger 关系模型 · "user 多 family · 每 family 一本账 · 加入即复制" 模型（方案 R）

- **状态**：Accepted
- **决策日期**：2026-05-27
- **触发卡**：COSTRA-150 R1 卡审 P0-1（FU-150-FAMILY-CONTEXT-SERVICE）+ Phase-3 真机实测受阻（client 拿不到 family_id / ledger_id）
- **决策方法**：Human + Orchestrator 联合讨论（4 轮选项收敛 · 涵盖单容器 / 双容器 / 多家庭 / 用户提议方案 R 共 4 个候选 · 最终选 R）
- **追溯范围**：
  - ADR-0004 §账本数据模型（如有）—— 需复核与本 ADR 的兼容
  - `docs/charter.md §M2`（云同步 + 家庭共享 Sprint-3~4）
  - `docs/PRD.md §Epic-D`（家庭共享 P1 但 MVP 必做）
  - `docs/api/sync-protocol.md §3 §7`（按 family_id 拉取 + 鉴权语义）
  - `server/db/migrations/0001_init.sql`（families/ledgers/family_members schema）
- **联动 Sprint-3 派单**：
  - **COSTRA-164** server family bootstrap MVP（本 ADR §6.1 实装锚点）
  - **COSTRA-165** miniapp family-context service（本 ADR §6.2 实装锚点）

---

## 1. 背景：为什么需要本 ADR

### 1.1 直接触发：COSTRA-150 显性技术债

`miniprogram/services/syncScheduler.ts:43-50` 显式注释：

```
⚠️ miniprogram 全局当前无 active_family_id 概念（auth.user 仅含 user_id）
R1 卡审 P0-1 修订 · 留 FU-150-FAMILY-CONTEXT-SERVICE Sprint-3+ 抽 family.ts service
```

实测后果：Phase-3 真机验证（`qa/phase-3-prod-realdevice-test.md`）需要 Human **手动通过 SSH 执行 SQL 创建 family + ledger，再在小程序 Console 手动 setStorage 注入 `__costra_family_id_v1`** —— 不是产品形态，是临时绕过。

### 1.2 隐性技术债：sync 协议假设 vs server bootstrap 缺失

| 层 | 现状 |
|---|---|
| sync 协议 | 强假设 `family_id` 已存在（`/sync/pull?family_id=...&since=...`）|
| server | login 仅 `userRepo.upsertByOpenid` · **不创建任何 family/ledger**（authService.ts:121） |
| server REST | `OpenAPI /families/*` 已定义但 **无 routes/families.ts 实装**（与 Sprint-2 Retro §议题 25 同款 OpenAPI vs 实装漂移反模式 AP-003）|
| miniapp | 无 family.ts service · 无 family 列表 UI · 无创建/加入入口 |

**链路完全断裂**：用户登录 → 没有 family_id → sync 永远 skip "no active family" → 无法记账。

### 1.3 决策必须现在做的原因

1. Phase-3 真机实测被卡（用户体验阻塞）
2. COSTRA-154 + 150 联合 approve 实质前置（无 family_id 无法做联合实测）
3. Sprint-4 Epic-D（COSTRA-201/202/204）的 schema 决策时间窗 —— 早决策可省下游卡的 schema migration

---

## 2. 决策候选与拒绝理由

讨论收敛过程见 §10 修订历史。最终四个候选：

| 方案 | 核心机制 | 拒绝理由 |
|---|---|---|
| **X · 单容器** | user 任意时刻只属 1 个 active family · 加入 = 迁移 entries 到对方 family | 🔴 加入家庭需 UPDATE 所有 entries · 改 ledger_id + 重发 change_seq + client_ref_id 撞车 + categories 冲突映射 · **耦合极高** · Human 直觉指出："这样耦合有点高，要批量改很多 entry 记录" |
| **P · ledger 共享开关** | family:ledger=1:N · 加 `ledger.shared_to_family` · 切 family 时改 ledger.family_id 重挂 | 🟡 理论可行但概念重（ledger 既属 user 又可挂 family · UI 共享开关复杂）· categories family_id 归属语义被打破 · sync 协议加可见性过滤改 syncPullService.ts 高风险（COSTRA-154 watermark v1.2 刚稳定）|
| **Q · ledger_group 汇总层** | 加 ledger_groups 表 · family→group→ledgers→entries | 🔴 三表 JOIN 性能下降 · 概念心智重 · MVP 用户场景占比 < 1% |
| **✅ R · user 多 family · family:ledger=1:1 · 加入即复制** | 个人 family 永远保留 · 加入家庭=新建共享 family + 新 ledger · 可选复制（INSERT...SELECT）旧数据 | **采纳**（理由见 §3） |

---

## 3. 决策

### 3.1 核心模型

```
users ── M:N ── families（通过 family_members）
families ── 1:1 (产品语义) / 1:N (schema 保留) ── ledgers
ledgers ── 1:N ── entries
families ── 1:N ── categories（家庭共享分类）
```

**核心约定**：
- 每个 user 可属于 **N 个 family**（schema 上 family_members 已支持 M:N）
- 每个 user **登录后 server 自动 bootstrap 1 个"个人 family"**（UI 上称"我的账本"，避免"家庭"字样困惑单人用户）
- 每个 family 对应**恰好 1 本账**（ledger） · 产品语义 1:1，schema 物理 1:N（保留扩展空间）
- 用户**加入新家庭** = 新建 family + family_members(member) + 新 ledger · 旧的"个人 family" **完全保留不动**
- 加入家庭时**可选复制**个人 family 数据到新 family 的 ledger（用户操作 · UI 转圈进度展示 · 见 §5.3）
- 退出家庭 = `UPDATE family_members SET left_at=now()` · 新 family 的 entries 留在原 family · 个人 family 永远独立

### 3.2 业界对照

| 产品 | 模型 | 与本 ADR 关系 |
|---|---|---|
| 随手记 | 多账本（账本归属用户）| 与方案 R **几乎一致** · 已被验证用户接受度最高 |
| 鲨鱼记账 | 单容器（一户一账本）| 方案 X · 已拒绝 |
| 微信记账本 | 双容器（个人+家庭并存）| 方案 P · 已拒绝 |
| Splitwise | group-based | 方案 Q 类似 · 已拒绝 |

### 3.3 R1 / R2 / R3 阶段约定（产品分层）

| 阶段 | Sprint | UI 暴露 | 后端实装 |
|---|---|---|---|
| **R1（透明态）** | Sprint-3 | 不出现"家庭" / "切换" 字样 · 用户只见唯一"我的账本" | login bootstrap 自动建个人 family + ledger · 不做 `/families` REST 端点 |
| **R2（家庭显性化）** | Sprint-4 | mine 页"邀请家人" + home 顶部 family 切换器 | `POST /families` 创建 + `POST /families/{id}/invites` + `POST /invites/accept` + 加入向导（含复制选项） |
| **R3（增强体验）** | Sprint-5+ | 选择性导入 / 异步导入 / 私密 ledger 标记 | 后台 import job + 进度推送 |

---

## 4. 与现有 schema 的关系（关键）

### 4.1 R1 阶段 schema 改动量 = **0**

现有 schema 已天然支持方案 R 的全部需求（COSTRA-021 设计前瞻性 + 0001_init.sql L29-78）：

| 关系 | schema 现状 | 方案 R 是否需要 |
|---|---|---|
| `families : ledgers` | 1:N（FK ledgers.family_id NOT NULL）| ✅ 1:1 是 1:N 的子集 |
| `users : families` | M:N（family_members PK = (family_id, user_id) · 含 left_at 软删）| ✅ 完全支持 |
| `categories : families` | family_id NOT NULL（除系统分类 NULL）· 全家共享 | ✅ 不动 |
| `entries.client_ref_id` | UNIQUE (ledger_id, client_ref_id) | ✅ 复制时加 `imported:` 前缀防撞 |

**唯一可能要加的列**：

```sql
-- migration 0007（可选 · 也可由 client storage 承担）
ALTER TABLE users ADD COLUMN active_family_id UUID REFERENCES families(id);
```

**约定**：active_family_id 由 **客户端 storage** 承担（key=`__costra_active_family_id_v1`），server 不持久化 —— 减小 R1 改动面、避免登录串台风险（同一用户两台手机切不同 family）。

### 4.2 R2 阶段 schema 改动量 = **极小**

预测 Sprint-4 Epic-D 不引入新表（family_invites 表 0001_init.sql L55-65 已建好），仅按需补字段。

---

## 5. 关键设计决策（细节）

### 5.1 家庭数量上限：**配置可调 · MVP 默认 3 · 后台支持 20**

| 层 | 值 | 理由 |
|---|---|---|
| schema 物理上限 | 无 | 不写死在 DDL |
| **server 配置上限** | **20**（环境变量 `MAX_FAMILIES_PER_USER`，默认 20）| 防恶意创建 / DB 健康保护 |
| **应用层校验上限** | **3**（环境变量 `USER_VISIBLE_FAMILY_LIMIT`，默认 3）| MVP 限制用户最多 3 个家庭 · 后续按运营反馈调整到更高 |
| 检查时机 | `POST /families`（创建）+ `POST /invites/accept`（加入）| 两条路径都拦 · 错误码 `FAMILIES_LIMIT_EXCEEDED` |

**扩展路径**：调 `USER_VISIBLE_FAMILY_LIMIT` 即可放宽 · 不改代码不改 schema。

### 5.2 默认 family（active_family_id）解析规则

| 场景 | active_family_id 取值 |
|---|---|
| 新用户首次登录 | 唯一的"个人 family"（bootstrap 时返回的 default_family_id）|
| 已有用户登录 | client storage 中上次选择的 family_id（命中 family_members 且 left_at IS NULL 即生效）|
| storage 中 family_id 失效（已退出 / 已删 / 不属于本人） | fallback 到个人 family（owner_id = self · created_at ASC 第一个）|
| 用户当前所有 family 都已退出（极边缘） | 触发**自愈 bootstrap**：再创一个"我的账本" |

### 5.3 加入家庭时的"复制"行为（R2 范围 · ADR 锚定）

**触发**：用户在加入向导 step "是否导入个人数据"中选 "是"。

**性能策略**（Human 决策落地）：
- **同步执行**（不进异步队列）· 客户端 UI 显示百分比进度
- **进度策略**：根据 entries 数量做"假进度"（实际 INSERT 速度可能比线性快很多 · 假进度避免用户误判停滞）
- **数据一致性**：整个复制操作走单 PG 事务 + Idempotency-Key 幂等

**SQL 形态**（实装时严格按此 · R2 落地）：

```sql
BEGIN;
-- ① 复制独有分类（unique 索引天然防呆）
INSERT INTO categories (id, family_id, name, type, icon, color, sort_order, is_system)
SELECT gen_random_uuid(), :TARGET_FAMILY_ID, name, type, icon, color, sort_order, false
FROM categories
WHERE family_id = :SRC_FAMILY_ID AND deleted_at IS NULL
ON CONFLICT DO NOTHING
RETURNING id, name, type;
-- 应用层维护 src_category_id → target_category_id 映射表

-- ② 复制 entries（重发 change_seq · 改 client_ref_id 前缀 · 保留 created_by/occurred_at）
INSERT INTO entries (
  id, ledger_id, amount, currency, type, category_id,
  note, occurred_at, created_by, version, client_ref_id, change_seq
)
SELECT
  gen_random_uuid(),
  :TARGET_LEDGER_ID,
  amount, currency, type,
  COALESCE(:category_map[category_id], category_id),
  note, occurred_at, created_by, 1,
  'imported:' || COALESCE(client_ref_id, id::text),
  nextval('entries_change_seq')
FROM entries
WHERE ledger_id = :SRC_LEDGER_ID AND deleted_at IS NULL;

-- ③ audit_logs 留痕
INSERT INTO audit_logs (...) VALUES (...);

COMMIT;
```

**不在 R2 复制范围**：budgets（推荐用户加入家庭后**重新设置预算** · MVP 不迁移 · 避免 `uq_budgets_ledger_scope_month` 冲突）。

### 5.4 categories 归属保持 family_id（不动）

- `family_id NOT NULL` 不变（除系统分类 NULL）
- 每个 family 独立分类 · 自然支持"小王家"和"老李家"分类不同
- R2 复制时跨 family 复制（带 unique 索引防呆）

### 5.5 sync/pull 协议保持 v1.2 不动

- 协议层 `?family_id=...&since=N` 完全不变 ✓
- 服务端 `syncPullService.ts` SQL 不动（`WHERE l.family_id = $1 AND e.change_seq > $2`）✓
- 客户端 watermark 按 family_id 维度独立（已实装：`watermark:<family_id>` · db.ts L86-88）✓

**⚠️ 关键铁律**：本 ADR R1 阶段**绝对禁止**触碰 `syncPullService.ts` SQL —— COSTRA-154 watermark v1.2 R1.x.2 刚稳定（commit 31fb893+2b28210+261c280），任何改动都需重启联合实测。

### 5.6 wxLogin response 响应体扩展

`AuthTokenPair`（`server/src/services/authService.ts:36-52`）添加字段：

```typescript
export interface AuthTokenPair {
  // ... 现有字段保持不变
  user: { ... };  // 现状

  // 新增（COSTRA-164）：
  default_family_id: string;     // bootstrap 创建的个人 family · 给 client active_family_id 兜底
  default_ledger_id: string;     // 个人 family 的唯一 ledger
}
```

**OpenAPI 同步修订**：`server/api/openapi.yaml#components.schemas.AuthTokenPair` 加两个字段（COSTRA-164 §2.1 落地）。

---

## 6. R1 实装锚点（Sprint-3 双卡）

### 6.1 COSTRA-164 · server family bootstrap MVP（3 点 · backend-dev）

**核心交付**：
1. `wxLogin()` 流程（authService.ts:118-139）扩展为：
   - `userRepo.upsertByOpenid` 后 → 检查用户是否有任何 active family
   - 无 → 单事务 atomic 创建 `families('我的账本', owner=user) + family_members(owner) + ledgers('日常账本', currency='CNY')`
   - 有 → 取用户最早创建的个人 family（owner_id = user_id）作为 default
2. `AuthTokenPair` 加 `default_family_id` + `default_ledger_id`
3. OpenAPI `AuthTokenPair` schema 同步
4. 单测覆盖（首登 bootstrap / 重登命中 / 事务回滚 / family 数量上限校验占位）
5. **不实装** `/families` REST 端点（推到 Sprint-4 COSTRA-201）

**禁项**：
- ❌ 不动 `/sync/pull` SQL
- ❌ 不动 152/153 entries 路由
- ❌ 不引入 schema migration（本 ADR §4.1 锚定）

### 6.2 COSTRA-165 · miniapp family-context service（2 点 · miniapp-dev · 等 164 R1 APPROVE 启动）

**核心交付**：
1. 新建 `miniprogram/services/family.ts`：
   - `getActiveFamilyId()`：读 storage `__costra_active_family_id_v1` · miss 则用 login resp 中 default_family_id 兜底 · 都无返 null
   - `getActiveLedgerId()`：同模式
   - `setActiveFamily(familyId, ledgerId)`：写 storage envelope
2. `auth.ts` login success 流程：把 default_family_id / default_ledger_id 写入 storage
3. `syncScheduler.ts:47-50` 改为调 `getActiveFamilyId()`（替换 raw `getItem(__costra_family_id_v1)` 旧 key）
4. home / entry 页：`active_ledger_id` 接入（创建 entry 时自动填充）
5. 旧 storage key `__costra_family_id_v1` 一次性清除迁移（防陈旧值干扰）

**禁项**：
- ❌ 不做 family 切换 UI（R2 范围）
- ❌ 不做 mine 页"邀请家人"入口
- ❌ 不动 152/153 entries 调用

---

## 7. 影响面清单

| 受影响对象 | 变更动作 | 阶段 |
|---|---|---|
| `server/src/services/authService.ts` | wxLogin 加 bootstrap · 扩响应字段 | COSTRA-164 |
| `server/src/repositories/userRepo.ts` | （视实装）+findActivePersonalFamily | COSTRA-164 |
| `server/src/repositories/familyRepo.ts` | **新建**：createPersonal · findByOwner · listByUser | COSTRA-164 |
| `server/src/repositories/ledgerRepo.ts` | **新建**：createDefault | COSTRA-164 |
| `server/api/openapi.yaml#AuthTokenPair` | + default_family_id + default_ledger_id | COSTRA-164 |
| `server/src/config/env.ts` | + MAX_FAMILIES_PER_USER（默认 20）+ USER_VISIBLE_FAMILY_LIMIT（默认 3）| COSTRA-164 |
| `miniprogram/services/family.ts` | **新建** family-context service | COSTRA-165 |
| `miniprogram/services/auth.ts` | login success 写 family/ledger storage | COSTRA-165 |
| `miniprogram/services/syncScheduler.ts:47-50` | 改读 family.ts service | COSTRA-165 |
| `qa/phase-3-prod-realdevice-test.md` | §3.1 SSH 手动建 family 段废弃 + §3.2 storage 注入段废弃 | COSTRA-164/165 联合 approve 后 |
| `docs/api/sync-protocol.md` | 不动（协议不变）| — |

---

## 8. 代价与风险

### 8.1 代价

- **bootstrap 事务**：每次登录都做"是否存在个人 family"检查 · 增加 1 次 SELECT · 命中后续登录走 cache miss 不影响（PG 索引扫描微秒级）
- **认知模型不直观（Sprint-4 R2 显性化时）**：用户看到 `[我的账本, 小王家, 老李家]` 三个 family 时可能困惑"为什么有三个" → R2 onboarding 文案需要一行解释
- **多 family 状态机扩展**：未来支持 family rename / leave / archive 时状态机比单容器复杂

### 8.2 风险

| 风险 | 缓解 |
|---|---|
| 登录链路时延（bootstrap +1 次事务）| 单事务 < 30ms · 仅首登触发 INSERT · 后续登录命中 SELECT 短路 |
| 复制操作慢（R2）| §5.3 已锚定同步执行 + 进度条 + Idempotency-Key |
| 复制时 client_ref_id 撞车 | §5.3 已锚定 `imported:` 前缀策略 |
| 复制时 change_seq 单调性 | §5.3 已锚定 nextval('entries_change_seq') |
| 用户期望"加入家庭后看不到老婆个人账"| ✅ 天然支持（个人 family 永远独立 · 不会泄漏到家庭 family）|
| 多 family 列表 UI 拥堵 | §5.1 已锚定 USER_VISIBLE_FAMILY_LIMIT=3 默认 |

---

## 9. 验证路径（Review 可核验）

| 断言 | 核验方法 |
|---|---|
| ADR-0007 已落档 | `ls .team/decisions/ADR-0007-family-ledger-relation-model.md` |
| COSTRA-164 dispatch 引用本 ADR | `grep -n 'ADR-0007' .team/dispatch/COSTRA-164-*.md` |
| COSTRA-165 dispatch 引用本 ADR | 同上 |
| 实装后：每个新登录用户必有 ≥ 1 个 active family | `SELECT COUNT(*) FROM users u WHERE NOT EXISTS (SELECT 1 FROM family_members fm WHERE fm.user_id=u.id AND fm.left_at IS NULL)` 应为 0 |
| sync/pull SQL 未变 | `git diff server/src/services/syncPullService.ts` 应空 |
| schema 改动量 = 0（R1）| `ls server/db/migrations/0007_*.sql` 应不存在（直到 R2 才需要）|

---

## 10. 修订历史

| 版本 | 日期 | 变更 |
|---|---|---|
| v1.0 | 2026-05-27 | 首版。Human + Orchestrator 4 轮选项收敛（X 单容器 → P ledger 共享开关 → Q 汇总层 → R user 多 family/family 1:1 ledger）· 最终采纳方案 R · 同步起草 COSTRA-164/165 双卡 dispatch |

---

## 11. 相关文档

- [`ADR-0006-backend-runtime-and-primary-store.md`](./ADR-0006-backend-runtime-and-primary-store.md)（PG 15 + Node.js + Fastify · 实装基座）
- [`server/db/migrations/0001_init.sql`](../../server/db/migrations/0001_init.sql)（families/ledgers/family_members 原始 schema）
- [`docs/api/sync-protocol.md`](../../docs/api/sync-protocol.md)（v1.2 · 协议保持不动）
- [`docs/charter.md`](../../docs/charter.md)（M2 路线图）
- [`docs/PRD.md`](../../docs/PRD.md)（§Epic-D 家庭共享 P1 但 MVP 必做）
- [`.team/dispatch/COSTRA-164-server-family-bootstrap-mvp.md`](../dispatch/COSTRA-164-server-family-bootstrap-mvp.md)（R1 backend 实装锚点 · 待落档）
- [`.team/dispatch/COSTRA-165-miniapp-family-context-service.md`](../dispatch/COSTRA-165-miniapp-family-context-service.md)（R1 miniapp 实装锚点 · 待落档）
