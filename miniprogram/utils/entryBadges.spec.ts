import { describe, expect, it } from 'vitest';
import { computeBadges } from './entryBadges';

describe('computeBadges', () => {
  it.each([
    {
      label: '非公非定',
      input: { shared_type: 'personal' as const, source_recurring_id: null },
      expected: { showRecurring: false, showShared: false },
    },
    {
      label: '公非定',
      input: { shared_type: 'shared' as const, source_recurring_id: null },
      expected: { showRecurring: false, showShared: true },
    },
    {
      label: '非公定',
      input: { shared_type: 'personal' as const, source_recurring_id: 'rule-1' },
      expected: { showRecurring: true, showShared: false },
    },
    {
      label: '公且定',
      input: { shared_type: 'shared' as const, source_recurring_id: 'rule-1' },
      expected: { showRecurring: true, showShared: true },
    },
  ])('$label', ({ input, expected }) => {
    expect(computeBadges(input)).toEqual(expected);
  });

  it('does not treat an empty source id as recurring', () => {
    expect(computeBadges({ source_recurring_id: '' }).showRecurring).toBe(false);
  });

  it('treats missing legacy fields as non-recurring and non-shared', () => {
    expect(computeBadges({})).toEqual({
      showRecurring: false,
      showShared: false,
    });
  });

  it('keeps shared visible when only the recurring source field is missing', () => {
    expect(computeBadges({ shared_type: 'shared' })).toEqual({
      showRecurring: false,
      showShared: true,
    });
  });
});
