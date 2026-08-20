/**
 * Costra · Server · budgets 路由
 *
 * 卡号：COSTRA-4xx · 事实源：server/api/openapi.yaml paths /budgets
 *
 * 契约约束：
 *   - GET  /budgets?ledger_id=X&month=YYYY-MM
 *       → 200 BudgetView（含 amount / spent / remain）
 *       → 200 + JSON null 未设置预算（查询语义端点不用 404 表达预期空态）
 *       → 404 仅 ledger 不存在等真寻址失败
 *   - PUT  /budgets  body: { ledger_id, month, amount_cents, version? }
 *       → 200 BudgetView
 *       → 409 VERSION_CONFLICT（version 不匹配）
 *
 * 路由层只做 "HTTP 参数解析 / 响应装配"，业务编排统一交给 budgetService。
 */

import type { FastifyInstance, FastifyRequest } from 'fastify';
import { AppError } from '../errors/AppError.js';
import { ErrorCode } from '../errors/ErrorCode.js';
import * as budgetService from '../services/budgetService.js';
import type { BudgetResult } from '../services/budgetService.js';

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

function budgetToResponse(b: BudgetResult) {
  return {
    id: b.id,
    ledger_id: b.ledger_id,
    month: b.month,
    amount_cents: b.amount_cents,
    spent_cents: b.spent_cents,
    remain_cents: b.remain_cents,
    currency: b.currency,
    version: b.version,
  };
}

// --- Schema ---

const getBudgetQuerySchema = {
  type: 'object',
  required: ['ledger_id', 'month'],
  additionalProperties: false,
  properties: {
    ledger_id: { type: 'string', format: 'uuid' },
    month: { type: 'string', pattern: '^[0-9]{4}-[0-9]{2}$' },
  },
} as const;

const putBudgetBodySchema = {
  type: 'object',
  required: ['ledger_id', 'month', 'amount_cents'],
  additionalProperties: false,
  properties: {
    ledger_id: { type: 'string', format: 'uuid' },
    month: { type: 'string', pattern: '^[0-9]{4}-[0-9]{2}$' },
    amount_cents: { type: 'integer', minimum: 0, description: '预算上限（分）· 0 表示不设预算' },
    version: { type: ['integer', 'null'], minimum: 1, description: '可选 · 当前版本（修改已存在的预算时传）' },
  },
} as const;

// --- 注册 ---

export async function registerBudgetsRoutes(app: FastifyInstance): Promise<void> {
  // GET /budgets?ledger_id=X&month=YYYY-MM
  app.get<{ Querystring: { ledger_id: string; month: string } }>(
    '/budgets',
    { schema: { querystring: getBudgetQuerySchema } },
    async (req, reply) => {
      const userId = await parseUserId(req);
      const { ledger_id, month } = req.query;

      const budget = await budgetService.getBudget(userId, {
        ledgerId: ledger_id,
        month,
      });

      if (!budget) {
        // 未设预算 → 200 + 字面 JSON null。
        // 必须是裸 null 而非 { budget: null } 包装：旧客户端按响应体 truthiness
        // 消费（budgetApi.fetchBudget），包装对象会被误判为有效预算。
        // Fastify send(null) 会走"空 body"分支，故显式发字面量 'null'。
        reply.code(200).type('application/json').send('null');
        return;
      }

      reply.code(200).send(budgetToResponse(budget));
    },
  );

  // PUT /budgets（创建或修改）
  app.put<{ Body: { ledger_id: string; month: string; amount_cents: number; version?: number | null } }>(
    '/budgets',
    { schema: { body: putBudgetBodySchema } },
    async (req, reply) => {
      const userId = await parseUserId(req);
      const { ledger_id, month, amount_cents, version } = req.body;

      const budget = await budgetService.upsertBudget(userId, {
        ledgerId: ledger_id,
        month,
        amountCents: amount_cents,
        version: version ?? null,
      });

      req.log.info(
        {
          action: 'budget.upsert',
          userId,
          ledgerId: ledger_id,
          month,
          amountCents: amount_cents,
          budgetVersion: budget.version,
        },
        'budget upserted',
      );

      reply.code(200).send(budgetToResponse(budget));
    },
  );
}
