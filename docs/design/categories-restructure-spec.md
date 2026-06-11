# 分类体系重构 + 「转移」类型 设计文档

> 状态：**待评审**（DRAFT）
> 创建：2026-06-10
> 关联：`design/categories.yaml`（权威源）、`server/db/migrations/0001_init.sql`、`miniprogram/services/categoryService.ts`
> 背景：小程序已现网运行，本次改动必须**零破坏**线上用户数据。

---

## 0. 一句话目标

调整支出/收入分类内容与展示顺序，新增「转移」一级类型（覆盖"先充值后消费"等储值场景），并在此过程中**修复一个会导致重新部署即炸库的迁移隐患**，全程保证线上数据兼容。

---

## 1. 变更范围总览

### 1.1 分类内容变更

| 类型 | 一级 | 变更 |
|---|---|---|
| 支出 | 餐饮 | **删** `三餐`；**增** `早餐`/`午餐`/`晚餐` |
| 支出 | 生活 | **删** `水电煤`；**增** `水费`/`电费`/`燃气煤气` |
| 支出 | （全局展示区） | 展示顺序重排：`早餐/午餐/晚餐/外卖` 置前四，`公交地铁` 置第五，其余顺延 |
| **转移**（新类型） | `储值` | 子级：`储值`(默认)、`公交卡储值`、`饭卡储值` |
| **转移**（新类型） | `账户互转` | 子级：`账户互转`(默认) |

### 1.2 工程隐患修复（必做前置）

`0001_init.sql` 的分类 seed 当前是 `DELETE FROM categories WHERE is_system AND family_id IS NULL` + `INSERT (gen_random_uuid())`，且 `06-migrate.sh` 每次部署都按文件名排序重跑所有 SQL。一旦线上有 entries 引用系统分类（正常用户必有）：

- 该 `DELETE` 会被 `entries.category_id` 外键（`NO ACTION`）阻断 → **迁移直接失败**；
- 即便能删，随机 UUID 重插会让所有历史 entries 变「未分类」。

**本次必须把 seed 改造为幂等、ID 稳定的 UPSERT**（详见 §3）。

### 1.3 涉及层

- DB 迁移：新增 `0004_categories_restructure.sql` + 改造 `0001_init.sql` seed 段
- 后端：`category_type` 枚举扩展、`categoryRepo`/`entryService` 类型、`/categories`、`syncPullService`（下发 `categories_revision`）、entry 写入降级校验
- 前端：`categoryService`（fallback 对齐 + 强刷）、`buildCategoryTree`、`expense-overlay`（新增「转移」tab）、`sync.ts`（消费 `categories_revision`）
- 测试：`server/test/setup.ts`、分类相关测试断言；目标维持 **148/148 全绿**

---

## 2. 关键架构事实（决策依据）

| 事实 | 影响 |
|---|---|
| 分类是**全局系统预设**（`family_id IS NULL`），所有家庭共享，无 per-family 拷贝 | 改一次影响所有用户 |
| `entries.category_id` / `budgets.category_id` **直接引用系统分类 id** | 删分类前必须先重指向 |
| 迁移**无版本表**，每次部署重跑全部 `*.sql`，靠各文件自身幂等 | 迁移必须可安全重跑 |
| 增量同步**只认 `change_seq`**（`WHERE change_seq > watermark`） | 重指向必须 bump `change_seq` 才能下发 |
| 分类**不走 change_seq 同步**，独立 `/categories` REST + 24h 缓存 | 分类变更默认 24h 内客户端无感 → 需 `categories_revision` 强刷 |
| 本地 entries **只存 `category_id`**，分类名/图标渲染时现查 | 不存在"分类名快照写死"问题；id 收敛即显示收敛 |
| 统计/家庭汇总**已排除 `transfer`** | 「转移」天然不计入收支报表 ✅ 无需改统计 |
| `entry_type` 枚举**已含 `transfer`**；`category_type` 枚举仅 `income/expense` | 仅需扩 `category_type` |

---

## 3. DB 迁移设计

### 3.1 改造 `0001_init.sql` 的分类 seed（幂等 + ID 稳定）

**原则：不再 DELETE，不再生成新随机 ID 覆盖已有分类。** 改为按唯一键 `(family_id, name, type, parent_id)` 做 `INSERT ... ON CONFLICT DO UPDATE`，命中即原地更新属性、**保留原 ID**，未命中才插入。

- 冲突目标对齐既有 partial unique index `uq_categories_family_name_type_parent`（`COALESCE(family_id,…), name, type, COALESCE(parent_id,…)) WHERE deleted_at IS NULL`）。
- 这样 0001 真正幂等，**永久消除"重部署炸库"**，且线上现有分类 ID 全部保留 → entries 引用安全。

> 注：0001 本身**不**承载本次的删除/新增/重排业务变更，这些放进 0004（保持 0001 = "全量幂等基线"，0004 = "本次增量"，职责清晰）。

### 3.2 新增 `0004_categories_restructure.sql`

执行顺序（**顺序至关重要**）：

**Step A — 扩展枚举（独立语句，先自动提交）**
```sql
ALTER TYPE category_type ADD VALUE IF NOT EXISTS 'transfer';
```
> PG 限制：`ADD VALUE` 后不能在同一事务内立即使用该值。故此句**单独成段、先于后续事务**执行（psql 文件中裸语句逐条自动提交）。

**Step B — 新增分类（幂等 UPSERT，事务内）**
- 餐饮下：`早餐`/`午餐`/`晚餐`
- 生活下：`水费`/`电费`/`燃气煤气`
- 转移一级：`储值`、`账户互转`（`type='transfer'`, `parent_id IS NULL`）
- 转移二级：`储值`(默认子)、`公交卡储值`、`饭卡储值` 挂 `储值`；`账户互转`(默认子) 挂 `账户互转`
- 全部 `ON CONFLICT (…) DO UPDATE`，幂等可重跑

**Step C — 重指向引用（带 `change_seq` 自增，事务内）**

对 `三餐`、`水电煤` 的引用方做重指向。**核心：必须 bump `change_seq/version/updated_at`**，否则客户端永远拉不到（见 §2）。

```sql
-- 以"三餐 → 餐饮默认子(餐饮 L2, is_parent_default=true)"为例
WITH src AS (
  SELECT id FROM categories
   WHERE family_id IS NULL AND type='expense' AND name='三餐'
     AND parent_id = (SELECT id FROM categories WHERE family_id IS NULL AND type='expense' AND name='餐饮' AND parent_id IS NULL)
),
dst AS (
  SELECT c.id FROM categories c
   JOIN categories p ON p.id = c.parent_id
   WHERE c.family_id IS NULL AND c.type='expense' AND c.name='餐饮'
     AND p.name='餐饮' AND p.parent_id IS NULL AND c.is_parent_default = true
)
UPDATE entries
   SET category_id = (SELECT id FROM dst),
       change_seq  = nextval('entries_change_seq'),
       version     = version + 1,
       updated_at  = now()
 WHERE category_id = (SELECT id FROM src);
```
- 同样对 `budgets.category_id` 重指向（budgets 走 REST 刷新，无需 change_seq，但服务端一致性必须处理）。
- 重指向映射：

| 删除分类 | 重指向目标 |
|---|---|
| 餐饮·三餐 | 餐饮·餐饮（`is_parent_default=true`） |
| 生活·水电煤 | 生活·生活（`is_parent_default=true`） |

**Step D — 硬删旧分类（事务内，此时已无引用）**
```sql
DELETE FROM categories
 WHERE family_id IS NULL AND type='expense'
   AND name IN ('三餐','水电煤')
   AND parent_id IN (SELECT id FROM categories WHERE family_id IS NULL AND name IN ('餐饮','生活') AND parent_id IS NULL);
```
> Step C 已清空全部引用，此处硬删不会触发 FK 违约。

**Step E — 重排 `display_order`（事务内）**

全局支出二级展示区按下表重编号（`buildDedupedSubCategories` 按 `display_order` 升序渲染）：

| 新序 | 分类 | 备注 |
|---|---|---|
| 1 | 早餐 | 新增 |
| 2 | 午餐 | 新增 |
| 3 | 晚餐 | 新增 |
| 4 | 外卖 | 原 1 |
| 5 | 公交地铁 | 原 8 |
| 6 | 买菜 | |
| 7 | 打车 | |
| 8 | 日用 | |
| 9 | 水果 | |
| 10 | 零食 | |
| 11 | 饮料 | |
| 12 | 服饰 | |
| 13 | 水费 | 新增（原水电煤位） |
| 14 | 电费 | 新增 |
| 15 | 燃气煤气 | 新增 |
| 16 | 话费网费 | |
| 17 | 聚餐 | |
| 18 | 柴米油盐 | |
| 19 | 订阅会员 | |
| 20 | 加油 | |
| 21 | 停车 | |
| 22 | 医疗 | |
| 23 | 电影 | |
| 24 | 运动 | |
| 25 | 美容美发 | |
| 26 | 酒店 | |
| 27 | 宴请 | |
| 28 | 火车高铁 | |
| 29 | 机票 | |
| 30 | 还贷 | |
| 31 | 护肤美妆 | |
| 32 | 数码 | |
| 33 | 游戏 | |
| 34 | 宠物 | |
| 35 | 门票 | |
| 36 | 演出 | |
| 37 | 教育 | |
| 38 | 母婴 | |
| 39 | 汽车保养 | |
| 40 | 保险 | |
| 41 | 过路费 | |
| 42 | 物业维修 | |
| 43 | 租房 | |
| 44 | 纸巾 | |
| 45 | 红包 | |
| 46 | 礼金 | |
| 47 | 礼物 | |
| 48 | 赡养 | |
| 49 | 捐赠 | |
| 50 | 垫付 | |
| 51 | 丢失 | |
| 52 | 酒水 | |

- 收入展示区不变。
- 转移类目 `display_order = NULL`（不进全局展示区，仅在「转移」tab 内按树展示，见 §6）。

### 3.3 转移类目字段建议

| 字段 | 储值(L1) | 账户互转(L1) | 储值(L2默认) | 公交卡储值 | 饭卡储值 | 账户互转(L2默认) |
|---|---|---|---|---|---|---|
| type | transfer | transfer | transfer | transfer | transfer | transfer |
| icon | 储 | 互 | 储 | 储 | 储 | 互 |
| color | color.category.transfer | color.category.transfer | （继承） | | | |
| is_parent_default | false | false | **true** | false | false | **true** |
| is_direct_default | false | false | true | true | true | true |
| display_order | NULL | NULL | NULL | NULL | NULL | NULL |

> `uq_categories_direct_default (name,type)` 唯一约束：转移类目名称在 `type='transfer'` 内均唯一，无冲突。

---

## 4. `categories_revision` 下发机制（关闭分类缓存窗口）

### 4.1 设计：零存储、纯计算签名，捎带在 sync pull 响应

不新建表。利用「相同分类数据 → 相同签名」的特性，服务端与客户端共用同一哈希算法。

**服务端（`syncPullService`）**
- 拉完 entries 后，查系统分类（`WHERE deleted_at IS NULL AND family_id IS NULL`，~91 行）；
- 用与前端 `computeCategoriesSignature()` **同算法**算签名；
- 响应体新增字段 `categories_revision: string`。

**客户端（`sync.ts` / `applyServerChanges`）**
- 比对 `response.categories_revision` 与本地缓存签名；
- 不一致 → **绕过 24h TTL 强制 `refreshCategories(activeFamilyId)`** → 写缓存 + `warmUpMemoryCache` + 广播 `CATEGORIES_LOADED`（明细页等据此重渲）。

### 4.2 算法一致性约束
- 服务端实现必须与 `miniprogram/services/categoryService.ts` 的 `computeCategoriesSignature()` **字段顺序/分隔符完全一致**（id、name、type、parentId、sortOrder、isDirectDefault、isParentDefault、displayOrder）。
- 抽出一份"签名字段规范"注释，双端各自实现但以本规范为准（不引入跨端共享代码包成本）。

### 4.3 收益
- 部署后客户端最多**一个 sync 往返**即收敛分类列表，旧分类从记账面板消失；
- 永久修复"分类改了 24h 内客户端看不到"这一**整类**问题，不止本次。

---

## 5. 服务端 entry 写入 `category_id` 降级校验

### 5.1 触发与目标
entry **创建/更新**时校验 `category_id`。若不存在或已被硬删 → **不报错给用户、不要求重选**，而是**自动降级**到合理的二级分类，保证用户体验无损。

### 5.2 降级查找顺序
```
1. category_id 命中且未删除 → 直接使用
2. 未命中 → 取请求中原分类的 (name,type)，查同名 is_direct_default=true 分类 → 命中则用
3. 仍未命中 → 查原分类 parent_id 对应 is_parent_default=true 子分类 → 用
4. 兜底 → "其他"一级的默认子分类
```
> 仅当 step 1 落空才进入 2~4；这是"拒绝重选体验"的替代——服务端静默回正。
> 与 §3 Step C 的迁移重指向规则同源（都归到父级默认子），语义一致。

### 5.3 边界
- `type='transfer'` 的 entry：`category_id` 校验同理，兜底归到「转移·储值默认子」或「账户互转默认子」（按原 L1 判断）。
- 该校验现状**缺失**（当前 entry 创建未校验分类存在性，仅靠裸 FK）。本次一并补齐，比裸 FK 报 500 更干净。

---

## 6. 前端联动清单

### 6.1 `services/categoryService.ts`
- `CategoryItem.type` / `CategoryRaw.type` 联合类型加 `'transfer'`
- `getFallbackItems()` / `CONFIG_EXPENSE` / `CONFIG_INCOME` 同步本次结构，并**顺带修复已有漂移**：
  - 现 fallback 是"公交/地铁"分开、"火车/高铁"带斜杠、"垫付"挂"其他"下 → 与服务端权威源（"公交地铁"/"火车高铁"/"垫付"在"转账"下）**对齐**
  - 新增 `CONFIG_TRANSFER`（储值/账户互转）
- `buildCategoryTree()` 返回值由 `{expense, income}` 扩为 `{expense, income, transfer}`

### 6.2 `components/expense-overlay`
- 类型 tab 由「支出/收入」扩为「支出/收入/转移」
- 「转移」tab 内**仅按树展示**（储值 / 账户互转 + 各自子级），不复用全局二级展示区
- 提交 entry 时 `type='transfer'`；转移类不参与 shared_type（仅 expense 有 shared_type）

### 6.3 `services/sync.ts`
- 消费 `categories_revision`，不一致则强刷（§4.1）

### 6.4 展示侧
- 明细页/统计页通过 `getCategoryNameById/getCategoryIconById` 渲染，id 收敛后自动正确，无需额外改动

---

## 7. 兼容性矩阵

| 场景 | 处理 | 结果 |
|---|---|---|
| 老 entries 引用 `三餐/水电煤` | 迁移 Step C 重指向 + bump change_seq | 下次同步收敛到 餐饮/生活，显示正确 |
| 本地 entries 缓存仍指向旧 id | change_seq 推进 → 客户端增量拉取覆盖 | 收敛，不出现「未分类」 |
| 本地分类缓存仍含旧分类（24h 内） | `categories_revision` 不匹配 → 强刷 | 一个同步往返后旧分类消失 |
| 缓存窗口内用户选了旧分类记账 | 服务端 §5 降级校验 | 静默回正到父级默认子，无报错、无需重选 |
| 老客户端（未发版，无转移 tab） | 仍可正常记支出/收入；不展示转移 | 不崩溃；升级后获得转移能力 |
| budgets 引用 `三餐/水电煤` | 迁移 Step C 一并重指向 | 预算不丢、不报错 |
| 统计/家庭汇总 | transfer 本就排除；重指向后重算 | 口径正确，SYNC_DONE 触发客户端缓存失效重算 |
| 迁移重复执行（重部署） | 全 UPSERT/幂等 + Step C/D 重指向后再删（已无引用） | 可安全重跑 |

---

## 8. 测试影响清单

- `design/categories.yaml`：同步全部结构变更（权威源，先改）
- `server/test/setup.ts`：分类 `type` 在 pg-mem 为 TEXT，枚举扩展无需改 DDL；测试用内联 mini-fixture，不依赖 91 条全量 → 影响小，按"双写约定"复核
- `server/test/categories*.test.ts`：核对断言（children_count、display_order、新类型）
- 新增测试：
  - 迁移 Step C 重指向正确性 + change_seq 推进
  - entry 写入 `category_id` 降级校验（5 种路径）
  - `categories_revision` 签名一致性（服务端 == 前端算法）
  - 转移类目可创建 entry（type='transfer'）
- 基线要求：**148/148 全绿**（不接受"基线有 N 个 fail"）

---

## 9. 上线步骤（建议）

1. 合并代码（前后端同发，或后端先发——老客户端兼容已覆盖）
2. `06-migrate.sh`：自动 `pg_dump` → 跑 0001(幂等基线) → 0004(本次增量) → verify
3. 观察：同步 payload 一次性小高峰（重指向 entries 重拉）属预期
4. 验证：旧分类消失、历史 `三餐/水电煤` 流水显示为 餐饮/生活、转移 tab 可用

---

## 10. 待确认 / 风险

- [ ] 转移 L1 图标用「储 / 互」是否接受（或改用语义图标）
- [ ] 「燃气煤气」命名是否最终（或「燃气费」）
- [ ] `categories_revision` 仅覆盖系统分类（`family_id IS NULL`）；家庭自定义分类变更暂不纳入（当前自定义分类无删除入口，风险低）——确认是否够用
- [ ] 迁移 Step C 在超大数据量下的执行时长（当前用户量级可忽略）
