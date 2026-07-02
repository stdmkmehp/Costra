/**
 * 二级图标样张预览：复刻 demo 的 fit() 光学归一，用 resvg 渲染三态网格 PNG。
 * 仅用于评估设计风格，不产出字体。
 */
import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import paper from 'paper-jsdom';
import { Resvg } from '@resvg/resvg-js';
import { ICONS_L2 } from './icons-l2.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const DIST = resolve(__dirname, 'dist');
mkdirSync(DIST, { recursive: true });

const VB = 24;
const TARGET = 20;        // 方形图标目标最大边
const AREA_TARGET = 18.5; // 光学等积目标（几何均值 √(w·h)）
const MAX_DIM = 22;       // 最大边硬上限，避免溢出 viewBox
const STROKE = 1.5;
const S = `fill="none" stroke="currentColor" stroke-width="${STROKE}" stroke-linecap="round" stroke-linejoin="round"`;

paper.setup(new paper.Size(VB, VB));

// 光学归一：等面积（几何均值）为主放大扁平图标，最大边封顶 MAX_DIM，且不缩小方形图标
function fitScale(w, h) {
  const maxDim = Math.max(w, h);
  const sMax = TARGET / maxDim;
  const sArea = AREA_TARGET / Math.sqrt(w * h);
  return Math.max(Math.min(sArea, MAX_DIM / maxDim), sMax);
}

/** 测 inner 的几何 bbox，返回 fit 后的 transform 与补偿描边宽度 */
function fit(inner) {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${VB} ${VB}"><g ${S}>${inner}</g></svg>`;
  const item = paper.project.importSVG(svg, { expandShapes: true });
  const b = item.strokeBounds; // 含描边的视觉包围盒，更贴近肉眼
  // 用几何 bounds 做缩放（与 demo 一致：基于路径几何，不含描边）
  const gb = item.bounds;
  const s = fitScale(gb.width, gb.height);
  const tx = 12 - s * (gb.x + gb.width / 2);
  const ty = 12 - s * (gb.y + gb.height / 2);
  item.remove();
  paper.project.activeLayer.removeChildren();
  return { s, tx, ty };
}

/** 单个图标在指定颜色下的 <svg> 片段（已 fit） */
function iconSvg(inner, color, size) {
  const { s, tx, ty } = fit(inner);
  const sw = (STROKE / s).toFixed(3);
  return `<svg width="${size}" height="${size}" viewBox="0 0 ${VB} ${VB}">
    <g transform="translate(${tx.toFixed(3)} ${ty.toFixed(3)}) scale(${s.toFixed(4)})"
       fill="none" stroke="${color}" stroke-width="${sw}" stroke-linecap="round" stroke-linejoin="round">
      ${inner.replace(/currentColor/g, color)}
    </g></svg>`;
}

const BONE = '#f1f2ec';
const INK = '#1c1b1a';
const GREEN = '#07c160';
const ICON = 'rgba(28,27,26,0.62)';
const CIRCLE_BG = 'rgba(28,27,26,0.06)';

/** 渲染一组：三列(默认/选中黑/选中绿) × N 行 */
function renderGroup(groupName, icons) {
  const names = Object.keys(icons);
  const COL_W = 150;
  const ROW_H = 84;
  const W = COL_W * 3;
  const H = names.length * ROW_H + 70;
  const cell = (cx, cy, bg, iconColor, inner) =>
    `<circle cx="${cx}" cy="${cy}" r="29" fill="${bg}"/>` +
    `<g transform="translate(${cx - 14} ${cy - 14})">${iconSvg(inner, iconColor, 28)}</g>`;

  const rows = names
    .map((name, i) => {
      const cy = 96 + i * ROW_H;
      const inner = icons[name];
      return (
        `<text x="20" y="${cy + 5}" font-family="PingFang SC, sans-serif" font-size="15" fill="${INK}">${name}</text>` +
        cell(COL_W * 0.5 + 30, cy, CIRCLE_BG, ICON, inner) +
        cell(COL_W * 1.5 + 10, cy, INK, BONE, inner) +
        cell(COL_W * 2.5 - 10, cy, GREEN, '#ffffff', inner)
      );
    })
    .join('');

  const header =
    `<text x="20" y="36" font-family="PingFang SC, sans-serif" font-size="20" font-weight="600" fill="${INK}">${groupName} · ${names.length} 个</text>` +
    `<text x="${COL_W * 0.5 + 16}" y="64" font-family="PingFang SC" font-size="12" fill="rgba(28,27,26,0.42)">默认</text>` +
    `<text x="${COL_W * 1.5 - 4}" y="64" font-family="PingFang SC" font-size="12" fill="rgba(28,27,26,0.42)">选中·黑</text>` +
    `<text x="${COL_W * 2.5 - 24}" y="64" font-family="PingFang SC" font-size="12" fill="rgba(28,27,26,0.42)">选中·绿</text>`;

  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">
    <rect width="${W}" height="${H}" fill="${BONE}"/>${header}${rows}</svg>`;
  const png = new Resvg(svg, {
    fitTo: { mode: 'width', value: W * 2 },
    font: { loadSystemFonts: true },
  })
    .render()
    .asPng();
  const out = resolve(DIST, `l2-${groupName}.png`);
  writeFileSync(out, png);
  console.log(`✅ ${groupName}: ${names.length} 个 → ${out}`);
}

for (const [group, icons] of Object.entries(ICONS_L2)) {
  renderGroup(group, icons);
}
