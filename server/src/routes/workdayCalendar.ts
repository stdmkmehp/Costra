/**
 * Costra · Server · workday-calendar 路由
 *
 * 卡号占位：COSTRA-5xx（T2 · Sprint-4 · Epic-E）
 * 事实源：docs/design/workday-recurring-tech-spec.md §7.1
 *
 * 端点：
 *   GET /v1/workday-calendar/:year  获取指定年份的节假日数据
 *   → { year, holidays: string[], workdays: string[] }
 *
 * 该端点无需鉴权（节假日数据非隐私）。
 * 用于小程序编辑页「每个工作日」周期的本地预览降级。
 */

import type { FastifyInstance } from 'fastify';
import { getPool } from '../db/pool.js';

interface YearParam {
  year: number;
}

export async function registerWorkdayCalendarRoutes(
  app: FastifyInstance,
): Promise<void> {
  app.get<{ Params: YearParam }>(
    '/workday-calendar/:year',
    {
      schema: {
        params: {
          type: 'object',
          properties: {
            year: { type: 'integer', minimum: 2020, maximum: 2099 },
          },
        },
      },
    },
    async (request, reply) => {
      const year = request.params.year;
      const result = await getPool().query<{
        year: number;
        holidays: string[];
        workdays: string[];
      }>(
        'SELECT year, holidays, workdays FROM workday_calendars WHERE year = $1',
        [year],
      );

      if (result.rows.length === 0) {
        return reply.code(404).send({ error: 'no holiday data for this year' });
      }

      const row = result.rows[0];
      return {
        year: row.year,
        holidays: row.holidays,
        workdays: row.workdays,
      };
    },
  );
}
