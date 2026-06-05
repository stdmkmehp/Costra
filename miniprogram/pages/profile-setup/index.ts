// pages/profile-setup/index.ts · 完善资料页
// 微信新规（2022-10）：wx.getUserProfile 已返回匿名信息 · 真实头像/昵称需用：
//   头像：<button open-type="chooseAvatar">
//   昵称：<input type="nickname">
// 本页提供完善资料的主动入口，PATCH /users/me 成功后更新本地 token + emit PROFILE_COMPLETED 清除红点。
//
// 头像持久化：
//   wx.chooseAvatar 返回的是微信临时路径（http://tmp/...），删除小程序后失效。
//   保存时先 wx.uploadFile 上传到 POST /v1/upload/avatar，服务端存磁盘并返回持久 URL，
//   再以持久 URL 调 PATCH /users/me，确保重装后仍能看到头像。
import { getToken, updateLocalUserProfile } from '../../services/auth';
import { request } from '../../services/request';
import { eventBus, EventNames } from '../../services/eventBus';
import { getSafeAreaMetrics } from '../../utils/safeArea';
import { getEnv } from '../../services/env';

/** 判断是否是微信临时路径，需要上传 */
function isWxTempPath(url: string): boolean {
  return url.startsWith('http://tmp/') || url.startsWith('wxfile://');
}

/** 将微信临时路径上传到服务端，返回持久 URL */
async function uploadAvatar(tempPath: string, accessToken: string): Promise<string> {
  const env = getEnv();
  // apiBaseUrl = https://costra.cloud/v1，上传端点在 /v1/upload/avatar
  const uploadUrl = `${env.apiBaseUrl}/upload/avatar`;

  return new Promise((resolve, reject) => {
    wx.uploadFile({
      url: uploadUrl,
      filePath: tempPath,
      name: 'file',
      header: { Authorization: `Bearer ${accessToken}` },
      success: (res) => {
        if (res.statusCode !== 201) {
          reject(new Error(`upload failed: statusCode=${res.statusCode}`));
          return;
        }
        try {
          const body = JSON.parse(res.data) as { url?: string };
          if (!body.url) {
            reject(new Error('upload response missing url field'));
            return;
          }
          resolve(body.url);
        } catch {
          reject(new Error('upload response is not valid JSON'));
        }
      },
      fail: (err) => reject(new Error(`wx.uploadFile failed: ${JSON.stringify(err)}`)),
    });
  });
}

Page({
  data: {
    avatarUrl: '',       // 当前展示头像（用户选择前显示已有头像或占位）
    nickname: '',        // 昵称 input 绑定值
    submitting: false,
    statusBarHeight: 0,
    navBarHeight: 0,
  },

  onLoad() {
    const metrics = getSafeAreaMetrics();
    this.setData({
      statusBarHeight: metrics.statusBarHeight,
      navBarHeight: metrics.navBarHeight,
    });

    // 预填当前已有值（重复进入时不丢失已设定的信息）
    const token = getToken();
    if (token) {
      this.setData({
        avatarUrl: token.raw.user.avatar_url || '',
        nickname: token.raw.user.nickname === '微信用户' ? '' : (token.raw.user.nickname || ''),
      });
    }

    // COSTRA-901: 注册隐私授权回调。
    // 本页面使用了 chooseAvatar + type=nickname（隐私接口），微信基础库在用户首次触发前
    // 会调用 onNeedPrivacyAuthorization。此处注册后，由本页面的 privacy-popup 组件弹窗处理。
    // wx.onNeedPrivacyAuthorization 是覆盖式注册（最后一次 register 生效），这正是我们需要的。
    if (typeof wx.onNeedPrivacyAuthorization === 'function') {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      wx.onNeedPrivacyAuthorization((resolve: any) => {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const popup = (this as any).selectComponent('#privacy-popup');
        if (popup) {
          popup.show(resolve);
        } else {
          // 极端 fallback：组件未渲染时保守 agree
          console.warn('[profile-setup] privacy-popup not found');
          resolve({ event: 'agree' });
        }
      });
    }
  },

  /** 微信原生头像选择回调（open-type="chooseAvatar"） */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  onChooseAvatar(e: any) {
    // e.detail.avatarUrl 由微信运行时注入 · 类型库暂无对应定义
    const avatarUrl = (e as { detail: { avatarUrl: string } }).detail.avatarUrl;
    this.setData({ avatarUrl });
  },

  /** 昵称 input 失焦回调（type="nickname"） */
  onNicknameInput(e: WechatMiniprogram.Input) {
    this.setData({ nickname: e.detail.value });
  },

  async onTapSave() {
    const { nickname, avatarUrl, submitting } = this.data;
    if (submitting) return;

    const trimmedNickname = nickname.trim();
    if (!trimmedNickname) {
      wx.showToast({ title: '请输入昵称', icon: 'none' });
      return;
    }

    this.setData({ submitting: true });
    try {
      // 头像持久化：若是微信临时路径，先上传到服务端拿持久 URL
      let persistentAvatarUrl: string | null = avatarUrl || null;
      if (avatarUrl && isWxTempPath(avatarUrl)) {
        const token = getToken();
        if (!token) throw new Error('not logged in');
        persistentAvatarUrl = await uploadAvatar(avatarUrl, token.raw.access_token);
      }

      await request({
        method: 'PATCH',
        path: '/users/me',
        body: {
          nickname: trimmedNickname,
          avatar_url: persistentAvatarUrl,
        },
        timeout: 8_000,
      });

      // 更新本地 token 中的 user 子对象 · 页面和 mine 页 onShow 都会读到新值
      await updateLocalUserProfile({
        nickname: trimmedNickname,
        avatar_url: persistentAvatarUrl,
        has_completed_profile: true,
      });

      // 广播"画像已完善"·  tabBar 红点 + mine 页红点同步清除
      eventBus.emit(EventNames.PROFILE_COMPLETED);

      // 体验优化：先返回上一页再弹 toast · toast 是全局浮层，会显示在栈顶（即上一页）上
      // 这样用户点击保存后立即看到页面返回，"保存成功"提示在上一页继续显示
      wx.navigateBack();
      wx.showToast({ title: '保存成功', icon: 'success', duration: 1200 });
    } catch (e) {
      console.warn('[profile-setup] save failed', e);
      wx.showToast({ title: '保存失败，请重试', icon: 'none' });
    } finally {
      this.setData({ submitting: false });
    }
  },

  onTapBack() {
    wx.navigateBack();
  },
});
