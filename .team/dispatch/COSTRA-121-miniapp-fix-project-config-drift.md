# COSTRA-121 · project.config.json 工作区缺失恢复 + miniprogram 子副本删除 + CI Rule-5 工具链单源兜底 (FU-COMMON-PROJECT-CONFIG-DRIFT 专项)

- 派发人：Orchestrator
- 接收人：**MiniApp-Agent**（主驾 · 显式授权跨区 `scripts/devops/` + `.gitignore` + 根目录 `README.md` · 参照 COSTRA-119/120/116 先例）
- 派发时间：2026-04-28 16:55（Asia/Shanghai · Human 触发路径：第三次验证失败 → Orchestrator 事实源核查逆转 2 次 → 方向 A 裁决 + Human 确认"打开 Costra/ 根目录"范式 → 重写派单）
- 本轮截止：2026-04-28 17:25（同轮 D-016 兑现 R1）
- 优先级：**P0**（阻 Human 本地验证 · 与 119/120 同族规约盲区第 3 次暴露 · Human 04-28 15:58 第三次模拟器启动失败）
- 闸门影响：G4 合并前必须到位（`pr-check.yml` 新增 `check:tooling` 首跑必须零 warning）
- 分类：**COSTRA-119/120 同族规约盲区逃逸修复 + 工具链单源 SSOT 兜底**（Follow-up 专项卡 · 单一职责 · 三产出：恢复根 config + 删除子副本 + .gitignore 兜底 + 新 CI 脚本 + Human 操作指引）
- Review 档位：**T2**（基建类小卡 · 无业务逻辑 · 文件恢复/删除 + gitignore + 新 CI 脚本 + 文档 · Tech 单轨 · D-013 判定）
- 估点：**2**（0.5 点文件恢复/删除 + gitignore · 1 点新 CI 脚本 Rule-5 三子规约 · 0.5 点 package.json 脚本 + README 联动 + FU + §13 v1.2 追写）
- 依赖：COSTRA-119（已 Done · 文件漂移先例）· COSTRA-120（已 Done · tabBar 规约先例 + 本卡启动链上游）· COSTRA-115（CI 脚本范式）· COSTRA-116（跨区先例）
- 能力边界：**纯代码 / 纯文本改动**（无 DNS / 无微信后台 / 无跨机联调 · Agent 能力边界内 100%）

---

## 0. 背景（为什么是本卡 · COSTRA-119/120 同族规约盲区第 3 次暴露 · 事实源二次逆转版）

### 事件时序

Human 于 2026-04-28 15:58（COSTRA-120 收官后 14 分钟）按建议重开微信开发者工具做第三次模拟器启动验证：

```
[system] WeChatLib: 2.32.3 (2024.3.17)
[system] No. of subpackages: 2
[system] LazyCodeLoading: true
[system] Launch Time: 3378 ms         ← 对比前两次"卡住不动" · 本次启动成功推进

app.js 错误：
Error: module 'tokens/tokens.json.js' is not defined,
       require args is './tokens.json'
    at q (VM57 WASubContext.js:1)
    at n (VM57 WASubContext.js:1)
    at index.ts:5
    at app.ts:6                        ← 关键栈帧
    at f.runWith (VM57 WASubContext.js:1)
    (env: macOS,mp,2.01.2510290; lib: 2.32.3)

Page "pages/login/index" has not been registered yet
```

### 事实源核查逆转两次（Orchestrator 派单前 · D-017 第 2 步）

**第 1 次核查**（错）→ 判断为 `app.ts:6` 源码 `require('./tokens.json')` · 建议业务代码改造

**第 2 次核查**（半对）→ 发现源码是 ES `import` · 判断为"双 `project.config.json` 漂移 · 子目录覆盖根目录"

**第 3 次核查**（定稿 · 本卡基础）→ **git status 显示 `deleted: project.config.json` · HEAD 里仍存在 · 只是工作区当前缺失** → `miniprogram/project.config.json` 从未被 git 追踪（0 commit 历史）· 纯微信工具 GUI 自动生成物

### 核查三证齐全（定稿事实源）

**证 1 · 根目录 `project.config.json` 真实状态**：
- `git ls-files project.config.json` → 被 git 追踪 · 唯一 commit `5f4c8ee feat(miniapp): 搭建主包+分包骨架与 Mock 登录闭环`
- `git show HEAD:project.config.json` → 完整内容 · 含 `miniprogramRoot: "miniprogram/"` + `setting.useCompilerPlugins: ["typescript"]` + `setting.es6: true` + 生产就绪配置全量（58 行）
- `ls project.config.json` → **当前工作区缺失**（这就是 git status `deleted:` 的来源 · 尚未 commit 这次删除）

**证 2 · `miniprogram/project.config.json` 真实状态**：
- `git ls-files miniprogram/project.config.json` → **空**（从未被 git 追踪）
- `git log -- miniprogram/project.config.json` → **空**（无历史）
- `ls miniprogram/project.config.json` → 存在（25 行 · `useCompilerPlugins: false` · 无 `miniprogramRoot`）
- **结论**：纯微信工具 GUI 自动生成物 · 本就属于"本地噪声" · 不应纳入 git · 不应存在

**证 3 · `miniprogram/tokens/index.ts:5` 源码**：
```ts
import tokensJson from './tokens.json';
```
→ TS 原生 JSON import 语义 · 依赖 `tsconfig.json:12 "resolveJsonModule": true` · 本项目已启用 · **此代码本身无问题** · 报错根因在工具链配置未启用 TS 编译插件

### 事件时序还原（定稿版 · 与前两次猜测链完全不同）

```
① Sprint-0 骨架期（commit 5f4c8ee）：根目录 project.config.json 就位 · 含 miniprogramRoot + useCompilerPlugins: ["typescript"] · 微信官方推荐的项目根配置范式
② 某次 Human 用微信工具打开了 miniprogram/ 子目录（而非 Costra/ 项目根）
③ 微信工具以 miniprogram/ 为项目根 → 在该目录下自动生成一份简化版 project.config.json
   (useCompilerPlugins: false · 无 miniprogramRoot · 因为工具认为此处就是项目根)
④ 某次 Human 误删 / 工具清理 → 根目录 project.config.json 从工作区消失（HEAD 仍在 · 可恢复）
⑤ 之后 Human 只能打开 miniprogram/ 作为项目根（因根目录那份工作区缺失）· 工具继续读子目录 config · useCompilerPlugins 持续未启用
⑥ COSTRA-119 / 120 修 app.json 规约 · 启动链推进到 app.ts 执行期
⑦ 运行期工具读子目录那份 → 未启用 TS 插件 → 裸 `import json from './x.json'` 无法转译 → 微信 runtime 回退到 commonjs require + 自动补 `.js` 扩展 → `tokens/tokens.json.js` not defined
```

### 四层根因（COSTRA-119 / 120 / 121 三卡同族规约盲区对照）

| 层 | 119 盲区 | 120 盲区 | **121 盲区** |
|---|---|---|---|
| L1 表面症状 | 文件不存在 | tabBar need in pages | require JSON `module not defined` |
| L2 规约 | `app.json.pages[]` vs 文件 | `app.json.tabBar.pagePath` vs `pages[]` | **根目录 `project.config.json` 工作区缺失 + `miniprogram/project.config.json` GUI 自建副本未 gitignore** |
| L3 根因 | Sprint-0 骨架把页面声明了没建 | Sprint-0 骨架把 tabBar 放了分包 | **微信工具被打开在 miniprogram/ 子目录 · 自动生成子 config（useCompilerPlugins: false）· 叠加根目录 config 某次被误删未觉察 · 工具链 SSOT 双向破坏** |
| L4 CI 盲区 | `appjson-pages-check` 未建 | 只查文件存在性不查 tabBar 规约 | **无 `miniapp-tooling-check` · 无人查"根 config 存在性" + "useCompilerPlugins 含 typescript" + "子 config 禁出现"** |

### Human 打开微信工具的正确姿势（本卡范式定稿）

**应打开 `Costra/` 项目根**（Human 2026-04-28 16:52 确认："根目录 json 缺失时微信工具无法打开工程，miniprogram 目录下的 json 似乎可以不需要存在"）· 理由三条：

1. **依赖链完整性**：`miniprogram/` 依赖根目录的 `package.json` / `tsconfig.json` / `node_modules/` / `scripts/devops/*` · 打开子目录丧失全局上下文
2. **多文件协同**：项目四柱（api/ + server/ + docs/ + miniprogram/）· 根目录启动才能获得跳转/搜索完整能力
3. **微信官方范式**：`project.config.json` 在项目根 + `miniprogramRoot: "miniprogram/"` 指向子目录是微信官方推荐范式 · Sprint-0 骨架期 commit `5f4c8ee` 就是按此设计

### 为什么五闸命令行结构性漏检（T2 档位局限第 3 次兑现）

1. `typecheck` 走 tsc（`resolveJsonModule: true`）→ 编译期 JSON import 合法 · 绿
2. `vitest` 走 vite（原生 JSON 支持）→ 绿
3. `eslint` 不查运行时行为 → 绿
4. `check:appjson`（Rule-1~4）只查 `app.json` 与文件 · 不查 `project.config.json` → 绿
5. `check:whitelist` 域名方向 → 绿

**漏检本质**：五闸全部是"编译期 + 文件系统"视角 · **无人以"微信工具 runtime 视角"对账工具链配置**（根 config 存在性 + 编译插件启用 + 子 config 不漂移）· 微信 runtime 才爆类规约违反 · 第 3 次命中 T2 结构性漏检。

### Orchestrator 先前"工具噪声暂留"建议的致歉与修正

COSTRA-119 收官汇报中 Orchestrator 建议"工具噪声 `miniprogram/project.config.json` 暂留 · 等 Human 后续决策"属**错误判断**：
- 正确判断应为"工具链单源漂移（D-011 SSOT） · 必须同族处理"
- COSTRA-120 继承该错误建议 · 又暂留了一轮
- 本卡 COSTRA-121 纠偏 · 明确方向 A：**恢复根 config + 删除子 config + `.gitignore` 兜底 + CI Rule-5 硬拦截 + README 指引 Human 打开姿势**

### 实际冲击

- Human 2026-04-28 15:58 第三次撞坑 · COSTRA-102 Mock 通路仍被拦
- 121 修完之前 COSTRA-102 本地验证无法推进 · Sprint-1 末 04-30 硬节点再度承压
- Sprint-1 Backend/DevOps/MiniApp 基建线从"5 张小卡全数收官"退回"6 张（新增 121 未完）"· Sprint-1 估点 44→46
- **连续三张紧急卡均为 Sprint-0 骨架期遗留微信规约债务** · 强化 Sprint-1 末 Retro 第 10 条议题

### SSOT 权威

- D-011 · SSOT 规约：单一事实源不可漂移
- 微信官方：`project.config.json` 应位于项目根 · 通过 `miniprogramRoot` 指向源码子目录 · 打开子目录作为项目根是反范式
- Human 决策追溯：
  - 2026-04-28 16:03 · Human 方向裁决 = **A**（单源对齐 + CI 兜底）
  - 2026-04-28 16:52 · Human 确认事实："根目录 json 缺失时微信工具无法打开工程，miniprogram 目录下的 json 似乎可以不需要存在"（确立"打开 Costra/ 根目录"范式）

---

## 1. 目标（What · 一句话）

**恢复根目录 `project.config.json`（git restore HEAD）+ 删除漂移的 `miniprogram/project.config.json`（纯 GUI 噪声）+ `.gitignore` 永久兜底防再生 + 新立 `scripts/devops/miniapp-tooling-check.mjs` 三子规约（Rule-5a/5b/5c）硬拦截 + README 指引 Human 打开 `Costra/` 根目录**，从代码机制 + 操作姿势双层永久消除该类微信工具链漂移 P0。

---

## 2. Scope（做 / 不做）

### ✅ 做（八处改动 · 严格按方案 A）

- **D1 · 恢复根目录 `project.config.json`**：`git restore project.config.json`（HEAD 里完整 58 行 · 含 `miniprogramRoot: "miniprogram/"` + `useCompilerPlugins: ["typescript"]`）· **此步是方向 A 成立的物理前提** · 不做则 D2 一删工具完全打不开

- **D2 · 删除 `miniprogram/project.config.json`**（当前为 untracked · `rm` 即可 · 无需 `git rm`）

- **D3 · `.gitignore` 追加规则兜底**：
  ```
  # WeChat DevTools · sub-directory project.config.json GUI drift (COSTRA-121)
  miniprogram/project.config.json
  ```
  插入位置：现有 `# WeChat DevTools` 段内（第 22~25 行邻域）· 紧贴 `project.private.config.json` 规则之后 · 保持分组清晰 · 追加一行行尾注释引本卡号

- **D4 · 新建 `scripts/devops/miniapp-tooling-check.mjs`**（Rule-5 CI 脚本 · 约 ~140 行 · 参照 `appjson-pages-check.mjs` 结构范式）：
  - **Rule-5a · 根目录 project.config.json 必须存在**：`existsSync('project.config.json')` · 不存在即 exit 1 · 错误消息 "工作区缺失根 config · 微信工具无法打开项目 · 参见 COSTRA-121 · 执行 `git restore project.config.json` 恢复"
  - **Rule-5b · 根目录 project.config.json 的 `setting.useCompilerPlugins` 必须包含 `"typescript"`**：读 `project.config.json` · JSON.parse · 断言 `Array.isArray(setting.useCompilerPlugins) && setting.useCompilerPlugins.includes("typescript")` · 不满足即 exit 1 · 错误消息引微信官方 TS 编译插件文档 + 本卡说明
  - **Rule-5c · 子目录 project.config.json 禁出现**：`existsSync('miniprogram/project.config.json')` · 存在即 exit 1 · 错误消息 "子目录 GUI 副本漂移 · rm miniprogram/project.config.json · Human 应打开 Costra/ 项目根启动微信工具而非 miniprogram/ 子目录 · 参见 D-011 SSOT · 参见 COSTRA-121"
  - 契约：exit 0 全过 · exit 1 三子规约任一违反 · exit 2 解析失败
  - 零依赖（Node 原生 fs/path/url · 同 appjson-pages-check.mjs 范式）
  - 头注释：卡号 COSTRA-121 · Owner MiniApp-Agent（跨区） · 母问题时间线 · 姊妹脚本 appjson-pages-check + whitelist-check
  - `--verbose` 标志 · 扫描到的路径 + 对账结果逐条打印（同 appjson-pages-check 范式）

- **D5 · `package.json` scripts 段新增一行**：
  ```json
  "check:tooling": "node ./scripts/devops/miniapp-tooling-check.mjs",
  ```
  插入位置：紧贴 `"check:appjson"` 之后 · 保持 check 族分组清晰

- **D6 · `README.md` 新增"本地开发 · 打开微信开发者工具"段落**（~15 行）：
  - 位置：`README.md §快速开始` 之后新增 §"本地开发 · 微信开发者工具"段
  - 内容要点：① 必须打开 `Costra/` **项目根**而非 `miniprogram/` 子目录 ② 说明原因（根 config + miniprogramRoot 范式 + 多柱协同） ③ 链接 `project.config.json`（根配置 SSOT） ④ 链接 `scripts/devops/miniapp-tooling-check.mjs`（CI 兜底） ⑤ 明确约定：若工具 GUI 再生成 `miniprogram/project.config.json` · Human 本地 `rm` 即可 · `.gitignore` + CI 双层拦截防污染仓库
  - ❌ 不加 screenshot / 不加冗余解释 · 仅必要信息

- **D7 · `.team/follow-ups/README.md`**：
  - 新增 **FU-COMMON-PROJECT-CONFIG-DRIFT** 条目（同轮登记 + 同轮 `closed` · resolved_by COSTRA-121）
  - 修订 FU-COMMON-APP-JSON-DRIFT-TABBAR（120 那条）追加"同族规约盲区第 3 次"备注
  - 修订 FU-COMMON-APP-JSON-DRIFT（119 那条）追加同族备注
  - 三条 FU 形成完整"同族规约盲区三连"追溯链

- **D8（治理沉淀 · 跨 Scope）** 在 `.team/reviews/COSTRA-119/round-1-tech.md` 的 §13 元自省段内追加 "v1.1 → v1.2" 迭代说明：
  - 新增约 ~25 行 · 内容涵盖："COSTRA-121 同族规约盲区第 3 次暴露确认 T2 档位结构性局限 · 事实源核查链二次逆转的教训（先猜 require 改造 → 再猜双 config 漂移 → 最终定稿根 config 工作区缺失 · 三次核查才找到真根因）· Sprint-1 末 Retro 强推 D-017 升定稿规约 + CI 对账族从 Rule-4 再扩到 Rule-5 三子规约 · Orchestrator 2026-04-28 COSTRA-119 收官的'工具噪声暂留'判断属误判已在 121 纠偏"
  - 位置：§13 文末追加新子段 `v1.2 补遗`

### ❌ 不做（Scope 铁律）

- ❌ 改 `miniprogram/tokens/index.ts` 或 `tokens/tokens.json`（业务代码不动 · 本卡是工具链恢复 · 不是业务迁移）
- ❌ 改 `tsconfig.json`（`resolveJsonModule: true` 保持 · 编译期语义正确）
- ❌ **编辑**根目录 `project.config.json`（仅 `git restore` 恢复 · 不增不改内容 · HEAD 里那份就是 SSOT）
- ❌ 改 `app.ts`（其第 6 行 import 语义正确 · 根因不在此）
- ❌ 改 `app.json`（与 119/120 无关 · 本卡不碰）
- ❌ 删除 `project.private.config.json.example`（已 gitignore 兜底 · 范式已对齐）
- ❌ 扩展 `appjson-pages-check.mjs` 加 Rule-5（YAGNI 边界 · 不同职责族 · `appjson-pages-check` 是 app.json 一致性 · `miniapp-tooling-check` 是工具链单源 · 分脚本更清晰）
- ❌ 写单元测试（CI 脚本 · 五闸即测试 · 115/119/120 先例）
- ❌ 动 Sprint-3 业务或其他占位页
- ❌ 引入任何 npm 依赖（零依赖铁律 · 沿袭 115/116/119/120）
- ❌ 改微信 GUI 行为（能力边界外 · GUI 是否再生成子文件取决于 Human 下次操作姿势 · 本卡只能文档指引 + CI 兜底）
- ❌ 修改 `miniprogram/README.md`（§3/§4.1 不动 · 本卡 Human 指引入主 README.md · 与 miniprogram/README.md 的 MiniApp 开发说明职责不同）

### ❓ 必要时升 ADR（本卡预判不需要）

- 若实装时发现 `git show HEAD:project.config.json` 与实际应有配置不符（预期不会）→ 停止 · 升 Review-Tech 讨论
- 若 Rule-5 实装过程中发现还有其他微信工具链漂移点（`sitemap.json` / `ext.json` 等）→ 本卡只做 Rule-5a/5b/5c · 其他规约新开卡

---

## 3. 交付物（八处 · 每处都小且可机械校验）

| 编号 | 文件 | 类型 | 预计行数 |
|---|---|---|---|
| D1 | `project.config.json` | 恢复（`git restore` · HEAD 已有） | +58 行（回复 git 追踪态 · 消 `deleted:` 标记） |
| D2 | `miniprogram/project.config.json` | 删除（untracked · rm） | -25 行（不入 git diff） |
| D3 | `.gitignore` | 改（追加 2 行：1 注释 + 1 规则） | +2 行 |
| D4 | `scripts/devops/miniapp-tooling-check.mjs` | 新建（零依赖 · 参照 appjson-pages-check 范式 · 三子规约） | ~140 行 |
| D5 | `package.json` | 改（scripts 段 +1 行 check:tooling） | +1 行 |
| D6 | `README.md` | 改（新增"本地开发 · 微信开发者工具"段 · ~15 行） | ~15 行增 |
| D7 | `.team/follow-ups/README.md` | 改（新 FU-COMMON-PROJECT-CONFIG-DRIFT + 修订 120/119 两条 FU） | ~35 行增 |
| D8 | `.team/reviews/COSTRA-119/round-1-tech.md §13 v1.2` | 追加元自省"v1.2 补遗"子段 | ~25 行增 |

**总计**：1 新脚本 + 5 文件改 + 1 文件恢复 + 1 文件删 · 约 275 行净新增 · **绝对禁止发散**

---

## 4. DoD（完工判定 · 必须全部达成）

- [ ] D1~D8 八处改动全部落地 · 零缺项
- [ ] `test -e project.config.json && echo OK || echo MISSING` → 打印 `OK`（根 config 已恢复）
- [ ] `test -e miniprogram/project.config.json && echo EXIST || echo OK` → 打印 `OK`（子 config 已删）
- [ ] `git status --short project.config.json` → **空**（`deleted:` 标记消失 · 因 `git restore` 已恢复工作区与 HEAD 一致）
- [ ] `git status --short miniprogram/project.config.json` → **空**（已 gitignore · 不再 untracked 出现）
- [ ] `grep -F 'miniprogram/project.config.json' .gitignore` → 命中 1 行（兜底规则已入）
- [ ] `node --check scripts/devops/miniapp-tooling-check.mjs` → exit 0（语法）
- [ ] `npm run check:tooling` → **exit 0 · 打印 "tooling single-source: root project.config.json present · useCompilerPlugins includes 'typescript' · no sub-directory drift"** 或等价证据 · **核心价值闸门**
- [ ] `npm run check:appjson` → exit 0（回归）
- [ ] `npm run check:whitelist` → exit 0（回归）
- [ ] `npm run typecheck` → exit 0（回归 · tokens/index.ts 等业务代码不动）
- [ ] `npm test` → 13/13 pass（回归）
- [ ] **Rule-5a 反向验证**：临时 `mv project.config.json project.config.json.bak` 跑 `npm run check:tooling` · 必须 exit 1 · 错误消息包含 "工作区缺失根 config" 与 "COSTRA-121" 字样 · 然后 `mv project.config.json.bak project.config.json` revert · response 里贴输出截段证明
- [ ] **Rule-5b 反向验证**：临时把根目录 `project.config.json` 的 `useCompilerPlugins` 改为 `false` · 跑 `npm run check:tooling` · 必须 exit 1 · 错误消息包含 "useCompilerPlugins" 与 "typescript" · `git checkout project.config.json` revert · response 里贴输出截段证明
- [ ] **Rule-5c 反向验证**：临时 `cp project.config.json miniprogram/project.config.json` 跑 `npm run check:tooling` · 必须 exit 1 · 错误消息包含 "miniprogram/project.config.json" 与 "COSTRA-121" 字样 · 然后 `rm miniprogram/project.config.json` revert · response 里贴输出截段证明
- [ ] `.team/follow-ups/README.md` 三条 FU 串联追溯（119/120/121 同族）完整可读
- [ ] response 报告单独说明：**为什么 Rule-5 新建脚本而不是扩 appjson-pages-check？**（预期回答：职责族不同 · appjson-pages 是 app.json 一致性 · tooling 是工具链单源 · 分脚本更清晰更符合 SRP · YAGNI 的反面是 SRP）
- [ ] response 报告单独说明：**为什么先前 Orchestrator 给出"双 config 漂移"分析是错的？定稿事实是什么？**（预期回答：git ls-files + git log 核查显示根 config 被 git 追踪 · 子 config 从未被追踪 · 真相是"根 config 工作区缺失 + 子 config GUI 噪声"双破坏 · 非"双文件漂移"）
- [ ] response 报告单独说明：**为什么 Human 验证后才暴露而不是 CI？**（预期回答：T2 档位 + 五闸全走"编译期 + 文件系统"视角 · 无人以"微信工具 runtime 视角"对账 · 本卡 Rule-5 正是补该视角）
- [ ] FU-COMMON-PROJECT-CONFIG-DRIFT 同轮登记 + 同轮 closed

---

## 5. 五闸（pre-commit 前本地跑过）

1. `node --check scripts/devops/miniapp-tooling-check.mjs` → exit 0（语法）
2. `npm run check:tooling` → **exit 0 · Rule-5a/5b/5c 三子规约均显式过**（核心闸门）
3. **Rule-5a 反向验证**：临时移走根 project.config.json → `npm run check:tooling` 必须 exit 1 → mv 回 revert
4. **Rule-5b 反向验证**：临时关闭根 useCompilerPlugins typescript → `npm run check:tooling` 必须 exit 1 → git checkout revert
5. **Rule-5c 反向验证**：临时复制根 config 到子目录 → `npm run check:tooling` 必须 exit 1 → 删掉 revert
6. `npm run check:appjson` → exit 0（Rule-1~4 回归）
7. `npm run check:whitelist` → exit 0（回归）
8. `npm run typecheck` → exit 0
9. `npm test` → 13/13 pass

任何一项未绿 → 不 commit。

---

## 6. Review 档位与 Handoff

- **档位**：T2（D-013 · 基建类小卡 · 无业务 · 无接口变更 · 文件恢复 + 删除 + gitignore + 新 CI 脚本 + 文档 · Tech 单轨）
- **Reviewer**：Review-Agent-Tech（单轨 · 无需 Review-Product · 工具链纯基建 IA 无冲击）
- **跨区说明**：本卡涉及 `miniprogram/`（MiniApp 主区侧：本卡仅删一文件）+ `scripts/devops/`（DevOps）+ `.gitignore`（DevOps）+ 根目录 `README.md`（项目治理域）+ `project.config.json`（工具链 SSOT · 仅恢复不改）+ `.team/decisions/` 无新规约 + `.team/reviews/COSTRA-119/round-1-tech.md` 追写（Orchestrator 域）· 参照 119/120/116 先例 · 主产出属性归 MiniApp · Review-Tech 单轨审 · 跨区第 4 次实战
- **Handoff 契约**：R1 产出后同一 tool call 循环触发 Review（D-016 铁律 · 本卡第 10 次实战）
- **预期终审路径**：AI Review APPROVE → Human `approve:COSTRA-121` → Human **以打开 `Costra/` 项目根方式**第四次重开微信开发者工具模拟器启动成功 → 立即跑 COSTRA-102 Mock 5 步

---

## 7. 风险与对冲

| 风险 | 概率 | 影响 | 对冲 |
|---|---|---|---|
| `git restore project.config.json` 恢复后内容与预期不符 | 极低 | 高 | 派单前 Orchestrator 已 `git show HEAD:project.config.json` 核查 · 58 行完整 · 含 `miniprogramRoot: "miniprogram/"` + `useCompilerPlugins: ["typescript"]` · 与方向 A 前提完全匹配 · 实装时如发现不符立即停卡升 Review |
| 删除 `miniprogram/project.config.json` 后微信工具无法打开项目 | 低 | 高 | 根目录 `project.config.json` 已恢复 · Human 改以打开 `Costra/` 项目根方式启动 · Human 2026-04-28 16:52 确认可行（"根目录 json 缺失时微信工具无法打开工程，miniprogram 目录下的 json 似乎可以不需要存在"） |
| `.gitignore` 规则书写错位（误 ignore 了根 project.config.json） | 低 | 高 | 使用精确路径 `miniprogram/project.config.json`（非 glob）· 只匹配子目录那一个文件 · 不影响根目录那份 |
| Rule-5b 正常情况误杀（根 project.config 本就无 typescript 插件） | 极低 | 中 | 派单前 Orchestrator 已核查 · HEAD 里第 61~63 行 `"useCompilerPlugins": ["typescript"]` · 本卡方向 A 的核心前提 · `git restore` 后立即成立 |
| 反向验证改坏了没 revert 就 commit | 中 | 高 | DoD §4 明文要求三次反向验证后立即 revert · Review-Tech 强制 `git status --short` 检查 final diff 不含 `miniprogram/project.config.json` 与 `project.config.json 修改` |
| Rule-5 脚本新建后发现遗漏其他工具链漂移点 | 中 | 低 | Scope 铁律明禁本卡扩展其他规约 · 发现新盲区另开卡（同族规约盲区三连范式） |
| 微信工具 GUI 再次在 Human 打开子目录时自动生成子文件 | 中 | 低 | README §"本地开发"指引明确"打开 `Costra/` 项目根" + `.gitignore` 兜底 + `check:tooling` CI 拦截三层防护 · Human 误操作时 CI 会硬拦截提交 |
| tokens/index.ts 的 `import json from './tokens.json'` 虽然本卡不动但是否仍需 runtime 修复 | 低 | 中 | 恢复根 config + 删除子 config → 微信工具读根 config（含 `useCompilerPlugins: ["typescript"]`）+ Human 打开项目根 → TS 编译插件启用 → `import json` 被正确转译 → runtime 错误根因消除 · 理论闭环 |
| Human 下次不小心又打开了 miniprogram/ 子目录（操作惯性） | 中 | 中 | README §"本地开发"段落顶置 + 工具首次打开项目根后记忆（微信工具会记住最近打开的项目）· 短期教育成本 · 长期无忧 |

---

## 8. 产出模板（响应结构 · 对齐 119/120）

MiniApp-Agent 完工后写 `.team/reviews/COSTRA-121/round-1-miniapp-response.md`，包含：

- **变更清单**（8 处 · 每处贴关键片段）
- **五闸证据**（命令 + exit code + 关键输出 · 特别是 Rule-5a/5b/5c 三向反向验证前后对比 · 三组 exit code 都贴）
- **Scope 遵守声明**（哪些没碰 / 为什么 · 特别强调 tokens/index.ts 和 tsconfig.json 和根 project.config.json 内容不动）
- **卡号引用合规证明**（grep 自查 · FU-118-4 教训）
- **下游影响断言**（是否影响 Sprint-3 Epic 或 COSTRA-102 · 预期正向解锁 · 工具链修复后模拟器启动通路完整贯通）
- **COSTRA-119/120 同族规约盲区三连自省**（T2 档位局限第 3 次 · CI 对账族第 3 次扩展 · Orchestrator 事实源核查链二次逆转的教训 · Orchestrator "工具噪声暂留"判断纠偏 · 对 Review-Agent-Tech 未来的输入）
- **本卡独有维度 · D-011 SSOT 规约在工具链层首次实战**

---

## 9. 追溯

- FU 登记：新增 FU-COMMON-PROJECT-CONFIG-DRIFT（同轮登记 + 同轮 closed · resolved_by COSTRA-121）· 同时修订 FU-COMMON-APP-JSON-DRIFT 与 FU-COMMON-APP-JSON-DRIFT-TABBAR 追加同族备注
- 母问题：Human 2026-04-28 15:58 第三次重开微信开发者工具 · 模拟器启动成功但 app.ts:6 import 报 `module not defined`
- 相关卡：COSTRA-030（骨架源头 · 不回溯）· COSTRA-115（CI 范式）· COSTRA-116（跨区先例）· **COSTRA-119（同族第 1 次 · 文件侧）** · **COSTRA-120（同族第 2 次 · tabBar 规约侧）** · **COSTRA-121（同族第 3 次 · 工具链单源 · 本卡）** · COSTRA-102（被持续阻塞 · 本卡解锁）
- 规约引用：**D-011 · SSOT 规约首次工具链层实战**（本卡 D1/D2/D3/D4/D6 五位一体兜底 · 恢复 + 删除 + gitignore + CI + 操作指引）· D-012（单卡即提交）· D-013（T2）· D-014/D-016（自动拉起同轮兑现 · 本卡第 10 次实战）· D-017（Human 验证问题 → Orchestrator 事实源核查 → 方向裁决 → 派单 · 第 2 次实战 · 120 是第 1 次 · 本卡事实源核查链二次逆转也为 D-017 升定稿提供新证据）· COSTRA-114 v2（能力边界铁律 · 第 3 次正面兑现）
- SSOT：D-011（单一事实源规约）· 微信官方 `project.config.json` 配置规范 · `README.md §本地开发`（工具打开姿势新立）
- 决策：D-011（本卡首次工具链实战）· D-012 · D-013 · D-014/D-016 · D-017（第 2 次实战）· COSTRA-114 v2（能力边界 · 无法直开微信工具所以靠 CI + README 指引双重兜底）

---

**MiniApp-Agent · 接单 · R1 实装并触发 AI Review-Tech · 同 tool call 循环内完成。**
