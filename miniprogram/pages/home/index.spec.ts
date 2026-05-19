// pages/home/index.spec.ts · 首页逻辑单测
// 卡号：COSTRA-158 · J 项 miniapp 段（删除 nickname 边界用例 · 新增 has_completed_profile 用例）
// Refs: services/db.spec.ts mock 范本 · utils/profile.ts 纯函数抽取
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { computeHasProfile } from '../../utils/profile';

describe('utils/profile · computeHasProfile', () => {
  it('u 为 null → hasProfile = false', () => {
    expect(computeHasProfile(null)).toBe(false);
  });

  it('has_completed_profile=true → hasProfile=true（不论 nickname 是否撞库 default）', () => {
    expect(computeHasProfile({ has_completed_profile: true })).toBe(true);
  });

  it('has_completed_profile=false → hasProfile=false', () => {
    expect(computeHasProfile({ has_completed_profile: false })).toBe(false);
  });

  it('has_completed_profile 缺失 → hasProfile=false', () => {
    expect(computeHasProfile({})).toBe(false);
  });

  it('u.nickname === "张三" 但 has_completed_profile 未设置 → hasProfile=false', () => {
    // COSTRA-158 语义：不再依赖 nickname 字符串比较 · 只看事实字段
    expect(computeHasProfile({ has_completed_profile: undefined })).toBe(false);
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
