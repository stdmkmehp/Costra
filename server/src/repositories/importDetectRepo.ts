/**
 * Costra · Server · import_detect_sessions DAO（导入二期）
 *
 * 事实源：docs/design/data-import-export-client-analysis.md v1.0 §4.2/§4.5/§7.3/§7.4
 * 迁移：server/db/migrations/0021_data_jobs.sql（B 段）
 *
 * 生命周期（§7.4）：
 *   detecting → ready（expires_at=+15min / report_expires_at=+24h）→ consumed（commit 同事务）
 *             → failed（文件级错误 / 僵尸回收）
 *   - ready 过期是 expires_at 派生态，不进状态机；
 *   - 僵尸 detecting（>10min）由应用侧清理转 failed 释放并发槽（部分唯一索引谓词不能含 now()）；
 *   - 会话行与 data_jobs 元数据同寿 30 天（FK ON DELETE CASCADE 在 data_jobs.detect_id 上）；
 *     无 job 的 ready/failed 行在 report 过期后整行删除；
 *   - 隐私口径：任务终态后 report_preview 置 NULL（含昵称/备注原文片段 · §7.4 v1.0 P2）。
 *
 * pg-mem 适配：不建部分唯一索引（uq_detect_sessions_active_per_user 仅生产）；
 * "同用户单并发检测"在 pg-mem 由 create 前先 SELECT 判定覆盖，生产竞态由索引 23505 兜底。
 */

import { getPool } from '../db/pool.js';
import { newId } from '../id/idGen.js';

export type ImportDetectStatus = 'detecting' | 'ready' | 'consumed' | 'failed';
/** DB 列口径：自产文件存 'apostrophe-v2'，非自产存 NULL（API 层的 'none' 是序列化派生值） */
export type ImportFormulaGuard = 'apostrophe-v2';

/** DetectReport 预览条目（§4.2 · value_preview ≤120 code points） */
export interface DetectPreviewItem {
  row: number;
  field: string;
  code: string;
  value_preview: string;
}

/** report_preview JSONB 形状（DetectReport 响应直接物化） */
export interface DetectReportPreview {
  errors: DetectPreviewItem[];
  warnings: DetectPreviewItem[];
  unmatched_members: Array<{ nickname: string; row_count: number }>;
  errors_truncated: boolean;
  warnings_truncated: boolean;
  unmatched_members_truncated: boolean;
  /** SUBCATEGORY_FALLBACK 警告聚合行数（§4.6 二次确认弹窗「系统改分类」数据源 · 不受预览截断影响） */
  subcategory_fallback_count: number;
}

export interface ImportDetectSessionEntity {
  id: string;
  userId: string;
  familyId: string;
  ledgerId: string;
  status: ImportDetectStatus;
  fileName: string | null;
  fileSize: number | null;
  fileSha256: string | null;
  isCostraExport: boolean;
  formulaGuard: ImportFormulaGuard | null;
  memberMapping: Record<string, string> | null;
  /** 规范化行产物 COS object key（staging/<yyyy-mm>/<id>.rows.ndjson.gz · 非本地路径） */
  artifactPath: string | null;
  artifactSha256: string | null;
  /** 报告产物 COS object key（reports/<yyyy-mm>/<id>.report.csv · 非本地路径） */
  reportPath: string | null;
  totalRows: number | null;
  importableRows: number | null;
  errorCount: number | null;
  warningCount: number | null;
  reportPreview: DetectReportPreview | null;
  jobId: string | null;
  expiresAt: Date | null;
  reportExpiresAt: Date | null;
  consumedAt: Date | null;
  createdAt: Date;
}

interface ImportDetectSessionRow {
  id: string;
  user_id: string;
  family_id: string;
  ledger_id: string;
  status: string;
  file_name: string | null;
  file_size: string | number | null; // BIGINT：真 PG 返 string · pg-mem 返 number
  file_sha256: string | null;
  is_costra_export: boolean;
  formula_guard: string | null;
  member_mapping: Record<string, string> | null;
  artifact_path: string | null;
  artifact_sha256: string | null;
  report_path: string | null;
  total_rows: number | null;
  importable_rows: number | null;
  error_count: number | null;
  warning_count: number | null;
  report_preview: DetectReportPreview | null;
  job_id: string | null;
  expires_at: Date | null;
  report_expires_at: Date | null;
  consumed_at: Date | null;
  created_at: Date;
}

const SELECT_COLUMNS = `
  id, user_id, family_id, ledger_id, status,
  file_name, file_size, file_sha256, is_costra_export, formula_guard, member_mapping,
  artifact_path, artifact_sha256, report_path,
  total_rows, importable_rows, error_count, warning_count, report_preview,
  job_id, expires_at, report_expires_at, consumed_at, created_at
`;

type Runner = {
  query: (sql: string, params?: unknown[]) => Promise<{ rows: ImportDetectSessionRow[]; rowCount?: number | null }>;
};

function exec(): Runner {
  return getPool() as unknown as Runner;
}

function rowToEntity(r: ImportDetectSessionRow): ImportDetectSessionEntity {
  return {
    id: r.id,
    userId: r.user_id,
    familyId: r.family_id,
    ledgerId: r.ledger_id,
    status: r.status as ImportDetectStatus,
    fileName: r.file_name,
    fileSize: r.file_size == null ? null : Number(r.file_size),
    fileSha256: r.file_sha256,
    isCostraExport: r.is_costra_export,
    formulaGuard: (r.formula_guard as ImportFormulaGuard | null) ?? null,
    memberMapping: r.member_mapping ?? null,
    artifactPath: r.artifact_path,
    artifactSha256: r.artifact_sha256,
    reportPath: r.report_path,
    totalRows: r.total_rows,
    importableRows: r.importable_rows,
    errorCount: r.error_count,
    warningCount: r.warning_count,
    reportPreview: r.report_preview ?? null,
    jobId: r.job_id,
    expiresAt: r.expires_at,
    reportExpiresAt: r.report_expires_at,
    consumedAt: r.consumed_at,
    createdAt: r.created_at,
  };
}

/** ready 态有效期（§4.5 d） */
export const READY_TTL_SECONDS = 15 * 60;
/** 报告文件有效期（§4.5 f · 与 commit 有效期解耦） */
export const REPORT_TTL_SECONDS = 24 * 3600;
/** 僵尸 detecting 回收阈值（§4.4/§7.4 · 解析正常为秒级，10min 必为僵尸） */
export const ZOMBIE_DETECTING_MINUTES = 10;

/**
 * 创建 detecting 会话（占住并发槽 · §4.4）。
 * 调用方须先查 findActiveDetectingByUser；生产并发竞态由
 * uq_detect_sessions_active_per_user 的 23505 兜底（路由映射 DETECT_IN_PROGRESS）。
 */
export async function insertDetectingSession(
  input: {
    userId: string;
    familyId: string;
    ledgerId: string;
    fileName: string | null;
    fileSize: number;
    fileSha256: string;
  },
  client?: Runner,
): Promise<ImportDetectSessionEntity> {
  const id = newId();
  const runner = client ?? exec();
  const res = await runner.query(
    `INSERT INTO import_detect_sessions (id, user_id, family_id, ledger_id, status, file_name, file_size, file_sha256)
     VALUES ($1, $2, $3, $4, 'detecting', $5, $6, $7)
     RETURNING ${SELECT_COLUMNS}`,
    [id, input.userId, input.familyId, input.ledgerId, input.fileName, input.fileSize, input.fileSha256],
  );
  if (!res.rows[0]) throw new Error('[importDetectRepo] INSERT returned no row');
  return rowToEntity(res.rows[0]);
}

export async function findById(id: string, client?: Runner): Promise<ImportDetectSessionEntity | null> {
  const runner = client ?? exec();
  const res = await runner.query(`SELECT ${SELECT_COLUMNS} FROM import_detect_sessions WHERE id = $1 LIMIT 1`, [id]);
  return res.rows[0] ? rowToEntity(res.rows[0]) : null;
}

/** commit 事务内锁定会话行（§7.4 commit 阶段步骤 1 · FOR UPDATE） */
export async function lockById(id: string, client: Runner): Promise<ImportDetectSessionEntity | null> {
  const res = await client.query(
    `SELECT ${SELECT_COLUMNS} FROM import_detect_sessions WHERE id = $1 LIMIT 1 FOR UPDATE`,
    [id],
  );
  return res.rows[0] ? rowToEntity(res.rows[0]) : null;
}

/** 同用户进行中的检测（§4.4 闸口 · 含僵尸行——由调用方按 created_at 自行释放） */
export async function findActiveDetectingByUser(
  userId: string,
  client?: Runner,
): Promise<ImportDetectSessionEntity | null> {
  const runner = client ?? exec();
  const res = await runner.query(
    `SELECT ${SELECT_COLUMNS} FROM import_detect_sessions
      WHERE user_id = $1 AND status = 'detecting'
      ORDER BY created_at DESC LIMIT 1`,
    [userId],
  );
  return res.rows[0] ? rowToEntity(res.rows[0]) : null;
}

/** detect 幂等（§4.2 v0.8）：同 (user, ledger, sha256) 且仍在有效期内的 ready 会话 */
export async function findReadyBySha(
  userId: string,
  ledgerId: string,
  fileSha256: string,
  client?: Runner,
): Promise<ImportDetectSessionEntity | null> {
  const runner = client ?? exec();
  const res = await runner.query(
    `SELECT ${SELECT_COLUMNS} FROM import_detect_sessions
      WHERE user_id = $1 AND ledger_id = $2 AND file_sha256 = $3
        AND status = 'ready' AND expires_at > now()
      ORDER BY created_at DESC LIMIT 1`,
    [userId, ledgerId, fileSha256],
  );
  return res.rows[0] ? rowToEntity(res.rows[0]) : null;
}

/** 解析完成 → ready：写汇总 + 预览 + 产物路径 + 双有效期（§7.4 步骤 6） */
export async function markReady(
  id: string,
  input: {
    isCostraExport: boolean;
    /** 自产文件 'apostrophe-v2' · 非自产 NULL */
    formulaGuard: ImportFormulaGuard | null;
    /** 规范化行产物 COS object key */
    artifactPath: string;
    artifactSha256: string;
    /** 报告产物 COS object key（无问题为 null） */
    reportPath: string | null;
    totalRows: number;
    importableRows: number;
    errorCount: number;
    warningCount: number;
    reportPreview: DetectReportPreview;
  },
  client?: Runner,
): Promise<void> {
  const runner = client ?? exec();
  await runner.query(
    `UPDATE import_detect_sessions
        SET status = 'ready',
            is_costra_export = $2,
            formula_guard = $3,
            artifact_path = $4,
            artifact_sha256 = $5,
            report_path = $6,
            total_rows = $7,
            importable_rows = $8,
            error_count = $9,
            warning_count = $10,
            report_preview = $11::jsonb,
            expires_at = now() + interval '${READY_TTL_SECONDS} seconds',
            report_expires_at = now() + interval '${REPORT_TTL_SECONDS} seconds'
      WHERE id = $1 AND status = 'detecting'`,
    [
      id,
      input.isCostraExport,
      input.formulaGuard,
      input.artifactPath,
      input.artifactSha256,
      input.reportPath,
      input.totalRows,
      input.importableRows,
      input.errorCount,
      input.warningCount,
      JSON.stringify(input.reportPreview),
    ],
  );
}

/** 文件级错误 / 僵尸回收 → failed（终态） */
export async function markFailed(id: string, client?: Runner): Promise<void> {
  const runner = client ?? exec();
  await runner.query(
    `UPDATE import_detect_sessions SET status = 'failed' WHERE id = $1 AND status IN ('detecting', 'ready')`,
    [id],
  );
}

/** detect 幂等命中顺延有效期（§4.2 v1.0 · 命中即重置 expires_at，防"看报告即过期"） */
export async function touchReadyExpiry(id: string, client?: Runner): Promise<ImportDetectSessionEntity | null> {
  const runner = client ?? exec();
  const res = await runner.query(
    `UPDATE import_detect_sessions
        SET expires_at = now() + interval '${READY_TTL_SECONDS} seconds'
      WHERE id = $1 AND status = 'ready'
      RETURNING ${SELECT_COLUMNS}`,
    [id],
  );
  return res.rows[0] ? rowToEntity(res.rows[0]) : null;
}

/**
 * commit 原子消费（§7.4 commit 阶段步骤 5）：会话置 consumed + 回填 job_id + 写 member_mapping。
 * 须在创建 data_jobs 的同一事务内调用。
 */
export async function consumeSession(
  id: string,
  input: { jobId: string; memberMapping: Record<string, string> | null },
  client: Runner,
): Promise<void> {
  await client.query(
    `UPDATE import_detect_sessions
        SET status = 'consumed', consumed_at = now(), job_id = $2, member_mapping = $3::jsonb
      WHERE id = $1`,
    [id, input.jobId, input.memberMapping === null ? null : JSON.stringify(input.memberMapping)],
  );
}

/** 任务终态后清除 report_preview（隐私口径 · §7.4 v1.0 P2） */
export async function clearReportPreview(id: string, client?: Runner): Promise<void> {
  const runner = client ?? exec();
  await runner.query(`UPDATE import_detect_sessions SET report_preview = NULL WHERE id = $1`, [id]);
}

// ─────────────────────────────────────────────────────────────────────────────
// 周期清理（§7.4 · 应用侧每分钟 + 启动补偿；行删除走 maintenance cron）
// ─────────────────────────────────────────────────────────────────────────────

/** 僵尸 detecting → failed，返回受影响行（供调用方删可能存在的半成品 COS 对象） */
export async function reapZombieDetecting(client?: Runner): Promise<ImportDetectSessionEntity[]> {
  const runner = client ?? exec();
  const res = await runner.query(
    `UPDATE import_detect_sessions SET status = 'failed'
      WHERE status = 'detecting' AND created_at < now() - interval '${ZOMBIE_DETECTING_MINUTES} minutes'
      RETURNING ${SELECT_COLUMNS}`,
  );
  return res.rows.map(rowToEntity);
}

/** ready 过期 → 待删行产物（15min 行产物寿命 · §7.4）；返回行供删 COS 对象后调 clearArtifactPath */
export async function listReadyExpiredWithArtifact(client?: Runner): Promise<ImportDetectSessionEntity[]> {
  const runner = client ?? exec();
  const res = await runner.query(
    `SELECT ${SELECT_COLUMNS} FROM import_detect_sessions
      WHERE status = 'ready' AND expires_at < now() AND artifact_path IS NOT NULL`,
  );
  return res.rows.map(rowToEntity);
}

/** report 过期（24h）→ 待删报告对象；调用方删 COS 对象后调 clearReportPath / deleteSessionRow */
export async function listReportExpired(client?: Runner): Promise<ImportDetectSessionEntity[]> {
  const runner = client ?? exec();
  const res = await runner.query(
    `SELECT ${SELECT_COLUMNS} FROM import_detect_sessions
      WHERE report_path IS NOT NULL AND report_expires_at < now()`,
  );
  return res.rows.map(rowToEntity);
}

export async function clearArtifactPath(id: string, client?: Runner): Promise<void> {
  const runner = client ?? exec();
  await runner.query(`UPDATE import_detect_sessions SET artifact_path = NULL WHERE id = $1`, [id]);
}

export async function clearReportPath(id: string, client?: Runner): Promise<void> {
  const runner = client ?? exec();
  await runner.query(
    `UPDATE import_detect_sessions SET report_path = NULL WHERE id = $1`,
    [id],
  );
}

/**
 * 整行删除（仅允许无关联 job 的 ready/failed 行 · §7.4"会话行最终删除条件"）。
 * consumed 行与 data_jobs 同寿 30 天（FK 在 data_jobs.detect_id 上），由 maintenance cron 收尾。
 */
export async function deleteSessionRow(id: string, client?: Runner): Promise<void> {
  const runner = client ?? exec();
  await runner.query(
    `DELETE FROM import_detect_sessions WHERE id = $1 AND status IN ('ready', 'failed') AND job_id IS NULL`,
    [id],
  );
}
