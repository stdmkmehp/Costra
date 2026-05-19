# Sprint-2 Retrospective · 7 主线卡 + 7 关键决策 + 3 反模式沉淀

> **Owner**：Orchestrator（J 路径直驱 · 非 pm-writer 装扮档 · 因为 Sprint-1 retro 范式已立 · 本次仅范式复用 + 增量沉淀）
> **Date**：2026-05-19 16:05（Sprint-2 末 Retro 沉淀）
> **Sprint-2 周期**：`2026-05-10 ~ 2026-05-23`（实际节奏：5/9 启 → 5/19 主线全 R1 APPROVE · 11 天 · 提前 4 天预收官）
> **Sprint-2 状态**：5/7 主线 CLOSED + 2/7 R1 APPROVE 等 Human 攒批实测（D-024 §2.2 C1 路径）· 前置事实源 commit `54acc32`（HEAD）
> **Retro 触发**：Human J 决策 @ 2026-05-19 16:03（Sprint-2 真正闭环仪式 · 落档了才算 100% 收官）

---

## §1 Sprint-2 速览

### §1.1 周期与估点

| 维度 | 数据 | 对照 Sprint-1 |
|---|---|---|
| **Sprint 周期** | 2026-05-10 ~ 2026-05-23（计划 14 天）· **实际 11 天主线 R1 全 APPROVE**（提前 21%）| Sprint-1 超期 2 天（+14%）|
| **Sprint-2 总估点（定稿）** | **27 点**（106:1 + 103:5 + 104:6+1 切出去 + 105:3 + 156:2 + 157:3 + 158:5 + R1.x.1+R1.x.2:1）· vs 计划 32~36 → 完成 78% | Sprint-1 52 点（含紧急卡溢出 30%）|
| **Closed 卡数** | **5 张主线** + **2 张等实测** = 7/7 主线 R1 APPROVE | Sprint-1 14 卡（含紧急 5+5 治理）|
| **主线** | 主线 = 单人记账闭环 = COSTRA-103 client 持久化 → COSTRA-104 server CRUD/sync push → COSTRA-105 闭环冒烟 → COSTRA-156 v1 prefix → COSTRA-157+158 用户资料严格判定 | Sprint-1 主线 COSTRA-102（登录链路） |
| **Sprint-2 起始状态** | COSTRA-106 Sprint-1 retro 收官 → Sprint-2 Planning | — |
| **未触发** | 0（Sprint-2 主线全启动）· 但 COSTRA-155 ledgers CRUD + COSTRA-160 design tokens pipeline 顺延 Sprint-3 | Sprint-1 COSTRA-114 DevOps bootstrap 未触发 |

### §1.2 7 卡索引（按终审时间序）

| 类别 | 卡号 | 终审时间 | 估点 | verdict | 范式贡献 |
|---|---|---|---|---|---|
| **基建** | COSTRA-106 | 2026-05-09 10:39 | 1 | Human T2 APPROVED 双 30/30 满分 | pm-writer 首次实战 + Sprint-1 retro 落档 |
| **主线主头** | COSTRA-103 | 2026-05-09 19:17 | 5 | Human T1 APPROVED 38/40 | D-022 v2.0 + D-017 v3 双范式首次实战 |
| **主线 #3** | COSTRA-104 | 2026-05-12 13:54 | 6（+ R1.x×4 共 1）| Human T1 APPROVED 36/40 | 切出去 3 件套铁律首次实战 9/9 + dev DX 治理三件套 + D-017 v3 §2.4 E1 例外 4 次实战 |
| **主线 #4** | COSTRA-105 | 2026-05-19 09:27 | 3（+ R1.x.1+R1.x.2 共 1）| Human T1 APPROVED-PARTIAL 40/40 | qa-planner 首次实装即满分 + D-022 §4.1 真兑现立意首次实测（Human ~30min 实测捕获 5 发现 = 4 文档 gap + 1 联合 P0 BUG 双责）+ v1.4 BLOCKED-BY-COSTRA-156 范式同款第 2 次实战（H6 BLOCKED-BY-154）|
| **主线 #5** | COSTRA-156 | 2026-05-19 09:27 | 2 | Human T1 APPROVED 40/40 满分 | CI 对账族第 5 张规则 D + D-016 反例第 8 次首次预防成功 + Card-Review 后 P1+P2 100% 修订率 |
| **主线 #6** | COSTRA-157 | 🟡 R1 APPROVE 38/40（2026-05-18 19:1x）· 等批量实测（D-024 §2.2 C1）| 3 | review-tech APPROVED 等 Human 终审 | 5 FU 合并修复（FU-001 + FU-118-2 + FU-102-ERROR-MAPPER-INTEGRATION + FU-102-AVATAR-ONERROR + FU-102-PROFILE-REFUSE-UI）+ all-A 决策范式 |
| **主线 #7** | COSTRA-158 | 🟡 R1 APPROVE 38/45（2026-05-19 ~13:0x）· 等批量实测（同 157 攒批）| 5 | review-tech APPROVED 等 Human 终审 | 双装扮档单 commit + COSTRA-101 遗留 gap 修复（OpenAPI 早定义 server 没实装 1 个月）+ D-025 反模式清单 AP-001/002/003 三连首立 |
| **合计** | **7 卡 R1 APPROVE** | — | **27** | — | 6 项关键范式贡献 |

> 注：COSTRA-157+158 未"完全 CLOSED"· 因为 Human 实测节奏由 D-024 §2.2 攒批触发条件控制（Human 主动召唤或 ≥ 2 张时联合实测）· 不是阻塞。

### §1.3 闸门状态

| 闸门 | 状态 | 日期 |
|---|---|---|
| G1 PRD | ✅ Approved（Sprint-0） | 2026-04-21 |
| G2 设计 | ✅ Approved（Sprint-0） | 2026-04-22 |
| G3 契约 | ✅ Approved with follow-up | 2026-04-22 |
| G4 Sprint-1 合并 | ✅ PASS | 2026-05-09 09:44 |
| **G5 Sprint-2 合并** | 🟡 主线 R1 APPROVE 7/7 · 等 157+158 Human 实测后正式收官 | 预计 2026-05-19~05-23 |
| G6 发布 | 🟡 Preempt-Ready（D-023 prod 入口已上线 · 微信白名单已配 · 公安联网备案已提交等下证）| — |

### §1.4 commits 统计

| 维度 | 数据 |
|---|---|
| **Sprint-2 commits 总数** | 56（Sprint-1 末 d496b5d 之后 → 当前 HEAD 54acc32）· vs Sprint-1 26 commits · **2.15× Sprint-1**（卡数 7 vs 14 但单卡 commit 密度更高 · 因 R1.x 例外路径多 + dispatch/retro/follow-ups 维护 commit 占比上升）|
| **R1.x 例外路径 commits** | 6（COSTRA-104 R1.x×4 = 6d395bd / db488b9 替身 / a575a4a / + 105 R1.x.1+R1.x.2 = 33dbdea + db488b9）|
| **doc-only commits** | ~22（/2 of total · Sprint-1 1/3 · 提升 50%）|
| **双卡同轮 commit** | 2（aa530ce 156+105 双卡 final · c7ea7f7 158 双装扮档单 commit · 范式 Q4-A 两次实战）|
| **HEAD** | `54acc32`（Sprint-3 头部双 dispatch + D-025）|

---

## §2 Sprint-2 议题逐条处置（10 大议题 · 含 Sprint-1 末遗留议题验证 + Sprint-2 新增）

> 编号沿用 Sprint-1 retro §2 议题 1~17 + 额外 A~K · 本档从 **议题 18** 起。

### 议题 18 · D-022 v2.0 评分表实战 4 次连续高分（103 38 → 104 36 → 105 40 → 156 40）

**结论**：runtime 维度增维评分表稳定有效 · 装扮档评分稳定趋势确立 · qa-planner + backend-dev 双满分（105+156）· miniapp-dev 38（103）· 综合稳定在 36~40 区间。

**反思**：满分趋势集中在 0 业务代码 / 0 协议改动 / 仅基建类卡（105 测试脚手架 + 156 prefix 修复）· 业务卡（103 outbox + 158 has_completed_profile）合理稳定在 38。**不是评分表过宽 · 而是反映了不同卡类型的天然评分上限**。

**沉淀**：D-022 v2.0 第 5/6 次实战分别为 COSTRA-157 R1 APPROVE 38/40 + COSTRA-158 R1 APPROVE 38/45（C9 性能 N/A 不计 · 实际 38/40 等价）· **6 次实战平均 38/40 = 95%**。

---

### 议题 19 · 切出去 3 件套铁律首次实战 9/9（COSTRA-104）

**结论**：COSTRA-104 R1 dispatch §2.2 Q1.2 拍板"切 PATCH /entries / DELETE /entries / GET /sync/pull 为 3 张独立卡"（COSTRA-152/153/154）· 当时立 follow-up + OpenAPI x-deferred 标记 + stub handler 返 501。Sprint-2 内**未做 154**（接续到 Sprint-3）· 但**架构正确性 100% 兑现**——102 引用 `/users/me` PATCH 的 client 调用 catch 吞错路径在 105 H6 实测时显式暴露 · 立即识别。

**反思**：x-deferred 范式好 · 但**只能防"人主动想看"的漂移** · 不能防"漂移没人看"的隐性 gap（COSTRA-101 OpenAPI 早定义 PATCH /users/me 但 server 没实装 · 1 个月内没人发现 · 见议题 25）。**自动化检测必须是规则 E**。

**沉淀**：D-025 AP-003 契约-实装漂移立案 · 候选 CI 规则 E。

---

### 议题 20 · D-022 §4.1 runtime 类 T2 卡 Human 实测前置铁律真兑现立意首次实测（COSTRA-105）

**结论**：105 R1 自动化（client 单测 + curl + server 单测 30+ 全绿）· Human ~30min 真链路实测捕获 **5 个发现 = 4 文档 gap + 1 联合 P0 BUG 双责**（BUG-001 client ledger_id 硬编码 + BUG-002 server payload 不校验 UUID format）。

**反思**：tho纸面审 + 自动化都漏不出"集成层契约对齐"+"工程实践 gap"· runtime T2 卡铁律真正立意 = **Human 真链路实测是不可替代的最后一道闸**（D-022 §4.1 立意首次兑现）。

**沉淀**：
- v1.4 BLOCKED-BY-COSTRA-156 范式同款第 2 次实战（H6 BLOCKED-BY-COSTRA-154 · 等 Sprint-3 154 实装回归即闭环 · partial PASS 范式有效）
- 105 R1 commit `33dbdea`+`db488b9` 双 BUG 修复 · `9be5e84` 状态收尾 · D-017 v3 §2.4 E1 例外路径 ≤ 1h 单 commit 收尾范式继续兑现

---

### 议题 21 · CI 对账族扩展第 5 张规则 D（whitelist-check.mjs · COSTRA-156）

**结论**：whitelist-check.mjs 加规则 D（fastify register prefix vs OpenAPI servers path 静态对账）· FU-105-CLIENT-SERVER-URL-PREFIX-MISMATCH 正向兑现（client 调 `/v1/auth/wx-login` · server fastify 没挂 v1 prefix · 静态扫即可发现）。

**反思**：CI 对账族 1→3（whitelist + appjson + tooling · Sprint-1）→ 1→4（+ICP cross SSOT · 2026-05-13 ICP 下证）→ 1→5（+ openapi/fastify prefix · COSTRA-156）· 平均每 Sprint 增 2 张规则 · Sprint-3 候选规则 E（openapi paths vs fastify register 一一对应 · D-025 AP-003 检测 · 见议题 25）。

**沉淀**：FU-DEVOPS-OPENAPI-IMPL-COVERAGE 立案（P2 · Sprint-3 中段 · DevOps 1 点小卡 · whitelist-check.mjs 规则 E 扩展）。

---

### 议题 22 · D-016 反例第 8 次首次预防成功 + 第 9 次议入

**结论**：
- **第 8 次合规预防**（COSTRA-156 · 2026-05-13 11:30）· 累计 7 次反例后首次合规 · 议题升 P0 · 卡审 §4.8 DoD M 项强制度量效果显著
- **第 9 次触发+补救**（COSTRA-105 R1.x.1 · 议入 Sprint-2 末 Retro · 但属于"有机制但触发 + 立即补救"性质 · 非纯反例）

**反思**：D-020 D-016 同轮兑现升定稿规约后 · 反例从 12 次降至 1 次（156 预防 + 105 R1.x.1 补救）· **效果验证有效** · 不需进一步升级。

**沉淀**：D-016 进入"成熟稳定期"· Sprint-3 不需新增治理。

---

### 议题 23 · D-018 SBAI 双装扮档单 commit Q4-A 范式 2 次实战（COSTRA-157+158）

**结论**：
- COSTRA-157 R1 commit `ac204e3`（5 FU 合并 · backend-dev + miniapp-dev 双装扮档 · 单 commit 双 Co-Authored-By footer · all-A 决策第 1 次实战）
- COSTRA-158 R1 commit `c7ea7f7`（11 项 scope · backend 9 文件 + miniapp 5 文件 · 单 commit · 双 footer 第 2 次实战）

**反思**：Q4-A 范式有效 · 双装扮档串行（先 backend-dev 不 commit 暂存 · 后 miniapp-dev 统一 commit）· **节省 1 次 Review 循环 + 1 次 commit 维护成本**（vs 拆 a/b 两卡）· 工作树污染风险由"backend 段不 commit"约束控制 · 0 次违反。

**沉淀**：D-018 §3.5 Q4-A 双装扮档单 commit 进入"实战验证通过"状态 · Sprint-3 154+150 dispatch §0 已声明套用此范式（154 backend-dev / 150 miniapp-dev 两个独立卡 · 不是双装扮档同卡）· 但 158 这种"单卡跨域"才走 Q4-A · 154+150 是"两卡联合 approve"走 D-024 §2.2 C1 攒批。

---

### 议题 24 · D-024 SOP 立案 · Human 实测批量触发条件（反节奏碎片化）

**结论**：Sprint-2 后半段 Human 实测频次过高（24 小时内 4 次 · 每次 setup 重复成本 ≥ 8~15min）· Human 反馈"实测接入太频繁" → 立 D-024 SOP（5 触发条件 C1~C5 + 默认攒批）。

**反思**：SBAI 自动化收益 vs Human 实测纪律的矛盾 · D-014 + D-016 把"机器侧节奏"传染到"Human 侧节奏"· D-024 修正此漂移 · **Sprint-3 起强制全员遵守**。

**沉淀**：D-024 立案 + 同轮对 157+158 出清 · `docs/qa/sprint-2-batch-human-smoke.md` 8 步合并清单 + 9 硬断言聚合 + 双 approve 命令 · 范式参照 105+156 联合实测先例。

---

### 议题 25 · D-025 反模式清单立案 · 3 条沉淀（COSTRA-158 触发链）

**结论**：COSTRA-157 R1 dispatch §2.1 E 用 `nickname !== '微信用户'` 字符串代理判定 hasProfile · Human 2026-05-19 09:42 否决 · 调研发现 COSTRA-101 OpenAPI 早定义 PATCH /users/me 但 server 1 个月没实装（隐性 gap）· 立 COSTRA-158（5 点 · 严格事实判定 + /users/me 完整实装）· 同时立 D-025 反模式清单档：

| AP | 立案理由 |
|---|---|
| AP-001 字符串代理判定 | "用 X 字段字符串值反推 Y 事实"反模式 · 推荐显式布尔字段 |
| AP-002 概率极低就接受 | "撞库概率极低 + Sprint-N 再修"双重借口反模式 · 推荐三选一（消除根因 / 自动检测 / 数学证明）|
| AP-003 契约-实装漂移 | "OpenAPI 早定义 server 没实装"反模式 · 推荐 x-deferred 显式标记 + CI 规则 E 自动检测 |

**反思**：D-022 v2.0 评分矩阵是"正向能力"检查表 · 缺少"反向陷阱"检查表 · D-025 §2 Card-Review §4 + R1 Review §5 强制套用清单填补此空白 · Sprint-3 起所有卡走双扫描（D-022 评分 + D-025 反模式）。

**沉淀**：D-025 v1.0 落档 · Sprint-3 起强制套用 · COSTRA-154 dispatch §3.5 D-025 反模式扫描（AP-003 命中并修复 · 正向兑现）已预声明。

---

### 议题 26 · 联合实测范式 3 次实战（105+156 / 157+158 待 / 154+150 预定）

**结论**：D-014 SOP 联合双卡同轮 approve 范式 · Sprint-2 内 3 次实战：
1. **第 1 次**：COSTRA-105 + COSTRA-156（2026-05-19 09:27 双卡同轮 APPROVED CLOSED · D-014 SOP 首次实战）
2. **第 2 次**：COSTRA-157 + COSTRA-158（2026-05-19 等 Human 攒批实测 · 合并清单已落 · 8 步去重）
3. **第 3 次预定**：COSTRA-154 + COSTRA-150（Sprint-3 头部 · D-024 §2.2 C1 攒批触发）

**反思**：联合实测节省 ≥ 30% setup 时间（单次 server + 模拟器 setup 跑双卡）· 是 D-024 §2.4 "去重 setup" 的具体兑现路径。

**沉淀**：联合实测范式进入"稳定模式"· 默认套用 · 不再是议题。

---

### 议题 27 · D-023 prod 入口回归根域 + Sprint-2 末 Human 完成 2 项强阻塞清空

**结论**：
- D-023（2026-05-18）prod 入口回归根域 `https://costra.cloud/v1` · 子域 `api.* / api-staging.*` 搁置 Phase-2
- 2026-05-19 14:50 Human 完成 2 项：
  1. 微信公众平台白名单填 `https://costra.cloud`（4 类全填 · 即时生效）
  2. 公安联网备案已提交（在 30 日窗口内 · 距截止 2026-06-12 余 24 天 · 等公安系统 15~20 工作日审核下证）

**反思**：D-023 决策 24 小时内（5/18→5/19）就完成所有 Human 操作 · 比预期快 · **域名 → ICP → 微信白名单 → 公安备案"四件套"全链路打通**。R-019 🟠→🟡 Submitted（已提交等下证）· R-020 mitigation 落实 · R-013 早 Closed @ 2026-05-13。

**沉淀**：commit `dce4140` 5 文件事实落档 + BUG-105/156 stale closure 同步。**Sprint-3 起所有 runtime 类 T2 卡可走方式 C 真链路实测**（之前唯一阻塞 = 微信白名单未配）。

---

### 议题额外 L · Sprint-2 7 卡 0 false-start（vs Sprint-1 紧急卡 5 连溢出 30%）

**结论**：Sprint-2 主线 7 卡严格按 Sprint Planning 启动 · 0 紧急插入 · 0 false-start · 0 超期。vs Sprint-1 紧急卡五连溢出 40→52 估点（30%）· **本 Sprint 节奏稳定性显著改善**。

**反思**：Sprint-1 末 Retro 议题额外 A "紧急卡溢出"沉淀的 buffer 12~16 点机制本 Sprint 未触发 · 但**不能下结论说 buffer 不需要** · 因为 Sprint-2 是"已知技术债 5 FU 合并"主导（COSTRA-157）· 风险面比 Sprint-1 同族盲区小。Sprint-3 头部 154+150 强联动 + runtime T2 卡 · buffer 仍需保留。

**沉淀**：buffer 机制保留 · Sprint-3 Planning 时按"主线 5pt+5pt + buffer 12pt"配置（vs 主线 27pt 的 44%）。

---

## §3 工程度量复盘

### §3.1 Review 通过率

| 维度 | Sprint-1 | Sprint-2 | 趋势 |
|---|---|---|---|
| review-tech 平均分 | 32.5/35 | **37.7/40**（103:38 + 104:36 + 105:40 + 156:40 + 157:38 + 158:38）| **+5%**（v2.0 增维后稳定回升）|
| 满分卡数（review-tech）| 2 | 2（105+156）| 持平 |
| review-product 平均分 | 28/30 | N/A（本 Sprint 0 PM/Design 卡走 product 评审）| — |
| Card-Review 修订率 | — | **100%**（156 + 157 + 158 三卡 P1+P2 修订全采纳）| **新指标 · 健康基线** |

### §3.2 Human 终审通过率

| 维度 | Sprint-1 | Sprint-2（含等实测）| 趋势 |
|---|---|---|---|
| Human T1+T2 终审 | 14/14（100%）| 5/7 已 CLOSED · 2/7 R1 APPROVE 等批量实测 | 100% 路径上 |
| **APPROVED-PARTIAL 范式** | 0 | **1**（COSTRA-105 H6 BLOCKED-BY-COSTRA-154 · v1.4 范式同款第 2 次实战）| 新沉淀 |
| **BUG-CAPTURE-EFFICIENCY**（Human 实测捕获缺陷率）| — | **5 发现/30min（COSTRA-105）**= 6 发现/小时 · 其中 1 P0 联合 BUG | 新指标 · 高效 |

### §3.3 D-016 同轮兑现实战次数

| 维度 | Sprint-1 | Sprint-2 | 累计 |
|---|---|---|---|
| 同轮合规次数 | 12 | **6+**（103/104/105/156/157/158）| 18+ |
| 异步反模式次数 | 0 | 1（105 R1.x.1 立即补救 · 不算反例）| 0~1 |
| **D-016 反例累计 7 次后首次预防成功** | — | **2026-05-13 11:30 COSTRA-156 第 8 次** | 范式成熟 |

### §3.4 D-017 实战次数

| 版本 | Sprint-1 | Sprint-2 | 累计 |
|---|---|---|---|
| D-017 v3 实战 | 5 | **6+**（103 R1 + 104 R1.x×4 + 105 R1.x×2 + 156 R1 五步走完）| 11+ |
| **§2.4 E1 例外路径** | — | **6 次实战**（104 R1.x×4 + 105 R1.x×2）· 全部 ≤ 1h 单 commit 收尾 | 范式成熟 |

### §3.5 SBAI 装扮档冒烟次数

| 维度 | Sprint-1 | Sprint-2 | 累计 |
|---|---|---|---|
| SBAI 装扮档冒烟次数 | 6 | **7+**（pm-writer:106 / miniapp-dev:103 + 157+158 / backend-dev:104 + 156 + 158 / qa-planner:105）| 13+ |
| 双装扮档单卡（Q4-A 范式）| 0 | **2**（COSTRA-157 + COSTRA-158）| 范式立 |

### §3.6 CI 对账族扩展

| 阶段 | 规则数 |
|---|---|
| Sprint-1 末 | 3（whitelist + appjson + tooling）|
| Sprint-2 末 | **5**（+icp-cross-ssot @ COSTRA-107 + openapi-fastify-prefix 规则 D @ COSTRA-156）|
| Sprint-3 候选 | 6（+ openapi-impl-coverage 规则 E · D-025 AP-003 自动检测 · 议题 25 沉淀）|

### §3.7 决策档累积

| Sprint | 新决议 | 累计 |
|---|---|---|
| Sprint-0 | D-006~D-014（9 条）| 9 |
| Sprint-1 | D-015~D-019 (+ ADR-0006) + D-020/D-021/D-022（Sprint-1 末 retro 收官）| 17 |
| **Sprint-2** | **D-023 prod-rollout-on-root-domain + D-024 human-test-batching-trigger + D-025 anti-patterns-clipboard** | **20** |
| Sprint-3 候选 | 暂无（D-024 §3 留 follow-up `closed-pending-human-test` 中间态可能升 D-026）| — |

---

## §4 范式与反模式归档

### §4.1 联合实测范式（D-024 §2.2 C1 路径 · Sprint-2 范式立 · 3 次实战）

**触发条件**：队列累计 ≥ 2 张 R1 APPROVE 卡 + 同一 Sprint 节奏窗口

**实施**：去重 setup（一次 server 启动 + 模拟器编译）· 合并步骤清单（双卡断言并列）· 单次 Human 输入触发多卡 CLOSED

**节省**：≥ 30% setup 时间（vs 单卡串行）· 0 漏检（双卡相互交叉验证）

**实战**：
1. COSTRA-105 + COSTRA-156（2026-05-19 09:27 · D-014 SOP 首次实战）
2. COSTRA-157 + COSTRA-158（2026-05-19 等 Human 攒批 · `docs/qa/sprint-2-batch-human-smoke.md`）
3. COSTRA-154 + COSTRA-150（Sprint-3 头部 · 预定）

### §4.2 双装扮档单 commit 范式（D-018 §3.5 Q4-A · Sprint-2 范式立 · 2 次实战）

**适用**：单卡跨双 Agent 域（如 backend + miniapp 同步改动 · DB 加列 + client 类型加字段联动）

**实施**：backend-dev 段不 commit 暂存 → miniapp-dev 段统一 commit + 双 Co-Authored-By footer

**实战**：
1. COSTRA-157 R1 commit `ac204e3`（5 FU 合并 · 双装扮档单 commit 第 1 次实战）
2. COSTRA-158 R1 commit `c7ea7f7`（11 项 scope · 9+5 文件 · 第 2 次实战）

**注意**：Sprint-3 头部 154+150 是"两卡联合 approve"非"双装扮档单卡"· 不套此范式 · 走 §4.1 联合实测。

### §4.3 切出去 3 件套铁律（D-017 v3 + Sprint-1 范式 + Sprint-2 持续兑现）

**适用**：单卡 scope 超 INVEST small 上限时（点数 > 6 或 scope > 8 项）

**实施**：dispatch §2 显式声明"切出去"清单 · 每条目含 `owner_card` 占位 + `followup_id` + `deferred_at` + `deferred_reason` · OpenAPI / 协议层用 `x-deferred` 标记 · stub handler 返 501 + `deferred_card` 字段

**Sprint-2 持续实战**：COSTRA-104 R1 切出 152/153/154 三卡（PATCH/DELETE/SYNC-PULL）· 1 个月内 152/153 仍未启动（Sprint-3 中段候选）· 154 Sprint-3 头部启动。

### §4.4 D-022 §4.1 runtime 类 T2 卡 Human 实测前置铁律

**适用**：涉 wx 平台 / 真机 / 真支付 / 真授权 / DNS+SSL+ICP runtime 等无法 mock 的链路

**Sprint-2 真兑现**：COSTRA-105 H1~H6 ~30min 实测捕获 5 发现 = 4 文档 gap + 1 联合 P0 BUG（client + server 双责）

**Sprint-3 适用对象**：COSTRA-150 client sync 调度器（runtime T2 卡 · D-022 §4.1 + D-024 §2.2 C2 路径双锚 · 但 D-024 §2.2 C1 优先 → 与 154 联合实测）

### §4.5 D-025 反模式扫描清单（Sprint-2 末立 · Sprint-3 起强制套用）

**适用**：Card-Review §4 + R1 Review §5 强制扫描

**3 条沉淀**：
- AP-001 字符串代理判定（COSTRA-157→158 触发链）
- AP-002 概率极低就接受（同上 · 双重借口反模式）
- AP-003 契约-实装漂移（COSTRA-101→158 OpenAPI 早定义 1 个月 gap）

**Sprint-3 第 1 次实战预定**：COSTRA-154 dispatch §3.5 已预声明（AP-003 命中并修复 · 正向兑现）

### §4.6 反模式归档：Sprint-2 漏检反思

| 反模式 | Sprint-2 实战 | Sprint-3 防御 |
|---|---|---|
| 字符串代理判定 | COSTRA-157 R1 P1-2 评审 PASS · Human 实测前否决 → 158 立卡 | D-025 §2 Card-Review §4 强制扫描 |
| 概率极低就接受 | 同上 · 评审 PASS · Human 实测前否决 | 同上 |
| 契约-实装漂移 | COSTRA-101 OpenAPI 早定义 PATCH /users/me · 1 个月没实装 · 误归因为 wx.request 不支持 PATCH（FU-COMMON-MINIAPP-PATCH-LIMIT）· 2026-05-19 调研发现真相 | CI 规则 E 静态扫 OpenAPI vs fastify register（FU-DEVOPS-OPENAPI-IMPL-COVERAGE）|

---

## §5 Sprint-3 输入

### §5.1 Sprint-3 头部双卡（dispatch 已落档 等启动）

| 卡号 | 估点 | 优先级 | Owner | 状态 |
|---|---|---|---|---|
| COSTRA-154 GET /sync/pull 实装 | 5 | P0 | backend-dev | dispatch 已落 等 Sprint-3 启动 spawn |
| COSTRA-150 client sync 调度器 | 5 | P1 | miniapp-dev | dispatch 已落 严格依赖 154 R1 APPROVE |

**强联动**：154 不做 → 150 调度器调 GET /sync/pull 仍返 501 · 闸门红 · 物理阻塞。

**联合 approve 路径**：D-024 §2.2 C1 攒批 · 双卡 R1 APPROVE 后联合实测 `docs/qa/sprint-3-batch-human-smoke.md`（待落）。

### §5.2 Sprint-3 候选卡（Sprint-2 切出去 + 新增）

| 卡号 | 估点 | 优先级 | 说明 |
|---|---|---|---|
| COSTRA-152 PATCH /entries/{id} | 3 | P1 | COSTRA-104 切出去 · K3 → K1 升级评估时机（D-024 §2.4 + 议题 25）|
| COSTRA-153 DELETE /entries/{id} | 2 | P1 | COSTRA-104 切出去 · 软删 + audit_logs |
| COSTRA-155 ledgers CRUD | 5（占位）| P1 | BUG-105-D1 阶段 2 接续（真选账本 UI）+ entry/ledger schema 完整校验 |
| COSTRA-160 design tokens pipeline | 2 | P2 | FU-118-3 根治 · Sprint-2 候选未启动 · 顺延 |
| COSTRA-151 conflict UI | 5 | P2 | FU-103-CONFLICT-MERGE-UI · 154+150 落地后启 |

### §5.3 Sprint-3 Retro 议题候选（Sprint-2 末沉淀的 4 条）

| ID | 议题 | 处置时机 |
|---|---|---|
| Sprint-3-A | check:openapi-impl-coverage CI 规则 E 落地（FU-DEVOPS-OPENAPI-IMPL-COVERAGE）| Sprint-3 中段 · DevOps 1 点小卡 |
| Sprint-3-B | K3 → K1 全局 method-override middleware 升级时机（FU-K3-TO-K1-UPGRADE）| COSTRA-152 dispatch 时评估 |
| Sprint-3-C | sync-protocol.md client 视角章节增量（154+150 联合 PR 后统一修订）| 154+150 联合 approve 后 |
| Sprint-3-D | follow-ups README `closed-pending-human-test` 中间态（D-024 §3.3 留 follow-up）| Sprint-3 末 Retro 评估 |

### §5.4 Sprint-3 风险地图

| 风险 | 来源 | 等级 | mitigation |
|---|---|---|---|
| R-019 公安联网备案下证延迟 | 公安系统审核窗口 15~20 工作日 | 🟡 已 mitigation | 已提交 @ 2026-05-19 · 不阻塞 M4 提审 / M5 观察期前必须完成 · 下证后回填 §4 + §5 悬挂位置（compliance-registry.md）|
| 154+150 强联动 → spawn 顺序错 | dispatch 已声明强依赖 | 🟡 已 mitigation | 150 dispatch §1.3 显式不可在 154 APPROVE 前启 · Orchestrator 同轮兑现 |
| Sprint-3 头部 runtime T2 实测复杂度（150 4 触发源 + mutex + 失败处理）| 单测无法完整覆盖 wx 平台 runtime 行为 | 🟠 需密切关注 | D-022 §4.1 铁律 + D-024 §2.2 C1 联合实测 · 真链路 Human 实测前置不可省（参 105 范式）|
| K3 / 156 prefix 等小型 method-override 兼容层散落 | COSTRA-104 push + 158 PATCH /users/me + 152 PATCH /entries 都用 K3 | 🟡 观察 | 议题 Sprint-3-B 评估升级 K1 全局 middleware |

---

## §6 议题→决议映射表

| 议题 | 沉淀决议 / SOP | 状态 |
|---|---|---|
| 18 D-022 v2.0 实战 4 次 | D-022 v2.0 + 第 5/6 次实战记录 | 持续验证 |
| 19 切出去 3 件套铁律 | D-017 v3 §2.4 + COSTRA-104 dispatch §2.2 范式 | 范式成熟 |
| 20 runtime T2 真兑现 | D-022 §4.1 铁律 + 105 H1~H6 实测路径 | 范式成熟 |
| 21 CI 对账族第 5 张规则 D | whitelist-check.mjs 规则 D（156 commit edca8da）| 落地 |
| 22 D-016 反例预防成功 | D-020 D-016 升定稿规约 | 范式成熟 |
| 23 D-018 Q4-A 双装扮档单 commit | D-018 §3.5 + 157/158 两次实战 | 范式立 |
| 24 D-024 攒批 SOP 立案 | **D-024-human-test-batching-trigger.md** | **新增** |
| 25 D-025 反模式清单立案 | **D-025-anti-patterns-clipboard.md** | **新增** |
| 26 联合实测 3 次实战 | D-014 SOP + D-024 §2.2 C1 路径 | 范式成熟 |
| 27 D-023 prod 入口 + Human 2 项强阻塞清空 | **D-023-prod-rollout-on-root-domain.md** + dce4140 commit 5 文件落档 | **新增** |
| 额外 L Sprint-2 7 卡 0 false-start | Sprint-1 末 buffer 12~16 点机制保留 | 持续验证 |

---

## §7 Sprint-2 收官签名

| 字段 | 值 |
|---|---|
| **G5 Sprint-2 合并状态** | 🟢 **PASSED @ 2026-05-19 19:53**（主线 7/7 Human T1 APPROVED CLOSED · D-024 §2.2 C1+C4 联合实测 16/16 PASS · 105+156 范式复用 3rd play）|
| **G5 PASS 实际日期** | **2026-05-19 19:53**（Human 跑 v3.0 实测清单 6 步 16 断言 · 实际耗时 23min · 含 P0 BUG 发现 + 修复 + 重测）|
| **Sprint-3 启动条件** | ✅ G5 PASS · 等 Human 主动召唤 `start:sprint-3` / `start:COSTRA-154` |
| **本档 owner** | Orchestrator（J 路径直驱 + Sprint-2 真闭环 v1.1 续修）|
| **本档 commit** | v1.0 commit `0ce8b9c` · v1.1 待本轮 sprint-2 closure commit 回填 |

---

## §8 修订记录

| 版本 | 时间 | 修订 |
|---|---|---|
| v1.0 | 2026-05-19 16:05 | 初版落档 · Human J 路径直驱 · 范式参照 Sprint-1 retro · 议题 18~27 + 额外 L · 5 范式归档 + 6 议题→决议映射 |
| **v1.1** | **2026-05-19 19:55** | **Sprint-2 真闭环签收**（COSTRA-157+158 Human T1 APPROVED CLOSED · 实测 16/16 PASS · §7 G5 闸门 🟡→🟢）· 实测期发现并修复 storage envelope drift P0 BUG（COSTRA-158 R1.x.1 commit `99e3794`）· D-022 §4.1 runtime 实测前置铁律第 3 次实战收益登记 · D-025 AP-001 字符串代理反模式第 1 次正向规避铁证（F.3 撞库 nickname=微信用户+has=true→不显示完善资料）· 实测报告 `qa/results/2026-05-19-sprint-2-batch-human-smoke-result.md` 已落档 · 立 FU-DEV-MOCKLOGIN-RUNTIME-TOGGLE（P3 · Sprint-3 顺手）|

---

**事实源 / 依据**：

- Sprint-1 末 Retro 范式：`docs/retrospectives/sprint-1-retro.md`（558 行 · COSTRA-106 R1）
- Sprint-2 7 卡 metrics：`.team/metrics.json`（待补 sprint_2_summary）
- Sprint-2 7 卡 dispatch 档：`.team/dispatch/COSTRA-{103,104,105,106,156,157,158}-*.md`
- Sprint-2 末新增决议：`.team/decisions/D-{023,024,025}-*.md`
- 联合实测先例：`docs/qa/costra-105-human-smoke.md` v1.8 + `docs/qa/sprint-2-batch-human-smoke.md` v1.0
- HEAD：`54acc32`（chore(repo): sprint-3 head dual dispatch + d-025 anti-patterns clipboard）
