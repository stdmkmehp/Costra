# Costra 任务看板

> 由 PM-Agent 维护，所有 Agent 可读，状态流转必须经过 Orchestrator。
> 约定流转：`Backlog → Todo → Doing → Review → Done`，Blocked 为横向态。

最后更新：`2026-04-21 13:00`（v0.2 平台切换至微信小程序）

---

## 🗂 Backlog（需求池，详见 backlog.json）
- Epic-A 账号体系（微信登录）
- Epic-B 单人记账
- Epic-C 本地存储 + 云同步
- Epic-D 家庭共享（邀请码 + 微信分享 + 订阅消息）
- Epic-E 预算 / 周期账单
- Epic-F 统计报表
- Epic-G 上线与运营（微信审核 / 分阶段发布）

## 📋 Todo（Sprint-1 候选）
- [ ] COSTRA-001 项目章程与目标对齐                               @PM-Agent      P0
- [ ] COSTRA-002 PRD v0.1（MVP 范围 · 小程序版）                  @PM-Agent      P0
- [ ] COSTRA-003 技术栈 ADR（小程序/后端/DB/CI）                   @PM-Agent      P0
- [ ] COSTRA-010 信息架构 + 用户故事地图                          @Design-Agent  P0
- [ ] COSTRA-011 设计系统 v0.1（WeUI token / 分享卡片）           @Design-Agent  P0
- [ ] COSTRA-020 OpenAPI v0.1（wx.login + 记账核心）              @Backend-Agent P0
- [ ] COSTRA-021 DB Schema v1 + Docker Compose 本地环境           @Backend-Agent P0
- [ ] COSTRA-030 小程序工程骨架（MINA + TS + 分包 + ESLint）      @MiniApp-Agent P0
- [ ] COSTRA-040 CI/CD 流水线（GitHub Actions + miniprogram-ci）  @DevOps-Agent  P0
- [ ] COSTRA-050 测试策略 + 冒烟用例模板（含微信审核自查）        @QA-Agent      P1

## 🔄 Doing
_（空）_

## 👀 Review（待人工/跨 Agent 审核）
_（空）_

## 🚧 Blocked
_（空）_

## ✅ Done
_（空）_

