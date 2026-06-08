#!/usr/bin/env node
// scripts/mp-ci/upload.mjs · 正式版上传（占位骨架）
// Refs: COSTRA-040
// 缺 robot key 时优雅短路；体积红线 main>1.5MB 或 total>16MB 直接退出 1

import { createInterface } from 'node:readline/promises';
import { stdin, stdout } from 'node:process';
import { existsSync } from 'node:fs';
import { guardEnv, loadCi, writeReport, red, green, yellow } from './_lib.mjs';

const args = new Set(process.argv.slice(2));
const YES = args.has('--yes') || args.has('-y') || process.env.CI === 'true';

const ENV = {
  MP_APPID: process.env.MP_APPID,
  MP_CI_KEY_PATH: process.env.MP_CI_KEY_PATH,
  MP_PROJECT_PATH: process.env.MP_PROJECT_PATH || process.cwd(),
  MP_ENV: process.env.MP_ENV || 'production',
  MP_VERSION: process.env.MP_VERSION,
  MP_DESC: process.env.MP_DESC || `release ${process.env.MP_VERSION}`,
};

const missing = guardEnv(ENV, ['MP_APPID', 'MP_CI_KEY_PATH', 'MP_VERSION']);
if (missing.length) {
  console.log(red('[mp-ci/upload] 缺少必要环境变量：' + missing.join(', ')));
  console.log(yellow('[mp-ci/upload] 配置示例请见 docs/devops/secrets.md §激活清单'));
  process.exit(1);
}
if (!/^\d+\.\d+\.\d+$/.test(ENV.MP_VERSION)) {
  console.log(red(`[mp-ci/upload] 版本号非法: ${ENV.MP_VERSION}（期望 MAJOR.MINOR.PATCH）`));
  process.exit(1);
}
if (!existsSync(ENV.MP_CI_KEY_PATH)) {
  console.log(red(`[mp-ci/upload] robot key 文件不存在: ${ENV.MP_CI_KEY_PATH}`));
  process.exit(1);
}

// 非 CI 环境下二次确认
if (ENV.MP_ENV === 'production' && !YES) {
  const rl = createInterface({ input: stdin, output: stdout });
  const ans = await rl.question(
    yellow(`⚠️  即将向 PRODUCTION 上传 v${ENV.MP_VERSION} (AppID=${ENV.MP_APPID})，确认吗？ [yes/N] `),
  );
  rl.close();
  if (ans.trim().toLowerCase() !== 'yes') {
    console.log(red('[mp-ci/upload] 用户取消'));
    process.exit(1);
  }
}

const ci = await loadCi();
if (!ci) {
  console.log(yellow('[mp-ci/upload] miniprogram-ci 未安装，占位跳过。'));
  process.exit(0);
}

const project = new ci.Project({
  appid: ENV.MP_APPID,
  type: 'miniProgram',
  projectPath: ENV.MP_PROJECT_PATH,
  privateKeyPath: ENV.MP_CI_KEY_PATH,
  ignores: ['node_modules/**/*'],
});

try {
  const result = await ci.upload({
    project,
    version: ENV.MP_VERSION,
    desc: ENV.MP_DESC,
    setting: { es6: true, minify: true, codeProtect: true, autoPrefixWXSS: true },
  });
  const { subPackageInfo = [] } = result || {};
  const mainPkg = subPackageInfo.find((p) => p.name === '__FULL__' || p.name === 'main');
  const totalSize = subPackageInfo.reduce((a, p) => a + (p.size || 0), 0);

  console.log(green('[mp-ci/upload] 上传完成'));
  console.table(subPackageInfo.map((p) => ({ name: p.name, size_kb: Math.round((p.size || 0) / 1024) })));

  if (mainPkg && mainPkg.size > 1.5 * 1024 * 1024) {
    console.log(red(`[mp-ci/upload] 主包体积 ${(mainPkg.size / 1024 / 1024).toFixed(2)}MB 超 1.5MB 红线！`));
    process.exit(1);
  }
  if (totalSize > 16 * 1024 * 1024) {
    console.log(red(`[mp-ci/upload] 总包体积 ${(totalSize / 1024 / 1024).toFixed(2)}MB 超 16MB 红线！`));
    process.exit(1);
  }
  writeReport(`mp-upload-${ENV.MP_VERSION}.json`, { env: ENV.MP_ENV, version: ENV.MP_VERSION, subPackageInfo, totalSize });
} catch (e) {
  console.log(red(`[mp-ci/upload] 失败: ${e?.message || e}`));
  process.exit(1);
}
