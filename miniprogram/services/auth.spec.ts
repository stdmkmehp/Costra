// services/auth.spec.ts · TokenPair 字段对齐 + shouldRefresh 边界
// 卡号: COSTRA-102 · D2.10 · COSTRA-158 §2.4 G' 扩展 updateLocalUserProfile 测
// COSTRA-158 R1.x.1: updateLocalUserProfile 改 async + setItem · 测适配 + 重启回读单测
// COSTRA-165: T7~T11 family-context 接入测试（双源一致性 / initAuth 升级 / refresh 边界 / TokenRaw 契约对齐）
import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { __test__ as authTest, getToken, getSession, updateLocalUserProfile, initAuth, doWxLogin, loginFlow, refreshToken, clearToken, gmLoginAs } from './auth';
import type { TokenRaw, TokenStored } from './auth';

// R1.x.1: mock storage.ts · 让 setItem/getItem 操作共享 Map（模拟真实 envelope 行为）
const storageMap = new Map<string, unknown>();
vi.mock('./storage', () => ({
  setItem: vi.fn(async (_key: string, _data: unknown) => {
    // 模拟真实 setItem: 写入 envelope {v, t, d}
    storageMap.set(_key, { v: 1, t: Date.now(), d: _data });
  }),
  getItem: vi.fn(async (_key: string) => {
    // 模拟真实 getItem: 读 envelope · 返回 env.d
    if (!storageMap.has(_key)) return null;
    const env = storageMap.get(_key);
    if (!env || typeof env !== 'object') return null;
    return (env as { d: unknown }).d;
  }),
  removeItem: vi.fn(async (_key: string) => {
    storageMap.delete(_key);
  }),
  // logout 竞态修复：write barrier · logout 后 blockWrites 拦 in-flight，login 首步 unblockWrites 放行。
  //   单测无跨越 logout 场景，两个函数只需存在 · 语义 noop 即可。
  blockWrites: vi.fn(() => { /* noop for tests */ }),
  unblockWrites: vi.fn(() => { /* noop for tests */ }),
}));

// COSTRA-165: mock family.ts · 追踪 setActiveFamily/clearActiveFamily 调用
const familyState: { ctx: { family_id: string; ledger_id: string } | null } = { ctx: null };
vi.mock('./family', () => ({
  setActiveFamily: vi.fn(async (ctx: { family_id: string; ledger_id: string }) => {
    familyState.ctx = ctx;
    // 同步写入 storageMap 让 getActiveFamilyId/getActiveLedgerId 可读
    storageMap.set('__costra_family_context_v1', { v: 1, t: Date.now(), d: ctx });
  }),
  getActiveFamilyId: vi.fn(async () => {
    if (!storageMap.has('__costra_family_context_v1')) return null;
    const env = storageMap.get('__costra_family_context_v1');
    if (!env || typeof env !== 'object') return null;
    const d = (env as { d: unknown }).d;
    return (d as { family_id: string } | null)?.family_id ?? null;
  }),
  getActiveLedgerId: vi.fn(async () => {
    if (!storageMap.has('__costra_family_context_v1')) return null;
    const env = storageMap.get('__costra_family_context_v1');
    if (!env || typeof env !== 'object') return null;
    const d = (env as { d: unknown }).d;
    return (d as { ledger_id: string } | null)?.ledger_id ?? null;
  }),
  clearActiveFamily: vi.fn(async () => {
    familyState.ctx = null;
    storageMap.delete('__costra_family_context_v1');
  }),
  // migration 0011: mock fetchAndRestorePreference → 返回 null，让无偏好路径走 default family 兜底
  fetchAndRestorePreference: vi.fn(async () => null),
  restoreActiveFamilyAfterLogin: vi.fn(async (ctx: { family_id: string; ledger_id: string }) => {
    familyState.ctx = ctx;
    storageMap.set('__costra_family_context_v1', { v: 1, t: Date.now(), d: ctx });
    return ctx;
  }),
  flushPendingPreference: vi.fn(async () => undefined),
}));

// wx 运行时在单测环境不存在 · 仅 buildStored 与 wrap 逻辑不依赖 wx，直接测即可

const mockRaw: TokenRaw = {
  access_token: 'a.b.c',
  refresh_token: 'r.s.t',
  access_token_ttl_sec: 7200,
  refresh_token_ttl_sec: 2592000,
  // COSTRA-165 P1-3: 与 server AuthTokenPair 1:1 对齐
  expires_in: 7200,
  user: {
    id: 'u-1',
    nickname: '测试昵称',
    avatar_url: 'https://x.png',
    has_completed_profile: false,
    is_gm: false,
    timezone: 'Asia/Shanghai',
    created_at: '2026-01-01T00:00:00.000Z',
    updated_at: '2026-01-01T00:00:00.000Z',
  },
  default_family_id: 'f-default-001',
  default_ledger_id: 'l-default-001',
};

describe('services/auth · TokenPair 字段 + 续签窗口', () => {
  beforeEach(() => {
    authTest.reset();
  });

  afterEach(() => {
    vi.useRealTimers();
    authTest.reset();
  });

  it('P0-2: 读写 token 走 raw.access_token / raw.refresh_token（OpenAPI 字段名）', () => {
    const stored = authTest.buildStored(mockRaw);
    authTest.setCurrent(stored);

    const tk = getToken();
    expect(tk).not.toBeNull();
    expect(tk!.raw.access_token).toBe('a.b.c');
    expect(tk!.raw.refresh_token).toBe('r.s.t');
    // 过期时间按 ttl_sec 计算 · 允许 1s 误差
    expect(tk!.access_expires_at - Date.now()).toBeGreaterThan(7200 * 1000 - 1000);
    expect(tk!.access_expires_at - Date.now()).toBeLessThanOrEqual(7200 * 1000);

    // getSession 将 avatar_url 映射为 avatarUrl（snake → camel）
    const s = getSession();
    expect(s?.user?.nickname).toBe('测试昵称');
    expect(s?.user?.avatarUrl).toBe('https://x.png');
  });

  it('shouldRefresh 边界：距离 access 过期 < 5 分钟 → true；> 5 分钟 → false', () => {
    vi.useFakeTimers();
    const baseNow = new Date('2026-04-27T10:00:00.000Z').getTime();
    vi.setSystemTime(baseNow);

    const stored = authTest.buildStored(mockRaw); // access 过期在 +2h
    authTest.setCurrent(stored);
    const tk = getToken()!;

    // 此刻 → 应不触发刷新（还有 2h）
    expect(tk.shouldRefresh()).toBe(false);

    // 过期前 4 分钟 → 应触发（< 5 分钟阈值）
    vi.setSystemTime(baseNow + (7200 - 240) * 1000);
    expect(tk.shouldRefresh()).toBe(true);

    // 过期前 6 分钟 → 不触发（> 5 分钟）
    vi.setSystemTime(baseNow + (7200 - 360) * 1000);
    expect(tk.shouldRefresh()).toBe(false);
  });
});

describe('services/auth · updateLocalUserProfile（COSTRA-158 §2.4）', () => {

  beforeEach(() => {
    authTest.reset();
    storageMap.clear();
  });

  afterEach(() => {
    storageMap.clear();
    authTest.reset();
  });

  it('PATCH 成功后本地 user 含 has_completed_profile=true', async () => {
    const stored = authTest.buildStored(mockRaw);
    authTest.setCurrent(stored);

    // 调用前 user.has_completed_profile = false
    const tk = getToken();
    expect(tk!.raw.user.has_completed_profile).toBe(false);

    // 模拟 PATCH 成功后更新
    await updateLocalUserProfile({ nickname: '新昵称', avatar_url: 'https://new.png', has_completed_profile: true });

    // 验证内存态已更新
    expect(getToken()!.raw.user.has_completed_profile).toBe(true);
    expect(getToken()!.raw.user.nickname).toBe('新昵称');
    expect(getToken()!.raw.user.avatar_url).toBe('https://new.png');

    // R1.x.1: 验证 storage 写入走 setItem envelope（非 setStorageSync 裸对象）
    const written = storageMap.get('__costra_token_v1') as { v: number; t: number; d: TokenStored };
    expect(written).toBeDefined();
    expect(written.v).toBe(1);
    expect(written.d.raw.user.has_completed_profile).toBe(true);
  });

  it('current 为 null 时 updateLocalUserProfile 不抛异常', async () => {
    await expect(updateLocalUserProfile({ has_completed_profile: true })).resolves.toBeUndefined();
    expect(storageMap.has('__costra_token_v1')).toBe(false);
  });

  // R1.x.1（COSTRA-158 BUG fix · 2026-05-19）：重启回读测试
  // 原 setStorageSync 写裸对象 · getItem 读 envelope env.d 返回 undefined · 重启即登出
  it('updateLocalUserProfile 写入后 · 模拟重启 initAuth 应能读回新值（envelope 一致性）', async () => {
    // 1. 模拟首登成功态
    const stored = authTest.buildStored(mockRaw);
    authTest.setCurrent(stored);

    // 2. 调 updateLocalUserProfile
    await updateLocalUserProfile({ nickname: '张三', has_completed_profile: true });

    // 3. 重置内存 current = null（模拟杀进程）
    authTest.reset();

    // 4. 调 initAuth() 模拟重启 · storage mock 已配好 envelope 回读
    //    需要先写入 family-context 让 initAuth 正常路径走通
    storageMap.set('__costra_family_context_v1', { v: 1, t: Date.now(), d: { family_id: 'f-default-001', ledger_id: 'l-default-001' } });
    // mock getApp（initAuth 正常路径需要读 globalData）
    const mockGD = { activeLedgerId: undefined as string | undefined };
    vi.stubGlobal('getApp', vi.fn(() => ({ globalData: mockGD })));

    await initAuth();

    // 5. 期望 current 被恢复 · user.nickname='张三' has_completed_profile=true
    const tk = getToken();
    expect(tk).not.toBeNull();
    expect(tk!.raw.user.nickname).toBe('张三');
    expect(tk!.raw.user.has_completed_profile).toBe(true);

    vi.unstubAllGlobals();
  });
});

// ─── COSTRA-165: T7~T11 family-context 接入测试 ──────────────────────────────

describe('services/auth · COSTRA-165 family-context integration', () => {
  // mock request.ts · 默认返回 mockRaw 以支持 T7~T10
  vi.mock('./request', () => ({
    request: vi.fn(async () => ({
      access_token: 'mock-jwt.access',
      refresh_token: 'mock-jwt.refresh',
      access_token_ttl_sec: 3600,
      refresh_token_ttl_sec: 2592000,
      expires_in: 3600,
      user: {
        id: 'mock-u-1',
        nickname: '测试用户',
        avatar_url: null,
        has_completed_profile: true,
        is_gm: false,
        timezone: 'Asia/Shanghai',
        created_at: '2026-01-01T00:00:00.000Z',
        updated_at: '2026-01-01T00:00:00.000Z',
      },
      default_family_id: 'f-default-001',
      default_ledger_id: 'l-default-001',
    })),
  }));

  // mock wx.login
  const mockWxLogin = vi.fn(({ success }: { success: (res: { code: string }) => void }) => {
    success({ code: 'mock-wx-code-1234' });
  });

  // 共享 globalData 对象 · 确保 auth.ts 写入和测试读取是同一引用
  const sharedGlobalData = { activeLedgerId: undefined as string | undefined };
  const mockGetAppFn = vi.fn(() => ({ globalData: sharedGlobalData }));

  beforeEach(() => {
    authTest.reset();
    storageMap.clear();
    familyState.ctx = null;
    sharedGlobalData.activeLedgerId = undefined;
    vi.clearAllMocks();
    vi.stubGlobal('wx', { login: mockWxLogin, reLaunch: vi.fn() });
    vi.stubGlobal('getApp', mockGetAppFn);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    authTest.reset();
    storageMap.clear();
    familyState.ctx = null;
  });

  // T7: 双源一致性（doWxLogin 后 storage + globalData 同步）
  it('T7: doWxLogin 后 storage family-context + globalData.activeLedgerId 同步写入', async () => {
    const token = await doWxLogin();

    // 验证 token 存在
    expect(token).not.toBeNull();

    // 验证 family-context 在 storage 中被写入（通过 family mock 的 familyState）
    expect(familyState.ctx).not.toBeNull();
    expect(familyState.ctx!.family_id).toBe(token.raw.default_family_id);
    expect(familyState.ctx!.ledger_id).toBe(token.raw.default_ledger_id);

    // 验证 globalData.activeLedgerId 同步（sharedGlobalData 是同一引用）
    expect(sharedGlobalData.activeLedgerId).toBe(token.raw.default_ledger_id);
  });

  // T8: initAuth 旧 token 升级 → refreshToken → 写入 family-context
  it('T8: initAuth 旧 token 升级场景 · storage 无 family-context → refreshToken → 写入', async () => {
    // 1. 先 doWxLogin 建立 token
    const token = await doWxLogin();
    expect(token).not.toBeNull();

    // 2. 清 family-context（模拟旧 token 升级场景：token 存在但无 family-context）
    storageMap.delete('__costra_family_context_v1');
    familyState.ctx = null;

    // 3. 重置内存 + 再 initAuth（模拟重启）
    authTest.reset();
    await initAuth();

    // 4. 期望 initAuth 检测到 familyId=null → 走 refreshToken → 写入 family-context
    expect(familyState.ctx).not.toBeNull();
    expect(familyState.ctx!.family_id).toBeTruthy();
    expect(familyState.ctx!.ledger_id).toBeTruthy();

    // 5. globalData 也同步（sharedGlobalData 是同一引用）
    expect(sharedGlobalData.activeLedgerId).toBeTruthy();
  });

  // T9: initAuth 旧 token + 无 family-context → 使用 token default family 兜底，不强制重新登录
  it('T9: initAuth 旧 token + 无 family-context → 使用 default family 兜底', async () => {
    // 1. 先 doWxLogin 建立 token
    const token = await doWxLogin();

    // 2. 清 family-context
    storageMap.delete('__costra_family_context_v1');
    familyState.ctx = null;

    // 3. 重置内存 + 再 initAuth
    authTest.reset();
    await initAuth();

    // 4. 期望 token 保持有效，family-context 用 token default 兜底
    expect(getToken()).not.toBeNull();
    expect(familyState.ctx).not.toBeNull();
    expect(familyState.ctx!.family_id).toBe(token.raw.default_family_id);
    expect(familyState.ctx!.ledger_id).toBe(token.raw.default_ledger_id);
  });

  it('T10: access 过期 refresh 后本地无 context → 优先恢复服务端 preference', async () => {
    const token = await doWxLogin();
    const tokenEnv = storageMap.get('__costra_token_v1') as { d: TokenStored };
    tokenEnv.d.access_expires_at = Date.now() - 1_000;
    tokenEnv.d.refresh_expires_at = Date.now() + 60_000;
    storageMap.set('__costra_token_v1', tokenEnv);
    storageMap.delete('__costra_family_context_v1');
    familyState.ctx = null;

    const { fetchAndRestorePreference } = await import('./family');
    vi.mocked(fetchAndRestorePreference).mockImplementationOnce(async () => {
      const ctx = { family_id: 'f-shared-preferred', ledger_id: 'l-shared-preferred' };
      familyState.ctx = ctx;
      storageMap.set('__costra_family_context_v1', { v: 1, t: Date.now(), d: ctx });
      return ctx;
    });

    authTest.reset();
    await initAuth();

    expect(getToken()).not.toBeNull();
    expect(familyState.ctx).toMatchObject({ family_id: 'f-shared-preferred', ledger_id: 'l-shared-preferred' });
    expect(familyState.ctx!.family_id).not.toBe(token.raw.default_family_id);
    expect(sharedGlobalData.activeLedgerId).toBe('l-shared-preferred');
  });

  it('T12: loginFlow 并发调用只触发一次 wx.login + /auth/wx-login', async () => {
    const { request } = await import('./request');
    let resolveLogin!: (value: TokenRaw) => void;
    vi.mocked(request).mockImplementationOnce(() => new Promise<TokenRaw>((resolve) => { resolveLogin = resolve; }));

    const p1 = loginFlow();
    const p2 = loginFlow();
    expect(mockWxLogin).toHaveBeenCalledTimes(1);
    // wx.loginAsync resolve 后还会经过 device_fp 的 async storage 读写，再发 request。
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(vi.mocked(request)).toHaveBeenCalledTimes(1);

    resolveLogin({ ...mockRaw, access_token: 'login.concurrent.access', refresh_token: 'login.concurrent.refresh' });
    const [t1, t2] = await Promise.all([p1, p2]);
    expect(t1.raw.access_token).toBe('login.concurrent.access');
    expect(t2.raw.access_token).toBe('login.concurrent.access');
  });

  it('T13: refreshToken 并发调用只触发一次 /auth/refresh', async () => {
    authTest.setCurrent(authTest.buildStored(mockRaw));
    const { request } = await import('./request');
    let resolveRefresh!: (value: TokenRaw) => void;
    vi.mocked(request).mockImplementationOnce(() => new Promise<TokenRaw>((resolve) => { resolveRefresh = resolve; }));

    const p1 = refreshToken();
    const p2 = refreshToken();
    expect(vi.mocked(request)).toHaveBeenCalledTimes(1);

    resolveRefresh({ ...mockRaw, access_token: 'refresh.concurrent.access' });
    await Promise.all([p1, p2]);
    expect(getToken()?.raw.access_token).toBe('refresh.concurrent.access');
  });

  it('T14: refresh 悬挂期间 clearToken 后，旧 refresh 响应不得恢复登录态', async () => {
    authTest.setCurrent(authTest.buildStored(mockRaw));
    const { request } = await import('./request');
    let resolveRefresh!: (value: TokenRaw) => void;
    vi.mocked(request).mockImplementationOnce(() => new Promise<TokenRaw>((resolve) => { resolveRefresh = resolve; }));

    const p = refreshToken();
    await clearToken();
    resolveRefresh({ ...mockRaw, access_token: 'stale.refresh.access' });
    await p;

    expect(getToken()).toBeNull();
    expect(storageMap.has('__costra_token_v1')).toBe(false);
  });

  // T11: refreshToken 空字符串保护
  it('T11: refreshToken 极边缘 · response 含空字符串 default_family_id → 跳过写入', async () => {
    // 1. 先 doWxLogin 建立 token + family-context
    await doWxLogin();
    const originalFamilyCtx = { ...familyState.ctx! };
    expect(originalFamilyCtx.family_id).toBeTruthy();

    // 2. refreshToken 返回空字符串 default_family_id
    const { request } = await import('./request');
    vi.mocked(request).mockResolvedValueOnce({
      access_token: 'refreshed.access',
      refresh_token: 'refreshed.refresh',
      access_token_ttl_sec: 3600,
      refresh_token_ttl_sec: 2592000,
      expires_in: 3600,
      user: {
        id: 'u-1',
        nickname: '测试昵称',
        avatar_url: null,
        has_completed_profile: true,
        timezone: 'Asia/Shanghai',
        created_at: '2026-01-01T00:00:00.000Z',
        updated_at: '2026-01-01T00:00:00.000Z',
      },
      default_family_id: '',  // 空字符串 · FU-164-REFRESH-DEFAULT-IDS-NULL
      default_ledger_id: '',
    });

    // 3. 调 refreshToken
    await refreshToken();

    // 4. 期望 family-context 不被空值覆盖 · 仍为原值
    expect(familyState.ctx).not.toBeNull();
    expect(familyState.ctx!.family_id).toBe(originalFamilyCtx.family_id);
    expect(familyState.ctx!.ledger_id).toBe(originalFamilyCtx.ledger_id);
  });

  // T11: TokenRaw 契约对齐 typecheck
  it('T11: TokenRaw 接口契约对齐 · mock buildStored 输入含 expires_in/timezone/created_at/updated_at → typecheck pass', () => {
    // 纯类型断言测试 · 若 TokenRaw 接口定义缺字段则 TS 编译失败
    const fullRaw: TokenRaw = {
      access_token: 'test.access',
      refresh_token: 'test.refresh',
      access_token_ttl_sec: 3600,
      refresh_token_ttl_sec: 2592000,
      expires_in: 3600,
      user: {
        id: 'u-typecheck',
        nickname: '类型检查用户',
        avatar_url: null,
        has_completed_profile: true,
        is_gm: false,
        timezone: 'Asia/Shanghai',
        created_at: '2026-05-27T00:00:00.000Z',
        updated_at: '2026-05-27T00:00:00.000Z',
      },
      default_family_id: 'f-typecheck',
      default_ledger_id: 'l-typecheck',
    };

    // buildStored 应能正常消费
    const stored = authTest.buildStored(fullRaw);
    expect(stored.raw.expires_in).toBe(3600);
    expect(stored.raw.user.is_gm).toBe(false);
    expect(stored.raw.user.timezone).toBe('Asia/Shanghai');
    expect(stored.raw.user.created_at).toBe('2026-05-27T00:00:00.000Z');
    expect(stored.raw.default_family_id).toBe('f-typecheck');
    expect(stored.raw.default_ledger_id).toBe('l-typecheck');
  });

  // T12: gmLoginAs user_id 路径 · 请求形状 + 登录后管道与 doWxLogin 一致
  it('T12: gmLoginAs(userId) · POST /gm/impersonate 显式 Bearer + body user_id/client_fp · 管道恢复 family-context', async () => {
    const { request } = await import('./request');
    const mocked = vi.mocked(request);
    mocked.mockClear();

    const token = await gmLoginAs({ userId: 'target-u-9' }, 'gm-access-token-xyz');

    expect(mocked).toHaveBeenCalledTimes(1);
    const opts = mocked.mock.calls[0][0];
    expect(opts.method).toBe('POST');
    expect(opts.path).toBe('/gm/impersonate');
    // 调用方在 clearToken 后执行 · 无法自动注入 Authorization · 必须显式 extraHeader
    expect(opts.auth).toBe(false);
    expect(opts.extraHeader?.Authorization).toBe('Bearer gm-access-token-xyz');
    const body = opts.body as Record<string, unknown>;
    expect(body.user_id).toBe('target-u-9');
    expect(body.fake_openid).toBeUndefined();
    expect(typeof body.client_fp).toBe('string');

    // 与 doWxLogin 同一管道：token 替换 + 落盘 + family-context 恢复 + globalData 同步
    expect(token.raw.user.id).toBe('mock-u-1');
    expect(getToken()?.raw.access_token).toBe('mock-jwt.access');
    expect(storageMap.has('__costra_token_v1')).toBe(true);
    expect(familyState.ctx?.family_id).toBe('f-default-001');
    expect(familyState.ctx?.ledger_id).toBe('l-default-001');
    expect(sharedGlobalData.activeLedgerId).toBe('l-default-001');
  });

  // T13: gmLoginAs fake_openid 路径 · body 二选一契约
  it('T13: gmLoginAs(fakeOpenid) · body 带 fake_openid 不带 user_id', async () => {
    const { request } = await import('./request');
    const mocked = vi.mocked(request);
    mocked.mockClear();

    await gmLoginAs({ fakeOpenid: 'gm_fake_test_001' }, 'gm-access-token-xyz');

    expect(mocked).toHaveBeenCalledTimes(1);
    const body = mocked.mock.calls[0][0].body as Record<string, unknown>;
    expect(body.fake_openid).toBe('gm_fake_test_001');
    expect(body.user_id).toBeUndefined();
  });
});
