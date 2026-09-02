// services/gmApi.spec.ts · GM 工具 API 请求形状与错误透传
// 事实源: docs/ops/gm-impersonate-design.md §5
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { listGmUsers } from './gmApi';
import type { ApiError } from './request';

const requestMock = vi.hoisted(() => vi.fn());

vi.mock('./request', () => ({
  request: requestMock,
}));

describe('services/gmApi · listGmUsers', () => {
  beforeEach(() => {
    requestMock.mockReset();
  });

  it('请求形状：GET /gm/users 无分页参数（双榜一次全量下发）', async () => {
    const lists = {
      active: [
        {
          id: '00000000-0000-0000-0000-000000000001',
          id_short: '00000000',
          nickname: '用户A',
          avatar_url: null,
          created_at: '2026-08-20T00:00:00.000Z',
          entry_count_7d: 12,
          last_active_at: '2026-09-02T02:10:00.000Z',
        },
      ],
      recent: [
        {
          id: '00000000-0000-0000-0000-000000000002',
          id_short: '00000000',
          nickname: '用户B',
          avatar_url: null,
          created_at: '2026-09-01T00:00:00.000Z',
        },
      ],
    };
    requestMock.mockResolvedValueOnce(lists);

    const resp = await listGmUsers();

    expect(resp).toEqual(lists);
    expect(requestMock).toHaveBeenCalledTimes(1);
    const opts = requestMock.mock.calls[0][0];
    expect(opts.method).toBe('GET');
    expect(opts.path).toBe('/gm/users');
    expect(opts.query).toBeUndefined();
  });

  it('错误透传：服务端 403 PERMISSION_DENIED 原样 reject', async () => {
    const err = new Error('gm only') as ApiError;
    err.code = 'PERMISSION_DENIED';
    err.status = 403;
    requestMock.mockRejectedValueOnce(err);

    await expect(listGmUsers()).rejects.toMatchObject({ code: 'PERMISSION_DENIED', status: 403 });
  });
});
