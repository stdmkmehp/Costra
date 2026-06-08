# COSTRA-105 R1.x.2 · BUG-002 sync/push payload UUID schema 校验补全

> 日期：2026-05-18 · 卡号：COSTRA-105 R1.x.2 · SBAI 第 11 次冒烟

## 1 任务摘要

BUG-002 紧急止血：`server/src/routes/sync.ts` `syncPushBodySchema` 的 `payload` 字段用 `additionalProperties: true` 完全不校验内部字段格式，导致非法 UUID（如 `"default"` 字面量）穿透到 PG 抛 22P02 → 500 INTERNAL。

## 2 变更清单

| 文件 | 变更 |
|---|---|
| `server/src/routes/sync.ts` | `syncPushBodySchema.payload` 从 `{ type: 'object', additionalProperties: true }` 改为含 `properties: { ledger_id: { format: 'uuid' }, category_id: { type: ['string','null'], format: 'uuid' } }` + 保留 `additionalProperties: true` |
| `server/test/sync.test.ts` | 加 T9 case：`ledger_id: 'default'` → 400 INVALID_ARGUMENT |

## 3 验证结果

- `npm run typecheck` → exit 0 ✅
- `cd server && npm test` → 25 tests passed（含新 T9）✅
- 根目录 `npm test` → 42 tests passed ✅
- errorHandler 已有 `err.validation` → INVALID_ARGUMENT 映射 → 0 改动 errorHandler ✅
- lints → 0 ✅

## 4 遗留

- P2：COSTRA-155 阶段 2 需补完整 entry payload schema 校验（amount range / type enum / occurred_at format 等）
- P2：sync.test.ts T9 case 仅验证 ledger_id 非法 · category_id 非法路径待阶段 2 完整 schema 补齐时补测

## 5 决策记录

- 走 D-017 v3 §2.4 E1 例外路径（单 commit · ≤ 30 min）
- 不改 errorHandler（已有 `err.validation` → INVALID_ARGUMENT 分支 2）
- 不改 OpenAPI yaml（本卡 scope 内不动协议事实源）
- 不改 client 任何文件（与 miniapp-dev R1.x.1 责任域分隔）
