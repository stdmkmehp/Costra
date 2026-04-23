# Tech Review · COSTRA-100 · Round 1

- 被审 Agent：**backend**
- 本轮产出 commit：未提交（工作区；按 `git status` 显示为 modified 和 untracked 的一批文件）
- 审核时间：2026-04-23T19:35+08:00
- 上轮结论：**首轮**

---

## 0. 审核范围与上下文

### 被审产出（9 个文件，覆盖 D-006 §5 的 5 件补齐 + COSTRA-113 搭车 + 索引更新）

| # | 路径 | 性质 |
|---|---|---|
| 1 | `docs/api/error-codes.md` | 新增 · 21 条错误码字典 |
| 2 | `server/src/errors/ErrorCode.ts` | 新增 · TS 枚举 + HTTP 状态映射 + 重试策略映射 + 守卫 |
| 3 | `docs/api/ttl-policy.md` | 新增 · 全链路 TTL 总表 |
| 4 | `server/api/openapi.yaml` | 修改 · `ErrorCode` 枚举注入 / `AuthTokenPair` TTL 字段 / `Error.code` 引用 |
| 5 | `docs/api/id-strategy.md` | 新增 · UUIDv7 / client_ref_id / Idempotency-Key 三层 ID |
| 6 | `docs/api/sync-protocol.md` | 新增 · `/sync/push` + `/sync/pull` 协议 |
| 7 | `server/src/config/subject.ts`（COSTRA-113 搭车） | 新增 · D-008 主体配置加载器 |
| 8 | `server/.env.production.example` | 补 SUBJECT_* 段（未单独读，仅按 D-010 声明存在） |
| 9 | `docs/api/README.md` | 修改 · 错误码章节与相关文档索引 |

### 强制上下文（已全部加载）
- `docs/charter.md`（项目章程，工程约束）
- `.team/decisions/ADR-0002-tech-stack.md`（技术栈 v2）
- `.team/decisions/D-008-subject-individual-first-with-corporate-compat.md`
- `.team/decisions/D-009-domain-and-dev-server-locked.md`
- `.team/decisions/D-010-costra-100-g3-gaps-delivered.md`
- `docs/db/schema.md`（DB 设计原则 v1）
- `server/api/openapi.yaml`（全文通读；未再读 `api/openapi.yaml` 镜像）
- `.team/engineering-guidelines.md`、`.team/agents/COMMON-CONTRACT.md`

---

## 总评

- **Verdict**：`REVISE`（有 P0 但 ≤ 3 个 且 round < 5）
- **总分**：**26 / 30 分**（6 维有效 × 5；"离线与同步（MiniApp 专属）"项为 N/A，不计入分母）
- **阻塞点数量**：**3 个 P0 · 4 个 P1 · 3 个 P2**

一句话：**单份文档质量很高，工艺很扎实；但跨文件契约一致性出现了硬伤——新产出的 ID 策略（UUIDv7 + Postgres + `pg_uuidv7`）与既有 ADR-0002（MySQL 8.0 + `gen_random_uuid()` v4）及 `docs/db/schema.md` P8（v4 `gen_random_uuid()`）打架；`IDEMPOTENCY_KEY_MISMATCH` 在三处文档归属 HTTP 状态不一致；旧 `README.md` 章节与新文档不自洽。这些是必须修、很容易修的 P0。**

---

## 维度得分

| 维度 | 得分 | 一句话结论 |
|---|---|---|
| 契约一致性 | **2/5** | 新产出内部自洽；但与 ADR-0002 / docs/db/schema.md / 旧 `docs/api/README.md` / `openapi.yaml IdempotencyKey` 描述多处对立（UUID 版本、IDEMPOTENCY_KEY_MISMATCH 归属、主存储） |
| 架构与分层 | **4/5** | `server/src/errors/` 和 `server/src/config/` 目录分工清晰；但 ADR-0002 仍登记后端语言为 Go + Gin，ErrorCode.ts 是 TS，**ADR 未同步** |
| 数据与持久化 | **3/5** | `id-strategy.md §1.4` 写 Postgres `pg_uuidv7`，与 `docs/db/schema.md §1 P8`（gen_random_uuid v4）冲突，且 `schema.md` 是运行环境 PostgreSQL 15，`ADR-0002` 又是 MySQL 8.0 —— 存储选型事实源本身就漂移 |
| 离线与同步 | **N/A** | 本次无 MiniApp 产出；sync-protocol 是服务端契约，纳入"契约一致性" |
| 安全与合规 | **5/5** | 无 `session_key`/openid/token 硬编码；主体字段走 subject.ts 零违规；日志脱敏约束明确（error-codes §5.3） |
| 可测与可观测 | **5/5** | 错误码 5 条 QA 钩子、ID 5 条、sync 5 条、TTL 4 条，共 19 条可机械化断言；DevOps 告警规则带阈值与严重度 |
| 工程纪律 | **4/5** | 单文件规模（sync-protocol.md 359 行 / id-strategy.md 233 行）健康；注释引用了事实源与卡号；但**工作区未 commit**，无法核验 Conventional Commits 规范；`docs/api/README.md` 改动仅局部，未把旧错误码表删/重导，形成双表 |

---

## P0 阻塞点（必改，不改则 REJECT 或 ESCALATE）

### P0-1 · ID 策略 vs `db/schema.md` + `ADR-0002` 出现**事实源分裂**
- **证据**：
  - `docs/api/id-strategy.md:35`：`**UUID v7**（时间有序 UUID）· 兼容 OpenAPI format: uuid`
  - `docs/api/id-strategy.md:48`：`DEFAULT gen_random_uuid_v7()（需 pg_uuidv7 扩展；MVP 先在应用层生成）`
  - `docs/db/schema.md:22`：`P8 UUID 主键 ... 全表 UUID 主键（gen_random_uuid()），避免泄露规模与便于离线生成`
  - `.team/decisions/ADR-0002-tech-stack.md:27`：`主存储 | MySQL 8.0（DECIMAL(18,4) 存金额） | 事务`
  - `docs/db/schema.md:6`：`运行环境: PostgreSQL 15`
- **问题**：三份权威文档对"主存储 + UUID 生成算法"**三种说法**：
  1. ADR-0002 说 MySQL 8.0
  2. schema.md 说 PostgreSQL 15 + `gen_random_uuid()`（v4）
  3. 新 id-strategy.md 说 PostgreSQL + v7 + `pg_uuidv7` 扩展
- **依据**：Review-Tech §3.1 契约一致性 · 服务端实体 ID 属于最底层契约，不同 layer 给出不同答案属于"架构漂移"；且 `docs/api/README.md:17` 还明确写 "UUID | v4 字符串"，**同一 README 在 §1 说 v4、链接到 id-strategy.md 说 v7**。
- **修复建议**（三选一，**必须选一个**并把所有文档拉齐）：
  - **方案 A（推荐，零破坏性）**：保留 v7 决策，**同步修正**：
    - `docs/db/schema.md` P8 改为 "UUID v7（应用层生成）"；§2 中 `gen_random_uuid()` 全量替换为应用层 `newId()`
    - `docs/api/README.md:17` "UUID v4" → "UUID v7（服务端主键）/ v4（幂等键/client_ref_id）"
    - 补一行 ADR 修订记录（ADR-0002 主存储明确为 PostgreSQL 15，移除"MySQL 8.0"；如需保留历史，走 Superseded）
  - **方案 B**：保留 v4、放弃 v7，`id-strategy.md` 整份改为 v4 版（降级）
  - **方案 C**：起一份 ADR-0005 "UUID v7 + PostgreSQL 主存储" 专门记录，并在 schema.md / README.md / ADR-0002 全部加链接
- **必改理由**：这是"Backend-Agent 作为契约第一权威"的核心职责，不能同一批产出里留 3 条互斥的事实源给 MiniApp / QA 消费。

---

### P0-2 · `IDEMPOTENCY_KEY_MISMATCH` 的 HTTP status 在三处文档归属不一致
- **证据**：
  - `docs/api/error-codes.md:72`：`| 4 | IDEMPOTENCY_KEY_MISMATCH | conflict | ...` —— 属于 **§2.1 400 参数 / 请求体** 小节
  - `server/src/errors/ErrorCode.ts:63`：`[ErrorCode.IDEMPOTENCY_KEY_MISMATCH]: 409,`
  - `docs/api/README.md:81`：`不匹配时服务端返回 409 + code=IDEMPOTENCY_KEY_MISMATCH`
  - `docs/api/id-strategy.md:147`：`hit + body_hash 不一致 → 返回 409 IDEMPOTENCY_KEY_MISMATCH`
- **问题**：error-codes.md 把它编到 **"400 参数"** 章节下（表头就是 §2.1 400）但 category 又写 `conflict`（暗示 409）；TS 枚举和其他三处文档都是 **409**。客户端如果照 error-codes.md 的 §2.1 章节位置去理解，会按 400 分支处理 —— 直接踩坑。
- **依据**：契约一致性红线（Review-Tech §3.1 "错误码是否使用已登记的枚举；契约变更必须 OpenAPI 先行"）
- **修复建议**：把 `IDEMPOTENCY_KEY_MISMATCH` **从 §2.1 400 小节挪到 §2.5 409 冲突小节**；章节标题与映射表归属统一为 409。TS 枚举和 OpenAPI 正确无需改。

---

### P0-3 · `ADR-0002` 后端语言与新代码实现事实脱钩
- **证据**：
  - `.team/decisions/ADR-0002-tech-stack.md:24`：`后端语言 | Go 1.22+`
  - `.team/decisions/ADR-0002-tech-stack.md:25`：`后端框架 | Gin + gRPC`
  - `server/src/errors/ErrorCode.ts`：TypeScript enum / interface / process.env 访问
  - `server/src/config/subject.ts`：`NodeJS.ProcessEnv` 类型声明（Node 运行时）
  - `server/package.json`（存在，未读 —— 但 Node/TS 生态存在即暗示切换）
- **问题**：ADR-0002 现行版本明确写 Go + Gin；但实际 `server/src/` 里落地的是 **TypeScript / Node**。这不是 COSTRA-100 的遗留，但 COSTRA-100 首次往 `server/src/` 落代码，触发了"ADR-0002 从未被同步"这个隐患显性化。若 MiniApp-Agent 或 DevOps-Agent 读 ADR 做假设（比如 DevOps 给 Go 做 Dockerfile），会直接走偏。
- **依据**：COMMON-CONTRACT §8 "契约变更" · ADR 属契约层；Review-Tech §3.2 "不得引入未登记的框架/库"
- **修复建议**（二选一）：
  - **方案 A（推荐）**：本卡内补一条 ADR 修订（或起 ADR-0006 "后端运行时由 Go 调整为 Node.js + TypeScript"），同步改 ADR-0002 §决策表"后端语言 / 框架"两行
  - **方案 B**：如果历史上已有决策但漏落文，在 `docs/devops/` 或 `.team/decisions/` 找到，把 commit hash/决策 ID 引用写进 `server/src/*.ts` 的 doc comment 与 D-010
- **注**：由于这是历史债，可接受在本 Round 提供"决策引用链接 + ADR 草案入队下卡"作为临时闭环，但**不能零动作通过**。

---

## P1 应改

### P1-1 · `docs/api/README.md §1` 的 UUID 字段规则未更新，与新 id-strategy.md 对立
- **证据**：`docs/api/README.md:17` "UUID | v4 字符串 | 统一"；`docs/api/README.md:56` 旧错误码表 12 条（新表 21 条）。
- **问题**：README 作为**入口索引**，若仍展示旧规则，后续 MiniApp/QA 查错率极高。
- **修复建议**：
  - §1 "UUID" 行改为："服务端主键 UUID v7；幂等键 / client_ref_id UUID v4。详见 `id-strategy.md`"
  - §3 "标准错误码"小表：删表或明确标 "精简视图，完整见 `error-codes.md`"；否则两份表迟早漂移

### P1-2 · `openapi.yaml` 的 `IdempotencyKey` 参数 description 信息不全
- **证据**：
  - `server/api/openapi.yaml:607-608`：`schema: { type: string, format: uuid }  description: UUID v4；同 key 24h 内重复请求返回相同结果`
- **问题**：没提到"同 body hash 判定 / 不一致返回 409 IDEMPOTENCY_KEY_MISMATCH"；没引用 `id-strategy.md §3.3`。
- **修复建议**：description 扩为 "UUID v4；同 key + 同 body_hash 24h 内返回首次结果；不一致返回 409 IDEMPOTENCY_KEY_MISMATCH。详见 docs/api/id-strategy.md §3。"

### P1-3 · `sync-protocol.md §2.4 results.status` 与 `error-codes.md` 的 code 子集未形成"白名单"约束
- **证据**：
  - `docs/api/sync-protocol.md:150`：`rejected` 情况列出 `NOT_FOUND / PERMISSION_DENIED / BUSINESS_RULE_VIOLATION / INVALID_ARGUMENT`；
  - `error-codes.md` 没回链声明"仅这 N 条可出现在 push.results.error.code"。
- **问题**：客户端消费 results.status=rejected 时无法机械枚举可能的 code。
- **修复建议**：sync-protocol.md §2.4 明确列出"白名单 code"并在 error-codes.md §9 交叉引用里加 reverse link（`sync.push.results.error.code ∈ {NOT_FOUND, PERMISSION_DENIED, BUSINESS_RULE_VIOLATION, INVALID_ARGUMENT}`）。

### P1-4 · `ErrorCode.ts` 没有"事实源一致性"运行时自检
- **证据**：`server/src/errors/ErrorCode.ts` 有 `ErrorHttpStatus` / `ErrorRetryStrategy`，但没有一个 `assertCoverage()` 或单元测试保证**所有枚举值**都有 http 和 retry 映射。
- **问题**：未来新增一条 code 忘了加到其中一张映射表 → 运行时 `httpStatusOf` 返回 500 兜底，遮蔽真实错误。
- **修复建议**：任选其一：
  - 文件末尾加 IIFE：`(() => { for (const c of Object.values(ErrorCode)) { if (ErrorHttpStatus[c] == null) throw new Error(...); } })();`
  - 或加 `server/src/errors/ErrorCode.test.ts`（Jest）做编译期 + 运行期双保险
  - 也可等 COSTRA-101 里一并落

---

## P2 建议

### P2-1 · `ttl-policy.md §4` 的 `TTL_*` 键与 `.env.production.example` 未标注互相引用
- `ttl-policy.md §4.1` 列了所有 `TTL_*` 键；`.env.production.example` 是否覆盖全量？建议在两边加交叉链接，并在 COSTRA-101 落 `server/.env.example` 时写自检脚本。

### P2-2 · `sync-protocol.md §2.2` 的"ops 数组 1 ~ 200 条"约束未在 OpenAPI 表达
- OpenAPI 的 `SyncPushRequest` schema 建议加 `minItems: 1, maxItems: 200`，让 codegen/contract test 直接生效。

### P2-3 · `id-strategy.md §1.5` 代码示例提及 `uuidv7` npm 包未登记到 `server/package.json`
- 不是本卡必做，但建议在 D-010 Follow-up 补一条 "Sprint-1 首次引入 uuidv7 依赖时走 ADR-0002 §库依赖清单登记"。

---

## 与上轮的差异

_（本轮为 Round 1，无上轮对照。）_

---

## 给被审 Agent（Backend-Agent）的回执指令

Orchestrator 拉起 Backend-Agent 做 Round 2 时，请附上本文件全文并要求其：

1. **P0-1（UUID / 主存储）**：在方案 A/B/C 中**明确选一个**；本轮只接受 A 或 C（B 是放弃升级，等价于回滚新产出，需 Human 拍板）。产出**修复说明 + 具体 diff 指针**到 `round-1-backend-response.md`；涉及 ADR-0002 的修订必须**同步留存**（不得删老版本）。
2. **P0-2（IDEMPOTENCY_KEY_MISMATCH 归属）**：把表从 §2.1 400 挪到 §2.5 409；verify `error-codes.md` + `README.md` + `id-strategy.md` 描述一致。
3. **P0-3（后端运行时 ADR 漂移）**：补一份 ADR（0005 或 0006）说明 Go → TS/Node 的切换理由（或找到历史决策链接），更新 ADR-0002 §决策表两行。
4. **P1-1 ~ P1-4**：至少修 **3 条**（建议全修）；未修的在 response.md 里给"延后理由 + 落下 Sprint 哪张卡"。
5. **P2-1 ~ P2-3**：全部登记到 D-010 Follow-up 即可。

完成后 Orchestrator 将拉 Review-Tech 进入 Round 2。

---

## 自我反思

- **本次审核耗时估计**：约 35 分钟（文件 9 份 + 强制上下文 6 份）
- **审核置信度**：**高**
  - P0-1 / P0-2 有可逐行定位的证据；
  - P0-3 置信度略低于前两条，因不能排除"历史决策存在但遗失链接"的可能 —— 所以给了方案 B（找到链接即可），不强制起 ADR。
- **是否建议升级 Human**：**否**。本轮 P0 都是可机械修复的契约拉齐，不涉及路线分歧；Backend-Agent 应该一轮搞定。若 Round 2 后 P0-3 仍无法闭环（Backend 找不到历史决策、也不愿写 ADR），升级为 `ESCALATE`。
- **独立性说明**：本 Review 未读 `review-product` 报告（当前也无）；未与其他 Review-Agent 有信息交叉。
