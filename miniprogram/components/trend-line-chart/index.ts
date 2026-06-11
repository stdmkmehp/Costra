// components/trend-line-chart/index.ts · 极简静态趋势折线图（SVG 实现）
// 卡号: COSTRA-230 · 设计源: docs/design/statistics-page-tech-spec.md §4.3
//
// 职责：接收 number[] 数据，绘制平滑 Bezier 曲线 + 可选底部渐变。
//   - 不响应任何手势（明确为「Static Visual Trend」)
//   - 以极弱辅助线提示周期节奏，以唯一峰值标注补充关键信息
//   - 容错：data 为空 / 全 0 / 单点 → 绘制平直中线（不报错）
//
// 实现：将 SVG 字符串编码为 data:image/svg+xml;base64,… URI，作为 <image> 的 src。
//   - 选择 SVG 而非 <canvas type="2d">：canvas 是同层渲染原生组件，
//     页面快速滚动时与文本之间存在位置同步滞后；SVG 走 WebView 同线程
//     渲染，与文本零滞后跟随。
//   - 必须用 base64 编码：微信小程序 <image> 仅支持 data:image/svg+xml;base64,…，
//     不支持 ;utf8, 形式（H5 浏览器支持，但小程序不行）。
//   - viewBox 与容器实际比例对齐：避免 stroke 线宽被非均匀缩放变形。
//
// 性能：data 长度 ≤ 31（月度）或 12（年度），单次 setData 字符串约 ~2KB · 不做动画。
//
// 接口（保持稳定 · 与 v1 canvas 版本一致）：
//   data: number[]        — 数据点
//   height: number        — 高度（rpx）
//   color: string         — 折线颜色
//   fillGradient: bool    — 底部渐变填充
//   periodDividers: int[] — 周期分隔线索引（极淡虚线）
//   currentIndex: int     — 当前日/月索引（稍强虚线，-1 不显示）
//   peakIndex: int        — 峰值点索引（-1 不显示）
//   peakLabel: string     — 峰值标签文本

/**
 * SVG viewBox 尺寸（虚拟单位 · 不是物理像素）。
 * 选 750 × height(rpx) 是为了与小程序 rpx 坐标系 1:1 对齐：
 *   小程序"屏幕基准宽度 = 750rpx"，所以 viewBox 宽用 750 时，
 *   stroke-width 在视觉上就等于 rpx。
 */
const VIEW_W = 750;
/** 上下 padding（viewBox 单位）· 避免线贴边 */
const PAD_TOP = 12;
const PAD_BOTTOM = 8;
const PERIOD_LINE_OPACITY = 0.08;
const CURRENT_LINE_OPACITY = 0.18;
const PEAK_LABEL_FONT_SIZE = 24;
const PEAK_LABEL_HEIGHT = 30;
const PEAK_LABEL_GAP = 14;
const PEAK_LABEL_MARGIN = 8;

Component({
  properties: {
    /** 数据点 · 长度 = 当月天数（28~31）或 12（年度） */
    data: {
      type: Array,
      value: [] as number[],
    },
    /** 高度（rpx） */
    height: {
      type: Number,
      value: 160,
    },
    /** 折线颜色 · 默认油墨黑 */
    color: {
      type: String,
      value: '#1c1b1a',
    },
    /** 底部渐变填充（柔和阴影感） */
    fillGradient: {
      type: Boolean,
      value: true,
    },
    /** 周期分隔线索引（极淡虚线） */
    periodDividers: {
      type: Array,
      value: [] as number[],
    },
    /** 当前日/月索引（稍强虚线，-1 不显示） */
    currentIndex: {
      type: Number,
      value: -1,
    },
    /** 峰值点索引（-1 不显示） */
    peakIndex: {
      type: Number,
      value: -1,
    },
    /** 峰值标签文本 */
    peakLabel: {
      type: String,
      value: '',
    },
  },

  data: {
    /** 用于避免同页面多实例 SVG <linearGradient id> 冲突 */
    instanceId: '',
    /** data:image/svg+xml;base64,… URI · 作为 <image> 的 src */
    svgUri: '',
  },

  lifetimes: {
    attached() {
      this.setData({
        instanceId: Math.random().toString(36).slice(2, 10),
      }, () => {
        this._render();
      });
    },
  },

  observers: {
    'data, color, fillGradient, height, periodDividers, currentIndex, peakIndex, peakLabel': function () {
      // instanceId 在 attached 中先设；之后任何 prop 变化都重新生成 SVG
      if (this.data.instanceId) this._render();
    },
  },

  methods: {
    /** 计算并 setData svgUri */
    _render() {
      const props = this.properties as unknown as {
        data: number[];
        height: number;
        color: string;
        fillGradient: boolean;
        periodDividers: number[];
        currentIndex: number;
        peakIndex: number;
        peakLabel: string;
      };
      const data = Array.isArray(props.data) ? props.data : [];
      const heightRpx = props.height || 160;
      const color = props.color || '#1c1b1a';
      const fillGradient = props.fillGradient !== false;
      const periodDividers = Array.isArray(props.periodDividers) ? props.periodDividers : [];
      const svg = buildSvg({
        data,
        heightRpx,
        color,
        fillGradient,
        instanceId: this.data.instanceId,
        periodDividers,
        currentIndex: props.currentIndex,
        peakIndex: props.peakIndex,
        peakLabel: props.peakLabel || '',
      });
      this.setData({ svgUri: svgToDataUri(svg) });
    },
  },
});

// ═══════════════════════════════════════════════════════════════
// 纯函数：构造 SVG 字符串
// ═══════════════════════════════════════════════════════════════

interface BuildSvgOptions {
  data: number[];
  heightRpx: number;
  color: string;
  fillGradient: boolean;
  instanceId: string;
  periodDividers: number[];
  currentIndex: number;
  peakIndex: number;
  peakLabel: string;
}

/**
 * 根据数据点生成 SVG 字符串。
 * 容错：
 *  - data 为空 → 半透明中线
 *  - data 全 0 → 底部 30% 透明度直线 + 周期辅助线
 *  - data 单点 → 中线
 *
 * viewBox = "0 0 750 height"（与小程序 rpx 坐标系 1:1）
 */
function buildSvg(options: BuildSvgOptions): string {
  const { data, heightRpx, color, fillGradient, instanceId, periodDividers, currentIndex, peakIndex, peakLabel } = options;
  const viewH = heightRpx;
  const drawH = viewH - PAD_TOP - PAD_BOTTOM;
  const gradId = `g${instanceId || '0'}`;
  const rgb = hexToRgb(color);
  const lineWidth = 4; // rpx，约等于 1.8px

  // 空数据：半透明中线
  if (data.length < 1) {
    const mid = PAD_TOP + drawH / 2;
    return wrapSvg(viewH,
      `<line x1="0" y1="${mid}" x2="${VIEW_W}" y2="${mid}" stroke="${color}" stroke-width="${lineWidth}" stroke-opacity="0.15" />`,
    );
  }

  const max = Math.max(...data);

  // 单点：无可读趋势，仅画中线。
  if (data.length === 1) {
    const y = max === 0 ? PAD_TOP + drawH * 0.85 : PAD_TOP + drawH * (1 - data[0] / Math.max(max, 1));
    const opacity = max === 0 ? 0.3 : 1;
    return wrapSvg(viewH,
      `<line x1="0" y1="${y.toFixed(2)}" x2="${VIEW_W}" y2="${y.toFixed(2)}" stroke="${color}" stroke-width="${lineWidth}" stroke-opacity="${opacity}" stroke-linecap="round" />`,
    );
  }

  // 多点：计算坐标；全 0 时压到底部 85% 处，保留周期辅助线但不显示峰值标注。
  const stepX = VIEW_W / (data.length - 1);
  const points: Array<{ x: number; y: number }> = [];
  for (let i = 0; i < data.length; i++) {
    const ratio = max === 0 ? 0 : data[i] / max;
    const x = i * stepX;
    const y = max === 0 ? PAD_TOP + drawH * 0.85 : PAD_TOP + drawH * (1 - ratio);
    points.push({ x, y });
  }

  // 平滑 Bezier path（控制点取相邻两点 1/3 与 2/3 处，与原 canvas 实现一致）
  const linePath = buildSmoothPath(points);

  let inner = '';

  // 渐变填充（底部柔和阴影感）
  if (fillGradient && max > 0) {
    const fillPath =
      `${linePath} ` +
      `L${points[points.length - 1].x.toFixed(2)},${(PAD_TOP + drawH).toFixed(2)} ` +
      `L${points[0].x.toFixed(2)},${(PAD_TOP + drawH).toFixed(2)} Z`;
    inner +=
      `<defs>` +
      `<linearGradient id="${gradId}" x1="0" y1="0" x2="0" y2="1">` +
      `<stop offset="0%" stop-color="rgb(${rgb})" stop-opacity="0.15"/>` +
      `<stop offset="100%" stop-color="rgb(${rgb})" stop-opacity="0"/>` +
      `</linearGradient>` +
      `</defs>` +
      `<path d="${fillPath}" fill="url(#${gradId})" stroke="none"/>`;
  }

  inner += buildGuideLines(data.length, periodDividers, currentIndex, color, drawH);

  // 折线本身
  inner +=
    `<path d="${linePath}" fill="none" stroke="${color}" stroke-width="${lineWidth}" stroke-opacity="${max === 0 ? '0.3' : '1'}" stroke-linecap="round" stroke-linejoin="round"/>`;

  if (max > 0) {
    inner += buildPeakAnnotation(points, peakIndex, peakLabel, color, viewH);
  }

  return wrapSvg(viewH, inner);
}

function buildGuideLines(
  dataLength: number,
  periodDividers: number[],
  currentIndex: number,
  color: string,
  drawH: number,
): string {
  if (dataLength < 2) return '';
  const stepX = VIEW_W / (dataLength - 1);
  const validCurrentIndex = normalizeIndex(currentIndex, dataLength);
  const uniquePeriodIndexes = Array.from(new Set(periodDividers
    .map((idx) => normalizeIndex(idx, dataLength))
    .filter((idx) => idx >= 0 && idx !== validCurrentIndex)));
  const y1 = PAD_TOP;
  const y2 = PAD_TOP + drawH;
  let out = '';

  for (const idx of uniquePeriodIndexes) {
    const x = (idx * stepX).toFixed(2);
    out += `<line x1="${x}" y1="${y1}" x2="${x}" y2="${y2}" stroke="${color}" stroke-width="1" stroke-opacity="${PERIOD_LINE_OPACITY}" stroke-dasharray="2,6" stroke-linecap="round"/>`;
  }

  if (validCurrentIndex >= 0) {
    const x = (validCurrentIndex * stepX).toFixed(2);
    out += `<line x1="${x}" y1="${y1}" x2="${x}" y2="${y2}" stroke="${color}" stroke-width="1" stroke-opacity="${CURRENT_LINE_OPACITY}" stroke-dasharray="5,5" stroke-linecap="round"/>`;
  }

  return out;
}

function buildPeakAnnotation(
  points: Array<{ x: number; y: number }>,
  peakIndex: number,
  peakLabel: string,
  color: string,
  viewH: number,
): string {
  const idx = normalizeIndex(peakIndex, points.length);
  const label = peakLabel.trim();
  if (idx < 0 || !label) return '';

  const point = points[idx];
  const labelWidth = estimateLabelWidth(label);
  const labelBox = choosePeakLabelBox(point, labelWidth, points, viewH);
  const textX = labelBox.x;
  const textY = labelBox.y + PEAK_LABEL_FONT_SIZE;
  const escapedLabel = escapeXmlText(label);

  return (
    `<circle cx="${point.x.toFixed(2)}" cy="${point.y.toFixed(2)}" r="11" fill="${color}" fill-opacity="0.10"/>` +
    `<circle cx="${point.x.toFixed(2)}" cy="${point.y.toFixed(2)}" r="4.8" fill="${color}"/>` +
    `<text x="${textX.toFixed(2)}" y="${textY.toFixed(2)}" fill="${color}" fill-opacity="0.56" font-size="${PEAK_LABEL_FONT_SIZE}" font-family="-apple-system, BlinkMacSystemFont, sans-serif">${escapedLabel}</text>`
  );
}

function choosePeakLabelBox(
  point: { x: number; y: number },
  width: number,
  points: Array<{ x: number; y: number }>,
  viewH: number,
): { x: number; y: number; width: number; height: number } {
  const left = { x: point.x - width - PEAK_LABEL_GAP, y: point.y - PEAK_LABEL_HEIGHT / 2, width, height: PEAK_LABEL_HEIGHT };
  const leftDown = { x: point.x - width - PEAK_LABEL_GAP, y: point.y + PEAK_LABEL_GAP, width, height: PEAK_LABEL_HEIGHT };
  const rightDown = { x: point.x + PEAK_LABEL_GAP, y: point.y + PEAK_LABEL_GAP, width, height: PEAK_LABEL_HEIGHT };
  const right = { x: point.x + PEAK_LABEL_GAP, y: point.y - PEAK_LABEL_HEIGHT / 2, width, height: PEAK_LABEL_HEIGHT };
  const below = { x: point.x - width / 2, y: point.y + PEAK_LABEL_GAP, width, height: PEAK_LABEL_HEIGHT };

  const preferred = point.x < VIEW_W * 0.2
    ? [rightDown, right, below, leftDown, left]
    : point.x > VIEW_W * 0.8
      ? [leftDown, left, below, rightDown, right]
      : [leftDown, left, rightDown, right, below];

  const clamped = preferred.map((box) => clampLabelBox(box, viewH));
  return clamped.find((box) => !labelBoxHitsLine(box, points)) || clamped[0];
}

function clampLabelBox<T extends { x: number; y: number; width: number; height: number }>(box: T, viewH: number): T {
  return {
    ...box,
    x: clamp(box.x, PEAK_LABEL_MARGIN, VIEW_W - box.width - PEAK_LABEL_MARGIN),
    y: clamp(box.y, PEAK_LABEL_MARGIN, viewH - box.height - PEAK_LABEL_MARGIN),
  };
}

function labelBoxHitsLine(
  box: { x: number; y: number; width: number; height: number },
  points: Array<{ x: number; y: number }>,
): boolean {
  const margin = 6;
  return points.some((p) => (
    p.x >= box.x - margin
    && p.x <= box.x + box.width + margin
    && p.y >= box.y - margin
    && p.y <= box.y + box.height + margin
  ));
}

function estimateLabelWidth(label: string): number {
  let width = 0;
  for (const ch of label) {
    if (/\d/.test(ch)) width += 12;
    else if (ch === ' ' || ch === '/' || ch === '.' || ch === '·') width += 7;
    else if (ch === ',' || ch === '-') width += 6;
    else width += 14;
  }
  return Math.max(72, Math.min(180, width));
}

function normalizeIndex(index: number, length: number): number {
  if (!Number.isInteger(index) || index < 0 || index >= length) return -1;
  return index;
}

function clamp(value: number, min: number, max: number): number {
  if (value < min) return min;
  if (value > max) return max;
  return value;
}

function escapeXmlText(text: string): string {
  return text.replace(/[&<>"'\u0080-\uffff]/g, (ch) => {
    switch (ch) {
      case '&': return '&amp;';
      case '<': return '&lt;';
      case '>': return '&gt;';
      case '"': return '&quot;';
      case "'": return '&apos;';
      default: return `&#${ch.charCodeAt(0)};`;
    }
  });
}

/** 把 inner 内容包到 SVG 根元素里 · viewBox 与传入 height 1:1 配比，避免线宽被非均匀缩放 */
function wrapSvg(viewH: number, inner: string): string {
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${VIEW_W} ${viewH}" preserveAspectRatio="none">` +
    inner +
    `</svg>`
  );
}

/** 多点平滑 Bezier 路径 · 控制点取相邻两点 1/3、2/3 */
function buildSmoothPath(points: Array<{ x: number; y: number }>): string {
  if (points.length === 0) return '';
  let d = `M${points[0].x.toFixed(2)},${points[0].y.toFixed(2)}`;
  for (let i = 1; i < points.length; i++) {
    const prev = points[i - 1];
    const curr = points[i];
    const cp1x = prev.x + (curr.x - prev.x) / 3;
    const cp1y = prev.y;
    const cp2x = prev.x + ((curr.x - prev.x) * 2) / 3;
    const cp2y = curr.y;
    d += ` C${cp1x.toFixed(2)},${cp1y.toFixed(2)} ${cp2x.toFixed(2)},${cp2y.toFixed(2)} ${curr.x.toFixed(2)},${curr.y.toFixed(2)}`;
  }
  return d;
}

/**
 * SVG 字符串 → data:image/svg+xml;base64,… URI
 *
 * 注意：必须用 base64 编码，不能用 utf8/URL 编码。
 * 微信小程序 <image> 仅识别 data:image/svg+xml;base64,… 形式。
 *
 * SVG 字符串保持 ASCII：路径数字 + 颜色 hex + 已转义为 numeric entity 的文本，
 * 因此可直接走轻量 Base64 编码。
 */
function svgToDataUri(svg: string): string {
  return `data:image/svg+xml;base64,${b64Encode(svg)}`;
}

/**
 * Base64 编码（ASCII 字符串）。
 * 优先用 wx.arrayBufferToBase64 + TextEncoder（小程序内置 btoa 缺失），
 * fallback 自实现（小程序基础库 ≥ 2.4.0 起 wx.arrayBufferToBase64 可用 ·
 * 此处不依赖 wx，自实现纯算法版本，跨环境稳）。
 */
function b64Encode(input: string): string {
  // 标准 Base64 字符表
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
  let out = '';
  let i = 0;
  while (i < input.length) {
    const c1 = input.charCodeAt(i++) & 0xff;
    const c2 = i < input.length ? input.charCodeAt(i++) & 0xff : NaN;
    const c3 = i < input.length ? input.charCodeAt(i++) & 0xff : NaN;
    const e1 = c1 >> 2;
    const e2 = ((c1 & 3) << 4) | (Number.isNaN(c2) ? 0 : c2 >> 4);
    const e3 = Number.isNaN(c2) ? 64 : (((c2 & 15) << 2) | (Number.isNaN(c3) ? 0 : c3 >> 6));
    const e4 = Number.isNaN(c3) ? 64 : (c3 & 63);
    out += chars.charAt(e1) + chars.charAt(e2)
      + (e3 === 64 ? '=' : chars.charAt(e3))
      + (e4 === 64 ? '=' : chars.charAt(e4));
  }
  return out;
}

/** hex (#1c1b1a) → '28,27,26' for rgb()/rgba() */
function hexToRgb(hex: string): string {
  let h = hex.replace('#', '');
  if (h.length === 3) {
    h = h.split('').map((c) => c + c).join('');
  }
  const r = parseInt(h.slice(0, 2), 16);
  const g = parseInt(h.slice(2, 4), 16);
  const b = parseInt(h.slice(4, 6), 16);
  return `${r},${g},${b}`;
}
