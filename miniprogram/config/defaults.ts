// miniprogram/config/defaults.ts · 默认值常量
// 卡号：COSTRA-157 · FU-118-2 + FU-001 双端同步
//
// ⚠️ 必须与 server/src/config/defaults.ts 保持值一致（手工对齐 · CI 闸门 G7 强制对账 · grep | sort -u | wc -l == 1）
// 编译边界隔离：miniprogram 编译不能 import server/ · 双份必要
//
// 未来扩展：COSTRA-160 tokens pipeline 可能扩展为构建期同步

export const defaultNickname = '微信用户';

/**
 * 单用户可创建的最大协作账本（shared family）数量
 * 修改此值即可快速扩容；程序上限 20
 */
export const maxSharedFamilies = 5;

/** 程序硬上限（不建议超过） */
export const maxSharedFamiliesHardLimit = 20;

/**
 * 每个家庭（shared family）的成员数上限（含 owner）
 * ⚠️ 必须与 server/src/config/defaults.ts maxFamilyMembers 保持一致
 */
export const maxFamilyMembers = 8;

/**
 * 单账本条目数软上限（【临时限制 · 2026-09-10】）。
 * 小程序在单账本条目数很大时存在明显性能退化，优化排期约两个月人力，
 * 期间用此上限拦住会突破 8000 的导入。优化完成后应放宽或移除此限制。
 * ⚠️ 必须与 server/src/config/defaults.ts maxLedgerEntries 保持一致
 */
export const maxLedgerEntries = 8000;
