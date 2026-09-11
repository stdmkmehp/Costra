// services/fileTransfer.spec.ts · 下载错误分类纯函数单测
// 事实源：docs/design/data-import-export-client-analysis.md v1.0 §9.5/§14.2
//
// 覆盖（classifyDownloadErrorBody · wx.downloadFile 非 200 时错误体在产物文件里）：
//   - 标准服务端错误体 {code,message,trace_id} ⇒ 原样采用（410 EXPORT_FILE_EXPIRED 等）
//   - 缺 code / 非 JSON / 空体 ⇒ CLIENT_HTTP_{status} 兜底
//   - makeDownloadApiError 形态（code/status/traceId）

import { describe, it, expect } from 'vitest';
import { classifyDownloadErrorBody, classifyUploadErrorBody, makeDownloadApiError } from './fileTransfer';

// wx 全局在 vitest 环境不存在；本文件只测不触达 wx 的纯函数出口
describe('classifyDownloadErrorBody', () => {
  it('410 EXPORT_FILE_EXPIRED 标准错误体 ⇒ 原样采用', () => {
    const err = classifyDownloadErrorBody(
      410,
      JSON.stringify({ code: 'EXPORT_FILE_EXPIRED', message: 'export file has expired', trace_id: 't-1' }),
    );
    expect(err.code).toBe('EXPORT_FILE_EXPIRED');
    expect(err.status).toBe(410);
    expect(err.message).toBe('export file has expired');
    expect(err.traceId).toBe('t-1');
  });

  it('404 NOT_FOUND 标准错误体 ⇒ 原样采用', () => {
    const err = classifyDownloadErrorBody(404, JSON.stringify({ code: 'NOT_FOUND', message: 'data job not found' }));
    expect(err.code).toBe('NOT_FOUND');
    expect(err.status).toBe(404);
  });

  it('409 EXPORT_JOB_IN_PROGRESS ⇒ 原样采用', () => {
    const err = classifyDownloadErrorBody(409, JSON.stringify({ code: 'EXPORT_JOB_IN_PROGRESS', message: 'an export job is already in progress' }));
    expect(err.code).toBe('EXPORT_JOB_IN_PROGRESS');
  });

  it('错误体无 message ⇒ 用 code 兜底文案', () => {
    const err = classifyDownloadErrorBody(410, JSON.stringify({ code: 'EXPORT_FILE_EXPIRED' }));
    expect(err.code).toBe('EXPORT_FILE_EXPIRED');
    expect(err.message).toContain('EXPORT_FILE_EXPIRED');
  });

  it('非 JSON 错误体按 statusCode 兜底（§9.5 P2 配套）：502 网关页 ⇒ CLIENT_NETWORK_ERROR', () => {
    const err = classifyDownloadErrorBody(502, '<html>bad gateway</html>');
    expect(err.code).toBe('CLIENT_NETWORK_ERROR');
    expect(err.status).toBe(502);
  });

  it('非 JSON 错误体：413 nginx HTML ⇒ PAYLOAD_TOO_LARGE（用户看到「文件过大」而非「网络异常」）', () => {
    expect(classifyDownloadErrorBody(413, '<html>413 Request Entity Too Large</html>').code).toBe('PAYLOAD_TOO_LARGE');
    expect(classifyUploadErrorBody(413, '<html></html>').code).toBe('PAYLOAD_TOO_LARGE');
  });

  it('空错误体 / 无专门映射的状态 ⇒ CLIENT_HTTP_{status}', () => {
    expect(classifyDownloadErrorBody(500, '').code).toBe('CLIENT_HTTP_500');
    expect(classifyDownloadErrorBody(500, '   ').code).toBe('CLIENT_HTTP_500');
    expect(classifyDownloadErrorBody(504, '<html></html>').code).toBe('CLIENT_NETWORK_ERROR');
  });

  it('JSON 但缺 code ⇒ CLIENT_HTTP_{status}', () => {
    const err = classifyDownloadErrorBody(400, JSON.stringify({ error: 'bad' }));
    expect(err.code).toBe('CLIENT_HTTP_400');
  });

  it('COS XML 错误体（两步下载换新 URL 重试后仍 403）⇒ CLIENT_HTTP_403 兜底', () => {
    // §5.3.4 决策：COS XML 不进通用 JSON 解析，403 重试穷尽后走 statusCode 兜底
    const xml = '<?xml version="1.0" encoding="UTF-8"?><Error><Code>AccessDenied</Code><Message>Request has expired</Message></Error>';
    const err = classifyDownloadErrorBody(403, xml);
    expect(err.code).toBe('CLIENT_HTTP_403');
    expect(err.status).toBe(403);
  });
});

describe('makeDownloadApiError', () => {
  it('code/status/message/traceId 形态', () => {
    const err = makeDownloadApiError(401, 'TOKEN_EXPIRED', '登录已过期', 't-9');
    expect(err).toBeInstanceOf(Error);
    expect(err.code).toBe('TOKEN_EXPIRED');
    expect(err.status).toBe(401);
    expect(err.message).toBe('登录已过期');
    expect(err.traceId).toBe('t-9');
  });

  it('无 traceId 时字段缺省', () => {
    const err = makeDownloadApiError(0, 'CLIENT_NETWORK_ERROR', '网络异常');
    expect(err.traceId).toBeUndefined();
  });
});

// wx.uploadFile 的错误体在 res.data 字符串里（含 413/409 等 · 与下载同一分类纪律）
describe('classifyUploadErrorBody（导入 detect 上传）', () => {
  it('413 PAYLOAD_TOO_LARGE 标准错误体 ⇒ 原样采用', () => {
    const err = classifyUploadErrorBody(
      413,
      JSON.stringify({ code: 'PAYLOAD_TOO_LARGE', message: 'file exceeds 1MB limit', trace_id: 't-2' }),
    );
    expect(err.code).toBe('PAYLOAD_TOO_LARGE');
    expect(err.status).toBe(413);
    expect(err.message).toBe('file exceeds 1MB limit');
    expect(err.traceId).toBe('t-2');
  });

  it('409 DETECT_IN_PROGRESS / IMPORT_JOB_IN_PROGRESS ⇒ 原样采用', () => {
    expect(classifyUploadErrorBody(409, JSON.stringify({ code: 'DETECT_IN_PROGRESS', message: 'x' })).code).toBe('DETECT_IN_PROGRESS');
    expect(classifyUploadErrorBody(409, JSON.stringify({ code: 'IMPORT_JOB_IN_PROGRESS', message: 'x' })).code).toBe('IMPORT_JOB_IN_PROGRESS');
  });

  it('非 JSON / 空体 ⇒ statusCode 兜底（502→CLIENT_NETWORK_ERROR · 500→CLIENT_HTTP_500）', () => {
    expect(classifyUploadErrorBody(502, '<html></html>').code).toBe('CLIENT_NETWORK_ERROR');
    expect(classifyUploadErrorBody(500, '').code).toBe('CLIENT_HTTP_500');
  });
});
