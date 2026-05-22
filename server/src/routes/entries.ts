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

interface JwtPayload { sub: string; iat: number; exp: number }

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
        reply.code(201).send({
          id: entry.id,
          ledger_id: entry.ledgerId,
          amount: entry.amount,
          currency: entry.currency,
          type: entry.type,
          category_id: entry.categoryId,
          account_id: entry.accountId,
          to_account_id: entry.toAccountId,
          note: entry.note,
          occurred_at: entry.occurredAt.toISOString(),
          created_by: entry.createdBy,
          created_at: entry.createdAt.toISOString(),
          updated_at: entry.updatedAt.toISOString(),
          deleted_at: entry.deletedAt?.toISOString() ?? null,
          version: entry.version,
          client_ref_id: entry.clientRefId,
        });
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
      reply.code(200).send({
        id: entry.id,
        ledger_id: entry.ledgerId,
        amount: entry.amount,
        currency: entry.currency,
        type: entry.type,
        category_id: entry.categoryId,
        account_id: entry.accountId,
        to_account_id: entry.toAccountId,
        note: entry.note,
        occurred_at: entry.occurredAt.toISOString(),
        created_by: entry.createdBy,
        created_at: entry.createdAt.toISOString(),
        updated_at: entry.updatedAt.toISOString(),
        deleted_at: entry.deletedAt?.toISOString() ?? null,
        version: entry.version,
        client_ref_id: entry.clientRefId,
      });
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
      reply.code(200).send({
        id: entry.id,
        ledger_id: entry.ledgerId,
        amount: entry.amount,
        currency: entry.currency,
        type: entry.type,
        category_id: entry.categoryId,
        account_id: entry.accountId,
        to_account_id: entry.toAccountId,
        note: entry.note,
        occurred_at: entry.occurredAt.toISOString(),
        created_by: entry.createdBy,
        created_at: entry.createdAt.toISOString(),
        updated_at: entry.updatedAt.toISOString(),
        deleted_at: entry.deletedAt?.toISOString() ?? null,
        version: entry.version,
        client_ref_id: entry.clientRefId,
      });
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

  // DELETE /entries/{entry_id} stub（切出去 3 件套铁律）
  // 注意：测试 T10 不带 content-type header，Fastify 不会尝试解析 JSON body
  app.delete('/entries/:entry_id', async (_req, reply) => {
    reply.code(501).send({
      error: {
        code: 'NOT_IMPLEMENTED',
        message: 'DELETE /entries/{id} deferred to COSTRA-153',
          details: {
            deferred_card: 'COSTRA-153',
            followup_id: 'FU-104-ENTRIES-DELETE',
          },
      },
    });
  });
}
