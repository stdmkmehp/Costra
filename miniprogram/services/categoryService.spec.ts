import { describe, expect, it } from 'vitest';
import {
  buildDedupedSubCategories,
  computeCategoriesSignature,
  computeSystemCategoriesSignature,
  type CategoryItem,
} from './categoryService';

function category(overrides: Partial<CategoryItem>): CategoryItem {
  return {
    id: '00000000-0000-4000-8000-000000000001',
    familyId: null,
    name: '餐饮',
    type: 'expense',
    icon: '餐',
    color: 'color.category.food',
    sortOrder: 1,
    isSystem: true,
    parentId: null,
    isDirectDefault: false,
    isParentDefault: false,
    displayOrder: null,
    childrenCount: 0,
    ...overrides,
  };
}

describe('services/categoryService · categories_revision signature', () => {
  it('computeSystemCategoriesSignature 仅纳入系统分类，忽略家庭自定义分类', () => {
    const system = category({
      id: '00000000-0000-4000-8000-000000000001',
      familyId: null,
      name: '餐饮',
    });
    const custom = category({
      id: '00000000-0000-4000-8000-000000000002',
      familyId: '10000000-0000-4000-8000-000000000001',
      name: '自定义',
      sortOrder: 99,
      isSystem: false,
    });

    expect(computeSystemCategoriesSignature([system, custom])).toBe(computeCategoriesSignature([system]));
    expect(computeSystemCategoriesSignature([system, custom])).not.toBe(computeCategoriesSignature([system, custom]));
  });
});

describe('services/categoryService · deduped sub categories', () => {
  it('transfer 二级展示区复用支出/收入规则：过滤父默认子，按 display_order 排序', () => {
    const parent = category({
      id: '00000000-0000-4000-8000-000000000301',
      name: '储值',
      type: 'transfer',
      parentId: null,
      sortOrder: 1,
    });
    const parentDefault = category({
      id: '12000000-0000-4000-8000-000301000001',
      name: '储值',
      type: 'transfer',
      parentId: parent.id,
      isDirectDefault: true,
      isParentDefault: true,
      displayOrder: null,
      sortOrder: 1,
    });
    const transit = category({
      id: '12000000-0000-4000-8000-000301000002',
      name: '公交卡储值',
      type: 'transfer',
      parentId: parent.id,
      isDirectDefault: true,
      isParentDefault: false,
      displayOrder: 2,
      sortOrder: 2,
    });
    const meal = category({
      id: '12000000-0000-4000-8000-000301000003',
      name: '饭卡储值',
      type: 'transfer',
      parentId: parent.id,
      isDirectDefault: true,
      isParentDefault: false,
      displayOrder: 1,
      sortOrder: 3,
    });

    const result = buildDedupedSubCategories([parent, parentDefault, transit, meal], 'transfer');

    expect(result.map((item) => item.name)).toEqual(['饭卡储值', '公交卡储值']);
  });
});
