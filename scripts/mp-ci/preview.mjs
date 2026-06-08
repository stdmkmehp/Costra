#!/usr/bin/env node
// scripts/mp-ci/preview.mjs · 预览版上传（占位骨架）
// Refs: COSTRA-040
// 真正的 ci.preview 依赖 `miniprogram-ci`，缺 robot key 时优雅短路。

import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { guardEnv, loadCi, writeReport, red, green, yellow } from './_lib.mjs';

const ENV = {
  MP_APPID: process.env.MP_APPID,
  MP_CI_KEY_PATH: process.env.MP_CI_KEY_PATH,
  MP_PROJECT_PATH: process.env.MP_PROJECT_PATH || process.cwd(),
  MP_ENV: process.env.MP_ENV || 'staging',
  MP_DESC: process.env.MP_DESC || `CI preview ${new Date().toISOString()}`,
};

const missing = guardEnv(ENV, ['MP_APPID', 'MP_CI_KEY_PATH']);
if (missing.length) {
  console.log(red('[mp-ci/preview] 缺少必要环境变量：' + missing.join(', ')));
  console.log(yellow('[mp-ci/preview] 配置示例请见 docs/devops/secrets.md §激活清单'));
  process.exit(1);
}
if (!existsSync(ENV.MP_CI_KEY_PATH)) {
  console.log(red(`[mp-ci/preview] robot key 文件不存在: ${ENV.MP_CI_KEY_PATH}`));
  process.exit(1);
}

const ci = await loadCi();
if (!ci) {
  console.log(yellow('[mp-ci/preview] miniprogram-ci 未安装，占位跳过。'));
  console.log(yellow('  激活时执行: npm i -D miniprogram-ci'));
  process.exit(0);
}

const project = new ci.Project({
  appid: ENV.MP_APPID,
  type: 'miniProgram',
  projectPath: ENV.MP_PROJECT_PATH,
  privateKeyPath: ENV.MP_CI_KEY_PATH,
  ignores: ['node_modules/**/*'],
});

const qrcodePath = join(process.cwd(), 'reports', `mp-preview-${Date.now()}.png`);

try {
  const result = await ci.preview({
    project,
    desc: ENV.MP_DESC,
    setting: { es6: true, minify: true, codeProtect: true },
    qrcodeFormat: 'image',
    qrcodeOutputDest: qrcodePath,
  });
  console.log(green('[mp-ci/preview] OK'));
  writeReport(`mp-preview-${Date.now()}.json`, { env: ENV.MP_ENV, desc: ENV.MP_DESC, result });
} catch (e) {
  console.log(red(`[mp-ci/preview] 失败: ${e?.message || e}`));
  process.exit(1);
}
