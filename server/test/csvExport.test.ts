/**
 * Costra · Server · CSV 导出工具 + 迁移/错误码静态契约单测
 *
 * 事实源：docs/design/data-import-export-client-analysis.md v1.0 §2.1/§9.3/§9.5
 *
 * 覆盖：
 *   G1  `apostrophe-v2` 冻结 6 行往返断言（§9.3 单测要求：缺一不可）
 *   G2  三个边界：空串 / 纯空白 / 仅一个 `'`
 *   G3  危险首字符矩阵（半角/全角 =+-@ · 前导空白跳过 · Tab/CR/LF 原始首字符）
 *   G4  RFC 4180 quote-all 序列化（内嵌双引号双写 · 防护在序列化之前）
 *   G5  表头行（9 列固定 · quote-all）
 *   G6  文件名组件防护（非法字符 → _ · 空回退 账本 · CR/LF 剥除）
 *   M1  migration 0021 静态断言（pg-mem 无 CHECK 载体 ⇒ 生产 SQL 是唯一事实源）：
 *       chk 四分支 / 部分唯一索引 / 谓词无 now()（PG 拒绝非 IMMUTABLE）/ sync_hold 增列
 *   E1  ErrorCode 四处同步（TS 枚举 ↔ openapi.yaml ↔ error-codes.md ↔ 客户端 KNOWN_SERVER_CODES）
 */

import { readFileSync } from 'node:fs';
import { describe, it, expect } from 'vitest';
import {
  CSV_BOM,
  CSV_CRLF,
  CSV_HEADER,
  decodeFormulaGuardV2,
  encodeFormulaGuardV2,
  escapeCsvField,
  formatCsvHeaderRow,
  formatCsvRow,
  sanitizeFilenameComponent,
} from '../src/utils/csv.js';
import { ErrorCode, ErrorHttpStatus } from '../src/errors/ErrorCode.js';

// ─── G1 · apostrophe-v2 冻结往返表（§9.3 可逆性验证 · 编码 → 解码必须回到原值） ───

const ROUNDTRIP_CASES: ReadonlyArray<readonly [original: string, encoded: string]> = [
  ['=SUM(A1:A2)', "'=SUM(A1:A2)"],
  ["'=SUM(A1:A2)", "''=SUM(A1:A2)"],
  ["'备注", "''备注"],
  ["''两个引号", "'''两个引号"],
  ['  =1+1', "'  =1+1"],
  ['普通备注', '普通备注'],
];

describe('G1 · apostrophe-v2 冻结 6 行往返', () => {
  it.each(ROUNDTRIP_CASES)('encode(%j) === %j', (original, encoded) => {
    expect(encodeFormulaGuardV2(original)).toBe(encoded);
  });

  it.each(ROUNDTRIP_CASES)('decode(%j) === %j', (original, encoded) => {
    expect(decodeFormulaGuardV2(encoded)).toBe(original);
  });

  it.each(ROUNDTRIP_CASES)('decode(encode(%j)) === %j（往返闭环）', (original) => {
    expect(decodeFormulaGuardV2(encodeFormulaGuardV2(original))).toBe(original);
  });
});

describe('G2 · 边界三态', () => {
  it('空串：不加防护，往返为空串', () => {
    expect(encodeFormulaGuardV2('')).toBe('');
    expect(decodeFormulaGuardV2(encodeFormulaGuardV2(''))).toBe('');
  });

  it('纯空白：无有效危险字符，原样保留', () => {
    expect(encodeFormulaGuardV2('   ')).toBe('   ');
    expect(decodeFormulaGuardV2(encodeFormulaGuardV2('   '))).toBe('   ');
  });

  it("仅一个 '：加一层 ⇒ ''，解码剥一层回到 '", () => {
    expect(encodeFormulaGuardV2("'")).toBe("''");
    expect(decodeFormulaGuardV2(encodeFormulaGuardV2("'"))).toBe("'");
  });
});

describe('G3 · 危险首字符矩阵', () => {
  it.each(['=', '+', '-', '@'])('半角 %s 开头 ⇒ 加防护', (ch) => {
    expect(encodeFormulaGuardV2(`${ch}100`)).toBe(`'${ch}100`);
  });

  it.each(['＝', '＋', '－', '＠'])('全角 %s 开头 ⇒ 加防护', (ch) => {
    expect(encodeFormulaGuardV2(`${ch}100`)).toBe(`'${ch}100`);
  });

  it('危险字符前只有空格/控制字符 ⇒ 同样加防护（防边界注入）', () => {
    expect(encodeFormulaGuardV2(' -1')).toBe("' -1");
    expect(encodeFormulaGuardV2('  =1+1')).toBe("'  =1+1");
  });

  it.each(['\t', '\r', '\n'])('原始首字符 %j ⇒ 加防护', (ch) => {
    expect(encodeFormulaGuardV2(`${ch}abc`)).toBe(`'${ch}abc`);
  });

  it('普通文本（含行内危险字符但非首字符）⇒ 不防护', () => {
    expect(encodeFormulaGuardV2('a=b')).toBe('a=b');
    expect(encodeFormulaGuardV2(`It's a "test", ok?`)).toBe(`It's a "test", ok?`);
  });
});

describe('G4 · RFC 4180 quote-all 序列化', () => {
  it('内嵌双引号双写 + 全字段 quote-all', () => {
    expect(formatCsvRow(['a', 'b"c', 'd,e', 'x\ny'])).toBe('"a","b""c","d,e","x\ny"');
  });

  it('Formula 防护发生在序列化之前（防护引号不被当内容转义）', () => {
    expect(formatCsvRow(['=1+1'])).toBe(`"'=1+1"`);
    expect(formatCsvRow(["'备注"])).toBe(`"''备注"`);
  });

  it('escapeCsvField 单独出口同样 quote-all', () => {
    expect(escapeCsvField('普通')).toBe('"普通"');
  });

  it('常量：BOM 为 U+FEFF · CRLF 为 \\r\\n', () => {
    expect(CSV_BOM).toBe('\uFEFF');
    expect(CSV_BOM.charCodeAt(0)).toBe(0xfeff);
    expect(CSV_CRLF).toBe('\r\n');
  });
});

describe('G5 · 表头行', () => {
  it('9 列固定顺序 + quote-all（与数据行同一序列化路径）', () => {
    expect(CSV_HEADER).toEqual([
      '日期',
      '时间',
      '类型',
      '金额',
      '一级分类',
      '二级分类',
      '归属',
      '记账人',
      '备注',
    ]);
    expect(formatCsvHeaderRow()).toBe(
      '"日期","时间","类型","金额","一级分类","二级分类","归属","记账人","备注"',
    );
  });
});

describe('G6 · 文件名组件防护', () => {
  it('非法字符 / \\ : * ? " < > | 一律替换为 _', () => {
    expect(sanitizeFilenameComponent('a/b\\c:d*e?f"g<h>i|j')).toBe('a_b_c_d_e_f_g_h_i_j');
  });

  it('CR/LF 控制字符剥除（header 注入防护）', () => {
    expect(sanitizeFilenameComponent('ab\r\ncd')).toBe('ab__cd');
  });

  it('清洗后为空（含原空串）⇒ 回退 账本', () => {
    expect(sanitizeFilenameComponent('')).toBe('账本');
  });

  it('正常账本名原样保留（trim 两端空白）', () => {
    expect(sanitizeFilenameComponent('  家庭账本  ')).toBe('家庭账本');
  });
});

// ─── M1 · migration 0021 静态断言（pg-mem 无 CHECK 载体 ⇒ 只能断言生产 SQL） ───

describe('M1 · migration 0021 生产 SQL 静态断言', () => {
  // vitest 从 server/ 目录运行（tsconfig module=CommonJS · 不可用 import.meta）
  const sql = readFileSync(`${process.cwd()}/db/migrations/0021_data_jobs.sql`, 'utf8');

  it('chk_data_jobs_type_fields 分支齐全（导出区间「同空或同有」· 禁半空）', () => {
    expect(sql).toContain('chk_data_jobs_type_fields');
    expect(sql).toContain("type = 'import' AND detect_id IS NOT NULL AND source_hash IS NOT NULL");
    expect(sql).toContain("type = 'export' AND detect_id IS NULL AND source_hash IS NULL");
    expect(sql).toContain('export_from IS NULL AND export_to IS NULL');
    // 导出区间：双 NULL（全部）或双非空（区间）· 禁止半空
    expect(sql).toContain('(export_from IS NULL AND export_to IS NULL)');
    expect(sql).toContain('OR (export_from IS NOT NULL AND export_to IS NOT NULL)');
  });

  it('chk_data_jobs_date_range 防倒挂（改名 export_from/to 后补回 · §7.3）', () => {
    expect(sql).toContain('chk_data_jobs_date_range');
    expect(sql).toContain('export_from <= export_to');
  });

  it('并发闸口部分唯一索引 + run_token 部分索引存在', () => {
    expect(sql).toContain('uq_data_jobs_active_export_per_user');
    expect(sql).toContain('uq_data_jobs_active_import_per_family');
    expect(sql).toContain('uq_data_jobs_run_token');
    expect(sql).toContain('idx_data_jobs_due');
    expect(sql).toContain('idx_data_jobs_owner_created');
  });

  it('detect_id 唯一性由列级 UNIQUE 承担（不建恒被覆盖的部分索引 · v1.3）', () => {
    expect(sql).toContain('detect_id       UUID UNIQUE REFERENCES import_detect_sessions(id)');
    expect(sql).not.toContain('CREATE UNIQUE INDEX IF NOT EXISTS uq_data_jobs_detect');
  });

  it('部分索引谓词不得含 now()（PG 拒绝非 IMMUTABLE 谓词 · 实现期修正回归）', () => {
    for (const name of [
      'uq_data_jobs_active_export_per_user',
      'uq_data_jobs_active_import_per_family',
    ]) {
      const start = sql.indexOf(name);
      const stmt = sql.slice(start, sql.indexOf(';', start));
      expect(stmt, `${name} 谓词含 now()`).not.toContain('now()');
    }
  });

  it('ledgers sync_hold 增列 + import_detect_sessions 建表（二期载体一次建齐）', () => {
    expect(sql).toContain('sync_hold_seq');
    expect(sql).toContain('sync_hold_until');
    expect(sql).toContain('CREATE TABLE IF NOT EXISTS import_detect_sessions');
    expect(sql).toContain('ON DELETE CASCADE');
  });
});

// ─── M2 · 生产游标静态断言（pg-mem 无法覆盖的分支） ───

describe('M2 · 生产微秒游标静态断言', () => {
  const src = readFileSync(`${process.cwd()}/src/services/entryExport.ts`, 'utf8');

  it('生产分支用 to_char(...US...) 原文回传（禁用 JS Date 毫秒截断往返）', () => {
    expect(src).toContain(`to_char(e.occurred_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')`);
  });

  it('游标谓词为 (occurred_at, id) 双段（> 或 = 且 id >）', () => {
    expect(src).toContain('e.occurred_at > $4::timestamptz');
    expect(src).toContain('(e.occurred_at = $4::timestamptz AND e.id > $5::uuid)');
  });

  it('日期上界为半开区间排他端（< $3 · 禁 <= endOf(day) 毫秒截断漏行）', () => {
    expect(src).toContain('e.occurred_at < $3::timestamptz');
    expect(src).not.toContain('e.occurred_at <= $3::timestamptz');
  });
});

// ─── E1 · ErrorCode 四处同步（新增 code 的契约纪律） ───

describe('E1 · ErrorCode 四处同步', () => {
  const tsCodes = Object.values(ErrorCode) as string[];

  it('EXPORT_JOB_IN_PROGRESS=409 · EXPORT_FILE_EXPIRED=410', () => {
    expect(ErrorHttpStatus[ErrorCode.EXPORT_JOB_IN_PROGRESS]).toBe(409);
    expect(ErrorHttpStatus[ErrorCode.EXPORT_FILE_EXPIRED]).toBe(410);
  });

  it('openapi.yaml ErrorCode 枚举与 TS 枚举一一对应', () => {
    const openapi = readFileSync(`${process.cwd()}/api/openapi.yaml`, 'utf8');
    const enumBlock = openapi.slice(
      openapi.indexOf('    ErrorCode:'),
      openapi.indexOf('    Error:'),
    );
    for (const code of tsCodes) {
      expect(enumBlock, `openapi 缺 ${code}`).toContain(`- ${code}`);
    }
    const listed = [...enumBlock.matchAll(/^\s+- ([A-Z_]+)$/gm)].map((m) => m[1]);
    expect(listed.length).toBe(tsCodes.length);
  });

  it('docs/api/error-codes.md 登记全部 code', () => {
    const doc = readFileSync(`${process.cwd()}/../docs/api/error-codes.md`, 'utf8');
    for (const code of tsCodes) {
      expect(doc, `error-codes.md 缺 ${code}`).toContain(`\`${code}\``);
    }
  });

  it('客户端 request.ts KNOWN_SERVER_CODES 登记全部 code', () => {
    const reqSrc = readFileSync(`${process.cwd()}/../miniprogram/services/request.ts`, 'utf8');
    for (const code of tsCodes) {
      expect(reqSrc, `KNOWN_SERVER_CODES 缺 ${code}`).toContain(`'${code}'`);
    }
  });
});
