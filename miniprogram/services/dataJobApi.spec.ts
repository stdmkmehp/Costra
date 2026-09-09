// services/dataJobApi.spec.ts · 数据任务 API 客户端单测
// 事实源：docs/design/data-import-export-client-analysis.md v1.0 §6
//
// 覆盖：
//   - createExportJob：from/to 组装（缺省 ⇒ 无 body · 有区间 ⇒ JSON body）
//   - listDataJobs：wire → model 适配 + server_now 透传
//   - adaptDataJob：snake_case → camelCase 全字段
//   - 已读标记：mark 去重 + 截断 50 · hasUnseen 判据（succeeded 且未见）

import { describe, it, expect, beforeEach, vi } from 'vitest';

const requestMock = vi.hoisted(() => vi.fn());
vi.mock('./request', () => ({ request: requestMock }));

const storageMap = vi.hoisted(() => new Map<string, unknown>());
vi.mock('./storage', () => ({
  getItem: vi.fn(async (key: string) => {
    const env = storageMap.get(key) as { d: unknown } | undefined;
    return env === undefined ? null : env.d;
  }),
  setItem: vi.fn(async (key: string, data: unknown) => {
    storageMap.set(key, { d: data });
  }),
  removeItem: vi.fn(async (key: string) => {
    storageMap.delete(key);
  }),
}));

import {
  createExportJob,
  listDataJobs,
  adaptDataJob,
  markDataJobSeen,
  getSeenCompletedJobIds,
  hasUnseenCompletedDataJob,
} from './dataJobApi';
import type { DataJobWire } from './dataJobApi';

function wireJob(overrides: Partial<DataJobWire> = {}): DataJobWire {
  return {
    id: 'j1',
    type: 'export',
    status: 'succeeded',
    stage: null,
    stage_started_at: null,
    retryable: false,
    error: null,
    attempts: 1,
    export_from: null,
    export_to: null,
    created_at: '2026-09-07T10:00:00.000Z',
    started_at: '2026-09-07T10:00:01.000Z',
    finished_at: '2026-09-07T10:00:03.000Z',
    result_summary: { entry_count: 42, part_count: 1, storage_month: '2026-09' },
    files: [
      {
        part: 1,
        filename: 'Costra_个人账本_20240101至20260907_20260907T100003.csv',
        size_bytes: 1234,
        sha256: 'abc',
        download_path: '/data-jobs/j1/download?part=1',
      },
    ],
    file_expires_at: '2026-09-08T10:00:03.000Z',
    ...overrides,
  };
}

beforeEach(() => {
  requestMock.mockReset();
  storageMap.clear();
});

describe('createExportJob', () => {
  it('缺省（全部流水）⇒ POST 无 body', async () => {
    requestMock.mockResolvedValueOnce(wireJob({ status: 'queued' }));
    await createExportJob();
    expect(requestMock).toHaveBeenCalledWith({
      path: '/export-jobs',
      method: 'POST',
      body: undefined,
    });
  });

  it('有区间 ⇒ JSON body { from, to }', async () => {
    requestMock.mockResolvedValueOnce(wireJob({ status: 'queued' }));
    await createExportJob({ from: '2026-06-01', to: '2026-06-30' });
    expect(requestMock).toHaveBeenCalledWith({
      path: '/export-jobs',
      method: 'POST',
      body: { from: '2026-06-01', to: '2026-06-30' },
    });
  });

  it('指定目标账本 ⇒ body 带 ledger_id（§6.2 选账本）', async () => {
    requestMock.mockResolvedValueOnce(wireJob({ status: 'queued' }));
    await createExportJob({ ledgerId: 'ledger-9', from: '2026-06-01', to: '2026-06-30' });
    expect(requestMock).toHaveBeenCalledWith({
      path: '/export-jobs',
      method: 'POST',
      body: { ledger_id: 'ledger-9', from: '2026-06-01', to: '2026-06-30' },
    });
  });
});

describe('listDataJobs', () => {
  it('wire → model 适配 + server_now 透传', async () => {
    requestMock.mockResolvedValueOnce({
      jobs: [wireJob()],
      server_now: '2026-09-07T10:01:00.000Z',
    });
    const { jobs, serverNow } = await listDataJobs();
    expect(serverNow).toBe('2026-09-07T10:01:00.000Z');
    expect(jobs.length).toBe(1);
    expect(jobs[0]!.entryCount).toBe(42);
    expect(jobs[0]!.files[0]!.sizeBytes).toBe(1234);
    expect(jobs[0]!.files[0]!.downloadPath).toBe('/data-jobs/j1/download?part=1');
  });

  it('limit 参数透传', async () => {
    requestMock.mockResolvedValueOnce({ jobs: [], server_now: '2026-09-07T10:01:00.000Z' });
    await listDataJobs(25);
    expect(requestMock).toHaveBeenCalledWith({
      path: '/data-jobs',
      method: 'GET',
      query: { limit: 25 },
    });
  });

  it('缺省 limit = 10（任务中心只展示最近 10 条）', async () => {
    requestMock.mockResolvedValueOnce({ jobs: [], server_now: '2026-09-07T10:01:00.000Z' });
    await listDataJobs();
    expect(requestMock).toHaveBeenCalledWith({
      path: '/data-jobs',
      method: 'GET',
      query: { limit: 10 },
    });
  });
});

describe('adaptDataJob', () => {
  it('snake_case → camelCase 全字段 + result_summary 缺省为 null', () => {
    const job = adaptDataJob(wireJob({ result_summary: null, files: null }));
    expect(job.id).toBe('j1');
    expect(job.entryCount).toBeNull();
    expect(job.partCount).toBeNull();
    expect(job.files).toEqual([]);
    expect(job.createdAt).toBe('2026-09-07T10:00:00.000Z');
  });

  it('ledger_name 透传；服务端未下发时归 null（§7.6 任务归属展示）', () => {
    expect(adaptDataJob(wireJob({ ledger_name: '我的家庭' })).ledgerName).toBe('我的家庭');
    expect(adaptDataJob(wireJob()).ledgerName).toBeNull();
  });

  it('失败任务 error 原样透传', () => {
    const job = adaptDataJob(
      wireJob({
        status: 'failed',
        error: { code: 'INTERNAL', message: 'boom', stage: 'querying' },
      }),
    );
    expect(job.error?.code).toBe('INTERNAL');
    expect(job.error?.stage).toBe('querying');
  });
});

describe('已读标记', () => {
  it('markDataJobSeen 去重（已在表不重排）+ prepend', async () => {
    await markDataJobSeen('j1');
    await markDataJobSeen('j2');
    await markDataJobSeen('j1'); // 已存在 ⇒ 幂等不重排
    expect(await getSeenCompletedJobIds()).toEqual(['j2', 'j1']);
  });

  it('markDataJobSeen 截断 50', async () => {
    for (let i = 0; i < 60; i++) await markDataJobSeen(`j${i}`);
    const seen = await getSeenCompletedJobIds();
    expect(seen.length).toBe(50);
    expect(seen[0]).toBe('j59');
  });

  it('hasUnseenCompletedDataJob：succeeded 且未见 ⇒ true；全已见 ⇒ false；失败静默 false', async () => {
    requestMock.mockResolvedValueOnce({
      jobs: [wireJob({ id: 'j-new' })],
      server_now: '2026-09-07T10:01:00.000Z',
    });
    expect(await hasUnseenCompletedDataJob()).toBe(true);

    await markDataJobSeen('j-new');
    requestMock.mockResolvedValueOnce({
      jobs: [wireJob({ id: 'j-new' })],
      server_now: '2026-09-07T10:01:00.000Z',
    });
    expect(await hasUnseenCompletedDataJob()).toBe(false);

    requestMock.mockRejectedValueOnce(new Error('network'));
    expect(await hasUnseenCompletedDataJob()).toBe(false);
  });

  it('hasUnseenCompletedDataJob：queued/processing/failed 不算未读', async () => {
    requestMock.mockResolvedValueOnce({
      jobs: [
        wireJob({ id: 'j-q', status: 'queued' }),
        wireJob({ id: 'j-p', status: 'processing' }),
        wireJob({ id: 'j-f', status: 'failed' }),
      ],
      server_now: '2026-09-07T10:01:00.000Z',
    });
    expect(await hasUnseenCompletedDataJob()).toBe(false);
  });
});
