# 分类图标资源替换 · 落地方案（已实现）

> 目标：把小程序当前「分类图标 = 单个汉字文本」替换为新设计的一套线性矢量图标（L1 14 个 + L2 67 个 = 81 个唯一字形），走 iconfont（base64 TTF）渲染。
>
> 本文为**已落地**的逐文件方案。构建管线已从最初计划的 `build.mjs`（paperjs-offset）改为 **FontForge 两步管线**（见 §4.3）；小程序 / 服务端 / 迁移代码均已实现，待按 §8 发布顺序上线。

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
                                   ▼  build-svg.mjs（node·fit 归一产 SVG） + build-font.py（FontForge·描边→TTF）
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
- 迁移动作（已完成）：L1 从 `docs/design/icon-style-demo.html` 抽到**私有分片** `icons-l1.mjs`；`icons.mjs` import `icons-l1.mjs` + `icons-l2.mjs`，经 `KEY_OF` 平铺为 `{ iconKey: {label, svg} }` 共 81，并 re-export 分组视图（`ICONS_L1`/`ICONS_L2`）供评审/预览脚本消费。**分片为私有源，仅 `icons.mjs` 引用**；其余脚本（`build-svg.mjs` / `gen-demo-l2.mjs` / `preview-l2.mjs`）一律从 `icons.mjs` 取，杜绝双源漂移。`build-svg.mjs` 另做 registry ↔ ICONS key 双向校验。

### 4.2 新增 `scripts/icon-font/icon-registry.json`（码点稳定表）
- `{ "dining": "e000", ..., "credit_card": "e0xx" }`，提交进仓库。build 只读它分配码点；新增字形只追加新 key，绝不移动已有。

### 4.3 构建管线（node + FontForge 两步）
> ⚠️ 落地变更：原计划用 `build.mjs`（paperjs-offset 做 stroke→outline）在退化几何（如「加油」喷嘴半圆）上**死循环**，且不可靠。已改用工业标准 **FontForge** 的几何描边扩展，拆两步：

- **第 1 步 `scripts/icon-font/build-svg.mjs`（node）**：`import { ICONS }` + 读 `icon-registry.json`，只做 fit 光学归一（measure bbox + 缩放居中，**不做描边外扩**），产出：
  - `dist/glyph-svg/<cpHex>-<key>.stroke.svg`（描边中心线）+ `.fill.svg`（实心形状）
  - `dist/glyphs.json`、`dist/glyph-map.json`、`miniprogram/services/iconMap.ts`（不依赖 ttf，提前生成）
  - `elToPaper` 支持 path/circle/ellipse/rect。
- **第 2 步 `scripts/icon-font/build-font.py`（FontForge）**：逐字 `importOutlines(stroke) → stroke("circular",62.5,round,round) → importOutlines(fill) → removeOverlap → correctDirection → normalize_center → round`，产出：
  - `dist/iconfont.ttf`
  - `miniprogram/styles/iconfont.wxss`（@font-face base64 + `.costra-icon`）
  - `dist/preview.html`
  - `normalize_center`：等比缩放到 `TARGET_EM=833`（=EM·20/24）+ 居中（水平 EM/2，垂直 (ascent−descent)/2），消除 FontForge SVG 导入的缩放/定位差异。
- **一键**：`bash scripts/icon-font/build.sh`（串联两步）。依赖：node（已 npm install）+ `brew install fontforge`。

### 4.4 图标源单一化
- `icons.mjs` 为唯一对外源：`import` L1（`icons-l1.mjs`，从 demo.html 抽出）+ L2（`icons-l2.mjs`），经 `KEY_OF` 平铺为 `{ iconKey: {label, svg} }` 共 81。构建只读 `icons.mjs`，不再正则解析 HTML。
- `icons-l1.mjs` / `icons-l2.mjs` 为**私有分片源**，仅 `icons.mjs` import；评审页（`gen-demo-l2.mjs`）、PNG 预览（`preview-l2.mjs`）改从 `icons.mjs` re-export 的分组视图读取，不再直连分片，避免预览 / 构建 / registry 三者漂移。

**产物校验**：`bash build.sh` 后打开 `dist/preview.html` 三态核验保真度。

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
| `server/db/migrations/0001_init.sql` | **保持历史单字 seed 不改**（不改历史迁移，规避风险；由 0007 统一收敛） |
| `server/db/migrations/0004_categories_restructure.sql` | **保持不改**，同上 |
| **新增** `server/db/migrations/0007_category_icon_keys.sql` | 系统分类 `icon` 就地刷成 icon_key（幂等 UPDATE）。migrations 顺序执行，0007 在末尾对 **fresh + existing** 环境统一收敛为 key（见 §7） |
| `server/api/openapi.yaml` | `Category.icon` 与统计 `StatCategoryRankItem.icon` 描述均补充「值为语义 icon_key，端侧经 iconMap 映射为字体字形」 |
| server 测试 | `syncPull` 相关若断言含 icon 的签名 fixture 需更新；`categories-shared-type.test.ts` 若断言 icon 值需更新（数量断言不受影响） |

**服务端运行时零影响**（icon 全程透传/回显，无逻辑依赖）；改 icon 值会自然改变 categories 同步签名 → `categories_revision` 变化 → 客户端自动缓存失效重拉。

---

## 7. migration 0007（已实现 · 以下为设计草案）

> 实际落地文件见 `server/db/migrations/0007_category_icon_keys.sql`（完整 VALUES 已按 §2/§3 展开）；本节保留设计草案说明其结构与幂等策略。

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
- **Phase 1** 脚本：建私有分片 `icons-l1.mjs` + 唯一源 `icons.mjs` + `icon-registry.json`，`build-svg.mjs`（node·产 SVG）+ `build-font.py`（FontForge·产 TTF），产 `iconfont.wxss` / `iconMap.ts`，出 `preview.html` 自检。
- **Phase 2** 小程序：app.wxss / category-grid.wxss / categoryService / 5 处 wxml+wxss；本地全路径验收（记账面板 / 明细 / 统计 / 协作）。
- **Phase 3** 服务端：categories.yaml（L1 icon→key）+ **新增 0007（0001/0004 历史 seed 不改）** + openapi + 测试；发布新版小程序 → 铺开 → 切服务端。
- **Phase 4** 收尾：旧单字降级逻辑保留兜底、文档、清理退役文件。

---

## 10. 验收标准

- 记账面板一级/二级、明细条目、统计 L1/L2 排行、协作页一级，图标均为新矢量字形；默认/选中（黑/绿）三态换色正确。
- 弱网/首启 fallback（CONFIG_*）图标正确（子级各自 key，非继承父字）。
- 缺字兜底不出现 notdef 方块。
- 服务端 categories 接口/统计接口回归无差异；同步签名变化触发客户端刷新符合预期。
