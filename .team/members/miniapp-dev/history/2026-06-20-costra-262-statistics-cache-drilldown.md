# COSTRA-262 · 统计页成员维度缓存生命周期与下钻独立性收尾

- **task_type**: feature
- **日期**: 2026-06-20
- **commit**: `c171155`
- **分支**: dev

---

## 1. 任务描述

接续 COSTRA-261（commit `7dac27b`），完成统计页成员维度的三个 P1 遗留：
1. 类型抽出到独立文件减少 index.ts 体积
2. 失效策略细化：区分 scope 变更（全清）vs 数据变更（仅 invalidate）
3. 下钻独立性精细打磨：审查确认 onTapL1/onTapL2 的 memberkey 隔离、异步竞态防护
4. 技术文档 §4.7 追加 R2 成员维度横滑切换说明

## 2. 产出

| 文件 | 变更类型 | 说明 |
|------|----------|------|
| `miniprogram/pages/statistics/types.ts` | **新建** | 抽出 8 个 interface/type（MemberKey, MemberTabItem, MonthlyView, YearlyView, MonthRow, L1Display, L2Display, L3Display, SummaryGridItem） |
| `miniprogram/pages/statistics/index.ts` | 修改 | 移除内联类型定义 → import from './types' + 重写 _onSyncDone → _invalidateCurrentDimViews + 补充 _clearCurrentDimViews 注释 |
| `docs/design/statistics-page-tech-spec.md` | 修改 | §4.7 追加 R2 成员维度横滑切换 tech spec |

**行数变化**: 3 files, +155/-131  
**index.ts 体积**: 1013 行 → 919 行（减少 94 行）

## 3. 关键决策

### 3.1 失效策略拆分

| 场景 | 方法 | 行为 |
|------|------|------|
| scope 变更（切月/年/账本） | `_clearCurrentDimViews()` | 全清 byMember → 旧数据属于别的 scope |
| 数据变更（SYNC_DONE/ENTRY_SAVED/ENTRY_UPDATED） | `_invalidateCurrentDimViews()` | 仅标记所有成员 `loaded: false`（不清空视图 → 保留展开态视觉） |
| 维度切换（月度↔年度） | 不动 byMember | 各维度独立缓存 |
| 成员切换（Tab/横滑） | 不动 byMember | 各成员独立缓存 |

**核心语义**：SYNC_DONE 时，非当前成员 pane 上如果有展开的 L1/L2，用户滑过去时会看到旧的视觉（不闪空白），然后 `_ensureMemberLoaded` 检测 `loaded===false` 后台重拉更新。

### 3.2 下钻独立性已确认完备（261 代码审查结论）

1. **memberKey 来源**：`e.currentTarget.dataset.memberkey`（wxml `data-memberkey="{{member.key}}"`）→ 不依赖 `this.data.memberTabIndex`
2. **写入路径严格隔离**：`${dimKey}.${memberKey}.l1` → 不会交叉污染
3. **drill-down API 传 userId**：`memberKey === 'all' ? undefined : memberKey`
4. **异步竞态防护**：`const latestView = ...; if (!latestView) return;` → 账本/月份切换后 view 被清空时安全跳过
5. **事件冒泡防护**：L2 用 `catch:tap="onTapL2"`，L3 用 `catch:tap="noop"`（monthly + yearly 两个 pane 模板都有）

### 3.3 _ensureMemberLoaded 适配

当前实现：`if (view && view.loaded) return;` → 如果 view 存在但 loaded=false（invalidate 场景），会触发重拉。重拉时 `_loadMonthlyForMember` 先 `viewInit.loading = true` 再 setData → 完成后 `loaded: true, loading: false`。失败时保持 `loaded: false, loading: false`。

## 4. 遗留

- 无 P0/P1 遗留
- P2 观察：`_invalidateCurrentDimViews` 中 `for (const mk of Object.keys(byMember))` 在成员极多时（如 20+）可能一次 setData 路径较多，但实际场景家庭成员不超过 10 人，不构成性能问题

## 5. state.md diff

- §2: 新增 COSTRA-262 ✅ 条目
- §3: 新增 history 索引条目
- §7: 时间戳更新为 2026-06-20T21:10:00+08:00
