# COSTRA-158 R1 backend 段 · /users/me + has_completed_profile

> 卡号：COSTRA-158 · 装扮档：backend-dev · 时间：2026-05-19T10:18+08:00

---

## 1. 任务摘要

实装 COSTRA-158 backend 段 8 项 server 改动（dispatch §2.1 A~G'）：
- 新增 `has_completed_profile` DB 列（BOOLEAN NOT NULL DEFAULT FALSE · IF NOT EXISTS 真幂等）
- userRepo 加字段映射 + `updateProfile` 方法（avatar_url 三态语义 CASE 表达式 + 单调性 SET TRUE）
- authService.toUserView 加 `has_completed_profile` 字段
- 新建 routes/users.ts（GET + PATCH /users/me + POST K3 兜底）
- app.ts 注册 users 路由到 v1 子作用域
- OpenAPI User schema 加 `has_completed_profile` 字段 + required 追加
- 新建 users.test.ts（10 测 · 含 K3 正例 T9 + 反例 T10）
- 修订 auth.test.ts（T1 追加 `has_completed_profile === false` 断言）

额外必要改动：setup.ts pg-mem DDL 追加 `has_completed_profile` 列（测试基础设施 · 非 dispatch 列出但阻断测试）

## 2. 改动清单 + 净改行数

| 文件 | 操作 | 净改行 |
|---|---|---|
| `server/db/migrations/0005_users_has_completed_profile.sql` | 新建 | +21 |
| `server/src/repositories/userRepo.ts` | 修订 | +58 |
| `server/src/services/authService.ts` | 修订 | +5 |
| `server/src/routes/users.ts` | 新建 | +139 |
| `server/src/app.ts` | 修订 | +2 |
| `server/api/openapi.yaml` | 修订 | +4 |
| `server/test/users.test.ts` | 新建 | +200 |
| `server/test/auth.test.ts` | 修订 | +1 |
| `server/test/setup.ts` | 修订 | +1 |
| **合计** | | **+431** |

## 3. 闸门结果

| 闸门 | 结果 |
|---|---|
| G1 typecheck | ✅ PASS |
| G2 lint | ✅ PASS |
| G3 test | ✅ PASS（server 35/35 · root 42/42）|
| G4 check:appjson | ✅ PASS |
| G5 check:tooling | ✅ PASS |
| G6 check:whitelist | ✅ PASS |
| G8 users 路由 grep ≥ 2 | ✅ PASS (2) |
| G13 whitelist 规则 D | ✅ PASS |
| G14 OpenAPI required 含 has_completed_profile | ✅ PASS |

## 4. 交接

- **状态**：READY-FOR-MINIAPP-DEV-SEGMENT
- **miniapp-dev 待做**：H（TokenRaw + mockExchange）+ I（computeHasProfile 严格判定）+ J（home.spec.ts 修订）+ K（FU-COMMON-MINIAPP-PATCH-LIMIT 关闭条件确认）
- **不 commit**：按 D-018 范式 · miniapp-dev 段完成后统一 commit
- **注意**：setup.ts pg-mem DDL 已追加 has_completed_profile 列 · miniapp 段测试无需额外处理

## 5. 遗留 / 偏差

- **P0**：无
- **P1**：无
- **P2**：(1) setup.ts pg-mem DDL 追加不在 dispatch 原始 scope 列表 · 但属于测试基础设施必要改动 · 不改则全部 server 测试 500 · 属隐含依赖 · 已执行
- **偏差**：无 · dispatch 所有技术决策（K3 位置 / avatar_url 三态 / 单调性 / IF NOT EXISTS / 不 backfill / 不声明 POST /users/me 到 OpenAPI）全部严格遵从
