// pages/statistics/types.ts · 统计页类型定义
// 卡号: COSTRA-262 · 类型抽出减少 index.ts 体积
// Refs: COSTRA-262

/** 成员维度 key：'all' 表示全部，否则为 userId */
export type MemberKey = string;

export interface SummaryGridItem {
  label: string;
  value: string;
}

export interface MonthRow {
  month: number;
  label: string;
  expense: string;
  income: string;
  balance: string;
  isEmpty: boolean;
}

export interface L1Display {
  category_id: string;
  category_name: string;
  icon: string;
  amount: string;        // 已格式化
  amountCents: number;
  ratio_bps: number;
  expanded: boolean;
  loadingL2: boolean;
  l2Items: L2Display[];
  l2HasMore: boolean;
  l2MoreCount: number;
}

export interface L2Display {
  category_id: string;
  category_name: string;
  icon: string;
  amount: string;
  amountCents: number;
  ratio_bps: number;
  expanded: boolean;
  loadingL3: boolean;
  l3Items: L3Display[];
  l3HasMore: boolean;
  l3MoreCount: number;
}

export interface L3Display {
  entry_id: string;
  amount: string;
  note: string;
  dateLabel: string;
  timeLabel: string;
  shared: boolean;
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
  summary: SummaryGridItem[];
  l1: L1Display[];
  l1HasMore: boolean;
  l1MoreCount: number;
  isEmpty: boolean;
  loading: boolean;
  loaded: boolean;
}

export interface YearlyView {
  totalExpense: string;
  totalIncome: string;
  totalBalance: string;
  trend: number[];
  summary: SummaryGridItem[];
  months: MonthRow[];
  l1: L1Display[];
  l1HasMore: boolean;
  l1MoreCount: number;
  isEmpty: boolean;
  loading: boolean;
  loaded: boolean;
}
