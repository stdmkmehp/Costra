import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  isLedgerMonthRemoteEmptyConfirmed,
  markLedgerMonthRemoteEmptyConfirmed,
  clearLedgerMonthRemoteEmptyConfirmed,
} from './ledgerRemoteState';

let mockStore: Map<string, unknown>;

function mockWx() {
  return {
    getStorage: <T>({ key }: { key: string }): Promise<{ data: T }> => {
      if (mockStore.has(key)) return Promise.resolve({ data: mockStore.get(key) as T });
      return Promise.reject({ errMsg: 'getStorage:fail data not found' });
    },
    setStorage: <T>({ key, data }: { key: string; data: T }): Promise<void> => {
      mockStore.set(key, data);
      return Promise.resolve();
    },
    removeStorage: ({ key }: { key: string }): Promise<void> => {
      mockStore.delete(key);
      return Promise.resolve();
    },
  };
}

describe('ledgerRemoteState', () => {
  beforeEach(() => {
    mockStore = new Map();
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-07-03T08:00:00.000Z'));
    (globalThis as unknown as { wx: ReturnType<typeof mockWx> }).wx = mockWx();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('mark / read / clear ledger-month empty confirmation', async () => {
    await markLedgerMonthRemoteEmptyConfirmed('ledger-1', '2026-07');
    await expect(isLedgerMonthRemoteEmptyConfirmed('ledger-1', '2026-07')).resolves.toBe(true);

    await clearLedgerMonthRemoteEmptyConfirmed('ledger-1', '2026-07');
    await expect(isLedgerMonthRemoteEmptyConfirmed('ledger-1', '2026-07')).resolves.toBe(false);
  });

  it('current month confirmation expires after TTL', async () => {
    await markLedgerMonthRemoteEmptyConfirmed('ledger-1', '2026-07');
    vi.setSystemTime(new Date('2026-07-03T08:31:00.000Z'));

    await expect(isLedgerMonthRemoteEmptyConfirmed('ledger-1', '2026-07')).resolves.toBe(false);
  });
});
