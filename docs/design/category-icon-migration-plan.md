# 分类图标资源替换 · 落地方案（评审稿）

> 目标：把小程序当前「分类图标 = 单个汉字文本」替换为新设计的一套线性矢量图标（L1 14 个 + L2 67 个 = 81 个唯一字形），走 iconfont（base64 TTF）渲染。
>
> 本文是可评审的**逐文件落地拆解 + migration 草案**，尚未实现。

---

## 0. 已锁定决策

| # | 决策 | 结论 |
|---|---|---|
| 1 | 关联机制 | 语义 `icon_key`（分类持有 key，端侧 `key → 字形` 解析） |
| 2 | DB 字段 | **复用 `icon` 列**，语义从「单字」改为「icon_key」。接受线上旧版小程序更新前的过渡期显示异常 |
| 3 | 渲染方式 | iconfont：`@font-face` + base64 TTF，单色 `currentColor` 复用现有 `.is-selected` 换色 |
| 4 | 二级复用 | 沿用 `icons-l2.mjs` 去重原则：同名/与父同名的二级复用已有字形（多个分类节点 → 同一 icon_key） |
| 5 | 图标源单一化 | L1（现内联在评审 HTML）+ L2（`icons-l2.mjs`）合并为唯一权威源模块，评审页/预览/构建均从它读 |

---

## 1. 目标架构与数据流

```
【唯一图标源】scripts/icon-font/icons.mjs         【码点注册表】scripts/icon-font/icon-registry.json
   { iconKey: { label, svg } }  × 81                 { iconKey: "e0xx" }  稳定不漂移
                    │                                          │
                    └──────────────┬───────────────────────────┘
                                   ▼  build.mjs（扩展：纳入 L2 + 读注册表分配码点）
        ┌──────────────────────────┼──────────────────────────────┐
        ▼                          ▼                               ▼
  iconfont.ttf            miniprogram/styles/iconfont.wxss    miniprogram/services/iconMap.ts
  (dist 自检)             (@font-face base64 + .costra-icon)   (ICON_GLYPH: key→PUA字符 + resolve)
                                   │                               │
【分类权威源】design/categories.yaml（每节点补 icon_key）          │
        │ 同步                                                     │
        ▼                                                          │
  server seed / migration 0007（icon 列写 icon_key）               │
        │  API 返回 icon = icon_key                                │
        ▼                                                          ▼
  miniprogram categoryService：icon_key ──resolveIconGlyph──> PUA 字符（视图模型）
        ▼
  各 wxml 圆形容器渲染字形字符，wxss 加 font-family: 'costra-icons'
  （选中态沿用 .is-selected 换 color，零改动）
```

**核心原则**：`CategoryItem.icon` 存 **icon_key**（进同步签名）；渲染用的 **字形字符**只在视图模型（树/排行/明细）里由 `resolveIconGlyph()` 派生，不进签名。二者分离，避免把 PUA 码点耦合进数据层。

---

## 2. 图标 key 注册表（81 个唯一字形）

命名规范：`lower_snake_case` 英文语义 token（对齐 openapi「Design Token 映射」定位）。码点从现有 `U+E000` 起、**只追加不重排**（L1 保持与现存 TTF 一致）。

### 2.1 一级（14，码点 E000–E00D，沿用现有）

| icon_key | 分类 | 码点 | icon_key | 分类 | 码点 |
|---|---|---|---|---|---|
| `dining` | 餐饮 | E000 | `other` | 其他 | E007 |
| `transport` | 交通 | E001 | `salary` | 职业收入 | E008 |
| `shopping` | 购物 | E002 | `investment` | 投资与资产 | E009 |
| `life` | 生活 | E003 | `windfall` | 意外收入 | E00A |
| `travel` | 旅行 | E004 | `stored_value` | 储值 | E00B |
| `entertainment` | 文娱 | E005 | `account_transfer` | 账户互转 | E00C |
| `transfer` | 转账 | E006 | `credit` | 赊销 | E00D |

### 2.2 二级（67，码点 E00E 起，按下表顺序固定）

| 组 | icon_key（新画字形） |
|---|---|
| 餐饮(12) | `breakfast` 早餐 · `lunch` 午餐 · `dinner` 晚餐 · `takeout` 外卖 · `groceries` 买菜 · `fruit` 水果 · `snack` 零食 · `drink` 饮料 · `alcohol` 酒水 · `condiment` 柴米油盐 · `gathering_meal` 聚餐 · `banquet` 宴请 |
| 交通(9) | `taxi` 打车 · `transit` 公交地铁 · `fuel` 加油 · `parking` 停车 · `train` 火车高铁 · `flight` 机票 · `car_maintenance` 汽车保养 · `insurance` 保险 · `toll` 过路费 |
| 购物(5) | `daily_goods` 日用 · `clothing` 服饰 · `digital` 数码 · `tissue` 纸巾 · `cosmetics` 护肤美妆 |
| 生活(10) | `pet` 宠物 · `beauty` 美容美发 · `water_bill` 水费 · `electricity_bill` 电费 · `gas_bill` 燃气费 · `telecom_bill` 话费网费 · `repair` 物业维修 · `medical` 医疗 · `baby` 母婴 · `rent` 租房 |
| 旅行(1) | `hotel` 酒店 |
| 文娱(7) | `subscription` 订阅会员 · `performance` 演出 · `game` 游戏 · `sports` 运动 · `movie` 电影 · `ticket` 门票 · `education` 教育 |
| 转账(2) | `loan_repay` 还贷 · `advance_pay` 垫付 |
| 其他(7) | `red_packet` 红包 · `cash_gift` 礼金 · `support_family` 赡养 · `donation` 捐赠 · `lost` 丢失 · `gift` 礼物 · `fine` 罚款 |
| 职业收入(3) | `bonus` 奖金 · `part_time` 兼职 · `reimbursement` 报销 |
| 投资(2) | `rent_income` 收租 · `interest` 利息 |
| 意外收入(3) | `refund` 退款 · `lottery` 中奖 · `resale` 闲置出售 |
| 储值(2) | `transit_card` 公交卡储值 · `meal_card` 饭卡储值 |
| 赊销(4) | `huabei` 花呗 · `baitiao` 白条 · `monthly_pay` 月付 · `credit_card` 信用卡 |

---

## 3. 分类节点 → icon_key 映射（含去重复用）

规则：**节点默认用「与自己同名概念」的 key**；下表列出所有「名 ≠ 字形概念」的**复用节点**（决策 4 的去重），其余节点按名直取。

| 分类路径（父 › 子） | icon_key | 说明 |
|---|---|---|
| 各一级下「与父同名」子级（餐饮›餐饮、交通›交通…） | = 父 key | 复用父字形 |
| 购物 › 零食 | `snack` | 复用 餐饮›零食 |
| 购物 › 饮料 | `drink` | 复用 餐饮›饮料 |
| 生活 › 日用 | `daily_goods` | 复用 购物›日用 |
| 生活 › 买菜 | `groceries` | 复用 餐饮›买菜 |
| 生活 › 柴米油盐 | `condiment` | 复用 餐饮 |
| 旅行 › 机票 | `flight` | 复用 交通›机票 |
| 旅行 › 交通 | `transport` | 复用 交通(一级) |
| 旅行 › 火车高铁 | `train` | 复用 交通 |
| 旅行 › 餐饮 | `dining` | 复用 餐饮(一级) |
| 职业收入 › 工资 | `salary` | 复用 职业收入(一级) |
| 投资与资产 › 理财 | `investment` | 复用 投资(一级) |
| 意外收入 › 其他（父默认） | `windfall` | 复用 意外收入(一级) |
| 意外收入 › 转账 | `transfer` | 复用 转账 |
| 意外收入 › 红包 | `red_packet` | 复用 其他›红包 |
| 意外收入 › 礼金 | `cash_gift` | 复用 其他›礼金 |

> 注意 `其他`：支出一级「其他」= `other`（三点图形）；而「意外收入 › 其他」是父默认子 = `windfall`。**同名不同 key**，证明 icon_key 必须按节点显式指定，不可按名自动派生。

---

## 4. 脚本侧改造（Phase 1 · 不影响线上）

### 4.1 新增 `scripts/icon-font/icons.mjs`（唯一图标源）
- 结构：`export const ICONS = { <iconKey>: { label: '早餐', svg: `<path .../>...` } }`，收录全部 81 个字形。
- 迁移动作：把 `docs/design/icon-style-demo.html` 里内联的 14 个 L1 SVG 抽出，把 `icons-l2.mjs` 的 67 个按新 key 平铺，合并进本文件。原 `icons-l2.mjs` 退役或改为 re-export。

### 4.2 新增 `scripts/icon-font/icon-registry.json`（码点稳定表）
- `{ "dining": "e000", ..., "credit_card": "e0xx" }`，提交进仓库。build 只读它分配码点；新增字形只追加新 key，绝不移动已有。

### 4.3 改造 `scripts/icon-font/build.mjs`
- 数据源从「正则抠 demo.html」改为 `import { ICONS } from './icons.mjs'` + 读 `icon-registry.json`。
- 产出新增（除现有 dist/*）：
  - `miniprogram/styles/iconfont.wxss`：`@font-face{font-family:'costra-icons';src:url(data:font/ttf;base64,...)} .costra-icon{font-family:'costra-icons';...}`
  - `miniprogram/services/iconMap.ts`：`export const ICON_GLYPH: Record<string,string> = { dining:'\ue000', ... }` + `export function resolveIconGlyph(key,fallback?)`。
- 保留 dist 下 ttf/preview/compare 作为自检。

### 4.4 改造 `gen-demo-l2.mjs` / demo 生成
- 评审页/预览改为从 `icons.mjs` 读，纯消费者。`icon-style-demo.html` 不再是数据源。

**产物校验**：`node build.mjs` + `render-ttf.mjs` 出 81 字形自检图，肉眼比对保真度。

---

## 5. 小程序侧改造（Phase 2）

| 文件 | 改动 |
|---|---|
| `miniprogram/styles/iconfont.wxss` | **新增（生成物）**：`@font-face` + `.costra-icon` 基类 |
| `miniprogram/services/iconMap.ts` | **新增（生成物）**：`ICON_GLYPH` 映射 + `resolveIconGlyph()`，含缺字兜底 |
| `miniprogram/app.wxss` | 顶部加 `@import "styles/iconfont.wxss";`（全局可用） |
| `miniprogram/styles/category-grid.wxss` | `.category-tier1__icon` / `.category-item__icon` 加 `font-family:'costra-icons'`；字号调大以匹配设计比例（tier1 ~48rpx、tier2 ~40rpx，替代原 32/26rpx 单字字号）；去掉 `font-weight` |
| `miniprogram/services/categoryService.ts` | ①`CONFIG_*` 每个**子节点补显式 `icon`（=icon_key）**，父节点 icon 改 key；②子节点不再继承父 icon（删 `icon: p.icon`）；③`buildCategoryTree`/`buildDedupedSubCategories` 生成的 tier 对象 `icon` 字段填 `resolveIconGlyph(item.icon)`（视图模型转字形）；④`getCategoryIconById` 返回 `resolveIconGlyph(item.icon)`，缺字兜底到父/other 字形；`CategoryItem.icon` 仍存 key（签名不变逻辑） |
| `components/expense-overlay/index.wxml` | 二级由 `{{item.name[0]}}` 改为 `{{item.icon}}`（tier1 已是 `{{item.icon}}`）；icon 容器加 `costra-icon` class |
| `pages/ledger/index.wxml` + `.wxss` | `.entry-icon__text` / tier1 / tier2 同上；`{{item.name[0]}}`→`{{item.icon}}`；`.entry-icon__text` 加 font-family |
| `pages/family/index.wxml` | `family-l1__icon` 渲染值经 resolve；wxss 加 font-family |
| `pages/statistics/tpl-*.wxml` + wxss | 排行 `{{l1.icon}}` 的 icon 来自**统计 API（现在是 key）**→ 统计页数据装配处 `resolveIconGlyph`；`.rank__icon` 加 font-family |

> 关键：凡渲染分类图标处都必须过 `resolveIconGlyph(key)`。已穷举上述 5 类渲染点（overlay 树 / 明细条目 / family / statistics 排行 / 分类编辑）。

---

## 6. 服务端与数据侧改造（Phase 3）

| 文件 | 改动 |
|---|---|
| `design/categories.yaml` | 每节点把 `icon:` 值由单字改为 icon_key（按 §2/§3）；更新文件头字段说明 |
| `server/db/migrations/0001_init.sql` | 系统分类 seed 的 `icon` 列值改为 icon_key（基线正确，未来 fresh DB 直接对） |
| `server/db/migrations/0004_categories_restructure.sql` | 同上，transfer 类目 icon → key |
| **新增** `server/db/migrations/0007_category_icon_keys.sql` | 对**已部署 DB** 把系统分类 `icon` 就地刷成 icon_key（见 §7 草案） |
| `server/api/openapi.yaml` | `Category.icon` 描述补充「值为 iconfont 语义 key，端侧字体映射」；已有「图标 key」表述基本对齐 |
| server 测试 | `syncPull` 相关若断言含 icon 的签名 fixture 需更新；`categories-shared-type.test.ts` 若断言 icon 值需更新（数量断言不受影响） |

**服务端运行时零影响**（icon 全程透传/回显，无逻辑依赖）；改 icon 值会自然改变 categories 同步签名 → `categories_revision` 变化 → 客户端自动缓存失效重拉。

---

## 7. migration 0007 草案

沿用 0001 的 UPSERT 幂等风格（按 `(family_id,name,type,parent_id)` 冲突键，仅系统分类 `family_id IS NULL`），对每个节点按路径 UPDATE `icon`：

```sql
-- 0007_category_icon_keys.sql
-- 将系统分类 icon 列由「单字」刷为「icon_key」（对齐 design/categories.yaml）
-- 幂等：按 name+type+parent 定位，仅更新 icon；家庭自定义分类(family_id 非空)不动
BEGIN;

-- 一级（parent_id IS NULL）
UPDATE categories SET icon = v.k FROM (VALUES
  ('餐饮','expense','dining'), ('交通','expense','transport'),
  ('购物','expense','shopping'), ('生活','expense','life'),
  ('旅行','expense','travel'), ('文娱','expense','entertainment'),
  ('转账','expense','transfer'), ('其他','expense','other'),
  ('职业收入','income','salary'), ('投资与资产','income','investment'),
  ('意外收入','income','windfall'),
  ('储值','transfer','stored_value'), ('账户互转','transfer','account_transfer'),
  ('赊销','transfer','credit')
) AS v(name,type,k)
WHERE categories.family_id IS NULL AND categories.parent_id IS NULL
  AND categories.name = v.name AND categories.type = v.type;

-- 二级（按 父名 + 子名 + type 定位；含 §3 去重复用）
UPDATE categories AS c SET icon = v.k FROM (VALUES
  -- 餐饮
  ('餐饮','餐饮','expense','dining'), ('餐饮','早餐','expense','breakfast'),
  ('餐饮','午餐','expense','lunch'), ('餐饮','晚餐','expense','dinner'),
  ('餐饮','外卖','expense','takeout'), ('餐饮','买菜','expense','groceries'),
  -- ...（此处列全部二级，含复用：('购物','零食','expense','snack')、
  --      ('旅行','交通','expense','transport')、('意外收入','其他','income','windfall') 等）
  ('赊销','信用卡','transfer','credit_card')
) AS v(pname,name,type,k)
WHERE c.family_id IS NULL AND c.name = v.name AND c.type = v.type
  AND c.parent_id = (SELECT id FROM categories p
                     WHERE p.name=v.pname AND p.type=v.type
                       AND p.parent_id IS NULL AND p.family_id IS NULL LIMIT 1);

COMMIT;
```

> 完整 VALUES 行由 §2/§3 表机械展开（本草案省略中段）。落地时从 `categories.yaml` 的 icon_key 列单一来源生成，避免手抄漂移。

---

## 8. 发布顺序与回滚（决策 2 的关键约束）

**必须严格按序**，否则线上旧版会显示英文 key 乱码：

1. **先发小程序新版**（内置字体 + iconMap + 缺字兜底 + wxml/wxss 改造）——此时服务端 icon 仍是单字，新版对「单字」也要能兜底渲染（`resolveIconGlyph` 找不到 key 时的降级：单字直接当文本显示，等价旧行为）。
2. 新版铺开（自然更新 / 强制更新提示 / 灰度）。
3. **最后**执行 migration 0007 + 部署新服务端 → icon 变 key → 新版渲染字体，旧版进入过渡期异常（已接受）。

**回滚**：0007 反向 migration 把 icon 刷回单字即可（保留一份 key→单字 对照）；小程序端 `resolveIconGlyph` 对单字兜底，回滚后仍正常。

> 缓解建议（可选）：`resolveIconGlyph` 兜底策略设计为「key 命中→字形；否则若为单字→原样文本；再否则→父/other 字形」，使**新版对新旧数据都不崩**，把过渡期风险降到最低。

---

## 9. 分阶段任务清单

- **Phase 0** 定稿：确认 §2 key 命名 + §3 复用映射（本文档即评审对象）。
- **Phase 1** 脚本：建 `icons.mjs` + `icon-registry.json`，改 `build.mjs`，产 `iconfont.wxss` / `iconMap.ts`，出自检图。
- **Phase 2** 小程序：app.wxss / category-grid.wxss / categoryService / 5 处 wxml+wxss；本地全路径验收（记账面板 / 明细 / 统计 / 协作）。
- **Phase 3** 服务端：categories.yaml + 0001/0004 seed + 0007 + openapi + 测试；发布新版小程序 → 铺开 → 切服务端。
- **Phase 4** 收尾：旧单字降级逻辑保留兜底、文档、清理退役文件。

---

## 10. 验收标准

- 记账面板一级/二级、明细条目、统计 L1/L2 排行、协作页一级，图标均为新矢量字形；默认/选中（黑/绿）三态换色正确。
- 弱网/首启 fallback（CONFIG_*）图标正确（子级各自 key，非继承父字）。
- 缺字兜底不出现 notdef 方块。
- 服务端 categories 接口/统计接口回归无差异；同步签名变化触发客户端刷新符合预期。
