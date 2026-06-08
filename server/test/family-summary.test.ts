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
