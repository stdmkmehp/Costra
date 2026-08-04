// config.mjs · 阈值配置（见 spec §7.1）
// 阈值：users=10, ledgers=10, entries=20, invites=5, active=8

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
