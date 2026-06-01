# COSTRA-219 · 前端分类数据模型替换硬编码

> **task_type**: feature · **commit**: `d00c47e` · **日期**: 2026-06-16

---

## 1. 任务描述

将记账覆盖层和明细页的硬编码分类数据替换为 API 调用 + 本地缓存。依赖 COSTRA-218（B3 后端分类 API）已完成的 `GET /v1/categories?family_id=uuid` 接口。

## 2. 产出

### 2.1 新建 `miniprogram/services/categoryService.ts`（474 行）

- **CategoryItem 接口**：对齐 OpenAPI Category schema，UUID id，snake_case → camelCase 映射
- **getCategories(familyId)**：优先读缓存（storage.ts envelope + TTL 24h）→ 过期/无缓存调 API → API 失败用 fallback
- **refreshCategories(familyId)**：强制调 API → 写缓存 → 返回
- **buildCategoryTree(items)**：按 parent_id 组装 `{ expense: Tier1[], income: Tier1[] }`
- **buildDedupMapping(items)**：按 `is_direct_default` 构建去重映射（二级名 → 一级 id）
- **buildDedupedSubCategories(items, type)**：去重二级列表（同名仅展示一次）
- **getCategoryById / getCategoryIconById / getCategoryNameById**：供明细页查找，降级 `'?'` / `'未分类'`
- **warmUpMemoryCache**：预热内存缓存供快速查找
- **Fallback 数据**：内嵌静态数据（UUID 占位符，非旧 slug）

### 2.2 重写 `miniprogram/components/expense-overlay/categories.ts`（-194 行 +59 行净减）

- 删除 `EXPENSE_CATEGORIES` / `INCOME_CATEGORIES` / `DEDUP_MAPPING` 常量
- 删除 `buildDedupedSubCategories` 函数
- 保留 `CategoryTier1` / `CategoryTier2` / `DedupMapping` 接口（id 改为 UUID string）
- 新增 `CategoryData` 接口 + `loadCategories(familyId)` 异步函数

### 2.3 修改 `miniprogram/components/expense-overlay/index.ts`（+39 行）

- import 改为 `loadCategories` + 类型（删除硬编码常量引用）
- `_show()` 中通过 `getActiveFamilyId()` + `loadCategories()` 动态加载分类
- 分类数据存实例属性 `_categoryData`，供 `_switchEntryType` / `onTapSubCategory` 读取
- 降级：API 失败时 categoryService 内部有 fallback 兜底；极端场景空数组防御

### 2.4 修改 `miniprogram/pages/ledger/index.ts`（-27 行 +23 行净减）

- 删除 `getCategoryIcon` / `getCategoryName` 中的 hardcoded iconMap/nameMap
- 改为调用 `categoryService.getCategoryIconById(categoryId)` / `getCategoryNameById(categoryId)`
- `_loadContext()` 中预热分类内存缓存（`getCategories` + `warmUpMemoryCache`）
- 降级：不存在时显示 `'?'` / `'未分类'`

## 3. 关键决策

| 决策 | 选项 | 选择 | 理由 |
|------|------|------|------|
| 缓存策略 | sync vs async storage | async（storage.ts envelope） | §2.1 硬约束：禁止异步 getGlobalStorage；storage.ts 已统一 async |
| 缓存 key | 全局 vs per-family | `categories_cache_${familyId}` | 区分家庭数据，dispatch 明确要求 |
| 内存缓存 | 无 vs 简单数组 | 简单数组 + warmUp | getCategoryById 需要 O(n) 查找，内存缓存避免反复读 storage |
| fallback | 无 vs 内嵌静态 | 内嵌（UUID 占位） | dispatch 降级策略要求：API 不可达 + 缓存也无 → 内嵌 fallback |
| ID 类型 | 旧 slug → UUID | 全切 UUID | dispatch §E 明确要求彻底移除旧 slug |

## 4. 遗留

- **P2**：`warmUpMemoryCache` 参数 `_familyId` 当前未使用（预留扩展点：未来多 family 切换时可做缓存失效判断）
- **P2**：`getCategoryById` 是 O(n) 线性查找，分类数量 < 100 时足够；若后续家庭自定义分类爆炸可换 Map
- **P2**：内存缓存只存一个 familyId 的数据，切 family 时需重新 warmUp（当前业务流每次 _show/onShow 都会触发 loadCategories，天然覆盖）

## 5. state.md diff

- §2：新增 `✅ COSTRA-219` 条目
- §3：新增 `2026-06-16` 交付历史索引
- §6：COSTRA-204 遗留"分类数据当前硬编码"标记为 ✅ 已由 COSTRA-219 解决
- §7：新增 `2026-06-16T18:05:00+08:00` 时间戳
