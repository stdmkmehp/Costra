/**
 * Costra · Server · /v1/workday-calendar/:year 路由单测
 *
 * 卡号占位：COSTRA-5xx（T2 · Sprint-4 · Epic-E）
 * 事实源：docs/design/workday-recurring-tech-spec.md §7.1
 *
 * 覆盖：
 *   T1  GET  /v1/workday-calendar/:year 有数据 → 200 + holidays/workdays
 *   T2  GET  /v1/workday-calendar/:year 无数据 → 404
 *   T3  GET  非法 year（越界）→ 400
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../src/app.js';
import { getPool } from '../src/db/pool.js';

let app: FastifyInstance;

beforeEach(async () => {
  app = await buildApp({ disableLogger: true });
  await app.ready();
});

afterEach(async () => {
  await app.close();
});

describe('GET /v1/workday-calendar/:year', () => {
  it('有数据 → 200 + holidays/workdays', async () => {
    await getPool().query(
      `INSERT INTO workday_calendars (year, holidays, workdays)
       VALUES (2026, $1, $2)`,
      [['01-01', '02-15'], ['02-08']],
    );

    const res = await app.inject({
      method: 'GET',
      url: '/v1/workday-calendar/2026',
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.year).toBe(2026);
    expect(body.holidays).toEqual(['01-01', '02-15']);
    expect(body.workdays).toEqual(['02-08']);
  });

  it('无数据 → 404', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/v1/workday-calendar/2030',
    });
    expect(res.statusCode).toBe(404);
  });

  it('非法 year（越界）→ 400', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/v1/workday-calendar/1900',
    });
    expect(res.statusCode).toBe(400);
  });
});
