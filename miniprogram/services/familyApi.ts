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
  /**
   * 家庭所有者 user_id（契约事实源 · openapi.yaml Family.owner_id）。
   * 注意：列表接口不下发 role 字段，判断"当前用户是否 owner"必须用 owner_id === 当前 user_id，
   * 而非读取不存在的 role 字段（与 transferOwnership 同步维护，移交后即时一致）。
   */
  owner_id: string;
  ledger_id: string;
  ledger_name: string;
  member_count: number;
  created_at: string;
  /** 乐观锁版本号（COSTRA-230 重命名 / 解散接口必填） */
  version: number;
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
  /**
   * 持久化配色槽位 0~7（migration 0012_family_members_color_slot）。
   * active 成员必非 null；status=left 时为 null（slot 已释放可被新人复用）。
   * 前端按此索引到 8 色莫兰迪色板，保证同 family 内成员之间不撞色。
   * 兼容旧服务端：若字段缺失视为 null，前端兜底落 slot 0。
   */
  color_slot: number | null;
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
  month: string | null;   // "YYYY-MM"；当请求传 year 时为 null
  year: string | null;    // "YYYY"；当请求传 month 时为 null
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
const FAMILY_LIST_CACHE_TTL = 60 * 1000; // M1-B: families 短缓存
const FAMILY_MEMBERS_CACHE_TTL = 30 * 1000; // M1-B: members 短缓存
const MAX_CACHE_SIZE = 20; // P1-4: 缓存上限

interface CacheEntry<T> {
  data: T;
  timestamp: number;
}

const _summaryCache = new Map<string, CacheEntry<FamilySummary>>();
let _familiesCache: CacheEntry<FamiliesResponse> | null = null;
let _familiesInflight: Promise<FamiliesResponse> | null = null;
const _membersCache = new Map<string, CacheEntry<FamilyMember[]>>();
const _membersInflight = new Map<string, Promise<FamilyMember[]>>();
/** COSTRA-305: L1 drill-down page-lifetime 缓存 */
const _familyDrillCache = new Map<string, FamilySummaryDrillDownResponse>();

/** 构建 summary 缓存 key（B3: month/year xor 改造） */
function summaryCacheKey(familyId: string, scope: { month?: string; year?: string }): string {
  return scope.month
    ? `${familyId}:m:${scope.month}`
    : `${familyId}:y:${scope.year!}`;
}

/** 从缓存取 summary（可能过期 · 供 _loadSummary stale-first 使用） */
export function getCachedSummary(
  familyId: string,
  scope: { month?: string; year?: string },
): FamilySummary | null {
  const key = summaryCacheKey(familyId, scope);
  const entry = _summaryCache.get(key);
  if (!entry) return null;
  // 超过 TTL 的缓存视为过期，但仍保留在 Map 中（SWR 降级可用）
  if (Date.now() - entry.timestamp > SUMMARY_CACHE_TTL) return null;
  return entry.data;
}

/** 写入缓存（P1-4: 超上限时删除最旧条目） */
function setCachedSummary(familyId: string, scope: { month?: string; year?: string }, data: FamilySummary): void {
  const key = summaryCacheKey(familyId, scope);
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
  // COSTRA-305: 同步清理 drill-down 缓存
  for (const key of _familyDrillCache.keys()) {
    if (key.startsWith(`${familyId}:`)) {
      _familyDrillCache.delete(key);
    }
  }
}

export function invalidateFamiliesCache(): void {
  _familiesCache = null;
  _familiesInflight = null;
}

export function invalidateFamilyMembersCache(familyId?: string): void {
  if (familyId) {
    _membersCache.delete(familyId);
    _membersInflight.delete(familyId);
    return;
  }
  _membersCache.clear();
  _membersInflight.clear();
}

function invalidateFamilyStructureCache(familyId?: string): void {
  invalidateFamiliesCache();
  invalidateFamilyMembersCache(familyId);
  if (familyId) invalidateFamilyCache(familyId);
}

function isFresh(timestamp: number, ttl: number): boolean {
  return Date.now() - timestamp <= ttl;
}

// ─── API 函数 ────────────────────────────────────────────────────────────────────

/**
 * 获取家庭列表
 * GET /v1/families
 * 后端返回 FamilyItem[]（数组），前端包装为 FamiliesResponse
 */
export async function getFamilies(): Promise<FamiliesResponse> {
  if (_familiesCache && isFresh(_familiesCache.timestamp, FAMILY_LIST_CACHE_TTL)) {
    return _familiesCache.data;
  }
  if (_familiesInflight) return _familiesInflight;

  _familiesInflight = request<FamilyItem[]>({
    method: 'GET',
    path: '/families',
  }).then((data) => {
    const response = { families: data };
    _familiesCache = { data: response, timestamp: Date.now() };
    return response;
  }).finally(() => {
    _familiesInflight = null;
  });

  return _familiesInflight;
}

/**
 * 获取家庭 summary（月度或年度）
 * GET /v1/families/{id}/summary?month=YYYY-MM&top_n=6
 * GET /v1/families/{id}/summary?year=YYYY&top_n=6
 *
 * scope 必须恰传 month 或 year 之一（COSTRA-301 month/year xor 改造）。
 */
export async function getFamilySummary(
  familyId: string,
  scope: { month?: string; year?: string },
  opts?: { topN?: number },
): Promise<FamilySummary> {
  const hasMonth = !!scope.month;
  const hasYear = !!scope.year;
  if (hasMonth === hasYear) {
    throw new Error('getFamilySummary: scope must have exactly one of month/year');
  }

  const summary = await request<FamilySummary>({
    method: 'GET',
    path: `/families/${familyId}/summary`,
    query: {
      ...(hasMonth ? { month: scope.month } : { year: scope.year }),
      top_n: opts?.topN ?? 6,
    },
  });
  // P1-2: 请求成功后写入缓存（stale-while-revalidate · COSTRA-223 R1.x.1）
  setCachedSummary(familyId, scope, summary);
  return summary;
}

/**
 * 获取家庭成员列表
 * GET /v1/families/{id}/members
 *
 * 后端返回成员数组（active + left，按 joined_at/left_at 排序）。
 */
export async function getFamilyMembers(familyId: string): Promise<FamilyMember[]> {
  const cached = _membersCache.get(familyId);
  if (cached && isFresh(cached.timestamp, FAMILY_MEMBERS_CACHE_TTL)) {
    return cached.data;
  }

  const inflight = _membersInflight.get(familyId);
  if (inflight) return inflight;

  const requestPromise = request<FamilyMember[]>({
    method: 'GET',
    path: `/families/${familyId}/members`,
  }).then((members) => {
    _membersCache.set(familyId, { data: members, timestamp: Date.now() });
    return members;
  }).finally(() => {
    _membersInflight.delete(familyId);
  });

  _membersInflight.set(familyId, requestPromise);
  return requestPromise;
}

/**
 * 创建共享家庭
 * POST /v1/families
 */
export async function createFamily(name: string): Promise<FamilyItem> {
  const family = await request<FamilyItem>({
    method: 'POST',
    path: '/families',
    body: { name, kind: 'shared' },
  });
  invalidateFamilyStructureCache(family.id);
  return family;
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
 * 撤销邀请（owner 在未分享时取消，回收已创建 token）
 * DELETE /v1/families/{id}/invites/{inviteId}
 */
export async function revokeInvite(familyId: string, inviteId: string): Promise<void> {
  return request<void>({
    method: 'DELETE',
    path: `/families/${familyId}/invites/${inviteId}`,
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
  const family = await request<FamilyItem>({
    method: 'POST',
    path: '/families/invites/accept',
    body: { invite_token: inviteToken },
  });
  invalidateFamilyStructureCache(family.id);
  return family;
}

/**
 * 移出成员
 * DELETE /v1/families/{id}/members/{userId}
 */
export async function removeMember(familyId: string, userId: string): Promise<void> {
  await request<void>({
    method: 'DELETE',
    path: `/families/${familyId}/members/${userId}`,
  });
  invalidateFamilyStructureCache(familyId);
}

/**
 * 当前用户主动离开家庭（COSTRA-229 / 230）
 * POST /v1/families/{id}/members/me/leave
 *
 * 后端语义（D-029 §2.1）：
 *   - 非 owner：直接 setLeftAt(self)
 *   - owner 多人：单事务移交所有权（joined_at ASC 最早者）+ setLeftAt(self)
 *   - owner 仅自己：单事务 softDelete + setAllActiveLeftAt
 *   - personal family：403 FAMILY_PERSONAL_NOT_DELETABLE
 *
 * 调用方在三种情况下都应：clearActiveFamily + 切回 personal family。
 */
export async function leaveFamily(familyId: string): Promise<void> {
  await request<void>({
    method: 'POST',
    path: `/families/${familyId}/members/me/leave`,
    body: {},
  });
  invalidateFamilyStructureCache(familyId);
}

/**
 * 解散家庭（仅 owner）
 * DELETE /v1/families/{id}?version=X
 *
 * 后端语义（D-029 §2.3）：
 *   - 单事务内先 setAllActiveLeftAt（所有成员 left_at=now）再 softDelete
 *   - personal family 不可解散
 *   - 乐观锁：必须传 version
 *
 * 调用方应在成功后：clearActiveFamily + 切回 personal family。
 */
export async function dissolveFamily(familyId: string, version: number): Promise<void> {
  await request<void>({
    method: 'DELETE',
    path: `/families/${familyId}?version=${version}`,
  });
  invalidateFamilyStructureCache(familyId);
}

/**
 * 重命名 family（COSTRA-230 · 权限放开见后端 familyService.updateFamily）
 * PATCH /v1/families/{id}
 *
 * - 全体 active 成员均可调用（后端 assertActiveMember 守门；解散仍限 owner）
 * - 必须传 version（乐观锁）；返回新的 FamilyItem 含递增 version
 * - personal family 也允许重命名（与 deleteFamily 不同语义）
 */
export async function renameFamily(
  familyId: string,
  name: string,
  version: number,
): Promise<FamilyItem> {
  const family = await request<FamilyItem>({
    method: 'PATCH',
    path: `/families/${familyId}`,
    body: { name, version },
  });
  invalidateFamilyStructureCache(familyId);
  return family;
}

// ─── Family drill-down (L1→流水明细) ─────────────────────────────────────────────
// COSTRA-305 · 协作页 L1 三级下钻
// 契约: GET /v1/families/{familyId}/summary/drill-down

/** 单条流水明细（drill-down 返回项） */
export interface FamilyEntryDetailItem {
  entry_id: string;
  amount: number;            // cents
  note: string | null;
  occurred_at: string;       // UTC ISO
  shared_type: 'shared' | 'personal' | null;
  created_by: string;
  nickname: string;
  avatar_url: string | null;
}

/** GET /v1/families/{familyId}/summary/drill-down 响应 */
export interface FamilySummaryDrillDownResponse {
  l1_category_id: string;
  l1_category_name: string;
  l1_amount: number;         // cents
  items: FamilyEntryDetailItem[];
  total_count: number;
  has_more: boolean;
}

function familyDrillCacheKey(
  familyId: string,
  scope: { month?: string; year?: string },
  l1CategoryId: string,
  sharedType: 'shared' | 'personal',
  userId?: string,
  limit?: number,
): string {
  const period = scope.month ?? scope.year!;
  return `${familyId}:${period}:${l1CategoryId}:${sharedType}:${userId ?? 'all'}:${limit ?? 10}`;
}

/**
 * 协作页 L1→流水明细 drill-down
 * GET /v1/families/{familyId}/summary/drill-down
 *
 * @param familyId 家庭 ID
 * @param scope month 或 year 二选一
 * @param l1CategoryId 一级分类 ID
 * @param opts sharedType + userId(personal 必填) + limit
 */
export async function drillDownFamilyL1Entries(
  familyId: string,
  scope: { month?: string; year?: string },
  l1CategoryId: string,
  opts: { sharedType: 'shared' | 'personal'; userId?: string; limit?: number },
): Promise<FamilySummaryDrillDownResponse> {
  const cacheKey = familyDrillCacheKey(familyId, scope, l1CategoryId, opts.sharedType, opts.userId, opts.limit);
  const cached = _familyDrillCache.get(cacheKey);
  if (cached) {
    // LRU：命中即刷新最近使用顺序（delete + set 使其移到 Map 末尾，避免被优先淘汰）
    _familyDrillCache.delete(cacheKey);
    _familyDrillCache.set(cacheKey, cached);
    return cached;
  }

  const params: Record<string, string | number> = {
    l1_category_id: l1CategoryId,
    shared_type: opts.sharedType,
  };
  if (scope.month) params.month = scope.month;
  if (scope.year) params.year = scope.year;
  if (opts.sharedType === 'personal' && opts.userId) params.user_id = opts.userId;
  if (opts.limit != null) params.limit = opts.limit;

  const data = await request<FamilySummaryDrillDownResponse>({
    method: 'GET',
    path: `/families/${familyId}/summary/drill-down`,
    query: params,
  });

  // LRU 淘汰（复用 MAX_CACHE_SIZE 上限）
  if (_familyDrillCache.size >= MAX_CACHE_SIZE && !_familyDrillCache.has(cacheKey)) {
    const firstKey = _familyDrillCache.keys().next().value;
    if (firstKey !== undefined) _familyDrillCache.delete(firstKey);
  }
  _familyDrillCache.set(cacheKey, data);

  return data;
}

export const __test__ = {
  resetCaches(): void {
    _summaryCache.clear();
    _familyDrillCache.clear();
    invalidateFamiliesCache();
    invalidateFamilyMembersCache();
  },
};
