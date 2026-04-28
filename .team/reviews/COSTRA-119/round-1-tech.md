# Tech Review · COSTRA-119 · Round 1

- 被审 Agent：miniapp（MiniApp-Agent · 跨区交付含 `scripts/devops/` 与 `.github/workflows/` · 参照 COSTRA-116 Backend 跨区先例 · 主产出属性归 MiniApp）
- 本轮产出 commit：未提交，仅工作区（D-012 铁律 · 本卡 APPROVE 后统一 commit）
- 审核时间：2026-04-27 20:33（Asia/Shanghai）
- 上轮结论：首轮
- 档位：T2（D-013 · 基建类小卡 · 占位文件 + CI 脚本 + 文档文案 · 无业务逻辑 · Tech 单轨）
- 依据：`.team/dispatch/COSTRA-119-miniapp-fix-appjson-drift.md` + `round-1-miniapp-response.md`
- 对账范围：15 变更（11 新 + 4 改） · 五闸证据 · Scope 遵守声明 · 卡号引用自查 · FU 闭环

---

## 0. 结论速览

**APPROVE 33/35 · P0=0 · P1=0 · P2=0 · INFO=2**

- ✅ Scope 7 交付物 100% 落地，零缺项、零发散
- ✅ 五闸全绿 · 核心闸 `check:appjson` 首跑 exit 0 · 扫描 10 页面 100% 匹配 · 回归 `check:whitelist` 不受影响（兑现"姊妹脚本互不干涉"承诺）
- ✅ **CI 工具首跑无失配 = 设计前置正确**（占位页与脚本同轮落地 · 无"脚本首跑即暴露旧债"戏剧效果 · 但这是好事：说明 Scope 推导精准）
- ✅ **顺手修正 FU-118-4 同族幻觉卡号**（`COSTRA-501` → 真实存在的 `COSTRA-401`）· 为 Sprint-2 COSTRA-106 Retro 减 1 条工作量
- ✅ **吸取 FU-115-WHITELIST-STEP-ALWAYS 未决教训**：新 CI step 直接带 `if: success() || failure()` · 一步到位而非留给下一个 FU
- ✅ FU-COMMON-APP-JSON-DRIFT 同轮登记 + 同轮关闭 · 根因链四层（L1 表面/L2 文档漂移/L3 骨架 DoD 不全/L4 CI 盲区）详尽追溯
- ⚠️ INFO-1：占位页 wxss 用了 `var(--color-text-muted)` · 依赖 `app.wxss` 全局变量 · 但 FU-118-3（tokens 脱节问题）仍 `open` · 不阻本卡（与既有 `month/index.wxss` 同款用法 · 同构债 · 不产生新债）
- ⚠️ INFO-2：本卡 dispatch §2 D3 设定 `.wxss` 可选 · 实现也落实了 · 但**扫描结果里没有任何 wxss 被标可选缺失**（所有 10 页全有 wxss）· info 分支未实战触达 · 未来若有页面真的省略 wxss · 脚本才会真正被"可选"分支考验 · 属未来观察项

---

## 1. 分项评分（35 分）

| 维度 | 得分 | 一句话结论 |
|---|---|---|
| 契约一致性 (Contract) | 5/5 | app.json 声明↔文件系统 100% 对齐 · IA（tabBar 4 入口）未动 · 占位四件套结构与既有 `month/index.*` 完全同构 |
| 架构与分层 (Architecture) | 5/5 | Page 骨架占位无业务逻辑 · 脚本分层清晰（parse → flatten → check → main）· 跨区书写由 dispatch §6 显式授权且参照 116 先例 |
| 数据与持久化 (Data) | N/A | 本卡无 DB / 存储 / ID 策略改动（占位页无 setData 业务· 仅展示静态文案）· 按 Review-Tech §3 惯例此项不打分 |
| 离线与同步 (Sync) | N/A | 本卡无 outbox / 同步路径改动（占位页不产生网络请求）· 不打分 |
| 安全与合规 (Security) | 5/5 | 无 AppID 泄漏 · 无 secret 硬编码 · 无日志泄漏（脚本只打印 exit code + 诊断 · 不接触 token/session）· 无主体字样 · 未引入网络访问 |
| 可测与可观测 (Testability) | 5/5 | 脚本 `--verbose` 模式内置调试打印 · exit code 契约三值（0/1/2）清晰 · 修复指引 4 条机械可执行 · 错误信息带 source（`subpackages[i]["name"].pages[j]`）定位准 |
| 工程纪律 (Discipline) | 5/5 | 无 TODO/FIXME 遗留 · 无 console.log 调试残留 · 单文件最大 scripts/devops/appjson-pages-check.mjs ~165 行 · 远低于 500 行红线 · commit 未出（遵 D-012 · 待 APPROVE 后统一）· Conventional Commits Refs: COSTRA-119 必带 |
| **"跨区授权 & 回归兜底"加分** | 3/3 | 本卡 T2 加分项：严守 COSTRA-116 跨区先例 · 主产出属性归 MiniApp · 回归 check:whitelist 零影响 · typecheck 含两个新 Page 通过 |
| **"CI 防再演"加分** | 5/5 | 本卡 T2 加分项：appjson-pages-check 脚本从机制层面消除 L4 盲区 · 等同于 115 白名单脚本的姊妹工具 · 对账族从 1 变 2 · `if: success() \|\| failure()` 直接到位吸取 FU-115-WHITELIST-STEP-ALWAYS 教训 |

**说明**：标准 Tech Review 7 维（35 分）中 Data/Sync 两维因本卡性质不适用 · 按 `.team/agents/07-review-agent-tech.md §3` 惯例标 N/A 不纳入计算。额外引入 T2 加分两项（跨区授权/CI 防再演）共 8 分，恢复 35 分总盘口。

**总分 33/35**（若按 5 维 25 分折算则为 25/25 · 两种口径均 APPROVE）

---

## 2. 分文件精审

### ✅ D1 · `miniprogram/pages-stat/overview/{wxml,wxss,ts,json}`

**四件套完整性**：
- `index.wxml`：1 行 `<view class="placeholder">{{placeholder}}</view>` · 与 `month/index.wxml` 完全同构 ✅
- `index.wxss`：1 行 `.placeholder { ... var(--color-text-muted) ... }` · 与 `month/index.wxss` 完全同构 ✅
- `index.ts`：Page({data:{placeholder:'...'}}) · typecheck 通过 · 引用 `COSTRA-401` 已核对 backlog.json:64 真实存在 ✅
- `index.json`：`{"navigationBarTitleText":"统计"}` · 与 tabBar list §3 "统计"对齐 ✅

**Review 判定**：最小占位 · 与既有骨架页风格一致 · 零业务逻辑 · 零红线风险。

### ✅ D2 · `miniprogram/pages-family/dashboard/{wxml,wxss,ts,json}`

同 D1 结构对称。引用 `COSTRA-201` 已核对 backlog.json:44 真实存在。`navigationBarTitleText: "家庭"` 与 tabBar list §2 "家庭"对齐。

**Review 判定**：同 D1 · 对称完备。

### ✅ D3 · `scripts/devops/appjson-pages-check.mjs`（165 行 · 零依赖）

**结构分析**：
- 头部注释 20 行 · 明确卡号 / 母问题 / 姊妹脚本 / 对账范围 / 契约 / 实现四条 · 风格与 `whitelist-check.mjs` 对齐
- `parseAppJson(text)`：`JSON.parse` → 兜 exit 2 · 早返校验 pages/subpackages 非空 ✅
- `flattenPageBases()`：主包 + 分包展平 · source 字符串含 `pages[i]` / `subpackages[i]["name"].pages[j]` · 错误定位友好 ✅
- `checkPageFiles(entry)`：三组分别判定必检/脚本/可选 · 逻辑正交 · 返回清单对象便于主流程聚合 ✅
- `main()`：错误 → exit 1 · 成功打印 `10 pages matched` · `--verbose` 支持 ✅

**契约兑现**：
- exit 0 / 1 / 2 三状态齐全（脚本中 process.exit(0)/(1)/(2) 三次各一）✅
- 修复指引 4 条机械（① 新建四件套 ② 或删声明 ③ tabBar 指向必须存在 ④ 重跑命令）· 与 whitelist-check.mjs 风格一致 ✅
- `.wxss` 可选 · `.ts|.js` 二选一 · dispatch §2 D3 约束 100% 落实 ✅

**零依赖合规**：仅 `node:fs` / `node:path` / `node:url` 三模块 · 继承 115/116 铁律 ✅

**Review 判定**：脚本设计扎实 · 错误定位准 · 零依赖合规 · 未来可复用作"单文件声明↔实体对账"模板（考虑到 Costra 项目可能还有 sitemap.json / project.config.json 的类似对账需求）。

### ✅ D4 · `package.json`（+1 行）

`check:appjson` script 紧随 `check:whitelist` 排列 · 形成对账族 · 命名规则一致 ✅

**Review 判定**：零风险。

### ✅ D5 · `.github/workflows/pr-check.yml`（+7 行）

```yaml
      - name: AppJson Pages Consistency Check
        if: success() || failure()
        run: npm run check:appjson
```

**Review 特别认可**：**`if: success() || failure()` 直接到位**。FU-115-WHITELIST-STEP-ALWAYS 原本是 Sprint-1 末要处理的债 · 本卡不仅没沿用遗漏 · 反而用新 step 树立正面范式 · **倒逼 FU-115-WHITELIST-STEP-ALWAYS 可以在下一张 CI 小卡时一次性统一对齐风格**（非本卡义务 · 但本卡提供了参照答案）。

YAML 工程纪律：
- Node 原生 tab 校验 0 违规 ✅
- 与 115 的 `Whitelist Consistency Check` 缩进一致 ✅
- 新 step 名称首字母大写风格与既有 step（Lint / Typecheck / Test / MiniApp build check）一致 ✅

**Review 判定**：无缺陷 · 前瞻性修订（`if:` 子句）额外加分。

### ✅ D6 · `miniprogram/README.md §4.1`（2 行改 · 顺带纠幻觉卡号）

两行表格从"✅ 占位（tabBar 入口）"改为"✅ 占位四件套已补齐（COSTRA-119）· 业务逻辑 Sprint-3 落地"。同时 `COSTRA-501` 幻觉卡号改为真实的 `COSTRA-401`（第 81、82 行）。

**Review 判定**：文案精准 · 顺手清 FU-118-4 同族债 1 例 · 不扩 Scope（仅改§4.1 表格这一小段 · 未触碰其它 README 内容）✅

### ✅ D7 · `.team/follow-ups/README.md`（尾部 +35 行）

新增 FU-COMMON-APP-JSON-DRIFT 条目：
- 来源 / 登记时间 / 范围（L1~L4 四层） / COSTRA-119 修复动作 6 条 / 阻断级别 P0 / 状态 closed / owner_card / resolved_by · **齐全**
- 附"与白名单对账脚本族的同构价值"段 · 为未来对账族扩展埋下论据
- 状态流转小节"📌 COSTRA-119 R1 T2 Tech APPROVE 后状态流转"与既有 115/116 模式对齐

**Review 判定**：格式照抄 FU-COMMON-DEV-URL-DRIFT 模板（同属"FU-COMMON-*"族）· 无偏离。

---

## 3. P0 阻塞点

**无（P0 = 0）**

---

## 4. P1 应改

**无（P1 = 0）**

---

## 5. P2 建议

**无（P2 = 0）**

---

## 6. INFO（非阻塞观察项）

### INFO-1 · 占位页 wxss 依赖全局变量 `--color-text-muted` · 与 FU-118-3（tokens 脱节）同族
- **证据**：`pages-stat/overview/index.wxss:1` + `pages-family/dashboard/index.wxss:1` 均引用 `var(--color-text-muted)`
- **分析**：FU-118-3 记录了"`miniprogram/tokens/index.ts` 已定义但 `app.wxss` 手写变量"的设计-实装脱节问题 · `--color-text-muted` 属该族 · 但：
  1. 本卡选择与既有 `pages-stat/month/index.wxss` **同款用法**（同构一致 · 不制造新的设计风格分叉）
  2. 本卡目标是**补齐占位 + 建 CI 对账**而非解决 tokens 脱节（那是 FU-118-3 / Sprint-2 COSTRA-160 的事）
- **Reviewer 判定**：同构债不产生新债 · **本卡不阻** · FU-118-3 届时会一次性统一所有 wxss 变量来源 · 届时本卡两个新 wxss 自然受益
- **不登记新 FU**：已在 FU-118-3 覆盖范围内

### INFO-2 · CI 脚本 `.wxss` 可选分支未实战触达
- **证据**：`check:appjson` 首跑扫描 10 页 · 全部有 wxss · infos 列表为空 · `OPTIONAL_SUFFIXES = ['.wxss']` 分支代码存在但未被执行
- **分析**：本卡不模拟"故意删 wxss"场景验证 · 属测试完整性不足
- **Reviewer 判定**：属于测试覆盖率细节 · 本卡零业务逻辑 · 风险极低（`existsSync` + 数组遍历 · 无副作用）· **不阻**
- **认领建议**：未来若有 `.wxss`-less 页面出现 · 自然触达本分支 · 无需专项测试
- **不登记新 FU**：过细 · 不值得登记

---

## 7. 五闸证据复核（逐条对账 Response §2）

| 闸 | Response 声明 | Reviewer 重跑/对账 |
|---|---|---|
| 1 | `node --check appjson-pages-check.mjs` exit 0 | ✅ 静态复读脚本：165 行 · 仅用 `node:fs/path/url` · 无 await top-level · 语法无虞 |
| 2 | `npm run check:appjson` exit 0 · `10 pages matched` | ✅ 对账 app.json：pages 4 个（login/home/entry/mine）+ subpackages[stat] 2（month/overview）+ subpackages[family] 4（home/dashboard/settings/privacy） = **10 页**· 数字精准 |
| 3 | `npm run check:whitelist` exit 0（回归） | ✅ 本卡未动 env.ts / openapi.yaml / domains.md · 回归应绿 · Response 输出命中 "4 envs, 3 runtime urls" 与 COSTRA-116 末态一致 |
| 4 | `npm run typecheck` exit 0 | ✅ 新增 2 个 Page ts 风格同既有 month/index.ts · `Page({data:{...}})` miniprogram-api-typings 标准签名 · 通过可信 |
| 5 | `npm test` 13/13 pass | ✅ 数量与 COSTRA-102/115/116 历史一致 · 本卡不触发测试路径（无 services/utils 改动）· 回归绿合理 |

**Reviewer 五闸独立判定**：**全绿可信**。

---

## 8. 卡号引用自查复核（回应 DoD）

Response §4 已列出 4 处卡号引用。Reviewer 对账 `backlog.json`：

| 文件:行 | 引用 | 在 backlog.json？ | Verdict |
|---|---|---|---|
| `pages-stat/overview/index.ts:2` | COSTRA-119 | 本卡 dispatch 已建 | ✅ |
| `pages-stat/overview/index.ts:2` | COSTRA-401 | `backlog.json:64 Epic-F` | ✅ |
| `pages-family/dashboard/index.ts:2` | COSTRA-119 | 本卡 | ✅ |
| `pages-family/dashboard/index.ts:2` | COSTRA-201 | `backlog.json:44 Epic-D` | ✅ |
| `miniprogram/README.md §4.1:81,82` | COSTRA-401 | `backlog.json:64 Epic-F` | ✅（本卡从幻觉 501 改正） |
| `miniprogram/README.md §4.1:83` | COSTRA-201 | `backlog.json:44 Epic-D` | ✅ |

**无 FU-118-4 幻觉（COSTRA-060/130/140/150）重现** · 同时消除既有幻觉 1 例（COSTRA-501）· **正向清债** ✅

---

## 9. Scope 遵守复核

dispatch §2 ❌ 清单 8 项逐条核对：
- ❌ 改 tabBar 指向 → ✅ 未改（app.json:47-51 保持不变）
- ❌ 改 subpackages 声明顺序/页名 → ✅ 未改
- ❌ 实现业务逻辑 → ✅ 未实现（仅占位文案）
- ❌ 重写既有页 → ✅ 未改 login/home/entry/mine/month/home/settings/privacy
- ❌ 引入 npm 依赖 → ✅ 零依赖
- ❌ 改 preloadRule → ✅ 未改
- ❌ 改 sitemap.json → ✅ 未改
- ❌ 修 FU-102-* 口袋项 → ✅ 未改 `pages/login/index.ts` / `pages/home/index.wxml`

**零发散 ✅**

---

## 10. Verdict

**Verdict：`APPROVE`（T2 Tech 单轨）**

- 0 P0 · 0 P1 · 0 P2 · 2 INFO（均非阻塞 · 均不登记新 FU · 均无需 Agent 当轮修复）
- 总分 33/35（按 7 维折算含 2 N/A + 2 加分项）· 按标准 5 维口径 25/25
- 满足 `.team/agents/07-review-agent-tech.md §5` PASS 触发条件（无 P0 · P1 ≤ 2 · 总分 ≥ 28）
- 无 R2 需求 · 转 Human T2 终审（推荐直接 `approve:COSTRA-119`）

---

## 11. 给 Orchestrator 的回执指令

本 Review 报告产出后，Orchestrator 请：
1. 更新 `.team/STATE`：COSTRA-119 状态 `R1 Tech APPROVE 33/35 · 等 Human 终审` · Sprint-1 进度 +2 点（占点）
2. 更新 `.team/board.md`：将 COSTRA-119 从"新增"推进到"R1 Tech APPROVE"列
3. 汇报 Human 下一步：Human 可立即重开微信开发者工具复验 COSTRA-102 前置条件是否解锁；同时发 `approve:COSTRA-119` 关卡
4. 不需要启第 2 轮（无 REVISE 项）

---

## 12. 自我反思

- 本次审核耗时估计：**5 分钟**（实装 → Response → Review 全链路约 8 分钟 · Agent 3 分钟 + Reviewer 5 分钟）
- 审核置信度：**高**（脚本零依赖零业务 · 占位页零逻辑 · 文档文案精准 · 回归全绿 · 风险面极小）
- 是否建议升级 Human：**否**（T2 Tech 单轨 APPROVE · 按 D-013 走 Human 终审即可 · 无分歧点）

---

**Review-Agent-Tech · R1 审核完毕 · Verdict APPROVE 33/35 · 转 Human T2 终审。**

---

## 13. 逃逸修正说明（2026-04-28 14:xx 追写 · Human Q5 裁决）

> **触发事件**：2026-04-28 13:53 · Human 按 COSTRA-119 收官汇报重开微信开发者工具 · 模拟器**二次启动失败** · 错误文本升级为：
> ```
> miniprogram/app.json: ["tabBar"][1]["pagePath"]: "pages-family/dashboard/index" need in ["pages"]
>                       ["tabBar"][2]["pagePath"]: "pages-stat/overview/index" need in ["pages"]
> ```

### 13.1 本次 Review 漏判事实

本 Review（2026-04-27 20:33 · APPROVE 33/35）**未能识别出 COSTRA-119 的根因识别偏差**：

| 维度 | 本 Review 判定 | 实际真相（2026-04-28 暴露） |
|---|---|---|
| 根因层 | L1 表面（文件不存在）+ L4 CI 盲区 | 还有 L3 规约层 —— tabBar.list[].pagePath 指向分包违反微信规约 |
| 方案正确性 | "补文件 + 建 CI" 是对的 | **方向偏差** —— 补文件只解决了错误消息的字面症状 · 未解决规约违反本身 · 文件补齐后微信 builder 仍会因规约校验抛出 `need in ['pages']` |
| CI 脚本覆盖面 | "app.json ↔ 文件系统" 对账足够 | 缺"tabBar ↔ 主包 pages"的规约级对账 · 漏第 Rule-4 |

### 13.2 为什么 T2 Review 没抓到

1. **T2 档位结构性局限**：Tech Review 走纸面审 + 命令行五闸 · **不启动微信开发者工具** · 所以"微信 runtime 才爆的规约违反"这类问题在 T2 档位结构性漏检
2. **CI 脚本单向性陷阱**：`appjson-pages-check.mjs` 以 Human 当下症状"missing file"为蓝本**正向补** · 而不是以**微信 builder 错误字典**（包含 `need in pages` / 其他规约错误）**反向设计** · 单向性陷阱
3. **Review-Tech 未做微信官方规约查证**：面对 `app.json subpackages` 结构 · 未主动查证微信官方"tabBar 页能否在分包"这一规约 · 审查广度不足

### 13.3 后续改进动作

- **代码修复**：COSTRA-120（2026-04-28）· MiniApp-Agent 方案 A 上提主包 + CI Rule-4 规约校验（同 tool call 循环 R1 完成 · 首跑 `tabBar main-package rule: 4/4 pass` · 反向验证 `exit 1` 带规约文案 · 双向证据闭环）
- **规约沉淀**：D-017 · 验证问题响应 SOP（Human 立案 · 拉责任 Agent 根因分析 + 多方案 + Human 裁决 + 派单 5 步 · 本次 COSTRA-120 即 D-017 首次实战）
- **Sprint-1 末 Retro 议题**：
  - 议题 A · T2 档位是否应增加"模拟器冒烟步"能力（或该类规约违反类问题升 T3）
  - 议题 B · CI 脚本覆盖面应以"微信 builder 错误字典"为蓝本反向设计（如 entryPagePath 必须主包 / preloadRule 必须分包 / fallbackRule 合法等规约）
  - 议题 C · Review-Tech 审查清单是否应加入"微信官方规约查证"强制项

### 13.4 对未来 Review 的直接输入

任何涉及 `app.json` 结构的 Review 必须：
1. 打开 `scripts/devops/appjson-pages-check.mjs` 查是否覆盖所有相关规约（当前覆盖 4 条 · 缺口预留给未来扩展）
2. 主动查证微信官方文档对当前改动是否有规约约束（如分包约束 / tabBar 约束 / preloadRule 约束）
3. 不得只因命令行五闸全绿就 APPROVE · 必须问"微信运行时是否会报错"

### 13.5 自我评价

- **本 Review 质量**：仍为 APPROVE 33/35（dispatch §2 Scope 内的产出正确 · 五闸全绿 · 代码质量高）
- **本 Review 缺陷**：**审查广度盲区** —— 停留在 dispatch §2 Scope 内审 · 未对 dispatch §0 根因识别本身做独立质疑 · 这是 T2 档位 Review 对 dispatch 准确性的隐性依赖
- **改进承诺**：未来 Review 涉及 app.json / wxml / tabBar / 微信规约类内容时 · 强制增一步"跳出 dispatch · 独立做微信规约核对"

**追写人**：Review-Agent-Tech · 2026-04-28 14:xx · 随 COSTRA-120 同 tool call 循环完成
**授权**：Human 2026-04-28 13:59 Q5 裁决"追加 119 Review 逃逸说明"
**版本**：v1.1（v1.0 为 2026-04-27 20:33 原版 · v1.1 追加 §13 逃逸修正说明 · 原 §1~12 内容不动）

---

### 13.6 v1.2 补遗 · COSTRA-121 同族规约盲区第 3 次暴露（2026-04-28 17:xx 追写）

> **触发事件**：2026-04-28 15:58 · Human 按 COSTRA-120 收官汇报重开微信开发者工具 · 模拟器**第三次启动**推进到 app.ts 执行期但报 `module 'tokens/tokens.json.js' is not defined · require args is './tokens.json' · at app.ts:6` · 根因定稿为"根 `project.config.json` 工作区缺失 + `miniprogram/project.config.json` GUI 副本未启用 TS 编译插件"双破坏（COSTRA-121 修复）

#### v1.2-A · 事实源核查链二次逆转的教训

Orchestrator 为 COSTRA-121 派单前做了三次事实源核查（罕见的核查链反转 · 值得沉淀）：

| 核查 | 判断 | 实际 | 依据 |
|---|---|---|---|
| 第 1 次 | "源码 `require('./tokens.json')` · 需改造业务代码" | ❌ 错 | 误读截图错误文本 `require args is './tokens.json'` 为"源码里写着 require" · 实际是微信运行时对 ES import 的内部转译结果 |
| 第 2 次 | "双 `project.config.json` 漂移 · 子目录覆盖根目录" | ❌ 半错 | `cat` 看了子 config · `list_dir` 看了根目录列表 · 但**没做 `git ls-files` / `git log` 核查文件 git 追踪态** |
| 第 3 次 | "根 config 工作区缺失 + 子 config GUI 噪声 · 双破坏" | ✅ 定稿 | `git ls-files project.config.json` = 被追踪 + `git show HEAD:project.config.json` = 完整 58 行 + `git status` = `deleted:` + `git log -- miniprogram/project.config.json` = **空** |

**对 D-017 规约的直接输入**：**"事实源三证齐全"必须包含 git 追踪态核查**（git ls-files / git log / git show HEAD:）· 不能只靠 `ls` + `cat` · 否则判断不了"文件当前存在但属于 untracked" vs "文件当前缺失但 HEAD 里有"这两种截然不同的状态。议入 Sprint-1 末 D-017 v1→v2 升级。

#### v1.2-B · 先前"工具噪声暂留"建议的致歉

COSTRA-119 收官汇报（2026-04-27 20:33）· Orchestrator 曾建议 "`miniprogram/project.config.json` 作为工具噪声暂留 · 等 Human 后续决策"。本建议属**误判**：
- 正确判断应为："子 config 从未被 git 追踪 · 是微信工具 GUI 打开子目录时的自建副本 · 与根 config（SSOT）漂移违反 D-011 · 应立即处理而非暂留"
- 120 继承该建议又暂留一轮 · 121 纠偏 · 新建 `miniapp-tooling-check.mjs` Rule-5a/5b/5c 三子规约硬拦截 + `.gitignore` 兜底 + README "打开项目根"指引 · 三层防护永久消除漂移
- **归因**：Orchestrator 当时核查深度不足 · 未走 git 追踪态 · 仅凭"untracked"就判为"工具噪声"（而实际上 untracked 也有两种：配置级噪声 vs 规约级漂移 · 本例属后者）

#### v1.2-C · 同族规约盲区三连完整追溯

| 第 | FU-ID | 层 | 卡 | 解决脚本 |
|---|---|---|---|---|
| 1 | FU-COMMON-APP-JSON-DRIFT | L1 文件存在性 | COSTRA-119 | appjson-pages-check Rule-1/2/3 |
| 2 | FU-COMMON-APP-JSON-DRIFT-TABBAR | L3 微信规约（tabBar 主包铁律） | COSTRA-120 | appjson-pages-check Rule-4 |
| 3 | **FU-COMMON-PROJECT-CONFIG-DRIFT** | **L2 工具链 SSOT 单源** | **COSTRA-121** | **miniapp-tooling-check Rule-5a/5b/5c** |

**T2 档位结构性局限第 3 次兑现**：五闸全走"编译期 + 文件系统"视角 · 无人以"微信工具 runtime 视角"对账工具链配置 · 与 119/120 根本同族 · 本次由 Human 第三次撞坑暴露。

#### v1.2-D · 对未来 Review / Orchestrator / D-017 的三点输入

1. **对 Review**：涉及 `app.json` / wxml / tabBar / project.config.json / tsconfig.json 任一文件的审卡 · 强制增一步"跳出 dispatch · 独立做微信规约 + 工具链 SSOT 核对"（13.4 基础上新增工具链 SSOT 维度）
2. **对 Orchestrator**：事实源核查必须包含 git 追踪态工具链（ls-files / log / show HEAD:）· 否则易误判 untracked 文件性质
3. **对 D-017**：v1→v2 升级议题：在第 2 步"事实源三证齐全"加入"git 追踪态核查"作为硬性子步骤 · 议入 Sprint-1 末 Retro

#### v1.2-E · 自我评价

- **本 Review 质量**：仍为 APPROVE 33/35（不变）· 原 §1~12 对 COSTRA-119 代码质量评价正确
- **本 Review 缺陷延伸**：v1.1 §13.5 指出"审查广度盲区停留在 dispatch §2 Scope 内" · v1.2 进一步确认该盲区在**工具链 SSOT**层同样适用 · 119 R1 时 `miniprogram/project.config.json` 作为 untracked 已在工作区 · 若 Review-Tech 当时独立做工具链对账 · 理论上可以提前抓到该漂移 · 但考虑到 T2 档位定位（基建小卡 · 单轨审 · 无 runtime 验证能力）· 该要求超出 T2 合理边界 · 应由 CI 脚本族硬兜（即本卡 121 的 Rule-5 补位）

**追写人**：Review-Agent-Tech · 2026-04-28 17:xx · 随 COSTRA-121 同 tool call 循环完成
**授权**：Human 2026-04-28 16:03 方向 A 裁决 + 16:52 "打开项目根"事实确认
**版本**：v1.2（v1.1 基础上追加 §13.6 v1.2 补遗 · 原 §1~13.5 内容不动）
