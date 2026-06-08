/**
 * Costra · Server · 公告 DAO
 *
 * 职责：封装 announcements + announcement_reads 表的 SQL 访问。
 *
 * 查询语义：
 *   - 活跃公告 = published_at <= now() AND (expires_at IS NULL OR expires_at > now()) AND deleted_at IS NULL
 *   - 已读判定 = announcement_reads 中存在 (user_id, announcement_id) 记录
 */

import { getPool } from '../db/pool.js';

type Runner = { query: (sql: string, params?: unknown[]) => Promise<{ rows: Record<string, unknown>[]; rowCount?: number | null }> };

function exec(): Runner {
  return getPool() as unknown as Runner;
}

export interface AnnouncementRow {
  id: string;
  title: string;
  content: string;
  published_at: Date;
  expires_at: Date | null;
}

export interface AnnouncementWithRead extends AnnouncementRow {
  is_read: boolean;
}

/** 列出当前用户可见的活跃公告（含已读标记） */
export async function listActive(userId: string, client?: Runner): Promise<AnnouncementWithRead[]> {
  const runner = client ?? exec();
  const res = await runner.query(
    `SELECT a.id, a.title, a.content, a.published_at, a.expires_at,
            (ar.read_at IS NOT NULL) AS is_read
     FROM announcements a
     LEFT JOIN announcement_reads ar ON ar.announcement_id = a.id AND ar.user_id = $1
     WHERE a.deleted_at IS NULL
       AND a.published_at <= now()
       AND (a.expires_at IS NULL OR a.expires_at > now())
     ORDER BY a.published_at DESC`,
    [userId],
  );
  return res.rows.map(row => ({
    id: row.id as string,
    title: row.title as string,
    content: row.content as string,
    published_at: row.published_at as Date,
    expires_at: row.expires_at as Date | null,
    is_read: row.is_read === true || row.is_read === 'true',
  }));
}

/** 当前用户是否有未读公告 */
export async function hasUnread(userId: string, client?: Runner): Promise<boolean> {
  const runner = client ?? exec();
  const res = await runner.query(
    `SELECT 1
     FROM announcements a
     LEFT JOIN announcement_reads ar ON ar.announcement_id = a.id AND ar.user_id = $1
     WHERE a.deleted_at IS NULL
       AND a.published_at <= now()
       AND (a.expires_at IS NULL OR a.expires_at > now())
       AND ar.read_at IS NULL
     LIMIT 1`,
    [userId],
  );
  return res.rows.length > 0;
}

/** 标记公告为已读（幂等 · ON CONFLICT DO NOTHING · 公告不存在也不报错） */
export async function markRead(userId: string, announcementId: string, client?: Runner): Promise<boolean> {
  const runner = client ?? exec();
  try {
    const res = await runner.query(
      `INSERT INTO announcement_reads (user_id, announcement_id)
       VALUES ($1, $2)
       ON CONFLICT (user_id, announcement_id) DO NOTHING`,
      [userId, announcementId],
    );
    return (res.rowCount ?? 0) > 0;
  } catch {
    // FK 违规（公告不存在）→ 幂等返回 false
    return false;
  }
}
