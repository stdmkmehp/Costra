// services/categoryService.ts · 分类数据服务（API 调用 + 本地缓存 + 树构建 + 去重映射）
// 卡号: COSTRA-219 · 分类数据模型替换硬编码
// 依赖: services/request.ts（统一请求层）/ services/storage.ts（async envelope）/ services/family.ts（getActiveFamilyId）
// 契约事实源: server/api/openapi.yaml → GET /categories → Category schema
// 设计源: design/ui/category_dictionary.md（去重直选归属规则）

import { request } from './request';
import { getItem, setItem } from './storage';

// ─── 类型定义 ──────────────────────────────────────────────────────────────────

/** 对齐 OpenAPI Category schema（UUID id · snake_case → camelCase 映射） */
export interface CategoryItem {
  id: string;               // UUID
  familyId: string | null;  // null = 系统预设
  name: string;
  type: 'income' | 'expense';
  icon: string;             // 单字符图标（API 返回直接使用）
  color?: string;
  sortOrder: number;
  isSystem: boolean;
  parentId: string | null;  // null = 一级分类
  isDirectDefault: boolean; // 全局二级展示区直选默认归属标记
  childrenCount: number;
}

/** API 返回的原始 snake_case 结构（用于解析响应） */
interface CategoryRaw {
  id: string;
  family_id: string | null;
  name: string;
  type: 'income' | 'expense';
  icon: string;
  color?: string;
  sort_order: number;
  is_system: boolean;
  parent_id: string | null;
  is_direct_default: boolean;
  children_count: number;
}

/** 树形结构：一级分类 + 子分类 */
export interface CategoryTier1 {
  id: string;
  name: string;
  icon: string;
  color?: string;
  children: CategoryTier2[];
}

/** 二级分类 */
export interface CategoryTier2 {
  id: string;
  name: string;
  icon: string;
  color?: string;
}

/** 去重直选归属映射：二级分类名 → 一级分类 id */
export type DedupMapping = Record<string, string>;

// ─── 缓存常量 ─────────────────────────────────────────────────────────────────

/** 缓存 key 前缀（拼 familyId 区分家庭） */
const CACHE_KEY_PREFIX = 'categories_cache_';
/** 缓存 TTL：24 小时（毫秒） */
const CACHE_TTL_MS = 24 * 60 * 60 * 1000;

// ─── 内嵌 fallback 数据 ─────────────────────────────────────────────────────────
// API 不可达 + 缓存也无时使用。ID 使用 UUID 占位符（不是旧 slug）。
// 数据来源: design/ui/category_dictionary.md

const FALLBACK_UUIDS = {
  // 支出一级
  food: '00000000-0000-4000-8000-000000000001',
  transport: '00000000-0000-4000-8000-000000000002',
  shopping: '00000000-0000-4000-8000-000000000003',
  lifestyle: '00000000-0000-4000-8000-000000000004',
  travel: '00000000-0000-4000-8000-000000000005',
  entertainment: '00000000-0000-4000-8000-000000000006',
  auto: '00000000-0000-4000-8000-000000000007',
  others: '00000000-0000-4000-8000-000000000008',
  // 收入一级
  career: '00000000-0000-4000-8000-000000000101',
  investment: '00000000-0000-4000-8000-000000000102',
  windfall: '00000000-0000-4000-8000-000000000103',
  // 支出二级
  food_dining: '10000000-0000-4000-8000-000000000001',
  food_delivery: '10000000-0000-4000-8000-000000000002',
  food_groceries: '10000000-0000-4000-8000-000000000003',
  food_snacks: '10000000-0000-4000-8000-000000000004',
  food_beverages: '10000000-0000-4000-8000-000000000005',
  food_drinks: '10000000-0000-4000-8000-000000000006',
  transport_transit: '10000000-0000-4000-8000-000000000007',
  transport_taxi: '10000000-0000-4000-8000-000000000008',
  transport_bus: '10000000-0000-4000-8000-000000000009',
  transport_subway: '10000000-0000-4000-8000-000000000010',
  transport_train: '10000000-0000-4000-8000-000000000011',
  transport_flight: '10000000-0000-4000-8000-000000000012',
  shopping_general: '10000000-0000-4000-8000-000000000013',
  shopping_daily: '10000000-0000-4000-8000-000000000014',
  shopping_clothing: '10000000-0000-4000-8000-000000000015',
  shopping_electronics: '10000000-0000-4000-8000-000000000016',
  shopping_snacks: '10000000-0000-4000-8000-000000000017',
  shopping_tissues: '10000000-0000-4000-8000-000000000018',
  shopping_beverages: '10000000-0000-4000-8000-000000000019',
  lifestyle_general: '10000000-0000-4000-8000-000000000020',
  lifestyle_groceries: '10000000-0000-4000-8000-000000000021',
  lifestyle_beauty: '10000000-0000-4000-8000-000000000022',
  lifestyle_pets: '10000000-0000-4000-8000-000000000023',
  lifestyle_housing: '10000000-0000-4000-8000-000000000024',
  lifestyle_utilities: '10000000-0000-4000-8000-000000000025',
  lifestyle_phone: '10000000-0000-4000-8000-000000000026',
  lifestyle_maintenance: '10000000-0000-4000-8000-000000000027',
  lifestyle_home: '10000000-0000-4000-8000-000000000028',
  travel_general: '10000000-0000-4000-8000-000000000029',
  travel_flight: '10000000-0000-4000-8000-000000000030',
  travel_hotel: '10000000-0000-4000-8000-000000000031',
  travel_transit: '10000000-0000-4000-8000-000000000032',
  travel_train: '10000000-0000-4000-8000-000000000033',
  travel_dining: '10000000-0000-4000-8000-000000000034',
  entertainment_general: '10000000-0000-4000-8000-000000000035',
  entertainment_games: '10000000-0000-4000-8000-000000000036',
  entertainment_movies: '10000000-0000-4000-8000-000000000037',
  entertainment_tickets: '10000000-0000-4000-8000-000000000038',
  entertainment_education: '10000000-0000-4000-8000-000000000039',
  entertainment_medical: '10000000-0000-4000-8000-000000000040',
  entertainment_books: '10000000-0000-4000-8000-000000000041',
  entertainment_sports: '10000000-0000-4000-8000-000000000042',
  auto_general: '10000000-0000-4000-8000-000000000043',
  auto_gas: '10000000-0000-4000-8000-000000000044',
  auto_parking: '10000000-0000-4000-8000-000000000045',
  auto_maintenance: '10000000-0000-4000-8000-000000000046',
  auto_tolls: '10000000-0000-4000-8000-000000000047',
  others_general: '10000000-0000-4000-8000-000000000048',
  others_social: '10000000-0000-4000-8000-000000000049',
  others_donations: '10000000-0000-4000-8000-000000000050',
  others_lost: '10000000-0000-4000-8000-000000000051',
  // 收入二级
  career_salary: '11000000-0000-4000-8000-000000000001',
  career_bonus: '11000000-0000-4000-8000-000000000002',
  career_parttime: '11000000-0000-4000-8000-000000000003',
  career_reimbursement: '11000000-0000-4000-8000-000000000004',
  investment_general: '11000000-0000-4000-8000-000000000005',
  investment_rent: '11000000-0000-4000-8000-000000000006',
  investment_interest: '11000000-0000-4000-8000-000000000007',
  windfall_gifts: '11000000-0000-4000-8000-000000000008',
  windfall_lottery: '11000000-0000-4000-8000-000000000009',
  windfall_secondhand: '11000000-0000-4000-8000-000000000010',
  windfall_others: '11000000-0000-4000-8000-000000000011',
} as const;

/** 内嵌 fallback 静态数据（API 不可达 + 缓存也无时降级用） */
function getFallbackItems(): CategoryItem[] {
  const F = FALLBACK_UUIDS;
  return [
    // ─── 支出一级 ───
    { id: F.food, familyId: null, name: '餐饮', type: 'expense', icon: '餐', sortOrder: 1, isSystem: true, parentId: null, isDirectDefault: false, childrenCount: 6 },
    { id: F.transport, familyId: null, name: '交通', type: 'expense', icon: '行', sortOrder: 2, isSystem: true, parentId: null, isDirectDefault: false, childrenCount: 6 },
    { id: F.shopping, familyId: null, name: '购物', type: 'expense', icon: '购', sortOrder: 3, isSystem: true, parentId: null, isDirectDefault: false, childrenCount: 7 },
    { id: F.lifestyle, familyId: null, name: '生活', type: 'expense', icon: '活', sortOrder: 4, isSystem: true, parentId: null, isDirectDefault: false, childrenCount: 9 },
    { id: F.travel, familyId: null, name: '旅行', type: 'expense', icon: '旅', sortOrder: 5, isSystem: true, parentId: null, isDirectDefault: false, childrenCount: 6 },
    { id: F.entertainment, familyId: null, name: '文娱', type: 'expense', icon: '娱', sortOrder: 6, isSystem: true, parentId: null, isDirectDefault: false, childrenCount: 8 },
    { id: F.auto, familyId: null, name: '汽车', type: 'expense', icon: '车', sortOrder: 7, isSystem: true, parentId: null, isDirectDefault: false, childrenCount: 5 },
    { id: F.others, familyId: null, name: '其他', type: 'expense', icon: '他', sortOrder: 8, isSystem: true, parentId: null, isDirectDefault: false, childrenCount: 4 },
    // ─── 支出二级 ───
    { id: F.food_dining, familyId: null, name: '餐饮', type: 'expense', icon: '餐', sortOrder: 1, isSystem: true, parentId: F.food, isDirectDefault: true, childrenCount: 0 },
    { id: F.food_delivery, familyId: null, name: '外卖', type: 'expense', icon: '餐', sortOrder: 2, isSystem: true, parentId: F.food, isDirectDefault: false, childrenCount: 0 },
    { id: F.food_groceries, familyId: null, name: '买菜', type: 'expense', icon: '餐', sortOrder: 3, isSystem: true, parentId: F.food, isDirectDefault: true, childrenCount: 0 },
    { id: F.food_snacks, familyId: null, name: '零食', type: 'expense', icon: '餐', sortOrder: 4, isSystem: true, parentId: F.food, isDirectDefault: true, childrenCount: 0 },
    { id: F.food_beverages, familyId: null, name: '饮料', type: 'expense', icon: '餐', sortOrder: 5, isSystem: true, parentId: F.food, isDirectDefault: true, childrenCount: 0 },
    { id: F.food_drinks, familyId: null, name: '酒水', type: 'expense', icon: '餐', sortOrder: 6, isSystem: true, parentId: F.food, isDirectDefault: false, childrenCount: 0 },
    { id: F.transport_transit, familyId: null, name: '交通', type: 'expense', icon: '行', sortOrder: 1, isSystem: true, parentId: F.transport, isDirectDefault: true, childrenCount: 0 },
    { id: F.transport_taxi, familyId: null, name: '打车', type: 'expense', icon: '行', sortOrder: 2, isSystem: true, parentId: F.transport, isDirectDefault: false, childrenCount: 0 },
    { id: F.transport_bus, familyId: null, name: '公交', type: 'expense', icon: '行', sortOrder: 3, isSystem: true, parentId: F.transport, isDirectDefault: false, childrenCount: 0 },
    { id: F.transport_subway, familyId: null, name: '地铁', type: 'expense', icon: '行', sortOrder: 4, isSystem: true, parentId: F.transport, isDirectDefault: false, childrenCount: 0 },
    { id: F.transport_train, familyId: null, name: '火车/高铁', type: 'expense', icon: '行', sortOrder: 5, isSystem: true, parentId: F.transport, isDirectDefault: false, childrenCount: 0 },
    { id: F.transport_flight, familyId: null, name: '机票', type: 'expense', icon: '行', sortOrder: 6, isSystem: true, parentId: F.transport, isDirectDefault: true, childrenCount: 0 },
    { id: F.shopping_general, familyId: null, name: '购物', type: 'expense', icon: '购', sortOrder: 1, isSystem: true, parentId: F.shopping, isDirectDefault: true, childrenCount: 0 },
    { id: F.shopping_daily, familyId: null, name: '日用', type: 'expense', icon: '购', sortOrder: 2, isSystem: true, parentId: F.shopping, isDirectDefault: false, childrenCount: 0 },
    { id: F.shopping_clothing, familyId: null, name: '服饰', type: 'expense', icon: '购', sortOrder: 3, isSystem: true, parentId: F.shopping, isDirectDefault: false, childrenCount: 0 },
    { id: F.shopping_electronics, familyId: null, name: '数码', type: 'expense', icon: '购', sortOrder: 4, isSystem: true, parentId: F.shopping, isDirectDefault: false, childrenCount: 0 },
    { id: F.shopping_snacks, familyId: null, name: '零食', type: 'expense', icon: '购', sortOrder: 5, isSystem: true, parentId: F.shopping, isDirectDefault: false, childrenCount: 0 },
    { id: F.shopping_tissues, familyId: null, name: '纸巾', type: 'expense', icon: '购', sortOrder: 6, isSystem: true, parentId: F.shopping, isDirectDefault: false, childrenCount: 0 },
    { id: F.shopping_beverages, familyId: null, name: '饮料', type: 'expense', icon: '购', sortOrder: 7, isSystem: true, parentId: F.shopping, isDirectDefault: false, childrenCount: 0 },
    { id: F.lifestyle_general, familyId: null, name: '生活', type: 'expense', icon: '活', sortOrder: 1, isSystem: true, parentId: F.lifestyle, isDirectDefault: true, childrenCount: 0 },
    { id: F.lifestyle_groceries, familyId: null, name: '买菜', type: 'expense', icon: '活', sortOrder: 2, isSystem: true, parentId: F.lifestyle, isDirectDefault: false, childrenCount: 0 },
    { id: F.lifestyle_beauty, familyId: null, name: '护肤美容', type: 'expense', icon: '活', sortOrder: 3, isSystem: true, parentId: F.lifestyle, isDirectDefault: false, childrenCount: 0 },
    { id: F.lifestyle_pets, familyId: null, name: '宠物', type: 'expense', icon: '活', sortOrder: 4, isSystem: true, parentId: F.lifestyle, isDirectDefault: false, childrenCount: 0 },
    { id: F.lifestyle_housing, familyId: null, name: '住房', type: 'expense', icon: '活', sortOrder: 5, isSystem: true, parentId: F.lifestyle, isDirectDefault: false, childrenCount: 0 },
    { id: F.lifestyle_utilities, familyId: null, name: '水电煤', type: 'expense', icon: '活', sortOrder: 6, isSystem: true, parentId: F.lifestyle, isDirectDefault: false, childrenCount: 0 },
    { id: F.lifestyle_phone, familyId: null, name: '话费网费', type: 'expense', icon: '活', sortOrder: 7, isSystem: true, parentId: F.lifestyle, isDirectDefault: false, childrenCount: 0 },
    { id: F.lifestyle_maintenance, familyId: null, name: '物业维修', type: 'expense', icon: '活', sortOrder: 8, isSystem: true, parentId: F.lifestyle, isDirectDefault: false, childrenCount: 0 },
    { id: F.lifestyle_home, familyId: null, name: '家居', type: 'expense', icon: '活', sortOrder: 9, isSystem: true, parentId: F.lifestyle, isDirectDefault: false, childrenCount: 0 },
    { id: F.travel_general, familyId: null, name: '旅行', type: 'expense', icon: '旅', sortOrder: 1, isSystem: true, parentId: F.travel, isDirectDefault: true, childrenCount: 0 },
    { id: F.travel_flight, familyId: null, name: '机票', type: 'expense', icon: '旅', sortOrder: 2, isSystem: true, parentId: F.travel, isDirectDefault: false, childrenCount: 0 },
    { id: F.travel_hotel, familyId: null, name: '酒店', type: 'expense', icon: '旅', sortOrder: 3, isSystem: true, parentId: F.travel, isDirectDefault: false, childrenCount: 0 },
    { id: F.travel_transit, familyId: null, name: '交通', type: 'expense', icon: '旅', sortOrder: 4, isSystem: true, parentId: F.travel, isDirectDefault: false, childrenCount: 0 },
    { id: F.travel_train, familyId: null, name: '火车', type: 'expense', icon: '旅', sortOrder: 5, isSystem: true, parentId: F.travel, isDirectDefault: false, childrenCount: 0 },
    { id: F.travel_dining, familyId: null, name: '餐饮', type: 'expense', icon: '旅', sortOrder: 6, isSystem: true, parentId: F.travel, isDirectDefault: false, childrenCount: 0 },
    { id: F.entertainment_general, familyId: null, name: '文娱', type: 'expense', icon: '娱', sortOrder: 1, isSystem: true, parentId: F.entertainment, isDirectDefault: true, childrenCount: 0 },
    { id: F.entertainment_games, familyId: null, name: '游戏', type: 'expense', icon: '娱', sortOrder: 2, isSystem: true, parentId: F.entertainment, isDirectDefault: false, childrenCount: 0 },
    { id: F.entertainment_movies, familyId: null, name: '电影', type: 'expense', icon: '娱', sortOrder: 3, isSystem: true, parentId: F.entertainment, isDirectDefault: false, childrenCount: 0 },
    { id: F.entertainment_tickets, familyId: null, name: '门票', type: 'expense', icon: '娱', sortOrder: 4, isSystem: true, parentId: F.entertainment, isDirectDefault: false, childrenCount: 0 },
    { id: F.entertainment_education, familyId: null, name: '教育', type: 'expense', icon: '娱', sortOrder: 5, isSystem: true, parentId: F.entertainment, isDirectDefault: false, childrenCount: 0 },
    { id: F.entertainment_medical, familyId: null, name: '医疗', type: 'expense', icon: '娱', sortOrder: 6, isSystem: true, parentId: F.entertainment, isDirectDefault: false, childrenCount: 0 },
    { id: F.entertainment_books, familyId: null, name: '书籍', type: 'expense', icon: '娱', sortOrder: 7, isSystem: true, parentId: F.entertainment, isDirectDefault: false, childrenCount: 0 },
    { id: F.entertainment_sports, familyId: null, name: '运动', type: 'expense', icon: '娱', sortOrder: 8, isSystem: true, parentId: F.entertainment, isDirectDefault: false, childrenCount: 0 },
    { id: F.auto_general, familyId: null, name: '汽车', type: 'expense', icon: '车', sortOrder: 1, isSystem: true, parentId: F.auto, isDirectDefault: true, childrenCount: 0 },
    { id: F.auto_gas, familyId: null, name: '加油', type: 'expense', icon: '车', sortOrder: 2, isSystem: true, parentId: F.auto, isDirectDefault: false, childrenCount: 0 },
    { id: F.auto_parking, familyId: null, name: '停车', type: 'expense', icon: '车', sortOrder: 3, isSystem: true, parentId: F.auto, isDirectDefault: false, childrenCount: 0 },
    { id: F.auto_maintenance, familyId: null, name: '保养', type: 'expense', icon: '车', sortOrder: 4, isSystem: true, parentId: F.auto, isDirectDefault: false, childrenCount: 0 },
    { id: F.auto_tolls, familyId: null, name: '过路费', type: 'expense', icon: '车', sortOrder: 5, isSystem: true, parentId: F.auto, isDirectDefault: false, childrenCount: 0 },
    { id: F.others_general, familyId: null, name: '其他', type: 'expense', icon: '他', sortOrder: 1, isSystem: true, parentId: F.others, isDirectDefault: true, childrenCount: 0 },
    { id: F.others_social, familyId: null, name: '人情', type: 'expense', icon: '他', sortOrder: 2, isSystem: true, parentId: F.others, isDirectDefault: false, childrenCount: 0 },
    { id: F.others_donations, familyId: null, name: '捐赠', type: 'expense', icon: '他', sortOrder: 3, isSystem: true, parentId: F.others, isDirectDefault: false, childrenCount: 0 },
    { id: F.others_lost, familyId: null, name: '丢失', type: 'expense', icon: '他', sortOrder: 4, isSystem: true, parentId: F.others, isDirectDefault: false, childrenCount: 0 },
    // ─── 收入一级 ───
    { id: F.career, familyId: null, name: '职业收入', type: 'income', icon: '薪', sortOrder: 1, isSystem: true, parentId: null, isDirectDefault: false, childrenCount: 4 },
    { id: F.investment, familyId: null, name: '投资与资产', type: 'income', icon: '投', sortOrder: 2, isSystem: true, parentId: null, isDirectDefault: false, childrenCount: 3 },
    { id: F.windfall, familyId: null, name: '意外所得', type: 'income', icon: '运', sortOrder: 3, isSystem: true, parentId: null, isDirectDefault: false, childrenCount: 4 },
    // ─── 收入二级 ───
    { id: F.career_salary, familyId: null, name: '工资', type: 'income', icon: '薪', sortOrder: 1, isSystem: true, parentId: F.career, isDirectDefault: true, childrenCount: 0 },
    { id: F.career_bonus, familyId: null, name: '奖金', type: 'income', icon: '薪', sortOrder: 2, isSystem: true, parentId: F.career, isDirectDefault: false, childrenCount: 0 },
    { id: F.career_parttime, familyId: null, name: '兼职', type: 'income', icon: '薪', sortOrder: 3, isSystem: true, parentId: F.career, isDirectDefault: false, childrenCount: 0 },
    { id: F.career_reimbursement, familyId: null, name: '报销', type: 'income', icon: '薪', sortOrder: 4, isSystem: true, parentId: F.career, isDirectDefault: false, childrenCount: 0 },
    { id: F.investment_general, familyId: null, name: '理财', type: 'income', icon: '投', sortOrder: 1, isSystem: true, parentId: F.investment, isDirectDefault: true, childrenCount: 0 },
    { id: F.investment_rent, familyId: null, name: '收租', type: 'income', icon: '投', sortOrder: 2, isSystem: true, parentId: F.investment, isDirectDefault: false, childrenCount: 0 },
    { id: F.investment_interest, familyId: null, name: '利息', type: 'income', icon: '投', sortOrder: 3, isSystem: true, parentId: F.investment, isDirectDefault: false, childrenCount: 0 },
    { id: F.windfall_gifts, familyId: null, name: '人情', type: 'income', icon: '运', sortOrder: 1, isSystem: true, parentId: F.windfall, isDirectDefault: true, childrenCount: 0 },
    { id: F.windfall_lottery, familyId: null, name: '中奖', type: 'income', icon: '运', sortOrder: 2, isSystem: true, parentId: F.windfall, isDirectDefault: false, childrenCount: 0 },
    { id: F.windfall_secondhand, familyId: null, name: '闲置出售', type: 'income', icon: '运', sortOrder: 3, isSystem: true, parentId: F.windfall, isDirectDefault: false, childrenCount: 0 },
    { id: F.windfall_others, familyId: null, name: '其他', type: 'income', icon: '运', sortOrder: 4, isSystem: true, parentId: F.windfall, isDirectDefault: false, childrenCount: 0 },
  ];
}

// ─── snake_case → camelCase 转换 ──────────────────────────────────────────────

function rawToItem(raw: CategoryRaw): CategoryItem {
  return {
    id: raw.id,
    familyId: raw.family_id,
    name: raw.name,
    type: raw.type,
    icon: raw.icon,
    color: raw.color,
    sortOrder: raw.sort_order,
    isSystem: raw.is_system,
    parentId: raw.parent_id,
    isDirectDefault: raw.is_direct_default,
    childrenCount: raw.children_count,
  };
}

// ─── 缓存读写 ─────────────────────────────────────────────────────────────────

/** 缓存 envelope 结构 */
interface CacheEnvelope {
  data: CategoryItem[];
  timestamp: number;
}

function cacheKey(familyId: string): string {
  return `${CACHE_KEY_PREFIX}${familyId}`;
}

async function readCache(familyId: string): Promise<CategoryItem[] | null> {
  const envelope = await getItem<CacheEnvelope>(cacheKey(familyId));
  if (!envelope || !envelope.data || !envelope.timestamp) return null;
  // 检查 TTL（storage.ts 的 TTL 在 getItem 内部已检查，但双保险：）
  if (Date.now() - envelope.timestamp > CACHE_TTL_MS) return null;
  return envelope.data;
}

async function writeCache(familyId: string, items: CategoryItem[]): Promise<void> {
  await setItem<CacheEnvelope>(cacheKey(familyId), { data: items, timestamp: Date.now() });
}

// ─── 公共 API ─────────────────────────────────────────────────────────────────

/**
 * 获取分类列表：优先读缓存 → 过期/无缓存调 API → API 失败用 fallback
 * @param familyId 当前活跃家庭 ID
 */
export async function getCategories(familyId: string): Promise<CategoryItem[]> {
  // 1. 优先读缓存
  const cached = await readCache(familyId);
  if (cached && cached.length > 0) return cached;

  // 2. 缓存无/过期 → 调 API
  try {
    return await refreshCategories(familyId);
  } catch {
    // 3. API 也失败 → 用 fallback
    console.warn('[categoryService] API failed, using fallback data');
    return getFallbackItems();
  }
}

/**
 * 强制刷新分类列表（调 API → 写缓存 → 返回）
 * @param familyId 当前活跃家庭 ID
 */
export async function refreshCategories(familyId: string): Promise<CategoryItem[]> {
  const rawList = await request<CategoryRaw[]>({
    method: 'GET',
    path: '/categories',
    query: { family_id: familyId },
    auth: true,
  });

  const items = rawList.map(rawToItem);

  // 按 sortOrder 排序（保证一致展示顺序）
  items.sort((a, b) => a.sortOrder - b.sortOrder);

  // 写缓存
  await writeCache(familyId, items);

  return items;
}

/**
 * 按 parent_id 组装树形结构
 * 返回 { expense: Tier1[], income: Tier1[] }
 */
export function buildCategoryTree(items: CategoryItem[]): {
  expense: CategoryTier1[];
  income: CategoryTier1[];
} {
  const tier1Map = new Map<string, CategoryTier1>();
  const childrenMap = new Map<string, CategoryTier2[]>();

  // 先按 parentId 分组
  for (const item of items) {
    if (item.parentId === null) {
      // 一级分类
      tier1Map.set(item.id, {
        id: item.id,
        name: item.name,
        icon: item.icon,
        color: item.color,
        children: [],
      });
    } else {
      // 二级分类
      let list = childrenMap.get(item.parentId);
      if (!list) {
        list = [];
        childrenMap.set(item.parentId, list);
      }
      list.push({
        id: item.id,
        name: item.name,
        icon: item.icon,
        color: item.color,
      });
    }
  }

  // 组装
  const expense: CategoryTier1[] = [];
  const income: CategoryTier1[] = [];

  for (const [id, tier1] of tier1Map) {
    const children = childrenMap.get(id) || [];
    tier1.children = children;

    // 找到原始 item 判断 type
    const rawItem = items.find(i => i.id === id);
    if (rawItem?.type === 'income') {
      income.push(tier1);
    } else {
      expense.push(tier1);
    }
  }

  return { expense, income };
}

/**
 * 按 is_direct_default 构建去重映射
 * 返回：二级分类名 → 一级分类 id
 * 仅 is_direct_default=true 的二级分类参与映射（同名重复分类中最日常/最高频的那个）
 */
export function buildDedupMapping(items: CategoryItem[]): DedupMapping {
  const mapping: DedupMapping = {};

  // 收集所有 is_direct_default=true 的二级分类
  for (const item of items) {
    if (item.parentId !== null && item.isDirectDefault) {
      // 映射：二级分类名 → 其父分类 id
      mapping[item.name] = item.parentId;
    }
  }

  return mapping;
}

// ─── 运行时内存缓存（供 getCategoryById 快速查找）───────────────────────────────

/** 内存中缓存的分类平铺数组 */
let _cachedFlatItems: CategoryItem[] = [];

/**
 * 将分类数组加载到内存缓存（每次 getCategories 成功后自动调）
 * 供 getCategoryById 使用
 */
export function warmUpMemoryCache(_familyId: string, items: CategoryItem[]): void {
  _cachedFlatItems = items;
}

/**
 * 根据 ID 查找分类（供明细页使用）
 * 查找顺序：内存缓存 → fallback
 */
export function getCategoryById(id: string): CategoryItem | undefined {
  // 内存缓存
  if (_cachedFlatItems.length > 0) {
    return _cachedFlatItems.find(c => c.id === id);
  }
  // 无内存缓存 → fallback
  return getFallbackItems().find(c => c.id === id);
}

/**
 * 获取分类图标（供明细页使用）
 * 降级：不存在时返回 '?'
 */
export function getCategoryIconById(categoryId: string | null): string {
  if (!categoryId) return '·';
  const item = getCategoryById(categoryId);
  return item?.icon || '?';
}

/**
 * 获取分类名（供明细页使用）
 * 降级：不存在时返回 '未分类'
 */
export function getCategoryNameById(categoryId: string | null): string {
  if (!categoryId) return '未分类';
  const item = getCategoryById(categoryId);
  return item?.name || '未分类';
}

/**
 * 构建去重后的二级分类列表（同名仅展示一次）
 * 沿用旧 categories.ts 的去重逻辑，但基于 CategoryItem 数据源
 */
export function buildDedupedSubCategories(
  items: CategoryItem[],
  type: 'expense' | 'income',
): CategoryTier2[] {
  const seen = new Set<string>();
  const result: CategoryTier2[] = [];

  // 按 sortOrder 排序
  const sorted = items
    .filter(i => i.type === type && i.parentId !== null)
    .sort((a, b) => a.sortOrder - b.sortOrder);

  for (const item of sorted) {
    if (!seen.has(item.name)) {
      seen.add(item.name);
      result.push({
        id: item.id,
        name: item.name,
        icon: item.icon,
        color: item.color,
      });
    }
  }
  return result;
}
