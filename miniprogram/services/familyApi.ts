// services/familyApi.ts · 家庭相关 API 调用层
// 卡号: COSTRA-223 · Refs: COSTRA-223
// 契约事实源: api/openapi.yaml + server/src/services/familySummaryService.ts
// 金额单位: API 返回 cents（整数），前端展示时 ÷ 100

import { request } from './request';

// ─── 类型定义 ────────────────────────────────────────────────────────────────────

/** GET /v1/families 返回的家庭项 */
export interface FamilyItem {
  id: string;
  name: string;
  kind: 'personal' | 'shared';
  role: 'owner' | 'member' | 'viewer';
  ledger_id: string;
  ledger_name: string;
  member_count: number;
  created_at: string;
}

/** GET /v1/families 响应 */
export interface FamiliesResponse {
  families: FamilyItem[];
}

/** 家庭成员 */
export interface FamilyMember {
  user_id: string;
  nickname: string;
  avatar_url: string | null;
  role: 'owner' | 'member' | 'viewer';
  status: 'active' | 'left';
  joined_at: string;
  left_at: string | null;
  personal_expense: number;
  paid_contribution: number;
  expense_count: number;
}

/** Segmented Bar 数据段 */
export interface SegmentItem {
  key: string;            // 'shared' or 'member:{user_id}'
  type: 'shared' | 'personal';
  label: string;
  user_id: string | null;
  amount: number;         // cents
  ratio_bps: number;      // 0~10000 (basis points)
  member_status: 'active' | 'left' | null;
}

/** 垫付贡献项 */
export interface PaidContribution {
  user_id: string;
  nickname: string;
  avatar_url: string | null;
  status: 'active' | 'left';
  amount: number;         // cents
  ratio_bps: number;      // basis points
}

/** 分类排行项 */
export interface CategoryRankItem {
  category_id: string | null;
  category_name: string;
  parent_category_id: string | null;
  parent_category_name: string | null;
  amount: number;         // cents
  entry_count: number;
  ratio_bps: number;
}

/** 按成员的个人支出（对齐 OpenAPI FamilyPersonalExpenseBlock · P1-1 COSTRA-223 R1.x.1） */
export interface PersonalByMember {
  user_id: string;
  nickname: string;
  avatar_url: string | null;
  status: 'active' | 'left';
  amount: number;          // cents（后端实际字段名是 amount 非 expense）
  categories: CategoryRankItem[];
}

/** GET /v1/families/{id}/summary 响应 */
export interface FamilySummary {
  family_id: string;
  family_name: string;
  family_kind: 'personal' | 'shared';
  ledger_id: string;
  ledger_name: string;
  month: string;          // "YYYY-MM"
  timezone: 'Asia/Shanghai';
  range_start: string;    // UTC ISO
  range_end: string;      // UTC ISO
  currency: 'CNY';
  totals: {
    expense: number;
    income: number;
    balance: number;
    shared_expense: number;
    personal_expense: number;
    entry_count: number;
    skipped_unclassified_expense_count: number;
  };
  members: FamilyMember[];
  segments: SegmentItem[];
  shared: {
    expense: number;
    paid_contributions: PaidContribution[];
    categories: CategoryRankItem[];
  };
  personal_by_member: PersonalByMember[];
}

/** 邀请创建响应（对齐 OpenAPI FamilyInvite schema · COSTRA-223 R1.x.1 P0-1） */
export interface InviteResponse {
  id: string;
  family_id: string;
  invite_token: string;
  role: 'member' | 'viewer';
  expires_at: string;
  share_url: string;
}

/** 邀请预览响应（被邀请方在确认前查看家庭信息） */
export interface InvitePreviewResponse {
  family_name: string;
  inviter_nickname: string;
  role: 'member' | 'viewer';
  expires_at: string;
}

// ─── 缓存层（stale-while-revalidate · P1-2 重构 COSTRA-223 R1.x.1）──────────────────

const SUMMARY_CACHE_TTL = 5 * 60 * 1000; // 5 分钟
const MAX_CACHE_SIZE = 20; // P1-4: 缓存上限

interface CacheEntry<T> {
  data: T;
  timestamp: number;
}

const _summaryCache = new Map<string, CacheEntry<FamilySummary>>();

/** 构建 summary 缓存 key */
function summaryCacheKey(familyId: string, month: string): string {
  return `${familyId}:${month}`;
}

/** 从缓存取 summary（可能过期 · 供 _loadSummary stale-first 使用） */
export function getCachedSummary(familyId: string, month: string): FamilySummary | null {
  const key = summaryCacheKey(familyId, month);
  const entry = _summaryCache.get(key);
  if (!entry) return null;
  // 超过 TTL 的缓存视为过期，但仍保留在 Map 中（SWR 降级可用）
  if (Date.now() - entry.timestamp > SUMMARY_CACHE_TTL) return null;
  return entry.data;
}

/** 写入缓存（P1-4: 超上限时删除最旧条目） */
function setCachedSummary(familyId: string, month: string, data: FamilySummary): void {
  const key = summaryCacheKey(familyId, month);
  // P1-4: 超过上限时删除最旧条目
  if (_summaryCache.size >= MAX_CACHE_SIZE && !_summaryCache.has(key)) {
    // 找到 timestamp 最小的条目删除
    let oldestKey: string | null = null;
    let oldestTime = Infinity;
    for (const [k, v] of _summaryCache) {
      if (v.timestamp < oldestTime) {
        oldestTime = v.timestamp;
        oldestKey = k;
      }
    }
    if (oldestKey) _summaryCache.delete(oldestKey);
  }
  _summaryCache.set(key, { data, timestamp: Date.now() });
}

/** 清理指定家庭的缓存（被移出后调用） */
export function invalidateFamilyCache(familyId: string): void {
  for (const key of _summaryCache.keys()) {
    if (key.startsWith(`${familyId}:`)) {
      _summaryCache.delete(key);
    }
  }
}

// ─── API 函数 ────────────────────────────────────────────────────────────────────

/**
 * 获取家庭列表
 * GET /v1/families
 * 后端返回 FamilyItem[]（数组），前端包装为 FamiliesResponse
 */
export async function getFamilies(): Promise<FamiliesResponse> {
  const data = await request<FamilyItem[]>({
    method: 'GET',
    path: '/families',
  });
  return { families: data };
}

/**
 * 获取家庭月度 summary
 * GET /v1/families/{id}/summary?month=YYYY-MM&top_n=6
 * 
 * P2-1 约束: 不支持年度维度，R1 只传 month=YYYY-MM
 */
export async function getFamilySummary(
  familyId: string,
  month: string,
  opts?: { topN?: number }
): Promise<FamilySummary> {
  const summary = await request<FamilySummary>({
    method: 'GET',
    path: `/families/${familyId}/summary`,
    query: {
      month,
      top_n: opts?.topN ?? 6,
    },
  });
  // P1-2: 请求成功后写入缓存（stale-while-revalidate · COSTRA-223 R1.x.1）
  setCachedSummary(familyId, month, summary);
  return summary;
}

/**
 * 获取家庭成员列表
 * GET /v1/families/{id}/members
 */
export async function getFamilyMembers(familyId: string): Promise<{ members: FamilyMember[] }> {
  return request<{ members: FamilyMember[] }>({
    method: 'GET',
    path: `/families/${familyId}/members`,
  });
}

/**
 * 创建共享家庭
 * POST /v1/families
 */
export async function createFamily(name: string): Promise<FamilyItem> {
  return request<FamilyItem>({
    method: 'POST',
    path: '/families',
    body: { name, kind: 'shared' },
  });
}

/**
 * 创建邀请
 * POST /v1/families/{id}/invites
 * body 可选：role ('member'|'viewer') · ttl_hours (1~168)
 */
export async function createInvite(familyId: string): Promise<InviteResponse> {
  return request<InviteResponse>({
    method: 'POST',
    path: `/families/${familyId}/invites`,
    body: {},
  });
}

/**
 * 预览邀请信息（被邀请方在确认前查看家庭名称和邀请人）
 * GET /v1/families/invites/preview?token=xxx
 */
export async function previewInvite(inviteToken: string): Promise<InvitePreviewResponse> {
  return request<InvitePreviewResponse>({
    method: 'GET',
    path: '/families/invites/preview',
    query: { token: inviteToken },
  });
}

/**
 * 接受邀请
 * POST /v1/families/invites/accept
 * 成功返回加入的 FamilyItem（后端返回 FamilyResponse，字段与 FamilyItem 兼容）
 * 失败情形（后端 410 INVITE_EXPIRED）：
 *   - used_at IS NOT NULL → 邀请已被他人使用
 *   - expires_at <= now() → 邀请已超时
 *   两者在前端统一用 mapError INVITE_EXPIRED 文案处理
 */
export async function acceptInvite(inviteToken: string): Promise<FamilyItem> {
  return request<FamilyItem>({
    method: 'POST',
    path: '/families/invites/accept',
    body: { invite_token: inviteToken },
  });
}

/**
 * 移出成员
 * DELETE /v1/families/{id}/members/{userId}
 */
export async function removeMember(familyId: string, userId: string): Promise<void> {
  return request<void>({
    method: 'DELETE',
    path: `/families/${familyId}/members/${userId}`,
  });
}
