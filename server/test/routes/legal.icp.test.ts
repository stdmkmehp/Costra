/**
 * Costra · Server · /v1/legal/icp 单测
 *
 * 卡号：COSTRA-ICP（备案下证 · 2026-05-13）
 *
 * 用例：
 *   T1 [happy] 200 + body.service === '沪ICP备2026017253号-2'
 *   T2 [happy] body 包含 miniapp / subject / filedAt / verifyUrl 全字段
 *   T3 [contract] healthz 响应附带 icp 字段（与 ICP_INFO 一致）
 */

import { describe, it, expect, beforeEach } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../../src/app.js';
import { ICP_INFO } from '../../src/config/icp.js';

let app: FastifyInstance;

beforeEach(async () => {
  app = await buildApp({ disableLogger: true });
  await app.ready();
});

describe('GET /v1/legal/icp', () => {
  it('T1 happy 200 + service 备案号严格匹配工信部下证文本', async () => {
    const res = await app.inject({ method: 'GET', url: '/v1/legal/icp' });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { service: string };
    expect(body.service).toBe('沪ICP备2026017253号-2');
  });

  it('T2 happy 返回完整 ICP_INFO 字段集', async () => {
    const res = await app.inject({ method: 'GET', url: '/v1/legal/icp' });
    expect(res.statusCode).toBe(200);
    const body = res.json() as Record<string, string>;
    expect(body.miniapp).toBe('沪ICP备2026017253号-1X');
    expect(body.subject).toBe('上海');
    expect(body.filedAt).toBe('2026-05-13');
    expect(body.verifyUrl).toBe('https://beian.miit.gov.cn/');
  });

  it('T3 contract healthz 响应附带 icp 块（与 ICP_INFO 一致）', async () => {
    const res = await app.inject({ method: 'GET', url: '/healthz' });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { icp: typeof ICP_INFO };
    expect(body.icp).toEqual(ICP_INFO);
    expect(body.icp.service).toBe('沪ICP备2026017253号-2');
  });
});
