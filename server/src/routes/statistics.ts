/**
 * Costra · Server · 统计页路由
 *
 * 卡号：COSTRA-224
 * 事实源：server/api/openapi.yaml /families/{family_id}/statistics/*
 *
 * 契约约束：
 *   - GET /families/{family_id}/statistics/monthly?month=YYYY-MM
 *   - GET /families/{family_id}/statistics/yearly?year=YYYY
 *   - GET /families/{family_id}/statistics/drill-down?...
 *
 * 路由层只做 "HTTP 参数解析 / 响应装配"，业务编排统一交给 statisticsService。
 */

import type { FastifyInstance, FastifyRequest } from 'fastify';
import { AppError } from '../errors/AppError.js';
import { ErrorCode } from '../errors/ErrorCode.js';
import * as statsService from '../services/statisticsService.js';

interface JwtPayload { sub: string; iat: number; exp: number }

async function parseUserId(request: FastifyRequest): Promise<string> {
  try {
    await request.jwtVerify();
  } catch {
    throw new AppError(ErrorCode.UNAUTHENTICATED, { message: 'invalid token' });
  }
  const user = request.user as JwtPayload | undefined;
  if (!user?.sub) throw new AppError(ErrorCode.UNAUTHENTICATED, { message: 'invalid token' });
  return user.sub;
}

const familyIdParamSchema = {
  type: 'object',
  required: ['family_id'],
  properties: {
    family_id: { type: 'string', format: 'uuid' },
  },
};

const monthlyQuerySchema = {
  type: 'object',
  required: ['month'],
  properties: {
    month: { type: 'string', pattern: '^\\d{4}-\\d{2}$' },
    top_n: { type: 'integer', minimum: 1, maximum: 50 },
  },
};

const yearlyQuerySchema = {
  type: 'object',
  required: ['year'],
  properties: {
    year: { type: 'string', pattern: '^\\d{4}$' },
    top_n: { type: 'integer', minimum: 1, maximum: 50 },
  },
};

const drillDownQuerySchema = {
  type: 'object',
  required: ['level'],
  properties: {
    month: { type: 'string', pattern: '^\\d{4}-\\d{2}$' },
    year: { type: 'string', pattern: '^\\d{4}$' },
    level: { type: 'integer', enum: [2, 3] },
    parent_category_id: { type: 'string', format: 'uuid' },
    category_id: { type: 'string', format: 'uuid' },
    limit: { type: 'integer', minimum: 1, maximum: 50 },
    offset: { type: 'integer', minimum: 0 },
  },
};

export async function registerStatisticsRoutes(app: FastifyInstance): Promise<void> {
  // GET /families/{family_id}/statistics/monthly
  app.get<{
    Params: { family_id: string };
    Querystring: { month: string; top_n?: number };
  }>(
    '/families/:family_id/statistics/monthly',
    { schema: { params: familyIdParamSchema, querystring: monthlyQuerySchema } },
    async (req, reply) => {
      const userId = await parseUserId(req);
      const result = await statsService.getMonthlyStatistics(userId, {
        familyId: req.params.family_id,
        month: req.query.month,
        topN: req.query.top_n,
      });
      reply.code(200).send(result);
    },
  );

  // GET /families/{family_id}/statistics/yearly
  app.get<{
    Params: { family_id: string };
    Querystring: { year: string; top_n?: number };
  }>(
    '/families/:family_id/statistics/yearly',
    { schema: { params: familyIdParamSchema, querystring: yearlyQuerySchema } },
    async (req, reply) => {
      const userId = await parseUserId(req);
      const result = await statsService.getYearlyStatistics(userId, {
        familyId: req.params.family_id,
        year: req.query.year,
        topN: req.query.top_n,
      });
      reply.code(200).send(result);
    },
  );

  // GET /families/{family_id}/statistics/drill-down
  app.get<{
    Params: { family_id: string };
    Querystring: {
      month?: string;
      year?: string;
      level: 2 | 3;
      parent_category_id?: string;
      category_id?: string;
      limit?: number;
      offset?: number;
    };
  }>(
    '/families/:family_id/statistics/drill-down',
    { schema: { params: familyIdParamSchema, querystring: drillDownQuerySchema } },
    async (req, reply) => {
      const userId = await parseUserId(req);
      const result = await statsService.getDrillDown(userId, {
        familyId: req.params.family_id,
        month: req.query.month,
        year: req.query.year,
        level: req.query.level,
        parentCategoryId: req.query.parent_category_id,
        categoryId: req.query.category_id,
        limit: req.query.limit,
        offset: req.query.offset,
      });
      reply.code(200).send(result);
    },
  );
}
