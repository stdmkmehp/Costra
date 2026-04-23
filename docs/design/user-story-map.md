# Costra · 用户故事地图 v0.1

> **卡号**：COSTRA-010 · **Owner**：Design-Agent · **产出日期**：2026-04-21
> **依赖**：`docs/PRD.md` v0.1（Epic-A~G / 21 Story / 113 点）

---

## 1. 结构说明（三层）

```
┌─ Backbone（活动/用户旅程） ────── 左→右 = 时间轴
│   └─ Walking Skeleton（MVP 最小可用路径 · 必选）
│       └─ Release Slice（R1 / R2 / R3 · 按里程碑切片）
```

- **Backbone**：用户**在 Costra 上完成一次完整记账之旅**的 6 个骨干活动
- **Walking Skeleton**：覆盖 MVP 必须路径（= R1 范围）
- **Release Slice**：
  - **R1 · Alpha 内测**（Sprint-1~3，~6 周）：单人记账 + 云同步 + 微信登录
  - **R2 · Beta 邀测**（Sprint-4~5，~4 周）：家庭共享 + 预算 + 订阅消息
  - **R3 · 公测上线**（Sprint-6+）：统计报表 + 审核 + 灰度发布

---

## 2. 故事地图主表

### 2.1 Backbone（6 大活动）

| # | 活动 | Epic 映射 | 价值主张 |
|---|---|---|---|
| A1 | **进入并认证** | Epic-A | 3 秒内完成登录，拿到个人工作台 |
| A2 | **记一笔账** | Epic-B | 5 秒内记完，离线也能记 |
| A3 | **看清我的钱** | Epic-B/F | 流水 / 筛选 / 明细跳转 |
| A4 | **和家人共管** | Epic-D | 发起或加入家庭，协同记账 |
| A5 | **管控预算** | Epic-E | 设定预算，超支提醒 |
| A6 | **回顾与沉淀** | Epic-F | 月度/年度可视化报告 |

### 2.2 MVP 最小路径（Walking Skeleton · R1 范围）

**必须跑通的最小闭环**（从用户第一次打开到第一次记账成功）：

```
[A1] 微信登录          → COSTRA-101  (5 点)
     ↓
[A2] 首页点 "+" 记一笔  → COSTRA-113  (8 点)
     ↓
[A3] 流水列表查看       → COSTRA-114  (5 点)
     ↓
[A3] 本地兜底 + 云同步  → COSTRA-121/122 (5+5 点)
     ↓
[A4] 创建 / 加入家庭    → COSTRA-201/202 (5+3 点)
     ↓
[A6] 看月度统计         → COSTRA-501 (5 点)
```

**MVP 最小路径合计：41 点**（覆盖 PRD 113 点的 36%，已足够发 Alpha）。

> 📌 **41 vs 44 差值说明**（Round-1 P1-1）：本节 41 点是"**Walking Skeleton 最窄闭环**"——仅覆盖用户从进入到记一笔并看到统计的单线。§3 表格中的 **R1 · 44 点** 额外包含 `COSTRA-103 token 自动续签`（3 点）：它是 Alpha 内测上线硬约束（token 过期 15min 不续签会频繁掉登录），但不属于最窄闭环。因此 **Walking Skeleton = 41 点，R1 交付范围 = 41 + 3 = 44 点**。

### 2.3 完整故事网格

行 = Backbone 活动 · 列 = Release Slice · 单元格 = Story（括号内为估点 · Epic）

| 活动 | R1（Alpha 内测） | R2（Beta 邀测） | R3（公测） |
|---|---|---|---|
| **A1 进入并认证** | `COSTRA-101` 微信 wx.login 换 token (5 · Epic-A)<br>`COSTRA-103` token 自动续签 (3 · Epic-A) | `COSTRA-102` 绑定手机号（需用户主动点击）(5 · Epic-A) | — |
| **A2 记一笔账** | `COSTRA-111` 账户管理 (5 · Epic-B)<br>`COSTRA-112` 分类管理 (3 · Epic-B)<br>`COSTRA-113` 新增流水 (8 · Epic-B) | — | `COSTRA-115` 语音/OCR 快速记账（Backlog） |
| **A3 看清我的钱** | `COSTRA-114` 流水列表 + 筛选 (5 · Epic-B)<br>`COSTRA-121` 本地 wx.storage 先写 (5 · Epic-C)<br>`COSTRA-122` 增量云同步 (5 · Epic-C) | `COSTRA-123` 离线冲突兜底（last-write-wins + 手动合并）(5 · Epic-C) | — |
| **A4 和家人共管** | — | `COSTRA-201` 创建家庭 + 邀请码 (5 · Epic-D)<br>`COSTRA-202` 扫码/分享卡片加入家庭 (3 · Epic-D)<br>`COSTRA-204` 成员与角色 (3 · Epic-D) | — |
| **A5 管控预算** | — | `COSTRA-301` 周期预算（月/周） (5 · Epic-E)<br>`COSTRA-203` 订阅消息授权 (3 · Epic-D)<br>`COSTRA-302` 超支订阅消息下发 (5 · Epic-E) | — |
| **A6 回顾与沉淀** | `COSTRA-501` 月度统计总览 (5 · Epic-F) | `COSTRA-502` 分类占比饼图 (3 · Epic-F)<br>`COSTRA-503` 趋势折线 (3 · Epic-F) | `COSTRA-504` 年度报告（分享卡片）(5 · Epic-F)<br>`COSTRA-601` 类目 / 隐私 / 头像昵称新规合规 (5 · Epic-G)<br>`COSTRA-602` 分阶段灰度发布 (3 · Epic-G) |

---

## 3. 切片点数与时间线

| Release | 点数 | 预期 Sprint | 里程碑 |
|---|---|---|---|
| R1 · Alpha 内测 | 44 | Sprint-1 ~ Sprint-3（约 6 周）| 可发体验版 → 10 人内测 |
| R2 · Beta 邀测 | 34 | Sprint-4 ~ Sprint-5（约 4 周）| 家庭 / 预算 / 订阅消息齐全 → 50 人邀测 |
| R3 · 公测 | 11+ | Sprint-6 及以后 | 过审 → 灰度 → 100% 放量 |
| **合计** | **89+（不含 Backlog）** | | |

> PRD v0.1 总点数 113，差值 24 点为 Backlog 候选（语音记账、OCR、汇率、跨币种统计等）。

---

## 4. 用户旅程关键痛点映射

| 痛点（来自 charter §6）| 对应 Story | 指标验证 |
|---|---|---|
| 记账步骤繁琐、坚持不下来 | COSTRA-113（5 秒内完成）| NFR-P1：p95 ≤ 1.5s 打开记账页 |
| 家人对账困难 | COSTRA-201/202/204 | Beta：至少 30% 用户创建或加入家庭 |
| 预算管控缺失 | COSTRA-301/302 | Beta：30% 活跃用户设置预算 |
| 数据丢失恐惧 | COSTRA-121/122/123 | Alpha：0 条数据丢失报告 |
| 年底总结没有仪式感 | COSTRA-504 | R3：年度报告分享率 ≥ 15% |

---

## 5. 非功能需求嵌入

- **性能**：A1/A2 首屏 ≤ 2s（对应 NFR-P1）
- **离线**：A2/A3 本地兜底必须在 R1 完成
- **安全**：A1 Token 续签 / A4 家庭权限边界属于硬 AC
- **合规**：A6 R3 的 COSTRA-601 是审核阻断项

---

## 6. 下一步

- 本地图交付后进 **G2 设计评审**
- MiniApp-Agent (COSTRA-030) 按此切分 Sprint-1 迭代锚点
- PM-Agent 据此排期 Sprint-1 backlog（从 R1 Walking Skeleton 取前 5 张）

---

**Refs**: COSTRA-010 · **Impacts**: Sprint-1 排期、COSTRA-020 契约范围、COSTRA-050 冒烟优先级
