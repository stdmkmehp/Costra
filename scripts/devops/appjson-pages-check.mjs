#!/usr/bin/env node
/**
 * Costra · app.json 分包声明 ↔ 文件系统一致性 + 微信规约 CI 校验脚本
 *
 * 卡号：COSTRA-119（Rule-1~3 · 文件存在性） · COSTRA-120（Rule-4 · tabBar 主包规约 · P0 逃逸修复）
 * Owner：MiniApp-Agent（跨区交付 · 放 DevOps 脚本域对齐 115/116 先例）
 * 母问题：
 *   - 2026-04-27 20:24：Human 打开微信开发者工具模拟器启动失败（文件缺失 · COSTRA-119 修）
 *   - 2026-04-28 13:53：Human 重开再次失败（tabBar 指向分包违反微信规约 · COSTRA-120 修 + 本脚本新增 Rule-4）
 * 姊妹脚本：scripts/devops/whitelist-check.mjs（COSTRA-115 · 域名方向三源对账）
 *
 * 对账范围：
 *   解析 miniprogram/app.json
 *     ├── pages[]                      （主包页面）
 *     ├── subpackages[].root + pages[] （分包页面）
 *     └── tabBar.list[].pagePath       （tabBar 入口 · COSTRA-120 新增 Rule-4 校验）
 *
 *   Rule-1 · 声明的主包页面 <base>.wxml / .json 必存在
 *   Rule-2 · 声明的分包页面 <base>.wxml / .json 必存在
 *   Rule-3 · 每页必须有脚本（<base>.ts 或 <base>.js 二选一）
 *   Rule-4 · tabBar.list[].pagePath 必须严格在主包 pages[] 数组内
 *            · 微信规约：tabBar 页属"启动首帧必加载" · 禁止放入 subpackages[].pages[]
 *            · 根因：分包语义是"按需延迟下载" · 与 tabBar 语义冲突 · 违反则微信开发者工具启动即报 "need in ['pages']"
 *
 * 契约：
 *   exit 0 · 全部一致
 *   exit 1 · Rule-1/2/3 缺文件 或 Rule-4 tabBar 违规
 *   exit 2 · 解析失败（app.json 损坏 / 不是合法 JSON / 缺失必要字段）
 *
 * 实现：零依赖（仅 Node 原生 fs / path / url）· app.json 是标准 JSON · 直接 JSON.parse · 不需要 YAML 解析
 */

import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, '..', '..');

const APP_JSON_PATH = path.join(repoRoot, 'miniprogram', 'app.json');
const MINIPROGRAM_ROOT = path.join(repoRoot, 'miniprogram');

// 必检后缀（任一缺失即 exit 1）
const REQUIRED_SUFFIXES = ['.wxml', '.json'];
// 必检脚本后缀（二选一 · 本项目全量 .ts · .js 作为兼容替身）
const SCRIPT_SUFFIXES = ['.ts', '.js'];
// 可选后缀（打印 info · 不 fail）
const OPTIONAL_SUFFIXES = ['.wxss'];

// ------------------------------------------------------------------
// ① 解析 app.json
// ------------------------------------------------------------------
function parseAppJson(text) {
  let obj;
  try {
    obj = JSON.parse(text);
  } catch (e) {
    throw new Error(`app.json 不是合法 JSON: ${e instanceof Error ? e.message : String(e)}`);
  }
  const pages = Array.isArray(obj.pages) ? obj.pages : [];
  const subpackages = Array.isArray(obj.subpackages) ? obj.subpackages : [];
  // COSTRA-120 · tabBar 可能不存在（非 tabBar 小程序 · 跳过 Rule-4）· 存在时必须是 {list: []} 结构
  const tabBar =
    obj.tabBar && Array.isArray(obj.tabBar.list)
      ? { list: obj.tabBar.list }
      : null;
  if (pages.length === 0 && subpackages.length === 0) {
    throw new Error('app.json 既无 pages 也无 subpackages · 无从校验');
  }
  return { pages, subpackages, tabBar };
}

// ------------------------------------------------------------------
// ② 展平所有页面为绝对路径基准（不含后缀）
// ------------------------------------------------------------------
function flattenPageBases({ pages, subpackages }) {
  /** @type {{source: string, base: string}[]} */
  const bases = [];

  // 主包
  for (const p of pages) {
    if (typeof p !== 'string' || p.length === 0) continue;
    bases.push({
      source: `pages[${pages.indexOf(p)}]`,
      base: path.join(MINIPROGRAM_ROOT, p),
    });
  }

  // 分包
  subpackages.forEach((sp, spIdx) => {
    const root = typeof sp.root === 'string' ? sp.root.replace(/\/$/, '') : '';
    const spPages = Array.isArray(sp.pages) ? sp.pages : [];
    spPages.forEach((p, pIdx) => {
      if (typeof p !== 'string' || p.length === 0) return;
      bases.push({
        source: `subpackages[${spIdx}]["${sp.name || root}"].pages[${pIdx}]`,
        base: path.join(MINIPROGRAM_ROOT, root, p),
      });
    });
  });

  return bases;
}

// ------------------------------------------------------------------
// ③ 校验单页
// ------------------------------------------------------------------
function checkPageFiles(entry) {
  const missingRequired = [];
  const missingScript = [];
  const missingOptional = [];

  for (const suf of REQUIRED_SUFFIXES) {
    if (!existsSync(entry.base + suf)) missingRequired.push(suf);
  }

  const scriptHit = SCRIPT_SUFFIXES.some((suf) => existsSync(entry.base + suf));
  if (!scriptHit) missingScript.push(SCRIPT_SUFFIXES.join('|'));

  for (const suf of OPTIONAL_SUFFIXES) {
    if (!existsSync(entry.base + suf)) missingOptional.push(suf);
  }

  return { missingRequired, missingScript, missingOptional };
}

// ------------------------------------------------------------------
// ④ Rule-4 · tabBar.list[].pagePath 必须在主包 pages[] 数组内（COSTRA-120）
//
// 微信规约：tabBar 页属"启动首帧必加载" · 禁止放入 subpackages[].pages[]
// 违反时微信开发者工具启动即报：
//   ["tabBar"][N]["pagePath"]: "xxx/yyy/index" need in ["pages"]
//
// 返回违规条目数组（空数组即通过）
// ------------------------------------------------------------------
function checkTabBarMainPackage({ pages, tabBar }) {
  if (!tabBar) return []; // 非 tabBar 小程序 · 跳过
  const mainPagesSet = new Set(pages);
  const violations = [];
  tabBar.list.forEach((item, idx) => {
    if (!item || typeof item.pagePath !== 'string') return;
    if (!mainPagesSet.has(item.pagePath)) {
      violations.push({
        tabIndex: idx,
        pagePath: item.pagePath,
        text: typeof item.text === 'string' ? item.text : '',
      });
    }
  });
  return violations;
}

// ------------------------------------------------------------------
// 主流程
// ------------------------------------------------------------------
function main() {
  let app;
  try {
    app = parseAppJson(readFileSync(APP_JSON_PATH, 'utf8'));
  } catch (e) {
    console.error('[appjson-check] 解析 app.json 失败（exit 2）：');
    console.error(e instanceof Error ? e.stack : String(e));
    process.exit(2);
  }

  const bases = flattenPageBases(app);
  const errors = [];
  const infos = [];

  // Rule-1/2/3 · 文件存在性
  for (const entry of bases) {
    const { missingRequired, missingScript, missingOptional } = checkPageFiles(entry);
    const relBase = path.relative(repoRoot, entry.base);
    if (missingRequired.length > 0) {
      errors.push(
        `[${entry.source}] ${relBase} 缺必检文件: ${missingRequired.join(', ')}`
      );
    }
    if (missingScript.length > 0) {
      errors.push(
        `[${entry.source}] ${relBase} 缺脚本文件（${SCRIPT_SUFFIXES.join(' 或 ')}）`
      );
    }
    if (missingOptional.length > 0) {
      infos.push(
        `[${entry.source}] ${relBase} 缺可选文件: ${missingOptional.join(', ')}（微信允许无 wxss · 仅提示）`
      );
    }
  }

  // Rule-4 · tabBar 主包规约（COSTRA-120）
  const tabBarViolations = checkTabBarMainPackage(app);
  for (const v of tabBarViolations) {
    errors.push(
      `[tabBar.list[${v.tabIndex}] "${v.text}"] pagePath="${v.pagePath}" 违反微信规约: ` +
        `tabBar 页必须在主包 pages[] · 禁止在 subpackages[].pages[]（启动首帧冲突）`
    );
  }

  const verbose = process.argv.includes('--verbose');
  if (verbose) {
    console.log('[appjson-check] 扫描到的页面基准路径：');
    for (const b of bases) console.log(`  - ${b.source} → ${path.relative(repoRoot, b.base)}`);
    if (app.tabBar) {
      const tabBarPassCount = app.tabBar.list.length - tabBarViolations.length;
      console.log(
        `[appjson-check] tabBar 主包规约：${tabBarPassCount}/${app.tabBar.list.length} pass`
      );
    } else {
      console.log('[appjson-check] tabBar 主包规约：跳过（非 tabBar 小程序）');
    }
  }

  if (infos.length > 0 && verbose) {
    console.log('ℹ️  appjson optional-missing (non-blocking):');
    for (const i of infos) console.log(`  · ${i}`);
  }

  if (errors.length === 0) {
    const tabBarSegment = app.tabBar
      ? ` · tabBar main-package rule: ${app.tabBar.list.length}/${app.tabBar.list.length} pass`
      : '';
    console.log(
      `✅ appjson consistent: ${bases.length} pages matched across miniprogram/app.json ↔ filesystem` +
        tabBarSegment +
        (infos.length > 0 ? ` (${infos.length} optional wxss missing · non-blocking)` : '')
    );
    process.exit(0);
  }

  console.error('❌ appjson inconsistency detected:');
  for (const err of errors) console.error(`  · ${err}`);
  console.error('');
  console.error('修复指引：');
  console.error('  ① 为缺失页面新建四件套（.wxml / .json / .ts 必备 · .wxss 可选）');
  console.error('  ② 或从 miniprogram/app.json 的 pages / subpackages 中移除该声明');
  console.error('  ③ 注意 tabBar 指向的页面必须实际存在 · 否则微信开发者工具启动即失败');
  console.error('  ④ [COSTRA-120 规约] tabBar.list[].pagePath 必须在主包 pages[] 数组内 · 禁止在 subpackages · 否则微信开发者工具启动报 "need in [\'pages\']"');
  console.error('  ⑤ 修复后重跑 `npm run check:appjson`');
  process.exit(1);
}

main();
