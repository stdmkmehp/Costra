# COSTRA-154 · GET /sync/pull 增量拉取实装（替代 COSTRA-104 R1 stub 501）

> **派单时间**：2026-05-19 15:00（Orchestrator · Sprint-3 头部第 1 张 · 与 COSTRA-150 client 调度器联动落档）
> **状态**：dispatch 已落盘 · 等 Sprint-2 收官 + Human 拍板 Sprint-3 启动后再 spawn Card-Review（D-024 §2.3 不主动催 · 等 Sprint-2 7/7 CLOSED 节奏触发）
> **依赖**：COSTRA-104（entries/sync_push CLOSED · entries 表 + audit_logs + version 字段已就位）· COSTRA-156（v1 prefix · CLOSED）· COSTRA-158（PATCH /users/me + K3 method-override 范式 · 等 Human 终审 · 不阻 154 启动）
> **下游解锁**：FU-104-SYNC-PULL 真闭合 · COSTRA-105 D.2 + H6 自动等效回归 PASS · COSTRA-150 client 调度器联动验证（pushDelta + syncPull 同步循环）· Sprint-3 Epic-C 离线同步全链路通

---

## §0 SBAI 装扮路径

| 阶段 | Subagent | 状态 |
|---|---|---|
| **Card-Review R1**（D-014-a）| `costra-card-reviewer-tech`（D-022 v2.0 评分参考 + D-025 §2 反模式扫描清单首次套用） | 等 Sprint-3 启动 spawn |
| **R1 实装** | `costra-backend-dev`（一次性装扮 · 8~9 项 server 改动 · 无 client 改动 · 单装扮档单 commit）| 等卡审 PASS |
| **R1 Review** | `costra-review-tech`（D-014-b 自动拉起 · D-022 v2.0 第 7 次实战 + D-025 反模式扫描清单 §5 套用）| 等 R1 实装完 |
| **Human T1 终审** | `approve:COSTRA-154`（D-024 §2.2 攒批 · 与 COSTRA-150 联合 approve 优选）| 等 R1 Review APPROVE |

---

## §1 背景

### 1.1 触发链

**段 1 · COSTRA-104 R1 切出去铁律（2026-05-11）**：
- COSTRA-104 R1 dispatch §2.2 Q1.2 拍板"切 3 张独立卡"：PATCH /entries / DELETE /entries / GET /sync/pull
- 当时 stub 501 返 `deferred_card: COSTRA-154`（参 `server/src/routes/sync.ts` L162-176）
- OpenAPI L629-654 用 `x-deferred: { owner_card: COSTRA-154, followup_id: FU-104-SYNC-PULL, deferred_at: 2026-05-11 }` 显式标记（D-025 AP-003 好例 · 范式正确）

**段 2 · COSTRA-105 H6 BLOCKED（2026-05-18 20:1x）**：
- Human 实测 D.2 路径（client 视角端到端 pull 回环）· `GET /v1/sync/pull?family_id=...&since=...` 返 501 NOT_IMPLEMENTED
- v1.4 BLOCKED-BY-COSTRA-156 范式同款 · 105 R1 partial PASS · H6 + D.2 等 154 实装回归
- 缺陷单：`qa/defects/2026-05-18-COSTRA-105-D2-pull-501-blocker.md`

**段 3 · Sprint-3 启动节奏**：
- Sprint-2 7/7 卡 CLOSED 后 Sprint-3 Planning · 154 是 P0 头部
- 与 COSTRA-150 client 调度器**强联动**（150 不做 watermark 永远空 · 154 不做 150 调度器无意义）· 但 150 严格依赖 154 CLOSED

### 1.2 PRD / 契约锚点

- **OpenAPI 契约**：`server/api/openapi.yaml` L629-654（GET /sync/pull · query: family_id/since/limit · response: SyncPullResponse schema）· **本卡同步修缩进异常**（L630 `get:` 后 `x-deferred:` 与 `parameters:` 缩进错位 · 见 §2.1 F 项）
- **协议事实源**：`docs/api/sync-protocol.md` §3（请求/响应）+ §3.4（实体顺序约束 ledgers→categories→budgets→entries）+ §3.5（软删处理 · deleted_at != null 仍在 since 窗口内返）+ §6.1（push/pull 互斥 · 行锁）+ §6.3（watermark 单调性）+ §7（family_id 鉴权）
- **PRD 锚点**：PRD AC-4「无网也能保存 → 写入本地队列 → 联网后自动上传 + 多设备增量同步」· 阻断级别 P0
- **D-008 主体策略**：sync/pull 与主体无关 · 不引入主体字样

### 1.3 Sprint-3 启动决策（待 Human 拍板）

**当前状态（2026-05-19）**：dispatch 已落盘 · **不主动 spawn**（D-024 §2.3 攒批 · Sprint-2 收官前不启）

**触发条件（任一即可启动）**：
- Sprint-2 7/7 CLOSED + Human 主动召唤"启动 Sprint-3"
- Sprint-2 末 Retro 完成 + Sprint-3 Planning 拍板
- Human 显式 `start:COSTRA-154`

---

## §2 Scope（9 项 · 估点 5 · INVEST small 边界内）

### 2.1 主交付（9 项 · 必交）

#### A · entryRepo 加 findEntriesByFamilySince 方法（修订 1 文件 · 1 项）

**`server/src/repositories/entryRepo.ts`** 改动：

> ⚠️ **注意文件名是 `entryRepo.ts`（单数）** · 不是 `entriesRepo.ts` · 与现有 `findEntriesByLedger`（L215-260）同文件
> ⚠️ **entries 表无 family_id 列 · 必须 JOIN ledgers**（参 `findById` L272-273 范式 · COSTRA-154 R1 卡审 P0-1 修订）· 0001_init.sql 中 `entries.ledger_id → ledgers.family_id` 是间接关联

新增方法（紧跟 findEntriesByLedger 之后）：

```ts
export interface PullCursor {
  /** since watermark · ISO 8601 UTC */
  since: Date;
  /** family_id · 必须先校验属于当前 user · service 层用 isUserInFamily */
  familyId: string;
  /** 单批次最多返回 · 默认 200 · 上限 500 */
  limit: number;
}

/**
 * 增量拉取 entries 含 family_id（JOIN ledgers · 不直接读 entries 表 family_id 列）
 * 用于 sync/pull 行返回 · 与 EntryEntity 区别：附加 familyId 字段
 */
export type PullEntryRow = EntryEntity & { familyId: string };

/**
 * 增量拉取 entries（按 ledgers.family_id + entries.updated_at 推进 watermark）
 *
 * 行为约定：
 *   - JOIN ledgers · WHERE l.family_id = $1 AND e.updated_at > $2 · ORDER BY e.updated_at ASC, e.id ASC
 *   - **不过滤 deleted_at**（协议 §3.5：软删行仍需在 since 窗口内返回 · client 据此本地软删）
 *   - LIMIT $3 + 1（多取一行用于 has_more 判定 · 实际返 LIMIT 行）
 *   - 复合排序保证同 updated_at 多行的稳定顺序（避免分页跳行）
 *
 * 返回：{ rows: PullEntryRow[]（EntryEntity + familyId）, hasMore: boolean }
 */
export async function findEntriesByFamilySince(
  cursor: PullCursor,
  client?: Runner,
): Promise<{ rows: PullEntryRow[]; hasMore: boolean }> {
  const runner = client ?? exec();
  const limitPlusOne = cursor.limit + 1;
  const res = await runner.query(
    `SELECT e.id, e.ledger_id, l.family_id, e.amount, e.currency, e.type, e.category_id,
            e.account_id, e.to_account_id, e.note, e.occurred_at,
            e.created_by, e.created_at, e.updated_at, e.deleted_at, e.version, e.client_ref_id
       FROM entries e
       JOIN ledgers l ON l.id = e.ledger_id
      WHERE l.family_id = $1
        AND e.updated_at > $2
      ORDER BY e.updated_at ASC, e.id ASC
      LIMIT $3`,
    [cursor.familyId, cursor.since.toISOString(), limitPlusOne],
  );
  const rows = res.rows.slice(0, cursor.limit).map((row): PullEntryRow => ({
    ...rowToEntity(row),
    familyId: row.family_id,  // 来自 JOIN · 非 entries 表列
  }));
  return { rows, hasMore: res.rows.length > cursor.limit };
}
```

> **R1 卡审 P0-1 修订记录**（2026-05-19 20:30）：原示例代码直查 `entries.family_id` · 但 0001_init.sql L108-124 entries 表无此列 · 必 SQL 运行时 500 · 已改为 JOIN ledgers 范式（与既有 `findById` L272-273 一致）。返回类型从 `EntryEntity[]` 改为 `PullEntryRow[]`（EntryEntity + familyId）以保留 family_id 用于 wire 输出 · 同时 EntryEntity 接口保持不变（不污染其他消费者）。

#### B · 新建 syncPullService（业务层 watermark 推进 · 新建 1 文件 · 1 项）

**`server/src/services/syncPullService.ts`**（新建 · 80~120 行）：

```ts
/**
 * /sync/pull 业务层
 *
 * 职责：
 *   - 校验 user 属于 family（防越权 · 协议 §7）
 *   - 调 entryRepo.findEntriesByFamilySince 拉增量
 *   - watermark 推进策略：本批次 entries 中最大的 updated_at（协议 §6.3）
 *     - 若 rows.length === 0 → watermark 不变（保持 since 入参）
 *     - 若 rows.length > 0 → watermark = max(rows[i].updatedAt)
 *     - 单调性：server 端所有写操作用 NOW() 保证 updated_at 不回退（协议 §6.3）
 *   - 实体顺序：MVP 阶段仅返 entries · ledgers/categories/budgets 留 follow-up（见 §5.3）
 *
 * 不做：
 *   - 自动推进 client watermark（client 自己存 watermark · 见 COSTRA-150）
 *   - conflict 处理（pull 不引入冲突 · server 是真源）
 */
import { findEntriesByFamilySince, type PullEntryRow } from '../repositories/entryRepo.js';
import { isUserInFamily } from '../repositories/familyMemberRepo.js';  // 若不存在 → inline SQL（见下）
import { AppError } from '../errors/AppError.js';
import { ErrorCode } from '../errors/ErrorCode.js';

export interface SyncPullInput {
  userId: string;
  familyId: string;
  since: Date;
  limit: number;
}

export interface SyncPullResult {
  watermark: string;  // ISO 8601
  has_more: boolean;
  changes: {
    entries: ReturnType<typeof entryToWire>[];
    categories: never[];  // MVP 留空 · follow-up FU-154-CATEGORIES-PULL
    budgets: never[];
    ledgers: never[];
  };
}

export async function syncPull(input: SyncPullInput): Promise<SyncPullResult> {
  // 1. 防越权（协议 §7）
  const member = await isUserInFamily(input.userId, input.familyId);
  if (!member) {
    throw new AppError(ErrorCode.PERMISSION_DENIED, 'user not in family', {
      family_id: input.familyId,
    });
  }

  // 2. 拉增量（rows: PullEntryRow[] = EntryEntity & { familyId } · familyId 来自 JOIN ledgers）
  const { rows, hasMore } = await findEntriesByFamilySince({
    since: input.since,
    familyId: input.familyId,
    limit: input.limit,
  });

  // 3. watermark 推进
  const watermark = rows.length > 0
    ? new Date(Math.max(...rows.map(r => r.updatedAt.getTime()))).toISOString()
    : input.since.toISOString();

  return {
    watermark,
    has_more: hasMore,
    changes: {
      entries: rows.map(entryToWire),
      categories: [],
      budgets: [],
      ledgers: [],
    },
  };
}

/**
 * PullEntryRow → wire（snake_case · 协议契约对齐）
 * 含软删行：deleted_at !== null 时 client 据此本地软删
 * family_id 由 A 项 JOIN ledgers 注入 · entries 表本身无此列
 */
function entryToWire(e: PullEntryRow) {
  return {
    id: e.id,
    ledger_id: e.ledgerId,
    family_id: e.familyId,                          // 来自 JOIN ledgers · 非 entries 表列
    user_id: e.createdBy,                           // entries 表列名是 created_by · 协议 wire 字段名 user_id
    client_ref_id: e.clientRefId,
    account_id: e.accountId,
    to_account_id: e.toAccountId,
    type: e.type,
    amount: e.amount,
    currency: e.currency,                           // 与 findEntriesByLedger SELECT 对齐 · 协议 §3.2 entries[*].currency
    category_id: e.categoryId,
    occurred_at: e.occurredAt.toISOString(),
    note: e.note,
    server_version: e.version,                      // 协议字段名 server_version vs DB 列名 version
    created_at: e.createdAt.toISOString(),
    updated_at: e.updatedAt.toISOString(),
    deleted_at: e.deletedAt ? e.deletedAt.toISOString() : null,
  };
}
```

> **特别说明**：`isUserInFamily` 若仓库不存在 · backend-dev 用 inline SQL 兜底（与 entryRepo.ts L273 范式一致 · 含 `left_at IS NULL` 排除已退出成员）：
> ```sql
> SELECT 1 FROM family_members WHERE family_id=$1 AND user_id=$2 AND left_at IS NULL LIMIT 1
> ```
> 同时立 follow-up FU-154-FAMILY-MEMBER-REPO（如 COSTRA-200 系列卡需要时再抽）。

#### C · 替换 routes/sync.ts pull stub 为真 handler（修订 1 文件 · 1 项）

**`server/src/routes/sync.ts`** 改动：

1. **删除 L162-176 stub 块**（NOT_IMPLEMENTED 返 501 · stub 主动切出去阶段任务完成）

2. **替换为真 handler**（紧跟 push handler 之后 · 复用 L56-68 `parseUserIdFromRequest`）：

```ts
const SYNC_PULL_ENDPOINT = '/sync/pull';

const pullQuerySchema = {
  type: 'object',
  required: ['family_id', 'since'],
  properties: {
    family_id: { type: 'string', format: 'uuid' },
    since: { type: 'string', format: 'date-time' },
    limit: { type: 'integer', minimum: 1, maximum: 500, default: 200 },
  },
} as const;

app.get<{ Querystring: { family_id: string; since: string; limit?: number } }>(
  SYNC_PULL_ENDPOINT,
  { schema: { querystring: pullQuerySchema } },
  async (req, reply) => {
    const userId = parseUserIdFromRequest(req);  // L56-68 既有 · JWT 鉴权 · 401 → 抛 AppError
    const { family_id, since, limit = 200 } = req.query;

    // since ISO 解析 · 容错（fastify schema 已校验 format · 但 Date 解析仍可能 NaN）
    const sinceDate = new Date(since);
    if (Number.isNaN(sinceDate.getTime())) {
      throw new AppError(ErrorCode.INVALID_ARGUMENT, 'since not a valid ISO datetime');
    }

    const result = await syncPull({
      userId,
      familyId: family_id,
      since: sinceDate,
      limit,
    });

    reply.code(200).send(result);
  },
);
```

3. **import 段加**：
```ts
import { syncPull } from '../services/syncPullService.js';
```

#### D · OpenAPI 同步修缩进异常 + 删除 x-deferred（修订 1 文件 · 1 项）

**`server/api/openapi.yaml` L629-654** 改动：

1. **删除 `x-deferred` 块**（4 行 · 因为已实装 · 不再 deferred）
2. **修复 parameters 缩进**（当前 L632 `- name: family_id` 直接顶到 x-deferred 块下 · 应在 `parameters:` 子节内）
3. **追加缺失字段**：`tags: [sync]` / `summary: ...` / `security: [BearerAuth: []]`（参 push 端点 L656-672 模板）

修订后结构（参考）：
```yaml
/sync/pull:
  get:
    tags: [sync]
    summary: 增量拉取实体变更
    security:
      - BearerAuth: []
    parameters:
      - name: family_id
        in: query
        required: true
        schema: { type: string, format: uuid }
      - name: since
        in: query
        required: true
        schema: { type: string, format: date-time }
      - name: limit
        in: query
        schema: { type: integer, minimum: 1, maximum: 500, default: 200 }
    responses:
      '200':
        description: OK
        content:
          application/json:
            schema: { $ref: '#/components/schemas/SyncPullResponse' }
      '400': { $ref: '#/components/responses/BadRequest' }
      '401': { $ref: '#/components/responses/Unauthorized' }
      '403': { $ref: '#/components/responses/Forbidden' }
```

> **D-025 AP-003 修订记录**：x-deferred 标记已完成历史使命（COSTRA-104 R1 切出去 → COSTRA-154 R1 实装）· 删除合理。

#### E · SyncPullResponse schema 同步（修订 1 文件 · 1 项）

**`server/api/openapi.yaml`** components/schemas/SyncPullResponse 验证：
- `watermark: { type: string, format: date-time }`
- `has_more: { type: boolean }`
- `changes: { type: object, properties: { entries: array, categories: array, budgets: array, ledgers: array } }`

> 实装时若 schema 已存在则只对账 · 不存在则新建（参 sync-protocol.md §3.2 标准结构）

#### F · server 单测（新建 1 文件 + 修订 1 文件 · 2 项）

**新建 `server/test/sync-pull.test.ts`**（参照 `server/test/sync.test.ts` 风格 · 估 250 行 · ≥ 12 测）：

| # | 测 | 期望 |
|---|---|---|
| T1 | GET /v1/sync/pull 未登录 | 401 UNAUTHENTICATED |
| T2 | GET /v1/sync/pull 缺 family_id | 400 INVALID_ARGUMENT |
| T3 | GET /v1/sync/pull 缺 since | 400 INVALID_ARGUMENT |
| T4 | GET /v1/sync/pull family_id 非 UUID | 400 INVALID_ARGUMENT（fastify schema validation）|
| T5 | GET /v1/sync/pull since 非 ISO | 400 INVALID_ARGUMENT |
| T6 | GET /v1/sync/pull family_id 不属当前 user | 403 PERMISSION_DENIED |
| T7 | GET /v1/sync/pull since=epoch limit=200（无数据）| 200 + watermark=since + has_more=false + entries=[] |
| T8 | GET /v1/sync/pull since=epoch · 写 3 entry · 拉取 | 200 + watermark=max(updated_at) + entries.length=3（按 updated_at ASC） |
| T9 | GET /v1/sync/pull limit=2 · 写 5 entry · 拉首页 | 200 + has_more=true + entries.length=2 |
| T10 | GET /v1/sync/pull · 二次拉用上次 watermark | 200 + 跟进 3 个 entry · has_more=false |
| T11 | GET /v1/sync/pull · 含 1 个软删 entry | 200 + entries 含 deleted_at !== null 的行（协议 §3.5）|
| T12 | GET /v1/sync/pull · 响应 100% snake_case | 0 次驼峰命中 |
| T13 | GET /v1/sync/pull · server_version 字段名（非 DB 列名 version）| 字段映射正确 |
| T14 | GET /v1/sync/pull · limit=501 边界（schema 上限 500）| 400 INVALID_ARGUMENT |

**修订 `server/test/setup.ts`** pg-mem DDL：确认 entries 表有 `family_id` + `updated_at` + `deleted_at` 列（COSTRA-104 已加 · 但需验本卡测试场景全覆盖）

#### G · 关闭 FU-104-SYNC-PULL（修订 1 文件 · 1 项）

`.team/follow-ups/README.md` 族 A 第一行：`FU-104-SYNC-PULL` open → `closed @ COSTRA-154` + commit hash 待 R1 commit 后回填

#### H · COSTRA-105 缺陷单回归状态（修订 1 文件 · 1 项）

`qa/defects/2026-05-18-COSTRA-105-D2-pull-501-blocker.md`：标 `RESOLVED @ COSTRA-154 R1 commit <hash>` · 关联 105 H6 + D.2 自动等效回归 PASS（v1.4 BLOCKED-BY-COSTRA-156 范式同款）

#### I · sync-protocol.md 修订（如需 · 1 项 · 0~5 行）

**`docs/api/sync-protocol.md`**：
- §3.4 实体顺序约束确认（MVP 仅返 entries · 其他三类留 follow-up · 但顺序约束在 client 侧消费时仍然适用 · 不改协议）
- §6.3 watermark 推进策略：本卡实装确认与协议一致（max updated_at · 无数据时不变）

> 若现状已对齐则跳过 I 项 · backend-dev 评估后决定

### 2.2 不在本卡范围（明示切出去）

- ❌ COSTRA-150 client 端调度器（onShow / 网络恢复 / 周期 / 启动触发 pushDelta + syncPull）→ 独立 dispatch
- ❌ categories / budgets / ledgers 增量拉取 → 留 FU-154-CATEGORIES-PULL（MVP 阶段单人记账只有 entries 变化频繁 · 其他三类基本静态 · 等 Sprint-4+ 家庭模式时再做）
- ❌ conflict UI / merge 策略 → COSTRA-151（FU-103-CONFLICT-MERGE-UI）

### 2.3 文档（0 项 · 不写新文档 · sync-protocol.md 已含完整契约）

---

## §3 DoD（可度量 · 18 项）

### §3.1 主交付（9 项）

- [ ] A · `entryRepo.ts` 加 `findEntriesByFamilySince` · 30 行内
- [ ] B · `syncPullService.ts` 新建 · 80~120 行 · 含 family 越权校验
- [ ] C · `routes/sync.ts` 替换 stub 为真 handler · 含 query schema validation
- [ ] D · `openapi.yaml` 删 x-deferred + 修缩进 + 加 tags/summary/security · 净改 5~8 行
- [ ] E · SyncPullResponse schema 验证 / 新建
- [ ] F · `sync-pull.test.ts` 新建 · ≥ 12 测含软删 / 分页 / 越权 / 字段映射
- [ ] F' · `setup.ts` pg-mem DDL 确认（如缺列补齐）
- [ ] G · follow-ups README FU-104-SYNC-PULL closed
- [ ] H · 缺陷单 RESOLVED 标注

### §3.2 闸门（≥ 10 项 · 必跑全绿才提交）

| # | 闸门 | 命令 | 期望 |
|---|---|---|---|
| G1 | typecheck | `npm run typecheck` | 0 错 |
| G2 | lint | `npm run lint` | 0 warn |
| G3 | test | `npm run test` | 全绿（含新增 ≥ 12 测）|
| G4 | check:appjson | `npm run check:appjson` | exit 0 |
| G5 | check:tooling | `npm run check:tooling` | exit 0 |
| G6 | check:whitelist | `npm run check:whitelist` | exit 0 |
| G7a | syncPull import 存在 | `grep "syncPull" server/src/routes/sync.ts \| wc -l` | ≥ 1 |
| G7b | stub 已删除 | `grep "deferred_card.*COSTRA-154" server/src/routes/sync.ts \| wc -l` | = 0 |
| G8 | x-deferred 清理 | `grep "x-deferred" server/api/openapi.yaml \| grep -v "/entries/{entry_id}"` 应为空（其他 deferred 端点保留 · 当前剩 PATCH/DELETE entries 共 2 处） | clean |
| G15 | D-016 反例预防 | `git status -s \| grep '.team/members/' \| wc -l` | = 0（state.md + history 必须与 R1 同 commit）|

### §3.3 反向验证（3 项）

- [ ] G9 · 临时把 `findEntriesByFamilySince` WHERE 改为 `family_id = $1 AND updated_at >= $2`（>= 边界错误）→ T10 二次拉取 FAIL（重复返第一批）→ revert → PASS
- [ ] G10 · 临时把 entryToWire `server_version` 改为 `version` → T13 字段映射 FAIL → revert → PASS
- [ ] G11 · 临时把 isUserInFamily 校验注释掉 → T6 越权 FAIL（应 200 但漏返非自己 family 数据）→ revert → PASS

### §3.4 协议事实源对账（COSTRA-156 立的范式 · D-025 AP-003 检测）

- [ ] G12 · `whitelist-check.mjs` 现有规则 D 仍绿
- [ ] G13 · OpenAPI /sync/pull 与 fastify register 一一对应（grep 互验 · D-025 AP-003 候选规则 E 手动版）
- [ ] G14 · 105 D.2 + H6 等效回归条件清单（手册 §4.2 + §6 H6）逐项对账 · 实测前置 fallback 触发条件已满足

### §3.5 D-025 反模式扫描（Card-Review §4 + R1 Review §5 强制套用）

| ID | 反模式 | 命中预测 |
|---|---|---|
| AP-001 字符串代理判定 | 不命中（has_completed_profile 已立显式字段范式 · 154 不引入新代理判定 · entry.deleted_at 是事实字段非代理）|
| AP-002 概率极低就接受 | 不命中（154 不引入"接受边界缺陷"路径 · watermark 单调性是协议保证非概率）|
| AP-003 契约-实装漂移 | **命中并修复**（COSTRA-104 R1 已用 x-deferred 标记 · 154 R1 实装即修复 · D-025 AP-003 好例 1 范式正向兑现）|

---

## §4 强制阅读清单

### §4.1 必读

1. **本派单档全文**
2. **Card-Review 报告**（实装前必读）：`.team/reviews/COSTRA-154/card-review-round-1-tech.md`
3. **stub 现状**：`server/src/routes/sync.ts:162-176`（删除目标）
4. **OpenAPI 现状**：`server/api/openapi.yaml:629-654`（修订目标 · 注意缩进异常）
5. **协议**：`docs/api/sync-protocol.md` §3 + §3.4 + §3.5 + §6.1 + §6.3 + §7
6. **entryRepo 现状**：`server/src/repositories/entryRepo.ts:215-260`（findEntriesByLedger 复用游标分页范式）
7. **既有 push handler**：`server/src/routes/sync.ts` push handler（参考 schema validation + parseUserIdFromRequest）
8. **既有单测**：`server/test/sync.test.ts`（push 测试范式 + auth middleware 注入）
9. **D-025 反模式清单**：`.team/decisions/D-025-anti-patterns-clipboard.md`（Card-Review §4 + R1 Review §5 套用）
10. **D-022 v2.0**：`.team/decisions/D-022-review-tech-runtime-dimension.md`（评分维度）
11. **缺陷单**：`qa/defects/2026-05-18-COSTRA-105-D2-pull-501-blocker.md`（H 项关闭目标）

### §4.2 按需

- `.team/dispatch/COSTRA-104-backend-sync-push-entries-crud-cutout-trinity.md`（前序卡 · 切出去 3 件套范式）
- `.team/dispatch/COSTRA-158-users-me-and-has-completed-profile.md`（最近 dispatch 范式 · 双装扮档 / 反向验证范式）
- `docs/qa/costra-105-human-smoke.md` §4.2 D.2 + §6 H6（154 实装回归路径）

---

## §5 硬约束（不可违反）

### §5.1 工作区铁律

- ✅ **server 装扮档可写**：
  - `server/src/routes/sync.ts`（修订 · 删 stub 加真 handler）
  - `server/src/services/syncPullService.ts`（新建）
  - `server/src/repositories/entryRepo.ts`（修订 · 加 findEntriesByFamilySince）
  - `server/api/openapi.yaml`（修订 · 删 x-deferred 修缩进加 tags/summary/security）
  - `server/test/sync-pull.test.ts`（新建）
  - `server/test/setup.ts`（如需补 entries DDL · 隐含依赖）
  - `.team/members/backend-dev/state.md` + history
- ✅ **共用可写**：`.team/follow-ups/README.md`（关 FU-104-SYNC-PULL）· `qa/defects/2026-05-18-COSTRA-105-D2-pull-501-blocker.md`（标 RESOLVED）· `docs/api/sync-protocol.md`（如有微小修订）
- ❌ **不可写**：`miniprogram/`（COSTRA-150 范围）· `infra/` · 其他 `.team/members/{other-role}/`

### §5.2 严守 INVEST small（5 点 · 含拆卡损益分析）

- 5 点 · 时间盒 R1 实装 ≤ 240 分钟（4 小时）
- 9 项 scope 单点修改密度高 · 无新业务逻辑发明 · 现有范式齐全（push 范式 / repo 游标分页范式 / fastify schema validation 范式）

**拆卡损益分析（决策不拆）**：

考虑过的拆卡：154a（A+B+C entries pull · 3pt）+ 154b（D+E+F OpenAPI/单测 · 1pt）+ 154c（G+H+I 文档/缺陷单 · 1pt）

- **损**：+2 次 Review 循环（~60min）+ 2 次 commit · 154b/c 严格依赖 154a 实装 · 串行更慢
- **益**：154a 段可独立跑闸门 · 隔离风险
- **结论：不拆**。9 项 scope 单点小 · 单卡同 commit 收 · 与 COSTRA-156（2pt 1 commit · v1 prefix 范式）+ COSTRA-158（5pt 单 commit 9+5 文件）一致。

### §5.3 已知未知 / follow-up 候选

- **FU-154-CATEGORIES-PULL**：MVP 仅返 entries · ledgers/categories/budgets 留 Sprint-4+ 家庭模式时实装（不阻 154 R1）
- **FU-154-FAMILY-MEMBER-REPO**：若 isUserInFamily 仓库不存在 · backend-dev inline SQL 兜底 · 立 FU 等 COSTRA-200 系列卡需要时抽
- **FU-154-X-DEFERRED-CI-CHECK**：CI 加 `check:openapi-impl-coverage` 静态扫 OpenAPI paths vs fastify register 漂移（D-025 AP-003 候选规则 E · whitelist-check.mjs 扩展 · Sprint-3 末 Retro 议题）

### §5.4 D-016 同轮兑现

- 派单 → Card-Review → R1 实装（backend-dev 单装扮档）→ review-tech R1 在同一对话轮内连续 spawn
- 时间盒 240min · 大概率单轮完成（无双域协作开销 vs 158 的 ~225min 双装扮档）

### §5.5 D-018 SBAI 装扮档铁律

- 一次性装扮 · 任务结束销毁
- backend-dev 段直接 commit（单装扮档单 commit · 与 156 范式同）
- commit footer 单 `Co-Authored-By: backend-dev <subagent>`
- **commit 前必含 final message 段**（Sprint-2 末 Retro 议题 21 v2.0 升定稿规约 · D-016 反例第 8 次预防成功后强制度量）：
  ```bash
  git status -s | grep '.team/members/' | wc -l   # 期望 = 0
  ```
  state.md + history 必须与 R1 同 commit 一并 add（避免再次 D-016 反例）

### §5.6 D-022 v2.0 评分表（review-tech R1 时适用 · 40 分制 · 第 7 次实战）

| 维度 | 满分 | 本卡重点 |
|---|---|---|
| C1 契约对齐 | 5 | OpenAPI x-deferred 删 + 缩进修 + tags/summary 补 · sync-protocol.md §3 / §6.3 / §7 字段对齐 |
| C2 代码质量 | 5 | findEntriesByFamilySince 游标分页 + LIMIT+1 has_more 范式 · syncPullService watermark 推进函数式 |
| C3 架构合理 | 5 | repo/service/route 三层职责清晰 · isUserInFamily 越权检查在 service 层 · entryToWire 字段映射函数纯净 |
| C4 数据完整 | 5 | watermark 单调性（max updated_at · 无数据不变）· 软删行返回（协议 §3.5）· server_version vs DB version 字段映射 |
| C5 安全 | 5 | JWT 鉴权 · family_id 越权校验 · 不信任 client user_id · query schema 校验 |
| C6 可测性 | 5 | sync-pull.test.ts ≥ 12 测含软删 / 分页 / 越权 / 字段映射 · 反向验证 G9/G10/G11 |
| C7 纪律 | 5 | INVEST small 5pt · 不拆决策记录 · D-016 同轮 · D-018 单装扮档单 commit |
| C8 runtime 加载性 | 5 | watermark 推进语义在 fastify async runtime 下正确 · 无 race condition |
| C9 性能 | 5 | LIMIT+1 has_more 范式不额外查询 · WHERE family_id + updated_at 复合索引（如需新增 index 评估）· 单查询 ≤ 50ms p95 |
| C10 SBAI 流程合规 | 5 | 单装扮档 · 工作区铁律 · history 5 段齐全 · state.md §2 §3 §7 同步 |

> 注：C9 性能在本卡可计入（vs 158 不适用）· 因为 sync/pull 是 hot path（client 调度器周期触发 · COSTRA-150 落地后高频）

### §5.7 D-025 反模式扫描（Card-Review §4 + R1 Review §5 强制套用）

R1 Review 报告必须含反模式扫描清单 · 见 D-025 §2.1 模板。预测：AP-001/002 不命中 · AP-003 命中并修复（正向贡献）。

---

## §6 提交（D-012 单卡即提交 · D-018 commit footer）

R1 commit message 模板（全小写 commitlint · body 行长 ≤ 100 字符）：

```
feat(repo): get /sync/pull incremental fetch implementation (costra-154)

sprint-3 head card 1: replace stub 501 with real handler.

server side (9 changes):
- a: entryrepo findEntriesByFamilySince method (cursor pagination, soft-delete inclusive)
- b: syncpullservice with family permission check + watermark advancement
- c: routes/sync.ts replace pull stub with real handler + query schema validation
- d: openapi delete x-deferred + fix indent + add tags/summary/security
- e: syncpullresponse schema verification
- f: sync-pull.test.ts 12+ tests (soft-delete, pagination, permission, field mapping)
- f': setup.ts pg-mem ddl confirm
- g: follow-ups fu-104-sync-pull closed
- h: 105 d2 pull blocker defect resolved

closes:
- FU-104-SYNC-PULL (closing pull stub by real impl)
- COSTRA-105 h6/d2 auto-equivalent regression (v1.4 blocked-by-156 same precedent)

gates: typecheck/lint/test/checks all green. g7 endpoint grep ok. g8 x-deferred clean.
reverse verify: g9 (boundary >=) g10 (server_version mapping) g11 (permission) confirmed.
d-025 ap-003 contract-impl drift fixed (positive amend record).

invest small 5pt. single subagent single commit. d-016 same-turn fulfilled.
d-022 v2.0 evaluation 7th. d-025 anti-patterns clipboard 1st application.

refs: docs/api/sync-protocol.md sec-3 sec-6.3 sec-7
refs: .team/dispatch/costra-154-*.md .team/decisions/d-025-*.md

co-authored-by: backend-dev <subagent>
```

---

## §7 估点 / 时间盒

- **估点**：5 点
- **时间盒**：R1 实装 ≤ 240 分钟（4 小时）
- **R1 拆分**：
  - A entryRepo：30 min
  - B syncPullService：50 min（核心 · 含越权校验设计）
  - C routes/sync.ts 真 handler：40 min
  - D OpenAPI 缩进修 + x-deferred 删：20 min
  - E SyncPullResponse schema：10 min
  - F sync-pull.test.ts 12 测：60 min
  - F' setup.ts：5 min
  - G/H follow-ups + 缺陷单：10 min
  - state.md + history：15 min
  - **总和：~240 min · 时间盒打满 · 反模式扫描需在最后 5 min 完成**

---

## §8 联合 Sprint-3 末 Retro 议题候选

- 🆕 **议题候选 · check:openapi-impl-coverage 落地**：D-025 AP-003 检测候选规则 E · 静态扫 OpenAPI paths vs fastify register · whitelist-check.mjs 扩展 · 与本卡 G7/G8 闸门手动验证范式衔接
- 🆕 **议题候选 · ledgers/categories/budgets 增量拉取实装**：FU-154-CATEGORIES-PULL · Sprint-4+ 家庭模式时落地（与 COSTRA-200 系列联动）
- 🆕 **议题候选 · entries.family_id + updated_at 复合索引性能基准**：MVP <10 用户无瓶颈 · 但 Sprint-4+ 家庭模式时需评估（DAU >100 触发）
- 🆕 **议题候选 · K3 → K1 升级评估**（COSTRA-152 PATCH /entries 实装时评估 · D-024 §2.4 关联）

---

## §9 附录 · 与 COSTRA-150 联动验证（154 + 150 联合 approve 路径）

154 R1 APPROVE 后 · 150（client 调度器）即可启动。

**联合验证条件**（D-024 §2.2 C1 联合实测触发）：

| 条件 | 期望 |
|---|---|
| 154 R1 commit + 150 R1 commit 双就位 | 队列累计 2 张 → C1 触发 |
| Human 实测：mock 模式下 client 触发 syncPull → 真 server 响应 200 + watermark 推进 | UI / Network / Storage 三验 |
| Human 实测：写一笔 entry → push 200 → 重启 client（清 watermark）→ pull 回来同样 entry | E2E 闭环 |
| Human 实测：105 H6 + D.2 自动等效回归 PASS | partial PASS → full PASS（缺陷单升 RESOLVED） |

→ 双 approve 命令：`approve:COSTRA-154 + approve:COSTRA-150`（D-024 攒批范式）

---

_本档由 Orchestrator 在 2026-05-19 15:00 落盘 · Sprint-3 头部第 1 张 · 与 COSTRA-150 联动落档 · 等 Sprint-2 收官 + Sprint-3 启动节奏触发 spawn_
