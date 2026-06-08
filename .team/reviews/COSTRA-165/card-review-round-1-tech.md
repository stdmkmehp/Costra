# Card Review · Tech · COSTRA-165 · Round 1

- 卡 Owner：miniapp-dev
- 卡类型：feature（miniapp family-context service · active_family_id / active_ledger_id 全链路接入）
- 卡 points：2
- 审核时间：2026-05-27T17:30:00+08:00
- 上轮结论：首轮
- 审查者装扮：costra-card-reviewer-tech（D-022 v2.0 + D-025 §2 反模式扫描 + D-014-a 卡定义首轮 Review）

> **注**：本报告由 Orchestrator 在 spawn `costra-card-reviewer-tech` 后接收 final message · 物理落盘（SBAI v1.1 · D-014）

## 总评

- **Verdict**：`PASS-WITH-FOLLOWUP`
- **总分**：**25/30 分**（≥27 APPROVE · 22~26 PASS-WITH-FOLLOWUP · <22 REJECT · 差 2 分到 APPROVE）
- **阻塞点**：0 个 P0 / 3 个 P1 / 3 个 P2

---

## 维度得分

| 维度 | 得分 | 一句话 |
|---|---|---|
| C1 标题与描述 | 5/5 | 标题精炼 ≤ 60 字符含核心概念 · 描述三要素（背景/目标/范围）齐备 · 术语与 ADR-0007 / charter 完全一致 · "INVEST small"标注准确 |
| C2 DoD 可度量 | 4/6 | G1~G15 + T1~T6 + 反向验证 3 项共 16 条 · T1~T6 均可自动化判定 · 但反向验证 ③"临时不在 doWxLogin 后调 setActiveFamily → 集成测试（如有 e2e）应 FAIL · 无 e2e 时改测 mock auth.ts 调用 family service 的次数"——判定标准模糊且降级路径含"如有"条件 · 旧 token 升级场景无 DoD 条目 |
| C3 依赖识别 | 4/5 | 上游 COSTRA-164 强依赖清晰 + COSTRA-103/125/105 显式列出 · 下游解锁 FU-150 闭合 + Epic-D 部分兑现清晰 · 但缺少对 COSTRA-164 R1.x review P2-2 遗留风险的显式依赖登记（refresh 路径 default_family_id 空字符串） |
| C4 产出物具体 | 4/5 | family.ts 完整代码到可直接执行 · auth.ts 4 处修改点具列行号 · syncScheduler 替换路径清晰 · 但 §2.1 B TokenRaw 接口扩展写了 `expires_in?: number`（可选）与 server AuthTokenPair `expires_in: number`（required deprecated）不一致 · auth.ts L18-29 现有 TokenRaw 缺 `expires_in` 字段而 dispatch 写了 `expires_in?: number` |
| C5 风险与边界 | 2/4 | §7 列 5 项风险 · TokenRaw 加字段非破坏性兼容 + toast 重登策略存在严重设计缺陷：initAuth 路径下旧 stored token 无 default_family_id / default_ledger_id 时"提示重新登录 toast"会导致所有已登录用户被强制重登 · 应走 refresh 触发刷新路径 · FU 未显式登记此升级场景到 sprint backlog · 缺少对 storage / globalData 双源不一致的防御性测试 |
| C6 去重 | 3/3 | backlog.json 中无 COSTRA-164/165 条目 · board.md 无覆盖 · 近期 daily 无相似描述 · ADR-0007 §6.2 实装锚点与 165 scope 一一对应无重叠 |
| C7 估点 | 2/2 | 2 点 vs 164（3pt 同族 server 端）合理 · 5 项 scope 单点密度可控 · 落 1~8 区间 · INVEST small |
| C8 红线 | Pass | Won't-Have（charter §5）未触碰 · 无 secret 硬编码 · 无主体字样（D-008）· miniapp-dev 写 miniprogram/ 合规 · ADR-0007 §5.5 sync/pull 铁律（§2.2 显式标禁）· 不动 server/ |

| **总分** | **25/30** | **PASS-WITH-FOLLOWUP** |

---

## P0 阻塞点

（无）

---

## P1 应改

### P1-1 initAuth 路径旧 token 升级场景策略不合理：toast 重登应改为 refresh 触发刷新

- **证据**：
  - dispatch §7 第 3 条风险："TokenRaw 协议加字段非破坏性兼容：旧 stored token 没 default_family_id（升级前 cache 命中）→ 重启后 initAuth 走 restored session · 此时 storage 中 family-context 也可能不存在 · 必须走 fallback：initAuth 时如 getActiveFamilyId 返 null · 触发一次显式 refresh / re-login · 缓解策略：initAuth 内 if (!await getActiveFamilyId()) → 提示重新登录（toast）· 简化版"
  - 物理验证 auth.ts L72-82：initAuth 仅做 `saved = await getItem(TOKEN_KEY)` → `wrap(saved)` → 检查过期 → 不做任何 refresh。L76 判断 `saved.access_expires_at > Date.now()` 则恢复 session
  - COSTRA-164 R1.x review P2-2（`.team/reviews/COSTRA-164/round-1.x-tech.md` L52-58）：refresh 路径已有 default_family_id / default_ledger_id 返回
  - server authService.ts L256-277：refresh 路径已实现 `findPersonalFamily` + `findFirstByFamilyId` → 返回 default_family_id / default_ledger_id
- **问题**：
  1. 已登录用户升级后重启小程序 → initAuth 恢复旧 TokenStored（无 default_family_id/default_ledger_id）→ family-context storage 不存在 → getActiveFamilyId 返 null → **toast 提示重新登录** = 强制所有已登录用户重登 = 不可接受的 UX 退化
  2. refresh 路径已返回 default_family_id / default_ledger_id（server authService.ts L257-266 物理验证），正确策略应是在 initAuth 时走 refresh 而非 toast 重登：若 getActiveFamilyId() 返 null 且 isLoggedIn() → 触发 token.refreshFn() → 从 refresh response 中取 default_family_id / default_ledger_id → 写入 storage + globalData
  3. 此场景是 **P1 概率事件**（所有已登录用户升级时必触发），不是 P3 极低概率，构成 D-025 AP-002 反模式审视点（见 P1-2）
- **依据**：SOP-CARD-REVIEW §3 C5（风险与边界）+ D-025 AP-002 + COSTRA-164 R1.x P2-2 遗留风险
- **修复建议**：
  1. dispatch §7 风险条目修改：缓解策略从"toast 提示重新登录"改为"initAuth 时若 getActiveFamilyId() 返 null 且 isLoggedIn() → 触发 refreshToken() → 从 refresh response 取 default_family_id / default_ledger_id → setActiveFamily() + 同步 globalData"
  2. dispatch §2.1 B 禁项第 1 条"不在 refresh / 续签流程内重写 family-context"需修改为"refresh response 含 default_family_id / default_ledger_id 时写入 family-context（initAuth 升级场景必须路径）· 正常 refresh 流程（已有 family-context）不覆盖"
  3. 显式登记 FU-165-LEGACY-TOKEN-UPGRADE-PATH 到 sprint backlog
- **FU 编号**：**FU-165-001**（D-016 强制 R1 修订）

### P1-2 D-025 AP-002 反模式扫描"不命中"声明不成立

- **证据**：
  - dispatch §3 D-025 声明："AP-002 不命中（family.ts 全新建 · 不复制其他文件代码）"
  - 但 AP-002 的定义是"概率极低就接受"——与是否复制代码无关
  - P1-1 分析的 initAuth 旧 token 升级场景：toast 重登策略实质是"已登录用户升级时 family-context 不存在 → 强制重登"· 这是一个 P1 概率事件（100% 的已登录用户升级时必触发）· dispatch 将其归类为"已知风险"并接受 toast 重登 = "概率不低但接受了有问题的缓解策略" = AP-002 命中
- **问题**：AP-002 扫描声明依据错误（"不复制代码"不是 AP-002 的判定维度），实际风险场景命中 AP-002
- **依据**：D-025 AP-002 定义 + SOP-CARD-REVIEW §3 C5
- **修复建议**：
  1. dispatch §3 AP-002 扫描修正为："AP-002 **命中** · initAuth 旧 token 升级场景 toast 重登策略是 P1 概率事件的不当接受 · 修正为 refresh 触发刷新路径（FU-165-001）"
  2. 修正后 AP-002 不再命中（因缓解策略已改为正确路径）
- **FU 编号**：**FU-165-002**（关联 FU-165-001 · 一并修订）

### P1-3 TokenRaw 接口定义与 server AuthTokenPair 存在不一致

- **证据**：
  - dispatch §2.1 B TokenRaw 接口扩展：
    ```typescript
    export interface TokenRaw {
      access_token: string;
      refresh_token: string;
      access_token_ttl_sec: number;
      refresh_token_ttl_sec: number;
      expires_in?: number;    // ← 可选
      user: { ... };
      default_family_id: string;
      default_ledger_id: string;
    }
    ```
  - 现有 auth.ts L18-29 TokenRaw：
    ```typescript
    export interface TokenRaw {
      access_token: string;
      refresh_token: string;
      access_token_ttl_sec: number;
      refresh_token_ttl_sec: number;
      user: { id; nickname; avatar_url; has_completed_profile };
    }
    ```
  - server AuthTokenPair（authService.ts L39-59）：`expires_in: number`（required deprecated），`user` 含 `timezone` + `created_at` + `updated_at`（miniapp TokenRaw 当前缺失）
  - OpenAPI AuthTokenPair（openapi.yaml L867）：required 含 `default_family_id` + `default_ledger_id`
- **问题**：
  1. dispatch TokenRaw 加 `expires_in?: number`（可选），但 server/AuthTokenPair 是 `expires_in: number`（required）· 类型不一致
  2. 现有 auth.ts TokenRaw 无 `expires_in` 字段但 server 有——这是历史遗留的接口漂移（COSTRA-118 P0-2 修正只做了字段名 snake_case 对齐，未加 expires_in）
  3. dispatch TokenRaw 的 `user` 子对象签名不完整（缺 `timezone` / `created_at` / `updated_at`）——虽然这些字段 miniapp 当前不消费，但接口定义应与 server 对齐
  4. dispatch §1.3 表格引用 `auth.ts L173-185` 但实际 doWxLogin 代码在 L158-184（行号偏移）
- **依据**：SOP-CARD-REVIEW §3 C4（产出物具体）+ 协议一致性
- **修复建议**：
  1. dispatch §2.1 B TokenRaw 的 `expires_in?: number` 改为 `expires_in: number`（与 server/AuthTokenPair required deprecated 对齐）· 或声明"本卡补齐 expires_in required 与 server 对齐"
  2. dispatch TokenRaw user 子对象补 `timezone: string; created_at: string; updated_at: string`（即使 miniapp 不消费 · 接口定义 1:1 对齐是 COSTRA-118 P0-2 红线）
  3. 修正 §1.3 表格 auth.ts 行号引用（L173-185 → L158-184）
- **FU 编号**：**FU-165-003**（D-016 强制 R1 修订）

---

## P2 建议

### P2-1 storage / globalData 双源一致性缺少防御性测试

- **证据**：
  - dispatch §7 第 2 条风险："storage 与 globalData 双源：family.ts 是 storage（持久化）· globalData.activeLedgerId 是 runtime cache · 写时双写 · 读时读 globalData 优先 · 如不一致按 storage 为准（initAuth 时同步）"
  - 但 §2.1 E T1~T6 测试清单中**没有**双源一致性测试：无测试验证"storage 有值但 globalData 未同步"或"globalData 有值但 storage 无值"的异常场景
  - entry/index.ts L61 读 `getApp().globalData.activeLedgerId || FALLBACK_LEDGER_ID`——如果 auth.ts 的 doWxLogin 写了 globalData 但没写 storage（或反过来），会导致不同页面看到不同 activeLedgerId
- **问题**：双源是 P1 风险（dispatch 自认），但无测试覆盖不一致场景
- **修复建议**：§2.1 E 补 T7 测试："双源一致性：setActiveFamily 写 storage 后 · globalData.activeLedgerId 应同步 · mock 场景下 getApp().globalData.activeLedgerId === 写入的 ledger_id"
- **FU 编号**：FU-165-004

### P2-2 §2.1 D entry 页 FALLBACK_LEDGER_ID 处置方案选择缺乏明确判定标准

- **证据**：
  - dispatch §2.1 D："保留 FALLBACK_LEDGER_ID 作为防御"（方案 1）vs "删除 FALLBACK · 改为 if (!ledgerId) { wx.showToast · return }"（方案 2 · 推荐）
  - "实装选项 §3.5 R1 实装期由 backend-dev 拍板"——但 owner 是 miniapp-dev 不是 backend-dev
- **问题**：
  1. 方案 2（推荐）会导致用户在 activeLedgerId 未初始化时完全无法记账——如果 initAuth 路径有 bug 导致 globalData.activeLedgerId 为 undefined，用户看到 toast 但无自救路径（BUG-001 类回归）
  2. 实装决策权写"backend-dev"但本卡 owner 是 miniapp-dev——决策权错误
- **修复建议**：
  1. 方案 2 补兜底："if (!ledgerId) { toast 提示 → 延迟 1s 后自动触发 refreshToken + 重试 · 若仍失败则跳 login 页"——避免用户被卡死
  2. 实装决策权改为 miniapp-dev（本卡 owner）
- **FU 编号**：FU-165-005

### P2-3 单 commit 7 文件是否触发"提交粒度过大"

- **证据**：dispatch §5.1 可写 7 项业务文件 + 2 项 .team 文件 = 9 文件 · 单 commit 改 7~9 文件
- **问题**：engineering-guidelines §2.1 铁律"一卡一 commit"与"提交粒度"的平衡——7 文件是中等规模，与 164 dispatch 的 4~6 文件相当，不算过大。但 dispatch 未显式声明 commit 粒度合理性
- **修复建议**：dispatch §5.4 补说明"7 文件单 commit 合理性：5 项 scope 各 1~2 文件 · 单点修改密度可控 · 与 COSTRA-164 6 文件范式对齐"
- **FU 编号**：FU-165-006

---

## D-025 反模式扫描结论

| AP | 命中 | 证据 / 否决理由 |
|---|---|---|
| AP-001（字符串代理判定） | 不命中 | family.ts FamilyContext 接口是显式类型定义 · storage key 常量不作为状态判定依据 · 无业务字段字符串硬比较推断语义 |
| AP-002（概率极低就接受） | **命中** | initAuth 旧 token 升级场景 toast 重登 = P1 概率事件的不当接受 · 缓解策略应改为 refresh 触发刷新（见 P1-1/P1-2）· 修正后不再命中 |
| AP-003（契约-实装漂移） | 不命中 | 本卡不引入新 deferred · TokenRaw 加字段是对齐 server 已有字段（不是漂移）· 不动 openapi.yaml（164 范围） |

**结论**：命中 1 条 AP-002（P1 级 · 关联 FU-165-001 + FU-165-002 · 修订后不再命中 · 不阻塞 PASS-WITH-FOLLOWUP）

---

## 给卡作者的回执指令

请 miniapp-dev 按 P1 清单逐条修改 dispatch 定义：

1. **FU-165-001**：initAuth 旧 token 升级策略从"toast 重登"改为"refresh 触发刷新 → 从 refresh response 取 default_family_id / default_ledger_id → 写入 storage + globalData"· §2.1 B 禁项第 1 条相应修正
2. **FU-165-002**：§3 D-025 AP-002 扫描修正为"命中"· 关联 FU-165-001 修正后改为"修正后不再命中"
3. **FU-165-003**：TokenRaw 接口 `expires_in?: number` → `expires_in: number`（与 server required 对齐）· user 子对象补 timezone/created_at/updated_at · 修正 §1.3 行号引用

然后通过 Orchestrator 触发 Round 2 审核。

---

## 自我反思

- 审核耗时：约 40 分钟（含 12 份事实源全量 Read + 行号交叉验证 + ADR-0007 6 个章节对照 + 164 dispatch v2.1 534 行逐段对比 + 164 R1.x review 遗留风险追踪）
- 置信度：高
  - server AuthTokenPair 物理验证（authService.ts L39-59 确认 default_family_id/default_ledger_id 已实装 + refresh 路径 L256-277 确认返回两字段）✓
  - OpenAPI 物理验证（openapi.yaml L865-897 确认 required 含两字段 + format: uuid）✓
  - auth.ts 行号物理验证（L18-29 TokenRaw / L72-82 initAuth / L158-184 doWxLogin / L195-214 refreshToken）✓
  - syncScheduler.ts 行号物理验证（L30 FAMILY_ID_KEY / L47-50 getActiveFamilyId / L73 调用点）✓
  - storage.ts envelope 范式验证（L48-56 setItem + L58-76 getItem）✓
  - entry/index.ts FALLBACK 验证（L14 FALLBACK_LEDGER_ID / L61 L77 使用点）✓
  - app.ts globalData 验证（L22 activeLedgerId?: string）✓
  - COSTRA-164 R1.x review P2-2 refresh 空字符串风险追踪 ✓
- 若低：建议 Orchestrator 转 Human 二裁（不需要 · 置信度高）
