# D-022 · review-tech 评分表 v2.0 + runtime 类 T2 卡 Human 实测前置铁律

> **立案时间**：2026-05-09（Sprint-1 末 Retro · COSTRA-106 议题 11/13/17 处置）
> **升级依据**：HANDOFF.md §6.1（议题 11/13/17）· D-019 §2.2 + §4.2 · COSTRA-121/124/127 实战
> **升级决策**：Sprint-1 末 Retro · 路径 A（D-019 拍板）
> **生效日期**：**2026-05-09**（随本决议落盘生效）
> **替代**：SOP-REVIEW.md v2.0（评分表 v1.0 · 总分 35 · 无 runtime 维度）

---

## §1 立案背景

### §1.1 第一次纸面审漏检：COSTRA-121

**事件**：COSTRA-121 R1 review-tech **35/35 PASS** → Human 实测证伪核心假设。

**证伪内容**：

- 121 假设：`useCompilerPlugins: ["typescript"]` 会将 `.json` 文件转译为 JS 模块（从而修复 runtime JSON import 问题）
- 122 实际：useCompilerPlugins 只管 `.ts → .js` 转译 · **不改变 JSON module runtime 解析语义**
- 微信 CommonJS require loader **不识别 `.json` 扩展名**
- 最终 COSTRA-122 单文件内联常量修复（121 物理修复价值保留 · 假设被证伪）

**漏检根因**：

- Review-Agent-Tech T2 纸面审运行在 Node.js 环境（`import tokensJson from './tokens.json'` 在 Node.js 中工作正常）
- 无法覆盖微信 runtime 特殊行为（CommonJS require loader 不识别 JSON extension）
- 纸面审 35/35 = 静态分析通过 ≠ 运行时假设正确

### §1.2 第二次纸面审漏检：COSTRA-124

**事件**：COSTRA-124 R1 review-tech **33/35 PASS** → Human 第 7 次模拟器实测证伪（"too eayly" 复现 ×7 · Launch Time 1864 ms）。

**证伪内容**：

- 124 R1 假设：COSTRA-123 npm 修复 + 业务 async 化后 "too eayly" 已消失（纸面审 33/35 通过）
- Human 模拟器实测：第 7 次测试 "too eayly" 复现 ×7 · onLaunch 时渲染层 storage group `_prepare` 仍未就绪

**漏检根因**：

- Review-Agent-Tech 纸面审无法覆盖微信 SDK 启动时序（App.onLaunch → 渲染层就绪的异步 gap）
- 微信基础库 2.32.3 的 runtime 行为与纸面分析假设不符

### §1.3 第一次合规跳过：COSTRA-127

**事件**：COSTRA-127 跳过 review-tech R1 · Human 模拟器实测 5 条断言全 PASS → Human 终审吸收 review-tech R1 职责。

**合规边界**（COSTRA-127 FINAL §3）：

1. D-017 Step 2 诊断置信度 90%+（subagent 独立诊断 · 等同纸面审价值）
2. Human 模拟器实测 5 条断言全 PASS（实测 = 终极证据）
3. 改动量极小（4 文件 ~18 行）
4. Human 显式拍板跳 review-tech R1

**"Human 终审吸收 review-tech R1 职责"明文化**：

- runtime 类 T2 卡终审绝对证据 = Human 模拟器实测 ≥ N 条断言全 PASS
- review-tech 纸面审仅作为辅助证据

---

## §2 review-tech 评分表 v2.0

> **总 分**：**40 分**（v1.0 35 分 → v2.0 40 分）
> **升级点**：新增 C8 "runtime 加载性"维度（5 分）

### §2.1 评分维度（全 8 项）

| 维度 | 说明 | 满分 | v1.0 |
|---|---|---|---|
| C1 · 合约合规（契约 / 接口 / 数据格式）| API 端点 / 参数 / 返回值 / 错误码对齐 | 5 | 5 |
| C2 · 架构正确（模块 / 分层 / 依赖方向）| 分层清晰 · 依赖方向正确 | 5 | 5 |
| C3 · 数据处理（业务逻辑 / 状态管理）| 记账逻辑 / 金额计算 / 状态更新正确 | 5 | 5 |
| C4 · 同步时序（竞态 / 并发 / 事务）| 锁 / 事务 / 竞态处理 | 5 | 5 |
| C5 · 安全性（鉴权 / 加密 / 注入）| 鉴权 / 加密 / SQL 注入 / XSS | 5 | 5 |
| C6 · 可测性（单测 / 冒烟 / 文档）| 单测覆盖 / 冒烟用例 / API 文档 | 5 | 5 |
| C7 · 工程纪律（lint / 格式化 / 类型）| lint / 格式化 / 类型安全 | 5 | 5 |
| **C8 · runtime 加载性（新增）** | **runtime 类卡必查 · 纸面审覆盖不到的微信 runtime 行为** | **5** | **—** |

### §2.2 C8 "runtime 加载性" 评分细则（5 分）

| 子项 | 描述 | 扣分 | 备注 |
|---|---|---|---|
| **C8-1** | runtime 实测必须性：涉及 runtime/SDK/platform API 的卡是否包含 Human 实测 DoD | 0/1/2 | 无 Human 实测 DoD → 0 分 |
| **C8-2** | 跨版本对照覆盖：涉及 lib/SDK 版本变更的卡是否包含多版本对照测试 | 0/1/2 | 无跨版本对照 → 0 分 |
| **C8-3** | 平台 SDK 假设标注：涉及微信 SDK 的纸面假设是否显式标注"未经验测" | 0/1 | 未标注 → 0 分 |
| **C8-4** | 错误路径 runtime 触达验证：关键错误分支（catch / error / fallback）是否经过 runtime 验证 | 0/1 | 未验证 → 0 分 |
| **合计** | — | 0~5 | — |

**C8-3 标注示例**（合规）：

```markdown
[未经验测] wx.getStorageSync 在 App.onLaunch 同步调用时序：在微信开发者工具模拟器中表现与真机可能存在差异，建议 Human 模拟器实测验证。
```

**C8-3 标注示例**（不合规）：

```markdown
wx.getStorageSync 在 App.onLaunch 同步调用已测试通过（纸面分析假设 · 未实测）
```

---

## §3 runtime 类 T2 卡判定标准

### §3.1 判定条件

若卡涉及以下任一，判定为 **runtime 类 T2 卡**：

| 类别 | 判定条件 | 典型问题 |
|---|---|---|
| **微信 SDK 启动时序** | App.onLaunch / onShow / getApp() 生命周期相关 | too eayly / storage 未就绪 |
| **渲染层时序** | setData / WXML 渲染 / tabBar 渲染 / 页面栈 | Expected updated data |
| **平台 API 运行时行为** | wx.request / wx.getStorage / wx.login 等平台 API | 平台差异 / 权限拒绝 |
| **模块加载语义** | JSON import / npm 包加载 / CommonJS require 语义 | module not defined |
| **微信基础库版本差异** | 2.32.x vs 3.x.x behavior diff | libversion upgrade 后回归 |
| **分包 / 主包加载时序** | 分包异步加载 / 预加载 / 主包依赖 | 分包页面白屏 |

### §3.2 runtime 类卡 DoD 强制要求

**runtime 类 T2 卡 DoD 必须含**：

1. Human 模拟器实测（微信开发者工具 · 真机可选）
2. ≥ 5 条断言（全 PASS 为终审必要条件）
3. 断言清单：
   - A：无 console.error / console.warn
   - B：无 `too eayly` 相关错误
   - C：关键页面/功能渲染正常（登录页/首页/记一笔）
   - D：tabBar 切换正常
   - E：核心用户流程贯通（登录→首页→记一笔）

**DoD 格式示例**：

```markdown
## DoD（runtime 类 T2 卡）
- [ ] Human 模拟器实测 ≥ 5 条断言全 PASS（A~E）
- [ ] A：无 console.error / console.warn
- [ ] B：无 `too eayly` 相关错误
- [ ] C：登录页/首页/记一笔渲染正常
- [ ] D：tabBar 切换正常
- [ ] E：核心用户流程贯通
```

---

## §4 runtime 类 T2 卡 Human 实测前置铁律

### §4.1 铁律条文

> **D-022 · runtime 类 T2 卡 Human 实测前置铁律**
>
> runtime 类 T2 卡（判定条件见 §3.1）终审绝对证据 = **Human 模拟器实测 ≥ 5 条断言全 PASS**。
>
> review-tech 纸面审（35→40 分）**仅作为辅助证据**，不替代 Human 实测。
>
> 若 Human 实测断言有任意一条 FAIL，review-tech 通过无效，卡退回 R1 修复。
>
> Human 实测前置铁律 **不可绕过**，除非：
> - E1：改动量 = 0（纯文档 / 配置变更）
> - E2：Human 明文 "跳过 Human 实测"（Human 自担风险）

### §4.2 "Human 终审吸收 review-tech R1 职责" 明文化

COSTRA-127 跳 review-tech R1 合规边界归档：

**触发条件**（以下三者同时满足）：

1. D-017 Step 2 诊断置信度 ≥ 90% 且含 runtime 类问题分析
2. Human 模拟器实测 ≥ 5 条断言全 PASS
3. 改动量 ≤ 4 文件 / ≤ 20 行（chore / small fix）

**合规路径**：

- review-tech R1 **跳过**（COSTRA-127 FINAL §3 模式）
- Human 终审直接吸收 review-tech R1 职责
- **DoD 强制含 Human 实测**（不可跳过）
- 形式上仍写 review-tech 报告标注 "SKIP-HUMAN-VERIFY-OVERRIDE"

**审计痕迹**：FINAL.md §3 必须含 SOP 偏差说明（合规模式模板见 §4.3）

### §4.3 合规模式模板（FINAL.md §3）

```markdown
## §3 SOP 偏差说明（runtime 类 T2 卡跳过 review-tech R1 合规依据）

### §3.1 触发条件确认

| 条件 | 值 | 合规？ |
|---|---|---|
| D-017 Step 2 诊断置信度 | ≥ 90% | ✅ |
| runtime 类问题分析 | 已含 | ✅ |
| Human 模拟器实测断言 | N 条全 PASS | ✅ |
| 改动量 | ≤ 4 文件 / ≤ 20 行 | ✅ |

### §3.2 合规路径

- review-tech R1 **跳过**（D-013 T2 档位 · 合规边界）
- Human 终审直接吸收 review-tech R1 职责
- DoD Human 实测步全 PASS（终审绝对证据）
- 形式 R1 review-tech 报告标注 "SKIP-HUMAN-VERIFY-OVERRIDE"

### §3.3 Human 终审吸收 review-tech R1 职责

Human 终审吸收 review-tech R1 职责显式记录在本 FINAL · 作为审计痕迹 · COSTRA-106 Sprint-1 Retro 议题 17 处置。
```

---

## §5 与 SOP-REVIEW v2.1 §11 的整合

### §5.1 SOP-REVIEW v2.1 §11 Human 实测闸

D-022 runtime 类 T2 卡 Human 实测前置铁律 → 整合入 SOP-REVIEW v2.1 §11：

- §11.1 runtime 类卡定义
- §11.2 Human 实测 DoD 格式模板
- §11.3 Human 实测闸触发条件
- §11.4 "Human 终审吸收 review-tech R1 职责" 合规模式

### §5.2 合规边界聚合（SOP-REVIEW v2.1 §11.5）

| 场景 | T2 fix 是否可跳 review-tech R1？| 合规条件 |
|---|---|---|
| 非 runtime 类 fix | ❌ 否（标准 T2 fix 路径）| 走 review-tech R1 |
| runtime 类 fix + Human 实测全 PASS | ✅ 是（COSTRA-127 模式）| D-017 Step 2 置信度 ≥ 90% + 改动量 ≤ 4 文件/20 行 |
| runtime 类 fix + 无 Human 实测 | ❌ 否 | 补 Human 实测 |
| chore / 0 行为变更 | ✅ 是（D-013 T3 自动关闭）| D-013 T3 档位 |

---

## §6 实战索引

| # | 卡号 | 时间 | 漏检类型 | 处置 |
|---|---|---|---|---|
| 1 | COSTRA-121 | 2026-04-28 | 纸面审 35/35 后被 Human 实测证伪（useCompilerPlugins 假设）| D-022 C8-3 平台 SDK 假设标注 |
| 2 | COSTRA-124 | 2026-05-02 | 纸面审 33/35 后被 Human 第 7 次实测证伪（too eayly 复现）| D-022 runtime 类判定 + Human 实测前置铁律 |
| 3 | COSTRA-127 | 2026-05-08 | 合规跳过 review-tech R1 · Human 实测 5 条断言全 PASS | D-022 合规边界 + FINAL §3 合规模式 |

---

## §7 生效声明

**自 2026-05-09 起**：

- ✅ review-tech 评分表 **v1.0 → v2.0**（35 分 → 40 分）
- ✅ C8 "runtime 加载性"维度（5 分）新增
- ✅ runtime 类 T2 卡判定标准（§3.1 五类判定）
- ✅ runtime 类 T2 卡 Human 实测前置铁律（§4）
- ✅ "Human 终审吸收 review-tech R1 职责"明文化（§4.2 + §4.3 合规模式）
- ✅ SOP-REVIEW v2.1 §11 整合（Human 实测闸 + 合规边界聚合）
- ✅ COSTRA-106 Sprint-1 Retro 承诺兑现（议题 11/13/17 处置）

---

## §8 关联文档

- `.team/SOP-REVIEW.md v2.1`（SOP-REVIEW §11 Human 实测闸 · 本 D-022 配套）
- `.team/SOP-CARD-REVIEW.md §3`（评分表 v1.0 · 升级为 v2.0）
- `.team/decisions/D-013-review-scenario-tiering.md`（T2 档位基础 · 合规边界参照）
- `.team/decisions/D-017-verification-problem-response-sop.md`（D-017 v3 · Step 3 runtime 类标记 + Step 4 跨版本对照）
- `.team/decisions/D-020-d-016-final-canonical.md`（D-020 同轮兑现 · Human 实测前置铁律不绕过）
- `.team/reviews/COSTRA-121/round-1-tech.md`（第 1 次纸面审漏检证据）
- `.team/reviews/COSTRA-124/round-1-tech.md`（第 2 次纸面审漏检证据）
- `.team/reviews/COSTRA-127/FINAL.md`（Human 终审吸收 R1 职责 · 合规边界模板）
- `docs/devops/libversion-upgrade.md §3.4`（v5 定稿 · 跨版本对照实战归档源）

---

## §9 一句话总结

> **D-022：review-tech 评分表 v2.0（35→40） + runtime 类 T2 卡 Human 实测前置铁律（COSTRA-106 Sprint-1 Retro 议题 11/13/17 处置）**—— 纸面审 35/35 ≠ 假设正确 · Human 模拟器实测是 runtime 类卡终审绝对证据 · C8 "runtime 加载性"维度新增 5 分。
