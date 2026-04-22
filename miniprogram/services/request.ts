// services/request.ts · 统一请求层（Token 注入 + 错误映射 + 自动续签）
// 卡号: COSTRA-030 · 对齐: OpenAPI server/api/openapi.yaml · ADR-0004 §3
import { getEnv } from './env';
import { getToken, refreshToken, clearToken } from './auth';

export interface ApiError extends Error {
  code: string;
  status: number;
  traceId?: string;
  details?: unknown;
}

export interface RequestOptions {
  method?: 'GET' | 'POST' | 'PUT' | 'DELETE';
  path: string;
  query?: Record<string, string | number | boolean | undefined>;
  body?: unknown;
  timeout?: number;
  auth?: boolean; // 默认 true
  retried?: boolean; // 内部使用，避免续签后再续签
}

export async function request<T = unknown>(opts: RequestOptions): Promise<T> {
  const env = getEnv();
  const url = buildUrl(env.apiBaseUrl, opts.path, opts.query);
  const header: Record<string, string> = {
    'Content-Type': 'application/json',
    'Accept': 'application/json'
  };
  if (opts.auth !== false) {
    const token = getToken();
    if (token) header['Authorization'] = `Bearer ${token.access}`;
  }

  return new Promise<T>((resolve, reject) => {
    wx.request({
      url,
      method: opts.method || 'GET',
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

        // 401 且未重试过 → 尝试续签后重放
        if (status === 401 && opts.auth !== false && !opts.retried) {
          try {
            await refreshToken();
            const retried = await request<T>({ ...opts, retried: true });
            resolve(retried);
          } catch (e) {
            clearToken();
            wx.reLaunch({ url: '/pages/login/index' });
            reject(toApiError(status, body));
          }
          return;
        }

        reject(toApiError(status, body));
      },
      fail: (err) => {
        const e = new Error(err.errMsg) as ApiError;
        e.code = 'NETWORK_ERROR';
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

function toApiError(status: number, body: any): ApiError {
  const e = new Error(body?.error?.message || `HTTP ${status}`) as ApiError;
  e.code = body?.error?.code || `HTTP_${status}`;
  e.status = status;
  e.traceId = body?.error?.traceId;
  e.details = body?.error?.details;
  return e;
}
