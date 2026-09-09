/**
 * Costra · Server · importDemoCsv 生成器单测
 *
 * 事实源：docs/design/data-import-export-client-analysis.md §4.6
 *
 * 核心是自洽性测试：生成结果喂回自家解析器 analyzeImportCsv 断言 0 ERROR——
 * 分类表任何变更（新增/改名/删除）都被该测试自动跟随校验。
 */

import { describe, it, expect } from 'vitest';
import { buildImportDemoCsv } from '../src/services/importDemoCsv.js';
import { analyzeImportCsv, type ImportAnalyzeContext } from '../src/services/importCsv.js';
import type { CategoryEntity } from '../src/repositories/categoryRepo.js';

// ─────────────────────────────────────────────────────────────────────────────
// 夹具
// ─────────────────────────────────────────────────────────────────────────────

let catSeq = 0;
function mkCat(partial: Partial<CategoryEntity> & { name: string }): CategoryEntity {
  catSeq += 1;
  return {
    id: partial.id ?? `cat-${catSeq}`,
    familyId: null,
    type: 'expense',
    icon: '',
    color: null,
    sortOrder: 0,
    isSystem: partial.familyId == null,
    parentId: null,
    isDirectDefault: false,
    isParentDefault: false,
    displayOrder: null,
    createdAt: new Date('2026-01-01T00:00:00Z'),
    updatedAt: new Date('2026-01-01T00:00:00Z'),
    ...partial,
  };
}

const CAT_FOOD = mkCat({ id: 'c-food', name: '餐饮', type: 'expense', sortOrder: 1 });
const CAT_FOOD_TAKEOUT = mkCat({ id: 'c-food-takeout', name: '外卖', type: 'expense', parentId: 'c-food', sortOrder: 1, isParentDefault: true });
const CAT_FOOD_GROCERY = mkCat({ id: 'c-food-grocery', name: '买菜', type: 'expense', parentId: 'c-food', sortOrder: 2 });
const CAT_TRANSPORT = mkCat({ id: 'c-transport', name: '交通', type: 'expense', sortOrder: 2 });
const CAT_TRANSPORT_METRO = mkCat({ id: 'c-transport-metro', name: '公交地铁', type: 'expense', parentId: 'c-transport', sortOrder: 1, isParentDefault: true });
const CAT_SALARY = mkCat({ id: 'c-salary', name: '职业收入', type: 'income', sortOrder: 1 });
const CAT_SALARY_WAGE = mkCat({ id: 'c-salary-wage', name: '工资', type: 'income', parentId: 'c-salary', sortOrder: 1, isParentDefault: true });
const CAT_TRANSFER = mkCat({ id: 'c-transfer', name: '账户互转', type: 'transfer', sortOrder: 2 });
const CAT_TRANSFER_SUB = mkCat({ id: 'c-transfer-sub', name: '账户互转', type: 'transfer', parentId: 'c-transfer', sortOrder: 1, isParentDefault: true });
/** 自定义分类（家庭可见） */
const CAT_CUSTOM = mkCat({ id: 'c-custom', familyId: 'fam-1', name: '宠物费', type: 'expense', sortOrder: 50 });
const CAT_CUSTOM_SUB = mkCat({ id: 'c-custom-sub', familyId: 'fam-1', name: '猫粮', type: 'expense', parentId: 'c-custom', sortOrder: 1, isParentDefault: true });
/** 无子一级：不产行（无默认子可兜底，罗列必然 ERROR） */
mkCat({ id: 'c-empty', name: '空壳一级', type: 'expense', sortOrder: 60 });

const CATEGORIES: CategoryEntity[] = [
  CAT_FOOD,
  CAT_FOOD_TAKEOUT,
  CAT_FOOD_GROCERY,
  CAT_TRANSPORT,
  CAT_TRANSPORT_METRO,
  CAT_SALARY,
  CAT_SALARY_WAGE,
  CAT_TRANSFER,
  CAT_TRANSFER_SUB,
  CAT_CUSTOM,
  CAT_CUSTOM_SUB,
];

const MEMBERS = ['小赵', '小李'];
const TODAY = '2026-09-09';

function build(overrides: Partial<Parameters<typeof buildImportDemoCsv>[0]> = {}) {
  return buildImportDemoCsv({
    familyKind: 'shared',
    categories: CATEGORIES,
    memberNicknames: MEMBERS,
    today: TODAY,
    ...overrides,
  });
}

/** 剥 BOM + 去尾 CRLF 后按 CRLF 拆行（断言行结构用） */
function linesOf(csv: string): string[] {
  return csv.replace(/^﻿/, '').replace(/\r\n$/, '').split('\r\n');
}

// ─────────────────────────────────────────────────────────────────────────────
// 结构与填充口径
// ─────────────────────────────────────────────────────────────────────────────

describe('结构与填充口径（§4.6）', () => {
  it('BOM 开头 + 每行 CRLF + 表头 9 标准列 + 每个有子二级一行（无子一级不产行）', () => {
    const csv = build();
    expect(csv.startsWith('﻿')).toBe(true);
    expect(csv.endsWith('\r\n')).toBe(true);
    const lines = linesOf(csv);
    // 表头 + 6 个二级（外卖/买菜/公交地铁/工资/账户互转/猫粮）；「空壳一级」无子不产行
    expect(lines).toHaveLength(1 + 6);
    expect(lines[0]).toBe('"日期","时间","类型","金额","一级分类","二级分类","归属","记账人","备注"');
    for (const line of lines) {
      // quote-all：每字段被双引号包裹，9 列
      expect(line.split(',')).toHaveLength(9);
    }
  });

  it('行序：支出组 → 收入组 → 转账组；组内一级 sortOrder、二级 sortOrder；自定义分类参与', () => {
    const lines = linesOf(build()).slice(1);
    const pairs = lines.map((l) => {
      const cols = l.split(',').map((c) => c.slice(1, -1));
      return `${cols[2]}|${cols[4]}|${cols[5]}`;
    });
    expect(pairs).toEqual([
      '支出|餐饮|外卖',
      '支出|餐饮|买菜',
      '支出|交通|公交地铁',
      '支出|宠物费|猫粮',
      '收入|职业收入|工资',
      '转账|账户互转|账户互转',
    ]);
  });

  it('日期/时间/金额/备注统一填充；收入与转账行归属留空', () => {
    const lines = linesOf(build()).slice(1);
    for (const line of lines) {
      const cols = line.split(',').map((c) => c.slice(1, -1));
      expect(cols[0]).toBe(TODAY);
      expect(cols[1]).toBe('23:45');
      expect(cols[3]).toBe('0.01');
      expect(cols[8]).toBe('这是一条备注样例');
      if (cols[2] !== '支出') expect(cols[6]).toBe('');
    }
  });

  it('shared：支出行归属按 共同/个人 交替；记账人按成员昵称轮换', () => {
    const lines = linesOf(build()).slice(1);
    const expenseShared = lines
      .map((l) => l.split(',').map((c) => c.slice(1, -1)))
      .filter((cols) => cols[2] === '支出')
      .map((cols) => cols[6]);
    expect(expenseShared).toEqual(['共同', '个人', '共同', '个人']);
    const members = lines.map((l) => l.split(',').map((c) => c.slice(1, -1))[7]);
    expect(members).toEqual(['小赵', '小李', '小赵', '小李', '小赵', '小李']);
  });

  it('personal：支出行归属全部「个人」（与导入 SHARED_FORCED_PERSONAL 口径一致）', () => {
    const lines = linesOf(build({ familyKind: 'personal', memberNicknames: ['小赵'] })).slice(1);
    for (const line of lines) {
      const cols = line.split(',').map((c) => c.slice(1, -1));
      if (cols[2] === '支出') expect(cols[6]).toBe('个人');
      expect(cols[7]).toBe('小赵');
    }
  });

  it('成员列表为空：记账人留空（导入归操作者 · 不产生非法行）', () => {
    const lines = linesOf(build({ memberNicknames: [] })).slice(1);
    for (const line of lines) {
      expect(line.split(',').map((c) => c.slice(1, -1))[7]).toBe('');
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 自洽性：demo 文件必须被自家解析器零 ERROR 接受
// ─────────────────────────────────────────────────────────────────────────────

describe('自洽性（生成结果 ⇒ analyzeImportCsv 0 ERROR）', () => {
  const ctx: ImportAnalyzeContext = {
    detectId: 'det-demo',
    familyKind: 'shared',
    operatorUserId: 'u-op',
    members: [
      { userId: 'u1', nickname: '小赵' },
      { userId: 'u2', nickname: '小李' },
    ],
    categories: CATEGORIES,
  };

  it('shared demo：is_costra_export=true 且 0 ERROR，全部行可导入', () => {
    const r = analyzeImportCsv(build(), ctx);
    expect(r.ok).toBe(true);
    expect(r.isCostraExport).toBe(true);
    expect(r.errors).toEqual([]);
    expect(r.rows).toHaveLength(6);
    expect(r.importableRows).toBe(6);
  });

  it('personal demo：0 ERROR（SHARED_FORCED_PERSONAL 仅为 WARNING）', () => {
    const r = analyzeImportCsv(build({ familyKind: 'personal', memberNicknames: ['小赵'] }), {
      ...ctx,
      familyKind: 'personal',
      members: [{ userId: 'u1', nickname: '小赵' }],
    });
    expect(r.ok).toBe(true);
    expect(r.errors).toEqual([]);
    expect(r.importableRows).toBe(6);
  });
});
