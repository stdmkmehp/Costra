# ADR-0003：发布平台从 iOS 原生切换至微信小程序

- 状态：Accepted
- 日期：2026-04-21
- 决策人：Human（项目负责人）+ PM-Agent
- 关联：[`ADR-0002`](./ADR-0002-tech-stack.md)（技术栈已同步重写）

## 背景

项目初版规划以 iOS 原生 App 形式上线（详见 v1 Blueprint 与 v1 ADR-0002），原因是"原生性能更好、隐私掌控力强、Apple 用户画像契合家庭记账目标用户"。

在 2026-04-21 领导层评审中，基于以下综合因素决定将**发布平台从 iOS 改为微信小程序**，并保留后续以 H5 / 小游戏入口延展的空间：

1. **触达成本**：微信是家庭共享记账的天然场景（群分享、邀请码、订阅消息），微信小程序即开即用，冷启动门槛远低于独立 App。
2. **传播效率**：家庭成员拉新依赖"微信群分享卡片 / 聊天面对面分享"，在独立 App 上需走 App Store 跳转，转化漏斗损失严重。
3. **研发成本**：原生端需要 Swift 开发 + Apple 账号 + TestFlight + App Store 审核 + Fastlane 签名链路；小程序只需一套 MINA + miniprogram-ci，团队编制可缩减。
4. **合规与审核**：Apple 对家庭共享/隐私/账号删除等要求严格；微信审核周期虽紧但流程清晰，Costra 作为"生活 → 记账工具"类目风险可控。
5. **后续扩展**：Android / H5 / 小游戏轻版本均可基于小程序能力无缝扩展；若未来确有必要再做原生端，可用 uni-app / Taro 做反向同构。

## 决策

1. **发布目标**：Costra 首版在**微信小程序**平台发布，不再走 iOS App Store。
2. **技术栈**：按 [`ADR-0002`](./ADR-0002-tech-stack.md)（v2）全面切换至 MINA + TypeScript + WeUI + miniprogram-ci。
3. **目录迁移**：仓库 `ios/` 目录整体迁移至 `miniapp/`；`iOS-Agent` 系统提示词替换为 `MiniApp-Agent`（详见 `.team/agents/03-miniapp-agent.md`）。
4. **Agent 契约**：`.team/agents/COMMON-CONTRACT.md` 的目录权限表同步更新（`iOS-Agent → miniapp/` 替换为 `MiniApp-Agent → miniapp/`）。
5. **发布流程**：
   - G5 闸门改为"提交微信审核"+"分阶段发布（1%→10%→50%→100%）"+"版本回退"三类审批点。
   - DevOps 的 Fastlane/TestFlight 流水线撤除，替换为 miniprogram-ci 上传、预览、提审、发布脚本。
6. **推送机制**：APNs 远程推送替换为微信**订阅消息**（用户一次授权多次下发）+ 客服消息兜底。
7. **合规基线**：以《微信小程序用户隐私保护指引》+ ICP 备案 + 类目合规 + 数据跨境说明构成 Sprint-0 强制交付项。

## 影响范围

| 类别 | 变更项 | 影响 |
|---|---|---|
| 架构 | 客户端从 Swift/SwiftUI 改为 MINA/TS | 全部客户端代码重做 |
| 目录 | `ios/` → `miniapp/` | 所有引用同步修改 |
| Agent | `iOS-Agent` → `MiniApp-Agent` | `03-*.md` 重写 |
| 登录 | Apple ID + 手机号 → `wx.login` + 可选手机号 | Backlog Epic-A 调整 |
| 推送 | APNs → 订阅消息 | Backlog Epic-D 的 `COSTRA-203` 契约改变 |
| 发布 | App Store 提审 → 微信审核 | Backlog Epic-G 两个 Story 重写 |
| CI/CD | Fastlane / Xcode → miniprogram-ci | DevOps 流水线重做 |
| 测试 | XCUITest → miniprogram-automator | QA 自动化重做 |
| 设计 | Apple HIG → WeUI + 微信小程序设计指南 | 设计系统 v0.1 重做 |
| 监控 | Crashlytics → 微信小程序后台 JS 异常 + 自建 APM | DevOps 面板重做 |

完整迁移执行清单见 [`docs/PLATFORM-MIGRATION.md`](../../docs/PLATFORM-MIGRATION.md)。

## 替代方案（被拒绝）

- **A. 双端并行（iOS + 小程序）**：拒绝。团队规模 1 Human + 7 Agent，双端并行会稀释资源，错失验证窗口。
- **B. uni-app / Taro 一套代码多端**：拒绝（首版）。跨端框架在微信生态的 API 覆盖、审核兼容、性能调优上存在隐性成本；MVP 阶段选择原生 MINA 最稳。未来若要 Android/H5，再评估引入。
- **C. H5 作为 MVP 载体**：拒绝。H5 在微信内受限，支付、订阅消息、分享能力均不如小程序；且无离线能力。

## 后果

### 正面
- 冷启动周期缩短 ~2 个月（免 Apple 账号/签名/TestFlight 流程）。
- 传播和家庭共享路径短平快，北极星指标"家庭激活率"更易达成。
- 团队学习曲线更平缓，MiniApp-Agent 技术栈更常见。

### 负面 / 需管控
- 受微信平台能力边界约束（体积、API、审核节奏），需要 DevOps 维护"平台变更监听"机制。
- 无法提供 iOS 系统级推送/Widget/灵动岛 体验，用户感知较"APP 感"弱。
- 微信审核存在不可控驳回风险 → QA 侧增加"微信审核自查清单"。

## 回滚条件

若上线 6 个月内出现以下情况之一，可发起 ADR-0004 讨论反向切回原生：
1. 微信审核持续驳回不可解（累计 ≥ 3 次）。
2. 平台强制下架风险（类目合规变更）。
3. 核心用户反馈"需要 Widget / 推送 / 后台任务"比例 ≥ 30%。

## 执行落地

- [x] 重写 `COSTRA-BLUEPRINT.md` → v2
- [x] 重写 `.team/decisions/ADR-0002-tech-stack.md` → v2
- [x] 新增 `.team/decisions/ADR-0003-platform-change-to-miniprogram.md`（本文件）
- [x] 重写 `.team/agents/03-miniapp-agent.md`（替换 `03-ios-agent.md`）
- [x] 同步更新 Orchestrator / PM / Design / Backend / DevOps / QA / COMMON-CONTRACT
- [ ] 目录 `ios/` → `miniapp/`（含 README 兜底说明）
- [ ] `docs/charter.md` / `README.md` / `backlog.json` / `board.md` / `START-HERE.md` / `risks.md` 同步
- [ ] 新增 `docs/PLATFORM-MIGRATION.md` 迁移执行清单
