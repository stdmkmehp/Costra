# COSTRA-223 · 家庭页全新开发 / API 接入（Family Page Implementation）

> **触发**：`plan-dispatch:COSTRA-223`  
> **派单时间**：2026-06-02 16:32（Orchestrator · Sprint-5 Family Experience）  
> **状态**：R1.x.1 修订完成 · 2 P0 + 4 P1 全修 · typecheck/lint/test 全绿 · 等 Human T1 终审  
> **Owner**：`costra-miniapp-dev`  
> **优先级**：P0  
> **估点**：5  
> **Epic**：Epic-D 家庭共享  
> **类型**：miniapp feature（前端页面 + API 接入）  
> **硬约束**：本 dispatch 只定义卡；未到 `start:COSTRA-223` 前不得写业务代码。

---

## §0 SBAI 装扮路径

| 阶段 | Subagent | 状态 |
|---|---|---|
| **Card-Review R1** | `costra-card-reviewer-tech` + `costra-card-reviewer-product` | ✅ `PASS-WITH-FOLLOWUP 27/30` · `.team/reviews/COSTRA-223/card-review-round-1-tech.md` |
| **Dispatch 修订** | Orchestrator | 如 Card-Review REVISE，则先修订本文件 |
| **R1 实装** | `costra-miniapp-dev` | ✅ 完成（5 文件 · 1712 行 · typecheck/lint/test 全绿） |
| **R1 Review** | `costra-review-tech` + `costra-review-product` | ✅ `REVISE 25/35` · 2 P0 / 4 P1 / 4 P2 · `.team/reviews/COSTRA-223/round-1-tech.md` |
| **Human T1 终审** | `approve:COSTRA-223` | review PASS/APPROVE 后 |

> **双审说明**：本卡既涉及数据接入/状态管理（tech），又涉及 UI/UX 设计还原与交互体验（product）。Card-Review 和产出 Review 均建议双审。

---

## §1 背景

### §1.1 当前最高可信事实

当前正式基线已包含：

- `COSTRA-154/150`：sync pull / scheduler / outbox / v1.2 watermark。
- `COSTRA-164/165`：server family bootstrap MVP + miniapp active family context service。
- `COSTRA-217`：二级分类 schema + `entries.shared_type`。
- `COSTRA-218`：后端分类 API。
- `COSTRA-219`：前端分类模型 API + cache。
- `COSTRA-220`：明细页真实数据完善。
- `COSTRA-221`：Family Management API（family list / detail / members / invite / accept / remove / rename / delete）—— **Human T1 APPROVED CLOSED**，commit `未记录/参见 FINAL`。
- `COSTRA-222`：Family Summary API（monthly summary / shared-personal split / paid contribution / category rank）—— **Human T1 APPROVED CLOSED**，commit `6bf431b`。
- UI 重构基线：设计令牌、5 Tab custom-tab-bar、登录页、明细页、记账 overlay、安全区、自定义导航与验收 polish。

### §1.2 本卡直接动因

`COSTRA-221/222` 已提供完整的家庭管理 + 财务聚合后端能力，家庭页前端是 Sprint-5 第一张 P0 卡。当前 `miniprogram/pages/family/index.ts` 仅为骨架（25 行，只含安全区导航），不具备任何业务功能。

### §1.3 前次 prototype 处理

Sprint-3 末期曾存在一批非正式 `COSTRA-223` prototype 代码变更，已由 Human 确认回滚，不计入正式进度。本次 dispatch 从干净基线开始。

---

## §2 设计事实源

**唯一设计权威**：

1. `design/ui/design_spec.md` §6.5（家庭页排版架构）
2. `design/ui/interaction_flow.md` §6（家庭页流转）
3. `design/ui/design_spec.md` §2（视觉风格与主题）

**关键设计提取**（必须严格还原，不可自创交互）：

### §2.1 两态设计

| 状态 | 触发条件 | 页面表现 |
|---|---|---|
| **Solo Landing（单人引导态）** | 用户仅拥有默认单人家庭 | 个人摘要 + 中灰引导文案 + CTA `[创建家庭账本]` |
| **Multi-Family（多人协作态）** | 用户存在至少一个 shared family | 家庭名 + 成员区 + 占比条 + 公共/个人明细 + 下钻 |

### §2.2 单人引导态

- 顶部显示"我的账本"。
- 隐藏成员与邀请区。
- 简化为个人本月总支出/收入/结余摘要。
- 引导文案：`财务独立，但不孤立。邀请伴侣或家人，开启清晰的共同记账。`（14px · `rgba(28,27,26,0.48)`）。
- CTA：`[创建家庭账本]`（`#07C160` 背景 · 白色文字 · 圆角 8px · 宽度 60%）。

### §2.3 多人协作态（自上而下）

1. **家庭名称区**：居中 28px 油墨黑。
2. **成员与邀请区（Avatar Row）**：
   - 横向平铺圆形微信头像；
   - 横向溢出 → 隐形 `scroll-view`（不可换行 · scrollbar 不可见）；
   - 已退出成员：灰度 + opacity 0.4 + 排末尾（[+] 前）+ 点击无响应 + 可选 `已退出` 12px 灰字；
   - 末尾 `[+]` 淡绿圆形邀请按钮 → `wx.shareAppMessage`；
   - 创建者点击他人头像 → 底部 ActionSheet → `[移出家庭]`。
3. **公共/个人收支数据区**：
   - 时间导航：`[<] 2026年5月 ▼ [>]` + `月度 / 年度` 切换；
   - **Segmented Bar**：水平 8px 进度条，按金额比例切分（公共 / 成员N）；
   - **数据明细列表**：
     - 公共支出行 + 垫付贡献（灰色小字 `xxx付 ¥N / yyy付 ¥M`）；
     - 各成员个人支出行（带 Mini 头像）；
   - **下钻 Accordion**：点击展开分类排行榜；适用长列表省略逻辑（>6 项截断 + `还有 N 个较小支出未显示...`）；零值严格排除。

### §2.4 视觉规范

- 背景：暖灰白 `#f1f2ec`。
- 顶部导航栏标题固定为"家庭"。
- 空态规则：不使用任何卡通/插画，仅居中极简中灰小字。
- 全局色彩系统参照 `miniprogram/config/tokens.ts`。

---

## §3 API 接入规范

### §3.1 依赖 API 清单

| API | 来源卡 | 用途 |
|---|---|---|
| `GET /v1/families` | COSTRA-221 | 判断单人/多人态；获取 family list |
| `GET /v1/families/{id}` | COSTRA-221 | 获取家庭详情（name / created_at） |
| `GET /v1/families/{id}/members` | COSTRA-221 | 成员列表（role / status / avatar / nickname / joined_at / left_at） |
| `GET /v1/families/{id}/summary?month=YYYY-MM` | COSTRA-222 | 月度聚合：total / shared / personal / contribution / category rank |
| `POST /v1/families` | COSTRA-221 | 创建 shared family |
| `POST /v1/families/{id}/invites` | COSTRA-221 | 创建邀请 |
| `DELETE /v1/families/{id}/members/{user_id}` | COSTRA-221 | 移出成员 |

### §3.2 请求层约束

- 复用 `miniprogram/services/request.ts` 统一请求封装（已含 token inject / refresh / error handling）。
- 新增 `miniprogram/services/familyApi.ts`（或类似命名），封装上述 API 调用为 typed 函数。
- 金额单位：API 返回 cents（整数），前端展示时 ÷ 100 转元。
- 错误处理：网络失败 → Toast 提示，不阻塞页面渲染（降级为空态或缓存）。
- 非成员 403 → 不得静默吞掉，应提示并清理本地缓存。

### §3.3 缓存策略

- 首屏优先展示缓存 + 后台静默刷新（stale-while-revalidate 范式）。
- 缓存 key 以 `family_id + month` 为粒度。
- 切换家庭/月份时立即展示新缓存（如有），同时发起请求刷新。
- 退出/被移出后必须清理对应 family 缓存。

---

## §4 状态管理

### §4.1 页面 data 结构建议

```typescript
interface FamilyPageData {
  // 导航
  statusBarHeight: number;
  navBarHeight: number;

  // 模式
  mode: 'solo' | 'multi';

  // 家庭信息
  familyId: string;
  familyName: string;
  familyKind: 'personal' | 'shared';

  // 成员
  members: MemberItem[];       // 活跃成员（排前）+ 已退出（排后）
  isOwner: boolean;            // 当前用户是否为创建者

  // 时间维度
  currentMonth: string;        // 'YYYY-MM'
  dimension: 'monthly' | 'yearly';

  // 聚合数据
  summary: FamilySummary | null;
  loading: boolean;

  // 下钻
  expandedRow: string | null;  // 当前展开的行 key
}
```

### §4.2 family service 扩展

当前 `services/family.ts` 只管 active family context 存取。本卡需要：

- 新建 `services/familyApi.ts`：API 调用层。
- 可选扩展 `services/family.ts`：增加 family list cache / member cache 管理。
- 不得破坏现有 `setActiveFamily` / `getActiveFamilyId` 等接口。

---

## §5 交互实现要点

### §5.1 成员头像横滚

```wxml
<scroll-view scroll-x enhanced show-scrollbar="{{false}}" class="avatar-row">
  <view wx:for="{{members}}" ...>头像</view>
  <view class="invite-btn" bind:tap="onInvite">+</view>
</scroll-view>
```

- 不可使用 `flex-wrap: wrap`。
- scrollbar 必须隐藏。
- 已退出成员 `filter: grayscale(1); opacity: 0.4;`，`pointer-events: none;`（小程序用 `catchtap` 空处理）。

### §5.2 邀请流程

- 点击 `[+]` → 调用 `wx.shareAppMessage` 发送家庭邀请卡片。
- 若当前家庭邀请需先创建 invite 资源 → 先 `POST /v1/families/{id}/invites` 获取 invite_id / invite_code → 将 code 编入分享 path。
- 分享文案合规：不得诱导分享（微信审核红线）。

### §5.3 移出成员

- 仅创建者可操作（`isOwner === true`）。
- 点击他人头像 → `wx.showActionSheet` → 选择"移出家庭" → 二次确认 `wx.showModal` → `DELETE /v1/families/{id}/members/{user_id}` → 成功后刷新成员列表。
- 被移出者本地 context 如果仍是该 family → 清理并切回 personal family。

### §5.4 创建家庭

- Solo Landing 点击 CTA → `wx.showModal` 输入家庭名称 → `POST /v1/families` → 成功后切换 active family context → 刷新页面为 multi 态。

### §5.5 Segmented Bar

- 纯 CSS 实现（`display: flex` + 各段 `flex` 按金额比例）。
- 颜色：公共用微信绿 `#07C160`；各成员用不同灰度或预设色板。
- 空月份（总额 0）→ 不展示进度条，展示空态文案。

### §5.6 Accordion 下钻

- 点击公共支出行 / 成员个人行 → `expandedRow` toggle → 展开该行分类排行。
- 排行数据来自 `summary.category_rank`（API 已按金额降序排）。
- 仅展示 Top 6，超出显示 `还有 N 个较小支出未显示...`。
- 金额 0 的分类严格排除（前端 filter）。
- 再次点击收起。

### §5.7 月份切换

- `[<]` / `[>]` 切换上/下一个月。
- 可选点击中间 `2026年5月 ▼` 弹出 picker 快速跳月。
- 切月后重新请求 `GET /v1/families/{id}/summary?month=YYYY-MM`。
- 年度维度：`?month=YYYY`（或 API 预留 `dimension=yearly`，具体以 222 API 实际实现为准）。

---

## §6 禁止事项

| 编号 | 禁止 | 原因 |
|---|---|---|
| F1 | 不允许 fallback demo 成员冒充完成 | Sprint-04-06 plan §5.2 明确禁止 |
| F2 | 不允许本地硬编码 shared/personal 比例 | 必须接 COSTRA-222 API |
| F3 | 不允许对 design_spec 自创交互 | 设计文档唯一权威 |
| F4 | 不允许引入新 npm 图表库 | 当前是纯 CSS/WXML 实现（进度条 + 排行列表） |
| F5 | 不允许改动 `/server` 目录 | 本卡 scope = miniprogram only |
| F6 | 不允许 WebSocket / 实时推送 | Sprint-5 plan §5.4 明确不做 |
| F7 | 不得破坏现有 tabBar / 导航 / 登录 / 明细 / 记账 overlay | 回归保护 |

---

## §7 DoD（Definition of Done）

### §7.1 功能闭环

- [ ] Solo Landing 态正确展示（单人家庭用户）。
- [ ] Multi-Family 态正确展示（至少一个 shared family）。
- [ ] 成员横向滚动 + 已退出灰化。
- [ ] 邀请流程接真实 API（`POST /invites` + `wx.shareAppMessage`）。
- [ ] 移出成员流程接真实 API（仅 owner 可操作）。
- [ ] 创建家庭流程接真实 API。
- [ ] 月度 summary 数据正确展示（公共/个人/垫付/占比条）。
- [ ] Accordion 下钻展示分类排行榜。
- [ ] 月份切换（`[<]` `[>]` + 可选 picker）触发数据刷新。
- [ ] 空月份/空态展示符合设计规范（不使用卡通/插画）。

### §7.2 工程质量

- [ ] `npm run typecheck` 全绿。
- [ ] `npm run lint` 无新增 error。
- [ ] `npm run check:appjson` 通过（app.json 与文件系统一致）。
- [ ] 不破坏现有 99/99 测试。
- [ ] 新增 `services/familyApi.ts` 或等效模块，typed 接口。
- [ ] 代码结构清晰，组件职责单一。

### §7.3 设计还原

- [ ] 背景色、字号、颜色与 `design_spec.md §6.5` + `§2` 一致。
- [ ] 导航栏标题固定"家庭"。
- [ ] 成员头像样式与统计页成员指示器保持统一。
- [ ] 零值排除 + 长列表截断 + 省略提示。

### §7.4 联动验证

- [ ] 切换 active family 后，明细页数据自动切换（已有机制 via `services/family.ts`）。
- [ ] 记账 overlay 中 `记入: xxx ▼` 能正确反映新建的 shared family。

---

## §8 依赖与风险

| 依赖/风险 | 影响 | 缓解 |
|---|---|---|
| `COSTRA-221` API 已验证 PASS | 低 | 已 Human T1 APPROVED CLOSED |
| `COSTRA-222` API 已验证 PASS | 低 | 已 Human T1 APPROVED CLOSED，commit `6bf431b` |
| 年度维度 API 是否支持 `dimension=yearly` | 中 | 若 API 暂不支持，前端可先展示月度，年度入口降级为 coming soon |
| 微信分享卡片能力需真机调试 | 中 | 开发工具先 mock `wx.shareAppMessage`，真机阶段再联调 |
| `FU-220-SYNC-USER-ID-CREATED-BY` 未修 | 低 | 不阻塞家庭页主功能；仅影响"仅看自己"筛选精度 |

---

## §9 文件变更预估

| 操作 | 路径 | 说明 |
|---|---|---|
| **重写** | `miniprogram/pages/family/index.ts` | 从骨架升级为完整页面逻辑 |
| **重写** | `miniprogram/pages/family/index.wxml` | 完整页面模板 |
| **重写** | `miniprogram/pages/family/index.wxss` | 完整页面样式 |
| 可能修改 | `miniprogram/pages/family/index.json` | 可能需要引入组件 |
| **新建** | `miniprogram/services/familyApi.ts` | 家庭相关 API 调用层 |
| 可能扩展 | `miniprogram/services/family.ts` | 增加 family list / member cache |
| 可能新建 | `miniprogram/components/segmented-bar/` | 占比进度条组件（如独立封装） |
| 可能新建 | `miniprogram/components/member-avatar/` | 成员头像组件（统一复用） |

---

## §10 验收路径建议

1. **Card-Review**（下一步）：`card-review:COSTRA-223`（tech + product 双审）。
2. **Human start**：Card-Review PASS 后由 Human 触发 `start:COSTRA-223`。
3. **R1 实装**：spawn `costra-miniapp-dev`。
4. **R1 Review**：自动拉起 tech + product 双审。
5. **Human 真机验证**：在微信开发者工具 + 真机上验证完整流程。
6. **Human T1 终审**：`approve:COSTRA-223`。

---

## §11 关联卡片

| 卡号 | 关系 | 说明 |
|---|---|---|
| COSTRA-221 | 硬依赖 | 家庭管理 API（已 CLOSED） |
| COSTRA-222 | 硬依赖 | 家庭财务聚合 API（已 CLOSED） |
| COSTRA-220 | 前序 | 明细页真实数据 + family context service |
| COSTRA-224 | 后续 | 统计 API（复用 222 口径） |
| COSTRA-225 | 后续 | 统计页 UI（复用本卡成员头像/Accordion 组件） |
| FU-221-MEMBER-SNAPSHOT-ON-LEFT | 观察 | 退出成员 nickname/avatar 快照稳定性 |
