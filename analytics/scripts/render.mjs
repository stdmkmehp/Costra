#!/usr/bin/env node
// scripts/render.mjs · CSV → template → markdown
// 用法（两种模式）:
//   1. 获取输出路径（--get-path-only）:
//      node render.mjs --tmp <dir> --anchor <ISO> --window-ms <ms> --dump-mtime <ISO> --reports-dir <dir> --get-path-only
//   2. 实际渲染:
//      node render.mjs --tmp <dir> --anchor <ISO> --window-ms <ms> --dump-mtime <ISO> --reports-dir <dir> --out <file>
//
// 见 spec §7.3

import { readFileSync, writeFileSync, mkdirSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));

// ─── 参数解析 ─────────────────────────────────────────────────────────────────

const args = process.argv.slice(2);
const opts = {};
for (let i = 0; i < args.length; i++) {
  if (args[i].startsWith('--')) {
    const key = args[i].slice(2);
    if (args[i + 1] && !args[i + 1].startsWith('--')) {
      opts[key] = args[i + 1];
      i++;
    } else {
      opts[key] = true;
    }
  }
}

const tmpDir      = opts['tmp'];
const anchorIso   = opts['anchor'];
const windowMs    = parseInt(opts['window-ms'] || '86400000', 10);
const dumpMtimeIso= opts['dump-mtime'];
const reportsDir  = opts['reports-dir'];
const outPath     = opts['out'];
const getPathOnly = opts['get-path-only'] === true || opts['get-path-only'] === 'true';

if (!tmpDir || !anchorIso || !dumpMtimeIso || !reportsDir) {
  console.error('用法: render.mjs --tmp <dir> --anchor <ISO> --window-ms <ms> --dump-mtime <ISO> --reports-dir <dir> [--out <file>|--get-path-only]');
  process.exit(1);
}

// ─── 加载 .env（从项目根目录）────────────────────────────────────────────────

function loadEnv(envPath) {
  try {
    const text = readFileSync(envPath, 'utf8');
    const env = {};
    for (const line of text.split('\n')) {
      if (!line.trim() || line.trim().startsWith('#')) continue;
      const eqIdx = line.indexOf('=');
      if (eqIdx < 0) continue;
      const key = line.slice(0, eqIdx).trim();
      let val = line.slice(eqIdx + 1).trim();
      // 去除行内注释（无引号情况下）
      if (!val.includes('"') && !val.includes("'")) {
        val = val.split('#')[0].trim();
      }
      // 去除引号
      val = val.replace(/^['"]|['"]$/g, '');
      if (/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) {
        env[key] = val;
      }
    }
    return env;
  } catch {
    return {};
  }
}

const projectRoot = join(__dirname, '..');
const envVars = loadEnv(join(projectRoot, '.env'));

// ─── 加载阈值 ─────────────────────────────────────────────────────────────────

const { loadThresholds } = await import(join(projectRoot, 'config.mjs'));
const thresholds = loadThresholds({ ...process.env, ...envVars });

// ─── 决定 template 类型 ───────────────────────────────────────────────────────

const dayMs = 86400_000;
const templateType = windowMs >= 7 * dayMs ? 'weekly'
                   : windowMs >= 2 * dayMs ? 'range'
                   :                          'daily';

// ─── 计算输出路径 ─────────────────────────────────────────────────────────────

function calcOutputPath(type, anchorIso, windowMs, reportsDir) {
  const anchor = new Date(anchorIso);
  const startEpoch = anchor.getTime() - windowMs;
  const start = new Date(startEpoch);

  // 使用 UTC+8 时间
  const toCST = (d) => new Date(d.getTime() + 8 * 3600_000);
  const fmt = (d) => {
    const c = toCST(d);
    const y = c.getUTCFullYear();
    const m = String(c.getUTCMonth() + 1).padStart(2, '0');
    const day = String(c.getUTCDate()).padStart(2, '0');
    return `${y}-${m}-${day}`;
  };

  switch (type) {
    case 'daily': {
      const dateStr = fmt(anchor);
      return join(reportsDir, 'daily', `${dateStr}.md`);
    }
    case 'weekly': {
      // ISO 周编号
      const d = toCST(anchor);
      const dayOfWeek = d.getUTCDay() || 7;
      const thursday = new Date(d.getTime() + (4 - dayOfWeek) * 86400_000);
      const yearStart = new Date(Date.UTC(thursday.getUTCFullYear(), 0, 1));
      const weekNo = Math.ceil((((thursday - yearStart) / 86400_000) + 1) / 7);
      const weekStr = `${thursday.getUTCFullYear()}-W${String(weekNo).padStart(2, '0')}`;
      return join(reportsDir, 'weekly', `${weekStr}.md`);
    }
    case 'range': {
      const startStr = fmt(start);
      const endStr   = fmt(anchor);
      return join(reportsDir, 'range', `${startStr}_${endStr}.md`);
    }
    default:
      throw new Error(`未知 template 类型: ${type}`);
  }
}

const outputPath = outPath || calcOutputPath(templateType, anchorIso, windowMs, reportsDir);

// 若只获取路径，直接输出并退出
if (getPathOnly) {
  process.stdout.write(outputPath + '\n');
  process.exit(0);
}

// ─── 读取 CSV 文件 ────────────────────────────────────────────────────────────

const { parseCsv } = await import(join(projectRoot, 'templates', 'common.mjs'));

function readCsv(name) {
  const csvPath = join(tmpDir, `${name}.csv`);
  try {
    return parseCsv(readFileSync(csvPath, 'utf8'));
  } catch (error) {
    throw new Error(`无法读取或解析 ${csvPath}: ${error.message}`);
  }
}

const data = {
  summary:  readCsv('10-summary'),
  users:    readCsv('20-new-users'),
  ledgers:  readCsv('30-new-ledgers'),
  entries:  readCsv('40-new-entries'),
  invites:  readCsv('50-new-invites'),
  active:   readCsv('60-active-users'),
  autoOnly: readCsv('65-auto-only-users'),
  retention:readCsv('70-retention'),
  trend:    readCsv('80-daily-trend'),
  anomaly:  readCsv('90-anomaly'),
};

// ─── 计算窗口时间 ─────────────────────────────────────────────────────────────

const anchorDate  = new Date(anchorIso);
const windowStartDate = new Date(anchorDate.getTime() - windowMs);

// 转为 ISO 8601 +08:00
function toCST_ISO(d) {
  const cst = new Date(d.getTime() + 8 * 3600_000);
  const y   = cst.getUTCFullYear();
  const mo  = String(cst.getUTCMonth() + 1).padStart(2, '0');
  const day = String(cst.getUTCDate()).padStart(2, '0');
  const h   = String(cst.getUTCHours()).padStart(2, '0');
  const mi  = String(cst.getUTCMinutes()).padStart(2, '0');
  const s   = String(cst.getUTCSeconds()).padStart(2, '0');
  return `${y}-${mo}-${day}T${h}:${mi}:${s}+08:00`;
}

const meta = {
  anchorIso,
  windowMs,
  dumpMtimeIso,
  windowStartIso: toCST_ISO(windowStartDate),
  windowEndIso:   toCST_ISO(anchorDate),
};

// ─── 渲染 ─────────────────────────────────────────────────────────────────────

let renderResult;
switch (templateType) {
  case 'daily': {
    const { renderDaily } = await import(join(projectRoot, 'templates', 'daily.mjs'));
    renderResult = renderDaily(data, meta, thresholds);
    break;
  }
  case 'range': {
    const { renderRange } = await import(join(projectRoot, 'templates', 'range.mjs'));
    renderResult = renderRange(data, meta, thresholds);
    break;
  }
  case 'weekly': {
    const { renderWeekly } = await import(join(projectRoot, 'templates', 'weekly.mjs'));
    renderResult = renderWeekly(data, meta, thresholds);
    break;
  }
}

const { md, subject } = renderResult;

// ─── 写出文件 ─────────────────────────────────────────────────────────────────

// 确保目录存在
mkdirSync(dirname(outputPath), { recursive: true });

// 写 markdown 报告
writeFileSync(outputPath, md, 'utf8');

// 写 subject.txt（供 send-mail.mjs 读取）
const subjectPath = join(tmpDir, 'subject.txt');
writeFileSync(subjectPath, subject, 'utf8');

console.error(`渲染完成: ${outputPath}`);
console.error(`Subject: ${subject}`);
