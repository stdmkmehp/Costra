# COSTRA-221 R1 实装与验证修复

> 日期：2026-06-02 · 卡号：COSTRA-221 · 角色：backend-dev

---

## §1 任务摘要

Human 触发 `start:COSTRA-221` 后，完成 Family Management API 实装，并修复首轮验证暴露的 typecheck / 单测问题。

## §2 交付范围

- 新增 `server/src/routes/families.ts` 并在 `server/src/app.ts` 注册 `/v1/families*` 路由。
- 新增 `server/src/services/familyService.ts`，集中处理家庭列表、创建、详情、改名、删除、成员列表、邀请、接受邀请、移除成员等业务规则。
- 新增 `server/src/repositories/familyInviteRepo.ts`、`server/src/repositories/familyMemberRepo.ts`，扩展 `familyRepo.ts`。
- 同步 `server/api/openapi.yaml` 的 `Family` / `FamilyMember` / `FamilyInvite`、错误码、`/families*` paths。
- 新增 `server/test/families.test.ts` 覆盖 T1~T16。
- 更新 `server/test/setup.ts` 以支撑家庭 API 测试环境。

## §3 验证修复清单

| # | 问题 | 修复 |
|---|------|------|
| 1 | `familyMemberRepo.ts` 统计 rows 类型转换触发 TS2352 | 使用 `unknown` 中转缩窄为 `{ cnt: number }[]` |
| 2 | T1 `owner_id` 断言与 schema 不符 | 修正为断言 `owner_id === userId` |
| 3 | invite 创建在 pg-mem 下 500 | 避免 SQL interval 乘法，应用层计算 `expires_at` |
| 4 | invite accept / expired / remove / left member 级联失败 | 修复 invite 创建后级联恢复 |
| 5 | Fastify DELETE body 解析不稳定 | `DELETE /families/{id}` 的 `version` 改为 querystring，并同步 OpenAPI |
| 6 | pg-mem partial index + `owner_id` 参数化查询异常 | service 层先 `assertOwner`，repository 更新按 id/version 执行 |
| 7 | T14 version conflict 构造错误 | 先 PATCH 推进 version，再用旧 version DELETE 触发 409 |
| 8 | 新增测试未使用变量 | 清理并补强成员列表断言 |

## §4 验证结果

- `cd server && npm run typecheck` ✅
- `cd server && npm test -- --run test/families.test.ts` ✅ 16/16
- `cd server && npm test -- --run` ✅ 124/124

## §5 遗留风险 / Follow-up

- P2：pg-mem partial unique index 行为与真实 PostgreSQL 有差异；当前通过 service 层 owner 校验保证权限，真实 PG 可在后续恢复 SQL 双重 owner 条件。
- P2：退出成员头像/昵称快照仍按 `FU-221-MEMBER-SNAPSHOT-ON-LEFT` 观察，不阻塞本卡。

## §6 下一步

建议进入 `review-tech:COSTRA-221`。
