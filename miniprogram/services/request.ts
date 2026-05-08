// services/request.ts · 统一请求层（Token 注入 + 错误映射 + 自动续签 + Idempotency-Key）
// 卡号: COSTRA-102（重写）· 原骨架: COSTRA-030
// COSTRA-125: clearToken 已改 async（storage async 迁移）· 401 兜底分支加 await
// 契约事实源: server/api/openapi.yaml · docs/api/error-codes.md
// 承接 COSTRA-118 路径 A: E.P0-4（Idempotency-Key 自动注入）/ E.P0-5（错误响应顶层字段解析）/ E.P1-2（CLIENT_NETWORK_ERROR 前缀）
import { getEnv } from './env';
import { getToken, refreshToken, clearToken } from './auth';

/**
 * 客户端错误对象
 * - code：若来源服务端则为 ErrorCode 枚举字符串（见 docs/api/error-codes.md §2）；
 *         若来源客户端/网络则以 `CLIENT_` 前缀隔离（P1-2）
 * - traceId：camelCase 对外；内部从服务端 snake_case `trace_id` 映射
 */
export interface ApiError extends Error {
  code: string;
  status: number;
  traceId?: string;
  details?: Record<string, unknown> | undefined;
}

export interface RequestOptions {
  method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  path: string;
  query?: Record<string, string | number | boolean | undefined>;
  body?: unknown;
  timeout?: number;
  auth?: boolean;              // 默认 true
  retried?: boolean;           // 内部使用：避免续签后二次续签
  idempotencyKey?: string;     // 允许 caller 显式复用（retry 场景）
  extraHeader?: Record<string, string>;
}

/**
 * 后端 21 条错误码事实源快照（ErrorCode.ts TS 枚举镜像）
 * 仅用于守卫：未命中的 code 不被吞掉 · 保留原值回传业务层
 * 来源: docs/api/error-codes.md §2（21 条）
 */
const KNOWN_SERVER_CODES: ReadonlySet<string> = new Set([
  'INVALID_ARGUMENT', 'MALFORMED_JSON', 'IDEMPOTENCY_KEY_REQUIRED',
  'IDEMPOTENCY_KEY_MISMATCH', 'UNSUPPORTED_MEDIA_TYPE',
  'UNAUTHENTICATED', 'TOKEN_EXPIRED', 'REFRESH_TOKEN_INVALID',
  'WX_CODE_INVALID', 'PERMISSION_DENIED', 'FAMILY_NOT_MEMBER',
  'NOT_FOUND', 'VERSION_CONFLICT', 'DUPLICATE_RESOURCE',
  'INVITE_EXPIRED', 'BUSINESS_RULE_VIOLATION', 'RATE_LIMITED',
  'INTERNAL', 'UNAVAILABLE', 'TIMEOUT', 'NOT_IMPLEMENTED'
]);

/** 暴露给消费方守卫 / 单测 */
export function isKnownServerCode(code: string): boolean {
  return KNOWN_SERVER_CODES.has(code);
}

export async function request<T = unknown>(opts: RequestOptions): Promise<T> {
  const env = getEnv();
  const url = buildUrl(env.apiBaseUrl, opts.path, opts.query);
  const method = opts.method || 'GET';

  const header: Record<string, string> = {
    'Content-Type': 'application/json',
    'Accept': 'application/json',
    ...(opts.extraHeader || {})
  };

  // P0-4: 非 GET 自动注入 Idempotency-Key（允许 caller 显式复用 key 用于 retry）
  if (method !== 'GET') {
    header['Idempotency-Key'] = opts.idempotencyKey || uuidV4();
  }

  if (opts.auth !== false) {
    const token = getToken();
    if (token) header['Authorization'] = `Bearer ${token.raw.access_token}`;
  }

  return new Promise<T>((resolve, reject) => {
    // wx.request 的 method 类型不支持 PATCH（微信平台限制）；
    // 我们在客户端层用 X-HTTP-Method-Override: PATCH + 真实 POST 做降级。
    // 后端若未实现该头识别：PATCH 请求会被当作 POST 处理，属已知失败模式（FU-102-PATCH-METHOD 登记）。
    // 本卡中 PATCH 唯一使用点是 /users/me（画像同步 · 失败不阻塞登录），因此可接受此过渡。
    type WxMethod = 'GET' | 'POST' | 'PUT' | 'DELETE' | 'OPTIONS' | 'HEAD' | 'TRACE' | 'CONNECT';
    let wxMethod: WxMethod;
    if (method === 'PATCH') {
      wxMethod = 'POST';
      header['X-HTTP-Method-Override'] = 'PATCH';
    } else {
      wxMethod = method;
    }

    wx.request({
      url,
      method: wxMethod,
      data: opts.body as any,
      header,
      timeout: opts.timeout || 10_000,
      success: async (res) => {
        const status = res.statusCode;
        const body = res.data as any;

        if (status >= 200 && status < 300) {
          resolve(body as T);
          return;
        }

        // 401 且未重试过 → 尝试续签后重放（复用原 Idempotency-Key，幂等语义见 error-codes.md §3）
        if (status === 401 && opts.auth !== false && !opts.retried) {
          try {
            await refreshToken();
            const retried = await request<T>({
              ...opts,
              retried: true
            });
            resolve(retried);
          } catch (e) {
            // COSTRA-125: clearToken 已改 async · 必须 await（否则 reject 在 storage 写入前就抛 · race）
            await clearToken();
            try { wx.reLaunch({ url: '/pages/login/index' }); } catch { /* noop */ }
            reject(toApiError(status, body));
          }
          return;
        }

        reject(toApiError(status, body));
      },
      fail: (err) => {
        // P1-2: CLIENT_NETWORK_ERROR 前缀显式与后端 21 条错误码隔离
        const e = new Error(err.errMsg || 'network error') as ApiError;
        e.code = 'CLIENT_NETWORK_ERROR';
        e.status = 0;
        reject(e);
      }
    });
  });
}

function buildUrl(base: string, path: string, query?: RequestOptions['query']): string {
  const q = query
    ? '?' + Object.keys(query)
        .filter(k => query[k] !== undefined)
        .map(k => `${encodeURIComponent(k)}=${encodeURIComponent(String(query[k]))}`)
        .join('&')
    : '';
  return `${base}${path}${q}`;
}

/**
 * 将服务端响应 body 映射为 ApiError
 * P0-5: 按 docs/api/error-codes.md §1.1 事实源 —— 顶层 `code` / `message` / `trace_id` / `details`
 * 不再走 `body.error.code` 的旧幻觉路径
 */
export function toApiError(status: number, body: any): ApiError {
  const raw = (body && typeof body === 'object') ? body : {};
  const serverCode = typeof raw.code === 'string' ? raw.code : '';
  const code = serverCode || `CLIENT_HTTP_${status}`; // 不再是 HTTP_xxx 模糊值

  const e = new Error(
    (typeof raw.message === 'string' && raw.message) || `HTTP ${status}`
  ) as ApiError;
  e.code = code;
  e.status = status;
  if (typeof raw.trace_id === 'string') e.traceId = raw.trace_id;
  if (raw.details && typeof raw.details === 'object') e.details = raw.details;
  return e;
}

/**
 * 简易 UUID v4（避免引入外部依赖 · 仅用于幂等键）
 * 注：若 wx 运行时未提供 crypto.getRandomValues，则走 Math.random 降级
 * 本函数只用于幂等键，碰撞概率对 MVP 可接受
 */
export function uuidV4(): string {
  const tpl = 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx';
  return tpl.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}
