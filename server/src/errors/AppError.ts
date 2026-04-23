/**
 * Costra · Server · 业务异常基类 AppError
 *
 * 卡号：COSTRA-101 · 事实源：docs/api/error-codes.md + server/src/errors/ErrorCode.ts
 *
 * 设计：
 *   - 所有业务层 / 路由层抛出的异常统一为 AppError（带 ErrorCode），
 *     由 plugins/errorHandler.ts 统一序列化为 `docs/api/error-codes.md §1` 规定的响应体。
 *   - 从 Error 派生；保留 cause 以便 pino 记录原始栈。
 *   - details 字段与 OpenAPI ErrorResponse.details 对齐，供客户端做字段级提示。
 */

import { ErrorCode, httpStatusOf } from './ErrorCode.js';

export interface AppErrorOptions {
  /** 可读错误信息（开发态 / 日志使用；生产对客户端只返回稳定的 code） */
  message?: string;
  /** 供客户端渲染字段级提示（如 `{ field: 'cursor' }`） */
  details?: Record<string, unknown>;
  /** 底层原因，便于 pino 记录 */
  cause?: unknown;
  /** 用于 Retry-After 场景（如 RATE_LIMITED 限流） */
  retryAfterSec?: number;
}

export class AppError extends Error {
  public readonly code: ErrorCode;
  public readonly httpStatus: number;
  public readonly details?: Record<string, unknown>;
  public readonly retryAfterSec?: number;

  constructor(code: ErrorCode, opts: AppErrorOptions = {}) {
    super(opts.message ?? code);
    this.name = 'AppError';
    this.code = code;
    this.httpStatus = httpStatusOf(code);
    this.details = opts.details;
    this.retryAfterSec = opts.retryAfterSec;
    if (opts.cause != null) {
      // Node 16+ 标准 cause；在 TS lib target ES2022 可直接赋值
      (this as { cause?: unknown }).cause = opts.cause;
    }
    // 正确恢复原型链（编译目标 ES2022 通常无需，保留以防万一）
    Object.setPrototypeOf(this, AppError.prototype);
  }

  /** 常用快捷构造 */
  static of(code: ErrorCode, message?: string, details?: Record<string, unknown>): AppError {
    return new AppError(code, { message, details });
  }
}

/** Type guard：用于 errorHandler 分支判断。 */
export function isAppError(e: unknown): e is AppError {
  return e instanceof AppError;
}
