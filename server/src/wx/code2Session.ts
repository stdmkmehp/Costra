/**
 * Costra · Server · 微信 code2Session 上游客户端
 *
 * 卡号：COSTRA-101 · 事实源：https://developers.weixin.qq.com/miniprogram/dev/api-backend/open-api/login/auth.code2Session.html
 *
 * 职责：
 *   - 发起 HTTPS GET 到 `jscode2session`，解析 openid / session_key / unionid(可选)
 *   - 微信错误码 errcode != 0 时，把它归类为 AppError：
 *       * 40029 invalid code  → WX_CODE_INVALID
 *       * 40163 code 已用过   → WX_CODE_INVALID
 *       * 45011 频率限制      → RATE_LIMITED（Retry-After 建议 60s）
 *       * 其他非 0            → UNAVAILABLE（上游暂不可用）
 *   - 网络异常（fetch 抛错 / 超时）→ UNAVAILABLE
 *
 * 测试策略：
 *   - 单测通过 `setWxFetchForTests(mockFetch)` 注入伪 fetch；
 *   - 不依赖真实网络；避免把 JWT_SECRET / AppSecret 泄露到 CI 日志。
 */

import { appEnv } from '../config/env.js';
import { AppError } from '../errors/AppError.js';
import { ErrorCode } from '../errors/ErrorCode.js';

/** 微信 code2Session 成功响应字段子集（仅本业务使用项）。 */
export interface Code2SessionResult {
  openid: string;
  session_key: string;
  unionid?: string;
}

/** 微信上游原始响应（errcode=0 时有 openid/session_key；非 0 时有 errcode/errmsg）。 */
interface RawResponse {
  openid?: string;
  session_key?: string;
  unionid?: string;
  errcode?: number;
  errmsg?: string;
}

type FetchLike = typeof fetch;

let _fetch: FetchLike = globalThis.fetch;

/** 仅用于测试：替换 fetch 实现（内存 mock）。 */
export function setWxFetchForTests(f: FetchLike): void {
  _fetch = f;
}

/** 恢复默认 fetch（测试 afterEach 用）。 */
export function __resetWxFetchForTests(): void {
  _fetch = globalThis.fetch;
}

function mapWxErrorToAppError(errcode: number, errmsg: string | undefined): AppError {
  const msg = errmsg ?? `wx upstream errcode=${errcode}`;
  switch (errcode) {
    case 40029:
    case 40163:
      return new AppError(ErrorCode.WX_CODE_INVALID, {
        message: msg,
        details: { errcode, errmsg },
      });
    case 45011:
      return new AppError(ErrorCode.RATE_LIMITED, {
        message: msg,
        details: { errcode, errmsg, upstream: 'wechat' },
        retryAfterSec: 60,
      });
    default:
      return new AppError(ErrorCode.UNAVAILABLE, {
        message: msg,
        details: { errcode, errmsg, upstream: 'wechat' },
      });
  }
}

/**
 * 用微信 code 换 openid/session_key。
 * @param code 小程序 wx.login() 返回的 code
 * @param timeoutMs 上游超时（默认 5s）
 */
export async function code2Session(code: string, timeoutMs = 5_000): Promise<Code2SessionResult> {
  if (!code || typeof code !== 'string') {
    throw new AppError(ErrorCode.INVALID_ARGUMENT, {
      message: 'code must be non-empty string',
      details: { field: 'code' },
    });
  }

  const env = appEnv();
  const url =
    `${env.wxCode2SessionUrl}` +
    `?appid=${encodeURIComponent(env.wxAppId)}` +
    `&secret=${encodeURIComponent(env.wxAppSecret)}` +
    `&js_code=${encodeURIComponent(code)}` +
    `&grant_type=authorization_code`;

  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);

  let raw: RawResponse;
  try {
    const resp = await _fetch(url, { method: 'GET', signal: ctrl.signal });
    if (!resp.ok) {
      throw new AppError(ErrorCode.UNAVAILABLE, {
        message: `wx upstream http ${resp.status}`,
        details: { upstream: 'wechat', httpStatus: resp.status },
      });
    }
    raw = (await resp.json()) as RawResponse;
  } catch (err) {
    if (err instanceof AppError) throw err;
    // fetch 抛错（含 AbortError / TypeError）统一归类为 UNAVAILABLE
    throw new AppError(ErrorCode.UNAVAILABLE, {
      message: 'wx upstream fetch failed',
      details: { upstream: 'wechat' },
      cause: err,
    });
  } finally {
    clearTimeout(timer);
  }

  if (raw.errcode != null && raw.errcode !== 0) {
    throw mapWxErrorToAppError(raw.errcode, raw.errmsg);
  }

  if (!raw.openid || !raw.session_key) {
    throw new AppError(ErrorCode.UNAVAILABLE, {
      message: 'wx upstream returned incomplete payload',
      details: { upstream: 'wechat' },
    });
  }

  return {
    openid: raw.openid,
    session_key: raw.session_key,
    unionid: raw.unionid,
  };
}
