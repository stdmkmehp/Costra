/**
 * Costra · Server · auth 路由
 *
 * 卡号：COSTRA-101 · 事实源：server/api/openapi.yaml paths /auth/wx-login | /auth/refresh | /auth/logout
 *
 * 契约约束：
 *   - POST /auth/wx-login   body: { code, encrypted_data?, iv? } → 200 AuthTokenPair
 *   - POST /auth/refresh    body: { refresh_token }              → 200 AuthTokenPair
 *   - POST /auth/logout     body: { refresh_token? } | header    → 204 No Content
 *
 * 请求体校验：用 Fastify JSON Schema；字段类型 / 必填项由 schema 拦截，
 * 校验失败自动被 errorHandler 映射为 INVALID_ARGUMENT。
 *
 * 路由层只做 "HTTP 参数解析 / 响应装配"，业务编排统一交给 authService。
 */

import type { FastifyInstance } from 'fastify';
import { createAuthService } from '../services/authService.js';
import { code2Session } from '../wx/code2Session.js';

const wxLoginBodySchema = {
  type: 'object',
  required: ['code'],
  additionalProperties: false,
  properties: {
    code: { type: 'string', minLength: 1, maxLength: 256 },
    encrypted_data: { type: 'string' },
    iv: { type: 'string' },
  },
} as const;

const refreshBodySchema = {
  type: 'object',
  required: ['refresh_token'],
  additionalProperties: false,
  properties: {
    refresh_token: { type: 'string', minLength: 1 },
  },
} as const;

const logoutBodySchema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    refresh_token: { type: 'string', minLength: 1 },
  },
} as const;

export async function registerAuthRoutes(app: FastifyInstance): Promise<void> {
  const svc = createAuthService({
    app,
    wxCode2Session: code2Session,
  });

  app.post<{ Body: { code: string; encrypted_data?: string; iv?: string } }>(
    '/auth/wx-login',
    {
      schema: { body: wxLoginBodySchema },
    },
    async (req, reply) => {
      const body = req.body;
      const pair = await svc.wxLogin(body.code);
      reply.code(200).send(pair);
    },
  );

  app.post<{ Body: { refresh_token: string } }>(
    '/auth/refresh',
    {
      schema: { body: refreshBodySchema },
    },
    async (req, reply) => {
      const pair = await svc.refresh(req.body.refresh_token);
      reply.code(200).send(pair);
    },
  );

  app.post<{ Body: { refresh_token?: string } }>(
    '/auth/logout',
    {
      schema: { body: logoutBodySchema },
    },
    async (req, reply) => {
      await svc.logout(req.body?.refresh_token ?? '');
      reply.code(204).send();
    },
  );
}
