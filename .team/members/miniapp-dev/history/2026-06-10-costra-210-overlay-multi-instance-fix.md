# COSTRA-210 · 修复记账覆盖层多实例状态残留导致切Tab误弹出

> 日期: 2026-06-10
> 角色: miniapp-dev（SBAI v1.1）
> task_type: fix
> commit: `51ccd92`

---

## 任务描述

修复记账覆盖层（expense-overlay）在多 Tab 页实例间状态不同步导致的误弹出 bug。

**复现路径**：
1. 登录后 → 点家庭 Tab
2. 点 [+] 记账按钮
3. 点取消关闭记账页
4. 再点明细 Tab

**实际行为**：明细页不应弹出记账页面，但出现残留 overlay。

**根因分析**：
- 各 Tab 页都挂载 `<expense-overlay/>`，ledger/family/statistics/mine 各有一个独立实例
- 点击 [+] 时 `eventBus.emit(SHOW_EXPENSE_OVERLAY)` 是广播，所有 overlay 实例都执行 `_show()`，全部 `visible=true`
- 用户在某页点取消只关闭当前实例 + emit HIDE
- 但 overlay 实例本身不订阅 HIDE 事件，后台实例依然 `visible=true`
- 切到其他 Tab 时，该 Tab 的 overlay 实例立刻显示，造成误弹出

---

## 产出

### 修改文件（2 文件，+28/-8）

| 文件 | 改动 |
|------|------|
| `miniprogram/components/expense-overlay/index.ts` | **方案 A**：`attached()` 新增 HIDE 事件订阅，`detached()` 取消订阅；HIDE handler 同步 setData 关闭所有状态 |
| `miniprogram/custom-tab-bar/index.ts` | **方案 C**：普通 Tab 切换（非 index===2）时，`wx.switchTab` 前防御性 emit HIDE_EXPENSE_OVERLAY |

### 验证结果

- ✅ `npx tsc --noEmit` — 0 错误
- ✅ `npm run lint` — 0 错误
- ✅ husky pre-commit hooks 全绿
- ✅ commit message footer 含 `Refs: COSTRA-210`

---

## 关键决策

1. **双保险策略**：同时执行方案 A + 方案 C，确保无论从哪个路径触发关闭都能覆盖：
   - **方案 A（overlay 订阅 HIDE）**：解决 onClose() / _saveEntry() 发出 HIDE 后其他实例不响应的问题
   - **方案 C（tab-bar 切前 emit HIDE）**：解决用户直接切 Tab 未经过 onClose 的场景（如覆盖层打开后直接点 Tab 切走）

2. **index===2 排除**：点击 [+] 按钮时不执行防御性 HIDE（因为紧接着要 SHOW），避免无意义的状态抖动

3. **HIDE handler 重置完整状态**：不仅设 `visible=false`，还同步重置 `keypadVisible`、`noteFocused`、`saving`，防止部分 UI 状态残留

4. **onClose() 行为不变**：保留先 setData 再 emit HIDE 的顺序；HIDE 广播后当前实例会再次 setData false，无害幂等操作

---

## 遗留

- 无 P0/P1/P2 遗留。本卡为纯 bug fix，双保险方案已完整覆盖所有残留路径。
- 建议实测验证复现路径（家庭→记账→取消→明細）不再误弹出。

---

## state.md diff

### §2 active tasks 新增
```
- 🔧 **COSTRA-210 修复记账覆盖层多实例状态残留导致切Tab误弹出**
```

### §3 交付历史索引新增
```
- **2026-06-10** · `history/2026-06-10-costra-210-overlay-multi-instance-fix.md`
```

### §7 时间戳更新
```
- **2026-06-10T16:00:00+08:00** · COSTRA-210 交付（commit `51ccd92`）
```
