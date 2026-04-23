/**
 * Costra · 主体配置（Subject Config）
 *
 * 决议：D-008 · 个人主体先行 · 公司主体兼容
 * 卡号：COSTRA-113（搭车 COSTRA-100）
 *
 * 职责：
 *   - 集中读取所有"主体相关常量"；业务层严禁硬编码主体名 / ICP 号 / 联系方式。
 *   - 从环境变量加载，启动期冻结；不支持运行时变更。
 *   - 被以下模块消费：
 *     · 服务端渲染隐私指引 / 用户协议的占位替换
 *     · 审计日志 `data_controller` 字段
 *     · 订阅消息 / 运营通知文案
 *
 * 切换公司主体时仅需：
 *   1. 改 .env.production 中的 SUBJECT_* 段（身份证主体名 → 公司名 + 新 ICP 号）
 *   2. 重启后端进程
 *   3. 同步更新 miniprogram/config/subject.ts（COSTRA-112 Owner）
 */

export type SubjectType = 'individual' | 'corporate';

export interface SubjectConfig {
  /** 主体名称（个人：身份证姓名；公司：工商注册全称） */
  name: string;
  /** 主体类型 */
  type: SubjectType;
  /** ICP 备案号（如 "蜀ICP备xxxxxxx号-1"）；备案未下证时为空串 */
  icpNumber: string;
  /** 客服 / 运营对外邮箱 */
  contactEmail: string;
  /** 客服 / 运营对外电话（可选，MVP 可空） */
  contactPhone: string;
  /** 隐私政策生效日期（ISO 日期） */
  privacyEffectiveDate: string;
  /** 数据控制者（写入 audit_logs 的字段；通常 = name，但保留独立键便于策略差异化） */
  dataController: string;
}

function required(envKey: string, fallback?: string): string {
  const v = process.env[envKey];
  if (v == null || v === '') {
    if (fallback !== undefined) return fallback;
    // 生产环境缺失关键主体字段应直接启动失败（由上层 bootstrapper 捕获）
    throw new Error(`[subject-config] missing required env: ${envKey}`);
  }
  return v;
}

function parseType(v: string): SubjectType {
  if (v === 'individual' || v === 'corporate') return v;
  throw new Error(`[subject-config] SUBJECT_TYPE must be 'individual' | 'corporate', got: ${v}`);
}

/**
 * 加载主体配置（启动期调用一次）。
 * 测试注入可用 loadSubjectConfig(customEnv)。
 */
export function loadSubjectConfig(env: NodeJS.ProcessEnv = process.env): Readonly<SubjectConfig> {
  const name = required('SUBJECT_NAME');
  const type = parseType(required('SUBJECT_TYPE', 'individual'));
  const cfg: SubjectConfig = {
    name,
    type,
    icpNumber: env.SUBJECT_ICP_NUMBER ?? '',
    contactEmail: required('SUBJECT_CONTACT_EMAIL'),
    contactPhone: env.SUBJECT_CONTACT_PHONE ?? '',
    privacyEffectiveDate: required('SUBJECT_PRIVACY_EFFECTIVE_DATE'),
    dataController: env.SUBJECT_DATA_CONTROLLER ?? name,
  };
  return Object.freeze(cfg);
}

/** 默认单例；生产模块导入后立即可用。测试请用 loadSubjectConfig() 创建隔离实例。 */
export const subjectConfig: Readonly<SubjectConfig> = loadSubjectConfig();

/**
 * 模板占位替换辅助：把 `{{SUBJECT_NAME}}` / `{{SUBJECT_ICP}}` 等占位替换为实际值。
 * 用于隐私指引、用户协议、运营文案渲染。
 */
export function renderSubjectTemplate(
  template: string,
  cfg: Readonly<SubjectConfig> = subjectConfig
): string {
  return template
    .replace(/\{\{SUBJECT_NAME\}\}/g, cfg.name)
    .replace(/\{\{SUBJECT_TYPE\}\}/g, cfg.type)
    .replace(/\{\{SUBJECT_ICP\}\}/g, cfg.icpNumber)
    .replace(/\{\{SUBJECT_CONTACT_EMAIL\}\}/g, cfg.contactEmail)
    .replace(/\{\{SUBJECT_CONTACT_PHONE\}\}/g, cfg.contactPhone)
    .replace(/\{\{SUBJECT_PRIVACY_EFFECTIVE_DATE\}\}/g, cfg.privacyEffectiveDate)
    .replace(/\{\{SUBJECT_DATA_CONTROLLER\}\}/g, cfg.dataController);
}
