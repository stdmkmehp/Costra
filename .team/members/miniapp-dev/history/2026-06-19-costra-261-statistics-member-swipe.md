# COSTRA-261 · 统计页成员维度横滑切换框架改造

- **task_type**: feature
- **date**: 2026-06-19
- **commit**: `7dac27b`
- **status**: ✅ 交付（等 review-tech R1）

---

## 1. 任务描述

前端统计页（Tab2）实现成员维度横滑切换功能。多人家庭账本中，页面顶部显示 `[全部 | 我 | A | B | ...]` 指示器条，数据区水平滑动比对各成员消费报表。对接后端 COSTRA-260 新增的 `user_id` query 参数。

## 2. 产出

| 文件 | 变更 |
|------|------|
| `miniprogram/utils/memberColor.ts` | **新建** · 抽出 MEMBER_COLOR_SLOTS(10色) + getMemberColorBySlot helper |
| `miniprogram/services/statisticsApi.ts` | 4 API 函数(monthly/yearly/drillL2/drillL3)加 userId 选项 + 缓存 key 拼 user 段 + MonthlyStatistics/YearlyStatistics 加 filtered_user_id |
| `miniprogram/pages/statistics/index.ts` | **全面重构** · byMember 数据结构 + 懒加载 + scroll 节流 + 成员 tab 排序(D5) |
| `miniprogram/pages/statistics/index.wxml` | 成员指示器条(scroll-view scroll-x) + 横向 scroll-view(scroll-snap) + include 模板引入 |
| `miniprogram/pages/statistics/tpl-monthly-pane.wxml` | **新建** · 月度数据 pane 模板 |
| `miniprogram/pages/statistics/tpl-yearly-pane.wxml` | **新建** · 年度数据 pane 模板 |
| `miniprogram/pages/statistics/index.wxss` | 删旧 .member-tabs → 新 .member-strip + .member-pages + .pane-loading |
| `miniprogram/pages/family/index.ts` | 删本地色板拷贝 → import from utils/memberColor |

合计 8 文件 · +896 / -520 行

## 3. 关键决策

| # | 决策 | 理由 |
|---|------|------|
| D2 | 用 `<scroll-view scroll-x>` + `scroll-snap-type: x mandatory` 替代 swiper | swiper 必须定高，与下钻列表可变高度冲突（2026-06-06 踩坑记录） |
| D5 | 成员条排序：全部→自己→active(color_slot升序)→left(left_at升序) | 与用户确认的业务决策一致 |
| D6 | 缓存 key 拼 userId 段: `${familyId}:${month}:${userId ?? 'all'}` | 避免不同成员维度的数据互相覆盖 |
| D7 | 单人账本不显示指示器条与横向 scroll-view | `wx:if="{{familyKind === 'shared' && memberTabs.length > 1}}"` 无 regression |
| 横滑节流 | `Math.round(scrollLeft / windowWidthPx)` + `_lastScrollHandledIdx` 防抖 | 避免同一 pane idx 重复触发 setData 引起 UI 抖动 |
| 模板拆分 | `<include>` 引入 tpl-monthly-pane / tpl-yearly-pane | 减少主 wxml 文件大小，复用在多人/单人两条路径中 |

## 4. 遗留

- **COSTRA-262** 收尾：
  - 下钻独立性精细打磨（onTapL1/L2 严格只动当前 memberKey 子树）
  - 切月/年/账本/SYNC_DONE 失效策略细化
  - 类型抽到 `pages/statistics/types.ts`

## 5. state.md diff

- §2: 新增 COSTRA-261 ✅ 条目
- §3: 新增 history 索引行
- §7: 时间戳更新到 2026-06-19T21:00:00+08:00
