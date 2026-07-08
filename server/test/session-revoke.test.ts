/**
 * Costra · Server · sessionRepo.revokeStaleByUser 单测
 *
 * 覆盖登录时"陈旧会话回收"的四类场景（允许多设备并存）：
 *   - 同设备(client_fp 相同) 且签发早于 (now-1h) 的活跃会话 → 回收
 *   - 已过期(expires_at<=now) 但未标记的活跃会话           → 回收
 *   - 其它设备(client_fp 不同) 的活跃会话                  → 保留
 *   - 同设备但新近(<1h) 签发的活跃会话                     → 保留
 *
 * 兼带验证：该回收 SQL 在 pg-mem 下可正常执行（interval 阈值改由应用层传参 · 无 pg-mem 兼容坑）。
 */

import { describe, it, expect } from 'vitest';
import { randomUUID } from 'node:crypto';
import * as sessionRepo from '../src/repositories/sessionRepo.js';
import { getPool } from '../src/db/pool.js';

const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;

/** 直插一行 user_sessions（可控 issued_at / expires_at / client_fp）。 */
async function seedSession(input: {
  jti: string;
  userId: string;
  clientFp: string | null;
  issuedAt: Date;
  expiresAt: Date;
}): Promise<void> {
  await getPool().query(
    `INSERT INTO user_sessions (jti, user_id, issued_at, expires_at, client_fp)
          VALUES ($1, $2, $3, $4, $5)`,
    [input.jti, input.userId, input.issuedAt, input.expiresAt, input.clientFp],
  );
}

async function revokedAtOf(jti: string): Promise<Date | null> {
  const res = await getPool().query(`SELECT revoked_at FROM user_sessions WHERE jti = $1`, [jti]);
  return (res.rows[0]?.revoked_at as Date | null) ?? null;
}

describe('sessionRepo.revokeStaleByUser', () => {
  it('只回收"同设备旧会话"与"已过期会话"，保留其它设备与新近会话', async () => {
    const userId = randomUUID();
    const otherUserId = randomUUID();
    const now = Date.now();

    // A 同设备(dev-1) 2h 前签发 · 未过期 → 应回收
    const jtiA = randomUUID();
    await seedSession({ jti: jtiA, userId, clientFp: 'dev-1', issuedAt: new Date(now - 2 * HOUR), expiresAt: new Date(now + 30 * DAY) });
    // B 其它设备(dev-2) 2h 前签发 · 未过期 → 应保留（允许多设备）
    const jtiB = randomUUID();
    await seedSession({ jti: jtiB, userId, clientFp: 'dev-2', issuedAt: new Date(now - 2 * HOUR), expiresAt: new Date(now + 30 * DAY) });
    // C 同设备(dev-1) 10min 前签发 · 未过期 → 应保留（< 1h）
    const jtiC = randomUUID();
    await seedSession({ jti: jtiC, userId, clientFp: 'dev-1', issuedAt: new Date(now - 10 * 60 * 1000), expiresAt: new Date(now + 30 * DAY) });
    // D 任意设备 已过期 → 应回收
    const jtiD = randomUUID();
    await seedSession({ jti: jtiD, userId, clientFp: 'dev-3', issuedAt: new Date(now - 2 * HOUR), expiresAt: new Date(now - 1000) });
    // E 其它用户 同设备旧会话 → 不受影响（按 user_id 隔离）
    const jtiE = randomUUID();
    await seedSession({ jti: jtiE, userId: otherUserId, clientFp: 'dev-1', issuedAt: new Date(now - 2 * HOUR), expiresAt: new Date(now + 30 * DAY) });

    const revoked = await sessionRepo.revokeStaleByUser({
      userId,
      clientFp: 'dev-1',
      sameDeviceIssuedBefore: new Date(now - HOUR),
    });

    expect(revoked).toBe(2); // A + D
    expect(await revokedAtOf(jtiA)).not.toBeNull(); // 同设备旧会话
    expect(await revokedAtOf(jtiD)).not.toBeNull(); // 过期会话
    expect(await revokedAtOf(jtiB)).toBeNull();     // 其它设备保留
    expect(await revokedAtOf(jtiC)).toBeNull();     // 新近会话保留
    expect(await revokedAtOf(jtiE)).toBeNull();     // 其它用户不受影响
  });

  it('clientFp 为 null 时只回收过期会话（同设备分支不匹配）', async () => {
    const userId = randomUUID();
    const now = Date.now();

    const jtiActive = randomUUID();
    await seedSession({ jti: jtiActive, userId, clientFp: null, issuedAt: new Date(now - 2 * HOUR), expiresAt: new Date(now + 30 * DAY) });
    const jtiExpired = randomUUID();
    await seedSession({ jti: jtiExpired, userId, clientFp: null, issuedAt: new Date(now - 2 * HOUR), expiresAt: new Date(now - 1000) });

    const revoked = await sessionRepo.revokeStaleByUser({
      userId,
      clientFp: null,
      sameDeviceIssuedBefore: new Date(now - HOUR),
    });

    expect(revoked).toBe(1); // 仅过期
    expect(await revokedAtOf(jtiExpired)).not.toBeNull();
    expect(await revokedAtOf(jtiActive)).toBeNull();
  });
});
