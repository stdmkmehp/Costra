/** 用合成好的 iconfont.ttf 真实渲染字形，闭环验证字体文件本身正确。 */
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Resvg } from '@resvg/resvg-js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const DIST = resolve(__dirname, 'dist');
const map = JSON.parse(readFileSync(resolve(DIST, 'glyph-map.json'), 'utf8'));
const names = Object.keys(map);

const COLS = 4;
const CELL = 72;
const rows = Math.ceil(names.length / COLS);
const W = COLS * CELL;
const H = rows * CELL;

const glyphs = names
  .map((name, i) => {
    const cp = parseInt(map[name].replace('\\u', ''), 16);
    const ch = `&#x${cp.toString(16)};`;
    const cx = (i % COLS) * CELL + CELL / 2;
    const cy = Math.floor(i / COLS) * CELL + CELL / 2;
    return (
      `<circle cx="${cx}" cy="${cy}" r="26" fill="rgba(28,27,26,0.06)"/>` +
      `<text x="${cx}" y="${cy}" font-family="costra-icons" font-size="32" fill="#1c1b1a" ` +
      `text-anchor="middle" dominant-baseline="central">${ch}</text>`
    );
  })
  .join('');

const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">
  <rect width="${W}" height="${H}" fill="#f1f2ec"/>${glyphs}</svg>`;

const png = new Resvg(svg, {
  fitTo: { mode: 'width', value: W * 2 },
  font: {
    fontFiles: [resolve(DIST, 'iconfont.ttf')],
    defaultFontFamily: 'costra-icons',
    loadSystemFonts: false,
  },
})
  .render()
  .asPng();

writeFileSync(resolve(DIST, 'ttf-render.png'), png);
console.log('✅ TTF 真实渲染输出 dist/ttf-render.png');
