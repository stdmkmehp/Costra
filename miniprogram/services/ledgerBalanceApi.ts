// services/ledgerBalanceApi.ts · 账本资产 API + 本地缓存
// 卡号：COSTRA-4xx · 事实源：docs/design/asset-and-budget-spec.md §5
//
// 职责：
//   - fetchLedgerBalance：主动拉取资产 → GET /ledgers/:id/balance（明细页首屏即时校准）
//   - rebaseLedgerBalance：修改资产 → PATCH /ledgers/:id/balance
//   - sync-pull 接收 ledger 增量时调 applyLedgerBalanceFromSync 更新本地缓存
//   - getCachedLedgerBalance*：本地读取（内存 + storage）
//
// 缓存策略：
//   - 内存缓存 + storage 持久化（key: `ledger_balance:${ledger_id}`）
//   - 主动拉取 / sync-pull / login-bootstrap 自动写入
//   - 明细页读时优先命中内存，无则降级到 storage
//
// 客户端不本地累加资产（服务端权威）；
// 修改资产时乐观锁失败 → 抛冲突让 UI 弹冲突弹窗（不静默覆盖敏感字段）。
//
// 资产更新双通道：
//   1) 主动拉取 GET /ledgers/:id/balance（首屏等不了 sync 时即时校准）
//   2) sync-pull 下发的 ledgers[] 增量（协作端修改 / 记账后同步校准）

import { request, ApiError } from './request';
import { getItem, setItem } from './storage';
import { logger } from '../utils/logger';

export interface LedgerBalance {
  ledger_id: string;
  balance_cents: number;
  balance_baseline_seq: number;
  balance_version: number;
  /** 客户端拉取/同步时间戳 · 用于判断缓存新鲜度 */
  fetched_at: number;
}

const MEMORY_CACHE = new Map<string, LedgerBalance>();
const TTL_MS = 5 * 60 * 1000; // 5 分钟内的内存缓存视为新鲜

function cacheKey(ledgerId: string): string {
  return `ledger_balance:${ledgerId}`;
}

/**
 * 从内存读取资产缓存（不发起网络请求）。
 * 用于明细页快速渲染。
 */
export function getCachedLedgerBalance(ledgerId: string): LedgerBalance | null {
  return MEMORY_CACHE.get(ledgerId) ?? null;
}

/**
 * 从 storage 读取资产缓存（冷启动后内存尚未预热时用）。
 */
export async function getCachedLedgerBalanceFromStorage(ledgerId: string): Promise<LedgerBalance | null> {
  const cached = MEMORY_CACHE.get(ledgerId);
  if (cached) return cached;
  const stored = await getItem<LedgerBalance>(cacheKey(ledgerId));
  if (stored) {
    MEMORY_CACHE.set(ledgerId, stored);
    return stored;
  }
  return null;
}

/**
 * 修改账本资产（重锚）。
 *
 * 失败处理：
 *   - 409 VERSION_CONFLICT：抛出 ApiError(status=409)，UI 据此弹冲突弹窗
 *   - 其他错误：直接 throw（UI 走通用错误处理）
 */
export async function rebaseLedgerBalance(
  ledgerId: string,
  newBalanceCents: number,
  clientBaseVersion: number,
): Promise<LedgerBalance> {
  const resp = await request<{
    balance_cents: number;
    balance_baseline_seq: number;
    balance_version: number;
  }>({
    method: 'PATCH',
    path: `/ledgers/${ledgerId}/balance`,
    body: {
      balance_cents: newBalanceCents,
      balance_version: clientBaseVersion,
    },
  });

  const balance: LedgerBalance = {
    ledger_id: ledgerId,
    balance_cents: resp.balance_cents,
    balance_baseline_seq: resp.balance_baseline_seq,
    balance_version: resp.balance_version,
    fetched_at: Date.now(),
  };
  await applyLedgerBalance(balance);
  return balance;
}

/**
 * 主动拉取账本资产（GET /ledgers/:id/balance）。
 *
 * 与预算的 fetchBudget 对齐：明细页首屏先读缓存即时渲染，再主动拉服务端权威值校准，
 * 避免首次进入干等 sync-pull 下发的 ledgers[] 才更新资产。
 *
 * 失败处理：
 *   - 404 / 403：账本不可读，返回 null（UI 降级显示上次缓存或 '--'）
 *   - 其他错误：静默返回 null，不打断首屏（资产由 sync-pull 通道兜底）
 */
export async function fetchLedgerBalance(ledgerId: string): Promise<LedgerBalance | null> {
  try {
    const resp = await request<{
      balance_cents: number;
      balance_baseline_seq: number;
      balance_version: number;
    }>({
      method: 'GET',
      path: `/ledgers/${ledgerId}/balance`,
    });

    const balance: LedgerBalance = {
      ledger_id: ledgerId,
      balance_cents: resp.balance_cents,
      balance_baseline_seq: resp.balance_baseline_seq,
      balance_version: resp.balance_version,
      fetched_at: Date.now(),
    };
    await applyLedgerBalance(balance);
    return balance;
  } catch (err) {
    logger.warn('ledgerBalanceApi', 'fetchLedgerBalance failed', err);
    return null;
  }
}

/**
 * 把服务端 sync-pull 下发的 ledger 增量数据写入本地缓存。
 *
 * 调用方：services/sync.ts 在 applyServerChanges 之后调用
 *   for (const wireLedger of changes.ledgers || []) { applyLedgerBalanceFromSync(wireLedger); }
 */
export async function applyLedgerBalanceFromSync(wire: {
  id: string;
  balance_cents?: number;
  balance_baseline_seq?: number;
  balance_version?: number;
}): Promise<void> {
  if (wire.balance_cents == null || wire.balance_baseline_seq == null || wire.balance_version == null) {
    return; // 旧版 ledger 增量可能不含 balance 字段
  }
  const balance: LedgerBalance = {
    ledger_id: wire.id,
    balance_cents: wire.balance_cents,
    balance_baseline_seq: wire.balance_baseline_seq,
    balance_version: wire.balance_version,
    fetched_at: Date.now(),
  };
  await applyLedgerBalance(balance);
}

/**
 * 内部统一写入：内存 + storage。
 */
async function applyLedgerBalance(balance: LedgerBalance): Promise<void> {
  MEMORY_CACHE.set(balance.ledger_id, balance);
  await setItem(cacheKey(balance.ledger_id), balance);
}

/**
 * 清除缓存（logout 时调）。
 */
export function clearLedgerBalanceCache(): void {
  MEMORY_CACHE.clear();
}

/**
 * 判断缓存是否仍新鲜（TTL 内）。
 */
export function isCacheFresh(balance: LedgerBalance): boolean {
  return Date.now() - balance.fetched_at < TTL_MS;
}

// 消除未使用 import 警告（logger 保留供后续扩展使用）
void logger;

