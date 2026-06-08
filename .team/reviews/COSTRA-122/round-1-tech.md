# COSTRA-122 · Round-1 · Tech Review

- 卡号：COSTRA-122
- 档位：T2 单轨 · Tech 35 分制（D-013）
- Reviewer：Tech-Agent
- 被评：MiniApp-Agent R1（`.team/reviews/COSTRA-122/round-1-miniapp-response.md`）
- 评审时间：2026-04-28 20:20
- 裁决：**APPROVE 35/35 · P0/P1/P2 = 0 · OPTIONAL = 1**

---

## §1 评审维度与分项

| # | 维度 | 分 | 评 | 证据 |
|---|---|---|---|---|
| 1 | 契约一致性（tokens.json vs 内联 1:1） | 5/5 | ✅ | `/tmp/diff-tokens.mjs` 递归排序 stringify 严格对比 · 返回 "✅ YES" |
| 2 | runtime 契约对齐（消除 .json loader 依赖） | 5/5 | ✅ | `grep -rn "from '.*\.json'" miniprogram/` 唯一命中是注释里的警告字符串 · 源码层零 JSON import |
| 3 | 代码质量（`as const` + 类型导出保持） | 5/5 | ✅ | `typeof tokens` 推导与原 `typeof tokensJson` 结构等价 · 5 个导出签名零变更 · 顶部 4 行硬约束注释明确禁令 + 真因 + 正确做法 |
| 4 | 五闸全绿 | 5/5 | ✅ | tsc / lint / vitest 13/13 / check:appjson / check:tooling / check:whitelist 全 exit 0 |
| 5 | 静态对账（grep + 字段 1:1） | 5/5 | ✅ | 双重脚本：grep 源码层无 import · diff-tokens.mjs 严格字节对比 |
| 6 | Scope 严守（1 文件 · 无泄漏） | 5/5 | ✅ | `git diff` 仅 `miniprogram/tokens/index.ts` +50/-2 · tokens.json / app.ts / CI / .gitignore 全零改动 |
| 7 | 治理反哺（121 假设证伪 · FU 衔接 · Retro 议题） | 5/5 | ✅ | R1 §5 完整复盘（121 物理修复全部必要 + 本卡补 runtime 层）· D-017 v2 升级强证据记入 · Sprint-1 末 Retro 3 条议题（含"Review 35/35 ≠ 假设正确"） |
| | **合计** | **35/35** | | |

---

## §2 发现（P0/P1/P2/OPTIONAL）

### P0：**0**

### P1：**0**

### P2：**0**

### OPTIONAL：**1**

- **O1** · 反向验证 Reverse-3（去 `as const`）当前非硬拦截（tsc 可过）· R1 §7 已自述为"预埋保险" · 建议 Sprint-2 FU-118-3 构建脚本落地时，可加 `assertTypeEquals` 或 tsd 测试做机制化保险。**非阻断** · 留作后续卡议题。

---

## §3 规约兜底对账（D-011 / D-013 / D-014-a / D-016 / D-017 相关）

| 规约 | 对账项 | 状态 |
|---|---|---|
| D-011 SSOT | tokens.json 仍为设计 SSOT · index.ts 为派生物 · 顶部注释硬约束 | ✅ |
| D-013 Review 档位 | T2 单轨基建小卡 · 35 分制 · 符合 | ✅ |
| D-014-a 卡定义 Review | dispatch §0~§9 完整（背景/目标/交付物/验证/反向/风险/档位/节奏/裁决）· 质量高 | ✅ |
| D-016 同轮兑现 | 19:57 派单 → 20:18 R1 完工（21 分钟 · 快于 30 分钟预算）· 第 11 次实战合规 | ✅ |
| D-017 v2 | Orchestrator 事实源三证齐全核查（git ls-files/log/show HEAD: 全做）· 首次完整前置（121 教训沉淀生效）· runtime 实测作为终审证据议题加固 | ✅ |
| D-012 单卡即提交 | 本卡 commit 策略已就位（R1 §8 commit message 草案） | 等 Human 终审后触发 |

---

## §4 反向验证 3 次的额外核查

- **Reverse-1（改回 JSON import）**：静态对账 grep 规约告警有效 · 可硬拦截 ✅
- **Reverse-2（丢字段）**：tsc 不拦截但本卡提供的 diff-tokens.mjs 脚本发现 DIFF · 手工闸门有效 · 记入 R1 §7 未来工作（Sprint-2 FU-118-3 构建脚本自然根治） ✅
- **Reverse-3（去 as const）**：当前非硬拦截 · 已记 OPTIONAL · 非阻断 ✅

### 三次反向的共同结论
本卡**不扩展 CI 规约**（scope 严守）· 反向验证退化为"静态对账 + 类型推导 + 手工脚本"三层 · 完全匹配 dispatch §4 说明 · 与 121 Rule-5a/5b/5c CI 机制化反向**档位不同但策略合理**。

---

## §5 121 假设证伪的治理价值确认

R1 §5 对 COSTRA-121 的复盘**十分精确**：

- 121 物理修复（D1~D4+D6）**全部必要且正确** —— 工具链 SSOT 本就应该这样修 · 满足微信官方双 config 规约 · 消除潜在双 config 漂移 · D-011 工具链层范式仍成立
- 但 121 核心**因果链假设**证伪 —— `useCompilerPlugins:["typescript"]` 只负责 `.ts → .js` 转译，**不改变 JSON 模块 runtime 解析语义**
- 真根因在 runtime CommonJS loader 契约层，与工具链配置无关 —— 必须源码层消除 JSON import（本卡 D1）
- **两卡累加才是完整修复** —— 121（工具链 SSOT）+ 122（runtime 契约对齐） · 分别处理不同层次

### Reviewer 建议

- 121 Review §13.7 v1.3 收官后复盘补遗由 Orchestrator 撰写（约 40 行五段位：事件回溯 / 假设证伪 / 物理修复价值保留 / D-017 v2 升级触发 / Sprint-1 末 Retro 议题加固）· 与本卡同轮落地

---

## §6 合并建议

### 裁决：**APPROVE 35/35**

**条件**：无（P0/P1/P2 = 0）

### 提交前动作清单（Human 终审环节）

1. Human 第五次模拟器启动验证 —— 以"打开 `Costra/` 项目根"姿势重开微信开发者工具 · 期望 app.ts:6 不再报 `module ... not defined` · 启动链推进到 `wx.reLaunch({ url: '/pages/login/index' })` · 登录页正常显示
2. 若通过 → D-012 commit（message 按 R1 §8 草案）
3. Orchestrator 同步更新：
   - FU-TOKENS-JSON-RUNTIME-IMPORT → `closed`（resolved_by COSTRA-122 R1）
   - FU-COMMON-PROJECT-CONFIG-DRIFT 收官后复盘备注（状态保持 `closed-but-insufficient` → 本卡收官后可回归 `closed` · 因为两卡累加后是完整修复）
   - COSTRA-121 Review §13.7 v1.3 收官后复盘补遗
   - STATE / board 同步
4. 若失败 → D-017 v2 实战 · Orchestrator 立即立 COSTRA-123 延伸（风险已 dispatch §5 预案）

---

## §7 Sprint-1 末 Retro 议题（本卡新增/加固）

1. **D-017 v2 升级必选项定稿** —— "runtime 实测必须作为 runtime 规约类 T2 卡的终审证据"议题从"推导中"升级为"必选项" · 121 假设证伪提供最强活教材
2. **Review 35/35 ≠ 假设正确** —— 本卡 Review 同样 35/35 · 真正终审是 Human 第五次模拟器实测 · 建议在 Review-Tech 档位说明里加一行"runtime 规约类卡必须标注 runtime 实测作为终审绝对证据"
3. **同族规约盲区第 4 次紧迫性** —— 119+120+121+122 连续四张紧急卡 · Sprint-0 骨架期微信规约债务系统化盘点升至 Sprint-1 末 Retro **最高议题** · 建议启动 Epic F 或独立专项
4. **COSTRA-011 / COSTRA-030 Review 档位倒查** —— 骨架期 Review 未对"代码 runtime 可加载性"做对账 · 是否为骨架期档位结构性局限 · 议题加固

---

_R1 Tech Review 完工 · APPROVE 35/35 · 等 Human 终审 + 第五次模拟器启动验证_
