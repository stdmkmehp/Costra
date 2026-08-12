/**
 * Costra · Server · families 路由
 *
 * 卡号：COSTRA-221
 * 事实源：server/api/openapi.yaml paths /families*
 *
 * 契约约束：
 *   - GET    /families                         → 200 Family[]
 *   - POST   /families                         → 201 Family
 *   - GET    /families/{family_id}             → 200 FamilyDetail
 *   - PATCH  /families/{family_id}             → 200 Family
 *   - DELETE /families/{family_id}             → 204
 *   - GET    /families/{family_id}/members     → 200 FamilyMember[]
 *   - POST   /families/{family_id}/invites     → 201 FamilyInvite
 *   - GET    /families/invites/preview         → 200 FamilyInvitePreview
 *   - POST   /families/invites/accept          → 200 Family
 *   - DELETE /families/{family_id}/members/{user_id} → 204
 *
 * 路由层只做 "HTTP 参数解析 / 响应装配"，业务编排统一交给 familyService。
 * 幂等处理：POST/DELETE mutating endpoint 复用 idempotencyService。
 */

import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { createHash } from 'node:crypto';
import { AppError } from '../errors/AppError.js';
import { ErrorCode } from '../errors/ErrorCode.js';
import * as familyService from '../services/familyService.js';
import * as idempotencyService from '../services/idempotencyService.js';
import * as familySummaryService from '../services/familySummaryService.js';
import type { FamilyRole } from '../repositories/familyMemberRepo.js';

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

/**
 * 幂等辅助：检查 Idempotency-Key，命中则返回缓存响应；未命中返回 null
 */
async function checkIdempotency(
  req: FastifyRequest,
  endpoint: string,
): Promise<{ cached: { statusCode: number; body: unknown } } | null> {
  const key = req.headers['idempotency-key'] as string | undefined;
  if (!key) return null;

  const bodyHash = createHash('sha256')
    .update(JSON.stringify(req.body ?? {}))
    .digest('hex');

  const result = await idempotencyService.checkAndGet(key, endpoint, bodyHash);
  return result.cached ? { cached: result.cached } : null;
}

/**
 * 幂等辅助：保存响应到幂等缓存
 */
async function saveIdempotency(
  req: FastifyRequest,
  endpoint: string,
  userId: string,
  statusCode: number,
  body: unknown,
): Promise<void> {
  const key = req.headers['idempotency-key'] as string | undefined;
  if (!key) return;

  const bodyHash = createHash('sha256')
    .update(JSON.stringify(req.body ?? {}))
    .digest('hex');

  await idempotencyService.save({
    key,
    endpoint,
    actorUserId: userId,
    requestHash: bodyHash,
    responseStatus: statusCode,
    responseBody: body,
  });
}

// --- Schema 定义 ---

const createFamilyBodySchema = {
  type: 'object',
  required: ['name'],
  additionalProperties: false,
  properties: {
    name: { type: 'string', maxLength: 32 },
  },
} as const;

const updateFamilyBodySchema = {
  type: 'object',
  required: ['version'],
  additionalProperties: false,
  properties: {
    name: { type: 'string', maxLength: 32 },
    version: { type: 'integer', minimum: 1 },
  },
} as const;

const deleteFamilyQuerySchema = {
  type: 'object',
  required: ['version'],
  additionalProperties: false,
  properties: {
    version: { type: 'integer', minimum: 1 },
  },
} as const;

const createInviteBodySchema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    role: { type: 'string', enum: ['member', 'viewer'] },
    ttl_hours: { type: 'integer', minimum: 1, maximum: 168 },
  },
} as const;

const acceptInviteBodySchema = {
  type: 'object',
  required: ['invite_token'],
  additionalProperties: false,
  properties: {
    invite_token: { type: 'string' },
  },
} as const;

const previewInviteQuerySchema = {
  type: 'object',
  required: ['token'],
  additionalProperties: false,
  properties: {
    token: { type: 'string' },
  },
} as const;

const familyIdParamSchema = {
  type: 'object',
  required: ['family_id'],
  additionalProperties: false,
  properties: {
    family_id: { type: 'string', format: 'uuid' },
  },
} as const;

const memberIdParamSchema = {
  type: 'object',
  required: ['family_id', 'user_id'],
  additionalProperties: false,
  properties: {
    family_id: { type: 'string', format: 'uuid' },
    user_id: { type: 'string', format: 'uuid' },
  },
} as const;

const inviteIdParamSchema = {
  type: 'object',
  required: ['family_id', 'invite_id'],
  additionalProperties: false,
  properties: {
    family_id: { type: 'string', format: 'uuid' },
    invite_id: { type: 'string', format: 'uuid' },
  },
} as const;

const summaryQuerySchema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    month: { type: 'string', pattern: '^\\d{4}-\\d{2}$' },
    year: { type: 'string', pattern: '^\\d{4}$' },
    top_n: { type: 'integer', minimum: 1, maximum: 20 },
  },
} as const;

const summaryDrillDownQuerySchema = {
  type: 'object',
  required: ['l1_category_id'],
  additionalProperties: false,
  properties: {
    month: { type: 'string', pattern: '^\\d{4}-\\d{2}$' },
    year: { type: 'string', pattern: '^\\d{4}$' },
    l1_category_id: { type: 'string', format: 'uuid' },
    shared_type: { type: 'string', enum: ['shared', 'personal'] },
    user_id: { type: 'string', format: 'uuid' },
    limit: { type: 'integer', minimum: 1, maximum: 50 },
    entry_type: { type: 'string', enum: ['expense', 'income'] },
  },
} as const;

// --- 注册 ---

export async function registerFamiliesRoutes(app: FastifyInstance): Promise<void> {
  // GET /families
  app.get('/families', async (req, reply) => {
    const userId = await parseUserId(req);
    const families = await familyService.listFamilies(userId);
    reply.code(200).send(families);
  });

  // POST /families
  app.post<{ Body: { name: string } }>(
    '/families',
    { schema: { body: createFamilyBodySchema } },
    async (req, reply) => {
      const userId = await parseUserId(req);

      // 幂等检查
      const cached = await checkIdempotency(req, 'POST /families');
      if (cached) {
        reply.code(cached.cached.statusCode).send(cached.cached.body);
        return;
      }

      const result = await familyService.createFamily(userId, req.body);
      await saveIdempotency(req, 'POST /families', userId, 201, result);
      reply.code(201).send(result);
    },
  );

  // GET /families/{family_id}
  app.get<{ Params: { family_id: string } }>(
    '/families/:family_id',
    { schema: { params: familyIdParamSchema } },
    async (req, reply) => {
      const userId = await parseUserId(req);
      const result = await familyService.getFamilyDetail(userId, req.params.family_id);
      reply.code(200).send(result);
    },
  );

  // PATCH /families/{family_id}
  const handlePatchFamily = async (req: FastifyRequest<{ Params: { family_id: string }; Body: { name?: string; version: number } }>, reply: FastifyReply) => {
    const userId = await parseUserId(req);
    const result = await familyService.updateFamily(userId, req.params.family_id, req.body);
    reply.code(200).send(result);
  };

  app.patch<{ Params: { family_id: string }; Body: { name?: string; version: number } }>(
    '/families/:family_id',
    { schema: { params: familyIdParamSchema, body: updateFamilyBodySchema } },
    handlePatchFamily,
  );

  // POST /families/{family_id}（K3 method-override · wx.request 不支持 PATCH）
  app.post<{ Params: { family_id: string }; Body: { name?: string; version: number } }>(
    '/families/:family_id',
    { schema: { params: familyIdParamSchema, body: updateFamilyBodySchema } },
    async (req, reply) => {
      const override = req.headers['x-http-method-override'];
      if (typeof override === 'string' && override.toUpperCase() === 'PATCH') {
        return handlePatchFamily(req, reply);
      }
      reply.code(405).send({
        error: {
          code: 'METHOD_NOT_ALLOWED',
          message: 'POST /families/{id} requires X-HTTP-Method-Override: PATCH',
        },
      });
    },
  );

  // DELETE /families/{family_id}
  app.delete<{ Params: { family_id: string }; Querystring: { version: number } }>(
    '/families/:family_id',
    { schema: { params: familyIdParamSchema, querystring: deleteFamilyQuerySchema } },
    async (req, reply) => {
      const userId = await parseUserId(req);

      // 幂等检查
      const cached = await checkIdempotency(req, 'DELETE /families/{family_id}');
      if (cached) {
        reply.code(cached.cached.statusCode).send(cached.cached.body);
        return;
      }

      await familyService.deleteFamily(userId, req.params.family_id, req.query.version);
      await saveIdempotency(req, 'DELETE /families/{family_id}', userId, 204, null);
      reply.code(204).send();
    },
  );

  // GET /families/{family_id}/members
  app.get<{ Params: { family_id: string } }>(
    '/families/:family_id/members',
    { schema: { params: familyIdParamSchema } },
    async (req, reply) => {
      const userId = await parseUserId(req);
      const result = await familyService.listMembers(userId, req.params.family_id);
      reply.code(200).send(result);
    },
  );

  // GET /families/{family_id}/summary
  // COSTRA-222 + COSTRA-300: 家庭月度/年度财务聚合
  app.get<{ Params: { family_id: string }; Querystring: { month?: string; year?: string; top_n?: number } }>(
    '/families/:family_id/summary',
    { schema: { params: familyIdParamSchema, querystring: summaryQuerySchema } },
    async (req, reply) => {
      const userId = await parseUserId(req);
      const result = await familySummaryService.getFamilySummary(userId, {
        familyId: req.params.family_id,
        month: req.query.month,
        year: req.query.year,
        topN: req.query.top_n,
      });
      reply.code(200).send(result);
    },
  );

  // GET /families/{family_id}/summary/drill-down
  // COSTRA-302: 协作页家庭汇总三级下钻
  // entry_type=income 时 shared_type 不传（收入无此语义）；entry_type=expense（默认）时 shared_type 必填
  app.get<{ Params: { family_id: string }; Querystring: { month?: string; year?: string; l1_category_id: string; shared_type?: 'shared' | 'personal'; user_id?: string; limit?: number; entry_type?: 'expense' | 'income' } }>(
    '/families/:family_id/summary/drill-down',
    { schema: { params: familyIdParamSchema, querystring: summaryDrillDownQuerySchema } },
    async (req, reply) => {
      const userId = await parseUserId(req);
      const entryType = req.query.entry_type ?? 'expense';
      // income 模式下 shared_type 无语义，传 'personal' 占位（service 层不看此字段）；
      // expense 模式下透传 shared_type（缺失时由 service 层抛 INVALID_ARGUMENT）
      const sharedType = entryType === 'income' ? 'personal' : (req.query.shared_type ?? 'personal');
      const result = await familySummaryService.getSummaryDrillDown(userId, {
        familyId: req.params.family_id,
        month: req.query.month,
        year: req.query.year,
        l1CategoryId: req.query.l1_category_id,
        sharedType,
        userId: req.query.user_id,
        limit: req.query.limit,
        entryType,
      });
      reply.code(200).send(result);
    },
  );

  // POST /families/{family_id}/invites
  app.post<{ Params: { family_id: string }; Body: { role?: FamilyRole; ttl_hours?: number } }>(
    '/families/:family_id/invites',
    { schema: { params: familyIdParamSchema, body: createInviteBodySchema } },
    async (req, reply) => {
      const userId = await parseUserId(req);

      // 幂等检查
      const cached = await checkIdempotency(req, 'POST /families/{family_id}/invites');
      if (cached) {
        reply.code(cached.cached.statusCode).send(cached.cached.body);
        return;
      }

      const result = await familyService.createInvite(userId, req.params.family_id, {
        role: req.body.role,
        ttlHours: req.body.ttl_hours,
      });
      await saveIdempotency(req, 'POST /families/{family_id}/invites', userId, 201, result);
      reply.code(201).send(result);
    },
  );

  // DELETE /families/{family_id}/invites/{invite_id}
  app.delete<{ Params: { family_id: string; invite_id: string } }>(
    '/families/:family_id/invites/:invite_id',
    { schema: { params: inviteIdParamSchema } },
    async (req, reply) => {
      const userId = await parseUserId(req);
      await familyService.revokeInvite(userId, req.params.family_id, req.params.invite_id);
      reply.code(204).send();
    },
  );

  // GET /families/invites/preview
  // ⚠️ 必须在 /families/:family_id 之前注册，避免 Fastify 将 'invites' 当作 family_id 参数匹配
  app.get<{ Querystring: { token: string } }>(
    '/families/invites/preview',
    { schema: { querystring: previewInviteQuerySchema } },
    async (req, reply) => {
      // 需要登录（确保被邀请方已完成微信认证）
      await parseUserId(req);
      const result = await familyService.previewInvite({ invite_token: req.query.token });
      reply.code(200).send(result);
    },
  );

  // POST /families/invites/accept
  app.post<{ Body: { invite_token: string } }>(
    '/families/invites/accept',
    { schema: { body: acceptInviteBodySchema } },
    async (req, reply) => {
      const userId = await parseUserId(req);

      // 幂等检查
      const cached = await checkIdempotency(req, 'POST /families/invites/accept');
      if (cached) {
        reply.code(cached.cached.statusCode).send(cached.cached.body);
        return;
      }

      const result = await familyService.acceptInvite(userId, req.body);
      await saveIdempotency(req, 'POST /families/invites/accept', userId, 200, result);
      reply.code(200).send(result);
    },
  );

  // DELETE /families/{family_id}/members/{user_id}
  app.delete<{ Params: { family_id: string; user_id: string } }>(
    '/families/:family_id/members/:user_id',
    { schema: { params: memberIdParamSchema } },
    async (req, reply) => {
      const userId = await parseUserId(req);
      await familyService.removeMember(userId, req.params.family_id, req.params.user_id);
      reply.code(204).send();
    },
  );

  // POST /families/{family_id}/members/me/leave
  // COSTRA-229 / D-029 §2.1: 当前用户主动离开 family
  // 语义：非 owner 直接 leave；owner 多人触发自动移交；owner 单人触发自动解散
  app.post<{ Params: { family_id: string } }>(
    '/families/:family_id/members/me/leave',
    { schema: { params: familyIdParamSchema } },
    async (req, reply) => {
      const userId = await parseUserId(req);

      // 幂等检查（与 POST /families 同范式：用户重试不会触发二次自动解散）
      const cached = await checkIdempotency(req, 'POST /families/{family_id}/members/me/leave');
      if (cached) {
        reply.code(cached.cached.statusCode).send(cached.cached.body);
        return;
      }

      await familyService.leaveFamily(userId, req.params.family_id);
      await saveIdempotency(req, 'POST /families/{family_id}/members/me/leave', userId, 204, null);
      reply.code(204).send();
    },
  );
}
