/**
 * Costra · Server · 账本导出（data_jobs 一期）端到端单测
 *
 * 事实源：docs/design/data-import-export-client-analysis.md v1.0 §6/§7.3/§7.5/§9.5/§14.1
 *
 * 覆盖：
 *   R1  POST /export-jobs：创建成功（默认活跃账本解析）+ 响应契约形态
 *   R2  POST /export-jobs：from/to 合法性（非法日期 400 · from>to 400 · 合法入库）
 *   R3  POST /export-jobs：鉴权（无 token 401 · refresh token 401 · B0 守门）
 *   R4  POST /export-jobs：并发闸口（活跃任务 409 EXPORT_JOB_IN_PROGRESS）
 *   R5  POST /export-jobs：排队幽灵回收（expires_at 过期的 queued 先终态化再放行新任务）
 *   R6  GET /data-jobs / {job_id}：列表倒序 + server_now + 详情（非本人 404）
 *   R7  下载：完成前 404 · part 越界 404 · 非本人 404 · 过期 410 EXPORT_FILE_EXPIRED ·
 *       磁盘产物缺失 410
 *   W1  worker 端到端：条目齐全（类型/归属/分类两级/记账人/备注/apostrophe 防护/金额）+
 *       BOM + 表头 + CRLF + sha256 头 + result_summary + file_expires_at≈24h + 文件名规则
 *   W2  空账本导出：entry_count=0 · 单分片仅表头 · 文件名用当天日期
 *   W3  日期区间过滤：from/to 只导出区间内流水
 *   W4  上下文失效终态：账本软删 ⇒ failed CONTEXT_INVALIDATED（不可重试）
 *   W5  僵尸回收：processing 租约过期 ⇒ attempts<3 回队 WORKER_LOST；attempts≥3 终态 INTERNAL
 *   X1  游标微秒安全：同毫秒不同微秒跨页不漏不重（runEntryExport 小 pageSize 直测）
 *   X2  分片双阈值：行数阈值与字节阈值各自触发（多分片 _NofM 命名 + 每片 BOM/表头/sha256）
 *   X3  重试清场：同一 job 重跑前清掉旧分片（removeJobArtifacts）
 *   C1  classifyExportError 判定矩阵（CONTEXT_INVALIDATED / TRANSIENT_DB / TRANSIENT_IO /
 *       INTERNAL · attempts 耗尽即终态）
 */

import { randomUUID, createHash } from 'node:crypto';
import { mkdtempSync, readFileSync, existsSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, it, expect, beforeEach, beforeAll } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../src/app.js';
import { getPool } from '../src/db/pool.js';
import { setWxFetchForTests } from '../src/wx/code2Session.js';
import {
  setExportRootForTests,
  runEntryExport,
  removeJobArtifacts,
  ExportContextInvalidError,
  EXPORT_MAX_ROWS_PER_PART,
  EXPORT_MAX_BYTES_PER_PART,
} from '../src/services/entryExport.js';
import { classifyExportError } from '../src/services/dataJobScheduler.js';
import type { DataJobEntity } from '../src/repositories/dataJobRepo.js';

let app: FastifyInstance;
let exportRoot: string;

beforeAll(() => {
  exportRoot = mkdtempSync(join(tmpdir(), 'costra-export-test-'));
  setExportRootForTests(exportRoot);
});

beforeEach(async () => {
  app = await buildApp({ disableLogger: true });
  await app.ready();
});

// ─── helpers ─────────────────────────────────────────────────────────────────

function mockCode2Session(openid: string): void {
  setWxFetchForTests(
    (async (): Promise<Response> => {
      return new Response(JSON.stringify({ openid, session_key: 'sk' }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    }) as unknown as typeof fetch,
  );
}

async function login(
  openid: string,
): Promise<{ token: string; refreshToken: string; userId: string; ledgerId: string }> {
  mockCode2Session(openid);
  const res = await app.inject({ method: 'POST', url: '/v1/auth/wx-login', payload: { code: `c-${openid}` } });
  const body = res.json() as {
    access_token: string;
    refresh_token: string;
    user: { id: string };
    default_ledger_id: string;
  };
  return {
    token: body.access_token,
    refreshToken: body.refresh_token,
    userId: body.user.id,
    ledgerId: body.default_ledger_id,
  };
}

function auth(token: string): Record<string, string> {
  return { authorization: `Bearer ${token}` };
}

interface SeedEntry {
  ledgerId: string;
  createdBy: string;
  amount?: number;
  type?: 'expense' | 'income' | 'transfer';
  categoryId?: string | null;
  note?: string | null;
  occurredAt: string;
  sharedType?: 'shared' | 'personal' | null;
  deletedAt?: string | null;
}

async function insertEntry(p: SeedEntry): Promise<string> {
  const id = randomUUID();
  await getPool().query(
    `INSERT INTO entries (id, ledger_id, amount, currency, type, category_id, note, occurred_at, created_by, shared_type, deleted_at)
     VALUES ($1, $2, $3, 'CNY', $4, $5, $6, $7, $8, $9, $10)`,
    [
      id,
      p.ledgerId,
      p.amount ?? 100,
      p.type ?? 'expense',
      p.categoryId ?? null,
      p.note ?? null,
      p.occurredAt,
      p.createdBy,
      p.sharedType ?? null,
      p.deletedAt ?? null,
    ],
  );
  return id;
}

async function insertCategory(opts: {
  name: string;
  type: string;
  parentId?: string | null;
}): Promise<string> {
  const id = randomUUID();
  await getPool().query(
    `INSERT INTO categories (id, family_id, name, type, icon, parent_id) VALUES ($1, NULL, $2, $3, 'icon', $4)`,
    [id, opts.name, opts.type, opts.parentId ?? null],
  );
  return id;
}

async function createExportJob(token: string, body: Record<string, unknown> = {}) {
  return app.inject({
    method: 'POST',
    url: '/v1/export-jobs',
    headers: { ...auth(token), 'content-type': 'application/json' },
    payload: body,
  });
}

async function getJobRow(id: string): Promise<Record<string, unknown>> {
  const r = await getPool().query(`SELECT * FROM data_jobs WHERE id = $1`, [id]);
  return r.rows[0] as Record<string, unknown>;
}

/** 直造一个"已 claim"的任务实体（runEntryExport 直测用 · 绕开 claim 仪式） */
function fabricateClaimedJob(overrides: Partial<DataJobEntity>): DataJobEntity {
  const now = new Date();
  return {
    id: randomUUID(),
    type: 'export',
    status: 'processing',
    userId: '',
    familyId: '',
    ledgerId: '',
    ledgerName: null, // 直造实体不走 JOIN 路径 · 与 INSERT...RETURNING 口径一致
    detectId: null,
    sourceHash: null,
    rulesetVersion: null,
    exportFrom: null,
    exportTo: null,
    attempts: 1,
    stage: 'querying',
    stageStartedAt: now,
    runToken: randomUUID(),
    leaseExpiresAt: new Date(now.getTime() + 90_000),
    retryable: false,
    errorCode: null,
    errorMessage: null,
    nextAttemptAt: null,
    expiresAt: null,
    resultSummary: null,
    files: null,
    fileExpiresAt: null,
    createdAt: now,
    startedAt: now,
    finishedAt: null,
    ...overrides,
  };
}

// ==============================================================================
// R1 · 创建成功
// ==============================================================================

describe('R1 · POST /export-jobs 创建成功', () => {
  it('201 + 任务对象契约形态 + 默认解析当前活跃账本（个人账本）', async () => {
    const { token, userId, ledgerId } = await login('openid-r1');
    const res = await createExportJob(token);
    expect(res.statusCode).toBe(201);
    const job = res.json() as Record<string, unknown>;
    expect(job['type']).toBe('export');
    expect(job['status']).toBe('queued');
    expect(job['stage']).toBeNull();
    expect(job['retryable']).toBe(false);
    expect(job['error']).toBeNull();
    expect(job['attempts']).toBe(0);
    expect(job['files']).toEqual([]);
    expect(job['export_from']).toBeNull(); // 全部流水 ⇒ 双 null
    expect(job['export_to']).toBeNull();
    expect(typeof job['id']).toBe('string');
    expect(typeof job['created_at']).toBe('string');

    const row = await getJobRow(job['id'] as string);
    expect(row['user_id']).toBe(userId);
    expect(row['ledger_id']).toBe(ledgerId);
    expect(row['expires_at']).not.toBeNull(); // 排队租约

    // ledger_name 是 §7.6 契约字段（任务卡展示归属）。create 走 INSERT...RETURNING 无法
    // JOIN 取名，由路由用已解析的 ledger 补齐 —— 与列表路径（LEFT JOIN）须给出同一个值
    const ledgerName = (
      await getPool().query<{ name: string }>(`SELECT name FROM ledgers WHERE id = $1`, [ledgerId])
    ).rows[0]!.name;
    expect(job['ledger_name']).toBe(ledgerName);
  });

  it('空 body（无 content-type JSON）也可创建（from/to 全缺省）', async () => {
    const { token } = await login('openid-r1b');
    const res = await app.inject({ method: 'POST', url: '/v1/export-jobs', headers: auth(token) });
    expect(res.statusCode).toBe(201);
  });
});

// ==============================================================================
// R2 · from/to 合法性
// ==============================================================================

describe('R2 · from/to 合法性', () => {
  it('非法日期 ⇒ 400 INVALID_ARGUMENT', async () => {
    const { token } = await login('openid-r2a');
    const res = await createExportJob(token, { from: '2026-13-01' });
    expect(res.statusCode).toBe(400);
    expect((res.json() as { code: string }).code).toBe('INVALID_ARGUMENT');
  });

  it('from 晚于 to ⇒ 400 INVALID_ARGUMENT', async () => {
    const { token } = await login('openid-r2b');
    const res = await createExportJob(token, { from: '2026-06-10', to: '2026-06-01' });
    expect(res.statusCode).toBe(400);
    expect((res.json() as { code: string }).code).toBe('INVALID_ARGUMENT');
  });

  it('合法区间入库（export_from/to = 上海当日起止）', async () => {
    const { token } = await login('openid-r2c');
    const res = await createExportJob(token, { from: '2026-06-01', to: '2026-06-30' });
    expect(res.statusCode).toBe(201);
    const row = await getJobRow((res.json() as { id: string }).id);
    const from = new Date(row['export_from'] as string);
    const to = new Date(row['export_to'] as string);
    expect(from.toISOString()).toBe('2026-05-31T16:00:00.000Z'); // 上海 6-01 00:00
    // 半开区间排他端：上海 7-01 00:00（selected to 次日 00:00 · occurred_at < export_to）
    expect(to.toISOString()).toBe('2026-06-30T16:00:00.000Z');
  });
});

// ==============================================================================
// R2b · 目标账本选择（body.ledger_id · §6.2）
// ==============================================================================

describe('R2b · 目标账本选择（body.ledger_id）', () => {
  it('显式指定本人活跃账本 ⇒ 201 且落在该账本', async () => {
    const { token, ledgerId } = await login('openid-r2b1');
    const res = await createExportJob(token, { ledger_id: ledgerId });
    expect(res.statusCode).toBe(201);
    const row = await getJobRow((res.json() as { id: string }).id);
    expect(row['ledger_id']).toBe(ledgerId);
  });

  it('指定不存在的账本 ⇒ 404 NOT_FOUND', async () => {
    const { token } = await login('openid-r2b2');
    const res = await createExportJob(token, { ledger_id: randomUUID() });
    expect(res.statusCode).toBe(404);
    expect((res.json() as { code: string }).code).toBe('NOT_FOUND');
  });

  it('指定他人账本（非活跃成员）⇒ 403 FAMILY_NOT_MEMBER', async () => {
    const { ledgerId } = await login('openid-r2b3-owner');
    const { token } = await login('openid-r2b3-stranger');
    const res = await createExportJob(token, { ledger_id: ledgerId });
    expect(res.statusCode).toBe(403);
    expect((res.json() as { code: string }).code).toBe('FAMILY_NOT_MEMBER');
  });

  it('ledger_id 非字符串 ⇒ 400 INVALID_ARGUMENT；契约外字段仍 400', async () => {
    const { token } = await login('openid-r2b4');
    const bad = await createExportJob(token, { ledger_id: 123 });
    expect(bad.statusCode).toBe(400);
    const extra = await createExportJob(token, { tenant: 'x' });
    expect(extra.statusCode).toBe(400);
  });
});

// ==============================================================================
// R3 · 鉴权
// ==============================================================================

describe('R3 · 鉴权', () => {
  it('无 token ⇒ 401 UNAUTHENTICATED', async () => {
    const res = await app.inject({ method: 'POST', url: '/v1/export-jobs' });
    expect(res.statusCode).toBe(401);
    expect((res.json() as { code: string }).code).toBe('UNAUTHENTICATED');
  });

  it('refresh token 调业务端点 ⇒ 401（B0 守门 · token_type 判定）', async () => {
    const { refreshToken } = await login('openid-r3');
    const res = await createExportJob(refreshToken);
    expect(res.statusCode).toBe(401);
    expect((res.json() as { code: string }).code).toBe('UNAUTHENTICATED');
  });
});

// ==============================================================================
// R4 · 并发闸口
// ==============================================================================

describe('R4 · 并发闸口', () => {
  it('已有活跃导出任务 ⇒ 409 EXPORT_JOB_IN_PROGRESS（details.job_id 回传）', async () => {
    const { token } = await login('openid-r4');
    const first = await createExportJob(token);
    expect(first.statusCode).toBe(201);
    const firstId = (first.json() as { id: string }).id;

    const second = await createExportJob(token);
    expect(second.statusCode).toBe(409);
    const body = second.json() as { code: string; details?: { job_id?: string } };
    expect(body.code).toBe('EXPORT_JOB_IN_PROGRESS');
    expect(body.details?.job_id).toBe(firstId);
  });

  it('既有任务终态后可再发起', async () => {
    const { token } = await login('openid-r4b');
    const first = await createExportJob(token);
    const firstId = (first.json() as { id: string }).id;
    await getPool().query(`UPDATE data_jobs SET status = 'succeeded' WHERE id = $1`, [firstId]);
    const second = await createExportJob(token);
    expect(second.statusCode).toBe(201);
  });
});

// ==============================================================================
// R5 · 排队幽灵回收
// ==============================================================================

describe('R5 · 排队幽灵回收', () => {
  it('expires_at 过期的 queued 幽灵先终态化（QUEUE_LEASE_EXPIRED）再放行新任务', async () => {
    const { token, userId, ledgerId } = await login('openid-r5');
    const familyId = (
      await getPool().query(`SELECT family_id FROM ledgers WHERE id = $1`, [ledgerId])
    ).rows[0]['family_id'] as string;

    // 直插一个排队租约已过期的幽灵任务
    const ghostId = randomUUID();
    await getPool().query(
      `INSERT INTO data_jobs (id, type, status, user_id, family_id, ledger_id, expires_at)
       VALUES ($1, 'export', 'queued', $2, $3, $4, now() - interval '1 minute')`,
      [ghostId, userId, familyId, ledgerId],
    );

    const res = await createExportJob(token);
    expect(res.statusCode).toBe(201);

    const ghost = await getJobRow(ghostId);
    expect(ghost['status']).toBe('failed');
    expect(ghost['error_code']).toBe('QUEUE_LEASE_EXPIRED');
    expect(ghost['retryable']).toBe(true);
  });
});

// ==============================================================================
// R6 · 列表与详情
// ==============================================================================

describe('R6 · GET /data-jobs', () => {
  it('列表倒序 + server_now + 详情带 server_now；非本人 404', async () => {
    const { token, ledgerId } = await login('openid-r6');
    const first = await createExportJob(token);
    const firstId = (first.json() as { id: string }).id;
    // 让第一个任务终态，再建第二个
    await getPool().query(`UPDATE data_jobs SET status = 'failed' WHERE id = $1`, [firstId]);
    const second = await createExportJob(token);
    const secondId = (second.json() as { id: string }).id;

    const list = await app.inject({ method: 'GET', url: '/v1/data-jobs', headers: auth(token) });
    expect(list.statusCode).toBe(200);
    const listBody = list.json() as {
      jobs: Array<{ id: string; ledger_name: string | null }>;
      server_now: string;
    };
    expect(listBody.jobs.map((j) => j.id)).toEqual([secondId, firstId]);
    expect(typeof listBody.server_now).toBe('string');

    // ledger_name 由 LEFT JOIN ledgers 下发（§7.6 · 多账本用户据此区分任务归属）
    const ledgerName = (
      await getPool().query<{ name: string }>(`SELECT name FROM ledgers WHERE id = $1`, [ledgerId])
    ).rows[0]!.name;
    expect(listBody.jobs.map((j) => j.ledger_name)).toEqual([ledgerName, ledgerName]);

    const detail = await app.inject({
      method: 'GET',
      url: `/v1/data-jobs/${secondId}`,
      headers: auth(token),
    });
    expect(detail.statusCode).toBe(200);
    const detailBody = detail.json() as { id: string; server_now: string; ledger_name: string | null };
    expect(detailBody.id).toBe(secondId);
    expect(typeof detailBody.server_now).toBe('string');
    expect(detailBody.ledger_name).toBe(ledgerName);

    // 非本人 ⇒ 404（不泄露存在性）
    const stranger = await login('openid-r6-stranger');
    const alien = await app.inject({
      method: 'GET',
      url: `/v1/data-jobs/${secondId}`,
      headers: auth(stranger.token),
    });
    expect(alien.statusCode).toBe(404);
  });
});

// ==============================================================================
// W1 · worker 端到端
// ==============================================================================

async function tick(): Promise<void> {
  await app.dataJobScheduler!.tickOnce();
}

describe('W1 · worker 端到端', () => {
  it('条目齐全 + CSV 三层规则 + 产物元数据 + 下载流 + 过期 410', async () => {
    const { token, userId, ledgerId } = await login('openid-w1');

    // 分类：一级「餐饮」+ 二级「午餐」；一级独立「工资」
    const catFood = await insertCategory({ name: '餐饮', type: 'expense' });
    const catLunch = await insertCategory({ name: '午餐', type: 'expense', parentId: catFood });
    const catSalary = await insertCategory({ name: '工资', type: 'income' });

    await insertEntry({
      ledgerId, createdBy: userId, amount: 3550, type: 'expense', categoryId: catLunch,
      note: '团队午餐', occurredAt: '2026-06-10T06:30:00.000Z', sharedType: 'shared',
    });
    await insertEntry({
      ledgerId, createdBy: userId, amount: 120000, type: 'income', categoryId: catSalary,
      note: null, occurredAt: '2026-06-15T02:00:00.000Z',
    });
    await insertEntry({
      ledgerId, createdBy: userId, amount: 9900, type: 'transfer', categoryId: null,
      note: '转账备注', occurredAt: '2026-06-16T03:00:00.000Z',
    });
    // Formula 防护：备注以 = 开头
    await insertEntry({
      ledgerId, createdBy: userId, amount: 100, type: 'expense', categoryId: null,
      note: '=SUM(A1:A2)', occurredAt: '2026-06-17T04:00:00.000Z', sharedType: 'personal',
    });
    // 前导单引号备注（v2 无条件加一层）
    await insertEntry({
      ledgerId, createdBy: userId, amount: 200, type: 'expense', categoryId: null,
      note: "'临时", occurredAt: '2026-06-18T05:00:00.000Z', sharedType: 'personal',
    });
    // 软删流水不得导出
    await insertEntry({
      ledgerId, createdBy: userId, amount: 300, type: 'expense', categoryId: null,
      note: '已删除', occurredAt: '2026-06-19T06:00:00.000Z', deletedAt: '2026-06-20T00:00:00Z',
    });

    const create = await createExportJob(token);
    expect(create.statusCode).toBe(201);
    const jobId = (create.json() as { id: string }).id;

    await tick();

    const detail = await app.inject({
      method: 'GET',
      url: `/v1/data-jobs/${jobId}`,
      headers: auth(token),
    });
    const job = detail.json() as {
      status: string;
      stage: string | null;
      result_summary: { entry_count: number; part_count: number; storage_month: string };
      files: Array<{
        part: number;
        filename: string;
        size_bytes: number;
        sha256: string;
        download_path: string;
      }>;
      file_expires_at: string;
      finished_at: string;
    };
    expect(job.status).toBe('succeeded');
    expect(job.stage).toBeNull();
    expect(job.result_summary.entry_count).toBe(5); // 软删 1 条被排除
    expect(job.result_summary.part_count).toBe(1);
    expect(job.files.length).toBe(1);

    // file_expires_at ≈ finished_at + 24h
    const expiresMs = new Date(job.file_expires_at).getTime();
    const finishedMs = new Date(job.finished_at).getTime();
    expect(expiresMs - finishedMs).toBe(24 * 3_600_000);

    // 文件名规则：Costra_个人账本_2026-06-10至2026-06-18_<ts>.csv（§2.2 连字符日期段 · 单分片无 _NofM）
    const filename = job.files[0]!.filename;
    expect(filename).toMatch(/^Costra_个人账本_2026-06-10至2026-06-18_\d{8}T\d{6}\.csv$/);

    // 下载：内容 + 头
    const dl = await app.inject({
      method: 'GET',
      url: `/v1/data-jobs/${jobId}/download?part=1`,
      headers: auth(token),
    });
    expect(dl.statusCode).toBe(200);
    expect(dl.headers['content-type']).toContain('text/csv');
    expect(dl.headers['content-disposition']).toContain('attachment');
    expect(dl.headers['content-disposition']).toContain("filename*=UTF-8''");
    expect(dl.headers['x-content-sha256']).toBe(job.files[0]!.sha256);

    const content = dl.body;
    const buffer = dl.rawPayload;
    expect(createHash('sha256').update(buffer).digest('hex')).toBe(job.files[0]!.sha256);
    expect(buffer.byteLength).toBe(job.files[0]!.size_bytes);

    // BOM + 表头 + CRLF
    expect(content.charCodeAt(0)).toBe(0xfeff);
    const lines = content.slice(1).split('\r\n');
    expect(lines[0]).toBe('"日期","时间","类型","金额","一级分类","二级分类","归属","记账人","备注"');
    // 5 条数据 + 尾部空段（末尾 CRLF）
    expect(lines.length).toBe(1 + 5 + 1);
    expect(lines[lines.length - 1]).toBe('');

    // 行 1：expense + 二级分类 + 共同 + 金额 35.50（上海时区 14:30）
    expect(lines[1]).toBe('"2026-06-10","14:30","支出","35.50","餐饮","午餐","共同","微信用户","团队午餐"');
    // 行 2：income + 一级分类 + 无归属 + 空备注
    expect(lines[2]).toBe('"2026-06-15","10:00","收入","1200.00","工资","","","微信用户",""');
    // 行 3：transfer + 无分类 + 无归属
    expect(lines[3]).toBe('"2026-06-16","11:00","转账","99.00","","","","微信用户","转账备注"');
    // 行 4：Formula 防护（= 开头加一层）
    expect(lines[4]).toBe('"2026-06-17","12:00","支出","1.00","","","个人","微信用户","\'=SUM(A1:A2)"');
    // 行 5：前导单引号备注（v2 加一层）
    expect(lines[5]).toBe('"2026-06-18","13:00","支出","2.00","","","个人","微信用户","\'\'临时"');

    // 完成前下载 404（另一个未完成任务）
    const pending = await createExportJob(token);
    expect(pending.statusCode).toBe(201);
    const pendingId = (pending.json() as { id: string }).id;
    const notReady = await app.inject({
      method: 'GET',
      url: `/v1/data-jobs/${pendingId}/download?part=1`,
      headers: auth(token),
    });
    expect(notReady.statusCode).toBe(404);

    // part 越界 404
    const badPart = await app.inject({
      method: 'GET',
      url: `/v1/data-jobs/${jobId}/download?part=2`,
      headers: auth(token),
    });
    expect(badPart.statusCode).toBe(404);

    // 非本人下载 404
    const stranger = await login('openid-w1-stranger');
    const alien = await app.inject({
      method: 'GET',
      url: `/v1/data-jobs/${jobId}/download?part=1`,
      headers: auth(stranger.token),
    });
    expect(alien.statusCode).toBe(404);

    // 过期 410 EXPORT_FILE_EXPIRED
    await getPool().query(`UPDATE data_jobs SET file_expires_at = now() - interval '1 second' WHERE id = $1`, [jobId]);
    const expired = await app.inject({
      method: 'GET',
      url: `/v1/data-jobs/${jobId}/download?part=1`,
      headers: auth(token),
    });
    expect(expired.statusCode).toBe(410);
    expect((expired.json() as { code: string }).code).toBe('EXPORT_FILE_EXPIRED');
  });

  it('磁盘产物缺失（已被清理）⇒ 410 EXPORT_FILE_EXPIRED', async () => {
    const { token, userId, ledgerId } = await login('openid-w1x');
    await insertEntry({ ledgerId, createdBy: userId, occurredAt: '2026-06-10T00:00:00Z' });
    const create = await createExportJob(token);
    const jobId = (create.json() as { id: string }).id;
    await tick();
    // 清掉磁盘产物但保留 DB 记录
    await removeJobArtifacts(jobId);
    const dl = await app.inject({
      method: 'GET',
      url: `/v1/data-jobs/${jobId}/download?part=1`,
      headers: auth(token),
    });
    expect(dl.statusCode).toBe(410);
    expect((dl.json() as { code: string }).code).toBe('EXPORT_FILE_EXPIRED');
  });
});

// ==============================================================================
// W2 · 空账本导出
// ==============================================================================

describe('W2 · 空账本导出', () => {
  it('entry_count=0 · 单分片仅表头 · 文件名用当天日期', async () => {
    const { token } = await login('openid-w2');
    const create = await createExportJob(token);
    const jobId = (create.json() as { id: string }).id;
    await tick();

    const row = await getJobRow(jobId);
    expect(row['status']).toBe('succeeded');
    const summary = row['result_summary'] as { entry_count: number; part_count: number };
    expect(summary.entry_count).toBe(0);
    expect(summary.part_count).toBe(1);

    const dl = await app.inject({
      method: 'GET',
      url: `/v1/data-jobs/${jobId}/download?part=1`,
      headers: auth(token),
    });
    const content = dl.body;
    expect(content.charCodeAt(0)).toBe(0xfeff);
    expect(content.slice(1)).toBe(
      '"日期","时间","类型","金额","一级分类","二级分类","归属","记账人","备注"\r\n',
    );
  });
});

// ==============================================================================
// W3 · 日期区间过滤
// ==============================================================================

describe('W3 · 日期区间过滤', () => {
  it('from/to 只导出区间内流水（边界含当日）', async () => {
    const { token, userId, ledgerId } = await login('openid-w3');
    await insertEntry({ ledgerId, createdBy: userId, occurredAt: '2026-05-31T16:00:00.000Z' }); // 上海 6-01 00:00 ⇒ 含
    await insertEntry({ ledgerId, createdBy: userId, occurredAt: '2026-05-31T15:59:59.999Z' }); // 上海 5-31 23:59 ⇒ 不含
    await insertEntry({ ledgerId, createdBy: userId, occurredAt: '2026-06-30T15:59:59.999Z' }); // 上海 6-30 23:59 ⇒ 含
    await insertEntry({ ledgerId, createdBy: userId, occurredAt: '2026-06-30T16:00:00.000Z' }); // 上海 7-01 00:00 ⇒ 不含

    const create = await createExportJob(token, { from: '2026-06-01', to: '2026-06-30' });
    const jobId = (create.json() as { id: string }).id;
    await tick();

    const row = await getJobRow(jobId);
    expect((row['result_summary'] as { entry_count: number }).entry_count).toBe(2);
    const files = row['files'] as Array<{ filename: string }>;
    expect(files[0]!.filename).toContain('_2026-06-01至2026-06-30_');
    // source_date_*：客户端「重新生成」按原区间重发的事实源（不反解半开区间端点）
    const summary = row['result_summary'] as { source_date_from: string | null; source_date_to: string | null };
    expect(summary.source_date_from).toBe('2026-06-01');
    expect(summary.source_date_to).toBe('2026-06-30');
  });

  it('排他端边界：上海 6-30 23:59:59.999 含 · 上海 7-01 00:00 不含（无亚毫秒漏行窗口）', async () => {
    const { token, userId, ledgerId } = await login('openid-w3b');
    await insertEntry({ ledgerId, createdBy: userId, occurredAt: '2026-06-30T15:59:59.999Z' }); // 上海 6-30 23:59:59.999 ⇒ 含
    await insertEntry({ ledgerId, createdBy: userId, occurredAt: '2026-06-30T16:00:00.000Z' }); // 上海 7-01 00:00 ⇒ 不含
    const create = await createExportJob(token, { from: '2026-06-30', to: '2026-06-30' });
    const jobId = (create.json() as { id: string }).id;
    await tick();
    const row = await getJobRow(jobId);
    expect((row['result_summary'] as { entry_count: number }).entry_count).toBe(1);
    const files = row['files'] as Array<{ filename: string }>;
    // 同日区间：起止同日（排他端回推 1 天还原所选止日）
    expect(files[0]!.filename).toContain('_2026-06-30至2026-06-30_');
  });
});

// ==============================================================================
// W4 · 上下文失效终态
// ==============================================================================

describe('W4 · 上下文失效终态', () => {
  it('账本被软删 ⇒ failed CONTEXT_INVALIDATED · retryable=false', async () => {
    const { token, ledgerId } = await login('openid-w4');
    const create = await createExportJob(token);
    const jobId = (create.json() as { id: string }).id;
    await getPool().query(`UPDATE ledgers SET deleted_at = now() WHERE id = $1`, [ledgerId]);
    await tick();

    const row = await getJobRow(jobId);
    expect(row['status']).toBe('failed');
    expect(row['error_code']).toBe('CONTEXT_INVALIDATED');
    expect(row['retryable']).toBe(false);
    expect(row['stage']).toBe('querying'); // error.stage 保留失败时所在阶段
  });

  it('用户被移出家庭 ⇒ failed CONTEXT_INVALIDATED', async () => {
    const { token, userId, ledgerId } = await login('openid-w4b');
    const create = await createExportJob(token);
    const jobId = (create.json() as { id: string }).id;
    const familyId = (
      await getPool().query(`SELECT family_id FROM ledgers WHERE id = $1`, [ledgerId])
    ).rows[0]['family_id'] as string;
    await getPool().query(
      `UPDATE family_members SET left_at = now() WHERE family_id = $1 AND user_id = $2`,
      [familyId, userId],
    );
    await tick();

    const row = await getJobRow(jobId);
    expect(row['status']).toBe('failed');
    expect(row['error_code']).toBe('CONTEXT_INVALIDATED');
  });
});

// ==============================================================================
// W5 · 僵尸回收
// ==============================================================================

describe('W5 · 僵尸回收', () => {
  async function insertZombie(userId: string, familyId: string, ledgerId: string, attempts: number): Promise<string> {
    const id = randomUUID();
    await getPool().query(
      `INSERT INTO data_jobs (id, type, status, user_id, family_id, ledger_id, attempts, stage, run_token, lease_expires_at)
       VALUES ($1, 'export', 'processing', $2, $3, $4, $5, 'querying', $6, now() - interval '1 minute')`,
      [id, userId, familyId, ledgerId, attempts, randomUUID()],
    );
    return id;
  }

  it('attempts<3 ⇒ 回队（queued · retryable · WORKER_LOST · next_attempt_at 退避）', async () => {
    const { token, userId, ledgerId } = await login('openid-w5a');
    const familyId = (
      await getPool().query(`SELECT family_id FROM ledgers WHERE id = $1`, [ledgerId])
    ).rows[0]['family_id'] as string;
    const zombieId = await insertZombie(userId, familyId, ledgerId, 1);

    await tick();

    const row = await getJobRow(zombieId);
    expect(row['status']).toBe('queued');
    expect(row['retryable']).toBe(true);
    expect(row['error_code']).toBe('WORKER_LOST');
    expect(row['next_attempt_at']).not.toBeNull();
    expect(row['run_token']).toBeNull();
    expect(row['lease_expires_at']).toBeNull();

    // 清掉回队任务，避免影响后续（本用例独立登录用户，无干扰）
    void token;
  });

  it('attempts≥3 ⇒ 终态失败（INTERNAL · retryable=false）', async () => {
    const { userId, ledgerId } = await login('openid-w5b');
    const familyId = (
      await getPool().query(`SELECT family_id FROM ledgers WHERE id = $1`, [ledgerId])
    ).rows[0]['family_id'] as string;
    const zombieId = await insertZombie(userId, familyId, ledgerId, 3);

    await tick();

    const row = await getJobRow(zombieId);
    expect(row['status']).toBe('failed');
    expect(row['error_code']).toBe('INTERNAL');
    expect(row['retryable']).toBe(false);
  });
});

// ==============================================================================
// X1 · 游标微秒安全
// ==============================================================================

describe('X1 · 游标微秒安全', () => {
  // pg-mem 的 timestamptz 存储精度只有毫秒（µs 在写入时即截断），
  // 因此 pg-mem 下可表达的最坏情况 = "同一毫秒多行"——正是 id tiebreak 要解决的场景；
  // 生产 PG 的微秒游标由 to_char(...US...) 分支承担（csvExport.test.ts M2 静态断言）。
  it('同毫秒多行跨页不漏不重（pageSize=2 · 3 条同毫秒条目 · id tiebreak）', async () => {
    const { userId, ledgerId } = await login('openid-x1');
    const familyId = (
      await getPool().query(`SELECT family_id FROM ledgers WHERE id = $1`, [ledgerId])
    ).rows[0]['family_id'] as string;

    // 3 条同毫秒（.123）条目；pg-mem 下 µs 尾数被截断，三行共享同一 occurred_at
    const base = '2026-06-10T06:30:00.123';
    const micros = ['456', '457', '458'];
    for (const us of micros) {
      await insertEntry({
        ledgerId, createdBy: userId, occurredAt: `${base}${us}Z`, note: `u${us}`,
      });
    }

    const job = fabricateClaimedJob({ userId, familyId, ledgerId });
    const outcome = await runEntryExport(job, {
      pageSize: 2, // 强制 2 页
      maxRowsPerPart: EXPORT_MAX_ROWS_PER_PART,
      maxBytesPerPart: EXPORT_MAX_BYTES_PER_PART,
    });

    expect(outcome.entryCount).toBe(3);
    const content = readFileSync(
      join(exportRoot, outcome.storageMonth, `${job.id}_1.csv`),
      'utf8',
    );
    // 三行共享同一 occurred_at（pg-mem µs 截断），行序由 id ASC 决定（随机 UUID 不可预期）；
    // 本用例的断言核心是「不漏不重」，故按集合比较。
    const notes = [...content.matchAll(/"u45[678]"/g)].map((m) => m[0]);
    expect(notes.slice().sort()).toEqual(['"u456"', '"u457"', '"u458"']);
  });
});

// ==============================================================================
// X2 · 分片双阈值
// ==============================================================================

describe('X2 · 分片双阈值', () => {
  it('行数阈值：7 条 × 每片 3 行 ⇒ 3 个分片（_NofM 命名 + 每片 BOM/表头/sha256 正确）', async () => {
    const { userId, ledgerId } = await login('openid-x2a');
    const familyId = (
      await getPool().query(`SELECT family_id FROM ledgers WHERE id = $1`, [ledgerId])
    ).rows[0]['family_id'] as string;
    for (let i = 0; i < 7; i++) {
      await insertEntry({
        ledgerId, createdBy: userId, occurredAt: `2026-06-1${i}T06:30:00.000Z`, note: `n${i}`,
      });
    }

    const job = fabricateClaimedJob({ userId, familyId, ledgerId });
    const outcome = await runEntryExport(job, {
      pageSize: 500,
      maxRowsPerPart: 3,
      maxBytesPerPart: EXPORT_MAX_BYTES_PER_PART,
    });

    expect(outcome.entryCount).toBe(7);
    expect(outcome.partCount).toBe(3);
    expect(outcome.files.map((f) => f.part)).toEqual([1, 2, 3]);
    expect(outcome.files[0]!.filename).toContain('_1of3.csv');
    expect(outcome.files[1]!.filename).toContain('_2of3.csv');
    expect(outcome.files[2]!.filename).toContain('_3of3.csv');
    expect(outcome.files[0]!.download_path).toBe(`/data-jobs/${job.id}/download?part=1`);

    for (const f of outcome.files) {
      const buf = readFileSync(join(exportRoot, outcome.storageMonth, `${job.id}_${f.part}.csv`));
      expect(buf.byteLength).toBe(f.size_bytes);
      expect(createHash('sha256').update(buf).digest('hex')).toBe(f.sha256);
      const text = buf.toString('utf8');
      expect(text.charCodeAt(0)).toBe(0xfeff);
      expect(text.slice(1).startsWith('"日期","时间","类型","金额"')).toBe(true);
    }
  });

  it('字节阈值：极小字节上限 ⇒ 按字节切分（每片不超限）', async () => {
    const { userId, ledgerId } = await login('openid-x2b');
    const familyId = (
      await getPool().query(`SELECT family_id FROM ledgers WHERE id = $1`, [ledgerId])
    ).rows[0]['family_id'] as string;
    // 5 条带长备注的条目
    for (let i = 0; i < 5; i++) {
      await insertEntry({
        ledgerId, createdBy: userId, occurredAt: `2026-06-1${i}T06:30:00.000Z`,
        note: '长备注'.repeat(20),
      });
    }

    const job = fabricateClaimedJob({ userId, familyId, ledgerId });
    // 上限 = BOM+表头字节 + 约两行数据 ⇒ 每片至多 2 行
    const headerBytes = Buffer.byteLength('﻿' + '"日期","时间","类型","金额","一级分类","二级分类","归属","记账人","备注"' + '\r\n', 'utf8');
    const outcome = await runEntryExport(job, {
      pageSize: 500,
      maxRowsPerPart: EXPORT_MAX_ROWS_PER_PART,
      maxBytesPerPart: headerBytes + 500, // 两行约 300~500B ⇒ 强制按字节切
    });

    expect(outcome.entryCount).toBe(5);
    expect(outcome.partCount).toBeGreaterThan(1);
    for (const f of outcome.files) {
      expect(f.size_bytes).toBeLessThanOrEqual(headerBytes + 500);
    }
  });
});

// ==============================================================================
// X3 · 重试清场
// ==============================================================================

describe('X3 · 重试清场', () => {
  it('removeJobArtifacts 清掉同 job 全部旧分片（含 .tmp）', async () => {
    const { userId, ledgerId } = await login('openid-x3');
    const familyId = (
      await getPool().query(`SELECT family_id FROM ledgers WHERE id = $1`, [ledgerId])
    ).rows[0]['family_id'] as string;
    await insertEntry({ ledgerId, createdBy: userId, occurredAt: '2026-06-10T06:30:00.000Z' });

    const job = fabricateClaimedJob({ userId, familyId, ledgerId });
    const outcome = await runEntryExport(job);
    const monthDir = join(exportRoot, outcome.storageMonth);
    expect(existsSync(join(monthDir, `${job.id}_1.csv`))).toBe(true);

    // 手工遗留一个 .tmp 残留
    writeFileSync(join(monthDir, `${job.id}_2.csv.tmp`), 'junk');
    await removeJobArtifacts(job.id);
    expect(existsSync(join(monthDir, `${job.id}_1.csv`))).toBe(false);
    expect(existsSync(join(monthDir, `${job.id}_2.csv.tmp`))).toBe(false);

    // 重跑（模拟重试）：产物重新生成且不残留旧片
    const again = await runEntryExport(job);
    expect(again.partCount).toBe(1);
    expect(existsSync(join(monthDir, `${job.id}_1.csv`))).toBe(true);
  });
});

// ==============================================================================
// C1 · classifyExportError 判定矩阵
// ==============================================================================

describe('C1 · classifyExportError 判定矩阵', () => {
  it('ExportContextInvalidError ⇒ 终态 CONTEXT_INVALIDATED', () => {
    const v = classifyExportError(new ExportContextInvalidError('ledger gone'), 1);
    expect(v).toMatchObject({ terminal: true, errorCode: 'CONTEXT_INVALIDATED' });
  });

  it('PG transient SQLSTATE 且 attempts<3 ⇒ 回队 TRANSIENT_DB；attempts 耗尽 ⇒ 终态 INTERNAL', () => {
    const deadlock = Object.assign(new Error('deadlock detected'), { code: '40P01' });
    expect(classifyExportError(deadlock, 1)).toMatchObject({ terminal: false, errorCode: 'TRANSIENT_DB' });
    expect(classifyExportError(deadlock, 2)).toMatchObject({ terminal: false, errorCode: 'TRANSIENT_DB' });
    expect(classifyExportError(deadlock, 3)).toMatchObject({ terminal: true, errorCode: 'INTERNAL' });
  });

  it('fs transient errno 且 attempts<3 ⇒ 回队 TRANSIENT_IO', () => {
    const enospc = Object.assign(new Error('no space left'), { code: 'ENOSPC' });
    expect(classifyExportError(enospc, 1)).toMatchObject({ terminal: false, errorCode: 'TRANSIENT_IO' });
    expect(classifyExportError(enospc, 3)).toMatchObject({ terminal: true, errorCode: 'INTERNAL' });
  });

  it('未知异常 ⇒ 终态 INTERNAL', () => {
    expect(classifyExportError(new Error('boom'), 1)).toMatchObject({ terminal: true, errorCode: 'INTERNAL' });
    expect(classifyExportError('boom', 1)).toMatchObject({ terminal: true, errorCode: 'INTERNAL' });
  });
});
