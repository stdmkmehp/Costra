// tokens/index.ts · 从 docs/design/tokens.json 同步，只读常量
// 卡号: COSTRA-030 · COSTRA-011 · COSTRA-122
// ⚠️ 禁止手改；由 scripts/sync-tokens.mjs 生成（Sprint-2 FU-118-3 落地）· 当前阶段手工与 miniprogram/tokens/tokens.json 对齐
// ⚠️ 不要改为 "import x from './tokens.json'"——微信 runtime 不支持 .json loader（COSTRA-122 实证）
//    真因：微信小程序 CommonJS require loader 不识别 .json 扩展名作为可加载模块 · 会自动补 .js → module not defined
//    正确做法：JSON 数据必须以 TS `as const` 常量形式内联，编译为 JS 后 runtime 即可正常 require。

const tokensData = {
  meta: {
    name: 'Costra Design Tokens',
    version: '0.1.0',
  },
  color: {
    brand: {
      primary:        '#2F7A78',
      primaryHover:   '#256562',
      primaryPressed: '#1D504E',
      secondary:      '#F5A623',
      accent:         '#E85C5C',
    },
    semantic: {
      success: '#2E7D5B',
      warning: '#F5A623',
      danger:  '#D64545',
      info:    '#2F7A78',
    },
    role: {
      bg:     { app: '#FAFAFA', surface: '#FFFFFF', elevated: '#FFFFFF' },
      text:   { primary: '#212121', secondary: '#616161', tertiary: '#9E9E9E', onBrand: '#FFFFFF' },
      border: { default: '#E0E0E0', strong: '#BDBDBD' },
      amount: { expense: '#D64545', income: '#2E7D5B', transfer: '#616161' },
    },
  },
  spacing: {
    '1': '4rpx',
    '2': '8rpx',
    '3': '12rpx',
    '4': '16rpx',
    '6': '24rpx',
    '8': '32rpx',
  },
  radius: {
    sm:   '4rpx',
    md:   '8rpx',
    lg:   '12rpx',
    pill: '9999rpx',
  },
} as const;

export const tokens = tokensData;
export type Tokens = typeof tokens;

export const color = tokens.color;
export const spacing = tokens.spacing;
export const radius = tokens.radius;
// typography / shadow：v0.2 由设计同步后开放导出。
