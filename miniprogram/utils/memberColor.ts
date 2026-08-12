// utils/memberColor.ts · 成员配色槽位色板（共用）
// 卡号: COSTRA-261 · Refs: COSTRA-261
// 抽自 pages/family/index.ts · 唯一事实源
//
// ─── 扩展 checklist（对外开放色数变更时须同步的位置） ─────────────────────────
// 当前对外开放前 8 色（index 0..7），索引 8/9 为内部备选保留。
// 若未来需要扩容（如放开到 10 色）或缩容，以下 6 处必须同步改：
//   1. 本文件 MEMBER_COLOR_SLOTS 数组长度 + 注释里"当前 8 色对外"的说明
//   2. server/db/migrations/00XX_*.sql · family_members.color_choice 的 CHECK 约束
//      （0017 现为 `BETWEEN 0 AND 7`）
//   3. server/api/openapi.yaml · FamilyMember.color_choice / FamilySummaryMember.color_choice
//      / PATCH /members/me/color 的 `maximum` 字段
//   4. server/src/routes/families.ts · updateMyColorBodySchema 的 maximum
//   5. server/src/services/familyService.ts · updateMyColorChoice 的范围兜底校验
//   6. miniprogram/pages/family/index.ts · `_openColorPicker` 里
//      `MEMBER_COLOR_SLOTS.slice(0, 8)` 的截取上界
// 建议：修改时先改 DB migration，其余按调用链依次同步；跑 vitest 全绿再提交。

/**
 * 成员配色色板 · 8 色莫兰迪
 *
 * 与后端 family_members.color_choice（0~7）一一对应（migration 0017）。
 * 成员加入家庭时由后端在 0..7 中分配未占用的最小 seat_order；离开时 seat 释放。
 * color_choice 初始 = seat_order，用户可自行从 8 色中选一个作为代表色（允许撞色）。
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

  // 备选色（当前不开放给用户选择，保留供未来扩展 · 参见文件顶部扩展 checklist）
  '#C29AA1', // 8 烟粉
  '#CCA98F', // 9 茶褐
] as const;

/**
 * 按 color_choice 取成员段颜色。
 * choice 缺失 / 越界 → 兜底 slot 0（仅用于兼容旧服务端响应，正常情况不会触发）。
 */
export function getMemberColorByChoice(choice: number | null | undefined): string {
  if (choice == null || choice < 0 || choice >= MEMBER_COLOR_SLOTS.length) {
    return MEMBER_COLOR_SLOTS[0];
  }
  return MEMBER_COLOR_SLOTS[choice];
}
