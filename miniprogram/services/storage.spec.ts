// services/storage.spec.ts · async storage API 语义 + error path 覆盖
// 卡号: COSTRA-125
// Refs: .team/dispatch/COSTRA-125-miniapp-storage-async-migration.md §3 (f)
//   - 最小覆盖 4 个导出 API（getItem / setItem / removeItem / ensureVersion）的 async 语义
//   - error path：`data not found` 必须被吞为 null（首次读 key 不存在 = 正常语义）
//   - node 环境下 wx 不存在 → 所有 API 静默 noop（不 throw）
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { getItem, setItem, removeItem, ensureVersion } from './storage';

describe('services/storage · 无 wx 全局环境（兼容单测/SSR）', () => {
  beforeEach(() => {
    // 确保 wx 不存在（vitest 默认 node env 即满足 · 显式 unstub 兜底）
    vi.unstubAllGlobals();
  });

  it('getItem 在 typeof wx === undefined 下静默返回 null（不 throw）', async () => {
    const v = await getItem<string>('any-key');
    expect(v).toBeNull();
  });

  it('setItem / removeItem / ensureVersion 在无 wx 环境下静默完成（resolve void）', async () => {
    await expect(setItem('k', { x: 1 })).resolves.toBeUndefined();
    await expect(removeItem('k')).resolves.toBeUndefined();
    await expect(ensureVersion()).resolves.toBeUndefined();
  });
});

describe('services/storage · 模拟 wx 异步 API（Promise 形态）', () => {
  // 共享存储 · 模拟 wx storage group 状态
  let mockStore: Map<string, unknown>;

  beforeEach(() => {
    mockStore = new Map<string, unknown>();
    const mockWx = {
      // wx.getStorage({key}) Promise 形态：成功 resolve {data}，不存在抛 errMsg "...:fail data not found"
      getStorage: <T>({ key }: { key: string }): Promise<{ data: T }> => {
        if (mockStore.has(key)) {
          return Promise.resolve({ data: mockStore.get(key) as T });
        }
        return Promise.reject({ errMsg: 'getStorage:fail data not found' });
      },
      setStorage: <T>({ key, data }: { key: string; data: T }): Promise<void> => {
        mockStore.set(key, data);
        return Promise.resolve();
      },
      removeStorage: ({ key }: { key: string }): Promise<void> => {
        mockStore.delete(key);
        return Promise.resolve();
      },
      clearStorage: (): Promise<void> => {
        mockStore.clear();
        return Promise.resolve();
      },
      getStorageInfo: (): Promise<{ keys: string[] }> => {
        return Promise.resolve({ keys: Array.from(mockStore.keys()) });
      },
    };
    vi.stubGlobal('wx', mockWx);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('getItem 取已 setItem 的 key 应返回原始 data（Envelope 解包）', async () => {
    await setItem('user', { id: 'u-1', name: 'alice' });
    const v = await getItem<{ id: string; name: string }>('user');
    expect(v).toEqual({ id: 'u-1', name: 'alice' });
  });

  it('getItem 不存在的 key（data not found）应返回 null · 不 throw（首次启动正常路径）', async () => {
    const v = await getItem<string>('never-set');
    expect(v).toBeNull();
  });

  it('setItem 写入后 removeItem 删除 · 再 getItem 返回 null', async () => {
    await setItem('tmp', 'hello');
    expect(await getItem<string>('tmp')).toBe('hello');
    await removeItem('tmp');
    expect(await getItem<string>('tmp')).toBeNull();
  });

  it('setItem 携带 ttlMs · 过期后 getItem 返回 null（并隐式调用 removeItem）', async () => {
    vi.useFakeTimers();
    const baseNow = new Date('2026-05-04T10:00:00.000Z').getTime();
    vi.setSystemTime(baseNow);

    await setItem('ttl-key', 'short-lived', 1_000); // 1s TTL
    expect(await getItem<string>('ttl-key')).toBe('short-lived');

    vi.setSystemTime(baseNow + 2_000); // +2s · 已过期
    expect(await getItem<string>('ttl-key')).toBeNull();

    vi.useRealTimers();
  });

  it('ensureVersion 首次调用（VERSION_KEY 不存在）走 data not found 分支 · 写入初值', async () => {
    expect(mockStore.has('__costra_storage_version')).toBe(false);
    await ensureVersion();
    // 不变量：调用后 VERSION_KEY 必存在 · 值为当前 STORAGE_VERSION（1）
    expect(mockStore.get('__costra_storage_version')).toBe(1);
  });

  it('ensureVersion 当 VERSION_KEY 已是当前版本 · 不触发 clearStorage（幂等）', async () => {
    mockStore.set('__costra_storage_version', 1);
    mockStore.set('user-data', 'should-survive');
    await ensureVersion();
    expect(mockStore.get('user-data')).toBe('should-survive');
  });

  it('ensureVersion 版本不匹配时 · 保留 token/device_fp 并清除普通 key', async () => {
    const tokenEnv = { v: 1, t: Date.now(), d: { raw: { access_token: 'a' } } };
    const deviceEnv = { v: 1, t: Date.now(), d: 'df_old_device' };
    mockStore.set('__costra_storage_version', 0);
    mockStore.set('__costra_token_v1', tokenEnv);
    mockStore.set('__costra_device_fp', deviceEnv);
    mockStore.set('legacy-key', { stale: true });

    await ensureVersion();

    expect(mockStore.get('__costra_storage_version')).toBe(1);
    expect(mockStore.get('__costra_token_v1')).toBe(tokenEnv);
    expect(mockStore.get('__costra_device_fp')).toBe(deviceEnv);
    expect(mockStore.has('legacy-key')).toBe(false);
  });

  it('ensureVersion 缺 VERSION_KEY 但 storage 非空时 · 按旧版本迁移处理', async () => {
    const tokenEnv = { v: 1, t: Date.now(), d: { raw: { access_token: 'a' } } };
    const deviceEnv = { v: 1, t: Date.now(), d: 'df_old_device' };
    mockStore.set('__costra_token_v1', tokenEnv);
    mockStore.set('__costra_device_fp', deviceEnv);
    mockStore.set('legacy-key', { stale: true });

    await ensureVersion();

    expect(mockStore.get('__costra_storage_version')).toBe(1);
    expect(mockStore.get('__costra_token_v1')).toBe(tokenEnv);
    expect(mockStore.get('__costra_device_fp')).toBe(deviceEnv);
    expect(mockStore.has('legacy-key')).toBe(false);
  });
});
