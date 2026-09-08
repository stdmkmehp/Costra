// 家庭分包 · 设置页
// 「GM 工具」分区仅 users.is_gm 用户可见（docs/ops/gm-impersonate-design.md · onShow 实时读 token）
// 「账本导入 / 导出」入口：小绿点 = 存在未读的已完成数据任务；副文案三态优先级
// （进行中 > 有完成未看 > 默认 · data-import-export v1.0 §8.1）
import { getToken } from '../../services/auth';
import { listDataJobs, getSeenCompletedJobIds } from '../../services/dataJobApi';

const DATA_JOB_SUBTEXT_DEFAULT = 'CSV 导入 · 导出';

Page({
  data: {
    isGm: false,
    showDataJobDot: false,
    dataJobSubtext: DATA_JOB_SUBTEXT_DEFAULT,
  },

  onShow() {
    this.setData({ isGm: getToken()?.raw.user.is_gm === true });
    void this._refreshDataJobEntry();
  },

  /** 入口行：绿点 + 三态副文案（§8.1 · 单次列表拉取同时驱动两者 · 失败静默保持现状） */
  async _refreshDataJobEntry() {
    try {
      const [{ jobs }, seen] = await Promise.all([listDataJobs(), getSeenCompletedJobIds()]);
      const running = jobs.filter((j) => j.status === 'queued' || j.status === 'processing').length;
      const unseen = jobs.some((j) => j.status === 'succeeded' && !seen.includes(j.id));
      const dataJobSubtext =
        running > 0
          ? `${running} 个任务进行中`
          : unseen
            ? '有已完成的导入 / 导出结果'
            : DATA_JOB_SUBTEXT_DEFAULT;
      // 异步回调需确认目标视图仍有效（onShow 竞态下多次 setData 幂等无害）
      this.setData({ showDataJobDot: unseen, dataJobSubtext });
    } catch {
      // 网络失败：保持既有展示（不闪烁）
    }
  },

  onTapDataManagement() {
    wx.navigateTo({ url: '/pages-family/settings/data-management/index' });
  },

  onTapGmImpersonate() {
    wx.navigateTo({ url: '/pages-gm/impersonate/index' });
  },
});
