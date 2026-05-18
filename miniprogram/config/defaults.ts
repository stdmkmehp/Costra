// miniprogram/config/defaults.ts · 默认值常量
// 卡号：COSTRA-157 · FU-118-2 + FU-001 双端同步
//
// ⚠️ 必须与 server/src/config/defaults.ts 保持值一致（手工对齐 · CI 闸门 G7 强制对账 · grep | sort -u | wc -l == 1）
// 编译边界隔离：miniprogram 编译不能 import server/ · 双份必要
//
// 未来扩展：COSTRA-160 tokens pipeline 可能扩展为构建期同步

export const defaultNickname = '微信用户';
