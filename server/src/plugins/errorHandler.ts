/**
 * Costra · Server · Fastify 统一错误处理
 *
 * 卡号：COSTRA-101 · 事实源：docs/api/error-codes.md §1.1 / server/src/errors/ErrorCode.ts
 *
 * 输出响应体：
 *   {
 *     "code": "<ErrorCode>",
 *     "message": "...",
 *     "trace_id": "<req.id>",
 *     "details": { ... }?
 *   }
 *
 * 分支优先级：
 *   1. AppError → 使用 code + httpStatus 序列化；保留 details + retryAfterSec
 *   2. Fastify 内置校验错误（`FST_ERR_VALIDATION` / error.validation）→ 映射为 INVALID_ARGUMENT
 *   3. Fastify 404 默认 → 映射为 NOT_FOUND（由 setNotFoundHandler 挂）
 *   4. 其他 Error → 转 INTERNAL，日志记录原 cause
 *
 * 注意：
 *   - 日志使用 Fastify 实例上挂的 pino logger，req.log.error 带 trace_id（req.id）。
 *   - 生产环境严禁把 Error.message / stack 直接回给客户端；只返回契约 message。
 */

import type { FastifyInstance, FastifyError, FastifyReply, FastifyRequest } from 'fastify';
import { AppError, isAppError } from '../errors/AppError.js';
import { ErrorCode, httpStatusOf } from '../errors/ErrorCode.js';

interface ErrorBody {
  code: ErrorCode;
  message: string;
  trace_id: string;
  details?: Record<string, unknown>;
}

function toAppErrorFromValidation(err: FastifyError): AppError {
  // Fastify 5 的 AJV 校验错误挂在 err.validation 上
  const first = err.validation?.[0];
  const details: Record<string, unknown> = {};
  if (first) {
    // 示例 first 结构：{ instancePath: '/amount', message: 'must be integer', keyword: 'type', ... }
    if (first.instancePath) details.field = first.instancePath.replace(/^\//, '');
    if (first.message) details.constraint = first.message;
  }
  return new AppError(ErrorCode.INVALID_ARGUMENT, {
    message: err.message || 'validation failed',
    details,
    cause: err,
  });
}

function serialize(err: AppError, req: FastifyRequest, reply: FastifyReply): void {
  const body: ErrorBody = {
    code: err.code,
    message: err.message,
    trace_id: req.id as string,
  };
  if (err.details) body.details = err.details;

  if (err.retryAfterSec != null) {
    reply.header('Retry-After', String(err.retryAfterSec));
  }

  reply.code(err.httpStatus).send(body);
}

export async function registerErrorHandler(app: FastifyInstance): Promise<void> {
  // 全局错误入口
  app.setErrorHandler((err: FastifyError, req, reply) => {
    // 分支 1：业务异常
    if (isAppError(err)) {
      req.log.warn(
        {
          code: err.code,
          httpStatus: err.httpStatus,
          details: err.details,
          cause: (err as { cause?: unknown }).cause,
        },
        'AppError thrown',
      );
      serialize(err, req, reply);
      return;
    }

    // 分支 2：Fastify 校验错误
    if (err.validation) {
      const mapped = toAppErrorFromValidation(err);
      req.log.warn({ validation: err.validation }, 'request validation failed');
      serialize(mapped, req, reply);
      return;
    }

    // 分支 3：Fastify 内置 body parse 错误
    //   3.1 不支持的 Content-Type
    if (err.code === 'FST_ERR_CTP_INVALID_MEDIA_TYPE') {
      serialize(new AppError(ErrorCode.UNSUPPORTED_MEDIA_TYPE, { message: err.message }), req, reply);
      return;
    }
    //   3.2 JSON 解析失败 / 空 body（P1-2 · D-015 round-1 revise）
    //     优先走 Fastify 5.x 稳定 code，其次兜底 JSON.parse 抛出的原生 SyntaxError。
    //     不再依赖 message.includes('unexpected token')—— V8 错误措辞随 Node 版本变动（如 Node 21 改为
    //     "Unexpected non-whitespace character"），字符串匹配不稳定。
    if (
      err.code === 'FST_ERR_CTP_EMPTY_JSON_BODY' ||
      err.code === 'FST_ERR_CTP_INVALID_JSON_BODY' ||
      err instanceof SyntaxError ||
      (err as { cause?: unknown }).cause instanceof SyntaxError
    ) {
      serialize(new AppError(ErrorCode.MALFORMED_JSON, { message: err.message }), req, reply);
      return;
    }

    // 分支 4：其他未识别错误 → INTERNAL
    req.log.error({ err }, 'unhandled error → INTERNAL');
    const fallback = new AppError(ErrorCode.INTERNAL, {
      message: 'internal server error',
      cause: err,
    });
    serialize(fallback, req, reply);
  });

  // 404 专用处理
  app.setNotFoundHandler((req, reply) => {
    const err = new AppError(ErrorCode.NOT_FOUND, {
      message: `route not found: ${req.method} ${req.url}`,
    });
    serialize(err, req, reply);
  });
}

// 仅为让 httpStatusOf 被引用（避免 tsc noUnusedLocals 误报），运行时无副作用
void httpStatusOf;
