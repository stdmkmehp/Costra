/**
 * Costra · Server · 认证业务编排层
 *
 * 卡号：COSTRA-101 · 覆盖 DoD D4 三个端点的业务流程
 *
 * 三条核心路径：
 *   1. wxLogin(code) → openid → upsert user → 签 access/refresh → 落 session（DB + Redis）
 *   2. refresh(refreshToken) → 校验 jti 在 DB 活跃 + Redis 热路径 → 签新 access（可选滑动续 refresh，本轮 MVP 不滑动）
 *   3. logout(refreshToken) → 吊销该 jti（DB + Redis 同步删）
 *
 * 异常映射：
 *   - 微信侧错误由 code2Session 层统一抛 AppError（WX_CODE_INVALID / RATE_LIMITED / UNAVAILABLE）
 *   - 本层判定的错误：
 *       * refresh_token 解析失败 / jti 丢失 / token_type 不对  → REFRESH_TOKEN_INVALID
 *       * DB 查不到活跃 session                                  → REFRESH_TOKEN_INVALID
 *       * 登出时 refresh_token 解析失败                          → REFRESH_TOKEN_INVALID
 *         （说明：logout 语义为使 refresh 失效；无效的 refresh 直接当作成功以保证客户端幂等）
 *
 * 依赖注入：
 *   - 所有依赖通过工厂函数 `createAuthService(deps)` 注入，便于单测替换；
 *   - 路由层只 import `createAuthService`，不 import 子依赖。
 */

import type { FastifyInstance } from 'fastify';
import type { Code2SessionResult } from '../wx/code2Session.js';
import { AppError } from '../errors/AppError.js';
import { ErrorCode } from '../errors/ErrorCode.js';
import { newJti } from '../id/idGen.js';
import { ttl } from '../config/ttl.js';
import { getRedis } from '../db/redis.js';
import * as userRepo from '../repositories/userRepo.js';
import * as sessionRepo from '../repositories/sessionRepo.js';

/** 响应体形状（与 openapi.yaml components.schemas.AuthTokenPair 严格对齐）。 */
export interface AuthTokenPair {
  access_token: string;
  refresh_token: string;
  access_token_ttl_sec: number;
  refresh_token_ttl_sec: number;
  /** @deprecated 兼容老版本客户端，下一小版本移除；值 = access_token_ttl_sec */
  expires_in: number;
  user: {
    id: string;
    nickname: string;
    avatar_url: string | null;
    timezone: string;
    created_at: string;
    updated_at: string;
  };
}

export interface AuthServiceDeps {
  app: FastifyInstance;
  /** 微信 code → openid；默认使用 code2Session，测试可注入 mock */
  wxCode2Session: (code: string) => Promise<Code2SessionResult>;
}

export interface AuthService {
  wxLogin(code: string): Promise<AuthTokenPair>;
  refresh(refreshToken: string): Promise<AuthTokenPair>;
  logout(refreshToken: string): Promise<void>;
}

/** Redis key 统一出口，避免散落字符串拼接。 */
function redisKeyForRefresh(jti: string): string {
  return `refresh:${jti}`;
}

/**
 * 把 UserEntity 序列化为响应体中的 user 字段（ISO-8601 UTC）。
 */
function toUserView(u: {
  id: string;
  nickname: string;
  avatarUrl: string | null;
  timezone: string;
  createdAt: Date;
  updatedAt: Date;
}): AuthTokenPair['user'] {
  return {
    id: u.id,
    nickname: u.nickname,
    avatar_url: u.avatarUrl,
    timezone: u.timezone,
    created_at: u.createdAt.toISOString(),
    updated_at: u.updatedAt.toISOString(),
  };
}

export function createAuthService(deps: AuthServiceDeps): AuthService {
  const { app, wxCode2Session } = deps;

  async function signPair(userId: string): Promise<{
    accessToken: string;
    refreshToken: string;
    accessTtl: number;
    refreshTtl: number;
    jti: string;
  }> {
    const jti = newJti();
    const { token: accessToken, ttlSec: accessTtl } = app.signAccessToken(userId);
    const { token: refreshToken, ttlSec: refreshTtl } = app.signRefreshToken(userId, jti);
    return { accessToken, refreshToken, accessTtl, refreshTtl, jti };
  }

  async function persistSession(userId: string, jti: string, refreshTtl: number): Promise<void> {
    const expiresAt = new Date(Date.now() + refreshTtl * 1000);
    await sessionRepo.insert({ jti, userId, expiresAt });
    // Redis 热路径：jti → userId；TTL 与 refresh_token 一致（多 60s 余量应对时钟漂移）
    const redis = getRedis();
    await redis.set(redisKeyForRefresh(jti), userId, 'EX', refreshTtl + 60);
  }

  async function wxLogin(code: string): Promise<AuthTokenPair> {
    const { openid, unionid } = await wxCode2Session(code);

    const user = await userRepo.upsertByOpenid({
      wxOpenid: openid,
      wxUnionid: unionid ?? null,
      // 首登用户昵称先占位；后续 PATCH /users/me 由客户端补全
      nickname: '微信用户',
    });

    const pair = await signPair(user.id);
    await persistSession(user.id, pair.jti, pair.refreshTtl);

    return {
      access_token: pair.accessToken,
      refresh_token: pair.refreshToken,
      access_token_ttl_sec: pair.accessTtl,
      refresh_token_ttl_sec: pair.refreshTtl,
      expires_in: pair.accessTtl,
      user: toUserView(user),
    };
  }

  async function refresh(refreshToken: string): Promise<AuthTokenPair> {
    if (!refreshToken || typeof refreshToken !== 'string') {
      throw new AppError(ErrorCode.REFRESH_TOKEN_INVALID, { message: 'refresh_token required' });
    }

    let claims;
    try {
      claims = app.verifyRefreshToken(refreshToken);
    } catch (err) {
      throw new AppError(ErrorCode.REFRESH_TOKEN_INVALID, {
        message: 'refresh_token invalid or expired',
        cause: err,
      });
    }

    // 校验 jti 仍活跃：Redis 命中即通过；miss 回源 DB
    const redis = getRedis();
    const cached = await redis.get(redisKeyForRefresh(claims.jti));
    let session;
    if (cached != null) {
      // 仍以 DB 为准做二次校验（防 Redis 有残留 key 而 DB 已吊销）
      session = await sessionRepo.findActive(claims.jti);
    } else {
      session = await sessionRepo.findActive(claims.jti);
    }
    if (!session || session.userId !== claims.sub) {
      throw new AppError(ErrorCode.REFRESH_TOKEN_INVALID, {
        message: 'refresh session not found or revoked',
      });
    }

    // MVP 策略：只签新 access_token，refresh_token 保持原值（不滑动续期，见 ttl-policy.md §7）
    const { token: accessToken, ttlSec: accessTtl } = app.signAccessToken(claims.sub);
    await sessionRepo.touchRefresh(claims.jti);

    const user = await userRepo.findById(claims.sub);
    if (!user) {
      // 极端场景：session 还活着但用户已被软删
      throw new AppError(ErrorCode.REFRESH_TOKEN_INVALID, {
        message: 'user not found for refresh session',
      });
    }

    return {
      access_token: accessToken,
      refresh_token: refreshToken,
      access_token_ttl_sec: accessTtl,
      refresh_token_ttl_sec: ttl().refreshTokenSec,
      expires_in: accessTtl,
      user: toUserView(user),
    };
  }

  async function logout(refreshToken: string): Promise<void> {
    if (!refreshToken || typeof refreshToken !== 'string') {
      // 幂等：无 token 也算登出成功
      return;
    }
    let claims;
    try {
      claims = app.verifyRefreshToken(refreshToken);
    } catch {
      // 无效 refresh_token → 幂等返回
      return;
    }
    await sessionRepo.revoke(claims.jti);
    const redis = getRedis();
    await redis.del(redisKeyForRefresh(claims.jti));
  }

  return { wxLogin, refresh, logout };
}
