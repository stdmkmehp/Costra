/**
 * Costra · Server · ledgers 路由
 *
 * 卡号：COSTRA-4xx · 事实源：server/api/openapi.yaml paths /ledgers/{id}/balance
 *
 * 契约约束：
 *   - GET   /ledgers/{id}/balance  → 200 { balance_cents, balance_baseline_seq, balance_version }
 *       → 404 账本不存在 · 403 非 active 成员（防越权读取）
 *   - PATCH /ledgers/{id}/balance  body: { balance_cents, balance_version }
 *       → 200 { balance_cents, balance_baseline_seq, balance_version }
 *       → 409 VERSION_CONFLICT（含 current_balance_* 便于客户端弹冲突弹窗）
 *
 * 路由层只做 "HTTP 参数解析 / 响应装配"，业务编排统一交给 ledgerService。
 */

import type { FastifyInstance, FastifyRequest } from 'fastify';
import { AppError } from '../errors/AppError.js';
import { ErrorCode } from '../errors/ErrorCode.js';
import * as ledgerService from '../services/ledgerService.js';

interface JwtPayload { sub: string; iat: number; exp: number }

async function parseUserId(request: FastifyRequest): Promise<string> {
  try {
    await request.jwtVerify();
  } catch (err: unknown) {
    throw new AppError(ErrorCode.UNAUTHENTICATED, { message: 'invalid token' });
  }
  const user = request.user as JwtPayload | undefined;
  if (!user?.sub) throw new AppError(ErrorCode.UNAUTHENTICATED, { message: 'invalid token' });
  return user.sub;
}

// --- Schema ---

const ledgerIdParamsSchema = {
  type: 'object',
  required: ['ledger_id'],
  properties: {
    ledger_id: { type: 'string', format: 'uuid' },
  },
} as const;

const patchBalanceBodySchema = {
  type: 'object',
  required: ['balance_cents', 'balance_version'],
  additionalProperties: false,
  properties: {
    balance_cents: { type: 'integer', description: '新的资产净值（分）· 允许负数' },
    balance_version: { type: 'integer', minimum: 1, description: '客户端持有的当前 balance_version（乐观锁）' },
  },
} as const;

// --- 注册 ---

export async function registerLedgersRoutes(app: FastifyInstance): Promise<void> {
  // GET /ledgers/{ledger_id}/balance —— 客户端主动拉取资产（明细页首屏校准）
  // 与 sync-pull 下发的 ledgers[] 增量互为补充：首屏无需等 sync，主动拉最新值即时渲染
  app.get<{ Params: { ledger_id: string } }>(
    '/ledgers/:ledger_id/balance',
    { schema: { params: ledgerIdParamsSchema } },
    async (req, reply) => {
      const userId = await parseUserId(req);
      const { ledger_id: ledgerId } = req.params;

      const result = await ledgerService.getBalanceForUser(userId, ledgerId);

      reply.code(200).send(result);
    },
  );

  // PATCH /ledgers/{ledger_id}/balance —— 用户修改资产
  app.patch<{ Params: { ledger_id: string }; Body: { balance_cents: number; balance_version: number } }>(
    '/ledgers/:ledger_id/balance',
    { schema: { params: ledgerIdParamsSchema, body: patchBalanceBodySchema } },
    async (req, reply) => {
      const userId = await parseUserId(req);
      const { ledger_id: ledgerId } = req.params;
      const { balance_cents: newBalanceCents, balance_version: clientBaseVersion } = req.body;

      const result = await ledgerService.rebaseBalance(userId, {
        ledgerId,
        newBalanceCents,
        clientBaseVersion,
      });

      req.log.info(
        {
          action: 'ledger.balance.rebase',
          userId,
          ledgerId,
          newBalanceCents,
          newBaselineSeq: result.balance_baseline_seq,
          newBalanceVersion: result.balance_version,
        },
        'ledger balance rebased',
      );

      reply.code(200).send(result);
    },
  );
}
