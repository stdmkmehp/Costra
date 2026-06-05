/**
 * Costra · Server · 家庭管理业务编排层
 *
 * 卡号：COSTRA-221 · 事实源：server/api/openapi.yaml §families
 *
 * 职责：
 *   - listFamilies: 列出当前用户 active families + ledger 信息 + member_count
 *   - createFamily: 创建 shared family + owner member + 默认 ledger
 *   - getFamilyDetail: 获取 family 详情（含 members）
 *   - listMembers: 列出 family 成员（active + left）
 *   - updateFamily: 更新 family name（仅 owner）
 *   - deleteFamily: 软删 family（仅 owner，personal 不可删）
 *   - createInvite: 生成邀请口令（仅 shared owner）
 *   - previewInvite: 预览邀请信息（无需 member，任意登录用户可查询）
 *   - acceptInvite: 接受邀请
 *   - removeMember: 移除成员（仅 owner，不可移自己）
 *   - assertActiveMember / assertOwner: 公共守门
 *
 * 设计原则：
 *   - 权限守门：所有操作必须校验 userId 与 familyId 的关系
 *   - 非 member 访问 family detail/members/invites 统一 403 FAMILY_NOT_MEMBER
 *   - personal family 禁项双轨错误码
 *   - 多表变更使用 withTx
 */

import { AppError } from '../errors/AppError.js';
import { ErrorCode } from '../errors/ErrorCode.js';
import { withTx } from '../db/pool.js';
import * as familyRepo from '../repositories/familyRepo.js';
import * as familyMemberRepo from '../repositories/familyMemberRepo.js';
import type { FamilyRole } from '../repositories/familyMemberRepo.js';
import * as familyInviteRepo from '../repositories/familyInviteRepo.js';
import * as ledgerRepo from '../repositories/ledgerRepo.js';
import { maxSharedFamilies, maxSharedFamiliesHardLimit, maxFamilyMembers } from '../config/defaults.js';

import * as userRepo from '../repositories/userRepo.js';

// --- Wire 响应类型（与 OpenAPI Family/FamilyMember/FamilyInvite schema 对齐）---

export interface FamilyResponse {
  id: string;
  name: string;
  owner_id: string;
  kind: 'personal' | 'shared';
  ledger_id: string;
  ledger_name: string;
  member_count: number;
  created_at: string;
  updated_at: string;
  version: number;
}

export interface FamilyDetailResponse extends FamilyResponse {
  members: FamilyMemberResponse[];
}

export interface FamilyMemberResponse {
  user_id: string;
  nickname: string;
  avatar_url: string | null;
  role: FamilyRole;
  status: 'active' | 'left';
  joined_at: string;
  left_at: string | null;
}

export interface FamilyInviteResponse {
  id: string;
  family_id: string;
  invite_token: string;
  role: FamilyRole;
  expires_at: string;
  share_url: string;
}

/** 邀请预览响应（供被邀请方在确认前查看） */
export interface FamilyInvitePreviewResponse {
  family_name: string;
  inviter_nickname: string;
  role: FamilyRole;
  expires_at: string;
}

// --- 公共守门 ---

/**
 * 断言 userId 是 familyId 的 active member，否则抛 403 FAMILY_NOT_MEMBER
 */
export async function assertActiveMember(userId: string, familyId: string): Promise<void> {
  const isMember = await familyMemberRepo.isActiveMember(userId, familyId);
  if (!isMember) {
    throw new AppError(ErrorCode.FAMILY_NOT_MEMBER, {
      message: 'user is not an active member of this family',
      details: { family_id: familyId },
    });
  }
}

/**
 * 断言 userId 是 familyId 的 owner，否则抛 403 PERMISSION_DENIED
 * 前置：调用方应先 assertActiveMember 或自行确认是 active member
 */
export async function assertOwner(userId: string, familyId: string): Promise<void> {
  const role = await familyMemberRepo.getActiveRole(userId, familyId);
  if (role !== 'owner') {
    throw new AppError(ErrorCode.PERMISSION_DENIED, {
      message: 'only family owner can perform this action',
      details: { family_id: familyId },
    });
  }
}

// --- 辅助函数 ---

/**
 * 将 FamilyEntity + ledger 信息 + member_count 转为 FamilyResponse
 */
async function toFamilyResponse(
  family: { id: string; name: string; ownerId: string; kind: familyRepo.FamilyKind; createdAt: Date; updatedAt: Date; version: number },
  ledgerInfo?: { id: string; name: string } | null,
  memberCount?: number | null,
): Promise<FamilyResponse> {
  // 若未传入 ledgerInfo，则查询
  if (!ledgerInfo) {
    const ledger = await ledgerRepo.findFirstByFamilyId(family.id);
    ledgerInfo = ledger ? { id: ledger.id, name: ledger.name } : { id: '', name: '' };
  }
  // 若未传入 memberCount，则查询
  if (memberCount == null) {
    memberCount = await familyMemberRepo.countActiveMembers(family.id);
  }
  return {
    id: family.id,
    name: family.name,
    owner_id: family.ownerId,
    kind: family.kind,
    ledger_id: ledgerInfo?.id ?? '',
    ledger_name: ledgerInfo?.name ?? '',
    member_count: memberCount ?? 0,
    created_at: family.createdAt.toISOString(),
    updated_at: family.updatedAt.toISOString(),
    version: family.version,
  };
}

function toMemberResponse(m: {
  userId: string;
  nickname: string;
  avatarUrl: string | null;
  role: FamilyRole;
  joinedAt: Date;
  leftAt: Date | null;
}): FamilyMemberResponse {
  return {
    user_id: m.userId,
    nickname: m.nickname,
    avatar_url: m.avatarUrl,
    role: m.role,
    status: m.leftAt ? 'left' : 'active',
    joined_at: m.joinedAt.toISOString(),
    left_at: m.leftAt ? m.leftAt.toISOString() : null,
  };
}

// --- 业务 API ---

/**
 * 列出当前用户 active families，含 ledger 信息和 member_count
 */
export async function listFamilies(userId: string): Promise<FamilyResponse[]> {
  const families = await familyRepo.listActiveFamiliesByUser(userId);
  const results: FamilyResponse[] = [];
  for (const f of families) {
    results.push(await toFamilyResponse(f));
  }
  return results;
}

/**
 * 创建 shared family + owner member + 默认 ledger（事务一致）
 * 上限校验：
 *   - 产品配置上限：maxSharedFamilies（当前 3）→ 422 BUSINESS_RULE_VIOLATION
 *   - 程序硬上限：maxSharedFamiliesHardLimit（20）→ 422 BUSINESS_RULE_VIOLATION
 * 两层都在事务外提前校验，避免无意义的 INSERT 尝试。
 */
export async function createFamily(
  userId: string,
  payload: { name: string },
): Promise<FamilyResponse> {
  // ── 上限校验（事务外，读即可）──
  const ownedCount = await familyRepo.countOwnedSharedFamilies(userId);

  if (ownedCount >= maxSharedFamiliesHardLimit) {
    throw new AppError(ErrorCode.BUSINESS_RULE_VIOLATION, {
      message: `shared family hard limit reached (max ${maxSharedFamiliesHardLimit})`,
      details: {
        rule: 'shared_family_hard_limit',
        current_count: ownedCount,
        max: maxSharedFamiliesHardLimit,
      },
    });
  }

  if (ownedCount >= maxSharedFamilies) {
    throw new AppError(ErrorCode.BUSINESS_RULE_VIOLATION, {
      message: `shared family limit reached (max ${maxSharedFamilies})`,
      details: {
        rule: 'shared_family_limit',
        current_count: ownedCount,
        max: maxSharedFamilies,
      },
    });
  }

  const result = await withTx(async (client) => {
    // 1. 创建 shared family + owner member
    const family = await familyRepo.createSharedFamily(
      { ownerId: userId, name: payload.name },
      client,
    );
    // 2. 创建默认 ledger（name = family name）
    const ledger = await ledgerRepo.createDefaultLedger(
      { familyId: family.id, name: payload.name, currency: 'CNY' },
      client,
    );
    return { family, ledger };
  });

  return await toFamilyResponse(result.family, { id: result.ledger.id, name: result.ledger.name }, 1);
}

/**
 * 获取 family 详情（含 members）
 * 非 member 返回 403 FAMILY_NOT_MEMBER
 */
export async function getFamilyDetail(
  userId: string,
  familyId: string,
): Promise<FamilyDetailResponse> {
  // 权限守门
  await assertActiveMember(userId, familyId);

  const family = await familyRepo.findById(familyId);
  if (!family) {
    throw new AppError(ErrorCode.NOT_FOUND, { message: 'family not found' });
  }

  const members = await familyMemberRepo.listMembersWithUsers(familyId);
  const familyResp = await toFamilyResponse(family);

  return {
    ...familyResp,
    members: members.map(toMemberResponse),
  };
}

/**
 * 列出 family 成员（active + left）
 * 非 member 返回 403 FAMILY_NOT_MEMBER
 */
export async function listMembers(
  userId: string,
  familyId: string,
): Promise<FamilyMemberResponse[]> {
  await assertActiveMember(userId, familyId);
  const members = await familyMemberRepo.listMembersWithUsers(familyId);
  return members.map(toMemberResponse);
}

/**
 * 更新 family name（仅 owner）
 * PATCH 不要求 Idempotency-Key，走 version 乐观锁
 */
export async function updateFamily(
  userId: string,
  familyId: string,
  payload: { name?: string; version: number },
): Promise<FamilyResponse> {
  // 权限守门：owner only
  await assertActiveMember(userId, familyId);
  await assertOwner(userId, familyId);

  if (!payload.name || payload.name.trim().length === 0) {
    throw new AppError(ErrorCode.INVALID_ARGUMENT, {
      message: 'name is required',
      details: { field: 'name', constraint: 'non-empty' },
    });
  }

  const family = await familyRepo.updateName({
    familyId,
    name: payload.name.trim(),
    version: payload.version,
    ownerId: userId,
  });

  return await toFamilyResponse(family);
}

/**
 * 软删 family（仅 owner，personal 不可删）
 */
export async function deleteFamily(
  userId: string,
  familyId: string,
  version: number,
): Promise<void> {
  // 权限守门：owner only
  await assertActiveMember(userId, familyId);
  await assertOwner(userId, familyId);

  // familyRepo.softDelete 内部有 kind='personal' 守门 + 乐观锁
  await familyRepo.softDelete({ familyId, version, ownerId: userId });
}

/**
 * 生成邀请口令（仅 shared owner）
 * personal family 不可邀请 → 422 BUSINESS_RULE_VIOLATION + details.rule=personal_family_not_invitable
 */
export async function createInvite(
  userId: string,
  familyId: string,
  payload: { role?: FamilyRole; ttlHours?: number },
): Promise<FamilyInviteResponse> {
  // 权限守门：owner only
  await assertActiveMember(userId, familyId);
  await assertOwner(userId, familyId);

  // personal family 不可邀请
  const family = await familyRepo.findById(familyId);
  if (!family) {
    throw new AppError(ErrorCode.NOT_FOUND, { message: 'family not found' });
  }
  if (family.kind === 'personal') {
    throw new AppError(ErrorCode.BUSINESS_RULE_VIOLATION, {
      message: 'personal family cannot be invited to',
      details: { rule: 'personal_family_not_invitable' },
    });
  }

  // invite role 只允许 member | viewer
  const role: FamilyRole = payload.role ?? 'member';
  if (role === 'owner') {
    throw new AppError(ErrorCode.INVALID_ARGUMENT, {
      message: 'cannot invite owner role',
      details: { field: 'role', value: 'owner', constraint: 'must be member or viewer' },
    });
  }

  const ttlHours = payload.ttlHours ?? 24;
  if (ttlHours < 1 || ttlHours > 168) {
    throw new AppError(ErrorCode.INVALID_ARGUMENT, {
      message: 'ttl_hours must be between 1 and 168',
      details: { field: 'ttl_hours', value: ttlHours, constraint: '1..168' },
    });
  }

  const invite = await familyInviteRepo.create({
    familyId,
    inviterId: userId,
    role,
    ttlHours,
  });

  return {
    id: invite.id,
    family_id: invite.familyId,
    invite_token: invite.inviteToken,
    role: invite.role,
    expires_at: invite.expiresAt.toISOString(),
    share_url: `costra://invite?token=${invite.inviteToken}`,
  };
}

/**
 * 预览邀请信息（任意登录用户可查询，无需是成员）
 * 用于被邀请方在确认加入前展示家庭名称和邀请人昵称
 * token 无效/已过期/已使用 → 410 INVITE_EXPIRED
 */
export async function previewInvite(
  payload: { invite_token: string },
): Promise<FamilyInvitePreviewResponse> {
  const invite = await familyInviteRepo.findValidByToken(payload.invite_token);

  if (!invite) {
    const anyInvite = await familyInviteRepo.findByToken(payload.invite_token);
    if (anyInvite) {
      throw new AppError(ErrorCode.INVITE_EXPIRED, {
        message: 'invite has expired or already been used',
      });
    }
    throw new AppError(ErrorCode.INVITE_EXPIRED, {
      message: 'invite token not found or expired',
    });
  }

  const family = await familyRepo.findById(invite.familyId);
  if (!family) {
    throw new AppError(ErrorCode.INVITE_EXPIRED, {
      message: 'invite family no longer exists',
    });
  }

  const inviter = await userRepo.findById(invite.inviterId);

  return {
    family_name: family.name,
    inviter_nickname: inviter?.nickname ?? '未知用户',
    role: invite.role,
    expires_at: invite.expiresAt.toISOString(),
  };
}

/**
 * 撤销邀请（owner 在未分享或放弃邀请时回收 token）
 */
export async function revokeInvite(
  userId: string,
  familyId: string,
  inviteId: string,
): Promise<void> {
  await assertActiveMember(userId, familyId);
  await assertOwner(userId, familyId);

  const invite = await familyInviteRepo.findById(inviteId);
  if (!invite) return;
  if (invite.familyId !== familyId) {
    throw new AppError(ErrorCode.NOT_FOUND, { message: 'invite not found in family' });
  }
  if (invite.usedAt || invite.expiresAt.getTime() <= Date.now()) return;

  await familyInviteRepo.deleteById(inviteId);
}

/**
 * 接受邀请
 * 校验：token 未过期、未使用；成员上限 10；历史成员重新加入
 */
export async function acceptInvite(
  userId: string,
  payload: { invite_token: string },
): Promise<FamilyResponse> {
  const invite = await familyInviteRepo.findValidByToken(payload.invite_token);

  if (!invite) {
    // token 不存在 / 已过期 / 已使用 → 统一 410 INVITE_EXPIRED
    // 先查是否是已使用/已过期的 token
    const anyInvite = await familyInviteRepo.findByToken(payload.invite_token);
    if (anyInvite) {
      // token 存在但已使用或已过期
      throw new AppError(ErrorCode.INVITE_EXPIRED, {
        message: 'invite has expired or already been used',
      });
    }
    // token 完全不存在
    throw new AppError(ErrorCode.INVITE_EXPIRED, {
      message: 'invite token not found or expired',
    });
  }

  // 已是该家庭的 active member → 不允许重复加入
  const alreadyMember = await familyMemberRepo.isActiveMember(userId, invite.familyId);
  if (alreadyMember) {
    throw new AppError(ErrorCode.ALREADY_MEMBER, {
      message: 'you are already an active member of this family',
    });
  }

  // 成员上限（含 owner）
  const activeCount = await familyMemberRepo.countActiveMembers(invite.familyId);
  if (activeCount >= maxFamilyMembers) {
    throw new AppError(ErrorCode.BUSINESS_RULE_VIOLATION, {
      message: 'family member limit reached',
      details: { rule: 'family_member_limit', current_count: activeCount, max: maxFamilyMembers },
    });
  }

  // 事务：标记邀请已使用 + 加入 family
  const family = await withTx(async (client) => {
    // 标记邀请已使用
    await familyInviteRepo.markUsed(invite.id, userId, client);

    // 加入 family（历史成员重新加入）
    await familyMemberRepo.joinFamily(
      { familyId: invite.familyId, userId, role: invite.role },
      client,
    );

    return await familyRepo.findById(invite.familyId, client);
  });

  if (!family) {
    throw new AppError(ErrorCode.INTERNAL, { message: 'family not found after invite accept' });
  }

  return await toFamilyResponse(family);
}

/**
 * 移除成员（仅 owner，不可移自己）
 * personal family 不可移出 owner → 403 FAMILY_PERSONAL_NOT_DELETABLE
 */
export async function removeMember(
  userId: string,
  familyId: string,
  targetUserId: string,
): Promise<void> {
  // 权限守门：owner only
  await assertActiveMember(userId, familyId);
  await assertOwner(userId, familyId);

  // owner 不可移出自己
  if (userId === targetUserId) {
    throw new AppError(ErrorCode.FAMILY_PERSONAL_NOT_DELETABLE, {
      message: 'owner cannot remove self; use DELETE /families/{id} to dissolve',
    });
  }

  // 设置 left_at（不物理删除）
  await familyMemberRepo.setLeftAt(familyId, targetUserId);
}
