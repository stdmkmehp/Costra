// utils/share.spec.ts · 分享内容构造单测
//
// 覆盖目标：
// 1. 推广型分享的 title/path/imageUrl 稳定不漂移（保护 CTA 文案一致性）
//    · onShareAppMessage 5:4 封面：https://developers.weixin.qq.com/miniprogram/dev/reference/api/Page.html#onShareAppMessage-Object-object
//    · onShareTimeline   1:1 封面：https://developers.weixin.qq.com/miniprogram/dev/reference/api/Page.html#onShareTimeline
//    （访问于 2026-07-16）
// 2. **协作邀请型分享** title / path 与旧版 family/index.ts 内联实现的行为逐字等价
//    ——旧行为对比锚：
//      title: `${familyName} 邀请你一起记账`
//      path:  `/pages/invite-confirm/index?token=${inviteToken}`
//    imageUrl 从旧版的"缺省（走微信页面截图）"升级为专属邀请封面图，此升级是纯增量优化，
//    不影响协作邀请任何状态机 / 副作用 / 关闭链路。
//    单测直接校验字面量，任何"顺手改文案"都会被立即拦截。
import { describe, it, expect } from 'vitest';
import {
  buildAppShareContent,
  buildTimelineShareContent,
  buildInviteShareContent,
} from './share';

describe('utils/share · buildAppShareContent（推广型 · onShareAppMessage）', () => {
  it('返回 title/path/imageUrl，值稳定', () => {
    const c = buildAppShareContent();
    expect(c.title).toBe('Costra · 开启记账之路');
    expect(c.path).toBe('/pages/ledger/index');
    expect(c.imageUrl).toBe('/assets/share/share-cover.png');
  });

  it('每次调用返回等价对象（无残留状态）', () => {
    expect(buildAppShareContent()).toEqual(buildAppShareContent());
  });
});

describe('utils/share · buildTimelineShareContent（推广型 · onShareTimeline）', () => {
  it('返回 title/query/imageUrl，query 为空字符串', () => {
    const c = buildTimelineShareContent();
    expect(c.title).toBe('Costra · 开启记账之路');
    expect(c.query).toBe('');
  });

  it('使用独立的 1:1 朋友圈封面图（不复用好友分享的 5:4 图）', () => {
    const c = buildTimelineShareContent();
    expect(c.imageUrl).toBe('/assets/share/share-cover-timeline.png');
    // 与 app share 的封面图必须不同 · 各自匹配微信官方规格（5:4 vs 1:1）
    expect(c.imageUrl).not.toBe(buildAppShareContent().imageUrl);
  });
});

describe('utils/share · buildInviteShareContent（协作邀请 · 行为等价性锁死）', () => {
  it('title 与旧版 family/index.ts 内联实现逐字一致', () => {
    const c = buildInviteShareContent('史蒂夫的小家', 'tok_abc123');
    expect(c.title).toBe('史蒂夫的小家 邀请你一起记账');
  });

  it('path 与旧版逐字一致（不做 URL 编码 · 与旧实现对齐）', () => {
    const c = buildInviteShareContent('anything', 'tok_abc123');
    expect(c.path).toBe('/pages/invite-confirm/index?token=tok_abc123');
  });

  it('携带专属邀请封面图（与旧版"走微信页面截图"的行为升级）', () => {
    const c = buildInviteShareContent('家庭', 'tok_x');
    expect(c.imageUrl).toBe('/assets/share/share-cover-invite.png');
  });

  it('邀请封面图必须与推广型好友分享 / 朋友圈图片各自独立（避免混用）', () => {
    const invite = buildInviteShareContent('家庭', 'tok_x').imageUrl;
    expect(invite).not.toBe(buildAppShareContent().imageUrl);
    expect(invite).not.toBe(buildTimelineShareContent().imageUrl);
  });

  it('familyName 含特殊字符（emoji / 空格）不影响 title 构造', () => {
    const c = buildInviteShareContent('🏠 小家 · 2026', 'tok_y');
    expect(c.title).toBe('🏠 小家 · 2026 邀请你一起记账');
  });

  it('inviteToken 原样拼接到 path（与旧代码模板字符串行为一致）', () => {
    const c = buildInviteShareContent('n', 'tok-with-dash_and_underscore');
    expect(c.path).toBe('/pages/invite-confirm/index?token=tok-with-dash_and_underscore');
  });
});
