/**
 * Costra · Server · /users/me 路由
 *
 * 卡号：COSTRA-158 · 事实源：server/api/openapi.yaml paths /users/me
 *
 * 契约约束：
 *   - GET   /users/me             → 200 User（含 has_completed_profile）
 *   - PATCH /users/me  body: {}   → 200 User（has_completed_profile 自动 TRUE）
 *   - POST  /users/me + X-HTTP-Method-Override: PATCH → 委托 PATCH handler（K3 兜底）
 *
 * K3 兜底说明（dispatch §2.1 K3 · FU-COMMON-MINIAPP-PATCH-LIMIT 关闭条件）：
 *   wx.request 不支持 PATCH method · 客户端降级为 POST + X-HTTP-Method-Override header
 *   本路由的 POST handler 识别该 header 后委托 PATCH handler · 仅 users 路由内做 · 不全局
 */

import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { AppError } from '../errors/AppError.js';
import { ErrorCode } from '../errors/ErrorCode.js';
import * as userRepo from '../repositories/userRepo.js';

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

// --- User 序列化（与 OpenAPI User schema 对齐）---

interface UserView {
  id: string;
  nickname: string;
  avatar_url: string | null;
  timezone: string;
  has_completed_profile: boolean;
  created_at: string;
  updated_at: string;
}

function toUserView(u: userRepo.UserEntity): UserView {
  return {
    id: u.id,
    nickname: u.nickname,
    avatar_url: u.avatarUrl,
    timezone: u.timezone,
    has_completed_profile: u.hasCompletedProfile,
    created_at: u.createdAt.toISOString(),
    updated_at: u.updatedAt.toISOString(),
  };
}

// --- Schema 定义 ---

const patchBodySchema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    nickname: { type: 'string', maxLength: 32 },
    avatar_url: { type: 'string', format: 'uri', nullable: true },
    timezone: { type: 'string' },
  },
} as const;

type PatchBody = {
  nickname?: string;
  avatar_url?: string | null;
  timezone?: string;
};

const preferenceBodySchema = {
  type: 'object',
  required: ['preferred_family_id', 'preferred_ledger_id'],
  additionalProperties: false,
  properties: {
    preferred_family_id: { type: 'string', format: 'uuid', nullable: true },
    preferred_ledger_id:  { type: 'string', format: 'uuid', nullable: true },
  },
} as const;

type PreferenceBody = {
  preferred_family_id: string | null;
  preferred_ledger_id:  string | null;
};

// --- 注册 ---

export async function registerUsersRoutes(app: FastifyInstance): Promise<void> {

  // GET /users/me
  app.get('/users/me', async (req, reply) => {
    const userId = await parseUserId(req);
    const user = await userRepo.findById(userId);
    if (!user) {
      throw new AppError(ErrorCode.UNAUTHENTICATED, { message: 'user not found' });
    }
    reply.code(200).send(toUserView(user));
  });

  // PATCH /users/me handler（抽为内部函数 · 供 POST K3 兜底复用）
  async function handlePatch(req: FastifyRequest, reply: FastifyReply): Promise<void> {
    const userId = await parseUserId(req);
    const body = req.body as PatchBody;

    // 至少 1 字段非空
    if (body.nickname === undefined && body.avatar_url === undefined && body.timezone === undefined) {
      throw new AppError(ErrorCode.INVALID_ARGUMENT, {
        message: 'at least one field required',
        details: { fields: ['nickname', 'avatar_url', 'timezone'] },
      });
    }

    const user = await userRepo.updateProfile(userId, {
      nickname: body.nickname,
      avatarUrl: body.avatar_url,
      timezone: body.timezone,
    });
    if (!user) {
      throw new AppError(ErrorCode.UNAUTHENTICATED, { message: 'user not found' });
    }
    reply.code(200).send(toUserView(user));
  }

  // PATCH /users/me
  app.patch<{ Body: PatchBody }>(
    '/users/me',
    { schema: { body: patchBodySchema } },
    handlePatch,
  );

  // POST /users/me（K3 兜底 · 仅识别 X-HTTP-Method-Override: PATCH 时委托 PATCH handler）
  app.post<{ Body: PatchBody }>(
    '/users/me',
    { schema: { body: patchBodySchema } },
    async (req, reply) => {
      const override = req.headers['x-http-method-override'];
      if (typeof override === 'string' && override.toUpperCase() === 'PATCH') {
        return handlePatch(req, reply);
      }
      // 无 Method-Override header → 405 METHOD_NOT_ALLOWED
      reply.code(405).send({
        error: {
          code: 'METHOD_NOT_ALLOWED',
          message: 'POST /users/me requires X-HTTP-Method-Override: PATCH',
        },
      });
    },
  );

  // GET /users/me/preference
  // 返回用户上次选择的 family_id + ledger_id（可为 null）
  // 设备清除本地 storage 后调此接口恢复偏好
  app.get('/users/me/preference', async (req, reply) => {
    const userId = await parseUserId(req);
    const user = await userRepo.findById(userId);
    if (!user) {
      throw new AppError(ErrorCode.UNAUTHENTICATED, { message: 'user not found' });
    }
    reply.code(200).send({
      preferred_family_id: user.preferredFamilyId,
      preferred_ledger_id:  user.preferredLedgerId,
    });
  });

  // PUT /users/me/preference
  // 覆盖写用户偏好（切换账本时调，fire-and-forget 可接受）
  app.put<{ Body: PreferenceBody }>(
    '/users/me/preference',
    { schema: { body: preferenceBodySchema } },
    async (req, reply) => {
      const userId = await parseUserId(req);
      const body = req.body;
      await userRepo.updatePreference(userId, {
        preferredFamilyId: body.preferred_family_id,
        preferredLedgerId:  body.preferred_ledger_id,
      });
      reply.code(204).send();
    },
  );
}
