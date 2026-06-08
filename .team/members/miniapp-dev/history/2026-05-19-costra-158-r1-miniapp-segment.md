# COSTRA-158 R1 miniapp 段实装 · history

> 卡号：COSTRA-158 · 类型：feature · 角色：miniapp-dev（D-018 SBAI 装扮 · 单卡双装扮档第 2 段）
> 交付时间：2026-05-19T10:35:00+08:00

---

## 1. 任务描述

COSTRA-158 miniapp 段一次性装扮：3 项主交付（H/I/J）+ §2.4 追加 2 项（J'/G' 扩展）· 统一双装扮档单 commit（含 backend-dev 段 9 文件暂存）。

核心改动：将 COSTRA-157 的 `computeHasProfile` 间接判定（nickname 字符串比较 → 代理判定）替换为严格事实判定（`has_completed_profile` 布尔字段 → 事实判定）· 适配 server 新增的 `/users/me` GET+PATCH 路由 + K3 method-override 兜底。

## 2. 产出

| # | 文件路径 | 改动类型 | 净改行 | 说明 |
|---|---|---|---|---|
| H | `miniprogram/services/auth.ts` | 修订 | +18 | TokenRaw.user 加 `has_completed_profile: boolean` · mockExchange 加 `has_completed_profile: true`（含 P2-3 覆盖缺口注释）· 新增 `updateLocalUserProfile(partial)` 方法 |
| I | `miniprogram/utils/profile.ts` | 完全改写 | +14/-7 | UserLike 接口改为 `{ has_completed_profile?: boolean }` · `computeHasProfile` 改为 `return !!(u && u.has_completed_profile)` · 三段注释（157 旧/158 新/语义优势） |
| J | `miniprogram/pages/home/index.spec.ts` | 修订 | +13/-14 | 删除"nickname === defaultNickname → hasProfile=false"边界用例 · 新增 4 条 has_completed_profile 用例 |
| J' | `miniprogram/pages/login/index.ts` | 修订 | +2/-1 | import updateLocalUserProfile · PATCH 成功后调 `updateLocalUserProfile({ nickname, avatar_url, has_completed_profile: true })` |
| G' | `miniprogram/services/auth.spec.ts` | 修订 | +31/-2 | mockRaw.user 加 has_completed_profile:false · 新增 updateLocalUserProfile 测试组（2 测：成功更新 + null 安全） |

**合计**：5 文件 · +78 行 / -24 行 · 净增 54 行

**Commit**：`dd9b345` · 17 files changed, 616 insertions(+), 61 deletions(-)（含 backend-dev 段 9 文件 + follow-ups README + backend-dev state/history）

## 3. 关键决策

1. **`updateLocalUserProfile` 用 `wx.setStorageSync`**（非 async `setItem`）· 原因：PATCH 成功后的本地更新是内存 + storage 双写 · storage 用同步 API 符合 §2.1 硬约束 · 且不依赖 await（该调用在 login flow 的 try 块内 · 同步写入保证 home onShow gate 立即可读）
2. **mockExchange 设 `has_completed_profile: true`** · 原因：避免 mock 模式下"完善资料"入口常显 · 覆盖缺口由 Human 实测覆盖（Card-Review P2-3 修订）
3. **home.spec.ts 新增"nickname='张三' 但 has_completed_profile 未设置 → false"测** · 验证 158 语义：不再依赖 nickname · 只看事实字段

## 4. 遗留

- **P0**：无
- **P1**：无
- **P2**：FU-156-OUTBOX-FLAKY（pre-existing · 不阻本卡 · Sprint-3 头部修复）
- **观察**：G12 "mock 模式下 login → home 页不显示完善资料入口"无法自动断言 · 等 Human 实测覆盖（dispatch §9 步骤 2）

## 5. state.md diff

- §2 active tasks：移除 COSTRA-157 / COSTRA-105 · 改为 COSTRA-158 R1
- §3 交付历史索引：追加本条 `2026-05-19-costra-158-r1-miniapp-segment.md`
- §7 时间戳：追加 `2026-05-19T10:35:00+08:00`
