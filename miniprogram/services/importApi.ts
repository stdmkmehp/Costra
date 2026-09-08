// services/importApi.ts · 账本导入 API 客户端（data-import-export v1.0 二期）
//
// 事实源：docs/design/data-import-export-client-analysis.md v1.0 §4.2/§4.3/§8.3
// 契约镜像：server/api/openapi.yaml paths /import-jobs/detect · /import-jobs/commit
//           · /import-detect-sessions/{detect_id}/report
//
// 端点：
//   POST /import-jobs/detect                    multipart 上传 + 同步检测 → DetectReport
//   POST /import-jobs/commit                    确认导入（202 { job_id, status }）
//   GET  /import-detect-sessions/{id}/report    下载问题报告 CSV（走 fileTransfer.downloadWithAuth）
//
// 纪律：
//   - detect 走 wx.uploadFile（fileTransfer.uploadWithAuth · 与 request.ts 分离的传输层）；
//   - commit 走 request.ts JSON（自动带 Idempotency-Key；幂等锚实为 detect_id 状态机）；
//   - 错误映射不在这里做（error-mapper 统一 · 页面只负责 catch 后 mapError）。

import { request } from './request';
import { uploadWithAuth } from './fileTransfer';

// ─── wire（snake_case · 与服务端序列化一一对应） ───

export interface DetectReportIssueWire {
  /** 逻辑记录序号（表头=0，首条数据=1；汇总级=0） */
  row: number;
  /** 标准列名（汇总级为空串） */
  field: string;
  /** 机读码（EMPTY_REQUIRED/DATE_INVALID/…/MEMBER_UNMATCHED/…） */
  code: string;
  /** 出错字段的值（≤120 code points） */
  value_preview: string;
}

export interface UnmatchedMemberWire {
  nickname: string;
  row_count: number;
}

export interface DetectReportWire {
  detect_id: string;
  ledger_id: string;
  ledger_name: string;
  family_kind: 'personal' | 'shared';
  file_name: string | null;
  file_size: number;
  file_sha256: string;
  is_costra_export: boolean;
  formula_guard: 'apostrophe-v2' | 'none';
  total_rows: number;
  importable_rows: number;
  error_count: number;
  warning_count: number;
  errors_preview: DetectReportIssueWire[];
  warnings_preview: DetectReportIssueWire[];
  errors_truncated: boolean;
  warnings_truncated: boolean;
  unmatched_members: UnmatchedMemberWire[];
  unmatched_members_truncated: boolean;
  report_path: string;
  created_at: string;
  expires_at: string;
}

// ─── model（camelCase · 页面层消费） ───

export interface DetectReportIssue {
  row: number;
  field: string;
  code: string;
  valuePreview: string;
}

export interface UnmatchedMember {
  nickname: string;
  rowCount: number;
}

export interface DetectReport {
  detectId: string;
  ledgerId: string;
  ledgerName: string;
  familyKind: 'personal' | 'shared';
  fileName: string | null;
  fileSize: number;
  fileSha256: string;
  isCostraExport: boolean;
  formulaGuard: 'apostrophe-v2' | 'none';
  totalRows: number;
  importableRows: number;
  errorCount: number;
  warningCount: number;
  errorsPreview: DetectReportIssue[];
  warningsPreview: DetectReportIssue[];
  errorsTruncated: boolean;
  warningsTruncated: boolean;
  unmatchedMembers: UnmatchedMember[];
  unmatchedMembersTruncated: boolean;
  /** 报告下载相对路径（直接喂 downloadWithAuth · 24h 有效） */
  reportPath: string;
  createdAt: string;
  expiresAt: string;
}

export function adaptDetectReport(wire: DetectReportWire): DetectReport {
  const adaptIssue = (w: DetectReportIssueWire): DetectReportIssue => ({
    row: w.row,
    field: w.field,
    code: w.code,
    valuePreview: w.value_preview,
  });
  return {
    detectId: wire.detect_id,
    ledgerId: wire.ledger_id,
    ledgerName: wire.ledger_name,
    familyKind: wire.family_kind,
    fileName: wire.file_name,
    fileSize: wire.file_size,
    fileSha256: wire.file_sha256,
    isCostraExport: wire.is_costra_export,
    formulaGuard: wire.formula_guard,
    totalRows: wire.total_rows,
    importableRows: wire.importable_rows,
    errorCount: wire.error_count,
    warningCount: wire.warning_count,
    errorsPreview: (wire.errors_preview ?? []).map(adaptIssue),
    warningsPreview: (wire.warnings_preview ?? []).map(adaptIssue),
    errorsTruncated: wire.errors_truncated === true,
    warningsTruncated: wire.warnings_truncated === true,
    unmatchedMembers: (wire.unmatched_members ?? []).map((m) => ({
      nickname: m.nickname,
      rowCount: m.row_count,
    })),
    unmatchedMembersTruncated: wire.unmatched_members_truncated === true,
    reportPath: wire.report_path,
    createdAt: wire.created_at,
    expiresAt: wire.expires_at,
  };
}

// ─── 问题文案本地化（§4.2：code 是机读串，客户端按 code 本地化，不依赖服务端中文串）───

/**
 * 行级/汇总级问题 → 用户可读一行文案。
 * 汇总级（row=0）不带「第 N 行」前缀；未知 code 兜底展示原 code（不吞信息）。
 */
export function describeImportIssue(issue: DetectReportIssue): string {
  const v = issue.valuePreview;
  let body: string;
  switch (issue.code) {
    case 'EMPTY_REQUIRED':
      body = `${issue.field}为空`;
      break;
    case 'DATE_INVALID':
      body = `日期无法解析${v ? `「${v}」` : ''}`;
      break;
    case 'TIME_INVALID':
      body = `时间无法解析${v ? `「${v}」` : ''}`;
      break;
    case 'TYPE_UNRECOGNIZED':
      body = `类型无法识别${v ? `「${v}」` : ''}`;
      break;
    case 'AMOUNT_INVALID':
      body = `金额非法${v ? `「${v}」` : ''}`;
      break;
    case 'AMOUNT_ZERO':
      body = '金额为 0';
      break;
    case 'CATEGORY_NOT_FOUND':
      body = `分类「${v}」不存在`;
      break;
    case 'CATEGORY_TYPE_MISMATCH':
      body = `分类「${v}」与记录类型不匹配`;
      break;
    case 'MEMBER_AMBIGUOUS':
      body = `记账人「${v}」存在多个同名成员`;
      break;
    case 'MEMBER_UNMATCHED':
      body = `记账人「${v}」未匹配到家庭成员`;
      break;
    case 'AMOUNT_NEGATIVE_ABS':
      body = '金额为负，已按绝对值导入';
      break;
    case 'AMOUNT_ROUNDED':
      body = '金额精度超过分，已四舍五入';
      break;
    case 'SUBCATEGORY_FALLBACK':
      body = `二级分类「${v}」不存在，已归入默认子分类`;
      break;
    case 'SHARED_TYPE_IGNORED':
      body = '非支出类型的归属列已忽略';
      break;
    case 'SHARED_TYPE_UNRECOGNIZED':
      body = `归属无法识别${v ? `「${v}」` : ''}，已按家庭默认处理`;
      break;
    case 'NOTE_TRUNCATED':
      body = '备注超过 200 字，已截断';
      break;
    case 'SHARED_DEFAULT_SUMMARY':
      body = '多条支出未指定归属，将按共同家庭默认记为「共同」';
      break;
    case 'SHARED_FORCED_PERSONAL':
      body = '目标为个人账本，归属列已统一按「个人」处理';
      break;
    default:
      body = issue.code;
      break;
  }
  return issue.row > 0 ? `第 ${issue.row} 条 · ${body}` : body;
}

// ─── 端点 ───

/**
 * 上传 CSV 并同步检测（§4.2）。
 * 失败 reject ApiError：PAYLOAD_TOO_LARGE / INVALID_ARGUMENT / DETECT_IN_PROGRESS /
 * IMPORT_JOB_IN_PROGRESS / RATE_LIMITED / FAMILY_NOT_MEMBER / NOT_FOUND / CLIENT_*。
 */
export async function detectImportFile(input: {
  filePath: string;
  ledgerId: string;
}): Promise<DetectReport> {
  const res = await uploadWithAuth({
    path: '/import-jobs/detect',
    filePath: input.filePath,
    formData: { ledger_id: input.ledgerId },
  });
  return adaptDetectReport(JSON.parse(res.body) as DetectReportWire);
}

/**
 * 确认导入（§4.3 · 原子消费会话 + 创建任务）。
 * member_mapping：昵称 → 家庭成员 user_id 或 '__self__'（仅自产文件存在未匹配昵称时需要）。
 * 重复 commit 幂等回放原 job_id（服务端会话状态机保证，不建双任务）。
 */
export async function commitImportJob(input: {
  detectId: string;
  memberMapping?: Record<string, string>;
}): Promise<{ jobId: string; status: string }> {
  const body: Record<string, unknown> = { detect_id: input.detectId };
  if (input.memberMapping && Object.keys(input.memberMapping).length > 0) {
    body.member_mapping = input.memberMapping;
  }
  const res = await request<{ job_id: string; status: string }>({
    path: '/import-jobs/commit',
    method: 'POST',
    body,
  });
  return { jobId: res.job_id, status: res.status };
}
