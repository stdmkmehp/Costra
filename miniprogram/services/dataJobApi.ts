// services/dataJobApi.ts · 数据任务（账本导出）API 客户端
//
// 事实源：docs/design/data-import-export-client-analysis.md v1.0 §6 · server/api/openapi.yaml
// 一期只有导出任务（type=export）；导入类型二期落地，此处契约已兼容。
//
// 端点：
//   POST /export-jobs           创建导出任务（body 可选 ledger_id/from/to · 账本缺省由服务端按用户态解析）
//   GET  /data-jobs?limit=N     任务中心列表（带 server_now · 阶段型模拟进度时间基准）
//   GET  /data-jobs/{job_id}    单任务详情（带 server_now）

import { request } from './request';
import { getItem, setItem } from './storage';
import { logger } from '../utils/logger';

// ─── wire（snake_case · 与服务端序列化一一对应） ───

export type DataJobStageWire = 'validating' | 'writing' | 'querying' | 'packaging';

export interface DataJobFileWire {
  part: number;
  filename: string;
  size_bytes: number;
  sha256: string;
  download_path: string;
}

export interface DataJobErrorWire {
  code: string;
  message: string;
  stage: DataJobStageWire | null;
}

export interface DataJobWire {
  id: string;
  type: 'import' | 'export';
  status: 'queued' | 'processing' | 'succeeded' | 'failed';
  stage: DataJobStageWire | null;
  stage_started_at: string | null;
  retryable: boolean;
  error: DataJobErrorWire | null;
  attempts: number;
  /** 导入溯源链（type=import 时非空 · §7.6） */
  detect_id?: string | null;
  /** 任务所属账本（「重新生成」按原账本重发 · §6.2） */
  ledger_id?: string;
  /** 任务所属账本名（§7.6 · 任务卡展示归属） */
  ledger_name?: string | null;
  export_from: string | null;
  export_to: string | null;
  created_at: string;
  started_at: string | null;
  finished_at: string | null;
  result_summary: {
    entry_count?: number;
    part_count?: number;
    storage_month?: string;
    /** 导入（§7.6）：实际入库 / 跳过 / 检测错误 / 检测警告 */
    imported?: number;
    skipped?: number;
    error_count?: number;
    warning_count?: number;
    /** 导出：用户所选原始日期（YYYY-MM-DD · 「重新生成」按原区间重发的事实源） */
    source_date_from?: string | null;
    source_date_to?: string | null;
  } | null;
  files: DataJobFileWire[] | null;
  file_expires_at: string | null;
  server_now?: string;
}

export interface DataJobListWire {
  jobs: DataJobWire[];
  server_now: string;
}

// ─── model（camelCase · 页面层消费） ───

export interface DataJobFile {
  part: number;
  filename: string;
  sizeBytes: number;
  sha256: string;
  downloadPath: string;
}

export interface DataJob {
  id: string;
  type: 'import' | 'export';
  status: 'queued' | 'processing' | 'succeeded' | 'failed';
  stage: DataJobStageWire | null;
  stageStartedAt: string | null;
  retryable: boolean;
  error: DataJobErrorWire | null;
  attempts: number;
  exportFrom: string | null;
  exportTo: string | null;
  createdAt: string;
  startedAt: string | null;
  finishedAt: string | null;
  /** 导入溯源链（type=import 时非空） */
  detectId: string | null;
  /** 任务所属账本 */
  ledgerId: string | null;
  /** 任务所属账本名（多账本用户据此区分任务归属 · §7.6） */
  ledgerName: string | null;
  entryCount: number | null;
  partCount: number | null;
  /** 导入结果（type=import · §7.6） */
  importedCount: number | null;
  skippedCount: number | null;
  /** 导出所选原始日期（YYYY-MM-DD · 全量导出为 null · 「重新生成」按原区间重发） */
  sourceDateFrom: string | null;
  sourceDateTo: string | null;
  files: DataJobFile[];
  fileExpiresAt: string | null;
}

export interface DataJobListResult {
  jobs: DataJob[];
  serverNow: string;
}

export function adaptDataJob(wire: DataJobWire): DataJob {
  return {
    id: wire.id,
    type: wire.type,
    status: wire.status,
    stage: wire.stage,
    stageStartedAt: wire.stage_started_at,
    retryable: wire.retryable,
    error: wire.error,
    attempts: wire.attempts,
    exportFrom: wire.export_from,
    exportTo: wire.export_to,
    createdAt: wire.created_at,
    startedAt: wire.started_at,
    finishedAt: wire.finished_at,
    detectId: wire.detect_id ?? null,
    ledgerId: wire.ledger_id ?? null,
    ledgerName: wire.ledger_name ?? null,
    entryCount: wire.result_summary?.entry_count ?? null,
    partCount: wire.result_summary?.part_count ?? null,
    importedCount: wire.result_summary?.imported ?? null,
    skippedCount: wire.result_summary?.skipped ?? null,
    sourceDateFrom: wire.result_summary?.source_date_from ?? null,
    sourceDateTo: wire.result_summary?.source_date_to ?? null,
    files: (wire.files ?? []).map((f) => ({
      part: f.part,
      filename: f.filename,
      sizeBytes: f.size_bytes,
      sha256: f.sha256,
      downloadPath: f.download_path,
    })),
    fileExpiresAt: wire.file_expires_at,
  };
}

/** 创建导出任务（ledgerId 缺省 = 当前活跃账本 · from/to 为 YYYY-MM-DD · 缺省 = 全部流水） */
export async function createExportJob(input: { ledgerId?: string; from?: string; to?: string } = {}): Promise<DataJob> {
  const body: Record<string, string> = {};
  if (input.ledgerId) body.ledger_id = input.ledgerId;
  if (input.from) body.from = input.from;
  if (input.to) body.to = input.to;
  const res = await request<DataJobWire>({
    path: '/export-jobs',
    method: 'POST',
    body: Object.keys(body).length > 0 ? body : undefined,
  });
  return adaptDataJob(res);
}

/** 任务中心列表（倒序 · 带 server_now · §6.4 默认 20 条） */
export async function listDataJobs(limit = 20): Promise<DataJobListResult> {
  const res = await request<DataJobListWire>({
    path: '/data-jobs',
    method: 'GET',
    query: { limit },
  });
  return { jobs: res.jobs.map(adaptDataJob), serverNow: res.server_now };
}

// ==============================================================================
// 已完成任务已读标记（§14.2：unseenCompletedJobIds 语义 · 设置页小绿点真相源）
// ==============================================================================

const SEEN_COMPLETED_KEY = 'dataJobs:seenCompleted';
const SEEN_COMPLETED_CAP = 50;

export async function getSeenCompletedJobIds(): Promise<string[]> {
  return (await getItem<string[]>(SEEN_COMPLETED_KEY)) ?? [];
}

/** 任务中心展示 succeeded 任务即调（prepend + 去重 + 截断 50） */
export async function markDataJobSeen(jobId: string): Promise<void> {
  const seen = await getSeenCompletedJobIds();
  if (seen.includes(jobId)) return;
  await setItem(SEEN_COMPLETED_KEY, [jobId, ...seen].slice(0, SEEN_COMPLETED_CAP));
}

/** 是否存在未读的已完成数据任务（设置页入口小绿点判据 · 导入/导出同待查看语义 · 失败静默返回 false） */
export async function hasUnseenCompletedDataJob(): Promise<boolean> {
  try {
    const { jobs } = await listDataJobs();
    const seen = await getSeenCompletedJobIds();
    return jobs.some(
      (j) => j.status === 'succeeded' && !seen.includes(j.id),
    );
  } catch (err) {
    logger.warn('dataJobApi', 'check unseen jobs fail', err);
    return false;
  }
}
