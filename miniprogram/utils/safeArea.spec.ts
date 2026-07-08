// utils/safeArea.spec.ts · 统一安全区指标单测
// 卡号: COSTRA-214 · Refs: COSTRA-214
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { getSafeAreaMetrics, resetSafeAreaMetricsCache } from './safeArea';

// wx 全局 mock
const mockGetWindowInfo = vi.fn();
const mockGetSystemInfoSync = vi.fn();
const mockGetMenuButtonBoundingClientRect = vi.fn();

const mockWx = {
  getWindowInfo: mockGetWindowInfo,
  getSystemInfoSync: mockGetSystemInfoSync,
  getMenuButtonBoundingClientRect: mockGetMenuButtonBoundingClientRect,
};

beforeEach(() => {
  resetSafeAreaMetricsCache();
  vi.stubGlobal('wx', mockWx);
  vi.clearAllMocks();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('utils/safeArea · getSafeAreaMetrics', () => {
  it('getWindowInfo + menuButton 正常返回时计算正确', () => {
    mockGetWindowInfo.mockReturnValue({
      statusBarHeight: 47,
      screenHeight: 812,
      safeArea: { bottom: 778 },
      windowHeight: 729,
      windowWidth: 375,
    });
    mockGetMenuButtonBoundingClientRect.mockReturnValue({
      top: 53,
      bottom: 83,
      height: 30,
      width: 87,
      left: 281,
      right: 368,
    });

    const m = getSafeAreaMetrics();

    expect(m.statusBarHeight).toBe(47);
    expect(m.menuButtonTop).toBe(53);
    expect(m.menuButtonBottom).toBe(83);
    expect(m.menuButtonHeight).toBe(30);
    // navBarHeight = (53 - 47) * 2 + 30 = 12 + 30 = 42
    expect(m.navBarHeight).toBe(42);
    // navBarTotalHeight = 47 + 42 = 89
    expect(m.navBarTotalHeight).toBe(89);
    // safeAreaTop = navBarTotalHeight = 89
    expect(m.safeAreaTop).toBe(89);
    // safeAreaBottom = 812 - 778 = 34
    expect(m.safeAreaBottom).toBe(34);
    // viewportBottomInset = 812 - 47 - 729 = 36，visual 取系统/反推/视觉最小值最大值
    expect(m.viewportBottomInset).toBe(36);
    expect(m.visualSafeAreaBottom).toBe(36);
    expect(m.windowHeight).toBe(729);
    expect(m.windowWidth).toBe(375);
  });

  it('getWindowInfo 抛错时 fallback 到 getSystemInfoSync', () => {
    mockGetWindowInfo.mockImplementation(() => { throw new Error('not available'); });
    mockGetSystemInfoSync.mockReturnValue({
      statusBarHeight: 20,
      screenHeight: 667,
      safeArea: { bottom: 667 },
      windowHeight: 667,
      windowWidth: 375,
    });
    mockGetMenuButtonBoundingClientRect.mockReturnValue({
      top: 26,
      bottom: 54,
      height: 28,
      width: 87,
      left: 281,
      right: 368,
    });

    const m = getSafeAreaMetrics();

    expect(m.statusBarHeight).toBe(20);
    // navBarHeight = (26 - 20) * 2 + 28 = 12 + 28 = 40
    expect(m.navBarHeight).toBe(40);
    expect(m.navBarTotalHeight).toBe(60);
    // safeAreaBottom = 667 - 667 = 0
    expect(m.safeAreaBottom).toBe(0);
    expect(m.viewportBottomInset).toBe(0);
    expect(m.visualSafeAreaBottom).toBe(20);
  });

  it('menuButton 抛错时 navBarHeight fallback 到 44', () => {
    mockGetWindowInfo.mockReturnValue({
      statusBarHeight: 47,
      screenHeight: 812,
      safeArea: { bottom: 778 },
      windowHeight: 729,
      windowWidth: 375,
    });
    mockGetMenuButtonBoundingClientRect.mockImplementation(() => {
      throw new Error('not available');
    });

    const m = getSafeAreaMetrics();

    expect(m.navBarHeight).toBe(44);
    expect(m.navBarTotalHeight).toBe(47 + 44);
    expect(m.safeAreaTop).toBe(47 + 44);
    expect(m.menuButtonTop).toBe(0);
    expect(m.menuButtonBottom).toBe(0);
    expect(m.menuButtonHeight).toBe(0);
  });

  it('safeAreaBottom 计算：screenHeight - safeArea.bottom', () => {
    mockGetWindowInfo.mockReturnValue({
      statusBarHeight: 44,
      screenHeight: 896,
      safeArea: { bottom: 860 },
      windowHeight: 812,
      windowWidth: 414,
    });
    mockGetMenuButtonBoundingClientRect.mockReturnValue({
      top: 50,
      bottom: 80,
      height: 30,
      width: 87,
      left: 320,
      right: 407,
    });

    const m = getSafeAreaMetrics();
    expect(m.safeAreaBottom).toBe(896 - 860);
    expect(m.viewportBottomInset).toBe(896 - 44 - 812);
    expect(m.visualSafeAreaBottom).toBe(40);
  });

  it('safeAreaBottom 兜底 0：screenHeight 或 safeArea.bottom 无效时', () => {
    mockGetWindowInfo.mockReturnValue({
      statusBarHeight: 44,
      // screenHeight 缺失
      safeArea: {},
      windowHeight: 800,
      windowWidth: 375,
    });
    mockGetMenuButtonBoundingClientRect.mockReturnValue({
      top: 50,
      bottom: 80,
      height: 30,
      width: 87,
      left: 320,
      right: 407,
    });

    const m = getSafeAreaMetrics();
    expect(m.safeAreaBottom).toBe(0);
    expect(m.viewportBottomInset).toBe(0);
    expect(m.visualSafeAreaBottom).toBe(20);
  });

  it('cache 行为：第二次调用不重复调用 wx API', () => {
    mockGetWindowInfo.mockReturnValue({
      statusBarHeight: 47,
      screenHeight: 812,
      safeArea: { bottom: 778 },
      windowHeight: 729,
      windowWidth: 375,
    });
    mockGetMenuButtonBoundingClientRect.mockReturnValue({
      top: 53,
      bottom: 83,
      height: 30,
      width: 87,
      left: 281,
      right: 368,
    });

    const m1 = getSafeAreaMetrics();
    const m2 = getSafeAreaMetrics();

    expect(m1).toBe(m2); // 同一引用
    expect(mockGetWindowInfo).toHaveBeenCalledTimes(1);
    expect(mockGetMenuButtonBoundingClientRect).toHaveBeenCalledTimes(1);
  });

  it('resetSafeAreaMetricsCache 后重新调用会刷新缓存', () => {
    mockGetWindowInfo.mockReturnValue({
      statusBarHeight: 47,
      screenHeight: 812,
      safeArea: { bottom: 778 },
      windowHeight: 729,
      windowWidth: 375,
    });
    mockGetMenuButtonBoundingClientRect.mockReturnValue({
      top: 53,
      bottom: 83,
      height: 30,
      width: 87,
      left: 281,
      right: 368,
    });

    getSafeAreaMetrics();
    resetSafeAreaMetricsCache();

    // 修改 mock 值
    mockGetWindowInfo.mockReturnValue({
      statusBarHeight: 20,
      screenHeight: 667,
      safeArea: { bottom: 667 },
      windowHeight: 667,
      windowWidth: 375,
    });

    const m = getSafeAreaMetrics();
    expect(m.statusBarHeight).toBe(20);
    expect(mockGetWindowInfo).toHaveBeenCalledTimes(2);
  });

  it('force=true 时跳过缓存并按新窗口尺寸重新计算', () => {
    mockGetWindowInfo.mockReturnValue({
      statusBarHeight: 47,
      screenHeight: 812,
      safeArea: { bottom: 778 },
      windowHeight: 729,
      windowWidth: 375,
    });
    mockGetMenuButtonBoundingClientRect.mockReturnValue({
      top: 53,
      bottom: 83,
      height: 30,
      width: 87,
      left: 281,
      right: 368,
    });

    const m1 = getSafeAreaMetrics();
    expect(m1.windowWidth).toBe(375);
    expect(m1.visualSafeAreaBottom).toBe(36);

    mockGetWindowInfo.mockReturnValue({
      statusBarHeight: 44,
      screenHeight: 896,
      safeArea: { bottom: 860 },
      windowHeight: 812,
      windowWidth: 414,
    });
    mockGetMenuButtonBoundingClientRect.mockReturnValue({
      top: 50,
      bottom: 80,
      height: 30,
      width: 87,
      left: 320,
      right: 407,
    });

    const m2 = getSafeAreaMetrics({ force: true });
    expect(m2).not.toBe(m1);
    expect(m2.windowWidth).toBe(414);
    expect(m2.safeAreaBottom).toBe(36);
    expect(m2.viewportBottomInset).toBe(40);
    expect(m2.visualSafeAreaBottom).toBe(40);
    expect(mockGetWindowInfo).toHaveBeenCalledTimes(2);
  });
});
