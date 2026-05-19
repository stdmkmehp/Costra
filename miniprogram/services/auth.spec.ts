// services/auth.spec.ts · TokenPair 字段对齐 + shouldRefresh 边界
// 卡号: COSTRA-102 · D2.10 · COSTRA-158 §2.4 G' 扩展 updateLocalUserProfile 测
// COSTRA-158 R1.x.1: updateLocalUserProfile 改 async + setItem · 测适配 + 重启回读单测
import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { __test__ as authTest, getToken, getSession, updateLocalUserProfile, initAuth } from './auth';
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
}));

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
    await initAuth();

    // 5. 期望 current 被恢复 · user.nickname='张三' has_completed_profile=true
    const tk = getToken();
    expect(tk).not.toBeNull();
    expect(tk!.raw.user.nickname).toBe('张三');
    expect(tk!.raw.user.has_completed_profile).toBe(true);
  });
});
