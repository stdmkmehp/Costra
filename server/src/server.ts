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
  if (env.wxMockLogin) {
    // 动态 import 避免污染 prod bundle
    const { setWxFetchForTests } = await import('./wx/code2Session.js');
    setWxFetchForTests(
      (async () =>
        new Response(
          JSON.stringify({
            openid: 'mock-openid-' + Math.random().toString(36).slice(2, 10),
            session_key: 'mock-session-key',
          }),
          { status: 200, headers: { 'content-type': 'application/json' } },
        )) as unknown as typeof fetch,
    );
  }
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
  if (env.wxMockLogin) {
    app.log.warn(
      { wxMockLogin: true },
      '⚠️  WX_MOCK_LOGIN enabled · code2Session mocked · DO NOT enable in production',
    );
  }
  } catch (err) {
    app.log.fatal({ err }, 'failed to bind port');
    process.exit(1);
  }
}

void main();
