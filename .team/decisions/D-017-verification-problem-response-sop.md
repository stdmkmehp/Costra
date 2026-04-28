# D-017 · 验证问题响应 SOP（Human 反馈验证/运行时问题的标准流程）

> **立案时间**：2026-04-28 13:59
> **立案人**：Human（明文裁决：「把拉起相应 agent 分析根因 提出解决办法 作为项目遇到验证问题的标准流程」）
> **立案背景**：COSTRA-119 P0 逃逸（见 §1）· Orchestrator 在 Human 反馈 13:53 撞坑时若先走"根因分析 → 方案对比"流程，可能更早识别出 tabBar 规约违反，避免 119 R1 方向偏差
> **优先级**：**P0 · 铁律补丁** · 与 D-011/D-014/D-016 同级 · 本规约发生时机**前置于** D-011/D-014/D-016（即"派单之前"的流程环节）
> **生效范围**：**所有 Human 反馈的验证/运行时/联调问题**（含：模拟器启动失败 / 单测失败 / 接口报错 / 部署异常 / CI 红 / 手册步骤撞坑）· 不适用于"Human 发起新需求"场景（那条走 D-014-a 卡定义流程）

---

## 1. 立案背景 · COSTRA-119 P0 逃逸复盘

### 1.1 事件时间线

| 时间 | 事件 | 规约缺失点 |
|---|---|---|
| 2026-04-27 20:24 | Human 打开微信开发者工具撞坑（错误 "未找到 pages-stat/overview/index.wxml"） | — |
| 2026-04-27 20:25 | Orchestrator 提出"分析原因 + 提方案"但**是 Orchestrator 自己分析**，未派给 MiniApp-Agent | ❌ 缺 D-017 |
| 2026-04-27 20:27 | Human 选定方案 B | — |
| 2026-04-27 20:28 | 派单 COSTRA-119 · 方向是"补文件 + 建 CI" | — |
| 2026-04-27 20:31~33 | 119 R1 完工 + Review APPROVE 33/35 | ❌ 根因识别偏差未被抓到 |
| 2026-04-28 13:48 | 119 整卡 CLOSED commit 8bcc5d0 | — |
| 2026-04-28 13:53 | Human 重开微信开发者工具 · 模拟器再次失败（错误升级："tabBar pagePath need in pages"） | ❌ 根因是"规约违反"非"文件缺失" |
| 2026-04-28 13:57 | Human 明文指令："必须按照先根据问题表现拉起相应负责的 agent" | ✅ 立案 D-017 |
| 2026-04-28 13:59 | Human 裁决新开 COSTRA-120 + 追写 119 逃逸说明 + D-017 规约沉淀 | ✅ 执行 |

### 1.2 根因结构化

**为什么 Orchestrator 在 119 时没派责任 Agent 做根因分析？**

1. **Orchestrator 职责边界误判**：把"根因分析"视为 Orchestrator 的调度职责内容 · 实际根因分析是**领域专家职责**（MiniApp 领域 → MiniApp-Agent · 后端领域 → Backend-Agent · 依此类推）
2. **症状→方案的直觉跳跃**：Human 给了图 + 错误文本，Orchestrator 直接解读为"文件不存在 → 补文件"，没走"文本精读 → 规约查证 → 根因分层"的专业路径
3. **T2 档位局限叠加**：Review-Agent-Tech 纸面审 + 命令行五闸，**不启动微信开发者工具**，所以规约违反这类"runtime 才爆"的问题结构性漏检

---

## 2. 规约正文

### 2.1 触发条件

Human 以任一形式反馈"验证/运行时问题"：
- 附图（模拟器截图 / 终端输出 / 浏览器 devtools）
- 附文本（错误消息 / 日志 / 命令输出）
- 纯描述（"点了某按钮后没反应"/"打不开" 等）

### 2.2 五步标准流程（FORBIDDEN：任何步骤跳过）

```
  ┌─────────────────────────────────────────────────────────────┐
  │ Step 1 · 责任领域识别（Orchestrator · 30 秒内）              │
  │   - 读错误文本关键字段                                       │
  │   - 对照职责矩阵定 Owner Agent                               │
  │     · 微信运行时/app.json/wxml    → MiniApp-Agent            │
  │     · HTTP/接口/DB/SQL            → Backend-Agent            │
  │     · CI/lint/deploy/secrets      → DevOps-Agent             │
  │     · 手册步骤/冒烟用例           → QA-Agent                 │
  │     · 多域交叉（> 1 归属）        → Orchestrator 主持联审    │
  └────────────────────────┬────────────────────────────────────┘
                           ▼
  ┌─────────────────────────────────────────────────────────────┐
  │ Step 2 · 责任 Agent 根因分析（Agent · 只诊断不修复）         │
  │   - 基于现场数据/日志/错误文本做分层根因                    │
  │   - 分层模型（L1 表面 / L2 文档 / L3 设计 / L4 机制）       │
  │   - 输出根因报告：明文列每层事实 + 证据文件行号             │
  │   - 允许 Agent 只读工作区（read_file / grep / search 等）    │
  │   - **禁止 Agent 在本步修改任何文件**                        │
  └────────────────────────┬────────────────────────────────────┘
                           ▼
  ┌─────────────────────────────────────────────────────────────┐
  │ Step 3 · 多方案对比（Agent · 至少 2~3 方案）                 │
  │   - 方案 A/B/C 格式                                          │
  │   - 每方案列：做法 / 成本 / 价值 / 风险                      │
  │   - Agent 给技术推荐意见（但不强制 Human 接受）              │
  │   - 列明需要 Human 拍板的决策点（Q1~Qn）                     │
  │   - 产出 Markdown 汇报到对话                                 │
  └────────────────────────┬────────────────────────────────────┘
                           ▼
  ┌─────────────────────────────────────────────────────────────┐
  │ Step 4 · Human 评估裁决（可能需要多轮 Q&A）                  │
  │   - Human 选方案 + 回答决策点                                │
  │   - 允许 Human 反问 · 允许 Agent 补充分析                    │
  │   - 允许 Human 选择"先不修"（归档到 FU / 下 Sprint）         │
  └────────────────────────┬────────────────────────────────────┘
                           ▼
  ┌─────────────────────────────────────────────────────────────┐
  │ Step 5 · 派单实装（走 D-014-a/D-014-b/D-016 既有流水）       │
  │   - 新建卡号（backlog.json 追加）                            │
  │   - 写 dispatch                                              │
  │   - R1 实装 → AI Review → Human 终审                          │
  │   - 同轮兑现（D-016）                                        │
  └─────────────────────────────────────────────────────────────┘
```

### 2.3 允许的例外

- **E1 · 微小 typo 级**：Human 一眼可见的错别字 / 路径拼写 · Human 在 Step 1 可直接命令 "run agent fix-xxx" 跳过 Step 2/3（但仍走 Step 5 · 不自动 merge）
- **E2 · 回归到已知 FU**：Human 反馈的问题经 Orchestrator 快速 grep 发现与既有 `open` FU 完全同族 · 可直接派"认领 FU-xxx"卡 · 跳过 Step 2/3 重复分析
- **E3 · Human 主动下令跳过**：Human 明文 "跳过根因分析 · 直接按方案 X 实装"（需 Human 自己承担判断风险）· Orchestrator 在 dispatch 中记录该指令

**例外必须记录**：dispatch §0 背景段必须明文"本卡走 D-017 E1/E2/E3"，供 Sprint Retro 审查。

### 2.4 与现有规约的时序关系

```
Human 反馈验证问题
    ↓
D-017 Step 1~5（根因分析 → 方案 → 裁决 → 派单）
    ↓
D-014-a 卡定义 Review（如本次属于新卡 · 且 T1/T2 以上）
    ↓
D-014-b R1 自动拉起 → D-016 同轮兑现 → D-011 Revise↔Review 自动循环
    ↓
Human 终审（T1~T2 需要 · T3/T4 自动关闭）
    ↓
D-012 单卡即提交
```

D-017 **在所有其他规约之前**，属于"派单之前的需求理解保护层"。

---

## 3. 责任矩阵（Step 1 识别依据）

| 错误信号关键字 | Owner Agent | 备选兜底 |
|---|---|---|
| `app.json` / `subpackages` / `tabBar` / `pagePath` / `wxml` / `wxss` / `wxs` / `miniprogram-api-typings` | **MiniApp-Agent** | DevOps 兜底（构建脚本） |
| `HTTP 4xx/5xx` / `database` / `SQL` / `koa` / `express` / `/api/*` / `OpenAPI` | **Backend-Agent** | — |
| `CI` / `lint` / `husky` / `workflow` / `deploy` / `secret` / `npm ci` / `pre-commit hook` | **DevOps-Agent** | Backend/MiniApp 跨区兜底 |
| `test` / `vitest` / `冒烟` / `verify` / `QA 手册步骤` / `wechat-review-checklist` | **QA-Agent** | 领域 Agent 兜底 |
| `DNS` / `域名白名单` / `ICP` / `serverDomain` | **DevOps-Agent** | MiniApp 兜底（env 侧） |
| 多域交叉 / 归属不清 | **Orchestrator 主持** | — |

---

## 4. D-017 流程产物

每次走 D-017 的交互都在对话中留痕：
- Step 2 根因分析报告 · Markdown 格式 · 对话内直出（可选择落盘到 dispatch 的 §0 引用）
- Step 3 方案对比表 · 对话内直出
- Step 4 Human 裁决记录 · 在 dispatch §0 时间线引用
- Step 5 的 dispatch / R1 / Review 三件套按既有规约

**不必为 D-017 过程单独开"分析卡"**，分析产物是"派单卡 dispatch §0 背景"的前置材料。

---

## 5. 典型反模式（D-017 禁止）

### ❌ 反模式 A · Orchestrator 自己分析根因
Orchestrator 不是任何领域的专家 · 看症状直接判方向会放大 bias · **必须**派给责任 Agent。

### ❌ 反模式 B · 只给一个方案
即使 Agent 认为"显然应该这么修"，也必须列 2~3 方案供 Human 对比 · 锻炼 Human 的项目决策权。

### ❌ 反模式 C · 跳过根因直接派单
Human 反馈"有问题" · Orchestrator 立即 "run agent fix-xxx" · 跳过了 Step 2/3 · 是 COSTRA-119 P0 逃逸的直接成因。

### ❌ 反模式 D · 根因报告只写一层
必须分 L1/L2/L3/L4 四层（表面 / 文档 / 设计 / 机制）· 避免只看表面症状被"补丁型方案"带偏。

---

## 6. 首次实战

- **COSTRA-120**（2026-04-28 14:00）：D-017 首次实战
  - Step 1 → MiniApp-Agent（错误关键字 `app.json tabBar pagePath`）
  - Step 2 → 四层根因（L1 "规约违反"/L2 README 漂移/L3 骨架卡 DoD/L4 CI 单向）
  - Step 3 → 方案 A/B/C 对比（A 上提主包 · B 改 tabBar · C 代理页反模式）
  - Step 4 → Human Q1~Q5 裁决
  - Step 5 → 派单 COSTRA-120 R1 · 同轮兑现

---

## 7. 演进路径

- Sprint-1 末 Retro：评估 D-017 实战覆盖面 · 若 > 3 次全符合 · 可升级为"定稿规约"
- Sprint-2 起：考虑给 Review-Agent-Tech 增加"模拟器冒烟步"能力（若具备 · 部分消除 T2 档位 runtime 漏检）
- 长期：Agent 能力边界（COSTRA-114 v2）与 D-017 互补 · Agent 越受限则 D-017 的 Human 兜底越重要

---

## 8. 决策者归档

- 立案人：Human @ 2026-04-28 13:57~13:59
- 成文：Orchestrator @ 2026-04-28 14:00（随 COSTRA-120 同轮产出）
- 复议路径：Human 在任何时候可下指令 "D-017 修订" · 触发新 ADR
- 版本：**v1.0**（首版 · 待 Sprint-1 末 Retro 评估）
