/**
 * Costra · Server · 家庭财务聚合核心测试
 *
 * 卡号：COSTRA-222 · 覆盖 T1~T10.5
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { buildApp } from '../src/app.js';
import type { FastifyInstance } from 'fastify';
import {
  authHeaders,
  createSharedFamilyWithMembers,
  getLedgerId,
  insertCategory,
  insertEntry,
  registerUser,
  setFamilySummaryTestApp,
} from './helpers/familySummary.js';

let app: FastifyInstance;

beforeEach(async () => {
  app = await buildApp({ disableLogger: false });
  setFamilySummaryTestApp(app);
});

describe('COSTRA-222: Family Summary API · core', () => {

  // T1: 未登录访问 summary → 401
  it('T1: unauthenticated access returns 401', async () => {
    const { token } = await registerUser('t1-user');
    const listRes = await app.inject({
      method: 'GET',
      url: '/v1/families',
      headers: authHeaders(token),
    });
    const familyId = listRes.json()[0].id;

    const res = await app.inject({
      method: 'GET',
      url: `/v1/families/${familyId}/summary?month=2026-06`,
    });
    expect(res.statusCode).toBe(401);
    expect(res.json().code).toBe('UNAUTHENTICATED');
  });

  // T2: 非 member 访问 shared family summary → 403
  it('T2: non-member access returns 403 FAMILY_NOT_MEMBER', async () => {
    const { token: ownerToken } = await registerUser('t2-owner');
    const { token: outsiderToken } = await registerUser('t2-outsider');

    const familyId = await createSharedFamilyWithMembers(ownerToken, []);

    const res = await app.inject({
      method: 'GET',
      url: `/v1/families/${familyId}/summary?month=2026-06`,
      headers: authHeaders(outsiderToken),
    });
    expect(res.statusCode).toBe(403);
    expect(res.json().code).toBe('FAMILY_NOT_MEMBER');
  });

  // T3: 非法 month → 400
  it('T3: invalid month returns 400', async () => {
    const { token } = await registerUser('t3-user');
    const listRes = await app.inject({
      method: 'GET',
      url: '/v1/families',
      headers: authHeaders(token),
    });
    const familyId = listRes.json()[0].id;

    // month=2026-13
    const res1 = await app.inject({
      method: 'GET',
      url: `/v1/families/${familyId}/summary?month=2026-13`,
      headers: authHeaders(token),
    });
    expect(res1.statusCode).toBe(400);
    expect(res1.json().code).toBe('INVALID_ARGUMENT');

    // month=abc
    const res2 = await app.inject({
      method: 'GET',
      url: `/v1/families/${familyId}/summary?month=abc`,
      headers: authHeaders(token),
    });
    expect(res2.statusCode).toBe(400);
  });

  // T4: 非法 top_n → 400
  it('T4: invalid top_n returns 400', async () => {
    const { token } = await registerUser('t4-user');
    const listRes = await app.inject({
      method: 'GET',
      url: '/v1/families',
      headers: authHeaders(token),
    });
    const familyId = listRes.json()[0].id;

    // top_n=0
    const res1 = await app.inject({
      method: 'GET',
      url: `/v1/families/${familyId}/summary?month=2026-06&top_n=0`,
      headers: authHeaders(token),
    });
    expect(res1.statusCode).toBe(400);

    // top_n=21
    const res2 = await app.inject({
      method: 'GET',
      url: `/v1/families/${familyId}/summary?month=2026-06&top_n=21`,
      headers: authHeaders(token),
    });
    expect(res2.statusCode).toBe(400);
  });

  // T5: 空月份 → 200 全 0 + members 返回 + rank 为空
  it('T5: empty month returns 200 with all zeros', async () => {
    const { token } = await registerUser('t5-user');

    const listRes = await app.inject({
      method: 'GET',
      url: '/v1/families',
      headers: authHeaders(token),
    });
    const personalFamily = listRes.json().find((f: { kind: string }) => f.kind === 'personal');
    const familyId = personalFamily.id;

    const res = await app.inject({
      method: 'GET',
      url: `/v1/families/${familyId}/summary?month=2026-01`,
      headers: authHeaders(token),
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.totals.expense).toBe(0);
    expect(body.totals.income).toBe(0);
    expect(body.totals.balance).toBe(0);
    expect(body.totals.shared_expense).toBe(0);
    expect(body.totals.personal_expense).toBe(0);
    expect(body.totals.entry_count).toBe(0);
    expect(body.totals.skipped_unclassified_expense_count).toBe(0);
    expect(body.members.length).toBeGreaterThanOrEqual(1);
    expect(body.shared.categories).toEqual([]);
    expect(body.personal_by_member).toBeDefined();
  });

  // T6: personal family summary → shared_expense=0 + owner personal expense
  it('T6: personal family summary has shared_expense=0', async () => {
    const { token, userId } = await registerUser('t6-user');

    const listRes = await app.inject({
      method: 'GET',
      url: '/v1/families',
      headers: authHeaders(token),
    });
    const personalFamily = listRes.json().find((f: { kind: string }) => f.kind === 'personal');
    const familyId = personalFamily.id;
    const ledgerId = await getLedgerId(familyId);

    // 插入 personal expense
    await insertEntry({
      ledgerId,
      amount: 5000,
      type: 'expense',
      createdBy: userId,
      occurredAt: '2026-06-15T00:00:00Z',
      sharedType: 'personal',
    });

    const res = await app.inject({
      method: 'GET',
      url: `/v1/families/${familyId}/summary?month=2026-06`,
      headers: authHeaders(token),
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.family_kind).toBe('personal');
    expect(body.totals.shared_expense).toBe(0);
    expect(body.totals.personal_expense).toBe(5000);
    expect(body.totals.expense).toBe(5000);
  });

  // T7: shared expense 聚合
  it('T7: shared expense enters shared_expense and shared categories', async () => {
    const { token: ownerToken, userId: ownerId } = await registerUser('t7-owner');
    const { token: memberToken } = await registerUser('t7-member');

    const familyId = await createSharedFamilyWithMembers(ownerToken, [memberToken]);
    const ledgerId = await getLedgerId(familyId);

    // 插入 shared expense
    await insertEntry({
      ledgerId,
      amount: 10000,
      type: 'expense',
      createdBy: ownerId,
      occurredAt: '2026-06-10T00:00:00Z',
      sharedType: 'shared',
    });

    const res = await app.inject({
      method: 'GET',
      url: `/v1/families/${familyId}/summary?month=2026-06`,
      headers: authHeaders(ownerToken),
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.totals.shared_expense).toBe(10000);
    expect(body.totals.personal_expense).toBe(0);
    expect(body.totals.expense).toBe(10000);
    expect(body.shared.expense).toBe(10000);
  });

  // T8: personal expense 按 created_by 聚合
  it('T8: personal expense aggregated by created_by', async () => {
    const { token: ownerToken, userId: ownerId } = await registerUser('t8-owner');
    const { token: memberToken, userId: memberId } = await registerUser('t8-member');

    const familyId = await createSharedFamilyWithMembers(ownerToken, [memberToken]);
    const ledgerId = await getLedgerId(familyId);

    // owner personal expense
    await insertEntry({
      ledgerId,
      amount: 3000,
      type: 'expense',
      createdBy: ownerId,
      occurredAt: '2026-06-05T00:00:00Z',
      sharedType: 'personal',
    });

    // member personal expense
    await insertEntry({
      ledgerId,
      amount: 2000,
      type: 'expense',
      createdBy: memberId,
      occurredAt: '2026-06-06T00:00:00Z',
      sharedType: 'personal',
    });

    const res = await app.inject({
      method: 'GET',
      url: `/v1/families/${familyId}/summary?month=2026-06`,
      headers: authHeaders(ownerToken),
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.totals.personal_expense).toBe(5000);

    const ownerMember = body.members.find((m: { user_id: string }) => m.user_id === ownerId);
    const memberMember = body.members.find((m: { user_id: string }) => m.user_id === memberId);
    expect(ownerMember.personal_expense).toBe(3000);
    expect(memberMember.personal_expense).toBe(2000);
  });

  // T9: income 只进入 income/balance，不进入 shared/personal/category rank
  it('T9: income only enters income/balance', async () => {
    const { token: ownerToken, userId: ownerId } = await registerUser('t9-owner');

    const listRes = await app.inject({
      method: 'GET',
      url: '/v1/families',
      headers: authHeaders(ownerToken),
    });
    const personalFamily = listRes.json().find((f: { kind: string }) => f.kind === 'personal');
    const familyId = personalFamily.id;
    const ledgerId = await getLedgerId(familyId);

    // 插入 income
    await insertEntry({
      ledgerId,
      amount: 8000,
      type: 'income',
      createdBy: ownerId,
      occurredAt: '2026-06-01T00:00:00Z',
      sharedType: null,
    });

    // 插入 personal expense
    await insertEntry({
      ledgerId,
      amount: 3000,
      type: 'expense',
      createdBy: ownerId,
      occurredAt: '2026-06-02T00:00:00Z',
      sharedType: 'personal',
    });

    const res = await app.inject({
      method: 'GET',
      url: `/v1/families/${familyId}/summary?month=2026-06`,
      headers: authHeaders(ownerToken),
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.totals.income).toBe(8000);
    expect(body.totals.expense).toBe(3000);
    expect(body.totals.balance).toBe(5000);
    expect(body.totals.shared_expense).toBe(0);
    expect(body.totals.personal_expense).toBe(3000);
    // income 不进入 segments
    const incomeInSegments = body.segments.some(
      (s: { amount: number }) => s.amount === 8000,
    );
    expect(incomeInSegments).toBe(false);
  });

  // T10: balance 口径 → balance = income - expense，可为负
  it('T10: balance = income - expense, can be negative', async () => {
    const { token: ownerToken, userId: ownerId } = await registerUser('t10-user');

    const listRes = await app.inject({
      method: 'GET',
      url: '/v1/families',
      headers: authHeaders(ownerToken),
    });
    const personalFamily = listRes.json().find((f: { kind: string }) => f.kind === 'personal');
    const familyId = personalFamily.id;
    const ledgerId = await getLedgerId(familyId);

    // expense > income
    await insertEntry({
      ledgerId,
      amount: 10000,
      type: 'expense',
      createdBy: ownerId,
      occurredAt: '2026-06-03T00:00:00Z',
      sharedType: 'personal',
    });
    await insertEntry({
      ledgerId,
      amount: 3000,
      type: 'income',
      createdBy: ownerId,
      occurredAt: '2026-06-04T00:00:00Z',
      sharedType: null,
    });

    const res = await app.inject({
      method: 'GET',
      url: `/v1/families/${familyId}/summary?month=2026-06`,
      headers: authHeaders(ownerToken),
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.totals.income).toBe(3000);
    expect(body.totals.expense).toBe(10000);
    expect(body.totals.balance).toBe(-7000);
  });

  // T10.5: 混合月场景（P2-3 吸收）
  it('T10.5: mixed month with shared+personal+income+transfer', async () => {
    const { token: ownerToken, userId: ownerId } = await registerUser('t10-5-owner');
    const { token: memberToken, userId: memberId } = await registerUser('t10-5-member');

    const familyId = await createSharedFamilyWithMembers(ownerToken, [memberToken]);
    const ledgerId = await getLedgerId(familyId);

    // shared expense by owner
    await insertEntry({
      ledgerId, amount: 6000, type: 'expense', createdBy: ownerId,
      occurredAt: '2026-06-01T00:00:00Z', sharedType: 'shared',
    });
    // personal expense by owner
    await insertEntry({
      ledgerId, amount: 2000, type: 'expense', createdBy: ownerId,
      occurredAt: '2026-06-02T00:00:00Z', sharedType: 'personal',
    });
    // personal expense by member
    await insertEntry({
      ledgerId, amount: 1000, type: 'expense', createdBy: memberId,
      occurredAt: '2026-06-03T00:00:00Z', sharedType: 'personal',
    });
    // income by owner
    await insertEntry({
      ledgerId, amount: 15000, type: 'income', createdBy: ownerId,
      occurredAt: '2026-06-04T00:00:00Z', sharedType: null,
    });
    // transfer (should not enter any aggregation)
    await insertEntry({
      ledgerId, amount: 500, type: 'transfer', createdBy: ownerId,
      occurredAt: '2026-06-05T00:00:00Z', sharedType: null,
    });

    const res = await app.inject({
      method: 'GET',
      url: `/v1/families/${familyId}/summary?month=2026-06`,
      headers: authHeaders(ownerToken),
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    // expense = shared + personal
    expect(body.totals.expense).toBe(9000);
    expect(body.totals.shared_expense).toBe(6000);
    expect(body.totals.personal_expense).toBe(3000);
    // balance = income - expense
    expect(body.totals.income).toBe(15000);
    expect(body.totals.balance).toBe(6000);
    // entry_count = income + expense (not transfer)
    expect(body.totals.entry_count).toBe(4);
    // transfer 不进入任何聚合
    expect(body.totals.skipped_unclassified_expense_count).toBe(0);
  });
});

// ─── 收入维度测试（与支出侧对称） ───────────────────────────────────────────

describe('Income dimension: Family Summary income_segments + income_by_member', () => {

  // T-INC-1: 空月份 → income_by_member 为空数组（无收入成员不进 income_by_member）
  // income_segments 仍含所有成员段（amount=0，与支出 segments 一致）
  it('T-INC-1: empty month returns empty income_by_member and zero-amount income_segments', async () => {
    const { token: ownerToken } = await registerUser('inc-t1-owner');
    const { token: memberToken } = await registerUser('inc-t1-member');
    const familyId = await createSharedFamilyWithMembers(ownerToken, [memberToken]);

    const res = await app.inject({
      method: 'GET',
      url: `/v1/families/${familyId}/summary?month=2026-01`,
      headers: authHeaders(ownerToken),
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    // income_by_member 只含 amount > 0 的成员 → 空月为 []
    expect(body.income_by_member).toEqual([]);
    // income_segments 含所有成员段（amount=0，与支出 segments 含所有成员一致）
    expect(body.income_segments.length).toBeGreaterThanOrEqual(2);
    expect(body.income_segments.every((s: { amount: number }) => s.amount === 0)).toBe(true);
  });

  // T-INC-2: 单成员收入 → income_segments 含 1 段 + income_by_member 含 1 块
  it('T-INC-2: single member income appears in income_segments and income_by_member', async () => {
    const { token: ownerToken, userId: ownerId } = await registerUser('inc-t2-owner');
    const familyId = await createSharedFamilyWithMembers(ownerToken, []);
    const ledgerId = await getLedgerId(familyId);

    await insertEntry({
      ledgerId, amount: 8000, type: 'income', createdBy: ownerId,
      occurredAt: '2026-06-01T00:00:00Z', sharedType: null,
    });

    const res = await app.inject({
      method: 'GET',
      url: `/v1/families/${familyId}/summary?month=2026-06`,
      headers: authHeaders(ownerToken),
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.totals.income).toBe(8000);
    // income_segments: 1 段（owner）
    expect(body.income_segments).toHaveLength(1);
    expect(body.income_segments[0].user_id).toBe(ownerId);
    expect(body.income_segments[0].amount).toBe(8000);
    expect(body.income_segments[0].ratio_bps).toBe(10000); // 100%
    // income_by_member: 1 块
    expect(body.income_by_member).toHaveLength(1);
    expect(body.income_by_member[0].user_id).toBe(ownerId);
    expect(body.income_by_member[0].amount).toBe(8000);
  });

  // T-INC-3: 多成员收入 → 按成员聚合 + ratio_bps 正确
  it('T-INC-3: multi-member income aggregated by created_by with correct ratio', async () => {
    const { token: ownerToken, userId: ownerId } = await registerUser('inc-t3-owner');
    const { token: memberToken, userId: memberId } = await registerUser('inc-t3-member');
    const familyId = await createSharedFamilyWithMembers(ownerToken, [memberToken]);
    const ledgerId = await getLedgerId(familyId);

    // owner 收入 6000
    await insertEntry({
      ledgerId, amount: 6000, type: 'income', createdBy: ownerId,
      occurredAt: '2026-06-01T00:00:00Z', sharedType: null,
    });
    // member 收入 4000
    await insertEntry({
      ledgerId, amount: 4000, type: 'income', createdBy: memberId,
      occurredAt: '2026-06-02T00:00:00Z', sharedType: null,
    });

    const res = await app.inject({
      method: 'GET',
      url: `/v1/families/${familyId}/summary?month=2026-06`,
      headers: authHeaders(ownerToken),
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.totals.income).toBe(10000);
    // income_segments: 2 段
    expect(body.income_segments).toHaveLength(2);
    const ownerSeg = body.income_segments.find((s: { user_id: string }) => s.user_id === ownerId);
    const memberSeg = body.income_segments.find((s: { user_id: string }) => s.user_id === memberId);
    expect(ownerSeg.amount).toBe(6000);
    expect(ownerSeg.ratio_bps).toBe(6000); // 60%
    expect(memberSeg.amount).toBe(4000);
    expect(memberSeg.ratio_bps).toBe(4000); // 40%
    // income_by_member: 2 块
    expect(body.income_by_member).toHaveLength(2);
  });

  // T-INC-4: 无收入的成员不出现在 income_by_member
  it('T-INC-4: member with no income excluded from income_by_member', async () => {
    const { token: ownerToken, userId: ownerId } = await registerUser('inc-t4-owner');
    const { token: memberToken, userId: memberId } = await registerUser('inc-t4-member');
    const familyId = await createSharedFamilyWithMembers(ownerToken, [memberToken]);
    const ledgerId = await getLedgerId(familyId);

    // 只有 owner 有收入
    await insertEntry({
      ledgerId, amount: 5000, type: 'income', createdBy: ownerId,
      occurredAt: '2026-06-01T00:00:00Z', sharedType: null,
    });

    const res = await app.inject({
      method: 'GET',
      url: `/v1/families/${familyId}/summary?month=2026-06`,
      headers: authHeaders(ownerToken),
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    // income_by_member 只有 owner
    expect(body.income_by_member).toHaveLength(1);
    expect(body.income_by_member[0].user_id).toBe(ownerId);
    // member 不在 income_by_member 中
    const memberInList = body.income_by_member.some((m: { user_id: string }) => m.user_id === memberId);
    expect(memberInList).toBe(false);
  });

  // T-INC-5: 收入分类 L1 折叠
  it('T-INC-5: income categories folded to L1', async () => {
    const { token: ownerToken, userId: ownerId } = await registerUser('inc-t5-owner');
    const familyId = await createSharedFamilyWithMembers(ownerToken, []);
    const ledgerId = await getLedgerId(familyId);

    // 创建 L1 "工资" + L2 "基本工资" + L2 "奖金"
    const l1Id = await insertCategory({ name: '工资', type: 'income', icon: 'salary' });
    const leafA = await insertCategory({ name: '基本工资', type: 'income', icon: 'base-salary', parentId: l1Id });
    const leafB = await insertCategory({ name: '奖金', type: 'income', icon: 'bonus', parentId: l1Id });

    await insertEntry({
      ledgerId, amount: 7000, type: 'income', createdBy: ownerId,
      occurredAt: '2026-06-01T00:00:00Z', sharedType: null, categoryId: leafA,
    });
    await insertEntry({
      ledgerId, amount: 3000, type: 'income', createdBy: ownerId,
      occurredAt: '2026-06-02T00:00:00Z', sharedType: null, categoryId: leafB,
    });

    const res = await app.inject({
      method: 'GET',
      url: `/v1/families/${familyId}/summary?month=2026-06`,
      headers: authHeaders(ownerToken),
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.income_by_member).toHaveLength(1);
    const block = body.income_by_member[0];
    expect(block.amount).toBe(10000);
    // L1 折叠后只有 1 个一级分类
    expect(block.categories).toHaveLength(1);
    expect(block.categories[0].category_id).toBe(l1Id);
    expect(block.categories[0].category_name).toBe('工资');
    expect(block.categories[0].amount).toBe(10000);
    expect(block.categories[0].entry_count).toBe(2);
  });

  // T-INC-6: 年度视图收入维度
  it('T-INC-6: yearly income dimension works', async () => {
    const { token: ownerToken, userId: ownerId } = await registerUser('inc-t6-owner');
    const familyId = await createSharedFamilyWithMembers(ownerToken, []);
    const ledgerId = await getLedgerId(familyId);

    await insertEntry({
      ledgerId, amount: 5000, type: 'income', createdBy: ownerId,
      occurredAt: '2026-03-15T00:00:00Z', sharedType: null,
    });

    const res = await app.inject({
      method: 'GET',
      url: `/v1/families/${familyId}/summary?year=2026`,
      headers: authHeaders(ownerToken),
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.totals.income).toBe(5000);
    expect(body.income_segments).toHaveLength(1);
    expect(body.income_by_member).toHaveLength(1);
  });
});
