// pages/family/memberMenu.ts · 协作页成员头像气泡菜单：选项矩阵（纯函数 · 可单测）
// 卡号: COSTRA-302 · 从 index.ts 的 _buildMemberMenuItems 抽出，便于单测角色矩阵
// 设计源: docs/design/family-page-tech-spec.md §4
//
// 选项矩阵（重命名对全体 active 成员开放）：
//   1. 已 left 成员 → 调用方拦截（不进本函数）
//   2. 点自己：
//        · owner 单人 → [重命名账本 · 解散账本]
//        · owner 多人 → [重命名账本 · 退出账本 · 解散账本]（退出自动移交所有权）
//        · 普通成员   → [重命名账本 · 退出账本]
//   3. 点他人：owner → [移出账本]；普通成员 → []（无响应）

export type MemberMenuKey = 'rename' | 'leave' | 'dissolve' | 'remove';

export interface MemberMenuItem {
  key: MemberMenuKey;
  label: string;
  danger: boolean;
}

export interface MemberMenuContext {
  /** 点击对象是否为当前用户自己 */
  isSelf: boolean;
  /** 当前用户是否为账本 owner */
  isOwner: boolean;
  /** 当前账本 active 成员数（含自己） */
  activeMemberCount: number;
}

/**
 * 按「点击对象 + 当前用户角色 + active 成员数」构建气泡菜单选项。
 * 纯函数：无副作用、不依赖 this / wx，供 Page 调用与单测共用。
 */
export function buildMemberMenuItems(ctx: MemberMenuContext): MemberMenuItem[] {
  const { isSelf, isOwner, activeMemberCount } = ctx;
  const items: MemberMenuItem[] = [];

  if (isSelf) {
    // 重命名账本：全体 active 成员均可
    items.push({ key: 'rename', label: '重命名账本', danger: false });

    const isLoneOwner = isOwner && activeMemberCount === 1;
    if (isLoneOwner) {
      items.push({ key: 'dissolve', label: '解散账本', danger: true });
    } else {
      items.push({ key: 'leave', label: '退出账本', danger: true });
      if (isOwner) {
        items.push({ key: 'dissolve', label: '解散账本', danger: true });
      }
    }
  } else if (isOwner) {
    // 点他人：仅 owner 可移出
    items.push({ key: 'remove', label: '移出账本', danger: true });
  }

  return items;
}
