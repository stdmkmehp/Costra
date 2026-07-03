// utils/shanghaiDate.ts · Asia/Shanghai 日期归属工具

const SHANGHAI_OFFSET_MS = 8 * 60 * 60 * 1000;

function toShanghaiDate(isoStr: string): Date {
  return new Date(new Date(isoStr).getTime() + SHANGHAI_OFFSET_MS);
}

export function shanghaiDateKeyFromIso(isoStr: string): string {
  return toShanghaiDate(isoStr).toISOString().slice(0, 10);
}

export function shanghaiMonthValueFromIso(isoStr: string): string {
  return toShanghaiDate(isoStr).toISOString().slice(0, 7);
}

export function parseShanghaiMonthRange(month: string): { rangeStartUtc: string; rangeEndUtc: string } {
  const [yearStr, monthStr] = month.split('-');
  const year = Number(yearStr);
  const mon = Number(monthStr);
  const startShanghai = new Date(Date.UTC(year, mon - 1, 1, 0, 0, 0));
  const startUtc = new Date(startShanghai.getTime() - SHANGHAI_OFFSET_MS);
  const endShanghai = new Date(Date.UTC(year, mon, 1, 0, 0, 0));
  const endUtc = new Date(endShanghai.getTime() - SHANGHAI_OFFSET_MS);
  return {
    rangeStartUtc: startUtc.toISOString(),
    rangeEndUtc: endUtc.toISOString(),
  };
}
