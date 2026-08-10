/**
 * Costra · Server · 统计页接口测试
 *
 * 卡号：COSTRA-224 · T1~T14
 *
 * 覆盖：
 *   T1  monthly · 401 未登录
 *   T2  monthly · 403 非成员
 *   T3  monthly · 400 非法 month
 *   T4  monthly · 200 空月份返回全 0
 *   T5  monthly · 200 单 expense 单 day · 验证 daily_trend 正确填 0
 *   T6  monthly · 200 max_day / max_single 正确性
 *   T7  monthly · 200 category_ranks 按 parent_id 折叠（多个二级 → 同一一级）
 *   T8  monthly · 200 零值排除 + 排序稳定 + transfer 不计入
 *   T9  yearly · 200 12 月趋势 + max_month_label 正确
 *   T10 yearly · 200 跨年边界（year=2026 不混入 2025/2027）
 *   T11 drill-down level=2 · 二级排行 + 分页
 *   T12 drill-down level=3 · 单笔明细 + JOIN users
 *   T13 drill-down · 400 缺参数（level=2 缺 parent_category_id）
 *   T14 drill-down · 已退出成员历史 expense 仍计入家庭聚合
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { buildApp } from '../src/app.js';
import type { FastifyInstance } from 'fastify';
import {
  authHeaders,
  createSharedFamilyWithMembers,
  getLedgerId,
  insertEntry,
  insertCategory,
  registerUser,
  setFamilySummaryTestApp,
} from './helpers/familySummary.js';
import { getPool } from '../src/db/pool.js';

let app: FastifyInstance;

beforeEach(async () => {
  app = await buildApp({ disableLogger: true });
  setFamilySummaryTestApp(app);
});

async function listFamilies(token: string): Promise<Array<{ id: string; kind: string; ledger_id: string }>> {
  const res = await app.inject({
    method: 'GET',
    url: '/v1/families',
    headers: authHeaders(token),
  });
  return res.json();
}

describe('COSTRA-224: Statistics API · monthly', () => {
  // T1: 未登录
  it('T1: monthly unauthenticated returns 401', async () => {
    const { token } = await registerUser('s-t1-user');
    const families = await listFamilies(token);
    const familyId = families[0].id;

    const res = await app.inject({
      method: 'GET',
      url: `/v1/families/${familyId}/statistics/monthly?month=2026-06`,
    });
    expect(res.statusCode).toBe(401);
  });

  // T2: 非成员
  it('T2: monthly non-member returns 403', async () => {
    const { token: ownerToken } = await registerUser('s-t2-owner');
    const { token: outsiderToken } = await registerUser('s-t2-outsider');
    const familyId = await createSharedFamilyWithMembers(ownerToken, []);

    const res = await app.inject({
      method: 'GET',
      url: `/v1/families/${familyId}/statistics/monthly?month=2026-06`,
      headers: authHeaders(outsiderToken),
    });
    expect(res.statusCode).toBe(403);
    expect(res.json().code).toBe('FAMILY_NOT_MEMBER');
  });

  // T3: 非法 month
  it('T3: monthly invalid month returns 400', async () => {
    const { token } = await registerUser('s-t3-user');
    const families = await listFamilies(token);
    const familyId = families[0].id;

    const r1 = await app.inject({
      method: 'GET',
      url: `/v1/families/${familyId}/statistics/monthly?month=2026-13`,
      headers: authHeaders(token),
    });
    expect(r1.statusCode).toBe(400);

    const r2 = await app.inject({
      method: 'GET',
      url: `/v1/families/${familyId}/statistics/monthly?month=invalid`,
      headers: authHeaders(token),
    });
    expect(r2.statusCode).toBe(400);
  });

  // T4: 空月份返回全 0
  it('T4: monthly empty month returns all zeros', async () => {
    const { token } = await registerUser('s-t4-user');
    const families = await listFamilies(token);
    const familyId = families.find((f) => f.kind === 'personal')!.id;

    const res = await app.inject({
      method: 'GET',
      url: `/v1/families/${familyId}/statistics/monthly?month=2026-01`,
      headers: authHeaders(token),
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.totals.expense).toBe(0);
    expect(body.totals.income).toBe(0);
    expect(body.totals.balance).toBe(0);
    expect(body.totals.entry_count).toBe(0);
    expect(body.daily_trend).toHaveLength(31); // Jan
    expect(body.daily_trend.every((d: { expense: number; income: number }) => d.expense === 0 && d.income === 0)).toBe(true);
    expect(body.extremes.avg_daily_expense).toBe(0);
    expect(body.extremes.max_single_expense).toBe(0);
    expect(body.extremes.max_single_note).toBeNull();
    expect(body.extremes.max_single_category_name).toBeNull();
    expect(body.extremes.max_day_expense).toBe(0);
    expect(body.category_ranks).toEqual([]);
    expect(body.timezone).toBe('Asia/Shanghai');
    expect(body.currency).toBe('CNY');
  });

  // T5: 单 entry · daily_trend 仅对应 day 非零、其他全 0
  it('T5: monthly single entry · daily_trend only that day non-zero', async () => {
    const { token, userId } = await registerUser('s-t5-user');
    const families = await listFamilies(token);
    const family = families.find((f) => f.kind === 'personal')!;
    const ledgerId = await getLedgerId(family.id);

    const cat = await insertCategory({ name: '吃饭', type: 'expense', icon: '🍚' });

    // 2026-06-15 12:00:00 Asia/Shanghai = 2026-06-15 04:00:00 UTC
    await insertEntry({
      ledgerId,
      amount: 5000,
      type: 'expense',
      createdBy: userId,
      occurredAt: '2026-06-15T04:00:00.000Z',
      categoryId: cat,
      sharedType: 'personal',
    });

    const res = await app.inject({
      method: 'GET',
      url: `/v1/families/${family.id}/statistics/monthly?month=2026-06`,
      headers: authHeaders(token),
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.totals.expense).toBe(5000);
    expect(body.totals.entry_count).toBe(1);
    expect(body.daily_trend).toHaveLength(30); // Jun
    const day15 = body.daily_trend.find((d: { day: number }) => d.day === 15);
    expect(day15.expense).toBe(5000);
    const others = body.daily_trend.filter((d: { day: number }) => d.day !== 15);
    expect(others.every((d: { expense: number }) => d.expense === 0)).toBe(true);
  });

  // T6: max_single + max_day
  it('T6: monthly extremes (max_single, max_day, avg_daily) correct', async () => {
    const { token, userId } = await registerUser('s-t6-user');
    const families = await listFamilies(token);
    const family = families.find((f) => f.kind === 'personal')!;
    const ledgerId = await getLedgerId(family.id);
    const cat = await insertCategory({ name: '购物', type: 'expense', icon: '🛒' });

    // day 5: 1000 + 2000 = 3000
    await insertEntry({ ledgerId, amount: 1000, type: 'expense', createdBy: userId, occurredAt: '2026-06-04T16:30:00.000Z', categoryId: cat, sharedType: 'personal' }); // day 5 in Shanghai
    await insertEntry({ ledgerId, amount: 2000, type: 'expense', createdBy: userId, occurredAt: '2026-06-05T03:00:00.000Z', categoryId: cat, sharedType: 'personal' });

    // day 10: 5000 (single max)
    await insertEntry({ ledgerId, amount: 5000, type: 'expense', createdBy: userId, occurredAt: '2026-06-10T05:00:00.000Z', categoryId: cat, sharedType: 'personal', note: '机票' });

    // day 20: 4000 + 1000 = 5000 (tie max_day)
    await insertEntry({ ledgerId, amount: 4000, type: 'expense', createdBy: userId, occurredAt: '2026-06-20T05:00:00.000Z', categoryId: cat, sharedType: 'personal' });
    await insertEntry({ ledgerId, amount: 1000, type: 'expense', createdBy: userId, occurredAt: '2026-06-20T06:00:00.000Z', categoryId: cat, sharedType: 'personal' });

    const res = await app.inject({
      method: 'GET',
      url: `/v1/families/${family.id}/statistics/monthly?month=2026-06`,
      headers: authHeaders(token),
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.totals.expense).toBe(13000);
    expect(body.extremes.max_single_expense).toBe(5000);
    expect(body.extremes.max_single_note).toBe('机票');
    expect(body.extremes.max_single_category_name).toBe('购物');
    expect(body.extremes.max_day_expense).toBe(5000);
    // avg = 13000 / 30 = 433.33 → round 433
    expect(body.extremes.avg_daily_expense).toBe(Math.round(13000 / 30));
  });

  // T7: category_ranks 折叠
  it('T7: monthly category_ranks folds L2 to L1 by parent_id', async () => {
    const { token, userId } = await registerUser('s-t7-user');
    const families = await listFamilies(token);
    const family = families.find((f) => f.kind === 'personal')!;
    const ledgerId = await getLedgerId(family.id);

    const parent1 = await insertCategory({ name: '餐饮', type: 'expense', icon: '🍚' });
    const sub1a = await insertCategory({ name: '外卖', type: 'expense', icon: '🥡', parentId: parent1 });
    const sub1b = await insertCategory({ name: '堂食', type: 'expense', icon: '🍴', parentId: parent1 });

    const parent2 = await insertCategory({ name: '交通', type: 'expense', icon: '🚗' });
    const sub2 = await insertCategory({ name: '打车', type: 'expense', icon: '🚖', parentId: parent2 });

    await insertEntry({ ledgerId, amount: 3000, type: 'expense', createdBy: userId, occurredAt: '2026-06-05T05:00:00.000Z', categoryId: sub1a, sharedType: 'personal' });
    await insertEntry({ ledgerId, amount: 2000, type: 'expense', createdBy: userId, occurredAt: '2026-06-06T05:00:00.000Z', categoryId: sub1b, sharedType: 'personal' });
    await insertEntry({ ledgerId, amount: 1500, type: 'expense', createdBy: userId, occurredAt: '2026-06-07T05:00:00.000Z', categoryId: sub2, sharedType: 'personal' });

    const res = await app.inject({
      method: 'GET',
      url: `/v1/families/${family.id}/statistics/monthly?month=2026-06`,
      headers: authHeaders(token),
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    const ranks = body.category_ranks;
    expect(ranks).toHaveLength(2);
    // 餐饮 = 5000 should be first
    expect(ranks[0].category_id).toBe(parent1);
    expect(ranks[0].category_name).toBe('餐饮');
    expect(ranks[0].amount).toBe(5000);
    expect(ranks[0].entry_count).toBe(2);
    // 交通 = 1500
    expect(ranks[1].category_id).toBe(parent2);
    expect(ranks[1].amount).toBe(1500);
    // ratio_bps based on total expense 6500
    expect(ranks[0].ratio_bps).toBe(Math.round((5000 / 6500) * 10000));
  });

  // T8: 零值排除 + transfer 不计入 + shared_type IS NULL 不计入
  it('T8: monthly excludes transfer and shared_type IS NULL', async () => {
    const { token, userId } = await registerUser('s-t8-user');
    const families = await listFamilies(token);
    const family = families.find((f) => f.kind === 'personal')!;
    const ledgerId = await getLedgerId(family.id);
    const cat = await insertCategory({ name: '其他', type: 'expense', icon: '📦' });

    // expense with shared_type='personal' → 计入
    await insertEntry({ ledgerId, amount: 1000, type: 'expense', createdBy: userId, occurredAt: '2026-06-05T05:00:00.000Z', categoryId: cat, sharedType: 'personal' });
    // expense with shared_type=NULL → 不计入
    await insertEntry({ ledgerId, amount: 999, type: 'expense', createdBy: userId, occurredAt: '2026-06-06T05:00:00.000Z', categoryId: cat, sharedType: null });
    // transfer → 不计入
    await insertEntry({ ledgerId, amount: 8888, type: 'transfer', createdBy: userId, occurredAt: '2026-06-07T05:00:00.000Z', categoryId: null, sharedType: null });
    // income 计入 income but not expense
    await insertEntry({ ledgerId, amount: 5000, type: 'income', createdBy: userId, occurredAt: '2026-06-08T05:00:00.000Z', categoryId: null, sharedType: null });

    const res = await app.inject({
      method: 'GET',
      url: `/v1/families/${family.id}/statistics/monthly?month=2026-06`,
      headers: authHeaders(token),
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.totals.expense).toBe(1000);
    expect(body.totals.income).toBe(5000);
    expect(body.totals.balance).toBe(4000);
    // entry_count: 1 expense (counted) + 1 income = 2 (transfer + null shared excluded)
    expect(body.totals.entry_count).toBe(2);
  });
});

describe('COSTRA-224: Statistics API · yearly', () => {
  it('T9: yearly trend has 12 months and max_month_label correct', async () => {
    const { token, userId } = await registerUser('s-t9-user');
    const families = await listFamilies(token);
    const family = families.find((f) => f.kind === 'personal')!;
    const ledgerId = await getLedgerId(family.id);
    const parent = await insertCategory({ name: '吃喝', type: 'expense', icon: '🍕' });
    const cat = await insertCategory({ name: '日常', type: 'expense', icon: '🍱', parentId: parent });

    // March: 2000 + 1000 = 3000
    await insertEntry({ ledgerId, amount: 2000, type: 'expense', createdBy: userId, occurredAt: '2026-03-05T05:00:00.000Z', categoryId: cat, sharedType: 'personal' });
    await insertEntry({ ledgerId, amount: 1000, type: 'expense', createdBy: userId, occurredAt: '2026-03-15T05:00:00.000Z', categoryId: cat, sharedType: 'personal' });
    // August: 8000 (max month)
    await insertEntry({ ledgerId, amount: 8000, type: 'expense', createdBy: userId, occurredAt: '2026-08-05T05:00:00.000Z', categoryId: cat, sharedType: 'personal', note: '度假酒店' });

    const res = await app.inject({
      method: 'GET',
      url: `/v1/families/${family.id}/statistics/yearly?year=2026`,
      headers: authHeaders(token),
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.year).toBe('2026');
    expect(body.totals.expense).toBe(11000);
    expect(body.monthly_trend).toHaveLength(12);
    const march = body.monthly_trend.find((m: { month: number }) => m.month === 3);
    expect(march.expense).toBe(3000);
    expect(march.entry_count).toBe(2);
    const aug = body.monthly_trend.find((m: { month: number }) => m.month === 8);
    expect(aug.expense).toBe(8000);
    expect(body.extremes.max_month_expense).toBe(8000);
    expect(body.extremes.max_month_label).toBe('8月');
    expect(body.extremes.max_single_expense).toBe(8000);
    expect(body.extremes.max_single_note).toBe('度假酒店');
    expect(body.extremes.max_single_category_name).toBe('日常');
    expect(body.extremes.top_category_name).toBe('吃喝');
    expect(body.extremes.top_category_amount).toBe(11000);
  });

  it('T10: yearly excludes other years (boundary check)', async () => {
    const { token, userId } = await registerUser('s-t10-user');
    const families = await listFamilies(token);
    const family = families.find((f) => f.kind === 'personal')!;
    const ledgerId = await getLedgerId(family.id);
    const cat = await insertCategory({ name: '其他', type: 'expense', icon: '📦' });

    // 2025-12-31 23:00 Shanghai = 2025-12-31 15:00 UTC → 2025
    await insertEntry({ ledgerId, amount: 9999, type: 'expense', createdBy: userId, occurredAt: '2025-12-31T15:00:00.000Z', categoryId: cat, sharedType: 'personal' });
    // 2026-01-01 00:30 Shanghai = 2025-12-31 16:30 UTC → 2026
    await insertEntry({ ledgerId, amount: 1000, type: 'expense', createdBy: userId, occurredAt: '2025-12-31T16:30:00.000Z', categoryId: cat, sharedType: 'personal' });
    // 2027-01-01 00:30 Shanghai = 2026-12-31 16:30 UTC → 2027
    await insertEntry({ ledgerId, amount: 7777, type: 'expense', createdBy: userId, occurredAt: '2026-12-31T16:30:00.000Z', categoryId: cat, sharedType: 'personal' });

    const res = await app.inject({
      method: 'GET',
      url: `/v1/families/${family.id}/statistics/yearly?year=2026`,
      headers: authHeaders(token),
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.totals.expense).toBe(1000);
  });
});

describe('COSTRA-224: Statistics API · drill-down', () => {
  it('T11: drill-down level=2 returns subcategory rank with pagination', async () => {
    const { token, userId } = await registerUser('s-t11-user');
    const families = await listFamilies(token);
    const family = families.find((f) => f.kind === 'personal')!;
    const ledgerId = await getLedgerId(family.id);

    const parent = await insertCategory({ name: '餐饮', type: 'expense', icon: '🍚' });
    const sub1 = await insertCategory({ name: '外卖', type: 'expense', icon: '🥡', parentId: parent });
    const sub2 = await insertCategory({ name: '堂食', type: 'expense', icon: '🍴', parentId: parent });
    const sub3 = await insertCategory({ name: '夜宵', type: 'expense', icon: '🌃', parentId: parent });

    await insertEntry({ ledgerId, amount: 5000, type: 'expense', createdBy: userId, occurredAt: '2026-06-05T05:00:00.000Z', categoryId: sub1, sharedType: 'personal' });
    await insertEntry({ ledgerId, amount: 3000, type: 'expense', createdBy: userId, occurredAt: '2026-06-06T05:00:00.000Z', categoryId: sub2, sharedType: 'personal' });
    await insertEntry({ ledgerId, amount: 1500, type: 'expense', createdBy: userId, occurredAt: '2026-06-07T05:00:00.000Z', categoryId: sub3, sharedType: 'personal' });

    // limit=2 offset=0
    const res = await app.inject({
      method: 'GET',
      url: `/v1/families/${family.id}/statistics/drill-down?month=2026-06&level=2&parent_category_id=${parent}&limit=2`,
      headers: authHeaders(token),
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.level).toBe(2);
    expect(body.parent_category_id).toBe(parent);
    expect(body.parent_category_name).toBe('餐饮');
    expect(body.parent_amount).toBe(9500);
    expect(body.items).toHaveLength(2);
    expect(body.items[0].category_id).toBe(sub1);
    expect(body.items[0].amount).toBe(5000);
    expect(body.items[1].category_id).toBe(sub2);
    expect(body.total_count).toBe(3);
    expect(body.has_more).toBe(true);

    // offset=2
    const res2 = await app.inject({
      method: 'GET',
      url: `/v1/families/${family.id}/statistics/drill-down?month=2026-06&level=2&parent_category_id=${parent}&limit=2&offset=2`,
      headers: authHeaders(token),
    });
    const body2 = res2.json();
    expect(body2.items).toHaveLength(1);
    expect(body2.items[0].category_id).toBe(sub3);
    expect(body2.has_more).toBe(false);
  });

  it('T12: drill-down level=3 returns entry list with nickname/avatar', async () => {
    const { token: ownerToken, userId: ownerId } = await registerUser('s-t12-owner');
    const { token: memberToken, userId: memberId } = await registerUser('s-t12-member');
    const familyId = await createSharedFamilyWithMembers(ownerToken, [memberToken]);
    const ledgerId = await getLedgerId(familyId);

    const parent = await insertCategory({ name: '餐饮', type: 'expense', icon: '🍚' });
    const sub = await insertCategory({ name: '外卖', type: 'expense', icon: '🥡', parentId: parent });

    const recurringId = '00000000-0000-0000-0000-0000000000c1';
    await insertEntry({ ledgerId, amount: 5000, type: 'expense', createdBy: ownerId, occurredAt: '2026-06-05T05:00:00.000Z', categoryId: sub, sharedType: 'shared', sourceRecurringId: recurringId });
    await insertEntry({ ledgerId, amount: 3000, type: 'expense', createdBy: memberId, occurredAt: '2026-06-06T05:00:00.000Z', categoryId: sub, sharedType: 'personal' });

    // owner 设置 nickname 验证 JOIN
    await getPool().query(
      `UPDATE users SET nickname = $1, avatar_url = $2 WHERE id = $3`,
      ['史蒂夫', 'https://example.com/avatar.png', ownerId],
    );

    const res = await app.inject({
      method: 'GET',
      url: `/v1/families/${familyId}/statistics/drill-down?month=2026-06&level=3&category_id=${sub}`,
      headers: authHeaders(ownerToken),
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.level).toBe(3);
    expect(body.category_id).toBe(sub);
    expect(body.category_name).toBe('外卖');
    expect(body.parent_category_id).toBe(parent);
    expect(body.parent_category_name).toBe('餐饮');
    expect(body.category_amount).toBe(8000);
    expect(body.items).toHaveLength(2);
    // 按 amount DESC 排序
    expect(body.items[0].amount).toBe(5000);
    expect(body.items[0].nickname).toBe('史蒂夫');
    expect(body.items[0].avatar_url).toBe('https://example.com/avatar.png');
    expect(body.items[0].shared_type).toBe('shared');
    expect(body.items[0].source_recurring_id).toBe(recurringId);
    expect(body.items[1].amount).toBe(3000);
    expect(body.items[1].created_by).toBe(memberId);
    expect(body.items[1].source_recurring_id).toBeNull();
    expect(body.has_more).toBe(false);
  });

  it('T13: drill-down 400 missing required params', async () => {
    const { token } = await registerUser('s-t13-user');
    const families = await listFamilies(token);
    const familyId = families[0].id;

    // level=2 缺 parent_category_id
    const r1 = await app.inject({
      method: 'GET',
      url: `/v1/families/${familyId}/statistics/drill-down?month=2026-06&level=2`,
      headers: authHeaders(token),
    });
    expect(r1.statusCode).toBe(400);

    // level=3 缺 category_id
    const r2 = await app.inject({
      method: 'GET',
      url: `/v1/families/${familyId}/statistics/drill-down?month=2026-06&level=3`,
      headers: authHeaders(token),
    });
    expect(r2.statusCode).toBe(400);

    // 缺 month 与 year
    const r3 = await app.inject({
      method: 'GET',
      url: `/v1/families/${familyId}/statistics/drill-down?level=2&parent_category_id=00000000-0000-0000-0000-000000000001`,
      headers: authHeaders(token),
    });
    expect(r3.statusCode).toBe(400);

    // month 与 year 同时传
    const r4 = await app.inject({
      method: 'GET',
      url: `/v1/families/${familyId}/statistics/drill-down?month=2026-06&year=2026&level=2&parent_category_id=00000000-0000-0000-0000-000000000001`,
      headers: authHeaders(token),
    });
    expect(r4.statusCode).toBe(400);
  });

  it('T14: monthly counts left-member historical expenses', async () => {
    const { token: ownerToken, userId: ownerId } = await registerUser('s-t14-owner');
    const { token: memberToken, userId: memberId } = await registerUser('s-t14-member');
    const familyId = await createSharedFamilyWithMembers(ownerToken, [memberToken]);
    const ledgerId = await getLedgerId(familyId);
    const cat = await insertCategory({ name: '其他', type: 'expense', icon: '📦' });

    // member 在 family 时记一笔
    await insertEntry({ ledgerId, amount: 2000, type: 'expense', createdBy: memberId, occurredAt: '2026-06-05T05:00:00.000Z', categoryId: cat, sharedType: 'personal' });
    await insertEntry({ ledgerId, amount: 1000, type: 'expense', createdBy: ownerId, occurredAt: '2026-06-06T05:00:00.000Z', categoryId: cat, sharedType: 'personal' });

    // member 退出
    await getPool().query(
      `UPDATE family_members SET left_at = now() WHERE family_id = $1 AND user_id = $2`,
      [familyId, memberId],
    );

    // owner 拉聚合：member 的历史 expense 仍计入
    const res = await app.inject({
      method: 'GET',
      url: `/v1/families/${familyId}/statistics/monthly?month=2026-06`,
      headers: authHeaders(ownerToken),
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.totals.expense).toBe(3000);
  });
});

// === COSTRA-260: user_id 维度过滤测试 ===

describe('COSTRA-260: Statistics API · user_id dimension', () => {
  // T15: monthly + user_id 仅该成员 entries 计入
  it('T15: monthly + user_id filters only that member entries', async () => {
    const { token: ownerToken, userId: ownerId } = await registerUser('s-t15-owner');
    const { token: memberToken, userId: memberId } = await registerUser('s-t15-member');
    const familyId = await createSharedFamilyWithMembers(ownerToken, [memberToken]);
    const ledgerId = await getLedgerId(familyId);

    const parent = await insertCategory({ name: '餐饮', type: 'expense', icon: '🍚' });
    const sub = await insertCategory({ name: '外卖', type: 'expense', icon: '🥡', parentId: parent });

    // owner entries
    await insertEntry({ ledgerId, amount: 5000, type: 'expense', createdBy: ownerId, occurredAt: '2026-06-10T05:00:00.000Z', categoryId: sub, sharedType: 'shared' });
    await insertEntry({ ledgerId, amount: 2000, type: 'income', createdBy: ownerId, occurredAt: '2026-06-10T06:00:00.000Z', categoryId: null, sharedType: null });
    // member entries
    await insertEntry({ ledgerId, amount: 3000, type: 'expense', createdBy: memberId, occurredAt: '2026-06-15T05:00:00.000Z', categoryId: sub, sharedType: 'personal' });
    await insertEntry({ ledgerId, amount: 1000, type: 'income', createdBy: memberId, occurredAt: '2026-06-15T06:00:00.000Z', categoryId: null, sharedType: null });

    // 不传 user_id → 全部
    const resAll = await app.inject({
      method: 'GET',
      url: `/v1/families/${familyId}/statistics/monthly?month=2026-06`,
      headers: authHeaders(ownerToken),
    });
    expect(resAll.statusCode).toBe(200);
    const allBody = resAll.json();
    expect(allBody.totals.expense).toBe(8000);
    expect(allBody.totals.income).toBe(3000);
    expect(allBody.filtered_user_id).toBeNull();

    // 传 user_id = memberId → 仅 member 的 entries
    const resMember = await app.inject({
      method: 'GET',
      url: `/v1/families/${familyId}/statistics/monthly?month=2026-06&user_id=${memberId}`,
      headers: authHeaders(ownerToken),
    });
    expect(resMember.statusCode).toBe(200);
    const memberBody = resMember.json();
    expect(memberBody.totals.expense).toBe(3000);
    expect(memberBody.totals.income).toBe(1000);
    expect(memberBody.totals.entry_count).toBe(2);
    expect(memberBody.filtered_user_id).toBe(memberId);
    // daily_trend: day 15 = 3000 expense, day 10 = 0
    const day15 = memberBody.daily_trend.find((d: { day: number }) => d.day === 15);
    expect(day15.expense).toBe(3000);
    const day10 = memberBody.daily_trend.find((d: { day: number }) => d.day === 10);
    expect(day10.expense).toBe(0);
    // category_ranks 仅 member 的 entries
    expect(memberBody.category_ranks.length).toBeGreaterThanOrEqual(1);
    expect(memberBody.category_ranks[0].amount).toBe(3000);
    // extremes
    expect(memberBody.extremes.max_single_expense).toBe(3000);
  });

  // T16: monthly + user_id = 已退出成员 → 返回其历史数据（不抛 403）
  it('T16: monthly + user_id of left member returns historical data', async () => {
    const { token: ownerToken, userId: ownerId } = await registerUser('s-t16-owner');
    const { token: memberToken, userId: memberId } = await registerUser('s-t16-member');
    const familyId = await createSharedFamilyWithMembers(ownerToken, [memberToken]);
    const ledgerId = await getLedgerId(familyId);
    const cat = await insertCategory({ name: '日用', type: 'expense', icon: '🧴' });

    // member 记一笔
    await insertEntry({ ledgerId, amount: 4000, type: 'expense', createdBy: memberId, occurredAt: '2026-06-08T05:00:00.000Z', categoryId: cat, sharedType: 'shared' });
    // owner 也记一笔
    await insertEntry({ ledgerId, amount: 1000, type: 'expense', createdBy: ownerId, occurredAt: '2026-06-09T05:00:00.000Z', categoryId: cat, sharedType: 'shared' });

    // member 退出
    await getPool().query(
      `UPDATE family_members SET left_at = now() WHERE family_id = $1 AND user_id = $2`,
      [familyId, memberId],
    );

    // owner 查已退出成员 → 正常返回数据
    const res = await app.inject({
      method: 'GET',
      url: `/v1/families/${familyId}/statistics/monthly?month=2026-06&user_id=${memberId}`,
      headers: authHeaders(ownerToken),
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.totals.expense).toBe(4000);
    expect(body.filtered_user_id).toBe(memberId);
  });

  // T17: yearly + user_id 跨月聚合正确
  it('T17: yearly + user_id aggregates correctly across months', async () => {
    const { token: ownerToken, userId: ownerId } = await registerUser('s-t17-owner');
    const { token: memberToken, userId: memberId } = await registerUser('s-t17-member');
    const familyId = await createSharedFamilyWithMembers(ownerToken, [memberToken]);
    const ledgerId = await getLedgerId(familyId);
    const parent = await insertCategory({ name: '购物', type: 'expense', icon: '🛒' });
    const sub = await insertCategory({ name: '网购', type: 'expense', icon: '📦', parentId: parent });

    // owner: March 2000, June 6000
    await insertEntry({ ledgerId, amount: 2000, type: 'expense', createdBy: ownerId, occurredAt: '2026-03-10T05:00:00.000Z', categoryId: sub, sharedType: 'shared' });
    await insertEntry({ ledgerId, amount: 6000, type: 'expense', createdBy: ownerId, occurredAt: '2026-06-15T05:00:00.000Z', categoryId: sub, sharedType: 'shared' });
    // member: March 3000, August 5000
    await insertEntry({ ledgerId, amount: 3000, type: 'expense', createdBy: memberId, occurredAt: '2026-03-20T05:00:00.000Z', categoryId: sub, sharedType: 'personal' });
    await insertEntry({ ledgerId, amount: 5000, type: 'expense', createdBy: memberId, occurredAt: '2026-08-10T05:00:00.000Z', categoryId: sub, sharedType: 'personal' });

    // yearly + user_id = memberId
    const res = await app.inject({
      method: 'GET',
      url: `/v1/families/${familyId}/statistics/yearly?year=2026&user_id=${memberId}`,
      headers: authHeaders(ownerToken),
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.totals.expense).toBe(8000); // 3000 + 5000
    expect(body.filtered_user_id).toBe(memberId);
    // March = 3000, August = 5000
    const march = body.monthly_trend.find((m: { month: number }) => m.month === 3);
    expect(march.expense).toBe(3000);
    const aug = body.monthly_trend.find((m: { month: number }) => m.month === 8);
    expect(aug.expense).toBe(5000);
    // June should be 0 for member
    const june = body.monthly_trend.find((m: { month: number }) => m.month === 6);
    expect(june.expense).toBe(0);
    expect(body.extremes.max_month_expense).toBe(5000);
    expect(body.extremes.max_month_label).toBe('8月');
  });

  // T18: user_id = 非家庭成员 → 403 FORBIDDEN
  it('T18: user_id of non-member returns 403', async () => {
    const { token: ownerToken } = await registerUser('s-t18-owner');
    const { userId: outsiderId } = await registerUser('s-t18-outsider');
    const familyId = await createSharedFamilyWithMembers(ownerToken, []);

    // monthly
    const r1 = await app.inject({
      method: 'GET',
      url: `/v1/families/${familyId}/statistics/monthly?month=2026-06&user_id=${outsiderId}`,
      headers: authHeaders(ownerToken),
    });
    expect(r1.statusCode).toBe(403);
    expect(r1.json().code).toBe('FAMILY_NOT_MEMBER');

    // yearly
    const r2 = await app.inject({
      method: 'GET',
      url: `/v1/families/${familyId}/statistics/yearly?year=2026&user_id=${outsiderId}`,
      headers: authHeaders(ownerToken),
    });
    expect(r2.statusCode).toBe(403);

    // drill-down
    const r3 = await app.inject({
      method: 'GET',
      url: `/v1/families/${familyId}/statistics/drill-down?month=2026-06&level=2&parent_category_id=00000000-0000-0000-0000-000000000001&user_id=${outsiderId}`,
      headers: authHeaders(ownerToken),
    });
    expect(r3.statusCode).toBe(403);
  });

  // T19: drill-down + user_id · L2 二级排行 / L3 单笔列表都过滤
  it('T19: drill-down + user_id filters L2 and L3 correctly', async () => {
    const { token: ownerToken, userId: ownerId } = await registerUser('s-t19-owner');
    const { token: memberToken, userId: memberId } = await registerUser('s-t19-member');
    const familyId = await createSharedFamilyWithMembers(ownerToken, [memberToken]);
    const ledgerId = await getLedgerId(familyId);

    const parent = await insertCategory({ name: '餐饮', type: 'expense', icon: '🍚' });
    const sub1 = await insertCategory({ name: '外卖', type: 'expense', icon: '🥡', parentId: parent });
    const sub2 = await insertCategory({ name: '堂食', type: 'expense', icon: '🍴', parentId: parent });

    // owner: sub1=5000, sub2=2000
    await insertEntry({ ledgerId, amount: 5000, type: 'expense', createdBy: ownerId, occurredAt: '2026-06-05T05:00:00.000Z', categoryId: sub1, sharedType: 'shared' });
    await insertEntry({ ledgerId, amount: 2000, type: 'expense', createdBy: ownerId, occurredAt: '2026-06-06T05:00:00.000Z', categoryId: sub2, sharedType: 'shared' });
    // member: sub1=3000
    await insertEntry({ ledgerId, amount: 3000, type: 'expense', createdBy: memberId, occurredAt: '2026-06-07T05:00:00.000Z', categoryId: sub1, sharedType: 'personal' });

    // L2 drill-down + user_id = memberId: 只有 sub1=3000
    const resL2 = await app.inject({
      method: 'GET',
      url: `/v1/families/${familyId}/statistics/drill-down?month=2026-06&level=2&parent_category_id=${parent}&user_id=${memberId}`,
      headers: authHeaders(ownerToken),
    });
    expect(resL2.statusCode).toBe(200);
    const l2Body = resL2.json();
    expect(l2Body.level).toBe(2);
    expect(l2Body.items).toHaveLength(1);
    expect(l2Body.items[0].category_id).toBe(sub1);
    expect(l2Body.items[0].amount).toBe(3000);
    expect(l2Body.parent_amount).toBe(3000);

    // L3 drill-down + user_id = memberId: 只有 member 那条 entry
    const resL3 = await app.inject({
      method: 'GET',
      url: `/v1/families/${familyId}/statistics/drill-down?month=2026-06&level=3&category_id=${sub1}&user_id=${memberId}`,
      headers: authHeaders(ownerToken),
    });
    expect(resL3.statusCode).toBe(200);
    const l3Body = resL3.json();
    expect(l3Body.level).toBe(3);
    expect(l3Body.items).toHaveLength(1);
    expect(l3Body.items[0].amount).toBe(3000);
    expect(l3Body.items[0].created_by).toBe(memberId);
    expect(l3Body.category_amount).toBe(3000);
  });
});
