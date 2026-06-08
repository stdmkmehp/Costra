# COSTRA-103 卡定义首轮 Review · Tech 维度

- **Review 档位**：D-014-a 卡定义首轮（Sprint-2 主线主头 · T1 准入审查 · 但 D-022 v2.0 触发 runtime 类 T2 = T2-with-runtime 路径）
- **Reviewer**：`costra-card-reviewer-tech-COSTRA-103-r1`（一次性审查 subagent · D-018 SBAI v1.1 · 审查档第 4 次实战）
- **Review 对象**：`.team/dispatch/COSTRA-103-miniapp-local-persistence-outbox.md`（Orchestrator 2026-05-09 11:08 落盘）
- **产出时间**：2026-05-09 12:15+08:00（Orchestrator 派单同 tool call 循环内兑现 · **D-016 第 15 次实战合规**）
- **覆盖范围**：C1~C7 七维（标题描述 / DoD 可度量 / 依赖识别 / 产出物具体 / 风险边界 / 去重 / 估点）+ C8 红线检查 + **协议对齐硬验收**（Tech 卡核心）+ **runtime 类 T2 判定**（D-022 §4.1 首次实战）
- **参照事实源**：
  - `.team/dispatch/COSTRA-103-miniapp-local-persistence-outbox.md`（审对象）
  - `.team/SOP-CARD-REVIEW.md` §3 Checklist（评分表 · C1~C8 · 总分 30）
  - `.team/decisions/D-014-card-review-and-auto-review-kickoff.md`（依据）
  - **`docs/api/sync-protocol.md` v1.0**（协议事实源 · §2 push / §3 pull）
  - **`docs/api/id-strategy.md` v1.0**（三种 ID 规约）
  - **`miniprogram/services/{storage,sync,request}.ts`**（COSTRA-125/126/118 现状）
  - `.team/decisions/D-022-review-tech-runtime-dimension.md`（runtime 类判定 · 首次实战基准）
  - `.team/decisions/D-021-d-017-v3-cross-version-precheck.md`（三证铁律来源）
  - `.team/decisions/D-019-g4-sprint-1-closure.md`（§3.2 Sprint-2 立卡锚点）

---

## 0. 结论速览

**Verdict**：**PASS-WITH-FOLLOWUP**
**评分**：**26.5 / 30**（P0=0 · P1=1 · P2=0 · INFO=1）

**Tech 视角关键判断**：

1. **协议对齐硬验收 100% 通过** 🏆：payload snake_case / entity 枚举 / op 枚举 / base_version 语义 / Idempotency-Key 整批级 / 重试策略指数退避全链路对齐 sync-protocol.md + id-strategy.md · 0 偏差
2. **runtime 类 T2 判定命中**（D-022 §4.1 首次实战）：平台 API 运行时行为 + 微信基础库版本差异 两类同时命中 · dispatch §0/§9/§2.7 Human 实测前置铁律条款齐全（5 步手册 + 5 硬断言）
3. **DoD 9 条全部可机械验收**：grep + spec + Human 实测三轨齐全 · D-022 §4.1 不可绕过 E1/E2 兜底显式记 DoD (i)
4. **范围划分精确**：在 storage.ts 之上构建 db.ts（不重写 COSTRA-125 锁定的 4 个 async API）· outbox 多 key 分片彻底替代单 key 数组（COSTRA-118 P1-3 兑现）· 冲突探测桩留 COSTRA-104 真实落地（避免越权）
5. **唯一 P1 属措辞瑕疵**（标题"SQLite/IndexedDB"与实际 storage.ts KV 实现失准）· 不阻塞 PASS · miniapp-dev R1 实装时 follow-up 修正即可

**Sprint 节奏契合**：5 点 P0 主头 · COSTRA-104 协议对齐前置（依赖 outbox.SyncOp / db.Entry 接口）· 解锁 Sprint-2 主线 · 与 D-019 §3.2 立卡锚点 100% 对齐。

---

## 1. 分项评分

| 维度 | 满分 | 得分 | 一句话 |
|---|---|---|---|
| **C1 标题与描述清晰度** | 5 | **4.5** | ⚠️ 标题超 60 字符 + "SQLite/IndexedDB" 与实际 storage.ts 实现措辞失准（P1-1）· 描述含背景/目标/范围三要素 |
| **C2 DoD 可度量** | 6 | **5** | 9 条 DoD 全部含自动化 grep 验证 + Human 实测 5 步手册 + D-022 §4.1 不可绕过 E1/E2 兜底（DoD i 显式记）|
| **C3 依赖识别** | 5 | **5** | 上游 3 项已闭（COSTRA-100 G3 + 118 P1-3 + 125）· 下游 COSTRA-104/105 明示 · D-021 三证铁律前置 |
| **C4 产出物具体** | 5 | **5** | 8 个文件路径 + 8+6+2 API 签名 + 存储 key 命名空间（`entry:{client_ref_id}` / `outbox:{seq}` / `outbox:__index` / `watermark:{family_id}`）+ 8 测 spec 清单 |
| **C5 风险与边界** | 4 | **4** | 重试策略 2s→1h 指数退避 + 24h 上限 + dead-letter + mergeIntoConflictQueue 桩 + 软删 deleted_at 语义 |
| **C6 与既有卡去重** | 3 | **3** | board.md/backlog.json/D-019 §3.2 无重复 · 标题与 Epic-C 主线规划一致（仅措辞瑕疵 · 不计去重扣分）|
| **C7 估点合理性** | 2 | **2** | 5 点落在 1~8 区间 · 体量证据：3 新建 + 1 重构 + 1 接入 + 2 spec + 1 手册 = 8~10 文件 ~ 800 行 |
| **总分** | **30** | **26.5** | **PASS-WITH-FOLLOWUP** |

### C8 · 红线检查（无命中 · PASS）

| 红线项 | 命中？ | 备注 |
|---|---|---|
| 违反 Won't-Have | ❌ | 0 命中 · 离线优先架构是 PRD 主线 |
| 包含硬编码 secret / 密钥 / 账号 | ❌ | 0 命中 |
| 产出包含主体字样硬编码（D-008）| ❌ | 0 命中 · miniprogram/utils/services 不进打包源码主体红线作用域外 |
| 目录越权 | ❌ | 0 命中 · §3 工作区 10 文件 100% 在 miniapp-dev 可写区（COMMON-CONTRACT §0）· 禁写清单显式覆盖 server/ api/ docs/api/ 协议事实源 + storage.ts/auth.ts/request.ts/app.ts 锁定 |
| 违反 engineering-guidelines 强硬规则 | ❌ | 0 命中 · D-012 单卡即提交 + footer Refs · §6 commit 段已落实 · subject 全小写 §9 第 8 条 |

---

## 2. 协议对齐硬验收（Tech 卡核心 · 100% 通过）

### 2.1 自跑 grep 结果（事实源核查）

| 验证项 | 目标 | grep 结果 | 结论 |
|---|---|---|---|
| 驼峰 payload 残留（修复前） | `pages/entry/index.ts` outbox 业务路径 0 命中 `amountCents\|categoryId\|occurredAt` | **现状命中 3 处**：`index.ts:49 amountCents` / `index.ts:50 categoryId` / `index.ts:52 occurredAt` | ✅ 预期内（骨架现状）· dispatch §2.5 接入代码设计意图正确（snake_case）· R1 实装将清理 |
| 旧符号残留（重构前） | `sync.ts` 0 命中 `OUTBOX_KEY\|enqueueLocalEntry\|__peekOutbox` | **现状命中 3 处**：sync.ts:45/109/120 | ✅ 预期内（骨架现状）· dispatch §2.4 重构清单覆盖 |
| 同步 storage API（COSTRA-125 不变量） | `db.ts` / `outbox.ts` 0 命中 `wx\.setStorageSync\|wx\.getStorageSync` | **0 命中**（全局 storage.ts 现状无同步 API） | ✅ PASS |

### 2.2 sync-protocol.md 字段对齐核查

| 字段 | sync-protocol.md §2.1 | dispatch §2.2 SyncOp | 对齐？ |
|---|---|---|---|
| payload 格式 | `ledger_id` / `amount` / `currency` / `type` / `category_id` / `note` / `occurred_at` snake_case | dispatch §2.2 + §2.5 接入示例全 snake_case | ✅ 100% |
| entity 枚举 | `entry \| category \| budget` | dispatch §2.2 `entity: 'entry' \| 'category' \| 'budget'` | ✅ 100% |
| op 枚举 | `create \| update \| delete` | dispatch §2.2 `op: 'create' \| 'update' \| 'delete'` | ✅ 100% |
| base_version | `create` 必为 `null` · `update`/`delete` 必填 | dispatch §2.2 `base_version: number \| null` | ✅ 100% |
| Idempotency-Key | 整批级 UUID v4 · 重试不变 | dispatch §2.2 `idempotency_key: string` 持久化 | ✅ 100% |
| 重试策略 | 2s/8s/32s/2min/15min/1h · 24h 上限 | dispatch §2.2 重试策略段 | ✅ 100% |
| pull changes 实体顺序 | ledgers→categories→budgets→entries | dispatch §2.1 db.ts.applyServerChanges 注释 | ✅ 100% |
| watermark 客户端不得自行推进 | sync-protocol.md §6.3 | dispatch §2.4 syncPull 内部 setWatermark 用 server 返回值 | ✅ 100% |

### 2.3 id-strategy.md 三种 ID 对齐核查

| ID | id-strategy.md 规格 | dispatch §2.3 | 对齐？ |
|---|---|---|---|
| 服务端 `id`（UUID v7）| 服务端生成 · 客户端不生成 | `id?: string` 在 Entry 接口注释 "push 成功后回写" | ✅ |
| `client_ref_id`（本地主键）| UUID v4 · 客户端生成 · §2.5 实装样板 | `newClientRefId(): string` · 复用 request.ts:170 uuidV4 | ✅ |
| `Idempotency-Key`（HTTP 头 / outbox 持久化）| UUID v4 · 每请求/批次独立 · 24h 去重 | `newIdempotencyKey(): string` 独立函数 + outbox.SyncOp.idempotency_key 持久化 | ✅ |

**协议对齐结论**：✅ **全链路 100% 对齐 · 0 偏差 · 0 P0**

---

## 3. runtime 类 T2 判定（D-022 §4.1 首次实战核查）

### 3.1 判定标准（D-022 §4.1 五类 · 任一命中即 runtime 类 T2）

| 类别 | COSTRA-103 是否涉及 | dispatch 证据 |
|---|---|---|
| 微信 SDK 启动时序 | ⚠️ 间接（storage.ts ensureVersion 在 app.ts onLaunch 首行）| DoD (i) ensureVersion 兼容性 |
| 渲染层时序 | ❌ 未直接涉及 | — |
| **平台 API 运行时行为** | ✅ **命中** | §2.1 db.ts 依赖 storage.ts async API + outbox 重放依赖 wx.request |
| 模块加载语义 | ❌ 未涉及 | — |
| **微信基础库版本差异** | ✅ **命中** | DoD (i) lib 3.8+ 必跑（COSTRA-126 兑现的 startup race 修复依赖）|
| 分包/主包加载时序 | ❌ 未涉及 | — |

**判定结论**：✅ **runtime 类 T2 卡**（两类同时命中）

### 3.2 D-022 §4.1 前置条款核查（不可绕过铁律）

| 要求项 | dispatch 覆盖 | 结论 |
|---|---|---|
| Human 模拟器实测前置 | ✅ §0 SBAI 路径明示 + §9 第 7 条硬约束 | 齐全 |
| 5 步实测手册 | ✅ `docs/qa/costra-103-human-verify.md` §2.7 + §3 工作区列入可写 | 齐全 |
| ≥ 5 条硬断言 | ✅ §2.7 列出 5 条硬断言（async + 多 key 分片 + 100% snake_case + client_ref_id 持久化 + ensureVersion lib 3.8+）| 齐全 |
| D-022 §4.1 E1 跳过条件（无代码产出）| ❌ 不适用（本卡 800 行净增）| N/A |
| D-022 §4.1 E2 跳过条件（Human 显式跳过）| ❌ 不适用（无 Human 跳过指令）| N/A |
| review-tech R1 后必须等 Human 实测 | ✅ §0 SBAI 路径 + §9 第 7 条硬约束 | 齐全 |

**Human 实测前置铁律结论**：✅ **不可绕过条款 100% 齐全 · 本卡需 Human 模拟器实测 5 条断言全 PASS 才能 T1 终审**

---

## 4. 问题清单

### P0（阻塞）：**无**

### P1（应改 · follow-up · 不再审）

#### P1-1 · 标题措辞失准（小瑕疵）

- **位置**：dispatch 第 1 行标题
- **问题**：标题含"本地 SQLite/IndexedDB 持久化"措辞 · 但实际实现使用 `storage.ts`（微信 storage API · KV 抽象）而非 SQLite/IndexedDB · 微信小程序生态**没有原生 IndexedDB API** · "SQLite/IndexedDB" 是 Sprint-0 早期 PRD 占位词 · 与本卡实际 Q1-b 选型（wx.setStorage + 自建简易 KV 抽象）不符
- **证据**：
  - dispatch §2.1："在 storage.ts 之上 · 让业务代码不直接接触 wx API"
  - storage.ts 实现：4 个 async API（ensureVersion / setItem / getItem / removeItem · COSTRA-125 锁定）
  - 不含任何 SQLite / IndexedDB API 调用
- **依据**：SOP-CARD-REVIEW §3 C1 "标题与既有卡措辞一致 · 不新造概念，除非明确立项"
- **修复建议**（2 选 1）：
  - **方案 A（推荐）**：标题改为 `"本地 KV 持久化 + outbox 多 key 分片 + 冲突三态消费"` · 删除 "SQLite/IndexedDB" + 括号重命名作为 description 第一句
  - **方案 B（更保守）**：标题不变 · description 增加 `"实现方式：微信 storage API（storage.ts 异步 KV）而非浏览器 IndexedDB"`
- **阻断级别**：**P1（小瑕疵 · 不再审）** · miniapp-dev R1 实装时合并 follow-up · backlog.json 同步更新 title

### P2（建议）：**无**

### INFO（观察）

#### INFO-1 · runtime 类 T2 标注方式说明（非问题）

- **说明**：SOP-CARD-REVIEW（卡定义 Review）使用 30 分制（C1~C8 红线）· **不包含** D-022 新增的 C8 "runtime 加载性"维度（那是产出 Review 评分表 40 分制的维度）· 但 dispatch §4 DoD (i) 已通过 ensureVersion 兼容 + lib 3.8+ 覆盖 runtime 类卡的核心不变量
- **建议**：后续 runtime 类 T2 卡在 dispatch §0 明确标注 "D-022 §4.1 命中 · Human 实测前置" · 便于 card-reviewer-tech 快速定位
- **阻断级别**：INFO（不阻断 · 治理建议）

---

## 5. Verdict

**PASS-WITH-FOLLOWUP** · 26.5/30 · 0 P0 / 1 P1（小瑕疵）/ 0 P2 / 1 INFO

**触发依据**（SOP-CARD-REVIEW §3 末段阈值表）：

- 总分 26.5 ∈ [24, 26] 阈值 → **PASS-WITH-FOLLOWUP**（实际 26.5 已贴近 PASS 27 下限）
- C8 红线 0 命中 → 不触发 REJECT
- P0=0 + 唯一 P1 属措辞瑕疵 → 不触发 REVISE
- **runtime 类 T2 判定命中** → R1 实装后 review-tech R1 PASS + Human 实测 5 断言 PASS 才能 T1 终审

**条件**：miniapp-dev R1 实装时合并 P1-1 follow-up（标题修正）· backlog.json title 同步 · 卡直接进 Doing · 无需触发 Round 2 卡定义 Review。

---

## 6. 给卡作者的回执指令

请 **miniapp-dev** 按以下处理：

### 必做（Follow-up · 不再审）

**P1-1 标题措辞修正**（推荐方案 A）：

- dispatch 标题改为 `"COSTRA-103 · 本地 KV 持久化 + outbox 多 key 分片 + 冲突三态消费（离线优先架构客户端层）"`
- backlog.json `cards[id="COSTRA-103"].title` 同步改为 `"本地 KV 持久化 + outbox + 冲突三态消费"`
- description 第 1 句承接旧标题语义："实现方式：微信 storage API（storage.ts 异步 KV 抽象 · 在 KV 之上构建实体分层）"

**状态**：Follow-up 完成即视为 PASS · 无需触发 Round 2 卡定义 Review。

### runtime 类 T2 提醒

- 本卡已命中 D-022 §4.1 runtime 类 T2 判定
- R1 实装后 review-tech R1 PASS + **Human 实测 5 条断言全 PASS** → T1 终审放行
- Human 实测**不可绕过**（E1/E2 例外不适用本卡）
- 验证手册 `docs/qa/costra-103-human-verify.md` 必须含完整 5 步 + 5 硬断言

---

## 7. 强制阅读清单（miniapp-dev R1 实装必读 · 在 dispatch §10 基础上补充）

| # | 文件 | 必读原因 |
|---|---|---|
| 1 | `docs/api/sync-protocol.md` | 协议事实源 · payload snake_case / entity 枚举 / 三态消费必须逐字段对照 |
| 2 | `docs/api/id-strategy.md` | 三种 ID 严禁混用 · client_ref_id / Idempotency-Key / 服务端 id 各司其职 |
| 3 | `miniprogram/services/storage.ts`（86 行 · COSTRA-125）| 在其上构建 db.ts · 不重写 · 4 个导出 async API 禁止回退 sync 形态 |
| 4 | `miniprogram/services/sync.ts`（123 行）| 重构对象 · §2.4 逐行对照迁移清单（enqueueLocalEntry / OUTBOX_KEY / getCursor / syncPull / 新增 pushDelta）|
| 5 | `miniprogram/services/request.ts:65-68 + :170` | Idempotency-Key 注入机制（`opts.idempotencyKey \|\| uuidV4()`）+ uuidV4 export · outbox 批级别复用 |
| 6 | `.team/decisions/D-022` | runtime 类 T2 判定标准 + Human 实测前置铁律（§4.1）+ 你被审的 v2.0 评分表 40 分制 |
| 7 | `.team/decisions/D-021` | 三证铁律（git ls-files / log / show HEAD:）· history §1 必录 |
| 8 | `docs/qa/costra-102-human-verify.md`（参考范本 · 不复用）| 验证手册格式范本（5 步 + 断言格式） |
| 9 | `.team/reviews/COSTRA-103/card-review-round-1-tech.md`（本报告 · 你的卡审通过证据）| P1-1 follow-up + runtime 类前置铁律 |

### 额外补充（review-tech R1 重点关注 · 你 R1 实装时自检参考）

- **outbox.ts 多 key 分片命名空间验证**：dispatch §2.2 明确 `outbox:{seq}` / `outbox:__index` / `outbox:__retries` · review-tech R1 将 grep 验证 0 次单 key 数组残留
- **db.ts applyServerChanges 冲突探测桩**：dispatch §2.1 Q3-c 设计 mergeIntoConflictQueue 桩 · 真实合并 UI 在 COSTRA-104 + Sprint-3+ conflict-strategy.md
- **pages/entry/index.ts 接入**：现状 3 处驼峰（`amountCents`/`categoryId`/`occurredAt`）· 重构后 must be 0 残留

---

## 8. 元 Review 自我反思（审查 subagent 自检）

- **审核耗时**：约 35 分钟（20 tool uses · 12 文件 Read + 3 轮 grep 验证 + 协议字段逐条核查）
- **置信度**：**高**
- **关键判断依据**：
  - 协议对齐硬验收 100% 通过（payload / entity / op / base_version / Idempotency-Key / 重试策略 / pull 实体顺序 / watermark 单调性）
  - runtime 类 T2 判定：D-022 §4.1 两类命中（平台 API 运行时行为 + 微信基础库版本差异）· 前置条款齐全
  - DoD 9 条全部可机械验收（grep + spec + Human 实测三轨）
  - P1-1 属措辞层面瑕疵 · 不影响功能实现 · follow-up 即可
- **物理无写权合规自检**：本审查 20 tool uses 全部为 read_file / search_content / execute_command（只读 git/grep/wc）· 0 次 write_to_file / replace_in_file / delete_file 调用 · 纪律性约束 100% 遵守

---

**审查完成 · 本 agent 一次性销毁 · 报告由 Orchestrator 原样落盘至本路径。**
