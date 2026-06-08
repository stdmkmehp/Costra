// pages-family/bulletin/index.ts · 公告列表页
//
// 红点逻辑：
//   - 进入页面时自动拉取公告列表
//   - 展开未读公告时自动标记已读 + 刷新红点
//   - 所有公告已读后广播 ANNOUNCEMENT_UNREAD_CHANGED → mine 页红点消失

import { getAnnouncements, markAnnouncementRead } from '../../services/announcementApi';
import { eventBus, EventNames } from '../../services/eventBus';

interface AnnouncementItem {
  id: string;
  title: string;
  content: string;
  published_at: string;
  is_read: boolean;
  expanded: boolean;
}

Page({
  data: {
    list: [] as AnnouncementItem[],
    loading: true,
  },

  onShow() {
    void this._loadAnnouncements();
  },

  async _loadAnnouncements() {
    try {
      const raw = await getAnnouncements();
      const list: AnnouncementItem[] = raw.map(a => ({
        ...a,
        expanded: false,
        published_at: _formatDate(a.published_at),
      }));
      this.setData({ list, loading: false });
    } catch {
      this.setData({ loading: false });
    }
  },

  async onTapItem(e: WechatMiniprogram.TouchEvent) {
    const idx = e.currentTarget.dataset.index as number;
    const item = this.data.list[idx];

    // 切换展开状态
    const expanded = !item.expanded;
    this.setData({ [`list[${idx}].expanded`]: expanded });

    // 展开未读公告 → 标记已读
    if (expanded && !item.is_read) {
      try {
        await markAnnouncementRead(item.id);
        this.setData({ [`list[${idx}].is_read`]: true });
        // 广播未读状态变更
        eventBus.emit(EventNames.ANNOUNCEMENT_UNREAD_CHANGED);
      } catch { /* 静默：标记失败不影响阅读 */ }
    }
  },
});

/** 将 ISO 日期格式化为 YYYY年M月D日 */
function _formatDate(iso: string): string {
  const d = new Date(iso);
  return `${d.getFullYear()}年${d.getMonth() + 1}月${d.getDate()}日`;
}
