// utils/profile.ts · 用户画像判定辅助
// 卡号：COSTRA-158 · 替换 COSTRA-157 间接判定（nickname 字符串比较）为严格事实判定
//
// COSTRA-157 旧实装：u.nickname !== defaultNickname（代理判定 · Human 否决 2026-05-19 09:42）
// COSTRA-158 新实装：u.has_completed_profile（事实字段 · server 显式标记）
//
// 语义优势：
//   - 用户改名为 '微信用户' 不误判（之前会误判）
//   - server 升级 default nickname 客户端不需要跟改
//   - 多端同账号一致（之前是字符串比较 · 同账号同步）

interface UserLike {
  has_completed_profile?: boolean;
}

export function computeHasProfile(u: UserLike | null | undefined): boolean {
  return !!(u && u.has_completed_profile);
}
