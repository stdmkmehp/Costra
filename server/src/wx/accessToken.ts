/**
 * Costra · Server · 微信 stable_token 管理（getStableAccessToken）
 *
 * 事实源：docs/design/monetization-tipping-tech-spec.md v1.2 §2.6
 *
 * 行为：
 *   - Redis 缓存 `cache:v1:wx:access-token`，TTL = expires_in - 300s（提前 300s 过期）；
 *     Redis 不可用时进程内缓存兜底（同 TTL 语义）。
 *   - 并发控制：一把进程内 Promise 单飞锁；不做 generation 防覆盖；
 *     并行 forceRefresh 调用共享同一个取票数 Promise（去重）。
 *   - body 含 force_refresh 字段，取值与入参一致（官方稳定版接口字段）。
 *   - query_order 收到 40001 / 42001 时由调用方以 forceRefresh=true 重试一次（本模块不管重试策略）。
 *
 * 安全：AppSecret 在 body 不在 URL（不沿 URL 日志泄露）；日志不记 access_token。
 */

import { appEnv } from '../config/env.js';
import { getRedis } from '../db/redis.js';
import { WX_STABLE_TOKEN_URL } from './endpoints.js';

const REDIS_KEY = 'cache:v1:wx:access-token';
/** 提前刷新余量（秒）：避免临界点取到秒级过期票 */
const REFRESH_MARGIN_SEC = 300;

interface StableTokenResponse {
  access_token?: string;
  expires_in?: number;
  errcode?: number;
  errmsg?: string;
}

interface MemoryEntry {
  token: string;
  /** epoch ms · 到期时刻 */
  expiresAt: number;
}

type FetchLike = typeof fetch;

let _fetch: FetchLike = globalThis.fetch;
let _memory: MemoryEntry | null = null;
/** 单飞 Promise：所有并发调用（含 forceRefresh）共享同一次取票数 */
let _inflight: Promise<string> | null = null;

/** 仅用于测试：替换 fetch 实现。 */
export function setAccessTokenFetchForTests(f: FetchLike): void {
  _fetch = f;
}

/** 测试 afterEach：恢复 fetch + 清空进程内缓存与单飞态。 */
export function __resetAccessTokenForTests(): void {
  _fetch = globalThis.fetch;
  _memory = null;
  _inflight = null;
}

async function readCache(): Promise<string | null> {
  try {
    const raw = await getRedis().get(REDIS_KEY);
    if (raw) return raw;
  } catch {
    // Redis 异常降级进程内缓存
  }
  if (_memory && _memory.expiresAt > Date.now()) return _memory.token;
  return null;
}

async function writeCache(token: string, expiresIn: number): Promise<void> {
  const ttlSec = Math.max(expiresIn - REFRESH_MARGIN_SEC, 1);
  _memory = { token, expiresAt: Date.now() + ttlSec * 1000 };
  try {
    await getRedis().set(REDIS_KEY, token, 'EX', ttlSec);
  } catch {
    // Redis 写失败不阻断：进程内缓存已生效
  }
}

async function fetchStableToken(forceRefresh: boolean): Promise<string> {
  const env = appEnv();
  const resp = await _fetch(WX_STABLE_TOKEN_URL, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    // 与 virtualPayClient 同一超时范式：stable_token 挂起不得永久卡住对账调度器 tick
    signal: AbortSignal.timeout(5_000),
    body: JSON.stringify({
      grant_type: 'client_credential',
      appid: env.wxAppId,
      secret: env.wxAppSecret,
      force_refresh: forceRefresh,
    }),
  });
  if (!resp.ok) {
    throw new Error(`[accessToken] wx stable_token http ${resp.status}`);
  }
  const raw = (await resp.json()) as StableTokenResponse;
  if (raw.errcode != null && raw.errcode !== 0) {
    throw new Error(`[accessToken] wx stable_token errcode=${raw.errcode} errmsg=${raw.errmsg ?? ''}`);
  }
  if (!raw.access_token || typeof raw.expires_in !== 'number') {
    throw new Error('[accessToken] wx stable_token returned incomplete payload');
  }
  await writeCache(raw.access_token, raw.expires_in);
  return raw.access_token;
}

/**
 * 取微信 access_token。
 * @param forceRefresh true 时无视缓存强制取新票（query_order 40001/42001 专用路径）；
 *                     并行调用共享同一个取票数 Promise（不做 generation 防覆盖）。
 */
export async function getAccessToken(forceRefresh: boolean): Promise<string> {
  if (!forceRefresh) {
    const cached = await readCache();
    if (cached) return cached;
  }
  if (_inflight) return _inflight;
  _inflight = fetchStableToken(forceRefresh).finally(() => {
    _inflight = null;
  });
  return _inflight;
}
