/**
 * Costra · Server · importCsv 解析/校验层单测
 *
 * 事实源：docs/design/data-import-export-client-analysis.md v1.0 §3
 * §3.11 实现约束：detect 校验集必须与 entries 硬约束人工对照并逐条覆盖。
 *
 * 纯函数层：分类/成员以夹具注入，不依赖 pg-mem。
 */

import { describe, it, expect } from 'vitest';
import { DateTime } from 'luxon';
import {
  analyzeImportCsv,
  normalizeFuzzyText,
  parseAmountCell,
  MAX_IMPORT_ROWS,
  type ImportAnalyzeContext,
} from '../src/services/importCsv.js';
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
const CAT_FOOD_TAKEOUT = mkCat({ id: 'c-food-takeout', name: '外卖', type: 'expense', parentId: 'c-food', isParentDefault: true });
const CAT_FOOD_BBQ = mkCat({ id: 'c-food-bbq', name: '烧烤', type: 'expense', parentId: 'c-food', sortOrder: 2 });
const CAT_OTHER = mkCat({ id: 'c-other', name: '其他', type: 'expense', sortOrder: 99 });
const CAT_OTHER_SUB = mkCat({ id: 'c-other-sub', name: '其他', type: 'expense', parentId: 'c-other', isParentDefault: true });
const CAT_SALARY = mkCat({ id: 'c-salary', name: '职业收入', type: 'income' });
const CAT_SALARY_SUB = mkCat({ id: 'c-salary-sub', name: '工资', type: 'income', parentId: 'c-salary', isParentDefault: true });
const CAT_TRANSFER = mkCat({ id: 'c-transfer', name: '账户互转', type: 'transfer' });
const CAT_TRANSFER_SUB = mkCat({ id: 'c-transfer-sub', name: '账户互转', type: 'transfer', parentId: 'c-transfer', isParentDefault: true });
const CAT_CUSTOM_TRAD = mkCat({ id: 'c-custom-pet', familyId: 'fam-1', name: '宠物费', type: 'expense' });

const CATEGORIES: CategoryEntity[] = [
  CAT_FOOD,
  CAT_FOOD_TAKEOUT,
  CAT_FOOD_BBQ,
  CAT_OTHER,
  CAT_OTHER_SUB,
  CAT_SALARY,
  CAT_SALARY_SUB,
  CAT_TRANSFER,
  CAT_TRANSFER_SUB,
  CAT_CUSTOM_TRAD,
];

const CTX_BASE: ImportAnalyzeContext = {
  detectId: 'det-test',
  familyKind: 'shared',
  operatorUserId: 'u-op',
  members: [
    { userId: 'u1', nickname: '小赵' },
    { userId: 'u2', nickname: '小李' },
  ],
  categories: CATEGORIES,
};

/** 标准 9 列表头（quote-all + CRLF + BOM · 与导出形态一致） */
const CANONICAL_HEADER = '"日期","时间","类型","金额","一级分类","二级分类","归属","记账人","备注"';

function csvOf(header: string, rows: string[]): string {
  return `﻿${[header, ...rows].join('\r\n')}\r\n`;
}

function costraRow(fields: string[]): string {
  return fields.map((f) => `"${f.replace(/"/g, '""')}"`).join(',');
}

function analyze(text: string, ctx: Partial<ImportAnalyzeContext> = {}) {
  return analyzeImportCsv(text, { ...CTX_BASE, ...ctx });
}

// ─────────────────────────────────────────────────────────────────────────────
// §2.1.1 表头指纹
// ─────────────────────────────────────────────────────────────────────────────

describe('表头指纹（§2.1.1）', () => {
  it('F1: 9 列标准表头（顺序无关、大小写归一）⇒ is_costra_export=true / apostrophe-v2', () => {
    const shuffled = '"备注","记账人","归属","二级分类","一级分类","金额","类型","时间","日期"';
    const r = analyze(csvOf(shuffled, [costraRow(['', '小赵', '共同', '外卖', '餐饮', '35.50', '支出', '14:30', '2026-06-10'])]));
    expect(r.ok).toBe(true);
    expect(r.isCostraExport).toBe(true);
    expect(r.formulaGuard).toBe('apostrophe-v2');
    expect(r.rows).toHaveLength(1);
  });

  it('F2: 非 9 列集合 ⇒ is_costra_export=false / none，走别名映射', () => {
    const r = analyze(csvOf('交易日期,交易类型,金额(元),分类', ['2026-06-10,支出,35.50,餐饮']));
    expect(r.ok).toBe(true);
    expect(r.isCostraExport).toBe(false);
    expect(r.formulaGuard).toBe('none');
    expect(r.rows).toHaveLength(1);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// §3.1 列名匹配 / §3.2 缺列
// ─────────────────────────────────────────────────────────────────────────────

describe('列名匹配与文件级拒绝（§3.1/§3.2）', () => {
  it('C1: 别名全集命中（大小写/全角括号归一）', () => {
    const header = '记账日期,time,收支类型,金额（元）,大类,子分类,公/私,操作人,交易对方';
    const r = analyze(csvOf(header, ['2026-06-10,14:30,支出,35.50,餐饮,外卖,共同,小赵,公司楼下']));
    expect(r.ok).toBe(true);
    expect(r.rows[0]).toMatchObject({ type: 'expense', amountCents: 3550, categoryId: 'c-food-takeout', createdBy: 'u1', note: '公司楼下' });
  });

  it('C2: 缺必填列（金额）⇒ 文件级拒绝', () => {
    const r = analyze(csvOf('日期,类型,分类', ['2026-06-10,支出,餐饮']));
    expect(r.ok).toBe(false);
    expect(r.fileError?.message).toContain('缺少必填列「金额」');
  });

  it('C3: 重复列（金额 + amount）⇒ 文件级拒绝', () => {
    const r = analyze(csvOf('日期,类型,金额,amount,分类', ['2026-06-10,支出,1,1,餐饮']));
    expect(r.ok).toBe(false);
    expect(r.fileError?.message).toContain('表头存在重复列「金额」');
  });

  it('C4: 禁止列（记录ID/id/entry_id）⇒ 文件级拒绝', () => {
    for (const bad of ['记录ID', 'id', 'entry_id', 'ID']) {
      const r = analyze(csvOf(`日期,类型,金额,一级分类,${bad}`, ['2026-06-10,支出,1,餐饮,x']));
      expect(r.ok).toBe(false);
      expect(r.fileError?.message).toContain('记录ID');
    }
  });

  it('C5: 未知列静默忽略', () => {
    const r = analyze(csvOf('日期,类型,金额,一级分类,商户单号', ['2026-06-10,支出,35.5,餐饮,abc123']));
    expect(r.ok).toBe(true);
    expect(r.rows).toHaveLength(1);
  });

  it('C6: 空文件 / 仅表头', () => {
    expect(analyze('').ok).toBe(false);
    const onlyHeader = analyze(csvOf(CANONICAL_HEADER, []));
    expect(onlyHeader.ok).toBe(true);
    expect(onlyHeader.totalRows).toBe(0);
    expect(onlyHeader.importableRows).toBe(0);
  });

  it('C7: 数据行超过 5,000 ⇒ 文件级拒绝（行数不含表头 · §9.2 对称口径）', () => {
    const rows = Array.from({ length: MAX_IMPORT_ROWS }, () => '2026-06-10,支出,1,餐饮');
    expect(analyze(csvOf('日期,类型,金额,一级分类', rows)).ok).toBe(true);
    const tooMany = [...rows, '2026-06-10,支出,1,餐饮'];
    const r = analyze(csvOf('日期,类型,金额,一级分类', tooMany));
    expect(r.ok).toBe(false);
    expect(r.fileError?.message).toContain('5,000');
  });

  it('C8: 非法 CSV（引号未闭合）⇒ 文件级拒绝', () => {
    const r = analyze(`${CANONICAL_HEADER}\r\n"2026-06-10,"14:30\r\n`);
    expect(r.ok).toBe(false);
    expect(r.fileError?.message).toContain('CSV 解析失败');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// §3.6 日期/时间容错 + 时区口径
// ─────────────────────────────────────────────────────────────────────────────

describe('日期/时间容错（§3.6）', () => {
  const D = (d: string, t = '') =>
    analyze(csvOf('日期,时间,类型,金额,一级分类', [`${d},${t},支出,35.50,餐饮`]));

  it('D1: 支持 YYYY-MM-DD / YYYY/M/D / YYYY.M.D / MM/DD/YYYY', () => {
    for (const [input, iso] of [
      ['2026-06-10', '2026-06-10T12:00:00'],
      ['2026/6/1', '2026-06-01T12:00:00'],
      ['2026.06.10', '2026-06-10T12:00:00'],
      ['06/10/2026', '2026-06-10T12:00:00'],
    ] as const) {
      const r = D(input);
      expect(r.ok).toBe(true);
      expect(r.errors).toHaveLength(0);
      // Asia/Shanghai 墙钟 → UTC instant
      const want = DateTime.fromISO(iso, { zone: 'Asia/Shanghai' }).toUTC().toJSDate();
      expect(r.rows[0]!.occurredAt.toISOString()).toBe(want.toISOString());
    }
  });

  it('D2: 非法日期（2026-02-30 / 垃圾文本）⇒ DATE_INVALID；空 ⇒ EMPTY_REQUIRED', () => {
    expect(D('2026-02-30').errors[0]?.code).toBe('DATE_INVALID');
    expect(D('昨天').errors[0]?.code).toBe('DATE_INVALID');
    expect(D('').errors[0]?.code).toBe('EMPTY_REQUIRED');
  });

  it('D3: 时间 HH:mm / H:mm / HH:mm:ss / 空默认 12:00 / 非法 TIME_INVALID', () => {
    expect(D('2026-06-10', '14:30').rows[0]!.occurredAt.toISOString()).toBe('2026-06-10T06:30:00.000Z');
    expect(D('2026-06-10', '9:05').rows[0]!.occurredAt.toISOString()).toBe('2026-06-10T01:05:00.000Z');
    expect(D('2026-06-10', '14:30:59').rows[0]!.occurredAt.toISOString()).toBe('2026-06-10T06:30:00.000Z');
    expect(D('2026-06-10', '').rows[0]!.occurredAt.toISOString()).toBe('2026-06-10T04:00:00.000Z');
    expect(D('2026-06-10', '25:00').errors[0]?.code).toBe('TIME_INVALID');
  });

  it('D4: 日期列含完整 datetime（空格/T 分隔）拆出时间', () => {
    expect(D('2026-06-10 08:00:05').rows[0]!.occurredAt.toISOString()).toBe('2026-06-10T00:00:00.000Z');
    expect(D('2026-06-10T08:00:05').rows[0]!.occurredAt.toISOString()).toBe('2026-06-10T00:00:00.000Z');
  });

  it('D5: 带时区偏移的 datetime 按其偏移取 instant（不静默丢偏移）', () => {
    const r = D('2026-06-10T14:30:00+09:00');
    expect(r.errors).toHaveLength(0);
    expect(r.rows[0]!.occurredAt.toISOString()).toBe('2026-06-10T05:30:00.000Z');
  });

  it('D6: 时间列填完整 datetime 时拆出时间部分（§3.1 别名注记）', () => {
    expect(D('2026-06-10', '2026-06-11 23:45:12').rows[0]!.occurredAt.toISOString()).toBe('2026-06-10T15:45:00.000Z');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// §3.4 类型 / §3.5 金额
// ─────────────────────────────────────────────────────────────────────────────

describe('类型模糊匹配（§3.4）', () => {
  it('T1: 支出/收入/转账 及别名（含大小写/全角）', () => {
    const cases: Array<[string, string]> = [
      ['支出', 'expense'], ['expense', 'expense'], ['花费', 'expense'], ['消费', 'expense'], ['-', 'expense'], ['EXPENSE', 'expense'],
      ['收入', 'income'], ['income', 'income'], ['进账', 'income'], ['+', 'income'],
      ['转账', 'transfer'], ['transfer', 'transfer'], ['内部转账', 'transfer'], ['转移', 'transfer'],
    ];
    for (const [input, want] of cases) {
      const cat = want === 'income' ? '职业收入' : want === 'transfer' ? '账户互转' : '餐饮';
      const r = analyze(csvOf('日期,类型,金额,一级分类', [`2026-06-10,${input},35.50,${cat}`]));
      expect(r.errors).toHaveLength(0);
      expect(r.rows[0]!.type).toBe(want);
    }
  });

  it('T2: 未识别类型 ⇒ 该行 ERROR TYPE_UNRECOGNIZED；空 ⇒ EMPTY_REQUIRED', () => {
    expect(analyze(csvOf('日期,类型,金额,一级分类', ['2026-06-10,退款,35.50,餐饮'])).errors[0]?.code).toBe('TYPE_UNRECOGNIZED');
    expect(analyze(csvOf('日期,类型,金额,一级分类', ['2026-06-10,,35.50,餐饮'])).errors[0]?.code).toBe('EMPTY_REQUIRED');
  });
});

describe('金额容错（§3.5）', () => {
  it('A1: 符号/千分位/空白/全角清洗', () => {
    expect(parseAmountCell('¥1,234.56')).toMatchObject({ ok: true, cents: 123456 });
    expect(parseAmountCell('￥1,234.56')).toMatchObject({ ok: true, cents: 123456 });
    expect(parseAmountCell('$ 1,234.56')).toMatchObject({ ok: true, cents: 123456 });
    expect(parseAmountCell('１２３４.５６')).toMatchObject({ ok: true, cents: 123456 });
  });

  it('A2: 负数取绝对值 + 精度四舍五入', () => {
    expect(parseAmountCell('-35.5')).toMatchObject({ ok: true, cents: 3550, negative: true });
    expect(parseAmountCell('35.567')).toMatchObject({ ok: true, cents: 3557, rounded: true });
    expect(parseAmountCell('35.564')).toMatchObject({ ok: true, cents: 3556, rounded: true });
    expect(parseAmountCell('35.999')).toMatchObject({ ok: true, cents: 3600, rounded: true });
  });

  it('A3: 0 / 空 / 非法', () => {
    expect(parseAmountCell('0')).toMatchObject({ ok: false, reason: 'zero' });
    expect(parseAmountCell('-0.00')).toMatchObject({ ok: false, reason: 'zero' });
    expect(parseAmountCell('')).toMatchObject({ ok: false, reason: 'empty' });
    expect(parseAmountCell('abc')).toMatchObject({ ok: false, reason: 'invalid' });
  });

  it('A4: 行级集成：负数/精度产生 WARNING，0 为 ERROR', () => {
    const r = analyze(csvOf('日期,类型,金额,一级分类', ['2026-06-10,支出,-35.567,餐饮', '2026-06-10,支出,0,餐饮']));
    expect(r.rows[0]!.amountCents).toBe(3557);
    // 缺归属列的共同家庭还会有一条 §3.8 汇总 WARNING，此处只断言金额相关
    expect(r.warnings.filter((w) => w.field === '金额').map((w) => w.code).sort()).toEqual(['AMOUNT_NEGATIVE_ABS', 'AMOUNT_ROUNDED']);
    expect(r.errors).toHaveLength(1);
    expect(r.errors[0]?.code).toBe('AMOUNT_ZERO');
    expect(r.importableRows).toBe(1);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// §3.7 分类匹配
// ─────────────────────────────────────────────────────────────────────────────

describe('分类匹配（§3.7）', () => {
  const G = (c1: string, c2 = '', type = '支出') =>
    analyze(csvOf('日期,类型,金额,一级分类,二级分类', [`2026-06-10,${type},35.50,${c1},${c2}`]));

  it('G1: 一级+二级精确命中', () => {
    const r = G('餐饮', '外卖');
    expect(r.errors).toHaveLength(0);
    expect(r.rows[0]!.categoryId).toBe('c-food-takeout');
  });

  it('G2: 二级未命中 ⇒ WARNING 降级默认子分类（is_parent_default）', () => {
    const r = G('餐饮', '不存在的二级');
    expect(r.errors).toHaveLength(0);
    expect(r.warnings[0]?.code).toBe('SUBCATEGORY_FALLBACK');
    expect(r.rows[0]!.categoryId).toBe('c-food-takeout');
  });

  it('G3: 二级为空 ⇒ 静默取默认子分类（无分类相关 WARNING）', () => {
    const r = G('餐饮', '');
    expect(r.warnings.filter((w) => w.field === '二级分类' || w.field === '一级分类')).toHaveLength(0);
    expect(r.rows[0]!.categoryId).toBe('c-food-takeout');
  });

  it('G4: 自定义分类优先于同名系统分类', () => {
    const custom = mkCat({ id: 'c-custom-food', familyId: 'fam-1', name: '餐饮', type: 'expense' });
    const r = analyze(csvOf('日期,类型,金额,一级分类', ['2026-06-10,支出,1,餐饮']), { categories: [...CATEGORIES, custom] });
    expect(r.rows[0]!.categoryId).toBe('c-custom-food');
  });

  it('G5: 模糊匹配：全角/尾部空格/繁体归一', () => {
    expect(G('餐饮 ').rows[0]!.categoryId).toBe('c-food-takeout');
    expect(G('寵物費').rows[0]!.categoryId).toBe('c-custom-pet'); // 繁→简命中自定义
  });

  it('G6: 一级未命中 ⇒ ERROR CATEGORY_NOT_FOUND；transfer 文案带分类提示', () => {
    expect(G('不存在的一级').errors[0]?.code).toBe('CATEGORY_NOT_FOUND');
    const r = G('转账', '', '转账');
    expect(r.errors[0]?.code).toBe('CATEGORY_NOT_FOUND');
    expect(r.errors[0]?.message).toContain('储值 / 账户互转 / 赊销');
  });

  it('G7: 跨 type 命中 ⇒ CATEGORY_TYPE_MISMATCH 专用文案', () => {
    const r = G('餐饮', '', '收入');
    expect(r.errors[0]?.code).toBe('CATEGORY_TYPE_MISMATCH');
    expect(r.errors[0]?.message).toContain('属于支出类型，不能用于收入记录');
  });

  it('G8: 一级无子级 ⇒ entries 直接指向一级分类（与导出口径一致）', () => {
    const leafless = mkCat({ id: 'c-leafless', familyId: 'fam-1', name: '红包', type: 'expense' });
    const r = analyze(csvOf('日期,类型,金额,一级分类', ['2026-06-10,支出,88,红包']), { categories: [...CATEGORIES, leafless] });
    expect(r.errors).toHaveLength(0);
    expect(r.rows[0]!.categoryId).toBe('c-leafless');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// §3.3 记账人匹配
// ─────────────────────────────────────────────────────────────────────────────

describe('记账人匹配（§3.3）', () => {
  const M = (member: string, ctx: Partial<ImportAnalyzeContext> = {}, costra = false) =>
    costra
      ? analyze(csvOf(CANONICAL_HEADER, [costraRow(['2026-06-10', '14:30', '支出', '35.50', '餐饮', '外卖', '共同', member, ''])]), ctx)
      : analyze(csvOf('日期,类型,金额,一级分类,记账人', [`2026-06-10,支出,35.50,餐饮,${member}`]), ctx);

  it('M1: 精确命中 / 大小写不敏感', () => {
    expect(M('小赵').rows[0]!.createdBy).toBe('u1');
    const r = analyze(csvOf('日期,类型,金额,一级分类,记账人', ['2026-06-10,支出,1,餐饮,Alice']), {
      members: [{ userId: 'u9', nickname: 'alice' }],
    });
    expect(r.rows[0]!.createdBy).toBe('u9');
  });

  it('M2: 同名多成员 ⇒ 该行 ERROR MEMBER_AMBIGUOUS（§3.3 规则 3）', () => {
    const r = M('小赵', {
      members: [
        { userId: 'u1', nickname: '小赵' },
        { userId: 'u3', nickname: '小赵' },
      ],
    });
    expect(r.errors[0]?.code).toBe('MEMBER_AMBIGUOUS');
    expect(r.rows).toHaveLength(0);
  });

  it('M3: 外部 CSV 未匹配 ⇒ 归操作者 + WARNING（规则 4b）', () => {
    const r = M('微信用户');
    expect(r.errors).toHaveLength(0);
    expect(r.warnings[0]?.code).toBe('MEMBER_UNMATCHED');
    expect(r.rows[0]!.createdBy).toBe('u-op');
    expect(r.unmatchedMembers).toHaveLength(0); // 外部 CSV 不进映射区（§4.2）
  });

  it('M4: 自产文件未匹配 ⇒ ERROR + createdBy=null 待映射 + unmatched_members 聚合（规则 4a）', () => {
    const r = analyze(
      csvOf(CANONICAL_HEADER, [
        costraRow(['2026-06-10', '14:30', '支出', '1.00', '餐饮', '外卖', '共同', '老王', '']),
        costraRow(['2026-06-10', '15:30', '支出', '2.00', '餐饮', '外卖', '共同', '老王', '']),
        costraRow(['2026-06-10', '16:30', '支出', '3.00', '餐饮', '外卖', '共同', '小赵', '']),
      ]),
    );
    expect(r.isCostraExport).toBe(true);
    expect(r.errors.filter((e) => e.code === 'MEMBER_UNMATCHED')).toHaveLength(2);
    expect(r.unmatchedMembers).toEqual([{ nickname: '老王', rowCount: 2 }]);
    expect(r.rows).toHaveLength(3);
    expect(r.rows.filter((x) => x.createdBy === null)).toHaveLength(2);
    expect(r.rows[2]!.createdBy).toBe('u1');
    expect(r.importableRows).toBe(1); // 待映射行不计入可导入
    expect(r.totalRows).toBe(3);
  });

  it('M5: 空值/列不存在 ⇒ 归操作者且无记账人 WARNING（规则 5 / §3.2.2）', () => {
    const r1 = M('');
    expect(r1.warnings.filter((w) => w.field === '记账人')).toHaveLength(0);
    expect(r1.rows[0]!.createdBy).toBe('u-op');
    const r2 = analyze(csvOf('日期,类型,金额,一级分类', ['2026-06-10,支出,1,餐饮']));
    expect(r2.warnings.filter((w) => w.field === '记账人')).toHaveLength(0);
    expect(r2.rows[0]!.createdBy).toBe('u-op');
  });

  it('M6: 已退出成员不匹配（members 只含活跃）⇒ 自产文件 ERROR', () => {
    const r = M('小赵', {}, true);
    // 默认夹具含小赵 ⇒ 应命中；改为不含小赵的成员表
    const r2 = M('小赵', { members: [{ userId: 'u2', nickname: '小李' }] }, true);
    expect(r.rows[0]!.createdBy).toBe('u1');
    expect(r2.errors[0]?.code).toBe('MEMBER_UNMATCHED');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// §3.8 归属推导
// ─────────────────────────────────────────────────────────────────────────────

describe('归属推导（§3.8）', () => {
  const S = (shared: string, type = '支出', kind: 'personal' | 'shared' = 'shared') =>
    analyze(csvOf('日期,类型,金额,一级分类,归属', [`2026-06-10,${type},35.50,${type === '收入' ? '职业收入' : type === '转账' ? '账户互转' : '餐饮'},${shared}`]), { familyKind: kind });

  it('S1: 共同/shared → shared；个人/personal → personal', () => {
    expect(S('共同').rows[0]!.sharedType).toBe('shared');
    expect(S('SHARED').rows[0]!.sharedType).toBe('shared');
    expect(S('个人').rows[0]!.sharedType).toBe('personal');
    expect(S('personal').rows[0]!.sharedType).toBe('personal');
  });

  it('S2: 支出空值沿用家庭默认：共同家庭 → shared + 汇总 WARNING；个人家庭 → personal 无提示', () => {
    const shared = S('');
    expect(shared.rows[0]!.sharedType).toBe('shared');
    const summary = shared.warnings.find((w) => w.code === 'SHARED_DEFAULT_SUMMARY');
    expect(summary?.message).toContain('1 条支出未指定归属');
    const personal = S('', '支出', 'personal');
    expect(personal.rows[0]!.sharedType).toBe('personal');
    expect(personal.warnings).toHaveLength(0);
  });

  it('S3: 收入/转账行填了归属 ⇒ WARNING 忽略；空 ⇒ NULL 静默', () => {
    const income = S('共同', '收入');
    expect(income.rows[0]!.sharedType).toBeNull();
    expect(income.warnings[0]?.code).toBe('SHARED_TYPE_IGNORED');
    expect(S('', '收入').warnings).toHaveLength(0);
  });

  it('S4: 目标个人家庭 ⇒ 归属强制 personal + 汇总 WARNING（跨家庭污染防护）', () => {
    const r = S('共同', '支出', 'personal');
    expect(r.rows[0]!.sharedType).toBe('personal');
    expect(r.warnings.some((w) => w.code === 'SHARED_FORCED_PERSONAL')).toBe(true);
  });

  it('S5: 归属无法识别 ⇒ 家庭默认 + WARNING', () => {
    const r = S('AA制');
    expect(r.rows[0]!.sharedType).toBe('shared'); // 共同家庭默认
    expect(r.warnings[0]?.code).toBe('SHARED_TYPE_UNRECOGNIZED');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// §9.3 公式防护解码 + §3.11 备注截断 + quoted multiline
// ─────────────────────────────────────────────────────────────────────────────

describe('备注与公式防护（§9.3/§3.11）', () => {
  it('N1: 自产文件解码恰好一层 apostrophe-v2；外部文件不解码', () => {
    const costra = analyze(csvOf(CANONICAL_HEADER, [costraRow(['2026-06-10', '14:30', '支出', '1', '餐饮', '外卖', '共同', '小赵', "''临时'"])]));
    expect(costra.rows[0]!.note).toBe(`'临时'`);
    const external = analyze(csvOf('日期,类型,金额,一级分类,备注', [`2026-06-10,支出,1,餐饮,'临时`]));
    expect(external.rows[0]!.note).toBe(`'临时`);
  });

  it('N2: 超 200 字符按 code point 截断 + WARNING（含 emoji 代理对安全）', () => {
    const emojiNote = '😀'.repeat(201);
    const r = analyze(csvOf('日期,类型,金额,一级分类,备注', [`2026-06-10,支出,1,餐饮,"${emojiNote}"`]));
    expect(r.warnings[0]?.code).toBe('NOTE_TRUNCATED');
    const stored = r.rows[0]!.note!;
    expect(Array.from(stored)).toHaveLength(200);
    expect(stored.endsWith('😀')).toBe(true); // 无 lone surrogate
  });

  it('N3: quoted multiline 备注解析为单条记录，物理行号正确累计', () => {
    const r = analyze(
      csvOf(CANONICAL_HEADER, [
        costraRow(['2026-06-10', '14:30', '支出', '1', '餐饮', '外卖', '共同', '小赵', '第一行\n第二行']),
        costraRow(['2026-06-11', '09:00', '收入', '2', '职业收入', '工资', '', '小赵', '']),
      ]),
    );
    expect(r.ok).toBe(true);
    expect(r.totalRows).toBe(2);
    expect(r.rows[0]!.note).toBe('第一行\n第二行');
    expect(r.rows[0]!.physicalLine).toBe(2);
    expect(r.rows[1]!.physicalLine).toBe(4); // 第一条记录占物理行 2-3
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 不变量与幂等键
// ─────────────────────────────────────────────────────────────────────────────

describe('汇总不变量与幂等键（§3.9/§4.2）', () => {
  it('V1: importableRows = totalRows - errors.length', () => {
    const r = analyze(
      csvOf('日期,类型,金额,一级分类', [
        '2026-06-10,支出,1,餐饮',
        '2026-02-30,支出,1,餐饮', // error
        '2026-06-10,支出,2,餐饮',
      ]),
    );
    expect(r.totalRows).toBe(3);
    expect(r.errors).toHaveLength(1);
    expect(r.importableRows).toBe(2);
  });

  it('V2: 预生成 entry_id（UUID v7）与 client_ref_id = import:<detectId>:<rowNo>', () => {
    const r = analyze(csvOf('日期,类型,金额,一级分类', ['2026-06-10,支出,1,餐饮', '2026-06-11,支出,2,餐饮']));
    expect(r.rows[0]!.clientRefId).toBe('import:det-test:1');
    expect(r.rows[1]!.clientRefId).toBe('import:det-test:2');
    expect(r.rows[0]!.entryId).toMatch(/^[0-9a-f-]{36}$/);
    expect(r.rows[0]!.entryId).not.toBe(r.rows[1]!.entryId);
  });

  it('V3: normalizeFuzzyText 全角→半角 + 繁→简 + 去尾空格', () => {
    expect(normalizeFuzzyText('ＡＢＣ１２３ ')).toBe('ABC123');
    expect(normalizeFuzzyText('餐飲費')).toBe('餐饮费');
  });

  it('V4: 行值为空的核心列逐条 ERROR（§3.2.2）', () => {
    const r = analyze(csvOf('日期,类型,金额,一级分类', [',支出,1,餐饮', '2026-06-10,,1,餐饮', '2026-06-10,支出,,餐饮', '2026-06-10,支出,1,']));
    expect(r.errors.map((e) => e.field)).toEqual(['日期', '类型', '金额', '一级分类']);
    expect(r.errors.every((e) => e.code === 'EMPTY_REQUIRED')).toBe(true);
  });
});
