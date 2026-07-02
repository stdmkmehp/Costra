/**
 * Costra 分类图标唯一权威源（single source of truth）。
 *
 * 合并一级（icons-l1.mjs）+ 二级（icons-l2.mjs）全部 81 个唯一字形，
 * 以英文语义 icon_key 为键统一导出。评审页 / 预览 / TTF 构建均从本文件读取。
 *
 * icons-l1.mjs / icons-l2.mjs 为**私有分片源**，仅本文件 import；其余脚本一律从
 * icons.mjs 取用（唯一对外入口），避免多入口导致预览/构建/registry 三者漂移。
 *
 * 键（icon_key）与码点的稳定映射见 icon-registry.json；
 * 分类节点 → icon_key 的归属（含去重复用）见 design/categories.yaml。
 *
 * 每个字形值为 <g> 内部片段（inner SVG）；构建时统一包一层
 * <g fill="none" stroke="currentColor" stroke-width="1.5" ...> 并做 fit() 光学归一。
 */
import { ICONS_L1 } from './icons-l1.mjs';
import { ICONS_L2 } from './icons-l2.mjs';

// 分组视图 re-export：供评审页（gen-demo-l2）/ 预览（preview-l2）按层级消费，
// 使这些脚本无需直连分片源，唯一对外入口仍是本文件。
export { ICONS_L1, ICONS_L2 };

/**
 * 中文分类概念名 → 英文 icon_key。
 * L1 14 个 + L2 67 个 = 81 个唯一字形；名字全局唯一（L2 去重后各组子名不重叠）。
 */
const KEY_OF = {
  // —— 一级（14）——
  餐饮: 'dining', 交通: 'transport', 购物: 'shopping', 生活: 'life',
  旅行: 'travel', 文娱: 'entertainment', 转账: 'transfer', 其他: 'other',
  职业收入: 'salary', 投资与资产: 'investment', 意外收入: 'windfall',
  储值: 'stored_value', 账户互转: 'account_transfer', 赊销: 'credit',
  // —— 二级 · 餐饮（12）——
  早餐: 'breakfast', 午餐: 'lunch', 晚餐: 'dinner', 外卖: 'takeout',
  买菜: 'groceries', 水果: 'fruit', 零食: 'snack', 饮料: 'drink',
  酒水: 'alcohol', 柴米油盐: 'condiment', 聚餐: 'gathering_meal', 宴请: 'banquet',
  // —— 二级 · 交通（9）——
  打车: 'taxi', 公交地铁: 'transit', 加油: 'fuel', 停车: 'parking',
  火车高铁: 'train', 机票: 'flight', 汽车保养: 'car_maintenance',
  保险: 'insurance', 过路费: 'toll',
  // —— 二级 · 购物（5）——
  日用: 'daily_goods', 服饰: 'clothing', 数码: 'digital', 纸巾: 'tissue',
  护肤美妆: 'cosmetics',
  // —— 二级 · 生活（10）——
  宠物: 'pet', 美容美发: 'beauty', 水费: 'water_bill', 电费: 'electricity_bill',
  燃气费: 'gas_bill', 话费网费: 'telecom_bill', 物业维修: 'repair',
  医疗: 'medical', 母婴: 'baby', 租房: 'rent',
  // —— 二级 · 旅行（1）——
  酒店: 'hotel',
  // —— 二级 · 文娱（7）——
  订阅会员: 'subscription', 演出: 'performance', 游戏: 'game', 运动: 'sports',
  电影: 'movie', 门票: 'ticket', 教育: 'education',
  // —— 二级 · 转账（2）——
  还贷: 'loan_repay', 垫付: 'advance_pay',
  // —— 二级 · 其他（7）——
  红包: 'red_packet', 礼金: 'cash_gift', 赡养: 'support_family', 捐赠: 'donation',
  丢失: 'lost', 礼物: 'gift', 罚款: 'fine',
  // —— 二级 · 职业收入（3）——
  奖金: 'bonus', 兼职: 'part_time', 报销: 'reimbursement',
  // —— 二级 · 投资与资产（2）——
  收租: 'rent_income', 利息: 'interest',
  // —— 二级 · 意外收入（3）——
  退款: 'refund', 中奖: 'lottery', 闲置出售: 'resale',
  // —— 二级 · 储值（2）——
  公交卡储值: 'transit_card', 饭卡储值: 'meal_card',
  // —— 二级 · 赊销（4）——
  花呗: 'huabei', 白条: 'baitiao', 月付: 'monthly_pay', 信用卡: 'credit_card',
};

// 把二级按 组→名→svg 平铺成 名→svg（去重后各组子名全局唯一，无冲突）
const L2_FLAT = {};
for (const group of Object.values(ICONS_L2)) {
  for (const [name, svg] of Object.entries(group)) {
    if (L2_FLAT[name]) throw new Error(`icons.mjs: 二级字形名冲突 "${name}"`);
    L2_FLAT[name] = svg;
  }
}

// 名→svg 全集（一级 + 二级）
const BY_NAME = { ...ICONS_L1, ...L2_FLAT };

/** icon_key → { label(中文名), svg(inner 片段) } */
export const ICONS = {};
for (const [name, svg] of Object.entries(BY_NAME)) {
  const key = KEY_OF[name];
  if (!key) throw new Error(`icons.mjs: 缺少 "${name}" 的 icon_key 映射`);
  if (ICONS[key]) throw new Error(`icons.mjs: icon_key 重复 "${key}"（${name}）`);
  ICONS[key] = { label: name, svg };
}
