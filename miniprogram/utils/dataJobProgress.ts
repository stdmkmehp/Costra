// utils/dataJobProgress.ts · 数据任务（导出）阶段型模拟进度与派生态
//
// 事实源：docs/design/data-import-export-client-analysis.md v1.0 §6.4/§14.2
//
// 为什么是纯函数模块：页面代码无单测载体（同 utils/virtualPay.ts 的既有理由），
// 进度计算与"过期派生态"是协议级判据，必须可直测。
//
// 关键约定：
//   - 时间基准一律用服务端 server_now（客户端时钟不可信）；
//     页面在两次轮询之间用本地 tick 增量推进（见页面 _renderTick）。
//   - 模拟进度永不显示 100%：真实完成只来自服务端 status=succeeded
//     （避免"卡在 99%" 与"假完成"两种误导）。
//   - 导出阶段固定 querying → packaging（无 validating/writing，那是导入的）。

/**
 * 各阶段的模拟进度区间与时间常数（§14.2 + §7.2 v1.0）：
 *   导出：queued 恒 0 · querying 20→90（τ=8s）· packaging 90→98
 *   导入：validating 5→90（τ=8s · 唯一可观测阶段——单大事务内写入对轮询连接不可见，
 *         'writing' 已从导入阶段集移除）
 *   queued 恒 0% 是 §7.2 v1.0 明文（阶段轮替快，非零区间只会闪烁；
 *   未来观测到排队常态化再按 v0.8 注记补 τ · 0%→5%）。
 */
const STAGE_PLAN: Readonly<Record<string, { from: number; to: number; tauMs: number }>> = {
  queued: { from: 0, to: 0, tauMs: 1 },
  validating: { from: 5, to: 90, tauMs: 8_000 },
  querying: { from: 20, to: 90, tauMs: 8_000 },
  packaging: { from: 90, to: 98, tauMs: 3_000 },
};

/**
 * 阶段型模拟进度（0..98 · 单调趋近不上探 100）。
 * @param stage      服务端真实 stage（queued 任务 stage 为 null ⇒ 按 queued 段算）
 * @param elapsedMs  当前阶段已耗时（= serverNow - stageStartedAt + 轮询间本地 tick 增量）
 */
export function calcSimulatedProgress(
  stage: 'queued' | 'processing' | 'validating' | 'writing' | 'querying' | 'packaging' | null,
  elapsedMs: number,
): number {
  const plan = STAGE_PLAN[stage ?? 'queued'] ?? STAGE_PLAN['queued'];
  const t = Math.max(0, elapsedMs);
  const ratio = 1 - Math.exp(-t / plan.tauMs);
  return Math.round(plan.from + (plan.to - plan.from) * ratio);
}

/**
 * 产物是否已过 24h 有效期（过期判据的唯一出口 · 时间基准 server_now）。
 * fileExpiresAt 为 null（非终态任务）⇒ 不过期。
 */
export function isExportFileExpired(fileExpiresAt: string | null, serverNowMs: number): boolean {
  if (!fileExpiresAt) return false;
  const expiresMs = Date.parse(fileExpiresAt);
  if (Number.isNaN(expiresMs)) return false;
  return expiresMs <= serverNowMs;
}

/**
 * 完成卡"有效期至 HH:mm"文案的剩余时长（如 "23小时58分"）。
 * 已过期 ⇒ null（调用方改走过期分支）。
 */
export function formatExpiresCountdown(fileExpiresAt: string | null, serverNowMs: number): string | null {
  if (!fileExpiresAt) return null;
  const remainMs = Date.parse(fileExpiresAt) - serverNowMs;
  if (Number.isNaN(remainMs) || remainMs <= 0) return null;
  const totalMinutes = Math.floor(remainMs / 60_000);
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  if (hours > 0) return `${hours}小时${minutes > 0 ? `${minutes}分` : ''}`;
  return `${Math.max(1, minutes)}分钟`;
}

/** 产物大小展示（"12.4 MB" / "356 KB"） */
export function formatFileSize(bytes: number): string {
  if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  if (bytes >= 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${bytes} B`;
}

/** 任务卡阶段展示名（导出固定两段 · 导入 validating 单阶段 · §7.2 v1.0 文案） */
export function stageDisplayName(stage: string | null): string {
  switch (stage) {
    case 'querying':
      return '正在整理数据';
    case 'packaging':
      // v1.0 语义收窄：不写「正在打包文件」，避免用户以为主要工作在这一步
      return '正在收尾';
    case 'validating':
      return '正在导入流水';
    case 'writing':
      return '正在写入数据';
    default:
      return '等待处理';
  }
}
