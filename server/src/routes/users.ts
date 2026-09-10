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
import { appEnv } from '../config/env.js';
import { AppError } from '../errors/AppError.js';
import { ErrorCode } from '../errors/ErrorCode.js';
import * as userRepo from '../repositories/userRepo.js';
import * as userOverviewRepo from '../repositories/userOverviewRepo.js';
import * as familyRepo from '../repositories/familyRepo.js';
import * as familyMemberRepo from '../repositories/familyMemberRepo.js';
import * as ledgerRepo from '../repositories/ledgerRepo.js';
import * as tipOrderRepo from '../repositories/tipOrderRepo.js';

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
  is_gm: boolean;
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
    is_gm: u.isGm,
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
    client_revision: { type: 'integer', minimum: 0 },
  },
} as const;

type PreferenceBody = {
  preferred_family_id: string | null;
  preferred_ledger_id:  string | null;
  client_revision?: number;
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
    return reply.code(200).send(toUserView(user));
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
    return reply.code(200).send(toUserView(user));
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
      return reply.code(405).send({
        error: {
          code: 'METHOD_NOT_ALLOWED',
          message: 'POST /users/me requires X-HTTP-Method-Override: PATCH',
        },
      });
    },
  );

  // GET /users/me/preference
  // 返回用户上次选择的完整 active context；若偏好已失效则返回 null，避免客户端落盘半残 context。
  app.get('/users/me/preference', async (req, reply) => {
    const userId = await parseUserId(req);
    const user = await userRepo.findById(userId);
    if (!user) {
      throw new AppError(ErrorCode.UNAUTHENTICATED, { message: 'user not found' });
    }

    if (!user.preferredFamilyId || !user.preferredLedgerId) {
      return reply.code(200).send({
        preferred_family_id: null,
        preferred_ledger_id: null,
        preferred_family_kind: null,
        preferred_ledger_name: null,
        preferred_revision: user.preferredRevision,
        preferred_updated_at: user.preferredUpdatedAt?.toISOString() ?? null,
      });
    }

    const [family, ledger, isMember] = await Promise.all([
      familyRepo.findById(user.preferredFamilyId),
      ledgerRepo.findById(user.preferredLedgerId),
      familyMemberRepo.isActiveMember(userId, user.preferredFamilyId),
    ]);

    if (!family || !ledger || ledger.familyId !== family.id || !isMember) {
      return reply.code(200).send({
        preferred_family_id: null,
        preferred_ledger_id: null,
        preferred_family_kind: null,
        preferred_ledger_name: null,
        preferred_revision: user.preferredRevision,
        preferred_updated_at: user.preferredUpdatedAt?.toISOString() ?? null,
      });
    }

    return reply.code(200).send({
      preferred_family_id: family.id,
      preferred_ledger_id: ledger.id,
      preferred_family_kind: family.kind,
      preferred_ledger_name: ledger.name || family.name,
      preferred_revision: user.preferredRevision,
      preferred_updated_at: user.preferredUpdatedAt?.toISOString() ?? null,
    });
  });

  // PUT /users/me/preference
  // 保存用户偏好：校验 family/ledger/member 有效性，并用 client_revision 防旧请求覆盖新选择。
  app.put<{ Body: PreferenceBody }>(
    '/users/me/preference',
    { schema: { body: preferenceBodySchema } },
    async (req, reply) => {
      const userId = await parseUserId(req);
      const body = req.body;

      const bothNull = body.preferred_family_id === null && body.preferred_ledger_id === null;
      const bothPresent = !!body.preferred_family_id && !!body.preferred_ledger_id;
      if (!bothNull && !bothPresent) {
        throw new AppError(ErrorCode.INVALID_ARGUMENT, {
          message: 'preferred_family_id and preferred_ledger_id must be both null or both present',
        });
      }

      if (bothPresent) {
        const [family, ledger, isMember] = await Promise.all([
          familyRepo.findById(body.preferred_family_id!),
          ledgerRepo.findById(body.preferred_ledger_id!),
          familyMemberRepo.isActiveMember(userId, body.preferred_family_id!),
        ]);
        if (!family || !isMember) {
          throw new AppError(ErrorCode.FAMILY_NOT_MEMBER, {
            message: 'cannot set preference to a family you are not an active member of',
            details: { family_id: body.preferred_family_id },
          });
        }
        if (!ledger || ledger.familyId !== family.id) {
          throw new AppError(ErrorCode.INVALID_ARGUMENT, {
            message: 'preferred_ledger_id does not belong to preferred_family_id',
            details: { preferred_family_id: body.preferred_family_id, preferred_ledger_id: body.preferred_ledger_id },
          });
        }
      }

      await userRepo.updatePreference(userId, {
        preferredFamilyId: body.preferred_family_id,
        preferredLedgerId:  body.preferred_ledger_id,
        clientRevision: body.client_revision,
      });
      return reply.code(204).send();
    },
  );

  // GET /users/me/overview
  // 返回当前用户跨所有账本的宏观聚合：记账笔数 + 有记账的天数（Asia/Shanghai）
  // + 赞赏派生权益（tech-spec v1.2 §7.3：一条聚合 SQL 驱动四态 + 徽章/次数/支持度）。
  // 用途：mine 页宏观数据区 + 赞赏横幅/徽章。前端 SWR 缓存，ENTRY_SAVED/UPDATED/SYNC_DONE 失效。
  app.get('/users/me/overview', async (req, reply) => {
    const userId = await parseUserId(req);
    const [overview, tipAgg, badgeHidden] = await Promise.all([
      userOverviewRepo.getUserOverview(userId),
      tipOrderRepo.aggregateTipSummary(userId),
      tipOrderRepo.getBadgeHidden(userId),
    ]);
    // supporter_badge 当前等价于 tip_count > 0（唯一权益 supporter_badge 的特例化 ·
    // 新增权益类型时须改为独立 hasEntitlement 派生 · tech-spec §7.3）
    const supporterBadge = tipAgg.tipCount > 0;
    const env = appEnv();
    const tipEntryVisible =
      env.wxPayMode === 'on' || env.wxPayTestUserIds.includes(userId) || supporterBadge;
    return reply.code(200).send({
      ...overview,
      tip_entry_visible: tipEntryVisible,
      supporter_badge: supporterBadge,
      badge_hidden: badgeHidden,
      tip_count: tipAgg.tipCount,
      support_score: tipAgg.supportScore,
    });
  });
}
