import type { FastifyInstance } from 'fastify';
import { getPool } from '../../src/db/pool.js';

let app: FastifyInstance;

export function setFamilySummaryTestApp(instance: FastifyInstance): void {
  app = instance;
}

export async function registerUser(openid: string): Promise<{ token: string; userId: string }> {
  const { setWxFetchForTests } = await import('../../src/wx/code2Session.js');
  setWxFetchForTests((async (_input: RequestInfo | URL): Promise<Response> => {
    return new Response(
      JSON.stringify({ openid, session_key: 'mock-session-key' }),
      { status: 200, headers: { 'content-type': 'application/json' } },
    );
  }) as unknown as typeof fetch);

  const res = await app.inject({
    method: 'POST',
    url: '/v1/auth/wx-login',
    payload: { code: `code-${openid}` },
  });
  const body = res.json();
  return { token: body.access_token, userId: body.user.id };
}

export function authHeaders(token: string) {
  return { authorization: `Bearer ${token}` };
}

export async function createSharedFamilyWithMembers(
  ownerToken: string,
  memberTokens: string[],
): Promise<string> {
  const createRes = await app.inject({
    method: 'POST',
    url: '/v1/families',
    headers: { ...authHeaders(ownerToken), 'idempotency-key': `create-${Date.now()}` },
    payload: { name: '测试共享家庭' },
  });
  const familyId = createRes.json().id;

  for (let i = 0; i < memberTokens.length; i++) {
    const inviteRes = await app.inject({
      method: 'POST',
      url: `/v1/families/${familyId}/invites`,
      headers: { ...authHeaders(ownerToken), 'idempotency-key': `invite-${familyId}-${i}` },
      payload: { role: 'member' },
    });
    const inviteToken = inviteRes.json().invite_token;

    await app.inject({
      method: 'POST',
      url: '/v1/families/invites/accept',
      headers: { ...authHeaders(memberTokens[i]), 'idempotency-key': `accept-${familyId}-${i}` },
      payload: { invite_token: inviteToken },
    });
  }

  return familyId;
}

export async function insertEntry(params: {
  ledgerId: string;
  amount: number;
  type: 'income' | 'expense' | 'transfer';
  createdBy: string;
  occurredAt: string;
  categoryId?: string | null;
  sharedType?: 'personal' | 'shared' | null;
}): Promise<void> {
  const id = crypto.randomUUID();
  await getPool().query(
    `INSERT INTO entries (id, ledger_id, amount, currency, type, category_id, occurred_at, created_by, shared_type)
     VALUES ($1, $2, $3, 'CNY', $4, $5, $6, $7, $8)`,
    [
      id,
      params.ledgerId,
      params.amount,
      params.type,
      params.categoryId ?? null,
      params.occurredAt,
      params.createdBy,
      params.sharedType ?? null,
    ],
  );
}

export async function getLedgerId(familyId: string): Promise<string> {
  const res = await getPool().query(
    'SELECT id FROM ledgers WHERE family_id = $1 AND deleted_at IS NULL LIMIT 1',
    [familyId],
  );
  return res.rows[0].id;
}

export async function insertCategory(params: {
  name: string;
  type: 'income' | 'expense';
  icon: string;
  familyId?: string | null;
  parentId?: string | null;
}): Promise<string> {
  const id = crypto.randomUUID();
  await getPool().query(
    `INSERT INTO categories (id, family_id, name, type, icon, parent_id)
     VALUES ($1, $2, $3, $4, $5, $6)`,
    [id, params.familyId ?? null, params.name, params.type, params.icon, params.parentId ?? null],
  );
  return id;
}
