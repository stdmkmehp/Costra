/**
 * Costra · Server · /v1/legal/* 法务披露路由
 *
 * 卡号：COSTRA-ICP（备案下证 · 2026-05-13）
 *
 * 职责：
 *   - GET /v1/legal/icp · 返回 ICP 备案信息（工信部公示一致字段集）
 *     · 公开端点：security: [] · 无鉴权 —— 满足腾讯云"显著位置可查"规范
 *     · 后端无 web 落地页时，本端点充当"程序化可查"入口
 *
 * 设计：
 *   - 数据源唯一指向 `config/icp.ts` 的 ICP_INFO 常量，不在路由处硬编码任何备案号。
 *   - 与 OpenAPI `GET /legal/icp` 路径定义保持字段一致（tag=legal）。
 */

import type { FastifyInstance } from 'fastify';
import { ICP_INFO } from '../config/icp.js';

export async function registerLegalRoutes(app: FastifyInstance): Promise<void> {
  app.get('/legal/icp', async (_req, reply) => {
    return reply.code(200).send(ICP_INFO);
  });
}
