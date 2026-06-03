# COSTRA-223 · Round 1 Review Response · miniapp-dev

> **Agent**: costra-miniapp-dev
> **Review**: `.team/reviews/COSTRA-223/round-1-tech.md`
> **Verdict**: REVISE 25/35
> **Response Date**: 2026-06-18

---

## P0 逐条答复

| # | Review 意见 | 采纳/反驳 | 说明 |
|---|---|---|---|
| P0-1 | InviteResponse 与 OpenAPI 不对齐（invite_id/invite_code → id/invite_token 等） | ✅ 采纳 | 已读取 `server/api/openapi.yaml` FamilyInvite schema，确认字段为 `{id, family_id, invite_token, role, expires_at, share_url}`。修改了 `services/familyApi.ts:InviteResponse` 接口 + `pages/family/index.ts` 中 `invite.invite_code` → `invite.invite_token` + `_pendingInviteCode` → `_pendingInviteToken` + 分享路径 `invite_code=` → `invite_token=` |
| P0-2 | 403 / FAMILY_NOT_MEMBER 未处理 | ✅ 采纳 | 已读取 `services/request.ts` 确认 ApiError 含 `status`(number) 和 `code`(string)。在 `_doLoadPage` 和 `_loadSummary` 的 catch 中新增：检测 `err.status === 403 || err.code === 'FAMILY_NOT_MEMBER'` → `invalidateFamilyCache(familyId)` → `clearActiveFamily()` → Toast「你已不在该家庭中」→ 重新 `_doLoadPage()` 切回 personal |

---

## P1 逐条答复

| # | Review 意见 | 采纳/反驳 | 说明 |
|---|---|---|---|
| P1-1 | PersonalByMember 字段名：前端 `expense` vs 后端 `amount` | ✅ 采纳 | 已读取 `server/src/services/familySummaryService.ts` 确认后端 `FamilyPersonalExpenseBlock` 字段名是 `amount`（第 88~94 行），与 OpenAPI `FamilyPersonalExpenseBlock.amount` 一致。修改了 `services/familyApi.ts:PersonalByMember.expense` → `amount` + `pages/family/index.ts` 中 `pm.expense` → `pm.amount` |
| P1-2 | SWR 未被使用 + 实现 bug | ✅ 采纳 | 1. 移除了有 bug 的死代码 `getFamilySummarySWR`（先 await 再回退缓存，不是 stale-first）；2. `getCachedSummary` 改为 export + 加入 TTL 过期检查；3. `getFamilySummary` 成功后调用 `setCachedSummary` 写缓存；4. `_loadSummary` 改为先取缓存立即渲染（stale-first），再异步请求刷新 |
| P1-3 | 邀请流程分享路径可能不含邀请码 | ✅ 采纳 | 在 `onShareAppMessage` 中，若 `_pendingInviteToken` 为空则返回通用分享路径（不含邀请参数），不再构造不含邀请码的无效邀请链接。同时参数名已从 `invite_code` 改为 `invite_token` |
| P1-4 | 缓存 Map 无上限 | ✅ 采纳 | 添加 `MAX_CACHE_SIZE = 20`，`setCachedSummary` 写入前检测超上限则删除 timestamp 最旧条目 |

---

## 变更文件清单

| 文件 | 变更类型 | 行数变更 |
|---|---|---|
| `miniprogram/services/familyApi.ts` | 修改 | +30/-27（InviteResponse 对齐 + PersonalByMember.amount + 缓存层重构 + SWR 死代码移除 + MAX_CACHE_SIZE） |
| `miniprogram/pages/family/index.ts` | 修改 | +35/-12（403 处理 + SWR stale-first + invite_token + pm.amount） |

---

## 验证结果

- `npm run typecheck` ✅
- `npm run lint` ✅（无新增 error）
- `npm test -- --run` ✅ 99/99
