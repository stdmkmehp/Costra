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
 *   - POST   /families/invites/accept          → 200 Family
 *   - DELETE /families/{family_id}/members/{user_id} → 204
 *
 * 路由层只做 "HTTP 参数解析 / 响应装配"，业务编排统一交给 familyService。
 * 幂等处理：POST/DELETE mutating endpoint 复用 idempotencyService。
 */

import type { FastifyInstance, FastifyRequest } from 'fastify';
import { createHash } from 'node:crypto';
import { AppError } from '../errors/AppError.js';
import { ErrorCode } from '../errors/ErrorCode.js';
import * as familyService from '../services/familyService.js';
import * as idempotencyService from '../services/idempotencyService.js';
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
  app.patch<{ Params: { family_id: string }; Body: { name?: string; version: number } }>(
    '/families/:family_id',
    { schema: { params: familyIdParamSchema, body: updateFamilyBodySchema } },
    async (req, reply) => {
      const userId = await parseUserId(req);
      const result = await familyService.updateFamily(userId, req.params.family_id, req.body);
      reply.code(200).send(result);
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
}
