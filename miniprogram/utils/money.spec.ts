// utils/money.spec.ts · decimal.js 金额工具单测
// 卡号: COSTRA-102 · D2.10
// 追加: parseClipboardToAmount（记账面板"粘贴"键，2026-07-16）
import { describe, it, expect } from 'vitest';
import { toCents, toYuan, parseAmountInputToCents, parseClipboardToAmount } from './money';

describe('utils/money', () => {
  describe('toCents', () => {
    it('浮点精度：toCents("0.1") + toCents("0.2") 应 === 30（cents · 不复现 0.1+0.2 = 0.30000000000000004）', () => {
      expect(toCents('0.1') + toCents('0.2')).toBe(30);
    });

    it('负数：toCents("-1.23") === -123', () => {
      expect(toCents('-1.23')).toBe(-123);
    });
  });

  describe('toYuan', () => {
    it('基本：toYuan(30) === "0.30"', () => {
      expect(toYuan(30)).toBe('0.30');
    });

    it('整元补零：toYuan(12300) === "123.00"', () => {
      expect(toYuan(12300)).toBe('123.00');
    });
  });

  describe('parseAmountInputToCents', () => {
    it('键盘输入："12.34" → 1234', () => {
      expect(parseAmountInputToCents('12.34')).toBe(1234);
    });

    it('容错：空串 → 0；含字母 → 清洗后取数字', () => {
      expect(parseAmountInputToCents('')).toBe(0);
      expect(parseAmountInputToCents('abc5.67def')).toBe(567);
    });
  });

  describe('parseClipboardToAmount（粘贴键金额清洗）', () => {
    it('纯数字："12.34" → ok 12.34', () => {
      expect(parseClipboardToAmount('12.34')).toEqual({ ok: true, value: '12.34' });
    });

    it('带货币符号："￥12.34" / "¥12.34" / "$12.34" → ok 12.34', () => {
      expect(parseClipboardToAmount('￥12.34')).toEqual({ ok: true, value: '12.34' });
      expect(parseClipboardToAmount('¥12.34')).toEqual({ ok: true, value: '12.34' });
      expect(parseClipboardToAmount('$12.34')).toEqual({ ok: true, value: '12.34' });
    });

    it('含中文："共 ¥12.34 元" → ok 12.34', () => {
      expect(parseClipboardToAmount('共 ¥12.34 元')).toEqual({ ok: true, value: '12.34' });
    });

    it('千分位："12,345.67" → ok 12345.67', () => {
      expect(parseClipboardToAmount('12,345.67')).toEqual({ ok: true, value: '12345.67' });
    });

    it('全角数字："１２.３４" → ok 12.34', () => {
      expect(parseClipboardToAmount('１２.３４')).toEqual({ ok: true, value: '12.34' });
    });

    it('全角点："12．34" → ok 12.34；中文句号："12。34" → ok 12.34', () => {
      expect(parseClipboardToAmount('12．34')).toEqual({ ok: true, value: '12.34' });
      expect(parseClipboardToAmount('12。34')).toEqual({ ok: true, value: '12.34' });
    });

    it('去尾零："12.30" → ok 12.3；"12.00" → ok 12', () => {
      expect(parseClipboardToAmount('12.30')).toEqual({ ok: true, value: '12.3' });
      expect(parseClipboardToAmount('12.00')).toEqual({ ok: true, value: '12' });
    });

    it('小数超2位 → 向零截断："19.999" → ok 19.99', () => {
      expect(parseClipboardToAmount('19.999')).toEqual({ ok: true, value: '19.99' });
    });

    it('负数取绝对值："-50" → ok 50', () => {
      expect(parseClipboardToAmount('-50')).toEqual({ ok: true, value: '50' });
    });

    it('CNY/RMB/人民币 词根剔除', () => {
      expect(parseClipboardToAmount('CNY 12.34')).toEqual({ ok: true, value: '12.34' });
      expect(parseClipboardToAmount('RMB12.34')).toEqual({ ok: true, value: '12.34' });
      expect(parseClipboardToAmount('人民币 12.34 元')).toEqual({ ok: true, value: '12.34' });
    });

    // ─── reason 细化（2026-07-16）─────────────────────────────────────────────

    it('reason=empty：空串 / 纯空白 / null / undefined', () => {
      expect(parseClipboardToAmount('')).toEqual({ ok: false, reason: 'empty' });
      expect(parseClipboardToAmount('   ')).toEqual({ ok: false, reason: 'empty' });
      // 参数类型是 unknown（异步 API 返回视为不可信），null / undefined / 数字都要被兜住
      expect(parseClipboardToAmount(null)).toEqual({ ok: false, reason: 'empty' });
      expect(parseClipboardToAmount(undefined)).toEqual({ ok: false, reason: 'empty' });
      expect(parseClipboardToAmount(12.34)).toEqual({ ok: false, reason: 'empty' });
    });

    it('reason=no-number：纯字母 / 混合字母数字 / 无数字符号', () => {
      expect(parseClipboardToAmount('abc')).toEqual({ ok: false, reason: 'no-number' });
      expect(parseClipboardToAmount('abc123def')).toEqual({ ok: false, reason: 'no-number' });
      expect(parseClipboardToAmount('sku12.34item')).toEqual({ ok: false, reason: 'no-number' });
    });

    it('reason=zero："0" / "0.00" / "-0" / 截断后为 0 的 "0.001"', () => {
      expect(parseClipboardToAmount('0')).toEqual({ ok: false, reason: 'zero' });
      expect(parseClipboardToAmount('0.00')).toEqual({ ok: false, reason: 'zero' });
      expect(parseClipboardToAmount('-0')).toEqual({ ok: false, reason: 'zero' });
      expect(parseClipboardToAmount('0.001')).toEqual({ ok: false, reason: 'zero' });
    });

    it('reason=overflow：整数位 >8 位', () => {
      expect(parseClipboardToAmount('999999999')).toEqual({ ok: false, reason: 'overflow' });
      expect(parseClipboardToAmount('123456789.00')).toEqual({ ok: false, reason: 'overflow' });
      // 边界：8 位整数刚好通过
      expect(parseClipboardToAmount('99999999.99')).toEqual({ ok: true, value: '99999999.99' });
    });

    it('首个合法匹配："12.34.56" → ok 12.34', () => {
      expect(parseClipboardToAmount('12.34.56')).toEqual({ ok: true, value: '12.34' });
    });

    it('超长文本裁剪：>64 字符仍能取到前部数字', () => {
      const long = '¥12.34' + '_'.repeat(200) + '99.99';
      expect(parseClipboardToAmount(long)).toEqual({ ok: true, value: '12.34' });
    });
  });
});
