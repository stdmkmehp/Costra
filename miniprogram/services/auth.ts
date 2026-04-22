// services/auth.ts · 登录闭环（Mock 模式 + 真机切换位）
// 卡号: COSTRA-030 · ADR-0004 §3 · AC-2
import { getEnv } from './env';
import { setItem, getItem, removeItem } from './storage';

const TOKEN_KEY = '__costra_token_v1';
const REFRESH_WINDOW_MS = 5 * 60 * 1000; // 距过期 < 5 分钟触发续签

export interface TokenRaw {
  access: string;
  refresh: string;
  expiresAt: number; // epoch ms
  userId: string;
}

export interface Token extends TokenRaw {
  shouldRefresh(): boolean;
  refreshFn(): Promise<void>;
}

let current: Token | null = null;

function wrap(raw: TokenRaw): Token {
  return {
    ...raw,
    shouldRefresh() {
      return Date.now() > this.expiresAt - REFRESH_WINDOW_MS;
    },
    async refreshFn() {
      await refreshToken();
    }
  };
}

export async function initAuth(): Promise<void> {
  const saved = getItem<TokenRaw>(TOKEN_KEY);
  if (saved && saved.expiresAt > Date.now()) {
    current = wrap(saved);
    return;
  }
  // 无 token 或已过期 → 待页面层触发 wx.login（见 pages/login）
  current = null;
}

export function isLoggedIn(): boolean {
  return !!current && current.expiresAt > Date.now();
}

/** 页面层门面别名：Sprint-0 骨架阶段等同 isLoggedIn */
export function hasValidSession(): boolean {
  return isLoggedIn();
}

export function getToken(): Token | null {
  return current;
}

/** 页面层门面：返回当前会话（骨架阶段用户信息为空，COSTRA-11x 补齐 profile 拉取） */
export function getSession(): { user: { nickname: string; avatarUrl: string } | null; token: Token | null } | null {
  if (!current) return null;
  return {
    user: null, // TODO(COSTRA-11x): GET /v1/users/me
    token: current
  };
}

export function clearToken(): void {
  current = null;
  removeItem(TOKEN_KEY);
}

/** 页面层门面：退出登录 */
export function logout(): void {
  clearToken();
}

/**
 * 用户点登录按钮 → 拉起 wx.login → 交换服务端 token
 * AC-2: dev 环境使用 Mock；staging/prod 调真实后端。
 */
export async function doWxLogin(): Promise<Token> {
  const env = getEnv();

  const { code } = await wxLoginAsync();
  console.info('[auth] wx.login code=', code.slice(0, 8) + '...');

  if (env.mockLogin) {
    const mock = mockExchange(code);
    current = wrap(mock);
    setItem(TOKEN_KEY, mock);
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
  current = wrap(resp);
  setItem(TOKEN_KEY, resp);
  return current;
}

/** 页面层门面：整体登录流程（login 页直接调用） */
export async function loginFlow(): Promise<Token> {
  return doWxLogin();
}

export async function refreshToken(): Promise<void> {
  if (!current) throw new Error('NO_TOKEN');
  const env = getEnv();
  if (env.mockLogin) {
    const refreshed = mockExchange(current.access, current.refresh);
    current = wrap(refreshed);
    setItem(TOKEN_KEY, refreshed);
    return;
  }
  const { request } = await import('./request');
  const resp = await request<TokenRaw>({
    method: 'POST',
    path: '/auth/refresh',
    body: { refresh: current.refresh },
    auth: false
  });
  current = wrap(resp);
  setItem(TOKEN_KEY, resp);
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

function mockExchange(code: string, oldRefresh?: string): TokenRaw {
  const now = Date.now();
  return {
    access: `mock.access.${code.slice(0, 6)}.${now}`,
    refresh: oldRefresh || `mock.refresh.${code.slice(0, 6)}.${now}`,
    expiresAt: now + 60 * 60 * 1000, // 1h
    userId: `mock-user-${code.slice(0, 4)}`
  };
}
