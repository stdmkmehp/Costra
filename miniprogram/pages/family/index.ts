// pages/family/index.ts · 家庭页（Tab4）
// 卡号: COSTRA-302 · 协作页 multi 模式重构（统计页同款手风琴 + 年度可用 + L1 跳转）
// 设计源: docs/design/family-page-tech-spec.md §4 + design/ui/design_spec.md §6.5
// 金额 ADR-0002: 全部走 decimal.js（utils/money.ts）
// COSTRA-125 范式: onLoad + onShow 均加 bootstrapPromise gate，与 mine/ledger/statistics 对齐
// Refs: COSTRA-302

import { toYuan } from '../../utils/money';
import { getSafeAreaMetrics } from '../../utils/safeArea';
import { getCategoryIconById } from '../../services/categoryService';
import { getMemberColorBySlot } from '../../utils/memberColor';
import { maxSharedFamilies, maxFamilyMembers } from '../../config/defaults';
import { pickRandomSlogan } from '../../config/slogans';
import { triggerOnPageShow } from '../../services/syncScheduler';
import {
  getActiveFamilyId,
  getActiveLedgerId,
  getActiveFamilyKind,
  setActiveFamily,
  switchActiveFamily,
  fallbackToPersonalFamily,
  type FamilyKind,
} from '../../services/family';
import { eventBus, EventNames, type SyncDonePayload, type ActiveFamilyChangedPayload, type ProfileUpdatedPayload } from '../../services/eventBus';
import { getToken, hasValidSession } from '../../services/auth';
import {
  getFamilies,
  getFamilySummary,
  getCachedSummary,
  createFamily,
  createInvite,
  revokeInvite,
  removeMember,
  leaveFamily,
  dissolveFamily,
  renameFamily,
  invalidateFamilyCache,
  type FamilyItem,
  type FamilySummary,
  type CategoryRankItem,
} from '../../services/familyApi';
import type { ApiError } from '../../services/request';
import { mapError } from '../../utils/error-mapper';

/** 跨页跳转统计页动作（COSTRA-302 写入 · COSTRA-303 消费） */
export interface PendingStatisticsAction {
  memberKey: string;
  dimension: 'monthly' | 'yearly';
  month?: string;
  year?: string;
  expandL1Id?: string;
}

interface AppWithBootstrap {
  bootstrapPromise: Promise<void>;
  globalData: {
    pendingFamilyAction?: 'create' | null;
    pendingStatisticsAction?: PendingStatisticsAction | null;
  };
}

// ─── 空态辅助 ────────────────────────────────────────────────────────────────────

/** 判断给定月份值是否为本机当前自然月 */
function isCurrentMonth(value: string): boolean {
  const now = new Date();
  return value === `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
}

/** 判断给定年份值是否为本机当前自然年 */
function isCurrentYear(value: string): boolean {
  return value === `${new Date().getFullYear()}`;
}

/** 构造空态标题 */
function buildEmptyTitle(dimension: 'monthly' | 'yearly', value: string): string {
  if (dimension === 'monthly') {
    const parts = value.split('-');
    const label = `${parts[0]}年${parseInt(parts[1], 10)}月`;
    return isCurrentMonth(value) ? '暂无记录' : `${label} 暂无记录`;
  }
  return isCurrentYear(value) ? '暂无记录' : `${value}年 暂无记录`;
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

/** L1 一级分类展示项（spec §4.3） */
interface L1Display {
  category_id: string;
  category_name: string;
  icon: string;
  amount: string;         // '¥xxx.xx'
  amountCents: number;
  ratio_bps: number;
  ratioText: string;
}

/** 下钻行（替代旧 DetailRow · spec §4.3） */
interface DrilldownRow {
  key: string;                  // 'shared' or 'member:{user_id}'
  type: 'shared' | 'personal';
  label: string;
  amount: string;               // '¥1,234.56'
  amountCents: number;
  ratio_bps: number;
  ratioText: string;
  color: string;
  contributions: ContributionDisplay[];
  avatarUrl: string;
  userId: string;
  memberStatus: 'active' | 'left' | null;
  expanded: boolean;
  l1Items: L1Display[];
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

/** 万分比 → 百分比文本，如 4250 → "42.5%"；整数时省略小数，如 10000 → "100%" */
function fmtRatio(bps: number): string {
  const pct = bps / 100;
  return pct === Math.floor(pct) ? `${pct}%` : `${pct.toFixed(1)}%`;
}

// MEMBER_COLOR_SLOTS + getMemberColorBySlot 已迁移到 utils/memberColor.ts（唯一事实源 · COSTRA-261）

/**
 * L1 不限项（与统计页对齐 · 用户期望所有一级分类全部展示）。
 * 取值与后端 family-summary topN 上限保持一致（routes/families.ts schema max=20）。
 * 调用方（getFamilySummary）显式传 topN: L1_VISIBLE 让后端按上限返回。
 */
const L1_VISIBLE = 20;

/** 当前年份 → YYYY */
function getCurrentYearValue(): string {
  return `${new Date().getFullYear()}`;
}

/** YYYY → 显示文字: 2026年 */
function formatYearDisplay(value: string): string {
  return `${value}年`;
}

/** 上一年 */
function prevYear(value: string): string {
  return `${parseInt(value, 10) - 1}`;
}

/** 下一年 */
function nextYear(value: string): string {
  return `${parseInt(value, 10) + 1}`;
}

/** Segmented Bar 公共段颜色 · 莫兰迪石青（与成员色板协调） */
const SHARED_SEGMENT_COLOR = '#6B9B8F';

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
    currentYear: getCurrentYearValue(),
    monthDisplay: '',
    yearDisplay: '',
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

    // ─── 下钻列表（COSTRA-302 重构 · spec §4.3） ───
    drilldownRows: [] as DrilldownRow[],

    // ─── 空态 ───
    isEmpty: false,
    emptyTitle: '',
    emptyHint: '',

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

    // ─── 重命名账本弹窗（COSTRA-230 · 镜像 createOverlay 视觉） ───
    renameOverlayVisible: false,
    renameInput: '',
    renameLoading: false,
    renameError: '',
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
  /** 空态格言刷新标记（切月/年/账本后下次空态换一条格言） */
  _shouldRefreshEmptyHint: false,
  /** eventBus 订阅 handler（sync-refresh: SYNC_DONE 后失效缓存 + 重拉 summary，防内存泄漏） */
  _syncDoneHandler: null as ((payload?: unknown) => void) | null,
  /** eventBus 订阅 handler（2026-06-08: 跨页面账本切换响应） */
  _activeFamilyChangedHandler: null as ((payload?: unknown) => void) | null,
  /** eventBus 订阅 handler（画像变更后即时刷新成员列表中当前用户头像） */
  _profileUpdatedHandler: null as ((payload?: unknown) => void) | null,

  // ─── 生命周期 ────────────────────────────────────────────────────────────────

  // onLoad gate（冗余兜底 · onShow gate 是主防线）
  onLoad() {
    const { statusBarHeight, navBarHeight } = getSafeAreaMetrics();
    this.setData({
      statusBarHeight,
      navBarHeight,
      monthDisplay: formatMonthDisplay(this.data.currentMonth),
      yearDisplay: formatYearDisplay(this.data.currentYear),
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

    // 2026-06-08: 订阅 ACTIVE_FAMILY_CHANGED · 跨页面账本切换响应
    // 自身 onTapFamilyName / onConfirmCreateFamily / onTapRenameLedger / 邀请确认 等已就地刷新，
    // 事件到达时 ID 比对自然 noop；仅当外部页面（明细/统计页 onTapLedgerName）切换时才会真正响应。
    const activeFamilyChangedHandler = (payload?: unknown) => {
      const p = payload as ActiveFamilyChangedPayload | undefined;
      if (!p) return;
      if (this._familyId === p.family_id) return;
      void this._onActiveFamilyChanged();
    };
    this._activeFamilyChangedHandler = activeFamilyChangedHandler;
    eventBus.on(EventNames.ACTIVE_FAMILY_CHANGED, activeFamilyChangedHandler);

    // 画像变更后即时刷新 members 列表中当前用户的头像和昵称
    const profileUpdatedHandler = (payload?: unknown) => {
      const p = payload as ProfileUpdatedPayload | undefined;
      if (!p || !this._currentUserId) return;
      const members = this.data.members;
      const idx = members.findIndex((m) => m.userId === this._currentUserId);
      if (idx >= 0) {
        const updated = [...members];
        updated[idx] = { ...updated[idx], avatarUrl: p.avatarUrl || '', nickname: p.nickname || updated[idx].nickname };
        this.setData({ members: updated });
      }
    };
    this._profileUpdatedHandler = profileUpdatedHandler;
    eventBus.on(EventNames.PROFILE_UPDATED, profileUpdatedHandler);

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
      const hasPendingCreate = app.globalData.pendingFamilyAction === 'create';
      const preserveExistingView = this.data.ready && !!this.data.summary && !hasPendingCreate;
      this.setData(preserveExistingView ? { ready: true } : { ready: true, loading: true });
      // tabbar 自治 hidden（由 _unlocked + _panelOpen 合成）· 此处仅同步 selected 并解锁
      (this.getTabBar?.() as { markActive?: (idx: number) => void } | undefined)?.markActive?.(3);
      triggerOnPageShow('family');
      await this._loadPage({ preserveExistingView });

      // 消费跨页面 pending action（如 mine 页"创建协作账本"触发的跳转）
      if (app.globalData.pendingFamilyAction === 'create') {
        app.globalData.pendingFamilyAction = null;
        this.onCreateFamily();
      }
    });
  },

  onUnload() {
    // sync-refresh: 取消订阅 SYNC_DONE 事件（防内存泄漏）
    if (this._syncDoneHandler) {
      eventBus.off(EventNames.SYNC_DONE, this._syncDoneHandler);
      this._syncDoneHandler = null;
    }
    // 2026-06-08: 取消订阅 ACTIVE_FAMILY_CHANGED
    if (this._activeFamilyChangedHandler) {
      eventBus.off(EventNames.ACTIVE_FAMILY_CHANGED, this._activeFamilyChangedHandler);
      this._activeFamilyChangedHandler = null;
    }
    // 画像变更：取消订阅 PROFILE_UPDATED
    if (this._profileUpdatedHandler) {
      eventBus.off(EventNames.PROFILE_UPDATED, this._profileUpdatedHandler);
      this._profileUpdatedHandler = null;
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
    await this._loadSummary(this._familyId);
  },

  /**
   * 2026-06-08: 跨页面账本切换响应
   * 触发场景：明细页/统计页 onTapLedgerName 切换账本，协作页常驻在内存里。
   * 行为：等价于 _loadPage 全量刷新（重读 active context + 重拉 families + 重拉 summary）。
   */
  async _onActiveFamilyChanged() {
    this._collapseAllRows();
    await this._loadPage();
  },

  // ─── 数据加载 ────────────────────────────────────────────────────────────────

  async _loadPage(opts?: { preserveExistingView?: boolean }) {
    if (this._loadingPromise) return this._loadingPromise;

    this._loadingPromise = this._doLoadPage(opts);
    try {
      await this._loadingPromise;
    } finally {
      this._loadingPromise = null;
    }
  },

  async _doLoadPage(opts?: { preserveExistingView?: boolean }) {
    if (!opts?.preserveExistingView) {
      this.setData({ loading: true });
    }

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
        const dim = this.data.dimension;
        const value = dim === 'monthly' ? this.data.currentMonth : this.data.currentYear;
        this.setData({
          loading: false,
          mode: 'solo',
          isEmpty: true,
          emptyTitle: buildEmptyTitle(dim, value),
          emptyHint: this._pickEmptyHint(),
        });
        return;
      }

      const familyId = targetFamily.id;
      const preserveSummary = !!opts?.preserveExistingView && this._canPreserveSummaryFor(familyId);
      if (opts?.preserveExistingView && !preserveSummary) {
        this.setData({ loading: true });
      }
      this._familyId = familyId;

      // 更新 active family context（如果切换了）
      if (activeFamilyId !== familyId) {
        await setActiveFamily({
          family_id: familyId,
          ledger_id: targetFamily.ledger_id,
          family_kind: targetFamily.kind,
          ledger_name: targetFamily.ledger_name,
        }, 'preference-restore');
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
      await this._loadSummary(familyId, { preserveExistingView: preserveSummary });
    } catch (err) {
      console.error('[family] loadPage failed', err);

      // P0-2: 403 / FAMILY_NOT_MEMBER 专门处理（COSTRA-223 R1.x.1）
      const apiErr = err as ApiError;
      if (apiErr.status === 403 || apiErr.code === 'FAMILY_NOT_MEMBER') {
        if (this._familyId) {
          invalidateFamilyCache(this._familyId);
        }
        await fallbackToPersonalFamily('family-switch');
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

  _canPreserveSummaryFor(familyId: string): boolean {
    const summary = this.data.summary;
    if (!summary || summary.family_id !== familyId) return false;
    if (this.data.dimension === 'monthly') return summary.month === this.data.currentMonth;
    return summary.year === this.data.currentYear;
  },

  _summarySignature(summary: FamilySummary): string {
    return JSON.stringify({
      family_id: summary.family_id,
      month: summary.month,
      year: summary.year,
      totals: summary.totals,
      members: summary.members.map((m) => ({
        user_id: m.user_id,
        nickname: m.nickname,
        avatar_url: m.avatar_url,
        role: m.role,
        status: m.status,
        color_slot: m.color_slot,
      })),
      segments: summary.segments,
      shared: summary.shared,
      personal_by_member: summary.personal_by_member,
    });
  },

  _applySummary(summary: FamilySummary): void {
    const previous = this.data.summary;
    if (previous && this._summarySignature(previous) === this._summarySignature(summary) && !this.data.loading) {
      return;
    }
    this.setData({ summary });
    if (this.data.mode === 'solo') {
      this._buildSoloDisplay(summary);
    } else {
      this._buildMultiDisplay(summary);
    }
  },

  async _loadSummary(familyId: string, opts?: { preserveExistingView?: boolean }) {
    // scope 由当前 dimension 决定（§C4）
    const scope = this.data.dimension === 'monthly'
      ? { month: this.data.currentMonth }
      : { year: this.data.currentYear };

    // P1-2: SWR stale-first — 先取缓存立即渲染（COSTRA-223 R1.x.1）
    const cached = getCachedSummary(familyId, scope);
    if (cached) {
      this._applySummary(cached);
    } else if (!opts?.preserveExistingView) {
      this.setData({ loading: true });
    }

    try {
      const summary = await getFamilySummary(familyId, scope, { topN: L1_VISIBLE });
      this._applySummary(summary);
    } catch (err) {
      console.error('[family] loadSummary failed', err);

      // P0-2: 403 / FAMILY_NOT_MEMBER 专门处理（COSTRA-223 R1.x.1）
      const apiErr = err as ApiError;
      if (apiErr.status === 403 || apiErr.code === 'FAMILY_NOT_MEMBER') {
        invalidateFamilyCache(familyId);
        await fallbackToPersonalFamily('family-switch');
        wx.showToast({ title: '你已不在该家庭中', icon: 'none' });
        // 切回 personal family 重新加载
        this._familyId = '';
        this._loadingPromise = null;
        await this._doLoadPage();
        return;
      }

      if (opts?.preserveExistingView && this.data.summary) {
        this.setData({ loading: false });
        wx.showToast({ title: '更新失败，已保留当前数据', icon: 'none' });
        return;
      }

      // 降级展示空态
      const dim = this.data.dimension;
      const value = dim === 'monthly' ? this.data.currentMonth : this.data.currentYear;
      this.setData({
        loading: false,
        isEmpty: true,
        emptyTitle: buildEmptyTitle(dim, value),
        emptyHint: this._pickEmptyHint(),
      });
      wx.showToast({ title: '数据加载失败', icon: 'none' });
    }
  },

  // ─── Solo 态构建 ────────────────────────────────────────────────────────────

  _buildSoloDisplay(summary: FamilySummary) {
    const { totals } = summary;
    const isEmpty = totals.expense === 0 && totals.income === 0;
    const dim = this.data.dimension;
    const value = dim === 'monthly' ? this.data.currentMonth : this.data.currentYear;

    this.setData({
      soloExpense: formatCentsDisplay(totals.expense),
      soloIncome: formatCentsDisplay(totals.income),
      soloBalance: formatCentsDisplay(totals.balance),
      loading: false,
      isEmpty,
      emptyTitle: buildEmptyTitle(dim, value),
      emptyHint: isEmpty ? this._pickEmptyHint() : '',
    });
  },

  // ─── Multi 态构建 ───────────────────────────────────────────────────────────

  _buildMultiDisplay(summary: FamilySummary) {
    const { members, segments, totals } = summary;

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
    const slotByUserId = new Map<string, number | null>(
      members.map(m => [m.user_id, m.color_slot]),
    );

    const segmentDisplays: SegmentDisplay[] = [];
    const totalExpense = totals.expense;

    for (const seg of segments) {
      if (seg.amount === 0) continue;

      const color = seg.type === 'shared'
        ? SHARED_SEGMENT_COLOR
        : getMemberColorBySlot(seg.user_id ? slotByUserId.get(seg.user_id) : null);
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

    // 3. 构建下钻列表（COSTRA-302）
    const drilldownRows = this._buildDrilldownRows(summary, slotByUserId);

    const isEmpty = totalExpense === 0 && totals.income === 0;
    const dim = this.data.dimension;
    const value = dim === 'monthly' ? this.data.currentMonth : this.data.currentYear;

    this.setData({
      members: memberDisplays,
      segments: segmentDisplays,
      totalExpenseCents: totalExpense,
      drilldownRows,
      loading: false,
      isEmpty,
      emptyTitle: buildEmptyTitle(dim, value),
      emptyHint: isEmpty ? this._pickEmptyHint() : '',
      familyName: summary.family_name,
      isOwner: isCurrentUserOwner,
      canInvite: isCurrentUserOwner && activeMembers.length < maxFamilyMembers,
    });
  },

  /** 构建下钻行列表（spec §4.3 / §4.4 · COSTRA-302） */
  _buildDrilldownRows(
    summary: FamilySummary,
    slotByUserId: Map<string, number | null>,
  ): DrilldownRow[] {
    const { segments, shared, personal_by_member, members } = summary;

    // 保留旧 expanded 状态
    const oldExpandedMap = new Map<string, boolean>();
    for (const row of this.data.drilldownRows) {
      oldExpandedMap.set(row.key, row.expanded);
    }

    const rows: DrilldownRow[] = [];

    // ── 公共支出行 ──
    if (shared.expense > 0) {
      const contributions: ContributionDisplay[] = shared.paid_contributions
        .filter(c => c.amount > 0)
        .map(c => ({
          nickname: c.nickname,
          avatarUrl: c.avatar_url || '',
          amount: `¥${formatCentsToYuan(c.amount)}`,
        }));

      // ratio_bps 从 segments 取
      const sharedSeg = segments.find(s => s.key === 'shared');
      const ratioBps = sharedSeg ? sharedSeg.ratio_bps : 0;

      // L1 列表（topN=L1_VISIBLE 已让后端按上限返回，前端不再做"还有 N 项"省略 · 用户期望全显示）
      const allL1 = shared.categories
        .filter(c => c.amount > 0)
        .map(c => this._mapToL1Display(c));
      const l1Items = allL1.slice(0, L1_VISIBLE);

      rows.push({
        key: 'shared',
        type: 'shared',
        label: '公共支出',
        amount: formatCentsDisplay(shared.expense),
        amountCents: shared.expense,
        ratio_bps: ratioBps,
        ratioText: fmtRatio(ratioBps),
        color: SHARED_SEGMENT_COLOR,
        contributions,
        avatarUrl: '',
        userId: '',
        memberStatus: null,
        expanded: oldExpandedMap.get('shared') ?? false,
        l1Items,
      });
    }

    // ── 各成员个人支出行 ──
    for (const pm of personal_by_member) {
      if (pm.amount <= 0) continue;

      const key = `member:${pm.user_id}`;
      const memberInfo = members.find(m => m.user_id === pm.user_id);
      const memberSeg = segments.find(s => s.key === key);
      const ratioBps = memberSeg ? memberSeg.ratio_bps : 0;
      const colorSlot = slotByUserId.get(pm.user_id) ?? null;
      const color = getMemberColorBySlot(colorSlot);

      // 已退出成员 label 加后缀
      const statusSuffix = pm.status === 'left' ? '（已退出）' : '';
      const label = `${pm.nickname}的个人支出${statusSuffix}`;

      // L1 列表（topN=L1_VISIBLE 已让后端按上限返回 · 用户期望全显示）
      const allL1 = pm.categories
        .filter(c => c.amount > 0)
        .map(c => this._mapToL1Display(c));
      const l1Items = allL1.slice(0, L1_VISIBLE);

      rows.push({
        key,
        type: 'personal',
        label,
        amount: formatCentsDisplay(pm.amount),
        amountCents: pm.amount,
        ratio_bps: ratioBps,
        ratioText: fmtRatio(ratioBps),
        color,
        contributions: [],
        avatarUrl: pm.avatar_url || '',
        userId: pm.user_id,
        memberStatus: memberInfo?.status ?? pm.status,
        expanded: oldExpandedMap.get(key) ?? false,
        l1Items,
      });
    }

    return rows;
  },

  /** CategoryRankItem → L1Display */
  _mapToL1Display(c: CategoryRankItem): L1Display {
    return {
      category_id: c.category_id || '',
      category_name: c.category_name,
      icon: getCategoryIconById(c.category_id),
      amount: `¥${formatCentsToYuan(c.amount)}`,
      amountCents: c.amount,
      ratio_bps: c.ratio_bps,
      ratioText: fmtRatio(c.ratio_bps),
    };
  },

  // ─── 交互：时间导航统一入口（与统计页 onPrevTime/onNextTime 对齐） ────────

  onPrevTime() {
    if (this.data.dimension === 'monthly') {
      this.onPrevMonth();
    } else {
      this.onPrevYear();
    }
  },

  onNextTime() {
    if (this.data.dimension === 'monthly') {
      this.onNextMonth();
    } else {
      this.onNextYear();
    }
  },

  // ─── 交互：月份切换 ──────────────────────────────────────────────────────────

  onPrevMonth() {
    const prev = prevMonth(this.data.currentMonth);
    this.setData({
      currentMonth: prev,
      monthDisplay: formatMonthDisplay(prev),
    });
    this._shouldRefreshEmptyHint = true;
    this._collapseAllRows();
    void this._loadSummary(this._familyId);
  },

  onNextMonth() {
    const nxt = nextMonth(this.data.currentMonth);
    this.setData({
      currentMonth: nxt,
      monthDisplay: formatMonthDisplay(nxt),
    });
    this._shouldRefreshEmptyHint = true;
    this._collapseAllRows();
    void this._loadSummary(this._familyId);
  },

  /** picker mode="date" fields="month" 变更回调 */
  onMonthChange(e: WechatMiniprogram.PickerChange) {
    const value = e.detail.value as string;
    this.setData({
      currentMonth: value,
      monthDisplay: formatMonthDisplay(value),
    });
    this._shouldRefreshEmptyHint = true;
    this._collapseAllRows();
    void this._loadSummary(this._familyId);
  },

  // ─── 交互：年份切换（COSTRA-302 新增） ────────────────────────────────────────

  onPrevYear() {
    const prev = prevYear(this.data.currentYear);
    this.setData({
      currentYear: prev,
      yearDisplay: formatYearDisplay(prev),
    });
    this._shouldRefreshEmptyHint = true;
    this._collapseAllRows();
    void this._loadSummary(this._familyId);
  },

  onNextYear() {
    const nxt = nextYear(this.data.currentYear);
    this.setData({
      currentYear: nxt,
      yearDisplay: formatYearDisplay(nxt),
    });
    this._shouldRefreshEmptyHint = true;
    this._collapseAllRows();
    void this._loadSummary(this._familyId);
  },

  /** picker mode="date" fields="year" 变更回调 */
  onYearChange(e: WechatMiniprogram.PickerChange) {
    const raw = e.detail.value as string;
    // picker fields="year" 可能返回 "YYYY" 或 "YYYY-MM-DD"，统一取前 4 位
    const value = raw.split('-')[0] || raw;
    this.setData({
      currentYear: value,
      yearDisplay: formatYearDisplay(value),
    });
    this._shouldRefreshEmptyHint = true;
    this._collapseAllRows();
    void this._loadSummary(this._familyId);
  },

  /** 月度/年度切换（COSTRA-302 年度可用化 · 不再 toast 拦截） */
  onSwitchDimension(e: WechatMiniprogram.TouchEvent) {
    const dim = e.currentTarget.dataset.dim as 'monthly' | 'yearly';
    if (dim === this.data.dimension) return;
    this.setData({ dimension: dim });
    this._shouldRefreshEmptyHint = true;
    this._collapseAllRows();
    void this._loadSummary(this._familyId);
  },

  // ─── 交互：下钻行 展开/收起（多行可同时展开 · 与设计 §4.5 对齐） ──────────

  /** 仅切换被点击行的 expanded，不影响其他行（用户期望多个下钻列表可同时打开） */
  onTapDrilldownRow(e: WechatMiniprogram.TouchEvent) {
    const key = e.currentTarget.dataset.key as string;
    if (!key) return;
    const idx = this.data.drilldownRows.findIndex(r => r.key === key);
    if (idx < 0) return;
    // 仅写被点击行的 expanded 字段：避免整列 read-modify-write 触发整张排行重渲染（与统计页 A1 一致）
    this.setData({ [`drilldownRows[${idx}].expanded`]: !this.data.drilldownRows[idx].expanded });
  },

  /** L1 子项点击：公共行不响应，成员行 switchTab 到统计页（COSTRA-302 · spec §4.5.1） */
  onTapL1(e: WechatMiniprogram.TouchEvent) {
    const { rowkey, l1id } = e.currentTarget.dataset as Record<string, string>;
    if (!rowkey || !l1id) return;
    const row = this.data.drilldownRows.find(r => r.key === rowkey);
    if (!row) return;
    if (row.type === 'shared') return;  // 公共支出 L1 不下钻

    // 成员行 → 写 globalData + switchTab
    const app = getApp<AppWithBootstrap>();
    app.globalData.pendingStatisticsAction = {
      memberKey: row.userId,
      dimension: this.data.dimension,
      month: this.data.dimension === 'monthly' ? this.data.currentMonth : undefined,
      year: this.data.dimension === 'yearly' ? this.data.currentYear : undefined,
      expandL1Id: l1id,
    };
    wx.switchTab({ url: '/pages/statistics/index' });
  },

  /** 折叠所有行（时间切换 / 账本切换时使用） */
  _collapseAllRows() {
    // 仅写当前处于展开态的行，避免整列重写；无展开行时直接跳过 setData
    const update: Record<string, boolean> = {};
    this.data.drilldownRows.forEach((r, idx) => {
      if (r.expanded) update[`drilldownRows[${idx}].expanded`] = false;
    });
    if (Object.keys(update).length > 0) this.setData(update);
  },

  /** 挑选空态格言：切月/年/账本后换一条，避免重复 */
  _pickEmptyHint(): string {
    const hint = this._shouldRefreshEmptyHint
      ? pickRandomSlogan(this.data.emptyHint)
      : (this.data.emptyHint || pickRandomSlogan());
    this._shouldRefreshEmptyHint = false;
    return hint;
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
  //
  // 三分支（COSTRA-230 · D-029 §3.1）：
  //   1. 已 left 成员 / 非 owner 点击他人 → 无响应
  //   2. owner 点击他人头像 → ActionSheet[移出家庭] → wx.showModal 二次确认
  //   3. 任意角色点击自己头像 → ActionSheet[离开家庭] → wx.showModal 二次确认
  //      · owner 单人 → 文案"解散账本"语义（后端走 dissolve 分支）
  //      · owner 多人 → 文案"离开家庭"，会自动移交所有权
  //      · 非 owner → 文案"离开家庭"

  onTapMember(e: WechatMiniprogram.TouchEvent) {
    const { userid, status } = e.currentTarget.dataset;

    // 已退出成员：点击无响应
    if (status === 'left') return;

    const isSelf = userid === this._currentUserId;

    // 自己：所有角色都可触发"离开/解散"
    if (isSelf) {
      this._showSelfActionSheet();
      return;
    }

    // 他人：只有 owner 能管理
    if (!this.data.isOwner) return;

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

  /** 自己头像 ActionSheet：owner 显示管理选项 + 退出/解散；非 owner 仅退出 */
  _showSelfActionSheet() {
    const activeMembers = this.data.members.filter(m => m.status === 'active');
    const isLoneOwner = this.data.isOwner && activeMembers.length === 1;

    // 构建选项
    const items: string[] = [];
    if (this.data.isOwner) {
      items.push('重命名账本');
    }
    if (isLoneOwner) {
      items.push('解散账本');
    } else {
      items.push('退出账本');
      if (this.data.isOwner) {
        items.push('解散账本');
      }
    }

    wx.showActionSheet({
      itemList: items,
      success: (res) => {
        const selected = items[res.tapIndex];
        if (selected === '重命名账本') {
          this.onTapRenameLedger();
        } else if (selected === '解散账本') {
          this._confirmDissolveFamily();
        } else if (selected === '退出账本') {
          this._confirmLeaveSelf();
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
          await this._loadSummary(this._familyId);
        } catch (err) {
          console.error('[family] removeMember failed', err);
          wx.showToast({ title: '移出失败', icon: 'none' });
        }
      },
    });
  },

  /**
   * 当前用户离开家庭（非 owner / owner 多人均走此分支）
   * 后端会按角色自动选择 setLeftAt 或 transferOwnership + setLeftAt
   */
  _confirmLeaveSelf() {
    const isOwner = this.data.isOwner;
    const content = isOwner
      ? '退出后管理员身份会自动移交给最早加入的成员，确认退出？'
      : '退出后将无法再访问该账本数据，确认退出？';

    wx.showModal({
      title: '',
      content,
      confirmColor: '#FA5151',
      success: async (res) => {
        if (!res.confirm) return;
        try {
          await leaveFamily(this._familyId);
          // 用 showModal 明确告知用户切回个人账本，避免突兀跳转
          wx.showModal({
            title: '已退出账本',
            content: '将为你切换到个人账本',
            showCancel: false,
            confirmText: '好的',
            success: async () => {
              await this._fallbackToPersonalAndExit();
            },
          });
        } catch (err) {
          console.error('[family] leaveFamily failed', err);
          const mapped = mapError(err as ApiError);
          wx.showToast({ title: mapped.desc || '退出失败', icon: 'none' });
        }
      },
    });
  },

  /**
   * owner 解散账本（调用 DELETE /families/{id}?version=X）
   * 后端会单事务内将所有成员 left_at=now + family softDelete
   */
  _confirmDissolveFamily() {
    wx.showModal({
      title: '',
      content: '解散后账本及所有数据将无法恢复，确认解散？',
      confirmColor: '#FA5151',
      success: async (res) => {
        if (!res.confirm) return;
        try {
          const family = this.data.familyList.find(f => f.id === this._familyId);
          if (!family) {
            wx.showToast({ title: '账本数据异常，请重试', icon: 'none' });
            return;
          }
          await dissolveFamily(this._familyId, family.version);
          wx.showToast({ title: '已解散', icon: 'success' });
          await this._fallbackToPersonalAndExit();
        } catch (err) {
          console.error('[family] dissolveFamily failed', err);
          const mapped = mapError(err as ApiError);
          wx.showToast({ title: mapped.desc || '解散失败', icon: 'none' });
        }
      },
    });
  },

  /**
   * 离开 / 解散后回到 personal family
   * 复用 _doLoadPage 的 fallback 模式（清 active + 重置内部状态 + 重新加载）
   * 注意：项目模式无 LEDGER_SWITCHED 事件，依赖目标页 onShow 自然读 active context
   */
  async _fallbackToPersonalAndExit() {
    if (this._familyId) {
      invalidateFamilyCache(this._familyId);
    }
    await fallbackToPersonalFamily('family-switch');
    this._familyId = '';
    this._loadingPromise = null;
    await this._loadPage();
  },

  // ─── 交互：重命名账本（COSTRA-230） ──────────────────────────────────────
  //
  // 仅 owner 可触发。视觉与"创建协作账本"完全镜像（invite-dialog__* token）。

  onTapRenameLedger() {
    if (!this.data.isOwner) {
      wx.showToast({ title: '仅创建者可重命名', icon: 'none' });
      return;
    }
    this.setData({
      renameOverlayVisible: true,
      renameInput: this.data.familyName,
      renameLoading: false,
      renameError: '',
    });
  },

  onRenameFamilyInput(e: WechatMiniprogram.Input) {
    this.setData({ renameInput: e.detail.value, renameError: '' });
  },

  onCancelRenameFamily() {
    if (this.data.renameLoading) return;
    this.setData({ renameOverlayVisible: false });
  },

  async onConfirmRenameFamily() {
    if (this.data.renameLoading) return;
    const name = this.data.renameInput.replace(/[\r\n]/g, '').trim();
    if (!name) {
      this.setData({ renameError: '请输入账本名称' });
      return;
    }
    if (name.length > 20) {
      this.setData({ renameError: '名称最多 20 个字' });
      return;
    }
    if (name === this.data.familyName) {
      // 无变化直接关弹窗，避免一次无意义的乐观锁版本递增
      this.setData({ renameOverlayVisible: false });
      return;
    }

    // 找当前 family 的 version（来自 familyList，从后端 GET /families 返回）
    const family = this.data.familyList.find(f => f.id === this._familyId);
    if (!family) {
      this.setData({ renameError: '账本数据异常，请重试' });
      return;
    }

    this.setData({ renameLoading: true, renameError: '' });
    try {
      const updated = await renameFamily(this._familyId, name, family.version);
      // 更新内存中的 familyList（含 version 递增） + familyName
      const newList = this.data.familyList.map(f => (f.id === updated.id ? { ...f, name: updated.name, ledger_name: updated.ledger_name, version: updated.version } : f));
      this.setData({
        familyList: newList,
        familyName: name,
        renameOverlayVisible: false,
        renameLoading: false,
      });
      // 同步更新 storage 中的 ledger_name，让明细页/统计页 onShow 即刻读到新名称
      const [ledgerId, familyKind] = await Promise.all([
        getActiveLedgerId(),
        getActiveFamilyKind(),
      ]);
      if (ledgerId && familyKind) {
        await setActiveFamily({
          family_id: this._familyId,
          ledger_id: ledgerId,
          family_kind: familyKind,
          ledger_name: updated.ledger_name || name,
        }, 'family-rename');
      }
      // 失效缓存确保统计/明细页拉到新名称
      invalidateFamilyCache(this._familyId);
      wx.showToast({ title: '已修改', icon: 'success' });
    } catch (err) {
      console.error('[family] renameFamily failed', err);
      const apiErr = err as ApiError;
      // VERSION_CONFLICT：本地 version 过期，静默刷新后自动重试一次
      if (apiErr.code === 'VERSION_CONFLICT') {
        try {
          await this._loadPage();
          const refreshed = this.data.familyList.find(f => f.id === this._familyId);
          if (refreshed) {
            const retried = await renameFamily(this._familyId, name, refreshed.version);
            const newList = this.data.familyList.map(f => (f.id === retried.id ? { ...f, name: retried.name, ledger_name: retried.ledger_name, version: retried.version } : f));
            this.setData({ familyList: newList, familyName: name, renameOverlayVisible: false, renameLoading: false });
            // 同步更新 storage 中的 ledger_name
            const [ledgerId2, familyKind2] = await Promise.all([
              getActiveLedgerId(),
              getActiveFamilyKind(),
            ]);
            if (ledgerId2 && familyKind2) {
              await setActiveFamily({
                family_id: this._familyId,
                ledger_id: ledgerId2,
                family_kind: familyKind2,
                ledger_name: retried.ledger_name || name,
              }, 'family-rename');
            }
            invalidateFamilyCache(this._familyId);
            wx.showToast({ title: '已修改', icon: 'success' });
            return;
          }
        } catch { /* 重试也失败，走下方兜底 */ }
      }
      const mapped = mapError(apiErr);
      this.setData({
        renameLoading: false,
        renameError: mapped.desc || '修改失败，请重试',
      });
    }
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
      await switchActiveFamily({
        family_id: newFamily.id,
        ledger_id: newFamily.ledger_id,
        family_kind: 'shared',
        ledger_name: newFamily.ledger_name || newFamily.name,
      }, 'family-create');
      this.setData({ createOverlayVisible: false, createFamilyLoading: false });
      wx.showToast({ title: '创建成功', icon: 'success' });
      await this._loadPage();
    } catch (err) {
      console.error('[family] createFamily failed', err);
      this.setData({ createFamilyLoading: false, createFamilyError: '创建失败，请重试' });
    }
  },

  // ─── 交互：账本切换（P2-4: 复用明细页账本切换模式） ──────────────────────
  //
  // 重命名入口已移至 owner 点自己头像的 ActionSheet 中（_showSelfActionSheet）。
  // 此处仅负责切换账本。

  onTapFamilyName() {
    const families = this.data.familyList;
    const switchable = families && families.length > 1;

    if (!switchable) {
      wx.showToast({ title: '当前只有一个账本', icon: 'none' });
      return;
    }

    // 构建 itemList：列出所有账本
    const items: string[] = [];
    for (const f of families) {
      const suffix = f.kind === 'personal' ? '（个人）' : `（${f.member_count}人）`;
      items.push(f.name + suffix);
    }

    wx.showActionSheet({
      itemList: items,
      success: async (res) => {
        const selected = families[res.tapIndex];
        if (selected.id === this._familyId) return;

        // 统一切换 active family context + 可靠持久化服务端偏好
        await switchActiveFamily({
          family_id: selected.id,
          ledger_id: selected.ledger_id,
          family_kind: selected.kind,
          ledger_name: selected.ledger_name || selected.name,
        }, 'family-switch');

        this._familyId = selected.id;
        this.setData({
          familyId: selected.id,
          familyName: selected.name,
          familyKind: selected.kind,
          isOwner: selected.role === 'owner',
          mode: selected.kind === 'shared' ? 'multi' : 'solo',
        });
        this._collapseAllRows();

        // 切换家庭后重新加载
        await this._loadSummary(selected.id);
      },
    });
  },
});
