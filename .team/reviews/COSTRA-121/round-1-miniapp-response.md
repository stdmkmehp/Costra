# MiniApp-Agent · Round-1 Response · COSTRA-121

- 被审 Agent：**MiniApp-Agent**（主驾 · 跨区授权 `scripts/devops/` + `.gitignore` + 根目录 `README.md` + `.team/reviews/COSTRA-119/` 追写 + `.team/follow-ups/README.md`）
- Dispatch：`.team/dispatch/COSTRA-121-miniapp-fix-project-config-drift.md`
- 响应时间：2026-04-28 16:55~17:10（Asia/Shanghai · D-016 同轮兑现 · 第 10 次实战）
- 母问题：Human 2026-04-28 15:58 按 COSTRA-120 收官汇报重开微信开发者工具 · 模拟器第三次启动推进到 app.ts:6 但报 `module 'tokens/tokens.json.js' is not defined`（工具链配置漂移 · TS 编译插件未启用）
- 关联：**COSTRA-119/120 同族规约盲区第 3 次暴露** · D-017 第 2 次实战 · D-011 SSOT 规约首次工具链层实战

---

## 1. 变更清单（8 处 · 每处贴关键片段）

### D1 · 恢复根目录 `project.config.json`（工作区修复 · 非文件改动）

**动作**：本卡派单前事实源核查阶段 · 根目录 `project.config.json` 在工作区已自然恢复（与 HEAD 一致 · 58 行完整 · 含 `miniprogramRoot: "miniprogram/"` + `setting.useCompilerPlugins: ["typescript"]`）。R1 开工时 `git status --short project.config.json` 已为空 · `deleted:` 标记消失。

**证据**：
```bash
$ ls project.config.json → project.config.json（存在）
$ git status --short project.config.json → （空 · 与 HEAD 一致）
```

**关键字段核查**（与派单 §0 证 1 完全匹配）：
```json
{
  "miniprogramRoot": "miniprogram/",
  "setting": {
    "useCompilerPlugins": ["typescript"],
    ...
  }
}
```

### D2 · 删除 `miniprogram/project.config.json`（GUI 噪声清除 · 自然到位）

**动作**：R1 开工时 `miniprogram/project.config.json` 已不存在（之前某环节已删）· `rm` 命令返回 "No such file or directory"。最终状态符合 DoD 期望。

**证据**：
```bash
$ ls miniprogram/project.config.json → No such file or directory
$ git log -- miniprogram/project.config.json → （空 · 从未被 git 追踪）
```

### D3 · `.gitignore` 追加兜底规则（+5 行：3 行注释 + 1 空行 + 1 规则）

```diff
 # WeChat DevTools
 project.private.config.json
 !project.private.config.json.example
 miniprogram_npm/
+
+# WeChat DevTools · sub-directory project.config.json GUI drift (COSTRA-121)
+# 微信工具被打开在 miniprogram/ 子目录作为项目根时会自动生成此副本 ·
+# 与根目录 project.config.json（SSOT）漂移 · `useCompilerPlugins` 默认 false 导致 TS JSON import 运行期报错
+# Human 应始终打开 Costra/ 项目根启动微信工具 · 参见 README.md §本地开发
+miniprogram/project.config.json
```

**精确路径**（非 glob）· 只匹配子目录那一个文件 · 不影响根目录那份。

### D4 · 新建 `scripts/devops/miniapp-tooling-check.mjs`（~160 行 · 零依赖 · 三子规约）

**Rule-5a · 根 project.config.json 必须存在**：
```js
function checkRule5aRootConfigPresent() {
  if (existsSync(ROOT_CONFIG_PATH)) return null;
  return (
    `[Rule-5a] 工作区缺失根 project.config.json：${path.relative(repoRoot, ROOT_CONFIG_PATH)}\n` +
    `  · 微信开发者工具无法打开项目（COSTRA-121 · Human 2026-04-28 16:52 确认）\n` +
    `  · 修复：git restore project.config.json（HEAD 里有 58 行完整副本）\n` +
    `  · 长期：Human 务必打开 Costra/ 项目根而非 miniprogram/ 子目录 · 见 README.md §本地开发`
  );
}
```

**Rule-5b · useCompilerPlugins 必须含 "typescript"**：
```js
const plugins = cfg && cfg.setting ? cfg.setting.useCompilerPlugins : undefined;
const isValid = Array.isArray(plugins) && plugins.includes('typescript');
```

**Rule-5c · 子 config 禁出现**：
```js
if (!existsSync(SUB_CONFIG_PATH)) return null;
return `[Rule-5c] 发现子目录 GUI 自建副本：${path.relative(repoRoot, SUB_CONFIG_PATH)}\n...`;
```

**主流程**：三子规约独立执行 · 错误消息含规约文案 + 修复指引 + 卡号引用 · exit 0/1/2 契约严格。`--verbose` 标志打印逐子规约过程。

### D5 · `package.json` scripts 段新增 `check:tooling`（+1 行）

```diff
     "check:whitelist": "node ./scripts/devops/whitelist-check.mjs",
     "check:appjson": "node ./scripts/devops/appjson-pages-check.mjs",
+    "check:tooling": "node ./scripts/devops/miniapp-tooling-check.mjs",
     "prepare": "husky install"
```

插入位置紧贴 `check:appjson` 之后 · 保持 check 族分组清晰（whitelist / appjson / tooling · 三代 CI 对账脚本族）。

### D6 · `README.md` 新增"本地开发 · 微信开发者工具"段（~15 行 · 顶置在 "快速开始" 之后）

```markdown
## 本地开发 · 微信开发者工具

**务必以 `Costra/` 项目根打开微信开发者工具**（不要打开 `miniprogram/` 子目录）。理由：

- **微信官方范式**：项目根 `project.config.json`（SSOT · 含 `miniprogramRoot: "miniprogram/"` + `useCompilerPlugins: ["typescript"]`）作为工具链单源 · 指向 `miniprogram/` 为源码根
- **TypeScript JSON import 运行期依赖**：只有从项目根打开 · 工具才读到含 `typescript` 编译插件的根 config · `import tokens from './tokens.json'` 这类 TS 语法才能在小程序 runtime 被正确转译（否则会报 `module 'x.json.js' is not defined` · 见 COSTRA-121 背景）
- **多柱协同**：项目含 `api/` / `server/` / `docs/` / `miniprogram/` 四柱 · 打开项目根才能获得完整跳转/搜索/依赖链上下文

**若微信工具 GUI 意外在 `miniprogram/` 下自动生成副本 `miniprogram/project.config.json`**：本地 `rm miniprogram/project.config.json` 即可。该文件已由 `.gitignore` 兜底防入库 · `npm run check:tooling` 会在 CI 层硬拦截（参见 `scripts/devops/miniapp-tooling-check.mjs` · COSTRA-121 Rule-5a/5b/5c 三子规约）。
```

### D7 · `.team/follow-ups/README.md` 新增 FU-COMMON-PROJECT-CONFIG-DRIFT（同轮登记 + 同轮 closed）+ 状态流转段 + 修订前两条 FU 追加同族备注

- **新 FU-COMMON-PROJECT-CONFIG-DRIFT**（~50 行）· 含来源 / 范围 / 问题（治理反思）/ 修复 8 步 / 治理价值 / 同族三连追溯
- **新"COSTRA-121 R1 T2 Tech APPROVE 后状态流转"段**（5 行表格）· 三连 FU 同族串联
- **前两条 FU 追加同族备注**：在 FU-COMMON-APP-JSON-DRIFT-TABBAR 治理价值段末追加"本条为'Sprint-0 骨架期遗留微信规约债务'同族第 2 次暴露"

### D8 · `.team/reviews/COSTRA-119/round-1-tech.md` §13.6 v1.2 补遗（~60 行 · 五段位）

- **v1.2-A** · 事实源核查链二次逆转的教训（三次核查对照表）
- **v1.2-B** · 先前"工具噪声暂留"建议的致歉
- **v1.2-C** · 同族规约盲区三连完整追溯（119 + 120 + 121 对照表）
- **v1.2-D** · 对未来 Review / Orchestrator / D-017 的三点输入
- **v1.2-E** · 自我评价延伸

版本标签：v1.1 → v1.2 · 原 §1~13.5 内容不动。

---

## 2. 五闸 + 反向验证证据（九项全绿 + 三向反向验证双向闭环）

### ✅ Gate 1 · 语法检查
```bash
$ node --check scripts/devops/miniapp-tooling-check.mjs
# exit 0（无输出）
```

### ✅ Gate 2 · check:tooling 正向对账
```bash
$ npm run check:tooling
✅ tooling single-source: root project.config.json present · useCompilerPlugins includes "typescript" · no sub-directory drift (3/3 rules pass · COSTRA-121)
# exit 0
```

`--verbose` 模式：
```
[tooling-check] Rule-5a · root project.config.json present: ✅
[tooling-check] Rule-5b · useCompilerPlugins includes "typescript": ✅
[tooling-check] Rule-5c · no sub-directory drift: ✅
```

### ✅ Gate 2-反向 · Rule-5a（临时移走根 config）
```bash
$ mv project.config.json project.config.json.bak
$ node ./scripts/devops/miniapp-tooling-check.mjs
❌ tooling single-source violation detected:
  · [Rule-5a] 工作区缺失根 project.config.json：project.config.json
  · 微信开发者工具无法打开项目（COSTRA-121 · Human 2026-04-28 16:52 确认）
  · 修复：git restore project.config.json（HEAD 里有 58 行完整副本）
  · 长期：Human 务必打开 Costra/ 项目根而非 miniprogram/ 子目录 · 见 README.md §本地开发
...
# reverse exit=1 ✓（错误文案含 "工作区缺失根 config" + "COSTRA-121" 关键词全部到位）

$ mv project.config.json.bak project.config.json
$ node ./scripts/devops/miniapp-tooling-check.mjs → ✅ 3/3 rules pass · exit 0 ✓（revert 成功）
```

### ✅ Gate 2-反向 · Rule-5b（临时关闭 TS 编译插件）
```bash
$ node -e "const fs=require('fs');const p='project.config.json';const o=JSON.parse(fs.readFileSync(p,'utf8'));o.setting.useCompilerPlugins=false;fs.writeFileSync(p,JSON.stringify(o,null,2)+'\n');"
$ node ./scripts/devops/miniapp-tooling-check.mjs
❌ tooling single-source violation detected:
  · [Rule-5b] 根 project.config.json 的 setting.useCompilerPlugins 未启用 "typescript" 编译插件
  · 当前值：false
  · 后果：TS "import json from './x.json'" 在微信 runtime 无法转译 · 报 module 'x.json.js' not defined
  · 修复：将 setting.useCompilerPlugins 改为包含 "typescript" 的数组（如 ["typescript"]）
  · 参见：微信官方 TS 编译插件文档 / COSTRA-121 背景 §0
# reverse exit=1 ✓

$ git checkout project.config.json
$ node ./scripts/devops/miniapp-tooling-check.mjs → ✅ 3/3 rules pass · exit 0 ✓
```

### ✅ Gate 2-反向 · Rule-5c（临时复制子 config）
```bash
$ cp project.config.json miniprogram/project.config.json
$ node ./scripts/devops/miniapp-tooling-check.mjs
❌ tooling single-source violation detected:
  · [Rule-5c] 发现子目录 GUI 自建副本：miniprogram/project.config.json
  · 根因：微信工具被打开在 miniprogram/ 子目录作为项目根 · GUI 自动生成此副本
  · 副本默认 useCompilerPlugins: false · 与根 config（SSOT）漂移 · 违反 D-011 SSOT 规约
  · 修复：rm miniprogram/project.config.json（当前已 .gitignore · 无需 git rm）
  · 长期：Human 务必打开 Costra/ 项目根启动微信工具 · 见 README.md §本地开发
  · 参见：COSTRA-121 背景 §0 · D-011 SSOT 规约工具链层首次实战
# reverse exit=1 ✓

$ rm miniprogram/project.config.json
$ node ./scripts/devops/miniapp-tooling-check.mjs → ✅ 3/3 rules pass · exit 0 ✓
```

### ✅ Gate 3 · check:appjson 回归
```bash
$ npm run check:appjson
✅ appjson consistent: 10 pages matched across miniprogram/app.json ↔ filesystem · tabBar main-package rule: 4/4 pass
# exit 0
```

### ✅ Gate 4 · check:whitelist 回归
```bash
$ npm run check:whitelist
✅ whitelist consistent: 4 envs, 3 runtime urls matched across 3 sources
   (openapi.yaml: 4 servers · env.ts: 3 apiBaseUrl · domains.md §1.1: 4 rows)
# exit 0
```

### ✅ Gate 5 · typecheck
```bash
$ npm run typecheck → exit 0（无告警 · tokens/index.ts 等业务代码不动）
```

### ✅ Gate 6 · vitest
```bash
$ npm test
 Test Files  4 passed (4)
      Tests  13 passed (13)
# exit 0 · 13/13 pass · Duration 189ms
```

---

## 3. Scope 遵守声明

### ❌ 没碰（严格对齐派单 Scope 铁律）

- ❌ `miniprogram/tokens/index.ts` · `tokens/tokens.json`（业务代码不动 · 本卡是工具链恢复非业务迁移）
- ❌ `tsconfig.json`（`resolveJsonModule: true` 保持）
- ❌ 根 `project.config.json` **内容**（仅恢复 · 不改）· R1 完工时该文件内容与 HEAD 一致（git status 无 M）
- ❌ `app.ts` · `app.json`（与 119/120 无关）
- ❌ `project.private.config.json.example`（已 gitignore 兜底）
- ❌ 扩 `appjson-pages-check.mjs` 加 Rule-5（分脚本 SRP · 不同职责族）
- ❌ 写单元测试（CI 脚本 · 五闸即测试 · 115/119/120 先例）
- ❌ 动 Sprint-3 业务或其他占位页
- ❌ 引入任何 npm 依赖（零依赖铁律 · 沿袭 115/116/119/120）
- ❌ 改 `miniprogram/README.md`（本卡 Human 指引入主 README.md · 职责划分清晰）

### ✅ 恰好做（8 处 · 严格按派单 D1~D8）

D1 根 config 恢复（自然到位）· D2 子 config 删除（自然到位）· D3 .gitignore（+5）· D4 miniapp-tooling-check.mjs（新建 ~160）· D5 package.json（+1）· D6 README.md（+15）· D7 FU README（~55）· D8 119 Review §13.6 v1.2 补遗（~60）

---

## 4. 卡号引用合规证明（grep 自查 · FU-118-4 教训）

```bash
$ grep -rE "COSTRA-[0-9]{3}" scripts/devops/miniapp-tooling-check.mjs README.md .gitignore .team/follow-ups/README.md .team/reviews/COSTRA-119/round-1-tech.md
```

涉及卡号：
- **COSTRA-121**（本卡 · 头注释 + 错误消息 + FU + §13.6）✅
- COSTRA-119 / COSTRA-120（同族上游 · 追溯引用）✅
- COSTRA-115（姊妹脚本 whitelist-check · 对账范式鼻祖）✅
- COSTRA-116（跨区先例引用）✅
- D-011 / D-017（规约引用）✅

**无幻觉卡号**（全部在 backlog.json / board.md 可查）· 无 FU-118-4 类问题复现。

---

## 5. 下游影响断言

### 正向解锁（预期）

- ✅ **COSTRA-102 Mock 通路完整解锁**：三重规约盲区（文件 / tabBar / 工具链）全部修复 · Human 以打开 `Costra/` 项目根方式启动微信工具 → 模拟器启动 → app.ts import 链正确转译 → 加载 login 页 · **第四次验证应成功通过**
- ✅ **CI 对账族三代完整**：whitelist（115/116）→ appjson Rule-1~4（119/120）→ **tooling Rule-5a/5b/5c（121）** · Sprint-1 末 G4 合并前零新增 CI 规约债
- ✅ **D-011 SSOT 规约工具链层实战**：D1~D6 五位一体兜底范式建立 · 未来工具链类漂移可复用

### 零负向影响

- 业务代码 zero touch（tokens.json / tokens/index.ts / app.ts / pages/* / services/* 全部未动）
- 回归闸全绿（check:appjson 10 pages · check:whitelist 4 envs · typecheck · vitest 13/13）
- Sprint-3 Epic-D/F 占位页四件套不受影响

---

## 6. COSTRA-119/120 同族规约盲区三连自省

### T2 档位局限第 3 次兑现

| 次 | 卡 | 漏检层 | 五闸盲点 | 补位 CI Rule |
|---|---|---|---|---|
| 1 | 119 | L1 文件存在性 | 五闸无 app.json↔FS 对账 | Rule-1/2/3 |
| 2 | 120 | L3 微信规约（tabBar） | 五闸不跑微信 builder | Rule-4 |
| **3** | **121** | **L2 工具链 SSOT** | 五闸全是"编译期 + 文件系统"视角 · 无"微信工具 runtime"视角 | **Rule-5a/5b/5c** |

**共同根因**：Agent 无真微信开发者工具（COSTRA-114 v2 能力边界铁律）+ 五闸架构设计以编译期为核 · 运行期规约违反类问题需靠 CI 脚本族规约级硬兜 + Human 实战验证反哺。

### CI 对账族第 3 次扩展

```
COSTRA-115/116 → whitelist-check.mjs（域名方向三源对账）
COSTRA-119    → appjson-pages-check.mjs Rule-1/2/3（文件存在性）
COSTRA-120    → appjson-pages-check.mjs Rule-4（tabBar 微信规约）
COSTRA-121    → miniapp-tooling-check.mjs Rule-5a/5b/5c（工具链 SSOT · 本卡新脚本）
```

**范式递进**：表象检查 → 规约检查 → **SSOT 层检查**。

### Orchestrator 事实源核查链二次逆转的教训

三次核查的认知演进（详见 D8 · 119 Review §13.6 v1.2-A 表格）：
1. 第 1 次：误判为"源码 require 需改造"（未读源码 · 仅凭截图错误文本）
2. 第 2 次：误判为"双 config 漂移 · 子覆盖根"（仅看 ls + cat · 未核查 git 追踪态）
3. 第 3 次：定稿"根 config 工作区缺失 + 子 config GUI 噪声"（加入 `git ls-files` / `git log` / `git show HEAD:`）

**对 D-017 的直接输入**：事实源工具链必须包含 git 追踪态核查（ls-files / log / show HEAD:）· 纯文件系统核查（ls / cat / list_dir）对 git-aware 项目不够。议入 Sprint-1 末 D-017 v1→v2 升级。

### Orchestrator "工具噪声暂留"判断纠偏

- COSTRA-119 收官时暂留判断 · 120 继承 · 121 纠偏
- 归因：当时未走 git 追踪态 · 把 "untracked" 当成 "工具噪声" 处理 · 但 untracked 其实有两种性质（配置级噪声 vs 规约级漂移）
- 补救：本卡 Rule-5c CI 硬拦截 + `.gitignore` 兜底 + README 操作指引 · 三层防护永久消除

---

## 7. 本卡独有维度 · D-011 SSOT 规约工具链层首次实战

D-011（单一事实源规约）先前实战均为文档/配置层（API 契约 / URL / 设计 tokens 等）· 本卡是**工具链层首次实战**：

| 层 | D1~D6 防线 | 防护位 |
|---|---|---|
| 物理层 | D1 恢复根 config + D2 删子 config | 工作区当前状态 |
| 追踪层 | D3 `.gitignore` 精确路径兜底 | git add 阶段 |
| 机制层 | D4 三子规约 CI 脚本 + D5 package.json 脚本 | pre-commit / CI pipeline |
| 认知层 | D6 README "打开项目根" 指引 | Human 操作姿势 |
| 治理层 | D7 FU 同轮闭环 + D8 §13.6 v1.2 元自省 | 规约沉淀 + 审查反哺 |

**五位一体兜底范式**：物理 + 追踪 + 机制 + 认知 + 治理 · 任何一层失效另外四层接力 · 永久消除该类漂移。为未来"工具链层 SSOT 规约实战"建立模板。

---

## 8. 同 tool call 循环 R1 → Tech Review 交接（D-016 第 10 次实战）

- **派单时间**：2026-04-28 16:55
- **R1 完工**：2026-04-28 17:10（~15 分钟 · 含 8 处改动 + 九闸证据 + response 本文）
- **同 tool call 循环触发 Tech Review**：`.team/reviews/COSTRA-121/round-1-tech.md`（下一步）
- **D-016 合规**：Human 15:58 发现问题 → Orchestrator 事实源核查三轮（16:00~16:50）→ 方向 A 裁决（16:03）→ 打开姿势确认（16:52）→ 派单（16:55）→ R1 完工（17:10）→ Review APPROVE（预期 17:15）· 全程同 tool call 循环 · 连续第 10 次零跨轮异步反模式

---

**MiniApp-Agent R1 完工 · 同 tool call 循环交接 Review-Agent-Tech。**
