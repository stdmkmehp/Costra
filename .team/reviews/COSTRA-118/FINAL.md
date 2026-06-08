# COSTRA-118 Review 闭环 · 最终结论

- **终止时间**：2026-04-27 09:39+08:00
- **终止原因**：`APPROVED`（Human T2 终审 · **路径 A**：采纳 Round-1 REJECT 报告全部发现项 + 分流到 COSTRA-102 / COSTRA-112 兜底修复）
- **Review 档位**：D-013 **T2 Gate 前 Review**（Sprint-1 末 G4 合并闸门依据之一 · 审计类专项卡特殊档位）
- **触发指令**：`approve:COSTRA-118`（Human · 2026-04-27 09:39）
- **覆盖范围**：miniprogram/ 全量（19 个 .ts + 8 个 .wxml + 9 个 .wxss + 11 个 .json + 1 README · 7 维契约审）

---

## 卡定位

- **标题**：miniprogram 技术债专项普查
- **Owner**：Review-Agent-Tech（审计类专项卡 · Owner = Reviewer 本身 · D-014 特殊路径）
- **性质**：**单轮即报即结**（无 Revise 方 · D-011 自动循环不适用 · D-016 同轮兑现适用）
- **依赖**：COSTRA-030（骨架放行）· COSTRA-100（G3 契约补齐）· COSTRA-101（登录契约事实源）
- **估点**：**0 点**（审计类不计 Sprint-1 工作量 · 参照 COSTRA-106 Retro 先例）
- **交付时间**：2026-04-24 19:35 Round-1 产出 → 2026-04-27 09:39 Human T2 approve（跨机迁移期间挂起 2 天 · 不影响结论）

---

## 轮次摘要

| Round | 执行方 | Verdict | 总分 | P0 | P1 | P2 | 报告 |
|---|---|---|---|---|---|---|---|
| 1 | review-agent-tech | **REJECT** | 15/35 | 10 | 5 | 4 | [`round-1-tech.md`](./round-1-tech.md) |

**特殊说明**：审计类专项卡模型为"单轮交付 · Human 终审即闭环"。不存在 Round 2 · 不存在 Revise 方。REJECT verdict 并非要求 Reviewer 重审，而是**报告质量自评为"必须触发分流"级别**（P0=10 > 3 硬性触发）· 与常规开发卡的 REJECT 语义不同。

---

## Human 终审决策

### 选定路径：🟢 **路径 A** `approve:COSTRA-118` + 发现项分流

**决策依据**（对齐 Reviewer 推荐）：
1. 10 个 P0 中 **8 个**（P0-2 TokenPair 错配 / P0-3 refresh 字段名 / P0-4 Idempotency / P0-5 Error 解析 / P0-6 sync 端点幻觉 / P0-7 Entity 枚举 / P0-10 part A getUserInfo / P0-1 code 日志）本就是 **COSTRA-102（MiniApp 登录→首页→记一笔端到端）切真实后端**的必经之路 · 天然修复
2. **P0-8**（toUtcIso 双减时区 BUG）+ **P0-9**（CSS 变量全站不一致 · 快修方案 A）由 COSTRA-102 MiniApp-Agent 顺手修
3. **P0-10 part B**（隐私页占位）依赖 COSTRA-109 PM 草稿产出 · 不阻 COSTRA-102 启动 · 草稿到手后由 MiniApp 同步即可
4. 不拆 COSTRA-119 紧急修复卡（路径 B）的理由：
   - Sprint-1 总估点已顶格 40 点 · 无预算空间
   - COSTRA-102（5 点）已在 Todo-等触发态 · 04-30 Sprint 中点就会启动 · 独立拆卡反而制造并发冲突
   - P0-1（code 日志）虽属安全红线，但当前 miniprogram 仍在 Mock 模式 · 未接真实 `wx.login` · 风险面为 0 · 可容忍延到 COSTRA-102 实装时一并修
5. 不选路径 C `reject:COSTRA-118` 的理由：Reviewer 置信度"中"源于未读 charter §7/§13 和 docs/db · 但 miniprogram 纯前端结论不依赖这两份 · 重审无增量价值

### 终审要点逐条核对

#### ✅ 10 个 P0 分流去向明确（见下方 §分流矩阵）
- 8 条 → COSTRA-102 扩展验收项（必修 · 纳入 DoD）
- 1 条（P0-10 part B）→ COSTRA-109 PM 产出后由 COSTRA-102 MiniApp-Agent 同步
- 0 条留在本卡未决

#### ✅ 5 个 P1 分流去向明确
- P1-1 decimal.js → FU-118-6 已登记 · 认领到 COSTRA-102
- P1-2 自造 NETWORK_ERROR code → 随 COSTRA-102 request.ts 改造一并处理
- P1-3 outbox 载荷 camelCase → 随 COSTRA-103（本地持久化）改造处理
- P1-4 `/ledger/summary` TODO 幻觉 → COSTRA-102 修 home 页时顺手纠正 TODO 文案
- P1-5 CURRENT_ENV 硬编码 → 骨架期已声明 · 认领 COSTRA-108 CI 注入

#### ✅ 4 个 P2 全入 Follow-ups（Sprint-2）
- FU-118-2 / FU-118-3 / FU-118-4 / FU-118-5 已登记 · 状态 `open`

#### ✅ 灰色区（AppID README）
- 维持 Reviewer 务实派主张 · 降级为 **FU-118-1 观察项**
- **规约侧动作**：Sprint-1 末由 PM-Agent 在 `.team/engineering-guidelines.md §2.5` 补一句显式澄清："AppID 红线仅针对会打包进小程序产物的文件（.ts/.wxml/.wxss/.json 及 project.config.json 以外的运行时产物）· README 等文档类文件豁免"
- 此澄清作为 Sprint-1 Retro（COSTRA-106 · 延至 Sprint-2 头部）的议题之一

---

## 📋 分流矩阵（COSTRA-102 / COSTRA-112 / 其它扩展验收项正式化）

> 以下条目将**追加到 COSTRA-102 / COSTRA-112 的 dispatch 扩展验收段**，并在这两卡的 DoD 中引用本 FINAL 文件。

### → COSTRA-102（MiniApp 端到端 · 主承接卡 · 8 P0 + 3 P1）

| 来源 | 验收项 | 修复位置 | 优先级 |
|---|---|---|---|
| P0-1 | 移除 `services/auth.ts:85` code 前缀日志；改用 `logger.debug('auth.wxLogin', { codePresent, codeLen })` 或直接删行 | miniprogram/services/auth.ts | 必修（红线） |
| P0-2 | 重写 `TokenRaw` 接口对齐 OpenAPI AuthTokenPair：`{access_token, refresh_token, access_token_ttl_sec, refresh_token_ttl_sec, user}`；storage 存 `expires_at = Date.now() + access_token_ttl_sec * 1000` | miniprogram/services/auth.ts:9-14, 96-105 | 必修 |
| P0-3 | `/auth/refresh` 请求体字段名 `refresh` → `refresh_token`（与 P0-2 一并改） | miniprogram/services/auth.ts:125 | 必修 |
| P0-4 | `request.ts` 为写操作（method !== GET）自动注入 `Idempotency-Key` 头（UUID v4）· 允许 caller 显式复用 key（retry 场景） | miniprogram/services/request.ts | 必修 |
| P0-5 | 错误响应解析：`body.error.code` → `body.code`；补 `trace_id` 提取 + ErrorCode 联合类型守卫（消费 `docs/api/error-codes.md` 21 条枚举） | miniprogram/services/request.ts:88-92 | 必修 |
| P0-6 | `syncPull` 重写：端点改 `POST /sync/pull` · body=`{ledger_id, since: lastPulledAt(ISO8601), entities: ['entry','category','budget']}`；废弃 `/sync/{entity}?sinceVersion=` 幻觉路径 | miniprogram/services/sync.ts:40-48 | 必修 |
| P0-7 | `Entity` 枚举改为 `'entry' \| 'category' \| 'budget'`；outbox/storage 的 `collection` 字段跟随调整 | miniprogram/services/sync.ts:8 | 必修 |
| P0-8 | `toUtcIso` 删除双减时区逻辑 · 改为 `d.toISOString()` 一行 | miniprogram/utils/time.ts:11 | 必修 |
| P0-9 | 修 `app.wxss` 补齐使用方期望的 CSS 变量名（`--color-bg` / `--color-surface` / `--color-text` / `--color-text-muted` / `--color-divider` / `--color-primary` / `--color-danger` / `--color-success` / `--shadow-sm` / `--shadow-lg`）· 语义映射到既有 `--color-*-*` 定义 · 彻底方案 B（tokens.json → app.wxss 构建脚本）延到 Sprint-2 FU-118-3 | miniprogram/app.wxss | 必修（快修方案 A） |
| P0-10 part A | `pages/login/index.wxml:12` 去掉 `open-type="getUserInfo"` · 保留 `bindtap="onLoginTap"` · 登录链路改用 `wx.login()` + 首次授权处点击事件内调 `wx.getUserProfile()` | miniprogram/pages/login/index.wxml | 必修 |
| P1-1 | 引入 `decimal.js@^10.4.3` · `utils/money.ts` 重写 `toCents` / `toYuan` 使用 `Decimal.prototype.mul(100).floor()` | miniprogram/utils/money.ts + package.json | 顺手改（FU-118-6） |
| P1-2 | `NETWORK_ERROR` → `CLIENT_NETWORK_ERROR`（加 `CLIENT_` 前缀明示非服务端）· `docs/api/error-codes.md` 新增"客户端内部错误码"专列（需跨 PM/Backend 跨区协调 · Orchestrator 兜底） | miniprogram/services/request.ts:68-71 + docs/api/error-codes.md | 顺手改 |
| P1-4 | `pages/home/index.ts:28` TODO 改为 `// TODO(COSTRA-401 或 Epic-F): 调 POST /reports/monthly { ledger_id, month }` | miniprogram/pages/home/index.ts:28 | 顺手改 |

### → COSTRA-103（本地 SQLite/IndexedDB 持久化 · 1 P1）

| 来源 | 验收项 | 修复位置 | 优先级 |
|---|---|---|---|
| P1-3 | outbox 载荷统一 snake_case · 补 `ledger_id` / `currency` 字段；从当前选中账本读 `ledger_id`（未来家庭账本切换接口预留） | miniprogram/pages/entry/index.ts:47-53 + outbox schema | 必修 |

### → COSTRA-108（miniprogram-ci 演练 · 1 P1）

| 来源 | 验收项 | 修复位置 | 优先级 |
|---|---|---|---|
| P1-5 | `services/env.ts:50` CURRENT_ENV 硬编码 → miniprogram-ci 上传时通过 `compileMode` 或构建脚本注入；骨架期占位转正规 | miniprogram/services/env.ts + infra/scripts/mp-ci.mjs | 必修 |

### → COSTRA-109（PM 隐私指引辅助清单 · P0-10 part B 后置依赖）

| 来源 | 验收项 | 修复位置 | 优先级 |
|---|---|---|---|
| P0-10 part B | COSTRA-109 PM 产出隐私草稿后 · COSTRA-102 MiniApp-Agent 同步填入 `pages-family/privacy/index.wxml` · 替换占位 | miniprogram/pages-family/privacy/index.wxml | 必修（链上） |

### → Sprint-2（FU 清单 · 4 P2 + 1 P1 延后）

| FU-ID | 认领建议 |
|---|---|
| FU-118-1 | Sprint-1 末 engineering-guidelines §2.5 AppID 豁免澄清（PM-Agent） |
| FU-118-2 | 合并 FU-001 · Sprint-2 用户资料卡 |
| FU-118-3 | Sprint-2 COSTRA-160（暂定）`miniapp-design-tokens-pipeline` |
| FU-118-4 | Sprint-2 COSTRA-106 Retro 一次性纠正卡号幻觉 |
| FU-118-5 | Sprint-2 合入 COSTRA-903 APM 卡 |

---

## Review 机制观察（审计类专项卡首次实战沉淀）

### ✅ 兑现项
1. **D-016 第二次实战合规**：Human 19:30 触发 → Orchestrator 同 tool call 循环内 ~12 分钟交付 5 产物 · 无跨轮异步承诺
2. **审计类专项卡范式立案**：Owner=Reviewer 本身 · 单轮即报即结 · 无 Revise 方 · D-011 不适用 · D-016 适用 · 为 Sprint 末期技术债扫描建立模板
3. **分流机制有效性**：10 P0 全部分配到明确承接卡 · 零悬挂 · 每条都有归属 + 修复位置 + 优先级

### 📝 经验沉淀（待 Sprint-1 Retro 议题）
1. **跨机迁移对审计类卡的时延影响**：2026-04-24 Round-1 产出 → 2026-04-27 Human 终审（间隔 ~60h · 原因是 04-25/04-26 用户做 Mac 跨机迁移 · 无人在场）· 不影响结论但建议未来为审计类卡设置"Human 终审 SLA 72h"软约束
2. **审计类卡的 verdict 语义需澄清**：本卡 Round-1 REJECT 实为"报告自评为必须分流级别"· 与常规开发卡 REJECT（要求 Agent 重写）语义不同 · 建议 `SOP-REVIEW.md §10` 增一小节说明 `audit-special` 类型的 verdict 解读规则
3. **10 P0 中 8 条与 COSTRA-102 天然重合**：说明 Sprint-1 初期可考虑"先 COSTRA-102 端到端 → 再做审计"的顺序 · 减少虚高 P0 数量 · 议入 Retro

---

## 下游解锁 & 被解锁

### 解锁
- **COSTRA-102**（MiniApp 端到端）· 已含明确扩展验收项 · 即刻可触发 `run miniapp COSTRA-102`
- **COSTRA-112**（主体字样清扫）· 与 COSTRA-102 并行即可
- **COSTRA-103**（本地持久化）· P1-3 正式入 DoD

### 不解锁 / 不阻塞
- **COSTRA-115**（DNS 白名单 CI）· 独立 DevOps 路径 · 04-25 截止已逾期 · 另行 Human 触发
- **COSTRA-114**（DevOps 手册）· 独立 DevOps 路径 · 与本卡无依赖
- **COSTRA-101**（§6.1.a + §6.1.b）· 已 04-24 19:28 独立收官 · 与本卡结论无耦合

---

## 产物清单

| 产物 | 路径 | 本轮状态 |
|---|---|---|
| 立卡 dispatch | `.team/dispatch/COSTRA-118-miniprogram-tech-debt-audit.md` | ✅ Round-1 产出 |
| Round-1 Tech Review 报告 | `.team/reviews/COSTRA-118/round-1-tech.md` | ✅ Round-1 产出 |
| **FINAL（本文件）** | `.team/reviews/COSTRA-118/FINAL.md` | ✅ **本轮产出（T2 approve 签字）** |
| metrics 第 4 条更新 | `.team/metrics.json` | ✅ human_final_decision=approve |
| STATE / board 同步 | `.team/STATE` · `.team/board.md` | ✅ COSTRA-118 归 Done |
| Follow-ups 状态流转 | `.team/follow-ups/README.md` | ✅ FU-118-1~6 状态维持 + owner_card 字段补齐 |
| 分流注记（正式化） | 本 FINAL §分流矩阵 | ✅ COSTRA-102/103/108/109 扩展验收项登记 |
| 消息日志 | `.team/messages/2026-04-27.jsonl` | ✅ 新建（跨机迁移后首条） |

---

## Refs

COSTRA-118（本卡）· COSTRA-102（主承接 · 8 P0 + 3 P1）· COSTRA-103（1 P1）· COSTRA-108（1 P1）· COSTRA-109（P0-10 part B 链上）· COSTRA-030（上游骨架）· COSTRA-100/101（契约事实源）· D-011 / D-013 / D-014 / D-016 / ADR-0002

---

**签字**：Human T2（2026-04-27 09:39+08:00）· Orchestrator 收口于同 tool call 循环（D-016 第三次实战合规）
