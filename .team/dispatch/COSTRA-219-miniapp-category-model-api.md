# COSTRA-219 · 前端分类数据模型替换硬编码 (Frontend Category Model → API)

> **Owner**: miniapp-dev · **Est**: 3pt · **Dep**: COSTRA-218 (B3 后端分类 API) · **Sprint**: Data-Layer Phase-B
> **状态**: Todo → Doing（B3 完成后执行）

---

## §A 背景

当前记账覆盖层 (`components/expense-overlay/categories.ts`) 使用硬编码的字符串 ID（如 `'food'`, `'food_dining'`）定义分类数据。明细页 (`pages/ledger/index.ts`) 也有独立的硬编码 `iconMap`/`nameMap` 映射。

B3 完成后，后端提供 `GET /v1/categories?family_id=xxx` API 返回真实 UUID 分类数据。本卡需要：
1. 新建分类数据服务层（API 调用 + 本地缓存）
2. 替换记账覆盖层的硬编码分类为 API 数据
3. 替换明细页的硬编码映射为分类缓存查找

---

## §B 事实源

- **当前硬编码**: `miniprogram/components/expense-overlay/categories.ts`（EXPENSE_CATEGORIES / INCOME_CATEGORIES / DEDUP_MAPPING / buildDedupedSubCategories）
- **明细页映射**: `miniprogram/pages/ledger/index.ts` L107-139（getCategoryIcon / getCategoryName）
- **API 契约**: `server/api/openapi.yaml` → `GET /categories` 响应 `Category[]`
- **Category Schema 字段**: id(uuid), family_id, name, type(income/expense), icon, color, sort_order, is_system, parent_id, is_direct_default, children_count
- **设计字典**: `design/ui/category_dictionary.md`（去重直选归属规则）

---

## §C DoD (Definition of Done)

### C1: `miniprogram/services/categoryService.ts` — 新建

- [ ] `CategoryItem` 接口定义（对齐 API Category schema · UUID id）：
  ```ts
  interface CategoryItem {
    id: string;           // UUID
    name: string;
    type: 'income' | 'expense';
    icon: string;         // 单字符图标（从 API icon 字段映射）
    color?: string;
    sortOrder: number;
    parentId: string | null;
    isDirectDefault: boolean;
    childrenCount: number;
  }
  ```
- [ ] `getCategories(familyId: string): Promise<CategoryItem[]>` — 优先读本地缓存，过期/无缓存时调 API
- [ ] `refreshCategories(familyId: string): Promise<CategoryItem[]>` — 强制调 API 刷新
- [ ] 本地缓存策略：`wx.setStorageSync('categories_cache', { data, timestamp })` + TTL 24h
- [ ] `buildCategoryTree(items: CategoryItem[]): { expense: Tier1[]; income: Tier1[] }` — 按 parent_id 组装树
- [ ] `buildDedupMapping(items: CategoryItem[]): Map<string, string>` — 按 is_direct_default 构建去重映射（子分类名 → 一级分类 id）
- [ ] 导出 `getCategoryById(id: string): CategoryItem | undefined` — 供明细页查找

### C2: `miniprogram/components/expense-overlay/categories.ts` — 重写

- [ ] 删除所有硬编码常量（EXPENSE_CATEGORIES / INCOME_CATEGORIES / DEDUP_MAPPING）
- [ ] 删除 buildDedupedSubCategories 函数
- [ ] 改为从 `categoryService` 获取数据：
  ```ts
  import { getCategories, buildCategoryTree, buildDedupMapping } from '../../services/categoryService';
  ```
- [ ] 保留 `CategoryTier1` / `CategoryTier2` 接口（改为 UUID id）
- [ ] 导出 `loadCategories(familyId: string): Promise<{ expense: CategoryTier1[]; income: CategoryTier1[]; dedupMapping: DedupMapping }>`

### C3: `miniprogram/components/expense-overlay/index.ts` — 修改

- [ ] 组件 `attached` 或首次打开时调用 `loadCategories(familyId)` 获取分类数据
- [ ] 用获取的数据替换原来的硬编码引用（this.data.expenseCategories / incomeCategories / dedupMapping）
- [ ] 处理加载失败降级：显示提示 / 使用上次缓存

### C4: `miniprogram/pages/ledger/index.ts` — 修改

- [ ] 删除 `getCategoryIcon()` 和 `getCategoryName()` 中的硬编码 iconMap/nameMap
- [ ] 改为从 `categoryService.getCategoryById(categoryId)` 查找 icon 和 name
- [ ] 处理 category 不存在的降级：显示默认图标 "?" / 默认名 "未分类"

### C5: 兼容处理

- [ ] 确保无硬编码字符串 ID 残留（旧 `'food'`, `'transport'` 等彻底移除）
- [ ] 确保 entry 的 `category_id` 字段使用 UUID（与后端一致）
- [ ] 记账保存时 payload 的 `category_id` 传 UUID

### C6: 闸门通过

- [ ] `npm run typecheck`（miniprogram 编译检查）全绿
- [ ] `npm run lint` 全绿
- [ ] `npm run check:appjson` 全绿
- [ ] 既有单测不回归

---

## §D 可写范围

```
miniprogram/services/categoryService.ts         — 新建
miniprogram/components/expense-overlay/categories.ts — 重写
miniprogram/components/expense-overlay/index.ts  — 修改
miniprogram/pages/ledger/index.ts               — 修改
.team/members/miniapp-dev/state.md              — 更新
.team/members/miniapp-dev/history/              — 新增交付记录
```

**禁写**：`server/` / `design/` / `api/`

---

## §E 技术约束

1. **ID 类型全面切 UUID**：旧的字符串 slug ID（`'food'`, `'food_dining'`）彻底移除
2. **API 调用层**：复用 `miniprogram/services/` 目录下既有的 HTTP 请求封装（如有）或新建简单 fetch wrapper
3. **缓存键**: `categories_cache_${familyId}` — 区分不同家庭
4. **TTL 策略**: 24h 过期 + 应用启动时后台静默刷新
5. **familyId 来源**: 从 `miniprogram/services/family.ts`（COSTRA-165 已建）的 `getActiveFamilyId()` 获取
6. **降级策略**: API 不可达时使用缓存；缓存也无时使用内嵌 fallback 静态数据（从当前硬编码生成，但 ID 改为 UUID 占位）
7. **不引入新依赖**
8. **icon 字段约定**: API 返回的 icon 字段即为单字符图标（如 "餐"、"行"），前端直接使用无需再映射

---

## §F 强制阅读清单

1. `miniprogram/components/expense-overlay/categories.ts` — 当前硬编码（理解数据结构）
2. `miniprogram/components/expense-overlay/index.ts` — 覆盖层使用分类数据的方式
3. `miniprogram/pages/ledger/index.ts` L107-139 — 明细页 icon/name 映射
4. `miniprogram/services/family.ts` — 获取 familyId 的方式
5. `server/api/openapi.yaml` — Category schema（id/icon/name/parent_id/is_direct_default/children_count）
6. `design/ui/category_dictionary.md` — 去重直选归属规则

---

## §G 时间预算

| 阶段 | 预估 |
|------|------|
| 阅读参考代码 | 10 min |
| categoryService.ts 新建 | 20 min |
| categories.ts 重写 | 15 min |
| expense-overlay/index.ts 适配 | 15 min |
| ledger/index.ts 适配 | 10 min |
| 闸门验证 + 修复 | 10 min |
| state.md 更新 | 5 min |
| **合计** | **~85 min** |

---

## §H 验收标准

1. 编译检查全绿
2. 分类数据从 API 获取，本地缓存工作正确
3. 记账覆盖层正常展示分类（支出 8 一级 + 收入 3 一级 + 各自二级）
4. 去重直选归属逻辑通过 `is_direct_default` 字段正确工作
5. 明细页 entry 的分类 icon/name 正确显示
6. 无硬编码字符串 ID 残留
7. 网络异常时降级缓存可用

---

## §I 依赖说明

本卡依赖 **COSTRA-218（B3 后端分类 API）** 完成。在 B3 未完成前，可以先完成 C1（service 层骨架 + 缓存逻辑 + 接口定义），但 C2~C5 的实际联调需 B3 就绪。

**建议执行策略**：B3 完成 → B4 全量执行。若需并行，B4 可先写 service 层 + 接口抽象，B3 merge 后再联调。
