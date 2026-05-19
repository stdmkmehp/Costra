# COSTRA-156 · server 加 `/v1` prefix · 让实装服从 OpenAPI 契约（FU-105-CLIENT-SERVER-URL-PREFIX-MISMATCH 转正）

> **派单时间**：2026-05-13 10:35（Orchestrator 同对话轮 D-016 兑现）
> **触发**：Human 决策"先做 156 再 smoke 105"（2026-05-13 10:30）· COSTRA-105 R1.1 手册修订时（2026-05-12 16:1x）发现 P0 gap · Human 2026-05-12 16:27 决策方案 A
> **依赖**：COSTRA-104 client/server 已上线 · COSTRA-105 R1 review-tech APPROVE 40/40（等 Human 实测）
> **下游解锁**：COSTRA-105 方式 B 真链路实测（步骤 D 端到端 push）· COSTRA-150 client 调度器 Sprint-3 联调

---

## §0 SBAI 装扮路径

| 阶段 | Subagent | 状态 |
|---|---|---|
| **Card-Review R1** | `costra-card-reviewer-tech`（D-014-a · 审查档第 8 次实战 · D-022 v2.0 评分） | 等 Orchestrator 同轮 spawn |
| **R1 实装** | `costra-backend-dev`（第 2 次实装实战 · SBAI v1.1 装扮档第 10 次冒烟） | 等卡审 PASS |
| **R1 Review** | `costra-review-tech`（D-014-b 自动拉起 · 审查档第 8 次 · **D-022 v2.0 评分表第 4 次实战**） | 等 R1 实装完 |
| **回归验证** | **不需要 COSTRA-104 单独回归**（Human 决策）· COSTRA-105 方式 B 真链路实测 = 端到端等效回归 | 等 R1 Review APPROVE |
| **Human T1 终审** | `approve:COSTRA-156` | 等 R1 Review APPROVE + 105 实测全 PASS（156 + 105 双卡联合实测后联合终审） |

---

## §1 背景

### 1.1 根因（三层 · 沿用 FU-105-CLIENT-SERVER-URL-PREFIX-MISMATCH 已沉淀分析）

- **L1 协议歧义**：OpenAPI 3.0.3 `servers[].url` 含 `/v1` path（COSTRA-020 G3 通过 30/30 · 行业范式 Stripe / GitHub API）+ `paths[]` 为相对 path · 规约允许但**不强制实装方实现 servers prefix** · fastify/express 等框架不会自动从 OpenAPI servers 推 prefix
- **L2 验证盲区**：server 25 处 inject test 用 `url: '/auth/...'` 不走真 HTTP · client 默认 `mockLogin: true` 不发 HTTP · COSTRA-104 curl 直打 server 沿用无 `/v1` 路径 · **三条独立路径都自洽 · 端到端契约联调用例从未存在**（COSTRA-050 §2.2 supertest + jest-openapi 规划未落地）
- **L3 CI 误判**：`scripts/devops/whitelist-check.mjs` 三方对账（env.ts ↔ openapi.yaml servers ↔ domains.md）按"字符串相等"全 PASS · **没核对 path 拼接后的有效 URL** · 给虚假安全感

### 1.2 事实证据（10 项 · COSTRA-105 R1.1 手册修订时核实）

| # | 证据 | 来源 |
|---|---|---|
| E1 | OpenAPI `servers[]` 4 条全带 `/v1` | `server/api/openapi.yaml:24-32` |
| E2 | OpenAPI `paths[]` 全部无 `/v1`（相对路径） | `openapi.yaml:61-323` |
| E3 | server fastify `app.ts` 注册路由无 prefix | `server/src/app.ts:67-70` |
| E4 | server route 字面量全部无 `/v1` | `routes/{auth,entries,sync,healthz}.ts` |
| E5 | server 单测 25 处 inject url（含 1 个 healthz 应保根）| `server/test/{auth,entries,sync}.test.ts` |
| E6 | client `apiBaseUrl` 4 个 env 全带 `/v1` | `miniprogram/services/env.ts:17/28/39` |
| E7 | client `path` 字面量全部无 `/v1` | `auth.ts:134/175/206 / sync.ts:87` |
| E8 | client `buildUrl` 字符串拼接 `${base}${path}` | `request.ts:135-143` |
| E9 | 实际请求 = `http://localhost:8080/v1/auth/wx-login` | E6+E7+E8 推演 |
| E10 | server `setNotFoundHandler` 命中 → 404 | E3+E9 推演 |

### 1.3 Human 2026-05-12 16:27 决策方案 A

> **方案 A**：server 加 `/v1` prefix · 让实装服从 OpenAPI 契约。OpenAPI 已声明 `/v1` 是 server URL 一部分（COSTRA-020 G3 评审通过 30/30 含此 servers 段）· **应让 server 实装服从契约 · 不应让契约迁就实装**。client 0 改动（已经写对）。

---

## §2 Scope（9 项 · "客户端 0 改动"是关键铁律）

### 2.1 主交付（5 项 · 必交）

#### A `server/src/app.ts` 加 `/v1` prefix 注册（核心改动 · ~10 行重构）

```ts
// 现状（line 67~70）：
//   await registerHealthRoute(app);
//   await registerAuthRoutes(app);
//   await registerEntriesRoutes(app);
//   await registerSyncRoutes(app);

// 目标：
//   await registerHealthRoute(app);  // ⚠️ healthz 保留根路径（K8s/SLB liveness probe 习惯）
//   await app.register(async (v1) => {
//     await registerAuthRoutes(v1);
//     await registerEntriesRoutes(v1);
//     await registerSyncRoutes(v1);
//   }, { prefix: '/v1' });
```

**关键约束**：
- ✅ `/healthz` **保留根路径**（line 67 不变）· 理由：K8s/SLB liveness probe 历来用 `/` 或 `/healthz` 不带版本 · `/v1/healthz` 不符合 ops 习惯 · 且 healthz 本身不在 OpenAPI paths 段（不属业务契约）
- ✅ 业务路由 `/auth/*` `/entries*` `/sync/*` 三组全部进 `prefix: '/v1'` 子作用域
- ✅ 实装顺序：先注册 healthz 再注册 v1 子作用域 · 防止根 404 handler 优先级问题
- ❌ **不**改 `routes/{auth,entries,sync}.ts` 内部字面量（仍 `app.post('/auth/wx-login', ...)`）· fastify register prefix 自动拼接

#### B `server/test/auth.test.ts` 8 处 inject url 加 `/v1`（保 1 处 healthz 不变）

| 行号 | 当前 | 目标 |
|---|---|---|
| 41 | `url: '/auth/wx-login'` | `url: '/v1/auth/wx-login'` |
| 94 | `url: '/auth/wx-login'` | `url: '/v1/auth/wx-login'` |
| 107 | `url: '/auth/wx-login'` | `url: '/v1/auth/wx-login'` |
| 132 | `url: '/auth/refresh'` | `url: '/v1/auth/refresh'` |
| 151 | `url: '/auth/refresh'` | `url: '/v1/auth/refresh'` |
| 174 | `url: '/auth/logout'` | `url: '/v1/auth/logout'` |
| 183 | `url: '/auth/logout'` | `url: '/v1/auth/logout'` |
| 192 | `url: '/auth/refresh'` | `url: '/v1/auth/refresh'` |
| **203** | `url: '/healthz'` | **不变（healthz 不在 prefix 内）** |

#### C `server/test/entries.test.ts` 8 处 inject url 加 `/v1`

| 行号 | 当前 | 目标 |
|---|---|---|
| 30 | `url: '/auth/wx-login'` | `url: '/v1/auth/wx-login'` |
| 82 | `url: '/entries'` | `url: '/v1/entries'` |
| 107 | `url: '/entries'` | `url: '/v1/entries'` |
| 123 | `url: '/entries'` | `url: '/v1/entries'` |
| 135 | `url: '/entries?limit=20'` | `url: '/v1/entries?limit=20'` |
| 147 | `url: '/entries'` | `url: '/v1/entries'` |
| 158 | `url: '/entries/00000000-0000-0000-0000-0000000000ff'` | `url: '/v1/entries/...'` |
| 174 | `url: '/entries/00000000-0000-0000-0000-0000000000ee'` | `url: '/v1/entries/...'` |

#### D `server/test/sync.test.ts` 8 处 inject url 加 `/v1`

| 行号 | 当前 | 目标 |
|---|---|---|
| 33 | `url: '/auth/wx-login'` | `url: '/v1/auth/wx-login'` |
| 75 | `url: '/sync/push'` | `url: '/v1/sync/push'` |
| 107 | `url: '/sync/push'` | `url: '/v1/sync/push'` |
| 137 | `url: '/sync/push'` | `url: '/v1/sync/push'` |
| 165 | `url: '/sync/push'` | `url: '/v1/sync/push'` |
| 204 | `url: '/sync/push'` | `url: '/v1/sync/push'` |
| 220 | `url: '/sync/push'` | `url: '/v1/sync/push'` |
| 235 | `url: '/sync/pull'` | `url: '/v1/sync/pull'` |

#### E 文档同步（3 处 · 协议事实源对齐）

##### E.1 `server/scripts/dev/README.md` curl 示例（line 36）

```diff
- RESPONSE=$(curl -s -X POST http://127.0.0.1:8080/auth/wx-login \
+ RESPONSE=$(curl -s -X POST http://127.0.0.1:8080/v1/auth/wx-login \
```

##### E.2 `docs/qa/costra-104-curl-verify.md` 8 处 curl URL 加 `/v1` · 版本 v1.4 → v1.5

> **关键**：v1.5 修订记录中明示 "Human 决策不要求 104 重跑回归"（COSTRA-105 方式 B 真链路实测 = 端到端等效回归）· 仅文档同步对齐 · 不触发 Human 操作

具体改动：grep `127.0.0.1:8080/auth\|127.0.0.1:8080/sync\|127.0.0.1:8080/entries\|localhost:8080/auth\|localhost:8080/sync\|localhost:8080/entries` 全部加 `/v1` · 共 8 处。修订记录段加 v1.5 entry。

##### E.3 `docs/qa/costra-105-human-smoke.md` v1.2 → v1.3 · 去 BLOCKED 注记

10 处批量替换：
- §0.1 警示段："已决策方案 A · 委托 COSTRA-156" → **"✅ COSTRA-156 已实装 + Human approve · client/server URL 一致性已兑现 · 方式 B 步骤 D 现可全跑"**
- §0.6 R1 范围声明表 client/server URL `/v1` 行：状态 → ✅ 已修复
- §4 步骤 D 模式适用矩阵 · 方式 B：`🚧 BLOCKED-BY-COSTRA-156` → ✅ 可跑
- §4.3 Pass/Fail：BLOCKED 标记移除
- §6 H1~H5 注记：步骤 D BLOCKED 段移除
- §8 失败分流 D 行 / A5 行：BLOCKED 措辞改"COSTRA-156 已修复 · 失败转 backend-dev"
- §10 修订记录加 v1.3 entry

### 2.2 副交付（2 项 · 必交 · CI 防回归）

#### F `scripts/devops/whitelist-check.mjs` 加规则 D（fastify register prefix vs OpenAPI servers path 强制对账）

**目标**：从 `server/src/app.ts` 抽取 `app.register(..., { prefix: '/v1' })` · 与 OpenAPI `servers[].url` path 段对比 · 不一致即 fail

**实装提示**（轻量正则即可 · 不需要真 AST 解析）：

```js
// 从 server/src/app.ts grep `prefix: '/v1'` · 提取 prefix 字面量
const appTsContent = readFileSync('server/src/app.ts', 'utf-8');
const prefixMatch = appTsContent.match(/prefix:\s*(['"])(\/[^'"]*)\1/);
const fastifyPrefix = prefixMatch ? prefixMatch[2] : '';

// 从 OpenAPI servers[0].url 抽取 path 段（已有 parsing 逻辑可复用）
const openapiServerPath = new URL(openapi.servers[0].url).pathname;  // '/v1'

// 对账
if (fastifyPrefix !== openapiServerPath) {
  errors.push(`[D] fastify register prefix=${JSON.stringify(fastifyPrefix)} vs OpenAPI servers[0] path=${JSON.stringify(openapiServerPath)} 不一致 (COSTRA-156 防回归)`);
}
```

**关键约束**：
- 规则 D 失败 = exit 1（强制 CI 拦截）
- 提示信息引 COSTRA-156 + 修复指引（"在 server/src/app.ts 用 `app.register(..., { prefix: '/v1' })` 包裹业务路由"）
- 防御未来回归：若有人删了 prefix 或改了 OpenAPI servers · CI 立刻红
- **不需要**真 AST 解析（fastify 项目 register 用法稳定 · 正则足够）· 复杂度收敛 INVEST small

#### G FU-105-CLIENT-SERVER-URL-PREFIX-MISMATCH 状态：`open` → `closed`（resolved_by COSTRA-156）

`.team/follow-ups/README.md` 同轮 closed：
- 状态 `open` → 🟢 `closed`
- `owner_card`：COSTRA-156（待立 → 已转正）
- 加一段闭合记录：commit hash + 闭合时间 + 验证证据（"server 单测 24/24 全绿（含 v1 prefix）+ 105 方式 B 真链路实测端到端贯通"）
- 速查表 14 条 → 13 条（族 A 6 条 → 5 条）

### 2.3 不属于本卡 Scope（明确切出去）

| 不实装项 | 切出去理由 | FU/卡 |
|---|---|---|
| client `services/env.ts` apiBaseUrl 改动 | client 已经写对（已含 `/v1`）· 无需改 | N/A |
| client `services/{auth,sync}.ts` path 字面量改动 | 已经写对（不含 `/v1`）· 无需改 | N/A |
| OpenAPI `paths[]` 加 `/v1` | OpenAPI 已经写对（servers 段含 `/v1` · paths 相对路径）· 无需改 | N/A |
| OpenAPI `servers[]` 改为不含 `/v1` | 与方案 A 矛盾（方案 A 是让 server 服从 OpenAPI · 不是反过来）| N/A |
| 立 D-023 决议（OpenAPI servers prefix 与 fastify register prefix 强制一致性规约）| Sprint-3 决议层 · 不阻 156 实装 · 由 156 后总结性立案 | **FU-156-D023-DECISION**（Sprint-3 候选 · 0.5 点 · pm-writer / 议入 Sprint-2 末 Retro）|
| COSTRA-104 curl 实测 Human 重跑 | Human 已决策不需要（COSTRA-105 方式 B 真链路实测 = 端到端等效回归）| N/A |
| COSTRA-105 R1.x 重审 | 105 review-tech R1 已 APPROVE 40/40 · 156 不改 105 实装代码 · 仅 105 手册 v1.2 → v1.3 文档同步（属 chore + 0 行为变更 · D-013 T3 自动关闭路径）| 105 直接进 Human 终审 |

---

## §3 DoD（可度量 · 12 项）

### §3.1 主交付（5 项）

- [ ] `server/src/app.ts` 加 `/v1` prefix 注册（healthz 保根路径）
- [ ] `server/test/auth.test.ts` 8 处 inject url 加 `/v1`（healthz 1 处保根）· 测试 13/13 全绿
- [ ] `server/test/entries.test.ts` 8 处 inject url 加 `/v1`· 测试全绿
- [ ] `server/test/sync.test.ts` 8 处 inject url 加 `/v1`· 测试全绿
- [ ] 文档 3 处同步（scripts/dev/README.md curl + 104 curl-verify v1.5 + 105 手册 v1.3）

### §3.2 副交付（2 项）

- [ ] `scripts/devops/whitelist-check.mjs` 加规则 D（正则抽 prefix · 三方对账）
- [ ] `.team/follow-ups/README.md` FU-105-CLIENT-SERVER-URL-PREFIX-MISMATCH 标 closed（resolved_by COSTRA-156）+ 速查表 14→13

### §3.3 协议对齐（3 项）

- [ ] OpenAPI `servers[].url` 不变（已含 `/v1`）
- [ ] OpenAPI `paths[]` 不变（已无 `/v1`）
- [ ] client `env.ts` / `auth.ts` / `sync.ts` 不变（G6 跨域 diff 必须空 · backend 卡禁触 client）

### §3.4 防回归（2 项）

- [ ] 反向验证：临时改 `app.ts` 删除 prefix → `npm run check:whitelist` exit 1（规则 D 触发）→ revert → exit 0
- [ ] 反向验证：临时改 OpenAPI `servers[0].url` 去 `/v1` → exit 1 → revert → exit 0

---

## §4 闸门（≥ 7 项 · 必跑全绿才提交）

| # | 闸门 | 命令 | 期望 |
|---|---|---|---|
| G1 | server typecheck | `cd server && npm run typecheck` | exit 0 |
| G2 | server vitest | `cd server && npm test` | **24/24 全绿**（auth 9 + entries 8 + sync 8 - healthz inject 1） |
| G3 | root typecheck | `npm run typecheck` | exit 0 |
| G4 | root vitest | `npm test` | 34/34 全绿（client 端不应受影响）|
| G5 | check:appjson | `npm run check:appjson` | exit 0 |
| G6 | check:tooling | `npm run check:tooling` | exit 0 |
| G7 | **check:whitelist（含规则 D）** | `npm run check:whitelist` | exit 0 + **新增规则 D 通过** |
| G8 | git diff 跨域校验 | `git diff HEAD -- miniprogram/ api/ infra/ design/` | **空**（backend 卡只动 server / scripts/devops / docs/qa）|
| G9 | 反向验证 1 | 临时删 `app.ts` prefix → check:whitelist | exit 1 |
| G10 | 反向验证 2 | 临时改 OpenAPI servers 去 `/v1` → check:whitelist | exit 1 |

---

## §5 强制阅读清单（subagent spawn 时 §G inline）

### §5.1 必读（按重要性）

1. **本派单档全文**（唯一执行依据）
2. `.team/follow-ups/README.md` 族 A · FU-105-CLIENT-SERVER-URL-PREFIX-MISMATCH 详档（根因 + scope + 决策记录）
3. `server/api/openapi.yaml` servers + paths 段（line 24-32 + 61~）
4. `server/src/app.ts` 现状（line 1-90）
5. `miniprogram/services/env.ts`（client `/v1` 已写对的事实证据）
6. `miniprogram/services/request.ts:135-143`（buildUrl 字符串拼接逻辑）
7. `server/test/{auth,entries,sync}.test.ts`（25 处 inject 全清单 · §2.1 表）
8. `scripts/devops/whitelist-check.mjs`（规则 A/B/C 现状 · 规则 D 在末尾追加）
9. `.codebuddy/agents/costra-backend-dev.md`（角色规则 + 工作区铁律）
10. `.team/decisions/D-014`（Card-Review 流程）+ `D-016`（同轮兑现）+ `D-017 v3`（验证问题 SOP）+ `D-018 v1.1`（SBAI）+ `D-022 v2.0`（评分表 + runtime 类铁律）

### §5.2 按需

- `.team/board.md` Sprint-2 段 + Orchestrator 状态
- `.team/reviews/COSTRA-104/round-1-tech.md`（D-022 v2.0 评分范式参考 · 36/40 APPROVE）
- `.team/reviews/COSTRA-105/round-1-tech.md`（D-022 v2.0 评分范式参考 · 40/40 满分）
- `docs/qa/costra-104-curl-verify.md` v1.4（修 v1.5 时只动 URL · 不动断言/步骤）
- `docs/qa/costra-105-human-smoke.md` v1.2（修 v1.3 时只动 BLOCKED 注记）

---

## §6 硬约束（不可违反）

### §6.1 工作区铁律（backend-dev §1 · COMMON-CONTRACT §0-Bis · G8 闸门）

- ✅ 可写：`server/src/` / `server/test/` / `server/scripts/dev/` / `scripts/devops/whitelist-check.mjs` / `docs/qa/` / `.team/follow-ups/README.md` / `.team/members/backend-dev/`
- ❌ 禁写：`miniprogram/` / `api/openapi.yaml`（**注意**：本卡不改 OpenAPI · 仅核对 servers 段 · OpenAPI 已含 `/v1` 是契约事实源）/ `infra/` / `design/` / `docs/PRD.md` / 其他 `.team/members/{role}/`

### §6.2 SBAI 装扮档铁律（D-018 §3.4）

- 一次性装扮 · 任务结束销毁
- 持久状态走 `.team/members/backend-dev/state.md`
- final message 必含：摘要 + 7 项 DoD 完成情况 + 10 项闸门结果 + state.md 已更新 + history 已落盘

### §6.3 D-016 同轮兑现（强制）

- 派单 → Card-Review R1 → R1 实装 → review-tech R1 在同一对话轮内连续 spawn
- **state/history 必须**和实装代码一起 commit（**不允许 D-016 反例第 8 次** · 议题 D-016 反例已升 P0）

### §6.4 D-017 v3 §2.4（验证问题响应 SOP）

- 若 R1 实装中遇到验证问题（如 fastify register prefix 在 fastify 5.x 行为不一致 · 或反向验证 G9/G10 不达预期）· 走 ① 责任领域识别 → ② 责任 Agent 根因分析 → ③ 多方案对比 → ④ Human 评估 → ⑤ 派单实装
- E1 例外路径（≤ 5 分钟单 commit）适用于：测试 url 字符串错字 / 文档锚点漂移 / inject url 漏改某行

### §6.5 D-022 v2.0 评分表（review-tech R1 时适用 · 40 分制）

| 维度 | 满分 | 本卡重点 |
|---|---|---|
| C1 合约合规 | 5 | 客户端 0 改动验证 / OpenAPI 0 改动验证 / fastify register prefix 与 OpenAPI servers path 一致性 |
| C2 架构正确 | 5 | healthz 保根 vs 业务路由进 prefix 的设计合理性 / register 嵌套用法对 |
| C3 数据处理 | 5 | inject test 24 处全改 + healthz 1 处保根 / 测试覆盖完整 |
| C4 同步时序 | 5 | server 启动顺序（先 healthz 后 v1 子作用域）合理性 |
| C5 安全性 | 5 | prefix 不影响 JWT decorator / errorHandler / CORS 行为 |
| C6 可测性 | 5 | 24/24 测试全绿 / 反向验证 G9/G10 通过 |
| C7 工程纪律 | 5 | typecheck / lint / G8 跨域 0 改动 / state/history 收尾完整（D-016 反例预防）|
| **C8 runtime 加载性** | 5 | C8-1 Human 实测 DoD（与 105 联合实测）/ C8-2 跨版本对照（fastify 5.x register prefix 行为）/ C8-3 SDK 假设标注（fastify register prefix 是 fastify 5.x 稳定 API · 标注）/ C8-4 错误路径 runtime 触达（404/healthz 仍走根） |

### §6.6 严守 INVEST small（2 点）

- 2 点 · ~ 60 分钟 R1 实装时间盒
- 若 fastify register prefix 用法或反向验证遇到困难 · 立即立 blocker · 不深陷
- whitelist-check 规则 D 用轻量正则 · 不要写 AST parser

### §6.7 不擅改 OpenAPI / client（事实源契约保护）

- OpenAPI servers 段已是契约事实源（COSTRA-020 G3 30/30 通过）· 不动
- client 端已写对 · 不动
- **本卡核心 = 让 server 实装服从既有契约**

---

## §7 提交（D-012 单卡即提交 · D-018 commit footer）

```
fix(backend): add v1 prefix to fastify register · serve openapi servers contract (COSTRA-156 R1)

- server/src/app.ts: register auth/entries/sync routes under prefix /v1
  (healthz preserved at root for k8s/slb liveness probe convention)
- server/test/{auth,entries,sync}.test.ts: 24 inject url paths add /v1
  (healthz inject at line 203 unchanged)
- server/scripts/dev/README.md: curl example URL add /v1
- docs/qa/costra-104-curl-verify.md: v1.4 -> v1.5 (8 curl URLs add /v1)
- docs/qa/costra-105-human-smoke.md: v1.2 -> v1.3 (remove BLOCKED notes)
- scripts/devops/whitelist-check.mjs: rule D (fastify prefix vs openapi servers path)
- .team/follow-ups/README.md: FU-105-... closed (resolved_by COSTRA-156)
- .team/members/backend-dev/state.md + history/2026-05-13-costra-156-r1.md

Refs: COSTRA-156, COSTRA-105
```

**husky hooks**：commit-msg commitlint subject 全小写 + body 行宽 ≤ 100 · pre-commit lint-staged

---

## §8 估点 / 时间盒

- **估点**：2 点
- **时间盒**：AI 流水（Card-Review + R1 实装 + Review）≤ 50 分钟
- **Human 终审排队**：156 review-tech APPROVE → 立即跑 105 + 156 联合实测（5 步 + H1~H5 全 PASS）→ 双卡 `approve:COSTRA-156` + `approve:COSTRA-105`

---

## §9 联合 Sprint-2 末 Retro 议题（156 完成后兑现）

- **议题 18 升 P0**：CI 漏检反模式（whitelist-check 规则 D 落地 · 兑现）
- **议题 19 升 P0**：server 单测 inject 反模式（议题待 Sprint-3 立 supertest + jest-openapi 真 HTTP 集成测试 · 不阻 156）
- **议题 20**：D-022 v2.0 C8-5 端到端契约联调可达性子项扩展（156 后归档证据）
- **🆕 D-023 立案候选**：OpenAPI servers prefix 与 fastify register prefix 强制一致性规约（FU-156-D023-DECISION · 议入 Retro 立决议）

---

## §10 终审收尾段（2026-05-19 09:27）

✅ **APPROVED · CLOSED**（Human T1 终审 · `approve:COSTRA-156`）

| 项 | 值 |
|---|---|
| 终审时间 | 2026-05-19 09:27 |
| 终审路径 | 联合 COSTRA-105 双卡同轮 approve（D-014 SOP · 联合实测时序）|
| R1 实装 commit | `edca8da`（2026-05-13 11:18 · 15 文件 +762/-75 行）|
| R1 review-tech | APPROVE 40/40（D-022 v2.0 第 4 次实战连续满分）|
| 联合 105 实测 | 方式 B 真链路 PASS · 156 R1 范围 100% 覆盖 · 0 回归 |
| 终审报告 | `.team/reviews/COSTRA-156/FINAL.md` |
| follow-ups | FU-105-URL closed · FU-156-OUTBOX-FLAKY 转 Sprint-3 |
| Sprint-2 进度 | 4/7 → **5/7**（联合 105）· 累计点数 14 → **22 / 47%→61%** |

**bug 守护范式**（154 实装时回归 SOP）：whitelist 规则 D 守门（fastify prefix vs OpenAPI servers path 静态对账）· 反向验证删 prefix exit 1 · server 单测 24 处 inject `/v1` 全部命中。
