# D-026 · staging 与 prod 现阶段合并验收 · 工程纪律 4 条接受方案

> **日期**：2026-05-23
> **发起人**：Human
> **登记人**：Orchestrator
> **状态**：Approved（当场生效）
> **关联**：D-023 §2.2 / §2.4(a) / §5.1（staging 临时复用 prod URL · R-020 立项母决策）· R-020（微信白名单 staging 边界模糊 · 等级 🟡）· R-008（session_key/appsecret 泄漏极高风险 🔴）· R-018（开发服务器公网攻击面 🟠）· D-009 §2.4 安全基线

> 📌 **ID 占用说明**：D-024（§2.2 C1 攒批 SOP · 2026-05-12）/ D-025（AP-001~003 反模式扫描清单 · 2026-05-13）已占用 · 按决策登记单调递增原则使用 **D-026**。

> 📌 **本决议性质**：**非 supersede D-023**。本决议是 D-023 §2.2 的「**现阶段语义化登记补丁**」——把"短期缓解"口径升格为"Sprint-3~Sprint-5 期接受方案"· R-020 处置路径从"等待长期重启"明示为"接受短期合并 + 工程纪律 4 条"· D-023 决议本文不动（§4.1 红线）。

---

## §1 背景

### §1.1 D-023 §2.2 决议事实回顾（2026-05-18 立项）

D-023 决议下 prod 入口临时回归根域 `https://costra.cloud/v1`，staging env 名保留但 apiBaseUrl 临时复用 prod URL：

```ts
// miniprogram/services/env.ts（D-023 §2.2 落地形态）
staging: 'https://costra.cloud/v1', // D-023 临时复用，子域启用时切回 https://api-staging.costra.cloud/v1
prod:    'https://costra.cloud/v1', // D-023
```

短期缓解：编译期常量隔离 + `WX_MOCK_LOGIN` 不进 prod 构建产物。R-020（🟡 微信白名单 staging 边界模糊）随 D-023 §5.1 立项。

### §1.2 R-020 立项轨迹

- 2026-05-18：随 D-023 立项 · 状态 🟡 Open
- 2026-05-19 14:50：Human 完成微信公众平台白名单 `https://costra.cloud`（4 类 request/socket/uploadFile/downloadFile 全填 · 即时生效）· 状态升级 "Open · Mitigated"（D-023 §7 #1 解锁条件已满足）
- 2026-05-23（本决议）：Sprint-3 头部 4/9 卡 CLOSED · D-023 §2.4 (a) 重启触发条件至今未触发 · 进入 Sprint-3~Sprint-5 期 prod 验收阶段

### §1.3 决策动机

Human 决策"路径 α 完整版"触发：现阶段为简化测试成本，staging 与 prod 合并为单一 prod 环境（搭真 prod + 完整验收），不把 staging 当独立环境运营。

实际工程含义：
- ✅ 短期 ROI 收益：154+150 真 prod 验收路径最短（~60~90 min Human 操作 + ~40 min 实测）· 不在子域未启用时强行造 staging 隔离付出 DNS+SSL+nginx 多层依赖代价
- ⚠️ 短期工程风险：编译期常量隔离 + WX_MOCK_LOGIN 不进 prod 在生产服务跑起来后必须**显式落实为运行时纪律**（systemd EnvironmentFile + CI 红灯 + 启动日志验证）· 否则 mock token 漏到 prod / 灰度漂移 / 生产数据污染等隐性风险显化

本决议**显式登记此口径** · 后续 review-tech / qa-planner 工作不再因 R-020 红线挡板触发"为什么没有 staging 隔离"的合规审查反诘。

---

## §2 决议

### §2.1 staging 与 prod 现阶段合并状态明示

**Sprint-3~Sprint-5 期**，Costra 项目 staging 环境与 prod 环境保持合并状态：

| 维度 | 当前合并形态 |
|---|---|
| 域名 | 共用根域 `https://costra.cloud`（D-023 §2.1） |
| API 入口 | 共用 `https://costra.cloud/v1` |
| PostgreSQL DB | 共用单实例（49.235.216.20 · docker compose · DB 名 `costra`） |
| Redis | 共用单实例 |
| 微信公众平台白名单 | 共用 `https://costra.cloud`（4 类全填 · Human 2026-05-19 已配） |
| ICP 备案 | 共用沪ICP备2026017253号-2 |
| nginx + Let's Encrypt | 共用单证书 + 单 server_name |

**env 名保留**：`miniprogram/services/env.ts` 四环境枚举（local/dev/staging/prod）骨架不破坏；`server/api/openapi.yaml servers` 多 server URL 矩阵骨架不破坏；CI 三方对账规则不破坏（D-023 §2.2 已建立的复用边界注解强制规约持续生效）。

### §2.2 R-020 处置路径明示

**前**（D-023 §5.1）：短期通过 env.ts 编译期常量隔离 + WX_MOCK_LOGIN 不进 prod · 长期等 D-023 §2.4 (a) 触发条件出现时立卡重启子域

**后**（D-026 §2.3）：现阶段接受短期合并 + 显式工程纪律 4 条（C1~C4） + 重启硬触发条件 4 条（αβγδ · §2.4） · 长期路径不变（仍走 D-023 §2.4 (a) 重启）

### §2.3 工程纪律 4 条（C1~C4 · 必须遵守）

> 🚨 **本节为 Sprint-3~Sprint-5 期硬约束** · 任何 agent 跨此红线 → R-020 等级强制升级 🟡→🟠 → 触发 D-023 §2.4 (a) 立即重启 `stg.* + api-staging.*` 子域

#### C1 灰度/实验隔离纪律

**约束**：严禁创建任何"灰度名单 / 实验配置 / feature flag 灰度规则 / 实验 SDK 不同版本"单独存于 staging-only 而 prod 缺失（反向同款）。

**实施**：
- `feature_flags` DB 表（0001_init.sql 已建）所有写入必须按 family/user 维度而非 env 维度
- 客户端 env.ts 编译期不引入 staging-only feature flag 分支判断
- 任何 A/B 实验需要灰度名单时立即触发 §2.4 (α) 重启子域

**违反代价**：R-020 升 🟡→🟠 · 强制立卡 D-024+ 子域重启（成本 ~1 周 Human 操作 + 多 agent 协同）

#### C2 mock 通道防护纪律（**最严**）

**约束**：server `WX_MOCK_LOGIN` 在 prod 启动环境**必须显式设置为 0 或不设置**（默认行为 = 关闭 mock）· **绝对禁止**在 prod 系统环境变量 / systemd EnvironmentFile / .env.prod 中出现 `WX_MOCK_LOGIN=1`。

**实施三件套**：
1. **systemd EnvironmentFile 显式声明**：`/etc/costra/server.env` 中**写明** `WX_MOCK_LOGIN=0`（防系统环境变量残留 / 进程间继承漏入）
2. **启动日志验证**：server 启动后 `tail /var/log/costra/server.log` 必须**无任何** `wxMockLogin: true` / `WX_MOCK_LOGIN enabled` 字样
3. **CI 红灯保护**：（FU-PROD-CI-MOCK-GUARD 后续立卡 · whitelist-check.mjs 规则 E 候选）静态扫描 prod 部署脚本 / EnvironmentFile / Dockerfile 含 `WX_MOCK_LOGIN=1` 即 CI exit 1

**关联红线**：R-008（session_key/appsecret 泄漏 · 极高 🔴）· mock 模式 server 端 mock code2Session 不调用真实微信 API · 若漏到 prod 链路 → 任意 code 都返 mock JWT → 完全绕过微信登录鉴权 → 攻击者可冒充任意 openid 身份获取 prod 数据

**违反代价**：立即 incident · server 紧急停机 + JWT_SECRET 轮换 + 全用户 token 失效 + 安全审计

#### C3 prod DB 操作纪律

**约束**：prod PG 实例（49.235.216.20:5432）执行下列操作需 Human 显式拍板：
- `DELETE FROM ...`（任意行）
- `TRUNCATE TABLE ...`
- `DROP TABLE / DROP COLUMN / DROP INDEX`
- `ALTER TABLE ...`（schema 改动）
- `npm run db:migrate` 跑新 migration

**实施三件套**：
1. **dump**：操作前 `docker compose exec -T postgres pg_dumpall -U costra > /backup/pre-<op>-$(date +%Y%m%d-%H%M%S).sql`
2. **operate**：执行操作命令（带 `\timing` 看时长）
3. **verify**：操作后 `\dt` + `SELECT count(*) FROM <表>` + 业务关键 SQL 抽样

**关联**：D-009 §2.4 安全基线（数据备份每日 dump 到腾讯云 COS）

**违反代价**：数据丢失 / 误删 → 从 dump 回滚（最多丢失 24 小时数据）+ 事故单

#### C4 测试数据隔离纪律（**最易遵守 · 最易忽略**）

**约束**：所有"实测产生数据"用预留标记 family / ledger（与 154+150 实测手册 §2.3 seed-curl-test 一致）：
- `family_id` = `00000000-0000-0000-0000-0000000000F0`（CurlTestFamily）
- `ledger_id` = `00000000-0000-0000-0000-000000000001`（CurlTestLedger）

**实施**：
- 152+153 / 154+150 / 后续 P 卡 prod 实测**必须**用 seed-curl-test 脚本建的 family + ledger
- 实测产生 entries 数据**不**清理（保留作为回归测试基准 · curl-test family 数据天然与真实用户隔离）
- 真实用户进入后产生的 entries 永远不与 curl-test family 混合

**违反代价**：测试 entries 污染真实用户数据 · 退款 / 投诉 / 信任崩塌（Sprint-6 公测后影响倍增）

### §2.4 重启隔离的硬性触发条件（任一满足立即重启 D-023 §2.4 (a)）

| 条件 | 等级 | 重启子域 | 备注 |
|---|---|---|---|
| **(α)** 真实用户灰度名单需要分流（如 1% 灰度走新版 server / A/B 实验需要 staging-only flag） | P0 | `stg.* + api-staging.*` | 触发后立即立卡 · D-024+ 顺延 |
| **(β)** prod DB 真实用户产生 entries 累计 > 10万条 | P1 | 同上 | 数据量级触发隔离 ROI 反转 · 监控 `SELECT count(*) FROM entries WHERE family_id != '...0F0'` |
| **(γ)** Sprint-6 之后 Human 决策准备公测（M5 观察期前必须完成） | P0 | 同上 | 公测前必须有 staging 隔离做最后一道闸 |
| **(δ)** R-008 类安全事件发生（session_key 泄漏 / DB 入侵 / WX_APP_SECRET 泄漏） | P0+ | 同上 + 全密钥轮换 | 触发即事故 · 不在工程节奏内 |

> 💡 **触发即立卡**：任一条件满足时由 Orchestrator + DevOps + PM 联合立卡 D-024+，按各子域具体 DNS+SSL+nginx 三件套交付清单实施（D-023 §3 影响范围已铺好基础）。

### §2.5 与 D-023 / R-020 的兼容关系（明示）

- **D-023 决议本文**：保持原文不动（决策不可变性 · §4.1 红线）· 本决议作为 D-023 §2.2 的"现阶段语义化登记补丁"存在
- **D-023 §2.4 重启子域触发条件 (a)~(d)**：保持原文不动 · 本决议 §2.4 (α)(β)(γ)(δ) 是 (a) 的展开细化（α 对应 a 的 "灰度名单" / β 是数据量阈值新增 / γ 是公测时间点 / δ 是安全事件兜底）
- **R-020**：状态从 "Open · Mitigated" 升级为 "Open · Mitigated · Accepted-Sprint-3-to-5"（mitigation 列尾追加引用 D-026 §2.3 工程纪律 4 条 · 等级 🟡 不变 · ID 不变）

---

## §3 影响范围

> 📎 本节仅做**清单层登记**，0 业务代码改动 · 仅决议 / 风险登记 / SSOT 基建文档同步。

| 区 | 文件 | 变更要点 | Owner |
|---|---|---|---|
| 决议 | `.team/decisions/D-026-staging-prod-merged-acceptance.md` | 本决议新建（~220 行） | Orchestrator（pm-writer 装扮失败兜底 · 见 §6 incident 备注） |
| 风险登记 | `.team/risks.md` R-020 行 | mitigation 列尾追加 + 状态列升 Accepted-Sprint-3-to-5 | Orchestrator |
| 基建 SSOT | `infra/wechat/domains.md` §1.1 staging 行 | 注释列尾追加 D-026 §2.1 引用 | Orchestrator |
| HANDOFF | `.team/HANDOFF.md` §0/§1.1/§1.3/§8 v1.23 | 路径 α 6 阶段图 + D-026 立档 + Phase-1 prod-bootstrap 落档 | Orchestrator（同对话轮编排） |
| Phase-1 配套 | `infra/prod-bootstrap.md` + `infra/wechat/prod-readiness-checklist.md` | devops-ops 装扮失败兜底 · Orchestrator 代为落档（见 §6） | Orchestrator |

---

## §4 不变项（明示防止误改）

> 🚨 本节为「**红线清单**」。任何 agent 在本决议生效期内**禁止**触碰下列对象。

### §4.1 D-023 决议本身不动（决策不可变性）

`.team/decisions/D-023-prod-rollout-on-root-domain.md` 全文保持原状。本决议（D-026）作为 D-023 §2.2 的「现阶段语义化登记补丁」存在，不修改 D-023 文本本身。

### §4.2 R-020 ID 不变

`.team/risks.md` R-020 行只追加 mitigation 列尾内容 + 改写状态列描述 · ID / 影响 / 概率 / 等级 / 负责人 / 风险描述列全部不动。

### §4.3 D-009 安全基线全部不变

D-009 §2.3 备案过渡方案 / §2.4 安全基线 / §2.5 工程配置约束全部不变。本决议 §2.3 工程纪律是 D-009 §2.4 在 staging↔prod 合并语境下的具体化补充，不替代 D-009。

---

## §5 风险变更

| ID | 名称 | D-026 前 | D-026 后 | 变更说明 |
|---|---|---|---|---|
| R-020 | 微信白名单 staging 边界模糊 | 🟡 Open · Mitigated | 🟡 Open · Mitigated · Accepted-Sprint-3-to-5 | mitigation 列尾追加 D-026 §2.3 工程纪律 4 条 · 状态升 "Accepted-Sprint-3-to-5" · 等级不变 |

**不新增风险**：C1~C4 工程纪律是 mitigation 强化 · 不暴露新攻击面。R-008 / R-018 等关联红线由 §2.3 C2/C3 进一步守护。

---

## §6 派生任务

> 📌 **本决议无新立 Sprint 卡**。D-026 与 prod-bootstrap 手册同对话轮并行交付完成所有 §3 影响范围清单内的文件变更。Sprint-3 backlog 不增加估点。

§2.3 C2/C3 验证由后续 Phase-2 prod 闸门 checklist 兜底（`infra/wechat/prod-readiness-checklist.md` · Orchestrator 同轮交付 · 不进 D-026 派生）。

§2.4 (α)(β)(γ)(δ) 触发条件出现时再立 D-024+ 子域重启卡 · 不预先占点。

### §6.1 本轮 SBAI 装扮档工具白名单错配 incident 备注

本决议立档时 spawn pm-writer + devops-ops 双装扮档同对话轮 · 两 subagent 反馈工具白名单为只读集（无 write_to_file / replace_in_file），与 COMMON-CONTRACT §0-Bis 装扮档授权口径错配。Orchestrator 代为按 subagent final message 输出的内容片段落档（D-019/D-021/D-022/D-023 历史先例兼容此兜底路径）。

候选议入 Sprint-3 末 Retro：
- 议题 #6 候选：**SBAI v1.1 装扮档 spawn 工具白名单平台限制**——当前 `task(subagent_name="code-explorer")` 路径 spawn 出来的装扮档继承的是 code-explorer 的只读工具集 · 而非装扮档自身宣告的全工具集 · 需要平台升级（D-018 §3.5 v1.0 既定事实加注 + 平台升级触发条件 · 候选 D-027）

---

## §7 Human 后续操作清单

> 🚨 D-026 落地后 Human 需做的事**只有 1 件**：

| # | 操作 | 入口 | 截止 |
|---|---|---|---|
| 1 | 在对话中确认 §2.3 工程纪律 4 条接受（C1 灰度隔离 / C2 mock 防护 / C3 DB 操作三件套 / C4 测试数据隔离 family） | 直接回 OK 或"确认 D-026 §2.3 接受" | 进 Phase-1 prod-bootstrap 之前 |

> ✅ 本决议落档不需要 Human 单独操作外部资源（白名单 / 备案 / DNS 全部不动）· §2.3 C2/C3 的实施动作在 Phase-1 prod-bootstrap 手册 §4/§5/§6 内置。

---

## §8 决议落盘自检

- [x] §1 背景：3 子节（D-023 §2.2 决议事实回顾 + R-020 立项轨迹 + 决策动机）
- [x] §2 决议：5 子节（合并状态明示 + R-020 处置路径 + 工程纪律 4 条 C1~C4 + 重启硬触发条件 4 条 αβγδ + 与 D-023/R-020 兼容关系）
- [x] §3 影响范围：5 行清单（决议 / 风险登记 / 基建 SSOT / HANDOFF / Phase-1 配套）· 0 业务代码改动
- [x] §4 不变项：3 红线（D-023 全文不动 / R-020 ID 不变 / D-009 §2.3 §2.4 §2.5 全部不变）
- [x] §5 风险变更：R-020 mitigation 扩展 + 状态升 Accepted-Sprint-3-to-5 · 不新增风险
- [x] §6 派生任务：明示无新立 Sprint 卡 + §6.1 SBAI 工具白名单错配 incident 备注（候选 Retro 议题 #6）
- [x] §7 Human 后续操作清单：1 件（确认 §2.3 工程纪律 4 条接受）· 0 件外部资源新增
- [x] 全文 ~220 行（≤350 硬约束）· 全角中文标点 · 🟢🟠🔴🟡⚪ 状态圆点严格 · D-023 同款 ADR 章节体例 · 决策不可变性守护

---

> **本决议落盘后**：risks.md R-020 行同轮更新；infra/wechat/domains.md §1.1 staging 行同轮更新；HANDOFF.md v1.23 + board.md 顶部条由 Orchestrator 同对话轮编排刷新；prod-bootstrap.md + prod-readiness-checklist.md 同对话轮交付（路径 α Phase-1 配套）。
