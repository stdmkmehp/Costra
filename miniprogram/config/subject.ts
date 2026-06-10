// miniprogram/config/subject.ts · 主体信息集中配置
// 卡号：COSTRA-030 Round-2 占位 · D-008 主体策略
// 正式实装见 Sprint-1 COSTRA-112
//
// ⚠️ 严禁在业务代码、分享卡片、订阅消息文案、隐私指引中硬编码主体信息。
// 一律通过此模块的常量读取，Sprint-1 COSTRA-112 会把值注入机制改为
// 编译期注入（`__wxConfig` + CI 环境变量）或 .env 读取。

export type SubjectType = 'individual' | 'corporate';

/** MVP 阶段采用个人主体（D-008）；公司主体兼容就绪，见 docs/ops/subject-compat-matrix.md */
export const SUBJECT_TYPE: SubjectType = 'individual';

/** 对外名称（D-007）：MVP 阶段不拆分内部代号与上架名 */
export const SUBJECT_NAME = 'Costra';

/** ICP 备案号：个人主体备案受理中（D-009），下证后由 Sprint-1 COSTRA-112 回填 */
export const ICP_NUMBER = '';

/** 主体联系邮箱：Human 在微信后台《用户隐私保护指引》填写时确定 */
export const CONTACT_EMAIL = '';

/** 隐私指引生效日期：微信后台发布时间，由 PM-Agent COSTRA-109 提供 */
export const PRIVACY_EFFECTIVE_DATE = '';

export default {
  SUBJECT_TYPE,
  SUBJECT_NAME,
  ICP_NUMBER,
  CONTACT_EMAIL,
  PRIVACY_EFFECTIVE_DATE
};
