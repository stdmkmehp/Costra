/**
 * Costra · Server · 用户级别 entries 聚合（mine 页宏观数据）
 *
 * 卡号：mine-overview · 事实源：server/db/migrations/0001_init.sql `entries` 表 + idx_entries_created_by
 *
 * 职责：返回当前用户跨所有账本的宏观计数。
 *   - 不区分 ledger / family —— "mine" 页语义 = 用户级（跨所有账本）。
 *   - 走 idx_entries_created_by 索引；用户量 < 1万条流水时 < 50ms。
 *
 * 设计取舍：
 *   - 选 A 方案（实时 SQL）而非 B（users 表冗余字段）：
 *     · A 简单/可信/可演进；B 写复杂、删除当天最后一条要 -1 ledger_days、冲突重试要回滚。
 *   - SQL 仅取 occurred_at 列 + COUNT(*)，DISTINCT 日期分桶在 JS 层做。
 *     原因：pg-mem 已知问题——`COUNT(DISTINCT expr)` 不去重；
 *     另外 `AT TIME ZONE 'literal'` 也不被 pg-mem 支持（与 statisticsService 同款约束）。
 *     真实 PG 完全支持，但项目惯例：时区分桶都在 JS 做（参考 statisticsRepo.ts §72-82）。
 *   - Asia/Shanghai 全年 UTC+8（无 DST）→ 用固定 +8h 偏移即可，等价于 AT TIME ZONE。
 */

import { getPool } from '../db/pool.js';

type Runner = { query: (sql: string, params?: unknown[]) => Promise<{ rows: Record<string, unknown>[]; rowCount?: number | null }> };

function exec(): Runner {
  return getPool() as unknown as Runner;
}

export interface UserOverview {
  /** 总记账笔数（含 income / expense / transfer · 不含 deleted） */
  entry_count: number;
  /** 有记账记录的天数（按 occurred_at 在 Asia/Shanghai 时区下的 DISTINCT date） */
  ledger_days: number;
}

const SHANGHAI_OFFSET_MS = 8 * 60 * 60 * 1000;

/** 把 UTC ISO 字符串/Date 转为 Asia/Shanghai 时区下的 YYYY-MM-DD 字符串 */
function toShanghaiDateKey(occurredAt: string | Date): string {
  const ms = typeof occurredAt === 'string' ? Date.parse(occurredAt) : occurredAt.getTime();
  const shifted = new Date(ms + SHANGHAI_OFFSET_MS);
  // 取 shifted 的 UTC 部分（已加 +8h）即可视作 Shanghai 本地时间组件
  const y = shifted.getUTCFullYear();
  const m = String(shifted.getUTCMonth() + 1).padStart(2, '0');
  const d = String(shifted.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

/**
 * 单 SQL 拉取用户的所有 entries 时间戳（按 created_by · 不区分 ledger），
 * JS 层做 entry_count + Asia/Shanghai DISTINCT date。
 */
export async function getUserOverview(userId: string, client?: Runner): Promise<UserOverview> {
  const runner = client ?? exec();
  const res = await runner.query(
    `SELECT occurred_at
     FROM entries
     WHERE created_by = $1
       AND deleted_at IS NULL`,
    [userId],
  );
  const dateSet = new Set<string>();
  for (const row of res.rows) {
    const occurredAt = row.occurred_at as string | Date | undefined;
    if (!occurredAt) continue;
    dateSet.add(toShanghaiDateKey(occurredAt));
  }
  return {
    entry_count: res.rows.length,
    ledger_days: dateSet.size,
  };
}
