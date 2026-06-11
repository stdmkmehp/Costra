# 分类体系重构 +「转移」类型 · 本地改动 Review 报告

> 日期：2026-06-11  
> 范围：当前工作区未提交改动，对照 `docs/design/categories-restructure-spec.md` 与 `docs/design/categories-restructure-tasks.md`  
> 结论：整体方向符合设计，但存在 2 个阻断上线问题、4 个重要问题。建议修复后再合并/部署。

## 1. 基础检查

- `npm run lint`：通过，2 个既有 warning（`outbox.spec.ts` / `syncScheduler.spec.ts` 未使用导入）。
- `npm run typecheck && npm test -- --reporter=dot`：通过，`135/135`。
- `cd server && npm run typecheck && npm test -- --reporter=dot`：通过，`196/196`。
- 注意：测试通过不代表迁移安全，当前测试环境未覆盖真实 PG 的 `entries.category_id` / `budgets.category_id` 外键删除失败场景。

## 2. 总体评价

已覆盖的主链路：

- `design/categories.yaml`、`0001_init.sql`、`0004_categories_restructure.sql`、后端类型、`/categories`、`sync pull categories_revision`、前端 fallback/tree/转移 tab、明细页展示与本地 `Entry.type` 基本都已触达。
- `0001` 从危险的 `DELETE + random UUID INSERT` 改为稳定 `UPSERT`，方向正确。
- `transfer` 进入统计聚合排除口径，已有测试覆盖部分统计不计入场景。

主要风险集中在：

1. 迁移对软删历史引用处理不完整，会导致正式 PG 硬删分类失败。
2. `/sync/push` update 绕过 `category_redirects`，与离线 outbox 兼容目标冲突。
3. `categories_revision` 双端比较范围不一致，自定义分类家庭会反复强刷。
4. 明细页分类编辑引入了 transfer pane，但保存和事件绑定存在产品语义/交互问题。

## 3. 阻断问题（必须修复）

### P0-1 · `0004` 只重指向未删除 entries/budgets，硬删旧分类会被软删历史行 FK 阻断

**位置**：

```200:215:server/db/migrations/0004_categories_restructure.sql
UPDATE entries e
   SET category_id = r.new_id,
       change_seq  = nextval('entries_change_seq'),
       version     = version + 1,
       updated_at  = now()
  FROM category_redirects r
 WHERE e.category_id = r.old_id
   AND e.deleted_at IS NULL;

UPDATE budgets b
   SET category_id = r.new_id,
       updated_at  = now()
  FROM category_redirects r
 WHERE b.category_id = r.old_id
   AND b.deleted_at IS NULL;
```

```224:231:server/db/migrations/0004_categories_restructure.sql
DELETE FROM categories
 WHERE family_id IS NULL
   AND type = 'expense'
   AND (
     (name = '三餐'  AND parent_id = (SELECT id FROM categories WHERE family_id IS NULL AND type='expense' AND name='餐饮' AND parent_id IS NULL LIMIT 1))
     OR
     (name = '水电煤' AND parent_id = (SELECT id FROM categories WHERE family_id IS NULL AND type='expense' AND name='生活' AND parent_id IS NULL LIMIT 1))
   );
```

**问题**：真实表外键不是 partial FK，软删的 `entries` / `budgets` 仍会阻止 `DELETE FROM categories`。设计文档 Step C-2 要求清空全部引用，开发手册 T2 也要求“无任何 entries/budgets 残留指向已删 id”。

**影响**：线上只要存在已软删流水/预算引用 `三餐` 或 `水电煤`，迁移会失败；且前面 Step B/C 已提交，数据库可能处于半迁移状态。

**建议**：

- 移除 `AND e.deleted_at IS NULL` / `AND b.deleted_at IS NULL`，对全部引用重指向。
- 对 soft-deleted entries 是否 bump `change_seq` 可再定：为彻底清空 FK 引用，至少 `category_id` 必须更新；若客户端需要同步软删行变更，也应 bump。
- 新增真实迁移验证或最小 PG 集成测试：含软删 entry/budget 引用旧分类后跑 `0004`。

### P0-2 · `/sync/push` update 绕过 `category_redirects` 降级，离线旧分类更新会 FK 失败/500

**位置**：

```141:162:server/src/routes/sync.ts
if (op.op === 'update') {
  if (op.base_version == null) {
    return { client_ref_id: op.client_ref_id, status: 'rejected', error: { code: ErrorCode.INVALID_ARGUMENT, message: 'update requires base_version' } };
  }
  // 通过 client_ref_id 查找 entry（含权限校验 JOIN families_users）
  const entry = await findByClientRefId(op.client_ref_id, userId);
  if (!entry) {
    return { client_ref_id: op.client_ref_id, status: 'rejected', error: { code: ErrorCode.NOT_FOUND, message: `entry ${op.client_ref_id} not found` } };
  }
  const payload = op.payload as UpdateEntryPayload;
  // 业务校验：shared_type 仅允许 expense 类型修改
  if (payload.shared_type !== undefined && entry.type !== 'expense') {
    return { client_ref_id: op.client_ref_id, status: 'rejected', error: { code: 'BUSINESS_RULE_VIOLATION', message: 'shared_type is only allowed for expense entries' } };
  }
  // 直接调 repo 层（权限已在 findByClientRefId 中验证）
  const repoInput: UpdateEntryInput = {};
  if (payload.amount !== undefined) repoInput.amount = payload.amount;
  if (payload.category_id !== undefined) repoInput.categoryId = payload.category_id;
```

**对照**：REST update 已在 `entryService.updateWithVersion()` 里走降级：

```296:307:server/src/services/entryService.ts
const repoInput: entryRepo.UpdateEntryInput = {};
if (payload.amount !== undefined) repoInput.amount = payload.amount;
if (payload.category_id !== undefined) {
  // spec §5：update 同样走降级，避免老客户端上传旧 category_id 失败
  repoInput.categoryId = await resolveCategoryId(payload.category_id);
}
if (payload.account_id !== undefined) repoInput.accountId = payload.account_id;
if (payload.note !== undefined) repoInput.note = payload.note;
if (payload.occurred_at !== undefined) repoInput.occurredAt = payload.occurred_at;
if (payload.shared_type !== undefined) repoInput.sharedType = payload.shared_type;

const updated = await entryRepo.updateEntryByVersion(entryId, repoInput, baseVersion);
```

**问题**：`/sync/push` 的 update 分支直接调用 repo，未查 `category_redirects`，也未兜底“其他”。这正好打中设计文档强调的离线 outbox 场景。

**影响**：离线期间把分类改成旧 `三餐/水电煤` 的 update op，在迁移后同步会写入已删除 UUID，真实 PG 触发 FK error；当前逐条处理未捕获该 DB 错误，可能导致整个 `/sync/push` 500 而不是单条 rejected。

**建议**：

- 让 `/sync/push` update 复用 `entryService.updateWithVersion()`，不要直连 repo。
- 或把 `resolveCategoryId()` 抽成 service/repo 公共能力，并在 sync update 分支调用。
- 新增 `/sync/push` update 命中 redirect、未知 id 兜底的单测。

## 4. 重要问题（建议修复）

### P1-1 · `categories_revision` 服务端只算系统分类，前端拿全量签名比较，自定义分类家庭会每次 sync 强刷

**位置**：

```97:105:server/src/services/syncPullService.ts
async function computeSystemCategoriesRevision(): Promise<string> {
  const pool = getPool();
  const res = await pool.query(
    `SELECT id, parent_id, name, icon, type, sort_order,
            is_direct_default, is_parent_default, display_order
       FROM categories
      WHERE family_id IS NULL
        AND deleted_at IS NULL`,
    [],
  );
```

```98:107:server/src/repositories/categoryRepo.ts
export async function findByFamily(familyId: string, client?: Runner): Promise<CategoryEntity[]> {
  const runner = client ?? exec();
  const res = await runner.query(
    `SELECT id, family_id, name, type, icon, color, sort_order, is_system,
            parent_id, is_direct_default, is_parent_default, display_order,
            created_at, updated_at
       FROM categories
      WHERE deleted_at IS NULL
        AND (family_id IS NULL OR family_id = $1)
      ORDER BY sort_order ASC`,
```

```42:49:miniprogram/services/sync.ts
function maybeRefreshCategoriesByRevision(familyId: string, serverRevision: string | undefined): void {
  if (!serverRevision || !familyId) return;
  const localSig = getCachedCategoriesSignature();
  if (localSig && localSig === serverRevision) return; // 一致 · 无需刷新
  // 不一致 · 后台拉新分类（绕过 24h TTL · refreshCategories 会写缓存 + warmUp 内存 +
  // 在签名变化时广播 CATEGORIES_LOADED 事件，明细页等据此重渲）
  console.log(`[sync:revision] categories_revision changed (local="${localSig.slice(0, 16)}…" → server="${serverRevision.slice(0, 16)}…") · forcing refresh`);
```

```605:638:miniprogram/services/categoryService.ts
export function warmUpMemoryCache(familyId: string, items: CategoryItem[]): void {
  const nextSignature = computeCategoriesSignature(items);
  const changed =
    _cachedFamilyId !== familyId ||
    _cachedSignature !== nextSignature ||
    _cachedFlatItems.length === 0;
  _cachedFlatItems = items;
  _cachedFamilyId = familyId;
  _cachedSignature = nextSignature;
  if (changed) {
    eventBus.emit(EventNames.CATEGORIES_LOADED, { familyId });
  }
}

/** 读取内存缓存当前签名（用于增量刷新比对） */
export function getCachedCategoriesSignature(): string {
  return _cachedSignature;
}
```

**问题**：服务端 revision 仅覆盖 `family_id IS NULL` 系统分类；`/categories` 返回系统 + 家庭自定义；前端 `_cachedSignature` 对全量 items 计算。只要家庭存在自定义分类，`localSig !== serverRevision` 会长期成立。

**影响**：每次 sync pull 都会强刷 `/categories`，反复写缓存、广播 `CATEGORIES_LOADED`，造成无效网络请求和 UI 重渲染。

**建议**：

- 前端新增 `computeSystemCategoriesSignature(items)`，仅过滤 `familyId === null` 后比较服务端 revision。
- 或服务端 revision 改为 family 维度全量签名；但这与 spec §10“仅覆盖系统分类”的决策不一致，不推荐。

### P1-2 · 明细页 transfer 分类编辑 pane 绑定了不存在的事件，点击二级无法保存

**位置**：

```363:373:miniprogram/pages/ledger/index.wxml
<view
  class="category-section category-section--tier2"
  wx:if="{{editCategoryType === 'transfer' && editExpandedChildren.length > 0}}"
>
  <view
    wx:for="{{editExpandedChildren}}"
    wx:key="id"
    class="category-item {{editSelectedTier2Id === item.id ? 'is-selected' : ''}}"
    data-id="{{item.id}}"
    bindtap="onEditTapExpandedChild"
```

```1423:1425:miniprogram/pages/ledger/index.ts
/** 分类面板：选中二级分类 → 保存并关闭 */
async onEditTapSubCategory(e: WechatMiniprogram.TouchEvent) {
  const catId = (e.currentTarget.dataset as Record<string, string>).id;
```

**问题**：`index.ts` 没有 `onEditTapExpandedChild`，只有 `onEditTapSubCategory()`。支出/收入 pane 的展开子分类绑定的是 `onEditTapSubCategory`，transfer pane 用了不存在的 handler。

**影响**：明细页里切到「转移」并展开一级后，点击二级不会触发保存；WXML 事件不会被 TypeScript 检出，所以测试/编译都绿。

**建议**：transfer pane 二级点击统一绑定 `onEditTapSubCategory`；同时加一个页面级/组件级交互测试或最小静态检查，避免 WXML handler 漂移。

### P1-3 · 明细页分类编辑允许跨 entry type 选择分类，但保存只改 `category_id`，会产生类型/分类不一致脏数据

**位置**：

```1463:1473:miniprogram/pages/ledger/index.ts
// SOP 步骤 7: await 持久化
await updateEntryFields(entry.client_ref_id, { category_id: catId, updated_at: now });

// SOP 步骤 8: await 入队
await enqueue({
  op: 'update',
  entity: 'entry',
  client_ref_id: entry.client_ref_id,
  base_version: entry.version ?? null,
  payload: { category_id: catId },
});
```

```1481:1499:miniprogram/pages/ledger/index.ts
/** 分类面板：点击 tab 切换收支（仅修改 editCategoryTypeIndex，由 swiper 过渡） */
onEditCategoryTypeTab(e: WechatMiniprogram.TouchEvent) {
  const type = (e.currentTarget.dataset as Record<string, string>).type as 'expense' | 'income' | 'transfer';
  const targetIdx = type === 'transfer' ? 2 : type === 'income' ? 1 : 0;
  if (targetIdx === this.data.editCategoryTypeIndex) return;
  this.setData({ editCategoryTypeIndex: targetIdx });
},

/** 分类面板：swiper 横滑切换回调（统一更新 editCategoryType + 分类列表） */
onEditCategorySwiperChange(e: WechatMiniprogram.SwiperChange) {
  const idx = e.detail.current;
  const nextType: 'expense' | 'income' | 'transfer' =
    idx === 2 ? 'transfer' : idx === 1 ? 'income' : 'expense';
```

```203:205:server/src/services/entryService.ts
// 1) 命中现有未删 category（categoryRepo.findById 已 WHERE deleted_at IS NULL）
const direct = await categoryRepo.findById(inputCategoryId);
if (direct) return direct.id;
```

**问题**：`EntryUpdate` 不支持修改 `type`，前端分类编辑却允许 expense/income/transfer 三个 tab 任意切换，保存只发 `category_id`。后端也没有校验 `category.type === entry.type`。

**影响**：可产生 `entry.type='expense'` 但 `category_id` 指向 transfer 分类的数据。统计仍按 `entry.type` 计支出，展示却显示转移分类，破坏“transfer 不计入收支”的产品语义。

**建议**：

- 明细页“改分类”应锁定原 entry.type，只展示对应类型分类；如要跨类型改账，需设计“修改流水类型”的完整能力。
- 后端 update/create 应校验分类类型与 entry 类型一致；redirect/fallback 也应返回与目标类型一致的分类，避免脏数据从 API 进入。

### P1-4 · `0004` 多段事务提交，失败后会留下半迁移状态

**位置**：

```27:31:server/db/migrations/0004_categories_restructure.sql
BEGIN;

-- 餐饮下：早餐/午餐/晚餐
INSERT INTO categories (family_id, name, type, icon, color, sort_order, is_system, parent_id, is_direct_default, is_parent_default, display_order)
VALUES
```

```138:145:server/db/migrations/0004_categories_restructure.sql
BEGIN;

CREATE TABLE IF NOT EXISTS category_redirects (
  old_id     UUID PRIMARY KEY,
  new_id     UUID NOT NULL REFERENCES categories(id),
  reason     TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
```

```198:217:server/db/migrations/0004_categories_restructure.sql
BEGIN;

UPDATE entries e
   SET category_id = r.new_id,
       change_seq  = nextval('entries_change_seq'),
       version     = version + 1,
       updated_at  = now()
  FROM category_redirects r
 WHERE e.category_id = r.old_id
   AND e.deleted_at IS NULL;
```

**问题**：`ALTER TYPE` 必须独立提交可以理解；但 Step B/C/D/E 仍拆成多个事务。若 C-2/D/E 失败，新增分类、redirect 表、部分映射可能已经提交。

**影响**：失败后 `/categories` 可能已暴露 transfer，但旧分类还在；下一次重跑虽大概率可收敛，但上线中间态不干净。

**建议**：`ALTER TYPE` 独立后，把 Step B~E 尽量合并到同一个 `BEGIN...COMMIT`。如果必须拆段，至少在执行前后增加强校验和失败提示，避免以为迁移完成。

## 5. 中低优先级问题

### P2-1 · `0001` 仍 seed `三餐/水电煤`，每次部署会先插回旧分类，再由 `0004` 删除

**位置**：

```497:500:server/db/migrations/0001_init.sql
INSERT INTO categories (family_id, name, type, icon, color, sort_order, is_system, parent_id, is_direct_default, is_parent_default, display_order)
VALUES
  (NULL, '餐饮',     'expense', '餐', 'color.category.food', 1,  true, (SELECT id FROM categories WHERE name='餐饮' AND type='expense' AND parent_id IS NULL AND family_id IS NULL LIMIT 1), true,  true,  NULL),
  (NULL, '三餐',     'expense', '餐', 'color.category.food', 2,  true, (SELECT id FROM categories WHERE name='餐饮' AND type='expense' AND parent_id IS NULL AND family_id IS NULL LIMIT 1), true,  false, 48),
```

```579:583:server/db/migrations/0001_init.sql
(NULL, '柴米油盐', 'expense', '活', 'color.category.lifestyle', 4,  true, (SELECT id FROM categories WHERE name='生活' AND type='expense' AND parent_id IS NULL AND family_id IS NULL LIMIT 1), false, false, NULL),
(NULL, '宠物',     'expense', '活', 'color.category.lifestyle', 5,  true, (SELECT id FROM categories WHERE name='生活' AND type='expense' AND parent_id IS NULL AND family_id IS NULL LIMIT 1), true,  false, 29),
(NULL, '美容美发', 'expense', '活', 'color.category.lifestyle', 6,  true, (SELECT id FROM categories WHERE name='生活' AND type='expense' AND parent_id IS NULL AND family_id IS NULL LIMIT 1), true,  false, 20),
(NULL, '水电煤',   'expense', '活', 'color.category.lifestyle', 7,  true, (SELECT id FROM categories WHERE name='生活' AND type='expense' AND parent_id IS NULL AND family_id IS NULL LIMIT 1), true,  false, 10),
(NULL, '话费网费', 'expense', '活', 'color.category.lifestyle', 8,  true, (SELECT id FROM categories WHERE name='生活' AND type='expense' AND parent_id IS NULL AND family_id IS NULL LIMIT 1), true,  false, 11),
```

**问题**：部署脚本每次重跑所有 migration。第一次跑完后旧分类被硬删；下一次部署，`0001` 又会以新 UUID 插回 `三餐/水电煤`，随后 `0004` 再写 redirect 并删除。

**影响**：

- `category_redirects` 会随部署次数积累新 old_id 映射，不再稳定为 2 行。
- 若迁移期间服务仍在线，可能短暂暴露旧分类。

**建议**：

- 更干净的做法：`0001` 作为“当前全量幂等基线”也应移除 `三餐/水电煤` 并包含新分类；`0004` 负责线上增量重指向/删除历史旧分类。
- 若坚持 `0001` 不承载本次业务变更，则验收口径要从“redirect 2 行”改为“至少包含历史 old_id，且无旧分类残留”。

### P2-2 · 设计文档与开发手册的签名字段顺序不一致

**位置**：

```255:259:docs/design/categories-restructure-spec.md
### 4.2 算法一致性约束
- 服务端实现必须与 `miniprogram/services/categoryService.ts` 的 `computeCategoriesSignature()` **字段顺序/分隔符完全一致**：
  - 排序：先按 `sortOrder` 升序，相同 `sortOrder` 再按 `id` localeCompare 升序
  - 单条字段顺序（`|` 连接）：`id | parentId(空串若NULL) | name | icon | type | sortOrder | isDirectDefault(1/0) | isParentDefault(1/0) | displayOrder(空串若NULL)`
  - 条目间用 `;` 连接
```

```39:41:docs/design/categories-restructure-tasks.md
**关键契约（跨任务，先对齐）**
1. **签名算法规范**：字段顺序 `id|name|type|parentId|sortOrder|isDirectDefault(1/0)|isParentDefault(1/0)|displayOrder(''|num)`，条目以 `;` 连接，条目内字段以 `|` 连接；排序键 `sortOrder` 升序。服务端 T6 与前端 T8 必须**逐字符一致**。
2. **transfer 契约**：`entry_type` 已含 `transfer`（无需改）；`category_type` 新增 `'transfer'`；transfer entry 的 `shared_type` 恒为 `NULL`，不计入收支统计。
```

**结论**：当前代码双端采用的是 spec 的顺序，运行时一致；但 tasks 顶部“关键契约”是另一套顺序，后续补测试/重构容易误导。

**建议**：统一文档，以 spec §4.2 为准，修正 tasks。

## 6. 测试缺口

当前全量测试通过，但缺以下关键用例：

1. `0004` 迁移：soft-deleted entry/budget 引用旧分类时仍能硬删旧分类。
2. `/sync/push` update：旧 `category_id` 命中 `category_redirects`，落库为 `new_id`。
3. `/sync/push` update：未知垃圾 `category_id` 兜底，不 500。
4. `categories_revision`：有家庭自定义分类时，前端仅用系统分类签名比较，不重复强刷。
5. 明细页分类编辑：只能选择与原 entry.type 一致的分类，或跨类型修改有明确产品逻辑。
6. WXML handler 静态校验：避免 `bindtap` 指向不存在的方法。

## 7. 建议修复顺序

1. 先修 `0004` 全引用重指向（P0-1），这是上线硬门槛。
2. 统一 entry update 降级路径：REST 与 `/sync/push` 都走同一 service（P0-2）。
3. 修 `categories_revision` 系统分类签名比较范围（P1-1）。
4. 修明细页分类编辑：事件绑定 + 禁止跨类型选分类或补完整跨类型能力（P1-2/P1-3）。
5. 收敛迁移事务与 `0001` 基线策略（P1-4/P2-1）。
6. 补测试，再跑前后端 typecheck/test/lint。

## 8. 修复落实记录（13:15）

按本报告建议已完成修复：

- P0-1：`0004_categories_restructure.sql` 对 `entries` / `budgets` 全量重指向，不再过滤软删行；Step B~E 收敛为 `ALTER TYPE` 后的单事务，避免半迁移状态。
- P0-2：`/sync/push` update 改为复用 `entryService.updateWithVersion()`，统一走 `category_redirects`、未知 ID 兜底与分类类型校验。
- P1-1：前端新增系统分类签名，仅用 `familyId === null` 的分类与服务端 `categories_revision` 比对，避免自定义分类家庭反复强刷。
- P1-2/P1-3：明细页分类编辑锁定原 `entry.type`，禁用横滑跨类型切换，并修复 transfer pane 二级点击事件绑定。
- P2-1：`0001_init.sql` 基线移除 `三餐` / `水电煤`，避免后续部署先复活旧分类再删除。
- P2-2：`categories-restructure-tasks.md` 的签名契约已与 spec 字段顺序统一。

新增/补充测试：

- `server/test/sync.test.ts`：覆盖 `/sync/push` update 命中 redirect、未知 UUID 同 type 兜底、跨 type 分类 rejected。
- `miniprogram/services/categoryService.spec.ts`：覆盖系统签名忽略家庭自定义分类。

最终验证：

- `npm run typecheck`：通过。
- `npm test -- --reporter=dot`：通过，`136/136`。
- `npm run lint`：通过，保留 2 个历史 warning。
- `cd server && npm run typecheck`：通过。
- `cd server && npm test -- --reporter=dot`：通过，`199/199`。
- `cd server && npm run lint`：通过（当前为占位脚本）。
- `git diff --check`：通过。
