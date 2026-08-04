#!/usr/bin/env node
/**
 * Costra · recurringSchedule.ts 前后端同源 CI 校验脚本
 *
 * 卡号占位：COSTRA-5xx（T1 · Sprint-4 · Epic-E）
 * 事实源：
 *   - docs/design/recurring-entry-tech-spec.md §7.5（前后端一致性保障 · R8 风险缓解）
 *   - docs/design/recurring-entry-task-breakdown.md T1
 *
 * 校验对象：
 *   server/src/services/recurringSchedule.ts
 *   miniprogram/services/recurringSchedule.ts
 *
 * 契约：
 *   exit 0 · 两份 byte-level 一致（sha256 相同）
 *   exit 1 · 两份内容漂移（打印 diff 提示）
 *   exit 2 · 文件缺失
 *
 * 归一化规则：
 *   - CRLF → LF（跨平台 checkout 差异）
 *   - 保留所有其它内容（含注释、空行、缩进）
 *
 * 触发时机：
 *   - CI（.github/workflows/pr-check.yml）中 typecheck 之前
 *   - 本地 `npm run parity` 手动触发
 *
 * 未来演进：
 *   Sprint-5 若引入 monorepo shared package 可彻底解决双写维护
 *   本期用 CI 校验兜底
 */

import { readFileSync, existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const REPO_ROOT = resolve(__dirname, '..');

const TARGETS = [
  {
    label: 'server',
 path: resolve(REPO_ROOT, 'server/src/services/recurringSchedule.ts'),
  },
  {
    label: 'miniprogram',
    path: resolve(REPO_ROOT, 'miniprogram/services/recurringSchedule.ts'),
  },
];

const FORMAT_TARGETS = [
  {
    label: 'server',
    path: resolve(REPO_ROOT, 'server/src/services/recurringFormat.ts'),
  },
  {
    label: 'miniprogram',
    path: resolve(REPO_ROOT, 'miniprogram/services/recurringFormat.ts'),
  },
];

function normalize(text) {
  return text.replace(/\r\n/g, '\n');
}

function hashOf(text) {
  return createHash('sha256').update(normalize(text)).digest('hex');
}

/** 简单行级 diff · 只用于错误提示可读性，非严格 diff 算法 */
function firstDiffLine(a, b) {
  const linesA = normalize(a).split('\n');
  const linesB = normalize(b).split('\n');
  const n = Math.min(linesA.length, linesB.length);
  for (let i = 0; i < n; i++) {
    if (linesA[i] !== linesB[i]) {
      return { line: i + 1, a: linesA[i], b: linesB[i] };
    }
  }
  if (linesA.length !== linesB.length) {
    return {
      line: n + 1,
      a: linesA[n] ?? '<EOF>',
      b: linesB[n] ?? '<EOF>',
    };
  }
  return null;
}

let missing = false;
const contents = [];
for (const t of TARGETS) {
  if (!existsSync(t.path)) {
    console.error(`[parity] MISSING: ${t.path}`);
    missing = true;
    continue;
  }
  contents.push({ label: t.label, path: t.path, text: readFileSync(t.path, 'utf8') });
}

if (missing) {
  console.error('\n[parity] One or more required files are missing. exit 2');
  process.exit(2);
}

const [server, client] = contents;
const hServer = hashOf(server.text);
const hClient = hashOf(client.text);

console.log('[parity] recurringSchedule.ts sha256:');
console.log(`  server      : ${hServer}  (${server.path})`);
console.log(`  miniprogram : ${hClient}  (${client.path})`);

if (hServer !== hClient) {
  const d = firstDiffLine(server.text, client.text);
  console.error('\n[parity] FAIL: byte-level drift between server and miniprogram (recurringSchedule.ts)');
  if (d) {
    console.error(`\n  first diff at line ${d.line}:`);
    console.error(`  - server    : ${JSON.stringify(d.a)}`);
    console.error(`  - miniprogram : ${JSON.stringify(d.b)}`);
  }
  console.error(
    '\n[parity] Fix: modify BOTH files in the same commit.\n' +
      '        Use `cp server/src/services/recurringSchedule.ts miniprogram/services/recurringSchedule.ts`\n' +
      '        (or the reverse) if you meant them to be identical.',
  );
  process.exit(1);
}

console.log('\n[parity] PASS: recurringSchedule.ts byte-level identical');

// ===== recurringFormat.ts parity check =====

let formatMissing = false;
const formatContents = [];
for (const t of FORMAT_TARGETS) {
  if (!existsSync(t.path)) {
    console.error(`[parity] MISSING: ${t.path}`);
    formatMissing = true;
    continue;
  }
  formatContents.push({ label: t.label, path: t.path, text: readFileSync(t.path, 'utf8') });
}

if (formatMissing) {
  console.error('\n[parity] One or more recurringFormat.ts files are missing. exit 2');
  process.exit(2);
}

const [fmtServer, fmtClient] = formatContents;
const hFmtServer = hashOf(fmtServer.text);
const hFmtClient = hashOf(fmtClient.text);

console.log('\n[parity] recurringFormat.ts sha256:');
console.log(`  server      : ${hFmtServer}  (${fmtServer.path})`);
console.log(`  miniprogram : ${hFmtClient}  (${fmtClient.path})`);

if (hFmtServer !== hFmtClient) {
  const d = firstDiffLine(fmtServer.text, fmtClient.text);
  console.error('\n[parity] FAIL: byte-level drift between server and miniprogram (recurringFormat.ts)');
  if (d) {
    console.error(`\n  first diff at line ${d.line}:`);
    console.error(`  - server      : ${JSON.stringify(d.a)}`);
    console.error(`  - miniprogram : ${JSON.stringify(d.b)}`);
  }
  console.error(
    '\n[parity] Fix: modify BOTH files in the same commit.\n' +
      '     Use `cp server/src/services/recurringFormat.ts miniprogram/services/recurringFormat.ts`\n' +
      '     (or the reverse) if you meant them to be identical.',
  );
  process.exit(1);
}

console.log('\n[parity] PASS: recurringFormat.ts byte-level identical');
process.exit(0);
