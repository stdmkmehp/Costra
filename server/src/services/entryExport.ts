/**
 * Costra · Server · 账本流水 CSV 导出执行体（E1/E3 服务端段）
 *
 * 事实源：docs/design/data-import-export-client-analysis.md v1.0 §2.1/§2.4/§7.2/§7.5
 *
 * 关键不变量：
 *   - 游标分页 `occurred_at ASC, id ASC`，游标值用 PG 侧 `occurred_at::text` 原文回传
 *     （含微秒）——禁经 JS Date 毫秒精度往返（溢出风险见 §12 E3 备注）；
 *   - 分片双阈值：5,000 行 或 900KB（含 BOM/表头），先到先切；
 *   - 每分片 = UTF-8 BOM + 表头行 + 数据行，行尾 CRLF，全字段 quote-all，
 *     单元格先过 `apostrophe-v2` Formula 防护（csv.ts）；
 *   - 产物 putObject 直传 COS（exports/<yyyy-MM>/<jobId>_<part>.csv · 同 key 覆盖写）；
 *     同一 job 重试前清掉自己的旧分片（removeJobArtifacts · COS headObject 探测清场）；
 *   - 每页（500 行）`setImmediate` 让出事件循环，且按 30s 节奏续执行租约；
 *   - 只导出未软删流水；分类/记账人按 LEFT JOIN 原样取名（软删分类仍留名）。
 *
 * 上下文失效（账本不存在 / 用户已非活跃成员）⇒ 抛 ExportContextInvalidError，
 * 由调度器归类为不可重试终态失败。
 */

import { createHash } from 'node:crypto';
import type { QueryResult } from 'pg';
import { DateTime } from 'luxon';
import { getPool } from '../db/pool.js';
import * as dataJobRepo from '../repositories/dataJobRepo.js';
import type { DataJobEntity, DataJobFileEntry } from '../repositories/dataJobRepo.js';
import * as ledgerRepo from '../repositories/ledgerRepo.js';
import * as familyMemberRepo from '../repositories/familyMemberRepo.js';
import { getCosClient } from './cosClient.js';
import {
  CSV_BOM,
  CSV_CRLF,
  formatCsvHeaderRow,
  formatCsvRow,
  sanitizeFilenameComponent,
} from '../utils/csv.js';

const SHANGHAI_ZONE = 'Asia/Shanghai';
/** 游标页大小（§7.2：500 条/页） */
const PAGE_SIZE = 500;
/** 分片双阈值（§2.4：5,000 行 / 900KB · 含 BOM 与表头） */
export const EXPORT_MAX_ROWS_PER_PART = 5_000;
export const EXPORT_MAX_BYTES_PER_PART = 900 * 1024;
/** 租约续期间隔（执行期间每 ≥30s 续一次） */
const LEASE_REFRESH_INTERVAL_MS = 30_000;

function isTestEnv(): boolean {
  return process.env.NODE_ENV === 'test';
}

/**
 * 微秒安全游标列（data-import-export v1.0 §12 E3 备注：禁用 toISOString 毫秒截断往返）：
 *   - 生产 PG：occurred_at 存微秒，JS Date 只有毫秒 ⇒ 由 DB 侧 to_char 原文回传
 *     （UTC 归一 · 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"'），下次作为 ::timestamptz 参数回传；
 *   - pg-mem：timestamptz 存储精度本就是毫秒（且不支持 to_char / ::text 转型），
 *     JS Date 参数往返无损 ⇒ 直接用 occurred_at 作游标。
 * 同 recurringRepo.findDueRules 的 isTest 分支范式。
 */
const CURSOR_SELECT = isTestEnv()
  ? `e.occurred_at AS occurred_at_cursor`
  : `to_char(e.occurred_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS occurred_at_cursor`;

/** 上下文失效：不可重试的确定性失败（账本被删 / 成员资格失效） */
export class ExportContextInvalidError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ExportContextInvalidError';
  }
}

interface EntryExportRow {
  id: string;
  type: string;
  amount: string;
  shared_type: string | null;
  note: string | null;
  occurred_at: Date;
  /** 游标值：生产 PG 为 to_char 文本（含微秒）· pg-mem 为 Date（毫秒即其存储精度） */
  occurred_at_cursor: string | Date;
  category_name: string | null;
  parent_category_name: string | null;
  creator_nickname: string | null;
}

export interface EntryExportOutcome {
  entryCount: number;
  partCount: number;
  files: DataJobFileEntry[];
  /** 产物所在月前缀（yyyy-MM · COS object key 的 exports/<yyyy-MM>/ 段 · 由调度器写入 result_summary.storage_month） */
  storageMonth: string;
}

/** 让出事件循环（宏任务粒度 · 避免长导出阻塞单进程） */
function yieldEventLoop(): Promise<void> {
  return new Promise((resolve) => setImmediate(resolve));
}

// ==============================================================================
// 行 → CSV 字段
// ==============================================================================

const TYPE_LABELS: Readonly<Record<string, string>> = {
  expense: '支出',
  income: '收入',
  transfer: '转账',
};

function toCsvFields(row: EntryExportRow): string[] {
  const dt = DateTime.fromJSDate(row.occurred_at, { zone: SHANGHAI_ZONE });
  const typeLabel = TYPE_LABELS[row.type] ?? '';
  const amountYuan = (Number(row.amount) / 100).toFixed(2);
  // 二级分类存在 ⇒ 一级取父名；否则一级取本名、二级留空
  const level1 = row.parent_category_name ?? row.category_name ?? '';
  const level2 = row.parent_category_name ? (row.category_name ?? '') : '';
  // 归属仅支出才有（chk_entries_shared_type_scope）
  const shared =
    row.type === 'expense'
      ? row.shared_type === 'shared'
        ? '共同'
        : row.shared_type === 'personal'
          ? '个人'
          : ''
      : '';
  return [
    dt.toFormat('yyyy-MM-dd'),
    dt.toFormat('HH:mm'),
    typeLabel,
    amountYuan,
    level1,
    level2,
    shared,
    row.creator_nickname ?? '',
    row.note ?? '',
  ];
}

// ==============================================================================
// 分片上传（COS · cos-offload-phase1 v0.2 §4.1/§4.4）
// ==============================================================================

interface OpenPart {
  part: number;
  rows: number;
  bytes: number;
  chunks: string[];
}

/**
 * 清理某 job 在 COS 的全部既有分片（重试/终态失败时用 · best-effort 不抛错）。
 * 分片 key 为 exports/<yyyy-MM>/<jobId>_<part>.csv、part 自 1 连续编号 ⇒
 * CAM 无 ListBucket 权限下用 headObject 逐片探测、首个 404 即止（策略含 HeadObject）。
 * 月前缀探「当前月 + 上月」（Asia/Shanghai）：跨月重试的残留也覆盖；更早残留不可能
 * （重试间隔 ≪ 1 个月），且 COS 30 天生命周期兜底。
 */
export async function removeJobArtifacts(jobId: string): Promise<void> {
  const cos = getCosClient('exports');
  const now = DateTime.now().setZone(SHANGHAI_ZONE);
  const months = [now.toFormat('yyyy-MM'), now.minus({ months: 1 }).toFormat('yyyy-MM')];
  for (const month of months) {
    try {
      const keys: string[] = [];
      for (let part = 1; ; part += 1) {
        const key = `exports/${month}/${jobId}_${part}.csv`;
        if (await cos.headObject(key)) keys.push(key);
        else break;
      }
      await cos.deleteObjects(keys);
    } catch {
      /* 清场失败不阻塞本次执行（残留由同 key 覆盖写 / 30 天生命周期兜底） */
    }
  }
}

/** 可注入的执行阈值（生产用默认值；单测用小阈值覆盖分片/翻页路径） */
export interface EntryExportLimits {
  pageSize: number;
  maxRowsPerPart: number;
  maxBytesPerPart: number;
}

const DEFAULT_LIMITS: EntryExportLimits = {
  pageSize: PAGE_SIZE,
  maxRowsPerPart: EXPORT_MAX_ROWS_PER_PART,
  maxBytesPerPart: EXPORT_MAX_BYTES_PER_PART,
};

/**
 * 执行导出：读游标分页 → 组 CSV → 分片上传 COS → 返回产物元数据。
 * 调用方（调度器）负责：claim 已发生、stage 推进、终态写回与失败归类。
 * limits 仅单测注入（生产一律默认阈值）。
 */
export async function runEntryExport(
  job: DataJobEntity,
  limits: EntryExportLimits = DEFAULT_LIMITS,
): Promise<EntryExportOutcome> {
  const runToken = job.runToken;
  if (!runToken) {
    throw new Error('runEntryExport requires claimed job (run_token)');
  }

  // ── 上下文校验（确定性失败 ⇒ 不重试）──
  const ledger = await ledgerRepo.findById(job.ledgerId);
  if (!ledger || ledger.deletedAt) {
    throw new ExportContextInvalidError(`ledger not found: ${job.ledgerId}`);
  }
  const stillMember = await familyMemberRepo.isActiveMember(job.userId, ledger.familyId);
  if (!stillMember) {
    throw new ExportContextInvalidError(
      `user ${job.userId} is no longer an active member of family ${ledger.familyId}`,
    );
  }

  // 重试清场：上一尝试可能已写出部分分片
  await removeJobArtifacts(job.id);

  const pool = getPool();
  const exportMoment = DateTime.now().setZone(SHANGHAI_ZONE);
  const monthKey = exportMoment.toFormat('yyyy-MM');

  let entryCount = 0;
  let partCount = 0;
  const partSizes: number[] = [];
  const partSha256: string[] = [];
  let cursorOccurredAt: string | Date | null = null;
  let cursorId: string | null = null;
  let firstOccurredAt: Date | null = null;
  let lastOccurredAt: Date | null = null;
  let part: OpenPart | null = null;
  let lastLeaseRefreshAt = Date.now();

  const flushPart = async (p: OpenPart): Promise<void> => {
    const buffer = Buffer.from(p.chunks.join(''), 'utf8');
    await getCosClient('exports').putObject(`exports/${monthKey}/${job.id}_${p.part}.csv`, buffer);
    partSizes.push(buffer.byteLength);
    partSha256.push(createHash('sha256').update(buffer).digest('hex'));
    partCount = p.part;
  };

  const openPart = (): OpenPart => {
    const header = CSV_BOM + formatCsvHeaderRow() + CSV_CRLF;
    return {
      part: partCount + 1,
      rows: 0,
      bytes: Buffer.byteLength(header, 'utf8'),
      chunks: [header],
    };
  };

  // ── 游标分页主循环 ──
  for (;;) {
    const res: QueryResult<EntryExportRow> = await pool.query<EntryExportRow>(
      `SELECT e.id, e.type, e.amount, e.shared_type, e.note,
              e.occurred_at, ${CURSOR_SELECT},
              c.name AS category_name,
              pc.name AS parent_category_name,
              u.nickname AS creator_nickname
         FROM entries e
         LEFT JOIN categories c ON c.id = e.category_id
         LEFT JOIN categories pc ON pc.id = c.parent_id
         LEFT JOIN users u ON u.id = e.created_by
        WHERE e.ledger_id = $1
          AND e.deleted_at IS NULL
          AND ($2::timestamptz IS NULL OR e.occurred_at >= $2::timestamptz)
          -- 半开区间 [from, to)（migration 0021 列注释「导出结束（不含）」）：
          --   排他端 = 所选止日次日 00:00（Asia/Shanghai），微秒级 occurred_at 无漏行窗口
          AND ($3::timestamptz IS NULL OR e.occurred_at < $3::timestamptz)
          AND ($4::timestamptz IS NULL
               OR e.occurred_at > $4::timestamptz
               OR (e.occurred_at = $4::timestamptz AND e.id > $5::uuid))
        ORDER BY e.occurred_at ASC, e.id ASC
        LIMIT ${limits.pageSize}`,
      [job.ledgerId, job.exportFrom, job.exportTo, cursorOccurredAt, cursorId],
    );

    for (const row of res.rows as EntryExportRow[]) {
      const line = formatCsvRow(toCsvFields(row)) + CSV_CRLF;
      const lineBytes = Buffer.byteLength(line, 'utf8');
      if (
        part !== null &&
        (part.rows >= limits.maxRowsPerPart ||
          part.bytes + lineBytes > limits.maxBytesPerPart)
      ) {
        await flushPart(part);
        part = null;
      }
      if (part === null) part = openPart();
      if (part.bytes + lineBytes > limits.maxBytesPerPart) {
        // §9.2 断言：空分片装不下单行只可能是 bug（note ≤200 + 分类/昵称长度有限 ⇒ 单行 <<1KB）
        throw new Error(
          `single CSV row exceeds part threshold: ${lineBytes}B > ${limits.maxBytesPerPart}B (entry ${row.id})`,
        );
      }
      part.chunks.push(line);
      part.rows += 1;
      part.bytes += lineBytes;

      entryCount += 1;
      if (!firstOccurredAt) firstOccurredAt = row.occurred_at;
      lastOccurredAt = row.occurred_at;
      cursorOccurredAt = row.occurred_at_cursor;
      cursorId = row.id;
    }

    if (res.rows.length < limits.pageSize) break;

    // 每页一次：让出事件循环 + 按节奏续租（只有整页满才可能有下一页）
    await yieldEventLoop();
    if (Date.now() - lastLeaseRefreshAt >= LEASE_REFRESH_INTERVAL_MS) {
      await dataJobRepo.refreshLease(job.id, runToken);
      lastLeaseRefreshAt = Date.now();
    }
  }

  // 空账本也产出一个仅表头的分片（§2.4：文件名日期用当天）
  if (part === null) part = openPart();
  await flushPart(part);
  part = null;

  // ── 文件名（§2.2 冻结规则 · 日期段 yyyy-MM-dd）──
  const rangeStart = job.exportFrom ?? firstOccurredAt;
  const startYmd = rangeStart
    ? DateTime.fromJSDate(rangeStart, { zone: SHANGHAI_ZONE }).toFormat('yyyy-MM-dd')
    : exportMoment.toFormat('yyyy-MM-dd');
  // export_to 是半开区间排他端（所选止日次日 00:00）⇒ 回推 1 天还原用户所选止日；
  // 未指定区间时用实际数据末行日期；空账本用导出当天
  const endYmd = job.exportTo
    ? DateTime.fromJSDate(job.exportTo, { zone: SHANGHAI_ZONE }).minus({ days: 1 }).toFormat('yyyy-MM-dd')
    : lastOccurredAt
      ? DateTime.fromJSDate(lastOccurredAt, { zone: SHANGHAI_ZONE }).toFormat('yyyy-MM-dd')
      : exportMoment.toFormat('yyyy-MM-dd');
  const exportTs = exportMoment.toFormat("yyyyMMdd'T'HHmmss");
  const baseName = `Costra_${sanitizeFilenameComponent(ledger.name)}_${startYmd}至${endYmd}_${exportTs}`;

  const files: DataJobFileEntry[] = partSizes.map((sizeBytes, idx) => {
    const partNo = idx + 1;
    const filename =
      partCount > 1 ? `${baseName}_${partNo}of${partCount}.csv` : `${baseName}.csv`;
    return {
      part: partNo,
      filename,
      size_bytes: sizeBytes,
      sha256: partSha256[idx]!,
      download_path: `/data-jobs/${job.id}/download?part=${partNo}`,
    };
  });

  return { entryCount, partCount, files, storageMonth: monthKey };
}
