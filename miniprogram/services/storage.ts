// services/storage.ts · wx.storage 封装（async 全量 · 带版本号 + 过期）
// 卡号: COSTRA-125（重写 · 全量异步化）
// 前身: COSTRA-030（骨架）· COSTRA-121（LRU 占位）· COSTRA-124（R1 顶层副作用迁入 onLaunch）
// Refs:
//   - FU-LAUNCH-FIRST-RENDER-RACE-B（渲染层 storage group `_prepare` 就绪时刻晚于 App.onLaunch 触发）
//   - .team/dispatch/COSTRA-125-miniapp-storage-async-migration.md §3 (a)
//   - .team/members/miniapp-dev/history/2026-05-03-costra-124-r2-diagnose.md §6.2（方案 B' 骨架）
//   - docs/devops/libversion-upgrade.md §3.4（反模式 #4 · 过度信赖 onLaunch 作为 storage 就绪时刻）
//
// ⚠️ 关键不变量（v3 定性后确立 · 禁止回退 · COSTRA-125）：
//   1. 不得再使用任何 `wx.*StorageSync` 同步 API · 启动期会撞渲染层 `_prepare` 未就绪抛 too eayly
//   2. 本模块所有导出 API 必须返回 Promise<T>/Promise<void>· caller 必须 await
//   3. `wx.getStorage({key})` / `wx.setStorage({...})` / `wx.removeStorage({...})` / `wx.clearStorage()`
//      是基础库 2.21.0+ 的官方 Promise 形态（不传 success/fail/complete 时返回 Promise）· 当前开发期 libVersion 3.8.12 满足 · NFR 最低基础库 2.32.3 亦满足（Epic-G 上架合规）
//   4. 业务调用方必须走 app.globalData.bootstrapPromise gate · 避免在 bootstrap 未就绪时调 storage

const STORAGE_VERSION = 1;
const VERSION_KEY = '__costra_storage_version';

interface Envelope<T> {
  v: number;
  t: number; // 写入时间戳
  ttl?: number; // 毫秒
  d: T;
}

/**
 * 启动期 storage 版本校验（COSTRA-125 async 版）
 *
 * 必须由 app.ts onLaunch 首行 await 调用（作为 bootstrapPromise 的第一阶段）。
 *
 * 错误路径：
 * - `data not found`（首次启动 · VERSION_KEY 不存在）：吞错 · 写入 VERSION_KEY 初值 · 正常返回
 * - 其他错误：warn 日志 + 静默返回（不阻塞 bootstrap）
 *
 * 历史（v1→v2→v3）：
 * - v1（COSTRA-030）：模块顶层裸调 · 启动期副作用
 * - v2（COSTRA-124 R1）：迁入 onLaunch 首行 · 但仍用同步 API · 实测证伪（R1 假设漏网）
 * - v3（COSTRA-125 本轮）：全量 async · 由 SDK 内部等渲染层 `_prepare` 就绪后 resolve
 */
export async function ensureVersion(): Promise<void> {
  if (typeof wx === 'undefined') return;
  try {
    const res = await wx.getStorage<number>({ key: VERSION_KEY });
    if (res.data !== STORAGE_VERSION) {
      await wx.clearStorage();
      await wx.setStorage({ key: VERSION_KEY, data: STORAGE_VERSION });
    }
  } catch (e: unknown) {
    // data not found 也走这里：首次启动正常路径 · 初始化 VERSION_KEY
    const errMsg = (e as { errMsg?: string })?.errMsg || '';
    if (errMsg.includes('data not found')) {
      try {
        // 首次：无需 clearStorage（已无数据）· 直接写入 VERSION_KEY
        await wx.setStorage({ key: VERSION_KEY, data: STORAGE_VERSION });
      } catch (e2) {
        console.warn('[storage] ensureVersion init failed', e2);
      }
      return;
    }
    console.warn('[storage] ensureVersion failed', e);
  }
}

export async function setItem<T>(key: string, data: T, ttlMs?: number): Promise<void> {
  if (typeof wx === 'undefined') return;
  const envelope: Envelope<T> = { v: STORAGE_VERSION, t: Date.now(), ttl: ttlMs, d: data };
  try {
    await wx.setStorage({ key, data: envelope });
  } catch (e) {
    console.error('[storage] set failed', key, e);
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
    console.warn('[storage] get failed', key, e);
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
