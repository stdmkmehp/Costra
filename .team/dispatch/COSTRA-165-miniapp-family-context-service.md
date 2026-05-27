# COSTRA-165 · miniapp family-context service（active_family_id / active_ledger_id 全链路接入）

> **派单时间**：2026-05-27（Orchestrator · Sprint-3 头部第 4 张 · 与 164 联立攒批）
> **状态**：dispatch 草稿 · 等 Human 拍板 → 等 COSTRA-164 R1 APPROVE 才能启动 Card-Review（强依赖）
> **依赖**：
> - **COSTRA-164 R1 APPROVE**（强依赖 · server response 含 default_family_id/ledger_id）· 不可在 164 之前启动
> - COSTRA-103（services/db.ts · entry CRUD 已实装）
> - COSTRA-150（syncScheduler.ts · 接入点 L43-50）
> - COSTRA-125（storage async envelope 范式）
> - COSTRA-105（FALLBACK_LEDGER_ID 占位 · 本卡 supersede）
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

| 文件 | 状态 |
|---|---|
| `miniprogram/services/family.ts` | **不存在** · 本卡新建 |
| `miniprogram/services/auth.ts` L173-185 | 登录成功后只存 token · **不写 family/ledger storage** · 本卡补 |
| `miniprogram/services/syncScheduler.ts` L30 | `FAMILY_ID_KEY = '__costra_family_id_v1'` · L47-50 helper 直接 getItem · 本卡迁移到 family.ts 接口 |
| `miniprogram/app.ts` L22 | `globalData.activeLedgerId?: string` 已声明但未赋值 · 本卡 onLaunch 时填充 |
| `miniprogram/pages/entry/index.ts` L14 / L61 / L77 | FALLBACK_LEDGER_ID + `activeLedgerId \|\| FALLBACK` · 本卡确保 activeLedgerId 永远有值 → 移除 fallback 或保留作为防御 |

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

修改点：

1. **TokenRaw 接口扩展**（auth.ts L18-30）：

```typescript
export interface TokenRaw {
  access_token: string;
  refresh_token: string;
  access_token_ttl_sec: number;
  refresh_token_ttl_sec: number;
  expires_in?: number;
  user: { ... };

  // 新增（COSTRA-164 协议）：
  default_family_id: string;
  default_ledger_id: string;
}
```

2. **doWxLogin 成功后**（auth.ts L173-185 附近 · `await setItem(TOKEN_KEY, stored)` 之后）：

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

console.info('[auth] login success', { userId: ..., familyId: resp.default_family_id });
```

3. **logout 流程**（如存在）：调 `clearActiveFamily()` 清理 storage

4. **initAuth 流程**（auth.ts L75 附近 · restored session 路径）：

```typescript
// COSTRA-165: restored session · 同步 globalData（storage 已存在 family-context）
import { getActiveLedgerId } from './family';

// ... initAuth 内 saved token 还原后 ...
const ledgerId = await getActiveLedgerId();
const app = getApp();
if (app?.globalData && ledgerId) {
  app.globalData.activeLedgerId = ledgerId;
}
```

**禁项**：
- ❌ 不在 refresh / 续签流程内重写 family-context（refresh response 不含 family/ledger · 协议层 COSTRA-164 决议 refresh 不返这两字段）
- ❌ 不在 family.ts 内做 wx.request 调用（service 层只读 storage · 网络由 caller 负责）

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

修改点：

1. **保留 FALLBACK_LEDGER_ID 作为防御**（避免 globalData 异常时崩溃）· 但加注释明确"正常路径下 globalData.activeLedgerId 由 auth.ts 填充"
2. **alternative**：删除 FALLBACK · 改为 `if (!ledgerId) { wx.showToast({title: '请先登录', icon: 'none'}); return; }` —— **本卡推荐此方案**（强一致性 · 防 BUG-001 类隐性数据）

实装选项 §3.5 R1 实装期由 backend-dev 拍板 · 优先选 alternative（更严谨）。

#### E · 单测 ≥ 6 测

新建 `miniprogram/services/family.spec.ts`：

| 编号 | 测试点 | 期望 |
|---|---|---|
| T1 | setActiveFamily + getActiveFamilyId | 写入后能读出（envelope 一致）|
| T2 | setActiveFamily + getActiveLedgerId | 同 family_id 一致 ledger_id |
| T3 | setActiveFamily 时一次性清理旧 key | 旧 `__costra_family_id_v1` 被 removeItem |
| T4 | getActiveFamilyId 无 storage 返 null | null（caller 自兜底）|
| T5 | clearActiveFamily 后再读 | family/ledger 都返 null |
| T6 | storage envelope 一致性（与 storage.ts L48-56 范式对齐）| envelope `{v:1, t:..., d:{family_id, ledger_id}}` 结构 |

补 `miniprogram/services/syncScheduler.spec.ts`（已有 T2 测试场景调整）：
- T2 mock family.ts service 而非 storage.getItem · 验证 syncScheduler 调用 family.getActiveFamilyId 接口

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

## §3 DoD（17 项）

### G1~G6 + G15 标准闸门（7 项）

- **G1** TypeScript typecheck 全绿（`cd miniprogram && tsc --noEmit` · 通过项目根 typecheck）
- **G2** ESLint 全绿（`npm run lint` · miniprogram 范围）
- **G3** miniprogram unit test 全绿（`npm test` · vitest · 含本卡新增 T1~T6）
- **G4** 项目根 typecheck 全绿（不引入跨包破坏）
- **G5** whitelist-check 全绿（含路径白名单）
- **G6** miniprogram 编译通过（开发者工具或 vitest 模拟环境）
- **G15** D-016 反例预防（commit 前 `git status -s | grep '.team/members/' | wc -l` = 0）

### T1~T6 单测（6 项 · 见 §2.1 E）

### 反向验证（3 项）

- ① 临时让 setActiveFamily 不调 setItem → T1 应 FAIL（getActiveFamilyId 返 null）→ revert
- ② 临时让 syncScheduler 走旧 FAMILY_ID_KEY 字面量 → T3 LEGACY 清理后该测应 FAIL（read 不到旧 key）→ revert
- ③ 临时不在 doWxLogin 后调 setActiveFamily → 集成测试（如有 e2e）应 FAIL · 无 e2e 时改测 mock auth.ts 调用 family service 的次数 → revert

### D-022 §4.1 runtime 类 T2 卡 Human 实测前置铁律

**本卡命中 D-022 §4.1**（storage 跨页面持久化 + 登录链路 + sync 调度联动）：

- ✅ 单测 + Card-Review + R1 Review 不可单独 approve
- ✅ Human 联合 staging / staging-prod 实测前置不可省（D-024 §2.2 C1 与 164 联合 approve）

### D-025 反模式扫描（无命中 · 仅声明）

- AP-001 不命中（INVEST small 单装扮档单 commit）
- AP-002 不命中（family.ts 全新建 · 不复制其他文件代码）
- AP-003 不命中（不引入新 deferred · 也不动旧 deferred · 仅清理 LEGACY_FAMILY_ID_KEY 字面量）

---

## §4 强制阅读清单

1. 本派单档全文
2. **ADR-0007** family-ledger 关系模型 · §3.1/§5.2/§6.2 锚定
3. **COSTRA-164 dispatch**（同时立档）：理解 server response 协议形态
4. **现有 auth.ts 流程**：`miniprogram/services/auth.ts:18-30, 75, 169, 173-185, 268-269`
5. **现有 syncScheduler 接入点**：`miniprogram/services/syncScheduler.ts:30, 43-50`
6. **storage envelope 范式**：`miniprogram/services/storage.ts:48-78`
7. **entry 页 FALLBACK 占位**：`miniprogram/pages/entry/index.ts:12-14, 61, 77`
8. **app globalData**：`miniprogram/app.ts:22`
9. **D-022 v2.0 review-tech runtime 维度**
10. **D-025 反模式清单**

---

## §5 硬约束

### §5.1 工作区铁律

- ✅ 可写：
  - `miniprogram/services/family.ts`（**新建**）
  - `miniprogram/services/family.spec.ts`（**新建**）
  - `miniprogram/services/auth.ts`（TokenRaw 加字段 + login/initAuth 接入）
  - `miniprogram/services/syncScheduler.ts`（L30 / L43-50 替换）
  - `miniprogram/services/syncScheduler.spec.ts`（T2 mock 重构）
  - `miniprogram/pages/entry/index.ts`（FALLBACK_LEDGER_ID 处置）
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

- 时间盒 R1 实装 ≤ 100 分钟（含 family.ts 新建 + auth.ts 接入 + syncScheduler 替换 + entry 页处置 + 6 测）
- 5 项 scope 单点修改密度可控 · 现有 storage envelope 范式 + auth.ts 流程清晰

### §5.3 已知未知 / follow-up 候选

- **FU-165-FAMILY-SWITCHER-UI** · P2 · Sprint-4 R2 落地 · home 顶部 family 切换器 · 与 COSTRA-201 邀请流程联动
- **FU-165-LEDGER-FALLBACK-CLEANUP**（如选 §2.1 D 方案 1 保留 FALLBACK）· P3 · 等 family 切换 UI 后彻底删除 FALLBACK_LEDGER_ID 常量

### §5.4 D-016 同轮兑现 · D-018 单装扮档单 commit

- commit footer：`Co-Authored-By: miniapp-dev <subagent>` · `closes: FU-150-FAMILY-CONTEXT-SERVICE (with COSTRA-164)`
- commit subject 全小写（commitlint）· `Refs: COSTRA-165` 大写在 footer
- commit 前 final message 含 `git status -s | grep '.team/members/' | wc -l` = 0

---

## §6 估点 / 时间盒

- **估点**：2 点
- **AI 时间盒**：~~1.5~2 小时~~（含 Card-Review + R1 实装 + R1 Review）
- **Human 实测**：与 164 联合 staging 实测（D-024 §2.2 C1 第 N 次实战）· 复用 staging 环境

---

## §7 已知风险

- **登录链路时序**：auth.ts L75 initAuth 是 onLaunch 同步链路 · L173 doWxLogin 是用户点击触发 · 两个时机都要写 globalData · R1 实装期需绘制完整时序图防漏点
- **storage 与 globalData 双源**：family.ts 是 storage（持久化）· globalData.activeLedgerId 是 runtime cache（页面切换不丢）· 写时双写 · 读时读 globalData 优先 · 如不一致按 storage 为准（initAuth 时同步）
- **TokenRaw 协议加字段非破坏性兼容**：旧 stored token 没 default_family_id（升级前 cache 命中）→ 重启后 initAuth 走 restored session · 此时 storage 中 family-context 也可能不存在 · **必须**走 fallback：initAuth 时如 `getActiveFamilyId` 返 null · 触发一次显式 refresh / re-login（参 D-022 P1 类风险 · 本卡需明示）
  - **缓解策略**：initAuth 内 if (!await getActiveFamilyId()) → 提示重新登录（toast）· 简化版 · R1 实装期细化
- **wx 模拟器 vs 真机行为差异**：storage envelope async / globalData 共享 · D-022 §4.1 runtime 类铁律 · Human 必须真机实测覆盖
- **联合实测协议依赖**：本卡测试 e2e 必须 164 已部署到 staging · 否则 mock 协议返字段 · 真链路 P0 验证延后到联合实测

---

## §8 联动事项

- **更新 `.team/follow-ups/README.md`**：
  - FU-150-FAMILY-CONTEXT-SERVICE → 本卡 + 164 联合 approve 后改为 `closed @ COSTRA-164 + COSTRA-165 (joint approve)`
  - 新增 FU-165-FAMILY-SWITCHER-UI（如 §5.3 列）· P2 · Sprint-4 R2
- **派 qa-planner 出新版 Phase-3 实测手册**：本卡 + 164 联合 approve 后触发（D-025 §议题 25 反模式：Orchestrator 不直写 Human 操作类文档 · 必须 spawn qa-planner）

---

**派单档结束 · Orchestrator 等 Human 拍板 + COSTRA-164 R1 APPROVE 后 spawn Card-Review。**

---

## §10 修订历史

| 版本 | 时间 | 变更 |
|---|---|---|
| v1.0 | 2026-05-27 | 首版立档（基于 ADR-0007 v1.0 §6.2 实装锚点 · Sprint-3 头部第 4 张派单 · 与 COSTRA-164 联立攒批） |
