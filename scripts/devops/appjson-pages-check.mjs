#!/usr/bin/env node
/**
 * Costra · app.json 分包声明 ↔ 文件系统一致性 CI 校验脚本
 *
 * 卡号：COSTRA-119 · Owner：MiniApp-Agent（跨区交付 · 放 DevOps 脚本域对齐 115/116 先例）
 * 母问题：Human 2026-04-27 20:24 打开微信开发者工具模拟器启动失败
 *        （miniprogram/app.json subpackages[0].pages[1] overview/index 目录不存在）
 * 姊妹脚本：scripts/devops/whitelist-check.mjs（COSTRA-115 · 域名方向三源对账）
 *
 * 对账范围：
 *   解析 miniprogram/app.json
 *     ├── pages[]                      （主包页面）
 *     └── subpackages[].root + pages[] （分包页面）
 *   对每一页计算 4 路径并校验文件系统：
 *     - <base>.wxml                      必检
 *     - <base>.json                      必检
 *     - <base>.ts  (或 .js 替身)         必检
 *     - <base>.wxss                      可选（微信官方允许缺省 · COSTRA-119 dispatch §2 D3）
 *
 * 契约（见 COSTRA-119 dispatch §2 D3）：
 *   exit 0 · 全部一致
 *   exit 1 · 声明的页面有文件缺失
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
  if (pages.length === 0 && subpackages.length === 0) {
    throw new Error('app.json 既无 pages 也无 subpackages · 无从校验');
  }
  return { pages, subpackages };
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

  const verbose = process.argv.includes('--verbose');
  if (verbose) {
    console.log('[appjson-check] 扫描到的页面基准路径：');
    for (const b of bases) console.log(`  - ${b.source} → ${path.relative(repoRoot, b.base)}`);
  }

  if (infos.length > 0 && verbose) {
    console.log('ℹ️  appjson optional-missing (non-blocking):');
    for (const i of infos) console.log(`  · ${i}`);
  }

  if (errors.length === 0) {
    console.log(
      `✅ appjson consistent: ${bases.length} pages matched across miniprogram/app.json ↔ filesystem` +
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
  console.error('  ④ 修复后重跑 `npm run check:appjson`');
  process.exit(1);
}

main();
