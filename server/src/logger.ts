/**
 * Costra · Server · 统一日志器配置工厂
 *
 * 设计：
 *   - production ：日志同时落盘 + 输出 stdout
 *       · 落盘：pino-roll 写入 /var/log/costra/server（当前活动文件 server.1.log ·
 *         轮转后改名 server.YYYY-MM-DD.log · 按天 + 100MB 双触发 · 保留 5 份）
 *         → 宿主机对应 /data/logs/server（已 bind mount，且 02-prepare-dirs.sh 已 chown 给 node 用户）
 *       · stdout：保留给 docker json-file 驱动，让 `docker logs` 继续可用
 *   - development：pino-pretty 人类可读输出到 stdout（本地调试更友好）
 *   - test（及其它）：纯 JSON 输出到 stdout，保持与历史行为一致，不产生文件
 *
 * 返回 pino 配置对象（或 false），交给 Fastify 内部创建 pino 实例。
 * 不直接返回 pino 实例 —— Fastify 5 的 logger 字段只接受配置对象，
 * 实例需通过 loggerInstance 字段传入（参见 fastify/lib/logger-factory.js）。
 *
 * 落盘路径由 env.ts 统一管理（COSTRA_LOG_FILE），不在此处直接读 process.env。
 */

import { stdTimeFunctions } from 'pino';
import type { NodeEnv } from './config/env.js';

export type LogLevel = 'trace' | 'debug' | 'info' | 'warn' | 'error' | 'fatal';

export interface CreateLoggerOptions {
  /** 测试注入：彻底关闭日志器（Fastify 接收 false） */
  disable?: boolean;
  /** 生产落盘文件基名（由 env.logFile 传入） */
  logFile?: string;
}

/** pino 配置对象或 false（关日志） */
export type LoggerConfig = Record<string, unknown> | false;

export function createLogger(
  nodeEnv: NodeEnv,
  logLevel: LogLevel,
  opts: CreateLoggerOptions = {},
): LoggerConfig {
  if (opts.disable) return false;

  // 基础选项：ISO 8601 时间戳（UTC，带 Z 后缀），人可直读
  const base = {
    level: logLevel,
    timestamp: stdTimeFunctions.isoTime,
  };

  // 生产：落盘（带轮转）+ stdout，二者并存
  if (nodeEnv === 'production') {
    return {
      ...base,
      transport: {
        targets: [
          {
            // 落盘文件 · 按天 + 大小双触发轮转 · 保留最近 5 份
            target: 'pino-roll',
            options: {
              file: opts.logFile,
              frequency: 'daily',
              size: '100m',
              // pino-roll v4：limit 必须是对象 { count }，不再是数字
              limit: { count: 5 },
              mkdir: true,
            },
          },
          {
            // stdout · 交给 docker json-file 继续做 docker logs
            target: 'pino/file',
            options: { destination: 1 },
          },
        ],
      },
    };
  }

  // 开发：人类可读
  if (nodeEnv === 'development') {
    return {
      ...base,
      transport: {
        target: 'pino-pretty',
        options: {
          destination: 1,
          translateTime: 'SYS:standard',
          ignore: 'pid,hostname',
        },
      },
    };
  }

  // test 及其它：纯 JSON 到 stdout，保持历史行为
  return base;
}
