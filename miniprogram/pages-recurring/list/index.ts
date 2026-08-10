// pages-recurring/list/index.ts · 定时记账列表页
// 卡号占位：COSTRA-5xx（T3 · Sprint-4 · Epic-E）
// Refs: COSTRA-5xx
// 产品事实源：docs/design/recurring-entry-product-spec.md §5.2

import type { RecurringRule } from '../../services/recurringApi';
import {
  pauseRecurringRule,
  resumeRecurringRule,
  deleteRecurringRule,
} from '../../services/recurringApi';
import {
  getCachedRules,
  fetchAndCacheRules,
  invalidateCache,
  setCachedRules,
  enqueueMutation,
  generateIdempotencyKey,
} from '../../services/recurringLocal';
import { getCategories, getCategoriesSync, type CategoryItem } from '../../services/categoryService';
import { getActiveFamilyId } from '../../services/family';
import { getFamilies, type FamilyItem } from '../../services/familyApi';
import { getSafeAreaMetrics } from '../../utils/safeArea';
import { syncOnce } from '../../services/syncScheduler';
import { eventBus, EventNames } from '../../services/eventBus';
import { groupRules, clampMenuPosition, type DisplayRule } from './model';
import { consumeRecurringReturnToast, consumePendingSave, type PendingSaveResult } from '../returnFeedback';

// ─── Page ──────────────────────────────────────────────────────────────────

interface AppWithBootstrap {
  bootstrapPromise: Promise<void>;
}

/** 右滑自动保存最终结果 → toast 文案。返回 null 表示不弹（如 network_error 已无意义，不再打扰）。 */
function pendingSaveTitle(result: PendingSaveResult): string | null {
    switch (result.status) {
      case 'success': return result.wasDisabled ? '已保存，但未启用' : '已保存';
      case 'invalid': return '修改未保存（不符合规范）';
      case 'version_conflict': return '数据已被他人更新，已还原为最新';
      case 'network_error': return '网络失败，未保存';
      case 'error': return result.message || '保存失败';
    }
}

Page({
  data: {
    loading: true,
    error: false,
    isEmpty: false,
    enabledRules: [] as DisplayRule[],
    disabledRules: [] as DisplayRule[],
    summaryText: '',
    ctxMenuVisible: false,
    ctxMenuX: 0,
    ctxMenuY: 0,
    ctxMenuRule: null as DisplayRule | null,
    longPressRuleId: '',
    // 自定义导航栏
    navBarTotalHeight: 0,
    statusBarHeight: 0,
    navBarHeight: 0,
    navActionRight: 0,
  },

  _categories: [] as CategoryItem[],
  _families: [] as FamilyItem[],
  _loaded: false,
  _recurringSyncHandler: null as (() => void) | null,

  async onLoad() {
    // 安全区
    const metrics = getSafeAreaMetrics();
    this.setData({
      navBarTotalHeight: metrics.navBarTotalHeight,
      statusBarHeight: metrics.statusBarHeight,
      navBarHeight: metrics.navBarHeight,
      navActionRight: metrics.menuButtonLeft > 0
        ? Math.max(16, metrics.windowWidth - metrics.menuButtonLeft + 8)
        : 16,
    });

    // bootstrapPromise gate：避免 auth/storage race
    const app = getApp<AppWithBootstrap>();
    await app.bootstrapPromise;

    const recurringSyncHandler = () => { void this._loadList(false); };
    this._recurringSyncHandler = recurringSyncHandler;
    eventBus.on(EventNames.RECURRING_SYNC_DONE, recurringSyncHandler);

    await this._loadContext();
    await this._loadList(true);
    this._loaded = true;
  },

  async onShow() {
    // 消费编辑页返回后的一次性反馈（如「已保存」/「已还原」/「修改未保存（不符合规范）」）。
    // 放在 _loaded 判断之前，确保任何进入本页的 onShow 都能取到并展示。
    const returnToast = consumeRecurringReturnToast();
    if (returnToast) {
      wx.showToast({ title: returnToast, icon: 'none' });
    }
    // 右滑自动保存的异步结果：编辑页 onUnload 发起 fire-and-forget 保存，
    // 此处 await 拿最终结果决定 toast + 触发列表刷新。
    const pendingSave = consumePendingSave();
    if (pendingSave) {
      const result = await pendingSave;
      const title = pendingSaveTitle(result);
      if (title) wx.showToast({ title, icon: 'none' });
      // 保存成功 / 版本冲突都需要刷新列表（后者服务端已是最新态）
      if (result.status === 'success' || result.status === 'version_conflict') {
        await this._loadList(false);
      }
    }
    // 避免 onLoad/onShow 并发双拉：仅在 _loaded 后才触发 onShow 刷新
    if (!this._loaded) return;
    await syncOnce('page-show');
    await this._loadList(false);
  },

  onHide() {
    // 离开时触发 syncOnce 确保 recurring queue replay
    void syncOnce('hide');
  },

  onUnload() {
    if (this._recurringSyncHandler) {
      eventBus.off(EventNames.RECURRING_SYNC_DONE, this._recurringSyncHandler);
      this._recurringSyncHandler = null;
    }
  },

  async _loadContext() {
    try {
      const res = await getFamilies();
      this._families = res.families;

      // 规则跟人不跟当前账本：聚合用户所有 family 的分类，不能只解析 active family。
      const categoryGroups = await Promise.all(
        res.families.map(async (family) => {
          try {
            return await getCategories(family.id);
          } catch {
            return getCategoriesSync(family.id);
          }
        }),
      );
      this._categories = categoryGroups.flat();

      // 无家庭列表的极端降级仍尝试 active family fallback。
      if (this._categories.length === 0) {
        const familyId = await getActiveFamilyId();
        if (familyId) this._categories = getCategoriesSync(familyId);
      }
    } catch { /* 静默 */ }
  },

  async _loadList(showLoading: boolean) {
    if (showLoading) this.setData({ loading: true, error: false });
    try {
      // SWR: 先渲染缓存
      const cached = await getCachedRules();
      if (cached) this._renderRules(cached);
      // 后台 refetch
      const fresh = await fetchAndCacheRules();
      this._renderRules(fresh);
      this.setData({ loading: false, error: false });
    } catch {
      if (!this.data.enabledRules.length && !this.data.disabledRules.length) {
        this.setData({ loading: false, error: true });
      } else {
        this.setData({ loading: false });
      }
    }
  },

  _renderRules(rules: RecurringRule[]) {
    const { enabled, disabled, summary } = groupRules(rules, this._categories, this._families);
    this.setData({
      enabledRules: enabled,
      disabledRules: disabled,
      summaryText: summary.summaryText,
      isEmpty: summary.total === 0,
    });
  },

  async _applyOptimisticRules(transform: (rules: RecurringRule[]) => RecurringRule[]) {
    const current = [...this.data.enabledRules, ...this.data.disabledRules].map((item) => item.raw);
    const next = transform(current);
    this._renderRules(next);
    await setCachedRules(next);
  },

  // ─── 交互 ──────────────────────────────────────────────────────────────

  onTapBack() {
    wx.navigateBack();
  },

  onTapAdd() {
    wx.navigateTo({ url: '/pages-recurring/edit/index?mode=create' });
  },

  onTapRule(e: WechatMiniprogram.TouchEvent) {
    const id = e.currentTarget.dataset.id;
    wx.navigateTo({ url: `/pages-recurring/edit/index?mode=edit&id=${id}` });
  },

  onLongPressRule(e: WechatMiniprogram.TouchEvent) {
    const id = e.currentTarget.dataset.id;
    const rule = [...this.data.enabledRules, ...this.data.disabledRules].find((r) => r.id === id);
    if (!rule) return;
    const touch = e.touches?.[0] || e.changedTouches?.[0];
    const metrics = getSafeAreaMetrics();
    const pos = clampMenuPosition(
      touch?.clientX || 150,
      touch?.clientY || 300,
      metrics.windowWidth,
      metrics.windowHeight,
      metrics.statusBarHeight,
    );
    wx.vibrateShort({ type: 'light' });
    this.setData({
      ctxMenuVisible: true,
      ctxMenuX: pos.left,
      ctxMenuY: pos.top,
      ctxMenuRule: rule,
      longPressRuleId: id,
    });
  },

  onCloseCtxMenu() {
    this.setData({ ctxMenuVisible: false, ctxMenuRule: null, longPressRuleId: '' });
  },

  onCtxMenuNoop() { /* catchtap noop handler */ },

  async onCtxCopy() {
    const rule = this.data.ctxMenuRule;
    this.setData({ ctxMenuVisible: false, ctxMenuRule: null, longPressRuleId: '' });
    if (!rule) return;
    wx.navigateTo({ url: `/pages-recurring/edit/index?mode=copy&id=${rule.id}` });
  },

  onCtxEdit() {
    const rule = this.data.ctxMenuRule;
    this.setData({ ctxMenuVisible: false, ctxMenuRule: null, longPressRuleId: '' });
    if (!rule) return;
    wx.navigateTo({ url: `/pages-recurring/edit/index?mode=edit&id=${rule.id}` });
  },

  async onCtxToggle() {
    const rule = this.data.ctxMenuRule;
    this.setData({ ctxMenuVisible: false, ctxMenuRule: null, longPressRuleId: '' });
    if (!rule) return;
    const idempotencyKey = generateIdempotencyKey();
    try {
      if (rule.status === 'active') {
        await pauseRecurringRule(rule.id, { idempotencyKey });
        wx.showToast({ title: '已禁用', icon: 'none' });
      } else {
        await resumeRecurringRule(rule.id, { idempotencyKey });
        wx.showToast({ title: '已启用', icon: 'none' });
      }
      await invalidateCache();
      await this._loadList(false);
    } catch (e: any) {
      if (e?.code === 'CLIENT_NETWORK_ERROR') {
        // 网络失败 → 入 recurring queue
        const nextStatus = rule.status === 'active' ? 'paused' : 'active';
        if (rule.status === 'active') {
          await enqueueMutation({ kind: 'pause', id: rule.id, idempotencyKey, enqueuedAt: Date.now() });
        } else {
          await enqueueMutation({ kind: 'resume', id: rule.id, idempotencyKey, enqueuedAt: Date.now() });
        }
        await this._applyOptimisticRules((rules) => rules.map((item) => (
          item.id === rule.id ? { ...item, status: nextStatus } : item
        )));
        wx.showToast({ title: '网络不佳，已暂存', icon: 'none' });
      } else if (e?.code === 'BUSINESS_RULE_VIOLATION') {
        // 业务规则拒绝（如已到期规则 resume）→ 展示服务端中文提示
        wx.showToast({ title: e?.message || '该规则已到期，无法直接启用', icon: 'none', duration: 3000 });
      } else {
        wx.showToast({ title: '操作失败', icon: 'none' });
      }
    }
  },

  async onCtxDelete() {
    const rule = this.data.ctxMenuRule;
    this.setData({ ctxMenuVisible: false, ctxMenuRule: null, longPressRuleId: '' });
    if (!rule) return;
    const res = await wx.showModal({
      title: '删除定时',
      content: '删除后该定时不再执行，已生成的历史流水不受影响。',
      confirmText: '删除',
      confirmColor: '#C08A7B',
    });
    if (!res.confirm) return;
    const idempotencyKey = generateIdempotencyKey();
    try {
      await deleteRecurringRule(rule.id, rule.version, { idempotencyKey });
      await invalidateCache();
      await this._loadList(false);
    } catch (e: any) {
      if (e?.code === 'CLIENT_NETWORK_ERROR') {
        // 网络失败 → 入 recurring queue，并从本地列表乐观移除
        await enqueueMutation({ kind: 'delete', id: rule.id, version: rule.version, idempotencyKey, enqueuedAt: Date.now() });
        await this._applyOptimisticRules((rules) => rules.filter((item) => item.id !== rule.id));
        wx.showToast({ title: '网络不佳，已暂存', icon: 'none' });
      } else {
        wx.showToast({ title: '删除失败', icon: 'none' });
      }
    }
  },

  onRefresh() {
    void this._loadList(true);
  },
});
