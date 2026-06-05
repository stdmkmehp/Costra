/**
 * Costra · ErrorCode 枚举
 *
 * 事实源：docs/api/error-codes.md v1.0
 * 镜像：server/api/openapi.yaml components.schemas.ErrorCode
 * 卡号：COSTRA-100 (G3 补齐)
 *
 * ⚠️ 约束：
 *   1. 本枚举的字符串值一旦发布不得改变（契约稳定）。
 *   2. 新增 code 必须同步 docs/api/error-codes.md + openapi.yaml + client error-mapper。
 *   3. 客户端依 `code` 判分支，严禁依 HTTP status 判分支。
 */

export enum ErrorCode {
  // --- 400 参数 / 请求体 ---
  INVALID_ARGUMENT = 'INVALID_ARGUMENT',
  MALFORMED_JSON = 'MALFORMED_JSON',
  IDEMPOTENCY_KEY_REQUIRED = 'IDEMPOTENCY_KEY_REQUIRED',
  IDEMPOTENCY_KEY_MISMATCH = 'IDEMPOTENCY_KEY_MISMATCH',
  UNSUPPORTED_MEDIA_TYPE = 'UNSUPPORTED_MEDIA_TYPE',

  // --- 401 未授权 ---
  UNAUTHENTICATED = 'UNAUTHENTICATED',
  TOKEN_EXPIRED = 'TOKEN_EXPIRED',
  REFRESH_TOKEN_INVALID = 'REFRESH_TOKEN_INVALID',
  WX_CODE_INVALID = 'WX_CODE_INVALID',

  // --- 403 权限 ---
  PERMISSION_DENIED = 'PERMISSION_DENIED',
  FAMILY_NOT_MEMBER = 'FAMILY_NOT_MEMBER',
  FAMILY_PERSONAL_NOT_DELETABLE = 'FAMILY_PERSONAL_NOT_DELETABLE',

  // --- 404 资源 ---
  NOT_FOUND = 'NOT_FOUND',

  // --- 409 冲突 ---
  VERSION_CONFLICT = 'VERSION_CONFLICT',
  DUPLICATE_RESOURCE = 'DUPLICATE_RESOURCE',
  ALREADY_MEMBER = 'ALREADY_MEMBER',

  // --- 410 已失效 ---
  INVITE_EXPIRED = 'INVITE_EXPIRED',

  // --- 422 业务规则 ---
  BUSINESS_RULE_VIOLATION = 'BUSINESS_RULE_VIOLATION',

  // --- 429 限流 ---
  RATE_LIMITED = 'RATE_LIMITED',

  // --- 5xx 服务端 ---
  INTERNAL = 'INTERNAL',
  UNAVAILABLE = 'UNAVAILABLE',
  TIMEOUT = 'TIMEOUT',
  NOT_IMPLEMENTED = 'NOT_IMPLEMENTED',
}

/**
 * ErrorCode → HTTP status 静态映射
 * 服务端中间件据此序列化响应；客户端仅用于断言，不用于判分支。
 */
export const ErrorHttpStatus: Readonly<Record<ErrorCode, number>> = Object.freeze({
  [ErrorCode.INVALID_ARGUMENT]: 400,
  [ErrorCode.MALFORMED_JSON]: 400,
  [ErrorCode.IDEMPOTENCY_KEY_REQUIRED]: 400,
  [ErrorCode.IDEMPOTENCY_KEY_MISMATCH]: 409,
  [ErrorCode.UNSUPPORTED_MEDIA_TYPE]: 415,

  [ErrorCode.UNAUTHENTICATED]: 401,
  [ErrorCode.TOKEN_EXPIRED]: 401,
  [ErrorCode.REFRESH_TOKEN_INVALID]: 401,
  [ErrorCode.WX_CODE_INVALID]: 401,

  [ErrorCode.PERMISSION_DENIED]: 403,
  [ErrorCode.FAMILY_NOT_MEMBER]: 403,
  [ErrorCode.FAMILY_PERSONAL_NOT_DELETABLE]: 403,

  [ErrorCode.NOT_FOUND]: 404,

  [ErrorCode.VERSION_CONFLICT]: 409,
  [ErrorCode.DUPLICATE_RESOURCE]: 409,
  [ErrorCode.ALREADY_MEMBER]: 409,

  [ErrorCode.INVITE_EXPIRED]: 410,

  [ErrorCode.BUSINESS_RULE_VIOLATION]: 422,

  [ErrorCode.RATE_LIMITED]: 429,

  [ErrorCode.INTERNAL]: 500,
  [ErrorCode.UNAVAILABLE]: 503,
  [ErrorCode.TIMEOUT]: 504,
  [ErrorCode.NOT_IMPLEMENTED]: 501,
});

/**
 * ErrorCode → 客户端自动重试策略
 *   - retryable: 是否应由 request.ts 拦截器自动重试
 *   - strategy: 重试算法
 *     - 'none'            不重试
 *     - 'refresh-once'    调 /auth/refresh 后重放一次（仅 TOKEN_EXPIRED）
 *     - 'retry-after'     按响应头 Retry-After 退避（仅 RATE_LIMITED）
 *     - 'exp-backoff-3'   指数退避 1s / 4s / 16s 共 3 次（仅 5xx）
 */
export type RetryStrategy = 'none' | 'refresh-once' | 'retry-after' | 'exp-backoff-3';

export const ErrorRetryStrategy: Readonly<Record<ErrorCode, RetryStrategy>> = Object.freeze({
  [ErrorCode.INVALID_ARGUMENT]: 'none',
  [ErrorCode.MALFORMED_JSON]: 'none',
  [ErrorCode.IDEMPOTENCY_KEY_REQUIRED]: 'none',
  [ErrorCode.IDEMPOTENCY_KEY_MISMATCH]: 'none',
  [ErrorCode.UNSUPPORTED_MEDIA_TYPE]: 'none',

  [ErrorCode.UNAUTHENTICATED]: 'none',
  [ErrorCode.TOKEN_EXPIRED]: 'refresh-once',
  [ErrorCode.REFRESH_TOKEN_INVALID]: 'none',
  [ErrorCode.WX_CODE_INVALID]: 'none',

  [ErrorCode.PERMISSION_DENIED]: 'none',
  [ErrorCode.FAMILY_NOT_MEMBER]: 'none',
  [ErrorCode.FAMILY_PERSONAL_NOT_DELETABLE]: 'none',

  [ErrorCode.NOT_FOUND]: 'none',

  [ErrorCode.VERSION_CONFLICT]: 'none',
  [ErrorCode.DUPLICATE_RESOURCE]: 'none',
  [ErrorCode.ALREADY_MEMBER]: 'none',

  [ErrorCode.INVITE_EXPIRED]: 'none',

  [ErrorCode.BUSINESS_RULE_VIOLATION]: 'none',

  [ErrorCode.RATE_LIMITED]: 'retry-after',

  [ErrorCode.INTERNAL]: 'exp-backoff-3',
  [ErrorCode.UNAVAILABLE]: 'exp-backoff-3',
  [ErrorCode.TIMEOUT]: 'exp-backoff-3',
  [ErrorCode.NOT_IMPLEMENTED]: 'none',
});

/**
 * 守卫：字符串是否为合法 ErrorCode 值。
 * 用于中间件反序列化 / 客户端解析外来响应。
 */
export function isErrorCode(value: string): value is ErrorCode {
  return (Object.values(ErrorCode) as string[]).includes(value);
}

/**
 * 快捷查询：某 code 对应的 HTTP status。
 * 未定义时兜底 500（但理论上不会发生，所有 code 都在映射表中）。
 */
export function httpStatusOf(code: ErrorCode): number {
  return ErrorHttpStatus[code] ?? 500;
}

/**
 * 模块加载期覆盖自检：保证 `ErrorHttpStatus` / `ErrorRetryStrategy` 对每个 `ErrorCode`
 * 枚举值都有明确映射。未覆盖时**立即抛错**，让应用在启动阶段就失败，避免 httpStatusOf 悄悄兜底 500。
 *
 * 触发规则：
 *   - 新增一条 ErrorCode 后忘了同步 ErrorHttpStatus 或 ErrorRetryStrategy 任一映射
 *   - 单测 / server 启动时就会立刻失败
 *
 * COSTRA-100 Round-2 修复（Review-Tech Round-1 P1-4）。
 */
(function assertErrorCodeCoverage(): void {
  const missing: Array<{ code: string; missingIn: string[] }> = [];
  for (const code of Object.values(ErrorCode)) {
    const gaps: string[] = [];
    if (ErrorHttpStatus[code as ErrorCode] == null) gaps.push('ErrorHttpStatus');
    if (ErrorRetryStrategy[code as ErrorCode] == null) gaps.push('ErrorRetryStrategy');
    if (gaps.length > 0) missing.push({ code, missingIn: gaps });
  }
  if (missing.length > 0) {
    const report = missing
      .map((m) => `  - ${m.code}: missing in ${m.missingIn.join(', ')}`)
      .join('\n');
    throw new Error(
      `[ErrorCode] coverage assertion failed. The following codes are missing mappings:\n${report}\n` +
        `Fix: update ErrorHttpStatus / ErrorRetryStrategy in server/src/errors/ErrorCode.ts and docs/api/error-codes.md.`,
    );
  }
})();
