// templates/common.mjs · 格式化辅助函数（见 spec §7.2）
// 无外部依赖，纯 Node.js 内置

// ─── 金额格式化 ───────────────────────────────────────────────────────────────

/**
 * 将分（cents）格式化为 ¥12,340.56
 * @param {number|string} cents
 * @returns {string}
 */
export function fmtAmount(cents) {
  const n = Number(cents);
  if (isNaN(n)) return '¥0.00';
  const yuan = n / 100;
  return '¥' + yuan.toLocaleString('zh-CN', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

/**
 * 将分（cents）格式化为 ¥12,340（无小数，用于汇总统计）
 * @param {number|string} cents
 * @returns {string}
 */
export function fmtAmountShort(cents) {
  const n = Number(cents);
  if (isNaN(n)) return '¥0';
  const yuan = n / 100;
  return '¥' + yuan.toLocaleString('zh-CN', {
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  });
}

// ─── 账本徽标 ─────────────────────────────────────────────────────────────────

/**
 * 根据 family_kind 生成徽标
 * @param {'personal'|'shared'|string} kind
 * @returns {'[个人]'|'[家庭]'}
 */
export function fmtBadge(kind) {
  return kind === 'shared' ? '[家庭]' : '[个人]';
}

// ─── 分类路径 ─────────────────────────────────────────────────────────────────

/**
 * 格式化分类路径（父/子）
 * @param {string} parent - 父分类名（空字符串则省略）
 * @param {string} name   - 分类名
 * @returns {string}
 */
export function fmtCategory(parent, name) {
  if (!name) return '—';
  if (!parent) return fmtText(name);
  return `${fmtText(parent)}/${fmtText(name)}`;
}

/**
 * 转义所有来自数据库的文本，避免 Markdown 表格破坏和 HTML 注入。
 * @param {unknown} value
 * @returns {string}
 */
export function fmtText(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/\\/g, '\\\\')
    .replace(/\|/g, '\\|')
    .replace(/([*_`\[\]])/g, '\\$1')
    .replace(/[\r\n]+/g, ' ')
    .trim();
}

// ─── 时间格式化 ───────────────────────────────────────────────────────────────

/**
 * 格式化 ISO 时间字符串（已经是 CST 格式的 MM-DD HH:MM，直接返回）
 * @param {string} iso - 已格式化的时间字符串（来自 SQL AT TIME ZONE 'Asia/Shanghai'）
 * @returns {string}
 */
export function fmtTime(iso) {
  if (!iso || iso === '') return '—';
  // SQL 已经输出 MM-DD HH24:MI 格式，直接返回
  return iso;
}

/**
 * 从完整 ISO 字符串提取日期部分（YYYY-MM-DD）
 * @param {string} iso
 * @returns {string}
 */
export function isoToDate(iso) {
  if (!iso) return '';
  return iso.slice(0, 10);
}

/**
 * 从完整 ISO 字符串提取 MM-DD HH:MM
 * @param {string} iso - 例如 2026-07-21T21:17:23+08:00
 * @returns {string}
 */
export function isoToShort(iso) {
  if (!iso) return '—';
  // 2026-07-21T21:17:23+08:00 → 07-21 21:17
  const m = iso.match(/(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/);
  if (!m) return iso;
  return `${m[2]}-${m[3]} ${m[4]}:${m[5]}`;
}

/**
 * 从 ISO 获取 ISO 周编号（YYYY-Www）
 * @param {string} iso
 * @returns {string}
 */
export function isoToWeek(iso) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(new Date(iso));
  const values = Object.fromEntries(parts.map(({ type, value }) => [type, value]));
  const d = new Date(Date.UTC(Number(values.year), Number(values.month) - 1, Number(values.day)));
  const day = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() + 4 - day);
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  const weekNo = Math.ceil((((d - yearStart) / 86400000) + 1) / 7);
  return `${d.getUTCFullYear()}-W${String(weekNo).padStart(2, '0')}`;
}

// ─── 昵称截断 ─────────────────────────────────────────────────────────────────

/**
 * 昵称截断到 16 字符
 * @param {string} nick
 * @returns {string}
 */
export function fmtNickname(nick) {
  if (!nick) return '（未知）';
  const truncated = nick.length <= 16 ? nick : `${nick.slice(0, 16)}…`;
  return fmtText(truncated);
}

// ─── CSV 解析 ─────────────────────────────────────────────────────────────────

/**
 * RFC 4180 CSV 解析器，支持 quoted comma、双引号转义和字段内换行。
 * @param {string} text - CSV 文本（含表头）
 * @returns {Array<Record<string, string>>}
 */
export function parseCsv(text) {
  if (!text.trim()) return [];

  const records = [];
  let record = [];
  let field = '';
  let inQuotes = false;

  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (ch === '"') {
      if (inQuotes && text[i + 1] === '"') {
        field += '"';
        i++;
      } else {
        inQuotes = !inQuotes;
      }
    } else if (ch === ',' && !inQuotes) {
      record.push(field);
      field = '';
    } else if ((ch === '\n' || ch === '\r') && !inQuotes) {
      if (ch === '\r' && text[i + 1] === '\n') i++;
      record.push(field);
      if (record.some(value => value !== '')) records.push(record);
      record = [];
      field = '';
    } else {
      field += ch;
    }
  }

  if (field !== '' || record.length > 0) {
    record.push(field);
    records.push(record);
  }
  if (inQuotes) throw new Error('CSV 存在未闭合的双引号字段');
  if (records.length === 0) return [];

  const [headers, ...rows] = records;
  return rows.map((values) => Object.fromEntries(
    headers.map((header, index) => [header, values[index] ?? '']),
  ));
}

// ─── Sparkline ────────────────────────────────────────────────────────────────

/**
 * 生成 unicode sparkline（见 spec §7.6）
 * @param {number[]} counts
 * @returns {string}
 */
export function sparkline(counts) {
  if (counts.length === 0) return '';
  const bars = '▁▂▃▄▅▆▇█';
  const max = Math.max(...counts);
  if (max === 0) return bars[0].repeat(counts.length);
  return counts
    .map(c => bars[Math.floor((c / max) * (bars.length - 1))])
    .join('');
}

// ─── 记账类型 ─────────────────────────────────────────────────────────────────

/**
 * 格式化记账类型
 * @param {'income'|'expense'|'transfer'|string} type
 * @returns {string}
 */
export function fmtEntryType(type) {
  const map = { income: '收入', expense: '支出', transfer: '转账' };
  return map[type] || type || '—';
}

/**
 * 格式化 shared_type
 * @param {'personal'|'shared'|string} sharedType
 * @returns {string}
 */
export function fmtSharedType(sharedType) {
  if (!sharedType) return '个人';
  return sharedType === 'shared' ? '共享' : '个人';
}

// ─── 秒转可读时长 ─────────────────────────────────────────────────────────────

/**
 * 将秒数转为可读时长（如 "12分钟"、"2小时30分"）
 * @param {number|string|null} seconds
 * @returns {string}
 */
export function fmtDuration(seconds) {
  if (seconds === null || seconds === '' || seconds === undefined) return '—';
  const s = Number(seconds);
  if (isNaN(s)) return '—';
  if (s < 60) return `${s}秒`;
  if (s < 3600) return `${Math.floor(s / 60)}分钟`;
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  return m > 0 ? `${h}小时${m}分` : `${h}小时`;
}

// ─── 详略分级 ─────────────────────────────────────────────────────────────────

/**
 * 按阈值决定全展还是截断（见 spec §7.4）
 * @param {any[]} items
 * @param {number} threshold
 * @param {(items: any[]) => string} renderFull
 * @param {(items: any[], threshold: number) => string} renderTruncated
 * @returns {string}
 */
export function renderSection(items, threshold, renderFull, renderTruncated) {
  if (items.length === 0) return '无\n';
  if (items.length <= threshold) return renderFull(items);
  return renderTruncated(items, threshold);
}
