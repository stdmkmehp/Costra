// utils/money.ts · 金额工具（分存，decimal.js 精算）
// 卡号: COSTRA-102（重写切 decimal.js）· 原骨架: COSTRA-030
// ADR-0002 硬约束: 金额计算必须走 decimal.js
// 承接 COSTRA-118 路径 A: E.P1-1 / FU-118-6（decimal.js 切入 · yuan 入口彻底防 0.1+0.2）

import Decimal from './vendor/decimal';

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

// ─── 剪贴板金额解析 ───────────────────────────────────────────────────────────

/** 计算器整数部分最大位数（与 utils/calc.ts inputDigit 限制对齐） */
const CLIPBOARD_MAX_INT_DIGITS = 8;

/**
 * 从剪贴板任意文本中提取合法金额（元字符串，去尾零）。
 *
 * 用于记账面板"粘贴"键：把用户复制的 `¥12.34` / `共 12,345.67 元` / `１２.３４` 等
 * 各种口径的金额文本，归一为记账可用的元字符串（如 `'12.34'` / `'12345.67'` / `'12.3'`）。
 *
 * 规则（详见方案 §3.1）：
 * 1. 输入裁剪 64 字符防超长；
 * 2. 全角数字/小数点/中文句号归一为半角；
 * 3. 剔除货币符号、千分位、空白等噪声（`¥￥$` 及 `CNY/RMB/元/人民币` 等）；
 * 4. 抽取首个不紧邻英文字母的 `-?\d+(?:\.\d+)?` 子串；
 * 5. 取绝对值（记账金额恒正）；
 * 6. 超过 `CLIPBOARD_MAX_INT_DIGITS` 位整数 → 拒绝；
 * 7. 小数超过 2 位 → 向零截断到 2 位（与 toCents 保持一致，不拒绝）；
 * 8. 结果为 0 → 视为无效金额（返回 null）。
 *
 * 返回：合法元字符串（去尾零，`12.30 → '12.3'`；`12.00 → '12'`），无效则返回 null。
 */
export function parseClipboardToAmount(raw: string): string | null {
  if (typeof raw !== 'string') return null;
  // Step 1: 长度裁剪
  let s = raw.slice(0, 64).trim();
  if (!s) return null;

  // Step 2: 本地化归一
  //   全角数字 U+FF10..U+FF19 → 半角
  s = s.replace(/[\uFF10-\uFF19]/g, (ch) => String.fromCharCode(ch.charCodeAt(0) - 0xFEE0));
  //   全角点 / 中文句号 → 半角小数点
  s = s.replace(/[\uFF0E\u3002]/g, '.');
  //   千分位 / 中文逗号 / 空白 → 剔除
  s = s.replace(/[,\uFF0C\s]/g, '');
  //   常见货币符号 & 词根 → 剔除（大小写不敏感）
  s = s.replace(/[¥￥$]/g, '');
  s = s.replace(/CNY|RMB|人民币|元/gi, '');

  // Step 3: 抽取首个"纯数字"金额 token
  //   按字母/数字/点/负号连续段切 token，若 token 同时含字母则丢弃（如 abc123def / sku12.34）。
  //   token 内需能匹配 `-?\d+(\.\d+)?` 才视为候选，避免误取 `.34`、`--` 等。
  const tokens = s.match(/[A-Za-z0-9.-]+/g);
  if (!tokens) return null;
  let picked: string | null = null;
  for (const tok of tokens) {
    if (/[A-Za-z]/.test(tok)) continue; // 混入字母的 token 直接丢
    const m = tok.match(/-?\d+(?:\.\d+)?/);
    if (m) { picked = m[0]; break; }
  }
  if (!picked) return null;

  // Step 4: Decimal 解析
  let d: Decimal;
  try {
    d = new Decimal(picked);
  } catch {
    return null;
  }
  if (!d.isFinite()) return null;

  // Step 5: 取绝对值
  if (d.isNegative()) d = d.abs();

  // Step 6: 整数位上限
  const intPart = d.truncated().abs().toFixed(0);
  if (intPart.length > CLIPBOARD_MAX_INT_DIGITS) return null;

  // Step 7: 向零截断到 2 位小数（与 toCents 一致）
  d = d.toDecimalPlaces(2, Decimal.ROUND_DOWN);

  // Step 8: 0 视为无效
  if (d.isZero()) return null;

  // 返回去尾零元字符串
  const fixed = d.toFixed(2);
  if (fixed.includes('.')) {
    const trimmed = fixed.replace(/0+$/, '').replace(/\.$/, '');
    return trimmed || null;
  }
  return fixed;
}
