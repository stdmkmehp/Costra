/**
 * Costra · Server · categories 路由
 *
 * 卡号：COSTRA-218
 * 事实源：server/api/openapi.yaml paths /categories
 *
 * 契约约束：
 *   - GET  /categories  query: family_id(uuid required) → 200 Category[]
 *   - POST /categories  body: CategoryCreate → 201 Category
 *
 * 路由层只做 "HTTP 参数解析 / 响应装配"，业务编排统一交给 categoryService。
 */

import type { FastifyInstance, FastifyRequest } from 'fastify';
import { AppError } from '../errors/AppError.js';
import { ErrorCode } from '../errors/ErrorCode.js';
import * as categoryService from '../services/categoryService.js';
import type { CreateCategoryPayload } from '../services/categoryService.js';

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

// --- Schema 定义 ---

const listCategoriesQuerySchema = {
  type: 'object',
  required: ['family_id'],
  additionalProperties: false,
  properties: {
    family_id: { type: 'string', format: 'uuid' },
  },
} as const;

const createCategoryBodySchema = {
  type: 'object',
  required: ['family_id', 'name', 'type', 'icon'],
  additionalProperties: false,
  properties: {
    family_id: { type: 'string', format: 'uuid' },
    name: { type: 'string', maxLength: 16 },
    type: { type: 'string', enum: ['income', 'expense', 'transfer'] },
    icon: { type: 'string' },
    color: { type: 'string' },
    parent_id: { type: 'string', format: 'uuid', nullable: true },
  },
} as const;

// --- 注册 ---

export async function registerCategoriesRoutes(app: FastifyInstance): Promise<void> {
  // GET /categories
  app.get<{ Querystring: { family_id: string } }>(
    '/categories',
    { schema: { querystring: listCategoriesQuerySchema } },
    async (req, reply) => {
      const userId = await parseUserId(req);
      const { family_id: familyId } = req.query;
      const categories = await categoryService.listCategories(userId, familyId);
      reply.code(200).send(categories);
    },
  );

  // POST /categories
  app.post<{ Body: CreateCategoryPayload }>(
    '/categories',
    { schema: { body: createCategoryBodySchema } },
    async (req, reply) => {
      const userId = await parseUserId(req);
      const category = await categoryService.createCategory(userId, req.body);
      req.log.info(
        {
          action: 'category.create',
          userId,
          familyId: category.family_id,
          categoryId: category.id,
          name: category.name,
          type: category.type,
          icon: category.icon,
          color: category.color,
          parentId: category.parent_id,
        },
        'category created',
      );
      reply.code(201).send(category);
    },
  );
}
