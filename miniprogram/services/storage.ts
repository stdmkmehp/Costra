// services/storage.ts · wx.storage 封装（async API · 带版本号 + TTL）
// 卡号: COSTRA-125
// Refs: docs/devops/libversion-upgrade.md §3.4

// ⚠️ 不变量（禁止回退）：
//   1. 不使用 wx.*StorageSync 同步 API · 启动期 lib 2.32~2.33 SDK race（lib 3.8 已修复 · 防御性约束）
//   2. 所有导出 API 返回 Promise · caller 必须 await
//   3. 基于 wx.getStorage Promise 形态（基础库 2.21.0+ · 当前 dev 3.8.12 · NFR 最低 2.32.3）

import { logger } from '../utils/logger';
import { PRESERVED_KEYS } from './storageKeys';

const STORAGE_VERSION = 1;
const VERSION_KEY = '__costra_storage_version';

interface Envelope<T> {
  v: number;
  t: number; // 写入时间戳
  ttl?: number; // 毫秒
  d: T;
}

/**
 * 启动期 storage 版本校验 · 由 app.ts onLaunch 首行 await 调用
 * 错误处理：data not found（首启）→ 写入初值；其他错误 → warn + 静默
 */
export async function ensureVersion(): Promise<void> {
  if (typeof wx === 'undefined') return;
  try {
    const res = await wx.getStorage<number>({ key: VERSION_KEY });
    if (res.data !== STORAGE_VERSION) {
      // 版本迁移：清空 storage 但保留白名单 key（鉴权 token / 设备指纹），
      // 避免升级后强制重登（新增孤儿会话）与设备身份重置（按设备回收失效）。
      await clearStoragePreserving(PRESERVED_KEYS);
      await wx.setStorage({ key: VERSION_KEY, data: STORAGE_VERSION });
    }
  } catch (e: unknown) {
    // data not found 也走这里：首次启动正常路径 · 初始化 VERSION_KEY
    const errMsg = (e as { errMsg?: string })?.errMsg || '';
    if (errMsg.includes('data not found')) {
      try {
        // VERSION_KEY 缺失不一定是首次启动：老版本可能已有 token/family 等业务 key。
        // 若 storage 非空，按一次旧版本迁移处理：只保留白名单 key，清掉其它旧结构数据。
        if (await hasAnyStorageData()) {
          await clearStoragePreserving(PRESERVED_KEYS);
        }
        await wx.setStorage({ key: VERSION_KEY, data: STORAGE_VERSION });
      } catch (e2) {
        logger.warn('storage', 'ensureVersion init failed', e2);
      }
      return;
    }
    logger.warn('storage', 'ensureVersion failed', e);
  }
}

/**
 * 清空 storage，但保留白名单 key 的原始值。
 * 做法：先把白名单 key 的裸值读出暂存 → clearStorage → 原样写回。
 * 注：读写走裸 wx.getStorage/setStorage（保留 envelope 结构，不做 TTL 解包），
 *     保证 token / 设备指纹的存储形态在迁移前后完全一致。
 */
async function hasAnyStorageData(): Promise<boolean> {
  try {
    const info = await wx.getStorageInfo();
    return Array.isArray(info.keys) && info.keys.length > 0;
  } catch (e) {
    logger.warn('storage', 'getStorageInfo failed during ensureVersion', e);
    return false;
  }
}

async function clearStoragePreserving(keys: readonly string[]): Promise<void> {
  const saved: Array<{ key: string; data: unknown }> = [];
  for (const key of keys) {
    try {
      const res = await wx.getStorage<unknown>({ key });
      saved.push({ key, data: res.data });
    } catch {
      /* key 不存在 → 跳过 */
    }
  }
  await wx.clearStorage();
  for (const item of saved) {
    try {
      await wx.setStorage({ key: item.key, data: item.data });
    } catch (e) {
      logger.warn('storage', `preserve rewrite failed · key=${item.key}`, e);
    }
  }
}

export async function setItem<T>(key: string, data: T, ttlMs?: number): Promise<void> {
  if (typeof wx === 'undefined') return;
  const envelope: Envelope<T> = { v: STORAGE_VERSION, t: Date.now(), ttl: ttlMs, d: data };
  try {
    await wx.setStorage({ key, data: envelope });
  } catch (e) {
    logger.error('storage', `set failed · key=${key}`, e);
  }
}

export async function getItem<T>(key: string): Promise<T | null> {
  if (typeof wx === 'undefined') return null;
  try {
    const res = await wx.getStorage<Envelope<T>>({ key });
    const env = res.data;
    if (!env || typeof env !== 'object') return null;
    if (env.ttl && Date.now() - env.t > env.ttl) {
      await removeItem(key);
      return null;
    }
    return env.d;
  } catch (e: unknown) {
    const errMsg = (e as { errMsg?: string })?.errMsg || '';
    // data not found：key 不存在 · 正常语义返回 null
    if (errMsg.includes('data not found')) return null;
    logger.warn('storage', `get failed · key=${key}`, e);
    return null;
  }
}

export async function removeItem(key: string): Promise<void> {
  if (typeof wx === 'undefined') return;
  try {
    await wx.removeStorage({ key });
  } catch {
    /* noop · 不存在也算成功 */
  }
}
