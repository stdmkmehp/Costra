/**
 * Costra · Server · tip_orders DAO（+ users.tip_badge_hidden）
 *
 * 事实源：docs/design/monetization-tipping-tech-spec.md v1.2 §3.2/§3.4/§4.4/§4.6/§6.1
 *
 * 并发设计：
 *   - claimProbe（webhook/summary 探测租约）：单条条件 UPDATE，READ COMMITTED 下
 *     EPQ 重检保证并发只有一方命中（rowCount=1）；等价语义于 spec §4.6.1 的子查询形式。
 *   - claimSweepBatch（调度器批量领取）：advisory lock 由调度器持有（实例级单飞），
 *     事务内 SELECT ... FOR UPDATE 取批 + 逐行推进 probe_count/next_probe_at/last_probed_at，
 *     提交后才发起任何微信 fetch（commit-before-fetch 由调度器保证）。
 *   - settleOrder 条件 UPDATE created→delivered（T1 单行原子迁移），由 service 层在事务中组合。
 */

import { getPool } from '../db/pool.js';
import type { TipProduct } from '../config/tipProducts.js';

export type TipOrderStatus = 'created' | 'delivered' | 'refunded' | 'expired';

export interface TipOrderEntity {
  id: string;
  userId: string;
  openid: string;
  productType: string;
  productKey: string;
  productTitle: string;
  wxProductId: string;
  priceCents: number;
  supportDelta: number;
  entitlementKeys: string[];
  upstreamOrderType: number | null;
  outTradeNo: string;
  wxOrderId: string | null;
  channelOrderId: string | null;
  wxpayOrderId: string | null;
  upstreamStatus: number | null;
  status: TipOrderStatus;
  createdAt: Date;
  paidAt: Date | null;
  deliveredAt: Date | null;
  refundedAt: Date | null;
  lastProbedAt: Date | null;
  nextProbeAt: Date;
  probeCount: number;
  updatedAt: Date;
}

type Row = Record<string, unknown>;

export type Runner = {
  query: (sql: string, params?: unknown[]) => Promise<{ rows: Row[]; rowCount?: number | null }>;
};

function exec(): Runner {
  return getPool() as unknown as Runner;
}

const COLUMNS = `id, user_id, openid, product_type, product_key, product_title, wx_product_id,
  price_cents, support_delta, entitlement_keys, upstream_order_type,
  out_trade_no, wx_order_id, channel_order_id, wxpay_order_id, upstream_status,
  status, created_at, paid_at, delivered_at, refunded_at, last_probed_at, next_probe_at,
  probe_count, updated_at`;

function num(v: unknown): number | null {
  if (v == null) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function dateOrNull(v: unknown): Date | null {
  return v instanceof Date ? v : v == null ? null : new Date(String(v));
}

export function rowToEntity(r: Row): TipOrderEntity {
  return {
    id: String(r['id']),
    userId: String(r['user_id']),
    openid: String(r['openid']),
    productType: String(r['product_type']),
    productKey: String(r['product_key']),
    productTitle: String(r['product_title']),
    wxProductId: String(r['wx_product_id']),
    priceCents: Number(r['price_cents']),
    supportDelta: Number(r['support_delta']),
    entitlementKeys: (r['entitlement_keys'] as string[]) ?? [],
    upstreamOrderType: num(r['upstream_order_type']),
    outTradeNo: String(r['out_trade_no']),
    wxOrderId: (r['wx_order_id'] as string | null) ?? null,
    channelOrderId: (r['channel_order_id'] as string | null) ?? null,
    wxpayOrderId: (r['wxpay_order_id'] as string | null) ?? null,
    upstreamStatus: num(r['upstream_status']),
    status: r['status'] as TipOrderStatus,
    createdAt: dateOrNull(r['created_at']) ?? new Date(0),
    paidAt: dateOrNull(r['paid_at']),
    deliveredAt: dateOrNull(r['delivered_at']),
    refundedAt: dateOrNull(r['refunded_at']),
    lastProbedAt: dateOrNull(r['last_probed_at']),
    nextProbeAt: dateOrNull(r['next_probe_at']) ?? new Date(0),
    probeCount: Number(r['probe_count']),
    updatedAt: dateOrNull(r['updated_at']) ?? new Date(0),
  };
}

// ─── 创建 / 查询 ─────────────────────────────────────────────────────────────

/** 创建 created 单（商品目录快照一次写齐 · next_probe_at 由调用方给 created_at + 120s）。 */
export async function insertOrder(
  input: {
    id: string;
    userId: string;
    openid: string;
    product: TipProduct;
    outTradeNo: string;
    nextProbeAt: Date;
  },
  client?: Runner,
): Promise<TipOrderEntity> {
  const runner = client ?? exec();
  const p = input.product;
  const res = await runner.query(
    `INSERT INTO tip_orders (
       id, user_id, openid, product_type, product_key, product_title, wx_product_id,
       price_cents, support_delta, entitlement_keys, out_trade_no, status, next_probe_at
     ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,'created',$12)
     RETURNING ${COLUMNS}`,
    [
      input.id, input.userId, input.openid, p.type, p.productKey, p.title, p.wxProductId,
      p.priceCents, p.supportDelta, p.entitlementKeys, input.outTradeNo, input.nextProbeAt,
    ],
  );
  if (!res.rows[0]) throw new Error('[tipOrderRepo] INSERT returned no row');
  return rowToEntity(res.rows[0]);
}

export async function findByOutTradeNo(outTradeNo: string, client?: Runner): Promise<TipOrderEntity | null> {
  const runner = client ?? exec();
  const res = await runner.query(`SELECT ${COLUMNS} FROM tip_orders WHERE out_trade_no = $1 LIMIT 1`, [outTradeNo]);
  return res.rows[0] ? rowToEntity(res.rows[0]) : null;
}

/** 用户日限计数（soft 20 单/日 · count(*) 全状态 · tech-spec §4.1.2 步骤 1） */
export async function countOrdersSince(userId: string, since: Date, client?: Runner): Promise<number> {
  const runner = client ?? exec();
  const res = await runner.query(
    `SELECT count(*) AS c FROM tip_orders WHERE user_id = $1 AND created_at > $2`,
    [userId, since],
  );
  return Number(res.rows[0]?.['c'] ?? 0);
}

/** 本人最近一张 created 单（summary 每次最多 probe 一单 · ORDER BY created_at DESC LIMIT 1） */
export async function findLatestCreatedWithin(
  userId: string,
  since: Date,
  client?: Runner,
): Promise<TipOrderEntity | null> {
  const runner = client ?? exec();
  const res = await runner.query(
    `SELECT ${COLUMNS} FROM tip_orders
      WHERE user_id = $1 AND status = 'created' AND created_at >= $2
      ORDER BY created_at DESC
      LIMIT 1`,
    [userId, since],
  );
  return res.rows[0] ? rowToEntity(res.rows[0]) : null;
}

// ─── 探测租约（webhook / summary · tech-spec §4.6.1） ─────────────────────────

/**
 * 领取单张 created 单的探测租约：仅当距上次探测超过 minIntervalSec（或从未探测）才命中。
 * 条件 UPDATE 原子执行 ⇒ 并发只有一方 rowCount=1（EPQ 重检），等价 spec §4.6.1 子查询形式。
 * 注：只推进 last_probed_at；probe_count/next_probe_at 只由对账调度器推进（本函数不触碰）。
 */
export async function claimProbe(
  outTradeNo: string,
  minIntervalSec: number,
  client?: Runner,
): Promise<boolean> {
  const runner = client ?? exec();
  const threshold = new Date(Date.now() - minIntervalSec * 1000);
  const res = await runner.query(
    `UPDATE tip_orders
        SET last_probed_at = now(), updated_at = now()
      WHERE out_trade_no = $1
        AND status = 'created'
        AND (last_probed_at IS NULL OR last_probed_at <= $2)`,
    [outTradeNo, threshold],
  );
  return (res.rowCount ?? 0) > 0;
}

// ─── 调度器批量领取（在调用方事务内使用 · tech-spec §6.1） ────────────────────

/** 领取候选：FOR UPDATE 行锁（调用方须已开启事务并持有 advisory lock）。 */
export async function lockProbeCandidates(now: Date, batchSize: number, client: Runner): Promise<TipOrderEntity[]> {
  const res = await client.query(
    `SELECT ${COLUMNS} FROM tip_orders
      WHERE status = 'created' AND next_probe_at <= $1
      ORDER BY next_probe_at ASC
      LIMIT $2
      FOR UPDATE`,
    [now, batchSize],
  );
  return res.rows.map(rowToEntity);
}

/**
 * 节奏表（tech-spec §6.1）：probe_count（自增后）→ 下一次探测相对 created_at 的偏移。
 *   1 ⇒ T+5min · 2 ⇒ T+10min · 3 ⇒ T+30min · >=4 ⇒ created_at + windowSec + 1s（越过 T3 边界）
 */
export function nextProbeAtAfterClaim(createdAt: Date, newProbeCount: number, windowSec: number): Date {
  if (newProbeCount >= 4) {
    return new Date(createdAt.getTime() + (windowSec + 1) * 1000);
  }
  const offsetSec = newProbeCount === 1 ? 300 : newProbeCount === 2 ? 600 : 1800;
  return new Date(createdAt.getTime() + offsetSec * 1000);
}

/** 领取后推进调度字段（同事务 · probe_count+1 + next_probe_at 节奏表 + last_probed_at）。 */
export async function markClaimed(
  order: TipOrderEntity,
  windowSec: number,
  client: Runner,
): Promise<TipOrderEntity> {
  const newCount = order.probeCount + 1;
  const nextProbeAt = nextProbeAtAfterClaim(order.createdAt, newCount, windowSec);
  const res = await client.query(
    `UPDATE tip_orders
        SET probe_count = $2, next_probe_at = $3, last_probed_at = now(), updated_at = now()
      WHERE id = $1
      RETURNING ${COLUMNS}`,
    [order.id, newCount, nextProbeAt],
  );
  if (!res.rows[0]) throw new Error('[tipOrderRepo] markClaimed UPDATE returned no row');
  return rowToEntity(res.rows[0]);
}

// ─── 终态迁移原语（service 层在事务/条件更新中组合） ──────────────────────────

/** 行锁读取（settleOrder 事务内 · FOR UPDATE）。 */
export async function lockByOutTradeNo(outTradeNo: string, client: Runner): Promise<TipOrderEntity | null> {
  const res = await client.query(
    `SELECT ${COLUMNS} FROM tip_orders WHERE out_trade_no = $1 LIMIT 1 FOR UPDATE`,
    [outTradeNo],
  );
  return res.rows[0] ? rowToEntity(res.rows[0]) : null;
}

/** wx_order_id 撞单检测（CI3 · 同一下游支付单不可映射两单）。 */
export async function existsWxOrderIdOnOtherOrder(
  wxOrderId: string,
  excludeOutTradeNo: string,
  client: Runner,
): Promise<boolean> {
  const res = await client.query(
    `SELECT 1 AS one FROM tip_orders WHERE wx_order_id = $1 AND out_trade_no <> $2 LIMIT 1`,
    [wxOrderId, excludeOutTradeNo],
  );
  return res.rows.length > 0;
}

/**
 * 条件迁移 created→delivered（T1 · 单行原子 · rowCount 必须为 1）。
 * @returns 实际更新行数（0 ⇒ 已被并发迁移 · 上层按幂等/冲突处理）
 */
export async function conditionalDeliver(
  input: {
    outTradeNo: string;
    wxOrderId: string | null;
    channelOrderId: string | null;
    wxpayOrderId: string | null;
    upstreamStatus: number;
    upstreamOrderType: number | null;
    paidAt: Date;
  },
  client: Runner,
): Promise<number> {
  const res = await client.query(
    `UPDATE tip_orders
        SET status = 'delivered', delivered_at = now(), paid_at = $2,
            wx_order_id = $3, channel_order_id = $4, wxpay_order_id = $5,
            upstream_status = $6, upstream_order_type = $7, updated_at = now()
      WHERE out_trade_no = $1 AND status = 'created'`,
    [
      input.outTradeNo, input.paidAt, input.wxOrderId, input.channelOrderId, input.wxpayOrderId,
      input.upstreamStatus, input.upstreamOrderType,
    ],
  );
  return res.rowCount ?? 0;
}

/** delivered 幂等成功：只补齐平台 ID（不改动资金字段 · 调用方须先完成冲突校验）。 */
export async function backfillPlatformIds(
  input: {
    outTradeNo: string;
    wxOrderId: string | null;
    channelOrderId: string | null;
    wxpayOrderId: string | null;
    upstreamStatus: number;
    upstreamOrderType: number | null;
  },
  client: Runner,
): Promise<void> {
  await client.query(
    `UPDATE tip_orders
        SET wx_order_id = COALESCE(wx_order_id, $2),
            channel_order_id = COALESCE(channel_order_id, $3),
            wxpay_order_id = COALESCE(wxpay_order_id, $4),
            upstream_status = $5, upstream_order_type = $6, updated_at = now()
      WHERE out_trade_no = $1 AND status = 'delivered'`,
    [
      input.outTradeNo, input.wxOrderId, input.channelOrderId, input.wxpayOrderId,
      input.upstreamStatus, input.upstreamOrderType,
    ],
  );
}

/**
 * 退款：created/delivered → refunded（资金回退事实 · 幂等条件更新）。
 * `upstreamOrderType` 落 query_order 的 order_type **原值**（§4.3.1：不映射、不因无法识别而丢弃）；
 * 上游未返回时用 COALESCE 保留此前已记录的原值。
 */
export async function markRefunded(
  input: {
    outTradeNo: string;
    upstreamStatus: number;
    upstreamOrderType: number | null;
    paidAt: Date | null;
  },
  client?: Runner,
): Promise<boolean> {
  const runner = client ?? exec();
  const res = await runner.query(
    `UPDATE tip_orders
        SET status = 'refunded', refunded_at = now(),
            paid_at = COALESCE(paid_at, $2),
            upstream_status = $3,
            upstream_order_type = COALESCE($4, upstream_order_type),
            updated_at = now()
      WHERE out_trade_no = $1 AND status IN ('created', 'delivered')`,
    [input.outTradeNo, input.paidAt, input.upstreamStatus, input.upstreamOrderType],
  );
  return (res.rowCount ?? 0) > 0;
}

/** 过期：created → expired（T3 窗口收口 / closed 6 · 幂等条件更新 · order_type 落原值）。 */
export async function markExpired(
  input: { outTradeNo: string; upstreamStatus: number | null; upstreamOrderType: number | null },
  client?: Runner,
): Promise<boolean> {
  const runner = client ?? exec();
  const res = await runner.query(
    `UPDATE tip_orders
        SET status = 'expired',
            upstream_status = COALESCE($2, upstream_status),
            upstream_order_type = COALESCE($3, upstream_order_type),
            updated_at = now()
      WHERE out_trade_no = $1 AND status = 'created'`,
    [input.outTradeNo, input.upstreamStatus, input.upstreamOrderType],
  );
  return (res.rowCount ?? 0) > 0;
}

/** keep_* / retry / manual_conflict 留痕：仅 created 单镜像最近上游快照（不改资金状态）。 */
export async function updateUpstreamSnapshot(
  input: { outTradeNo: string; upstreamStatus: number | null; upstreamOrderType: number | null },
  client?: Runner,
): Promise<void> {
  const runner = client ?? exec();
  await runner.query(
    `UPDATE tip_orders
        SET upstream_status = COALESCE($2, upstream_status),
            upstream_order_type = COALESCE($3, upstream_order_type),
            updated_at = now()
      WHERE out_trade_no = $1 AND status = 'created'`,
    [input.outTradeNo, input.upstreamStatus, input.upstreamOrderType],
  );
}

// ─── 派生权益 / 历史 / 徽章可见性（tech-spec §3.4 · 统一 status ANY + delivered_at 非空） ──

const SETTLED_STATUSES = ['delivered', 'refunded'];

export interface TipSummaryAggregate {
  tipCount: number;
  supportScore: number;
  /** 首次发放时间（MIN(delivered_at)） */
  grantedAt: Date | null;
}

/**
 * 派生权益聚合：tip_count / support_score（订单快照 support_delta 求和）/ granted_at。
 * created→refunded 未发货单（delivered_at 为 NULL）一律不计入（R9 断言 A/B）。
 */
export async function aggregateTipSummary(userId: string, client?: Runner): Promise<TipSummaryAggregate> {
  const runner = client ?? exec();
  const res = await runner.query(
    `SELECT count(*) AS tip_count,
            COALESCE(sum(support_delta), 0) AS support_score,
            min(delivered_at) AS granted_at
       FROM tip_orders
      WHERE user_id = $1
        AND status = ANY($2)
        AND delivered_at IS NOT NULL`,
    [userId, SETTLED_STATUSES],
  );
  const row = res.rows[0];
  return {
    tipCount: Number(row?.['tip_count'] ?? 0),
    supportScore: Number(row?.['support_score'] ?? 0),
    grantedAt: dateOrNull(row?.['granted_at']),
  };
}

export interface TipEntitlement {
  key: string;
  /** 首次发放时间（该 key 维度 MIN(delivered_at)） */
  grantedAt: Date | null;
}

/**
 * 通用权益派生（tech-spec §3.4 / §7.3）：已结算订单的 entitlement_keys 快照按 key 聚合，
 * granted_at = 该 key 的 MIN(delivered_at)。不硬编码任何 key——未来皮肤新增权益 key
 * 不需要改协议或查询（§3.4「与徽章共用同一段派生逻辑」）。
 * 单用户订单量个位数（§3.4），JS 侧聚合等价 unnest+GROUP BY，且规避 pg-mem 对 unnest 的支持风险。
 */
export async function deriveEntitlements(userId: string, client?: Runner): Promise<TipEntitlement[]> {
  const runner = client ?? exec();
  const res = await runner.query(
    `SELECT entitlement_keys, delivered_at
       FROM tip_orders
      WHERE user_id = $1
        AND status = ANY($2)
        AND delivered_at IS NOT NULL`,
    [userId, SETTLED_STATUSES],
  );
  const byKey = new Map<string, Date>();
  for (const r of res.rows) {
    const deliveredAt = dateOrNull(r['delivered_at']);
    if (!deliveredAt) continue;
    for (const key of (r['entitlement_keys'] as string[]) ?? []) {
      const prev = byKey.get(key);
      if (!prev || deliveredAt < prev) byKey.set(key, deliveredAt);
    }
  }
  return [...byKey.entries()]
    .map(([key, grantedAt]) => ({ key, grantedAt }))
    .sort((a, b) => a.key.localeCompare(b.key));
}

/** 是否存在 created 单（has_pending_orders）。 */
export async function hasPendingOrder(userId: string, client?: Runner): Promise<boolean> {
  const runner = client ?? exec();
  const res = await runner.query(
    `SELECT EXISTS(SELECT 1 FROM tip_orders WHERE user_id = $1 AND status = 'created') AS has`,
    [userId],
  );
  return res.rows[0]?.['has'] === true;
}

export interface TipHistoryItem {
  /** 本人业务单号：客户端 settling 判定「本单是否已发货」的唯一精确依据（§4.6） */
  outTradeNo: string;
  time: Date;
  title: string;
  status: TipOrderStatus;
  supportDelta: number;
}

/** 最近 N 条已结算单（status IN delivered/refunded · 按 delivered_at 倒序）。 */
export async function listSettledHistory(userId: string, limit: number, client?: Runner): Promise<TipHistoryItem[]> {
  const runner = client ?? exec();
  const res = await runner.query(
    `SELECT out_trade_no, product_title, status, support_delta, delivered_at
       FROM tip_orders
      WHERE user_id = $1
        AND status = ANY($2)
        AND delivered_at IS NOT NULL
      ORDER BY delivered_at DESC
      LIMIT $3`,
    [userId, SETTLED_STATUSES, limit],
  );
  return res.rows.map((r) => ({
    outTradeNo: String(r['out_trade_no']),
    time: dateOrNull(r['delivered_at']) ?? new Date(0),
    title: String(r['product_title']),
    status: r['status'] as TipOrderStatus,
    supportDelta: Number(r['support_delta']),
  }));
}

/** 读徽章可见性（users.tip_badge_hidden NOT NULL DEFAULT FALSE）。 */
export async function getBadgeHidden(userId: string, client?: Runner): Promise<boolean> {
  const runner = client ?? exec();
  const res = await runner.query(`SELECT tip_badge_hidden FROM users WHERE id = $1 LIMIT 1`, [userId]);
  return res.rows[0]?.['tip_badge_hidden'] === true;
}

export async function setBadgeHidden(userId: string, hidden: boolean, client?: Runner): Promise<void> {
  const runner = client ?? exec();
  await runner.query(
    `UPDATE users SET tip_badge_hidden = $2, updated_at = now() WHERE id = $1 AND deleted_at IS NULL`,
    [userId, hidden],
  );
}
