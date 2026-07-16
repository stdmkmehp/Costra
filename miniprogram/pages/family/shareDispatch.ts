// pages/family/shareDispatch.ts · 协作页分享分派纯函数
//
// 提取自 pages/family/index.ts 的 onShareAppMessage 双态判定逻辑。
// 抽为纯函数以便单测锁死：给定输入必然产出确定的 decision，Page 层只负责
// 消费 decision（写副作用 / 返回内容），不再承担条件判断。
//
// 判定语义（严格保持与旧版 family/index.ts 内联实现的功能等价）：
//   - 邀请遮罩内 <button open-type="share">分享邀请</button> 触发时：opts.from === 'button'
//   - 右上角胶囊菜单"分享给朋友"触发时：opts.from === 'menu'
//   - 参考微信官方 Page.onShareAppMessage：
//     https://developers.weixin.qq.com/miniprogram/dev/reference/api/Page.html#onShareAppMessage-Object-object
//     （访问于 2026-07-16）
//
// 单测见 shareDispatch.spec.ts。

export interface FamilyShareInput {
  /** 微信 IShareAppMessageOption.from · 'button' | 'menu' | undefined */
  from: string | undefined;
  /** 当前遮罩已就绪的 invite token；未打开遮罩或未就绪时为空串 */
  pendingInviteToken: string;
}

export type FamilyShareDecision =
  | { kind: 'invite'; inviteToken: string }
  | { kind: 'promo' };

/**
 * 协作页 onShareAppMessage 分派。
 *
 * 场景 A（协作邀请）：opts.from === 'button' && pendingInviteToken 非空
 *   → 返回 { kind: 'invite', inviteToken }
 *   → 调用方须置 _pendingInviteShared = true（保留旧行为，让 onShow 关闭邀请遮罩且不 revoke token）
 *
 * 场景 B（推广型分享）：其它任意情况
 *   → 返回 { kind: 'promo' }
 *   → 调用方绝不触碰 _pendingInviteShared，避免右上角胶囊分享误关邀请遮罩
 */
export function dispatchFamilyShare(input: FamilyShareInput): FamilyShareDecision {
  if (input.from === 'button' && input.pendingInviteToken) {
    return { kind: 'invite', inviteToken: input.pendingInviteToken };
  }
  return { kind: 'promo' };
}
