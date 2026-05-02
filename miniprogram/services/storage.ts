// services/storage.ts · wx.storage 封装（带版本号 + 过期）
// 卡号: COSTRA-030 · 占位版；COSTRA-121 后续落细 LRU
// COSTRA-124: 移除模块顶层副作用 · ensureVersion() 改为 export · 由 app.ts onLaunch 首行调用
// Refs: COSTRA-124 · FU-LAUNCH-FIRST-RENDER-RACE · .team/dispatch/COSTRA-124-miniapp-fix-startup-storage-timing.md §3 (a)

const STORAGE_VERSION = 1;
const VERSION_KEY = '__costra_storage_version';

interface Envelope<T> {
  v: number;
  t: number; // 写入时间戳
  ttl?: number; // 毫秒
  d: T;
}

/**
 * 启动期 storage 版本校验（COSTRA-124）
 *
 * 严禁在模块顶层裸调——必须由 app.ts onLaunch 首行显式调用。
 * 原因：微信基础库 2.32.3+ 对启动期 storage 调用有隐式时序约束，
 * 若在 App() 注册前触发 wx.getStorageSync 会命中 SDK 内部
 * createOrGetStorageGroup._prepare 未就绪，抛出 `too eayly`（SDK 错拼 early）。
 *
 * 参考：`.team/members/miniapp-dev/history/2026-05-02-getglobalstorage-v2-diagnose.md` L1-L4 根因链
 */
export function ensureVersion(): void {
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
