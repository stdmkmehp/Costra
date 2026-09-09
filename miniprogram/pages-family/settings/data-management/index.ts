// pages-family/settings/data-management/index · 账本导入 / 导出（导入 + 导出 · 二期）
//
// 事实源：docs/design/data-import-export-client-analysis.md v1.0 §4/§6/§8.3/§14.2
//
// 页面职责：
//   - 导入卡（§8.3 状态机）：选择账本（>1 个账本时 · 默认当前活跃）→ 选择 CSV
//     （wx.chooseMessageFile）→ 本地校验（类型/1MB · 失败就地展示不 Toast）→ 确认卡 →
//     detect（上传期间防误返回 R4）→ 就地结果区（统计/问题预览/成员映射/下载报告）→ commit → 任务卡
//   - 导出表单：选择账本（同上）→ 时间范围（全部/今年/本月/自定义）→ POST /export-jobs
//   - 任务中心：轮询 GET /data-jobs（2s 起步，30s 后降频 5s）+ 阶段型模拟进度（server_now 基准）
//     · 导出完成卡：文件信息 + 24h 倒计时 + 逐分片「发送到微信」（多分片给第 N/M 提示 · §6.3）；
//       分享草稿预下载（shareFileMessage 手势门控 · 下载/校验/复制全部前置 · 见 fileTransfer 头注）
//     · 导入完成卡：导入 N 条 / 跳过 M 条（succeeded 后触发一次 triggerOnMutation 同步刷新）
//     · 页面可见期间任务进入终态 ⇒ 轻震反馈（§8.5）
//   - 派生态：过期（file_expires_at < server_now ⇒ 重新生成）/ 失败（按 error_code 渲染 · §9.5；
//     导出⇒重试按原账本原区间；导入⇒引导重新上传）
//   - 已读标记：succeeded 任务展示即写入 dataJobs:seenCompleted（设置页小绿点的真相源）
//
// 客户端是"检测结果的呈现器"：行级问题按 code 本地化（describeImportIssue），
// 服务端只给机读 code + value_preview（§4.2）。

import { getActiveFamilyId, getActiveLedgerId, getActiveLedgerName } from '../../../services/family';
import { getFamilies, getFamilyMembers } from '../../../services/familyApi';
import {
  createExportJob,
  listDataJobs,
  markDataJobSeen,
  getSeenCompletedJobIds,
  type DataJob,
  type DataJobFile,
} from '../../../services/dataJobApi';
import {
  detectImportFile,
  commitImportJob,
  describeImportIssue,
  demoCsvPath,
  DEMO_CSV_FILENAME,
  type DetectReport,
} from '../../../services/importApi';
import {
  downloadWithAuth,
  verifyFileSha256,
  exportShareDraftName,
  reportShareDraftName,
  demoShareDraftName,
  prepareCsvShareDraft,
  sharePreparedCsv,
  removeCsvShareDraft,
} from '../../../services/fileTransfer';
import { triggerOnMutation } from '../../../services/syncScheduler';
import type { ApiError } from '../../../services/request';
import {
  calcSimulatedProgress,
  isExportFileExpired,
  formatExpiresCountdown,
  formatFileSize,
  stageDisplayName,
} from '../../../utils/dataJobProgress';
import { shanghaiDateKeyFromIso } from '../../../utils/shanghaiDate';
import { fmtLocal } from '../../../utils/time';
import { mapError, describeDataJobError } from '../../../utils/error-mapper';
import { logger } from '../../../utils/logger';

const MODULE = 'dataMgmt';
const POLL_FAST_MS = 2_000;
const POLL_SLOW_MS = 5_000;
const POLL_FAST_WINDOW_MS = 30_000;
/** 「开始导出」创建成功后的按钮冷却（防连点 · 服务端 EXPORT_JOB_IN_PROGRESS 闸口之外的体验层） */
const CREATE_COOLDOWN_MS = 3_000;
/** 「下载示例文件」分享发起后的按钮冷却（防连点反复拉起分享面板 · §4.6） */
const DEMO_COOLDOWN_MS = 3_000;

/** 客户端本地大小上限（§9.1 三层阈值第一层 · 服务端二次校验兜底） */
const IMPORT_MAX_FILE_BYTES = 1024 * 1024;

type RangeMode = 'all' | 'year' | 'month' | 'custom';
type ImportState = 'idle' | 'confirm' | 'detecting' | 'report';

/** 账本选项（导入/导出共用 · 一家庭一账本 · §8.3/§8.4 步骤 2 选择目标账本） */
interface LedgerOption {
  ledgerId: string;
  familyId: string;
  name: string;
  familyKind: 'personal' | 'shared';
}

interface FileCard {
  part: number;
  filename: string;
  /** 文件名头段（溢出省略 · 与 nameTail 拼出中间省略显示） */
  nameHead: string;
  /** 文件名尾段（固定显示 · 时间戳或分片段 + .csv） */
  nameTail: string;
  sizeText: string;
  downloadPath: string;
  sha256: string;
  /** 分享草稿准备中（下载 + sha256 校验 + 复制 · 手势门控要求全部前置） */
  preparing: boolean;
  preparePercent: number;
}

interface JobCard {
  id: string;
  type: DataJob['type'];
  status: DataJob['status'];
  statusText: string;
  stageName: string;
  progress: number;
  /** 导出：N 条流水；导入：N 条入库（null = 未知） */
  entryCount: number | null;
  /** 导入跳过条数（>0 才展示） */
  skippedCount: number | null;
  rangeLabel: string;
  /** 任务所属账本名（多账本时展示归属 · 单账本冗余不渲染 · §7.6/§8.2） */
  ledgerName: string;
  createdLabel: string;
  isExpired: boolean;
  countdownText: string | null;
  files: FileCard[];
  /** 「重新生成 / 重试」按原账本 + 原区间重发（result_summary.source_date_* · 不反解半开区间端点） */
  sourceFrom: string | null;
  sourceTo: string | null;
  ledgerId: string | null;
  errorCode: string | null;
  /** 失败原因（按 error_code 渲染 · §9.5 · 禁渲染 error_message） */
  errorText: string | null;
  /** 新出现任务的入场动画标记（仅节点创建当帧为 true · 下一拍摘除） */
  isNew: boolean;
}

/** 成员映射行（仅自产文件存在未匹配昵称时渲染 · §8.3 步骤 5） */
interface MappingRow {
  nickname: string;
  rowCount: number;
  /** '__self__' | user_id | ''（未选择） */
  target: string;
  targetLabel: string;
}

interface IssueRow {
  key: string;
  text: string;
  level: 'error' | 'warning';
}

Page({
  data: {
    ledgerName: '',
    // ─── 账本选择（>1 个账本时显示选择器 · §8.3/§8.4 步骤 2 · 默认当前活跃账本） ───
    showLedgerPicker: false,
    importLedgerName: '',
    exportLedgerName: '',
    exportSharedHint: false,
    // ─── 导出表单 ───
    rangeMode: 'all' as RangeMode,
    rangeLabel: '全部流水',
    customFrom: '',
    customTo: '',
    today: '',
    creating: false,
    /** 「开始导出」冷却剩余秒数（0 = 可点击 · CREATE_COOLDOWN_MS 防连点） */
    createCooldown: 0,
    // ─── 导入卡（§8.3 状态机） ───
    importState: 'idle' as ImportState,
    fileError: '',
    importFileName: '',
    importFileSizeText: '',
    reportSummaryText: '',
    issuesPreview: [] as IssueRow[],
    issuesOverflowText: '',
    showReportDownload: false,
    mappingRows: [] as MappingRow[],
    mappingTooMany: false,
    commitEnabled: false,
    commitLabel: '确认导入',
    /** 本次将导入条数（importableRows + 已映射行数 · 二次确认弹窗与按钮共用 · §4.6） */
    commitCount: 0,
    committing: false,
    hasActiveImport: false,
    /** 检测报告分享草稿准备中（「下载问题报告」按钮态） */
    reportPreparing: false,
    /** 示例文件分享草稿准备中（「下载示例文件」按钮态 · §4.6） */
    demoPreparing: false,
    /** 「下载示例文件」冷却剩余秒数（0 = 可点击 · DEMO_COOLDOWN_MS 防连点） */
    demoCooldown: 0,
    // ─── 任务中心 ───
    loading: true,
    jobs: [] as JobCard[],
  },

  _pollTimer: null as ReturnType<typeof setInterval> | null,
  _renderTimer: null as ReturnType<typeof setInterval> | null,
  _pollStartedAt: 0,
  _serverNowMs: 0,
  _serverNowAt: 0,
  _rawJobs: [] as DataJob[],
  /** 新出现任务的 id 集合（_renderTick 消费当帧即清 · 首载豁免见 _refreshJobs） */
  _newJobIds: new Set<string>(),
  /** 是否已成功拉取过任务列表（首载整列不算"新增"，避免打开页面时全部齐播入场动画） */
  _jobsLoadedOnce: false,
  /** 「开始导出」冷却截止时间戳（0 = 无冷却） */
  _createCooldownEnd: 0,
  /** 「下载示例文件」冷却截止时间戳（0 = 无冷却） */
  _demoCooldownEnd: 0,
  // 账本选项与当前选择（导入/导出各自独立 · 默认当前活跃账本）
  _ledgerOptions: [] as LedgerOption[],
  _importLedgerId: '',
  _importLedgerFamilyId: '',
  _exportLedgerId: '',
  // 导入瞬态（不进视图层）：文件路径 / 检测报告原文 / 成员映射草稿 / 成员选项
  _importFilePath: '',
  _report: null as DetectReport | null,
  _mappingDraft: {} as Record<string, string>,
  _memberOptions: [] as Array<{ userId: string; nickname: string }>,
  // 分享草稿（不进视图层）：就绪表 key → {sharePath, filename}；准备中/已失败 key 集合。
  // key 规约：导出分片 = `${jobId}:{part}`；导入检测报告 = `report:{detectId}`；
  // 导入示例 = `demo:{ledgerId}`（按目标账本隔离 · 切账本重备 · §4.6）。
  _shareDrafts: new Map<string, { sharePath: string; filename: string }>(),
  _shareInflight: new Set<string>(),
  _shareFailed: new Set<string>(),
  /** 页面已销毁（onUnload 后异步准备完成须丢弃草稿，防 USER_DATA_PATH 孤儿文件） */
  _destroyed: false,

  onLoad(): void {
    const today = shanghaiDateKeyFromIso(new Date().toISOString());
    this.setData({ today });
    void this._loadLedgerOptions();
    void this._refreshJobs();
    this._startTimers();
  },

  onShow(): void {
    this._startTimers();
    void this._loadLedgerOptions();
    void this._refreshJobs();
  },

  onHide(): void {
    this._stopTimers();
  },

  onUnload(): void {
    this._stopTimers();
    this._disableLeaveAlert();
    this._destroyed = true;
    // 分享草稿统一回收（USER_DATA_PATH 是持久存储，页面销毁后不再消费）
    for (const [, draft] of this._shareDrafts) removeCsvShareDraft(draft.sharePath);
    this._shareDrafts.clear();
  },

  // ─── 初始化 ─────────────────────────────────────────────

  /**
   * 账本选项（§8.3/§8.4 步骤 2：>1 个账本时提供 action sheet 选择器 · 默认当前活跃账本）。
   * 已有选择仍存在则保留（onShow/轮询期间不重置用户选择）；失效则回落当前活跃账本。
   */
  async _loadLedgerOptions(): Promise<void> {
    try {
      const [resp, activeLedgerId] = await Promise.all([getFamilies(), getActiveLedgerId()]);
      const options: LedgerOption[] = resp.families.map((f) => ({
        ledgerId: f.ledger_id,
        familyId: f.id,
        name: f.ledger_name || f.name,
        familyKind: f.kind,
      }));
      if (options.length === 0) return;
      this._ledgerOptions = options;
      const active = options.find((o) => o.ledgerId === activeLedgerId) ?? options[0]!;
      const importPick = options.find((o) => o.ledgerId === this._importLedgerId) ?? active;
      const exportPick = options.find((o) => o.ledgerId === this._exportLedgerId) ?? active;
      this._importLedgerId = importPick.ledgerId;
      this._importLedgerFamilyId = importPick.familyId;
      this._exportLedgerId = exportPick.ledgerId;
      this.setData({
        showLedgerPicker: options.length > 1,
        importLedgerName: importPick.name,
        exportLedgerName: exportPick.name,
        exportSharedHint: exportPick.familyKind === 'shared',
        ledgerName: active.name,
      });
      // 示例文件草稿预下载（§4.6 · 手势门控要求异步准备前置；重复触发由草稿表去重）
      void this._prepareDemoDraft(importPick.ledgerId);
    } catch (err) {
      logger.warn(MODULE, 'load ledger options fail', err);
      void this._loadLedgerName();
    }
  },

  async _loadLedgerName(): Promise<void> {
    try {
      const name = await getActiveLedgerName();
      this.setData({ ledgerName: name ?? '当前账本' });
    } catch (err) {
      logger.warn(MODULE, 'load ledger name fail', err);
      this.setData({ ledgerName: '当前账本' });
    }
  },

  onPickImportLedger(): void {
    this._pickLedger('import');
  },

  onPickExportLedger(): void {
    this._pickLedger('export');
  },

  _pickLedger(kind: 'import' | 'export'): void {
    const options = this._ledgerOptions;
    if (options.length <= 1) return;
    wx.showActionSheet({
      itemList: options.map((o) => o.name),
      success: (res) => {
        const picked = options[res.tapIndex];
        if (!picked) return;
        if (kind === 'import') {
          // 示例文件按账本生成（成员/自定义分类不同）：清旧草稿 + 按新账本重备（§4.6）
          this._dropDemoDraft();
          this._importLedgerId = picked.ledgerId;
          this._importLedgerFamilyId = picked.familyId;
          this.setData({ importLedgerName: picked.name });
          void this._prepareDemoDraft(picked.ledgerId);
          // 闸口按目标账本判定，切账本后必须重算（否则沿用上一个账本的结论）
          this._renderTick();
        } else {
          this._exportLedgerId = picked.ledgerId;
          this.setData({
            exportLedgerName: picked.name,
            exportSharedHint: picked.familyKind === 'shared',
          });
        }
      },
      fail: () => {
        /* 取消选择无操作 */
      },
    });
  },

  // ─── 轮询与渲染节拍 ──────────────────────────────────────

  _startTimers(): void {
    if (!this._pollTimer) {
      this._pollStartedAt = Date.now();
      this._pollTimer = setInterval(() => {
        void this._refreshJobs();
        // 30s 后降频（§14.2：2s 起步，之后 5s）
        if (Date.now() - this._pollStartedAt > POLL_FAST_WINDOW_MS && this._pollTimer) {
          clearInterval(this._pollTimer);
          this._pollTimer = setInterval(() => void this._refreshJobs(), POLL_SLOW_MS);
        }
      }, POLL_FAST_MS);
    }
    if (!this._renderTimer) {
      this._renderTimer = setInterval(() => this._renderTick(), 1_000);
    }
  },

  _stopTimers(): void {
    if (this._pollTimer) {
      clearInterval(this._pollTimer);
      this._pollTimer = null;
    }
    if (this._renderTimer) {
      clearInterval(this._renderTimer);
      this._renderTimer = null;
    }
  },

  /** 服务端时间基准（server_now 锚点 + 本地增量） */
  _currentServerNowMs(): number {
    if (this._serverNowMs === 0) return Date.now();
    return this._serverNowMs + (Date.now() - this._serverNowAt);
  },

  async _refreshJobs(): Promise<void> {
    try {
      const { jobs, serverNow } = await listDataJobs();
      this._serverNowMs = Date.parse(serverNow);
      this._serverNowAt = Date.now();
      // 页面可见期间任务进入终态 ⇒ 轻震反馈（§8.5 · 首载无 prev 不震）
      const prevById = new Map(this._rawJobs.map((j) => [j.id, j.status]));
      const justSettled = jobs.some((j) => {
        const prev = prevById.get(j.id);
        return prev !== undefined && prev !== j.status && (j.status === 'succeeded' || j.status === 'failed');
      });
      if (justSettled) wx.vibrateShort({ type: 'light' });
      // 新出现任务标记入场动画（首载豁免：页面首次成功拉取时整列不算"新增"）
      if (this._jobsLoadedOnce) {
        for (const job of jobs) {
          if (!prevById.has(job.id)) this._newJobIds.add(job.id);
        }
      }
      this._jobsLoadedOnce = true;
      this._rawJobs = jobs;
      this._renderTick();
      // 展示即已读（设置页小绿点真相源）；导入成功首见 ⇒ 触发一次主动同步（§8.3 步骤 7）
      const seen = await getSeenCompletedJobIds();
      for (const job of jobs) {
        if (job.status !== 'succeeded') continue;
        if (job.type === 'import' && !seen.includes(job.id)) {
          // 导入完成后账本数据已变：主动同步让流水/资产立刻可见
          triggerOnMutation();
        }
        void markDataJobSeen(job.id);
      }
    } catch (err) {
      logger.warn(MODULE, 'poll jobs fail', err);
    } finally {
      if (this.data.loading) this.setData({ loading: false });
    }
  },

  /** 按最新服务端时间锚点重建任务卡（轮询与本地 1s 节拍共用 · 顺带驱动导出/示例按钮冷却倒数） */
  _renderTick(): void {
    this._syncCreateCooldown();
    this._syncDemoCooldown();
    // 服务端导入闸口是 per-family（uq_data_jobs_active_import_per_family），
    // 故只有「当前导入目标账本」自身有进行中导入才该挡入口；
    // 按全局判定会让多账本用户被别账本的任务误挡（比服务端更严）。
    const hasActiveImport = this._rawJobs.some(
      (j) =>
        j.type === 'import' &&
        (j.status === 'queued' || j.status === 'processing') &&
        (this._importLedgerId === '' || j.ledgerId === this._importLedgerId),
    );
    if (hasActiveImport !== this.data.hasActiveImport) {
      this.setData({ hasActiveImport });
    }
    if (this._rawJobs.length === 0) {
      this._newJobIds.clear();
      if (this.data.jobs.length !== 0) this.setData({ jobs: [] });
      this._syncShareDrafts([]);
      return;
    }
    const serverNowMs = this._currentServerNowMs();
    const cards = this._rawJobs.map((job) => {
      const card = buildJobCard(job, serverNowMs);
      card.isNew = this._newJobIds.has(job.id);
      return card;
    });
    // isNew 仅存在于任务卡节点创建当帧：wx:key 复用节点，下一拍数据摘除 class，动画只播一次
    this._newJobIds.clear();
    this.setData({ jobs: cards });
    this._syncShareDrafts(cards);
  },

  // ─── 分享草稿生命周期（shareFileMessage 手势门控：异步准备全部前置 · 见 fileTransfer 头注） ───

  /**
   * 按当前任务卡集合驱动草稿：导出完成且未过期的分片 ⇒ 后台预下载；
   * 失效（过期/删除/列表清空）⇒ 回收磁盘草稿。检测报告草稿由导入卡生命周期单独管理。
   */
  _syncShareDrafts(cards: JobCard[]): void {
    const validKeys = new Set<string>();
    for (const card of cards) {
      if (card.type !== 'export' || card.status !== 'succeeded' || card.isExpired) continue;
      for (const file of card.files) {
        const key = `${card.id}:${file.part}`;
        validKeys.add(key);
        if (
          !this._shareDrafts.has(key) &&
          !this._shareInflight.has(key) &&
          !this._shareFailed.has(key)
        ) {
          void this._prepareShareDraft(card.id, file);
        }
      }
    }
    this._purgeShareDrafts(validKeys);
  },

  /** 回收失效草稿（导出按 validKeys · 报告草稿只看当前 _report · demo 草稿只看当前导入目标账本 · 幂等） */
  _purgeShareDrafts(validKeys: Set<string>): void {
    const reportKey = this._reportDraftKey();
    const demoKey = this._demoDraftKey();
    for (const [key, draft] of this._shareDrafts) {
      if (validKeys.has(key) || (reportKey !== '' && key === reportKey) || (demoKey !== '' && key === demoKey)) continue;
      removeCsvShareDraft(draft.sharePath);
      this._shareDrafts.delete(key);
    }
    for (const key of this._shareFailed) {
      if (validKeys.has(key) || (reportKey !== '' && key === reportKey) || (demoKey !== '' && key === demoKey)) continue;
      this._shareFailed.delete(key);
    }
  },

  _reportDraftKey(): string {
    return this._report ? `report:${this._report.detectId}` : '';
  },

  _demoDraftKey(ledgerId?: string): string {
    const id = ledgerId ?? this._importLedgerId;
    return id !== '' ? `demo:${id}` : '';
  },

  /** 丢弃指定（默认当前导入目标账本）的示例草稿（切账本时 · 幂等） */
  _dropDemoDraft(ledgerId?: string): void {
    const key = this._demoDraftKey(ledgerId);
    if (key === '') return;
    const draft = this._shareDrafts.get(key);
    if (draft) {
      removeCsvShareDraft(draft.sharePath);
      this._shareDrafts.delete(key);
    }
    this._shareFailed.delete(key);
  },

  /** 准备完成瞬间的再校验：任务须仍存在、导出 succeeded、未按服务端时间过期、分片仍在 */
  _isShareTargetValid(jobId: string, part: number): boolean {
    if (this._destroyed) return false;
    const job = this._rawJobs.find((j) => j.id === jobId);
    if (!job || job.type !== 'export' || job.status !== 'succeeded') return false;
    if (isExportFileExpired(job.fileExpiresAt, this._currentServerNowMs())) return false;
    return job.files.some((f) => f.part === part);
  },

  /**
   * 预下载分享草稿（下载 → sha256 强校验 → 复制到带后缀草稿路径）。
   * 失败进 _shareFailed 不再自动重试（防轮询节拍无限重试刷 Toast），由用户点击触发重试。
   */
  async _prepareShareDraft(jobId: string, file: FileCard, fromTap = false): Promise<void> {
    const key = `${jobId}:${file.part}`;
    if (this._shareInflight.has(key) || this._shareDrafts.has(key)) return;
    this._shareInflight.add(key);
    this._patchFileCard(jobId, file.part, { preparing: true, preparePercent: 0 });
    try {
      const { tempFilePath } = await downloadWithAuth({
        path: file.downloadPath,
        onProgress: (percent) => {
          this._patchFileCard(jobId, file.part, { preparePercent: percent });
        },
      });
      await verifyFileSha256(tempFilePath, file.sha256);
      const sharePath = await prepareCsvShareDraft(tempFilePath, exportShareDraftName(jobId, file.part));
      if (this._isShareTargetValid(jobId, file.part)) {
        this._shareDrafts.set(key, { sharePath, filename: file.filename });
        this._shareFailed.delete(key);
      } else {
        // 目标已失效/页面已销毁 ⇒ 不入就绪表，草稿立即清掉
        removeCsvShareDraft(sharePath);
      }
    } catch (err) {
      const apiErr = err as ApiError;
      this._shareFailed.add(key);
      if (apiErr?.code === 'EXPORT_FILE_EXPIRED') {
        wx.showToast({ title: '文件已过期，请重新导出', icon: 'none' });
        await this._refreshJobs(); // 派生态由服务端时间重新判定
      } else if (apiErr?.code === 'CLIENT_CHECKSUM_MISMATCH') {
        wx.showToast({ title: '文件校验失败，请重新下载', icon: 'none' });
      } else if (fromTap) {
        this._showErrorToast(apiErr);
      } else {
        logger.warn(MODULE, `prepare share draft fail · ${key}`, err);
      }
    } finally {
      this._shareInflight.delete(key);
      this._patchFileCard(jobId, file.part, { preparing: false, preparePercent: 0 });
    }
  },

  /** 检测报告草稿预下载（detect 完成渲染结果区时启动 · 报告无 sha256 契约故不强校验） */
  async _prepareReportDraft(report: DetectReport): Promise<void> {
    const key = `report:${report.detectId}`;
    if (this._shareInflight.has(key) || this._shareDrafts.has(key)) return;
    this._shareInflight.add(key);
    this.setData({ reportPreparing: true });
    try {
      const { tempFilePath } = await downloadWithAuth({ path: report.reportPath });
      const sharePath = await prepareCsvShareDraft(tempFilePath, reportShareDraftName(report.detectId));
      const dateKey = shanghaiDateKeyFromIso(report.createdAt);
      if (!this._destroyed && this._report?.detectId === report.detectId) {
        this._shareDrafts.set(key, {
          sharePath,
          filename: `Costra_导入检测报告_${dateKey}.csv`,
        });
        this._shareFailed.delete(key);
      } else {
        removeCsvShareDraft(sharePath);
      }
    } catch (err) {
      const apiErr = err as ApiError;
      this._shareFailed.add(key);
      // 报告寿命（24h）与检测会话 commit 有效期（15min）解耦（§7.4）：报告不可用
      // 不影响本次确认导入，故只提示、不重置导入卡（服务端此处返 404 而非会话过期码）
      if (apiErr?.code === 'NOT_FOUND') {
        wx.showToast({ title: '检测报告已不可用', icon: 'none' });
      } else {
        logger.warn(MODULE, 'prepare report draft fail', err);
      }
    } finally {
      this._shareInflight.delete(key);
      this.setData({ reportPreparing: false });
    }
  },

  /**
   * 示例文件草稿预下载（§4.6 · 进入页面/切换导入账本时启动）。
   * 无 sha256 契约故不强校验（与检测报告同）；就绪校验要求目标账本未再切换。
   */
  async _prepareDemoDraft(ledgerId: string): Promise<void> {
    const key = this._demoDraftKey(ledgerId);
    if (key === '' || this._shareInflight.has(key) || this._shareDrafts.has(key)) return;
    this._shareInflight.add(key);
    if (ledgerId === this._importLedgerId) this.setData({ demoPreparing: true });
    try {
      const { tempFilePath } = await downloadWithAuth({ path: demoCsvPath(ledgerId) });
      const sharePath = await prepareCsvShareDraft(tempFilePath, demoShareDraftName());
      if (!this._destroyed && this._importLedgerId === ledgerId) {
        this._shareDrafts.set(key, { sharePath, filename: DEMO_CSV_FILENAME });
        this._shareFailed.delete(key);
      } else {
        // 页面已销毁或账本已切换 ⇒ 不入就绪表，草稿立即清掉
        removeCsvShareDraft(sharePath);
      }
    } catch (err) {
      // 静默失败不打扰（示例非关键路径）：按钮点击时再重试并提示
      this._shareFailed.add(key);
      logger.warn(MODULE, `prepare demo draft fail · ${key}`, err);
    } finally {
      this._shareInflight.delete(key);
      if (ledgerId === this._importLedgerId) this.setData({ demoPreparing: false });
    }
  },

  // ─── 导入卡：选择与校验（§8.3 步骤 3-7 · 校验失败就地展示不 Toast） ─────────────────

  onPickImportFile(): void {
    if (this.data.importState === 'detecting' || this.data.committing) return;
    if (this.data.hasActiveImport) {
      this.setData({ fileError: '该账本已有导入任务进行中，请等待完成' });
      return;
    }
    // extension 必须双写法 ['.csv', 'csv']：Android 按带点后缀匹配、iOS 按不带点匹配（官方文档未写明，
    // 社区实测的端差异），只写一种会在另一端把文件列表滤空；选中后仍有下方大小写不敏感的手动 .csv
    // 校验 + 服务端内容校验兜底（§14.1 spike 结论）
    wx.chooseMessageFile({
      count: 1,
      type: 'file',
      extension: ['.csv', 'csv', '.CSV', 'CSV'],
      success: (res) => {
        const file = res.tempFiles?.[0];
        if (!file) return;
        const name = file.name || '导入文件.csv';
        if (!name.toLowerCase().endsWith('.csv')) {
          this.setData({ fileError: '仅支持 csv 文件' });
          return;
        }
        // 客户端本地大小校验（§9.1 三层阈值第一层 · 服务端二次校验兜底）
        if (file.size > IMPORT_MAX_FILE_BYTES) {
          this.setData({
            fileError: mapError({ code: 'PAYLOAD_TOO_LARGE' } as ApiError).desc,
          });
          return;
        }
        this._importFilePath = file.path;
        // §8.3 步骤 7：确认卡（账本/文件名/大小）→ 用户点「开始检测」才上传
        this.setData({
          importState: 'confirm',
          importFileName: name,
          importFileSizeText: formatFileSize(file.size),
          fileError: '',
        });
      },
      fail: (err) => {
        if (typeof err?.errMsg === 'string' && err.errMsg.includes('cancel')) return;
        logger.warn(MODULE, 'chooseMessageFile fail', err);
        this.setData({ fileError: '文件选择失败，请重试' });
      },
    });
  },

  /** 确认卡「开始检测」（§8.3 步骤 8 · 上传/检测期间防误返回 R4） */
  onStartDetectTap(): void {
    if (this.data.importState !== 'confirm' || !this._importFilePath) return;
    wx.enableAlertBeforeUnload({ message: '文件正在检测中，确定要离开吗？' });
    this.setData({ importState: 'detecting', fileError: '' });
    void this._runDetect();
  },

  async _runDetect(): Promise<void> {
    try {
      const ledgerId = this._importLedgerId || (await getActiveLedgerId());
      if (!ledgerId) {
        this._disableLeaveAlert();
        this.setData({ importState: 'idle', fileError: '未找到目标账本，请稍后重试' });
        return;
      }
      const report = await detectImportFile({ filePath: this._importFilePath, ledgerId });
      this._disableLeaveAlert();
      this._report = report;
      // 分享手势门控：报告草稿预下载（结果区「下载问题报告」⇒ tap 同步栈直调 sharePreparedCsv）。
      // 仅在确有问题时预下载：服务端仅在 errors+warnings>0 时生成报告文件
      // （entryImport.writeDetectArtifacts），无问题时对 report_path 的下载恒 404，
      // 无条件预下载会误弹「检测报告已不可用」（下载入口 showReportDownload 同条件隐藏）。
      if (report.errorCount + report.warningCount > 0) {
        void this._prepareReportDraft(report);
      }
      this._mappingDraft = {};
      if (report.unmatchedMembers.length > 0) {
        await this._loadMemberOptions();
      }
      this.setData({ importState: 'report' });
      this._syncImportDerived();
    } catch (err) {
      this._disableLeaveAlert();
      const apiErr = err as ApiError;
      this._resetImportCard();
      if (apiErr?.code === 'DETECT_IN_PROGRESS') {
        this.setData({ fileError: '上一个文件还在检测中，请稍候' });
        return;
      }
      if (apiErr?.code === 'IMPORT_JOB_IN_PROGRESS') {
        this.setData({ fileError: '该账本已有导入任务进行中' });
        await this._refreshJobs();
        return;
      }
      this.setData({ fileError: mapError(apiErr).desc || mapError(apiErr).title });
    }
  },

  /** 成员选项（映射 actionSheet 用 · 仅活跃成员 · 目标导入账本所属家庭） */
  async _loadMemberOptions(): Promise<void> {
    try {
      const familyId = this._importLedgerFamilyId || (await getActiveFamilyId());
      if (!familyId) return;
      const members = await getFamilyMembers(familyId);
      this._memberOptions = members
        .filter((m) => m.status === 'active')
        .map((m) => ({ userId: m.user_id, nickname: m.nickname }));
    } catch (err) {
      logger.warn(MODULE, 'load family members fail', err);
    }
  },

  // ─── 导入卡：结果区派生（统计/问题预览/映射/确认按钮） ──────

  /** 由 _report + _mappingDraft 重建结果区视图数据（唯一派生出口） */
  _syncImportDerived(): void {
    const report = this._report;
    if (!report) return;

    // 统计 chips（§8.3 步骤 3）
    const parts = [`共 ${report.totalRows} 条`, `可导入 ${report.importableRows}`];
    if (report.errorCount > 0) parts.push(`错误 ${report.errorCount}`);
    if (report.warningCount > 0) parts.push(`警告 ${report.warningCount}`);

    // 问题预览（错误优先 · 各前若干条 · 超出给"下载报告"出口）
    const issues: IssueRow[] = [
      ...report.errorsPreview.map((i, idx) => ({
        key: `e${idx}`,
        text: describeImportIssue(i),
        level: 'error' as const,
      })),
      ...report.warningsPreview.map((i, idx) => ({
        key: `w${idx}`,
        text: describeImportIssue(i),
        level: 'warning' as const,
      })),
    ];
    const PREVIEW_CAP = 5;
    const totalIssues = report.errorCount + report.warningCount;
    const shown = Math.min(issues.length, PREVIEW_CAP);
    const overflow =
      report.errorsTruncated || report.warningsTruncated || totalIssues > shown
        ? `其余 ${Math.max(0, totalIssues - shown)} 条请下载报告查看`
        : '';

    // 成员映射行（仅自产文件有未匹配昵称时）
    const mappingRows: MappingRow[] = report.unmatchedMembers.map((m) => {
      const target = this._mappingDraft[m.nickname] ?? '';
      return {
        nickname: m.nickname,
        rowCount: m.rowCount,
        target,
        targetLabel: this._mappingTargetLabel(target),
      };
    });

    // 未匹配昵称 >20（§4.3 unmatched_members_truncated）：不渲染映射区，
    // 引导用户确认是否选错目标账本（文件成员与该家庭普遍对不上时的典型信号）
    const mappingTooMany = report.unmatchedMembersTruncated;

    // 确认按钮：可导入行 + 已映射待导入行 > 0 才可点（全量 ERROR 且无可映射 ⇒ 置灰 · §8.3）
    const mappedRows = report.unmatchedMembers
      .filter((m) => (this._mappingDraft[m.nickname] ?? '') !== '')
      .reduce((acc, m) => acc + m.rowCount, 0);
    const commitCount = report.importableRows + mappedRows;

    this.setData({
      reportSummaryText: parts.join(' · '),
      issuesPreview: issues.slice(0, PREVIEW_CAP),
      issuesOverflowText: overflow,
      showReportDownload: totalIssues > 0,
      mappingRows,
      mappingTooMany,
      commitEnabled: commitCount > 0 && !mappingTooMany && !this.data.committing,
      commitLabel: `确认导入 ${commitCount} 条`,
      commitCount,
    });
  },

  _mappingTargetLabel(target: string): string {
    if (target === '__self__') return '归到我名下';
    if (target === '') return '选择成员';
    return this._memberOptions.find((m) => m.userId === target)?.nickname ?? '选择成员';
  },

  // ─── 导入卡：映射与动作 ──────────────────────────────────

  onMappingRowTap(e: WechatMiniprogram.TouchEvent): void {
    const { nickname } = e.currentTarget.dataset as { nickname: string };
    const options = this._memberOptions;
    const items = [...options.map((m) => `归为：${m.nickname}`), '归到我名下'];
    wx.showActionSheet({
      itemList: items,
      success: (res) => {
        const idx = res.tapIndex;
        if (idx == null) return;
        this._mappingDraft[nickname] =
          idx < options.length ? options[idx]!.userId : '__self__';
        this._syncImportDerived();
      },
      fail: () => {
        /* 取消选择无操作 */
      },
    });
  },

  /**
   * 「下载问题报告」→ 发送到微信。
   * shareFileMessage 手势门控（见 fileTransfer 头注）：报告草稿在 detect 完成时已预下载，
   * 此处同步栈内直调 sharePreparedCsv，禁止加前置 await。
   */
  onDownloadReportTap(): void {
    const report = this._report;
    if (!report || this.data.reportPreparing) return;
    const key = `report:${report.detectId}`;
    const ready = this._shareDrafts.get(key);
    if (!ready) {
      // 草稿未就绪（此前准备失败）：重新准备，就绪后再点
      this._shareFailed.delete(key);
      wx.showToast({ title: '报告准备中，完成后请再次点击', icon: 'none' });
      void this._prepareReportDraft(report);
      return;
    }
    void sharePreparedCsv(ready.sharePath, ready.filename).then((shared) => {
      if (!shared) {
        wx.showToast({ title: '已取消分享', icon: 'none' });
      }
    }, (err) => this._showErrorToast(err as ApiError));
  },

  /**
   * 「下载示例文件」→ 发送到微信（§4.6）。
   * shareFileMessage 手势门控：示例草稿在页面加载/切换账本时已预下载，
   * 此处同步栈内直调 sharePreparedCsv，禁止加前置 await。
   */
  onDownloadDemoTap(): void {
    if (this.data.demoPreparing || this.data.demoCooldown > 0) return;
    const key = this._demoDraftKey();
    const ready = key !== '' ? this._shareDrafts.get(key) : undefined;
    if (!ready) {
      // 草稿未就绪（尚未准备或此前失败）：重新准备，就绪后再点（未发起分享不进冷却）
      if (key !== '') this._shareFailed.delete(key);
      wx.showToast({ title: '示例文件准备中，完成后请再次点击', icon: 'none' });
      if (this._importLedgerId !== '') void this._prepareDemoDraft(this._importLedgerId);
      return;
    }
    // 分享面板拉起即进 3s 冷却（用户取消同样生效 · 防连点反复拉起）
    this._startDemoCooldown();
    void sharePreparedCsv(ready.sharePath, ready.filename).then((shared) => {
      if (!shared) {
        wx.showToast({ title: '已取消分享', icon: 'none' });
      }
    }, (err) => this._showErrorToast(err as ApiError));
  },

  /**
   * 确认导入的二次确认弹窗（§4.6.4）：提交前汇总展示目标账本、导入/跳过条数、
   * 昵称映射去向与系统降级分类条数，用户确认后才真正创建导入任务。
   * wx.showModal 无富文本能力，视觉层次靠分组：关键事实（目标账本/条数）置顶为头部，
   * 映射与降级明细居中，空行分隔，流程说明垫底。
   */
  onCommitImportTap(): void {
    const report = this._report;
    if (!report || !this.data.commitEnabled || this.data.committing) return;

    const ledgerName = this.data.importLedgerName || this.data.ledgerName;
    const commitCount = this.data.commitCount;
    const skipped = report.totalRows - commitCount;
    const lines = [
      `目标账本：「${ledgerName}」`,
      `将导入 ${commitCount} 条流水${skipped > 0 ? `，跳过 ${skipped} 条` : ''}`,
    ];
    const details: string[] = [];
    const mappings = Object.entries(this._mappingDraft)
      .filter(([, target]) => target !== '')
      .map(([nick, target]) => `「${nick}」→ ${target === '__self__' ? '我' : this._mappingTargetLabel(target)}`);
    if (mappings.length > 0) {
      details.push(`昵称映射：${mappings.join('、')}`);
    }
    if (report.subcategoryFallbackCount > 0) {
      details.push(`其中 ${report.subcategoryFallbackCount} 条的二级分类不存在，将归入默认子分类`);
    }
    if (details.length > 0) {
      lines.push('', ...details);
    }
    lines.push('', '确认后将在后台导入，结果见下方数据任务');

    wx.showModal({
      title: '确认导入',
      content: lines.join('\n'),
      confirmText: '确认导入',
      cancelText: '再想想',
      success: (res) => {
        if (res.confirm) void this._doCommitImport();
      },
    });
  },

  async _doCommitImport(): Promise<void> {
    const report = this._report;
    if (!report || this.data.committing) return;
    this.setData({ committing: true, commitEnabled: false });
    try {
      await commitImportJob({
        detectId: report.detectId,
        memberMapping: { ...this._mappingDraft },
      });
      wx.showToast({ title: '导入任务已创建，结果见下方数据任务', icon: 'none' });
      this._resetImportCard();
      await this._refreshJobs();
    } catch (err) {
      const apiErr = err as ApiError;
      if (apiErr?.code === 'DETECT_SESSION_EXPIRED') {
        wx.showToast({ title: '检测已过期，请重新上传文件', icon: 'none' });
        this._resetImportCard();
        return;
      }
      if (apiErr?.code === 'IMPORT_JOB_IN_PROGRESS') {
        wx.showToast({ title: '该账本已有导入任务进行中', icon: 'none' });
        this._resetImportCard();
        await this._refreshJobs();
        return;
      }
      this._showErrorToast(apiErr);
      this._syncImportDerived(); // 恢复按钮态
    } finally {
      this.setData({ committing: false });
    }
  },

  onResetImportTap(): void {
    this._resetImportCard();
  },

  _resetImportCard(): void {
    this._disableLeaveAlert();
    this._importFilePath = '';
    // 报告草稿随导入卡生命周期回收（在途准备完成时会因 _report 已空而自弃）
    const reportKey = this._reportDraftKey();
    if (reportKey !== '') {
      const draft = this._shareDrafts.get(reportKey);
      if (draft) {
        removeCsvShareDraft(draft.sharePath);
        this._shareDrafts.delete(reportKey);
      }
      this._shareFailed.delete(reportKey);
    }
    this._report = null;
    this._mappingDraft = {};
    this.setData({
      importState: 'idle',
      fileError: '',
      importFileName: '',
      importFileSizeText: '',
      reportSummaryText: '',
      issuesPreview: [],
      issuesOverflowText: '',
      showReportDownload: false,
      reportPreparing: false,
      mappingRows: [],
      mappingTooMany: false,
      commitEnabled: false,
      commitLabel: '确认导入',
      commitCount: 0,
    });
  },

  /** 关闭"离开前确认"（检测结束/离开页面/卡片重置时 · 幂等） */
  _disableLeaveAlert(): void {
    try {
      wx.disableAlertBeforeUnload();
    } catch {
      /* 低版本基础库无此 API 时忽略 */
    }
  },

  // ─── 导出表单 ────────────────────────────────────────────

  onRangeTap(): void {
    const modes: Array<{ mode: RangeMode; label: string }> = [
      { mode: 'all', label: '全部流水' },
      { mode: 'year', label: '今年' },
      { mode: 'month', label: '本月' },
      { mode: 'custom', label: '自定义…' },
    ];
    wx.showActionSheet({
      itemList: modes.map((m) => m.label),
      success: (res) => {
        const picked = modes[res.tapIndex];
        if (!picked) return;
        const updates: Record<string, string> = {
          rangeMode: picked.mode,
          rangeLabel: picked.mode === 'custom' ? this._customRangeLabel() : picked.label,
        };
        if (picked.mode === 'custom' && (!this.data.customFrom || !this.data.customTo)) {
          // 首次进入自定义：预填本月
          const today = this.data.today;
          updates['customFrom'] = `${today.slice(0, 7)}-01`;
          updates['customTo'] = today;
          updates['rangeLabel'] = `${updates['customFrom']} 至 ${updates['customTo']}`;
        }
        this.setData(updates);
      },
    });
  },

  onCustomFromChange(e: WechatMiniprogram.PickerChange): void {
    const from = String(e.detail.value);
    const customTo = this.data.customTo && this.data.customTo >= from ? this.data.customTo : from;
    this.setData({ customFrom: from, customTo, rangeLabel: this._customRangeLabel(from, customTo) });
  },

  onCustomToChange(e: WechatMiniprogram.PickerChange): void {
    const to = String(e.detail.value);
    const customFrom = this.data.customFrom && this.data.customFrom <= to ? this.data.customFrom : to;
    this.setData({ customTo: to, customFrom, rangeLabel: this._customRangeLabel(customFrom, to) });
  },

  _customRangeLabel(from?: string, to?: string): string {
    const f = from ?? this.data.customFrom;
    const t = to ?? this.data.customTo;
    return f && t ? `${f} 至 ${t}` : '自定义…';
  },

  /** 当前表单对应的 from/to（YYYY-MM-DD · 服务端按上海当日起止解释） */
  _currentRange(): { from?: string; to?: string } {
    const today = this.data.today;
    switch (this.data.rangeMode) {
      case 'year':
        return { from: `${today.slice(0, 4)}-01-01`, to: today };
      case 'month':
        return { from: `${today.slice(0, 7)}-01`, to: today };
      case 'custom':
        return { from: this.data.customFrom, to: this.data.customTo };
      default:
        return {};
    }
  },

  // ─── 导出动作 ────────────────────────────────────────────

  async onCreateTap(): Promise<void> {
    if (this.data.creating) return;
    this.setData({ creating: true });
    try {
      await this._createJob(this._currentRange());
    } finally {
      this.setData({ creating: false });
    }
  },

  /** 重试（失败卡）/ 重新生成（过期完成卡）：按任务原账本 + 原区间重发（§6.2 source_date_*） */
  async onRecreateTap(e: WechatMiniprogram.TouchEvent): Promise<void> {
    const { ledgerId, from, to } = e.currentTarget.dataset as {
      ledgerId?: string;
      from?: string;
      to?: string;
    };
    await this._createJob({ from: from || undefined, to: to || undefined }, ledgerId || undefined);
  },

  async _createJob(range: { from?: string; to?: string }, ledgerId?: string): Promise<void> {
    try {
      await createExportJob({ ...range, ledgerId: ledgerId ?? (this._exportLedgerId || undefined) });
      wx.showToast({ title: '导出任务已创建，请在下方数据任务查看和下载', icon: 'none' });
      this._startCreateCooldown();
      await this._refreshJobs();
      // 新任务卡插入列表顶部，滚动到任务区确保 toast 指引的"下方"可见（卡片入场动画不被错过）
      wx.nextTick(() => this._scrollToJobs());
    } catch (err) {
      const apiErr = err as ApiError;
      if (apiErr?.code === 'EXPORT_JOB_IN_PROGRESS') {
        // 闸口命中是设计内分支：任务卡就在列表里，直接刷新让用户看到它
        wx.showToast({ title: '已有导出任务进行中', icon: 'none' });
        await this._refreshJobs();
        return;
      }
      this._showErrorToast(apiErr);
    }
  },

  /** 创建成功后启动按钮冷却（防连点 · 立即折算一次让按钮即刻置灰） */
  _startCreateCooldown(): void {
    this._createCooldownEnd = Date.now() + CREATE_COOLDOWN_MS;
    this._syncCreateCooldown();
  },

  /** 按真实时间戳折算剩余冷却秒数（1s 节拍驱动 · 页面隐藏期间节拍暂停，恢复后按时间戳自愈） */
  _syncCreateCooldown(): void {
    const remain = Math.ceil((this._createCooldownEnd - Date.now()) / 1000);
    const createCooldown = remain > 0 ? remain : 0;
    if (createCooldown !== this.data.createCooldown) this.setData({ createCooldown });
  },

  /** 示例分享发起后启动按钮冷却（防连点 · 立即折算一次让按钮即刻置灰） */
  _startDemoCooldown(): void {
    this._demoCooldownEnd = Date.now() + DEMO_COOLDOWN_MS;
    this._syncDemoCooldown();
  },

  _syncDemoCooldown(): void {
    const remain = Math.ceil((this._demoCooldownEnd - Date.now()) / 1000);
    const demoCooldown = remain > 0 ? remain : 0;
    if (demoCooldown !== this.data.demoCooldown) this.setData({ demoCooldown });
  },

  /** 滚动到「数据任务」区（导出创建成功后 · 区域不存在时静默跳过） */
  _scrollToJobs(): void {
    const query = wx.createSelectorQuery().in(this);
    query.select('.section-title').boundingClientRect();
    query.selectViewport().scrollOffset();
    query.exec((res) => {
      const rect = res?.[0] as WechatMiniprogram.BoundingClientRectCallbackResult | null;
      const viewport = res?.[1] as WechatMiniprogram.ScrollOffsetCallbackResult | null;
      if (!rect || !viewport) return;
      wx.pageScrollTo({ scrollTop: viewport.scrollTop + rect.top - 24, duration: 300 });
    });
  },

  _showErrorToast(err: ApiError): void {
    const mapped = mapError(err);
    wx.showToast({ title: mapped.desc || mapped.title || '请稍后再试', icon: 'none' });
  },

  /**
   * 「发送到微信」（§6.3 · 完成卡唯一出口动作）。
   * shareFileMessage 手势门控（can only be invoked by user TAP gesture · 见 fileTransfer 头注）：
   * 下载/校验/复制已在草稿准备阶段完成，此处同步栈内直调 sharePreparedCsv，禁止加前置 await。
   */
  onDownloadTap(e: WechatMiniprogram.TouchEvent): void {
    const { jobId, part } = e.currentTarget.dataset as { jobId: string; part: number };
    const jobCard = this.data.jobs.find((j) => j.id === jobId);
    const fileCard = jobCard?.files.find((f) => f.part === Number(part));
    if (!jobCard || !fileCard || fileCard.preparing) return;

    const key = `${jobId}:${fileCard.part}`;
    const ready = this._shareDrafts.get(key);
    if (!ready) {
      // 草稿未就绪（此前准备失败）：重新准备，就绪后再点发送
      this._shareFailed.delete(key);
      wx.showToast({ title: '文件准备中，完成后请再次点击发送', icon: 'none' });
      void this._prepareShareDraft(jobId, fileCard, true);
      return;
    }
    void sharePreparedCsv(ready.sharePath, ready.filename).then((shared) => {
      if (!shared) {
        wx.showToast({ title: '已取消分享', icon: 'none' });
      } else if (jobCard.files.length > 1 && fileCard.part < jobCard.files.length) {
        // §6.3：多分片逐个转发，每次转发之间给明确提示
        wx.showToast({
          title: `第 ${fileCard.part} / ${jobCard.files.length} 个文件已发送`,
          icon: 'none',
        });
      }
    }, (err) => this._showErrorToast(err as ApiError));
  },

  _patchFileCard(jobId: string, part: number, patch: Partial<FileCard>): void {
    const jobIdx = this.data.jobs.findIndex((j) => j.id === jobId);
    if (jobIdx < 0) return;
    const fileIdx = this.data.jobs[jobIdx]!.files.findIndex((f) => f.part === part);
    if (fileIdx < 0) return;
    this.setData({
      [`jobs[${jobIdx}].files[${fileIdx}]`]: {
        ...this.data.jobs[jobIdx]!.files[fileIdx]!,
        ...patch,
      },
    });
  },
});

// ==============================================================================
// 任务卡构建（页面渲染与已读标记的公共出口）
// ==============================================================================

function buildJobCard(job: DataJob, serverNowMs: number): JobCard {
  const isImport = job.type === 'import';
  const expired =
    !isImport && job.status === 'succeeded' && isExportFileExpired(job.fileExpiresAt, serverNowMs);
  const stageElapsedMs =
    job.status === 'processing' && job.stageStartedAt
      ? serverNowMs - Date.parse(job.stageStartedAt)
      : job.status === 'queued'
        ? serverNowMs - Date.parse(job.createdAt)
        : 0;
  const progress =
    job.status === 'processing' || job.status === 'queued'
      ? calcSimulatedProgress(job.status === 'queued' ? 'queued' : job.stage, stageElapsedMs)
      : job.status === 'succeeded'
        ? 100
        : 0;

  return {
    id: job.id,
    type: job.type,
    status: job.status,
    statusText:
      job.status === 'succeeded'
        ? expired
          ? '已过期'
          : '已完成'
        : job.status === 'failed'
          ? isImport
            ? '导入失败'
            : '导出失败'
          : '进行中',
    stageName: stageDisplayName(job.status === 'queued' ? null : job.stage),
    progress,
    entryCount: isImport ? job.importedCount : job.entryCount,
    skippedCount: isImport ? job.skippedCount : null,
    rangeLabel: isImport ? '导入 CSV' : rangeLabelOf(job),
    ledgerName: job.ledgerName ?? '',
    createdLabel: fmtLocal(job.createdAt),
    isExpired: expired,
    countdownText: expired || isImport ? null : formatExpiresCountdown(job.fileExpiresAt, serverNowMs),
    files: isImport ? [] : job.files.map((f) => buildFileCard(f)),
    sourceFrom: job.sourceDateFrom,
    sourceTo: job.sourceDateTo,
    ledgerId: job.ledgerId,
    errorCode: job.error?.code ?? null,
    errorText: job.status === 'failed' ? describeDataJobError(job.error?.code) : null,
    isNew: false,
  };
}

function buildFileCard(file: DataJobFile): FileCard {
  const { head, tail } = splitExportFilename(file.filename);
  return {
    part: file.part,
    filename: file.filename,
    nameHead: head,
    nameTail: tail,
    sizeText: formatFileSize(file.sizeBytes),
    downloadPath: file.downloadPath,
    sha256: file.sha256,
    preparing: false,
    preparePercent: 0,
  };
}

/**
 * 导出文件名拆头/尾两段（头段溢出省略 ⇒ 中间省略效果）。
 * 依赖服务端冻结命名 Costra_{账本}_{start}至{end}_{ts}[_NofM].csv（server entryExport §2.2）：
 * 最后一个 "_" 之后恒为时间戳或分片段，其内部不含 "_"。
 */
function splitExportFilename(filename: string): { head: string; tail: string } {
  const sep = filename.lastIndexOf('_');
  if (sep <= 0 || sep === filename.length - 1) return { head: filename, tail: '' };
  return { head: filename.slice(0, sep + 1), tail: filename.slice(sep + 1) };
}

function rangeLabelOf(job: DataJob): string {
  // source_date_* 是用户所选日期（export_from/to 是半开区间端点，不可直接展示：
  // 排他端为止日次日 00:00，直接格式化会多显示一天）
  if (job.sourceDateFrom && job.sourceDateTo) {
    return `${job.sourceDateFrom} 至 ${job.sourceDateTo}`;
  }
  if (!job.exportFrom || !job.exportTo) return '全部流水';
  // 兼容无 source_date_* 的旧任务：排他端回推 1 天还原所选止日
  const endMs = Date.parse(job.exportTo) - 86_400_000;
  return `${shanghaiDateKeyFromIso(job.exportFrom)} 至 ${shanghaiDateKeyFromIso(new Date(endMs).toISOString())}`;
}
