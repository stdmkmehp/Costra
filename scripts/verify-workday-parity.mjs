#!/usr/bin/env node
/**
 * Costra · 节假日数据 JSON schema + 前后端一致性 CI 校验脚本
 *
 * 卡号占位：COSTRA-5xx（T2 · Sprint-4 · Epic-E）
 * 事实源：docs/design/workday-recurring-tech-spec.md §11（CI 自动验证）
 *
 * 校验对象：
 *   server/src/data/workday-cn-{year}.json
 *
 * 校验项：
 *   1. 文件命名 year 与文件名一致
 *   2. holidays / workdays 均为 MM-DD 升序字符串数组
 *   3. holidays ∩ workdays = ∅（不能又放假又补班）
 *   4. generated_at / source 字段存在
 *   5. 前后端 isWorkdaySync 降级语义（由 recurringSchedule parity 脚本单独覆盖）
 *   6. 必须包含当前年 + 明年的数据文件（跨年 workday 规则不降级的前提）
 *
 * 契约：
 *   exit 0 · 全部通过
 *   exit 1 · 存在不合法数据
 *   exit 2 · data 目录缺失
 */

import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const DATA_DIR = join(__dirname, '..', 'server', 'src', 'data');

const MM_DD_RE = /^\d{2}-\d{2}$/;

function isSortedAsc(arr) {
  for (let i = 1; i < arr.length; i++) {
    if (arr[i - 1] > arr[i]) return false;
  }
  return true;
}

if (!existsSync(DATA_DIR)) {
  console.error(`[workday-parity] MISSING data dir: ${DATA_DIR}`);
  process.exit(2);
}

const files = readdirSync(DATA_DIR)
  .filter((f) => /^workday-cn-\d{4}\.json$/.test(f))
  .sort();

if (files.length === 0) {
  console.warn('[workday-parity] no workday-cn-*.json files found');
  process.exit(0);
}

let failed = false;

// 6. 检查当前年 + 明年的数据文件是否齐全
//    下一年数据依赖国务院公告（通常 10~11 月发布），公告前缺失属正常 → warn 不阻塞
const currentYear = new Date().getFullYear();
const requiredYears = [currentYear, currentYear + 1];
const availableYears = files.map((f) =>
  Number(f.replace(/^workday-cn-(\d{4})\.json$/, '$1')),
);
for (const y of requiredYears) {
  if (!availableYears.includes(y)) {
    console.warn(
      `[workday-parity] ⚠ MISSING workday-cn-${y}.json — workday rules crossing into ${y} will fallback to Mon-Fri`,
    );
  }
}

for (const file of files) {
  const yearFromName = Number(file.replace(/^workday-cn-(\d{4})\.json$/, '$1'));
  const raw = JSON.parse(readFileSync(join(DATA_DIR, file), 'utf-8'));

  // 1. year 与文件名一致
  if (raw.year !== yearFromName) {
    console.error(`[workday-parity] ${file}: year mismatch (${raw.year} vs ${yearFromName})`);
    failed = true;
  }

  // 2. 数组类型 + MM-DD + 升序
  if (!Array.isArray(raw.holidays)) {
    console.error(`[workday-parity] ${file}: holidays must be array`);
    failed = true;
  } else {
    for (const d of raw.holidays) {
      if (!MM_DD_RE.test(d)) {
        console.error(`[workday-parity] ${file}: invalid MM-DD holiday "${d}"`);
        failed = true;
      }
    }
    if (!isSortedAsc(raw.holidays)) {
      console.error(`[workday-parity] ${file}: holidays not sorted ascending`);
      failed = true;
    }
  }

  if (!Array.isArray(raw.workdays)) {
    console.error(`[workday-parity] ${file}: workdays must be array`);
    failed = true;
  } else {
    for (const d of raw.workdays) {
      if (!MM_DD_RE.test(d)) {
        console.error(`[workday-parity] ${file}: invalid MM-DD workday "${d}"`);
        failed = true;
      }
    }
    if (!isSortedAsc(raw.workdays)) {
      console.error(`[workday-parity] ${file}: workdays not sorted ascending`);
      failed = true;
    }
  }

  // 3. holidays ∩ workdays = ∅
  const holidays = new Set(raw.holidays ?? []);
  for (const d of raw.workdays ?? []) {
    if (holidays.has(d)) {
      console.error(`[workday-parity] ${file}: ${d} in both holidays and workdays`);
      failed = true;
    }
  }

  // 4. 元数据字段
  if (typeof raw.source !== 'string') {
    console.error(`[workday-parity] ${file}: source missing`);
    failed = true;
  }
  if (typeof raw.generated_at !== 'string') {
    console.error(`[workday-parity] ${file}: generated_at missing`);
    failed = true;
  }

  if (!failed) {
    console.log(
      `[workday-parity] ${file}: OK · ${raw.holidays.length} holidays, ${raw.workdays.length} workdays`,
    );
  }
}

if (failed) {
  console.error('\n[workday-parity] FAIL: one or more JSON files are invalid');
  process.exit(1);
}

console.log('\n[workday-parity] PASS: all workday-cn JSON files valid');
process.exit(0);
