/**
 * Costra · Server · 协作页家庭汇总三级下钻测试
 *
 * 卡号：COSTRA-302 · T-302-A1~A10
 *
 * 覆盖：
 *   T-302-A1  401 未登录
 *   T-302-A2  403 非成员
 *   T-302-A3  400 month/year 互斥校验（两者都传 / 都不传）
 *   T-302-A4  400 shared_type=personal 缺 user_id
 *   T-302-A5  200 公共下钻 · 基本流程
 *   T-302-A6  200 个人下钻 · 基本流程
 *   T-302-A7  200 空结果（无匹配流水）
 *   T-302-A8  200 has_more 边界（limit=2 · 3 条数据）
 *   T-302-A9  200 一级分类含多个子分类聚合正确
 *   T-302-A10 403 user_id 越权校验（user_id 不属于该 family）
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

function drillDownUrl(familyId: string, params: Record<string, string | number>): string {
  const qs = Object.entries(params).map(([k, v]) => `${k}=${encodeURIComponent(v)}`).join('&');
  return `/v1/families/${familyId}/summary/drill-down?${qs}`;
}

describe('COSTRA-302: Summary Drill-Down API', () => {

  // T-302-A1: 未登录访问 → 401
  it('T-302-A1: unauthenticated access returns 401', async () => {
    const { token } = await registerUser('sdd-t1-user');
    const families = await listFamilies(token);
    const familyId = families[0].id;

    const res = await app.inject({
      method: 'GET',
      url: drillDownUrl(familyId, {
        month: '2026-06',
        l1_category_id: crypto.randomUUID(),
        shared_type: 'shared',
      }),
    });
    expect(res.statusCode).toBe(401);
  });

  // T-302-A2: 非成员访问 → 403
  it('T-302-A2: non-member access returns 403', async () => {
    const { token: ownerToken } = await registerUser('sdd-t2-owner');
    const { token: outsiderToken } = await registerUser('sdd-t2-outsider');
    const familyId = await createSharedFamilyWithMembers(ownerToken, []);

    const res = await app.inject({
      method: 'GET',
      url: drillDownUrl(familyId, {
        month: '2026-06',
        l1_category_id: crypto.randomUUID(),
        shared_type: 'shared',
      }),
      headers: authHeaders(outsiderToken),
    });
    expect(res.statusCode).toBe(403);
    expect(res.json().code).toBe('FAMILY_NOT_MEMBER');
  });

  // T-302-A3: month/year 互斥校验
  it('T-302-A3: month/year xor validation', async () => {
    const { token } = await registerUser('sdd-t3-user');
    const families = await listFamilies(token);
    const familyId = families[0].id;
    const catId = crypto.randomUUID();

    // 两者都传
    const r1 = await app.inject({
      method: 'GET',
      url: drillDownUrl(familyId, {
        month: '2026-06',
        year: '2026',
        l1_category_id: catId,
        shared_type: 'shared',
      }),
      headers: authHeaders(token),
    });
    expect(r1.statusCode).toBe(400);
    expect(r1.json().code).toBe('INVALID_ARGUMENT');

    // 两者都不传
    const r2 = await app.inject({
      method: 'GET',
      url: drillDownUrl(familyId, {
        l1_category_id: catId,
        shared_type: 'shared',
      }),
      headers: authHeaders(token),
    });
    expect(r2.statusCode).toBe(400);
    expect(r2.json().code).toBe('INVALID_ARGUMENT');
  });

  // T-302-A4: personal 缺 user_id → 400
  it('T-302-A4: shared_type=personal without user_id returns 400', async () => {
    const { token } = await registerUser('sdd-t4-user');
    const families = await listFamilies(token);
    const familyId = families[0].id;

    const res = await app.inject({
      method: 'GET',
      url: drillDownUrl(familyId, {
        month: '2026-06',
        l1_category_id: crypto.randomUUID(),
        shared_type: 'personal',
      }),
      headers: authHeaders(token),
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().code).toBe('INVALID_ARGUMENT');
    expect(res.json().message).toContain('user_id');
  });

  // T-302-A5: 公共下钻 · 基本流程
  it('T-302-A5: shared drill-down returns correct entries', async () => {
    const { token: ownerToken, userId: ownerId } = await registerUser('sdd-t5-owner');
    const familyId = await createSharedFamilyWithMembers(ownerToken, []);
    const ledgerId = await getLedgerId(familyId);

    // 创建一级分类 + 二级子分类
    const l1Id = await insertCategory({ name: '餐饮', type: 'expense', icon: 'food' });
    const l2Id = await insertCategory({ name: '外卖', type: 'expense', icon: 'takeout', parentId: l1Id });

    // 插入公共流水
    // 2026-06-10 Asia/Shanghai → UTC: 2026-06-09T16:00:00Z
    await insertEntry({
      ledgerId, amount: 5000, type: 'expense', createdBy: ownerId,
      occurredAt: '2026-06-09T16:00:00.000Z', categoryId: l2Id, sharedType: 'shared',
    });
    await insertEntry({
      ledgerId, amount: 3000, type: 'expense', createdBy: ownerId,
      occurredAt: '2026-06-09T17:00:00.000Z', categoryId: l1Id, sharedType: 'shared',
    });

    const res = await app.inject({
      method: 'GET',
      url: drillDownUrl(familyId, {
        month: '2026-06',
        l1_category_id: l1Id,
        shared_type: 'shared',
      }),
      headers: authHeaders(ownerToken),
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.l1_category_id).toBe(l1Id);
    expect(body.l1_category_name).toBe('餐饮');
    expect(body.l1_amount).toBe(8000); // 5000 + 3000
    expect(body.total_count).toBe(2);
    expect(body.has_more).toBe(false);
    expect(body.items).toHaveLength(2);
    // 排序：amount DESC
    expect(body.items[0].amount).toBe(5000);
    expect(body.items[1].amount).toBe(3000);
    expect(body.items[0].shared_type).toBe('shared');
    expect(body.items[0].nickname).toBeTruthy();
    // category_name = entry 所属二级/叶子分类名（供协作页明细备注区回退展示）
    expect(body.items[0].category_name).toBe('外卖'); // amount=5000 挂在二级分类 l2Id
    expect(body.items[1].category_name).toBe('餐饮'); // amount=3000 直接挂在一级分类 l1Id
  });

  // T-302-A6: 个人下钻 · 基本流程
  it('T-302-A6: personal drill-down returns correct entries filtered by user', async () => {
    const { token: ownerToken, userId: ownerId } = await registerUser('sdd-t6-owner');
    const { token: memberToken, userId: memberId } = await registerUser('sdd-t6-member');
    const familyId = await createSharedFamilyWithMembers(ownerToken, [memberToken]);
    const ledgerId = await getLedgerId(familyId);

    const l1Id = await insertCategory({ name: '交通', type: 'expense', icon: 'transport' });

    // owner 个人流水
    await insertEntry({
      ledgerId, amount: 2000, type: 'expense', createdBy: ownerId,
      occurredAt: '2026-06-09T16:00:00.000Z', categoryId: l1Id, sharedType: 'personal',
    });
    // member 个人流水
    await insertEntry({
      ledgerId, amount: 4000, type: 'expense', createdBy: memberId,
      occurredAt: '2026-06-09T17:00:00.000Z', categoryId: l1Id, sharedType: 'personal',
    });

    // 查 member 的个人下钻
    const res = await app.inject({
      method: 'GET',
      url: drillDownUrl(familyId, {
        month: '2026-06',
        l1_category_id: l1Id,
        shared_type: 'personal',
        user_id: memberId,
      }),
      headers: authHeaders(ownerToken),
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.l1_amount).toBe(4000); // 只有 member 的
    expect(body.total_count).toBe(1);
    expect(body.items).toHaveLength(1);
    expect(body.items[0].created_by).toBe(memberId);
    expect(body.items[0].shared_type).toBe('personal');
  });

  // T-302-A7: 空结果
  it('T-302-A7: empty result when no matching entries', async () => {
    const { token } = await registerUser('sdd-t7-user');
    const families = await listFamilies(token);
    const familyId = families[0].id;
    const nonexistentCatId = crypto.randomUUID();

    const res = await app.inject({
      method: 'GET',
      url: drillDownUrl(familyId, {
        month: '2026-01',
        l1_category_id: nonexistentCatId,
        shared_type: 'shared',
      }),
      headers: authHeaders(token),
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.l1_amount).toBe(0);
    expect(body.total_count).toBe(0);
    expect(body.has_more).toBe(false);
    expect(body.items).toHaveLength(0);
  });

  // T-302-A8: has_more 边界（limit=2 · 3 条数据）
  it('T-302-A8: has_more=true when total_count > items.length', async () => {
    const { token: ownerToken, userId: ownerId } = await registerUser('sdd-t8-owner');
    const familyId = await createSharedFamilyWithMembers(ownerToken, []);
    const ledgerId = await getLedgerId(familyId);

    const l1Id = await insertCategory({ name: '娱乐', type: 'expense', icon: 'fun' });

    // 插入 3 条
    for (let i = 1; i <= 3; i++) {
      await insertEntry({
        ledgerId, amount: i * 1000, type: 'expense', createdBy: ownerId,
        occurredAt: `2026-06-09T${15 + i}:00:00.000Z`, categoryId: l1Id, sharedType: 'shared',
      });
    }

    const res = await app.inject({
      method: 'GET',
      url: drillDownUrl(familyId, {
        month: '2026-06',
        l1_category_id: l1Id,
        shared_type: 'shared',
        limit: 2,
      }),
      headers: authHeaders(ownerToken),
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.total_count).toBe(3);
    expect(body.items).toHaveLength(2);
    expect(body.has_more).toBe(true);
    // limit=2, 按 amount DESC → 3000, 2000
    expect(body.items[0].amount).toBe(3000);
    expect(body.items[1].amount).toBe(2000);
  });

  // T-302-A9: 一级分类含多个子分类聚合正确
  it('T-302-A9: L1 with multiple L2 children aggregates correctly', async () => {
    const { token: ownerToken, userId: ownerId } = await registerUser('sdd-t9-owner');
    const familyId = await createSharedFamilyWithMembers(ownerToken, []);
    const ledgerId = await getLedgerId(familyId);

    // 一级 + 三个二级
    const l1Id = await insertCategory({ name: '购物', type: 'expense', icon: 'shop' });
    const l2a = await insertCategory({ name: '衣服', type: 'expense', icon: 'clothes', parentId: l1Id });
    const l2b = await insertCategory({ name: '电子产品', type: 'expense', icon: 'digital', parentId: l1Id });
    const l2c = await insertCategory({ name: '日用品', type: 'expense', icon: 'daily', parentId: l1Id });

    // 各二级各一条
    await insertEntry({
      ledgerId, amount: 10000, type: 'expense', createdBy: ownerId,
      occurredAt: '2026-06-09T16:00:00.000Z', categoryId: l2a, sharedType: 'shared',
    });
    await insertEntry({
      ledgerId, amount: 20000, type: 'expense', createdBy: ownerId,
      occurredAt: '2026-06-09T17:00:00.000Z', categoryId: l2b, sharedType: 'shared',
    });
    await insertEntry({
      ledgerId, amount: 5000, type: 'expense', createdBy: ownerId,
      occurredAt: '2026-06-09T18:00:00.000Z', categoryId: l2c, sharedType: 'shared',
    });
    // 另一个一级分类的流水（不应出现）
    const otherL1 = await insertCategory({ name: '医疗', type: 'expense', icon: 'medical' });
    await insertEntry({
      ledgerId, amount: 9999, type: 'expense', createdBy: ownerId,
      occurredAt: '2026-06-09T19:00:00.000Z', categoryId: otherL1, sharedType: 'shared',
    });

    const res = await app.inject({
      method: 'GET',
      url: drillDownUrl(familyId, {
        month: '2026-06',
        l1_category_id: l1Id,
        shared_type: 'shared',
      }),
      headers: authHeaders(ownerToken),
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.l1_amount).toBe(35000); // 10000 + 20000 + 5000
    expect(body.total_count).toBe(3);
    expect(body.items).toHaveLength(3);
    // 排序：amount DESC
    expect(body.items[0].amount).toBe(20000);
    expect(body.items[1].amount).toBe(10000);
    expect(body.items[2].amount).toBe(5000);
  });

  // T-302-A10: user_id 越权校验
  it('T-302-A10: user_id not belonging to family returns 403', async () => {
    const { token: ownerToken } = await registerUser('sdd-t10-owner');
    const { userId: outsiderId } = await registerUser('sdd-t10-outsider');
    const familyId = await createSharedFamilyWithMembers(ownerToken, []);

    const res = await app.inject({
      method: 'GET',
      url: drillDownUrl(familyId, {
        month: '2026-06',
        l1_category_id: crypto.randomUUID(),
        shared_type: 'personal',
        user_id: outsiderId,
      }),
      headers: authHeaders(ownerToken),
    });
    expect(res.statusCode).toBe(403);
    expect(res.json().code).toBe('FAMILY_NOT_MEMBER');
  });

  // T-302-A11: year 维度下钻正常工作
  it('T-302-A11: year dimension drill-down works', async () => {
    const { token: ownerToken, userId: ownerId } = await registerUser('sdd-t11-owner');
    const familyId = await createSharedFamilyWithMembers(ownerToken, []);
    const ledgerId = await getLedgerId(familyId);

    const l1Id = await insertCategory({ name: '教育', type: 'expense', icon: 'edu' });

    await insertEntry({
      ledgerId, amount: 7000, type: 'expense', createdBy: ownerId,
      occurredAt: '2026-03-15T10:00:00.000Z', categoryId: l1Id, sharedType: 'shared',
    });
    await insertEntry({
      ledgerId, amount: 8000, type: 'expense', createdBy: ownerId,
      occurredAt: '2026-09-15T10:00:00.000Z', categoryId: l1Id, sharedType: 'shared',
    });

    const res = await app.inject({
      method: 'GET',
      url: drillDownUrl(familyId, {
        year: '2026',
        l1_category_id: l1Id,
        shared_type: 'shared',
      }),
      headers: authHeaders(ownerToken),
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.l1_amount).toBe(15000);
    expect(body.total_count).toBe(2);
    expect(body.items).toHaveLength(2);
  });

  // T-302-A12: drill-down 明细加总与 summary 排行同一 L1 金额严格一致（P1-1 口径回归）
  // 不变式：summary 排行里某 L1 的金额必须等于 drill-down 该 L1 的 l1_amount（同库、同口径）。
  // 直接比对两个接口，守护「排行金额 == 下钻加总」；含多子分类聚合，覆盖折叠一致性。
  // （软删分类边界在 pg-mem 下不可测，见 familySummaryRepo.listEntriesByL1Category 注释；
  //   此处用全存活分类做环境无关的不变式回归。）
  it('T-302-A12: drill-down l1_amount 与 summary 同一 L1 金额一致', async () => {
    const { token: ownerToken, userId: ownerId } = await registerUser('sdd-t12-owner');
    const familyId = await createSharedFamilyWithMembers(ownerToken, []);
    const ledgerId = await getLedgerId(familyId);

    const l1Id = await insertCategory({ name: '餐饮', type: 'expense', icon: 'food' });
    const l2a = await insertCategory({ name: '正餐', type: 'expense', icon: 'meal', parentId: l1Id });
    const l2b = await insertCategory({ name: '外卖', type: 'expense', icon: 'takeout', parentId: l1Id });

    await insertEntry({
      ledgerId, amount: 6000, type: 'expense', createdBy: ownerId,
      occurredAt: '2026-06-09T16:00:00.000Z', categoryId: l2a, sharedType: 'shared',
    });
    await insertEntry({
      ledgerId, amount: 4000, type: 'expense', createdBy: ownerId,
      occurredAt: '2026-06-09T17:00:00.000Z', categoryId: l2b, sharedType: 'shared',
    });
    // 另一个一级分类的公共流水（不应影响餐饮的一致性）
    const otherL1 = await insertCategory({ name: '交通', type: 'expense', icon: 'transport' });
    await insertEntry({
      ledgerId, amount: 9999, type: 'expense', createdBy: ownerId,
      occurredAt: '2026-06-09T18:00:00.000Z', categoryId: otherL1, sharedType: 'shared',
    });

    // summary 排行中 L1=餐饮 的金额
    const summaryRes = await app.inject({
      method: 'GET',
      url: `/v1/families/${familyId}/summary?month=2026-06`,
      headers: authHeaders(ownerToken),
    });
    expect(summaryRes.statusCode).toBe(200);
    const sharedCats = summaryRes.json().shared.categories as Array<{ category_id: string; amount: number }>;
    const summaryL1 = sharedCats.find((c) => c.category_id === l1Id);
    expect(summaryL1).toBeTruthy();
    expect(summaryL1!.amount).toBe(10000); // 6000 + 4000

    // drill-down 同一 L1 的明细加总
    const drillRes = await app.inject({
      method: 'GET',
      url: drillDownUrl(familyId, { month: '2026-06', l1_category_id: l1Id, shared_type: 'shared' }),
      headers: authHeaders(ownerToken),
    });
    expect(drillRes.statusCode).toBe(200);

    // 核心不变式：排行金额 == 下钻 l1_amount == 明细可见项求和
    const drill = drillRes.json();
    expect(drill.l1_amount).toBe(summaryL1!.amount);
    expect(drill.total_count).toBe(2);
    const itemsSum = (drill.items as Array<{ amount: number }>).reduce((s, it) => s + it.amount, 0);
    expect(itemsSum).toBe(drill.l1_amount);
  });
});
