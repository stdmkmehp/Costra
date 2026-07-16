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
    it('纯数字："12.34" → "12.34"', () => {
      expect(parseClipboardToAmount('12.34')).toBe('12.34');
    });

    it('带货币符号："￥12.34" / "¥12.34" / "$12.34" → "12.34"', () => {
      expect(parseClipboardToAmount('￥12.34')).toBe('12.34');
      expect(parseClipboardToAmount('¥12.34')).toBe('12.34');
      expect(parseClipboardToAmount('$12.34')).toBe('12.34');
    });

    it('含中文："共 ¥12.34 元" → "12.34"', () => {
      expect(parseClipboardToAmount('共 ¥12.34 元')).toBe('12.34');
    });

    it('千分位："12,345.67" → "12345.67"', () => {
      expect(parseClipboardToAmount('12,345.67')).toBe('12345.67');
    });

    it('全角数字："１２.３４" → "12.34"', () => {
      expect(parseClipboardToAmount('１２.３４')).toBe('12.34');
    });

    it('全角点："12．34" → "12.34"；中文句号："12。34" → "12.34"', () => {
      expect(parseClipboardToAmount('12．34')).toBe('12.34');
      expect(parseClipboardToAmount('12。34')).toBe('12.34');
    });

    it('去尾零："12.30" → "12.3"；"12.00" → "12"', () => {
      expect(parseClipboardToAmount('12.30')).toBe('12.3');
      expect(parseClipboardToAmount('12.00')).toBe('12');
    });

    it('小数超2位 → 向零截断："19.999" → "19.99"', () => {
      expect(parseClipboardToAmount('19.999')).toBe('19.99');
    });

    it('负数取绝对值："-50" → "50"', () => {
      expect(parseClipboardToAmount('-50')).toBe('50');
    });

    it('CNY/RMB/人民币 词根剔除', () => {
      expect(parseClipboardToAmount('CNY 12.34')).toBe('12.34');
      expect(parseClipboardToAmount('RMB12.34')).toBe('12.34');
      expect(parseClipboardToAmount('人民币 12.34 元')).toBe('12.34');
    });

    it('无效输入 → null', () => {
      expect(parseClipboardToAmount('')).toBeNull();
      expect(parseClipboardToAmount('abc')).toBeNull();
      expect(parseClipboardToAmount('   ')).toBeNull();
    });

    it('紧邻英文字母的数字 → null（避免 abc123def 被识别）', () => {
      expect(parseClipboardToAmount('abc123def')).toBeNull();
      expect(parseClipboardToAmount('sku12.34item')).toBeNull();
    });

    it('0 视为无效："0" / "0.00" / "-0" → null', () => {
      expect(parseClipboardToAmount('0')).toBeNull();
      expect(parseClipboardToAmount('0.00')).toBeNull();
      expect(parseClipboardToAmount('-0')).toBeNull();
    });

    it('超上限（>8位整数） → null', () => {
      expect(parseClipboardToAmount('999999999')).toBeNull();
      expect(parseClipboardToAmount('99999999.99')).toBe('99999999.99');
    });

    it('首个合法匹配："12.34.56" 首段 → "12.34"（后续 .56 被丢弃）', () => {
      // 正则 \d+(?:\.\d+)? 会贪婪匹配 "12.34"，剩下 ".56" 因不满足前置数字被丢
      expect(parseClipboardToAmount('12.34.56')).toBe('12.34');
    });

    it('超长文本裁剪：>64 字符仍能取到前部数字', () => {
      const long = '¥12.34' + '_'.repeat(200) + '99.99';
      expect(parseClipboardToAmount(long)).toBe('12.34');
    });

    it('typeof 兜底：非字符串输入 → null', () => {
      // @ts-expect-error 故意传非法类型
      expect(parseClipboardToAmount(null)).toBeNull();
      // @ts-expect-error 故意传非法类型
      expect(parseClipboardToAmount(undefined)).toBeNull();
      // @ts-expect-error 故意传非法类型
      expect(parseClipboardToAmount(12.34)).toBeNull();
    });
  });
});
