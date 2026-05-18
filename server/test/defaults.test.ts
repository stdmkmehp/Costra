/**
 * Costra · Server · defaults 常量单测
 *
 * 卡号：COSTRA-157 · F 项 server 段
 *
 * 测 1：defaultNickname 值断言 = '微信用户'（防误删/误改 · 与 miniprogram 端对齐）
 *
 * 注：G7 闸门（grep 双端对账）+ 本测共同构成防漂移保障（Card-Review P1-2 采纳）
 */

import { describe, it, expect } from 'vitest';
import { defaultNickname } from '../src/config/defaults.js';

describe('defaults', () => {
  it('defaultNickname value matches miniprogram side (cross-side alignment)', () => {
    expect(defaultNickname).toBe('微信用户');
  });
});
