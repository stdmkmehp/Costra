# COSTRA-164 · server family bootstrap MVP（首登 atomic 建个人 family + ledger）

> **派单时间**：2026-05-27（Orchestrator · Sprint-3 头部第 3 张 · 接续 154/150 联合 approve 阻塞链）
> **dispatch 修订**：v1.0 → v1.1（Human 追加 kind 区分需求）→ v2.0 @ 2026-05-27 14:30（Card-Review R1 PASS-WITH-FOLLOWUP 25/30 · 6 项 FU 全落地修订）→ **v2.1 @ 2026-05-27 15:00**（Card-Review R2 PASS-WITH-FOLLOWUP 28/30 · 1 项 P1 残留 + 1 项 P2 修订兑现）
> **状态**：Card-Review R1 + R2 已审 → dispatch v2.1 已修订 → **等 R1 实装 spawn**（backend-dev 装扮）
> **依赖**：COSTRA-101（authService.wxLogin 流程）· COSTRA-021（families/ledgers/family_members schema 0001_init.sql 已全备）
> **下游解锁**：
> - COSTRA-165 miniapp family-context（强依赖本卡 R1 APPROVE 才能启 · 否则 client 拿不到 default_family_id）
> - COSTRA-154+150 联合 approve（无 family bootstrap 真机实测无法做完）
> - Phase-3 真机实测（qa/phase-3-prod-realdevice-test.md §1.4 / §3.1 / §3.2 · SSH 手填 SQL + Console 注入 storage 段废弃）

---

## §0 SBAI 装扮路径

| 阶段 | Subagent | 状态 |
|---|---|---|
| **Card-Review R1** | `costra-card-reviewer-tech`（D-022 v2.0 + D-025 §2 反模式扫描）| 等启动 |
| **R1 实装** | `costra-backend-dev`（一次性装扮 · 单装扮档单 commit · D-018 §3.5 Q4-A 不适用 / 单 owner 范式）| 等卡审 PASS |
| **R1 Review** | `costra-review-tech`（D-022 v2.0 第 N 次实战）| 等 R1 完成 |
| **Human T1 终审** | `approve:COSTRA-164`（D-024 §2.2 C1 与 165 攒批联合 approve · 第 N 次实战）| 等 R1 APPROVE |

---

## §1 背景

### 1.1 触发链

- **直接触发**：COSTRA-150 R1 卡审 P0-1 留 FU-150-FAMILY-CONTEXT-SERVICE Sprint-3+ · 显式注释 "miniprogram 全局当前无 active_family_id 概念"（syncScheduler.ts:43-50）
- **隐性触发**：Sprint-2 Retro §议题 25 同款 OpenAPI vs 实装漂移（AP-003）—— `OpenAPI /families/*` 已定义（openapi.yaml L161-319 · v2.0 修正 · 共 5 个 path 6 个端点）但无 routes/families.ts 实装 · **当前无 x-deferred 标记**（grep 0 命中 · v2.0 修正 · 是已知隐性漂移）· 链路完全断裂
- **决策锚定**：ADR-0007 family-ledger 关系模型（方案 R · user 多 family · family:ledger=1:1 产品语义 · schema 1:N 保留扩展空间）· 2026-05-27 落档
- **实测阻塞**：Phase-3 真机验证手册（qa/phase-3-prod-realdevice-test.md）需 Human SSH 手动 SQL 建 family + Console 注入 storage —— 不是产品形态

### 1.2 PRD / 契约锚点

- **ADR-0007** §3.1 决策：每个 user 登录后 server 自动 bootstrap 1 个个人 family · UI 称"我的账本"
- **ADR-0007** §6.1 实装锚点（本卡）：wxLogin 扩展 · AuthTokenPair 加 default_family_id/default_ledger_id · 不实装 /families REST
- **PRD §Epic-D L184**：家庭共享 P1 但 MVP 必做（charter §M2 Sprint-3~4 完成 Epic-C+D）
- **schema 现状**：0001_init.sql L29-78 families/ledgers/family_members 三表完备 · 不需 migration（ADR-0007 §4.1 锚定）

### 1.3 上下文：现有 wxLogin 流程

`server/src/services/authService.ts:118-139`：

```typescript
async function wxLogin(code: string): Promise<AuthTokenPair> {
  const { openid, unionid } = await wxCode2Session(code);
  const user = await userRepo.upsertByOpenid({ wxOpenid: openid, wxUnionid: unionid ?? null, nickname: defaultNickname });
  const pair = await signPair(user.id);
  await persistSession(user.id, pair.jti, pair.refreshTtl);
  return { access_token: ..., user: toUserView(user) };
}
```

**本卡介入点**：在 `upsertByOpenid` 后 / `signPair` 前插入 bootstrap 逻辑。

---

## §2 Scope（6 项 · 估点 3 · INVEST small）

> **v1.1 修订**（2026-05-27 11:13）：Human 追加需求 "默认家庭需区别于用户手动创建的家庭 · 默认家庭不可删除"。新增 §2.1 A0 migration · §2.1 A familyRepo 加 kind 参数 · §2.1 E 单测 +T9 kind 区分。估点保持 3pt（小幅 schema 改动 · 无回归风险）· 时间盒 +30min ≤ 180min。

### 2.1 主交付（6 项 · 必交）

#### A0 · migration 0007 · family_kind ENUM + kind 列 + partial unique index（**v1.1 新增**）

新建 `server/db/migrations/0007_families_kind.sql`：

```sql
-- =========================================================================
-- Costra · 0007 families 表加 kind 列（个人家庭 vs 共享家庭区分）
-- =========================================================================
-- 卡号：COSTRA-164 · ADR-0007 v1.1 §4.1 + §5.7
-- 触发：Human 2026-05-27 追加需求 · 个人 family 与用户主动创建 family 在产品行为上有差异
--   （不可删 / 不可邀请 / UI 暴露差异 / 未来可能更多差异逻辑）· 必须从数据层区分
--
-- 设计决策：
--   ① ENUM 不用 BOOLEAN：未来可能扩展 'work'/'project'/'shared_external' · ENUM ALTER TYPE ADD VALUE 比加列轻
--   ② DEFAULT 'shared'：用户主动创建走 DEFAULT · personal 由 server 显式赋值（authService bootstrap）
--   ③ partial unique index 防御性：每用户最多 1 个 personal · 即使代码 bug 重复 INSERT 也被 DB 拦截
--   ④ 历史回填：dev/staging/prod 表小（家庭记账数据量极低）· 一次 UPDATE 安全
-- =========================================================================

BEGIN;

-- ─── 1. 创建 ENUM 类型 ───────────────────────────────────────────────────
-- 'personal'：server bootstrap 创建的个人 family · 不可删 · 不可邀请
-- 'shared'：用户主动创建（POST /families · COSTRA-201 Sprint-4）/ 接受邀请加入
DO $$ BEGIN
  CREATE TYPE family_kind AS ENUM ('personal', 'shared');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- ─── 2. 加列（默认 shared 兼容存量数据语义）───────────────────────────────
ALTER TABLE families
  ADD COLUMN IF NOT EXISTS kind family_kind NOT NULL DEFAULT 'shared';

-- ─── 3. 历史回填 · 每用户第一个自己 owner 的 family 标记为 personal ────────
-- 范式参 0006_entries_change_seq.sql §3 ROW_NUMBER 回填
-- 排序键选 created_at ASC, id ASC 而非 0006 的 updated_at ASC（v2.0 落地 FU-164-005）：
--   ① "个人 family" 应按"创建时间"判定 · 而非"最近更新时间"（用户改名等会动 updated_at · 不应改变身份）
--   ② created_at ASC, id ASC 双键防同毫秒并发创建的歧义（UUID v7 在 id 中已含时间序 · 双键冗余但更显式）
--   ③ 边缘场景：dev/staging 现有数据均无并发同毫秒 · 0 风险 · prod 无业务数据 · 0 行 UPDATE
WITH ranked AS (
  SELECT id, owner_id,
    ROW_NUMBER() OVER (PARTITION BY owner_id ORDER BY created_at ASC, id ASC) AS rn
  FROM families
  WHERE deleted_at IS NULL
)
UPDATE families
SET kind = 'personal'
FROM ranked
WHERE families.id = ranked.id AND ranked.rn = 1;

-- ─── 4. 防御性约束：每用户最多 1 个 personal family ─────────────────────
-- 范式参 0001_init.sql:99-101 uq_categories_family_name_type partial unique index
CREATE UNIQUE INDEX IF NOT EXISTS uq_families_one_personal_per_owner
  ON families (owner_id)
  WHERE kind = 'personal' AND deleted_at IS NULL;

COMMIT;
```

**回填风险**：
- 当前 dev/staging/prod 数据库 `families` 表行数：dev 测试数据 ~5 行 / staging 联合实测数据 ~3 行 / prod 0 行（部署后无真实业务）· UPDATE 全表毫秒级
- 反向兼容：`kind` 字段对老 client 不可见（OpenAPI 不暴露 · server 内部用）· 不破坏任何现有调用

#### A · 新建 familyRepo + ledgerRepo（**v1.1 加 kind 参数**）

新建 `server/src/repositories/familyRepo.ts`：

```typescript
export type FamilyKind = 'personal' | 'shared';

export interface FamilyEntity {
  id: string;
  name: string;
  ownerId: string;
  kind: FamilyKind;        // v1.1 新增
  createdAt: Date;
  updatedAt: Date;
  version: number;
}

// 创建个人 family + family_members(owner) · 单事务 · kind 强制 'personal'
// 调用方不传 kind · 内部硬编码（防漂移 · 见 ADR-0007 §5.7.2 创建路径铁律）
// 防御层：partial unique index uq_families_one_personal_per_owner 兜底
//   · 若 race condition 重复 INSERT 会触发 unique violation · service 层应捕获并 fallback findPersonal
export async function createPersonalFamily(input: { ownerId: string; name: string }, client?: Runner): Promise<FamilyEntity>;

// 创建共享 family（Sprint-4 COSTRA-201 用 · 本卡声明接口 · 不导出）
// 故意不在本卡导出 · 防止误用 · 待 COSTRA-201 时启用
// export async function createSharedFamily(...): Promise<FamilyEntity>;

// 查 user 的所有 active families（left_at IS NULL · 排序 created_at ASC）
// 可选 filter by kind（Sprint-4 切换器 UI 用）
export async function listActiveFamiliesByUser(
  userId: string,
  filter?: { kind?: FamilyKind },
  client?: Runner
): Promise<FamilyEntity[]>;

// 查 user 的"个人 family"（kind='personal' AND owner_id=user_id · 至多 1 个 · partial unique index 保证）
export async function findPersonalFamily(userId: string, client?: Runner): Promise<FamilyEntity | null>;

// 软删 family · kind='personal' 守门（ADR-0007 §5.7.3 早期防御 · v2.0 落地 FU-164-004）
// 实现：先 findById 查 kind · kind === 'personal' 时抛 AppError(FAMILY_PERSONAL_NOT_DELETABLE)
//       否则 UPDATE families SET deleted_at=now(), version=version+1 WHERE id=$1 AND version=$2
// 本卡不暴露 REST 端点（DELETE /families 推 Sprint-4 COSTRA-201）· 但 service 层接口已就位 · 防 165 误调或未来漂移
export async function softDelete(input: { familyId: string; version: number }, client?: Runner): Promise<FamilyEntity>;
```

**注意**：
- `findPersonalFamily` 必须用 `WHERE owner_id=$1 AND kind='personal' AND deleted_at IS NULL` 查询 · **不再用 created_at ASC 取第一个**（v1.0 的 fallback 逻辑废弃 · partial unique index 保证唯一）
- v1.0 的 §7 风险条目 "多个个人 family 边缘场景（T6）" 在 v1.1 不复存在 · DB 层强约束兜底 · 测试 T6 改为校验 partial unique index 行为

新建 `server/src/repositories/ledgerRepo.ts`（**与 v1.0 保持不变**）：

```typescript
export interface LedgerEntity {
  id: string;
  familyId: string;
  name: string;
  currency: string;
  createdAt: Date;
  updatedAt: Date;
  version: number;
}

export async function createDefaultLedger(input: { familyId: string; name: string; currency: string }, client?: Runner): Promise<LedgerEntity>;

export async function findFirstByFamilyId(familyId: string, client?: Runner): Promise<LedgerEntity | null>;
```

**复用范式**：参照 `userRepo.ts` 的 Runner 透传模式（L73 / L114 / L141）· `client ?? db()` 兜底 · 单测可注入 mock。

#### B · authService.wxLogin 扩展为 ensureFamilyContext（**v2.0 落地 FU-164-001 + FU-164-002**）

> **v2.0 修订**：① withTransaction → `withTx`（实际函数名 · `server/src/db/pool.ts:L45-62` 已实装）· import 显式；② 加 try-catch `isUniqueViolation('uq_families_one_personal_per_owner')` + fallback `findPersonalFamily` 路径（解决 race condition · T6 期望路径在 service 层落地 · 不污染 repo 业务语义）。

在 `wxLogin` 流程中插入：

```typescript
import { withTx } from '../db/pool.js';            // v2.0 修正：复用已有 withTx · 不新建 transaction.ts
import * as familyRepo from '../repositories/familyRepo.js';
import * as ledgerRepo from '../repositories/ledgerRepo.js';

/**
 * PG unique violation 判定（pg lib error · code === '23505'）
 * 项目无现成工具 · 本卡内联（避免新建工具增加 scope · 参 errorHandler.ts L95 fastify err.code 范式）
 * 双校验 code + constraint · 防误捕其他 unique 约束
 */
function isUniqueViolation(err: unknown, constraint: string): boolean {
  return (
    typeof err === 'object' && err !== null &&
    (err as { code?: string }).code === '23505' &&
    (err as { constraint?: string }).constraint === constraint
  );
}

async function wxLogin(code: string): Promise<AuthTokenPair> {
  const { openid, unionid } = await wxCode2Session(code);

  // 单事务包住 user upsert + family/ledger bootstrap · 防数据漂移
  const { user, defaultFamilyId, defaultLedgerId } = await withTx(async (client) => {
    const user = await userRepo.upsertByOpenid(
      { wxOpenid: openid, wxUnionid: unionid ?? null, nickname: defaultNickname },
      client,
    );

    // ① 先查个人 family（v1.1 强 WHERE：kind='personal' · partial unique index 保证至多 1 行）
    let personalFamily = await familyRepo.findPersonalFamily(user.id, client);
    let defaultLedger;

    if (!personalFamily) {
      // ② 首登 / 边缘自愈：尝试 bootstrap · race condition 时由 catch 兜底
      try {
        personalFamily = await familyRepo.createPersonalFamily(
          { ownerId: user.id, name: '我的账本' },
          client,
        );
      } catch (err) {
        if (isUniqueViolation(err, 'uq_families_one_personal_per_owner')) {
          // race condition：另一并发请求已 INSERT 成功 · 重读即可
          personalFamily = await familyRepo.findPersonalFamily(user.id, client);
          if (!personalFamily) {
            // 极边缘：catch unique violation 但 findPersonal 仍返 null（应不可能 · DB 层异常）
            throw new AppError(ErrorCode.UNAVAILABLE, {
              message: 'family bootstrap raced and lost',
              cause: err,
            });
          }
        } else {
          throw err;
        }
      }
      // 同事务内建 ledger（family 已存在）
      defaultLedger = await ledgerRepo.createDefaultLedger(
        { familyId: personalFamily.id, name: '日常账本', currency: 'CNY' },
        client,
      );
    } else {
      // ③ 重登：取个人 family 的 ledger
      defaultLedger = await ledgerRepo.findFirstByFamilyId(personalFamily.id, client);
      if (!defaultLedger) {
        // 防御性：个人 family 存在但 ledger 缺失（数据异常 · 历史脏数据）→ 自愈补建
        defaultLedger = await ledgerRepo.createDefaultLedger(
          { familyId: personalFamily.id, name: '日常账本', currency: 'CNY' },
          client,
        );
      }
    }

    return {
      user,
      defaultFamilyId: personalFamily.id,
      defaultLedgerId: defaultLedger.id,
    };
  });

  const pair = await signPair(user.id);
  await persistSession(user.id, pair.jti, pair.refreshTtl);

  return {
    access_token: pair.accessToken,
    refresh_token: pair.refreshToken,
    access_token_ttl_sec: pair.accessTtl,
    refresh_token_ttl_sec: pair.refreshTtl,
    expires_in: pair.accessTtl,
    user: toUserView(user),
    default_family_id: defaultFamilyId,
    default_ledger_id: defaultLedgerId,
  };
}
```

**关键点**：
- 整个 user upsert + family bootstrap 在**同一事务**内（确保 user 创建成功但 family/ledger 失败时回滚 · 防数据漂移）
- **复用 `withTx`**（v2.0）：`server/src/db/pool.ts:L45-62` 已实装 · 签名 `<T>(fn: (client: PoolClient) => Promise<T>) => Promise<T>` · 无需新建 `transaction.ts`
- **race condition 防御**（v2.0）：partial unique index `uq_families_one_personal_per_owner` 在 DB 层兜底 · service 层 `isUniqueViolation` catch 后 fallback `findPersonalFamily` 自愈 · T6 期望路径完全在 service 层（不污染 repo 业务语义 · 参 userRepo.ts L11 范式）
- **`isUniqueViolation` 工具就地内联**（v2.0）：避免新建独立文件膨胀 scope · 双校验 PG err.code='23505' + constraint 名 · 防误捕其他 unique 约束
- 重登场景检查 family 存在性 · O(1) 索引扫描（`idx_families_owner` 已在 0001_init.sql L38 + `uq_families_one_personal_per_owner` partial unique 0007 新建）
- "个人 family" 判定标准（v1.1）：`kind='personal' AND deleted_at IS NULL AND owner_id=user_id` · partial unique index 保证至多 1 行 · 不再用 created_at ASC fallback

#### C · AuthTokenPair 接口 + OpenAPI schema 同步

`server/src/services/authService.ts` L36-52：

```typescript
export interface AuthTokenPair {
  // 现有字段保持不变
  access_token: string;
  refresh_token: string;
  access_token_ttl_sec: number;
  refresh_token_ttl_sec: number;
  expires_in: number;
  user: { ... };

  // 新增（COSTRA-164）：
  default_family_id: string;     // bootstrap 创建的个人 family id（永远非空）
  default_ledger_id: string;     // 个人 family 的默认 ledger id（永远非空）
}
```

`server/api/openapi.yaml#components.schemas.AuthTokenPair`（L865+）：

```yaml
AuthTokenPair:
  type: object
  required:
    - access_token
    - refresh_token
    - access_token_ttl_sec
    - refresh_token_ttl_sec
    - user
    - default_family_id     # 新增
    - default_ledger_id     # 新增
  properties:
    # 现有字段保持
    default_family_id:
      type: string
      format: uuid
      description: |
        用户登录后的默认 family · 由 server 在首登时 atomic bootstrap 创建（"我的账本"）。
        客户端应在登录成功后写入 storage 作为 active_family_id 兜底（COSTRA-165 family-context service 锚点）。
        参考：ADR-0007 §5.6
    default_ledger_id:
      type: string
      format: uuid
      description: |
        默认 family 的唯一 ledger id（产品语义 family:ledger=1:1）。
        客户端记账时默认填充（COSTRA-165 home/entry 接入锚点）。
```

**禁项**（v2.0 修正）：本卡不实装 `/families` REST 端点（推 Sprint-4 COSTRA-201 邀请流程）。

**关于 OpenAPI L161-319 `/families/*` 段（v2.0 事实修正）**：
- **当前事实**：5 个 path（`/families` · `/families/{id}` · `/families/{id}/invites` · `/families/invites/accept` · `/families/{id}/members/{uid}`）共 6 个端点 · **均无 `x-deferred` 标记**（`grep -n 'deferred' server/api/openapi.yaml` 返回 0 匹配）
- **本质判定**：这是 **D-025 AP-003 命中（已知隐性漂移）** · 与 Sprint-2 Retro §议题 25 同款（OpenAPI 已定义但 server 路由未实装且未做 deferred 标记）
- **本卡不补 x-deferred 标记**：标记补齐推 **COSTRA-161**（whitelist-check 规则 E · OpenAPI 实装齐全度自动检测 · dispatch-ready @ 2026-05-19）或 **Sprint-4 COSTRA-201**（一并实装时清掉 deferred）· 二选一由 Orchestrator 在 COSTRA-201 dispatch 时决策
- **本卡边界**：不引入新 deferred · 不清旧 deferred · 不动 L161-319 任何一行

#### D · 配置项添加（家庭数量上限）

`server/src/config/env.ts` 加：

```typescript
MAX_FAMILIES_PER_USER: number;        // 默认 20 · 后端硬上限 · 防恶意创建
USER_VISIBLE_FAMILY_LIMIT: number;    // 默认 3 · 应用层校验 · MVP 限制 · 可调
```

**本卡仅添加配置 + 加载逻辑**（占位 · 不做强校验逻辑）· 校验逻辑由 Sprint-4 COSTRA-201 `POST /families` 实装时落地。

#### E · 单测 ≥ 9 测（**v1.1 +T9 · T6 重写为 partial unique index 行为校验**）

新建 `server/test/auth-family-bootstrap.test.ts`：

| 编号 | 测试点 | 期望 |
|---|---|---|
| T1 | 首登触发 bootstrap | response 含 default_family_id + default_ledger_id（非空 UUID）· DB families 表 +1 行（owner_id=user_id, name='我的账本', **kind='personal'**）· family_members 表 +1 行（role='owner', left_at IS NULL）· ledgers 表 +1 行（family_id=新 family id, name='日常账本', currency='CNY'）|
| T2 | 重登命中已有 family | response 含的 default_family_id === 首登的 id · DB 不新增 family/ledger 行 · familyRepo.findPersonalFamily 走 `kind='personal'` WHERE 子句 |
| T3 | 重登 · 个人 family 存在但 ledger 缺失（数据异常） | 自愈补建 ledger · response 返回新建的 ledger_id |
| T4 | bootstrap 事务回滚（mock ledger create 失败） | user 也回滚 · DB 无任何残留行 |
| T5 | upsert 复用现有 user（已有 wx_openid） | 不创建新 user · 但 family bootstrap 正常按"重登命中"分支走 |
| **T6** | **partial unique index 拦截重复 personal 创建**（v1.1 重写）| 直接调 `familyRepo.createPersonalFamily` 两次同一 owner · **第二次抛 unique violation** · service 层应捕获并 fallback `findPersonalFamily` 返回首次创建的 family（race condition 自愈）|
| T7 | response schema 校验（OpenAPI 一致性）| AuthTokenPair fixture 含 default_family_id + default_ledger_id required · @fastify/swagger 或手测脚本 |
| T8 | 整体 wxLogin happy path（含微信 mock + Redis mock + DB pg-mem） | 端到端首登成功 · 含 access_token + family/ledger 两 id |
| **T9** | **kind 字段持久化校验**（v1.1 新增）| 首登后查 DB：`SELECT kind FROM families WHERE owner_id=:user_id` 返 `'personal'` · 用户主动创建 family（mock）走 DEFAULT 'shared' 分支 · 校验两条创建路径 kind 严格区分 · 同时校验 `kind` 不可被 PATCH（白名单字段不含 kind）|
| **T10** | **familyRepo.softDelete kind 守门**（v2.0 新增 · FU-164-004）| ① softDelete personal family → 抛 `AppError(FAMILY_PERSONAL_NOT_DELETABLE)` · DB 不变；② softDelete shared family → 成功 · DB `deleted_at` 非空 · `version+1`；③ softDelete 不存在 family → 抛 `NOT_FOUND`（参 entryService 范式）|

**pg-mem 兼容性提醒**：pg-mem 支持 ENUM type + partial unique index · 已在 0006 migration 实战验证（ADR-0006 §2.1 说明）· T6 应能复现 unique violation。

### 2.2 不在本卡范围

- ❌ `POST /families` 创建新家庭 → COSTRA-201 Sprint-4
- ❌ `POST /invites/accept` 加入 → COSTRA-202 Sprint-4
- ❌ family rename / leave / archive → Sprint-4+
- ❌ MAX_FAMILIES_PER_USER / USER_VISIBLE_FAMILY_LIMIT 强校验逻辑 → COSTRA-201 落地（本卡仅添加配置占位）
- ❌ active_family_id 切换器 UI → COSTRA-165 也不做（R2 范围）
- ❌ schema migration → ADR-0007 §4.1 锚定 R1 改动量 = 0
- ❌ /sync/pull SQL 调整 → ADR-0007 §5.5 铁律：R1 阶段绝对禁止触碰 syncPullService.ts

---

## §3 DoD（23 项 · v2.1 计数修正：G 闸门 10 项 + 单测 T1~T10 + 反向验证 3 项）

### G1~G8 + G15 + G16 标准闸门（10 项）

- **G1** TypeScript typecheck 全绿（`cd server && npm run typecheck`）
- **G2** ESLint 全绿（`cd server && npm run lint`）
- **G3** OpenAPI lint 全绿（`cd server && npm run openapi:lint`）+ AuthTokenPair 新增字段 schema 合法
- **G4** server 单测全绿（`cd server && npm test` · 含本卡新增 T1~T10）
- **G5** schema-check 全绿（含本卡 0007 migration · 校验 ENUM + partial unique index 在 pg-mem 与真 PG 行为一致）
- **G6** whitelist-check 全绿（路径白名单 + 规则 D OpenAPI vs fastify prefix）
- **G7** OpenAPI 实装齐全（AuthTokenPair 新字段 server 实装一致）
- **G8**（v2.0 修正）x-deferred 不新增 · /families/* L161-319 当前无 x-deferred 标记（**AP-003 已知隐性漂移** · 非本卡范围 · 推 COSTRA-161 规则 E 或 COSTRA-201 一并补齐）
- **G15** D-016 反例预防（commit 前 `git status -s | grep '.team/members/' | wc -l` = 0）
- **G16**（v1.1 新增）migration 0007 幂等性 · 在已迁移过的 DB 上重跑应无副作用：`DO $$ BEGIN ... EXCEPTION WHEN duplicate_object THEN NULL; END $$` 包裹 ENUM 创建 · `IF NOT EXISTS` 包裹索引和列

### T1~T10 单测（10 项 · 见 §2.1 E）

### 反向验证（3 项 · v1.1 +③）

- ① 临时关闭事务包裹（user upsert 与 family bootstrap 分两个事务） → T4 应 FAIL（mock ledger create 失败时 user 残留）→ revert
- ② 临时让 findPersonalFamily 总返 null → T2 应 FAIL（重登也会重复 bootstrap）→ revert
- **③**（v1.1 新增）临时移除 partial unique index `uq_families_one_personal_per_owner` → T6 应 FAIL（重复 INSERT 不抛 unique violation）→ revert

### D-025 反模式扫描（无命中 · 仅声明）

- AP-001 不命中（INVEST small 单装扮档单 commit · 非字符串代理判定）
- AP-002 不命中（complete 新建 · 无跨卡复制）
- **AP-003 命中（已知隐性漂移）**（v2.0 修正）：openapi.yaml L161-319 共 5 个 path 6 个端点（`/families` · `/families/{id}` · `/families/{id}/invites` · `/families/invites/accept` · `/families/{id}/members/{uid}`）无实装 · 无 x-deferred 标记（grep 0 命中）· 与 Sprint-2 Retro §议题 25 同款。**本卡不引入新 deferred · 也不动 L161-319 任何一行**（标记补齐推 COSTRA-161 规则 E 或 Sprint-4 COSTRA-201）· 不阻塞 PASS-WITH-FOLLOWUP

---

## §4 强制阅读清单

1. 本派单档全文
2. **ADR-0007** family-ledger 关系模型（`.team/decisions/ADR-0007-family-ledger-relation-model.md`）—— 决策锚定 · 必读
3. **现有 wxLogin 流程**：`server/src/services/authService.ts:118-139`（介入点）+ L35-52（AuthTokenPair）
4. **userRepo 范式**：`server/src/repositories/userRepo.ts:73,114,141`（Runner 透传模式 · 本卡 familyRepo / ledgerRepo 复用）
5. **DB schema 锚点**：`server/db/migrations/0001_init.sql:29-78`（families / ledgers / family_members 三表）
6. **OpenAPI 现状**：`server/api/openapi.yaml:865+`（AuthTokenPair schema · 加 default_family_id / default_ledger_id）
7. **Phase-3 实测手册**：`qa/phase-3-prod-realdevice-test.md §1.4 §3.1 §3.2`（本卡完成后这三段废弃）
8. **D-022 v2.0 review-tech 评分矩阵**
9. **D-025 反模式清单**

---

## §5 硬约束

### §5.1 工作区铁律

- ✅ 可写：
  - `server/db/migrations/0007_families_kind.sql`（**新建** · v1.1 加入 · ADR-0007 §4.1 锚定）
  - `server/src/services/authService.ts`（wxLogin 扩展）
  - `server/src/repositories/familyRepo.ts`（**新建**）
  - `server/src/repositories/ledgerRepo.ts`（**新建**）
  - `server/src/errors/ErrorCode.ts`（**v2.0 新增** · 加 `FAMILY_PERSONAL_NOT_DELETABLE` enum + http status 403 + retry 'none' · ADR-0007 §5.7.3 锚定 · familyRepo.softDelete 抛此码）
  - `server/src/config/env.ts`（添加 2 个配置项）
  - `server/api/openapi.yaml`（AuthTokenPair schema 加字段）
  - `server/test/auth-family-bootstrap.test.ts`（新建）
  - `.team/members/backend-dev/state.md` + history
  - `.team/follow-ups/README.md`（FU-150-FAMILY-CONTEXT-SERVICE 状态 → scoped to COSTRA-165 · 本卡部分兑现 server 侧）
- ❌ 不可写：
  - `server/src/services/syncPullService.ts`（**ADR-0007 §5.5 铁律**）
  - `server/src/routes/sync.ts`（同上）
  - `server/src/routes/entries.ts`（152/153 已稳定 · 本卡不动）
  - `miniprogram/`（COSTRA-165 范围）
  - `server/db/migrations/0001_init.sql ~ 0006_*.sql`（仅允许新建 0007 · 旧 migration 不可改）
  - `infra/`
  - 其他 `.team/members/{other-role}/`

### §5.2 INVEST small（3 点）

- 时间盒 R1 实装 ≤ 180 分钟（v1.1 +30min · 含 0007 migration + familyRepo kind 参数 + 9 测 + 反向验证 ③ · 仍在 small 范围）
- 6 项 scope 单点修改密度可控 · 现有范式齐全（userRepo 模板 + 0006 migration 模板 + authService 当前清晰）

### §5.3 已知未知 / follow-up 候选

- **FU-164-WITH-TX-UTIL**（v2.1 修正 · 已确认复用 pool.ts:withTx · 不新建）：评估未来是否抽出独立 plugin / utility 供其他 service 复用（withTx 当前在 pool.ts · 视为合适位置）· 留 Sprint-4 评估
- **FU-164-AUTH-RESPONSE-VERSIONING**：response 加字段是非破坏性扩展 · 但客户端旧版本会忽略新字段 · 留 D-026 staging-prod-merged-acceptance 时核验老 client 兼容性
- **FU-164-FAMILY-KIND-CHECK-MIDDLEWARE**（v1.1 新增）：Sprint-4 COSTRA-201 落 `DELETE /families/{id}` 时 · 评估抽出 `requireKind('shared')` 中间件统一守门 · 当前由 service 层判定即可

### §5.4 D-016 同轮兑现 · D-018 单装扮档单 commit

- commit footer：`Co-Authored-By: backend-dev <subagent>` · `closes-partial: FU-150-FAMILY-CONTEXT-SERVICE (server 侧)`
- commit subject 全小写（commitlint）· `Refs: COSTRA-164` 大写在 footer
- commit 前 final message 含 `git status -s | grep '.team/members/' | wc -l` = 0

---

## §6 估点 / 时间盒

- **估点**：3 点
- **AI 时间盒**：~~2.5~3 小时~~（含 Card-Review + R1 实装 + R1 Review）
- **Human 实测**：与 165 联合 staging 实测（D-024 §2.2 C1 攒批）· 复用 staging 环境

---

## §7 已知风险

- **withTx 工具已确认复用**（v2.1 修正 · 原 v1.1 风险条目消除）：`server/src/db/pool.ts:L45-62` 已实装 `withTx<T>` · 签名完全满足本卡需求 · **无需新建 transaction.ts** · §2.1 B 已复用 + 显式 import
- **AuthTokenPair 加字段非破坏性兼容**：旧 client 会忽略新字段 · 但旧 client 仍走 `__costra_family_id_v1` 旧 key · 需 165 一并清除迁移（COSTRA-165 §2.1 锚定）
- **bootstrap 事务时延**（v2.0 修正 · 落地 FU-164-006 · D-022 §2.2 C8-3 `[未经验测]` 范式）：
  - **[未经验测]** 单事务 < 30ms 为纸面预期 · PG 索引扫描 + 3 INSERT（family + family_members + ledger · 命中 idx_families_owner + uq_families_one_personal_per_owner）实际时延需 staging 实测确认
  - 实测节点：与 165 联合 staging 实测时观察 server 日志 · 记录 P50/P95 时延
  - 兜底策略：若实测 P95 > 100ms（如 PG 主从复制慢 / 连接池打满）评估异步化 · 不在本卡 · 留 R3 阶段观察
- **多个个人 family 边缘场景**（v1.0 风险 → v1.1 已消除）：partial unique index `uq_families_one_personal_per_owner` DB 层强约束兜底 · 已不复存在
- **migration 0007 在 prod 部署后跑**（v1.1 新增）：当前 prod 已部署但无业务数据 · 跑 migration 0007 安全（历史回填 UPDATE 0 行）· 但流程上必须**先在 staging 跑过 + COSTRA-164 R1 APPROVE + 再走 deploy-all.sh §6 06-migrate.sh** · 不可在 prod 直接跑未审 migration · 范式参 0006 v1.2 升级流程（commit 31fb893）

---

## §8 联动事项

- **更新 `.team/follow-ups/README.md`**：
  - FU-150-FAMILY-CONTEXT-SERVICE → 本卡 R1 APPROVE 后改为 `partial-closed @ COSTRA-164 (server)` · 等 165 完整闭合
- **更新 `qa/phase-3-prod-realdevice-test.md`**：本卡 + 165 全 APPROVE 后修订 §3.1 SSH 手填 SQL + §3.2 storage 注入段废弃 · 派 qa-planner 出新版手册（D-025 §议题 25 反模式：Orchestrator 不直写 Human 操作类文档）

---

**派单档结束 · Orchestrator 等 Human 拍板 + Card-Review R1 PASS 后 spawn backend-dev R1 实装。**

---

## §10 修订历史

| 版本 | 时间 | 变更 |
|---|---|---|
| v1.0 | 2026-05-27 | 首版立档（基于 ADR-0007 v1.0 §6.1 实装锚点 · Sprint-3 头部第 3 张派单） |
| **v1.1** | **2026-05-27 11:13** | Human 追加需求 "默认家庭需区别于用户手动创建的家庭 · 默认家庭不可删除"（ADR-0007 v1.1 §4.1 + §5.7 落地）。变更：① §2 scope 5项 → 6项 · 新增 §2.1 A0 migration 0007（family_kind ENUM + kind 列 + uq_families_one_personal_per_owner partial unique index + 历史回填）；② §2.1 A familyRepo 加 kind 参数 + FamilyKind 类型 + listActiveFamiliesByUser filter；③ §2.1 E 单测 8 测 → 9 测（T6 重写为 partial unique index 行为校验 · T9 新增 kind 持久化校验）；④ §3 DoD 19 项 → 21 项（+G16 migration 幂等性 · +反向验证 ③）；⑤ §5.1 工作区开放 0007 migration 写权限；⑥ §5.2 时间盒 150min → 180min（仍在 small 范围）；⑦ §5.3 +FU-164-FAMILY-KIND-CHECK-MIDDLEWARE；⑧ §7 风险删除多个 personal family 条目（partial unique index 解决）+ 新增 migration 在 prod 部署风险条目 |
| **v2.0** | **2026-05-27 14:30** | Card-Review R1 PASS-WITH-FOLLOWUP 25/30 · 6 项 FU 全部 R1 修订兑现（D-016 100% 修订率铁律）。变更：① **FU-164-001** 落地：§2.1 B 复用 `withTx`（pool.ts L45-62 已实装）· 删除 transaction.ts 新建条目 · import 路径显式 · §7 风险条目相应清理；② **FU-164-002** 落地：§2.1 B wxLogin 代码补 `try-catch isUniqueViolation('uq_families_one_personal_per_owner') + fallback findPersonalFamily` 路径 · `isUniqueViolation` 工具就地内联（pg err.code='23505' + constraint 双校验）· T6 期望与代码完全对齐 · 极边缘 throw `UNAVAILABLE`；③ **FU-164-003** 落地：§1.1 + §2.1 C + §3 G8 + §3 AP-003 四处虚假 deferred 声明全部修正 · /families/* 行号 L161-308 → L161-319 · AP-003 改为"命中（已知隐性漂移 · 不阻塞）" · 标记补齐推 COSTRA-161 或 COSTRA-201；④ **FU-164-004** 落地：§2.1 A familyRepo 加 `softDelete(input,client)` kind 守门接口 · §5.1 工作区加 ErrorCode.ts 写权限（加 FAMILY_PERSONAL_NOT_DELETABLE enum）· §2.1 E 加 T10 守门测试；⑤ **FU-164-005** 落地：§2.1 A0 migration 排序键 `created_at ASC, id ASC` 选择理由补充注释（vs 0006 用 updated_at ASC）；⑥ **FU-164-006** 落地：§7 bootstrap 时延 < 30ms 加 `[未经验测]` 标注（D-022 §2.2 C8-3 范式）· 实测节点显式（与 165 联合 staging 实测）。DoD 21 项 → 22 项（+T10）· 单测 9 测 → 10 测 · scope 仍 6 项 · 估点保持 3pt · 时间盒保持 180min（softDelete 接口轻量 + isUniqueViolation 内联 + 注释修正零成本） |
| **v2.1** | **2026-05-27 15:00** | Card-Review R2 PASS-WITH-FOLLOWUP 28/30 形式审 · 5/6 FU 完全兑现 + 1 项 P1 残留（FU-164-001 §5.1/§7/§5.3 三处旧文未清）+ 1 项 P2（DoD 计数 22 vs 实际 23）· R2 修订全落地：① §5.1 L460 删除 `server/src/db/transaction.ts` 条目（保留 `errors/ErrorCode.ts`）；② §5.3 `FU-164-WITH-TRANSACTION-UTIL` → `FU-164-WITH-TX-UTIL`（已确认复用 pool.ts:withTx · 不新建）；③ §7 "withTransaction 工具是否已存在"风险条目 → 改为"withTx 工具已确认复用"事实陈述；④ §3 DoD 标题计数 22 → 23（10 G + 10 T + 3 反向 = 23）。变更不影响实装 · 仅文档一致性清理 · 估点 / 时间盒 / scope 均不变 |
