# COSTRA-105 · 终审报告（FINAL）

> **卡号**：COSTRA-105（Sprint-2 主线第 4 张 · P1 story · 3 点 · qa-planner）
> **标题**：单人记账闭环冒烟（含离线弱网）
> **裁决**：✅ **APPROVED-PARTIAL**（Human T1 终审 · 2026-05-19 09:27 · partial PASS · H6 BLOCKED-BY-COSTRA-154 自动等效回归）
> **Sprint**：Sprint-2 · 4/7 卡 CLOSED（联合 156 = 5/7）
> **派单档**：`.team/dispatch/COSTRA-105-qa-single-user-smoke-offline.md`

---

## §1 终审结论

| 项 | 值 |
|---|---|
| **terminal_verdict** | `APPROVED-PARTIAL`（H1~H5 🟢 全 PASS · H6 🔴 BLOCKED-BY-COSTRA-154 · 不阻 R1 双卡 approve）|
| **human_final_decision** | `approve` |
| **human_final_decision_at** | `2026-05-19T09:27:00+08:00` |
| **human_final_decision_path** | 联合 COSTRA-156 双卡同轮 approve（D-014 SOP）|
| **review_tier** | T1-with-runtime（D-022 §4.1 runtime 类 T2 卡 Human 实测前置铁律）|
| **r1_tech_score** | 40/40（D-022 v2.0 评分表第 3 次实战 · 首次满分）|
| **r1_tech_verdict** | APPROVE |
| **rounds** | 1（D-014 卡定义 + D-016 同轮兑现 · R1 实装 + 后续多轮文档版本迭代 v1.0→v1.8）|

---

## §2 实测验证结果（D-022 §4.1 真兑现立意）

### §2.1 实测覆盖矩阵

| 模式 | 步骤 A | 步骤 B | 步骤 C | 步骤 D.1 | 步骤 D.2 | 步骤 E | 硬断言 |
|---|---|---|---|---|---|---|---|
| **方式 A · Mock** | 🟢 PASS | 🟢 PASS | 🟢 PASS | n/a | n/a | n/a | H1 + H2 + H3 + H5 |
| **方式 B · 本地 server** | 🟢 PASS | 🟢 PASS | 🟢 PASS | 🟢 PASS（BUG-001/002 修复后）| 🔴 **BLOCKED-BY-COSTRA-154** | 🟢 PASS（H4 命中）| H1~H5 全绿 |
| **方式 C · prod** | ⏸️ M2 | ⏸️ M2 | ⏸️ M2 | ⏸️ M2 | ⏸️ M2 | ⏸️ M2 | M2 复测 |

### §2.2 H1~H6 硬断言裁决

| # | 硬断言 | 验证位置 | 实测结果 |
|---|---|---|---|
| **H1** | 冷启 TTI ≤ 2s + Launch Time ≤ 900ms（3.8.12 基线）| §1 A1 | 🟢 **PASS** · A/B 双跑命中 |
| **H2** | `entry:__index` 离线写入持久化不丢 | §3 C2 | 🟢 **PASS** · A/B 双跑命中 |
| **H3** | `outbox:__index` 多 key 分片正确 | §3 C3+C4 | 🟢 **PASS** · A/B 双跑命中 |
| **H4** | idempotency 重放不重复入账（DB count=1）| §5 E3 | 🟢 **PASS** · 方式 B curl 直打 idempotency_keys 缓存命中 + DB count=1 + server_id 一致 |
| **H5** | payload 100% snake_case | §2 B4 + §5 E4 + §4.2 D2.4 三覆盖 | 🟢 **PASS** · A/B 跨断言命中 |
| **H6** | client 离线写入 → push → **冷启 pull 回**显示与输入完全一致 | §4.2 D2.2+D2.3 | 🔴 **BLOCKED-BY-COSTRA-154**（GET /sync/pull 501 NOT_IMPLEMENTED · COSTRA-104 R1 主动切出 stub · OpenAPI `x-deferred: COSTRA-154` 已显式声明 · server 单测 T7 已守护契约 · 154 实装后等效回归）|

### §2.3 partial PASS 不阻 R1 双卡 approve 依据

1. ✅ **OpenAPI `x-deferred` 显式声明**（契约层透出 stub 范围 · COSTRA-104 切出去 3 件套铁律实战合规）
2. ✅ **server 单测 T7 已守护 stub 契约**（154 实装时 CI 自动失败 → 强制更新）
3. ✅ **范式同款**：v1.4 `BLOCKED-BY-COSTRA-156` 等 156 实装即回归 PASS（commit `edca8da`）· 本次 154 路径完全对称
4. ✅ **R1 已 PASS H1~H5**（核心承诺：冷启 + 本地写入 + outbox 多 key 分片 + 幂等 + 端到端 ≤ 3s 全命中）

### §2.4 D-022 §4.1 真兑现立意

> **自动化 + curl + server 单测 30+ 全绿，但 Human 真链路实测 ~30 分钟内捕获 5 个发现** ——
> - 4 个**文档级 gap**（v1.6 已修订）：
>   1. Console 沙箱禁用 require → 改 wx.request fallback 5 步范式
>   2. storage Envelope `{v,t,d}` 包装（`outbox:__index` 返回需 `.d` 解包）
>   3. token 数据模型双层嵌套 `tokenEnv.d.raw.access_token`
>   4. DB 列名 `version` vs 协议字段 `server_version` + SQL 用 `client_ref_id`（不依赖 note）
> - 1 个**联合 P0 真 BUG 双责**：
>   - **BUG-001**（client）`pages/entry/index.ts` line 57+73 硬编码 `ledger_id: 'default'` 字符串字面量
>   - **BUG-002**（server）`routes/sync.ts` line 93 payload schema `additionalProperties: true` 不校验 UUID format → PG 22P02 冒泡 INTERNAL 500

→ **D-022 §4.1 runtime 类 T2 卡 Human 实测前置铁律真正立意首次实测真兑现**：集成层 bug + 文档 gap 唯一手动捕获路径。

---

## §3 R1 + R1.x 关键证据

### §3.1 R1 实装 commit

- **`c046d25`**（2026-05-12 14:55 · R1 实装 6 文件 +1143 行）：strategy.md + cases + human-smoke.md v1.0 + automation 形式② + wechat-review + FU-105
- **`73d38d6`**（state/history 补 commit · D-016 反例第 7 次 · 议入 Sprint-2 末 Retro 升 P0）

### §3.2 手册迭代版本链（v1.0 → v1.8）

| 版本 | 时间 | 触发 | 核心修订 |
|---|---|---|---|
| v1.0 | 2026-05-12 14:55 | qa-planner R1 首次实装 | 5 步 + H1~H5（277 行）|
| v1.1 | 2026-05-12 16:1x | Human 反馈 | §0 三模式前置完整重写 + 各步骤模式适用矩阵 + URL prefix mismatch 警示 |
| v1.2 | 2026-05-13 10:25 | URL mismatch 决策 A | 委托 COSTRA-156 修复 |
| v1.3 | 2026-05-13 11:30 | 156 R1 APPROVE | 10 处 BLOCKED 注记清除 + INFO-2 联合时序明示已兑现 |
| v1.4 | 2026-05-13 13:5x | curl vs 小程序连 server 价值边界 | 步骤 D 拆 D.1 + D.2 · §6 H1~H5 → **H1~H6** · SU-004 拆 A/B · 十类覆盖 |
| v1.5 | 2026-05-18 18:4x | D-023 域名收敛 costra.cloud | 方式 C 升级 + R-020 自检 3 项强制 |
| v1.6 | 2026-05-18 19:5x | Human 实测 4 文档 gap + 1 P0 BUG | wx.request fallback 5 步范式 + Envelope `.d` + token `.d.raw.access_token` + DB 列名 + 实测期真 BUG 处置 SOP |
| v1.7 | 2026-05-18 20:1x | 精简整理 | -38%（846→525 行）· 删冗 + 合矩阵 + 合 Pass/Fail |
| **v1.8** | **2026-05-18 20:4x** | **Human 实测收尾** | **顶层加状态表 + USER_ID 占位歧义修正两步范式 + §4.2 D.2 BLOCKED-BY-COSTRA-154 + §6 partial PASS 收口口径** |

### §3.3 R1.x BUG 双修 commit（2026-05-18）

- **`33dbdea`**（R1.x.1 miniapp-dev BUG-001）：`pages/entry/index.ts` 硬编码 `ledger_id: 'default'` → `getApp().globalData.activeLedgerId || FALLBACK_LEDGER_ID`（`00000000-0000-0000-0000-000000000001` seed 默认）· `app.ts AppGlobalData` 加 `activeLedgerId?: string`
- **`db488b9`**（R1.x.2 backend-dev BUG-002）：`routes/sync.ts` payload schema 加 `properties.ledger_id format: 'uuid'` + `category_id format: 'uuid'` + 加 T9 单测 case `rejects-non-uuid → 400 INVALID_ARGUMENT` · 25/25 全绿
- **`9be5e84`**（R1.x.1 state/history 补漏 · D-016 反例第 9 次触发 + 补救 · 议入 Sprint-2 末 Retro）
- **`16fd1a0`**（手册 v1.7→v1.8 + D2 pull 501 BLOCKER 缺陷单 + HANDOFF v1.15）

### §3.4 闸门全绿（6/6 + 1 N/A）

| 闸门 | 结果 |
|---|---|
| G1 typecheck | exit 0 |
| G2 vitest 34+25 | 全绿（含 T9 新 case · 25/25）|
| G3 check:appjson | exit 0（10 pages tabBar 4/4）|
| G4 check:tooling | exit 0（3 rules）|
| G5 check:whitelist | exit 0（4 envs 3 urls + 规则 D）|
| G6 跨域 diff | 0 行业务代码（doc-only + 0 协议改动）|
| G7 automation syntax | SKIP（形式 ② README + 伪代码）|

---

## §4 缺陷单清单

### §4.1 已闭合（BUG-001/002）

`qa/defects/2026-05-18-COSTRA-105-D1-real-test-findings.md`（412 行 · 双责 miniapp-dev + backend-dev · R1.x.1+R1.x.2 同轮兑现）

### §4.2 BLOCKED-BY 转 Sprint-3

`qa/defects/2026-05-18-COSTRA-105-D2-pull-501-blocker.md`（D.2 pull 501 BLOCKER · 关联 COSTRA-154 · 154 实装时按 SOP §3.3 回归本卡 D.2 + H6）

---

## §5 follow-ups 转 Sprint-3

| FU-ID | 优先级 | 候选卡 | 状态 |
|---|---|---|---|
| **FU-104-SYNC-PULL** | **P0** | **COSTRA-154**（5 点 · 与 COSTRA-150 client 调度器一同做才有意义）| open · **BLOCKED-BY** 本卡 H6 自动回归 |
| FU-103-CLIENT-SYNC-SCHEDULER | P1 | COSTRA-150（5 点）| open（不阻本卡）|
| FU-105-AUTOMATION-FULL-COVERAGE | P2 | COSTRA-155（5 点 · 全量 14 用例自动化 + CI 集成）| open |
| FU-105-DEV-CONSOLE-HOOK | P3 | Sprint-3 头部 miniapp-dev（候选 COSTRA-150 顺带）| open |

---

## §6 范式建立（5 项）

### §6.1 D-022 §4.1 真兑现立意首次实测

**自动化 + curl + server 单测 30+ 全绿，但 Human 真链路实测 ~30 分钟内捕获 5 个发现**（4 文档 gap + 1 联合 P0 BUG 双责）—— 集成层 bug + 文档 gap **唯一手动捕获路径**。

### §6.2 partial PASS 双卡 approve 范式

`BLOCKED-BY-COSTRA-{N}` 范式确立：当本卡断言依赖未实装的下游 stub（OpenAPI `x-deferred` 已声明 + server 单测已守护契约 + 不阻核心承诺）时，可标 partial PASS 双卡 approve 放行 · 等下游卡实装后等效回归。

- v1.4 `BLOCKED-BY-COSTRA-156` 范式同款
- 本次 v1.8 `BLOCKED-BY-COSTRA-154` 第 2 次实战

### §6.3 D-017 v3 §2.4 E1 例外路径多次实战

R1.x.1 + R1.x.2 同轮兑现 · ≤ 1h 单 commit 收尾 · BUG-001/002 双修。

### §6.4 实测期真 BUG 处置 SOP（v1.6 新增 · 手册载体）

1. 不停实测（用 console 临时覆盖继续 · 拿断言通过证据）
2. 立 P0 BUG 单
3. 派双责 R1.x（D-017 v3 §2.4 E1 例外路径）
4. 不阻断后续步骤（独立验证路径可继续）

### §6.5 D-016 反例第 9 次触发 + 补救

miniapp-dev R1.x.1 自报告 ✅ 但 state/history 未同 commit · `9be5e84` 补漏。议入 Sprint-2 末 Retro：subagent §4.8 DoD M 项强约束改为 `git status .team/members | wc -l = ops 总改动数`（不是 0）。

---

## §7 累计 Sprint-2 末 Retro 议题贡献

105 联合本轮共贡献 **5 项议题**：

- **议题 18 升 P0** · CI 漏检反模式（whitelist-check 规则 D 落地 · ✅ 156 兑现）
- **议题 19 升 P0** · server 单测 inject 反模式
- **议题 20** · D-022 v2.0 C8-5 端到端契约联调可达性子项扩展
- **议题 D-016 反例第 9 次** · subagent §4.8 DoD M 项强约束升级
- **议题 实测期 BUG 处置 SOP** · 派单档 §X 立模板（避免每次 ad-hoc）

---

## §8 Sprint-2 进度

| 项 | Before | After |
|---|---|---|
| 已 CLOSED 卡数 | 3/7 | **5/7**（106 + 103 + 104 + 156 + **105**）|
| 累计点数 | 14 | **22** |
| 进度 | 47% | **61%** |

---

**事实源**：
- `.team/dispatch/COSTRA-105-qa-single-user-smoke-offline.md`（派单档）
- `.team/reviews/COSTRA-105/round-1-tech.md`（R1 Review · 40/40 满分）
- `.team/reviews/COSTRA-105/card-review-FINAL.md`（Card-Review PASS-WITH-FOLLOWUP 26/30）
- `docs/qa/costra-105-human-smoke.md` v1.8（实测载体 · partial PASS 收口）
- `qa/defects/2026-05-18-COSTRA-105-D1-real-test-findings.md`（D.1 BUG-001/002 已修）
- `qa/defects/2026-05-18-COSTRA-105-D2-pull-501-blocker.md`（D.2 BLOCKER · 关联 COSTRA-154）
- Human 实测会话 2026-05-12 ~ 2026-05-19 09:27（跨 7 天 · 多轮迭代）
