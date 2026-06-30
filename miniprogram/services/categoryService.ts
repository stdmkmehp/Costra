// services/categoryService.ts · 分类数据服务（API 调用 + 本地缓存 + 树构建 + 去重映射）
// 卡号: COSTRA-219 · 分类数据模型替换硬编码
// 依赖: services/request.ts（统一请求层）/ services/storage.ts（async envelope）/ services/family.ts（getActiveFamilyId）
// 契约事实源: server/api/openapi.yaml → GET /categories → Category schema
// 设计源: design/ui/category_dictionary.md（去重直选归属规则）

import { request } from './request';
import { getItem, setItem } from './storage';
import { eventBus, EventNames } from './eventBus';
import { logger } from '../utils/logger';

// ─── 类型定义 ──────────────────────────────────────────────────────────────────

/** 对齐 OpenAPI Category schema（UUID id · snake_case → camelCase 映射） */
export interface CategoryItem {
  id: string;               // UUID
  familyId: string | null;  // null = 系统预设
  name: string;
  type: 'income' | 'expense' | 'transfer';
  icon: string;             // 单字符图标（API 返回直接使用）
  color?: string;
  sortOrder: number;
  isSystem: boolean;
  parentId: string | null;  // null = 一级分类
  isDirectDefault: boolean; // 全局二级展示区直选默认归属标记
  // migration 0013：精确标记"点父一级时自动选中的默认子分类"
  isParentDefault: boolean;
  // migration 0013：全局二级展示区展示顺序，null = 不展示
  displayOrder: number | null;
  childrenCount: number;
}

/** API 返回的原始 snake_case 结构（用于解析响应） */
interface CategoryRaw {
  id: string;
  family_id: string | null;
  name: string;
  type: 'income' | 'expense' | 'transfer';
  icon: string;
  color?: string;
  sort_order: number;
  is_system: boolean;
  parent_id: string | null;
  is_direct_default: boolean;
  is_parent_default: boolean;
  display_order: number | null;
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
// API 不可达 + 缓存也无时使用。ID 使用确定性 UUID 占位符。
// 数据来源: design/categories.yaml（与服务端权威源一致）
//
// 字段含义：
//   def = is_direct_default
//   pd  = is_parent_default
//   dsp = display_order

const CONFIG_EXPENSE = [
  { name: '餐饮', icon: '餐', color: 'color.category.food', order: 1, children: [
    { name: '餐饮', order: 1, def: true, pd: true, dsp: null },
    { name: '早餐', order: 2, def: true, pd: false, dsp: 1 },
    { name: '午餐', order: 3, def: true, pd: false, dsp: 2 },
    { name: '晚餐', order: 4, def: true, pd: false, dsp: 3 },
    { name: '外卖', order: 5, def: true, pd: false, dsp: 4 },
    { name: '买菜', order: 6, def: true, pd: false, dsp: 9 },
    { name: '水果', order: 7, def: true, pd: false, dsp: 10 },
    { name: '零食', order: 8, def: true, pd: false, dsp: 8 },
    { name: '饮料', order: 9, def: true, pd: false, dsp: 11 },
    { name: '酒水', order: 10, def: false, pd: false, dsp: 52 },
    { name: '柴米油盐', order: 11, def: true, pd: false, dsp: 18 },
    { name: '聚餐', order: 12, def: true, pd: false, dsp: 19 },
    { name: '宴请', order: 13, def: true, pd: false, dsp: 27 }
  ]},
  { name: '交通', icon: '行', color: 'color.category.transport', order: 2, children: [
    { name: '交通', order: 1, def: true, pd: true, dsp: null },
    { name: '打车', order: 2, def: true, pd: false, dsp: 6 },
    { name: '公交地铁', order: 3, def: true, pd: false, dsp: 5 },
    { name: '加油', order: 4, def: true, pd: false, dsp: 20 },
    { name: '停车', order: 5, def: true, pd: false, dsp: 21 },
    { name: '火车高铁', order: 6, def: true, pd: false, dsp: 28 },
    { name: '机票', order: 7, def: true, pd: false, dsp: 29 },
    { name: '汽车保养', order: 8, def: true, pd: false, dsp: 39 },
    { name: '保险', order: 9, def: true, pd: false, dsp: 40 },
    { name: '过路费', order: 10, def: true, pd: false, dsp: 41 }
  ]},
  { name: '购物', icon: '购', color: 'color.category.shopping', order: 3, children: [
    { name: '购物', order: 1, def: true, pd: true, dsp: null },
    { name: '日用', order: 2, def: true, pd: false, dsp: 7 },
    { name: '服饰', order: 3, def: true, pd: false, dsp: 17 },
    { name: '数码', order: 4, def: true, pd: false, dsp: 32 },
    { name: '零食', order: 5, def: false, pd: false, dsp: null },
    { name: '纸巾', order: 6, def: true, pd: false, dsp: 44 },
    { name: '饮料', order: 7, def: false, pd: false, dsp: null },
    { name: '护肤美妆', order: 8, def: true, pd: false, dsp: 31 }
  ]},
  { name: '生活', icon: '活', color: 'color.category.lifestyle', order: 4, children: [
    { name: '生活', order: 1, def: true, pd: true, dsp: null },
    { name: '日用', order: 2, def: false, pd: false, dsp: null },
    { name: '买菜', order: 3, def: false, pd: false, dsp: null },
    { name: '柴米油盐', order: 4, def: false, pd: false, dsp: null },
    { name: '宠物', order: 5, def: true, pd: false, dsp: 34 },
    { name: '美容美发', order: 6, def: true, pd: false, dsp: 25 },
    { name: '水费', order: 7, def: true, pd: false, dsp: 13 },
    { name: '电费', order: 8, def: true, pd: false, dsp: 14 },
    { name: '燃气费', order: 9, def: true, pd: false, dsp: 15 },
    { name: '话费网费', order: 10, def: true, pd: false, dsp: 16 },
    { name: '物业维修', order: 11, def: true, pd: false, dsp: 42 },
    { name: '医疗', order: 12, def: true, pd: false, dsp: 22 },
    { name: '母婴', order: 13, def: true, pd: false, dsp: 38 },
    { name: '租房', order: 14, def: true, pd: false, dsp: 43 }
  ]},
  { name: '旅行', icon: '旅', color: 'color.category.travel', order: 5, children: [
    { name: '旅行', order: 1, def: true, pd: true, dsp: null },
    { name: '机票', order: 2, def: false, pd: false, dsp: null },
    { name: '酒店', order: 3, def: true, pd: false, dsp: 26 },
    { name: '交通', order: 4, def: false, pd: false, dsp: null },
    { name: '火车高铁', order: 5, def: false, pd: false, dsp: null },
    { name: '餐饮', order: 6, def: false, pd: false, dsp: null }
  ]},
  { name: '文娱', icon: '娱', color: 'color.category.culture', order: 6, children: [
    { name: '文娱', order: 1, def: true, pd: true, dsp: null },
    { name: '订阅会员', order: 2, def: true, pd: false, dsp: 12 },
    { name: '演出', order: 3, def: true, pd: false, dsp: 36 },
    { name: '游戏', order: 4, def: true, pd: false, dsp: 33 },
    { name: '运动', order: 5, def: true, pd: false, dsp: 24 },
    { name: '电影', order: 6, def: true, pd: false, dsp: 23 },
    { name: '门票', order: 7, def: true, pd: false, dsp: 35 },
    { name: '教育', order: 8, def: true, pd: false, dsp: 37 }
  ]},
  { name: '转账', icon: '转', color: 'color.category.transfer', order: 7, children: [
    { name: '转账', order: 1, def: true, pd: true, dsp: null },
    { name: '还贷', order: 2, def: true, pd: false, dsp: 30 },
    { name: '垫付', order: 3, def: true, pd: false, dsp: 50 }
  ]},
  { name: '其他', icon: '他', color: 'color.category.other', order: 99, children: [
    { name: '其他', order: 1, def: true, pd: true, dsp: null },
    { name: '红包', order: 2, def: true, pd: false, dsp: 45 },
    { name: '礼金', order: 3, def: true, pd: false, dsp: 46 },
    { name: '赡养', order: 4, def: true, pd: false, dsp: 48 },
    { name: '捐赠', order: 5, def: true, pd: false, dsp: 49 },
    { name: '丢失', order: 6, def: true, pd: false, dsp: 51 },
    { name: '礼物', order: 7, def: true, pd: false, dsp: 47 },
    { name: '罚款', order: 8, def: true, pd: false, dsp: null }
  ]}
];

const CONFIG_INCOME = [
  { name: '职业收入', icon: '薪', color: 'color.category.salary', order: 1, children: [
    { name: '工资', order: 1, def: true, pd: true, dsp: null },
    { name: '奖金', order: 2, def: true, pd: false, dsp: 1 },
    { name: '兼职', order: 3, def: true, pd: false, dsp: 2 },
    { name: '报销', order: 4, def: true, pd: false, dsp: 3 }
  ]},
  { name: '投资与资产', icon: '投', color: 'color.category.invest', order: 2, children: [
    { name: '理财', order: 1, def: true, pd: true, dsp: null },
    { name: '收租', order: 2, def: true, pd: false, dsp: 4 },
    { name: '利息', order: 3, def: true, pd: false, dsp: 5 }
  ]},
  { name: '意外收入', icon: '运', color: 'color.category.windfall', order: 3, children: [
    { name: '其他', order: 1, def: true, pd: true, dsp: null },
    { name: '转账', order: 2, def: true, pd: false, dsp: 8 },
    { name: '红包', order: 3, def: true, pd: false, dsp: 6 },
    { name: '退款', order: 4, def: true, pd: false, dsp: 7 },
    { name: '中奖', order: 5, def: true, pd: false, dsp: 10 },
    { name: '闲置出售', order: 6, def: true, pd: false, dsp: 11 },
    { name: '礼金', order: 7, def: true, pd: false, dsp: 9 }
  ]}
];

// 转移分类（migration 0004 新增 · type='transfer' · 不计入收支统计）
// 全部 display_order=null（不进全局二级展示区，仅在记账面板「转移」tab 内按树展示）
const CONFIG_TRANSFER = [
  { name: '储值', icon: '储', color: 'color.category.transfer', order: 1, children: [
    { name: '储值', order: 1, def: true, pd: true, dsp: null },
    { name: '公交卡储值', order: 2, def: true, pd: false, dsp: null },
    { name: '饭卡储值', order: 3, def: true, pd: false, dsp: null }
  ]},
  { name: '账户互转', icon: '互', color: 'color.category.transfer', order: 2, children: [
    { name: '账户互转', order: 1, def: true, pd: true, dsp: null }
  ]},
  { name: '赊销', icon: '销', color: 'color.category.transfer', order: 3, children: [
    { name: '赊销', order: 1, def: true, pd: true, dsp: null },
    { name: '花呗', order: 2, def: true, pd: false, dsp: null },
    { name: '白条', order: 3, def: true, pd: false, dsp: null },
    { name: '月付', order: 4, def: true, pd: false, dsp: null },
    { name: '信用卡', order: 5, def: true, pd: false, dsp: null }
  ]}
];

/** 内嵌 fallback 静态数据（API 不可达 + 缓存也无时降级用） */
function getFallbackItems(): CategoryItem[] {
  const result: CategoryItem[] = [];

  // 一级分类 UUID 映射表（确定性，便于 getCategoryById fallback 路径稳定）
  // 支出 parentSuffix: 餐饮=1..其他=8
  // 收入 parentSuffix: 200+order（职业=201..意外=203）
  // 转移 parentSuffix: 300+order（储值=301、账户互转=302、赊销=303）
  // 子 UUID 前缀：expense=10..、income=11..、transfer=12..（互不冲突）
  const getParentUuid = (type: 'expense' | 'income' | 'transfer', order: number): string => {
    let suffix: number;
    if (type === 'income')        suffix = 200 + order;
    else if (type === 'transfer') suffix = 300 + order;
    else                          suffix = order;
    return `00000000-0000-4000-8000-${String(suffix).padStart(12, '0')}`;
  };

  const getChildUuid = (type: 'expense' | 'income' | 'transfer', parentOrder: number, childOrder: number): string => {
    let parentSuffix: number;
    let prefix: string;
    if (type === 'income')        { parentSuffix = 200 + parentOrder; prefix = '11000000'; }
    else if (type === 'transfer') { parentSuffix = 300 + parentOrder; prefix = '12000000'; }
    else                          { parentSuffix = parentOrder;       prefix = '10000000'; }
    return `${prefix}-0000-4000-8000-${String(parentSuffix).padStart(6, '0')}${String(childOrder).padStart(6, '0')}`;
  };

  // 1. 构建支出
  CONFIG_EXPENSE.forEach(p => {
    const pId = getParentUuid('expense', p.order);
    result.push({
      id: pId,
      familyId: null,
      name: p.name,
      type: 'expense',
      icon: p.icon,
      color: p.color,
      sortOrder: p.order,
      isSystem: true,
      parentId: null,
      isDirectDefault: false,
      isParentDefault: false,
      displayOrder: null,
      childrenCount: p.children.length
    });

    p.children.forEach(c => {
      result.push({
        id: getChildUuid('expense', p.order, c.order),
        familyId: null,
        name: c.name,
        type: 'expense',
        icon: p.icon, // 子类默认继承父类 icon
        color: p.color,
        sortOrder: c.order,
        isSystem: true,
        parentId: pId,
        isDirectDefault: c.def,
        isParentDefault: c.pd,
        displayOrder: c.dsp,
        childrenCount: 0
      });
    });
  });

  // 2. 构建收入
  CONFIG_INCOME.forEach(p => {
    const pId = getParentUuid('income', p.order);
    result.push({
      id: pId,
      familyId: null,
      name: p.name,
      type: 'income',
      icon: p.icon,
      color: p.color,
      sortOrder: p.order,
      isSystem: true,
      parentId: null,
      isDirectDefault: false,
      isParentDefault: false,
      displayOrder: null,
      childrenCount: p.children.length
    });

    p.children.forEach(c => {
      result.push({
        id: getChildUuid('income', p.order, c.order),
        familyId: null,
        name: c.name,
        type: 'income',
        icon: p.icon,
        color: p.color,
        sortOrder: c.order,
        isSystem: true,
        parentId: pId,
        isDirectDefault: c.def,
        isParentDefault: c.pd,
        displayOrder: c.dsp,
        childrenCount: 0
      });
    });
  });

  // 3. 构建转移（migration 0004）
  CONFIG_TRANSFER.forEach(p => {
    const pId = getParentUuid('transfer', p.order);
    result.push({
      id: pId,
      familyId: null,
      name: p.name,
      type: 'transfer',
      icon: p.icon,
      color: p.color,
      sortOrder: p.order,
      isSystem: true,
      parentId: null,
      isDirectDefault: false,
      isParentDefault: false,
      displayOrder: null,
      childrenCount: p.children.length
    });

    p.children.forEach(c => {
      result.push({
        id: getChildUuid('transfer', p.order, c.order),
        familyId: null,
        name: c.name,
        type: 'transfer',
        icon: p.icon,
        color: p.color,
        sortOrder: c.order,
        isSystem: true,
        parentId: pId,
        isDirectDefault: c.def,
        isParentDefault: c.pd,
        displayOrder: c.dsp,
        childrenCount: 0
      });
    });
  });

  return result;
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
    isParentDefault: raw.is_parent_default,
    displayOrder: raw.display_order,
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
 * 注：命中 storage 缓存后会自动预热内存缓存，便于下一次同步路径命中。
 * @param familyId 当前活跃家庭 ID
 */
export async function getCategories(familyId: string): Promise<CategoryItem[]> {
  // 1. 优先读缓存
  const cached = await readCache(familyId);
  if (cached && cached.length > 0) {
    warmUpMemoryCache(familyId, cached);
    return cached;
  }

  // 2. 缓存无/过期 → 调 API
  try {
    return await refreshCategories(familyId);
  } catch {
    // 3. API 也失败 → 用 fallback
    logger.warn('categoryService', 'API failed, using fallback data');
    const fallback = getFallbackItems();
    warmUpMemoryCache(familyId, fallback);
    return fallback;
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

  // 写缓存 + 预热内存
  await writeCache(familyId, items);
  warmUpMemoryCache(familyId, items);

  return items;
}

/**
 * 启动期/登录期预热分类缓存（fire-and-forget 调）。
 * 优先用 storage 缓存预热内存（无网络）；若 storage 也无，再调 API。
 * 全部失败静默不抛，最后会用 fallback 预热内存（保证同步路径永远有数据）。
 *
 * 调用时机：
 *   - app.ts bootstrap 完成后（已登录 + 已有 active family）
 *   - 登录页登录成功后（拿到 default_family_id）
 *
 * @param familyId 当前活跃家庭 ID
 */
export async function prefetchCategories(familyId: string): Promise<void> {
  try {
    const cached = await readCache(familyId);
    if (cached && cached.length > 0) {
      warmUpMemoryCache(familyId, cached);
      // 即便有 storage 缓存也异步刷一次（不 await），让下一次开面板拿到最新数据
      void refreshCategories(familyId).catch(() => { /* 静默 */ });
      return;
    }
    // 无 storage 缓存：直接调 API
    await refreshCategories(familyId);
  } catch {
    // 网络也挂：用 fallback 预热内存（保证 getCategoriesSync 不为空）
    warmUpMemoryCache(familyId, getFallbackItems());
  }
}

/**
 * 按 parent_id 组装树形结构
 * 返回 { expense: Tier1[], income: Tier1[], transfer: Tier1[] }
 */
export function buildCategoryTree(items: CategoryItem[]): {
  expense: CategoryTier1[];
  income: CategoryTier1[];
  transfer: CategoryTier1[];
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
  const transfer: CategoryTier1[] = [];

  for (const [id, tier1] of tier1Map) {
    const children = childrenMap.get(id) || [];
    tier1.children = children;

    // 找到原始 item 判断 type
    const rawItem = items.find(i => i.id === id);
    if (rawItem?.type === 'income') {
      income.push(tier1);
    } else if (rawItem?.type === 'transfer') {
      transfer.push(tier1);
    } else {
      expense.push(tier1);
    }
  }

  return { expense, income, transfer };
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
/** 内存缓存对应的 familyId（用于跨 family 切换时区分） */
let _cachedFamilyId: string | null = null;
/** 内存缓存数据签名（基于 UI 相关字段计算） */
let _cachedSignature: string = '';

/**
 * 计算分类数据签名（仅基于会影响 UI 的字段）。
 * 用于"刷新到的数据是否与当前展示一致"的快速判定。
 */
export function computeCategoriesSignature(items: CategoryItem[]): string {
  // 排序键稳定（getCategories 已 sort by sortOrder，但防御性再排一次）
  const sorted = items.slice().sort((a, b) => {
    if (a.sortOrder !== b.sortOrder) return a.sortOrder - b.sortOrder;
    return a.id.localeCompare(b.id);
  });
  return sorted
    .map(i => [
      i.id,
      i.parentId ?? '',
      i.name,
      i.icon,
      i.type,
      i.sortOrder,
      i.isDirectDefault ? 1 : 0,
      i.isParentDefault ? 1 : 0,
      i.displayOrder ?? '',
    ].join('|'))
    .join(';');
}

/**
 * 计算系统分类签名（仅 familyId === null）。
 * 对齐服务端 categories_revision：仅覆盖系统分类，不纳入家庭自定义分类。
 */
export function computeSystemCategoriesSignature(items: CategoryItem[]): string {
  return computeCategoriesSignature(items.filter(i => i.familyId === null));
}

/**
 * 将分类数组加载到内存缓存（每次 getCategories/refreshCategories 成功后自动调）
 * 供 getCategoryById / getCategoriesSync 使用
 *
 * 副作用：当签名变化时广播 CATEGORIES_LOADED 事件，订阅方（如明细页）据此重渲，
 * 避免清理数据/弱网首启场景下条目展示在 fallback 找不到的"未分类/?"状态。
 */
export function warmUpMemoryCache(familyId: string, items: CategoryItem[]): void {
  const nextSignature = computeCategoriesSignature(items);
  const changed =
    _cachedFamilyId !== familyId ||
    _cachedSignature !== nextSignature ||
    _cachedFlatItems.length === 0;
  _cachedFlatItems = items;
  _cachedFamilyId = familyId;
  _cachedSignature = nextSignature;
  if (changed) {
    eventBus.emit(EventNames.CATEGORIES_LOADED, { familyId });
  }
}

/**
 * 同步获取分类列表（永不阻塞，永不查 storage 永不调 API）。
 * 命中策略：
 *   1. 内存缓存且 familyId 匹配 → 直接返回
 *   2. 否则返回内嵌 fallback（不污染内存缓存，避免覆盖其它 family 的真数据）
 *
 * 用于"打开记账面板/分类编辑面板"等用户感知极敏感路径，确保 0 等待。
 *
 * 注意：调用方负责另行 fire-and-forget 调 refreshCategories 做后台增量刷新。
 */
export function getCategoriesSync(familyId: string): CategoryItem[] {
  if (_cachedFlatItems.length > 0 && _cachedFamilyId === familyId) {
    return _cachedFlatItems;
  }
  return getFallbackItems();
}

/** 读取内存缓存当前全量签名（用于 UI 增量刷新比对） */
export function getCachedCategoriesSignature(): string {
  return _cachedSignature;
}

/** 读取内存缓存当前系统分类签名（用于 sync categories_revision 比对） */
export function getCachedSystemCategoriesSignature(): string {
  return computeSystemCategoriesSignature(_cachedFlatItems);
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
 * 构建全局二级展示区列表（migration 0013 重写）。
 *
 * 规则：
 *   1. 过滤：仅二级分类（parentId !== null）且不是父默认子（!isParentDefault）且有展示顺序（displayOrder !== null）
 *   2. 排序：按 displayOrder 升序（高频在前）
 *   3. 同名去重：displayOrder 已保证顺序，先出现的保留（seed 中 is_direct_default=true 的副本分配了 displayOrder、
 *      而同名重复中 is_direct_default=false 的副本 displayOrder=null 已被步骤 1 过滤掉）
 */
export function buildDedupedSubCategories(
  items: CategoryItem[],
  type: 'expense' | 'income' | 'transfer',
): CategoryTier2[] {
  const seen = new Set<string>();
  const result: CategoryTier2[] = [];

  // 按 displayOrder 升序排序（过滤 null 后 displayOrder 必不为 null）
  const sorted = items
    .filter(i => i.type === type
              && i.parentId !== null
              && !i.isParentDefault
              && i.displayOrder !== null)
    .sort((a, b) => a.displayOrder! - b.displayOrder!);

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
