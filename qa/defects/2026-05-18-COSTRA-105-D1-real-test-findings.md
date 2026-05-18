# 缺陷单 · COSTRA-105 D.1 真链路实测发现（2026-05-18）

> **登记人**：Orchestrator（基于 Human 真链路实测会话现场记录 · ~30 分钟）
> **登记时间**：2026-05-18 19:5x
> **来源**：COSTRA-105 手册 v1.5 §4 步骤 D.1 push 链路诊断 · Human 真模拟器实测（方式 B 本地 server）
> **场景**：D-022 §4.1 runtime 类 T2 卡 Human 实测前置铁律首次实测真兑现立意（自动化 + curl + server 单测 30+ 全绿，但 Human 真链路实测 ~30 分钟内捕获 2 个真 P0 BUG + 4 个文档级 gap）
> **关联卡**：COSTRA-105（手册载体 · 已 review-tech APPROVE）/ COSTRA-103（client 责任域 · 已 CLOSED）/ COSTRA-104（server 责任域 · 已 CLOSED）
> **关联 FU**：FU-105-DEV-CONSOLE-HOOK（族 H · 新立 · miniapp-dev dev-only 调试钩子）

---

## §0 摘要（2 P0 真 BUG · 双责）

| BUG ID | 类别 | 严重度 | 责任域 | 一行描述 |
|---|---|---|---|---|
| **BUG-001** | client 字段填充 | 🔴 P0 | miniapp-dev | `pages/entry/index.ts` line 57+73 硬编码 `ledger_id: 'default'` 字符串字面量 · 应取真 UUID |
| **BUG-002** | server 入参校验 | 🔴 P0 | backend-dev | `routes/sync.ts` line 93 `payload` schema 用 `additionalProperties: true` · 完全无 UUID 格式校验 · 导致 PG 22P02 冒泡为 INTERNAL 500 |

> **联合触发链**：BUG-001 客户端写入字面量 `"default"` → outbox 入队 → push 到 server → BUG-002 server schema 不校验直接喂给 PG → PG 抛 22P02 invalid uuid → 错误冒泡 500。两 BUG 任一修复都能止血，但**最优解是双修**（深度防御）。

---

## §1 BUG-001 · client 端 ledger_id 硬编码 `"default"`（miniapp-dev）

### §1.1 现场证据

实测中 Console paste 取出 outbox op0：

```js
op0: {
  op: 'create', entity: 'entry',
  client_ref_id: '0101000d-0005-4400-8303-000304060303',
  base_version: null,
  payload: {
    amount: 100,
    category_id: null,
    currency: 'CNY',
    ledger_id: 'default',     // ← BUG · 字符串字面量
    note: '1',
    occurred_at: '2026-05-18T11:29:15.435Z',
    type: 'expense'
  },
  ...
}
```

### §1.2 代码定位

`miniprogram/pages/entry/index.ts`：

```ts
// line 54~62（写本地 storage）
await putEntry({
  client_ref_id: clientRefId,
  ledger_id: 'default',  // TODO(COSTRA-104): 从当前活跃账本取 ledger_id   ← BUG-001 现场
  amount: cents,
  ...
});

// line 70~78（写 outbox 队列）
{
  ...
  payload: {
    ledger_id: 'default',  // ← BUG-001 同源
    amount: cents,
    ...
  }
}
```

### §1.3 根因分析

- COSTRA-103 R1（client outbox 卡 · 2026-05-09 CLOSED）实装时已知此 TODO，注释明确写着"COSTRA-104 接续从当前活跃账本取"
- **COSTRA-104 R1（server backend · 2026-05-12 CLOSED）实装时未接续** —— 因 COSTRA-104 是 backend 责任域，没改 client；同时 COSTRA-104 R1 的 scope gap（FU-EPIC-FAMILY-LEDGER-CRUD · COSTRA-155 P0 8 点 · open）整体延后了 ledgers CRUD 接口实装
- 没有 ledgers CRUD → client 拿不到真账本列表 → entry-create 页只能用 placeholder `"default"`
- 这是 **scope gap 跨卡 fall-through 反例第 N 次**：3 月 PRD 写"单人记账"假设了 ledgers 已存在，但实际 ledgers CRUD 整体被延后到 Sprint-3 candidate (COSTRA-155)

### §1.4 修复方案（两阶段）

**阶段 1（紧急止血 · ≤ 1 小时 · 走 D-017 v3 §2.4 E1 例外路径单 commit）**：

`miniprogram/pages/entry/index.ts` line 57 + 73：

```ts
// 紧急修复：用 §0.4.6 seed 默认 ledger UUID（兼容 dev/test 实测）
// FU-EPIC-FAMILY-LEDGER-CRUD（COSTRA-155）实装真账本切换 UI 后 supersede 此 fallback
const FALLBACK_LEDGER_ID = '00000000-0000-0000-0000-000000000001';

// line 57:
ledger_id: getApp().globalData.activeLedgerId || FALLBACK_LEDGER_ID,
// line 73 同上
```

并在 `app.ts globalData` 加一个 `activeLedgerId?: string` 字段（COSTRA-155 时实装真填充逻辑）。

**阶段 2（COSTRA-155 内 · Sprint-3 P0 头部）**：实装 ledgers CRUD + entry-create 页选账本 dropdown · 删除 `FALLBACK_LEDGER_ID` 兜底。

### §1.5 验收

- 阶段 1 PASS 条件：实测重跑 D.1 真链路 push 200 + DB 落库（无需 paste 时手动覆盖 `ledger_id`）
- 阶段 2 PASS 条件：UI 能选账本 + 切换账本 + 多账本写入互不污染

---

## §2 BUG-002 · server 端 sync/push payload 不校验 UUID 格式（backend-dev）

### §2.1 现场证据

server 端错误日志（含 trace_id `1e5b023d-...`）：

```json
{
  "level": 50,
  "err": {
    "type": "DatabaseError",
    "message": "invalid input syntax for type uuid: \"default\"",
    "stack": "...at Object.findByLedgerAndClientRefId (.../entryRepo.ts:286:15)\n    at async Object.createWithIdempotency (.../entryService.ts:146:24)\n    at async processEntryOp (.../sync.ts:109:20)",
    "code": "22P02",
    "routine": "string_to_uuid"
  },
  "msg": "unhandled error → INTERNAL"
}
```

响应：`HTTP 500 {code: "INTERNAL", message: "internal server error", trace_id: "..."}`

### §2.2 代码定位

`server/src/routes/sync.ts` line 86~98（`syncPushBodySchema`）：

```ts
const syncPushBodySchema = {
  type: 'object',
  required: ['ops'],
  properties: {
    ops: {
      type: 'array',
      items: {
        type: 'object',
        required: ['op', 'entity', 'client_ref_id'],
        properties: {
          op: { type: 'string', enum: ['create', 'update', 'delete'] },
          entity: { type: 'string' },
          client_ref_id: { type: 'string' },
          base_version: { type: ['integer', 'null'] },
          payload: { type: 'object', additionalProperties: true },  // ← BUG-002 现场
        },
      },
    },
  },
} as const;
```

`payload` 直接放行所有字段，无 UUID 格式校验。

### §2.3 根因分析

- COSTRA-104 R1 实装时为了"快速实现"用了 `additionalProperties: true` 模式
- ajv 的 `format: 'uuid'` 校验需在 schema 显式声明（fastify ajv 默认开启 format · 只需在 properties 加 `format: 'uuid'`）
- server 单测（20 tests · 含 entry create / push / idempotency）**全部用合法 UUID 跑** · 漏掉了"非合法 UUID 字符串"测试矩阵
- curl 实测（COSTRA-104 v1.5 5 步 + 3 硬断言）**全部用合法 UUID** · 漏掉了 fuzz / 字符串字面量 case
- 这是 **D-022 §C8 端到端契约联调可达性维度的反例**：自动化 + curl 都漏过 client 端真实 payload 的 fuzz 数据

### §2.4 修复方案（两阶段）

**阶段 1（紧急止血 · ≤ 30 分钟 · 走 D-017 v3 §2.4 E1 例外路径单 commit · 与 BUG-001 阶段 1 同轮）**：

`server/src/routes/sync.ts` line 93 改：

```ts
payload: {
  type: 'object',
  additionalProperties: true,
  properties: {
    ledger_id: { type: 'string', format: 'uuid' },     // ← 加 format
    category_id: { type: ['string', 'null'], format: 'uuid' },
    // 其他字段保持 additionalProperties: true 放行
  }
},
```

返回错误改：fastify ajv 校验失败默认返 400 BAD_REQUEST + `code: 'FST_ERR_VALIDATION'`，需在 errorHandler 把 ajv 错误映射为 `code: 'INVALID_ARGUMENT'`（已在 server 现有错误处理范式 · 应 0 改动 errorHandler · 仅加 schema 即可）。

**阶段 2（COSTRA-155 内 · 与 BUG-001 阶段 2 同轮）**：完整 entry/ledger schema 校验补全 · 含 amount cents 范围 / type 枚举 / occurred_at ISO 格式等。

### §2.5 验收

- 阶段 1 PASS 条件：
  - 用合法 UUID push → 200（行为不变）
  - 用 `"default"` 字符串字面量 push → **400 BAD_REQUEST + `code: INVALID_ARGUMENT`**（不再 500）
  - 加单测：`server/test/sync.test.ts` 加 case `it('rejects non-uuid ledger_id with 400 INVALID_ARGUMENT', ...)` → green
- 阶段 2 PASS 条件：完整 entry create payload 字段全校验

---

## §3 4 个文档级 gap（手册 v1.4/v1.5 既有 · 已在 v1.6 修订）

| ID | 文档 gap | 影响 | 修复版本 |
|---|---|---|---|
| **GAP-001** | 微信小程序 Console 沙箱**禁用 CommonJS `require`** · 手册 v1.4/v1.5 §4.1.1 step 2 + §4.2.2 step 3 用 `require('./services/sync')` 命令在真机/模拟器全部 throw `ReferenceError: require is not defined` | D.1 + D.2 完全无法触发 | v1.6 §4.1.1 + §4.2.2 改 wx.request fallback paste |
| **GAP-002** | `services/storage.ts` setItem 自动 Envelope 包装 `{v, t, ttl?, d}` · 手册"Storage Tab 直接看 outbox:__index 长度"思维错误（拿到的是 `{v,t,d:[...]}`，真数组在 `.d`）| D.1 第一步即受阻 | v1.6 §4.1.1 step 2 + §4.2.2 step 1 加 `.d` 解包说明 |
| **GAP-003** | `services/auth.ts` 把 server `wx-login` 响应包成 `{raw, access_expires_at, refresh_expires_at}` · `access_token` 路径是 `tokenEnv.d.raw.access_token`（双层嵌套）· 手册曾误以为 `JSON.parse(tokenRaw).access_token` | 401 UNAUTHENTICATED | v1.6 §4.1.1 step 1 加 `.d.raw.access_token` 路径说明 |
| **GAP-004** | DB 列名 `version`（vs sync-protocol 响应字段 `server_version`）+ §4.1.2 D1.3 SQL 用 `WHERE note = 'offline-test-c'` 假设 Human 一定按手册预设 note 填 | 第一次跑 SQL 报 column does not exist + 第二次 cnt=0（手册盲区）| v1.6 §4.1.2 D1.3 SQL 改 `WHERE client_ref_id = '<op0.client_ref_id>'` + 列名 `version` |

---

## §4 1 条新立 FU（族 H · Sprint-3 候选）

### FU-105-DEV-CONSOLE-HOOK · client app.ts dev-only 调试钩子

- **来源**：本 BUG 单 §3 GAP-001 root fix（fallback paste 是 v1.6 临时解 · 不是终态）
- **登记时间**：2026-05-18 19:5x
- **范围**：`miniprogram/app.ts` onLaunch 内加 ~5 行 dev-only 守卫：
  ```ts
  if (this.globalData.env.name === 'dev') {
    import('./services/sync').then(({ pushDelta, syncPull }) => {
      (wx as any).__costra_dev_sync__ = { pushDelta, syncPull };
    });
  }
  ```
- **价值**：
  - D.1/D.2 实测命令回切真路径（`wx.__costra_dev_sync__.pushDelta()` / `syncPull(familyId)`）
  - 完整保留 H6 立意（端到端 client 调用栈含 request.ts token/idempotency-key 注入 + ackResults 自动出队 + applyServerChanges 自动落 storage）
  - prod 构建产物不含此钩子（编译期常量 + dev env 双重隔离）
- **依赖**：构建脚本未来需保证 prod build 时 strip dev-only 代码（COSTRA-160 设计 tokens pipeline 顺手做 · 或独立小卡）
- **阻断级别**：P3（fallback 模式可达成 D1.1+D1.3 PASS · H6 立意可由方式 C 真链路验证 · 不阻断双卡 approve）
- **认领建议**：Sprint-3 头部 miniapp-dev（与 COSTRA-150 sync scheduler 同轮交付 · ~ 5 分钟改动）
- **状态**：`open`
- **owner_card**：未定（候选 COSTRA-150 顺带 / 或独立 1 点小卡）

---

## §5 派单建议

### §5.1 紧急止血派单（推荐立即派）

| 卡号 | Owner | 估时 | 范围 | 派单路径 |
|---|---|---|---|---|
| **COSTRA-105 R1.x.1** | miniapp-dev | ≤ 1 小时 | BUG-001 阶段 1 + GAP-001~003 v1.6 已落地 · 仅需配合 R1.x.1 commit 关联 | D-017 v3 §2.4 E1 例外路径 · 单 commit · ≤ 5 分钟收尾 |
| **COSTRA-105 R1.x.2** | backend-dev | ≤ 30 分钟 | BUG-002 阶段 1 + 加 1 个单测 case | 同上 · 单 commit · ≤ 5 分钟收尾 |

> 两 commits 可同轮派 · 互不依赖 · backend-dev 可先做（30 min · 不依赖 client）· miniapp-dev 跟做（≤ 1 hour · 依赖 backend BUG-002 修复后可重跑 D.1 实测验收）。

### §5.2 阶段 2 长期方案（Sprint-3 P0）

合并入 **COSTRA-155 FU-EPIC-FAMILY-LEDGER-CRUD**（已立 · 8 点 · P0 · backend-dev + miniapp-dev 联合）：
- ledgers CRUD 接口实装（GET /ledgers / POST /ledgers / PUT /ledgers/{id} / DELETE）
- entry-create 页选账本 dropdown · 删除 `FALLBACK_LEDGER_ID` 兜底
- server payload 完整 schema 校验（含 amount range / type enum / occurred_at format）

### §5.3 不阻断本卡 approve 路径

**双 BUG 修复 ≠ COSTRA-105 整卡退回**：

- COSTRA-105 review-tech 40/40 已 APPROVE · 这次实测发现的是上游卡 103/104 的 scope gap 漂出 + 手册自身 4 个文档 gap
- 105 v1.6 + R1.x.1/R1.x.2 同轮落地后 → Human 重跑 D.1 验收 → 即可 `approve:COSTRA-105`
- COSTRA-156 review-tech 40/40 已 APPROVE · 不受本 BUG 影响（156 是 server `/v1` prefix 卡 · 与 ledger_id 无关）

---

## §6 联动议题（Sprint-2 末 Retro 候选）

本次实测发现暴露多层议题：

1. **手册写作"逻辑设计"vs"实测真相"差距**（D-022 §4.1 反例第 9 次）：手册 v1.0~v1.5 都是基于"代码读过 + 逻辑通顺"写就，未经任何 Human 真模拟器跑过 D.1/D.2 → 5 个 gap（4 个文档 + 1 个真 BUG）一次性暴露 → 议入 Sprint-2 末 Retro：**手册凡含 Human 实测命令的章节，必须经 1 次模拟器空跑 dry-run 才能 review-tech APPROVE**
2. **scope gap 跨卡 fall-through**（同族第 N 次）：103 R1 留 TODO + 104 R1 没接续 → 105 实测时炸出 → 议入 Retro：**TODO 注释含 `COSTRA-XXX` 的下游卡 R1 实装时应主动检查并消化** · CI 加 grep 规则扫 `TODO\(COSTRA-\d+\):` 与当前 sprint 进度对齐
3. **server 单测 + curl 漏过 fuzz**（D-022 §C8 端到端契约联调可达性反例）：单测 + curl 全用合法 UUID · 漏掉非法 input 矩阵 → 议入 Retro：**对外 API 契约层 schema 单测加 fuzz / property-based testing**（如 fast-check）扫所有 format 字段非法 input case
4. **client/server 双方 schema 校验缺失对账**（CI 对账族第 6 张候选）：whitelist-check 已对账 `fastify prefix vs OpenAPI servers path`（D 规则 · COSTRA-156 落地）· 还未对账 `fastify schema fields format vs OpenAPI components.schemas format` → 候选 E 规则 · 议入 Sprint-2 末 Retro

---

## §7 BUG 单状态

- [ ] BUG-001 阶段 1 修复（COSTRA-105 R1.x.1）
- [ ] BUG-002 阶段 1 修复（COSTRA-105 R1.x.2）
- [ ] FU-105-DEV-CONSOLE-HOOK 入 follow-ups README 族 H
- [ ] 阶段 2（COSTRA-155 Sprint-3）入 Sprint-3 Planning
- [ ] §6 4 项 Retro 议题登入 Sprint-2 末 Retro 议题表
- [ ] 手册 v1.6 落盘后 Human 重跑 D.1（用 fallback paste · 验 BUG-001 修复后无需手动覆盖 ledger_id · BUG-002 修复后非法 UUID push 返 400）→ 双卡 approve

---

**修订记录**：
- v1.0 · 2026-05-18 19:5x · Orchestrator 基于 Human 真链路实测会话现场首发
