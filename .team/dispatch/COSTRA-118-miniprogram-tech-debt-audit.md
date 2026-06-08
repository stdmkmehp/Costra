# COSTRA-118 · miniprogram 技术债专项普查

> 版本：v1.0 · 2026-04-24 19:35
> 立案人：Human（2026-04-24 19:30~19:33 三问确认）
> Owner：**Review-Agent-Tech**（专项审查卡 · 特殊路径 · 非常规开发卡）
> Sprint：Sprint-1（新增 · 但**不计估点** · 归为"审计性质"专项 · 参照 COSTRA-106 Retro 先例）
> Gate：**T2 Gate 前**（Sprint-1 末 G4 合并闸门依据之一）
> Review 路径：**单轮交付 · 即报即结**（D-014 审计类专项卡特殊处置 · 见下方 §5）

---

## 1. 背景与动机

Sprint-1 主线已完成 COSTRA-100 / COSTRA-101（§6.1.a + §6.1.b）两张核心卡，**server 端**契约/实装闭环通过 4 轮 Review 完全收敛。但 miniprogram/ 目录自 Sprint-0 COSTRA-030 骨架放行后，**未被系统性审查过**：

- COSTRA-030 Round-2 Skip-Review 于 2026-04-23 21:15 按 D-013 T3 追溯档**自动关闭**（`.team/reviews/SPRINT-0-SKIP-REVIEW.md`），仅做了骨架级快审（29/30），**未深入 7 维契约审**。
- Sprint-1 主线 COSTRA-100 产出 `docs/api/error-codes.md` / `docs/api/id-strategy.md` / `docs/api/ttl-policy.md` / `docs/api/sync-protocol.md` 四份新契约，miniprogram 侧**尚未对齐**。
- COSTRA-101 §6.1.b 落地的 `access_token_ttl_sec` / `refresh_token_ttl_sec` / `Idempotency-Key` / `client_ref_id` 四大新契约字段，miniprogram 侧**是否同步**未知。

Human 19:30 明确触发："让 review agent tech 去 review 一下 miniprogram 内的代码实现"。

## 2. 审查范围

### 2.1 物理范围（全量）

| 类别 | 文件数 | 说明 |
|---|---|---|
| `.ts` 源码 | 19 | services/ × 6 + pages × 6 + pages-stat × 1 + pages-family × 3 + utils × 2 + tokens × 1 |
| `.wxml` 结构 | 8 | pages/* × 3 + pages-stat × 1 + pages-family × 3 + 含占位页 |
| `.wxss` 样式 | 9 | app.wxss + 各页面样式 |
| `.json` 配置 | 11 | app.json / page config × N / tsconfig / sitemap |
| `README.md` | 1 | miniprogram 使用说明 |

### 2.2 审查维度（全量 7 维 · Review-Tech §3）

1. **契约一致性** — openapi.yaml / error-codes / id-strategy / ttl-policy / sync-protocol
2. **架构与分层** — ADR-0002 技术栈 / 目录权限 / 模块职责
3. **数据与持久化** — wx.storage 封装 / outbox_queue / 版本化
4. **离线与同步** — /sync/push|pull / client_ref_id / Idempotency-Key
5. **安全与合规** — code/openid/session_key 日志 / AppID 红线 / D-008 主体红线
6. **可测与可观测** — 单测 / 结构化日志 / TODO 遗留
7. **工程纪律** — Conventional Commits / 文件规模 / 微信文档引用

按 35 分制判定 verdict。

### 2.3 不审内容（排除项）

- `miniapp/` 目录（当前仅 1 个 README · 未来 UniApp 桥接预留）
- `design/` 图稿
- server / api / docs / infra / scripts 任何后端产物
- Sprint-1 其它开发卡进度（独立于 COSTRA-101 终审）

## 3. 验收标准 (DoD)

- [x] Review-Tech 强制上下文加载完成（openapi.yaml / docs/api × 5 / D-008/D-009 / ADR-0002 / engineering-guidelines / COMMON-CONTRACT / 03-miniapp-agent）
- [x] 19/19 `.ts` + 8/8 `.wxml` + 关键 `.json/.wxss/.md` 全量扫描
- [x] 关键 grep 执行：AppID / console / TODO / Secret 四项
- [x] 产出 Round-1 Tech Review 报告 `.team/reviews/COSTRA-118/round-1-tech.md`（~600 行量级）
- [x] 按 7 维打分 + 给 verdict
- [x] P0/P1/P2 清单带证据行号
- [x] 产出 Follow-up 登记（按严重度拆分 FU-00X 或建议分流到 Sprint-1 已有卡 COSTRA-102/112）
- [x] `.team/STATE` / `.team/board.md` / `.team/metrics.json` / `.team/messages/` 同步

## 4. 不做的事（Scope Cut）

- ❌ **不写代码**：Review-Tech 规约 §6 硬约束
- ❌ **不做自动修复 PR**：发现项转 Sprint-1 已有卡 COSTRA-102/112 或新拆子卡
- ❌ **不重评 COSTRA-101 终审**：server 段 19:28 已 Human T1 APPROVED，独立
- ❌ **不做真机回归**：Agent 无真机访问权（COSTRA-114 v2 铁律）

## 5. Review 流程与规约合规

### 5.1 D-014 审计类专项卡特殊处置

本卡 Owner = **Review-Agent-Tech 本身**，属 D-014 §2 "DevOps/QA/决策类豁免"的变体 — 本卡产出**就是** Review 报告。因此：
- **卡定义 Review**：豁免（Owner 即审查方 · 无需再审）
- **产出 Review**：**单轮 · 即报即结**（报告本身是产出 · 无需再叠一层 Review）
- **D-011 自动循环**：不适用（无 Revise 方）
- **D-016 同轮兑现**：**适用**（Orchestrator 声明拉起后必须同轮产出 · 本卡在 Human 19:30 触发后同一 tool call 循环内兑现）

### 5.2 Gate 归属

- **T2 Gate 前**（D-013）· 需要 Human 终审报告结论
- Human 处置路径三选一：
  - `approve:COSTRA-118` — 接受全部发现项，按报告建议分流到 COSTRA-102/112
  - `revise:COSTRA-118` — 指定若干条 P0 立即在本 Sprint 修复（需新拆子卡）
  - `reject:COSTRA-118` — 报告质量不过关，要求 Review-Tech 重审（罕见 · 触发 ESCALATE）

## 6. 产物清单

| 产物 | 路径 | 状态 |
|---|---|---|
| 卡定义（本文件） | `.team/dispatch/COSTRA-118-miniprogram-tech-debt-audit.md` | ✅ 本轮产出 |
| Round-1 Tech Review 报告 | `.team/reviews/COSTRA-118/round-1-tech.md` | ✅ 本轮产出 |
| STATE 同步 | `.team/STATE` | ✅ 本轮产出 |
| board 同步 | `.team/board.md` | ✅ 本轮产出 |
| metrics 第 4 条 | `.team/metrics.json` | ✅ 本轮产出 |
| Follow-ups 新增 | `.team/follow-ups/README.md` | ✅ 本轮产出 |
| 消息日志 | `.team/messages/2026-04-24.jsonl` | ✅ 本轮产出 |

## 7. 相关引用

- **Human 触发原文**：「让 review agent tech 去 review 一下 miniprogram 内的代码实现」@ 2026-04-24 19:30
- **三问确认原文**：scope=新立专项卡 / depth=全量 7 维 / parallel=独立于 COSTRA-101 @ 2026-04-24 19:33
- **规约依据**：`.team/agents/07-review-agent-tech.md` / `.team/SOP-REVIEW.md v2.0` / D-013 / D-014 / D-016
- **契约来源**：`api/openapi.yaml` / `docs/api/error-codes.md` / `docs/api/id-strategy.md` / `docs/api/ttl-policy.md` / `docs/api/sync-protocol.md`
- **被审区**：`miniprogram/` 全量

---

**Refs**: COSTRA-118, D-013, D-014, D-016
