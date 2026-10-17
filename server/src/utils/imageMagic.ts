/**
 * Costra · Server · 图片魔数检测（头像链路共用模块）
 *
 * 事实源：docs/design/cos-offload-phase2-avatar.md v1.6 §7.3 / §7.4
 *
 * 消费方（两边同源 · 同一系统对同一件事不存两套判据）：
 *   - server/src/routes/upload.ts                  上传路由魔数校验 + ContentType 推导
 *   - server/scripts/migrate-avatars-to-cos.ts     存量预搬按魔数判 MIME（不信文件名后缀）
 *
 * 纪律：不信任 Content-Type / filename，只信文件头字节（upload.ts 既有纪律）。
 *
 * WEBP 判定收窄（二期 v1.2 修正 · 既有缺陷由 COS 化放大）：
 *   RIFF 是容器头（WAV / AVI / WEBP 共用），只比前 4 字节会把 .wav 误判成 image/webp。
 *   D2 去后缀后 Content-Type 是类型信息的唯一载体，写错即渲染失败，
 *   故 WEBP 必须同时校验 offset 8..12 == 'WEBP'。
 */

/** 允许的图片类型（扩展名语义 · 仅用于映射 Content-Type，不出现在对象 Key 里） */
export type ImageExt = 'jpg' | 'png' | 'gif' | 'webp';

interface MagicRule {
  readonly ext: ImageExt;
  /** 主魔数（从 offset 0 起比对） */
  readonly magic: readonly number[];
  /** 附加魔数（WEBP：RIFF 容器内 offset 8 处的 'WEBP' 四字节） */
  readonly extra?: { readonly offset: number; readonly bytes: readonly number[] };
}

const MAGIC_MAP: readonly MagicRule[] = [
  { ext: 'jpg', magic: [0xff, 0xd8, 0xff] }, // JPEG
  { ext: 'png', magic: [0x89, 0x50, 0x4e, 0x47] }, // PNG
  { ext: 'gif', magic: [0x47, 0x49, 0x46] }, // GIF
  // WEBP = RIFF 容器 + offset 8..12 'WEBP'（收窄 · 见文件头）
  {
    ext: 'webp',
    magic: [0x52, 0x49, 0x46, 0x46], // 'RIFF'
    extra: { offset: 8, bytes: [0x57, 0x45, 0x42, 0x50] }, // 'WEBP'
  },
];

const CONTENT_TYPE_MAP: Readonly<Record<ImageExt, string>> = {
  jpg: 'image/jpeg',
  png: 'image/png',
  gif: 'image/gif',
  webp: 'image/webp',
};

function matchesAt(buf: Buffer, bytes: readonly number[], offset: number): boolean {
  if (buf.length < offset + bytes.length) return false;
  for (let i = 0; i < bytes.length; i++) {
    if (buf[offset + i] !== bytes[i]) return false;
  }
  return true;
}

/**
 * 从 Buffer 头部字节检测图片类型，返回扩展名；不匹配（或字节不足）返回 null。
 */
export function detectExt(head: Buffer): ImageExt | null {
  for (const rule of MAGIC_MAP) {
    if (!matchesAt(head, rule.magic, 0)) continue;
    if (rule.extra && !matchesAt(head, rule.extra.bytes, rule.extra.offset)) continue;
    return rule.ext;
  }
  return null;
}

/**
 * ext → Content-Type（putObject 元数据 · D2 去后缀后是对象类型信息的唯一载体）。
 */
export function extToContentType(ext: ImageExt): string {
  return CONTENT_TYPE_MAP[ext];
}
