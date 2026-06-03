# COSTRA-223 · R1.x.1 修订 · history

> **卡号**: COSTRA-223
> **类型**: review-response
> **日期**: 2026-06-18
> **Agent**: costra-miniapp-dev

---

## 1. 任务描述

Review-tech Round 1 verdict = REVISE 25/35，2 个 P0 必改 + 4 个 P1 应改。按要求修复 P0-1/P0-2（全部）+ P1-1/P1-2/P1-3/P1-4（全部 4/4）。

## 2. 产出

### 2.1 代码变更

| 文件 | 变更 | 说明 |
|---|---|---|
| `miniprogram/services/familyApi.ts` | 修改 | P0-1: InviteResponse 对齐 OpenAPI FamilyInvite（invite_id/invite_code → id/invite_token + role + share_url）· P1-1: PersonalByMember.expense → amount · P1-2: getCachedSummary 改 export + TTL 检查 · 移除死代码 getFamilySummarySWR · getFamilySummary 写入缓存 · P1-4: MAX_CACHE_SIZE=20 + 最旧淘汰 |
| `miniprogram/pages/family/index.ts` | 修改 | P0-1: invite.invite_code → invite_token + _pendingInviteToken + 分享路径 invite_token= · P0-2: _doLoadPage 和 _loadSummary catch 中 403/FAMILY_NOT_MEMBER 专门处理（invalidateFamilyCache → clearActiveFamily → Toast → 切回 personal）· P1-1: pm.expense → pm.amount · P1-2: _loadSummary 先取缓存立即渲染（SWR stale-first）· P1-3: onShareAppMessage 无 inviteToken 时返回通用分享 |

### 2.2 文档

| 文件 | 说明 |
|---|---|
| `.team/reviews/COSTRA-223/round-1-miniapp-response.md` | P0/P1 逐条答复 |

### 2.3 验证

- `npm run typecheck` ✅
- `npm run lint` ✅（无新增 error）
- `npm test -- --run` ✅ 99/99

## 3. 关键决策

| 决策 | 选项 | 选择 | 理由 |
|---|---|---|---|
| P0-2 403 处理在哪个层级 | A: request.ts 统一拦截 / B: 各 Page catch 分支 | B | 403 的恢复逻辑（清缓存 + 切回 personal + 重新加载）是页面级业务逻辑，不应在通用请求层处理 |
| P1-2 SWR 实现方式 | A: 保留 getFamilySummarySWR 修复 bug / B: 移除死代码，在 _loadSummary 中 stale-first | B | 原有 SWR 函数从未被使用，且 bug 在「先 await 再回退」的模式根本不对；stale-first 在消费端更直观 |
| P1-4 缓存淘汰策略 | A: LRU / B: 最旧 timestamp 删除 | B | Map 本身不支持 LRU，最旧 timestamp 简单且对 MVP 足够；高频切月场景中越久未访问的缓存自然 timestamp 越旧 |

## 4. 遗留

- P2-1: index.ts 仍超 500 行警戒线（R2 抽取 utils + display builder）
- P2-2/P2-4: rpx/px 换算确认（需 design-maker 对齐）
- P2-3: 已退出成员 CSS pointer-events:none → 建议加 catchtap="noop" 双重保障

## 5. state.md diff

- §2 active tasks: COSTRA-223 标题更新为「R1.x.1 修订」
- §3 交付历史索引: 新增 `history/2026-06-18-costra-223-r1x1-revise.md`
- §7 时间戳: 更新为 2026-06-18T18:30:00+08:00
