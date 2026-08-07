#!/usr/bin/env node
/**
 * Costra · 节假日数据抓取脚本
 *
 * 从 https://www.shuyz.com/githubfiles/china-holiday-calender
 *   /master/holidayAPI.json 解析指定年份的节假日信息，
 * 输出为项目标准 JSON 格式。
 *
 * 用法：
 *   node scripts/fetch-holidays.mjs                  # 当前年 + 明年
 *   node scripts/fetch-holidays.mjs 2025 2026 2027   # 指定年份
 *
 * 输出：
 *   server/src/data/workday-cn-{year}.json
 *
 * 事实源：docs/design/workday-recurring-tech-spec.md §9.1
 */

import { writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const SOURCE_URL =
  'https://www.shuyz.com/githubfiles/china-holiday-calender/master/holidayAPI.json';

function toMonthDay(date) {
  return (
    String(date.getMonth() + 1).padStart(2, '0') +
    '-' +
    String(date.getDate()).padStart(2, '0')
  );
}

/**
 * 手动解析 'YYYY-MM-DD' 为本地 Date，避免 `new Date('YYYY-MM-DD')` 按 UTC 解析
 * 但 `getMonth()/getDate()` 取本地时区导致的跨时区偏移问题。
 */
function parseDate(s) {
  const [y, m, d] = s.split('-').map(Number);
  return new Date(y, m - 1, d);
}

async function main() {
  const args = process.argv.slice(2);
  const years = args.length > 0
    ? args.map(Number)
    : [new Date().getFullYear(), new Date().getFullYear() + 1];

  const resp = await fetch(SOURCE_URL);
  if (!resp.ok) {
    throw new Error(`fetch ${SOURCE_URL} failed: HTTP ${resp.status}`);
  }
  const data = await resp.json();

  const dataDir = join(__dirname, '..', 'server', 'src', 'data');
  if (!existsSync(dataDir)) mkdirSync(dataDir, { recursive: true });

  for (const year of years) {
    const yearData = data.Years?.[String(year)];
    if (!yearData) {
      console.warn(`⚠ ${year} 年节假日数据未找到，跳过`);
      continue;
    }

    const holidays = new Set();
    const workdays = new Set();
    let sourceUrl = '';

    for (const holiday of yearData) {
      // 放假区间展开
      const start = parseDate(holiday.StartDate);
      const end = parseDate(holiday.EndDate);
      for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
        holidays.add(toMonthDay(d));
      }

      // 调休补班日
      if (Array.isArray(holiday.CompDays)) {
        for (const compDay of holiday.CompDays) {
          workdays.add(toMonthDay(parseDate(compDay)));
        }
      }

      if (holiday.URL) sourceUrl = holiday.URL;
    }

    // 校验：holidays 和 workdays 无交集
    for (const d of holidays) {
      if (workdays.has(d)) {
        throw new Error(`${year} 年 ${d} 同时出现在 holidays 和 workdays 中`);
      }
    }

    const json = {
      year,
      holidays: [...holidays].sort(),
      workdays: [...workdays].sort(),
      source: '国务院办公厅关于' + year + '年部分节假日安排的通知',
      source_url: sourceUrl,
      generated_at: new Date().toISOString(),
    };

    const outputPath = join(dataDir, `workday-cn-${year}.json`);
    writeFileSync(outputPath, JSON.stringify(json, null, 2) + '\n');
    console.log(
      `✓ ${outputPath} · ${holidays.size} holidays, ${workdays.size} workdays`,
    );
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
