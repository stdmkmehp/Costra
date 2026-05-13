# Follow-ups · 已闭合归档（Sprint-1 + Sprint-2 早期）

> 本文档归档 Sprint-1 ~ Sprint-2 早期已 `closed` 的 FU 条目 · 完整治理叙事原文。
>
> **归档时间**：2026-05-12（COSTRA-105 R1 期间整理）
> **归档原因**：主文件 `.team/follow-ups/README.md` 已增长至 1100+ 行 · 折叠已闭合条目以聚焦 open 条目
> **追溯方式**：主文件保留索引表 · 详情查本文档

---

## 一、闭合 FU 速查表（13 条）

| FU-ID | 主题 | 闭合卡 | 闭合时间 |
|---|---|---|---|
| FU-118-6 | money.ts 引入 decimal.js（ADR-0002 硬约束）| COSTRA-102 R1 | 2026-04-27 10:12 |
| FU-COMMON-DEV-URL-DRIFT | 三源 dev URL/端口不一致（127.0.0.1:3000 vs localhost:8080）| COSTRA-116 R1 | 2026-04-27 |
| FU-115-1 | whitelist-check.mjs dev 豁免收紧 | COSTRA-116 R1 | 2026-04-27 |
| FU-COMMON-APP-JSON-DRIFT | app.json 分包声明与文件系统不一致（同族第 1 次）| COSTRA-119 R1 | 2026-04-27 |
| FU-COMMON-APP-JSON-DRIFT-TABBAR | tabBar 指向分包违反微信规约（同族第 2 次 · 119 P0 逃逸）| COSTRA-120 R1 | 2026-04-28 |
| FU-COMMON-PROJECT-CONFIG-DRIFT | 微信工具链 project.config.json 单源漂移（同族第 3 次）| COSTRA-121 + COSTRA-122 | 2026-04-29 10:48 |
| FU-TOKENS-JSON-RUNTIME-IMPORT | 微信 runtime 不识别 .json loader（同族第 4 次）| COSTRA-122 R1 | 2026-04-29 10:48 |
| FU-MINIAPP-NPM-BRIDGE | npm 构建桥接 / decimal.js runtime 加载（同族第 5 次）| COSTRA-123 R1 | 2026-05-01 21:28 |
| FU-LAUNCH-A | 顶层副作用 ensureVersion 裸调（FU-LAUNCH 子 FU）| COSTRA-124 R1 | 2026-05-02 |
| FU-LAUNCH-B | 渲染层 storage group `_prepare` 时序（FU-LAUNCH 子 FU）| COSTRA-125 + COSTRA-126 | 2026-05-08 |
| FU-LAUNCH-C | 首渲染数据投递错位（FU-LAUNCH 子 FU）| COSTRA-127 | 2026-05-08 17:55 |
| **FU-LAUNCH-FIRST-RENDER-RACE**（父）| 启动期首渲染时序警告族（A/B/C 全闭合）| COSTRA-127 | 2026-05-08 17:55 |

---

## 二、主题族归档

### 族 1 · 同族规约盲区"5 连"（已全闭合）

> **治理叙事**："Sprint-0 骨架期遗留微信规约债务"被动剥洋葱式遭遇 · 共同结构 = "编译期工具链 ≠ runtime 加载契约"

| # | FU | 卡 | 层 | Console 现象 |
|---|---|---|---|---|
| 1 | FU-COMMON-APP-JSON-DRIFT | COSTRA-119 | 文件存在性（L1）| `pages-stat/overview/index` 不存在 |
| 2 | FU-COMMON-APP-JSON-DRIFT-TABBAR | COSTRA-120 | 微信规约（L3）| `["tabBar"][N]["pagePath"]: "xxx" need in ["pages"]` |
| 3 | FU-COMMON-PROJECT-CONFIG-DRIFT | COSTRA-121 | 工具链单源（L4）| 工具无法打开项目（根 config 缺失 + 子 config GUI 噪声）|
| 4 | FU-TOKENS-JSON-RUNTIME-IMPORT | COSTRA-122 | runtime loader 契约 | `module 'tokens/tokens.json.js' is not defined` |
| 5 | FU-MINIAPP-NPM-BRIDGE | COSTRA-123 | npm 构建桥接 | `module 'utils/decimal.js' is not defined` |

**沉淀产物**：
- CI 对账族 3 脚本：`check:whitelist`（115）/ `check:appjson`（119+120 4 Rule）/ `check:tooling`（121 3 Rule）
- D-011 SSOT 规约工具链层首次实战（121）
- D-017 验证问题响应 SOP（120 立案 · 121/122/123 三次实战 · 123 首次完整走完五步）
- 反模式 #1~#3 沉淀至 `docs/devops/libversion-upgrade.md`

### 族 2 · FU-LAUNCH 启动期治理（5 卡 · v1→v5 经历 4 次定性翻转）

> **治理叙事**：父 FU `FU-LAUNCH-FIRST-RENDER-RACE` 经历 7 次观察 · 4 次定性翻转 · 最终拆分 A/B/C 三子 FU 分别闭合

| 版本 | 定性 | 修复卡 | 关键证据 |
|---|---|---|---|
| v1/v2 | SDK 内部 Bug（误判 · 业务无责）| 124 前 3 次观察 | grep 业务代码 0 命中异步 storage API |
| v3 | SDK + 业务共责（onLaunch 同步 storage 撞 `_prepare` 未就绪）| COSTRA-124 R2 | 装扮 subagent SBAI v1.1 P2' 冒烟 + WebFetch 微信官方文档 |
| v4 | lib 2.32.x SDK race · 业务无责 | COSTRA-126 跨 lib 实测 | 5 lib 版本对照 + 业务代码 grep 三重 0 命中 + 报错栈 100% 在 SDK 内部 |
| **v5** | **双因（SDK race + 业务 onShow 时序）** | COSTRA-127（C 真闭合）| Human 模拟器实测 5 条断言全 PASS @ 2026-05-08 17:55 |

**修复链**：
- COSTRA-124：顶层副作用 `storage.ts:29 ensureVersion()` 迁入 `app.ts onLaunch`（FU-LAUNCH-A 闭合）
- COSTRA-125：storage / auth / sync 全 async + bootstrapPromise 门控（治理充分必要正确实践）
- COSTRA-126：lib 升级 `2.32.3 → 3.8.12`（FU-LAUNCH-B 闭合 + 证伪 v3 假设）
- COSTRA-127：login `switchTab → reLaunch` + home/mine onShow bootstrapPromise.then gate（FU-LAUNCH-C 闭合 + 证伪 v4 假设）

**反模式沉淀**（`docs/devops/libversion-upgrade.md`）：
- #4 · 过度信赖 onLaunch 作为 storage 就绪时刻
- #5 · lib 跨版本假设业务无责
- #6 · switchTab 复用页面实例 + onShow 同步执行无 gate

### 族 3 · 杂项闭合（3 条）

- **FU-118-6 · money.ts 引入 decimal.js**：COSTRA-102 R1 顺手切换 · `decimal.js@^10.4.3` 引入 · 单测 `toCents('0.1') + toCents('0.2') === 30` 浮点数学坑兜住 · ADR-0002 硬约束恢复合规
- **FU-COMMON-DEV-URL-DRIFT + FU-115-1**：COSTRA-116 一并闭合 · 三源 SSOT 对齐 `localhost:8080` · `EXEMPTED_ENVS_FROM_RULES_AB` 清空 · 规则 A/B 恢复全量强度 · 5 文件改动 · `npm run check:whitelist` exit 0 零 warning

---

## 三、闭合条目原文留存（按时间倒序）

> **说明**：以下原文保持登记时格式 · 可追溯完整治理叙事 · 不再修改

### FU-LAUNCH-FIRST-RENDER-RACE 父 FU + A/B/C 三子（COSTRA-122 ~ 127 七次观察 · 4 次翻转）

完整原文见 commit `42494f1` 之前的 `.team/follow-ups/README.md` §FU-LAUNCH 段（原 535~819 行 · 包含 §f.1~f.6 治理范式）· 涉及 ~285 行治理叙事。

**核心追溯锚点**：
- §f.1 · COSTRA-124 R1 落盘 + 第 5 次观察预期（2026-05-02 21:xx）
- §f.2 · 定性翻转追写段（v1→v3 翻转链 + 议题 15/16）
- §f.3 · 第 7 次观察 R1 假设证伪 + FU 分裂为 A/B/C（2026-05-03 20:09）
- §f.4 · COSTRA-125 R1 实装方案 B'+E'（2026-05-04）
- §f.5 · COSTRA-126 跨 lib 实测证伪 v3（2026-05-08 16:33）
- §f.6 · COSTRA-127 FU-LAUNCH-C 真闭合 + Human 实测 5 断言全 PASS（2026-05-08 17:55）

### FU-MINIAPP-NPM-BRIDGE（COSTRA-123 · 同族第 5 次完整闭环）

完整原文见 commit `42494f1` 之前的 `.team/follow-ups/README.md` 原 898~924 行。

**核心追溯锚点**：
- 修复方案 A（采纳）：`packNpmManually:true` + `packNpmRelationList` 桥接根 `package.json` 到 `./miniprogram/`（无代码改动）
- 治理价值：D-017 第 3 次实战 · 同族盲区第 5 次复发实证（122 Retro 议题 3 精准预言兑现）· 七环链共同漏检（ADR-0002 → 技术债 → 分流 → 实装 → 卡定义 Review → R1 Tech Review → Human 验证手册）

### FU-TOKENS-JSON-RUNTIME-IMPORT（COSTRA-122 · 同族第 4 次）

完整原文见 commit `42494f1` 之前的原 492~519 行。

**核心追溯锚点**：
- 修复方案：`tokens/index.ts` 改写为内联 TS 常量 `const tokensData = { ... } as const`（导出签名不变）
- 治理价值：D-017 v2 升级最强证据（"runtime 实测作为 runtime 规约类 T2 卡的终审证据"从"推导中"升级"必选项"）· COSTRA-121 核心假设证伪事件

### FU-COMMON-PROJECT-CONFIG-DRIFT（COSTRA-121+122 · 同族第 3 次）

完整原文见 commit `42494f1` 之前的原 442~474 行。

**核心追溯锚点**：
- 双层根因：① 根 `project.config.json` 工作区缺失 ② `miniprogram/project.config.json` GUI 自建副本
- 修复 D1~D8（121）：`git restore` 恢复根 + 删除 GUI 副本 + `.gitignore` 兜底 + `check:tooling` 三子规约（5a/5b/5c）+ README 操作指引
- 物理修复仍必要 · 但 runtime 层不足 · 由 COSTRA-122 补位

### FU-COMMON-APP-JSON-DRIFT-TABBAR（COSTRA-120 · 同族第 2 次）

完整原文见 commit `42494f1` 之前的原 395~424 行。

**核心追溯锚点**：
- 微信规约：tabBar 页属"启动首帧必加载" · 必须在主包 `pages[]` · 禁止在 `subpackages[].pages[]`
- 修复：迁移 `pages-family/dashboard/` → `pages/family-dashboard/` + `pages-stat/overview/` → `pages/stat-overview/` + `check:appjson` 新增 Rule-4
- D-017 立案首次实战（Human 验证问题 → MiniApp-Agent 根因分析 → Human 裁决 → 派单 5 步 SOP）

### FU-COMMON-APP-JSON-DRIFT（COSTRA-119 · 同族第 1 次）

完整原文见 commit `42494f1` 之前的原 358~380 行。

**核心追溯锚点**：
- L1~L4 四层漂移：file × 2 + doc × 1 + CI 盲区 × 1
- 修复：补占位四件套 × 2 + 新增 `scripts/devops/appjson-pages-check.mjs`（~160 行 · Rule-1/2/3）+ `pr-check.yml` 新增 step
- CI 对账范式第 2 例（第 1 例 = COSTRA-115 whitelist-check）

### FU-COMMON-DEV-URL-DRIFT + FU-115-1（COSTRA-116）

完整原文见 commit `42494f1` 之前的原 253~289 行。

**核心追溯锚点**：
- 四处 SSOT 冲突：`miniprogram env.ts` 127.0.0.1:3000 vs `openapi.yaml` localhost:8080 vs `.env.example PORT=8080` vs `server config/env.ts` 默认 3000
- 修复：① server 默认端口对齐 8080 ② miniprogram 主机+端口对齐 SSOT ③ 豁免集合清空 ④ 5 文件文档镜像同步

### FU-118-6（COSTRA-102 · ADR-0002 合规恢复）

完整原文见 commit `42494f1` 之前的原 118~128 行。

**核心追溯锚点**：
- decimal.js@^10.4.3 引入（约 32KB · 主包 2MB 预算内）
- 顺势触发 FU-MINIAPP-NPM-BRIDGE（同族第 5 次）暴露：runtime 层加载 npm 包需 `miniprogram_npm/` 构建产物

---

## 四、状态流转节点归档（按时间正序）

| 时间 | 卡簇 | 流转动作 |
|---|---|---|
| 2026-04-27 09:39 | COSTRA-118 收官 | FU-001 / FU-118-1~6 owner_card 补齐 |
| 2026-04-27 10:14 | COSTRA-102 R1 双签 | 新增 6 条 FU-102-* + FU-118-6 closed |
| 2026-04-27 10:54 | COSTRA-115 R1 T2 APPROVE | 新增 3 条 FU-115/COMMON · 经 116 后 2 条 closed |
| 2026-04-27 15:25 | COSTRA-116 R1 T2 APPROVE | FU-COMMON-DEV-URL-DRIFT + FU-115-1 closed · 新增 FU-116-1 |
| 2026-04-27 20:28 | COSTRA-119 R1 T2 APPROVE | FU-COMMON-APP-JSON-DRIFT closed |
| 2026-04-28 14:00 | COSTRA-120 R1 T2 APPROVE | FU-COMMON-APP-JSON-DRIFT-TABBAR 同轮立 + 同轮 closed |
| 2026-04-29 10:48 | COSTRA-121+122 累加 | FU-COMMON-PROJECT-CONFIG-DRIFT + FU-TOKENS-JSON-RUNTIME-IMPORT closed · 新立 FU-LAUNCH-FIRST-RENDER-RACE |
| 2026-05-01 21:28 | COSTRA-123 收官 | FU-MINIAPP-NPM-BRIDGE closed · 新立 FU-CI-MP-BUILD-NPM-ENFORCE + FU-REVIEW-TECH-RUNTIME-DIM |
| 2026-05-02 21:xx | COSTRA-124 R1 落盘 | FU-LAUNCH 第 4 次观察 · 定性翻转 v1→v3 · §f.1+f.2 落盘 |
| 2026-05-03 20:32 | COSTRA-125 接力立卡 | FU-LAUNCH 分裂 A/B/C · 第 7 次观察 R1 假设证伪 |
| 2026-05-08 17:00 | COSTRA-126 跨 lib 实测 | FU-LAUNCH-A + B closed · v3 假设证伪 → v4 |
| 2026-05-08 17:55 | COSTRA-127 收官 | **FU-LAUNCH-C closed · 父 FU closed** · v4 假设证伪 → v5 双因定稿 |

---

_本归档由 Orchestrator 在 Sprint-2 初期整理时一次性产出 · 完整原文可在 git history 中追溯（commit `42494f1` 及之前）_
