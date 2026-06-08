// utils/safeArea.ts · 统一安全区与自定义导航高度标准
// 卡号: COSTRA-214 · Refs: COSTRA-214
//
// ═══════════════════════════════════════════════════════════════════════
// 项目标准（COSTRA-214 约定）：
//
// 1. 全屏 overlay / 自定义导航 **不得** 直接依赖 CSS env(safe-area-inset-top)
//    做顶部安全区避让。微信开发者工具对 CSS env() 的支持/返回值与真机不一致，
//    导致开发者工具中内容被刘海/状态栏遮挡。
//
// 2. 必须使用 getSafeAreaMetrics() 获取安全区指标，通过 JS 计算 + inline style
//    设置 padding-top / padding-bottom，确保开发者工具与真机表现一致。
//
// 3. CSS env(safe-area-inset-bottom) 可作为底部 fallback（keypad-sheet 等），
//    但核心布局高度计算必须使用 JS metrics。
//
// 4. 所有页面/组件需要安全区数据时，统一从此模块获取，禁止各自调用
//    wx.getWindowInfo() / wx.getSystemInfoSync() / wx.getMenuButtonBoundingClientRect()。
// ═══════════════════════════════════════════════════════════════════════

/** 安全区与导航栏指标（所有值均为 px） */
export interface SafeAreaMetrics {
  /** 状态栏高度 */
  statusBarHeight: number;
  /** 胶囊按钮顶部（距屏幕顶部） */
  menuButtonTop: number;
  /** 胶囊按钮底部（距屏幕顶部） */
  menuButtonBottom: number;
  /** 胶囊按钮高度 */
  menuButtonHeight: number;
  /** 导航栏内容区高度（不含状态栏） */
  navBarHeight: number;
  /** 导航栏总高度 = statusBarHeight + navBarHeight */
  navBarTotalHeight: number;
  /** 顶部安全区 = navBarTotalHeight（给全屏 overlay / 自定义导航 header 避让使用） */
  safeAreaTop: number;
  /** 底部安全区（Home Indicator 区域高度） */
  safeAreaBottom: number;
  /** 可使用窗口高度 */
  windowHeight: number;
  /** 可使用窗口宽度 */
  windowWidth: number;
}

/** 缓存指标（进程生命周期内设备信息不变，避免重复调用 wx API） */
let _cache: SafeAreaMetrics | null = null;

/**
 * 获取统一安全区与导航栏指标。
 *
 * 计算逻辑：
 * - statusBarHeight：优先 wx.getWindowInfo()，fallback wx.getSystemInfoSync()，兜底 0
 * - menuButtonRect：wx.getMenuButtonBoundingClientRect()，try/catch 防御（开发者工具可能抛错）
 * - navBarHeight：(menuButtonTop - statusBarHeight) * 2 + menuButtonHeight（微信推荐公式），fallback 44
 * - navBarTotalHeight = statusBarHeight + navBarHeight
 * - safeAreaTop = navBarTotalHeight（全屏 overlay header 顶部避让值）
 * - safeAreaBottom = screenHeight - safeArea.bottom，兜底 0
 */
export function getSafeAreaMetrics(): SafeAreaMetrics {
  if (_cache) return _cache;

  // 1. 获取窗口信息
  let windowInfo: { statusBarHeight?: number; screenHeight?: number; safeArea?: { bottom?: number }; windowHeight?: number; windowWidth?: number };
  try {
    windowInfo = wx.getWindowInfo();
  } catch {
    try {
      windowInfo = wx.getSystemInfoSync();
    } catch {
      windowInfo = {};
    }
  }

  const statusBarHeight: number = windowInfo.statusBarHeight ?? 0;
  const screenHeight: number = windowInfo.screenHeight ?? 0;
  const safeAreaBottom = windowInfo.safeArea?.bottom ?? 0;
  const windowHeight: number = windowInfo.windowHeight ?? 0;
  const windowWidth: number = windowInfo.windowWidth ?? 0;

  // 2. 获取胶囊按钮信息
  let menuButtonTop = 0;
  let menuButtonBottom = 0;
  let menuButtonHeight = 0;
  try {
    const rect = wx.getMenuButtonBoundingClientRect();
    menuButtonTop = rect.top ?? 0;
    menuButtonBottom = rect.bottom ?? 0;
    menuButtonHeight = rect.height ?? 0;
  } catch {
    // 开发者工具可能不支持 getMenuButtonBoundingClientRect
    menuButtonTop = 0;
    menuButtonBottom = 0;
    menuButtonHeight = 0;
  }

  // 3. 计算导航栏高度
  // 微信推荐公式：(menuButtonTop - statusBarHeight) * 2 + menuButtonHeight
  // 当胶囊按钮信息不可用时，fallback 到 iOS 44px / Android 48px 的通用值
  let navBarHeight: number;
  if (menuButtonTop > 0 && menuButtonHeight > 0) {
    navBarHeight = (menuButtonTop - statusBarHeight) * 2 + menuButtonHeight;
  } else {
    navBarHeight = 44;
  }

  const navBarTotalHeight = statusBarHeight + navBarHeight;

  // 4. 计算底部安全区
  // safeAreaBottom = 屏幕底部到安全区底部的距离（Home Indicator 区域）
  const safeAreaBottomPx = screenHeight > 0 && safeAreaBottom > 0
    ? screenHeight - safeAreaBottom
    : 0;

  _cache = {
    statusBarHeight,
    menuButtonTop,
    menuButtonBottom,
    menuButtonHeight,
    navBarHeight,
    navBarTotalHeight,
    safeAreaTop: navBarTotalHeight,
    safeAreaBottom: safeAreaBottomPx,
    windowHeight,
    windowWidth,
  };

  return _cache;
}

/**
 * 重置安全区指标缓存。
 *
 * 仅用于单测场景，生产代码不应调用。
 */
export function resetSafeAreaMetricsCache(): void {
  _cache = null;
}
