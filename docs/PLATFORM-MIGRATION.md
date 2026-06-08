# Costra 平台迁移说明：iOS 原生 → 微信小程序

- 版本：v1.0
- 日期：2026-04-21
- 决策文件：[`ADR-0003`](../.team/decisions/ADR-0003-platform-change-to-miniprogram.md)
- 技术栈修订：[`ADR-0002`](../.team/decisions/ADR-0002-tech-stack.md)（v2）

---

## 1. 变更范围一览

| # | 维度 | 迁移前（v1） | 迁移后（v2） |
|---|---|---|---|
| 1 | 发布平台 | iOS App Store | 微信小程序（公众平台后台） |
| 2 | 客户端语言 | Swift 5.10 | TypeScript（微信小程序 MINA） |
| 3 | 客户端 UI | SwiftUI + 少量 UIKit | MINA WXML + WeUI + Skyline（可选） |
| 4 | 状态管理 | Combine + ObservableObject | MobX-miniprogram |
| 5 | 本地存储 | GRDB（SQLite） | `wx.setStorageSync` 封装（版本化 / LRU） |
| 6 | 金额计算 | Swift `Decimal` | `decimal.js` |
| 7 | 登录 | Apple ID + 手机号 | `wx.login` + `code2Session` + 可选手机号 |
| 8 | Token 存储 | Keychain | `wx.storage` 封装层（`__costra_token_v1`） |
| 9 | 推送 | APNs | 微信**订阅消息** + 客服消息 |
| 10 | 实时 | WebSocket（URLSession） | `wx.connectSocket`（WSS + 域名白名单） |
| 11 | 工程化 | Tuist + SPM | npm + TypeScript + ESLint + miniprogram-ci |
| 12 | CI/CD | GitHub Actions + Fastlane | GitHub Actions + miniprogram-ci（robot 分角色） |
| 13 | 自动化测试 | XCUITest | `miniprogram-automator` |
| 14 | 崩溃/异常 | Crashlytics | 微信小程序后台 JS 异常 + `wx.onError / onUnhandledRejection` |
| 15 | 灰度策略 | App Store Connect 阶段发布 | 微信后台**分阶段发布** 1%→10%→50%→100% + 版本回退 |
| 16 | 合规 | iOS 隐私清单 PrivacyInfo | 微信《用户隐私保护指引》+ `privacy_*` 接口声明 + ICP 备案 |
| 17 | 设计规范 | Apple HIG 2026 | 微信小程序设计指南 + WeUI Design Token |
| 18 | 目录 | `ios/` | `miniapp/` |
| 19 | Agent | `iOS-Agent`（`03-ios-agent.md`） | `MiniApp-Agent`（`03-miniapp-agent.md`） |
| 20 | G5 闸门 | App Store 提审 + 灰度 | 微信审核提交 + 分阶段发布各档 + 版本回退 |

---

## 2. 已完成的仓库变更（checklist）

### 2.1 架构 / 决策类

- [x] `COSTRA-BLUEPRINT.md` 全文重写为 v2.0（含架构图、闸门、路线图）
- [x] `.team/decisions/ADR-0002-tech-stack.md` 重写（v2，小程序版技术栈）
- [x] `.team/decisions/ADR-0003-platform-change-to-miniprogram.md` 新增
- [x] `docs/PLATFORM-MIGRATION.md` 新增（本文件）

### 2.2 Agent 体系

- [x] `.team/agents/COMMON-CONTRACT.md`：目录权限表、闸门表、双签名称全部替换
- [x] `.team/agents/00-orchestrator.md`：闸门判断、越权清单中 `ios/` → `miniapp/`
- [x] `.team/agents/01-pm-agent.md`：禁止清单、G5 评审内容更新
- [x] `.team/agents/02-design-agent.md`：HIG → WeUI，新增分享卡片 / 订阅消息模板文案产物
- [x] `.team/agents/03-ios-agent.md` 删除 → 新建 `.team/agents/03-miniapp-agent.md`
- [x] `.team/agents/04-backend-agent.md`：新增 `wx.login/code2Session` 契约、session_key 安全约束
- [x] `.team/agents/05-devops-agent.md`：Fastlane → miniprogram-ci，新增微信后台域名白名单与版本发布 SOP
- [x] `.team/agents/06-qa-agent.md`：XCUITest → miniprogram-automator，新增兼容矩阵 / 微信审核自查清单 / 五张签字单

### 2.3 目录与工作区

- [x] `ios/` 目录删除
- [x] `miniapp/` 目录创建 + `miniapp/README.md` 给出建议目录结构与初始化命令

### 2.4 文档与看板

- [x] `README.md`：项目简介、目录、v2 变更说明
- [x] `docs/charter.md`：平台 / MVP / 成功标准 / 团队编制更新
- [x] `docs/PRD.md`：版本指向 v0.1（小程序 MVP）
- [x] `.team/backlog.json`：版本升级到 v0.2.0，Epic-A/D/G 等故事描述全部同步
- [x] `.team/board.md`：Todo 列的任务卡措辞与 @Assignee 更新
- [x] `.team/START-HERE.md`：Team Mode 角色表、串行模拟步骤更新
- [x] `.team/risks.md`：苹果相关风险下架，新增小程序审核/域名/session_key/体积等 4 项

---

## 3. 仍需后续 Sprint-0 执行的落地项

> 这些属于 Sprint-0 各 Agent 的一次性初始化动作，需通过 Orchestrator 分派、过 G1/G2/G3 闸门。

### 3.1 账号与资质（DevOps + PM）
- [ ] 申请小程序 `appid`（生产 / 体验 / 开发三套，至少生产 + 体验）
- [ ] 设置小程序类目（建议：生活服务 → 记账工具）
- [ ] ICP 备案 + 企业主体资质核验
- [ ] 上传隐私协议 + 《用户隐私保护指引》到小程序后台
- [ ] 配置服务器域名白名单（request / socket / upload / download）
- [ ] 申请订阅消息模板（至少 3 个：预算超支提醒 / 家庭成员新增流水 / 周期账单生成）
- [ ] 创建 `miniprogram-ci` robot key 并存入 Vault（生产 / 预发分开）

### 3.2 工程骨架（MiniApp-Agent）
- [ ] 按 `miniapp/README.md` 初始化 npm 项目、TypeScript 配置、ESLint、Prettier
- [ ] 建立 `app.json` 主包 + 3 个分包（`packageStat` / `packageFamily` / `packageReport`）
- [ ] 接入 MobX-miniprogram + decimal.js + miniprogram-simulate + miniprogram-automator
- [ ] 接入 `app.json` 的 `permission` / `requiredPrivateInfos` 声明
- [ ] 设计 token SCSS 变量，对齐 `design/design_system.json`

### 3.3 设计体系（Design-Agent）
- [ ] `design/design_system.json` 按 WeUI token 重建
- [ ] 关键页面 specs（首页 / 记一笔 / 家庭邀请 / 年度报告）增加"授权未授予 / 弱网加载"状态
- [ ] 输出微信生态专属物：分享卡片（5:4）、朋友圈分享图、订阅消息文案

### 3.4 后端契约（Backend-Agent）
- [ ] `api/openapi.yaml` 重写登录相关接口：
  - `POST /v1/auth/wechat/login`：入参 `code`（来自 `wx.login`），回业务 Token；服务端内部对接 `code2Session`
  - `POST /v1/auth/phone/bind`：入参 `encryptedData` + `iv`（来自 `wx.getPhoneNumber`）
  - `POST /v1/auth/token/refresh`
- [ ] 订阅消息下发接口：`POST /v1/notify/subscribe-message/send`
- [ ] DB Schema 删除 `apple_id` 字段，新增 `wx_openid`（unique）、`wx_unionid`（nullable）

### 3.5 CI/CD（DevOps-Agent）
- [ ] `.github/workflows/miniprogram-ci.yml`：push → build → `miniprogram-ci upload --robot=1` → 产出二维码 artifact
- [ ] `.github/workflows/server-ci.yml`：复用原有，仅调整触发路径到 `server/**`
- [ ] 合并前体积门禁：主包 ≤ 2MB 强校验
- [ ] 新建 `infra/wechat/` 目录，登记 `domains.md` / `subscribe-templates.md` / `ops-log.md`

### 3.6 测试体系（QA-Agent）
- [ ] `qa/strategy.md` 更新到小程序口径
- [ ] `qa/automation/` 下新建 `miniprogram-automator` 脚本骨架
- [ ] 新建 `qa/checklists/wechat-review.md`（基于微信《小程序审核指南》+ 隐私检查项）
- [ ] 接口测试 Newman 集合不变，但需把 mock 用户换为 openid 体系

---

## 4. 兼容性与历史资料处置

- 旧的 Swift/iOS 相关构思不再纳入主线，但**不删除原有讨论记录**（`.team/messages/*`、`.team/decisions/` 历史）以满足审计追溯。
- 如未来需要 iOS 原生版本（见 ADR-0003 §"回滚条件"），可再起 `ADR-0004` 决策，并复用大部分后端资产。

---

## 5. 验收口径（本次迁移本身）

- [x] 仓库中不再存在 `ios/` 目录
- [x] 全库搜索 `iOS-Agent` 仅出现在 ADR-0003 / PLATFORM-MIGRATION.md / v1 历史说明上下文中
- [x] 全库搜索 `App Store` / `Fastlane` / `GRDB` / `SwiftUI` 仅出现在迁移说明和 ADR-0003 中
- [x] 每个 Agent 文档中对应目录 / 工具链 / DoD 均已更新
- [x] `backlog.json` 中 Epic-A/D/G 的文案全部无 iOS 痕迹
- [x] `COSTRA-BLUEPRINT.md` 的三张图（架构图、协作时序、路线图）全部反映新平台
