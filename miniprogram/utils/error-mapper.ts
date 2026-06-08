// utils/error-mapper.ts · 错误码 → 用户可读文案
// 卡号: COSTRA-102 · 契约锚点: docs/api/error-codes.md §4
// 设计原则：
//   - 客户端**不得**直接展示服务端 `message` 给终端用户（error-codes.md §0.5）
//   - 所有 ApiError 统一走 mapError 转译为 { title, desc, action? }
//   - BUSINESS_RULE_VIOLATION 按 details.rule 分支（error-codes.md §4.2）

export interface MappedError {
  title: string;
  desc: string;
  /** 用户侧下一步动作提示（可选） */
  action?: 'navigate-login' | 'navigate-family-home' | 'refresh' | 'view-conflict';
}

interface ApiErrorLike {
  code: string;
  status?: number;
  details?: Record<string, unknown>;
}

const DEFAULT_MAP: Record<string, MappedError> = {
  // 400 param
  INVALID_ARGUMENT:     { title: '输入有误', desc: '请检查后重试' },
  MALFORMED_JSON:       { title: '请求异常', desc: '请稍后再试' },
  IDEMPOTENCY_KEY_REQUIRED: { title: '请求异常', desc: '请稍后再试' },
  UNSUPPORTED_MEDIA_TYPE:   { title: '请求异常', desc: '请稍后再试' },

  // 401 auth
  UNAUTHENTICATED:       { title: '登录已失效', desc: '请重新登录', action: 'navigate-login' },
  TOKEN_EXPIRED:         { title: '', desc: '' }, // 静默（自动续签）
  REFRESH_TOKEN_INVALID: { title: '登录已失效', desc: '请重新登录', action: 'navigate-login' },
  WX_CODE_INVALID:       { title: '登录凭证失效', desc: '请重新打开小程序', action: 'navigate-login' },

  // 403
  PERMISSION_DENIED:  { title: '权限不足', desc: '仅家庭创建者可执行此操作' },
  FAMILY_NOT_MEMBER:  { title: '无法访问', desc: '该家庭已移除你的身份', action: 'navigate-family-home' },

  // 404
  NOT_FOUND: { title: '记录不存在', desc: '可能已被删除', action: 'refresh' },

  // 409
  VERSION_CONFLICT:           { title: '数据冲突', desc: '该条记录已被其他成员修改', action: 'view-conflict' },
  DUPLICATE_RESOURCE:         { title: '已存在', desc: '该名称已被使用，请换一个' },
  IDEMPOTENCY_KEY_MISMATCH:   { title: '请求异常', desc: '请稍后再试' },

  // 410
  INVITE_EXPIRED: { title: '邀请链接已失效', desc: '该链接已被使用或已过期，请联系家庭创建者重新发起邀请' },

  // 429
  RATE_LIMITED: { title: '操作过于频繁', desc: '请稍后再试' },

  // 5xx
  INTERNAL:    { title: '网络异常', desc: '请稍后再试' },
  UNAVAILABLE: { title: '网络异常', desc: '请稍后再试' },
  TIMEOUT:     { title: '网络异常', desc: '请稍后再试' },
  NOT_IMPLEMENTED: { title: '功能暂未开放', desc: '敬请期待' },

  // 客户端侧（P1-2 CLIENT_ 前缀）
  CLIENT_NETWORK_ERROR: { title: '网络异常', desc: '请检查网络后重试' },
};

const BUSINESS_RULE_TEXT: Record<string, string> = {
  family_member_limit:       '该家庭成员已达上限（MVP = 10）',
  shared_family_limit:       `协作账本数量已达上限，最多创建 3 个`,
  shared_family_hard_limit:  `协作账本数量已达程序上限（20 个）`,
  category_name_duplicate:   '分类名称已存在',
  budget_overlap:            '该月份已存在相同分类的预算',
  ledger_archived:           '该账本已归档，无法继续记账',
  entry_occurred_at_future:  '记账时间不能晚于当前时间 1 小时以上',
  currency_mismatch:         '流水币种与账本不一致',
};

/**
 * 映射错误码为用户可读文案
 *
 * 行为：
 * - TOKEN_EXPIRED：返回空 title/desc（自动续签场景静默）
 * - BUSINESS_RULE_VIOLATION：按 details.rule 分支
 * - 未知 code（含 CLIENT_HTTP_xxx / 未登记 CLIENT_*）：走兜底文案（与 INTERNAL 一致）
 */
export function mapError(err: ApiErrorLike): MappedError {
  const { code } = err;

  if (code === 'BUSINESS_RULE_VIOLATION') {
    const rule = (err.details && typeof err.details['rule'] === 'string')
      ? (err.details['rule'] as string)
      : '';
    return {
      title: '操作未通过',
      desc: BUSINESS_RULE_TEXT[rule] || '业务规则未通过，请检查后重试',
    };
  }

  const hit = DEFAULT_MAP[code];
  if (hit) return hit;

  // 未知 code → 兜底
  return { title: '网络异常', desc: '请稍后再试' };
}
