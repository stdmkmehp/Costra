# Card Review · Tech · COSTRA-165 · Round 2

- 卡 Owner：miniapp-dev
- 卡类型：feature（miniapp family-context service · active_family_id / active_ledger_id 全链路接入）
- 卡 points：2
- 审核时间：2026-05-27T18:15:00+08:00
- 上轮结论：Round 1 25/30 PASS-WITH-FOLLOWUP · 0 P0 / 3 P1 / 3 P2
- 审查者装扮：costra-card-reviewer-tech（D-022 v2.0 + D-025 §2 反模式扫描 + D-014-a 形式审）

> **注**：本报告由 Orchestrator 在 spawn `costra-card-reviewer-tech` 后接收 final message · 物理落盘（SBAI v1.1 · D-014）

## 总评

- **Verdict**：`PASS`
- **总分**：**28/30 分**（≥27 PASS · 较 R1 提升 3 分）
- **阻塞点**：0 个 P0 / 0 个 P1 / 2 个 P2

---

## 维度得分

| 维度 | 得分 | 一句话 |
|---|---|---|
| C1 标题与描述 | 5/5 | 与 R1 无变化 · 标题精炼三要素齐备 · v1.1 修订历史详实 |
| C2 DoD 可度量 | 6/6 | R1 扣分点（反向验证 ③ 模糊 + 旧 token 升级缺条目）全部修复 · T7~T11 + 反向验证 ④ 补齐 · 22 项 DoD 全部可自动化或可人工验收判定 |
| C3 依赖识别 | 5/5 | R1 扣分点（COSTRA-164 R1.x P2-2 遗留风险）已显式登记为 FU-164-REFRESH-DEFAULT-IDS-NULL · §2.1 B refreshToken 空字符串保护 + T10 测试覆盖 · 依赖闭环 |
| C4 产出物具体 | 5/5 | R1 扣分点（`expires_in?:` 可选 + user 子对象不完整 + 行号偏移）全部修复 · TokenRaw `expires_in: number` required + timezone/created_at/updated_at 补齐 · 行号已与 `8c8cdce` 后源码对齐（L158-184 / L72-82 / L195-214）|
| C5 风险与边界 | 4/4 | R1 扣分点（toast 重登策略 = P1 概率不当接受）已彻底修复 · §7 风险条目重写为 refresh 触发刷新路径 · v1.0 废弃策略显式标记 · 极边缘兜底（refresh 失败 → clearToken + clearActiveFamily · 不弹 toast 强制）|
| C6 去重 | 3/3 | 与 R1 无变化 · backlog.json 无 164/165 条目 · board.md 无覆盖 · 近期 daily 无相似描述 |
| C7 估点 | 2/2 | 与 R1 无变化 · 2 点合理 · 时间盒 R1 实装 100→120 min 修订合理 |
| C8 红线 | Pass | Won't-Have 未触碰 · 无 secret 硬编码 · 无主体字样（D-008）· miniapp-dev 写 miniprogram/ 合规 · ADR-0007 §5.5 sync/pull 铁律（§2.2 显式标禁）· 不动 server/ |

| **总分** | **28/30** | **PASS** |

---

## R1 P1 + P2 修订状态逐项验证

### P1-1 initAuth 旧 token 升级策略：✅ 兑现

- **证据 1**：dispatch v1.1 §2.1 B 第 4 点 initAuth 代码完全重写——`if (!familyId) { await refreshToken() }` 替代原"toast 重登"· 含 try-catch 兜底（refresh 失败 → clearToken + clearActiveFamily）
- **证据 2**：dispatch v1.1 §2.1 B 第 5 点 refreshToken 路径补写 family-context + 空字符串保护 `if (resp.default_family_id && resp.default_ledger_id)`
- **证据 3**：dispatch v1.1 §7 风险条目完整重写 · v1.0 ❌ 已废弃策略显式标记删除线 · v1.1 修正缓解策略完整
- **物理验证**：`grep -n "toast" dispatch` 返回 7 行 · 全部为"非 toast 重登"语义（v1.0 废弃标注 / v1.1 对比说明 / 实测覆盖描述）· 无"缓解策略：toast"残留

### P1-2 D-025 AP-002 扫描结论修正：✅ 兑现

- **证据 1**：dispatch v1.1 §3 D-025 AP-002 条目改为"修正后不命中"· 含完整 v1.0 命中诊断 + v1.1 修正路径
- **证据 2**：原文精确陈述——"v1.0 命中诊断：dispatch v1.0 §7 风险条目把'已登录用户升级后 storage 无 family-context'的处理写成'toast 提示重新登录'——是 P1 概率事件的不当接受"
- **物理验证**：`grep -n "AP-002" dispatch` 返回 4 行 · 全部为 v1.1 修正后结论 · 无 v1.0 "不命中"残留

### P1-3 TokenRaw 协议对齐：✅ 兑现

- **证据 1**：dispatch v1.1 §2.1 B TokenRaw `expires_in: number`（required · 无 `?`）· user 子对象含 `timezone: string; created_at: string; updated_at: string`
- **证据 2**：§1.3 行号修正——引用 `auth.ts L158-184（doWxLogin）`·`auth.ts L195-214（refreshToken）`· 与 commit `8c8cdce` 后源码物理对齐
- **物理验证**：`grep -n "expires_in?" dispatch` 返回 0 行（v1.0 `expires_in?: number` 残留已清）· `grep -n "L173-185" dispatch` 返回 0 行（v1.0 行号残留已清）
- **typecheck 影响评估**：v1.1 新增字段（expires_in / timezone / created_at / updated_at / default_family_id / default_ledger_id）将使现有 `mockExchange()`（auth.ts L231-248）typecheck FAIL · 这是**预期行为**（R1 实装时需同步补齐 mock 字段）· dispatch §2.1 E T11 已明确覆盖此测试 · 不构成 R2 审核阻塞

### P2-1 双源一致性测试：✅ 兑现

- **证据**：dispatch v1.1 §2.1 E T7"双源一致性：doWxLogin 后 storage family-context + globalData.activeLedgerId 必同步写入"
- **附加**：T8/T9/T10/T11 共 5 测新增 · 测试覆盖矩阵明确"v1.1 共 ≥ 11 测"

### P2-2 entry FALLBACK 处置 + 决策权：✅ 兑现

- **证据 1**：dispatch v1.1 §2.1 D 显式选方案 1（保留 FALLBACK + 诊断日志）· 理由 3 条完整
- **证据 2**："实装决策权：miniapp-dev（本卡 owner · v1.0 误写 backend-dev 已修正）"
- **物理验证**：`grep -n "backend-dev" dispatch` 仅 1 行 · 为决策权修正声明 · 无 v1.0 残留

### P2-3 commit 粒度合理性：✅ 兑现

- **证据**：dispatch v1.1 §5.4"commit 粒度合理性（v1.1 P2-3）：8 文件单 commit · 5 项 scope 各 1~2 文件 · 单点修改密度可控 · 与 COSTRA-164 R1 6 文件 + R1.x 4 文件范式对齐 · 不触发'提交粒度过大'"

---

## 新引入风险扫描

### 1. initAuth fallback refresh 在 mockLogin 模式下能否兜底

- **物理验证**：auth.ts L198-204 mockLogin 分支仅做 `mockExchange('refresh', ...)` + `setItem` + `return` · **不写 family-context**
- **分析**：mockLogin 模式下 initAuth fallback 走 refreshToken → mock 分支直接 return（不调 setActiveFamily）→ family-context 仍为空 · 但 mockLogin 是 dev/单测模式 · 不影响真机 · **不构成 P1**· 但建议实装期 mockExchange 同步补 default_family_id/default_ledger_id + refreshToken mock 路径补 setActiveFamily（使 T8 单测在 mock 环境可跑）→ 见 P2-2

### 2. 空字符串保护逻辑覆盖 logout 后再 refresh

- **分析**：dispatch v1.1 §2.1 B 第 5 点 `if (resp.default_family_id && resp.default_ledger_id)` — 空字符串 `""` 在 JS 中为 falsy · 保护逻辑正确 · logout 后 `clearActiveFamily()` 已清除 storage · 若此时有残留 refreshToken 被调（极边缘），空字符串保护确保不写入 · T10 覆盖此场景 · **无风险**

### 3. T8/T9/T10/T11 测试覆盖 P1-1 修订路径

- T8：initAuth 旧 token 升级 → refreshToken → 写入 family-context ✅
- T9：initAuth 升级 + refresh 失败 → clearToken + clearActiveFamily ✅
- T10：refreshToken 空字符串保护 ✅
- T11：TokenRaw 契约对齐 typecheck ✅
- **评估**：4 项测试精确覆盖 P1-1 修订引入的 3 条新路径（正常 refresh 写入 / refresh 失败兜底 / 空字符串保护）+ 1 项协议对齐验证 · 覆盖充分

### 4. TokenRaw 加字段对 mockExchange typecheck 影响

- **物理验证**：auth.ts L231-248 mockExchange 当前返回 `TokenRaw`（L18-29 旧签名）· 不含 expires_in / timezone / created_at / updated_at / default_family_id / default_ledger_id
- **分析**：R1 实装时 TokenRaw 接口扩展后 mockExchange **必须同步补字段**（否则 typecheck FAIL）· dispatch §2.1 E T11 已明确此测试 · **这是预期实装工作 · 不是卡定义缺陷**
- **注**：§2.1 B 第 5 点 refreshToken 代码 `if (env.mockLogin) { // ... mock 路径（保持 v1.0 不变）... }` 写了"保持 v1.0 不变"· 但实际实装时 mockExchange 签名必须随 TokenRaw 变 · 此处措辞轻微误导 · 记 P2-1

---

## 红线 / 反模式重扫

### D-025 AP-001/002/003 三项重扫

| AP | 命中 | 证据 / 否决理由 |
|---|---|---|
| AP-001（字符串代理判定） | 不命中 | family.ts FamilyContext 接口显式类型 · 无字符串硬比较推断语义 · 与 R1 无变化 |
| AP-002（概率极低就接受） | **不命中** | v1.1 修正后不再命中 · §3 AP-002 条目含完整 v1.0 命中诊断 + v1.1 修正路径 · **与 R1 对比：R1 命中 1 条 → R2 命中 0 条 · 闭合** |
| AP-003（契约-实装漂移） | 不命中 | 本卡不引入新 deferred · TokenRaw 加字段是对齐 server 已有字段（不是漂移）· 不动 openapi.yaml（164 范围）· 与 R1 无变化 |

### 工作区铁律验证

- **commit `dd7f39b` 物理验证**：`git show dd7f39b --stat` → 仅触 2 文件：
  1. `.team/dispatch/COSTRA-165-miniapp-family-context-service.md`（+217 -65）
  2. `.team/reviews/COSTRA-165/card-review-round-1-tech.md`（新文件）
- ✅ 全在 `.team/` 工作区 · 不触业务文件 · D-018 单装扮档单 commit 合规

---

## P0 阻塞点

（无）

---

## P1 应改

（无 · R1 三项 P1 全部兑现）

---

## P2 建议

### P2-1 refreshToken mock 分支措辞"保持 v1.0 不变"轻微误导

- **证据**：dispatch v1.1 §2.1 B 第 5 点 `if (env.mockLogin) { // ... mock 路径（保持 v1.0 不变）... }`
- **问题**：实装时 TokenRaw 接口扩展后 mockExchange 必须同步补字段（否则 typecheck FAIL）· "保持 v1.0 不变"措辞暗示 mock 路径不改 · 与 T11 测试（mock buildStored 含新字段）语义矛盾
- **依据**：SOP-CARD-REVIEW §3 C4（产出物具体）
- **修复建议**：改为 `// ... mock 路径（mockExchange 同步补 default_family_id/default_ledger_id + user 新字段 · T11 覆盖）...`
- **严重度**：P2 · 不阻塞实装 · 仅措辞清晰度

### P2-2 initAuth fallback refresh 在 mockLogin 下不写 family-context 需实装期显式处理

- **证据**：auth.ts L198-204 refreshToken mockLogin 分支不调 setActiveFamily · dispatch v1.1 §2.1 B 第 5 点 mock 路径代码未提及 family-context 写入
- **问题**：T8 测试（initAuth 旧 token 升级 → refreshToken → 写入 family-context）在 mockLogin 环境下需要 refreshToken mock 路径也写 family-context · 否则 T8 需绕过 mock 走真实路径测试
- **依据**：SOP-CARD-REVIEW §3 C5（风险与边界）
- **修复建议**：实装时 refreshToken mockLogin 分支补 setActiveFamily 调用（mock default_family_id/default_ledger_id）· 或 T8 显式标注"仅真实链路测试（env.mockLogin=false）"
- **严重度**：P2 · 实装期可处理 · 不阻塞卡定义

---

## D-025 反模式扫描结论

| AP | 命中 | 证据 / 否决理由 |
|---|---|---|
| AP-001（字符串代理判定） | 不命中 | 与 R1 无变化 |
| AP-002（概率极低就接受） | **不命中**（R1 命中 · R2 闭合） | v1.1 修正后不再命中 |
| AP-003（契约-实装漂移） | 不命中 | 与 R1 无变化 |

**结论**：命中 0 条（R1 命中 1 条 AP-002 · 修订后闭合）· 无新引入反模式

---

## 给卡作者的回执指令

COSTRA-165 Card-Review R2 **PASS 28/30** · 可进入 R1 实装阶段。

2 项 P2 为实装期建议（不阻塞卡定义 · 可在 R1 实装时顺带处理）：
1. refreshToken mock 分支注释措辞修正（"保持 v1.0 不变" → 显式说明需同步补字段）
2. initAuth fallback refresh mockLogin 路径 family-context 写入处理

---

## 自我反思

- 审核耗时：约 25 分钟（R1 报告 6 项修订逐项物理验证 + auth.ts 源码行号交叉验证 + commit stat 验证 + v1.0 残留搜索 + AP 重扫 + mockExchange typecheck 影响评估）
- 置信度：高
  - 6 项修订全部物理验证（grep 搜索 + 源码行号交叉 + commit stat）✓
  - v1.0 残留搜索（`expires_in?` / `L173-185` / `backend-dev` 决策权）0 命中 ✓
  - commit `dd7f39b` 工作区铁律验证 ✓
  - mockExchange typecheck 影响预判 ✓
  - 空字符串保护逻辑 JS falsy 验证 ✓
- 无需转 Human 二裁
