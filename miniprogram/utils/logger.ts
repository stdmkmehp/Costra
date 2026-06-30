// utils/logger.ts · 统一客户端日志
//
// 设计目标（对应日志梳理方案）：
//   1. 可读：每条日志带本地时间戳 HH:mm:ss.SSS，无需依赖 IDE 控制台时间列。
//   2. 分级：debug / info / warn / error 四级，沿用既有 [tag] 方括号模块前缀约定。
//   3. 生产降噪：按 wx.getAccountInfoSync().envVersion 门控
//        - release        → 仅放行 warn / error（周期/只读/写审计的 debug·info 静音）
//        - develop / trial → 全开（debug 及以上）
//   4. 隐私：写操作日志不脱敏（产品决策），调用方可自由传入完整 payload。
//
// 用法：
//   import { logger } from '../utils/logger';
//   logger.info('sync:pushDelta', 'sending', { ops: 3 });
//   logger.error('outbox:dead-letter', 'DATA LOSS RISK', { ref });

type Level = 'debug' | 'info' | 'warn' | 'error';

const ORDER: Record<Level, number> = { debug: 0, info: 1, warn: 2, error: 3 };

let minLevelCache: number | null = null;

/** release 仅 warn+；develop/trial（含未知/工具环境）全开 debug+ */
function minLevel(): number {
  if (minLevelCache != null) return minLevelCache;
  let env = '';
  try {
    env = wx.getAccountInfoSync?.().miniProgram?.envVersion ?? '';
  } catch {
    env = '';
  }
  minLevelCache = env === 'release' ? ORDER.warn : ORDER.debug;
  return minLevelCache;
}

function ts(): string {
  const d = new Date();
  const p = (n: number, l = 2): string => String(n).padStart(l, '0');
  return `${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}.${p(d.getMilliseconds(), 3)}`;
}

function emit(level: Level, tag: string, msg: string, data?: unknown): void {
  if (ORDER[level] < minLevel()) return;
  const head = `${ts()} [${tag}] ${msg}`;
  const fn =
    level === 'debug'
      ? console.log
      : level === 'info'
        ? console.info
        : level === 'warn'
          ? console.warn
          : console.error;
  if (data !== undefined) {
    fn(head, data);
  } else {
    fn(head);
  }
}

export const logger = {
  /** 周期/只读正常流程：心跳、轮询、列表拉取等。release 不输出。 */
  debug: (tag: string, msg: string, data?: unknown): void => emit('debug', tag, msg, data),
  /** 用户写操作审计、启动/登录等关键正向事件。release 不输出。 */
  info: (tag: string, msg: string, data?: unknown): void => emit('info', tag, msg, data),
  /** 可恢复异常：重试、降级、冲突等。release 输出。 */
  warn: (tag: string, msg: string, data?: unknown): void => emit('warn', tag, msg, data),
  /** 不可恢复失败：数据丢失风险、保存失败、页面加载失败等。release 输出。 */
  error: (tag: string, msg: string, data?: unknown): void => emit('error', tag, msg, data),
};

/** 测试用：重置环境级别缓存（单测切换 envVersion 时调用） */
export const __test__ = {
  resetMinLevel(): void {
    minLevelCache = null;
  },
};
