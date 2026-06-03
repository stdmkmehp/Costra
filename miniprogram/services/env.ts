// services/env.ts · 环境与 Feature Flag 读取
// 卡号: COSTRA-030 · ADR-0004 §7

export type EnvName = 'dev' | 'staging' | 'prod';

interface EnvConfig {
  name: EnvName;
  apiBaseUrl: string;
  mockLogin: boolean;
  flags: Record<string, boolean>;
}

// 实际部署时由构建脚本替换，此处提供默认 dev 值
const ENV_MAP: Record<EnvName, EnvConfig> = {
  dev: {
    name: 'dev',
    apiBaseUrl: 'http://localhost:8080/v1',
    mockLogin: false,
    flags: {
      family_sharing: true,
      subscribe_msg: true,
      share_card_variant: false
    }
  },
  staging: {
    name: 'staging',
    // D-023 临时复用 prod URL（子域 api-staging.costra.cloud 搁置至 Phase-2 · D-023 §2.4 触发条件之一启用时切回）
    apiBaseUrl: 'https://costra.cloud/v1',
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

// 当前环境：由 __wxConfig 或编译期替换决定，这里默认 dev
const CURRENT_ENV: EnvName = 'dev';

export function getEnv(): EnvConfig {
  return ENV_MAP[CURRENT_ENV];
}

export function isFlagOn(key: string): boolean {
  return Boolean(getEnv().flags[key]);
}
