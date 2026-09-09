/**
 * Costra · Server · 导入执行服务（data-import-export v1.0 二期）
 *
 * 事实源：docs/design/data-import-export-client-analysis.md v1.0 §4.2/§4.3/§7.4/§7.5/§9.4
 *
 * 三块职责：
 *   1. 检测产物 IO：规范化行（NDJSON gzip）与问题报告 CSV 落 /var/costra/import-staging/<yyyy-mm>/
 *      （.tmp + rename 原子写 · 0600 · 原始 CSV 全程不落盘 · §7.4）；
 *   2. worker 执行（runEntryImport）：sync-hold 设置（独立短事务 · H1）→ 大事务
 *      （复核 FOR UPDATE → 批量 INSERT → releaseHoldAndApplyDelta 同语句释放 hold + 余额（H2）
 *      → job=succeeded 条件更新 rowCount=1）→ 提交后删行产物（report 留 24h）；
 *   3. 检测会话周期清理（cleanupDetectSessions）：僵尸 detecting 转 failed、ready 过期删行产物、
 *      report 过期删文件且无 job 的行整行删除（§7.4 生命周期）。
 *
 * 失败语义（§7.5 重试分类）：
 *   - ImportContextInvalidError（操作者/映射成员退出 · 分类软删 · 账本删除）→ 终态 CONTEXT_INVALIDATED
 *   - ImportArtifactError（产物缺失/SHA 不匹配 · R16）→ 终态 ARTIFACT_MISSING
 *   - ImportClientRefConflictError（23505 uq_entries_ledger_client_ref）→ 调度层重读 job.status
 *     分流：succeeded ⇒ 已由另一次执行完成（正常结束 · R38）；否则 TRANSIENT_DB 重试
 *   - ImportSuccessWriteBackRace（成功终态 rowCount≠1）→ 回滚整个事务（§7.5 v0.9 强制项）
 *
 * 隐私口径（§7.4/§9.4）：日志不记行明文；任务终态后 report_preview 置 NULL；
 * 导入成功即删规范化行产物，报告 CSV 保留至 report_expires_at（24h）。
 */

import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { unlink } from 'node:fs/promises';
import { join } from 'node:path';
import { gunzipSync, gzipSync } from 'node:zlib';
import { DateTime } from 'luxon';
import type { PoolClient } from 'pg';
import { getPool } from '../db/pool.js';
import type { ServiceLogger } from '../logger.js';
import * as dataJobRepo from '../repositories/dataJobRepo.js';
import type { DataJobEntity } from '../repositories/dataJobRepo.js';
import * as familyMemberRepo from '../repositories/familyMemberRepo.js';
import * as importDetectRepo from '../repositories/importDetectRepo.js';
import type {
  DetectReportPreview,
  ImportDetectSessionEntity,
} from '../repositories/importDetectRepo.js';
import * as ledgerRepo from '../repositories/ledgerRepo.js';
import type { CategoryEntity } from '../repositories/categoryRepo.js';
import { CSV_BOM, CSV_CRLF, escapeCsvField, formatCsvRow } from '../utils/csv.js';
import {
  PREVIEW_LIMIT,
  analyzeImportCsv,
  type ImportAnalysis,
  type ImportIssue,
  type NormalizedImportRow,
} from './importCsv.js';

// ─────────────────────────────────────────────────────────────────────────────
// 错误类型（调度层按类分流 · §7.5 重试分类表）
// ─────────────────────────────────────────────────────────────────────────────

/** detect 上下文失效（成员退出 / 分类软删 / 失去权限 / 账本删除）→ 终态不可重试 */
export class ImportContextInvalidError extends Error {}
/** 检测产物缺失或 SHA 不匹配（R16）→ 终态不可重试 */
export class ImportArtifactError extends Error {}
/** 文件级致命错误（编码/类型/缺列/重复列/禁止列/超行数/CSV 非法）→ 会话转 failed，路由映射 400 */
export class ImportFileInvalidError extends Error {}
/** uq_entries_ledger_client_ref 冲突（重试幂等的预期结局 · §7.5 R38）→ 调度层重读 status 分流 */
export class ImportClientRefConflictError extends Error {}
/** 导入成功终态的条件更新 rowCount≠1（run_token 已让位）→ 必须回滚整个事务 */
export class ImportSuccessWriteBackRace extends Error {}

// ─────────────────────────────────────────────────────────────────────────────
// staging 目录（测试可替换）
// ─────────────────────────────────────────────────────────────────────────────

let stagingRootOverride: string | null = null;

export function getImportStagingRoot(): string {
  return stagingRootOverride ?? process.env['IMPORT_STAGING_DIR'] ?? '/var/costra/import-staging';
}

/** 测试专用：替换 staging 根目录（配合 __resetImportStagingRootForTests 还原） */
export function setImportStagingRootForTests(root: string): void {
  stagingRootOverride = root;
}

export function __resetImportStagingRootForTests(): void {
  stagingRootOverride = null;
}

// ─────────────────────────────────────────────────────────────────────────────
// 产物 IO（§7.4 · .tmp + rename 原子写）
// ─────────────────────────────────────────────────────────────────────────────

/** 规范化行产物字段（§7.4 步骤 4 · NDJSON 每行一个 JSON） */
interface ArtifactRowWire {
  row_no: number;
  physical_line: number;
  entry_id: string;
  client_ref_id: string;
  occurred_at: string; // UTC ISO
  type: 'income' | 'expense' | 'transfer';
  amount_cents: number;
  category_id: string;
  created_by: string | null; // null = 待 commit 映射的自产未匹配成员行
  member_name: string | null;
  shared_type: 'shared' | 'personal' | null;
  note: string | null;
}

export interface DetectArtifactsResult {
  artifactPath: string;
  artifactSha256: string;
  reportPath: string | null;
  /** 产物所在月目录名（yyyy-MM · Asia/Shanghai · 磁盘定位用） */
  storageMonth: string;
}

function toArtifactWire(r: NormalizedImportRow): ArtifactRowWire {
  return {
    row_no: r.rowNo,
    physical_line: r.physicalLine,
    entry_id: r.entryId,
    client_ref_id: r.clientRefId,
    occurred_at: r.occurredAt.toISOString(),
    type: r.type,
    amount_cents: r.amountCents,
    category_id: r.categoryId,
    created_by: r.createdBy,
    member_name: r.memberName,
    shared_type: r.sharedType,
    note: r.note,
  };
}

/** 问题报告 CSV 表头（§4.2 · 逻辑序号 + 起始物理行号便于 Excel 定位） */
const REPORT_HEADER = ['逻辑序号', '物理行号', '层级', '字段', '错误码', '值预览', '错误信息'] as const;

function buildReportCsv(errors: readonly ImportIssue[], warnings: readonly ImportIssue[]): string {
  const lines: string[] = [REPORT_HEADER.map((h) => escapeCsvField(h)).join(',')];
  const pushIssues = (issues: readonly ImportIssue[], level: 'ERROR' | 'WARNING'): void => {
    for (const issue of issues) {
      lines.push(
        formatCsvRow([
          String(issue.row),
          String(issue.physicalLine),
          level,
          issue.field,
          issue.code,
          issue.valuePreview,
          issue.message,
        ]),
      );
    }
  };
  pushIssues(errors, 'ERROR');
  pushIssues(warnings, 'WARNING');
  return CSV_BOM + lines.join(CSV_CRLF) + CSV_CRLF;
}

/**
 * 检测产物落盘（NDJSON gzip + 报告 CSV · .tmp → rename 原子替换）。
 * 报告仅在确有错误/警告时生成（无问题则无 report_path · 客户端不展示下载入口）。
 */
export function writeDetectArtifacts(input: {
  detectId: string;
  createdAt: Date;
  rows: readonly NormalizedImportRow[];
  errors: readonly ImportIssue[];
  warnings: readonly ImportIssue[];
}): DetectArtifactsResult {
  const storageMonth = DateTime.fromJSDate(input.createdAt).setZone('Asia/Shanghai').toFormat('yyyy-MM');
  const dir = join(getImportStagingRoot(), storageMonth);
  mkdirSync(dir, { recursive: true });

  // 规范化行产物（NDJSON gzip）
  const ndjson = input.rows.map((r) => JSON.stringify(toArtifactWire(r))).join('\n') + '\n';
  const artifactBody = gzipSync(Buffer.from(ndjson, 'utf8'));
  const artifactPath = join(dir, `${input.detectId}.rows.ndjson.gz`);
  const artifactTmp = `${artifactPath}.tmp`;
  writeFileSync(artifactTmp, artifactBody, { mode: 0o600 });
  renameSync(artifactTmp, artifactPath);
  const artifactSha256 = createHash('sha256').update(artifactBody).digest('hex');

  // 问题报告 CSV（UTF-8 BOM + CRLF + quote-all + formula 防护 · §9.3 三层规则同导出）
  let reportPath: string | null = null;
  if (input.errors.length + input.warnings.length > 0) {
    reportPath = join(dir, `${input.detectId}.report.csv`);
    const reportTmp = `${reportPath}.tmp`;
    writeFileSync(reportTmp, buildReportCsv(input.errors, input.warnings), { mode: 0o600 });
    renameSync(reportTmp, reportPath);
  }

  return { artifactPath, artifactSha256, reportPath, storageMonth };
}

export interface ImportArtifactRow {
  rowNo: number;
  entryId: string;
  clientRefId: string;
  occurredAt: Date;
  type: 'income' | 'expense' | 'transfer';
  amountCents: number;
  categoryId: string;
  createdBy: string | null;
  memberName: string | null;
  sharedType: 'shared' | 'personal' | null;
  note: string | null;
}

/** 读取并校验规范化行产物（R16：SHA 不匹配按产物损坏处理） */
export function readDetectArtifactRows(expectedPath: string, expectedSha256: string | null): ImportArtifactRow[] {
  if (!existsSync(expectedPath)) {
    throw new ImportArtifactError(`detect artifact missing: ${expectedPath}`);
  }
  const body = readFileSync(expectedPath);
  if (expectedSha256 !== null) {
    const actual = createHash('sha256').update(body).digest('hex');
    if (actual !== expectedSha256) {
      throw new ImportArtifactError('detect artifact sha256 mismatch');
    }
  }
  const text = gunzipSync(body).toString('utf8');
  const rows: ImportArtifactRow[] = [];
  for (const line of text.split('\n')) {
    if (line === '') continue;
    const wire = JSON.parse(line) as ArtifactRowWire;
    rows.push({
      rowNo: wire.row_no,
      entryId: wire.entry_id,
      clientRefId: wire.client_ref_id,
      occurredAt: new Date(wire.occurred_at),
      type: wire.type,
      amountCents: wire.amount_cents,
      categoryId: wire.category_id,
      createdBy: wire.created_by,
      memberName: wire.member_name,
      sharedType: wire.shared_type,
      note: wire.note,
    });
  }
  return rows;
}

/** 删文件（best-effort · 文件不存在视为成功） */
export async function deleteDetectFile(path: string | null, log: ServiceLogger): Promise<void> {
  if (!path) return;
  try {
    await unlink(path);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== 'ENOENT') {
      log.warn({ err, path }, 'delete detect file failed (ignored)');
    }
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// worker 执行（§7.5）
// ─────────────────────────────────────────────────────────────────────────────

/** 导入大事务兜底超时（§7.5 · 防被其它长事务卡住时无限等待） */
const IMPORT_LOCK_TIMEOUT_SQL = `SET LOCAL lock_timeout = '5s'`;
const IMPORT_STATEMENT_TIMEOUT_SQL = `SET LOCAL statement_timeout = '60s'`;
/** 批量 INSERT 单语句行数（500 行 × 11 列 = 5,500 参数 ≪ 65,535 上限） */
const INSERT_CHUNK_SIZE = 500;

export interface RunImportOutcome {
  imported: number;
  skipped: number;
}

/**
 * 导入 worker 主路径。
 *
 * 不变量：
 *   H1 —— hold 在独立短事务中先于大事务提交（holdRef.seq 回传供失败路径条件清除）；
 *   H2 —— hold 解除与余额同一条 UPDATE 且在事务末尾（ledgers 热点行持锁窗口最短）；
 *   §7.5 —— 数据 + 成功状态同一事务；终态条件更新 rowCount≠1 即整体回滚。
 *
 * 锁顺序：family_members（复核）→ entries（INSERT 新行）→ import_detect_sessions
 *（report_preview 置 NULL）→ ledgers（末尾）· 与 entryService 写路径一致。
 */
export async function runEntryImport(
  job: DataJobEntity,
  holdRef: { seq: number | null },
  log: ServiceLogger,
): Promise<RunImportOutcome> {
  const runToken = job.runToken;
  if (!runToken) throw new ImportArtifactError('import job claimed without run_token');
  if (!job.detectId) throw new ImportArtifactError('import job missing detect_id');

  // 0. 会话 sanity（committed 会话 + 产物路径 + 归属本任务）
  const session = await importDetectRepo.findById(job.detectId);
  if (!session || session.status !== 'consumed' || session.jobId !== job.id || !session.artifactPath) {
    throw new ImportContextInvalidError('detect session not in consumed state for this job');
  }

  // 1. 读产物 + SHA 校验（R16 · 事务外 IO）
  const artifactRows = readDetectArtifactRows(session.artifactPath, session.artifactSha256);

  // 2. 应用 member_mapping（§4.3 · 映射在 commit 时落入会话，执行期不再二次解析 CSV）：
  //    待映射行（created_by=null）：映射命中 → 映射值（'__self__' → 操作者）；未覆盖 → 跳过
  const mapping = session.memberMapping ?? {};
  const finalRows: ImportArtifactRow[] = [];
  let skipped = 0;
  // 由 member_mapping 补齐归属的行数。这些行在 detect 阶段被记为 MEMBER_UNMATCHED **ERROR**
  // （自产文件 · §3.3 规则 4a），映射后即可导入，故结果摘要里必须从 error_count 转入
  // warning_count（§3.3「映射后转为 WARNING（可导入 + 报告中留痕）」）。
  // 算术精确性：importCsv 中所有 ERROR 分支都 continue（不入产物），唯一例外就是待映射行，
  // 故「产物中 createdBy === null 的行」与「MEMBER_UNMATCHED ERROR」严格一一对应。
  let mappedFromUnmatched = 0;
  for (const row of artifactRows) {
    if (row.createdBy !== null) {
      finalRows.push(row);
      continue;
    }
    const mapped = row.memberName !== null ? mapping[row.memberName] : undefined;
    if (mapped === undefined) {
      skipped += 1;
      continue;
    }
    finalRows.push({ ...row, createdBy: mapped === '__self__' ? job.userId : mapped });
    mappedFromUnmatched += 1;
  }

  // 3. 设置 sync-hold（独立短事务 · H1：必须先于大事务提交；ledger 已删 ⇒ 上下文失效）
  const holdSeq = await ledgerRepo.setSyncHold(job.ledgerId);
  if (holdSeq === null) {
    throw new ImportContextInvalidError('ledger deleted before import');
  }
  holdRef.seq = holdSeq;

  // 4. 大事务
  const pool = getPool();
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query(IMPORT_LOCK_TIMEOUT_SQL);
    await client.query(IMPORT_STATEMENT_TIMEOUT_SQL);

    // 4a. 复核：操作者仍是活跃成员（FOR UPDATE · 锁顺序第一段）
    const operatorOk = await familyMemberRepo.lockActiveMember(job.userId, job.familyId, client);
    if (!operatorOk) {
      throw new ImportContextInvalidError('operator is no longer an active member');
    }

    // 4b. 复核：产物中所有 distinct created_by（含映射后的 user_id 集合 · §7.5 v1.0）仍活跃
    const memberIds = [...new Set(finalRows.map((r) => r.createdBy).filter((x): x is string => x !== null))];
    const activeIds = await familyMemberRepo.lockActiveMembersByIds(job.familyId, memberIds, client);
    const activeSet = new Set(activeIds);
    const inactive = memberIds.filter((id) => !activeSet.has(id));
    if (inactive.length > 0) {
      throw new ImportContextInvalidError(`mapped/detected members no longer active: ${inactive.length}`);
    }

    // 4c. 复核：产物中所有 distinct category_id 仍存在且未软删且 type 匹配（只读 · 分类无硬删路径）
    //     逐 id 查询而非 ANY($1::uuid[])：pg-mem 不支持数组参数 ANY 比较（测试通道与真 PG 行为须一致）
    const categoryIds = [...new Set(finalRows.map((r) => r.categoryId))];
    const catTypeById = new Map<string, string>();
    for (const catId of categoryIds) {
      const catRes = await client.query<{ id: string; type: string }>(
        `SELECT id, type FROM categories WHERE id = $1 AND deleted_at IS NULL`,
        [catId],
      );
      const row = catRes.rows[0];
      if (row) catTypeById.set(row.id, row.type);
    }
    for (const row of finalRows) {
      if (catTypeById.get(row.categoryId) !== row.type) {
        throw new ImportContextInvalidError('category invalidated since detect');
      }
    }

    // 4d. 隐私口径：任务终态后 report_preview 置 NULL（§7.4 v1.0 P2 · 在碰 ledgers 之前）
    await importDetectRepo.clearReportPreview(session.id, client);

    // 4e. 批量 INSERT（change_seq 走列默认 nextval · 与 entryRepo 同源）
    //
    // client_ref_id 冲突分流（§7.5 步骤 6）——双路径：
    //   a) 确定性预检（主路径）：插入前 SELECT 探测。pg-mem 的 23505 不带 constraint 属性，
    //      仅靠约束名分流在测试通道无法覆盖；预检在 pg-mem 与真 PG 行为一致。
    //   b) 23505 约束名兜底（竞态）：预检与插入之间仍有另一执行体插入的窗口，
    //      生产真 PG 的 constraint='uq_entries_ledger_client_ref' 精确兜住。
    if (finalRows.length > 0) {
      // 动态 IN 展开而非 ANY($2::text[])：pg-mem 不支持数组参数 ANY 比较
      const refIds = finalRows.map((r) => r.clientRefId);
      const placeholders = refIds.map((_, i) => `$${i + 2}`).join(', ');
      const dup = await client.query(
        `SELECT 1 FROM entries WHERE ledger_id = $1 AND client_ref_id IN (${placeholders}) LIMIT 1`,
        [job.ledgerId, ...refIds],
      );
      if ((dup.rowCount ?? 0) > 0) {
        throw new ImportClientRefConflictError('entries already imported (client_ref_id pre-check hit)');
      }
    }
    try {
      await insertImportRows(client, job.ledgerId, finalRows);
    } catch (err) {
      const pgErr = err as { code?: string; constraint?: string };
      if (pgErr.code === '23505' && pgErr.constraint === 'uq_entries_ledger_client_ref') {
        throw new ImportClientRefConflictError('entries already imported (client_ref_id unique hit)');
      }
      throw err;
    }

    // 4f. 事务末尾：余额汇总 + hold 解除同一语句（H2 · delta=0 也执行）
    const delta = finalRows.reduce(
      (acc, r) => acc + (r.type === 'income' ? r.amountCents : r.type === 'expense' ? -r.amountCents : 0),
      0,
    );
    const released = await ledgerRepo.releaseHoldAndApplyDelta({ ledgerId: job.ledgerId, delta }, client);
    if (!released) {
      throw new ImportContextInvalidError('ledger row missing at releaseHoldAndApplyDelta');
    }

    // 4g. job=succeeded 条件更新（rowCount 必须为 1 · 否则整体回滚 · §7.5 v0.9 强制项）
    const marked = await dataJobRepo.markImportSucceededInTx(
      job.id,
      runToken,
      {
        imported: finalRows.length,
        skipped,
        // 映射消费掉的 MEMBER_UNMATCHED 由 ERROR 计入 WARNING（§3.3）：
        // 否则已成功导入的行仍计在 error_count 里，摘要与实际结果自相矛盾
        errorCount: Math.max(0, (session.errorCount ?? 0) - mappedFromUnmatched),
        warningCount: (session.warningCount ?? 0) + mappedFromUnmatched,
      },
      client,
    );
    if (!marked) {
      throw new ImportSuccessWriteBackRace('import success write-back lost run_token');
    }

    await client.query('COMMIT');
    holdRef.seq = null; // hold 已在事务内同语句解除（H2），失败路径无需再清
  } catch (err) {
    try {
      await client.query('ROLLBACK');
    } catch {
      /* 保留原异常 */
    }
    throw err;
  } finally {
    client.release();
  }

  // 5. 提交后：删规范化行产物（隐私最小化 · §7.4）；报告 CSV 保留至 report_expires_at
  await deleteDetectFile(session.artifactPath, log);

  return { imported: finalRows.length, skipped };
}

/** 批量 INSERT entries（500 行/语句 · 参数上限安全） */
async function insertImportRows(
  client: PoolClient,
  ledgerId: string,
  rows: readonly ImportArtifactRow[],
): Promise<void> {
  for (let start = 0; start < rows.length; start += INSERT_CHUNK_SIZE) {
    const chunk = rows.slice(start, start + INSERT_CHUNK_SIZE);
    const values: unknown[] = [];
    const tuples: string[] = [];
    chunk.forEach((r, i) => {
      const b = i * 11;
      tuples.push(
        `($${b + 1}, $${b + 2}, $${b + 3}, $${b + 4}, $${b + 5}, $${b + 6}, $${b + 7}, $${b + 8}, $${b + 9}, $${b + 10}, $${b + 11})`,
      );
      values.push(
        r.entryId,
        ledgerId,
        r.amountCents,
        'CNY',
        r.type,
        r.categoryId,
        r.note,
        r.occurredAt,
        r.createdBy,
        r.clientRefId,
        r.sharedType,
      );
    });
    await client.query(
      `INSERT INTO entries (id, ledger_id, amount, currency, type, category_id, note, occurred_at,
                            created_by, client_ref_id, shared_type)
       VALUES ${tuples.join(', ')}`,
      values,
    );
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// 检测管道（§7.4 步骤 2-6 · detect 路由调用）
// ─────────────────────────────────────────────────────────────────────────────

export interface DetectPipelineInput {
  session: ImportDetectSessionEntity;
  /** 原始上传字节（≤1MB · 路由已做大小/频控闸口） */
  buffer: Buffer;
  familyKind: 'personal' | 'shared';
  operatorUserId: string;
  /** 活跃成员（left_at IS NULL · 路由预加载） */
  members: ReadonlyArray<{ userId: string; nickname: string }>;
  /** 目标家庭可见分类（系统 + 自定义 · 路由预加载） */
  categories: readonly CategoryEntity[];
}

/**
 * 编码/类型闸口（§9.1 · 拒绝 XLSX/JSON/二进制）→ UTF-8 文本。
 * 文件级失败一律：会话转 failed + 抛 ImportFileInvalidError（路由映射 400 INVALID_ARGUMENT）。
 */
function decodeCsvBuffer(buffer: Buffer): string {
  // XLSX 魔数（zip 容器 'PK\x03\x04'）
  if (buffer.length >= 4 && buffer[0] === 0x50 && buffer[1] === 0x4b && buffer[2] === 0x03 && buffer[3] === 0x04) {
    throw new ImportFileInvalidError('暂不支持 Excel 文件，请在 Excel/WPS 中「另存为 → CSV UTF-8」后重新上传');
  }
  let text: string;
  try {
    text = new TextDecoder('utf-8', { fatal: true }).decode(buffer);
  } catch {
    throw new ImportFileInvalidError('文件须为 UTF-8 编码（可带 BOM），Excel 可用「另存为 → CSV UTF-8」导出');
  }
  // JSON 探测（首非空白字符）
  const firstNonWs = text.trimStart().charAt(0);
  if (firstNonWs === '{' || firstNonWs === '[') {
    throw new ImportFileInvalidError('暂不支持 JSON 文件，请上传 UTF-8 编码的 CSV 文件');
  }
  return text;
}

function toPreviewItem(issue: ImportIssue): { row: number; field: string; code: string; value_preview: string } {
  return { row: issue.row, field: issue.field, code: issue.code, value_preview: issue.valuePreview };
}

/**
 * 检测主管道：解码 → 解析/校验（纯函数）→ 产物落盘 → 会话推进。
 * 返回解析结果；文件级失败抛 ImportFileInvalidError（会话已转 failed，并发槽已释放）。
 * 非文件级异常（落盘 IO / markReady 写失败）原样抛出，会话仍是 detecting —— 由调用方
 * （importJobs detect 路由，即并发槽的申请者）兜底 markFailed 释放槽位。
 */
export async function runDetectPipeline(input: DetectPipelineInput): Promise<ImportAnalysis> {
  const { session } = input;

  const failSession = async (message: string): Promise<never> => {
    await importDetectRepo.markFailed(session.id);
    throw new ImportFileInvalidError(message);
  };

  // 1. 编码/类型闸口
  let text: string;
  try {
    text = decodeCsvBuffer(input.buffer);
  } catch (err) {
    if (err instanceof ImportFileInvalidError) return failSession(err.message);
    throw err;
  }

  // 2. 解析 + 校验（纯函数 · §3 全规则）
  const analysis = analyzeImportCsv(text, {
    detectId: session.id,
    familyKind: input.familyKind,
    operatorUserId: input.operatorUserId,
    members: input.members,
    categories: input.categories,
  });
  if (!analysis.ok) {
    return failSession(analysis.fileError?.message ?? '文件内容无法识别');
  }

  // 3. 产物落盘（NDJSON gzip + 报告 CSV · 原始 CSV 全程不落盘 · §7.4）
  const artifacts = writeDetectArtifacts({
    detectId: session.id,
    createdAt: session.createdAt,
    rows: analysis.rows,
    errors: analysis.errors,
    warnings: analysis.warnings,
  });

  // 4. 会话推进 ready（汇总 + 预览 + 双有效期 · §7.4 步骤 6）
  const preview: DetectReportPreview = {
    errors: analysis.errors.slice(0, PREVIEW_LIMIT).map(toPreviewItem),
    warnings: analysis.warnings.slice(0, PREVIEW_LIMIT).map(toPreviewItem),
    unmatched_members: analysis.unmatchedMembers.map((m) => ({ nickname: m.nickname, row_count: m.rowCount })),
    errors_truncated: analysis.errors.length > PREVIEW_LIMIT,
    warnings_truncated: analysis.warnings.length > PREVIEW_LIMIT,
    unmatched_members_truncated: analysis.unmatchedMembersTruncated,
    // 全量聚合（不经预览截断）：客户端二次确认弹窗的「系统将 N 条归入默认子分类」（§4.6）
    subcategory_fallback_count: analysis.warnings.filter((w) => w.code === 'SUBCATEGORY_FALLBACK').length,
  };
  await importDetectRepo.markReady(session.id, {
    isCostraExport: analysis.isCostraExport,
    formulaGuard: analysis.formulaGuard === 'apostrophe-v2' ? 'apostrophe-v2' : null,
    artifactPath: artifacts.artifactPath,
    artifactSha256: artifacts.artifactSha256,
    reportPath: artifacts.reportPath,
    totalRows: analysis.totalRows,
    importableRows: analysis.importableRows,
    errorCount: analysis.errors.length,
    warningCount: analysis.warnings.length,
    reportPreview: preview,
  });

  return analysis;
}

// ─────────────────────────────────────────────────────────────────────────────
// 检测会话周期清理（§7.4 · 应用侧每分钟 + 启动补偿）
// ─────────────────────────────────────────────────────────────────────────────

/**
 * 每分钟清理：
 *   1. 僵尸 detecting（>10min）→ failed（释放 §4.4 并发槽；半成品 .tmp 文件由 cron 兜底）；
 *   2. ready 过期 → 删规范化行产物（15min 行产物寿命）；
 *   3. report 过期（24h）→ 删报告文件；ready/failed 且无关联 job 的行整行删除
 *     （consumed 行与 data_jobs 元数据同寿 30 天，由 maintenance cron 收尾 · §7.4）。
 */
export async function cleanupDetectSessions(log: ServiceLogger): Promise<void> {
  try {
    const zombies = await importDetectRepo.reapZombieDetecting();
    for (const s of zombies) {
      await deleteDetectFile(s.artifactPath, log);
      await deleteDetectFile(s.reportPath, log);
      log.warn({ detect_id: s.id, user_id: s.userId }, 'zombie detecting session reaped');
    }

    const expiredReady = await importDetectRepo.listReadyExpiredWithArtifact();
    for (const s of expiredReady) {
      await deleteDetectFile(s.artifactPath, log);
      await importDetectRepo.clearArtifactPath(s.id);
    }

    const reportExpired = await importDetectRepo.listReportExpired();
    for (const s of reportExpired) {
      await deleteDetectFile(s.reportPath, log);
      await importDetectRepo.clearReportPath(s.id);
      if ((s.status === 'ready' || s.status === 'failed') && s.jobId === null) {
        await importDetectRepo.deleteSessionRow(s.id);
      }
    }
  } catch (err) {
    log.error({ err }, 'detect session cleanup failed');
  }
}
