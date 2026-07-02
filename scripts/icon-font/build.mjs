/**
 * Costra 一级分类图标 → TTF 字体产出脚本（纯 node，零系统依赖）
 *
 * 数据单一来源：docs/design/icon-style-demo.html 中的 ICONS 定义。
 * 流程：解析图标片段 → rect/circle 统一转 path → 复刻 demo 的 fit()
 *      （测几何 bbox、等比缩放居中到 TARGET）→ 描边线 stroke→outline 外扩
 *       为填充轮廓 → 与实心圆点 union 合并 → 标准化(去 arc) → 合成 SVG font → TTF。
 *
 * 产出（dist/）：iconfont.ttf、glyph-map.json、outlines/<name>.svg、preview.html
 */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Readable } from 'node:stream';
import { JSDOM } from 'jsdom';
import paper from 'paper-jsdom';
import { PaperOffset } from 'paperjs-offset';
import svgpath from 'svgpath';
import { SVGIcons2SVGFontStream } from 'svgicons2svgfont';
import svg2ttf from 'svg2ttf';
import { Resvg } from '@resvg/resvg-js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '../..');
const DEMO = resolve(ROOT, 'docs/design/icon-style-demo.html');
const DIST = resolve(__dirname, 'dist');
const OUTLINES = resolve(DIST, 'outlines');

// —— 与 demo 完全一致的归一化参数 ——
const VB = 24;          // viewBox
const TARGET = 20;      // 目标最大边长
const STROKE = 1.5;     // 呈现描边宽度
const CODEPOINT_START = 0xe000; // PUA 起点

paper.setup(new paper.Size(VB, VB));

/* ---------- 1. 从 demo 单一数据源提取 ICONS ---------- */
function loadIcons() {
  const html = readFileSync(DEMO, 'utf8');
  const sMatch = html.match(/const S = `([\s\S]*?)`/);
  const iconsMatch = html.match(/const ICONS = \{([\s\S]*?)\n\};/);
  if (!sMatch || !iconsMatch) throw new Error('无法从 demo 提取 S / ICONS');
  const S = sMatch[1];
  // 用 Function 求值对象字面量（其中模板串引用了 S）
  const ICONS = new Function('S', `return {${iconsMatch[1]}\n};`)(S);
  return ICONS;
}

/* ---------- 2. SVG 元素 → paper 路径 ---------- */
function elToPaper(el) {
  const tag = el.tagName.toLowerCase();
  const num = (a, d = 0) => {
    const v = el.getAttribute(a);
    return v == null ? d : parseFloat(v);
  };
  if (tag === 'path') return new paper.Path(el.getAttribute('d'));
  if (tag === 'circle')
    return new paper.Path.Circle(new paper.Point(num('cx'), num('cy')), num('r'));
  if (tag === 'rect') {
    const rect = new paper.Rectangle(num('x'), num('y'), num('width'), num('height'));
    const rx = num('rx', 0);
    return new paper.Path.Rectangle(rect, rx ? new paper.Size(rx, rx) : undefined);
  }
  throw new Error('未支持的元素: ' + tag);
}

/* ---------- 3. 单个图标 → 填充轮廓 pathData ---------- */
function buildOutline(fragment) {
  const dom = new JSDOM(`<svg xmlns="http://www.w3.org/2000/svg">${fragment}</svg>`);
  const g = dom.window.document.querySelector('g');
  const gFill = g.getAttribute('fill');
  const gStroke = g.getAttribute('stroke');

  paper.project.activeLayer.removeChildren();

  const strokeEls = [];
  const fillEls = [];
  for (const el of [...g.children]) {
    const fill = el.getAttribute('fill') ?? gFill;
    const stroke = el.getAttribute('stroke') ?? gStroke;
    const item = elToPaper(el);
    if (stroke && stroke !== 'none') strokeEls.push(item);
    else fillEls.push(item); // fill=currentColor 的实心形状
  }

  // 3a. 几何 bbox（不含描边宽度，与 SVG getBBox 一致）→ 复刻 fit()
  const all = [...strokeEls, ...fillEls];
  const group = new paper.Group(all.map((i) => i.clone({ insert: false })));
  const b = group.bounds;
  const s = TARGET / Math.max(b.width, b.height);
  const tx = VB / 2 - s * (b.x + b.width / 2);
  const ty = VB / 2 - s * (b.y + b.height / 2);
  const m = new paper.Matrix(s, 0, 0, s, tx, ty);
  group.remove();

  // 3b. 缩放居中后：描边元素做 stroke→outline，填充元素保持填充
  const parts = [];
  const srcStroke = []; // 缩放居中后的中心线(用于对比渲染)
  const srcFill = [];
  for (const it of strokeEls) {
    it.transform(m);
    // 零面积的闭合路径(线+z,如纸飞机折痕)语义上就是一条线，
    // 按开放线描边，避免对退化闭合路径外扩崩溃。
    if (it.closed && Math.abs(it.area) < 1e-3) it.closed = false;
    srcStroke.push(it.pathData);
    const outlined = PaperOffset.offsetStroke(it, STROKE / 2, {
      cap: 'round',
      join: 'round',
      insert: false,
    });
    parts.push(outlined);
  }
  for (const it of fillEls) {
    it.transform(m);
    srcFill.push(it.pathData);
    parts.push(it);
  }
  const sourceInner =
    srcStroke
      .map(
        (p) =>
          `<path d="${p}" fill="none" stroke="currentColor" stroke-width="${STROKE}" stroke-linecap="round" stroke-linejoin="round"/>`
      )
      .join('') + srcFill.map((p) => `<path d="${p}" fill="currentColor"/>`).join('');

  // 3c. union 合并所有部件
  let result = null;
  for (const p of parts) {
    if (!result) {
      result = p;
      continue;
    }
    const merged = result.unite(p, { insert: false });
    result = merged;
  }
  result.fillRule = 'nonzero';

  // 3d. 标准化：绝对坐标、去 arc（字体只支持二次贝塞尔，由 svg2ttf 转）、四舍五入
  const d = svgpath(result.pathData).abs().unarc().round(3).toString();
  paper.project.activeLayer.removeChildren();
  return { d, sourceInner };
}

/* ---------- 4. 合成 SVG font → TTF ---------- */
function buildFont(glyphs) {
  return new Promise((res, rej) => {
    const fontStream = new SVGIcons2SVGFontStream({
      fontName: 'costra-icons',
      fontHeight: 1000,
      normalize: false, // 已统一尺寸，禁止逐字归一化破坏一致性
      centerHorizontally: false,
      log: () => {},
    });
    let svgFont = '';
    fontStream
      .on('data', (chunk) => (svgFont += chunk))
      .on('end', () => res(svgFont))
      .on('error', rej);

    glyphs.forEach((gph, i) => {
      const svg = `<svg width="${VB}" height="${VB}" viewBox="0 0 ${VB} ${VB}"><path d="${gph.d}"/></svg>`;
      const stream = new Readable();
      stream._read = () => {};
      stream.push(svg);
      stream.push(null);
      stream.metadata = {
        unicode: [String.fromCodePoint(CODEPOINT_START + i)],
        name: gph.id,
      };
      fontStream.write(stream);
    });
    fontStream.end();
  });
}

/* ---------- 5. 预览 html ---------- */
function buildPreview(glyphs, ttfBase64) {
  const cells = glyphs
    .map((g) => {
      const ch = `&#x${(CODEPOINT_START + g.index).toString(16)};`;
      return `<div class="cell">
        <div class="row">
          <span class="badge n">${ch}</span>
          <span class="badge ink">${ch}</span>
          <span class="badge green">${ch}</span>
          <span class="svgbox">${g.svg}</span>
        </div>
        <div class="label">${g.name} · U+${(CODEPOINT_START + g.index)
          .toString(16)
          .toUpperCase()}</div>
      </div>`;
    })
    .join('\n');

  return `<!DOCTYPE html><html lang="zh-CN"><head><meta charset="UTF-8"/>
<title>Costra iconfont 产出预览</title>
<style>
  @font-face{font-family:'costra-icons';src:url(data:font/ttf;base64,${ttfBase64}) format('truetype');}
  :root{--bone:#f1f2ec;--ink:#1c1b1a;--green:#07c160;--bg:rgba(28,27,26,.06);--icon:rgba(28,27,26,.62);}
  body{margin:0;background:var(--bone);color:var(--ink);font-family:-apple-system,"PingFang SC",sans-serif;padding:32px 16px 64px;}
  h1{font-size:20px;text-align:center;margin:0 0 4px;}
  .sub{text-align:center;color:rgba(28,27,26,.45);font-size:12px;margin-bottom:28px;}
  .legend{max-width:520px;margin:0 auto 20px;font-size:12px;color:rgba(28,27,26,.5);text-align:center;line-height:1.7;}
  .grid{max-width:520px;margin:0 auto;display:grid;grid-template-columns:1fr;row-gap:14px;}
  .cell{}
  .row{display:flex;align-items:center;gap:14px;}
  .badge{width:48px;height:48px;border-radius:50%;display:flex;align-items:center;justify-content:center;
    font-family:'costra-icons';font-size:28px;line-height:1;background:var(--bg);color:var(--icon);}
  .badge.ink{background:var(--ink);color:var(--bone);}
  .badge.green{background:var(--green);color:#fff;}
  .svgbox{width:48px;height:48px;border-radius:50%;background:var(--bg);display:flex;align-items:center;justify-content:center;}
  .svgbox svg{width:28px;height:28px;color:var(--icon);}
  .label{margin-top:5px;font-size:12px;color:rgba(28,27,26,.55);}
</style></head><body>
<h1>Costra iconfont · 纯 node 产出预览</h1>
<div class="sub">每行从左到右：TTF默认色 / TTF选中黑 / TTF选中绿 / 原始 stroke SVG 轮廓</div>
<div class="legend">前三列由合成的 <b>iconfont.ttf</b>（base64 内联）渲染，第四列是 stroke→outline 后的填充 SVG。<br/>三者一致即代表 TTF 产出无损；对比第四列与原 demo 可判断 outline 保真度。</div>
<div class="grid">${cells}</div>
</body></html>`;
}

/* ---------- 6. 自检对比图：原始描边 vs outline 产出 ---------- */
function renderCompare(glyphs) {
  const ROW = 60;
  const W = 180;
  const H = glyphs.length * ROW + 12;
  const INK = '#1c1b1a';
  const cell = (cx, cy, inner) =>
    `<circle cx="${cx}" cy="${cy}" r="22" fill="rgba(28,27,26,0.06)"/>` +
    `<svg x="${cx - 14}" y="${cy - 14}" width="28" height="28" viewBox="0 0 ${VB} ${VB}">${inner.replace(
      /currentColor/g,
      INK
    )}</svg>`;
  const rows = glyphs
    .map((g, i) => {
      const cy = 30 + i * ROW;
      const outlineInner = `<path d="${g.d}" fill="${INK}"/>`;
      return cell(50, cy, g.sourceInner) + cell(130, cy, outlineInner);
    })
    .join('');
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">
    <rect width="${W}" height="${H}" fill="#f1f2ec"/>${rows}</svg>`;
  const png = new Resvg(svg, { fitTo: { mode: 'width', value: W * 2 } }).render().asPng();
  writeFileSync(resolve(DIST, 'compare.png'), png);
}

/* ---------- main ---------- */
async function main() {
  mkdirSync(OUTLINES, { recursive: true });
  const ICONS = loadIcons();
  const names = Object.keys(ICONS);

  const glyphs = [];
  names.forEach((name, index) => {
    process.stderr.write(`build: ${name}\n`);
    const { d, sourceInner } = buildOutline(ICONS[name]);
    const id = `cat-${index}`;
    const svg = `<svg viewBox="0 0 ${VB} ${VB}" fill="currentColor"><path d="${d}"/></svg>`;
    writeFileSync(resolve(OUTLINES, `${index}-${name}.svg`), svg);
    glyphs.push({ id, name, index, d, svg, sourceInner });
  });

  const svgFont = await buildFont(glyphs);
  const ttf = svg2ttf(svgFont, { description: 'Costra category icons' });
  const ttfBuf = Buffer.from(ttf.buffer);
  writeFileSync(resolve(DIST, 'iconfont.ttf'), ttfBuf);
  writeFileSync(resolve(DIST, 'iconfont.svg'), svgFont);

  const map = {};
  glyphs.forEach((g) => (map[g.name] = `\\u${(CODEPOINT_START + g.index).toString(16)}`));
  writeFileSync(resolve(DIST, 'glyph-map.json'), JSON.stringify(map, null, 2));

  writeFileSync(resolve(DIST, 'preview.html'), buildPreview(glyphs, ttfBuf.toString('base64')));
  renderCompare(glyphs);

  console.log(`✅ 产出完成：${glyphs.length} 字形`);
  console.log(`   iconfont.ttf  ${(ttfBuf.length / 1024).toFixed(1)} KB`);
  console.log(`   码点 U+E000 ~ U+E${(0x00 + glyphs.length - 1).toString(16).padStart(3, '0')}`);
  console.log(`   预览：scripts/icon-font/dist/preview.html`);
}

main().catch((e) => {
  console.error('❌ 失败：', e);
  process.exit(1);
});
