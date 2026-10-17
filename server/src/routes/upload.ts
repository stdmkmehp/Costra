/**
 * Costra · Server · 文件上传路由
 *
 * 卡号：COSTRA-230（头像持久化）· 二期 COS 化：docs/design/cos-offload-phase2-avatar.md v1.6 §7.3
 * 事实源：server/api/openapi.yaml paths /upload/avatar
 *
 * 契约约束：
 *   - POST /upload/avatar  multipart/form-data, field name: file
 *     → 201 { url: string }
 *
 * 设计原则：
 *   - 只允许已认证用户上传
 *   - 只接受 JPEG / PNG / GIF / WEBP（魔数校验，不信任 Content-Type · 与迁移脚本同源
 *     共用 utils/imageMagic.ts）
 *   - 单文件限 2MB（闸口留在服务端 · 二期 §15 已否决客户端直传）
 *   - 落点：COS 头像桶（公有读私有写），对象 Key = avatars/<userId>（去后缀 · 决策 D2：
 *     一人恒一个对象，换图片格式不留孤儿，桶无生命周期规则故必须不产生垃圾）；
 *     类型信息由 putObject 的 ContentType 元数据承载（魔数推导）。
 *   - 返回 URL = objectUrl(key) + "?v=" + Date.now()，域名来自该桶 env 固定值
 *     （COS_AVATAR_BASE），不再按请求头推导（2026-09-13 staging URL 指 prod 的坑在
 *     "每台机器只配自己那套桶+域名"下天然不复存在 · 部署核验见二期 §11 步 2）。
 *
 * 为何仍需 ?v= 版本化（2026-09-13 落地 · COS 化后沿用）：
 *   Key 恒定 + 对象覆盖写 ⇒ 裸 URL 不变。微信 <image> 按 URL 做持久磁盘缓存，
 *   内容更新而 URL 不变时客户端持续命中旧缓存（切页/重拉均无效，仅清数据可解）。
 *   故每次上传返回带全新 ?v= 的版本化 URL，经 PATCH /users/me 落库 users.avatar_url，
 *   随 sync/family/statistics 等全部下发点自然传播到所有渲染端，缓存即被新旧 URL 差异击穿。
 *
 * 为何公有读而非预签名（决策 D3 · 二期 §6.2）：
 *   avatar_url 是持久化入库、经 13+ 响应契约广播、被 Redis/客户端 TTL 缓存反复复用的值，
 *   与 300s 时效的预签名 URL 语义互斥；<image> 也无法携带 Authorization。
 *   对象元数据带 Cache-Control: public, max-age=31536000，配合 ?v= 重复加载零请求。
 *
 * 失败语义（二期 §7.3 · 本地盘时代几乎不失败，改跨公网写后必须定义）：
 *   putObject 超时/网络/5xx ⇒ 既有 500 INTERNAL JSON 契约（details.step='cos_put'），
 *   不新增错误码（瞬时故障 · 客户端提示重试即可）；SDK 超时按桶已设 5s（先于
 *   nginx proxy_read_timeout 10s 失败，避免用户先收到 504 HTML）。
 *   ⇒ COS 故障时用户**无法更换头像**（不是"能换但看不到" · 二期 §13 已记录该取舍）。
 */

import type { FastifyInstance, FastifyRequest } from 'fastify';
import { AppError } from '../errors/AppError.js';
import { ErrorCode } from '../errors/ErrorCode.js';
import {
  AVATAR_CACHE_CONTROL,
  getCosClient,
} from '../services/cosClient.js';
import { detectExt, extToContentType } from '../utils/imageMagic.js';

interface JwtPayload { sub: string; iat: number; exp: number }

async function parseUserId(request: FastifyRequest): Promise<string> {
  try {
    await request.jwtVerify();
  } catch {
    throw new AppError(ErrorCode.UNAUTHENTICATED, { message: 'invalid token' });
  }
  const user = request.user as JwtPayload | undefined;
  if (!user?.sub) throw new AppError(ErrorCode.UNAUTHENTICATED, { message: 'invalid token' });
  return user.sub;
}

const MAX_FILE_SIZE = 2 * 1024 * 1024; // 2 MB

export async function registerUploadRoutes(app: FastifyInstance): Promise<void> {
  // POST /upload/avatar
  app.post('/upload/avatar', async (req, reply) => {
    const userId = await parseUserId(req);

    // 必须是 multipart 请求
    if (!req.isMultipart()) {
      throw new AppError(ErrorCode.INVALID_ARGUMENT, {
        message: 'request must be multipart/form-data',
      });
    }

    const data = await req.file({
      limits: {
        fileSize: MAX_FILE_SIZE,
        files: 1,
      },
    });

    if (!data) {
      throw new AppError(ErrorCode.INVALID_ARGUMENT, {
        message: 'no file field found; expected field name: file',
      });
    }

    // 读取文件内容到内存（用于魔数检测 + putObject）
    // 注意：req.file() 返回流，必须消费，否则连接不会释放
    const chunks: Buffer[] = [];
    let totalSize = 0;
    for await (const chunk of data.file) {
      totalSize += chunk.length;
      if (totalSize > MAX_FILE_SIZE) {
        // 超大：排空流并抛错
        data.file.resume();
        throw new AppError(ErrorCode.INVALID_ARGUMENT, {
          message: `file too large (max ${MAX_FILE_SIZE / 1024 / 1024} MB)`,
          details: { field: 'file', constraint: `max_size_bytes:${MAX_FILE_SIZE}` },
        });
      }
      chunks.push(chunk);
    }

    // busboy 在 fileSize 上限处**截断**而非报错（truncated=true · 流正常结束），
    // 上方 totalSize > MAX 分支因此永远摸不到（截断后恰等于 MAX）。
    // 不查 truncated 的话，>2MB 的头像会被静默裁掉尾部后上传成功（探针实锤 · 2026-10-17）。
    if (data.file.truncated) {
      throw new AppError(ErrorCode.INVALID_ARGUMENT, {
        message: `file too large (max ${MAX_FILE_SIZE / 1024 / 1024} MB)`,
        details: { field: 'file', constraint: `max_size_bytes:${MAX_FILE_SIZE}` },
      });
    }

    const fileBuffer = Buffer.concat(chunks);

    // 魔数校验（不信任 Content-Type / filename）
    const ext = detectExt(fileBuffer);
    if (!ext) {
      throw new AppError(ErrorCode.INVALID_ARGUMENT, {
        message: 'unsupported file type; allowed: JPEG, PNG, GIF, WEBP',
        details: { field: 'file', constraint: 'allowed_types: jpeg,png,gif,webp' },
      });
    }

    // 写 COS 头像桶（公有读私有写 · Key 去后缀 · ContentType 由魔数推导）
    // putObject 失败映射为既有 500 INTERNAL（不允许裸抛 · 见文件头失败语义）
    const store = getCosClient('avatars');
    const key = `avatars/${userId}`;
    try {
      await store.putObject(key, fileBuffer, {
        contentType: extToContentType(ext),
        cacheControl: AVATAR_CACHE_CONTROL,
      });
    } catch (err) {
      throw new AppError(ErrorCode.INTERNAL, {
        message: 'avatar upload to COS failed',
        details: { step: 'cos_put' },
        cause: err,
      });
    }

    // URL 版本化：Key 恒定 + 对象覆盖写 ⇒ 裸 URL 不变，附 ?v= 使每次上传的 URL 唯一，
    // 击穿微信 <image> 按 URL 键的持久缓存（详见文件头注释）
    const url = `${store.objectUrl(key)}?v=${Date.now()}`;

    app.log.info({ userId, key, bytes: fileBuffer.length }, '[upload] avatar saved to COS');

    return reply.code(201).send({ url });
  });
}
