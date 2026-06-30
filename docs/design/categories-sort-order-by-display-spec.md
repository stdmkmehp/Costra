# 二级分类展开顺序按 display_order 重排（重写 sort_order）设计文档

> 状态：**已确认实现**
> 创建：2026-06-24
> 关联：`server/db/migrations/0006_categories_sort_order_by_display.sql`、`design/categories.yaml`、
>       `miniprogram/services/categoryService.ts`（`buildCategoryTree` / `buildDedupedSubCategories`）、
>       前置 `docs/design/categories-restructure-spec.md`（§3 Step E display_order 重排）
> 背景：业务已上线，改动必须对线上存量用户零数据风险。

---

## 0. 目标

让"点开一级分类后、在其下方展开的二级分类"按 `display_order` 顺序（高频在前）显示，
**且不改动前端 `buildCategoryTree`**（它被动按 `sort_order` 渲染 children）。

实现手段：**数据方案**——用一个迁移把系统二级分类的 `sort_order` 按规则重排，使"被动沿用 sort_order"的展开顺序自然等于期望顺序。

---

## 1. 背景：两套排序键与现状

| 字段 | 语义 | 可空 | 消费方 |
|---|---|---|---|
| `sort_order` | **层级内局部**排序键，每个父分类内从 1 计数 | 否（必填） | `buildCategoryTree`（展开 children，被动沿用）；服务端 `ORDER BY sort_order ASC` |
| `display_order` | **全局二级展示区**扁平排序键，跨一级分类拉平 | 是（`NULL`=不进展示区，父默认子恒 `NULL`） | `buildDedupedSubCategories`（显式按其升序 + 过滤 `NULL`） |

**现状问题**：展开 children 沿用 `sort_order`（父内书写顺序），未体现 `display_order` 的"高频在前"意图，与全局展示区口径不一致。

---

## 2. 为什么有些二级分类没有 display_order（NULL 的四类来源）

| 类别 | 原因 | 实例 |
|---|---|---|
| **A. 父默认子**（`is_parent_default=true`） | 代表父分类本身，点一级即选它，不在全局高频区作独立 chip | 餐饮·餐饮、购物·购物… |
| **B. 同名去重的非直选副本** | 同名二级挂多个父，只有"带 display_order 的那份"进展示区，其余副本设 `NULL` 防重复 | 购物·零食、购物·饮料、生活·日用/买菜/柴米油盐、旅行·机票/火车高铁 |
| **C. 真·长尾** | 是直选默认归属但产品未纳入高频区 | 其他·罚款、旅行·交通、旅行·餐饮 |
| **D. 转移类目全部 NULL** | 转移不进全局展示区，仅在「转移」tab 按树展示 | 储值/账户互转/赊销 下全部 |

---

## 3. 排序规则（三档）与重排结果

每个一级分类内，按下列复合键升序排列，排完顺序赋 `sort_order = 1..N`：

1. **① 父默认子置顶**：`is_parent_default=true` 排第一。
2. **② 有效 display_order 升序**：`COALESCE(自身 display_order, 同名 canonical display_order)`。
   - `canonical(name) =` 该二级名在同 `type` 内"带 `display_order` 的那份副本"的值（`display_order` 全局唯一，每名至多一份非空）。
   - **B 类去重副本借用 canonical 值**，与有自身值的项**交错**排列，跨父保持"高频在前"。
3. **③ 长尾兜底**：既无自身、也无同名 canonical（C 类长尾 / D 类转移）→ 排最后，按原 `sort_order` 保序。

### 3.1 重排后展开顺序（支出，括号内为有效 display_order / 标注）

| 一级 | 重排后顺序（sort_order = 1..N） |
|---|---|
| 餐饮 | 餐饮(默认) · 早餐1 · 午餐2 · 晚餐3 · 外卖4 · 零食8 · 买菜9 · 水果10 · 饮料11 · 柴米油盐18 · 聚餐19 · 宴请27 · 酒水52 |
| 交通 | 交通(默认) · 公交地铁5 · 打车6 · 加油20 · 停车21 · 火车高铁28 · 机票29 · 汽车保养39 · 保险40 · 过路费41 |
| 购物 | 购物(默认) · **日用借7** · **零食借8** · **饮料借11** · 服饰17 · 护肤美妆31 · 数码32 · 纸巾44 |
| 生活 | 生活(默认) · **日用借7** · **买菜借9** · 水费13 · 电费14 · 燃气费15 · 话费网费16 · **柴米油盐借18** · 医疗22 · 美容美发25 · 宠物34 · 母婴38 · 物业维修42 · 租房43 |
| 旅行 | 旅行(默认) · 酒店26 · **火车高铁借28** · **机票借29** · 交通(长尾) · 餐饮(长尾) |
| 文娱 | 文娱(默认) · 订阅会员12 · 电影23 · 运动24 · 游戏33 · 门票35 · 演出36 · 教育37 |
| 转账 | 转账(默认) · 还贷30 · 垫付50 |
| 其他 | 其他(默认) · 红包45 · 礼金46 · 礼物47 · 赡养48 · 捐赠49 · 丢失51 · 罚款(长尾) |

### 3.2 收入

| 一级 | 重排后顺序 |
|---|---|
| 职业收入 | 工资(默认) · 奖金1 · 兼职2 · 报销3 |
| 投资与资产 | 理财(默认) · 收租4 · 利息5 |
| 意外收入 | 其他(默认) · 红包6 · 退款7 · 转账8 · 礼金9 · 中奖10 · 闲置出售11 |

### 3.3 转移

所有二级 `display_order=NULL`，父默认子本就 `sort_order=1`（置顶），其余按原 `sort_order` 不变。**无变化。**

---

## 4. 迁移实现（`0006_categories_sort_order_by_display.sql`）

纯数据 `UPDATE`、无 DDL、ID 稳定（不 delete/insert）、幂等。核心用窗口函数一条语句派生：

```sql
WITH canonical AS (
  SELECT name, type, MIN(display_order) AS canon_display_order
    FROM categories
   WHERE family_id IS NULL AND parent_id IS NOT NULL
     AND display_order IS NOT NULL AND deleted_at IS NULL
   GROUP BY name, type
),
ranked AS (
  SELECT c.id,
    ROW_NUMBER() OVER (
      PARTITION BY c.parent_id
      ORDER BY
        CASE WHEN c.is_parent_default THEN 0 ELSE 1 END,
        COALESCE(c.display_order, can.canon_display_order) ASC NULLS LAST,
        c.sort_order ASC, c.id ASC
    ) AS new_sort_order
  FROM categories c
  LEFT JOIN canonical can ON can.name = c.name AND can.type = c.type
  WHERE c.family_id IS NULL AND c.parent_id IS NOT NULL AND c.deleted_at IS NULL
)
UPDATE categories t
   SET sort_order = r.new_sort_order, updated_at = now()
  FROM ranked r
 WHERE t.id = r.id AND t.sort_order IS DISTINCT FROM r.new_sort_order;
```

**作用域**：仅系统分类（`family_id IS NULL`）的二级分类（`parent_id IS NOT NULL`）。一级分类、家庭自定义分类不动。

**执行模型（线上约定）**：线上**只单独执行 `0006`**，不重跑 0001/0004。`0006` 直接作用于当前线上数据（其二级 `sort_order` 仍是种子原值、`display_order` 已由 0004 写好），自包含且幂等。全新建库时按文件名顺序在 0004 之后执行，结果一致。

**幂等性证明**：`ROW_NUMBER` 是纯派生；`IS DISTINCT FROM` 守卫使值未变时不写。二次直跑：①②键不依赖被改写的 sort_order；③长尾此时按已写入的"末尾连续序号"再排，仍得同序 → 结果稳定。

**与 0001/0004 的职责关系**：`0006` 是"二级 sort_order 最终顺序"的**权威派生层**，类比 `0004 Step E` 之于 `display_order`。`0001` 种子保留结构基线（不改值），任何已应用 0004 的库再叠加 0006 即得最终顺序。

---

## 5. 线上兼容性

| 关注点 | 结论 |
|---|---|
| entries / budgets 数据 | 引用 `category_id`，与 `sort_order` 无关；本迁移不 delete/insert、不碰 FK → **零数据风险、无"未分类"** |
| 新顺序传播 | `sort_order` 变 → `computeCategoriesSignature`（含 `sortOrder`）签名变 → sync 响应 `categories_revision` 失配 → 客户端绕过 24h TTL 强刷 → 一个同步往返收敛 |
| 24h 缓存窗口 | 强刷前短暂旧序，纯视觉、无破坏 |
| 未发版老客户端 | `sort_order` 仅排序字段，老客户端照常渲染、不崩溃；强刷同样生效 |
| 兜底降级查询 | `findFallbackCategoryId` 只筛 `is_parent_default=true` 且父被 name/`p.sort_order` 锁定 → **不受重排影响**（已核验） |
| 全局展示区 | `buildDedupedSubCategories` 只读 `display_order` → **不受影响** |
| 重复执行 | 纯派生 + `IS DISTINCT FROM` → 可安全重跑 |

---

## 6. 前端 fallback 处理（方案 b · 已采纳）

`categoryService.ts` 的 `getFallbackItems()` 中，`CONFIG_*` 的 `c.order` 同时用于 `sortOrder` 与 `getChildUuid()` 的占位 UUID 派生。直接改 `c.order` 会引入占位 UUID 漂移，故：

- **不改动前端 fallback 配置**。
- 影响面：仅"**从未成功联网拉取过分类**的冷启动离线"这一极端场景会短暂显示旧展开序（API/缓存任一可用即为新序）。一旦联网成功拉取一次，新顺序写入本地缓存并长期保留，fallback 不再被触及，问题不复现（除非清存储 + 离线）。对存量用户（早已缓存过分类）几乎零影响。

> 如未来要彻底消除该极端场景，可走"方案 a"：给 CONFIG 子项加独立 `so` 字段，`sortOrder: c.so ?? c.order`、UUID 仍用 `c.order`，与本迁移结果对齐。当前不做。

---

## 7. 权威源同步

- `design/categories.yaml`：保留逐子项 `sort_order` 作为**结构基线**，并加说明指明"运行时二级 sort_order 最终顺序由 `0006` 按 `display_order` 派生"。不逐项改值（`0006` 才是运行时真相，逐项改值易错且冗余）。
- `0001` 种子、前端 fallback：不改（理由见 §4 §6）。

---

## 8. 测试与验收

- 迁移无 DDL → `server/test/setup.ts` 内嵌 DDL **无需改**。
- `ROW_NUMBER` 窗口函数仅在真实 PG 执行；pg-mem 不跑 migration 文件 → 排序正确性**不在单测覆盖范围**（数据方案固有局限）。
- 验收方式：
  - 迁移文件内置 `SELECT` 验收查询（见文件尾注释），在 staging/真实 PG 跑，对照 §3 表逐父核对。
  - 客户端：记账面板 + 明细页改分类，点开各一级分类，确认展开顺序符合 §3。
  - `computeCategoriesSignature` 在 sort_order 变更后签名变化（佐证强刷会触发）——可加一条前端单测。

---

## 9. 上线与回滚

**上线**：在已有 0004 的库上单独执行 `0006`（线上约定）；全新库按序执行至 0006。客户端发版非必需（强刷机制自动传播）。

**回滚**：`sort_order` 是纯展示字段。回滚只需新增反向迁移把二级 `sort_order` 复位为种子原值（或按需重排），**无数据损失风险**。
