# Costra · Sprint-0 & Sprint-1 Agent 工作内容盘点

- **整理人**：Orchestrator
- **整理时间**：2026-04-23 20:05
- **用途**：Human 快速对齐"每个 Agent 分别在忙什么/交付了什么/产物在哪"
- **事实源**：`.team/board.md` / `.team/sprints/sprint-01-plan.md` / `.team/decisions/D-00*.md`

---

## 🧭 一页总览

| 维度 | Sprint-0（2026-04-21 ~ 04-22） | Sprint-1（2026-04-23 ~ 05-06） |
|---|---|---|
| **模式** | `execute-now` 冲刺 Bootstrap | `dispatch-ready` 常规节奏 |
| **主题** | 把 5 大闸门全部拉到 Ready | 单人记账端到端 **+** G3 补齐 |
| **卡数** | 10 张 · 28 点 · ✅ 全部收官 | 16 张 · 39 点 · 🟢 进行中 |
| **闸门** | G1 ✅ / G2 ✅ / G3 ✅(+follow-up) / G5 🟡Preempt | 目标到 G4 ✅ |

> Sprint-1 实际入档 **16 张卡**（初始 8 张 + D-007/D-008/D-009 批次追加 COSTRA-108~115），估点 39（看板现值），比原 plan 的 29 点多 10 点，来源见 §3.2。

---

## 1. Sprint-0 · 各 Agent 工作完成清单

> 全部 10 张已 Done。下表按 Agent 聚合，便于你横向对比谁在 Sprint-0 扛了多少。

### 1.1 PM-Agent（3 张 · 6 点）

| 卡号 | 标题 | 交付产物 | 闸门 |
|---|---|---|---|
| COSTRA-001 | 项目章程与目标对齐 | `docs/charter.md v2.2` | G1 ✅ 2026-04-21 |
| COSTRA-002 | PRD v0.1（MVP · 小程序版） | `docs/PRD.md` | G1 ✅ 2026-04-21 |
| COSTRA-003 | 技术栈 ADR 评审 | `ADR-0001` / `ADR-0002` / `ADR-0003` | G1 ✅ 2026-04-21 |

### 1.2 Design-Agent（2 张 · 5 点）

| 卡号 | 标题 | 交付产物 | 闸门 |
|---|---|---|---|
| COSTRA-010 | 信息架构 + 用户故事地图 | `docs/design/ia.md` · `user-story-map.md` · `flows/*` | G2 ✅ 2026-04-22 |
| COSTRA-011 | 设计系统 v0.1 + 分享卡片 | `docs/design/design-system.md` · `tokens.json` · `share-cards/*` | G2 ✅ 2026-04-22 |

### 1.3 Backend-Agent（2 张 · 8 点）

| 卡号 | 标题 | 交付产物 | 闸门 |
|---|---|---|---|
| COSTRA-020 | OpenAPI v0.1 + 错误/冲突/审计 | `api/openapi.yaml` · `docs/api/{README,conflict-strategy,audit-log}.md` | G3 ✅ **approve-with-follow-up**（遗留 → Sprint-1 COSTRA-100） |
| COSTRA-021 | DB Schema v1 + docker-compose | `server/db/schema.sql` · `migrations/*` · `docker-compose.yml` | G3 ✅ 2026-04-22 |

### 1.4 MiniApp-Agent（1 张 · 5 点）

| 卡号 | 标题 | 交付产物 | 闸门 |
|---|---|---|---|
| COSTRA-030 | 小程序工程骨架 + 登录 Mock 闭环 | `miniprogram/` 骨架 · `pages/login` · camelCase↔snake_case 映射层 · 分包配置 | G2/G3 ✅ 2026-04-22 |

### 1.5 DevOps-Agent（1 张 · 2 点）

| 卡号 | 标题 | 交付产物 | 闸门 |
|---|---|---|---|
| COSTRA-040 | CI/CD 占位流水线 + mp-ci 脚本 | `.github/workflows/*` · `docs/devops/*` · `scripts/mp-ci/*` | G5 🟡 **Preempt-Ready**（真实上传链路依赖外部资源） |

### 1.6 QA-Agent（1 张 · 2 点）

| 卡号 | 标题 | 交付产物 | 闸门 |
|---|---|---|---|
| COSTRA-050 | 测试策略 + 冒烟 + 微信审核自查 | `docs/qa/strategy.md` · `smoke-cases.md`（S-01~S-08） · `wx-review-selfcheck.md` | G2/G3 ✅ 2026-04-22 |

### Sprint-0 小结

- **亮点**：2 小时完成原本 2 周的 Bootstrap，所有 Agent 并行产出无互相阻塞
- **遗留**：COSTRA-020 G3 approve-with-follow-up 5 项 → 全部归口到 Sprint-1 `COSTRA-100`
- **关键决议**：`D-006-human-approvals-g2-g3.md`（G2/G3 放行批文）

---

## 2. Sprint-1 · 各 Agent 工作内容（含状态）

> 状态图例：✅ Done / ⏳ AI-Review 循环中 / 🙋 Human-Review / 🔄 Doing（已触发） / 🔴 **未触发**（等 Human 说话）/ ⏸ Blocked

### 2.1 Backend-Agent（4 张 · 15 点）

| 卡号 | 标题 | 状态 | 关键依赖 | deadline |
|---|---|---|---|---|
| **COSTRA-100** | G3-gaps-plus 契约补齐（error-codes / ErrorCode 枚举 / TTL / id-strategy / sync-protocol） | ⏳ **AI-Review 自动循环 Round 2/5** | D-006 | 2026-04-23 18:00（已产出，在审） |
| COSTRA-101 | `/auth/login` + `/auth/refresh` + `/auth/logout` 实装 | 🔴 未触发 | COSTRA-100 放行 | 2026-04-25 |
| COSTRA-104 | `/entries` CRUD + `/sync/push` 批量通道 | 🔴 未触发 | COSTRA-100 / 103 | 2026-05-04 |
| **COSTRA-113** | `server/src/config/subject.ts` + `.env.production.example` SUBJECT 段 | 🙋 **Human-Review** | D-008 / COSTRA-100 搭车 | ✅ 已产出 2026-04-23 17:50 |

**Backend 产物现状**：
- 已落盘：`docs/api/error-codes.md` / `ttl-policy.md` / `id-strategy.md` / `sync-protocol.md` / `server/src/errors/ErrorCode.ts` / `server/src/config/subject.ts` / `.env.production.example` · OpenAPI 注入 ErrorCode 枚举 + AuthTokenPair TTL 字段
- 决议：`D-010-costra-100-g3-gaps-delivered.md`
- 审计：`.team/reviews/COSTRA-100/round-1-tech.md`（Review-Tech Round-1 REVISE · 3 P0 / 4 P1 / 3 P2 · 26/30）

---

### 2.2 PM-Agent（5 张 · 5 点 · 全部越线或贴线）

| 卡号 | 标题 | 状态 | deadline | 备注 |
|---|---|---|---|---|
| COSTRA-106 | Sprint-0 Retro + 工程度量刷新 | 📌 **延至 Sprint-2 头部** | — | Orchestrator 批准延期 |
| COSTRA-107 | ICP 备案辅助文档 | ✅ 已完成并提交接入商（`docs/ops/icp-checklist.md`，备案已提交等通管局） | — | — |
| **COSTRA-109** | 隐私指引填写辅助清单 | 🔴 **未触发 · 🔥 越线 2h+** | 2026-04-23 18:00 | 依赖 D-007 |
| **COSTRA-110** | 订阅消息 ×3 文案草稿 | 🔴 **未触发 · 🔥 越线 8h+** | 2026-04-23 12:00 | 依赖 D-007，Human 要拿去微信后台申请模板 |
| COSTRA-111 | 主体可替换字段清单 `docs/ops/subject-compat-matrix.md` | 🔴 未触发 | 2026-04-24 18:00 | 依赖 D-008 |

**PM 小结**：**2 张硬 deadline 已越线**（COSTRA-109 / 110），是当前 Sprint-1 最紧迫的触发项。

---

### 2.3 MiniApp-Agent（2 张 · 6 点）

| 卡号 | 标题 | 状态 | 依赖 | deadline |
|---|---|---|---|---|
| COSTRA-102 | MiniApp 登录 → 首页 → 记一笔 端到端（非 Mock） | 🔴 未触发 | COSTRA-101 | Sprint-1 W2 |
| COSTRA-103 | 本地 SQLite/IndexedDB 持久化 + outbox_queue | 🔴 未触发 | COSTRA-100 | Sprint-1 W1/W2 |
| COSTRA-112 | `miniprogram/config/subject.ts` + 硬编码主体字样清扫 | 🔴 未触发 | D-008 | Sprint-1 D3 |

---

### 2.4 DevOps-Agent（3 张 · 6 点）

| 卡号 | 标题 | 状态 | 依赖 | deadline |
|---|---|---|---|---|
| COSTRA-108 | miniprogram-ci 上传演练（key 已落位） | 🔴 未触发 | D-007 | 2026-04-24 18:00 |
| **COSTRA-114** | 开发服务器 bootstrap（SSH 加固 / 防火墙 / docker / nginx + 自签 HTTPS） | 🔴 未触发 | D-009 | 2026-04-25 18:00 |
| **COSTRA-115** | `costra.cloud` DNS 子记录 + 白名单一致性 CI 校验 | 🔴 未触发 | D-009 | 2026-04-25 18:00 |

---

### 2.5 QA-Agent（1 张 · 3 点）

| 卡号 | 标题 | 状态 | 依赖 | deadline |
|---|---|---|---|---|
| COSTRA-105 | 单人记账闭环冒烟（含离线弱网） | 🔴 未触发（被 COSTRA-102/104 阻塞） | COSTRA-102 / 104 | Sprint-1 D8（05-05） |

---

### 2.6 Review-Agent-Tech（新增角色 · D-011）

| 卡号 | 标题 | 状态 | 备注 |
|---|---|---|---|
| COSTRA-100 Round-1 Review | 对 Backend 产出做技术审 | ✅ 已出 REVISE verdict | 评分 26/30 · 3 P0/4 P1/3 P2 |
| COSTRA-100 Round-2 Review | Round-2 自动复审 | ⏳ 待 Backend 改完触发 | D-011 自动循环 |

---

## 3. 对比与观察

### 3.1 各 Agent 负载对比

| Agent | Sprint-0 卡数 | Sprint-0 点 | Sprint-1 卡数 | Sprint-1 点 | 总计点 |
|---|---|---|---|---|---|
| **Backend** | 2 | 8 | 4 | 15 | **23** 🥇 |
| **PM** | 3 | 6 | 5 | 5 | 11 |
| **MiniApp** | 1 | 5 | 3 | 11 | 16 |
| **DevOps** | 1 | 2 | 3 | 6 | 8 |
| **Design** | 2 | 5 | 0 | 0 | 5 |
| **QA** | 1 | 2 | 1 | 3 | 5 |
| **Review-Tech** | — | — | 穿插 | 不计点 | — |

**观察**：
- Backend 是双 Sprint 最重仓位，占全量点数 30%+
- Design 在 Sprint-1 "休养生息"（设计系统 v0.1 覆盖到 Sprint-2 家庭共享前不需要大改）
- QA 永远被端到端链路卡在最后，对 Sprint 节奏极敏感

### 3.2 Sprint-1 估点从 29 → 39 的差额来源

| 卡号 | 点 | 来源 |
|---|---|---|
| COSTRA-108 | 3 | D-007 追加（miniprogram-ci 演练） |
| COSTRA-109 | 1 | D-007 追加 |
| COSTRA-110 | 1 | D-007 追加 |
| COSTRA-111 | 1 | D-008 追加（主体兼容矩阵） |
| COSTRA-112 | 1 | D-008 追加（MiniApp subject 清扫） |
| COSTRA-113 | 1 | D-008 追加（Backend subject 搭车，已并入 COSTRA-100） |
| COSTRA-114 | 2 | D-009 追加（开发服务器 bootstrap） |
| COSTRA-115 | 1 | D-009 追加（DNS + 白名单 CI） |
| **合计** | **+11** | 3 个重大决议落地产生的工程化跟进 |

> ⚠️ 对照 charter §5 的"≤ 40 工时 / sprint" 硬约束，当前 39 点**贴线**。如果 COSTRA-100 Review 循环超过 Round-3 还要 revise，需要考虑把 COSTRA-111 / 112 推迟到 Sprint-2。

### 3.3 风险雷达

| 风险 | 影响 | 触发条件 |
|---|---|---|
| 🔥 PM 2 张越线（109 / 110） | Human 拿不到微信后台填表/申请模板的清单，关键路径反压 | 今晚 22:00 前仍未触发 |
| ⏳ COSTRA-100 自动循环 Round 数超预期 | 阻塞 COSTRA-101 / 104，间接阻 MiniApp-102 / QA-105 | Round-3 仍 REVISE |
| 🟡 开发服务器未 bootstrap | COSTRA-102 真实登录无法在 04-30 Human 验证 | COSTRA-114 在 04-25 前未完成 |
| 🟡 ICP 备案延迟 | 阻塞 Sprint-2 真实上线（`api.costra.cloud` 无法进白名单） | 通管局 04-28 前无首审短信 |

---

## 4. 下一步建议（给 Human 的优先级排序）

| 优先级 | 动作 | 触发指令 | 理由 |
|---|---|---|---|
| 🔥 **P0** | 先清 PM 2 张越线卡 | `开干 COSTRA-110` → `开干 COSTRA-109` | 今晚拿到文案/清单，明早可去微信后台办手续（阻塞关键路径） |
| 🟠 **P1** | 审 COSTRA-113 Human-Review | `approve:COSTRA-113` / `revise:...` | 不卡 COSTRA-100，独立闭环 |
| 🟡 **P2** | 放 DevOps 2 张上路 | `开干 COSTRA-114` → `开干 COSTRA-115` | 04-25 前完成，留 5 天冗余给 COSTRA-102 验证 |
| 🟢 **P3** | COSTRA-100 自动循环继续跑 | _（D-011 已启自动）_ | Backend 改完自动触发 Review Round-2，无需你动手 |
| 🟢 **P3** | MiniApp / QA | `开干 COSTRA-112`（subject 清扫先跑，不依赖 COSTRA-101） | 其余 102/103/105 都要等 Backend 闭环 |

---

## 📎 附：关键文档索引

| 文档 | 作用 |
|---|---|
| `.team/board.md` | **唯一事实源**，所有卡状态看这里 |
| `.team/sprints/sprint-01-plan.md` | Sprint-1 原始计划（29 点版） |
| `.team/decisions/D-006 ~ D-011` | Sprint-0/1 期间所有重大决议 |
| `.team/agents/*.md` | 各 Agent 角色规范（SOP） |
| `.team/SOP-HUMAN-TRIGGER.md` | Human 触发规则（铁律：不触发不执行） |
| `.team/SOP-REVIEW.md` | AI-Review 闭环 + 自动循环规则（D-011 + D-013 + D-014 + D-015 + D-016 · 2026-04-24 合并版 v2.0） |
| `.team/STATE` | Orchestrator 当前模式快照 |

