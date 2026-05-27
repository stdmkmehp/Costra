# COSTRA-164 · server family bootstrap MVP（首登 atomic 建个人 family + ledger）

> **派单时间**：2026-05-27（Orchestrator · Sprint-3 头部第 3 张 · 接续 154/150 联合 approve 阻塞链）
> **状态**：dispatch 草稿 · 等 Human 拍板 → Card-Review R1 → R1 实装
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
- **隐性触发**：Sprint-2 Retro §议题 25 同款 OpenAPI vs 实装漂移（AP-003）—— `OpenAPI /families/*` 已定义（openapi.yaml L161-308）但无 routes/families.ts 实装 · 链路完全断裂
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

## §2 Scope（5 项 · 估点 3 · INVEST small）

### 2.1 主交付（5 项 · 必交）

#### A · 新建 familyRepo + ledgerRepo

新建 `server/src/repositories/familyRepo.ts`：

```typescript
export interface FamilyEntity {
  id: string;
  name: string;
  ownerId: string;
  createdAt: Date;
  updatedAt: Date;
  version: number;
}

// 创建个人 family + family_members(owner) · 单事务（事务由调用方传入 client?: Runner）
export async function createPersonalFamily(input: { ownerId: string; name: string }, client?: Runner): Promise<FamilyEntity>;

// 查 user 的所有 active families（left_at IS NULL · 排序 created_at ASC）
export async function listActiveFamiliesByUser(userId: string, client?: Runner): Promise<FamilyEntity[]>;

// 查 user 的"个人 family"（owner_id = user_id · created_at ASC 第一个）
export async function findPersonalFamily(userId: string, client?: Runner): Promise<FamilyEntity | null>;
```

新建 `server/src/repositories/ledgerRepo.ts`：

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

#### B · authService.wxLogin 扩展为 ensureFamilyContext

在 `wxLogin` 流程中插入：

```typescript
async function wxLogin(code: string): Promise<AuthTokenPair> {
  const { openid, unionid } = await wxCode2Session(code);

  // 用单事务包住 user upsert + family/ledger bootstrap
  const { user, defaultFamilyId, defaultLedgerId } = await withTransaction(async (client) => {
    const user = await userRepo.upsertByOpenid({ wxOpenid: openid, wxUnionid: unionid ?? null, nickname: defaultNickname }, client);

    let personalFamily = await familyRepo.findPersonalFamily(user.id, client);
    let defaultLedger;

    if (!personalFamily) {
      // 首登：bootstrap 个人 family + family_members(owner) + ledger
      personalFamily = await familyRepo.createPersonalFamily({ ownerId: user.id, name: '我的账本' }, client);
      defaultLedger = await ledgerRepo.createDefaultLedger({ familyId: personalFamily.id, name: '日常账本', currency: 'CNY' }, client);
    } else {
      // 重登：取个人 family 的第一个 ledger（产品语义 1:1 · schema 上 1:N · 取 created_at ASC 第一个）
      defaultLedger = await ledgerRepo.findFirstByFamilyId(personalFamily.id, client);
      if (!defaultLedger) {
        // 防御性：个人 family 存在但 ledger 缺失（数据异常）→ 自愈补建
        defaultLedger = await ledgerRepo.createDefaultLedger({ familyId: personalFamily.id, name: '日常账本', currency: 'CNY' }, client);
      }
    }

    return { user, defaultFamilyId: personalFamily.id, defaultLedgerId: defaultLedger.id };
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
- `withTransaction` 工具如未存在需在本卡新建（参 `server/src/db/index.ts` 现有 pg client · 包装成 `BEGIN ... COMMIT/ROLLBACK`）
- 重登场景检查 family 存在性 · O(1) 索引扫描（`idx_families_owner` 已在 0001_init.sql L38）
- "个人 family" 判定标准：`owner_id = user_id` AND `deleted_at IS NULL` · `created_at ASC` 第一个（防多个个人 family 边缘场景）

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

**禁项**：不做 `/families` REST 端点（推 Sprint-4 COSTRA-201 邀请流程）· OpenAPI L161-308 `/families/*` 段保留 x-deferred 标记或不动（视现状）。

#### D · 配置项添加（家庭数量上限）

`server/src/config/env.ts` 加：

```typescript
MAX_FAMILIES_PER_USER: number;        // 默认 20 · 后端硬上限 · 防恶意创建
USER_VISIBLE_FAMILY_LIMIT: number;    // 默认 3 · 应用层校验 · MVP 限制 · 可调
```

**本卡仅添加配置 + 加载逻辑**（占位 · 不做强校验逻辑）· 校验逻辑由 Sprint-4 COSTRA-201 `POST /families` 实装时落地。

#### E · 单测 ≥ 8 测

新建 `server/test/auth-family-bootstrap.test.ts`：

| 编号 | 测试点 | 期望 |
|---|---|---|
| T1 | 首登触发 bootstrap | response 含 default_family_id + default_ledger_id（非空 UUID）· DB families 表 +1 行（owner_id=user_id, name='我的账本'）· family_members 表 +1 行（role='owner', left_at IS NULL）· ledgers 表 +1 行（family_id=新 family id, name='日常账本', currency='CNY'）|
| T2 | 重登命中已有 family | response 含的 default_family_id === 首登的 id · DB 不新增 family/ledger 行 |
| T3 | 重登 · 个人 family 存在但 ledger 缺失（数据异常） | 自愈补建 ledger · response 返回新建的 ledger_id |
| T4 | bootstrap 事务回滚（mock ledger create 失败） | user 也回滚 · DB 无任何残留行 |
| T5 | upsert 复用现有 user（已有 wx_openid） | 不创建新 user · 但 family bootstrap 正常按"重登命中"分支走 |
| T6 | 多个个人 family 边缘场景（手工注入两个 owner_id=user_id 的 families） | findPersonalFamily 取 created_at ASC 第一个 · 行为确定可重现 |
| T7 | response schema 校验（OpenAPI 一致性）| AuthTokenPair fixture 含 default_family_id + default_ledger_id required · @fastify/swagger 或手测脚本 |
| T8 | 整体 wxLogin happy path（含微信 mock + Redis mock + DB pg-mem） | 端到端首登成功 · 含 access_token + family/ledger 两 id |

### 2.2 不在本卡范围

- ❌ `POST /families` 创建新家庭 → COSTRA-201 Sprint-4
- ❌ `POST /invites/accept` 加入 → COSTRA-202 Sprint-4
- ❌ family rename / leave / archive → Sprint-4+
- ❌ MAX_FAMILIES_PER_USER / USER_VISIBLE_FAMILY_LIMIT 强校验逻辑 → COSTRA-201 落地（本卡仅添加配置占位）
- ❌ active_family_id 切换器 UI → COSTRA-165 也不做（R2 范围）
- ❌ schema migration → ADR-0007 §4.1 锚定 R1 改动量 = 0
- ❌ /sync/pull SQL 调整 → ADR-0007 §5.5 铁律：R1 阶段绝对禁止触碰 syncPullService.ts

---

## §3 DoD（19 项）

### G1~G8 + G15 标准闸门（9 项）

- **G1** TypeScript typecheck 全绿（`cd server && npm run typecheck`）
- **G2** ESLint 全绿（`cd server && npm run lint`）
- **G3** OpenAPI lint 全绿（`cd server && npm run openapi:lint`）+ AuthTokenPair 新增字段 schema 合法
- **G4** server 单测全绿（`cd server && npm test` · 含本卡新增 T1~T8）
- **G5** schema-check 全绿（无 schema migration · 应通过）
- **G6** whitelist-check 全绿（路径白名单 + 规则 D OpenAPI vs fastify prefix）
- **G7** OpenAPI 实装齐全（AuthTokenPair 新字段 server 实装一致）
- **G8** x-deferred 不新增（本卡不引入新 deferred · /families REST 仍是 deferred 但不动它）
- **G15** D-016 反例预防（commit 前 `git status -s | grep '.team/members/' | wc -l` = 0）

### T1~T8 单测（8 项 · 见 §2.1 E）

### 反向验证（2 项）

- ① 临时关闭事务包裹（user upsert 与 family bootstrap 分两个事务） → T4 应 FAIL（mock ledger create 失败时 user 残留）→ revert
- ② 临时让 findPersonalFamily 总返 null → T2 应 FAIL（重登也会重复 bootstrap）→ revert

### D-025 反模式扫描（无命中 · 仅声明）

- AP-001 不命中（INVEST small 单装扮档单 commit · 非字符串代理判定）
- AP-002 不命中（complete 新建 · 无跨卡复制）
- AP-003 不命中（本卡不引入新 deferred · 也不清旧 deferred · /families REST 留 Sprint-4）

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
  - `server/src/services/authService.ts`（wxLogin 扩展）
  - `server/src/repositories/familyRepo.ts`（**新建**）
  - `server/src/repositories/ledgerRepo.ts`（**新建**）
  - `server/src/db/transaction.ts`（如需新建 withTransaction 工具 · 视现状）
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
  - `server/db/migrations/`（ADR-0007 §4.1 锚定 R1 改动量 = 0）
  - `infra/`
  - 其他 `.team/members/{other-role}/`

### §5.2 INVEST small（3 点）

- 时间盒 R1 实装 ≤ 150 分钟（含 familyRepo + ledgerRepo 新建 · withTransaction 工具评估 · authService 改造 · 8 测）
- 5 项 scope 单点修改密度可控 · 现有范式齐全（userRepo 模板 + authService 当前清晰）

### §5.3 已知未知 / follow-up 候选

- **FU-164-WITH-TRANSACTION-UTIL**（如本卡新建 withTransaction 工具）：评估是否抽出独立 plugin / utility 供其他 service 复用 · 留 Sprint-4 评估
- **FU-164-AUTH-RESPONSE-VERSIONING**：response 加字段是非破坏性扩展 · 但客户端旧版本会忽略新字段 · 留 D-026 staging-prod-merged-acceptance 时核验老 client 兼容性

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

- **withTransaction 工具是否已存在**：本卡需先核查 `server/src/db/` · 若无需新建 · 若有则复用 · R1 实装期评估
- **AuthTokenPair 加字段非破坏性兼容**：旧 client 会忽略新字段 · 但旧 client 仍走 `__costra_family_id_v1` 旧 key · 需 165 一并清除迁移（COSTRA-165 §2.1 锚定）
- **bootstrap 事务时延**：单事务 < 30ms 预期 · 若实测 > 100ms（如 PG 慢）需评估异步化（不在本卡 · 留观察）
- **多个个人 family 边缘场景（T6）**：当前 schema 不限制同 user 创建多个 owner=self 的 family · 取 created_at ASC 第一个是确定行为 · 若未来出现 SaaS 漂移需新加 unique 约束（留 Sprint-4+ Retro）

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
