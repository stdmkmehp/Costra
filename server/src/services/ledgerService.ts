/**
 * Costra · Server · 账本资产 service
 *
 * 卡号：COSTRA-4xx · 事实源：docs/design/asset-and-budget-spec.md §4.2 §4.4
 *
 * 职责：
 *   - rebaseBalance：用户修改资产值的入口
 *   - 内部使用 ledgerRepo.rebaseBalance 完成原子重锚
 *
 * 冲突处理：
 *   - balance_version 乐观锁失败 → 抛 VERSION_CONFLICT（路由层映射为 409）
 */

import { AppError } from '../errors/AppError.js';
import { ErrorCode } from '../errors/ErrorCode.js';
import * as ledgerRepo from '../repositories/ledgerRepo.js';
import * as familyRepo from '../repositories/familyRepo.js';
import * as familyMemberRepo from '../repositories/familyMemberRepo.js';

export interface LedgerServiceDeps {
  /** 注入便于单测 */
}

/**
 * 用户重锚账本资产。
 *
 * 步骤：
 *   1) 校验 ledger 存在 + 用户是该 ledger 所属 family 的 active 成员
 *   2) 调 ledgerRepo.rebaseBalance(balance_version 乐观锁)
 *   3) 失败 → 409 VERSION_CONFLICT（路由层让客户端重拉最新值后弹冲突弹窗）
 */
export async function rebaseBalance(
  userId: string,
  input: {
    ledgerId: string;
    newBalanceCents: number;
    clientBaseVersion: number;
  },
): Promise<{
  balance_cents: number;
  balance_baseline_seq: number;
  balance_version: number;
}> {
  // 校验金额合法
  if (!Number.isInteger(input.newBalanceCents)) {
    throw new AppError(ErrorCode.INVALID_ARGUMENT, {
      message: 'new_balance_cents must be integer (cents)',
      details: { field: 'new_balance_cents' },
    });
  }
  // 数值上限：BIGINT 存储足够但 JS Number 只到 2^53-1；限制到 ±10^15 分（1 万亿元）
  //防止用户误输入天文数字导致后续 JS 侧丢精度（Number(bigint) 边界）
  const MAX_BALANCE = 1_000_000_000_000_000; // 10^15 cents
  if (Math.abs(input.newBalanceCents) > MAX_BALANCE) {
    throw new AppError(ErrorCode.INVALID_ARGUMENT, {
      message: 'new_balance_cents out of allowed range (±10^15)',
      details: { field: 'new_balance_cents', max: MAX_BALANCE },
    });
  }

  // 1) 拿 ledger + family_id 做权限守门
  const ledger = await ledgerRepo.findById(input.ledgerId);
  if (!ledger) {
    throw new AppError(ErrorCode.NOT_FOUND, {
      message: 'ledger not found',
      details: { ledger_id: input.ledgerId },
    });
  }

  // 权限守门：用户必须是该 family 的 active 成员
  const family = await familyRepo.findById(ledger.familyId);
  if (!family) {
    throw new AppError(ErrorCode.NOT_FOUND, { message: 'family not found' });
  }

  const isActive = await familyMemberRepo.isActiveMember(userId, ledger.familyId);
  if (!isActive) {
    throw new AppError(ErrorCode.PERMISSION_DENIED, {
      message: 'user is not an active member of this family',
      details: { family_id: ledger.familyId },
    });
  }

  // 2) 乐观锁重锚
  const updated = await ledgerRepo.rebaseBalance({
    ledgerId: input.ledgerId,
    newBalanceCents: input.newBalanceCents,
    clientBaseVersion: input.clientBaseVersion,
  });

  if (!updated) {
    // 409 → 路由层返回当前最新 balance_version，便于客户端重试
    const current = await ledgerRepo.findById(input.ledgerId);
    throw new AppError(ErrorCode.VERSION_CONFLICT, {
      message: 'balance version conflict',
      details: {
        current_balance_version: current?.balanceVersion ?? 0,
        current_balance_cents: current?.balanceCents ?? 0,
      },
    });
  }

  return {
    balance_cents: updated.balanceCents,
    balance_baseline_seq: updated.balanceBaselineSeq,
    balance_version: updated.balanceVersion,
  };
}

/**
 * 读取账本资产信息（供明细页 / 账本设置页使用）。
 * 复用 ledgerRepo.findById；权限守门由调用方（路由）做。
 */
export async function getBalance(
  ledgerId: string,
): Promise<{
  balance_cents: number;
  balance_baseline_seq: number;
  balance_version: number;
} | null> {
  const ledger = await ledgerRepo.findById(ledgerId);
  if (!ledger) return null;
  return {
    balance_cents: ledger.balanceCents,
    balance_baseline_seq: ledger.balanceBaselineSeq,
    balance_version: ledger.balanceVersion,
  };
}

/**
 * 带权限校验的资产读取（GET /ledgers/{id}/balance · 客户端主动拉取）。
 *
 * 与 rebaseBalance 保持同构的权限守门：
 *   - ledger 不存在 → 404
 *   - 用户不是该 family 的 active 成员 → 403
 *
 * 存在性 + 权限两步与 rebaseBalance 复用同一套 repo 判断，防止越权读取他人账本资产。
 */
export async function getBalanceForUser(
  userId: string,
  ledgerId: string,
): Promise<{
  balance_cents: number;
  balance_baseline_seq: number;
  balance_version: number;
}> {
  const ledger = await ledgerRepo.findById(ledgerId);
  if (!ledger) {
    throw new AppError(ErrorCode.NOT_FOUND, {
      message: 'ledger not found',
      details: { ledger_id: ledgerId },
    });
  }

  const family = await familyRepo.findById(ledger.familyId);
  if (!family) {
    throw new AppError(ErrorCode.NOT_FOUND, { message: 'family not found' });
  }

  const isActive = await familyMemberRepo.isActiveMember(userId, ledger.familyId);
  if (!isActive) {
    throw new AppError(ErrorCode.PERMISSION_DENIED, {
      message: 'user is not an active member of this family',
      details: { family_id: ledger.familyId },
    });
  }

  return {
    balance_cents: ledger.balanceCents,
    balance_baseline_seq: ledger.balanceBaselineSeq,
    balance_version: ledger.balanceVersion,
  };
}
