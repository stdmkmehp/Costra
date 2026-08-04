// services/env.ts ·环境与 Feature Flag 读取
// 卡号: COSTRA-030 · ADR-0004 §7

export type EnvName = 'dev' | 'staging' | 'prod';

interface EnvConfig {
  name: EnvName;
  apiBaseUrl: string;
  mockLogin: boolean;
  flags: Record<string, boolean>;
}

const ENV_MAP: Record<EnvName, EnvConfig> = {
  dev: {
    name: 'dev',
    apiBaseUrl: 'http://localhost:8080/v1',
    mockLogin: true,
    flags: {
      family_sharing: true,
      subscribe_msg: true,
      share_card_variant: false
    }
  },
  staging: {
    name: 'staging',
    // Sprint-4 启用 stg 子域独立后端（infra/wechat/domains.md §1.1）
    // 微信白名单已加 https://stg.costra.cloud · 备案沿用主体主备案（沪ICP备2026017253号-2）
    apiBaseUrl: 'https://stg.costra.cloud/v1',
    mockLogin: false,
    flags: {
      family_sharing: true,
      subscribe_msg: true,
      share_card_variant: false
    }
  },
  prod: {
    name: 'prod',
    // D-009 §2.1 锁定主域 costra.cloud；D-023 决策 prod 入口回归根域，子域 api.costra.cloud 搁置至 Phase-2
    apiBaseUrl: 'https://costra.cloud/v1',
    mockLogin: false,
    flags: {
      family_sharing: true,
      subscribe_msg: true,
      share_card_variant: false
    }
  }
};

/**
 * 当前环境自动分流（COSTRA-030 · Sprint-4 启用）
 *
 * 分流规则（依据 wx.getAccountInfoSync().miniProgram.envVersion）：
 *   -'release'正式版→ prod
 *   - 'trial'   体验版      → staging（上传体验版 = 部署到 staging 联调）
 *   - 'develop' 开发版→ dev（本地开发者工具默认 · 打localhost）
 *   - 其它 /抛异常 / API缺失 → dev（保守回退 · 不误打生产）
 *
 * 单元测试 / Node 环境（无 wx 全局）：回退 dev。
 *
 * ⚠️ 若需在开发者工具里"本地跑但打 staging"，可手动改常量为 'staging' · 但不要commit。
 *⚠️ D-026 §2.3 C2 红线：staging.mockLogin 与 prod.mockLogin 均为 false · 不可放松。
 */
type WxRuntime = {
  getAccountInfoSync?: () => {
    miniProgram?: {
      envVersion?: string;
    };
  };
};

function detectEnv(): EnvName {
  try {
    const g: WxRuntime | undefined = typeof wx !== 'undefined' ? wx : undefined;
    const envVersion = g?.getAccountInfoSync?.()?.miniProgram?.envVersion;
    const env: EnvName = envVersion === 'release' ? 'prod' : envVersion === 'trial' ? 'staging' : 'dev';

    if (g) {
      console.info('[env] detectEnv', { envVersion: envVersion ?? 'unknown', env });
    }

    return env;
  } catch (err) {
    console.warn('[env] detectEnv fallback dev', err);
    return 'dev';
  }
}

const CURRENT_ENV: EnvName = detectEnv();

export function getEnv(): EnvConfig {
  return ENV_MAP[CURRENT_ENV];
}

export function isFlagOn(key: string): boolean {
  return Boolean(getEnv().flags[key]);
}
