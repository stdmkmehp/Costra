/**
 * Costra · Server · 数据任务调度器（data_jobs worker · 导出 + 导入双执行体）
 *
 * 事实源：docs/design/data-import-export-client-analysis.md v1.0 §7.5
 *
 * 架构（复用 recurringScheduler / tipReconcileScheduler 的进程内调度范式）：
 *   - Fastify 进程内 setInterval（2s）+ 任务创建后事件 kick（不等下一个 tick）
 *   - pg_try_advisory_lock（'DJOB'）保证多实例单飞；pg-mem 下 mock 为永远拿到
 *   - 持锁事务内 claim（FOR UPDATE SKIP LOCKED · pg-mem 下省略），锁释放后才执行导出
 *   - run_token + 90s 执行租约：终态写回一律条件更新，失让即放弃（不抢写）
 *   - 僵尸回收：processing 且租约过期 ⇒ 走同一套「瞬时重试 / 终态失败」出口
 *   - 导出执行体内自行按节奏续租（entryExport 每 30s）
 *
 * 失败归类（§7.5「瞬时故障重试 / 终态失败」同一出口）：
 *   - 导出：ExportContextInvalidError（账本被删 / 成员失效）⇒ 终态 CONTEXT_INVALIDATED
 *   - 导入：ImportContextInvalidError ⇒ 终态 CONTEXT_INVALIDATED；
 *     ImportArtifactError ⇒ 终态 ARTIFACT_MISSING；23505 按约束名分流（§7.5 步骤 6）；
 *     ImportClientRefConflictError 不在 classify 内 —— 先重读 job.status 再定（R38）
 *   - PG SQLSTATE  transient 集合 / fs errno 集合 且 attempts < 3 ⇒ 回队重试（退避 attempts×5s）
 *   - 其余（或重试耗尽）⇒ 终态 INTERNAL
 *
 * 导入 sync-hold（§5.2）：hold 在 runEntryImport 内的独立短事务设置、大事务末尾
 * 同事务释放（H2）；失败路径由 executeImport 条件清除（H3 · 仅清自己设置的闸门）。
 *
 * 测试友好性：NODE_ENV === 'test' 时 setInterval 与 kick 不生效，只暴露 tickOnce。
 */

import type { PoolClient } from 'pg';
import pino from 'pino';
import { DateTime } from 'luxon';
import { getPool } from '../db/pool.js';
import * as dataJobRepo from '../repositories/dataJobRepo.js';
import type { DataJobEntity } from '../repositories/dataJobRepo.js';
import * as importDetectRepo from '../repositories/importDetectRepo.js';
import * as ledgerRepo from '../repositories/ledgerRepo.js';
import { runEntryExport, removeJobArtifacts, ExportContextInvalidError } from './entryExport.js';
import {
  ImportArtifactError,
  ImportClientRefConflictError,
  ImportContextInvalidError,
  ImportSuccessWriteBackRace,
  cleanupDetectSessions,
  deleteDetectFile,
  runEntryImport,
} from './entryImport.js';

/** advisory lock 的 32-bit key · 'DJOB' in hex · 与 'RECU'/'TIPS' 不冲突 */
const ADVISORY_LOCK_KEY = 0x444a4f42;
/** 导出日期段的展示时区（与路由 parseRangeDate / entryExport 文件名同一时区） */
const SHANGHAI_ZONE = 'Asia/Shanghai';

/** 轮询间隔（2s · 另有创建后事件 kick） */
const POLL_INTERVAL_MS = 2_000;
/**
 * 单 tick 领取上限（§7.5 骨架 LIMIT 1）。
 * 批内排队任务的 90s 执行租约在等待期间不刷新：LIMIT 1 从根上消除
 * 「同批后续任务租约过期被僵尸回收双跑」的窗口（2s 轮询 + kick 下吞吐无影响）。
 */
const CLAIM_BATCH_SIZE = 1;
/** 僵尸回收单 tick 上限 */
const ZOMBIE_BATCH_SIZE = 20;
/** 最大尝试次数（含首次 · 达到即终态） */
export const DATA_JOB_MAX_ATTEMPTS = 3;
/** 瞬时重试退避基数（attempts × 5s） */
const RETRY_BACKOFF_BASE_MS = 5_000;

const logger = pino({
  level: process.env['LOG_LEVEL'] ?? 'info',
  timestamp: pino.stdTimeFunctions.isoTime,
}).child({ module: 'dataJobScheduler' });

export interface DataJobScheduler {
  /** 启动 setInterval · test 环境自动跳过 */
  start(): void;
  /** 停止 setInterval */
  stop(): Promise<void>;
  /** 手动执行一次 tick · 供测试用 */
  tickOnce(): Promise<void>;
  /** 事件触发（任务创建后立即跑一拍 · test 环境为 no-op） */
  kick(): void;
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

// ==============================================================================
// 失败归类
// ==============================================================================

/** PG transient SQLSTATE（死锁/串行化/连接类/锁不可用/运维态重启） */
const TRANSIENT_PG_CODES: ReadonlySet<string> = new Set([
  '40001', // serialization_failure
  '40P01', // deadlock_detected
  '55P03', // lock_not_available
  '53300', // too_many_connections
  '57P01', // admin_shutdown
  '57P02', // crash_shutdown
  '57P03', // cannot_connect_now
  '08000', // connection_exception
  '08001', // sqlclient_unable_to_establish_sqlconnection
  '08003', // connection_does_not_exist
  '08004', // sqlserver_rejected_establishment_of_sqlconnection
  '08006', // connection_failure
]);

/** fs transient errno（句柄耗尽 / 盘满 / IO 抖动 · 重试可能自愈） */
const TRANSIENT_FS_CODES: ReadonlySet<string> = new Set([
  'EMFILE',
  'ENFILE',
  'ENOSPC',
  'EIO',
  'EAGAIN',
  'EBUSY',
]);

export interface FailureVerdict {
  terminal: boolean;
  errorCode: string;
  errorMessage: string;
}

/** 失败归类（导出给单测直测判定矩阵；调度器自身也走这唯一出口） */
export function classifyExportError(err: unknown, attempts: number): FailureVerdict {
  const errorMessage = err instanceof Error ? err.message : String(err);

  if (err instanceof ExportContextInvalidError) {
    return { terminal: true, errorCode: 'CONTEXT_INVALIDATED', errorMessage };
  }

  const code = (err as NodeJS.ErrnoException | undefined)?.code;
  const transient =
    (typeof code === 'string' && TRANSIENT_PG_CODES.has(code)) ||
    (typeof code === 'string' && TRANSIENT_FS_CODES.has(code));

  if (transient && attempts < DATA_JOB_MAX_ATTEMPTS) {
    const errorCode = TRANSIENT_PG_CODES.has(code!) ? 'TRANSIENT_DB' : 'TRANSIENT_IO';
    return { terminal: false, errorCode, errorMessage };
  }

  return { terminal: true, errorCode: 'INTERNAL', errorMessage };
}

/**
 * 失败归类（导入 · §7.5 重试分类表 · 与导出同一出口）。
 *
 * 注意：ImportClientRefConflictError 不在此处分流 —— §7.5 步骤 6 要求先重读
 * data_jobs.status（succeeded ⇒ 另一次执行已完成，正常结束且不得告警；
 * 非 succeeded ⇒ TRANSIENT_DB 重试），由 executeImport 直接处理。
 */
export function classifyImportError(err: unknown, attempts: number): FailureVerdict {
  const errorMessage = err instanceof Error ? err.message : String(err);

  if (err instanceof ImportContextInvalidError) {
    return { terminal: true, errorCode: 'CONTEXT_INVALIDATED', errorMessage };
  }
  if (err instanceof ImportArtifactError) {
    return { terminal: true, errorCode: 'ARTIFACT_MISSING', errorMessage };
  }
  // 成功终态条件更新失败（run_token 已让位）：事务已回滚无副作用；
  // 终态写回因 token 不符必然 0 行命中（不抢写），等租约过期后由僵尸回收接管
  if (err instanceof ImportSuccessWriteBackRace) {
    return { terminal: true, errorCode: 'INTERNAL', errorMessage };
  }

  const code = (err as NodeJS.ErrnoException | undefined)?.code;
  // §7.5：其他 23505（非 uq_entries_ledger_client_ref）⇒ CONSTRAINT_VIOLATION 终态 + 告警
  //（意味着 detect 校验集有漏，让错误尽早暴露而不是重试掩盖）
  if (code === '23505') {
    return { terminal: true, errorCode: 'CONSTRAINT_VIOLATION', errorMessage };
  }

  const transient =
    (typeof code === 'string' && TRANSIENT_PG_CODES.has(code)) ||
    (typeof code === 'string' && TRANSIENT_FS_CODES.has(code));
  if (transient && attempts < DATA_JOB_MAX_ATTEMPTS) {
    const errorCode = TRANSIENT_PG_CODES.has(code!) ? 'TRANSIENT_DB' : 'TRANSIENT_IO';
    return { terminal: false, errorCode, errorMessage };
  }

  return { terminal: true, errorCode: 'INTERNAL', errorMessage };
}

// ==============================================================================
// 调度器
// ==============================================================================

/** 检测会话清理间隔（§7.4 · 每分钟应用侧清理） */
const DETECT_CLEANUP_INTERVAL_MS = 60_000;

export function createDataJobScheduler(): DataJobScheduler {
  let timerHandle: NodeJS.Timeout | null = null;
  let cleanupTimerHandle: NodeJS.Timeout | null = null;
  let ticking = false;

  /**
   * 持锁领取一批到期 queued 任务并置 processing（锁释放后才执行导出）。
   */
  async function claimBatch(): Promise<DataJobEntity[]> {
    const pool = getPool();
    const client = await pool.connect();
    let gotLock = false;
    try {
      gotLock = await tryAcquireLock(client);
      if (!gotLock) return [];

      await client.query('BEGIN');
      try {
        const claimed = await dataJobRepo.claimQueuedJobs(new Date(), CLAIM_BATCH_SIZE, client);
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

  /** 僵尸回收：与执行失败共用「瞬时重试 / 终态失败」出口（WORKER_LOST 语义） */
  async function recoverZombies(): Promise<void> {
    const zombies = await dataJobRepo.findZombieJobs(new Date(), ZOMBIE_BATCH_SIZE);
    for (const job of zombies) {
      if (!job.runToken) continue;
      const errorMessage = `worker lease expired (run_token=${job.runToken}); recovered by scheduler`;
      try {
        if (job.attempts < DATA_JOB_MAX_ATTEMPTS) {
          await dataJobRepo.markRetryQueued(job.id, job.runToken, {
            errorCode: 'WORKER_LOST',
            errorMessage,
            nextAttemptAt: new Date(Date.now() + job.attempts * RETRY_BACKOFF_BASE_MS),
          });
        } else {
          await dataJobRepo.markFailedTerminal(job.id, job.runToken, {
            errorCode: 'INTERNAL',
            errorMessage,
          });
        }
        logger.warn(
          { jobId: job.id, type: job.type, attempts: job.attempts },
          'data job zombie recovered',
        );
      } catch (err) {
        logger.error({ err, jobId: job.id }, 'data job zombie recovery failed');
      }
    }
  }

  async function executeExport(job: DataJobEntity): Promise<void> {
    const runToken = job.runToken;
    if (!runToken) return;

    try {
      const outcome = await runEntryExport(job);
      await dataJobRepo.updateStage(job.id, runToken, 'packaging');
      // 半开区间端点 → 用户所选日期（§6.2：客户端「重新生成」按原区间重发的事实源）
      const sourceDateFrom = job.exportFrom
        ? DateTime.fromJSDate(job.exportFrom, { zone: SHANGHAI_ZONE }).toFormat('yyyy-MM-dd')
        : null;
      const sourceDateTo = job.exportTo
        ? DateTime.fromJSDate(job.exportTo, { zone: SHANGHAI_ZONE }).minus({ days: 1 }).toFormat('yyyy-MM-dd')
        : null;
      const ok = await dataJobRepo.markSucceeded(job.id, runToken, {
        entryCount: outcome.entryCount,
        partCount: outcome.partCount,
        files: outcome.files,
        storageMonth: outcome.storageMonth,
        fileTtlMs: 24 * 3_600_000,
        sourceDateFrom,
        sourceDateTo,
      });
      if (!ok) {
        // run_token 已让位（被僵尸回收后重新 claim）⇒ 放弃写回并清掉无人认领的产物
        logger.warn({ jobId: job.id }, 'export success write-back lost run_token · giving up');
        await removeJobArtifacts(job.id);
        return;
      }
      logger.info(
        {
          audit: 'data_export',
          action: 'done',
          user_id: job.userId,
          family_id: job.familyId,
          ledger_id: job.ledgerId,
          job_id: job.id,
          entry_count: outcome.entryCount,
          part_count: outcome.partCount,
          date_from: job.exportFrom,
          date_to: job.exportTo,
          // §2.5/§9.2 审计要求「文件摘要」（不记行明文 · 与导入侧 file_sha256 对齐）
          file_sha256: outcome.files.map((f) => f.sha256),
        },
        'data export done',
      );
    } catch (err) {
      const verdict = classifyExportError(err, job.attempts);
      if (verdict.terminal) {
        const ok = await dataJobRepo.markFailedTerminal(job.id, runToken, {
          errorCode: verdict.errorCode,
          errorMessage: verdict.errorMessage,
        });
        if (!ok) return; // 已让位
        await removeJobArtifacts(job.id);
        logger.warn(
          {
            audit: 'data_export',
            action: 'failed',
            user_id: job.userId,
            family_id: job.familyId,
            ledger_id: job.ledgerId,
            job_id: job.id,
            error_code: verdict.errorCode,
            attempts: job.attempts,
          },
          'data export failed (terminal)',
        );
      } else {
        const ok = await dataJobRepo.markRetryQueued(job.id, runToken, {
          errorCode: verdict.errorCode,
          errorMessage: verdict.errorMessage,
          nextAttemptAt: new Date(Date.now() + job.attempts * RETRY_BACKOFF_BASE_MS),
        });
        if (!ok) return; // 已让位
        logger.warn(
          { jobId: job.id, errorCode: verdict.errorCode, attempts: job.attempts },
          'data export failed (transient · re-queued)',
        );
      }
    }
  }

  /**
   * 导入执行体（§7.5）：
   *   - runEntryImport 内部完成「数据 + 成功状态」同一事务，此处不再二次写回；
   *   - 失败路径条件清除 sync-hold（H3 · 只清本执行体设置的闸门）；
   *   - 23505 uq_entries_ledger_client_ref ⇒ 重读 status 分流（R38 幂等重试收敛）；
   *   - 终态清理：删规范化行产物（报告 CSV 留 24h）+ report_preview 置 NULL（§7.4 隐私口径）。
   */
  async function executeImport(job: DataJobEntity): Promise<void> {
    const runToken = job.runToken;
    if (!runToken) return;

    // 供失败路径条件清除 hold（runEntryImport 设置成功后回传闸门值；H2 事务内释放后置回 null）
    const holdRef: { seq: number | null } = { seq: null };
    try {
      const outcome = await runEntryImport(job, holdRef);
      logger.info(
        {
          audit: 'data_import',
          action: 'done',
          user_id: job.userId,
          family_id: job.familyId,
          ledger_id: job.ledgerId,
          job_id: job.id,
          detect_id: job.detectId,
          file_sha256: job.sourceHash,
          imported: outcome.imported,
          skipped: outcome.skipped,
        },
        'data import done',
      );
    } catch (err) {
      // H3：失败路径显式清除 hold（条件清除防误杀新一轮执行的闸门 · hold_until 120s 兜底自愈）
      if (holdRef.seq !== null) {
        try {
          await ledgerRepo.clearSyncHold(job.ledgerId, holdRef.seq);
        } catch (clearErr) {
          logger.warn({ err: clearErr, jobId: job.id }, 'import hold clear failed (self-heals via hold_until)');
        }
      }

      if (err instanceof ImportClientRefConflictError) {
        // §7.5 R38：重读 status —— succeeded ⇒ 数据已由另一次执行落库（正常结束，无告警无终态写回）
        const fresh = await dataJobRepo.findById(job.id).catch(() => null);
        if (fresh?.status === 'succeeded') {
          logger.info({ jobId: job.id }, 'import completed by twin execution (client_ref conflict short-circuit)');
          return;
        }
        const ok = await dataJobRepo.markRetryQueued(job.id, runToken, {
          errorCode: 'TRANSIENT_DB',
          errorMessage: 'client_ref conflict but job not succeeded yet; retry',
          nextAttemptAt: new Date(Date.now() + job.attempts * RETRY_BACKOFF_BASE_MS),
        });
        if (ok) {
          logger.warn({ jobId: job.id }, 'data import client_ref conflict · re-queued');
        }
        return;
      }

      const verdict = classifyImportError(err, job.attempts);
      if (verdict.errorCode === 'CONSTRAINT_VIOLATION') {
        // §7.5：唯一约束异常（非 client_ref）意味着 detect 校验集有漏 —— 告警尽早暴露
        logger.error(
          { jobId: job.id, detectId: job.detectId, errorMessage: verdict.errorMessage },
          'import hit unexpected constraint (detect validation gap)',
        );
      }
      if (verdict.terminal) {
        const ok = await dataJobRepo.markFailedTerminal(job.id, runToken, {
          errorCode: verdict.errorCode,
          errorMessage: verdict.errorMessage,
        });
        if (!ok) return; // 已让位
        // 终态清理：删规范化行产物（报告 CSV 保留至 24h · §7.4 v0.9）+ 预览置 NULL
        if (job.detectId) {
          const session = await importDetectRepo.findById(job.detectId).catch(() => null);
          await deleteDetectFile(session?.artifactPath ?? null);
          await importDetectRepo.clearReportPreview(job.detectId).catch(() => {
            /* 清理失败由周期任务兜底 */
          });
        }
        logger.warn(
          {
            audit: 'data_import',
            action: 'failed',
            user_id: job.userId,
            family_id: job.familyId,
            ledger_id: job.ledgerId,
            job_id: job.id,
            detect_id: job.detectId,
            file_sha256: job.sourceHash,
            error_code: verdict.errorCode,
            attempts: job.attempts,
          },
          'data import failed (terminal)',
        );
      } else {
        const ok = await dataJobRepo.markRetryQueued(job.id, runToken, {
          errorCode: verdict.errorCode,
          errorMessage: verdict.errorMessage,
          nextAttemptAt: new Date(Date.now() + job.attempts * RETRY_BACKOFF_BASE_MS),
        });
        if (!ok) return; // 已让位
        logger.warn(
          { jobId: job.id, errorCode: verdict.errorCode, attempts: job.attempts },
          'data import failed (transient · re-queued)',
        );
      }
    }
  }

  async function tickOnce(): Promise<void> {
    if (ticking) return; // 上一轮未跑完 ⇒ 跳过（单飞）
    ticking = true;
    try {
      await recoverZombies();
      const claimed = await claimBatch();
      for (const job of claimed) {
        if (job.type === 'export') {
          await executeExport(job);
        } else if (job.type === 'import') {
          await executeImport(job);
        }
      }
    } catch (err) {
      logger.error({ err }, 'data job tick failed');
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
    }, POLL_INTERVAL_MS);
    timerHandle.unref?.();

    // 检测会话清理（§7.4）：启动补偿一次 + 每分钟周期
    //（僵尸 detecting 转 failed 释放并发槽 / ready 过期删行产物 / report 过期删文件）
    if (cleanupTimerHandle == null) {
      void cleanupDetectSessions().catch(() => {
        /* 清理函数内部已捕获 · 这里兜底 */
      });
      cleanupTimerHandle = setInterval(() => {
        void cleanupDetectSessions().catch(() => {
          /* 同上 */
        });
      }, DETECT_CLEANUP_INTERVAL_MS);
      cleanupTimerHandle.unref?.();
    }
  }

  async function stop(): Promise<void> {
    if (timerHandle != null) {
      clearInterval(timerHandle);
      timerHandle = null;
    }
    if (cleanupTimerHandle != null) {
      clearInterval(cleanupTimerHandle);
      cleanupTimerHandle = null;
    }
  }

  function kick(): void {
    if (isTestEnv()) return; // 测试显式驱动 tickOnce
    void tickOnce().catch(() => {
      /* tickOnce 内部已捕获 · 这里兜底 */
    });
  }

  return { start, stop, tickOnce, kick };
}
