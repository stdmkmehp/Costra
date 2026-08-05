/**
 * Costra · Server · recurring-entries 路由
 *
 * 卡号占位：COSTRA-5xx（T2 · Sprint-4 · Epic-E）
 * 事实源：docs/design/recurring-entry-tech-spec.md §5.2
 *
 * 端点：
 *   GET    /recurring-entries              列出当前用户创建的定时（跟人不跟账本）
 *   GET    /recurring-entries/:id          详情 · 只能取自己创建的
 *   POST   /recurring-entries              新建定时
 *   PATCH  /recurring-entries/:id          编辑（乐观锁）
 *   POST   /recurring-entries/:id/pause    手动禁用
 *   POST   /recurring-entries/:id/resume   手动启用 + 重算 next_run_at
 *   POST   /recurring-entries/:id/copy     复制规则
 *   DELETE /recurring-entries/:id?version=N 软删（乐观锁）
 *
 * 权限：所有操作 WHERE created_by = current_user · 404 而非 403
 */

import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { createHash } from 'node:crypto';
import { AppError } from '../errors/AppError.js';
import { ErrorCode } from '../errors/ErrorCode.js';
import * as idempotencyService from '../services/idempotencyService.js';
import type { RecurringService } from '../services/recurringService.js';
import type {
  CreateRecurringPayload,
  UpdateRecurringPayload,
} from '../services/recurringService.js';
import type { RecurringRuleEntity } from '../repositories/recurringRepo.js';

interface JwtPayload {
  sub: string;
  iat: number;
  exp: number;
}

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

function idempotencyHash(request: FastifyRequest, userId: string): string {
  return createHash('sha256').update(JSON.stringify({
    userId,
    params: request.params ?? {},
    query: request.query ?? {},
    body: request.body ?? {},
  })).digest('hex');
}

async function getCachedMutation(
  request: FastifyRequest,
  endpoint: string,
  userId: string,
): Promise<idempotencyService.CachedResponse | null> {
  const key = request.headers['idempotency-key'];
  if (typeof key !== 'string' || key.length === 0) return null;
  const result = await idempotencyService.checkAndGet(
    key,
    endpoint,
    idempotencyHash(request, userId),
  );
  return result.cached;
}

async function saveMutation(
  request: FastifyRequest,
  endpoint: string,
  userId: string,
  statusCode: number,
  responseBody: unknown,
): Promise<void> {
  const key = request.headers['idempotency-key'];
  if (typeof key !== 'string' || key.length === 0) return;
  await idempotencyService.save({
    key,
    endpoint,
    actorUserId: userId,
    requestHash: idempotencyHash(request, userId),
    responseStatus: statusCode,
    responseBody,
    // recurring 离线队列可能跨多天恢复；与 7 天补偿窗口对齐。
    ttlHours: 24 * 7,
  });
}

function sendCachedMutation(reply: FastifyReply, cached: idempotencyService.CachedResponse) {
  if (cached.statusCode === 204) return reply.code(204).send();
  return reply.code(cached.statusCode).send(cached.body);
}

function ruleToResponse(r: RecurringRuleEntity) {
  return {
    id: r.id,
    ledger_id: r.ledgerId,
    created_by: r.createdBy,
    type: r.type,
    amount: r.amount,
    currency: r.currency,
    category_id: r.categoryId,
    account_id: r.accountId,
    to_account_id: r.toAccountId,
    note: r.note,
    shared_type: r.sharedType,
    period: r.period,
    days_of_week: r.daysOfWeek,
    days_of_month: r.daysOfMonth,
    year_month_days: r.yearMonthDays,
    execute_bucket: r.executeBucket,
    execute_hour: r.executeHour,
    execute_minute: r.executeMinute,
    timezone: r.timezone,
    start_date: r.startDate,
    end_date: r.endDate,
    status: r.status,
    next_run_at: r.nextRunAt.toISOString(),
    last_run_at: r.lastRunAt?.toISOString() ?? null,
    last_run_status: r.lastRunStatus,
    created_at: r.createdAt.toISOString(),
    updated_at: r.updatedAt.toISOString(),
    version: r.version,
  };
}

// ---- schema 定义 ----

const arrayOfInt = { type: 'array', items: { type: 'integer' } };
const nullableArrayOfInt = {
  oneOf: [{ type: 'null' }, arrayOfInt],
};

const createBodySchema = {
  type: 'object',
  required: ['ledger_id', 'type', 'amount', 'period', 'execute_bucket', 'start_date'],
  additionalProperties: false,
  properties: {
    ledger_id: { type: 'string', format: 'uuid' },
    type: { type: 'string', enum: ['income', 'expense', 'transfer'] },
    amount: { type: 'integer', minimum: 1 },
    currency: { type: 'string' },
    category_id: { oneOf: [{ type: 'string', format: 'uuid' }, { type: 'null' }] },
    account_id: { oneOf: [{ type: 'string', format: 'uuid' }, { type: 'null' }] },
    to_account_id: { oneOf: [{ type: 'string', format: 'uuid' }, { type: 'null' }] },
    note: { oneOf: [{ type: 'string', maxLength: 200 }, { type: 'null' }] },
    shared_type: {
      oneOf: [{ type: 'string', enum: ['personal', 'shared'] }, { type: 'null' }],
    },
    period: {
      type: 'string',
      enum: ['weekly', 'biweekly', 'monthly', 'bimonthly', 'trimonthly', 'yearly'],
    },
    period_interval: { type: 'integer', minimum: 1 },
    days_of_week: nullableArrayOfInt,
    days_of_month: nullableArrayOfInt,
    year_month_days: nullableArrayOfInt,
    execute_bucket: {
      type: 'string',
      enum: ['dawn', 'morning', 'afternoon', 'night'],
    },
    timezone: { type: 'string' },
    start_date: { type: 'string', format: 'date' },
    end_date: { oneOf: [{ type: 'string', format: 'date' }, { type: 'null' }] },
  },
} as const;

const patchBodySchema = {
  type: 'object',
  required: ['version'],
  additionalProperties: false,
  properties: {
    version: { type: 'integer', minimum: 1 },
    type: { type: 'string', enum: ['income', 'expense', 'transfer'] },
    amount: { type: 'integer', minimum: 1 },
    category_id: { oneOf: [{ type: 'string', format: 'uuid' }, { type: 'null' }] },
    account_id: { oneOf: [{ type: 'string', format: 'uuid' }, { type: 'null' }] },
    to_account_id: { oneOf: [{ type: 'string', format: 'uuid' }, { type: 'null' }] },
    note: { oneOf: [{ type: 'string', maxLength: 200 }, { type: 'null' }] },
    shared_type: {
      oneOf: [{ type: 'string', enum: ['personal', 'shared'] }, { type: 'null' }],
    },
    period: {
      type: 'string',
      enum: ['weekly', 'biweekly', 'monthly', 'bimonthly', 'trimonthly', 'yearly'],
    },
    period_interval: { type: 'integer', minimum: 1 },
    days_of_week: nullableArrayOfInt,
    days_of_month: nullableArrayOfInt,
    year_month_days: nullableArrayOfInt,
    execute_bucket: {
      type: 'string',
      enum: ['dawn', 'morning', 'afternoon', 'night'],
    },
    timezone: { type: 'string' },
    start_date: { type: 'string', format: 'date' },
    end_date: { oneOf: [{ type: 'string', format: 'date' }, { type: 'null' }] },
  },
} as const;

const listQuerySchema = {
  type: 'object',
  properties: {
    status: {
      type: 'string',
      enum: ['active', 'paused', 'ended', 'auto_paused', 'all'],
    },
  },
} as const;

const idParamSchema = {
  type: 'object',
  required: ['id'],
  properties: {
    id: { type: 'string', format: 'uuid' },
  },
} as const;

const deleteQuerySchema = {
  type: 'object',
  required: ['version'],
  properties: {
    version: { type: 'integer', minimum: 1 },
  },
} as const;

// ==============================================================================
// 注册
// ==============================================================================

export interface RegisterRecurringRoutesDeps {
  service: RecurringService;
}

export async function registerRecurringRoutes(
  app: FastifyInstance,
  deps: RegisterRecurringRoutesDeps,
): Promise<void> {
  const { service } = deps;

  // GET /recurring-entries
  app.get<{ Querystring: { status?: string } }>(
    '/recurring-entries',
    { schema: { querystring: listQuerySchema } },
    async (req) => {
      const userId = await parseUserId(req);
      const items = await service.list(userId, req.query.status);
      return { items: items.map(ruleToResponse) };
    },
  );

  // GET /recurring-entries/:id
  app.get<{ Params: { id: string } }>(
    '/recurring-entries/:id',
    { schema: { params: idParamSchema } },
    async (req) => {
      const userId = await parseUserId(req);
      const rule = await service.findById(userId, req.params.id);
      return ruleToResponse(rule);
    },
  );

  // POST /recurring-entries
  app.post<{ Body: CreateRecurringPayload }>(
    '/recurring-entries',
    { schema: { body: createBodySchema } },
    async (req, reply) => {
      const userId = await parseUserId(req);
      const endpoint = 'POST /recurring-entries';
      const cached = await getCachedMutation(req, endpoint, userId);
      if (cached) return sendCachedMutation(reply, cached);

      const rule = await service.create(userId, req.body);
      const body = ruleToResponse(rule);
      await saveMutation(req, endpoint, userId, 201, body);
      return reply.code(201).send(body);
    },
  );

  // PATCH /recurring-entries/:id
  app.patch<{
    Params: { id: string };
    Body: UpdateRecurringPayload & { version: number };
  }>(
    '/recurring-entries/:id',
    { schema: { params: idParamSchema, body: patchBodySchema } },
    async (req, reply) => {
      const userId = await parseUserId(req);
      const endpoint = 'PATCH /recurring-entries/{id}';
      const cached = await getCachedMutation(req, endpoint, userId);
      if (cached) return sendCachedMutation(reply, cached);

      const { version, ...payload } = req.body;
      const rule = await service.update(userId, req.params.id, payload, version);
      const body = ruleToResponse(rule);
      await saveMutation(req, endpoint, userId, 200, body);
      return reply.code(200).send(body);
    },
  );

  // POST /recurring-entries/:id（K3 method-override · wx.request PATCH 降级兜底）
  app.post<{
    Params: { id: string };
    Body: UpdateRecurringPayload & { version: number };
  }>(
    '/recurring-entries/:id',
    { schema: { params: idParamSchema, body: patchBodySchema } },
    async (req, reply) => {
      const override = req.headers['x-http-method-override'];
      if (typeof override === 'string' && override.toUpperCase() === 'PATCH') {
        const userId = await parseUserId(req);
        const endpoint = 'PATCH /recurring-entries/{id}';
        const cached = await getCachedMutation(req, endpoint, userId);
        if (cached) return sendCachedMutation(reply, cached);

        const { version, ...payload } = req.body;
        const rule = await service.update(userId, req.params.id, payload, version);
        const body = ruleToResponse(rule);
        await saveMutation(req, endpoint, userId, 200, body);
        return reply.code(200).send(body);
      }
      reply.code(405).send({
        error: {
          code: 'METHOD_NOT_ALLOWED',
          message: 'POST /recurring-entries/{id} requires X-HTTP-Method-Override: PATCH',
        },
      });
    },
  );

  // POST /recurring-entries/:id/pause
  app.post<{ Params: { id: string } }>(
    '/recurring-entries/:id/pause',
    { schema: { params: idParamSchema } },
    async (req, reply) => {
      const userId = await parseUserId(req);
      const endpoint = 'POST /recurring-entries/{id}/pause';
      const cached = await getCachedMutation(req, endpoint, userId);
      if (cached) return sendCachedMutation(reply, cached);

      const rule = await service.pause(userId, req.params.id);
      const body = ruleToResponse(rule);
      await saveMutation(req, endpoint, userId, 200, body);
      return reply.code(200).send(body);
    },
  );

  // POST /recurring-entries/:id/resume
  app.post<{ Params: { id: string } }>(
    '/recurring-entries/:id/resume',
    { schema: { params: idParamSchema } },
    async (req, reply) => {
      const userId = await parseUserId(req);
      const endpoint = 'POST /recurring-entries/{id}/resume';
      const cached = await getCachedMutation(req, endpoint, userId);
      if (cached) return sendCachedMutation(reply, cached);

      const rule = await service.resume(userId, req.params.id);
      const body = ruleToResponse(rule);
      await saveMutation(req, endpoint, userId, 200, body);
      return reply.code(200).send(body);
    },
  );

  // POST /recurring-entries/:id/copy
  app.post<{ Params: { id: string } }>(
    '/recurring-entries/:id/copy',
    { schema: { params: idParamSchema } },
    async (req, reply) => {
      const userId = await parseUserId(req);
      const endpoint = 'POST /recurring-entries/{id}/copy';
      const cached = await getCachedMutation(req, endpoint, userId);
      if (cached) return sendCachedMutation(reply, cached);

      const rule = await service.copy(userId, req.params.id);
      const body = ruleToResponse(rule);
      await saveMutation(req, endpoint, userId, 201, body);
      return reply.code(201).send(body);
    },
  );

  // DELETE /recurring-entries/:id?version=N
  app.delete<{ Params: { id: string }; Querystring: { version: number } }>(
    '/recurring-entries/:id',
    { schema: { params: idParamSchema, querystring: deleteQuerySchema } },
    async (req, reply) => {
      const userId = await parseUserId(req);
      const endpoint = 'DELETE /recurring-entries/{id}';
      const cached = await getCachedMutation(req, endpoint, userId);
      if (cached) return sendCachedMutation(reply, cached);

      await service.softDelete(userId, req.params.id, Number(req.query.version));
      await saveMutation(req, endpoint, userId, 204, null);
      return reply.code(204).send();
    },
  );
}
