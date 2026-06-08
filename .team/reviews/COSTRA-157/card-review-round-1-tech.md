# Card Review · Tech · COSTRA-157 · Round 1

- 卡 Owner：miniapp-dev + backend-dev（双装扮档 · Q4-A）
- 卡类型：feat（5 FU 合并修复）
- 卡 points：3
- 审核时间：2026-05-18T17:30+08:00
- 上轮结论：首轮

## 总评

- **Verdict**：`PASS-WITH-FOLLOWUP`
- **总分**：25/30 分
- **阻塞点**：0 个 P0 / 2 个 P1 / 4 个 P2 / 3 个 INFO

## 维度得分

| 维度 | 得分 | 一句话 |
|---|---|---|
| C1 标题与描述 | 4/5 | 标题精准含"用户资料完善 + 登录链路鲁棒性"双主题 + 5 FU 合并范围；描述三要素齐全；扣 1 分：标题 33 字超长但可接受，"5 FU 合并修复"括号注释使标题语义偏技术向而非用户故事向 |
| C2 DoD 可度量 | 5/6 | 12 项 DoD（§3.1 主交付 5 + §3.2 副交付 1 + §3.3 闸门 6 + §3.4 反向验证 2）· 含 grep 反向断言 + 闸门命令；扣 1 分：E 项 DoD "home.wxml + wxss + ts 三处加'完善资料'入口"缺乏自动化判定标准（如"grep 'onTapCompleteProfile' 命中 ≥ 1"） |
| C3 依赖识别 | 4/5 | 上下游清晰（COSTRA-101 CLOSED + COSTRA-102 CLOSED）；扣 1 分：未显式列出"下游受阻卡"（当前写"无强依赖"但 Sprint-3 Epic-D 完善资料页与此卡 E 项临时方案有接通依赖，虽不阻塞但不等于零下游） |
| C4 产出物具体 | 4/5 | 5 项 scope 全含文件路径 + 行号 + 代码 diff；扣 1 分：B 项 mine/index.ts:39 的行号可能已漂移（并行 ICP commit `e24d33a` 可能改了该文件 · dispatch 注释提及但未确认最新 HEAD 行号） |
| C5 风险与边界 | 3/4 | 降级路径标注（D 项头像 fallback + E 项 wx.showModal 临时方案）；扣 1 分：E 项 hasProfile 判定逻辑 `u.nickname !== defaultNickname` 的边界风险（用户真名="微信用户"的极端情况）仅在 task prompt 的"评分原则提示"中提及，**dispatch 档本身未暴露此已知未知** |
| C6 去重 | 3/3 | backlog.json 唯一 COSTRA-157 占位 · 5 条 FU 全 scoped 到本卡 · board.md 无覆盖 · FU-COMMON-MINIAPP-PATCH-LIMIT 显式切出（Q3-A） |
| C7 估点 | 2/2 | 3 点 vs 类似 fix 卡（COSTRA-124/125/126 1~2 点）略高但 5 项合并合理 · 落 1~8 区间 · 时间盒 90 min 可行 |
| C8 红线 | Pass | 无红线命中（见下详） |

## P0 阻塞点

无

## P1 应改

### P1-1 · E 项 hasProfile 判定逻辑边界风险未在 dispatch 中暴露

- **维度**：C5 风险与边界
- **证据**：dispatch §2.1 E hydrateUser L153 `const hasProfile = !!(u && u.nickname && u.nickname !== defaultNickname);`
- **问题**：当用户真实昵称恰好等于 `'微信用户'` 时，hasProfile 将恒为 false → 已授权用户永远显示"完善资料"入口。虽然概率极低，但这是一个**判定逻辑的语义边界缺陷**，dispatch 档应显式暴露此已知未知并说明接受理由（如"概率极低 + MVP 不引入额外复杂度 + Sprint-3 Epic-D 落地后该判定逻辑被替代"）
- **依据**：SOP-CARD-REVIEW §3 C5 "已知的未知项是否暴露" · COSTRA-128 起源（5 项合并核心教训 = 边界条件必须显式化）
- **修复建议**：dispatch §2.1 E 项末尾追加一段边界说明：`⚠️ 已知边界：若用户真实昵称 === '微信用户'（极低概率），hasProfile 判定为 false 导致误显示"完善资料"入口。MVP 接受此风险：1) 概率极低；2) Sprint-3 Epic-D 完善资料页落地后该字段改为服务端 has_completed_profile 标记，不再依赖昵称比较`

### P1-2 · B 项 server / miniapp 两份 defaults.ts 手工对齐机制缺乏防漂移保障

- **维度**：C5 风险与边界
- **证据**：dispatch §2.1 B miniprogram/config/defaults.ts L89 `⚠️ 必须与 server/src/config/defaults.ts 保持值一致（手工对齐 · COSTRA-160 tokens pipeline 可能扩展为构建期同步）` + dispatch §8 Retro 议题候选提及
- **问题**：两端 defaults.ts 的 defaultNickname 值 `'微信用户'` 完全靠人工对齐 · 无 CI 防漂移机制 · 当前仅 §8 列为 Retro 议题候选（非 DoD/闸门）· 若 miniapp 端误改为 `'未命名用户'` 而 server 端仍 `'微信用户'` → hasProfile 判定失效（P1-1 的恶化版）
- **依据**：SOP-CARD-REVIEW §3 C5 "标注失败路径处理" · 项目 CI 对账族五代积累的教训（whitelist-check.mjs 规则 A~D 均为手工对齐漂移的历史教训产物）
- **修复建议**：在 §3.3 闸门或 §3.4 反向验证中追加 1 项：G7 之后加 **G7.5** `grep -o "defaultNickname = '[^']*'" server/src/config/defaults.ts miniprogram/config/defaults.ts | sort | uniq | wc -l` = 1（两端值一致 · 否则 exit 1）· 或在 whitelist-check.mjs 追加规则 E（轻量正则 · ~5 行 · 与规则 D 范式一致）· 若不想扩本卡 scope，至少在 DoD §3.2 副交付 F 中追加 1 测："断言两端 defaultNickname 字符串值相等"

## P2 建议

### P2-1 · E 项 DoD 缺乏自动化判定标准

- **维度**：C2 DoD 可度量
- **证据**：dispatch §3.1 E `home.wxml + wxss + ts 三处加"完善资料"入口 · 临时方案 wx.showModal`
- **问题**：该 DoD 条目仅有人工验收标准（"看页面有没有"）· 缺 grep 断言（如 `grep 'onTapCompleteProfile' miniprogram/pages/home/index.ts` 命中 ≥ 1）
- **修复建议**：追加 grep 反向/正向断言，与 C 项 DoD 风格一致

### P2-2 · C 项 mapError 返回空 title/desc 时的 fallback 逻辑不够健壮

- **维度**：C5 风险与边界
- **证据**：dispatch §2.1 C 目标代码 L118 `this.setData({ errMsg: mapped.title ? \`${mapped.title}：${mapped.desc}\` : '登录失败，请重试' })`
- **问题**：当 mapError 返回 TOKEN_EXPIRED（title='' / desc='' · 静默自动续签场景），fallback '登录失败，请重试' 会显示给用户 · 但 TOKEN_EXPIRED 应由 request.ts 拦截器自动续签 · 若续签失败落入 catch · 此 fallback 合理 · 但 dispatch 未说明此路径
- **修复建议**：C 项代码注释追加 1 行说明 TOKEN_EXPIRED 落 catch 场景的 fallback 合理性 · 或确认 request.ts 拦截器已保证 TOKEN_EXPIRED 不会冒泡到 login 页 catch（若如此则无问题）

### P2-3 · B 项 mine/index.ts:39 行号可能漂移

- **维度**：C4 产出物具体
- **证据**：dispatch 任务提示"此文件刚被并行 ICP 批 commit `e24d33a` 修改 · 请读最新 HEAD 版本确认 line 号是否漂移" · 实测当前 HEAD `mine/index.ts:39` 确实仍为 `nickname: s?.user?.nickname || '未命名用户'`（行号未漂移 · 已验证）
- **问题**：行号当前准确 · 但 dispatch 注释本身就说明行号不可靠 · 若后续再有 commit 则 R1 实装时行号可能已变
- **修复建议**：R1 实装时 miniapp-dev 应以 grep 定位而非硬行号 · 此 P2 不改 dispatch · 仅提醒实装方

### P2-4 · C 项 mapError 签名中 `action` 字段不消费但未在 dispatch 中说明未来接通路径

- **维度**：C1 标题与描述清晰度
- **证据**：dispatch §2.1 C L124 `注：error-mapper.ts 现有 MappedError.action 字段（如 navigate-login）暂不消费 · 留 Sprint-3 用户体验扩展时再接`
- **问题**：ACTION 字段 'navigate-login' 正好与登录页错误场景高度相关 · dispatch 说"暂不消费"但未说明 R1 实装后是否会在 login 页 catch 中留占位代码（如 `if (mapped.action === 'navigate-login') { /* TODO: Sprint-3 */ }`）
- **修复建议**：追加 1 句"R1 不留 action 占位代码 · 纯消费 title+desc · Sprint-3 统一接通"· 避免实装方自行发挥

## INFO

### INFO-1 · dispatch §0 标注"本档为 dispatch 草稿"与当前状态矛盾

- dispatch L8 写 `⚠️ 本档为 dispatch 草稿（D-014-a 前置原料）· PM-Agent 在卡定义 Review 时可扩展 / 修订 / 拆解`
- 但本档已由 Orchestrator 2026-05-18 17:11 落盘 · Human all-A 决策后同轮产出 · 且 backlog.json 已占位 · 应视为正式 dispatch 而非草稿
- **建议**：R1 实装前移除"草稿"措辞 · 或改为"Card-Review R1 进行中"

### INFO-2 · §9 Human 验证清单步骤 5 涉及 DevTools 改 storage

- 步骤 5 "设置 home 页 userAvatar 为不可达 URL（DevTools 改 storage）→ 重启"
- 此步骤对 Human 操作要求较高（需知道 storage key 名 + JSON 结构）· 建议补充具体操作指引（如"在 AppData 面板搜索 userAvatar · 改为 https://invalid.test/404.jpg"）

### INFO-3 · A 项 defaults.ts 新建位置合理但可考虑与 subjectConfig 联动备注的显式性

- server/src/config/ 目录已有 env.ts / icp.ts / subject.ts / ttl.ts 四个配置文件 · defaults.ts 放此处范式一致 ✅
- dispatch L62 注释"未来扩展：Q2-A 决策不引入 env 覆盖 · 真有需求时升级到 subjectConfig 联动"· 但此注释仅在代码块内 · 建议在 §2.1 A 项描述中也显式提及（与 B 项 miniprogram 端的 ⚠️ 注释对等）

---

## 五项 Scope 子项专项核查

### A · server defaults — Q2-A 硬编码合理性 ✅

- **Q2-A 决策**：`server/src/config/defaults.ts` 硬编码 fallback `'微信用户'` · 不支持 env 覆盖
- **合理性**：MVP 阶段 defaultNickname 无需多环境差异化 · 与 env.ts（运行时配置）subject.ts（主体配置）职责正交 · defaults.ts 定位为"编译期常量"而非"运行时配置" · 合理 ✅
- **subjectConfig 联动**：dispatch 代码注释 L62 提及"真有需求时升级到 subjectConfig 联动"· 但 dispatch §2.1 A 项描述段未显式提及 · 见 INFO-3
- **结论**：硬编码合理 · 不需要 subjectConfig 联动（MVP）

### B · miniapp defaults — 两端一致性维护 ⚠️

- **当前方案**：server `config/defaults.ts` + miniprogram `config/defaults.ts` 各一份 · 手工对齐
- **编译边界隔离**合理：miniprogram 编译无法 import server/ 模块 · 两份文件是必要的
- **防漂移机制缺失**：见 P1-2 · 核心风险是两端 defaultNickname 值不一致导致 hasProfile 判定失效
- **COSTRA-160 tokens pipeline 扩展**：dispatch §2.1 B L89 和 §8 均提及"COSTRA-160 tokens pipeline 可能扩展为构建期同步"· 但这是未来期望 · 非当前保障
- **结论**：两份 defaults.ts 方案本身合理 · **但缺 CI 防漂移** · P1-2 建议追加轻量对账

### C · mapError 改造 — 签名匹配 + 红线兑现 ✅

- **mapError 签名**：`mapError(err: ApiErrorLike): MappedError` · 入参 `ApiErrorLike` 含 `{ code: string; status?: number; details?: Record<string, unknown> }` · login catch 中 `e: any` 可直接传入 ✅
- **MappedError.action 字段**：`action?: 'navigate-login' | 'navigate-family-home' | 'refresh' | 'view-conflict'` · dispatch 明确"暂不消费" ✅（见 P2-4 建议）
- **红线兑现**：当前 `msg = e.message` 直接展示 → 改为 `mapError(e)` 转译 → 符合 error-codes.md §0.5 红线 ✅
- **grep 反向断言**：DoD G8 `grep 反向断言 0 命中 msg = e.message` ✅
- **边界场景**：见 P2-2（TOKEN_EXPIRED fallback）
- **结论**：mapError 改造方案正确 · 红线兑现

### D · onAvatarError — handler 实装最小集 ✅

- **wxml binderror 已存在**：`miniprogram/pages/home/index.wxml:5` `<image binderror="onAvatarError">` ✅（COSTRA-102 R1 布桩）
- **handler 实现**：`onAvatarError() { this.setData({ userAvatar: '' }); }` · 清空 userAvatar → wxml `wx:if="{{userAvatar}}"` 切换到 fallback 👤 图标 ✅
- **wxss fallback 样式**：wxml L6 `greeting__avatar--fallback` 已有 class · 本卡不新增 fallback 样式（复用既有）· 最小集 ✅
- **结论**：onAvatarError 最小集合理 · 无遗漏

### E · home 降级 UI — Q1-A + Q5-A 临时方案合理性 ⚠️

- **Q1-A 占位头像 + 欢迎**：wxml 已有 `<view wx:else class="greeting__avatar greeting__avatar--fallback">👤</view>` + `你好，{{userName}}` · 当 userAvatar 为空时自动 fallback · 当 userName = defaultNickname 时显示"你好，微信用户" ✅
- **hasProfile 判定逻辑**：`u.nickname !== defaultNickname` · 见 P1-1 边界风险
- **"完善资料 →"入口**：`wx:if="{{!hasProfile}}"` · 位置"右上角"（wxss absolute + right:32rpx）· 临时方案 Q5-A ✅
- **wx.showModal 临时弹窗**：`onTapCompleteProfile` 调 `wx.showModal` 提示"功能开发中" ✅
- **Sprint-3 Epic-D 接通路径**：dispatch 明确"待 Sprint-3 Epic-D 完善资料页落地后再接通" ✅
- **结论**：临时方案整体合理 · **hasProfile 判定边界是唯一风险点**（P1-1）

---

## INVEST 复核

| 维度 | 评估 | 说明 |
|---|---|---|
| **I-ndependent** | ⚠️ 中等 | 5 项之间有弱依赖：A（server defaults）→ B（miniapp defaults 同步）→ E（hasProfile 依赖 defaultNickname 值）· 但 C/D 两项完全独立 · 合并到一卡的理由是"同一产品故事"（§1.2 登录后用户资料全链路兜住）· Human all-A 决策已拍板 · 合理 |
| **N-egotiable** | ✅ | Q3-A 显式切出 FU-COMMON-MINIAPP-PATCH-LIMIT · Q5-A 临时方案 · scope 可调 |
| **V-aluable** | ✅ | 含 1 条 P1 红线违反修复（C 项）+ 1 条 P1 静默失败修复（D 项）· 独立价值成立 |
| **E-stimable** | ✅ | 3 点 · 时间盒 90 min · 各项预估明确（A 15min / B 10min / C 20min / D 10min / E 30min / F 15min） |
| **S-mall** | ✅ | 5 项均为单点修改 · 无重构 · 总估点 3 · 符合 INVEST small |
| **T-estable** | ✅ | DoD 12 项含闸门 6 + 反向验证 2 + grep 断言 · 每项可测（E 项略弱 · 见 P2-1） |

**INVEST 总评**：5 项合并符合"同一产品故事"原则 · 项目反复教训（COSTRA-128 起）是"FU 合并需守 INVEST small"· 本卡 3 点 · 合格

---

## 与 D-022 v2.0 评分表的预对账

R1 Review 时将使用 D-022 v2.0（40 分制）· 以下为各维风险点预测：

| 维度 | 满分 | 本卡风险点 | 预估扣分 |
|---|---|---|---|
| C1 契约对齐 | 5 | A 项 server config 范式与 subjectConfig 联动暂不做 · 需在代码注释中显式标注"未经验测"（C8-3 类要求）| 0~1 |
| C2 代码质量 | 5 | 5 项改动均为最小集 · 无超 scope · C 项 mapError 消费方式需确认 TOKEN_EXPIRED 路径 | 0 |
| C3 架构合理 | 5 | server / miniapp 两端 defaults 各一份（编译边界隔离）· 防漂移机制缺（P1-2）| 0~1 |
| C4 数据完整 | 5 | hasProfile 判定逻辑（P1-1）· 若 R1 实装时追加边界说明则不扣 | 0~1 |
| C5 安全 | 5 | C 项守红线 ✅ · 不引入新攻击面 | 0 |
| C6 可测性 | 5 | F 项单测 + G7/G8 反向验证 · E 项 DoD 自动化弱（P2-1）| 0~1 |
| C7 纪律 | 5 | INVEST small 3 点 · D-016 同轮 · D-018 commit footer | 0 |
| C8 runtime 加载性 | 5 | C8-1：本卡含 Human 实测 DoD（§9 验证清单 6 步）✅ · C8-3：wx.getUserProfile 拒绝授权的行为假设需标注"未经验测" | 0~1 |
| C9 性能 | 0 | 不适用 | 0 |
| C10 SBAI 流程合规 | 5 | 单卡双装扮档 · 严守工作区铁律 | 0 |

**预对账结论**：R1 Review 风险集中在 C4 hasProfile 判定 + C3 两端 defaults 防漂移 · 若 P1-1/P1-2 在 R1 实装时采纳修复 · 预估 R1 Review 可达 37~40/40

---

## 审查档自评（D-018 §3.4 SBAI 流程合规）

| 维度 | 值 |
|---|---|
| 工作区铁律 | ✅ 仅读 + 仅写 `.team/reviews/COSTRA-157/card-review-round-1-tech.md` · 0 业务代码 · 0 commit |
| tools 白名单 | ✅ 使用 Read / Grep / Glob / LS · 未触发 Write 任何 miniprogram/server 文件 |
| D-016 同轮兑现 | ✅ 本次 Review 在 Orchestrator 派单同对话轮内产出 |
| 审核耗时 | ~20 分钟 |
| 置信度 | **高**（5 项 scope 均独立 grep 核实 · server/miniprogram 源码全量对勘 · 红线零命中确认） |
| 低置信点 | hasProfile 边界判定（P1-1）的"概率极低"假设未做用户名分布统计 · 但 MVP 接受 |
| 是否需 Human 二裁 | 否（PASS-WITH-FOLLOWUP 25/30 · P1 均为"应改"非"阻断"） |

---

## 给卡作者的回执指令

请 miniapp-dev + backend-dev 按 P1 清单逐条修改卡定义：

1. **P1-1**：dispatch §2.1 E 项末尾追加 hasProfile 边界说明（用户真名="微信用户"的极端情况 + MVP 接受理由）
2. **P1-2**：在 §3.3 闸门或 §3.4 反向验证中追加 1 项轻量对账（grep 两端 defaultNickname 值一致）

P2 项建议 R1 实装时一并采纳（不改 dispatch 亦可 · 但 P2-2 mapError TOKEN_EXPIRED fallback 说明建议补在代码注释中）。

完成后无需触发 Round 2（PASS-WITH-FOLLOWUP 不强制再审）。

---

*报告结束 · costra-card-reviewer-tech-COSTRA-157-r1 一次性装扮销毁（2026-05-18T17:30+08:00）*
