import { describe, expect, it } from 'vitest';
import { countYearMonthBadges, toggleLimitedSelection } from './recurring-selection';

describe('recurring selection helpers', () => {
  it('adds a new value below the limit', () => {
    expect(toggleLimitedSelection([1, 3], 5, 7)).toEqual({
      values: [1, 3, 5],
      limitRejected: false,
    });
  });

  it('removes an existing value even when the selection is full', () => {
    expect(toggleLimitedSelection([1, 2, 3, 4, 5, 6, 7], 4, 7)).toEqual({
      values: [1, 2, 3, 5, 6, 7],
      limitRejected: false,
    });
  });

  it('rejects an eighth weekday without changing the selection', () => {
    const current = [1, 2, 3, 4, 5, 6, 7];
    expect(toggleLimitedSelection(current, 8, 7)).toEqual({
      values: current,
      limitRejected: true,
    });
  });

  it('rejects the fifteenth monthly day', () => {
    const current = Array.from({ length: 14 }, (_, index) => index + 1);
    expect(toggleLimitedSelection(current, 31, 14).limitRejected).toBe(true);
  });

  it('keeps yearly choices across months and counts badges', () => {
    const first = toggleLimitedSelection([], 101, 12);
    const second = toggleLimitedSelection(first.values, 214, 12);
    const third = toggleLimitedSelection(second.values, 225, 12);

    expect(third.values).toEqual([101, 214, 225]);
    expect(countYearMonthBadges(third.values)).toEqual({ 1: 1, 2: 2 });
  });

  it('rejects the thirteenth yearly date without losing cross-month choices', () => {
    const current = [101, 201, 301, 401, 501, 601, 701, 801, 901, 1001, 1101, 1201];
    expect(toggleLimitedSelection(current, 102, 12)).toEqual({
      values: current,
      limitRejected: true,
    });
  });
});
