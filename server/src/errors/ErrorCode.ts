/**
 * Costra · ErrorCode 枚举
 *
 * 事实源：docs/api/error-codes.md v1.0
 * 镜像：server/api/openapi.yaml components.schemas.ErrorCode
 * 卡号：COSTRA-100 (G3 补齐)
 *
 * ⚠️ 约束：
 *   1. 本枚举的字符串值一旦发布不得改变（契约稳定）。
 *   2. 新增 code 必须同步 docs/api/error-codes.md + openapi.yaml + client error-mapper，
 *      并补齐本文件三张映射表（ErrorHttpStatus / ErrorRetryStrategy / ErrorLogLevels），
 *      漏一张则模块加载期 assertErrorCodeCoverage 立即抛错。
 *   3. 客户端依 `code` 判分支，严禁依 HTTP status 判分支。
 *   4. 三张表中前两张是契约（影响响应与客户端行为），ErrorLogLevels 仅服务端可观测性，
 *      不下发客户端，可自由调整。
 */

export enum ErrorCode {
  // --- 400 参数 / 请求体 ---
  INVALID_ARGUMENT = 'INVALID_ARGUMENT',
  PAYMENT_PRODUCT_INVALID = 'PAYMENT_PRODUCT_INVALID',
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
  EXPORT_JOB_IN_PROGRESS = 'EXPORT_JOB_IN_PROGRESS',
  IMPORT_JOB_IN_PROGRESS = 'IMPORT_JOB_IN_PROGRESS',
  DETECT_IN_PROGRESS = 'DETECT_IN_PROGRESS',

  // --- 410 已失效 ---
  INVITE_EXPIRED = 'INVITE_EXPIRED',
  EXPORT_FILE_EXPIRED = 'EXPORT_FILE_EXPIRED',
  DETECT_SESSION_EXPIRED = 'DETECT_SESSION_EXPIRED',

  // --- 413 载荷过大 ---
  PAYLOAD_TOO_LARGE = 'PAYLOAD_TOO_LARGE',

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
  [ErrorCode.PAYMENT_PRODUCT_INVALID]: 400,
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
  [ErrorCode.EXPORT_JOB_IN_PROGRESS]: 409,
  [ErrorCode.IMPORT_JOB_IN_PROGRESS]: 409,
  [ErrorCode.DETECT_IN_PROGRESS]: 409,

  [ErrorCode.INVITE_EXPIRED]: 410,
  [ErrorCode.EXPORT_FILE_EXPIRED]: 410,
  [ErrorCode.DETECT_SESSION_EXPIRED]: 410,

  [ErrorCode.PAYLOAD_TOO_LARGE]: 413,

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
  [ErrorCode.PAYMENT_PRODUCT_INVALID]: 'none',
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
  [ErrorCode.EXPORT_JOB_IN_PROGRESS]: 'none',
  [ErrorCode.IMPORT_JOB_IN_PROGRESS]: 'none',
  [ErrorCode.DETECT_IN_PROGRESS]: 'none',

  [ErrorCode.INVITE_EXPIRED]: 'none',
  [ErrorCode.EXPORT_FILE_EXPIRED]: 'none',
  [ErrorCode.DETECT_SESSION_EXPIRED]: 'none',

  [ErrorCode.PAYLOAD_TOO_LARGE]: 'none',

  [ErrorCode.BUSINESS_RULE_VIOLATION]: 'none',

  [ErrorCode.RATE_LIMITED]: 'retry-after',

  [ErrorCode.INTERNAL]: 'exp-backoff-3',
  [ErrorCode.UNAVAILABLE]: 'exp-backoff-3',
  [ErrorCode.TIMEOUT]: 'exp-backoff-3',
  [ErrorCode.NOT_IMPLEMENTED]: 'none',
});

/**
 * ErrorCode → 服务端日志级别
 *
 * 为什么需要这张表：
 *   AppError 覆盖了"预期内的业务分支"与"服务端真故障"两类语义完全不同的场景，
 *   若在 errorHandler 里一刀切打 `warn`，warn 通道会被高频预期态淹没（典型：用户
 *   未设置预算 → `GET /budgets` 每次冷启动都返 404 NOT_FOUND），真正需要人介入的
 *   告警反而被埋掉。分级判据必须是**数据驱动的静态映射**，而非 handler 里的 if-else。
 *
 * 分级判据（新增 code 时按此三选一，不要凭感觉）：
 *   - 'info'  预期内的业务分支：服务端与客户端都按契约正常运作，客户端有明确的
 *             降级/重试/提示路径，出现频率与用户规模正相关。仅为链路可观测性留痕。
 *   - 'warn'  请求方行为异常而服务端正常：客户端 bug（参数 / 幂等键 / Content-Type）、
 *             疑似越权或探测（非过期类 401、403）、限流命中。需要观测趋势，不需立即介入。
 *   - 'error' 服务端自身故障，需要人介入排查（5xx）。
 *
 * 注意：本表**不是契约**（不下发客户端、不影响响应体），可自由调整，
 * 但每次调整都应同步 docs/api/error-codes.md §5.2。
 */
export type ErrorLogLevel = 'info' | 'warn' | 'error';

export const ErrorLogLevels: Readonly<Record<ErrorCode, ErrorLogLevel>> = Object.freeze({
  // --- 客户端 bug：请求根本不该发出来 ---
  [ErrorCode.INVALID_ARGUMENT]: 'warn',
  // 商品目录无此 product_key：配置/客户端版本不一致，需关注但非系统故障
  [ErrorCode.PAYMENT_PRODUCT_INVALID]: 'warn',
  [ErrorCode.MALFORMED_JSON]: 'warn',
  [ErrorCode.IDEMPOTENCY_KEY_REQUIRED]: 'warn',
  [ErrorCode.IDEMPOTENCY_KEY_MISMATCH]: 'warn',
  [ErrorCode.UNSUPPORTED_MEDIA_TYPE]: 'warn',
  // 客户端本应先做本地 1MB 校验，走到服务端说明校验被绕过（方案 §9.5）
  [ErrorCode.PAYLOAD_TOO_LARGE]: 'warn',

  // --- 401：过期类是正常生命周期（客户端自动刷新 / 跳登录），伪造类才可疑 ---
  [ErrorCode.UNAUTHENTICATED]: 'warn',
  [ErrorCode.TOKEN_EXPIRED]: 'info',
  [ErrorCode.REFRESH_TOKEN_INVALID]: 'info',
  [ErrorCode.WX_CODE_INVALID]: 'warn',

  // --- 403：越权访问需要观测；个人 family 不可删是 UI 已知的业务态 ---
  [ErrorCode.PERMISSION_DENIED]: 'warn',
  [ErrorCode.FAMILY_NOT_MEMBER]: 'warn',
  [ErrorCode.FAMILY_PERSONAL_NOT_DELETABLE]: 'info',

  // --- 404：资源不存在 / 未设置是设计内的正常态（客户端据此渲染空态） ---
  [ErrorCode.NOT_FOUND]: 'info',

  // --- 409：乐观锁与唯一约束冲突，客户端有既定合并 / 提示策略 ---
  [ErrorCode.VERSION_CONFLICT]: 'info',
  [ErrorCode.DUPLICATE_RESOURCE]: 'info',
  [ErrorCode.ALREADY_MEMBER]: 'info',
  // 并发闸口：用户重复发起导出是设计内的正常分支（客户端轮询任务卡）
  [ErrorCode.EXPORT_JOB_IN_PROGRESS]: 'info',
  // 并发闸口：同账本导入任务 / 同用户检测会话（方案 §4.4 · 与导出口径一致）
  [ErrorCode.IMPORT_JOB_IN_PROGRESS]: 'info',
  [ErrorCode.DETECT_IN_PROGRESS]: 'info',

  // --- 410：TTL 到期是设计内的 ---
  [ErrorCode.INVITE_EXPIRED]: 'info',
  [ErrorCode.EXPORT_FILE_EXPIRED]: 'info',
  // 检测会话 15 分钟有效期到期 / 已被消费（方案 §4.5）
  [ErrorCode.DETECT_SESSION_EXPIRED]: 'info',

  // --- 422：业务规则拒绝，UI 有对应文案 ---
  [ErrorCode.BUSINESS_RULE_VIOLATION]: 'info',

  // --- 429：需要观测趋势（可能是攻击，也可能是阈值配得太紧） ---
  [ErrorCode.RATE_LIMITED]: 'warn',

  // --- 5xx：服务端故障 ---
  [ErrorCode.INTERNAL]: 'error',
  [ErrorCode.UNAVAILABLE]: 'error',
  [ErrorCode.TIMEOUT]: 'error',
  [ErrorCode.NOT_IMPLEMENTED]: 'warn', // 501 是"占位端点被调用"，属客户端不该调
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
 * 快捷查询：某 code 对应的日志级别。
 * 未定义时兜底 'error'（宁可吵，不可静默）。
 */
export function logLevelOf(code: ErrorCode): ErrorLogLevel {
  return ErrorLogLevels[code] ?? 'error';
}

/**
 * 模块加载期覆盖自检：保证 `ErrorHttpStatus` / `ErrorRetryStrategy` / `ErrorLogLevels`
 * 对每个 `ErrorCode` 枚举值都有明确映射。未覆盖时**立即抛错**，让应用在启动阶段就失败，
 * 避免 httpStatusOf / logLevelOf 悄悄兜底。
 *
 * 触发规则：
 *   - 新增一条 ErrorCode 后忘了同步三张映射表任一
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
    if (ErrorLogLevels[code as ErrorCode] == null) gaps.push('ErrorLogLevels');
    if (gaps.length > 0) missing.push({ code, missingIn: gaps });
  }
  if (missing.length > 0) {
    const report = missing
      .map((m) => `  - ${m.code}: missing in ${m.missingIn.join(', ')}`)
      .join('\n');
    throw new Error(
      `[ErrorCode] coverage assertion failed. The following codes are missing mappings:\n${report}\n` +
        `Fix: update ErrorHttpStatus / ErrorRetryStrategy / ErrorLogLevels in server/src/errors/ErrorCode.ts and docs/api/error-codes.md.`,
    );
  }
})();
