// pages/statistics/types.ts · 统计页类型定义
// 卡号: COSTRA-262 · 类型抽出减少 index.ts 体积
// Refs: COSTRA-262

/** 成员维度 key：'all' 表示全部，否则为 userId */
export type MemberKey = string;

export interface SummaryGridItem {
  label: string;
  value: string;
}

export interface TrendChartMeta {
  periodDividers: number[];
  currentIndex: number;
  peakIndex: number;
  peakLabel: string;
}

export interface MonthRow {
  month: number;
  label: string;
  expense: string;
  income: string;
  balance: string;
  isEmpty: boolean;
  /**
   * 年度页"月度流水"双行条形图原始数据
   *  - expenseCents / incomeCents：原始分（与后端 YearlyStatistics.monthly_trend 一致）
   *  - expenseRatio / incomeRatio：相对**全局基线**的归一化比例（0~1）
   *    · 全局基线 = max(所有 month.expense, 所有 month.income)，
   *      让 12 个月的线条能直接对比长短（最长那根 = 100%）。
   *  - 结余 = income - expense，不在图上画线，由数字行"余"列展示精确值。
   *    盈亏靠两线长短对比即可直观判断（收入线长于支出线 = 盈利）。
   */
  expenseCents: number;
  incomeCents: number;
  expenseRatio: number;
  incomeRatio: number;
}

export interface L1Display {
  category_id: string;
  category_name: string;
  icon: string;
  amount: string;        // 已格式化
  amountCents: number;
  ratio_bps: number;
  /** 格式化后的百分比文本，如 "42.5%" */
  ratioText: string;
  expanded: boolean;
  loadingL2: boolean;
  l2Items: L2Display[];
  /** 是否还有更多 L2（前端不显示具体数量，仅用作"还有部分较小支出未显示..."提示开关） */
  l2HasMore: boolean;
  /**
   * 2026-06-08：子树脏标记
   * 当 SYNC_DONE / ENTRY_SAVED / ENTRY_UPDATED 触发 L1 重拉时，
   * 旧 L1 节点上的 l2Items 不能再当新数据用——打此标记后：
   *   - buildL1Display 合并时清空 l2Items（保留 expanded 让自动重拉接管）
   *   - onTapL1 不再因 l2Items.length>0 早返回，强制走网络
   */
  subtreeStale?: boolean;
}

export interface L2Display {
  category_id: string;
  category_name: string;
  icon: string;
  amount: string;
  amountCents: number;
  ratio_bps: number;
  /** 格式化后的百分比文本，如 "42.5%" */
  ratioText: string;
  expanded: boolean;
  loadingL3: boolean;
  l3Items: L3Display[];
  /** 是否还有更多 L3（前端不显示具体数量，仅用作"还有部分较小支出未显示..."提示开关） */
  l3HasMore: boolean;
  /**
   * 2026-06-08：子树脏标记（同 L1.subtreeStale）
   * onTapL2 在 stale 时忽略 l3Items.length>0 早返回，强制重拉。
   */
  subtreeStale?: boolean;
}

export interface L3Display {
  entry_id: string;
  amount: string;
  note: string;
  dateLabel: string;
  timeLabel: string;
  isShared: boolean;
  isRecurring: boolean;
  nickname: string;
  avatarUrl: string;
  initial: string;
}

export interface MemberTabItem {
  key: MemberKey;          // 'all' 或 userId
  type: 'all' | 'member';
  label: string;           // '全部' / nickname
  avatarUrl: string;
  initial: string;         // 头像兜底首字
  color: string;           // 来自 getMemberColorBySlot
  status: 'active' | 'left';
}

export interface MonthlyView {
  totalExpense: string;
  totalIncome: string;
  totalBalance: string;
  trend: number[];
  chartMeta: TrendChartMeta;
  summary: SummaryGridItem[];
  l1: L1Display[];
  isEmpty: boolean;
  loading: boolean;
  loaded: boolean;
  /** 空态标题（当前月简洁，历史月带时间） */
  emptyTitle: string;
  /** 空态格言 */
  emptyHint: string;
}

export interface YearlyView {
  totalExpense: string;
  totalIncome: string;
  totalBalance: string;
  trend: number[];
  chartMeta: TrendChartMeta;
  summary: SummaryGridItem[];
  months: MonthRow[];
  l1: L1Display[];
  isEmpty: boolean;
  loading: boolean;
  loaded: boolean;
  /** 空态标题（当前年简洁，历史年带时间） */
  emptyTitle: string;
  /** 空态格言 */
  emptyHint: string;
}
