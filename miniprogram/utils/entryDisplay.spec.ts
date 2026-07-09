// utils/entryDisplay.spec.ts · 流水明细展示文案规则单测

import { describe, it, expect } from 'vitest';
import { resolveEntryDisplayNote } from './entryDisplay';

describe('utils/entryDisplay', () => {
  it('有备注时优先显示备注', () => {
    expect(resolveEntryDisplayNote('午饭', '外卖')).toBe('午饭');
  });

  it('无备注时回退显示二级分类名', () => {
    expect(resolveEntryDisplayNote(null, '外卖')).toBe('外卖');
    expect(resolveEntryDisplayNote('', '地铁')).toBe('地铁');
  });

  it('空白备注不视为有效备注', () => {
    expect(resolveEntryDisplayNote('   ', '超市')).toBe('超市');
  });

  it('备注和分类名都缺失时返回空串', () => {
    expect(resolveEntryDisplayNote(undefined, null)).toBe('');
  });
});
