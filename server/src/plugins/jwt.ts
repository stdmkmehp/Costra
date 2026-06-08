/**
 * Costra · Server · @fastify/jwt 注册 + 签发/校验封装
 *
 * 卡号：COSTRA-101 · 事实源：docs/api/ttl-policy.md §4.2 · ADR-0006 §2.4
 *
 * 约定：
 *   - access_token payload：{ sub, token_type: 'access', jti, iat, exp }
 *     * access jti 为 nonce 用途（不写 DB，不参与吊销）：确保同 subject 同秒内多次签发不产生相同 token，
 *       规避同秒重登/refresh 的 token 复用风险（COSTRA-101 R3 Verify 反馈）。
 *   - refresh_token payload：{ sub, token_type: 'refresh', jti, iat, exp }
 *     * refresh jti 为事实源：双写 user_sessions + Redis，作为吊销锚点。
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
import { newJti } from '../id/idGen.js';

export type TokenType = 'access' | 'refresh';

export interface AccessTokenClaims {
  sub: string;
  token_type: 'access';
  /** nonce 用途（R3 修复）：不写 DB/不参与吊销，仅保证同秒多次签发 token 唯一。 */
  jti: string;
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
    // 说明（P1-1 · D-015 round-1 revise · R3 Verify 反馈追加）：
    //   @fastify/jwt 9.x 不透传 jsonwebtoken 的 `noTimestamp` 选项（它自身用 expiresIn/notBefore 封装），
    //   直接传入虽能过 TS 类型，但运行时被忽略且会产生"我自行控制时间戳"的假预期。
    //   解决：保留手写 iat/exp（payload 合并时手写值优先；fastify-jwt 仍可能自动写一个 iat，
    //   但会被 payload 第一参数覆盖），sign options 不再声明 noTimestamp。
    // R3 Verify 反馈：同 subject 同秒签发会复用 token 文本（T2/T3 撞秒失败；生产也属重放风险）。
    //   追加 access jti 作为 nonce——每次签发都不同；不写 DB / 不参与吊销（区别于 refresh jti）。
    const jti = newJti();
    const token = app.jwt.sign({ sub, token_type: 'access' as const, jti, iat, exp });
    return { token, ttlSec: tt.accessTokenSec };
  });

  app.decorate('signRefreshToken', (sub: string, jti: string) => {
    const iat = Math.floor(Date.now() / 1000);
    const exp = iat + tt.refreshTokenSec;
    const token = app.jwt.sign({ sub, token_type: 'refresh' as const, jti, iat, exp });
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
