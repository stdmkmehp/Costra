// utils/time.ts · 时间工具（UTC 存储 / 用户时区展示）
// 卡号: COSTRA-030 · ADR-0004 §10

/** 返回 RFC3339/ISO 字符串（UTC） */
export function nowIsoUtc(): string {
  return new Date().toISOString();
}

/** 将本地 Date 转为 UTC ISO */
export function toUtcIso(d: Date): string {
  return new Date(d.getTime() - d.getTimezoneOffset() * 60_000).toISOString();
}

/** 解析 ISO 并按用户本地时区格式化为 'YYYY-MM-DD HH:mm' */
export function fmtLocal(iso: string): string {
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
