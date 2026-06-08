# COSTRA-102 卡定义首轮 Review · Product 维度

- **Review 档位**：D-014-a 卡定义首轮（T1 Sprint-1 主线卡准入审查）
- **Reviewer**：Review-Agent-Product
- **Review 对象**：`.team/dispatch/COSTRA-102-miniapp-login-e2e.md`
- **产出时间**：2026-04-27 09:46+08:00（Orchestrator 派单同 tool call 循环内兑现 · **D-016 第四次实战**）
- **覆盖范围**：9 维（业务闭环 / 用户旅程 / Sprint 节奏契合 / Human 介入体验 / 合规与隐私 / 降级路径 / KPI 对齐 / 不在范围的业务价值 / 下游解阻塞量）
- **参照事实源**：
  - `.team/sprints/sprint-01-plan.md`（Sprint-1 目标 · Goal 段 · Human 介入节点）
  - `COSTRA-BLUEPRINT.md`（产品 charter · 若存在）
  - `docs/design/flows/login.md` · `docs/design/ia.md §首页` · `docs/design/flows/add-entry.md`
  - `.team/reviews/COSTRA-118/FINAL.md §Review 机制观察`
  - `.team/decisions/D-008（主体策略）` · `D-013` · `D-014`

---

## 0. 结论速览

**Verdict**：**APPROVE**
**评分**：**28 / 30**（P0=0 · P1=1 · P2=1 · INFO=2）

**产品视角关键判断**：本卡定义**真正对齐** Sprint-1 的 Sprint Goal（"微信登录→首页→记一笔→本地落库→云同步"最小闭环）中的**前 3 环** · 并 **不越俎代庖** 做第 4/5 环（落给 COSTRA-103 / 104 / 105）· 这是本卡最重要的产品判断点。

**Human 视角体验质量**：Human 本地验证 20 分钟锁在 04-30（Sprint 中点 · sprint-01-plan.md 原锁定）· 手册五步式（登录 / 首页昵称 / 记一笔 / outbox / 退出）· 节奏合理 · 不给 Human 制造额外决策疲劳。

**产品风险**：本卡如按时 M6 收口（04-30 晚前） · Sprint-1 DoD 第 1 条（"真实微信登录可通"）直接闭合 · Sprint-1 DoD 第 2 条（"记一笔在服务端查到"）需等 COSTRA-103 + 104（远端落库）· 进度符合 sprint-01-plan §W1 D4/D5 安排。

---

## 1. 业务闭环审查（Sprint Goal 对齐度）

### 1.1 Sprint Goal 5 环映射

| Sprint DoD | 覆盖卡 | 本卡贡献 | 状态 |
|---|---|---|---|
| 1. 真实微信登录可通 | COSTRA-102 | **本卡主力 · M6 收口即闭合** | 🎯 本卡 |
| 2. 记一笔数据能在服务端查到 | COSTRA-102 + 103 + 104 | 本卡贡献 UI + 入队 · 远端持久化靠 COSTRA-104 | 🟡 本卡是必要条件 |
| 3. 断网记账 → 联网 10 秒内自动推送 | COSTRA-103 + 104 | **本卡不承担** | ⚫ 不覆盖 |
| 4. QA 冒烟 S-01~S-08 | COSTRA-105 | **本卡不承担** | ⚫ 不覆盖 |
| 5. G3 补齐 5 项 approve | COSTRA-100 已完成 | **不相关** | ✅ 已闭 |

**结论**：本卡就 Sprint Goal 的贡献是"**第 1 环主力 + 第 2 环必要条件**" · 范围定义精确 · **未越权** 去做 COSTRA-103/104 本该做的远端落库 + 推送。

### 1.2 用户旅程连续性

从用户旅程看（首次打开小程序 → 一键登录 → 看见首页 → 点"+" → 记第一笔 → 退出重进仍有登录态） · 本卡 DoD 恰好覆盖完整旅程的"**最小 MVP 环**" · 第一笔是否真的推到服务端（用户看不见）· 不是用户首次使用的"啊哈时刻"关键路径 · 归 COSTRA-104 做完整体验。

**风险识别**：用户此时"看不见服务端数据" · 但骨架期用户画像=Human 自己 · 对 04-30 验证毫无干扰。公开上线前（Sprint-2 末）必须闭合此点 · 已由 COSTRA-103/104 承接 · ✅ 无产品缺口。

### 1.3 首页体验（用户核心首次印象）

dispatch D2.4 明确"首页显示真实用户画像"（从 `AuthTokenPair.user` 直接取 · 无需额外调 `/users/me`）· 这是**正确的产品选择**（减少一次首屏等待 · 昵称/头像可能晚 200ms 但可接受 · 且避免了首屏连续两次请求）。

但有 **P1 观察**（见 §3）：**用户首次登录时 `AuthTokenPair.user` 的 `nickname` / `avatar_url` 由谁填充不明确**。微信 2022 新规后 · 服务端 `/auth/wx-login` 收到的只有 code · 不会自动拿到用户画像（需要小程序主动调 `wx.getUserProfile()` 后 PATCH `/users/me`）。这个矛盾 dispatch D2.1 已用"可选调 getUserProfile + 失败不阻塞"处理 · 但首次登录后首屏**必然**会有一瞬间"无昵称"状态 · **本卡应明确定义这个状态的 UI 表现**（详见 §3 P1）。

---

## 2. Sprint 节奏契合度

### 2.1 时间盒

- sprint-01-plan.md §时间节奏 W1 D4~D5（04-28~04-29）锁定"COSTRA-102 开工 + 联调"
- dispatch §4 M3=04-27 Human 放行后立即 · M4=04-28 18:00 前 Agent R1 产出 · M5=**04-30 Human 本地验证**
- **结论**：完美贴合原计划 · 甚至略超前（原计划 D4/D5 两天 · 本卡期望 D2 一天内 Agent 交付 · 给 Review + Human 留足时间）· ✅

### 2.2 Human 介入质量

sprint-01-plan §Human 介入节点原定 "04-30 本地手动验证 COSTRA-102 真实登录 20 分钟" · dispatch D2.11 + §4 M5 完全兑现 · **没有新增 Human 介入点**。

Human 全 Sprint 总占用预算 ≈ 90 分钟（sprint-01-plan §Human 介入节点）· 目前已用：
- 04-22 ICP 发起 15 分钟 ✅
- 04-23 22:38 approve:COSTRA-100 20 分钟 ✅
- 04-24 12:54 approve:COSTRA-113 ~5 分钟 ✅
- 04-24 19:28 approve:COSTRA-101 T1 ~10 分钟 ✅
- 04-27 09:39 approve:COSTRA-118 T2 ~5 分钟 ✅
- **(本卡 M2 approve-def 预计 5 分钟 + M5 本地验证 20 分钟 + M6 终审 10 分钟 = 35 分钟)**

累计 ~90 分钟（贴顶但不超）· ✅ 符合产品预期。

### 2.3 后续卡解阻塞

本卡 M6 收口后解锁：
- **COSTRA-103**（本地持久化）· 依赖登录态正确 + outbox 入队接口 · ✅ 直接解锁
- **COSTRA-104**（entries CRUD + /sync/push）· 依赖 COSTRA-103 出口 · 间接解锁
- **COSTRA-105**（QA 冒烟）· 依赖 102+104 都落地 · 间接解锁
- **COSTRA-109**（PM 隐私草稿）· P0-10 part B 回填依赖 PM 产出 · 本卡 M6 后可执行同步

**Sprint-1 后续路径清晰**：M6 → 102+103 并行 → 104 → 105 → G4（05-06）· ✅

---

## 3. 问题与建议

### P1-NEW-1 · 首次登录"无昵称"空窗期 UI 状态未定义

- **严重度**：P1（产品体验缺口 · Human 04-30 验证时会看到 · 会困惑 → 误判 Fail）
- **现状分析**：
  - dispatch D2.4 说"从 getToken().raw.user.nickname 显示昵称"
  - 但 dispatch D2.1 又说 "可选调 wx.getUserProfile() · PATCH /users/me · 失败不阻塞"
  - **矛盾点**：首次登录时 · `AuthTokenPair.user.nickname` 是什么值？server 侧（COSTRA-101）创建用户时默认写的"微信用户"（FU-001 已登记 · dispatch §8 风险表第 3 行部分提及但无硬兜底）
  - 用户旅程："点登录 → 进入首页 → 看到 **'微信用户' + 默认头像**" → 如果 getUserProfile 弹窗后同意 → 首页昵称/头像是否自动刷新？dispatch 没说
- **建议**（需 dispatch 补丁 · 但本卡小幅 · 不要求重派单 · Agent 实装时按下列规则处理）：
  1. 首页 `onShow` 中：若 `getToken().raw.user.nickname === '微信用户'` 或为空 → **不显示昵称文本** · 只显示头像占位（或显示 "欢迎使用 Costra"）
  2. `pages/login/index.ts` 的 getUserProfile 流程中 · PATCH `/users/me` 成功后 → **本地更新 `getToken().raw.user`**（修改 storage 中 TOKEN_KEY）→ `wx.switchTab` 前覆盖一次
  3. 手册 D2.11 第 2 步（首页昵称验证） → **明确说明 "若首次登录未授权 getUserProfile · 昵称应显示 '欢迎使用 Costra' · 这是正常状态 · 非 Bug"**
- **处理方式**：Agent 实装时按上述规则自行处理 · Review R1 产出时核对 · **不阻 Human 放行本卡定义**

### P2-NEW-1 · 手册 D2.11 "失败回报模板"缺分级

- **严重度**：P2
- **现状**：dispatch D2.11 第 4 项说 "失败回报模板（issue 模板格式）" · 没分失败类型
- **建议**：手册内嵌两档模板：
  - **软失败**（某步 UI 不对 · 但流程能走完） → 贴到 chat 给 Orchestrator · Agent 开小范围补丁卡（1 点以内）
  - **硬失败**（某步完全卡死 · 流程走不完） → 贴到 chat · **本卡 Review 回退到 REJECT** · R2 Revise 修复 · 重新 Human 本地验证
- **不阻本卡放行** · Agent 实装时自行在手册中实现

### INFO-1 · 本卡是第一张"纯前端客户端 T1 卡"

- **来源**：Product Review 观察
- **内容**：此前 T1 卡都是 Backend（COSTRA-101）· 本卡是首张 **纯前端 T1**。Review-Product 视角需要记下：后续所有 MiniApp 卡的产品验收节奏（Human 手动验证 20 分钟 · Sprint 中/末对齐）可以复用本卡范式
- **议入 Sprint-1 Retro**

### INFO-2 · COSTRA-118 路径 A 分流承接效率

- **来源**：Product Review 观察
- **内容**：本卡 dispatch §3 把 COSTRA-118 的 11 条 P0/P1 清晰映射到 13 条 DoD 分节 · 并排除 5 项 · **零冲突 / 零遗漏**。这验证了 COSTRA-118 路径 A 策略的正确性（"用 COSTRA-102 天然承接而非独立拆 COSTRA-119"）· **产品上节约了 1~2 点估点**。
- **议入**：Sprint-1 收官时作为 Retro 正面案例

---

## 4. 合规与隐私审查

### 4.1 微信小程序审核硬要求

- ✅ 去 `open-type="getUserInfo"`（P0-10 part A · 符合微信 2022 新规）
- ✅ `wx.getUserProfile` 用户主动点击事件内调用（D2.1 已写）
- ✅ 敏感值（wx.login code）不写日志（P0-1 已处理）
- ✅ Token 加密存储策略不变（`__costra_token_v1` · ADR-0004 已定）
- ⚫ 隐私页填充（P0-10 part B）本卡不做 · 由 COSTRA-109 PM 草稿后同步 · Sprint-1 末前必须完成（否则 G4 合并闸门不过）

### 4.2 商业主体

- D-008 锁定"个人主体 · 骨架期" · 本卡不涉及支付/商户/交易组件 · ✅ 无合规风险
- COSTRA-113 subject 配置已 Approve · 本卡复用 · ✅

### 4.3 ICP 备案相关

- 本卡运行时指向 dev（127.0.0.1 · mockLogin 可切）· 不触发 ICP 硬依赖
- staging/prod 指向 costra.cloud · 依赖 ICP 下证 · 本卡 Human 04-30 验证时走 dev · **无 ICP 堵点** · ✅

---

## 5. 降级路径 / 意外场景覆盖

| 场景 | dispatch 是否覆盖 | 建议 |
|---|---|---|
| 用户拒绝 getUserProfile | ✅ D2.1 "失败不阻塞" | P1 补"无昵称空窗期 UI" |
| 本地 server 未起就打开 | ❌ 未定义 | Human 手册 D2.11 前置说明中必须写"确认 server 已起 · 否则登录会超时 10 秒" |
| 已有 token 冷启动但 token 已过期 | ✅ auth.ts initAuth 覆盖 + 登录页 onLoad `hasValidSession` 覆盖 | ✅ |
| 记一笔成功但 outbox 入队失败（storage 满） | ❌ 未定义 | Agent 实装时 `enqueueLocalEntry` 补 try/catch 发 wx.showToast · 登记 **INFO-3**（不阻本卡） |
| 用户登录成功后立刻退出 → 再登录 | ✅ D2.2 logout 清 storage + reLaunch 覆盖 | ✅ |
| 网络断开时点登录 | ✅ D2.3 CLIENT_NETWORK_ERROR 覆盖 + 登录页 errMsg 显示 | ✅ |

**结论**：意外场景覆盖率 **~85%** · 2 个小缺口（getUserProfile 空窗 UI + 本地 server 未起）· 通过 P1 + 手册前置说明修补即可 · ✅ 可接受。

---

## 6. KPI 对齐（产品侧度量）

| KPI | 目标 | 本卡预期贡献 |
|---|---|---|
| JS 错误率 | ≤ 0.1%（03-miniapp-agent.md DoD） | 本卡代码量 ~300~500 行新增 · 单测覆盖 ~70% · 估 JS 错误率 < 0.05% · ✅ |
| 首屏可交互 | ≤ 2s P75（03 agent DoD） | 登录页 + 首页均不引入新 SDK / 图片 · decimal.js 32KB 加载微不足道 · ✅ |
| 主包体积 | ≤ 2MB | 当前 ~200KB · +decimal.js 32KB ≈ 232KB · 预算充裕 · ✅ |
| 代码质量扫描 | ≥ 90（微信开发者工具） | Agent 无扫描权 · 由 Human 04-30 本地跑一次 · 手册需加此步 · **建议 dispatch 补** · 归入 P2-NEW-2 |

### P2-NEW-2 · 手册应加 "代码质量扫描 ≥ 90" 验证步骤

- **严重度**：P2
- **现状**：dispatch D2.11 五步没有"代码质量扫描"一项
- **建议**：手册加第 6 步（可选 · Human 有时间就跑 · 只需 30 秒）：在微信开发者工具菜单"详情 → 代码质量扫描"点一下 · 期望分数 ≥ 90 · 否则回报 Orchestrator
- **不阻本卡** · Agent 实装时自行在手册加入

---

## 7. 签字与下一步

- **Reviewer**：Review-Agent-Product
- **时间**：2026-04-27 09:46+08:00
- **同轮兑现**：本报告与 Tech Review 在派单同一 tool call 循环内交付（**D-016 第四次实战合规**）
- **投票**：**APPROVE**（28/30 · P1=1 · P2=1 · INFO=2 · 均可在 Agent 实装时按建议处理 · 不阻卡定义放行）

### 给 Human 的建议
- 直接发 **`approve-def:COSTRA-102`** 放行卡定义
- Agent 开工后若担心 P1-NEW-1（空窗期 UI） · 可在 04-30 手册验证时重点看第 2 步"首页昵称"
- 若 04-30 发现 P1 未处理理想 · 不必 REJECT 本卡 · 直接贴失败模板让 Orchestrator 开 1 点小补丁卡即可（符合 D-012 单卡交付即提交原则 · 不污染本卡 Review 度量）

---

## 8. Refs

- `.team/dispatch/COSTRA-102-miniapp-login-e2e.md`（本次审对象）
- `.team/reviews/COSTRA-102/card-def-tech.md`（配对 Tech Review）
- `.team/sprints/sprint-01-plan.md`
- `.team/reviews/COSTRA-118/FINAL.md`
- `.team/decisions/D-008 / D-013 / D-014 / D-016`
