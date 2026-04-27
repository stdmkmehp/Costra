// utils/money.ts · 金额工具（分存，decimal.js 精算）
// 卡号: COSTRA-102（重写切 decimal.js）· 原骨架: COSTRA-030
// ADR-0002 硬约束: 金额计算必须走 decimal.js
// 承接 COSTRA-118 路径 A: E.P1-1 / FU-118-6（decimal.js 切入 · yuan 入口彻底防 0.1+0.2）

import Decimal from 'decimal.js';

/**
 * 元 → 分（分为整数 · 向零截断到 2 位小数再放大）
 *
 * - 字符串 / 数字 均允许
 * - 负数：按向零截断语义 `.toDecimalPlaces(2, Decimal.ROUND_DOWN)`
 *   （与原 parse-int 语义兼容；正数 ceil / 负数 floor 取整均不会引入尾分偏差）
 * - 非法输入：抛异常（与原契约一致）
 */
export function toCents(yuan: number | string): number {
  let d: Decimal;
  try {
    d = new Decimal(typeof yuan === 'number' ? yuan : String(yuan).trim());
  } catch {
    throw new Error(`[money] invalid yuan input: ${yuan}`);
  }
  if (!d.isFinite()) {
    throw new Error(`[money] non-finite yuan input: ${yuan}`);
  }
  const cents = d.times(100).toDecimalPlaces(0, Decimal.ROUND_DOWN);
  return cents.toNumber();
}

/**
 * 分 → 元（2 位小数字符串）
 */
export function toYuan(cents: number): string {
  if (!Number.isFinite(cents)) return '0.00';
  return new Decimal(cents).dividedBy(100).toFixed(2);
}

/**
 * 带 ￥ 符号的 CNY 展示
 */
export function formatCNY(cents: number, opts: { withSymbol?: boolean } = {}): string {
  const core = toYuan(cents);
  return opts.withSymbol !== false ? `￥${core}` : core;
}

/**
 * 页面层别名：不带货币符号的元展示（= toYuan）
 */
export function formatMoney(cents: number): string {
  return toYuan(cents);
}

/**
 * 解析数字键盘 / 输入框原始字符串为分
 *
 * 容错（与原契约保持兼容）：
 * - 空串 → 0
 * - 多余非法字符 → 清洗后保留首个合法 `[-]?\d+(\.\d{0,2})?` 前缀
 * - 非法 → 0
 *
 * 清洗 + decimal 精算两段式。
 */
export function parseAmountInputToCents(input: string): number {
  const raw = (input || '').trim();
  if (!raw) return 0;

  // 只保留首个负号、数字、首个小数点（与原实现语义一致）
  const cleaned = raw.replace(/[^\d.-]/g, '');
  const m = cleaned.match(/^-?\d+(\.\d{0,2})?/);
  if (!m) return 0;

  try {
    const d = new Decimal(m[0]);
    if (!d.isFinite()) return 0;
    return d.times(100).toDecimalPlaces(0, Decimal.ROUND_DOWN).toNumber();
  } catch {
    return 0;
  }
}
