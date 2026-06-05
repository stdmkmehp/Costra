// components/trend-line-chart/index.ts · 极简静态趋势折线图
// 卡号: COSTRA-230 · 设计源: docs/design/statistics-page-tech-spec.md §4.3
//
// 职责：接收 number[] 数据，绘制平滑 Bezier 曲线 + 可选底部渐变。
//   - 不响应任何手势（明确为「Static Visual Trend」)
//   - 自适应 dpr（Retina/高密度屏）
//   - 容错：data 为空 / 全 0 / 单点 → 绘制平直中线（不报错）
//
// 性能：data 长度 ≤ 31（月度）或 12（年度），单次绘制 < 5ms · 不做动画

interface SelectorRect {
  node?: { width: number; height: number; getContext(s: string): CanvasRenderingContext2DLike };
  width?: number;
  height?: number;
}

interface CanvasRenderingContext2DLike {
  scale(x: number, y: number): void;
  clearRect(x: number, y: number, w: number, h: number): void;
  beginPath(): void;
  moveTo(x: number, y: number): void;
  lineTo(x: number, y: number): void;
  bezierCurveTo(cp1x: number, cp1y: number, cp2x: number, cp2y: number, x: number, y: number): void;
  closePath(): void;
  stroke(): void;
  fill(): void;
  createLinearGradient(x0: number, y0: number, x1: number, y1: number): { addColorStop(o: number, c: string): void };
  strokeStyle: string;
  fillStyle: string | { addColorStop(o: number, c: string): void };
  lineWidth: number;
  lineCap: string;
  lineJoin: string;
  globalAlpha: number;
}

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
  },

  data: {
    canvasId: '',
  },

  lifetimes: {
    attached() {
      // 生成唯一 id，避免多组件 canvas 冲突
      this.setData({
        canvasId: `tlc_${Math.random().toString(36).slice(2, 10)}`,
      });
    },
    ready() {
      this._draw();
    },
  },

  observers: {
    'data, color, fillGradient': function () {
      // ready 之前 canvasId 已设；ready 之后任何 prop 变化都重绘
      this._draw();
    },
  },

  methods: {
    _draw() {
      const canvasId = this.data.canvasId;
      if (!canvasId) return;
      const props = this.properties as unknown as {
        data: number[];
        color: string;
        fillGradient: boolean;
      };
      const data = props.data || [];
      const color = props.color || '#1c1b1a';
      const fillGradient = props.fillGradient !== false;

      const query = this.createSelectorQuery();
      query
        .select(`#${canvasId}`)
        .fields({ node: true, size: true })
        .exec((res: unknown) => {
          const arr = res as SelectorRect[];
          if (!arr || !arr[0] || !arr[0].node) return;
          const item = arr[0];
          const node = item.node!;
          const ctx = node.getContext('2d');
          if (!ctx) return;
          const dpr = wx.getSystemInfoSync().pixelRatio || 1;
          const cssW = item.width || 300;
          const cssH = item.height || 80;
          // 物理像素：考虑 dpr
          (node as unknown as { width: number; height: number }).width = Math.floor(cssW * dpr);
          (node as unknown as { width: number; height: number }).height = Math.floor(cssH * dpr);
          ctx.scale(dpr, dpr);
          ctx.clearRect(0, 0, cssW, cssH);

          // 留出上下 padding，避免线条贴边
          const paddingTop = 8;
          const paddingBottom = 4;
          const drawH = cssH - paddingTop - paddingBottom;
          const drawW = cssW;

          if (data.length < 1) {
            // 空数据 · 中线
            const mid = paddingTop + drawH / 2;
            ctx.strokeStyle = color;
            ctx.globalAlpha = 0.15;
            ctx.lineWidth = 1.5;
            ctx.beginPath();
            ctx.moveTo(0, mid);
            ctx.lineTo(cssW, mid);
            ctx.stroke();
            ctx.globalAlpha = 1;
            return;
          }

          const max = Math.max(...data);
          const points: Array<{ x: number; y: number }> = [];
          const stepX = data.length > 1 ? drawW / (data.length - 1) : drawW;

          for (let i = 0; i < data.length; i++) {
            const v = data[i];
            const ratio = max > 0 ? v / max : 0;
            const x = data.length > 1 ? i * stepX : drawW / 2;
            const y = paddingTop + drawH * (1 - ratio);
            points.push({ x, y });
          }

          // 绘制底部渐变填充
          if (fillGradient && data.length > 1 && max > 0) {
            const gradient = ctx.createLinearGradient(0, paddingTop, 0, paddingTop + drawH);
            const rgb = hexToRgb(color);
            gradient.addColorStop(0, `rgba(${rgb}, 0.15)`);
            gradient.addColorStop(1, `rgba(${rgb}, 0)`);
            ctx.fillStyle = gradient;
            ctx.beginPath();
            ctx.moveTo(points[0].x, paddingTop + drawH);
            for (let i = 0; i < points.length; i++) {
              if (i === 0) {
                ctx.lineTo(points[i].x, points[i].y);
              } else {
                const prev = points[i - 1];
                const curr = points[i];
                const cp1x = prev.x + (curr.x - prev.x) / 3;
                const cp1y = prev.y;
                const cp2x = prev.x + ((curr.x - prev.x) * 2) / 3;
                const cp2y = curr.y;
                ctx.bezierCurveTo(cp1x, cp1y, cp2x, cp2y, curr.x, curr.y);
              }
            }
            ctx.lineTo(points[points.length - 1].x, paddingTop + drawH);
            ctx.closePath();
            ctx.fill();
          }

          // 绘制曲线本身
          ctx.strokeStyle = color;
          ctx.lineWidth = 1.8;
          ctx.lineCap = 'round';
          ctx.lineJoin = 'round';

          if (data.length === 1 || max === 0) {
            // 单点或全零 · 平直中线
            const y = max === 0 ? paddingTop + drawH * 0.85 : points[0].y;
            ctx.globalAlpha = max === 0 ? 0.3 : 1;
            ctx.beginPath();
            ctx.moveTo(0, y);
            ctx.lineTo(cssW, y);
            ctx.stroke();
            ctx.globalAlpha = 1;
            return;
          }

          ctx.beginPath();
          ctx.moveTo(points[0].x, points[0].y);
          for (let i = 1; i < points.length; i++) {
            const prev = points[i - 1];
            const curr = points[i];
            const cp1x = prev.x + (curr.x - prev.x) / 3;
            const cp1y = prev.y;
            const cp2x = prev.x + ((curr.x - prev.x) * 2) / 3;
            const cp2y = curr.y;
            ctx.bezierCurveTo(cp1x, cp1y, cp2x, cp2y, curr.x, curr.y);
          }
          ctx.stroke();
        });
    },
  },
});

/** hex (#1c1b1a) → '28, 27, 26' for rgba() */
function hexToRgb(hex: string): string {
  let h = hex.replace('#', '');
  if (h.length === 3) {
    h = h.split('').map((c) => c + c).join('');
  }
  const r = parseInt(h.slice(0, 2), 16);
  const g = parseInt(h.slice(2, 4), 16);
  const b = parseInt(h.slice(4, 6), 16);
  return `${r}, ${g}, ${b}`;
}
