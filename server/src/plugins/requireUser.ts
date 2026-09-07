/**
 * Costra · Server · requireUserId —— 带 token_type 判定的用户鉴权 helper
 *
 * 事实源：docs/design/monetization-tipping-tech-spec.md v1.2 §4.0（B0 用户端点统一 access-only）
 *
 * 背景：
 *   既有 12 处路由 helper 直接 `request.jwtVerify()` 且不校验 `token_type`，
 *   导致 refresh token 可通过全部用户 API（安全债 B0，独立 PR 全量替换）。
 *   本文件由 tips（虚拟支付赞赏）需求先行落地：支付链路涉及资金语义，
 *   新端点必须在 Day 0 就带 token_type 判定；B0 PR 复用本文件替换旧 helper。
 *
 * 行为（对齐各路由 parseUserId 的错误映射，仅追加 token_type 判定）：
 *   - jwtVerify 失败（缺失 / 伪造 / 过期）→ 401 UNAUTHENTICATED 'invalid token'
 *   - token_type !== 'access'（如 refresh token）→ 401 UNAUTHENTICATED 'access token required'
 *   - 返回 payload.sub（用户 id）
 *
 * 注意：/auth/refresh、/auth/logout 从 body 读 refresh_token，不经本 helper，续签不受影响。
 */

import type { FastifyRequest } from 'fastify';
import { AppError } from '../errors/AppError.js';
import { ErrorCode } from '../errors/ErrorCode.js';
import type { AccessTokenClaims } from './jwt.js';

export async function requireUserId(request: FastifyRequest): Promise<string> {
  try {
    await request.jwtVerify();
  } catch {
    throw new AppError(ErrorCode.UNAUTHENTICATED, { message: 'invalid token' });
  }
  const payload = request.user as AccessTokenClaims | undefined;
  if (payload?.token_type !== 'access' || !payload.sub) {
    throw new AppError(ErrorCode.UNAUTHENTICATED, { message: 'access token required' });
  }
  return payload.sub;
}
