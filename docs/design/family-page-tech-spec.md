# 协作页（Tab4）重构技术设计

> **卡号族**：COSTRA-300（重构主线）+ 配套后端 / OpenAPI / 前端组件卡（具体编号由 Orchestrator 立卡时分配）
> **文档版本**：v1.0
> **创建时间**：2026-06-07
> **作者**：Orchestrator
> **设计源**：用户需求 2026-06-07 + 现有 `pages/statistics/` 排行区交互范式
> **范围**：`pages/family/` 下钻列表整块替换为「统计页同款手风琴」+ 后端 family summary L1 聚合化 + 年度视角实装

---

## 1. 需求总览

### 1.1 重构目标

将协作页（`pages/family/index`）的「下方下钻列表」整体重构为与统计页（`pages/statistics/`）排行区**风格、样式、交互完全一致**的手风琴下钻列表，同时保留协作页自身的成员/段占比/垫付贡献等差异化信息。

### 1.2 保留项（与现状一致）

- 顶部导航栏（居中账本名 ▼ · `onTapFamilyName` 切换账本）
- 成员头像区（`.avatar-row` + 邀请按钮）
- Solo 模式整体区块（个人摘要 + Solo CTA + 创建协作账本按钮）
- 创建协作账本 / 重命名 / 邀请遮罩 / 成员管理 ActionSheet 等弹窗系
- 时间导航条（`[<] 月份 ▼ [>]` + `[月度 / 年度]` 维度切换）— **本次年度从「即将上线」toast 升级为真正可用**
- **Segmented Bar 分段占比条 + 图例**（公共绿 / 各成员莫兰迪色）

### 1.3 重构项

- 删除现有的 `.detail-list / .detail-row` 整块（含 header / contributions / accordion / categories）
- 重写为统计页排行区同款 `.rank` 列表 + L1 手风琴下钻
- 列表行结构对齐 `segments` 数组顺序（公共支出 → 各成员个人支出，已退出成员仍保留）
- 公共支出行下方常驻一行小字「X 付 ¥A · Y 付 ¥B」（垫付贡献，q4 决策 A）

### 1.4 展开后差异化

| 行类型 | 行下方常驻 | 展开内容 | 进一步交互 |
|--------|-----------|---------|-----------|
| **公共支出** | 「X 付 ¥A · Y 付 ¥B …」 | **L1 一级分类排行** | **不再下钻**，L1 即终点 |
| **某成员个人支出** | 无 | **L1 一级分类排行** | 点击 L1 某条 → `wx.switchTab` 到统计页 + 切到该成员视角 + 当前月/年 + 自动展开该 L1（q3 决策 A） |

### 1.5 一致性约束

| 项 | 与统计页对齐 |
|----|-------------|
| L1 行视觉 | `.rank__row / .rank__row-main / .rank__icon / .rank__name / .rank__amount / .rank__bar / .rank__bar-fill` |
| 长列表省略 | 超过 6 条折叠为「还有 X 项较小支出未显示...」（`L1_VISIBLE = 6`） |
| 展开/收起手风琴 | 同时仅一行可展开（新展开自动收起旧的） |
| 等宽数字 | `tnum` class |
| 占比基数 | 公共行 L1：`shared.expense`；成员行 L1：该成员 `personal_expense` |

### 1.6 不做范围

- 协作页**不做 L2 二级 / L3 单笔下钻**：用户支出 L1 点击直接 switchTab；公共支出 L1 点击不响应。
- 协作页年度视角**不做 12 月折线 / 月流水简表**（统计页年度专属）。
- Solo 模式不动，仅 Multi 模式重构。

---

## 2. 信息架构与组件分解

### 2.1 重构后页面结构（multi 模式）

> **后续调整（COSTRA-308 · 段头信息条 + 透明分组）**：
> · 每个维度（支出/收入）用 `.family__card` 容器包裹「段头信息条 + segment-bar + 下钻列表」三位一体。
> · 容器内顶部 `.family__card-header` 显示「维度名 + 总额」（如 `支出 ¥3,417.55`），文字与金额组合成信息单元，不再凭空悬空。
> · 分组靠"段头信息条的视觉锚点 + 跨组 40rpx 留白"自然区分，不需要显式分隔线/色块/卡片边界。
> · 历史 COSTRA-306/307 的 segment-bar__label、family__section-divider 均已删除。
>
> **历史路径**：
> · COSTRA-306：segment-bar 从 sticky header 下移到 content 区，按维度编组。
> · COSTRA-307：加文字标题 + 纯留白分隔（已废弃——文字标题"凭空悬"仍显生硬）。
> · COSTRA-308 一版：A+B 方案——白底卡片 + 段头信息条（已废弃——白底 #FFFFFF 在 #f1f2ec 浅米背景上过于突兀，破坏莫兰迪基调）。
> · COSTRA-308 修正：去掉卡片白底/圆角/padding，容器退化为透明分组，只保留段头信息条 + 跨组大留白。

```
pages/family/index (multi 模式)
├─ Sticky Header
│  ├─ Avatar Row（不动）
│  └─ Time Nav（月份 / 月度·年度，年度可用化）
│
└─ Content Scroll
   ├─ ★ 支出卡片 .family__card（COSTRA-308 · 仅 segments.length > 0 时渲染）
   │  ├─ .family__card-header：支出 ¥3,417.55    ← 段头信息条
   │  ├─ Segmented Bar（公共绿 / 各成员色）
   │  └─ Drilldown List
   │      ├─ Row "公共支出"
   │      │   ├─ 行主体：[公标 / 名称 / 金额 + 占比 bar]
   │      │   ├─ 行下常驻：「张三 付 ¥120 · 李四 付 ¥80」(.shared-contributions)
   │      │   └─ Accordion 展开（L1 列表 · 不再下钻）
   │      │       ├─ rank__row × ≤6
   │      │       └─ "还有 X 项较小支出未显示..."
   │      │
   │      └─ Row "张三的个人支出"
   │          ├─ 行主体：[mini 头像 / 名称 / 金额 + 占比 bar]
   │          └─ Accordion 展开（L1 列表 · 点击 L1 → switchTab）
   │              ├─ rank__row × ≤6
   │              └─ "还有 X 项较小支出未显示..."
   │
   ├─ 24rpx 卡片间距（.family__card + .family__card）
   │
   └─ ★ 收入卡片 .family__card（COSTRA-308 · 仅 incomeSegments.length > 0 时渲染）
      ├─ .family__card-header：收入 ¥253,537.17   ← 段头信息条
      ├─ Segmented Bar（仅成员色 · 无 shared 段）
      └─ Drilldown List（仅成员行 · 无 shared 行 · L3 无"公共"badge）
         └─ ... (与支出侧结构完全一致)
```

### 2.2 子模块拆分

| 子模块 | 文件 | 复用来源 | 复杂度 |
|--------|------|---------|--------|
| 段行 wxml/wxss | inline | 借鉴统计页 `.rank__row` + 现 `.detail-row` 公标/头像 | 中 |
| L1 子列表 | inline | 复用统计页 `.rank__row` 视觉 token | 低 |
| 垫付贡献小字行 | inline `.shared-contributions` | 改造现 `.contribution-item` | 低 |
| L1 跳转分发 | `pages/family/index.ts onTapL1` | 新增 | 低 |

> **不新建独立 Component**：协作页 L1 列表与统计页虽视觉一致，但数据流、点击动作、占比基数都不同。复用走 wxss class token 即可。

---

## 3. 后端设计

### 3.1 OpenAPI 契约调整（`server/api/openapi.yaml`）

#### 3.1.1 GET `/families/{family_id}/summary` query 扩展

```yaml
parameters:
  - name: month
    in: query
    required: false           # ← 由 required:true 改为可选
    schema: { type: string, pattern: '^\d{4}-\d{2}$' }
  - name: year                # ← 新增（q6 决策 A）
    in: query
    required: false
    schema: { type: string, pattern: '^\d{4}$' }
  - name: top_n
    in: query
    required: false
    schema: { type: integer, minimum: 1, maximum: 50, default: 6 }
```

**互斥规则**：`month` 与 `year` 必须**恰一个**，缺失或同时存在 → 400 `INVALID_ARGUMENT`（`details: { reason: 'month_year_xor' }`）。错误码沿用项目 `ErrorCode` 枚举（无 `INVALID_QUERY`）。

#### 3.1.2 响应 schema（`FamilySummary`）

```yaml
FamilySummary:
  properties:
    family_id, family_name, family_kind, ledger_id, ledger_name: <unchanged>
    timezone, range_start, range_end, currency: <unchanged>
    month: { type: string, nullable: true }   # ← 改可选
    year:  { type: string, nullable: true }   # ← 新增（月度调用时为 null）
    totals: <unchanged>
    members: <unchanged>
    segments: <unchanged>
    shared:
      properties:
        expense, paid_contributions: <unchanged>
        categories:           # ← 语义变更（q5 决策 A）
          description: |
            **L1 一级分类排行**：
            · category_id 直接是一级分类 id
            · parent_category_id / parent_category_name 在 L1 语义下置 null
            · 占比基数为 shared.expense
            · 按 amount 降序，金额 0 已过滤，最多 top_n 条
    personal_by_member: <内 categories 同样改 L1，占比基数为该成员 amount>
```

字段语义凭证：在 OpenAPI `description` 中显式写「**L1 一级分类排行**」+「占比基数」+「parent_* 在 L1 模式置 null」三句作为契约事实源。

### 3.2 业务规则（口径）

| 规则 | 说明 |
|------|------|
| **时区** | 固定 `Asia/Shanghai` |
| **月度区间** | `parseMonthRange('YYYY-MM')` 复用 |
| **年度区间** | 新增 `parseYearRange('YYYY')` → 当年 1/1 00:00:00+08:00 起，次年 1/1 00:00:00+08:00 止（半开区间） |
| **expense 口径** | `type='expense' AND shared_type IN ('shared','personal')`（未分类不计入） |
| **L1 聚合** | service 层将 leaf rows 按 `parent_id` 折叠；无 parent 的 leaf 即 L1；`category_id IS NULL` 不进排行 |
| **占比基数** | shared L1：`shared.expense`；personal L1：该成员 `personal_expense` |
| **零值排除** | 折叠后 `amount > 0` 过滤 |
| **left member** | 历史聚合保留 |
| **transfer** | 不计入 |

### 3.3 Service / Repo 改造点

#### 3.3.1 `familySummaryService.ts`

- `getFamilySummary(input)` 入参增加 `input.year?: string`，开头校验 month/year xor（违规抛 `AppError(ErrorCode.INVALID_ARGUMENT)`，HTTP 400）。
- 区间：if month → `parseMonthRange`；if year → `parseYearRange`。
- **L1 折叠逻辑**：新增纯函数 `foldToL1(rows, totalForRatio, topN)`：

```ts
function foldToL1(
  rows: summaryRepo.CategoryRankRow[],
  totalForRatio: number,
  topN: number,
): FamilyCategoryRankItem[] {
  const map = new Map<string, FamilyCategoryRankItem>();
  for (const r of rows) {
    const l1Id = r.parent_category_id ?? r.category_id;
    const l1Name = r.parent_category_name ?? r.category_name;
    if (!l1Id) continue;  // 未分类跳过
    const cur = map.get(l1Id) ?? {
      category_id: l1Id,
      category_name: l1Name,
      parent_category_id: null,
      parent_category_name: null,
      amount: 0, entry_count: 0, ratio_bps: 0,
    };
    cur.amount += r.amount;
    cur.entry_count += r.entry_count;
    map.set(l1Id, cur);
  }
  const list = [...map.values()]
    .filter(x => x.amount > 0)
    .sort((a, b) => (b.amount - a.amount)
      || a.category_name.localeCompare(b.category_name, 'zh-Hans-CN'));
  for (const it of list) it.ratio_bps = calcBps(it.amount, totalForRatio);
  return list.slice(0, topN);
}
```

- **关键约束**：现有 `getCategoryRanks(...)` 内部已对 leaf 截到 `topN`，折叠后会丢 L1（小 leaf 被截但本应汇入大 L1）。**修复**：repo 层提供「不截断」版本给 family summary 用。

#### 3.3.2 `familySummaryRepo.ts`

- 新增 `getCategoryRanksUntrimmed(ledgerId, range, sharedType, createdBy?)`—— 现 `getCategoryRanks` 去掉最后 `slice(0, topN)`、签名不带 topN。
- 新增 `getPersonalCategoryRanksByMemberUntrimmed(ledgerId, range)`—— 同理。
- 现有 `getCategoryRanks / getPersonalCategoryRanksByMember` **保留**（避免破坏调用方），新函数只供 family summary 使用。
- 单月 leaf 分类总数有限（设计上 ≤ 几十种），全量返回 SQL 已做 GROUP BY 聚合，无性能压力。

#### 3.3.3 时区与区间

- `parseYearRange(year: string)`：
  ```ts
  // year 已由 service 层校验 ^\d{4}$
  const y = Number(year);
  // Asia/Shanghai 整年 = UTC [年初-08:00, 次年初-08:00)
  const startUtc = new Date(Date.UTC(y, 0, 1, -8, 0, 0)).toISOString();
  const endUtc   = new Date(Date.UTC(y + 1, 0, 1, -8, 0, 0)).toISOString();
  return { rangeStartUtc: startUtc, rangeEndUtc: endUtc };
  ```
- 与 `parseMonthRange` 共享 helper（保留各自函数，避免参数 union 导致的歧义）。

### 3.4 性能预算

| 接口形态 | 单月 entries ≤ 5000 时 P95 | 单年 entries ≤ 60000 时 P95 |
|---------|---------------------------|----------------------------|
| `summary?month=...` | ≤ 500ms（与现状一致） | — |
| `summary?year=...` | — | ≤ 1.2s（同 SQL，只是区间扩 12 倍；leaf top_n 提升后 GROUP BY 行数仍可控） |

> 不新增索引（沿用现有 `entries(ledger_id, occurred_at)` + statistics-spec 0014 已建的 `entries(category_id)` / `categories(parent_id)`）。

### 3.5 后端文件改动

```
server/api/openapi.yaml                         （修改 · query xor + year + L1 语义）
server/src/services/familySummaryService.ts     （修改 · year 分支 + foldToL1）
server/src/repositories/familySummaryRepo.ts    （修改 · 新增 *Untrimmed 函数 · parseYearRange helper）
server/src/routes/families.ts                   （修改 · query 校验 month/year xor）
server/test/family.summary.test.ts              （修改 · 新增年度 + L1 折叠测试）
```

### 3.6 测试要点（vitest 增量）

| ID | 测试 |
|----|------|
| T-300-A1 | month 单独传 → L1 聚合正确（leaf "外卖"+"堂食" → L1 "餐饮"） |
| T-300-A2 | year 单独传 → 12 个月聚合 + L1 折叠 |
| T-300-A3 | month 与 year 同传 → 400 INVALID_ARGUMENT（details.reason='month_year_xor'） |
| T-300-A4 | 都不传 → 400 INVALID_ARGUMENT（同上） |
| T-300-A5 | leaf 排行截断不丢 L1：构造 10 个 leaf 都属同 L1，单 leaf 都很小但累加排第一 → 仍出现 |
| T-300-A6 | 未分类 expense 不进 categories（但计入 totals） |
| T-300-A7 | 占比基数：shared.categories 的 ratio_bps 以 shared.expense 为分母；personal_by_member[i].categories 的 ratio_bps 以该成员 amount 为分母 |
| T-300-A8 | 年度跨年：year=2026 不混入 2025-12 / 2027-01 |
| T-300-A9 | left member 的历史 personal expense 仍在年度聚合中 |
| T-300-A10 | 单成员 personal_expense=0 时其 categories 为空数组 |

---

## 4. 前端设计

### 4.1 文件结构（删/改/新增）

```
miniprogram/pages/family/
├─ index.ts          （重写 · 移除 detailRows，新增 yearly 分支 + L1 跳转）
├─ index.wxml        （重写 multi 模式 detail-list 块为 family-rank 块）
├─ index.wxss        （重写 family-rank 区域样式 · 复用统计页 .rank token）
└─ index.json        （不动）

miniprogram/services/familyApi.ts  （修改 · getFamilySummary 支持 month|year）

miniprogram/app.ts                  （修改 · globalData.pendingStatisticsAction 类型）
```

### 4.2 globalData 跨页传参（q8 决策 A）

```ts
// app.ts
globalData: {
  pendingFamilyAction?: 'create' | null;
  pendingStatisticsAction?: PendingStatisticsAction | null;  // 新增
}

interface PendingStatisticsAction {
  memberKey: string;        // 'all' 或 userId
  dimension: 'monthly' | 'yearly';
  month?: string;           // YYYY-MM (dimension=monthly)
  year?: string;            // YYYY    (dimension=yearly)
  expandL1Id?: string;      // 自动展开的一级分类 id（可空）
}
```

**消费时序**：
1. 协作页 `onTapL1`（成员行的 L1）：写入 `pendingStatisticsAction` → `wx.switchTab({ url: '/pages/statistics/index' })`
2. 统计页 `onShow`：bootstrap 完成后立即读取 `pendingStatisticsAction`，存在则：
   - `app.globalData.pendingStatisticsAction = null`（先清，避免重入）
   - 调用新方法 `_consumePendingAction(action)` → 切 dimension / 切 month or year / 切 memberTabIndex / setData expand L1

### 4.3 协作页 page state 改造

```ts
// pages/family/index.ts (改造后核心 data)
data: {
  // 不变：ready / nav / mode / familyId / familyName / familyKind / isOwner / canInvite
  //       members / familyList / segments / soloXxx / 各 overlay state

  // 时间维度
  currentMonth: getCurrentMonthValue(),
  currentYear: getCurrentYearValue(),  // 新增 'YYYY'
  monthDisplay: '',
  yearDisplay: '',                     // 新增 '2026年'
  dimension: 'monthly' as 'monthly' | 'yearly',

  // 摘要数据
  loading: true,
  isEmpty: false,

  // ★ 重写：detailRows → drilldownRows
  drilldownRows: [] as DrilldownRow[],

  // ★ 删除：expandedRow（单行展开态改放进 row 自身）
}

interface DrilldownRow {
  key: string;                  // 'shared' or 'member:{user_id}'
  type: 'shared' | 'personal';
  label: string;                // '公共支出' or `${nickname}的个人支出`
  amount: string;               // '¥1,234.56'
  amountCents: number;
  ratio_bps: number;            // 来自 segments.ratio_bps
  color: string;                // 行级 bar 颜色（公共绿 / 成员色）
  // 公共行专有：垫付贡献小字
  contributions: { nickname: string; avatar_url: string; amount: string }[];
  // 个人行专有：mini 头像
  avatarUrl: string;            // type='personal' 才有
  userId: string;               // type='personal' 才有，用于 L1 跳转
  memberStatus: 'active' | 'left' | null;
  // 展开态
  expanded: boolean;
  // L1 列表（直接来自后端 categories，已是 L1 聚合）
  l1Items: L1Display[];         // 已 slice(0, 6) 后
  l1HasMore: boolean;
  l1MoreCount: number;
}

interface L1Display {
  category_id: string;          // L1 id
  category_name: string;
  icon: string;                 // getCategoryIconById(category_id)
  amount: string;               // '¥xxx.xx'
  amountCents: number;
  ratio_bps: number;            // 来自后端 ratio_bps
}
```

### 4.4 数据加载流程

```ts
async _loadSummary(familyId: string) {
  // SWR：先取缓存渲染 → 网络拉新 → 重渲
  const scope = this.data.dimension === 'monthly'
    ? { month: this.data.currentMonth }
    : { year: this.data.currentYear };

  const cached = getCachedSummary(familyId, scope);
  if (cached) this._buildDisplay(cached);
  else this.setData({ loading: true });

  const fresh = await getFamilySummary(familyId, scope);
  this._buildDisplay(fresh);
}

_buildDisplay(s: FamilySummary) {
  if (s.family_kind === 'personal') return this._buildSoloDisplay(s);
  this._buildMultiDisplay(s);
}

_buildMultiDisplay(s: FamilySummary) {
  // 1. members + segments 不变（颜色/segment 计算同现状）
  // 2. drilldownRows：
  //    - 旧 expanded 状态保留（key match）
  //    - shared 行：从 s.shared 取 expense / paid_contributions / categories(L1)
  //    - 每个 member 行：从 s.personal_by_member[i] 取 amount / categories(L1)
  //    - L1Display: getCategoryIconById(c.category_id) → icon
  //    - slice(0, L1_VISIBLE=6) + hasMore/moreCount
  // 3. 复用现 segment color 逻辑（公共绿 / getMemberColorBySlot）
}
```

### 4.5 交互改造

| 交互 | 行为 | 备注 |
|------|------|------|
| 点击 row header | toggle row.expanded（同时仅一行展开，`onTapDrilldownRow` 内闭合其它行后再翻当前） | 与统计页 L1 一致 |
| 点击公共支出行 L1 子项 | **空操作**（不响应），可加 `pointer-events: none` 或不绑事件 | 公共支出 L1 不下钻 |
| 点击成员支出行 L1 子项 | 写 `pendingStatisticsAction` → `wx.switchTab` | q3+q8 决策 |
| 切月份 / 切年份 / 切维度 | 重置所有 row.expanded=false + 重拉 | 数据已变，旧展开态不延续 |
| 切账本 | 同上 + 清 cache | 现状一致 |
| SYNC_DONE / ENTRY_SAVED / ENTRY_UPDATED | invalidateFamilyCache + 重拉 + 保留旧 expanded（与现状一致） | row 内 L1 数据由后端重算 |

#### 4.5.1 onTapL1 实装

```ts
onTapL1(e: WechatMiniprogram.TouchEvent) {
  const { rowkey, l1id } = e.currentTarget.dataset as Record<string, string>;
  const row = this.data.drilldownRows.find(r => r.key === rowkey);
  if (!row || !l1id) return;

  // 公共支出行：不下钻
  if (row.type === 'shared') return;

  // 成员行：写 pendingStatisticsAction + switchTab
  const app = getApp<AppWithBootstrap>();
  app.globalData.pendingStatisticsAction = {
    memberKey: row.userId,
    dimension: this.data.dimension,
    month: this.data.dimension === 'monthly' ? this.data.currentMonth : undefined,
    year: this.data.dimension === 'yearly' ? this.data.currentYear : undefined,
    expandL1Id: l1id,
  };
  wx.switchTab({ url: '/pages/statistics/index' });
}
```

### 4.6 统计页消费 pendingStatisticsAction

在 `pages/statistics/index.ts` 的 `onShow` bootstrap 完成 + `_loadContext()` 完成后插入：

```ts
async _consumePendingAction() {
  const app = getApp<AppWithBootstrap>();
  const action = app.globalData.pendingStatisticsAction;
  if (!action) return;
  app.globalData.pendingStatisticsAction = null;

  // 1. 切维度
  if (action.dimension !== this.data.dimension) {
    await this._switchDimensionTo(action.dimension);  // 抽出现有 onSwitchDimension 主体
  }
  // 2. 切月/年
  if (action.dimension === 'monthly' && action.month && action.month !== this.data.currentMonth) {
    this.setData({ currentMonth: action.month, monthDisplay: formatMonthDisplay(action.month) });
  }
  if (action.dimension === 'yearly' && action.year && action.year !== this.data.currentYear) {
    this.setData({ currentYear: action.year, yearDisplay: formatYearDisplay(action.year) });
  }
  // 3. 切成员 tab
  const idx = this.data.memberTabs.findIndex(t => t.key === action.memberKey);
  if (idx >= 0 && idx !== this.data.memberTabIndex) {
    this.setData({ memberTabIndex: idx, currentMemberKey: action.memberKey, memberSwiperDuration: 0 });
  }
  // 4. 拉数据
  await this._loadData();
  // 5. 自动展开 L1（数据落到 byMember 后）
  if (action.expandL1Id) {
    await this._autoExpandL1(action.memberKey, action.expandL1Id);
  }
}

async _autoExpandL1(memberKey: string, l1Id: string) {
  // 模拟点击：复用 onTapL1 路径，但传入合成 dataset
  // 注意：onTapL1 内部需要兼容程序触发（不带 e 也能跑），可拆出 _handleL1Tap(memberKey, l1Id)
}
```

> **范围说明**：`_consumePendingAction` 触发 `_loadData` + `_autoExpandL1`，需要协调现有 `_initialized` / `_loadContext` 时序。建议放在统计页 `onShow` bootstrap 链 `await this._loadContext(); await this._loadData();` **之后**调用，确保 byMember 已落数据。具体落点见 §6 实施顺序。

### 4.7 wxml 重构骨架

```html
<!-- pages/family/index.wxml · 仅展示重构区域 -->
<!-- 替换原 .detail-list 整块（line 147~229） -->

<view class="family-rank" wx:if="{{drilldownRows.length > 0 && !loading}}">
  <view
    wx:for="{{drilldownRows}}"
    wx:key="key"
    class="family-rank__row {{item.expanded ? 'family-rank__row--open' : ''}}"
  >
    <!-- 行主体（与统计页 .rank__row 视觉一致 + 协作页头像/公标） -->
    <view
      class="family-rank__head"
      data-key="{{item.key}}"
      bind:tap="onTapDrilldownRow"
    >
      <view class="family-rank__head-main">
        <!-- 公共标 / mini 头像 -->
        <view wx:if="{{item.type === 'shared'}}" class="family-rank__shared-icon">
          <text>公</text>
        </view>
        <image
          wx:elif="{{item.avatarUrl}}"
          class="family-rank__avatar"
          src="{{item.avatarUrl}}"
          mode="aspectFill"
          lazy-load
        />
        <view wx:else class="family-rank__avatar family-rank__avatar--placeholder">
          <text>?</text>
        </view>

        <view class="family-rank__name">{{item.label}}</view>
        <view class="family-rank__amount tnum">{{item.amount}}</view>
      </view>
      <view class="family-rank__bar">
        <view
          class="family-rank__bar-fill"
          style="width: {{item.ratio_bps / 100}}%; background: {{item.color}};"
        ></view>
      </view>
    </view>

    <!-- 公共行：垫付贡献小字（行下常驻） -->
    <view
      class="shared-contributions"
      wx:if="{{item.type === 'shared' && item.contributions.length > 0}}"
    >
      <text
        wx:for="{{item.contributions}}"
        wx:for-item="c"
        wx:key="index"
        class="shared-contributions__item"
      >{{c.nickname}} 付 {{c.amount}}{{index < item.contributions.length - 1 ? ' · ' : ''}}</text>
    </view>

    <!-- L1 列表（展开时） · 严格对齐统计页 .rank 子样式 -->
    <view class="family-l1" wx:if="{{item.expanded}}">
      <view
        wx:for="{{item.l1Items}}"
        wx:for-item="l1"
        wx:key="category_id"
        class="family-l1__row"
        data-rowkey="{{item.key}}"
        data-l1id="{{l1.category_id}}"
        bind:tap="onTapL1"
      >
        <view class="family-l1__row-main">
          <view class="family-l1__icon">{{l1.icon}}</view>
          <view class="family-l1__name">{{l1.category_name}}</view>
          <view class="family-l1__amount tnum">{{l1.amount}}</view>
        </view>
        <view class="family-l1__bar">
          <view class="family-l1__bar-fill" style="width: {{l1.ratio_bps / 100}}%;"></view>
        </view>
      </view>
      <view class="family-l1__more" wx:if="{{item.l1HasMore}}">
        还有 {{item.l1MoreCount}} 项较小支出未显示...
      </view>
    </view>
  </view>
</view>
```

### 4.8 wxss 关键约定

- `.family-rank__row / .family-rank__head / .family-rank__bar / .family-rank__bar-fill / .family-rank__amount / .family-rank__name` —— 视觉 token **完全镜像统计页 `.rank__*`**（padding / font-size / 分隔线 / bar 高度）。
- `.family-l1__row / .family-l1__bar / .family-l1__bar-fill / .family-l1__icon / .family-l1__name / .family-l1__amount / .family-l1__more` —— 视觉镜像统计页 `.rank__row` 同级（不复用统计页 `.l2`，因为协作页 L1 不是嵌套二级而是首层下钻）。
- `.shared-contributions` —— 行级小字一行，`font-size: 22rpx; color: rgba(28,27,26,0.5)`，超出省略。
- `.family-rank__shared-icon` / `.family-rank__avatar` —— 沿用现 `.detail-row__shared-icon` / `.detail-row__avatar` 视觉，移到新前缀名下。

> **实操**：直接在 `index.wxss` 删除 `.detail-row*` / `.contribution-item*` / `.category-item*` 整块，新增 `.family-rank*` / `.family-l1*` / `.shared-contributions*` 整块。**不复用统计页 wxss 跨页加载**（小程序 wxss 作用域无法跨页）。

### 4.9 服务层（`services/familyApi.ts`）改动

```ts
// 1. getFamilySummary 签名扩展
export async function getFamilySummary(
  familyId: string,
  scope: { month?: string; year?: string },
  opts?: { topN?: number },
): Promise<FamilySummary>;

// 2. 缓存 key 改造
function summaryCacheKey(familyId: string, scope: { month?: string; year?: string }): string {
  return scope.month
    ? `${familyId}:m:${scope.month}`
    : `${familyId}:y:${scope.year}`;
}

// 3. getCachedSummary 签名同步扩展
export function getCachedSummary(
  familyId: string,
  scope: { month?: string; year?: string },
): FamilySummary | null;

// 4. invalidateFamilyCache 不变（按 familyId: 前缀清）
```

### 4.10 SYNC_DONE 失效策略

与现状一致：
- `invalidateFamilyCache(familyId)` 清同 family 全部 month/year cache
- 重拉当前 dimension 对应 scope
- 保留 `drilldownRows[i].expanded`（key 匹配复用）

---

## 5. 卡片拆分

### 5.1 Card 概览

| Card | 标题 | Owner | 估点 | 依赖 | 必需性 |
|------|------|-------|------|------|--------|
| **COSTRA-300** | 后端 family summary L1 化 + year 支持 | backend-dev | 4 | — | P0 |
| **COSTRA-301** | OpenAPI + familyApi.ts 契约同步 | backend-dev / miniapp-dev | 1 | 300 | P0 |
| **COSTRA-302** | 协作页 multi 模式重构（含年度切换可用 + L1 列表 + 展开/收起 + 公共行不下钻 + 成员行 switchTab） | miniapp-dev | 5 | 300, 301 | P0 |
| **COSTRA-303** | 统计页消费 pendingStatisticsAction（自动切成员/月-年/展开 L1） | miniapp-dev | 2 | 302 | P0 |
| **COSTRA-304** | 联调验收 + 回归（Solo / Multi / SYNC_DONE / 切账本 / 切月-年） | miniapp-dev | 1 | 全部 | P0 |

**总估点**：13 点

### 5.2 Card 详细 DoD

#### COSTRA-300 · 后端 family summary L1 化 + year 支持

**Scope**：
- A. `parseYearRange` helper（`familySummaryService.ts` 内私有 + 单测覆盖）
- B. service `getFamilySummary` 入参增加 `year?: string`，xor 校验
- C. repo 新增 `getCategoryRanksUntrimmed` / `getPersonalCategoryRanksByMemberUntrimmed`
- D. service 新增 `foldToL1(rows, totalForRatio, topN)` 纯函数
- E. service 替换 `sharedCategoryItems` 与 `personalCategoryItems` 构造逻辑为「fetch untrimmed → foldToL1」
- F. test：T-300-A1 ~ A10 全部新增到 `family.summary.test.ts`
- G. setup.ts pg-mem DDL 双写无新增（不动 schema）

**闸门**：
- typecheck 0 error · vitest 148+ 全绿
- whitelist-check 通过（OpenAPI 与路由对齐 · 见 301）

**预估**：4 点

#### COSTRA-301 · OpenAPI 契约同步 + 前端类型同步

**Scope**：
- A. `server/api/openapi.yaml` 改 `month` required:false + 加 `year` query + xor description + L1 语义说明
- B. `miniprogram/services/familyApi.ts`：
  - `getFamilySummary` 签名扩展为 `scope: { month?, year? }`
  - 缓存 key 改造（month/year 区分前缀）
  - `getCachedSummary` 签名同步
- C. types 字段：`FamilySummary.month` 改 `string | null`，新增 `year: string | null`

**DoD**：
- 后端 401/403/400 与现一致；新增 400 INVALID_ARGUMENT (month_year_xor)
- 前端 typecheck 0 error
- familyApi 单测（如有）跟进

**预估**：1 点

#### COSTRA-302 · 协作页 multi 模式重构

**Scope**：
- A. `pages/family/index.wxml`：删除原 `.detail-list` / `.segment-bar` 之后的 detail-list 块；新增 `.family-rank` 块
- B. `pages/family/index.wxss`：删除 `.detail-row*` / `.contribution-item*` / `.category-item*` 整块；新增 `.family-rank*` / `.family-l1*` / `.shared-contributions*`
- C. `pages/family/index.ts`：
  - data：删除 `detailRows / expandedRow`，新增 `drilldownRows / currentYear / yearDisplay`
  - 新增 `_buildDrilldownRows(summary)` 构建逻辑（含旧 expanded 保留）
  - `_buildMultiDisplay` 改造调用 `_buildDrilldownRows`
  - `onTapDrilldownRow` 实现「同时仅一行展开」（点哪行 toggle 哪行，其它强制 collapse）
  - `onTapL1` 实现：公共行 no-op；成员行写 globalData + switchTab
  - `onSwitchDimension` 实现「年度切换可用」（不再 toast 拦截）
  - `_loadSummary` 改造按 dimension 取 month/year scope
  - `onYearChange / onPrevYear / onNextYear` 新增（与 onMonthChange 镜像）
  - month/year 切换时同步 expanded 全部 reset
- D. wxml/wxss 视觉 token **严格对齐**统计页排行区（用真机 + 开发者工具同框对照截图）

**DoD**：
- Multi 模式月度可用（数据正确 / 切月可用 / 切账本可用 / SYNC_DONE 即时刷新 / 邀请/创建/重命名/退出无回归）
- Multi 模式年度可用（接口正确调用 year=YYYY；数据正确；切年可用）
- Solo 模式无回归（个人摘要 + Solo CTA 不变）
- 公共行 L1 点击 no-op；成员行 L1 点击触发 switchTab（pendingStatisticsAction 写入正确）
- typecheck + lint + 现有 vitest 全绿
- 真机 + 开发者工具冒烟通过

**预估**：5 点

#### COSTRA-303 · 统计页消费 pendingStatisticsAction

**Scope**：
- A. `app.ts globalData` 类型新增 `pendingStatisticsAction?: PendingStatisticsAction | null`
- B. `pages/statistics/index.ts onShow` bootstrap 完成 + `_loadContext()` + `_loadData()` 之后 await `_consumePendingAction()`
- C. `_consumePendingAction()` 实现：切 dimension → 切 month/year → 切 memberTabIndex → 重拉 → 自动展开 L1
- D. `_autoExpandL1(memberKey, l1Id)`：复用 onTapL1 主体逻辑（抽出 `_handleL1Tap(memberKey, l1Id)` 程序触发版本，避免依赖 e）

**DoD**：
- 协作页成员行 L1 点击 → switchTab 后统计页正确切到目标成员 + 月/年 + L1 自动展开（含 L2 加载）
- 统计页常规进入（无 pendingStatisticsAction）行为不变
- 重复进入协作页（不点 L1）→ 切回统计页不应再消费旧 action（消费一次即清）

**预估**：2 点

#### COSTRA-304 · 联调验收 + 回归

**Scope**：完整路径冒烟（见 §7 验收）+ tech-review。

**预估**：1 点

#### COSTRA-306 · 协作页多维度编组（支出/收入 bar ↔ 下钻）

**背景**：原 SPEC 把支出/收入两个 Segmented Bar 放在 Sticky Header，下钻列表在滚动区。
视觉上眼睛要在 fixed 区域和 scroll 区域往返跳，体感割裂；用户反馈希望按维度编组。

**Scope**：
- A. `pages/family/index.wxml`：删除 Sticky Header 里的支出/收入两段 `segment-bar`；
       在 Content Scroll 内按维度编组：支出组 = bar + `drilldownRows`，收入组 = bar + `incomeDrilldownRows`；
       中间仅在两个维度都非空时插入 `.family__section-divider`。
- B. `pages/family/index.wxss`：删除 `.segment-bar--income { margin-top: 8rpx }`（不再两 bar 上下堆叠，规则失效）。
- C. `pages/family/index.ts`：不变。`segments` / `incomeSegments` / `drilldownRows` / `incomeDrilldownRows` 字段不动；
       `_buildMultiDisplay` 不变；空态判定 `isEmpty = totalExpense == 0 && totals.income == 0` 不变。

**DoD**：
- 协作页月度/年度任一打开：支出 bar 紧贴公共行 / 各成员行；收入 bar（同此存在时）紧贴对应收入下钻；bar 与 list 一一对应，不会出现 bar 有但 list 空、或 list 有但 bar 缺失。
- 仅支出有数据：收入组整体不渲染；仅收入有数据：支出组整体不渲染；两者都有：渲染两组 + 中间分隔线。
- 切月/切年/切账本/SYNC_DONE 联动：编组内展开态、空态、shared 行、L3 流水明细 行为全部不变。
- Solo 模式：不受影响（fixed header 内原本就没有 bar）。

**预估**：0.5 点

#### COSTRA-307 · 维度标题 + 分组标记差异化（最终采用"标题 + 纯留白"）

**背景**：
- 用户反馈："中间那条淡淡的分界线和下钻列表里的分割线太相似，没有区分度"
- 用户反馈："很难立刻感知到下面的那条线段是支出的 segment-bar"——即用户看到下面那条蓝色 segment 时不会马上意识到"这一坨是支出"，需要依靠其后出现的"公共支出 ¥xxx"行下文字回推。
- 一版尝试（已废弃）：维度小标题（26rpx · weight 600 · 0.7 alpha）+ 居中 80rpx×4rpx brand 绿圆角色块。用户反馈：①小标题字号偏小、与"组标题"分量不匹配，看起来生硬；②分隔色块用 brand 绿 `#6B9B8F` 与公共段 segment 同色，会被误读为"另一公共段"，污染成员色语义；③居中短色块形态在项目里没有先例。

**Scope（最终方案）**：
- A. `pages/family/index.wxml`：
       · 在支出/收入两个 segment-bar 内 `segment-bar__track` 之前插入 `<text class="segment-bar__label">支出|收入</text>`。
       · `.family__section-divider` 由"外层 view + 内嵌 dash 色块"恢复为单层 view（无内嵌元素）。
- B. `pages/family/index.wxss`：
       · `.segment-bar__label`：font-size 28rpx · weight 600 · 主文本色 `#1c1b1a`（无 alpha）· margin-bottom 16rpx。
         **对齐统计页 `.rank__title`**（statistics/index.wxss:430）同款字号字重——项目已有"段标题"范式，统一以避免视觉断层；不再用 26rpx/0.7 alpha 那种偏弱化的"小标题"风格。
       · `.family__section-divider`：纯留白 `height: 32rpx`，无背景无色块。**对齐统计页 `.rank + .rank { padding-top: 32rpx }`**（statistics/index.wxss:426）同款"纯 padding 分段"范式——分段靠留白 + 各组上方 segment-bar__label 标题共同承担，不需要显式分隔元素，也不引入新形态。

**DoD**：
- 进入协作页月度/年度：支出组上方有清晰"支出"标题（与统计页段标题视觉等价）；收入组同理。
- 跨组之间是 32rpx 纯留白，靠两组各自的段标题 + segment-bar 自身的视觉重量自然分段；无任何色块/线条分隔元素，不污染成员色语义。
- 单维度数据时（只有支出/只有收入）：那一组标题与 list 正常显示；分隔元素不渲染（条件 `segments.length > 0 && incomeSegments.length > 0` 未达成）。
- 切月/切年/切账本/SYNC_DONE：标题始终与对应 segment-bar 同步显示/隐藏。
- typecheck / lint 全部通过。

**预估**：0.5 点

#### COSTRA-308 · 段头信息条 + 透明分组（A 方案 · B 卡片化已废弃）

**背景**：
- COSTRA-307 的"文字标题 + 纯留白"方案用户反馈仍显生硬——文字标题"凭空悬"在 segment-bar 上方，没有视觉关联。
- 用户要求评估新方案，最终选择 A+B 组合：① 卡片化（结构性分组）② 段头信息条（信息单元取代悬空标签）。
- A+B 一版实施后用户反馈"白底卡片过于突兀，不够自然"——白底 `#FFFFFF` 在 `#f1f2ec` 浅米背景上对比太强，破坏项目温润的莫兰迪基调。
- 修正：去掉卡片白底/圆角/padding，容器退化为透明分组，只保留段头信息条 + 跨组大留白。

**Scope（最终方案）**：
- A. `pages/family/index.ts`：
       · data 新增 `totalExpenseDisplay` / `totalIncomeDisplay`（格式化后的总额字符串）。
       · `_buildMultiDisplay` 里 `setData` 加这两个字段（复用 `formatCentsDisplay`）。
- B. `pages/family/index.wxml`：
       · 支出/收入各自用 `<view class="family__card">` 包裹（从 `<block wx:if>` 改为 `<view class="family__card" wx:if>`）。
       · 容器内 `segment-bar` 之前插入 `<view class="family__card-header">`：维度名 + 总额。
       · 删除 `<text class="segment-bar__label">` （被 card-header 取代）。
       · 删除 `.family__section-divider` 整段（跨组留白取代）。
- C. `pages/family/index.wxss`：
       · `.family__card`：透明容器（无 background / border-radius / padding），margin-top 16rpx。
       · `.family__card + .family__card { margin-top: 40rpx }`（跨组大留白）。
       · `.family__card-header` / `-name` / `-amount`：26rpx · baseline 对齐 · 维度名 weight 600 @ 0.7 alpha · 金额 weight 400 @ 0.5 alpha。
       · 删除 `.segment-bar__label`（被 card-header 取代）。
       · 删除 `.family__section-divider`（跨组留白取代）。
       · `.segment-bar margin-bottom`：12rpx。
       · `.family-rank padding`：`0 0 8rpx`（容器无 padding，自行维持底部安全距离）。

**DoD**：
- 协作页月度/年度：支出维度有段头信息条「支出 ¥3,417.55」紧贴 segment-bar + 下钻列表；收入维度同理。
- 两组之间是 40rpx 纯留白（无白底、无分隔线、无色块），靠段头信息条的视觉锚点 + 大留白自然区分。
- 仅支出有数据：只有支出组；仅收入有数据：只有收入组；两者都有：两组 + 40rpx 留白。
- 切月/切年/切账本/SYNC_DONE：展开态、空态、shared 行、L3 流水明细 行为全部不变。
- Solo 模式：不受影响。
- typecheck / lint 全部通过。

**预估**：0.5 点

---

## 6. 实施顺序

```
Day 1:  COSTRA-300（后端 4 点）          ← 解锁前端
Day 2:  COSTRA-301（契约 1 点）          ← 解锁前端 typecheck
Day 3:  COSTRA-302（协作页重构 5 点）    ← 主线
Day 4:  COSTRA-303（统计页消费 2 点）    ← 收尾
Day 5:  COSTRA-304（联调 1 点）          ← 验收
```

**单卡即提交**（Conventional Commits + `Refs: COSTRA-xxx`），分支沿用 `dev`。

---

## 7. 验收标准（Human 实测路径）

### 7.1 月度（Multi 模式）

1. 切到 Tab4 · 多人账本 · 看到 segments 分段条与下钻列表视觉衔接成组（COSTRA-306：bar 紧贴对应下钻，bar 与 list 中间不再隔着 fixed-header 边界）；各成员色正确
2. 看到 drilldown 列表：第一行公共支出，下方常驻「张三 付 ¥A · 李四 付 ¥B」，金额与 segments 公共段一致
3. 点击公共支出行 → 展开 L1 一级分类排行（如「餐饮 ¥xxx」「购物 ¥xxx」），样式与统计页 L1 行一致（占比 bar / 图标 / 金额 / 排序）
4. 点击「餐饮」L1 → **无响应**（公共行 L1 不下钻）
5. 点击成员张三的行 → 公共行收起（同时仅一行展开），张三行展开 L1
6. 点击张三 L1 「餐饮」→ 跳转 Tab2（统计页）→ 月度维度 + 当月 + 张三 swiper pane + 餐饮 L1 已自动展开（L2 加载中或就绪）
7. 切月 → 协作页所有展开重置，数据刷新
8. 切账本 → 协作页所有展开重置，数据刷新

### 7.2 年度（Multi 模式）

1. 点击「年度」胶囊 → 不再弹「即将上线」toast
2. 时间导航条变为 `[<] 2026年 [>]`，picker 改为 year mode
3. drilldown 列表：segments 与 L1 都按全年聚合
4. 点击成员李四 L1「交通」→ 跳转 Tab2 → **年度维度** + 2026 + 李四 swiper pane + 交通 L1 自动展开
5. 切年（2025/2026）→ 数据正确（不混入相邻年）
6. 切回月度 → 月份记忆为最近选过的（不强制重置成当月，与现状一致）

### 7.3 Solo 模式

- 完全不变（个人摘要 + Solo CTA + 创建按钮）

### 7.4 SYNC_DONE 联动

- 协作页（任一 row 已展开）记一笔后 → 行内 L1 数据刷新，**展开态保留**

### 7.5 边界

- 公共支出 = 0 时：drilldownRows 第一行不出现（与现状一致）
- 某成员 personal_expense = 0 时：该成员 row 不出现
- left member 历史 expense > 0：row 仍展示，色灰化（与 Avatar Row 一致）
- 切到一个全月无 entry 的月份：drilldownRows 为空 + isEmpty 文案「本月暂无收支记录」

---

## 8. 风险与不确定项

| 风险 | 等级 | 缓解 |
|------|------|------|
| L1 折叠在 leaf top_n 截断后失真 | 高 | 用 `*Untrimmed` repo 函数全量返回 → service 折叠后再 top_n |
| 年度区间跨夏令时？ | 低 | Asia/Shanghai 无 DST，半开区间明确 |
| pendingStatisticsAction 在多次 wx.switchTab 间漏消费 | 中 | 统计页 onShow 即消费即清空；协作页写入前先清空一次（防残留） |
| 协作页年度数据量大（一年 entries 60k+）查询慢 | 中 | 沿用现有 `entries(ledger_id, occurred_at)` 索引；P95 ≤ 1.2s 可接受；超出立卡再优化 |
| Map 在 setData 中无法序列化 | N/A | drilldownRows 全部用普通 array/object，不放 Map |
| 旧 detail-row 测试用例失效 | 低 | family 页 e2e 没有写 detail-row 单测；UI 类回归靠真机冒烟 |

---

## 9. 工程纪律对齐

| 项 | 说明 |
|----|------|
| Conventional Commits | 单卡即提交，footer `Refs: COSTRA-xxx` 大写 |
| 分支 | 直接 `dev` |
| 金额 ADR-0002 | 全程 cents，前端 `toYuan` 转换 |
| 协作页成员配色 | 复用 `utils/memberColor.ts MEMBER_COLOR_SLOTS` + `getMemberColorBySlot` |
| pg-mem DDL 双写 | 无 schema 改动，setup.ts 不动 |
| OpenAPI x-deferred | 无，不允许 stub 501 |
| Asia/Shanghai 时区 | 月/年聚合统一 |
| `<expense-overlay />` 挂载 | 协作页 wxml 末尾保留（已有）|
| 不写硬逻辑 | foldToL1 是结构化抽象，不是 if-else 拼凑 |

---

> **设计签收**：等 Human 评审本文档后，即开始 COSTRA-300 派单。
