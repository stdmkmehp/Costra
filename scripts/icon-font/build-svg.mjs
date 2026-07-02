/**
 * Costra 图标字体 · 第 1 步（node）：fit 光学归一 → 产出每个字形的中心线 SVG。
 *
 * 只做几何测量 + 缩放居中（复刻 demo 的 fit()），**不做描边外扩**（描边外扩交给
 * 第 2 步 FontForge 的 stroke()，避免 paperjs-offset 在退化几何上死循环）。
 *
 * 产出（dist/glyph-svg/）：
 *   <cpHex>-<key>.stroke.svg  —— 描边中心线（plain path，无 fill/stroke 属性，供 FontForge stroke()）
 *   <cpHex>-<key>.fill.svg    —— 实心形状（如圆点，已是实体，不参与 stroke()）；无实心形状则不产出
 * 另产出：
 *   dist/glyphs.json          —— [{key,label,cpHex,codepoint,hasFill}]（供 build-font.py）
 *   miniprogram/services/iconMap.ts   —— icon_key → 字形（不依赖 ttf，可提前生成）
 *   dist/glyph-map.json               —— icon_key → \uXXXX
 */
import { readFileSync, writeFileSync, mkdirSync, rmSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { JSDOM } from 'jsdom';
import paper from 'paper-jsdom';
import { ICONS } from './icons.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '../..');
const DIST = resolve(__dirname, 'dist');
const GLYPH_SVG = resolve(DIST, 'glyph-svg');
const MP_ICONMAP = resolve(ROOT, 'miniprogram/services/iconMap.ts');

const VB = 24;      // viewBox
const TARGET = 20;  // 目标最大边长
const STROKE = 1.5; // 呈现描边宽度
const EM = 1000;    // 目标字体 em（SVG 以 width/height=EM + viewBox=24 让 FontForge 按 EM 缩放）

const REGISTRY = JSON.parse(readFileSync(resolve(__dirname, 'icon-registry.json'), 'utf8'));

paper.setup(new paper.Size(VB, VB));

function elToPaper(el) {
  const tag = el.tagName.toLowerCase();
  const num = (a, d = 0) => { const v = el.getAttribute(a); return v == null ? d : parseFloat(v); };
  if (tag === 'path') return new paper.Path(el.getAttribute('d'));
  if (tag === 'circle') return new paper.Path.Circle(new paper.Point(num('cx'), num('cy')), num('r'));
  if (tag === 'ellipse') {
    const rx = num('rx'), ry = num('ry');
    return new paper.Path.Ellipse(new paper.Rectangle(num('cx') - rx, num('cy') - ry, 2 * rx, 2 * ry));
  }
  if (tag === 'rect') {
    const rect = new paper.Rectangle(num('x'), num('y'), num('width'), num('height'));
    const rx = num('rx', 0);
    return new paper.Path.Rectangle(rect, rx ? new paper.Size(rx, rx) : undefined);
  }
  throw new Error('未支持的元素: ' + tag);
}

/** fit 归一后：返回描边中心线 pathData[] 与 实心形状 pathData[] */
function fitGlyph(inner) {
  const fragment = `<g fill="none" stroke="#000" stroke-width="${STROKE}">${inner}</g>`;
  const dom = new JSDOM(`<svg xmlns="http://www.w3.org/2000/svg">${fragment}</svg>`);
  const g = dom.window.document.querySelector('g');
  paper.project.activeLayer.removeChildren();

  const strokeEls = [];
  const fillEls = [];
  for (const el of [...g.children]) {
    const fill = el.getAttribute('fill') ?? g.getAttribute('fill');
    const stroke = el.getAttribute('stroke') ?? g.getAttribute('stroke');
    const item = elToPaper(el);
    if (stroke && stroke !== 'none') strokeEls.push(item);
    else fillEls.push(item);
  }

  // 几何 bbox（不含描边宽度，与 SVG getBBox 一致）→ fit()
  const all = [...strokeEls, ...fillEls];
  const group = new paper.Group(all.map((i) => i.clone({ insert: false })));
  const b = group.bounds;
  const s = TARGET / Math.max(b.width, b.height);
  const tx = VB / 2 - s * (b.x + b.width / 2);
  const ty = VB / 2 - s * (b.y + b.height / 2);
  const m = new paper.Matrix(s, 0, 0, s, tx, ty);
  group.remove();

  const strokeD = [];
  const fillD = [];
  for (const it of strokeEls) {
    it.transform(m);
    // 零面积闭合路径（线+Z，如折痕）语义上是一条线 → 按开放线导出，避免 FontForge stroke 退化
    if (it.closed && Math.abs(it.area) < 1e-3) it.closed = false;
    strokeD.push(it.pathData);
  }
  for (const it of fillEls) {
    it.transform(m);
    fillD.push(it.pathData);
  }
  paper.project.activeLayer.removeChildren();
  return { strokeD, fillD };
}

function svgWrap(paths) {
  // width/height=EM + viewBox=24 → FontForge importOutlines 会把 24 坐标系缩放到 EM
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${EM}" height="${EM}" viewBox="0 0 ${VB} ${VB}">${paths}</svg>\n`;
}

function main() {
  rmSync(GLYPH_SVG, { recursive: true, force: true });
  mkdirSync(GLYPH_SVG, { recursive: true });

  const keys = Object.keys(ICONS);

  // registry ↔ ICONS key 集合双向校验：防止新增/删除字形时码点表与图标源漂移
  const missingCp = keys.filter((k) => !REGISTRY[k]);
  const orphanReg = Object.keys(REGISTRY).filter((k) => !ICONS[k]);
  if (missingCp.length || orphanReg.length) {
    throw new Error(
      'icons.mjs ↔ icon-registry.json 不一致：\n' +
        `  ICONS 有但 registry 缺码点: ${missingCp.join(', ') || '无'}\n` +
        `  registry 有但 ICONS 无（孤儿码点）: ${orphanReg.join(', ') || '无'}`
    );
  }

  const glyphs = [];
  const glyphMap = {};
  const iconMapEntries = [];

  for (const key of keys) {
    const cpHex = REGISTRY[key];
    if (!cpHex) throw new Error(`icon-registry.json 缺少 "${key}" 的码点`);
    const codepoint = parseInt(cpHex, 16);
    const { label, svg: inner } = ICONS[key];
    const { strokeD, fillD } = fitGlyph(inner);

    const strokePaths = strokeD.map((d) => `<path d="${d}"/>`).join('');
    writeFileSync(resolve(GLYPH_SVG, `${cpHex}-${key}.stroke.svg`), svgWrap(strokePaths));
    const hasFill = fillD.length > 0;
    if (hasFill) {
      const fillPaths = fillD.map((d) => `<path d="${d}"/>`).join('');
      writeFileSync(resolve(GLYPH_SVG, `${cpHex}-${key}.fill.svg`), svgWrap(fillPaths));
    }

    glyphs.push({ key, label, cpHex, codepoint, hasFill });
    glyphMap[key] = `\\u${cpHex}`;
    iconMapEntries.push(`  ${key}: '\\u${cpHex}', // ${label}`);
    process.stderr.write(`svg: ${key} (${label})  stroke=${strokeD.length} fill=${fillD.length}\n`);
  }

  writeFileSync(resolve(DIST, 'glyphs.json'), JSON.stringify(glyphs, null, 2));
  writeFileSync(resolve(DIST, 'glyph-map.json'), JSON.stringify(glyphMap, null, 2));
  writeFileSync(MP_ICONMAP, buildIconMap(iconMapEntries));

  console.log(`✅ 第 1 步完成：${glyphs.length} 个字形 SVG → dist/glyph-svg/`);
  console.log(`   dist/glyphs.json / dist/glyph-map.json / miniprogram/services/iconMap.ts`);
  console.log(`   下一步：fontforge -script build-font.py`);
}

function buildIconMap(entries) {
  return `// AUTO-GENERATED by scripts/icon-font/build-svg.mjs — DO NOT EDIT.
// icon_key → PUA 字形字符（配合 styles/iconfont.wxss 的 costra-icons 字体渲染）。

/** icon_key → 字形字符 */
export const ICON_GLYPH: Record<string, string> = {
${entries.join('\n')}
};

/** 兜底 icon_key（未知分类时用「其他」字形） */
const FALLBACK_KEY = 'other';

/**
 * 把 icon_key 解析为字形字符。
 * 兜底顺序：命中 key → 字形；否则单字符（旧数据/未迁移）→ 原样文本；否则 → 「其他」字形。
 * 这样新版小程序对「新 key 数据」与「旧单字数据」都能正确渲染，发布/回滚均安全。
 */
export function resolveIconGlyph(key: string | null | undefined): string {
  if (!key) return ICON_GLYPH[FALLBACK_KEY] || '';
  const glyph = ICON_GLYPH[key];
  if (glyph) return glyph;
  if ([...key].length === 1) return key; // 旧数据：单字符原样显示
  return ICON_GLYPH[FALLBACK_KEY] || '';
}
`;
}

main();
