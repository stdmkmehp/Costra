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
import { types } from 'pg';
import { appEnv } from '../config/env.js';

/**
 * 全局类型解析器注册：禁用 pg driver 对 DATE 列（OID 1082）的自动 Date 转换。
 *
 * 背景：pg driver 默认把 DATE 列按"服务器本地时区 0 点"解析为 JS Date 对象
 * （如 Asia/Shanghai +8 下 '2026-08-05' → 2026-08-04T16:00:00Z）。
 * 业务代码对 start_date / end_date 等纯日期字段只需 'YYYY-MM-DD' 字符串，
 * 自动转换会引入跨时区偏移（getUTCDate() 取到前一天），导致每保存一次日期提前一天。
 *
 * 让 DATE 列保持原始字符串返回，由业务侧（如 recurringRepo.toIsoDate 的 string 分支）
 * 直接 slice(0,10) 取用。TIMESTAMPTZ / TIMESTAMP 列仍走默认 Date 转换不受影响。
 */
types.setTypeParser(types.builtins.DATE, (s: string) => s);

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
