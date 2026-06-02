/**
 * Costra · Server · 家庭财务聚合高级场景测试
 *
 * 卡号：COSTRA-222 · 覆盖 T11~T16
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

describe('COSTRA-222: Family Summary API · advanced', () => {
  // T11: paid contribution → shared expense 按 created_by 贡献聚合
  it('T11: paid contribution aggregated by created_by for shared expense', async () => {
    const { token: ownerToken, userId: ownerId } = await registerUser('t11-owner');
    const { token: memberToken, userId: memberId } = await registerUser('t11-member');

    const familyId = await createSharedFamilyWithMembers(ownerToken, [memberToken]);
    const ledgerId = await getLedgerId(familyId);

    // owner paid shared expense
    await insertEntry({
      ledgerId, amount: 8000, type: 'expense', createdBy: ownerId,
      occurredAt: '2026-06-01T00:00:00Z', sharedType: 'shared',
    });
    // member paid shared expense
    await insertEntry({
      ledgerId, amount: 4000, type: 'expense', createdBy: memberId,
      occurredAt: '2026-06-02T00:00:00Z', sharedType: 'shared',
    });

    const res = await app.inject({
      method: 'GET',
      url: `/v1/families/${familyId}/summary?month=2026-06`,
      headers: authHeaders(ownerToken),
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.shared.expense).toBe(12000);

    const ownerContrib = body.shared.paid_contributions.find(
      (c: { user_id: string }) => c.user_id === ownerId,
    );
    const memberContrib = body.shared.paid_contributions.find(
      (c: { user_id: string }) => c.user_id === memberId,
    );

    expect(ownerContrib.amount).toBe(8000);
    expect(memberContrib.amount).toBe(4000);
    // ratio_bps
    expect(ownerContrib.ratio_bps).toBe(Math.round((8000 / 12000) * 10000));
    expect(memberContrib.ratio_bps).toBe(Math.round((4000 / 12000) * 10000));
  });

  // T12: left member 历史贡献
  it('T12: left member still shows with status=left and preserved amounts', async () => {
    const { token: ownerToken } = await registerUser('t12-owner');
    const { token: memberToken, userId: memberId } = await registerUser('t12-member');

    const familyId = await createSharedFamilyWithMembers(ownerToken, [memberToken]);
    const ledgerId = await getLedgerId(familyId);

    // member paid shared expense
    await insertEntry({
      ledgerId, amount: 5000, type: 'expense', createdBy: memberId,
      occurredAt: '2026-06-01T00:00:00Z', sharedType: 'shared',
    });

    // owner removes member
    await app.inject({
      method: 'DELETE',
      url: `/v1/families/${familyId}/members/${memberId}`,
      headers: authHeaders(ownerToken),
    });

    const res = await app.inject({
      method: 'GET',
      url: `/v1/families/${familyId}/summary?month=2026-06`,
      headers: authHeaders(ownerToken),
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();

    // left member 仍在 members 中
    const leftMember = body.members.find((m: { user_id: string }) => m.user_id === memberId);
    expect(leftMember).toBeDefined();
    expect(leftMember.status).toBe('left');
    expect(leftMember.paid_contribution).toBe(5000);

    // paid_contributions 中 left member 仍在
    const leftContrib = body.shared.paid_contributions.find(
      (c: { user_id: string }) => c.user_id === memberId,
    );
    expect(leftContrib).toBeDefined();
    expect(leftContrib.status).toBe('left');
    expect(leftContrib.amount).toBe(5000);

    // segments 中 left member 仍在
    const leftSegment = body.segments.find(
      (s: { user_id: string | null }) => s.user_id === memberId,
    );
    expect(leftSegment).toBeDefined();
    expect(leftSegment.member_status).toBe('left');
  });

  // T13: category rank top_n
  it('T13: category rank respects top_n, excludes zero, sorts by amount DESC', async () => {
    const { token: ownerToken, userId: ownerId } = await registerUser('t13-owner');

    const listRes = await app.inject({
      method: 'GET',
      url: '/v1/families',
      headers: authHeaders(ownerToken),
    });
    const personalFamily = listRes.json().find((f: { kind: string }) => f.kind === 'personal');
    const familyId = personalFamily.id;
    const ledgerId = await getLedgerId(familyId);

    // 创建分类
    const cat1Id = await insertCategory({ name: '餐饮', type: 'expense', icon: 'food', familyId: null });
    const cat2Id = await insertCategory({ name: '交通', type: 'expense', icon: 'car', familyId: null });
    const cat3Id = await insertCategory({ name: '购物', type: 'expense', icon: 'shop', familyId: null });

    // 插入不同金额的 expense
    await insertEntry({
      ledgerId, amount: 5000, type: 'expense', createdBy: ownerId,
      occurredAt: '2026-06-01T00:00:00Z', sharedType: 'personal', categoryId: cat1Id,
    });
    await insertEntry({
      ledgerId, amount: 3000, type: 'expense', createdBy: ownerId,
      occurredAt: '2026-06-02T00:00:00Z', sharedType: 'personal', categoryId: cat2Id,
    });
    await insertEntry({
      ledgerId, amount: 1000, type: 'expense', createdBy: ownerId,
      occurredAt: '2026-06-03T00:00:00Z', sharedType: 'personal', categoryId: cat3Id,
    });

    // top_n=2
    const res = await app.inject({
      method: 'GET',
      url: `/v1/families/${familyId}/summary?month=2026-06&top_n=2`,
      headers: authHeaders(ownerToken),
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();

    // personal_by_member 中 owner 的 categories 应只有 top 2
    const ownerBlock = body.personal_by_member.find(
      (b: { user_id: string }) => b.user_id === ownerId,
    );
    expect(ownerBlock.categories.length).toBe(2);
    // 排序：amount DESC
    expect(ownerBlock.categories[0].category_name).toBe('餐饮');
    expect(ownerBlock.categories[0].amount).toBe(5000);
    expect(ownerBlock.categories[1].category_name).toBe('交通');
    expect(ownerBlock.categories[1].amount).toBe(3000);
  });

  // T14: 二级分类 parent 信息
  it('T14: category item contains parent_category_id and parent_category_name', async () => {
    const { token: ownerToken, userId: ownerId } = await registerUser('t14-user');

    const listRes = await app.inject({
      method: 'GET',
      url: '/v1/families',
      headers: authHeaders(ownerToken),
    });
    const personalFamily = listRes.json().find((f: { kind: string }) => f.kind === 'personal');
    const familyId = personalFamily.id;
    const ledgerId = await getLedgerId(familyId);

    // 创建一级分类
    const parentId = await insertCategory({ name: '餐饮', type: 'expense', icon: 'food', familyId: null });
    // 创建二级分类
    const childId = await insertCategory({ name: '外卖', type: 'expense', icon: 'takeout', familyId: null, parentId });

    await insertEntry({
      ledgerId, amount: 2000, type: 'expense', createdBy: ownerId,
      occurredAt: '2026-06-01T00:00:00Z', sharedType: 'personal', categoryId: childId,
    });

    const res = await app.inject({
      method: 'GET',
      url: `/v1/families/${familyId}/summary?month=2026-06`,
      headers: authHeaders(ownerToken),
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    const ownerBlock = body.personal_by_member.find(
      (b: { user_id: string }) => b.user_id === ownerId,
    );
    expect(ownerBlock.categories.length).toBe(1);
    const cat = ownerBlock.categories[0];
    expect(cat.category_name).toBe('外卖');
    expect(cat.parent_category_id).toBe(parentId);
    expect(cat.parent_category_name).toBe('餐饮');
  });

  // T15: 月边界 Asia/Shanghai
  it('T15: month boundary respects Asia/Shanghai timezone', async () => {
    const { token: ownerToken, userId: ownerId } = await registerUser('t15-user');

    const listRes = await app.inject({
      method: 'GET',
      url: '/v1/families',
      headers: authHeaders(ownerToken),
    });
    const personalFamily = listRes.json().find((f: { kind: string }) => f.kind === 'personal');
    const familyId = personalFamily.id;
    const ledgerId = await getLedgerId(familyId);

    // 6月30日 23:00 UTC = 7月1日 07:00 Shanghai → 应属于 7 月
    await insertEntry({
      ledgerId, amount: 1000, type: 'expense', createdBy: ownerId,
      occurredAt: '2026-06-30T23:00:00Z', sharedType: 'personal',
    });

    // 6月30日 15:00 UTC = 6月30日 23:00 Shanghai → 应属于 6 月
    await insertEntry({
      ledgerId, amount: 2000, type: 'expense', createdBy: ownerId,
      occurredAt: '2026-06-30T15:00:00Z', sharedType: 'personal',
    });

    // 查询 6 月
    const resJune = await app.inject({
      method: 'GET',
      url: `/v1/families/${familyId}/summary?month=2026-06`,
      headers: authHeaders(ownerToken),
    });
    expect(resJune.statusCode).toBe(200);
    expect(resJune.json().totals.expense).toBe(2000);

    // 查询 7 月
    const resJuly = await app.inject({
      method: 'GET',
      url: `/v1/families/${familyId}/summary?month=2026-07`,
      headers: authHeaders(ownerToken),
    });
    expect(resJuly.statusCode).toBe(200);
    expect(resJuly.json().totals.expense).toBe(1000);
  });

  // T16: shared_type IS NULL expense 处理（P2-1 吸收）
  it('T16: shared_type IS NULL expense excluded from aggregation, counted in skipped', async () => {
    const { token: ownerToken, userId: ownerId } = await registerUser('t16-user');

    const listRes = await app.inject({
      method: 'GET',
      url: '/v1/families',
      headers: authHeaders(ownerToken),
    });
    const personalFamily = listRes.json().find((f: { kind: string }) => f.kind === 'personal');
    const familyId = personalFamily.id;
    const ledgerId = await getLedgerId(familyId);

    // 正常 personal expense
    await insertEntry({
      ledgerId, amount: 3000, type: 'expense', createdBy: ownerId,
      occurredAt: '2026-06-01T00:00:00Z', sharedType: 'personal',
    });

    // shared_type IS NULL 的 expense（直接操作 DB 绕过 API 校验）
    const nullEntryId = crypto.randomUUID();
    await getPool().query(
      `INSERT INTO entries (id, ledger_id, amount, currency, type, occurred_at, created_by, shared_type)
       VALUES ($1, $2, $3, 'CNY', 'expense', $4, $5, NULL)`,
      [nullEntryId, ledgerId, 7000, '2026-06-02T00:00:00Z', ownerId],
    );

    const res = await app.inject({
      method: 'GET',
      url: `/v1/families/${familyId}/summary?month=2026-06`,
      headers: authHeaders(ownerToken),
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    // shared_type IS NULL 的 expense 不进入 expense/shared/personal 聚合
    expect(body.totals.expense).toBe(3000);
    expect(body.totals.shared_expense).toBe(0);
    expect(body.totals.personal_expense).toBe(3000);
    // 但计入 skipped_unclassified_expense_count
    expect(body.totals.skipped_unclassified_expense_count).toBe(1);
    // entry_count 包含 income + expense（含 unclassified）
    expect(body.totals.entry_count).toBe(2);
  });});
