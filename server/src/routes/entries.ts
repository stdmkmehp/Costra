/**
 * Costra · Server · entries 路由
 *
 * 卡号：COSTRA-104 / COSTRA-152 / COSTRA-153
 * 事实源：server/api/openapi.yaml paths /entries | /entries/{entry_id}
 *
 * 契约约束：
 *   - POST   /entries       body: EntryCreate  → 201 Entry
 *   - GET    /entries       query: ledger_id/limit/cursor/... → 200 { entries, next_cursor }
 *   - GET    /entries/{id}  → 200 Entry | 404 NotFound
 *   - PATCH  /entries/{id}  body: EntryUpdate  → 200 Entry | 409 Conflict（COSTRA-152 R1）
 *   - DELETE /entries/{id}  query: version=N    → 204 No Content | 409 Conflict（COSTRA-153 R1）
 *
 * 路由层只做 "HTTP 参数解析 / 响应装配"，业务编排统一交给 entryService。
 */

import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { AppError } from '../errors/AppError.js';
import { ErrorCode } from '../errors/ErrorCode.js';
import { createEntryService } from '../services/entryService.js';
import type { CreateEntryPayload, UpdateEntryPayload } from '../services/entryService.js';
import type { EntryEntity } from '../repositories/entryRepo.js';

interface JwtPayload { sub: string; iat: number; exp: number }

/**
 * COSTRA-217: 统一 Entry → wire 响应映射
 * 含 shared_type 字段（B2）
 */
function entryToResponse(e: EntryEntity) {
  return {
    id: e.id,
    ledger_id: e.ledgerId,
    amount: e.amount,
    currency: e.currency,
    type: e.type,
    category_id: e.categoryId,
    account_id: e.accountId,
    to_account_id: e.toAccountId,
    note: e.note,
    occurred_at: e.occurredAt.toISOString(),
    created_by: e.createdBy,
    created_at: e.createdAt.toISOString(),
    updated_at: e.updatedAt.toISOString(),
    deleted_at: e.deletedAt?.toISOString() ?? null,
    version: e.version,
    client_ref_id: e.clientRefId,
    shared_type: e.sharedType, // COSTRA-217 B2
  };
}

async function parseUserId(request: FastifyRequest): Promise<string> {
  try {
    await request.jwtVerify();
  } catch (err: unknown) {
    // jwtVerify throws non-AppError → 转 AppError 让 errorHandler 正确映射 401
    throw new AppError(ErrorCode.UNAUTHENTICATED, { message: 'invalid token' });
  }
  const user = request.user as JwtPayload | undefined;
  if (!user?.sub) throw new AppError(ErrorCode.UNAUTHENTICATED, { message: 'invalid token' });
  return user.sub;
}

// --- Schema 定义 ---

const createEntryBodySchema = {
  type: 'object',
  required: ['ledger_id', 'amount', 'type', 'occurred_at'],
  additionalProperties: false,
  properties: {
    ledger_id: { type: 'string', format: 'uuid' },
    amount: { type: 'integer', minimum: 1 },
    currency: { type: 'string', default: 'CNY' },
    type: { type: 'string', enum: ['income', 'expense', 'transfer'] },
    category_id: { type: 'string', format: 'uuid' },
    account_id: { type: 'string', format: 'uuid' },
    to_account_id: { type: 'string', format: 'uuid' },
    note: { type: 'string', maxLength: 200 },
    occurred_at: { type: 'string', format: 'date-time' },
    client_ref_id: { type: 'string' },
    shared_type: { type: 'string', enum: ['personal', 'shared'], nullable: true }, // COSTRA-217 B2
  },
} as const;

const listEntriesQuerySchema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    ledger_id: { type: 'string', format: 'uuid' },
    category_id: { type: 'string', format: 'uuid' },
    type: { type: 'string', enum: ['income', 'expense', 'transfer'] },
    from: { type: 'string', format: 'date-time' },
    to: { type: 'string', format: 'date-time' },
    cursor: { type: 'string' },
    limit: { type: 'integer', minimum: 1, maximum: 100, default: 20 },
  },
} as const;

const entryIdParamsSchema = {
  type: 'object',
  required: ['entry_id'],
  properties: {
    entry_id: { type: 'string', format: 'uuid' },
  },
} as const;

// COSTRA-152: PATCH /entries/{entry_id} body schema（参 EntryUpdate · required: ['version']）
const patchEntryBodySchema = {
  type: 'object',
  required: ['version'],
  additionalProperties: false,
  properties: {
    amount: { type: 'integer', minimum: 1 },
    category_id: { type: 'string', format: 'uuid' },
    note: { type: 'string', maxLength: 200 },
    occurred_at: { type: 'string', format: 'date-time' },
    shared_type: { type: 'string', enum: ['personal', 'shared'], nullable: true }, // COSTRA-217 B2
    version: { type: 'integer', minimum: 1 },
  },
} as const;

// COSTRA-153: DELETE /entries/{entry_id} query schema（required: ['version']）
const deleteEntryQuerySchema = {
  type: 'object',
  required: ['version'],
  properties: {
    version: { type: 'integer', minimum: 1 },
  },
} as const;

// --- 注册 ---

export async function registerEntriesRoutes(app: FastifyInstance): Promise<void> {
  const entryService = createEntryService();

  // POST /entries（直接同步创建）
  app.post<{ Body: CreateEntryPayload }>(
    '/entries',
    {
      schema: { body: createEntryBodySchema },
    },
    async (req, reply) => {
      const userId = await parseUserId(req);
      const result = await entryService.createWithIdempotency(
        userId,
        req.body,
        req.body.client_ref_id,
      );
      if (result.status === 'ok') {
        const entry = await entryService.findById(userId, result.serverId);
        req.log.info(
          {
            action: 'entry.create',
            userId,
            entryId: entry.id,
            ledgerId: entry.ledgerId,
            type: entry.type,
            amount: entry.amount,
            currency: entry.currency,
            categoryId: entry.categoryId,
            accountId: entry.accountId,
            toAccountId: entry.toAccountId,
            occurredAt: entry.occurredAt.toISOString(),
            note: entry.note,
            sharedType: entry.sharedType,
            version: entry.version,
            clientRefId: entry.clientRefId,
          },
          'entry created',
        );
        reply.code(201).send(entryToResponse(entry));
        return;
      }
      if (result.status === 'conflict') {
        throw new AppError(ErrorCode.VERSION_CONFLICT, {
          message: 'entry already exists with same client_ref_id',
          details: { server_version: result.serverVersion },
        });
      }
      throw new AppError(ErrorCode.INVALID_ARGUMENT, { message: result.error.message });
    },
  );

  // GET /entries（游标分页）
  app.get<{ Querystring: { ledger_id?: string; category_id?: string; type?: string; from?: string; to?: string; cursor?: string; limit?: number } }>(
    '/entries',
    { schema: { querystring: listEntriesQuerySchema } },
    async (req, reply) => {
      const userId = await parseUserId(req);
      const { ledger_id, category_id, type, from, to, cursor, limit = 20 } = req.query;
      const result = await entryService.list(
        userId,
        { ledger_id, category_id, type: type as 'income' | 'expense' | 'transfer' | undefined, from, to },
        cursor ?? null,
        limit,
      );
      reply.code(200).send(result);
    },
  );

  // GET /entries/{entry_id}
  app.get<{ Params: { entry_id: string } }>(
    '/entries/:entry_id',
    { schema: { params: { type: 'object', required: ['entry_id'], properties: { entry_id: { type: 'string', format: 'uuid' } } } } },
    async (req, reply) => {
      const userId = await parseUserId(req);
      const entry = await entryService.findById(userId, req.params.entry_id);
      reply.code(200).send(entryToResponse(entry));
    },
  );

  // PATCH /entries/{entry_id}（COSTRA-152 R1 · 替代 stub 501）
  const PATCH_ENTRIES_ENDPOINT = '/entries/:entry_id';

  async function handlePatchEntry(
    req: FastifyRequest<{ Params: { entry_id: string }; Body: { version: number; amount?: number; category_id?: string; note?: string; occurred_at?: string } }>,
    reply: FastifyReply,
  ) {
    const userId = await parseUserId(req);
    const { entry_id: entryId } = req.params;
    const { version: baseVersion, ...payload } = req.body;

    const result = await entryService.updateWithVersion(userId, entryId, payload as UpdateEntryPayload, baseVersion);

    if (result.status === 'ok') {
      const entry = await entryService.findById(userId, result.serverId);
      req.log.info(
        {
          action: 'entry.update',
          userId,
          entryId: entry.id,
          ledgerId: entry.ledgerId,
          baseVersion,
          newVersion: entry.version,
          changedFields: Object.keys(payload),
          amount: entry.amount,
          currency: entry.currency,
          type: entry.type,
          categoryId: entry.categoryId,
          occurredAt: entry.occurredAt.toISOString(),
          note: entry.note,
          sharedType: entry.sharedType,
        },
        'entry updated',
      );
      reply.code(200).send(entryToResponse(entry));
      return;
    }
    if (result.status === 'conflict') {
      throw new AppError(ErrorCode.VERSION_CONFLICT, {
        message: 'version conflict',
        details: { server_version: result.serverVersion },
      });
    }
    throw new AppError(ErrorCode.INVALID_ARGUMENT, { message: result.error.message });
  }

  app.patch<{ Params: { entry_id: string }; Body: { version: number; amount?: number; category_id?: string; note?: string; occurred_at?: string } }>(
    PATCH_ENTRIES_ENDPOINT,
    { schema: { params: entryIdParamsSchema, body: patchEntryBodySchema } },
    handlePatchEntry,
  );

  // POST /entries/{entry_id}（K3 method-override · COSTRA-152 §LINKAGE 决策 1）
  app.post<{ Params: { entry_id: string }; Body: { version: number; amount?: number; category_id?: string; note?: string; occurred_at?: string } }>(
    PATCH_ENTRIES_ENDPOINT,
    { schema: { params: entryIdParamsSchema, body: patchEntryBodySchema } },
    async (req, reply) => {
      const override = req.headers['x-http-method-override'];
      if (typeof override === 'string' && override.toUpperCase() === 'PATCH') {
        return handlePatchEntry(req, reply);
      }
      reply.code(405).send({
        error: {
          code: 'METHOD_NOT_ALLOWED',
          message: 'POST /entries/{id} requires X-HTTP-Method-Override: PATCH',
        },
      });
    },
  );

  // DELETE /entries/{entry_id}（COSTRA-153 R1 · 替代 stub 501）
  const DELETE_ENTRIES_ENDPOINT = '/entries/:entry_id';

  app.delete<{ Params: { entry_id: string }; Querystring: { version: number } }>(
    DELETE_ENTRIES_ENDPOINT,
    { schema: { params: entryIdParamsSchema, querystring: deleteEntryQuerySchema } },
    async (req, reply) => {
      const userId = await parseUserId(req);
      const { entry_id: entryId } = req.params;
      const { version: baseVersion } = req.query;

      const result = await entryService.softDelete(userId, entryId, baseVersion);

      if (result.status === 'ok') {
        req.log.info(
          { action: 'entry.delete', userId, entryId, baseVersion },
          'entry deleted',
        );
        reply.code(204).send();
        return;
      }
      if (result.status === 'conflict') {
        throw new AppError(ErrorCode.VERSION_CONFLICT, {
          message: 'version conflict',
          details: { server_version: result.serverVersion },
        });
      }
      throw new AppError(ErrorCode.INVALID_ARGUMENT, { message: result.error.message });
    },
  );
}
