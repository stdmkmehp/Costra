# COSTRA-122 · tokens/index.ts JSON import runtime 兼容性修复（FU-TOKENS-JSON-RUNTIME-IMPORT 专项）

- 派发人：Orchestrator
- 接收人：**MiniApp-Agent**（无跨区 · 100% 在 `miniprogram/` 内）
- 派发时间：2026-04-28 19:57（Asia/Shanghai · Human 触发路径：第四次模拟器启动失败 → D-017 §第 2 步事实源三证齐全 → 根因定稿"121 假设证伪 · runtime 契约不兼容"）
- 本轮截止：2026-04-28 20:30（同轮 D-016 兑现 R1）
- 优先级：**P0**（阻 Human 本地验证 · 同族规约盲区第 4 次暴露 · 与 119/120/121 同源但根因层次不同）
- 闸门影响：G4 合并前必须到位 · 启动链推进到 app.ts 执行期后第 1 行 `import tokens from './tokens/index'` 必须 runtime 成功
- 分类：**COSTRA-121 假设证伪修复 · runtime 契约对齐 · 单一职责**（单文件改 · tokens/index.ts 内联化）
- Review 档位：**T2**（基建类小卡 · 无业务逻辑 · 纯 runtime 兼容性改写 · Tech 单轨 · D-013 判定）
- 估点：**1**（0.5 点代码改写 · 0.5 点 Review + FU 闭环 + 121 §13.7 复盘补遗）
- 依赖：COSTRA-121（已 Done · 工具链 SSOT 前置 · 本卡基于此展开）· COSTRA-011（Design-System v0.1 · tokens.json 作为 SSOT 来源）· COSTRA-030（MiniApp 骨架 · tokens/index.ts 原始生成时刻）
- 能力边界：**纯代码改动**（单文件 · 无 DNS / 无微信后台 / 无跨机联调 · Agent 能力边界内 100%）

---

## 0. 背景（为什么是本卡 · COSTRA-121 收官后的第四次验证失败 · 121 核心假设证伪）

### 事件时序

Human 于 2026-04-28 19:5x（COSTRA-121 整卡收官 @ 19:26 之后约 30 分钟）以"打开 `Costra/` 项目根"的正确姿势第四次重开微信开发者工具，模拟器启动推进到 app.ts 执行期，但**同样的错误仍然发生**：

```
[system] WeChatLib: 2.32.3 (2024.3.17 23:34:59)
[system] No. of subpackages: 2
[system] LazyCodeLoading: true
[system] Launch Time: 3440 ms         ← 启动时间与 121 前一致

app.js 错误：
Error: module 'tokens/tokens.json.js' is not defined,
       require args is './tokens.json'
    at q (VM55 WASubContext.js:1)
    at n (VM55 WASubContext.js:1)
    at index.ts:5                     ← tokens/index.ts:5 `import tokensJson from './tokens.json'`
    at app.ts:6                       ← app.ts:6 `import { tokens } from './tokens/index'`
    at f.runWith (VM55 WASubContext.js:1)
    (env: macOS,mp,2.01.2510290; lib: 2.32.3)

Page "pages/login/index" has not been registered yet
[system] Launch Time: 3440 ms
```

截图标题 `Costra - 微信开发者工具 Stable 2.01.2510290` · 与根 `project.config.json projectname: "costra"` 吻合 → 确认 Human 正确打开了项目根（121 D6 README 指引生效）。

### 事实源核查三证齐全（D-017 §第 2 步 · 含 git 追踪态核查）

| 核查点 | 状态 | 工具链 |
|---|---|---|
| 当前 HEAD = `c9826c4`（COSTRA-121 收官 commit） | ✅ | `git log --oneline -1` |
| 根 `project.config.json` 完整 58 行 | ✅ | `cat` + `git show HEAD:project.config.json` 一致 |
| `miniprogramRoot: "miniprogram/"` | ✅ | JSON 解析 |
| `setting.useCompilerPlugins: ["typescript"]` | ✅ | JSON 解析 |
| `miniprogram/project.config.json` 子副本 ❌ 不存在 | ✅ | `ls` + `.gitignore` 兜底生效 |
| `miniprogram/tokens/tokens.json` 物理 + git 追踪双存在 | ✅ | `git ls-files miniprogram/tokens/` + 文件系统 |
| `miniprogram/tokens/index.ts:5` 使用标准 TS JSON import | ✅ | `import tokensJson from './tokens.json'` |
| `tsconfig.json` 含 `resolveJsonModule: true` | ✅ | 第 12 行 |
| `npm run check:tooling` · 3/3 rules pass | ✅ | 121 D4 CI 首次实测通过 |
| **实测模拟器启动** | ❌ **同错误**（121 假设证伪） | Human 截图 |

**结论**：COSTRA-121 修复的是"工具链被正确读取"（D1 根 config + D2 子副本删除 + D3 .gitignore + D4 CI Rule-5），**但修完发现原问题本就不是工具链问题**——是**源码层** `tokens/index.ts:5` 的 JSON import 写法与微信 runtime 不兼容。

### 121 核心假设证伪

COSTRA-121 dispatch `§事件时序还原⑦` 的假设：

> ~~"运行期工具读子目录那份 → 未启用 TS 插件 → 裸 `import json from './x.json'` 无法转译 → 微信 runtime 回退到 commonjs require + 自动补 `.js` 扩展 → `tokens/tokens.json.js` not defined"~~

**实测证伪**：根 config 含 `useCompilerPlugins: ["typescript"]` 启用后，错误**依然发生**。这证明：

- **`useCompilerPlugins: ["typescript"]` 只负责 `.ts → .js` 转译**（把 tokens/index.ts 里的类型注解去掉并生成 JS）
- **它不改变 JSON 模块的 runtime 解析语义** —— 微信小程序 CommonJS loader 不识别 `.json` 扩展名作为可加载模块
- `import tokensJson from './tokens.json'` 在 tsc 侧（编译期）因 `resolveJsonModule: true` 绿通；到微信 runtime 侧被转成 `require('./tokens.json')` → loader 把 `.json` 当 JS 模块路径 → 找不到 → 自动补 `.js` → `tokens/tokens.json.js` not defined

### 真实根因（D-017 §第 3 步 定稿）

**微信小程序 runtime 的 CommonJS `require` loader 不支持 `.json` 扩展名加载**——这是一个**与工具链配置无关的 runtime 契约层盲区**。修复必须在**源码层**：把 JSON 数据改为 TS 常量内联（或等价手段），消除 runtime 侧对 `.json` loader 的依赖。

### 为什么五闸 + CI 规约族全绿仍然漏

1. `typecheck` 走 tsc（`resolveJsonModule: true`）→ 编译期 JSON import 合法 · 绿
2. `vitest` 走 vite（原生 JSON 支持）→ 绿
3. `eslint` 不查运行时行为 → 绿
4. `check:appjson`（Rule-1~4）只查 `app.json` 与文件 · 不查源码 JSON import → 绿
5. `check:whitelist` 域名方向 → 绿
6. `check:tooling`（Rule-5a/5b/5c）只查工具链配置 · 不查 runtime 契约 → 绿
7. **T2 档位纸面审 + 命令行五闸结构性漏检 "微信 runtime 才爆" 类代码兼容性** —— **与 119/120/121 同族第 4 次兑现**

### 与 COSTRA-118 Tech Review P0-9 的隐含关联（被忽略的预警）

COSTRA-118 Tech Review 第 218 行曾指出：`miniprogram/tokens/index.ts` 从 `tokens.json` 导出 `colors / shadows / radii` 但**未被任何 wxss 消费**。当时 review 只关注了"桥接未闭合"（wxss 侧不消费），**没有同步验证"桥接起点（index.ts 对 tokens.json 的 import）是否在 runtime 可加载"**。如果 118 Review 时做了运行期验证，本次盲区可提前 7 天发现。

→ 此教训也记入 Sprint-1 末 Retro 议题。

### 事件时序还原（定稿版）

```
① Sprint-0 骨架期（commit 5f4c8ee）：MiniApp-Agent 按 TS 语义写 tokens/index.ts:5
   `import tokensJson from './tokens.json'`  · tsconfig resolveJsonModule: true 支持 · 编译期全绿
② Sprint-0 Review COSTRA-030（20 分满分 21）→ P0/P1 聚焦在 env.ts / tabBar / subject · 未对账 runtime JSON 加载
③ COSTRA-118 Tech Review P0-9：发现 tokens.json → wxss 桥接未闭合 → 聚焦快修 app.wxss 变量命名
   但未对 `import tokensJson from './tokens.json'` 本身做 runtime 验证
④ Sprint-1 实装连续推进 115/116/119/120/121 · 启动链逐层推进
⑤ COSTRA-119 修 app.json 漂移 → 启动链进入 app.ts 执行期 → runtime JSON 加载盲区首次暴露
⑥ 暴露时 Orchestrator + MiniApp-Agent 根据错误栈"require args is './tokens.json'"误判为 TS 编译插件未启用（121 假设）
⑦ COSTRA-121 修工具链 SSOT · 三层 D1+D2+D3 物理 + D4 CI + D6 README → 事实层均修好
⑧ 第四次模拟器启动（本次 · Human 正确姿势）→ 同错误 → 121 假设证伪 → 真根因定稿：
   微信 runtime loader 不识别 .json 扩展名 · 必须源码层内联
```

---

## 1. 目标（单一职责）

把 `miniprogram/tokens/index.ts` 从"`import tokensJson from './tokens.json'`"改写为"**内联 TS 常量**"，消除对 runtime `.json` loader 的依赖，使 `app.ts:6 import { tokens } from './tokens/index'` 在微信模拟器中能够正确加载。

**非目标**：
- ❌ 改动 `tokens.json`（仍保留作为 SSOT 来源 · v0.2 后由 `scripts/sync-tokens.mjs` 生成 · 与 `index.ts:3` 原意图吻合）
- ❌ 改动 `app.ts` 或其他业务代码（tokens 导出 API 完全保持）
- ❌ 引入构建脚本（Sprint-1 末期不宜新增基础设施 · 留 Sprint-2 FU-118-3 根治方案）
- ❌ 扩展 CI 规约（本卡如需新增"禁止源码 JSON import"规约 · 交下一卡 COSTRA-123 立案 · 同族第 5 次）

---

## 2. 交付物（精确 Scope · 1 处改）

### D1 · `miniprogram/tokens/index.ts` 改写为内联常量

**当前**（证伪）：
```typescript
// tokens/index.ts · 从 docs/design/tokens.json 同步，只读常量
// 卡号: COSTRA-030 · COSTRA-011
// ⚠️ 禁止手改；由 scripts/sync-tokens.mjs 生成（v0.2 接入 DevOps 工作流）

import tokensJson from './tokens.json';

export const tokens = tokensJson;
export type Tokens = typeof tokens;

export const color = tokens.color;
export const spacing = tokens.spacing;
export const radius = tokens.radius;
// typography / shadow：v0.2 由设计同步后开放导出。
```

**目标**：把 `tokens.json` 的内容作为 **`as const` TS 常量直接内联**，消除 JSON import。保持导出签名完全一致。

**实装步骤**：
1. 读 `miniprogram/tokens/tokens.json`（当前内容必须 1:1 字段对齐 · 不允许任何业务语义变更）
2. 在 `tokens/index.ts` 里把 JSON 写成 `const tokensData = { ... } as const;`
3. `export const tokens = tokensData;` · `export type Tokens = typeof tokens;`（TS `as const` 让类型自动窄化 · 与原 `typeof tokensJson` 等价）
4. `color / spacing / radius` 三个命名导出保持不变（from `tokens.color` / `tokens.spacing` / `tokens.radius`）
5. 顶部注释更新：
   - 保留"卡号: COSTRA-030 · COSTRA-011 · **COSTRA-122**"
   - 改"由 sync-tokens.mjs 生成"→ "由 sync-tokens.mjs 生成（Sprint-2 FU-118-3 落地）· 当前阶段手工与 tokens.json 对齐"
   - **新增一行硬约束**：`// ⚠️ 不要改为 "import x from './tokens.json'"——微信 runtime 不支持 .json loader（COSTRA-122 实证）`

### D2 · `miniprogram/tokens/tokens.json` 保留不动

- **不删除** · 仍作为设计 SSOT（与 `docs/design/tokens.json` 同步根）· 供 Sprint-2 构建脚本消费
- 原注释"由 sync-tokens.mjs 生成"的治理意图保留（脚本延到 Sprint-2 落地 · 当前 TS 侧手工对齐）

### D3 · 无其他改动

- ❌ 不改 `app.ts` / `app.json` / `project.config.json` / `tsconfig.json` / `package.json`
- ❌ 不改任何 CI 脚本 · 不动 `.gitignore`
- ❌ 不加单元测试（T2 档位基建小卡 · 非业务逻辑 · 闸门用五闸兜底）

---

## 3. 验证方案（五闸 + 静态对账）

### 五闸（Agent 本地）
1. `npx tsc --noEmit` · exit 0（无类型错误 · `as const` 类型推导与原 `typeof tokensJson` 等价）
2. `npm run lint` · exit 0
3. `npx vitest run` · 13/13 pass · ms 级
4. `npm run check:appjson` · exit 0
5. `npm run check:tooling` · exit 0（不受本卡影响）
6. `npm run check:whitelist` · exit 0（不受本卡影响）

### 静态对账（源码）
- `grep -r "from '.*\.json'" miniprogram/` → 应为空（确认无 JSON import 遗留）
- `diff <(jq -S . miniprogram/tokens/tokens.json) <(node -e "const { tokens } = require('./miniprogram/tokens/index'); console.log(JSON.stringify(tokens, null, 2))" | jq -S .)` →（若 node 直接加载需处理 TS · 可简化为手工对照 tokens.json 字段 vs index.ts 内联字段 1:1 对齐）

### Runtime 验证（Human 现场 · 第五次模拟器启动）
- 以"打开 `Costra/` 项目根"姿势重开微信开发者工具
- 期望：**app.ts:6 不再报 `module ... not defined`** · 启动链推进到 `wx.reLaunch({ url: '/pages/login/index' })` · 登录页正常显示

---

## 4. 反向验证（源码层 · 参照 121 Rule-5a/5b/5c 范式）

Agent 本地临时做 3 种篡改 · 每种篡改都应触发 tsc/lint/grep 至少一项拦截 · 然后 revert：

1. **Reverse-1**：改回 `import tokensJson from './tokens.json'` → `grep -r "from '.*\.json'" miniprogram/` 命中 → 规约告警（本卡静态对账可硬拦截）
2. **Reverse-2**：内联常量丢一个字段（如 `color` 缺一个键） → `tsc` 可能仍过（结构完整）但 **手工 diff 应发现** → 提示后续 Sprint-2 构建脚本必要性
3. **Reverse-3**：把 `as const` 去掉 → `typeof tokens` 类型窄化失效 → 下游若有 `tokens.color.brand.primary` 具体字面量消费会提示 `string` 过宽（但当前 3 个命名导出用法足够宽容 · 可能仍过 · 记入 Review 风险）

**反向验证的意义与 121 不同**：121 是 CI 规约反向验证（Rule-5a/b/c 篡改配置 → CI 拦截），本卡因**暂不引入新 CI 规约**（避免 scope 扩散），反向验证退化为"静态对账 + 类型推导验证"。如需机制化，由后续卡立案。

---

## 5. 风险（Review-Tech 对账表）

| 风险 | 概率 | 影响 | 缓解 |
|---|---|---|---|
| 内联 TS 常量与 tokens.json SSOT 漂移 | 中 | 中 | 顶部注释硬约束 · Sprint-2 FU-118-3 构建脚本根治 · 本卡不阻 |
| `as const` 类型窄化导致下游消费（color.brand 等）类型过严 | 低 | 低 | 原 JSON import 时类型已是 `typeof tokensJson`（JSON 原生结构）· 新 `typeof tokensData` 结构完全一致 · 理论等价 |
| Reviewer 质疑"为何不直接用 require（./tokens.json）" | 低 | 低 | dispatch §0 已证伪此路径 · 微信 runtime CommonJS loader 不识别 .json 扩展 · 同族问题 |
| 新增 Sprint-2 FU-118-3 与本卡耦合 | 低 | 低 | 本卡完全不依赖构建脚本 · FU-118-3 是锦上添花的"消除手工对齐"· 独立演进 |
| 测试用例未新增导致 regress 风险 | 低 | 低 | tokens.color/spacing/radius 为纯常量导出 · 无业务逻辑 · 五闸 + 静态对账足以兜底 |
| Human 第五次模拟器启动仍失败（还有第 5 层盲区） | 低 | 极大 | D-017 v2 议题加固："runtime 实测必须作为 T2 档 runtime 规约类卡的终审证据" · 若本卡仍失败 · Orchestrator 立即立 COSTRA-123 延伸 |

---

## 6. Review-Tech 档位与 FU 衔接

- **档位**：T2 单轨 · Tech-Agent 一轮（D-013）· 分制 35 分
- **评分方向**：
  - 契约一致性 · 5 分（tokens.json 字段 vs 内联字段 1:1）
  - runtime 契约对齐 · 5 分（验证"微信 runtime 不识别 .json loader"假设 · 本卡正向兑现）
  - 代码质量 · 5 分（`as const` + 类型导出保持）
  - 五闸全绿 · 5 分
  - 静态对账 · 5 分
  - Scope 严守 · 5 分（1 文件 · 无跨文件泄漏）
  - 治理反哺 · 5 分（121 §13.7 v1.3 收官后复盘 · FU 状态流转 · D-017 v2 加固议题）
- **FU 衔接**：
  - 新 `FU-TOKENS-JSON-RUNTIME-IMPORT` 同轮登记 + 同轮 closed（resolved_by COSTRA-122）
  - `FU-COMMON-PROJECT-CONFIG-DRIFT`（121 closed）追加"收官后复盘备注"：121 假设证伪但 121 物理修复仍全部必要（工具链 SSOT 本就该修）· 本卡补最后一层
  - 121 Review §13.7 v1.3 收官后复盘补遗（Orchestrator 撰 · 约 40 行五段位）

---

## 7. 产出模板（响应结构 · 对齐 121）

MiniApp-Agent 的 `round-1-miniapp-response.md` 必须包含：

1. §1 改动总览（1 文件 · 诊断到修复全链路）
2. §2 精确改动 patch（unified diff 格式）
3. §3 验证输出（五闸 + 静态对账 · 完整 stdout/stderr）
4. §4 反向验证 3 次（静态对账 + 类型推导）
5. §5 121 假设证伪确认（承认 121 核心因果链不成立 · 物理修复仍必要 · 本卡补全 runtime 层）
6. §6 自我评分（35 分制 · 预估）
7. §7 风险声明 + 未来工作（FU-118-3 构建脚本 · Sprint-2）

---

## 8. 执行节奏（D-016 同轮兑现 · 第 11 次实战）

```
19:57  Orchestrator 派单（本文件）
19:58~20:15  MiniApp-Agent R1 实装（代码 + 响应文档 + 五闸 + 静态对账）
20:15~20:25  Orchestrator 自动拉起 Tech Review
20:25  Tech APPROVE（预期）
20:25~  Human 终审 + 第五次模拟器启动验证
20:30  若通过 · 整卡收官 + D-012 commit
```

---

## 9. 裁决钩子

本卡不需要跨区授权（纯 `miniprogram/` 内）· 可直接 `run miniapp COSTRA-122` 启动。

**Human 决策点 · 两种路径**：
- 路径 A（推荐）：`run miniapp COSTRA-122` · 走正式 D-014 卡定义 Review + R1 实装 + Tech Review + 终审全流程（约 30 分钟 · 含 Human 终审）
- 路径 B（快修授权）：Human 直接授权 "Orchestrator 代执行本卡 D1 + 五闸 · 跳过卡定义 Review" · 约 10 分钟收官 · 本卡 scope 只 1 文件极小 · 风险可控

---

_派发完成 · 等 Human 选择路径 A 或路径 B_
