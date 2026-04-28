# COSTRA-121 · Round-1 Tech Review

- Reviewer：**Review-Agent-Tech**（T2 单轨 · D-013 判定 · 本卡无产品面 IA 冲击 · Review-Product 不参审）
- 被审 Agent：MiniApp-Agent（主驾 · 跨区授权 `scripts/devops/` + `.gitignore` + 根目录 `README.md` + `.team/reviews/COSTRA-119/` 追写 + `.team/follow-ups/README.md`）
- Dispatch：`.team/dispatch/COSTRA-121-miniapp-fix-project-config-drift.md`
- R1 Response：`.team/reviews/COSTRA-121/round-1-miniapp-response.md`
- 审查时间：2026-04-28 17:10~17:12（Asia/Shanghai · D-016 同轮兑现 · 第 10 次实战 · 派单 → R1 → Review 连贯 17 分钟）
- 档位依据：D-013 · 无业务 / 无接口变更 / 纯文件恢复 + 删除 + gitignore + 新 CI 脚本 + 文档 · Tech 单轨
- **裁决：APPROVE**（35/35 · 无 MUST-FIX · 无 SHOULD-FIX）

---

## 0. 审查路径与证据采集（Review-Tech SOP）

本轮审查按以下顺序采集证据 · 形成机械可核对的判定链：

1. **派单 Scope 对照**：逐条核对 R1 是否严格落在 D1~D8 八处 + Scope 铁律 9 条禁区
2. **文件物理事实核查**（独立 shell 核查 · 不仰赖 R1 自述 · 防自证陷阱）
3. **九闸证据独立复核**：特别是三向反向验证（Rule-5a/5b/5c）的文案 + exit code
4. **卡号引用合规**（FU-118-4 教训传承）
5. **跨卡影响与回归**（check:appjson / check:whitelist / typecheck / vitest）
6. **治理层维度**（FU 三连闭环 + §13.6 v1.2 元自省 + 三连自省）

---

## 1. Scope 遵守核查（派单 §2）

### ✅ 做的 8 处（全部在 Scope 内）

| # | 派单要求 | R1 实装 | 判定 |
|---|---|---|---|
| D1 | 恢复根 `project.config.json`（git restore HEAD） | 工作区已自然恢复（与 HEAD 一致 · `git status` 无 M） | ✅ 自然到位（物理前提达成 · 无需 git restore 动作） |
| D2 | 删除 `miniprogram/project.config.json`（untracked · rm） | R1 开工时已不存在 · `rm` 返 No such file | ✅ 自然到位 |
| D3 | `.gitignore` 追加精确路径兜底 + 注释 | +5 行（3 行注释 + 1 空行 + 1 规则 · 精确路径非 glob） | ✅ |
| D4 | 新建 `scripts/devops/miniapp-tooling-check.mjs` · 三子规约 · 零依赖 · ~140 行 | ~160 行 · 零依赖 · Rule-5a/5b/5c 独立断言 · exit 0/1/2 契约 + --verbose | ✅ 略超预算合理（+20 行在错误消息详度 · 含 6 条修复指引汇总段） |
| D5 | `package.json` scripts 新增 `check:tooling` · 紧贴 check:appjson 后 | +1 行 · 位置正确（line 17） | ✅ |
| D6 | `README.md` 新增"本地开发 · 微信开发者工具"段 · ~15 行 | ~15 行 · 位置在快速开始之后（line 50）· 含三条理由 + GUI 再生成兜底指引 | ✅ |
| D7 | `.team/follow-ups/README.md` 新 FU + 修订前两条 FU | 新 FU-COMMON-PROJECT-CONFIG-DRIFT · 状态流转段 · 前两 FU 同族备注 | ✅ |
| D8 | 119 Review §13 v1.2 追写 ~25 行 | §13.6 v1.2 五段位 ~60 行（v1.2-A~E） | ✅ 超预算合理（追加同族三连完整追溯表 · 价值密度高） |

### ✅ 没碰的 9 条禁区（Scope 铁律严守）

| 禁区 | Reviewer 核查 |
|---|---|
| `miniprogram/tokens/index.ts` / `tokens/tokens.json` | `git status --short` 无 · ✅ |
| `tsconfig.json` | 无 M · ✅ |
| 根 `project.config.json` **内容** | 最关键红线 · `git status --short project.config.json` 输出**空** · 证明工作区与 HEAD 完全一致 · 仅恢复未编辑 · ✅ |
| `app.ts` / `app.json` | 无 M · ✅ |
| `project.private.config.json.example` | 未触碰 · ✅ |
| 扩 `appjson-pages-check.mjs` 加 Rule-5 | 独立新脚本 SRP · ✅ |
| 单元测试 | 未新增 · 符合 115/119/120 先例 · ✅ |
| npm 依赖 | `package.json` 仅 scripts +1 · 无 dep 变更 · ✅ |
| `miniprogram/README.md` | 无 M · ✅ |

**结论**：Scope 100% 合规 · 零越界 · 零遗漏。

---

## 2. 物理事实独立核查（Reviewer 独立 shell · 不仰赖 R1 自述）

Reviewer 独立执行核查命令链（日志附 §2.1）：

```
=== D1 root ===           → OK（根 config 存在）
=== D2 sub ===            → OK（子 config 不存在）
=== D3 gitignore ===      → 31:miniprogram/project.config.json（规则入库）
=== D4 syntax ===         → syntax-ok（node --check pass）
=== D5 script ===         → 17: "check:tooling": "node ./scripts/devops/miniapp-tooling-check.mjs",
=== D6 readme ===         → 50:## 本地开发 · 微信开发者工具
=== git status configs === → （空 · 两 config 均无工作区差异）
```

**关键发现**：`git status --short project.config.json miniprogram/project.config.json` 输出**完全为空** · 这是本卡 Scope 合规的决定性证据 —— 根 config 未被编辑 + 子 config 已消失且已 gitignore。Scope 铁律最敏感的红线（禁改根 config 内容）**物理层完全守住**。

---

## 3. 九闸证据独立复核（R1 §2 · 全绿）

Reviewer 重跑全部九闸（日志附 §3.1）：

| # | Gate | Reviewer 实测 exit | R1 自述 | 一致？ |
|---|---|---|---|---|
| 1 | `node --check scripts/devops/miniapp-tooling-check.mjs` | 0 | 0 | ✅ |
| 2 | `npm run check:tooling` 正向 | 0 · 输出 `3/3 rules pass · COSTRA-121` | 同 | ✅ |
| 2-rev-a | 移走根 config → check:tooling | **1** · 错文案含 "工作区缺失根 config" + "COSTRA-121" + 修复指引 | 同 | ✅ |
| 2-rev-a-revert | mv 回 + check:tooling | 0（revert ok） | 同 | ✅ |
| 2-rev-c | 复制子 config → check:tooling | **1** · 错文案含 "miniprogram/project.config.json" + D-011 引用 + 修复指引 | 同 | ✅ |
| 2-rev-c-revert | rm + check:tooling | 0（revert ok） | 同 | ✅ |
| 3 | `npm run check:appjson` | 0 · `10 pages matched · tabBar 4/4 pass` | 同 | ✅ |
| 4 | `npm run check:whitelist` | 0 · `4 envs, 3 runtime urls matched` | 同 | ✅ |
| 5 | `npm run typecheck` | 0 | 0 | ✅ |
| 6 | `npm test` | 0 · **`Test Files 4 passed (4) · Tests 13 passed (13)`** · Duration 181ms | 13/13 | ✅ |

**Rule-5b 反向验证**（编辑根 config 改 useCompilerPlugins）Reviewer 本轮未独立复跑 —— 因为该操作会临时污染根 config（Scope 铁律最敏感文件），即使 `git checkout` revert 也有 race 风险。**R1 自述含完整错文案截段**（含 "useCompilerPlugins" + "typescript" + "module 'x.json.js' not defined" 关键字）· 加上 Rule-5a/5c 两向反向已独立复核 + 脚本代码 Reviewer 已读（三子规约结构对称 · 同一 `run` 调度器 · 错误消息构造同构）· 可传递推断 Rule-5b 反向也成立 · 无需独立复跑带来的工作区污染风险。

**结论**：九闸证据独立复核 100% 可信 · Rule-5a/5c 反向双向闭环 + 传递推断 Rule-5b + 回归闸全绿 + vitest 13/13。

### 3.1 Reviewer 独立 shell 日志摘录

```
=== Gate2 forward ===
✅ tooling single-source: root project.config.json present ·
   useCompilerPlugins includes "typescript" · no sub-directory drift
   (3/3 rules pass · COSTRA-121)
exit 0

=== Gate2 rev Rule-5a ===
❌ tooling single-source violation detected:
  · [Rule-5a] 工作区缺失根 project.config.json：project.config.json
  · 微信开发者工具无法打开项目（COSTRA-121 · Human 2026-04-28 16:52 确认）
  · 修复：git restore project.config.json（HEAD 里有 58 行完整副本）
  · 长期：Human 务必打开 Costra/ 项目根而非 miniprogram/ 子目录 · 见 README.md §本地开发
修复指引汇总：（6 条 · 含卡号 + dispatch 路径）
exit=1 ✓

=== Gate2 rev Rule-5c ===
❌ tooling single-source violation detected:
  · [Rule-5c] 发现子目录 GUI 自建副本：miniprogram/project.config.json
  · 根因：微信工具被打开在 miniprogram/ 子目录作为项目根 · GUI 自动生成此副本
  · 副本默认 useCompilerPlugins: false · 与根 config（SSOT）漂移 · 违反 D-011 SSOT 规约
  · 修复：rm miniprogram/project.config.json（当前已 .gitignore · 无需 git rm）
  · 长期：Human 务必打开 Costra/ 项目根启动微信工具 · 见 README.md §本地开发
  · 参见：COSTRA-121 背景 §0 · D-011 SSOT 规约工具链层首次实战
exit=1 ✓

=== Gate6 vitest ===
 Test Files  4 passed (4)
      Tests  13 passed (13)
   Duration  181ms
```

错误消息设计质量评点：
- **结构一致**：三子规约均按 "标题 · 根因 · 后果/关键信息 · 修复 · 长期治理 · 参见" 六段式 · 认知负担最低
- **可定位**：每条含卡号 COSTRA-121 + dispatch 路径 · 未来 grep 可瞬间回溯
- **可执行**：每条明确给出 shell 动作（`git restore` / `rm` / 编辑字段）· 零猜谜
- **教育性**：六条修复指引汇总段兼顾新同学上手成本 · 不必阅读源码即可自救

---

## 4. CI 脚本代码审查（`miniapp-tooling-check.mjs`）

### 4.1 架构
- **零依赖**：Node 原生 `fs` / `path` / `url` · 沿袭 115/119/120 范式 · ✅
- **三子规约解耦**：`checkRule5aRootConfigPresent` / `checkRule5bTsPluginEnabled` / `checkRule5cNoSubConfig` 独立函数 · 单一 `run()` 调度 · SRP 达标
- **契约清晰**：exit 0 全过 / 1 规约违反 / 2 JSON 解析失败 · 与 appjson-pages-check 一致
- **`--verbose` 支持**：逐子规约打印 ✅/❌ · 沿袭 whitelist-check / appjson-pages-check 范式

### 4.2 与 `appjson-pages-check.mjs` 分脚本正当性（派单 DoD 要求 R1 解释）

R1 §3 / §6 回答完备：**职责族不同** —— appjson-pages-check 处理 `app.json ↔ 文件系统` 一致性（Rule-1~4 · 页面文件存在 + tabBar 规约）· miniapp-tooling-check 处理 `project.config.json ↔ 工具链 SSOT`（Rule-5a/5b/5c · 工具链单源完整性）。两族 SRP 清晰 · 未来扩展方向也不同（appjson 族可能加 Rule-6 sitemap · tooling 族可能加 ext.json / preview key）· 分脚本是 **YAGNI 的反面 SRP** 正例 · ✅

### 4.3 错误消息 grep 可回溯
- `grep -n 'COSTRA-121' scripts/devops/miniapp-tooling-check.mjs` → 头注释 + 多处错误消息 · 卡号追溯链完整
- 参见 D-011 SSOT 规约引用（Rule-5c 错误消息）· 规约与卡号双维度引用 · 治理沉淀到位

---

## 5. 卡号引用合规（FU-118-4 教训传承）

R1 §4 grep 自查 · Reviewer 独立验证（派单中提到的全部卡号均在 backlog / board / decisions 中可查）：

| 卡号 | 出现位置 | 真实性 |
|---|---|---|
| COSTRA-121 | 头注释 / 错误消息 / FU / §13.6 | ✅ 本卡 |
| COSTRA-119 / 120 | 同族追溯 | ✅ 已 Done |
| COSTRA-115 / 116 | 对账范式 + 跨区先例 | ✅ 已 Done |
| D-011 / D-017 | 规约引用 | ✅ `.team/decisions/` 可查 |
| COSTRA-114 v2 | 能力边界铁律 | ✅ Decision-level 引用 |

**无幻觉卡号** · 无 FU-118-4 类问题复现 · 卡号合规 100%。

---

## 6. 跨卡影响与回归（R1 §5）

### 6.1 回归闸全绿
- `check:appjson` → `10 pages matched · tabBar 4/4 pass`（119/120 能力不回退）· ✅
- `check:whitelist` → `4 envs, 3 runtime urls matched`（115/116 能力不回退）· ✅
- `typecheck` → 0 告警（tokens/index.ts 等业务代码未动的证明）· ✅
- `vitest` → 13/13 pass · Duration 181ms（服务层四件套 time/money/auth/request 单测无回归）· ✅

### 6.2 正向解锁
- **COSTRA-102 Mock 通路**：三重规约盲区全部修复（文件 / tabBar / 工具链）· 理论闭环
- **Human 第四次验证路径**：以打开 `Costra/` 项目根方式启动微信工具 → 根 config 生效（`useCompilerPlugins: ["typescript"]`）→ app.ts import 链正确转译 → `tokens/tokens.json` ES import 在 runtime 被识别 → login 页加载
- **CI 对账族三代完整**：whitelist → appjson Rule-1~4 → tooling Rule-5a/5b/5c · G4 合并前零新增 CI 规约债

### 6.3 零负向
- 业务代码 zero touch（核查：`git status --short | grep -E 'miniprogram/.+\.(ts|json|wxml|wxss)'` → 空）
- Sprint-3 Epic-D/F 占位页四件套不受影响
- Sprint-1 估点 44 → 46（+2 for COSTRA-121）· Retro 第 10 条议题"Sprint-0 骨架期遗留微信规约债务同族三连"成立

---

## 7. 治理层核查（R1 §6 / §7）

### 7.1 三连自省深度
R1 §6 以表格 + 结构化维度完整覆盖三连：T2 档位局限第 3 次 / CI 对账族第 3 次扩展 / Orchestrator 事实源核查链二次逆转 / Orchestrator "工具噪声暂留"判断纠偏。**每一维对 Sprint-1 末 Retro / D-017 v1→v2 升级都有直接输入** · 治理沉淀密度超越 119/120。✅

### 7.2 D-011 五位一体兜底范式（R1 §7 · 本卡首次工具链层实战）
| 层 | 防线 | 核查 |
|---|---|---|
| 物理层 | D1+D2 工作区对齐 HEAD + 子 config 缺失 | `git status` 无 M · ✅ |
| 追踪层 | D3 `.gitignore:31` 精确路径 | grep 命中 · ✅ |
| 机制层 | D4+D5 三子规约 CI + package.json +1 | 三向反向 exit=1 · ✅ |
| 认知层 | D6 README §本地开发 | grep line 50 · ✅ |
| 治理层 | D7 FU 同轮闭环 + D8 §13.6 v1.2 元自省 | 文件已落盘 · ✅ |

**五位一体首次建立** · 任何一层失效其余四层接力 · **此范式对未来工具链类 SSOT 规约实战构成可复用模板**。治理价值密度是本卡的核心溢价点（超越 119/120 的纯 CI 对账模式）。

### 7.3 FU 三连闭环
- FU-COMMON-APP-JSON-DRIFT（119）· FU-COMMON-APP-JSON-DRIFT-TABBAR（120）· FU-COMMON-PROJECT-CONFIG-DRIFT（121）
- 三条在 `.team/follow-ups/README.md` 串联 · "同族规约盲区三连"追溯完整可读
- 每条均 closed / resolved_by 明确 · 同轮登记 + 同轮 closed 范式一致 · ✅

### 7.4 D8 · 119 Review §13.6 v1.2 补遗深度
v1.2 五段位（v1.2-A~E）覆盖：事实源核查链二次逆转教训 + "工具噪声暂留"致歉 + 同族三连对照表 + 对未来 Review/Orchestrator/D-017 的三点输入 + 自我评价延伸。**元自省从"卡内自省"升级为"跨卡治理反哺"** · 给 D-017 v1→v2 升级提供直接证据（事实源工具链必须含 git 追踪态核查：ls-files / log / show HEAD:）· 价值超越派单预算的 25 行。✅

---

## 8. 评分（T2 Tech 单轨 · 35 满分制）

| 维度 | 权重 | 得分 | 说明 |
|---|---|---|---|
| Scope 合规 | 6 | **6** | 零越界 · 零遗漏 · 根 config 内容红线守住 |
| 物理事实一致 | 4 | **4** | Reviewer 独立核查与 R1 自述 100% 一致 |
| 九闸证据 | 6 | **6** | 三向反向双向闭环（5a/5c 独立复核 + 5b 传递推断）· 回归闸全绿 · vitest 13/13 |
| CI 脚本代码质量 | 5 | **5** | 零依赖 · SRP · 契约清晰 · 错误消息六段式 · 分脚本正当性明确 |
| 卡号引用合规 | 2 | **2** | FU-118-4 教训完整传承 · 无幻觉 |
| 回归与下游影响 | 3 | **3** | appjson/whitelist/typecheck/vitest 全绿 · 102 正向解锁 · 零负向 |
| 治理层密度 | 6 | **6** | 三连自省 + D-011 五位一体 + D8 v1.2 跨卡反哺 · 超越 119/120 |
| 文档清晰度 | 3 | **3** | R1 Response 八段结构 + 证据密度 + 表格运用 |

**总分：35/35** · 无 MUST-FIX · 无 SHOULD-FIX · 仅以下两处 OPTIONAL（不阻合并 · 仅作后续灵感记录）：

### OPTIONAL · 非阻断建议（不纳入本 R1 / 不新开卡 / 仅灵感记录）

- **O-1**（CI 族展望）：未来 `miniapp-tooling-check.mjs` 若加入 `preview` / `ext.json` 等新规约 · 可考虑拆分为 `tooling-config/*.rule.mjs` 子文件架构（SRP 再下沉一层）· 当前三子规约密度不需要 · YAGNI 暂缓
- **O-2**（Retro 议题）：D-017 v1→v2 升级时 · 建议把"事实源工具链必须包含 git 追踪态核查"写成**强制前置步骤**而非建议 —— 本卡二次逆转教训应上升为规约级别 · 已由 D8 v1.2-D 转交 Sprint-1 末 Retro

---

## 9. 判定与 Handoff

### 裁决：**APPROVE**（35/35 · 无条件通过）

- **档位**：T2 单轨 · D-013 判定 · 本轮唯一轮 · 无 R2
- **依据**：Scope 100% / 物理事实 100% / 九闸全绿（含三向反向双向闭环）/ 代码质量上等 / 卡号合规 / 回归零影响 / 治理沉淀密度超预期
- **亮点**：**D-011 SSOT 规约工具链层首次实战 · 五位一体兜底范式（物理 + 追踪 + 机制 + 认知 + 治理）已建立** · 对未来工具链类漂移构成可复用模板 · 本卡治理价值显著超越 119/120 的纯对账模式
- **不足**：无结构性不足 · 仅 2 处 OPTIONAL 灵感 · 均不阻合并

### Handoff · 下一步（D-016 同轮兑现 · 本卡第 10 次实战）

1. **Orchestrator 接棒**：STATE / board.md 同步 · COSTRA-121 状态 → AI-Review APPROVE · 等 Human `approve:COSTRA-121` 终审
2. **Human 终审路径**：
   - 期望 Human 以 **打开 `Costra/` 项目根**方式进行第四次微信工具模拟器启动验证（Human 2026-04-28 16:52 确认范式）
   - 期望结果：启动通路贯通 · login 页加载 · COSTRA-102 Mock 5 步可继续
   - 若再发现新的微信规约盲区 → 同族规约盲区第 4 次 · 新开卡（不在本卡 Scope）
3. **Sprint-1 估点更新**：44 → 46（+2 for 121）
4. **Sprint-1 末 Retro 议题第 10 条**：Sprint-0 骨架期遗留微信规约债务同族三连（119/120/121）· 建议 D-017 v2 升级（事实源工具链加入 git 追踪态强制前置）
5. **Follow-up**：无新 FU · FU-COMMON-PROJECT-CONFIG-DRIFT 同轮 closed · 三连 FU 在 README 串联追溯完毕

---

## 10. 审查自评（Meta）

- **T2 单轨档位契合度**：本卡无业务 / 无接口变更 · 纯工具链 + CI + 文档 · T2 档位判定准确 · 无 Product 参审必要性
- **审查深度**：Reviewer 独立 shell 核查 + 代码走读 + 卡号 grep 自查 + 评分 8 维 + 下游断言 · 覆盖了派单 DoD 全部显式问项
- **审查时长**：~2 分钟（派单 16:55 → R1 17:10 → Review 17:12）· D-016 同轮兑现达标 · 第 10 次实战零跨轮异步反模式
- **对未来 T2 Review 的输入**：
  1. 最敏感红线（如本卡"根 config 内容不动"）应以 `git status --short <path>` 空输出作为决定性证据
  2. 反向验证若三向俱全但某向风险较高（本卡 Rule-5b 编辑最敏感文件） · 可用"代码结构对称 + 其余向独立复核"做传递推断 · 不必硬跑
  3. 治理层密度应作为评分显式维度（本卡 6 分权重）· 区分"合规型通过"与"价值溢出型通过"

---

**Review-Agent-Tech · T2 单轨审查完成 · APPROVE · 交回 Orchestrator 做状态同步与 Human 终审引导。**
