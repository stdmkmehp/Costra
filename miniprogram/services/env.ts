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
    apiBaseUrl: 'http://127.0.0.1:3000/v1',
    mockLogin: true,
    flags: {
      family_sharing: true,
      subscribe_msg: true,
      share_card_variant: false
    }
  },
  staging: {
    name: 'staging',
    // D-009 锁定：生产域名 costra.cloud；预发 api-staging.costra.cloud
    apiBaseUrl: 'https://api-staging.costra.cloud/v1',
    mockLogin: false,
    flags: {
      family_sharing: true,
      subscribe_msg: true,
      share_card_variant: false
    }
  },
  prod: {
    name: 'prod',
    // D-009 锁定：生产 API 入口 api.costra.cloud（ICP 备案下证后生效，见 docs/devops/domains.md）
    apiBaseUrl: 'https://api.costra.cloud/v1',
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
