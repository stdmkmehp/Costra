# ADR-0002：技术栈选型（微信小程序版）

- 状态：Accepted（v2, 2026-04-21 修订）
- 原始版本：2026-04-20（iOS 原生版）
- 本次修订：2026-04-21，配合 [`ADR-0003`](./ADR-0003-platform-change-to-miniprogram.md) 的平台变更

## 背景

原技术栈面向 iOS 原生（Swift/SwiftUI/GRDB/Fastlane），因业务决策平台切换为微信小程序，本文件整体重写客户端侧选型；后端侧技术栈保持不变，仅在"登录鉴权"与"推送通道"上做适配。

## 决策

| 层 | 选型 | 关键理由 |
|---|---|---|
| 客户端框架 | 微信小程序原生 MINA + TypeScript | 与微信生态 API 最贴合，无跨端框架损耗，审核通过率最高 |
| 渲染引擎 | WebView（默认） + Skyline（重动画页渐进启用） | 兼容面广 + 性能可选 |
| 客户端样式 | WeUI + 自定义设计 token（SCSS 变量） | 对齐微信视觉规范，降审核风险 |
| 状态管理 | MobX-miniprogram | 与原生 Page/Component 集成好，轻量 |
| 客户端架构 | Page/Component → Store → Service → API | 可测试、易维护，Service 层承接同步/离线 |
| 本地存储 | `wx.setStorageSync` 封装 + 版本化结构 | 小程序官方能力，稳定；单 key ≤1MB / 总 ≤10MB |
| 客户端金额 | `decimal.js`（**严禁 `Number`**） | 防精度丢失 |
| 客户端工程化 | npm / TypeScript / ESLint / Prettier / miniprogram-ci | CLI 可打包上传，适合 CI |
| 端侧测试 | Jest + `miniprogram-simulate` + `miniprogram-automator` | 单测 + 端到端 |
| 后端语言 | Go 1.22+ | 高并发、部署简单 |
| 后端框架 | Gin + gRPC | REST 对外 / gRPC 内部 |
| 登录鉴权 | `wx.login → code2Session`（服务端保存 session_key）+ 业务 JWT | 小程序官方登录链路，`session_key` 禁止下发 |
| 主存储 | MySQL 8.0（DECIMAL(18,4) 存金额） | 事务 |
| 缓存 | Redis 7 | 会话 / 同步游标 / 热点 |
| 消息 | Kafka | 异步解耦 |
| 对象存储 | 腾讯云 COS + CDN（加入微信白名单） | 小票图片 / 年度报告分享图 |
| 推送 | 微信**订阅消息**（一次授权多次下发） + 客服消息（48h） | 原生 APNs 已不适用 |
| 实时 | `wx.connectSocket` 走 WSS（域名加白） | 家庭实时同步 |
| CI/CD | GitHub Actions + `miniprogram-ci` | 自动打包 / 体验版二维码 / 提审机器人钥匙分 robot 管理 |
| 部署 | Docker + K8s (Helm) | 灰度 + 回滚 |
| 监控 | Prometheus + Grafana + AlertManager + 微信小程序后台（JS 异常、性能、实时日志） | 指标 + 告警 |
| APM | SkyWalking / 自建 | 链路追踪 |

## 硬性约束
- **金额字段绝不使用 float / double / JS `Number`**，全链路 `DECIMAL(18,4)` ↔ `decimal.js` ↔ `decimal.Decimal`。
- **小程序平台红线**：
  - 主包 ≤ 2MB；超出拆分包或分包预下载。
  - 所有网络域名必须在微信公众平台"服务器域名白名单"配置（request / socket / upload / download 分开）。
  - 隐私接口（`wx.getUserProfile` / `wx.getPhoneNumber` / `wx.getLocation` / `wx.chooseMedia` 等）必须在 `app.json` 声明 + 《用户隐私保护指引》覆盖 + 首用弹 `wx.requirePrivacyAuthorize`。
  - 严禁使用未上架的插件；严禁诱导分享；严禁金融类/虚拟货币/政治敏感内容（注意 Costra 类目定位为"生活 → 记账工具"，非金融）。
- **安全**：
  - `session_key` / `appsecret` 仅服务端持有，KMS/Vault 管理，绝对禁止下发。
  - 业务 Token 存 `wx.storage` 封装层，key 统一 `__costra_token_v1`；敏感值不打 log。
  - 生产禁止明文密码，bcrypt + salt（若有账号密码登录场景，MVP 暂不提供）。
  - 所有对外接口 HTTPS；服务端对 `X-Forwarded-For` / `openid` 做伪造防护。
- **合规**：
  - ICP 备案 + 小程序后台类目提交 + 隐私协议页面 + 数据跨境合规说明。
  - 家庭成员数据共享需获得**二次同意**（首次邀请页面 + 首次查看他人数据弹层）。
