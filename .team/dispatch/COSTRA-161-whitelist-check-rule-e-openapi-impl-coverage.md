# COSTRA-161 · whitelist-check.mjs 规则 E：OpenAPI paths vs fastify register 静态对账

> **派单时间**：2026-05-19 20:50（Orchestrator · Sprint-3 follow-up 转正 · FU-DEVOPS-OPENAPI-IMPL-COVERAGE 转正）
> **状态**：dispatch 已落盘 · 不主动 spawn · 等 Human 拍板启动（D-024 §2.3）
> **依赖**：COSTRA-156 规则 D 范式（commit `edca8da`）· COSTRA-154 已实装（消除一处 x-deferred）· COSTRA-152/153 实装后 OpenAPI x-deferred 进一步清理
> **下游解锁**：D-025 AP-003 契约-实装漂移自动检测 · 让"OpenAPI 早定义 server 没实装"反模式无处遁形 · CI 对账族第 6 张规则 E 落地

---

## §0 SBAI 装扮路径

| 阶段 | Subagent | 状态 |
|---|---|---|
| **Card-Review R1** | `costra-card-reviewer-tech` | 等启动 |
| **R1 实装** | `costra-devops-ops`（一次性装扮 · 单装扮档单 commit）| 等卡审 PASS |
| **R1 Review** | `costra-review-tech` | 等 R1 完成 |
| **Human T1 终审** | `approve:COSTRA-161` | 等 R1 APPROVE |

---

## §1 背景

### 1.1 触发链
- COSTRA-101（2026-04-24）OpenAPI 已定义 `/users/me` GET + PATCH · 但 server 路由从未实装 · 1 个月内无人发现 · 直到 COSTRA-158（2026-05-19）才补齐
- Sprint-2 末 Retro 议题 25 立 D-025 AP-003 契约-实装漂移
- COSTRA-156 规则 D（fastify prefix vs OpenAPI servers path）建立 CI 对账族第 5 张范式
- 本卡是规则 D 的扩展：路径维度静态对账 · 让 AP-003 自动检测

### 1.2 PRD / 契约锚点
- 无（CI 治理议题）
- D-025 §1 AP-003 立意：让"早定义晚实装"反模式无处遁形

---

## §2 Scope（4 项 · 估点 1 · INVEST small）

### 2.1 主交付

#### A · whitelist-check.mjs 加 reconcilePaths() 函数
- 解析 `server/api/openapi.yaml` 所有 paths
- 解析 `server/src/app.ts` + `server/src/routes/*.ts` 中 fastify register 调用
- 三方核验：
  - **OpenAPI 定义 + server 没 register** → exit 1（除非含 `x-deferred` 标记则降级 warning）
  - **server register + OpenAPI 没定义** → exit 1（防漂移反向 · OpenAPI 是契约真源）
  - **fastify prefix vs OpenAPI servers** → 已在规则 D 覆盖（保留）

#### B · 整合到 reconcile() 主函数
- `scripts/devops/whitelist-check.mjs` 现有规则 A/B/C/D + 新规则 E 一次性跑
- 输出：`✅ openapi-impl coverage: N/N paths matched · M deferred (warning)`

#### C · 反向验证脚本
- 临时改 OpenAPI 加一条 `/foo` path → exit 1 + 打印 missing impl
- 临时 server register `/bar` 但 OpenAPI 没 → exit 1
- revert 后 exit 0

#### D · follow-ups
- FU-DEVOPS-OPENAPI-IMPL-COVERAGE: open → closed @ COSTRA-161
- FU-154-X-DEFERRED-CI-CHECK: open → closed @ COSTRA-161（同源议题）

### 2.2 不在本卡范围
- ❌ paths 内参数 / response schema 字段级核验 → 留 FU-CI-SCHEMA-FIELD-COVERAGE
- ❌ x-deferred 自动闭合检查（实装后未删 x-deferred）→ 留 FU-CI-X-DEFERRED-CLEANUP

---

## §3 DoD（≥ 8 项）

6 闸门 + G7（reconcilePaths 反向验证 3 项）+ G15。

D-025 扫描预测：AP-003 工程支撑（第 6 次正向兑现 · 不命中本卡 · 但本卡是 AP-003 自动检测的工程实现）。

---

## §4 强制阅读清单

1. 本派单档 + Card-Review 报告
2. **现有 whitelist-check**：`scripts/devops/whitelist-check.mjs`（315 行 · 规则 A/B/C/D + assertIcpRecorded）
3. **OpenAPI**：`server/api/openapi.yaml`（含 x-deferred 3 处 · 154 实装后剩 entries PATCH/DELETE 共 2 处）
4. **fastify register 范式**：`server/src/app.ts:68-78` + `server/src/routes/*.ts`
5. **D-025 AP-003**：`.team/decisions/D-025-anti-patterns-clipboard.md §1`

---

## §5 硬约束

### §5.1 工作区铁律
- ✅ 可写：`scripts/devops/whitelist-check.mjs` · `package.json` scripts（如需新增 check 别名）· `.team/members/devops-ops/` · `.team/follow-ups/README.md`
- ❌ 不可写：server/ · miniprogram/ · openapi.yaml（仅核验 · 不修订）

### §5.2 INVEST small（1 点）
- 时间盒 ≤ 60 分钟

### §5.3 D-016 同轮兑现 · commit footer
- `closes: FU-DEVOPS-OPENAPI-IMPL-COVERAGE` + `closes: FU-154-X-DEFERRED-CI-CHECK`

---

## §6 估点 / 时间盒
- 估点 1 点 · AI ~1 小时 · Human 实测：本地 npm run check:whitelist exit 0 + 反向验证 3 项截图

---

**派单档结束 · 等 Human `start:COSTRA-161`（建议 154/152/153 全 CLOSED 后启动 · OpenAPI x-deferred 清零后规则 E 才有意义）。**
