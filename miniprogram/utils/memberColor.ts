// utils/memberColor.ts · 成员配色槽位色板（共用）
// 卡号: COSTRA-261 · Refs: COSTRA-261
// 抽自 pages/family/index.ts · 唯一事实源

/**
 * 成员配色槽位色板 · 8 色莫兰迪 + 2 备选
 *
 * 与后端 family_members.color_slot（0~7）一一对应（migration 0012）。
 * 成员加入家庭时由后端在 0..7 中分配未占用的最小 slot；离开时 slot 释放。
 * 同一 family 内 active 成员之间永不撞色（partial unique index 兜底）。
 *
 * 设计要求：低饱和（S≈25-35%）、中明度（L≈60-65%），
 * 在米白底（#f1f2ec）+ 公共石青（#6B9B8F）共存时不抢戏，相邻色相 ≥45°。
 */
export const MEMBER_COLOR_SLOTS: readonly string[] = [
  '#8AA9C4', // 0 雾霾蓝（owner 默认占）
  '#E0A074', // 1 暖橘
  '#B594B8', // 2 藕紫
  '#A4B07A', // 3 橄榄
  '#D49097', // 4 玫红
  '#C2A878', // 5 赭石
  '#8BA68E', // 6 苔绿
  '#9FA0C2', // 7 薰衣草灰紫

  // 备选色
  '#C29AA1', // 8 烟粉
  '#CCA98F', // 9 茶褐
] as const;

/**
 * 按 color_slot 取成员段颜色。
 * slot 缺失 / 越界 → 兜底 slot 0（仅用于兼容旧服务端响应，正常情况不会触发）。
 */
export function getMemberColorBySlot(slot: number | null | undefined): string {
  if (slot == null || slot < 0 || slot >= MEMBER_COLOR_SLOTS.length) {
    return MEMBER_COLOR_SLOTS[0];
  }
  return MEMBER_COLOR_SLOTS[slot];
}
