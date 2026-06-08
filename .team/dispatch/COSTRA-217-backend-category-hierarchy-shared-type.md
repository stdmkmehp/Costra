# COSTRA-217 · B1/B2 数据层重构：二级分类体系 + entries.shared_type

> **派单时间**：2026-06-01（Orchestrator · 接续 UI 重构交接 Phase B）
> **状态**：dispatch v0.4 · Human 新准则（开发期 DB clean rebuild，不兼容旧数据）后修订 · 等 backend-dev 重构
> **Owner**：`costra-backend-dev`
> **类型**：backend / db / api contract
> **估点**：3
> **优先级**：P0
> **来源**：`.team/HANDOFF-2026-06-01-ui-refactor.md` §6 Phase B B1/B2
> **Card-Review R1**：`.team/reviews/COSTRA-217/card-review-1-tech.md` · REVISE 21/30
> **Card-Review R2**：`.team/reviews/COSTRA-217/card-review-2-tech.md` · PASS-WITH-FOLLOWUP 26/30
> **Policy Review R3**：`.team/reviews/COSTRA-217/round-3-policy-tech.md` · REVISE · 已按 Human 新准则改为 clean rebuild

---

## §0 SBAI 装扮路径

| 阶段 | Subagent | 状态 |
|---|---|---|
| Card-Review R1 | `costra-card-reviewer-tech` | REVISE 21/30 · 报告已落盘 |
| Card-Review R2 | `costra-card-reviewer-tech` | PASS-WITH-FOLLOWUP 26/30 · 报告已落盘 |
| R1 实装 | `costra-backend-dev` | 已完成后被 Policy Review 打回 |
| R1.x clean rebuild 重构 | `costra-backend-dev` | 待启动 |
| R1.x Review | `costra-review-tech` | 等重构完成后自动启动 |
| Human T1 终审 | `approve:COSTRA-217` | 等 AI Review PASS 后 |

---

## §1 背景

UI 重构阶段已完成记账 overlay 与明细页初版，但当前分类仍停留在旧的扁平预置分类与前端硬编码模型。下一阶段必须先把服务端数据层升级为真实二级分类体系，并为家庭账本的公共/个人支出拆解提供 `entries.shared_type` 字段。

权威事实源：

1. `.team/HANDOFF-2026-06-01-ui-refactor.md` §6 Phase B：B1/B2 是下一阶段优先任务。
2. `design/ui/category_dictionary.md`：系统默认分类完整字典、重叠二级分类去重、直选默认归属映射。
3. `design/ui/design_spec.md` §6.3：记账页要求双层分类网格与家庭账本公共/个人支出标记。
4. `design/ui/interaction_flow.md` §2：二级分类同名去重与默认归属规则。
5. `server/db/migrations/0001_init.sql` / `0002_seed_system_categories.sql`：当前 `categories` 是扁平预置分类，`entries` 还没有 `shared_type`。
6. `server/api/openapi.yaml`：契约事实源，分类与 Entry schema 需要同步演进。

---

## §1.1 Dependencies

### 上游依赖

- `COSTRA-104`：entries CRUD + sync/push 基础已 CLOSED。
- `COSTRA-152`：PATCH `/entries/{entry_id}` 与跨 family 守门已 CLOSED。
- `COSTRA-153`：DELETE `/entries/{entry_id}` 软删与跨 family 守门已 CLOSED。
- `COSTRA-154`：sync/pull v1.2 `change_seq` 已完成，Entry wire mapping 必须延续。
- `COSTRA-164`：family bootstrap + `0007_families_kind.sql` 已完成，因此本卡 migration 从 `0008` 开始。

### 下游受阻

- B3：后端分类 API 返回真实二级分类与直选默认映射。
- B4：前端分类数据模型替换 `components/expense-overlay/categories.ts` 硬编码。
- C2/C4/C5：明细、统计、家庭页对分类名/图标、公共/个人支出拆解的真实数据依赖。

---

## §2 Scope（B1/B2 · 必交）

### A · DB Migration `0008_categories_hierarchy_seed.sql`：系统分类升级为二级树

新增 `server/db/migrations/0008_categories_hierarchy_seed.sql`，完成：

1. `categories` 支持二级结构与直选默认归属：
   - 增加 `parent_id`，引用 `categories(id)`；
   - 增加 `is_direct_default BOOLEAN NOT NULL DEFAULT false`，表达全局二级展示去重后的直选默认归属；
   - 约束最多两层，禁止三级/自引用；
   - 保留系统分类与后续家庭自定义分类扩展能力；
   - 索引覆盖按 `type + parent_id + sort_order` 拉取分类；
   - 将旧唯一索引 `uq_categories_family_name_type` 替换为包含 `parent_id` 的唯一约束，允许同名二级分类在不同一级下共存；
   - 增加 partial unique index，确保同一 scope/type/name 只有一个 `is_direct_default=true` 的二级分类。
2. 系统分类 seed 全量对齐 `design/ui/category_dictionary.md`：
   - 支出一级：餐饮、交通、购物、生活、旅行、文娱、汽车、其他；
   - 收入一级：职业收入、投资与资产、意外所得；
   - 每个一级下按设计字典生成二级分类；
   - 默认同名子类（如 `餐饮-餐饮`、`交通-交通`）必须作为二级分类存在；
   - 系统分类目标数量：11 个一级分类（8 支出 + 3 收入）+ 62 个二级分类（51 支出 + 11 收入）= 73 条。
3. 同名二级分类允许在不同一级下重复存在；初始全局二级展示区只取 `is_direct_default=true` 的二级分类，直选默认映射必须与 `design/ui/category_dictionary.md` §默认直选归属映射表一致：
   - 直选"餐饮" -> `餐饮-餐饮`；
   - 直选"机票" -> `交通-机票`；
   - 直选"零食" -> `餐饮-零食`；
   - 直选"买菜" -> `餐饮-买菜`；
   - 直选"饮料" -> `餐饮-饮料`。
4. 系统分类 seed 固定为 **clean rebuild** 策略（Human 2026-06-01 新准则）：
   - 开发阶段不保留旧分类 ID，不兼容历史 `entries.category_id`，测试阶段一律清空 DB / 重建表结构；
   - `0008` 开头清空旧系统分类：`DELETE FROM categories WHERE is_system = true AND family_id IS NULL;`，使 `0002_seed_system_categories.sql` 的旧扁平 seed 无害化；
   - 删除 `__migrate__*` 临时重命名、旧 ID 保留、中断态人工恢复等兼容逻辑；
   - 全量插入 11 个一级分类 + 62 个二级分类，所有分类使用新 ID；
   - migration 必须幂等，可重复执行但不为旧数据迁移承担兼容责任。

### B · DB Migration `0009_entries_shared_type.sql`：`entries.shared_type`

新增 `server/db/migrations/0009_entries_shared_type.sql`，支持家庭账本支出拆解：

1. 创建枚举 `entry_shared_type`：`personal` / `shared`。
2. `entries.shared_type` 语义：
   - `expense`：允许 `personal` / `shared`；未传时由服务端默认；
   - `income`：不适用公共收入概念，必须为 `NULL`；
   - `transfer`：暂不进入公共/个人统计，必须为 `NULL`。
3. 默认规则：
   - 单人 personal family 账本 expense 默认 `personal`；
   - 多人 shared family 账本 expense 默认 `shared`；
   - 无法可靠判定 family kind/成员态时，不得静默猜测；服务层必须返回标准错误且不得写入 DB，并在测试中覆盖。
4. DB 层必须给出 CHECK 约束，防止 income/transfer 写入公共支出语义。
5. sync/push 兼容规则：
   - `SyncPushRequest.ops[].payload.shared_type` 可选；
   - 缺省走服务端默认规则；
   - 若传入非法组合（如 `type=income` 且 `shared_type=shared`），服务端返回现有标准错误格式，不得写入 DB。
6. 后续前端 B4 会在多人家庭支出面板展示 `[个人支出 | 公共支出]`，本卡只完成服务端数据层与契约铺垫。

### C · OpenAPI 契约同步

`server/api/openapi.yaml` 为事实源，本卡固定选择 **返回扁平数组 `Category[]`**，不改为嵌套树，理由是 sync/pull 的变更推送天然适合扁平结构，树形组装交给 B4 前端模型处理；此处不是为了兼容旧客户端。

至少同步：

1. `GET /categories` 继续返回 `Category[]`。
2. `Category` 增加：
   - `parent_id: string | null`；
   - `is_direct_default: boolean`；
   - `children_count: integer`（一级分类下二级数量；二级分类为 0）。
3. `CategoryCreate` 同步二级约束：
   - `parent_id` 可选；不传表示创建一级分类，传入表示创建二级分类；
   - `is_direct_default` 与 `children_count` 是服务端只读字段，不允许客户端在 Create/Update 中传入；
   - family 自定义分类不得绕过二级约束。
4. `Entry` / `EntryCreate` / `EntryUpdate` 增加 `shared_type`，按 B 的语义描述 nullable/enum/默认规则。
5. `SyncPullResponse.changes.entries[]` 与 `SyncPushRequest.ops[].payload` 的 Entry payload 说明补充 `shared_type` 可选与默认规则。
6. 不允许只改 DB 不改契约。

### D · 服务端模型与读写路径适配

1. 更新 categories/entries 相关 repository/service/route 的实体与 wire mapping。
2. 创建/更新 entry 时支持 `shared_type`，并执行 B 的服务层校验。
3. 查询、同步拉取、同步推送相关 Entry 映射不得丢失 `shared_type`。
4. 所有涉及 family/ledger/user 的查询必须保持跨 family 守门，不得回退 COSTRA-152/153 已修复的越权问题。

### E · 测试与文档

1. 更新 pg-mem/test setup，使 migration 结构与真实 DB 对齐。
2. 新增/更新测试覆盖：
   - 分类树 seed 数量、parent 关系、排序；
   - 系统分类目标数量：一级 11 条、二级 62 条、总计 73 条；
   - `is_direct_default=true` 的直选二级分类目标数量：55 条（支出 44 + 收入 11；按设计字典原名去重，`火车/高铁` 与 `火车` 视为不同名称）；
   - 重叠二级分类（如 餐饮/机票/零食/买菜/饮料）的多父级存在；
   - 直选默认归属映射能被服务端数据表达；
   - clean rebuild 后不存在旧 ID 保留断言，也不测试历史 entry 的旧 `category_id` 兼容；
   - `0008` 连续执行两次后系统分类数量仍稳定为 73 条；
   - `shared_type` 对 expense/income/transfer 的合法/非法写入；
   - sync pull/push 不丢 `shared_type`。
3. 同步更新 `docs/db/schema.md`，并消除 categories / entries 段与实际 migration 的字段级分歧。
4. 如新增 API 行为，补充 `api/CHANGELOG.md`。

---

## §3 非目标（明确不做）

- 不实现前端 B4：不改 `miniprogram/`，不替换 `components/expense-overlay/categories.ts`。
- 不开发统计页/家庭页 UI。
- 不实现家庭自定义分类管理 UI。
- 不做生产数据库操作；生产 migration 需 Human 审批。

---

## §4 验收标准（DoD）

1. migration 文件必须为 `0008_categories_hierarchy_seed.sql` 与 `0009_entries_shared_type.sql`；连续执行两次不报错，第二次不产生重复系统分类。
2. 分类数据硬断言：系统一级分类 11 条、系统二级分类 62 条、系统分类总计 73 条；`is_direct_default=true` 的系统二级分类 55 条（支出 44 + 收入 11）；`餐饮/机票/零食/买菜/饮料` 默认映射与设计字典一致。
3. `0008` 采用 clean rebuild：不保留旧分类 ID，不兼容历史 `entries.category_id`；清空旧系统分类后全量生成设计字典二级分类体系，连续执行两次数量与默认映射稳定。
4. `server/api/openapi.yaml` 与实现一致：`Category` 固定为扁平数组模型，含 `parent_id/is_direct_default/children_count`；Entry 相关 schema 含 `shared_type`。
5. `docs/db/schema.md` 与 migration 一致，categories / entries 字段级无设计态/实现态分歧。
6. `cd server && npm run typecheck` / `cd server && npm run test` 通过。
7. 关键反向验证：移除 `shared_type` 校验、移除 category parent 约束、或回退唯一索引不含 `parent_id` 时，对应测试必须失败。
8. final message 必须说明：
   - 分类层级策略；
   - 同名二级分类与直选默认归属如何表达；
   - `shared_type` 默认/约束策略；
   - state.md 已更新、history 已落盘；
   - 未提交变更清单（本轮不得自动 git commit，等待 Human 明确提交指令）。

---

## §5 强制阅读清单

- `.team/HANDOFF-2026-06-01-ui-refactor.md`
- `.team/reviews/COSTRA-217/card-review-1-tech.md`
- `.team/reviews/COSTRA-217/card-review-2-tech.md`
- `.team/reviews/COSTRA-217/round-3-policy-tech.md`
- `.team/agents/COMMON-CONTRACT.md`
- `.team/members/backend-dev/state.md`
- `.team/members/backend-dev/history/2026-05-27-costra-164-r1-family-bootstrap.md`
- `.team/members/backend-dev/history/2026-05-22-costra-154-r1x2-watermark-v1.2-upgrade.md`
- `.team/members/backend-dev/history/2026-05-22-costra-152-r1-patch-and-cross-family-guard.md`
- `.team/members/backend-dev/history/2026-05-22-costra-153-r1-soft-delete.md`
- `design/ui/category_dictionary.md`
- `design/ui/design_spec.md`
- `design/ui/interaction_flow.md`
- `server/db/migrations/0001_init.sql`
- `server/db/migrations/0002_seed_system_categories.sql`
- `server/api/openapi.yaml`
- `docs/db/schema.md`

---

## §6 纪律

- Orchestrator 不直接改业务代码；本卡业务产物只能由 `costra-backend-dev` 修改。
- `costra-backend-dev` 禁写 `miniprogram/` / `design/` / `infra/`。
- 本轮受全局工具安全约束：不得执行 `git commit`，除非 Human 后续明确要求提交。
- 任何生产环境数据库操作必须停止并请求 Human 审批。
