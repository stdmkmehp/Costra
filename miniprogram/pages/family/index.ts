// pages/family/index.ts · 家庭页（Tab4）
// 卡号: COSTRA-302 · 协作页 multi 模式重构（统计页同款手风琴 + 年度可用 + L1 跳转）
// 设计源: docs/design/family-page-tech-spec.md §4 + design/ui/design_spec.md §6.5
// 金额 ADR-0002: 全部走 decimal.js（utils/money.ts）
// COSTRA-125 范式: onLoad + onShow 均加 bootstrapPromise gate，与 mine/ledger/statistics 对齐
// Refs: COSTRA-302

import { toYuan } from '../../utils/money';
import { getSafeAreaMetrics, rpxToPx } from '../../utils/safeArea';
import { scheduleDeferredLoading, type DeferredLoadingHandle } from '../../utils/deferredLoading';
import { resolveEntryDisplayNote } from '../../utils/entryDisplay';
import { computeBadges } from '../../utils/entryBadges';
import { getCategoryIconById } from '../../services/categoryService';
import { getMemberColorByChoice, MEMBER_COLOR_SLOTS } from '../../utils/memberColor';
import { buildMemberMenuItems, type MemberMenuItem } from './memberMenu';
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
  updateMyColorChoice,
  invalidateFamilyCache,
  drillDownFamilyL1Entries,
  type FamilyItem,
  type FamilySummary,
  type CategoryRankItem,
  type FamilyEntryDetailItem,
} from '../../services/familyApi';
import type { ApiError } from '../../services/request';
import { mapError } from '../../utils/error-mapper';
import { logger } from '../../utils/logger';
import { buildAppShareContent, buildInviteShareContent } from '../../utils/share';
import { dispatchFamilyShare } from './shareDispatch';

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

/** 换色弹层选项项 */
interface ColorPickerOption {
  index: number;
  hex: string;
  selected: boolean;
  /** 该颜色被其他 active 成员使用时的头像信息（撞色暗示） */
  usedByOthers: Array<{ userId: string; avatarUrl: string; nickname: string }>;
  /** 折叠数：usedByOthers.length > 2 时展示 "+N" */
  extraCount: number;
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

/** L1 一级分类展示项（spec §4.3 · COSTRA-305 扩展三级下钻字段） */
interface L1Display {
  category_id: string;
  category_name: string;
  icon: string;
  amount: string;         // '¥xxx.xx'
  amountCents: number;
  ratio_bps: number;
  ratioText: string;
  // COSTRA-305: 三级下钻
  expanded: boolean;
  loadingEntries: boolean;
  entries: EntryRow[];
  entriesLoaded: boolean;
  entriesHasMore: boolean;
}

/** 三级流水明细行（对齐统计页 L3Display） */
interface EntryRow {
  entry_id: string;
  amount: string;           // '¥xxx.xx'
  note: string;
  dateLabel: string;        // '6月24日'
  timeLabel: string;        // '14:30'
  isShared: boolean;
  isRecurring: boolean;
  nickname: string;
  avatarUrl: string;
  initial: string;          // nickname 首字符
}

/** 三级下钻可见条数上限（与统计页 L3 一致 · limit=VISIBLE+1 探测溢出） */
const L1_ENTRIES_VISIBLE = 5;

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

// MEMBER_COLOR_SLOTS + getMemberColorByChoice 已迁移到 utils/memberColor.ts（唯一事实源 · COSTRA-261）

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

/** ISO UTC → M月D日 (Asia/Shanghai) */
function formatEntryDate(isoUtc: string): string {
  const utc = new Date(isoUtc);
  const sh = new Date(utc.getTime() + 8 * 60 * 60 * 1000);
  return `${sh.getUTCMonth() + 1}月${sh.getUTCDate()}日`;
}

/** ISO UTC → HH:mm (Asia/Shanghai · 24 小时制) */
function formatEntryTime(isoUtc: string): string {
  const utc = new Date(isoUtc);
  const sh = new Date(utc.getTime() + 8 * 60 * 60 * 1000);
  return `${String(sh.getUTCHours()).padStart(2, '0')}:${String(sh.getUTCMinutes()).padStart(2, '0')}`;
}

/** Segmented Bar 公共段颜色 · 莫兰迪石青（与成员色板协调） */
const SHARED_SEGMENT_COLOR = '#6B9B8F';

// ─── Page ─────────────────────────────────────────────────────────────────────────

Page({
  data: {
    // ─── 首屏保护 ───
    /** bootstrap 完成且已登录后才设为 true · 防止页面框架提前渲染 */
    ready: false,
    /** 至少完成一次真实 summary/空态结算后才渲染业务内容，避免 ready=true 后默认假内容闪屏 */
    contentReady: false,

    // ─── 导航栏 ───
    statusBarHeight: 0,
    navBarHeight: 44,
    /** 内容底部留白：固定 TabBar 空间 + 底部视觉安全区 */
    contentBottomPadding: 0,

    // ─── 模式 ───
    mode: 'solo' as 'solo' | 'multi',

    // ─── 家庭信息 ───
    familyId: '',
    familyName: '个人账本',
    familyKind: 'personal' as FamilyKind,
    isOwner: false,
    canInvite: false,
    /**
     * 顶部 "+" 邀请按钮呼吸光环引导（方案 B）
     * 触发条件：multi 态 + 有邀请权限（owner 且未满员）+ 账本只有自己一位活跃成员。
     * 目的：让刚创建协作账本的用户注意到成员区的邀请入口；成员≥2 后自然消失，无引导专属存储。
     */
    hintInvite: false,
    currentUserId: '',

    // ─── 家庭列表（多家庭切换用） ───
    familyList: [] as FamilyItem[],

    // ─── 成员 ───
    members: [] as MemberDisplay[],

    // ─── 时间维度 ───
    currentMonth: getCurrentMonthValue(),
    currentYear: getCurrentYearValue(),
    isCurrentMonth: true,
    isCurrentYear: true,
    monthDisplay: '',
    yearDisplay: '',
    dimension: 'monthly' as 'monthly' | 'yearly',

    // ─── 摘要数据 ───
    // COSTRA-304：默认 false。冷启动 ready=false 期间 wxml 整体不渲染（外层 wx:if="{{ready}}"），
    // ready=true 后由 _doLoadPage 内部 _deferLoading() 决定 275ms 内是否需要翻 loading。
    loading: false,
    summary: null as FamilySummary | null,

    // ─── Solo 态摘要 ───
    soloExpense: '¥0.00',
    soloIncome: '¥0.00',
    soloBalance: '¥0.00',

    // ─── Segmented Bar ───
    segments: [] as SegmentDisplay[],
    totalExpenseCents: 0,
    totalExpenseDisplay: '',

    // ─── 下钻列表（COSTRA-302 重构 · spec §4.3） ───
    drilldownRows: [] as DrilldownRow[],

    // ─── 收入维度（与支出侧对称 · 上下并列渲染） ───
    incomeSegments: [] as SegmentDisplay[],
    totalIncomeCents: 0,
    totalIncomeDisplay: '',
    incomeDrilldownRows: [] as DrilldownRow[],

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

    // ─── 成员头像锚定气泡菜单（替代原生 showActionSheet · 对齐明细页 ctx-menu 视觉语言） ───
    memberMenuVisible: false,
    /** 气泡左上角定位（px · 由 JS 按头像 boundingClientRect 计算） */
    memberMenuLeft: 0,
    memberMenuTop: 0,
    /** 顶部小三角相对气泡左边的偏移（px · 始终指向头像中心） */
    memberMenuArrowLeft: 0,
    /** 气泡内选项：{ key, label, danger } */
    memberMenuItems: [] as MemberMenuItem[],
    /** 当前高亮的头像 userId（暖光环 · 复用明细页 ctxActiveRefId 语义） */
    activeMemberUserId: '',

    // ─── 换颜色弹层（migration 0017 · 底部 sheet · 8 色预设 + 撞色头像暗示） ───
    colorPickerVisible: false,
    /** 8 色选项列表：{ index, hex, selected, usedByOthers: [{userId, avatarUrl, nickname}] } */
    colorPickerOptions: [] as ColorPickerOption[],
    /** 换色请求进行中（防重复提交） */
    colorPickerLoading: false,
  },

  // 内部状态
  _familyId: '' as string,
  _currentUserId: '' as string,
  /** 成员气泡菜单当前操作对象 userId（移出成员时需要） */
  _memberMenuUserId: '' as string,
  _loadingPromise: null as Promise<void> | null,
  /** P2-2: summary 刷新合并句柄——同一刷新进行中复用，避免 ENTRY_SAVED + SYNC_DONE 连击重复拉取 */
  _syncRefreshPromise: null as Promise<void> | null,
  /**
   * 页级 loading 的 deferred handle（COSTRA-304 防闪烁）。
   * 切月/切年/切账本等"无法保留旧视图"的场景下，loading 不立即翻 true，
   * 等 LOADING_DELAY_MS 仍未拿到数据再显示。settle 路径必须 cancel。
   */
  _loadingDeferredHandle: null as DeferredLoadingHandle | null,
  _pendingInviteId: '' as string,
  _pendingInviteToken: '' as string,
  _pendingInviteFamilyId: '' as string,
  _pendingInviteShared: false,
  _invitePrepareSeq: 0,
  /** 空态格言刷新标记（切月/年/账本后下次空态换一条格言） */
  _shouldRefreshEmptyHint: false,
  /** eventBus 订阅 handler（sync-refresh: SYNC_DONE 后失效缓存 + 重拉 summary，防内存泄漏） */
  _syncDoneHandler: null as ((payload?: unknown) => void) | null,
  /** eventBus 订阅 handler（记账保存 / 条目编辑后即时刷新 · 对齐统计页，不必等一次完整同步） */
  _entrySavedHandler: null as (() => void) | null,
  _entryUpdatedHandler: null as (() => void) | null,
  /** eventBus 订阅 handler（2026-06-08: 跨页面账本切换响应） */
  _activeFamilyChangedHandler: null as ((payload?: unknown) => void) | null,
  /** eventBus 订阅 handler（画像变更后即时刷新成员列表中当前用户头像） */
  _profileUpdatedHandler: null as ((payload?: unknown) => void) | null,

  // ─── 生命周期 ────────────────────────────────────────────────────────────────

  _refreshSafeAreaLayout(force = false) {
    const { statusBarHeight, navBarHeight, windowWidth, visualSafeAreaBottom } = getSafeAreaMetrics({ force });
    this.setData({
      statusBarHeight,
      navBarHeight,
      contentBottomPadding: Math.round(rpxToPx(150, windowWidth) + visualSafeAreaBottom),
    });
  },

  // onLoad gate（冗余兜底 · onShow gate 是主防线）
  onLoad() {
    this._refreshSafeAreaLayout();
    this.setData({
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

    // 记账保存 / 条目编辑后即时刷新（对齐统计页 · 不必等一次完整同步）
    // family 页数据来自服务端聚合，记账写入后本机上行 + 服务端聚合已变，需重调 API；
    // _onSyncDone 内已 guard（_familyId 为空 / 正在加载）并走 preserveExistingView 防闪。
    const entrySavedHandler = () => { void this._onSyncDone(); };
    this._entrySavedHandler = entrySavedHandler;
    eventBus.on(EventNames.ENTRY_SAVED, entrySavedHandler);

    const entryUpdatedHandler = () => { void this._onSyncDone(); };
    this._entryUpdatedHandler = entryUpdatedHandler;
    eventBus.on(EventNames.ENTRY_UPDATED, entryUpdatedHandler);

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
      // COSTRA-304：仅写 ready 同步标志；loading 交由 _doLoadPage 内部按需 deferred 显示，
      // 避免首次切到协作 Tab 立即闪一下"加载中"（数据快路径直接命中 SWR 缓存或 275ms 内拿到）。
      this.setData({ ready: true });
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

  onResize() {
    this._refreshSafeAreaLayout(true);
  },

  onUnload() {
    // sync-refresh: 取消订阅 SYNC_DONE 事件（防内存泄漏）
    if (this._syncDoneHandler) {
      eventBus.off(EventNames.SYNC_DONE, this._syncDoneHandler);
      this._syncDoneHandler = null;
    }
    // 取消订阅 ENTRY_SAVED / ENTRY_UPDATED（记账/编辑即时刷新）
    if (this._entrySavedHandler) {
      eventBus.off(EventNames.ENTRY_SAVED, this._entrySavedHandler);
      this._entrySavedHandler = null;
    }
    if (this._entryUpdatedHandler) {
      eventBus.off(EventNames.ENTRY_UPDATED, this._entryUpdatedHandler);
      this._entryUpdatedHandler = null;
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
    // INV-2：onUnload 路径必须 cancel in-flight deferred handle，避免页销毁后 setData 报错
    if (this._loadingDeferredHandle) {
      this._loadingDeferredHandle.cancel();
      this._loadingDeferredHandle = null;
    }
  },

  // ─── Deferred loading 工具方法（COSTRA-304） ──────────────────────────────

  /**
   * 启动一次"页级 loading"延迟显示。
   *
   * 调用语义：声明"接下来要发起一次有可能耗时的加载，先不要显示加载中"。
   * - 数据在 LOADING_DELAY_MS 内通过 _settleLoading 回到 → loading 文案永不显示，
   *   原视图保留至新数据替换。
   * - 超时仍未 settle → 到点后翻 loading:true 显示加载中。
   *
   * 重入安全：若已有 in-flight handle，复用原计时，不重新起 275ms 窗口，避免前置请求耗时叠加后反馈过晚。
   */
  _deferLoading(opts?: { hideContent?: boolean }): void {
    if (opts?.hideContent && this.data.contentReady) {
      this.setData({ contentReady: false });
    }
    if (this._loadingDeferredHandle) return;
    this._loadingDeferredHandle = scheduleDeferredLoading(() => {
      // INV-3 自校验：若 loading 已为 true（其他路径已翻起），无需重复 setData
      if (this.data.loading) return;
      this.setData({ loading: true });
    });
  },

  /**
   * 结算页级 loading（数据到达 / 失败 / 切回 personal 等终态场景）。
   *
   * - cancel deferred handle（INV-2），防止后续 fire 误翻 loading；
   * - 仅当 fired（timer 已到点，loading 可能显示过）或当前 loading 仍为 true（其他路径翻起的），
   *   才写 loading:false。否则不写 loading 字段，让 "loading 从未显示过"。
   * - 调用方可传 extra payload 与 loading:false 合并写入，省一次 setData。
   */
  _settleLoading(extra?: Record<string, unknown>): void {
    const handle = this._loadingDeferredHandle;
    let needWriteFalse = false;
    if (handle) {
      handle.cancel();
      needWriteFalse = handle.fired;
      this._loadingDeferredHandle = null;
    }
    // 兜底：若当前 loading 仍为 true（外部路径翻起的），也要关闭
    if (!needWriteFalse && this.data.loading) needWriteFalse = true;
    if (needWriteFalse) {
      this.setData({ ...(extra || {}), loading: false });
    } else if (extra && Object.keys(extra).length > 0) {
      this.setData(extra);
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
    // P2-2: 合并并发刷新——同一 summary 刷新进行中则复用在途 promise，
    // 避免「ENTRY_SAVED/ENTRY_UPDATED + 紧随的 SYNC_DONE」连击导致重复 invalidate + 重复拉 summary + 重复 _refreshExpandedL1Entries。
    if (this._syncRefreshPromise) return this._syncRefreshPromise;
    invalidateFamilyCache(this._familyId);
    this._syncRefreshPromise = this._loadSummary(this._familyId, { preserveExistingView: this.data.contentReady && !!this.data.summary });
    try {
      await this._syncRefreshPromise;
    } finally {
      this._syncRefreshPromise = null;
    }
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
      // COSTRA-304：不立即翻 loading:true，等 LOADING_DELAY_MS 仍未拿到数据再显示。
      // 首屏/切账本等无法证明旧内容仍匹配当前 scope 的路径，先隐藏业务内容，避免默认假内容或旧账本内容闪屏。
      this._deferLoading({ hideContent: true });
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
        this._settleLoading({
          mode: 'solo',
          contentReady: true,
          isEmpty: true,
          emptyTitle: buildEmptyTitle(dim, value),
          emptyHint: this._pickEmptyHint(),
        });
        return;
      }

      const familyId = targetFamily.id;
      const preserveSummary = !!opts?.preserveExistingView && this._canPreserveSummaryFor(familyId);
      if (opts?.preserveExistingView && !preserveSummary) {
        // 即便外层声明了 preserveExistingView，但目标 family / scope 已变化无法保留旧 summary →
        // 隐藏旧内容后退化到 deferred loading 路径，避免旧账本/旧月份内容与新标题短暂错配。
        this._deferLoading({ hideContent: true });
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

      // owner 判定统一走 owner_id === 当前用户（列表接口不下发 role 字段）。
      // 与 _buildMultiDisplay 的成员级判定一致，避免切页后 summary 签名未变跳过 _buildMultiDisplay
      // 时 isOwner 停留在错误值（旧实现读 targetFamily.role 恒为 undefined → 恒 false）。
      const currentUserId = this._currentUserId || this._syncCurrentUserIdFromToken();
      this.setData({
        mode,
        familyId,
        familyName: mode === 'solo' ? (targetFamily.ledger_name || '个人账本') : targetFamily.name,
        familyKind: targetFamily.kind,
        familyList: families,
        isOwner: !!currentUserId && targetFamily.owner_id === currentUserId,
      });

      // 5. 加载 summary 数据
      await this._loadSummary(familyId, { preserveExistingView: preserveSummary });
    } catch (err) {
      logger.error('family', 'loadPage failed', err);

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

      this._settleLoading();
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
        seat_order: m.seat_order,
        color_choice: m.color_choice,
      })),
      segments: summary.segments,
      shared: summary.shared,
      personal_by_member: summary.personal_by_member,
      income_segments: summary.income_segments,
      income_by_member: summary.income_by_member,
    });
  },

  _applySummary(summary: FamilySummary): void {
    const previous = this.data.summary;
    if (previous && this._summarySignature(previous) === this._summarySignature(summary) && !this.data.loading) {
      // 视图无需更新；但仍需 settle 任何 in-flight deferred handle，
      // 否则 275ms 后会误翻 loading（INV-2）。若内容 gate 此前被隐藏，也要恢复展示。
      this._settleLoading(this.data.contentReady ? undefined : { contentReady: true });
      return;
    }
    this.setData({ summary });
    if (this.data.mode === 'solo') {
      this._buildSoloDisplay(summary);
    } else {
      this._buildMultiDisplay(summary);
    }
  },

  async _loadSummary(familyId: string, opts?: { preserveExistingView?: boolean; hideContentWhileLoading?: boolean }) {
    // scope 由当前 dimension 决定（§C4）
    const scope = this.data.dimension === 'monthly'
      ? { month: this.data.currentMonth }
      : { year: this.data.currentYear };

    // P1-2: SWR stale-first — 先取缓存立即渲染（COSTRA-223 R1.x.1）
    const cached = getCachedSummary(familyId, scope);
    if (cached) {
      this._applySummary(cached);
    } else if (!opts?.preserveExistingView) {
      // COSTRA-304：不立即翻 loading，等 LOADING_DELAY_MS 仍未拿到数据再显示
      this._deferLoading({ hideContent: !!opts?.hideContentWhileLoading });
    }

    try {
      const summary = await getFamilySummary(familyId, scope, { topN: L1_VISIBLE });
      this._applySummary(summary);
    } catch (err) {
      logger.error('family', 'loadSummary failed', err);

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
        this._settleLoading();
        wx.showToast({ title: '更新失败，已保留当前数据', icon: 'none' });
        return;
      }

      // 降级展示空态
      const dim = this.data.dimension;
      const value = dim === 'monthly' ? this.data.currentMonth : this.data.currentYear;
      this._settleLoading({
        contentReady: true,
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

    this._settleLoading({
      contentReady: true,
      soloExpense: formatCentsDisplay(totals.expense),
      soloIncome: formatCentsDisplay(totals.income),
      soloBalance: formatCentsDisplay(totals.balance),
      isEmpty,
      emptyTitle: buildEmptyTitle(dim, value),
      emptyHint: isEmpty ? this._pickEmptyHint() : '',
      // solo 态没有 "+" 按钮，主动关闭引导态保持 data 与视图自洽
      hintInvite: false,
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
    const choiceByUserId = new Map<string, number | null>(
      members.map(m => [m.user_id, m.color_choice]),
    );

    const segmentDisplays: SegmentDisplay[] = [];
    const totalExpense = totals.expense;

    for (const seg of segments) {
      if (seg.amount === 0) continue;

      const color = seg.type === 'shared'
        ? SHARED_SEGMENT_COLOR
        : getMemberColorByChoice(seg.user_id ? choiceByUserId.get(seg.user_id) : null);
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
    const drilldownRows = this._buildDrilldownRows(summary, choiceByUserId);

    // 3b. 构建收入维度的 segments + 下钻列表
    const incomeSegmentDisplays = this._buildIncomeSegments(summary, choiceByUserId);
    const incomeDrilldownRows = this._buildIncomeDrilldownRows(summary, choiceByUserId);

    const isEmpty = totalExpense === 0 && totals.income === 0;
    const dim = this.data.dimension;
    const value = dim === 'monthly' ? this.data.currentMonth : this.data.currentYear;
    const canInvite = isCurrentUserOwner && activeMembers.length < maxFamilyMembers;
    // 方案 B：仅当只有自己一位活跃成员且能发起邀请时，才对 "+" 按钮做呼吸光环引导。
    // 成员≥2 后自然为 false，无需任何清理逻辑或本地引导标记。
    const hintInvite = canInvite && activeMembers.length === 1;

    this._settleLoading({
      contentReady: true,
      members: memberDisplays,
      segments: segmentDisplays,
      totalExpenseCents: totalExpense,
      totalExpenseDisplay: formatCentsDisplay(totalExpense),
      drilldownRows,
      incomeSegments: incomeSegmentDisplays,
      totalIncomeCents: totals.income,
      totalIncomeDisplay: formatCentsDisplay(totals.income),
      incomeDrilldownRows,
      isEmpty,
      emptyTitle: buildEmptyTitle(dim, value),
      emptyHint: isEmpty ? this._pickEmptyHint() : '',
      familyName: summary.family_name,
      isOwner: isCurrentUserOwner,
      canInvite,
      hintInvite,
    });

    // COSTRA-305：数据变更后 summary 重建时，_buildDrilldownRows 保留了已展开 L1 的旧 entries
    // （视觉连续性）；此处对这些节点后台静默重拉，使三级明细同步到最新数据。
    this._refreshExpandedL1Entries(drilldownRows);
    // 收入侧同样静默重拉已展开节点
    this._refreshExpandedIncomeL1Entries(incomeDrilldownRows);
  },

  /** 构建收入 Segmented Bar 展示段（仅成员段 · 无 shared 段 · ratio 分母 = totals.income） */
  _buildIncomeSegments(
    summary: FamilySummary,
    choiceByUserId: Map<string, number | null>,
  ): SegmentDisplay[] {
    const displays: SegmentDisplay[] = [];

    for (const seg of summary.income_segments) {
      if (seg.amount === 0) continue;
      const color = getMemberColorByChoice(seg.user_id ? choiceByUserId.get(seg.user_id) : null);
      displays.push({
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
    return displays;
  },

  /** 构建收入下钻行列表（仅 amount > 0 的成员 · 无 shared 行 · L1 折叠同支出侧） */
  _buildIncomeDrilldownRows(
    summary: FamilySummary,
    choiceByUserId: Map<string, number | null>,
  ): DrilldownRow[] {
    const { income_by_member, members } = summary;

    // 保留旧 expanded 状态（行级）
    const oldExpandedMap = new Map<string, boolean>();
    const oldL1Map = new Map<string, L1Display>();
    for (const row of this.data.incomeDrilldownRows) {
      oldExpandedMap.set(row.key, row.expanded);
      for (const l1 of row.l1Items) {
        oldL1Map.set(`${row.key}:${l1.category_id}`, l1);
      }
    }

    const rows: DrilldownRow[] = [];

    for (const im of income_by_member) {
      if (im.amount <= 0) continue;

      const key = `member:${im.user_id}`;
      const memberInfo = members.find(m => m.user_id === im.user_id);
      // 收入 segments 的 ratio_bps 已经以 totals.income 为分母
      const incomeSeg = summary.income_segments.find(s => s.key === key);
      const ratioBps = incomeSeg ? incomeSeg.ratio_bps : 0;
      const colorChoice = choiceByUserId.get(im.user_id) ?? null;
      const color = getMemberColorByChoice(colorChoice);

      const statusSuffix = im.status === 'left' ? '（已退出）' : '';
      const label = `${im.nickname}的收入${statusSuffix}`;

      // L1 列表
      const allL1 = im.categories
        .filter(c => c.amount > 0)
        .map(c => {
          const base = this._mapToL1Display(c);
          const prev = oldL1Map.get(`${key}:${base.category_id}`);
          if (prev) {
            base.expanded = prev.expanded;
            base.entries = prev.entries;
            base.entriesLoaded = prev.entriesLoaded;
            base.entriesHasMore = prev.entriesHasMore;
          }
          return base;
        });
      const l1Items = allL1.slice(0, L1_VISIBLE);

      rows.push({
        key,
        type: 'personal',
        label,
        amount: formatCentsDisplay(im.amount),
        amountCents: im.amount,
        ratio_bps: ratioBps,
        ratioText: fmtRatio(ratioBps),
        color,
        contributions: [],
        avatarUrl: im.avatar_url || '',
        userId: im.user_id,
        memberStatus: memberInfo?.status ?? im.status,
        expanded: oldExpandedMap.get(key) ?? false,
        l1Items,
      });
    }

    return rows;
  },

  /** 构建下钻行列表（spec §4.3 / §4.4 · COSTRA-302 / COSTRA-305 三级下钻保留） */
  _buildDrilldownRows(
    summary: FamilySummary,
    choiceByUserId: Map<string, number | null>,
  ): DrilldownRow[] {
    const { segments, shared, personal_by_member, members } = summary;

    // 保留旧 expanded 状态（行级）
    const oldExpandedMap = new Map<string, boolean>();
    // 保留旧 L1 三级展开/entries 态（按 rowKey:categoryId 唯一键）
    const oldL1Map = new Map<string, L1Display>();
    for (const row of this.data.drilldownRows) {
      oldExpandedMap.set(row.key, row.expanded);
      for (const l1 of row.l1Items) {
        oldL1Map.set(`${row.key}:${l1.category_id}`, l1);
      }
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
        .map(c => {
          const base = this._mapToL1Display(c);
          const prev = oldL1Map.get(`shared:${base.category_id}`);
          if (prev) {
            base.expanded = prev.expanded;
            base.entries = prev.entries;
            base.entriesLoaded = prev.entriesLoaded;
            base.entriesHasMore = prev.entriesHasMore;
          }
          return base;
        });
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
      const colorChoice = choiceByUserId.get(pm.user_id) ?? null;
      const color = getMemberColorByChoice(colorChoice);

      // 已退出成员 label 加后缀
      const statusSuffix = pm.status === 'left' ? '（已退出）' : '';
      const label = `${pm.nickname}的个人支出${statusSuffix}`;

      // L1 列表（topN=L1_VISIBLE 已让后端按上限返回 · 用户期望全显示）
      const allL1 = pm.categories
        .filter(c => c.amount > 0)
        .map(c => {
          const base = this._mapToL1Display(c);
          const prev = oldL1Map.get(`${key}:${base.category_id}`);
          if (prev) {
            base.expanded = prev.expanded;
            base.entries = prev.entries;
            base.entriesLoaded = prev.entriesLoaded;
            base.entriesHasMore = prev.entriesHasMore;
          }
          return base;
        });
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

  /** CategoryRankItem → L1Display（含三级下钻默认值 · COSTRA-305） */
  _mapToL1Display(c: CategoryRankItem): L1Display {
    return {
      category_id: c.category_id || '',
      category_name: c.category_name,
      icon: getCategoryIconById(c.category_id),
      amount: `¥${formatCentsToYuan(c.amount)}`,
      amountCents: c.amount,
      ratio_bps: c.ratio_bps,
      ratioText: fmtRatio(c.ratio_bps),
      expanded: false,
      loadingEntries: false,
      entries: [],
      entriesLoaded: false,
      entriesHasMore: false,
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
      isCurrentMonth: isCurrentMonth(prev),
    });
    this._shouldRefreshEmptyHint = true;
    this._collapseAllRows();
    void this._loadSummary(this._familyId, { hideContentWhileLoading: true });
  },

  onNextMonth() {
    const nxt = nextMonth(this.data.currentMonth);
    this.setData({
      currentMonth: nxt,
      monthDisplay: formatMonthDisplay(nxt),
      isCurrentMonth: isCurrentMonth(nxt),
    });
    this._shouldRefreshEmptyHint = true;
    this._collapseAllRows();
    void this._loadSummary(this._familyId, { hideContentWhileLoading: true });
  },

  /** picker mode="date" fields="month" 变更回调 */
  onMonthChange(e: WechatMiniprogram.PickerChange) {
    const value = e.detail.value as string;
    this.setData({
      currentMonth: value,
      monthDisplay: formatMonthDisplay(value),
      isCurrentMonth: isCurrentMonth(value),
    });
    this._shouldRefreshEmptyHint = true;
    this._collapseAllRows();
    void this._loadSummary(this._familyId, { hideContentWhileLoading: true });
  },

  // ─── 交互：年份切换（COSTRA-302 新增） ────────────────────────────────────────

  onPrevYear() {
    const prev = prevYear(this.data.currentYear);
    this.setData({
      currentYear: prev,
      yearDisplay: formatYearDisplay(prev),
      isCurrentYear: isCurrentYear(prev),
    });
    this._shouldRefreshEmptyHint = true;
    this._collapseAllRows();
    void this._loadSummary(this._familyId, { hideContentWhileLoading: true });
  },

  onNextYear() {
    const nxt = nextYear(this.data.currentYear);
    this.setData({
      currentYear: nxt,
      yearDisplay: formatYearDisplay(nxt),
      isCurrentYear: isCurrentYear(nxt),
    });
    this._shouldRefreshEmptyHint = true;
    this._collapseAllRows();
    void this._loadSummary(this._familyId, { hideContentWhileLoading: true });
  },

  /** picker mode="date" fields="year" 变更回调 */
  onYearChange(e: WechatMiniprogram.PickerChange) {
    const raw = e.detail.value as string;
    // picker fields="year" 可能返回 "YYYY" 或 "YYYY-MM-DD"，统一取前 4 位
    const value = raw.split('-')[0] || raw;
    this.setData({
      currentYear: value,
      yearDisplay: formatYearDisplay(value),
      isCurrentYear: isCurrentYear(value),
    });
    this._shouldRefreshEmptyHint = true;
    this._collapseAllRows();
    void this._loadSummary(this._familyId, { hideContentWhileLoading: true });
  },

  /** 快速返回当前自然月/年 */
  onBackToCurrent() {
    if (this.data.dimension === 'monthly') {
      const now = getCurrentMonthValue();
      if (now === this.data.currentMonth) return;
      this.setData({ currentMonth: now, monthDisplay: formatMonthDisplay(now), isCurrentMonth: true });
    } else {
      const now = getCurrentYearValue();
      if (now === this.data.currentYear) return;
      this.setData({ currentYear: now, yearDisplay: formatYearDisplay(now), isCurrentYear: true });
    }
    this._shouldRefreshEmptyHint = true;
    this._collapseAllRows();
    void this._loadSummary(this._familyId, { hideContentWhileLoading: true });
  },

  /** 月度/年度切换（COSTRA-302 年度可用化 · 不再 toast 拦截） */
  onSwitchDimension(e: WechatMiniprogram.TouchEvent) {
    const dim = e.currentTarget.dataset.dim as 'monthly' | 'yearly';
    if (dim === this.data.dimension) return;
    this.setData({ dimension: dim });
    this._shouldRefreshEmptyHint = true;
    this._collapseAllRows();
    void this._loadSummary(this._familyId, { hideContentWhileLoading: true });
  },

  // ─── 交互：下钻行 展开/收起（多行可同时展开 · 与设计 §4.5 对齐） ──────────

  /** 仅切换被点击行的 expanded，不影响其他行（用户期望多个下钻列表可同时打开）
   *  通过 dataset.tab 区分支出侧（drilldownRows）与收入侧（incomeDrilldownRows） */
  onTapDrilldownRow(e: WechatMiniprogram.TouchEvent) {
    const key = e.currentTarget.dataset.key as string;
    const tab = e.currentTarget.dataset.tab as string;
    if (!key) return;
    const rowsKey = tab === 'income' ? 'incomeDrilldownRows' : 'drilldownRows';
    const rows = this.data[rowsKey] as DrilldownRow[];
    const idx = rows.findIndex(r => r.key === key);
    if (idx < 0) return;
    // 仅写被点击行的 expanded 字段：避免整列 read-modify-write 触发整张排行重渲染（与统计页 A1 一致）
    this.setData({ [`${rowsKey}[${idx}].expanded`]: !rows[idx].expanded });
  },

  /**
   * L1 子项点击：展开/收起三级流水明细（COSTRA-305 · 公共行与成员行统一交互）
   *
   * - 已展开 → 收起（expanded=false）
   * - 未展开 → 展开 + 若 entriesLoaded 直接显示缓存 · 否则请求 drill-down API
   * - 采用最小 setData 路径（只写被点 L1 项的字段 `drilldownRows[i].l1Items[j].xxx`）
   * - 通过 dataset.tab 区分支出侧（drilldownRows）与收入侧（incomeDrilldownRows）
   */
  onTapL1(e: WechatMiniprogram.TouchEvent) {
    const { rowkey, l1id, tab } = e.currentTarget.dataset as Record<string, string>;
    if (!rowkey || !l1id) return;

    const rowsKey = tab === 'income' ? 'incomeDrilldownRows' : 'drilldownRows';
    const rows = this.data[rowsKey] as DrilldownRow[];
    const rowIdx = rows.findIndex(r => r.key === rowkey);
    if (rowIdx < 0) return;
    const row = rows[rowIdx];
    const l1Idx = row.l1Items.findIndex(l => l.category_id === l1id);
    if (l1Idx < 0) return;
    const l1 = row.l1Items[l1Idx];

    const base = `${rowsKey}[${rowIdx}].l1Items[${l1Idx}]`;

    // 已展开 → 收起
    if (l1.expanded) {
      this.setData({ [`${base}.expanded`]: false });
      return;
    }

    // 未展开 → 展开
    if (l1.entriesLoaded) {
      // 缓存命中，直接展示
      this.setData({ [`${base}.expanded`]: true });
      return;
    }

    // 需要请求数据
    this.setData({
      [`${base}.expanded`]: true,
      [`${base}.loadingEntries`]: true,
    });

    const sharedType = row.type === 'shared' ? 'shared' as const : 'personal' as const;
    const userId = row.type === 'shared' ? undefined : row.userId;
    const scope = this.data.dimension === 'monthly'
      ? { month: this.data.currentMonth }
      : { year: this.data.currentYear };

    const entryType = tab === 'income' ? 'income' as const : 'expense' as const;
    void this._loadL1Entries(rowIdx, l1Idx, scope, l1id, sharedType, userId, false, entryType, rowsKey);
  },

  /** 加载 L1 三级流水明细（COSTRA-305 · 支持支出/收入两侧） */
  async _loadL1Entries(
    rowIdx: number,
    l1Idx: number,
    scope: { month?: string; year?: string },
    l1CategoryId: string,
    sharedType: 'shared' | 'personal',
    userId?: string,
    silent: boolean = false,
    entryType: 'expense' | 'income' = 'expense',
    rowsKey: 'drilldownRows' | 'incomeDrilldownRows' = 'drilldownRows',
  ) {
    const base = `${rowsKey}[${rowIdx}].l1Items[${l1Idx}]`;
    // P1-2 竞态防护：快照发起时的 family + scope，返回后校验；切月/年/账本后旧请求不得写入新视图。
    const familyIdSnapshot = this._familyId;
    const scopeKey = scope.month ? `m:${scope.month}` : `y:${scope.year}`;
    const isStale = (): boolean => {
      if (this._familyId !== familyIdSnapshot) return true;
      const cur = this.data.dimension === 'monthly'
        ? `m:${this.data.currentMonth}`
        : `y:${this.data.currentYear}`;
      return cur !== scopeKey;
    };
    try {
      const res = await drillDownFamilyL1Entries(
        familyIdSnapshot,
        scope,
        l1CategoryId,
        { sharedType, userId, limit: L1_ENTRIES_VISIBLE + 1, entryType },
      );

      // 返回后 family/scope 已变 → 丢弃，避免旧 scope 明细写入新视图
      if (isStale()) return;
      // 读最新 data 确认 L1 节点还在（summary 可能已刷新）
      const latestRows = this.data[rowsKey] as DrilldownRow[];
      const latestRow = latestRows[rowIdx];
      if (!latestRow) return;
      const latestL1 = latestRow.l1Items[l1Idx];
      if (!latestL1 || latestL1.category_id !== l1CategoryId) return;

      const overflow = res.items.length > L1_ENTRIES_VISIBLE;
      const visibleItems = overflow ? res.items.slice(0, L1_ENTRIES_VISIBLE) : res.items;
      const entries: EntryRow[] = visibleItems.map((it: FamilyEntryDetailItem) => {
        const badges = computeBadges(it);
        return {
          entry_id: it.entry_id,
          amount: formatCentsDisplay(it.amount),
          note: resolveEntryDisplayNote(it.note, it.category_name),
          dateLabel: formatEntryDate(it.occurred_at),
          timeLabel: formatEntryTime(it.occurred_at),
          isShared: badges.showShared,
          isRecurring: badges.showRecurring,
          nickname: it.nickname || '',
          avatarUrl: it.avatar_url || '',
          initial: (it.nickname || '?')[0],
        };
      });

      this.setData({
        [`${base}.entries`]: entries,
        [`${base}.entriesLoaded`]: true,
        [`${base}.entriesHasMore`]: overflow,
        [`${base}.loadingEntries`]: false,
      });
    } catch (err) {
      logger.error('family', 'loadL1Entries failed', err);
      // family/scope 已变 → 不再回写（节点已被 _collapseAllRows 清理）
      if (isStale()) return;
      // 读最新 data 确认 L1 节点还在
      const latestRows = this.data[rowsKey] as DrilldownRow[];
      const latestRow = latestRows[rowIdx];
      if (latestRow) {
        const latestL1 = latestRow.l1Items[l1Idx];
        if (latestL1 && latestL1.category_id === l1CategoryId) {
          this.setData({ [`${base}.loadingEntries`]: false });
        }
      }
      // 静默重拉（数据变更后台刷新）失败不打扰用户，旧 entries 继续展示
      if (!silent) wx.showToast({ title: '加载失败', icon: 'none' });
    }
  },

  /**
   * COSTRA-305：对已展开且已加载过的 L1 三级明细做 fire-and-forget 静默重拉。
   *
   * 用于数据变更（SYNC_DONE）后 summary 重建场景：_buildDrilldownRows 会保留旧 entries
   * 以维持视觉连续，此处再对已展开节点后台拉取最新明细并覆盖，做到「排行金额 + 三级明细」
   * 全链路同步。_familyDrillCache 已在 _onSyncDone → invalidateFamilyCache 中清理，
   * 因此重拉必走网络拿到新值；非数据变更的普通重建则命中缓存、几乎零开销。
   * 仅刷新 expanded 节点，避免无谓请求。
   */
  _refreshExpandedL1Entries(rows: DrilldownRow[]) {
    this._refreshExpandedRows(rows, 'drilldownRows', 'expense');
  },

  /** 收入侧静默重拉已展开节点（与 _refreshExpandedL1Entries 对称） */
  _refreshExpandedIncomeL1Entries(rows: DrilldownRow[]) {
    this._refreshExpandedRows(rows, 'incomeDrilldownRows', 'income');
  },

  /** 通用：对已展开且已加载的 L1 节点做静默重拉（支出/收入两侧复用） */
  _refreshExpandedRows(
    rows: DrilldownRow[],
    rowsKey: 'drilldownRows' | 'incomeDrilldownRows',
    entryType: 'expense' | 'income',
  ) {
    const scope = this.data.dimension === 'monthly'
      ? { month: this.data.currentMonth }
      : { year: this.data.currentYear };
    rows.forEach((row, rowIdx) => {
      const sharedType = row.type === 'shared' ? 'shared' as const : 'personal' as const;
      const userId = row.type === 'shared' ? undefined : row.userId;
      row.l1Items.forEach((l1, l1Idx) => {
        if (l1.expanded && l1.entriesLoaded && l1.category_id) {
          void this._loadL1Entries(rowIdx, l1Idx, scope, l1.category_id, sharedType, userId, true, entryType, rowsKey);
        }
      });
    });
  },

  /** 折叠所有行 + 收起所有 L1 三级展开（时间切换 / 账本切换时使用 · COSTRA-305 扩展）
   *  同时折叠支出侧（drilldownRows）和收入侧（incomeDrilldownRows） */
  _collapseAllRows() {
    // 仅写当前处于展开态的项，避免整列重写；无展开项时直接跳过 setData
    const update: Record<string, unknown> = {};
    const collapseRows = (rows: DrilldownRow[], rowsKey: string) => {
      rows.forEach((r, rowIdx) => {
        if (r.expanded) update[`${rowsKey}[${rowIdx}].expanded`] = false;
        // COSTRA-305: scope 变了 → 旧三级明细失效，必须清空
        r.l1Items.forEach((l1, l1Idx) => {
          if (l1.expanded || l1.entriesLoaded) {
            const base = `${rowsKey}[${rowIdx}].l1Items[${l1Idx}]`;
            if (l1.expanded) update[`${base}.expanded`] = false;
            if (l1.entriesLoaded) {
              update[`${base}.entries`] = [];
              update[`${base}.entriesLoaded`] = false;
              update[`${base}.entriesHasMore`] = false;
            }
          }
        });
      });
    };
    collapseRows(this.data.drilldownRows, 'drilldownRows');
    collapseRows(this.data.incomeDrilldownRows, 'incomeDrilldownRows');
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
      logger.error('family', 'revokeInvite failed', err);
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

      logger.error('family', 'createInvite failed', err);
      const mapped = mapError(err as ApiError);
      this.setData({
        invitePreparing: false,
        inviteReady: false,
        inviteErrorText: mapped.desc || '邀请码创建失败，请稍后重试',
      });
    }
  },

  /** onShareAppMessage · 双态分派（协作邀请与推广型分享隔离）
   *
   * 场景 A · 协作邀请（对外行为与旧版逐字等价 · 由 utils/share.spec.ts 锁死）
   *   触发：邀请遮罩内 <button open-type="share">分享邀请</button>
   *   判定：opts.from === 'button' && _pendingInviteToken 有值
   *   返回：{ title: `${familyName} 邀请你一起记账`, path: `/pages/invite-confirm/index?token=${inviteToken}` }
   *   副作用：置 _pendingInviteShared = true，让 onShow 关闭邀请遮罩且不 revoke token
   *
   * 场景 B · 推广型分享（新增能力）
   *   触发：右上角胶囊菜单"分享给朋友"
   *   判定：opts.from === 'menu'（或场景 A 判定失败的兜底路径）
   *   返回：utils/share.ts 的通用推广卡（Costra · 开启记账之路）
   *   副作用：无（绝不触碰 _pendingInviteShared，避免误关邀请遮罩）
   *
   * opts.from 见微信官方 Page.onShareAppMessage 文档定义：
   *   https://developers.weixin.qq.com/miniprogram/dev/reference/api/Page.html#onShareAppMessage-Object-object
   *   （'button' = 页面内 open-type=share 按钮；'menu' = 右上角胶囊菜单；访问于 2026-07-16）
   *
   * 不提供 onShareTimeline：朋友圈落地页 = 分享时的当前页面，无法自定义 path，
   * 若在此挂钩子会导致朋友圈进来落到协作页，与"统一落地明细页"约束冲突。
   */
  onShareAppMessage(opts?: WechatMiniprogram.Page.IShareAppMessageOption): WechatMiniprogram.Page.ICustomShareContent {
    const decision = dispatchFamilyShare({
      from: opts?.from,
      pendingInviteToken: this._pendingInviteToken,
    });
    if (decision.kind === 'invite') {
      // 场景 A 副作用：与旧代码逐字等价（让 onShow 关闭邀请遮罩且不 revoke token）
      this._pendingInviteShared = true;
      return buildInviteShareContent(this.data.familyName, decision.inviteToken);
    }
    // 场景 B：通用推广分享，绝不触碰 _pendingInviteShared
    return buildAppShareContent();
  },

  /** 阻止遮罩触摸穿透 */
  noop() {},

  // ─── 交互：成员头像点击 ────────────────────────────────────────────────────
  //
  // 点头像 → 锚定气泡菜单（自定义弹层，替代原生 showActionSheet；视觉对齐明细页 ctx-menu）：
  //   · 被点头像泛起暖光环高亮（activeMemberUserId）
  //   · 气泡从头像正下方浮出，顶部小三角指向头像中心
  //   · 破坏性项（退出/解散/移出账本）红色 + 二次确认；中性项（重命名账本）默认黑
  //
  // 选项矩阵（重命名对全体 active 成员开放）：
  //   1. 已 left 成员 → 无响应
  //   2. 点自己：
  //        · owner 单人 → [重命名账本 · 解散账本]
  //        · owner 多人 → [重命名账本 · 退出账本 · 解散账本]（退出自动移交所有权）
  //        · 普通成员   → [重命名账本 · 退出账本]
  //   3. 点他人：owner → [移出账本]；普通成员 → 无响应

  onTapMember(e: WechatMiniprogram.TouchEvent) {
    const { userid, status } = e.currentTarget.dataset;

    // 已退出成员：点击无响应
    if (status === 'left') return;

    const isSelf = userid === this._currentUserId;
    const items = this._buildMemberMenuItems(isSelf);
    // 普通成员点他人：无可用选项 → 无响应
    if (items.length === 0) return;

    this._openMemberMenu(userid, items);
  },

  /** 按角色 / 点击对象构建气泡菜单选项（矩阵逻辑抽至 ./memberMenu 纯函数 · 见 memberMenu.spec.ts） */
  _buildMemberMenuItems(isSelf: boolean): MemberMenuItem[] {
    const activeMemberCount = this.data.members.filter(m => m.status === 'active').length;
    return buildMemberMenuItems({
      isSelf,
      isOwner: this.data.isOwner,
      activeMemberCount,
      familyKind: this.data.familyKind,
    });
  },

  /**
   * 打开锚定气泡菜单：用 boundingClientRect 定位到被点头像
   * 气泡水平居中于头像并做左右边界钳制；小三角单独偏移始终指向头像中心
   */
  _openMemberMenu(userId: string, items: MemberMenuItem[]) {
    const winW = wx.getWindowInfo().windowWidth || 375;
    const rpxToPx = winW / 750;
    const menuW = 320 * rpxToPx; // 须与 wxss .member-menu width 同步
    const margin = 12;
    const arrowGap = 12 * rpxToPx; // 头像与气泡的间距

    wx.createSelectorQuery()
      .in(this)
      .select(`#avatar-${userId}`)
      .boundingClientRect((rect) => {
        if (!rect) return;
        const avatarCenterX = rect.left + rect.width / 2;

        // 左右：气泡中心对齐头像中心，边界收拢防溢出
        let left = avatarCenterX - menuW / 2;
        if (left < margin) left = margin;
        if (left > winW - menuW - margin) left = winW - menuW - margin;

        // 小三角相对气泡左边的偏移：始终指向头像中心，钳制在气泡内避免出界
        let arrowLeft = avatarCenterX - left;
        const arrowInset = 28 * rpxToPx;
        if (arrowLeft < arrowInset) arrowLeft = arrowInset;
        if (arrowLeft > menuW - arrowInset) arrowLeft = menuW - arrowInset;

        // 上下：固定向头像下方展开（头像在页面顶部，下方空间充足）
        const top = rect.bottom + arrowGap;

        // 仅在定位成功、菜单真正弹出时才记录目标 userId，
        // 避免 rect 缺失的失败路径残留旧值（状态机保持自洽）
        this._memberMenuUserId = userId;
        wx.vibrateShort({ type: 'light' });
        this.setData({
          memberMenuItems: items,
          memberMenuLeft: left,
          memberMenuTop: top,
          memberMenuArrowLeft: arrowLeft,
          memberMenuVisible: true,
          activeMemberUserId: userId,
        });
      })
      .exec();
  },

  /** 关闭气泡菜单（点遮罩 / 选中某项 / 复位高亮） */
  onMemberMenuClose() {
    if (!this.data.memberMenuVisible) return;
    this._memberMenuUserId = '';
    this.setData({ memberMenuVisible: false, activeMemberUserId: '' });
  },

  /** 气泡菜单项点击：先关闭菜单，再分派到对应动作（破坏性动作均带二次确认） */
  onMemberMenuTap(e: WechatMiniprogram.TouchEvent) {
    const key = (e.currentTarget.dataset as Record<string, string>).key;
    const userId = this._memberMenuUserId;
    this.onMemberMenuClose();

    if (key === 'rename') {
      this.onTapRenameLedger();
    } else if (key === 'colorChoice') {
      this._openColorPicker();
    } else if (key === 'leave') {
      this._confirmLeaveSelf();
    } else if (key === 'dissolve') {
      this._confirmDissolveFamily();
    } else if (key === 'remove') {
      this._confirmRemoveMember(userId);
    }
  },

  _confirmRemoveMember(userId: string) {
    const member = this.data.members.find(m => m.userId === userId);
    const name = member?.nickname || '该成员';

    wx.showModal({
      title: '',
      content: `确定将${name}移出账本吗？`,
      confirmColor: '#FA5151',
      success: async (res) => {
        if (!res.confirm) return;
        try {
          await removeMember(this._familyId, userId);
          wx.showToast({ title: '已移出', icon: 'success' });
          // 刷新页面数据
          await this._loadSummary(this._familyId);
        } catch (err) {
          logger.error('family', 'removeMember failed', err);
          wx.showToast({ title: '移出失败', icon: 'none' });
        }
      },
    });
  },

  // ─── 换颜色弹层（migration 0017 · 8 色预设 + 撞色头像暗示） ───────────────────

  /**
   * 打开换色弹层：构造 8 色选项列表，标记当前选中色 + 其他成员使用情况
   *
   * usedByOthers 逻辑：
   *   - 排除当前用户自己（自己当前色若被别人也选了，只展示他人头像）
   *   - 仅统计 active 成员
   *   - 同一色被 ≥3 人用时，展示前 2 个头像 + extraCount = N-2
   *
   * 数据源：this.data.summary.members（FamilyMember[]，含 color_choice 字段）
   */
  _openColorPicker() {
    const myUserId = this._currentUserId || this._syncCurrentUserIdFromToken();
    const summaryMembers = this.data.summary?.members ?? [];

    const myMember = summaryMembers.find(m => m.user_id === myUserId);
    const myColorChoice = myMember?.color_choice ?? null;

    // 按 color_choice 分组其他 active 成员
    const othersByChoice = new Map<number, Array<{ userId: string; avatarUrl: string; nickname: string }>>();
    for (const m of summaryMembers) {
      if (m.status !== 'active' || m.user_id === myUserId) continue;
      const choice = m.color_choice;
      if (choice == null) continue;
      const list = othersByChoice.get(choice) ?? [];
      list.push({ userId: m.user_id, avatarUrl: m.avatar_url || '', nickname: m.nickname });
      othersByChoice.set(choice, list);
    }

    const options: ColorPickerOption[] = MEMBER_COLOR_SLOTS.slice(0, 8).map((hex, index) => {
      const others = othersByChoice.get(index) ?? [];
      // 折叠：>2 时只展示前 2 个头像 + extraCount
      const visibleOthers = others.slice(0, 2);
      const extraCount = others.length > 2 ? others.length - 2 : 0;
      return {
        index,
        hex,
        selected: index === myColorChoice,
        usedByOthers: visibleOthers,
        extraCount,
      };
    });

    this.setData({ colorPickerOptions: options, colorPickerVisible: true });
  },

  /** 关闭换色弹层 */
  onColorPickerClose() {
    if (!this.data.colorPickerVisible) return;
    this.setData({ colorPickerVisible: false, colorPickerLoading: false });
  },

  /**
   * 选中某个颜色：调 API + 就地 patch summary + 关闭弹层（不重拉 summary）
   *
   * 换色只改一列语义色，成员构成/金额/顺序完全不动。因此本地：
   *   1. familyApi.updateMyColorChoice 内部会 patch 已缓存的 summary/members
   *   2. 页级 data.summary.members 就地 patch 后重跑 _buildMultiDisplay 即可即时更新 UI
   *   3. 不清任何缓存、不发起额外网络请求
   */
  async onSelectColor(e: WechatMiniprogram.TouchEvent) {
    const choice = Number((e.currentTarget.dataset as Record<string, string>).choice);
    if (isNaN(choice) || choice < 0 || choice > 7) return;

    // 防重复提交
    if (this.data.colorPickerLoading) return;

    // 无变化短路
    const myUserId = this._currentUserId || this._syncCurrentUserIdFromToken();
    const summary = this.data.summary;
    const myMember = summary?.members.find(m => m.user_id === myUserId);
    const myColorChoice = myMember?.color_choice ?? null;
    if (choice === myColorChoice) {
      this.onColorPickerClose();
      return;
    }

    const familyId = this._familyId;
    if (!familyId || !myUserId || !summary) return;

    this.setData({ colorPickerLoading: true });

    try {
      await updateMyColorChoice(familyId, myUserId, choice);
      wx.vibrateShort({ type: 'light' });
      // 就地 patch data.summary.members 中当前用户的 color_choice
      const patchedMembers = summary.members.map(m =>
        m.user_id === myUserId ? { ...m, color_choice: choice } : m,
      );
      const patchedSummary: FamilySummary = { ...summary, members: patchedMembers };
      this.setData({ summary: patchedSummary, colorPickerVisible: false, colorPickerLoading: false });
      // 用新 summary 重跑 multi 展示，segments/L1 rows 颜色即时刷新
      this._buildMultiDisplay(patchedSummary);
      wx.showToast({ title: '颜色已更新', icon: 'success' });
    } catch (err) {
      logger.error('family', 'updateMyColorChoice failed', err);
      this.setData({ colorPickerLoading: false });
      const mapped = mapError(err as ApiError);
      wx.showToast({ title: mapped.desc || '换色失败，请稍后重试', icon: 'none' });
    }
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
          logger.error('family', 'leaveFamily failed', err);
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
          logger.error('family', 'dissolveFamily failed', err);
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
  // 全体 active 成员均可触发（后端 updateFamily 已放开为 assertActiveMember）。
  // 视觉与"创建协作账本"完全镜像（invite-dialog__* token）。

  onTapRenameLedger() {
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
      logger.error('family', 'renameFamily failed', err);
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
      logger.error('family', 'createFamily failed', err);
      this.setData({ createFamilyLoading: false, createFamilyError: '创建失败，请重试' });
    }
  },

  // ─── 交互：账本切换 ──────────────────────
  // 账本切换入口由 <ledger-switcher> 组件承载（顶部导航栏锚定下拉气泡）。
  // 组件内部调 switchActiveFamily 广播 ACTIVE_FAMILY_CHANGED，本页由 _onActiveFamilyChanged 响应重载。
});
