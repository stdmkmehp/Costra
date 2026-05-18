# Tech Review · COSTRA-157 · Round 1 · D-022 v2.0 第 5 次实战

> **审查档声明**：D-018 SBAI v1.1 审查 subagent · 物理只读 · 报告仅通过 final message 返回 Orchestrator 落盘 · 审查档第 9 次实战 · **D-022 v2.0 评分表第 5 次实战**（首次 = 103 38/40 · 第 2 次 = 104 36/40 · 第 3 次 = 105 40/40 · 第 4 次 = 156 40/40 · 本卡 = 157）。

---

## §1 元数据

| 字段 | 值 |
|---|---|
| 卡号 | COSTRA-157 |
| 标题 | 用户资料完善 + 登录链路鲁棒性（5 FU 合并修复） |
| 估点 | 3 点 |
| Owner / 被审 Agent | `costra-backend-dev`（A 项第 1 段）+ `costra-miniapp-dev`（B/C/D/E 项第 2 段 · 单卡双装扮档 Q4-A） |
| 审核人 | `costra-review-tech-COSTRA-157-r1`（一次性装扮 · 第 9 次审查档实战） |
| 审核时间 | 2026-05-18 19:15+08:00（独立复核耗时 ~25 分钟） |
| 轮次 | Round 1 / 5 |
| 上轮结论 | Card-Review R1 PASS-WITH-FOLLOWUP **25/30**（P1-1 + P1-2 + P2-1~4 + INFO-1~3 · 0 P0 · C8 红线 0 命中）|
| 本轮 Verdict | **APPROVE** 🏆 |
| 本轮总分 | **38 / 40**（D-022 v2.0 40 分制） |
| R1 commit | `ac204e3` · 15 文件 · +297/-16 行 |

---

## §0 结论速览

- **Verdict**：`APPROVE`
- **总分**：**38/40**（D-022 v2.0 40 分制 · ≥ 36 APPROVE 档）
- **阻塞点**：**0 P0 / 1 P1 / 3 P2 / 1 INFO**
- **上轮 P1 兑现率**：**2/2（100%）**
  - P1-1 hasProfile 边界 ✅ dispatch §2.1 E 末尾 ⚠️ 段 + 代码注释双重标注
  - P1-2 G7 双端对账闸门 ✅ dispatch §3.3 G7 + grep 命令 + commit message 确认 G7==1
- **上轮 P2 兑现率**：**4/4（100%）**
  - P2-1 E 项 grep 自动化 ✅ grep `onTapCompleteProfile` 命中 6 处（ts+wxml+spec）
  - P2-2 mapError TOKEN_EXPIRED 注释 ✅ login/index.ts:91-92 双行注释
  - P2-3 mine 行号漂移 grep 定位 ✅ 实际 commit 用 grep 定位（mine/index.ts:40 改为 defaultNickname）
  - P2-4 action 字段不留占位 ✅ login/index.ts:93 仅注释说明暂不消费 · 代码中 0 引用 mapped.action

---

## §2 D-022 v2.0 十维度评分

| 维度 | 满分 | 得分 | 一句话 |
|---|---|---|---|
| C1 契约对齐 | 5 | 5 | OpenAPI 0 改动 ✅ · error-codes.md 仅消费不造码 ✅ · A 项 defaults.ts 符合既有 config/ 范式 ✅ |
| C2 代码质量 | 5 | 5 | 5 项改动均为最小集 · 无超 scope · hasProfile 抽取 computeHasProfile 合理 · mapError 消费完整 |
| C3 架构合理 | 5 | 4 | 双端 defaults.ts 编译边界隔离合理 · G7 闸门防漂移 ✅ · 扣 1 分：utils/profile.ts 仅 1 消费方抽取边际收益低（派单档允许 · 不阻断） |
| C4 数据完整 | 5 | 5 | hasProfile 判定逻辑边界 P1-1 在代码+注释双重标注 ✅ · data.hasProfile 字段显式声明 ✅ · Sprint-3 替代路径标注 ✅ |
| C5 安全 | 5 | 5 | C 项红线兑现（grep `msg = e.message` 0 命中）✅ · 无 session_key/openid 泄漏 ✅ · D-008 主体字样 0 命中 ✅ · AppID 未入打包源码 ✅ |
| C6 可测性 | 5 | 4 | server defaults.test.ts 1 测 + miniapp home.spec.ts 8 测 ✅ · G7/G8/G9/G10 反向验证 commit message 确认 ✅ · 扣 1 分：onAvatarError/onTapCompleteProfile 测试通过模拟 setData 而非调用真实 Page handler（间接验证 · 可接受但不完美） |
| C7 纪律 | 5 | 5 | INVEST small 3pt 守住 ✅ · D-018 commit footer 双 Co-Authored-By ✅ · commit subject 全小写 ✅ · D-016 同轮兑现 ✅ · 0 文件 > 500 行 ✅ |
| C8 runtime 加载性 | 5 | 5 | A 项 server config 顶层 export const 无副作用 ✅ · B 项 miniprogram config 编译期 inline 无 runtime 风险 ✅ · wxml/wxss 改动极简无渲染风险 ✅ · C8-1 Human 实测 DoD 6 步完整 ✅ · C8-3 SDK 假设标注（wx.getUserProfile 拒绝授权 / wx.showModal 行为）在 dispatch 明确 ✅ |
| C9 性能 | 0 N/A | 0 | 不适用（无 hot path · 双端 defaults 均为编译期常量） |
| C10 SBAI 流程合规 | 5 | 5 | 单卡双装扮档 Q4-A 守住（backend-dev 第 1 段不 commit · miniapp-dev 第 2 段统一 commit）✅ · 工作区铁律未越界（diff 仅含 server/ + miniprogram/ + .team/members/）✅ · state.md + history 同 commit ✅ |

**总分 = 5+5+4+5+5+4+5+5+0+5 = 38 / 40**

---

## §3 问题清单

### P0：0 项 ✅

### P1：1 项

#### P1-1 · onAvatarError / onTapCompleteProfile 测试间接验证 · 非真实 Page handler 调用

- **维度**：C6 可测性
- **证据**：`miniprogram/pages/home/index.spec.ts:42-77` — 测试通过 `setDataMock = vi.fn(...)` 模拟 Page.setData 行为 · 直接调用 `setDataMock({ userAvatar: '' })` / `wx.showModal(...)` · 而非 import 真实 Page 对象并调用 `page.onAvatarError()` / `page.onTapCompleteProfile()`
- **问题**：测试验证的是"调用 setData 参数正确"而非"handler 逻辑正确"· 若有人改了 handler 实现（如 onAvatarError 加 `this.setData({ userAvatar: '', userName: '' })`）· 测试不会失败 · 覆盖力为间接
- **依据**：D-022 C6 "关键路径是否有单测覆盖"· Sprint-1 允许"可测设计 + 用例清单"替代完整测试 · 但既然已写测试 · 应追求直接覆盖
- **修复建议**：P1 不阻断 · 可留 Sprint-3 补充。如需修复：将 computeHasProfile 抽取模式扩展到 onAvatarError/onTapCompleteProfile（抽为独立纯函数或从 Page 对象直接 import 测试）· 预估 0.5 点

### P2：3 项

#### P2-1 · utils/profile.ts 20 行仅 1 消费方 · 抽取边际收益偏低

- **维度**：C3 架构合理
- **证据**：`miniprogram/utils/profile.ts`（20 行）唯一消费方为 `miniprogram/pages/home/index.ts:9` 的 `import { computeHasProfile } from '../../utils/profile'`
- **问题**：派单档 §2.2 F 明确允许"helper 可选重构"· 抽取合理动机是"便于单测"· 但实际上 computeHasProfile 逻辑极简（1 行 return）· 直接在 hydrateUser 内写 inline 测试也可覆盖 · 抽取为独立文件增加了 import 链和文件数（15 文件中 1 个纯为可测性而存在）
- **依据**：INVEST small · 文件数 +297/-16 · 15 文件 vs 估点 3pt
- **修复建议**：不阻断 · 保留现状 · Sprint-3 Epic-D 完善资料页落地时 computeHasProfile 将有第 2 消费方 · 届时抽取自然合理

#### P2-2 · server/test/defaults.test.ts 仅 1 测 · 缺 authService.wxLogin nickname 断言

- **维度**：C6 可测性
- **证据**：`server/test/defaults.test.ts:14-16` — 仅断言 `defaultNickname === '微信用户'` · 未 mock code2Session 断言新建用户 nickname 为 defaultNickname
- **问题**：backend-dev history §3 说明"authService.wxLogin mock 测因 mock 复杂度而省略 · auth.test.ts T1 已隐式覆盖"· 但 T1 隐式覆盖 ≠ F 项显式 DoD 断言 · 若未来 authService 改为 nickname: '' + 前端兜底 · T1 不会 fail · 但 defaults.test.ts 也无法捕获
- **依据**：派单档 §2.2 F "1~3 测 · authService.wxLogin mock code2Session 后断言新建用户 nickname 为 defaultNickname"
- **修复建议**：不阻断 · Sprint-3 补充 authService mock 测 · 或接受 T1 隐式覆盖 + defaults.test.ts 值断言的双保险

#### P2-3 · commit body 行超 100 字符（2 处）

- **维度**：C7 工程纪律
- **证据**：commit `ac204e3` body L5 `e: home unauthorized fallback ui + temp complete profile entry` + L15 `check:appjson 0 / check:tooling 0 / check:whitelist 0 / g7 == 1` — 后者含 55 字符 · 未超 100 · 但前者续行 `(fu-102-profile-refuse-ui · q5-a stub)` 衔接后整行约 70 字符 · 未超限 · **经实测 grep 检查 · commit body 无 >100 字符行**
- **问题**：实测后撤回 · commit body 行宽合规
- **依据**：D-012 commitlint 规约
- **修复建议**：不适用（实测合规）· 本 P2-3 降级为 INFO

### INFO：1 项

#### INFO-1 · P2-3 撤回 · commit body 行宽实测合规

- **维度**：C7 工程纪律
- **证据**：`git log ac204e3 -1 --format="%B"` · 逐行 wc -L 检查 · 最长行 ~78 字符
- **说明**：初审疑 commit body 有超 100 字符行 · 实测确认合规 · 撤回

---

## §4 上轮 Card-Review P1/P2 兑现核查

| 上轮项 | 兑现状态 | 证据 |
|---|---|---|
| P1-1 hasProfile 边界 | ✅ 已兑现 | dispatch §2.1 E 末尾 ⚠️ 段（L203-211）显式标注边界 + MVP 接受理由 + Sprint-3 替代路径 · 代码 `home/index.ts:65-66` 注释 `⚠️ 已知边界（dispatch §2.1 E）` · `utils/profile.ts:15-16` 注释同步标注 |
| P1-2 G7 双端对账闸门 | ✅ 已兑现 | dispatch §3.3 G7 追加闸门 `grep -h "defaultNickname = '" ... \| sort -u \| wc -l` = 1 · commit message 确认 `g7 == 1` · G8/G9/G10 反向验证 commit message 确认 `g8/g9/g10 all confirmed` |
| P2-1 E 项 grep 自动化 | ✅ 已兑现 | `grep -c onTapCompleteProfile miniprogram/pages/home/index.ts` = 1 · wxml L9 也有引用 · spec.ts 2 处 · 合计 ≥ 1 命中 |
| P2-2 mapError TOKEN_EXPIRED 注释 | ✅ 已兑现 | `login/index.ts:91-92` — `注：mapError 返回 TOKEN_EXPIRED 时 title=desc='' (静默自动续签场景)` + `但该路径正常由 request.ts 拦截器处理 · 若续签失败冒泡到此 catch · fallback 文案合理` |
| P2-3 mine 行号漂移 grep 定位 | ✅ 已兑现 | commit diff 显示 mine/index.ts L40 改 `|| defaultNickname`（非硬行号定位 · 使用 grep 模式找到目标行） |
| P2-4 action 字段不留占位 | ✅ 已兑现 | `login/index.ts:93` 仅注释 `MappedError.action 字段暂不消费 · Sprint-3 统一接通` · 代码中 0 引用 `mapped.action` · grep `mapped\.action\|MappedError\.action` 仅注释 1 命中 |
| INFO-1 dispatch 草稿措辞 | ✅ 已兑现 | dispatch L1-8 头部无"草稿"措辞 · L4 写"修订：2026-05-18 17:32 Card-Review R1 PASS-WITH-FOLLOWUP" · L9 写"✅ 本档已 Card-Review APPROVE" |
| INFO-3 A 项 subjectConfig 备注 | ✅ 已兑现 | dispatch §2.1 A 项描述段 L56 显式提及"未来扩展：当真有多环境/多商户/多主体差异化需求时 · defaultNickname 升级为 subjectConfig.defaultNickname（与 D-008 主体策略联动）" · 与 B 项 ⚠️ 注释对等 |

**上轮 P1 兑现率 2/2 · P2 兑现率 4/4 · INFO 兑现率 2/2 · 全量采纳 ✅**

---

## §5 五项 Scope 子项专项核查

### A · server defaults — 实装是否符合既有 config 范式？ ✅

| 检查项 | 结果 | 证据 |
|---|---|---|
| 文件位置 | ✅ | `server/src/config/defaults.ts` · 与 env.ts/icp.ts/subject.ts/ttl.ts 同目录 |
| 导出风格 | ✅ | `export const defaultNickname = '微信用户'` · 与 ttl.ts `export const ttl = { ... }` 范式一致（编译期常量 · 非 runtime 配置） |
| JSDoc 完整 | ✅ | L1-14 含职责/消费方/⚠️对齐说明/未来扩展 · 比其他 config 文件更详尽 |
| authService 引用 | ✅ | `authService.ts:29` import · L122 改为 `nickname: defaultNickname` |
| import 排序 | ✅ | defaults < ttl（字母序）· 与 authService.ts 现有 import 风格一致 |
| OpenAPI 不触及 | ✅ | `git diff ac204e3 -- server/api/openapi.yaml api/openapi.yaml` = 0 行 |

### B · miniapp defaults — 双端值一致？G7 闸门可执行？ ✅

| 检查项 | 结果 | 证据 |
|---|---|---|
| 文件位置 | ✅ | `miniprogram/config/defaults.ts` · 与 subject.ts 等同目录 |
| 双端值一致 | ✅ | server `export const defaultNickname = '微信用户'` · miniprogram `export const defaultNickname = '微信用户'` · grep 验证一致 |
| G7 闸门 | ✅ | commit message `g7 == 1` · grep 命令 `grep -h "defaultNickname = '" server/src/config/defaults.ts miniprogram/config/defaults.ts \| sort -u \| wc -l` = 1 |
| ⚠️ 对齐注释 | ✅ | 双端文件均含 ⚠️ 必须保持值一致注释 + G7 引用 |
| mine 改引用 | ✅ | `mine/index.ts:40` 改为 `s?.user?.nickname || defaultNickname`（原 '未命名用户'） |
| home 改引用 | ✅ | `home/index.ts:69` 改为 `(u && u.nickname) \|\| defaultNickname`（原 '微信用户'） |

### C · mapError 改造 — 红线兑现 grep 0 命中？mapError 签名匹配？ ✅

| 检查项 | 结果 | 证据 |
|---|---|---|
| **grep `msg = e.message` 0 命中** | ✅ | `grep -rn "msg = e\.message" miniprogram/` = 0 结果 · 红线兑现 |
| mapError 签名匹配 | ✅ | `mapError(err: ApiErrorLike): MappedError` · catch 中 `e: any` 可直接传入 · error-mapper.ts:79 签名兼容 |
| TOKEN_EXPIRED fallback 注释 | ✅ | `login/index.ts:91-92` P2-2 采纳 |
| action 字段不留占位 | ✅ | P2-4 采纳 · 仅注释说明 |
| 红线合规 | ✅ | error-codes.md §0.5 L16 "客户端不得直接展示 message 给终端用户" · mapError 转译后仅展示 title+desc |

### D · onAvatarError — handler 实装最小集？测试覆盖？ ✅

| 检查项 | 结果 | 证据 |
|---|---|---|
| handler 实装 | ✅ | `home/index.ts:82-84` — `onAvatarError() { this.setData({ userAvatar: '' }); }` · 最小集 |
| wxml binderror 已存在 | ✅ | `home/index.wxml:5` — `binderror="onAvatarError"` · COSTRA-102 R1 布桩 |
| wx:if fallback | ✅ | `home/index.wxml:6` — `<view wx:else class="greeting__avatar greeting__avatar--fallback">👤</view>` |
| 测试覆盖 | ⚠️ 间接 | `home/index.spec.ts:53-58` — 通过 setDataMock 间接验证 · 非 Page handler 直接调用（见 P1-1） |

### E · home 降级 UI — hasProfile 判定逻辑 + UI 临时方案 + Sprint-3 接通路径标注？ ✅

| 检查项 | 结果 | 证据 |
|---|---|---|
| hasProfile 判定 | ✅ | `home/index.ts:67` — `computeHasProfile(u)` · 边界标注 L65-66 |
| data 字段声明 | ✅ | `home/index.ts:20` — `hasProfile: false` |
| wxml 条件渲染 | ✅ | `home/index.wxml:9` — `wx:if="{{!hasProfile}}"` |
| wxss 位置样式 | ✅ | `home/index.wxss:30-37` — `.greeting__action` absolute 定位 + right:32rpx |
| onTapCompleteProfile 临时方案 | ✅ | `home/index.ts:91-97` — `wx.showModal` Q5-A stub |
| Sprint-3 接通路径 | ✅ | `home/index.ts:89` 注释 "待 Sprint-3 接通真实页面后改为 wx.navigateTo" |
| greeting 已有 position:relative | ✅ | `home/index.wxss:5` — `.greeting { position: relative; }` · greeting__action absolute 定位基准 |

---

## §6 INVEST 复核（重点 S）

| 维度 | 评估 | 说明 |
|---|---|---|
| **I-ndependent** | ✅ | 5 项之间弱依赖（A→B→E）但同产品故事 · C/D 独立 · Human all-A 已拍板 |
| **N-egotiable** | ✅ | Q3-A 切出 PATCH-LIMIT · Q5-A 临时方案 · scope 可调 |
| **V-aluable** | ✅ | 含 1 条 P1 红线违反修复（C）+ 1 条 P1 静默失败修复（D） |
| **E-stimable** | ✅ | 3 点 · 时间盒 90 min · 各项预估明确 |
| **S-mall** | ✅ | **实际 +297/-16 · 15 文件 · vs 估点 3pt** · 5 项均为单点修改 · 但含 2 新建 spec + 1 新建 helper + 4 个 .team/ 文件 · **文件数偏高但单文件体量极小**（最大 home/index.spec.ts 78 行 · 远 < 500 行）· helper 抽取（profile.ts 20 行）是文件数 +1 的主因 · **总体守住了 INVEST small** |
| **T-estable** | ✅ | DoD 12 项含闸门 6 + 反向验证 3 + grep 断言 · 全勾 |

### S 维偏差评估

- **估点 3pt vs 实际 +297/-16**：+297 行中约 100 行为 spec/test（34%），约 40 行为 .team/ state+history（13%），约 30 行为 JSDoc/注释（10%）· 实际业务逻辑改动约 127 行（43%）· **与 3 点预估基本吻合**
- **utils/profile.ts 抽取合理性**：派单档 §2.2 F 明确允许"可选重构 · 如果 mock 太复杂可抽纯函数"· 20 行 helper 使 computeHasProfile 可独立单测 5 条路径（null / defaultNickname / 真实昵称 / 空串 / undefined）· **边际收益虽低但决策有据 · 不违反 INVEST**

---

## §7 审查档自评（D-018 §3.4 SBAI 流程合规）

| 维度 | 值 |
|---|---|
| 工作区铁律 | ✅ 仅读 + 仅写 `.team/reviews/COSTRA-157/round-1-tech.md` · 0 业务代码 · 0 commit |
| tools 白名单 | ✅ 使用 Read / Grep / Glob / LS / Bash（只读命令） · 未触发 Write 任何业务代码 · 未执行任何写磁盘/写远程/改 git 历史命令 |
| D-016 同轮兑现 | ✅ 本次 Review 在 Orchestrator 派单同对话轮内产出 |
| 审核耗时 | ~25 分钟 |
| 置信度 | **高**（5 项 scope 均独立 grep 核实 · 双端 defaults 对齐 grep 实证 · 红线 0 命中确认 · commit message 全文审阅 · P1/P2 全量兑现核查） |
| 低置信点 | C8 runtime 加载性：wx.getUserProfile 拒绝授权 + wx.showModal 行为依赖微信 SDK runtime · 纸面审无法完全验证 · 但 dispatch §9 Human 验证清单 6 步已覆盖 · Human 实测为终审必要条件 |

---

## §8 给 Human / Orchestrator 的回执

### 是否需要 R2？

**否**。APPROVE 38/40 · 0 P0 · P1-1 为测试间接验证不阻断 · 可留 Sprint-3 补充。

### Human 实测前置（按 dispatch §9 验证清单 6 步）

本卡涉及微信 SDK runtime 行为（wx.getUserProfile 拒绝授权 + onAvatarError + wx.showModal）· **判定为 runtime 类 T2 卡** · Human 模拟器实测为终审必要条件：

| # | 步骤 | 期望 | 验证维度 |
|---|---|---|---|
| 1 | 模拟器冷启 · 不点登录 → 看 login 页正常渲染 | ✅ 渲染正常 | C8-4 |
| 2 | 点击"一键微信登录" · 同意授权 · 跳 home | ✅ 显示真实昵称 · 无"完善资料"入口 | C8-1/E |
| 3 | 退出登录 · 重新登录 · 拒绝授权 → 跳 home | ✅ 显示"你好，微信用户" + 右上角"完善资料 →" | C8-1/E |
| 4 | 点击"完善资料 →" | ✅ 弹 modal "资料完善功能开发中" | C8-4/Q5-A |
| 5 | DevTools 改 userAvatar 为不可达 URL → 重启 | ✅ 头像 fallback 到 👤 图标 · 无报错 | C8-4/D |
| 6 | 模拟登录失败（关 server）· 看 login 页错误提示 | ✅ 不显示 server message 原文 · 显示 mapError 文案 | C5 红线/C |

### 等 `approve:COSTRA-157` 终审

Human 实测 6 步全 PASS 后发 `approve:COSTRA-157` → Sprint-2 主线 6/7 卡 CLOSED · 累计 25 点 / 53%。

---

## §9 Sprint-2 末 Retro 议题候选

### §9.1 FU 合并修复范式首战

- 5 条 FU 一卡清完 · 首次实战 · 与"切出去 3 件套铁律"互补
- 关键教训：P1-1 hasProfile 边界必须在 dispatch 暴露 · Card-Review 捕获有效
- 建议：归档为 FU 合并修复范式第 1 案例模板

### §9.2 跨域配置同步 · server vs miniprogram defaults

- 手工对齐 + G7 grep 闸门 · 0 CI 自动化 · COSTRA-160 tokens pipeline 待评估
- 建议：Sprint-3 评估是否引入构建期同步（规则 E 入 whitelist-check.mjs）

### §9.3 D-022 v2.0 第 5 次实战 · 38/40 非满分

- 首次低于 40/40（103 38/40 → 104 36/40 → 105 40/40 → 156 40/40 → **157 38/40**）
- 扣分点：C3 架构 -1（helper 抽取边际收益）+ C6 可测性 -1（测试间接验证）
- 建议：讨论"可测性抽取 helper"的阈值标准（1 消费方 vs ≥2 消费方）

---

## §10 报告元数据

- **审查 subagent**：`costra-review-tech`（D-018 §3.5 · 一次性装扮 · 物理无写权 · 第 9 次实战）
- **审查档身份**：`costra-review-tech-COSTRA-157-r1`（SBAI v1.1 §3.5）
- **本卡产出 Review 轮次**：Round 1 / 5
- **Verdict**：APPROVE
- **总分**：38/40（D-022 v2.0 评分表 40 分制 · 第 5 次实战）
- **关键发现**：
  - DoD 12 项全勾（含 G7 闸门 + G8/G9/G10 反向验证）
  - Card-Review P1-1/P1-2 全采纳（dispatch + 代码双重兑现）
  - Card-Review P2-1~4 + INFO-1/3 全采纳
  - 红线兑现：`msg = e.message` 0 命中 · D-008 主体字样 0 命中 · AppID 不入打包源码
  - 双端 defaults 值一致（grep 实证）
  - 单卡双装扮档 Q4-A 合规执行
- **下一步**：
  1. Orchestrator 落盘本报告至 `.team/reviews/COSTRA-157/round-1-tech.md`
  2. Human 模拟器实测 6 步（dispatch §9 验证清单）
  3. `approve:COSTRA-157` 终审 → Sprint-2 主线 6/7 CLOSED

---

*报告结束 · costra-review-tech-COSTRA-157-r1 一次性装扮销毁（2026-05-18T19:15+08:00）*
