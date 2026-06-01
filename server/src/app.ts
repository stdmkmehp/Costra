/**
 * Costra · Server · Fastify app 工厂
 *
 * 卡号：COSTRA-101 · 依据：ADR-0006 §2.1（已定 Fastify 5.x）
 *
 * buildApp() 负责：
 *   1. 构造 Fastify 实例（pino logger + trace_id）
 *   2. 挂 CORS / sensible
 *   3. 注册 JWT 签发 / 校验 decorator
 *   4. 注册统一错误处理（setErrorHandler + setNotFoundHandler）
 *   5. 注册业务路由：/auth/* + /healthz + /entries + /sync/*
 *
 * 注意：
 *   - 不在此文件启动监听（由 server.ts 负责 listen + 优雅关停）；
 *   - 本函数返回未监听的 FastifyInstance，供单测直接 inject。
 */

import Fastify, { type FastifyInstance, type FastifyServerOptions } from 'fastify';
import cors from '@fastify/cors';
import sensible from '@fastify/sensible';
import { randomUUID } from 'node:crypto';
import { appEnv } from './config/env.js';
import { registerErrorHandler } from './plugins/errorHandler.js';
import { registerJwt } from './plugins/jwt.js';
import { registerAuthRoutes } from './routes/auth.js';
import { registerHealthRoute } from './routes/healthz.js';
import { registerEntriesRoutes } from './routes/entries.js';
import { registerSyncRoutes } from './routes/sync.js';
import { registerLegalRoutes } from './routes/legal.js';
import { registerUsersRoutes } from './routes/users.js';
import { registerCategoriesRoutes } from './routes/categories.js';

export interface BuildAppOptions {
  /** 测试注入：禁用 logger 以避免 vitest 日志噪音 */
  disableLogger?: boolean;
}

export async function buildApp(opts: BuildAppOptions = {}): Promise<FastifyInstance> {
  const env = appEnv();

  const fastifyOpts: FastifyServerOptions = {
    // pino logger（test 环境可关）
    logger: opts.disableLogger
      ? false
      : {
          level: env.logLevel,
          // 生产建议输出 JSON；开发可通过 pino-pretty 美化
        },
    // 每个请求生成 trace_id（作为 req.id 透传到日志 + 错误响应 trace_id 字段）
    genReqId: () => randomUUID(),
    // 严格 JSON 模式：body 非 JSON 时 Fastify 直接 400；由 errorHandler 映射为 MALFORMED_JSON
    bodyLimit: 1 * 1024 * 1024, // 1 MiB 登录请求体足够
    trustProxy: true, // 与反向代理（Nginx / 云 SLB）协作获取真实 IP
  };

  const app = Fastify(fastifyOpts);

  // --- 基础插件 ---
  await app.register(cors, {
    origin: true, // MVP：允许小程序域 + 本地调试；生产走反代白名单
    credentials: false,
  });
  await app.register(sensible);

  // --- 核心插件 ---
  await registerJwt(app);
  await registerErrorHandler(app);

  // --- 业务路由 ---
  // healthz 保留根路径（K8s/SLB liveness probe 惯例 · 不进 v1 prefix）
  await registerHealthRoute(app);
  // 业务路由全部进 /v1 prefix 子作用域（COSTRA-156 · 让实装服从 OpenAPI servers 契约）
  await app.register(async (v1) => {
    await registerAuthRoutes(v1);
    await registerEntriesRoutes(v1);
    await registerSyncRoutes(v1);
    await registerLegalRoutes(v1);
    await registerUsersRoutes(v1);
    await registerCategoriesRoutes(v1);
  }, { prefix: '/v1' });

  return app;
}
