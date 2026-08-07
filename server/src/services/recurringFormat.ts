// costra · recurringFormat.ts · T1 同源基础设施
//
// 卡号占位：COSTRA-5xx（T1 · Sprint-4 · Epic-E）
// 事实源：
//   - docs/design/recurring-entry-product-spec.md §5.3.4
//
// ★★★ byte-level 同源约束 ★★★
//   本文件必须与 server/src/services/recurringFormat.ts 内容完全一致（含空行、注释）
//   CI 由 scripts/verify-recurring-schedule-parity.mjs 卡关
//   任一处改动，两边必须同步

// ===== 类型定义（从 recurringSchedule.ts 复制 · 避免循环依赖）=====

export type Period =
  | 'weekly'
  | 'monthly'
  | 'yearly'
  | 'workday'
  | 'daily';

// ===== formatDaysForSummary · 已选日子的展示格式化 =====

export type FormatMode = 'full' | 'compact';

export interface FormatContext {
  period: Period;
  mode: FormatMode;
  days_of_week: number[] | null;
  days_of_month: number[] | null;
  year_month_days: number[] | null;
}

/**
 * 已选日子的自然语言化字符串
 *
 * mode='full'  编辑页摘要条 / 预览卡片 · 完整明确列出所有已选
 * mode='compact' 列表页副行等非编辑场景 · ≥4 天时首 2 尾 2 省略
 *
 * 事实源：product-spec §5.3.4
 */
export function formatDaysForSummary(ctx: FormatContext): string {
  switch (ctx.period) {
    case 'weekly':
      return formatDow(ctx.days_of_week ?? [], ctx.mode);
    case 'monthly':
      return formatDom(ctx.days_of_month ?? [], ctx.mode);
    case 'yearly':
      return formatYearMonthDays(ctx.year_month_days ?? [], ctx.mode);
    case 'workday':
      return '每个工作日';
    case 'daily':
      // daily 无日子概念 · 语义已完全由 period 前缀（"每天" / "每 N 天"）表达
      // 返回空串，让调用方 trim 后拼接不出现多余空格
      return '';
  }
}

const CN_DOW_CHARS = ['一', '二', '三', '四', '五', '六', '日']; // ISO 1..7

/**
 * dow 格式化
 *   full · 全选 7 天 → "每天" · 否则 "周一、二、三"
 *   compact · ≥4 天 → "周一、二、…、六、日"
 */
function formatDow(days: number[], mode: FormatMode): string {
  if (days.length === 0) return '';
  const sorted = [...new Set(days)].sort((a, b) => a - b);
  if (sorted.length === 7) return '每天';
  if (mode === 'compact' && sorted.length >= 4) {
    const chars = sorted.map((d) => CN_DOW_CHARS[d - 1]);
    return `周${chars[0]}、${chars[1]}、…、${chars[chars.length - 2]}、${chars[chars.length - 1]}`;
  }
  const chars = sorted.map((d) => CN_DOW_CHARS[d - 1]);
  return `周${chars.join('、')}`;
}

/**
 * dom 格式化 · 支持连续 3+ 天用 ~ 压缩
 *   full · "5、10~13、31 日"
 *   compact · ≥4 天 → "5、10、…、25、31 日"
 */
function formatDom(days: number[], mode: FormatMode): string {
  if (days.length === 0) return '';
  const sorted = [...new Set(days)].sort((a, b) => a - b);
  if (mode === 'compact' && sorted.length >= 4) {
    return `${sorted[0]}、${sorted[1]}、…、${sorted[sorted.length - 2]}、${sorted[sorted.length - 1]} 日`;
  }
  return `${compressRuns(sorted)} 日`;
}

/**
 * 每年 (月, 日) 组合格式化
 *   full · "1月5,17,31日、4月19,25日"
 *   compact · ≥4 组 → "1/1、2/2、…、11/11、12/12"
 */
function formatYearMonthDays(encoded: number[], mode: FormatMode): string {
  if (encoded.length === 0) return '';
  const sorted = [...new Set(encoded)].sort((a, b) => a - b);

  if (mode === 'compact' && sorted.length >= 4) {
    const toShort = (v: number) => `${Math.floor(v / 100)}/${v % 100}`;
    return `${toShort(sorted[0])}、${toShort(sorted[1])}、…、${toShort(sorted[sorted.length - 2])}、${toShort(sorted[sorted.length - 1])}`;
  }

  // full：按月合并
  const byMonth = new Map<number, number[]>();
  for (const v of sorted) {
    const m = Math.floor(v / 100);
    const d = v % 100;
    const arr = byMonth.get(m) ?? [];
    arr.push(d);
    byMonth.set(m, arr);
  }
  const months = [...byMonth.keys()].sort((a, b) => a - b);
  const parts: string[] = [];
  for (const m of months) {
    const ds = byMonth.get(m)!;
    parts.push(`${m}月${compressRunsComma(ds)}日`);
  }
  return parts.join('、');
}

/**
 * 数组压缩（逗号版· 用于年月日格式化）
 *   [5,17,31] → "5,17,31"
 *   [5,6,7,8] → "5~8"
 *   [1,2,3,10,15] → "1~3,10,15"
 */
function compressRunsComma(sorted: number[]): string {
  if (sorted.length === 0) return '';
  const groups: Array<[number, number]> = [];
  let start = sorted[0];
  let prev = sorted[0];
  for (let i = 1; i < sorted.length; i++) {
    const v = sorted[i];
    if (v === prev + 1) {
      prev = v;
    } else {
      groups.push([start, prev]);
      start = v;
      prev = v;
    }
  }
  groups.push([start, prev]);

  const parts = groups.map(([a, b]) => {
    const runLen = b - a + 1;
    if (runLen >= 3) return `${a}~${b}`;
    if (runLen === 2) return `${a},${b}`;
    return `${a}`;
  });
  return parts.join(',');
}

/**
 * 数组压缩：连续 3 个以上用 "a~b"，非连续用 "、"
 *   [5,6,7,8] → "5~8"
 *   [1,2,3,10,15] → "1~3、10、15"
 *   [1,2] → "1、2"（少于 3 个不压缩）
 */
function compressRuns(sorted: number[]): string {
  if (sorted.length === 0) return '';
  const groups: Array<[number, number]> = [];
  let start = sorted[0];
  let prev = sorted[0];
  for (let i = 1; i < sorted.length; i++) {
    const v = sorted[i];
    if (v === prev + 1) {
  prev = v;
    } else {
      groups.push([start, prev]);
    start = v;
      prev = v;
    }
  }
  groups.push([start, prev]);

  const parts = groups.map(([a, b]) => {
    const runLen = b - a + 1;
    if (runLen >= 3) return `${a}~${b}`;
    if (runLen === 2) return `${a}、${b}`;
    return `${a}`;
  });
  return parts.join('、');
}
