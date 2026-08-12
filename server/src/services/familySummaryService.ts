/**
 * Costra · Server · 家庭财务聚合业务编排层
 *
 * 卡号：COSTRA-222 · 事实源：server/api/openapi.yaml §FamilySummary
 *
 * 职责：
 *   - getFamilySummary: 获取家庭月度财务聚合数据
 *   - 校验 month/topN 参数
 *   - 权限守门复用 familyService.assertActiveMember
 *   - Asia/Shanghai 固定时区月区间计算
 *   - 组装 FamilySummary wire response
 *
 * 设计原则：
 *   - 金额全程 integer cents，不使用 float
 *   - ratio 使用 basis points (0~10000)，四舍五入
 *   - 空月份返回全 0 与空排行，不返回 404
 *   - left member 历史贡献保留
 *   - shared_type IS NULL 的 expense 不进入聚合，登记 skipped_unclassified_expense_count
 *
 * 性能边界（P2-2 吸收）：
 *   - R1 目标：单月 entries ≤ 5000 时 P95 ≤ 500ms
 *   - 超过该量级触发 FU-222-SUMMARY-PERF-INDEX
 */

import { AppError } from '../errors/AppError.js';
import { ErrorCode } from '../errors/ErrorCode.js';
import * as familyService from './familyService.js';
import * as familyRepo from '../repositories/familyRepo.js';
import * as ledgerRepo from '../repositories/ledgerRepo.js';
import * as familyMemberRepo from '../repositories/familyMemberRepo.js';
import * as summaryRepo from '../repositories/familySummaryRepo.js';
import * as statsRepo from '../repositories/statisticsRepo.js';

// --- Wire 响应类型（与 OpenAPI FamilySummary schema 对齐）---

export interface FamilySummaryTotals {
  expense: number;
  income: number;
  balance: number;
  shared_expense: number;
  personal_expense: number;
  entry_count: number;
  skipped_unclassified_expense_count: number;
}

export interface FamilySummaryMember {
  user_id: string;
  nickname: string;
  avatar_url: string | null;
  role: 'owner' | 'member' | 'viewer';
  status: 'active' | 'left';
  /** 成员持久化配色槽位 0~7（migration 0012）· null = 已 left 的成员，slot 已释放 */
  color_slot: number | null;
  joined_at: string;
  left_at: string | null;
  personal_expense: number;
  paid_contribution: number;
  expense_count: number;
}

export interface FamilySummarySegment {
  key: string;
  type: 'shared' | 'personal';
  label: string;
  user_id: string | null;
  amount: number;
  ratio_bps: number;
  member_status: 'active' | 'left' | null;
}

export interface FamilyPaidContribution {
  user_id: string;
  nickname: string;
  avatar_url: string | null;
  status: 'active' | 'left';
  amount: number;
  ratio_bps: number;
}

export interface FamilyCategoryRankItem {
  category_id: string | null;
  category_name: string;
  parent_category_id: string | null;
  parent_category_name: string | null;
  amount: number;
  entry_count: number;
  ratio_bps: number;
}

export interface FamilyPersonalExpenseBlock {
  user_id: string;
  nickname: string;
  avatar_url: string | null;
  status: 'active' | 'left';
  amount: number;
  categories: FamilyCategoryRankItem[];
}

/** 成员收入块（与 FamilyPersonalExpenseBlock 对称 · 无 shared 维度） */
export interface FamilyIncomeBlock {
  user_id: string;
  nickname: string;
  avatar_url: string | null;
  status: 'active' | 'left';
  amount: number;
  categories: FamilyCategoryRankItem[];
}

export interface FamilySummaryResponse {
  family_id: string;
  family_name: string;
  family_kind: 'personal' | 'shared';
  ledger_id: string;
  ledger_name: string;
  month: string | null;
  year: string | null;
  timezone: 'Asia/Shanghai';
  range_start: string;
  range_end: string;
  currency: 'CNY';
  totals: FamilySummaryTotals;
  members: FamilySummaryMember[];
  segments: FamilySummarySegment[];
  shared: {
    expense: number;
    paid_contributions: FamilyPaidContribution[];
    categories: FamilyCategoryRankItem[];
  };
  personal_by_member: FamilyPersonalExpenseBlock[];
  /** 收入维度的成员段（无 shared 段，ratio 分母 = totals.income） */
  income_segments: FamilySummarySegment[];
  /** 成员收入块（L1 折叠后的收入分类排行） */
  income_by_member: FamilyIncomeBlock[];
}

// --- 辅助函数 ---

/** 计算 basis points（万分比），四舍五入 */
function calcBps(part: number, total: number): number {
  if (total === 0) return 0;
  return Math.round((part / total) * 10000);
}

/**
 * 解析 month=YYYY-MM 为 UTC 区间 [rangeStart, rangeEnd)
 * 固定时区 Asia/Shanghai (+08:00)
 */
function parseMonthRange(month: string): { rangeStartUtc: string; rangeEndUtc: string } {
  // month 格式已由调用方校验
  const [yearStr, monthStr] = month.split('-');
  const year = Number(yearStr);
  const mon = Number(monthStr);

  // Asia/Shanghai 当月 1 日 00:00:00 → UTC 减 8 小时
  const startShanghai = new Date(Date.UTC(year, mon - 1, 1, 0, 0, 0));
  const startUtc = new Date(startShanghai.getTime() - 8 * 60 * 60 * 1000);

  // 下月 1 日 00:00:00 Asia/Shanghai
  const endShanghai = new Date(Date.UTC(year, mon, 1, 0, 0, 0));
  const endUtc = new Date(endShanghai.getTime() - 8 * 60 * 60 * 1000);

  return {
    rangeStartUtc: startUtc.toISOString(),
    rangeEndUtc: endUtc.toISOString(),
  };
}

/** 校验 month 格式 */
function validateMonth(month: string): void {
  const monthRegex = /^(\d{4})-(\d{2})$/;
  const match = monthRegex.exec(month);
  if (!match) {
    throw new AppError(ErrorCode.INVALID_ARGUMENT, {
      message: 'month must be YYYY-MM format',
      details: { field: 'month', value: month, constraint: 'YYYY-MM' },
    });
  }
  const mon = Number(match[2]);
  if (mon < 1 || mon > 12) {
    throw new AppError(ErrorCode.INVALID_ARGUMENT, {
      message: 'month must be between 01 and 12',
      details: { field: 'month', value: month, constraint: '01-12' },
    });
  }
}

/**
 * 解析 year=YYYY 为 UTC 区间 [rangeStart, rangeEnd)
 * 固定时区 Asia/Shanghai (+08:00)
 *
 * 卡号：COSTRA-300
 */
function parseYearRange(year: string): { rangeStartUtc: string; rangeEndUtc: string } {
  const y = Number(year);
  // Asia/Shanghai 当年 1/1 00:00:00 → UTC 减 8 小时
  const startShanghai = new Date(Date.UTC(y, 0, 1, 0, 0, 0));
  const startUtc = new Date(startShanghai.getTime() - 8 * 60 * 60 * 1000);
  // 次年 1/1 00:00:00 Asia/Shanghai
  const endShanghai = new Date(Date.UTC(y + 1, 0, 1, 0, 0, 0));
  const endUtc = new Date(endShanghai.getTime() - 8 * 60 * 60 * 1000);
  return {
    rangeStartUtc: startUtc.toISOString(),
    rangeEndUtc: endUtc.toISOString(),
  };
}

/**
 * 校验 year 格式
 *
 * 卡号：COSTRA-300
 */
function validateYear(year: string): void {
  const yearRegex = /^\d{4}$/;
  if (!yearRegex.test(year)) {
    throw new AppError(ErrorCode.INVALID_ARGUMENT, {
      message: 'year must be YYYY format',
      details: { field: 'year', value: year, constraint: 'YYYY' },
    });
  }
  const y = Number(year);
  if (y < 1970 || y > 2999) {
    throw new AppError(ErrorCode.INVALID_ARGUMENT, {
      message: 'year must be between 1970 and 2999',
      details: { field: 'year', value: year, constraint: '1970-2999' },
    });
  }
}

/** 校验 topN 范围 */
function validateTopN(topN: number): void {
  if (topN < 1 || topN > 20) {
    throw new AppError(ErrorCode.INVALID_ARGUMENT, {
      message: 'top_n must be between 1 and 20',
      details: { field: 'top_n', value: topN, constraint: '1-20' },
    });
  }
}

/**
 * L1 折叠纯函数：将 leaf 分类行按 parent_category_id 折叠为 L1 一级分类排行。
 *
 * 卡号：COSTRA-300 · 设计源：family-page-tech-spec.md §3.3.1
 *
 * 行为：
 *   - L1 id 取 r.parent_category_id ?? r.category_id（leaf 即 L1 的情况）
 *   - category_id === null（未分类）→ 跳过，不进 L1 排行
 *   - 折叠后 filter(amount > 0) + 排序 + slice(0, topN)
 *   - ratio_bps = calcBps(amount, totalForRatio)
 *   - 排序键：amount DESC，并列时 category_name.localeCompare(_, 'zh-Hans-CN')
 */
function foldToL1(
  rows: summaryRepo.CategoryRankRow[],
  totalForRatio: number,
  topN: number,
): FamilyCategoryRankItem[] {
  const map = new Map<string, FamilyCategoryRankItem>();
  for (const r of rows) {
    const l1Id = r.parent_category_id ?? r.category_id;
    const l1Name = r.parent_category_name ?? r.category_name;
    if (!l1Id) continue; // 未分类跳过
    const cur = map.get(l1Id) ?? {
      category_id: l1Id,
      category_name: l1Name,
      parent_category_id: null,
      parent_category_name: null,
      amount: 0,
      entry_count: 0,
      ratio_bps: 0,
    };
    cur.amount += r.amount;
    cur.entry_count += r.entry_count;
    map.set(l1Id, cur);
  }
  const list = [...map.values()]
    .filter(x => x.amount > 0)
    .sort((a, b) => (b.amount - a.amount)
      || a.category_name.localeCompare(b.category_name, 'zh-Hans-CN'));
  for (const it of list) it.ratio_bps = calcBps(it.amount, totalForRatio);
  return list.slice(0, topN);
}

// --- 业务 API ---

/**
 * 获取家庭月度/年度财务聚合
 *
 * 步骤：
 *   1. 校验 month/year xor + topN
 *   2. 权限守门 assertActiveMember
 *   3. 获取 family + ledger
 *   4. 计算区间
 *   5. 获取聚合数据
 *   6. foldToL1 折叠 + 组装 wire response
 *
 * 卡号：COSTRA-300 · 扩展 year 支持 + L1 折叠
 */
export async function getFamilySummary(
  userId: string,
  input: {
    familyId: string;
    month?: string;
    year?: string;
    topN?: number;
  },
): Promise<FamilySummaryResponse> {
  // 1. 参数校验：month/year xor
  const hasMonth = !!input.month;
  const hasYear = !!input.year;
  if (hasMonth === hasYear) {
    throw new AppError(ErrorCode.INVALID_ARGUMENT, {
      message: 'must provide exactly one of month or year',
      details: { reason: 'month_year_xor', month: input.month ?? null, year: input.year ?? null },
    });
  }
  if (hasMonth) validateMonth(input.month!);
  else validateYear(input.year!);

  const topN = input.topN ?? 6;
  validateTopN(topN);

  // 2. 权限守门
  await familyService.assertActiveMember(userId, input.familyId);

  // 3. 获取 family + ledger
  const family = await familyRepo.findById(input.familyId);
  if (!family) {
    throw new AppError(ErrorCode.NOT_FOUND, { message: 'family not found' });
  }

  const ledger = await ledgerRepo.findFirstByFamilyId(input.familyId);
  if (!ledger) {
    throw new AppError(ErrorCode.NOT_FOUND, {
      message: 'family ledger not found',
      details: { ledger_missing: true },
    });
  }

  // 4. 计算区间
  const range = hasMonth ? parseMonthRange(input.month!) : parseYearRange(input.year!);
  const { rangeStartUtc, rangeEndUtc } = range;

  // 5. 获取聚合数据（支出 + 收入并行拉取）
  const [totals, memberAggs, members, sharedCategoryRanksUntrimmed, incomeByMemberAggs, allIncomeCategoryRanksUntrimmed] = await Promise.all([
    summaryRepo.getTotals(ledger.id, rangeStartUtc, rangeEndUtc),
    summaryRepo.getMemberAggregates(ledger.id, rangeStartUtc, rangeEndUtc),
    familyMemberRepo.listMembersWithUsers(input.familyId),
    summaryRepo.getCategoryRanksUntrimmed(ledger.id, rangeStartUtc, rangeEndUtc, 'shared', null),
    summaryRepo.getIncomeByMember(ledger.id, rangeStartUtc, rangeEndUtc),
    summaryRepo.getIncomeCategoryRanksByMemberUntrimmed(ledger.id, rangeStartUtc, rangeEndUtc),
  ]);

  // 成员维度聚合 Map
  const memberAggMap = new Map<string, summaryRepo.MemberAggRow>();
  for (const ma of memberAggs) {
    memberAggMap.set(ma.user_id, ma);
  }

  // 收入成员聚合 Map
  const incomeAggMap = new Map<string, number>();
  for (const ia of incomeByMemberAggs) {
    incomeAggMap.set(ia.user_id, ia.amount);
  }

  // 6. 组装 response

  // 6a. totals
  const totalsResponse: FamilySummaryTotals = {
    expense: totals.expense,
    income: totals.income,
    balance: totals.income - totals.expense,
    shared_expense: totals.shared_expense,
    personal_expense: totals.personal_expense,
    entry_count: totals.entry_count,
    skipped_unclassified_expense_count: totals.skipped_unclassified_expense_count,
  };

  // 6b. members
  const membersResponse: FamilySummaryMember[] = members.map((m) => {
    const agg = memberAggMap.get(m.userId);
    return {
      user_id: m.userId,
      nickname: m.nickname,
      avatar_url: m.avatarUrl,
      role: m.role,
      status: m.leftAt ? 'left' : 'active',
      color_slot: m.colorSlot,
      joined_at: m.joinedAt.toISOString(),
      left_at: m.leftAt ? m.leftAt.toISOString() : null,
      personal_expense: agg?.personal_expense ?? 0,
      paid_contribution: agg?.paid_contribution ?? 0,
      expense_count: agg?.expense_count ?? 0,
    };
  });

  // 6c. segments
  const segments: FamilySummarySegment[] = [];

  // 公共支出段
  if (totals.shared_expense > 0 || family.kind === 'shared') {
    segments.push({
      key: 'shared',
      type: 'shared',
      label: '公共支出',
      user_id: null,
      amount: totals.shared_expense,
      ratio_bps: calcBps(totals.shared_expense, totals.expense),
      member_status: null,
    });
  }

  // 成员个人支出段
  for (const m of members) {
    const agg = memberAggMap.get(m.userId);
    const personalAmount = agg?.personal_expense ?? 0;
    const status = m.leftAt ? 'left' : 'active';
    segments.push({
      key: `member:${m.userId}`,
      type: 'personal',
      label: m.nickname,
      user_id: m.userId,
      amount: personalAmount,
      ratio_bps: calcBps(personalAmount, totals.expense),
      member_status: status,
    });
  }

  // 6d. shared block — L1 折叠
  const paidContributions: FamilyPaidContribution[] = members.map((m) => {
    const agg = memberAggMap.get(m.userId);
    const contribution = agg?.paid_contribution ?? 0;
    return {
      user_id: m.userId,
      nickname: m.nickname,
      avatar_url: m.avatarUrl,
      status: m.leftAt ? 'left' : 'active',
      amount: contribution,
      ratio_bps: calcBps(contribution, totals.shared_expense),
    };
  });

  const sharedCategoryItems = foldToL1(sharedCategoryRanksUntrimmed, totals.shared_expense, topN);

  // 6e. personal_by_member — L1 折叠
  const allPersonalCategoryRanksUntrimmed = await summaryRepo.getPersonalCategoryRanksByMemberUntrimmed(
    ledger.id, rangeStartUtc, rangeEndUtc,
  );
  const personalCategoryRankMap = new Map<string, summaryRepo.MemberCategoryRankRow[]>();
  for (const cr of allPersonalCategoryRanksUntrimmed) {
    const list = personalCategoryRankMap.get(cr.user_id) ?? [];
    list.push(cr);
    personalCategoryRankMap.set(cr.user_id, list);
  }

  const personalByMember: FamilyPersonalExpenseBlock[] = members.map((m) => {
    const agg = memberAggMap.get(m.userId);
    const personalAmount = agg?.personal_expense ?? 0;
    const personalCategoryRanks = personalCategoryRankMap.get(m.userId) ?? [];

    const personalCategoryItems = foldToL1(personalCategoryRanks, personalAmount, topN);

    return {
      user_id: m.userId,
      nickname: m.nickname,
      avatar_url: m.avatarUrl,
      status: m.leftAt ? 'left' : 'active',
      amount: personalAmount,
      categories: personalCategoryItems,
    };
  });

  // 6f. income_segments — 仅成员段（无 shared 段，ratio 分母 = totals.income）
  const incomeSegments: FamilySummarySegment[] = [];
  for (const m of members) {
    const incomeAmount = incomeAggMap.get(m.userId) ?? 0;
    const status = m.leftAt ? 'left' : 'active';
    incomeSegments.push({
      key: `member:${m.userId}`,
      type: 'personal',
      label: m.nickname,
      user_id: m.userId,
      amount: incomeAmount,
      ratio_bps: calcBps(incomeAmount, totals.income),
      member_status: status,
    });
  }

  // 6g. income_by_member — L1 折叠（仅 amount > 0 的成员）
  const incomeCategoryRankMap = new Map<string, summaryRepo.MemberCategoryRankRow[]>();
  for (const cr of allIncomeCategoryRanksUntrimmed) {
    const list = incomeCategoryRankMap.get(cr.user_id) ?? [];
    list.push(cr);
    incomeCategoryRankMap.set(cr.user_id, list);
  }

  const incomeByMember: FamilyIncomeBlock[] = [];
  for (const m of members) {
    const incomeAmount = incomeAggMap.get(m.userId) ?? 0;
    if (incomeAmount <= 0) continue;
    const incomeCategoryRanks = incomeCategoryRankMap.get(m.userId) ?? [];
    const incomeCategoryItems = foldToL1(incomeCategoryRanks, incomeAmount, topN);
    incomeByMember.push({
      user_id: m.userId,
      nickname: m.nickname,
      avatar_url: m.avatarUrl,
      status: m.leftAt ? 'left' : 'active',
      amount: incomeAmount,
      categories: incomeCategoryItems,
    });
  }

  // 组装最终响应
  return {
    family_id: family.id,
    family_name: family.name,
    family_kind: family.kind,
    ledger_id: ledger.id,
    ledger_name: ledger.name,
    month: hasMonth ? input.month! : null,
    year: hasYear ? input.year! : null,
    timezone: 'Asia/Shanghai',
    range_start: rangeStartUtc,
    range_end: rangeEndUtc,
    currency: 'CNY',
    totals: totalsResponse,
    members: membersResponse,
    segments,
    shared: {
      expense: totals.shared_expense,
      paid_contributions: paidContributions,
      categories: sharedCategoryItems,
    },
    personal_by_member: personalByMember,
    income_segments: incomeSegments,
    income_by_member: incomeByMember,
  };
}

// --- Wire 响应类型（下钻） ---

export interface SummaryDrillDownResponse {
  l1_category_id: string;
  l1_category_name: string;
  l1_amount: number;
  items: Array<{
    entry_id: string;
    amount: number;
    note: string | null;
    occurred_at: string;
    shared_type: 'shared' | 'personal' | null;
    source_recurring_id: string | null;
    created_by: string;
    nickname: string;
    avatar_url: string | null;
    category_name: string;
  }>;
  total_count: number;
  has_more: boolean;
}

/**
 * 协作页家庭汇总三级下钻
 *
 * 卡号：COSTRA-302
 *
 * 从 family summary 的 L1 一级分类排行下钻到流水明细。
 * - entry_type=expense（默认）：口径严格对齐 familySummaryRepo（公共 = shared_type='shared'；个人 = shared_type='personal' AND created_by=userId）。
 * - entry_type=income：type='income' + created_by=userId，不看 shared_type（收入无此语义）。
 */
export async function getSummaryDrillDown(
  userId: string,
  input: {
    familyId: string;
    month?: string;
    year?: string;
    l1CategoryId: string;
    sharedType: 'shared' | 'personal';
    userId?: string;
    limit?: number;
    /** 下钻条目类型：expense（默认）或 income */
    entryType?: 'expense' | 'income';
  },
): Promise<SummaryDrillDownResponse> {
  const entryType = input.entryType ?? 'expense';

  // 1. 参数校验：month/year xor
  const hasMonth = !!input.month;
  const hasYear = !!input.year;
  if (hasMonth === hasYear) {
    throw new AppError(ErrorCode.INVALID_ARGUMENT, {
      message: 'must provide exactly one of month or year',
      details: { reason: 'month_year_xor', month: input.month ?? null, year: input.year ?? null },
    });
  }
  if (hasMonth) validateMonth(input.month!);
  else validateYear(input.year!);

  // l1_category_id 必填（路由层已校验，service 层兜底）
  if (!input.l1CategoryId) {
    throw new AppError(ErrorCode.INVALID_ARGUMENT, {
      message: 'l1_category_id is required',
      details: { field: 'l1_category_id' },
    });
  }

  // entry_type=expense 时 shared_type 必填（向后兼容默认值）
  if (entryType === 'expense') {
    // shared_type=personal 时 user_id 必填
    if (input.sharedType === 'personal' && !input.userId) {
      throw new AppError(ErrorCode.INVALID_ARGUMENT, {
        message: 'user_id is required when shared_type=personal',
        details: { field: 'user_id', shared_type: input.sharedType },
      });
    }
  } else {
    // entry_type=income 时 user_id 必填（收入必按成员）
    if (!input.userId) {
      throw new AppError(ErrorCode.INVALID_ARGUMENT, {
        message: 'user_id is required when entry_type=income',
        details: { field: 'user_id', entry_type: entryType },
      });
    }
  }

  // limit 校验
  const limit = input.limit ?? 10;
  if (limit < 1 || limit > 50) {
    throw new AppError(ErrorCode.INVALID_ARGUMENT, {
      message: 'limit must be between 1 and 50',
      details: { field: 'limit', value: limit, constraint: '1-50' },
    });
  }

  // 2. 权限守门
  await familyService.assertActiveMember(userId, input.familyId);

  // 当 user_id 存在时做成员归属校验（参考 statisticsService.assertUserIdBelongsToFamily 写法）
  if (input.userId && input.userId !== userId) {
    const belongs = await familyMemberRepo.isMemberIncludingLeft(input.userId, input.familyId);
    if (!belongs) {
      throw new AppError(ErrorCode.FAMILY_NOT_MEMBER, {
        message: 'target user_id is not a member of this family',
        details: { family_id: input.familyId, user_id: input.userId },
      });
    }
  }

  // 3. 获取 ledger
  const ledger = await ledgerRepo.findFirstByFamilyId(input.familyId);
  if (!ledger) {
    throw new AppError(ErrorCode.NOT_FOUND, {
      message: 'family ledger not found',
      details: { ledger_missing: true },
    });
  }

  // 4. 计算区间
  const range = hasMonth ? parseMonthRange(input.month!) : parseYearRange(input.year!);
  const { rangeStartUtc, rangeEndUtc } = range;

  // 5. 按 entry_type 分派 repo 函数
  let result: { items: summaryRepo.SummaryEntryDetailRow[]; totalCount: number; l1Amount: number };

  if (entryType === 'income') {
    result = await summaryRepo.listIncomeEntriesByL1Category(
      ledger.id,
      rangeStartUtc,
      rangeEndUtc,
      input.l1CategoryId,
      input.userId!,
      limit,
    );
  } else {
    // expense（默认）— 口径对齐 familySummaryRepo
    // 公共口径不按人过滤；个人口径必须按 user_id 过滤
    const createdByUserId = input.sharedType === 'personal' ? (input.userId ?? null) : null;
    result = await summaryRepo.listEntriesByL1Category(
      ledger.id,
      rangeStartUtc,
      rangeEndUtc,
      input.l1CategoryId,
      input.sharedType,
      createdByUserId,
      limit,
    );
  }

  // 7. 取一级分类名
  const catMetas = await statsRepo.getCategoriesByIds([input.l1CategoryId]);
  const l1Name = catMetas[0]?.name ?? '未分类';

  // 8. 组装响应
  return {
    l1_category_id: input.l1CategoryId,
    l1_category_name: l1Name,
    l1_amount: result.l1Amount,
    items: result.items,
    total_count: result.totalCount,
    has_more: result.items.length < result.totalCount,
  };
}
