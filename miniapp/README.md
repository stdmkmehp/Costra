# miniapp/（MiniApp-Agent 工作区）

本目录承载 **Costra 微信小程序** 的源代码与构建产物。

## 建议结构（Sprint-0 由 MiniApp-Agent 生成）

```
miniapp/
├── project.config.json          微信开发者工具主配置（appid / 编译选项）
├── project.private.config.json  本地开发者私有配置（robot / 忽略 git）
├── app.json                     小程序全局配置（pages / tabBar / 分包 / permission / requiredPrivateInfos）
├── app.ts / app.less            全局入口
├── sitemap.json                 搜索收录规则
├── src/
│   ├── pages/                   主包页面（登录 / 首页 / 记一笔 / 账户 / 我的）
│   ├── packageStat/             分包：统计（饼图 / 趋势）
│   ├── packageFamily/           分包：家庭共享（邀请码 / 成员管理）
│   ├── packageReport/           分包：年度报告（分享卡片 / H5 风格）
│   ├── components/              公共业务组件（WeUI 扩展）
│   ├── stores/                  MobX Store
│   ├── services/                业务编排（登录 / 同步 / 订阅消息）
│   ├── api/                     `openapi.yaml` 生成的 TS Client
│   ├── utils/                   decimal / storage 封装 / request 拦截
│   └── theme/                   design token（SCSS 变量）
├── tests/                       Jest + miniprogram-simulate 单测
├── automation/                  miniprogram-automator 端到端脚本
├── build/                       CI 产物（体验版二维码 / 版本号）
└── docs/
    └── architecture.md
```

## 初始化命令（待 Sprint-0 执行）

```powershell
cd h:/Costra/miniapp
npm init -y
npm i -D typescript @types/wechat-miniprogram miniprogram-api-typings ^
         eslint prettier jest miniprogram-simulate miniprogram-automator ^
         miniprogram-ci decimal.js mobx-miniprogram mobx-miniprogram-bindings
# 微信开发者工具中导入本目录，AppID 填占位，待 DevOps 申请正式 AppID
```

## 重要约束（见 `.team/agents/03-miniapp-agent.md`）

- 主包 ≤ 2MB
- 所有网络域名必须在微信公众平台后台配置为服务器域名
- 金额禁止使用 `Number`，统一 `decimal.js`
- Token 存 `wx.storage` 封装层（key: `__costra_token_v1`），不落明文
- 所有隐私接口必须在 `app.json` 声明并在《隐私保护指引》中登记
