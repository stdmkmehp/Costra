/**
 * Costra · Server · @fastify/jwt 注册 + 签发/校验封装
 *
 * 卡号：COSTRA-101 · 事实源：docs/api/ttl-policy.md §4.2 · ADR-0006 §2.4
 *
 * 约定：
 *   - access_token payload：{ sub, token_type: 'access', iat, exp }
 *   - refresh_token payload：{ sub, token_type: 'refresh', jti, iat, exp }
 *   - HS256 + env.JWT_SECRET；iss / aud 固定由 env 配置
 *   - 时钟偏移容错：TTL_CLOCK_TOLERANCE_SEC（默认 60s）
 *
 * 注意：
 *   - 本插件**只**负责 JWT 的签发 / 解析原语；业务层（authService）负责将 jti 双写到
 *     user_sessions + Redis、处理 refresh 续期的 REFRESH_TOKEN_INVALID 语义。
 *   - 不挂全局 onRequest preHandler；路由按需使用 app.authenticate（由 fastify-jwt 暴露）。
 */

import type { FastifyInstance } from 'fastify';
import fastifyJwt from '@fastify/jwt';
import { appEnv } from '../config/env.js';
import { ttl } from '../config/ttl.js';

export type TokenType = 'access' | 'refresh';

export interface AccessTokenClaims {
  sub: string;
  token_type: 'access';
  iat: number;
  exp: number;
}

export interface RefreshTokenClaims {
  sub: string;
  token_type: 'refresh';
  jti: string;
  iat: number;
  exp: number;
}

declare module 'fastify' {
  // 给 Fastify 实例补类型：app.signAccessToken / app.signRefreshToken / app.verifyAccessToken / app.verifyRefreshToken
  interface FastifyInstance {
    signAccessToken: (sub: string) => { token: string; ttlSec: number };
    signRefreshToken: (sub: string, jti: string) => { token: string; ttlSec: number };
    verifyAccessToken: (token: string) => AccessTokenClaims;
    verifyRefreshToken: (token: string) => RefreshTokenClaims;
  }
}

export async function registerJwt(app: FastifyInstance): Promise<void> {
  const env = appEnv();
  const tt = ttl();

  await app.register(fastifyJwt, {
    secret: env.jwtSecret,
    sign: {
      iss: env.jwtIssuer,
      aud: env.jwtAudience,
      algorithm: 'HS256',
    },
    verify: {
      allowedIss: env.jwtIssuer,
      allowedAud: env.jwtAudience,
      // 时钟偏移容错（秒）
      maxAge: undefined, // 由 exp 字段控制
    },
    // 显式关闭默认 formatUser，避免把 claims 扁平化
    formatUser: (payload: unknown) => payload as object,
  });

  app.decorate('signAccessToken', (sub: string) => {
    const iat = Math.floor(Date.now() / 1000);
    const exp = iat + tt.accessTokenSec;
    const token = app.jwt.sign(
      { sub, token_type: 'access' as const, iat, exp },
      { noTimestamp: true }, // 我们自行写 iat，避免冲突
    );
    return { token, ttlSec: tt.accessTokenSec };
  });

  app.decorate('signRefreshToken', (sub: string, jti: string) => {
    const iat = Math.floor(Date.now() / 1000);
    const exp = iat + tt.refreshTokenSec;
    const token = app.jwt.sign(
      { sub, token_type: 'refresh' as const, jti, iat, exp },
      { noTimestamp: true },
    );
    return { token, ttlSec: tt.refreshTokenSec };
  });

  app.decorate('verifyAccessToken', (token: string): AccessTokenClaims => {
    const claims = app.jwt.verify(token, { clockTolerance: tt.clockToleranceSec }) as AccessTokenClaims;
    if (claims.token_type !== 'access') {
      throw new Error('token_type mismatch: expected access');
    }
    return claims;
  });

  app.decorate('verifyRefreshToken', (token: string): RefreshTokenClaims => {
    const claims = app.jwt.verify(token, { clockTolerance: tt.clockToleranceSec }) as RefreshTokenClaims;
    if (claims.token_type !== 'refresh') {
      throw new Error('token_type mismatch: expected refresh');
    }
    if (!claims.jti) {
      throw new Error('refresh token missing jti');
    }
    return claims;
  });
}
