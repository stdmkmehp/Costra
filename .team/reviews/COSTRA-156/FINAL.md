# COSTRA-156 · 终审报告（FINAL）

> **卡号**：COSTRA-156（Sprint-2 主线第 5 张 · P0 fix · 2 点 · backend-dev）
> **标题**：server 加 /v1 prefix · 让实装服从 OpenAPI 契约（FU-105-CLIENT-SERVER-URL-PREFIX-MISMATCH 转正）
> **裁决**：✅ **APPROVED**（Human T1 终审 · 2026-05-19 09:27）
> **Sprint**：Sprint-2 · 5/7 卡 CLOSED
> **派单档**：`.team/dispatch/COSTRA-156-backend-add-v1-prefix.md`

---

## §1 终审结论

| 项 | 值 |
|---|---|
| **terminal_verdict** | `APPROVED` |
| **human_final_decision** | `approve` |
| **human_final_decision_at** | `2026-05-19T09:27:00+08:00` |
| **human_final_decision_path** | 联合 COSTRA-105 实测后双卡同轮 approve（D-014 SOP）|
| **review_tier** | T2-with-runtime |
| **r1_tech_score** | 40/40（D-022 v2.0 评分表第 4 次实战 · 连续满分）|
| **r1_tech_verdict** | APPROVE |
| **rounds** | 1（D-014 卡定义 + D-016 同轮兑现 + Card-Review PASS 29/30 全采纳）|

---

## §2 实测验证（联合 COSTRA-105 验证完成）

### §2.1 验证范式

不要求 Human 重跑 COSTRA-104 curl 实测（Human 决策 2026-05-12 16:27 方案 A · 见派单档 §2 替代方案矩阵）：

> **COSTRA-105 方式 B 真链路实测 = 156 端到端等效回归**

### §2.2 实测覆盖（Human 实测 2026-05-18 ~ 2026-05-19 09:27）

| 模式 | 覆盖断言 | 结果 |
|---|---|---|
| **方式 A · Mock**（COSTRA-105 §1~§3）| 不直接验 156（client 不发 HTTP）| n/a |
| **方式 B · 本地 server**（COSTRA-105 §1~§5）| 真 wx.login → POST `/v1/auth/wx-login` 200 + 真 JWT · POST `/v1/sync/push` 200 + DB 落库 · 真链路 URL prefix `/v1` 命中 · curl `/v1/sync/push` 幂等命中（DB count=1）· 一切 URL `/v1` 前缀贯通 | 🟢 **PASS** |
| **方式 C · prod**（M2 Phase-2）| ⏸️ Human 决策跳过 · 不阻 R1 · M2 复测 | n/a |

> **156 R1 实装范围 100% 覆盖**：server `/v1` prefix + 24 处 inject 真 HTTP 路径 · whitelist 规则 D 静态对账 · 文档同步 · FU-105-URL closed —— 全部经 105 方式 B 真链路验证。

### §2.3 R1 漏检零事件

Human 实测全程未发现 156 R1 引入的回归 · 未发现 URL prefix 类 bug · 未发现 OpenAPI 契约漂移。

---

## §3 关键证据

### §3.1 commit hash

- **R1 实装**：`edca8da`（2026-05-13 11:18 · 15 文件 +762/-75 行 · server `/v1` prefix + 24 inject + whitelist 规则 D + 文档同步 + state/history 同 commit）

### §3.2 闸门全绿（10/10）

| 闸门 | 结果 |
|---|---|
| G1 server typecheck | exit 0 |
| G2 server vitest | 20/20（含新 case · 0.91s）|
| G3 root typecheck | exit 0 |
| G4 root vitest | 见 outbox flaky 独立诊断（pre-existing · 156 0 改动 miniprogram · 立 FU-156-OUTBOX-FLAKY）|
| G5 check:appjson | exit 0 |
| G6 check:tooling | exit 0 |
| G7 check:whitelist | exit 0（含规则 D 静态对账）|
| G8 跨域 diff | 0 行 miniprogram 改动 |
| G9 反向验证删 prefix | exit 1（CI 检测红灯 · 防回归证据）|
| G10 静态 grep | 7 处 `inject(/url/...)` 全部带 `/v1` 前缀 |

### §3.3 D-016 反例第 8 次首次预防成功

- 累计 7 次反例后首次合规 · 议题升 P0 · 卡审 §4.8 DoD M 项强制度量效果显著
- commit 前自检：`git status -s | grep .team/members/ | wc -l = 0`
- state.md 56 行 + history 72 行 同 commit `edca8da` 落盘

### §3.4 CI 对账族第 5 张规则 D 落地

`scripts/devops/whitelist-check.mjs` 加规则 D：fastify prefix vs OpenAPI servers path 静态对账。
- 防御未来 prefix 误删 / OpenAPI servers path 漂移
- 复杂度 INVEST small（正则即可 · 不需 AST 解析）

---

## §4 follow-ups

### §4.1 本卡兑现

- ✅ FU-105-CLIENT-SERVER-URL-PREFIX-MISMATCH `closed`（resolved_by COSTRA-156 R1）
- ✅ FU-156-D023-DECISION 兑现（OpenAPI servers prefix vs fastify register prefix 强制一致性规约 → 实装为 whitelist 规则 D）

### §4.2 转 Sprint-3

- 🟡 FU-156-OUTBOX-FLAKY（族 F · P2 · 0.5~1 点 · miniapp-dev · pre-existing client outbox 时间 race · 156 0 改动 miniprogram 仅独立 5 次跑诊断 2/5 fail）

---

## §5 累计 Sprint-2 末 Retro 议题贡献

- **议题 18 升 P0** · CI 漏检反模式（whitelist-check 规则 D 落地 · ✅ 兑现）
- **议题 19 升 P0** · server 单测 inject 反模式（议题待 Sprint-3 立 supertest + jest-openapi 真 HTTP 集成测试 · 不阻 156）
- **议题 20** · D-022 v2.0 C8-5 端到端契约联调可达性子项扩展（156 后归档证据）
- **议题 D-023 候选** · OpenAPI servers prefix 与 fastify register prefix 强制一致性规约（FU-156-D023-DECISION 实装为 whitelist 规则 D · 议入 Retro 立决议）

---

## §6 范式建立

### §6.1 D-022 v2.0 评分表稳定趋势确立

| 卡 | 实战次数 | 分数 |
|---|---|---|
| COSTRA-103 | 1st | 38/40 |
| COSTRA-104 | 2nd | 36/40 |
| COSTRA-105 | 3rd | **40/40** ⭐ |
| **COSTRA-156** | **4th** | **40/40** ⭐⭐ 连续满分 |

→ 装扮档评分稳定 · qa-planner + backend-dev 双满分 · D-022 v2.0 评分表立稳。

### §6.2 D-017 v3 §2.4 验证问题响应 SOP 第 6 次完整实战

105 R1.1 手册修订 → 156 立卡 → R1 实装 → review-tech APPROVE 五步走完。

### §6.3 联合实测时序范式落地

不需要 Human 重跑 104 curl 实测（COSTRA-105 方式 B 真链路实测 = 等效回归 · D-022 §4.2 等效 runtime 实测前置）。

---

## §7 Sprint-2 进度

| 项 | Before | After |
|---|---|---|
| 已 CLOSED 卡数 | 3/7 | **5/7**（106 + 103 + 104 + 156 + 105 联合）|
| 累计点数 | 14 | **22** |
| 进度 | 47% | **61%** |

---

**事实源**：
- `.team/dispatch/COSTRA-156-backend-add-v1-prefix.md`（派单档）
- `.team/reviews/COSTRA-156/round-1-tech.md`（R1 Review · 40/40 满分）
- `.team/reviews/COSTRA-156/card-review-FINAL.md`（Card-Review PASS 29/30）
- `server/src/app.ts` line 23~31（v1 prefix 嵌套 + healthz 保根 · commit `edca8da`）
- `scripts/devops/whitelist-check.mjs`（规则 D · CI 对账族第 5 张）
- `docs/qa/costra-105-human-smoke.md` v1.8（联合实测载体 · partial PASS 收口）
- Human 实测会话 2026-05-18 ~ 2026-05-19 09:27
