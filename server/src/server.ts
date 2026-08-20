/**
 * Costra · Server · 进程入口
 *
 * 卡号：COSTRA-101 · DoD D2 bootstrap + 信号优雅关停
 *
 * 职责：
 *   1. loadEnv 校验通过 → buildApp
 *   2. listen on PORT → 就绪日志
 *   3. 监听 SIGINT / SIGTERM → 关闭 HTTP → closePool / closeRedis → 退出
 *   4. 顶层 unhandledRejection / uncaughtException 兜底
 */

import 'dotenv/config';
import { buildApp } from './app.js';
import { appEnv } from './config/env.js';
import { closePool } from './db/pool.js';
import { closeRedis } from './db/redis.js';

async function main(): Promise<void> {
  const env = appEnv();
  const app = await buildApp();

  const shutdown = async (signal: string): Promise<void> => {
    app.log.info({ signal }, 'shutting down');
    try {
      await app.close();
    } catch (err) {
      app.log.error({ err }, 'error while closing fastify');
    }
    try {
      await closePool();
    } catch (err) {
      app.log.error({ err }, 'error while closing pg pool');
    }
    try {
      await closeRedis();
    } catch (err) {
      app.log.error({ err }, 'error while closing redis');
    }
    process.exit(0);
  };

  process.on('SIGINT', () => void shutdown('SIGINT'));
  process.on('SIGTERM', () => void shutdown('SIGTERM'));
  process.on('unhandledRejection', (reason) => {
    app.log.fatal({ reason }, 'unhandledRejection');
    process.exit(1);
  });
  process.on('uncaughtException', (err) => {
    app.log.fatal({ err }, 'uncaughtException');
    process.exit(1);
  });

  try {
    await app.listen({ port: env.port, host: '0.0.0.0' });
    app.log.info({ port: env.port, nodeEnv: env.nodeEnv }, 'costra-server listening');
  } catch (err) {
    app.log.fatal({ err }, 'failed to bind port');
    process.exit(1);
  }
}

void main();
