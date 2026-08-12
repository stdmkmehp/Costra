// pages/family/memberMenu.ts · 协作页成员头像气泡菜单：选项矩阵（纯函数 · 可单测）
// 卡号: COSTRA-302 · 从 index.ts 的 _buildMemberMenuItems 抽出，便于单测角色矩阵
// 设计源: docs/design/family-page-tech-spec.md §4
//
// 选项矩阵（重命名 + 换颜色对全体 active 成员开放）：
//   1. 已 left 成员 → 调用方拦截（不进本函数）
//   2. 点自己：
//        · owner 单人 → [重命名账本 · 换颜色 · 解散账本]
//        · owner 多人 → [重命名账本 · 换颜色 · 退出账本 · 解散账本]（退出自动移交所有权）
//        · 普通成员   → [重命名账本 · 换颜色 · 退出账本]
//   3. 点他人：owner → [移出账本]；普通成员 → []（无响应）
//
// 语义防御：personal family（个人账本）不开放"换颜色"。
//   · 产品语义：个人账本无成员协作，代表色不参与任何 UI 展示
//   · 当前 personal family 走 solo 态、无头像入口，天然不会触发本函数
//   · 但仍在此显式过滤，避免未来复用组件/路径变化时踩坑

export type MemberMenuKey = 'rename' | 'colorChoice' | 'leave' | 'dissolve' | 'remove';

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
  /**
   * 账本类型（personal | shared）。
   * 未传时按 shared 处理（向后兼容既有调用点）。
   * personal 时不下发"换颜色"项——个人账本代表色无使用场景。
   */
  familyKind?: 'personal' | 'shared';
}

/**
 * 按「点击对象 + 当前用户角色 + active 成员数 + 账本类型」构建气泡菜单选项。
 * 纯函数：无副作用、不依赖 this / wx，供 Page 调用与单测共用。
 */
export function buildMemberMenuItems(ctx: MemberMenuContext): MemberMenuItem[] {
  const { isSelf, isOwner, activeMemberCount, familyKind } = ctx;
  const items: MemberMenuItem[] = [];

  if (isSelf) {
    // 重命名账本：全体 active 成员均可
    items.push({ key: 'rename', label: '重命名账本', danger: false });
    // 换颜色：全体 active 成员均可（migration 0017 · 自选代表色）
    //   personal family 不下发（无使用场景 + 后端 403 守门）
    if (familyKind !== 'personal') {
      items.push({ key: 'colorChoice', label: '换颜色', danger: false });
    }

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
