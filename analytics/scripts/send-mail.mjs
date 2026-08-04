#!/usr/bin/env node
// scripts/send-mail.mjs · 发送报告邮件
// 用法: node send-mail.mjs --report <md-file> [--subject-file <txt-file>]
// 见 spec §8.2

import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { createTransport } from 'nodemailer';

const __dirname = dirname(fileURLToPath(import.meta.url));

// ─── 参数解析 ─────────────────────────────────────────────────────────────────

const args = process.argv.slice(2);
const opts = {};
for (let i = 0; i < args.length; i++) {
  if (args[i].startsWith('--') && args[i + 1] && !args[i + 1].startsWith('--')) {
    opts[args[i].slice(2)] = args[i + 1];
    i++;
  }
}

const reportPath  = opts['report'];
const subjectFile = opts['subject-file'];

if (!reportPath) {
  console.error('用法: send-mail.mjs --report <md-file> [--subject-file <txt-file>]');
  process.exit(1);
}

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
  MAIL_FROM, MAIL_TO, MAIL_CC,
} = env;

// 验证必需配置
if (!SMTP_HOST || !SMTP_USER || !SMTP_PASS || !MAIL_FROM || !MAIL_TO) {
  console.error('缺少 SMTP 配置，请检查 .env 中的 SMTP_HOST/SMTP_USER/SMTP_PASS/MAIL_FROM/MAIL_TO');
  process.exit(1);
}

// PLACEHOLDER 模式检查（理论上 analyze.sh 已经拦截，这里双保险）
if (MAIL_TO.startsWith('PLACEHOLDER')) {
  console.log('MAIL_TO 为 PLACEHOLDER，跳过发送（stdout 模式应在 analyze.sh 层处理）');
  process.exit(0);
}

// ─── 读取报告 ─────────────────────────────────────────────────────────────────

let mdContent;
try {
  mdContent = readFileSync(reportPath, 'utf8');
} catch (e) {
  console.error(`无法读取报告文件: ${reportPath}: ${e.message}`);
  process.exit(1);
}

// ─── 读取 subject ─────────────────────────────────────────────────────────────

let subject;
if (subjectFile) {
  try {
    subject = readFileSync(subjectFile, 'utf8').trim();
  } catch {
    subject = null;
  }
}

// 从 md 首行提取 subject（备用）
if (!subject) {
  const firstLine = mdContent.split('\n')[0].replace(/^#+\s*/, '').trim();
  subject = firstLine || 'Costra 分析报告';
}

// ─── 转换 Markdown → HTML ─────────────────────────────────────────────────────

const { marked } = await import('marked');

// 配置 marked（安全模式）
marked.setOptions({ gfm: true, breaks: false });

const htmlBody = marked.parse(mdContent);

const inlineStyle = `
<style>
  body { font-family: -apple-system, "PingFang SC", "Microsoft YaHei", sans-serif; font-size: 14px; color: #1c1b1a; line-height: 1.7; max-width: 860px; margin: 0 auto; padding: 20px; background: #f8f9fa; }
  h1 { font-size: 22px; color: #1a1a1a; border-bottom: 3px solid #4a9eff; padding-bottom: 10px; margin-bottom: 16px; }
  h2 { font-size: 17px; color: #2c2c2c; margin-top: 28px; margin-bottom: 12px; padding: 6px 10px; background: #f0f4ff; border-left: 4px solid #4a9eff; border-radius: 0 4px 4px 0; }
  h3 { font-size: 15px; color: #444; margin-top: 20px; margin-bottom: 8px; }
  table { border-collapse: collapse; margin: 12px 0; width: 100%; font-size: 13px; background: #fff; border-radius: 6px; overflow: hidden; box-shadow: 0 1px 3px rgba(0,0,0,0.08); }
  th { background: #f0f4ff; font-weight: 600; color: #333; padding: 8px 10px; text-align: left; border-bottom: 2px solid #e0e6f0; }
  td { border-bottom: 1px solid #eee; padding: 6px 10px; }
  tr:last-child td { border-bottom: none; }
  tr:hover td { background: #f8faff; }
  code, pre { background: #f5f5f5; font-family: "SF Mono", "JetBrains Mono", Consolas, monospace; font-size: 12px; }
  code { padding: 2px 5px; border-radius: 3px; }
  pre { padding: 14px 16px; border-radius: 6px; overflow-x: auto; line-height: 1.4; border: 1px solid #e8e8e8; }
  blockquote { border-left: 4px solid #4a9eff; margin: 12px 0; padding: 8px 16px; color: #444; background: #f0f8ff; border-radius: 0 4px 4px 0; }
  ul, ol { padding-left: 20px; }
  li { margin: 4px 0; }
  strong { color: #1a1a1a; }
  em { color: #666; font-style: italic; }
  hr { border: none; border-top: 1px solid #e8e8e8; margin: 20px 0; }
</style>
`;

const htmlFull = `<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${subject}</title>
  ${inlineStyle}
</head>
<body>
${htmlBody}
</body>
</html>`;

// ─── 发送邮件 ─────────────────────────────────────────────────────────────────

const port = parseInt(SMTP_PORT || '465', 10);

const transporter = createTransport({
  host: SMTP_HOST,
  port,
  secure: port === 465,   // 465 用 SSL，587 用 STARTTLS
  auth: {
    user: SMTP_USER,
    pass: SMTP_PASS,
  },
});

const mailOptions = {
  from: `"Costra 分析" <${MAIL_FROM}>`,
  to: MAIL_TO,
  subject,
  text: mdContent,        // 纯文本备用
  html: htmlFull,
};

if (MAIL_CC && MAIL_CC.trim()) {
  mailOptions.cc = MAIL_CC;
}

try {
  const info = await transporter.sendMail(mailOptions);
  console.log(`邮件发送成功: ${info.messageId}`);
} catch (e) {
  console.error(`邮件发送失败: ${e.message}`);
  process.exit(1);
}
