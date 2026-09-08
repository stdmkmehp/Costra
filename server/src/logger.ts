/**
 * Costra · Server · 统一日志器配置工厂
 *
 * 设计：
 *   - production ：单目标落盘固定文件（默认 /var/log/costra/server.log
 *         → 宿主机 /data/logs/server，已 bind mount，且 02-prepare-dirs.sh 已 chown 给 node 用户）
 *       · 应用自身不做轮转，宿主机 logrotate（/etc/logrotate.d/costra-ops）是唯一轮转事实源；
 *         pino/file 底层 sonic-boom 以 O_APPEND 打开，copytruncate 截断后续写安全
 *       · 不再双写 stdout：docker json-file 只残留进程级未捕获异常等直接 stderr
 *   - development：pino-pretty 人类可读输出到 stdout（本地调试更友好）
 *   - test（及其它）：纯 JSON 输出到 stdout，保持与历史行为一致，不产生文件
 *
 * 返回 pino 配置对象（或 false），交给 Fastify 内部创建 pino 实例。
 * 不直接返回 pino 实例 —— Fastify 5 的 logger 字段只接受配置对象，
 * 实例需通过 loggerInstance 字段传入（参见 fastify/lib/logger-factory.js）。
 *
 * 落盘路径由 env.ts 统一管理（COSTRA_LOG_FILE），不在此处直接读 process.env。
 */

import { stdTimeFunctions, type Logger as PinoLogger } from 'pino';
import type { NodeEnv } from './config/env.js';

/**
 * 调度器 / 服务函数注入用最小日志契约（与 tipService.TipLog 同一风格）。
 *
 * 统一出口约束：业务模块一律注入本契约，禁止自行 pino() 建实例 —— 自建实例默认写
 * stdout，会绕开 production 落盘文件出口（docker logs 可见但 server.log 缺失，
 * report-error-logs.sh 每日扫描对其失明）。生产由 buildApp 注入 app.log 或带
 * module 标签的 child；测试注入 noop 对象。pino.Logger / FastifyBaseLogger 结构天然满足。
 */
export type ServiceLogger = Pick<PinoLogger, 'info' | 'warn' | 'error'>;

export type LogLevel = 'trace' | 'debug' | 'info' | 'warn' | 'error' | 'fatal';

export interface CreateLoggerOptions {
  /** 测试注入：彻底关闭日志器（Fastify 接收 false） */
  disable?: boolean;
  /** 生产落盘固定文件路径（由 env.logFile 传入） */
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

  // 生产：单目标落盘固定文件 · 轮转由宿主机 logrotate 统一负责（copytruncate）
  // pino/file 以 append 模式打开（sonic-boom 默认），logrotate 截断后写入不产生空洞
  if (nodeEnv === 'production') {
    return {
      ...base,
      transport: {
        target: 'pino/file',
        options: {
          destination: opts.logFile,
          mkdir: true,
        },
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
