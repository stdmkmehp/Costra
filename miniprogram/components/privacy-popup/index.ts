// COSTRA-901: 隐私授权弹窗组件
// 微信基础库要求同意操作必须通过 open-type="agreePrivacyAuthorization" 的按钮完成，
// 基础库会校验 buttonId 对应的按钮是否被真实点击，wx.showModal 的 confirm 不符合要求。
//
// 使用方式：
//   在 profile-setup 页面的 onLoad 里注册 wx.onNeedPrivacyAuthorization，
//   回调里找到本组件实例，调用 popup.show(resolve)，组件负责展示弹窗并在用户操作后调用 resolve。

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
    /** 由外部（profile-setup page）调用：传入 onNeedPrivacyAuthorization 的 resolve，显示弹窗 */
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    show(resolve: (opt: any) => void) {
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
      wx.showToast({ title: '已进入只读演示模式', icon: 'none', duration: 2000 });
    },

    /** 跳转查看隐私保护指引 */
    onTapPrivacy() {
      wx.navigateTo({ url: '/pages-family/privacy/index' });
    },
  },
});
