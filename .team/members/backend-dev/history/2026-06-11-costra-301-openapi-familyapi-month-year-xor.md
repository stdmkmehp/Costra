# COSTRA-301 · OpenAPI 契约同步 + miniprogram familyApi.ts 适配

## 1. 任务摘要

将 COSTRA-300 已落地的后端 family summary month/year xor 能力同步到 OpenAPI 契约文档 + miniprogram 前端调用层。
不改后端业务逻辑，仅同步文档与前端签名。

## 2. 改动清单

| 文件 | 改动 |
|------|------|
| `server/api/openapi.yaml` | A1: summary endpoint month required→false, 新增 year 参数, description 补充 xor 调用模式 |
| `server/api/openapi.yaml` | A2: FamilySummary schema required 移除 month, month 改 nullable, 新增 year nullable, range_start/range_end 补说明 |
| `server/api/openapi.yaml` | A3: FamilyCategoryRankItem description 补充 L1 语义 + ratio_bps 基数 |
| `api/CHANGELOG.md` | v0.10.0 COSTRA-301 变更记录 |
| `miniprogram/services/familyApi.ts` | B1: FamilySummary.month → string\|null, 新增 year: string\|null |
| `miniprogram/services/familyApi.ts` | B2: getFamilySummary 签名 (familyId, scope, opts?) + xor 守卫 |
| `miniprogram/services/familyApi.ts` | B3: summaryCacheKey 改为 scope 形态 (m:/y: 前缀) |
| `miniprogram/services/familyApi.ts` | B4: getCachedSummary 签名同步 scope |
| `miniprogram/services/familyApi.ts` | B6: setCachedSummary 签名同步 scope |
| `miniprogram/services/prefetch.ts` | C1: getFamilySummary(familyId, month) → (familyId, { month }) |
| `miniprogram/pages/family/index.ts` | C1: getCachedSummary/getFamilySummary 适配新签名 |

## 3. 闸门结果

- ✅ `npm run typecheck` — 0 error（前端 + 后端）
- ✅ `npm run lint` — 0 error, 4 preexisting warnings
- ✅ `npm test` (server) — 179/179 passed
- ✅ `npm run check:whitelist` — consistent

## 4. 偏离决策

无偏离。严格按 spec 执行。

## 5. 遗留 / 下一步

- B5 `invalidateFamilyCache` 不需要改动（已按 `familyId:` 前缀清除，覆盖 m: 和 y:）
- 下一步：进入 COSTRA-302 协作页 multi 模式重构
