// services/storage.ts · wx.storage 封装（async API · 带版本号 + TTL）
// 卡号: COSTRA-125
// Refs: docs/devops/libversion-upgrade.md §3.4

// ⚠️ 不变量（禁止回退）：
//   1. 不使用 wx.*StorageSync 同步 API · 启动期 lib 2.32~2.33 SDK race（lib 3.8 已修复 · 防御性约束）
//   2. 所有导出 API 返回 Promise · caller 必须 await
//   3. 基于 wx.getStorage Promise 形态（基础库 2.21.0+ · 当前 dev 3.8.12 · NFR 最低 2.32.3）

import { logger } from '../utils/logger';
import { PRESERVED_KEYS, DEVICE_FP_KEY, TOKEN_KEY } from './storageKeys';

const STORAGE_VERSION = 1;
const VERSION_KEY = '__costra_storage_version';

interface Envelope<T> {
  v: number;
  t: number; // 写入时间戳
  ttl?: number; // 毫秒
  d: T;
}

// ─── 写屏障（write barrier） ────────────────────────────────────────────────────
//
// 目的：logout 之后拦截"跨越 logout 边界的 in-flight response"落盘。
//
// 场景：用户登录后立即 logout，登录期间 ledger 页 / 各 *Api 发出的一批 GET 请求
//   的 response 可能在 clearStorage 完成之后才回到 setItem，把上一用户的数据写进
//   已清空的 storage → 停留登出页时 wx.getStorageInfoSync().keys 持续新增。
//
// 语义：barrier 打开后，setItem 对非白名单 key 直接短路返回；removeItem/getItem 不拦
//   （幂等 / 只读）。login 成功进入 applyLoginResponse 时关闭 barrier，新会话业务写入放行。
//
// 白名单：
//   - VERSION_KEY / DEVICE_FP_KEY：clearAllForReset 自身要写（版本不变式 + 指纹保留）
//   - TOKEN_KEY：applyLoginResponse 在 unblockWrites 之前若被别的 in-flight 抢先写入
//     不会发生（unblock 是入口首步），但白名单化更稳。
let writesBlocked = false;
const BARRIER_ALLOWLIST: ReadonlySet<string> = new Set([VERSION_KEY, DEVICE_FP_KEY, TOKEN_KEY]);

/** logout 完成时调用（clearToken 后立即调）。打开屏障，拒收 in-flight 落盘。 */
export function blockWrites(): void {
  writesBlocked = true;
}

/** login 成功进入 applyLoginResponse 时调用（入口首步）。放行业务写入。 */
export function unblockWrites(): void {
  writesBlocked = false;
}

/** 供测试查询屏障状态。生产代码不应依赖。 */
export function __isWriteBlocked(): boolean {
  return writesBlocked;
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

/**
 * 本地重置专用：清空全部业务数据，仅保留设备指纹，并重写版本号。
 * 由 localReset.ts 在 logout 流程调用。
 *
 * 版本不变式必须在本函数内原子成立（清 → 回写指纹 → 重写 VERSION_KEY）：
 * 否则下次冷启动 ensureVersion() 会因「VERSION_KEY 缺失 + storage 非空（指纹+新数据）」
 * 误判为老版本迁移，把重新登录后拉取的数据再次清空（含 outbox 未上行 op）。
 */
export async function clearAllForReset(): Promise<void> {
  if (typeof wx === 'undefined') return;
  await clearStoragePreserving([DEVICE_FP_KEY]);
  try {
    await wx.setStorage({ key: VERSION_KEY, data: STORAGE_VERSION });
  } catch (e) {
    logger.warn('storage', 'clearAllForReset rewrite version failed', e);
  }
}

export async function setItem<T>(key: string, data: T, ttlMs?: number): Promise<void> {
  if (typeof wx === 'undefined') return;
  // 写屏障：logout 后拦截 in-flight response 落盘（见文件顶注释）。
  // getItem/removeItem 不拦（只读 / 幂等无副作用）。
  if (writesBlocked && !BARRIER_ALLOWLIST.has(key)) {
    logger.info('storage', `write blocked · key=${key}`);
    return;
  }
  const envelope: Envelope<T> = { v: STORAGE_VERSION, t: Date.now(), ttl: ttlMs, d: data };
  try {
    await wx.setStorage({ key, data: envelope });
  } catch (e) {
    logger.error('storage', `set failed · key=${key}`, e);
  }
}

/**
 * 严格写：写屏障开启或 wx.setStorage 失败时**抛错**（不吞、不静默）。
 *
 * 存在意义（L13 §3.7 / §4.2）：普通 setItem 在写屏障开启或写失败时只记日志、向上返回
 *   成功，这对绝大多数缓存路径是合理的（写失败不阻断业务）。但 epoch 重置的 watermark
 *   清零若被吞掉，会落到「epoch 记新值 + watermark 仍是旧高值」的**真丢数据**状态
 *   （下轮比对一致不再重置，洞内行 change_seq < watermark 永远拉不到）。因此 epoch reset
 *   分支的 watermark 清零必须走本函数，写失败即抛错，交由调用方中止本轮、不写 epoch。
 *
 * ⚠️ 仅供 epoch reset 场景（setWatermarkStrict）使用；不扩散到普通业务写路径，
 *   避免把预算/资产/公告/统计等缓存的"写失败不阻断业务"语义一并收紧（blast radius 过大）。
 */
export async function setItemStrict<T>(key: string, data: T, ttlMs?: number): Promise<void> {
  if (typeof wx === 'undefined') return;
  if (writesBlocked && !BARRIER_ALLOWLIST.has(key)) {
    throw new Error(`storage: write blocked (barrier open) · key=${key}`);
  }
  const envelope: Envelope<T> = { v: STORAGE_VERSION, t: Date.now(), ttl: ttlMs, d: data };
  // 不 catch：失败向上抛，由调用方决定中止流程（epoch reset 语义）。
  await wx.setStorage({ key, data: envelope });
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
