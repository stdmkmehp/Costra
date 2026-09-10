/**
 * Costra · Server · 响应压缩（@fastify/compress）单测
 *
 * 事实源：docs/design/response-compression-design.md §5
 *
 * 覆盖（下载路由排除 T4 落在 dataJobs.test.ts 的下载测试，贴近唯一消费者）：
 *   T1 带 accept-encoding: gzip 请求大 JSON（/sync/pull） ⇒ content-encoding: gzip
 *      + vary 含 accept-encoding + gunzip 后与 identity 响应逐字节一致
 *   T2 不带 accept-encoding ⇒ 无 content-encoding，body 原文
 *   T3 小响应（/healthz，<1KB）带 gzip 头也不压（threshold 生效）
 *   T5 accept-encoding: identity 显式 ⇒ 不压缩
 *   T6 带 content-encoding: gzip 的请求体 ⇒ 插件不介入解压（globalDecompression: false）
 *   T7 幂等重放分支（reply.send 在 if 内）+ gzip ⇒ body 非空且与首发一致（§4.6 空 body 回归锁）
 *   T8 源码静态扫描：routes/* 不得出现未 return 的 reply.send（护栏，替代未接线的 server ESLint）
 *
 * 关于测试传输方式：
 *   app.inject（light-my-request）对「压缩后走流式 pipeline」的响应体捕获不到字节
 *   （content-length: 0 + 空 rawPayload），无法在 inject 下做 gunzip 字节级断言。
 *   故 T1 起真实 HTTP server（app.listen）+ Node http 客户端拿**原始 gzip 字节**验证；
 *   其余用例（只看响应头/行为）继续走 inject。
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { gunzipSync } from 'node:zlib';
import { request as httpRequest } from 'node:http';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { buildApp } from '../src/app.js';
import { setWxFetchForTests } from '../src/wx/code2Session.js';

async function login(app: FastifyInstance): Promise<{ token: string; userId: string }> {
  setWxFetchForTests(
    (async () =>
      new Response(
        JSON.stringify({ openid: 'openid-compress-test', session_key: 'sk' }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      )) as unknown as typeof fetch,
  );
  const res = await app.inject({
    method: 'POST',
    url: '/v1/auth/wx-login',
    payload: { code: 'test-compress' },
    headers: { 'content-type': 'application/json' },
  });
  const body = res.json() as { access_token: string; user: { id: string } };
  return { token: body.access_token, userId: body.user.id };
}

const FAMILY_ID = '00000000-0000-0000-0000-0000000000c1';
const LEDGER_ID = '00000000-0000-0000-0000-0000000000c2';
const PULL_PATH = `/v1/sync/pull?family_id=${FAMILY_ID}&since=0`;

let app: FastifyInstance;
let token: string;
let userId: string;

beforeEach(async () => {
  app = await buildApp({ disableLogger: true });
  await app.ready();
  const loginResult = await login(app);
  token = loginResult.token;
  userId = loginResult.userId;

  const pool = (await import('../src/db/pool.js')).getPool();
  await pool.query(
    `INSERT INTO families (id, name, owner_id, kind) VALUES ($1, 'CompressFamily', $2, 'shared')`,
    [FAMILY_ID, userId],
  );
  await pool.query(
    `INSERT INTO ledgers (id, family_id, name) VALUES ($1, $2, 'Main')`,
    [LEDGER_ID, FAMILY_ID],
  );
  await pool.query(
    `INSERT INTO family_members (family_id, user_id, role) VALUES ($1, $2, 'owner')`,
    [FAMILY_ID, userId],
  );
});

afterEach(async () => {
  await app.close();
});

/** 通过 sync/push 造若干 entry，让 /sync/pull 响应体足够大（超 1KB threshold） */
async function seedEntries(count: number): Promise<void> {
  const ops = Array.from({ length: count }, (_, i) => ({
    op: 'create',
    entity: 'entry',
    client_ref_id: `local-compress-${i}-${Math.random().toString(36).slice(2, 8)}`,
    base_version: null,
    payload: {
      ledger_id: LEDGER_ID,
      type: 'expense',
      amount: (i + 1) * 100,
      occurred_at: '2026-09-09T10:00:00.000Z',
      ownership: 'personal',
      note: `压缩测试样例条目 #${i}`,
    },
  }));
  const res = await app.inject({
    method: 'POST',
    url: '/v1/sync/push',
    headers: {
      'content-type': 'application/json',
      authorization: `Bearer ${token}`,
      'idempotency-key': `idemp-compress-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    },
    payload: { ops },
  });
  expect(res.statusCode).toBe(200);
}

interface RawResponse {
  status: number;
  headers: Record<string, string | string[] | undefined>;
  body: Buffer;
}

/** 真实 HTTP 请求，返回**原始未解压**响应体字节 + 头（Node http 不自动解压，正好拿 gzip 原文） */
function rawRequest(
  port: number,
  method: 'GET' | 'POST',
  path: string,
  headers: Record<string, string>,
  jsonBody?: unknown,
): Promise<RawResponse> {
  const payload = jsonBody === undefined ? null : Buffer.from(JSON.stringify(jsonBody));
  const allHeaders: Record<string, string> = { ...headers };
  if (payload) {
    allHeaders['content-type'] = 'application/json';
    allHeaders['content-length'] = String(payload.byteLength);
  }
  return new Promise((resolve, reject) => {
    const req = httpRequest(
      { host: '127.0.0.1', port, path, method, headers: allHeaders },
      (res) => {
        const chunks: Buffer[] = [];
        res.on('data', (c) => chunks.push(c as Buffer));
        res.on('end', () =>
          resolve({ status: res.statusCode ?? 0, headers: res.headers, body: Buffer.concat(chunks) }),
        );
      },
    );
    req.on('error', reject);
    req.end(payload ?? undefined);
  });
}

const rawGet = (port: number, path: string, headers: Record<string, string>): Promise<RawResponse> =>
  rawRequest(port, 'GET', path, headers);

/**
 * 起一个独立实例做真实监听（与 beforeEach 里用于 inject 的实例分离，
 * 避免 inject 与 listen 在同一实例上混用导致的响应流状态异常）。
 * DB/Redis 由 test/setup.ts 全局 mock，跨实例共享，故沿用 beforeEach 拿到的 token。
 */
async function withListeningApp<T>(fn: (port: number) => Promise<T>): Promise<T> {
  const listenApp = await buildApp({ disableLogger: true });
  await listenApp.ready();
  const address = await listenApp.listen({ port: 0, host: '127.0.0.1' });
  try {
    return await fn(Number(new URL(address).port));
  } finally {
    await listenApp.close();
  }
}

describe('响应压缩（@fastify/compress）', () => {
  it('T1 大 JSON + accept-encoding: gzip ⇒ 压缩 + vary + 解压后与 identity 逐字节一致', async () => {
    await seedEntries(40); // 40 条 entry，pull 响应远超 1KB threshold

    await withListeningApp(async (port) => {
      const auth = { authorization: `Bearer ${token}`, connection: 'close' };
      const gz = await rawGet(port, PULL_PATH, { ...auth, 'accept-encoding': 'gzip' });
      const plain = await rawGet(port, PULL_PATH, { ...auth, 'accept-encoding': 'identity' });

      expect(gz.status).toBe(200);
      expect(gz.headers['content-encoding']).toBe('gzip');
      expect(String(gz.headers['vary'] ?? '').toLowerCase()).toContain('accept-encoding');

      // identity 响应无压缩
      expect(plain.headers['content-encoding']).toBeUndefined();

      // 压缩体确实小于原文（40 条重复键/UUID/时间戳，压缩比明显）
      expect(gz.body.byteLength).toBeLessThan(plain.body.byteLength);

      // 解压后逐字节等于 identity 响应
      const decoded = gunzipSync(gz.body);
      expect(decoded.equals(plain.body)).toBe(true);
      // 且是合法 JSON、与 identity 语义一致
      expect(JSON.parse(decoded.toString('utf8'))).toEqual(JSON.parse(plain.body.toString('utf8')));
    });
  });

  it('T2 大 JSON 不带 accept-encoding ⇒ 无 content-encoding，body 原文', async () => {
    await seedEntries(40);
    const res = await app.inject({
      method: 'GET',
      url: PULL_PATH,
      headers: { authorization: `Bearer ${token}` },
    });
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-encoding']).toBeUndefined();
    // 原文可直接 JSON.parse
    expect(() => JSON.parse(res.rawPayload.toString('utf8'))).not.toThrow();
  });

  it('T3 小响应（/healthz <1KB）带 gzip 头也不压缩（threshold 生效）', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/healthz',
      headers: { 'accept-encoding': 'gzip' },
    });
    expect(res.statusCode).toBe(200);
    expect(res.rawPayload.byteLength).toBeLessThan(1024);
    expect(res.headers['content-encoding']).toBeUndefined();
  });

  it('T5 accept-encoding: identity 显式 ⇒ 不压缩', async () => {
    await seedEntries(40);
    const res = await app.inject({
      method: 'GET',
      url: PULL_PATH,
      headers: { authorization: `Bearer ${token}`, 'accept-encoding': 'identity' },
    });
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-encoding']).toBeUndefined();
  });

  it('T6 请求体 content-encoding: gzip ⇒ 插件不介入解压（globalDecompression: false）', async () => {
    // 关键判定：带 content-encoding: gzip 的**未压缩合法 JSON** body。
    // 若插件请求解压 hook 开着（globalDecompression 默认 true），它会尝试 gunzip 明文 ⇒
    //   抛 FST_CP_ERR_INVALID_CONTENT（415/非契约错误码）；
    // 关闭后插件不碰请求体 ⇒ Fastify 忽略 content-encoding，直接按明文 JSON 正常解析 ⇒ 200。
    // 即：验证插件未接管请求体解压，行为退化为「无该插件时」。
    setWxFetchForTests(
      (async () =>
        new Response(
          JSON.stringify({ openid: 'openid-compress-t6', session_key: 'sk' }),
          { status: 200, headers: { 'content-type': 'application/json' } },
        )) as unknown as typeof fetch,
    );
    const res = await app.inject({
      method: 'POST',
      url: '/v1/auth/wx-login',
      headers: { 'content-type': 'application/json', 'content-encoding': 'gzip' },
      payload: { code: 'test-t6' }, // 未压缩明文
    });
    // 插件未接管解压 ⇒ 明文 JSON 正常解析成功（登录走通），不出现 FST_CP_ERR_* 非契约错误
    expect(res.statusCode).toBe(200);
  });

  it('T7 幂等重放（send 在 if 分支内）+ gzip ⇒ 解压后与首发一致，body 不为空', async () => {
    // 回归锁（§4.6）：async handler 里 `reply.send(x)` 不 return 时，压缩的异步 onSend
    // 与 wrapThenable 的补发逻辑冲突 ⇒ 响应 Content-Length: 0、body 空（gzip 头仍在）。
    // /sync/push 的幂等重放分支正是这种形态，且重放体（200 op）远超 1KB threshold。
    const ops = Array.from({ length: 40 }, (_, i) => ({
      op: 'create',
      entity: 'entry',
      client_ref_id: `local-replay-${i}`,
      base_version: null,
      payload: {
        ledger_id: LEDGER_ID,
        type: 'expense',
        amount: (i + 1) * 100,
        occurred_at: '2026-09-09T10:00:00.000Z',
        ownership: 'personal',
        note: `幂等重放测试条目 #${i}`,
      },
    }));

    await withListeningApp(async (port) => {
      // 同一 Idempotency-Key + 同一 body ⇒ 第二次命中幂等缓存走重放分支
      const headers = {
        authorization: `Bearer ${token}`,
        'idempotency-key': 'idemp-compress-replay',
        connection: 'close',
      };

      const first = await rawRequest(port, 'POST', '/v1/sync/push', { ...headers, 'accept-encoding': 'identity' }, { ops });
      expect(first.status).toBe(200);
      expect(first.body.byteLength).toBeGreaterThan(1024); // 确认越过 threshold，压缩会真的介入
      expect(first.headers['content-encoding']).toBeUndefined();

      const replay = await rawRequest(port, 'POST', '/v1/sync/push', { ...headers, 'accept-encoding': 'gzip' }, { ops });
      expect(replay.status).toBe(200);
      expect(replay.headers['content-encoding']).toBe('gzip');
      // 核心断言：压缩后的重放响应必须有内容，且解压后与首发逐字节一致
      expect(replay.body.byteLength).toBeGreaterThan(0);
      expect(gunzipSync(replay.body).equals(first.body)).toBe(true);
    });
  });

  it('T8 routes/* 不得出现未 return 的 reply.send（护栏 · 见 §4.6）', () => {
    // server 侧 ESLint 尚未接线（package.json lint 为 stub），故用源码静态扫描兜住纪律：
    // async handler 里「表达式语句形态的 reply.send(...)」在压缩下会静默返回空 body，
    // 症状不报错、极难归因 —— 必须在 CI（npm test）阶段挡住新增。
    // vitest 从 server/ 目录运行（tsconfig module=CommonJS · 不可用 import.meta）
    const routesDir = join(process.cwd(), 'src', 'routes');
    const offenders: string[] = [];

    for (const file of readdirSync(routesDir).filter((f) => f.endsWith('.ts'))) {
      const lines = readFileSync(join(routesDir, file), 'utf8').split('\n');
      lines.forEach((line, idx) => {
        const code = line.replace(/\/\/.*$/, '');
        // 匹配「语句以 reply 开头并在本行调用 .send(」且行首无 return / await / = 的情况。
        // 链式换行（`return reply` 起头、`.send(csv)` 单独成行）不会被误判：该行不以 reply 开头。
        if (/^\s*reply\b/.test(code) && /\.send\s*\(/.test(code)) {
          offenders.push(`${file}:${idx + 1}: ${line.trim()}`);
        }
      });
    }

    expect(offenders, `以下位置必须改为 return reply…send(…)：\n${offenders.join('\n')}`).toEqual([]);
  });
});
