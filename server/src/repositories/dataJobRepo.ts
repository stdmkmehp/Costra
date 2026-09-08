/**
 * Costra · Server · 数据任务（data_jobs）仓储
 *
 * 事实源：docs/design/data-import-export-client-analysis.md v1.0 §7.3/§7.5
 * 二期落地导入路径：detect_id/source_hash/ruleset_version 由 import 任务写入。
 *
 * 并发闸口（生产由部分唯一索引兜底 · pg-mem 无部分索引，由 create 路径先 SELECT 判定）：
 *   - 每用户至多一个活跃导出任务（queued/processing）
 *   - 每家庭至多一个活跃导入任务（§4.4 · family:ledger=1:1 语义下与"每账本"等价）
 *   - 排队幽灵回收：queued 且 expires_at 过期 ⇒ create 路径先终态化再插入（索引 23505 兜底竞态）
 *
 * worker 协议：
 *   - claim：queued 且到期（next_attempt_at 空或已过）⇒ processing + run_token + 90s 租约
 *   - 终态写回一律按 run_token 条件更新（run_token 不匹配 ⇒ 让位，不写）
 *   - 僵尸回收：processing 且 lease_expires_at 过期 ⇒ 走同一套重试/终态出口
 */

import type { PoolClient } from 'pg';
import { getPool } from '../db/pool.js';
import { newId } from '../id/idGen.js';

/** worker 执行租约（90s · 执行期间周期性续租） */
export const DATA_JOB_LEASE_MS = 90_000;
/** 排队租约（10min · 防幽灵任务占用并发闸口） */
export const DATA_JOB_QUEUE_LEASE_MS = 10 * 60_000;

export type DataJobType = 'import' | 'export';
export type DataJobStatus = 'queued' | 'processing' | 'succeeded' | 'failed';
export type DataJobStage = 'validating' | 'writing' | 'querying' | 'packaging';

/** data_jobs.files JSONB 元素（导出产物分片描述 · 契约见方案 §7.3） */
export interface DataJobFileEntry {
  part: number;
  filename: string;
  size_bytes: number;
  sha256: string;
  download_path: string;
}

export interface DataJobEntity {
  id: string;
  type: DataJobType;
  status: DataJobStatus;
  userId: string;
  familyId: string;
  ledgerId: string;
  /**
   * 任务所属账本名（§7.6 客户端契约字段 · 任务卡「账本名 · 正在导入流水…」）。
   * 仅 JOIN ledgers 的读取路径（listByOwner / findById）填充；
   * INSERT ... RETURNING 路径为 null，由路由用已解析的 ledger 补齐（create 响应）。
   */
  ledgerName: string | null;
  detectId: string | null;
  sourceHash: string | null;
  rulesetVersion: number | null;
  exportFrom: Date | null;
  exportTo: Date | null;
  attempts: number;
  stage: DataJobStage | null;
  stageStartedAt: Date | null;
  runToken: string | null;
  leaseExpiresAt: Date | null;
  retryable: boolean;
  errorCode: string | null;
  errorMessage: string | null;
  nextAttemptAt: Date | null;
  expiresAt: Date | null;
  resultSummary: Record<string, unknown> | null;
  files: DataJobFileEntry[] | null;
  fileExpiresAt: Date | null;
  createdAt: Date;
  startedAt: Date | null;
  finishedAt: Date | null;
}

interface DataJobRow {
  id: string;
  type: string;
  status: string;
  user_id: string;
  family_id: string;
  ledger_id: string;
  /** 仅 JOIN ledgers 的查询返回（其余路径 undefined ⇒ rowToEntity 归 null） */
  ledger_name?: string | null;
  detect_id: string | null;
  source_hash: string | null;
  ruleset_version: number | null;
  export_from: Date | null;
  export_to: Date | null;
  attempts: number;
  stage: string | null;
  stage_started_at: Date | null;
  run_token: string | null;
  lease_expires_at: Date | null;
  retryable: boolean;
  error_code: string | null;
  error_message: string | null;
  next_attempt_at: Date | null;
  expires_at: Date | null;
  result_summary: Record<string, unknown> | null;
  files: DataJobFileEntry[] | null;
  file_expires_at: Date | null;
  created_at: Date;
  started_at: Date | null;
  finished_at: Date | null;
}

/**
 * data_jobs 列清单（单一事实源）：
 *   - SELECT_COLUMNS：裸列名，用于 INSERT ... RETURNING 与无 JOIN 的单表查询；
 *   - SELECT_COLUMNS_WITH_LEDGER：j. 前缀 + ledgers.name，用于面向客户端序列化的读取路径
 *     （JOIN 后 id/name 等列名在两表间有歧义，必须带前缀）。
 */
const DATA_JOB_COLUMNS = [
  'id', 'type', 'status', 'user_id', 'family_id', 'ledger_id',
  'detect_id', 'source_hash', 'ruleset_version',
  'export_from', 'export_to',
  'attempts', 'stage', 'stage_started_at', 'run_token', 'lease_expires_at',
  'retryable', 'error_code', 'error_message', 'next_attempt_at', 'expires_at',
  'result_summary', 'files', 'file_expires_at',
  'created_at', 'started_at', 'finished_at',
] as const;

const SELECT_COLUMNS = DATA_JOB_COLUMNS.join(', ');

// LEFT JOIN 而非 INNER：ledger_id 有 FK（data_jobs 存在则 ledgers 行必在），
// 用 LEFT 保证「取名字」永不改变返回行数语义。
const SELECT_COLUMNS_WITH_LEDGER = `${DATA_JOB_COLUMNS.map((c) => `j.${c}`).join(', ')}, l.name AS ledger_name`;

function rowToEntity(r: DataJobRow): DataJobEntity {
  return {
    id: r.id,
    type: r.type as DataJobType,
    status: r.status as DataJobStatus,
    userId: r.user_id,
    familyId: r.family_id,
    ledgerId: r.ledger_id,
    ledgerName: r.ledger_name ?? null,
    detectId: r.detect_id,
    sourceHash: r.source_hash,
    rulesetVersion: r.ruleset_version,
    exportFrom: r.export_from,
    exportTo: r.export_to,
    attempts: Number(r.attempts),
    stage: r.stage as DataJobStage | null,
    stageStartedAt: r.stage_started_at,
    runToken: r.run_token,
    leaseExpiresAt: r.lease_expires_at,
    retryable: r.retryable,
    errorCode: r.error_code,
    errorMessage: r.error_message,
    nextAttemptAt: r.next_attempt_at,
    expiresAt: r.expires_at,
    resultSummary: r.result_summary,
    files: r.files,
    fileExpiresAt: r.file_expires_at,
    createdAt: r.created_at,
    startedAt: r.started_at,
    finishedAt: r.finished_at,
  };
}

// ==============================================================================
// 创建 / 查询
// ==============================================================================

/**
 * 新建导出任务（queued · 排队租约 10min）。
 * 调用方（路由）负责先做活跃任务判定与账本解析；本函数只负责插入。
 * 生产竞态（两请求同时通过判定）由 uq_data_jobs_active_export_per_user 23505 兜底。
 */
export async function createExportJob(
  input: {
    userId: string;
    familyId: string;
    ledgerId: string;
    exportFrom: Date | null;
    exportTo: Date | null;
  },
  client?: PoolClient,
): Promise<DataJobEntity> {
  const q = client ?? getPool();
  const res = await q.query<DataJobRow>(
    `INSERT INTO data_jobs (
       id, type, status, user_id, family_id, ledger_id,
       export_from, export_to, expires_at
     ) VALUES ($1, 'export', 'queued', $2, $3, $4, $5, $6, now() + ($7 || ' milliseconds')::interval)
     RETURNING ${SELECT_COLUMNS}`,
    [
      newId(),
      input.userId,
      input.familyId,
      input.ledgerId,
      input.exportFrom,
      input.exportTo,
      String(DATA_JOB_QUEUE_LEASE_MS),
    ],
  );
  return rowToEntity(res.rows[0]!);
}

/**
 * 查用户当前活跃导出任务（queued/processing · 不含终态）。
 * create 路径的并发闸口判定（pg-mem 无部分唯一索引，靠它 + 生产索引双保险）。
 */
export async function findActiveExportJobByUser(
  userId: string,
  client?: PoolClient,
): Promise<DataJobEntity | null> {
  const q = client ?? getPool();
  const res = await q.query<DataJobRow>(
    `SELECT ${SELECT_COLUMNS} FROM data_jobs
      WHERE type = 'export' AND user_id = $1 AND status IN ('queued', 'processing')
      LIMIT 1`,
    [userId],
  );
  return res.rows[0] ? rowToEntity(res.rows[0]) : null;
}

/** 单任务读取（带 ledger_name · 路由详情/下载与 worker 重读共用） */
export async function findById(id: string, client?: PoolClient): Promise<DataJobEntity | null> {
  const q = client ?? getPool();
  const res = await q.query<DataJobRow>(
    `SELECT ${SELECT_COLUMNS_WITH_LEDGER}
       FROM data_jobs j
       LEFT JOIN ledgers l ON l.id = j.ledger_id
      WHERE j.id = $1 LIMIT 1`,
    [id],
  );
  return res.rows[0] ? rowToEntity(res.rows[0]) : null;
}

// ─── 导入（二期）───────────────────────────────────────────────────────────

/**
 * 新建导入任务（queued · 排队租约 10min）。
 * 调用方（路由）负责：会话锁定/有效期校验/并发闸口/频控；本函数只负责插入。
 * 须在 importDetectRepo.consumeSession 的同一事务内调用（§7.4 commit 阶段原子消费）。
 * 生产竞态由 uq_data_jobs_active_import_per_family / detect_id 列级 UNIQUE 23505 兜底。
 */
export async function createImportJob(
  input: {
    userId: string;
    familyId: string;
    ledgerId: string;
    detectId: string;
    /** = 会话 file_sha256（审计/去重链） */
    sourceHash: string;
    /** 解析规则集版本（importCsv.IMPORT_RULESET_VERSION） */
    rulesetVersion: number;
    idempotencyKey?: string | null;
  },
  client: PoolClient,
): Promise<DataJobEntity> {
  const res = await client.query<DataJobRow>(
    `INSERT INTO data_jobs (
       id, type, status, user_id, family_id, ledger_id,
       detect_id, source_hash, ruleset_version, expires_at, idempotency_key
     ) VALUES ($1, 'import', 'queued', $2, $3, $4, $5, $6, $7,
               now() + ($8 || ' milliseconds')::interval, $9)
     RETURNING ${SELECT_COLUMNS}`,
    [
      newId(),
      input.userId,
      input.familyId,
      input.ledgerId,
      input.detectId,
      input.sourceHash,
      input.rulesetVersion,
      String(DATA_JOB_QUEUE_LEASE_MS),
      input.idempotencyKey ?? null,
    ],
  );
  return rowToEntity(res.rows[0]!);
}

/** 查家庭当前活跃导入任务（§4.4 闸口 · pg-mem 无部分唯一索引，靠它 + 生产索引双保险） */
export async function findActiveImportJobByFamily(
  familyId: string,
  client?: PoolClient,
): Promise<DataJobEntity | null> {
  const q = client ?? getPool();
  const res = await q.query<DataJobRow>(
    `SELECT ${SELECT_COLUMNS} FROM data_jobs
      WHERE type = 'import' AND family_id = $1 AND status IN ('queued', 'processing')
      LIMIT 1`,
    [familyId],
  );
  return res.rows[0] ? rowToEntity(res.rows[0]) : null;
}

/**
 * 导入任务频控计数（§9.1：单用户 5 分钟最多创建 3 个导入任务）。
 * 按 data_jobs 计数（元数据保留 30 天，不被会话清理干扰 · §9.1 频控计数器要求）。
 */
export async function countRecentImportJobsByUser(
  userId: string,
  windowSeconds: number,
  client?: PoolClient,
): Promise<number> {
  const q = client ?? getPool();
  const res = await q.query<{ n: string | number }>(
    `SELECT COUNT(*) AS n FROM data_jobs
      WHERE type = 'import' AND user_id = $1
        AND created_at > now() - ($2 || ' seconds')::interval`,
    [userId, String(windowSeconds)],
  );
  return Number(res.rows[0]?.n ?? 0);
}

/**
 * 导入成功终态写回（§7.5 · 在导入大事务内调用 · 条件更新 rowCount 必须为 1）。
 * 返回 false 时调用方必须抛错回滚整个事务（"数据+成功状态"原子性的一部分）。
 * result_summary 契约（§7.6）：{ imported, skipped, error_count, warning_count }。
 */
export async function markImportSucceededInTx(
  id: string,
  runToken: string,
  summary: { imported: number; skipped: number; errorCount: number; warningCount: number },
  client: PoolClient,
): Promise<boolean> {
  const res = await client.query(
    `UPDATE data_jobs
        SET status = 'succeeded',
            stage = NULL,
            stage_started_at = NULL,
            result_summary = $3::jsonb,
            finished_at = now(),
            run_token = NULL,
            lease_expires_at = NULL,
            retryable = false,
            error_code = NULL,
            error_message = NULL
      WHERE id = $1 AND status = 'processing' AND run_token = $2`,
    [
      id,
      runToken,
      JSON.stringify({
        imported: summary.imported,
        skipped: summary.skipped,
        error_count: summary.errorCount,
        warning_count: summary.warningCount,
      }),
    ],
  );
  return (res.rowCount ?? 0) > 0;
}

/**
 * 导入排队幽灵终态化（detect / commit 两路径回收）：该家庭 queued 且排队租约已过期。
 * 与 failExpiredQueuedJob 同构（导出的回收粒度是 per-user，导入是 per-family · §4.4）。
 * detect 路径同样回收：worker 宕机留下的幽灵不应挡住 detect——否则会话建不出来、
 * commit 也走不到（commit 需先 detect），该 family 会死锁至 worker 恢复。
 */
export async function failExpiredQueuedImportJob(
  familyId: string,
  client?: PoolClient,
): Promise<string | null> {
  const q = client ?? getPool();
  const res = await q.query<{ id: string }>(
    `UPDATE data_jobs
        SET status = 'failed',
            retryable = true,
            error_code = 'QUEUE_LEASE_EXPIRED',
            error_message = 'queued lease expired before claim',
            finished_at = now(),
            expires_at = NULL
      WHERE type = 'import' AND family_id = $1 AND status = 'queued'
        AND expires_at IS NOT NULL AND expires_at <= now()
      RETURNING id`,
    [familyId],
  );
  return res.rows[0]?.id ?? null;
}

/** 任务中心列表：用户最近任务（创建时间倒序 · limit 由路由钳制 ≤50 · 带 ledger_name） */
export async function listByOwner(
  userId: string,
  limit: number,
  client?: PoolClient,
): Promise<DataJobEntity[]> {
  const q = client ?? getPool();
  const res = await q.query<DataJobRow>(
    `SELECT ${SELECT_COLUMNS_WITH_LEDGER}
       FROM data_jobs j
       LEFT JOIN ledgers l ON l.id = j.ledger_id
      WHERE j.user_id = $1
      ORDER BY j.created_at DESC, j.id DESC
      LIMIT $2`,
    [userId, limit],
  );
  return res.rows.map(rowToEntity);
}

// ==============================================================================
// worker · claim / 租约 / 终态写回
// ==============================================================================

/**
 * 领取一批到期的 queued 任务（FOR UPDATE SKIP LOCKED · 调用方须在事务内）。
 * 每条：attempts+1、status=processing、stage=querying、run_token 新签发、
 * 90s 执行租约；排队租约 expires_at 清零（执行期由 lease_expires_at 接管）。
 *
 * pg-mem 兼容：NODE_ENV === 'test' 时省略 FOR UPDATE SKIP LOCKED（同 recurringRepo 既有做法）。
 */
export async function claimQueuedJobs(
  now: Date,
  limit: number,
  client: PoolClient,
): Promise<DataJobEntity[]> {
  const isTest = process.env.NODE_ENV === 'test';
  const lockClause = isTest ? '' : 'FOR UPDATE SKIP LOCKED';
  const candidates = await client.query<{ id: string }>(
    `SELECT id FROM data_jobs
      WHERE status = 'queued'
        AND (next_attempt_at IS NULL OR next_attempt_at <= $1)
      ORDER BY created_at ASC
      LIMIT $2
      ${lockClause}`,
    [now, limit],
  );
  const claimed: DataJobEntity[] = [];
  for (const row of candidates.rows) {
    // 阶段按类型分流（§7.2 v1.0）：导出 claim 即 querying；导入唯一可观测阶段是 validating
    //（导入是单大事务，writing 阶段对轮询连接不可见，已从 import 阶段集移除）
    // CAST 不可省：CASE 全字面量分支被 PG 解析为 text，赋枚举列须显式 cast，
    // 否则真 PG 报 42804（pg-mem 不校验枚举赋值，单测覆盖不到 · 2026-09-08 生产事故）
    const updated = await client.query<DataJobRow>(
      `UPDATE data_jobs
          SET status = 'processing',
              stage = CAST(CASE type WHEN 'import' THEN 'validating' ELSE 'querying' END AS data_job_stage),
              stage_started_at = now(),
              attempts = attempts + 1,
              run_token = $2,
              lease_expires_at = now() + ($3 || ' milliseconds')::interval,
              started_at = COALESCE(started_at, now()),
              expires_at = NULL,
              retryable = false,
              error_code = NULL,
              error_message = NULL,
              next_attempt_at = NULL
        WHERE id = $1 AND status = 'queued'
        RETURNING ${SELECT_COLUMNS}`,
      [row.id, newId(), String(DATA_JOB_LEASE_MS)],
    );
    if (updated.rows[0]) claimed.push(rowToEntity(updated.rows[0]));
  }
  return claimed;
}

/** 阶段推进（导出：querying → packaging · 只在持有 run_token 时生效） */
export async function updateStage(
  id: string,
  runToken: string,
  stage: DataJobStage,
  client?: PoolClient,
): Promise<void> {
  const q = client ?? getPool();
  await q.query(
    `UPDATE data_jobs
        SET stage = $3, stage_started_at = now()
      WHERE id = $1 AND status = 'processing' AND run_token = $2`,
    [id, runToken, stage],
  );
}

/** 执行租约续期（长任务执行期间周期性调用） */
export async function refreshLease(
  id: string,
  runToken: string,
  client?: PoolClient,
): Promise<void> {
  const q = client ?? getPool();
  await q.query(
    `UPDATE data_jobs
        SET lease_expires_at = now() + ($3 || ' milliseconds')::interval
      WHERE id = $1 AND status = 'processing' AND run_token = $2`,
    [id, runToken, String(DATA_JOB_LEASE_MS)],
  );
}

export interface ExportSuccessResult {
  entryCount: number;
  partCount: number;
  files: DataJobFileEntry[];
  /** 产物所在月目录（<exportRoot>/<storageMonth>/ · 下载端点据此定位磁盘文件） */
  storageMonth: string;
  /** 产物有效期时长（毫秒 · 由 DB now() 起算，与 finished_at 同一时钟源） */
  fileTtlMs: number;
  /**
   * 用户所选原始日期（YYYY-MM-DD · 全量导出为 null）。
   * export_from/to 落库的是半开区间端点，客户端「重新生成」按原区间重发需要所选日期本身
   * （§6.2 + migration 0021 result_summary 注释的 source_date_from/to）。
   */
  sourceDateFrom?: string | null;
  sourceDateTo?: string | null;
}

/**
 * 成功终态写回（run_token 条件更新）。
 * 返回 false = run_token 已不属于本执行体（租约被抢 / 已被僵尸回收）⇒ 调用方放弃写回。
 * result_summary 携带 storage_month：files[] 契约（5 字段）不含磁盘位置，
 * 下载端点从 result_summary 取月目录拼磁盘路径（对客户端无害的附加字段）。
 */
export async function markSucceeded(
  id: string,
  runToken: string,
  result: ExportSuccessResult,
  client?: PoolClient,
): Promise<boolean> {
  const q = client ?? getPool();
  const res = await q.query(
    `UPDATE data_jobs
        SET status = 'succeeded',
            stage = NULL,
            stage_started_at = NULL,
            result_summary = $3::jsonb,
            files = $4::jsonb,
            file_expires_at = now() + ($5 || ' milliseconds')::interval,
            finished_at = now(),
            run_token = NULL,
            lease_expires_at = NULL,
            retryable = false,
            error_code = NULL,
            error_message = NULL
      WHERE id = $1 AND status = 'processing' AND run_token = $2`,
    [
      id,
      runToken,
      JSON.stringify({
        entry_count: result.entryCount,
        part_count: result.partCount,
        storage_month: result.storageMonth,
        source_date_from: result.sourceDateFrom ?? null,
        source_date_to: result.sourceDateTo ?? null,
      }),
      JSON.stringify(result.files),
      String(result.fileTtlMs),
    ],
  );
  return (res.rowCount ?? 0) > 0;
}

/**
 * 终态失败写回（run_token 条件更新 · 不可重试）。
 * 返回 false = run_token 已不属于本执行体 ⇒ 调用方放弃写回。
 * 刻意保留 stage/stage_started_at：契约 error: { code, message, stage } 的
 * stage 取失败时所在阶段（data-import-export v1.0 §7.3）。
 */
export async function markFailedTerminal(
  id: string,
  runToken: string,
  failure: { errorCode: string; errorMessage: string },
  client?: PoolClient,
): Promise<boolean> {
  const q = client ?? getPool();
  const res = await q.query(
    `UPDATE data_jobs
        SET status = 'failed',
            retryable = false,
            error_code = $3,
            error_message = $4,
            finished_at = now(),
            run_token = NULL,
            lease_expires_at = NULL
      WHERE id = $1 AND status = 'processing' AND run_token = $2`,
    [id, runToken, failure.errorCode, failure.errorMessage],
  );
  return (res.rowCount ?? 0) > 0;
}

/**
 * 瞬时失败回队（run_token 条件更新 · 等待下次 claim）。
 * attempts 已在 claim 时递增；此处只挂上下次尝试时间。
 */
export async function markRetryQueued(
  id: string,
  runToken: string,
  failure: { errorCode: string; errorMessage: string; nextAttemptAt: Date },
  client?: PoolClient,
): Promise<boolean> {
  const q = client ?? getPool();
  const res = await q.query(
    `UPDATE data_jobs
        SET status = 'queued',
            stage = NULL,
            stage_started_at = NULL,
            retryable = true,
            error_code = $3,
            error_message = $4,
            next_attempt_at = $5,
            run_token = NULL,
            lease_expires_at = NULL
      WHERE id = $1 AND status = 'processing' AND run_token = $2`,
    [id, runToken, failure.errorCode, failure.errorMessage, failure.nextAttemptAt],
  );
  return (res.rowCount ?? 0) > 0;
}

// ==============================================================================
// 僵尸回收 / 幽灵回收
// ==============================================================================

/** 捞取租约过期的 processing 任务（僵尸 · 每 tick 巡检） */
export async function findZombieJobs(
  now: Date,
  limit: number,
  client?: PoolClient,
): Promise<DataJobEntity[]> {
  const q = client ?? getPool();
  const res = await q.query<DataJobRow>(
    `SELECT ${SELECT_COLUMNS} FROM data_jobs
      WHERE status = 'processing'
        AND lease_expires_at IS NOT NULL
        AND lease_expires_at < $1
      ORDER BY lease_expires_at ASC
      LIMIT $2`,
    [now, limit],
  );
  return res.rows.map(rowToEntity);
}

/**
 * 排队幽灵终态化（create 路径回收）：queued 且排队租约已过期。
 * 返回被终态化的任务 id（无则 null）。
 * 说明：生产唯一索引只保证"至多一个活跃"，queued 幽灵会挡住新任务；
 *   此处把它终态化（lease_expires_at 是执行租约，对 queued 无意义，
 *   expires_at 排队租约到期即视为 worker 长期未领取的幽灵）。
 */
export async function failExpiredQueuedJob(
  userId: string,
  client?: PoolClient,
): Promise<string | null> {
  const q = client ?? getPool();
  const res = await q.query<{ id: string }>(
    `UPDATE data_jobs
        SET status = 'failed',
            retryable = true,
            error_code = 'QUEUE_LEASE_EXPIRED',
            error_message = 'queued lease expired before claim',
            finished_at = now(),
            expires_at = NULL
      WHERE type = 'export' AND user_id = $1 AND status = 'queued'
        AND expires_at IS NOT NULL AND expires_at <= now()
      RETURNING id`,
    [userId],
  );
  return res.rows[0]?.id ?? null;
}
