// services/auth.ts · 登录闭环
// 卡号: COSTRA-102（重写）· 原骨架: COSTRA-030
// COSTRA-125: storage async 迁移 · R1 漏网点 auth.ts:70 `getItem(TOKEN_KEY)` 改 await · initAuth/doWxLogin/refreshToken/clearToken 全链 async 对齐
// COSTRA-165: TokenRaw 协议对齐（expires_in required + user 子字段 + default_family_id/ledger_id）+ login/logout/initAuth/refresh 接入 family-context
// 契约事实源: server/api/openapi.yaml #/components/schemas/AuthTokenPair
// 上游派单: .team/dispatch/COSTRA-102-miniapp-login-e2e.md §D2.2 · .team/dispatch/COSTRA-125-miniapp-storage-async-migration.md §3 (b)
// 承接 COSTRA-118 路径 A: E.P0-1（code 日志脱敏）/ E.P0-2（TokenRaw 字段对齐）/ E.P0-3（refresh body 字段名）
import { setItem, getItem, removeItem } from './storage';
import { request } from './request';
import { setActiveFamily, getActiveFamilyId, getActiveLedgerId, fetchAndRestorePreference, restoreActiveFamilyAfterLogin, flushPendingPreference } from './family';
import { TOKEN_KEY, DEVICE_FP_KEY } from './storageKeys';
import { logger } from '../utils/logger';

const REFRESH_WINDOW_MS = 5 * 60 * 1000; // 距过期 < 5 分钟触发续签

/**
 * 服务端返回的 Token 结构（OpenAPI AuthTokenPair）
 * P0-2：字段名与 snake_case 事实源 1:1 对齐；不再使用 access/refresh/expiresAt 别名
 * COSTRA-165 P1-3：expires_in required + user 子字段补齐 + default_family_id/ledger_id
 */
export interface TokenRaw {
  access_token: string;
  refresh_token: string;
  access_token_ttl_sec: number;
  refresh_token_ttl_sec: number;
  // P1-3 新增（与 server required 对齐 · OpenAPI deprecated 兼容字段）：
  expires_in: number;
  user: {
    id: string;
    nickname: string;
    avatar_url: string | null;
    has_completed_profile: boolean;   // COSTRA-158: 严格资料判定字段
    // P1-3 新增（v1.1 · 与 server toUserView() 返回 1:1 对齐 · COSTRA-118 P0-2 红线）：
    timezone: string;
    created_at: string;  // ISO-8601 UTC
    updated_at: string;  // ISO-8601 UTC
  };

  // COSTRA-164 协议 · 已稳定 · authService.ts L207-208 + L275-276
  default_family_id: string;
  default_ledger_id: string;
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
/**
 * 登录态世代号：每次本地会话被替换或清空都递增。
 * 用于防止旧的 in-flight refresh 响应在 logout / 新登录之后反写覆盖当前状态。
 */
let authEpoch = 0;

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

function replaceCurrent(stored: TokenStored): Token {
  current = wrap(stored);
  authEpoch += 1;
  return current;
}

function isRefreshStillCurrent(epoch: number, refreshToken: string): boolean {
  return !!current && authEpoch === epoch && current.raw.refresh_token === refreshToken;
}

export async function initAuth(): Promise<void> {
  // COSTRA-125: getItem 已改 async · 必须 await · 否则 saved 是 Promise 永不等于 TokenStored
  const saved = await getItem<TokenStored>(TOKEN_KEY);
  const now = Date.now();
  if (saved && saved.access_expires_at > now) {
    replaceCurrent(saved);
    await restoreFamilyContextForCurrentSession();
    await flushPendingPreference();
    return;
  }

  // access token 过期但 refresh token 仍有效时，冷启动优先静默续签，避免强制重新登录后用旧服务端偏好覆盖本地 context。
  if (saved && saved.refresh_expires_at > now) {
    replaceCurrent(saved);
    try {
      await refreshToken();
      await restoreFamilyContextForCurrentSession();
      await flushPendingPreference();
      return;
    } catch (e) {
      logger.warn('auth', 'initAuth refresh expired access failed', e);
      await clearToken();
      current = null;
      return;
    }
  }

  // 无 token 或 refresh 也过期 → 待页面层触发 wx.login（见 pages/login），保留 family-context 供登录后合并。
  current = null;
}

function syncGlobalActiveLedgerId(ledgerId: string): void {
  const app = getApp();
  if (app?.globalData) {
    app.globalData.activeLedgerId = ledgerId;
  }
}

async function restoreFamilyContextForCurrentSession(): Promise<void> {
  const familyId = await getActiveFamilyId();
  if (!familyId) {
    const restored = await fetchAndRestorePreference();
    const fallback = restored ?? (current?.raw.default_family_id && current.raw.default_ledger_id
      ? {
          family_id: current.raw.default_family_id,
          ledger_id: current.raw.default_ledger_id,
          family_kind: 'personal' as const,
          ledger_name: '个人账本',
        }
      : null);
    if (fallback && !restored) {
      await setActiveFamily(fallback, 'preference-restore');
    }
    if (fallback) {
      const app = getApp();
      if (app?.globalData) {
        app.globalData.activeLedgerId = fallback.ledger_id;
      }
    }
    return;
  }

  const ledgerId = await getActiveLedgerId();
  const app = getApp();
  if (app?.globalData && ledgerId) {
    app.globalData.activeLedgerId = ledgerId;
  }
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
 * 返回当前登录用户 id（无会话时返回 null）。
 * 供 recurring cache / queue 等按用户隔离 storage 使用。
 */
export function getCurrentUserId(): string | null {
  return current?.raw.user?.id ?? null;
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

export async function clearToken(): Promise<void> {
  current = null;
  authEpoch += 1;
  // COSTRA-125: removeItem 已改 async · 调用方 logout() 已 async · 天然兼容
  await removeItem(TOKEN_KEY);
}

/**
 * 页面层门面：退出登录
 * P0 行为：先尝试真调 POST /auth/logout（204），无论成功失败都清本地并跳登录页。
 * 故意不 throw：退出登录语义上必须成功。
 *
 * 本地清理语义 = 「删除小程序重装」：resetLocalData() 全量清空 storage（仅保留设备指纹）
 * + 各模块内存缓存，覆盖 db/outbox/watermark/recurring/family-context/业务缓存。
 * 重新登录后走服务端 preference 恢复账本上下文，本地库经全量 pull 重建。
 *
 * 注意：调用方（如 mine 页 onTapLogout）应在调用 logout 前先执行 syncOnce('hide') + stopScheduler()，
 * 保证用户离开前本地数据尽量上行。此处不直接引入 syncScheduler 以避免循环依赖。
 */
export async function logout(): Promise<void> {
  const had = !!current;

  if (had) {
    try {
      await request<void>({
        method: 'POST',
        path: '/auth/logout',
        body: { refresh_token: current!.raw.refresh_token },
        auth: true,
        timeout: 5_000
      });
    } catch (e) {
      // 吞错：退出本地即可，服务端幂等由 /auth/logout 保证
      logger.warn('auth', 'logout remote call failed, continue local clean', e);
    }
  }

  const app = getApp();
  if (app?.globalData) {
    app.globalData.activeLedgerId = undefined;
    // 主动登出标志：login 页 onLoad 读到即清零，跳过自动静默登录（避免登出后被立刻拉回）
    app.globalData.userLoggedOut = true;
  }

  // 先清登录态内存（current=null + authEpoch 递增，阻断在途 refresh 反写），再全量重置本地数据。
  // 动态引入 localReset 以避免循环依赖（localReset → *Api → request → auth）。
  await clearToken();
  try {
    const { resetLocalData } = await import('./localReset');
    await resetLocalData();
  } catch (err) {
    logger.warn('auth', 'reset local data on logout failed', err);
  }

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
  const { code } = await wxLoginAsync();
  // P0-1 敏感值红线：不记录 code 任何片段（长度仅用于排障）
  logger.info('auth', 'wx.login ok', { codeLen: code.length });

  // 携带设备指纹：服务端据此在登录时回收同设备旧会话（允许多设备并存）
  const clientFp = await getOrCreateDeviceFp();
  const resp = await request<TokenRaw>({
    method: 'POST',
    path: '/auth/wx-login',
    body: { code, client_fp: clientFp },
    auth: false
  });
  const stored = buildStored(resp);
  const token = replaceCurrent(stored);
  await setItem(TOKEN_KEY, stored);  // COSTRA-125: async

  // 登录后恢复账本偏好策略：本地完整 active context 优先，服务端 preference 次之，default personal 最后兜底。
  const restored = await restoreActiveFamilyAfterLogin({
    family_id: resp.default_family_id,
    ledger_id: resp.default_ledger_id,
    family_kind: 'personal',
    ledger_name: '个人账本',
  });
  syncGlobalActiveLedgerId(restored.ledger_id);
  await flushPendingPreference();
  logger.info('auth', 'login success · active ledger restored', {
    userId: resp.user.id,
    activeFamilyId: restored.family_id,
    activeLedgerId: restored.ledger_id,
  });
  return token;
}

/**
 * 页面层门面：整体登录流程（login 页 / app.ts bootstrap 均调用）。
 * in-flight 去重：app.ts bootstrap 与 login 页 onLoad 可能并发触发；同一时刻只允许一次
 *   wx.login → wx-login，避免同一次启动内建立多个 user_sessions（历史"10s 成对会话"根因）。
 */
let loginInflight: Promise<Token> | null = null;
export function loginFlow(): Promise<Token> {
  if (loginInflight) return loginInflight;
  loginInflight = doWxLogin().finally(() => { loginInflight = null; });
  return loginInflight;
}

/**
 * 续签 access_token（对外入口 · in-flight 去重）。
 * 多个并发 401 请求会各调一次续签；此处保证同一时刻只发一次 /auth/refresh，
 *   并让所有并发调用复用同一结果。
 */
let refreshInflight: Promise<void> | null = null;
export function refreshToken(): Promise<void> {
  if (refreshInflight) return refreshInflight;
  refreshInflight = doRefreshToken().finally(() => { refreshInflight = null; });
  return refreshInflight;
}

/**
 * 续签实现体
 * P0-3: body 字段名 `refresh_token` 对齐 OpenAPI /auth/refresh requestBody
 */
async function doRefreshToken(): Promise<void> {
  if (!current) throw new Error('NO_TOKEN');
  const epochAtStart = authEpoch;
  const refreshTokenAtStart = current.raw.refresh_token;
  const resp = await request<TokenRaw>({
    method: 'POST',
    path: '/auth/refresh',
    body: { refresh_token: refreshTokenAtStart },
    auth: false
  });
  const stored = buildStored(resp);
  if (!isRefreshStillCurrent(epochAtStart, refreshTokenAtStart)) {
    logger.warn('auth', 'stale refresh response ignored');
    return;
  }
  replaceCurrent(stored);
  await setItem(TOKEN_KEY, stored);  // COSTRA-125: async

  // refreshToken 只负责续签 token；active family 恢复由 initAuth/doWxLogin 的 restore 流程统一处理。
  // 这样 access 过期冷启动时不会先写 default personal，从而跳过服务端 preference 恢复。
}

// ---- helpers ----

/**
 * 取（或首次生成并持久化）设备指纹。
 * 小程序拿不到真实设备唯一 ID（隐私限制），这里生成一个稳定的随机标识代表
 *   "本设备上的本安装实例"，持久化于 storage（DEVICE_FP_KEY）。
 * 该 key 在 storage 版本迁移时受白名单保护（storageKeys.PRESERVED_KEYS），故跨升级稳定。
 */
async function getOrCreateDeviceFp(): Promise<string> {
  const existing = await getItem<string>(DEVICE_FP_KEY);
  if (existing) return existing;
  const fp = genDeviceFp();
  await setItem(DEVICE_FP_KEY, fp);
  return fp;
}

/** 生成设备指纹：时间基 + 随机段（非加密用途 · 仅需足够唯一且持久） */
function genDeviceFp(): string {
  const ts = Date.now().toString(36);
  const rand = Math.random().toString(36).slice(2, 10) + Math.random().toString(36).slice(2, 10);
  return `df_${ts}_${rand}`;
}

function wxLoginAsync(): Promise<{ code: string }> {
  return new Promise((resolve, reject) => {
    wx.login({
      success: (res) => resolve({ code: res.code }),
      fail: reject
    });
  });
}

// ---- COSTRA-158 §2.4: PATCH 成功后本地更新 user 子对象 ----

/**
 * PATCH /users/me 成功后更新本地 TokenRaw.user 子对象 + storage
 * 不改 token 本身（access_token / refresh_token 不变）
 * dispatch §2.4 client 消费策略 · P1-1 修订产物
 */
export async function updateLocalUserProfile(
  partial: Partial<{
    nickname: string;
    avatar_url: string | null;
    has_completed_profile: boolean;
  }>,
): Promise<void> {
  if (!current) return;
  Object.assign(current.raw.user, partial);
  // storage 写入 · 走 storage.ts envelope · 与 initAuth/doWxLogin/refreshToken 一致
  // R1.x.1（COSTRA-158 BUG fix · 2026-05-19）：原 wx.setStorageSync 写裸对象 · 破坏
  // storage envelope 一致性 · 重启后 initAuth getItem 读不到（env.d undefined）
  await setItem<TokenStored>(TOKEN_KEY, {
    raw: current.raw,
    access_expires_at: current.access_expires_at,
    refresh_expires_at: current.refresh_expires_at,
  });
}

// ---- testing-only exports ----
// 仅供单测重置内存态；生产代码不应调用
export const __test__ = {
  reset(): void {
    current = null;
    authEpoch += 1;
    loginInflight = null;
    refreshInflight = null;
  },
  setCurrent(stored: TokenStored): void { replaceCurrent(stored); },
  buildStored
};
