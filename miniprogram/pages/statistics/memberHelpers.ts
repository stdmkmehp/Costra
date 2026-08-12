// pages/statistics/memberHelpers.ts · 统计页成员相关辅助函数
// 卡号: COSTRA-264 · P0 拆分 index.ts 低于 1000 行
// Refs: COSTRA-264

import { getMemberColorByChoice } from '../../utils/memberColor';
import { getToken } from '../../services/auth';
import type { FamilyMember } from '../../services/familyApi';
import type { MemberTabItem } from './types';

/** 构造"全部"tab 项 */
export function makeAllTab(): MemberTabItem {
  return {
    key: 'all', type: 'all', label: '全部',
    avatarUrl: '', initial: '', color: '#1c1b1a', status: 'active',
  };
}

/**
 * 按 D5 排序规则构造 memberTabs：
 * [全部] → 自己（优先） → active 成员（seat_order 升序） → left 成员（left_at 升序）
 *
 * 排序用 seat_order（座位号，唯一、稳定）；取色用 color_choice（用户自选偏好，允许撞色）。
 */
export function buildMemberTabs(members: FamilyMember[]): MemberTabItem[] {
  const currentUserId = getToken()?.raw?.user?.id || '';
  const active = members.filter((m) => m.status === 'active');
  const left = members.filter((m) => m.status === 'left');

  active.sort((a, b) => {
    if (a.user_id === currentUserId) return -1;
    if (b.user_id === currentUserId) return 1;
    return (a.seat_order ?? 99) - (b.seat_order ?? 99);
  });

  left.sort((a, b) => {
    const ta = a.left_at ? new Date(a.left_at).getTime() : 0;
    const tb = b.left_at ? new Date(b.left_at).getTime() : 0;
    return ta - tb;
  });

  const tabs: MemberTabItem[] = [makeAllTab()];
  for (const m of [...active, ...left]) {
    tabs.push({
      key: m.user_id,
      type: 'member',
      label: m.nickname || '未知',
      avatarUrl: m.avatar_url || '',
      initial: (m.nickname || '?')[0],
      color: getMemberColorByChoice(m.color_choice),
      status: m.status,
    });
  }
  return tabs;
}
