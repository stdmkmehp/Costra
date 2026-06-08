// COSTRA-901: 隐私授权弹窗组件
// 微信基础库要求同意操作必须通过 open-type="agreePrivacyAuthorization" 的按钮完成，
// 基础库会校验 buttonId 对应的按钮是否被真实点击，wx.showModal 的 confirm 不符合要求。
//
// 使用方式：
//   1) profile-setup onLoad 主动调用 wx.getPrivacySetting；needAuthorization=true 时 popup.show()
//   2) 同时注册 wx.onNeedPrivacyAuthorization；被动触发时 popup.show(resolve)
//   组件负责展示弹窗，并在用户操作后调用 resolve（若存在）。

interface AppWithPrivacy {
  globalData: { privacyAuthorized?: 'granted' | 'denied' };
}

Component({
  properties: {},

  data: {
    visible: false,
  },

  lifetimes: {
    attached() {
      // 初始化 _resolve（TypeScript 不允许在 Component 顶层声明实例属性）
      (this as any)._resolve = undefined;
    },
  },

  methods: {
    /** 由外部（profile-setup page）调用：resolve 仅在 onNeedPrivacyAuthorization 被动触发时存在 */
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    show(resolve?: (opt: any) => void) {
      (this as any)._resolve = resolve;
      this.setData({ visible: true });
    },

    /** 用户点击"同意"按钮后微信回调（open-type="agreePrivacyAuthorization"） */
    onAgree() {
      this.setData({ visible: false });
      const app = getApp<AppWithPrivacy>();
      app.globalData.privacyAuthorized = 'granted';
      const resolve = (this as any)._resolve;
      if (resolve) {
        resolve({ buttonId: 'agree-privacy-btn', event: 'agree' });
        (this as any)._resolve = undefined;
      }
    },

    /** 用户点击"拒绝" */
    onTapReject() {
      this.setData({ visible: false });
      const app = getApp<AppWithPrivacy>();
      app.globalData.privacyAuthorized = 'denied';
      const resolve = (this as any)._resolve;
      if (resolve) {
        resolve({ event: 'disagree' });
        (this as any)._resolve = undefined;
      }
      this.triggerEvent('reject');
    },

    /** 跳转查看隐私保护指引：优先打开微信后台配置的官方指引，失败则回落本地页面 */
    onTapPrivacy() {
      if (typeof wx.openPrivacyContract === 'function') {
        wx.openPrivacyContract({
          fail: () => wx.navigateTo({ url: '/pages-family/privacy/index' }),
        });
        return;
      }
      wx.navigateTo({ url: '/pages-family/privacy/index' });
    },
  },
});
