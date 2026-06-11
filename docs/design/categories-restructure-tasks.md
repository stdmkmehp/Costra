# 分类体系重构 + 「转移」类型 · 开发任务手册

> 配套设计文档：`docs/design/categories-restructure-spec.md`（权威方案）
> 本手册用于**任务分派**：每个任务含负责角色、依赖、改动文件、实现要点、验收标准。
> 决策已定：**硬删 + `category_redirects` 重定向表**；转移含三个一级（储值/账户互转/赊销）。

---

## 0. 任务依赖总览

```
T0 (categories.yaml 权威源)  ← 一切的前置
   │
   ├─ T1 (0001 seed 幂等化) ─┐
   ├─ T2 (0004 迁移) ────────┤
   ├─ T3 (test setup DDL) ───┴─→ DB 层就绪
   │
   ├─ T4 (category_type 扩 transfer · 后端类型) ─┐
   ├─ T5 (entry 降级校验 + redirect 查询) ────────┤
   ├─ T6 (categories_revision 下发) ─────────────┤→ 后端就绪
   ├─ T7 (/categories + openapi transfer) ───────┘
   │
   ├─ T8 (前端 categoryService: fallback/tree/类型/签名) ─┐
   ├─ T9 (expense-overlay 转移 tab) ──────────────────────┤
   ├─ T10 (sync.ts 消费 revision) ────────────────────────┤
   ├─ T11 (db.ts/outbox 支持 transfer 类型) ──────────────┘→ 前端就绪
   │
   └─ T12 (测试 & 验收 · 148/148) ← 收口
```

**并行建议**
- T0 必须最先完成（权威源）。
- T1/T2/T3 串行于 DB（同属迁移，建议同一人或顺序执行）。
- 后端 T4→T5/T6/T7（T4 先行，T5/T6/T7 可并行）。
- 前端 T8 先行（其余依赖其类型/树），T9/T10/T11 在 T8 后可并行。
- 后端与前端在 T0 之后可**整体并行**，约定好 `categories_revision` 签名规范与 transfer 类型契约即可。
- T12 最后收口。

**关键契约（跨任务，先对齐）**
1. **签名算法规范**：字段顺序 `id|name|type|parentId|sortOrder|isDirectDefault(1/0)|isParentDefault(1/0)|displayOrder(''|num)`，条目以 `;` 连接，条目内字段以 `|` 连接；排序键 `sortOrder` 升序。服务端 T6 与前端 T8 必须**逐字符一致**。
2. **transfer 契约**：`entry_type` 已含 `transfer`（无需改）；`category_type` 新增 `'transfer'`；transfer entry 的 `shared_type` 恒为 `NULL`，不计入收支统计。
3. **降级契约**：服务端写入时 `category_id` 不存在 → 查 `category_redirects` → 命中用 `new_id`，否则兜底「其他·默认子」，**静默落库不报错**。

---

## 1. 任务清单

### T0 · 更新分类权威源 `design/categories.yaml`
- **角色**：backend-dev（或 PM）
- **依赖**：无
- **改动文件**：`design/categories.yaml`
- **实现要点**：
  - 餐饮：删 `三餐`，增 `早餐`/`午餐`/`晚餐`
  - 生活：删 `水电煤`，增 `水费`/`电费`/`燃气费`
  - 新增 `transfer` 段：`储值`(储值/公交卡储值/饭卡储值)、`账户互转`(账户互转)、`赊销`(赊销/花呗/白条/月付/信用卡)，icon 储/互/销
  - `display_order` 按 spec §3 Step E 表（前 19 项重排，加油起不变）
  - 更新文件头注释的"同步目标"（指向 0001 seed + 0004 + categoryService fallback + 测试）
- **验收**：YAML 结构与 spec §1.1/§3 完全一致；统计摘要数字更新。
- **备注**：⚠️ 现有**支出·转账**（转账/还贷/垫付）**保持不变**，与新 `transfer` 类型并存（语义不同：支出·转账=对外转出算支出；transfer·转移=不计收支）。

---

### T1 · 改造 `0001_init.sql` 分类 seed 为幂等 + ID 稳定
- **角色**：backend-dev
- **依赖**：T0
- **改动文件**：`server/db/migrations/0001_init.sql`（seed 段 ~L447-601）
- **实现要点**：
  - **移除** `DELETE FROM categories WHERE is_system AND family_id IS NULL`
  - INSERT 改为 `INSERT ... ON CONFLICT DO UPDATE`，冲突目标对齐 `uq_categories_family_name_type_parent`（`COALESCE(family_id,'00..'), name, type, COALESCE(parent_id,'00..')) WHERE deleted_at IS NULL`）
  - 命中冲突时更新 `icon/color/sort_order/is_direct_default/is_parent_default/display_order`，**不动 id**
  - 0001 保持"全量幂等基线"职责，**不**承载本次删除/新增/重排（放 T2）
- **验收**：
  - 空库跑 0001 → 生成全量系统分类（线上历史 ID 保留语义）
  - **重复跑 0001 两次**不报错、行数不变、ID 不变
  - 模拟"有 entries 引用系统分类"后再跑 0001 → 不报 FK 错（因不再 DELETE）

---

### T2 · 新建迁移 `0004_categories_restructure.sql`
- **角色**：backend-dev
- **依赖**：T1
- **改动文件**：`server/db/migrations/0004_categories_restructure.sql`（新）
- **实现要点**（严格按顺序，参 spec §3.2）：
  - **Step A**：`ALTER TYPE category_type ADD VALUE IF NOT EXISTS 'transfer';`（**独立裸语句**，先于后续事务自动提交）
  - **Step B**（事务内，UPSERT 幂等）：新增 餐饮 早/午/晚餐；生活 水费/电费/燃气费；transfer 三个 L1 + 各子级（字段见 spec §3.3）
  - **Step C-1**：`CREATE TABLE IF NOT EXISTS category_redirects(old_id UUID PK, new_id UUID NOT NULL REFERENCES categories(id), reason TEXT, created_at ...)`；写入 三餐→餐饮默认子、水电煤→生活默认子 映射（`ON CONFLICT(old_id) DO UPDATE`）
  - **Step C-2**：用 redirect 表驱动 `UPDATE entries SET category_id=new_id, change_seq=nextval('entries_change_seq'), version=version+1, updated_at=now()`；`UPDATE budgets`（不 bump change_seq）
  - **Step D**：`DELETE` 三餐/水电煤（此时无引用）
  - **Step E**：按 spec §3 Step E 表 `UPDATE` 全部支出二级 `display_order`
  - 全文件可安全重跑（幂等）
- **验收**：
  - 跑 0004 后：三餐/水电煤 不存在；`category_redirects` 有 2 行；引用过它们的 entries 均指向新目标且 `change_seq` 已推进；`display_order` 符合新表
  - **重复跑 0004** 不报错、结果一致
  - 无任何 entries/budgets 残留指向已删 id

---

### T3 · 对齐 `server/test/setup.ts` 内嵌 DDL（双写约定）
- **角色**：backend-dev
- **依赖**：T2
- **改动文件**：`server/test/setup.ts`
- **实现要点**：
  - 新增 `category_redirects` 表 DDL（pg-mem 版）
  - `category_type` 在 pg-mem 为 TEXT，无需改枚举；确认 `entries.type` TEXT 可存 `'transfer'`
  - `resetPgMem` 的 `DELETE` 清表序列加上 `category_redirects`
  - 测试用内联 mini-fixture，不依赖 91 条全量；按 MEMORY「DB migration 双写约定」复核
- **验收**：现有测试在改动后仍可启动；新增 `category_redirects` 可被测试查询。

---

### T4 · 后端 `category_type` 扩 `transfer`（类型层）
- **角色**：backend-dev
- **依赖**：T3
- **改动文件**：`server/src/repositories/categoryRepo.ts`、`server/api/openapi.yaml`、`server/src/routes/categories.ts`（如有类型）
- **实现要点**：
  - `CategoryEntity.type` / `CategoryRow.type` / `CreateCategoryInput.type` 联合类型加 `'transfer'`
  - openapi.yaml：Category schema 的 `type` enum 加 `transfer`；确认 entry `type` enum 已含 transfer
  - `findByFamily` 已返回所有 type（无 type 过滤），确认 transfer 类目能被 `/categories` 返回
- **验收**：`/categories` 返回含 transfer 类目；类型编译通过。

---

### T5 · entry 写入 `category_id` 降级校验（基于 redirect 表）
- **角色**：backend-dev
- **依赖**：T4
- **改动文件**：`server/src/services/entryService.ts`、`server/src/repositories/categoryRepo.ts`（新增查询）
- **实现要点**（参 spec §5.3）：
  - `categoryRepo` 新增：`findById(id)`（已有）、`findRedirect(oldId): {newId} | null`、`findOtherDefaultChild(type): id`（兜底）
  - entry **create/update** 在落库前解析 `category_id`：
    1. 命中 categories 且未删 → 用
    2. 否则查 `category_redirects` → `new_id`
    3. 否则兜底「其他」一级 `is_parent_default=true` 子分类
  - **静默降级**，落库为解析后的 id，不抛错、不要求重选
  - transfer entry 同理（兜底可归「转移」相应默认子，按 type 判断；MVP 可统一兜底「其他·默认子」并记 TODO）
- **验收**：
  - 传不存在 id + 该 id 在 redirect 表 → 落库为 new_id
  - 传纯垃圾 id → 落库为「其他·默认子」，不报错
  - 正常 id → 行为不变
  - 单测覆盖三条路径

---

### T6 · `categories_revision` 下发（sync pull）
- **角色**：backend-dev
- **依赖**：T4；**契约对齐 T8**
- **改动文件**：`server/src/services/syncPullService.ts`、`server/api/openapi.yaml`（响应 schema）
- **实现要点**：
  - 拉 entries 后，查系统分类（`WHERE deleted_at IS NULL AND family_id IS NULL`）
  - 按"签名算法规范"（见 §0 契约 1）计算签名字符串
  - 响应新增字段 `categories_revision: string`
  - openapi.yaml sync pull 响应 schema 增字段
- **验收**：
  - sync pull 响应含 `categories_revision`
  - 单测：与前端 `computeCategoriesSignature` **同输入同输出**（用同一组 fixture 断言字符串完全相等）

---

### T7 · openapi / 路由契约收尾
- **角色**：backend-dev
- **依赖**：T4、T6
- **改动文件**：`server/api/openapi.yaml`
- **实现要点**：汇总 transfer enum、`categories_revision` 字段、降级行为说明，保证文档与实现一致。
- **验收**：openapi 校验通过；与实现无漂移。
- **备注**：若 T4/T6 已顺手改 openapi，本任务并入即可。

---

### T8 · 前端 `categoryService` 同步（fallback/tree/类型/签名）
- **角色**：miniapp-dev
- **依赖**：T0；**契约对齐 T6**
- **改动文件**：`miniprogram/services/categoryService.ts`
- **实现要点**：
  - `CategoryItem.type` / `CategoryRaw.type` 加 `'transfer'`
  - `CONFIG_EXPENSE`/`CONFIG_INCOME` 同步新结构 + **修复既有漂移**（公交地铁/火车高铁/垫付归位，与服务端权威源一致）
  - 新增 `CONFIG_TRANSFER`（储值/账户互转/赊销 + 子级），更新 `getFallbackItems` 生成 transfer（注意 fallback 的确定性 UUID 生成需为 transfer 分配新前缀段，避免与 expense/income 撞）
  - `buildCategoryTree()` 返回 `{expense, income, transfer}`
  - 确认 `computeCategoriesSignature` 与 T6 规范一致（如需，将算法注释提炼为规范）
- **验收**：
  - fallback 含 transfer 三个 L1；`buildCategoryTree` 返回 transfer 分支
  - 展示区 `buildDedupedSubCategories('expense')` 顺序符合 spec §3 Step E
  - 签名与服务端一致（与 T6 联调）

---

### T9 · `expense-overlay` 新增「转移」tab
- **角色**：miniapp-dev
- **依赖**：T8
- **改动文件**：`miniprogram/components/expense-overlay/{index.ts,index.wxml,index.wxss,categories.ts}`
- **实现要点**：
  - 类型 tab：支出/收入 → 支出/收入/**转移**
  - 转移 tab **仅按树展示**（储值/账户互转/赊销 + 子级），不复用全局二级展示区
  - 选中转移类目提交 `type='transfer'`；不发 `shared_type`
  - 校验现有"记入账本/计算器"流程在 transfer 下正常
- **验收**：转移 tab 可选类目并成功记一笔 transfer；支出/收入 tab 行为不回归。

---

### T10 · `sync.ts` 消费 `categories_revision`
- **角色**：miniapp-dev
- **依赖**：T8、T6
- **改动文件**：`miniprogram/services/sync.ts`（`applyServerChanges` 路径）
- **实现要点**：
  - 收到 sync 响应后，比对 `categories_revision` 与本地缓存签名
  - 不一致 → 绕过 24h TTL `refreshCategories(activeFamilyId)` → 写缓存 + `warmUpMemoryCache` + 广播 `CATEGORIES_LOADED`
  - 本地需存最近一次 revision（storage 或内存）
- **验收**：mock 一个新 revision → 触发强刷；revision 不变 → 不重复拉取。

---

### T11 · 本地 `Entry` 类型支持 `transfer`
- **角色**：miniapp-dev
- **依赖**：T8
- **改动文件**：`miniprogram/services/db.ts`、`miniprogram/pages/ledger/index.ts`（DisplayEntry）、`miniprogram/services/outbox.ts`（如类型限制）
- **实现要点**：
  - `db.ts` 的 `Entry.type` 与 `wireToEntry` 的 `wire.type as ...` 加 `'transfer'`
  - 明细页 `DisplayEntry.type` 处理 transfer（展示策略：如不计入月支出汇总、列表正常显示分类名/图标）
  - outbox enqueue/push 路径确认 transfer 类型贯通
- **验收**：transfer entry 本地存取、同步上下行、明细页展示均正常；月支出汇总不含 transfer。

---

### T12 · 测试与验收收口
- **角色**：qa-planner / 各 dev 补单测
- **依赖**：全部
- **改动文件**：`server/test/*`、`miniprogram/**/*.spec.ts`
- **实现要点 / 用例**：
  - 迁移：0001 重复跑幂等；0004 重指向正确 + change_seq 推进 + redirect 写入 + display_order 正确
  - 降级：三条路径（命中 / redirect / 兜底）
  - 签名一致：服务端 == 前端（同 fixture 字符串相等）
  - transfer：可创建 entry、不计入统计、`/categories` 含 transfer
  - 前端：fallback/tree/展示顺序、转移 tab、revision 强刷
- **验收**：**后端 148/148（含新增用例）全绿**；前端相关 spec 全绿；不接受基线 fail。

---

## 2. 上线（参 spec §9）

1. 前后端代码合并（后端可先发，老客户端已兼容）
2. `06-migrate.sh`：`pg_dump` → 0001(幂等基线) → 0004(增量) → verify
3. 观察同步 payload 一次性小高峰（重指向 entries 重拉）属预期
4. 验证：旧分类消失、历史 三餐/水电煤 流水显示为 餐饮/生活、转移 tab（储值/账户互转/赊销）可用

---

## 3. 风险与备注

- **支出·转账 与 转移 并存**：本次不动支出·转账；若产品希望合并/迁移，另立需求（T0 备注）。
- **transfer 降级兜底**：MVP 统一兜底「其他·默认子」可接受；若要按 transfer L1 精确兜底，留 T5 TODO。
- **签名规范是双端硬契约**：T6/T8 必须用同一组 fixture 做字符串相等断言，避免漂移导致无效强刷或漏刷。
- **fallback 确定性 UUID**：T8 为 transfer 分配 UUID 前缀段时勿与 expense(`10..`)/income(`11..`) 冲突。
