// services/auth.ts · 登录闭环（真实链路 + Mock 降级）
// 卡号: COSTRA-102（重写）· 原骨架: COSTRA-030
// COSTRA-125: storage async 迁移 · R1 漏网点 auth.ts:70 `getItem(TOKEN_KEY)` 改 await · initAuth/doWxLogin/refreshToken/clearToken 全链 async 对齐
// COSTRA-165: TokenRaw 协议对齐（expires_in required + user 子字段 + default_family_id/ledger_id）+ login/logout/initAuth/refresh 接入 family-context
// 契约事实源: server/api/openapi.yaml #/components/schemas/AuthTokenPair
// 上游派单: .team/dispatch/COSTRA-102-miniapp-login-e2e.md §D2.2 · .team/dispatch/COSTRA-125-miniapp-storage-async-migration.md §3 (b)
// 承接 COSTRA-118 路径 A: E.P0-1（code 日志脱敏）/ E.P0-2（TokenRaw 字段对齐）/ E.P0-3（refresh body 字段名）
import { getEnv } from './env';
import { setItem, getItem, removeItem } from './storage';
import { request } from './request';
import { setActiveFamily, getActiveFamilyId, getActiveLedgerId, clearActiveFamily } from './family';

const TOKEN_KEY = '__costra_token_v1';
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
  // COSTRA-125: getItem 已改 async · 必须 await · 否则 saved 是 Promise 永不等于 TokenStored
  // R2 诊断（2026-05-03）坐实：R1 漏网点 · async function 体内 await 之前的同步代码仍在 onLaunch 栈内执行
  const saved = await getItem<TokenStored>(TOKEN_KEY);
  if (saved && saved.access_expires_at > Date.now()) {
    current = wrap(saved);

    // COSTRA-165 v1.1 P1-1: 旧 token 升级场景 · storage 中无 family-context → 走 refresh 触发刷新（透明无 UX 退化）
    const familyId = await getActiveFamilyId();
    if (!familyId) {
      try {
        await refreshToken();  // refresh response 含 default_family_id/default_ledger_id（authService.ts:275-276）
        // refreshToken 内部已调 setActiveFamily
      } catch (e) {
        // refresh 失败兜底：清 token + 跳登录页（极边缘 · refresh_token 也过期）
        console.warn('[auth] initAuth fallback refresh failed', e);
        await clearToken();
        await clearActiveFamily();
        return;
      }
    } else {
      // 正常路径：family-context 已存在 · 同步 globalData
      const ledgerId = await getActiveLedgerId();
      const app = getApp();
      if (app?.globalData && ledgerId) {
        app.globalData.activeLedgerId = ledgerId;
      }
    }
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

export async function clearToken(): Promise<void> {
  current = null;
  // COSTRA-125: removeItem 已改 async · 调用方 logout() 已 async · 天然兼容
  await removeItem(TOKEN_KEY);
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
      await request<void>({
        method: 'POST',
        path: '/auth/logout',
        body: { refresh_token: current!.raw.refresh_token },
        auth: true,
        timeout: 5_000
      });
    } catch (e) {
      // 吞错：退出本地即可，服务端幂等由 /auth/logout 保证
      console.warn('[auth] logout remote call failed, continue local clean', e);
    }
  }

  // COSTRA-165: 清 family-context + globalData（在 clearToken 之前）
  await clearActiveFamily();
  const app = getApp();
  if (app?.globalData) {
    app.globalData.activeLedgerId = undefined;
  }

  await clearToken();
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
    await setItem(TOKEN_KEY, stored);  // COSTRA-125: async

    // COSTRA-165: mock 路径也写 family-context（让 T7/T8 在 mock 环境可跑 · R2 P2-2 实装期处理）
    await setActiveFamily({
      family_id: mock.default_family_id,
      ledger_id: mock.default_ledger_id,
    });
    const appMock = getApp();
    if (appMock?.globalData) {
      appMock.globalData.activeLedgerId = mock.default_ledger_id;
    }

    console.info('[auth] login success', { userId: mock.user.id, familyId: mock.default_family_id });
    return current;
  }

  // 真实链路（Backend OpenAPI: POST /v1/auth/wx-login）
  const resp = await request<TokenRaw>({
    method: 'POST',
    path: '/auth/wx-login',
    body: { code },
    auth: false
  });
  const stored = buildStored(resp);
  current = wrap(stored);
  await setItem(TOKEN_KEY, stored);  // COSTRA-125: async

  // COSTRA-165: 写 family-context（首登 default_family_id 一定非空 · 后续切 family 时由 R2 UI 覆盖）
  await setActiveFamily({
    family_id: resp.default_family_id,
    ledger_id: resp.default_ledger_id,
  });
  // 同步 globalData.activeLedgerId（pages/entry 直接读 · app.ts L22 字段已声明）
  const app = getApp();
  if (app?.globalData) {
    app.globalData.activeLedgerId = resp.default_ledger_id;
  }

  console.info('[auth] login success', { userId: resp.user.id, familyId: resp.default_family_id });
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
    await setItem(TOKEN_KEY, stored);  // COSTRA-125: async

    // COSTRA-165: mock 路径也写 family-context（R2 P2-2 实装期处理 · 让 T8 在 mock 环境可跑）
    await setActiveFamily({
      family_id: refreshed.default_family_id,
      ledger_id: refreshed.default_ledger_id,
    });
    const appMock = getApp();
    if (appMock?.globalData) {
      appMock.globalData.activeLedgerId = refreshed.default_ledger_id;
    }
    return;
  }
  const resp = await request<TokenRaw>({
    method: 'POST',
    path: '/auth/refresh',
    body: { refresh_token: current.raw.refresh_token },
    auth: false
  });
  const stored = buildStored(resp);
  current = wrap(stored);
  await setItem(TOKEN_KEY, stored);  // COSTRA-125: async

  // COSTRA-165 v1.1 P1-1: refresh response 含 default_family_id/default_ledger_id · 写入 family-context
  // 极边缘场景：server 返空字符串（FU-164-REFRESH-DEFAULT-IDS-NULL · personal family 缺失）→ 跳过写入 · 保持现有 family-context
  if (resp.default_family_id && resp.default_ledger_id) {
    await setActiveFamily({
      family_id: resp.default_family_id,
      ledger_id: resp.default_ledger_id,
    });
    const app = getApp();
    if (app?.globalData) {
      app.globalData.activeLedgerId = resp.default_ledger_id;
    }
  }
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
 * COSTRA-165: mockExchange 同步补 default_family_id/default_ledger_id + user 新字段（T11 覆盖）
 */
function mockExchange(_code: string, oldRefresh?: string): TokenRaw {
  const seed = Date.now().toString(36);
  return {
    access_token: `mock.access.${seed}`,
    refresh_token: oldRefresh || `mock.refresh.${seed}`,
    access_token_ttl_sec: 60 * 60,      // 1h
    refresh_token_ttl_sec: 30 * 24 * 3600, // 30d
    expires_in: 60 * 60,  // COSTRA-165 P1-3: 与 access_token_ttl_sec 一致
    user: {
      id: `mock-user-${seed.slice(0, 4)}`,
      nickname: '测试用户',
      avatar_url: null,
      // mock 模式下 has_completed_profile=true · 因此 mock 下无法验证"完善资料"入口显示路径
      // 该路径由 §9 步骤 2（has_completed_profile=false 首登场景）Human 实测覆盖
      // Card-Review P2-3 修订（2026-05-19 10:15）
      has_completed_profile: true,
      // COSTRA-165 P1-3: 与 server toUserView() 1:1 对齐
      timezone: 'Asia/Shanghai',
      created_at: '2026-01-01T00:00:00.000Z',
      updated_at: '2026-01-01T00:00:00.000Z',
    },
    // COSTRA-165: mock 路径也提供 default_family_id/default_ledger_id
    default_family_id: `mock-family-${seed.slice(0, 4)}`,
    default_ledger_id: `mock-ledger-${seed.slice(0, 4)}`,
  };
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
  reset(): void { current = null; },
  setCurrent(stored: TokenStored): void { current = wrap(stored); },
  buildStored
};
