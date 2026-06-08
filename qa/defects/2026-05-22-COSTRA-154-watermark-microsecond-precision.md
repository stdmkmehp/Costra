# BUG-COSTRA-154-WATERMARK-MICROSECOND-PRECISION

> **缺陷单时间**：2026-05-22 14:18（Human 实测 `qa/costra-154-150-joint-smoke.md` §3.E 断言 E 触发 · COSTRA-154 + COSTRA-150 联合冒烟 · 真链路 BUG）
> **来源会话**：双卡联合 staging 实测 · §3.E watermark 持久化验证 · `pulled=1` 永远不变 · 客户端 watermark 与 server DB updated_at 精度不匹配
> **严重级别**：**P1**（数据最终一致 · 但每次 pull 重传同一条 entry · 流量浪费 · 持续到该行被新行 supersede 为止 · 影响所有真机用户 · 不限 offline 场景）
> **关联卡**：
> - **根因引入**：COSTRA-154 R1 commit `7e87bad`（`syncPullService.ts:81-83` watermark 推进用 `Date.getTime()` + `toISOString()` · 双重精度截断）
> - **暴露触发**：BUG-COSTRA-150-D 修复后 `pulled` 字段被准确暴露 · 立即看到 `pulled=1` 永远不变（修复前 `pushed/pulled` 都不准 · 此 bug 被掩盖）
>
> **R1 Review 漏检**：
> - COSTRA-154 R1 review-tech 38/45 APPROVE · 单测 T7-T10 covered watermark 推进 + 二次拉 · **但全部用 `since=epoch` 或 `>= 毫秒` 边界 · 未测试 server `updated_at` 微秒尾数 vs client watermark 毫秒精度的精度损失场景**
> - 协议文档 `docs/api/sync-protocol.md` §6.3 watermark 单调性铁律 · **未明确精度（毫秒还是微秒）**
>
> **D-022 §4.1 真兑现**：runtime 类 T2 卡 Human 实测前置铁律第 4 次正向兑现（前三次：105 H6 / 158 R1 storage drift / 150 R1 outbox 死锁）
>
> **D-025 AP-001 第 3 次 Orchestrator 命中**：之前 §3.E 实测时 Orchestrator 给 Human 的诊断命令 storage key 名错（`sync:watermark:` vs 实际 `watermark:`）· 经 Human 严肃纠偏后才查到此 BUG · AP-001 反模式扩展到"手册常量裸抄不引代码事实源"
>
> **复现 Human 操作环境**：微信开发者工具 macOS 2.01.2510290 · 基础库 3.8.12 · COSTRA-154 R1.x.1 commit `8eecd4c` + COSTRA-150 R1.x.1 commit `5ac8153`（HEAD 含 BUG-150-D 修复但未 commit）

---

## §1 现象

### §1.1 Human 实测路径（2026-05-22 14:00 ~ 14:18）

1. 完成 §3.A/§3.B/§3.C/§3.D 断言（D 经 BUG-150-D 修复后已 PASS）
2. 进入 §3.E：杀进程冷启 + 检查 watermark storage + Network 面板看 since 参数
3. **预期**：
   - watermark storage 含非 epoch ISO timestamp
   - Network `GET /v1/sync/pull` 的 `since=` 参数为非 epoch
   - Console 显示 `[sync] ok · pulled=0 watermark=...`（增量为空）
4. **实际**：
   - watermark storage 正常：`d: "2026-05-22T06:02:05.921Z"`
   - Network since 参数也正常（非 epoch）
   - **但 Console 持续 `pulled=1`**：
     ```
     14:11:51.049 [sync] ok · pushed=0 conflicts=0 rejected=0 failed=0 pulled=1 watermark=2026-05-22T06:02:05.921Z (trigger=periodic)
     14:12:51.062 [sync] ok · pushed=0 conflicts=0 rejected=0 failed=0 pulled=1 watermark=2026-05-22T06:02:05.921Z (trigger=periodic)
     ```
   - 两次 periodic 都拉到 1 条 entry · 但 watermark 完全不动

### §1.2 Human Console + SQL 双重铁证

#### 客户端 storage（毫秒精度）

```js
wx.getStorageSync('watermark:00000000-0000-0000-0000-0000000000F0')
// → { v: 1, t: 1779430491067, d: "2026-05-22T06:02:05.921Z" }
//                                       ^^^^^^^^^^^^^^^^^^^^^^
//                                       3 位小数 · 毫秒精度
```

#### 服务端 PostgreSQL（微秒精度）

```bash
psql 'postgres://costra:costra_dev_pw@localhost:5432/costra' -c "
  SELECT id, amount, note, updated_at,
         EXTRACT(MICROSECONDS FROM updated_at)::bigint AS micros
  FROM entries WHERE ledger_id = '00000000-0000-0000-0000-000000000001'
  ORDER BY updated_at DESC LIMIT 5"

                  id                  | amount |  note   |          updated_at           |  micros
--------------------------------------+--------+---------+-------------------------------+----------
 019e4e46-d6e0-745b-bba5-a4d61584102e |  33300 | test333 | 2026-05-22 14:02:05.921137+08 |  5921137
 019e4e46-013a-726c-b7a5-92696206053b | 121100 | t1211   | 2026-05-22 14:01:11.226732+08 | 11226732
 019e4dfe-05b0-72ac-bdb8-89ad7ca58c06 |  88800 | test888 | 2026-05-22 12:42:33.776962+08 | 33776962
```

**精度差**：

| 客户端 watermark `d` | server `entries.updated_at` | 丢失精度 |
|---|---|---|
| `2026-05-22T06:02:05.921000Z` | `2026-05-22T06:02:05.921137Z` | **137 微秒** |

→ server `WHERE updated_at > '06:02:05.921'` · `06:02:05.921137 > 06:02:05.921000` = TRUE · **该行每次都被命中** · pulled=1 永远不变。

---

## §2 根因（5 层精度链路 · 第 1 层是源头）

### §2.1 直接根因 · pg 驱动 TIMESTAMPTZ → JS Date 截断微秒（第 1 层）

**文件**：`node_modules/postgres-date/index.js:32-33`（`pg-types` 默认 `register(1184, parseDate)`）

```js
var ms = matches[7]                              // matches[7] = '.921137'（微秒精度文本）
ms = ms ? 1000 * parseFloat(ms) : 0              // 1000 * 0.921137 = 921.137
date = new Date(Date.UTC(year, month, day, hour, minute, second, ms))
//                                              ^^ 第 7 参数 ms · Date 构造时取整 → 921 · 丢 0.137 ms = 137 μs
```

**JS Date 本身设计上就是毫秒精度**（`Date.getTime()` 返回毫秒整数 number）· 即使 ms 传入 921.137 · 内部存为 921 · 微秒永久丢失。

**实测验证**（agent 在 node 中 require postgres-date 直接验证）：
```
Input:  '2026-05-22 06:02:05.921137+00'
Parsed: 2026-05-22T06:02:05.921Z
Lost:   137 microseconds
```

### §2.2 放大环节 A · `syncPullService.ts:81-83` watermark 推进双重经过 Date

**文件**：`server/src/services/syncPullService.ts:80-83`

```ts
// 3. watermark 推进
const watermark = rows.length > 0
  ? new Date(Math.max(...rows.map(r => r.updatedAt.getTime()))).toISOString()
  //                                  ^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^
  //                                  第 1 次精度丢失（getTime 返毫秒数）
  //         ^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^
  //         第 2 次精度丢失（new Date(ms) 用整数毫秒构造 + toISOString 输出 3 位小数）
  : input.since.toISOString();
```

注释说"事实源 §6.3"·**但协议 §6.3 未规定精度** → 实装"自由发挥"导致精度丢失被合理化。

### §2.3 放大环节 B · `syncPullService.ts:119` wire 层 entry.updated_at 同样截断

**文件**：`server/src/services/syncPullService.ts:118-121`

```ts
created_at: e.createdAt.toISOString(),
updated_at: e.updatedAt.toISOString(),    // ← 客户端拿到的 updated_at 也是毫秒精度
deleted_at: e.deletedAt ? e.deletedAt.toISOString() : null,
```

→ 客户端 `applyServerChanges` 写入本地 entry 缓存的 `updated_at` 也丢了微秒 · 但**客户端不用此字段做 watermark · 仅用 server 返的 response.watermark · 所以这条不直接致命**。

### §2.4 触发闭环 · `entryRepo.ts:307+310` SQL 严格 `>` 与 PG 缺位补零

**文件**：`server/src/repositories/entryRepo.ts:300-310`

```ts
const res = await runner.query(
  `SELECT ... FROM entries e
     JOIN ledgers l ON l.id = e.ledger_id
    WHERE l.family_id = $1
      AND e.updated_at > $2          ← 严格 > 比较
    ORDER BY e.updated_at ASC, e.id ASC
    LIMIT $3`,
  [cursor.familyId, cursor.since.toISOString(), limitPlusOne],
  //                          ^^^^^^^^^^^^^^^^
  //                          第 3 次精度丢失（since 来自 client storage 的毫秒 ISO · 再 toISOString）
);
```

**PG 缺位补零行为**：
- `WHERE updated_at > '2026-05-22T06:02:05.921Z'` → PG 解释为 `updated_at > '2026-05-22 06:02:05.921000+00'`
- DB 真值 `06:02:05.921137+00` → `921137 > 921000` = TRUE
- → 永远命中

### §2.5 `pool.ts` 无自定义 TypeParser（无救援）

**文件**：`server/src/db/pool.ts`（全文 71 行）

无任何 `pg.types.setTypeParser` 调用 · 默认行为 · 没有任何"避开 Date 中转"的设计。

### §2.6 协议层无精度规定（设计源头漏洞）

**文件**：`docs/api/sync-protocol.md` §6.3 watermark 单调性铁律 · 仅规定单调不回退 · **未规定精度**。

→ COSTRA-154 R1 实装"自由"地用毫秒精度 · review-tech 也找不到事实源对照 · 全链路漏过。

---

## §3 漏拉风险 vs 流量重传分析

### §3.1 单 entry 重传场景（已铁证）

- DB 有 1 条 entry · updated_at = `06:02:05.921137`
- 客户端 watermark = `921Z`（截断）
- 每次 pull → 1 条返回 → applyServerChanges 幂等 upsert → 数据正确 · 仅流量浪费

### §3.2 多 entries 同毫秒不同微秒（无漏拉 · 仅重传）

构造：
- T = `06:02:05.921137`：entry-A
- T = `06:02:05.921999`：entry-B
- 客户端 pull `since=epoch` · LIMIT=200 → 返 [A, B] · max(updated_at).toISOString() = `921Z`
- 客户端 watermark = `921Z`
- 下次 pull `since=921Z` → server `WHERE > '921'` → 命中 [A, B] 两条
- → **重传 2 条**（不是漏拉）· upsert 幂等 · 数据正确

### §3.3 LIMIT 边界场景（潜在漏拉风险 · 待 agent 进一步验证 · 标"待验证"）

构造（极端边界）：
- T = `06:02:05.921000`：entry-A（恰好整毫秒）
- T = `06:02:05.921137`：entry-B
- 客户端 pull `since=epoch` · LIMIT=1 → 返 [A] · A 的 updated_at.toISOString() = `921Z` · max → `921Z`
- 客户端 watermark = `921Z`
- 下次 pull `since=921Z` → server `WHERE > '921000'` → 命中 [B]（因为 B 是 921137）
- → **B 被拉到** · 不漏

但如果：
- T = `06:02:05.921000`：entry-A
- T = `06:02:05.921999`：entry-B
- LIMIT=1 · ORDER BY updated_at ASC → 返 [A] · max=921Z
- watermark=921Z
- 下次 pull · 同上 · 命中 [B] · 不漏

→ **agent 经穷举认为不会真漏拉**，仅重传。但**这依赖 server `WHERE > since` 严格比较 + ORDER BY ASC 的稳定性**。如果未来引入分页 cursor 或并发竞态 · 不保证。**标"待 review-tech 在修复 PR 中复审"**。

### §3.4 真机量化

按 agent 估算：
- 每 60s periodic 一次 pull · 每次重传 1 条 entry（~500 bytes wire）→ 每分钟浪费 ~500 bytes
- **持续到该 entry 被新行 supersede 为止**（如用户编辑该 entry · updated_at 更新 · 老 watermark 失效）
- 单用户单家庭 · 日均 ~720 KB 浪费（24h × 60min × 500B）
- 多用户场景累乘 → 流量 + DB 查询次数双重浪费

→ **不致命 · 但不修就一直流血**。

### §3.5 残余风险声明（v1.1 · 2026-05-22 15:55 Human 灵魂拷问后追补）

⚠️ **诚实声明**：本 BUG 修复（候选 2 · 微秒精度）**并不能 100% 完美解决所有 watermark 推进的边界场景**，仍存在 3 类残余风险：

#### §3.5.1 残余风险 ① · 同微秒并发写漏拉（极小概率 · 已验证）

**铁证**（2026-05-22 15:55 Human SQL 验证）：
```sql
SELECT now() AS t1, now() AS t2;
-- 结果：t1 = t2 = 2026-05-22 15:55:53.617793+08
SELECT clock_timestamp() AS c1, clock_timestamp() AS c2;
-- 结果：c1 = c2 = 2026-05-22 15:55:53.618237+08
```

→ PostgreSQL 在同一 query 内多次 `now()` / `clock_timestamp()` 返回**完全相同的微秒值**。如果家庭成员 A、B 在同一微秒内被同一 server 进程处理 · 两条 entry 的 `updated_at` 完全相同。

**漏拉路径**：
- client C pull `since=epoch` · LIMIT=1 · ORDER BY `updated_at ASC, id ASC` → 取 entry-A
- watermark = entry-A.updatedAtIso（与 entry-B 完全相同）
- client C 下次 pull `since=watermark` → server `WHERE updated_at > since` → entry-B **漏拉**（921137 > 921137 = false）
- ORDER BY 加了 `id ASC` 也救不了 · 因为 watermark 推进只用 `updated_at` 不带 `id`

**真实概率**：
- PG 单进程 INSERT 吞吐量 ~5000 ops/s · 平均间隔 200μs
- 同微秒概率 ~0.0005%
- Costra MVP 家庭场景日均几十笔 → 几乎不会触发
- 但**触发一次就永久漏拉**那条 entry（直到该 entry 被新写 supersede）

#### §3.5.2 残余风险 ② · NTP 时钟回拨破坏单调性（理论风险）

PG `now()` 依赖系统时钟。NTP 校时回拨时：
- 上一条 entry-A `updated_at = 14:02:05.921137`
- NTP 回拨系统时钟 → 下一条 entry-B `updated_at = 14:02:05.920500`（< 921137）
- client watermark 已推进到 921137 → 永远拉不到 921 < 921137 的 entry-B

→ 协议 §6.3 单调性铁律假设 "server 端写操作用 NOW() · updated_at 不回退" · **但这个假设依赖系统时钟单调** · NTP / 容器调度可破坏。

#### §3.5.3 残余风险 ③ · PG 主从切换（运维风险）

- 主库时钟 14:02:05.921137 写一条 entry
- 主库故障切到从库（从库时钟可能慢 ~3ms）
- 从库下一条 `updated_at = 14:02:05.918500` < 主库的 921137
- client watermark = 921137 → 永远漏拉这条

→ MVP 单库阶段不存在 · 但**协议没有兜底防御**。

#### §3.5.4 真正彻底的方案（中长期 follow-up）

| 方案 | 解决程度 | 改动量 | 时机 |
|---|---|---|---|
| **A · 微秒精度（本 BUG 已实施）** | 99.9%+ | 小 | MVP 当前 ✅ |
| **B · 自增序列号 `change_seq`** | 100% | 大（schema + protocol） | 主从架构前 |
| **C · WAL LSN** | 100% | 极大 | 大型系统 |
| **D · 复合 watermark `{ts, id}`** | 解决同微秒漏拉 · 不解决时钟回拨 | 中 | Sprint-3+ |

#### §3.5.5 当前接受的残余风险（MVP 阶段）

| 风险 | MVP 触发概率 | 接受理由 |
|---|---|---|
| 同微秒漏拉 | ~0%（家庭并发极低） | 真触发到也是极个别 entry · 可后续手动修复 |
| NTP 回拨 | docker-compose 单 PG · 系统时钟稳定 | 不触发 |
| 主从切换 | MVP 单库 | 不存在 |

→ **当前修复在 MVP 阶段是充分的（good enough）**。残余风险接受 · 立 follow-up 卡：

**Follow-up 候选**：
- **FU-154-WATERMARK-COMPOSITE-KEY**（Sprint-3+）：升级为复合 watermark `{updated_at, id}` · 解决同微秒漏拉
- **FU-154-WATERMARK-LOGICAL-SEQ**（生产化前）：迁移到自增序列号 · 协议 v2.0 · 解决全部 3 类风险

---

## §4 修复方案矩阵（4 候选 · 推荐候选 2）

| # | 方案 | 改动文件 | 影响范围 | 风险 | 工程量 | 推荐 |
|---|---|---|---|---|---|---|
| **1** | pg 驱动 setTypeParser TIMESTAMPTZ → string | `pool.ts` | 全 server 受影响（所有 Date 字段变 string）· 大量 repo 接口签名要改 | 高 · 改动面巨大 | ~1 天 + 全测试调整 | ❌ |
| **2** | SQL 层 `to_char` TIMESTAMPTZ → 微秒 ISO 字符串 · 仅 sync 链路 | `entryRepo.ts` + `syncPullService.ts` + `entryRepo.ts:rowToEntity` 加 `updatedAtIso` 字段 | 仅 sync pull 链路 · 局部 | 低 · 单点修复 | ~30 分钟 + 4 单测 | ✅ |
| **3** | 协议层规定 since 用 BIGINT 微秒 epoch | `openapi.yaml` + `sync-protocol.md` + 所有 client/server | 颠覆性 · 老 storage 不兼容 | 高 · MVP 后期不能动协议 | ~2 天 | ❌ |
| **4** | 客户端 watermark + 1ms hack | `db.ts` setWatermark 加 1ms | 客户端单文件 | 高 · 跳过 1ms 内 entries · **真漏拉** | ~5 分钟 | ❌ |

### §4.1 候选 2 实施细节（推荐 · 彻底干净）

**改动 1**：`server/src/repositories/entryRepo.ts:300-316` SQL SELECT 加 `to_char` 字段

```ts
const res = await runner.query(
  `SELECT e.id, e.ledger_id, l.family_id, e.amount, e.currency, e.type, e.category_id,
          e.account_id, e.to_account_id, e.note, e.occurred_at,
          e.created_by, e.created_at, e.updated_at, e.deleted_at, e.version, e.client_ref_id,
          to_char(e.updated_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS updated_at_iso
       ^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^
       ^^^ 微秒精度 ISO 字符串（HH24:MI:SS.US 中 US = microseconds 6 位）
     FROM entries e
     JOIN ledgers l ON l.id = e.ledger_id
    WHERE l.family_id = $1
      AND e.updated_at > $2
    ORDER BY e.updated_at ASC, e.id ASC
    LIMIT $3`,
  [cursor.familyId, cursor.since, limitPlusOne],
                    //  ^^^^^^^^ 改为传 string · 不再 toISOString（避免再次截断）
);
```

**改动 2**：`PullEntryRow` / `EntryEntity` 类型加 `updatedAtIso` 字段（或单独类型）

```ts
export type PullEntryRow = EntryEntity & {
  familyId: string;
  updatedAtIso: string;  // 微秒精度 ISO · 来自 SQL to_char
};
```

`rowToEntity` 中：
```ts
return {
  ...其他字段,
  updatedAtIso: row.updated_at_iso as string,
};
```

**改动 3**：`syncPullService.ts:80-83` watermark 推进改用字符串

```ts
const watermark = rows.length > 0
  ? rows.reduce((max, r) => r.updatedAtIso > max ? r.updatedAtIso : max, rows[0].updatedAtIso)
  : input.since;  // since 现在是 string · 不再 toISOString
```

ISO 8601 字符串比较与时间比较等价（前提：格式一致 · 都是 UTC `Z` 后缀 · 微秒 6 位）。

**改动 4**：`syncPullService.ts:118-121` entryToWire 用 `updatedAtIso`

```ts
return {
  ...其他字段,
  created_at: e.createdAt.toISOString(),       // created_at 保留毫秒（不影响 watermark）
  updated_at: e.updatedAtIso,                  // ← 改用微秒精度 ISO
  deleted_at: e.deletedAt ? e.deletedAt.toISOString() : null,
};
```

**改动 5**：`syncPullService.ts:32-46` `SyncPullInput.since` 类型从 `Date` 改 `string`

```ts
export interface SyncPullInput {
  userId: string;
  familyId: string;
  since: string;  // ← 微秒精度 ISO 字符串 · 不再 Date
  limit: number;
}
```

**改动 6**：`server/src/routes/sync.ts:182` 路由层不再 `new Date(since)` · 直接传字符串

```ts
const result = await syncPull({
  userId,
  familyId: query.family_id,
  since: query.since,  // ← 直接传字符串 · 不 new Date
  limit: query.limit ?? 200,
});
```

**改动 7**：`PullCursor.since` 也改 string（entryRepo.ts 类型定义）

**改动 8**：`docs/api/sync-protocol.md` §6.3 加精度铁律：

> watermark 与 entries[*].updated_at 必须为 **微秒精度** ISO 8601 字符串（格式：`YYYY-MM-DDTHH:MM:SS.UUUUUUZ`）。Server 必须用 `to_char` 或等价 SQL 输出 · 禁止经过 JS Date 中转（截断到毫秒）。Client 必须按字符串原样存储 / 透传 · 禁止用 `new Date(s).toISOString()` 重新格式化。

---

## §5 单测设计（必须加）

### §5.1 最小复现单测（修复前 FAIL · 修复后 PASS）

`server/test/sync-pull.test.ts` 加：

```ts
it('T15 watermark 微秒精度保留 · 二次拉 since=watermark → entries=[]（BUG-COSTRA-154-WATERMARK-PRECISION 回归）', async () => {
  // 直接 INSERT 一条带微秒尾数的 entry（绕过 push 链路）
  const pool = (await import('../src/db/pool.js')).getPool();
  const entryId = '019e4e46-d6e0-745b-bba5-a4d61584102e';
  await pool.query(
    `INSERT INTO entries (id, ledger_id, amount, type, occurred_at, created_by, updated_at, created_at, version, client_ref_id)
     VALUES ($1, $2, 1234, 'expense', '2026-05-22T10:00:00.000Z', $3,
             '2026-05-22 06:02:05.921137+00',
             '2026-05-22 06:02:05.921137+00',
             1, 'precision-test-1')`,
    [entryId, LEDGER_ID, userId],
  );

  // 第一次 pull · 拿 watermark
  const r1 = await app.inject({
    method: 'GET',
    url: `/v1/sync/pull?family_id=${FAMILY_ID}&since=${encodeURIComponent(EPOCH)}`,
    headers: { authorization: `Bearer ${token}` },
  });
  const b1 = r1.json() as { watermark: string; changes: { entries: Array<{ updated_at: string }> } };
  expect(b1.changes.entries.length).toBe(1);

  // 关键断言 1：watermark 必须是微秒精度（含 6 位小数 · 不是 3 位）
  expect(b1.watermark).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{6}Z$/);
  expect(b1.watermark).toBe('2026-05-22T06:02:05.921137Z');

  // 关键断言 2：entry.updated_at 也必须微秒精度
  expect(b1.changes.entries[0].updated_at).toBe('2026-05-22T06:02:05.921137Z');

  // 第二次 pull · since=watermark · 期望 entries=[] + watermark 不变（不重传）
  const r2 = await app.inject({
    method: 'GET',
    url: `/v1/sync/pull?family_id=${FAMILY_ID}&since=${encodeURIComponent(b1.watermark)}`,
    headers: { authorization: `Bearer ${token}` },
  });
  const b2 = r2.json() as { watermark: string; changes: { entries: unknown[] } };
  expect(b2.changes.entries.length).toBe(0);  // ← 修复前此处 FAIL（实际为 1）
  expect(b2.watermark).toBe(b1.watermark);    // 不推进
});
```

### §5.2 多 entries 同毫秒不同微秒回归

```ts
it('T16 多 entries 同毫秒不同微秒 · pull 全拿 + watermark = max 微秒精度', async () => {
  const pool = (await import('../src/db/pool.js')).getPool();

  // 三条 entry · 同毫秒不同微秒
  await pool.query(
    `INSERT INTO entries (id, ledger_id, amount, type, occurred_at, created_by, updated_at, created_at, version, client_ref_id)
     VALUES
     ('019e4e46-0000-0001-aaaa-000000000001', $1, 100, 'expense', '2026-05-22T10:00:00.000Z', $2, '2026-05-22 06:02:05.921000+00', NOW(), 1, 'mp-1'),
     ('019e4e46-0000-0002-aaaa-000000000002', $1, 200, 'expense', '2026-05-22T10:00:00.000Z', $2, '2026-05-22 06:02:05.921500+00', NOW(), 1, 'mp-2'),
     ('019e4e46-0000-0003-aaaa-000000000003', $1, 300, 'expense', '2026-05-22T10:00:00.000Z', $2, '2026-05-22 06:02:05.921999+00', NOW(), 1, 'mp-3')`,
    [LEDGER_ID, userId],
  );

  const r1 = await app.inject({
    method: 'GET',
    url: `/v1/sync/pull?family_id=${FAMILY_ID}&since=${encodeURIComponent(EPOCH)}`,
    headers: { authorization: `Bearer ${token}` },
  });
  const b1 = r1.json() as { watermark: string; changes: { entries: Array<{ amount: number; updated_at: string }> } };
  expect(b1.changes.entries.length).toBe(3);
  expect(b1.watermark).toBe('2026-05-22T06:02:05.921999Z');  // 最大微秒值

  // 二次 pull since=watermark → 全空
  const r2 = await app.inject({
    method: 'GET',
    url: `/v1/sync/pull?family_id=${FAMILY_ID}&since=${encodeURIComponent(b1.watermark)}`,
    headers: { authorization: `Bearer ${token}` },
  });
  const b2 = r2.json() as { changes: { entries: unknown[] } };
  expect(b2.changes.entries.length).toBe(0);
});
```

### §5.3 单测覆盖盲点修订

T7-T10 当前都用 `since=epoch` 或 `since=watermark`（来自上一次 pull）· 没有"已知微秒精度的精确 since"测试 · review-tech 应在 C6 维度补一条："T 系列必须含一组直接 INSERT 含微秒尾数 + 二次 pull 不重传"。

---

## §6 影响范围 + 决策

### §6.1 断言影响

| 断言 | 影响 |
|---|---|
| **A · 5 分钟无 fail** | ⚠️ 间接影响（periodic 重传不算 fail · 但 console pulled=1 持续可能误导）|
| **B · launch 触发 sync ok** | ✅ 不影响（pulled=1 仍是 ok）|
| **C · page-show debounce** | ✅ 不影响 |
| **D · network-recover** | ✅ 不影响（D 只验首次 push · 不验后续 pulled=0）|
| **E · watermark 持久化** | ❌ **直接阻断 PASS**（§3.E.5 PASS 判据要求 `pulled=0` · 当前永远 ≥ 1）|

### §6.2 approve 决策

- **不修复 → 联合 approve 不能通过**（断言 E FAIL · 5/5 PASS 标准未达）
- **修复后 → 重测断言 E + A**（B/C/D 不需重测）

### §6.3 R1.x.2 同轮还是新 round

**与 BUG-COSTRA-150-D（已修复但未 commit）合并为 R1.x.2 同轮**：
- BUG-150-D 是 client (miniprogram) outbox 死锁 · COSTRA-150 责任
- 本 BUG 是 server (sync pull) 精度 · COSTRA-154 责任
- 两者协议两端同 round 修复 · 单 commit 收尾 · 符合 D-024 §2.4 攒批节奏
- 修订手册 §3.E.5 PASS 判据明确 · 联合冒烟 v1.2

### §6.4 真机量化

按 §3.4 估算 · 单用户日均 ~720 KB 流量浪费 · 修复后归零。

---

## §7 修复路径决策（待 Human）

| 选项 | 含义 | 估时 | 影响 |
|---|---|---|---|
| **A** | R1.x.2 同轮（与 BUG-150-D 合并）· miniapp-dev + backend-dev 同 commit · 单 PR 收尾 | ~60 min | 阻 154+150 联合 approve · 必须重测断言 D + E |
| **B** | 暂跳过 §3.E · 仅 4/5 PASS 后 approve · 留 R2 修 | 0 | 留 P1 隐患 · 不推荐 |
| **C** | 单独立卡 R1.x.3 · 与 BUG-150-D 分两个 round | ~120 min | 流程过重 · 不必要 |

**Orchestrator 推荐 A**：
- 修复量：server `entryRepo.ts` ~5 行 + `syncPullService.ts` ~15 行 + 类型定义 ~5 行 + 路由 ~3 行 + 协议文档 ~5 行 + 单测 ~80 行 ≈ 110 行
- 风险：低（局部修复 · 不动其他模块）
- 与 BUG-150-D 合并 commit · 联合冒烟 v1.2 一次到位

---

## §8 临时绕过（修复前 Human 想继续测的话）

§3.E 的目的是验证 watermark 持久化 + 增量协议 · 即使 `pulled=1` 永远不变 · 仍可验证：
- ✅ watermark storage 写入（已验证 · `wx.getStorageSync('watermark:...')` 非空）
- ✅ Network since 参数非 epoch（已验证 · since=`06:02:05.921Z`）
- ✅ watermark 单调（不回退 · 两次值相同也算单调）
- ❌ pulled=0（永远 FAIL · 因本 BUG）

**临时绕过断言 E PASS 判据**：把 §3.E.5 改为：
- **PASS**：since 非 epoch + watermark 非 epoch + 任意一次 pull 后 pulled 不再增长（稳态 ≥ 1 也算 · 因 BUG-COSTRA-154-WATERMARK-PRECISION 已立卡 · R1.x.2 修复中）

→ 这是**手册临时调整**· 不是真 PASS · 修复后必须改回严格判据。

---

## §9 联合 Sprint-3 末 Retro 议题候选（沉淀）

- 🆕 **议题 · D-025 AP-001 第 3 次 Orchestrator 命中**：本次实测中 Orchestrator 给的诊断命令 storage key 名错（`sync:watermark:` vs 实际 `watermark:`）· 经 Human 严肃纠偏才查到。AP-001 反模式扩展到"手册常量裸抄不引代码事实源"
- 🆕 **议题 · D-025 AP-006 候选 · 跨语言/跨格式精度铁律未规定即漏检**：协议文档未规定 watermark 精度 → server 实装"自由发挥"用毫秒精度 → review-tech 找不到事实源对照漏过。建议补一条："任何跨语言/跨格式（DB ↔ ORM ↔ Wire ↔ Client storage）的时间戳/数值传递 · 协议文档必须明确精度铁律"
- 🆕 **议题 · review-tech C6 单测维度盲点**：T7-T10 当前用 `since=epoch` 或 `since=watermark` · 未测精度边界（直接 INSERT 含微秒尾数）。review-tech 应加扫描项："凡涉及时间戳比较的 SQL 查询 · 必须有一组直接 INSERT 含尾数精度 + 二次拉不重复的回归测试"
- 🆕 **议题 · BUG-150-D 修复后副作用**：BUG-150-D 修复后 `pulled` 字段被准确暴露 · 立刻看到 BUG-154-PRECISION（之前被掩盖）· 这是"修一个 bug 暴露下一层 bug"的正向螺旋 · D-022 §4.1 runtime T2 卡铁律真兑现 · 沉淀为成功范式

---

## §10 修订记录

| 版本 | 时间 | 修订 |
|---|---|---|
| v1.0 | 2026-05-22 14:18 | 初版立案 · Human §3.E 触发 + Console + SQL 双重铁证 + agent 排查链路 + 候选 2 修复方案 + 单测 T15/T16 草案 + R1.x.2 同轮 path 建议 |

---

**事实源 / 依据**：

- COSTRA-154 R1 commit `7e87bad`（`syncPullService.ts:81-83` watermark 推进实装）
- COSTRA-154 R1.x.1 commit `8eecd4c`（ledgers 类型修订 · 不动 watermark 逻辑）
- 服务端代码：
  - `server/src/services/syncPullService.ts:80-83`（watermark 推进双重精度丢失）
  - `server/src/services/syncPullService.ts:118-121`（wire entry.updated_at 截断）
  - `server/src/repositories/entryRepo.ts:300-316`（SQL `>` 严格比较 + cursor.since.toISOString()）
  - `server/src/db/pool.ts`（无 setTypeParser · 默认 Date 解析）
  - `server/src/routes/sync.ts:182`（`new Date(query.since)` 入参）
- 协议文档：
  - `docs/api/sync-protocol.md` §6.3 watermark 单调性铁律 · **未规定精度**
- 客户端代码（仅参与触发链路 · 不需修复）：
  - `miniprogram/services/db.ts:267-273` getWatermark/setWatermark
  - `miniprogram/services/sync.ts:43-67` syncPull 透传 watermark
- Human 实测会话：
  - 2026-05-22 14:11:51 + 14:12:51 Console 双 periodic 同 watermark 同 pulled=1 铁证
  - `wx.getStorageSync('watermark:00000000-0000-0000-0000-0000000000F0')` → `{ d: "2026-05-22T06:02:05.921Z" }`
  - `psql ... EXTRACT(MICROSECONDS FROM updated_at)` → `5921137`（137 微秒尾数）
- 第三方驱动：
  - `node_modules/postgres-date/index.js:32-33`（pg-types TIMESTAMPTZ → Date 截断微秒）
- 关联范式：
  - D-022 §4.1 runtime 类 T2 卡铁律（第 4 次正向兑现）
  - D-025 AP-001 字符串代理判定（Orchestrator 第 3 次自我命中 · storage key 名）
  - BUG-COSTRA-150-D（同 R1.x.2 同轮修复 · 暴露本 BUG 的前置条件）
  - 关联 BUG：`qa/defects/2026-05-22-COSTRA-150-D-outbox-deadlock-on-push-failure.md`（同 R1.x.2 · 双卡 server/client 协同修复范式）

---

## §11 v1.2 升级声明（2026-05-22 16:00 · 选项 B 彻底修复）

### §11.1 升级背景

§3.5 残余风险声明后 · Human 拍板选项 B（同 R1.x.2 同轮做到底）· 不立 follow-up 卡 ·
直接追加 v1.2 协议升级 · 完全消除 3 类残余风险（同微秒并发 / NTP 回拨 / 主从切换）。

### §11.2 协议演化路径

```
v1.0 (COSTRA-154 R1)
  → watermark = ISO 毫秒 · 严重 bug · pulled 永远不归零

v1.1 (BUG-154 微秒精度修复 · 2026-05-22 上午)
  → watermark = ISO 微秒 · 99.9% 场景 OK · 残余 3 类风险

v1.2 (本次升级 · 2026-05-22 下午 · 选项 B)
  → watermark = BIGINT change_seq · 100% 解决一致性
  → updated_at 降级为毫秒精度展示用
  → 协议向后不兼容（client 自动 fallback 全量 pull 一次）
```

### §11.3 v1.2 核心改动

#### server 端

| 文件 | 改动 |
|---|---|
| `server/db/migrations/0006_entries_change_seq.sql` | 新增 · CREATE SEQUENCE + ALTER TABLE ADD COLUMN + 历史回填 + UNIQUE + 索引 |
| `server/src/repositories/entryRepo.ts` | EntryEntity 加 `changeSeq` · INSERT 走 DEFAULT nextval · UPDATE/softDelete 显式 SET nextval · `findEntriesByFamilySince` 改 WHERE/ORDER BY change_seq |
| `server/src/services/syncPullService.ts` | `since: number` · watermark 推进改用 `rows[末位].changeSeq` · entryToWire 加 `change_seq` |
| `server/src/routes/sync.ts` | pullQuerySchema since: integer minimum=0 · 删除 ISO 解析 |
| `server/api/openapi.yaml` | SyncPullResponse.watermark: integer int64 · Entry.change_seq 新增字段 |
| `docs/api/sync-protocol.md` §6.3 | 完全重写 · v1.2 协议铁律 · 删除 v1.1 微秒精度铁律 + 残余风险声明 |
| `server/test/setup.ts` | pg-mem 注册 setval mock · entries DDL 加 SEQUENCE + change_seq 列 |
| `server/test/sync-pull.test.ts` | T5/T7/T8/T10 改写 · T15-T17 改 BIGINT · 新增 T18/T19/T20（共 21 测） |

#### client 端

| 文件 | 改动 |
|---|---|
| `miniprogram/services/db.ts` | `getWatermark/setWatermark` 类型 string → number · 默认值 epoch ISO → 0 · 检测 legacy ISO 自动重置 |
| `miniprogram/services/sync.ts` | `SyncPullResponse.watermark: number` · `typeof === 'number'` 防御 |
| `miniprogram/services/syncScheduler.ts` | `SyncResult.watermark: number` |
| `miniprogram/services/db.spec.ts` | watermark 测试改 BIGINT · 新增 legacy ISO 自动重置 + 防御负数/浮点 |

#### 设计决策（事实源 · 不再背包袱）

- ✅ **PG SEQUENCE** 生成 seq · 不雪花算法（`migration 0006_entries_change_seq.sql`）
- ✅ **应用层显式 nextval** 不用 plpgsql trigger · 因 pg-mem 不支持 trigger（事实源：`server/test/setup.ts` registerPgMemFunctions 注释）
- ✅ **BIGINT 用 number 类型** 不用 string · MVP 永远跑不到 2^53（注释已标）
- ✅ **`updated_at` 保留 wire 字段** 仅展示语义 · 不再要求微秒精度（毫秒 ISO 即可）
- ✅ **client 自动 fallback** legacy ISO 字符串检测后重置为 0 · 一次性全量 pull · 之后正常

### §11.4 §3.5 残余风险消除验证

| §3.5 残余风险 | v1.2 消除证据 |
|---|---|
| ① 同微秒并发漏拉 | T19 测试用直接 INSERT 三条同 query · 验证 change_seq 严格 +1 不撞号 + 二次 pull entries=[] |
| ② NTP 时钟回拨 | sequence 不依赖时钟 · 内部用 PG WAL 持久化 · 无时钟回拨风险 |
| ③ PG 主从切换 | sequence 跨主从复制安全（PG 标准行为）· nextval 在主从一致 |

### §11.5 单测覆盖

- **server**: 56/56 PASS（含 sync-pull.test.ts 21 测 T1-T20）
- **client**: 58/58 PASS（含 db.spec.ts 9 测 · 新增 4 条 v1.2 watermark 测）
- **lint**: 0 error

### §11.6 部署顺序（生产化前 follow-up）

⚠️ MVP 阶段（dev / staging）数据可重置 · 无部署顺序问题。
**生产化前必须遵循**：

1. **先部署 server**：跑 migration 0006_entries_change_seq.sql（含历史数据回填）
2. **然后发 client**：旧 client 短暂传 ISO since 会被 server 400 拒绝 · 进入 client fallback 全量 pull
3. **fallback 路径**：client `getWatermark` 检测旧 storage 自动重置为 0 · 下次 pull 全量
4. **流量峰值**：所有 client 升级首次 pull 拉全部历史 entries · 一次性流量 · 之后正常增量

### §11.7 v1.2 协议字段速查

| 字段 | 旧（v1.0/v1.1） | 新（v1.2） |
|---|---|---|
| `since` query | `string` ISO 8601 | `integer` int64 minimum=0 |
| `watermark` response | `string` ISO 8601 | `integer` int64 |
| `entries[].change_seq` | 不存在 | `integer` int64 新增 |
| `entries[].updated_at` | `string` 微秒 ISO | `string` 毫秒 ISO（降级 · 仅展示） |
| client storage `watermark:<fid>` | ISO 字符串（envelope.d） | number（envelope.d） |
| `entryRepo.PullCursor.since` | `Date` → `string`（v1.1） | `number` |
| `entryRepo.EntryEntity` | 无 changeSeq | 加 `changeSeq: number` |

### §11.8 验收标准（重测项）

- [x] 单测全过（server 56 + client 58）
- [ ] Human 重测断言 D（切 offline 模拟器面板 + entry 上传）
- [ ] Human 重测断言 E（杀进程冷启 + watermark 数字 + pulled=0）
- [ ] Human 验证 §11.4 同微秒并发场景（不必复现 · 单测覆盖即可）
- [ ] commit + push（含两个 BUG 卡 + 16 个 server/client 文件 + migration 0006）

### §11.9 §3.5 follow-up 卡作废

§3.5.5 提出的两个 follow-up 卡：

- ❌ ~~`FU-154-WATERMARK-COMPOSITE-KEY`~~（被 v1.2 直接超越 · 不再需要）
- ❌ ~~`FU-154-WATERMARK-LOGICAL-SEQ`~~（v1.2 即此方案 · 已实施 · 不再立卡）

### §11.10 修订记录追加

| 版本 | 时间 | 修订 |
|---|---|---|
| v1.0 | 2026-05-22 11:48 | 初版立案（微秒精度修复方案） |
| v1.1 | 2026-05-22 15:55 | §3.5 残余风险声明（同微秒/NTP/主从）|
| **v1.2** | **2026-05-22 16:00** | **§11 升级声明 · 选项 B 彻底修复 · BIGINT change_seq 替代 ISO 时间戳 · 完全消除 §3.5 全部 3 类风险** |
