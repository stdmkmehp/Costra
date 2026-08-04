// components/recurring-selection.ts · 定时周期多选控件共享纯函数

export interface LimitedSelectionResult {
  values: number[];
  limitRejected: boolean;
}

/**
 * 切换一个数字选项：已选则移除，未选则在上限内追加。
 * 保留用户点击顺序；展示格式化函数负责排序。
 */
export function toggleLimitedSelection(
  current: readonly number[],
  candidate: number,
  max: number,
): LimitedSelectionResult {
  const index = current.indexOf(candidate);
  if (index >= 0) {
    return {
      values: current.filter((_, itemIndex) => itemIndex !== index),
      limitRejected: false,
    };
  }
  if (current.length >= max) {
    return { values: [...current], limitRejected: true };
  }
  return { values: [...current, candidate], limitRejected: false };
}

/** 返回第一个有选中项的月份；无选择时默认 1 月。 */
export function findFirstSelectedMonth(values: readonly number[]): number {
  if (values.length === 0) return 1;
  return Math.min(...values.map((encoded) => Math.floor(encoded / 100)));
}

/** 统计 yearly 编码数组中每个月的已选数量，供月份徽标展示。 */
export function countYearMonthBadges(values: readonly number[]): Record<number, number> {
  const badges: Record<number, number> = {};
  for (const encoded of values) {
    const month = Math.floor(encoded / 100);
    badges[month] = (badges[month] || 0) + 1;
  }
  return badges;
}
