/**
 * Costra · Server · /healthz 路由
 *
 * 卡号：COSTRA-101 · DoD D8 健康检查
 *
 * 设计：
 *   - 返回 200 + { status: 'ok', build_sha, now_utc }
 *   - 本轮不做"深探"（数据库 SELECT 1、Redis PING），避免启动期 DB/Redis 未就绪就 liveness 失败；
 *     Sprint-2+ 视运维需求再分 /healthz（liveness）/ /readyz（readiness）两套。
 */

import type { FastifyInstance } from 'fastify';
import { appEnv } from '../config/env.js';
import { ICP_INFO } from '../config/icp.js';

export async function registerHealthRoute(app: FastifyInstance): Promise<void> {
  app.get('/healthz', async (_req, reply) => {
    reply.code(200).send({
      status: 'ok',
      build_sha: appEnv().buildSha,
      now_utc: new Date().toISOString(),
      icp: ICP_INFO,
    });
  });
}
