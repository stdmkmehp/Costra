# `avatar-image` 头像组件方案与评估

> 状态：**已作废 · 随 `cos-offload-phase2-avatar.md` 的单 URL 方案一并取消**（2026-10-17 · 保留全文作决策存档，不据以施工）
> 日期：2026-09-10（原文 v0.1 待拍板）→ 2026-10-17（状态作废）
> 上游：`docs/design/cos-offload-analysis.md` v0.5 §4.5.7（P1 头像 COS 迁移 · 客户端双 URL 降级的收敛手段 · **该方案亦已作废**）
> **为什么作废**：本组件的全部职责是"封装 `cos_url \|\| url` 主 src + `binderror` 降级本地"。而头像终版方案（`docs/design/cos-offload-phase2-avatar.md` v1.2）是**一步切单 URL**——`<image src>` 直接拿 COS URL，**没有第二个 URL 可降级**，组件因此没有职责。推翻"双 URL"的论证见该文 §4.1/§4.2（`<image>` 不校验小程序合法域名 ⇒ 兼容性从来不是问题；降级落点 nginx 的可用性低于 COS）。
> **仍然有效的残留价值**：文中关于"9 处渲染实为 11 处""占位符有 4 种形态不可强统一""字段名混用 `avatarUrl`/`avatar_url`"的事实梳理仍可作为**独立 UI 一致性议题**的输入（该议题已被 phase2 §15 明确列为非目标）。
> 目的：抽一个 `avatar-image` 自定义组件，统一封装「主 src（COS）+ `binderror` 降级本地」，替代在 9 处头像 `<image>` 逐个手写 `binderror` + 列表按 index 回写。
> 事实源：`pages/mine/index.wxml`、`pages/profile-setup/index.wxml`、`pages/ledger/index.wxml`、`components/filter-panel/index.wxml`、`pages/statistics/index.wxml`、`pages/statistics/tpl-rank-section.wxml`、`pages/family/index.wxml`、`pages-gm/impersonate/index.wxml`、`components/ledger-switcher/`（组件范式）

---

## 1. 结论摘要

| # | 结论 | 依据 |
|---|------|------|
| C1 | **值得抽组件**：全项目 **9 处头像渲染**（6 文件）都要加「COS 主 src + 失败降级本地」，逐处手写 `binderror` + 列表按 index 回写**易错、且后续新增头像点必漏**；组件把降级逻辑收敛到一处 | §2 |
| C2 | **难点不在降级、在占位符不统一**：9 处占位符有 **4 种形态**（无 fallback / CSS 人形剪影 / 首字母 initial / nickname[0]），外围还有**角标、选中 border、父级内联底色**等装饰 ⇒ 组件不能强行统一占位符，须用 **slot 外置占位与装饰** | §3 |
| C3 | **推荐方案：薄组件 + `fallbackText` 默认首字母圈 + `empty` slot**——组件封「双 URL src + binderror 降级 + `<image>` 基础属性透传」，占位符按优先级 slot > fallbackText > 空；8/9 的 initial 场景只传 `fallback-text`（零 slot 样板），②CSS剪影/①无占位用 slot 或都不传。既统一降级逻辑，又零损各处既有样式 | §4 |
| C4 | **列表场景是关键收益点**：③④⑤⑥⑦⑧ 在 `wx:for` 里，手写降级要在页面 data 里按 index 回写单项 src（极易错）；组件把「本项降级」封在**组件自身 data**，页面 data 完全不用动 | §3 / §4 |
| C5 | **字段名差异需归一**：9 处混用 `avatarUrl`（VM 层）与 `avatar_url`（API 原字段），且降级源字段 `initial`/`memberInitial`/`nickname[0]` 不一。组件 props 用统一命名（`cosUrl`/`localUrl`），由各调用点适配 | §3 / §5 |
| C6 | **改造量可控**：新增 1 个组件（4 文件）+ 改 9 处 wxml + 对应 .ts 数据结构补 `cosUrl` 字段 + 各页 json 注册组件。无契约/无 migration（那属服务端 §4 范畴） | §5 / §6 |

---

## 2. 背景：为什么要组件化

P1 头像迁移 COS 采用「服务端双写 + 双 URL 客户端降级」（`cos-offload-analysis.md` v0.5）：客户端头像主 src 用 COS URL，加载失败（`binderror`）降级到本地 URL。若逐处手写：

- 每个 `<image>` 加 `binderror` 处理器；
- 列表（`wx:for`）里降级要 setData 精确回写**该 index 项**的 src——`this.setData({ ['list[3].src']: localUrl })`，index 易错、多列表更乱；
- 全项目 **9 处**都要写一遍，且**后续任何新增头像渲染点都可能漏写降级**，导致 COS 故障时该处永久破图。

组件化把「主→备降级」这一行为**收敛到单一实现**，是这次迁移在客户端侧最实在的优化。

---

## 3. 现存 9 处头像渲染差异矩阵（组件设计的约束来源）

| # | 位置 | 尺寸/class | mode | lazy-load | 占位符（无头像时） | 数据字段 | 额外装饰 | 列表 |
|---|------|-----------|------|-----------|-------------------|---------|---------|------|
| ① | `mine` 个人大头像 | 160rpx `profile__avatar` | aspectFill | ✗ | **无 fallback**（灰底空图，靠 `background` 兜底） | `avatarUrl` | 右上资料红点 / 支持者纪念章（同级，非组件内） | 否 |
| ② | `profile-setup` 可编辑大头像 | 160rpx `avatar-img` | aspectFill | ✗ | **纯 CSS 人形剪影**（head+body 两 view） | `avatarUrl` | 编辑角标 `avatar-edit-badge` | 否 |
| ③ | `ledger` 条目成员 | 40rpx `entry-member__avatar` | aspectFill | ✓ | `initial`（**`wx:elif memberInitial`**，空则不显示） | `avatarUrl`/`memberInitial` | 循环/共享角标 `entry-member__badge` | 是 |
| ④ | `filter-panel` 成员 | 72rpx `filter-member__avatar` | aspectFill | ✓ | `initial` 首字母 | **`avatar_url`**/`initial` | 选中态 `border` | 是 |
| ⑤ | `statistics` member-strip | `member-strip__avatar-img` | aspectFill | ✓ | `initial` | `avatarUrl`/`initial` | **父级 `<view>` 内联 `background-color`** + 指示条 | 是 |
| ⑥ | `statistics` tpl-rank L3 | `l3__avatar-img` | aspectFill | ✓ | `initial`（`wx:else` placeholder） | `avatarUrl`/`initial` | — | 是 |
| ⑦⑧ | `family` L3 明细 ×2 | `family-l3__avatar-img` | aspectFill | ✓ | `initial`（`wx:else` placeholder） | `avatarUrl` | — | 是 |
| ⑨ | `family` color-picker 成员 | `color-picker__avatar-img` | aspectFill | ✓ | **`nickname[0] || '?'`** | `avatarUrl` | — | 是 |
| ⑩⑪ | `pages-gm/impersonate` ×2 | `gm__avatar` | aspectFill | ✗ | `initial`（`wx:else` placeholder） | **`avatar_url`**/`initial` | — | 是 |

**三条关键约束**：
1. **占位符 4 种形态不可强统一**：无 fallback（①）、CSS 人形剪影（②）、首字母 initial（③④⑤⑥⑦⑧⑩⑪）、nickname[0]（⑨）。且 initial 的取值/降级字段名不一（`initial`/`memberInitial`）。
2. **外围装饰各异且属"兄弟节点"**：红点/纪念章/编辑角标/循环角标/选中 border/父级内联底色——这些**不属于头像图本身**，组件不该吞。
3. **mode 全是 aspectFill、lazy-load 列表处基本都 ✓**：这两个可作 props 默认值。

---

## 4. 推荐方案：薄组件 + 具名 slot（只封降级，不预设视觉）

### 4.1 设计原则
组件**只做一件事**：渲染一个「主 src=COS、`binderror` 时降级 localUrl」的 `<image>`，并透传 `<image>` 基础属性；**占位符与装饰全部交给调用方 slot**。避免组件去猜 9 种视觉，保持薄、通用、零样式侵入。

### 4.2 组件 API

`components/avatar-image/`（index.{ts,wxml,wxss,json}）

**properties**
| prop | 类型 | 默认 | 说明 |
|------|------|------|------|
| `cosUrl` | String | `''` | COS URL（主）；空则直接用 localUrl |
| `localUrl` | String | `''` | 本地 URL（备/兜底）；两者皆空则走占位逻辑 |
| `fallbackText` | String | `''` | **默认首字母圈文本**（首字母/首字/`?`）。两 URL 皆空且未传 `empty` slot 时，组件内建渲染一个默认首字母圈——覆盖 8/9 的 initial 场景，调用方无需写 slot 样板 |
| `mode` | String | `aspectFill` | 透传 image mode |
| `lazyLoad` | Boolean | `false` | 透传 image lazy-load（列表处传 true） |
| `webp` | Boolean | `true` | 透传（COS 可能返回 webp） |

**内部 data**：`curSrc`（当前生效 src）、`degraded`（是否已降级，防重复触发）。

**占位优先级（两 URL 皆空时）**：`empty` slot（若调用方提供） > `fallbackText` 默认首字母圈（若非空） > 空（什么都不渲染，如 ① mine）。slot 优先保证 ②CSS剪影 等特殊场景可完全自定义；多数 initial 场景只传 `fallback-text` 即可。

**逻辑**
- `attached` / `observer(cosUrl,localUrl)`：`curSrc = cosUrl || localUrl`，`degraded=false`。
- `onError`（绑 `<image binderror>`）：若 `!degraded && localUrl && curSrc!==localUrl` ⇒ `setData({ curSrc: localUrl, degraded: true })`；否则触发 `bind:error`（两 URL 都挂 ⇒ 回落占位）。
- 两 URL 皆空（或都加载失败）⇒ 不渲染 `<image>`，按上述优先级渲染 `empty` slot 或 `fallbackText` 默认圈。

### 4.3 组件 wxml（示意）
```html
<image
  wx:if="{{curSrc}}"
  class="avatar-image__img"
  src="{{curSrc}}"
  mode="{{mode}}"
  lazy-load="{{lazyLoad}}"
  webp="{{webp}}"
  binderror="onError"
/>
<!-- 占位优先级：empty slot > fallbackText 默认圈 > 空 -->
<block wx:else>
  <slot name="empty">
    <text wx:if="{{fallbackText}}" class="avatar-image__fallback">{{fallbackText}}</text>
  </slot>
</block>
<!-- 装饰（角标/红点/选中态）由调用方在组件外做兄弟节点，不进组件 -->
```
（`<slot>` 内的 `<text>` 是**默认内容**：调用方提供 `slot="empty"` 节点时覆盖之，否则回落到 `fallbackText` 默认圈。）

组件 wxss：`.avatar-image__img { width:100%; height:100%; }`；`.avatar-image__fallback` 给一个**通用默认首字母圈**样式（居中、100% 宽高、继承外层圆形/底色）——但**尺寸/圆角/底色仍由外层 class 决定**，`fallback` 只负责文字居中，不预设色值（避免与 ⑤ 内联底色、④ 选中态冲突）。

### 4.4 各处如何替换（保持原视觉）

- **多数 initial 场景（③④⑤⑥⑦⑧⑩⑪，8 处）**：外层 wrap 保留，直接传 `fallback-text`，**无需写 slot**：
  ```html
  <view class="filter-member__avatar">
    <avatar-image
      cos-url="{{item.avatarCosUrl}}"
      local-url="{{item.avatarUrl}}"
      fallback-text="{{item.initial}}"
      lazy-load
    />
  </view>
  ```
  降级在组件内自理，**页面 data 不再需要按 index 回写 src**（C4 核心收益）；首字母圈由组件内建，样板最省。
  - ③ `ledger` 用 `fallback-text="{{entry.memberInitial}}"`（空串时组件不渲染文字，等价原 `wx:elif` 语义）；⑨ `color-picker` 传 `fallback-text="{{u.nickname[0] || '?'}}"`。
- **② profile-setup（CSS 人形剪影）**：用 `empty` slot 放剪影两 view（slot 覆盖 fallbackText）；编辑角标仍是组件外兄弟节点。
- **① mine（无 fallback）**：`fallback-text` 不传、也不给 slot ⇒ 占位为空，保持"灰底空图"观感（外层 background 兜底）。

### 4.5 数据侧改造
各页/组件的头像项数据结构补一个 COS 字段：
- VM 层（`avatarUrl`）→ 增 `avatarCosUrl`（来自 API 新增的 `avatar_cos_url`，§服务端）；
- API 原字段处（filter-panel ④ / gm ⑩⑪ 用 `avatar_url`）→ 增 `avatar_cos_url` 透传。
- `initial`/`memberInitial`/`nickname[0]` 组装逻辑**不变**，只是移进 slot 渲染。

---

## 5. 备选方案对比

| 方案 | 降级逻辑 | 占位符 | 各处样式 | 列表回写 | 评价 |
|------|---------|--------|---------|---------|------|
| **A 薄组件 + slot（推荐）** | 组件内收敛 | 调用方 slot | 零损（外层 class 照旧） | 组件自理，页面 data 不动 | ✅ 通用、薄、零视觉侵入 |
| B 胖组件（props 传 initial/size/shape，占位符内建） | 组件内 | 组件按 props 画 | 组件需覆盖 4 种占位 + 角标 + 选中 + 内联底色 ⇒ props 爆炸 | 组件自理 | ❌ 为统一 9 种视觉把组件写臃肿，②CSS剪影/⑤内联底色难塞 |
| C 不抽组件，逐处手写 binderror | 每处手写 | 各处原样 | 零损 | **页面 data 按 index 回写（易错）** | ❌ 9 处重复 + 新增点必漏（C1 反面） |
| D behavior/mixin 而非组件 | 复用函数 | 各处原样 | 零损 | 仍需每处 wxml 绑 error + data 回写 | ⚠️ 少写 JS 但 wxml/data 仍每处改，未解列表回写痛点 |

推荐 **A**：难点是占位符不统一（§3 约束1），slot 恰好把这块甩给调用方，组件只留最通用的降级内核。

---

## 6. 改造清单与工作量

1. 新增 `components/avatar-image/index.{ts,wxml,wxss,json}`（薄组件，~60 行）。
2. 改 9 处 wxml：`<image>` → `<avatar-image>`；**8 处 initial 直接传 `fallback-text`**（无 slot 样板），② CSS剪影用 `empty` slot、① 无占位两者都不传；外层 wrap/装饰/选中态/内联底色**保持不变**。
3. 改对应 .ts 数据结构：头像项补 `avatarCosUrl`/`avatar_cos_url` 字段（来源 = API 新增 `avatar_cos_url`）。
4. 各宿主页/组件 `index.json` 注册 `"avatar-image": "/components/avatar-image/index"`（注意路径：`pages-gm`/`pages` 层级不同）。
5. 无契约、无 migration（服务端双写/加列属 `cos-offload-analysis.md` §4）。

**工作量评估**：组件本体小；主要成本在 9 处 wxml 逐一替换 + 验证各处视觉（尤其 ②CSS剪影、⑤内联底色、③`memberInitial` 语义、①无fallback）不回归。建议按「先落组件 + 单元验证降级 → 逐文件替换 → 每替换一处真机核对视觉」推进。

---

## 7. 风险与注意点

| 风险 | 缓解 |
|------|------|
| slot 占位符与原 `wx:if/wx:else` 语义偏差（如 ③ `wx:elif memberInitial`、① 无 fallback） | 组件「两 URL 皆空才渲染 empty slot」；slot 内可再用 `wx:if` 精确复刻原条件 |
| `binderror` 在真机的触发时机（首屏 lazy-load 未进视口是否算 error） | lazy-load 未加载不触发 error；进视口加载失败才触发降级——符合预期，真机验 |
| 组件多实例（长列表 N 个头像）性能 | 组件极薄（一个 image + 少量 data），与原生 image 开销近似；lazy-load 透传保留 |
| `webp` 透传导致老图问题 | COS/本地 URL 带后缀，webp 属性只影响 COS 侧支持，默认 true 安全；如有异常可关 |
| 装饰节点（角标/红点/选中）被误吞进组件 | 明确约定：**装饰是组件外兄弟节点**，组件只管 image + empty slot |

---

## 8. 待决

1. 组件命名与目录：`components/avatar-image/`（与现有 kebab-case 组件一致）。
2. ~~是否加 `fallbackText`~~ **已定稿：加**。组件内建默认首字母圈（覆盖 8/9 的 initial 场景，调用方只传 `fallback-text`），`empty` slot 优先级更高供 ②CSS剪影 等自定义；① mine 两者都不传即空占位。
3. 是否顺带统一占位符视觉（当前 4 种）——**不在本次范围**，避免设计回归；组件只做降级 + 默认首字母圈，视觉统一另议。
4. `fallback` 默认圈是否需要一个默认底色：当前定为**不预设色值**（只居中文字），底色沿用外层 class——避免与 ⑤ 内联底色 / ④ 选中态冲突。若各处默认圈底色缺失导致观感差，再评估加一个可选 `fallbackBg` prop。
