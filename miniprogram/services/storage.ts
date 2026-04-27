// services/storage.ts · wx.storage 封装（带版本号 + 过期）
// 卡号: COSTRA-030 · 占位版；COSTRA-121 后续落细 LRU

const STORAGE_VERSION = 1;
const VERSION_KEY = '__costra_storage_version';

interface Envelope<T> {
  v: number;
  t: number; // 写入时间戳
  ttl?: number; // 毫秒
  d: T;
}

function ensureVersion(): void {
  // 单测 / 非 wx 环境：wx 全局不存在 · 静默跳过
  // 生产（小程序运行时）：wx 一定存在
  if (typeof wx === 'undefined') return;
  try {
    const v = wx.getStorageSync(VERSION_KEY);
    if (v !== STORAGE_VERSION) {
      wx.clearStorageSync();
      wx.setStorageSync(VERSION_KEY, STORAGE_VERSION);
    }
  } catch (e) {
    console.warn('[storage] ensureVersion failed', e);
  }
}

ensureVersion();

export function setItem<T>(key: string, data: T, ttlMs?: number): void {
  if (typeof wx === 'undefined') return;
  const env: Envelope<T> = { v: STORAGE_VERSION, t: Date.now(), ttl: ttlMs, d: data };
  try {
    wx.setStorageSync(key, env);
  } catch (e) {
    console.error('[storage] set failed', key, e);
  }
}

export function getItem<T>(key: string): T | null {
  if (typeof wx === 'undefined') return null;
  try {
    const env = wx.getStorageSync(key) as Envelope<T> | '';
    if (!env) return null;
    if (env.ttl && Date.now() - env.t > env.ttl) {
      wx.removeStorageSync(key);
      return null;
    }
    return env.d;
  } catch (e) {
    console.warn('[storage] get failed', key, e);
    return null;
  }
}

export function removeItem(key: string): void {
  if (typeof wx === 'undefined') return;
  try { wx.removeStorageSync(key); } catch { /* noop */ }
}
