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
 *   - income  → +amount，expense → -amount，transfer → 0
 *   - 仅当 new_change_seq > balance_baseline_seq 时叠加（幂等谓词）
 *   - 用户重锚资产时 baseline = MAX(entries.change_seq)，旧流水视为已消化
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
  };
}

const SELECT_COLUMNS = `
  id, family_id, name, currency, created_at, updated_at, deleted_at, version,
  balance_cents, balance_baseline_seq, balance_version
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

// ═════════════════════════════════════════════════════════════════════════════
// 资产累加（COSTRA-4xx）
// ═════════════════════════════════════════════════════════════════════════════

/**
 * 对账本资产做原子累加（delta 可正可负）。
 *
 * 幂等谓词：仅当 $newSeq > balance_baseline_seq 时才叠加。
 *   - delta = 0（如 transfer）时不产生 UPDATE，避免无谓行锁
 *
 * 调用方：entryService 的 create / update / softDelete 分支
 *
 * @returns 是否实际更新了 balance（true=叠加发生，false=被 baseline 谓词过滤掉或 delta=0）
 */
export async function applyBalanceDelta(
  input: {
    ledgerId: string;
    delta: number;           // 单位分；正=资产增加，负=资产减少
    newSeq: number;          // entry 写入时分配的新 change_seq
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
      WHERE id = $1
        AND $3 > balance_baseline_seq`,
    [input.ledgerId, input.delta, input.newSeq],
  );
  return (res.rowCount ?? 0) > 0;
}

/**
 * 对账本资产做"旧贡献回退 + 新贡献叠加"的双 delta 原子更新。
 *
 * 用于 entryService 的 update / softDelete 路径：
 *   - 旧贡献的回退是否发生，取决于 old_seq > baseline（这条流水之前是否被算过）
 *   - 新贡献的叠加是否发生，取决于 new_seq > baseline（这条流水现在是否要算）
 *   - 两个谓词独立判定，全部在一条 UPDATE 里完成，保证 ledgers 行锁原子性
 *   - 单次 UPDATE → balance_version 只+1（一次业务动作 = 一次版本推进）
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
    oldSeq: number;          // 这条流水原来的 change_seq
    newSeq: number;          // 这条流水更新后的 change_seq
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
        SET balance_cents   = balance_cents
              + CASE WHEN $2 > balance_baseline_seq THEN $3 ELSE 0 END
              + CASE WHEN $4 > balance_baseline_seq THEN $5 ELSE 0 END,
            balance_version = balance_version + 1
      WHERE id = $1`,
    [
      input.ledgerId,
      input.oldSeq, oldRefund,
      input.newSeq, input.newDelta,
    ],
  );
  return (res.rowCount ?? 0) > 0;
}

/**
 * 用户重锚账本资产（修改资产值）。
 *
 * 语义：
 *   - 把 balance_cents 设为用户新值
 *   - 把 balance_baseline_seq 推进到当前 MAX(entries.change_seq)
 *     → "重锚之前的所有流水都已消化；之后的新流水才继续叠加"
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

// ─── 停服迁移 / 数据回填 ──────────────────────────────────────────────────
// 迁移 SQL 已移至 infra/scripts/migrate-ledger-asset.sh（遵循 infra/scripts 规范），
// 不再在仓库层维护 TS 版本。SQL 逻辑见 docs/design/asset-and-budget-spec.md §6.1。
