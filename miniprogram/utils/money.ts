// utils/money.ts · 金额工具（分存，禁浮点）
// 卡号: COSTRA-030 · ADR-0004 §8

export function toCents(yuan: number | string): number {
  // 严禁使用 Number 直接乘 100，避免 0.1 + 0.2 类问题
  const s = typeof yuan === 'number' ? yuan.toFixed(2) : String(yuan).trim();
  const m = s.match(/^(-?)(\d+)(?:\.(\d{1,2}))?$/);
  if (!m) throw new Error(`[money] invalid yuan input: ${yuan}`);
  const sign = m[1] === '-' ? -1 : 1;
  const int = parseInt(m[2], 10);
  const frac = parseInt((m[3] || '0').padEnd(2, '0'), 10);
  return sign * (int * 100 + frac);
}

export function toYuan(cents: number): string {
  const sign = cents < 0 ? '-' : '';
  const abs = Math.abs(cents);
  const int = Math.floor(abs / 100);
  const frac = abs % 100;
  return `${sign}${int}.${String(frac).padStart(2, '0')}`;
}

export function formatCNY(cents: number, opts: { withSymbol?: boolean } = {}): string {
  const core = toYuan(cents);
  return opts.withSymbol !== false ? `￥${core}` : core;
}

/** 页面层别名：不带货币符号的元展示（= toYuan）。 */
export function formatMoney(cents: number): string {
  return toYuan(cents);
}

/**
 * 解析数字键盘/输入框输入为分。
 * 容忍：空串 → 0；多余小数 → 截断到 2 位；非法 → 0。
 * Refs: COSTRA-030, ADR-0004 §8
 */
export function parseAmountInputToCents(input: string): number {
  const raw = (input || '').trim();
  if (!raw) return 0;
  // 只保留首个负号、数字、首个小数点
  const cleaned = raw.replace(/[^\d.-]/g, '');
  const m = cleaned.match(/^(-?)(\d+)(?:\.(\d{0,2}))?/);
  if (!m) return 0;
  const sign = m[1] === '-' ? -1 : 1;
  const int = parseInt(m[2], 10);
  const frac = parseInt((m[3] || '0').padEnd(2, '0'), 10);
  return sign * (int * 100 + frac);
}
