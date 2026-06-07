/**
 * Costra · Server · 家庭财务聚合 L1 折叠 + 年度支持测试
 *
 * 卡号：COSTRA-300 · 覆盖 T-300-A1 ~ A10
 * 设计源：docs/design/family-page-tech-spec.md §3.6
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { buildApp } from '../src/app.js';
import { getPool } from '../src/db/pool.js';
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

describe('COSTRA-300: Family Summary L1 Fold + Year Support', () => {

  // T-300-A1: 月度 L1 折叠
  it('T-300-A1: monthly L1 fold — two leaves under same L1 fold into one', async () => {
    const { token: ownerToken, userId: ownerId } = await registerUser('t300-a1-owner');
    const { token: memberToken } = await registerUser('t300-a1-member');

    const familyId = await createSharedFamilyWithMembers(ownerToken, [memberToken]);
    const ledgerId = await getLedgerId(familyId);

    // 创建 L1 "餐饮" + L2 "外卖" + L2 "堂食"
    const l1Id = await insertCategory({ name: '餐饮', type: 'expense', icon: 'food', familyId: null });
    const leafA = await insertCategory({ name: '外卖', type: 'expense', icon: 'takeout', familyId: null, parentId: l1Id });
    const leafB = await insertCategory({ name: '堂食', type: 'expense', icon: 'dine', familyId: null, parentId: l1Id });

    // shared expense: 外卖 3000 + 堂食 2000
    await insertEntry({
      ledgerId, amount: 3000, type: 'expense', createdBy: ownerId,
      occurredAt: '2026-06-10T00:00:00Z', sharedType: 'shared', categoryId: leafA,
    });
    await insertEntry({
      ledgerId, amount: 2000, type: 'expense', createdBy: ownerId,
      occurredAt: '2026-06-11T00:00:00Z', sharedType: 'shared', categoryId: leafB,
    });

    // personal expense: 外卖 1000 + 堂食 500
    await insertEntry({
      ledgerId, amount: 1000, type: 'expense', createdBy: ownerId,
      occurredAt: '2026-06-12T00:00:00Z', sharedType: 'personal', categoryId: leafA,
    });
    await insertEntry({
      ledgerId, amount: 500, type: 'expense', createdBy: ownerId,
      occurredAt: '2026-06-13T00:00:00Z', sharedType: 'personal', categoryId: leafB,
    });

    const res = await app.inject({
      method: 'GET',
      url: `/v1/families/${familyId}/summary?month=2026-06`,
      headers: authHeaders(ownerToken),
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();

    // shared.categories: 只有 L1 "餐饮"，amount = 3000 + 2000 = 5000
    expect(body.shared.categories.length).toBe(1);
    expect(body.shared.categories[0].category_id).toBe(l1Id);
    expect(body.shared.categories[0].category_name).toBe('餐饮');
    expect(body.shared.categories[0].parent_category_id).toBeNull();
    expect(body.shared.categories[0].parent_category_name).toBeNull();
    expect(body.shared.categories[0].amount).toBe(5000);
    expect(body.shared.categories[0].entry_count).toBe(2);

    // personal_by_member[owner].categories: 只有 L1 "餐饮"，amount = 1000 + 500 = 1500
    const ownerBlock = body.personal_by_member.find(
      (b: { user_id: string }) => b.user_id === ownerId,
    );
    expect(ownerBlock.categories.length).toBe(1);
    expect(ownerBlock.categories[0].category_id).toBe(l1Id);
    expect(ownerBlock.categories[0].category_name).toBe('餐饮');
    expect(ownerBlock.categories[0].parent_category_id).toBeNull();
    expect(ownerBlock.categories[0].parent_category_name).toBeNull();
    expect(ownerBlock.categories[0].amount).toBe(1500);
  });

  // T-300-A2: 年度调用 year=2026
  it('T-300-A2: year=2026 aggregates across multiple months + L1 fold', async () => {
    const { token: ownerToken, userId: ownerId } = await registerUser('t300-a2-owner');

    const listRes = await app.inject({
      method: 'GET',
      url: '/v1/families',
      headers: authHeaders(ownerToken),
    });
    const personalFamily = listRes.json().find((f: { kind: string }) => f.kind === 'personal');
    const familyId = personalFamily.id;
    const ledgerId = await getLedgerId(familyId);

    const l1Id = await insertCategory({ name: '交通', type: 'expense', icon: 'car', familyId: null });
    const leafId = await insertCategory({ name: '打车', type: 'expense', icon: 'taxi', familyId: null, parentId: l1Id });

    // Jan
    await insertEntry({
      ledgerId, amount: 1000, type: 'expense', createdBy: ownerId,
      occurredAt: '2026-01-15T00:00:00Z', sharedType: 'personal', categoryId: leafId,
    });
    // Jun
    await insertEntry({
      ledgerId, amount: 2000, type: 'expense', createdBy: ownerId,
      occurredAt: '2026-06-15T00:00:00Z', sharedType: 'personal', categoryId: leafId,
    });
    // Dec (last day Shanghai → UTC: 2026-12-31 16:00 UTC = 2027-01-01 00:00 Shanghai → belongs to 2027!)
    // Use 2026-12-30 to ensure it's in 2026
    await insertEntry({
      ledgerId, amount: 3000, type: 'expense', createdBy: ownerId,
      occurredAt: '2026-12-30T00:00:00Z', sharedType: 'personal', categoryId: leafId,
    });

    const res = await app.inject({
      method: 'GET',
      url: `/v1/families/${familyId}/summary?year=2026`,
      headers: authHeaders(ownerToken),
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.month).toBeNull();
    expect(body.year).toBe('2026');
    expect(body.totals.expense).toBe(6000);
    expect(body.totals.personal_expense).toBe(6000);

    // L1 fold: 打车 → 交通
    const ownerBlock = body.personal_by_member.find(
      (b: { user_id: string }) => b.user_id === ownerId,
    );
    expect(ownerBlock.categories.length).toBe(1);
    expect(ownerBlock.categories[0].category_id).toBe(l1Id);
    expect(ownerBlock.categories[0].category_name).toBe('交通');
    expect(ownerBlock.categories[0].amount).toBe(6000);
    expect(ownerBlock.categories[0].entry_count).toBe(3);
  });

  // T-300-A3: month + year 同传 → INVALID_ARGUMENT
  it('T-300-A3: month + year both provided → 400 INVALID_ARGUMENT', async () => {
    const { token } = await registerUser('t300-a3-user');
    const listRes = await app.inject({
      method: 'GET',
      url: '/v1/families',
      headers: authHeaders(token),
    });
    const familyId = listRes.json()[0].id;

    const res = await app.inject({
      method: 'GET',
      url: `/v1/families/${familyId}/summary?month=2026-06&year=2026`,
      headers: authHeaders(token),
    });
    expect(res.statusCode).toBe(400);
    const body = res.json();
    expect(body.code).toBe('INVALID_ARGUMENT');
    expect(body.details.reason).toBe('month_year_xor');
  });

  // T-300-A4: 都不传 → INVALID_ARGUMENT
  it('T-300-A4: neither month nor year → 400 INVALID_ARGUMENT', async () => {
    const { token } = await registerUser('t300-a4-user');
    const listRes = await app.inject({
      method: 'GET',
      url: '/v1/families',
      headers: authHeaders(token),
    });
    const familyId = listRes.json()[0].id;

    const res = await app.inject({
      method: 'GET',
      url: `/v1/families/${familyId}/summary`,
      headers: authHeaders(token),
    });
    expect(res.statusCode).toBe(400);
    const body = res.json();
    expect(body.code).toBe('INVALID_ARGUMENT');
    expect(body.details.reason).toBe('month_year_xor');
  });

  // T-300-A5: leaf 截断不丢 L1
  it('T-300-A5: L1 aggregation prevents leaf truncation from losing parent L1', async () => {
    const { token: ownerToken, userId: ownerId } = await registerUser('t300-a5-owner');

    const listRes = await app.inject({
      method: 'GET',
      url: '/v1/families',
      headers: authHeaders(ownerToken),
    });
    const personalFamily = listRes.json().find((f: { kind: string }) => f.kind === 'personal');
    const familyId = personalFamily.id;
    const ledgerId = await getLedgerId(familyId);

    // L1 "餐饮" with 12 leaves
    const l1DiningId = await insertCategory({ name: '餐饮', type: 'expense', icon: 'food', familyId: null });
    const diningLeaves: string[] = [];
    for (let i = 0; i < 12; i++) {
      const id = await insertCategory({ name: `餐饮子${i}`, type: 'expense', icon: 'food', familyId: null, parentId: l1DiningId });
      diningLeaves.push(id);
    }

    // 5 other L1 categories (no parent — they ARE L1)
    const otherL1Ids: string[] = [];
    for (let i = 0; i < 5; i++) {
      const id = await insertCategory({ name: `其他类${i}`, type: 'expense', icon: 'other', familyId: null });
      otherL1Ids.push(id);
    }

    // Each dining leaf: amount=100 (small individually) → total 12*100=1200 for 餐饮 L1
    for (const leafId of diningLeaves) {
      await insertEntry({
        ledgerId, amount: 100, type: 'expense', createdBy: ownerId,
        occurredAt: '2026-06-01T00:00:00Z', sharedType: 'personal', categoryId: leafId,
      });
    }

    // Each other L1: amount=200 (each individually bigger than dining leaf, but total < dining L1)
    for (const l1Id of otherL1Ids) {
      await insertEntry({
        ledgerId, amount: 200, type: 'expense', createdBy: ownerId,
        occurredAt: '2026-06-02T00:00:00Z', sharedType: 'personal', categoryId: l1Id,
      });
    }

    // top_n=6: 餐饮 L1 total=1200 should rank first; 5 others at 200 each
    const res = await app.inject({
      method: 'GET',
      url: `/v1/families/${familyId}/summary?month=2026-06&top_n=6`,
      headers: authHeaders(ownerToken),
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    const ownerBlock = body.personal_by_member.find(
      (b: { user_id: string }) => b.user_id === ownerId,
    );
    expect(ownerBlock.categories.length).toBe(6);
    // 餐饮 should be first (amount=1200 > 200)
    expect(ownerBlock.categories[0].category_id).toBe(l1DiningId);
    expect(ownerBlock.categories[0].category_name).toBe('餐饮');
    expect(ownerBlock.categories[0].amount).toBe(1200);
    expect(ownerBlock.categories[0].entry_count).toBe(12);
  });

  // T-300-A6: 未分类 expense 不进 categories
  it('T-300-A6: unclassified expense (category_id IS NULL) skipped in categories', async () => {
    const { token: ownerToken, userId: ownerId } = await registerUser('t300-a6-owner');

    const listRes = await app.inject({
      method: 'GET',
      url: '/v1/families',
      headers: authHeaders(ownerToken),
    });
    const personalFamily = listRes.json().find((f: { kind: string }) => f.kind === 'personal');
    const familyId = personalFamily.id;
    const ledgerId = await getLedgerId(familyId);

    // Classified expense
    const catId = await insertCategory({ name: '购物', type: 'expense', icon: 'shop', familyId: null });
    await insertEntry({
      ledgerId, amount: 3000, type: 'expense', createdBy: ownerId,
      occurredAt: '2026-06-01T00:00:00Z', sharedType: 'personal', categoryId: catId,
    });

    // Unclassified expense (category_id = null) — direct DB insert to bypass API validation
    const nullId = crypto.randomUUID();
    await getPool().query(
      `INSERT INTO entries (id, ledger_id, amount, currency, type, category_id, occurred_at, created_by, shared_type)
       VALUES ($1, $2, $3, 'CNY', 'expense', NULL, $4, $5, 'personal')`,
      [nullId, ledgerId, 5000, '2026-06-02T00:00:00Z', ownerId],
    );

    const res = await app.inject({
      method: 'GET',
      url: `/v1/families/${familyId}/summary?month=2026-06`,
      headers: authHeaders(ownerToken),
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();

    // totals includes both
    expect(body.totals.personal_expense).toBe(8000);

    // categories should only contain "购物", not "未分类"
    const ownerBlock = body.personal_by_member.find(
      (b: { user_id: string }) => b.user_id === ownerId,
    );
    expect(ownerBlock.categories.length).toBe(1);
    expect(ownerBlock.categories[0].category_name).toBe('购物');
    expect(ownerBlock.categories[0].amount).toBe(3000);
    // No unclassified entry in categories
    const hasUnclassified = ownerBlock.categories.some(
      (c: { category_id: string | null }) => c.category_id === null,
    );
    expect(hasUnclassified).toBe(false);
  });

  // T-300-A7: 占比基数
  it('T-300-A7: ratio_bps uses correct denominator — shared.expense for shared, personal_expense for member', async () => {
    const { token: ownerToken, userId: ownerId } = await registerUser('t300-a7-owner');
    const { token: memberToken } = await registerUser('t300-a7-member');

    const familyId = await createSharedFamilyWithMembers(ownerToken, [memberToken]);
    const ledgerId = await getLedgerId(familyId);

    const catA = await insertCategory({ name: '餐饮', type: 'expense', icon: 'food', familyId: null });
    const catB = await insertCategory({ name: '交通', type: 'expense', icon: 'car', familyId: null });

    // shared: 餐饮 7500, 交通 2500 → total shared 10000
    await insertEntry({
      ledgerId, amount: 7500, type: 'expense', createdBy: ownerId,
      occurredAt: '2026-06-01T00:00:00Z', sharedType: 'shared', categoryId: catA,
    });
    await insertEntry({
      ledgerId, amount: 2500, type: 'expense', createdBy: ownerId,
      occurredAt: '2026-06-02T00:00:00Z', sharedType: 'shared', categoryId: catB,
    });

    // personal owner: 餐饮 3000, 交通 1000 → total personal 4000
    await insertEntry({
      ledgerId, amount: 3000, type: 'expense', createdBy: ownerId,
      occurredAt: '2026-06-03T00:00:00Z', sharedType: 'personal', categoryId: catA,
    });
    await insertEntry({
      ledgerId, amount: 1000, type: 'expense', createdBy: ownerId,
      occurredAt: '2026-06-04T00:00:00Z', sharedType: 'personal', categoryId: catB,
    });

    const res = await app.inject({
      method: 'GET',
      url: `/v1/families/${familyId}/summary?month=2026-06`,
      headers: authHeaders(ownerToken),
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();

    // shared categories: ratio_bps uses shared.expense (10000) as denominator
    expect(body.shared.expense).toBe(10000);
    const sharedCatA = body.shared.categories.find((c: { category_name: string }) => c.category_name === '餐饮');
    const sharedCatB = body.shared.categories.find((c: { category_name: string }) => c.category_name === '交通');
    expect(sharedCatA.ratio_bps).toBe(Math.round((7500 / 10000) * 10000)); // 7500
    expect(sharedCatB.ratio_bps).toBe(Math.round((2500 / 10000) * 10000)); // 2500

    // personal owner categories: ratio_bps uses owner personal_expense (4000) as denominator
    const ownerBlock = body.personal_by_member.find(
      (b: { user_id: string }) => b.user_id === ownerId,
    );
    expect(ownerBlock.amount).toBe(4000);
    const personalCatA = ownerBlock.categories.find((c: { category_name: string }) => c.category_name === '餐饮');
    const personalCatB = ownerBlock.categories.find((c: { category_name: string }) => c.category_name === '交通');
    expect(personalCatA.ratio_bps).toBe(Math.round((3000 / 4000) * 10000)); // 7500
    expect(personalCatB.ratio_bps).toBe(Math.round((1000 / 4000) * 10000)); // 2500
  });

  // T-300-A8: 跨年边界
  it('T-300-A8: year=2026 excludes entries at 2025-12-31 23:59+08:00 and 2027-01-01 00:00+08:00', async () => {
    const { token: ownerToken, userId: ownerId } = await registerUser('t300-a8-owner');

    const listRes = await app.inject({
      method: 'GET',
      url: '/v1/families',
      headers: authHeaders(ownerToken),
    });
    const personalFamily = listRes.json().find((f: { kind: string }) => f.kind === 'personal');
    const familyId = personalFamily.id;
    const ledgerId = await getLedgerId(familyId);

    // 2025-12-31 23:59:59 +08:00 = 2025-12-31 15:59:59 UTC → belongs to 2025
    await insertEntry({
      ledgerId, amount: 1000, type: 'expense', createdBy: ownerId,
      occurredAt: '2025-12-31T15:59:59Z', sharedType: 'personal',
    });

    // 2026-01-01 00:00:00 +08:00 = 2025-12-31 16:00:00 UTC → belongs to 2026
    await insertEntry({
      ledgerId, amount: 2000, type: 'expense', createdBy: ownerId,
      occurredAt: '2025-12-31T16:00:00Z', sharedType: 'personal',
    });

    // 2026-12-31 23:59:59 +08:00 = 2026-12-31 15:59:59 UTC → belongs to 2026
    await insertEntry({
      ledgerId, amount: 3000, type: 'expense', createdBy: ownerId,
      occurredAt: '2026-12-31T15:59:59Z', sharedType: 'personal',
    });

    // 2027-01-01 00:00:00 +08:00 = 2026-12-31 16:00:00 UTC → belongs to 2027
    await insertEntry({
      ledgerId, amount: 4000, type: 'expense', createdBy: ownerId,
      occurredAt: '2026-12-31T16:00:00Z', sharedType: 'personal',
    });

    const res = await app.inject({
      method: 'GET',
      url: `/v1/families/${familyId}/summary?year=2026`,
      headers: authHeaders(ownerToken),
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    // Only 2000 + 3000 = 5000 should be in 2026
    expect(body.totals.expense).toBe(5000);
    expect(body.totals.personal_expense).toBe(5000);
  });

  // T-300-A9: left member 历史 personal expense 仍在年度聚合中
  it('T-300-A9: left member historical personal expense still in yearly aggregation', async () => {
    const { token: ownerToken } = await registerUser('t300-a9-owner');
    const { token: memberToken, userId: memberId } = await registerUser('t300-a9-member');

    const familyId = await createSharedFamilyWithMembers(ownerToken, [memberToken]);
    const ledgerId = await getLedgerId(familyId);

    // Member personal expense in Jan 2026
    await insertEntry({
      ledgerId, amount: 5000, type: 'expense', createdBy: memberId,
      occurredAt: '2026-01-15T00:00:00Z', sharedType: 'personal',
    });

    // Owner removes member (member becomes left)
    await app.inject({
      method: 'DELETE',
      url: `/v1/families/${familyId}/members/${memberId}`,
      headers: authHeaders(ownerToken),
    });

    const res = await app.inject({
      method: 'GET',
      url: `/v1/families/${familyId}/summary?year=2026`,
      headers: authHeaders(ownerToken),
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();

    // Left member still in personal_by_member
    const leftBlock = body.personal_by_member.find(
      (b: { user_id: string }) => b.user_id === memberId,
    );
    expect(leftBlock).toBeDefined();
    expect(leftBlock.status).toBe('left');
    expect(leftBlock.amount).toBe(5000);

    // Totals include left member's personal expense
    expect(body.totals.personal_expense).toBe(5000);

    // Year field
    expect(body.year).toBe('2026');
    expect(body.month).toBeNull();
  });

  // T-300-A10: 单成员 personal_expense=0
  it('T-300-A10: member with personal_expense=0 has empty categories array, no error', async () => {
    const { token: ownerToken, userId: ownerId } = await registerUser('t300-a10-owner');
    const { token: memberToken, userId: memberId } = await registerUser('t300-a10-member');

    const familyId = await createSharedFamilyWithMembers(ownerToken, [memberToken]);
    const ledgerId = await getLedgerId(familyId);

    // Only owner has personal expense; member has none
    await insertEntry({
      ledgerId, amount: 3000, type: 'expense', createdBy: ownerId,
      occurredAt: '2026-06-01T00:00:00Z', sharedType: 'personal',
    });

    const res = await app.inject({
      method: 'GET',
      url: `/v1/families/${familyId}/summary?month=2026-06`,
      headers: authHeaders(ownerToken),
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();

    const memberBlock = body.personal_by_member.find(
      (b: { user_id: string }) => b.user_id === memberId,
    );
    expect(memberBlock).toBeDefined();
    expect(memberBlock.amount).toBe(0);
    expect(memberBlock.categories).toEqual([]);
  });
});
