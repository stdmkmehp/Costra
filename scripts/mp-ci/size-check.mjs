#!/usr/bin/env node
// scripts/mp-ci/size-check.mjs · 本地体积静态扫描（不调用 miniprogram-ci）
// Refs: COSTRA-040 AC §miniapp-build-check · ADR-0004 §2 分包体积红线
// 主包 ≤ 1.5MB，总包 ≤ 16MB

import { readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { red, green, yellow } from './_lib.mjs';

const ROOT = process.cwd();
const MP = join(ROOT, 'miniprogram');

function walkSize(dir, skip = () => false) {
  let total = 0;
  for (const entry of readdirSync(dir)) {
    if (skip(entry)) continue;
    const full = join(dir, entry);
    const st = statSync(full);
    if (st.isDirectory()) total += walkSize(full, skip);
    else total += st.size;
  }
  return total;
}

function safeSize(path, skip) {
  try {
    return walkSize(path, skip);
  } catch {
    return 0;
  }
}

const skipCommon = (name) => name === 'node_modules' || name === 'miniprogram_npm' || name.startsWith('.');

// 主包 = miniprogram/ 顶层 - 分包目录
const mpEntries = (() => {
  try { return readdirSync(MP); } catch { return []; }
})();
const subPkgDirs = mpEntries.filter((e) => e.startsWith('pages-'));

const subPkgSizes = subPkgDirs.map((d) => ({
  name: d,
  size: safeSize(join(MP, d), skipCommon),
}));

const mainSize = mpEntries
  .filter((e) => !subPkgDirs.includes(e))
  .reduce((a, e) => a + safeSize(join(MP, e), skipCommon), 0);

const total = mainSize + subPkgSizes.reduce((a, p) => a + p.size, 0);

console.log('MiniApp 体积扫描：');
console.log(`  主包: ${(mainSize / 1024).toFixed(1)} KB`);
for (const p of subPkgSizes) {
  console.log(`  分包 ${p.name}: ${(p.size / 1024).toFixed(1)} KB`);
}
console.log(`  总计: ${(total / 1024).toFixed(1)} KB`);

let fail = false;
if (mainSize > 1.5 * 1024 * 1024) {
  console.log(red(`❌ 主包超过 1.5MB 红线（${(mainSize / 1024 / 1024).toFixed(2)}MB）`));
  fail = true;
}
if (total > 16 * 1024 * 1024) {
  console.log(red(`❌ 总包超过 16MB 红线（${(total / 1024 / 1024).toFixed(2)}MB）`));
  fail = true;
}
if (!fail) console.log(green('✅ 体积检查通过'));

if (fail) process.exit(1);
