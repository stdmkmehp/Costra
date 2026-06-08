#!/usr/bin/env node
// scripts/mp-ci/build-check.mjs · PR-check 中的 miniapp 编译自检
// Refs: COSTRA-040 · 对齐 package.json scripts.mp:build:check

import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { green, red, yellow } from './_lib.mjs';

const root = process.cwd();

if (!existsSync('miniprogram/project.config.json') && !existsSync('project.config.json')) {
  console.log(yellow('[mp:build:check] 未发现小程序入口，跳过'));
  process.exit(0);
}

// 1) tsc --noEmit
const tsc = spawnSync('npx', ['--no', '--', 'tsc', '--noEmit'], { stdio: 'inherit', shell: true });
if (tsc.status !== 0) {
  console.log(red('[mp:build:check] tsc 检查失败'));
  process.exit(1);
}

// 2) size-check
const sc = spawnSync('node', ['./scripts/mp-ci/size-check.mjs'], { stdio: 'inherit' });
if (sc.status !== 0) {
  console.log(red('[mp:build:check] 体积红线未通过'));
  process.exit(1);
}

console.log(green('[mp:build:check] OK'));
