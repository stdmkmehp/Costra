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

  it('请求形状：GET /gm/users + query page/page_size', async () => {
    const page = {
      items: [
        {
          id: '00000000-0000-0000-0000-000000000001',
          id_short: '00000000',
          nickname: '用户A',
          avatar_url: null,
          created_at: '2026-08-20T00:00:00.000Z',
        },
      ],
      page: 2,
      page_size: 10,
      has_more: false,
    };
    requestMock.mockResolvedValueOnce(page);

    const resp = await listGmUsers(2, 10);

    expect(resp).toEqual(page);
    expect(requestMock).toHaveBeenCalledTimes(1);
    const opts = requestMock.mock.calls[0][0];
    expect(opts.method).toBe('GET');
    expect(opts.path).toBe('/gm/users');
    expect(opts.query).toEqual({ page: 2, page_size: 10 });
  });

  it('默认 pageSize = 20', async () => {
    requestMock.mockResolvedValueOnce({ items: [], page: 1, page_size: 20, has_more: false });
    await listGmUsers(1);
    expect(requestMock.mock.calls[0][0].query).toEqual({ page: 1, page_size: 20 });
  });

  it('错误透传：服务端 403 PERMISSION_DENIED 原样 reject', async () => {
    const err = new Error('gm only') as ApiError;
    err.code = 'PERMISSION_DENIED';
    err.status = 403;
    requestMock.mockRejectedValueOnce(err);

    await expect(listGmUsers(1)).rejects.toMatchObject({ code: 'PERMISSION_DENIED', status: 403 });
  });
});
