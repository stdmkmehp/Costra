# COSTRA-223 · 家庭页全新开发 / API 接入 · R1 实装

> **卡号**: COSTRA-223
> **类型**: feature (miniapp)
> **日期**: 2026-06-18
> **Owner**: costra-miniapp-dev
> **闸门**: typecheck ✅ · lint ✅ · check:appjson ✅ · test 99/99 ✅

---

## 1. 任务描述

实装 COSTRA-223 家庭页，包括：
- Solo Landing（单人引导态）+ Multi-Family（多人协作态）双模式
- 成员横滚 + 已退出灰化
- 邀请/移出/创建家庭接真实 API（COSTRA-221/222）
- 月度 summary（公共/个人/垫付/占比条/Accordion 下钻）
- 月份切换
- 空态合规
- Card-Review P2 Follow-up 四条全部兑现

## 2. 产出

| 操作 | 文件路径 | 说明 |
|---|---|---|
| **新建** | `miniprogram/services/familyApi.ts` | 家庭 API 调用层（typed 接口 + SWR 缓存 + 6 API 函数） |
| **重写** | `miniprogram/pages/family/index.ts` | 完整页面逻辑（~720 行 · Solo/Multi 两态 + 7 个交互 handler） |
| **重写** | `miniprogram/pages/family/index.wxml` | 完整页面模板（Solo 摘要/引导 + Multi 成员横滚/Segmented Bar/Accordion） |
| **重写** | `miniprogram/pages/family/index.wxss` | 完整页面样式（设计令牌对齐 + 成员灰化 + 8px 进度条 + 手风琴展开） |
| **更新** | `miniprogram/pages/family/index.json` | 保留 navigationStyle:custom + expense-overlay 组件 |

### 关键 API 接入

- `GET /v1/families` → 判断 solo/multi 模式 + 多家庭切换
- `GET /v1/families/{id}/summary?month=YYYY-MM&top_n=6` → 月度聚合数据
- `POST /v1/families` → 创建共享家庭
- `POST /v1/families/{id}/invites` → 创建邀请
- `DELETE /v1/families/{id}/members/{userId}` → 移出成员

### Card-Review P2 Follow-up 兑现

| P2 | 要求 | 实装 |
|---|---|---|
| P2-1 | 年度维度 API 不支持，R1 仅月度 | ✅ 不传 `dimension=yearly`，不展示年度 Tab |
| P2-2 | Segmented Bar 使用 `summary.segments[]` 驱动 | ✅ `segments[]` → `SegmentDisplay[]` → flex 比例渲染 |
| P2-3 | Solo Landing 复用 personal family summary API | ✅ Solo 态调用 `GET /families/{personal_family_id}/summary` |
| P2-4 | 多家庭切换：点击家庭名 → ActionSheet | ✅ `onTapFamilyName()` + `wx.showActionSheet` 复用明细页模式 |

## 3. 关键决策

1. **SWR 缓存策略**：`familyApi.ts` 内置 `stale-while-revalidate` 缓存，key = `familyId:month`，TTL 5min。网络失败降级返回缓存（若未过期）。
2. **Solo 态数据源**：复用 `GET /families/{personal_family_id}/summary`，不另立接口（P2-3 兑现）。
3. **成员排序**：活跃成员在前、已退出在后（与设计规范一致）。
4. **头像降级**：无 avatarUrl 时展示昵称首字圆形占位符，避免引用不存在的静态资源。
5. **年度维度**：完全隐藏，不展示 "月度/年度" Tab 切换（P2-1 API 不支持，不得传 `dimension=yearly`）。
6. **邀请流程**：先 `POST /invites` 获取 invite_code，再通过 `button open-type="share"` 触发 `onShareAppMessage`，将 invite_code 编入分享 path。
7. **零值排除**：前端 filter `amount === 0` 的 segments / categories，严格不展示零值项。
8. **长列表省略**：分类排行 API `top_n=6` 默认处理，前端额外判断 `hasMoreCategories` 展示省略提示。

## 4. 遗留

| 级别 | 项目 | 说明 |
|---|---|---|
| P2 | 邀请接受流程前端页 | `pages/entry/index` 需处理 `invite_code` 参数跳转家庭页（后续卡） |
| P2 | 金额千分位 | 家庭页金额暂无千分位格式化（与 COSTRA-204 遗留一致） |
| P3 | 年度维度 | API 扩展后（COSTRA-224），前端需添加年度 Tab + `dimension=yearly` |
| P3 | 真机分享调试 | `wx.shareAppMessage` 需真机验证，开发工具 mock 不可靠 |
| P3 | 家庭重命名 | API 已支持 `PATCH /families/{id}`，R1 未做 UI 入口 |

## 5. state.md diff

- §2 active tasks: 新增 `🔧 COSTRA-223`
- §3 交付历史索引: 新增 `2026-06-18 · history/2026-06-18-costra-223-family-page.md`
- §7 时间戳: 更新为 `2026-06-18T17:05:00+08:00`
