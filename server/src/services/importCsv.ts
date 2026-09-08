/**
 * Costra · Server · 导入 CSV 解析 / 校验层（E1 核心 · 纯函数）
 *
 * 事实源：docs/design/data-import-export-client-analysis.md v1.0 §2.1 / §3 / §9.1
 *
 * 职责与边界：
 *   - 纯函数层：不碰 fs / db / redis；活跃成员与分类由调用方预加载注入（§7.4 步骤 3）。
 *   - 输入是完整 CSV 文本（上传缓冲 ≤1MB，已由路由层收流并做过编码/大小校验）。
 *   - 输出：规范化行（含 §3.9 预生成 entry_id / client_ref_id）+ 分级问题清单（ERROR/WARNING）
 *     + 自产文件未匹配成员聚合（§3.3 规则 4a 的映射交互出口）。
 *
 * 关键语义（与方案逐条对齐）：
 *   - 表头指纹：trim + 小写归一后集合恰等于 9 个标准列名 ⇒ is_costra_export（§2.1.1）；
 *     仅自产文件对 分类名/记账人/备注 做 `apostrophe-v2` 解码（§9.3 导入解码）。
 *   - 必填四列缺失 / 重复列 / 禁止列（记录ID/id/entry_id）/ 超 5,000 数据行 ⇒ 文件级拒绝（§3.1/§3.2.1/§9.1）。
 *   - 行级 ERROR：日期/时间/类型/金额/一级分类 为空或无法解析、一级分类未命中（含跨 type 专用文案）、
 *     记账人同名多成员、自产文件记账人未匹配（§3.3）；行级 WARNING：金额取绝对值 / 精度截断、
 *     二级分类降级默认子分类、非支出填归属、外部 CSV 记账人归操作者、备注超 200 按 code point 截断、
 *     归属缺省/个人家庭强制的汇总级提示（§3.5-§3.8/§3.11）。
 *   - 行号口径：row = 逻辑记录序号（表头=0，首条数据=1，§4.2）；physicalLine = 起始物理行号（报告 CSV 用）。
 *   - 时区：CSV 墙钟一律按 Asia/Shanghai 构造 occurred_at；自带偏移的 datetime 按其偏移取 instant（§3.6）。
 */

import { DateTime } from 'luxon';
import { parse } from 'csv-parse/sync';
import { newId } from '../id/idGen.js';
import { decodeFormulaGuardV2 } from '../utils/csv.js';
import type { CategoryEntity } from '../repositories/categoryRepo.js';

// ─────────────────────────────────────────────────────────────────────────────
// 常量（方案冻结值）
// ─────────────────────────────────────────────────────────────────────────────

/** 单次导入数据行上限（不含表头 · §9.1/§9.2 对称口径） */
export const MAX_IMPORT_ROWS = 5000;
/** value_preview 截断长度（code point · §4.2） */
export const VALUE_PREVIEW_MAX = 120;
/** DetectReport errors/warnings 预览各前 N 条（§4.2） */
export const PREVIEW_LIMIT = 100;
/** 未匹配昵称映射交互上限（§3.3 规则 4a） */
export const UNMATCHED_MEMBERS_LIMIT = 20;
/** 解析规则集版本（写入 data_jobs.ruleset_version · 格式演进审计锚） */
export const IMPORT_RULESET_VERSION = 1;

/** 标准 9 列（顺序无关 · 与导出 CSV_HEADER 同一集合） */
const CANONICAL_HEADERS = ['日期', '时间', '类型', '金额', '一级分类', '二级分类', '归属', '记账人', '备注'] as const;
type CanonicalKey =
  | 'date'
  | 'time'
  | 'type'
  | 'amount'
  | 'category1'
  | 'category2'
  | 'shared'
  | 'member'
  | 'note';

/** 标准列名 ↔ 规范键（§2.3） */
const CANONICAL_NAME_TO_KEY: Record<string, CanonicalKey> = {
  日期: 'date',
  时间: 'time',
  类型: 'type',
  金额: 'amount',
  一级分类: 'category1',
  二级分类: 'category2',
  归属: 'shared',
  记账人: 'member',
  备注: 'note',
};

/**
 * 别名表（§3.1 · 不区分大小写 · 忽略首尾空格；比较前统一 NFKC 归一，
 * 使全角括号「金额（元）」与半角「金额(元)」同源命中）。
 */
const COLUMN_ALIASES: Record<CanonicalKey, readonly string[]> = {
  date: ['日期', 'date', '交易日期', '记账日期'],
  time: ['时间', 'time', '交易时间'],
  type: ['类型', 'type', '收/支', '收支类型', '交易类型'],
  amount: ['金额', 'amount', '金额(元)', '交易金额'],
  category1: ['一级分类', '分类', '交易分类', 'category', '大类'],
  category2: ['二级分类', '子分类', 'subcategory', '小类'],
  shared: ['归属', 'shared_type', '公/私'],
  member: ['记账人', '成员', '操作人', 'member'],
  note: ['备注', 'note', '说明', '摘要', '商品', '交易对方'],
};

/** 必填四列（§3.2.1 · 缺失即拒绝整个文件） */
const REQUIRED_KEYS: readonly CanonicalKey[] = ['date', 'type', 'amount', 'category1'];

/** 显式拒绝的列（§3.1 · 归一后比对） */
const FORBIDDEN_HEADERS = new Set(['记录id', 'id', 'entry_id']);

/** 文件级致命错误（缺列/重复列/禁止列/行数超限/CSV 非法 · 检测会话转 failed） */
export interface ImportFileError {
  message: string;
}

export type ImportIssueLevel = 'error' | 'warning';

/** 分级问题（§3.10）；code 为机读串（§4.2 · 客户端据此本地化，不依赖中文串） */
export interface ImportIssue {
  /** 逻辑记录序号（表头=0，首条数据=1）；汇总级 warning 用 0 */
  row: number;
  /** 该记录起始物理行号（quoted multiline 时与逻辑序号不 1:1 · 报告 CSV 用） */
  physicalLine: number;
  /** 标准列名；汇总级 warning 用 '' */
  field: string;
  code: string;
  /** 出错字段的值（截断至 120 code points）；汇总级为 '' */
  valuePreview: string;
  /** 中文描述（报告 CSV 用） */
  message: string;
}

export type ImportEntryType = 'income' | 'expense' | 'transfer';
export type ImportSharedType = 'shared' | 'personal';

/**
 * 规范化行（§7.4 步骤 4 产物字段）。
 * createdBy = null 表示"自产文件记账人未匹配"的待映射行（§3.3 规则 4a）：
 * detect 阶段计为 ERROR 不入 importable；commit 映射命中后由 worker 改为映射值入库，
 * 未映射则跳过（计入 result_summary.skipped）。
 */
export interface NormalizedImportRow {
  rowNo: number;
  physicalLine: number;
  entryId: string; // UUID v7 预生成（§3.9 · 同任务重试复用）
  clientRefId: string; // import:<detect_id>:<rowNo>（§3.9 稳定幂等键 · 客户端本地库主键）
  occurredAt: Date; // UTC instant
  type: ImportEntryType;
  amountCents: number;
  categoryId: string;
  createdBy: string | null;
  /** 记账人昵称原文（trim 后 · 未匹配时必有值；commit member_mapping 的查找键） */
  memberName: string | null;
  sharedType: ImportSharedType | null;
  note: string | null;
}

export interface ImportAnalyzeContext {
  detectId: string;
  familyKind: 'personal' | 'shared';
  /** 当前导入操作者（默认归属 · §3.2/§3.3） */
  operatorUserId: string;
  /** 目标家庭活跃成员（left_at IS NULL · 调用方预加载） */
  members: ReadonlyArray<{ userId: string; nickname: string }>;
  /** 目标家庭可见分类（系统 + 自定义 · 未软删 · 调用方预加载） */
  categories: readonly CategoryEntity[];
}

export interface ImportAnalysis {
  ok: boolean;
  fileError?: ImportFileError;
  isCostraExport: boolean;
  formulaGuard: 'apostrophe-v2' | 'none';
  /** 规范化行（含 createdBy=null 的待映射行） */
  rows: NormalizedImportRow[];
  errors: ImportIssue[];
  warnings: ImportIssue[];
  /** 自产文件未匹配昵称聚合（影响行数降序 · ≤20 + truncated 标志） */
  unmatchedMembers: Array<{ nickname: string; rowCount: number }>;
  unmatchedMembersTruncated: boolean;
  /** 数据行总数（不含表头） */
  totalRows: number;
  /** 可导入行数（= totalRows - errors.length · 待映射行不可导入） */
  importableRows: number;
}

// ─────────────────────────────────────────────────────────────────────────────
// 文本归一
// ─────────────────────────────────────────────────────────────────────────────

/**
 * 繁→简对照（best-effort · 覆盖记账场景高频字）。
 * 方案 §3.7 步骤 4 要求 fuzzy 归一含繁简转换；完整转换表体量过大且无依赖可用，
 * 此处收高频财务/生活用字，未覆盖字自然落到"未命中 → ERROR"路径（与设计一致）。
 */
const TRADITIONAL_TO_SIMPLE: ReadonlyMap<string, string> = new Map(
  Object.entries({
    費: '费', 飲: '饮', 車: '车', 電: '电', 話: '话', 購: '购', 買: '买', 賣: '卖',
    書: '书', 醫: '医', 藥: '药', 學: '学', 習: '习', 兒: '儿', 寶: '宝', 貝: '贝',
    貸: '贷', 還: '还', 開: '开', 門: '门', 關: '关', 時: '时', 間: '间', 個: '个',
    來: '来', 對: '对', 說: '说', 國: '国', 園: '园', 樂: '乐', 遊: '游', 戲: '戏',
    視: '视', 頻: '频', 網: '网', 運: '运', 輸: '输', 訊: '讯', 務: '务', 裝: '装',
    飾: '饰', 寵: '宠', 髮: '发', 護: '护', 療: '疗', 養: '养', 訓: '训', 試: '试',
    稅: '税', 險: '险', 銀: '银', 紅: '红', 禮: '礼', 轉: '转', 賬: '账', 儲: '储',
    賒: '赊', 銷: '销', 鐵: '铁', 單: '单', 騎: '骑', 過: '过', 橋: '桥', 罰: '罚',
    違: '违', 業: '业', 氣: '气', 寬: '宽', 帶: '带', 導: '导', 簽: '签', 證: '证',
    掛: '挂', 號: '号', 檢: '检', 驗: '验', 鏡: '镜', 娛: '娱', 機: '机', 區: '区',
    體: '体', 育: '育', 點: '点', 餐: '餐', 廳: '厅', 飯: '饭', 麵: '面', 雞: '鸡',
    豬: '猪', 魚: '鱼', 湯: '汤', 飲料: '饮料', 長: '长', 東: '东', 車票: '车票',
  } as Record<string, string>).flatMap(([k, v]) => {
    // 支持词条级映射（如「飲料」）与单字映射共存：逐字展开词条
    if (k.length === 1) return [[k, v] as [string, string]];
    const out: [string, string][] = [];
    const ks = Array.from(k);
    const vs = Array.from(v);
    for (let i = 0; i < ks.length; i++) out.push([ks[i]!, vs[i] ?? vs[vs.length - 1]!]);
    return out;
  }),
);

/** 模糊匹配合一归一：NFKC（全角→半角）+ 去尾部空格 + 繁→简（§3.7 步骤 4） */
export function normalizeFuzzyText(value: string): string {
  const width = value.normalize('NFKC').replace(/\s+$/u, '');
  let out = '';
  for (const ch of width) out += TRADITIONAL_TO_SIMPLE.get(ch) ?? ch;
  return out;
}

/** 表头归一：trim + NFKC + 小写（§3.1 不区分大小写 · §2.1.1 指纹同口径） */
function normalizeHeaderCell(value: string): string {
  return value.normalize('NFKC').trim().toLowerCase();
}

/** value_preview 截断（120 code points · §4.2） */
export function toValuePreview(value: string): string {
  const chars = Array.from(value);
  return chars.length <= VALUE_PREVIEW_MAX ? value : chars.slice(0, VALUE_PREVIEW_MAX).join('');
}

// ─────────────────────────────────────────────────────────────────────────────
// 表头指纹与列绑定
// ─────────────────────────────────────────────────────────────────────────────

interface ColumnBinding {
  isCostraExport: boolean;
  /** key → 列下标 */
  columns: Map<CanonicalKey, number>;
  fileError?: ImportFileError;
}

/** 归一后的标准列名 → 规范键（指纹命中后的绑定用） */
const NORMALIZED_CANONICAL_TO_KEY: ReadonlyMap<string, CanonicalKey> = new Map(
  Object.entries(CANONICAL_NAME_TO_KEY).map(([name, key]) => [normalizeHeaderCell(name), key]),
);

/** 归一后的别名 → 规范键（NFKC 使「金额(元)」/「金额（元）」同一条目 · §3.1） */
const NORMALIZED_ALIAS_TO_KEY: ReadonlyMap<string, CanonicalKey> = (() => {
  const map = new Map<string, CanonicalKey>();
  for (const [key, aliases] of Object.entries(COLUMN_ALIASES) as Array<[CanonicalKey, readonly string[]]>) {
    for (const alias of aliases) map.set(normalizeHeaderCell(alias), key);
  }
  return map;
})();

function bindColumns(header: readonly string[]): ColumnBinding {
  const normalized = header.map(normalizeHeaderCell);

  // 禁止列优先生效（任何文件形态都一样拒绝 · §3.1）
  for (const cell of normalized) {
    if (FORBIDDEN_HEADERS.has(cell)) {
      return {
        isCostraExport: false,
        columns: new Map(),
        fileError: { message: '本系统不支持保留原记录ID，请在导出前删除此列（记录ID/id/entry_id）' },
      };
    }
  }

  // §2.1.1 指纹：归一后集合恰等于 9 个标准列名
  const headerSet = new Set(normalized);
  const isCostraExport =
    normalized.length === CANONICAL_HEADERS.length &&
    headerSet.size === CANONICAL_HEADERS.length &&
    CANONICAL_HEADERS.every((h) => headerSet.has(normalizeHeaderCell(h)));

  const columns = new Map<CanonicalKey, number>();
  if (isCostraExport) {
    normalized.forEach((cell, idx) => {
      const key = NORMALIZED_CANONICAL_TO_KEY.get(cell);
      if (key) columns.set(key, idx);
    });
    return { isCostraExport, columns };
  }

  // 外部 CSV：按别名绑定；未知列静默忽略（§3.1）
  let duplicateKey: CanonicalKey | null = null;
  normalized.forEach((cell, idx) => {
    if (cell === '') return;
    const key = NORMALIZED_ALIAS_TO_KEY.get(cell);
    if (!key) return;
    if (columns.has(key)) {
      duplicateKey ??= key;
      return;
    }
    columns.set(key, idx);
  });

  // 重复列：归一后两个表头映射到同一标准列 ⇒ 文件级 ERROR（§3.1 · 不做"取第一个"静默处理）
  if (duplicateKey !== null) {
    return {
      isCostraExport: false,
      columns: new Map(),
      fileError: { message: `表头存在重复列「${KEY_DISPLAY_NAME[duplicateKey]}」，请删除多余列` },
    };
  }

  for (const key of REQUIRED_KEYS) {
    if (!columns.has(key)) {
      return {
        isCostraExport: false,
        columns: new Map(),
        fileError: {
          message: `文件格式不完整：缺少必填列「${KEY_DISPLAY_NAME[key]}」。Costra 导入 CSV 需要至少包含：日期、类型、金额、一级分类 四列。`,
        },
      };
    }
  }
  return { isCostraExport, columns };
}

/** 标准列的展示名（错误文案用） */
const KEY_DISPLAY_NAME: Record<CanonicalKey, string> = {
  date: '日期',
  time: '时间',
  type: '类型',
  amount: '金额',
  category1: '一级分类',
  category2: '二级分类',
  shared: '归属',
  member: '记账人',
  note: '备注',
};

// ─────────────────────────────────────────────────────────────────────────────
// 字段级解析（§3.4 / §3.5 / §3.6）
// ─────────────────────────────────────────────────────────────────────────────

const TYPE_ALIASES: ReadonlyMap<string, ImportEntryType> = new Map([
  ['支出', 'expense'],
  ['expense', 'expense'],
  ['花费', 'expense'],
  ['消费', 'expense'],
  ['-', 'expense'],
  ['收入', 'income'],
  ['income', 'income'],
  ['进账', 'income'],
  ['+', 'income'],
  ['转账', 'transfer'],
  ['transfer', 'transfer'],
  ['内部转账', 'transfer'],
  ['转移', 'transfer'],
]);

/** §3.4 类型模糊匹配：trim + NFKC + 小写后查表 */
function parseTypeCell(raw: string): ImportEntryType | null {
  const key = raw.normalize('NFKC').trim().toLowerCase();
  if (key === '') return null;
  return TYPE_ALIASES.get(key) ?? null;
}

export type AmountParse =
  | { ok: true; cents: number; negative: boolean; rounded: boolean }
  | { ok: false; reason: 'empty' | 'zero' | 'invalid' };

/** §3.5 金额容错：去符号/千分位/空白 → 绝对值 → 两位小数四舍五入（字符串级，避开浮点误差） */
export function parseAmountCell(raw: string): AmountParse {
  let t = raw.normalize('NFKC').trim();
  if (t === '') return { ok: false, reason: 'empty' };
  let negative = false;
  if (t.startsWith('-')) {
    negative = true;
    t = t.slice(1);
  } else if (t.startsWith('+')) {
    t = t.slice(1);
  }
  t = t.replace(/[¥￥$,，\s]/gu, '');
  const m = /^(\d+)(?:\.(\d+))?$/.exec(t);
  if (!m) return { ok: false, reason: 'invalid' };
  const intPart = m[1]!;
  const frac = m[2] ?? '';
  // 整数位超 15 位时 Number 精度失真（2^53），按非法处理（家庭记账不存在该量级）
  if (intPart.length > 15) return { ok: false, reason: 'invalid' };
  let rounded = false;
  let cents = Number(intPart) * 100;
  if (frac.length > 0) {
    if (frac.length > 2) {
      rounded = true;
      // 四舍五入到分：前三位小数 ≥5 进位（含进位回滚到整数位）
      const third = frac.charCodeAt(2) - 48;
      let fracCents = Number(frac.slice(0, 2));
      if (third >= 5) fracCents += 1;
      if (fracCents >= 100) {
        cents += 100;
        fracCents -= 100;
      }
      cents += fracCents;
    } else {
      cents += Number(frac.padEnd(2, '0'));
    }
  }
  if (cents <= 0) return { ok: false, reason: 'zero' }; // 金额为 0（含 -0）
  return { ok: true, cents, negative, rounded };
}

interface DateParts {
  date: string; // YYYY-MM-DD
  time: string | null; // HH:mm
  offset: string | null; // Z | +09:00 …
}

/**
 * §3.6 日期容错：YYYY-MM-DD / YYYY/MM/DD / YYYY.MM.DD / MM/DD/YYYY /
 * YYYY-MM-DD HH:mm[:ss] / YYYY-MM-DDTHH:mm[:ss]（可带时区偏移）。
 */
export function parseDateCell(raw: string): DateParts | null {
  const s = raw.normalize('NFKC').trim();
  let m =
    /^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})(?:[T ](\d{1,2}):(\d{2})(?::(\d{2}))?(?:\.\d+)?(Z|[+-]\d{2}:?\d{2})?)?$/.exec(
      s,
    );
  if (m) {
    const [, y, mo, d, hh, mm, , off] = m;
    const date = `${y}-${mo!.padStart(2, '0')}-${d!.padStart(2, '0')}`;
    const time = hh != null ? `${hh.padStart(2, '0')}:${mm!}` : null;
    return { date, time, offset: off ?? null };
  }
  m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(s);
  if (m) {
    const [, mo, d, y] = m;
    return { date: `${y}-${mo!.padStart(2, '0')}-${d!.padStart(2, '0')}`, time: null, offset: null };
  }
  return null;
}

/** §3.6 时间容错：HH:mm / HH:mm:ss（截取）/ H:mm（补零）；超界（25:00 等）返回 null */
export function parseTimeCell(raw: string): string | null {
  const s = raw.normalize('NFKC').trim();
  const m = /^(\d{1,2}):(\d{2})(?::\d{2})?$/.exec(s);
  if (!m) return null;
  const hh = Number(m[1]);
  const mm = Number(m[2]);
  if (hh > 23 || mm > 59) return null;
  return `${m[1]!.padStart(2, '0')}:${m[2]!}`;
}

/** 构造 occurred_at：无偏移按 Asia/Shanghai 墙钟；带偏移按其偏移取 instant（§3.6 时区口径） */
export function buildOccurredAt(date: string, time: string, offset: string | null): Date | null {
  if (offset != null) {
    const dt = DateTime.fromISO(`${date}T${time}:00${offset}`);
    return dt.isValid ? dt.toUTC().toJSDate() : null;
  }
  const dt = DateTime.fromISO(`${date}T${time}:00`, { zone: 'Asia/Shanghai' });
  return dt.isValid ? dt.toUTC().toJSDate() : null;
}

// ─────────────────────────────────────────────────────────────────────────────
// 分类匹配（§3.7）
// ─────────────────────────────────────────────────────────────────────────────

function matchCategoryByName(
  pool: readonly CategoryEntity[],
  rawName: string,
): CategoryEntity | null {
  const exact = rawName.trim();
  const fuzzy = normalizeFuzzyText(rawName);
  // 顺序：自定义精确 → 系统精确 → 自定义模糊 → 系统模糊（§3.7 步骤 2-4）
  const custom = pool.filter((c) => c.familyId !== null);
  const system = pool.filter((c) => c.familyId === null);
  return (
    custom.find((c) => c.name === exact) ??
    system.find((c) => c.name === exact) ??
    custom.find((c) => normalizeFuzzyText(c.name) === fuzzy) ??
    system.find((c) => normalizeFuzzyText(c.name) === fuzzy) ??
    null
  );
}

/** 默认子分类：优先 is_parent_default（migration 0013 权威标记），兜底 sort_order+name（§3.7） */
export function pickDefaultChild(
  parent: CategoryEntity,
  childrenOf: (parentId: string) => readonly CategoryEntity[],
): CategoryEntity {
  const children = childrenOf(parent.id);
  if (children.length === 0) return parent; // 一级无子级：entries 可直接指向一级（与导出口径一致）
  return (
    children.find((c) => c.isParentDefault) ??
    [...children].sort((a, b) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name, 'zh'))[0]!
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// 主入口
// ─────────────────────────────────────────────────────────────────────────────

interface CsvRecordInfo {
  record: string[];
  info: { lines: number };
}

/** 主入口：解析 + 校验整个 CSV 文本，返回规范化行与分级问题（不抛业务异常） */
export function analyzeImportCsv(text: string, ctx: ImportAnalyzeContext): ImportAnalysis {
  const fail = (fileError: ImportFileError): ImportAnalysis => ({
    ok: false,
    fileError,
    isCostraExport: false,
    formulaGuard: 'none',
    rows: [],
    errors: [],
    warnings: [],
    unmatchedMembers: [],
    unmatchedMembersTruncated: false,
    totalRows: 0,
    importableRows: 0,
  });

  // 1. CSV 反序列化（标准 parser · RFC 4180 quoted multiline · §7.4 步骤 2）
  let records: CsvRecordInfo[];
  try {
    records = parse(text, {
      bom: true,
      info: true,
      skip_empty_lines: true,
      trim: false,
    }) as CsvRecordInfo[];
  } catch (err) {
    const code = (err as { code?: string }).code ?? 'UNKNOWN';
    return fail({
      message: `CSV 解析失败（${code}）：文件不符合 RFC 4180 格式，请检查引号/分隔符后重新导出`,
    });
  }
  if (records.length === 0) {
    return fail({ message: '文件为空：首条记录必须是表头' });
  }

  // 2. 表头指纹 + 列绑定（§2.1.1 / §3.1）
  const header = records[0]!.record;
  const binding = bindColumns(header);
  if (binding.fileError) return fail(binding.fileError);
  const { isCostraExport, columns } = binding;
  const formulaGuard = isCostraExport ? ('apostrophe-v2' as const) : ('none' as const);

  // 3. 行数上限（数据行、不含表头 · §9.1/§9.2 对称口径）
  const dataRecords = records.slice(1);
  if (dataRecords.length > MAX_IMPORT_ROWS) {
    return fail({
      message: `单次最多导入 ${MAX_IMPORT_ROWS.toLocaleString('en-US')} 行（当前 ${dataRecords.length.toLocaleString('en-US')} 行数据），请拆分后分批导入`,
    });
  }

  // 4. 预索引（§7.4 步骤 3：避免逐行查库）
  const parents = ctx.categories.filter((c) => c.parentId === null);
  const childrenMap = new Map<string, CategoryEntity[]>();
  for (const c of ctx.categories) {
    if (c.parentId === null) continue;
    const list = childrenMap.get(c.parentId) ?? [];
    list.push(c);
    childrenMap.set(c.parentId, list);
  }
  const childrenOf = (pid: string): readonly CategoryEntity[] => childrenMap.get(pid) ?? [];

  const errors: ImportIssue[] = [];
  const warnings: ImportIssue[] = [];
  const rows: NormalizedImportRow[] = [];
  const unmatchedAgg = new Map<string, number>();
  /** 归属缺省汇总（§3.8 · 共同家庭缺归属列/空值提示） */
  let sharedDefaultCount = 0;
  /** 个人家庭强制 personal 汇总（§3.8 跨家庭污染 · 仅在确有归属值被忽略时提示） */
  let forcedPersonalCount = 0;

  const pushIssue = (
    list: ImportIssue[],
    row: number,
    physicalLine: number,
    field: string,
    code: string,
    value: string,
    message: string,
  ): void => {
    list.push({ row, physicalLine, field, code, valuePreview: toValuePreview(value), message });
  };

  // 5. 逐行规范化（每行至多一个 ERROR · 首个 ERROR 即跳过剩余字段）
  for (let i = 0; i < dataRecords.length; i++) {
    const rec = dataRecords[i]!;
    const rowNo = i + 1; // 逻辑记录序号（表头=0 · §4.2 口径）
    const physicalLine = i === 0 ? 2 : dataRecords[i - 1]!.info.lines + 1;
    const cell = (key: CanonicalKey): string => {
      const idx = columns.get(key);
      return idx == null ? '' : (rec.record[idx] ?? '');
    };
    const maybeDecode = (value: string): string =>
      isCostraExport ? decodeFormulaGuardV2(value) : value;

    // ── 日期（必填）────────────────────────────────────────────────────
    const rawDate = cell('date').trim();
    if (rawDate === '') {
      pushIssue(errors, rowNo, physicalLine, '日期', 'EMPTY_REQUIRED', '', `第 ${rowNo} 条记录：日期为空`);
      continue;
    }
    const dateParts = parseDateCell(rawDate);
    if (!dateParts) {
      pushIssue(errors, rowNo, physicalLine, '日期', 'DATE_INVALID', rawDate, `第 ${rowNo} 条记录：日期无法解析「${toValuePreview(rawDate)}」`);
      continue;
    }

    // ── 时间（可选 · 空默认 12:00）─────────────────────────────────────
    const rawTime = cell('time').trim();
    let timePart: string;
    if (rawTime !== '') {
      // 时间列允许填完整 datetime（§3.1 时间别名注记：含完整 datetime 拆出时间部分）
      const asTime = parseTimeCell(rawTime);
      const asDateTime = asTime ?? parseDateCell(rawTime)?.time ?? null;
      if (asDateTime == null) {
        pushIssue(errors, rowNo, physicalLine, '时间', 'TIME_INVALID', rawTime, `第 ${rowNo} 条记录：时间无法解析「${toValuePreview(rawTime)}」`);
        continue;
      }
      timePart = asDateTime;
    } else {
      timePart = dateParts.time ?? '12:00';
    }

    const occurredAt = buildOccurredAt(dateParts.date, timePart, dateParts.offset);
    if (!occurredAt) {
      pushIssue(errors, rowNo, physicalLine, '日期', 'DATE_INVALID', rawDate, `第 ${rowNo} 条记录：日期无法解析「${toValuePreview(rawDate)}」`);
      continue;
    }

    // ── 类型（必填 · §3.4）────────────────────────────────────────────
    const rawType = cell('type').trim();
    if (rawType === '') {
      pushIssue(errors, rowNo, physicalLine, '类型', 'EMPTY_REQUIRED', '', `第 ${rowNo} 条记录：类型为空`);
      continue;
    }
    const entryType = parseTypeCell(rawType);
    if (!entryType) {
      pushIssue(errors, rowNo, physicalLine, '类型', 'TYPE_UNRECOGNIZED', rawType, `第 ${rowNo} 条记录：类型无法识别「${toValuePreview(rawType)}」`);
      continue;
    }

    // ── 金额（必填 · §3.5）────────────────────────────────────────────
    const rawAmount = cell('amount').trim();
    if (rawAmount === '') {
      pushIssue(errors, rowNo, physicalLine, '金额', 'EMPTY_REQUIRED', '', `第 ${rowNo} 条记录：金额为空`);
      continue;
    }
    const amount = parseAmountCell(rawAmount);
    if (!amount.ok) {
      if (amount.reason === 'empty') {
        pushIssue(errors, rowNo, physicalLine, '金额', 'EMPTY_REQUIRED', '', `第 ${rowNo} 条记录：金额为空`);
      } else if (amount.reason === 'zero') {
        pushIssue(errors, rowNo, physicalLine, '金额', 'AMOUNT_ZERO', rawAmount, `第 ${rowNo} 条记录：金额为 0`);
      } else {
        pushIssue(errors, rowNo, physicalLine, '金额', 'AMOUNT_INVALID', rawAmount, `第 ${rowNo} 条记录：金额非法「${toValuePreview(rawAmount)}」`);
      }
      continue;
    }
    if (amount.negative) {
      pushIssue(warnings, rowNo, physicalLine, '金额', 'AMOUNT_NEGATIVE_ABS', rawAmount, `第 ${rowNo} 条记录：金额为负，已按绝对值导入`);
    }
    if (amount.rounded) {
      pushIssue(warnings, rowNo, physicalLine, '金额', 'AMOUNT_ROUNDED', rawAmount, `第 ${rowNo} 条记录：金额精度超过分，已四舍五入`);
    }

    // ── 一级分类（必填 · §3.7 · 指纹文件先解码）─────────────────────────
    const rawCat1 = maybeDecode(cell('category1')).trim();
    if (rawCat1 === '') {
      pushIssue(errors, rowNo, physicalLine, '一级分类', 'EMPTY_REQUIRED', '', `第 ${rowNo} 条记录：一级分类为空`);
      continue;
    }
    const parentPool = parents.filter((c) => c.type === entryType);
    const parent = matchCategoryByName(parentPool, rawCat1);
    if (!parent) {
      // 跨 type 命中的专用文案（§3.7）
      const cross = matchCategoryByName(
        parents.filter((c) => c.type !== entryType),
        rawCat1,
      );
      if (cross) {
        const crossLabel = cross.type === 'income' ? '收入' : cross.type === 'expense' ? '支出' : '转账';
        const selfLabel = entryType === 'income' ? '收入' : entryType === 'expense' ? '支出' : '转账';
        pushIssue(
          errors,
          rowNo,
          physicalLine,
          '一级分类',
          'CATEGORY_TYPE_MISMATCH',
          rawCat1,
          `第 ${rowNo} 条记录：分类「${toValuePreview(rawCat1)}」属于${crossLabel}类型，不能用于${selfLabel}记录`,
        );
      } else {
        pushIssue(
          errors,
          rowNo,
          physicalLine,
          '一级分类',
          'CATEGORY_NOT_FOUND',
          rawCat1,
          `第 ${rowNo} 条记录：分类「${toValuePreview(rawCat1)}」不存在${
            entryType === 'transfer' ? '（转账类记录请使用 储值 / 账户互转 / 赊销 作为一级分类）' : ''
          }`,
        );
      }
      continue;
    }

    // ── 二级分类（§3.7：非空未命中 → WARNING 降级默认子分类；为空 → 默认子分类）
    const rawCat2 = maybeDecode(cell('category2')).trim();
    let categoryId: string;
    if (rawCat2 !== '') {
      const child = matchCategoryByName(childrenOf(parent.id), rawCat2);
      if (child) {
        categoryId = child.id;
      } else {
        const fallback = pickDefaultChild(parent, childrenOf);
        pushIssue(
          warnings,
          rowNo,
          physicalLine,
          '二级分类',
          'SUBCATEGORY_FALLBACK',
          rawCat2,
          `第 ${rowNo} 条记录：二级分类「${toValuePreview(rawCat2)}」不存在，已降级到默认子分类「${fallback.name}」`,
        );
        categoryId = fallback.id;
      }
    } else {
      categoryId = pickDefaultChild(parent, childrenOf).id;
    }

    // ── 记账人（§3.3 · trim 后不区分大小写精确匹配活跃成员）────────────
    const rawMember = maybeDecode(cell('member')).trim();
    let createdBy: string | null = ctx.operatorUserId;
    let memberName: string | null = null;
    if (rawMember !== '') {
      const lower = rawMember.toLowerCase();
      const matched = ctx.members.filter((m) => m.nickname.toLowerCase() === lower);
      if (matched.length === 1) {
        createdBy = matched[0]!.userId;
      } else if (matched.length > 1) {
        pushIssue(
          errors,
          rowNo,
          physicalLine,
          '记账人',
          'MEMBER_AMBIGUOUS',
          rawMember,
          `第 ${rowNo} 条记录：记账人「${toValuePreview(rawMember)}」在本家庭存在多个同名成员，无法确定归属`,
        );
        continue;
      } else if (isCostraExport) {
        // §3.3 规则 4a：自产文件未匹配 → ERROR（待 commit 映射出口）+ 聚合进 unmatched_members
        createdBy = null;
        memberName = rawMember;
        unmatchedAgg.set(rawMember, (unmatchedAgg.get(rawMember) ?? 0) + 1);
        pushIssue(
          errors,
          rowNo,
          physicalLine,
          '记账人',
          'MEMBER_UNMATCHED',
          rawMember,
          `第 ${rowNo} 条记录：记账人「${toValuePreview(rawMember)}」不是本家庭的活跃成员，无法确定归属`,
        );
      } else {
        // §3.3 规则 4b：外部 CSV 未匹配 → 归操作者 + WARNING
        createdBy = ctx.operatorUserId;
        pushIssue(
          warnings,
          rowNo,
          physicalLine,
          '记账人',
          'MEMBER_UNMATCHED',
          rawMember,
          `第 ${rowNo} 条记录：记账人「${toValuePreview(rawMember)}」未匹配到家庭成员，归属当前操作者`,
        );
      }
    }

    // ── 归属（§3.8）──────────────────────────────────────────────────
    const rawShared = cell('shared').trim();
    let sharedType: ImportSharedType | null = null;
    if (entryType !== 'expense') {
      if (rawShared !== '') {
        pushIssue(warnings, rowNo, physicalLine, '归属', 'SHARED_TYPE_IGNORED', rawShared, `第 ${rowNo} 条记录：非支出类型的归属列将被忽略`);
      }
    } else if (ctx.familyKind === 'personal') {
      // 跨家庭污染防护：个人家庭一律强制 personal（§3.8）
      sharedType = 'personal';
      if (rawShared !== '') forcedPersonalCount += 1;
    } else {
      const key = normalizeFuzzyText(rawShared).toLowerCase();
      if (key === '共同' || key === 'shared') {
        sharedType = 'shared';
      } else if (key === '个人' || key === 'personal') {
        sharedType = 'personal';
      } else if (rawShared === '') {
        // 空（支出）→ 家庭默认语义（shared 家庭 ⇒ shared）
        sharedType = ctx.familyKind === 'shared' ? 'shared' : 'personal';
        if (ctx.familyKind === 'shared') sharedDefaultCount += 1;
      } else {
        sharedType = ctx.familyKind === 'shared' ? 'shared' : 'personal';
        pushIssue(warnings, rowNo, physicalLine, '归属', 'SHARED_TYPE_UNRECOGNIZED', rawShared, `第 ${rowNo} 条记录：归属无法识别，已按家庭默认处理`);
      }
    }

    // ── 备注（§3.11：超 200 按 code point 截断 + WARNING）─────────────
    const rawNote = maybeDecode(cell('note'));
    let note: string | null = rawNote === '' ? null : rawNote;
    if (note !== null && Array.from(note).length > 200) {
      note = Array.from(note).slice(0, 200).join('');
      pushIssue(warnings, rowNo, physicalLine, '备注', 'NOTE_TRUNCATED', note, `第 ${rowNo} 条记录：备注超过 200 字符，已截断`);
    }

    rows.push({
      rowNo,
      physicalLine,
      entryId: newId(),
      clientRefId: `import:${ctx.detectId}:${rowNo}`,
      occurredAt,
      type: entryType,
      amountCents: amount.cents,
      categoryId,
      createdBy,
      memberName,
      sharedType,
      note,
    });
  }

  // 6. 汇总级 WARNING（§3.8 · row=0 口径）
  if (sharedDefaultCount > 0) {
    pushIssue(warnings, 0, 0, '归属', 'SHARED_DEFAULT_SUMMARY', '', `${sharedDefaultCount} 条支出未指定归属，将按共同家庭默认记为「共同」`);
  }
  if (forcedPersonalCount > 0) {
    pushIssue(warnings, 0, 0, '归属', 'SHARED_FORCED_PERSONAL', '', '目标为个人账本，归属列已统一按「个人」处理');
  }

  // 7. 未匹配成员聚合（仅自产文件 · 影响行数降序 · 上限 20）
  const sortedUnmatched = [...unmatchedAgg.entries()]
    .map(([nickname, rowCount]) => ({ nickname, rowCount }))
    .sort((a, b) => b.rowCount - a.rowCount || a.nickname.localeCompare(b.nickname, 'zh'));
  const unmatchedMembers = isCostraExport ? sortedUnmatched.slice(0, UNMATCHED_MEMBERS_LIMIT) : [];
  const unmatchedMembersTruncated = isCostraExport && sortedUnmatched.length > UNMATCHED_MEMBERS_LIMIT;

  const importableRows = rows.filter((r) => r.createdBy !== null).length;
  return {
    ok: true,
    isCostraExport,
    formulaGuard,
    rows,
    errors,
    warnings,
    unmatchedMembers,
    unmatchedMembersTruncated,
    totalRows: dataRecords.length,
    importableRows,
  };
}
