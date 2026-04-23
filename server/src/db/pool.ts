/**
 * Costra · Server · PostgreSQL 连接池
 *
 * 卡号：COSTRA-101 · 依据：ADR-0006 §2.2 PostgreSQL 15 + pg 8.x
 *
 * 设计：
 *   - 全进程单例 Pool；业务层通过 getPool() 拿 Pool，手动或借 tx 执行查询。
 *   - 本文件不定义"事务包装器"（将在 repositories 层具体用到时再加），保持基础设施层轻量。
 *   - 测试：用 pg-mem 构造 IBackend，注入自定义 Pool；详见 server/test/setup.ts。
 */

import { Pool, type PoolConfig, type PoolClient } from 'pg';
import { appEnv } from '../config/env.js';

let _pool: Pool | null = null;

/** 返回单例 Pool；首次调用时按 appEnv 初始化。 */
export function getPool(): Pool {
  if (_pool == null) {
    const cfg: PoolConfig = {
      connectionString: appEnv().databaseUrl,
      // 合理的默认池配置：小家庭应用流量极小，max=10 足矣；按需在 env 继续扩展
      max: 10,
      idleTimeoutMillis: 30_000,
      connectionTimeoutMillis: 5_000,
    };
    _pool = new Pool(cfg);
  }
  return _pool;
}

/**
 * 注入自定义 Pool（仅测试使用）。
 * 测试 setup 中用 pg-mem 构造完 Pool 后调用 setPoolForTests(poolMock)。
 */
export function setPoolForTests(pool: Pool): void {
  _pool = pool;
}

/**
 * 简单事务辅助：在一个连接上顺序执行 fn；抛错自动 ROLLBACK；成功 COMMIT。
 * 用法：
 *   await withTx(async (client) => { await client.query(...); });
 */
export async function withTx<T>(fn: (client: PoolClient) => Promise<T>): Promise<T> {
  const client = await getPool().connect();
  try {
    await client.query('BEGIN');
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    try {
      await client.query('ROLLBACK');
    } catch {
      /* swallow rollback error to not mask原 err */
    }
    throw err;
  } finally {
    client.release();
  }
}

/** 优雅关闭：进程退出 / 测试拆解时调用。 */
export async function closePool(): Promise<void> {
  if (_pool != null) {
    await _pool.end();
    _pool = null;
  }
}
