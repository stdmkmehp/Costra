# COSTRA-200 · 设计令牌全面重写 (Design Tokens Overhaul)

> **Owner**: miniapp-dev · **Est**: 3pt · **Dep**: 无 · **Sprint**: UI-Refactor Phase-A
> **状态**: Todo → Doing

---

## 背景

UI 设计文档 (`design/ui/design_spec.md` §2) 明确了全新的色彩体系：
- **二元色彩基调**：油墨暖黑 `#1c1b1a` + 暖灰白 `#f1f2ec`
- **原生强调色**：微信品牌绿 `#07C160` (CTA) + 微信标准蓝 `#576B95` (链接)
- **排版驱动层级**：极紧凑标题行高 (1.07) + 负字距
- **扁平克制的深度**：仅用 `rgba(0,0,0,0.22) 3px 5px 30px 0px` 阴影
- **毛玻璃导航**：`rgba(255,255,255,0.85)` + blur

当前实现使用 `#2F7A78` 品牌绿 + `#FAFAFA` 灰白，与设计文档完全不符。需要彻底重写。

---

## DoD (Definition of Done)

### D1: `miniprogram/tokens/index.ts` 全面重写
- [ ] 弃用全部旧色值 (`#2F7A78` / `#FAFAFA` / `#212121` / `#616161` 等)
- [ ] 新增 `color.base`：`warmInk: '#1c1b1a'`, `boneWhite: '#f1f2ec'`
- [ ] 新增 `color.accent`：`wxGreen: '#07C160'`, `wxBlue: '#576B95'`
- [ ] 新增 `color.role.bg`：app(`#f1f2ec`) / surface(`#ffffff`) / navBar/tabBar(`rgba(255,255,255,0.85)`) / overlay
- [ ] 新增 `color.role.text`：primary(`#1c1b1a`) / secondary(`rgba(28,27,26,0.48)`) / tertiary / onGreen / onDark
- [ ] 新增 `color.role.border`：default(`rgba(28,27,26,0.08)`) / subtle(`rgba(28,27,26,0.05)`)
- [ ] 新增 `color.role.amount`：expense(`#1c1b1a`) / income(`#07C160`)
- [ ] 新增 `color.role.icon`：default / selected / tabDefault / tabSelected
- [ ] 新增 `color.semantic`：success(`#07C160`) / warning / danger(`#FA5151`)
- [ ] 新增 `typography` 段：display(112rpx) / headline(56rpx) / title(42rpx) / body(28rpx) / caption(24rpx) / mini(20rpx) + weight + lineHeight(tight:1.07)
- [ ] 新增 `shadow` 段：subtle(`rgba(0,0,0,0.22) 3px 5px 30px 0px`)
- [ ] 新增 `blur` 段：navBar(`20px`) / tabBar(`20px`)
- [ ] 新增 `animation` 段：fast(150ms) / normal(250ms) / slow(350ms)
- [ ] `meta.version` 升至 `'2.0.0'`
- [ ] 导出 `color` / `spacing` / `radius` / `typography` / `shadow` / `blur` / `animation`

### D2: `miniprogram/app.wxss` 全面重写
- [ ] CSS 变量全面对齐新 tokens（`--color-warm-ink` / `--color-bone-white` / `--color-wx-green` 等）
- [ ] 移除旧变量（`--color-brand-primary` / `--color-bg-app: #FAFAFA` 等）
- [ ] 移除深色模式 `@media (prefers-color-scheme: dark)` 块（设计文档明确抛弃暗黑模式）
- [ ] 新增排版原子类：`.text-display` / `.text-headline` / `.text-title` / `.text-body` / `.text-caption`
- [ ] 保留并增强布局原子类（`.flex` / `.row` / `.col` / `.center` / `.between`）
- [ ] `.btn-primary` 改用 `--color-wx-green`，圆角 `8rpx`
- [ ] `page` 基线：`background-color: var(--color-bg-app)` = `#f1f2ec`，`color: var(--color-text-primary)` = `#1c1b1a`

### D3: `miniprogram/app.json` window 配色更新
- [ ] `navigationBarBackgroundColor` → `#f1f2ec`
- [ ] `navigationBarTextStyle` → `"black"`
- [ ] `backgroundColor` → `#f1f2ec`

### D4: `miniprogram/tokens/tokens.json` 同步更新（与 index.ts 对齐）

---

## 技术约束
- 保持 `as const` 导出模式（微信 runtime 不支持 .json loader，COSTRA-122 实证）
- 不引入任何新依赖
- 不修改页面代码（后续任务负责各页面适配）

---

## 强制阅读清单
- `design/ui/design_spec.md` §2 视觉风格与主题（色值/排版/阴影/毛玻璃全部参数）
- 当前 `miniprogram/tokens/index.ts`（了解旧结构以便彻底替换）
- 当前 `miniprogram/app.wxss`（了解旧变量以便彻底替换）
