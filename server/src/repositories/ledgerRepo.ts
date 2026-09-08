/**
 * Costra · Server · ledgers DAO
 *
 * 卡号：COSTRA-164 / COSTRA-4xx · 事实源：server/db/migrations/0001_init.sql + 0012_ledger_asset.sql
 * 决策锚定：ADR-0007 §3.1 family:ledger=1:1 产品语义
 *
 * 职责：封装 ledgers 表的 SQL 访问；业务层禁止直接写 SQL。
 *
 * 设计原则：
 *   - 参数化查询；严禁字符串拼接
 *   - 返回领域实体接口（LedgerEntity），不暴露 pg 行对象
 *   - Runner 透传模式（与 userRepo.ts L65/L114/L141 同构）· 单测可注入 mock
 *
 * 资产字段（COSTRA-4xx）：
 *   - balance_cents：账本资产净值（分）
 *   - balance_baseline_seq：资产累加基线（entries.change_seq）
 *   - balance_version：资产独立乐观锁版本（独立于 ledgers.version）
 *
 * 资产累加规则（见 asset-and-budget-spec.md §4.2）：
 *   - income→ +amount，expense → -amount，transfer → 0
 *   - 幂等由同事务 + 唯一约束（create）/ 乐观锁（update/softDelete）保障
 *   - 用户重锚资产时baseline = MAX(entries.change_seq)，旧流水视为已消化
 *   - balance_baseline_seq 仅作审计字段保留，不再参与累加判断
 */

import { getPool } from '../db/pool.js';
import { newId } from '../id/idGen.js';

export interface LedgerEntity {
  id: string;
  familyId: string;
  name: string;
  currency: string;
  createdAt: Date;
  updatedAt: Date;
  deletedAt: Date | null;
  version: number;
  // ─── 资产字段（COSTRA-4xx · migration 0012）──────────────────────────
  balanceCents: number;
  balanceBaselineSeq: number;
  balanceVersion: number;
  // ─── 批量写入版本戳（L13 E1 · migration 0019）────────────────────────
  syncEpoch: number;
  // ─── 导入 sync-hold（migration 0021 · 方案 §5.2 · 无 hold 为 NULL 常态）───
  syncHoldSeq: number | null;
  syncHoldUntil: Date | null;
}

interface LedgerRow {
  id: string;
  family_id: string;
  name: string;
  currency: string;
  created_at: Date;
  updated_at: Date;
  deleted_at: Date | null;
  version: number;
  // BIGINT · 真 PG 返 string · pg-mem 返 number · 用 Number() 统一
  balance_cents: string | number;
  balance_baseline_seq: string | number;
  balance_version: number;
  // BIGINT · 真 PG 返 string · pg-mem 返 number
  sync_epoch: string | number;
  // BIGINT 可空 · 真 PG 返 string · pg-mem 返 number（无 hold 为 NULL 常态）
  sync_hold_seq: string | number | null;
  sync_hold_until: Date | null;
}

function rowToEntity(r: LedgerRow): LedgerEntity {
  return {
    id: r.id,
    familyId: r.family_id,
    name: r.name,
    currency: r.currency,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
    deletedAt: r.deleted_at,
    version: r.version,
    balanceCents: Number(r.balance_cents),
    balanceBaselineSeq: Number(r.balance_baseline_seq),
    balanceVersion: r.balance_version,
    syncEpoch: Number(r.sync_epoch),
    syncHoldSeq: r.sync_hold_seq == null ? null : Number(r.sync_hold_seq),
    syncHoldUntil: r.sync_hold_until,
  };
}

const SELECT_COLUMNS = `
  id, family_id, name, currency, created_at, updated_at, deleted_at, version,
  balance_cents, balance_baseline_seq, balance_version, sync_epoch,
  sync_hold_seq, sync_hold_until
`;

/**
 * 执行器抽象：允许 repo 在 Pool 或 tx PoolClient 上运行。
 * 与 userRepo.ts 的 Runner 保持同构。
 */
type Runner = { query: (sql: string, params?: unknown[]) => Promise<{ rows: LedgerRow[]; rowCount?: number | null }> };

function exec(): Runner {
  return getPool() as unknown as Runner;
}

/**
 * 创建默认 ledger（个人 family 的唯一账本）
 * 产品语义 family:ledger=1:1（schema 物理 1:N 保留扩展空间）
 */
export async function createDefaultLedger(
  input: { familyId: string; name: string; currency: string },
  client?: Runner,
): Promise<LedgerEntity> {
  const id = newId();
  const runner = client ?? exec();
  const res = await runner.query(
    `INSERT INTO ledgers (id, family_id, name, currency)
          VALUES ($1, $2, $3, $4)
        RETURNING ${SELECT_COLUMNS}`,
    [id, input.familyId, input.name, input.currency],
  );
  if (!res.rows[0]) {
    throw new Error('[ledgerRepo] INSERT returned no row');
  }
  return rowToEntity(res.rows[0]);
}

/**
 * 按 family_id 更新 ledger name（重命名 family 时同步 · 产品语义 1:1）
 * 返回更新后的 ledger entity；无匹配行时返回 null（数据异常 · service 层兜底）
 */
export async function updateNameByFamilyId(
  input: { familyId: string; name: string },
  client?: Runner,
): Promise<LedgerEntity | null> {
  const runner = client ?? exec();
  const res = await runner.query(
    `UPDATE ledgers
        SET name = $2, updated_at = now()
      WHERE family_id = $1 AND deleted_at IS NULL
     RETURNING ${SELECT_COLUMNS}`,
    [input.familyId, input.name],
  );
  return res.rows[0] ? rowToEntity(res.rows[0]) : null;
}

/**
 * 按 id 查 ledger（COSTRA-217 R1.x：entryService 需通过 ledger→family 判定 shared_type 默认值）
 */
export async function findById(
  ledgerId: string,
  client?: Runner,
): Promise<LedgerEntity | null> {
  const runner = client ?? exec();
  const res = await runner.query(
    `SELECT ${SELECT_COLUMNS}
       FROM ledgers
      WHERE id = $1 AND deleted_at IS NULL
      LIMIT 1`,
    [ledgerId],
  );
  return res.rows[0] ? rowToEntity(res.rows[0]) : null;
}

/**
 * 按 id 查 ledger，并一次性带出所属 family 的 kind（单次往返）。
 *
 * 专为 entryService 的 create 路径设计，它需要三样东西：
 *   - id：DB 返回的 canonical UUID · 后续防重 / INSERT / 余额更新统一使用它，
 *         避免"客户端传入值"与"DB 存储值"形式不一致
 *   - familyId：membership 校验的入参
 *   - kind：expense 未显式传 shared_type 时的默认值（family_kind 与 entry_shared_type 同二值）
 *
 * 之所以把 families 合并进来而不是分两次查：kind 是 ENUM 且创建后不可变，
 * 二者是纯串行依赖（先有 family_id 才能查 family），合成一次可少一次事务内往返。
 *
 * family 被软删时返回 null —— 解散与 setAllActiveLeftAt 同事务，
 * 调用方本就会在 membership 校验处拒绝，此处提前返回等价且更省事。
 */
export async function findWithFamilyById(
  ledgerId: string,
  client?: Runner,
): Promise<{ id: string; familyId: string; kind: string; name: string } | null> {
  const runner = client ?? exec();
  const res = await runner.query(
    `SELECT l.id AS ledger_id, l.family_id AS family_id, f.kind AS kind, l.name AS ledger_name
       FROM ledgers l
       JOIN families f ON f.id = l.family_id AND f.deleted_at IS NULL
      WHERE l.id = $1 AND l.deleted_at IS NULL
      LIMIT 1`,
    [ledgerId],
  );
  const row = res.rows[0] as unknown as
    | { ledger_id: string; family_id: string; kind: string; ledger_name: string }
    | undefined;
  return row ? { id: row.ledger_id, familyId: row.family_id, kind: row.kind, name: row.ledger_name } : null;
}

/**
 * 查 family 的第一个 active ledger（产品语义 1:1 · 取第一个即可）
 * 返回 null 表示该 family 无 ledger（数据异常 · service 层自愈补建）
 */
export async function findFirstByFamilyId(
  familyId: string,
  client?: Runner,
): Promise<LedgerEntity | null> {
  const runner = client ?? exec();
  const res = await runner.query(
    `SELECT ${SELECT_COLUMNS}
       FROM ledgers
      WHERE family_id = $1 AND deleted_at IS NULL
      ORDER BY created_at ASC
      LIMIT 1`,
    [familyId],
  );
  return res.rows[0] ? rowToEntity(res.rows[0]) : null;
}

/**
 * 查 family 的全部 active ledger（当前 1:1 语义下至多一行）。
 * 消费方：syncPullService —— sync-hold 钳制必须按"所有未过期 hold 取 min"（不变量 H4），
 * 即使当前 1:1 也按集合实现，防未来放开 1:N 时另一个 ledger 的号段漏出闸门。
 */
export async function findAllActiveByFamilyId(
  familyId: string,
  client?: Runner,
): Promise<LedgerEntity[]> {
  const runner = client ?? exec();
  const res = await runner.query(
    `SELECT ${SELECT_COLUMNS}
       FROM ledgers
      WHERE family_id = $1 AND deleted_at IS NULL
      ORDER BY created_at ASC`,
    [familyId],
  );
  return res.rows.map(rowToEntity);
}

// ═════════════════════════════════════════════════════════════════════════════
// 资产累加（COSTRA-4xx）
// ═════════════════════════════════════════════════════════════════════════════

/**
 * 对账本资产做原子累加（delta 可正可负）。
 *
 * 幂等保障：由调用方同事务 + 唯一约束（create）/ 乐观锁（update/softDelete）提供，
 * 不再依赖 seq 与 baseline 的大小关系。
 *   - delta = 0（如 transfer）时不产生 UPDATE，避免无谓行锁
 *
 * 调用方：entryService 的 create / update / softDelete 分支
 *
 * @returns 是否实际更新了 balance（true=叠加发生，false=delta=0 跳过）
 */
export async function applyBalanceDelta(
  input: {
    ledgerId: string;
    delta: number;           // 单位分；正=资产增加，负=资产减少
    newSeq: number;          // 保留入参兼容调用方签名（SQL 不再使用）
  },
  client?: Runner,
): Promise<boolean> {
  // delta = 0 时跳过 UPDATE（transfer 类型）
  if (input.delta === 0) return false;

  const runner = client ?? exec();
  const res = await runner.query(
    `UPDATE ledgers
        SET balance_cents   = balance_cents + $2,
            balance_version = balance_version + 1
      WHERE id = $1`,
    [input.ledgerId, input.delta],
  );
  return (res.rowCount ?? 0) > 0;
}

/**
 * 对账本资产做"旧贡献回退 + 新贡献叠加"的双 delta 原子更新。
 *
 * 用于 entryService 的 update / softDelete 路径：
 *   - 旧贡献无条件回退（同事务 + 乐观锁保证不重复执行）
 *   - 新贡献无条件叠加（同上）
 *   - 单次 UPDATE → balance_version 只+1（一次业务动作 = 一次版本推进）
 *
 * 幂等保障：由entry 级乐观锁（version = baseVersion）提供，
 * 同一条流水不会被 update/softDelete 两次。
 *
 * 实现细节（pg-mem 兼容）：
 *   - pg-mem 无法对参数 `$N` 应用 unary minus（"Can only apply - unary operator to numeric types"），
 *     故JS 侧先把 oldDelta 取反，作为 "回退量" 直接传入 SQL 加法。
 *
 * 当 oldDelta = newDelta = 0（都是 transfer 或数据无变化）时跳过 UPDATE。
 *
 * @returns 是否实际更新了 balance
 */
export async function applyBalanceSwap(
  input: {
    ledgerId: string;
    oldDelta: number;        // 旧贡献（要回退的值；正=原本是income 已叠加 → 需减去）
    newDelta: number;        // 新贡献（要叠加的值；正=新income，负=新 expense）
    oldSeq: number;          // 保留入参兼容调用方签名（SQL 不再使用）
    newSeq: number;          // 保留入参兼容调用方签名（SQL 不再使用）
  },
  client?: Runner,
): Promise<boolean> {
  // 净变化 = 0（amount 和 type 都没变，且都是 transfer）时不产生 UPDATE
  if (input.oldDelta === 0 && input.newDelta === 0) return false;
  const runner = client ?? exec();

  // JS 侧把旧贡献取反 → SQL 只做加法（pg-mem 不支持 -$N 参数一元运算）
  const oldRefund = -input.oldDelta;

  const res = await runner.query(
    `UPDATE ledgers
        SET balance_cents   = balance_cents + $2 + $3,
            balance_version = balance_version + 1
      WHERE id = $1`,
    [input.ledgerId, oldRefund, input.newDelta],
  );
  return (res.rowCount ?? 0) > 0;
}

/**
 * 用户重锚账本资产（修改资产值）。
 *
 * 语义：
 *   - 把 balance_cents 设为用户新值
 *   - 把 balance_baseline_seq 推进到当前 MAX(entries.change_seq)
 *     → 仅作审计记录（不再用于资产累加谓词判断）
 *
 * 乐观锁：用 balance_version 判定冲突，无匹配行返回 null（service 层抛 409）
 *
 * @returns 更新后的 LedgerEntity 或 null（版本冲突）
 */
export async function rebaseBalance(
  input: {
    ledgerId: string;
    newBalanceCents: number;
    clientBaseVersion: number;
  },
  client?: Runner,
): Promise<LedgerEntity | null> {
  const runner = client ?? exec();
  const res = await runner.query(
    `UPDATE ledgers
        SET balance_cents        = $2,
            balance_baseline_seq = COALESCE(
              (SELECT MAX(change_seq) FROM entries WHERE ledger_id = $1),
              0
            ),
            balance_version      = balance_version + 1
      WHERE id = $1
        AND balance_version = $3
        AND deleted_at IS NULL
     RETURNING ${SELECT_COLUMNS}`,
    [input.ledgerId, input.newBalanceCents, input.clientBaseVersion],
  );
  return res.rows[0] ? rowToEntity(res.rows[0]) : null;
}

// ═════════════════════════════════════════════════════════════════════════════
// 导入 sync-hold（migration 0021 · 方案 §5.2 · E2b）
// ═════════════════════════════════════════════════════════════════════════════

/** hold 兜底 TTL（方案 §5.2.3 不变量 H3 · 远大于 5,000 行导入典型耗时 3~10s） */
export const SYNC_HOLD_TTL_SECONDS = 120;

/**
 * 设置 sync-hold（独立短事务 · 必须在导入大事务之前提交 · 不变量 H1）。
 *
 * 闸门 = 当前已分配的最大 change_seq：导入随后取的号必然 > 闸门，
 * pull 侧按 `change_seq <= MIN(未过期 hold)` 钳制，watermark 不可能越过未提交号段。
 *
 * ⚠️ pg-mem 不支持 `SELECT last_value FROM <sequence>`（"not selectable"），
 * 按方案 §5.2.3 的既定兜底改用 `nextval` —— 每次导入消耗一个号（0016 后序列有空洞无害），
 * 取值偏大是安全侧（§5.2.3：把尚未取号的导入数据暂时挡在闸门外，hold 解除后立即恢复）。
 *
 * 返回闸门值（供失败路径条件清除 · 防误清新一轮执行设置的 hold）；
 * 返回 null = ledger 已删除（调用方按上下文失效处理）。
 */
export async function setSyncHold(ledgerId: string, client?: Runner): Promise<number | null> {
  const runner = client ?? exec();
  const res = await runner.query(
    `UPDATE ledgers
        SET sync_hold_seq   = (SELECT nextval('entries_change_seq')),
            sync_hold_until = now() + interval '${SYNC_HOLD_TTL_SECONDS} seconds'
      WHERE id = $1 AND deleted_at IS NULL
      RETURNING sync_hold_seq`,
    [ledgerId],
  );
  const row = (res.rows as Array<{ sync_hold_seq: string | number | null }>)[0];
  if (!row) return null;
  return row.sync_hold_seq == null ? null : Number(row.sync_hold_seq);
}

/**
 * 清除 sync-hold（导入失败/重试路径 · 方案 §5.2.3 阶段 3 不变量 H3）。
 * 传 expectedSeq 时为条件清除（仅当当前闸门值仍是本执行体设置的那个），
 * 防并发误清新一轮导入设置的 hold；即使本调用失败，sync_hold_until 也兜底自愈。
 */
export async function clearSyncHold(
  ledgerId: string,
  expectedSeq?: number | null,
  client?: Runner,
): Promise<void> {
  const runner = client ?? exec();
  if (expectedSeq != null) {
    await runner.query(
      `UPDATE ledgers
          SET sync_hold_seq = NULL, sync_hold_until = NULL
        WHERE id = $1 AND sync_hold_seq = $2`,
      [ledgerId, expectedSeq],
    );
    return;
  }
  await runner.query(
    `UPDATE ledgers
        SET sync_hold_seq = NULL, sync_hold_until = NULL
      WHERE id = $1 AND (sync_hold_seq IS NOT NULL OR sync_hold_until IS NOT NULL)`,
    [ledgerId],
  );
}

/**
 * 导入大事务末尾的唯一 ledgers 写（不变量 H2 · 与余额同一语句同事务）：
 * 汇总 delta 更新 balance_cents/balance_version + 解除 sync_hold。
 *
 * ⚠️ 不能复用 applyBalanceDelta：它在 delta=0 时 short-circuit 跳过 UPDATE，
 * 全 transfer 导入会连带跳过 hold 解除（该 family 的 sync 白停 120s）。
 * 本函数 delta=0 时也执行（只是不动 balance 数值——仍会推进 balance_version，
 * 与"一次业务动作 = 一次版本推进"口径一致）。
 *
 * ⚠️ 刻意不 bump sync_epoch（方案 §5.2.5）：导入路径用 sync-hold 防止 watermark
 * 越过未提交号段，导入数据走正常增量窗口下发；sync_epoch +1 仅留给
 * 未经 sync-hold 保护的批量写入（运维直连 SQL 修复）。
 */
export async function releaseHoldAndApplyDelta(
  input: { ledgerId: string; delta: number },
  client: Runner,
): Promise<boolean> {
  const res = await client.query(
    `UPDATE ledgers
        SET balance_cents   = balance_cents + $2,
            balance_version = balance_version + 1,
            sync_hold_seq   = NULL,
            sync_hold_until = NULL
      WHERE id = $1`,
    [input.ledgerId, input.delta],
  );
  return (res.rowCount ?? 0) > 0;
}

// ─── 停服迁移 / 数据回填 ──────────────────────────────────────────────────
// 迁移 SQL 已移至 infra/scripts/migrate-ledger-asset.sh（遵循 infra/scripts 规范），
// 不再在仓库层维护 TS 版本。SQL 逻辑见 docs/design/asset-and-budget-spec.md §6.1。
