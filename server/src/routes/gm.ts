/**
 * Costra · Server · GM 路由（/gm/*）
 *
 * 事实源：docs/ops/gm-impersonate-design.md · server/api/openapi.yaml paths /gm/users | /gm/impersonate
 *
 * 契约约束（v2 · 2026-09-02 双榜单改造）：
 *   - GET  /gm/users        → 200 { active, recent } 双榜全量（各 ≤200 · GM-only · 不返回 openid · D3）
 *                             active = 近7天活跃（entry_count_7d DESC），recent = 最近注册（created_at DESC）；
 *                             整榜走 gmActiveUsersCache read-through（TTL 30min · Redis 异常降级直查 SQL），
 *                             分页由客户端本地切片，端点无分页参数
 *   - POST /gm/impersonate  body: { user_id } | { create_fake: true }（必须二选一）→ 200 AuthTokenPair（与 wx-login 同形）
 *
 * 安全模型：
 *   - requireGm 实时查库（非 JWT claim）：授权/回收即时生效（D2）
 *   - 伪造 openid 由服务端自动分配（gm_fake_ + 32 位 hex），与真实 openid 物理隔离（D4）
 *   - 审计 = warn 级日志（gm→target · D5）；不新增 ErrorCode
 */

import { randomUUID } from 'node:crypto';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { AppError } from '../errors/AppError.js';
import { ErrorCode } from '../errors/ErrorCode.js';
import * as userRepo from '../repositories/userRepo.js';
import { createAuthService } from '../services/authService.js';
import { getGmListsCached } from '../services/gmActiveUsersCache.js';
import { code2Session } from '../wx/code2Session.js';

interface JwtPayload { sub: string; iat: number; exp: number }

/** 双榜单各榜上限（活跃/注册均 Top 200 · 客户端本地分页全量下发） */
const GM_LIST_LIMIT = 200;
/** 活跃窗口：近 7 天 */
const GM_ACTIVE_WINDOW_MS = 7 * 24 * 3600 * 1000;

/** 响应线形（缓存 payload 同形 · 日期已 ISO 序列化） */
interface GmActiveItem {
  id: string;
  id_short: string;
  nickname: string;
  avatar_url: string | null;
  created_at: string;
  entry_count_7d: number;
  last_active_at: string;
}

interface GmRecentItem {
  id: string;
  id_short: string;
  nickname: string;
  avatar_url: string | null;
  created_at: string;
}

interface GmUserLists {
  active: GmActiveItem[];
  recent: GmRecentItem[];
}

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

const impersonateBodySchema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    user_id: { type: 'string', format: 'uuid' },
    // 新建伪造账号：伪造 openid 由服务端生成（D4 前缀隔离），不接受手动指定
    create_fake: { type: 'boolean', enum: [true] },
    // 客户端设备指纹（与 auth.ts wxLoginBodySchema.client_fp 同一约定）
    client_fp: { type: 'string', minLength: 1, maxLength: 128, pattern: '^[-A-Za-z0-9._:]+$' },
  },
} as const;

type ImpersonateBody = {
  user_id?: string;
  create_fake?: boolean;
  client_fp?: string;
};

// --- 注册 ---

export async function registerGmRoutes(app: FastifyInstance): Promise<void> {
  const svc = createAuthService({ app, wxCode2Session: code2Session });

  // GET /gm/users · GM 用户双榜单（近7天活跃 + 最近注册 · 各 Top 200 · 整榜缓存 · 不返回 openid）
  app.get('/gm/users', async (req, reply) => {
    await requireGm(req);
    const lists = await getGmListsCached<GmUserLists>(async () => {
      const since = new Date(Date.now() - GM_ACTIVE_WINDOW_MS);
      const [active, recent] = await Promise.all([
        userRepo.listActiveUsers(since, GM_LIST_LIMIT),
        userRepo.listRecentRegistered(GM_LIST_LIMIT),
      ]);
      return {
        active: active.map((u) => ({
          id: u.id,
          id_short: u.id.slice(0, 8),
          nickname: u.nickname,
          avatar_url: u.avatarUrl,
          created_at: u.createdAt.toISOString(),
          entry_count_7d: u.entryCount7d,
          last_active_at: u.lastActiveAt.toISOString(),
        })),
        recent: recent.map((u) => ({
          id: u.id,
          id_short: u.id.slice(0, 8),
          nickname: u.nickname,
          avatar_url: u.avatarUrl,
          created_at: u.createdAt.toISOString(),
        })),
      };
    }, app.log);
    return reply.code(200).send(lists);
  });

  // POST /gm/impersonate · GM 登录指定账号（user_id）或新建伪造账号（create_fake）
  app.post<{ Body: ImpersonateBody }>(
    '/gm/impersonate',
    { schema: { body: impersonateBodySchema } },
    async (req, reply) => {
      const gmUserId = await requireGm(req);
      const body = req.body;

      // user_id 与 create_fake 必须二选一（都缺 / 都给均 400）
      const hasUserId = body.user_id !== undefined;
      const hasCreateFake = body.create_fake !== undefined;
      if (hasUserId === hasCreateFake) {
        throw new AppError(ErrorCode.INVALID_ARGUMENT, {
          message: 'exactly one of user_id or create_fake required',
        });
      }

      if (hasUserId) {
        const target = await userRepo.findById(body.user_id!);
        if (!target) {
          throw new AppError(ErrorCode.NOT_FOUND, { message: 'target user not found' });
        }
        app.log.warn({ gmUserId, mode: 'user_id', targetUserId: target.id }, 'gm impersonate login');
        const pair = await svc.loginAsOpenid(target.wxOpenid, target.wxUnionid, body.client_fp ?? null);
        return reply.code(200).send(pair);
      }

      // create_fake 路径：服务端生成伪造 openid（gm_fake_ + 32 位 hex · D4 前缀隔离），
      // upsert 语义自动建号 + bootstrap 个人 family/ledger；每次调用新建独立账号，复登走 user_id 路径
      const fakeOpenid = `gm_fake_${randomUUID().replace(/-/g, '')}`;
      app.log.warn({ gmUserId, mode: 'fake_auto', fakeOpenid }, 'gm impersonate login');
      const pair = await svc.loginAsOpenid(fakeOpenid, null, body.client_fp ?? null);
      return reply.code(200).send(pair);
    },
  );
}
