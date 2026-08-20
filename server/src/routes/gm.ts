/**
 * Costra · Server · GM 路由（/gm/*）
 *
 * 事实源：docs/ops/gm-impersonate-design.md · server/api/openapi.yaml paths /gm/users | /gm/impersonate
 *
 * 契约约束：
 *   - GET  /gm/users        → 200 { items, page, page_size, has_more }（GM-only · 不返回 openid · D3）
 *   - POST /gm/impersonate  body: { user_id } | { fake_openid }（必须二选一）→ 200 AuthTokenPair（与 wx-login 同形）
 *
 * 安全模型：
 *   - requireGm 实时查库（非 JWT claim）：授权/回收即时生效（D2）
 *   - 伪造 openid 强制 gm_fake_ 前缀（schema 层拦截），与真实 openid 物理隔离（D4）
 *   - 审计 = warn 级日志（gm→target · D5）；不新增 ErrorCode
 */

import type { FastifyInstance, FastifyRequest } from 'fastify';
import { AppError } from '../errors/AppError.js';
import { ErrorCode } from '../errors/ErrorCode.js';
import * as userRepo from '../repositories/userRepo.js';
import { createAuthService } from '../services/authService.js';
import { code2Session } from '../wx/code2Session.js';

interface JwtPayload { sub: string; iat: number; exp: number }

/**
 * GM 校验（对齐 users.ts parseUserId 的鉴权模式，追加实时查库 is_gm 判定 · D2）。
 * 实时查库保证运维 SQL 授权/回收即时生效，无需等 token 过期。
 */
async function requireGm(request: FastifyRequest): Promise<string> {
  try {
    await request.jwtVerify();
  } catch {
    throw new AppError(ErrorCode.UNAUTHENTICATED, { message: 'invalid token' });
  }
  const payload = request.user as JwtPayload | undefined;
  if (!payload?.sub) throw new AppError(ErrorCode.UNAUTHENTICATED, { message: 'invalid token' });
  const user = await userRepo.findById(payload.sub);
  if (!user) throw new AppError(ErrorCode.UNAUTHENTICATED, { message: 'user not found' });
  if (!user.isGm) throw new AppError(ErrorCode.PERMISSION_DENIED, { message: 'gm only' });
  return user.id;
}

// --- Schema 定义 ---

const listUsersQuerySchema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    page: { type: 'integer', minimum: 1, default: 1 },
    page_size: { type: 'integer', minimum: 1, maximum: 50, default: 20 },
  },
} as const;

/** 伪造 openid 强制前缀（D4）：与真实微信 openid（以 o 开头）物理隔离、可批量清理 */
const FAKE_OPENID_PATTERN = '^gm_fake_[A-Za-z0-9_-]{4,64}$';

const impersonateBodySchema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    user_id: { type: 'string', format: 'uuid' },
    fake_openid: { type: 'string', pattern: FAKE_OPENID_PATTERN },
    // 客户端设备指纹（与 auth.ts wxLoginBodySchema.client_fp 同一约定）
    client_fp: { type: 'string', minLength: 1, maxLength: 128, pattern: '^[-A-Za-z0-9._:]+$' },
  },
} as const;

type ImpersonateBody = {
  user_id?: string;
  fake_openid?: string;
  client_fp?: string;
};

// --- 注册 ---

export async function registerGmRoutes(app: FastifyInstance): Promise<void> {
  const svc = createAuthService({ app, wxCode2Session: code2Session });

  // GET /gm/users · GM 用户列表（created_at DESC 稳定排序 · 不返回 openid）
  app.get<{ Querystring: { page?: number; page_size?: number } }>(
    '/gm/users',
    { schema: { querystring: listUsersQuerySchema } },
    async (req, reply) => {
      await requireGm(req);
      const page = req.query.page ?? 1;
      const pageSize = req.query.page_size ?? 20;
      // page_size+1 探测 has_more
      const rows = await userRepo.listRecentUsers(pageSize + 1, (page - 1) * pageSize);
      const items = rows.slice(0, pageSize).map((u) => ({
        id: u.id,
        id_short: u.id.slice(0, 8),
        nickname: u.nickname,
        avatar_url: u.avatarUrl,
        created_at: u.createdAt.toISOString(),
      }));
      reply.code(200).send({ items, page, page_size: pageSize, has_more: rows.length > pageSize });
    },
  );

  // POST /gm/impersonate · GM 登录指定账号（user_id）或伪造账号（fake_openid）
  app.post<{ Body: ImpersonateBody }>(
    '/gm/impersonate',
    { schema: { body: impersonateBodySchema } },
    async (req, reply) => {
      const gmUserId = await requireGm(req);
      const body = req.body;

      // user_id 与 fake_openid 必须二选一（都缺 / 都给均 400）
      const hasUserId = body.user_id !== undefined;
      const hasFakeOpenid = body.fake_openid !== undefined;
      if (hasUserId === hasFakeOpenid) {
        throw new AppError(ErrorCode.INVALID_ARGUMENT, {
          message: 'exactly one of user_id or fake_openid required',
        });
      }

      if (hasUserId) {
        const target = await userRepo.findById(body.user_id!);
        if (!target) {
          throw new AppError(ErrorCode.NOT_FOUND, { message: 'target user not found' });
        }
        app.log.warn({ gmUserId, mode: 'user_id', targetUserId: target.id }, 'gm impersonate login');
        const pair = await svc.loginAsOpenid(target.wxOpenid, target.wxUnionid, body.client_fp ?? null);
        reply.code(200).send(pair);
        return;
      }

      // fake_openid 路径：upsert 语义自动建号 + bootstrap 个人 family/ledger（前缀已由 schema 强制）
      app.log.warn({ gmUserId, mode: 'fake_openid', fakeOpenid: body.fake_openid }, 'gm impersonate login');
      const pair = await svc.loginAsOpenid(body.fake_openid!, null, body.client_fp ?? null);
      reply.code(200).send(pair);
    },
  );
}
