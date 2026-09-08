/**
 * Costra · Server · 赞赏对账调度器
 *
 * 事实源：docs/design/monetization-tipping-tech-spec.md v1.2 §6.1
 *
 * 架构（对齐 recurringScheduler 的进程内调度范式，差异在锁范围）：
 *   - Fastify 进程内 setInterval（默认 60s · ttl().tipSchedulerTickSec）
 *   - pg_try_advisory_lock（0x54495053 'TIPS'）保证多实例单飞
 *   - **锁范围最小化（commit-before-fetch）**：持锁期间只做
 *     SELECT ... FOR UPDATE 候选 → 同事务推进 probe_count/next_probe_at/last_probed_at → 提交；
 *     锁释放后才发起任何 query_order 微信 fetch。
 *   - 节奏表：probe_count 1→T+5min · 2→T+10min · 3→T+30min · ≥4→created_at+windowSec+1s
 *     （越过 T3 边界 ⇒ 下一拍由窗口判据终态化 · 见 tipOrderRepo.nextProbeAtAfterClaim）
 *
 * 测试友好性：
 *   - NODE_ENV === 'test' 时 setInterval 不启动，只暴露 tickOnce
 *   - advisory lock 在 pg-mem 环境下 mock（永远拿到）
 */

import type { PoolClient } from 'pg';
import { getPool } from '../db/pool.js';
import { ttl } from '../config/ttl.js';
import * as tipOrderRepo from '../repositories/tipOrderRepo.js';
import type { TipOrderEntity } from '../repositories/tipOrderRepo.js';
import type { ServiceLogger } from '../logger.js';
import { probeAndApply } from './tipService.js';

/** advisory lock 的 32-bit key · 'TIPS' in hex · 与 recurring 的 'RECU' 不冲突 */
const ADVISORY_LOCK_KEY = 0x54495053;

export interface TipReconcileScheduler {
  /** 启动 setInterval · test 环境自动跳过 */
  start(): void;
  /** 停止 setInterval */
  stop(): Promise<void>;
  /** 手动执行一次 tick · 供测试用 */
  tickOnce(): Promise<void>;
}

function isTestEnv(): boolean {
  return process.env.NODE_ENV === 'test';
}

async function tryAcquireLock(client: PoolClient): Promise<boolean> {
  if (isTestEnv()) return true; // pg-mem 不支持 pg_try_advisory_lock · mock 为永远拿到
  const res = await client.query<{ locked: boolean }>(
    `SELECT pg_try_advisory_lock($1) AS locked`,
    [ADVISORY_LOCK_KEY],
  );
  return res.rows[0]?.locked === true;
}

async function releaseLock(client: PoolClient): Promise<void> {
  if (isTestEnv()) return;
  try {
    await client.query(`SELECT pg_advisory_unlock($1)`, [ADVISORY_LOCK_KEY]);
  } catch {
    // 断连时锁已被 PG 自动释放，忽略解锁失败
  }
}

/**
 * @param opts.log 由 buildApp 注入 app.log.child({ module: 'tipReconcileScheduler' }) · 禁止模块自建 pino
 */
export function createTipReconcileScheduler(opts: { log: ServiceLogger }): TipReconcileScheduler {
  const logger = opts.log;
  let timerHandle: NodeJS.Timeout | null = null;
  let ticking = false;

  /**
   * 持锁领取一批到期 created 单并推进调度字段（commit-before-fetch 的前半段）。
   * 返回时已释放锁与事务，后续 query_order 不占用任何锁。
   */
  async function claimBatch(): Promise<TipOrderEntity[]> {
    const pool = getPool();
    const client = await pool.connect();
    let gotLock = false;
    try {
      gotLock = await tryAcquireLock(client);
      if (!gotLock) return [];

      await client.query('BEGIN');
      try {
        const candidates = await tipOrderRepo.lockProbeCandidates(
          new Date(),
          ttl().tipProbeBatchSize,
          client,
        );
        const claimed: TipOrderEntity[] = [];
        for (const c of candidates) {
          claimed.push(await tipOrderRepo.markClaimed(c, ttl().tipProbeWindowSec, client));
        }
        await client.query('COMMIT');
        return claimed;
      } catch (err) {
        try {
          await client.query('ROLLBACK');
        } catch {
          /* swallow · 保留原异常 */
        }
        throw err;
      }
    } finally {
      if (gotLock) await releaseLock(client);
      client.release();
    }
  }

  async function tickOnce(): Promise<void> {
    if (ticking) return; // 上一轮未跑完 ⇒ 跳过（单飞）
    ticking = true;
    try {
      // commit-before-fetch：领取并提交后才发起任何微信调用
      const claimed = await claimBatch();
      for (const order of claimed) {
        try {
          await probeAndApply(order, 'scheduler', logger);
        } catch (err) {
          logger.error(
            { err, outTradeNo: order.outTradeNo },
            'tip reconcile probe failed · next tick will retry by schedule',
          );
        }
      }
    } catch (err) {
      logger.error({ err }, 'tip reconcile tick failed');
    } finally {
      ticking = false;
    }
  }

  function start(): void {
    if (isTestEnv()) return;
    if (timerHandle != null) return;
    timerHandle = setInterval(() => {
      void tickOnce().catch(() => {
        // tickOnce 内部已捕获 · 这里兜底
      });
    }, ttl().tipSchedulerTickSec * 1000);
    timerHandle.unref?.();
  }

  async function stop(): Promise<void> {
    if (timerHandle != null) {
      clearInterval(timerHandle);
      timerHandle = null;
    }
  }

  return { start, stop, tickOnce };
}
