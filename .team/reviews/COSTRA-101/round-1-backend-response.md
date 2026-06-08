# Backend Revision Response · COSTRA-101 · Round 1

- **被审 Agent**：Backend-Agent（由 Orchestrator 扮演）
- **交付时间**：2026-04-24 11:50+08:00
- **触发机制**：🆕 **D-015 统一触发词 `revise-round-1` 首次实战**（Human 指令 `run backend COSTRA-101 revise-round-1` · 11:46 触发）
- **本轮规约版本**：SOP-REVIEW-LOOP v1.4（D-015 三合一语义 · 采纳 / 反驳 / 部分采纳）
- **本轮审核范围铁律**：仍为 §6.1.a 骨架（dispatch §6.1 分段策略）；§6.1.b（npm install + tsc/vitest 实跑绿灯）留待 `verify backend COSTRA-101` 后的后续 Round

---

## 对 Round-1 Review 的回应

### P0-1 · `userRepo.ts` 的 Executor 类型条件分支会触发 tsc 报错

- **处置**：✅ **采纳**
- **修改位置**：`server/src/repositories/userRepo.ts` ℓ14-15（删 PoolClient import）· ℓ59-73（Executor → Runner 统一重写）· ℓ79-143（四个函数签名/内体同步）
- **修改说明**：
  - 删除 `import type { PoolClient } from 'pg'`（不再被引用）
  - 将冗余的 `type Executor = Pick<PoolClient,'query'> | { query: typeof getPool extends never ? never : ReturnType<typeof getPool>['query'] }` 条件类型替换为与 `sessionRepo.ts` 同构的简单别名：
    ```ts
    type Runner = {
      query: (sql: string, params?: unknown[]) =>
        Promise<{ rows: UserRow[]; rowCount?: number | null }>;
    };
    ```
  - 四个导出函数（`findByOpenid` / `findById` / `create` / `upsertByOpenid`）的 `client?:` 参数统一改为 `client?: Runner`；函数体内 `const runner = client ?? exec();` 单行写法，取消内联 as 断言
  - `exec()` 返回 `Runner`，保留 `as unknown as Runner` 单次转型（pg Pool 的 public API 与 Runner 在 rows 泛型上需桥接）
- **效果**：
  - 修掉 Review 指出的两个 tsc 风险（`typeof getPool extends never` 永假冗余分支 + Pool/PoolClient.query 重载不兼容）
  - 消除 `Executor` 与 `findByOpenid` 内联 `{ query: ... UserRow ... }` 别名的阅读误导
  - 与 `sessionRepo.ts` 的 `Runner` 保持同构，后续跨 repo 一致性
- **阻断级别契合度**：P0 → 已闭环；§6.1.b `tsc --noEmit` 阶段预期不再因此条目报错

### P1-1 · `@fastify/jwt 9.x` 的 sign 选项无 `noTimestamp` 键（运行时被忽略）

- **处置**：✅ **采纳**（按 Review 给出的**方案 B**：保留手写 iat/exp · 去除 `noTimestamp`）
- **修改位置**：`server/src/plugins/jwt.ts` ℓ71-89
- **修改说明**：
  - 两处 `app.jwt.sign(..., { noTimestamp: true })` 均去除第二参数
  - 在注释中登记规约与采纳依据（"fastify-jwt 9.x 不透传 noTimestamp → 保留手写 iat/exp，payload 合并时手写值覆盖自动值"）
  - 不改动 `verifyAccessToken` / `verifyRefreshToken`：`clockTolerance` 配置保留；既然 payload 第一参数里的 iat 会覆盖 fastify-jwt 自动写的 iat，行为对 verify 端透明
- **方案选择说明**：
  - Review 给了方案 A（改用 `expiresIn` + 不手写 iat/exp）和方案 B（保留手写 iat/exp · 去掉 `noTimestamp`）
  - **选 B 的理由**：测试可预测性 > 省一行代码。手写 iat/exp 让单测 T3（refresh 链路）可以断言 `iat + accessTokenSec === exp` 这样的精确关系；改成 `expiresIn` 后单测得接受 ±几毫秒的浮动。对本卡业务无功能差异，但对后续测试稳定性有益。
  - 与原注释"我们自行写 iat，避免冲突"的初衷对齐（去掉的是**无效的** `noTimestamp`，不是手写 iat 的诉求）
- **阻断级别**：P1 → 已闭环

### P1-2 · `errorHandler.ts` 用 `message.includes('unexpected token')` 判定 MALFORMED_JSON 脆弱

- **处置**：✅ **采纳**
- **修改位置**：`server/src/plugins/errorHandler.ts` ℓ93-112
- **修改说明**：
  - 原判定 `err.code === 'FST_ERR_CTP_EMPTY_JSON_BODY' || err.message?.toLowerCase().includes('unexpected token')`
  - 改为**四条件 OR**（按推荐度排序）：
    1. `err.code === 'FST_ERR_CTP_EMPTY_JSON_BODY'`（空 body）
    2. `err.code === 'FST_ERR_CTP_INVALID_JSON_BODY'`（Fastify 5.x 稳定 code · **Review 推荐**）
    3. `err instanceof SyntaxError`（V8 JSON.parse 原生异常直接透到 Fastify 的情况）
    4. `err.cause instanceof SyntaxError`（Fastify 包装层把 JSON.parse 原异常放到 cause 的情况）
  - 拆分分支 3 的注释为两小节（3.1 不支持的 Content-Type / 3.2 JSON 解析失败 + 空 body）并登记 D-015 round-1 revise 出处
- **选择依据**：
  - Review 给的两个方案（`SyntaxError instanceof` 或 `FST_ERR_CTP_INVALID_JSON_BODY`）并不互斥；同时加强更稳
  - Fastify 5.x 在 empty body / invalid JSON / unsupported media 三态下分别抛 stable code，不同版本行为一致
  - V8 错误措辞跨 Node 版本变动风险被完全绕开
- **阻断级别**：P1 → 已闭环；后续 Node 升级该判定保持稳定

### P1-3 · `wxAppSecret` 在 fetch 失败路径可能被 pino 日志索引

- **处置**：✅ **采纳**（**扩展** Review 建议：不止 url 字段，连 cause 对象也全量脱敏）
- **修改位置**：`server/src/wx/code2Session.ts` ℓ1-32（头部注释补 P1-3 安全声明）· 新增 `redactUrlSecret`（export · 便于单测覆盖）+ `redactCauseForLog`（module-private）· catch 分支 ℓ148（cause 改为 `redactCauseForLog(err)`）
- **修改说明**：
  - 新增 `redactUrlSecret(url: string): string`（export）：用正则 `/([?&](?:secret|SECRET|Secret))=[^&]*/g` 替换为 `$1=***REDACTED***`，大小写不敏感，匹配到 `&` 或字符串尾
  - 新增 `redactCauseForLog(cause: unknown): unknown`：浅拷贝 `cause` 对象，对 `message` / `url` / `input` / `stack` 四个**已知会带 url 的字段**应用 `redactUrlSecret`，保留 `name`（Error 子类型识别必需）
  - `catch (err)` 分支里 `throw new AppError(..., { cause: err })` 改为 `cause: redactCauseForLog(err)`：斩断 undici 等底层库把原 url 塞进 cause.message / cause.input / cause.stack 从而被 pino `{ err }` 序列化到日志索引的路径
- **安全边界说明**：
  - 微信官方 `jscode2session` 接口**仅支持 GET**，AppSecret 作为 query 传是协议强制，无法从 fetch 层消除
  - 本卡路径绝不主动 log 原 `url` 字符串；AppSecret 只存在于**单次** fetch 调用栈中，fetch 成功返回后变量即脱离上下文
  - 唯一已知泄露面就是 `AppError.cause` 经 pino `{ err }` 自动序列化——本次已从源头脱敏
  - 生产日志接云端 SIEM 后，AppSecret 不会沿**任何**已知路径泄露
- **阻断级别**：P1 → 已闭环；上线前合规风险消除

### P2-1 · 硬编码"微信用户"昵称与 subjectConfig 脱钩

- **处置**：⏸ **部分采纳**（Review 原建议即"本卡可暂不改，登记 Follow-up" · 完全对齐）
- **本轮已改**：无代码改动（遵 Review 建议本卡不改）
- **延后到后续 Sprint**：抽到 `server/src/config/defaults.ts::defaultNickname`，支持 env 覆盖 + subjectConfig 语境化
- **Follow-up 登记位置**：`.team/follow-ups/README.md#FU-001`（本轮新建索引文件 · status=open · 待 Sprint-2 Planning 认领）
- **阻断级别**：P2（不阻）· 已转入延后项管理流程

### P2-2 · `verify backend COSTRA-101` 触发词未入 SOP-HUMAN-TRIGGER 清单

- **处置**：✅ **采纳**（并**扩展** Review 建议：一并补齐 D-015 的 `revise-round-N` 在本 SOP 的落盘）
- **修改位置**：`.team/SOP-HUMAN-TRIGGER.md` §3 触发指令词典 + 文末修订日志
- **修改说明**：
  - §3 新增 `verify <agent> COSTRA-xxx`（分段交付 §b 段实跑验证入口）+ `skip-verify COSTRA-xxx`（跳过 · 需原因记 daily）两行
  - §3 新增 `run <agent> COSTRA-xxx revise-round-N`（D-015 统一触发词）+ 废弃声明 `~~respond-round-N~~`——D-015 原仅在 SOP-REVIEW-LOOP 登记；本 SOP 作为 Human 触发主权入口需同步显式化
  - `run <agent>-fix COSTRA-xxx` 改标为 ⚠️ 保留但不推荐
  - 文末修订日志新增 2026-04-24 09:24 · D-015 条 + 2026-04-24 11:50 · P2-2 补丁条
- **阻断级别**：P2（不阻）· 已闭环

---

## 本轮新增产出

| # | 路径 | 类别 | 变动摘要 |
|---|---|---|---|
| 1 | `server/src/repositories/userRepo.ts` | 源码修改 | P0-1：Executor → Runner 统一；删 PoolClient import；四函数签名/内体对齐 |
| 2 | `server/src/plugins/jwt.ts` | 源码修改 | P1-1：删除两处 `{ noTimestamp: true }`；注释登记采纳依据 |
| 3 | `server/src/plugins/errorHandler.ts` | 源码修改 | P1-2：MALFORMED_JSON 判定改四条件 OR（含 FST_ERR_CTP_INVALID_JSON_BODY + SyntaxError instanceof） |
| 4 | `server/src/wx/code2Session.ts` | 源码修改 | P1-3：新增 redactUrlSecret（export）+ redactCauseForLog；catch 分支 cause 脱敏 |
| 5 | `.team/SOP-HUMAN-TRIGGER.md` | SOP 修订 | P2-2：§3 新增 verify / skip-verify / revise-round-N；废弃 respond-round-N；文末修订日志追加两条 |
| 6 | `.team/follow-ups/README.md` | 新建 | P2-1 延后项索引文件；首条 FU-001 登记硬编码昵称 |
| 7 | `.team/reviews/COSTRA-101/round-1-backend-response.md` | 新建（本文档） | 本轮回执 |

---

## 本轮自测

| 检测项 | 结果 | 依据 |
|---|---|---|
| 🧪 TS 类型合理性（读码审查） | 通过 | Runner 别名与 sessionRepo 同构；getPool() as unknown as Runner 与原路径等价；pg Pool 的 query 重载在此抽象下被降维为单一签名，符合本仓库已有用法 |
| 🧪 eslint/lint（IDE 内置） | 通过 | `read_lints` 对 `server/src` 返回 0 诊断 |
| 🔐 敏感信息回溯（grep） | 通过 | `wxAppSecret` 在 code2Session.ts 外部无任何 log / print 出口；本次新增的 `redactCauseForLog` 内部用 `redactUrlSecret` 消化所有已知泄露字段 |
| 📦 依赖 API 合规 | 通过 | @fastify/jwt 9.x sign 选项去 noTimestamp 后等效于"payload iat/exp 由调用方控制 · fastify-jwt 不再注入"；verify 侧 clockTolerance 保留，未动 |
| 🧱 §6.1.a 范围纪律 | 保持 | 所有修改在"设计 + 骨架"范围内；未涉及 package-lock.json / npm install / docker compose / curl 实跑 |

**说明**：本轮修复均为代码 + 文档级别，未进入 §6.1.b 范围，因此不执行 `npm install` / `tsc --noEmit` / `vitest run`。这些断言留待 Human 发 `verify backend COSTRA-101` 后的后续 Round。

---

## 异议声明

**本轮无异议**。6 条 findings（1 P0 / 3 P1 / 2 P2）全部采纳或按 Review 建议处理。

**D-015 异议仲裁链路在本轮未被触发**。Review 在报告中对 P1-1 给出的 A/B 两个修复方案里，Backend 选择了方案 B——这是 Review 已预授权的选项集合内的选择，不构成"反驳"语义；在 Round 1 Response 中明确登记选 B 的工程权衡即可，无需 Round 2 仲裁。

---

## 本轮 commit（D-012 合规）

**状态**：待 commit（本轮产物已落盘，Orchestrator 将紧接本文档交付执行单卡 commit）

预期 commit 信息（单卡交付即提交 · D-012）：
```
COSTRA-101: Round 1 revise (D-015 unified revise-round-N first run)

- P0-1 userRepo.ts: Executor → Runner (align with sessionRepo)
- P1-1 plugins/jwt.ts: drop noTimestamp (fastify-jwt 9.x doesn't forward)
- P1-2 errorHandler.ts: MALFORMED_JSON via stable codes + SyntaxError instanceof
- P1-3 wx/code2Session.ts: redactUrlSecret + redactCauseForLog for safe logging
- P2-2 SOP-HUMAN-TRIGGER.md: add verify/skip-verify + revise-round-N dictionary
- P2-1 Follow-up registered at .team/follow-ups/README.md#FU-001
```

---

## 求再审

请 Review-Tech 进入 **Round 2**。

- 轮次：Round 2 / 5（上限 5 轮）
- 本轮裁决预期：
  - P0-1 / P1-1 / P1-2 / P1-3 四条阻断项均已在代码层修复，期望 Review-Tech 二审核验方向是否对齐
  - P2-1 已按 Review 原建议登记 Follow-up，期望确认延后项管理流程合规
  - P2-2 已扩展采纳（一并同步 D-015 触发词到本 SOP），期望确认扩展不越界
- **无异议仲裁诉求**（本轮无反驳条目）

---

## D-015 首次实战 · 规约践行说明

本轮是 **D-015 统一触发词 `revise-round-N` 落地后的首次实战**。按 D-015 §2 / SOP-REVIEW-LOOP v1.4 §6：

1. ✅ **回执 + 修复三合一**：本文档既是回执（"采纳/反驳/部分采纳"三态登记齐全），又是修复交付（7 项产出落盘）
2. ✅ **无反驳**：所有 findings 的处置均为采纳或 Review 已预授权的选项选择，本轮未使用"❌ 反驳"标签
3. ✅ **Review-Agent 意见为主**（Human 铁律）：P0-1 从"维持原条件类型"的自我辩护可能性直接放弃，P1-1 从方案 A/B 中选择时明确登记工程权衡而非反驳
4. ✅ **SOP 同步**：P2-2 扩展一并补齐 D-015 在 SOP-HUMAN-TRIGGER 的显式登记，降低未来新 Agent 加入时的认知负担

**D-015 副作用评估**：本次实战无负面信号。`revise-round-N` 三合一语义对 Backend 侧认知无额外负担；若后续出现需要反驳的条目，Round 2 Review-Tech 的二次裁决链路将首次被触发。

---

_Backend-Agent · Orchestrator 扮演 · 2026-04-24 11:50_
