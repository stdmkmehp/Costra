# COSTRA-260 · 统计接口增加 user_id 维度（成员维度横滑切换的后端支撑）

## 1. 卡号 & 摘要

**COSTRA-260** · 统计页 3 个端点（monthly / yearly / drill-down）增加可选 `user_id` query 参数，支持按成员维度过滤统计数据。

## 2. 改动清单

| # | 文件 | 改动类型 | 说明 |
|---|------|----------|------|
| 1 | `server/api/openapi.yaml` | 修改 | 3 端点 +user_id 参数；MonthlyStatistics/YearlyStatistics +filtered_user_id 字段 |
| 2 | `server/src/repositories/statisticsRepo.ts` | 重构 | 4 个查询函数尾参改 opts 对象（`{ createdBy?, client? }`）；SQL 动态拼 `AND created_by = $N` |
| 3 | `server/src/repositories/familyMemberRepo.ts` | 新增函数 | `isMemberIncludingLeft(userId, familyId)` — 查 active+left 成员，用于越权防护 |
| 4 | `server/src/services/statisticsService.ts` | 重构 | 3 函数 input +userId；`assertUserIdBelongsToFamily` 守门；透传 createdBy 到 repo；返回 `filtered_user_id` |
| 5 | `server/src/routes/statistics.ts` | 修改 | 3 个 querystring schema +user_id；路由层透传到 service |
| 6 | `server/test/statistics.test.ts` | 新增 | T15~T19 共 5 条新测覆盖 user_id 维度 |

## 3. 关键设计决策

1. **为什么用 `isMemberIncludingLeft` 而非 `assertActiveMember`**：
   - 业务决策"已退出成员允许查询其历史数据"（数据不可变原则）
   - `assertActiveMember` 仅查 `left_at IS NULL`，已退出成员会被拒
   - `isMemberIncludingLeft` 查全部记录（`WHERE family_id = $1 AND user_id = $2` 无 left_at 过滤）
   - 同时防止越权探测：非 family 成员的 user_id 返回 403 FAMILY_NOT_MEMBER

2. **userId === callerUserId 跳过第二次校验**：
   - callerUserId 已被 `assertActiveMember` 校验过，无需重复查询

3. **尾参对象化重构**：
   - 遵循项目"追求最干净彻底的改动"约定
   - 4 个 repo 函数从位置参数 `client?: Runner` 改为 `opts?: { createdBy?, client? }`
   - SQL 动态拼接使用参数化绑定 `$N`，不拼字符串

4. **filtered_user_id 仅在 monthly/yearly 响应中返回**：
   - drill-down 不需要（按派单 scope 约定）
   - 值为传入的 user_id 或 null（不传时）

## 4. 闸门结果

- ✅ `npm --prefix server run typecheck` 0 error（src 层；test 层有 1 个 pre-existing sync.test.ts 未使用变量）
- ✅ `npm --prefix server test` 169/169 全绿（含 5 条新增 T15~T19）
- ✅ 不破坏原有 T1~T14
- ✅ OpenAPI schema 与 fastify 路由 query 完全对齐
- ✅ `filtered_user_id` 在 monthly + yearly 响应里都有（drill-down 不需要）

## 5. 提交记录

```
f7db01d feat(backend,api): statistics endpoints support user_id dimension filtering
```

6 files changed, 405 insertions(+), 45 deletions(-)
