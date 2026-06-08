// utils/id.ts · 客户端 ID 生成工具
// 卡号: COSTRA-103（Epic-C 主线 · R1 · SBAI 第 7 次冒烟）
// Refs: id-strategy.md §2.5（client_ref_id UUID v4）/ §3.1（Idempotency-Key UUID v4）

/**
 * 生成 client_ref_id（UUID v4）
 * 用途：离线本地主键 + sync_push client_ref_id
 * Refs: id-strategy.md §2.5
 */
export function newClientRefId(): string {
  // 使用 Math.random 降级（微信基础库 2.20+ 支持 crypto.getRandomValues）
  const bytes = new Uint8Array(16);
  const rnd = () => Math.random() * 16 | 0;
  bytes[0] = rnd(); bytes[1] = rnd(); bytes[2] = rnd(); bytes[3] = rnd();
  bytes[4] = rnd(); bytes[5] = rnd();
  bytes[6] = (rnd() & 0x0f) | 0x40; // v4 variant
  bytes[7] = rnd(); bytes[8] = rnd(); bytes[9] = rnd();
  bytes[10] = rnd(); bytes[11] = rnd(); bytes[12] = rnd();
  bytes[13] = rnd(); bytes[14] = rnd(); bytes[15] = rnd();
  bytes[8] = (bytes[8] & 0x3f) | 0x80; // variant bits

  const hex = Array.from(bytes).map(b => b.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

/**
 * 生成 Idempotency-Key（UUID v4 · 每个写请求/批次独立）
 * 用途：HTTP 请求头 + outbox 持久化 key · 重试复用
 * Refs: id-strategy.md §3.1
 */
export function newIdempotencyKey(): string {
  return newClientRefId(); // 两者同规格（都是 UUID v4）· 仅用途语义不同
}
