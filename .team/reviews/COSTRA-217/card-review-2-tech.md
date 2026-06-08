# Card Review · Tech · COSTRA-217 · Round 2

- 卡 Owner：backend-dev
- 卡类型：feature + refactor（backend / db / api contract）
- 卡 points：3
- 审核时间：2026-06-01T14:30:00+08:00
- 上轮结论：REVISE 21/30 · 2 P0（旧分类迁移策略未定 + Category API 响应结构未决策）

## 总评

- **Verdict**：`PASS-WITH-FOLLOWUP`
- **总分**：26/30 分
- **阻塞点**：0 个 P0 / 2 个 P1 / 3 个 P2

## 维度得分

| 维度 | 得分 | 一句话 |
|---|---|---|
| C1 标题与描述 | 5/5 | v0.2 补齐了迁移策略和 API 决策，描述含背景/目标/范围三要素，标题 ≤60 字符 |
| C2 DoD 可度量 | 5/6 | 8 条 DoD 中 6 条可自动化判定，DoD-8 偏流程但可接受 |
| C3 依赖识别 | 5/5 | v0.2 §1.1 明确列出上游 COSTRA-104/152/153/154/164 和下游 B3/B4/C2/C4/C5 |
| C4 产出物具体 | 4/5 | 明确了 0008/0009 migration 文件名、Category 新增字段、Entry shared_type 枚举，但缺少 CategoryCreate 受影响细节 |
| C5 风险与边界 | 3/4 | 旧分类迁移策略、sync/push 兼容规则、唯一索引变更已明确，仍需注意 direct default 数量与 fallback |
| C6 去重 | 3/3 | backlog.json 无 COSTRA-217 记录，board.md 无覆盖 |
| C7 估点 | 1/2 | 3 点偏紧，但 dispatch 已标注风险 |
| C8 红线 | Pass | 未硬编码 secret/密钥/主体字样，未越权写 miniprogram/，§6 纪律段明确不得自动 git commit |

## R1 P0 关闭确认

### P0-1 旧扁平系统分类迁移策略未定 → ✅ 已关闭

- **证据**：dispatch v0.2 §2.A.4 明确固定“保留旧 ID，转化为最接近的 canonical 二级分类”。
- **DoD 覆盖**：§4 DoD-3 要求旧 12 条扁平系统分类 ID 保留并挂接/重命名。

### P0-2 Category API 响应结构未决策 → ✅ 已关闭

- **证据**：dispatch v0.2 §2.C 明确固定继续返回扁平数组 `Category[]`。
- **新增字段**：`parent_id`、`is_direct_default`、`children_count`。

## P1 应改

### P1-1 `is_direct_default=true` 数量与设计字典存在偏差风险

- **问题**：dispatch 声明支出 direct default 为 45，但按设计字典逐项去重后应为 44（收入 11，总计 55）。
- **建议**：实装前修正 dispatch 或在测试中以精确列表为准。

### P1-2 `CategoryCreate` 受二级约束影响的变更细节不足

- **问题**：未说明 `parent_id` 是否必填、`is_direct_default/children_count` 是否允许客户端传入。
- **建议**：明确 `parent_id` 可选；`is_direct_default` 与 `children_count` 为服务端只读，不进 Create/Update。

## P2 建议

1. `docs/db/schema.md` 与 `0001_init.sql` 的分歧需本卡一并消除。
2. 旧分类 `居家→生活-生活`、`娱乐→文娱-文娱` 的名称变更对已有 entry 展示的影响应测试覆盖。
3. `shared_type` fallback 路径应具体化。

## 给卡作者的回执指令

本卡可进入 `backend-dev` R1 实装；建议 Orchestrator 先把 2 个 P1 以轻量修订补入 dispatch。

## 自我反思

- 审核耗时：约 35 分钟
- 置信度：高
