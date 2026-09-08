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
 *   3. Fastify 内置 body parse 错误 → UNSUPPORTED_MEDIA_TYPE / MALFORMED_JSON
 *   3b. multipart 文件超限（FST_REQ_FILE_TOO_LARGE）→ PAYLOAD_TOO_LARGE（导入方案 §9.5）
 *   4. 其他 Error → 转 INTERNAL，日志记录原 cause
 *   5. 路由未命中（setNotFoundHandler）→ NOT_FOUND
 *
 * 日志约定（COSTRA-101 R2）：
 *   - **所有出口都经 `serialize()`**，日志与响应在同一处落地，不存在"某个分支忘了记日志"
 *     或"同一次失败被打两条"的可能。
 *   - 级别由 `logLevelOf(code)` 查表决定（判据见 ErrorCode.ts:ErrorLogLevels），
 *     **本文件不做任何按 code 的条件判断**。
 *   - 日志必带 `message`：同一个 code 常有多个抛出点（如 NOT_FOUND 在 budgetService 里就有
 *     3 处），只靠 code + details 无法定位，必须靠 message 区分。
 *
 * 注意：
 *   - 日志使用 Fastify 实例上挂的 pino logger，req.log 带 trace_id（req.id）。
 *   - 生产环境严禁把 Error.message / stack 直接回给客户端；只返回契约 message。
 */

import type { FastifyInstance, FastifyError, FastifyReply, FastifyRequest } from 'fastify';
import { AppError, isAppError } from '../errors/AppError.js';
import { ErrorCode, logLevelOf } from '../errors/ErrorCode.js';

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

/**
 * 唯一出口：记日志 + 序列化响应。
 *
 * @param logExtra 额外日志字段（不进响应体）。用于把分支特有的上下文带进日志，
 *                 如 validation 明细数组、未识别错误的原始 Error（含 stack）。
 */
function serialize(
  err: AppError,
  req: FastifyRequest,
  reply: FastifyReply,
  logExtra?: Record<string, unknown>,
): void {
  req.log[logLevelOf(err.code)](
    {
      code: err.code,
      httpStatus: err.httpStatus,
      message: err.message,
      details: err.details,
      cause: (err as { cause?: unknown }).cause,
      ...logExtra,
    },
    'AppError thrown',
  );

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
      serialize(err, req, reply);
      return;
    }

    // 分支 2：Fastify 校验错误
    if (err.validation) {
      serialize(toAppErrorFromValidation(err), req, reply, { validation: err.validation });
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
    //   3.3 multipart 文件超 fileSize 上限（@fastify/multipart · 导入方案 §9.5）：
    //     该错误不是 AppError，没有映射会漏成 500 INTERNAL（用户看到"服务异常"而不是"文件太大"）。
    if (err.code === 'FST_REQ_FILE_TOO_LARGE') {
      serialize(
        new AppError(ErrorCode.PAYLOAD_TOO_LARGE, {
          message: '文件超过大小上限，请拆分后分批导入',
          cause: err,
        }),
        req,
        reply,
      );
      return;
    }

    // 分支 4：其他未识别错误 → INTERNAL
    //   响应体只回契约 message；原始 Error（含 stack）仅进日志。
    const fallback = new AppError(ErrorCode.INTERNAL, {
      message: 'internal server error',
      cause: err,
    });
    serialize(fallback, req, reply, { err });
  });

  // 404 专用处理
  app.setNotFoundHandler((req, reply) => {
    const err = new AppError(ErrorCode.NOT_FOUND, {
      message: `route not found: ${req.method} ${req.url}`,
    });
    serialize(err, req, reply);
  });
}
