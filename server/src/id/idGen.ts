/**
 * Costra · Server · UUID v7 生成器
 *
 * 卡号：COSTRA-101 · 依据：ADR-0006 §5 · uuidv7 应用层生成
 *
 * 统一出口：业务层只 import `newId()` / `newJti()`，不直接依赖 npm `uuidv7`。
 * 便于未来如需切换 ULID / Snowflake，一处替换即可。
 */

import { uuidv7 } from 'uuidv7';

/** 生成新的 UUID v7 字符串（RFC 4122 / draft）。 */
export function newId(): string {
  return uuidv7();
}

/** 专用于 JWT jti 的独立入口；当前等价于 newId()，保留独立 API 以便未来差异化（如 jti 短化）。 */
export function newJti(): string {
  return uuidv7();
}
