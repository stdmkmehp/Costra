// services/request.spec.ts · toApiError + uuidV4 幂等键格式
// 卡号: COSTRA-102 · D2.10
import { describe, it, expect } from 'vitest';
import { toApiError, uuidV4, isKnownServerCode } from './request';

describe('services/request · toApiError (P0-5 顶层字段解析)', () => {
  it('按 error-codes.md §1.1 事实源解析 body.code / body.message / body.trace_id / body.details', () => {
    const err = toApiError(400, {
      code: 'INVALID_ARGUMENT',
      message: 'field "amount" must be > 0',
      trace_id: '7f4c0e8a-xxxx-a1',
      details: { field: 'amount', value: 0, constraint: 'minimum=1' },
    });

    expect(err.code).toBe('INVALID_ARGUMENT');
    expect(err.status).toBe(400);
    expect(err.traceId).toBe('7f4c0e8a-xxxx-a1'); // snake → camel 映射
    expect(err.details).toEqual({ field: 'amount', value: 0, constraint: 'minimum=1' });
    expect(err.message).toBe('field "amount" must be > 0');
    // 事实源未登记错误码不应命中白名单
    expect(isKnownServerCode('INVALID_ARGUMENT')).toBe(true);
    expect(isKnownServerCode('FAKE_CODE_X')).toBe(false);
  });

  it('非 JSON / 空 body 走 CLIENT_HTTP_{status} 兜底 · 不是 HTTP_xxx', () => {
    const err = toApiError(503, '<html>gateway timeout</html>');
    expect(err.code).toBe('CLIENT_HTTP_503');
    expect(err.status).toBe(503);
  });
});

describe('services/request · uuidV4 (P0-4 幂等键格式)', () => {
  it('生成 UUID v4 格式字符串（version=4, variant=8/9/a/b）', () => {
    const pattern = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
    for (let i = 0; i < 20; i++) {
      expect(uuidV4()).toMatch(pattern);
    }
  });
});
