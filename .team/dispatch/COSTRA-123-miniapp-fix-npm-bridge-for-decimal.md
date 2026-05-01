# COSTRA-123 · MiniApp npm 构建桥接 + 验证手册补丁（decimal.js runtime 漏检修复）

- 派发人：Orchestrator
- 接收人：**MiniApp-Agent**（无跨区 · 100% 在 `miniprogram/` 工作区 + `project.config.json` 根配置 + `docs/qa/` 验证手册）
- 派发时间：2026-05-01 21:02（Asia/Shanghai）
- 本轮截止：2026-05-01 22:00（D-016 同轮兑现 · 第 12 次实战）
- 优先级：**P0**（阻 Human COSTRA-102 §1.1 本地验证 · 同族规约盲区第 5 次暴露 · 与 119/120/121/122 同源）
- 闸门影响：COSTRA-102 T1 终审前置 · 本卡通过后 Human 才可重跑 `§1.1 一键微信登录`
- 分类：**runtime 契约对齐 · 工具链桥接** · 单一职责（配置 + 手册两处 · 零业务代码改动）
- Review 档位：**T2**（基建小卡 · 无业务逻辑 · 纯配置与手册 · Tech 单轨 · D-013 判定）
- 估点：**1**（0.5 点配置 + 手册 · 0.5 点 Review + FU 闭环 + 122 同族复盘第 5 次补遗）
- 依赖：COSTRA-102 R1（已 Done · decimal.js 已引入 `package.json:21`）· COSTRA-121（工具链 SSOT · 根 `project.config.json` 为 SSOT）· COSTRA-122（runtime 契约盲区同族前置）
- 能力边界：**纯配置与文档改动**（无 DNS / 无微信后台 / 无跨机联调 · Agent 能力边界 100% 覆盖）

---

## 0. 背景 · D-017 全流程产物索引（Step 1→5）

### 事件时序

```
2026-05-01 20:33  Human 按 docs/qa/costra-102-human-verify.md §1.1 点击「一键微信登录」
                  微信开发者工具报错：
                  Error: module 'utils/decimal.js' is not defined, require args is 'decimal.js'
                     at money.ts:6  (import Decimal from 'decimal.js')
                     at pages/home/index.ts:6  (import { formatMoney } from '../../utils/money')

2026-05-01 20:35  Human 触发 D-017 · 要求先拉 Review-Agent-Tech 做过程复盘
                  （不同于 D-017 §2.2 Step 2 的领域 Agent 根因分析 · Human 特地追加了"过程审"）

2026-05-01 20:35~20:55  Review-Agent-Tech 产出 R1~R5 复盘报告（对话内直出 · 未落盘）
                  R1: decimal.js 七环链共同漏检
                  R2: 手册孤岛（只有迁机手册记载"构建 npm"）
                  R3: Review-Tech 35 分评分表缺"runtime 加载性"维度
                  R4: CI 命令行五闸 vs 微信 runtime 结构性落差（122 已自证伪一次）
                  R5: 119→120→121→122→本次 为同族盲区第 5 次复发（与 122 Retro 议题预测吻合）

2026-05-01 21:00  Human 裁决：**方案 A**（配置 packNpmRelationList 桥接 · 不新建 miniprogram/package.json · 不手工 copy vendor）

2026-05-01 21:02  Orchestrator 派单本卡 · D-017 Step 5 启动
```

### D-017 §2.2 五步流程留痕

- **Step 1 责任领域识别**：错误关键字 `module ... is not defined` + 微信 `WASubContext.js` + `import 'decimal.js'` → **MiniApp-Agent**（对照 D-017 §3 责任矩阵"微信运行时/模块解析"）。Orchestrator 代职完成 Step 2/3 根因+方案（因 Human 首轮催促时 Orchestrator 已直接产出并得 Human 首肯继续）。
- **Step 2 分层根因**（L1/L2/L3/L4）：
  - L1 表面：`decimal.js` 被微信解析成相对路径 `utils/decimal.js`，找不到。
  - L2 文档：`docs/qa/costra-102-human-verify.md:32-38` §0.3 仅写 `npm install / typecheck / test`，未提"构建 npm"；`miniprogram/README.md §3`（:32-43）同缺。"构建 npm"知识孤立在 `docs/ops/migration-to-mac.md:274-275, 363-364`（迁机手册）。
  - L3 设计：小程序 npm 模型要求 `<miniprogramRoot>/miniprogram_npm/xxx/` 下有构建产物；当前 `miniprogramRoot:"miniprogram/"` 且无 `miniprogram/package.json`，即使 Human 点"构建 npm"也无处可构建。`project.config.json:42-43` 的 `packNpmManually:false` + 空 `packNpmRelationList` 是占位默认，从未做桥接。
  - L4 机制：T2 档位 Review 评分表 7 维无"runtime 加载性"；CI 五闸（tsc/lint/vitest/check:appjson/check:tooling/check:whitelist）全绿不保 runtime 可加载；`miniapp-tooling-check.mjs:28-31` 的"保证运行期"承诺已被 122 证伪但修补未落地。
- **Step 3 方案对比**：A（`packNpmRelationList` 桥接根 `node_modules`）· B（子 `package.json` 双安装）· C（vendor 手工 copy UMD）。对话内已输出方案表。
- **Step 4 Human 裁决**（21:00）：**方案 A**。理由认同"复用 SSOT + 与 `docs/ops/migration-to-mac.md` 既有约定自洽 + 零代码改动"。
- **Step 5 派单实装**：即本 dispatch。

### 121 假设证伪的因果链延伸

`.team/reviews/COSTRA-122/round-1-tech.md:67-72` 证伪过 `useCompilerPlugins:["typescript"]` "保证运行期"的错觉：**TS 编译插件只做 `.ts → .js` 转译，不改变 runtime 模块解析语义**。本卡是同一结构第 5 次兑现：
- 121 盲区：微信 runtime 不识别 `.json` 扩展名 loader
- **本卡盲区**：微信 runtime 要求"npm 包"有 `miniprogram_npm/<pkg>/` 构建产物，不会读根 `node_modules/`

两者都是"**编译期工具链 ≠ runtime 加载契约**"这一结构盲区在不同模块类型上的折射。

---

## 1. 目标（单一职责）

让 `miniprogram/utils/money.ts:6` 的 `import Decimal from 'decimal.js'` 在微信开发者工具 runtime 中可成功加载，**通过配置层桥接根 `node_modules/decimal.js` 到 `miniprogram/miniprogram_npm/decimal.js/`**，并在 Human 验证手册补齐"构建 npm"步骤。

**非目标**（严格排除 · Review 不得追加）：
- ❌ 新建 `miniprogram/package.json`（方案 B · 被 Human 否决 · 会制造双 package.json 漂移风险）
- ❌ 手工 copy `decimal.min.js` 到 `miniprogram/vendor/`（方案 C · 被 Human 否决 · 违反 ADR-0002 npm 语义）
- ❌ 修改 `miniprogram/utils/money.ts` 或任何业务代码（runtime 解析由配置层解决 · 源码零改）
- ❌ 新增 CI 规约校验 `miniprogram_npm/` 存在性（Sprint-2 独立立卡 · 本卡不扩展 scope · 候选卡号 COSTRA-124）
- ❌ 升级 `scripts/mp-ci/build-check.mjs` 接入 miniprogram-ci 真实编译（同上 · 归 Sprint-2）
- ❌ 修改 Review-Agent-Tech 评分表（档位机制变更 · 归 Sprint-1 末 Retro 议题）

---

## 2. 交付物（精确 Scope · 3 处改）

### D1 · `project.config.json` 配置桥接（核心修复）

**当前**（`:42-43`）：
```json
    "packNpmManually": false,
    "packNpmRelationList": [],
```

**目标**：
```json
    "packNpmManually": true,
    "packNpmRelationList": [
      {
        "packageJsonPath": "./package.json",
        "miniprogramNpmDistDir": "./miniprogram/"
      }
    ],
```

**语义释义**（供 Review 对账）：
- `packNpmManually: true` · 关闭"自动去 `<miniprogramRoot>` 下找 `package.json`"的默认行为，改为读 `packNpmRelationList` 显式声明。
- `packageJsonPath: "./package.json"` · 相对 `project.config.json` 所在目录，即仓库根 `package.json`（`decimal.js` 的 SSOT 声明位）。
- `miniprogramNpmDistDir: "./miniprogram/"` · 构建产物落点目录（微信工具会自动在此目录下创建 `miniprogram_npm/` 子目录），正好对齐 `miniprogramRoot:"miniprogram/"`。

其他字段（`nodeModules:true` 保持 · 其余 `setting` 不动）。

### D2 · `docs/qa/costra-102-human-verify.md §0.3` 补"构建 npm"步骤

**当前**（`:32-38`）：
```bash
cd /Users/weizhao/Desktop/Costra
npm install                    # 装 decimal.js（运行时）+ vitest（开发时）
npm run typecheck              # 期望：无错误退出（exit 0）
npm test                       # 期望：11 条单测全绿（含 money P0-1 防浮点 · time P0-8 防双减）
```

**目标**：在 `npm test` 之后、§0.3 末尾新增一小节 **"0.3.1 微信开发者工具首次准备（必做）"**：

```markdown
### 0.3.1 微信开发者工具首次准备（首次 / 依赖变更后必做）

1. 以 `/Users/weizhao/Desktop/Costra` 项目根打开微信开发者工具（**不要**打开 `miniprogram/` 子目录 · 见根 README §本地开发 · COSTRA-121 规约）
2. 顶部菜单 **工具 → 构建 npm**
3. 等待完成 · 观察左下角提示 "构建完成" · 工具会生成 `miniprogram/miniprogram_npm/decimal.js/`（本地目录 · `.gitignore` 已忽略不入库）
4. 若未做此步 · §1.1 登录后会报 `module 'utils/decimal.js' is not defined, require args is 'decimal.js'`（COSTRA-123 同族盲区第 5 次）
5. 后续 `package.json` `dependencies` 任一变更后 · 重跑本步
```

### D3 · `miniprogram/README.md §3 快速上手` 同步补"构建 npm"步骤

**当前**（`:31-43`）：
```markdown
## 3. 快速上手

​```bash
# 安装依赖（CI 与本地 typecheck/lint 用）
npm install

# 复制私有配置示例
cp project.private.config.json.example project.private.config.json

# 打开微信开发者工具 → 导入项目
# 项目目录：本仓库根目录
# AppID：wxf8b0d3e3a83f9941（或你的体验版 AppID）
​```
```

**目标**：在 `# AppID:` 后追加：

```markdown
# 打开后首次必做：顶部菜单 工具 → 构建 npm
# （会在 miniprogram/miniprogram_npm/ 生成 npm 包的小程序构建产物 ·
#  包括 decimal.js · 本目录已 .gitignore 忽略不入库 ·
#  后续 package.json dependencies 变更后需重跑 · COSTRA-123）
```

### D4 · 无其他改动

- ❌ 不改 `miniprogram/utils/money.ts` / `money.spec.ts`
- ❌ 不改 `package.json` / `tsconfig.json` / `.gitignore`（`.gitignore:25` 已有 `miniprogram_npm/` · 无需重复）
- ❌ 不改 `.github/workflows/*.yml` / `scripts/mp-ci/*.mjs` / `scripts/devops/*.mjs`

---

## 3. 验证方案

### 3.1 Agent 本地五闸 + 静态对账

| # | 命令 / 核对 | 期望 |
|---|---|---|
| 1 | `npx tsc --noEmit` | exit 0（配置变更不影响类型） |
| 2 | `npm run lint` | exit 0 |
| 3 | `npx vitest run` | 13/13 pass |
| 4 | `npm run check:appjson` | exit 0 |
| 5 | `npm run check:tooling` | exit 0（本卡不改 Rule-5a/5b/5c 覆盖域 · 预期仍绿） |
| 6 | `npm run check:whitelist` | exit 0 |
| 7 | JSON 合法性：`node -e "JSON.parse(require('fs').readFileSync('project.config.json','utf8'))"` | 无报错 |
| 8 | 字段对账：`project.config.json` 含 `packNpmManually:true` + `packNpmRelationList[0].packageJsonPath="./package.json"` + `miniprogramNpmDistDir="./miniprogram/"` | 1:1 匹配本 dispatch §2 D1 |
| 9 | 手册对账：`docs/qa/costra-102-human-verify.md` 含 §0.3.1 四步；`miniprogram/README.md` §3 含"构建 npm"提示 | 关键字 `构建 npm` / `miniprogram_npm` 两处均命中 |

### 3.2 反向验证（静态对账）

Agent 在 R1 报告中**本地临时做 3 种篡改 + revert**，每种应被 §3.1 对账发现：
1. **Reverse-1**：删除 `packNpmManually:true` 字段 → §3.1 #8 对账失败
2. **Reverse-2**：`packageJsonPath` 改为 `"./miniprogram/package.json"` → §3.1 #8 对账失败（文件不存在且偏离方案 A 意图）
3. **Reverse-3**：手册里删除 §0.3.1 → §3.1 #9 对账失败

（本卡不引入新 CI 规约做机制化反向拦截 · 归 COSTRA-124 候选 · 参照 122 dispatch §4 范式）

### 3.3 Runtime 验证（Human 现场 · 非 Agent 可执行 · 能力边界铁律）

Agent **禁止**自称"runtime 已验证"。R1 报告 §runtime-verify 章节必须明文写：

> "Runtime 验证由 Human 2026-05-01 21:xx 亲自执行：重开微信开发者工具 → 工具 → 构建 npm → 重新编译 → 再点击 §1.1「一键微信登录」· 期望 `money.ts:6` 不再报 `module ... is not defined` · 登录流程推进到 §1.2 期望项。Agent 无真机权 · 以上为待验证声明。"

---

## 4. 风险（Review-Tech 对账表）

| 风险 | 概率 | 影响 | 缓解 |
|---|---|---|---|
| `packNpmManually:true` 语义理解偏差（字面"手动"误读为"需手工 copy"） | 低 | 低 | dispatch §2 D1 释义段明文解释 · Review 可查证微信官方文档 |
| `miniprogramNpmDistDir:"./miniprogram/"` 与 `miniprogramRoot:"miniprogram/"` 冲突错觉 | 低 | 低 | 微信工具实际在 `miniprogramNpmDistDir` 下创建 `miniprogram_npm/` 子目录 · 两字段语义正交 |
| `package.json` 中 `decimal.js` 之外还有 `devDependencies`（vitest / typescript / eslint …）是否误构建 | 中 | 低 | 微信 npm 构建只处理 `dependencies` · `devDependencies` 不纳入（微信官方行为）· 本卡不触达此边界 |
| Human 忘记"构建 npm"步骤复发 | 中 | 中 | 手册 §0.3.1 #4 明文写出错误信号 + 关联 COSTRA-123 · Human 看到同错误可立即回溯 |
| 后续新增 dependency（如 uuid / dayjs）时 Human 忘记重跑"构建 npm" | 中 | 中 | 手册 §0.3.1 #5 明文"`package.json` `dependencies` 任一变更后 · 重跑本步" |
| 本次修复仍无法跑通（runtime 还有第 6 层盲区） | 低 | 极大 | Human 21:xx 验证失败 → 立即启动 D-017 第 6 次实战 + 立新 COSTRA-124 延伸 · 不污染本卡 |
| Sprint-1 末 Retro 议题堆积（5 次同族复发后仍未落地 runtime 实测规约） | 高 | 中 | 本卡 §7 明文登记 **"Sprint-1 末 Retro 强制议题 P0"** · Orchestrator 不得再延期 |
| 验证手册 §0.3.1 与 `migration-to-mac.md:274-275` 文字漂移 | 中 | 低 | §0.3.1 文字与 `migration-to-mac.md` 对齐措辞 · 两处同用"工具 → 构建 npm" + `miniprogram_npm` 术语 |

---

## 5. Review-Tech 档位与 FU 衔接

- **档位**：T2 单轨 · Tech-Agent 一轮（D-013）· 35 分制
- **评分方向**：
  - 契约一致性（packNpmRelationList 字段语义对齐微信官方文档）· 5 分
  - runtime 契约对齐（方案 A 正向兑现 · 消除 `node_modules` 与 `miniprogram_npm` 语义鸿沟）· 5 分
  - 代码质量（JSON 合法 + 无源码改动）· 5 分
  - 五闸全绿（7+ 条对账命令）· 5 分
  - 静态对账（字段 + 手册关键字双重）· 5 分
  - Scope 严守（配置 + 两手册 · 零源码 · 零 CI 扩展）· 5 分
  - 治理反哺（Retro 议题加固 + 同族第 5 次复盘 + D-017 v2 升级证据 + FU 衔接）· 5 分
- **FU 衔接**：
  - 新建 **FU-MINIAPP-NPM-BRIDGE**（本卡解决） · 同轮登记 + 同轮 closed（resolved_by COSTRA-123）
  - 候选新 FU **FU-CI-MP-BUILD-NPM-ENFORCE**：CI 层引入 miniprogram-ci 真实构建冒烟 · 结构性消除"命令行五闸 vs 微信 runtime 落差" · 归 **Sprint-2**（候选卡 COSTRA-124）
  - 候选新 FU **FU-REVIEW-TECH-RUNTIME-DIM**：Review-Agent-Tech 35 分评分表新增"runtime 加载性"维度 · 归 **Sprint-1 末 Retro 必议题**（从 122 Retro 议题 1/2 升级为硬规约修订候选）
  - 122 Retro 议题 3 ("同族盲区紧迫性")：本卡为**第 5 次复发**实证 · Retro 议题升级为 **P0 · 强制 Sprint-2 头部立 Epic-F 或独立专项**

---

## 6. 产出模板（R1 响应结构 · 对齐 122）

MiniApp-Agent 的 `round-1-miniapp-response.md` 必须包含：

1. §1 改动总览（3 处改 · 诊断到修复全链路 · D1/D2/D3 小结）
2. §2 精确改动 patch（unified diff 格式 · `project.config.json` + 两份 markdown）
3. §3 验证输出（§3.1 五闸 + 静态对账 9 条 · 完整 stdout/stderr）
4. §4 反向验证 3 次（静态对账 · 篡改 → 发现 → revert）
5. §5 D-017 全流程留痕确认（Step 1~5 映射本 dispatch §0 时序 · 无跳步）
6. §6 自我评分（35 分制 · 预估）
7. §7 风险声明 + 未来工作（FU-CI-MP-BUILD-NPM-ENFORCE · FU-REVIEW-TECH-RUNTIME-DIM · Retro 议题升级）
8. §8 runtime 验证声明（§3.3 能力边界硬约束 · Agent 禁止自称验证通过）
9. §9 commit message 草案（`fix(repo): add npm bridge for miniapp decimal.js runtime loading (COSTRA-123)`）

---

## 7. 执行节奏（D-016 同轮兑现 · 第 12 次实战）

```
21:02  Orchestrator 派单（本文件）
21:03~21:25  MiniApp-Agent R1 实装（3 处改 + 响应文档 + 五闸 + 静态对账 + 反向 3 次）
21:25~21:40  Orchestrator 自动拉起 Tech Review（D-014-b 自动拉起规约）
21:40  Tech APPROVE（预期 · 配置 + 手册简单 · 无业务风险）
21:40~  Human 终审 + 第 6 次模拟器启动验证：
         · 重开微信开发者工具 → 工具 → 构建 npm → 重新编译
         · 再跑 costra-102-human-verify §1.1 一键微信登录
21:50  若通过 · 整卡收口 + D-012 commit + COSTRA-102 §1.1 重跑状态恢复
```

---

## 8. 裁决钩子

- **Human 已裁决（21:00）**：选定方案 A · 对应本卡 §2 D1/D2/D3
- 本卡无跨区授权需求（`miniprogram/` + 根 `project.config.json` + `docs/qa/` + `miniprogram/README.md`）· 可直接 `run miniapp COSTRA-123` 启动
- 若 Human 希望**跳过 D-014-a 卡定义 Review**（本卡 scope 极小 · 风险可控）· 可下令 "D-017 E3 · 直接派实装"· Orchestrator 在 dispatch §0 记录该指令并跳过卡定义 Review 环节

---

## 9. 与 D-017 规约的互文

- 本卡是 **D-017 第 3 次实战**（首次 COSTRA-120 · 第二次未记录独立案例 · 本次 COSTRA-123）
- D-017 §7 演进路径第 1 条："Sprint-1 末 Retro · 若 > 3 次全符合 · 可升级为定稿规约" —— 本卡是**第 3 次** · 即将触发升级评估
- D-017 §5 反模式 A/B/C/D 本卡全部规避（方案 A/B/C 三选 + 分层根因 + 责任 Agent 派单 + Human 裁决留痕）

---

_派发完成 · 等 MiniApp-Agent R1 或 Human 复核本 dispatch（推荐：可直接 `run miniapp COSTRA-123` 进入实装）_
