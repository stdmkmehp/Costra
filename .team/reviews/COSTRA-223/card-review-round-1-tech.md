# COSTRA-223 卡定义 Review · Round 1 · Tech + Product

> **触发**：`card-review:COSTRA-223`  
> **审查时间**：2026-06-02 16:40  
> **审查对象**：`.team/dispatch/COSTRA-223-miniapp-family-page.md`  
> **分流归属**：**Tech + Product 双审**（前端数据接入 + UI/UX 设计还原）  
> **参照设计**：`design/ui/design_spec.md §6.5` + `design/ui/interaction_flow.md §6`  
> **参照 API**：`server/src/services/familySummaryService.ts` Response Schema

---

## 评分总览

| 维度 | 满分 | 得分 | 说明 |
|---|---|---|---|
| C1 标题与描述清晰度 | 5 | **5** | 标题精准、背景/目标/范围三要素齐全 |
| C2 DoD 可度量 | 6 | **5** | 可验收条目丰富，但缺少部分自动化判定标准细节 |
| C3 依赖识别 | 5 | **5** | 上下游识别完整，依赖卡均已 CLOSED |
| C4 产出物具体 | 5 | **4** | 文件路径清晰，但缺少与 API response schema 的 field mapping |
| C5 风险与边界 | 4 | **3** | 年度维度已标注降级，但缺少部分边界处理 |
| C6 与既有卡去重 | 3 | **3** | 无重复/冲突 |
| C7 估点合理性 | 2 | **2** | 5pt 与 COSTRA-220（明细页真实数据）同量级，合理 |
| C8 红线检查 | — | **PASS** | 无违反 |
| **总分** | **30** | **27** | |

---

## Verdict：`PASS-WITH-FOLLOWUP`（27/30）

**结论**：卡定义质量高，可进入 Todo / 等 Human `start:COSTRA-223`。以下 follow-up 不阻塞，但建议实装前修订或实装时注意。

---

## 问题列表

### P2-1 · 年度维度 API 不存在——dispatch 需明确降级策略

**位置**：§5.7 / §8  
**现状**：Dispatch 写"年度维度：`?month=YYYY`（或 API 预留 `dimension=yearly`，具体以 222 API 实际实现为准）"。  
**事实**：COSTRA-222 API **不支持年度维度**。`summaryQuerySchema` 仅接受 `month` (YYYY-MM) + `top_n`，`additionalProperties: false`。  
**影响**：若 miniapp-dev 尝试传 `dimension=yearly` 或 `month=2026` 将得到 400。  
**建议**：  
- 明确 R1 scope：**月度优先，年度 Tab 暂时 hidden 或 coming-soon 灰化**。
- 若需年度，需另立卡扩展 222 API（候选 Sprint-6 `COSTRA-224` 或 222 追加 dimension 参数）。
- 前端不得自行循环调 12 次月度 API 拼装年度（性能 / UX / API quota 不可接受）。

---

### P2-2 · `segments` 字段未在 dispatch 提及——Segmented Bar 数据源不明

**位置**：§5.5 Segmented Bar  
**现状**：Dispatch 写"纯 CSS 实现（`display: flex` + 各段 `flex` 按金额比例）"，但未指明数据来自 API response 的哪个字段。  
**事实**：API response 有专门的 `segments[]` 数组，每项含 `key` / `type` / `label` / `amount` / `ratio_bps` / `member_status`，天然映射 Segmented Bar 各段。  
**建议**：miniapp-dev 实装时直接使用 `summary.segments` 驱动 Segmented Bar：
```
segments.forEach(seg => { flex: seg.ratio_bps; color: seg.type === 'shared' ? green : memberPalette[i] })
```

---

### P2-3 · Solo Landing 摘要数据来源未明确

**位置**：§2.2  
**现状**：Solo Landing 说"简化为个人本月总支出/收入/结余摘要"，但未指明数据来源。  
**事实**：用户处于 personal family 时，仍可调用 `GET /v1/families/{personal_family_id}/summary?month=YYYY-MM` 获取 personal family 的 `totals.expense / income / balance`。  
**建议**：dispatch 应明确 Solo Landing 复用 summary API（personal family），不需另立接口或本地计算。

---

### P2-4 · 多家庭切换交互未设计

**位置**：全卡  
**现状**：Dispatch 描述了单 shared family 的展示，但未明确"用户同时存在多个 shared family 时如何切换"。  
**事实**：`design_spec.md §1` 明确"一个用户可以同时存在于多个家庭"。`GET /v1/families` 可能返回 2+ shared families。  
**影响**：若 R1 只展示 active family 不提供切换入口，需标注为 known limitation。  
**建议**：
- R1 scope：**默认展示当前 active shared family**（通过 `services/family.ts` 现有 context）。
- 切换入口可复用明细页已有的"账本切换 ActionSheet"模式（点击顶部家庭名 → ActionSheet 选择其他 family）。
- 若 R1 不做切换，在页面标注或 dispatch 中注明 known scope limit。

---

### INFO-1 · `personal_by_member[]` 结构可直接驱动数据明细列表

API response 的 `personal_by_member[]` 每项含：
```typescript
{ user_id, nickname, avatar_url, status, expense, categories[] }
```
可直接渲染"各成员个人支出行 + mini 头像 + 下钻分类排行"。Dispatch §3.1 未提及此字段但 §5.6 隐含依赖。实装时注意对齐。

---

### INFO-2 · `paid_contributions[]` 直接映射垫付贡献展示

API response 的 `shared.paid_contributions[]` 每项含：
```typescript
{ user_id, nickname, avatar_url, status, amount, ratio_bps }
```
可直接渲染"史蒂夫付 ¥5000 / 爱丽丝付 ¥3000"。实装时 `amount` 为 cents 需 ÷ 100。

---

### INFO-3 · 分类排行 Top N 默认 6 由 API `top_n` 参数控制

Dispatch §5.6 写"仅展示 Top 6"。API 默认 `top_n=6`（可配 1~20）。前端无需额外截断，API 已处理。若需不同 N 值，传 `?top_n=N`。

---

## Product 审查补充

### 设计还原度评估

| 设计规范要求 | Dispatch 覆盖 | 备注 |
|---|---|---|
| Solo Landing 引导态 | ✅ §2.2 | 文案/CTA/色号/字号全到位 |
| 多人家庭名称 28px 居中 | ✅ §2.3.1 | OK |
| 成员横滚 + scrollbar hidden | ✅ §5.1 | OK |
| 已退出灰化 grayscale+opacity | ✅ §5.1 | OK |
| 邀请 [+] 绿色圆形 | ✅ §2.3.2 | OK |
| 创建者 ActionSheet 管理 | ✅ §5.3 | OK |
| 时间导航 `[<] month [>]` | ✅ §5.7 | OK |
| Segmented Bar 8px | ✅ §5.5 | 数据源需补 `segments` 字段 |
| 公共支出 + 垫付贡献 | ✅ §2.3.3 | OK |
| Accordion 下钻 + 省略逻辑 | ✅ §5.6 | OK |
| 零值排除 | ✅ §5.6 | OK |
| 背景 #f1f2ec | ✅ §2.4 | OK |
| 导航栏标题"家庭" | ✅ §2.4 | OK |
| 空态无卡通/插画 | ✅ §2.4 | OK |
| 多家庭切换 | ❌ 未涉及 | P2-4 |

**Product 结论**：设计还原覆盖率 **14/15 = 93%**。唯一未覆盖点为多家庭切换入口（P2-4），不阻塞首版实装。

---

## 最终结论

| 项 | 结论 |
|---|---|
| Verdict | **PASS-WITH-FOLLOWUP** |
| 总分 | **27/30** |
| P0 | 0 |
| P1 | 0 |
| P2 | 4（P2-1 ~ P2-4） |
| INFO | 3 |
| 是否阻塞 start | **否** |
| 建议 | miniapp-dev 实装时注意 4 个 P2 follow-up；年度维度 R1 不做；多家庭切换可 R1 简化处理 |

---

## 待触发清单

1. **`start:COSTRA-223`** —— Human 明确触发后 spawn `costra-miniapp-dev`。
