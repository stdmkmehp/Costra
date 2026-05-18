// utils/profile.ts · 用户画像判定辅助
// 卡号：COSTRA-157 · FU-102-PROFILE-REFUSE-UI
//
// 从 Page 层抽取 · 便于单测（避免 mock Page()/wx 全局）
// hydrateUser 内调用 computeHasProfile · onTapCompleteProfile 不在此处

import { defaultNickname } from '../config/defaults';

interface UserLike {
  nickname?: string;
}

/**
 * 判定用户是否有真实资料（非默认占位昵称）
 * ⚠️ 已知边界（dispatch §2.1 E）：用户真实昵称 === defaultNickname 时误判 false
 * MVP 接受 · Sprint-3 Epic-D 落地后改用 user.has_completed_profile 显式标记
 */
export function computeHasProfile(u: UserLike | null | undefined): boolean {
  return !!(u && u.nickname && u.nickname !== defaultNickname);
}
