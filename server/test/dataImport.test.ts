/**
 * Costra · Server · 导入二期 E2E（detect → commit → worker → 报告 → 清理 → sync-hold 钳制）
 *
 * 事实源：docs/design/data-import-export-client-analysis.md v1.0 §4/§5.2/§7.4/§7.5/§9
 *
 * 覆盖矩阵：
 *   D*   detect 端点（指纹/幂等/闸口/频控/文件级错误）
 *   C*   commit 端点（原子消费/幂等回放/过期/并发/频控/映射校验）
 *   W*   worker 执行（落库字段/余额同语句/映射与跳过/终态分类/23505 分流/隐私清理）
 *   H*   sync-hold 钳制（§5.2.6：H1 闸门关严 / H2 delta=0 也释放 / has_more 截断即 false）
 *   R*   报告下载端点
 *   CL*  会话周期清理
 *   CF*  classifyImportError 判定矩阵（单测直测）
 *   MS*  migration 0021 导入侧静态断言（pg-mem 无部分索引/CHECK 载体 ⇒ 断言生产 SQL）
 */

import { mkdtempSync, existsSync, readFileSync } from 'node:fs';
import { unlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { describe, it, expect, beforeEach, beforeAll } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../src/app.js';
import { getPool } from '../src/db/pool.js';
import { setWxFetchForTests } from '../src/wx/code2Session.js';
import {
  setImportStagingRootForTests,
  cleanupDetectSessions,
  runEntryImport,
  ImportClientRefConflictError,
} from '../src/services/entryImport.js';
import { classifyImportError, DATA_JOB_MAX_ATTEMPTS } from '../src/services/dataJobScheduler.js';
import { ImportArtifactError, ImportContextInvalidError, ImportSuccessWriteBackRace } from '../src/services/entryImport.js';
import * as importDetectRepo from '../src/repositories/importDetectRepo.js';
import * as ledgerRepo from '../src/repositories/ledgerRepo.js';
import type { DataJobEntity } from '../src/repositories/dataJobRepo.js';

let app: FastifyInstance;
let stagingRoot: string;

beforeAll(() => {
  stagingRoot = mkdtempSync(join(tmpdir(), 'costra-import-test-'));
  setImportStagingRootForTests(stagingRoot);
});

beforeEach(async () => {
  app = await buildApp({ disableLogger: true });
  await app.ready();
});

// ─── helpers ─────────────────────────────────────────────────────────────────

/** 直测 entryImport 函数的注入日志（生产由 buildApp 注入 app.log child · 测试静默） */
const noopLog = { info: () => undefined, warn: () => undefined, error: () => undefined };

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

async function login(openid: string): Promise<{ token: string; userId: string; ledgerId: string }> {
  mockCode2Session(openid);
  const res = await app.inject({ method: 'POST', url: '/v1/auth/wx-login', payload: { code: `c-${openid}` } });
  const body = res.json() as { access_token: string; user: { id: string }; default_ledger_id: string };
  return { token: body.access_token, userId: body.user.id, ledgerId: body.default_ledger_id };
}

function auth(token: string): Record<string, string> {
  return { authorization: `Bearer ${token}` };
}

/** 拼装 multipart/form-data 请求体（ledger_id 字段在 file 之前 · busboy 顺序解析） */
function multipartPayload(
  fileContent: string | Buffer,
  ledgerId: string,
  filename = 'import.csv',
): { payload: Buffer; headers: Record<string, string> } {
  const boundary = '----costra-import-test';
  const head =
    `--${boundary}\r\nContent-Disposition: form-data; name="ledger_id"\r\n\r\n${ledgerId}\r\n` +
    `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${filename}"\r\nContent-Type: text/csv\r\n\r\n`;
  const tail = `\r\n--${boundary}--\r\n`;
  return {
    payload: Buffer.concat([Buffer.from(head, 'utf8'), Buffer.from(fileContent), Buffer.from(tail, 'utf8')]),
    headers: { 'content-type': `multipart/form-data; boundary=${boundary}` },
  };
}

async function detect(token: string, csv: string | Buffer, ledgerId: string, filename = 'import.csv') {
  const { payload, headers } = multipartPayload(csv, ledgerId, filename);
  return app.inject({ method: 'POST', url: '/v1/import-jobs/detect', headers: { ...auth(token), ...headers }, payload });
}

async function commit(token: string, body: Record<string, unknown>) {
  return app.inject({
    method: 'POST',
    url: '/v1/import-jobs/commit',
    headers: { ...auth(token), 'content-type': 'application/json' },
    payload: body,
  });
}

/** 系统分类夹具（简化版：一级 + 默认子级） */
async function seedCategories(): Promise<{ food: string; takeout: string; salary: string; salarySub: string; transfer: string; transferSub: string }> {
  const pool = getPool();
  const mk = async (name: string, type: string, parentId: string | null, isParentDefault = false) => {
    const id = randomUUID();
    await pool.query(
      `INSERT INTO categories (id, family_id, name, type, icon, parent_id, is_parent_default) VALUES ($1, NULL, $2, $3, 'icon', $4, $5)`,
      [id, name, type, parentId, isParentDefault],
    );
    return id;
  };
  const food = await mk('餐饮', 'expense', null);
  const takeout = await mk('外卖', 'expense', food, true);
  const salary = await mk('职业收入', 'income', null);
  const salarySub = await mk('工资', 'income', salary, true);
  const transfer = await mk('账户互转', 'transfer', null);
  const transferSub = await mk('账户互转', 'transfer', transfer, true);
  return { food, takeout, salary, salarySub, transfer, transferSub };
}

interface SessionRow {
  id: string;
  status: string;
  user_id: string;
  family_id: string;
  ledger_id: string;
  job_id: string | null;
  member_mapping: Record<string, string> | null;
  artifact_path: string | null;
  report_path: string | null;
  report_preview: unknown;
  expires_at: Date | null;
  report_expires_at: Date | null;
  [k: string]: unknown;
}

async function getSessionRow(id: string): Promise<SessionRow> {
  const r = await getPool().query(`SELECT * FROM import_detect_sessions WHERE id = $1`, [id]);
  return r.rows[0] as SessionRow;
}

async function getJobRow(id: string): Promise<Record<string, unknown>> {
  const r = await getPool().query(`SELECT * FROM data_jobs WHERE id = $1`, [id]);
  return r.rows[0] as Record<string, unknown>;
}

async function entriesOf(ledgerId: string): Promise<Array<Record<string, unknown>>> {
  const r = await getPool().query(
    `SELECT * FROM entries WHERE ledger_id = $1 ORDER BY change_seq ASC`,
    [ledgerId],
  );
  return r.rows as Array<Record<string, unknown>>;
}

async function ledgerOf(ledgerId: string): Promise<Record<string, unknown>> {
  const r = await getPool().query(`SELECT * FROM ledgers WHERE id = $1`, [ledgerId]);
  return r.rows[0] as Record<string, unknown>;
}

async function familyIdOf(ledgerId: string): Promise<string> {
  const r = await getPool().query(`SELECT family_id FROM ledgers WHERE id = $1`, [ledgerId]);
  return (r.rows[0] as { family_id: string }).family_id;
}

/** 直造"已 claim"的导入任务实体（runEntryImport 直测用 · 绕开 claim 仪式） */
async function fabricateClaimedImportJob(input: {
  userId: string;
  ledgerId: string;
  detectId: string;
  sourceHash: string;
}): Promise<DataJobEntity> {
  const id = randomUUID();
  const runToken = randomUUID();
  const familyId = await familyIdOf(input.ledgerId);
  await getPool().query(
    `INSERT INTO data_jobs (id, type, status, user_id, family_id, ledger_id, detect_id, source_hash, ruleset_version,
                            attempts, stage, stage_started_at, run_token, lease_expires_at, started_at)
     VALUES ($1, 'import', 'processing', $2, $3, $4, $5, $6, 1,
             1, 'validating', now(), $7, now() + interval '90 seconds', now())`,
    [id, input.userId, familyId, input.ledgerId, input.detectId, input.sourceHash, runToken],
  );
  const r = await getPool().query(`SELECT * FROM data_jobs WHERE id = $1`, [id]);
  const row = r.rows[0] as Record<string, unknown>;
  return {
    id: row['id'] as string,
    type: 'import',
    status: 'processing',
    userId: row['user_id'] as string,
    familyId: row['family_id'] as string,
    ledgerId: row['ledger_id'] as string,
    detectId: row['detect_id'] as string,
    sourceHash: row['source_hash'] as string,
    rulesetVersion: 1,
    exportFrom: null,
    exportTo: null,
    attempts: 1,
    stage: 'validating',
    stageStartedAt: new Date(),
    runToken,
    leaseExpiresAt: new Date(Date.now() + 90_000),
    retryable: false,
    errorCode: null,
    errorMessage: null,
    nextAttemptAt: null,
    expiresAt: null,
    resultSummary: null,
    files: null,
    fileExpiresAt: null,
    createdAt: new Date(),
    startedAt: new Date(),
    finishedAt: null,
  };
}

/** 外部 CSV（别名表头 · 备注别名取方案 §3.1 表内的「商品」） */
const extCsv = (rows: string[]): string =>
  `交易日期,交易时间,交易类型,金额(元),分类,子分类,支付人,商品\n${rows.join('\n')}\n`;

/** 自产 CSV（标准 9 列 quote-all + CRLF + BOM） */
const COSTRA_HEADER = '"日期","时间","类型","金额","一级分类","二级分类","归属","记账人","备注"';
const costraCsv = (rows: string[][]): string =>
  '﻿' +
  [COSTRA_HEADER, ...rows.map((r) => r.map((f) => `"${f.replace(/"/g, '""')}"`).join(','))].join('\r\n') +
  '\r\n';

// ==============================================================================
// D · detect 端点
// ==============================================================================

describe('D · POST /v1/import-jobs/detect', () => {
  it('D1: 外部 CSV 正常检测 → 200 DetectReport 全字段 + 会话 ready + 产物落盘', async () => {
    const { token, ledgerId } = await login('u-d1');
    await seedCategories();
    const res = await detect(token, extCsv(['2026-06-10,14:30:00,支出,35.50,餐饮,外卖,,公司楼下']), ledgerId);
    expect(res.statusCode).toBe(200);
    const body = res.json() as Record<string, unknown>;
    expect(body['ledger_id']).toBe(ledgerId);
    expect(body['is_costra_export']).toBe(false);
    expect(body['formula_guard']).toBe('none');
    expect(body['total_rows']).toBe(1);
    expect(body['importable_rows']).toBe(1);
    expect(body['error_count']).toBe(0);
    expect(typeof body['detect_id']).toBe('string');
    // 相对路径不含 /v1（客户端 apiBaseUrl 已含 · 与导出 download_path 惯例一致）
    expect(body['report_path']).toBe(`/import-detect-sessions/${body['detect_id']}/report`);
    expect(typeof body['expires_at']).toBe('string');

    const session = await getSessionRow(body['detect_id'] as string);
    expect(session.status).toBe('ready');
    expect(session.artifact_path).not.toBeNull();
    expect(existsSync(session.artifact_path!)).toBe(true);
    // 无错误/警告 ⇒ 不生成报告文件
    expect(session.report_path).toBeNull();
  });

  it('D2: 自产 CSV（9 列 quote-all + BOM）⇒ 指纹命中 + 公式解码', async () => {
    const { token, ledgerId, userId } = await login('u-d2');
    await seedCategories();
    const nickname = (
      (await getPool().query(`SELECT nickname FROM users WHERE id = $1`, [userId])).rows[0] as { nickname: string }
    ).nickname;
    const csv = costraCsv([
      ['2026-06-10', '14:30', '支出', '35.50', '餐饮', '外卖', '个人', nickname, "''=cmd"],
    ]);
    const res = await detect(token, csv, ledgerId);
    expect(res.statusCode).toBe(200);
    const body = res.json() as Record<string, unknown>;
    expect(body['is_costra_export']).toBe(true);
    expect(body['formula_guard']).toBe('apostrophe-v2');
    expect(body['importable_rows']).toBe(1);
  });

  it('D3: 同文件重复上传 ⇒ 幂等复用同一会话（detect_id 不变）', async () => {
    const { token, ledgerId } = await login('u-d3');
    await seedCategories();
    const csv = extCsv(['2026-06-10,14:30:00,支出,35.50,餐饮,,,']);
    const r1 = await detect(token, csv, ledgerId);
    const r2 = await detect(token, csv, ledgerId);
    expect(r1.statusCode).toBe(200);
    expect(r2.statusCode).toBe(200);
    expect((r2.json() as { detect_id: string }).detect_id).toBe((r1.json() as { detect_id: string }).detect_id);
  });

  it('D4: 缺 file / 缺 ledger_id ⇒ 400', async () => {
    const { token, ledgerId } = await login('u-d4');
    const boundary = '----costra-import-test';
    const noFile = Buffer.from(
      `--${boundary}\r\nContent-Disposition: form-data; name="ledger_id"\r\n\r\n${ledgerId}\r\n--${boundary}--\r\n`,
    );
    const r1 = await app.inject({
      method: 'POST',
      url: '/v1/import-jobs/detect',
      headers: { ...auth(token), 'content-type': `multipart/form-data; boundary=${boundary}` },
      payload: noFile,
    });
    expect(r1.statusCode).toBe(400);

    const { payload } = multipartPayload('a,b\n1,2\n', ledgerId);
    // 把 ledger_id 字段从请求体里剥掉
    const text = payload.toString();
    const stripped = text.replace(/(.*name="ledger_id"\r\n\r\n)[^\r]+\r\n/s, '$1\r\n');
    const r2 = await app.inject({
      method: 'POST',
      url: '/v1/import-jobs/detect',
      headers: { ...auth(token), 'content-type': 'multipart/form-data; boundary=----costra-import-test' },
      payload: Buffer.from(stripped),
    });
    expect(r2.statusCode).toBe(400);
  });

  it('D5: 账本不存在 404 / 他人账本 403 FAMILY_NOT_MEMBER', async () => {
    const mine = await login('u-d5a');
    const other = await login('u-d5b');
    await seedCategories();
    const csv = extCsv(['2026-06-10,14:30:00,支出,1,餐饮,,,']);
    const r404 = await detect(mine.token, csv, randomUUID());
    expect(r404.statusCode).toBe(404);
    const r403 = await detect(mine.token, csv, other.ledgerId);
    expect(r403.statusCode).toBe(403);
    expect((r403.json() as { code: string }).code).toBe('FAMILY_NOT_MEMBER');
  });

  it('D6: 文件超 1MB ⇒ 413 PAYLOAD_TOO_LARGE', async () => {
    const { token, ledgerId } = await login('u-d6');
    const big = Buffer.alloc(1024 * 1024 + 1, 0x61); // 1MB+1 的 'a'
    const res = await detect(token, big, ledgerId);
    expect(res.statusCode).toBe(413);
    expect((res.json() as { code: string }).code).toBe('PAYLOAD_TOO_LARGE');
  });

  it('D7: XLSX 魔数 ⇒ 400 + 会话 failed', async () => {
    const { token, ledgerId } = await login('u-d7');
    const xlsx = Buffer.concat([Buffer.from('PK\x03\x04', 'binary'), Buffer.alloc(100, 0)]);
    const res = await detect(token, xlsx, ledgerId, 'book.xlsx');
    expect(res.statusCode).toBe(400);
    expect((res.json() as { message: string }).message).toContain('Excel');
    const sessions = (await getPool().query(`SELECT status FROM import_detect_sessions`)).rows as Array<{ status: string }>;
    expect(sessions).toHaveLength(1);
    expect(sessions[0]!.status).toBe('failed');
  });

  it('D8: 非法 CSV（引号未闭合）⇒ 400 + 会话 failed', async () => {
    const { token, ledgerId } = await login('u-d8');
    const res = await detect(token, 'a,b\n"broken,1\n', ledgerId);
    expect(res.statusCode).toBe(400);
    const sessions = (await getPool().query(`SELECT status FROM import_detect_sessions`)).rows as Array<{ status: string }>;
    expect(sessions[0]!.status).toBe('failed');
  });

  it('D9: 缺必填列 ⇒ 400 指向缺失列名', async () => {
    const { token, ledgerId } = await login('u-d9');
    const res = await detect(token, '日期,类型,分类\n2026-06-10,支出,餐饮\n', ledgerId);
    expect(res.statusCode).toBe(400);
    expect((res.json() as { message: string }).message).toContain('金额');
  });

  it('D10: detect 频控：5 分钟内第 6 次 ⇒ 429 RATE_LIMITED + Retry-After', async () => {
    const { token, ledgerId } = await login('u-d10');
    await seedCategories();
    for (let i = 0; i < 5; i++) {
      const csv = extCsv([`2026-06-1${i},14:30:00,支出,${i + 1},餐饮,,,`]);
      const r = await detect(token, csv, ledgerId);
      expect(r.statusCode).toBe(200);
    }
    const r6 = await detect(token, extCsv(['2026-06-19,14:30:00,支出,9,餐饮,,,']), ledgerId);
    expect(r6.statusCode).toBe(429);
    expect((r6.json() as { code: string }).code).toBe('RATE_LIMITED');
    expect(r6.headers['retry-after']).toBeDefined();
  });

  it('D11: 账本已有活跃导入任务 ⇒ 409 IMPORT_JOB_IN_PROGRESS', async () => {
    const { token, userId, ledgerId } = await login('u-d11');
    await seedCategories();
    const familyId = await familyIdOf(ledgerId);
    await getPool().query(
      `INSERT INTO data_jobs (id, type, status, user_id, family_id, ledger_id, detect_id, source_hash)
       VALUES ($1, 'import', 'processing', $2, $3, $4, $5, 'sha')`,
      [randomUUID(), userId, familyId, ledgerId, randomUUID()],
    );
    const res = await detect(token, extCsv(['2026-06-10,14:30:00,支出,1,餐饮,,,']), ledgerId);
    expect(res.statusCode).toBe(409);
    expect((res.json() as { code: string }).code).toBe('IMPORT_JOB_IN_PROGRESS');
  });

  it('D12: 已有进行中检测 ⇒ 409 DETECT_IN_PROGRESS；僵尸会话（>10min）自愈放行', async () => {
    const { token, userId, ledgerId } = await login('u-d12');
    await seedCategories();
    const familyId = await familyIdOf(ledgerId);
    const csv = extCsv(['2026-06-10,14:30:00,支出,1,餐饮,,,']);

    // 新鲜 detecting → 409
    await getPool().query(
      `INSERT INTO import_detect_sessions (id, user_id, family_id, ledger_id, status) VALUES ($1, $2, $3, $4, 'detecting')`,
      [randomUUID(), userId, familyId, ledgerId],
    );
    const r409 = await detect(token, csv, ledgerId);
    expect(r409.statusCode).toBe(409);
    expect((r409.json() as { code: string }).code).toBe('DETECT_IN_PROGRESS');

    // 僵尸 detecting（20min 前）→ 即查即收（转 failed）+ 放行
    await getPool().query(`DELETE FROM import_detect_sessions`);
    await getPool().query(
      `INSERT INTO import_detect_sessions (id, user_id, family_id, ledger_id, status, created_at)
       VALUES ($1, $2, $3, $4, 'detecting', now() - interval '20 minutes')`,
      [randomUUID(), userId, familyId, ledgerId],
    );
    const r200 = await detect(token, csv, ledgerId);
    expect(r200.statusCode).toBe(200);
    const statuses = (await getPool().query(`SELECT DISTINCT status FROM import_detect_sessions ORDER BY 1`)).rows as Array<{ status: string }>;
    expect(statuses.map((s) => s.status).sort()).toEqual(['failed', 'ready']);
  });

  it('D13: 排队幽灵导入（queued 且租约过期）在 detect 路径即查即收，不挡检测', async () => {
    const { token, userId, ledgerId } = await login('u-d13');
    await seedCategories();
    const familyId = await familyIdOf(ledgerId);
    const ghostId = randomUUID();
    await getPool().query(
      `INSERT INTO data_jobs (id, type, status, user_id, family_id, ledger_id, detect_id, source_hash, expires_at)
       VALUES ($1, 'import', 'queued', $2, $3, $4, $5, 'sha', now() - interval '1 minute')`,
      [ghostId, userId, familyId, ledgerId, randomUUID()],
    );
    // 幽灵不挡 detect（否则会话建不出、commit 也走不到 ⇒ 死锁至 worker 恢复）
    const res = await detect(token, extCsv(['2026-06-10,14:30:00,支出,1,餐饮,,,']), ledgerId);
    expect(res.statusCode).toBe(200);
    const ghost = (await getPool().query(`SELECT status, error_code FROM data_jobs WHERE id = $1`, [ghostId])).rows[0] as { status: string; error_code: string };
    expect(ghost.status).toBe('failed');
    expect(ghost.error_code).toBe('QUEUE_LEASE_EXPIRED');
  });

  it('D14: 非 .csv 后缀 ⇒ 400 INVALID_ARGUMENT（§9.1 后缀白名单 · 服务端归一比对）', async () => {
    const { token, ledgerId } = await login('u-d14');
    await seedCategories();
    const res = await detect(token, extCsv(['2026-06-10,14:30:00,支出,1,餐饮,,,']), ledgerId, 'import.txt');
    expect(res.statusCode).toBe(400);
    expect((res.json() as { code: string }).code).toBe('INVALID_ARGUMENT');
    // 大小写不敏感：.CSV 放行
    const res2 = await detect(token, extCsv(['2026-06-11,14:30:00,支出,2,餐饮,,,']), ledgerId, 'IMPORT.CSV');
    expect(res2.statusCode).toBe(200);
  });
});

// ==============================================================================
// C · commit 端点
// ==============================================================================

describe('C · POST /v1/import-jobs/commit', () => {
  /** 完成一次 detect 并返回 detect_id */
  async function detectReady(token: string, ledgerId: string, csv?: string): Promise<string> {
    const res = await detect(token, csv ?? extCsv(['2026-06-10,14:30:00,支出,35.50,餐饮,外卖,,']), ledgerId);
    expect(res.statusCode).toBe(200);
    return (res.json() as { detect_id: string }).detect_id;
  }

  it('C1: 正常 commit → 202 + 会话 consumed（job_id 回填）+ 任务 queued 且携带溯源链', async () => {
    const { token, ledgerId } = await login('u-c1');
    await seedCategories();
    const detectId = await detectReady(token, ledgerId);
    const res = await commit(token, { detect_id: detectId });
    expect(res.statusCode).toBe(202);
    const body = res.json() as { job_id: string; status: string };
    expect(body.status).toBe('queued');

    const session = await getSessionRow(detectId);
    expect(session.status).toBe('consumed');
    expect(session.job_id).toBe(body.job_id);
    expect(session.consumed_at).not.toBeNull();

    const job = await getJobRow(body.job_id);
    expect(job['type']).toBe('import');
    expect(job['detect_id']).toBe(detectId);
    expect(typeof job['source_hash']).toBe('string');
    expect(job['ruleset_version']).toBe(1);
    expect(job['expires_at']).not.toBeNull(); // 队列租约 10min
  });

  it('C2: 重复 commit 幂等回放原 job_id（不建双任务）', async () => {
    const { token, ledgerId } = await login('u-c2');
    await seedCategories();
    const detectId = await detectReady(token, ledgerId);
    const r1 = await commit(token, { detect_id: detectId });
    const r2 = await commit(token, { detect_id: detectId });
    expect(r1.statusCode).toBe(202);
    expect(r2.statusCode).toBe(202);
    expect((r2.json() as { job_id: string }).job_id).toBe((r1.json() as { job_id: string }).job_id);
    const jobs = (await getPool().query(`SELECT COUNT(*) AS n FROM data_jobs`)).rows[0] as { n: number };
    expect(Number(jobs.n)).toBe(1);
  });

  it('C3: 会话过 15 分钟有效期 ⇒ 410 DETECT_SESSION_EXPIRED', async () => {
    const { token, ledgerId } = await login('u-c3');
    await seedCategories();
    const detectId = await detectReady(token, ledgerId);
    await getPool().query(
      `UPDATE import_detect_sessions SET expires_at = now() - interval '1 second' WHERE id = $1`,
      [detectId],
    );
    const res = await commit(token, { detect_id: detectId });
    expect(res.statusCode).toBe(410);
    expect((res.json() as { code: string }).code).toBe('DETECT_SESSION_EXPIRED');
  });

  it('C4: failed 会话 ⇒ 410；不存在/他人会话 ⇒ 404', async () => {
    const mine = await login('u-c4a');
    const other = await login('u-c4b');
    await seedCategories();
    const detectId = await detectReady(mine.token, mine.ledgerId);
    await importDetectRepo.markFailed(detectId);
    const r410 = await commit(mine.token, { detect_id: detectId });
    expect(r410.statusCode).toBe(410);
    expect((r410.json() as { code: string }).code).toBe('DETECT_SESSION_EXPIRED');

    const r404a = await commit(mine.token, { detect_id: randomUUID() });
    expect(r404a.statusCode).toBe(404);
    // 他人会话（重新 detect 一个）
    const detectId2 = await detectReady(other.token, other.ledgerId);
    const r404b = await commit(mine.token, { detect_id: detectId2 });
    expect(r404b.statusCode).toBe(404);
  });

  it('C5: 该账本已有活跃导入任务 ⇒ 409 IMPORT_JOB_IN_PROGRESS', async () => {
    const { token, userId, ledgerId } = await login('u-c5');
    await seedCategories();
    const detectId = await detectReady(token, ledgerId);
    const familyId = await familyIdOf(ledgerId);
    await getPool().query(
      `INSERT INTO data_jobs (id, type, status, user_id, family_id, ledger_id, detect_id, source_hash)
       VALUES ($1, 'import', 'queued', $2, $3, $4, $5, 'sha')`,
      [randomUUID(), userId, familyId, ledgerId, randomUUID()],
    );
    const res = await commit(token, { detect_id: detectId });
    expect(res.statusCode).toBe(409);
    expect((res.json() as { code: string }).code).toBe('IMPORT_JOB_IN_PROGRESS');
  });

  it('C6: commit 频控：5 分钟内第 4 个导入任务 ⇒ 429', async () => {
    const { token, ledgerId } = await login('u-c6');
    await seedCategories();
    // 同账本单一活跃导入闸口（§4.4）叠加频控：每个任务须先跑完（succeeded 不占闸口）
    // 才能发起下一个 —— 这正是"5 分钟 3 个"频控在真实场景的叠加形态
    for (let i = 0; i < 3; i++) {
      const detectId = await detectReady(token, ledgerId, extCsv([`2026-06-1${i},14:30:00,支出,${i + 1}.00,餐饮,,,`]));
      const r = await commit(token, { detect_id: detectId });
      expect(r.statusCode).toBe(202);
      await app.dataJobScheduler!.tickOnce(); // 跑完释放活跃闸口
    }
    const detectId4 = await detectReady(token, ledgerId, extCsv(['2026-06-19,14:30:00,支出,9.00,餐饮,,,']));
    const r4 = await commit(token, { detect_id: detectId4 });
    expect(r4.statusCode).toBe(429);
    expect((r4.json() as { code: string }).code).toBe('RATE_LIMITED');
    // 频控先于会话消费：会话仍 ready 可复用
    const s4 = await getSessionRow(detectId4);
    expect(s4.status).toBe('ready');
  });

  it('C7: member_mapping 值非法 ⇒ 400；__self__ 与 UUID 合法', async () => {
    const { token, userId, ledgerId } = await login('u-c7');
    await seedCategories();
    const d1 = await detectReady(token, ledgerId);
    const bad = await commit(token, { detect_id: d1, member_mapping: { 老王: 'not-a-uuid' } });
    expect(bad.statusCode).toBe(400);

    const d2 = await detectReady(token, ledgerId, extCsv(['2026-06-11,14:30:00,支出,1,餐饮,,,']));
    const good = await commit(token, { detect_id: d2, member_mapping: { 老王: '__self__', 小孙: userId } });
    expect(good.statusCode).toBe(202);
  });

  it('C8: 全部行 ERROR（无可导入行且无待映射）⇒ 400', async () => {
    const { token, ledgerId } = await login('u-c8');
    await seedCategories();
    const detectId = await detectReady(token, ledgerId, extCsv(['2026-02-30,14:30:00,支出,1,餐饮,,,']));
    const res = await commit(token, { detect_id: detectId });
    expect(res.statusCode).toBe(400);
    expect((res.json() as { code: string }).code).toBe('INVALID_ARGUMENT');
  });

  it('C9: member_mapping 目标非本家庭活跃成员 ⇒ 400 且会话仍 ready（§4.2 同步校验 · v1.3）', async () => {
    const mine = await login('u-c9a');
    const outsider = await login('u-c9b');
    await seedCategories();
    const detectId = await detectReady(mine.token, mine.ledgerId);
    const res = await commit(mine.token, {
      detect_id: detectId,
      member_mapping: { 老王: outsider.userId },
    });
    expect(res.statusCode).toBe(400);
    expect((res.json() as { code: string }).code).toBe('INVALID_ARGUMENT');
    // 会话未被消费 ⇒ 用户可就地改映射重试，无需重新上传文件
    // （若推迟到 worker 复核，会话已 consumed 且任务终态 CONTEXT_INVALIDATED）
    expect((await getSessionRow(detectId)).status).toBe('ready');
    const jobs = (await getPool().query(`SELECT COUNT(*) AS n FROM data_jobs`)).rows[0] as { n: number };
    expect(Number(jobs.n)).toBe(0);
  });
});

// ==============================================================================
// W · worker 执行（detect → commit → tickOnce 全链路）
// ==============================================================================

describe('W · 导入 worker（大事务原子性 · §7.5）', () => {
  async function detectAndCommit(
    token: string,
    ledgerId: string,
    csv: string,
    memberMapping?: Record<string, string>,
  ): Promise<{ detectId: string; jobId: string }> {
    const d = await detect(token, csv, ledgerId);
    expect(d.statusCode).toBe(200);
    const detectId = (d.json() as { detect_id: string }).detect_id;
    const c = await commit(token, { detect_id: detectId, ...(memberMapping ? { member_mapping: memberMapping } : {}) });
    expect(c.statusCode).toBe(202);
    return { detectId, jobId: (c.json() as { job_id: string }).job_id };
  }

  it('W1: 全类型行落库 + 余额同语句 + hold 清除 + 预览置 NULL + 行产物删除 + 报告保留', async () => {
    const { token, ledgerId } = await login('u-w1');
    await seedCategories();
    const csv = extCsv([
      '2026-06-01,10:00:00,支出,20.00,餐饮,外卖,,早餐',
      '2026-06-02,11:00:00,支出,10.00,餐饮,,,',
      '2026-06-03,12:00:00,收入,100.00,职业收入,工资,,',
      '2026-06-04,13:00:00,转账,50.00,账户互转,账户互转,,',
    ]);
    const { detectId, jobId } = await detectAndCommit(token, ledgerId, csv);

    await app.dataJobScheduler!.tickOnce();

    const job = await getJobRow(jobId);
    expect(job['status']).toBe('succeeded');
    expect(job['stage']).toBeNull();
    const summary = job['result_summary'] as Record<string, number>;
    expect(summary).toMatchObject({ imported: 4, skipped: 0, error_count: 0 });

    const rows = await entriesOf(ledgerId);
    expect(rows).toHaveLength(4);
    expect(rows.map((r) => r['type'])).toEqual(['expense', 'expense', 'income', 'transfer']);
    expect(Number(rows[0]!['amount'])).toBe(2000);
    expect(rows[0]!['client_ref_id']).toBe(`import:${detectId}:1`);
    expect(rows[0]!['note']).toBe('早餐');
    // 个人账本：归属强制 personal
    expect(rows[0]!['shared_type']).toBe('personal');
    expect(rows[2]!['shared_type']).toBeNull();
    // 缺子分类 ⇒ 默认子分类（外卖/工资/账户互转）
    expect(rows[1]!['category_id']).toBe(rows[0]!['category_id']);
    // change_seq 已分配且递增
    expect(Number(rows[1]!['change_seq'])).toBeGreaterThan(Number(rows[0]!['change_seq']));

    // 余额 = 100 - 20 - 10 = 70（transfer 不动）
    const ledger = await ledgerOf(ledgerId);
    expect(Number(ledger['balance_cents'])).toBe(7000);
    // hold 已清除（H2 同事务）
    expect(ledger['sync_hold_seq']).toBeNull();
    expect(ledger['sync_hold_until']).toBeNull();

    // 隐私与产物（§7.4 v0.9）：预览置 NULL · 行产物删除 · 报告保留
    const session = await getSessionRow(detectId);
    expect(session.report_preview).toBeNull();
    expect(session.artifact_path).not.toBeNull(); // 路径仍在（审计），文件已删
    expect(existsSync(session.artifact_path!)).toBe(false);
  });

  it('W2: 自产文件未匹配昵称 → member_mapping __self__ 命中入库，未映射昵称跳过', async () => {
    const { token, ledgerId, userId } = await login('u-w2');
    await seedCategories();
    const csv = costraCsv([
      ['2026-06-01', '10:00', '支出', '20.00', '餐饮', '外卖', '个人', '老王', ''],
      ['2026-06-02', '10:00', '支出', '10.00', '餐饮', '外卖', '个人', '小孙', ''],
    ]);
    const d = await detect(token, csv, ledgerId);
    const db = d.json() as {
      detect_id: string;
      importable_rows: number;
      error_count: number;
      warning_count: number;
      unmatched_members: Array<{ nickname: string; row_count: number }>;
    };
    expect(db.importable_rows).toBe(0); // 两行都待映射
    expect(db.error_count).toBe(2); // 自产文件未匹配记账人 ⇒ 每行一条 MEMBER_UNMATCHED ERROR
    expect(db.unmatched_members).toEqual([
      { nickname: '小孙', row_count: 1 },
      { nickname: '老王', row_count: 1 },
    ].sort((a, b) => b.row_count - a.row_count || a.nickname.localeCompare(b.nickname, 'zh')));

    const c = await commit(token, { detect_id: db.detect_id, member_mapping: { 老王: '__self__' } });
    expect(c.statusCode).toBe(202);
    await app.dataJobScheduler!.tickOnce();

    const rows = await entriesOf(ledgerId);
    expect(rows).toHaveLength(1);
    expect(rows[0]!['created_by']).toBe(userId);
    expect(Number(rows[0]!['amount'])).toBe(2000);

    const job = await getJobRow((c.json() as { job_id: string }).job_id);
    expect(job['status']).toBe('succeeded');
    const summary = job['result_summary'] as Record<string, number>;
    expect(summary['imported']).toBe(1);
    expect(summary['skipped']).toBe(1);
    // §3.3「映射后转为 WARNING」（v1.3）：被映射消费的那条 MEMBER_UNMATCHED 不再计作 error，
    // 否则已成功导入的行仍挂在 error_count 上，摘要与实际结果自相矛盾
    expect(summary['error_count']).toBe(db.error_count - 1);
    expect(summary['warning_count']).toBe(db.warning_count + 1);
  });

  it('W3: detect 后分类被软删 ⇒ 终态 CONTEXT_INVALIDATED（不可重试）+ hold 已清', async () => {
    const { token, ledgerId } = await login('u-w3');
    const cats = await seedCategories();
    const { jobId } = await detectAndCommit(token, ledgerId, extCsv(['2026-06-01,10:00:00,支出,20.00,餐饮,外卖,,']));
    // detect 完成后软删分类（产物里已是 category_id）
    await getPool().query(`UPDATE categories SET deleted_at = now() WHERE id = $1`, [cats.takeout]);

    await app.dataJobScheduler!.tickOnce();
    const job = await getJobRow(jobId);
    expect(job['status']).toBe('failed');
    expect(job['error_code']).toBe('CONTEXT_INVALIDATED');
    expect(job['retryable']).toBe(false);

    const ledger = await ledgerOf(ledgerId);
    expect(ledger['sync_hold_seq']).toBeNull();
    expect(await entriesOf(ledgerId)).toHaveLength(0);
  });

  it('W4: 产物文件丢失 ⇒ 终态 ARTIFACT_MISSING', async () => {
    const { token, ledgerId } = await login('u-w4');
    await seedCategories();
    const { jobId, detectId } = await detectAndCommit(token, ledgerId, extCsv(['2026-06-01,10:00:00,支出,20.00,餐饮,外卖,,']));
    const session = await getSessionRow(detectId);
    await unlink(session.artifact_path!);

    await app.dataJobScheduler!.tickOnce();
    const job = await getJobRow(jobId);
    expect(job['status']).toBe('failed');
    expect(job['error_code']).toBe('ARTIFACT_MISSING');
    expect(job['retryable']).toBe(false);
  });

  it('W5: client_ref_id 预占 ⇒ 调度层重读 status 未成功 ⇒ TRANSIENT_DB 回队（§7.5 R38）', async () => {
    const { token, userId, ledgerId } = await login('u-w5');
    const cats = await seedCategories();
    const { jobId, detectId } = await detectAndCommit(token, ledgerId, extCsv(['2026-06-01,10:00:00,支出,20.00,餐饮,外卖,,']));

    // 预占 client_ref_id（模拟上一次执行已提交但 worker 未感知）
    await getPool().query(
      `INSERT INTO entries (id, ledger_id, amount, currency, type, category_id, occurred_at, created_by, client_ref_id)
       VALUES ($1, $2, 2000, 'CNY', 'expense', $3, '2026-06-01T02:00:00Z', $4, $5)`,
      [randomUUID(), ledgerId, cats.takeout, userId, `import:${detectId}:1`],
    );

    await app.dataJobScheduler!.tickOnce();
    const job = await getJobRow(jobId);
    expect(job['status']).toBe('queued'); // 回队重试
    expect(job['error_code']).toBe('TRANSIENT_DB');
    expect(job['attempts']).toBe(1); // 回队不递增（claim 时才递增）

    // 清除冲突后重试成功（幂等：同一 detect 产物重放，不产生重复行）
    await getPool().query(`DELETE FROM entries WHERE client_ref_id = $1`, [`import:${detectId}:1`]);
    await getPool().query(`UPDATE data_jobs SET next_attempt_at = NULL WHERE id = $1`, [jobId]);
    await app.dataJobScheduler!.tickOnce();
    const job2 = await getJobRow(jobId);
    expect(job2['status']).toBe('succeeded');
    expect(await entriesOf(ledgerId)).toHaveLength(1);
  });

  it('W6: runEntryImport 直测 —— 会话非 consumed 状态 ⇒ ImportContextInvalidError', async () => {
    const { token, userId, ledgerId } = await login('u-w6');
    await seedCategories();
    const d = await detect(token, extCsv(['2026-06-01,10:00:00,支出,20.00,餐饮,外卖,,']), ledgerId);
    const detectId = (d.json() as { detect_id: string }).detect_id;
    // 不 commit（会话仍 ready）直接造任务执行
    const job = await fabricateClaimedImportJob({ userId, ledgerId, detectId, sourceHash: 'sha' });
    const holdRef = { seq: null as number | null };
    await expect(runEntryImport(job, holdRef, noopLog)).rejects.toBeInstanceOf(ImportContextInvalidError);
    expect(holdRef.seq).toBeNull(); // hold 未设置
  });

  it('W7: runEntryImport 直测 —— client_ref 预占 ⇒ ImportClientRefConflictError（确定性预检）', async () => {
    const { token, userId, ledgerId } = await login('u-w7');
    const cats = await seedCategories();
    const d = await detect(token, extCsv(['2026-06-01,10:00:00,支出,20.00,餐饮,外卖,,']), ledgerId);
    const detectId = (d.json() as { detect_id: string }).detect_id;
    const c = await commit(token, { detect_id: detectId });
    const jobId = (c.json() as { job_id: string }).job_id;
    await getPool().query(`UPDATE data_jobs SET run_token = $2 WHERE id = $1`, [jobId, randomUUID()]);
    const jobRow = await getJobRow(jobId);
    const job = await fabricateClaimedImportJob({ userId, ledgerId, detectId, sourceHash: 'sha' });
    // 用真实 job id/runToken 替换直造实体
    job.id = jobId;
    job.runToken = jobRow['run_token'] as string;

    await getPool().query(
      `INSERT INTO entries (id, ledger_id, amount, currency, type, category_id, occurred_at, created_by, client_ref_id)
       VALUES ($1, $2, 2000, 'CNY', 'expense', $3, '2026-06-01T02:00:00Z', $4, $5)`,
      [randomUUID(), ledgerId, cats.takeout, userId, `import:${detectId}:1`],
    );

    const holdRef = { seq: null as number | null };
    await expect(runEntryImport(job, holdRef, noopLog)).rejects.toBeInstanceOf(ImportClientRefConflictError);
    // 失败路径 hold 未清（调度层职责）；这里验证 hold 被设置过
    expect(holdRef.seq).not.toBeNull();
    // 清理（避免影响同用例后续断言）
    await ledgerRepo.clearSyncHold(ledgerId, holdRef.seq);
  });
});

// ==============================================================================
// H · sync-hold 钳制（§5.2.6 验收用例）
// ==============================================================================

describe('H · sync-pull 导入钳制（§5.2.4 E2b）', () => {
  async function pull(token: string, familyId: string, since: number) {
    const res = await app.inject({
      method: 'GET',
      url: `/v1/sync/pull?family_id=${familyId}&since=${since}`,
      headers: auth(token),
    });
    expect(res.statusCode).toBe(200);
    return res.json() as {
      watermark: number;
      has_more: boolean;
      changes: { entries: Array<{ change_seq: number }> };
    };
  }

  it('H1: hold 期间拉取只见 <= 闸门的行；hold 解除后新行可见（闸门关严 off-by-one）', async () => {
    const { token, userId, ledgerId } = await login('u-h1');
    const familyId = await familyIdOf(ledgerId);
    const pool = getPool();
    const mk = async (note: string) => {
      await pool.query(
        `INSERT INTO entries (id, ledger_id, amount, currency, type, occurred_at, created_by, note)
         VALUES ($1, $2, 100, 'CNY', 'expense', '2026-06-01T02:00:00Z', $3, $4)`,
        [randomUUID(), ledgerId, userId, note],
      );
    };
    await mk('a');
    await mk('b');
    const beforeHold = await pull(token, familyId, 0);
    expect(beforeHold.changes.entries).toHaveLength(2);
    const maxSeq = Math.max(...beforeHold.changes.entries.map((e) => e.change_seq));

    // 设置 hold（闸门 > 当前所有已分配号）
    const holdSeq = await ledgerRepo.setSyncHold(ledgerId);
    expect(holdSeq).not.toBeNull();
    expect(holdSeq!).toBeGreaterThan(maxSeq);

    // hold 期间新写入一行（取号 > 闸门）
    await mk('c');

    // 拉取：只见 a/b，has_more=false（截断即 false · 客户端本轮收敛）
    const during = await pull(token, familyId, 0);
    expect(during.changes.entries).toHaveLength(2);
    expect(during.has_more).toBe(false);
    expect(during.watermark).toBeLessThanOrEqual(holdSeq!);

    // 增量拉取（watermark 已是 maxSeq）也不漏
    const duringIncr = await pull(token, familyId, maxSeq);
    expect(duringIncr.changes.entries).toHaveLength(0);

    // 解除 hold → 全量可见
    await ledgerRepo.clearSyncHold(ledgerId);
    const after = await pull(token, familyId, maxSeq);
    expect(after.changes.entries).toHaveLength(1);
  });

  it('H2: releaseHoldAndApplyDelta 在 delta=0 时也执行（全 transfer 导入不白停 120s）', async () => {
    const { ledgerId } = await login('u-h2');
    const beforeRow = await ledgerOf(ledgerId);
    const before = Number(beforeRow['balance_version']);
    const beforeEpoch = Number(beforeRow['sync_epoch']);
    const holdSeq = await ledgerRepo.setSyncHold(ledgerId);
    expect(holdSeq).not.toBeNull();
    const pool = getPool();
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const ok = await ledgerRepo.releaseHoldAndApplyDelta({ ledgerId, delta: 0 }, client);
      expect(ok).toBe(true);
      await client.query('COMMIT');
    } finally {
      client.release();
    }
    const ledger = await ledgerOf(ledgerId);
    expect(ledger['sync_hold_seq']).toBeNull();
    expect(ledger['sync_hold_until']).toBeNull();
    expect(Number(ledger['balance_version'])).toBe(before + 1); // 版本推进（业务动作语义 · delta=0 也执行）
    // §5.2.5：导入路径用 sync-hold 而非 epoch——sync_epoch 不得被导入推进
    expect(Number(ledger['sync_epoch'])).toBe(beforeEpoch);
  });

  it('H3: hold 过期后不再钳制（hold_until 自愈兜底）', async () => {
    const { token, userId, ledgerId } = await login('u-h3');
    const familyId = await familyIdOf(ledgerId);
    await ledgerRepo.setSyncHold(ledgerId);
    await getPool().query(
      `UPDATE ledgers SET sync_hold_until = now() - interval '1 second' WHERE id = $1`,
      [ledgerId],
    );
    await getPool().query(
      `INSERT INTO entries (id, ledger_id, amount, currency, type, occurred_at, created_by)
       VALUES ($1, $2, 100, 'CNY', 'expense', '2026-06-01T02:00:00Z', $3)`,
      [randomUUID(), ledgerId, userId],
    );
    const res = await pull(token, familyId, 0);
    expect(res.changes.entries).toHaveLength(1);
  });

  it('H4: 失败路径条件清除只认本执行体闸门（防误杀新一轮 hold）', async () => {
    const { ledgerId } = await login('u-h4');
    const seq1 = await ledgerRepo.setSyncHold(ledgerId);
    // 模拟新一轮执行覆盖了 hold（不同闸门值）
    const seq2 = await ledgerRepo.setSyncHold(ledgerId);
    expect(seq2).not.toBe(seq1);
    // 旧执行体的条件清除不得命中新闸门
    await ledgerRepo.clearSyncHold(ledgerId, seq1);
    let ledger = await ledgerOf(ledgerId);
    expect(Number(ledger['sync_hold_seq'])).toBe(seq2);
    // 新执行体的条件清除命中
    await ledgerRepo.clearSyncHold(ledgerId, seq2);
    ledger = await ledgerOf(ledgerId);
    expect(ledger['sync_hold_seq']).toBeNull();
  });
});

// ==============================================================================
// R · 报告下载
// ==============================================================================

describe('R · GET /v1/import-detect-sessions/:id/report', () => {
  it('R1: 有问题的检测 → 200 CSV（BOM + 逻辑序号 + 物理行号 + 层级 + 错误码）', async () => {
    const { token, ledgerId } = await login('u-r1');
    await seedCategories();
    const csv = extCsv(['2026-02-30,14:30:00,支出,1,餐饮,,,', '2026-06-10,14:30:00,支出,2,餐饮,,,']);
    const d = await detect(token, csv, ledgerId);
    const detectId = (d.json() as { detect_id: string }).detect_id;
    const res = await app.inject({
      method: 'GET',
      url: `/v1/import-detect-sessions/${detectId}/report`,
      headers: auth(token),
    });
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toContain('text/csv');
    expect(res.headers['content-disposition']).toContain('Costra_');
    const text = res.body;
    expect(text.charCodeAt(0)).toBe(0xfeff); // BOM
    expect(text).toContain('逻辑序号');
    expect(text).toContain('DATE_INVALID');
    expect(text).toContain('ERROR');
  });

  it('R2: 无错误/警告 ⇒ 404；他人会话 ⇒ 404；报告过期 ⇒ 404（不借用会话过期码 · v1.3）', async () => {
    const mine = await login('u-r2a');
    const other = await login('u-r2b');
    await seedCategories();

    // 无问题
    const clean = await detect(mine.token, extCsv(['2026-06-10,14:30:00,支出,1,餐饮,,,']), mine.ledgerId);
    const cleanId = (clean.json() as { detect_id: string }).detect_id;
    const r404a = await app.inject({
      method: 'GET',
      url: `/v1/import-detect-sessions/${cleanId}/report`,
      headers: auth(mine.token),
    });
    expect(r404a.statusCode).toBe(404);

    // 有问题
    const bad = await detect(mine.token, extCsv(['2026-02-30,14:30:00,支出,1,餐饮,,,']), mine.ledgerId);
    const badId = (bad.json() as { detect_id: string }).detect_id;
    // 他人
    const r404b = await app.inject({
      method: 'GET',
      url: `/v1/import-detect-sessions/${badId}/report`,
      headers: auth(other.token),
    });
    expect(r404b.statusCode).toBe(404);
    // 报告过期 ⇒ 404 NOT_FOUND（§7.6 契约）。刻意不用 410 DETECT_SESSION_EXPIRED：
    // 报告寿命（24h）与会话 commit 有效期（15min）解耦，报告没了仍可 commit，
    // 借用会话过期码会让客户端重置整张导入卡（v1.3 修正）
    await getPool().query(
      `UPDATE import_detect_sessions SET report_expires_at = now() - interval '1 second' WHERE id = $1`,
      [badId],
    );
    const rExpired = await app.inject({
      method: 'GET',
      url: `/v1/import-detect-sessions/${badId}/report`,
      headers: auth(mine.token),
    });
    expect(rExpired.statusCode).toBe(404);
    expect((rExpired.json() as { code: string }).code).toBe('NOT_FOUND');
  });
});

// ==============================================================================
// CL · 会话周期清理
// ==============================================================================

describe('CL · cleanupDetectSessions（§7.4 生命周期）', () => {
  it('CL1: 僵尸 detecting（>10min）→ failed（释放并发槽）', async () => {
    const { userId, ledgerId } = await login('u-cl1');
    const familyId = await familyIdOf(ledgerId);
    const id = randomUUID();
    await getPool().query(
      `INSERT INTO import_detect_sessions (id, user_id, family_id, ledger_id, status, created_at)
       VALUES ($1, $2, $3, $4, 'detecting', now() - interval '20 minutes')`,
      [id, userId, familyId, ledgerId],
    );
    await cleanupDetectSessions(noopLog);
    expect((await getSessionRow(id)).status).toBe('failed');
  });

  it('CL2: ready 过期 → 删行产物文件并清空路径（行保留至报告过期）', async () => {
    const { token, ledgerId } = await login('u-cl2');
    await seedCategories();
    const d = await detect(token, extCsv(['2026-06-10,14:30:00,支出,1,餐饮,,,']), ledgerId);
    const detectId = (d.json() as { detect_id: string }).detect_id;
    const session = await getSessionRow(detectId);
    expect(existsSync(session.artifact_path!)).toBe(true);

    await getPool().query(
      `UPDATE import_detect_sessions SET expires_at = now() - interval '1 second' WHERE id = $1`,
      [detectId],
    );
    await cleanupDetectSessions(noopLog);
    const after = await getSessionRow(detectId);
    expect(after.status).toBe('ready'); // 派生过期不改状态机
    expect(after.artifact_path).toBeNull();
    expect(existsSync(session.artifact_path!)).toBe(false);
  });

  it('CL3: report 过期 → 删报告文件；无 job 的 ready/failed 行整行删除', async () => {
    const { token, ledgerId } = await login('u-cl3');
    await seedCategories();
    const d = await detect(token, extCsv(['2026-02-30,14:30:00,支出,1,餐饮,,,']), ledgerId);
    const detectId = (d.json() as { detect_id: string }).detect_id;
    const session = await getSessionRow(detectId);
    expect(session.report_path).not.toBeNull();
    const reportPath = session.report_path!;

    await getPool().query(
      `UPDATE import_detect_sessions SET report_expires_at = now() - interval '1 second' WHERE id = $1`,
      [detectId],
    );
    await cleanupDetectSessions(noopLog);
    expect(existsSync(reportPath)).toBe(false);
    const rows = (await getPool().query(`SELECT COUNT(*) AS n FROM import_detect_sessions WHERE id = $1`, [detectId])).rows[0] as { n: number };
    expect(Number(rows.n)).toBe(0); // 整行删除
  });
});

// ==============================================================================
// CF · classifyImportError 判定矩阵（单测直测）
// ==============================================================================

describe('CF · classifyImportError 判定矩阵（§7.5）', () => {
  it('确定性终态：CONTEXT_INVALIDATED / ARTIFACT_MISSING / INTERNAL(WriteBackRace)', () => {
    expect(classifyImportError(new ImportContextInvalidError('x'), 1)).toMatchObject({
      terminal: true,
      errorCode: 'CONTEXT_INVALIDATED',
    });
    expect(classifyImportError(new ImportArtifactError('x'), 1)).toMatchObject({
      terminal: true,
      errorCode: 'ARTIFACT_MISSING',
    });
    expect(classifyImportError(new ImportSuccessWriteBackRace('x'), 1)).toMatchObject({
      terminal: true,
      errorCode: 'INTERNAL',
    });
  });

  it('23505（非 client_ref 约束）⇒ CONSTRAINT_VIOLATION 终态（detect 校验集有漏信号）', () => {
    const err = Object.assign(new Error('duplicate'), { code: '23505', constraint: 'uq_other' });
    expect(classifyImportError(err, 1)).toMatchObject({ terminal: true, errorCode: 'CONSTRAINT_VIOLATION' });
  });

  it('瞬时 SQLSTATE/fs errno 在 attempts 内 ⇒ 回队；耗尽 ⇒ 终态', () => {
    const pgTransient = Object.assign(new Error('deadlock'), { code: '40P01' });
    expect(classifyImportError(pgTransient, 1)).toMatchObject({ terminal: false, errorCode: 'TRANSIENT_DB' });
    expect(classifyImportError(pgTransient, DATA_JOB_MAX_ATTEMPTS)).toMatchObject({
      terminal: true,
      errorCode: 'INTERNAL',
    });
    const fsTransient = Object.assign(new Error('io'), { code: 'EIO' });
    expect(classifyImportError(fsTransient, 1)).toMatchObject({ terminal: false, errorCode: 'TRANSIENT_IO' });
    expect(classifyImportError(new Error('boom'), 1)).toMatchObject({ terminal: true, errorCode: 'INTERNAL' });
  });
});

// ==============================================================================
// MS · migration 0021 导入侧静态断言（pg-mem 无部分索引/CHECK 载体）
// ==============================================================================

describe('MS · migration 0021 导入侧静态断言', () => {
  const sql = readFileSync(`${process.cwd()}/db/migrations/0021_data_jobs.sql`, 'utf8');

  it('import_detect_sessions 结构契约（四态状态机 / 去重索引 / 映射列 / 双有效期）', () => {
    expect(sql).toContain("'detecting', 'ready', 'consumed', 'failed'");
    expect(sql).toContain('idx_detect_sessions_dedup');
    expect(sql).toContain('(user_id, ledger_id, file_sha256)');
    expect(sql).toContain('member_mapping');
    expect(sql).toContain('report_expires_at');
    expect(sql).toContain('ON DELETE CASCADE');
  });

  it('uq_detect_sessions_active_per_user 部分唯一索引存在且谓词无 now()', () => {
    expect(sql).toContain('uq_detect_sessions_active_per_user');
    const start = sql.indexOf('uq_detect_sessions_active_per_user');
    const stmt = sql.slice(start, sql.indexOf(';', start));
    expect(stmt).toContain(`WHERE status = 'detecting'`);
    expect(stmt).not.toContain('now()');
  });

  it('chk_data_jobs_stage_scope：导入仅 validating · 导出 querying/packaging', () => {
    expect(sql).toContain('chk_data_jobs_stage_scope');
    expect(sql).toContain(`type = 'import' AND stage IN ('validating')`);
    expect(sql).toContain(`type = 'export' AND stage IN ('querying', 'packaging')`);
  });

  it('import 分支 chk 含 detect_id + source_hash NOT NULL（溯源链强制）', () => {
    expect(sql).toContain(`type = 'import' AND detect_id IS NOT NULL AND source_hash IS NOT NULL`);
  });
});
