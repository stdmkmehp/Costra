/**
 * Costra · Server · ErrorLogLevels 语义不变量单测
 *
 * 卡号：COSTRA-101 R2 · 事实源：docs/api/error-codes.md §5.3
 *
 * 背景：现网日志曾出现「用户未设置预算 → GET /budgets 返 404」被记成 warn 的情况，
 * 与真故障共用 level 40，随 DAU 增长会淹没真告警。本测锁死分级的**语义不变量**，
 * 防止未来新增 code 或调整分级时把预期业务态误升为 warn / 把服务端故障误降为 info。
 *
 * 注：映射表的**完整性**由 ErrorCode.ts 模块加载期 assertErrorCodeCoverage 保障
 *     （import 本模块即触发），本测只覆盖它管不到的语义正确性。
 */

import { describe, it, expect } from 'vitest';
import {
  ErrorCode,
  ErrorHttpStatus,
  ErrorLogLevels,
  logLevelOf,
  type ErrorLogLevel,
} from '../src/errors/ErrorCode.js';

describe('ErrorLogLevels', () => {
  it('covers every ErrorCode with a valid level', () => {
    const allowed: ErrorLogLevel[] = ['info', 'warn', 'error'];
    for (const code of Object.values(ErrorCode)) {
      expect(allowed, `${code} has invalid level`).toContain(ErrorLogLevels[code]);
    }
  });

  it('maps every 5xx to error (server faults must never be downgraded)', () => {
    for (const code of Object.values(ErrorCode)) {
      if (ErrorHttpStatus[code] >= 500 && code !== ErrorCode.NOT_IMPLEMENTED) {
        expect(logLevelOf(code), `${code} is 5xx and must log at error`).toBe('error');
      }
    }
  });

  it('maps expected business branches to info (must not pollute the warn channel)', () => {
    // 这些 code 的出现频率与用户规模正相关，且客户端都有既定处理路径。
    // 历史典型：budgetService「该账本从未设过预算」每次冷启动都会抛 NOT_FOUND ——
    // 该场景已上收到契约层（GET /budgets 未设置返 200 + JSON null）；
    // NOT_FOUND 仍为 info（客户端持过期缓存访问已删除资源等预期分支）。
    const expectedBusinessBranches = [
      ErrorCode.NOT_FOUND,
      ErrorCode.VERSION_CONFLICT,
      ErrorCode.DUPLICATE_RESOURCE,
      ErrorCode.ALREADY_MEMBER,
      ErrorCode.INVITE_EXPIRED,
      ErrorCode.BUSINESS_RULE_VIOLATION,
      ErrorCode.FAMILY_PERSONAL_NOT_DELETABLE,
      ErrorCode.TOKEN_EXPIRED,
      ErrorCode.REFRESH_TOKEN_INVALID,
    ];
    for (const code of expectedBusinessBranches) {
      expect(logLevelOf(code), `${code} is an expected branch and must log at info`).toBe('info');
    }
  });

  it('keeps suspicious client behaviour at warn (auth forgery / privilege probing / rate limit)', () => {
    const needsAttention = [
      ErrorCode.UNAUTHENTICATED,
      ErrorCode.WX_CODE_INVALID,
      ErrorCode.PERMISSION_DENIED,
      ErrorCode.FAMILY_NOT_MEMBER,
      ErrorCode.INVALID_ARGUMENT,
      ErrorCode.RATE_LIMITED,
    ];
    for (const code of needsAttention) {
      expect(logLevelOf(code), `${code} must log at warn`).toBe('warn');
    }
  });

  it('logLevelOf falls back to error for unknown codes (never silently swallow)', () => {
    expect(logLevelOf('NOT_A_REAL_CODE' as ErrorCode)).toBe('error');
  });
});
