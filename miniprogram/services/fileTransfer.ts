// services/fileTransfer.ts · 带鉴权的文件下载（账本导出产物）
//
// 事实源：docs/design/data-import-export-client-analysis.md v1.0 §6/§9.5/§14.2
//
// 为什么独立于 request.ts：wx.downloadFile 与 wx.request 是两套 API——
// 下载层需要自带「刷 token → 注入 Authorization → 401 重放一次 → 错误分类」闭环：
//   1. 发起前确保 token 新鲜（临期先续签）；
//   2. 401 ⇒ refreshToken() 一次并重放一次（与 request.ts 的 retried 语义对齐）；
//   3. 非 200 时错误体在下载产物里（wx.downloadFile 任何状态都会落临时文件），
//      需读文件解析 {code,message}；非 JSON 兜底 CLIENT_HTTP_{status}；
//   4. 200 后用 wx.getFileInfo 强校验 sha256（导出契约 X-Content-Sha256 / files[].sha256）。
//
// 纯函数（classifyDownloadErrorBody / makeDownloadApiError）独立导出供单测。

import { getEnv } from './env';
import { getToken, refreshToken } from './auth';
import type { ApiError } from './request';
import { logger } from '../utils/logger';

const MODULE = 'fileTransfer';

// ==============================================================================
// 纯函数（单测载体）
// ==============================================================================

export function makeDownloadApiError(
  status: number,
  code: string,
  message: string,
  traceId?: string,
): ApiError {
  const err = new Error(message) as ApiError;
  err.code = code;
  err.status = status;
  if (traceId) err.traceId = traceId;
  return err;
}

/**
 * 非 JSON / 无 code 响应体的 statusCode 兜底映射（§9.5 v1.0 P2 配套）：
 * nginx / 网关层错误体不是服务端 JSON 契约（413 HTML / 502 网关页等），
 * 按 statusCode 映射到既有语义码，避免用户看到无指引的 CLIENT_HTTP_{status}。
 */
function fallbackCodeByStatus(status: number): string {
  if (status === 413) return 'PAYLOAD_TOO_LARGE';
  if (status === 502 || status === 503 || status === 504) return 'CLIENT_NETWORK_ERROR';
  return `CLIENT_HTTP_${status}`;
}

/**
 * 解析非 2xx 传输响应的错误体文本 ⇒ ApiError（下载与上传共用 · 动作名仅影响兜底文案）。
 *   - 标准服务端错误体 {code,message,trace_id} ⇒ 原样采用；
 *   - 非 JSON / 空体 ⇒ fallbackCodeByStatus 兜底（与 request.ts 的 CLIENT_ 前缀纪律对齐）。
 */
function classifyTransferErrorBody(status: number, bodyText: string, actionLabel: string): ApiError {
  const trimmed = (bodyText || '').trim();
  if (trimmed !== '') {
    try {
      const parsed = JSON.parse(trimmed) as {
        code?: unknown;
        message?: unknown;
        trace_id?: unknown;
      };
      if (typeof parsed.code === 'string' && parsed.code !== '') {
        return makeDownloadApiError(
          status,
          parsed.code,
          typeof parsed.message === 'string' && parsed.message !== ''
            ? parsed.message
            : `${actionLabel}失败（${parsed.code}）`,
          typeof parsed.trace_id === 'string' ? parsed.trace_id : undefined,
        );
      }
    } catch {
      // 非 JSON · 落入 statusCode 兜底
    }
  }
  const code = fallbackCodeByStatus(status);
  return makeDownloadApiError(status, code, `${actionLabel}失败（${code.startsWith('CLIENT_HTTP_') ? `HTTP ${status}` : code}）`);
}

export function classifyDownloadErrorBody(status: number, bodyText: string): ApiError {
  return classifyTransferErrorBody(status, bodyText, '下载');
}

/**
 * 解析上传错误体（wx.uploadFile 任何状态都把响应体放 res.data 字符串里 · 含 413 等）。
 * 与下载同一分类纪律：服务端 code 原样采用，非 JSON 兜底 CLIENT_HTTP_{status}。
 */
export function classifyUploadErrorBody(status: number, bodyText: string): ApiError {
  return classifyTransferErrorBody(status, bodyText, '上传');
}

// ==============================================================================
// 下载实现
// ==============================================================================

export interface DownloadWithAuthOptions {
  /** 相对路径（如 /data-jobs/{id}/download?part=1 · 自动拼 env.apiBaseUrl） */
  path: string;
  /** 下载进度回调（0..100） */
  onProgress?: (percent: number) => void;
  /** 内部标记：401 已重放过（防二次续签） */
  _retried?: boolean;
}

export interface DownloadedFile {
  tempFilePath: string;
}

/** 发起前确保 token 新鲜（临期续签 · 复用 auth.ts Token.shouldRefresh 判据） */
async function ensureFreshToken(): Promise<string> {
  let token = getToken();
  if (!token) {
    throw makeDownloadApiError(401, 'UNAUTHENTICATED', '登录状态缺失，请重新登录');
  }
  if (token.shouldRefresh()) {
    await refreshToken();
    token = getToken();
    if (!token) {
      throw makeDownloadApiError(401, 'UNAUTHENTICATED', '登录状态缺失，请重新登录');
    }
  }
  return token.raw.access_token;
}

function readTempFileAsText(filePath: string): Promise<string> {
  return new Promise((resolve, reject) => {
    wx.getFileSystemManager().readFile({
      filePath,
      encoding: 'utf8',
      success: (res) => resolve(String(res.data ?? '')),
      fail: (err) => reject(err),
    });
  });
}

function wxDownload(url: string, accessToken: string, onProgress?: (percent: number) => void): Promise<WechatMiniprogram.DownloadFileSuccessCallbackResult> {
  return new Promise((resolve, reject) => {
    const task = wx.downloadFile({
      url,
      header: { Authorization: `Bearer ${accessToken}` },
      success: (res) => resolve(res),
      fail: (err) => reject(err),
    });
    if (onProgress) {
      task.onProgressUpdate((res) => {
        if (typeof res.progress === 'number') onProgress(res.progress);
      });
    }
  });
}

/**
 * 带鉴权下载（刷 token → 下载 → 401 重放一次 → 错误分类）。
 * 成功 ⇒ { tempFilePath }；失败 ⇒ reject ApiError（code 为服务端 code 或 CLIENT_* 形式）。
 */
export async function downloadWithAuth(opts: DownloadWithAuthOptions): Promise<DownloadedFile> {
  const accessToken = await ensureFreshToken();
  const url = `${getEnv().apiBaseUrl}${opts.path}`;

  let res: WechatMiniprogram.DownloadFileSuccessCallbackResult;
  try {
    res = await wxDownload(url, accessToken, opts.onProgress);
  } catch (err) {
    logger.warn(MODULE, 'download network fail', err);
    throw makeDownloadApiError(0, 'CLIENT_NETWORK_ERROR', '网络异常，请稍后重试');
  }

  if (res.statusCode === 200) {
    return { tempFilePath: res.tempFilePath };
  }

  // 401 ⇒ 续签一次并重放一次（与 request.ts 的 retried 语义对齐）
  if (res.statusCode === 401 && !opts._retried) {
    try {
      await refreshToken();
    } catch (refreshErr) {
      throw makeDownloadApiError(401, 'TOKEN_EXPIRED', '登录已过期，请重新登录');
    }
    return downloadWithAuth({ ...opts, _retried: true });
  }

  // 非 200：错误体在下载产物里，读出文本再分类
  let bodyText = '';
  try {
    bodyText = await readTempFileAsText(res.tempFilePath);
  } catch (readErr) {
    logger.warn(MODULE, `read error body fail · status=${res.statusCode}`, readErr);
  }
  throw classifyDownloadErrorBody(res.statusCode, bodyText);
}

/**
 * 强校验下载产物 sha256（导出契约：files[].sha256 / X-Content-Sha256 头）。
 * 不一致 ⇒ reject ApiError（CLIENT_CHECKSUM_MISMATCH · 文件损坏，引导重新下载）。
 */
export async function verifyFileSha256(filePath: string, expectedSha256: string): Promise<void> {
  const digest = await new Promise<string>((resolve, reject) => {
    wx.getFileSystemManager().getFileInfo({
      filePath,
      digestAlgorithm: 'sha256',
      success: (res: WechatMiniprogram.GetFileInfoSuccessCallbackResult) =>
        resolve((res.digest ?? '').toLowerCase()),
      fail: (err: WechatMiniprogram.GeneralCallbackResult) => reject(err),
    });
  });
  if (digest !== expectedSha256.toLowerCase()) {
    throw makeDownloadApiError(
      0,
      'CLIENT_CHECKSUM_MISMATCH',
      '文件校验失败，请重新下载',
    );
  }
}

// ==============================================================================
// 上传实现（导入 detect · 方案 v1.0 §8.3 步骤 2）
// ==============================================================================

export interface UploadWithAuthOptions {
  /** 相对路径（如 /import-jobs/detect · 自动拼 env.apiBaseUrl） */
  path: string;
  /** 本地文件路径（wx.chooseMessageFile 的 tempFilePath） */
  filePath: string;
  /** multipart 附加字段（如 ledger_id · 在 file 字段之前发出） */
  formData?: Record<string, string>;
  /** multipart 文件字段名（服务端 req.file() 取第一个文件字段 · 默认 'file'） */
  fileFieldName?: string;
  /** 内部标记：401 已重放过（防二次续签） */
  _retried?: boolean;
}

export interface UploadWithAuthResult {
  statusCode: number;
  /** 响应体原文（JSON 文本 · 调用方自行 JSON.parse） */
  body: string;
}

function wxUpload(
  url: string,
  accessToken: string,
  opts: UploadWithAuthOptions,
): Promise<WechatMiniprogram.UploadFileSuccessCallbackResult> {
  return new Promise((resolve, reject) => {
    wx.uploadFile({
      url,
      filePath: opts.filePath,
      name: opts.fileFieldName ?? 'file',
      formData: opts.formData,
      header: { Authorization: `Bearer ${accessToken}` },
      success: (res) => resolve(res),
      fail: (err) => reject(err),
    });
  });
}

/**
 * 带鉴权上传（刷 token → 上传 → 401 重放一次 → 错误分类 · 与下载同一闭环）。
 * 成功（2xx）⇒ { statusCode, body }；失败 ⇒ reject ApiError（服务端 code 原样 / CLIENT_* 兜底）。
 */
export async function uploadWithAuth(opts: UploadWithAuthOptions): Promise<UploadWithAuthResult> {
  const accessToken = await ensureFreshToken();
  const url = `${getEnv().apiBaseUrl}${opts.path}`;

  let res: WechatMiniprogram.UploadFileSuccessCallbackResult;
  try {
    res = await wxUpload(url, accessToken, opts);
  } catch (err) {
    logger.warn(MODULE, 'upload network fail', err);
    throw makeDownloadApiError(0, 'CLIENT_NETWORK_ERROR', '网络异常，请稍后重试');
  }

  if (res.statusCode >= 200 && res.statusCode < 300) {
    return { statusCode: res.statusCode, body: typeof res.data === 'string' ? res.data : '' };
  }

  // 401 ⇒ 续签一次并重放一次（与下载/request.ts 的 retried 语义对齐）
  if (res.statusCode === 401 && !opts._retried) {
    try {
      await refreshToken();
    } catch (refreshErr) {
      throw makeDownloadApiError(401, 'TOKEN_EXPIRED', '登录已过期，请重新登录');
    }
    return uploadWithAuth({ ...opts, _retried: true });
  }

  throw classifyUploadErrorBody(res.statusCode, typeof res.data === 'string' ? res.data : '');
}

// ==============================================================================
// 微信聊天分享（wx.shareFileMessage · 完成卡唯一出口动作）
// ==============================================================================
//
// 真机两条硬约束（2026-09-08 实机复现 · 开发者工具均不校验）：
//   1. 后缀：downloadFile 临时路径无文件后缀，真机按路径后缀判定文件类型，无后缀
//      直接 fail ⇒ 须先复制到 USER_DATA_PATH 带 .csv 后缀的草稿文件；
//   2. 手势门控：shareFileMessage 只允许在用户 tap 手势的同步调用栈内发起
//      （fail: can only be invoked by user TAP gesture），任何前置 await
//      （下载/校验/复制）都会脱离手势栈 ⇒ 异步工作必须全部前置到准备阶段
//      （prepareCsvShareDraft），tap 处理器内只调 sharePreparedCsv 且禁止前置 await。

/** 导出分片草稿名（按 jobId+part 隔离 · 多分片/多任务互不覆盖） */
export function exportShareDraftName(jobId: string, part: number): string {
  return `costra-share-export-${jobId}-${part}.csv`;
}

/** 导入检测报告草稿名（按 detectId 隔离） */
export function reportShareDraftName(detectId: string): string {
  return `costra-share-report-${detectId}.csv`;
}

/** 导入示例草稿名（固定 · 多次准备覆盖复用防堆积 · §4.6） */
export function demoShareDraftName(): string {
  return 'costra-share-import-demo.csv';
}

/**
 * 复制下载产物为带 .csv 后缀的分享草稿（覆盖复用防堆积 · 展示名仍用服务端原始文件名）。
 * 异步操作，须在 tap 手势前的准备阶段完成；返回草稿路径（喂 sharePreparedCsv）。
 */
export async function prepareCsvShareDraft(filePath: string, draftName: string): Promise<string> {
  const sharePath = `${wx.env.USER_DATA_PATH}/${draftName}`;
  removeCsvShareDraft(sharePath);
  await new Promise<void>((resolve, reject) => {
    wx.getFileSystemManager().copyFile({
      srcPath: filePath,
      destPath: sharePath,
      success: () => resolve(),
      fail: (err) => {
        logger.warn(MODULE, 'share copyFile fail', err);
        reject(err);
      },
    });
  });
  return sharePath;
}

/**
 * 发送已就绪草稿到微信聊天（微信原生分享面板）。
 * 函数体无前置 await（Promise executor 同步执行）⇒ 可在 tap 手势同步栈内安全调用；
 * 调用方同样禁止在其前加 await。用户取消分享时微信走 fail（errMsg 含 cancel）⇒ 返回 false 而不抛错。
 */
export function sharePreparedCsv(sharePath: string, fileName: string): Promise<boolean> {
  return new Promise((resolve, reject) => {
    wx.shareFileMessage({
      filePath: sharePath,
      fileName,
      success: () => resolve(true),
      fail: (err) => {
        if (typeof err?.errMsg === 'string' && err.errMsg.includes('cancel')) {
          resolve(false);
          return;
        }
        logger.warn(MODULE, 'shareFileMessage fail', err);
        reject(err);
      },
    });
  });
}

/** 清理分享草稿（任务过期/消失 · 导入卡重置 · 页面卸载时调用 · 幂等） */
export function removeCsvShareDraft(sharePath: string): void {
  try {
    wx.getFileSystemManager().unlinkSync(sharePath);
  } catch {
    /* 草稿尚不存在 */
  }
}
