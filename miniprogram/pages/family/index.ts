// pages/family/index.ts · 家庭页（Tab4）
// 卡号: COSTRA-223 · 家庭页全新开发 / API 接入 · R1 实装
// 设计源: design/ui/design_spec.md §6.5 + design/ui/interaction_flow.md §6
// 金额 ADR-0002: 全部走 decimal.js（utils/money.ts）
// P2-1 约束: 年度维度 API 不支持 · R1 仅月度 · 年度 Tab 不展示
// COSTRA-125 范式: onLoad + onShow 均加 bootstrapPromise gate，与 mine/ledger/statistics 对齐

import { toYuan } from '../../utils/money';
import { getSafeAreaMetrics } from '../../utils/safeArea';
import { getCategoryIconById } from '../../services/categoryService';
import { maxSharedFamilies, maxFamilyMembers } from '../../config/defaults';
import { triggerOnPageShow } from '../../services/syncScheduler';
import {
  getActiveFamilyId,
  setActiveFamily,
  clearActiveFamily,
  savePreferenceAsync,
  type FamilyKind,
} from '../../services/family';
import { eventBus, EventNames, type SyncDonePayload } from '../../services/eventBus';
import { getToken, hasValidSession } from '../../services/auth';
import {
  getFamilies,
  getFamilySummary,
  getCachedSummary,
  createFamily,
  createInvite,
  revokeInvite,
  removeMember,
  invalidateFamilyCache,
  type FamilyItem,
  type FamilySummary,
  type CategoryRankItem,
} from '../../services/familyApi';
import type { ApiError } from '../../services/request';
import { mapError } from '../../utils/error-mapper';

interface AppWithBootstrap {
  bootstrapPromise: Promise<void>;
}

// ─── 类型 ────────────────────────────────────────────────────────────────────────

/** 展示用成员项（排序后：活跃在前，已退出在后） */
interface MemberDisplay {
  userId: string;
  nickname: string;
  avatarUrl: string;
  role: string;
  status: 'active' | 'left';
  isOwner: boolean;
}

/** Segmented Bar 展示段 */
interface SegmentDisplay {
  key: string;
  type: 'shared' | 'personal';
  label: string;
  amount: string;       // 格式化后的元
  amountCents: number;
  flexBps: number;      // 0~10000 basis points → flex 比例
  color: string;
  memberStatus: 'active' | 'left' | null;
  userId: string | null;
}

/** 垫付贡献展示项 */
interface ContributionDisplay {
  nickname: string;
  avatarUrl: string;
  amount: string;       // 格式化后的元
}

/** 分类排行展示项 */
interface CategoryDisplay {
  categoryId: string | null;
  categoryName: string;
  icon: string;           // 分类图标首字
  amount: string;         // 格式化后的元
  amountCents: number;
}

/** 数据明细行 */
interface DetailRow {
  key: string;              // 'shared' or 'member:{user_id}'
  type: 'shared' | 'personal';
  label: string;
  amount: string;           // 格式化后的元
  amountCents: number;
  avatarUrl: string;
  contributions: ContributionDisplay[];
  categories: CategoryDisplay[];
  hasMoreCategories: boolean;
  moreCategoriesCount: number;
  expanded: boolean;
}

// ─── 辅助函数 ────────────────────────────────────────────────────────────────────

/** 当前月份 → YYYY-MM */
function getCurrentMonthValue(): string {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
}

/** YYYY-MM → 显示文字: 2026年5月 */
function formatMonthDisplay(value: string): string {
  const parts = value.split('-');
  return `${parts[0]}年${parseInt(parts[1], 10)}月`;
}

/** 上一月 */
function prevMonth(value: string): string {
  const [y, m] = value.split('-').map(Number);
  if (m === 1) return `${y - 1}-12`;
  return `${y}-${String(m - 1).padStart(2, '0')}`;
}

/** 下一月 */
function nextMonth(value: string): string {
  const [y, m] = value.split('-').map(Number);
  if (m === 12) return `${y + 1}-01`;
  return `${y}-${String(m + 1).padStart(2, '0')}`;
}

/** cents → 元展示（带千分位） */
function formatCentsToYuan(cents: number): string {
  const yuanStr = toYuan(Math.abs(cents));
  const parts = yuanStr.split('.');
  const intPart = parts[0].replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return `${intPart}.${parts[1]}`;
}

/** cents → ¥X,XXX.XX 展示 */
function formatCentsDisplay(cents: number): string {
  const prefix = cents < 0 ? '-' : '';
  return `${prefix}¥${formatCentsToYuan(cents)}`;
}

/** 成员色板（非公共段使用不同灰度） */
const MEMBER_PALETTE = [
  'rgba(28,27,26,0.22)',  // 浅灰 1
  'rgba(28,27,26,0.36)',  // 中灰 2
  'rgba(28,27,26,0.18)',  // 极浅灰 3
  'rgba(28,27,26,0.28)',  // 灰 4
  'rgba(28,27,26,0.14)',  // 极浅灰 5
  'rgba(28,27,26,0.32)',  // 灰 6
];

/** 获取成员段颜色 */
function getMemberColor(index: number): string {
  return MEMBER_PALETTE[index % MEMBER_PALETTE.length];
}

/** Segmented Bar 公共段颜色 */
const SHARED_SEGMENT_COLOR = '#07C160';

// ─── Page ─────────────────────────────────────────────────────────────────────────

Page({
  data: {
    // ─── 首屏保护 ───
    /** bootstrap 完成且已登录后才设为 true · 防止页面框架提前渲染 */
    ready: false,

    // ─── 导航栏 ───
    statusBarHeight: 0,
    navBarHeight: 44,

    // ─── 模式 ───
    mode: 'solo' as 'solo' | 'multi',

    // ─── 家庭信息 ───
    familyId: '',
    familyName: '个人账本',
    familyKind: 'personal' as FamilyKind,
    isOwner: false,
    canInvite: false,
    currentUserId: '',

    // ─── 家庭列表（多家庭切换用） ───
    familyList: [] as FamilyItem[],

    // ─── 成员 ───
    members: [] as MemberDisplay[],

    // ─── 时间维度 ───
    currentMonth: getCurrentMonthValue(),
    monthDisplay: '',
    dimension: 'monthly' as 'monthly' | 'yearly',

    // ─── 摘要数据 ───
    loading: true,
    summary: null as FamilySummary | null,

    // ─── Solo 态摘要 ───
    soloExpense: '¥0.00',
    soloIncome: '¥0.00',
    soloBalance: '¥0.00',

    // ─── Segmented Bar ───
    segments: [] as SegmentDisplay[],
    totalExpenseCents: 0,

    // ─── 数据明细行 ───
    detailRows: [] as DetailRow[],

    // ─── Accordion 展开 ───
    expandedRow: '' as string,

    // ─── 空态 ───
    isEmpty: false,

    // ─── 邀请遮罩 ───
    inviteOverlayVisible: false,
    invitePreparing: false,
    inviteReady: false,
    inviteErrorText: '',

    // ─── 创建协作账本弹窗 ───
    createOverlayVisible: false,
    createFamilyName: '',
    createFamilyLoading: false,
    createFamilyError: '',
  },

  // 内部状态
  _familyId: '' as string,
  _currentUserId: '' as string,
  _loadingPromise: null as Promise<void> | null,
  _pendingInviteId: '' as string,
  _pendingInviteToken: '' as string,
  _pendingInviteFamilyId: '' as string,
  _pendingInviteShared: false,
  _invitePrepareSeq: 0,
  /** eventBus 订阅 handler（sync-refresh: SYNC_DONE 后失效缓存 + 重拉 summary，防内存泄漏） */
  _syncDoneHandler: null as ((payload?: unknown) => void) | null,

  // ─── 生命周期 ────────────────────────────────────────────────────────────────

  // onLoad gate（冗余兜底 · onShow gate 是主防线）
  onLoad() {
    const { statusBarHeight, navBarHeight } = getSafeAreaMetrics();
    this.setData({
      statusBarHeight,
      navBarHeight,
      monthDisplay: formatMonthDisplay(this.data.currentMonth),
    });

    // sync-refresh: 订阅 SYNC_DONE → 失效服务端 summary 缓存 + 重拉当前月数据
    // 关键：family 页数据来自服务端聚合 API（不是本地 storage），
    //   因此 pushed > 0（本机数据上行后服务端聚合已变）和 pulled > 0（其他端数据已被本机拉到，但 family 聚合是服务端实时 SQL，与本地存储无关）
    //   两种情况下都需要重新调 API 以拿到服务端最新聚合结果
    const syncDoneHandler = (payload?: unknown) => {
      const p = payload as SyncDonePayload | undefined;
      if (!p) return;
      // pushed/pulled 任一非零都重拉（emit 时已保证至少一个 > 0，此处再 guard 一次以防订阅链异常）
      if (p.pushed <= 0 && p.pulled <= 0) return;
      void this._onSyncDone();
    };
    this._syncDoneHandler = syncDoneHandler;
    eventBus.on(EventNames.SYNC_DONE, syncDoneHandler);

    // 等 bootstrap 完成后补读 userId（bootstrap 前 token 可能未就绪）
    const app = getApp<AppWithBootstrap>();
    void app.bootstrapPromise.then(() => {
      if (!hasValidSession()) {
        wx.reLaunch({ url: '/pages/login/index' });
        return;
      }
      this._syncCurrentUserIdFromToken();
    });
  },

  onShow() {
    // 分享完成后返回：微信已废弃 onShareAppMessage success 回调，
    // 改为在 onShow 中检测"已触发分享"标记来自动关闭邀请遮罩
    if (this._pendingInviteShared && this.data.inviteOverlayVisible) {
      wx.showToast({ title: '邀请已发出', icon: 'success' });
      this._closeInviteOverlay({ revokePendingInvite: false });
    }

    // COSTRA-127 范式：onShow 加 bootstrapPromise gate · 主防线
    const app = getApp<AppWithBootstrap>();
    void app.bootstrapPromise.then(async () => {
      if (!hasValidSession()) {
        wx.reLaunch({ url: '/pages/login/index' });
        return;
      }
      this._syncCurrentUserIdFromToken();
      this.setData({ ready: true });
      this.getTabBar?.()?.setData?.({ selected: 3, hidden: this.data.inviteOverlayVisible });
      triggerOnPageShow('family');
      await this._loadPage();
    });
  },

  onUnload() {
    // sync-refresh: 取消订阅 SYNC_DONE 事件（防内存泄漏）
    if (this._syncDoneHandler) {
      eventBus.off(EventNames.SYNC_DONE, this._syncDoneHandler);
      this._syncDoneHandler = null;
    }
  },

  /** 同步当前登录用户 ID，供 owner 判定与成员管理使用 */
  _syncCurrentUserIdFromToken(): string {
    const currentUserId = getToken()?.raw?.user?.id || '';
    if (!currentUserId) return '';

    this._currentUserId = currentUserId;
    if (this.data.currentUserId !== currentUserId) {
      this.setData({ currentUserId });
    }
    return currentUserId;
  },

  /**
   * sync-refresh: SYNC_DONE 事件处理 · 失效当前家庭的 summary 缓存 + 重拉当前月数据
   * - invalidateFamilyCache 后 _loadSummary 内 getCachedSummary 返回 null，直接走 API（绕过 stale 渲染）
   * - 仅刷新当前展示月份，不动其他 UI 状态（mode/familyList 等）
   * - 若 _loadPage 正在执行（`_loadingPromise != null`），其末尾会调一次 _loadSummary，无需重复触发，
   *   避免短暂 loading 状态闪烁（reviewer Minor-3）
   */
  async _onSyncDone() {
    if (!this._familyId) return;
    if (this._loadingPromise) return;
    invalidateFamilyCache(this._familyId);
    await this._loadSummary(this._familyId, this.data.currentMonth);
  },

  // ─── 数据加载 ────────────────────────────────────────────────────────────────

  async _loadPage() {
    if (this._loadingPromise) return this._loadingPromise;

    this._loadingPromise = this._doLoadPage();
    try {
      await this._loadingPromise;
    } finally {
      this._loadingPromise = null;
    }
  },

  async _doLoadPage() {
    this.setData({ loading: true });

    try {
      // 1. 获取家庭列表 → 判断 solo/multi 模式
      const { families } = await getFamilies();
      const sharedFamilies = families.filter(f => f.kind === 'shared');

      // 2. 获取 active family id
      const activeFamilyId = await getActiveFamilyId();

      // 3. 确定当前展示的 family
      let targetFamily: FamilyItem | null = null;

      if (activeFamilyId) {
        targetFamily = families.find(f => f.id === activeFamilyId) || null;
      }

      // 如果 active family 不在列表中或没有 active family，尝试找到第一个 shared family
      if (!targetFamily && sharedFamilies.length > 0) {
        targetFamily = sharedFamilies[0];
      }

      // 兜底取 personal family
      if (!targetFamily && families.length > 0) {
        targetFamily = families.find(f => f.kind === 'personal') || families[0];
      }

      // 4. 判断模式：有 shared family 且当前选中的是 shared → multi 态
      const hasShared = sharedFamilies.length > 0;
      const isMultiMode = hasShared && targetFamily?.kind === 'shared';
      const mode = isMultiMode ? 'multi' : 'solo';

      // Solo 态：确保使用 personal family
      if (mode === 'solo') {
        const personalFamily = families.find(f => f.kind === 'personal');
        if (personalFamily) {
          targetFamily = personalFamily;
        }
      }

      if (!targetFamily) {
        this.setData({ loading: false, mode: 'solo', isEmpty: true });
        return;
      }

      const familyId = targetFamily.id;
      this._familyId = familyId;

      // 更新 active family context（如果切换了）
      if (activeFamilyId !== familyId) {
        await setActiveFamily({
          family_id: familyId,
          ledger_id: targetFamily.ledger_id,
          family_kind: targetFamily.kind,
          ledger_name: targetFamily.ledger_name,
        });
      }

      this.setData({
        mode,
        familyId,
        familyName: mode === 'solo' ? (targetFamily.ledger_name || '个人账本') : targetFamily.name,
        familyKind: targetFamily.kind,
        familyList: families,
        isOwner: targetFamily.role === 'owner',
      });

      // 5. 加载 summary 数据
      await this._loadSummary(familyId, this.data.currentMonth);
    } catch (err) {
      console.error('[family] loadPage failed', err);

      // P0-2: 403 / FAMILY_NOT_MEMBER 专门处理（COSTRA-223 R1.x.1）
      const apiErr = err as ApiError;
      if (apiErr.status === 403 || apiErr.code === 'FAMILY_NOT_MEMBER') {
        if (this._familyId) {
          invalidateFamilyCache(this._familyId);
        }
        await clearActiveFamily();
        wx.showToast({ title: '你已不在该家庭中', icon: 'none' });
        // 切回 personal family 重新加载
        this._familyId = '';
        this._loadingPromise = null;
        await this._doLoadPage();
        return;
      }

      this.setData({ loading: false });
      wx.showToast({ title: '加载失败', icon: 'none' });
    }
  },

  async _loadSummary(familyId: string, month: string) {
    // P1-2: SWR stale-first — 先取缓存立即渲染（COSTRA-223 R1.x.1）
    const cached = getCachedSummary(familyId, month);
    if (cached) {
      this.setData({ summary: cached });
      if (this.data.mode === 'solo') {
        this._buildSoloDisplay(cached);
      } else {
        this._buildMultiDisplay(cached);
      }
    } else {
      this.setData({ loading: true });
    }

    try {
      const summary = await getFamilySummary(familyId, month);

      this.setData({ summary });

      if (this.data.mode === 'solo') {
        this._buildSoloDisplay(summary);
      } else {
        this._buildMultiDisplay(summary);
      }
    } catch (err) {
      console.error('[family] loadSummary failed', err);

      // P0-2: 403 / FAMILY_NOT_MEMBER 专门处理（COSTRA-223 R1.x.1）
      const apiErr = err as ApiError;
      if (apiErr.status === 403 || apiErr.code === 'FAMILY_NOT_MEMBER') {
        invalidateFamilyCache(familyId);
        await clearActiveFamily();
        wx.showToast({ title: '你已不在该家庭中', icon: 'none' });
        // 切回 personal family 重新加载
        this._familyId = '';
        this._loadingPromise = null;
        await this._doLoadPage();
        return;
      }

      // 降级展示空态
      this.setData({
        loading: false,
        isEmpty: true,
      });
      wx.showToast({ title: '数据加载失败', icon: 'none' });
    }
  },

  // ─── Solo 态构建 ────────────────────────────────────────────────────────────

  _buildSoloDisplay(summary: FamilySummary) {
    const { totals } = summary;

    this.setData({
      soloExpense: formatCentsDisplay(totals.expense),
      soloIncome: formatCentsDisplay(totals.income),
      soloBalance: formatCentsDisplay(totals.balance),
      loading: false,
      isEmpty: totals.expense === 0 && totals.income === 0,
    });
  },

  // ─── Multi 态构建 ───────────────────────────────────────────────────────────

  _buildMultiDisplay(summary: FamilySummary) {
    const { members, segments, shared, personal_by_member, totals } = summary;

    // 1. 构建成员展示列表（活跃在前，已退出在后）
    const activeMembers: MemberDisplay[] = [];
    const leftMembers: MemberDisplay[] = [];

    for (const m of members) {
      const display: MemberDisplay = {
        userId: m.user_id,
        nickname: m.nickname,
        avatarUrl: m.avatar_url || '',
        role: m.role,
        status: m.status,
        isOwner: m.role === 'owner',
      };
      if (m.status === 'active') {
        activeMembers.push(display);
      } else {
        leftMembers.push(display);
      }
    }

    const memberDisplays = [...activeMembers, ...leftMembers];
    const currentUserId = this._currentUserId || this._syncCurrentUserIdFromToken();
    const isCurrentUserOwner = currentUserId
      ? members.some(m => m.user_id === currentUserId && m.role === 'owner' && m.status === 'active')
      : this.data.isOwner;

    // 2. 构建 Segmented Bar
    const segmentDisplays: SegmentDisplay[] = [];
    let memberIndex = 0;
    const totalExpense = totals.expense;

    for (const seg of segments) {
      // 零值排除
      if (seg.amount === 0) continue;

      const color = seg.type === 'shared' ? SHARED_SEGMENT_COLOR : getMemberColor(memberIndex++);
      segmentDisplays.push({
        key: seg.key,
        type: seg.type,
        label: seg.label,
        amount: formatCentsDisplay(seg.amount),
        amountCents: seg.amount,
        flexBps: seg.ratio_bps,
        color,
        memberStatus: seg.member_status,
        userId: seg.user_id,
      });
    }

    // 3. 构建数据明细行（保留旧的展开状态）
    const oldExpandedMap = new Map<string, boolean>();
    for (const row of this.data.detailRows) {
      oldExpandedMap.set(row.key, row.expanded);
    }
    const detailRows: DetailRow[] = [];

    // 公共支出行
    if (shared.expense > 0) {
      const contributions: ContributionDisplay[] = shared.paid_contributions
        .filter(c => c.amount > 0)
        .map(c => ({
          nickname: c.nickname,
          avatarUrl: c.avatar_url || '',
          amount: `¥${formatCentsToYuan(c.amount)}`,
        }));

      const categories = this._buildCategoryList(shared.categories);
      const maxVisible = 5; // 最多展示5个，超出显示省略提示
      const visibleCategories = categories.slice(0, maxVisible);
      const hasMore = categories.length > maxVisible;

      detailRows.push({
        key: 'shared',
        type: 'shared',
        label: '公共支出',
        amount: formatCentsDisplay(shared.expense),
        amountCents: shared.expense,
        avatarUrl: '',
        contributions,
        categories: visibleCategories,
        hasMoreCategories: hasMore,
        moreCategoriesCount: categories.length - maxVisible,
        expanded: oldExpandedMap.get('shared') ?? false,
      });
    }

    // 各成员个人支出行（P1-1: pm.amount 对齐后端字段名）
    for (const pm of personal_by_member) {
      if (pm.amount <= 0) continue;

      const categories = this._buildCategoryList(pm.categories);
      const maxVisible = 5;
      const visibleCategories = categories.slice(0, maxVisible);
      const hasMore = categories.length > maxVisible;

      detailRows.push({
        key: `member:${pm.user_id}`,
        type: 'personal',
        label: `${pm.nickname}个人支出`,
        amount: formatCentsDisplay(pm.amount),
        amountCents: pm.amount,
        avatarUrl: pm.avatar_url || '',
        contributions: [],
        categories: visibleCategories,
        hasMoreCategories: hasMore,
        moreCategoriesCount: categories.length - maxVisible,
        expanded: oldExpandedMap.get(`member:${pm.user_id}`) ?? false,
      });
    }

    this.setData({
      members: memberDisplays,
      segments: segmentDisplays,
      totalExpenseCents: totalExpense,
      detailRows,
      loading: false,
      isEmpty: totalExpense === 0 && totals.income === 0,
      familyName: summary.family_name,
      isOwner: isCurrentUserOwner,
      canInvite: isCurrentUserOwner && activeMembers.length < maxFamilyMembers,
    });
  },

  /** 构建分类排行列表（零值排除 + 分类图标） */
  _buildCategoryList(categories: CategoryRankItem[]): CategoryDisplay[] {
    return categories
      .filter(c => c.amount > 0)
      .map(c => ({
        categoryId: c.category_id,
        categoryName: c.category_name,
        icon: getCategoryIconById(c.category_id),
        amount: `¥${formatCentsToYuan(c.amount)}`,
        amountCents: c.amount,
      }));
  },

  // ─── 交互：月份切换 ──────────────────────────────────────────────────────────

  onPrevMonth() {
    const prev = prevMonth(this.data.currentMonth);
    this.setData({
      currentMonth: prev,
      monthDisplay: formatMonthDisplay(prev),
      expandedRow: '',
    });
    this._loadSummary(this._familyId, prev);
  },

  onNextMonth() {
    const nxt = nextMonth(this.data.currentMonth);
    this.setData({
      currentMonth: nxt,
      monthDisplay: formatMonthDisplay(nxt),
      expandedRow: '',
    });
    this._loadSummary(this._familyId, nxt);
  },

  /** picker mode="date" fields="month" 变更回调（统一与明细页一致） */
  onMonthChange(e: WechatMiniprogram.PickerChange) {
    const value = e.detail.value as string;
    this.setData({
      currentMonth: value,
      monthDisplay: formatMonthDisplay(value),
      expandedRow: '',
    });
    this._loadSummary(this._familyId, value);
  },

  /** 月度/年度切换 */
  onSwitchDimension(e: WechatMiniprogram.TouchEvent) {
    const dim = e.currentTarget.dataset.dim as 'monthly' | 'yearly';
    if (dim === 'yearly') {
      wx.showToast({ title: '年度统计即将上线', icon: 'none' });
      return;
    }
    if (dim === this.data.dimension) return;
    this.setData({ dimension: dim });
    // 月度：刷新当前月数据
    this._loadSummary(this._familyId, this.data.currentMonth);
  },

  // ─── 交互：Accordion 展开/收起 ─────────────────────────────────────────────

  onTapDetailRow(e: WechatMiniprogram.TouchEvent) {
    const key = e.currentTarget.dataset.key as string;

    // 支持多个同时展开：toggle 当前行
    const detailRows = this.data.detailRows;
    for (const row of detailRows) {
      if (row.key === key) {
        row.expanded = !row.expanded;
      }
    }
    this.setData({ detailRows });
  },

  // ─── 交互：邀请成员 ──────────────────────────────────────────────────────────

  /** 打开邀请遮罩，并在遮罩内异步准备 invite token */
  onOpenInviteOverlay() {
    if (!this._familyId || !this.data.isOwner || this.data.inviteOverlayVisible) return;

    this._resetPendingInviteState();
    this.setData({
      inviteOverlayVisible: true,
      invitePreparing: true,
      inviteReady: false,
      inviteErrorText: '',
    });
    eventBus.emit(EventNames.HIDE_TAB_BAR);
    void this._prepareInviteToken();
  },

  /** 重新创建邀请 token（失败态重试） */
  onRetryInvite() {
    if (!this.data.inviteOverlayVisible || this.data.invitePreparing) return;
    this._resetPendingInviteState();
    this.setData({
      invitePreparing: true,
      inviteReady: false,
      inviteErrorText: '',
    });
    void this._prepareInviteToken();
  },

  /** 关闭邀请遮罩（未分享时同步回收服务端 token） */
  onCloseInviteOverlay() {
    this._closeInviteOverlay({ revokePendingInvite: true });
  },

  _resetPendingInviteState() {
    this._pendingInviteId = '';
    this._pendingInviteToken = '';
    this._pendingInviteFamilyId = '';
    this._pendingInviteShared = false;
  },

  _closeInviteOverlay(options: { revokePendingInvite: boolean }) {
    const inviteId = this._pendingInviteId;
    const familyId = this._pendingInviteFamilyId || this._familyId;
    const shouldRevoke = options.revokePendingInvite && !!inviteId && !this._pendingInviteShared;

    this._invitePrepareSeq += 1;
    this._resetPendingInviteState();
    this.setData({
      inviteOverlayVisible: false,
      invitePreparing: false,
      inviteReady: false,
      inviteErrorText: '',
    });
    eventBus.emit(EventNames.SHOW_TAB_BAR);

    if (shouldRevoke && familyId) {
      void this._revokeInvite(familyId, inviteId);
    }
  },

  async _revokeInvite(familyId: string, inviteId: string) {
    try {
      await revokeInvite(familyId, inviteId);
    } catch (err) {
      console.error('[family] revokeInvite failed', err);
    }
  },

  /** 创建 invite token；仅在遮罩仍然存活且请求序号匹配时提交结果 */
  async _prepareInviteToken() {
    if (!this._familyId) return;

    const prepareSeq = ++this._invitePrepareSeq;
    this._resetPendingInviteState();

    try {
      const invite = await createInvite(this._familyId);
      if (prepareSeq !== this._invitePrepareSeq || !this.data.inviteOverlayVisible) {
        void this._revokeInvite(invite.family_id, invite.id);
        return;
      }

      this._pendingInviteId = invite.id;
      this._pendingInviteToken = invite.invite_token;
      this._pendingInviteFamilyId = invite.family_id;
      this._pendingInviteShared = false;
      this.setData({
        invitePreparing: false,
        inviteReady: true,
        inviteErrorText: '',
      });
    } catch (err) {
      if (prepareSeq !== this._invitePrepareSeq || !this.data.inviteOverlayVisible) return;

      console.error('[family] createInvite failed', err);
      const mapped = mapError(err as ApiError);
      this.setData({
        invitePreparing: false,
        inviteReady: false,
        inviteErrorText: mapped.desc || '邀请码创建失败，请稍后重试',
      });
    }
  },

  /** onShareAppMessage 回调（仅在 invite token 已就绪时由遮罩内分享按钮触发） */
  onShareAppMessage(): WechatMiniprogram.Page.ICustomShareContent {
    const inviteToken = this._pendingInviteToken;
    const familyName = this.data.familyName;
    const path = inviteToken
      ? `/pages/invite-confirm/index?token=${inviteToken}`
      : '/pages/family/index';

    // 标记已触发分享（微信已废弃 success/fail 回调，改由 onShow 检测此标记来关闭弹窗）
    if (inviteToken) {
      this._pendingInviteShared = true;
    }

    return {
      title: inviteToken ? `${familyName} 邀请你一起记账` : 'Costra 协作记账',
      path,
    };
  },

  /** 阻止遮罩触摸穿透 */
  noop() {},

  // ─── 交互：成员头像点击 ────────────────────────────────────────────────────

  onTapMember(e: WechatMiniprogram.TouchEvent) {
    const { userid, status } = e.currentTarget.dataset;

    // 已退出成员：点击无响应
    if (status === 'left') return;

    // 自己：点击无响应
    if (userid === this._currentUserId) return;

    // 非创建者：点击无响应（只有 owner 能管理）
    if (!this.data.isOwner) return;

    // 创建者点击他人头像 → ActionSheet → 移出
    wx.showActionSheet({
      itemList: ['移出家庭'],
      itemColor: '#FA5151',
      success: (res) => {
        if (res.tapIndex === 0) {
          this._confirmRemoveMember(userid);
        }
      },
    });
  },

  _confirmRemoveMember(userId: string) {
    const member = this.data.members.find(m => m.userId === userId);
    const name = member?.nickname || '该成员';

    wx.showModal({
      title: '',
      content: `确定将${name}移出家庭吗？`,
      confirmColor: '#FA5151',
      success: async (res) => {
        if (!res.confirm) return;
        try {
          await removeMember(this._familyId, userId);
          wx.showToast({ title: '已移出', icon: 'success' });
          // 刷新页面数据
          await this._loadSummary(this._familyId, this.data.currentMonth);
        } catch (err) {
          console.error('[family] removeMember failed', err);
          wx.showToast({ title: '移出失败', icon: 'none' });
        }
      },
    });
  },

  // ─── 交互：创建家庭 ──────────────────────────────────────────────────────────

  onCreateFamily() {
    // 检查协作账本数量限制
    const families = this.data.familyList;
    const sharedCount = families.filter(f => f.kind === 'shared').length;
    if (sharedCount >= maxSharedFamilies) {
      wx.showToast({ title: `最多创建${maxSharedFamilies}个协作账本`, icon: 'none' });
      return;
    }
    this.setData({
      createOverlayVisible: true,
      createFamilyName: '',
      createFamilyLoading: false,
      createFamilyError: '',
    });
  },

  onCreateFamilyInput(e: WechatMiniprogram.Input) {
    this.setData({ createFamilyName: e.detail.value, createFamilyError: '' });
  },

  onCancelCreateFamily() {
    if (this.data.createFamilyLoading) return;
    this.setData({ createOverlayVisible: false });
  },

  async onConfirmCreateFamily() {
    if (this.data.createFamilyLoading) return;
    const name = this.data.createFamilyName.replace(/[\r\n]/g, '').trim();
    if (!name) {
      this.setData({ createFamilyError: '请输入账本名称' });
      return;
    }
    if (name.length > 20) {
      this.setData({ createFamilyError: '名称最多 20 个字' });
      return;
    }
    this.setData({ createFamilyLoading: true, createFamilyError: '' });
    try {
      const newFamily = await createFamily(name);
      await setActiveFamily({
        family_id: newFamily.id,
        ledger_id: newFamily.ledger_id,
        family_kind: 'shared',
        ledger_name: newFamily.ledger_name,
      });
      savePreferenceAsync(newFamily.id, newFamily.ledger_id);
      this.setData({ createOverlayVisible: false, createFamilyLoading: false });
      wx.showToast({ title: '创建成功', icon: 'success' });
      await this._loadPage();
    } catch (err) {
      console.error('[family] createFamily failed', err);
      this.setData({ createFamilyLoading: false, createFamilyError: '创建失败，请重试' });
    }
  },

  // ─── 交互：多家庭切换（P2-4: 复用明细页账本切换模式）──────────────────────────

  onTapFamilyName() {
    const families = this.data.familyList;
    if (!families || families.length <= 1) {
      wx.showToast({ title: '当前只有一个账本', icon: 'none' });
      return;
    }

    const items = families.map(f => {
      const suffix = f.kind === 'personal' ? '（个人）' : `（${f.member_count}人）`;
      return f.name + suffix;
    });

    wx.showActionSheet({
      itemList: items,
      success: async (res) => {
        const selected = families[res.tapIndex];
        if (selected.id === this._familyId) return;

        // 切换 active family context + 持久化偏好（migration 0011）
        await setActiveFamily({
          family_id: selected.id,
          ledger_id: selected.ledger_id,
          family_kind: selected.kind,
          ledger_name: selected.ledger_name,
        });
        savePreferenceAsync(selected.id, selected.ledger_id);

        this._familyId = selected.id;
        this.setData({
          familyId: selected.id,
          familyName: selected.name,
          familyKind: selected.kind,
          isOwner: selected.role === 'owner',
          mode: selected.kind === 'shared' ? 'multi' : 'solo',
          expandedRow: '',
        });

        // 切换家庭后重新加载
        await this._loadSummary(selected.id, this.data.currentMonth);
      },
    });
  },
});
