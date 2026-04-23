# Sprint-0 AI-Review 批次索引

> 登记时间：2026-04-23 20:08
> 发起人：Human 指令（"sprint0 里的工作，也需要用 review 机制走一遍"）
> 执行：Orchestrator + Review-Agent-Tech + Review-Agent-Product
> 适用 SOP：`SOP-REVIEW-LOOP.md` + `SOP-REVIEW-AUTOLOOP.md`

---

## 背景说明

Sprint-0（2026-04-21 ~ 2026-04-22）共 10 张卡已于 2026-04-22 以 "execute-now" 模式完成并通过 G1/G2/G3/G5 闸门。当时**尚未建立** AI-Review 机制（D-011 / SOP-REVIEW-LOOP 于 2026-04-23 才生效）。Human 指令要求补审，以统一 Review 覆盖度。

---

## 三档处置

### A 档 · 走 AI-Review（7 张）

| 卡号 | 被审 Agent | Review-Agent | 主产物 |
|---|---|---|---|
| COSTRA-001 | PM-Agent | review-product | `docs/charter.md` |
| COSTRA-002 | PM-Agent | review-product | `docs/PRD.md` |
| COSTRA-010 | Design-Agent | review-product | `docs/design/ia.md` + `user-story-map.md` + `flows/*` |
| COSTRA-011 | Design-Agent | review-product | `docs/design/design-system.md` + `tokens.json` + `share-cards/*` |
| COSTRA-020 | Backend-Agent | review-tech | `server/api/openapi.yaml`（Sprint-0 v0.1 锁时刻） |
| COSTRA-021 | Backend-Agent | review-tech | `docs/db/schema.md` + `docker-compose.yml` |
| COSTRA-030 | MiniApp-Agent | review-tech | `miniapp/` 工程骨架 + 登录 Mock |

**COSTRA-020 补审范围**：仅审 Sprint-0 落盘时刻（2026-04-22）的 v0.1 产出质量 + G3 遗漏项识别（不与 COSTRA-100 重复）。COSTRA-100 已于今天 20:14 闭环 PASS 30/30，不在本次 review 范围内。

### B 档 · 按 SOP §2 免审（3 张）

| 卡号 | Owner | 免审依据 | 处置 |
|---|---|---|---|
| COSTRA-003 | PM-Agent | 决策类（ADR 评审）· SOP-REVIEW-LOOP §2 例外规则 | 登记为 EXEMPT-DECISION |
| COSTRA-040 | DevOps-Agent | DevOps 不走 Review-Agent · SOP-REVIEW-LOOP §2 | 登记为 EXEMPT-DEVOPS |
| COSTRA-050 | QA-Agent | QA 不走 Review-Agent · SOP-REVIEW-LOOP §2 | 登记为 EXEMPT-QA |

### C 档 · 已通过 COSTRA-100 补齐（0 张独立卡）

COSTRA-020 的 G3 遗留 5 项：error-codes / ErrorCode 枚举 / id-strategy / sync-protocol / TTL 已通过 COSTRA-100（今天 AI-Review 30/30 PASS）完成补齐，Sprint-0 COSTRA-020 的 review 只追溯 Sprint-0 时刻（2026-04-22）的 v0.1 质量。

---

## 执行顺序

### 批次 1 · Review-Product（4 张 · 并行产出）
1. COSTRA-001（charter）
2. COSTRA-002（PRD）
3. COSTRA-010（IA + story-map + flows）
4. COSTRA-011（design-system + tokens + share-cards）

### 批次 2 · Review-Tech（3 张 · 并行产出）
5. COSTRA-020（openapi v0.1）
6. COSTRA-021（schema + docker-compose）
7. COSTRA-030（小程序骨架）

### 自动循环规则

按 D-011 方案 B · 任一张卡 verdict=REVISE 时，Orchestrator 自动拉起对应被审 Agent（以补审场景下的"本 Agent 回看自己 Sprint-0 产出做修复"身份）进入 Round 2。最大 5 轮，命中打断条件立即停。

---

## 产物目录

```
.team/reviews/
├── SPRINT-0-INDEX.md                     # 本文件
├── SPRINT-0-EXEMPT.md                    # B 档免审登记
├── SPRINT-0-SUMMARY.md                   # 全部完成后汇总
├── COSTRA-001/ round-N-product.md + ...
├── COSTRA-002/ round-N-product.md + ...
├── COSTRA-010/ round-N-product.md + ...
├── COSTRA-011/ round-N-product.md + ...
├── COSTRA-020/ round-N-tech.md + ...     （不与 COSTRA-100 混）
├── COSTRA-021/ round-N-tech.md + ...
├── COSTRA-030/ round-N-tech.md + ...
└── COSTRA-100/ ...                       （今日已闭环，不动）
```

---

## Human 介入点

- **正常路径**：等所有 7 张 PASS 后看 `SPRINT-0-SUMMARY.md`，一次性 `approve-batch sprint-0-review` 或按卡 `approve:COSTRA-xxx`
- **异常路径**：任一张出 ESCALATE / ROUND-LIMIT / RED-LINE，Orchestrator 立即冒泡并中止其余未开始的 Review
- **打断指令**：`pause-review COSTRA-xxx` / `stop sprint-0-review` / `skip-review COSTRA-xxx`

---

## 后置说明

补审**不改变** Sprint-0 已完成的状态（仍然是 Done / G1-G3-G5 通过）。若 AI-Review 发现 P0，会按 Sprint-1 backlog 追加修复卡（不回滚 Sprint-0 闸门结论）。这与 COSTRA-100 "Sprint-1 卡片补齐 G3 遗留" 的模式一致。
