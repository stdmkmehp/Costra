# 任务派单 · COSTRA-011 设计系统 v0.1（WeUI Token + 分享卡片）

> ✅ **DONE**（Orchestrator `execute-now` 代笔落地 · 2026-04-21 17:45）
> 产物回链：`docs/design/tokens.json` · `docs/design/design-system.md` · `docs/design/share-cards/{README,family-invite,annual-report,entry-flex,budget-kept}.md`
> 闸门：**G2 Ready for Review**（待 Human 评审）
> 备注：首轮写入 7 份 0 字节空文件，已自检并全部补齐。

---

- **Owner**: Design-Agent
- **Priority**: P0
- **派发时间**: 2026-04-21 15:29（Orchestrator）
- **完工时间**: 2026-04-21 17:23（Orchestrator 代笔）
- **依赖**: COSTRA-010 IA（可并行启动，冻结前需对齐）、`ADR-0004` §金额规范
- **产物路径**: `docs/design/design-system.md`、`docs/design/tokens.json`、`docs/design/share-cards/`
- **预计工期**: 1 个工作日（与 COSTRA-010 并行）

---

## 1. 目标

产出一份**面向小程序工程可消费**的设计系统 v0.1，包含：
1. 基于 **WeUI** 二次封装的基础组件清单
2. **Design Token**（色板 / 字号 / 间距 / 圆角 / 阴影 / 动效）以 JSON 落盘，MiniApp-Agent 可直接转 WXSS 变量
3. **4 套分享卡片视觉规范**（家庭邀请、年度报告、记一笔炫耀、预算达成）
4. **Skyline vs WebView 渲染引擎选型**（结合 ADR-0004）

## 2. 输入

- `ADR-0004` §2 分包 / §8 金额 / §9 灰度
- WeUI 官方：<https://developers.weixin.qq.com/miniprogram/design/>
- Skyline：<https://developers.weixin.qq.com/miniprogram/dev/framework/runtime/skyline/introduction.html>
- 分享卡片规范：<https://developers.weixin.qq.com/miniprogram/dev/reference/api/Page.html#onShareAppMessage-Object-object>

## 3. 验收标准（AC）

### AC-1 Token 完整
- [ ] `tokens.json` 至少包含：
  - 色板（brand / success / warning / danger / neutral 各 9 级）
  - 字号（12/14/16/20/24/32）
  - 间距（4/8/12/16/24/32）
  - 圆角（4/8/12/999）
  - 阴影（sm/md/lg）
  - **金额专用字体栈**（等宽，配合 ADR-0004 §8）
- [ ] 同时暗黑模式 token（后续 R2 可启用）

### AC-2 组件清单
- [ ] 至少覆盖：TopBar / TabBar / List / Card / Modal / ActionSheet / Toast / AmountInput / CategoryPicker / DatePicker / Empty / Skeleton
- [ ] 每个组件指出**优先使用 WeUI 原生**还是**自定义实现**及理由
- [ ] 对性能敏感组件（长列表、统计图）标注 Skyline 兼容性

### AC-3 分享卡片
- [ ] 4 套卡片分别产出：标题文案模板（≤ 20 字）、封面尺寸（5:4 官方推荐 500×400）、背景图规范、文案动态变量
- [ ] 单独产出 `docs/design/share-cards/README.md` 给 MiniApp-Agent

### AC-4 渲染引擎选型
- [ ] 在 `docs/design/design-system.md` 给出结论：MVP 默认 WebView 还是 Skyline
- [ ] 写明依据（兼容性、组件覆盖、加载性能）

### AC-5 工程约束
- [ ] 所有微信能力引用附官方锚点
- [ ] 提交：`feat(design): design system v0.1 (tokens + share cards)`
- [ ] `Refs: COSTRA-011, ADR-0004`

## 4. 完成时动作（同 COSTRA-010 §5）
