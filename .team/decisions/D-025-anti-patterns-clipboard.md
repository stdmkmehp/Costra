# D-025 · 代码评审反模式清单（Anti-Patterns Clipboard）

> **立案时间**：2026-05-19 14:55（Sprint-2 末 Retro 议题候选 D.2 + D.3 沉淀 · COSTRA-158 dispatch §8 + review-tech R1 INFO 沉淀）
> **生效日期**：**2026-05-19**（随本决议落盘 · Sprint-3 起所有 Card-Review / R1 Review 套用）
> **关联**：D-014（Card-Review SOP）· D-022 v2.0（review-tech 评分矩阵）· D-024（Human 实测批量触发）
> **维护**：本档随实战增量追加 · 每条反模式必须含「事件溯源 / 反模式特征 / 好例对照 / 检测手段」四要素 · 不写抽象口号

---

## §0 立意：为什么需要反模式清单

> **历史教训**：COSTRA-157 R1 review-tech 38/40 APPROVE · 但 Human 在 R1 实装中发现的两类设计缺陷——（1）用 `nickname !== '微信用户'` 字符串代理推断"是否完成资料补全" / （2）用"概率极低"作为接受边界缺陷的理由——评分矩阵 D-022 v2.0 八维度（C1 契约 / C2 代码质量 / C3 架构 / C4 数据完整 / C5 安全 / C6 可测性 / C7 纪律 / C8 runtime / C10 SBAI 流程）**全维度都判 PASS** · 但实装本身存在反模式。

**根因**：D-022 v2.0 评分矩阵是「正向能力」检查表（"做得对吗？"）· 缺少「反向陷阱」检查表（"避开了已知错误模式吗？"）。

**D-025 定位**：在 Card-Review SOP §3 评分维度之外 · 增加 `§4 反模式扫描清单` 强制项 · 命中 ≥ 1 条 = 自动 P1（不阻 PASS · 但必须采纳修订）· 命中红字反模式 = 自动 REJECT。

**对照 D-022 v2.0**：D-022 评维度 · D-025 评模式（同一报告内交叉做）。

---

## §1 反模式清单（持续追加）

### AP-001 · 字符串代理判定（Proxy Judgment via String Comparison）🟡 P1

> **同义词**：代理判定 · 字符串撞库判断 · 隐含假设耦合

**事件溯源**：
- **2026-05-19 09:42** Human 否决 COSTRA-157 R1 dispatch §2.1 E 用 `u.nickname !== defaultNickname` 推断 hasProfile（Sprint-3 Epic-D 完善资料页落地前的过渡判定）
- 触发立 COSTRA-158（5 点 · /users/me 完整实装 + has_completed_profile 严格事实判定）

**反模式特征**：
- 用某字段的字符串值（昵称 / 备注 / type 字面量等）反推另一个语义事实（用户是否补完资料 / 操作是否成功 / 数据是否合法）
- 反推链条 ≥ 2 跳（A 字段 → 推论 → B 事实判定）
- 默认假设极少撞库 · 用「概率极低」自我安慰
- 字段语义不稳定（如默认昵称是 server config · 客户端 grep 字符串比较 · 升级 default 全链路同步成本极高）

**好例对照**：
```ts
// ❌ AP-001 反例（COSTRA-157 R1 旧实装）
return user.nickname !== '微信用户';  // 推断"是否完成资料补全"

// ✅ 好例（COSTRA-158 新实装）
return !!user.has_completed_profile;  // 严格事实字段判定
```

**判定原则**：
1. 用户语义事实 → 必须有 **显式布尔字段** 或 **显式状态枚举**
2. 字符串比较仅用于：白名单匹配（host / appid 等不变量）/ 类型路由（type === 'expense'）/ 错误码识别（不是错误内容）
3. 跨端一致性场景禁用代理判定（client / server 默认值升级路径不一致 · 字符串比较 100% 漂移）

**检测手段**：
- Card-Review 静态扫：grep `\.nickname\s*[!=]==\s*['"]` `\.username\s*[!=]==\s*['"]` `\.role\s*[!=]==\s*['"]`（业务字段字符串硬比较）
- 触发条件：dispatch / R1 实装代码中出现"判断 X 是否 Y"语句但没有显式 X.is_y / X.y_status / X.y_completed 字段

**Card-Review 套用条款**：命中 → 报告 §2 P1 · 维度 C5（风险/边界）+ AP-001 标注 · 修复建议 = 加显式事实字段（DB migration 加列）或 显式状态枚举

---

### AP-002 · 概率极低就接受（Probability Acceptance Fallacy）🟡 P1

> **同义词**：概率论说服 · 边界条件回避 · 鸵鸟边界处置

**事件溯源**：
- **2026-05-18 17:32** COSTRA-157 Card-Review R1 P1-2"hasProfile 边界条件"被产品 + 技术评审采纳为 PASS · 修订路径写"用户真名='微信用户'撞库概率极低 · 接受此边界缺陷"
- **2026-05-19 09:42** Human 实测前回看 dispatch · 否决"概率极低就接受"立 COSTRA-158

**反模式特征**：
- 用"用户不会这么巧" / "撞库概率 < 万分之一" / "MVP 阶段先这样" / "Sprint-N 再修"作为接受边界缺陷的理由
- 没有自动检测机制（出问题时无监控 / 无自愈）
- 没有数学证明（"概率"是直觉 · 非真概率分布）
- Sprint-N 修复路径没有具体卡号 / 没有 follow-up 登记 / 没有触发条件

**好例对照**：

❌ **AP-002 反例**（COSTRA-157 R1 dispatch §2.1 E 修订前）：
> "用户真名'微信用户'撞库概率极低 · 接受此边界缺陷 · 留 Sprint-3 Epic-D 完善资料页落地后改用 has_completed_profile 字段判定"

✅ **好例 1：消除边界**（COSTRA-158 路径）：
> "立 COSTRA-158 单卡 5 点 · DB 加 has_completed_profile 列 · server 实装 GET+PATCH /users/me · 字符串代理判定根因消除 · 同 Sprint 完成"

✅ **好例 2：自动检测兜底**（如真接受）：
> "接受边界 X · 但加 metrics counter `boundary_x_hit_total` + 告警阈值 N/小时 · 触发即立 follow-up · 监控落地 acceptance criterion"

✅ **好例 3：数学证明 + 监控双保险**（极少场景）：
> "事件 X 数学独立 · P(X)=1e-9（推导见附录）· 监控 metric counter / week · 触发立 P0"

**判定原则**：
1. 「概率极低」**只能**作为接受理由的**一部分** · 不能作为全部理由
2. 必须三选一：① 消除边界根因（首选） / ② 加自动检测+恢复 / ③ 数学证明 + 监控
3. 不能用「Sprint-N 再修」作为合法借口（Sprint-N 必须有卡号 + 触发条件 + 落 follow-up）

**检测手段**：
- Card-Review 静态扫 dispatch / 修订记录中出现："概率极低" / "撞库概率" / "极少触发" / "几乎不会发生" / "MVP 先这样" / "Sprint-N 再修"等字样
- 触发条件：本卡接受了已识别的边界缺陷 · 但未给「消除根因 / 自动检测 / 数学证明」三选一中任一

**Card-Review 套用条款**：命中 → 报告 §2 P1 · 维度 C5（风险/边界）+ AP-002 标注 · 修复建议 = 走三选一路径（推荐选 1 消除根因）

---

### AP-003 · 契约-实装漂移（Contract-Implementation Drift）🟡 P2 / 红字时升 P1

> **同义词**：OpenAPI 早定义但 server 没实装 / 协议先行变成纸面承诺

**事件溯源**：
- **2026-05-19 调研发现** COSTRA-101（2026-04-24）只交付 `/auth/wx-login` `/auth/refresh` `/auth/logout` 三端点 · 但 OpenAPI 当时已定义 `/users/me` GET + PATCH · server 从未实装
- 2026-05-01 COSTRA-123 收官时 Human 第 6 次模拟器实测 · console 看到 `404 + route not found: POST /v1/users/me` · 立 FU-COMMON-MINIAPP-PATCH-LIMIT · **误归因**为"wx.request 不支持 PATCH 走 X-HTTP-Method-Override 降级 · server 不识别该 header"
- 真相：server 路由根本不存在 · 即便 client 用真 PATCH 也会 404
- COSTRA-118 技术债普查（2026-04-24）也未发现该 gap
- 直到 COSTRA-158（2026-05-19）才补齐 · **延迟 3 周 + 1 次误归因 + 1 次 R1 review-tech 漏检**

**反模式特征**：
- OpenAPI / 协议文档 / DB schema 已定义 · 但 server 路由 / DB migration / repo 方法未实装
- 非阻塞型 · 因为 client 兜底 catch warn 吞错 · 所以 CI / 单测 / 真链路全绿
- 每次新卡评审都"按当前 dispatch 范围 PASS"· gap 永远没人发现
- 跨多个 Sprint 累积 · 越拖越大

**好例对照**：

❌ **AP-003 反例**：
- OpenAPI L629-654 定义 GET + PATCH /users/me
- server/src/routes/auth.ts 只挂了 3 个 auth 端点
- 1 个月没人发现

✅ **好例 1：CI 静态对账**（D-025 推荐路径）：
- 加 `scripts/devops/check-openapi-impl-coverage.mjs` · 静态扫 OpenAPI paths 与 fastify register 是否一一对应 · 缺失的 path 标 P2 follow-up · 与 COSTRA-156 whitelist-check.mjs 规则 D 范式一致 · 是规则 E 候选

✅ **好例 2：dispatch 模板加"切出去清单"**：
- COSTRA-104 R1 切出去 3 件套（PATCH /entries / DELETE /entries / GET /sync/pull）每条都有 owner_card 占位 + follow-up id + deferred_at + deferred_reason · 1 个月内全部立卡（COSTRA-152/153/154）

✅ **好例 3：x-deferred OpenAPI 标记**（已存在范式）：
- `server/api/openapi.yaml` GET /sync/pull 用 `x-deferred: { owner_card: COSTRA-154, followup_id: FU-104-SYNC-PULL, deferred_at: 2026-05-11 }` 显式标记 · stub handler 同步标 deferred_card 返 501

**判定原则**：
1. OpenAPI / 协议 / DB schema 定义 = **承诺** · server / client 必须等量交付 · 否则**显式 x-deferred 标记** + 立 follow-up
2. 非阻塞型 gap 不能成为 P3 永久积压理由 · 必须有 owner_card 占位 + Sprint 触发条件
3. CI 必须能扫出 OpenAPI - server register 漂移（候选规则 E）

**检测手段**：
- Card-Review 静态扫：本卡新增 / 修改 OpenAPI paths · 查 `server/src/app.ts` 是否同步 register · 查 stub 是否有 `x-deferred` 标记
- CI 候选：`check:openapi-impl-coverage`（whitelist-check.mjs 规则 E · Sprint-3 末 Retro 候选议题）

**Card-Review 套用条款**：命中 → 报告 §2 P2（如 dispatch 已含切出去 follow-up） / P1（如完全无标记 · 隐性 gap） · 维度 C1（契约对齐）+ AP-003 标注

---

### AP-004 · 红线红字反模式（占位 · 待沉淀实战）🔴 REJECT

> 当某反模式严重违反硬约束（如 D-008 主体策略 / 错误码红线 / 安全 secret 泄漏）· 升级为红字 · 命中 = Card-Review 自动 REJECT · 不进入 PASS-WITH-FOLLOWUP

**未来候选**（Sprint-3+ 沉淀）：
- AP-004-X 主体硬编码扩散（如代码层硬编码"上海"/"个人"/"企业"等主体字样 · D-008 已禁）
- AP-004-Y session_key / appsecret 直传 client（R-008 红线）
- AP-004-Z 错误响应直出 server message（error-codes.md §0.5 红线）

---

## §2 Card-Review SOP 套用条款

### §2.1 套用流程（D-014 + D-022 v2.0 增量）

Card-Review 报告必须在 §1（D-014-a §2.1 八维 checklist 对账）+ §2（问题清单）之外 · **新增 §4 反模式扫描清单**：

```markdown
## 4. 反模式扫描清单（D-025）

| ID | 反模式 | 命中？ | 证据 / 否决理由 |
|---|---|---|---|
| AP-001 | 字符串代理判定 | ☐ Yes / ☐ No | （证据或"未命中") |
| AP-002 | 概率极低就接受 | ☐ Yes / ☐ No | |
| AP-003 | 契约-实装漂移 | ☐ Yes / ☐ No | |
| AP-004-X | 红字反模式（如已立案） | ☐ Yes / ☐ No | |

**结论**：☐ 全部未命中 / ☐ 命中 N 条（升 P1 处置） / ☐ 命中红字（REJECT）
```

### §2.2 与 D-022 v2.0 评分的关系

- D-025 命中黄字 → 独立 P1 项 · 不冲抵 D-022 评分 · 但报告必须显式列入 §2 问题清单
- D-025 命中红字 → 自动 REJECT · 覆盖 D-022 评分（即使 40/40 也 REJECT）
- D-025 全未命中 → 报告标"反模式扫描 PASS"· 不加分（避免奖励"没犯错"）

### §2.3 review-tech R1 套用

- R1 Review 报告同样在 §2（问题清单）之外加 §5 反模式扫描清单（与 Card-Review §4 同表）
- 实装阶段才暴露的反模式（如 R1 commit diff 才发现的字符串代理）→ R1 Review 时打 P1 / REJECT
- R1 实装中 backend-dev / miniapp-dev 主动发现并规避反模式 → state.md history 标"D-025 反模式规避记录"·  Retro 时识别为正向贡献

---

## §3 维护规约

### §3.1 新增反模式条件

满足任一即可立新条目：
1. Human 实测发现已 APPROVE 的卡存在反模式（COSTRA-157→158 路径）
2. Sprint Retro 议题中识别为"重复出现 ≥ 2 次"的同类问题
3. 行业最佳实践 / 安全社区警示（如 OWASP / CWE 引用）
4. 项目内决策档（D-008 / D-009 等）红线衍生

### §3.2 升级 / 降级条件

- 黄字 P2 → P1：同模式实战命中 ≥ 2 次（D-025 §1 事件溯源段累积）
- P1 → 红字 REJECT：同模式实战命中 ≥ 3 次 或 触发严重缺陷（如安全事故 / 用户数据丢失）
- 红字 → 黄字：CI 静态规则落地 + 6 个月零命中（机制兜底替代人工扫描）

### §3.3 删除条件（高门槛）

反模式条目原则上 **只增不删** · 历史教训不可清空。例外：
- 反模式被语言 / 框架 / 协议演进物理消除（如 ES2022 后某 API 不可用）
- Sprint Retro 议决"该模式不适用本项目语境"（需 Human 拍板）

### §3.4 与 self-improving 集成

- 触发条件：Human 纠正 / 项目反模式累积 / 跨卡漏检 → 走 self-improving SOP 加条目
- 落档位置：本档 §1 列表追加（不另起新档）

---

## §4 历史溯源（Sprint-2 末沉淀的 3 条）

| ID | 立案日期 | 触发卡 / 事件 | 立案理由 |
|---|---|---|---|
| AP-001 字符串代理判定 | 2026-05-19 | COSTRA-157 R1 P1-2 边界 → COSTRA-158 严格判定 | Human 否决"用 nickname !== default 推断 hasProfile" |
| AP-002 概率极低就接受 | 2026-05-19 | 同 AP-001 触发链 | Human 否决"撞库概率极低 + Sprint-N 再修"双重借口 |
| AP-003 契约-实装漂移 | 2026-05-19 | COSTRA-101→158 调研发现 /users/me 1 个月 gap | OpenAPI 早定义 server 没实装 · 直到 COSTRA-158 补齐 |

---

## §5 修订记录

| 版本 | 时间 | 修订 |
|---|---|---|
| v1.0 | 2026-05-19 14:55 | 初版立案 · 沉淀 AP-001/002/003 三条 · Sprint-3 起 Card-Review / R1 Review 强制套用 |

---

**事实源 / 依据**：

- COSTRA-157 dispatch §2.1 E（边界判定原文）：`.team/dispatch/COSTRA-157-user-profile-completion-and-login-resilience.md`
- COSTRA-157 Card-Review R1 P1-2（接受边界的修订）：`.team/reviews/COSTRA-157/...`
- COSTRA-158 dispatch §1.1 三段触发链 + §8 Retro 议题候选：`.team/dispatch/COSTRA-158-users-me-and-has-completed-profile.md`
- COSTRA-158 Card-Review R1 P1+P2 全采纳记录：`.team/reviews/COSTRA-158/card-review-round-1-tech.md`
- 关联决策：D-014 / D-016 / D-018 / D-022 v2.0 / D-024
- self-improving 集成路径：`.codebuddy/skills/self-improving-agent/`（如启用）
