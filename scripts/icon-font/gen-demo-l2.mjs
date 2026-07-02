/**
 * 生成二级分类图标评审页（HTML）。
 *
 * 复用一级 icon-style-demo.html 的设计规范与 fit() 光学归一逻辑，
 * 从唯一权威源 icons.mjs 读取二级分组视图（ICONS_L2），按「分类组」分区展示
 * 三态（默认/选中黑/选中绿）。产出：docs/design/icon-style-demo-l2.html —— 可直接浏览器打开评审。
 *
 * 每新增/调整一组图标后重跑本脚本即可自动刷新评审页，无需手维护 HTML。
 */
import { writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ICONS_L2 } from './icons.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUT = resolve(__dirname, '../../docs/design/icon-style-demo-l2.html');

const totalGroups = Object.keys(ICONS_L2).length;
const totalIcons = Object.values(ICONS_L2).reduce((n, g) => n + Object.keys(g).length, 0);

const DATA = JSON.stringify(ICONS_L2);

const html = `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8" />
<meta name="viewport" content="width=device-width, initial-scale=1.0" />
<title>Costra 二级分类图标 · 评审</title>
<style>
  :root {
    --bone: #f1f2ec;
    --ink: #1c1b1a;
    --green: #07c160;
    --circle-bg: rgba(28, 27, 26, 0.06);
    --icon: rgba(28, 27, 26, 0.62);
    --label: rgba(28, 27, 26, 0.6);
    --label-strong: #1c1b1a;
  }
  * { box-sizing: border-box; }
  body {
    margin: 0;
    font-family: -apple-system, "SF Pro Text", "PingFang SC", "Microsoft YaHei", sans-serif;
    background: var(--bone);
    color: var(--ink);
    padding: 36px 16px 72px;
    -webkit-font-smoothing: antialiased;
  }
  h1 { font-size: 21px; font-weight: 600; letter-spacing: -0.3px; text-align: center; margin: 0 0 6px; }
  .sub { text-align: center; color: rgba(28,27,26,0.42); font-size: 12.5px; margin-bottom: 28px; line-height: 1.6; }
  .toolbar { max-width: 760px; margin: 0 auto 28px; display: flex; gap: 8px; justify-content: center; }
  .toolbar button {
    border: 1px solid rgba(28,27,26,0.14); background: #fff; color: var(--ink);
    font-size: 12.5px; padding: 7px 16px; border-radius: 999px; cursor: pointer; transition: all .15s;
  }
  .toolbar button.active { background: var(--ink); color: var(--bone); border-color: var(--ink); }

  .group { max-width: 760px; margin: 0 auto 14px; }
  .group h2 {
    font-size: 13px; color: var(--ink); font-weight: 600;
    margin: 26px 0 16px; padding-left: 2px; letter-spacing: .5px;
    display: flex; align-items: baseline; gap: 8px;
  }
  .group h2 small { font-weight: 400; color: rgba(28,27,26,0.4); font-size: 11.5px; }
  .grid { display: grid; grid-template-columns: repeat(6, 1fr); row-gap: 18px; column-gap: 6px; }
  @media (max-width: 560px){ .grid { grid-template-columns: repeat(4, 1fr); } }
  .cell { display: flex; flex-direction: column; align-items: center; gap: 9px; }
  .badge {
    width: 56px; height: 56px; border-radius: 50%;
    background: var(--circle-bg); color: var(--icon);
    display: flex; align-items: center; justify-content: center;
    transition: all .2s ease;
  }
  .badge svg { width: 27px; height: 27px; display: block; }
  .label { font-size: 12px; color: var(--label); letter-spacing: .2px; }

  .mode-ink .badge { background: var(--ink); color: var(--bone); }
  .mode-ink .label { color: var(--label-strong); font-weight: 600; }
  .mode-green .badge { background: var(--green); color: #fff; }
  .mode-green .label { color: var(--green); font-weight: 600; }

  .divider { max-width: 760px; margin: 0 auto; height: 1px; background: rgba(28,27,26,0.07); }
</style>
</head>
<body>
  <h1>Costra 二级分类图标 · 评审</h1>
  <div class="sub">
    线性单色 · 24×24 viewBox · 描边 1.5 · 圆角线帽 · fit 光学归一（与一级图标同一套设计语言）<br/>
    当前 ${totalGroups} 组 / ${totalIcons} 个图标 · 去重原则：父默认子级复用一级、跨父同名共用一套
  </div>

  <div class="toolbar">
    <button data-mode="" class="active">默认态</button>
    <button data-mode="mode-ink">选中 · 黑</button>
    <button data-mode="mode-green">选中 · 绿</button>
  </div>

  <div id="root"></div>

<script>
const S = 'fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"';
const GROUPS = ${DATA};

const TARGET = 20;        // 方形图标目标最大边
const AREA_TARGET = 18.5; // 光学等积目标（几何均值 √(w·h)）
const MAX_DIM = 22;       // 最大边硬上限，避免溢出 viewBox
const BASE_STROKE = 1.5;
// 光学归一：以「等面积（几何均值）」为主，扁平图标据此放大以匹配视觉体量；
// 但最大边不超过 MAX_DIM 防溢出，且不小于原「最大边→TARGET」（只放大不缩小方形图标）。
function fitScale(w, h) {
  const maxDim = Math.max(w, h);
  const sMax = TARGET / maxDim;
  const sArea = AREA_TARGET / Math.sqrt(w * h);
  return Math.max(Math.min(sArea, MAX_DIM / maxDim), sMax);
}
function fit(g) {
  const b = g.getBBox();
  const s = fitScale(b.width, b.height);
  const tx = 12 - s * (b.x + b.width / 2);
  const ty = 12 - s * (b.y + b.height / 2);
  g.setAttribute('transform', 'translate(' + tx.toFixed(3) + ' ' + ty.toFixed(3) + ') scale(' + s.toFixed(4) + ')');
  g.setAttribute('stroke-width', (BASE_STROKE / s).toFixed(3));
}

const root = document.getElementById('root');
Object.entries(GROUPS).forEach(([group, icons]) => {
  const names = Object.keys(icons);
  const wrap = document.createElement('div');
  wrap.className = 'group';
  const grid = document.createElement('div');
  grid.className = 'grid';
  names.forEach((name) => {
    const cell = document.createElement('div');
    cell.className = 'cell';
    cell.innerHTML = '<div class="badge"><svg viewBox="0 0 24 24"><g ' + S + '>' + icons[name] + '</g></svg></div><div class="label">' + name + '</div>';
    grid.appendChild(cell);
  });
  wrap.innerHTML = '<h2>' + group + ' <small>' + names.length + ' 个</small></h2>';
  wrap.appendChild(grid);
  root.appendChild(wrap);
  const div = document.createElement('div');
  div.className = 'divider';
  root.appendChild(div);
  grid.querySelectorAll('svg > g').forEach(fit);
});

// 三态切换
const buttons = document.querySelectorAll('.toolbar button');
buttons.forEach((btn) => {
  btn.addEventListener('click', () => {
    buttons.forEach((b) => b.classList.remove('active'));
    btn.classList.add('active');
    document.querySelectorAll('.cell').forEach((c) => {
      c.classList.remove('mode-ink', 'mode-green');
      if (btn.dataset.mode) c.classList.add(btn.dataset.mode);
    });
  });
});
</script>
</body>
</html>
`;

writeFileSync(OUT, html);
console.log(`✅ 生成评审页：${OUT}`);
console.log(`   ${totalGroups} 组 / ${totalIcons} 个图标`);
