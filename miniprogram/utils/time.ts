// utils/time.ts · 时间工具（UTC 存储 / 用户时区展示）
// 卡号: COSTRA-102（修正 P0-8）· 原骨架: COSTRA-030 · ADR-0004 §10
// 承接 COSTRA-118 路径 A: E.P0-8（toUtcIso 双减时区 BUG 修复）

/** 返回 RFC3339/ISO 字符串（UTC） */
export function nowIsoUtc(): string {
  return new Date().toISOString();
}

/**
 * 将 Date 转为 UTC ISO。
 *
 * P0-8 修复：JavaScript 的 `Date#toISOString()` 本身就是 UTC，
 * 原骨架代码 `new Date(d.getTime() - d.getTimezoneOffset() * 60_000).toISOString()`
 * 会**再减一次时区偏移**，导致本地构造的 Date 产生双减 bug（东八区下得到 16 小时前的时间）。
 * 正确做法：直接返回 `d.toISOString()`。
 *
 * 数学直觉：
 *   Date 内部存的就是 UTC ms。toISOString 直接格式化 UTC ms 为 ISO UTC 字符串，
 *   无需任何偏移计算；任何偏移操作都是错误的。
 */
export function toUtcIso(d: Date): string {
  return d.toISOString();
}

/** 解析 ISO 并按用户本地时区格式化为 'YYYY-MM-DD HH:mm' */
export function fmtLocal(iso: string): string {
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/**
 * 组装记账 occurred_at：本地自然日（YYYY-MM-DD）+ timeSource 的本地时分秒（含毫秒）。
 *
 * 语义（2026-09-11 起，取代旧的"非今天固定 UTC 12:00"兜底）：
 *   - 新增记账：timeSource 传当前时刻 —— 补记也保留"录入当下"的时分秒；
 *   - 编辑改期：timeSource 传原 occurred_at 解析出的 Date —— 仅换日期，时分秒原样保留。
 *
 * dateKey 取自日期选择器 / getLocalDateValue，恒为合法 YYYY-MM-DD，不做防御性校验。
 */
export function combineDateKeyWithTimeOfDay(dateKey: string, timeSource: Date): string {
  const [year, month, day] = dateKey.split('-').map(Number);
  return new Date(
    year, month - 1, day,
    timeSource.getHours(), timeSource.getMinutes(),
    timeSource.getSeconds(), timeSource.getMilliseconds(),
  ).toISOString();
}
