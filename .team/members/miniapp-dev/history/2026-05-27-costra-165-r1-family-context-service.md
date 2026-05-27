# COSTRA-165 R1 实装 · miniapp family-context service

> task_type: feature · 卡号: COSTRA-165 · 装扮: costra-miniapp-dev · D-018 SBAI v1.1

---

## 1 任务描述

COSTRA-165 R1 实装：为 miniapp 建立 family-context service，实现 active_family_id / active_ledger_id 全链路接入。dispatch v1.1 全 5 项 scope 落地（A~E），含 Card-Review R2 P2 实装期处理（mockLogin 分支同步补字段 + refreshToken mock 路径写 family-context）。

联动：COSTRA-164 server family bootstrap MVP（R1.x APPROVE 38/40 · server response 含 default_family_id/ledger_id 已稳定）。

## 2 产出

### A · 新建 `miniprogram/services/family.ts`（51 行）
- `FamilyContext` 接口（family_id + ledger_id）
- `setActiveFamily` / `getActiveFamilyId` / `getActiveLedgerId` / `clearActiveFamily`
- `FAMILY_CONTEXT_KEY = '__costra_family_context_v1'`
- `LEGACY_FAMILY_ID_KEY = '__costra_family_id_v1'`（一次性清理）
- 单 storage key 同时存 family_id + ledger_id

### B · `miniprogram/services/auth.ts` 5 处接入（381 行）
1. **TokenRaw 接口扩展**：`expires_in: number`（required）+ user 子对象补 `timezone / created_at / updated_at` + `default_family_id / default_ledger_id`（与 server AuthTokenPair 1:1 对齐）
2. **doWxLogin 成功后**：mock + 真实链路均调 `setActiveFamily` + 同步 `globalData.activeLedgerId`
3. **logout**：调 `clearActiveFamily` + 清 globalData（在 clearToken 之前）
4. **initAuth**：旧 token 升级场景（familyId=null）→ 走 refreshToken（透明无 UX 退化）+ refresh 失败兜底 clearToken + clearActiveFamily
5. **refreshToken**：mock + 真实路径均调 setActiveFamily + 真实路径空字符串保护 `if (resp.default_family_id && resp.default_ledger_id)`
6. **mockExchange 同步补字段**：expires_in + timezone/created_at/updated_at + default_family_id/default_ledger_id

### C · `miniprogram/services/syncScheduler.ts` 接入点替换（162 行）
- 删除 `FAMILY_ID_KEY` 常量 + module-private `getActiveFamilyId` helper
- import `getActiveFamilyId as familyContextGetActiveFamilyId` from `./family`
- L73 调用点改 `familyContextGetActiveFamilyId()`

### D · `miniprogram/pages/entry/index.ts` FALLBACK 处置（100 行）
- 保留 FALLBACK_LEDGER_ID + 加注释（COSTRA-165 v1.1 防御层）
- L61 加诊断 `console.warn`（activeLedgerId 缺失时）
- L77 同处理（复用 ledgerId 变量）

### E · 单测 11/11 全绿
- `family.spec.ts` T1~T6（6 测）
- `auth.spec.ts` T7~T11（5 测）+ 原有测试适配（mockRaw 补字段 + initAuth 测试补 family-context mock + getApp stub）
- `syncScheduler.spec.ts` T2 mock 重构（mock family.ts 而非 storage.getItem）

## 3 关键决策

1. **getApp() 测试策略**：使用共享 globalData 对象引用（`sharedGlobalData`），解决 `vi.fn(() => ({...}))` 每次返回新对象导致 auth.ts 写入和测试读取不是同一引用的问题
2. **initAuth fallback 路径**：走 refreshToken 而非 toast 重登（v1.1 P1-1 修订 · 100% 升级用户必触发 · refresh 对用户透明）
3. **空字符串保护**：`if (resp.default_family_id && resp.default_ledger_id)` — JS falsy 判空字符串 `""`，确保 FU-164 极边缘不覆盖现有 family-context
4. **mockLogin 分支同步**：R2 P2-2 实装期处理 — mockExchange 补 default_family_id/default_ledger_id + refreshToken mock 路径也调 setActiveFamily
5. **entry 方案 1**：保留 FALLBACK_LEDGER_ID + 诊断日志（不删 FALLBACK · 避免双重失败时用户完全无法记账）

## 4 遗留

- **P0/P1**：无
- **P2**：
  - FU-165-FAMILY-SWITCHER-UI（Sprint-4 R2 · home 顶部 family 切换器）
  - FU-165-LEDGER-FALLBACK-CLEANUP（等 family 切换 UI 后彻底删除 FALLBACK_LEDGER_ID）
- **D-022 §4.1 runtime 类**：本卡命中 · Human 联合 164 staging 实测必须覆盖 4 场景（全新登录 / 旧 token 升级 / logout 清理 / entry ledger_id 实际写入）

## 5 state.md diff

- §2 active tasks：新增 COSTRA-165 R1 实装已交付
- §3 交付历史索引：新增 `history/2026-05-27-costra-165-r1-family-context-service.md`
- §7 时间戳：新增 2026-05-27T16:25:00+08:00
