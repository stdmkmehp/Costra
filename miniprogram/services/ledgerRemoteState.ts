// services/ledgerRemoteState.ts · 明细页 ledger/month 远端空态确认标记
//
// 用于区分「本地为空但远端未确认」与「远端已确认当前月确实为空」。
// 只在本地 storage 内保存，删除小程序 / 清缓存后自然失效。

import { getItem, setItem, removeItem } from './storage';

interface LedgerMonthRemoteState {
  ledgerId: string;
  month: string;
  confirmedEmpty: boolean;
  confirmedAt: number;
}

const SHANGHAI_OFFSET_MS = 8 * 60 * 60 * 1000;
const CURRENT_MONTH_CONFIRM_TTL_MS = 30 * 60 * 1000;
const HISTORY_MONTH_CONFIRM_TTL_MS = 7 * 24 * 60 * 60 * 1000;

function keyOf(ledgerId: string, month: string): string {
  return `ledger:remote-empty-confirmed:${ledgerId}:${month}`;
}

function currentShanghaiMonth(): string {
  return new Date(Date.now() + SHANGHAI_OFFSET_MS).toISOString().slice(0, 7);
}

function ttlForMonth(month: string): number {
  return month === currentShanghaiMonth() ? CURRENT_MONTH_CONFIRM_TTL_MS : HISTORY_MONTH_CONFIRM_TTL_MS;
}

export async function isLedgerMonthRemoteEmptyConfirmed(ledgerId: string, month: string): Promise<boolean> {
  if (!ledgerId || !month) return false;
  const state = await getItem<LedgerMonthRemoteState>(keyOf(ledgerId, month));
  if (!state?.confirmedEmpty || state.ledgerId !== ledgerId || state.month !== month) return false;
  if (Date.now() - state.confirmedAt > ttlForMonth(month)) {
    await removeItem(keyOf(ledgerId, month));
    return false;
  }
  return true;
}

export async function markLedgerMonthRemoteEmptyConfirmed(ledgerId: string, month: string): Promise<void> {
  if (!ledgerId || !month) return;
  await setItem<LedgerMonthRemoteState>(keyOf(ledgerId, month), {
    ledgerId,
    month,
    confirmedEmpty: true,
    confirmedAt: Date.now(),
  });
}

export async function clearLedgerMonthRemoteEmptyConfirmed(ledgerId: string, month: string): Promise<void> {
  if (!ledgerId || !month) return;
  await removeItem(keyOf(ledgerId, month));
}
