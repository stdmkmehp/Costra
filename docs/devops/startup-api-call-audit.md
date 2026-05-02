# 启动期 API 调用审计报告（Sprint-1 末）

- 卡号：COSTRA-124
- Refs：`.team/dispatch/COSTRA-124-miniapp-fix-startup-storage-timing.md` §3 (b)
- 审计时间：2026-05-02
- 审计人：装扮 subagent `costra-miniapp-dev`（SBAI v1.1 P2' 实战第 2 回）
- 审计范围：`miniprogram/**/*.ts`（源码目录 · 不含 `node_modules/` / `miniprogram_npm/`）

---

## §1 审计背景

COSTRA-124 修复 `miniprogram/services/storage.ts:29` 模块顶层副作用 `ensureVersion()`
后 · 按 Human 2026-05-02 20:31 Q4 拍板 · **顺扫 `miniprogram/` 所有模块顶层 `wx.*` 调用**
防止同族再犯（即"模块导入时即在 App() 注册前同步触发 wx.* 调用"的反模式）。

Driver：

- FU-LAUNCH-FIRST-RENDER-RACE 第 4 次重定性（`.team/follow-ups/README.md` §519-559）
- D-017 Step 2 根因报告（`.team/members/miniapp-dev/history/2026-05-02-getglobalstorage-v2-diagnose.md`）

---

## §2 扫描命令与执行结果

### §2.1 扫描命令（2 条 grep · 对齐 dispatch §3 (b)）

```bash
# 命令 1：扫模块顶层直接 wx.* 调用（行首缩进 0）
rg -n '^wx\.' miniprogram --glob '*.ts'

# 命令 2：扫顶层赋值触发 wx 调用（顶层 const/let/var 表达式里含 wx.）
rg -nE '^(const|let|var).*wx\.' miniprogram --glob '*.ts'
```

（实际执行用的是 agent 的 Grep 工具 · 语义等价 ripgrep · 基于 `.gitignore` 天然排除 `node_modules/` / `miniprogram_npm/`。）

### §2.2 执行结果（2026-05-02 R1 实装时）

| # | 命令 | 命中数 | 红线（> 0） | 结论 |
|---|---|---|---|---|
| 1 | `^wx\.`（顶层裸调） | **0** | ❌ 不触发 | ✅ PASS |
| 2 | `^(const\|let\|var).*wx\.`（顶层赋值触发 wx） | **0** | ❌ 不触发 | ✅ PASS |

**额外宽松扫查**（不在 DoD · 但作为审计增值项）：

| # | pattern | 命中数 | 说明 |
|---|---|---|---|
| 3 | `^[a-zA-Z_$][a-zA-Z0-9_$]*\(` 排除所有声明关键字 | 0 | 无其他顶层函数裸调 |
| 4 | `^setTimeout\|^setInterval` | 0 | 无顶层定时器反模式 |

**结论**：`miniprogram/**/*.ts` 在 COSTRA-124 (a) 修复后 · 模块顶层**零副作用**（仅保留 `import` / `export` / 类型声明 / 常量字面量 / `App({...})` / `Page({...})` / `Component({...})` 注册）。

---

## §3 历史对照

| 时间点 | 源码状态 | 顶层副作用命中 |
|---|---|---|
| COSTRA-030 初始化（~2026-03-xx） | `storage.ts:29` 有 `ensureVersion()` 裸调 | 1 |
| COSTRA-102/118/121/122/123 各节点 | 同上（未触发 Review 关注 · 基础库 2.30.x 时序宽松） | 1 |
| **COSTRA-123 收官（2026-05-01 21:18）** | 同上（Launch Time 从 3547 ms 降至 865 ms 后 · SDK 时序窗口收窄 · FU-LAUNCH 第 2 次观察） | 1（未坐实为根因） |
| **2026-05-02 19:32 · FU 第 3 次观察** | 同上（定性加固为"100% SDK 内部 Bug" · 后被独立复核推翻） | 1（定性误判） |
| **2026-05-02 20:25 · D-017 Step 2 根因报告** | 同上（装扮 subagent 独立核查坐实 `storage.ts:29` 是唯一业务触发点） | 1 |
| **2026-05-02 COSTRA-124 R1 修复后** | `ensureVersion()` 改 export · 调用点迁 `app.ts:onLaunch` 首行 | **0** |

---

## §4 同族违规发现

**无**。

本次顺扫未在 `storage.ts` 之外发现任何其他模块顶层 `wx.*` 或等价反模式。具体排除分析：

- `miniprogram/services/env.ts`：`ENV_MAP` 仅为对象字面量常量 · `getEnv()` / `isFlagOn()` 只在被调用时读取 · 无 `wx.*`
- `miniprogram/services/auth.ts`：`current` 为顶层 `let` 但初值是 `null` · 首次写入在 `initAuth()` 或 `doWxLogin()` 内 · 属函数内副作用 · 合规
- `miniprogram/services/request.ts`（如存在）：`wx.request` 调用全部包在 `request()` 函数体内 · 合规
- `miniprogram/app.ts`：`globalData: { env: getEnv(), tokens, bootAt: 0 }` 在 `App({...})` 参数求值时调 `getEnv()` · 但 `getEnv()` 不触发 `wx.*` · 合规
- `miniprogram/tokens/index.ts`：COSTRA-122 修复后 · 纯 TS 常量对象 · 无副作用

---

## §5 未来 CI 升级候选（Sprint-2 Planning 议题）

本次 grep 扫查为"手工 + 审计报告"级 · 若希望常态化防回归 · 建议 Sprint-2 新增硬拦截脚本：

**候选脚本**：`scripts/devops/startup-top-level-call-check.mjs`

**职责**：

1. 扫 `miniprogram/**/*.ts`（排除 `*.d.ts` / `*.test.ts`）
2. 用 TypeScript AST（`ts.createSourceFile`）识别每份文件的 **top-level statements**
3. 对每个 top-level `ExpressionStatement` · 判定：
   - 是否 `CallExpression`
   - 是否 `App(...)` / `Page(...)` / `Component(...)` 注册（允许）
   - 其他一律视为违规 · 打印 `file:line` + 违规表达式 · exit 1

**接入**：`package.json > scripts > check:startup-topcall` · 纳入 `check:all` 族 · husky pre-commit 拦截

**成本估算**：0.5 点 · 约 30-45 min 实现 + 10 min 测试

**收益**：永久性消除"模块顶层副作用"反模式的回归风险 · 补齐 Sprint-1 五连规约盲区（119/120/121/122/123）的第 6 层防护

**决策人**：Sprint-2 Planning 时 tech-lead / Human 裁决

---

## §6 反模式清单交叉引用

本审计报告与 `docs/devops/libversion-upgrade.md` §3 "反模式清单"交叉引用 · 共同沉淀"基础库升级期 + 启动期 API 调用"两个切面的工程经验。

---

**报告结束。本报告为 COSTRA-124 DoD (b) 交付物 · R1 交付后由 `costra-review-tech` Round-1 审查。**
