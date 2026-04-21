# Costra 项目章程（Charter）

> 这是 Orchestrator 与 PM-Agent 的"第一输入"。Human 填完此文档后，Sprint-0 才真正开始。
>
> **v2.0（2026-04-21）**：发布平台由 iOS 原生改为微信小程序，相关章节已同步（见 `ADR-0003`）。
> **v2.1（2026-04-21 PM）**：Sprint-0 COSTRA-001 补齐团队编制、里程碑、外部资源待填项、依赖与签字栏。

## 1. 项目名与寓意
**Costra** = cost + track，面向家庭的云端共享记账 **微信小程序**。

## 2. 愿景
让一个家庭在同一本账上安心协作记账：数据安全、实时同步、看得懂、用得爽、进入门槛低（微信内即开即用）。

## 3. 北极星指标（北极 KPI）
- D1 留存 ≥ 40%
- 家庭激活率（3+ 成员） ≥ 15%
- 月人均记账次数 ≥ 30
- 小程序首屏可交互 ≤ 2s（P75）

## 4. MVP 范围（Must-Have）
- [M] 账号体系（微信登录 `wx.login` + 可选手机号绑定）
- [M] 单人记账（账户 / 分类 / 流水 / 基础统计）
- [M] 本地缓存（`wx.storage` 封装）+ 云端增量同步
- [M] 家庭创建 / 邀请（邀请码 + 微信群分享卡片）/ 成员权限
- [M] 实时变更推送（`wx.connectSocket` + 订阅消息兜底）
- [M] 隐私合规（微信《用户隐私保护指引》+ ICP 备案 + 类目合规）

## 5. 暂不做（Won't-Have · 首版）
- AI 语音记账
- 账单 OCR
- 独立 App（iOS / Android 原生端）
- 端到端加密账本
- 第三方支付聚合 / 银行卡账单导入
- 理财 / 借贷 / 投资分析（类目合规红线）

## 6. 成功标准
- 微信小程序审核一次通过
- 生产 SLA ≥ 99.9%
- P0 缺陷清零
- 发布后首周家庭创建数 ≥ 1000
- 主包体积 ≤ 2MB、分包总体积 ≤ 20MB

## 7. 约束
- 预算：内部研发
- 团队：**7 个 Agent + 1 位 Human（你）**
  | 角色 | 身份 | 工作区 |
  |---|---|---|
  | Orchestrator | 调度/闸门把关 | `.team/` |
  | PM-Agent | 项目管理/需求入口 | `docs/`、`.team/board.md`、`.team/backlog.json`、`.team/risks.md` |
  | Design-Agent | 交互/视觉/设计系统 | `design/` |
  | MiniApp-Agent | 微信小程序客户端 | `miniapp/` |
  | Backend-Agent | 服务端/API/DB | `server/`、`api/` |
  | DevOps-Agent | CI/CD/监控/发布 | `infra/`、`.github/workflows/` |
  | QA-Agent | 测试策略/自动化/审核自查 | `qa/` |
- 时长：目标 6~9 个月至正式上线（小程序周期可压缩至 4~6 个月，保守区间保留）
- 平台：**仅微信小程序**；H5 分享页、小游戏轻量入口作为二期可选扩展

## 8. 里程碑（顶层计划）

| 里程碑 | 时间（基线） | 出口闸门 | 关键交付 |
|---|---|---|---|
| **M0 · Sprint-0 启动** | 2026-W17（本周） | G1 / G2 / G3 | PRD v0.1、设计系统 v0.1、OpenAPI v0.1、两工程骨架、CI v0 |
| **M1 · 账号 + 单人记账** | Sprint-1~2（~4 周） | G4 | Epic-A + Epic-B 全量合入 main |
| **M2 · 云同步 + 家庭共享** | Sprint-3~4（~4 周） | G4 | Epic-C + Epic-D 联调完成 |
| **M3 · 预算/账单/报表 + 订阅消息** | Sprint-5~6（~4 周） | G4 | Epic-E + Epic-F |
| **M4 · 审核 + 分阶段发布** | Sprint-7（~2 周） | G5 | Epic-G；1%→10%→50%→100% |
| **M5 · 上线观察期** | 发布后 4 周 | — | 稳定性 + 北极星指标首测 |

> 详见 `docs/roadmap.mmd`（由 PM-Agent 在 G1 通过后产出 v0.1 版 gantt）。

## 9. 外部资源清单（⏳ 需 Human 侧申请，阻塞 Sprint-0 多个闸门）

| 资源 | 用途 | 阻塞任务 | 状态 |
|---|---|---|---|
| 微信小程序 AppID（生产） | 登录 + CI 上传 | COSTRA-030 / 040 | ✅ 2026-04-21 提供：`wxf8b0d3e3a83f9941` |
| 微信小程序 AppID（体验） | CI 体验版二维码 | COSTRA-040 | ⏳ 待 Human 填写（若复用生产 AppID，请明确告知 PM-Agent） |
| 企业主体认证 | 类目依赖 | COSTRA-901 | ⏳ 待 Human 填写（主体名称 / 统一社会信用代码） |
| 小程序类目（生活 → 记账工具） | 过审前提 | COSTRA-901 | ✅ 2026-04-21 已选：**生活 → 记账工具** |
| 订阅消息模板 ≥3 个（预算超支 / 家庭成员新增流水 / 周期账单） | Epic-D/E 推送 | COSTRA-203 / 301 / 302 | ⏳ 待 Human 填写 |
| 服务器域名 + ICP 备案 + HTTPS 证书 | 白名单配置 | COSTRA-040 / 021 | ⏳ 待 Human 填写 |
| `miniprogram-ci` robot key（生产 / 预发各 1） | CI 自动上传 | COSTRA-040 | ⏳ 待 Human 填写 |
| 《用户隐私保护指引》上传 | 合规基线 | COSTRA-901 | ⏳ 待 Human 填写 |

> **降级预案**：若 AppID 与 robot key 未到位，COSTRA-030/040 先以本地打包 + 手动导出包验证骨架；体验版二维码自动化延后至 G5 前完成。

## 10. 依赖与假设

- 服务端基础设施假设使用 Docker + K8s（Helm），本地开发用 `docker-compose`（COSTRA-021）。
- 团队默认在同一时区（UTC+8），所有日志/消息时间戳使用 `+08:00`。
- 所有 Agent 操作严格遵守 `.team/agents/COMMON-CONTRACT.md` 的目录权限与闸门规则。

## 11. 风险快照（详见 `.team/risks.md`）

本次章程对齐对风险做一轮刷新：
- 🔴 R-002 同步冲突金额错乱 / R-008 密钥泄漏（均已指派 owner）。
- 🟠 R-001 小程序审核驳回 / R-003 金额精度 / R-004 越权访问 / R-007 域名白名单。
- 🟡 R-005 订阅消息模板 / R-006 主包体积超限。
- 本 Sprint 新增：**R-009 Human 外部资源到位延迟**（见 §9）→ 设降级预案，已登记。

## 12. Human 签字位
- 项目负责人：steve
- 签字日期：**2026-04-21**（G1 通过）
- 备注：签字即视为 Sprint-0 正式开启，PM-Agent 才可将 COSTRA-001 置为 Done。

## 13. 工程约束（2026-04-21 追加，Sprint-0 起全员遵守）

### 13.1 知识来源 · 微信小程序官方文档
- **第一权威**：[微信小程序开发手册](https://developers.weixin.qq.com/miniprogram/dev/framework/)。
- MiniApp-Agent、Design-Agent、QA-Agent 在涉及以下场景时 **必须先查官方文档**，并在 PR 描述 / ADR / 设计稿中引用对应章节链接：
  - MINA 框架、生命周期、页面路由、分包加载（subpackages / preloadRule / 独立分包）
  - 登录与会话（`wx.login` / `code2Session` / `session_key`）
  - 网络请求（`wx.request` 合法域名 / `wx.connectSocket` / downloadFile / uploadFile）
  - 存储（`wx.storage` / 文件系统 / 数据库缓存）
  - UI 组件（WeUI / 原生组件层级 / 自定义组件 / Skyline 渲染引擎）
  - 分享（`onShareAppMessage` / `onShareTimeline` / 分享卡片规范）
  - 订阅消息（`wx.requestSubscribeMessage` / 一次性 vs 长期性模板 / 下发时效）
  - 安全与合规（隐私接口 `PrivacyAuthorize` / `getPrivacySetting` / 2023-09 隐私新规）
  - 性能与体积（主包 ≤ 2MB、分包总 ≤ 20MB、体积分析器、启动耗时）
  - 小程序审核（类目准入、审核自查、违规案例）
- Backend-Agent 暴露给小程序的接口签名/字段必须与官方 SDK 类型一致（如 `encryptedData` / `iv` / `errcode` / `errmsg`）。

### 13.2 代码提交节奏 · 关键节点必须 Git 提交
- **定义"关键节点/功能模块完成"**（任一达成即必须提交）：
  1. 单个 Story（如 STORY-A1、STORY-B2…）的 AC 全部通过；
  2. 单个 ADR 从 Proposed 变更为 Accepted；
  3. 跨 Agent 契约（OpenAPI / DB Schema / 设计 Token）冻结或重大变更；
  4. CI 流水线、基础脚手架、骨架工程初次可运行；
  5. 一次压测 / 审核自查 / 安全扫描跑通；
  6. 闸门 G1~G5 通过或驳回之后。
- **提交规范（Conventional Commits 子集，强制）**：
  ```
  <type>(<scope>): <subject>

  [optional body]
  [optional footer：关联 Story / ADR / 闸门]
  ```
  - `type`：`feat` / `fix` / `refactor` / `chore` / `docs` / `test` / `ci` / `perf` / `revert` / `sprint`
  - `scope`：`miniapp` / `server` / `api` / `infra` / `design` / `qa` / `docs` / `team`
  - `subject`：祈使句 ≤ 72 字，中英皆可，不加句号
  - `footer` 示例：`Refs: STORY-A1, ADR-0004` / `Gate: G1-approved`
- **分支策略（沿用 ADR-0002 + 本次细化）**：
  - `main`：受保护，只接受经 G4 的 PR；
  - `dev`：当前主开发分支（你本地就在这个分支）；
  - 每个 Agent 的功能分支：`feature/<agent>/<COSTRA-ID>-<slug>`，如 `feature/miniapp/COSTRA-030-skeleton`；
  - 合并走 PR，PR 标题 = 最上方 Conventional Commit。
- **每位 Agent 的自检动作**：
  1. 提交前 `git status` 检查只包含自己工作区内的文件；
  2. 在 PR 描述中列出：关联 Story / ADR、闸门影响、测试结论、是否变更 NFR；
  3. 提交后向 `.team/messages/YYYY-MM-DD.jsonl` 写 `status_report` 消息，Orchestrator 才把看板推进到 Review。
- **强制例外**：敏感文件（密钥、真机截图含个人信息、生成的大体积二进制）禁止提交；需要共享请放 `infra/secrets.vault` 或内部对象存储。

> 本节为 Sprint-0 后半段所有任务（COSTRA-010/011/020/021/030/040/050）的前置约束，违反将在 G4 PR Review 被驳回。

---

> 填完本文件后，在主会话发送：
> 「开始 Sprint-0：读 docs/charter.md 和 .team/backlog.json，调度 PM-Agent 完成 COSTRA-001~COSTRA-003；全部通过 G1 闸门后停下等我确认。」
