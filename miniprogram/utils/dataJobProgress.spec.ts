// utils/dataJobProgress.spec.ts · 数据任务进度与派生态单测
// 事实源：docs/design/data-import-export-client-analysis.md v1.0 §6.4/§14.2
//
// 覆盖：
//   - 阶段型模拟进度：queued 恒 0（§7.2 v1.0）· querying 20→90(τ=8s) · packaging 90→98
//     · 单调趋近不上探 100（真实完成只来自 status=succeeded）
//   - 过期派生态：file_expires_at < server_now ⇒ 过期（唯一判据出口）
//   - 有效期倒计时文案 · 文件大小格式化 · 阶段展示名

import { describe, it, expect } from 'vitest';
import {
  calcSimulatedProgress,
  isExportFileExpired,
  formatExpiresCountdown,
  formatFileSize,
  stageDisplayName,
} from './dataJobProgress';

describe('calcSimulatedProgress · 阶段型模拟进度', () => {
  it('queued：任意耗时恒 0（§7.2 v1.0 明文 · 排队常态化再补 τ 0→5）', () => {
    expect(calcSimulatedProgress('queued', 0)).toBe(0);
    expect(calcSimulatedProgress('queued', 4_000)).toBe(0);
    expect(calcSimulatedProgress('queued', 60_000)).toBe(0);
  });

  it('stage 为 null（queued 任务）⇒ 按 queued 段', () => {
    expect(calcSimulatedProgress(null, 0)).toBe(0);
  });

  it('querying：t=0 ⇒ 20 · τ=8s 后约一半 · 渐近 90 不上探', () => {
    expect(calcSimulatedProgress('querying', 0)).toBe(20);
    const mid = calcSimulatedProgress('querying', 8_000);
    expect(mid).toBeGreaterThanOrEqual(60);
    expect(mid).toBeLessThanOrEqual(70);
    expect(calcSimulatedProgress('querying', 300_000)).toBe(90);
  });

  it('packaging：t=0 ⇒ 90 · 渐近 98 · 永不到 100', () => {
    expect(calcSimulatedProgress('packaging', 0)).toBe(90);
    expect(calcSimulatedProgress('packaging', 300_000)).toBe(98);
  });

  it('validating（导入唯一可观测阶段）：t=0 ⇒ 5 · τ=8s · 渐近 90（§7.2 v1.0）', () => {
    expect(calcSimulatedProgress('validating', 0)).toBe(5);
    const mid = calcSimulatedProgress('validating', 8_000);
    expect(mid).toBeGreaterThanOrEqual(50);
    expect(mid).toBeLessThanOrEqual(70);
    expect(calcSimulatedProgress('validating', 300_000)).toBe(90);
  });

  it('负耗时按 0 处理（时钟抖动防御）', () => {
    expect(calcSimulatedProgress('querying', -1_000)).toBe(20);
  });
});

describe('isExportFileExpired · 过期派生态（server_now 基准）', () => {
  const nowMs = Date.parse('2026-09-07T12:00:00.000Z');

  it('file_expires_at < server_now ⇒ 过期', () => {
    expect(isExportFileExpired('2026-09-07T11:59:59.999Z', nowMs)).toBe(true);
  });

  it('file_expires_at = server_now ⇒ 过期（边界含等）', () => {
    expect(isExportFileExpired('2026-09-07T12:00:00.000Z', nowMs)).toBe(true);
  });

  it('file_expires_at > server_now ⇒ 未过期', () => {
    expect(isExportFileExpired('2026-09-07T12:00:00.001Z', nowMs)).toBe(false);
  });

  it('null / 非法值 ⇒ 不过期（非终态任务不派生）', () => {
    expect(isExportFileExpired(null, nowMs)).toBe(false);
    expect(isExportFileExpired('not-a-date', nowMs)).toBe(false);
  });
});

describe('formatExpiresCountdown · 有效期倒计时文案', () => {
  const nowMs = Date.parse('2026-09-07T12:00:00.000Z');

  it('23小时58分', () => {
    expect(formatExpiresCountdown('2026-09-08T11:58:00.000Z', nowMs)).toBe('23小时58分');
  });

  it('整点小时不带分', () => {
    expect(formatExpiresCountdown('2026-09-08T00:00:00.000Z', nowMs)).toBe('12小时');
  });

  it('不足 1 分钟按 1 分钟', () => {
    expect(formatExpiresCountdown('2026-09-07T12:00:30.000Z', nowMs)).toBe('1分钟');
  });

  it('已过期 / null ⇒ null（调用方改走过期分支）', () => {
    expect(formatExpiresCountdown('2026-09-07T11:00:00.000Z', nowMs)).toBeNull();
    expect(formatExpiresCountdown(null, nowMs)).toBeNull();
  });
});

describe('formatFileSize', () => {
  it('B / KB / MB 三档', () => {
    expect(formatFileSize(512)).toBe('512 B');
    expect(formatFileSize(356 * 1024)).toBe('356 KB');
    expect(formatFileSize(Math.round(12.4 * 1024 * 1024))).toBe('12.4 MB');
  });
});

describe('stageDisplayName', () => {
  it('导出固定两段 + 导入 validating + queued 兜底（§7.2 v1.0 文案）', () => {
    expect(stageDisplayName('querying')).toBe('正在整理数据');
    expect(stageDisplayName('packaging')).toBe('正在收尾');
    expect(stageDisplayName('validating')).toBe('正在导入流水');
    expect(stageDisplayName(null)).toBe('等待处理');
  });
});
