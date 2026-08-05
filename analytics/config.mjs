// config.mjs · 阈值配置（见 spec §7.1）
// 展示阈值：users=10, ledgers=10, entries=20, invites=5, active=8
//
// 活跃判定规则（不可配置）：
//   活跃用户：最近 7 天内有 ≥2 天进行过记账（含高活跃）
//高活跃用户：最近 7 天内有 ≥5 天进行过记账
//   仅自动记账预警：连续 7/14/30 天只有自动记账没有手动记账

export const DEFAULT_THRESHOLDS = {
  users:   10,
  ledgers: 10,
  entries: 20,
  invites: 5,
  active:  8,
};

/**
 * 从环境变量加载阈值（可选覆盖）
 * @param {Record<string, string>} env - process.env 或等价对象
 * @returns {typeof DEFAULT_THRESHOLDS}
 */
export function loadThresholds(env) {
  const parse = (val, def) => {
    const n = parseInt(val || '', 10);
    return isNaN(n) || n <= 0 ? def : n;
  };
  return {
    users:   parse(env.THRESHOLD_USERS,   DEFAULT_THRESHOLDS.users),
    ledgers: parse(env.THRESHOLD_LEDGERS, DEFAULT_THRESHOLDS.ledgers),
    entries: parse(env.THRESHOLD_ENTRIES, DEFAULT_THRESHOLDS.entries),
    invites: parse(env.THRESHOLD_INVITES, DEFAULT_THRESHOLDS.invites),
    active:  parse(env.THRESHOLD_ACTIVE,  DEFAULT_THRESHOLDS.active),
  };
}
