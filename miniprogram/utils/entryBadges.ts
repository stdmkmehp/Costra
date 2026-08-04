// utils/entryBadges.ts · 流水“定/公”角标唯一判定入口

export interface EntryBadgeSource {
  shared_type?: 'shared' | 'personal' | null;
  source_recurring_id?: string | null;
}

export interface EntryBadges {
  showRecurring: boolean;
  showShared: boolean;
}

/**
 * 固定展示顺序由模板保证：先“定”，后“公”。
 * 判定只依赖服务端事实字段，不根据备注、client_ref_id 等信息猜测。
 */
export function computeBadges(entry: EntryBadgeSource): EntryBadges {
  return {
    showRecurring: typeof entry.source_recurring_id === 'string'
      && entry.source_recurring_id.length > 0,
    showShared: entry.shared_type === 'shared',
  };
}
