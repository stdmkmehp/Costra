/**
 * Costra · Server · 赞赏对账调度器单测（tipReconcileScheduler）
 *
 * 事实源：tech-spec v1.2 §6.1 / §10.1
 *
 * 覆盖：
 *   T1  claim 先提交后 fetch：query_order 发起时 probe_count/next_probe_at 已推进（commit-before-fetch）
 *   T2  节奏表：probe_count 1→T+5min · 2→T+10min · 3→T+30min · ≥4→created_at+windowSec+1s
 *   T3  T3 收口：probe_count>=4 且窗口外 + query 未支付 ⇒ mark_expired；之后 5 个 tick 不再查询（≤1 次）
 *   T4  加速探测（summary/webhook claimProbe）不改动 probe_count/next_probe_at
 *   T5  源码无 SKIP LOCKED（pg-mem 兼容静态检查）
 *   T6  paid ⇒ settle 交付（调度器路径端到端）
 *   T7  conflict 窗口外 ⇒ mark_expired 收口（P0-A 回归：确定性冲突不得永久驻留探测队列）
 */

import { randomUUID } from 'node:crypto';
import { describe, it, expect, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../src/app.js';
import { getPool } from '../src/db/pool.js';
import { setWxFetchForTests } from '../src/wx/code2Session.js';
import { setVirtualPayFetchForTests } from '../src/wx/virtualPayClient.js';
import { setAccessTokenFetchForTests } from '../src/wx/accessToken.js';
import { nextProbeAtAfterClaim } from '../src/repositories/tipOrderRepo.js';
import { ttl } from '../src/config/ttl.js';

let app: FastifyInstance;

beforeEach(async () => {
  app = await buildApp({ disableLogger: true });
  await app.ready();
});

async function loginUser(openid: string): Promise<{ userId: string }> {
  setWxFetchForTests(
    (async (): Promise<Response> => {
      return new Response(JSON.stringify({ openid, session_key: 'sk' }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    }) as unknown as typeof fetch,
  );
  const res = await app.inject({ method: 'POST', url: '/v1/auth/wx-login', payload: { code: `c-${openid}` } });
  return { userId: (res.json() as { user: { id: string } }).user.id };
}

async function insertCreatedOrder(
  userId: string,
  overrides: Record<string, unknown> = {},
): Promise<string> {
  const outTradeNo = 'T' + randomUUID().replace(/-/g, '').slice(0, 30);
  await getPool().query(
    `INSERT INTO tip_orders (
       id, user_id, openid, product_type, product_key, product_title, wx_product_id,
       price_cents, support_delta, entitlement_keys, out_trade_no, status, next_probe_at,
       created_at, probe_count, last_probed_at
     ) VALUES ($1,$2,$3,'tip','coffee','请开发者喝一杯咖啡','coffee',990,99,$4,$5,'created',$6,$7,$8,$9)`,
    [
      randomUUID(),
      userId,
      overrides['openid'] ?? 'openid-x',
      ['supporter_badge'],
      outTradeNo,
      overrides['next_probe_at'] ?? new Date(Date.now() - 1000), // 默认已到期
      overrides['created_at'] ?? new Date(),
      overrides['probe_count'] ?? 0,
      overrides['last_probed_at'] ?? null,
    ],
  );
  return outTradeNo;
}

function mockStableToken(): void {
  setAccessTokenFetchForTests(
    (async (): Promise<Response> => {
      return new Response(JSON.stringify({ access_token: 'tk', expires_in: 7200 }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    }) as unknown as typeof fetch,
  );
}

function mockQueryOrder(
  impl: (body: Record<string, unknown>) => unknown,
): { calls: Array<Record<string, unknown>> } {
  const calls: Array<Record<string, unknown>> = [];
  setVirtualPayFetchForTests(
    (async (_input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
      const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
      calls.push(body);
      return new Response(JSON.stringify(impl(body)), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    }) as unknown as typeof fetch,
  );
  return { calls };
}

async function getRow(outTradeNo: string): Promise<Record<string, unknown>> {
  const r = await getPool().query(`SELECT * FROM tip_orders WHERE out_trade_no = $1`, [outTradeNo]);
  return r.rows[0] as Record<string, unknown>;
}

describe('tipReconcileScheduler', () => {
  it('T1 · commit-before-fetch：query_order 发起时调度字段已提交', async () => {
    const { userId } = await loginUser('openid-t1');
    const outTradeNo = await insertCreatedOrder(userId);
    mockStableToken();

    let probeCountAtFetchTime: number | null = null;
    let lastProbedAtFetchTime: unknown = null;
    mockQueryOrder((body) => {
      // fetch 发生时同步读库（claim 必须已提交）
      return getPool()
        .query(`SELECT probe_count, last_probed_at FROM tip_orders WHERE out_trade_no = $1`, [body['order_id']])
        .then((r) => {
          probeCountAtFetchTime = Number(r.rows[0].probe_count);
          lastProbedAtFetchTime = r.rows[0].last_probed_at;
          return { errcode: 0, order: { status: 1, order_type: 0, order_id: body['order_id'], order_fee: 990 } };
        });
    });

    await app.tipReconcileScheduler!.tickOnce();
    expect(probeCountAtFetchTime).toBe(1);
    expect(lastProbedAtFetchTime).not.toBeNull();
    const row = await getRow(outTradeNo);
    expect(row['status']).toBe('created'); // 未支付 ⇒ 保持 created
    expect(Number(row['probe_count'])).toBe(1);
  });

  it('T2 · 节奏表：1→T+5min · 2→T+10min · 3→T+30min · ≥4→created_at+windowSec+1s', () => {
    const createdAt = new Date('2026-09-04T00:00:00Z');
    const windowSec = ttl().tipProbeWindowSec;
    expect(nextProbeAtAfterClaim(createdAt, 1, windowSec).getTime() - createdAt.getTime()).toBe(300_000);
    expect(nextProbeAtAfterClaim(createdAt, 2, windowSec).getTime() - createdAt.getTime()).toBe(600_000);
    expect(nextProbeAtAfterClaim(createdAt, 3, windowSec).getTime() - createdAt.getTime()).toBe(1_800_000);
    expect(nextProbeAtAfterClaim(createdAt, 4, windowSec).getTime() - createdAt.getTime()).toBe(
      (windowSec + 1) * 1000,
    );
    expect(nextProbeAtAfterClaim(createdAt, 99, windowSec).getTime() - createdAt.getTime()).toBe(
      (windowSec + 1) * 1000,
    );
  });

  it('T3 · 窗口外 + 未支付 ⇒ mark_expired；之后 5 个 tick 查询次数不增（≤1 次）', async () => {
    const { userId } = await loginUser('openid-t3');
    const createdAt = new Date(Date.now() - 31 * 60 * 1000); // 31 分钟前（越过 30min 窗口）
    const outTradeNo = await insertCreatedOrder(userId, {
      created_at: createdAt,
      probe_count: 4,
      next_probe_at: new Date(Date.now() - 1000),
    });
    mockStableToken();
    const { calls } = mockQueryOrder((body) => ({
      errcode: 0,
      order: { status: 1, order_type: 0, order_id: body['order_id'], order_fee: 990 },
    }));

    await app.tipReconcileScheduler!.tickOnce();
    expect(calls.length).toBe(1);
    expect((await getRow(outTradeNo))['status']).toBe('expired');

    // 终态后连续 5 个 tick：查询次数不得再增（probe_due 索引排除非 created）
    for (let i = 0; i < 5; i++) {
      await app.tipReconcileScheduler!.tickOnce();
    }
    expect(calls.length).toBe(1);
  });

  it('T4 · 加速探测（summary claimProbe）不改动 probe_count/next_probe_at', async () => {
    const { userId } = await loginUser('openid-t4');
    const futureProbe = new Date(Date.now() + 120_000);
    const outTradeNo = await insertCreatedOrder(userId, { next_probe_at: futureProbe });
    mockStableToken();
    mockQueryOrder((body) => ({
      errcode: 0,
      order: { status: 1, order_type: 0, order_id: body['order_id'], order_fee: 990 },
    }));

    // 直接走 claimProbe 加速路径（等价 webhook/summary 触发）
    const { claimProbe } = await import('../src/repositories/tipOrderRepo.js');
    const claimed = await claimProbe(outTradeNo, ttl().tipProbeMinIntervalSec);
    expect(claimed).toBe(true);

    const row = await getRow(outTradeNo);
    expect(Number(row['probe_count'])).toBe(0); // 未被调度器推进
    expect(new Date(row['next_probe_at'] as string).getTime()).toBe(futureProbe.getTime());
    expect(row['last_probed_at']).not.toBeNull(); // 租约时间戳已更新
  });

  it('T5 · 源码无 SKIP LOCKED（pg-mem 兼容静态检查）；settleOrder 不锁 users 行', () => {
    const files = [
      'src/repositories/tipOrderRepo.ts',
      'src/services/tipService.ts',
      'src/services/tipReconcileScheduler.ts',
    ];
    for (const f of files) {
      // vitest 从 server/ 目录运行（tsconfig module=CommonJS · 不可用 import.meta）
      const src = readFileSync(`${process.cwd()}/${f}`, 'utf8');
      expect(src.includes('SKIP LOCKED'), `${f} must not use SKIP LOCKED`).toBe(false);
    }
    // settleOrder 只锁 tip_orders 单行：事务内不得出现 users 表 FOR UPDATE（防死锁面扩散回退）
    const svcSrc = readFileSync(`${process.cwd()}/src/services/tipService.ts`, 'utf8');
    const settleBody = svcSrc.slice(svcSrc.indexOf('export async function settleOrder'));
    expect(/users[^']*FOR UPDATE/i.test(settleBody)).toBe(false);
  });

  it('T6 · paid ⇒ settle 交付（调度器端到端：created → delivered + 平台单号回填）', async () => {
    const { userId } = await loginUser('openid-t6');
    const outTradeNo = await insertCreatedOrder(userId);
    mockStableToken();
    mockQueryOrder((body) => ({
      errcode: 0,
      env_type: 1,
      biz_meta: 'costra-tip-v1',
      order: {
        status: 4,
        order_type: 0,
        order_id: body['order_id'],
        order_fee: 990,
        wx_order_id: 'wx-mch-t6',
        wxpay_order_id: 'tx-t6',
        paid_time: 1_800_000_000,
        paid_fee: 990,
      },
    }));

    await app.tipReconcileScheduler!.tickOnce();
    const row = await getRow(outTradeNo);
    expect(row).toMatchObject({
      status: 'delivered',
      wx_order_id: 'wx-mch-t6',
      wxpay_order_id: 'tx-t6',
      upstream_status: 4,
    });
    expect(row['delivered_at']).not.toBeNull();
  });

  it('T7 · conflict 窗口外 ⇒ mark_expired 收口；之后 5 个 tick 查询次数不增（P0-A 回归）', async () => {
    const { userId } = await loginUser('openid-t7');
    const createdAt = new Date(Date.now() - 31 * 60 * 1000); // 31 分钟前（越过 30min 窗口）
    const outTradeNo = await insertCreatedOrder(userId, {
      created_at: createdAt,
      probe_count: 4,
      next_probe_at: new Date(Date.now() - 1000),
    });
    mockStableToken();
    // order_fee 与本地快照（990）不一致 ⇒ validate 判 conflict；窗口外必须收口 expired
    const { calls } = mockQueryOrder((body) => ({
      errcode: 0,
      order: { status: 4, order_type: 0, order_id: body['order_id'], order_fee: 100 },
    }));

    await app.tipReconcileScheduler!.tickOnce();
    expect(calls.length).toBe(1);
    expect((await getRow(outTradeNo))['status']).toBe('expired');

    for (let i = 0; i < 5; i++) {
      await app.tipReconcileScheduler!.tickOnce();
    }
    expect(calls.length).toBe(1);
  });
});
