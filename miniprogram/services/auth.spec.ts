// services/auth.spec.ts · TokenPair 字段对齐 + shouldRefresh 边界
// 卡号: COSTRA-102 · D2.10 · COSTRA-158 §2.4 G' 扩展 updateLocalUserProfile 测
import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { __test__ as authTest, getToken, getSession, updateLocalUserProfile } from './auth';
import type { TokenRaw } from './auth';

// wx 运行时在单测环境不存在 · 仅 buildStored 与 wrap 逻辑不依赖 wx，直接测即可

const mockRaw: TokenRaw = {
  access_token: 'a.b.c',
  refresh_token: 'r.s.t',
  access_token_ttl_sec: 7200,
  refresh_token_ttl_sec: 2592000,
  user: { id: 'u-1', nickname: '测试昵称', avatar_url: 'https://x.png', has_completed_profile: false },
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
  const setStorageSyncMock = vi.fn();

  beforeEach(() => {
    authTest.reset();
    vi.stubGlobal('wx', { setStorageSync: setStorageSyncMock });
  });

  afterEach(() => {
    vi.restoreAllMocks();
    authTest.reset();
  });

  it('PATCH 成功后本地 user 含 has_completed_profile=true', () => {
    const stored = authTest.buildStored(mockRaw);
    authTest.setCurrent(stored);

    // 调用前 user.has_completed_profile = false
    const tk = getToken();
    expect(tk!.raw.user.has_completed_profile).toBe(false);

    // 模拟 PATCH 成功后更新
    updateLocalUserProfile({ nickname: '新昵称', avatar_url: 'https://new.png', has_completed_profile: true });

    // 验证内存态已更新
    expect(getToken()!.raw.user.has_completed_profile).toBe(true);
    expect(getToken()!.raw.user.nickname).toBe('新昵称');
    expect(getToken()!.raw.user.avatar_url).toBe('https://new.png');

    // 验证 storage 同步写入被调用
    expect(setStorageSyncMock).toHaveBeenCalled();
    const callArg = setStorageSyncMock.mock.calls[0];
    expect(callArg[0]).toBe('__costra_token_v1');
    expect(callArg[1].raw.user.has_completed_profile).toBe(true);
  });

  it('current 为 null 时 updateLocalUserProfile 不抛异常', () => {
    expect(() => updateLocalUserProfile({ has_completed_profile: true })).not.toThrow();
    expect(setStorageSyncMock).not.toHaveBeenCalled();
  });
});
