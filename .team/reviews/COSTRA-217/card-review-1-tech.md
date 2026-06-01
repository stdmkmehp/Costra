# Card Review · Tech · COSTRA-217 · Round 1

- 卡 Owner：backend-dev
- 卡类型：backend / db / api contract（feature + refactor 混合）
- 卡 points：3
- 审核时间：2026-06-01T12:00:00+08:00
- 上轮结论：首轮

## 总评

- **Verdict**：`REVISE`
- **总分**：21/30 分
- **阻塞点**：2 个 P0 / 4 个 P1 / 2 个 P2

## 维度得分

| 维度 | 得分 | 一句话 |
|---|---|---|
| C1 标题与描述 | 4/5 | 标题清晰 ≤60 字符，描述含背景/目标/范围三要素，但“二级分类体系”与“同名二级分类去重+直选默认归属”概念复杂度高，描述中未拆解核心数据模型决策点 |
| C2 DoD 可度量 | 4/6 | DoD 第 5 条“关键反向验证”可自动化判定是亮点，但第 1 条“migration 编号正确、幂等、可重复执行”缺乏具体判定标准（如“编号=0008”），第 6 条“final message 必须说明…”是流程要求而非验收标准 |
| C3 依赖识别 | 3/5 | 未明确列上游依赖卡（如 COSTRA-164 family bootstrap 对 categories 的影响），未列下游受阻卡（B3/B4 依赖本卡），且未声明对 D-008 主体红线的依赖 |
| C4 产出物具体 | 3/5 | 缺少具体文件路径（migration 文件名仅说“下一号”未写明 0008），缺少函数签名/接口 URL 变更的具体描述，Category 响应策略（树形 vs 扁平）未决策 |
| C5 风险与边界 | 2/4 | 旧扁平分类迁移策略仅说“可软删/迁移/保留兼容”但未定决策，`shared_type` 对 sync/push 的兼容性风险未评估，categories 唯一索引 `(COALESCE(family_id,...), name, type)` 在二级分类下需变更但未提及 |
| C6 去重 | 3/3 | backlog.json 中无 COSTRA-217 记录，board.md 无覆盖，无相似描述卡 |
| C7 估点 | 2/2 | 3 点合理：参照 COSTRA-152（PATCH entries 3 点）和 COSTRA-156（/v1 prefix 2 点），本卡 scope 含 2 个 migration + OpenAPI + service 层适配 + 测试，3 点偏紧但可接受 |
| C8 红线 | Pass | 未硬编码 secret/密钥/主体字样；未越权写 miniprogram/；未违反 Won't-Have；未违反 engineering-guidelines 强硬规则 |

## P0 阻塞点

### P0-1 旧扁平系统分类迁移策略未定

- **证据**：dispatch §2.A 第 4 条“对旧扁平系统分类做可重复执行的迁移策略：不破坏已有 entry 外键；对旧系统分类可软删/迁移/保留兼容，但必须说明策略并用测试覆盖”
- **问题**：当前 `0002_seed_system_categories.sql` 已有 12 条扁平系统分类，且 `entries.category_id` 已有外键引用。本卡要求将扁平分类升级为二级树，旧分类处理策略会影响 migration、seed、外键、唯一索引。
- **修复建议**：明确选定策略。推荐：旧扁平分类保留为二级分类（同名默认子类），旧 ID 不变，新增一级分类并让旧分类 `parent_id` 指向新一级。

### P0-2 Category API 响应结构未决策

- **证据**：dispatch §2.C 第 4 条“若 GET /categories 继续返回数组，必须定义父子关系字段；如本卡选择返回树形结构，必须完整更新响应 schema 并评估客户端影响”
- **问题**：当前 `GET /categories` OpenAPI 返回 `Category[]`。本卡未决策 API 响应是扁平数组、树形结构还是新增端点，直接影响契约、服务端序列化、sync/pull、B4 前端对接。
- **修复建议**：明确选定方案。推荐方案 A：继续扁平数组 + `parent_id` + `children_count`。

## P1 应改

1. 唯一索引 `uq_categories_family_name_type` 在二级分类下会阻断同名二级分类，应改为包含 `parent_id` 的唯一约束。
2. `shared_type` 对 sync/push 协议兼容性未评估，应明确 payload 可选、缺省和非法组合校验规则。
3. 依赖识别不完整，应补上 COSTRA-104/152/153/164 与下游 B3/B4。
4. DoD 缺少具体自动化判定量化标准，应明确 0008/0009、二次迁移、分类数量等。

## P2 建议

1. `docs/db/schema.md` 与实际 `0001_init.sql` 存在设计态/实现态分歧，本卡一并消除 categories/entries 段字段级差异。
2. 估点 3 偏紧，建议标注旧分类迁移策略复杂度可能使实际工作量接近 5 点。

## 给卡作者的回执指令

请 Orchestrator 修订卡定义，关闭 2 个 P0 后触发 Round 2 审核。

## 自我反思

- 审核耗时：约 25 分钟
- 置信度：高
