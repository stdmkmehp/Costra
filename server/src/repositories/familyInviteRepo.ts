/**
 * Costra · Server · family_invites DAO
 *
 * 卡号：COSTRA-221 · 事实源：server/db/migrations/0001_init.sql family_invites 表
 *
 * 职责：封装 family_invites 表的 SQL 访问；业务层禁止直接写 SQL。
 *
 * 设计原则：
 *   - 参数化查询；严禁字符串拼接
 *   - 返回领域实体接口，不暴露 pg 行对象
 *   - Runner 透传模式
 */

import { getPool } from '../db/pool.js';
import { newId } from '../id/idGen.js';
import { randomBytes } from 'node:crypto';
import type { FamilyRole } from './familyMemberRepo.js';

export interface FamilyInviteEntity {
  id: string;
  familyId: string;
  inviterId: string;
  inviteToken: string;
  role: FamilyRole;
  expiresAt: Date;
  usedAt: Date | null;
  usedBy: string | null;
  createdAt: Date;
}

interface FamilyInviteRow {
  id: string;
  family_id: string;
  inviter_id: string;
  invite_token: string;
  role: FamilyRole;
  expires_at: Date;
  used_at: Date | null;
  used_by: string | null;
  created_at: Date;
}

function rowToEntity(r: FamilyInviteRow): FamilyInviteEntity {
  return {
    id: r.id,
    familyId: r.family_id,
    inviterId: r.inviter_id,
    inviteToken: r.invite_token,
    role: r.role,
    expiresAt: r.expires_at,
    usedAt: r.used_at,
    usedBy: r.used_by,
    createdAt: r.created_at,
  };
}

type Runner = { query: (sql: string, params?: unknown[]) => Promise<{ rows: FamilyInviteRow[]; rowCount?: number | null }> };

function exec(): Runner {
  return getPool() as unknown as Runner;
}

/**
 * 生成高熵 invite token（32 字节 hex = 64 字符）
 */
function generateInviteToken(): string {
  return randomBytes(32).toString('hex');
}

/**
 * 创建邀请
 */
export async function create(
  input: { familyId: string; inviterId: string; role: FamilyRole; ttlHours: number },
  client?: Runner,
): Promise<FamilyInviteEntity> {
  const id = newId();
  const token = generateInviteToken();
  const runner = client ?? exec();

  // 应用层计算 expires_at（pg-mem 不支持 interval '1 hour' * $N 语法）
  const expiresAt = new Date(Date.now() + input.ttlHours * 3600 * 1000);

  const res = await runner.query(
    `INSERT INTO family_invites (id, family_id, inviter_id, invite_token, role, expires_at)
          VALUES ($1, $2, $3, $4, $5, $6)
     RETURNING id, family_id, inviter_id, invite_token, role, expires_at, used_at, used_by, created_at`,
    [id, input.familyId, input.inviterId, token, input.role, expiresAt],
  );
  if (!res.rows[0]) {
    throw new Error('[familyInviteRepo] INSERT returned no row');
  }
  return rowToEntity(res.rows[0]);
}

/**
 * 按 invite_token 查找邀请（未过期、未使用）
 */
export async function findValidByToken(
  inviteToken: string,
  client?: Runner,
): Promise<FamilyInviteEntity | null> {
  const runner = client ?? exec();
  const res = await runner.query(
    `SELECT id, family_id, inviter_id, invite_token, role, expires_at, used_at, used_by, created_at
       FROM family_invites
      WHERE invite_token = $1 AND used_at IS NULL AND expires_at > now()
      LIMIT 1`,
    [inviteToken],
  );
  return res.rows[0] ? rowToEntity(res.rows[0]) : null;
}

/**
 * 按 invite_token 查找邀请（含已过期/已使用，用于错误判定）
 */
export async function findByToken(
  inviteToken: string,
  client?: Runner,
): Promise<FamilyInviteEntity | null> {
  const runner = client ?? exec();
  const res = await runner.query(
    `SELECT id, family_id, inviter_id, invite_token, role, expires_at, used_at, used_by, created_at
       FROM family_invites
      WHERE invite_token = $1
      LIMIT 1`,
    [inviteToken],
  );
  return res.rows[0] ? rowToEntity(res.rows[0]) : null;
}

/**
 * 按 id 查找邀请（含已过期/已使用，用于撤销与错误判定）
 */
export async function findById(
  inviteId: string,
  client?: Runner,
): Promise<FamilyInviteEntity | null> {
  const runner = client ?? exec();
  const res = await runner.query(
    `SELECT id, family_id, inviter_id, invite_token, role, expires_at, used_at, used_by, created_at
       FROM family_invites
      WHERE id = $1
      LIMIT 1`,
    [inviteId],
  );
  return res.rows[0] ? rowToEntity(res.rows[0]) : null;
}

/**
 * 删除未分享后取消的邀请（彻底废弃 token）
 */
export async function deleteById(
  inviteId: string,
  client?: Runner,
): Promise<void> {
  const runner = client ?? exec();
  await runner.query(
    `DELETE FROM family_invites
      WHERE id = $1`,
    [inviteId],
  );
}

/**
 * 标记邀请已使用；返回是否成功占用（防止与撤销/并发接受竞争）
 */
export async function markUsed(
  inviteId: string,
  usedBy: string,
  client?: Runner,
): Promise<boolean> {
  const runner = client ?? exec();
  const res = await runner.query(
    `UPDATE family_invites
        SET used_at = now(), used_by = $2
      WHERE id = $1 AND used_at IS NULL AND expires_at > now()`,
    [inviteId, usedBy],
  );
  return (res.rowCount ?? 0) > 0;
}
