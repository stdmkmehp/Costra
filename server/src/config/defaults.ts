/**
 * Costra · Server · 默认值常量
 *
 * 卡号：COSTRA-157 · FU-001 转正
 *
 * 职责：集中暴露"业务占位/默认值"常量 · 业务代码不得硬编码字符串
 * 当前消费方：authService.ts:wxLogin（首登用户昵称占位）
 *
 * ⚠️ 必须与 miniprogram/config/defaults.ts 保持值一致（手工对齐 · CI 闸门 G7 强制对账）
 *
 * 未来扩展：
 *   - Q2-A 决策：MVP 不引入 env 覆盖（保持编译期常量）
 *   - 真有多商户/多主体差异化需求时 · 升级为 subjectConfig.defaultNickname（D-008 联动）
 */

export const defaultNickname = '微信用户';

/**
 * 单用户可创建（own）的最大 shared family 数量（产品配置值）
 * 修改此值即可快速扩容；不得超过 maxSharedFamiliesHardLimit
 * ⚠️ 必须与 miniprogram/config/defaults.ts maxSharedFamilies 保持一致
 */
export const maxSharedFamilies = 5;

/**
 * 程序硬上限（架构约束 · 不建议超过）
 * ⚠️ 必须与 miniprogram/config/defaults.ts maxSharedFamiliesHardLimit 保持一致
 */
export const maxSharedFamiliesHardLimit = 20;

/**
 * 每个家庭（shared family）的成员数上限（含 owner）
 * ⚠️ 必须与 miniprogram/config/defaults.ts maxFamilyMembers 保持一致
 */
export const maxFamilyMembers = 8;

/**
 * 单账本条目数软上限（【临时限制 · 2026-09-10】）。
 * 客户端 3.8.x 在单账本条目数很大时存在明显性能退化（本地库读写、渲染），
 * 优化排期约两个月人力，期间用此上限拦住会突破 8000 的导入（导入数据行数上界 + 账本现有条目数 > 上限即拒绝）。
 * 优化完成后应放宽或移除此限制。
 * ⚠️ 必须与 miniprogram/config/defaults.ts maxLedgerEntries 保持一致
 */
export const maxLedgerEntries = 8000;
