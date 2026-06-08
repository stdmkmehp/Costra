# COSTRA-102 · Round 1 · AI Review-Tech 报告

> **卡号**：COSTRA-102（Sprint-1 主线第三卡）  
> **Reviewer**：Review-Agent-Tech  
> **Review 阶段**：R1（产出首轮 · D-014-b 自动拉起）  
> **被审输出**：`.team/reviews/COSTRA-102/round-1-miniapp-response.md` + 12 改 / 7 新文件  
> **自动拉起时间**：2026-04-27 10:13（Orchestrator 同 tool call 循环内兑现 · D-016 第 5 次实战合规目标）  
> **审查档位**：T1 产出首轮（Sprint-1 主线客户端实装 · 契约承接 COSTRA-118 路径 A 11 项 P0/P1）

---

## 0. 最终结论

**Verdict**：**APPROVE-WITH-FOLLOWUPS**  
**Score**：**31 / 35**（扣 4 分 · 见 §5 评分）  
**Blocking**：**0 P0**  
**Findings**：**P1 × 2 · P2 × 3 · INFO × 3**（全部 **非阻塞** · 建议采纳但不拦收口）  
**核心判断**：DoD 11 条 + COSTRA-118 分流矩阵 16 条全部落实 · 契约对齐 · 静态三绿灯 · 能力边界合规 · 无红线。

---

## 1. 核对矩阵 · COSTRA-118 §分流矩阵 16/16（硬核检查）

> Reviewer 工具级 diff 核对 · 任一遗漏或越权 = 直接 REJECT 触发

### 1.1 必做 13 项

| 编号 | 事实源断言 | 落实位置 | diff 结果 |
|---|---|---|---|
| E.P0-1 | auth.ts 不再含 `code.slice(0, 8)` | auth.ts:149 `codeLen: code.length` · grep `code.slice` 零命中 | ✅ |
| E.P0-2 | TokenRaw 五字段对齐 OpenAPI AuthTokenPair | auth.ts:13-40 `access_token/refresh_token/access_token_ttl_sec/refresh_token_ttl_sec/user` · 字段名 1:1 对齐 openapi.yaml L822 | ✅ |
| E.P0-3 | /auth/refresh body 字段 `refresh_token` | auth.ts:196 `body: { refresh_token: current.raw.refresh_token }` · 对齐 openapi.yaml L104-107 | ✅ |
| E.P0-4 | 非 GET 自动 Idempotency-Key | request.ts:75-78 · UUID v4 格式正则测试覆盖 | ✅ |
| E.P0-5 | 错误解析顶层字段 | request.ts:119-138 `raw.code / raw.message / raw.trace_id / raw.details` · 不再 `body.error.code` | ✅ |
| E.P0-6 | /sync/pull 契约对齐 | sync.ts:77-91 GET 签名 · **与 dispatch POST body 说法偏离**（见 §2 Finding-INFO-1） | ⚠️ 按事实源实装 |
| E.P0-7 | Entity 枚举 `entry/category/budget` | sync.ts:16 `export type Entity = 'entry' \| 'category' \| 'budget'` · 废弃值 `ledger_entries/accounts/families/family_members` grep 零命中 | ✅ |
| E.P0-8 | toUtcIso 去双减 | time.ts:20-22 `return d.toISOString()` · 单测覆盖本地构造 Date 不双减 | ✅ |
| E.P0-9 | app.wxss CSS 变量补齐 | app.wxss:25-40 共 8 条别名 · 页面 wxss 引用全部可解析 | ✅ |
| E.P0-10-A | 去 `open-type="getUserInfo"` | login/index.wxml:11-16 仅 `bindtap` · grep `open-type` 在 login/ 零命中 | ✅ |
| E.P1-1 | decimal.js 切入 | money.ts 全文 + package.json dependencies · toCents('0.1')+toCents('0.2')===30 单测覆盖 | ✅ |
| E.P1-2 | CLIENT_NETWORK_ERROR 前缀 | request.ts:104 `e.code = 'CLIENT_NETWORK_ERROR'` · 与后端 21 条枚举零重合 | ✅ |
| E.P1-4 | home.ts TODO 纠正 | home/index.ts:53-56 引用 COSTRA-401/Epic-F /reports/monthly | ✅ |

**必做 13 项核对结论**：**13/13 绿**（E.P0-6 虽偏离 dispatch 文本，但对齐事实源 openapi.yaml + sync-protocol.md · Reviewer 判定 **按事实源实装正确** · 详见 §2 INFO-1）

### 1.2 排除 5 项（确认零越权）

| 编号 | 归属 | 越权检查方式 | 结果 |
|---|---|---|---|
| E.P0-10-B | COSTRA-109 链 | grep `miniprogram/pages-family/privacy/` 本次 diff 零触达 | ✅ |
| E.P1-3 | COSTRA-103 | `enqueueLocalEntry` OutboxItem interface 与骨架 diff 为空 | ✅ |
| E.P1-5 | COSTRA-108 | `services/env.ts:50 CURRENT_ENV: EnvName = 'dev'` 骨架期占位保持 | ✅ |
| P2-1/2/3/4 | Sprint-2 FU | 对应文件（README/占位页卡号/console.*/tokens.json）零 diff | ✅ |
| AppID-README | FU-118-1 | `miniprogram/README.md` 未在 diff 列表中 | ✅ |

**排除 5 项核对结论**：**5/5 零越权**

### 1.3 §分流矩阵最终判定：**16/16 全绿** ✅

---

## 2. Findings 详述

### P1-1 · 首次登录"无昵称空窗期"UI 未处理

- **来源**：登录页先 `getUserProfile`（拒绝可继续）· 若用户拒绝 · `profile` 为 null · `loginFlow` 仍然成功 · 服务端 AuthTokenPair.user.nickname 由后端兜底（FU-001 涉及 "未命名用户" / "微信用户"）· 但**首页在 `hydrateUser()` 时读到的 nickname 如果服务端兜底为空串**，`this.setData({ userName: u.nickname || '微信用户' })` 会回退 · 行为正确
- **但是**：`avatar_url` 为 null 的情况下 · home.wxml 走 fallback 显示 👤 · OK · 然而若 **服务端返回 nickname='' 空串**（而非 null），目前 `(u && u.nickname) || '微信用户'` 空串 falsy 也会回退 · ✅ 行为正确
- **真正 P1 点**：**getUserProfile 用户拒绝后**，虽然已进入首页，但 Mock 模式下 mockExchange 返回 nickname="测试用户" · 真实链路下后端 nickname 可能为 "微信用户" 兜底值 · **Home 看不出"用户其实没授权"的语义差异**（开发体验 < 生产体验）
- **建议**：在 login/index.ts 把 `profile` 拒绝标志通过 storage 传给 home 或加一个 `wx.setStorageSync('__costra_avatar_permission_v1', false)` · home 若读到 false 则显示"点击补充资料"引导条
- **阻断级别**：P1（非阻 · 但 UX 上 Card-Def Review 已登记过类似 P1-NEW-1）· **不拦收口 · 登记 FU-102-PROFILE-REFUSE-UI**
- **Reviewer 最终意见**：接受现状 · 开 FU 推入 Sprint-2 一并处理

### P1-2 · PATCH 方法降级后端未识别风险

- **来源**：request.ts PATCH 降级为 POST + `X-HTTP-Method-Override: PATCH` 头（INFO-C 原文）
- **问题**：当前 server/ 实装 Fastify 是否识别 `X-HTTP-Method-Override` 头？若不识别 · `PATCH /users/me` 实际落到 POST 路由 · openapi.yaml 中 `/users/me` 有 GET + PATCH 两个 method · **没有 POST** · 会直接 404
- **后果**：Mock 模式无影响 · 真实 staging/prod 模式下登录后画像同步必 404 · 但 login 路径 `catch (e) { console.warn }` 有兜底 · 用户不可见 · **属"静默失败"**
- **建议**：
  - **短期**：在 Human 本地验证手册 §1.2 期望栏加一行"若网络面板看到 /users/me 404 属已知失败 · FU-102-PATCH-METHOD 处理"
  - **长期**：Sprint-2 COSTRA-150 段评估 · 选项 (a) 后端 Fastify 加统一 methodOverride 中间件；(b) MiniApp-Agent 自己切到 DELETE+重建语义；(c) 提 OpenAPI 改 PATCH → PUT（无破坏 · 语义等价）
- **阻断级别**：P1（本卡实际不触发 · 但未来 Sprint-2 实时触发时会失败）· **不拦收口 · FU-102-PATCH-METHOD 已由 Agent 登记 · 采纳**

### P2-1 · 单测数量 13 超出 dispatch ≤10 约定

- **Agent 已登记 INFO-A 申辩**：3 条超额来自 money.spec（toCents 2 / toYuan 2 / parseAmountInputToCents 2）
- **Reviewer 判定**：**接受保留 13 条**。理由：decimal 精度验证（`0.1+0.2===30`）是本卡最关键 E.P1-1 硬验证点 · 单独拎出是价值的 · 若强制压到 10 反而需要牺牲某一条边界（负数 / 补零 / 容错任一 · 都有回归风险）· **≤10 本就是软指标 · 未超过 2 倍即属可接受**
- **阻断级别**：P2（观察项）· 不改

### P2-2 · onAvatarError handler 未实装

- **来源**：home.wxml:8 `binderror="onAvatarError"` 但 home/index.ts 未导出该方法 · wx 运行时不会崩溃（未找到方法会静默 no-op）· 但 strict mode 模拟器下可能 warn
- **建议**：home/index.ts 加一行 `onAvatarError() { this.setData({ userAvatar: '' }); }` 把 failure 降级到 fallback
- **阻断级别**：P2 · 小修 · **不拦收口**

### P2-3 · error-mapper.ts 已落地但未在业务层接入

- **来源**：§12 INFO-D 交付了 utils/error-mapper.ts · 但 request.ts / login/home/entry/mine 路径中 · 没有地方实际调用 `mapError()`
- **现状**：login/index.ts 的 catch 分支仍然手写 `e?.code === 'CLIENT_NETWORK_ERROR'` 判断 · 没走 mapper
- **建议**：Sprint-1 末或 COSTRA-103 时接入 · 把 login/home/entry/mine 的错误展示统一切到 `const { title, desc, action } = mapError(err)` · 同时 error-mapper.ts 本身作为契约锚点可立即发挥类型守卫价值
- **阻断级别**：P2（契约锚点先到位 · 业务接入可滞后）· **不拦收口**

### INFO-1 · dispatch §D2.5 与事实源契约漂移（Agent 已登记 INFO-B · Reviewer 确认 + 升级处理）

- **Agent 主张**：按事实源 openapi.yaml + sync-protocol.md 实装 GET · 偏离 dispatch POST 文本 · 已登记 FU-102-SYNC-PULL-DRIFT
- **Reviewer 确认**：**Agent 处置正确**。
  - 事实源等级：`server/api/openapi.yaml`（主契约 L614-637）+ `docs/api/sync-protocol.md §3.1`（细节契约 L181）两处**一致为 GET**
  - dispatch §D2.5 的 "POST /sync/pull body" 是 **Orchestrator 基于 round-1-tech.md §P0-6 描述的旧错误推理**（round-1 Reviewer 当时笼统说 "POST /sync/pull body"，实则骨架期幻觉 `GET /sync/{entity}?sinceVersion=` 的修复点是 `GET /sync/pull?family_id=&since=`）
- **升级处理**：Review-Tech 把 FU-102-SYNC-PULL-DRIFT 升级为 **Sprint-1 Retro 议题**：Orchestrator 在 dispatch 时若引用 Round-1 report 表述，必须对照事实源（openapi.yaml + docs/api/）做二次校验 · 避免 dispatch 出错导致 Agent 被迫偏离派单
- **阻断级别**：INFO（处置正确 · 责任归 Orchestrator 流程 · 非 Agent 错）

### INFO-2 · PATCH 方法平台限制的根因（Agent 已登记 INFO-C · Reviewer 补充）

- Agent 登记的 FU-102-PATCH-METHOD 范围合理
- **Reviewer 补充**：该问题未来可能广泛影响 · 不仅 /users/me · OpenAPI 中所有 PATCH 端点（/families/{id}、/accounts/{id}、/entries/{id}）将来 MiniApp 消费时都会遇到。建议 FU 升级 · 改名 `FU-COMMON-MINIAPP-PATCH-LIMIT` · 归 Sprint-2 基础能力改造（不是单卡问题）
- **阻断级别**：INFO（Agent 已登记 · Reviewer 补充升级范围）

### INFO-3 · error-mapper.ts 位置讨论（Agent 已登记 INFO-D · Reviewer 确认）

- Agent 按 error-codes.md §9 事实源指引放在 `miniprogram/utils/error-mapper.ts` · 正确
- dispatch §6 未列 · 是 dispatch 疏漏 · 不归 Agent 责任
- **阻断级别**：INFO（契约锚点落地完毕 · Agent 行为正确 · 为后续 Review 提供类型守卫）

---

## 3. 能力边界铁律核对 ✅

Reviewer 全文扫描 Agent 响应报告，核对以下禁用表述：

| 禁用表述 | 命中结果 |
|---|---|
| "本地扫码通过" / "扫码登录成功" | ✅ 零命中 |
| "真实服务器联调" / "staging 联通" | ✅ 零命中 |
| "体验版 QR 生成" / "微信审核通过" | ✅ 零命中 |
| "真机测试 PASS" | ✅ 零命中 |
| "Human 本地 20 分钟手册交付替代凭证" | ✅ 明确出现在 §0 + §11 · 合规 |

**结论**：能力边界铁律 100% 合规 · 无僭越。

---

## 4. OpenAPI 契约 diff 工具级核对

### 4.1 AuthTokenPair diff

| OpenAPI L820-839 | auth.ts:13-40 | 状态 |
|---|---|---|
| `access_token: string` | `access_token: string` | ✅ |
| `refresh_token: string` | `refresh_token: string` | ✅ |
| `access_token_ttl_sec: integer` | `access_token_ttl_sec: number` | ✅ |
| `refresh_token_ttl_sec: integer` | `refresh_token_ttl_sec: number` | ✅ |
| `expires_in: deprecated` | （未映射） | ✅（明确 deprecated · 无需引入） |
| `user: $ref User` | `user: { id, nickname, avatar_url }` | ✅（User schema 三必要字段覆盖） |

**diff 结果**：字段 1:1 对齐 · 零遗漏零多余 · E.P0-2 达成。

### 4.2 /sync/pull 响应 diff

| OpenAPI SyncPullResponse L1129-1153 | sync.ts:25-36 SyncPullResponse | 状态 |
|---|---|---|
| `watermark: date-time` | `watermark: string` | ✅ |
| `has_more: boolean` | `has_more?: boolean` | ✅（optional 宽容 OK） |
| `changes.entries/categories/budgets/ledgers: array` | `changes: { entries?, categories?, budgets?, ledgers? }` | ✅（entity 使用 unknown[] · 因本卡不 consume · 未来 COSTRA-103 类型收敛） |

**diff 结果**：形状对齐 · type 侧本卡只做接口签名占位（见 sync.ts:78 注释）· OK。

### 4.3 Error schema diff（error-codes.md §1.1）

| error-codes.md 事实源 | request.ts toApiError | 状态 |
|---|---|---|
| `code: ErrorCode` | `e.code = serverCode \|\| CLIENT_HTTP_...` | ✅ |
| `message: string` | `e.message` | ✅ |
| `trace_id: string`（snake） | `e.traceId = raw.trace_id`（camel 映射） | ✅ |
| `details: object`（可选） | `e.details = raw.details` | ✅ |

**diff 结果**：顶层 4 字段对齐 · snake→camel 映射清晰 · E.P0-5 达成。

---

## 5. 评分（总分 35）

| 维度 | 满分 | 得分 | 理由 |
|---|---|---|---|
| 契约对齐 | 8 | 8 | OpenAPI AuthTokenPair/Error/SyncPullResponse 三处 1:1 diff · 零幻觉 |
| 代码正确性 | 6 | 6 | typecheck 绿 + 13 单测绿 · toUtcIso + decimal.js 硬验证点均覆盖 |
| 架构与分层 | 5 | 4 | 扣 1：error-mapper.ts 落地但业务层未接入（P2-3）· 抽象与消费脱节 |
| 数据与同步 | 5 | 4 | 扣 1：sync.ts watermark 语义骨架化（合理）· 但 setCursor 的 "拉后推进" 在多次 pull 失败 + 部分成功时的语义未明注释 · 留给 COSTRA-103 OK 但可加 FIXME |
| 安全 | 5 | 5 | code 日志脱敏 · Idempotency-Key 幂等键 · CLIENT_ 前缀隔离 · Authorization 头正确注入 |
| 可测性 | 4 | 3 | 扣 1：单测 13 条 · 覆盖面好 · 但缺 request.ts 401→续签→重放 链路集成测试（单测难 · 可接受 · 但扣分体现"可以做得更好"） |
| 纪律 | 2 | 1 | 扣 1：dispatch 产出清单外额外交付 error-mapper.ts（INFO-D）虽合理但属纪律违规（正确做法是发 review_request 给 Orchestrator 追加 dispatch）· 影响度量一致性 |

**总分 31/35** · 等级 **APPROVE-WITH-FOLLOWUPS**（≥ 30 判 APPROVE · 31-33 带 FU 不拦收口）

---

## 6. Reviewer 最终意见

### 6.1 决议

**APPROVE-WITH-FOLLOWUPS** · 进入 Human T1 终审 · 无需二轮 Revise。

### 6.2 理由

1. **DoD 11 条 + COSTRA-118 分流 16 条全部达成 · 零 P0 · 零越权**
2. **契约对齐工具级 diff 零漂移**（见 §4 三处 diff 表）
3. **三绿灯硬凭证**（typecheck + 13 单测 + 能力边界扫描）
4. **偏离项处置合理**：INFO-B 事实源优先原则正确；INFO-C 已有 FU；INFO-D 补齐合规锚点
5. **P1 × 2 全非阻塞**（UI UX 微调 + 未来 Sprint 才触发的后端兼容）· P2 × 3 小修（可下个卡顺手）

### 6.3 转 Human 的待决事项

- [ ] **Human 2026-04-30 本地验证 20 分钟**（按 `docs/qa/costra-102-human-verify.md` 5 步）
- [ ] 验证通过后发 `approve:COSTRA-102` → 整卡收口
- [ ] FU 新增 3 项（FU-102-PROFILE-REFUSE-UI · FU-102-PATCH-METHOD/升级为 FU-COMMON-MINIAPP-PATCH-LIMIT · FU-102-SYNC-PULL-DRIFT 升 Retro 议题）已由 Reviewer 登记

### 6.4 下一步

Orchestrator 将在**同一 tool call 循环**内：
- 追加 Review-Product 双签（D-014-b · D-016 合规）
- 更新 metrics/STATE/board/messages
- 追加 Follow-ups 索引条目
- 无异议时整卡进入 Human-Review 列 · 等 Human T1 终审 + 04-30 本地验证

---

**签字**：Review-Agent-Tech @ 2026-04-27 10:13  
**D-016 第 5 次实战观察**：Orchestrator 在 Human `approve-def:COSTRA-102` 触发后 · 同一 tool call 循环内完成 Agent 实装 + R1 Tech 双签 + 7+ 产物同步 · **合规达成**（规约自身高度稳定 · 连续五次零跨轮异步反模式）
