// pages/entry/index.ts
// 记一笔页：类型切换 + 数字键盘 + 分类 + 备注。骨架阶段提交走 services/sync.ts 本地队列。
// Refs: COSTRA-030, docs/design/flows/add-entry.md, ADR-0004 §4 金额精度
import { enqueueLocalEntry } from '../../services/sync';
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
      await enqueueLocalEntry({
        type: this.data.type,
        amountCents: cents,
        categoryId: this.data.categoryId || null,
        note: this.data.note,
        occurredAt: new Date().toISOString(),
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
