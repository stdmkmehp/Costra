// utils/entryDisplay.ts · 流水明细展示文案规则

/**
 * 排行下钻单笔明细的主文案：优先备注，无备注时回退到所属二级分类名。
 */
export function resolveEntryDisplayNote(
  note: string | null | undefined,
  fallbackCategoryName: string | null | undefined,
): string {
  const normalizedNote = (note ?? '').trim();
  if (normalizedNote) return normalizedNote;
  return (fallbackCategoryName ?? '').trim();
}
