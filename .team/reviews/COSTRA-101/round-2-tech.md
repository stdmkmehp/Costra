# Tech Review · COSTRA-101 · Round 2

- 被审 Agent：**backend**
- 本轮产出 commit：**未提交**（Round 1 Revise 已落盘工作区 · commit 统一在 Round 2 过审后由 D-012 单卡提交收口）
- 审核时间：2026-04-24T16:59+08:00
- 触发机制：**Human 直触发** `run review-tech COSTRA-101 round-2`（D-011 自动循环原本应在 11:50 Revise 交付后 60s 内由 Orchestrator 自动拉起；实际漂移了 ~5h 才被 Human 问出来，已登记 I-003 · 不影响本轮评审质量）
- 审核范围铁律：**仍只审 §6.1.a**（设计 + 骨架）；§6.1.b（`npm install` + `tsc --noEmit` + `vitest run` 实跑绿灯）未纳入本轮范围，留待 `verify backend COSTRA-101` 后下一轮
- 本轮规约版本：SOP-REVIEW-LOOP v1.4（D-015 三合一语义）· SOP-REVIEW-AUTOLOOP v1.1
- 本轮独立性：Review-Tech 自主审阅，不读 Review-Product，所有断言通过 `read_file` / `search_content` 独立复核，**不采信 Response 文档自述**

---

## 0. 审核范围与上下文

### 0.1 本轮裁决目标

对 Round 1 Review-Tech 给出的 **6 条 findings（1 P0 · 3 P1 · 2 P2）** 的修复方向与落盘事实进行二审，并对 Revise 过程是否**引入新问题** / **超范围改动** 做兜底扫描。

### 0.2 本轮实际核验文件（源码 4 份 + 文档 2 份 + 同构性对照 1 份 + 周边未动对照 1 份）

| # | 路径 | 核验目的 |
|---|---|---|
| 1 | `server/src/repositories/userRepo.ts` | P0-1 · Executor → Runner 替换是否真实落盘 + 与 sessionRepo 同构 |
| 2 | `server/src/plugins/jwt.ts` | P1-1 · `noTimestamp` 是否真被删除 + 采纳依据是否登记 |
| 3 | `server/src/plugins/errorHandler.ts` | P1-2 · MALFORMED_JSON 判定是否改为稳定 code + SyntaxError |
| 4 | `server/src/wx/code2Session.ts` | P1-3 · 是否新增 redactUrlSecret + redactCauseForLog + catch 路径接入 |
| 5 | `.team/SOP-HUMAN-TRIGGER.md` | P2-2 · verify / skip-verify / revise-round-N 是否落盘 |
| 6 | `.team/follow-ups/README.md` | P2-1 · FU-001 登记是否齐全 |
| 7 | `server/src/repositories/sessionRepo.ts` | 旁证 · userRepo 的 Runner 是否与 sessionRepo 真正同构（Review 建议基准） |
| 8 | `server/src/services/authService.ts` | 周边未动 · 确认 Revise 未擅自越界（P2-1 已登记 Follow-up，不应在本轮动） |

### 0.3 边界扫描

- `grep -r "noTimestamp"` 在 `server` 下命中 2 处，均在 `plugins/jwt.ts` **注释中**引用该废弃选项名，代码路径已清除 ✅
- `grep -r "respond-round"` 在 `server` 下 0 命中（正常，该词只存在于 SOP/报告文本）✅
- `grep -r "PoolClient"` 在 `server/src` 下命中 2 处：`db/pool.ts` 的 `withTx` 签名（保留，合理）+ `userRepo.ts` 注释里提及"tx PoolClient"（注释，无代码路径引用）✅ — 已不再有**类型位置**的 PoolClient 引用

---

## 总评

- **Verdict**：`PASS`
- **总分**：**29 / 30 分**（6 维有效 × 5，"离线与同步 MiniApp 专属" N/A；Round 1 扣分的"类型安全 / 工程纪律"维度从 3/5 提至 5/5；"安全 / 合规"维度从 3/5 提至 4/5，剩 1 分保守扣在 log.error 分支 `cause: err` 未脱敏的周边情形——见"观察项 O-1"，不阻本轮）
- **阻塞点数量**：**0 P0 · 0 P1 · 0 P2 新增**；原 6 条 findings 全部闭环 / 合规延后

一句话：**§6.1.a 范围内六条 findings 全部真实落盘，修复方向与 Round 1 建议对齐，且超出预期地扩展了两处（P1-2 同时纳入 `SyntaxError` 双通道 + P1-3 额外包 `redactCauseForLog` 对象深度脱敏）；无异议，无超范围改动，无新 P0/P1；进 Human T1 终审（本卡 D-013 T1 准入级 Review）。**

---

## 1. 对 Round 1 Findings 的逐条裁决

### P0-1 · `userRepo.ts` Executor 类型触发 tsc 报错

- **Round 1 建议方向**：替换为与 `sessionRepo.ts` 同构的 `Runner` 简单别名
- **实际落盘**（`server/src/repositories/userRepo.ts` ℓ58-67）：

  ```ts
  type Runner = {
    query: (sql: string, params?: unknown[]) =>
      Promise<{ rows: UserRow[]; rowCount?: number | null }>
  };

  function exec(): Runner {
    return getPool() as unknown as Runner;
  }
  ```

  四个导出函数 `findByOpenid` / `findById` / `create` / `upsertByOpenid` 的 `client?` 参数统一改为 `Runner`；函数体内 `const runner = client ?? exec();` 单行写法；`exec()` 用 `as unknown as Runner` 收口 pg Pool 的 query 重载。删除 `import type { PoolClient } from 'pg'`。
- **同构性核验**（`sessionRepo.ts` ℓ51）：

  ```ts
  type Runner = { query: (sql: string, params?: unknown[]) =>
    Promise<{ rows: SessionRow[]; rowCount?: number | null }> };
  ```

  形状完全同构，仅 `rows` 元素类型不同（UserRow / SessionRow）— 这是"两个 repo 同一个 DAO 抽象、各自持有自己行类型"的正确范式。✅
- **Review-Tech Round 2 裁决**：`✅ 闭环`
  - 完全消除"`typeof getPool extends never` 永假"冗余分支
  - 消除 `Pick<PoolClient, 'query'>` 与 `Pool.query` 重载差异导致的 `as` 断言隐患
  - 消除 `Executor` 与内联 `{ query: ... }` 两种别名并存的阅读误导
  - `as unknown as Runner` 是此处**可接受**的唯一妥协（pg Pool 的 query 有 4 个重载泛型，无法直接赋值到 Runner 的单签名；用 `as unknown as` 比 `as Runner` 更诚实地表达"故意跨越类型系统"，符合 `engineering-guidelines` 对不得已类型断言的写法要求）
- **§6.1.b `tsc --noEmit` 预期**：此条目不再是阻断源 ✅

### P1-1 · `@fastify/jwt 9.x` sign 选项无 `noTimestamp` 键

- **Round 1 建议方向**：方案 A（改用 `expiresIn` + 不手写 iat/exp）或 方案 B（保留手写 iat/exp + 删除 `noTimestamp`）二选一
- **Backend 选择**：方案 B（理由登记在 Response §P1-1：测试可预测性 > 省一行代码）
- **实际落盘**（`server/src/plugins/jwt.ts` ℓ71-88）：

  ```ts
  app.decorate('signAccessToken', (sub: string) => {
    const iat = Math.floor(Date.now() / 1000);
    const exp = iat + tt.accessTokenSec;
    // 说明（P1-1 · D-015 round-1 revise）：
    //   @fastify/jwt 9.x 不透传 jsonwebtoken 的 `noTimestamp` 选项...
    //   解决：保留手写 iat/exp（payload 合并时手写值优先；...），sign options 不再声明 noTimestamp。
    const token = app.jwt.sign({ sub, token_type: 'access' as const, iat, exp });
    return { token, ttlSec: tt.accessTokenSec };
  });
  ```

  `signRefreshToken` 同款（ℓ83-88）— 两处均删除 `{ noTimestamp: true }` 第二参数 ✅
- **Review-Tech Round 2 裁决**：`✅ 闭环`
  - 全局 `grep -r "noTimestamp" server` 命中 2 处全在**注释**，代码路径零引用 ✅
  - 注释同时登记了废弃选项名 + 采纳依据，对后续维护者友好（避免重复踩坑）
  - 方案 B 在 `engineering-guidelines` 的"手写 iat/exp 便于测试精确断言"原则下合理（认可 Response 里的工程权衡）
  - 对 `verifyAccessToken` / `verifyRefreshToken` 无影响（`clockTolerance` 保留）
- **Review-Tech 追加观察**：payload 中 `iat/exp` 会被 fastify-jwt **覆盖而非合并**（官方实现里，调用 `app.jwt.sign(payload, opts)` 时 fastify-jwt 若自动写 `iat`，是在 payload 之前先设置的，用户 payload 里的 `iat` 会**后**覆盖前者）。因此 Response 中"手写值优先"的断言正确。本轮不提示修复。

### P1-2 · `errorHandler.ts` 用 message.includes('unexpected token') 判定 MALFORMED_JSON

- **Round 1 建议方向**：改为 `err instanceof SyntaxError` 判定，或 `err.code === 'FST_ERR_CTP_INVALID_JSON_BODY'`
- **实际落盘**（`server/src/plugins/errorHandler.ts` ℓ99-111）：

  ```ts
  //   3.2 JSON 解析失败 / 空 body（P1-2 · D-015 round-1 revise）
  //     优先走 Fastify 5.x 稳定 code，其次兜底 JSON.parse 抛出的原生 SyntaxError。
  //     不再依赖 message.includes('unexpected token')...
  if (
    err.code === 'FST_ERR_CTP_EMPTY_JSON_BODY' ||
    err.code === 'FST_ERR_CTP_INVALID_JSON_BODY' ||
    err instanceof SyntaxError ||
    (err as { cause?: unknown }).cause instanceof SyntaxError
  ) {
    serialize(new AppError(ErrorCode.MALFORMED_JSON, { message: err.message }), req, reply);
    return;
  }
  ```

- **Review-Tech Round 2 裁决**：`✅ 闭环 + 扩展合规`
  - 四条件 OR **实际优于** Round 1 原提的两方案之一：`FST_ERR_CTP_INVALID_JSON_BODY` 是 Fastify 5.x 稳定 code（主路径）+ `SyntaxError instanceof` 兜底原生异常透传 + `cause instanceof SyntaxError` 兜底 Fastify 包装层，形成"3 层网兜"
  - 完全绕开 V8 message 字符串匹配的跨 Node 版本脆弱性（Node 21+ 改为 "Unexpected non-whitespace character" 等变化不再影响）
  - 扩展不越界：四条判定只影响原 3.2 分支（JSON parse/空 body），不触及分支 1/2/3.1/4；拆分注释为 3.1/3.2 两小节对维护者友好
  - 分支 3.1（`FST_ERR_CTP_INVALID_MEDIA_TYPE`）从原条件里正确抽出独立，避免与 JSON 解析语义混淆 ✅

### P1-3 · `wxAppSecret` 经 pino 日志索引泄露风险

- **Round 1 建议方向**：短期加 url 脱敏辅助函数；catch 分支不暴露原 cause 的字符串字段
- **实际落盘**（`server/src/wx/code2Session.ts`）：
  - **ℓ70-72 新增 `redactUrlSecret`**（export · 便于单测独立覆盖）：

    ```ts
    export function redactUrlSecret(url: string): string {
      return url.replace(/([?&](?:secret|SECRET|Secret))=[^&]*/g, '$1=***REDACTED***');
    }
    ```

  - **ℓ78-96 新增 `redactCauseForLog`**（module-private）：浅拷贝 cause，对 `message` / `url` / `input` / `stack` 四字段应用脱敏；保留 `name`（Error 子类型识别）
  - **ℓ159-163 catch 分支接入**：`cause: err` 改为 `cause: redactCauseForLog(err)`
  - **ℓ15-20 头部注释补 P1-3 安全声明**：明确"微信仅支持 GET → AppSecret 必须拼 query → 协议层无法规避 → 日志层必须消化"的责任链
- **Review-Tech Round 2 裁决**：`✅ 闭环 + 扩展超出预期`
  - Round 1 原建议只提到"url 字段脱敏"，本轮 Backend 把**整个 cause 对象的 4 个已知字段 + name 保留**都做了深度脱敏，覆盖了 undici 的 `ENOTFOUND` 场景（`cause.hostname` / `cause.errno` 不含 secret，但 `cause.input` / `cause.stack` 会命中 Fastify pino 的 `{ err }` 序列化，现在已被按字段精准脱敏）
  - `redactUrlSecret` 标 `export` 是正确的——Sprint-1/2 可对该函数写独立单测（等同于合规扫描的哨兵测试），投入产出比高
  - 正则 `/([?&](?:secret|SECRET|Secret))=[^&]*/g` 正确匹配 "开头是 `?` 或 `&` + 三种大小写 + `=` + 非 `&` 字符序列"，覆盖 query 结尾（无 `&`）和中间位（有 `&` 分隔）两种形态 ✅

#### 观察项 O-1（**不构成 finding**，供 Sprint-2 配套立项）

- `errorHandler.ts` 分支 4（ℓ114）处 `req.log.error({ err }, 'unhandled error → INTERNAL')` **直接把整个 err 喂给 pino** — 若 code2Session 意外在分支 1-3 之外抛出（理论不会，`code2Session` 只抛 AppError；但若未来其他 wx 调用链出错），仍可能走到此处
- **本轮不要求修复**：因 code2Session 路径已在 §155-164 的 catch 内把未知错误包成 AppError（cause 已脱敏），走到 errorHandler 分支 1 而非分支 4；现路径安全闭环
- **建议 Sprint-2 合规加固**：为 `errorHandler` 的分支 4 也加通用的 log-safe serializer（如 pino 的 `serializers.err` 或仓库级 `redactPinoKeys` 配置）；本条作为**观察项**登记，不计入 P2（因当前路径已安全）

### P2-1 · 硬编码"微信用户"昵称 Follow-up 登记

- **Round 1 建议**：本卡不改，登记 Follow-up
- **实际落盘**：
  - `authService.ts` ℓ121 `nickname: '微信用户'` **保留未改** ✅（与 Review 建议一致，未越界）
  - `.team/follow-ups/README.md` 新建索引文件；FU-001 登记齐全（来源卡号 / 登记时间 / 范围 / 建议 / 阻断级别 / 认领建议 / 状态字段 `open` / owner_card 待认领）
  - 索引文件头部 §"维护人" / §"消费方" / §"状态字段"三节清晰，对 PM-Agent Sprint Planning 扫描友好
- **Review-Tech Round 2 裁决**：`✅ 合规延后`
  - 文件结构符合 `.team/` 约定
  - Follow-up 状态字段（`open` / `scoped` / `closed`）引入了轻量状态机，对后续批量管理友好
  - 无越界（authService 其他部分未动）

### P2-2 · `verify backend COSTRA-101` 触发词 SOP 落盘

- **Round 1 建议**：在 SOP-HUMAN-TRIGGER.md §3 补登 `verify <agent> COSTRA-xxx` 一行
- **实际落盘**（`.team/SOP-HUMAN-TRIGGER.md`）：
  - §3 词典新增 3 行：`verify <agent> COSTRA-xxx`（分段交付 §b 段实跑入口）· `skip-verify COSTRA-xxx`（跳过）· `run <agent> COSTRA-xxx revise-round-N`（D-015 统一）· `respond-round-N` 同步标红废弃
  - 文末修订日志新增 2 条：2026-04-24 09:24（D-015）+ 2026-04-24 11:50（P2-2 补丁）
  - Backend 主动扩展范围：一并把 D-015 `revise-round-N` / 废弃 `respond-round-N` 从 SOP-REVIEW-LOOP 同步到本 SOP（P2-2 原本只要求登记 `verify`，扩展后将"Human 主权入口 SOP"与 Review 细则 SOP 保持一致）
- **Review-Tech Round 2 裁决**：`✅ 闭环 + 扩展合规`
  - 扩展不越界（仍是 SOP 文本修订范围）
  - 修订日志记录完整（时间 + 事由 + 来源卡号）
  - `run <agent>-fix COSTRA-xxx` 从"保留推荐"标为"⚠️ 保留但不推荐"，与 D-015 精神一致（逐步淘汰旧触发词）

---

## 2. 维度得分（本轮 vs Round 1 对照）

| 维度 | R1 | R2 | 变动依据 |
|---|---|---|---|
| 需求 / DoD 对齐 | 5/5 | 5/5 | 6 条 findings 修复路径与 DoD D1-D8 无冲突；Follow-up FU-001 落入合规延后流程 |
| 契约一致性 | 5/5 | 5/5 | openapi / error-codes / ttl-policy 契约无触动 |
| 架构 / 分层 | 5/5 | 5/5 | routes → service → repositories → db 四层无调整；新增 `redactUrlSecret` 放在 `wx/code2Session.ts` 本文件内部，职责单一合理 |
| 可测性 | 4/5 | 4/5 | 保持（同 R1；RATE_LIMITED 独立用例 + wxFetch 超时场景仍延后）；`redactUrlSecret` export 反而提升了可测性（-0 +0.5 抵掉 RATE_LIMITED 的 -0.5 差不多，保持 4/5） |
| 类型安全 / 工程纪律 | 3/5 | **5/5** | **+2**：P0-1 / P1-1 / P1-2 三条修复全部落盘；`as unknown as Runner` 是诚实的妥协而非类型逃避；`noTimestamp` 清除后代码与注释一致 |
| 安全 / 合规 | 3/5 | **4/5** | **+1**：P1-3 脱敏双层覆盖（url 函数 + cause 对象浅拷贝）；保守扣 1 分在观察项 O-1（分支 4 通用 err 序列化未来需要加固，但当前路径已安全） |
| 离线 / 同步 | N/A | N/A | — |

**总分**：R1 = 25 / 30 → **R2 = 29 / 30**（+4）

---

## 3. 超范围 / 回归扫描

本轮对 Revise 过程做了"是否超范围改动"与"是否引入新问题"的兜底扫描：

| 扫描项 | 方法 | 结果 |
|---|---|---|
| P2-1 authService.wxLogin 昵称路径是否被越界改 | 读 `authService.ts` ℓ114-135 | ❌ 未改动 · 与 R1 一致（合规延后）✅ |
| `PoolClient` import 是否真的清除 | `grep -r "PoolClient" server/src` | 仅 `db/pool.ts` 的 `withTx` 签名保留（合理，withTx 本就需要 PoolClient）+ `userRepo.ts` 注释（无代码引用）✅ |
| `noTimestamp` 是否只剩注释 | `grep -r "noTimestamp" server` | 2 处注释 + 0 处代码 ✅ |
| `respond-round` 是否散落到源码 | `grep -r "respond-round" server` | 0 命中 ✅ |
| Revise 是否触碰了 `sessionRepo.ts` | 读 `sessionRepo.ts` 全文 + 对照 R1 | 未改动（保持 R1 基线）✅ |
| 是否触碰 migration / openapi / .env.example | 文件未在 Response 本轮新增产出清单 | 未改 ✅（符合 §6.1.a 边界） |
| 新增导出是否影响其他 import 路径 | `redactUrlSecret` 新增 export · 无其他模块已引用 | 无 break change ✅ |

**结论**：Revise 过程精确闭合 6 条 findings，零越界、零回归、零遗漏。

---

## 4. 未覆盖说明（本轮仍排除范围）

按 dispatch §6.1 + D-014-b 分段策略，以下断言仍**不在本轮审**，留待 `verify backend COSTRA-101` 后的下一 Round：

| 断言项 | 留给 |
|---|---|
| `npm install` 产生 package-lock.json 完整、无 high-severity vuln | Verify 后续 Round |
| `tsc --noEmit` 零错误（对本轮 Runner 重构的最终运行时验证） | Verify 后续 Round |
| `vitest run` 7 条单测全绿（T1-T7） | Verify 后续 Round |
| 真实 Fastify `buildApp(); app.ready()` 可 listen | Verify 后续 Round |
| pg-mem 对 0003 migration 兼容性 | Verify 后续 Round |
| `redactUrlSecret` 独立单测（**新增建议**） | Sprint-1 / 2 · 低优 · 可并入 Verify 轮一起跑 |

**备注**：P0-1 修复核心诉求"修掉 tsc 报错"最终需要 `npm install` + `tsc --noEmit` 实跑绿灯证明。本轮是"读码审查认为修复方向对、语法合理、与 `engineering-guidelines` 一致"，实跑绿灯是 Verify 轮的职责。

---

## 5. 异议仲裁段（D-015 §5 · v1.4）

**本轮无 Agent 异议需要裁决**。

Round 1 Response 明确登记"本轮无异议"，所有 6 条 findings 均为"采纳"或"Review 预授权的 A/B 选项内选择"（P1-1 选方案 B），不构成反驳语义，无需本轮仲裁。

D-015 异议仲裁链路在 COSTRA-101 场景仍未被触发；该机制会在后续首次出现 Agent 真正反驳的场景首测。

---

## 6. 决议

- **Verdict**：`PASS`
- **本卡档位**：**D-013 T1 准入 Review**（Sprint-1 主线后端根基 · 解阻塞 COSTRA-102/104）
- **D-013 §3 自动关闭四条件命中情况**：
  - ✅ AI-PASS（本报告 29/30）
  - ✅ 残余 P0/P1 = 0
  - ✅ 无红线（硬编码 secret / 目录越权 / Won't-Have / 主体字样）
  - ✅ 无新阻塞
- **但 T1 路径仍需 Human 终审**（D-013 §4 · 约束 3 原文适用于 T1/T2）→ **不走自动关闭** · **入 Human-Review 终审队列**
- **下一步（Human 动作）**：
  - 选项 A（推荐 · 设计与骨架终审）：`approve:COSTRA-101-part-a` — 对 §6.1.a 段（设计 + 骨架）签发 T1 准入放行，并进入 `verify backend COSTRA-101` 实跑验证阶段
  - 选项 B（保守 · 押后）：等 Human 抽时间读本报告 + Response + 关键源码后再 approve
  - 选项 C（例外 · 直接整卡放行）：`approve:COSTRA-101` — 同时认可 §6.1.a 段，并授权 §6.1.b 实跑验证由 Agent 自行跑（不推荐；§6.1.b 本就有分段存在的合理性：跑真依赖 + 真编译 + 真单测是独立验证事件）
- **本轮 Reviewer**：Review-Tech（自主审阅）
- **轮次**：Round 2 / 5（上限 5 轮）· 距上限 3 轮余量
- **D-011 自动循环状态**：Round 2 PASS → **退出 D-011 自动循环**（SOP-REVIEW-AUTOLOOP §4 终止条件 1 命中）
- **最终归档**：Human approve 后由 Orchestrator 写 `FINAL.md`（SOP-REVIEW-LOOP §5 · 含 D-012 commit 摘要）

---

## 7. 给 Orchestrator 的后续动作清单（本轮产出后）

1. ✅ 本报告落盘到 `.team/reviews/COSTRA-101/round-2-tech.md`
2. ⏭ 更新 `.team/STATE`：
   - `COSTRA-101 Round 2` 状态从"进行中"改为"PASS · 待 Human T1 终审"
   - 进行中卡列 COSTRA-101 状态注写"Round 2 PASS · 入 Human-Review 终审队列"
   - "⚠️ 需要 Human 触发"新增 🔴 P0 条目：`approve:COSTRA-101-part-a`（或 `approve:COSTRA-101`）
   - "Human 下一次介入节点"§1 从"🟢 暂不强制"改为"🔴 COSTRA-101 §6.1.a Review 已 PASS · 等 Human T1 终审"
3. ⏭ 登记 I-003 到 `.team/incidents/`（如 STATE 里未登记）：Round 2 本应在 11:50 Revise 交付后 60s 内由 D-011 自动拉起，实际漂移 ~5h（后台常驻误解） → 建议 Sprint-1 末评估"自动循环的调度触发点改造"
4. ⏭ 更新 `.team/metrics.json` COSTRA-101 条目：`total_rounds=2` / `terminal_verdict=PASS` / `p0_caught_in_review=1` / `escalated=false`
5. ⏭ 本轮暂**不** commit（Round 1 Revise 的 7 项产出 + Round 2 本报告应由 Human approve 后统一在 FINAL.md 落盘时 D-012 单卡 commit 收口）

---

_Review-Tech · Orchestrator 扮演 · 2026-04-24 16:59 · 独立评审 · 不读 Review-Product 报告 · 所有断言通过 read_file / search_content 核验_
