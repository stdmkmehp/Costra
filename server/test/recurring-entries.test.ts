/**
 * Costra · Server · recurring-entries 端到端测试
 *
 * 卡号占位：COSTRA-5xx（T2 · Sprint-4 · Epic-E）
 * 事实源：
 *   - server/db/migrations/0011_recurring_entries.sql
 *   - server/src/routes/recurring.ts
 *   - docs/design/recurring-entry-task-breakdown.md T2 §2.6 DoD
 *
 * 覆盖：
 *   - CRUD 8 endpoint
 *   - 权限 404（跨用户越权）
 *   - 校验 400（各字段边界）
 *   - 乐观锁 409
 *   - 端到端 scheduler.tickOnce：POST 创建 → 时间 mock → tick → 断言 entries 表 + next_run_at
 *   - 补齐 loop 场景 A / B
 *   - 幂等（同一 next_run_at 两次 tick 只生成一条）
 *   - 跨月 12 天规则一次生成 12 条
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../src/app.js';
import { setWxFetchForTests } from '../src/wx/code2Session.js';
import { getPool } from '../src/db/pool.js';

// ==============================================================================
// helpers
// ==============================================================================

async function login(app: FastifyInstance, openid = 'openid-recur-test'): Promise<{
  token: string;
  userId: string;
}> {
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
    payload: { code: `test-${openid}` },
    headers: { 'content-type': 'application/json' },
  });
  const body = res.json() as { access_token: string };
  const parts = body.access_token.split('.');
  const payload = JSON.parse(Buffer.from(parts[1], 'base64').toString()) as { sub: string };
  return { token: body.access_token, userId: payload.sub };
}

async function setupFamilyAndLedger(userId: string, opts: {
  familyId: string;
  ledgerId: string;
} = { familyId: '00000000-0000-0000-0000-0000000000f1', ledgerId: '00000000-0000-0000-0000-000000000001' }) {
  const pool = getPool();
  await pool.query(
    `INSERT INTO families (id, name, owner_id, kind) VALUES ($1, 'F', $2, 'shared')`,
    [opts.familyId, userId],
  );
  await pool.query(
    `INSERT INTO ledgers (id, family_id, name) VALUES ($1, $2, 'Main')`,
    [opts.ledgerId, opts.familyId],
  );
  await pool.query(
    `INSERT INTO family_members (family_id, user_id, role) VALUES ($1, $2, 'owner')`,
    [opts.familyId, userId],
  );
  return opts;
}

function authHeader(token: string) {
  return { authorization: `Bearer ${token}`, 'content-type': 'application/json' };
}

/** 用于不带 body 的 POST / DELETE 请求（pause/resume/copy/delete）· 不设 content-type */
function authHeaderNoBody(token: string) {
  return { authorization: `Bearer ${token}` };
}

const LEDGER_ID = '00000000-0000-0000-0000-000000000001';

// ==============================================================================
// CRUD basics
// ==============================================================================

describe('recurring-entries · CRUD basics', () => {
  let app: FastifyInstance;
  let token: string;
  let userId: string;

  beforeEach(async () => {
    app = await buildApp({ disableLogger: true, autoStartScheduler: false });
    await app.ready();
    const login1 = await login(app);
    token = login1.token;
    userId = login1.userId;
    await setupFamilyAndLedger(userId);
  });

  it('POST /recurring-entries · weekly Mon+Wed+Fri · morning · 201 + fields', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/v1/recurring-entries',
      headers: authHeader(token),
      payload: {
        ledger_id: LEDGER_ID,
        type: 'expense',
        amount: 20000,
        shared_type: 'personal',
        note: '打车',
        period: 'weekly',
        days_of_week: [1, 3, 5],
        execute_bucket: 'morning',
        start_date: '2026-08-01',
      },
    });
    expect(res.statusCode).toBe(201);
    const body = res.json() as Record<string, unknown>;
    expect(body.id).toMatch(/^[0-9a-f]{8}-/);
    expect(body.created_by).toBe(userId);
    expect(body.period).toBe('weekly');
    expect(body.days_of_week).toEqual([1, 3, 5]);
    expect(body.execute_bucket).toBe('morning');
    // execute_hour/minute 应在窗口内缩范围内
    const total = (body.execute_hour as number) * 60 + (body.execute_minute as number);
    expect(total).toBeGreaterThanOrEqual(6 * 60 + 30);
    expect(total).toBeLessThan(12 * 60 - 30);
    expect(body.status).toBe('active');
    expect(body.next_run_at).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(body.version).toBe(1);
  });

  it('POST · yearly · 12 cross-month (每月同号)', async () => {
    const ymd = [101, 202, 303, 404, 505, 606, 707, 808, 909, 1010, 1111, 1212];
    const res = await app.inject({
      method: 'POST',
      url: '/v1/recurring-entries',
      headers: authHeader(token),
      payload: {
        ledger_id: LEDGER_ID,
        type: 'expense',
        amount: 10000,
        shared_type: 'personal',
        period: 'yearly',
        year_month_days: ymd,
        execute_bucket: 'dawn',
        start_date: '2026-01-01',
      },
    });
    expect(res.statusCode).toBe(201);
    const body = res.json() as Record<string, unknown>;
    expect(body.year_month_days).toEqual(ymd);
  });

  it('POST · yearly · monthly-family with invalid Feb 30 → 400', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/v1/recurring-entries',
      headers: authHeader(token),
      payload: {
        ledger_id: LEDGER_ID,
        type: 'expense',
        amount: 10000,
        shared_type: 'personal',
        period: 'yearly',
        year_month_days: [230], // Feb 30 invalid
        execute_bucket: 'dawn',
        start_date: '2026-01-01',
      },
    });
    expect(res.statusCode).toBe(400);
  });

  it('POST · duplicates in days_of_week → 400', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/v1/recurring-entries',
      headers: authHeader(token),
      payload: {
        ledger_id: LEDGER_ID,
        type: 'expense',
        amount: 100,
        shared_type: 'personal',
        period: 'weekly',
        days_of_week: [1, 1, 3],
        execute_bucket: 'morning',
        start_date: '2026-08-01',
      },
    });
    expect(res.statusCode).toBe(400);
  });

  it('POST · end_date = start_date · 同日生效（规则只跑一天）· 201', async () => {
    // 语义：起始日 0 点生效、结束日 23:59:59 截止，闭区间允许同一天
    // 用未来日期确保 next_run_at 落在 [start_date, end_date] 闭区间内
    // 2027-08-05 是周四，选 days_of_week=[4]
    const res = await app.inject({
      method: 'POST',
      url: '/v1/recurring-entries',
      headers: authHeader(token),
      payload: {
        ledger_id: LEDGER_ID,
        type: 'expense',
        amount: 100,
        shared_type: 'personal',
        period: 'weekly',
        days_of_week: [4],
        execute_bucket: 'morning',
        start_date: '2027-08-05',
        end_date: '2027-08-05',
      },
    });
    expect(res.statusCode).toBe(201);
    const body = res.json() as Record<string, unknown>;
    expect(body.start_date).toBe('2027-08-05');
    expect(body.end_date).toBe('2027-08-05');
    expect(body.status).toBe('active');
  });

  it('POST · end_date = start_date · 首个匹配日已超 end_date 但尚未到期 → 201 + ended + last_run_status=lapsed_in_window', async () => {
    // 回归：bug 截图场景——start_date=end_date=2027-08-05（周四），选周六（days_of_week=[6]）
    // 首个匹配日 2027-08-07 21:00 > end_date 23:59:59 → 历史会 throw BUSINESS_RULE_VIOLATION
    // 修复后：不再 throw；且因 end_date（2027-08-05）尚未真正到期，last_run_status 标记为
    // 'lapsed_in_window'（窗口内已无有效执行点），供列表页展示"已失效"而非"已到期"。
    const res = await app.inject({
      method: 'POST',
      url: '/v1/recurring-entries',
      headers: authHeader(token),
      payload: {
        ledger_id: LEDGER_ID,
        type: 'expense',
        amount: 100,
        shared_type: 'personal',
        period: 'weekly',
        days_of_week: [6], // 周六
        execute_bucket: 'night',
        start_date: '2027-08-05', // 周四
        end_date: '2027-08-05',
      },
    });
    expect(res.statusCode).toBe(201);
    const body = res.json() as Record<string, unknown>;
    expect(body.status).toBe('ended');
    expect(body.last_run_status).toBe('lapsed_in_window');
    expect(body.end_date).toBe('2027-08-05');
  });

  it('POST · end_date 在首个匹配日之前（但 > start_date）且尚未到期 → 201 + ended + last_run_status=lapsed_in_window', async () => {
    // 进一步回归：start_date=2027-08-05（周四），end_date=2027-08-06（周五），选周六
    // 首个匹配日 2027-08-07 > end_date 2027-08-06 23:59:59 → 因 end_date 尚未到期，
    // last_run_status='lapsed_in_window'（区别于真正到期的 ended_by_end_date）。
    const res = await app.inject({
      method: 'POST',
      url: '/v1/recurring-entries',
      headers: authHeader(token),
      payload: {
        ledger_id: LEDGER_ID,
        type: 'expense',
        amount: 100,
        shared_type: 'personal',
        period: 'weekly',
        days_of_week: [6], // 周六
        execute_bucket: 'morning',
        start_date: '2027-08-05', // 周四
        end_date: '2027-08-06', // 周五
      },
    });
    expect(res.statusCode).toBe(201);
    const body = res.json() as Record<string, unknown>;
    expect(body.status).toBe('ended');
    expect(body.last_run_status).toBe('lapsed_in_window');
  });

  it('POST · end_date < start_date · 早于起始日 → 400', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/v1/recurring-entries',
      headers: authHeader(token),
      payload: {
        ledger_id: LEDGER_ID,
        type: 'expense',
        amount: 100,
        shared_type: 'personal',
        period: 'weekly',
        days_of_week: [4],
        execute_bucket: 'morning',
        start_date: '2027-08-10',
        end_date: '2027-08-05',
      },
    });
    expect(res.statusCode).toBe(400);
  });

  it('POST · shared_type on income → 422 BUSINESS_RULE_VIOLATION', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/v1/recurring-entries',
      headers: authHeader(token),
      payload: {
        ledger_id: LEDGER_ID,
        type: 'income',
        amount: 100,
        shared_type: 'personal',
        period: 'weekly',
        days_of_week: [1],
        execute_bucket: 'morning',
        start_date: '2026-08-01',
      },
    });
    expect(res.statusCode).toBe(422);
  });

  it('GET list · status=all default · includes new rule', async () => {
    const createRes = await app.inject({
      method: 'POST',
      url: '/v1/recurring-entries',
      headers: authHeader(token),
      payload: {
        ledger_id: LEDGER_ID,
        type: 'expense',
        amount: 100,
        shared_type: 'personal',
        period: 'weekly',
        days_of_week: [1],
        execute_bucket: 'morning',
        start_date: '2026-08-01',
      },
    });
    const created = createRes.json() as { id: string };

    const listRes = await app.inject({
      method: 'GET',
      url: '/v1/recurring-entries',
      headers: authHeader(token),
    });
    expect(listRes.statusCode).toBe(200);
    const body = listRes.json() as { items: Array<{ id: string }> };
    expect(body.items.some((i) => i.id === created.id)).toBe(true);
  });

  it('GET /:id · other user rule → 404 (not 403)', async () => {
    // 用户 A 创建
    const createRes = await app.inject({
      method: 'POST',
      url: '/v1/recurring-entries',
      headers: authHeader(token),
      payload: {
        ledger_id: LEDGER_ID,
        type: 'expense',
        amount: 100,
        shared_type: 'personal',
        period: 'weekly',
        days_of_week: [1],
        execute_bucket: 'morning',
        start_date: '2026-08-01',
      },
    });
    const created = createRes.json() as { id: string };

    // 用户 B 登录
    const loginB = await login(app, 'openid-other-user');
    // 用户 B 也需加入 family_members 才能通过 assertUserOwnsLedger（虽然本用例是 GET，不 create）
    // 但 GET 走 findByIdForUser 直接 WHERE created_by · 匹配不上返 404

    const getRes = await app.inject({
      method: 'GET',
      url: `/v1/recurring-entries/${created.id}`,
      headers: authHeader(loginB.token),
    });
    expect(getRes.statusCode).toBe(404);
  });

  it('PATCH · optimistic lock · wrong version → 409', async () => {
    const createRes = await app.inject({
      method: 'POST',
      url: '/v1/recurring-entries',
      headers: authHeader(token),
      payload: {
        ledger_id: LEDGER_ID,
        type: 'expense',
        amount: 100,
        shared_type: 'personal',
        period: 'weekly',
        days_of_week: [1],
        execute_bucket: 'morning',
        start_date: '2026-08-01',
      },
    });
    const created = createRes.json() as { id: string; version: number };

    const patchRes = await app.inject({
      method: 'PATCH',
      url: `/v1/recurring-entries/${created.id}`,
      headers: authHeader(token),
      payload: { version: 999, amount: 200 },
    });
    expect(patchRes.statusCode).toBe(409);
  });

  it('POST pause + resume · resume 后 next_run_at 应更新', async () => {
    const createRes = await app.inject({
      method: 'POST',
      url: '/v1/recurring-entries',
      headers: authHeader(token),
      payload: {
        ledger_id: LEDGER_ID,
        type: 'expense',
        amount: 100,
        shared_type: 'personal',
        period: 'weekly',
        days_of_week: [1],
        execute_bucket: 'morning',
        start_date: '2026-08-01',
      },
    });
    const created = createRes.json() as { id: string; next_run_at: string };

    const pauseRes = await app.inject({
      method: 'POST',
      url: `/v1/recurring-entries/${created.id}/pause`,
      headers: authHeaderNoBody(token),
    });
    expect(pauseRes.statusCode).toBe(200);
    expect((pauseRes.json() as { status: string }).status).toBe('paused');

    const resumeRes = await app.inject({
      method: 'POST',
      url: `/v1/recurring-entries/${created.id}/resume`,
      headers: authHeaderNoBody(token),
    });
    expect(resumeRes.statusCode).toBe(200);
    const resumed = resumeRes.json() as { status: string; next_run_at: string };
    expect(resumed.status).toBe('active');
    // 恢复后从 now 起算，next_run_at 应 >= now
    expect(new Date(resumed.next_run_at).getTime()).toBeGreaterThan(Date.now() - 60_000);
  });

  it('POST /copy · id 不同 · 其它字段一致（除 start_date + end_date）', async () => {
    const createRes = await app.inject({
      method: 'POST',
      url: '/v1/recurring-entries',
      headers: authHeader(token),
      payload: {
        ledger_id: LEDGER_ID,
        type: 'expense',
        amount: 200,
        shared_type: 'personal',
        note: '外卖',
        period: 'weekly',
        period_interval: 2,
        days_of_week: [1, 3, 5],
        execute_bucket: 'morning',
        start_date: '2026-08-01',
      },
    });
    const original = createRes.json() as Record<string, unknown>;

    const copyRes = await app.inject({
      method: 'POST',
      url: `/v1/recurring-entries/${original.id as string}/copy`,
      headers: authHeaderNoBody(token),
    });
    expect(copyRes.statusCode).toBe(201);
    const copy = copyRes.json() as Record<string, unknown>;
    expect(copy.id).not.toBe(original.id);
    expect(copy.amount).toBe(original.amount);
    expect(copy.note).toBe(original.note);
    expect(copy.days_of_week).toEqual(original.days_of_week);
    expect(copy.period_interval).toBe(2);
    expect(copy.end_date).toBe(null);
  });

  it('DELETE · 软删 · 版本冲突 → 409', async () => {
    const createRes = await app.inject({
      method: 'POST',
      url: '/v1/recurring-entries',
      headers: authHeader(token),
      payload: {
        ledger_id: LEDGER_ID,
        type: 'expense',
        amount: 100,
        shared_type: 'personal',
        period: 'weekly',
        days_of_week: [1],
        execute_bucket: 'morning',
        start_date: '2026-08-01',
      },
    });
    const created = createRes.json() as { id: string };

    // 错版本
    const delWrong = await app.inject({
      method: 'DELETE',
      url: `/v1/recurring-entries/${created.id}?version=999`,
      headers: authHeaderNoBody(token),
    });
    expect(delWrong.statusCode).toBe(409);

    // 正确版本
    const delOk = await app.inject({
      method: 'DELETE',
      url: `/v1/recurring-entries/${created.id}?version=1`,
      headers: authHeaderNoBody(token),
    });
    expect(delOk.statusCode).toBe(204);

    // 再查 → 404
    const getRes = await app.inject({
      method: 'GET',
      url: `/v1/recurring-entries/${created.id}`,
      headers: authHeader(token),
    });
    expect(getRes.statusCode).toBe(404);
  });

  it('POST · unauthenticated → 401', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/v1/recurring-entries',
      payload: {
        ledger_id: LEDGER_ID,
        type: 'expense',
        amount: 100,
        shared_type: 'personal',
        period: 'weekly',
        days_of_week: [1],
        execute_bucket: 'morning',
        start_date: '2026-08-01',
      },
    });
    expect(res.statusCode).toBe(401);
  });

  it('POST · ledger not owned by user → 403', async () => {
    const loginB = await login(app, 'openid-user-b');
    // B 不是家庭成员
    const res = await app.inject({
      method: 'POST',
      url: '/v1/recurring-entries',
      headers: authHeader(loginB.token),
      payload: {
        ledger_id: LEDGER_ID,
        type: 'expense',
        amount: 100,
        shared_type: 'personal',
        period: 'weekly',
        days_of_week: [1],
        execute_bucket: 'morning',
        start_date: '2026-08-01',
      },
    });
    expect(res.statusCode).toBe(403);
  });

  it('POST · 达到单用户规则上限（32）→ 422', async () => {
    // 先批量插入 32 条规则（直接写库 · 跳过 API 循环）
    const pool = getPool();
    for (let i = 0; i < 32; i++) {
      await pool.query(
        `INSERT INTO recurring_rules (
           id, ledger_id, created_by, type, amount, currency,
           category_id, account_id, to_account_id, note, shared_type,
           period, days_of_week, days_of_month, year_month_days,
           execute_bucket, execute_hour, execute_minute, timezone,
           start_date, end_date, next_run_at, status, consecutive_failures, version
         ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,$25)`,
        [
          `00000000-0000-0000-0000-${String(i).padStart(12, '0')}`,
          LEDGER_ID,
          userId,
          'expense',
          100,
          'CNY',
          null, null, null, null, null,
          'weekly',
          [1],
          null,
          null,
          'morning',
          9,
          30,
          'Asia/Shanghai',
          '2026-08-01',
          null,
          new Date(Date.now() + 86400000),
          'active',
          0,
          0,
        ],
      );
    }

    // 第 33 条 → 422
    const res = await app.inject({
      method: 'POST',
      url: '/v1/recurring-entries',
      headers: authHeader(token),
      payload: {
        ledger_id: LEDGER_ID,
        type: 'expense',
        amount: 100,
        shared_type: 'personal',
        period: 'weekly',
        days_of_week: [1],
        execute_bucket: 'morning',
        start_date: '2026-08-01',
      },
    });
    expect(res.statusCode).toBe(422);
    const body = res.json() as { code: string };
    expect(body.code).toBe('BUSINESS_RULE_VIOLATION');
  });

  it('POST /copy · 达到规则上限 → 422', async () => {
    // 先创建 1 条再复制 31 次 → 共 32 条
    const createRes = await app.inject({
      method: 'POST',
      url: '/v1/recurring-entries',
      headers: authHeader(token),
      payload: {
        ledger_id: LEDGER_ID,
        type: 'expense',
        amount: 100,
        shared_type: 'personal',
        period: 'weekly',
        days_of_week: [1],
        execute_bucket: 'morning',
        start_date: '2026-08-01',
      },
    });
    expect(createRes.statusCode).toBe(201);
    const original = createRes.json() as { id: string };

    // 复制 31 次 → 累计 32 条
    for (let i = 0; i < 31; i++) {
      const r = await app.inject({
        method: 'POST',
        url: `/v1/recurring-entries/${original.id}/copy`,
        headers: authHeaderNoBody(token),
      });
      expect(r.statusCode).toBe(201);
    }

    // 第 33 条（复制）→ 422
    const overRes = await app.inject({
      method: 'POST',
      url: `/v1/recurring-entries/${original.id}/copy`,
      headers: authHeaderNoBody(token),
    });
    expect(overRes.statusCode).toBe(422);
    const body = overRes.json() as { code: string };
    expect(body.code).toBe('BUSINESS_RULE_VIOLATION');
  });
});

// ==============================================================================
// scheduler tick + 补齐 loop
// ==============================================================================

describe('recurring-entries · scheduler tick', () => {
  let app: FastifyInstance;
  let token: string;
  let userId: string;

  beforeEach(async () => {
    app = await buildApp({ disableLogger: true, autoStartScheduler: false });
    await app.ready();
    const login1 = await login(app);
    token = login1.token;
    userId = login1.userId;
    await setupFamilyAndLedger(userId);
  });

  it('E2E · weekly rule · tickOnce past next_run_at → 1 entry generated', async () => {
    // 创建规则 · start_date 是过去 · execute_bucket=morning
    const createRes = await app.inject({
      method: 'POST',
      url: '/v1/recurring-entries',
      headers: authHeader(token),
      payload: {
        ledger_id: LEDGER_ID,
        type: 'expense',
        amount: 500,
        shared_type: 'personal',
        note: '打车',
        period: 'weekly',
        days_of_week: [1, 3, 5], // Mon+Wed+Fri
        execute_bucket: 'morning',
        start_date: '2026-08-01', // 2026-08-01 是周六
      },
    });
    const rule = createRes.json() as {
      id: string;
      next_run_at: string;
      execute_hour: number;
      execute_minute: number;
      timezone: string;
    };

    // 直接把 nextRunAt 拉到过去 · 精确对齐周一 execute time
    const pool = getPool();
    const { DateTime } = await import('luxon');
    const pastNextRun = DateTime.fromObject(
      {
        year: 2026,
        month: 8,
        day: 3, // Monday
        hour: rule.execute_hour,
        minute: rule.execute_minute,
      },
      { zone: rule.timezone },
    ).toJSDate();
    await pool.query(
      `UPDATE recurring_rules SET next_run_at = $1 WHERE id = $2`,
      [pastNextRun, rule.id],
    );

    // 用 tickOnce 直接触发 · now = 周一 当天更晚一些
    const scheduler = app.recurringScheduler!;
    const now = DateTime.fromObject(
      { year: 2026, month: 8, day: 3, hour: 23, minute: 59 },
      { zone: rule.timezone },
    ).toJSDate();
    const report = await scheduler.tickOnce(now);

    expect(report.pickedCount).toBe(1);
    expect(report.processedCount).toBe(1);
    expect(report.failedCount).toBe(0);

    // 查生成的 entries
    const entriesRes = await pool.query(
      `SELECT source_recurring_id, occurred_at, amount FROM entries WHERE source_recurring_id = $1`,
      [rule.id],
    );
    expect(entriesRes.rows.length).toBe(1);
    expect(Number(entriesRes.rows[0].amount)).toBe(500);
    expect(entriesRes.rows[0].source_recurring_id).toBe(rule.id);

    // REST /entries 与 sync/pull 都必须把来源下发给客户端角标链路
    const listRes = await app.inject({
      method: 'GET',
      url: `/v1/entries?ledger_id=${LEDGER_ID}&limit=10`,
      headers: authHeaderNoBody(token),
    });
    expect(listRes.statusCode).toBe(200);
    expect((listRes.json() as { entries: Array<{ source_recurring_id: string | null }> }).entries[0].source_recurring_id).toBe(rule.id);

    const pullRes = await app.inject({
      method: 'GET',
      url: '/v1/sync/pull?family_id=00000000-0000-0000-0000-0000000000f1&since=0&limit=20',
      headers: authHeaderNoBody(token),
    });
    expect(pullRes.statusCode).toBe(200);
    expect((pullRes.json() as { changes: { entries: Array<{ source_recurring_id: string | null }> } }).changes.entries[0].source_recurring_id).toBe(rule.id);

    // 校验 next_run_at 已推进到未来（周三 execute time）
    const updated = await pool.query<{ next_run_at: Date }>(
      `SELECT next_run_at FROM recurring_rules WHERE id = $1`,
      [rule.id],
    );
    expect(new Date(updated.rows[0].next_run_at).getTime()).toBeGreaterThan(now.getTime());
  });

  it('E2E · idempotent · tick twice yields no duplicate entries', async () => {
    const createRes = await app.inject({
      method: 'POST',
      url: '/v1/recurring-entries',
      headers: authHeader(token),
      payload: {
        ledger_id: LEDGER_ID,
        type: 'expense',
        amount: 300,
        shared_type: 'personal',
        period: 'weekly',
        days_of_week: [1],
        execute_bucket: 'morning',
        start_date: '2026-08-01',
      },
    });
    const rule = createRes.json() as {
      id: string;
      execute_hour: number;
      execute_minute: number;
      timezone: string;
    };

    const pool = getPool();
    const { DateTime } = await import('luxon');
    // 精确对齐周一 execute time
    const past = DateTime.fromObject(
      {
        year: 2026,
        month: 8,
        day: 3, // Monday
        hour: rule.execute_hour,
        minute: rule.execute_minute,
      },
      { zone: rule.timezone },
    ).toJSDate();
    await pool.query(
      `UPDATE recurring_rules SET next_run_at = $1 WHERE id = $2`,
      [past, rule.id],
    );

    const scheduler = app.recurringScheduler!;
    const now = DateTime.fromObject(
      { year: 2026, month: 8, day: 3, hour: 23, minute: 59 },
      { zone: rule.timezone },
    ).toJSDate();

    // 第 1 次 tick · 生成 1 条
    await scheduler.tickOnce(now);

    // 强行把 next_run_at 拉回到同一 execute time · 制造"重跑"场景
    await pool.query(
      `UPDATE recurring_rules SET next_run_at = $1 WHERE id = $2`,
      [past, rule.id],
    );
    // 第 2 次 tick · 命中同一 client_ref_id · 不重复生成
    await scheduler.tickOnce(now);

    const entriesRes = await pool.query<{ cnt: number }>(
      `SELECT COUNT(*)::int AS cnt FROM entries WHERE source_recurring_id = $1`,
      [rule.id],
    );
    expect(entriesRes.rows[0].cnt).toBe(1);
  });

  it('E2E · backfill scenario A · 每天下午规则宕机 48h → 补 2-3 条', async () => {
    // start_date 早期 · daily-ish 规则用 weekly 全选 dow 代替
    const createRes = await app.inject({
      method: 'POST',
      url: '/v1/recurring-entries',
      headers: authHeader(token),
      payload: {
        ledger_id: LEDGER_ID,
        type: 'expense',
        amount: 100,
        shared_type: 'personal',
        period: 'weekly',
        days_of_week: [1, 2, 3, 4, 5, 6, 7], // 每天
        execute_bucket: 'afternoon',
        start_date: '2026-08-01',
      },
    });
    const rule = createRes.json() as {
      id: string;
      execute_hour: number;
      execute_minute: number;
      timezone: string;
    };

    // 手动把 next_run_at 拉到过去 · 精确对齐 execute_hour:execute_minute in tz
    // 用 luxon 计算正确的 UTC 时间点
    const pool = getPool();
    const { DateTime } = await import('luxon');
    const past = DateTime.fromObject(
      {
        year: 2026,
        month: 8,
        day: 10,
        hour: rule.execute_hour,
        minute: rule.execute_minute,
      },
      { zone: rule.timezone },
    ).toJSDate();
    await pool.query(
      `UPDATE recurring_rules SET next_run_at = $1 WHERE id = $2`,
      [past, rule.id],
    );

    // now = 2 天后同一时刻（不含当天，因为 execute time 未到）
    const now = DateTime.fromObject(
      {
        year: 2026,
        month: 8,
        day: 12,
        hour: rule.execute_hour,
        minute: rule.execute_minute - 1, // 差 1 分钟 · 避免命中当天
      },
      { zone: rule.timezone },
    ).toJSDate();
    const scheduler = app.recurringScheduler!;
    const report = await scheduler.tickOnce(now);
    expect(report.processedCount).toBe(1);
    const genResult = report.results[0].result as {
      generatedCount: number;
      generatedDates: Date[];
    };
    // 从 8/10 execute 起 → 补 8/10, 8/11 两条；8/12 execute time 未到
    expect(genResult.generatedCount).toBe(2);

    // entries 表应有 2 条
    const entriesRes = await pool.query<{ occurred_at: Date }>(
      `SELECT occurred_at FROM entries WHERE source_recurring_id = $1 ORDER BY occurred_at ASC`,
      [rule.id],
    );
    expect(entriesRes.rows.length).toBe(2);
    // 第一条应该早于 now
    expect(new Date(entriesRes.rows[0].occurred_at).getTime()).toBeLessThan(now.getTime());
  });

  it('E2E · backfill scenario B · 宕机 15 天 · 只补最近 7 天', async () => {
    const createRes = await app.inject({
      method: 'POST',
      url: '/v1/recurring-entries',
      headers: authHeader(token),
      payload: {
        ledger_id: LEDGER_ID,
        type: 'expense',
        amount: 100,
        shared_type: 'personal',
        period: 'weekly',
        days_of_week: [1, 2, 3, 4, 5, 6, 7],
        execute_bucket: 'afternoon',
        start_date: '2026-07-01',
      },
    });
    const rule = createRes.json() as {
      id: string;
      execute_hour: number;
      execute_minute: number;
      timezone: string;
    };

    const pool = getPool();
    const { DateTime } = await import('luxon');
    // next_run_at 拉到 15 天前的 execute time
    const past = DateTime.fromObject(
      {
        year: 2026,
        month: 8,
        day: 1,
        hour: rule.execute_hour,
        minute: rule.execute_minute,
      },
      { zone: rule.timezone },
    ).toJSDate();
    await pool.query(
      `UPDATE recurring_rules SET next_run_at = $1 WHERE id = $2`,
      [past, rule.id],
    );

    const now = DateTime.fromObject(
      { year: 2026, month: 8, day: 16, hour: rule.execute_hour, minute: rule.execute_minute - 1 },
      { zone: rule.timezone },
    ).toJSDate();
    const scheduler = app.recurringScheduler!;
    const report = await scheduler.tickOnce(now);

    const result = report.results[0].result as {
      generatedCount: number;
      skippedDates: Date[];
    };
    // 补齐窗口 = 7 天 · 从 8/1 到 8/16 (15 天)，前 8 天 skip，后 7 天补
    expect(result.generatedCount).toBeGreaterThan(0);
    expect(result.generatedCount).toBeLessThanOrEqual(8);
    expect(result.skippedDates.length).toBeGreaterThan(0);
  });

  it('E2E · yearly 每月同号 · 未 due · 不产生 entry', async () => {
    const ymd = [101, 202, 303, 404, 505, 606, 707, 808, 909, 1010, 1111, 1212];
    const createRes = await app.inject({
      method: 'POST',
      url: '/v1/recurring-entries',
      headers: authHeader(token),
      payload: {
        ledger_id: LEDGER_ID,
        type: 'expense',
        amount: 100,
        shared_type: 'personal',
        period: 'yearly',
        year_month_days: ymd,
        execute_bucket: 'dawn',
        start_date: '2026-01-01',
      },
    });
    const rule = createRes.json() as { id: string; next_run_at: string };

    // 未 due · now < next_run_at
    const scheduler = app.recurringScheduler!;
    const earlyNow = new Date(new Date(rule.next_run_at).getTime() - 60_000);
    const report = await scheduler.tickOnce(earlyNow);
    expect(report.pickedCount).toBe(0);
    expect(report.processedCount).toBe(0);

    const pool = getPool();
    const entriesRes = await pool.query<{ cnt: number }>(
      `SELECT COUNT(*)::int AS cnt FROM entries WHERE source_recurring_id = $1`,
      [rule.id],
    );
    expect(entriesRes.rows[0].cnt).toBe(0);
  });

it('E2E · advisory-lock is mocked in test env · tick always proceeds', async () => {
    // 直接调 tickOnce 两次 · 都能拿到锁
    const scheduler = app.recurringScheduler!;
    const r1 = await scheduler.tickOnce(new Date());
    const r2 = await scheduler.tickOnce(new Date());
    expect(r1.pickedCount).toBe(0);
    expect(r2.pickedCount).toBe(0);
  });
});

// ==============================================================================
// 运行前置校验 · auto_paused 兜底
// ==============================================================================

describe('recurring-entries · pre-flight auto_paused', () => {
  let app: FastifyInstance;
  let token: string;
  let userId: string;

  beforeEach(async () => {
    app = await buildApp({ disableLogger: true, autoStartScheduler: false });
 await app.ready();
    const login1 = await login(app);
    token = login1.token;
    userId = login1.userId;
    await setupFamilyAndLedger(userId);
  });

  async function createDueRule(): Promise<{ id: string; execute_hour: number; execute_minute: number; timezone: string; }> {
    const createRes = await app.inject({
 method: 'POST',
      url: '/v1/recurring-entries',
      headers: authHeader(token),
    payload: {
        ledger_id: LEDGER_ID,
        type: 'expense',
        amount: 500,
        shared_type: 'personal',
        period: 'weekly',
        days_of_week: [1, 3, 5],
        execute_bucket: 'morning',
        start_date: '2026-08-01',
      },
    });
    expect(createRes.statusCode).toBe(201);
    const rule = createRes.json() as { id: string; execute_hour: number; execute_minute: number; timezone: string; };
    // 把 next_run_at 拉到过去，让 rule 立即 due
    const pool = getPool();
  await pool.query(
      `UPDATE recurring_rules SET next_run_at = $1 WHERE id = $2`,
      [new Date('2026-08-03T01:00:00.000Z'), rule.id],
    );
    return rule;
  }

  it('账本被软删 → rule 自动 auto_paused · 不生成 entry · last_run_status = failed_ledger_deleted', async () => {
    const rule = await createDueRule();
    const pool = getPool();
    // 模拟账本被删
    await pool.query(`UPDATE ledgers SET deleted_at = now() WHERE id = $1`, [LEDGER_ID]);

    const scheduler = app.recurringScheduler!;
    const report = await scheduler.tickOnce(new Date('2026-08-03T23:59:00.000Z'));
    expect(report.processedCount).toBe(1);

    const ruleRes = await pool.query<{ status: string; last_run_status: string | null; consecutive_failures: number }>(
      `SELECT status, last_run_status, consecutive_failures FROM recurring_rules WHERE id = $1`,
      [rule.id],
    );
    expect(ruleRes.rows[0].status).toBe('auto_paused');
 expect(ruleRes.rows[0].last_run_status).toBe('failed_ledger_deleted');
    // 结构性失效不走 3 次重试
    expect(ruleRes.rows[0].consecutive_failures).toBe(0);

    const entriesRes = await pool.query<{ cnt: number }>(
      `SELECT COUNT(*)::int AS cnt FROM entries WHERE source_recurring_id = $1`,
      [rule.id],
    );
    expect(entriesRes.rows[0].cnt).toBe(0);
  });

  it('用户被移出家庭 → rule 自动 auto_paused · last_run_status = failed_user_left_family', async () => {
    const rule = await createDueRule();
    const pool = getPool();
    // 模拟用户离开家庭
    await pool.query(
      `UPDATE family_members SET left_at = now() WHERE user_id = $1`,
   [userId],
    );

    const scheduler = app.recurringScheduler!;
    const report = await scheduler.tickOnce(new Date('2026-08-03T23:59:00.000Z'));
    expect(report.processedCount).toBe(1);

    const ruleRes = await pool.query<{ status: string; last_run_status: string | null }>(
      `SELECT status, last_run_status FROM recurring_rules WHERE id = $1`,
      [rule.id],
    );
    expect(ruleRes.rows[0].status).toBe('auto_paused');
    expect(ruleRes.rows[0].last_run_status).toBe('failed_user_left_family');

    const entriesRes = await pool.query<{ cnt: number }>(
      `SELECT COUNT(*)::int AS cnt FROM entries WHERE source_recurring_id = $1`,
  [rule.id],
    );
    expect(entriesRes.rows[0].cnt).toBe(0);
  });

  it('家庭被解散 → rule 自动 auto_paused · last_run_status = failed_family_deleted', async () => {
    const rule = await createDueRule();
    const pool = getPool();
    await pool.query(`UPDATE families SET deleted_at = now() WHERE id = $1`, ['00000000-0000-0000-0000-0000000000f1']);

    const scheduler = app.recurringScheduler!;
    const report = await scheduler.tickOnce(new Date('2026-08-03T23:59:00.000Z'));
    expect(report.processedCount).toBe(1);

    const ruleRes = await pool.query<{ status: string; last_run_status: string | null }>(
      `SELECT status, last_run_status FROM recurring_rules WHERE id = $1`,
      [rule.id],
    );
    expect(ruleRes.rows[0].status).toBe('auto_paused');
    expect(ruleRes.rows[0].last_run_status).toBe('failed_family_deleted');
  });

  it('账本正常但账本已改名等场景 → rule 继续正常执行（回归保护）', async () => {
    const rule = await createDueRule();
    const pool = getPool();
    // 改名不影响 rule 执行
    await pool.query(`UPDATE ledgers SET name = 'Renamed' WHERE id = $1`, [LEDGER_ID]);

    const scheduler = app.recurringScheduler!;
    const report = await scheduler.tickOnce(new Date('2026-08-03T23:59:00.000Z'));
    expect(report.processedCount).toBe(1);

    const ruleRes = await pool.query<{ status: string; last_run_status: string | null }>(
      `SELECT status, last_run_status FROM recurring_rules WHERE id = $1`,
    [rule.id],
  );
    expect(ruleRes.rows[0].status).toBe('active');
    expect(ruleRes.rows[0].last_run_status).toMatch(/^ok/);
  });

  it('resume 一条 auto_paused 但账本仍失效的规则 → 拒绝并保持停用', async () => {
    const rule = await createDueRule();
    const pool = getPool();
    await pool.query(`UPDATE ledgers SET deleted_at = now() WHERE id = $1`, [LEDGER_ID]);
    const scheduler = app.recurringScheduler!;
    await scheduler.tickOnce(new Date('2026-08-03T23:59:00.000Z'));

    // 用户点击"启用"应被服务端拒绝
    const resumeRes = await app.inject({
    method: 'POST',
      url: `/v1/recurring-entries/${rule.id}/resume`,
      headers: authHeaderNoBody(token),
    });
    // ledger 已删 → assertUserOwnsLedger 抛 NOT_FOUND
    expect([403, 404]).toContain(resumeRes.statusCode);
  });
});

// ==============================================================================
// 结束期窗口内已无有效执行点 · lapsed_in_window
// ==============================================================================

describe('recurring-entries · lapsed_in_window', () => {
  let app: FastifyInstance;
  let token: string;
  let userId: string;

  beforeEach(async () => {
    app = await buildApp({ disableLogger: true, autoStartScheduler: false });
    await app.ready();
    const login1 = await login(app, 'openid-recur-lapsed');
    token = login1.token;
    userId = login1.userId;
    await setupFamilyAndLedger(userId);
    // setup 完成后再固定系统时钟到 2026-08-06 12:00 CST，确保 end_date=2026-08-09 始终未到期，
    // 消除「测试在 2026-08-10 之后运行 → now > endBoundary → 被判定为真正到期」的时间炸弹。
    // 注意：必须在 buildApp/login/setupFamilyAndLedger 之后 fake，否则会劫持其内部 setTimeout/setInterval。
    vi.setSystemTime(new Date('2026-08-06T12:00:00+08:00'));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  /**
   * 创建一个"结束日未到、但下一次执行点已越过结束日"的规则。
   * 做法：先创建正常 weekly 规则（无 end_date），再 PATCH 一个
   * 早于 next_run_at 的 end_date（但晚于 start_date），触发 update 路径的
   * end_date 收敛逻辑。
   */
  async function createLapsedRule(): Promise<{ id: string }> {
    // start_date 用过去固定日期，weekly + 周一；fake now=2026-08-06 → next_run_at 落在 2026-08-10 周一早上
    const createRes = await app.inject({
      method: 'POST',
      url: '/v1/recurring-entries',
      headers: authHeader(token),
      payload: {
        ledger_id: LEDGER_ID,
        type: 'expense',
        amount: 100,
        shared_type: 'personal',
        period: 'weekly',
        days_of_week: [1], // 周一
        execute_bucket: 'morning',
        start_date: '2026-07-27',
      },
    });
    expect(createRes.statusCode).toBe(201);
    const created = createRes.json() as { id: string };

    // 把 end_date 设为早于下一次执行点（08-10 周一早上）的 08-09 周日，
    // 使 next_run 越过 end_date 闭区间、但 end_date 尚未真正到期（fake now=08-06）。
    const patchRes = await app.inject({
      method: 'PATCH',
      url: `/v1/recurring-entries/${created.id}`,
      headers: authHeader(token),
      payload: {
        end_date: '2026-08-09',
        version: 1,
      },
    });
    expect(patchRes.statusCode).toBe(200);
    return { id: created.id };
  }

  it('update · end_date 未到期但 next_run 已越过 → ended + last_run_status=lapsed_in_window', async () => {
    const { id } = await createLapsedRule();
    const pool = getPool();
    const ruleRes = await pool.query<{ status: string; last_run_status: string | null }>(
      `SELECT status, last_run_status FROM recurring_rules WHERE id = $1`,
      [id],
    );
    expect(ruleRes.rows[0].status).toBe('ended');
    expect(ruleRes.rows[0].last_run_status).toBe('lapsed_in_window');
  });

  it('resume 一条 lapsed_in_window 规则 → 拒绝并返回专属提示（区别于已到期）', async () => {
    const { id } = await createLapsedRule();
    const resumeRes = await app.inject({
      method: 'POST',
      url: `/v1/recurring-entries/${id}/resume`,
      headers: authHeaderNoBody(token),
    });
    expect(resumeRes.statusCode).toBe(422); // BUSINESS_RULE_VIOLATION
    const body = resumeRes.json() as { message?: string };
    expect(body.message).toContain('无有效执行日');
  });
});

// ==============================================================================
// POST method-override (wx.request PATCH 降级兜底)
// ==============================================================================

describe('recurring-entries · POST method-override', () => {
  let app: FastifyInstance;
  let token: string;
  let userId: string;

  beforeEach(async () => {
    app = await buildApp({ disableLogger: true, autoStartScheduler: false });
    await app.ready();
    const login1 = await login(app);
    token = login1.token;
    userId = login1.userId;
    await setupFamilyAndLedger(userId);
  });

  it('POST /recurring-entries/:id + X-HTTP-Method-Override: PATCH → 200', async () => {
    // 先创建一条
    const createRes = await app.inject({
      method: 'POST',
      url: '/v1/recurring-entries',
      headers: authHeader(token),
      payload: {
        ledger_id: LEDGER_ID,
        type: 'expense',
        amount: 5000,
        shared_type: 'personal',
        period: 'weekly',
        days_of_week: [1],
        execute_bucket: 'morning',
        start_date: '2026-08-01',
      },
    });
    expect(createRes.statusCode).toBe(201);
    const rule = createRes.json() as { id: string; version: number };

    // 用 POST + override 做 PATCH
    const patchRes = await app.inject({
      method: 'POST',
      url: `/v1/recurring-entries/${rule.id}`,
      headers: {
        ...authHeader(token),
        'x-http-method-override': 'PATCH',
      },
      payload: {
        version: rule.version,
        amount: 8000,
      },
    });
    expect(patchRes.statusCode).toBe(200);
    const patched = patchRes.json() as { amount: number; version: number };
    expect(patched.amount).toBe(8000);
    expect(patched.version).toBe(rule.version + 1);
  });

  it('POST /recurring-entries/:id without override → 405', async () => {
    const createRes = await app.inject({
      method: 'POST',
      url: '/v1/recurring-entries',
      headers: authHeader(token),
      payload: {
        ledger_id: LEDGER_ID,
        type: 'expense',
        amount: 5000,
        shared_type: 'personal',
        period: 'weekly',
        days_of_week: [1],
        execute_bucket: 'morning',
        start_date: '2026-08-01',
      },
    });
    const rule = createRes.json() as { id: string; version: number };

    const res = await app.inject({
      method: 'POST',
      url: `/v1/recurring-entries/${rule.id}`,
      headers: authHeader(token),
      payload: { version: rule.version, amount: 9000 },
    });
    expect(res.statusCode).toBe(405);
  });
});

// ==============================================================================
// HTTP mutation idempotency（T3 离线队列重放保障）
// ==============================================================================

describe('recurring-entries · mutation idempotency', () => {
  let app: FastifyInstance;
  let token: string;

  beforeEach(async () => {
    app = await buildApp({ disableLogger: true, autoStartScheduler: false });
    await app.ready();
    const loggedIn = await login(app, 'openid-recur-idempotency');
    token = loggedIn.token;
    await setupFamilyAndLedger(loggedIn.userId);
  });

  it('replaying create with the same key returns the cached rule without duplication', async () => {
    const payload = {
      ledger_id: LEDGER_ID,
      type: 'expense',
      amount: 6600,
      shared_type: 'personal',
      period: 'weekly',
      days_of_week: [2],
      execute_bucket: 'morning',
      start_date: '2026-08-01',
    };
    const headers = { ...authHeader(token), 'idempotency-key': 'recurring-create-replay-key' };

    const first = await app.inject({ method: 'POST', url: '/v1/recurring-entries', headers, payload });
    const replay = await app.inject({ method: 'POST', url: '/v1/recurring-entries', headers, payload });

    expect(first.statusCode).toBe(201);
    expect(replay.statusCode).toBe(201);
    expect((replay.json() as { id: string }).id).toBe((first.json() as { id: string }).id);

    const count = await getPool().query<{ count: number }>(
      'SELECT COUNT(*)::int AS count FROM recurring_rules',
    );
    expect(count.rows[0].count).toBe(1);
  });

  it('replaying method-override update returns cached version instead of a version conflict', async () => {
    const create = await app.inject({
      method: 'POST',
      url: '/v1/recurring-entries',
      headers: authHeader(token),
      payload: {
        ledger_id: LEDGER_ID,
        type: 'expense',
        amount: 5000,
        shared_type: 'personal',
        period: 'weekly',
        days_of_week: [1],
        execute_bucket: 'morning',
        start_date: '2026-08-01',
      },
    });
    const rule = create.json() as { id: string; version: number };
    const headers = {
      ...authHeader(token),
      'x-http-method-override': 'PATCH',
      'idempotency-key': 'recurring-update-replay-key',
    };
    const payload = { version: rule.version, amount: 8800 };

    const first = await app.inject({
      method: 'POST',
      url: `/v1/recurring-entries/${rule.id}`,
      headers,
      payload,
    });
    const replay = await app.inject({
      method: 'POST',
      url: `/v1/recurring-entries/${rule.id}`,
      headers,
      payload,
    });

    expect(first.statusCode).toBe(200);
    expect(replay.statusCode).toBe(200);
    expect(replay.json()).toEqual(first.json());
    expect((replay.json() as { version: number }).version).toBe(rule.version + 1);
  });
});

// ==============================================================================
// workday period · E2E
// ==============================================================================

describe('recurring-entries · workday period', () => {
  let app: FastifyInstance;
  let token: string;
  let userId: string;

  beforeEach(async () => {
    app = await buildApp({ disableLogger: true, autoStartScheduler: false });
    await app.ready();
    const login1 = await login(app);
    token = login1.token;
    userId = login1.userId;
    await setupFamilyAndLedger(userId);

    // seed workday_calendars 数据（buildApp 时 refreshWorkdayCache 读到空表，需重刷）
    const pool = getPool();
    await pool.query(
      `INSERT INTO workday_calendars (year, holidays, workdays) VALUES
        (2026, ARRAY['08-03','12-31'], ARRAY[]::TEXT[]),
        (2027, ARRAY['01-01'], ARRAY['01-02'])`,
    );
    const { refreshCache } = await import('../src/services/workdayProvider.js');
    await refreshCache();
  });

  afterEach(async () => {
    vi.useRealTimers();
    await app.close();
  });

  it('POST /recurring-entries · period=workday · 201 · days arrays 全 null', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/v1/recurring-entries',
      headers: authHeader(token),
      payload: {
        ledger_id: LEDGER_ID,
        type: 'expense',
        amount: 5000,
        shared_type: 'personal',
        note: '通勤',
        period: 'workday',
        execute_bucket: 'morning',
        start_date: '2026-08-01',
      },
    });
    expect(res.statusCode).toBe(201);
    const rule = res.json() as Record<string, unknown>;
    expect(rule.period).toBe('workday');
    expect(rule.days_of_week).toBeNull();
    expect(rule.days_of_month).toBeNull();
    expect(rule.year_month_days).toBeNull();
    expect(rule.period_interval).toBe(1);
  });

  it('POST /recurring-entries · workday + days_of_week → 400', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/v1/recurring-entries',
      headers: authHeader(token),
      payload: {
        ledger_id: LEDGER_ID,
        type: 'expense',
        amount: 5000,
        period: 'workday',
        days_of_week: [1],
        execute_bucket: 'morning',
        start_date: '2026-08-01',
      },
    });
    expect(res.statusCode).toBe(400);
  });

  it('POST /recurring-entries · workday + period_interval=2 → 400', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/v1/recurring-entries',
      headers: authHeader(token),
      payload: {
        ledger_id: LEDGER_ID,
        type: 'expense',
        amount: 5000,
        period: 'workday',
        period_interval: 2,
        execute_bucket: 'morning',
        start_date: '2026-08-01',
      },
    });
    expect(res.statusCode).toBe(400);
  });

  it('E2E · workday · create 时跳过法定假日 → next_run_at 落在下一个工作日', async () => {
    // beforeEach 已 seed 2026 holidays=['08-03','12-31'] + 2027 holidays=['01-01'] workdays=['01-02']
    // 固定系统时间到 8/2（start_date=8/3 是未来日，避免 create 走 now 重算分支）
    vi.setSystemTime(new Date('2026-08-02T12:00:00+08:00'));

    const createRes = await app.inject({
      method: 'POST',
      url: '/v1/recurring-entries',
      headers: authHeader(token),
      payload: {
        ledger_id: LEDGER_ID,
        type: 'expense',
        amount: 5000,
        period: 'workday',
        execute_bucket: 'morning',
        start_date: '2026-08-03', // 8/3 周一放假
      },
    });
    const rule = createRes.json() as {
      next_run_at: string;
      timezone: string;
    };

    // next_run_at 应该跳过 8/3 放假日 → 8/4 周二
    const { DateTime } = await import('luxon');
    const nextRun = DateTime.fromISO(rule.next_run_at, {
      zone: rule.timezone,
    });
    expect(nextRun.day).toBe(4);

    vi.useRealTimers();
  });

  it('E2E · workday · 跨年 cursor.year 查数据（不按 start_date 降级）· 纯函数层', async () => {
    // 跨年逻辑由 recurringSchedule.test.ts 的 computeNextRunAt · workday 单元测试覆盖。
    // 这里验证 service 层 resolveWorkdayData 返回多年数组，不按 start_date 固化。
    const { getAllWorkdayData } = await import('../src/services/workdayProvider.js');
    const allData = getAllWorkdayData();
    // beforeEach seed 了 2026 和 2027
    const years = allData.map((d) => d.year).sort();
    expect(years).toContain(2026);
    expect(years).toContain(2027);
    // 2027 的补班日 '01-02' 在数据中
    const data2027 = allData.find((d) => d.year === 2027);
    expect(data2027?.workdays).toContain('01-02');
  });
});

// ==============================================================================
// daily period · E2E
// ==============================================================================

describe('recurring-entries · daily period', () => {
  let app: FastifyInstance;
  let token: string;
  let userId: string;

  beforeEach(async () => {
    app = await buildApp({ disableLogger: true, autoStartScheduler: false });
    await app.ready();
    const login1 = await login(app);
    token = login1.token;
    userId = login1.userId;
    await setupFamilyAndLedger(userId);
  });

  afterEach(async () => {
    vi.useRealTimers();
    await app.close();
  });

  it('POST /recurring-entries · period=daily interval=1 · 201 · days arrays 全 null', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/v1/recurring-entries',
      headers: authHeader(token),
      payload: {
        ledger_id: LEDGER_ID,
        type: 'expense',
        amount: 1000,
        shared_type: 'personal',
        note: '每天早餐',
        period: 'daily',
        period_interval: 1,
        execute_bucket: 'morning',
        start_date: '2026-08-15',
      },
    });
    expect(res.statusCode).toBe(201);
    const rule = res.json() as Record<string, unknown>;
    expect(rule.period).toBe('daily');
    expect(rule.days_of_week).toBeNull();
    expect(rule.days_of_month).toBeNull();
    expect(rule.year_month_days).toBeNull();
    expect(rule.period_interval).toBe(1);
  });

  it('POST /recurring-entries · period=daily interval=3 · 201 · interval persisted', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/v1/recurring-entries',
      headers: authHeader(token),
      payload: {
        ledger_id: LEDGER_ID,
        type: 'expense',
        amount: 3000,
        period: 'daily',
        period_interval: 3,
        execute_bucket: 'morning',
        start_date: '2026-08-15',
      },
    });
    expect(res.statusCode).toBe(201);
    const rule = res.json() as Record<string, unknown>;
    expect(rule.period).toBe('daily');
    expect(rule.period_interval).toBe(3);
  });

  it('POST /recurring-entries · daily + days_of_week → 400', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/v1/recurring-entries',
      headers: authHeader(token),
      payload: {
        ledger_id: LEDGER_ID,
        type: 'expense',
        amount: 5000,
        period: 'daily',
        days_of_week: [1],
        execute_bucket: 'morning',
        start_date: '2026-08-15',
      },
    });
    expect(res.statusCode).toBe(400);
  });

  it('POST /recurring-entries · daily + days_of_month → 400', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/v1/recurring-entries',
      headers: authHeader(token),
      payload: {
        ledger_id: LEDGER_ID,
        type: 'expense',
        amount: 5000,
        period: 'daily',
        days_of_month: [15],
        execute_bucket: 'morning',
        start_date: '2026-08-15',
      },
    });
    expect(res.statusCode).toBe(400);
  });

  it('PATCH /recurring-entries · weekly → daily · clears days_of_week', async () => {
    // 先创建 weekly 规则
    const createRes = await app.inject({
      method: 'POST',
      url: '/v1/recurring-entries',
      headers: authHeader(token),
      payload: {
        ledger_id: LEDGER_ID,
        type: 'expense',
        amount: 2000,
        period: 'weekly',
        days_of_week: [1, 3, 5],
        execute_bucket: 'morning',
        start_date: '2026-08-15',
      },
    });
    expect(createRes.statusCode).toBe(201);
    const created = createRes.json() as { id: string; version: number };

    // PATCH 改为 daily · days_of_week 应清空
    const patchRes = await app.inject({
      method: 'PATCH',
      url: `/v1/recurring-entries/${created.id}`,
      headers: authHeader(token),
      payload: {
        version: created.version,
        period: 'daily',
        period_interval: 2,
        days_of_week: null,
        days_of_month: null,
        year_month_days: null,
      },
    });
    expect(patchRes.statusCode).toBe(200);
    const updated = patchRes.json() as Record<string, unknown>;
    expect(updated.period).toBe('daily');
    expect(updated.days_of_week).toBeNull();
    expect(updated.period_interval).toBe(2);
  });

  it('E2E · daily · next_run_at 落在 start_date 当日（interval=1 · start_date 未来日）', async () => {
    // 用 service 层 + computeNextRunAt 验证，避开 vi.setSystemTime 导致 token 过期的 HTTP 路径问题
    // （参照 MEMORY.md 的 workday E2E 教训）
    const { computeNextRunAt } = await import('../src/services/recurringSchedule.js');

    const now = new Date('2026-08-14T12:00:00+08:00');
    const nextRun = computeNextRunAt(
      {
        period: 'daily',
        period_interval: 1,
        timezone: 'Asia/Shanghai',
        start_date: '2026-08-15',
        execute_hour: 9,
        execute_minute: 30,
        days_of_week: null,
        days_of_month: null,
        year_month_days: null,
        workday_data: [],
      },
      now,
    );

    const { DateTime } = await import('luxon');
    const zoned = DateTime.fromJSDate(nextRun, { zone: 'Asia/Shanghai' });
    expect(zoned.day).toBe(15);
    expect(zoned.month).toBe(8);
  });
});

// ==============================================================================
// 起始日=今天 + bucket 窗口已进入 → 跳过今天（§4.4 顺延规则）
// ==============================================================================

describe('recurring-entries · start_date=today + window already entered', () => {
  let app: FastifyInstance;
  let token: string;
  let userId: string;

  beforeEach(async () => {
    app = await buildApp({ disableLogger: true, autoStartScheduler: false });
    await app.ready();
    const login1 = await login(app);
    token = login1.token;
    userId = login1.userId;
    await setupFamilyAndLedger(userId);
  });

  afterEach(async () => {
    vi.useRealTimers();
    await app.close();
  });

  it('weekly · 起始日=今天且今天匹配 + 当前时刻已进入下午窗口 → 跳过今天，next_run_at 落在下一个匹配日', async () => {
    // 2026-08-07 是周五（weekday=5）。设 start_date=今天，days_of_week=[5]（周五）。
    // now = 13:02（已进入下午窗口 12:00~17:59）→ 应跳过今天。
    // 下一个匹配日 = 下周五 2026-08-14。
    vi.setSystemTime(new Date('2026-08-07T13:02:00+08:00'));

    const createRes = await app.inject({
      method: 'POST',
      url: '/v1/recurring-entries',
      headers: authHeader(token),
      payload: {
        ledger_id: LEDGER_ID,
        type: 'expense',
        amount: 2000,
        period: 'weekly',
        days_of_week: [5],
        execute_bucket: 'afternoon',
        start_date: '2026-08-07',
      },
    });
    expect(createRes.statusCode).toBe(201);
    const rule = createRes.json() as { next_run_at: string; timezone: string };

    const { DateTime } = await import('luxon');
    const nextRun = DateTime.fromISO(rule.next_run_at, { zone: rule.timezone });
    // 应跳过今天 → 下周五 8/14
    expect(nextRun.day).toBe(14);
    expect(nextRun.month).toBe(8);
  });

  it('weekly · 起始日=今天且今天匹配 + 当前时刻在窗口之前 → 今天触发', async () => {
    // 2026-08-07 周五。now = 07:00（早上，下午窗口 12:00 还没开始）→ 今天会触发。
    vi.setSystemTime(new Date('2026-08-07T07:00:00+08:00'));

    const createRes = await app.inject({
      method: 'POST',
      url: '/v1/recurring-entries',
      headers: authHeader(token),
      payload: {
        ledger_id: LEDGER_ID,
        type: 'expense',
        amount: 2000,
        period: 'weekly',
        days_of_week: [5],
        execute_bucket: 'afternoon',
        start_date: '2026-08-07',
      },
    });
    expect(createRes.statusCode).toBe(201);
    const rule = createRes.json() as { next_run_at: string; timezone: string };

    const { DateTime } = await import('luxon');
    const nextRun = DateTime.fromISO(rule.next_run_at, { zone: rule.timezone });
    // 窗口还没开始 → 今天会触发
    expect(nextRun.day).toBe(7);
  });

  it('daily · 起始日=今天 + 当前时刻已进入下午窗口 → 跳过今天，next_run_at 落在 interval 天后', async () => {
    // 2026-08-07。daily interval=2，start_date=今天，afternoon 窗口。
    // now = 13:02（已进入下午窗口 12:00~17:59）→ 应跳过今天。
    // 下一个匹配日 = 今天 + 2 = 2026-08-09。
    vi.setSystemTime(new Date('2026-08-07T13:02:00+08:00'));

    const createRes = await app.inject({
      method: 'POST',
      url: '/v1/recurring-entries',
      headers: authHeader(token),
      payload: {
        ledger_id: LEDGER_ID,
        type: 'expense',
        amount: 4550,
        period: 'daily',
        period_interval: 2,
        execute_bucket: 'afternoon',
        start_date: '2026-08-07',
      },
    });
    expect(createRes.statusCode).toBe(201);
    const rule = createRes.json() as { next_run_at: string; timezone: string };

    const { DateTime } = await import('luxon');
    const nextRun = DateTime.fromISO(rule.next_run_at, { zone: rule.timezone });
    // 应跳过今天 → 2 天后 8/9
    expect(nextRun.day).toBe(9);
    expect(nextRun.month).toBe(8);
  });

  it('daily · 起始日=今天 + 当前时刻在窗口之前 → 今天触发', async () => {
    // now = 07:00（早上，下午窗口 12:00 还没开始）→ 今天会触发。
    vi.setSystemTime(new Date('2026-08-07T07:00:00+08:00'));

    const createRes = await app.inject({
      method: 'POST',
      url: '/v1/recurring-entries',
      headers: authHeader(token),
      payload: {
        ledger_id: LEDGER_ID,
        type: 'expense',
        amount: 4550,
        period: 'daily',
        period_interval: 2,
        execute_bucket: 'afternoon',
        start_date: '2026-08-07',
      },
    });
    expect(createRes.statusCode).toBe(201);
    const rule = createRes.json() as { next_run_at: string; timezone: string };

    const { DateTime } = await import('luxon');
    const nextRun = DateTime.fromISO(rule.next_run_at, { zone: rule.timezone });
    // 窗口还没开始 → 今天会触发
    expect(nextRun.day).toBe(7);
  });

  it('monthly · 起始日=今天且今天匹配 + 当前时刻已进入窗口 → 跳过今天', async () => {
    // 2026-08-07。monthly days_of_month=[7]，start_date=今天，afternoon 窗口。
    // now = 14:00（已进入下午窗口）→ 应跳过今天 → 下月 9/7。
    vi.setSystemTime(new Date('2026-08-07T14:00:00+08:00'));

    const createRes = await app.inject({
      method: 'POST',
      url: '/v1/recurring-entries',
      headers: authHeader(token),
      payload: {
        ledger_id: LEDGER_ID,
        type: 'expense',
        amount: 3000,
        period: 'monthly',
        days_of_month: [7],
        execute_bucket: 'afternoon',
        start_date: '2026-08-07',
      },
    });
    expect(createRes.statusCode).toBe(201);
    const rule = createRes.json() as { next_run_at: string; timezone: string };

    const { DateTime } = await import('luxon');
    const nextRun = DateTime.fromISO(rule.next_run_at, { zone: rule.timezone });
    // 应跳过今天 → 下月 9/7
    expect(nextRun.month).toBe(9);
    expect(nextRun.day).toBe(7);
  });
});

// ==============================================================================
// update / resume 路径的 bucket 窗口跳过保护
//
// 回归场景：用户在 bucket 窗口期内修改或恢复规则时，如果重算的 next_run_at
// 落在今天，应跳过今天（与 create 路径行为一致），避免当天意外触发。
// ==============================================================================

describe('recurring-entries · update/resume bucket window skip', () => {
  let app: FastifyInstance;
  let token: string;
  let userId: string;

  beforeEach(async () => {
    app = await buildApp({ disableLogger: true, autoStartScheduler: false });
    await app.ready();
    const login1 = await login(app, 'openid-recur-window-skip');
    token = login1.token;
    userId = login1.userId;
    await setupFamilyAndLedger(userId);
  });
  afterEach(async () => {
    vi.useRealTimers();
    await app.close();
  });

  it('PATCH · 在 bucket 窗口期内修改匹配日 → 跳过今天，next_run_at 不落在今天', async () => {
    // 2026-08-07 周五。now = 14:00（已进入下午窗口 12:00~17:59）。
    // 先创建一条 start_date 在未来的 weekly 规则（避免 create 时触发跳过逻辑），
    // 然后通过 PATCH 把 start_date 改成今天 → update 路径重算 next_run_at。
    vi.setSystemTime(new Date('2026-08-07T14:00:00+08:00'));

    // 创建 start_date=2026-08-20（未来），days_of_week=[5]（周五）
    const createRes = await app.inject({
      method: 'POST',
      url: '/v1/recurring-entries',
      headers: authHeader(token),
      payload: {
        ledger_id: LEDGER_ID,
        type: 'expense',
        amount: 2000,
        period: 'weekly',
        days_of_week: [5],
        execute_bucket: 'afternoon',
        start_date: '2026-08-20',
      },
    });
    expect(createRes.statusCode).toBe(201);
    const created = createRes.json() as { id: string; version: number; timezone: string };

    // PATCH：把 start_date 改成今天 2026-08-07 → update 路径从 now 重算
    // 7 号是周五（匹配日），afternoon 窗口 hash 落点会在今天 12:30~17:30 之间。
    // 但 now=14:00 已进入窗口 → 应跳过今天 → 下一个匹配日 = 下周五 8/14
    const patchRes = await app.inject({
      method: 'PATCH',
      url: `/v1/recurring-entries/${created.id}`,
      headers: authHeader(token),
      payload: {
        version: created.version,
        start_date: '2026-08-07',
      },
    });
    expect(patchRes.statusCode).toBe(200);
    const patched = patchRes.json() as { next_run_at: string; timezone: string };

    const { DateTime } = await import('luxon');
    const nextRun = DateTime.fromISO(patched.next_run_at, { zone: patched.timezone });
    // 不应落在今天 8/7 → 应该是下周五 8/14
    expect(nextRun.day).toBe(14);
    expect(nextRun.month).toBe(8);
  });

  it('PATCH · 在 bucket 窗口期之前修改匹配日 → 今天会触发，next_run_at 落在今天', async () => {
    // 2026-08-07 周五。now = 07:00（早上，下午窗口 12:00 还没开始）。
    // 修改 start_date → 重算的 next_run_at 落在今天 → 今天应触发。
    vi.setSystemTime(new Date('2026-08-07T07:00:00+08:00'));

    const createRes = await app.inject({
      method: 'POST',
      url: '/v1/recurring-entries',
      headers: authHeader(token),
      payload: {
        ledger_id: LEDGER_ID,
        type: 'expense',
        amount: 2000,
        period: 'weekly',
        days_of_week: [5],
        execute_bucket: 'afternoon',
        start_date: '2026-08-20',
      },
    });
    expect(createRes.statusCode).toBe(201);
    const created = createRes.json() as { id: string; version: number };

    const patchRes = await app.inject({
      method: 'PATCH',
      url: `/v1/recurring-entries/${created.id}`,
      headers: authHeader(token),
      payload: {
        version: created.version,
        start_date: '2026-08-07',
      },
    });
    expect(patchRes.statusCode).toBe(200);
    const patched = patchRes.json() as { next_run_at: string; timezone: string };

    const { DateTime } = await import('luxon');
    const nextRun = DateTime.fromISO(patched.next_run_at, { zone: patched.timezone });
    // 窗口还没开始 → 今天会触发
    expect(nextRun.day).toBe(7);
  });

  it('resume · 在 bucket 窗口期内恢复规则 → 跳过今天，next_run_at 不落在今天', async () => {
    // 2026-08-07 周五。now = 14:00（已进入下午窗口）。
    // 创建 → pause → resume，resume 时 today 是匹配日且已进入窗口 → 应跳过今天。
    vi.setSystemTime(new Date('2026-08-07T07:00:00+08:00'));

    // 早上 07:00 创建（窗口还没开始 → next_run_at 落在今天）
    const createRes = await app.inject({
      method: 'POST',
      url: '/v1/recurring-entries',
      headers: authHeader(token),
      payload: {
        ledger_id: LEDGER_ID,
        type: 'expense',
        amount: 2000,
        period: 'weekly',
        days_of_week: [5],
        execute_bucket: 'afternoon',
        start_date: '2026-08-07',
      },
    });
    expect(createRes.statusCode).toBe(201);
    const created = createRes.json() as { id: string };

    // pause
    const pauseRes = await app.inject({
      method: 'POST',
      url: `/v1/recurring-entries/${created.id}/pause`,
      headers: authHeaderNoBody(token),
    });
    expect(pauseRes.statusCode).toBe(200);

    // 时间推进到下午 14:00（已进入 afternoon 窗口）→ resume
    vi.setSystemTime(new Date('2026-08-07T14:00:00+08:00'));
    const resumeRes = await app.inject({
      method: 'POST',
      url: `/v1/recurring-entries/${created.id}/resume`,
      headers: authHeaderNoBody(token),
    });
    expect(resumeRes.statusCode).toBe(200);
    const resumed = resumeRes.json() as { next_run_at: string; timezone: string };

    const { DateTime } = await import('luxon');
    const nextRun = DateTime.fromISO(resumed.next_run_at, { zone: resumed.timezone });
    // 已进入下午窗口 → 跳过今天 → 下周五 8/14
    expect(nextRun.day).toBe(14);
    expect(nextRun.month).toBe(8);
  });
});
