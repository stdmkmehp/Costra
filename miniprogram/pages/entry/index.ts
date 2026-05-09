// pages/entry/index.ts
// 记一笔页：类型切换 + 数字键盘 + 分类 + 备注。骨架阶段提交走 services/db.ts 本地持久化 + services/outbox.ts outbox 队列。
// 卡号: COSTRA-103（Epic-C 主线 · R1 · SBAI 第 7 次冒烟）
// Refs: COSTRA-103 §2.5 接入 · sync-protocol.md §2.1（payload snake_case）
// P1-1 follow-up（card-review-round-1-tech.md）：payload 驼峰 → snake_case 修正

import { putEntry } from '../../services/db';
import { enqueue } from '../../services/outbox';
import { newClientRefId } from '../../utils/id';
import { parseAmountInputToCents, formatMoney } from '../../utils/money';

Page({
  data: {
    type: 'expense' as 'expense' | 'income',
    amountInput: '0',
    amountDisplay: '0.00',
    categoryId: '',
    categoryName: '请选择分类',
    note: '',
    submitting: false,
  },

  onTapType(e: WechatMiniprogram.BaseEvent) {
    const type = (e.currentTarget.dataset as any).type as 'expense' | 'income';
    this.setData({ type });
  },

  onAmountInput(e: WechatMiniprogram.Input) {
    const raw = e.detail.value || '0';
    const cents = parseAmountInputToCents(raw);
    this.setData({ amountInput: raw, amountDisplay: formatMoney(cents) });
  },

  onNoteInput(e: WechatMiniprogram.Input) {
    this.setData({ note: (e.detail.value || '').slice(0, 140) });
  },

  onTapCategory() {
    // TODO(COSTRA-112): 跳分类选择页
    wx.showToast({ title: '分类选择（待实现）', icon: 'none' });
  },

  async onSubmit() {
    if (this.data.submitting) return;
    const cents = parseAmountInputToCents(this.data.amountInput);
    if (cents <= 0) {
      wx.showToast({ title: '请输入金额', icon: 'none' });
      return;
    }
    this.setData({ submitting: true });
    try {
      const clientRefId = newClientRefId();
      const now = new Date().toISOString();
      // 构造 Entry（snake_case payload · 对齐 sync-protocol.md §2.1）
      await putEntry({
        client_ref_id: clientRefId,
        ledger_id: 'default', // TODO(COSTRA-104): 从当前活跃账本取 ledger_id
        amount: cents,
        currency: 'CNY',
        type: this.data.type,
        category_id: this.data.categoryId || null,
        note: this.data.note,
        occurred_at: now,
        dirty: true,
      });
      // 入 outbox（snake_case payload · 驼峰 amountCents/categoryId/occurredAt 已修正）
      await enqueue({
        op: 'create',
        entity: 'entry',
        client_ref_id: clientRefId,
        base_version: null,
        payload: {
          ledger_id: 'default',
          amount: cents,
          currency: 'CNY',
          type: this.data.type,
          category_id: this.data.categoryId || null,
          note: this.data.note,
          occurred_at: now,
        },
      });
      wx.showToast({ title: '已记录', icon: 'success' });
      setTimeout(() => wx.navigateBack(), 400);
    } catch (e: any) {
      wx.showToast({ title: e?.message || '保存失败', icon: 'none' });
    } finally {
      this.setData({ submitting: false });
    }
  },
});
