# Card Review · Tech · COSTRA-158 · Round 1

- 卡 Owner：backend-dev + miniapp-dev
- 卡类型：feat
- 卡 points：5
- 审核时间：2026-05-19T10:15+08:00
- 上轮结论：首轮

---

## 0. 结论速览

- **评分**：27/30
- **等级**：PASS
- **三档判定线**：≥ 27 PASS · 24-26 PASS-WITH-FOLLOWUP · < 24 REVISE
- **关键问题数**：0 P0 / 2 P1 / 3 P2 / 3 INFO

---

## 1. D-014-a §2.1 checklist 对账（C1~C8 八维 · 每维评分）

| # | 项 | 评分 | 证据 |
|---|---|---|---|
| C1 | 标题/描述清晰、无歧义（满分 5）| 5/5 | 标题"/users/me 完整实装 + has_completed_profile 严格资料判定"41 字符 ≤ 60 · 三要素齐全（§1 背景三段链 / 目标：严格替代概率近似判定 / 范围：11 项 scope）· 术语 has_completed_profile 与 157 dispatch "Sprint-3 改用 user.has_completed_profile 显式标记"一致 · 无新造概念 |
| C2 | 验收标准（DoD）可度量（满分 6）| 5/6 | §3 DoD 18 项含闸门 9 条（G1~G9 均可自动判定：typecheck/lint/test/check 命令 + grep 计数 + psql 验证）+ 反向验证 3 条（G10/G11 临时改代码验回归 + G12 E2E mock）+ 协议对账 2 条（G13/G14 grep 验证）· 扣 1 分：G12 "mock 模式下 login → home 页不显示完善资料入口"为人工视觉判定 · 无自动断言 · 但 mock 模式下无 server 端 · 可接受 |
| C3 | 依赖识别（满分 5）| 5/5 | dispatch 首行 4 条上游依赖（COSTRA-101/104/156/157 全 CLOSED）· 下游解锁 3 条（FU-COMMON-MINIAPP-PATCH-LIMIT + COSTRA-401 + Sprint-3 Epic-D）· 数据依赖显式（D-008 主体策略无关 · OpenAPI 契约锚点行号精确）· 决策依赖（Human 2026-05-19 09:42 否决 + 09:44 D-recommended）|
| C4 | 产出物具体（满分 5）| 5/5 | 11 项 scope 全部含具体文件路径 + 行号 + 函数签名 + SQL 语句 + 接口 URL（GET/PATCH /users/me）· userRepo.updateProfile 参数化 SQL + 入参接口 UpdateProfileInput 完整 · routes/users.ts 注册函数签名 registerUsersRoutes(app: FastifyInstance) · app.ts 2 行改动精确到 import + register 位置 · 单测 8 条用例表格逐一列期望 · 无"做个组件"类模糊措辞 |
| C5 | 风险/边界（满分 4）| 3/4 | 标注了：has_completed_profile 单调性（一旦 TRUE 不可降级 FALSE · §2.1 B 注释）· 软删用户禁止更新（WHERE deleted_at IS NULL）· 不做 backfill 决策及理由（< 10 用户）· K3 兜底三个选项分析 · 扣 1 分：未标注 DB migration 对运行中 server 的影响（ALTER TABLE 加列 DEFAULT FALSE 在 PostgreSQL 需全表 rewrite · < 10 行无影响 · 但应明示）· 未标注 GET /users/me 实装后 client 是否应从 TokenRaw.user 切换为调 GET /users/me（当前 hydrateUser 直接从 token 取 · 不调 GET · 但实装后出现两条获取用户信息路径 · 应明示 client 消费策略）|
| C6 | 是否与已有卡重复/冲突（满分 3）| 3/3 | backlog.json 中 COSTRA-158 为新卡 · 无重复 · board.md 仅有 157（前置 · Doing）· FU-102-PROFILE-REFUSE-UI reopened-scoped 到 158 · FU-COMMON-MINIAPP-PATCH-LIMIT reopened-scoped 到 158 · 无冲突 |
| C7 | 估点合理性（满分 2）| 1/2 | 5 点落在 1~8 区间 ✅ · 对照历史类似卡：COSTRA-101（auth 三端点 · 5pt · 含 wx code2Session 全链路）vs 158（/users/me GET+PATCH+K3+DB migration+单测+miniapp 改动 · 5pt）· 时间盒 195min+15min 缓冲=210min 合理 · 扣 1 分：11 项 scope 是项目史上最多单卡 scope 数（157 仅 5 项/3pt · 104 7pt 但含 3 件套 stub · 156 2pt/2 项）· 虽单点修改密度高 · 但跨 server+miniapp 双域 + DB migration + K3 新决策 + 2 个 spec 修改 + 3 条 FU 关闭 · 风险面偏大 · 5pt 处于"可接受但偏紧"区间 |
| C8 | 红线检查（满分 3）| 0/3 (Pass) | 逐项扫描：(1) Won't-Have 违反？❌ 无支付/虚拟支付/企业认证 · has_completed_profile 是中性字段 · (2) 硬编码 secret？❌ 无 · (3) 主体字样硬编码？❌ has_completed_profile 无主体关联 · D-008 §1 "代码层面禁止硬编码主体信息" · 158 改动全部为用户画像功能 · grep dispatch 0 主体字样命中 · (4) 目录越权？❌ server 改动由 backend-dev · miniapp 改动由 miniapp-dev · 工作区铁律 §5.1 精确列可写清单 · (5) engineering-guidelines 强硬规则违反？❌ 单卡单 commit（§2.1 D-012）· commit footer 卡号（§2.2）· 全遵守 · **C8 = Pass（无否决）** |

**总分 = 5+5+5+5+3+3+1+0(无否决加分) = 27/30**

> 注：C8 是否决项 · 命中 = REJECT · 未命中不加分 · 按评分惯例 C8 未命中 = 满分 0 扣分 · 总分 = C1~C7 之和 = 27

---

## 2. 问题清单（按 P0 → P1 → P2 → INFO 排）

### P0：0 项 ✅

### P1：2 项

#### P1-1 · dispatch 未明示 client 消费策略：实装 GET /users/me 后 hydrateUser 是否应从 TokenRaw.user 切换？

- **维度**：C5 风险/边界
- **证据**：`miniprogram/pages/home/index.ts:61-73` hydrateUser 当前从 `tk?.raw?.user` 取用户信息 · 不调 GET /users/me · 158 实装后 server GET /users/me 可返回最新用户信息 · 但 dispatch §2.1 D 仅描述 server 端实装 · 未明示 client 是否应改为调 GET /users/me · 导致两条获取路径并存（token 内嵌 vs 独立 GET）· 潜在数据不一致（用户 PATCH 后 token 内 user 未刷新 · GET 可获取最新值）
- **问题**：COSTRA-157 的 hydrateUser 注释已写"Sprint-3 Epic-D 落地后改用 user.has_completed_profile 显式标记"· 158 实装后 token 内的 user 已含 has_completed_profile · client 不需调 GET /users/me 即可获取 · 但 PATCH /users/me 成功后 token 内 user 不会自动刷新（除非重新 login/refresh）· 这是否是设计意图？dispatch 未讨论此场景
- **依据**：SOP-CARD-REVIEW §3 C5 "已知的未知项是否暴露"
- **修复建议**：dispatch §2.1 D 或 §5 补一段"client 消费策略"说明：(1) 首登/refresh 时 token 内 user.has_completed_profile 由 server toUserView 返回 · (2) PATCH /users/me 成功后 client 应更新本地 TokenRaw.user（或触发 refresh）以同步 has_completed_profile 变更 · (3) 若 MVP 接受"PATCH 后不刷新 token user · 用户下次 login/refresh 才同步" · 需显式标注 · 预估 2 行说明

#### P1-2 · 11 项 scope 数量偏多 · INVEST small 边界承压 · 缺拆卡损益分析

- **维度**：C7 估点合理性
- **证据**：dispatch §2 Scope 标题"11 项 · 估点 5 · INVEST small 上限内"· 项目历史最多 scope 单卡：157（5 项/3pt）· 104（6 项/7pt 含 stub）· 158 的 11 项跨 DB+server+miniapp 三层 + K3 新决策 + 3 条 FU 关闭 · 5pt 对应 210min 时间盒 · 但 K3 兜底子决策可能额外消耗 30~60min（需 miniapp-dev 与 backend-dev 协作判定）
- **问题**：dispatch §4.2 INVEST 复核段缺"拆卡损益分析"· §5.2 仅写"若实装中发现 scope 超 5 点 → 触发 D-017 §2.4"· 但未分析 158a（DB+server）vs 158b（miniapp）拆卡的损益
- **依据**：SOP-CARD-REVIEW §3 C7 "不是显著低估"· INVEST S 维度
- **修复建议**：dispatch §5.2 补一段拆卡损益分析（3~5 行）：拆为 158a（A~G' 8 项 server · 3pt · 独立可验证）+ 158b（H~K 3 项 miniapp · 2pt · 依赖 158a）· 损益：拆卡增加 1 次 Review 循环（+30min）+ 1 次 commit + state.md 更新 · 益处：server 段可独立跑闸门 · K3 决策可集中 · 但 158a 的 authService.toUserView 改动会同时影响 client token · 拆后 158b 需等 158a CLOSED 才能做 · Sprint-2 时间紧 · 结论：不拆合理（双域耦合度高 · 拆卡收益 < 时间成本）· 但需明示此判断

### P2：3 项

#### P2-1 · G9 闸门"DB migration 幂等"测试方法不精确

- **维度**：C2 DoD 可度量
- **证据**：dispatch §3.2 G9 写"psql -c 'ALTER TABLE users ADD COLUMN IF NOT EXISTS has_completed_profile BOOLEAN...' 等价测试 · 用 \d users 验证列存在"· 但实际 migration 文件用的是 `ALTER TABLE users ADD COLUMN has_completed_profile BOOLEAN NOT NULL DEFAULT FALSE`（无 IF NOT EXISTS）· 重复执行会报错 "column already exists"· 这与 migration 文件的 BEGIN/COMMIT 事务语义一致（重复跑 = 报错 = 非幂等）· G9 描述与实际 SQL 不匹配
- **问题**：G9 的"等价测试"暗示用户应该用 IF NOT EXISTS 版本测试 · 但实际 migration 不含 IF NOT EXISTS · 需要明确 G9 的真实验证方式
- **依据**：SOP-CARD-REVIEW §3 C2 "可自动化判定"
- **修复建议**：G9 改为"migration 只跑一次（via migration runner）· 用 `\d users` 验证 has_completed_profile 列存在 + DEFAULT FALSE + NOT NULL"· 或在 migration SQL 加 `IF NOT EXISTS`（PostgreSQL 9.6+ 支持 ALTER TABLE ADD COLUMN IF NOT EXISTS）使其真幂等 · 后者更安全

#### P2-2 · K3 兜底 POST handler 的 OpenAPI 缺失 + 未来 entries PATCH 复用路径未讨论

- **维度**：C5 风险/边界
- **证据**：dispatch §2.2 协议对齐写"POST /users/me 不在 OpenAPI 声明（保持 OpenAPI 纯净）"· 但 COSTRA-152（PATCH /entries/{id}）未来也需要同样的 X-HTTP-Method-Override 兼容 · 若 K3 只在 users 路由内做 · entries 路由需重复实现
- **问题**：K3 的"最小作用域"决策在当前卡合理 · 但未标注"未来 COSTRA-152 是否需要升级为 K1 全局 middleware"· 这是一个已知的未知项 · 应在 dispatch 显式标注
- **依据**：SOP-CARD-REVIEW §3 C5 "已知的未知项是否暴露"
- **修复建议**：dispatch §5.3 或 §2.1 K 项末尾补一句"已知未知：COSTRA-152 PATCH /entries 实装时需决策是否将 K3 升级为 K1 全局 middleware · 留 follow-up 不阻本卡"

#### P2-3 · mockExchange 设 has_completed_profile=true 的合理性应更明确

- **维度**：C5 风险/边界
- **证据**：dispatch §2.1 H 写 mockExchange 设 `has_completed_profile: true`（"避免 mock 模式下 home 页常显'完善资料'入口"）· 但 mock 模式下 server 根本不存在 · has_completed_profile 值只影响 UI 展示 · 设为 true 意味着 mock 模式下永远不会显示"完善资料"入口 · 这使得 G12 反向验证（"mock 模式下 login → home 页不显示完善资料入口"）变成了同义反复
- **问题**：mock 模式下 has_completed_profile=true 是合理的工程选择（避免 mock 模式下出现干扰性 UI）· 但应显式标注"mock 模式下无法验证 has_completed_profile=false 的 UI 路径 · 该路径由 Human 实测覆盖（dispatch §9 步骤 2）"
- **依据**：SOP-CARD-REVIEW §3 C5
- **修复建议**：dispatch §2.1 H 补一句注释"mock 模式 has_completed_profile=true · 因此 mock 下无法验证'完善资料'入口显示 · 该路径由 §9 步骤 2（has_completed_profile=false 首登场景）Human 实测覆盖"

### INFO：3 项

#### INFO-1 · §8 Retro 议题"契约-实装 gap 防漏检"建议与 COSTRA-156 whitelist-check 规则 E 对齐

- **维度**：C4 产出物具体
- **说明**：dispatch §8 提出 CI 加 `check:openapi-impl-coverage` 脚本 · 与 COSTRA-156 已落的 whitelist-check.mjs 规则 D（fastify prefix vs OpenAPI servers 一致性）互补 · 建议议入 Sprint-2 末 Retro 时明确：规则 E 候选 = openapi paths vs fastify register 一一对应 · 与规则 D 同属 whitelist-check.mjs 扩展

#### INFO-2 · commit message 中 "closes: fu-102-profile-refuse-ui boundary risk" 应确认与 157 的关系

- **维度**：C6 去重
- **说明**：FU-102-PROFILE-REFUSE-UI 在 follow-ups README 中标注为 reopened-scoped 到 158 · 但 157 已闭合了部分（Q1-A 占位头像 + 欢迎 + 完善资料临时入口）· 158 的 closes 应写"闭合 boundary risk 子项"而非整条 FU · 建议实装时 commit body 精确描述关闭的子项

#### INFO-3 · §9 Human 验证清单步骤 6 极端场景依赖 DevTools 手动改 storage

- **维度**：C2 DoD 可度量
- **说明**：步骤 6 "DevTools 改 storage user.nickname 为 '微信用户' · 但 has_completed_profile 保持 true · 重启"验证的是"严格判定不受 nickname 撞库影响"· 这正好是 Human 2026-05-19 09:42 否决的边界 · 验证价值高 · 但依赖手动改 storage · 无法自动化 · 作为 Human 实测项可接受

---

## 3. 11 项 Scope 子项专项核查

### A · DB migration（幂等性 / backfill 决策合理性 / COMMENT 完整性）

| 检查项 | 结果 | 证据/说明 |
|---|---|---|
| 幂等性 | ⚠️ 部分问题 | SQL 用 `ALTER TABLE ADD COLUMN`（无 IF NOT EXISTS）· 重复执行报错 · 但 migration runner 通常保证只跑一次 · 实务可接受 · 但 G9 描述与实际 SQL 不匹配（见 P2-1）|
| backfill 决策 | ✅ 合理 | "< 10 用户 · 让用户重新点'完善资料'自然修复"· dispatch §2.1 A 显式标注 · 与 MVP 规模匹配 · 但未讨论用户困惑（见 §6 关键技术决策评议）|
| COMMENT 完整性 | ✅ 优秀 | COMMENT ON COLUMN 三段描述（来源/用途/语义优势）· 超出项目既有 COMMENT 水准（0001_init.sql 无 COMMENT）|

**结论**：A 项合格 · P2-1 需修复 G9 描述

### B · userRepo updateProfile（三态语义 / 乐观锁 / 单调性）

| 检查项 | 结果 | 证据/说明 |
|---|---|---|
| undefined/value/null 三态 | ✅ 精确 | 双参数 + CASE 表达式区分"不传=COALESCE 兜底" / "传非空=更新" / "传 null=清空"· avatar_url 三态实现正确 · 特别说明 §2.1 B 行末注释清晰 |
| 乐观锁 version | ✅ | `version = version + 1` 与 COSTRA-104 entryService 范式一致 · WHERE 无 version 条件（与 104 的 WHERE version=$n 不同）· 这是合理的——updateProfile 不暴露 version 给 client · 用 WHERE id=$1 AND deleted_at IS NULL 即可 |
| has_completed_profile 单调性 | ✅ | SQL 直接 `has_completed_profile = TRUE` · 一旦 TRUE 不可降级 · dispatch §2.1 B 行为约定第 4 条显式声明 · 但 SQL 层面无 CHECK 约束防止未来代码误写 FALSE · 建议 R1 实装时在 COMMENT 中标注单调性约束 |
| 软删用户禁止更新 | ✅ | WHERE deleted_at IS NULL |

**结论**：B 项设计精良 · 三态语义是全 dispatch 最复杂的技术点 · 实现正确

### C · authService.toUserView 改字段（接口稳定性 / 消费方影响）

| 检查项 | 结果 | 证据/说明 |
|---|---|---|
| AuthTokenPair.user 加字段 | ✅ 非破坏性 | 新增 `has_completed_profile: boolean` · 不删不改现有字段 · TS 接口扩展兼容 |
| toUserView 入参/返回加字段 | ✅ | 入参加 `hasCompletedProfile: boolean` · 返回加 `has_completed_profile` 映射 · 5 行内 |
| 消费方影响 | ⚠️ 需注意 | client TokenRaw.user 需同步加字段（H 项）· authService 的 wxLogin/refresh 返回值自动含新字段 · 但 **现有 auth.test.ts T1 断言不检查 user 子对象完整性**（仅检查 `body.user.id` + `body.user.nickname`）· G' 项补 `has_completed_profile=false` 断言可弥补 |

**结论**：C 项非破坏性扩展 · 需 H 项同步 · 已在 G' 覆盖

### D · 新建 routes/users.ts（auth middleware / schema validation / K3 位置）

| 检查项 | 结果 | 证据/说明 |
|---|---|---|
| auth middleware 调用方式 | ✅ | 参照 entries.ts 的 `parseUserId` 模式（jwtVerify + claims.sub）· dispatch §2.1 D 写"走 app.requireAuth 或 verifyAccessToken 自验证"· 实装时应选一种 · 建议复用 entries.ts 的 parseUserId 模式（已验证可用）|
| schema validation | ✅ | Fastify JSON Schema · nickname maxLength 32 / avatar_url uri / timezone string · 至少 1 字段非空（400 INVALID_ARGUMENT）· 与 OpenAPI PATCH body schema 对齐 |
| K3 兜底位置 | ✅ | 在 users 路由内 POST handler · 识别 X-HTTP-Method-Override: PATCH 后委托 PATCH handler · 作用域最小 · 不影响全局 |

**结论**：D 项设计合理 · 实装时注意 parseUserId 复用

### E · app.ts 注册（v1 prefix 顺序 / COSTRA-156 范式遵守）

| 检查项 | 结果 | 证据/说明 |
|---|---|---|
| v1 子作用域 | ✅ | `await registerUsersRoutes(v1)` 在 entries/sync 之后 · 与 COSTRA-156 范式一致 |
| import 顺序 | ✅ | 按字母序 · 与现有 auth/entries/healthz/legal/sync import 风格一致 |
| 2 行改动 | ✅ | import + register · 极简 |

**结论**：E 项无风险

### F · OpenAPI User schema 改字段（required 追加 / 消费方兼容性）

| 检查项 | 结果 | 证据/说明 |
|---|---|---|
| required 数组追加 | ⚠️ 需注意 | 当前 required=[id, nickname, created_at] · 追加 has_completed_profile 后=[id, nickname, has_completed_profile, created_at] · 新增 required 字段对**现有消费方**是破坏性变更（旧 client 不期望此字段）· 但 MVP < 10 用户 + client 同步改（H 项）· 实务可接受 |
| 字段位置 | ✅ | has_completed_profile 放在 timezone 和 created_at 之间 · 合理 |
| nullable | ✅ | type: boolean · 不 nullable · 与 DB NOT NULL DEFAULT FALSE 一致 |

**结论**：F 项 required 追加对现有消费方理论上是 breaking change · 但 MVP 阶段可接受 · client 同步改

### G · server 单测 ≥ 8 测（K3 兼容测 / 反向验证 G10/G11）

| 检查项 | 结果 | 证据/说明 |
|---|---|---|
| 8 测用例 | ✅ | 表格列出 8 条 · 覆盖 401/200/400 路径 + has_completed_profile 状态变化 + avatar_url 清空 + nickname 超长 |
| K3 兼容测 | ⚠️ 未列入 8 测 | dispatch §3.1 G 写"含 K3 POST + Method-Override 兼容测"· 但 §2.1 G 的 8 测表格未列出 K3 兼容测 · 应补为第 9 测或明确含在测 5/6/7 中 |
| 反向验证 G10/G11 | ✅ | §3.3 反向验证 3 条 · G10 改 has_completed_profile=FALSE 验测 FAIL · G11 改 computeHasProfile 回旧逻辑验测 FAIL · 设计精良 |

**结论**：G 项用例覆盖充分 · K3 兼容测应在 8 测表格中显式列出

### G' · auth.test.ts 修订（不破坏既有断言）

| 检查项 | 结果 | 证据/说明 |
|---|---|---|
| 既有断言不受影响 | ✅ | 仅在 T1 wxLogin 200 断言追加 `user.has_completed_profile === false` · 不改现有断言 |
| 首登 has_completed_profile=false | ✅ | 首登用户 DB DEFAULT FALSE · toUserView 映射正确 |

**结论**：G' 项 1 行改动 · 低风险

### H · miniprogram TokenRaw + mockExchange（mock 用户 has_completed_profile=true 合理性）

| 检查项 | 结果 | 证据/说明 |
|---|---|---|
| TokenRaw.user 加字段 | ✅ | 新增 `has_completed_profile: boolean` · 非破坏性扩展 |
| mockExchange 加字段 | ✅ | `has_completed_profile: true` · 避免 mock 模式下显示"完善资料"入口 · 合理 · 但需标注覆盖缺口（见 P2-3）|

**结论**：H 项合格 · P2-3 建议补注释

### I · computeHasProfile 严格判定（接口签名变化 / 旧测试是否失效）

| 检查项 | 结果 | 证据/说明 |
|---|---|---|
| 接口签名变化 | ✅ | UserLike 从 `{ nickname?: string }` 改为 `{ has_completed_profile?: boolean }` · 旧消费方传 `{ nickname: '张三' }` 不再正确 · 但唯一消费方 hydrateUser 传的是 `tk?.raw?.user`（已有 has_completed_profile 字段）· 不会有运行时问题 |
| 旧测试失效 | ✅ | home.spec.ts 中 `nickname === defaultNickname → hasProfile=false` 用例需删除 · dispatch §2.1 J 已标注 · 新用例覆盖 has_completed_profile=true/false |
| 可选字段设计 | ✅ | `has_completed_profile?: boolean` + `return !!(u && u.has_completed_profile)` · 缺失时默认 false · 向后兼容 |

**结论**：I 项设计正确 · 接口签名变化由 J 项测试更新覆盖

### J · home.spec.ts 修订（边界用例删除 / 新用例覆盖度）

| 检查项 | 结果 | 证据/说明 |
|---|---|---|
| 删除边界用例 | ✅ | "nickname === defaultNickname → hasProfile=false"将被删 · 此用例是 157 的 P1-1 边界标注产物 · 158 用严格判定替代后该用例语义不再存在 |
| 新用例覆盖 | ✅ | has_completed_profile=true → true · has_completed_profile=false/缺失 → false · 覆盖了 157 的边界用例场景 · 且更严格 |
| 净改 ~5 行 | ✅ | 删 1 加 2 · 极简 |

**结论**：J 项合理

### K · K3 method-override 兜底（作用域 / 实现位置 / 与 K1 取舍）

| 检查项 | 结果 | 证据/说明 |
|---|---|---|
| 作用域 | ✅ | 仅 users 路由 · 不全局 |
| 实现位置 | ✅ | routes/users.ts 内 POST /users/me handler · 识别 X-HTTP-Method-Override: PATCH 后委托 PATCH handler |
| 与 K1 取舍 | ⚠️ 已讨论但不完整 | dispatch §2.1 K 列出 K1/K2/K3 三选项 · 推荐 K3 · 但未讨论 K1 的未来扩展性（COSTRA-152 entries PATCH 也需要）· 见 P2-2 |

**结论**：K 项当前决策合理 · P2-2 建议补"已知未知"标注

---

## 4. INVEST 复核

### 重点 S（small）评估

| 维度 | 评估 | 说明 |
|---|---|---|
| **I-ndependent** | ✅ | 11 项之间有顺序依赖（A→B→C→D→E / H→I→J / K 依赖 D）· 但同产品故事 · 不可拆为独立卡 |
| **N-egotiable** | ✅ | K 三选一 · 158 不做 backfill · 可调 |
| **V-aluable** | ✅ | 修复 COSTRA-101 遗留 gap + Human 否决的严格判定 + 顺手关 FU-COMMON-MINIAPP-PATCH-LIMIT · 三重价值 |
| **E-stimable** | ⚠️ 偏紧 | 210min 时间盒 · 11 项 · K3 子决策可能额外 30~60min · 但 D-017 §2.4 有溢出保护 |
| **S-mall** | ⚠️ 边界承压 | 11 项是项目史上最多 · 但单点修改密度高 · 无新业务逻辑发明 · 现有范式齐全 · 5pt 处于"勉强 small"区间 |
| **T-estable** | ✅ | DoD 18 项含闸门 9 + 反向验证 3 + 协议对账 2 + 人力验收 4 |

### 拆卡可能分析

**方案 158a（DB+server）+ 158b（miniapp）**：

- 158a：A~G' 8 项 · 3pt · 独立可验证（server 单测 + 闸门）
- 158b：H~K 3 项 · 2pt · 依赖 158a CLOSED

**拆卡损益**：
- 损：+1 次 Review 循环（~30min）· +1 次 commit · 158a 的 authService.toUserView 改动使 client token 结构变化 · 158b 必须等 158a CLOSED 才能做 · Sprint-2 时间紧
- 益：server 段可独立跑闸门 · K3 决策可集中 · miniapp 段更纯粹
- **结论**：不拆更优 · 双域耦合度高（C 项 authService 改动同时影响 client）· 拆卡时间成本 > 收益 · 但 dispatch 应明示此判断（P1-2）

### 项目历史教训

- COSTRA-128（8pt · 起源超大卡）→ 拆为 127/128/129 三卡
- COSTRA-104（7pt · entries CRUD）→ 切出去 3 件套 stub
- 158 的 5pt / 11 项 · 与 104 的 7pt / 6 项相比 · scope 密度更高但单点更小 · 总量仍在 INVEST small 边界内

---

## 5. 与 D-022 v2.0 评分表的预对账（R1 Review 时使用）

| 维度 | 满分 | R1 风险预测 |
|---|---|---|
| C1 契约对齐 | 5 | 低风险 · OpenAPI User schema 加字段 + PATCH body 已定义 · K3 POST 不在 OpenAPI 声明需说明 |
| C2 代码质量 | 5 | 中风险 · B 项三态 SQL 是最复杂点 · 需确保 CASE 表达式在 null 传递时行为正确 |
| C3 架构合理 | 5 | 低风险 · repo/service/route 三层清晰 · K3 局部兜底合理 |
| C4 数据完整 | 5 | 低风险 · has_completed_profile 单调性 + DEFAULT FALSE + 不 backfill 决策记录完整 |
| C5 安全 | 5 | 低风险 · auth middleware + body schema 校验 + 不信任 client userId · X-HTTP-Method-Override 仅 users 路由识别 |
| C6 可测性 | 5 | 中风险 · users.test.ts ≥ 8 测 + K3 兼容测 + auth.test.ts 修订 + home.spec.ts 修订 + 反向验证 G10/G11 · 覆盖度高 · 但 K3 兼容测未在用例表显式列出 |
| C7 纪律 | 5 | 中风险 · INVEST small 5pt vs 11 项 scope 是关注点 · D-016 同轮 + D-018 双装扮档单 commit |
| C8 runtime 加载性 | 5 | 中风险 · 涉及 wx.request POST+Method-Override runtime 行为 · dispatch §9 Human 验证清单 6 步覆盖 · 属 runtime 类 T2 卡 |
| C9 性能 | 0 N/A | 不适用 |
| C10 SBAI 流程合规 | 5 | 低风险 · 双装扮档 · 工作区铁律精确 · history 5 段齐全 |

**最高风险维度**：C2 代码质量（三态 SQL）+ C8 runtime 加载性（Method-Override）

---

## 6. 关键技术决策评议（不影响 Card-Review 评分 · 但提供给 Orchestrator + Human）

### K3 vs K1 vs K2 兜底选择

**dispatch 推荐 K3**：仅在 users 路由内识别 X-HTTP-Method-Override · 不全局。

**评审意见**：K3 在当前卡合理 · 但 COSTRA-152（PATCH /entries/{id}）未来也需要同样的兼容 · 届时需在 entries 路由内再实现一遍 K3 逻辑 · 或升级为 K1 全局 middleware。

**建议**：当前走 K3 · 在 dispatch §5.3 补"已知未知：COSTRA-152 是否需升级为 K1"· Sprint-2 末 Retro 时评估 K3→K1 升级时机 · 不阻本卡

### avatar_url 三态语义（undefined/value/null）

**dispatch 实现**：CASE WHEN + 双参数（$3=value + $4=isExplicitNull flag）。

**评审意见**：这是 SQL 层面处理三态语义的成熟模式 · 不是过度复杂 · 替代方案（如 JSONB merge / 多次 SQL）更复杂 · 当前实现是最小集。

**唯一关注**：参数数组 `[userId, nickname, avatarUrl, avatarUrl===null, timezone]` 中 `$4::BOOLEAN` 的类型转换 · PostgreSQL 需要显式类型标注 · dispatch SQL 已写 `$4::BOOLEAN` · 正确

### has_completed_profile 单调性（一旦 true 不可降级 false）

**dispatch 声明**：§2.1 B 行为约定第 4 条"has_completed_profile 一旦 TRUE 不可降级回 FALSE"。

**评审意见**：单调性设计合理 · 避免了"用户清空头像后 has_completed_profile 降回 false → 显示完善资料入口 → 用户困惑"的场景。

**何时需打破**：
1. 管理员手动重置（如用户被社工 · 需重走资料补全流程）
2. 主体切换后资料失效（D-008 主体变更可能导致昵称/头像需要重新确认）

**建议**：当前 MVP 无 admin 接口 · 单调性不阻 · 留 follow-up："admin 手动重置 has_completed_profile 接口 · 等 Epic-D 完善资料页落地后评估 · 不阻本卡" · dispatch 不需改 · 但 R1 实装时建议在 SQL COMMENT 中标注单调性约束

### 不做 backfill 决策

**dispatch 决策**：< 10 用户 · 让用户重新点"完善资料"自然修复。

**评审意见**：MVP 阶段合理 · 但有用户困惑场景："我之前补过资料（COSTRA-157 已 PATCH 过昵称/头像）· 但 has_completed_profile=false（因为是新列 · 默认 FALSE）· 又显示'完善资料'入口"。

**影响**：用户需要再点一次"完善资料" · PATCH 一次后 has_completed_profile 变 true · 以后不再显示 · 体验上有一次性困惑 · 但不阻塞

**建议**：dispatch §2.1 A 的"不做 backfill"注释已写"让用户重新点'完善资料'自然修复 · 同时验证新链路"· 已覆盖此场景 · 不需改 · 但 Human 实测时（§9 步骤 5）应关注此体验 · 若用户已 PATCH 过资料但 has_completed_profile 仍 false · 属预期行为

---

## 7. 审查档自评（D-018 §3.4 SBAI 流程合规）

| 维度 | 值 |
|---|---|
| 工作区铁律 | ✅ 仅读 · 未写任何业务代码 · 0 commit · 唯一写操作 = 本报告落盘到 `.team/reviews/COSTRA-158/card-review-round-1-tech.md` |
| tools 白名单 | ✅ 使用 Read / Grep / Glob / LS / WebFetch · 未触发 Write 任何 server/miniprogram 文件 |
| D-016 同轮兑现 | ✅ 本次 Review 在 Orchestrator 派单同对话轮内产出 |
| 审核耗时 | ~35 分钟 |
| 置信度 | **高** |
| 低置信点 | (1) K3 vs K1 升级路径的工程取舍 · 需 COSTRA-152 实装时才能最终判定 · (2) 11 项 scope 是否能 210min 内完成 · 取决于 K3 子决策耗时 · 但有 D-017 §2.4 溢出保护 |

---

## 自检清单

- [x] 7 维度 + C8 是否全部打分？ → C1~C7 + C8 否决项全扫 · 27/30
- [x] C8 红线是否逐项扫了？ → 5 条红线全扫 · 0 命中
- [x] 每个 P0/P1/P2 是否有"证据 / 问题 / 依据 / 修复建议"4 要素？ → 是
- [x] 是否跨区审了 pm / design 卡？（不应）→ 否 · Owner = backend-dev + miniapp-dev
- [x] Verdict 是否与分数一致 + C8 是否造成 override？ → 27/30 = PASS · C8 无 override
- [x] 报告是否完全通过 final message 返回？ → 是

---

*本报告由 `costra-card-reviewer-tech-COSTRA-158-r1` 一次性装扮产出 · 审完即销毁 · 2026-05-19T10:15+08:00*
