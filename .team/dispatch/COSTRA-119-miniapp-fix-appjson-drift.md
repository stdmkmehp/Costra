# COSTRA-119 · app.json 分包声明↔文件系统一致性修复 + CI 对账（FU-COMMON-APP-JSON-DRIFT 专项）

- 派发人：Orchestrator
- 接收人：**MiniApp-Agent**（主驾驶 · 显式授权跨区 `scripts/devops/` + `.github/workflows/` · 类比 COSTRA-116 Backend 跨区先例）
- 派发时间：2026-04-27 20:28（Asia/Shanghai · Human 触发 `run miniapp fix-appjson-drift` · 方案 B）
- 本轮截止：2026-04-27 21:00（同轮交付 R1 · **阻 COSTRA-102 Human 现场验证** · Human 20:24 打开微信开发者工具被编译失败拦下）
- 优先级：**P0**（阻 Human 即时验证 · 比 COSTRA-116 更硬 · 当前 Human 已无法打开模拟器）
- 闸门影响：G4 合并前必须到位（`pr-check.yml check:appjson` 新增 step 首跑必须零 warning）
- 分类：**基础设施一致性修复 + CI 对账脚本新增**（Follow-up 专项卡 · 单一职责 · 双产出：占位补齐 + 对账工具）
- Review 档位：**T2**（基建类小卡 · 占位文件 + 零依赖脚本 + CI wiring + 文档镜像 · 无业务逻辑变更 · Tech 单轨 · D-013 判定 · 主产出属性归 MiniApp · `miniprogram/` 增减文件 > `scripts/devops/` 新增）
- 估点：2（1 点占位 + 1 点脚本 & CI · 比 115/116 略重 · 但仍 T2 范畴）
- 依赖：COSTRA-115（已 Done · 白名单对账脚本模板）· COSTRA-116（已 Done · 同轮兑现先例）
- 能力边界：**纯代码 / 纯文本改动**（无 DNS / 无微信后台 / 无跨机联调 · MiniApp 骨架占位四件套 + Node 零依赖脚本）

---

## 0. 背景（为什么是本卡）

Human 于 2026-04-27 20:24 按 `docs/qa/costra-102-human-verify.md §1.1` 执行 COSTRA-102 Human 本地验证的第一步"打开微信开发者工具 → 打开项目 `miniprogram/`"时，模拟器启动失败：

```
Error: miniprogram/app.json: 未找到 ["subpackages"][0]["pages"][1] 对应的 pages-stat/overview/index.wxml 文件
File: miniprogram/app.json
```

### 根因链（四层）

| 层 | 事实 | 出处 |
|---|---|---|
| L1 表面 | `miniprogram/app.json subpackages[0].pages[1] = overview/index` 但 `pages-stat/overview/` 目录不存在 | `miniprogram/app.json:14` + `ls miniprogram/pages-stat/` 只有 `month/` |
| L1 表面（同类） | `subpackages[1].pages[1] = dashboard/index` 但 `pages-family/dashboard/` 目录不存在 | `miniprogram/app.json:22` + `ls miniprogram/pages-family/` 只有 `home/privacy/settings` |
| L2 文档-代码断层 | `miniprogram/README.md §4.1` 表格将两页标记为"✅ 占位（tabBar 入口）" · 但实际从未落地四件套 | `miniprogram/README.md:81,83` |
| L3 骨架卡 DoD 不完备 | COSTRA-030 产出回链列出 `pages-stat/month/` + `pages-family/{home,settings,privacy}/` · **未列 dashboard/overview** · 但 tabBar 指向这两个页 | `.team/dispatch/COSTRA-030-miniapp-skeleton.md:4` |
| L4 CI 盲区 | `scripts/devops/whitelist-check.mjs`（COSTRA-115）只查域名方向 · **无 app.json.subpackages[*].pages[*] ↔ 文件系统对账** | - |

### 实际冲击

- **Human 04-27 20:24 当场撞坑**：无法打开模拟器 · COSTRA-102 本地验证第 0 秒失败（比 FU-COMMON-DEV-URL-DRIFT 的撞坑时机早 3 天）
- **潜伏 Sprint-0 至今**（约 6 天）：Agent 无真微信开发者工具的能力边界铁律导致该编译错误从未在 Agent 侧触发过 · 只能靠 Human 第一次真跑兜底
- **二次风险**：当前 Sprint-0 产出若不修 CI 盲区 · Sprint-1~3 再加未实装分包页仍可能重蹈

### SSOT 权威

- 设计 IA 层：`docs/design/ia.md` §3（tabBar 要求 4 入口：首页 / 家庭面板 / 统计总览 / 我的）
- 骨架映射：`miniprogram/README.md §4.1` 表格（已把两页标记"占位" · 与现实不符）
- 决策追溯：无专门 ADR · 属骨架期落地漂移 · 本卡修复后新增 FU-COMMON-APP-JSON-DRIFT 并同轮关闭

---

## 1. 目标（What · 一句话）

**让微信开发者工具能立刻打开 `miniprogram/` 跑起来**：补齐 `pages-stat/overview/` + `pages-family/dashboard/` 的最小占位四件套；同时新增 `app.json.subpackages[*].pages[*] ↔ 文件系统`对账脚本挂到 `pr-check.yml`，从机制层面消除此类漂移。

---

## 2. Scope（做 / 不做）

### ✅ 做（七处改动 · 严格按方案 B）

- **D1** `miniprogram/pages-stat/overview/` · 新建占位四件套（`index.wxml` + `index.wxss` + `index.ts` + `index.json`）· **文案铁律**：wxml 显示"统计总览 · 功能建设中 · Sprint-3 落地"· ts 内 placeholder 字面量 **不得引用**不存在的卡号（FU-118-4 教训 · COSTRA-060/130/140/150 均为幻觉）· 允许引用 `Epic-F COSTRA-401` 或写 `Sprint-3 落地`
- **D2** `miniprogram/pages-family/dashboard/` · 新建占位四件套（同 D1 结构）· 文案"家庭面板 · 功能建设中 · Sprint-3 落地"· 可引用 `Epic-D COSTRA-201`
- **D3** `scripts/devops/appjson-pages-check.mjs` · 新增零依赖 Node ESM 脚本（~80 行 · 参考 `whitelist-check.mjs` 头部注释风格）· 契约：
  - 解析 `miniprogram/app.json` 的 `pages[]` + `subpackages[].root` + `subpackages[].pages[]`
  - 对每一页计算 4 路径（`.wxml` / `.wxss` / `.ts` / `.json`）· `fs.existsSync` 校验
  - 允许 `.js` 作为 `.ts` 的兼容替身（未来若有 .js 页面不误报）· 当前项目全 .ts · 仅 .ts 命中
  - `.wxss` 可选（微信允许无 wxss · 但 .wxml / .json / (.ts | .js) 三件必检）
  - exit 0 = 全部对齐 · exit 1 = 缺失文件 · exit 2 = 解析失败
  - 打印修复指引（"① 新建四件套 ② 或从 app.json 移除该声明"）
- **D4** `package.json scripts` · 新增 `"check:appjson": "node ./scripts/devops/appjson-pages-check.mjs"` · 放在 `check:whitelist` 之后（顺序反映对账脚本族）
- **D5** `.github/workflows/pr-check.yml` · 在 `Whitelist Consistency Check` step 之后新增 `AppJson Pages Consistency Check` step · `if: success() || failure()`（吸取 FU-115-WHITELIST-STEP-ALWAYS 未决问题的教训 · 本次直接加上）
- **D6** `miniprogram/README.md §4.1` 表格文案对齐 · `pages-stat/overview/index` 与 `pages-family/dashboard/index` 两行"骨架状态"列从"✅ 占位（tabBar 入口）"改为"✅ 占位四件套已补齐（COSTRA-119）· 业务逻辑 Sprint-3 落地"· 清除 L2 文档漂移
- **D7** `.team/follow-ups/README.md` · 新增 FU-COMMON-APP-JSON-DRIFT 条目登记（来源 + 根因 + COSTRA-119 resolved_by 一并写入）· 状态直接 `closed` @ 2026-04-27

### ❌ 不做（Scope 铁律）

- ❌ 改 tabBar 指向（`app.json:47-51` 四 tab 路由不动 · IA 锁定）
- ❌ 改 `app.json subpackages[].pages[]` 声明顺序 / 页面名（保持 overview/dashboard 与 IA 原意一致）
- ❌ 实现 overview / dashboard 的真实业务逻辑（本卡只是占位 · 业务归 Sprint-3 COSTRA-401 / COSTRA-201）
- ❌ 重写 `month/index` 或 `home/index` 或其它既有页面（Scope 外）
- ❌ 引入任何 npm 依赖（零依赖铁律 · 继承自 115/116）
- ❌ 改 `preloadRule`（第 28~33 行不动 · 本卡不评估预下载策略）
- ❌ 改 `sitemap.json`（分包页对索引的影响归 Sprint-3 Epic-G SEO 卡）
- ❌ 修 FU-102-ERROR-MAPPER-INTEGRATION / FU-102-AVATAR-ONERROR（虽然都是 COSTRA-102 口袋项 · 但本卡不是 COSTRA-102 · 严格同卡提交）

### ❓ 必要时升 ADR（本卡预判不需要）

- 若发现 `app.json subpackages` 还有第三处文件系统缺失（除 overview/dashboard 外）→ 先补 · 同轮登记 · 不升 ADR
- 若发现 IA 层（`docs/design/ia.md §3`）与 tabBar 指向本就不一致 → **暂停实装** · 升 Review-Agent 讨论 · 不擅改 IA

---

## 3. 交付物（七处 · 每处都小且可机械校验）

| 编号 | 文件 | 类型 | 预计改动行数 |
|---|---|---|---|
| D1 | `miniprogram/pages-stat/overview/{index.wxml,wxss,ts,json}` | 新建 4 文件 | ~15 行（四件套共计） |
| D2 | `miniprogram/pages-family/dashboard/{index.wxml,wxss,ts,json}` | 新建 4 文件 | ~15 行 |
| D3 | `scripts/devops/appjson-pages-check.mjs` | 新建 | ~80~120 行（含注释） |
| D4 | `package.json` | 改（+1 scripts） | 1 行 diff |
| D5 | `.github/workflows/pr-check.yml` | 改（+1 step · ~6 行） | ~6 行 diff |
| D6 | `miniprogram/README.md` §4.1 | 改（2 行表格文案） | ~2 行 diff |
| D7 | `.team/follow-ups/README.md` | 改（新增 FU-COMMON-APP-JSON-DRIFT 条目） | ~35 行新增 |

**总计**：11 新文件 + 4 改 · ~170 行新增 · 3 行修改 · **绝对禁止发散**

---

## 4. DoD（完工判定 · 必须全部达成）

- [ ] D1~D7 七处改动全部落地 · 零缺项
- [ ] `node --check scripts/devops/appjson-pages-check.mjs` → exit 0（语法闸）
- [ ] `npm run check:appjson` → **exit 0 · 无任何 warning**（核心闸门 · 本卡价值验证 · 证明 app.json 声明与文件系统一致）
- [ ] `npm run check:whitelist` → exit 0（回归测试 · 本卡不应影响白名单）
- [ ] `npm run typecheck` → exit 0（新增的 2 个 `index.ts` Page 必须通过）
- [ ] `npm run test` → 13 tests 全绿（本卡不改单测 · 回归兜底）
- [ ] **真机 / 微信开发者工具验证（Human 侧）**：Human 重开项目 → 模拟器启动成功 → 可见 tabBar 点击"统计"/"家庭"tab 显示占位文案（非阻塞 Agent 交付 · Agent 能力边界外 · 但 Review 通过后 Human 当场可复验）
- [ ] `.team/follow-ups/README.md` 新增 FU-COMMON-APP-JSON-DRIFT 条目 · 状态直接 `closed` @ 2026-04-27 · resolved_by COSTRA-119
- [ ] response 报告单独说明"为什么 CI 脚本没用第三方 YAML/JSON 解析器"（预期回答：零依赖铁律 · app.json 是标准 JSON 直接 `JSON.parse` 即可 · 不需要任何 YAML 解析的 115 套路）
- [ ] response 报告单独说明"为什么占位页文案不引用任何卡号"（预期回答：FU-118-4 教训 · 骨架期曾出现 COSTRA-060/130/140/150 幻觉卡号 · 本卡严禁重演 · 仅引用 backlog.json 已存在的 COSTRA-201/401 或用 Sprint 描述）

---

## 5. 四闸（pre-commit 前本地跑过）

1. `node --check scripts/devops/appjson-pages-check.mjs` → exit 0
2. `npm run check:appjson` → **exit 0 · 零 warning**（核心闸门）
3. `npm run check:whitelist` → exit 0（回归 · 本卡不改白名单相关源）
4. `npm run typecheck` → exit 0
5. `npm test` → 13/13 pass

任何一项未绿 → 不 commit · 走 Revise 或回报 Review-Agent。

---

## 6. Review 档位与 Handoff

- **档位**：T2（D-013 · 基建类小卡 · 无业务 · 无接口变更 · 占位文件 + CI 脚本 + 文档文案 · Tech 单轨）
- **Reviewer**：Review-Agent-Tech（单轨 · 不需要 Review-Product · 无产品面改动）
- **跨区说明**：本卡同时涉及 `miniprogram/`（MiniApp 工作区）和 `scripts/devops/` + `.github/workflows/`（DevOps 工作区）· 参照 COSTRA-116 先例（Backend 一人改 `server/` + `miniprogram/services/` + `scripts/devops/` 走 Review-Tech 单轨）· 本卡主产出属性归 MiniApp（占位页是业务可见产物 · 脚本是配套对账）· Review-Tech 单轨审完即可
- **Handoff 契约**：MiniApp-Agent R1 产出后**同一 tool call 循环**内触发 Review（D-016 铁律 · 115/116 已第 7~8 次实战）
- **预期终审路径**：AI Review APPROVE → Human `approve:COSTRA-119` → Human 立即可回到微信开发者工具复跑 COSTRA-102 验证

---

## 7. 风险与对冲

| 风险 | 概率 | 影响 | 对冲 |
|---|---|---|---|
| 占位四件套引用不存在的卡号（FU-118-4 重演） | 中 | 中（幻觉再次入库） | **明文禁止** · DoD §4 报告单独说明 · Reviewer 强制 grep 校验 |
| 新脚本解析 app.json 失败（JSON.parse 抛异常） | 低 | 中（CI 步骤崩） | exit 2 分支显式捕获 · 打印源文件路径 + 行号 |
| 脚本把 `.wxss` 当必检导致误报（微信官方允许无 wxss） | 中 | 中（CI 误杀） | Scope §2 D3 明确规定 wxss 可选 · 仅 wxml/json/ts-or-js 三件必检 |
| `.github/workflows/pr-check.yml` YAML 语法错误（缩进 / tab） | 低 | 高（整个 pr-check 挂） | D5 直接在 `Whitelist Consistency Check` 后面复制粘贴一个 step · 同缩进 · tab-free |
| MiniApp 补四件套触发 typecheck 报错（Page 类型不符） | 低 | 低 | 参考 `pages-stat/month/index.ts` 骨架结构 · 本项目已有可用模板 |
| 改 README §4.1 表格时误伤其它行 | 低 | 低 | 仅 2 行精准替换 · replace_in_file 带足上下文 |
| 新 FU 登记格式与既有 FU 不一致 | 低 | 低 | 照搬 FU-COMMON-DEV-URL-DRIFT 模板（同属"FU-COMMON-*"族） |

---

## 8. 产出模板（响应结构要求 · 与 115/116 对齐）

MiniApp-Agent 完工后写 `.team/reviews/COSTRA-119/round-1-miniapp-response.md`，包含：

- **变更清单**（7 处 diff · 每处贴关键片段）
  - D1/D2 占位四件套完整贴出（每套 4 文件 · 合计 8 文件）
  - D3 脚本关键函数贴出（parseAppJson / checkPageFiles / main）
  - D4~D7 diff 前后对比
- **四闸证据**（命令 + exit code + 关键输出截段）· 特别是：
  - `npm run check:appjson` 的 "✅ appjson consistent: N pages matched" 成功文案
  - `npm run check:whitelist` 的 "✅ whitelist consistent" 回归成功
  - `npm run typecheck` 包含两个新 Page 文件
- **Scope 遵守声明**（哪些没碰 / 为什么）
  - 明列未改 tabBar / preloadRule / sitemap.json / 既有页面
- **卡号引用合规证明**（grep 自查 · FU-118-4 教训）
  - 占位页 ts/wxml 内引用的卡号逐一列出 · 每个对 backlog.json 核对
- **下游影响断言**
  - 是否需要 docs/ 或其它卡级联修改（预期"否" · 本卡自闭环）
  - Human 04-30（或 04-27 当场）重开微信开发者工具预期恢复

---

## 9. 追溯

- FU 登记：本卡将在 `.team/follow-ups/README.md` 新增 FU-COMMON-APP-JSON-DRIFT 条目（同轮登记 + 关闭）
- 母问题：Human 04-27 20:24 微信开发者工具模拟器启动失败 · 与本项目"Agent 无真机能力边界铁律"（COSTRA-114 v2）的直接兑现场景
- 相关卡：COSTRA-030（骨架期漂移源头 · 不回溯修复）· COSTRA-115（白名单对账脚本模板）· COSTRA-116（跨区一人做完先例）· COSTRA-102（被阻塞的 Human 本地验证 · 本卡解锁）
- SSOT：`docs/design/ia.md §3`（tabBar 4 入口 IA · 本卡不改）· `miniprogram/README.md §4.1`（骨架映射表 · 本卡同步对齐）
- 决策：D-009（开发服务器锁定 · 与本卡无交集）· D-013（Review 分级 · T2）· D-014（卡定义 + 产出首轮自动拉起）· D-016（同轮兑现铁律 · 本卡第 8 次实战）· COSTRA-114 v2（能力边界铁律 · 本卡即兑现场景）

---

**MiniApp-Agent · 接单 · R1 实装并触发 AI Review-Tech · 同 tool call 循环内完成。**
