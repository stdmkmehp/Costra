/**
 * Costra · Server · sync/pull 路由单测
 *
 * 卡号：COSTRA-154 · 事实源：dispatch §2.1 F 项 T1-T14
 *
 * BUG-COSTRA-154 v1.2 升级（2026-05-22）：
 *   T5 since 非整数 → 400（v1.0 是 since 非 ISO）
 *   T5b since 负数 → 400（v1.2 schema minimum=0）
 *   T7 since=0 → watermark=0（不再是 ISO epoch）
 *   T8 ORDER BY change_seq ASC（v1.0 是 updated_at ASC）
 *   T15-T17 改写为 BIGINT change_seq 回归
 *   T18 同行连续 UPDATE · change_seq 推进
 *   T19 同事务多 INSERT 无 change_seq 撞号（消除 v1.1 同微秒漏拉）
 *   T20 软删触发 change_seq 推进
 *
 * 覆盖：
 *   T1  GET /v1/sync/pull 未登录 → 401
 *   T2  GET /v1/sync/pull 缺 family_id → 400
 *   T3  GET /v1/sync/pull 缺 since → 400
 *   T4  GET /v1/sync/pull family_id 非 UUID → 400
 *   T5  GET /v1/sync/pull since 非整数 → 400（v1.2 升级）
 *   T5b GET /v1/sync/pull since 负数 → 400（v1.2 新增）
 *   T6  GET /v1/sync/pull family_id 越权 → 403
 *   T7  GET /v1/sync/pull since=0 无数据 → 200 watermark=0
 *   T8  GET /v1/sync/pull 写 3 entry 拉取 → ORDER BY change_seq ASC（v1.2 升级）
 *   T9  GET /v1/sync/pull limit=2 → has_more=true
 *   T10 GET /v1/sync/pull 二次拉用上次 watermark → 跟进数据
 *   T11 GET /v1/sync/pull 含软删行 → entries 含 deleted_at !== null
 *   T12 GET /v1/sync/pull 响应 100% snake_case → 0 驼峰命中
 *   T13 GET /v1/sync/pull server_version 字段映射（非 DB version）
 *   T14 GET /v1/sync/pull limit=501 边界 → 400
 *   T15 watermark BIGINT · 二次拉无重传（v1.2 回归）
 *   T16 多 entries 增量推进无重传（v1.2 回归）
 *   T17 watermark 类型契约 BIGINT · entry.change_seq 同源
 *   T18 UPDATE 触发 change_seq 推进
 *   T19 同事务多 INSERT 严格 +1 不撞号
 *   T20 软删触发 change_seq 推进
 */

import { describe, it, expect, beforeEach } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../src/app.js';
import { setWxFetchForTests } from '../src/wx/code2Session.js';

// JWT 辅助
async function login(app: FastifyInstance): Promise<{ token: string; userId: string }> {
  setWxFetchForTests(
    (async () =>
      new Response(
        JSON.stringify({ openid: 'openid-sync-pull-test', session_key: 'sk' }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      )) as unknown as typeof fetch,
  );
  const res = await app.inject({
    method: 'POST',
    url: '/v1/auth/wx-login',
    payload: { code: 'test-sync-pull' },
    headers: { 'content-type': 'application/json' },
  });
  const body = res.json() as { access_token: string; user: { id: string } };
  return { token: body.access_token, userId: body.user.id };
}

let app: FastifyInstance;
let token: string;
let userId: string;

const FAMILY_ID = '00000000-0000-0000-0000-0000000000f1';
const LEDGER_ID = '00000000-0000-0000-0000-000000000001';
const OTHER_FAMILY_ID = '00000000-0000-0000-0000-0000000000f2';
const OTHER_LEDGER_ID = '00000000-0000-0000-0000-000000000002';
const EPOCH = 0; // BUG-COSTRA-154 v1.2: 数字 0 替代 ISO epoch

beforeEach(async () => {
  app = await buildApp({ disableLogger: true });
  await app.ready();
  const loginResult = await login(app);
  token = loginResult.token;
  userId = loginResult.userId;

  // 插入测试基础数据
  const pool = (await import('../src/db/pool.js')).getPool();
  await pool.query(
    `INSERT INTO families (id, name, owner_id) VALUES ($1, 'TestFamily', $2) ON CONFLICT DO NOTHING`,
    [FAMILY_ID, userId],
  );
  await pool.query(
    `INSERT INTO ledgers (id, family_id, name) VALUES ($1, $2, 'Main') ON CONFLICT DO NOTHING`,
    [LEDGER_ID, FAMILY_ID],
  );
  await pool.query(
    `INSERT INTO family_members (family_id, user_id, role) VALUES ($1, $2, 'owner') ON CONFLICT DO NOTHING`,
    [FAMILY_ID, userId],
  );

  // 插入另一个 family（越权测试用）
  await pool.query(
    `INSERT INTO families (id, name, owner_id) VALUES ($1, 'OtherFamily', $2) ON CONFLICT DO NOTHING`,
    [OTHER_FAMILY_ID, userId],
  );
  await pool.query(
    `INSERT INTO ledgers (id, family_id, name) VALUES ($1, $2, 'Other') ON CONFLICT DO NOTHING`,
    [OTHER_LEDGER_ID, OTHER_FAMILY_ID],
  );
  // 注意：不把 user 加入 OTHER_FAMILY 的 family_members（越权测试用）
});

/** 通过 sync/push 创建 entry 的辅助函数 */
async function createEntryViaPush(
  app: FastifyInstance,
  token: string,
  overrides: Record<string, unknown> = {},
): Promise<{ server_id: string; server_version: number }> {
  const idempotencyKey = `idemp-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const res = await app.inject({
    method: 'POST',
    url: '/v1/sync/push',
    headers: {
      'content-type': 'application/json',
      authorization: `Bearer ${token}`,
      'idempotency-key': idempotencyKey,
    },
    payload: {
      ops: [{
        op: 'create',
        entity: 'entry',
        client_ref_id: `local-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        base_version: null,
        payload: {
          ledger_id: LEDGER_ID,
          amount: 10000,
          type: 'expense',
          occurred_at: '2026-05-19T10:00:00.000Z',
          ...overrides,
        },
      }],
    },
  });
  expect(res.statusCode).toBe(200);
  const body = res.json() as { results: Array<{ status: string; server_id?: string; server_version?: number }> };
  expect(body.results[0].status).toBe('ok');
  return { server_id: body.results[0].server_id!, server_version: body.results[0].server_version! };
}

describe('GET /sync/pull', () => {
  it('T1 未登录 → 401 UNAUTHENTICATED', async () => {
    const res = await app.inject({
      method: 'GET',
      url: `/v1/sync/pull?family_id=${FAMILY_ID}&since=${EPOCH}`,
    });
    expect(res.statusCode).toBe(401);
  });

  it('T2 缺 family_id → 400', async () => {
    const res = await app.inject({
      method: 'GET',
      url: `/v1/sync/pull?since=${EPOCH}`,
      headers: { authorization: `Bearer ${token}` },
    });
    expect(res.statusCode).toBe(400);
  });

  it('T3 缺 since → 400', async () => {
    const res = await app.inject({
      method: 'GET',
      url: `/v1/sync/pull?family_id=${FAMILY_ID}`,
      headers: { authorization: `Bearer ${token}` },
    });
    expect(res.statusCode).toBe(400);
  });

  it('T4 family_id 非 UUID → 400', async () => {
    const res = await app.inject({
      method: 'GET',
      url: `/v1/sync/pull?family_id=not-a-uuid&since=${EPOCH}`,
      headers: { authorization: `Bearer ${token}` },
    });
    expect(res.statusCode).toBe(400);
  });

  it('T5 since 非整数 → 400', async () => {
    const res = await app.inject({
      method: 'GET',
      url: `/v1/sync/pull?family_id=${FAMILY_ID}&since=not-a-number`,
      headers: { authorization: `Bearer ${token}` },
    });
    expect(res.statusCode).toBe(400);
  });

  it('T5b since 负数 → 400（v1.2 schema minimum=0）', async () => {
    const res = await app.inject({
      method: 'GET',
      url: `/v1/sync/pull?family_id=${FAMILY_ID}&since=-1`,
      headers: { authorization: `Bearer ${token}` },
    });
    expect(res.statusCode).toBe(400);
  });

  it('T6 family_id 越权 → 403 PERMISSION_DENIED', async () => {
    const res = await app.inject({
      method: 'GET',
      url: `/v1/sync/pull?family_id=${OTHER_FAMILY_ID}&since=${EPOCH}`,
      headers: { authorization: `Bearer ${token}` },
    });
    expect(res.statusCode).toBe(403);
    const body = res.json() as { code: string };
    expect(body.code).toBe('PERMISSION_DENIED');
  });

  it('T7 since=0 无数据 → 200 + watermark=0 + has_more=false + entries=[]', async () => {
    const res = await app.inject({
      method: 'GET',
      url: `/v1/sync/pull?family_id=${FAMILY_ID}&since=${EPOCH}`,
      headers: { authorization: `Bearer ${token}` },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { watermark: number; has_more: boolean; changes: { entries: unknown[] } };
    expect(body.watermark).toBe(EPOCH);  // since=0 · 无数据 · watermark 不变
    expect(body.has_more).toBe(false);
    expect(body.changes.entries).toEqual([]);
  });

  it('T8 写 3 entry 拉取 → ORDER BY change_seq ASC（v1.2 升级 · 不再用 updated_at）', async () => {
    // 创建 3 个 entry
    await createEntryViaPush(app, token, { amount: 1000 });
    await createEntryViaPush(app, token, { amount: 2000 });
    await createEntryViaPush(app, token, { amount: 3000 });

    const res = await app.inject({
      method: 'GET',
      url: `/v1/sync/pull?family_id=${FAMILY_ID}&since=${EPOCH}`,
      headers: { authorization: `Bearer ${token}` },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { watermark: number; has_more: boolean; changes: { entries: Array<{ amount: number; change_seq: number }> } };
    expect(body.changes.entries.length).toBe(3);
    expect(body.has_more).toBe(false);
    // v1.2：验证 change_seq ASC 顺序（严格单调 · 不会撞）
    const seqs = body.changes.entries.map(e => e.change_seq);
    for (let i = 1; i < seqs.length; i++) {
      expect(seqs[i]).toBeGreaterThan(seqs[i - 1]);  // 严格 > · 不是 ≥
    }
    // watermark 等于末位 entry 的 change_seq
    expect(body.watermark).toBe(seqs[seqs.length - 1]);
  });

  it('T9 limit=2 · 写 5 entry → has_more=true + entries.length=2', async () => {
    for (let i = 0; i < 5; i++) {
      await createEntryViaPush(app, token, { amount: (i + 1) * 1000 });
    }

    const res = await app.inject({
      method: 'GET',
      url: `/v1/sync/pull?family_id=${FAMILY_ID}&since=${EPOCH}&limit=2`,
      headers: { authorization: `Bearer ${token}` },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { watermark: string; has_more: boolean; changes: { entries: unknown[] } };
    expect(body.changes.entries.length).toBe(2);
    expect(body.has_more).toBe(true);
  });

  it('T10 二次拉用上次 watermark → 跟进数据', async () => {
    // 第一批：2 个 entry
    await createEntryViaPush(app, token, { amount: 1000 });
    await createEntryViaPush(app, token, { amount: 2000 });

    const firstRes = await app.inject({
      method: 'GET',
      url: `/v1/sync/pull?family_id=${FAMILY_ID}&since=${EPOCH}&limit=2`,
      headers: { authorization: `Bearer ${token}` },
    });
    expect(firstRes.statusCode).toBe(200);
    const firstBody = firstRes.json() as { watermark: number; has_more: boolean; changes: { entries: unknown[] } };
    const watermark1 = firstBody.watermark;

    // 再创建 3 个 entry
    await createEntryViaPush(app, token, { amount: 3000 });
    await createEntryViaPush(app, token, { amount: 4000 });
    await createEntryViaPush(app, token, { amount: 5000 });

    // 二次拉用上次 watermark
    const secondRes = await app.inject({
      method: 'GET',
      url: `/v1/sync/pull?family_id=${FAMILY_ID}&since=${watermark1}`,
      headers: { authorization: `Bearer ${token}` },
    });
    expect(secondRes.statusCode).toBe(200);
    const secondBody = secondRes.json() as { watermark: number; has_more: boolean; changes: { entries: unknown[] } };
    expect(secondBody.changes.entries.length).toBe(3);
    expect(secondBody.has_more).toBe(false);
    // watermark 单调推进（v1.2：BIGINT 数字比较）
    expect(secondBody.watermark).toBeGreaterThan(watermark1);
  });

  it('T11 含软删行 → entries 含 deleted_at !== null（协议 §3.5）', async () => {
    // 先创建 entry
    const { server_id, server_version } = await createEntryViaPush(app, token, { amount: 5000 });

    // 软删该 entry（sync/push delete 用 client_ref_id 作为 entry id）
    const delRes = await app.inject({
      method: 'POST',
      url: '/v1/sync/push',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${token}`,
        'idempotency-key': `idemp-del-${Date.now()}`,
      },
      payload: {
        ops: [{
          op: 'delete',
          entity: 'entry',
          client_ref_id: server_id,
          base_version: server_version,
          payload: {},
        }],
      },
    });
    expect(delRes.statusCode).toBe(200);
    const delBody = delRes.json() as { results: Array<{ status: string }> };
    expect(delBody.results[0].status).toBe('ok');

    // 拉取应含软删行
    const pullRes = await app.inject({
      method: 'GET',
      url: `/v1/sync/pull?family_id=${FAMILY_ID}&since=${EPOCH}`,
      headers: { authorization: `Bearer ${token}` },
    });
    expect(pullRes.statusCode).toBe(200);
    const pullBody = pullRes.json() as { changes: { entries: Array<{ deleted_at: string | null }> } };
    const deletedEntry = pullBody.changes.entries.find(e => e.deleted_at !== null);
    expect(deletedEntry).toBeDefined();
    expect(deletedEntry!.deleted_at).not.toBeNull();
  });

  it('T12 响应 100% snake_case → 0 驼峰命中', async () => {
    await createEntryViaPush(app, token, { amount: 1234 });

    const res = await app.inject({
      method: 'GET',
      url: `/v1/sync/pull?family_id=${FAMILY_ID}&since=${EPOCH}`,
      headers: { authorization: `Bearer ${token}` },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { changes: { entries: Array<Record<string, unknown>> } };
    expect(body.changes.entries.length).toBeGreaterThan(0);

    const entry = body.changes.entries[0];
    const keys = Object.keys(entry);
    // 驼峰模式：含大写字母的 key
    const camelCaseKeys = keys.filter(k => /[a-z][A-Z]/.test(k));
    expect(camelCaseKeys).toEqual([]);
  });

  it('T13 server_version 字段映射（非 DB 列名 version）', async () => {
    await createEntryViaPush(app, token, { amount: 5678 });

    const res = await app.inject({
      method: 'GET',
      url: `/v1/sync/pull?family_id=${FAMILY_ID}&since=${EPOCH}`,
      headers: { authorization: `Bearer ${token}` },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { changes: { entries: Array<Record<string, unknown>> } };
    const entry = body.changes.entries[0];
    // 应有 server_version 字段，不应有 version 字段
    expect(entry).toHaveProperty('server_version');
    expect(entry).not.toHaveProperty('version');
    expect(typeof entry.server_version).toBe('number');
  });

  it('T14 limit=501 边界 → 400（schema 上限 500）', async () => {
    const res = await app.inject({
      method: 'GET',
      url: `/v1/sync/pull?family_id=${FAMILY_ID}&since=${EPOCH}&limit=501`,
      headers: { authorization: `Bearer ${token}` },
    });
    expect(res.statusCode).toBe(400);
  });

  // ─── BUG-COSTRA-154-WATERMARK-PRECISION 回归（v1.2 选项 B 升级 · 2026-05-22）─────
  // 历史 BUG（v1.0）：syncPullService 用 Date.getTime() + new Date(ms).toISOString()
  //                  双重经过 JS Date · 截断微秒精度 → watermark 永远 .921Z（毫秒）
  //                  → server SQL `WHERE updated_at > '.921'` · 921137 > 921000 = TRUE
  //                  → 同一条 entry 每次 pull 重传 · pulled=1 永远不变
  // v1.1 修复（仅微秒精度 ISO）：消除 99.9% 重传场景 · 但残留 3 类风险（同微秒并发 / NTP 回拨 / 主从切换）
  // v1.2 彻底修复：watermark 改用 BIGINT change_seq · PG SEQUENCE 严格单调 · 不依赖时钟
  //                T15-T20 改写 + 新增 · 详见 qa/defects/2026-05-22-COSTRA-154-*.md §11

  it('T15 watermark 是 BIGINT 整数 · 二次拉 since=watermark → entries=[]（BUG-154 v1.2 回归）', async () => {
    // 通过 sync/push 创建 entry · server 端 trigger/DEFAULT 自动分配 change_seq
    const { server_id } = await createEntryViaPush(app, token, { amount: 1234, note: 'v1.2-test' });
    expect(server_id).toBeTruthy();

    // 第一次 pull · since=0 → 拿到 watermark
    const r1 = await app.inject({
      method: 'GET',
      url: `/v1/sync/pull?family_id=${FAMILY_ID}&since=${EPOCH}`,
      headers: { authorization: `Bearer ${token}` },
    });
    expect(r1.statusCode).toBe(200);
    const b1 = r1.json() as { watermark: number; changes: { entries: Array<{ change_seq: number; updated_at: string }> } };
    expect(b1.changes.entries.length).toBe(1);

    // v1.2 关键断言：watermark 是 number 类型整数 · 不再是 ISO 字符串
    expect(typeof b1.watermark).toBe('number');
    expect(Number.isInteger(b1.watermark)).toBe(true);
    expect(b1.watermark).toBeGreaterThan(0);

    // entry 含 change_seq 字段
    expect(typeof b1.changes.entries[0].change_seq).toBe('number');
    expect(b1.changes.entries[0].change_seq).toBe(b1.watermark);

    // 第二次 pull · since=watermark → 期望 entries=[]（不重传）+ watermark 不变
    const r2 = await app.inject({
      method: 'GET',
      url: `/v1/sync/pull?family_id=${FAMILY_ID}&since=${b1.watermark}`,
      headers: { authorization: `Bearer ${token}` },
    });
    expect(r2.statusCode).toBe(200);
    const b2 = r2.json() as { watermark: number; changes: { entries: unknown[] } };
    expect(b2.changes.entries.length).toBe(0);  // ← v1.0 此处 FAIL（实际为 1 · 因毫秒截断）
    expect(b2.watermark).toBe(b1.watermark);    // 不推进
  });

  it('T16 多 entries 独立 watermark · 增量推进 · 各次 pull 不重传（BUG-154 v1.2 回归）', async () => {
    // 写 3 条 · 每条 change_seq 严格 +1
    await createEntryViaPush(app, token, { amount: 1000 });
    await createEntryViaPush(app, token, { amount: 2000 });
    await createEntryViaPush(app, token, { amount: 3000 });

    // 第 1 次：limit=1 → 拿到 1 条 + has_more=true + watermark1
    const r1 = await app.inject({
      method: 'GET',
      url: `/v1/sync/pull?family_id=${FAMILY_ID}&since=${EPOCH}&limit=1`,
      headers: { authorization: `Bearer ${token}` },
    });
    const b1 = r1.json() as { watermark: number; has_more: boolean; changes: { entries: Array<{ amount: number; change_seq: number }> } };
    expect(b1.changes.entries.length).toBe(1);
    expect(b1.has_more).toBe(true);
    expect(typeof b1.watermark).toBe('number');

    // 第 2 次：since=watermark1 → 拿剩余 2 条 + watermark2
    const r2 = await app.inject({
      method: 'GET',
      url: `/v1/sync/pull?family_id=${FAMILY_ID}&since=${b1.watermark}`,
      headers: { authorization: `Bearer ${token}` },
    });
    const b2 = r2.json() as { watermark: number; has_more: boolean; changes: { entries: unknown[] } };
    expect(b2.changes.entries.length).toBe(2);  // v1.0 可能 = 3（重传第 1 条）
    expect(b2.watermark).toBeGreaterThan(b1.watermark);  // BIGINT 数字比较

    // 第 3 次：since=watermark2 → 期望 entries=[]
    const r3 = await app.inject({
      method: 'GET',
      url: `/v1/sync/pull?family_id=${FAMILY_ID}&since=${b2.watermark}`,
      headers: { authorization: `Bearer ${token}` },
    });
    const b3 = r3.json() as { watermark: number; changes: { entries: unknown[] } };
    expect(b3.changes.entries.length).toBe(0);
    expect(b3.watermark).toBe(b2.watermark);  // 不推进
  });

  it('T17 watermark 类型契约 · BIGINT 整数 · entry.change_seq 同源（协议 §6.3 v1.2）', async () => {
    await createEntryViaPush(app, token, { amount: 9999 });
    const r = await app.inject({
      method: 'GET',
      url: `/v1/sync/pull?family_id=${FAMILY_ID}&since=${EPOCH}`,
      headers: { authorization: `Bearer ${token}` },
    });
    const b = r.json() as {
      watermark: number;
      changes: { entries: Array<{ change_seq: number; updated_at: string; created_at: string }> };
    };

    // watermark：必须 BIGINT 整数（v1.2 协议）
    expect(typeof b.watermark).toBe('number');
    expect(Number.isInteger(b.watermark)).toBe(true);
    expect(b.watermark).toBeGreaterThan(0);

    // entry.change_seq：必须存在 + 等于 watermark（单条场景）
    const e = b.changes.entries[0];
    expect(typeof e.change_seq).toBe('number');
    expect(e.change_seq).toBe(b.watermark);

    // entry.updated_at：v1.2 降级为毫秒精度（不再要求微秒 · 仅展示用）
    expect(e.updated_at).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
    expect(e.created_at).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
  });

  // ─── BUG-COSTRA-154 v1.2 新增回归（彻底消除 §3.5 残余风险）─────────────────────
  // 这些场景在 v1.0 (毫秒) 和 v1.1 (微秒) 都会失败 · 仅 v1.2 (change_seq) 能 PASS

  it('T18 同一行连续 UPDATE · change_seq 严格推进 · client 增量收到改动', async () => {
    // 1. INSERT 一条 entry · 拿初始 change_seq
    const { server_id, server_version } = await createEntryViaPush(app, token, { amount: 1000 });
    expect(server_id).toBeTruthy();

    const r1 = await app.inject({
      method: 'GET',
      url: `/v1/sync/pull?family_id=${FAMILY_ID}&since=${EPOCH}`,
      headers: { authorization: `Bearer ${token}` },
    });
    const b1 = r1.json() as { watermark: number; changes: { entries: Array<{ id: string; change_seq: number; amount: number }> } };
    expect(b1.changes.entries.length).toBe(1);
    const seq1 = b1.changes.entries[0].change_seq;
    const watermark1 = b1.watermark;
    expect(seq1).toBe(watermark1);

    // 2. UPDATE 同一条 entry · 通过 sync/push update op
    const updateRes = await app.inject({
      method: 'POST',
      url: '/v1/sync/push',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${token}`,
        'idempotency-key': `idemp-update-${Date.now()}`,
      },
      payload: {
        ops: [{
          op: 'update',
          entity: 'entry',
          client_ref_id: server_id,
          base_version: server_version,
          payload: { amount: 9999 },
        }],
      },
    });
    expect(updateRes.statusCode).toBe(200);
    expect((updateRes.json() as { results: Array<{ status: string }> }).results[0].status).toBe('ok');

    // 3. 二次 pull · since=watermark1 → 必须能收到 UPDATE 改动（v1.2 trigger 自动刷 change_seq）
    const r2 = await app.inject({
      method: 'GET',
      url: `/v1/sync/pull?family_id=${FAMILY_ID}&since=${watermark1}`,
      headers: { authorization: `Bearer ${token}` },
    });
    const b2 = r2.json() as { watermark: number; changes: { entries: Array<{ id: string; change_seq: number; amount: number }> } };
    expect(b2.changes.entries.length).toBe(1);  // 改动行被增量返
    expect(b2.changes.entries[0].id).toBe(server_id);
    expect(b2.changes.entries[0].amount).toBe(9999);
    expect(b2.changes.entries[0].change_seq).toBeGreaterThan(seq1);  // change_seq 推进
    expect(b2.watermark).toBeGreaterThan(watermark1);
  });

  it('T19 同事务多 INSERT 各自不同 change_seq（消除 v1.1 同微秒漏拉风险）', async () => {
    // pg-mem 对 now() 在同一 query 中可能返回相同微秒值（v1.1 触发漏拉路径）
    // v1.2：每次 INSERT 独立 nextval('entries_change_seq') · 严格 +1 · 不会撞
    // 用直接 INSERT（绕过 sync/push）模拟同事务多写
    const pool = (await import('../src/db/pool.js')).getPool();
    await pool.query(
      `INSERT INTO entries (id, ledger_id, amount, type, occurred_at, created_by, client_ref_id)
       VALUES
       ('019e4ea0-0000-0001-aaaa-000000000001', $1, 100, 'expense', '2026-05-22T10:00:00.000Z', $2, 'micro-1'),
       ('019e4ea0-0000-0002-aaaa-000000000002', $1, 200, 'expense', '2026-05-22T10:00:00.000Z', $2, 'micro-2'),
       ('019e4ea0-0000-0003-aaaa-000000000003', $1, 300, 'expense', '2026-05-22T10:00:00.000Z', $2, 'micro-3')`,
      [LEDGER_ID, userId],
    );

    const r = await app.inject({
      method: 'GET',
      url: `/v1/sync/pull?family_id=${FAMILY_ID}&since=${EPOCH}`,
      headers: { authorization: `Bearer ${token}` },
    });
    const b = r.json() as { watermark: number; changes: { entries: Array<{ change_seq: number }> } };
    expect(b.changes.entries.length).toBe(3);

    // 关键：3 条 entry 的 change_seq 严格 ASC + 严格不等（无撞号）
    const seqs = b.changes.entries.map(e => e.change_seq);
    for (let i = 1; i < seqs.length; i++) {
      expect(seqs[i]).toBeGreaterThan(seqs[i - 1]);  // 严格 > · v1.1 此处可能撞同微秒
    }

    // 二次 pull · 必须 entries=[]（v1.1 同微秒场景会重传末尾几条）
    const r2 = await app.inject({
      method: 'GET',
      url: `/v1/sync/pull?family_id=${FAMILY_ID}&since=${b.watermark}`,
      headers: { authorization: `Bearer ${token}` },
    });
    const b2 = r2.json() as { changes: { entries: unknown[] } };
    expect(b2.changes.entries.length).toBe(0);
  });

  it('T20 软删触发 change_seq 推进 · client 增量收到 deleted_at（协议 §3.5）', async () => {
    const { server_id, server_version } = await createEntryViaPush(app, token, { amount: 5000 });

    const r1 = await app.inject({
      method: 'GET',
      url: `/v1/sync/pull?family_id=${FAMILY_ID}&since=${EPOCH}`,
      headers: { authorization: `Bearer ${token}` },
    });
    const b1 = r1.json() as { watermark: number };
    const watermark1 = b1.watermark;

    // 软删
    const delRes = await app.inject({
      method: 'POST',
      url: '/v1/sync/push',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${token}`,
        'idempotency-key': `idemp-del-${Date.now()}`,
      },
      payload: {
        ops: [{ op: 'delete', entity: 'entry', client_ref_id: server_id, base_version: server_version, payload: {} }],
      },
    });
    expect(delRes.statusCode).toBe(200);

    // 二次 pull · 必须收到软删行（deleted_at !== null）+ change_seq 推进
    const r2 = await app.inject({
      method: 'GET',
      url: `/v1/sync/pull?family_id=${FAMILY_ID}&since=${watermark1}`,
      headers: { authorization: `Bearer ${token}` },
    });
    const b2 = r2.json() as { watermark: number; changes: { entries: Array<{ id: string; change_seq: number; deleted_at: string | null }> } };
    expect(b2.changes.entries.length).toBe(1);
    expect(b2.changes.entries[0].id).toBe(server_id);
    expect(b2.changes.entries[0].deleted_at).not.toBeNull();
    expect(b2.changes.entries[0].change_seq).toBeGreaterThan(watermark1);
    expect(b2.watermark).toBeGreaterThan(watermark1);
  });
});
