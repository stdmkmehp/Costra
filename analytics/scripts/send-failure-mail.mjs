#!/usr/bin/env node
// scripts/send-failure-mail.mjs · 失败告警邮件
// 用法:
//   node send-failure-mail.mjs --exit-code <n> --line <n> [--log-file <f>] [--database <db>] [--dump <f>]
//   node send-failure-mail.mjs --reason no-dump --inbox <dir> [--inbox-list <text>]
// 见 spec §8.4

import { readFileSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { createTransport } from 'nodemailer';

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

const reason    = opts['reason'];       // 'no-dump' 或 undefined（ERR 触发）
const exitCode  = opts['exit-code'];
const lineNo    = opts['line'];
const logFile   = opts['log-file'];
const database  = opts['database'];
const dumpFile  = opts['dump'];
const inbox     = opts['inbox'];
const inboxList = opts['inbox-list'];

// ─── 加载 .env ────────────────────────────────────────────────────────────────

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
      if (!val.includes('"') && !val.includes("'")) {
        val = val.split('#')[0].trim();
      }
      val = val.replace(/^['"]|['"]$/g, '');
      if (/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) env[key] = val;
    }
    return env;
  } catch {
    return {};
  }
}

const projectRoot = join(__dirname, '..');
const env = { ...process.env, ...loadEnv(join(projectRoot, '.env')) };

const {
  SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS,
  MAIL_FROM, MAIL_TO, MAIL_CC, DUMP_INBOX,
} = env;

// 如果 SMTP 未配置，静默退出（不能发邮件也不能报错）
if (!SMTP_HOST || !SMTP_USER || !SMTP_PASS || !MAIL_FROM || !MAIL_TO) {
  console.error('SMTP 未配置，跳过失败告警邮件');
  process.exit(0);
}

// PLACEHOLDER 模式：打印到 stderr 即可
if (MAIL_TO.startsWith('PLACEHOLDER')) {
  if (reason === 'no-dump') {
    console.error(`[告警] 无可用 dump · inbox: ${inbox || DUMP_INBOX}`);
    console.error(`inbox 文件列表:\n${inboxList || '(空)'}`);
  } else {
    console.error(`[告警] 分析失败 · exit_code=${exitCode} · line=${lineNo}`);
  }
  process.exit(0);
}

// ─── 构建邮件内容 ─────────────────────────────────────────────────────────────

let subject, bodyText;
const now = new Date().toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' });

if (reason === 'no-dump') {
  // 无 dump 告警（不是错误，是 standby 备份链路可能挂了）
  subject = `⚠️ Costra 日报未生成 · 无可用 dump（${now}）`;
  bodyText = `Costra 分析任务在 ${now} 运行时，未找到可用的 dump 文件。

这通常意味着 standby 从库的备份链路（复制健康门禁 / 备份 cron）可能中断。

DUMP_INBOX: ${inbox || DUMP_INBOX || '(未知)'}

最近 3 天的 dump 文件:
${inboxList || '(空)'}

请检查:
1. 机器② 的 /etc/cron.d/costra-standby 备份 cron 是否正常运行（/data/logs/standby-backup.log）
2. check-replication.sh 复制健康门禁是否通过（复制不健康会阻断备份产出）
3. analyze host 磁盘空间是否充足

此告警不影响其他服务，下次有 dump 时将自动恢复。`;
} else {
  // 脚本执行失败
  subject = `⚠️ Costra 分析失败 · exit_code=${exitCode}@line${lineNo}（${now}）`;

  // 读取日志尾部（不含 secret）
  let logTail = '(无日志文件)';
  if (logFile && logFile !== '/dev/null' && existsSync(logFile)) {
    try {
      const logContent = readFileSync(logFile, 'utf8');
      const lines = logContent.split('\n');
      logTail = lines.slice(-50).join('\n');
    } catch {
      logTail = '(读取日志失败)';
    }
  }

  // 关键环境变量（不含 secret）
  const safeEnv = [
    `DUMP_INBOX=${env.DUMP_INBOX || '(未设置)'}`,
    `PG_CONTAINER=${env.PG_CONTAINER || '(未设置)'}`,
    `PG_DB=${env.PG_DB || '(未设置)'}`,
    `DUMP_FILE=${dumpFile || '(未知)'}`,
    `REPORT_DB=${database || '(未知)'}`,
  ].join('\n');

  bodyText = `Costra 分析任务在 ${now} 失败。

退出码: ${exitCode}
失败行: ${lineNo}
dump 文件: ${dumpFile || '(未知)'}
临时数据库: ${database || '(未知)'}

─── 关键环境变量（不含 secret）───
${safeEnv}

─── 日志尾部（最近 50 行）───
${logTail}

请检查日志并手动排查。修复后可使用以下命令重新运行:
  cd <costra-analyze 部署目录>
  ./scripts/analyze.sh --stdout`;
}

// ─── 发送邮件 ─────────────────────────────────────────────────────────────────

const port = parseInt(SMTP_PORT || '465', 10);

const transporter = createTransport({
  host: SMTP_HOST,
  port,
  secure: port === 465,
  auth: { user: SMTP_USER, pass: SMTP_PASS },
});

const mailOptions = {
  from: `"Costra 分析" <${MAIL_FROM}>`,
  to: MAIL_TO,
  subject,
  text: bodyText,
};

if (MAIL_CC && MAIL_CC.trim()) {
  mailOptions.cc = MAIL_CC;
}

try {
  const info = await transporter.sendMail(mailOptions);
  console.error(`失败告警邮件已发送: ${info.messageId}`);
} catch (e) {
  // 发告警邮件本身失败了——只能打印到 stderr，不能再递归告警
  console.error(`失败告警邮件发送失败: ${e.message}`);
  // 不 exit 1，避免触发更多 trap
}
