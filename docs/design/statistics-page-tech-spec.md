# 统计页技术设计与任务拆分

> **卡号族**：COSTRA-225（统计页 UI · 主线）+ 配套后端 / 索引 / 公共组件卡
> **文档版本**：v1.0
> **创建时间**：2026-06-05
> **作者**：Orchestrator
> **设计源**：`design/ui/design_spec.md §6.4` + `design/ui/interaction_flow.md §5`
> **范围**：统计页（Tab2）从骨架占位到功能完整的端到端实装

---

## 1. 需求总览

### 1.1 核心交付目标

完成 `pages/statistics/` 从骨架占位到功能完整的实装，覆盖：

1. **月度视角**：宏观数字 + 单色折线图 + 摘要 4 格 + 一级分类排行手风琴下钻
2. **年度视角**：宏观数字 + 12 月折线图 + 摘要 4 格 + 12 月流水简表 + 全年分类排行
3. **三层下钻**：一级分类 → 二级分类 → 单笔明细（手风琴展开）
4. **成员维度 swiper**：组件框架完成（数据拉取与展示后续做）
5. **时间导航**：`[<] 2026年6月 ▼ [>]` + `[月度 / 年度]` 维度切换
6. **零值排除 + 长列表省略**：与设计文档 §6.4 一致

### 1.2 不做范围（明确边界）

- **成员维度数据拉取**：swiper 组件做框架，但「自己 / 成员A / 成员B」各自报表的实际拉取逻辑不做（仅展示「全部」）
- **折线图手势交互**：明确为「纯静态展示 Static Visual Trend」
- **同比环比**：宏观区的 `↓ 12% 较上月` 文案做 UI 但**不做实际计算**（设计文档说「极简的同环比提示」，可后续补；本期只显示主数字 + 收入）
  - 决策：**本期省略同环比**，避免过度设计
- **Solo 账本（个人账本）**：与多人账本统一渲染逻辑（Solo 时无 swiper、无成员段，公共支出永不出现），不做单独空态页
- **跨年（如 2025-12 → 2026-01）的折线趋势**：不在本期范围

---

## 2. 信息架构与组件分解

### 2.1 页面信息架构

```
pages/statistics/index
├─ Sticky Header（毛玻璃导航栏 · 复用 ledger 模式）
│   ├─ 账本切换胶囊（点击唤起 ActionSheet · 复用现有逻辑）
│   └─ 时间维度区
│       ├─ [<] 2026年6月 ▼ [>] （月度时显示）/ [<] 2026年 [>] （年度时显示）
│       └─ [月度 | 年度] 切换胶囊
│
├─ 内容区（swiper 框架 · 但 R1 仅渲染「全部」一档）
│   └─ 月度视角 / 年度视角（dimension 切换）
│       ├─ 宏观区
│       │   ├─ 巨大数字「总支出 ¥12,345.67」「总收入 ¥8,000.00」
│       │   └─ SVG 折线图（30 天 / 12 月静态趋势）
│       │
│       ├─ 摘要区（2x2 网格 · 4 格）
│       │   月度: 日均支出 / 最大单笔 / 单日最高 / 记账笔数
│       │   年度: 月均支出 / 年度最大单笔 / 单月最高 / 全年最贵分类
│       │
│       ├─ 月度流水区（仅年度视角）
│       │   12 月垂直简表 [月份] [总支出] [总收入] [结余]
│       │   点击单月 → 切回月度视角并定位到该月
│       │
│       └─ 排行区（一级分类排行 + 三层下钻）
│           L1 一级分类（餐饮 ¥3000）→ 点击 →
│           L2 二级分类（外卖 ¥1500、堂食 ¥800）→ 点击 →
│           L3 单笔明细（外卖 美团外卖 ¥88、…）
│
└─ 空态（无任何数据时居中提示「本月暂无收支记录」）
```

### 2.2 子模块拆分（前端组件）

| 子模块 | 文件 | 复用来源 | 复杂度 |
|--------|------|---------|--------|
| 时间导航条 | inline in `pages/statistics/index` | 家庭页 | 简单 |
| SVG 折线图 | `components/trend-line-chart/` | 新建 | 简单（SVG 字符串拼接） |
| 摘要 4 格 | inline + `wxss` 网格 | 新建 | 简单 |
| 12 月流水简表 | inline | 新建 | 简单 |
| 一级分类排行 + 手风琴 | inline | 家庭页排行区 | 中 |
| 二级分类排行（L2） | inline · 嵌套展开 | 复用 L1 渲染逻辑 | 简单 |
| 单笔明细列表（L3） | inline · 嵌套展开 | 复用明细页条目行 | 简单 |
| 成员 swiper 框架 | inline · `<swiper>` | 新建（仅框架） | 简单 |

---

## 3. 后端设计

### 3.1 接口清单

#### 3.1.1 月度统计主接口

```
GET /v1/families/{family_id}/statistics/monthly
  Query:
    - month: YYYY-MM (required)
    - user_id: UUID (optional · 成员维度筛选 · R1 不传或为空表示「全部」)
  Response: MonthlyStatistics
```

**响应结构**（OpenAPI schema）：
```yaml
MonthlyStatistics:
  type: object
  required: [family_id, family_name, family_kind, ledger_id, ledger_name, month, timezone, range_start, range_end, currency, totals, daily_trend, extremes, category_ranks]
  properties:
    family_id: { type: string, format: uuid }
    family_name: { type: string }
    family_kind: { type: string, enum: [personal, shared] }
    ledger_id: { type: string, format: uuid }
    ledger_name: { type: string }
    month: { type: string, pattern: '^\d{4}-\d{2}$' }
    timezone: { type: string, enum: [Asia/Shanghai] }
    range_start: { type: string, format: date-time }
    range_end: { type: string, format: date-time }
    currency: { type: string, enum: [CNY] }
    totals:
      type: object
      properties:
        expense: { type: integer, description: '当月总支出（cents）' }
        income: { type: integer, description: '当月总收入（cents）' }
        balance: { type: integer, description: '收入 - 支出（cents）' }
        entry_count: { type: integer }
    daily_trend:
      type: array
      description: '当月每日支出趋势 · 长度 = 当月天数 · 缺失日填 0'
      items:
        type: object
        properties:
          day: { type: integer, description: '日（1~31）' }
          expense: { type: integer }
          income: { type: integer }
    extremes:
      type: object
      properties:
        avg_daily_expense: { type: integer, description: '日均支出 = expense / 当月天数' }
        max_single_expense: { type: integer, description: '当月最大单笔支出' }
        max_day_expense: { type: integer, description: '当月单日最高支出' }
    category_ranks:
      type: array
      description: 'L1 一级分类排行（金额降序 · 仅 expense 且 amount > 0 · 上限 top_n=20）'
      items:
        $ref: '#/components/schemas/StatCategoryRankItem'

StatCategoryRankItem:
  type: object
  properties:
    category_id: { type: string, format: uuid, nullable: true, description: 'L1=parent_id; L2=category_id' }
    category_name: { type: string }
    icon: { type: string, description: '分类图标' }
    amount: { type: integer }
    entry_count: { type: integer }
    ratio_bps: { type: integer, description: '占比万分比 0~10000' }
```

#### 3.1.2 年度统计主接口

```
GET /v1/families/{family_id}/statistics/yearly
  Query:
    - year: YYYY (required)
    - user_id: UUID (optional)
  Response: YearlyStatistics
```

**响应结构**：
```yaml
YearlyStatistics:
  type: object
  properties:
    family_id, family_name, family_kind, ledger_id, ledger_name: <同上>
    year: { type: string, pattern: '^\d{4}$' }
    timezone, range_start, range_end, currency: <同上>
    totals:
      type: object
      properties:
        expense, income, balance, entry_count: <同上 cents>
    monthly_trend:
      type: array
      description: '12 月趋势 · 长度恒为 12 · 缺失月填 0'
      items:
        type: object
        properties:
          month: { type: integer, description: '1~12' }
          expense, income, balance: { type: integer }
          entry_count: { type: integer }
    extremes:
      type: object
      properties:
        avg_monthly_expense: { type: integer, description: '月均 = expense / 当年已过月份数' }
        max_single_expense: { type: integer }
        max_month_expense: { type: integer, description: '单月最高支出' }
        max_month_label: { type: string, description: '8月' }
        top_category_name: { type: string, nullable: true, description: '全年最贵分类（一级）' }
        top_category_amount: { type: integer }
    category_ranks:
      type: array
      description: 'L1 一级分类排行（全年汇总 · top_n=20）'
      items:
        $ref: '#/components/schemas/StatCategoryRankItem'
```

#### 3.1.3 下钻接口（覆盖 L2 + L3）

```
GET /v1/families/{family_id}/statistics/drill-down
  Query:
    - month: YYYY-MM (required if year not set)
    - year: YYYY (required if month not set · 月度/年度 互斥)
    - level: 2 | 3 (required)
    - parent_category_id: UUID (required when level=2)
    - category_id: UUID (required when level=3)
    - user_id: UUID (optional · R1 不传)
    - limit: integer (default=10, min=1, max=50)
    - offset: integer (default=0, min=0)
  Response: DrillDownResponse
```

**响应结构**：
```yaml
DrillDownResponse:
  type: object
  oneOf:
    - $ref: '#/components/schemas/DrillDownLevel2Response'
    - $ref: '#/components/schemas/DrillDownLevel3Response'

DrillDownLevel2Response:
  type: object
  properties:
    level: { type: integer, enum: [2] }
    parent_category_id: { type: string, format: uuid }
    parent_category_name: { type: string }
    parent_amount: { type: integer, description: '一级分类总额（用于二级占比基数）' }
    items:
      type: array
      items: { $ref: '#/components/schemas/StatCategoryRankItem' }
    total_count: { type: integer }
    has_more: { type: boolean }

DrillDownLevel3Response:
  type: object
  properties:
    level: { type: integer, enum: [3] }
    category_id: { type: string, format: uuid }
    category_name: { type: string }
    parent_category_id: { type: string, format: uuid, nullable: true }
    parent_category_name: { type: string, nullable: true }
    category_amount: { type: integer, description: '二级分类总额' }
    items:
      type: array
      items:
        type: object
        properties:
          entry_id: { type: string, format: uuid }
          amount: { type: integer }
          note: { type: string, nullable: true }
          occurred_at: { type: string, format: date-time }
          shared_type: { type: string, enum: [shared, personal], nullable: true }
          created_by: { type: string, format: uuid }
          nickname: { type: string }
          avatar_url: { type: string, nullable: true }
    total_count: { type: integer }
    has_more: { type: boolean }
```

### 3.2 业务规则

| 规则 | 说明 |
|------|------|
| **时区** | 固定 `Asia/Shanghai`（与 `familySummaryService` 一致） |
| **月度 expense 口径** | `type='expense' AND shared_type IN ('shared','personal')` （与 family summary 一致 · `shared_type IS NULL` 不计入） |
| **年度 expense 口径** | 同上 |
| **L1 排行口径** | 按 `parent_category_id` 分组 · 仅 `expense` · `amount > 0` · 排除 `category_id IS NULL` |
| **L2 排行口径** | 按 `category_id` 分组 · `WHERE c.parent_id = $parent_category_id` · `amount > 0` |
| **L3 单笔口径** | `WHERE category_id = $category_id` · 排序 `amount DESC, occurred_at DESC` |
| **空月份** | 返回全 0 + 空数组，不返回 404 |
| **零值排除** | L1/L2 排行 `HAVING SUM(amount) > 0`；L3 单笔 amount 必 > 0（DB 约束） |
| **权限守门** | 复用 `familyService.assertActiveMember(userId, familyId)` |
| **transfer 类型** | 不计入任何聚合（与现有口径一致） |
| **左侧成员（已退出）** | 历史 expense 仍计入家庭聚合（数据不可变原则） |

### 3.3 性能策略

#### 索引新增（migration 0014）

```sql
-- server/db/migrations/0014_statistics_indexes.sql
BEGIN;

-- L2 / L3 加速：按 category_id 筛选
CREATE INDEX IF NOT EXISTS idx_entries_category_id
  ON entries (category_id) WHERE deleted_at IS NULL;

-- L1 加速：parent_id JOIN（categories 表已有 PK，但 parent_id 无索引）
CREATE INDEX IF NOT EXISTS idx_categories_parent_id
  ON categories (parent_id) WHERE deleted_at IS NULL;

COMMIT;
```

#### 单接口耗时预算（R1 目标）

| 接口 | 单月 entries ≤ 5000 时 P95 |
|------|---------------------------|
| GET /statistics/monthly | ≤ 500ms |
| GET /statistics/yearly | ≤ 800ms（12 个月聚合） |
| GET /statistics/drill-down level=2 | ≤ 200ms |
| GET /statistics/drill-down level=3 | ≤ 200ms |

#### SQL 优化要点

- **L1 排行**：单次 GROUP BY entries + 1 次 categories 批量查询（拿 parent_id + name）+ 1 次 parent categories 批量查询（拿 parent_name）。避免 N+1。
- **年度月度趋势**：用 `date_trunc('month', occurred_at AT TIME ZONE 'Asia/Shanghai')` 一次性 group by 12 月。
- **月度日趋势**：用 `EXTRACT(DAY FROM occurred_at AT TIME ZONE 'Asia/Shanghai')` 一次性 group by 31 天。
- **drill-down level=2**：JOIN categories 一次性拿 parent_id（已 SQL 中过滤 parent_id），避免分两次。
- **drill-down level=3**：JOIN users 拿 nickname/avatar，单次查询。

#### 关键架构决策

> **决策 D-COSTRA-225-A：drill-down 接口不实现 server 端缓存**
>
> 用户每次点击展开都触发 drill-down 请求；前端可做 entry-level 缓存（同一 month + parent_id 的 L2 结果在 page lifetime 内缓存）。理由：
> 1. 数据频繁变更（每次记账都可能影响排行）
> 2. SQL 已足够快（< 200ms · 5000 条目级）
> 3. 缓存复杂度高，invalidate 链路与 `SYNC_DONE` 联动需要专门设计
> 4. 前端缓存已能解决 80% 用户感知问题

### 3.4 后端文件结构

```
server/src/
├─ routes/
│   └─ statistics.ts              （新增 · 3 个接口路由）
├─ services/
│   └─ statisticsService.ts       （新增 · 业务编排层）
├─ repositories/
│   └─ statisticsRepo.ts          （新增 · DAO 层）
└─ test/
    └─ statistics.test.ts         （新增 · 集成测试）

server/db/migrations/
└─ 0014_statistics_indexes.sql    （新增）

server/test/setup.ts               （修改 · pg-mem DDL 双写新索引）

server/api/openapi.yaml             （修改 · 新增 3 个 endpoint + 6 个 schema）
```

---

## 4. 前端设计

### 4.1 组件 / 服务文件结构

```
miniprogram/
├─ pages/statistics/
│   ├─ index.ts          （重写 · 替代当前骨架）
│   ├─ index.wxml        （重写）
│   ├─ index.wxss        （重写）
│   └─ index.json        （新增 trend-line-chart 组件引用）
│
├─ components/trend-line-chart/    （新增 · 通用折线图组件）
│   ├─ index.ts
│   ├─ index.wxml
│   ├─ index.wxss
│   └─ index.json
│
└─ services/
    └─ statisticsApi.ts            （新增 · 3 个接口封装 + 缓存）
```

### 4.2 statisticsApi.ts 设计

```typescript
// services/statisticsApi.ts

export interface MonthlyStatistics { /* 对齐 OpenAPI */ }
export interface YearlyStatistics { /* 对齐 OpenAPI */ }
export interface DrillDownLevel2Response { /* 对齐 OpenAPI */ }
export interface DrillDownLevel3Response { /* 对齐 OpenAPI */ }

/** 月度统计 · SWR 模式（与 familyApi.getFamilySummary 一致） */
export async function getMonthlyStatistics(familyId: string, month: string): Promise<MonthlyStatistics>;

/** 年度统计 · SWR 模式 */
export async function getYearlyStatistics(familyId: string, year: string): Promise<YearlyStatistics>;

/** 下钻 L2 · 带 page-lifetime 缓存（key: family|month|parentCategoryId） */
export async function drillDownLevel2(
  familyId: string,
  scope: { month?: string; year?: string },
  parentCategoryId: string,
  options?: { limit?: number; offset?: number }
): Promise<DrillDownLevel2Response>;

/** 下钻 L3 · 带 page-lifetime 缓存（key: family|month|categoryId|offset） */
export async function drillDownLevel3(
  familyId: string,
  scope: { month?: string; year?: string },
  categoryId: string,
  options?: { limit?: number; offset?: number }
): Promise<DrillDownLevel3Response>;

/** 失效缓存（统计页 SYNC_DONE 触发） */
export function invalidateStatisticsCache(familyId: string): void;

/** 获取当前缓存（无网络 · SWR 立即渲染用） */
export function getCachedMonthly(familyId: string, month: string): MonthlyStatistics | null;
export function getCachedYearly(familyId: string, year: string): YearlyStatistics | null;
```

### 4.3 trend-line-chart 组件设计

**职责**：纯静态展示 expense 趋势曲线（不响应手势）。

**实现策略**：使用 **SVG**（`data:image/svg+xml` URI 作为 `<image>` 的 src），而非 `<canvas type="2d">`。

> 历史抉择：v1 曾使用 canvas。canvas 是同层渲染原生组件，在页面快速滚动时
> Native 合成线程与 WebView 之间存在位置同步滞后（iOS 尤其明显），表现为
> "折线追不上其他文字元素"。SVG 走 WebView 同线程渲染，与文本零滞后跟随。
> 数据点 ≤ 31，矢量字符串约 1KB，性能与可读性都优于 canvas。

```typescript
// components/trend-line-chart/index.ts
Component({
  properties: {
    /** 数据点 · 长度 = 当月天数（30/31）或 12（年度） */
    data: { type: Array, value: [] as number[] },
    /** 高度（rpx） */
    height: { type: Number, value: 160 },
    /** 折线颜色 */
    color: { type: String, value: '#1c1b1a' },
    /** 渐变填充（可选 · 底部柔和阴影感） */
    fillGradient: { type: Boolean, value: true },
  },
  data: {
    instanceId: '',  // 防止多实例 <linearGradient id> 冲突
    svgUri: '',
  },
  lifetimes: {
    attached() {
      this.setData({ instanceId: rand() }, () => this._render());
    },
  },
  observers: {
    'data, color, fillGradient': function() { this._render(); },
  },
  methods: {
    _render() {
      // 1. 取 data max → 用作 Y 轴比例
      // 2. 平滑曲线（Bezier 控制点取相邻两点 1/3 与 2/3）连接每个数据点
      // 3. fillGradient 时 <defs><linearGradient> alpha 0.15 → 0
      // 4. 不绘制坐标轴 / 网格 / 标签
      // 5. 数据空 / 全 0 / 单点 → 平直中线（避免空白突兀）
      // 6. SVG 字符串 → svgToDataUri() → setData({ svgUri })
    },
  },
});
```

**关键技术要点**：
- SVG `viewBox="0 0 100 40"` + `preserveAspectRatio="none"` 让矢量横向自适应容器宽度，无需测量 DOM 尺寸
- 平滑曲线：cubic Bezier，控制点取相邻两点的 1/3 与 2/3（与 Apple Health 风格一致）
- 渐变填充：`<defs><linearGradient>` 双 stop（rgb 0.15 → rgb 0），id 拼 instanceId 防多实例冲突
- 容错：data 为空 / 全 0 / 单点 → 不报错，绘制平直中线
- URI 编码：仅转义 `% # & < >` 与 `"`（最小必要集），保持体积尽量小

### 4.4 pages/statistics/index 主逻辑

```typescript
// pages/statistics/index.ts （骨架）
Page({
  data: {
    // 首屏保护
    ready: false,
    statusBarHeight: 0, navBarHeight: 44,

    // 账本
    familyId: '', ledgerName: '个人账本', familyKind: 'personal',

    // 时间维度
    dimension: 'monthly' as 'monthly' | 'yearly',
    currentMonth: getCurrentMonthValue(),  // YYYY-MM
    currentYear: getCurrentYearValue(),    // YYYY
    timeDisplay: '',  // 「2026年6月」or「2026年」

    // 月度数据
    monthly: null as MonthlyStatistics | null,
    monthlyTrend: [] as number[],   // 31 个 expense

    // 年度数据
    yearly: null as YearlyStatistics | null,
    yearlyTrend: [] as number[],    // 12 个 expense

    // 摘要 4 格（结构化 · WXML 直接遍历）
    summaryItems: [] as { label: string; value: string }[],

    // 12 月流水（年度视角）
    monthlyRows: [] as { month: number; label: string; expense: string; income: string; balance: string }[],

    // 一级分类排行 + Accordion 展开
    categoryRanks: [] as L1RankItem[],
    expandedL1Id: '',  // 当前展开的一级分类 id（'' 表示无）

    // 二级分类排行（L2）· 缓存在内存中，不放 data
    // L3 单笔明细同理

    // 成员 swiper（R1 仅 1 屏）
    memberTabIndex: 0,
    memberTabs: [{ key: 'all', label: '全部' }] as MemberTab[],

    // 空态
    isEmpty: false, loading: true,
  },

  // 内部状态
  _ledgerId: '',
  _l2Cache: new Map<string, L2Item[]>(),  // key: month|parentId
  _l3Cache: new Map<string, L3Item[]>(),  // key: month|categoryId
  _syncDoneHandler: null,

  onLoad() { /* 同 ledger/family 模式 · bootstrap gate + 订阅 SYNC_DONE */ },
  onShow() { /* triggerOnPageShow + _loadData */ },
  onUnload() { /* 取消订阅 */ },

  // 数据加载
  async _loadData() {
    if (this.data.dimension === 'monthly') {
      await this._loadMonthly();
    } else {
      await this._loadYearly();
    }
  },

  async _loadMonthly() {
    // SWR：cache → 立即渲染 → 网络 → 重新渲染
    const cached = getCachedMonthly(this._familyId, this.data.currentMonth);
    if (cached) this._buildMonthlyDisplay(cached);
    else this.setData({ loading: true });

    const fresh = await getMonthlyStatistics(this._familyId, this.data.currentMonth);
    this._buildMonthlyDisplay(fresh);
  },

  // 构建展示数据（cents → 元 · 排序 · 摘要数字）
  _buildMonthlyDisplay(s: MonthlyStatistics) { /* ... */ },
  _buildYearlyDisplay(s: YearlyStatistics) { /* ... */ },

  // 交互
  onPrevMonth() { ... }
  onNextMonth() { ... }
  onMonthChange(e) { ... }   // <picker> 滚轮
  onYearChange(e) { ... }    // 年度同
  onSwitchDimension(e) { ... }
  onTapLedgerName() { ... }  // 复用现有逻辑

  // 三层下钻
  async onTapL1Category(e) {
    const parentId = e.currentTarget.dataset.id;
    if (this.data.expandedL1Id === parentId) {
      // 收起
      this.setData({ expandedL1Id: '' });
      return;
    }
    // 展开 · 拿 L2
    const l2 = await this._loadL2(parentId);
    this._injectL2Items(parentId, l2);
    this.setData({ expandedL1Id: parentId });
  },

  async onTapL2Category(e) {
    const categoryId = e.currentTarget.dataset.id;
    // toggle L3 展开 · 嵌套在 L2 渲染结构中
    const l3 = await this._loadL3(categoryId);
    this._injectL3Items(categoryId, l3);
  },

  // 年度月度流水点击 → 切回月度视角
  onTapMonthlyRow(e) {
    const month = e.currentTarget.dataset.month;
    this.setData({
      dimension: 'monthly',
      currentMonth: `${this.data.currentYear}-${String(month).padStart(2, '0')}`,
    });
    this._loadMonthly();
  },
});
```

### 4.5 列表省略策略

**与设计文档一致**：
- L1 一级分类排行：超过 6 项时仅展示前 6 项 + 「还有 X 项较小支出未显示...」
- L2 二级分类排行：同 L1 规则
- L3 单笔明细：limit=10 · 「还有 X 笔未显示」

**实现方式**：后端默认 `top_n=20` / `limit=10` 已限制；前端仅在数组末尾显示提示行（基于 `has_more`）。

### 4.6 SYNC_DONE 响应式刷新

```typescript
// 与 family 页相同的失效策略
const syncDoneHandler = (payload?: SyncDonePayload) => {
  if (!payload || (payload.pulled <= 0 && payload.pushed <= 0)) return;
  // 失效缓存 + 重拉当前展示
  invalidateStatisticsCache(this._familyId);
  // 失效 L2/L3 内存缓存
  this._l2Cache.clear();
  this._l3Cache.clear();
  // 收起展开（数据可能变化，避免显示陈旧 L2/L3）
  this.setData({ expandedL1Id: '' });
  void this._loadData();
};
```

### 4.7 R2 成员维度横滑切换

> 卡号：COSTRA-260（后端 user_id）/ COSTRA-261（前端框架）/ COSTRA-262（收尾）/ COSTRA-263（native swiper 改造）

**后端**：月度 / 年度 / drill-down 3 接口新增 `user_id` 可选查询参数（COSTRA-260 已落地）。不传或为空表示"全部"（原逻辑不变）。

**前端数据结构**：
- `monthlyByMember: Record<MemberKey, MonthlyView>` — 按 memberKey（`'all'` | userId）索引
- `yearlyByMember: Record<MemberKey, YearlyView>` — 同上
- 每个 view 含 `loading` / `loaded` 状态位 + L1/L2/L3 展开态（嵌套在 `l1[].expanded` / `l1[].l2Items[].expanded` 中）

**横滑方案（COSTRA-263 改造）**：native `<swiper>` + auto-height adapter（邻域高度保护）。
- 用 native swiper 负责跟手、方向锁、不可停中间、一次只滑一项
- 不再使用数据区横向 scroll-view / scroll-snap / onPagesScroll
- swiper 高度动态策略：
  - **稳定态**：高度 = 当前 pane 实测高度（`_measureCurrentPaneHeight` → `memberSwiperHeightPx`）
  - **手势拖动开始**（`onMemberSwiperTouchStart`）：高度扩到 `max(current, prev, next)`，防止滑动时邻居 pane 被裁
  - **顶部点击跳成员**（`onTapMemberTab`）：高度扩到 `max(current, target)` + `duration=0` 直接切（不展示跨多页滑行动画）
  - **`animationfinish`**：收缩到目标 pane 实测高度
- 高度 CSS transition: `height 180ms ease-out`（视觉平滑）

**页面滚动位置策略（COSTRA-263）**：
- `onPageScroll` 持续追踪 `_pageScrollTop`
- 首次加载后测量 `.member-strip` 绝对位置缓存为 `_memberAnchorTopPx`
- 切成员时（tap 或 swipe），若 `_pageScrollTop > _memberAnchorTopPx + 120`，则 `wx.pageScrollTo` 回到成员条附近（duration=180ms）
- 页面上半部切换不强行滚动，避免打断浏览

**成员独立下钻态（D3 决策）**：每个成员维护独立的展开态。横滑切换成员不做 merge / 镜像，也不强制收起。通过 `data-memberkey` dataset 属性 + `${dimKey}.${memberKey}.l1` 路径写回实现隔离。

**失效策略**：
- **scope 变更**（切月份 / 切年份 / 切账本）：`_clearCurrentDimViews()` 全清当前维度所有成员的 byMember，仅重拉当前选中成员；其他成员等切到时由 `_ensureMemberLoaded` 懒加载。
- **数据变更**（SYNC_DONE / ENTRY_SAVED / ENTRY_UPDATED）：`_invalidateCurrentDimViews()` 仅将所有成员标记 `loaded: false`（不清空视图数据 → 保留展开态视觉），当前选中成员立即重拉。其他成员等切到时检测 `loaded === false` 重新拉。
- **维度切换**（月度 ↔ 年度）：不动 byMember，仅确保当前成员在新维度有数据。
- **成员切换**（Tab 点击 / 横滑）：不动 byMember，仅 `_ensureMemberLoaded` 按需加载。

---

### 5.1 Card 概览

| Card | 标题 | Owner | 估点 | 依赖 | 必需性 |
|------|------|-------|------|------|--------|
| **COSTRA-224** | 后端统计接口（monthly + yearly + drill-down） | backend-dev | 5 | — | P0 |
| **COSTRA-225** | 统计页月度视角实装 | miniapp-dev | 5 | 224 | P0 |
| **COSTRA-226** | 统计页年度视角实装 | miniapp-dev | 3 | 224, 225 | P0 |
| **COSTRA-229** | 统计页成员维度 swiper 框架 | miniapp-dev | 1 | 225 | P1 |
| **COSTRA-230** | trend-line-chart 公共组件 | miniapp-dev | 2 | — | P0（225 内嵌） |

> 注：编号沿用现有 board.md 范畴；具体编号由 Orchestrator 立卡时分配。本设计仅为命名占位。

**总估点**：~16 点

### 5.2 Card 详细 DoD

#### COSTRA-224 · 后端统计接口

**Scope**：

A. **DB Migration 0014 · 索引补齐**
- `idx_entries_category_id` (partial · WHERE deleted_at IS NULL)
- `idx_categories_parent_id` (partial · WHERE deleted_at IS NULL)
- `server/test/setup.ts` 双写（pg-mem 跳过 partial unique 已知坑）

B. **`server/api/openapi.yaml` 新增 3 个 endpoint + 6 个 schema**
- `GET /families/{family_id}/statistics/monthly`
- `GET /families/{family_id}/statistics/yearly`
- `GET /families/{family_id}/statistics/drill-down`
- 6 个 schema: `MonthlyStatistics` / `YearlyStatistics` / `StatCategoryRankItem` / `DrillDownLevel2Response` / `DrillDownLevel3Response` / `StatExtremes`

C. **`statisticsRepo.ts` DAO 实现**
- `getMonthlyTotalsAndExtremes(ledgerId, range)` — totals + max_single + max_day（一次 SQL）
- `getDailyTrend(ledgerId, range)` — 按日 GROUP BY（Asia/Shanghai 时区转换）
- `getMonthlyTrend(ledgerId, year)` — 按月 GROUP BY 12 个月
- `getCategoryRanksL1(ledgerId, range, topN)` — 按 parent_id 聚合 + 批量查 categories
- `getCategoryRanksL2(ledgerId, range, parentId, limit, offset)` — 按 category_id 聚合 + 子分类筛选
- `getEntriesByCategory(ledgerId, range, categoryId, limit, offset)` — JOIN users 拿昵称/头像

D. **`statisticsService.ts` 业务编排**
- `getMonthlyStatistics(userId, { familyId, month, userId? })`
- `getYearlyStatistics(userId, { familyId, year, userId? })`
- `getDrillDown(userId, { familyId, scope, level, parentCategoryId?, categoryId?, limit, offset })`
- 复用 `assertActiveMember` 守门
- 复用 `parseMonthRange`（在 family summary 内有），新写 `parseYearRange`

E. **`statistics.ts` 路由层**
- 3 个 GET 路由
- Fastify schema 校验（month / year 格式 / level enum / UUID 格式）
- 标准 errorHandler

F. **`statistics.test.ts` 集成测试**
- T1 月度接口 · 单人账本 · 空月份返回全 0
- T2 月度接口 · 多人账本 · 含 shared 与 personal expense
- T3 月度接口 · 单 expense 单 day · 验证 daily_trend 正确填 0
- T4 月度接口 · max_day 与 max_single 正确性
- T5 月度接口 · category_ranks 按 parent_id 聚合（多个二级 → 同一一级）
- T6 月度接口 · 零值排除 · 排序稳定
- T7 年度接口 · 12 月趋势完整性 · top_category_name 正确
- T8 年度接口 · 跨年边界（year=2026 不混入 2025/2027 数据）
- T9 drill-down level=2 · 二级排行
- T10 drill-down level=3 · 单笔明细 · JOIN users 取 nickname
- T11 drill-down 分页（offset=0 vs offset=10）+ has_more
- T12 跨 family 守门 · 非成员 403
- T13 已退出成员的历史 entries 仍计入
- T14 transfer 类型不计入

**闸门**：
- typecheck 0 error
- vitest 全绿（含新增 14 测）
- whitelist-check 通过（OpenAPI 与 fastify 路由 path 对齐）

**预估**：5 点 · 可单 backend-dev 装扮档 R1 完成

#### COSTRA-230 · trend-line-chart 公共组件

**Scope**：
- `components/trend-line-chart/` 四件套
- 支持 props: `data: number[]`, `height: number`, `color: string`, `fillGradient: boolean`
- SVG `data:image/svg+xml` URI + Bezier 平滑曲线 + `<linearGradient>` 渐变填充
- 容错：`data` 为空 / 全 0 / 单点

**单测**（可选 · 改 SVG 字符串生成后变得易测）：
- 数据为空时 setData 不报错
- 数据全 0 时 setData 不报错
- 数据单点时不报错

**预估**：2 点

#### COSTRA-225 · 统计页月度视角实装

**Scope**：
- `pages/statistics/index.{ts,wxml,wxss,json}` 全部重写
- `services/statisticsApi.ts` 新建（含 3 个接口 + SWR 缓存）
- 集成 trend-line-chart 组件
- 时间导航条（[<] [>] picker）+ 维度切换胶囊
- 宏观区数字 + 折线图
- 摘要 4 格
- L1 一级分类排行 + 手风琴展开 L2 + L3
- L2/L3 内存缓存（page-lifetime · `_l2Cache` / `_l3Cache`）
- SYNC_DONE 订阅 + 即时刷新 + 失效缓存
- 空态文案与设计一致
- bootstrapPromise gate + tabbar markActive(1)

**DoD**：
- 单人账本月度可用
- 多人账本月度可用（仅「全部」一档）
- 折线图正确渲染当月 30/31 天数据
- 三层下钻交互完整可用
- L1 收起 L2 时 L2 视觉淡出
- 列表省略提示文字按设计要求展示
- typecheck + lint + 现有 vitest 全绿
- 真机/开发者工具冒烟通过

**预估**：5 点

#### COSTRA-226 · 统计页年度视角实装

**Scope**：
- 维度切换至年度时切换数据源到 `getYearlyStatistics`
- 月度流水区（12 月垂直简表）
- 摘要 4 格切到年度版
- 折线图切到 12 月趋势
- 月度流水点击 → 切回月度视角并定位到该月（`dimension='monthly'` + `currentMonth=该月`）
- 年度排行的 drill-down 复用 monthly 路径（drill-down 接口已支持 `year` 参数）

**DoD**：
- 年度视角与月度视角无缝切换
- 12 月简表点击交互正确（含已过月份和未来月份）
- 当前年内未来月份显示 0/0/0 不报错

**预估**：3 点

#### COSTRA-229 · 统计页成员维度 swiper 框架

**Scope**：
- `<swiper>` + `<swiper-item>` 框架
- 顶部成员指示器 `[ 全部 | 自己 | 成员A | ... ]`（仅 multi 模式渲染）
- swiper-item 内重复渲染**同一份「全部」数据**（R1 不做按成员拉取）
- 顶部指示器与 swiper 当前 index 联动
- 多人账本时启用 swiper · 单人账本时隐藏（不影响月度视角主体）
- 单元测试：仅 1 个 swiper-item 时无侧滑（避免空滑动）

**预留扩展点**（在代码注释中明确）：
```typescript
// TODO(P1 · 后续卡): 成员维度数据按需拉取
// 1. memberTabs 由 multi 模式下成员列表生成
// 2. _memberDataMap: Map<userId, MonthlyStatistics> 按需加载
// 3. swiper change 时触发 _loadMemberData(userId)
```

**预估**：1 点

---

## 6. 工程纪律对齐

| 项 | 对齐说明 |
|----|---------|
| Conventional Commits | 单卡即提交 · 每张卡 commit subject 全小写 · footer `Refs: COSTRA-xxx` 大写 |
| 分支策略 | 直接在 `dev` 分支推进（与近期范式一致） |
| 金额 ADR-0002 | 全程 cents（integer）· 前端展示用 `utils/money.ts toYuan` 转换 |
| 主体红线 D-008 | 不涉及 |
| OpenAPI x-deferred | 无，不允许 stub 501 |
| pg-mem DDL 双写 | 0014 索引必须在 setup.ts 同步加 · partial 由 setup.ts 评估是否兼容 |
| Asia/Shanghai 时区 | 所有月/日聚合都用 `AT TIME ZONE 'Asia/Shanghai'` 转换；与 `familySummaryService` 保持一致 |

---

## 7. 风险与不确定项

| 风险 | 等级 | 缓解 |
|------|------|------|
| pg-mem 不支持 `EXTRACT(DAY FROM occurred_at AT TIME ZONE ...)` | 中 | 测试用例落地时优先用 PG 标准 SQL；pg-mem 兼容层在 setup.ts 适配（已有先例：to_char/setval） |
| SVG 折线图在大量数据点下字符串膨胀 | 低 | 折线使用最简 Bezier · 不做动画 · 数据点 ≤ 31，data URI ≤ 2KB |
| L2/L3 内存缓存随页面 lifetime 增长 | 低 | LRU 限制 50 条目 · SYNC_DONE 触发清空 |
| 后端时区转换跨时区时段重叠（如月初 8 点 UTC = 月初 16 点 Shanghai） | 中 | 用 `range_start_utc / range_end_utc` 显式表达 · 单测 T8 验证年度边界 |
| 前端 Map 在 setData 中无法序列化 | 高 | `_l2Cache` / `_l3Cache` 不放 data，仅作内部状态；展开数据通过 setData 注入 |

---

## 8. 验收标准（Human 实测路径）

### 8.1 月度视角

1. 切到 Tab2 · 看到当月数据正确（数字 / 折线 / 摘要 / 排行）
2. 点击 [<] 切到上月 · 数据刷新且不闪烁
3. 点击月份 picker · 滚到 2026-03 · 数据正确
4. 点击「餐饮」分类 → 展开二级（外卖、堂食...）
5. 点击「外卖」二级分类 → 展开三级单笔列表（含金额、备注、日期、记账人头像）
6. 再次点击「餐饮」→ 收起所有

### 8.2 年度视角

1. 点击「年度」胶囊 · 切到年度视角
2. 折线图变 12 个月趋势
3. 摘要 4 格变年度版（月均 / 年度最大单笔 / 单月最高 / 全年最贵分类）
4. 月度流水区显示 12 行
5. 点击「3 月」→ 自动切回月度视角并定位到 2026-03

### 8.3 同步联动

1. 月度视角下记一笔 · TabBar 关闭后回到统计页 · 数字自动刷新（SYNC_DONE）
2. 切到家庭页改某条 entry · 回到统计页 · 数据已更新

### 8.4 多人账本

1. swiper 顶部显示 `[ 全部 | 史蒂夫 | 爱丽丝 ]`
2. 左右滑动 · index 改变（数据先不变 · COSTRA-229 仅做框架）

### 8.5 边界

1. 空月份 · 显示「本月暂无收支记录」（不报错）
2. 跨年（2025-12 → 2026-01）切换 · 数据正确
3. 已退出成员的 expense 仍计入家庭聚合
4. transfer 类型不计入

---

## 9. 实施顺序建议

```
Day 1:  COSTRA-224（后端 5 点）          ← 解锁前端开发
Day 2:  COSTRA-230（折线图 2 点）        ← COSTRA-225 依赖
Day 3:  COSTRA-225（月度视角 5 点）      ← 主线 P0
Day 4:  COSTRA-226（年度视角 3 点）      ← 收尾
Day 5:  COSTRA-229（swiper 框架 1 点）   ← 扫尾 + 联调
```

每张卡按 dispatch → card-review → 实装 → review-tech → Human 验收的标准流程走。

---

> **设计签收**：等 Human 评审本文档后，即开始 COSTRA-224 派单。
