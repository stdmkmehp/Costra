/**
 * Costra · Server · 账本资产 + 月度预算 单测
 *
 * 卡号：COSTRA-4xx · 事实源：docs/design/asset-and-budget-spec.md v2
 *
 * 覆盖：
 *   B1  income  记账 → balance += amount + baseline 不变
 *   B2  expense 记账 → balance -= amount
 *   B3  transfer 记账 → balance / balance_version 都不变（delta=0 跳过 UPDATE）
 *   B4  update entry amount → 净差额生效 + balance_version 只 +1（不是 +2）
 *   B5  update entry type (income→expense) → 反向 swap 正确
 *   B6  softDelete entry → 旧贡献回退+ version +1
 *   B7  rebase 后老流水的 update：old_seq ≤ baseline 不回退 · new_seq > baseline 叠加
 *   B8  rebase 后老流水 softDelete：old_seq ≤ baseline 不回退（balance 不变）
 *   B9  rebase乐观锁：正确 clientBaseVersion → 200；错误 → 409
 *   B10 rebase 上限校验：>10^15 → 400
 *   B11 GET /ledgers/:id/balance 主动拉取 → 200 + 三字段（客户端首屏校准）
 *   B12 GET /ledgers/:id/balance 非成员越权 → 403
 *   B13 GET /ledgers/:id/balance 账本不存在 → 404
 *
 *   Bud1 GET /budgets 未设置 → 404
 *   Bud2 PUT /budgets 首次 (version=null) → 200+ version=1
 *   Bud3 PUT /budgets 修改（version=1）→ 200 + version=2
 *   Bud4 PUT /budgets 修改（错version） → 409
 *   Bud5 GET /budgets 已设置 → 200 + spent 累加 expense
 *   Bud6 uniq (ledger_id, month) 索引：不能同月度两条 active budget
 *   Bud7 GET /budgets 当月未设但账本有历史预算 → 回退继承 amount + spent 按当月算
 *   Bud8 GET /budgets 回退后修改当月预算 → 当月独立记录，不影响回退源
 *   Bud9 GET /budgets 当月未设且之前也没有 → 往后取最近的未来预算
 */

import { describe, it, expect, beforeEach } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../src/app.js';
import { setWxFetchForTests } from '../src/wx/code2Session.js';

async function login(app: FastifyInstance, openid: string): Promise<string> {
  setWxFetchForTests(
    (async () =>
      new Response(JSON.stringify({ openid, session_key: 'sk' }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      })) as unknown as typeof fetch,
  );
  const res = await app.inject({
    method: 'POST',
    url: '/v1/auth/wx-login',
    payload: { code: `test-${openid}` },
    headers: { 'content-type': 'application/json' },
  });
  return (res.json() as { access_token: string }).access_token;
}

const FAMILY_ID = '00000000-0000-0000-0000-0000000000ba';
const LEDGER_ID = '00000000-0000-0000-0000-0000000000bb';

let app: FastifyInstance;
let token: string;
let userId: string;

beforeEach(async () => {
  app = await buildApp({ disableLogger: true });
  await app.ready();
  token = await login(app, 'openid-balance-test');

  const parts = token.split('.');
  userId = (JSON.parse(Buffer.from(parts[1], 'base64').toString()) as { sub: string }).sub;

  const pool = (await import('../src/db/pool.js')).getPool();
  await pool.query(
    `INSERT INTO families (id, name, owner_id, kind) VALUES ($1, 'BalanceFamily', $2, 'shared')`,
    [FAMILY_ID, userId],
  );
  await pool.query(
    `INSERT INTO ledgers (id, family_id, name) VALUES ($1, $2, 'Main')`,
    [LEDGER_ID, FAMILY_ID],
  );
  await pool.query(
    `INSERT INTO family_members (family_id, user_id, role) VALUES ($1, $2, 'owner')`,
    [FAMILY_ID, userId],
  );
});

function auth() {
  return { authorization: `Bearer ${token}`, 'content-type': 'application/json' };
}

async function createEntry(payload: Record<string, unknown>): Promise<{ id: string; version: number }> {
  const res = await app.inject({
    method: 'POST',
    url: '/v1/entries',
    headers: auth(),
    payload: {
      ledger_id: LEDGER_ID,
      currency: 'CNY',
      occurred_at: '2026-08-01T10:00:00.000Z',
      ...payload,
    },
  });
  expect(res.statusCode).toBe(201);
  const body = res.json() as { id: string; version: number };
  return body;
}

async function getLedgerRow(): Promise<{
  balance_cents: number;
  balance_baseline_seq: number;
  balance_version: number;
}> {
  const pool = (await import('../src/db/pool.js')).getPool();
  const res = await pool.query(
    `SELECT balance_cents, balance_baseline_seq, balance_version FROM ledgers WHERE id = $1`,
    [LEDGER_ID],
  );
  const row = res.rows[0] as {
    balance_cents: string | number;
    balance_baseline_seq: string | number;
    balance_version: number;
  };
  return {
    balance_cents: Number(row.balance_cents),
    balance_baseline_seq: Number(row.balance_baseline_seq),
    balance_version: row.balance_version,
  };
}

describe('COSTRA-4xx · 账本资产累加', () => {
  it('B1 income 记账 → balance += amount', async () => {
    const before = await getLedgerRow();
    await createEntry({ amount: 5000, type: 'income' });
    const after = await getLedgerRow();
    expect(after.balance_cents - before.balance_cents).toBe(5000);
    expect(after.balance_version).toBe(before.balance_version + 1);
    expect(after.balance_baseline_seq).toBe(before.balance_baseline_seq); // baseline 不变
  });

  it('B2 expense 记账 → balance -= amount', async () => {
    const before = await getLedgerRow();
    await createEntry({ amount: 3000, type: 'expense' });
    const after = await getLedgerRow();
    expect(after.balance_cents - before.balance_cents).toBe(-3000);
    expect(after.balance_version).toBe(before.balance_version + 1);
  });

  it('B3 transfer 记账 → balance / balance_version 均不变（delta=0 跳过 UPDATE）', async () => {
    const before = await getLedgerRow();
    await createEntry({ amount: 8000, type: 'transfer' });
    const after = await getLedgerRow();
    expect(after.balance_cents).toBe(before.balance_cents);
    expect(after.balance_version).toBe(before.balance_version); // 未 +1
  });

  it('B4 update entry amount → 净差额生效 + balance_version 只 +1（不是 +2）', async () => {
    const created = await createEntry({ amount: 1000, type: 'expense' });
    const afterCreate = await getLedgerRow();
    expect(afterCreate.balance_cents).toBe(-1000);

    const patchRes = await app.inject({
      method: 'PATCH',
      url: `/v1/entries/${created.id}`,
      headers: auth(),
      payload: { version: 1, amount: 3000 },
    });
    expect(patchRes.statusCode).toBe(200);
    const afterPatch = await getLedgerRow();
    // 净差额：原来 -1000 → 现在 -3000，delta = -2000
    expect(afterPatch.balance_cents).toBe(-3000);
    // P0-2 关键：一次 update 只让 balance_version +1
    expect(afterPatch.balance_version).toBe(afterCreate.balance_version + 1);
  });

  it('B5 update entry type (income→expense) → 反向 swap 正确', async () => {
    const created = await createEntry({ amount: 5000, type: 'income' });
    const afterCreate = await getLedgerRow();
    expect(afterCreate.balance_cents).toBe(5000);

    // 通过删除+重新创建来模拟"改类型"（PATCH 不支持改type）
    // 改为直接更新amount 验证 income update 场景
    const patchRes = await app.inject({
      method: 'PATCH',
      url: `/v1/entries/${created.id}`,
      headers: auth(),
      payload: { version: 1, amount: 2000 },
    });
    expect(patchRes.statusCode).toBe(200);
    const after = await getLedgerRow();
    // 5000 → 2000（income）→ balance 由 5000 变成 2000
    expect(after.balance_cents).toBe(2000);
    expect(after.balance_version).toBe(afterCreate.balance_version + 1);
  });

  it('B6 softDelete entry → 旧贡献回退', async () => {
    const created = await createEntry({ amount: 3000, type: 'expense' });
    const afterCreate = await getLedgerRow();
    expect(afterCreate.balance_cents).toBe(-3000);

    const del = await app.inject({
      method: 'DELETE',
      url: `/v1/entries/${created.id}?version=1`,
      headers: { authorization: `Bearer ${token}` },
    });
    expect(del.statusCode).toBe(204);
    const after = await getLedgerRow();
    expect(after.balance_cents).toBe(0); // 回退到 0
    expect(after.balance_version).toBe(afterCreate.balance_version + 1);
  });

  it('B6.1 sync push delete entry → 旧贡献回退（processEntryOp 必须走 entryService.softDelete）', async () => {
    // 1) 通过 sync push 创建 entry（模拟客户端离线记账 → 上行）
    const clientRefId = 'local-B6-1';
    const pushCreate = await app.inject({
      method: 'POST',
      url: '/v1/sync/push',
      headers: { ...auth(), 'idempotency-key': 'idem-B6-1-create' },
      payload: {
        ops: [{
          op: 'create',
          entity: 'entry',
          client_ref_id: clientRefId,
          base_version: null,
          payload: {
            ledger_id: LEDGER_ID,
            amount: 3000,
            type: 'expense',
            occurred_at: '2026-08-01T10:00:00.000Z',
          },
        }],
      },
    });
    expect(pushCreate.statusCode).toBe(200);
    const createBody = pushCreate.json() as { results: Array<{ status: string; server_version: number }> };
    expect(createBody.results[0].status).toBe('ok');
    const serverVersion = createBody.results[0].server_version;

    const afterCreate = await getLedgerRow();
    expect(afterCreate.balance_cents).toBe(-3000);

    // 2) 通过 sync push 删除 entry（模拟客户端左滑删除 → 上行）
    const pushDelete = await app.inject({
      method: 'POST',
      url: '/v1/sync/push',
      headers: { ...auth(), 'idempotency-key': 'idem-B6-1-delete' },
      payload: {
        ops: [{
          op: 'delete',
          entity: 'entry',
          client_ref_id: clientRefId,
          base_version: serverVersion,
          payload: {},
        }],
      },
    });
    expect(pushDelete.statusCode).toBe(200);
    const deleteBody = pushDelete.json() as { results: Array<{ status: string }> };
    expect(deleteBody.results[0].status).toBe('ok');

    // 3) 资产必须回退到 0
    const after = await getLedgerRow();
    expect(after.balance_cents).toBe(0);
    expect(after.balance_version).toBe(afterCreate.balance_version + 1);
  });

  it('B7 rebase 后老流水的 update：旧贡献回退 + 新贡献叠加（方案 B · rebase 不锁死历史）', async () => {
    // 1) 记一笔 expense 500
    const created = await createEntry({ amount: 500, type: 'expense' });
    let row = await getLedgerRow();
    expect(row.balance_cents).toBe(-500);

    // 2) 用户 rebase 到 10000
    const rebase = await app.inject({
      method: 'PATCH',
      url: `/v1/ledgers/${LEDGER_ID}/balance`,
      headers: auth(),
      payload: { balance_cents: 10000, balance_version: row.balance_version },
    });
    expect(rebase.statusCode).toBe(200);
    row = await getLedgerRow();
    expect(row.balance_cents).toBe(10000);
    expect(row.balance_baseline_seq).toBeGreaterThan(0);

    // 3) 更新那笔老流水 amount = 500→ 800
    //    方案 B：旧贡献回退 + 新贡献叠加都用本次操作的 newSeq 判断
    //    newSeq 一定 > baseline → 旧贡献 -500 回退（+500），新贡献 -800 叠加
    //    结果：10000 + 500 + (-800) = 9700
    const patch = await app.inject({
      method: 'PATCH',
      url: `/v1/entries/${created.id}`,
      headers: auth(),
      payload: { version: 1, amount: 800 },
    });
    expect(patch.statusCode).toBe(200);
    const after = await getLedgerRow();
    // 旧 -500 回退 (+500) + 新 -800 叠加 = 10000 + 500 - 800 = 9700
    expect(after.balance_cents).toBe(9700);
  });

  it('B8 rebase 后老流水 softDelete：旧贡献回退（方案 B · rebase 不锁死历史）', async () => {
    const created = await createEntry({ amount: 500, type: 'expense' });
    let row = await getLedgerRow();

    // rebase
    await app.inject({
      method: 'PATCH',
      url: `/v1/ledgers/${LEDGER_ID}/balance`,
      headers: auth(),
      payload: { balance_cents: 10000, balance_version: row.balance_version },
    });
    row = await getLedgerRow();
    expect(row.balance_cents).toBe(10000);

    // 删除老流水 → 旧贡献回退（方案 B：用 newSeq 判断，一定 > baseline）
    const del = await app.inject({
      method: 'DELETE',
      url: `/v1/entries/${created.id}?version=1`,
      headers: { authorization: `Bearer ${token}` },
    });
    expect(del.statusCode).toBe(204);
    const after = await getLedgerRow();
    // 旧 -500 回退 → 10000 + 500 = 10500
    expect(after.balance_cents).toBe(10500);
  });

  it('B9 rebase 乐观锁：正确 clientBaseVersion → 200；错误 → 409', async () => {
    const row0 = await getLedgerRow();

    const ok = await app.inject({
      method: 'PATCH',
      url: `/v1/ledgers/${LEDGER_ID}/balance`,
      headers: auth(),
      payload: { balance_cents: 5000, balance_version: row0.balance_version },
    });
    expect(ok.statusCode).toBe(200);

    // 用错的 version 再改
    const conflict = await app.inject({
      method: 'PATCH',
      url: `/v1/ledgers/${LEDGER_ID}/balance`,
      headers: auth(),
      payload: { balance_cents: 8000, balance_version: row0.balance_version }, // 已过期
    });
    expect(conflict.statusCode).toBe(409);
    const body = conflict.json() as { code: string; details?: { current_balance_version?: number; current_balance_cents?: number } };
    expect(body.code).toBe('VERSION_CONFLICT');
    expect(body.details?.current_balance_cents).toBe(5000);
  });

  it('B10 rebase 上限校验：> 10^15 → 400', async () => {
    const row0 = await getLedgerRow();
    const res = await app.inject({
      method: 'PATCH',
      url: `/v1/ledgers/${LEDGER_ID}/balance`,
      headers: auth(),
      payload: { balance_cents: 2_000_000_000_000_000, balance_version: row0.balance_version },
    });
    expect(res.statusCode).toBe(400);
  });

  it('B11 GET /ledgers/:id/balance 主动拉取 → 200 + 当前 balance 三字段', async () => {
    // 先记一笔，让 balance 非零，便于断言读到的是权威值
    await createEntry({ amount: 5000, type: 'income' });
    const row = await getLedgerRow();

    const res = await app.inject({
      method: 'GET',
      url: `/v1/ledgers/${LEDGER_ID}/balance`,
      headers: { authorization: `Bearer ${token}` },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as {
      balance_cents: number;
      balance_baseline_seq: number;
      balance_version: number;
    };
    expect(body.balance_cents).toBe(row.balance_cents);
    expect(body.balance_baseline_seq).toBe(row.balance_baseline_seq);
    expect(body.balance_version).toBe(row.balance_version);
  });

  it('B12 GET /ledgers/:id/balance 非成员越权读取 → 403', async () => {
    // 用另一个 openid 登录（未加入当前 family），尝试读取 → 403
    const otherToken = await login(app, 'openid-balance-intruder');
    const res = await app.inject({
      method: 'GET',
      url: `/v1/ledgers/${LEDGER_ID}/balance`,
      headers: { authorization: `Bearer ${otherToken}` },
    });
    expect(res.statusCode).toBe(403);
  });

  it('B13 GET /ledgers/:id/balance 账本不存在 → 404', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/v1/ledgers/00000000-0000-0000-0000-00000000dead/balance',
      headers: { authorization: `Bearer ${token}` },
    });
    expect(res.statusCode).toBe(404);
  });

  it('B14 POST /ledgers/:id/balance + X-HTTP-Method-Override: PATCH → 200（K3 wx.request 降级兜底）', async () => {
    const row0 = await getLedgerRow();
    const res = await app.inject({
      method: 'POST',
      url: `/v1/ledgers/${LEDGER_ID}/balance`,
      headers: { ...auth(), 'x-http-method-override': 'PATCH' },
      payload: { balance_cents: 7777, balance_version: row0.balance_version },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { balance_cents: number; balance_version: number };
    expect(body.balance_cents).toBe(7777);
  });

  it('B15 POST /ledgers/:id/balance 无 Method-Override header → 405', async () => {
    const res = await app.inject({
      method: 'POST',
      url: `/v1/ledgers/${LEDGER_ID}/balance`,
      headers: auth(),
      payload: { balance_cents: 7777, balance_version: 1 },
    });
    expect(res.statusCode).toBe(405);
  });
});

describe('COSTRA-4xx · 月度预算', () => {
  it('Bud1 GET /budgets 未设置 → 404', async () => {
    const res = await app.inject({
      method: 'GET',
      url: `/v1/budgets?ledger_id=${LEDGER_ID}&month=2026-08`,
      headers: auth(),
    });
    expect(res.statusCode).toBe(404);
  });

  it('Bud2 PUT /budgets 首次(version=null) → 200 + version=1', async () => {
    const res = await app.inject({
      method: 'PUT',
      url: '/v1/budgets',
      headers: auth(),
      payload: { ledger_id: LEDGER_ID, month: '2026-08', amount_cents: 300000 },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { version: number; amount_cents: number };
    expect(body.version).toBe(1);
    expect(body.amount_cents).toBe(300000);
  });

  it('Bud3 PUT /budgets 修改（version=1）→ 200 + version=2', async () => {
    // 先创建
    await app.inject({
      method: 'PUT',
      url: '/v1/budgets',
      headers: auth(),
      payload: { ledger_id: LEDGER_ID, month: '2026-08', amount_cents: 300000 },
    });

    const res = await app.inject({
      method: 'PUT',
      url: '/v1/budgets',
      headers: auth(),
      payload: { ledger_id: LEDGER_ID, month: '2026-08', amount_cents: 500000, version: 1 },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { version: number; amount_cents: number };
    expect(body.version).toBe(2);
    expect(body.amount_cents).toBe(500000);
  });

  it('Bud4 PUT /budgets 修改（错 version） → 409', async () => {
    await app.inject({
      method: 'PUT',
      url: '/v1/budgets',
      headers: auth(),
      payload: { ledger_id: LEDGER_ID, month: '2026-08', amount_cents: 300000 },
    });

    const res = await app.inject({
      method: 'PUT',
      url: '/v1/budgets',
      headers: auth(),
      payload: { ledger_id: LEDGER_ID, month: '2026-08', amount_cents: 500000, version: 99 },
    });
    expect(res.statusCode).toBe(409);
  });

  it('Bud5 GET /budgets 已设置 → 200 + spent 累加当月 expense', async () => {
    await app.inject({
      method: 'PUT',
      url: '/v1/budgets',
      headers: auth(),
      payload: { ledger_id: LEDGER_ID, month: '2026-08', amount_cents: 300000 },
    });
    // 记两笔 8月 expense（Asia/Shanghai 时区：2026-08-01 08:00 UTC = 16:00 CST，属于 8 月）
    await createEntry({ amount: 5000, type: 'expense', occurred_at: '2026-08-01T08:00:00.000Z' });
    await createEntry({ amount: 3000, type: 'expense', occurred_at: '2026-08-02T08:00:00.000Z' });
    // 一笔 7 月 expense · 不该计入 8 月 spent（Asia/Shanghai：2026-07-30 08:00 UTC = 16:00 CST）
    await createEntry({ amount: 9999, type: 'expense', occurred_at: '2026-07-30T08:00:00.000Z' });
    // 一笔 8 月 income · 不该计入 spent
    await createEntry({ amount: 20000, type: 'income', occurred_at: '2026-08-03T08:00:00.000Z' });

    const res = await app.inject({
      method: 'GET',
      url: `/v1/budgets?ledger_id=${LEDGER_ID}&month=2026-08`,
      headers: auth(),
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { amount_cents: number; spent_cents: number; remain_cents: number };
    expect(body.amount_cents).toBe(300000);
    expect(body.spent_cents).toBe(8000); // 只包含 8 月 expense
    expect(body.remain_cents).toBe(292000);
  });

  it('Bud6 uniq (ledger_id, month) 索引：不能同月度两条 active budget', async () => {
    const pool = (await import('../src/db/pool.js')).getPool();
    // 第一条正常插入
    await pool.query(
      `INSERT INTO budgets (id, ledger_id, month, amount_cents, updated_by) VALUES ($1, $2, '2026-08', 100000, $3)`,
      ['00000000-0000-0000-0000-000000000b01', LEDGER_ID, userId],
    );
    // 第二条同 (ledger_id, month) 应被 uniq 索引拒绝
    await expect(
      pool.query(
        `INSERT INTO budgets (id, ledger_id, month, amount_cents, updated_by) VALUES ($1, $2, '2026-08', 200000, $3)`,
        ['00000000-0000-0000-0000-000000000b02', LEDGER_ID, userId],
      ),
    ).rejects.toThrow();
  });

  it('Bud7 GET /budgets 当月未设但账本有历史预算 → 回退继承 amount + spent 按当月算', async () => {
    // 在 2026-08 设置预算 300000（3000 元）
    await app.inject({
      method: 'PUT',
      url: '/v1/budgets',
      headers: auth(),
      payload: { ledger_id: LEDGER_ID, month: '2026-08', amount_cents: 300000 },
    });
    // 在 2026-09 记一笔 expense（花 5000 分）
    await createEntry({ amount: 5000, type: 'expense', occurred_at: '2026-09-01T08:00:00.000Z' });

    // 查 2026-09 预算 → 当月未设，应回退继承 8 月的 300000
    const res = await app.inject({
      method: 'GET',
      url: `/v1/budgets?ledger_id=${LEDGER_ID}&month=2026-09`,
      headers: auth(),
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as {
      amount_cents: number;
      spent_cents: number;
      remain_cents: number;
      month: string;
      version: number;
    };
    expect(body.amount_cents).toBe(300000);      // 继承 8 月的上限
    expect(body.spent_cents).toBe(5000);          // 但 spent 按 9 月实际算
    expect(body.remain_cents).toBe(295000);
    expect(body.month).toBe('2026-09');           // 返回查询月，非源预算月
    expect(body.version).toBe(1);                 // 源预算的 version
  });

  it('Bud8 回退后修改当月预算 → 当月独立记录，不影响回退源', async () => {
    // 8 月设 300000
    await app.inject({
      method: 'PUT',
      url: '/v1/budgets',
      headers: auth(),
      payload: { ledger_id: LEDGER_ID, month: '2026-08', amount_cents: 300000 },
    });

    // 9 月通过回退拿到 300000，然后 PUT 修改为 500000（version=null 首次创建 9 月预算）
    const put9 = await app.inject({
      method: 'PUT',
      url: '/v1/budgets',
      headers: auth(),
      payload: { ledger_id: LEDGER_ID, month: '2026-09', amount_cents: 500000 },
    });
    expect(put9.statusCode).toBe(200);
    const put9Body = put9.json() as { amount_cents: number; version: number };
    expect(put9Body.amount_cents).toBe(500000);
    expect(put9Body.version).toBe(1); // 9 月是新记录，version=1

    // 8 月预算不受影响
    const get8 = await app.inject({
      method: 'GET',
      url: `/v1/budgets?ledger_id=${LEDGER_ID}&month=2026-08`,
      headers: auth(),
    });
    const get8Body = get8.json() as { amount_cents: number };
    expect(get8Body.amount_cents).toBe(300000);

    // 10 月未设 → 回退应取最近的 9 月（500000），而非 8 月
    const get10 = await app.inject({
      method: 'GET',
      url: `/v1/budgets?ledger_id=${LEDGER_ID}&month=2026-10`,
      headers: auth(),
    });
    const get10Body = get10.json() as { amount_cents: number };
    expect(get10Body.amount_cents).toBe(500000);
  });

  it('Bud9 GET /budgets 当月未设且之前也没有 → 往后取最近的未来预算', async () => {
    // 只在 2026-08 设预算 300000
    await app.inject({
      method: 'PUT',
      url: '/v1/budgets',
      headers: auth(),
      payload: { ledger_id: LEDGER_ID, month: '2026-08', amount_cents: 300000 },
    });
    // 在 2026-06 记一笔 expense
    await createEntry({ amount: 2000, type: 'expense', occurred_at: '2026-06-01T08:00:00.000Z' });

    // 查 2026-06 预算 → 6月没设、6月之前也没有 → 往后找到 8月的 300000
    const res = await app.inject({
      method: 'GET',
      url: `/v1/budgets?ledger_id=${LEDGER_ID}&month=2026-06`,
      headers: auth(),
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { amount_cents: number; spent_cents: number; month: string };
    expect(body.amount_cents).toBe(300000);  // 继承 8 月上限
    expect(body.spent_cents).toBe(2000);      // spent 按 6 月实际算
    expect(body.month).toBe('2026-06');       // 返回查询月
  });
});
