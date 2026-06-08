# COSTRA-103 · 本地 KV 持久化 + outbox 多 key 分片 + 冲突三态消费（离线优先架构客户端层）

- 卡号：COSTRA-103
- Owner：miniapp-dev（装扮 subagent · D-018 SBAI v1.1）
- Type：feature / Epic-C 主线（端到端离线优先架构）
- 估点：**5 点**（D-019 §3.2 + Q6 拍板保持 · 含 outbox 多 key 分片 + 冲突三态消费 + 5+ 单测 + Human 实测前置）
- 优先级：P0（Sprint-2 主线主头 · 解锁 COSTRA-104/105）
- Sprint：**Sprint-2**（2026-05-10 ~ 2026-05-23）
- 依赖（已闭合）：COSTRA-100 G3 协议（sync-protocol.md / id-strategy.md / error-codes.md）/ COSTRA-118 P1-3（outbox payload snake_case）/ COSTRA-125（storage.ts 异步化）
- 立卡时间：2026-05-09 11:04（Human `run miniapp COSTRA-103` 触发 + 7 Q 拍板全按推荐）

---

## §0 SBAI 路径 · D-022 v2.0 首次实战 · D-021 v3 三证已跑

### 路径
- **卡定义 Review**：Q1-a 拍板 · 走 `costra-card-reviewer-tech`（技术向 · D-014-a）
- **R1 实装**：Q4-a 拍板 · spawn `costra-miniapp-dev`（SBAI 第 7 次冒烟 · miniapp-dev 第 6 次实战）
- **R1 Review**：D-014-b 自动拉起 `costra-review-tech`（**D-022 v2.0 评分表 35→40 首次实战 · C8 runtime 加载性维度首跑**）
- **Human 模拟器实测**：**D-022 §4.2 强制前置**（runtime 类 T2 卡 · 不可绕过 · 议题 17 教训）
- **Human 终审**：T1（Sprint-2 主线 · 双签路径 · 但因纯客户端可由 review-tech 单审 + Human 实测兜底 = T2-with-runtime）

### D-021 v3 三证（Orchestrator 立卡前已跑）

```bash
git ls-files miniprogram/services/  # storage.ts / sync.ts / request.ts 现状已确认
git log --oneline -10 -- miniprogram/services/  # COSTRA-125 storage 异步化 + COSTRA-126 lib 升级 + COSTRA-128 cleanup 链路
git show HEAD:miniprogram/services/storage.ts  # 现状 86 行 · async API · ensureVersion + setItem/getItem/removeItem
```

事实源结论：

1. ✅ `storage.ts` 已是异步 KV（COSTRA-125 兑现）· **本卡不重写 · 在其上写 db.ts 抽象**
2. ⚠️ `sync.ts:108-117` 已有简单 outbox（**单 key 数组** · OUTBOX_KEY=`__costra_outbox_v1`）· **本卡升级到多 key 分片**
3. ⚠️ `sync.ts:115` payload 字段是 **驼峰** `amountCents` / `categoryId` / `occurredAt` · **必须重构为 snake_case**（COSTRA-118 P1-3 待修内容）
4. ⚠️ `miniprogram/utils/id.ts` **不存在**（id-strategy.md §2.5 写 v0.2 实装但实际未落地）· **本卡新建**
5. ✅ `request.ts:67` Idempotency-Key 注入支持 `opts.idempotencyKey || uuidV4()` · 但 outbox 重试需**持久化** key · 由 outbox 入队时存
6. ✅ `request.ts:170` uuidV4 已 export · 可复用 · 无需新增依赖

---

## §1 背景

PRD 明确"断网记账→联网 10 秒内自动推送"（Sprint-1 DoD 第 3 条 · 已分给 COSTRA-103 + 104）· Sprint-1 阶段 sync.ts 仅留接口签名 + 简易 outbox（COSTRA-102 R1 实装时声明"真实 watermark 推进与冲突合并由 COSTRA-103 做"）· 本卡兑现该承诺 · 落地完整离线优先架构客户端层。

**Sprint-1 已就位的前置**：

- COSTRA-100 G3：sync-protocol.md / id-strategy.md / error-codes.md 协议三件套定稿
- COSTRA-118 P0-7：Entity 枚举锁死 `'entry' | 'category' | 'budget'`
- COSTRA-125：storage.ts 异步 API 全 wx.getStorage / wx.setStorage（lib 3.8+）
- COSTRA-126：lib 升级 2.32.3→3.8.12（startup race 已修）
- COSTRA-127：onShow bootstrap gate（页面级保护）

**Sprint-2 解锁顺位**：本卡 → COSTRA-104（后端 entries CRUD + /sync/push 真实接收）→ COSTRA-105（端到端冒烟）

---

## §2 范围（Scope · Q1~Q7 拍板路径）

### §2.1 新建 `miniprogram/services/db.ts`（A · 主产物 1）

本地 KV 抽象层 · 在 storage.ts 之上 · 让业务代码不直接接触 wx API 也不直接接触 storage envelope。

**接口签名（Q1-b · wx.setStorage + 自建简易 KV 抽象）**：

```ts
// 实体类型（snake_case · 对齐 OpenAPI）
export interface Entry {
  id?: string;                  // 服务端 UUID v7（push 成功后回写）
  client_ref_id: string;        // 客户端 UUID v4（本地主键）
  ledger_id: string;            // family ledger
  amount: number;               // cents · int · 不是 amountCents
  currency: string;             // 'CNY' 等 ISO 4217
  type: 'expense' | 'income';
  category_id: string | null;
  note: string;
  occurred_at: string;          // ISO 8601 UTC
  created_at?: string;
  updated_at?: string;
  version?: number;             // 服务端乐观锁版本
  deleted_at?: string | null;   // 软删
  dirty?: boolean;              // 本地标记 · 未 push
}

export interface Category { ... }
export interface Budget { ... }
export interface Ledger { ... }

// API 签名
export async function putEntry(entry: Entry): Promise<void>;
export async function getEntry(client_ref_id: string): Promise<Entry | null>;
export async function listEntries(filter?: { ledger_id?: string; since?: string }): Promise<Entry[]>;
export async function deleteEntry(client_ref_id: string): Promise<void>;        // 软删 · 标 deleted_at
export async function applyServerChanges(changes: SyncPullResponse['changes']): Promise<void>;
export async function getWatermark(family_id: string): Promise<string>;          // 读 cursor
export async function setWatermark(family_id: string, watermark: string): Promise<void>;
```

**存储格式**：

```
key 命名空间：
  entry:{client_ref_id} → Envelope<Entry>           (单实体存储)
  entry:__index         → string[] (client_ref_id 列表 · 维护排序)
  category:{client_ref_id} / category:__index
  budget:{client_ref_id} / budget:__index
  ledger:{client_ref_id} / ledger:__index
  watermark:{family_id} → string (ISO 8601)

策略：
  putEntry → setItem 实体 + appendIndex（去重）
  listEntries → getIndex 取 ids → 并发 getItem 批量读取
  applyServerChanges → 按实体顺序（ledgers→categories→budgets→entries）逐条 upsert + version 比对
```

**Q3-c 冲突探测桩**（实际是协议三态消费 · 不是单独 stub）：

```ts
// applyServerChanges 内部已含 conflict 处理桩位
// 真实合并 UI 在 COSTRA-104 + Sprint-3+ conflict-strategy.md 落地
if (item.version > local.version) {
  if (local.dirty) {
    // 触发：本地未上行 + 服务端已变更
    await mergeIntoConflictQueue(local, item);  // 桩 · console.warn + 本卡仅入待合并队列
  } else {
    await replaceLocal(entity, item);
  }
}
```

### §2.2 新建 `miniprogram/services/outbox.ts`（B · 主产物 2）

Outbox 重放队列 · Q2-b 多 key 分片实现。

**接口签名**：

```ts
export type SyncOp = {
  op: 'create' | 'update' | 'delete';
  entity: 'entry' | 'category' | 'budget';
  client_ref_id: string;
  base_version: number | null;             // create 必为 null
  payload: Record<string, unknown>;        // snake_case · 符合 sync-protocol.md §2.1
  enqueued_at: number;                     // ms timestamp
  retries: number;                         // 重试次数
  next_retry_at: number;                   // 指数退避下次时间
  idempotency_key: string;                 // 整批级 · 持久化以便重试复用
};

// API 签名
export async function enqueue(op: Omit<SyncOp, 'enqueued_at'|'retries'|'next_retry_at'|'idempotency_key'>): Promise<void>;
export async function drainBatch(maxBatch?: number): Promise<{ batch: SyncOp[]; batchKey: string } | null>;
export async function ackResults(batchKey: string, results: PushResultItem[]): Promise<void>;
export async function size(): Promise<number>;
export async function __peek(): Promise<SyncOp[]>;       // 单测 / 验证手册用 · 生产页面禁用
export async function __clear(): Promise<void>;          // 单测用
```

**存储格式（Q2-b · 多 key 分片）**：

```
key 命名空间：
  outbox:{seq} → SyncOp                    (每条 op 一个 key · seq = enqueued_at 单调递增)
  outbox:__index → number[] (seq 升序列表 · 维护入队顺序)
  outbox:__retries → Record<string, number> (按 client_ref_id 累计重试 · 用于上限熔断)
```

**重试策略（sync-protocol.md §5.1）**：

```
2s / 8s / 32s / 2min / 15min / 1h（指数退避）· 24h 上限 · 超过则进 dead-letter
client_ref_id + idempotency_key 重试时不变（协议铁律）
```

### §2.3 新建 `miniprogram/utils/id.ts`（C · 主产物 3 · id-strategy.md §2.5 兑现）

id-strategy.md 写 v0.2 实装但实际未落地 · 本卡补齐：

```ts
// miniprogram/utils/id.ts
/**
 * 生成 client_ref_id（UUID v4）
 * Refs: id-strategy.md §2.5
 * 用途：离线本地主键 + sync_push client_ref_id
 */
export function newClientRefId(): string {
  // 直接复用 services/request.ts:170 的 uuidV4
  // 或独立实装一份保持 utils/id.ts 自洽
}

/**
 * 生成 Idempotency-Key（UUID v4 · 每个写请求/批次独立）
 * Refs: id-strategy.md §3.1
 * 用途：HTTP 请求头 + outbox 持久化 key · 重试不变
 */
export function newIdempotencyKey(): string;
```

### §2.4 重构 `miniprogram/services/sync.ts`（D · 主产物 4）

| 原行 | 改动 |
|---|---|
| `enqueueLocalEntry` (108~117) | **迁移到 outbox.ts** · 改为 `enqueue({ op:'create', entity:'entry', ... })` · payload 全 snake_case |
| `OUTBOX_KEY = '__costra_outbox_v1'` (45) | **删除**（单 key 数组废弃 · outbox.ts 接管）|
| `__peekOutbox` (120) | **迁移到 outbox.ts** 改名 `__peek` |
| `syncPull` 内部 (86~102) | **接入 db.ts.applyServerChanges**（消费 changes · 实装 §3.3 客户端规则）|
| `getCursor / setCursor` (62~71) | **迁移到 db.ts** 改名 `getWatermark / setWatermark` · sync.ts 内部调用 |
| 新增 `pushDelta` | 新函数 · 调 `outbox.drainBatch` → POST /sync/push（带 batch idempotencyKey）→ 调 `outbox.ackResults` 消费三态 |

### §2.5 业务页面接入（E · 边界改动）

`miniprogram/pages/entry/index.ts` 现状是 `enqueueLocalEntry` 调用 · 改为：

```ts
import { putEntry } from '../../services/db';
import { enqueue } from '../../services/outbox';
import { newClientRefId, newIdempotencyKey } from '../../utils/id';

const entry: Entry = {
  client_ref_id: newClientRefId(),
  ledger_id: ...,
  amount: amountCents,
  currency: 'CNY',
  type, category_id, note,
  occurred_at: new Date().toISOString(),
  dirty: true
};
await putEntry(entry);                           // 本地落库
await enqueue({                                  // 入 outbox
  op: 'create',
  entity: 'entry',
  client_ref_id: entry.client_ref_id,
  base_version: null,
  payload: { ledger_id, amount, currency, type, category_id, note, occurred_at }
});
```

### §2.6 新建 `miniprogram/services/db.spec.ts` + `outbox.spec.ts`（F · ≥ 5 单测 · Q4-a）

参照 `storage.spec.ts` 8 测先例（COSTRA-125）· 本卡至少 5 测：

| Spec | 用例 |
|---|---|
| db.spec.ts | T1 putEntry → getEntry 往返 · client_ref_id 主键 |
| db.spec.ts | T2 listEntries 按 ledger_id filter |
| db.spec.ts | T3 deleteEntry 软删 · listEntries 不返回 |
| db.spec.ts | T4 applyServerChanges entry version 比对（v_local < v_server → replace · v_local > v_server → ignore）|
| db.spec.ts | T5 watermark 读写单调 |
| outbox.spec.ts | T6 enqueue → __peek 长度 + idempotency_key 持久化 |
| outbox.spec.ts | T7 drainBatch maxBatch=200 截断 + batchKey 唯一 |
| outbox.spec.ts | T8 ackResults 'ok' → 移除 · 'conflict'/'rejected' → 留队列 + retries+1 |

### §2.7 新建 Human 验证手册（G · D-022 §4.2 强制 · 与 COSTRA-102 同模板）

**文件**：`docs/qa/costra-103-human-verify.md`

**5 步实测脚本**（≥ 5 条断言 · runtime 类 T2 卡前置）：

| 步骤 | 操作 | 断言 |
|---|---|---|
| 1 | 启动小程序 · 模拟器 console 检查 | 0 次 `too eayly` · 0 次 `db.ts is not defined` · `[storage] ensureVersion` 通过 |
| 2 | 登录 → 记一笔（在线）· 模拟器 Console + Storage Tab | Storage 出现 `entry:{uuid}` + `entry:__index` + `outbox:{seq}` + `outbox:__index` 各 key |
| 3 | **断网**（开发者工具 Network → Offline）· 记 3 笔 | Storage `entry:__index` 长度 = 3 · `outbox:__index` 长度 = 3 · payload 是 snake_case（`ledger_id` / `category_id` / `amount`）|
| 4 | **联网**（恢复 Network · 等 30s）| outbox 自动 push 一次 · console 看 POST /sync/push · 等 COSTRA-104 后端实装才能成功 · 本卡 mock 模式下应能 dispatch + ackResults('ok') 写本地 |
| 5 | 重启小程序 | 持久化生效：`entry:__index` 仍有 3 条 · cursor watermark 不丢失 |

**5 条硬断言**（pass 才能 Human T1 终审）：

1. db.ts API 全异步 · 0 次 sync API 调用
2. outbox 多 key 分片 · 0 次单 key 数组
3. payload 100% snake_case · 0 次驼峰泄漏
4. client_ref_id 持久化 · 重启不丢
5. ensureVersion + bootstrap 兼容 lib 3.8+

---

## §3 工作区 + 权限

### 可写

- `miniprogram/services/db.ts`（新建 · A · ~150 行）
- `miniprogram/services/outbox.ts`（新建 · B · ~200 行）
- `miniprogram/utils/id.ts`（新建 · C · ~30 行）
- `miniprogram/services/sync.ts`（重构 · D · 净增 ~50 行）
- `miniprogram/pages/entry/index.ts`（接入 · E · 改 ~10 行）
- `miniprogram/services/db.spec.ts`（新建 · F · ~150 行 · ≥ 5 测）
- `miniprogram/services/outbox.spec.ts`（新建 · F · ~150 行 · 3+ 测）
- `docs/qa/costra-103-human-verify.md`（新建 · G · ~250 行 · 5 步手册）
- `.team/members/miniapp-dev/state.md`（§2/§3/§7 收尾）
- `.team/members/miniapp-dev/history/2026-05-09-costra-103-r1-implement.md`（新建 · ≤ 100 行）

### 禁写

- `server/` / `api/`（后端协议事实源 · COSTRA-104 范围）
- `design/` / `infra/` / `qa/` / `scripts/`
- `docs/api/*.md`（事实源 · 修协议要 G3 复审 · 不在本卡范围）
- `docs/devops/libversion-upgrade.md`（v5 唯一定稿 · COSTRA-128 已锁）
- `docs/PRD.md` / `docs/qa/costra-102-human-verify.md`（不动）
- `.team/decisions/D-001~D-022`（已有决议不修改）
- `.team/members/{other-role}/`
- `miniprogram/services/storage.ts`（COSTRA-125 已锁 · 仅在其上扩展 · 不动现有 4 个导出）
- `miniprogram/services/storage.spec.ts`（不动）
- `miniprogram/services/auth.ts` / `request.ts`（不动 · 仅引用 uuidV4）
- `miniprogram/app.ts`（不动 · ensureVersion 已在 onLaunch）
- `project.config.json` / `miniprogram/project.config.json.example`
- `.codebuddy/agents/`

---

## §4 DoD（必达 · miniapp-dev 自检 · review-tech 复核 · D-022 v2.0 评分表 40 分制）

| # | DoD | 验收方式 |
|---|---|---|
| (a) | db.ts 8 个 API 全异步 + 完整类型签名 | grep `export async function` ≥ 8 + tsc 严格模式 0 错 |
| (b) | outbox.ts 6 个 API + 多 key 分片实现 | grep `outbox:{seq}` 模式 + 0 次 OUTBOX_KEY 单 key 数组残留 |
| (c) | utils/id.ts newClientRefId + newIdempotencyKey UUID v4 格式 | uuid v4 regex 校验 + 100 次生成 0 重复 |
| (d) | sync.ts 重构 · 旧 enqueueLocalEntry/OUTBOX_KEY/getCursor 全迁出 | grep 旧符号 0 命中 |
| (e) | pages/entry/index.ts 接入 · 0 行驼峰 payload 残留 | grep `amountCents\|categoryId\|occurredAt` 在 outbox/entry 业务路径 0 命中 |
| (f) | ≥ 5 单测全绿（db.spec ≥ 5 + outbox.spec ≥ 3）| `npm run test` 21+8 = 29+/29+ pass |
| (g) | docs/qa/costra-103-human-verify.md 落盘 · 5 步手册 + 5 硬断言 | wc ≥ 200 行 + grep 5 步骤命中 |
| (h) | state.md/history 收尾追写 | grep "2026-05-09" + history 文件存在 |
| (i) | **runtime 加载性 D-022 §4.1 不可绕过 E1/E2 兜底**：①  ensureVersion 兼容 ② lib 3.8+ 必跑 | 闸门通过 + Human 实测 |

**0 行后端代码 / API 协议改动**（pm-writer 工作区铁律对应到 miniapp-dev 工作区铁律）

---

## §5 闸门（miniapp-dev 自跑 · 全 exit 0）

- `npm run typecheck`
- `npm run lint`
- `npm run test`（vitest · ≥ 29 测全绿 · 现 21 + 本卡新增 8）
- `npm run check:appjson`
- `npm run check:tooling`
- `npm run check:whitelist`
- 反向验证 grep 三段（保 0 命中）：
  - `grep -rn "amountCents\|categoryId\|occurredAt" miniprogram/services/outbox.ts miniprogram/pages/entry/index.ts` → 0
  - `grep -rn "OUTBOX_KEY\|enqueueLocalEntry\|__peekOutbox" miniprogram/` → 0
  - `grep -rn "wx\.setStorageSync\|wx\.getStorageSync" miniprogram/services/db.ts miniprogram/services/outbox.ts` → 0（async 铁律 · COSTRA-125 不变量）

---

## §6 commit（D-012 单卡即提交 · 允许按 scope 拆 2 commit）

**commit 1**：`feat(miniapp): db + outbox + id utils + sync.ts refactor (COSTRA-103 R1)`
- 范围：`miniprogram/services/db.ts` + `outbox.ts` + `utils/id.ts` + `services/sync.ts` + `pages/entry/index.ts` + 2 spec
- footer：`Refs: COSTRA-103, COSTRA-100, COSTRA-118, sync-protocol.md, id-strategy.md`

**commit 2**：`docs(qa): costra-103 human verify manual + state.md/history (COSTRA-103)`
- 范围：`docs/qa/costra-103-human-verify.md` + `.team/members/miniapp-dev/state.md` + `history/2026-05-09-costra-103-r1-implement.md`
- footer：`Refs: COSTRA-103, D-022`

**Subject 全小写** · `COSTRA-103` 仅 footer 大写。

---

## §7 验收（Orchestrator 同轮代收）

| 项 | 通过条件 |
|---|---|
| diff 行数 | 净增 ≥ 800 行（3 新建 service + 2 spec + 1 手册 + 1 sync 重构 ~ 总 800~1000）|
| 文件数 | 8~10 个（5 新建 + 3~5 修改）|
| 0 行后端代码 | `git diff server/ api/ --stat` 空 |
| spec 全绿 | 29+/29+ tests passed |
| Reverse-grep 三段 | 全 0 命中 |
| **D-022 §4.1 runtime 类判定** | 命中（涉及 storage runtime + 多 key 分片 + outbox 重放 + bootstrap 兼容）→ 必须 Human 实测前置 |

---

## §8 时间预算（miniapp-dev 自评 · ≤ 90 min · 5 点卡）

| 阶段 | 预估 |
|---|---|
| 读 §10 强制阅读清单 | 15 min |
| db.ts 撰写 | 20 min |
| outbox.ts 撰写 | 20 min |
| utils/id.ts 撰写 | 5 min |
| sync.ts 重构 | 15 min |
| pages/entry/index.ts 接入 | 5 min |
| 2 spec 撰写 | 10 min |
| 验证手册 | 10 min |
| 闸门 + 反向验证 + commit + state/history 收尾 | 10 min |
| **合计** | **≤ 110 min**（5 点卡可超 20 min · 体量证据驱动）|

若超 150 min 仍未完工 · 立即 BLOCKED + 冒泡 Human · 不擅自压缩 §2 范围。

---

## §9 硬约束（不可违反）

1. **0 行后端协议改写**：`server/` `api/` `docs/api/` 0 命中 · 协议是事实源 · 改协议另立 G3 复审卡
2. **协议 100% 对齐**：payload 全 snake_case · entity 限 `'entry'|'category'|'budget'` · 三种 ID 严禁混用 · 重试复用 idempotency_key
3. **COSTRA-125 不变量**：禁止回退 sync API（wx.setStorageSync / wx.getStorageSync）· 全 await · lib 3.8+
4. **Scope 铁律**：storage.ts 不动 · auth/request 不动 · app.ts 不动
5. **三证铁律（D-021 v3）**：写 db.ts/outbox.ts 前必须三证齐跑（git ls-files / log / show HEAD:）· history §1 记录
6. **D-016 同轮兑现**：本卡产出 + state/history + 2 commit 同 tool call 循环兑现
7. **D-022 v2.0 runtime 类前置**：本卡命中 §4.1（涉及 storage runtime + 异步 SDK + 重放）· **必须**生成 5 步 Human 实测手册 · review-tech R1 后**强制等 Human 实测**才能 T1 终审
8. **Subject 全小写** + footer Refs 大写
9. **Bash 仅可写命令限定**：git add / commit / push / npm 已注册 scripts · 禁止 `git push --force` / `git reset --hard` / `rm -rf miniprogram/`

---

## §10 强制阅读清单（miniapp-dev spawn prompt §G inline）

### 必读（按顺序）

1. 本 dispatch 单（验收基准）
2. **`docs/api/sync-protocol.md`**（事实源 · §2/§3 push/pull 全协议）
3. **`docs/api/id-strategy.md`**（三种 ID 严禁混用 · §2.5 client_ref_id 客户端实装样板）
4. **`docs/api/error-codes.md`**（push response 三态白名单 · §9 NETWORK_ERROR / VERSION_CONFLICT）
5. **`miniprogram/services/storage.ts`**（在其上构建 db.ts · 不重写）
6. **`miniprogram/services/sync.ts`**（重构对象 · 保留 syncPull / SyncCursor 公共签名 · 迁出 outbox 部分）
7. **`miniprogram/services/request.ts`**（uuidV4 + idempotencyKey 注入机制 · 不动）
8. **`miniprogram/services/storage.spec.ts`**（spec 范本 · 8 测格式参考）
9. **`docs/qa/costra-102-human-verify.md`**（手册范本 · 5 步格式参考）
10. **`.team/decisions/D-022-review-tech-runtime-dimension.md`**（你被审的 runtime 维度 · 自审参考）
11. **`.team/decisions/D-021-d-017-v3-cross-version-precheck.md`**（三证铁律来源）
12. **`.team/reviews/COSTRA-118/FINAL.md`**（P1-3 outbox payload snake_case 历史）
13. **`.team/reviews/COSTRA-125/FINAL.md`**（storage 异步化历史 · async 不变量来源）

### 强制 git 三证（D-021 v3 · 必跑前置）

```bash
git log --oneline -50
git ls-files miniprogram/services/ miniprogram/utils/
git show HEAD:miniprogram/services/sync.ts | head -120
```

跑完三证记录在 history §1 · 然后开工。

### 按需读

- `server/api/openapi.yaml`（OpenAPI 接口定义 · 不改 · 仅核对 entity / payload schema）
- `.team/members/miniapp-dev/state.md` §6（COSTRA-125 残留 FU）
- `docs/devops/libversion-upgrade.md` §3.4（v5 lib 3.8+ 兼容性确认）

---

## §11 dispatch 元数据

- 立卡发起：Human · 2026-05-09 11:04（`run miniapp COSTRA-103`）
- 立卡裁决：Orchestrator · 2026-05-09 11:08（7 Q 全按推荐 + Q1 deep-dive 后 11:04 拍板）
- 派单 Orchestrator commit：本轮（dispatch + card-review-tech 同轮）
- miniapp-dev spawn 时间：等 card-review-tech PASS 后立刻
- 预期 R1 完工：spawn + ≤ 110 min
- 预期 R1 review-tech：D-014-b 自动拉起（**D-022 v2.0 评分表 40 分制首次实战**）
- 预期 Human 实测时间：spawn 后约 2~3 h（含 Human 模拟器 5 步手册执行 ~20 min）
- 预期 Human T1 终审：实测全 PASS 后立刻

---

**本 dispatch 由 Orchestrator 立卡瞬间落盘 · miniapp-dev spawn 时由 Orchestrator 注入 §A~§H 八段 Context**（D-018 §3.3）· 其中本文件作为 §F 任务定义 + §G 强制阅读清单的一部分 inline。
