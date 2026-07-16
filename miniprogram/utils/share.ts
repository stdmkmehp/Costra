/**
 * share.ts · 分享内容唯一事实源
 *
 * 承担两类分享内容的构造：
 *
 * 1. **推广型分享**（拉新）
 *    - `buildAppShareContent`：好友分享（onShareAppMessage）· 5:4 封面
 *    - `buildTimelineShareContent`：朋友圈分享（onShareTimeline）· 1:1 封面
 *    - 通用推广卡，落地 pages/ledger/index，无业务参数
 *    - 由 ledger（好友+朋友圈）/ statistics / mine（仅好友）三个 tab 页调用；
 *      family 页在胶囊菜单分享时也走这里。
 *
 * 2. **协作邀请型分享**：`buildInviteShareContent`
 *    - 落地 pages/invite-confirm，携带 invite token
 *    - 仅由 family 页邀请遮罩内 <button open-type="share"> 触发
 *    - 与旧版本 family/index.ts 内联实现的功能等价（title/path 逐字一致 · 由 share.spec.ts 锁死）
 *
 * 微信官方文档（访问于 2026-07-16）：
 *   · Page.onShareAppMessage：
 *     https://developers.weixin.qq.com/miniprogram/dev/reference/api/Page.html#onShareAppMessage-Object-object
 *     图片推荐 5:4，返回 { title, path, imageUrl }
 *   · Page.onShareTimeline（基础库 2.11.3+）：
 *     https://developers.weixin.qq.com/miniprogram/dev/reference/api/Page.html#onShareTimeline
 *     图片推荐 1:1，返回 { title, query, imageUrl }；**不支持自定义 path**——落地页 = 分享时当前页
 */

const SHARE_TITLE = 'Costra · 开启记账之路';
const SHARE_PATH = '/pages/ledger/index';
const SHARE_IMAGE_APP = '/assets/share/share-cover.png';           // 5:4 · 好友分享
const SHARE_IMAGE_TIMELINE = '/assets/share/share-cover-timeline.png'; // 1:1 · 朋友圈

export function buildAppShareContent(): WechatMiniprogram.Page.ICustomShareContent {
  return {
    title: SHARE_TITLE,
    path: SHARE_PATH,
    imageUrl: SHARE_IMAGE_APP,
  };
}

export function buildTimelineShareContent(): WechatMiniprogram.Page.ICustomTimelineContent {
  return {
    title: SHARE_TITLE,
    query: '',
    imageUrl: SHARE_IMAGE_TIMELINE,
  };
}

/**
 * 构造协作邀请分享内容。
 *
 * 与旧版 family/index.ts 内联实现的功能等价（受 share.spec.ts 单测约束）：
 *   - title: `${familyName} 邀请你一起记账`
 *   - path:  `/pages/invite-confirm/index?token=${inviteToken}`
 *   - 不带 imageUrl（沿用旧行为，走微信页面截图）
 */
export function buildInviteShareContent(
  familyName: string,
  inviteToken: string,
): WechatMiniprogram.Page.ICustomShareContent {
  return {
    title: `${familyName} 邀请你一起记账`,
    path: `/pages/invite-confirm/index?token=${inviteToken}`,
  };
}
