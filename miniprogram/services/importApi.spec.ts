// services/importApi.spec.ts · 账本导入 API 客户端单测
// 事实源：docs/design/data-import-export-client-analysis.md v1.0 §4.2/§4.3
//
// 覆盖：
//   - adaptDetectReport：snake_case → camelCase 全字段（含预览/映射/截断标志缺省防御）
//   - commitImportJob：body 组装（空映射不带 member_mapping 字段）
//   - describeImportIssue：行级/汇总级/未知 code 的本地化文案（§4.2 客户端按 code 本地化）

import { describe, it, expect, beforeEach, vi } from 'vitest';

const requestMock = vi.hoisted(() => vi.fn());
vi.mock('./request', () => ({ request: requestMock }));

import { commitImportJob, adaptDetectReport, describeImportIssue } from './importApi';
import type { DetectReportWire } from './importApi';

function wireReport(overrides: Partial<DetectReportWire> = {}): DetectReportWire {
  return {
    detect_id: 'd-1',
    ledger_id: 'l-1',
    ledger_name: '个人账本',
    family_kind: 'personal',
    file_name: 'import.csv',
    file_size: 1234,
    file_sha256: 'abc',
    is_costra_export: true,
    formula_guard: 'apostrophe-v2',
    total_rows: 10,
    importable_rows: 8,
    error_count: 1,
    warning_count: 1,
    errors_preview: [{ row: 2, field: '金额', code: 'AMOUNT_INVALID', value_preview: 'abc' }],
    warnings_preview: [{ row: 0, field: '归属', code: 'SHARED_FORCED_PERSONAL', value_preview: '' }],
    errors_truncated: false,
    warnings_truncated: false,
    unmatched_members: [{ nickname: '老王', row_count: 3 }],
    unmatched_members_truncated: false,
    subcategory_fallback_count: 2,
    report_path: '/v1/import-detect-sessions/d-1/report',
    created_at: '2026-09-07T10:00:00.000Z',
    expires_at: '2026-09-07T10:15:00.000Z',
    ...overrides,
  };
}

beforeEach(() => {
  requestMock.mockReset();
});

describe('adaptDetectReport', () => {
  it('全字段 snake→camel 映射', () => {
    const r = adaptDetectReport(wireReport());
    expect(r).toMatchObject({
      detectId: 'd-1',
      ledgerId: 'l-1',
      ledgerName: '个人账本',
      familyKind: 'personal',
      fileName: 'import.csv',
      fileSize: 1234,
      fileSha256: 'abc',
      isCostraExport: true,
      formulaGuard: 'apostrophe-v2',
      totalRows: 10,
      importableRows: 8,
      errorCount: 1,
      warningCount: 1,
      reportPath: '/v1/import-detect-sessions/d-1/report',
      createdAt: '2026-09-07T10:00:00.000Z',
      expiresAt: '2026-09-07T10:15:00.000Z',
    });
    expect(r.errorsPreview[0]).toEqual({ row: 2, field: '金额', code: 'AMOUNT_INVALID', valuePreview: 'abc' });
    expect(r.unmatchedMembers[0]).toEqual({ nickname: '老王', rowCount: 3 });
    expect(r.subcategoryFallbackCount).toBe(2);
  });

  it('缺省字段防御（undefined 预览/映射 ⇒ 空数组 + false）', () => {
    const wire = wireReport();
    const partial = { ...wire } as Record<string, unknown>;
    delete partial['errors_preview'];
    delete partial['warnings_preview'];
    delete partial['unmatched_members'];
    delete partial['errors_truncated'];
    delete partial['warnings_truncated'];
    delete partial['unmatched_members_truncated'];
    delete partial['subcategory_fallback_count'];
    const r = adaptDetectReport(partial as unknown as DetectReportWire);
    expect(r.errorsPreview).toEqual([]);
    expect(r.warningsPreview).toEqual([]);
    expect(r.unmatchedMembers).toEqual([]);
    expect(r.errorsTruncated).toBe(false);
    expect(r.warningsTruncated).toBe(false);
    expect(r.unmatchedMembersTruncated).toBe(false);
    expect(r.subcategoryFallbackCount).toBe(0);
  });
});

describe('commitImportJob', () => {
  it('无映射 ⇒ body 只有 detect_id', async () => {
    requestMock.mockResolvedValueOnce({ job_id: 'j-1', status: 'queued' });
    const res = await commitImportJob({ detectId: 'd-1' });
    expect(res).toEqual({ jobId: 'j-1', status: 'queued' });
    expect(requestMock).toHaveBeenCalledWith({
      path: '/import-jobs/commit',
      method: 'POST',
      body: { detect_id: 'd-1' },
    });
  });

  it('有映射 ⇒ 带 member_mapping；空对象映射视为无映射', async () => {
    requestMock.mockResolvedValueOnce({ job_id: 'j-2', status: 'queued' });
    await commitImportJob({ detectId: 'd-1', memberMapping: { 老王: '__self__' } });
    expect(requestMock).toHaveBeenCalledWith({
      path: '/import-jobs/commit',
      method: 'POST',
      body: { detect_id: 'd-1', member_mapping: { 老王: '__self__' } },
    });

    requestMock.mockResolvedValueOnce({ job_id: 'j-3', status: 'queued' });
    await commitImportJob({ detectId: 'd-1', memberMapping: {} });
    expect(requestMock).toHaveBeenLastCalledWith({
      path: '/import-jobs/commit',
      method: 'POST',
      body: { detect_id: 'd-1' },
    });
  });
});

describe('describeImportIssue · 按 code 本地化（§4.2）', () => {
  const I = (code: string, opts: { row?: number; field?: string; value?: string } = {}) => ({
    row: opts.row ?? 3,
    field: opts.field ?? '金额',
    code,
    valuePreview: opts.value ?? '',
  });

  it('行级问题带「第 N 条」前缀', () => {
    expect(describeImportIssue(I('DATE_INVALID', { field: '日期', value: '昨天' }))).toBe('第 3 条 · 日期无法解析「昨天」');
    expect(describeImportIssue(I('EMPTY_REQUIRED', { field: '金额' }))).toBe('第 3 条 · 金额为空');
    expect(describeImportIssue(I('AMOUNT_ZERO'))).toBe('第 3 条 · 金额为 0');
    expect(describeImportIssue(I('MEMBER_UNMATCHED', { field: '记账人', value: '老王' }))).toBe('第 3 条 · 记账人「老王」未匹配到家庭成员');
  });

  it('汇总级（row=0）不带行号前缀', () => {
    expect(describeImportIssue(I('SHARED_FORCED_PERSONAL', { row: 0, field: '归属' }))).toBe('目标为个人账本，归属列已统一按「个人」处理');
    expect(describeImportIssue(I('SHARED_DEFAULT_SUMMARY', { row: 0, field: '归属' }))).toBe('多条支出未指定归属，将记为「个人」');
  });

  it('未知 code 兜底展示原 code（不吞信息）', () => {
    expect(describeImportIssue(I('SOME_FUTURE_CODE'))).toBe('第 3 条 · SOME_FUTURE_CODE');
  });
});
