# Costra · 后续 Sprint 规划留档（Family First）

> 记录时间：2026-06-01 19:10  
> 触发：Human 指示暂停本对话继续开发，将统计页/家庭页/我的页与当前及未来 Sprint 结合规划；**家庭页优先级高于统计页**。

---

## 1. 当前基线

已完成并进入当前工作基线：

- B1/B2：分类二级 schema + `entries.shared_type`（COSTRA-217）
- B3：后端分类 API（COSTRA-218）
- B4：前端分类数据模型替换 hardcode（COSTRA-219）
- C2：明细页真实数据完善（COSTRA-220）
- 明细页 UI 小修：空状态图标删除、条目行高/对齐、头部支出负号与字号调整

---

## 2. 优先级裁决

原路线中 `D1 + C4 统计页` 排在 `D2/D3 + C5 家庭页` 前面。现按 Human 新指令调整：

```text
家庭页优先级 > 统计页优先级 > 我的页优先级
```

原因：

1. 家庭页承接 Costra 的核心差异化：家庭协作、公共/个人支出、成员贡献。
2. 统计页与家庭页存在数据依赖：家庭页先定义成员、家庭上下文、公共/个人拆解口径，后续统计页复用该口径更稳。
3. 明细页 C2 已暴露成员筛选、头像、退出成员灰化等依赖，需由家庭域 API 和家庭页先补齐。

---

## 3. 调整后的推荐路线

```text
当前收尾：C2 明细页 UI/交互小修与稳定
  → D2 家庭管理 API（family list / members / invite / accept / remove）
  → D3 家庭财务聚合 API（公共 vs 个人、垫付贡献、成员聚合）
  → C5 家庭页全新开发（优先）
  → D1 月度/年度统计报表 API
  → C4 统计页全新开发
  → C6 我的页重做
  → E1/E2 联调与旧逻辑清理
```

---

## 4. 建议卡拆分

### Sprint-Family-1：家庭域后端基础

#### COSTRA-221 · D2 家庭管理 API

Owner: backend-dev  
优先级: P0

范围：

- `GET /v1/families`：当前用户可见家庭列表（personal/shared）
- `GET /v1/families/{family_id}/members`：成员列表（含 active/left 状态、头像、昵称、role）
- `POST /v1/families`：创建 shared family
- `POST /v1/families/{family_id}/invites`：创建邀请
- `POST /v1/family-invites/{invite_id}/accept`：接受邀请
- `DELETE /v1/families/{family_id}/members/{user_id}`：移出成员 / 成员退出

验收重点：

- personal family 不可删除/不可邀请
- 非成员不可读取成员列表
- left_at 成员保留历史展示所需信息
- clean rebuild 阶段不做历史兼容

#### COSTRA-222 · D3 家庭财务聚合 API

Owner: backend-dev  
优先级: P0

范围：

- `GET /v1/families/{family_id}/summary?month=YYYY-MM`
- 返回公共支出、个人支出、成员支出、成员垫付贡献、收入/结余基础汇总
- 口径必须复用 `entries.shared_type`：
  - `shared`：家庭公共支出
  - `personal`：个人支出
  - income 不参与公共收入（当前产品无公共收入概念）

验收重点：

- 与明细页本地汇总口径一致
- 成员退出后历史贡献仍可展示但置灰
- 金额全部 cents 整数，前端展示再格式化

---

### Sprint-Family-2：家庭页前端优先落地

#### COSTRA-223 · C5 家庭页全新开发

Owner: miniapp-dev  
优先级: P0

范围：

- 单人引导态：说明家庭协作价值 + 创建/加入入口
- 多人家庭协作态：家庭名、成员横向滚动、成员状态
- 已退出成员灰化：头像黑白灰度 + opacity 0.4 + 不可交互
- 公共/个人支出拆解
- 垫付贡献/成员聚合
- 与明细页联动：明细页成员筛选、头像展示复用家庭成员缓存

设计约束：

- 严格遵循 `design/ui/design_spec.md`，暖灰白背景、油墨黑文字、克制卡片/分组
- 不引入彩色图表堆砌
- 家庭页是协作页，不是统计页，不做复杂趋势图

---

### Sprint-Stats：统计页在家庭口径稳定后开发

#### COSTRA-224 · D1 月度/年度统计报表 API

Owner: backend-dev  
优先级: P1（排在家庭页后）

范围：

- 月度/年度趋势
- 分类排行
- 成员维度筛选（复用 D2 成员列表）
- 零值排除
- 公共/个人支出口径复用 D3

#### COSTRA-225 · C4 统计页全新开发

Owner: miniapp-dev  
优先级: P1

范围：

- 月度/年度切换
- 单色趋势图
- 摘要网格
- 排行榜 + 手风琴 + 零值排除
- 成员横向切换

---

### Sprint-Mine：我的页收尾

#### COSTRA-226 · C6 我的页重做

Owner: miniapp-dev  
优先级: P2

范围：

- 极简名片
- 记账天数
- 宏观数据总览
- iOS/WeUI 分组菜单
- 账号/隐私/关于入口

---

## 5. 下次对话建议开场指令

```text
继续 Costra 项目。当前 B1/B2/B3/B4/C2 已完成；后续路线按 Family First 调整：家庭页优先级高于统计页。请按 Orchestrator 规范，从 D2 家庭管理 API 和 D3 家庭财务聚合 API 开始规划和执行，为 C5 家庭页铺底。Orchestrator 不得直接改业务代码。开发阶段不考虑历史兼容，DB 按清空重建维护。
```

---

## 6. 注意事项

1. Orchestrator 继续只负责规划/dispatch/spawn，不直接改业务代码。
2. backend-dev 先补家庭 API，再 miniapp-dev 做家庭页；避免前端再次大量 stub。
3. 家庭成员数据是明细页 C2 遗留问题的上游：成员头像、已退出成员灰化、仅看他人等，应在 D2/C5 后回填明细页。
4. 统计页必须等 D3 家庭聚合口径稳定后再做，避免返工。
