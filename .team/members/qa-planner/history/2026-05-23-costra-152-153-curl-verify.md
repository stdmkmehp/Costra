# qa-planner history · 2026-05-23 · COSTRA-152+153 curl-verify

## §1 任务摘要

产出 `docs/qa/costra-152-153-curl-verify.md`（COSTRA-152 + COSTRA-153 联合双卡 curl 实测手册 v1.0）· 覆盖 PATCH / DELETE / K3 method-override / P0 跨 family 守门补丁三处共享验证。

## §2 交付清单

- `docs/qa/costra-152-153-curl-verify.md` v1.0 · ~500 行 · 7 步 + 5 硬断言 H1~H5
- `.team/members/qa-planner/state.md` §2/§3/§7 已更新

## §3 关键决策

1. **跨 family 守门期望 404 而非 403**：代码走 `entryRepo.findById` + `WHERE deleted_at IS NULL` → 返 null → NOT_FOUND → 404。安全优先不泄露 entry 存在性（review-tech 评论确认）。
2. **DELETE 重复（已删 entry）期望 404 而非 409**：因 `WHERE deleted_at IS NULL` 不命中 · 不会走到 version 比较逻辑 · 与 T5 测试行为一致。
3. **K3 405 响应体格式**：不走 errorHandler · 直接 `reply.code(405).send({ error: { code, message } })` · 与 errorHandler 的 `{ code, message, trace_id }` 格式不同 · 手册已明示。
4. **6 个 migrations**：比 104 实测时多了 0005 + 0006 · 手册已列全。

## §4 事实源校验

每个 curl 期望响应均基于：
- `server/src/routes/entries.ts:197-290`（PATCH + K3 + DELETE handler 实装代码）
- `server/src/repositories/entryRepo.ts:359-409`（findById userId 守门）
- `server/src/plugins/errorHandler.ts`（error body 序列化格式）
- `server/src/errors/ErrorCode.ts`（VERSION_CONFLICT → 409 / NOT_FOUND → 404）
- `server/test/entries-patch.test.ts` T1~T8（9 测断言复刻）
- `server/test/entries-delete.test.ts` T1~T6（6 测断言复刻）
- `server/api/openapi.yaml:559-597`（PATCH/DELETE OpenAPI 含 403 响应定义）
- `.team/reviews/COSTRA-152/round-1-tech.md` + `.team/reviews/COSTRA-153/round-1-tech.md`（守门补丁铁证 + 联合总评）

## §5 遗留 / 后续

- 等 Human curl 实测 7 步 + 5 硬断言 → `approve:COSTRA-152 + COSTRA-153` 或 `revise:...`
- FU-152-R001 + FU-153-R001 双胞胎 P1（OpenAPI 403 缺定义）已由 R1.x.1 修复（commit `167bf17`）· 不影响本手册
