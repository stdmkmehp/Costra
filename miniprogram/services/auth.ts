// services/auth.ts · 登录闭环（真实链路 + Mock 降级）
// 卡号: COSTRA-102（重写）· 原骨架: COSTRA-030
// 契约事实源: server/api/openapi.yaml #/components/schemas/AuthTokenPair
// 上游派单: .team/dispatch/COSTRA-102-miniapp-login-e2e.md §D2.2
// 承接 COSTRA-118 路径 A: E.P0-1（code 日志脱敏）/ E.P0-2（TokenRaw 字段对齐）/ E.P0-3（refresh body 字段名）
import { getEnv } from './env';
import { setItem, getItem, removeItem } from './storage';

const TOKEN_KEY = '__costra_token_v1';
const REFRESH_WINDOW_MS = 5 * 60 * 1000; // 距过期 < 5 分钟触发续签

/**
 * 服务端返回的 Token 结构（OpenAPI AuthTokenPair）
 * P0-2：字段名与 snake_case 事实源 1:1 对齐；不再使用 access/refresh/expiresAt 别名
 */
export interface TokenRaw {
  access_token: string;
  refresh_token: string;
  access_token_ttl_sec: number;
  refresh_token_ttl_sec: number;
  user: {
    id: string;
    nickname: string;
    avatar_url: string | null;
  };
}

/**
 * 本地持久化结构：raw + 已解算的过期绝对时间
 * 用 epoch ms 判断过期；raw 保留原样以便续签与审计
 */
export interface TokenStored {
  raw: TokenRaw;
  access_expires_at: number;  // epoch ms
  refresh_expires_at: number; // epoch ms
}

/**
 * 运行时 Token（stored + 行为方法），供 app.ts / request.ts 使用
 */
export interface Token extends TokenStored {
  shouldRefresh(): boolean;
  refreshFn(): Promise<void>;
}

let current: Token | null = null;

function wrap(stored: TokenStored): Token {
  return {
    ...stored,
    shouldRefresh() {
      return Date.now() > this.access_expires_at - REFRESH_WINDOW_MS;
    },
    async refreshFn() {
      await refreshToken();
    }
  };
}

function buildStored(raw: TokenRaw): TokenStored {
  const now = Date.now();
  return {
    raw,
    access_expires_at: now + raw.access_token_ttl_sec * 1000,
    refresh_expires_at: now + raw.refresh_token_ttl_sec * 1000
  };
}

export async function initAuth(): Promise<void> {
  const saved = getItem<TokenStored>(TOKEN_KEY);
  if (saved && saved.access_expires_at > Date.now()) {
    current = wrap(saved);
    return;
  }
  // 无 token 或已过期 → 待页面层触发 wx.login（见 pages/login）
  current = null;
}

export function isLoggedIn(): boolean {
  return !!current && current.access_expires_at > Date.now();
}

/** 页面层门面别名：Sprint-0 骨架阶段等同 isLoggedIn */
export function hasValidSession(): boolean {
  return isLoggedIn();
}

export function getToken(): Token | null {
  return current;
}

/**
 * 页面层门面：返回当前会话（包含用户画像，来源 AuthTokenPair.user）
 * P1-4: 后续若需扩展 /users/me 在线画像，由 COSTRA-103 承接
 */
export function getSession(): {
  user: { nickname: string; avatarUrl: string | null } | null;
  token: Token | null;
} | null {
  if (!current) return null;
  const u = current.raw.user;
  return {
    user: {
      nickname: u.nickname || '',
      avatarUrl: u.avatar_url
    },
    token: current
  };
}

export function clearToken(): void {
  current = null;
  removeItem(TOKEN_KEY);
}

/**
 * 页面层门面：退出登录
 * P0 行为：先尝试真调 POST /auth/logout（204），无论成功失败都清本地并跳登录页。
 * 故意不 throw：退出登录语义上必须成功。
 */
export async function logout(): Promise<void> {
  const env = getEnv();
  const had = !!current;

  if (had && !env.mockLogin) {
    try {
      const { request } = await import('./request');
      await request<void>({
        method: 'POST',
        path: '/auth/logout',
        auth: true,
        timeout: 5_000
      });
    } catch (e) {
      // 吞错：退出本地即可，服务端幂等由 /auth/logout 保证
      console.warn('[auth] logout remote call failed, continue local clean', e);
    }
  }

  clearToken();
  try {
    wx.reLaunch({ url: '/pages/login/index' });
  } catch {
    // 单测 / 非 wx 环境下忽略
  }
}

/**
 * 用户点登录按钮 → 拉起 wx.login → 交换服务端 token
 * E.P0-1: 日志脱敏 · 不记录 code 任何片段（仅记长度）
 */
export async function doWxLogin(): Promise<Token> {
  const env = getEnv();

  const { code } = await wxLoginAsync();
  // P0-1 敏感值红线：不记录 code 任何片段（长度仅用于排障）
  console.info('[auth] wx.login ok', { codeLen: code.length });

  if (env.mockLogin) {
    const mock = mockExchange(code);
    const stored = buildStored(mock);
    current = wrap(stored);
    setItem(TOKEN_KEY, stored);
    return current;
  }

  // 真实链路（Backend OpenAPI: POST /v1/auth/wx-login）
  const { request } = await import('./request');
  const resp = await request<TokenRaw>({
    method: 'POST',
    path: '/auth/wx-login',
    body: { code },
    auth: false
  });
  const stored = buildStored(resp);
  current = wrap(stored);
  setItem(TOKEN_KEY, stored);
  return current;
}

/** 页面层门面：整体登录流程（login 页直接调用） */
export async function loginFlow(): Promise<Token> {
  return doWxLogin();
}

/**
 * 续签 access_token
 * P0-3: body 字段名 `refresh_token` 对齐 OpenAPI /auth/refresh requestBody
 */
export async function refreshToken(): Promise<void> {
  if (!current) throw new Error('NO_TOKEN');
  const env = getEnv();
  if (env.mockLogin) {
    const refreshed = mockExchange('refresh', current.raw.refresh_token);
    const stored = buildStored(refreshed);
    current = wrap(stored);
    setItem(TOKEN_KEY, stored);
    return;
  }
  const { request } = await import('./request');
  const resp = await request<TokenRaw>({
    method: 'POST',
    path: '/auth/refresh',
    body: { refresh_token: current.raw.refresh_token },
    auth: false
  });
  const stored = buildStored(resp);
  current = wrap(stored);
  setItem(TOKEN_KEY, stored);
}

// ---- helpers ----

function wxLoginAsync(): Promise<{ code: string }> {
  return new Promise((resolve, reject) => {
    wx.login({
      success: (res) => resolve({ code: res.code }),
      fail: reject
    });
  });
}

/**
 * 单测 / dev mockLogin 下的假 TokenRaw
 * 不对外导出；签名对齐 TokenRaw 以保证切换真实链路零类型改动
 */
function mockExchange(_code: string, oldRefresh?: string): TokenRaw {
  const seed = Date.now().toString(36);
  return {
    access_token: `mock.access.${seed}`,
    refresh_token: oldRefresh || `mock.refresh.${seed}`,
    access_token_ttl_sec: 60 * 60,      // 1h
    refresh_token_ttl_sec: 30 * 24 * 3600, // 30d
    user: {
      id: `mock-user-${seed.slice(0, 4)}`,
      nickname: '测试用户',
      avatar_url: null
    }
  };
}

// ---- testing-only exports ----
// 仅供单测重置内存态；生产代码不应调用
export const __test__ = {
  reset(): void { current = null; },
  setCurrent(stored: TokenStored): void { current = wrap(stored); },
  buildStored
};
