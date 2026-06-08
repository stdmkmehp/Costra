#!/usr/bin/env node
/**
 * Costra · 微信工具链配置单源 CI 校验脚本
 *
 * 卡号：COSTRA-121（Rule-5a/5b/5c · 工具链 SSOT 规约级）
 * Owner：MiniApp-Agent（跨区交付 · 放 DevOps 脚本域对齐 115/116/119/120 先例）
 * 母问题：
 *   - 2026-04-28 15:58：Human 第三次打开微信开发者工具模拟器启动 · app.ts:6 `import` 报
 *     `module 'tokens/tokens.json.js' is not defined` ·
 *     根因：工具读 `miniprogram/project.config.json`（GUI 自建副本 · `useCompilerPlugins: false`）·
 *     未启用 TS 编译插件 → TS JSON import 无法正确转译为 commonjs require 且自动补 `.js` 扩展
 * 姊妹脚本：
 *   - scripts/devops/whitelist-check.mjs（COSTRA-115 · 域名方向三源对账）
 *   - scripts/devops/appjson-pages-check.mjs（COSTRA-119/120 · app.json 一致性 Rule-1~4）
 *
 * 职责划分（与 appjson-pages-check 明确不同族 · 单一职责 SRP）：
 *   · appjson-pages-check · app.json ↔ 文件系统一致性 + tabBar 微信规约
 *   · miniapp-tooling-check（本脚本）· 微信工具链配置 SSOT 单源 · 三子规约
 *
 * 对账范围（三子规约 · 任一违反即 exit 1）：
 *
 *   Rule-5a · 根目录 `project.config.json` 必须存在
 *     · 微信工具以 `miniprogramRoot` 指向源码子目录的范式要求工具打开项目根
 *     · 根 config 缺失 → 工具无法打开项目（Human 2026-04-28 16:52 确认）
 *     · 当前已由 `git restore` 恢复 · 本规约防止再次工作区丢失
 *
 *   Rule-5b · 根 `project.config.json` 的 `setting.useCompilerPlugins` 必须包含 `"typescript"`
 *     · 微信官方 TS 编译插件启用位 · 缺失则 TS `import json from './x.json'` 无法转译为运行期可识别 require
 *     · 编译期（tsc `resolveJsonModule: true`）与运行期（微信 runtime）语义必须对齐
 *     · 本规约从工具链配置层保证运行期 TS 支持开启
 *
 *   Rule-5c · 子目录 `miniprogram/project.config.json` 禁出现
 *     · 微信工具被错误打开在 `miniprogram/` 子目录时 GUI 会自动生成此副本（`useCompilerPlugins: false`）
 *     · 与根 config（SSOT）漂移 · 本规约为 D-011 SSOT 在工具链层的首次实战
 *     · `.gitignore` 已兜底防入库 · 本规约防止误 `git add -f` + 引导 Human 纠正打开姿势
 *
 * 契约：
 *   exit 0 · 三子规约全部通过
 *   exit 1 · Rule-5a / 5b / 5c 任一违反
 *   exit 2 · 解析失败（project.config.json 损坏 / 不是合法 JSON）
 *
 * 实现：零依赖（仅 Node 原生 fs / path / url · 沿袭 appjson-pages-check 范式）
 *
 * 使用：
 *   node ./scripts/devops/miniapp-tooling-check.mjs              · 正常对账
 *   node ./scripts/devops/miniapp-tooling-check.mjs --verbose    · 打印扫描与子规约过程
 */

import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, '..', '..');

const ROOT_CONFIG_PATH = path.join(repoRoot, 'project.config.json');
const SUB_CONFIG_PATH = path.join(repoRoot, 'miniprogram', 'project.config.json');

// ------------------------------------------------------------------
// Rule-5a · 根 project.config.json 必须存在
// ------------------------------------------------------------------
function checkRule5aRootConfigPresent() {
  if (existsSync(ROOT_CONFIG_PATH)) return null;
  return (
    `[Rule-5a] 工作区缺失根 project.config.json：${path.relative(repoRoot, ROOT_CONFIG_PATH)}\n` +
    `  · 微信开发者工具无法打开项目（COSTRA-121 · Human 2026-04-28 16:52 确认）\n` +
    `  · 修复：git restore project.config.json（HEAD 里有 58 行完整副本）\n` +
    `  · 长期：Human 务必打开 Costra/ 项目根而非 miniprogram/ 子目录 · 见 README.md §本地开发`
  );
}

// ------------------------------------------------------------------
// Rule-5b · 根 project.config.json 的 setting.useCompilerPlugins 必须含 "typescript"
// ------------------------------------------------------------------
function checkRule5bTypescriptCompilerPlugin() {
  let cfg;
  try {
    cfg = JSON.parse(readFileSync(ROOT_CONFIG_PATH, 'utf8'));
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    throw new Error(`project.config.json 不是合法 JSON: ${msg}`);
  }
  const plugins = cfg && cfg.setting ? cfg.setting.useCompilerPlugins : undefined;
  const isValid = Array.isArray(plugins) && plugins.includes('typescript');
  if (isValid) return null;
  const current = JSON.stringify(plugins);
  return (
    `[Rule-5b] 根 project.config.json 的 setting.useCompilerPlugins 未启用 "typescript" 编译插件\n` +
    `  · 当前值：${current}\n` +
    `  · 后果：TS "import json from './x.json'" 在微信 runtime 无法转译 · 报 module 'x.json.js' not defined\n` +
    `  · 修复：将 setting.useCompilerPlugins 改为包含 "typescript" 的数组（如 ["typescript"]）\n` +
    `  · 参见：微信官方 TS 编译插件文档 / COSTRA-121 背景 §0`
  );
}

// ------------------------------------------------------------------
// Rule-5c · 子目录 miniprogram/project.config.json 禁出现
// ------------------------------------------------------------------
function checkRule5cNoSubConfigDrift() {
  if (!existsSync(SUB_CONFIG_PATH)) return null;
  return (
    `[Rule-5c] 发现子目录 GUI 自建副本：${path.relative(repoRoot, SUB_CONFIG_PATH)}\n` +
    `  · 根因：微信工具被打开在 miniprogram/ 子目录作为项目根 · GUI 自动生成此副本\n` +
    `  · 副本默认 useCompilerPlugins: false · 与根 config（SSOT）漂移 · 违反 D-011 SSOT 规约\n` +
    `  · 修复：rm miniprogram/project.config.json（当前已 .gitignore · 无需 git rm）\n` +
    `  · 长期：Human 务必打开 Costra/ 项目根启动微信工具 · 见 README.md §本地开发\n` +
    `  · 参见：COSTRA-121 背景 §0 · D-011 SSOT 规约工具链层首次实战`
  );
}

// ------------------------------------------------------------------
// 主流程
// ------------------------------------------------------------------
function main() {
  const verbose = process.argv.includes('--verbose');
  const errors = [];

  // Rule-5a
  const err5a = checkRule5aRootConfigPresent();
  if (err5a) {
    errors.push(err5a);
    if (verbose) {
      console.log('[tooling-check] Rule-5a · root project.config.json present: ❌');
    }
  } else if (verbose) {
    console.log('[tooling-check] Rule-5a · root project.config.json present: ✅');
  }

  // Rule-5b（仅当 5a 过时才能解析 · 否则文件不存在无法读取）
  if (!err5a) {
    let err5b;
    try {
      err5b = checkRule5bTypescriptCompilerPlugin();
    } catch (e) {
      console.error('[tooling-check] Rule-5b 解析 project.config.json 失败（exit 2）：');
      console.error(e instanceof Error ? e.stack : String(e));
      process.exit(2);
    }
    if (err5b) {
      errors.push(err5b);
      if (verbose) {
        console.log('[tooling-check] Rule-5b · useCompilerPlugins includes "typescript": ❌');
      }
    } else if (verbose) {
      console.log('[tooling-check] Rule-5b · useCompilerPlugins includes "typescript": ✅');
    }
  }

  // Rule-5c
  const err5c = checkRule5cNoSubConfigDrift();
  if (err5c) {
    errors.push(err5c);
    if (verbose) {
      console.log('[tooling-check] Rule-5c · no sub-directory drift: ❌');
    }
  } else if (verbose) {
    console.log('[tooling-check] Rule-5c · no sub-directory drift: ✅');
  }

  if (errors.length === 0) {
    console.log(
      `✅ tooling single-source: root project.config.json present · ` +
        `useCompilerPlugins includes "typescript" · no sub-directory drift ` +
        `(3/3 rules pass · COSTRA-121)`
    );
    process.exit(0);
  }

  console.error('❌ tooling single-source violation detected:');
  for (const e of errors) console.error(`  · ${e}\n`);
  console.error('修复指引汇总：');
  console.error('  ① Human 务必打开 `Costra/` 项目根启动微信工具 · 不要打开 `miniprogram/` 子目录');
  console.error('  ② 若根 project.config.json 缺失：`git restore project.config.json`');
  console.error('  ③ 若子 miniprogram/project.config.json 出现：`rm miniprogram/project.config.json`');
  console.error('  ④ 若 useCompilerPlugins 未含 "typescript"：编辑根 project.config.json setting 段');
  console.error('  ⑤ 修复后重跑 `npm run check:tooling`');
  console.error('  ⑥ 详细背景：.team/dispatch/COSTRA-121-miniapp-fix-project-config-drift.md');
  process.exit(1);
}

main();
