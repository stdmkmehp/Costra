#!/usr/bin/env node
// scripts/check-syntax.mjs · 语法自检脚本
// 在本机验证所有 .mjs 文件的语法（不需要 npm install）

import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { execSync } from 'child_process';

const __dirname = dirname(fileURLToPath(import.meta.url));
const projectRoot = join(__dirname, '..');

let errors = 0;
let checked = 0;

// ─── 检查 .mjs 文件语法 ───────────────────────────────────────────────────────

const mjsFiles = [
  'config.mjs',
  'templates/common.mjs',
  'templates/daily.mjs',
  'templates/range.mjs',
  'templates/weekly.mjs',
  'scripts/render.mjs',
  'scripts/send-mail.mjs',
  'scripts/send-failure-mail.mjs',
  'scripts/check-syntax.mjs',
];

console.log('=== JavaScript 语法检查 ===\n');

for (const file of mjsFiles) {
  const fullPath = join(projectRoot, file);
  try {
    execSync(`node --input-type=module --check < "${fullPath}"`, {
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    console.log(`  ✓ ${file}`);
    checked++;
  } catch (e) {
    console.error(`  ✗ ${file}`);
    console.error(`    ${e.stderr?.toString().trim() || e.message}`);
    errors++;
  }
}

// ─── 检查 bash 脚本语法 ───────────────────────────────────────────────────────

console.log('\n=== Bash 语法检查 ===\n');

const bashFiles = [
  'scripts/analyze.sh',
  'scripts/analyze-in-container.sh',
  'scripts/pick-dump.sh',
  'scripts/restore-database.sh',
  'scripts/run-queries.sh',
  'scripts/lib/common.sh',
  'scripts/lib/parse-args.sh',
];

for (const file of bashFiles) {
  const fullPath = join(projectRoot, file);
  try {
    execSync(`bash -n "${fullPath}"`, {
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    console.log(`  ✓ ${file}`);
    checked++;
  } catch (e) {
    console.error(`  ✗ ${file}`);
    console.error(`    ${e.stderr?.toString().trim() || e.message}`);
    errors++;
  }
}

// ─── 检查 package.json ────────────────────────────────────────────────────────

console.log('\n=== package.json 检查 ===\n');
try {
  const pkg = JSON.parse(readFileSync(join(projectRoot, 'package.json'), 'utf8'));
  console.log(`  ✓ package.json (name: ${pkg.name}, type: ${pkg.type})`);
  checked++;
} catch (e) {
  console.error(`  ✗ package.json: ${e.message}`);
  errors++;
}

// ─── 检查 docker-compose.yml ─────────────────────────────────────────────────

console.log('\n=== docker-compose.yml 检查 ===\n');
try {
  // 简单检查 YAML 结构（不需要 docker）
  const content = readFileSync(join(projectRoot, 'docker-compose.yml'), 'utf8');
  const hasPg     = content.includes('costra-analyze-pg');
  const hasNode   = content.includes('costra-analyze-node');
  const hasPort   = content.includes('127.0.0.1:15432');
  if (hasPg && hasNode && hasPort) {
    console.log('  ✓ docker-compose.yml (双容器 + 端口)');
    checked++;
  } else {
    console.error('  ✗ docker-compose.yml 缺少必要字段');
    errors++;
  }
} catch (e) {
  console.error(`  ✗ docker-compose.yml: ${e.message}`);
  errors++;
}

// ─── 检查 SQL 文件 ────────────────────────────────────────────────────────────

console.log('\n=== SQL 文件检查 ===\n');
const sqlFiles = [
  '10-summary', '20-new-users', '30-new-ledgers', '40-new-entries',
  '50-new-invites', '60-active-users', '90-anomaly',
];

for (const name of sqlFiles) {
  const fullPath = join(projectRoot, 'sql', `${name}.sql`);
  try {
    const content = readFileSync(fullPath, 'utf8');
    const hasWindowStart = content.includes(":'window_start'");
    const hasWindowEnd = content.includes(":'window_end'");
    const hasLegacySchema = content.includes(":'schema'") || content.includes('SET search_path');
    if (!hasWindowStart || !hasWindowEnd || hasLegacySchema) {
      console.error(`  ✗ sql/${name}.sql 时间窗口参数缺失或仍含旧 schema 参数`);
      errors++;
    } else {
      console.log(`  ✓ sql/${name}.sql`);
      checked++;
    }
  } catch (e) {
    console.error(`  ✗ sql/${name}.sql: ${e.message}`);
    errors++;
  }
}

// ─── 汇总 ─────────────────────────────────────────────────────────────────────

console.log(`\n${'─'.repeat(50)}`);
if (errors === 0) {
  console.log(`✓ 全部通过（${checked} 项）`);
} else {
  console.error(`✗ ${errors} 项失败，${checked} 项通过`);
  process.exit(1);
}
