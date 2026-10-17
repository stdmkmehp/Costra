/**
 * Costra · 存量头像迁移 COS · 能力实现层（不是用户入口 · 只被 infra/scripts/migrate-avatars-to-cos.sh 调用）
 *
 * 事实源：docs/design/cos-offload-phase2-avatar.md v1.6 §8（迁移）/ §7.4（脚本两件套）
 *
 * 四个模式（候选集全部由 DB 谓词决定 · 绝不目录驱动 · §8.0.1）：
 *   upload  预搬：候选行本地文件 → COS putObject 全量覆盖（不写 DB · 可反复执行 · 跑崩重跑）
 *   switch  切指针：候选行 UPDATE users.avatar_url → COS URL（秒级 · 重跑幂等）
 *   verify  只读对账：域名白名单 + 对象存在性 + LastModified 不早于本地 mtime
 *   revert  回退：仅把"指针精确等于切换时写入串"的行改回本地 URL（§8.7 精确匹配语义）
 *
 * 候选集谓词（§8.0.1 · 部署后换过头像的行已是 COS 域名、天然出候选集）：
 *   avatar_url IS NOT NULL AND avatar_url LIKE '%/avatars/%'
 *   AND left(avatar_url, length($1)) <> $1     -- $1 = --cos-base（server.env 原值透传）
 *
 * 关键实现注记：
 *   - 本地目录来源（v1.6）：读同一 UPLOAD_DIR env、缺省 /var/costra/uploads（与历史
 *     upload.ts 默认一致 · 不得写死——配过非默认 UPLOAD_DIR 的机器写死会静默"全部缺源"）。
 *     UPLOAD_DIR 不在 AppEnv schema 内（历史上 upload.ts 也直读 process.env），
 *     本脚本属运维一次性工具，同源直读并在文件头注明。
 *   - mtimeMs 取整（v1.6）：fs.stat().mtimeMs 是浮点，switch 写 ?v= 与 revert 重建匹配串
 *     必须共用同一取整函数 fileVersionMs（Math.trunc），否则 revert"精确等于"静默漂移为 0 行。
 *   - 串行绝不并发（瓶颈是带宽不是 RTT · §8.2）；upload 每条处理后 sleep --sleep-ms（节流 §8.3）。
 *   - dry-run（§8.1）：读 DB / 读本地文件 / headObject 照跑，不 putObject、不 UPDATE。
 *   - 切指针 UPDATE 不 bump version（§8.4 SQL 原文如此 · §3.2 读出全链路为 JOIN 现读现发，
 *     缓存残留旧 URL 在观察期内仍可加载 · §5.4）。
 *
 * 运行环境：costra-server 容器内（docker exec · tsx 直跑），DB 走容器自身 getPool()，
 * COS 走 getCosClient('avatars')（桶/密钥/域名来自容器注入的 server.env）。
 */

import { readdir, readFile, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { getPool, closePool } from '../src/db/pool.js';
import {
  AVATAR_CACHE_CONTROL,
  getCosClient,
  type CosObjectStore,
} from '../src/services/cosClient.js';
import { detectExt, extToContentType } from '../src/utils/imageMagic.js';

// ─── argv ────────────────────────────────────────────────────────────────────

type Mode = 'upload' | 'switch' | 'verify' | 'revert';

interface Args {
  mode: Mode;
  cosBase: string;        // --cos-base · server.env COS_AVATAR_BASE 原值（候选集谓词 $1 · 新 URL 前缀）
  sleepMs: number;        // --sleep-ms · 默认 200（§8.3 决策 D6）
  limit: number | null;   // --limit · 本次最多处理 N 行（切指针灰度用）
  base: string | null;    // --base · revert 的本机 URL 前缀（显式传入不猜 · §8.7）
  dryRun: boolean;        // --dry-run · 只读预演
}

function parseArgs(argv: string[]): Args {
  let mode: Mode | null = null;
  let cosBase: string | null = null;
  let sleepMs = 200;
  let limit: number | null = null;
  let base: string | null = null;
  let dryRun = false;

  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const takeValue = (flag: string): string => {
      const v = argv[++i];
      if (v === undefined) throw new Error(`${flag} 需要一个值`);
      return v;
    };
    switch (a) {
      case '--mode': {
        const v = takeValue('--mode');
        if (v !== 'upload' && v !== 'switch' && v !== 'verify' && v !== 'revert') {
          throw new Error(`--mode 只接受 upload|switch|verify|revert · got: ${v}`);
        }
        mode = v;
        break;
      }
      case '--cos-base': cosBase = takeValue('--cos-base').replace(/\/+$/, ''); break;
      case '--sleep-ms': {
        const n = Number(takeValue('--sleep-ms'));
        if (!Number.isInteger(n) || n < 0) throw new Error('--sleep-ms 必须是非负整数');
        sleepMs = n;
        break;
      }
      case '--limit': {
        const n = Number(takeValue('--limit'));
        if (!Number.isInteger(n) || n < 1) throw new Error('--limit 必须是正整数');
        limit = n;
        break;
      }
      case '--base': base = takeValue('--base').replace(/\/+$/, ''); break;
      case '--dry-run': dryRun = true; break;
      default: throw new Error(`未知参数: ${a}`);
    }
  }

  if (!mode) throw new Error('缺少 --mode upload|switch|verify|revert');
  if (!cosBase) throw new Error('缺少 --cos-base（server.env COS_AVATAR_BASE 原值）');
  if (mode === 'revert' && !base) throw new Error('--revert 必须配 --base（本机 URL 前缀 · §8.7）');

  return { mode, cosBase, sleepMs, limit, base, dryRun };
}

// ─── 本地冻结存量（§8.2 v1.6 · 同源解析 UPLOAD_DIR） ─────────────────────────

function uploadsDir(): string {
  return process.env['UPLOAD_DIR'] ?? '/var/costra/uploads';
}

/** 目录索引：stem（uuid）→ 文件名（含后缀）· 一人一文件已核（§8 · 无多后缀并存） */
async function indexLocalAvatars(): Promise<Map<string, string>> {
  const dir = join(uploadsDir(), 'avatars');
  let names: string[];
  try {
    names = await readdir(dir);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return new Map();
    throw err;
  }
  const map = new Map<string, string>();
  for (const name of names) {
    const dot = name.lastIndexOf('.');
    if (dot <= 0) continue; // 无后缀文件不属于历史形态（历史写入恒为 <uuid>.<ext>）
    const stem = name.slice(0, dot);
    if (map.has(stem)) {
      // 已确认不存在（§8）；出现即数据异常，跳过并交由缺源/人工核查（绝不猜着顶替）
      map.delete(stem);
      continue;
    }
    map.set(stem, name);
  }
  return map;
}

/** mtimeMs 统一取整出口（switch 写 ?v= 与 revert 重建匹配串共用 · v1.6 注记） */
function fileVersionMs(mtimeMs: number): number {
  return Math.trunc(mtimeMs);
}

// ─── 候选集（§8.0.1 · DB 驱动） ─────────────────────────────────────────────

interface CandidateRow { id: string; avatar_url: string }

/** 指针仍指本地的行（upload / switch 共用 · 按 id 排序保证重跑顺序稳定） */
async function selectCandidates(cosBase: string, limit: number | null): Promise<CandidateRow[]> {
  const sql = `
    SELECT id, avatar_url
      FROM users
     WHERE avatar_url IS NOT NULL
       AND avatar_url LIKE '%/avatars/%'
       AND left(avatar_url, length($1)) <> $1
     ORDER BY id`;
  const res = await getPool().query(
    limit === null ? sql : `${sql} LIMIT $2`,
    limit === null ? [cosBase] : [cosBase, limit],
  );
  return res.rows as CandidateRow[];
}

// ─── upload · 预搬（§8.2 · 全量覆盖 · 不写 DB） ─────────────────────────────

async function runUpload(args: Args, store: CosObjectStore): Promise<number> {
  const localIndex = await indexLocalAvatars();
  const candidates = await selectCandidates(args.cosBase, args.limit);
  console.log(`候选集    : ${candidates.length} 行（§8.0.1 谓词 · avatar_url 仍指本地）`);

  let ok = 0;
  let totalBytes = 0;
  const missingLocal: string[] = [];
  const magicFailed: string[] = [];
  const failed: Array<{ id: string; err: unknown }> = [];
  const startedAt = Date.now();

  for (let i = 0; i < candidates.length; i++) {
    const { id } = candidates[i]!;
    const filename = localIndex.get(id);
    if (filename === undefined) {
      missingLocal.push(id); // 缺源即跳过（该行可能早已是 COS）· 绝不猜后缀顶替
      continue;
    }
    const path = join(uploadsDir(), 'avatars', filename);
    const buf = await readFile(path);
    const ext = detectExt(buf);
    if (ext === null) {
      magicFailed.push(id); // 本地文件损坏/非图片 ⇒ 不上传、不覆盖已有对象
      continue;
    }
    totalBytes += buf.length;

    if (!args.dryRun) {
      try {
        await store.putObject(`avatars/${id}`, buf, {
          contentType: extToContentType(ext),
          cacheControl: AVATAR_CACHE_CONTROL,
        });
        if (!(await store.headObject(`avatars/${id}`))) {
          throw new Error('headObject 复核失败：对象写入后不存在');
        }
      } catch (err) {
        failed.push({ id, err }); // 单条失败跳过该条、不中断整体，最终非零退出
        console.log(`  [${i + 1}/${candidates.length}] ${id}  FAILED  ${String(err)}`);
        continue;
      }
    }
    ok++;
    if (args.sleepMs > 0) await new Promise((r) => setTimeout(r, args.sleepMs));
  }

  const elapsedSec = ((Date.now() - startedAt) / 1000).toFixed(1);
  console.log('');
  console.log(`── upload 汇总（${args.dryRun ? 'DRY-RUN · 未写 COS' : '已执行'}）──`);
  console.log(`  候选集      : ${candidates.length}`);
  console.log(`  ${args.dryRun ? '将上传' : '成功上传'}  : ${ok}`);
  console.log(`  本地缺源    : ${missingLocal.length}${missingLocal.length > 0 ? '  ← 须逐条确认来源（§8.0.1）' : ''}`);
  for (const id of missingLocal) console.log(`    - ${id}`);
  console.log(`  魔数失败    : ${magicFailed.length}`);
  for (const id of magicFailed) console.log(`    - ${id}`);
  console.log(`  上传失败    : ${failed.length}`);
  console.log(`  总字节      : ${totalBytes}`);
  console.log(`  实际耗时    : ${elapsedSec}s`);
  if (args.dryRun && ok > 0) {
    // 估算：满速下限（出口 250KB/s）+ 节流间隔（§8.3 量级表）
    const fullSpeedSec = totalBytes / (250 * 1024);
    const throttledSec = fullSpeedSec + (ok * args.sleepMs) / 1000;
    console.log(`  预计耗时    : 满速 ~${fullSpeedSec.toFixed(0)}s · 节流 ${args.sleepMs}ms 后 ~${throttledSec.toFixed(0)}s（估算）`);
  }
  return failed.length > 0 ? 1 : 0;
}

// ─── switch · 切指针（§8.4 · 只改 DB · 重跑幂等） ───────────────────────────

async function runSwitch(args: Args, store: CosObjectStore): Promise<number> {
  const localIndex = await indexLocalAvatars();
  const candidates = await selectCandidates(args.cosBase, args.limit);
  console.log(`候选集    : ${candidates.length} 行（§8.0.1 谓词 + ${args.limit === null ? '全量' : `LIMIT ${args.limit}`}）`);

  let updated = 0;
  let missingLocal = 0;
  let missingObject = 0;
  let concurrentDrift = 0;
  const failed: Array<{ id: string; err: unknown }> = [];

  for (const { id } of candidates) {
    const filename = localIndex.get(id);
    if (filename === undefined) {
      missingLocal++; // ?v= 取本地文件 mtime · 缺源无法构造 URL ⇒ 跳过（§8.4 跳过清单）
      continue;
    }
    const mtimeMs = fileVersionMs((await stat(join(uploadsDir(), 'avatars', filename))).mtimeMs);
    const newUrl = `${args.cosBase}/avatars/${id}?v=${mtimeMs}`;

    // 每条 UPDATE 前先 headObject：对象缺失说明预搬漏了该行 ⇒ 跳过而非写入 404 URL（§8.4）
    let exists: boolean;
    try {
      exists = await store.headObject(`avatars/${id}`);
    } catch (err) {
      failed.push({ id, err });
      continue;
    }
    if (!exists) {
      missingObject++;
      continue;
    }

    console.log(`  ${id}  →  ${newUrl}`);
    if (args.dryRun) {
      updated++;
      continue;
    }
    try {
      // WHERE 三限定是幂等与安全核心（§8.4）：已被切走/并发改写的行命中 0 行
      const res = await getPool().query(
        `UPDATE users
            SET avatar_url = $2
          WHERE id = $1
            AND avatar_url IS NOT NULL
            AND avatar_url LIKE '%/avatars/%'
            AND left(avatar_url, length($3)) <> $3`,
        [id, newUrl, args.cosBase],
      );
      if (res.rowCount === 1) {
        updated++;
      } else {
        concurrentDrift++; // 并发换头像 ⇒ 该行已是 COS URL · 保持不动（设计内语义）
      }
    } catch (err) {
      failed.push({ id, err });
    }
  }

  console.log('');
  console.log(`── switch 汇总（${args.dryRun ? 'DRY-RUN · 未改 DB' : '已执行'}）──`);
  console.log(`  候选集        : ${candidates.length}`);
  console.log(`  ${args.dryRun ? '将更新' : '已更新'}      : ${updated}`);
  console.log(`  跳过·本地缺源 : ${missingLocal}`);
  console.log(`  跳过·COS无对象: ${missingObject}`);
  console.log(`  跳过·并发漂移 : ${concurrentDrift}`);
  console.log(`  失败          : ${failed.length}`);
  for (const f of failed) console.log(`    - ${f.id}: ${String(f.err)}`);
  return failed.length > 0 ? 1 : 0;
}

// ─── verify · 只读对账（§8.5 · 不写任何东西） ────────────────────────────────

/** 两个已知头像 COS 域名（§6.1 平台事实 · staging 库恢复后合法持有 prod 域名行 · v1.5） */
const KNOWN_AVATAR_BASES = ['https://img.costra.cloud', 'https://img.stg.costra.cloud'] as const;

async function headLastModifiedSec(url: string): Promise<number | null> {
  // 公有读桶 ⇒ 直接 HEAD 公开 URL（顺带验客户端真实访问路径 · 不占用 SDK 接口面）
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 5000);
  try {
    const res = await fetch(url, { method: 'HEAD', signal: ctrl.signal });
    if (!res.ok) return null;
    const lastModified = res.headers.get('last-modified');
    if (!lastModified) return null;
    // COS LastModified 秒级精度（HTTP-date）⇒ 截断到秒再比（v1.5 注记 · 否则批量误报）
    return Math.floor(Date.parse(lastModified) / 1000);
  } finally {
    clearTimeout(timer);
  }
}

async function runVerify(args: Args, store: CosObjectStore): Promise<number> {
  const res = await getPool().query(
    `SELECT id, avatar_url FROM users
      WHERE avatar_url IS NOT NULL AND avatar_url LIKE '%/avatars/%'
      ORDER BY id`,
  );
  const rows = res.rows as CandidateRow[];
  const localIndex = await indexLocalAvatars();
  console.log(`对账行数  : ${rows.length}（全部含 /avatars/ 的非 NULL 行）`);
  console.log(`本机 base : ${args.cosBase}（指向另一环境域名的行只做① · §8.5）`);

  let okCount = 0;
  let crossEnv = 0;
  const violations: string[] = [];

  for (const { id, avatar_url } of rows) {
    // ① 域名前缀 ∈ {prod, staging} 两已知 COS_AVATAR_BASE（合法终态白名单）
    const matchedBase = KNOWN_AVATAR_BASES.find((b) => avatar_url.startsWith(`${b}/`));
    if (matchedBase === undefined) {
      violations.push(`${id}  ①域名非法: ${avatar_url}`);
      continue;
    }
    if (matchedBase !== args.cosBase) {
      crossEnv++; // 指向另一环境桶（staging 恢复 prod 库的正常形态）· 跳过②③
      continue;
    }

    // ② 对象存在性（SDK headObject · CAM 权限内）
    let exists: boolean;
    try {
      exists = await store.headObject(`avatars/${id}`);
    } catch (err) {
      violations.push(`${id}  ②headObject 抛错: ${String(err)}`);
      continue;
    }
    if (!exists) {
      violations.push(`${id}  ②对象缺失: ${avatar_url}`);
      continue;
    }

    // ③ LastModified 不早于本地文件 mtime（发现"新图被旧图覆盖" · §13）
    //   本地无源文件的行（部署后新上传）从未经本地迁移 ⇒ ③ 不适用，跳过
    const filename = localIndex.get(id);
    if (filename !== undefined) {
      const localSec = Math.trunc(
        fileVersionMs((await stat(join(uploadsDir(), 'avatars', filename))).mtimeMs) / 1000,
      );
      const cosSec = await headLastModifiedSec(`${matchedBase}/avatars/${id}`);
      if (cosSec === null) {
        violations.push(`${id}  ③公开 HEAD 失败（对象存在但公开路径不可达或无 Last-Modified）`);
        continue;
      }
      if (cosSec < localSec) {
        violations.push(
          `${id}  ③COS LastModified(${new Date(cosSec * 1000).toISOString()}) 早于本地 mtime(${new Date(localSec * 1000).toISOString()}) ⇒ 疑似新图被旧图覆盖`,
        );
        continue;
      }
    }
    okCount++;
  }

  console.log('');
  console.log('── verify 汇总（只读 · 未写任何东西）──');
  console.log(`  通过          : ${okCount}`);
  console.log(`  跨环境行(①仅) : ${crossEnv}`);
  console.log(`  违例          : ${violations.length}`);
  for (const v of violations) console.log(`    - ${v}`);
  return violations.length > 0 ? 1 : 0;
}

// ─── revert · 回退（§8.7 · 精确匹配"切换时写入的 URL"） ──────────────────────

async function runRevert(args: Args): Promise<number> {
  const localIndex = await indexLocalAvatars();
  // 指针指本机 COS 桶的行（revert 候选 · 与候选集谓词反向）
  const res = await getPool().query(
    `SELECT id, avatar_url FROM users
      WHERE avatar_url IS NOT NULL
        AND left(avatar_url, length($1)) = $1
      ORDER BY id`,
    [args.cosBase],
  );
  const rows = res.rows as CandidateRow[];
  console.log(`候选集    : ${rows.length} 行（avatar_url 指本机 COS 桶）`);
  console.log(`回退目标  : ${args.base}/uploads/avatars/<uuid>.<ext>?v=<mtimeMs>`);

  let reverted = 0;
  let keptNewUpload = 0;
  let missingLocal = 0;
  const failed: Array<{ id: string; err: unknown }> = [];

  for (const { id, avatar_url } of rows) {
    const filename = localIndex.get(id);
    if (filename === undefined) {
      missingLocal++; // 无法重建匹配串 ⇒ 跳过（保持 COS URL · 可正常显示）
      continue;
    }
    const mtimeMs = fileVersionMs(
      (await stat(join(uploadsDir(), 'avatars', filename))).mtimeMs,
    );
    // 重建"切换时写入的 COS URL"· 精确等于才回退（§8.7：观察期内换过头像的行天然排除）
    const switchedUrl = `${args.cosBase}/avatars/${id}?v=${mtimeMs}`;
    if (avatar_url !== switchedUrl) {
      keptNewUpload++;
      continue;
    }
    const ext = filename.slice(filename.lastIndexOf('.') + 1); // 后缀从本地文件名取（一人一文件无歧义）
    const revertUrl = `${args.base}/uploads/avatars/${id}.${ext}?v=${mtimeMs}`;

    console.log(`  ${id}  →  ${revertUrl}`);
    if (args.dryRun) {
      reverted++;
      continue;
    }
    try {
      const upd = await getPool().query(
        // 双保险：WHERE 同时带上精确旧值，并发改写命中 0 行
        `UPDATE users SET avatar_url = $2 WHERE id = $1 AND avatar_url = $3`,
        [id, revertUrl, switchedUrl],
      );
      if (upd.rowCount === 1) reverted++;
      else keptNewUpload++;
    } catch (err) {
      failed.push({ id, err });
    }
  }

  console.log('');
  console.log(`── revert 汇总（${args.dryRun ? 'DRY-RUN · 未改 DB' : '已执行'}）──`);
  console.log(`  候选集          : ${rows.length}`);
  console.log(`  ${args.dryRun ? '将回退' : '已回退'}        : ${reverted}`);
  console.log(`  保持COS(新上传) : ${keptNewUpload}  ← 设计内语义（§8.7 已知边界）`);
  console.log(`  跳过·本地缺源   : ${missingLocal}`);
  console.log(`  失败            : ${failed.length}`);
  for (const f of failed) console.log(`    - ${f.id}: ${String(f.err)}`);
  return failed.length > 0 ? 1 : 0;
}

// ─── main ────────────────────────────────────────────────────────────────────

async function main(): Promise<number> {
  const args = parseArgs(process.argv.slice(2));
  console.log(`[migrate-avatars-to-cos] mode=${args.mode} cosBase=${args.cosBase} ` +
    `sleepMs=${args.sleepMs} limit=${args.limit ?? '-'} dryRun=${args.dryRun}`);
  console.log(`本地目录  : ${join(uploadsDir(), 'avatars')}（容器视角 · UPLOAD_DIR 同源解析）`);
  console.log('');

  const store = getCosClient('avatars');
  switch (args.mode) {
    case 'upload': return await runUpload(args, store);
    case 'switch': return await runSwitch(args, store);
    case 'verify': return await runVerify(args, store);
    case 'revert': return await runRevert(args);
  }
}

main()
  .then((code) => { process.exitCode = code; })
  .catch((err) => {
    console.error('[migrate-avatars-to-cos] 未捕获异常：', err);
    process.exitCode = 1;
  })
  .finally(() => closePool());
