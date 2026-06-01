# Costra · UI 重构阶段交接总结（2026-06-01）

> 用途：新对话接续 Costra 项目时，先读本文件。当前对话主要完成了 UI 设计文档适配、记账核心 UI 重构与大量真机/开发者工具反馈修复。下一阶段建议转入数据层/后端 API/真实分类与家庭能力。

---

## 1. 本阶段重要规则

1. **Orchestrator 不直接修改业务代码**：只能编排、建 dispatch、派发 `costra-miniapp-dev` / `costra-backend-dev` 等 agent 执行。
2. **严格以 `design/ui/` 为 UI 事实源**：
   - `design/ui/design_spec.md`
   - `design/ui/interaction_flow.md`
   - `design/ui/category_dictionary.md`
3. 执行中若任务模糊或与 UI 文档冲突，必须向 Human 确认。
4. 项目长期开发，不背历史包袱：必要时干净重构，不在坏结构上堆补丁。
5. 记账页技术方案已确认：**全屏覆盖层组件**，点击 TabBar 中间 `[+]` 不路由跳转。

---

## 2. 本阶段已完成 commits

按时间从早到晚：

- `49ebd51` · `feat(miniapp): design tokens overhaul - 全面切换至暖灰白/油墨暖黑/微信绿色彩体系`
- `defab0e` · `feat(miniapp): custom-tab-bar 5 Tab + routing overhaul + eventBus + expense-overlay scaffold`
- `cd1d636` · `feat(miniapp): login page redesign - 极简暖灰白背景+Wordmark+随机格言+微信绿CTA`
- `3f41afb` · `feat(miniapp): ledger page - 明细首屏巨大月支出+日期分组吸顶流水列表+左滑删除+账本切换`
- `cd9cc88` · `feat(miniapp): expense-overlay - 全屏记账覆盖层(分类网格+计算器+算式+账本切换+保存)`
- `4a65569` · `fix(miniapp): login wordmark + tabbar hide on overlay + safe-area vars`
- `063b9e0` · `fix(miniapp): expense-overlay修复(底部绿色残留+全屏分类初始态+支出收入指示器+关闭按钮避让胶囊)`
- `7ff7cdd` / `ff6b8ff` / `614aaae` / `24243fb` · 早期尝试修复分类网格高度/滚动问题（后续证明方向不彻底）
- `74a90e4` · `refactor(miniapp): rewrite expense-overlay from scratch with flex scroll layout`
- `b06e181` · `fix(miniapp): expense-overlay一级分类固定四列网格`
- `e84cdd1` · `feat(miniapp): expense-overlay分类防键盘遮挡滚动与打开重置`
- `51ccd92` · `fix(miniapp): expense-overlay多实例状态同步关闭避免切Tab误弹`
- `0fef508` · `fix(miniapp): expense-overlay分类防遮挡滚动改为真实布局最小位移`
- `741fbb3` · `fix(miniapp): expense-overlay备注可重复编辑+计算器算式修复+防遮挡滚动插值动画`
- `c5902fe` · `fix(miniapp): calculator expression result amountCents uses cents not yuan`
- `41877e6` · `feat(miniapp): standardize safe-area metrics for custom nav and overlays`
- `a058d50` · `fix(miniapp): unify tab pages custom navigation for overlay positioning`
- `307fa2b` · `fix(miniapp): add safe custom nav for tab skeleton pages`

---

## 3. 当前已完成能力

### 3.1 Phase A 基础层

- 设计令牌切换：暖灰白 `#f1f2ec` / 油墨暖黑 `#1c1b1a` / 微信绿 `#07C160`。
- 5 Tab custom-tab-bar：明细 / 统计 / `[+]` / 家庭 / 我的。
- 中间 `[+]` 打开全屏记账 overlay，不发生页面路由跳转。
- 全局 `eventBus` 已建立。
- `safeArea.ts` 已建立统一安全区/导航高度服务。
- 所有 Tab 页已统一 `navigationStyle: custom`，并补了基础自定义导航/安全区。

### 3.2 页面与核心交互

- 登录页已重做：`COSTRA` 全大写轻字重 wordmark + 随机格言 + 微信绿 CTA。
- 明细页初版已完成：巨大月支出、日期分组、吸顶、左滑删除等。
- 记账 overlay 已基本符合预期：
  - 全屏覆盖层；
  - 一级/二级分类 4 列网格；
  - 支出/收入文字切换；
  - 分类选择后键盘才弹出；
  - 下半区分类防键盘遮挡最小滚动；
  - 打开时重置滚动位置；
  - 备注可多次修改；
  - 算式计算与金额单位（分）已修复；
  - 多实例 overlay 残留已修复；
  - TabBar 遮挡与 safe-area 问题已处理。

---

## 4. 本阶段关键踩坑 / 经验

1. **坏结构不要持续打补丁**：`swiper + scroll-view` 导致分类网格空白问题反复修不好，最终 `COSTRA-208` 直接重写为 `flex column + 单一 scroll-view` 才稳定。
2. **overlay 多实例问题**：每个 Tab 页都有独立 `<expense-overlay />`，`SHOW` 广播会同时打开所有实例。修复方式：overlay 也订阅 `HIDE`，普通 Tab 切换前防御性 emit `HIDE`。
3. **金额单位必须是分**：直接输入路径和表达式路径都必须输出 `amountCents`，不能把元值写入 entry。`9+9-9` 曾保存成 9 分导致 `¥0.09`。
4. **开发者工具 vs 真机 safe-area 差异**：不要在关键全屏 overlay 顶部依赖 CSS `env(safe-area-inset-top)`，已建立 `utils/safeArea.ts`。
5. **统一 custom navigation 后必须补自定义导航/安全区**：否则骨架页标题会顶到状态栏/刘海。

---

## 5. 当前工作区状态注意

截至本交接生成时，`git status --short` 显示仍有未提交/未跟踪的编排文件与文档：

- 修改：`.team/members/miniapp-dev/state.md`
- 修改：`design/ui/design_spec.md`
- 修改：`design/ui/interaction_flow.md`
- 未跟踪：`.team/dispatch/COSTRA-200/201/203...` 相关 dispatch 文档
- 未跟踪：`.team/members/miniapp-dev/history/2026-06-*` 多个 history 文档
- 未跟踪：`.codebuddy/rules/`

下一对话开始后应先 `git status` 确认这些文件是否需要整理、补 commit 或归档。不要误删。

---

## 6. 尚未完成的主要任务

### Phase B：数据层重构（建议下一阶段优先）

- **B1** DB Migration：二级分类体系
  - `categories` 增加 `parent_id` / 二级分类结构；
  - seed 按 `design/ui/category_dictionary.md` 全量重建；
  - 处理同名二级分类的默认归属/去重映射。
- **B2** DB Migration：`entries.shared_type`
  - 支持家庭账本公共支出 / 个人支出。
- **B3** 后端分类 API
  - `GET /v1/categories` 返回树形分类 + 去重映射；
  - 后续可支持家庭自定义分类。
- **B4** 前端分类数据模型更新
  - 当前记账 overlay 分类仍硬编码在 `components/expense-overlay/categories.ts`；
  - 需要对接真实分类 API / 本地缓存 / 同步。

### Phase C：页面继续完善

- **C2 明细页完善**
  - 真实账本切换；
  - 成员筛选；
  - 分类名/图标接真实分类；
  - 已退出成员头像灰化；
  - 与新增/删除后的统计级联更精细。
- **C4 统计页全新开发**
  - 月度/年度；
  - 成员横向切换；
  - 单色趋势图；
  - 摘要网格；
  - 排行榜 + 手风琴 + 零值排除。
- **C5 家庭页全新开发**
  - 单人引导态；
  - 多人家庭协作态；
  - 成员横向滚动；
  - 已退出成员灰化；
  - 公共/个人支出拆解；
  - 垫付贡献。
- **C6 我的页重做**
  - 极简名片、记账天数、宏观数据总览、iOS/WeUI 分组菜单。

### Phase D：后端 API 补全

- **D1** 月度/年度统计报表 API。
- **D2** 家庭管理 API：创建、邀请、接受、移出成员、成员列表。
- **D3** 家庭收支统计 API：公共 vs 个人、垫付贡献、成员聚合。

### Phase E：联调与清理

- **E1** 前后端联调：分类、统计、家庭、同步。
- **E2** 老页面/旧逻辑清理：旧 `home` / `entry` / `stat-overview` / `family-dashboard` 等。

---

## 7. 推荐下一阶段路线

建议新对话从数据层开始，而不是继续 UI 局部打磨：

```text
B1/B2（DB migration）✅
  → B3（后端分类 API）✅
  → B4（前端分类数据模型，替换 hardcode categories）✅
  → C2 明细页真实数据完善 ✅
  → D2/D3 + C5 家庭页（Family First · 优先于统计页）
  → D1 + C4 统计页
  → C6 我的页
  → E1/E2 联调与清理
```

> 2026-06-01 Human 更新优先级：统计页、家庭页、我的页需结合当前和未来 Sprint 规划；**家庭页优先级高于统计页**。详细留档见 `.team/HANDOFF-2026-06-01-next-sprints-family-first.md`。

新对话建议开场指令：

> 继续 Costra 项目。请先读取 `.team/HANDOFF-2026-06-01-ui-refactor.md` 和项目规则，按 Orchestrator 规范派发 agent，从 B1/B2 数据层重构开始规划和执行。Orchestrator 不得直接改业务代码。
