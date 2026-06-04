// app.ts · Costra 小程序入口
// 卡号: COSTRA-030 · 参考: https://developers.weixin.qq.com/miniprogram/dev/reference/api/App.html
// 约束: 见 .team/decisions/ADR-0004-miniapp-runtime-details.md
// COSTRA-124: onLaunch 首行加 ensureVersion() · 消除 storage.ts 模块顶层副作用的启动期时序风险（R1 部分闭合）
// COSTRA-125: bootstrap Promise 统一门控（B'+E' 合并版）· async storage 全量化 · onLaunch 内串行 ensureVersion → initAuth
// Refs:
//   - FU-LAUNCH-FIRST-RENDER-RACE-A（COSTRA-124 已 close · 顶层副作用消除）
//   - FU-LAUNCH-FIRST-RENDER-RACE-B（COSTRA-125 本卡 close · 渲染层 storage group `_prepare` 未就绪）
//   - .team/dispatch/COSTRA-125-miniapp-storage-async-migration.md §2.2 / §3 (d)
//   - docs/devops/libversion-upgrade.md §3.4（反模式 #4）
import { initAuth, isLoggedIn, getToken } from './services/auth';
import { getEnv } from './services/env';
import { ensureVersion } from './services/storage';
import { startScheduler, stopScheduler, syncOnce } from './services/syncScheduler';
import { tokens } from './tokens/index';
import { eventBus, EventNames } from './services/eventBus';
import { acceptInvite } from './services/familyApi';
import { setActiveFamily } from './services/family';

interface AppGlobalData {
  env: ReturnType<typeof getEnv>;
  tokens: typeof tokens;
  bootAt: number;
  // COSTRA-105 R1.x.1 BUG-001: COSTRA-155 实装真账本切换时填充 · 目前 fallback 到 FALLBACK_LEDGER_ID
  activeLedgerId?: string;
  /**
   * 从分享邀请链接启动时，onLaunch query 中的 invite_token。
   * 存于 globalData（而非 storage）以避免 ensureVersion clearStorage 竞争问题。
   * login.ts onTapLogin 登录成功后读取并消费，消费后置 null。
   */
  pendingInviteToken?: string | null;
}

/**
 * COSTRA-125: App 类型扩展 `bootstrapPromise: Promise<void>`
 * - 用作"启动期 bootstrap 是否完成"的统一门控信号
 * - Page.onLoad 中需要登录态/storage 的页面：必须 `await getApp().bootstrapPromise`
 * - 业务调 storage 时机的统一对账锚点（参见 storage.ts 不变量 #4）
 */
interface AppOption {
  globalData: AppGlobalData;
  bootstrapPromise: Promise<void>;
  onLaunch(options: WechatMiniprogram.App.LaunchShowOption): void;
  onShow(): void;
  onError(msg: string): void;
}

App<AppOption>({
  globalData: {
    env: getEnv(),
    tokens,
    bootAt: 0
  },

  // COSTRA-125: 占位 · onLaunch 内会被覆盖为真实 bootstrap Promise
  bootstrapPromise: Promise.resolve(),

  onLaunch(options: WechatMiniprogram.App.LaunchShowOption) {
    this.globalData.bootAt = Date.now();
    console.info('[Costra] onLaunch env=', this.globalData.env.name);

    // 分享邀请链接携带的 invite_token：存入 globalData 供登录流程消费
    // ⚠️ 不存 storage：ensureVersion() 可能 clearStorage，导致 token 丢失
    // globalData 与小程序实例同生命周期，不受 storage 版本清除影响
    const inviteToken = options?.query?.invite_token as string | undefined;
    if (inviteToken) {
      console.info('[Costra] onLaunch invite_token detected');
      this.globalData.pendingInviteToken = inviteToken;
    }

    // COSTRA-125: 串行 bootstrap 两阶段都是 async storage
    //   阶段 1 · ensureVersion()  → 走 wx.getStorage Promise 形态 · SDK 内部等渲染层 _prepare 就绪
    //   阶段 2 · initAuth()       → 内部 await getItem(TOKEN_KEY) · 必在阶段 1 之后
    //   末尾若无登录态 → wx.reLaunch 跳 login（保持原 R1 行为）
    this.bootstrapPromise = (async () => {
      await ensureVersion();
      await initAuth();
      // 启动期兜底 · entry page 渲染前先定登录态（与 Page.onLoad/onShow gate 形成多层保险）
      if (!isLoggedIn()) {
        try { wx.reLaunch({ url: '/pages/login/index' }); } catch { /* 单测 / 非 wx 环境 noop */ }
        return;
      }
      // 登录态已就绪：检测画像完善状态，驱动 tabBar 红点弱引导
      const token = getToken();
      if (token && !token.raw.user.has_completed_profile) {
        eventBus.emit(EventNames.PROFILE_INCOMPLETE);
      }
      // 已登录用户从邀请链接冷启动：bootstrap 完成后立即消费 invite_token
      // （首次登录路径由 login.ts onTapLogin 消费；此处覆盖已有 token 重启场景）
      if (inviteToken) {
        await consumeInviteToken(inviteToken);
      }
    })().catch((err) => {
      console.error('[Costra] bootstrap failed', err);
      try { wx.reLaunch({ url: '/pages/login/index' }); } catch { /* noop */ }
    });

    // COSTRA-150: 启动同步调度器（4 触发源 + mutex + debounce）
    // 增强：传入 bootstrapPromise · launch sync 在 bootstrap 完成后立即触发，
    //   消除原 setTimeout(500ms) 时序竞争，加速首屏新数据到达
    startScheduler(this.bootstrapPromise);
  },

  onShow() {
    // COSTRA-125: 等 bootstrap 完成才检查续签 · 避免与 onLaunch 路径并发触发 storage 调用
    void this.bootstrapPromise.then(() => {
      if (isLoggedIn()) {
        const token = getToken();
        if (token && token.shouldRefresh()) {
          // services/auth 负责静默续签，失败时兜底跳 login
          // COSTRA-030 Round-2 修复：原为 (token as any).refresh?.()，方法名错误且永远 undefined
          void token.refreshFn().catch((err) => {
            console.warn('[Costra] token refresh failed, fallback to login', err);
            try { wx.reLaunch({ url: '/pages/login/index' }); } catch { /* noop */ }
          });
        }
      }
    });
  },

  onHide() {
    // 关闭/切后台时主动推送一次本地未同步数据 · 保证离开前数据尽量上行
    // 注：小程序 onHide 后仍有短暂可执行时间窗口（iOS ~5s / Android ~10s），
    //   syncOnce 内部是 push 先于 pull，最关键的 pushDelta 通常 < 1s 可完成
    void syncOnce('hide');
    // COSTRA-150: 停止周期 timer · 切后台不跑 periodic sync
    stopScheduler();
  },

  onError(msg: string) {
    console.error('[Costra] runtime error', msg);
  }
});

/**
 * 消费邀请 token：调 POST /families/invites/accept，成功后切换 active family context。
 * 供两条路径复用：
 *   1. 已登录用户从分享链接冷启动（app.ts bootstrap 末尾调用）
 *   2. 首次登录成功后（login.ts onTapLogin 调用，从 storage 读 token）
 *
 * 行为约定：
 *   - 成功：wx.showToast "成功加入 {familyName}"，更新 active family context
 *   - 已是成员：服务端 acceptInvite 走 ON CONFLICT DO UPDATE（幂等），视为成功
 *   - 邀请已失效（410 INVITE_EXPIRED）：wx.showModal 提示用户
 *   - 其他错误：静默 warn，不阻断主流程
 *   - 无论成功与否，消费后立即清除 storage 中的 pending token
 */
export async function consumeInviteToken(token: string): Promise<void> {
  try {
    const family = await acceptInvite(token);
    // 更新 active family context 到刚加入的家庭
    await setActiveFamily({
      family_id: family.id,
      ledger_id: family.ledger_id,
      family_kind: family.kind,
      ledger_name: family.ledger_name,
    });
    // 更新 globalData.activeLedgerId
    const app = getApp();
    if (app?.globalData) {
      app.globalData.activeLedgerId = family.ledger_id;
    }
    console.info('[Costra] invite accepted, joined family', family.id);
    try {
      wx.showToast({ title: `已加入「${family.name}」`, icon: 'success', duration: 2000 });
    } catch { /* noop */ }
  } catch (e: unknown) {
    const err = e as { code?: string; status?: number };
    if (err.code === 'INVITE_EXPIRED' || err.status === 410) {
      // 邀请已失效（已使用 / 已超时）
      try {
        wx.showModal({
          title: '邀请链接已失效',
          content: '该邀请已被使用或已过期，请联系家庭创建者重新发起邀请。',
          showCancel: false,
          confirmText: '知道了',
        });
      } catch { /* noop */ }
    } else {
      console.warn('[Costra] consumeInviteToken failed', e);
    }
  }
}
