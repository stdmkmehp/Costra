// tokens/index.ts · 从 docs/design/tokens.json 同步，只读常量
// 卡号: COSTRA-030 · COSTRA-011
// ⚠️ 禁止手改；由 scripts/sync-tokens.mjs 生成（v0.2 接入 DevOps 工作流）

import tokensJson from './tokens.json';

export const tokens = tokensJson;
export type Tokens = typeof tokens;

export const color = tokens.color;
export const spacing = tokens.spacing;
export const radius = tokens.radius;
// typography / shadow：v0.2 由设计同步后开放导出。
