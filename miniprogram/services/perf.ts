// services/perf.ts · 启动/切页轻量性能日志
// 仅在开发版/体验版或显式调试开关下输出，避免生产噪音。

type PerfValue = string | number | boolean | null | undefined;
export type PerfPayload = Record<string, PerfValue>;

interface PerfRecord {
  name: string;
  at: number;
  elapsed: number;
  data?: PerfPayload;
}

const MAX_RECORDS = 160;
const STARTUP_WINDOW_MS = 5000;

let launchAt = Date.now();
let enabledCache: boolean | null = null;
let records: PerfRecord[] = [];
let startupNetworkCount = 0;
let context: PerfPayload = {};

function now(): number {
  return Date.now();
}

function isMiniProgramPerfEnabled(): boolean {
  if (enabledCache != null) return enabledCache;
  if (typeof wx === 'undefined') {
    enabledCache = false;
    return enabledCache;
  }
  try {
    const accountInfo = wx.getAccountInfoSync?.();
    const envVersion = accountInfo?.miniProgram?.envVersion;
    enabledCache = envVersion === 'develop' || envVersion === 'trial';
  } catch {
    enabledCache = false;
  }
  return enabledCache;
}

export function isPerfEnabled(): boolean {
  return isMiniProgramPerfEnabled();
}

export function resetPerfSession(startAt: number = now()): void {
  launchAt = startAt;
  records = [];
  startupNetworkCount = 0;
  context = {};
  markPerf('app.launch.start', { at: startAt });
}

export function setPerfContext(next: PerfPayload): void {
  context = { ...context, ...next };
  if (isPerfEnabled()) {
    console.info('[perf] context', context);
  }
}

export function markPerf(name: string, data?: PerfPayload): void {
  const at = now();
  const elapsed = at - launchAt;
  const record: PerfRecord = { name, at, elapsed, data };
  records.push(record);
  if (records.length > MAX_RECORDS) records.shift();

  if (!isPerfEnabled()) return;
  const suffix = data ? ` ${JSON.stringify(data)}` : '';
  console.info(`[perf] ${name} +${elapsed}ms${suffix}`);
}

export function markPerfError(name: string, err: unknown, data?: PerfPayload): void {
  const message = err instanceof Error ? err.message : String(err);
  markPerf(name, { ...(data || {}), error: message });
}

export function recordNetworkRequest(info: {
  method: string;
  path: string;
  status?: number;
  ok: boolean;
  elapsed: number;
}): void {
  const inStartupWindow = now() - launchAt <= STARTUP_WINDOW_MS;
  if (inStartupWindow) startupNetworkCount += 1;
  markPerf('network.request.done', {
    method: info.method,
    path: info.path,
    status: info.status,
    ok: info.ok,
    elapsed: info.elapsed,
    startupNetworkCount: inStartupWindow ? startupNetworkCount : undefined,
  });
}

export function captureNetworkType(): void {
  if (!isPerfEnabled()) return;
  if (typeof wx === 'undefined' || !wx.getNetworkType) return;
  try {
    wx.getNetworkType({
      success(res) {
        const networkType = res.networkType || 'unknown';
        setPerfContext({ network: networkType });
        markPerf('network.type', { network: networkType });
      },
      fail() {
        setPerfContext({ network: 'unknown' });
      },
    });
  } catch {
    setPerfContext({ network: 'unknown' });
  }
}

export function getPerfSnapshot(): { context: PerfPayload; records: PerfRecord[]; startupNetworkCount: number } {
  return {
    context: { ...context },
    records: records.slice(),
    startupNetworkCount,
  };
}
