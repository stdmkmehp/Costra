# 分类图标资源替换 · 落地方案

> 目标：把分类图标从「单个汉字」替换为一套设计好的线性矢量图标（L1 14 个 + L2 67 个 = **81 个唯一字形**），走 iconfont（base64 TTF）渲染。
>
> **重要前提（2026-07-02 校准）**：服务端**尚未正式发布**，**没有旧服务端、没有存量自定义分类数据**需要兼容。因此本方案**不涉及任何"过渡期兼容 / 旧数据兜底 / 数据迁移"**——直接把源头数据改对即可。
>
> 关联：`docs/design/category-icon-open-questions.md`（待产品/后端确认项）、`docs/design/icon-key-consistency-options.md`（跨端一致性候选方案）。

---

## 0. 已锁定决策

| # | 决策 | 结论 |
|---|---|---|
| 1 | 关联机制 | 语义 `icon_key`（分类持有 key，端侧 `key → 字形` 解析） |
| 2 | 数据来源 | 服务端 seed **直接存 `icon_key`**。历史 seed 里的单字（餐/行/购…）只是「图标功能未就绪时的占位默认值」；因无发布、无存量，**直接改 seed 源头**，不做迁移、不做兼容 |
| 3 | 渲染方式 | iconfont：`@font-face` + base64 TTF，单色 `currentColor` 复用现有 `.is-selected` 换色 |
| 4 | 二级复用 | 沿用去重原则：同名/与父同名的二级复用已有字形（多个分类节点 → 同一 icon_key） |
| 5 | 图标源单一化 | L1 + L2 合并为唯一权威源 `icons.mjs`，评审页/预览/构建均从它读 |
| 6 | 未知 key 兜底 | 客户端遇未知/非法 `icon_key` → 显示**占位图标**（不出 tofu、不再回落汉字文本） |

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
【分类权威源】design/categories.yaml（每节点 icon_key）            │
        │ 同步                                                     │
        ▼                                                          │
  server seed（0001/0004 直接写 icon_key）                         │
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

命名规范：`lower_snake_case` 英文语义 token。码点从 `U+E000` 起、**只追加不重排**。

### 2.1 一级（14，码点 E000–E00D）

| icon_key | 分类 | 码点 | icon_key | 分类 | 码点 |
|---|---|---|---|---|---|
| `dining` | 餐饮 | E000 | `other` | 其他 | E007 |
| `transport` | 交通 | E001 | `salary` | 职业收入 | E008 |
| `shopping` | 购物 | E002 | `investment` | 投资与资产 | E009 |
| `life` | 生活 | E003 | `windfall` | 意外收入 | E00A |
| `travel` | 旅行 | E004 | `stored_value` | 储值 | E00B |
| `entertainment` | 文娱 | E005 | `account_transfer` | 账户互转 | E00C |
| `transfer` | 转账 | E006 | `credit` | 赊销 | E00D |

### 2.2 二级（67，码点 E00E 起）

| 组 | icon_key |
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

规则：**节点默认用「与自己同名概念」的 key**；下表列出所有「名 ≠ 字形概念」的**复用节点**（决策 4 的去重），其余节点按名直取。这份映射同时是 §6 seed 写 key 的依据。

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

> 注意 `其他`：支出一级「其他」= `other`（三点图形）；「意外收入 › 其他」是父默认子 = `windfall`。**同名不同 key**，证明 icon_key 必须按节点显式指定。

---

## 4. 脚本侧（图标资产生产线）

### 4.1 唯一图标源 `scripts/icon-font/icons.mjs`
- `export const ICONS = { <iconKey>: { label, svg } }`，共 81。
- L1 在私有分片 `icons-l1.mjs`、L2 在 `icons-l2.mjs`；`icons.mjs` import 两分片并经 `KEY_OF` 平铺，同时 re-export 分组视图供评审/预览。**分片为私有源，仅 `icons.mjs` 引用**，其余脚本一律从 `icons.mjs` 取。

### 4.2 码点表 `scripts/icon-font/icon-registry.json`
- `{ "dining": "e000", … }`，提交进仓库。新增字形只追加、绝不移动已有。

### 4.3 构建管线（node + FontForge 两步）
> ⚠️ 原 `build.mjs`（paperjs-offset 做 stroke→outline）在退化几何（如「加油」半圆）上死循环，已删除，改用 FontForge：
- **第 1 步 `build-svg.mjs`（node）**：`import { ICONS }` + 读 registry，只做 fit 光学归一，产出 `dist/glyph-svg/*.stroke.svg`+`.fill.svg`、`glyphs.json`、`glyph-map.json`、`miniprogram/services/iconMap.ts`。另做 registry↔ICONS key 双向校验。
- **第 2 步 `build-font.py`（FontForge）**：描边扩展→去重叠→`normalize_center`→产 `dist/iconfont.ttf` + `miniprogram/styles/iconfont.wxss`（base64）+ `dist/preview.html`。
- **一键**：`bash scripts/icon-font/build.sh`。依赖：node + `brew install fontforge`。

**产物校验**：`bash build.sh` 后打开 `dist/preview.html` 三态核验。

---

## 5. 小程序侧改造

| 文件 | 改动 |
|---|---|
| `miniprogram/styles/iconfont.wxss` | 生成物：`@font-face` + `.costra-icon` 基类 |
| `miniprogram/services/iconMap.ts` | 生成物：`ICON_GLYPH` 映射 + `resolveIconGlyph()`。**兜底：命中 key→字形；未知/非法 key→占位图标**（不再回落"单字原样文本"——因为已无单字数据）|
| `miniprogram/app.wxss` | 顶部 `@import "styles/iconfont.wxss";`（另见字体加载注意事项，附录 A）|
| `miniprogram/styles/category-grid.wxss` | `.category-tier1__icon`/`.category-item__icon` 加 `font-family:'costra-icons'`；**字号校准到设计比例（图标占圆 ~48%：一级 ~55rpx、二级 ~46rpx，实测微调）**；去 `font-weight` |
| `miniprogram/services/categoryService.ts` | `CONFIG_*`（弱网/首启 fallback）每节点带各自 `icon_key`；`buildCategoryTree`/`buildDedupedSubCategories`/`getCategoryIconById` 的 `icon` 过 `resolveIconGlyph`；`CategoryItem.icon` 存 key |
| `components/expense-overlay/index.wxml`、`pages/ledger/index.wxml`+`.wxss` | 二级 `{{item.name[0]}}`→`{{item.icon}}`；图标容器 font-family |
| `pages/family/index.wxml`+`.wxss`、`pages/statistics/*`+`.wxss` | 图标经 `resolveIconGlyph`；容器 font-family |

> 关键：凡渲染分类图标处都过 `resolveIconGlyph(key)`。已穷举 5 类渲染点（overlay 树 / 明细 / family / statistics 排行 / 分类编辑）。

---

## 6. 服务端与数据侧改造

| 文件 | 改动 |
|---|---|
| `design/categories.yaml` | 每节点 `icon:` 为 icon_key（已改）|
| `server/db/migrations/0001_init.sql` | **直接把 categories seed 的 `icon` 单字改为 `icon_key`**（按 §2/§3）。原单字仅是占位默认值，无发布/无存量，改源头最干净 |
| `server/db/migrations/0004_categories_restructure.sql` | 同上，transfer 类目 seed 的 icon 改为 key |
| ~~`0007_category_icon_keys.sql`~~ | **删除**。它原是为「兼容已部署旧单字数据」设计的迁移；既无旧数据，"先填单字再迁移"的绕路不再需要 |
| `server/api/openapi.yaml` | `Category.icon` / `CategoryCreate.icon` / `StatCategoryRankItem.icon` 描述为「语义 icon_key」；**建议加 `enum`（值由 SSOT 生成）**——见 §7 与一致性文档 |
| 服务端写入校验（新增） | `POST /categories` 校验 `icon ∈ icon_key 枚举集`——见 §7 |

> **服务端运行时对 icon 无逻辑依赖**（全程透传/回显）。seed 改值后，fresh 部署直接返回 icon_key。

---

## 7. 跨端一致性（icon_key 枚举）

`icon_key` 是服务端与客户端共享的枚举，"权威上界"在客户端字体（字体没有的 key 画不出）。保障措施（详见 `docs/design/icon-key-consistency-options.md`，含复杂度/ROI 评估）：

- **M1 客户端兜底**：未知 key → 占位图标（本方案 §5 已含）；
- **M2 单一事实源**：`icon-registry.json` 为 SSOT，字体/iconMap/服务端枚举全由它生成；
- **M3 服务端写入校验**：icon ∈ 枚举集才入库，挡乱配；
- **M6 发布节奏**：新增图标时先发含新字体的客户端，再在服务端启用新 key。**首发场景**（字体与 seed 同版本一起发）天然一致。

> 推荐组合：M1 + M2 + M3（+ M6 流程）。M4（OpenAPI enum）/ M5（CI 校验）为可选加固。

---

## 8. 任务清单

- **脚本**：`icons-l1.mjs` + `icons.mjs` + `icon-registry.json`；`build-svg.mjs` + `build-font.py`；产 `iconfont.wxss` / `iconMap.ts`；`preview.html` 自检。
- **小程序**：`iconMap.ts` 兜底改「未知→占位」；`category-grid.wxss` 字号校准；categoryService + 5 处 wxml/wxss；本地全路径验收。
- **服务端**：`0001/0004` seed 单字直接改 icon_key + 删 `0007`；openapi 描述/enum；（一致性）SSOT 生成服务端枚举 + `POST /categories` 校验。
- **验收**：见 §9。

---

## 9. 验收标准

- 记账面板一级/二级、明细条目、统计 L1/L2 排行、协作页一级，图标均为新矢量字形；三态换色正确；**尺寸比例协调（图标占圆 ~48%）**。
- 二级显示各自图标（早餐≠午餐），非父级图标。
- 弱网/首启 fallback（CONFIG_*）图标正确（子级各自 key）。
- 未知 key 显示占位图标，不出 tofu 方框。
- 服务端 categories/统计接口返回 icon = icon_key；同步签名一致。

---

## 附录 A · 字体加载注意事项（待验证）

小程序自定义组件默认样式隔离；`app.wxss` 的 `@font-face` 可能不作用于组件（如 `expense-overlay`）内部，导致组件内图标 tofu。若实测出现此问题，优先方案：在 `app.js` 用 `wx.loadFontFace({ family:'costra-icons', source:dataURL, global:true })` 全局注册一次（`global` 覆盖所有页面与组件）。此方案还可顺带把 base64 从 `iconfont.wxss` 移出，减小上下文噪音。

---

## 10. 资源组织与待清理项（技术债登记 · 暂缓执行）

> ⚠️ **当前状态**：整套图标体系（`icon_key` + 字体 + 兜底渲染）**尚未真正启用生效**——seed 仍是占位单字、客户端字号未校准、字体加载（附录 A）待验证。
>
> 因此本节**清理动作一律暂缓**，仅作登记。待图标体系落地、验证无误后，再逐项确认执行。**在确认这些资源不会被后续开发复用之前，不得删除。**

### 10.1 资源分类（哪些需长期保留）

| 类别 | 文件 | 性质 | 处置 |
|---|---|---|---|
| ① 图标资产生产线 | `scripts/icon-font/`：`icons-l1.mjs` `icons-l2.mjs` `icons.mjs` `icon-registry.json` `build-svg.mjs` `build-font.py` `build.sh` `gen-demo-l2.mjs` `preview-l2.mjs` `package.json` | 长期：增删改图标都要用 | **保留** |
| ② 运行时产物 | `miniprogram/styles/iconfont.wxss`、`miniprogram/services/iconMap.ts` | 长期：小程序打包必需 | **保留** |
| ③ 构建缓存 | `scripts/icon-font/dist/`、`node_modules/` | 可再生 | 已 `.gitignore` |

**结论**：本套资源**不是一次性的**，①②需长期维护，③是缓存。

### 10.2 阅读代码 / AI 上下文噪音（待优化）

- `miniprogram/styles/iconfont.wxss`（~29KB 单行 base64）、`scripts/icon-font/icons-*.mjs`（大量 path）—— 归属正确、不应挪走。
- 处理方向（暂不执行）：加 `.codebuddyignore`（项目当前无）标为上下文排除；或按附录 A 改 `wx.loadFontFace` 消除 base64。

### 10.3 疑似死文件 / 死依赖（待确认后清理）

> 已核查（`build.sh` 仅用 `build-svg.mjs` + `build-font.py`）。清理前须确认后续开发不复用：

| 项 | 状态 | 备注 |
|---|---|---|
| `scripts/icon-font/icons-old.mjs` | 0 引用 | 旧图标源残留 |
| `scripts/icon-font/render-ttf.mjs` | 0 引用 | 旧 `build.mjs` 管线配套（`build.mjs` 已删）|
| `package.json` deps：`paperjs-offset` `svg2ttf` `svgicons2svgfont` `svgpath` | 旧管线依赖 | 新管线用 jsdom+paper-jsdom+fontforge |
| `README.md` `README-l2.md` `README-scale.md` | 三份碎文档 | 可合并 |
| **`server/db/migrations/0007_category_icon_keys.sql`** | 本方案已决定不用（改走 seed）| 若确认不走迁移路线，随本方案一并删除 |
