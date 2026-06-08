# COSTRA-123 · 卡定义 Review · Tech 维度

- **Review 档位**：D-014-a 卡定义首轮（T2 基建小卡 · runtime 契约修复类）
- **Reviewer**：Review-Agent-Tech
- **Review 对象**：`.team/dispatch/COSTRA-123-miniapp-fix-npm-bridge-for-decimal.md`
- **产出时间**：2026-05-01 21:05+08:00（Orchestrator 派单同 tool call 循环内兑现 · **D-016 第 12 次实战**）
- **覆盖 D-014-a §2.1 checklist**：C1~C8
- **参照事实源**：
  - `.team/decisions/D-013-review-scenario-tiering.md`（档位判定）
  - `.team/decisions/D-014-card-review-and-auto-review-kickoff.md`（§2.1 checklist）
  - `.team/decisions/D-017-verification-problem-response-sop.md`（本卡触发链）
  - `.team/dispatch/COSTRA-122-miniapp-fix-tokens-json-runtime-import.md`（同族先例格式）
  - 微信官方：`project.config.json` `packNpmManually` / `packNpmRelationList` 字段语义

---

## 0. 结论速览

**Verdict**：**APPROVE**（卡定义可进入 Human 放行环节 / 或 D-017 E3 直接派实装）  
**评分**：**34 / 35**（P0=0 · P1=0 · P2=1 · INFO=2）

**推荐 Human 动作**：`approve-def:COSTRA-123`（放行卡定义 · MiniApp-Agent 可立即实装）· 或按 §8 裁决钩子选 D-017 E3 跳过本步。

**卡定义就绪度**：
- Scope 极紧（3 处改 · 零源码 · 零 CI 扩展）
- 非目标段 6 条显式排除（Review 不得追加 · 参照 102/122 范式）
- 反向验证 3 次静态对账退化策略（与 122 档位一致）
- 能力边界铁律合规（§3.3 明文 Agent 不得自称 runtime 验证）
- D-017 全流程留痕（§0 Step 1~5 映射）· D-014/D-016 自动化规约完整引用

---

## 1. D-014-a §2.1 checklist 对账

| # | 项 | 状态 | 证据 |
|---|---|---|---|
| C1 | 标题/描述清晰、无歧义 | ✅ | 标题 "MiniApp npm 构建桥接 + 验证手册补丁（decimal.js runtime 漏检修复）"· 子系统 + 问题 + 修复方向三元素齐 |
| C2 | 验收标准可度量 | ✅ | §3.1 九条五闸 + 静态对账全部可自动化判定（exit code / grep / JSON 字段匹配） |
| C3 | 依赖识别 | ✅ | dispatch 头部明确依赖 COSTRA-102 R1（decimal.js 已在 `package.json:21`）· 121（工具链 SSOT）· 122（runtime 契约盲区先例） |
| C4 | 产出物具体 | ✅ | D1/D2/D3 每处精确到文件路径 + 行号（`project.config.json:42-43` / `docs/qa/costra-102-human-verify.md §0.3.1` / `miniprogram/README.md §3`）· 给出 before/after 精确代码块 |
| C5 | 风险/边界标注 | ✅ | §4 8 条风险表 · 含同族第 6 次复发极端情况 + Retro 议题堆积风险 |
| C6 | 是否与已有卡重复/冲突 | ✅ | backlog.json 无同域卡 · 与 COSTRA-122 (tokens JSON runtime) 同族但根因层次不同（一个是 .json loader · 一个是 npm 包 loader）· dispatch §0 "121 假设证伪的因果链延伸"段明文区分 |
| C7 | 估点合理 | ✅ | 1 点（0.5 配置 + 0.5 Review/FU）· 对照 122（估 1 点 · 实装 21 分钟）· 本卡更简单（无业务逻辑只改 JSON + Markdown） |
| C8 | 红线 | ✅ | 无硬编码 secret · 无主体字样 · 无 Won't-Have 违反 · ADR-0002 "decimal.js 硬约束"由本卡**正向兑现**（让 runtime 可加载） |

**对账结论**：**8/8 全绿** ✅

---

## 2. 正面观察（值得写进规约沉淀的好做法）

### G-1 · D-017 全流程留痕完整
dispatch §0 明文列 Step 1~5 时间线 + 各步产物。尤其 Step 2 L1~L4 四层根因全部直出 + 事实源行号引用（`docs/qa/costra-102-human-verify.md:32-38` / `docs/ops/migration-to-mac.md:274-275` / `project.config.json:42-43` 三点）· 是 D-017 §4 "流程产物" 规约的高质量落地范本。建议议入 SOP-DISPATCH-TEMPLATE 候选。

### G-2 · 非目标段 6 条显式排除
§1 "非目标（严格排除 · Review 不得追加）" 把方案 B/C 被否决、源码不改、CI 不扩展、评分表不改 6 条全列全。继承自 COSTRA-102 / COSTRA-122 的 §3.1 显式排除范式 · 防止 Review 顺手扩 scope。

### G-3 · 能力边界铁律的工程化表达（§3.3）
"Agent 禁止自称 runtime 已验证" + 要求 R1 §8 明文落能力边界声明文案 · 是 ADR-0004 v2 + COSTRA-114 v2 铁律的精确兑现。避免 Agent 因 "dispatch 要求跑 runtime" 而编造"已本地验证通过"。

### G-4 · 同族复发曲线证据链
§0 "121 假设证伪的因果链延伸" + §5 FU 衔接 "122 Retro 议题 3 升级为 P0" 两处明文承接 119→120→121→122→**第 5 次**的历史曲线。本卡是整个同族问题第一次**不只是修症状 · 还启动机制性反哺**（FU-CI-MP-BUILD-NPM-ENFORCE + FU-REVIEW-TECH-RUNTIME-DIM）。

### G-5 · D-016 第 12 次实战合规节奏
§7 执行节奏把 21:02~21:50 的 48 分钟精确切块 · 含 Agent 实装 + 自动 Review + Human 终审 · 符合 D-016 同轮兑现约束 · 无跨轮异步承诺。

---

## 3. 问题与建议

### P2-1 · "构建 npm" 在 Mac 工具版本差异下的措辞稳健性

- **严重度**：P2（非阻塞 · 但 Human 操作时若看不到该菜单项会懵）
- **现状**：§2 D2 §0.3.1 第 2 步写 "顶部菜单 **工具 → 构建 npm**"
- **潜在坑**：微信开发者工具 Stable `2.01.2510290`（Human 当前版本 · 从 §0 错误日志尾行可见）的"构建 npm"位置有时在 **工具菜单** · 有时在 **详情 → 本地设置 → "使用 npm 模块"勾选后 → 工具菜单出现"构建 npm"** · 取决于 `nodeModules:true` 是否已勾（当前 `project.config.json:22` 已 true · 理论上应立即出现）
- **建议**：§0.3.1 第 2 步后补一句 tip：
  > 若菜单"构建 npm"灰色或找不到 · 检查右上角 **详情 → 本地设置 → 使用 npm 模块** 是否勾选（对应根 `project.config.json setting.nodeModules:true`）。
- **阻断级别**：P2 · R1 实装时顺手在 §0.3.1 加这句即可 · 不拦 Review

### INFO-1 · `miniprogramNpmDistDir` 字段语义的补充验证（非阻）

- **来源**：§2 D1 释义段 "`miniprogramNpmDistDir: "./miniprogram/"` · 微信工具会自动在此目录下创建 `miniprogram_npm/` 子目录"
- **补充**：微信官方文档该字段确实是"构建产物**父目录**"（即工具自动创建 `miniprogram_npm/` 子目录），但历史上存在过把它误写为 `"./miniprogram/miniprogram_npm/"` 直接指向子目录本身的社区 issue · 两种写法在不同工具版本下行为**都**能跑通 · 但规范正确写法是父目录
- **动作**：dispatch 已按规范写法 ✅ · R1 实装时 **严格保持 `"./miniprogram/"`（非 `"./miniprogram/miniprogram_npm/"`）** · Reviewer 在 R1 时复核此字段精确匹配
- **不阻本卡**

### INFO-2 · 未来 dependency 增量的手册传播成本

- **来源**：§4 风险表第 6 行 "Human 忘记重跑构建 npm"
- **观察**：COSTRA-103（本地持久化）可能引入 `uuid` · COSTRA-111/112 可能引入 `dayjs` / `lodash-es` 等 · 每次 Human 都需要重跑"构建 npm"
- **根治方向**：FU-CI-MP-BUILD-NPM-ENFORCE（Sprint-2 COSTRA-124 候选）把"构建 npm"接入 CI · 在 PR 阶段即失败而非 Human 撞坑
- **本卡不扩展**：现阶段 §0.3.1 手册提醒 + §4.5 HR 风险声明足够 · 机制化留 Sprint-2

---

## 4. 契约一致性抽查（2 处）

### 4.1 `packNpmRelationList` 微信官方字段定义
- 微信 `project.config.json` schema 定义 `packNpmRelationList: [{packageJsonPath, miniprogramNpmDistDir}]`
- dispatch §2 D1 字段名 1:1 对齐 · ✅

### 4.2 `.gitignore:25 miniprogram_npm/` 兜底
- `.gitignore` 已忽略 `miniprogram_npm/` · 本卡构建产物本地生成后不入库 · 与 dispatch §2 D2 第 3 步 "（本地目录 · `.gitignore` 已忽略不入库）" 措辞一致 · ✅
- dispatch §2 D4 "不改 `.gitignore`" 正确

---

## 5. DoD 可测性审计

| DoD 编号 | 可测性 | 测试手段 | 结论 |
|---|---|---|---|
| D1 `project.config.json` 改 | 高 | JSON 解析 + 字段 diff | ✅ 自动化判定 |
| D2 §0.3.1 新增 | 高 | Markdown grep "构建 npm" / "miniprogram_npm" | ✅ |
| D3 `miniprogram/README.md §3` 补 | 高 | 同上 grep | ✅ |
| D4 "不改其他" | 高 | `git diff` 白名单外为零 | ✅ |
| §3.2 反向验证 3 次 | 中 | 手工篡改 + revert 流程日志 | ✅（手工但可留痕到 R1 §4） |
| §3.3 Runtime 验证 | **N/A · 归 Human** | 能力边界铁律 · Agent 禁止自称 | ✅（合规声明） |

**综合**：5/5 高可测性 · 1/5 归 Human（合规免测） → ✅ 完全适合 T2 单轨 35 分制

---

## 6. 时间盒可行性

- 21:02 派单 → 21:25 R1 预期完工（23 分钟）· 对照 122 实装 21 分钟（`round-1-miniapp-response.md` 交付时刻 20:18 vs 派单 19:57）· **本卡更简单**（配置 + 2 手册 · 无 as const 类型推导 · 无字段 1:1 对账脚本）· 预期 15~20 分钟可完工
- 21:25~21:40 Tech Review · T2 35 分制 · 预期 10~15 分钟
- 21:40~21:50 Human 终审 + 真机验证 · 核心动作是 **工具 → 构建 npm → 重跑 §1.1** · 预期 5~10 分钟
- **48 分钟总时长** · 压线但可行 · D-016 同轮兑现合规

---

## 7. 风险补充（Review 侧）

| Review 新增风险 | 概率 | 影响 | 应对 |
|---|---|---|---|
| R1 Agent 报告声称 "已在本机构建 npm 验证通过" | 中 | 高 | Review-Tech 硬查 R1 §8 能力边界声明 · 一旦自称即判 P0 REVISE |
| R1 Agent 额外改 `miniprogram/utils/money.ts` 想"双保险" | 低 | 中 | dispatch §1 非目标清单明文禁止 · R1 `git diff` 超出 3 文件即判 P1 扣分 |
| R1 Agent 在 `miniprogram/` 下新建 `package.json` 想走方案 B | 极低 | 高 | §1 非目标第 1 条硬排除 · Human 已明文裁决方案 A · R1 出现即判 P0 REJECT |

---

## 8. 签字与下一步

- **Reviewer**：Review-Agent-Tech
- **时间**：2026-05-01 21:05+08:00
- **同轮兑现**：本报告与 dispatch 在 Human `run miniapp COSTRA-123` 同一 tool call 循环内交付（D-016 第 12 次实战合规）
- **投票**：**APPROVE**（34/35 · P0=0 · P1=0 · P2=1 · INFO=2 · 均可在 Agent R1 实装首 5 分钟顺手处理）
- **给 Human 的建议**：卡定义已合格 · Orchestrator 立即拉起 MiniApp-Agent R1 实装（D-014-b 自动拉起规约）· 无需 Human 再手动触发

---

## 9. Refs

- `.team/dispatch/COSTRA-123-miniapp-fix-npm-bridge-for-decimal.md`（本次审对象）
- `.team/dispatch/COSTRA-122-miniapp-fix-tokens-json-runtime-import.md`（同族先例格式）
- `.team/decisions/D-013 / D-014 / D-016 / D-017`（规约依据）
- `project.config.json`（被改主体）
- `docs/qa/costra-102-human-verify.md` · `miniprogram/README.md`（手册被改主体）
