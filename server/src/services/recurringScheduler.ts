/**
 * Costra · Server · 定时记账调度器
 *
 * 卡号占位：COSTRA-5xx（T2 · Sprint-4 · Epic-E）
 * 事实源：docs/design/recurring-entry-tech-spec.md §3
 *
 * 架构：
 *   - Fastify 进程内 setInterval(60s)
 *   - pg_try_advisory_lock 保证多实例互斥（本期单实例，为未来准备）
 *   - FOR UPDATE SKIP LOCKED 拉候选 · 每条独立事务
 *   - 补齐 loop 逻辑在 recurringService.processOneRule
 *
 * 测试友好性：
 *   - NODE_ENV === 'test' 时 setInterval 不启动，只暴露 tickOnce
 *   - Advisory lock 在 pg-mem 环境下 mock（永远拿到）
 *   - 显式驱动：await scheduler.tickOnce(mockNow)
 */

import type { PoolClient } from 'pg';
import { getPool } from '../db/pool.js';
import * as recurringRepo from '../repositories/recurringRepo.js';
import type { RecurringRuleEntity } from '../repositories/recurringRepo.js';
import type { RecurringService, ProcessResult } from './recurringService.js';

// ==============================================================================
// 常量
// ==============================================================================

/** advisory lock 的 32-bit key · 任意固定值 · 与其它服务的 lock 不冲突 */
const ADVISORY_LOCK_KEY = 0x52454355; // 'RECU' in hex

const DEFAULT_TICK_INTERVAL_MS = 60_000;
const DEFAULT_TICK_BATCH_SIZE = 100;

// ==============================================================================
// 类型
// ==============================================================================

export interface SchedulerConfig {
  intervalMs?: number;
  batchSize?: number;
  /** 测试注入：让 tickOnce 使用指定的 now 而非 Date.now() */
  nowProvider?: () => Date;
}

export interface TickReport {
  now: Date;
  pickedCount: number;
  processedCount: number;
  failedCount: number;
  results: Array<{ ruleId: string; result: ProcessResult | { error: string } }>;
}

export interface RecurringScheduler {
  /** 启动 setInterval · test 环境自动跳过 */
  start(): void;
  /** 停止 setInterval · 显式解锁 advisory lock */
  stop(): Promise<void>;
  /** 手动执行一次 tick · 供测试用 · 也用于 dev debug */
  tickOnce(nowOverride?: Date): Promise<TickReport>;
  /** 是否正在运行 */
  isRunning(): boolean;
}

// ==============================================================================
// Advisory lock 抽象
// ==============================================================================

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

// ==============================================================================
// 工厂
// ==============================================================================

export function createScheduler(
  service: RecurringService,
  config: SchedulerConfig = {},
): RecurringScheduler {
  const intervalMs = config.intervalMs ?? DEFAULT_TICK_INTERVAL_MS;
  const batchSize = config.batchSize ?? DEFAULT_TICK_BATCH_SIZE;
  const nowProvider = config.nowProvider ?? (() => new Date());

  let timerHandle: NodeJS.Timeout | null = null;
  let running = false;

  async function tickOnce(nowOverride?: Date): Promise<TickReport> {
    const now = nowOverride ?? nowProvider();
    const report: TickReport = {
      now,
      pickedCount: 0,
      processedCount: 0,
      failedCount: 0,
      results: [],
    };

    const pool = getPool();
    const lockClient = await pool.connect();
    let gotLock = false;
    try {
      gotLock = await tryAcquireLock(lockClient);
      if (!gotLock) {
  // 别的实例在 tick · 本轮跳过
        return report;
      }

 // T2 · end_date 状态收敛：先扫一遍已过期的 active 规则并置 'ended'，
      // 避免它们永远进不了后续 due 查询而成为"启用中但不会执行"的僵尸。
      // 单条 UPDATE，走部分索引；空表时无成本。
      try {
        await recurringRepo.markEndedForExpired(now);
      } catch (err) {
    // sweep 失败不阻塞 tick 主流程，下轮再试
    report.results.push({ ruleId: '__sweep_ended__', result: { error: (err as Error).message } });
      }

    // 拉候选 · 需要在事务内配合 FOR UPDATE SKIP LOCKED
      // 为简化：每条规则一个独立事务；批量拉候选用一个只读事务
      const candidates = await pickDueRules(now, batchSize);
      report.pickedCount = candidates.length;

      for (const rule of candidates) {
        try {
          const result = await processRuleInTx(service, rule, now);
          report.processedCount++;
          report.results.push({ ruleId: rule.id, result });
        } catch (err) {
          report.failedCount++;
          const msg = (err as Error).message ?? String(err);
          report.results.push({
            ruleId: rule.id,
            result: { error: msg },
          });
          // 记录失败 · 累加 consecutive_failures · 3 次转 auto_paused
          try {
            await markFailure(rule, msg);
          } catch {
            // 记录失败本身也失败 · 忽略（下轮 tick 会重试）
          }
        }
      }
    } finally {
      if (gotLock) await releaseLock(lockClient);
      lockClient.release();
    }

    return report;
  }

  function start(): void {
    if (isTestEnv()) return; // test 环境不启定时器
    if (timerHandle != null) return; // 已启动

    running = true;
    timerHandle = setInterval(() => {
      // 不 await · 让 tick 独立完成 · 若上轮未完成又到点 · 拿不到 lock 自然跳过
      void tickOnce().catch(() => {
        // tick 内部已尽力捕获错误 · 这里兜底 · 不打日志（scheduler 无 logger 依赖）
      });
    }, intervalMs);
    // 允许 Node 进程在无其它 I/O 时退出（K8s SIGTERM 时快速关停）
    timerHandle.unref?.();
  }

  async function stop(): Promise<void> {
    if (timerHandle != null) {
      clearInterval(timerHandle);
      timerHandle = null;
    }
    running = false;
  }

  function isRunning(): boolean {
    return running || timerHandle != null;
  }

  return { start, stop, tickOnce, isRunning };
}

// ==============================================================================
// 内部辅助
// ==============================================================================

/**
 * 拉候选 · 事务内 · FOR UPDATE SKIP LOCKED
 * 注：pg-mem 支持 FOR UPDATE 但不一定支持 SKIP LOCKED
 *   实测：pg-mem 会忽略 SKIP LOCKED 关键字（等价 FOR UPDATE），单测中不影响
 *   若发现兼容性问题，改为普通 SELECT（本期单实例调度，等价）
 */
async function pickDueRules(
  now: Date,
  batchSize: number,
): Promise<RecurringRuleEntity[]> {
  const pool = getPool();
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    // 直接调用 repo · 让 pool client 参与事务
    const rules = await recurringRepo.findDueRules(now, batchSize, client);
    await client.query('COMMIT');
    return rules;
  } catch (err) {
    try {
      await client.query('ROLLBACK');
    } catch {
      /* swallow */
    }
    throw err;
  } finally {
    client.release();
  }
}

/**
 * 处理单条规则 · 独立事务 · 出错 rollback 不影响其它规则
 */
async function processRuleInTx(
  service: RecurringService,
  rule: RecurringRuleEntity,
  now: Date,
): Promise<ProcessResult> {
  const pool = getPool();
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await service.processOneRule(rule, now, client);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    try {
      await client.query('ROLLBACK');
    } catch {
      /* swallow */
    }
    throw err;
  } finally {
    client.release();
  }
}

/**
 * 失败处理：consecutive_failures + 1 · 3 次转 auto_paused
 * 独立事务 · 不进 processRuleInTx 的 rollback 范围
 */
async function markFailure(rule: RecurringRuleEntity, errMsg: string): Promise<void> {
  const newCount = rule.consecutiveFailures + 1;
  if (newCount >= 3) {
    await recurringRepo.updateStatus(rule.id, 'auto_paused', {
      lastRunStatus: 'auto_paused_after_3_failures',
      consecutiveFailures: newCount,
      lastRunAt: new Date(),
    });
  } else {
    await recurringRepo.updateStatus(rule.id, rule.status, {
      lastRunStatus: `failed_${errMsg.slice(0, 80)}`,
      consecutiveFailures: newCount,
      lastRunAt: new Date(),
    });
  }
}
