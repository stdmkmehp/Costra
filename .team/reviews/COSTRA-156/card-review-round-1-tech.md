# COSTRA-156 卡定义 Review · Round 1 · Review-Tech

- **审核时间**：2026-05-13 10:55
- **审核人**：`costra-card-reviewer-tech`（审查 subagent · 一次性装扮 · D-018 §3.5 · 第 8 次实战）
- **卡主**：backend-dev（实装 subagent = `costra-backend-dev` · 第 2 次实装实战）
- **轮次**：1/3
- **分流归属**：Review-Tech（backend 技术向）
- **评分制**：SOP-CARD-REVIEW.md C1~C8（总 30 分 · 非 D-022 v2.0 40 分制）

---

## §1 卡定义快照

| 字段 | 值 |
|---|---|
| 卡号 | COSTRA-156 |
| 标题 | server 加 `/v1` prefix · 让实装服从 OpenAPI 契约（FU-105-CLIENT-SERVER-URL-PREFIX-MISMATCH 转正） |
| Owner | backend-dev |
| 估点 | 2 点 |
| 优先级 | P0 |
| 状态 | Todo（2026-05-13 10:35 立卡 · 等 Card-Review R1） |
| Sprint | Sprint-2（提前从 Sprint-3 拉入 · Human 决策"先 156 再 smoke 105"）|
| 依赖 | COSTRA-104（CLOSED）+ COSTRA-105（R1 review-tech APPROVE 40/40 等 Human 实测）|
| 下游解锁 | COSTRA-105 方式 B 真链路实测（步骤 D）+ COSTRA-150 client 调度器联调 |
| FU 关联 | FU-105-CLIENT-SERVER-URL-PREFIX-MISMATCH（族 A · P0 · Human 选方案 A） |

---

## §2 分项评分

| 项 | 满分 | 得分 | 备注 |
|---|---|---|---|
| C1 标题与描述清晰度 | 5 | **5** | 标题精准含 API prefix + 契约服从 + FU 转正三要素；描述含背景（根因三层）/目标（服从契约）/范围三要素；术语与既有卡一致 |
| C2 DoD 可度量 | 6 | **6** | 12 项 DoD（§3.1 主交付 5 + §3.2 副交付 2 + §3.3 协议对齐 3 + §3.4 防回归 2）· 每项含命令或文件路径 |
| C3 依赖识别 | 5 | **5** | 上下游清晰 · L1~L3 根因 + E1~E10 事实证据链完整 |
| C4 产出物具体 | 5 | **5** | 9 项 Scope 全含文件路径 + 行号 + 24 处 inject url 具体行号清单 |
| C5 风险与边界 | 4 | **3** | §6.5 C5 提 fastify register prefix 对 decorator/errorHandler/CORS 影响 · 但缺失败降级路径 + 性能边界 |
| C6 去重 | 3 | **3** | backlog 唯一占位 · 与 104/105 范围分位清晰 |
| C7 估点合理 | 2 | **2** | 2 点 vs 类似 fix 卡（124/126）合理 · INVEST small 守卫有效 |
| **总分** | **30** | **29** | **PASS**（≥27）|
| C8 红线 | 否决 | **Pass** | 无任何红线命中 |

---

## §3 问题清单

### P0：0 项 ✅
### P1：0 项 ✅

### P2-1 · 反向验证 G10 OpenAPI 改 servers 后 check:whitelist exit 1 与 §6.7 铁律循环

- **位置**：派单档 §4 闸门 G10 + §3.4 DoD 反向验证 (2)
- **问题**：G9（删 prefix → exit 1）可手工实测。但 G10 需要在"改 OpenAPI"状态下跑 check:whitelist · 与 §6.7"不擅改 OpenAPI"铁律存在逻辑循环
- **修复建议**：G10 改为静态验证 ——`grep` `server/api/openapi.yaml` servers[0].url 确认含 `/v1` path 段 · 用"读文件确认"代替"改文件重跑"
- **阻断级别**：P2（非阻塞 · backend-dev R1 可自行判断执行路径）

### INFO-1 · inject url "25 处"表述歧义

- 派单档 §1.2 E5 写"25 处"· §2.1 B/C/D 三表实际 24 处业务 + 1 处 healthz 保根
- **建议**：实装时用"24 处加 `/v1` + 1 处 healthz 保不变"措辞 · 防止 backend-dev 误把 healthz 也改

### INFO-2 · 联合实测时序应在 105 手册 v1.3 同步明示

- **位置**：派单档 §0 写"Human 终审 = 156 + 105 联合实测"
- **建议**：105 手册 v1.3 §10 修订记录加注："等 156 R1 review-tech APPROVE 后才能跑步骤 D"

---

## §4 backend 路由级 fix 卡特别核查（8 项）

### §4.1 客户端 0 改动铁律可行性 ✅

- 核对 `miniprogram/services/env.ts` line 17 `apiBaseUrl: 'http://localhost:8080/v1'` ✓ 已含 /v1
- 核对 `miniprogram/services/request.ts` line 142 `return ${base}${path}${q}` ✓ 字符串拼接
- 核对 `miniprogram/services/{auth,sync}.ts` path 字面量全部不含 /v1 ✓
- **结论**：156 后 client 实际请求拼出 `http://localhost:8080/v1/auth/wx-login` · server 加 prefix 后正好匹配 · client 0 改动铁律**可行 ✅**

### §4.2 OpenAPI 0 改动铁律可行性 ✅

- 核对 OpenAPI servers[0].url = `http://localhost:8080/v1` ✓
- 核对 OpenAPI paths 全部相对路径（如 `/auth/wx-login` 不含 /v1）✓
- **结论**：OpenAPI 已经写对 · 156 不需要改 OpenAPI 任何字段 · 0 改动铁律**可行 ✅**

### §4.3 healthz 保根设计合理性 ✅

- K8s/SLB liveness probe 业界通用习惯（Kubernetes Pod livenessProbe.httpGet.path 通常 `/healthz`）
- healthz 不在 OpenAPI paths 段 · 不属业务契约 · 不应进 v1 prefix
- 派单档 §2.1 A "healthz 保留根路径"论据成立
- **结论**：合理 ✅

### §4.4 fastify register prefix 嵌套用法语义稳定性 ⚠️ 中风险

- fastify 5.x register prefix 嵌套用法（`app.register(async (v1) => { ... }, { prefix: '/v1' })`）是**稳定 API**
- 但派单档 §6.5 C5 提到"prefix 不影响 JWT decorator / errorHandler / CORS"是**假设** · 需 R1 实测验证
- **关键风险点**：
  - JWT decorator 在根级注册（`registerJwt(app)`）· 子作用域 v1 是否能访问 `app.jwtVerify` decorator？fastify 文档说"decorator 自动继承到子作用域"应该 OK · 但需测试覆盖
  - errorHandler 在根级注册（`registerErrorHandler(app)`）· 子作用域 v1 抛错会冒泡到根 errorHandler 处理 · 应该 OK · 但需测试覆盖
  - CORS 也是根级 · 同上
- **建议**：R1 实装后 vitest 24/24 全绿即等于覆盖（auth/entries/sync 测试都需要 JWT + errorHandler + CORS 全链路）· 不需额外加测
- **结论**：风险**可控** · 通过 vitest 24/24 验证

### §4.5 inject url 25 处实清单准确性 ✅（INFO-1 措辞修正）

- grep 实测：auth.test.ts 9 处 inject url（含 1 个 `/healthz`）+ entries.test.ts 8 处 + sync.test.ts 8 处 = **25 处 inject 总数**
- 但本卡要改的是 24 处（auth 8 + entries 8 + sync 8）· healthz 那 1 处保根不变
- **结论**：派单档 §2.1 B/C/D 三表清单**准确 ✅**（"25 处"是总数 · "24 处加 /v1"是改动数 · INFO-1 仅措辞）

### §4.6 CI 规则 D 实装可行性 ✅

- 派单档 §2.2 F 提供正则 `/prefix:\s*(['"])(\/[^'"]*)\1/`
- 实测 `app.ts` 当前内容 · 该正则将命中 0 次（因为 R1 实装前没有 prefix）· 实装后命中 1 次（仅 `prefix: '/v1'` 字面量）
- 风险：若 backend-dev 在 routes/*.ts 用了 `prefix: '/xxx'` 会被误命中 · 但实测 routes/*.ts 全无 prefix 字面量
- 复杂度：~10~15 行 JS · INVEST small 守卫有效 · 不需 AST parser
- **结论**：可行 ✅

### §4.7 反向验证 G9/G10 可执行性 ⚠️ G10 见 P2-1

- G9（删 prefix → exit 1）：直接编辑 `app.ts` 删 prefix → `npm run check:whitelist` 应 exit 1 · revert 后 exit 0 · 可执行 ✅
- G10（改 OpenAPI servers 去 /v1 → exit 1）：与 §6.7 "不擅改 OpenAPI" 铁律冲突 · 见 P2-1 修复建议（改静态 grep 验证）
- **结论**：G9 可执行 · G10 改静态验证

### §4.8 D-016 反例预防 + 联合实测时序 ✅

- 派单档 §6.3 强调"state/history 必须和实装代码一起 commit · 不允许 D-016 反例第 8 次"
- 但 §3 DoD 中**未显式列**"state/history commit 完整性自检"项
- **建议**：DoD §3 末尾追加 1 项："commit 前运行 `git status -s | grep '.team/members/' | wc -l` = 0 · state/history 已 add"（议题 D-016 反例已升 P0 · 必须强制度量）
- 联合实测时序：派单档 §0 表清楚 156 + 105 联合实测 · 但 105 手册 v1.3 修订需同步明示（INFO-2）
- **结论**：核心铁律已设 · 度量项可补强（建议 R1 实装时 backend-dev 自觉补 DoD）

---

## §5 Verdict

**PASS** · 总分 **29/30**

理由：
1. 卡定义整体质量优秀（派单档 ~500 行结构完整 · 12 项 DoD 可度量 · 9 项 scope 具体到行号 · 6 项硬约束清晰）
2. C8 红线零命中 · INVEST small 守卫有效 · 客户端 0 改动 / OpenAPI 0 改动两条铁律可行性已核实
3. C5 轻微扣分（缺失败降级路径）+ P2-1 G10 反向验证逻辑循环（建议改静态 grep）+ INFO-1/2 措辞建议 · 均不阻断 R1 实装
4. 29/30 落 PASS 区间（≥ 27）· **不需要 Round 2 再审** · backend-dev R1 实装时一并参考 P2-1 / INFO-1 / INFO-2 即可

**给 Orchestrator 的指令**：直接进 R1 实装（派单 prompt §F 中追加：① G10 改静态 grep 验证；② "24 处加 /v1 + 1 处 healthz 保不变"措辞；③ 105 手册 v1.3 同步明示联合实测时序；④ commit 前自检 state/history）

---

## §6 强制阅读清单（给 backend-dev R1 实装时用）

按重要性排序（10 条）：

1. `.team/dispatch/COSTRA-156-backend-add-v1-prefix.md`（派单档 · 唯一执行依据）
2. `.team/follow-ups/README.md` 族 A · FU-105-CLIENT-SERVER-URL-PREFIX-MISMATCH（根因 + Human 决策）
3. `server/src/app.ts` 现状（line 1-90 · 含 register 顺序）
4. `server/api/openapi.yaml` line 24-32（servers 段 · 不动事实源）+ paths 段（line 61~ 验证不含 /v1）
5. `miniprogram/services/env.ts` line 17（client 已对 · 不动）
6. `miniprogram/services/request.ts` line 135-143（buildUrl 拼接逻辑）
7. `server/test/{auth,entries,sync}.test.ts`（24 处 inject 加 /v1 + healthz 1 处保根）
8. `scripts/devops/whitelist-check.mjs`（规则 A/B/C 现状 · 末尾追加规则 D · 轻量正则）
9. `.codebuddy/agents/costra-backend-dev.md`（角色规则 + bypassPermissions 红线 + 工作区铁律）
10. `.team/decisions/D-016`（同轮兑现 · state/history 必随 commit）+ `D-022 v2.0`（review-tech 评分维度）

**R1 执行特别关注**：
- fastify register prefix 嵌套用法不影响 JWT/errorHandler/CORS（vitest 24/24 全绿即覆盖）
- G10 用静态 grep 验证（不改 OpenAPI · 守 §6.7 铁律）
- 24 处 inject 加 `/v1` + healthz line 203 保不变
- commit 前自检 `git status -s | grep '.team/members/' | wc -l` = 0（state/history 完整性 · D-016 反例预防）
- 105 手册 v1.3 §10 修订记录加注"等 156 R1 review-tech APPROVE 后才能跑步骤 D"

---

## §7 自我反思

| 维度 | 值 |
|---|---|
| 审核耗时 | ~25 分钟（16 项必读全读 + 8 项特别核查） |
| 置信度 | **高**（client 0 改动 / OpenAPI 0 改动 / healthz 保根 三条核心假设均独立 grep 验证 · §4.1/§4.2/§4.3 全 PASS） |
| 低置信点 | §4.4 fastify register prefix 对 JWT decorator/errorHandler/CORS 的影响仅靠"vitest 24/24 即覆盖"假设 · 无独立 fastify 5.x 文档源 |
| 是否需 Human 二裁 | **否**（PASS 29/30 清晰 · P2-1/INFO 均建议性非阻断） |
| 轮次是否可能再审 | 否（backend-dev R1 时一并采纳 P2-1 + INFO-1/2 即可）|

---

## §8 报告元数据

- **审查 subagent**：`costra-card-reviewer-tech`（D-018 §3.5 · 一次性装扮 · 物理无写权 · 第 8 次实战）
- **本卡卡定义 Review 轮次**：Round 1/3
- **Verdict**：PASS
- **总分**：29/30
- **关键发现**：0 P1 · 1 P2（G10 静态 grep 替代）+ 2 INFO（措辞）· C8 红线 0 命中
- **下一步**：直接进 R1 实装（backend-dev 一并采纳 P2-1 + INFO-1/2）

---

*报告结束 · costra-card-reviewer-tech 一次性装扮销毁（2026-05-13 10:55）*
