/**
 * Costra · Server · CSV 导出工具（账本导出）
 *
 * 事实源：docs/design/data-import-export-client-analysis.md v1.0 §2.1 / §9.3
 *
 * 三层规则（缺一不可）：
 *   1. Formula Injection 防护 `apostrophe-v2`（可逆编码，作用于单元格语义层）：
 *      - 首字符是 `'`（无条件 —— 这条使编解码严格互逆）；
 *      - 首个**有效字符**是 `=` `+` `-` `@` 或其全角变体（`＝＋－＠`）
 *        （有效字符 = 跳过前导空格 / Unicode 空白 / 控制字符后的第一个字符）；
 *      - 首字符是 Tab(0x09) / CR(0x0D) / LF(0x0A)；
 *      ⇒ 满足任一条件，在最前面加一个 ASCII 单引号 `'`。
 *      解码（仅对 Costra 自产文件）：移除**恰好一层**前导单引号。
 *      ⚠️ 数据库内仍存原始业务文本，防护只发生在导出序列化那一刻。
 *   2. RFC 4180 序列化：双引号内嵌双写 + 每字段统一 quote-all（表头行同样 quote-all）。
 *   3. 行尾 CRLF + 文件首 UTF-8 BOM（Excel 正确识别中文）。
 */

/** 导出表头（9 列 · 顺序冻结 · 与 §2.1.1 表头指纹一致） */
export const CSV_HEADER: readonly string[] = [
  '日期',
  '时间',
  '类型',
  '金额',
  '一级分类',
  '二级分类',
  '归属',
  '记账人',
  '备注',
];

/** UTF-8 BOM（Excel 打开 CSV 时按 UTF-8 解码中文的关键） */
export const CSV_BOM = '\uFEFF';

/** 行尾：RFC 4180 CRLF */
export const CSV_CRLF = '\r\n';

/** 危险首字符（半角 + 全角变体 · §9.3 规则 2/4） */
const DANGEROUS_FIRST_CHARS: ReadonlySet<string> = new Set([
  '=',
  '+',
  '-',
  '@',
  '＝', // U+FF1D
  '＋', // U+FF0B
  '－', // U+FF0D
  '＠', // U+FF20
]);

/**
 * 首个"有效字符"：跳过前导空格 / Unicode 空白 / C0 控制字符后的第一个字符。
 * 防护规则 5：危险字符前只有空白/控制字符时同样视为危险（防边界注入）。
 */
function firstEffectiveChar(value: string): string | null {
  for (const ch of value) {
    if (ch === ' ' || ch <= ' ' || /\s/.test(ch)) continue;
    return ch;
  }
  return null;
}

/**
 * `apostrophe-v2` 编码：满足任一危险条件时在最前面加一个 ASCII `'`。
 * 空串原样返回（无首字符 ⇒ 不触发任何条件）。
 */
export function encodeFormulaGuardV2(value: string): string {
  if (value === '') return value;
  const first = value.charAt(0);
  // 规则 1：首字符是 '（无条件 · 使编解码互逆）
  if (first === "'") return `'${value}`;
  // 规则 3：首字符是 Tab / CR / LF
  if (first === '\t' || first === '\r' || first === '\n') return `'${value}`;
  // 规则 2/4/5：首个有效字符是危险字符（含全角变体）
  const effective = firstEffectiveChar(value);
  if (effective !== null && DANGEROUS_FIRST_CHARS.has(effective)) return `'${value}`;
  return value;
}

/**
 * `apostrophe-v2` 解码：移除恰好一层前导单引号。
 * 一期只用于单测往返断言；二期导入仅对 Costra 自产文件（表头指纹判定）调用。
 */
export function decodeFormulaGuardV2(value: string): string {
  return value.startsWith("'") ? value.slice(1) : value;
}

/**
 * RFC 4180 单元格序列化：内嵌双引号双写 + 统一 quote-all。
 * 输入应已过完 Formula 防护（encodeFormulaGuardV2）。
 */
export function escapeCsvField(value: string): string {
  return `"${value.replace(/"/g, '""')}"`;
}

/**
 * 一行 CSV（不含行尾 CRLF · 由写盘侧统一拼接）。
 * fields 是原始业务文本；本函数负责 Formula 防护 + quote-all 两步。
 */
export function formatCsvRow(fields: readonly string[]): string {
  return fields.map((f) => escapeCsvField(encodeFormulaGuardV2(f))).join(',');
}

/** 表头行（quote-all · 与数据行同一序列化路径） */
export function formatCsvHeaderRow(): string {
  return CSV_HEADER.map((h) => escapeCsvField(h)).join(',');
}

/**
 * 文件名组件防护：Windows/Excel 非法字符 `/ \ : * ? " < > |` 与 CR/LF 控制字符
 * 一律替换为 `_`（§9.3 文件名/header 注入防护）；清洗后为空则回退 `账本`。
 */
export function sanitizeFilenameComponent(name: string): string {
  const cleaned = name.replace(/[/\\:*?"<>|\r\n]/g, '_').trim();
  return cleaned === '' ? '账本' : cleaned;
}
