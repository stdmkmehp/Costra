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
