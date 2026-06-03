# COSTRA-223 · 产出 Review · Round 1 · Tech

> **触发**：`review-tech:COSTRA-223`（D-014 规约 B 自动拉起）  
> **审查时间**：2026-06-02 17:04  
> **被审 Agent**：`costra-miniapp-dev`  
> **被审产出**：5 文件 1712 行（`services/familyApi.ts` + `pages/family/index.{ts,wxml,wxss,json}`）

---

## 总评

| 项 | 值 |
|---|---|
| **Verdict** | `REVISE` |
| **总分** | **25/35** |
| P0 | 2 |
| P1 | 4 |
| P2 | 4 |

---

## 维度得分

| 维度 | 得分 | 一句话 |
|---|---|---|
| 契约一致性 | 2/5 | InviteResponse 与 OpenAPI 严重不对齐；PersonalByMember 字段名可能不符 |
| 架构与分层 | 4/5 | 目录结构合理，职责划分清晰 |
| 数据与持久化 | 4/5 | SWR 缓存有定义但未被使用且逻辑有 bug |
| 安全与合规 | 2/5 | 403/FAMILY_NOT_MEMBER 完全未处理 |
| 可测与可观测 | 4/5 | 错误日志合理，缺单测入口 |
| 工程纪律 | 4/5 | index.ts 717 行超 500 行警戒线 |
| 设计还原 | 5/5 | 背景色、字号、导航标题、空态、零值排除全对齐 |

---

## P0 阻塞点（必改）

### P0-1 · 邀请响应契约与 OpenAPI 严重不对齐

**位置**：`services/familyApi.ts:115-121` + `pages/family/index.ts:559`  
**问题**：前端 `InviteResponse` 定义为 `{ invite_id, invite_code, ... }`，但 OpenAPI `FamilyInvite` schema required 字段为 `{ id, family_id, invite_token, role, expires_at, share_url }`。前端 `invite.invite_code` 运行时必然读 `undefined`。  
**修复**：将 `InviteResponse` 对齐为 `{ id, family_id, invite_token, role, expires_at, share_url }`；index.ts 分享路径改用 `invite.invite_token` 或 `invite.share_url`。

### P0-2 · 403 / FAMILY_NOT_MEMBER 完全未处理

**位置**：`pages/family/index.ts:302-306, 322-330`  
**问题**：dispatch §3.2 明确要求「非成员 403 → 不得静默吞掉，应提示并清理本地缓存」。当前 catch 块统一 Toast + 空态，不区分错误码。用户被移出后持续 403 → 死循环。  
**修复**：catch 中对 `err.status === 403` 或 `err.code === 'FAMILY_NOT_MEMBER'` 做专门处理：`invalidateFamilyCache(familyId)` → `clearActiveFamily()` → Toast「你已不在该家庭中」→ 重新 `_doLoadPage()` 切回 personal。

---

## P1 应改

### P1-1 · PersonalByMember 字段名可能与后端不一致

**位置**：`services/familyApi.ts:74-81`  
**问题**：前端用 `expense`，OpenAPI 可能为 `amount`。若不一致则个人支出行全部被过滤为 0。  
**修复**：确认后端实际返回字段名后对齐。

### P1-2 · SWR 函数未被使用且实现有 bug

**位置**：`services/familyApi.ts:202-220` + `pages/family/index.ts:313`  
**问题**：dispatch §3.3 要求 stale-while-revalidate，但页面直接调用 `getFamilySummary` 不走 SWR。SWR 实现逻辑也是先 await 请求再回退缓存（不是 stale-first）。  
**修复**：页面 `_loadSummary` 改为先取缓存立即渲染 → 异步刷新 → 成功后 setData 更新。

### P1-3 · 邀请流程分享路径可能不含邀请码

**位置**：`pages/family/index.ts:549-568`  
**问题**：`onShareAppMessage` 依赖 `_pendingInviteCode`，但用户可能直接触发 share 按钮而未先走 `onInvite()`，此时分享路径不含邀请码。  
**修复**：在 `onShareAppMessage` 回调中获取/确保 invite_token 存在后再返回分享内容。

### P1-4 · 缓存 Map 无上限

**位置**：`services/familyApi.ts:132`  
**问题**：内存 Map 无大小限制，高频切月/家庭时缓存持续增长。  
**修复**：添加最大条目数（如 20），按 LRU 淘汰。或登记为 follow-up。

---

## P2 建议

| 编号 | 问题 | 建议 |
|---|---|---|
| P2-1 | index.ts 717 行超 500 行警戒线 | 抽取 utils（formatCents/date helpers）+ display builder 到独立模块 |
| P2-2 | Solo 引导文案 28rpx 与 "14px" 换算确认 | 确认 2x 基准后加注释说明 |
| P2-3 | 已退出成员仅 CSS pointer-events:none | 建议改用 catchtap="noop" 双重保障 |
| P2-4 | Segmented Bar height 16rpx 与 "8px" 换算确认 | 同 P2-2 基准确认 |

---

## 修复指令

miniapp-dev R1.x.1 修订需解决：

1. **P0-1 + P0-2 必改**。
2. **P1-1/P1-2/P1-3** 强烈建议修复（任意 3/4 即可 PASS）。
3. **P1-4** 可延后登记 follow-up。
4. **P2** 不阻塞，记入下一轮。

修复后重跑 `npm run typecheck` + `npm run lint` + `npm test -- --run` 全绿即可交付 R1.x.1。
