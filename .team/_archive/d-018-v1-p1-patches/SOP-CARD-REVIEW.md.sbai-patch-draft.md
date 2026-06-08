# SOP-CARD-REVIEW.md · SBAI v1.0 对齐补丁（patch-draft）

> 生成时间：2026-05-02 19:12
> 依据：D-018 v1.0-draft
> 目标源文件：`.team/SOP-CARD-REVIEW.md`（HEAD · v1.0 · 367 行）
> 合入方式：Human approve 后 Orchestrator 按补丁逐条 replace_in_file

---

## 补丁 1 · §1 目标（段首加 v2 说明）

### 位置：Line 11~22

### 做法
- 在段首加一行："**SBAI v1.0 版本**（2026-05-02 · D-018 对齐）：'Review-Agent' 术语统一升级为 'card-reviewer-{tech|product}-{card}-r{N} 审查 subagent'（一次性装扮）。其他不变。"

---

## 补丁 2 · §2 分流规则（术语对齐）

### 位置：Line 34~47

### 做法
- 表头 `归属 Review-Agent` → `归属审查 subagent`
- 表内容：
  - `Review-Tech` → `card-reviewer-tech-{card}-r{N}`
  - `Review-Product` → `card-reviewer-product-{card}-r{N}`
- 铁律段保留 · 术语同步更新

---

## 补丁 3 · §4 流程（Step 措辞 SBAI 化）

### 位置：Line 130~164

### 做法
- "Orchestrator 识别 → 拉起对应 Review-Agent" → "Orchestrator 识别 → spawn `card-reviewer-{tech|product}-{card}-r1` 审查 subagent（每轮新实例）"
- "Review-Agent 产出 card-review-round-1-{tech|product}.md" → "审查 subagent 返回 final message · Orchestrator 原样落盘 `.team/reviews/COSTRA-xxx/card-review-round-1-{tech|product}.md`"
- 新增一步（REVISE 路径）："Round N+1 必须 spawn **全新的** `card-reviewer-*-r{N+1}` subagent（不得复用前轮实例）"

---

## 补丁 4 · §6 审查 subagent 报告格式（术语 + Header 加字段）

### 位置：Line 199~248

### 做法
- header 段新增一行：`review-instance: card-reviewer-{tech|product}-costra-xxx-r{N}`
- "Review-Agent" 字样全替换为"审查 subagent"

---

## 补丁 5 · 新增 §8 Spawn Prompt 模板（引用 D-018 §3.3 (C) · 避免冗余）

### 位置：在 §6 后新增 §7 或附加在 §4 流程后

### 做法
- 新增短节："§8 Spawn Prompt（Context Injection Contract · D-018 §3.3）：每次 spawn card-reviewer 审查 subagent · prompt 必须含 §A~§H 八段 · 完整格式见 `.team/decisions/D-018-spawn-based-agent-isolation.md §3.3 (C)`。关键：§B Background（卡号+Sprint+类型+决策引用+关联卡）/ §F 本次任务（卡全文+卡定义详述路径+本轮是第几轮）/ §G 强制阅读清单（charter / engineering-guidelines / COMMON-CONTRACT / 本 SOP §3 Checklist / D-008 / D-013 / D-014 / backlog.json）/ §H 硬约束（无写权 · 信息不足自首 · 禁幻觉）"

---

## 补丁 6 · 版本变更

### 做法
- 在文件末尾加 v2.0 条目：`2026-05-02 | SBAI v1.0 对齐 · 术语"Review-Agent" → "card-reviewer-{tech|product}-{card}-r{N} 审查 subagent" · 每轮新 spawn 不复用 · §6 报告 header 加 review-instance 字段 · §8 新增 Context Injection Contract 引用`

---

## 体量估计

源 367 行 → 合入后 ~380 行（微增 · 主要是 §8 新节）。

---

**本 patch 待 Human 过稿。**
