/**
 * Costra · Server · families 测试
 *
 * 卡号：COSTRA-221 · 事实源：dispatch §3.F 测试矩阵 T1~T16
 *
 * 覆盖：
 *   T1  登录 bootstrap 后 GET /families
 *   T2  POST /families 创建 shared family
 *   T3  非登录访问 family endpoints
 *   T4  非 member 读取 detail/members
 *   T5  personal family 创建 invite
 *   T6  shared family owner 创建 invite
 *   T7  invite accept
 *   T8  expired invite accept
 *   T9  owner remove member
 *   T10 removed member 权限
 *   T11 owner remove self
 *   T12 GET /families/{id}/members 包含 active + left
 *   T13 PATCH /families/{id}
 *   T14 DELETE /families/{id}
 *   T15 shared family member 上限
 *   T16 OpenAPI ErrorCode FAMILY_PERSONAL_NOT_DELETABLE
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { buildApp } from '../src/app.js';
import type { FastifyInstance } from 'fastify';
import { getPool } from '../src/db/pool.js';
import { ErrorCode } from '../src/errors/ErrorCode.js';

let app: FastifyInstance;

/** 辅助：注册用户并返回 access_token + userId */
async function registerUser(openid: string): Promise<{ token: string; userId: string }> {
  // wx-login mock 在 setup.ts 中已默认注入
  // 每个用户需要不同的 openid → override wxFetch
  const { setWxFetchForTests } = await import('../src/wx/code2Session.js');
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

/** 辅助：带 JWT 的请求 */
function authHeaders(token: string) {
  return { authorization: `Bearer ${token}` };
}

beforeEach(async () => {
  app = await buildApp({ disableLogger: true });
});

describe('COSTRA-221: Family Management API', () => {
  // T1: 登录 bootstrap 后 GET /families 返回 personal family + ledger 信息 + kind=personal
  it('T1: GET /families returns personal family with ledger info after login', async () => {
    const { token, userId } = await registerUser('t1-user');

    const res = await app.inject({
      method: 'GET',
      url: '/v1/families',
      headers: authHeaders(token),
    });

    expect(res.statusCode).toBe(200);
    const families = res.json();
    expect(families.length).toBeGreaterThanOrEqual(1);

    const personal = families.find((f: { kind: string }) => f.kind === 'personal');
    expect(personal).toBeDefined();
    expect(personal.kind).toBe('personal');
    expect(personal.ledger_id).toBeTruthy();
    expect(personal.ledger_name).toBeTruthy();
    expect(personal.member_count).toBe(1);
    expect(personal.owner_id).toBe(userId);
  });

  // T2: POST /families 创建 shared family
  it('T2: POST /families creates shared family with owner member and default ledger', async () => {
    const { token, userId } = await registerUser('t2-user');

    const res = await app.inject({
      method: 'POST',
      url: '/v1/families',
      headers: { ...authHeaders(token), 'idempotency-key': 't2-create-family-001' },
      payload: { name: '测试家庭' },
    });

    expect(res.statusCode).toBe(201);
    const family = res.json();
    expect(family.kind).toBe('shared');
    expect(family.name).toBe('测试家庭');
    expect(family.ledger_id).toBeTruthy();
    expect(family.ledger_name).toBe('测试家庭');
    expect(family.member_count).toBe(1);

    // 验证 owner 在 members 中
    const detailRes = await app.inject({
      method: 'GET',
      url: `/v1/families/${family.id}`,
      headers: authHeaders(token),
    });
    const detail = detailRes.json();
    const owner = detail.members.find((m: { role: string }) => m.role === 'owner');
    expect(owner).toBeDefined();
    expect(owner.user_id).toBe(userId);
  });

  // T3: 非登录访问 family endpoints
  it('T3: unauthenticated access returns 401', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/v1/families',
    });
    expect(res.statusCode).toBe(401);
    expect(res.json().code).toBe('UNAUTHENTICATED');
  });

  // T4: 非 member 读取 detail/members
  it('T4: non-member access returns 403 FAMILY_NOT_MEMBER', async () => {
    const { token: ownerToken } = await registerUser('t4-owner');
    const { token: outsiderToken } = await registerUser('t4-outsider');

    // owner 创建 shared family
    const createRes = await app.inject({
      method: 'POST',
      url: '/v1/families',
      headers: { ...authHeaders(ownerToken), 'idempotency-key': 't4-create-001' },
      payload: { name: 'T4家庭' },
    });
    const familyId = createRes.json().id;

    // outsider 读取 detail
    const detailRes = await app.inject({
      method: 'GET',
      url: `/v1/families/${familyId}`,
      headers: authHeaders(outsiderToken),
    });
    expect(detailRes.statusCode).toBe(403);
    expect(detailRes.json().code).toBe('FAMILY_NOT_MEMBER');

    // outsider 读取 members
    const membersRes = await app.inject({
      method: 'GET',
      url: `/v1/families/${familyId}/members`,
      headers: authHeaders(outsiderToken),
    });
    expect(membersRes.statusCode).toBe(403);
    expect(membersRes.json().code).toBe('FAMILY_NOT_MEMBER');
  });

  // T5: personal family 创建 invite → 422 BUSINESS_RULE_VIOLATION + details.rule=personal_family_not_invitable
  it('T5: personal family invite rejected with 422', async () => {
    const { token } = await registerUser('t5-user');

    // 获取 personal family id
    const listRes = await app.inject({
      method: 'GET',
      url: '/v1/families',
      headers: authHeaders(token),
    });
    const personalFamily = listRes.json().find((f: { kind: string }) => f.kind === 'personal');
    expect(personalFamily).toBeDefined();

    // 尝试创建 invite
    const inviteRes = await app.inject({
      method: 'POST',
      url: `/v1/families/${personalFamily.id}/invites`,
      headers: { ...authHeaders(token), 'idempotency-key': 't5-invite-001' },
      payload: { role: 'member' },
    });

    expect(inviteRes.statusCode).toBe(422);
    expect(inviteRes.json().code).toBe('BUSINESS_RULE_VIOLATION');
    expect(inviteRes.json().details.rule).toBe('personal_family_not_invitable');
  });

  // T6: shared family owner 创建 invite
  it('T6: shared family owner creates invite', async () => {
    const { token } = await registerUser('t6-owner');

    const createRes = await app.inject({
      method: 'POST',
      url: '/v1/families',
      headers: { ...authHeaders(token), 'idempotency-key': 't6-create-001' },
      payload: { name: 'T6家庭' },
    });
    const familyId = createRes.json().id;

    const inviteRes = await app.inject({
      method: 'POST',
      url: `/v1/families/${familyId}/invites`,
      headers: { ...authHeaders(token), 'idempotency-key': 't6-invite-001' },
      payload: { role: 'member', ttl_hours: 48 },
    });

    expect(inviteRes.statusCode).toBe(201);
    const invite = inviteRes.json();
    expect(invite.invite_token).toBeTruthy();
    expect(invite.role).toBe('member');
    expect(invite.family_id).toBe(familyId);
    expect(invite.id).toBeTruthy();
    // expires_at 应在未来
    expect(new Date(invite.expires_at).getTime()).toBeGreaterThan(Date.now() - 1000);
  });

  // T6b: revoke invite
  it('T6b: revoked invite cannot be previewed or accepted', async () => {
    const { token: ownerToken } = await registerUser('t6b-owner');
    const { token: memberToken } = await registerUser('t6b-member');

    const createRes = await app.inject({
      method: 'POST',
      url: '/v1/families',
      headers: { ...authHeaders(ownerToken), 'idempotency-key': 't6b-create-001' },
      payload: { name: 'T6B家庭' },
    });
    const familyId = createRes.json().id;

    const inviteRes = await app.inject({
      method: 'POST',
      url: `/v1/families/${familyId}/invites`,
      headers: { ...authHeaders(ownerToken), 'idempotency-key': 't6b-invite-001' },
      payload: { role: 'member' },
    });
    const invite = inviteRes.json();

    const revokeRes = await app.inject({
      method: 'DELETE',
      url: `/v1/families/${familyId}/invites/${invite.id}`,
      headers: authHeaders(ownerToken),
    });
    expect(revokeRes.statusCode).toBe(204);

    const previewRes = await app.inject({
      method: 'GET',
      url: `/v1/families/invites/preview?token=${invite.invite_token}`,
      headers: authHeaders(memberToken),
    });
    expect(previewRes.statusCode).toBe(410);
    expect(previewRes.json().code).toBe('INVITE_EXPIRED');

    const acceptRes = await app.inject({
      method: 'POST',
      url: '/v1/families/invites/accept',
      headers: { ...authHeaders(memberToken), 'idempotency-key': 't6b-accept-001' },
      payload: { invite_token: invite.invite_token },
    });
    expect(acceptRes.statusCode).toBe(410);
    expect(acceptRes.json().code).toBe('INVITE_EXPIRED');
  });

  // T7: invite accept
  it('T7: invite accept works; duplicate accept returns 410', async () => {
    const { token: ownerToken } = await registerUser('t7-owner');
    const { token: memberToken } = await registerUser('t7-member');

    // 创建 shared family
    const createRes = await app.inject({
      method: 'POST',
      url: '/v1/families',
      headers: { ...authHeaders(ownerToken), 'idempotency-key': 't7-create-001' },
      payload: { name: 'T7家庭' },
    });
    const familyId = createRes.json().id;

    // 创建 invite
    const inviteRes = await app.inject({
      method: 'POST',
      url: `/v1/families/${familyId}/invites`,
      headers: { ...authHeaders(ownerToken), 'idempotency-key': 't7-invite-001' },
      payload: { role: 'member' },
    });
    const inviteToken = inviteRes.json().invite_token;

    // 新用户 accept
    const acceptRes = await app.inject({
      method: 'POST',
      url: '/v1/families/invites/accept',
      headers: { ...authHeaders(memberToken), 'idempotency-key': 't7-accept-001' },
      payload: { invite_token: inviteToken },
    });
    expect(acceptRes.statusCode).toBe(200);
    expect(acceptRes.json().id).toBe(familyId);

    // 重复 accept → 410
    const acceptRes2 = await app.inject({
      method: 'POST',
      url: '/v1/families/invites/accept',
      headers: { ...authHeaders(memberToken), 'idempotency-key': 't7-accept-002' },
      payload: { invite_token: inviteToken },
    });
    expect(acceptRes2.statusCode).toBe(410);
    expect(acceptRes2.json().code).toBe('INVITE_EXPIRED');
  });

  // T8: expired invite accept
  it('T8: expired invite returns 410', async () => {
    const { token: ownerToken } = await registerUser('t8-owner');
    const { token: memberToken } = await registerUser('t8-member');

    const createRes = await app.inject({
      method: 'POST',
      url: '/v1/families',
      headers: { ...authHeaders(ownerToken), 'idempotency-key': 't8-create-001' },
      payload: { name: 'T8家庭' },
    });
    const familyId = createRes.json().id;

    // 创建 invite（1小时过期）
    const inviteRes = await app.inject({
      method: 'POST',
      url: `/v1/families/${familyId}/invites`,
      headers: { ...authHeaders(ownerToken), 'idempotency-key': 't8-invite-001' },
      payload: { role: 'member', ttl_hours: 1 },
    });
    const inviteToken = inviteRes.json().invite_token;

    // 手动将 invite 标记为过期（直接操作 DB）
    await getPool().query(
      `UPDATE family_invites SET expires_at = now() - interval '1 hour' WHERE invite_token = $1`,
      [inviteToken],
    );

    const acceptRes = await app.inject({
      method: 'POST',
      url: '/v1/families/invites/accept',
      headers: { ...authHeaders(memberToken), 'idempotency-key': 't8-accept-001' },
      payload: { invite_token: inviteToken },
    });
    expect(acceptRes.statusCode).toBe(410);
    expect(acceptRes.json().code).toBe('INVITE_EXPIRED');
  });

  // T9: owner remove member
  it('T9: owner removes member; member status=left', async () => {
    const { token: ownerToken } = await registerUser('t9-owner');
    const { token: memberToken, userId: memberUserId } = await registerUser('t9-member');

    const createRes = await app.inject({
      method: 'POST',
      url: '/v1/families',
      headers: { ...authHeaders(ownerToken), 'idempotency-key': 't9-create-001' },
      payload: { name: 'T9家庭' },
    });
    const familyId = createRes.json().id;

    // 创建 invite + accept
    const inviteRes = await app.inject({
      method: 'POST',
      url: `/v1/families/${familyId}/invites`,
      headers: { ...authHeaders(ownerToken), 'idempotency-key': 't9-invite-001' },
      payload: { role: 'member' },
    });
    const inviteToken = inviteRes.json().invite_token;

    await app.inject({
      method: 'POST',
      url: '/v1/families/invites/accept',
      headers: { ...authHeaders(memberToken), 'idempotency-key': 't9-accept-001' },
      payload: { invite_token: inviteToken },
    });

    // owner remove member
    const removeRes = await app.inject({
      method: 'DELETE',
      url: `/v1/families/${familyId}/members/${memberUserId}`,
      headers: authHeaders(ownerToken),
    });
    expect(removeRes.statusCode).toBe(204);

    // 验证 members 列表中该成员 status=left
    const membersRes = await app.inject({
      method: 'GET',
      url: `/v1/families/${familyId}/members`,
      headers: authHeaders(ownerToken),
    });
    const members = membersRes.json();
    const removed = members.find((m: { user_id: string }) => m.user_id === memberUserId);
    expect(removed).toBeDefined();
    expect(removed.status).toBe('left');
    expect(removed.left_at).toBeTruthy();
  });

  // T10: removed member 权限
  it('T10: removed member cannot access family detail/members', async () => {
    const { token: ownerToken } = await registerUser('t10-owner');
    const { token: memberToken, userId: memberUserId } = await registerUser('t10-member');

    const createRes = await app.inject({
      method: 'POST',
      url: '/v1/families',
      headers: { ...authHeaders(ownerToken), 'idempotency-key': 't10-create-001' },
      payload: { name: 'T10家庭' },
    });
    const familyId = createRes.json().id;

    // invite + accept
    const inviteRes = await app.inject({
      method: 'POST',
      url: `/v1/families/${familyId}/invites`,
      headers: { ...authHeaders(ownerToken), 'idempotency-key': 't10-invite-001' },
      payload: { role: 'member' },
    });
    await app.inject({
      method: 'POST',
      url: '/v1/families/invites/accept',
      headers: { ...authHeaders(memberToken), 'idempotency-key': 't10-accept-001' },
      payload: { invite_token: inviteRes.json().invite_token },
    });

    // owner remove member
    await app.inject({
      method: 'DELETE',
      url: `/v1/families/${familyId}/members/${memberUserId}`,
      headers: authHeaders(ownerToken),
    });

    // removed member 不能读 detail
    const detailRes = await app.inject({
      method: 'GET',
      url: `/v1/families/${familyId}`,
      headers: authHeaders(memberToken),
    });
    expect(detailRes.statusCode).toBe(403);
    expect(detailRes.json().code).toBe('FAMILY_NOT_MEMBER');

    // removed member 不能读 members
    const membersRes = await app.inject({
      method: 'GET',
      url: `/v1/families/${familyId}/members`,
      headers: authHeaders(memberToken),
    });
    expect(membersRes.statusCode).toBe(403);
    expect(membersRes.json().code).toBe('FAMILY_NOT_MEMBER');
  });

  // T11: owner remove self → 403 FAMILY_PERSONAL_NOT_DELETABLE
  it('T11: owner cannot remove self', async () => {
    const { token, userId } = await registerUser('t11-owner');

    const createRes = await app.inject({
      method: 'POST',
      url: '/v1/families',
      headers: { ...authHeaders(token), 'idempotency-key': 't11-create-001' },
      payload: { name: 'T11家庭' },
    });
    const familyId = createRes.json().id;

    const removeRes = await app.inject({
      method: 'DELETE',
      url: `/v1/families/${familyId}/members/${userId}`,
      headers: authHeaders(token),
    });
    expect(removeRes.statusCode).toBe(403);
    expect(removeRes.json().code).toBe('FAMILY_PERSONAL_NOT_DELETABLE');
  });

  // T12: GET /families/{id}/members 包含 active + left
  it('T12: members list contains active + left; active first', async () => {
    const { token: ownerToken } = await registerUser('t12-owner');
    const { token: memberToken, userId: memberUserId } = await registerUser('t12-member');

    const createRes = await app.inject({
      method: 'POST',
      url: '/v1/families',
      headers: { ...authHeaders(ownerToken), 'idempotency-key': 't12-create-001' },
      payload: { name: 'T12家庭' },
    });
    const familyId = createRes.json().id;

    // invite + accept
    const inviteRes = await app.inject({
      method: 'POST',
      url: `/v1/families/${familyId}/invites`,
      headers: { ...authHeaders(ownerToken), 'idempotency-key': 't12-invite-001' },
      payload: { role: 'member' },
    });
    await app.inject({
      method: 'POST',
      url: '/v1/families/invites/accept',
      headers: { ...authHeaders(memberToken), 'idempotency-key': 't12-accept-001' },
      payload: { invite_token: inviteRes.json().invite_token },
    });

    // remove member
    await app.inject({
      method: 'DELETE',
      url: `/v1/families/${familyId}/members/${memberUserId}`,
      headers: authHeaders(ownerToken),
    });

    // 获取 members
    const membersRes = await app.inject({
      method: 'GET',
      url: `/v1/families/${familyId}/members`,
      headers: authHeaders(ownerToken),
    });
    expect(membersRes.statusCode).toBe(200);
    const members = membersRes.json();

    const activeMembers = members.filter((m: { status: string }) => m.status === 'active');
    const leftMembers = members.filter((m: { status: string }) => m.status === 'left');

    // active 在前，left 在后
    const firstLeftIdx = members.findIndex((m: { status: string }) => m.status === 'left');
    const lastActiveIdx = members.map((m: { status: string }) => m.status === 'active').lastIndexOf(true);
    if (firstLeftIdx !== -1 && lastActiveIdx !== -1) {
      expect(lastActiveIdx).toBeLessThan(firstLeftIdx);
    }

    // active/left 成员均存在，且 left member 有 left_at
    expect(activeMembers.length).toBeGreaterThanOrEqual(1);
    expect(leftMembers.length).toBeGreaterThanOrEqual(1);
    expect(leftMembers[0].left_at).toBeTruthy();
  });

  // T13: PATCH /families/{id}
  it('T13: owner can rename family; non-owner rejected; version conflict 409', async () => {
    const { token: ownerToken } = await registerUser('t13-owner');
    const { token: memberToken } = await registerUser('t13-member');

    const createRes = await app.inject({
      method: 'POST',
      url: '/v1/families',
      headers: { ...authHeaders(ownerToken), 'idempotency-key': 't13-create-001' },
      payload: { name: '原名' },
    });
    const familyId = createRes.json().id;
    const version = createRes.json().version;

    // invite + accept（让 member 加入）
    const inviteRes = await app.inject({
      method: 'POST',
      url: `/v1/families/${familyId}/invites`,
      headers: { ...authHeaders(ownerToken), 'idempotency-key': 't13-invite-001' },
      payload: { role: 'member' },
    });
    await app.inject({
      method: 'POST',
      url: '/v1/families/invites/accept',
      headers: { ...authHeaders(memberToken), 'idempotency-key': 't13-accept-001' },
      payload: { invite_token: inviteRes.json().invite_token },
    });

    // owner 改名
    const patchRes = await app.inject({
      method: 'PATCH',
      url: `/v1/families/${familyId}`,
      headers: authHeaders(ownerToken),
      payload: { name: '新名', version },
    });
    expect(patchRes.statusCode).toBe(200);
    expect(patchRes.json().name).toBe('新名');
    expect(patchRes.json().version).toBe(version + 1);

    // 非 owner 改名 → 403
    const patchRes2 = await app.inject({
      method: 'PATCH',
      url: `/v1/families/${familyId}`,
      headers: authHeaders(memberToken),
      payload: { name: '非法改名', version: patchRes.json().version },
    });
    expect(patchRes2.statusCode).toBe(403);

    // version conflict → 409
    const patchRes3 = await app.inject({
      method: 'PATCH',
      url: `/v1/families/${familyId}`,
      headers: authHeaders(ownerToken),
      payload: { name: '冲突改名', version: 1 },
    });
    expect(patchRes3.statusCode).toBe(409);
    expect(patchRes3.json().code).toBe('VERSION_CONFLICT');
  });

  // T14: DELETE /families/{id}
  it('T14: shared owner can soft-delete; personal rejected; version conflict 409', async () => {
    const { token: ownerToken } = await registerUser('t14-owner');

    // 创建 shared family
    const createRes = await app.inject({
      method: 'POST',
      url: '/v1/families',
      headers: { ...authHeaders(ownerToken), 'idempotency-key': 't14-create-001' },
      payload: { name: 'T14家庭' },
    });
    const sharedFamilyId = createRes.json().id;
    const sharedVersion = createRes.json().version;

    // 删除 shared family（version 通过 querystring 传递）
    const deleteRes = await app.inject({
      method: 'DELETE',
      url: `/v1/families/${sharedFamilyId}?version=${sharedVersion}`,
      headers: { ...authHeaders(ownerToken), 'idempotency-key': 't14-delete-001' },
    });
    expect(deleteRes.statusCode).toBe(204);

    // personal family 不可删
    const listRes = await app.inject({
      method: 'GET',
      url: '/v1/families',
      headers: authHeaders(ownerToken),
    });
    const personalFamily = listRes.json().find((f: { kind: string }) => f.kind === 'personal');
    expect(personalFamily).toBeDefined();

    const deletePersonalRes = await app.inject({
      method: 'DELETE',
      url: `/v1/families/${personalFamily.id}?version=${personalFamily.version}`,
      headers: { ...authHeaders(ownerToken), 'idempotency-key': 't14-delete-personal-001' },
    });
    expect(deletePersonalRes.statusCode).toBe(403);
    expect(deletePersonalRes.json().code).toBe('FAMILY_PERSONAL_NOT_DELETABLE');

    // version conflict：先 PATCH 使 version=2，再用 version=1 DELETE → 409
    const createRes2 = await app.inject({
      method: 'POST',
      url: '/v1/families',
      headers: { ...authHeaders(ownerToken), 'idempotency-key': 't14-create-002' },
      payload: { name: 'T14家庭2' },
    });
    const family2Id = createRes2.json().id;
    const family2Version = createRes2.json().version;

    // PATCH 使 version+1
    await app.inject({
      method: 'PATCH',
      url: `/v1/families/${family2Id}`,
      headers: authHeaders(ownerToken),
      payload: { name: 'T14家庭2改名', version: family2Version },
    });

    // 用旧 version 删除 → 409
    const deleteConflictRes = await app.inject({
      method: 'DELETE',
      url: `/v1/families/${family2Id}?version=${family2Version}`,
      headers: { ...authHeaders(ownerToken), 'idempotency-key': 't14-delete-002' },
    });
    expect(deleteConflictRes.statusCode).toBe(409);
  });

  // T15: shared family member 上限
  it('T15: 11th active member accept returns 422 family_member_limit', async () => {
    const { token: ownerToken } = await registerUser('t15-owner');

    const createRes = await app.inject({
      method: 'POST',
      url: '/v1/families',
      headers: { ...authHeaders(ownerToken), 'idempotency-key': 't15-create-001' },
      payload: { name: 'T15家庭' },
    });
    const familyId = createRes.json().id;

    // 加入 9 个成员（owner 已占 1 位 = 共 10 人）
    for (let i = 0; i < 9; i++) {
      const { token: memberToken } = await registerUser(`t15-member-${i}`);

      const inviteRes = await app.inject({
        method: 'POST',
        url: `/v1/families/${familyId}/invites`,
        headers: { ...authHeaders(ownerToken), 'idempotency-key': `t15-invite-${i}` },
        payload: { role: 'member' },
      });

      await app.inject({
        method: 'POST',
        url: '/v1/families/invites/accept',
        headers: { ...authHeaders(memberToken), 'idempotency-key': `t15-accept-${i}` },
        payload: { invite_token: inviteRes.json().invite_token },
      });
    }

    // 第 11 个成员尝试 accept → 422
    const { token: extraToken } = await registerUser('t15-extra');
    const inviteRes = await app.inject({
      method: 'POST',
      url: `/v1/families/${familyId}/invites`,
      headers: { ...authHeaders(ownerToken), 'idempotency-key': 't15-invite-extra' },
      payload: { role: 'member' },
    });

    const acceptRes = await app.inject({
      method: 'POST',
      url: '/v1/families/invites/accept',
      headers: { ...authHeaders(extraToken), 'idempotency-key': 't15-accept-extra' },
      payload: { invite_token: inviteRes.json().invite_token },
    });
    expect(acceptRes.statusCode).toBe(422);
    expect(acceptRes.json().code).toBe('BUSINESS_RULE_VIOLATION');
    expect(acceptRes.json().details.rule).toBe('family_member_limit');
  });

  // T16: OpenAPI ErrorCode FAMILY_PERSONAL_NOT_DELETABLE 已出现在 enum
  it('T16: FAMILY_PERSONAL_NOT_DELETABLE exists in ErrorCode enum', () => {
    expect(ErrorCode.FAMILY_PERSONAL_NOT_DELETABLE).toBe('FAMILY_PERSONAL_NOT_DELETABLE');
  });
});
