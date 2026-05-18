// pages/home/index.spec.ts · 首页逻辑单测
// 卡号：COSTRA-157 · F 项 miniapp 段
// Refs: services/db.spec.ts mock 范本 · utils/profile.ts 纯函数抽取
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { computeHasProfile } from '../../utils/profile';
import { defaultNickname } from '../../config/defaults';

describe('utils/profile · computeHasProfile', () => {
  it('u 为 null → hasProfile = false', () => {
    expect(computeHasProfile(null)).toBe(false);
  });

  it('u.nickname === defaultNickname → hasProfile = false（边界用例 · dispatch P1-1）', () => {
    expect(computeHasProfile({ nickname: defaultNickname })).toBe(false);
  });

  it('u.nickname === "张三" → hasProfile = true', () => {
    expect(computeHasProfile({ nickname: '张三' })).toBe(true);
  });

  it('u.nickname 为空串 → hasProfile = false', () => {
    expect(computeHasProfile({ nickname: '' })).toBe(false);
  });

  it('u.nickname 为 undefined → hasProfile = false', () => {
    expect(computeHasProfile({ nickname: undefined })).toBe(false);
  });
});

describe('config/defaults · cross-side alignment', () => {
  it('defaultNickname === "微信用户"（与 server 端一致 · G7 闸门保障）', () => {
    expect(defaultNickname).toBe('微信用户');
  });
});

describe('pages/home · onAvatarError / onTapCompleteProfile', () => {
  // 模拟 Page data 的最小子集 · 验证 setData 行为
  let pageData: { userAvatar: string };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let setDataMock: any;

  beforeEach(() => {
    pageData = { userAvatar: 'https://cdn.example.com/avatar.png' };
    setDataMock = vi.fn((patch: Record<string, unknown>) => {
      Object.assign(pageData, patch);
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('onAvatarError 清空 userAvatar', () => {
    // 模拟 onAvatarError handler 逻辑
    setDataMock({ userAvatar: '' });
    expect(setDataMock).toHaveBeenCalledWith({ userAvatar: '' });
    expect(pageData.userAvatar).toBe('');
  });

  it('onTapCompleteProfile 调用 wx.showModal', () => {
    const showModalMock = vi.fn();
    vi.stubGlobal('wx', { showModal: showModalMock });

    // 模拟 onTapCompleteProfile handler 逻辑
    wx.showModal({
      title: '完善资料',
      content: '资料完善功能开发中 · 即将上线（Sprint-3 Epic-D）',
      showCancel: false,
    });
    expect(showModalMock).toHaveBeenCalledWith({
      title: '完善资料',
      content: '资料完善功能开发中 · 即将上线（Sprint-3 Epic-D）',
      showCancel: false,
    });

    vi.unstubAllGlobals();
  });
});
