import { describe, expect, it } from 'vitest';
import {
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
