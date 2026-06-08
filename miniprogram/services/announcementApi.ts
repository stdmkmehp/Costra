// services/announcementApi.ts · 公告 API + 未读红点缓存
//
// 配套后端：
//   GET  /v1/announcements          → Announcement[]
//   POST /v1/announcements/:id/read → 204
//
// 红点策略：
//   - mine 页 onShow 时调 hasUnreadAnnouncements() 判断是否显示红点
//   - mine 页红点（tab 级）：点到 mine 页即消失（页面 data 控制）
//   - 公告菜单项红点：需用户真正阅读公告后才消失（后端 is_read 驱动）
//
// 缓存：
//   - _unreadCache: boolean | null，TTL 2min，避免频繁请求
//   - 标记已读后自动清除缓存

import { request } from './request';

export interface Announcement {
  id: string;
  title: string;
  content: string;
  published_at: string;
  is_read: boolean;
}

const UNREAD_TTL_MS = 2 * 60 * 1000;

interface UnreadCache {
  value: boolean;
  timestamp: number;
}

let _unreadCache: UnreadCache | null = null;

/** 清除未读缓存（标记已读后 / mine 页决定刷新时调用） */
export function invalidateAnnouncementCache(): void {
  _unreadCache = null;
}

/** 拉取公告列表 */
export async function getAnnouncements(): Promise<Announcement[]> {
  const data = await request<Announcement[]>({
    method: 'GET',
    path: '/announcements',
  });
  // 写入未读缓存：列表中有任何 is_read=false 即有未读
  const hasUnread = data.some(a => !a.is_read);
  _unreadCache = { value: hasUnread, timestamp: Date.now() };
  return data;
}

/** 标记公告为已读 */
export async function markAnnouncementRead(id: string): Promise<void> {
  await request({
    method: 'POST',
    path: `/announcements/${id}/read`,
  });
  invalidateAnnouncementCache();
}

/** 是否有未读公告（cache-first · 不命中则走网络） */
export async function hasUnreadAnnouncements(): Promise<boolean> {
  if (_unreadCache && Date.now() - _unreadCache.timestamp < UNREAD_TTL_MS) {
    return _unreadCache.value;
  }
  const list = await getAnnouncements();
  return list.some(a => !a.is_read);
}
