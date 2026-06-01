// tokens/index.ts · Costra Design Tokens v2.0.0
// 卡号: COSTRA-200 · 全面重写：旧色彩体系 → 暖灰白/油墨暖黑/微信绿色彩体系
// 设计权威源: design/ui/design_spec.md §2
//
// ⚠️ 不要改为 "import x from './tokens.json'"——微信 runtime 不支持 .json loader（COSTRA-122 实证）
//    真因：微信小程序 CommonJS require loader 不识别 .json 扩展名作为可加载模块 · 会自动补 .js → module not defined
//    正确做法：JSON 数据必须以 TS `as const` 常量形式内联，编译为 JS 后 runtime 即可正常 require。

const tokensData = {
  meta: {
    name: 'Costra Design Tokens',
    version: '2.0.0',
  },

  color: {
    /** 基础色 · 二元色彩基调（油墨暖黑 + 暖灰白） */
    base: {
      warmInk:   '#1c1b1a',  // 油墨暖黑 · 主文字色
      boneWhite: '#f1f2ec',  // 暖灰白 · 主背景色
    },

    /** 强调色 · 微信生态原生交互色 */
    accent: {
      wxGreen: '#07C160',  // 微信品牌绿 · CTA 按钮主色
      wxBlue:  '#576B95',  // 微信蓝 · 文字链接色
    },

    /** 语义色 · 状态反馈 */
    semantic: {
      success: '#07C160',  // 微信绿
      warning: '#FA9D3B',  // 琥珀黄
      danger:  '#FA5151',  // 警示红
      info:    '#576B95',  // 微信蓝
    },

    /** 角色色 · 按功能语义分组 */
    role: {
      bg: {
        app:      '#f1f2ec',                     // 暖灰白 · 应用背景
        surface:  '#ffffff',                      // 纯白 · 卡片/容器背景
        elevated: '#ffffff',                      // 纯白 · 浮层背景
        navBar:   'rgba(255,255,255,0.85)',       // 毛玻璃导航栏
        tabBar:   'rgba(255,255,255,0.85)',       // 毛玻璃标签栏
        overlay:  'rgba(28,27,26,0.4)',           // 遮罩层
      },
      text: {
        primary:   '#1c1b1a',                    // 油墨暖黑 · 主文字
        secondary: 'rgba(28,27,26,0.48)',         // 中灰 · 辅助文字
        tertiary:  'rgba(28,27,26,0.28)',         // 浅灰 · 占位/标签
        onGreen:   '#ffffff',                     // 绿色按钮上的白字
        onDark:    'rgba(255,255,255,0.48)',      // 深色背景上的浅色文字
      },
      border: {
        default: 'rgba(28,27,26,0.08)',           // 默认边框
        subtle:  'rgba(28,27,26,0.05)',           // 极淡边框
      },
      amount: {
        expense: '#1c1b1a',  // 支出 · 油墨暖黑
        income:  '#07C160',  // 收入 · 微信绿
      },
      icon: {
        default:     'rgba(28,27,26,0.36)',       // 默认图标色
        selected:    '#1c1b1a',                    // 选中图标色
        tabDefault:  'rgba(28,27,26,0.28)',        // Tab 默认图标色
        tabSelected: '#1c1b1a',                    // Tab 选中图标色
      },
    },
  },

  /** 排版令牌 · Apple 极简排版层级 */
  typography: {
    fontSize: {
      display:  '112rpx',  // 超大数字 · 金额震撼
      headline: '56rpx',   // 大标题
      title:    '42rpx',   // 标题
      body:     '28rpx',   // 正文
      caption:  '24rpx',   // 辅助说明
      mini:     '20rpx',   // 极小标注
    },
    fontWeight: {
      regular:  '400',
      medium:   '500',
      semibold: '600',
      bold:     '700',
    },
    lineHeight: {
      tight:  '1.07',   // 极紧凑 · 视差缩放标题
      snug:   '1.2',    // 紧凑 · 大数字
      normal: '1.5',    // 标准 · 正文
    },
    letterSpacing: {
      display: '-2rpx',  // 负字距 · 超大标题
      headline: '-1rpx', // 微负字距 · 大标题
      title:    '0',     // 标题 · 默认
      body:     '0',     // 正文 · 默认
      caption:  '0',     // 辅助 · 默认
      mini:     '0',     // 极小 · 默认
    },
  },

  /** 间距令牌 · 保持沿用 */
  spacing: {
    '1': '4rpx',
    '2': '8rpx',
    '3': '12rpx',
    '4': '16rpx',
    '6': '24rpx',
    '8': '32rpx',
  },

  /** 圆角令牌 · 保持沿用 */
  radius: {
    sm:   '4rpx',
    md:   '8rpx',
    lg:   '12rpx',
    pill: '9999rpx',
  },

  /** 阴影令牌 · 克制的深度（仅 subtle 一级） */
  shadow: {
    subtle: 'rgba(0,0,0,0.22) 3px 5px 30px 0px',
  },

  /** 毛玻璃令牌 */
  blur: {
    navBar: '20px',
    tabBar: '20px',
  },

  /** 动画令牌 */
  animation: {
    duration: {
      fast:   '150ms',
      normal: '250ms',
      slow:   '350ms',
    },
    easing: {
      default:   'cubic-bezier(0.25, 0.1, 0.25, 1)',
      easeIn:    'cubic-bezier(0.42, 0, 1, 1)',
      easeOut:   'cubic-bezier(0, 0, 0.58, 1)',
      easeInOut: 'cubic-bezier(0.42, 0, 0.58, 1)',
    },
  },
} as const;

// ---- 导出 ----
export const tokens = tokensData;
export type Tokens = typeof tokens;

export const color    = tokens.color;
export const typography = tokens.typography;
export const spacing  = tokens.spacing;
export const radius   = tokens.radius;
export const shadow   = tokens.shadow;
export const blur     = tokens.blur;
export const animation = tokens.animation;
