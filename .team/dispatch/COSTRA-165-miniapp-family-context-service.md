# COSTRA-165 · miniapp family-context service（active_family_id / active_ledger_id 全链路接入）

> **派单时间**：2026-05-27（Orchestrator · Sprint-3 头部第 4 张 · 与 164 联立攒批）
> **当前版本**：v1.1（2026-05-27 16:00 · Card-Review R1 修订 · 25/30 → 期望 ≥ 27 APPROVE · 落 3 P1 + 3 P2 全 6 项）
> **状态**：v1.1 修订完成 · 等 Card-Review R2 形式审 · 期望 ≥ 27 APPROVE
> **强依赖**（已就位）：
> - ✅ **COSTRA-164 R1.x APPROVE 38/40**（commit `2e71dc8` + `8c8cdce` · server response 含 default_family_id/ledger_id · refresh 路径同样返）
> - ✅ COSTRA-103（services/db.ts · entry CRUD 已实装）
> - ✅ COSTRA-150（syncScheduler.ts · 接入点 L30/L43-50/L73）
> - ✅ COSTRA-125（storage async envelope 范式 · L48-78）
> - ✅ COSTRA-105（FALLBACK_LEDGER_ID 占位 · 本卡 supersede）
> **下游解锁**：
> - FU-150-FAMILY-CONTEXT-SERVICE 完整闭合（与 164 联合 closed @ R1 联合 approve）
> - FU-EPIC-FAMILY-LEDGER-CRUD 部分兑现（active_ledger_id 真实流转 · entry/home 接入）
> - Phase-3 真机实测 §1.4 §3.1 §3.2 段废弃 · 派 qa-planner 出新版手册
> - COSTRA-154+150 联合 approve 实质前置（family_id 真链路打通）

---

## §0 SBAI 装扮路径

| 阶段 | Subagent | 状态 |
|---|---|---|
| **Card-Review R1** | `costra-card-reviewer-tech`（D-022 v2.0 + D-025 §2 反模式扫描）| 等 164 R1 APPROVE 才启 |
| **R1 实装** | `costra-miniapp-dev`（一次性装扮 · 单装扮档单 commit）| 等卡审 PASS |
| **R1 Review** | `costra-review-tech`（D-022 v2.0 第 N 次实战 · runtime 维度重点）| 等 R1 完成 |
| **Human T1 终审** | `approve:COSTRA-165`（D-024 §2.2 C1 与 164 攒批联合 approve）| 等 R1 APPROVE |

---

## §1 背景

### 1.1 触发链

- **直接触发**：FU-150-FAMILY-CONTEXT-SERVICE（COSTRA-150 R1 卡审 P0-1 · syncScheduler.ts:43-50 显式注释 "miniprogram 全局当前无 active_family_id 概念"）
- **决策锚定**：ADR-0007 §6.2 实装锚点（family-context service 范围 · 不做 family 切换 UI · 不做邀请入口）
- **联动**：COSTRA-164 server bootstrap 提供 default_family_id / default_ledger_id（client 接收即可）
- **现状漏点**：
  - `pages/entry/index.ts:14` `FALLBACK_LEDGER_ID = '00000000-0000-0000-0000-000000000001'` 是 BUG-001 应急占位 · 本卡 supersede
  - `app.ts:22` `globalData.activeLedgerId` 字段已声明但**从未被任何代码写入** · 本卡补全
  - `syncScheduler.ts:48` 读 `__costra_family_id_v1` 旧 key（手册让 Human 手动 setStorage 注入）· 本卡迁移到正式 service

### 1.2 PRD / 契约锚点

- **ADR-0007** §3.1 决策：每用户登录后 server bootstrap 个人 family · client 透明接收
- **ADR-0007** §5.2 默认 family 解析规则（优先 storage 上次选择 · miss 用 login resp default_family_id 兜底 · 失效 fallback 个人 family）
- **ADR-0007** §6.2 R1 范围：不做 family 切换 UI / 不做 mine 邀请入口（R2 范围）
- **协议事实源**：COSTRA-164 修订后的 AuthTokenPair（含 default_family_id + default_ledger_id required）
- **storage envelope 范式**：`miniprogram/services/storage.ts` L48-56（COSTRA-125 async 迁移）
- **现有 syncScheduler 接入点**：`miniprogram/services/syncScheduler.ts:30,47-50`（FAMILY_ID_KEY + getActiveFamilyId helper）

### 1.3 上下文：miniapp 当前 family-related 现状摘要

> **v1.1 修订**：行号已与 commit `8c8cdce` 后的源码物理对齐（Card-Review R1 P1-3）

| 文件 | 状态 |
|---|---|
| `miniprogram/services/family.ts` | **不存在** · 本卡新建 |
| `miniprogram/services/auth.ts` L18-29（TokenRaw）| **缺 expires_in + user 子字段** · 本卡补齐与 server `AuthTokenPair` 对齐（COSTRA-118 P0-2 红线 · 见 §2.1 B）|
| `miniprogram/services/auth.ts` L72-82（initAuth）| 仅 restore stored token · **不写 family/ledger storage** · 本卡补 fallback：family-context 缺失 → refresh 触发刷新（v1.1 修订 · 见 P1-1）|
| `miniprogram/services/auth.ts` L158-184（doWxLogin）| 登录成功后只存 token · **不写 family/ledger storage** · 本卡补 |
| `miniprogram/services/auth.ts` L195-214（refreshToken）| 续签后只存 token · **不写 family/ledger storage** · 本卡补 fallback 路径（v1.1 修订）|
| `miniprogram/services/syncScheduler.ts` L30 | `FAMILY_ID_KEY = '__costra_family_id_v1'` · L47-50 helper 直接 getItem · L73 调用点 · 本卡迁移到 family.ts 接口 |
| `miniprogram/app.ts` L22 | `globalData.activeLedgerId?: string` 已声明但未赋值 · 本卡 onLaunch / 登录 / 续签时填充 |
| `miniprogram/pages/entry/index.ts` L14 / L61 / L77 | FALLBACK_LEDGER_ID + `activeLedgerId \|\| FALLBACK` · 本卡确保 activeLedgerId 永远有值（保留 FALLBACK 作为防御 · v1.1 修订采用方案 1 · 见 §2.1 D）|

---

## §2 Scope（5 项 · 估点 2 · INVEST small）

### 2.1 主交付（5 项 · 必交）

#### A · 新建 `miniprogram/services/family.ts` family-context service

```typescript
// services/family.ts · 卡号: COSTRA-165
// Refs: ADR-0007 §3.1/§5.2/§6.2 · sync-protocol.md §3 §7（family_id 鉴权语义）
// 复用：services/storage.ts envelope 范式（COSTRA-125 async）

import { getItem, setItem, removeItem } from './storage';

export interface FamilyContext {
  family_id: string;
  ledger_id: string;
}

const FAMILY_CONTEXT_KEY = '__costra_family_context_v1';
// 旧 key 一次性清理（防陈旧值干扰 · 实测手册曾让 Human 手动 setStorage 此 key）
const LEGACY_FAMILY_ID_KEY = '__costra_family_id_v1';

/**
 * 设置 active family + ledger（登录成功 / family 切换均调）
 * 对应 ADR-0007 §5.2 storage 主源
 */
export async function setActiveFamily(ctx: FamilyContext): Promise<void> {
  await setItem<FamilyContext>(FAMILY_CONTEXT_KEY, ctx);
  // 一次性迁移：清旧 key（如存在）防止 syncScheduler 走旧分支
  await removeItem(LEGACY_FAMILY_ID_KEY);
}

/**
 * 取 active family_id · 解析顺序：
 *   1. storage FAMILY_CONTEXT_KEY（用户上次选择）
 *   2. null（caller 兜底用 login resp default_family_id）
 * 注意：本函数不做 fallback 创建逻辑（R1 简化 · R2 加 family 列表后增强）
 */
export async function getActiveFamilyId(): Promise<string | null> {
  const ctx = await getItem<FamilyContext>(FAMILY_CONTEXT_KEY);
  return ctx?.family_id ?? null;
}

/**
 * 取 active ledger_id（与 family_id 同生命周期 · 同来源）
 */
export async function getActiveLedgerId(): Promise<string | null> {
  const ctx = await getItem<FamilyContext>(FAMILY_CONTEXT_KEY);
  return ctx?.ledger_id ?? null;
}

/**
 * 清除 active context（logout 时调）
 */
export async function clearActiveFamily(): Promise<void> {
  await removeItem(FAMILY_CONTEXT_KEY);
  await removeItem(LEGACY_FAMILY_ID_KEY);
}
```

**关键决策**：
- 单 storage key 同时存 family_id + ledger_id（避免双 key 不同步）
- 不在 service 层做 default_family_id 兜底（caller 自管 · 见 §2.1 B 登录流程）· 简化测试
- LEGACY_FAMILY_ID_KEY 一次性清理（兼容已实测手册曾注入旧 key 的真机）

#### B · `miniprogram/services/auth.ts` 登录成功流程接入

> **v1.1 修订**（Card-Review R1 P1-1 + P1-3）：
> 1. P1-3：TokenRaw 字段与 server AuthTokenPair 1:1 对齐（COSTRA-118 P0-2 红线）· `expires_in` 改 required · user 子对象补 timezone/created_at/updated_at
> 2. P1-1：initAuth + refreshToken 路径补 family-context fallback（旧 token 升级场景走 refresh 触发刷新而非 toast 重登）

修改点：

1. **TokenRaw 接口扩展**（auth.ts L18-29 · 与 server `authService.ts:39-59` AuthTokenPair 1:1 对齐）：

```typescript
export interface TokenRaw {
  access_token: string;
  refresh_token: string;
  access_token_ttl_sec: number;
  refresh_token_ttl_sec: number;
  // P1-3 新增（与 server required 对齐 · OpenAPI deprecated 兼容字段）：
  expires_in: number;
  user: {
    id: string;
    nickname: string;
    avatar_url: string | null;
    has_completed_profile: boolean;  // COSTRA-158
    // P1-3 新增（v1.1 · 与 server toUserView() 返回 1:1 对齐 · COSTRA-118 P0-2 红线）：
    timezone: string;
    created_at: string;  // ISO-8601 UTC
    updated_at: string;  // ISO-8601 UTC
  };

  // 新增（COSTRA-164 协议 · 已稳定 · authService.ts L207-208 + L275-276）：
  default_family_id: string;
  default_ledger_id: string;
}
```

**注**：`expires_in` 当前 `buildStored()`（L63-69）不消费（用 ttl_sec 计算），但接口对齐铁律要求声明。timezone/created_at/updated_at 同理（miniapp 当前不消费 · 仅契约对齐）。

2. **doWxLogin 成功后**（auth.ts L158-184 · `await setItem(TOKEN_KEY, stored)` 之后 · L182 之后）：

```typescript
import { setActiveFamily } from './family';

// ... POST /auth/wx-login 成功 ...
await setItem(TOKEN_KEY, stored);

// COSTRA-165: 写 family-context（首登 default_family_id 一定非空 · 后续切 family 时由 R2 UI 覆盖）
await setActiveFamily({
  family_id: resp.default_family_id,
  ledger_id: resp.default_ledger_id,
});

// 同步 globalData.activeLedgerId（pages/entry 直接读 · app.ts L22 字段已声明）
const app = getApp();
if (app?.globalData) {
  app.globalData.activeLedgerId = resp.default_ledger_id;
}

console.info('[auth] login success', { userId: resp.user.id, familyId: resp.default_family_id });
```

3. **logout 流程**（auth.ts L127-152 已存在）：在 `await clearToken()` 之前调 `await clearActiveFamily()` 清理 storage 与 globalData

```typescript
// L146 附近 ·  await clearToken() 之前
await clearActiveFamily();
const app = getApp();
if (app?.globalData) {
  app.globalData.activeLedgerId = undefined;
}
await clearToken();
```

4. **initAuth 流程**（auth.ts L72-82 · restored session 路径）：

> **P1-1 修订（v1.1）**：旧 token 升级场景策略从"toast 重登"改为"refresh 触发刷新"。理由：
> - 已登录用户升级后 storage 中无 family-context 是 P1 概率事件（100% 升级用户必触发）
> - server refresh 路径（authService.ts L256-277）已实装返回 default_family_id/default_ledger_id
> - 走 refresh 路径对用户透明 · 无 UX 退化 · 避免强制重登
> - 修订后 D-025 AP-002 不再命中（见 §3）

```typescript
// COSTRA-165 v1.1: initAuth restored session 路径补 family-context fallback
import { setActiveFamily, getActiveFamilyId, getActiveLedgerId, clearActiveFamily } from './family';

export async function initAuth(): Promise<void> {
  const saved = await getItem<TokenStored>(TOKEN_KEY);
  if (saved && saved.access_expires_at > Date.now()) {
    current = wrap(saved);

    // v1.1 P1-1: 旧 token 升级场景 · storage 中无 family-context → 走 refresh 触发刷新（透明无 UX 退化）
    const familyId = await getActiveFamilyId();
    if (!familyId) {
      try {
        await refreshToken();  // refresh response 含 default_family_id/default_ledger_id（authService.ts:275-276）
        // refreshToken 内部已调 setActiveFamily（见下文 5）
      } catch (e) {
        // refresh 失败兜底：清 token + 跳登录页（极边缘 · refresh_token 也过期）
        console.warn('[auth] initAuth fallback refresh failed', e);
        await clearToken();
        await clearActiveFamily();
        return;
      }
    } else {
      // 正常路径：family-context 已存在 · 同步 globalData
      const ledgerId = await getActiveLedgerId();
      const app = getApp();
      if (app?.globalData && ledgerId) {
        app.globalData.activeLedgerId = ledgerId;
      }
    }
    return;
  }
  current = null;
}
```

5. **refreshToken 流程**（auth.ts L195-214 · v1.1 修订）：

> **P1-1 修订（v1.1）**：refresh response 含 default_family_id/default_ledger_id（已 server 实装）· 写入 family-context 是必须路径（initAuth fallback 依赖此行为）· 而非"禁项"。

```typescript
export async function refreshToken(): Promise<void> {
  if (!current) throw new Error('NO_TOKEN');
  const env = getEnv();
  if (env.mockLogin) {
    // ... mock 路径（保持 v1.0 不变）...
  }
  const resp = await request<TokenRaw>({
    method: 'POST',
    path: '/auth/refresh',
    body: { refresh_token: current.raw.refresh_token },
    auth: false
  });
  const stored = buildStored(resp);
  current = wrap(stored);
  await setItem(TOKEN_KEY, stored);

  // v1.1 P1-1: refresh response 含 default_family_id/default_ledger_id · 写入 family-context
  // 极边缘场景：server 返空字符串（FU-164-REFRESH-DEFAULT-IDS-NULL · personal family 缺失）→ 跳过写入 · 保持现有 family-context
  if (resp.default_family_id && resp.default_ledger_id) {
    await setActiveFamily({
      family_id: resp.default_family_id,
      ledger_id: resp.default_ledger_id,
    });
    const app = getApp();
    if (app?.globalData) {
      app.globalData.activeLedgerId = resp.default_ledger_id;
    }
  }
}
```

**关键规则**：
- ✅ refresh 路径写 family-context（initAuth 升级场景必须）
- ✅ 空字符串保护（FU-164-REFRESH-DEFAULT-IDS-NULL 极边缘自我兜底 · 保持现有 family-context 不被空值覆盖）
- ❌ 不在 doWxLogin 之外调用 setActiveFamily 直接覆盖用户主动选择的 family（R2 切 family 时由 UI 调）

#### C · `miniprogram/services/syncScheduler.ts` 接入点替换

修改点（L30 + L43-50）：

```typescript
// 旧：
const FAMILY_ID_KEY = '__costra_family_id_v1';

async function getActiveFamilyId(): Promise<string | null> {
  const familyId = await getItem<string>(FAMILY_ID_KEY);
  return familyId || null;
}

// 新：
import { getActiveFamilyId as familyContextGetActiveFamilyId } from './family';

// 删除 module-level FAMILY_ID_KEY 常量（迁移到 family.ts 内部）
// 删除 module-private getActiveFamilyId helper

// L73 调用点改：
const familyId = await familyContextGetActiveFamilyId();
```

**简化目标**：syncScheduler 不再持有 FAMILY_ID_KEY 字符串字面量 · 完全委托 family.ts service。

#### D · `miniprogram/pages/entry/index.ts` FALLBACK_LEDGER_ID 处置

> **v1.1 修订**（Card-Review R1 P2-2）：方案 1（保留 FALLBACK 作为最后防御）取代 v1.0 推荐的方案 2（删除 FALLBACK + toast）· 决策权由 miniapp-dev（本卡 owner）实装期拍板

**v1.1 选定方案**：保留 FALLBACK_LEDGER_ID 作为防御层（避免 BUG-001 类回归 · 用户记账自救路径不被切断）· 但增加诊断日志：

```typescript
// pages/entry/index.ts L14（保留 · 加注释）
const FALLBACK_LEDGER_ID = '00000000-0000-0000-0000-000000000001';
// COSTRA-165 v1.1：保留为最后防御层 · 正常路径下 globalData.activeLedgerId 由 auth.ts 填充
// 仅在 initAuth/refresh 双重失败的极边缘场景兜底（BUG-001 应急遗产 · FU-165-LEDGER-FALLBACK-CLEANUP 等 R2 切 family UI 后彻底删除）

// L61 附近调用点（保留 · 加日志）
const ledgerId = getApp().globalData.activeLedgerId;
if (!ledgerId) {
  // 极边缘：诊断日志 · 用户仍可记账（走 FALLBACK · 服务端会拒绝非法 ledger_id 但本地不阻断 UI）
  console.warn('[entry] activeLedgerId missing in globalData · using FALLBACK · auth chain may be broken');
}
const finalLedgerId = ledgerId || FALLBACK_LEDGER_ID;
```

**理由**：
1. 方案 2（删 FALLBACK · toast 阻断 · v1.0 推荐）会导致用户在 auth 链路异常时完全无法记账 → BUG-001 类回归
2. 方案 1（保留 FALLBACK · v1.1 推荐）保留自救路径 + 诊断日志 · 服务端会因非法 ledger_id 返 400 但本地 UI 不卡死
3. R1 范围内不试图根除 FALLBACK · 等 R2 切 family UI 落地后通过 FU-165-LEDGER-FALLBACK-CLEANUP 一并清除

**实装决策权**：miniapp-dev（本卡 owner · v1.0 误写 backend-dev 已修正）

#### E · 单测 ≥ 7 测（v1.1 加 T7 双源一致性）

新建 `miniprogram/services/family.spec.ts`：

| 编号 | 测试点 | 期望 |
|---|---|---|
| T1 | setActiveFamily + getActiveFamilyId | 写入后能读出（envelope 一致）|
| T2 | setActiveFamily + getActiveLedgerId | 同 family_id 一致 ledger_id |
| T3 | setActiveFamily 时一次性清理旧 key | 旧 `__costra_family_id_v1` 被 removeItem |
| T4 | getActiveFamilyId 无 storage 返 null | null（caller 自兜底）|
| T5 | clearActiveFamily 后再读 | family/ledger 都返 null |
| T6 | storage envelope 一致性（与 storage.ts L48-56 范式对齐）| envelope `{v:1, t:..., d:{family_id, ledger_id}}` 结构 |

**v1.1 新增（Card-Review R1 P2-1）**：

补 `miniprogram/services/auth.spec.ts`（已存在 · 加 case · 参考现有测试范式）：

| 编号 | 测试点 | 期望 |
|---|---|---|
| **T7（v1.1 P2-1）** | 双源一致性：doWxLogin 后 storage family-context + globalData.activeLedgerId 必同步写入 | 二者均等于 resp.default_ledger_id |
| **T8（v1.1 P1-1）** | initAuth 旧 token 升级场景：saved token 有效 + storage 无 family-context → 触发 refreshToken → 写入 family-context | mock refresh response 含 default_family_id/ledger_id · 调用后 storage 与 globalData 均同步 |
| **T9（v1.1 P1-1）** | initAuth 升级 + refresh 失败兜底：mock refresh 抛错 → clearToken + clearActiveFamily | current === null + storage family-context 被清 |
| **T10（v1.1 P1-1）** | refreshToken 极边缘：response 含空字符串 default_family_id → 跳过写入（保护 FU-164-REFRESH-DEFAULT-IDS-NULL）| storage 中已存在的 family-context 不被空值覆盖 |
| **T11（v1.1 P1-3）** | TokenRaw 接口契约对齐：mock buildStored 输入含 expires_in/timezone/created_at/updated_at → typecheck pass | TS 类型断言通过 |

补 `miniprogram/services/syncScheduler.spec.ts`（已有 T2 测试场景调整）：
- T2 mock family.ts service 而非 storage.getItem · 验证 syncScheduler 调用 family.getActiveFamilyId 接口

**测试覆盖矩阵**（v1.1 共 ≥ 11 测）：T1~T6（family.ts core）+ T7~T11（auth.ts 集成 · 双源 + 旧 token 升级 + refresh 边界 + 协议契约）

---

### 2.2 不在本卡范围

- ❌ family 切换器 UI（home 顶部 / mine 页）→ Sprint-4 R2 范围
- ❌ "邀请家人加入"入口 → COSTRA-201 Sprint-4
- ❌ 家庭面板 tab → Sprint-4
- ❌ 多 family 列表展示 → Sprint-4
- ❌ active_family_id 服务端持久化 → ADR-0007 §4.1 锚定由 client storage 承担
- ❌ wxLogin response 协议本身 → COSTRA-164 范围（本卡仅消费）
- ❌ /sync/pull SQL 调整 → ADR-0007 §5.5 铁律

---

## §3 DoD（22 项 · v1.1 +5：T7~T11 + 反向验证 ④）

### G1~G6 + G15 标准闸门（7 项）

- **G1** TypeScript typecheck 全绿（`cd miniprogram && tsc --noEmit` · 通过项目根 typecheck）
- **G2** ESLint 全绿（`npm run lint` · miniprogram 范围）
- **G3** miniprogram unit test 全绿（`npm test` · vitest · 含本卡新增 T1~T11）
- **G4** 项目根 typecheck 全绿（不引入跨包破坏）
- **G5** whitelist-check 全绿（含路径白名单）
- **G6** miniprogram 编译通过（开发者工具或 vitest 模拟环境）
- **G15** D-016 反例预防（commit 前 `git status -s | grep '.team/members/' | wc -l` = 0）

### T1~T11 单测（11 项 · v1.1 共增 5 测 · 见 §2.1 E）

### 反向验证（4 项 · v1.1 P1-1 升级 ③ + 新增 ④）

- ① 临时让 setActiveFamily 不调 setItem → T1 应 FAIL（getActiveFamilyId 返 null）→ revert
- ② 临时让 syncScheduler 走旧 FAMILY_ID_KEY 字面量 → T3 LEGACY 清理后该测应 FAIL（read 不到旧 key）→ revert
- ③ **（v1.1 升级 · 判定标准明确化）** 临时移除 doWxLogin 中 setActiveFamily 调用 → T7 双源一致性测试应 FAIL（storage 中无 family-context · `await getActiveFamilyId()` 返 null）→ revert · 不再走"如有 e2e"模糊降级
- ④ **（v1.1 新增 P1-1）** 临时移除 initAuth 中 family-context fallback 路径（保留 saved token 但不调 refreshToken）→ T8 旧 token 升级测试应 FAIL（升级后 storage 无 family-context · 但代码不触发 refresh）→ revert

### D-022 §4.1 runtime 类 T2 卡 Human 实测前置铁律

**本卡命中 D-022 §4.1**（storage 跨页面持久化 + 登录链路 + sync 调度联动）：

- ✅ 单测 + Card-Review + R1 Review 不可单独 approve
- ✅ Human 联合 staging / staging-prod 实测前置不可省（D-024 §2.2 C1 与 164 联合 approve）
- ✅ 实测必覆盖：① 全新登录场景 · ② 旧 token 升级场景（升级前已登录 + 升级后重启 → 应自动走 refresh 不弹 toast）· ③ logout 清理路径 · ④ entry 页 ledger_id 实际写入

### D-025 反模式扫描（v1.1 修订 · P1-2）

- **AP-001 不命中**：family.ts FamilyContext 接口是显式类型定义 · storage key 常量不作为状态判定依据 · 无业务字段字符串硬比较推断语义
- **AP-002 修正后不命中**（v1.1 P1-1 修订生效后）：
  - **v1.0 命中诊断**：dispatch v1.0 §7 风险条目把"已登录用户升级后 storage 无 family-context"的处理写成"toast 提示重新登录"——是 P1 概率事件（100% 升级用户必触发）的不当接受
  - **v1.1 修正路径**：改为"refresh 触发刷新 → 写入 family-context"（authService.ts L256-277 实测已返这两字段 · 路径对用户透明无 UX 退化）
  - 修正后 AP-002 不再命中（不是不当接受 · 是走了正确路径）
- **AP-003 不命中**：本卡不引入新 deferred · TokenRaw 加字段是对齐 server 已有字段（不是漂移）· 不动 openapi.yaml（164 范围）

---

## §4 强制阅读清单

1. 本派单档全文
2. **ADR-0007** family-ledger 关系模型 · §3.1/§5.2/§6.2 锚定
3. **COSTRA-164 dispatch**（v2.1 已 R1.x APPROVE）：理解 server response 协议形态（含 refresh 路径返 default_family_id）
4. **COSTRA-164 R1.x review-tech 报告**：`.team/reviews/COSTRA-164/round-1.x-tech.md`（理解 P2-2 refresh 空字符串风险 → §2.1 B refreshToken 极边缘保护）
5. **现有 auth.ts 流程**（v1.1 行号已对齐 commit `8c8cdce` 后源码）：`miniprogram/services/auth.ts:18-29`（TokenRaw）/ `:72-82`（initAuth）/ `:127-152`（logout）/ `:158-184`（doWxLogin）/ `:195-214`（refreshToken）
6. **server authService.ts 协议事实源**：`server/src/services/authService.ts:39-99`（AuthTokenPair + toUserView）/ `:201-210`（wxLogin response）/ `:256-277`（refresh response）
7. **现有 syncScheduler 接入点**：`miniprogram/services/syncScheduler.ts:30, 47-50, 73`
8. **storage envelope 范式**：`miniprogram/services/storage.ts:48-78`
9. **entry 页 FALLBACK 占位**：`miniprogram/pages/entry/index.ts:12-14, 61, 77`
10. **app globalData**：`miniprogram/app.ts:22`
11. **D-022 v2.0 review-tech runtime 维度**
12. **D-025 反模式清单**

---

## §5 硬约束

### §5.1 工作区铁律

- ✅ 可写：
  - `miniprogram/services/family.ts`（**新建**）
  - `miniprogram/services/family.spec.ts`（**新建**）
  - `miniprogram/services/auth.ts`（TokenRaw 加字段 + initAuth/login/refresh/logout 接入 · v1.1 +refresh 路径）
  - `miniprogram/services/auth.spec.ts`（v1.1 加 T7~T11 case · 已存在文件）
  - `miniprogram/services/syncScheduler.ts`（L30 / L47-50 / L73 替换）
  - `miniprogram/services/syncScheduler.spec.ts`（T2 mock 重构）
  - `miniprogram/pages/entry/index.ts`（FALLBACK_LEDGER_ID 处置 · v1.1 选方案 1 保留+诊断日志）
  - `miniprogram/app.ts`（如需 onLaunch 内 initAuth 后填 globalData.activeLedgerId · 视实装）
  - `.team/members/miniapp-dev/state.md` + history
  - `.team/follow-ups/README.md`（FU-150-FAMILY-CONTEXT-SERVICE 状态 → closed @ COSTRA-164+165 联合 approve）
- ❌ 不可写：
  - `server/`（COSTRA-164 范围）
  - `miniprogram/services/sync.ts`（154 已稳定 · 协议保持）
  - `miniprogram/services/db.ts`（103 已稳定 · entry 持久化逻辑不动）
  - `miniprogram/pages/family-dashboard/`（R2 范围 · 本卡不动）
  - `miniprogram/pages/mine/`（不加邀请入口 · R2）
  - `infra/`
  - `qa/phase-3-prod-realdevice-test.md`（实测手册由 qa-planner 出新版 · 不在本卡）
  - 其他 `.team/members/{other-role}/`

### §5.2 INVEST small（2 点）

- 时间盒 R1 实装 ≤ 120 分钟（v1.1 +20min · 含 family.ts 新建 + auth.ts 接入（含 initAuth/refresh fallback）+ syncScheduler 替换 + entry 页处置 + 11 测）
- 5 项 scope 单点修改密度可控 · 现有 storage envelope 范式 + auth.ts 流程清晰

### §5.3 已知未知 / follow-up 候选

- **FU-165-FAMILY-SWITCHER-UI** · P2 · Sprint-4 R2 落地 · home 顶部 family 切换器 · 与 COSTRA-201 邀请流程联动
- **FU-165-LEDGER-FALLBACK-CLEANUP**（v1.1 选方案 1 保留 FALLBACK）· P3 · 等 family 切换 UI 后彻底删除 FALLBACK_LEDGER_ID 常量
- ~~FU-165-LEGACY-TOKEN-UPGRADE-PATH~~（v1.1 P1-1 已在 §2.1 B initAuth fallback 落地实装 · 不需独立 FU 占位）

### §5.4 D-016 同轮兑现 · D-018 单装扮档单 commit

- commit footer：`Co-Authored-By: miniapp-dev <subagent>` · `closes: FU-150-FAMILY-CONTEXT-SERVICE (with COSTRA-164)`
- commit subject 全小写（commitlint）· `Refs: COSTRA-165` 大写在 footer
- commit 前 final message 含 `git status -s | grep '.team/members/' | wc -l` = 0
- **commit 粒度合理性**（v1.1 P2-3）：8 文件单 commit（family.ts/spec + auth.ts/spec + syncScheduler.ts/spec + entry/index.ts + app.ts）· 5 项 scope 各 1~2 文件 · 单点修改密度可控 · 与 COSTRA-164 R1 6 文件 + R1.x 4 文件范式对齐 · 不触发"提交粒度过大"

---

## §6 估点 / 时间盒

- **估点**：2 点
- **AI 时间盒**：~~1.5~2 小时~~（v1.1 含 Card-Review R1+R2 + R1 实装 + R1 Review）· R1 实装 ≤ 120 min
- **Human 实测**：与 164 联合 staging 实测（D-024 §2.2 C1 第 N 次实战）· 复用 staging 环境

---

## §7 已知风险（v1.1 修订）

- **登录链路时序**：auth.ts L72-82 initAuth 是 onLaunch 同步链路 · L158-184 doWxLogin 是用户点击触发 · L195-214 refreshToken 是 access 即将过期或 initAuth fallback 触发 · 三个时机都要写 globalData · R1 实装期需绘制完整时序图防漏点
- **storage 与 globalData 双源**：family.ts 是 storage（持久化）· globalData.activeLedgerId 是 runtime cache（页面切换不丢）· 写时双写 · 读时读 globalData 优先 · 如不一致按 storage 为准（initAuth 时同步）· **T7 测试覆盖**（v1.1 P2-1）
- **TokenRaw 协议加字段非破坏性兼容**（v1.1 P1-1 修订 · 缓解策略改为 refresh 触发刷新）：
  - **场景**：旧 stored token 没 default_family_id（升级前 cache 命中）→ 重启后 initAuth 走 restored session · 此时 storage 中 family-context 也不存在
  - **概率事件性质**：P1（100% 已登录用户升级时必触发）· 不是 P3 极低概率
  - **v1.1 修正缓解策略**：initAuth 内 `if (!await getActiveFamilyId() && isLoggedIn())` → 走 `refreshToken()` → 从 refresh response 取 default_family_id/default_ledger_id → setActiveFamily（透明 · 无 UX 退化）
  - **依据**：server authService.ts L256-277 实测 refresh response 含 default_family_id/default_ledger_id（COSTRA-164 R1 实装 + R1.x APPROVE）
  - **极边缘失败兜底**：refresh 抛错（refresh_token 也过期）→ clearToken + clearActiveFamily → 等用户主动点登录（不弹 toast 强制）
  - **v1.0 ❌ 已废弃策略**：~~"提示重新登录 toast"~~（P1-1/P1-2 双 P1 论证 · D-025 AP-002 不当接受 · 强制 100% 升级用户重登 = UX 严重退化）
- **wx 模拟器 vs 真机行为差异**：storage envelope async / globalData 共享 · D-022 §4.1 runtime 类铁律 · Human 必须真机实测覆盖
- **联合实测协议依赖**：本卡测试 e2e 必须 164 已部署到 staging · 否则 mock 协议返字段 · 真链路 P0 验证延后到联合实测
- **FU-164-REFRESH-DEFAULT-IDS-NULL 联动**（v1.1 P1-1 关联）：
  - **现状**：server refresh 极边缘场景下（personal family 缺失数据异常）返空字符串 default_family_id/default_ledger_id（COSTRA-164 R1.x P2-2）
  - **client 兜底**：refreshToken 内部空字符串保护（§2.1 B 5）· `if (resp.default_family_id && resp.default_ledger_id)` 才写入 family-context · 否则保持现有不被覆盖
  - **测试覆盖**：T10（v1.1 P1-1）

---

## §8 联动事项

- **更新 `.team/follow-ups/README.md`**：
  - FU-150-FAMILY-CONTEXT-SERVICE → 本卡 + 164 联合 approve 后改为 `closed @ COSTRA-164 + COSTRA-165 (joint approve)`
  - 新增 FU-165-FAMILY-SWITCHER-UI（如 §5.3 列）· P2 · Sprint-4 R2
- **派 qa-planner 出新版 Phase-3 实测手册**：本卡 + 164 联合 approve 后触发（D-025 §议题 25 反模式：Orchestrator 不直写 Human 操作类文档 · 必须 spawn qa-planner）

---

**派单档结束 · v1.1 修订完成 · 等 Card-Review R2 形式审 → R1 实装。**

---

## §10 修订历史

| 版本 | 时间 | 变更 |
|---|---|---|
| v1.0 | 2026-05-27 | 首版立档（基于 ADR-0007 v1.0 §6.2 实装锚点 · Sprint-3 头部第 4 张派单 · 与 COSTRA-164 联立攒批） |
| **v1.1** | **2026-05-27 16:00** | **Card-Review R1 修订（25/30 PASS-WITH-FOLLOWUP → 期望 ≥27 APPROVE · 落 3 P1 + 3 P2 全 6 项）**：① P1-1 initAuth 旧 token 升级策略改 refresh 触发刷新（废"toast 重登"）· §2.1 B 加 refreshToken 路径写 family-context（含空字符串保护 FU-164-REFRESH-DEFAULT-IDS-NULL）· §7 风险条目重写 · ② P1-2 D-025 AP-002 扫描结论从"不命中"修正为"v1.0 命中 · v1.1 修正后不命中" · ③ P1-3 TokenRaw 接口 expires_in 从可选改 required + user 子对象补 timezone/created_at/updated_at（COSTRA-118 P0-2 红线对齐）· §1.3 行号对齐 commit `8c8cdce` 后源码 · ④ P2-1 加 T7~T11 共 5 测（双源 + 旧 token 升级 + refresh 边界 + 协议契约）+ 反向验证 ④ · ⑤ P2-2 §2.1 D 选方案 1 保留 FALLBACK + 诊断日志 · 决策权改 miniapp-dev · ⑥ P2-3 §5.4 加 commit 粒度合理性说明（8 文件单 commit）· DoD 17→22 项 · 时间盒 100→120 min |
