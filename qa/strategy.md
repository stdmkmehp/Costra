# Costra · 测试策略 · Sprint-2 冒烟专版（v1.0）

> **卡号**：COSTRA-105（Sprint-2 主线第 4 张 · qa-planner 首次实装实战）
> **Owner**：qa-planner（装扮型 subagent · D-018 SBAI v1.1）
> **版本**：v1.0（2026-05-12 R1 实装）
> **与旧策略关系**：`docs/qa/test-strategy.md` v0.1 是 PR QA Gate 模板基线，本策略仅补 Sprint-2 冒烟新增维度，不替代旧策略。

---

## §1 Sprint-2 冒烟目标

### 1.1 覆盖范围

| Epic | 内容 | 对应用例 |
|---|---|---|
| **Epic-A（账号体系）** | 登录闭环 + Token 续签 | SU-001 · SU-010 |
| **Epic-B（单人记账）** | 记一笔 + 金额边界 + 流水列表 | SU-002 · SU-008 · SU-009 |
| **Epic-C（离线优先架构）** | client outbox + server sync + 幂等 + 冲突 + 端到端契约对齐 | SU-003 · SU-004A · SU-004B · SU-005 · SU-006 · SU-007 |

### 1.2 核心新增价值

- **端到端贯通验证**：把 COSTRA-103（client）+ COSTRA-104（server）拼接成"用户视角"的闭环冒烟
- **离线弱网专项断言**：SU-003/004/007 专项覆盖 PRD AC-4「无网也能保存 → 联网后自动上传」
- **自动化脚手架**：miniprogram-automator 1~2 个示例用例（非全量）

---

## §2 用例分层映射（S-001~S-017 vs SU-xxx）

### 2.1 既有冒烟用例覆盖（Sprint-0 基线）

| 既有用例 | 状态 | 本卡对应 | 说明 |
|---|---|---|---|
| S-001 冷启 TTI ≤ 2s | 已有人验（COSTRA-102） | SU-009 | 合并到单人记账冒烟集 |
| S-002 登录闭环（首次）| 已有人验（COSTRA-102）| SU-001 | 合并到单人记账冒烟集 |
| S-003 登录失败重试 | 待 Sprint-2+ | — | 暂不覆盖（边界路径）|
| S-004 Token 过期自动续签 | 已有人验（COSTRA-102）| SU-010 | 合并到单人记账冒烟集 |
| S-005 记一笔支出全流程 | 已有人验（COSTRA-102）| SU-002 | 合并到单人记账冒烟集 |
| S-006 金额边界 | 纸面用例 | SU-008 | 合并到单人记账冒烟集（扩展）|
| S-007 离线记一笔本地兜底 | 纸面用例 | SU-003 · SU-004A · SU-004B | **核心新增**（离线弱网 + 集成层端到端 v1.1）|
| S-008~S-017 家庭/订阅/合规 | Sprint-2+ 或 Sprint-3 | — | 暂不覆盖 |

### 2.2 新增用例（13~14 条）

| 新增用例 | 来源 | 说明 |
|---|---|---|
| SU-001~004 | 合并 S-001/002/005/007 | 单人记账核心链路 |
| SU-005（幂等）| 新增（Epic-C 核心）| COSTRA-122 AC-3 专项 |
| SU-006（version conflict）| 新增（Epic-C 核心）| COSTRA-123 AC-1 专项 |
| SU-007（弱网 8s 超时）| 细化 S-014 | 边界降级路径 |
| SU-008（金额边界）| 合并 S-006 | 扩展 decimal.js 断言 |
| SU-009（TTI ≤ 2s）| 合并 S-001 | NFR 断言 |
| SU-010（Token 续签）| 合并 S-004 | Epic-A 异常路径 |
| SU-011（隐私授权拒绝）| 细化 S-002 拒绝路径 | Epic-A 授权拒绝 |
| SU-012（基础库双版本）| 新增（D-022 §3.1）| 兼容专项 |
| SU-013（Token 安全）| 新增 | 安全专项 |
| SU-014（包体积）| 合并 S-013 | 合规专项 |

---

## §3 自动化覆盖规划

### 3.1 当前状态

| 自动化工具 | 覆盖范围 | 状态 |
|---|---|---|
| `miniprogram-automator` | SU-001（冷启登录）· SU-002（记一笔）| **脚手架阶段**（本卡交付 1~2 示例）|
| Vitest（server）| 幂等 + conflict + CRUD | ✅ 已覆盖（COSTRA-104）|
| Vitest（miniapp）| storage/auth/sync async API | ✅ 已覆盖（COSTRA-125/126）|

### 3.2 自动化路线图

```
Sprint-2（当前）：自动化脚手架交付（1~2 示例用例）
  ↓
Sprint-3：FU-105-AUTOMATION-FULL-COVERAGE（14 用例全量自动化 + CI 集成）
  ↓
Sprint-4+：E2E 自动化覆盖 ≥ 80% 核心链路
```

### 3.3 FU-105-AUTOMATION-FULL-COVERAGE（P2 · Sprint-3 候选 · 5 点）

详见 `.team/follow-ups/README.md` · owner=qa-planner+miniapp-dev

---

## §4 真机矩阵 v1

### 4.1 规划目标

| 平台 | 机型数 | 基础库版本 |
|---|---|---|
| iOS | ≥ 2 | 2.32.3（最低）/ 3.8.12（当前）|
| Android | ≥ 2 | 2.32.3（最低）/ 3.8.12（当前）|

### 4.2 现实约束

- Human 当前持：微信开发者工具模拟器 + 1 台真机
- 真机全量覆盖延后 Sprint-3（FU 真机矩阵扩展）
- 本卡仅交付 Human 模拟器实测（5 步 + 5 硬断言）

---

## §5 缺陷流转

### 5.1 缺陷单格式

路径：`qa/defects/YYYY-MM-DD-xxx-brief.md`

字段：严重度（P0/P1/P2）+ 复现步骤 + 截图路径 + 日志 + 责任 Agent + 真机信息 + 状态（Open/Fixed/Closed）

### 5.2 流转规则

| 缺陷严重度 | 响应 | 禁止 |
|---|---|---|
| P0 / Blocker | 立即回滚 + 热修 + 一票否决发布 | 本卡立即 blocker 给 Orchestrator 转介 |
| P1 / Critical | 当 Sprint 必修 | 发缺陷单给 Orchestrator 转介 |
| P2 / Major | 下一 Sprint | 同上 |

**禁止**：qa-planner 禁止直接 send_message 给责任 Agent · 必须经 Orchestrator 转介（SBAI 铁律）

---

## §6 进度看板

### 6.1 COSTRA-105 R1 时间线

| 时间 | 动作 | 状态 |
|---|---|---|
| 2026-05-12 14:xx | Card-Review R1 PASS-WITH-FOLLOWUP | ✅ |
| 2026-05-12 14:xx | R1 实装（qa-planner 本次）| ⏳ 进行中 |
| 2026-05-12 14:xx | review-tech R1（D-014-b）| ⏳ 等实装完 |
| 2026-05-12 ~15:xx | Human 实测（模拟器 5 步）| ⏳ 等 review-tech APPROVE |
| 2026-05-12 ~15:xx | Human T1 终审 `approve:COSTRA-105` | ⏳ 等 Human 实测全 PASS |

### 6.2 后续发布前必跑

每个 Sprint 末 / 发布前必跑本卡冒烟集（15 条用例 · v1.1 SU-004 拆 A/B），任一 FAIL 禁止发版。

---

## §7 与 `docs/qa/test-strategy.md` v0.1 关系

> **不替代** · 旧策略仍是 PR QA Gate 模板基线（v0.1）。

| 旧策略 | 本策略 | 关系 |
|---|---|---|
| 分层策略（单元/集成/E2E）| Sprint-2 冒烟专项 | 互补（旧策略通用，本策略专精）|
| PR QA Gate 模板 | 冒烟用例集（SU-001~014）| 互补（Gate 是入口，冒烟是出口）|
| 缺陷分级（P0~P3）| 缺陷单格式规范 | 沿用（旧策略分级）|
| 工具链总览 | miniprogram-automator 脚手架 | 沿用（工具同，阶段不同）|

**本策略 §1~§6 覆盖 Sprint-2 冒烟新增维度**：
- Epic-A/B/C 端到端闭环覆盖（103+104 拼接）
- 离线弱网专项断言（SU-003/004A/004B/007）
- 十类覆盖完整性（10/10 全覆盖 · v1.1 新增"集成层契约对齐"类目）
- 自动化脚手架规划（分阶段）
- Human 模拟器实测 5 步 + 5 硬断言（H1~H5）

---

**修订记录**：
- v1.0 · 2026-05-12 · COSTRA-105 R1 实装（qa-planner 首次实战）