/**
 * Costra · Server · 导入任务路由（data-import-export v1.0 二期）
 *
 * 事实源：docs/design/data-import-export-client-analysis.md v1.0 §4.2/§4.3/§4.4/§4.5/§7.4/§9.1/§9.5
 * 契约镜像：server/api/openapi.yaml paths /import-jobs/detect · /import-jobs/commit · /import-detect-sessions/{detect_id}/report
 *
 * 端点：
 *   POST /import-jobs/detect                      上传 CSV + 同步检测 → DetectReport
 *   POST /import-jobs/commit                      确认导入（原子消费会话 + 创建任务）→ 202
 *   GET  /import-detect-sessions/{detect_id}/report  下载问题报告 CSV（24h 独立寿命）
 *
 * 闸口与幂等：
 *   - detect 频控：单用户 5 分钟 ≤5 次（Redis 独立计数器 · §9.1）；
 *   - detect 并发：同用户单一进行中检测（§4.4 · 代码先查 + 部分唯一索引 23505 兜底）；
 *     僵尸 detecting（>10min）即查即收（自愈，不等周期清理）；
 *   - detect 幂等：同（user, ledger, sha256）且 ready 未过期 ⇒ 直接复用并重置 15min 有效期（§4.2 v0.8/v1.0）；
 *   - detect 也执行导入任务闸口（§4.2 响应集含 IMPORT_JOB_IN_PROGRESS）；
 *   - commit 幂等锚 = detect_id 状态机（§7.4 步骤 3：已消费 ⇒ 回放原 job_id，不建双任务）；
 *   - commit 频控：单用户 5 分钟 ≤3 个导入任务（按 data_jobs 计数 · §9.1）；
 *   - commit 并发：同账本单一活跃导入（§4.4 · 排队幽灵先回收，生产唯一索引 23505 兜底）。
 */

import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { promises as fs } from 'node:fs';
import { DateTime } from 'luxon';
import type { FastifyInstance } from 'fastify';
import { AppError } from '../errors/AppError.js';
import { ErrorCode } from '../errors/ErrorCode.js';
import { getRedis } from '../db/redis.js';
import { getPool } from '../db/pool.js';
import { requireUserId } from '../plugins/requireUser.js';
import * as categoryRepo from '../repositories/categoryRepo.js';
import * as dataJobRepo from '../repositories/dataJobRepo.js';
import * as familyMemberRepo from '../repositories/familyMemberRepo.js';
import * as importDetectRepo from '../repositories/importDetectRepo.js';
import type { ImportDetectSessionEntity } from '../repositories/importDetectRepo.js';
import * as ledgerRepo from '../repositories/ledgerRepo.js';
import {
  ImportFileInvalidError,
  runDetectPipeline,
} from '../services/entryImport.js';
import { IMPORT_RULESET_VERSION } from '../services/importCsv.js';

// ==============================================================================
// 常量（方案冻结值 · §9.1）
// ==============================================================================

/** 服务端应用层二次校验上限：1MB（客户端先本地校验 · §9.1 三层阈值第一层） */
const MAX_IMPORT_FILE_BYTES = 1024 * 1024;
/** detect 频控：5 分钟 5 次 */
const DETECT_RATE_WINDOW_SEC = 300;
const DETECT_RATE_LIMIT = 5;
/** commit 频控：5 分钟 3 个导入任务 */
const COMMIT_RATE_WINDOW_SEC = 300;
const COMMIT_RATE_LIMIT = 3;

const SHANGHAI_ZONE = 'Asia/Shanghai';

// ==============================================================================
// DetectReport 序列化（§4.2 契约字段）
// ==============================================================================

interface DetectLedgerInfo {
  id: string;
  name: string;
  kind: string;
}

function isoOrNull(d: Date | null): string | null {
  return d ? d.toISOString() : null;
}

/** session → DetectReport（§4.2 · 预览与聚合直接读 report_preview 物化列） */
function toDetectReport(session: ImportDetectSessionEntity, ledger: DetectLedgerInfo) {
  const preview = session.reportPreview;
  return {
    detect_id: session.id,
    ledger_id: ledger.id,
    ledger_name: ledger.name,
    family_kind: ledger.kind,
    file_name: session.fileName,
    file_size: session.fileSize,
    file_sha256: session.fileSha256,
    is_costra_export: session.isCostraExport,
    formula_guard: session.formulaGuard === 'apostrophe-v2' ? 'apostrophe-v2' : 'none',
    total_rows: session.totalRows ?? 0,
    importable_rows: session.importableRows ?? 0,
    error_count: session.errorCount ?? 0,
    warning_count: session.warningCount ?? 0,
    errors_preview: preview?.errors ?? [],
    warnings_preview: preview?.warnings ?? [],
    errors_truncated: preview?.errors_truncated ?? false,
    warnings_truncated: preview?.warnings_truncated ?? false,
    unmatched_members: preview?.unmatched_members ?? [],
    unmatched_members_truncated: preview?.unmatched_members_truncated ?? false,
    // 相对路径不含 /v1（客户端 apiBaseUrl 已含 · 与导出 download_path 惯例一致）
    report_path: `/import-detect-sessions/${session.id}/report`,
    created_at: session.createdAt.toISOString(),
    expires_at: isoOrNull(session.expiresAt),
  };
}

// ==============================================================================
// 参数解析（手工校验 · 与导出 create 同范式）
// ==============================================================================

const UUID_PATTERN = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;

interface CommitBody {
  detect_id: string;
  member_mapping?: Record<string, string>;
}

/**
 * commit body 校验（§4.3）：member_mapping 的值必须是 '__self__' 或 UUID；
 * 映射目标的活跃成员复核在 worker 大事务内 FOR UPDATE（§7.5 · 单一事实源）。
 */
function parseCommitBody(raw: unknown): CommitBody {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    throw new AppError(ErrorCode.INVALID_ARGUMENT, { message: 'body must be an object' });
  }
  const body = raw as Record<string, unknown>;
  for (const key of Object.keys(body)) {
    if (key !== 'detect_id' && key !== 'member_mapping') {
      throw new AppError(ErrorCode.INVALID_ARGUMENT, {
        message: `unexpected field: ${key}`,
        details: { field: key, constraint: 'additionalProperties=false' },
      });
    }
  }
  const detectId = body['detect_id'];
  if (typeof detectId !== 'string' || detectId === '') {
    throw new AppError(ErrorCode.INVALID_ARGUMENT, {
      message: 'detect_id is required',
      details: { field: 'detect_id', constraint: 'non-empty string' },
    });
  }
  const out: CommitBody = { detect_id: detectId };
  const mapping = body['member_mapping'];
  if (mapping !== undefined) {
    if (typeof mapping !== 'object' || mapping === null || Array.isArray(mapping)) {
      throw new AppError(ErrorCode.INVALID_ARGUMENT, {
        message: 'member_mapping must be an object',
        details: { field: 'member_mapping', constraint: 'Record<string, string>' },
      });
    }
    const cleaned: Record<string, string> = {};
    for (const [nick, target] of Object.entries(mapping as Record<string, unknown>)) {
      if (typeof target !== 'string' || (target !== '__self__' && !UUID_PATTERN.test(target))) {
        throw new AppError(ErrorCode.INVALID_ARGUMENT, {
          message: `invalid member_mapping value for "${nick}"`,
          details: { field: 'member_mapping', constraint: "value must be '__self__' or a user UUID" },
        });
      }
      cleaned[nick] = target;
    }
    out.member_mapping = cleaned;
  }
  return out;
}

/** Content-Disposition（RFC 5987 · 与导出下载同一实现口径） */
function buildContentDisposition(filename: string): string {
  const safe = filename.replace(/[\r\n]/g, '');
  const asciiFallback = safe.replace(/[^\x20-\x7e]/g, '_').replace(/"/g, '_');
  return `attachment; filename="${asciiFallback}"; filename*=UTF-8''${encodeURIComponent(safe)}`;
}

// ==============================================================================
// 注册
// ==============================================================================

export async function registerImportJobsRoutes(app: FastifyInstance): Promise<void> {
  // ─── POST /import-jobs/detect · 上传 + 同步检测 ────────────────────────────
  app.post('/import-jobs/detect', async (req, reply) => {
    const userId = await requireUserId(req);

    // 频控（Redis 独立计数器 · §9.1 单用户 5 分钟 5 次）
    const redis = getRedis();
    const rateKey = `rate:v1:import-detect:${userId}`;
    const hits = await redis.incr(rateKey);
    if (hits === 1) await redis.expire(rateKey, DETECT_RATE_WINDOW_SEC);
    if (hits > DETECT_RATE_LIMIT) {
      const pttl = await redis.pttl(rateKey);
      throw new AppError(ErrorCode.RATE_LIMITED, {
        message: 'too many import detect requests',
        retryAfterSec: Math.max(1, Math.ceil(pttl / 1000)),
      });
    }

    // multipart 闸口（文件超限由全局 fileSize=2MB 兜底 → errorHandler 映射 PAYLOAD_TOO_LARGE）
    if (!req.isMultipart()) {
      throw new AppError(ErrorCode.INVALID_ARGUMENT, { message: 'content-type must be multipart/form-data' });
    }
    // 用 req.parts() 顺序无关地读字段与文件：wx.uploadFile 不保证 formData 与 file 的
    // 先后次序，req.file() 的 data.fields 只含"文件之前"的字段（busboy 流式语义）
    let ledgerId: string | undefined;
    let fileName: string | null = null;
    let buffer: Buffer | null = null;
    for await (const part of req.parts()) {
      if (part.type === 'file') {
        if (buffer !== null) {
          // 多文件字段：丢弃（全局 limits.files=1 也会先拦截）
          await part.toBuffer().catch(() => Buffer.alloc(0));
          continue;
        }
        buffer = await part.toBuffer(); // 超 2MB 抛 FST_REQ_FILE_TOO_LARGE → 413
        fileName = typeof part.filename === 'string' && part.filename !== '' ? part.filename : null;
      } else if (part.fieldname === 'ledger_id') {
        const v = part.value;
        ledgerId = typeof v === 'string' && v !== '' ? v : undefined;
      }
    }
    if (!ledgerId) {
      throw new AppError(ErrorCode.INVALID_ARGUMENT, {
        message: 'missing multipart field: ledger_id',
        details: { field: 'ledger_id', constraint: 'required' },
      });
    }
    if (buffer === null || buffer.length === 0) {
      throw new AppError(ErrorCode.INVALID_ARGUMENT, { message: 'missing or empty multipart file field' });
    }
    if (buffer.length > MAX_IMPORT_FILE_BYTES) {
      throw new AppError(ErrorCode.PAYLOAD_TOO_LARGE, {
        message: 'file exceeds 1MB limit (about 5,000 rows); please split and import in batches',
      });
    }
    // 后缀白名单（§9.1 · 服务端归一后比对）：仅 .csv（大小写不敏感）。
    // 无文件名时不拦——后续 UTF-8/RFC4180/表头指纹/缺列等内容校验仍是真实闸门。
    if (fileName !== null && !fileName.toLowerCase().endsWith('.csv')) {
      throw new AppError(ErrorCode.INVALID_ARGUMENT, {
        message: 'only .csv files are supported',
        details: { field: 'file', constraint: 'filename extension must be .csv' },
      });
    }

    // 账本校验：存在 + 未删 + 用户是其 family 活跃成员（§4.2 ledger_id 为契约必填）
    const ledger = await ledgerRepo.findWithFamilyById(ledgerId);
    if (!ledger) {
      throw new AppError(ErrorCode.NOT_FOUND, { message: 'ledger not found' });
    }
    const memberOk = await familyMemberRepo.isActiveMember(userId, ledger.familyId);
    if (!memberOk) {
      throw new AppError(ErrorCode.FAMILY_NOT_MEMBER, { message: 'not an active member of this family' });
    }

    // 导入任务闸口（§4.2：账本已有执行中导入 ⇒ 409，避免白检测）。
    // 排队幽灵先回收（与 commit 路径同范式）：worker 宕机 >10min 的 queued 幽灵不挡 detect——
    // 否则会话建不出来、commit 也走不到（commit 需先 detect），该 family 死锁至 worker 恢复。
    await dataJobRepo.failExpiredQueuedImportJob(ledger.familyId);
    const activeImport = await dataJobRepo.findActiveImportJobByFamily(ledger.familyId);
    if (activeImport) {
      throw new AppError(ErrorCode.IMPORT_JOB_IN_PROGRESS, {
        message: 'an import job is already in progress for this ledger',
        details: { job_id: activeImport.id },
      });
    }

    // 内容哈希 + 幂等：同文件且 ready 未过期 ⇒ 直接复用并重置有效期（§4.2 v0.8/v1.0）
    const fileSha256 = createHash('sha256').update(buffer).digest('hex');
    const existing = await importDetectRepo.findReadyBySha(userId, ledger.id, fileSha256);
    if (existing) {
      const touched = await importDetectRepo.touchReadyExpiry(existing.id);
      req.log.info(
        { audit: 'data_import', action: 'detect-dedup', user_id: userId, ledger_id: ledger.id, detect_id: existing.id, file_sha256: fileSha256 },
        'import detect dedup hit',
      );
      reply.code(200).send(toDetectReport(touched ?? existing, ledger));
      return;
    }

    // 并发检测闸口（§4.4）：僵尸 detecting（>10min）即查即收（自愈释放并发槽）
    const activeDetect = await importDetectRepo.findActiveDetectingByUser(userId);
    if (activeDetect) {
      const zombieBefore = Date.now() - importDetectRepo.ZOMBIE_DETECTING_MINUTES * 60_000;
      if (activeDetect.createdAt.getTime() < zombieBefore) {
        await importDetectRepo.markFailed(activeDetect.id);
      } else {
        throw new AppError(ErrorCode.DETECT_IN_PROGRESS, {
          message: 'another import detect session is in progress',
          details: { detect_id: activeDetect.id },
        });
      }
    }

    // 建会话（生产并发竞态由 uq_detect_sessions_active_per_user 23505 兜底）
    let session: ImportDetectSessionEntity;
    try {
      session = await importDetectRepo.insertDetectingSession({
        userId,
        familyId: ledger.familyId,
        ledgerId: ledger.id,
        fileName,
        fileSize: buffer.length,
        fileSha256,
      });
    } catch (err) {
      if ((err as { code?: string }).code === '23505') {
        throw new AppError(ErrorCode.DETECT_IN_PROGRESS, {
          message: 'another import detect session is in progress',
        });
      }
      throw err;
    }

    // 解析 + 校验 + 产物（同步 · ≤1MB 秒级出报告 · §4.2）
    let analysis;
    try {
      analysis = await runDetectPipeline({
        session,
        buffer,
        familyKind: ledger.kind === 'personal' ? 'personal' : 'shared',
        operatorUserId: userId,
        members: await loadActiveMembers(ledger.familyId),
        categories: await categoryRepo.findByFamily(ledger.familyId),
      });
    } catch (err) {
      if (err instanceof ImportFileInvalidError) {
        // 文件级失败：runDetectPipeline 内部已把会话转 failed（并发槽已释放）
        throw new AppError(ErrorCode.INVALID_ARGUMENT, { message: err.message });
      }
      // 非预期异常（产物落盘 ENOSPC/EIO、markReady 写失败等）：会话会滞留 detecting，
      // 该用户后续 detect 将连吃 409 DETECT_IN_PROGRESS 直到 10min 僵尸阈值才自愈。
      // 本路由是并发槽的申请者，故在此兜底释放（尽力而为：写失败仍由僵尸清理兜底，
      // 且不得掩盖原异常）。
      try {
        await importDetectRepo.markFailed(session.id);
      } catch (releaseErr) {
        req.log.warn(
          { err: releaseErr, detect_id: session.id },
          'failed to release detect slot after unexpected error',
        );
      }
      throw err;
    }

    const ready = await importDetectRepo.findById(session.id);
    req.log.info(
      {
        audit: 'data_import',
        action: 'detect',
        user_id: userId,
        family_id: ledger.familyId,
        ledger_id: ledger.id,
        detect_id: session.id,
        file_sha256: fileSha256,
        file_size: buffer.length,
        total_rows: analysis.totalRows,
        importable_rows: analysis.importableRows,
        error_count: analysis.errors.length,
        warning_count: analysis.warnings.length,
      },
      'import detect ready',
    );

    reply.code(200).send(toDetectReport(ready ?? session, ledger));
  });

  // ─── POST /import-jobs/commit · 确认导入（原子消费会话 + 创建任务）───────────
  app.post('/import-jobs/commit', async (req, reply) => {
    const userId = await requireUserId(req);
    const body = parseCommitBody(req.body);

    // 频控（按 data_jobs 计数 · §9.1 单用户 5 分钟 3 个导入任务）
    const recentJobs = await dataJobRepo.countRecentImportJobsByUser(userId, COMMIT_RATE_WINDOW_SEC);
    if (recentJobs >= COMMIT_RATE_LIMIT) {
      throw new AppError(ErrorCode.RATE_LIMITED, {
        message: 'too many import jobs created recently',
        retryAfterSec: 60,
      });
    }

    const pool = getPool();
    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      // 步骤 1：锁定会话行（FOR UPDATE · §7.4 commit 阶段）
      const session = await importDetectRepo.lockById(body.detect_id, client);
      if (!session || session.userId !== userId) {
        throw new AppError(ErrorCode.NOT_FOUND, { message: 'detect session not found' });
      }

      // 步骤 3：已消费 ⇒ 幂等回放原 job_id（防连点/超时重发建双任务）
      if (session.status === 'consumed') {
        const job = session.jobId ? await dataJobRepo.findById(session.jobId, client) : null;
        await client.query('COMMIT');
        reply.code(202).send({ job_id: session.jobId, status: job?.status ?? 'queued' });
        return;
      }
      if (session.status !== 'ready') {
        throw new AppError(ErrorCode.DETECT_SESSION_EXPIRED, {
          message: 'detect session is not consumable; please re-upload',
        });
      }
      if (!session.expiresAt || session.expiresAt.getTime() <= Date.now()) {
        throw new AppError(ErrorCode.DETECT_SESSION_EXPIRED, {
          message: 'detect session has expired; please re-upload',
        });
      }
      if ((session.importableRows ?? 0) === 0) {
        // 无可导入行（全部 ERROR / 待映射未给映射）⇒ 400（客户端按 importable_rows>0 守入口，此处兜底）
        const pendingMapping = (session.reportPreview?.unmatched_members.length ?? 0) > 0;
        const mapping = body.member_mapping ?? {};
        if (!pendingMapping || Object.keys(mapping).length === 0) {
          throw new AppError(ErrorCode.INVALID_ARGUMENT, {
            message: 'no importable rows in this detect session',
            details: { field: 'detect_id', constraint: 'importable_rows>0' },
          });
        }
      }

      // 步骤 3b：member_mapping 目标必须是本 family 活跃成员（§4.2 明文要求 · 提前失败）。
      // 不在此校验则要等到 worker 大事务复核（entryImport 4b）才发现，届时整批任务
      // CONTEXT_INVALIDATED 终态失败、detect 会话已被消费，用户必须重新上传文件；
      // 同步 400 让用户就地改映射。并发安全的单一事实源仍是 worker 的 FOR UPDATE 复核。
      const mappingTargets = [
        ...new Set(Object.values(body.member_mapping ?? {}).filter((t) => t !== '__self__')),
      ];
      for (const target of mappingTargets) {
        const ok = await familyMemberRepo.isActiveMember(target, session.familyId, client);
        if (!ok) {
          throw new AppError(ErrorCode.INVALID_ARGUMENT, {
            message: 'member_mapping target is not an active member of this family',
            details: {
              field: 'member_mapping',
              constraint: 'target must be an active member of this family',
            },
          });
        }
      }

      // 步骤 2：并发闸口（§4.4 · 排队幽灵先回收，与导出 create 同范式）
      await dataJobRepo.failExpiredQueuedImportJob(session.familyId, client);
      const activeImport = await dataJobRepo.findActiveImportJobByFamily(session.familyId, client);
      if (activeImport) {
        throw new AppError(ErrorCode.IMPORT_JOB_IN_PROGRESS, {
          message: 'an import job is already in progress for this ledger',
          details: { job_id: activeImport.id },
        });
      }

      // 步骤 4-6：创建任务 + 原子消费会话（同事务）
      let job;
      try {
        job = await dataJobRepo.createImportJob(
          {
            userId,
            familyId: session.familyId,
            ledgerId: session.ledgerId,
            detectId: session.id,
            sourceHash: session.fileSha256 ?? '',
            rulesetVersion: IMPORT_RULESET_VERSION,
          },
          client,
        );
      } catch (err) {
        // 生产竞态：活跃导入唯一索引 / detect 唯一索引 23505 ⇒ 409
        if ((err as { code?: string }).code === '23505') {
          throw new AppError(ErrorCode.IMPORT_JOB_IN_PROGRESS, {
            message: 'an import job is already in progress for this ledger',
          });
        }
        throw err;
      }
      await importDetectRepo.consumeSession(
        session.id,
        { jobId: job.id, memberMapping: body.member_mapping ?? null },
        client,
      );

      await client.query('COMMIT');

      req.log.info(
        {
          audit: 'data_import',
          action: 'commit',
          user_id: userId,
          family_id: session.familyId,
          ledger_id: session.ledgerId,
          job_id: job.id,
          detect_id: session.id,
          file_sha256: session.fileSha256,
          mapped_members: body.member_mapping ? Object.keys(body.member_mapping).length : 0,
        },
        'import job committed',
      );

      // 事件触发：不等下一个 tick（worker 立即领取）
      app.dataJobScheduler?.kick();

      reply.code(202).send({ job_id: job.id, status: 'queued' });
    } catch (err) {
      try {
        await client.query('ROLLBACK');
      } catch {
        /* 保留原异常 */
      }
      throw err;
    } finally {
      client.release();
    }
  });

  // ─── GET /import-detect-sessions/{detect_id}/report · 下载问题报告 CSV ───────
  app.get<{ Params: { detect_id: string } }>(
    '/import-detect-sessions/:detect_id/report',
    async (req, reply) => {
      const userId = await requireUserId(req);
      const session = await importDetectRepo.findById(req.params.detect_id);
      if (!session || session.userId !== userId) {
        throw new AppError(ErrorCode.NOT_FOUND, { message: 'detect session not found' });
      }
      // 无问题则无报告文件（检测通过即没有可下载内容）
      if (!session.reportPath) {
        throw new AppError(ErrorCode.NOT_FOUND, { message: 'detect report not available' });
      }
      // 报告 24h 独立寿命（§4.5 f · 过期派生态）。
      // 用 404 而非 410 DETECT_SESSION_EXPIRED：报告寿命（24h）与会话 commit 有效期
      // （15min）在 §7.4 v0.8 已解耦，报告不可用**不影响**本次 commit；若借用会话过期码，
      // 客户端会把仍可确认导入的检测卡整卡重置（§7.6 该端点契约本就是 404）。
      if (!session.reportExpiresAt || session.reportExpiresAt.getTime() <= Date.now()) {
        throw new AppError(ErrorCode.NOT_FOUND, { message: 'detect report is no longer available' });
      }
      let size: number;
      try {
        size = (await fs.stat(session.reportPath)).size;
      } catch {
        // 磁盘产物已被清理（purge-import-staging / 运维手工清理）⇒ 同「报告不可用」
        throw new AppError(ErrorCode.NOT_FOUND, { message: 'detect report has been purged' });
      }

      const ts = DateTime.fromJSDate(session.createdAt)
        .setZone(SHANGHAI_ZONE)
        .toFormat('yyyyMMddHHmmss');
      reply
        .header('Content-Type', 'text/csv; charset=utf-8')
        .header('Content-Disposition', buildContentDisposition(`Costra_导入检测报告_${ts}.csv`))
        .header('Content-Length', String(size));
      return reply.send(createReadStream(session.reportPath));
    },
  );
}

/** 活跃成员（含昵称）加载：listMembersWithUsers 含已退出，导入匹配只用活跃（§3.3） */
async function loadActiveMembers(
  familyId: string,
): Promise<Array<{ userId: string; nickname: string }>> {
  const rows = await familyMemberRepo.listMembersWithUsers(familyId);
  return rows
    .filter((m) => m.leftAt === null)
    .map((m) => ({ userId: m.userId, nickname: m.nickname }));
}
