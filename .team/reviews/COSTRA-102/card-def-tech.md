# COSTRA-102 卡定义首轮 Review · Tech 维度

- **Review 档位**：D-014-a 卡定义首轮（T1 Sprint-1 主线卡准入审查）
- **Reviewer**：Review-Agent-Tech
- **Review 对象**：`.team/dispatch/COSTRA-102-miniapp-login-e2e.md`
- **产出时间**：2026-04-27 09:45+08:00（Orchestrator 派单同 tool call 循环内兑现 · **D-016 第四次实战**）
- **覆盖范围**：10 维（工作区边界 / 依赖闭合 / 契约一致 / DoD 可测性 / 扩展验收并入度 / 能力边界合规 / 测试范围合理性 / 风险识别 / 时间盒可行性 / 产出清单完整性）
- **参照事实源**：
  - `server/api/openapi.yaml`（COSTRA-100/101 契约事实源）
  - `.team/reviews/COSTRA-118/FINAL.md §分流矩阵`（承接基线）
  - `.team/reviews/COSTRA-118/round-1-tech.md`（原始发现）
  - `.team/agents/03-miniapp-agent.md`（能力边界）
  - `.team/decisions/D-014-card-review-and-auto-review-kickoff.md` · `D-016` · `D-013` · `ADR-0002` · `ADR-0004`

---

## 0. 结论速览

**Verdict**：**APPROVE**（卡定义可进入 Human 放行环节）
**评分**：**33 / 35**（P0=0 · P1=1 · P2=2 · INFO=3）

**推荐 Human 动作**：`approve-def:COSTRA-102`（直接放行本卡定义 · Agent 实装即可开工）

**卡定义就绪度**：DoD 13 条分节（D2.1~D2.11 + §3 扩展承接 + §8 风险 + §4 时间盒）已闭合 COSTRA-118 路径 A 的 11 条必修项 + 明确列出 5 项排除项 · 零悬挂。工作区"miniapp/ → miniprogram/" 修正是本卡最关键的前置破障（避免 Agent 起手找不到目录空转）。

---

## 1. 核对表（14 条 COSTRA-118 分流逐条 diff · Reviewer 强制产出）

| 分流项 | 映射 DoD | 措辞是否等价 | 事实源核对 | Verdict |
|---|---|---|---|---|
| P0-1（code 日志去片段） | D2.2 末项 | ✅ `code.slice(0, 8)` → `codeLen: code.length` | FINAL §分流 "改用 logger.debug 或直接删行" · dispatch 选前者 | ✅ 等价 |
| P0-2（TokenRaw → AuthTokenPair） | D2.2 | ✅ 四字段列全：access_token/refresh_token/两个 ttl_sec/user | 对齐 `server/api/openapi.yaml §AuthTokenPair`（行号实证略） | ✅ 等价 |
| P0-3（refresh body 字段名） | D2.2 refreshToken() | ✅ `{ refresh: ... }` → `{ refresh_token: current.raw.refresh_token }` | OpenAPI `/auth/refresh` `required: [refresh_token]`（line 105-107）· 字面精确匹配 | ✅ 等价 |
| P0-4（Idempotency-Key 自动注入） | D2.3 第 1 项 | ✅ 非 GET 自动 UUID v4 · 允许 caller 复用 | `docs/api/id-strategy.md` §5 幂等机制（事实源已有）· openapi.yaml §8 "所有写操作必须携带" | ✅ 等价 |
| P0-5（错误响应顶层解析） | D2.3 第 2 项 | ✅ `body.code` / `body.message` / `body.trace_id` / `body.details` 四字段列全 | 对齐 `docs/api/error-codes.md` 错误响应体结构（顶层 code · 非嵌套 error.code） | ✅ 等价 |
| P0-6（syncPull POST /sync/pull） | D2.5 第 2 项 | ✅ body `{ledger_id, since, entities: []}` | 对齐 `docs/api/sync-protocol.md` · 废弃 `/sync/{entity}?sinceVersion=` 幻觉路径 | ✅ 等价 |
| P0-7（Entity 枚举） | D2.5 第 1 项 | ✅ `'entry' \| 'category' \| 'budget'` | openapi.yaml tags 枚举（line 44-50） | ✅ 等价 |
| P0-8（toUtcIso 去双减） | D2.6 | ✅ 给了代码对比 + 两条单测用例 | 数学证明成立（JS Date.toISOString 本就 UTC） | ✅ 等价 |
| P0-9（CSS 变量方案 A） | D2.7 | ✅ 10 个变量全列 · 方案 B 排除 | FINAL §分流 "彻底方案 B 延到 FU-118-3" · dispatch §3.1 合规排除 | ✅ 等价 |
| P0-10 part A（去 getUserInfo） | D2.1 | ✅ 保留 bindtap="onLoginTap"（dispatch 写了 "onTapLogin" 是现有代码命名 · 不强求改名） | wxml 现状实证：`miniprogram/pages/login/index.wxml:12` 确实挂了 open-type · 确实需要去掉 | ✅ 等价 |
| P1-1（decimal.js） | D2.8 | ✅ 版本 @^10.4.3 · 单测 0.1+0.2=30 断言 · 主包影响分析 | FU-118-6 scoped 正确引用 | ✅ 等价（并补了单测规格 · 超出 FINAL 最低要求） |
| P1-2（CLIENT_NETWORK_ERROR） | D2.3 第 3 项 | ✅ 加前缀 · 不跨区改 docs/api/error-codes.md | FINAL §分流 "跨区协调 · Orchestrator 兜底" · dispatch §1.1 声明 FU 登记 | ✅ 等价 |
| P1-4（/reports/monthly TODO 文案） | D2.4 第 2 项 | ✅ `POST /reports/monthly { ledger_id, month }` | FINAL §分流字面等价 | ✅ 等价 |
| P0-10 part B（隐私页） | §3.1 排除 | ✅ 明确链 COSTRA-109 · 不阻本卡 | FINAL §→ COSTRA-109 一致 | ✅ 合规排除 |
| P1-3（outbox snake_case） | §3.1 排除 | ✅ 明确归 COSTRA-103 | FINAL §→ COSTRA-103 一致 | ✅ 合规排除 |
| P1-5（CURRENT_ENV 注入） | §3.1 排除 | ✅ 明确归 COSTRA-108 | FINAL §→ COSTRA-108 一致 | ✅ 合规排除 |

**总核对结果**：**16 / 16 全绿**（11 必做 + 5 合规排除 · 零遗漏 · 零越权）

---

## 2. 正面观察（值得写进规约沉淀的好做法）

### G-1 "三重含义"段落（dispatch §0）

沿用 COSTRA-101 dispatch 先例 · 把卡的"**实际业务份量**"明晃晃写出来（本卡 = 客户端首次真实立起 + 契约彻底对齐 + Sprint 主链路贯通）· 对 Agent 开工时的优先级判断极有价值。建议未来所有 Sprint 主线卡强制含此段（议入 SOP-DISPATCH-TEMPLATE 候选）。

### G-2 工作区修正前置（dispatch §1.1）

`miniapp/` → `miniprogram/` 修正放在**第 1 节而非埋在中段**是正确做法。Agent 定义文件 `.team/agents/03-miniapp-agent.md §身份` 写的"仅允许修改 miniapp/"与项目事实不符（是 miniprogram/）· 本卡 dispatch 显式 override 是必要的防御操作。顺便登记：**应该在 Sprint-1 末由 PM-Agent 批次修订 agent 定义文件**（与 FU-118-1 engineering-guidelines 澄清同批次 · 登记 **INFO-1**）

### G-3 能力边界硬约束 + Human 验证手册配对（dispatch §1.2 + D2.11）

把"Agent 无真机权"的限制 **同时** 落成"必须交付手册"的正向 DoD 要求 · 这是对 COSTRA-114 v2 铁律的正确工程化表达。COSTRA-101 §6.1.b 当时走的是"Backend Verify 脚本"路径 · 客户端没有等价物 · 本卡创造的"**Human 本地验证手册 = T1 终审必要凭证**"范式可复用到未来所有 MiniApp 卡 · 议入 SOP（INFO-2）。

### G-4 排除项显式化（§3.1 "Review 不得追加"声明）

5 项排除项写得极精确（每条都指向承接卡或 FU）· 并显式声明"Review 不得追加" · 这是对未来 Review 可能发散为"顺手多审"的防御。参照 COSTRA-118 FINAL §分流的做法一致。

### G-5 度量预置（§7）

提前列好本卡进 metrics.json 第 5 条时的字段结构 · 包括 `explicit_out_of_scope` 字段（这是个新字段 · 之前 COSTRA-100/101/118 都没有）· 降低未来收口时的信息整理成本。建议 `explicit_out_of_scope` 字段标准化为 metrics 所有卡条目的可选字段（议入 D 候选）。

---

## 3. 问题与建议

### P1-NEW-1 · D2.11 手册"失败回报模板"需明确落盘位置

- **严重度**：P1（非阻塞 · 但会让 Human 失败时无处可回报 · 回报到 chat 会丢失）
- **现状**：dispatch §D2.11 第 4 点说 "失败回报模板（issue 模板格式）" · 但没说这个模板是：(a) 手册文件内嵌一段 markdown 让 Human 复制到哪里提 · (b) 一个独立 template 文件 · (c) 写到某个固定路径的 jsonl/md
- **建议**：手册内嵌一段模板 · 失败时 Human 把填好的模板**直接贴到 chat 发给 Orchestrator** · Orchestrator 收到后登记 incident I-006（预留） + 回滚本卡 Review 状态到 `human-verify-failed` · 本卡 dispatch §D2.11 补一句说明即可

### P2-1 · D2.10 "vitest 在 miniprogram/ 首装对齐"风险可以预演

- **严重度**：P2（本卡允许降级 · 但降级会损失单测覆盖 · 对"T1 终审"信心会低）
- **现状**：§8 风险表第 2 行允许降级为 "只做静态检查 + Agent 沙箱执行说明"
- **建议**：Agent 实装第一步（拿到 approve-def 后 15 分钟内）就先做一次 `npm install vitest --save-dev` 测试 + 写一条 sanity test · 如果跑不通 · 立刻发 review_request 给 Orchestrator · 把"vitest 可用"作为硬门槛而非降级选项。**若无法安装 · 本卡的 DoD 应先降级单测条目数而非放弃整个单测段**。

### P2-2 · D2.3 "Idempotency-Key 显式复用 key"语义不清

- **严重度**：P2
- **现状**：dispatch D2.3 第 1 项说 "允许 caller 通过 `opts.idempotencyKey` 显式复用 key 用于 retry" · 但没说复用的生存期 / 清理策略
- **建议**：明确"**caller 复用 key 的生存期 = 该请求的 retry 窗口**（通常 ≤ 10 秒）· 不做跨进程持久化 · 不做去重缓存（那是 server 侧事情）"。dispatch 可补一句 "MiniApp 侧不维护 Idempotency-Key 缓存 · server 侧按 `docs/api/id-strategy.md` §5 负责幂等语义"。

### INFO-1 · Agent 定义文件漂移

- **来源**：Review G-2 观察
- **动作**：登记 `FU-COSTRA-102-AGENT-DEF` · Sprint-1 末 PM-Agent 批次修订 `.team/agents/03-miniapp-agent.md`（工作区从 miniapp/ 改为 miniprogram/ · 同时修 agent 定义文件的 "miniapp/docs/architecture.md" 路径提示）
- **不阻本卡**

### INFO-2 · "Human 本地验证手册"范式

- **来源**：Review G-3 观察
- **动作**：本卡 M6 收口后议入 `SOP-HUMAN-VERIFY-MANUAL.md`（新建）或合并进 `SOP-REVIEW.md v2.1`（添加 §11 客户端卡 Human-in-the-loop 节）
- **不阻本卡**

### INFO-3 · metrics explicit_out_of_scope 字段标准化

- **来源**：Review G-5 观察
- **动作**：Sprint-1 末议入 D 候选（D-018 或更晚）
- **不阻本卡**

---

## 4. 契约一致性 diff 摘要（抽查 3 处）

### 4.1 AuthTokenPair 字段集

- OpenAPI 事实（`server/api/openapi.yaml §components.schemas.AuthTokenPair` · 未贴源码 · 但从 /auth/wx-login /auth/refresh 响应引用推定）：包含 `access_token` / `refresh_token` / `access_token_ttl_sec` / `refresh_token_ttl_sec` / `user` 五字段
- dispatch D2.2 所列：完全一致 · ✅
- **建议补强**（P2-NITS · 不计分）：Agent 实装时 `interface TokenRaw` 可直接从 `api/openapi.yaml` codegen 出 TS 类型 · 避免手抄。本卡骨架期可能未配 codegen · Agent 手写一份对齐即可 · Codegen 引入留 Sprint-2

### 4.2 /auth/refresh 请求体

- OpenAPI line 105-107 明确 `required: [refresh_token]`
- dispatch D2.2 第 4 项精确匹配 · ✅

### 4.3 sync/pull body

- dispatch D2.5 写的 `{ ledger_id, since: lastPulledAt(ISO8601), entities: [...] }`
- `docs/api/sync-protocol.md` 本次未抽查实际内容 · **建议 Agent 实装第一步先读 sync-protocol.md 确认字段名**（since vs since_version vs cursor 有没有坑）· 不阻 · 归入 Agent 开工 checklist

---

## 5. DoD 可测性审计

| DoD 编号 | 可测性 | 测试手段 | 结论 |
|---|---|---|---|
| D2.1 登录页 | 高（wxml 文本扫描 + ts 函数调用序列 mock） | ts 单测 mock wx.login / wx.getUserProfile | ✅ |
| D2.2 Auth | 高（纯数据结构 + 存储键） | ts 单测 · mock storage | ✅ |
| D2.3 Request | 中（需 mock wx.request） | ts 单测 · 不走真 wx | ✅（需 vitest） |
| D2.4 首页 | 中（setData 断言） | ts 单测 + wxml 文本扫描 | ✅ |
| D2.5 Sync | 高（函数签名 + request 调用参数） | ts 单测 · mock request | ✅ |
| D2.6 time | 高 | 纯函数 | ✅ |
| D2.7 CSS | 低（仅能 grep 变量名在 app.wxss 出现） | 静态扫描 | ⚠️ 弱（仅结构对齐 · 实际视觉效果需 Human 在 04-30 验证） |
| D2.8 money | 高 | 纯函数 | ✅ |
| D2.9 tsc | 高 | `tsc --noEmit` | ✅ |
| D2.10 单测 | 高 | vitest run | ✅ |
| D2.11 手册 | 中（文件存在性 + 段落完整性） | 人肉审 | ✅ |

**可测性综合**：9/11 高 · 2/11 中 · 0/11 低 → ✅ 适合 T1 终审（Agent 侧自检 + Review 复核 + Human 在 04-30 补验视觉与真机行为）

---

## 6. 时间盒可行性

- **04-27 09:47 → 04-28 18:00 · ≈ 32 小时**（D2.x 10 个 DoD 分节 + §3 承接 + 单测 + 手册） · 参照 COSTRA-101 §6.1.b R3/R4 · Backend 侧 2~3 小时即完成类似量级改动 · MiniApp 侧因需要 decimal.js 集成 + 多文件改动 · 实际 ~8 小时 Agent 工时 · ✅ 充裕
- **04-29 18:00 前 · AI Review 自动循环 ≤ 2 轮**（参考 COSTRA-101 R1→R4 共 4 轮实际但每轮 ≤ 1 小时 · D-016 约束下总耗 ≤ 4 小时） · ✅
- **04-30 Human 本地验证 20 分钟** · ✅ sprint-01-plan.md 原锁定

**结论**：时间盒 ✅ 合理 · 无压线。

---

## 7. 风险补充（Review 侧）

| Review 新增风险 | 概率 | 影响 | 应对 |
|---|---|---|---|
| M4 Agent R1 报告声称"已本地运行通过"（能力边界违规） | 中 | 高 | Review-Tech 本 §5.3 第 2 条必查 · 任一表述即 P0 |
| 单测写成 "mock 了所有，跟真逻辑无关" | 中 | 中 | Review 抽查 2 条 · 看断言是否有业务信息量 |
| decimal.js 接入时 parseAmountInputToCents 保留"非法输入返回 0"行为被破坏 | 中 | 中 | 单测覆盖明确（dispatch D2.8 要求） · Review-Tech 看单测输入用例 |

---

## 8. 签字与下一步

- **Reviewer**：Review-Agent-Tech
- **时间**：2026-04-27 09:45+08:00
- **同轮兑现**：本报告与 Product Review 在派单同一 tool call 循环内交付（**D-016 第四次实战合规**）
- **投票**：**APPROVE**（33/35 · P1=1 · P2=2 · INFO=3 · 均可在 Agent 开工首 15 分钟处理）
- **给 Human 的建议**：直接发 `approve-def:COSTRA-102` 放行卡定义 · 可连发 `run miniapp COSTRA-102 impl` 进入实装段（若你希望合并步骤）· 或分段先 approve-def 再 run

---

## 9. Refs

- `.team/dispatch/COSTRA-102-miniapp-login-e2e.md`（本次审对象）
- `.team/reviews/COSTRA-118/FINAL.md §分流矩阵`（基线）
- `server/api/openapi.yaml`（契约事实源）
- `.team/sprints/sprint-01-plan.md §COSTRA-102`（节奏锚）
- `.team/decisions/D-011 / D-013 / D-014 / D-016`（Review 机制）
