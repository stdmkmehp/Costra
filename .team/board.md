# Costra 任务看板

> 由 PM-Agent 维护，所有 Agent 可读，状态流转必须经过 Orchestrator。
> 约定流转：`Backlog → Todo → Doing → Review → Done`，Blocked 为横向态。

最后更新：`2026-04-21 15:25`（Orchestrator · G1 通过 / COSTRA-001~003 置 Done / Sprint-0 后半段可分派）

---

## 🗂 Backlog（需求池，详见 backlog.json）
- Epic-A 账号体系（微信登录）
- Epic-B 单人记账
- Epic-C 本地存储 + 云同步
- Epic-D 家庭共享（邀请码 + 微信分享 + 订阅消息）
- Epic-E 预算 / 周期账单
- Epic-F 统计报表
- Epic-G 上线与运营（微信审核 / 分阶段发布）

## 📋 Todo（Sprint-0 后半段 · G1 后可分派）
- [ ] COSTRA-010 信息架构 + 用户故事地图                          @Design-Agent  P0  🔓 可开工
- [ ] COSTRA-011 设计系统 v0.1（WeUI token / 分享卡片）           @Design-Agent  P0  🔓 可开工
- [ ] COSTRA-020 OpenAPI v0.1（wx.login + 记账核心）              @Backend-Agent P0  🔓 可开工
- [ ] COSTRA-021 DB Schema v1 + Docker Compose 本地环境           @Backend-Agent P0  🔓 可开工
- [ ] COSTRA-030 小程序工程骨架（MINA + TS + 分包 + ESLint）      @MiniApp-Agent P0  ⚠️ 需 AppID（已提供 `wxf8b0d3e3a83f9941`）
- [ ] COSTRA-040 CI/CD 流水线（GitHub Actions + miniprogram-ci）  @DevOps-Agent  P0  🚧 Blocked：等 robot key / 备案域名
- [ ] COSTRA-050 测试策略 + 冒烟用例模板（含微信审核自查）        @QA-Agent      P1  🔓 可开工

## 🔄 Doing
_（空，等 Human 确认下一棒分派）_

## 👀 Review
_（空）_

## 🚧 Blocked
- [B] COSTRA-040 CI/CD 生产上传 → 待 Human 提供 `miniprogram-ci` robot key（生产/预发各 1）、服务器域名 + ICP 备案 + HTTPS 证书（charter §9）

## ✅ Done
- [D] COSTRA-001 项目章程与目标对齐   @PM-Agent   · 2026-04-21 G1 通过 · charter.md v2.2
- [D] COSTRA-002 PRD v0.1（MVP · 小程序版）   @PM-Agent   · 2026-04-21 G1 通过 · docs/PRD.md
- [D] COSTRA-003 技术栈 ADR 评审（ADR-0002/0003 维持 + ADR-0004 新增）   @PM-Agent   · 2026-04-21 G1 通过

---

## 🚦 闸门状态

| 闸门 | 状态 | 发起者 | 链接 |
|---|---|---|---|
| **G1 PRD** | ✅ **Approved** · 2026-04-21 15:22 | PM-Agent | `docs/PRD.md` v0.1 |
| G2 设计 | ⬜ 未开始（待 Design-Agent 提交 COSTRA-010/011） | Design-Agent | — |
| G3 契约 | ⬜ 未开始（待 Backend-Agent 提交 COSTRA-020/021） | Backend-Agent | — |
| G4 合并 | ⬜ 未开始 | — | — |
| G5 发布 | ⬜ 未开始 | DevOps-Agent | — |

---

## 📌 外部资源进度（charter §9 同步）

| 资源 | 状态 |
|---|---|
| 微信小程序 AppID（生产） | ✅ `wxf8b0d3e3a83f9941` |
| 小程序类目 | ✅ 生活 → 记账工具 |
| 微信小程序 AppID（体验） | ⏳ 待 Human（若复用生产请告知） |
| 企业主体认证 | ⏳ 待 Human |
| 订阅消息模板 ×3 | ⏳ 待 Human |
| 服务器域名 + ICP + HTTPS | ⏳ 待 Human（阻塞 COSTRA-040 生产链路） |
| `miniprogram-ci` robot key | ⏳ 待 Human（阻塞 COSTRA-040 生产链路） |
| 《用户隐私保护指引》 | ⏳ 待 Human |

---

## 🧭 下一棒分派建议（Orchestrator 视角）

**并行**：
- Design-Agent → COSTRA-010 + COSTRA-011（依赖：PRD v0.1 ✅）
- Backend-Agent → COSTRA-020 + COSTRA-021（依赖：PRD + ADR-0004 ✅）
- MiniApp-Agent → COSTRA-030 骨架（依赖：生产 AppID ✅、Design 产物可延后替换）
- QA-Agent → COSTRA-050 测试策略（依赖：PRD ✅）

**串行后置**：
- DevOps-Agent → COSTRA-040 CI/CD（依赖：骨架 + robot key + 域名）

> 以上分派**等 Human 确认**后由 Orchestrator 下发。
