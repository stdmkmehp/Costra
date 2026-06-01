/**
 * Costra · Server · categories 路由单测
 *
 * 卡号：COSTRA-218
 * 事实源：dispatch §C5 T1~T8
 *
 * 覆盖：
 *   T1  GET /v1/categories 无 token → 401
 *   T2  GET /v1/categories 无 family_id → 400
 *   T3  GET /v1/categories 正常 → 200 + 返回系统分类（含 children_count）
 *   T4  GET /v1/categories 非成员 family_id → 403
 *   T5  POST /v1/categories 创建自定义分类 → 201
 *   T6  POST /v1/categories parent_id 指向二级分类 → 400（不允许三层）
 *   T7  POST /v1/categories 重复名 → 409 DUPLICATE_RESOURCE
 *   T8  验证 children_count 正确（一级分类的 children_count = 其下二级数量）
 */

import { describe, it, expect, beforeEach } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../src/app.js';
import { setWxFetchForTests } from '../src/wx/code2Session.js';
import { getPool } from '../src/db/pool.js';

// --- 辅助函数 ---

async function login(app: FastifyInstance, openid = 'openid-categories-test'): Promise<string> {
  setWxFetchForTests(
    (async () =>
      new Response(
        JSON.stringify({ openid, session_key: 'sk' }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      )) as unknown as typeof fetch,
  );
  const res = await app.inject({
    method: 'POST',
    url: '/v1/auth/wx-login',
    payload: { code: 'test-categories' },
    headers: { 'content-type': 'application/json' },
  });
  const body = res.json() as { access_token: string; user: { id: string } };
  return body.access_token;
}

function decodeUserId(token: string): string {
  const parts = token.split('.');
  const payload = JSON.parse(Buffer.from(parts[1], 'base64').toString()) as { sub: string };
  return payload.sub;
}

// --- 测试 ---

let app: FastifyInstance;
let token: string;
let userId: string;
let familyId: string;

beforeEach(async () => {
  app = await buildApp({ disableLogger: true });
  await app.ready();
  token = await login(app);
  userId = decodeUserId(token);

  familyId = '00000000-0000-0000-0000-000000000f01';
  const pool = getPool();
  await pool.query(
    `INSERT INTO families (id, name, owner_id, kind) VALUES ($1, 'CatTestFamily', $2, 'shared')`,
    [familyId, userId],
  );
  await pool.query(
    `INSERT INTO family_members (family_id, user_id, role) VALUES ($1, $2, 'owner')`,
    [familyId, userId],
  );

  // 插入系统分类种子（简化版：模拟 0008 migration 的 11 一级 + 部分二级）
  // 为了测试 children_count，至少需要一个一级带多个二级
  await pool.query(
    `INSERT INTO categories (id, family_id, name, type, icon, color, sort_order, is_system, parent_id, is_direct_default)
     VALUES
       ('a0000000-0000-0000-0000-000000000001', NULL, '餐饮', 'expense', 'icon.category.food', 'color.category.food', 1, true, NULL, false),
       ('a0000000-0000-0000-0000-000000000002', NULL, '交通', 'expense', 'icon.category.transport', 'color.category.transport', 2, true, NULL, false),
       ('a0000000-0000-0000-0000-000000000003', NULL, '购物', 'expense', 'icon.category.shopping', 'color.category.shopping', 3, true, NULL, false),
       ('a0000000-0000-0000-0000-000000000010', NULL, '职业收入', 'income', 'icon.category.salary', 'color.category.salary', 1, true, NULL, false),
       -- 餐饮 二级
       ('a0000000-0000-0000-0000-000000000101', NULL, '餐饮', 'expense', 'icon.category.food.dining', 'color.category.food', 1, true, 'a0000000-0000-0000-0000-000000000001', true),
       ('a0000000-0000-0000-0000-000000000102', NULL, '外卖', 'expense', 'icon.category.food.delivery', 'color.category.food', 2, true, 'a0000000-0000-0000-0000-000000000001', true),
       ('a0000000-0000-0000-0000-000000000103', NULL, '零食', 'expense', 'icon.category.food.snacks', 'color.category.food', 3, true, 'a0000000-0000-0000-0000-000000000001', true),
       -- 交通 二级
       ('a0000000-0000-0000-0000-000000000201', NULL, '交通', 'expense', 'icon.category.transport.transit', 'color.category.transport', 1, true, 'a0000000-0000-0000-0000-000000000002', true),
       ('a0000000-0000-0000-0000-000000000202', NULL, '打车', 'expense', 'icon.category.transport.taxi', 'color.category.transport', 2, true, 'a0000000-0000-0000-0000-000000000002', true)
    `,
  );
});

function authHeader() {
  return { authorization: `Bearer ${token}`, 'content-type': 'application/json' };
}

describe('GET /v1/categories', () => {
  it('T1 无 token → 401 UNAUTHENTICATED', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/v1/categories?family_id=00000000-0000-0000-0000-000000000f01',
      headers: { 'content-type': 'application/json' },
    });
    expect(res.statusCode).toBe(401);
    const body = res.json() as { code: string };
    expect(body.code).toBe('UNAUTHENTICATED');
  });

  it('T2 无 family_id → 400', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/v1/categories',
      headers: authHeader(),
    });
    expect(res.statusCode).toBe(400);
  });

  it('T3 正常 → 200 + 返回系统分类（含 children_count）', async () => {
    const res = await app.inject({
      method: 'GET',
      url: `/v1/categories?family_id=${familyId}`,
      headers: authHeader(),
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as Array<Record<string, unknown>>;
    // 应包含系统分类 + 无家庭自定义分类 = 9 条（4 一级 + 5 二级）
    expect(body.length).toBe(9);
    // 所有条目都有 children_count 字段
    for (const cat of body) {
      expect(cat).toHaveProperty('children_count');
      expect(cat).toHaveProperty('id');
      expect(cat).toHaveProperty('name');
      expect(cat).toHaveProperty('type');
      expect(cat).toHaveProperty('parent_id');
      expect(cat).toHaveProperty('is_direct_default');
    }
  });

  it('T4 非成员 family_id → 403 FAMILY_NOT_MEMBER', async () => {
    // 登录另一个用户
    const tokenB = await login(app, 'openid-user-b-categories');
    const userIdB = decodeUserId(tokenB);
    const otherFamilyId = '00000000-0000-0000-0000-000000000f99';
    const pool = getPool();
    await pool.query(
      `INSERT INTO families (id, name, owner_id, kind) VALUES ($1, 'OtherFamily', $2, 'shared')`,
      [otherFamilyId, userIdB],
    );
    // 注意：不插入 family_members，所以当前登录用户 A 不是这个 family 的成员
    // 用 token（用户 A）请求 otherFamilyId → 403

    const res = await app.inject({
      method: 'GET',
      url: `/v1/categories?family_id=${otherFamilyId}`,
      headers: authHeader(),
    });
    expect(res.statusCode).toBe(403);
    const body = res.json() as { code: string };
    expect(body.code).toBe('FAMILY_NOT_MEMBER');
  });
});

describe('POST /v1/categories', () => {
  it('T5 创建自定义分类 → 201', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/v1/categories',
      headers: authHeader(),
      payload: {
        family_id: familyId,
        name: '自定义支出',
        type: 'expense',
        icon: 'icon.custom.expense',
        color: 'color.custom',
      },
    });
    expect(res.statusCode).toBe(201);
    const body = res.json() as Record<string, unknown>;
    expect(body.name).toBe('自定义支出');
    expect(body.type).toBe('expense');
    expect(body.is_system).toBe(false);
    expect(body.family_id).toBe(familyId);
    expect(body.parent_id).toBeNull();
    expect(body.children_count).toBe(0);
    expect(body.is_direct_default).toBe(false);
  });

  it('T6 parent_id 指向二级分类 → 422（不允许三层）', async () => {
    // 创建一个一级自定义分类
    const level1Res = await app.inject({
      method: 'POST',
      url: '/v1/categories',
      headers: authHeader(),
      payload: {
        family_id: familyId,
        name: '自定义一级',
        type: 'expense',
        icon: 'icon.custom.l1',
      },
    });
    expect(level1Res.statusCode).toBe(201);
    const level1 = level1Res.json() as Record<string, unknown>;

    // 在一级下创建二级
    const level2Res = await app.inject({
      method: 'POST',
      url: '/v1/categories',
      headers: authHeader(),
      payload: {
        family_id: familyId,
        name: '自定义二级',
        type: 'expense',
        icon: 'icon.custom.l2',
        parent_id: level1.id,
      },
    });
    expect(level2Res.statusCode).toBe(201);
    const level2 = level2Res.json() as Record<string, unknown>;

    // 尝试在二级下创建三级 → 应 422 BUSINESS_RULE_VIOLATION
    const level3Res = await app.inject({
      method: 'POST',
      url: '/v1/categories',
      headers: authHeader(),
      payload: {
        family_id: familyId,
        name: '自定义三级',
        type: 'expense',
        icon: 'icon.custom.l3',
        parent_id: level2.id,
      },
    });
    expect(level3Res.statusCode).toBe(422);
    const body = level3Res.json() as { code: string };
    expect(body.code).toBe('BUSINESS_RULE_VIOLATION');
  });

  it('T7 重复名 → 409 DUPLICATE_RESOURCE', async () => {
    // 先创建
    const createRes = await app.inject({
      method: 'POST',
      url: '/v1/categories',
      headers: authHeader(),
      payload: {
        family_id: familyId,
        name: '重复测试',
        type: 'expense',
        icon: 'icon.dup',
      },
    });
    expect(createRes.statusCode).toBe(201);

    // 再创建同名同类型同 parent → 409
    const dupRes = await app.inject({
      method: 'POST',
      url: '/v1/categories',
      headers: authHeader(),
      payload: {
        family_id: familyId,
        name: '重复测试',
        type: 'expense',
        icon: 'icon.dup',
      },
    });
    expect(dupRes.statusCode).toBe(409);
    const body = dupRes.json() as { code: string };
    expect(body.code).toBe('DUPLICATE_RESOURCE');
  });
});

describe('children_count 验证', () => {
  it('T8 一级分类的 children_count = 其下二级数量', async () => {
    const res = await app.inject({
      method: 'GET',
      url: `/v1/categories?family_id=${familyId}`,
      headers: authHeader(),
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as Array<Record<string, unknown>>;

    // 找到"餐饮"一级分类 → children_count 应为 3（餐饮/外卖/零食）
    const foodCat = body.find((c) => c.name === '餐饮' && c.parent_id === null);
    expect(foodCat).toBeDefined();
    expect(foodCat!.children_count).toBe(3);

    // 找到"交通"一级分类 → children_count 应为 2（交通/打车）
    const transportCat = body.find((c) => c.name === '交通' && c.parent_id === null);
    expect(transportCat).toBeDefined();
    expect(transportCat!.children_count).toBe(2);

    // 购物无二级 → children_count = 0
    const shoppingCat = body.find((c) => c.name === '购物' && c.parent_id === null);
    expect(shoppingCat).toBeDefined();
    expect(shoppingCat!.children_count).toBe(0);

    // 二级分类 children_count = 0
    const subCat = body.find((c) => c.name === '外卖');
    expect(subCat).toBeDefined();
    expect(subCat!.children_count).toBe(0);
  });
});
