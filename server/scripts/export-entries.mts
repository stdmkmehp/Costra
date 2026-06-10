/**
 * Costra · 数据导出脚本
 *
 * 设计文档：docs/design/data-export-format.md
 *
 * 用法：
 *   cd server && npx tsx scripts/export-entries.mts \
 *     --user-id <uuid> --ledger-id <uuid> \
 *     --from 2026-01-01 --to 2026-06-10 \
 *     [--output ./exports/] \
 *     [--env-file /data/conf/server.env]
 *
 * 环境变量加载优先级：
 *   1. 已设置的 DATABASE_URL 环境变量（如在 Docker 容器内）
 *   2. --env-file 指定的文件（默认 /data/conf/server.env）
 */

import { Pool } from 'pg';
import { writeFileSync, mkdirSync, existsSync, readFileSync } from 'fs';
import { resolve, join } from 'path';

// ─── 环境加载 ─────────────────────────────────────────────────────────────────

function loadEnvFile(filePath: string): void {
  if (!existsSync(filePath)) return;
  const content = readFileSync(filePath, 'utf-8');
  for (const line of content.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eqIdx = trimmed.indexOf('=');
    if (eqIdx < 0) continue;
    const key = trimmed.slice(0, eqIdx).trim();
    const val = trimmed.slice(eqIdx + 1).trim().replace(/^["']|["']$/g, '');
    // 不覆盖已有环境变量
    if (!process.env[key]) {
      process.env[key] = val;
    }
  }
}

// ─── CLI 参数解析 ─────────────────────────────────────────────────────────────

const DEFAULT_ENV_FILE = '/data/conf/server.env';

interface Args {
  userId: string;
  ledgerId: string;
  from: string;
  to: string;
  output: string;
  envFile: string;
}

function parseArgs(): Args {
  const args = process.argv.slice(2);
  const map = new Map<string, string>();
  for (let i = 0; i < args.length; i += 2) {
    map.set(args[i], args[i + 1] ?? '');
  }

  const userId = map.get('--user-id');
  const ledgerId = map.get('--ledger-id');
  const from = map.get('--from');
  const to = map.get('--to');
  const output = map.get('--output') ?? './exports/';
  const envFile = map.get('--env-file') ?? DEFAULT_ENV_FILE;

  if (!userId || !ledgerId || !from || !to) {
    console.error('用法: npx tsx scripts/export-entries.mts --user-id <uuid> --ledger-id <uuid> --from YYYY-MM-DD --to YYYY-MM-DD [--output dir] [--env-file path]');
    process.exit(1);
  }

  // 校验日期格式
  const dateRe = /^\d{4}-\d{2}-\d{2}$/;
  if (!dateRe.test(from) || !dateRe.test(to)) {
    console.error('❌ --from / --to 必须为 YYYY-MM-DD 格式');
    process.exit(1);
  }

  // 校验 UUID 格式
  const uuidRe = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  if (!uuidRe.test(userId)) {
    console.error('❌ --user-id 格式非法，须为 UUID');
    process.exit(1);
  }
  if (!uuidRe.test(ledgerId)) {
    console.error('❌ --ledger-id 格式非法，须为 UUID');
    process.exit(1);
  }

  return { userId, ledgerId, from, to, output, envFile };
}

// ─── 类型映射 ──────────────────────────────────────────────────────────────────

const TYPE_MAP: Record<string, string> = {
  expense: '支出',
  income: '收入',
  transfer: '转移',
};

const SHARED_TYPE_MAP: Record<string, string> = {
  shared: '共同',
  personal: '个人',
};

// ─── CSV 工具 ──────────────────────────────────────────────────────────────────

function csvEscape(value: string): string {
  if (value.includes(',') || value.includes('"') || value.includes('\n') || value.includes('\r')) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
}

// ─── 主逻辑 ───────────────────────────────────────────────────────────────────

async function main() {
  const args = parseArgs();

  // 加载环境文件（不覆盖已有环境变量）
  loadEnvFile(args.envFile);

  if (!process.env.DATABASE_URL) {
    console.error(`❌ 未找到 DATABASE_URL，请设置环境变量或通过 --env-file 指定配置文件（当前: ${args.envFile}）`);
    process.exit(1);
  }

  // 宿主机执行时，Docker 服务名 "postgres" 不可达 → 替换为 127.0.0.1
  let dbUrl = process.env.DATABASE_URL;
  dbUrl = dbUrl.replace(/@postgres:/, '@127.0.0.1:');

  const pool = new Pool({ connectionString: dbUrl, max: 3 });

  try {
    // 1. 校验 user 存在
    const userRes = await pool.query(
      'SELECT id FROM users WHERE id = $1 AND deleted_at IS NULL',
      [args.userId],
    );
    if (userRes.rows.length === 0) {
      console.error(`❌ 用户不存在: ${args.userId}`);
      process.exit(1);
    }

    // 2. 校验 ledger 存在
    const ledgerRes = await pool.query(
      'SELECT id, family_id, name FROM ledgers WHERE id = $1 AND deleted_at IS NULL',
      [args.ledgerId],
    );
    if (ledgerRes.rows.length === 0) {
      console.error(`❌ 账本不存在: ${args.ledgerId}`);
      process.exit(1);
    }
    const ledger = ledgerRes.rows[0];

    // 3. 校验 user 是该 family 的活跃成员
    const memberRes = await pool.query(
      'SELECT user_id FROM family_members WHERE family_id = $1 AND user_id = $2 AND left_at IS NULL',
      [ledger.family_id, args.userId],
    );
    if (memberRes.rows.length === 0) {
      console.error(`❌ 用户 ${args.userId} 不是账本 ${args.ledgerId} 所属家庭的活跃成员`);
      process.exit(1);
    }

    // 4. 查询 entries（含分类信息 + 用户昵称）
    const entriesRes = await pool.query(
      `SELECT
         e.id,
         e.ledger_id,
         e.created_by,
         e.occurred_at,
         e.type,
         e.amount,
         e.currency,
         e.account_id,
         e.to_account_id,
         e.shared_type,
         e.note,
         cc.name AS category_name,
         cc.parent_id AS category_parent_id,
         pc.name AS parent_category_name,
         u.nickname
       FROM entries e
       LEFT JOIN categories cc ON cc.id = e.category_id
       LEFT JOIN categories pc ON pc.id = cc.parent_id
       LEFT JOIN users u ON u.id = e.created_by
       WHERE e.ledger_id = $1
         AND e.created_by = $2
         AND e.deleted_at IS NULL
         AND e.occurred_at >= $3::date
         AND e.occurred_at < ($4::date + interval '1 day')
       ORDER BY e.occurred_at ASC, e.id ASC`,
      [args.ledgerId, args.userId, args.from, args.to],
    );

    // 5. 构建 CSV
    const BOM = '\uFEFF';
    const HEADER = '记录ID,账本ID,记账人ID,日期,时间,类型,一级分类,二级分类,金额,币种,账户,转入账户,归属,记账人,备注';
    const lines: string[] = [HEADER];

    for (const row of entriesRes.rows) {
      const occurredAt = new Date(row.occurred_at);
      const date = occurredAt.toISOString().slice(0, 10);
      const time = occurredAt.toTimeString().slice(0, 5);
      const type = TYPE_MAP[row.type] ?? row.type;
      const amount = (Number(row.amount) / 100).toFixed(2);
      const sharedType = row.shared_type ? (SHARED_TYPE_MAP[row.shared_type] ?? '') : '';

      // 分类处理：
      // - 若 category 有 parent_id → 一级=parent_category_name, 二级=category_name
      // - 若 category 无 parent_id → 一级=category_name, 二级=category_name（自身就是一级）
      let parentCat: string;
      let childCat: string;
      if (row.category_parent_id) {
        parentCat = row.parent_category_name ?? '';
        childCat = row.category_name ?? '';
      } else {
        parentCat = row.category_name ?? '';
        childCat = row.category_name ?? '';
      }

      const fields = [
        row.id,
        row.ledger_id,
        row.created_by,
        date,
        time,
        type,
        parentCat,
        childCat,
        amount,
        row.currency ?? 'CNY',
        '', // 账户（预留）
        '', // 转入账户（预留）
        sharedType,
        row.nickname ?? '',
        row.note ?? '',
      ];

      lines.push(fields.map((f) => csvEscape(String(f))).join(','));
    }

    const csvContent = BOM + lines.join('\r\n') + '\r\n';

    // 6. 写入文件
    const outputDir = resolve(args.output);
    if (!existsSync(outputDir)) {
      mkdirSync(outputDir, { recursive: true });
    }

    const filename = `${ledger.name}_${args.from}_${args.to}.csv`;
    const filepath = join(outputDir, filename);
    writeFileSync(filepath, csvContent, 'utf-8');

    console.log(`✅ 导出完成`);
    console.log(`   记录数: ${entriesRes.rows.length} 条`);
    console.log(`   文件: ${filepath}`);
  } finally {
    await pool.end();
  }
}

main().catch((err) => {
  console.error('❌ 导出失败:', err.message);
  process.exit(1);
});
