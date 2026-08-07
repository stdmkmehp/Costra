/**
 * Costra · Server · 运行时环境配置加载器
 *
 * 卡号：COSTRA-101 · 微信登录服务端实装
 * 事实源：server/.env.example（启动必填项清单）
 *
 * 设计原则：
 *   1. 启动期一次性读取所有 env，冻结成只读对象；运行时严禁直接读 process.env。
 *   2. 关键字段缺失 → 抛错让进程启动失败，避免业务在半配置状态下继续跑。
 *   3. 生产 / 测试模式分叉：测试可注入自定义 env，避免污染全局单例。
 *   4. 与 src/config/subject.ts 一致的"required / optional / default"三分法。
 *
 * 依赖层：基础设施层（无业务依赖）；可被 app / plugins / services / repositories 自由 import。
 */

export type NodeEnv = 'development' | 'test' | 'production';

export interface AppEnv {
  /** 运行环境 */
  nodeEnv: NodeEnv;
  /** HTTP 监听端口 */
  port: number;
  /** 日志级别（pino） */
  logLevel: 'trace' | 'debug' | 'info' | 'warn' | 'error' | 'fatal';

  /** PostgreSQL 连接串（形如 postgres://user:pass@host:5432/dbname） */
  databaseUrl: string;
  /** Redis 连接串（形如 redis://:pass@host:6379/0） */
  redisUrl: string;

  /** JWT HMAC 共享密钥（HS256），长度必须 >= 32 字符 */
  jwtSecret: string;
  /** JWT iss（签发方） */
  jwtIssuer: string;
  /** JWT aud（受众，通常 = 小程序 AppID） */
  jwtAudience: string;

  /** 微信 AppID */
  wxAppId: string;
  /** 微信 AppSecret */
  wxAppSecret: string;
  /** code2Session 上游 URL（默认腾讯官方地址，测试可替换为 mock server） */
  wxCode2SessionUrl: string;

  /** dev 专用 · WX code2Session mock 注入开关 · 仅 nodeEnv=development 生效 · prod/test 严禁 */
  wxMockLogin: boolean;

  /** 构建版本号（CI 注入；本地可为空串） */
  buildSha: string;

  /** COSTRA-164: 后端硬上限 · 每用户最多可创建/加入的 family 数量 · 防恶意创建 */
  maxFamiliesPerUser: number;
  /** COSTRA-164: 应用层校验上限 · MVP 限制用户可见 family 数量 · 可调 · 校验逻辑推 COSTRA-201 */
  userVisibleFamilyLimit: number;

  /** 生产日志落盘文件基名（pino-roll 写入 · 默认 /var/log/costra/server） */
  logFile: string;
}

function required(env: NodeJS.ProcessEnv, key: string): string {
  const v = env[key];
  if (v == null || v === '') {
    throw new Error(`[env] missing required env: ${key}`);
  }
  return v;
}

function optional(env: NodeJS.ProcessEnv, key: string, fallback: string): string {
  const v = env[key];
  return v == null || v === '' ? fallback : v;
}

function parseNodeEnv(v: string): NodeEnv {
  if (v === 'development' || v === 'test' || v === 'production') return v;
  throw new Error(`[env] NODE_ENV must be development|test|production, got: ${v}`);
}

function parsePort(v: string): number {
  const n = Number(v);
  if (!Number.isInteger(n) || n < 1 || n > 65535) {
    throw new Error(`[env] PORT must be integer in [1, 65535], got: ${v}`);
  }
  return n;
}

function parseBool(v: string | undefined, fallback: boolean): boolean {
  if (v == null || v === '') return fallback;
  if (v === '1' || v === 'true' || v === 'TRUE') return true;
  if (v === '0' || v === 'false' || v === 'FALSE') return false;
  throw new Error(`[env] expected boolean (1/0/true/false), got: ${v}`);
}

function parseLogLevel(v: string): AppEnv['logLevel'] {
  const allowed: AppEnv['logLevel'][] = ['trace', 'debug', 'info', 'warn', 'error', 'fatal'];
  if ((allowed as string[]).includes(v)) return v as AppEnv['logLevel'];
  throw new Error(`[env] LOG_LEVEL must be one of ${allowed.join('|')}, got: ${v}`);
}

function parseIntOrDefault(v: string | undefined, fallback: number): number {
  if (v == null || v === '') return fallback;
  const n = Number(v);
  if (!Number.isInteger(n) || n < 1) {
    throw new Error(`[env] expected positive integer, got: ${v}`);
  }
  return n;
}

/**
 * 从给定的 env（默认 process.env）构造 AppEnv。
 * 测试注入：loadEnv({ NODE_ENV: 'test', ... })。
 */
export function loadEnv(env: NodeJS.ProcessEnv = process.env): Readonly<AppEnv> {
  const jwtSecret = required(env, 'JWT_SECRET');
  if (jwtSecret.length < 32) {
    throw new Error('[env] JWT_SECRET length must be >= 32 chars (HS256 security baseline)');
  }

  const cfg: AppEnv = {
    nodeEnv: parseNodeEnv(optional(env, 'NODE_ENV', 'development')),
    port: parsePort(optional(env, 'PORT', '8080')),
    logLevel: parseLogLevel(optional(env, 'LOG_LEVEL', 'info')),

    databaseUrl: required(env, 'DATABASE_URL'),
    redisUrl: required(env, 'REDIS_URL'),

    jwtSecret,
    jwtIssuer: optional(env, 'JWT_ISSUER', 'costra-api'),
    jwtAudience: required(env, 'JWT_AUDIENCE'),

    wxAppId: required(env, 'WX_APP_ID'),
    wxAppSecret: required(env, 'WX_APP_SECRET'),
    wxCode2SessionUrl: optional(
      env,
      'WX_CODE2SESSION_URL',
      'https://api.weixin.qq.com/sns/jscode2session',
    ),

    wxMockLogin: parseBool(env['WX_MOCK_LOGIN'], false),

    buildSha: optional(env, 'BUILD_SHA', ''),

    maxFamiliesPerUser: parseIntOrDefault(env['MAX_FAMILIES_PER_USER'], 20),
    userVisibleFamilyLimit: parseIntOrDefault(env['USER_VISIBLE_FAMILY_LIMIT'], 3),

    logFile: optional(env, 'COSTRA_LOG_FILE', '/var/log/costra/server'),
  };
  if (cfg.wxMockLogin && cfg.nodeEnv !== 'development') {
    throw new Error('[env] WX_MOCK_LOGIN can only be enabled in NODE_ENV=development');
  }
  return Object.freeze(cfg);
}

/**
 * 模块级默认单例。
 * 注意：import 时即会尝试读取 process.env → 测试代码应在 vi.mock 或 beforeAll 中
 * 先用 loadEnv(customEnv) 构造隔离实例，避免污染其他用例。
 */
let _singleton: Readonly<AppEnv> | null = null;

/** 首次调用时初始化单例；后续调用返回同一实例。 */
export function appEnv(): Readonly<AppEnv> {
  if (_singleton == null) {
    _singleton = loadEnv();
  }
  return _singleton;
}

/** 仅用于测试：重置单例以便下轮 loadEnv() 拿到新值。 */
export function __resetEnvForTests(): void {
  _singleton = null;
}
