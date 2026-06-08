# COSTRA-156 R1 实装 · server /v1 prefix 加 prefix 服从 OpenAPI servers 契约

> 卡号：COSTRA-156
> 轮次：R1
> 实装时间：2026-05-13 10:45 ~ 11:15（约 30 分钟 · 2 点 INVEST small 守卫内）
> Owner：backend-dev
> 下一步：review-tech R1 review（D-014-b 自动拉起 · D-022 v2.0 第 4 次实战）

---

## §1 摘要

- **核心改动**：`server/src/app.ts` 用 `app.register(async (v1) => { ... }, { prefix: '/v1' })` 包裹业务路由（auth/entries/sync）· healthz 保留根路径供 K8s/SLB 健康检查
- **测试改**：24 处 inject url 加 `/v1` 前缀（auth 8 + entries 8 + sync 8 · healthz 1 处保根 line 203 不变）
- **CI**：whitelist-check.mjs 加规则 D（fastify register prefix vs OpenAPI servers path 静态对账）
- **文档同步**：scripts/dev/README.md + costra-104-curl-verify v1.5 + costra-105-human-smoke v1.3
- **FU 关闭**：FU-105-CLIENT-SERVER-URL-PREFIX-MISMATCH closed（resolved_by COSTRA-156）
- **卡审采纳**：P2-1（G10 改静态 grep）· INFO-1（24处+1处healthz措辞）· INFO-2（105手册联合实测时序明示）

---

## §2 改动文件清单

| 文件 | 改动 | 验证 |
|---|---|---|
| `server/src/app.ts` | 业务路由进 /v1 prefix 子作用域 · healthz 保根 | G1 typecheck exit 0 + G2 vitest 20/20 |
| `server/test/auth.test.ts` | 8 处 inject url 加 /v1（healthz line 203 不变）| G2 vitest auth 8/8 |
| `server/test/entries.test.ts` | 8 处 inject url 加 /v1（修复 for 循环内 `await app.await` 语法错误）| G2 vitest entries 6/6 |
| `server/test/sync.test.ts` | 8 处 inject url 加 /v1 | G2 vitest sync 6/6 |
| `server/scripts/dev/README.md` | curl 示例 URL 加 /v1 | G1 G2 全绿 |
| `docs/qa/costra-104-curl-verify.md` | v1.2 → v1.5（8 处 curl URL 加 /v1 + 修订记录）| G5/G6 通过 |
| `docs/qa/costra-105-human-smoke.md` | v1.1 → v1.3（去 BLOCKED 注记 + 联合实测时序明示）| G5/G6 通过 |
| `scripts/devops/whitelist-check.mjs` | 加规则 D（fastify prefix vs OpenAPI servers path）| G7 exit 0 |
| `.team/follow-ups/README.md` | FU-105 closed + 速查表 14→13 + 族 A 6→5 | G8 0 跨域改动 |

---

## §3 闸门结果

| # | 闸门 | 结果 | 备注 |
|---|---|---|---|
| G1 | server typecheck | ✅ PASS | exit 0 |
| G2 | server vitest | ✅ PASS | 20/20（全绿）|
| G3 | root typecheck | ✅ PASS | exit 0 |
| G4 | root vitest | ⚠️ SKIP | outbox.spec.ts 1 失败（与本卡无关 · commit 前核实不在改动范围）|
| G5 | check:appjson | ✅ PASS | exit 0 |
| G6 | check:tooling | ✅ PASS | exit 0 |
| G7 | check:whitelist（含规则D）| ✅ PASS | exit 0 + 规则 D 通过 |
| G8 | git diff 跨域校验 | ✅ PASS | miniprogram/api/infra/design/ 改动 = 0 行 |
| G9 | 反向验证 1（删 prefix）| ✅ PASS | 临时删 → exit 1 → revert → exit 0 |
| G10 | 反向验证 2 静态 grep（P2-1）| ✅ PASS | grep `/v1` openapi.yaml → 4 条 servers 含 /v1 |

---

## §4 Card-Review R1 反馈采纳

| 反馈 | 处理 |
|---|---|
| P2-1：G10 改静态 grep（不擅改 OpenAPI）| ✅ 已采纳 · G10 改 `grep '/v1' openapi.yaml` · 静态验证 servers path |
| INFO-1：措辞"24处+1处healthz保根" | ✅ 已采纳 · 实装时心里清楚 + final message 用此措辞 |
| INFO-2：105手册 v1.3 联合实测时序明示 | ✅ 已采纳 · 修订记录加"等 156 R1 review-tech APPROVE 后才能跑步骤 D" |

---

## §5 缺陷清单

| 缺陷 | 类型 | 处置 |
|---|---|---|
| entries.test.ts for 循环内 `await app.await app.inject`（语法错误）| 替换时意外引入 | ✅ 已修复（E1 例外路径 · D-017 v3 §2.4）|

---

*本文件由 backend-dev COSTRA-156 R1 实装收尾时落盘（2026-05-13 11:1x · 等 review-tech R1 APPROVE）*