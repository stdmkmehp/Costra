/**
 * Costra · Server · 数据任务路由（账本导出 · 一期）
 *
 * 事实源：docs/design/data-import-export-client-analysis.md v1.0 §6/§7.3/§9.5
 * 契约镜像：server/api/openapi.yaml paths /export-jobs · /data-jobs · /data-jobs/{job_id}/download
 *
 * 端点：
 *   POST /export-jobs                     创建导出任务（body 可选 ledger_id/from/to · 账本缺省取当前活跃账本）
 *   GET  /data-jobs?limit=N               任务中心列表（倒序 · limit ≤50 · 带 server_now）
 *   GET  /data-jobs/{job_id}              单任务详情（带 server_now）
 *   GET  /data-jobs/{job_id}/download?part=N  签发分片 COS 预签名下载 URL（两步下载第一步 ·
 *                                            完成前 404 · 过期 410 EXPORT_FILE_EXPIRED）
 *
 * 并发闸口：每用户至多一个活跃导出任务（queued/processing）。
 *   - 既有活跃任务 ⇒ 409 EXPORT_JOB_IN_PROGRESS；
 *   - 排队幽灵（queued 且 expires_at 过期）先终态化回收再插入；
 *   - 竞态由部分唯一索引 uq_data_jobs_active_export_per_user 23505 兜底 ⇒ 409。
 */

import { DateTime } from 'luxon';
import type { FastifyInstance } from 'fastify';
import { AppError } from '../errors/AppError.js';
import { ErrorCode } from '../errors/ErrorCode.js';
import { requireUserId } from '../plugins/requireUser.js';
import * as dataJobRepo from '../repositories/dataJobRepo.js';
import type { DataJobEntity, DataJobFileEntry } from '../repositories/dataJobRepo.js';
import * as userRepo from '../repositories/userRepo.js';
import * as familyRepo from '../repositories/familyRepo.js';
import * as familyMemberRepo from '../repositories/familyMemberRepo.js';
import * as ledgerRepo from '../repositories/ledgerRepo.js';
import type { LedgerEntity } from '../repositories/ledgerRepo.js';
import { getCosClient, PRESIGN_EXPIRES_SECONDS } from '../services/cosClient.js';

const SHANGHAI_ZONE = 'Asia/Shanghai';
const LIST_LIMIT_MAX = 50;
const LIST_LIMIT_DEFAULT = 20; // §6.4/§7.6：默认 20 条，最大 50
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

// ==============================================================================
// 序列化
// ==============================================================================

function isoOrNull(d: Date | null): string | null {
  return d ? d.toISOString() : null;
}

/** data_job 对象（snake_case · files 即契约 5 字段 · error.stage 取失败时所在阶段） */
function serializeJob(job: DataJobEntity) {
  return {
    id: job.id,
    type: job.type,
    status: job.status,
    stage: job.stage,
    stage_started_at: isoOrNull(job.stageStartedAt),
    retryable: job.retryable,
    // 导入溯源链（§7.6 · 导出任务恒 null）
    detect_id: job.detectId,
    // 任务所属账本（客户端「重新生成」按原账本重发 · §6.2）
    ledger_id: job.ledgerId,
    // 账本名（§7.6 · 任务卡「账本名 · 正在导入流水…」；多账本用户据此区分任务归属）
    ledger_name: job.ledgerName,
    error: job.errorCode
      ? { code: job.errorCode, message: job.errorMessage ?? '', stage: job.stage }
      : null,
    attempts: job.attempts,
    // 导出区间（双 null = 全部流水）：落库为半开区间端点（export_to = 所选止日次日 00:00）；
    // 客户端「重新生成」按 result_summary.source_date_from/to 原区间重发（不反解端点）
    export_from: isoOrNull(job.exportFrom),
    export_to: isoOrNull(job.exportTo),
    created_at: job.createdAt.toISOString(),
    started_at: isoOrNull(job.startedAt),
    finished_at: isoOrNull(job.finishedAt),
    result_summary: job.resultSummary,
    files: (job.files ?? []).map(
      (f): DataJobFileEntry => ({
        part: f.part,
        filename: f.filename,
        size_bytes: f.size_bytes,
        sha256: f.sha256,
        download_path: f.download_path,
      }),
    ),
    file_expires_at: isoOrNull(job.fileExpiresAt),
  };
}

// ==============================================================================
// 参数解析
// ==============================================================================

const listQuerySchema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    limit: { type: 'integer', minimum: 1, maximum: LIST_LIMIT_MAX },
  },
} as const;

// part 可选（§6.5）：缺省 = 第 1 分片（单分片任务占绝大多数，客户端可省略）
const downloadQuerySchema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    part: { type: 'integer', minimum: 1 },
  },
} as const;

type CreateExportBody = { ledgerId?: string; from?: string; to?: string };

/**
 * 创建 body 手工校验（不用 schema.body：客户端对无 body 的 POST 发 text/plain，
 * schema 会把"全缺省"的合法创建也挡成 400）：
 *   - body 缺省 ⇒ {}（from/to 全缺省 = 导出全部流水 · 账本取当前活跃账本）
 *   - 契约外字段 / 非字符串 / 非 YYYY-MM-DD ⇒ 400 INVALID_ARGUMENT
 *   - ledger_id 可选（§6.2）：指定导出目标账本；缺省由 resolveActiveLedger 按用户态解析
 */
function parseCreateBody(raw: unknown): CreateExportBody {
  if (raw === undefined || raw === null) return {};
  if (typeof raw !== 'object' || Array.isArray(raw)) {
    throw new AppError(ErrorCode.INVALID_ARGUMENT, { message: 'body must be an object' });
  }
  const body = raw as Record<string, unknown>;
  for (const key of Object.keys(body)) {
    if (key !== 'from' && key !== 'to' && key !== 'ledger_id') {
      throw new AppError(ErrorCode.INVALID_ARGUMENT, {
        message: `unexpected field: ${key}`,
        details: { field: key, constraint: 'additionalProperties=false' },
      });
    }
  }
  const out: CreateExportBody = {};
  const ledgerId = body['ledger_id'];
  if (ledgerId !== undefined) {
    if (typeof ledgerId !== 'string' || ledgerId === '') {
      throw new AppError(ErrorCode.INVALID_ARGUMENT, {
        message: `invalid ledger_id: ${String(ledgerId)}`,
        details: { field: 'ledger_id', value: ledgerId, constraint: 'non-empty string' },
      });
    }
    out.ledgerId = ledgerId;
  }
  for (const key of ['from', 'to'] as const) {
    const value = body[key];
    if (value === undefined) continue;
    if (typeof value !== 'string' || !DATE_PATTERN.test(value)) {
      throw new AppError(ErrorCode.INVALID_ARGUMENT, {
        message: `invalid date: ${String(value)}`,
        details: { field: key, value, constraint: 'YYYY-MM-DD' },
      });
    }
    out[key] = value;
  }
  return out;
}

/**
 * YYYY-MM-DD → Asia/Shanghai 区间端点（无效日期 ⇒ 400）。
 * 存储语义是半开区间 [from, to+1d)（migration 0021 列注释「导出结束（不含）」）：
 *   start = 当日 00:00（含）；end = 次日 00:00（不含）。
 * 排他端避免了「endOf(day) 毫秒截断漏掉 23:59:59.999 之后微秒级记录」的窗口。
 */
function parseRangeDate(value: string, edge: 'start' | 'end'): Date {
  const dt = DateTime.fromISO(value, { zone: SHANGHAI_ZONE });
  if (!dt.isValid) {
    throw new AppError(ErrorCode.INVALID_ARGUMENT, {
      message: `invalid date: ${value}`,
      details: { field: edge === 'start' ? 'from' : 'to', value, constraint: 'YYYY-MM-DD' },
    });
  }
  const start = dt.startOf('day');
  return (edge === 'start' ? start : start.plus({ days: 1 })).toJSDate();
}

/**
 * 解析"当前活跃账本"（body 缺省 ledger_id 时的回退链）：
 *   1. users.preferred_ledger_id（账本仍存在且用户仍是活跃成员）
 *   2. 个人 family 的首个账本（登录即保证存在）
 */
async function resolveActiveLedger(userId: string): Promise<LedgerEntity> {
  const user = await userRepo.findById(userId);
  if (user?.preferredLedgerId) {
    const preferred = await ledgerRepo.findById(user.preferredLedgerId);
    if (preferred && !preferred.deletedAt) {
      const member = await familyMemberRepo.isActiveMember(userId, preferred.familyId);
      if (member) return preferred;
    }
  }
  const personal = await familyRepo.findPersonalFamily(userId);
  if (personal) {
    const ledger = await ledgerRepo.findFirstByFamilyId(personal.id);
    if (ledger) return ledger;
  }
  throw new AppError(ErrorCode.NOT_FOUND, { message: 'no ledger available for export' });
}

/**
 * 解析导出目标账本（§6.2）：
 *   - body.ledger_id 指定 ⇒ 校验存在 + 未软删 + 当前用户活跃成员（与 detect 同一判据）；
 *   - 缺省 ⇒ 回退"当前活跃账本"（resolveActiveLedger）。
 */
async function resolveExportLedger(userId: string, ledgerId: string | undefined): Promise<LedgerEntity> {
  if (ledgerId === undefined) return resolveActiveLedger(userId);
  const ledger = await ledgerRepo.findById(ledgerId);
  if (!ledger || ledger.deletedAt) {
    throw new AppError(ErrorCode.NOT_FOUND, { message: 'ledger not found' });
  }
  const memberOk = await familyMemberRepo.isActiveMember(userId, ledger.familyId);
  if (!memberOk) {
    throw new AppError(ErrorCode.FAMILY_NOT_MEMBER, { message: 'not an active member of this family' });
  }
  return ledger;
}

// ==============================================================================
// 注册
// ==============================================================================

export async function registerDataJobsRoutes(app: FastifyInstance): Promise<void> {
  // POST /export-jobs · 创建导出任务
  app.post('/export-jobs', async (req, reply) => {
    const userId = await requireUserId(req);
    const body = parseCreateBody(req.body);

    // from<=to 在原始日期串上判定（YYYY-MM-DD 字典序即时间序）：
    // 换成端点后 from==to 合法（排他端 +1 天），直接比端点会漏判倒挂
    if (body.from !== undefined && body.to !== undefined && body.from > body.to) {
      throw new AppError(ErrorCode.INVALID_ARGUMENT, {
        message: 'from must not be later than to',
        details: { field: 'from', value: body.from, constraint: 'from<=to' },
      });
    }
    const exportFrom = body.from !== undefined ? parseRangeDate(body.from, 'start') : null;
    const exportTo = body.to !== undefined ? parseRangeDate(body.to, 'end') : null;

    const ledger = await resolveExportLedger(userId, body.ledgerId);

    // 并发闸口：活跃任务 ⇒ 409；排队幽灵先回收
    const active = await dataJobRepo.findActiveExportJobByUser(userId);
    if (active) {
      if (active.status === 'queued' && active.expiresAt && active.expiresAt.getTime() <= Date.now()) {
        await dataJobRepo.failExpiredQueuedJob(userId);
      } else {
        throw new AppError(ErrorCode.EXPORT_JOB_IN_PROGRESS, {
          message: 'an export job is already in progress',
          details: { job_id: active.id },
        });
      }
    }

    let job: DataJobEntity;
    try {
      job = await dataJobRepo.createExportJob({
        userId,
        familyId: ledger.familyId,
        ledgerId: ledger.id,
        exportFrom,
        exportTo,
      });
    } catch (err) {
      // 生产竞态：两请求同时通过闸口判定 ⇒ 部分唯一索引 23505 ⇒ 败者 409
      if ((err as { code?: string }).code === '23505') {
        throw new AppError(ErrorCode.EXPORT_JOB_IN_PROGRESS, {
          message: 'an export job is already in progress',
        });
      }
      throw err;
    }

    req.log.info(
      {
        audit: 'data_export',
        action: 'create',
        user_id: userId,
        family_id: ledger.familyId,
        ledger_id: ledger.id,
        job_id: job.id,
        date_from: exportFrom,
        date_to: exportTo,
      },
      'data export job created',
    );

    // 事件触发：不等下一个 tick（worker 立即领取）
    app.dataJobScheduler?.kick();

    // createExportJob 走 INSERT ... RETURNING（无法 JOIN 取名），用已解析的 ledger 补齐 ledger_name
    return reply.code(201).send(serializeJob({ ...job, ledgerName: ledger.name }));
    },
  );

  // GET /data-jobs?limit=N · 任务中心列表（带 server_now · 阶段型模拟进度时间基准）
  app.get<{ Querystring: { limit?: number } }>(
    '/data-jobs',
    { schema: { querystring: listQuerySchema } },
    async (req, reply) => {
      const userId = await requireUserId(req);
      const limit = req.query.limit ?? LIST_LIMIT_DEFAULT;
      const jobs = await dataJobRepo.listByOwner(userId, limit);
      return reply.code(200).send({
        jobs: jobs.map(serializeJob),
        server_now: new Date().toISOString(),
      });
    },
  );

  // GET /data-jobs/{job_id} · 单任务详情（带 server_now）
  app.get<{ Params: { job_id: string } }>('/data-jobs/:job_id', async (req, reply) => {
    const userId = await requireUserId(req);
    const job = await dataJobRepo.findById(req.params.job_id);
    if (!job || job.userId !== userId) {
      throw new AppError(ErrorCode.NOT_FOUND, { message: 'data job not found' });
    }
    return reply.code(200).send({ ...serializeJob(job), server_now: new Date().toISOString() });
  });

  // GET /data-jobs/{job_id}/download?part=N · 签发导出分片 COS 预签名下载 URL
  // （两步下载第一步 · cos-offload-phase1 v0.2 §4.2：鉴权留在 Costra，流量交给 COS）
  app.get<{ Params: { job_id: string }; Querystring: { part?: number } }>(
    '/data-jobs/:job_id/download',
    { schema: { querystring: downloadQuerySchema } },
    async (req, reply) => {
      const userId = await requireUserId(req);
      const job = await dataJobRepo.findById(req.params.job_id);
      if (!job || job.userId !== userId) {
        throw new AppError(ErrorCode.NOT_FOUND, { message: 'data job not found' });
      }
      // 完成前下载：任务存在但产物未就绪 ⇒ 404（§9.5 完成前下载 404）
      if (job.status !== 'succeeded' || !job.files || job.files.length === 0) {
        throw new AppError(ErrorCode.NOT_FOUND, { message: 'export file not ready' });
      }
      // 过期：24h 有效期已过 ⇒ 410（§9.5 EXPORT_FILE_EXPIRED · 先于签发拦截；
      // COS 30 天生命周期只兜底清理，用户可见过期由本判定保证）
      if (job.fileExpiresAt && job.fileExpiresAt.getTime() <= Date.now()) {
        throw new AppError(ErrorCode.EXPORT_FILE_EXPIRED, {
          message: 'export file has expired',
        });
      }
      const part = req.query.part ?? 1; // §6.5：part 缺省 = 第 1 分片
      const file = job.files.find((f) => f.part === part);
      if (!file) {
        throw new AppError(ErrorCode.NOT_FOUND, {
          message: `export part ${part} not found`,
        });
      }
      const storageMonth = job.resultSummary?.['storage_month'];
      if (typeof storageMonth !== 'string' || storageMonth === '') {
        // 数据不一致（succeeded 但缺产物定位）⇒ 不当成用户可见资源
        throw new AppError(ErrorCode.NOT_FOUND, { message: 'export artifact metadata missing' });
      }
      // 24h 窗口内对象必然在（生命周期 30 天 ≫ 24h · 无针对 succeeded 任务的删除路径）
      // ⇒ 不做存在性预检直接签发；每分片单独签发 300s（§4.0 决策）
      const url = await getCosClient('exports').presignGet(
        `exports/${storageMonth}/${job.id}_${file.part}.csv`,
        PRESIGN_EXPIRES_SECONDS,
      );
      // sha256 以本响应为权威源（§4.0：与 URL 同源同刻 · 列表 files[].sha256 仅展示）
      return reply.code(200).send({
        url,
        size_bytes: file.size_bytes,
        sha256: file.sha256,
        filename: file.filename,
      });
    },
  );
}
