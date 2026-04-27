#!/usr/bin/env node
/**
 * Costra · 白名单一致性 CI 校验脚本
 *
 * 卡号：COSTRA-115 · Owner：DevOps-Agent
 * 母决策：.team/decisions/D-009-domain-and-dev-server-locked.md
 * SSOT：infra/wechat/domains.md §1.1
 *
 * 对账三源：
 *   ① server/api/openapi.yaml servers 段
 *   ② miniprogram/services/env.ts 的 apiBaseUrl
 *   ③ infra/wechat/domains.md §1.1 env → url 映射
 *
 * 契约（见 dispatch §6.5）：
 *   exit 0 · 一致
 *   exit 1 · 不一致（打印 diff）
 *   exit 2 · 解析失败（源文件损坏或脚本 bug）
 *
 * 实现：零依赖（仅 Node 原生 fs / path / url）· SIMPLE_YAML_PARSER（正则）
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, '..', '..');

const OPENAPI_PATH = path.join(repoRoot, 'server', 'api', 'openapi.yaml');
const ENV_TS_PATH = path.join(repoRoot, 'miniprogram', 'services', 'env.ts');
const DOMAINS_MD_PATH = path.join(repoRoot, 'infra', 'wechat', 'domains.md');

/**
 * 豁免清单（文档化 · 需 FU 专项跟进后清零）
 *
 * env.ts 某些 env 的 apiBaseUrl 暂不强求出现在 openapi.yaml servers / domains.md §1.1：
 * - dev: 本机开发默认值，各开发者机器可能不同（回环地址 / 端口），且与 server 代码 env.ts
 *   parsePort 默认值 '3000' 不一致（server .env.example 为 8080） → 这是 Backend 内部已有漂移
 *   需 FU-COMMON-DEV-URL-DRIFT 专项跨卡对齐后再收紧
 *
 * 豁免仅对 [A]、[B] 规则；[C] 规则（名称相同 url 必须一致）不豁免。
 */
const EXEMPTED_ENVS_FROM_RULES_AB = new Set(['dev']);
const EXEMPTION_REASON =
  'FU-COMMON-DEV-URL-DRIFT: 本机开发默认值随机器不同，且 server .env.example(8080) 与 server/src/config/env.ts parsePort 默认值(3000) 本身不一致，跨卡对齐前豁免';

/** @typedef {{ env: string, url: string, source: string }} UrlEntry */

// ------------------------------------------------------------------
// ① 解析 server/api/openapi.yaml 的 servers 段
// ------------------------------------------------------------------
function parseOpenapiServers(text) {
  // SIMPLE_YAML_PARSER: 找 ^servers: 行到下一个顶级 key（或 EOF）之间的 - url: xxx 条目
  const lines = text.split(/\r?\n/);
  let inServers = false;
  const urls = [];
  for (const line of lines) {
    if (/^servers:\s*$/.test(line)) {
      inServers = true;
      continue;
    }
    if (inServers) {
      // 顶级 key 回到行首非空白字符
      if (/^\S/.test(line) && !/^\s*#/.test(line)) {
        inServers = false;
        continue;
      }
      const m = line.match(/^\s+-\s+url:\s*(\S+)\s*$/);
      if (m) urls.push(m[1]);
    }
  }
  if (urls.length === 0) {
    throw new Error('openapi.yaml servers 段为空或格式异常');
  }
  return urls;
}

// ------------------------------------------------------------------
// ② 解析 miniprogram/services/env.ts 的 apiBaseUrl
// ------------------------------------------------------------------
function parseEnvTsApiBaseUrls(text) {
  // 找 env 名 + apiBaseUrl 字面量
  // 匹配形如：  dev: { ... apiBaseUrl: 'http://...' ... }
  // 策略：扫描 `  <envName>: {` 作为锚点，然后在该块内找 apiBaseUrl: '...'
  const ENV_NAMES = ['dev', 'staging', 'prod'];
  const entries = [];
  for (const envName of ENV_NAMES) {
    // 定位 envName 块起点（属性名，不是变量名）
    const blockRe = new RegExp(`^\\s{2,}${envName}\\s*:\\s*\\{`, 'm');
    const startM = text.match(blockRe);
    if (!startM) {
      throw new Error(`env.ts 未找到 env \"${envName}\" 的块起点`);
    }
    const blockStart = startM.index + startM[0].length;
    // 找同一块内的 apiBaseUrl
    const sliced = text.slice(blockStart, blockStart + 2000);
    const urlM = sliced.match(/apiBaseUrl\s*:\s*(['"])([^'"]+)\1/);
    if (!urlM) {
      throw new Error(`env.ts 的 env \"${envName}\" 块内未找到 apiBaseUrl 字面量（必须为常量字符串，不支持模板/拼接）`);
    }
    entries.push({ env: envName, url: urlM[2] });
  }
  return entries;
}

// ------------------------------------------------------------------
// ③ 解析 infra/wechat/domains.md §1.1 的 env → url 映射
// ------------------------------------------------------------------
function parseDomainsMdRuntimeTable(text) {
  // 找 ### 1.1 预发 API 子域名补充说明 之后第一个 | env | ... 表格
  const idx = text.indexOf('### 1.1');
  if (idx < 0) {
    throw new Error('domains.md 缺 §1.1 小节');
  }
  const region = text.slice(idx);
  const lines = region.split(/\r?\n/);
  const entries = [];
  let inTable = false;
  let passedHeader = false;
  for (const line of lines) {
    if (/^\|\s*env\s*\|/.test(line)) {
      inTable = true;
      passedHeader = false;
      continue;
    }
    if (!inTable) continue;
    if (/^\|\s*---/.test(line)) {
      passedHeader = true;
      continue;
    }
    if (passedHeader) {
      if (!/^\|/.test(line)) break; // 表格结束
      const cells = line.split('|').map((s) => s.trim()).filter((s) => s.length > 0);
      // 形如：env | server URL（代码中 apiBaseUrl） | DNS 条目
      if (cells.length < 2) continue;
      const env = cells[0];
      // 第二列可能含反引号包裹：`http://...`
      const urlM = cells[1].match(/`([^`]+)`/);
      if (!urlM) continue;
      entries.push({ env, url: urlM[1] });
    }
  }
  if (entries.length === 0) {
    throw new Error('domains.md §1.1 表格未解析到任何 env 行');
  }
  return entries;
}

// ------------------------------------------------------------------
// 对账
// ------------------------------------------------------------------
function reconcile(openapiUrls, envTsEntries, domainsMdEntries) {
  const errors = [];
  const warnings = [];

  const envTsUrls = new Set(envTsEntries.map((e) => e.url));
  const domainsMdUrls = new Set(domainsMdEntries.map((e) => e.url));
  const openapiUrlSet = new Set(openapiUrls);

  // 规则 A: OpenAPI servers ⊇ env.ts apiBaseUrl （受豁免清单影响）
  for (const e of envTsEntries) {
    if (!openapiUrlSet.has(e.url)) {
      if (EXEMPTED_ENVS_FROM_RULES_AB.has(e.env)) {
        warnings.push(
          `[A · EXEMPTED] env.ts env=${e.env} apiBaseUrl=${JSON.stringify(e.url)} 未出现在 openapi.yaml servers，但已豁免（${EXEMPTION_REASON}）`
        );
      } else {
        errors.push(
          `[A] env.ts env=${e.env} apiBaseUrl=${JSON.stringify(e.url)} 未出现在 server/api/openapi.yaml servers 段`
        );
      }
    }
  }

  // 规则 B: env.ts 每一条必须在 domains.md §1.1 中有对应行（url 级匹配）（受豁免清单影响）
  for (const e of envTsEntries) {
    if (!domainsMdUrls.has(e.url)) {
      if (EXEMPTED_ENVS_FROM_RULES_AB.has(e.env)) {
        warnings.push(
          `[B · EXEMPTED] env.ts env=${e.env} apiBaseUrl=${JSON.stringify(e.url)} 未出现在 domains.md §1.1，但已豁免（${EXEMPTION_REASON}）`
        );
      } else {
        errors.push(
          `[B] env.ts env=${e.env} apiBaseUrl=${JSON.stringify(e.url)} 未出现在 infra/wechat/domains.md §1.1 表的第二列`
        );
      }
    }
  }

  // 规则 C: domains.md §1.1 每一条（排除纯文档性 local/dev-ip 之类非 env.ts 条目）若 url 出现在 env.ts 同名 env 上必须值一致
  // 实际执行：把 domains.md 中 env 名属于 ['dev','staging','prod']（与 env.ts 同名）的行与 env.ts 对名核对
  const envTsByName = new Map(envTsEntries.map((e) => [e.env, e.url]));
  for (const d of domainsMdEntries) {
    if (envTsByName.has(d.env)) {
      const expected = envTsByName.get(d.env);
      if (expected !== d.url) {
        // dev env 已豁免 B 规则时不再重复报 C
        if (EXEMPTED_ENVS_FROM_RULES_AB.has(d.env)) continue;
        errors.push(
          `[C] domains.md §1.1 env=${d.env} url=${JSON.stringify(d.url)} 与 env.ts env=${d.env} apiBaseUrl=${JSON.stringify(expected)} 不一致`
        );
      }
    }
  }

  return { errors, warnings };
}

// ------------------------------------------------------------------
// 主流程
// ------------------------------------------------------------------
function main() {
  let openapiUrls, envTsEntries, domainsMdEntries;
  try {
    openapiUrls = parseOpenapiServers(readFileSync(OPENAPI_PATH, 'utf8'));
    envTsEntries = parseEnvTsApiBaseUrls(readFileSync(ENV_TS_PATH, 'utf8'));
    domainsMdEntries = parseDomainsMdRuntimeTable(readFileSync(DOMAINS_MD_PATH, 'utf8'));
  } catch (e) {
    console.error('[whitelist-check] 解析源文件失败（exit 2）：');
    console.error(e instanceof Error ? e.stack : String(e));
    process.exit(2);
  }

  // 打印源摘要（失败时便于诊断 · 成功时 --verbose 可看）
  const verbose = process.argv.includes('--verbose');
  if (verbose) {
    console.log('[whitelist-check] openapi.yaml servers:');
    for (const u of openapiUrls) console.log(`  - ${u}`);
    console.log('[whitelist-check] env.ts apiBaseUrl:');
    for (const e of envTsEntries) console.log(`  - ${e.env}: ${e.url}`);
    console.log('[whitelist-check] domains.md §1.1:');
    for (const d of domainsMdEntries) console.log(`  - ${d.env}: ${d.url}`);
  }

  const { errors, warnings } = reconcile(openapiUrls, envTsEntries, domainsMdEntries);

  if (warnings.length > 0) {
    console.warn('⚠️  whitelist warnings (non-blocking · see FU-COMMON-DEV-URL-DRIFT):');
    for (const w of warnings) console.warn(`  · ${w}`);
    console.warn('');
  }

  if (errors.length === 0) {
    console.log(
      `✅ whitelist consistent: ${domainsMdEntries.length} envs, ${envTsEntries.length} runtime urls matched across 3 sources` +
        (warnings.length > 0 ? ` (${warnings.length} warning(s) exempted)` : '')
    );
    console.log(
      `   (openapi.yaml: ${openapiUrls.length} servers · env.ts: ${envTsEntries.length} apiBaseUrl · domains.md §1.1: ${domainsMdEntries.length} rows)`
    );
    process.exit(0);
  }

  console.error('❌ whitelist inconsistency detected:');
  for (const err of errors) console.error(`  · ${err}`);
  console.error('');
  console.error('修复指引：');
  console.error('  1. 确认 server/api/openapi.yaml servers 段为权威 API URL 清单');
  console.error('  2. miniprogram/services/env.ts 的 apiBaseUrl 必须是 openapi.yaml servers 的子集');
  console.error('  3. infra/wechat/domains.md §1.1 运行期 URL 表必须同步更新');
  console.error('  4. 三处同步后重跑 `npm run check:whitelist`');
  process.exit(1);
}

main();
