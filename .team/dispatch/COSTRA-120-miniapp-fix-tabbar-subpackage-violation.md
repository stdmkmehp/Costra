# COSTRA-120 · tabBar 分包违规修正 + CI tabBar↔主包规约强制 (FU-COMMON-APP-JSON-DRIFT-TABBAR 专项)

- 派发人：Orchestrator
- 接收人：**MiniApp-Agent**（主驾 · 显式授权跨区 `scripts/devops/` + `miniprogram/README.md` · 参照 COSTRA-119/116 先例）
- 派发时间：2026-04-28 14:00（Asia/Shanghai · Human 触发路径：根因分析 → 方案 A 裁决 → 派单）
- 本轮截止：2026-04-28 14:30（同轮 D-016 兑现 R1）
- 优先级：**P0**（阻 Human 本地验证 · 比 COSTRA-119 更硬 · 119 R1 修了表面但漏了规约根因 · Human 04-28 13:53 重开模拟器再次启动失败）
- 闸门影响：G4 合并前必须到位（`pr-check.yml check:appjson` 增强后首跑必须零 warning）
- 分类：**COSTRA-119 P0 逃逸修复 + CI 规约扩展**（Follow-up 专项卡 · 单一职责 · 三产出：目录迁移 + app.json 重构 + CI 脚本规约增强）
- Review 档位：**T2**（基建类小卡 · 无业务逻辑 · 占位页迁移 + 规约 CI + 文档镜像 · Tech 单轨 · D-013 判定）
- 估点：**2**（0.5 点目录迁移 + 1 点 CI 规约增强 + 0.5 点 app.json/README/FU 联动）
- 依赖：COSTRA-119（已 Done 但 P0 逃逸 · 本卡修正）· COSTRA-115（CI 脚本范式）· COSTRA-116（跨区先例）
- 能力边界：**纯代码 / 纯文本改动**（无 DNS / 无微信后台 / 无跨机联调 · Agent 能力边界内 100%）

---

## 0. 背景（为什么是本卡 · COSTRA-119 P0 逃逸根因）

Human 于 2026-04-28 13:53 按 COSTRA-119 收官汇报重开微信开发者工具，模拟器仍启动失败：

```
miniprogram/app.json: ["tabBar"][1]["pagePath"]: "pages-family/dashboard/index" need in ["pages"]
                      ["tabBar"][2]["pagePath"]: "pages-stat/overview/index" need in ["pages"]
File: miniprogram/app.json
(env: macOS,mp,2.01.2510290; lib: 2.32.3)
```

### 错误文本语义精读（COSTRA-119 漏判）

**"need in ['pages']"** 是微信小程序 builder 的**规约级错误**，不是文件存在性检查。微信官方规约：`tabBar.list[].pagePath` **必须在主包 `pages[]` 数组**，**禁止在 `subpackages[].pages[]` 内**。

官方依据：tabBar 页属"启动首帧必加载"，分包本质是"按需延迟下载"，两者语义冲突。

### 四层根因（COSTRA-119 vs COSTRA-120 对照）

| 层 | COSTRA-119 理解 | 事实 | 证据 |
|---|---|---|---|
| L1 表面 | "文件不存在" | **规约违反**（tabBar 指向分包 · 微信禁止） | 119 补了四件套但模拟器仍报错 |
| L2 文档 | 骨架 README 把两页标记占位 | README §4.1 与 tabBar 冲突的设计漂移 | `miniprogram/README.md:81,83` |
| L3 骨架卡 DoD | COSTRA-030 未声明 tabBar ↔ 主包规约 | COSTRA-030 设计时就把 dashboard/overview 放进了分包（双规约违反） | `miniprogram/app.json:41-51` |
| L4 CI 盲区（119 新增后仍漏） | `appjson-pages-check.mjs` 只查"声明→文件"单向 | **未查 "tabBar[].pagePath 必须在主包 pages[]"** 这条微信规约 | `scripts/devops/appjson-pages-check.mjs` |

### COSTRA-119 为何没抓到（治理反思）

1. **T2 档位局限**：Review-Agent-Tech 走纸面审 + 五闸命令行，**不跑微信开发者工具**，所以"微信 runtime 才爆"的规约违反在 T2 结构性漏检。
2. **CI 脚本"单向性陷阱"**：`appjson-pages-check.mjs` 以 Human 当下症状"missing file"为蓝本正向补，而不是以"微信 builder 错误字典"反向设计，漏掉了 "need in pages" 这条同样高频的规约错误。
3. **FU-COMMON-APP-JSON-DRIFT 过早 closed**：119 只解了该 FU 的一半（文件存在），剩余一半（tabBar 语义）应保持 `open`。本卡衍生 **FU-COMMON-APP-JSON-DRIFT-TABBAR** 专项继续追踪。

### 实际冲击

- Human 2026-04-28 13:53 再次撞坑 · COSTRA-102 本地验证仍被第一步拦下
- 120 修完之前 COSTRA-102 Mock 通路无法验证 · Sprint-1 末 04-30 硬节点风险
- 属于 **Agent 无真微信开发者工具能力边界**（COSTRA-114 v2）的第二次正面兑现场景

### SSOT 权威

- 微信官方规约：tabBar.list[].pagePath ∈ pages[]（主包）· 禁止 ∈ subpackages[].pages[]
- 设计 IA 层：`docs/design/ia.md §3`（tabBar 4 入口不变 · 本卡不碰）
- 骨架映射：`miniprogram/README.md §4.1`（须同步迁移后的新路径）
- Human 决策追溯：2026-04-28 13:59 Human 五问裁决
  - Q1 方案 A · Q2 `pages/family-dashboard/` + `pages/stat-overview/` · Q3 原分包目录彻底删除 · Q4 新开 COSTRA-120 · Q5 119 Review-Tech 追写逃逸说明

---

## 1. 目标（What · 一句话）

**把 tabBar 指向的 `pages-family/dashboard/` 和 `pages-stat/overview/` 上提到主包 `pages/family-dashboard/` 和 `pages/stat-overview/`** · 同时扩展 `appjson-pages-check.mjs` 增加"tabBar.list[].pagePath 必须在主包 pages[]"的规约级校验 · 从代码机制层面永久消除该类 P0 逃逸。

---

## 2. Scope（做 / 不做）

### ✅ 做（七处改动 · 严格按方案 A）

- **D1** 迁移 `miniprogram/pages-family/dashboard/{index.wxml,wxss,ts,json}` → `miniprogram/pages/family-dashboard/` · 四件套原样保留 · ts 注释 `Refs:` 增补 COSTRA-120 · 文案 "家庭面板 · 功能建设中 · Sprint-3 落地" 不变

- **D2** 迁移 `miniprogram/pages-stat/overview/{index.wxml,wxss,ts,json}` → `miniprogram/pages/stat-overview/` · 四件套原样保留 · ts 注释 `Refs:` 增补 COSTRA-120 · 文案 "统计总览 · 功能建设中 · Sprint-3 落地" 不变

- **D3** 删除空目录：`miniprogram/pages-family/dashboard/` + `miniprogram/pages-stat/overview/`（Human Q3 裁决）

- **D4** `miniprogram/app.json` 三处同步修改：
  - `pages[]` 增补两条：`"pages/family-dashboard/index"` + `"pages/stat-overview/index"`（插入顺序：在 `pages/home/index` 之后 · 与 tabBar 视觉顺序一致）
  - `subpackages[0].pages[]`（stat）删除 `"overview/index"` · 仅保留 `"month/index"`
  - `subpackages[1].pages[]`（family）删除 `"dashboard/index"` · 保留 `home/settings/privacy`
  - `tabBar.list[].pagePath` 更新 2 条（第 1 和第 2 索引）指向新的主包路径

- **D5** `scripts/devops/appjson-pages-check.mjs` 扩展 · 新增 **Rule-4 · tabBar 主包规约校验**：
  - 读 `app.json.tabBar.list[].pagePath`
  - 校验每个 pagePath 必须严格匹配 `pages[]` 中的某一条（不是 `subpackages` 也不是文件路径 · 是声明意义上的主包 pages 数组）
  - 违反则 exit 1 · 错误消息带"微信规约：tabBar 页必须在主包 pages[] · 禁止在分包"
  - 保持现有 Rule-1/2/3（文件存在性）不变 · 只新增 Rule-4

- **D6** `miniprogram/README.md §4.1` 表格同步：
  - 统计总览行：路径从 `pages-stat/overview/index` 改为 `pages/stat-overview/index` · 状态改为 "✅ 占位四件套已迁主包（COSTRA-120 · tabBar 规约修正）· 业务逻辑 Sprint-3 落地"
  - 家庭面板行：路径从 `pages-family/dashboard/index` 改为 `pages/family-dashboard/index` · 状态同上"家庭面板"语境
  - §3 目录树（约 19~24 行）同步：`pages/` 条目增 `family-dashboard/` + `stat-overview/` 两目录 · `pages-stat/` 条目删除 `overview/` 提示 · `pages-family/` 条目删除 `dashboard/` 提示

- **D7** `.team/follow-ups/README.md` 新增 FU-COMMON-APP-JSON-DRIFT-TABBAR 条目（同轮登记 + 同轮 `closed` resolved_by COSTRA-120）· 同时修订 FU-COMMON-APP-JSON-DRIFT（119 那条）追加备注 "119 只解文件侧 · tabBar 规约侧由 COSTRA-120 补完 · 完整闭环"

- **D8（治理沉淀 · 跨 Scope 授权）** 新增 `.team/decisions/D-017-verification-problem-response-sop.md` · 立案 Human 2026-04-28 13:59 规约 **"验证问题必须拉责任 Agent 做根因分析再提方案"**（本卡即 D-017 首次实战）

- **D9（119 逃逸修正说明）** 在 `.team/reviews/COSTRA-119/round-1-tech.md` 文末追加 "逃逸修正说明"段（Human Q5 裁决）· 精确记载 119 漏判事实 + 120 补救路径 + T2 档位已知局限 + CI 脚本单向性教训

### ❌ 不做（Scope 铁律）

- ❌ 改 tabBar 入口数量或文字（IA 锁定 · 仍是 4 项：记账/家庭/统计/我的）
- ❌ 改 `pages/home/index` / `pages/entry/index` / `pages/login/index` / `pages/mine/index`（与 tabBar 无关的既有主包页）
- ❌ 改 `pages-stat/month/index` / `pages-family/home/index` / `pages-family/settings/index` / `pages-family/privacy/index`（留在分包 · 非 tabBar 页 · 规约内）
- ❌ 实现 dashboard / overview 的真实业务逻辑（Sprint-3 Epic-D COSTRA-201 / Epic-F COSTRA-401 归属）
- ❌ 改 `preloadRule`（保持原样 · 后续 Sprint-3 再评估是否调整分包预下载策略）
- ❌ 改 `sitemap.json`
- ❌ 引入任何 npm 依赖（零依赖铁律 · 沿袭 115/116/119）
- ❌ 动 FU-118-4 幻觉卡号其余三例（月度/家庭 home/settings/privacy 的引用 · 属 Sprint-1 Retro 批量清 · 本卡不碰）
- ❌ **不写单元测试**（appjson-pages-check.mjs 是 CI 脚本 · 五闸即测试 · 115/119 先例）

### ❓ 必要时升 ADR（本卡预判不需要）

- 若迁移过程中发现 ts Path 配置需动 `@services/*` 等 alias → 停止 · 升 Review-Tech 讨论（预期不会 · 占位页无任何 import）
- 若 `appjson-pages-check.mjs` 的 Rule-4 实装发现微信还有其他隐性规约（如 "entryPagePath 必须在主包"）→ 本卡只做 Rule-4 · 其他规约新开卡

---

## 3. 交付物（九处 · 每处都小且可机械校验）

| 编号 | 文件 | 类型 | 预计行数 |
|---|---|---|---|
| D1 | `miniprogram/pages/family-dashboard/{index.wxml,wxss,ts,json}` | 新建 4 文件（从分包迁过来 · ts 注释微调） | 4 文件 |
| D2 | `miniprogram/pages/stat-overview/{index.wxml,wxss,ts,json}` | 新建 4 文件（从分包迁过来 · ts 注释微调） | 4 文件 |
| D3 | 删除 `miniprogram/pages-family/dashboard/` + `miniprogram/pages-stat/overview/` | 删除 8 文件 + 2 空目录 | — |
| D4 | `miniprogram/app.json` | 改（pages +2 / subpackages -2 / tabBar pagePath 改 2 条） | ~6 行 diff |
| D5 | `scripts/devops/appjson-pages-check.mjs` | 改（新增 Rule-4 tabBar 主包规约 ~35 行） | ~35 行增 |
| D6 | `miniprogram/README.md` §3 目录树 + §4.1 表格 | 改（2 表格行 + 几行目录树） | ~8 行 diff |
| D7 | `.team/follow-ups/README.md` | 改（新增 FU-COMMON-APP-JSON-DRIFT-TABBAR + 119 FU 备注） | ~40 行增 |
| D8 | `.team/decisions/D-017-verification-problem-response-sop.md` | 新建规约（Human 2026-04-28 13:59 立案） | ~90 行 |
| D9 | `.team/reviews/COSTRA-119/round-1-tech.md` | 追加"逃逸修正说明"段（~30 行） | ~30 行增 |

**总计**：8 新文件（4+4 迁移）+ 1 新规约 + 5 改 - 8 删除 · 约 220 行净新增 · **绝对禁止发散**

---

## 4. DoD（完工判定 · 必须全部达成）

- [ ] D1~D9 九处改动全部落地 · 零缺项
- [ ] `git ls-files --deleted miniprogram/pages-family/dashboard miniprogram/pages-stat/overview` 返回空（目录已真删 · 由 git 感知）
- [ ] `find miniprogram/pages-family/dashboard miniprogram/pages-stat/overview -type f` 返回空（文件系统确认）
- [ ] `find miniprogram/pages/family-dashboard miniprogram/pages/stat-overview -type f` 返回 8 文件
- [ ] `node --check scripts/devops/appjson-pages-check.mjs` → exit 0
- [ ] `npm run check:appjson` → **exit 0 · 打印 "tabBar main-package rule: 4/4 pass" 或等价证据** · 核心价值闸门
- [ ] `npm run check:whitelist` → exit 0（回归）
- [ ] `npm run typecheck` → exit 0
- [ ] `npm test` → 13/13 pass
- [ ] **手动场景验证 CI 脚本是否真抓得到 tabBar 违规**：临时把 app.json tabBar[1].pagePath 改回 `pages-family/dashboard/index` 跑 `npm run check:appjson` · 必须 exit 1 · 错误消息包含"tabBar"和"主包 pages"字样 · 然后 revert（不 commit 这次临时改动 · 但要在 response 里贴输出截段证明规则有效）
- [ ] response 报告单独说明：**为什么是 COSTRA-120 而不是 119 的 R2？**（预期回答：119 已 commit 整卡 CLOSED · D-012 单卡即提交铁律 · 新 bug 独立卡号复盘更清晰 · Human 2026-04-28 13:59 Q4 裁决）
- [ ] response 报告单独说明：**为什么 Rule-4 放 appjson-pages-check.mjs 而不是新脚本？**（预期回答：同一职责族"app.json 一致性" · 扩增 vs 新建的 YAGNI 权衡）
- [ ] FU-COMMON-APP-JSON-DRIFT-TABBAR 同轮登记 + 同轮 closed

---

## 5. 五闸（pre-commit 前本地跑过）

1. `node --check scripts/devops/appjson-pages-check.mjs` → exit 0（语法）
2. `npm run check:appjson` → **exit 0 · Rule-4 显式过**（核心闸门）
3. **Rule-4 反向验证**：临时改 tabBar 指向分包 → `npm run check:appjson` 必须 exit 1 → revert
4. `npm run check:whitelist` → exit 0（回归）
5. `npm run typecheck` → exit 0
6. `npm test` → 13/13 pass

任何一项未绿 → 不 commit。

---

## 6. Review 档位与 Handoff

- **档位**：T2（D-013 · 基建类小卡 · 无业务 · 无接口变更 · 文件迁移 + CI 脚本 + 文档 · Tech 单轨）
- **Reviewer**：Review-Agent-Tech（单轨 · 无需 Review-Product · tabBar 入口不变 IA 无冲击）
- **跨区说明**：本卡涉及 `miniprogram/`（MiniApp 主区）+ `scripts/devops/`（DevOps）+ `.team/decisions/`（Orchestrator 规约）· 参照 119/116 先例 · 主产出属性归 MiniApp · Review-Tech 单轨审
- **Handoff 契约**：R1 产出后同一 tool call 循环触发 Review（D-016 铁律 · 本卡第 9 次实战）
- **预期终审路径**：AI Review APPROVE → Human `approve:COSTRA-120` → Human 重开微信开发者工具模拟器启动成功 → 立即跑 COSTRA-102 Mock 5 步

---

## 7. 风险与对冲

| 风险 | 概率 | 影响 | 对冲 |
|---|---|---|---|
| 目录迁移过程中漏迁文件 | 低 | 高 | DoD 强制 `find miniprogram/pages/family-dashboard miniprogram/pages/stat-overview -type f` 计数 8 + 原目录 `find` 计数 0 |
| Rule-4 误杀（正常情况错报 tabBar 违规） | 中 | 中 | 反向验证步骤强制做 · 同时 D3 先迁再改 app.json 保持每一步都可跑 |
| 反向验证改坏 app.json 没 revert 就 commit | 中 | 高 | DoD §4 反向验证步骤明文要求先改后 revert · Review-Tech 强制 grep 检查 final diff 不含 `pages-family/dashboard` 或 `pages-stat/overview` |
| 迁移后 navigator 跳转路径失效（如 home 页面 tab 切换代码） | 低 | 中 | 现有 tab 切换由 tabBar 原生处理 · 无硬编码跳转 · `grep -r "pages-family/dashboard\|pages-stat/overview" miniprogram/` 必须只在 app.json 改后为 0 命中（README 改后也 0 命中） |
| FU-118-4 同族清理误扩大（手贱清了 month/home 等其他引用） | 中 | 低 | Scope 铁律明禁 · 本卡仅调整 overview/dashboard 引用 |
| D-017 规约内容与 D-011/D-014/D-016 冲突 | 低 | 中 | D-017 明文定位为"验证问题响应 SOP"· 发生时机在 D-011 自动循环之前 · 是 Human → Orchestrator → Agent 的派单前置 · 不与执行层 D-011/D-014/D-016 冲突 |
| 迁移导致 FU-118-4 月度页的引用卡号污染 family-dashboard/stat-overview | 低 | 低 | 迁移保持 ts 注释 Refs: COSTRA-119/COSTRA-120/COSTRA-201/COSTRA-401 · 均为 backlog.json 已存在卡号 · 无幻觉风险 |

---

## 8. 产出模板（响应结构 · 对齐 119）

MiniApp-Agent 完工后写 `.team/reviews/COSTRA-120/round-1-miniapp-response.md`，包含：

- **变更清单**（9 处 · 每处贴关键片段）
- **五闸证据**（命令 + exit code + 关键输出 · 特别是 Rule-4 反向验证前后对比 · 两个 exit code 都贴）
- **Scope 遵守声明**（哪些没碰 / 为什么）
- **卡号引用合规证明**（grep 自查 · FU-118-4 教训）
- **下游影响断言**（是否影响 Sprint-3 Epic-D/F · 预期否 · 本卡只迁 tabBar 入口 · 具体业务归新卡）
- **COSTRA-119 逃逸根因自省**（T2 档位局限 · CI 脚本单向性 · 对 Review-Agent-Tech 未来的输入）

---

## 9. 追溯

- FU 登记：新增 FU-COMMON-APP-JSON-DRIFT-TABBAR（同轮登记 + 同轮 closed · resolved_by COSTRA-120）· 同时修订 FU-COMMON-APP-JSON-DRIFT 追加备注
- 母问题：Human 2026-04-28 13:53 按 119 收官汇报重开微信开发者工具 · 模拟器二次启动失败 · 错误文本"need in pages"
- 相关卡：COSTRA-030（骨架源头 · 不回溯）· COSTRA-115（CI 范式）· COSTRA-116（跨区先例）· **COSTRA-119（P0 逃逸源卡 · 本卡修正）** · COSTRA-102（被阻塞 · 本卡解锁）
- 规约立案：**D-017 · 验证问题响应 SOP**（Human 2026-04-28 13:59 明文立案 · 本卡 D8 落地 · 本卡即 D-017 首次实战）
- SSOT：微信官方 tabBar 规约 · `docs/design/ia.md §3`（4 tab IA · 不改）· `miniprogram/README.md §3/§4.1`（骨架镜像 · 本卡同步）
- 决策：D-012（单卡即提交）· D-013（T2）· D-014/D-016（自动拉起同轮兑现 · 本卡第 9 次实战）· **D-017（本卡立案 + 首次实战）** · COSTRA-114 v2（能力边界铁律）

---

**MiniApp-Agent · 接单 · R1 实装并触发 AI Review-Tech · 同 tool call 循环内完成。**
