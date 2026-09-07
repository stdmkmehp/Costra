/**
 * Costra · Server · TTL 集中配置
 *
 * 卡号：COSTRA-101 · 事实源：docs/api/ttl-policy.md §4.1
 *
 * 职责：
 *   - 唯一权威 TTL 读取点；业务层禁止在代码内硬编码秒/时/天。
 *   - 启动期从 env 读取一次，冻结为只读对象；运行时不可变更。
 *   - 所有键必须与 server/.env.example `TTL_*` 段一一对应。
 *
 * ttl-policy.md §7 的滑动刷新 / 短 TTL + 黑名单等方案属 Sprint-2+ 范围，本层不预留开关。
 */

export interface TTLConfig {
  /** access_token 有效秒数（默认 7200 = 2h） */
  accessTokenSec: number;
  /** refresh_token 有效秒数（默认 2592000 = 30d） */
  refreshTokenSec: number;
  /** 家庭邀请默认时效（小时，默认 24） */
  inviteDefaultHours: number;
  /** 家庭邀请最大时效上限（小时，默认 168） */
  inviteMaxHours: number;
  /** Idempotency-Key 去重窗口（小时，默认 24） */
  idempotencyHours: number;
  /** 审计日志热数据保留期（天，默认 180） */
  auditHotDays: number;
  /** 游标 next_cursor 有效时间（小时，默认 72） */
  cursorHours: number;
  /** 限流桶窗口（秒，默认 60） */
  rateWindowSec: number;
  /** JWT 校验时钟偏移容错（秒，默认 60；ttl-policy.md §4.3） */
  clockToleranceSec: number;
  /** GM 用户双榜单 Redis 缓存时效（秒，默认 1800 = 30min） */
  gmActiveUsersSec: number;
  /** 赞赏：对账调度器 tick 周期（秒，默认 60） */
  tipSchedulerTickSec: number;
  /** 赞赏：探测租约/节流（秒，默认 3 · 与客户端退避 2/2/4/8/15 耦合：5 次有效探测 t=0/4/8/16/31） */
  tipProbeMinIntervalSec: number;
  /** 赞赏：created 单观察窗口（秒，默认 1800 = 30min · T3：窗口外未支付 ⇒ mark_expired） */
  tipProbeWindowSec: number;
  /** 赞赏：对账单次扫描批量上限（默认 50） */
  tipProbeBatchSize: number;
}

function parseIntOr(v: string | undefined, fallback: number, key: string): number {
  if (v == null || v === '') return fallback;
  const n = Number(v);
  if (!Number.isInteger(n) || n <= 0) {
    throw new Error(`[ttl] ${key} must be positive integer, got: ${v}`);
  }
  return n;
}

/** 从 env 加载 TTL 配置（测试可注入自定义 env）。 */
export function loadTTL(env: NodeJS.ProcessEnv = process.env): Readonly<TTLConfig> {
  const cfg: TTLConfig = {
    accessTokenSec: parseIntOr(env.TTL_ACCESS_TOKEN_SEC, 7200, 'TTL_ACCESS_TOKEN_SEC'),
    refreshTokenSec: parseIntOr(env.TTL_REFRESH_TOKEN_SEC, 2592000, 'TTL_REFRESH_TOKEN_SEC'),
    inviteDefaultHours: parseIntOr(env.TTL_INVITE_DEFAULT_HOURS, 24, 'TTL_INVITE_DEFAULT_HOURS'),
    inviteMaxHours: parseIntOr(env.TTL_INVITE_MAX_HOURS, 168, 'TTL_INVITE_MAX_HOURS'),
    idempotencyHours: parseIntOr(env.TTL_IDEMPOTENCY_HOURS, 24, 'TTL_IDEMPOTENCY_HOURS'),
    auditHotDays: parseIntOr(env.TTL_AUDIT_HOT_DAYS, 180, 'TTL_AUDIT_HOT_DAYS'),
    cursorHours: parseIntOr(env.TTL_CURSOR_HOURS, 72, 'TTL_CURSOR_HOURS'),
    rateWindowSec: parseIntOr(env.TTL_RATE_WINDOW_SEC, 60, 'TTL_RATE_WINDOW_SEC'),
    clockToleranceSec: parseIntOr(env.TTL_CLOCK_TOLERANCE_SEC, 60, 'TTL_CLOCK_TOLERANCE_SEC'),
    gmActiveUsersSec: parseIntOr(env.TTL_GM_ACTIVE_USERS_SEC, 1800, 'TTL_GM_ACTIVE_USERS_SEC'),
    tipSchedulerTickSec: parseIntOr(env.TTL_TIP_SCHEDULER_TICK_SEC, 60, 'TTL_TIP_SCHEDULER_TICK_SEC'),
    tipProbeMinIntervalSec: parseIntOr(env.TTL_TIP_PROBE_MIN_INTERVAL_SEC, 3, 'TTL_TIP_PROBE_MIN_INTERVAL_SEC'),
    tipProbeWindowSec: parseIntOr(env.TTL_TIP_PROBE_WINDOW_SEC, 1800, 'TTL_TIP_PROBE_WINDOW_SEC'),
    tipProbeBatchSize: parseIntOr(env.TTL_TIP_PROBE_BATCH_SIZE, 50, 'TTL_TIP_PROBE_BATCH_SIZE'),
  };

  // tech-spec v1.2 §6.1 节奏表最后一档为 T+30min（1800s）：windowSec 必须 ≥ 1800，
  // 否则最后一档探测永远落在 T3 窗口外（节奏失真）。
  if (cfg.tipProbeWindowSec < 1800) {
    throw new Error(
      `TTL_TIP_PROBE_WINDOW_SEC must be >= 1800 (probe schedule's last slot T+30min), got: ${cfg.tipProbeWindowSec}`,
    );
  }

  // 一致性校验：invite 默认值不得超过上限
  if (cfg.inviteDefaultHours > cfg.inviteMaxHours) {
    throw new Error(
      `[ttl] TTL_INVITE_DEFAULT_HOURS (${cfg.inviteDefaultHours}) must not exceed ` +
        `TTL_INVITE_MAX_HOURS (${cfg.inviteMaxHours})`,
    );
  }

  return Object.freeze(cfg);
}

/** 默认单例：模块加载期即可消费。测试用 loadTTL(customEnv) 创建隔离实例。 */
let _singleton: Readonly<TTLConfig> | null = null;
export function ttl(): Readonly<TTLConfig> {
  if (_singleton == null) _singleton = loadTTL();
  return _singleton;
}
export function __resetTTLForTests(): void {
  _singleton = null;
}
