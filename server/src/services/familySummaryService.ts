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

export interface FamilySummaryResponse {
  family_id: string;
  family_name: string;
  family_kind: 'personal' | 'shared';
  ledger_id: string;
  ledger_name: string;
  month: string;
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

/** 校验 topN 范围 */
function validateTopN(topN: number): void {
  if (topN < 1 || topN > 20) {
    throw new AppError(ErrorCode.INVALID_ARGUMENT, {
      message: 'top_n must be between 1 and 20',
      details: { field: 'top_n', value: topN, constraint: '1-20' },
    });
  }
}

// --- 业务 API ---

/**
 * 获取家庭月度财务聚合
 *
 * 步骤：
 *   1. 校验 month/topN
 *   2. 权限守门 assertActiveMember
 *   3. 获取 family + ledger
 *   4. 计算月区间
 *   5. 获取聚合数据
 *   6. 组装 wire response
 */
export async function getFamilySummary(
  userId: string,
  input: {
    familyId: string;
    month: string;
    topN?: number;
  },
): Promise<FamilySummaryResponse> {
  // 1. 参数校验
  validateMonth(input.month);
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

  // 4. 计算月区间
  const { rangeStartUtc, rangeEndUtc } = parseMonthRange(input.month);

  // 5. 获取聚合数据
  const [totals, memberAggs, members, sharedCategoryRanks] = await Promise.all([
    summaryRepo.getTotals(ledger.id, rangeStartUtc, rangeEndUtc),
    summaryRepo.getMemberAggregates(ledger.id, rangeStartUtc, rangeEndUtc),
    familyMemberRepo.listMembersWithUsers(input.familyId),
    summaryRepo.getCategoryRanks(ledger.id, rangeStartUtc, rangeEndUtc, 'shared', null, topN),
  ]);

  // 成员维度聚合 Map
  const memberAggMap = new Map<string, summaryRepo.MemberAggRow>();
  for (const ma of memberAggs) {
    memberAggMap.set(ma.user_id, ma);
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

  // 6d. shared block
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

  const sharedCategoryItems: FamilyCategoryRankItem[] = sharedCategoryRanks.map((cr) => ({
    category_id: cr.category_id,
    category_name: cr.category_name,
    parent_category_id: cr.parent_category_id,
    parent_category_name: cr.parent_category_name,
    amount: cr.amount,
    entry_count: cr.entry_count,
    ratio_bps: calcBps(cr.amount, totals.shared_expense),
  }));

  // 6e. personal_by_member
  // 批量获取所有成员的 personal 分类排行，避免按 member 循环查询形成 N+1。
  const allPersonalCategoryRanks = await summaryRepo.getPersonalCategoryRanksByMember(
    ledger.id, rangeStartUtc, rangeEndUtc, topN,
  );
  const personalCategoryRankMap = new Map<string, summaryRepo.MemberCategoryRankRow[]>();
  for (const cr of allPersonalCategoryRanks) {
    const list = personalCategoryRankMap.get(cr.user_id) ?? [];
    list.push(cr);
    personalCategoryRankMap.set(cr.user_id, list);
  }

  const personalByMember: FamilyPersonalExpenseBlock[] = members.map((m) => {
    const agg = memberAggMap.get(m.userId);
    const personalAmount = agg?.personal_expense ?? 0;
    const personalCategoryRanks = personalCategoryRankMap.get(m.userId) ?? [];

    const personalCategoryItems: FamilyCategoryRankItem[] = personalCategoryRanks.map((cr) => ({
      category_id: cr.category_id,
      category_name: cr.category_name,
      parent_category_id: cr.parent_category_id,
      parent_category_name: cr.parent_category_name,
      amount: cr.amount,
      entry_count: cr.entry_count,
      ratio_bps: calcBps(cr.amount, personalAmount),
    }));

    return {
      user_id: m.userId,
      nickname: m.nickname,
      avatar_url: m.avatarUrl,
      status: m.leftAt ? 'left' : 'active',
      amount: personalAmount,
      categories: personalCategoryItems,
    };
  });

  // 组装最终响应
  return {
    family_id: family.id,
    family_name: family.name,
    family_kind: family.kind,
    ledger_id: ledger.id,
    ledger_name: ledger.name,
    month: input.month,
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
  };
}
