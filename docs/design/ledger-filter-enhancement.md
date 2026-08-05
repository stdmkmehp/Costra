# 明细页筛选增强方案

> 卡号：待分配  
> 状态：方案评审  
> 日期：2026-08-05

## 一、背景与目标

当前明细页（`pages/ledger`）筛选面板支持两个维度：

| 维度 | 交互 | 实现 |
|------|------|------|
| 类型 | 单选 Chip（全部/个人支出/公共支出/收入/转移） | 前端内存过滤 |
| 成员 | 多选头像（仅多人账本显示） | 前端内存过滤 |

本次需新增：

1. **分类筛选**：支持按一级分类 + 二级分类多选过滤
2. **搜索关键词**：按备注/分类名模糊匹配过滤

---

## 二、面板布局（自上而下）

```
┌─────────────────────────────────────────────┐
│  🔍 搜索备注/分类名...    [✕]    │  ← 1. 搜索输入框（新增）
├─────────────────────────────────────────────┤
│  类型         │  ← 2. 类型筛选（现有）
│  [全部] [个人支出] [公共支出] [收入] [转移]    │
├─────────────────────────────────────────────┤
│成员          [取消全选]    │  ← 3. 成员筛选（现有，仅多人账本）
│  (👤)(👤)(👤)      │
├─────────────────────────────────────────────┤
│  分类       [重置]    │  ← 4. 分类筛选（新增）
│  [全部✓] [餐饮] [交通] [购物] [生活]...      │
└─────────────────────────────────────────────┘
```

---

## 三、搜索关键词

### 3.1 UI

- 位于面板最顶部，独占一行
- 左侧搜索图标，中间 input 占满宽度，右侧清空按钮（有内容时显示）
- placeholder：`搜索备注/分类名`
- 输入框高度 64rpx，圆角 32rpx，背景 `rgba(28,27,26,0.06)`

### 3.2 匹配规则

- **匹配字段**：`entry.note`（备注）OR 该条目的分类名（`getCategoryNameById(entry.category_id)`）
- **匹配方式**：大小写不敏感、trim 后 `includes` 子串匹配
- **空输入**：不过滤

### 3.3 触发时机

- `bindinput` 事件 + 300ms 防抖
- 清空按钮 `bindtap` 立即清除并刷新

### 3.4 与其他筛选的关系

AND 逻辑：搜索结果在类型 → 成员 → 分类过滤之后再执行。

---

## 四、分类筛选

### 4.1 数据源

```typescript
import { getCategoriesSync, buildCategoryTree } from '../../services/categoryService';

// 在面板打开时构建：
const tree = buildCategoryTree(getCategoriesSync(familyId));
// tree = { expense: CategoryTier1[], income: CategoryTier1[], transfer: CategoryTier1[] }
```

### 4.2 可见分类范围与类型联动

| 当前类型筛选 | 展示的一级分类 |
|-------------|--------------|
| 全部 | expense + income + transfer 全部一级 |
| 个人支出 | expense 一级 |
| 公共支出 | expense 一级 |
| 收入 | income 一级 |
| 转移 | transfer 一级 |

切换类型时：
- 重建可见分类列表
- 重置分类筛选为「全部」（避免残留无效选中态）

### 4.3 一级分类 UI

- Chip 列表，允许换行（`flex-wrap: wrap`），与现有类型 Chip 样式一致
- 首项固定为「全部」Chip
- 每个一级 Chip 显示：`[图标 名称 状态标记]`

### 4.4 一级 Chip 的三种视觉状态

| 状态 | 含义 | 视觉表现 |
|------|------|----------|
| 全选 ✓ | 该一级下所有二级均被选中 | 深色填充底（`#1c1b1a`）+ 白字 |
| 半选 · | 部分二级被选中 | 深色填充底 + 白字 + 右上角小圆点 |
| 未选 | 该一级下无任何二级被选中 | 浅色底（`rgba(28,27,26,0.06)`）+ 深字 |

### 4.5 交互规则

#### 点击操作

| 操作目标 | 效果 |
|---------|------|
| 点击「全部」Chip | 重置所有分类为全选状态，收起已展开的二级区，不过滤分类 |
| 点击某一级 Chip（收起态） | 展开该一级的二级列表（手风琴：自动收起其他已展开的一级） |
| 点击某一级 Chip（展开态） | 收起该一级的二级列表 |
| 点击二级 Chip | toggle 该二级分类的选中状态 |
| 点击二级区的「全选」Chip | 该一级下所有二级全选 |

#### 长按操作

| 操作目标 | 效果 |
|---------|------|
| 长按某一级 Chip | **Solo 模式**：仅保留该一级（全选其所有二级），取消所有其他一级 |

长按触发时间：350ms，触发时配合轻微震动反馈（`wx.vibrateShort`）。

#### 联动规则

| 事件 | 自动联动 |
|------|---------|
| 某一级下所有二级被取消 | 该一级自动变为「未选」态 |
| 某一级下所有二级被选中 | 该一级自动变为「全选」态 |
| 某一级下部分二级被选中 | 该一级自动变为「半选」态 |
| 所有一级均为全选 | 「全部」Chip 自动激活 |
| 任何一级非全选 | 「全部」Chip 取消激活 |

### 4.6 二级展开区 UI

```
├─────────────────────────────────────────────┤
│  ── 餐饮 ─────────────────────────────────  │  ← 分隔线 + 一级名称
│  [全选✓] [早餐✓] [午餐✓] [晚餐✓] [外卖✓]    │  ← 二级 Chip 行（wrap）
│  [买菜✓] [零食✓] [食材✓]     │
├─────────────────────────────────────────────┤
```

- 展开区出现在一级 Chip 行下方
- 带进入/退出动画（高度过渡 200ms `ease-out`）
- 最多展开 1 个一级（手风琴互斥）

### 4.7 「重置」按钮

位于分类 section 标题右侧，点击效果 = 点击「全部」：
- 所有分类恢复全选
- 收起二级展开区
- 移除分类过滤

---

## 五、筛选按钮文案

面板收起时，顶部区域的筛选按钮文案规则：

| 场景 | 文案 |
|------|------|
| 无任何筛选激活 | `全部 ▼` |
| 有筛选激活 | `筛选中 ▼`（按钮变为激活态样式） |

激活判定条件（满足任一）：
- 类型 ≠ 全部
- 成员非全选
- 分类非全选
- 搜索关键词非空

---

## 六、数据结构

### 6.1 filter-panel 组件 properties 扩展

```typescript
// components/filter-panel/index.ts

/** 分类筛选一级项 */
export interface FilterCategoryTier1 {
  id: string;
  name: string;
  icon: string;      // 已解析的 glyph 字符
  status: 'all' | 'partial' | 'none';  // 全选/半选/未选
  children: FilterCategoryTier2[];
}

/** 分类筛选二级项 */
export interface FilterCategoryTier2 {
  id: string;
  name: string;
  icon: string;
  selected: boolean;
}

// 新增 properties：
properties: {
  // ... 现有 visible / members / entryType ...

  /** 分类筛选列表（一级 + 嵌套二级） */
  categories: {
    type: Array,
    value: [] as FilterCategoryTier1[],
  },
  /** 当前展开的一级分类 ID（空 = 全部收起） */
  expandedCategoryId: {
    type: String,
    value: '',
  },
  /** 分类是否全部选中（控制「全部」Chip 激活态） */
  categoryAllSelected: {
  type: Boolean,
    value: true,
},
  /** 搜索关键词 */
  searchKeyword: {
    type: String,
    value: '',
  },
}
```

### 6.2 FilterState 扩展

```typescript
export interface FilterState {
  entryType: EntryTypeFilter;
  selectedMemberIds: string[];
  /** 选中的二级分类 ID 集合（过滤依据） */
  selectedCategoryIds: string[];
  /** 分类筛选是否激活（非全选时为 true） */
  categoryFilterActive: boolean;
  /** 搜索关键词 */
  searchKeyword: string;
}
```

### 6.3 ledger/index.ts 私有状态扩展

```typescript
// 新增私有属性：
_filterCategoryIds: [] as string[],         // 选中的分类 ID 集合（一级+二级均记录二级 ID）
_categoryFilterActive: false as boolean,    // 是否启用分类过滤
_filterKeyword: '' as string,        // 搜索关键词（trim 后）
_searchDebounceTimer: null as ReturnType<typeof setTimeout> | null,
```

---

## 七、过滤逻辑（`_buildDisplay` 扩展）

在现有两步过滤之后追加两步，四步之间为 AND 关系：

```typescript
_buildDisplay(monthValue?: string) {
  let entries = this._allEntries;

  // Step 1: 流水类型过滤（现有）
  switch (this._filterEntryType) { /* ... */ }

  // Step 2: 成员过滤（现有）
  if (selectedIds.length > 0 && selectedIds.length < allMembers.length) { /* ... */ }

  // Step 3: 分类过滤（新增）
  if (this._categoryFilterActive) {
    const ids = new Set(this._filterCategoryIds);
    entries = entries.filter(e => {
    if (!e.category_id) return false;
 return ids.has(e.category_id);
    });
  }

  // Step 4: 关键词搜索（新增）
  if (this._filterKeyword) {
    const kw = this._filterKeyword.toLowerCase();
    entries = entries.filter(e => {
      const note = (e.note || '').toLowerCase();
      const catName = getCategoryNameById(e.category_id).toLowerCase();
      return note.includes(kw) || catName.includes(kw);
  });
  }

  // 后续：按日期分组 → 汇总 → setData（不变）
}
```

---

## 八、组件事件接口

filter-panel 对外触发的事件：

| 事件名 | payload | 说明 |
|--------|---------|------|
| `entryTypeChange` | `{ entryType }` | 现有 |
| `memberToggle` | `{ userId }` | 现有 |
| `selectAll` | `{ selectAll: boolean }` | 现有 |
| `close` | — | 现有 |
| `categoryToggle` | `{ categoryId, tier: 1 \| 2 }` | 新增：toggle 某个二级分类 |
| `categoryExpand` | `{ categoryId }` | 新增：展开/收起某一级 |
| `categorySolo` | `{ categoryId }` | 新增：长按 solo 某一级 |
| `categorySelectAll` | `{ parentId }` | 新增：某一级下全选 |
| `categoryReset` | — | 新增：重置分类 |
| `searchInput` | `{ keyword }` | 新增：搜索输入 |
| `searchClear` | — | 新增：清空搜索 |

---

## 九、性能与边界

| 方面 | 策略 |
|------|------|
| 分类数据获取 | `getCategoriesSync()` 内存缓存，0 等待 |
| 搜索防抖 | 300ms debounce，避免高频 setData |
| 过滤复杂度 | 当月数据 < 500 条，4 层串行 filter 耗时 < 5ms |
| 面板高度 | 默认态分类区 2~3 行 Chip；展开态追加 1~2 行；总高度可控 |
| 分类变更响应 | 监听 `CATEGORIES_LOADED` 事件，分类更新后重建 filterCategories |
| 切换类型时 | 分类列表重建 + 自动重置为全选，避免残留无效 ID |
| 切换账本时 | 所有筛选状态（含分类/搜索）完全重置 |

---

## 十、实现拆分

| Phase | 内容 | 复杂度 | 依赖 |
|-------|------|--------|------|
| P1 | 搜索输入框 + 防抖 + 过滤逻辑 | 低 | 无 |
| P2 | 分类一级 Chip 展示 + 全选/重置 + 过滤逻辑 | 中 | categoryService |
| P3 | 二级展开 + 手风琴 + 半选联动 + 长按 solo | 中 | P2 |
| P4 | 筛选按钮文案联动 + 激活态样式 | 低 | P1~P3 |

建议 P1 → P2 → P3 → P4 顺序开发，每个 Phase 可独立提交验证。

---

## 十一、WXML 结构示意（分类 section）

```xml
<!-- 分类筛选 section -->
<view class="filter-section">
  <view class="filter-section__header">
    <text class="filter-section__title">分类</text>
    <text class="filter-section__action" bindtap="onCategoryReset"
      wx:if="{{!categoryAllSelected}}">重置</text>
  </view>

  <!-- 一级 Chip 行 -->
  <view class="filter-chips">
    <!-- 全部 -->
    <view
      class="filter-chip {{categoryAllSelected ? 'is-active' : ''}}"
      bindtap="onTapCategoryAll"
  >
      <text class="filter-chip__text">全部</text>
    </view>
    <!-- 各一级分类 -->
    <view
 wx:for="{{categories}}"
      wx:key="id"
   class="filter-chip {{item.status === 'all' ? 'is-active' : item.status === 'partial' ? 'is-active is-partial' : ''}}"
      data-id="{{item.id}}"
  bindtap="onTapCategoryTier1"
      bindlongpress="onLongPressCategoryTier1"
    >
      <text class="filter-chip__icon">{{item.icon}}</text>
      <text class="filter-chip__text">{{item.name}}</text>
      <text wx:if="{{item.status === 'partial'}}" class="filter-chip__dot"></text>
    </view>
  </view>

  <!-- 二级展开区（手风琴，最多展开1个） -->
  <view
    wx:if="{{expandedCategoryId}}"
    class="filter-subcategories"
  >
    <view class="filter-subcategories__divider">
      <text class="filter-subcategories__label">{{expandedCategoryName}}</text>
 </view>
    <view class="filter-chips">
      <view
        class="filter-chip filter-chip--small is-active"
        data-parent="{{expandedCategoryId}}"
      bindtap="onTapSubcategoryAll"
      >
  <text class="filter-chip__text">全选</text>
      </view>
      <view
        wx:for="{{expandedSubcategories}}"
      wx:key="id"
        class="filter-chip filter-chip--small {{item.selected ? 'is-active' : ''}}"
        data-id="{{item.id}}"
        bindtap="onTapCategoryTier2"
      >
      <text class="filter-chip__text">{{item.name}}</text>
      </view>
    </view>
  </view>
</view>
```

---

## 十二、样式补充（关键新增 class）

```css
/* 半选态：深色底 + 右上角小圆点 */
.filter-chip.is-partial .filter-chip__dot {
  position: absolute;
  top: 6rpx;
  right: 6rpx;
  width: 10rpx;
  height: 10rpx;
  border-radius: 50%;
  background: #f1f2ec;
}

.filter-chip.is-partial {
  position: relative;
}

/* 图标（分类 Chip 内） */
.filter-chip__icon {
  font-size: 22rpx;
  margin-right: 4rpx;
}

/* 二级展开区 */
.filter-subcategories {
  margin-top: 16rpx;
  padding-top: 16rpx;
  border-top: 1rpx solid rgba(28, 27, 26, 0.08);
  animation: slideDown 200ms ease-out;
}

@keyframes slideDown {
  from { opacity: 0; max-height: 0; }
  to   { opacity: 1; max-height: 300rpx; }
}

.filter-subcategories__divider {
  margin-bottom: 12rpx;
}

.filter-subcategories__label {
  font-size: 22rpx;
  color: rgba(28, 27, 26, 0.36);
}

/* 小号 Chip（二级分类用） */
.filter-chip--small {
  padding: 8rpx 18rpx;
}

.filter-chip--small .filter-chip__text {
  font-size: 22rpx;
}

/* 搜索输入框 */
.filter-search {
  display: flex;
  align-items: center;
  height: 64rpx;
  border-radius: 32rpx;
  background: rgba(28, 27, 26, 0.06);
  padding: 0 24rpx;
  margin-bottom: 24rpx;
}

.filter-search__icon {
  font-size: 28rpx;
  color: rgba(28, 27, 26, 0.36);
  margin-right: 12rpx;
}

.filter-search__input {
  flex: 1;
  font-size: 26rpx;
  color: #1c1b1a;
}

.filter-search__clear {
  font-size: 28rpx;
  color: rgba(28, 27, 26, 0.36);
  padding: 8rpx;
}
```
