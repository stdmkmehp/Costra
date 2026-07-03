// services/entriesApi.ts · 流水列表 API 封装
// 契约事实源：server/api/openapi.yaml /entries

import { request } from './request';
import type { Entry } from './db';
import { parseShanghaiMonthRange } from '../utils/shanghaiDate';

export interface EntryApiItem {
  id: string;
  ledger_id: string;
  amount: number;
  currency: string;
  type: 'expense' | 'income' | 'transfer';
  category_id: string | null;
  account_id?: string | null;
  to_account_id?: string | null;
  note: string | null;
  occurred_at: string;
  created_by: string;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
  version: number;
  client_ref_id: string | null;
  shared_type: 'shared' | 'personal' | null;
}

interface EntryListResponse {
  entries?: EntryApiItem[];
  items?: EntryApiItem[];
  next_cursor: string | null;
}

export interface FetchMonthEntriesResult {
  entries: Entry[];
  nextCursor: string | null;
}

function toLocalEntry(item: EntryApiItem): Entry | null {
  if (!item.client_ref_id) return null;
  return {
    id: item.id,
    client_ref_id: item.client_ref_id,
    ledger_id: item.ledger_id,
    amount: item.amount,
    currency: item.currency,
    type: item.type,
    category_id: item.category_id ?? null,
    note: item.note ?? '',
    occurred_at: item.occurred_at,
    created_at: item.created_at,
    updated_at: item.updated_at,
    deleted_at: item.deleted_at,
    version: item.version,
    created_by: item.created_by,
    shared_type: item.shared_type ?? null,
  };
}

export async function fetchMonthEntries(opts: {
  ledgerId: string;
  month: string;
  limit?: number;
  cursor?: string | null;
}): Promise<FetchMonthEntriesResult> {
  const { rangeStartUtc: from, rangeEndUtc } = parseShanghaiMonthRange(opts.month);
  // 后端 /entries 当前是 occurred_at <= to，因此用下月起点 -1ms 模拟 [start,end)。
  const to = new Date(new Date(rangeEndUtc).getTime() - 1).toISOString();
  const data = await request<EntryListResponse>({
    method: 'GET',
    path: '/entries',
    query: {
      ledger_id: opts.ledgerId,
      from,
      to,
      limit: opts.limit ?? 100,
      cursor: opts.cursor || undefined,
    },
  });
  const rawEntries = data.entries ?? data.items ?? [];
  return {
    entries: rawEntries.map(toLocalEntry).filter((entry): entry is Entry => !!entry),
    nextCursor: data.next_cursor ?? null,
  };
}
