// utils/error-mapper.ts · 错误码 → 用户可读文案
// 卡号: COSTRA-102 · 契约锚点: docs/api/error-codes.md §4
// 设计原则：
//   - 客户端**不得**直接展示服务端 `message` 给终端用户（error-codes.md §0.5）
//   - 所有 ApiError 统一走 mapError 转译为 { title, desc, action? }
//   - BUSINESS_RULE_VIOLATION 按 details.rule 分支（error-codes.md §4.2）

import { maxSharedFamilies, maxSharedFamiliesHardLimit, maxFamilyMembers } from '../config/defaults';

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
  ALREADY_MEMBER:             { title: '已是成员', desc: '你已经在该家庭中' },
  EXPORT_JOB_IN_PROGRESS:     { title: '已有导出任务进行中', desc: '请等待当前导出完成后再发起' },
  IMPORT_JOB_IN_PROGRESS:     { title: '该账本已有导入任务进行中', desc: '请等待当前导入完成后再发起' },
  DETECT_IN_PROGRESS:         { title: '上一个文件还在检测中', desc: '请稍候' },

  // 410
  INVITE_EXPIRED: { title: '邀请链接已失效', desc: '该链接已被使用或已过期，请联系家庭创建者重新发起邀请' },
  EXPORT_FILE_EXPIRED: { title: '文件已过期', desc: '请重新导出' },
  DETECT_SESSION_EXPIRED: { title: '检测已过期', desc: '请重新上传文件' },

  // 413
  PAYLOAD_TOO_LARGE: { title: '文件过大', desc: '文件超过 1MB（约 5,000 条记录），请拆分后分批导入' },

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
  family_member_limit:       `该家庭成员已达上限（最多 ${maxFamilyMembers} 个）`,
  shared_family_limit:       `协作账本数量已达上限，最多创建 ${maxSharedFamilies} 个`,
  shared_family_hard_limit:  `协作账本数量已达程序上限（${maxSharedFamiliesHardLimit} 个）`,
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

// ─── data_jobs 失败原因（data-import-export v1.0 §9.5 error_code 取值域）────────────
// 任务中心失败卡片按 code 渲染（禁渲染服务端 error_message · 内部细节不暴露）。
// 值域含中间态 code：TRANSIENT_* / WORKER_LOST 会出现在「重试中」的 queued 任务上
// （markRetryQueued 保留上次失败原因），当前页面只在 failed 渲染，登记于此保证唯一出口完备。
const DATA_JOB_ERROR_MESSAGES: Record<string, string> = {
  ARTIFACT_MISSING: '检测产物已失效，请重新检测后导入',
  CONTEXT_INVALIDATED: '账本或成员信息已变化，请重新检测后导入',
  CONSTRAINT_VIOLATION: '数据校验失败，请重新检测后导入',
  TRANSIENT_DB: '服务繁忙，请稍后重试',
  TRANSIENT_IO: '服务繁忙，请稍后重试',
  WORKER_LOST: '服务繁忙，请稍后重试',
  QUEUE_LEASE_EXPIRED: '任务排队超时，请重新发起',
  INTERNAL: '服务异常，请稍后重试',
};

/**
 * data_jobs.error_code → 用户可读失败原因（§9.5 按 code 渲染的唯一出口）。
 * 未知 code 归 mapError 同款兜底文案。
 */
export function describeDataJobError(code: string | null | undefined): string {
  return (code && DATA_JOB_ERROR_MESSAGES[code]) || '网络异常，请稍后再试';
}
