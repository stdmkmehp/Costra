// services/storageKeys.ts · storage key 常量的单一事实源
//
// 存在意义：ensureVersion() 在存储版本迁移时会清空 storage；PRESERVED_KEYS 中的 key 需例外保留，
//   否则会带来副作用：
//     - 鉴权 token 被清 → 用户被迫重新登录 → 平白新增 user_sessions 孤儿会话；
//     - 设备指纹被清 → 同一台设备"看起来像新设备" → 服务端登录时按设备回收旧会话失效。
//
// 独立成文件而非放 auth.ts：storage.ts 与 auth.ts 互相依赖（auth import storage），
//   常量下沉到无依赖的本模块可避免循环引用。

/** 本地持久化的鉴权 Token key（auth.ts 读写）。 */
export const TOKEN_KEY = '__costra_token_v1';

/** 客户端设备指纹 key（auth.ts 生成并随 wx-login 上报服务端）。 */
export const DEVICE_FP_KEY = '__costra_device_fp';

/** 版本迁移 clearStorage 时需保留（白名单）的 key。 */
export const PRESERVED_KEYS: readonly string[] = [TOKEN_KEY, DEVICE_FP_KEY];
