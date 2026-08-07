/**
 * Costra · Server · sync 路由
 *
 * 卡号：COSTRA-104 + COSTRA-154 · 事实源：server/api/openapi.yaml paths /sync/push | /sync/pull
 *
 * 契约约束：
 *   - POST /sync/push body: { ops: [...] } → 200 { results: [...] }
 *   - GET  /sync/pull  query: family_id + since + limit → 200 { watermark, has_more, changes }
 *
 * 业务逻辑：
 *   1. JWT 鉴权
 *   2. Idempotency-Key 查表 → 命中返回缓存（push only）
 *   3. 校验 ops batch（≤ 200 / entity ∈ {entry,category,budget}）
 *   4. 逐条处理 ops（三态：ok/conflict/rejected）
 *   5. 写 idempotency_keys 表
 */

import type { FastifyInstance, FastifyRequest } from 'fastify';
import { createHash } from 'node:crypto';
import { AppError } from '../errors/AppError.js';
import { ErrorCode } from '../errors/ErrorCode.js';
import { createEntryService } from '../services/entryService.js';
import { findByClientRefId } from '../repositories/entryRepo.js';
import { checkAndGet, save } from '../services/idempotencyService.js';
import { syncPull } from '../services/syncPullService.js';
import type { CreateEntryPayload, UpdateEntryPayload } from '../services/entryService.js';

// --- Types ---

interface SyncOp {
  op: 'create' | 'update' | 'delete';
  entity: 'entry' | 'category' | 'budget';
  client_ref_id: string;
  base_version: number | null;
  payload: Record<string, unknown>;
}

interface SyncPushBody {
  ops: SyncOp[];
}

interface SyncPushResult {
  client_ref_id: string;
  status: 'ok' | 'conflict' | 'rejected';
  server_id?: string;
  server_version?: number;
  error?: { code: string; message: string };
}

interface JwtPayload {
  sub: string; // user_id
  iat: number;
  exp: number;
}

async function parseUserIdFromRequest(request: FastifyRequest): Promise<string> {
  try {
    await request.jwtVerify();
  } catch (err: unknown) {
    // jwtVerify throws non-AppError → 转 AppError 让 errorHandler 正确映射 401
    throw new AppError(ErrorCode.UNAUTHENTICATED, { message: 'invalid token' });
  }
  const user = request.user as JwtPayload | undefined;
  if (!user?.sub) {
    throw new AppError(ErrorCode.UNAUTHENTICATED, { message: 'invalid token: missing sub claim' });
  }
  return user.sub;
}

function bodyHash(body: unknown): string {
  return createHash('sha256').update(JSON.stringify(body)).digest('hex');
}

// --- Schema ---

const pullQuerySchema = {
  type: 'object',
  required: ['family_id', 'since'],
  properties: {
    family_id: { type: 'string', format: 'uuid' },
    // BUG-COSTRA-154 v1.2 升级：since 从 ISO date-time 字符串改为 BIGINT change_seq
    //   0 表示首次全量拉取 · 上限 2^53-1（JS Number 安全整数）
    //   事实源：docs/api/sync-protocol.md §6.3 v1.2
    since: { type: 'integer', minimum: 0 },
    limit: { type: 'integer', minimum: 1, maximum: 500, default: 200 },
  },
} as const;

const syncPushBodySchema = {
  type: 'object',
  required: ['ops'],
  additionalProperties: false,
  properties: {
    ops: {
      type: 'array',
      maxItems: 200,
      items: {
        type: 'object',
        required: ['op', 'entity', 'client_ref_id'],
        additionalProperties: true,
        properties: {
          op: { type: 'string', enum: ['create', 'update', 'delete'] },
          entity: { type: 'string', enum: ['entry', 'category', 'budget'] },
          client_ref_id: { type: 'string' },
          base_version: { type: ['integer', 'null'] },
          payload: {
            type: 'object',
            additionalProperties: true,
            properties: {
              ledger_id: { type: 'string', format: 'uuid' },
              category_id: { type: ['string', 'null'], format: 'uuid' },
              shared_type: { type: ['string', 'null'], enum: ['personal', 'shared', null] }, // COSTRA-217 B2
            },
          },
        },
      },
    },
  },
} as const;

// --- Entry 辅助 ---

async function processEntryOp(
  userId: string,
  op: SyncOp,
  entryService: ReturnType<typeof createEntryService>,
): Promise<SyncPushResult> {
  if (op.op === 'create') {
    const payload = op.payload as unknown as CreateEntryPayload;
    const result = await entryService.createWithIdempotency(userId, payload, op.client_ref_id);
    if (result.status === 'ok') {
      return { client_ref_id: op.client_ref_id, status: 'ok', server_id: result.serverId, server_version: result.serverVersion };
    }
    if (result.status === 'conflict') {
      return { client_ref_id: op.client_ref_id, status: 'conflict', server_version: result.serverVersion };
    }
    return { client_ref_id: op.client_ref_id, status: 'rejected', error: result.error };
  }

  if (op.op === 'update') {
    if (op.base_version == null) {
      return { client_ref_id: op.client_ref_id, status: 'rejected', error: { code: ErrorCode.INVALID_ARGUMENT, message: 'update requires base_version' } };
    }
    // 通过 client_ref_id 查找 entry（含权限校验 JOIN families_users）
    const entry = await findByClientRefId(op.client_ref_id, userId);
    if (!entry) {
      return { client_ref_id: op.client_ref_id, status: 'rejected', error: { code: ErrorCode.NOT_FOUND, message: `entry ${op.client_ref_id} not found` } };
    }
    const payload = op.payload as UpdateEntryPayload;
    const result = await entryService.updateWithVersion(userId, entry.id, payload, op.base_version);
    if (result.status === 'ok') {
      return { client_ref_id: op.client_ref_id, status: 'ok', server_id: result.serverId, server_version: result.serverVersion };
    }
    if (result.status === 'conflict') {
      return { client_ref_id: op.client_ref_id, status: 'conflict', server_version: result.serverVersion };
    }
    return { client_ref_id: op.client_ref_id, status: 'rejected', error: result.error };
  }

  // delete — 走 entryService.softDelete（含事务 + 资产旧贡献回退）
  // 直接调 repo 层 softDeleteEntry 会跳过 ledgers.balance_cents 回退
  if (op.base_version == null) {
    return { client_ref_id: op.client_ref_id, status: 'rejected', error: { code: ErrorCode.INVALID_ARGUMENT, message: 'delete requires base_version' } };
  }
  const entry = await findByClientRefId(op.client_ref_id, userId);
  if (!entry) {
    return { client_ref_id: op.client_ref_id, status: 'rejected', error: { code: ErrorCode.NOT_FOUND, message: `entry ${op.client_ref_id} not found` } };
  }
  const result = await entryService.softDelete(userId, entry.id, op.base_version);
  if (result.status === 'ok') {
    return { client_ref_id: op.client_ref_id, status: 'ok', server_id: result.serverId, server_version: result.serverVersion };
  }
  if (result.status === 'conflict') {
    return { client_ref_id: op.client_ref_id, status: 'conflict', server_version: result.serverVersion };
  }
  return { client_ref_id: op.client_ref_id, status: 'rejected', error: result.error };
}

// --- 注册 ---

export async function registerSyncRoutes(app: FastifyInstance): Promise<void> {
  const entryService = createEntryService();
  const SYNC_PUSH_ENDPOINT = '/sync/push';
  const SYNC_PULL_ENDPOINT = '/sync/pull';

  // GET /sync/pull（COSTRA-154 · 替代 stub 501 · v1.2 watermark = BIGINT change_seq）
  app.get<{ Querystring: { family_id: string; since: number; limit?: number } }>(
    SYNC_PULL_ENDPOINT,
    { schema: { querystring: pullQuerySchema } },
    async (req, reply) => {
      const userId = await parseUserIdFromRequest(req);
      const { family_id, since, limit = 200 } = req.query;

      // BUG-COSTRA-154 v1.2 升级：since 是 BIGINT change_seq · fastify schema 已校验 integer + minimum=0
      //   不需要额外解析 · 直接透传到 service 层
      const result = await syncPull({
        userId,
        familyId: family_id,
        since,
        limit,
      });

      reply.code(200).send(result);
    },
  );

  // POST /sync/push
  app.post<{ Body: SyncPushBody }>(
    SYNC_PUSH_ENDPOINT,
    {
      schema: {
        body: syncPushBodySchema,
        headers: {
          type: 'object',
          required: ['idempotency-key'],
          properties: {
            'idempotency-key': { type: 'string', minLength: 1 },
          },
        },
      },
    },
    async (req, reply) => {
      const userId = await parseUserIdFromRequest(req);
      const idempotencyKey = req.headers['idempotency-key'] as string;
      const body = req.body;

      // 校验 ops batch
      if (!body.ops || body.ops.length > 200) {
        throw new AppError(ErrorCode.INVALID_ARGUMENT, {
          message: 'ops must be array with 1-200 items',
          details: { field: 'ops', max: 200 },
        });
      }

      // 计算 body hash
      const reqHash = bodyHash(body);

      // 幂等键查表
      const check = await checkAndGet(idempotencyKey, SYNC_PUSH_ENDPOINT, reqHash);
      if (check.cached) {
        reply.code(check.cached.statusCode).send(check.cached.body);
        return;
      }

      // 逐条处理 ops（不开 batch transaction，每条独立事务）
      const results: SyncPushResult[] = [];
      for (const op of body.ops) {
        if (op.entity === 'entry') {
          const result = await processEntryOp(userId, op, entryService);
          results.push(result);
        } else {
          // category / budget → rejected（不在本卡范围）
          results.push({
            client_ref_id: op.client_ref_id,
            status: 'rejected',
            error: {
              code: ErrorCode.NOT_IMPLEMENTED,
              message: `${op.entity} op deferred to later cards`,
            },
          });
        }
      }

      const responseBody = { results };
      const responseStatus = 200;

      // 写幂等键（写入后即使重复请求也不会出错）
      await save({
        key: idempotencyKey,
        endpoint: SYNC_PUSH_ENDPOINT,
        actorUserId: userId,
        requestHash: reqHash,
        responseStatus,
        responseBody,
      });

      reply.code(200).send(responseBody);
    },
  );
}
