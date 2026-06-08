#!/usr/bin/env node
// scripts/mp-ci/analyze.mjs · 包分析占位
// Refs: COSTRA-040 · AC-miniapp-build-check
// 本轮先输出按文件 Top 20（仅主包），后续 Sprint-1 接入 miniprogram-ci 的 depAnalyse
import { readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { green } from './_lib.mjs';

const MP = join(process.cwd(), 'miniprogram');

function walk(dir, out = []) {
  for (const e of readdirSync(dir)) {
    if (e === 'node_modules' || e === 'miniprogram_npm') continue;
    const full = join(dir, e);
    const st = statSync(full);
    if (st.isDirectory()) walk(full, out);
    else out.push({ path: full, size: st.size });
  }
  return out;
}

const list = walk(MP).sort((a, b) => b.size - a.size).slice(0, 20);
console.log(green('Top 20 文件体积：'));
for (const f of list) {
  console.log(`  ${(f.size / 1024).toFixed(1).padStart(8)} KB  ${f.path.replace(process.cwd(), '.')}`);
}
