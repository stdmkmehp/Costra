/**
 * Costra · Server · 头像上传路由单测（二期 COS 化 · 既有缺口补齐：此前无 upload 路由测试）
 *
 * 事实源：docs/design/cos-offload-phase2-avatar.md v1.6 §7.3 / §7.5
 *
 * 覆盖：
 *   U1  魔数通过 ⇒ 对象落在 avatars/<userId>（去后缀 · D2）、内容字节一致、
 *       contentType/cacheControl 正确（ContentType 是去后缀后类型信息的唯一载体）
 *   U2  返回 URL = https://<avatar base>/avatars/<userId>?v=<数字>（正则断言 ·
 *       域名来自 COS_AVATAR_BASE env 固定值，不再按请求头推导）
 *   U3  既有错误语义：非图片字节 400 / >2MB 400 / 非 multipart 400 / 无 token 401
 *       （>2MB 修复说明：busboy 在 fileSize 上限截断而非报错，原 totalSize>MAX 分支为
 *       死代码，>2MB 曾被静默截断上传成功；现按 data.file.truncated 判定，闸口真实生效）
 *   U4  putObject 抛错 ⇒ 500 INTERNAL（Costra JSON 契约 · details.step='cos_put' ·
 *       非裸异常/HTML · 二期 §7.3 失败语义）
 *   U5  RIFF 头但非 WEBP 的字节（如 WAV）⇒ 判为不支持类型（二期 §7.4 魔数收窄）
 */

import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../src/app.js';
import { setWxFetchForTests } from '../src/wx/code2Session.js';
import { AVATAR_CACHE_CONTROL, __setCosForTests } from '../src/services/cosClient.js';
import { MemoryCosStore } from './helpers/memoryCos.js';

let app: FastifyInstance;
const cos = new MemoryCosStore('https://img.test.local');

beforeAll(() => {
  __setCosForTests('avatars', cos);
});

beforeEach(async () => {
  cos.clear();
  app = await buildApp({ disableLogger: true });
  await app.ready();
});

// ─── helpers ─────────────────────────────────────────────────────────────────

async function login(openid: string): Promise<{ token: string; userId: string }> {
  setWxFetchForTests(
    (async (): Promise<Response> =>
      new Response(JSON.stringify({ openid, session_key: 'sk' }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      })) as unknown as typeof fetch,
  );
  const res = await app.inject({ method: 'POST', url: '/v1/auth/wx-login', payload: { code: `c-${openid}` } });
  const body = res.json() as { access_token: string; user: { id: string } };
  return { token: body.access_token, userId: body.user.id };
}

/** 手工拼 multipart 单文件 body（field name=file · 不引第三方依赖） */
function multipartPayload(
  fileBuf: Buffer,
  filename = 'avatar.bin',
): { payload: Buffer; contentType: string } {
  const boundary = '----costraTestBoundary';
  const payload = Buffer.concat([
    Buffer.from(
      `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${filename}"\r\nContent-Type: application/octet-stream\r\n\r\n`,
    ),
    fileBuf,
    Buffer.from(`\r\n--${boundary}--\r\n`),
  ]);
  return { payload, contentType: `multipart/form-data; boundary=${boundary}` };
}

async function uploadAvatar(
  token: string | null,
  fileBuf: Buffer,
): Promise<{ statusCode: number; body: Record<string, unknown> }> {
  const { payload, contentType } = multipartPayload(fileBuf);
  const res = await app.inject({
    method: 'POST',
    url: '/v1/upload/avatar',
    headers: {
      'content-type': contentType,
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
    payload,
  });
  return { statusCode: res.statusCode, body: res.json() as Record<string, unknown> };
}

// 各类型最小合法魔数（内容字节随意 · 魔数检测只看头部）
const JPEG_BYTES = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(64, 0x11)]);
const PNG_BYTES = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(64, 0x22)]);
const GIF_BYTES = Buffer.concat([Buffer.from('GIF89a', 'ascii'), Buffer.alloc(64, 0x33)]);
const WEBP_BYTES = Buffer.concat([Buffer.from('RIFF', 'ascii'), Buffer.from([0x20, 0x00, 0x00, 0x00]), Buffer.from('WEBP', 'ascii'), Buffer.alloc(64, 0x44)]);
/** RIFF 容器但非 WEBP（WAV）· U5 收窄用例 */
const WAV_BYTES = Buffer.concat([Buffer.from('RIFF', 'ascii'), Buffer.from([0x20, 0x00, 0x00, 0x00]), Buffer.from('WAVE', 'ascii'), Buffer.alloc(64, 0x55)]);

// ─── U1/U2 · 成功路径 ───────────────────────────────────────────────────────

describe('U1/U2 · 上传成功：对象落 COS + URL 形态', () => {
  it.each([
    ['jpg', JPEG_BYTES, 'image/jpeg'],
    ['png', PNG_BYTES, 'image/png'],
    ['gif', GIF_BYTES, 'image/gif'],
    ['webp', WEBP_BYTES, 'image/webp'],
  ] as const)('%s ⇒ avatars/<userId> 字节一致 · contentType/cacheControl 正确 · URL 形如 objectUrl+v',
    async (label, bytes, expectedContentType) => {
      const { token, userId } = await login(`u1-${label}`);
      const { statusCode, body } = await uploadAvatar(token, bytes);

      expect(statusCode).toBe(201);
      // U2：URL = <avatar base>/avatars/<userId>?v=<数字>
      expect(body.url).toMatch(new RegExp(`^https://img\\.test\\.local/avatars/${userId}\\?v=\\d+$`));

      // U1：对象落点与字节
      const key = `avatars/${userId}`;
      expect(cos.has(key)).toBe(true);
      expect(cos.content(key)?.equals(bytes)).toBe(true);
      // U1：对象元数据（去后缀后类型信息唯一载体 + 长缓存）
      expect(cos.putOptions(key)).toEqual({
        contentType: expectedContentType,
        cacheControl: AVATAR_CACHE_CONTROL,
      });
      expect(AVATAR_CACHE_CONTROL).toBe('public, max-age=31536000');
    });

  it('同一用户重复上传 ⇒ 同 key 覆盖、URL 的 ?v= 更新', async () => {
    const { token, userId } = await login('u1-overwrite');
    const first = await uploadAvatar(token, JPEG_BYTES);
    await new Promise((r) => setTimeout(r, 2)); // ?v= 毫秒粒度 · 跨过毫秒边界再传第二次
    const second = await uploadAvatar(token, PNG_BYTES);

    const key = `avatars/${userId}`;
    expect(cos.keys()).toEqual([key]); // 换格式不留孤儿（D2 去后缀）
    expect(cos.content(key)?.equals(PNG_BYTES)).toBe(true);
    expect(cos.putOptions(key)?.contentType).toBe('image/png');
    expect(first.body.url).not.toBe(second.body.url); // ?v= 击穿缓存
  });
});

// ─── U3 · 既有错误语义 ──────────────────────────────────────────────────────

describe('U3 · 既有错误语义不变', () => {
  it('非图片字节 ⇒ 400 INVALID_ARGUMENT', async () => {
    const { token } = await login('u3-notimage');
    const { statusCode, body } = await uploadAvatar(token, Buffer.from('not an image at all.........'));
    expect(statusCode).toBe(400);
    expect(body.code).toBe('INVALID_ARGUMENT');
  });

  it('>2MB ⇒ 400 INVALID_ARGUMENT（busboy 截断 ⇒ truncated 判定 · 修复前为静默截断 201）', async () => {
    const { token, userId } = await login('u3-oversize');
    const big = Buffer.concat([JPEG_BYTES, Buffer.alloc(2 * 1024 * 1024, 0x61)]); // >2MB
    const { statusCode, body } = await uploadAvatar(token, big);
    expect(statusCode).toBe(400);
    expect(body.code).toBe('INVALID_ARGUMENT');
    expect(cos.has(`avatars/${userId}`)).toBe(false); // 不得写入截断内容
  });

  it('非 multipart ⇒ 400 INVALID_ARGUMENT', async () => {
    const { token } = await login('u3-notmultipart');
    const res = await app.inject({
      method: 'POST',
      url: '/v1/upload/avatar',
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      payload: {},
    });
    expect(res.statusCode).toBe(400);
    expect((res.json() as { code: string }).code).toBe('INVALID_ARGUMENT');
  });

  it('无 token ⇒ 401 UNAUTHENTICATED', async () => {
    const { statusCode, body } = await uploadAvatar(null, JPEG_BYTES);
    expect(statusCode).toBe(401);
    expect(body.code).toBe('UNAUTHENTICATED');
  });
});

// ─── U4 · COS 写失败 ⇒ 500 INTERNAL JSON 契约 ───────────────────────────────

describe('U4 · putObject 失败语义（二期 §7.3）', () => {
  it('putObject 抛错 ⇒ 500 INTERNAL · Costra JSON 契约 · details.step=cos_put', async () => {
    const { token } = await login('u4-cosfail');
    cos.putFailure = new Error('simulated COS 5xx');
    const { statusCode, body } = await uploadAvatar(token, JPEG_BYTES);
    expect(statusCode).toBe(500);
    expect(body.code).toBe('INTERNAL');
    expect(body.trace_id).toBeDefined();
    expect(body.details).toMatchObject({ step: 'cos_put' });
  });
});

// ─── U5 · WEBP 魔数收窄（二期 §7.4） ────────────────────────────────────────

describe('U5 · WEBP 魔数收窄', () => {
  it('RIFF 头但 offset 8..12 != WEBP（WAV）⇒ 400 INVALID_ARGUMENT', async () => {
    const { token, userId } = await login('u5-wav');
    const { statusCode, body } = await uploadAvatar(token, WAV_BYTES);
    expect(statusCode).toBe(400);
    expect(body.code).toBe('INVALID_ARGUMENT');
    expect(cos.has(`avatars/${userId}`)).toBe(false);
  });
});
