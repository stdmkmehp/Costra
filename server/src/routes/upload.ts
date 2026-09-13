/**
 * Costra · Server · 文件上传路由
 *
 * 卡号：COSTRA-230（头像持久化）
 * 事实源：server/api/openapi.yaml paths /upload/avatar
 *
 * 契约约束：
 *   - POST /upload/avatar  multipart/form-data, field name: file
 *     → 201 { url: string }
 *
 * 设计原则：
 *   - 只允许已认证用户上传
 *   - 文件名使用 userId（同一用户每次覆盖），不累积历史文件
 *   - 只接受 JPEG / PNG / GIF / WEBP（魔数校验，不信任 Content-Type）
 *   - 单文件限 2MB
 *   - 存储路径：UPLOAD_DIR（默认 /var/costra/uploads）/avatars/<userId>.<ext>
 *   - 返回 URL 格式：https://<host>/uploads/avatars/<userId>.<ext>?v=<毫秒时间戳>
 *     由 nginx /uploads/ location 直接静态服务（query string 不参与静态文件寻址）
 *
 * 头像 URL 版本化（?v= 2026-09-13）：
 *   文件按 userId 同名覆盖 ⇒ 裸 URL 恒定不变。微信 <image> 按 URL 做持久磁盘缓存，
 *   内容更新而 URL 不变时客户端持续命中旧缓存（切页/重拉均无效，仅清数据可解）。
 *   故每次上传返回带全新 ?v= 的版本化 URL，经 PATCH /users/me 落库 users.avatar_url，
 *   随 sync/family/statistics 等全部下发点自然传播到所有渲染端，缓存即被新旧 URL 差异击穿。
 *   存量无 ?v= 的 avatar_url 仍可正常访问（nginx 静态服务忽略 query）。
 */

import type { FastifyInstance, FastifyRequest } from 'fastify';
import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { AppError } from '../errors/AppError.js';
import { ErrorCode } from '../errors/ErrorCode.js';

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

/** 文件类型魔数 → 允许的扩展名 */
const MAGIC_MAP: Array<{ magic: Buffer; ext: string }> = [
  { magic: Buffer.from([0xff, 0xd8, 0xff]),             ext: 'jpg'  }, // JPEG
  { magic: Buffer.from([0x89, 0x50, 0x4e, 0x47]),       ext: 'png'  }, // PNG
  { magic: Buffer.from([0x47, 0x49, 0x46]),              ext: 'gif'  }, // GIF
  { magic: Buffer.from([0x52, 0x49, 0x46, 0x46]),        ext: 'webp' }, // WEBP (RIFF header)
];

const MAX_FILE_SIZE = 2 * 1024 * 1024; // 2 MB

/**
 * 从 Buffer 前几字节检测文件类型，返回扩展名；不匹配则返回 null
 */
function detectExt(head: Buffer): string | null {
  for (const { magic, ext } of MAGIC_MAP) {
    if (head.slice(0, magic.length).equals(magic)) return ext;
  }
  return null;
}

/**
 * 从 env 读上传根目录，默认 /var/costra/uploads
 * 可通过 UPLOAD_DIR env 覆盖（本地开发使用 /tmp/costra-uploads）
 */
function getUploadDir(): string {
  return process.env['UPLOAD_DIR'] ?? '/var/costra/uploads';
}

/**
 * 宿主机 URL 前缀：用于拼 avatar_url 返回给客户端
 * 从 env UPLOAD_URL_BASE 读取，默认 https://costra.cloud
 */
function getUrlBase(): string {
  return process.env['UPLOAD_URL_BASE'] ?? 'https://costra.cloud';
}

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

    // 读取文件内容到内存（用于魔数检测 + 写盘）
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

    const fileBuffer = Buffer.concat(chunks);

    // 魔数校验（不信任 Content-Type / filename）
    const ext = detectExt(fileBuffer);
    if (!ext) {
      throw new AppError(ErrorCode.INVALID_ARGUMENT, {
        message: 'unsupported file type; allowed: JPEG, PNG, GIF, WEBP',
        details: { field: 'file', constraint: 'allowed_types: jpeg,png,gif,webp' },
      });
    }

    // 写磁盘
    const avatarsDir = join(getUploadDir(), 'avatars');
    await mkdir(avatarsDir, { recursive: true });

    const filename = `${userId}.${ext}`;
    const destPath = join(avatarsDir, filename);

    // 原子写：先写 .tmp，再 rename，避免读到半写文件
    const tmpPath = `${destPath}.tmp`;
    await import('node:fs/promises').then(({ writeFile, rename }) =>
      writeFile(tmpPath, fileBuffer).then(() => rename(tmpPath, destPath))
    );

    // URL 版本化：同名覆盖下裸 URL 恒定，附 ?v= 使每次上传的 URL 唯一，
    // 击穿微信 <image> 按 URL 键的持久缓存（详见文件头注释）
    const url = `${getUrlBase()}/uploads/avatars/${filename}?v=${Date.now()}`;

    app.log.info({ userId, filename, bytes: fileBuffer.length }, '[upload] avatar saved');

    return reply.code(201).send({ url });
  });
}
