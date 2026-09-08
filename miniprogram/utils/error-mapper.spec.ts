// utils/error-mapper.spec.ts · describeDataJobError 单测
// 事实源：docs/design/data-import-export-client-analysis.md §9.5「data_jobs.error_code 的取值域」
//
// 该函数是 data_jobs 失败原因的**唯一**用户文案出口（禁渲染服务端 error_message），
// 故这里锁死「§9.5 值域全覆盖」——服务端新增 error_code 而客户端漏登记时，
// 用户只会看到无信息量的兜底文案，本用例即是那道闸门。

import { describe, it, expect } from 'vitest';
import { describeDataJobError } from './error-mapper';

/** §9.5 值域（与 server/api/openapi.yaml DataJob.error.code enum 同源） */
const ERROR_CODES = [
  'ARTIFACT_MISSING',
  'CONTEXT_INVALIDATED',
  'CONSTRAINT_VIOLATION',
  'TRANSIENT_DB',
  'TRANSIENT_IO',
  'WORKER_LOST',
  'QUEUE_LEASE_EXPIRED',
  'INTERNAL',
] as const;

const FALLBACK = '网络异常，请稍后再试';

describe('describeDataJobError', () => {
  it('§9.5 值域全部有专属文案（无一落到兜底）', () => {
    for (const code of ERROR_CODES) {
      const text = describeDataJobError(code);
      expect(text, `${code} 未登记文案`).not.toBe(FALLBACK);
      expect(text.length, `${code} 文案为空`).toBeGreaterThan(0);
    }
  });

  it('不可重试类指向「重新检测」，瞬态类指向「稍后重试」', () => {
    expect(describeDataJobError('ARTIFACT_MISSING')).toContain('重新检测');
    expect(describeDataJobError('CONTEXT_INVALIDATED')).toContain('重新检测');
    expect(describeDataJobError('CONSTRAINT_VIOLATION')).toContain('重新检测');
    expect(describeDataJobError('TRANSIENT_DB')).toContain('稍后重试');
    expect(describeDataJobError('TRANSIENT_IO')).toContain('稍后重试');
    // 中间态 code（markRetryQueued 保留上次失败原因 · status 仍为 queued）
    expect(describeDataJobError('WORKER_LOST')).toContain('稍后重试');
    // 排队租约到期：闸口已释放，引导重新发起而非重新检测
    expect(describeDataJobError('QUEUE_LEASE_EXPIRED')).toContain('重新发起');
  });

  it('未知 code / null / undefined ⇒ 兜底文案（与 mapError 同款）', () => {
    expect(describeDataJobError('SOMETHING_NEW')).toBe(FALLBACK);
    expect(describeDataJobError(null)).toBe(FALLBACK);
    expect(describeDataJobError(undefined)).toBe(FALLBACK);
    expect(describeDataJobError('')).toBe(FALLBACK);
  });
});
