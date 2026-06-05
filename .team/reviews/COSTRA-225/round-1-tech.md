# Tech Review · COSTRA-225 · Round 1

> 本卡范围：COSTRA-225（统计页月度视角）+ COSTRA-226（年度视角）+ COSTRA-229（成员 swiper 框架）+ COSTRA-230（trend-line-chart 公共组件）四卡同 spawn 合并审。

- 被审 Agent：miniapp
- 本轮产出 commit：`4b0581a` + `ea105bf`
- 审核时间：2026-06-06T00:30:00+08:00
- 上轮结论：首轮

## 总评

- **Verdict**：`PASS`
- **总分**：31/35 分
- **阻塞点**：0 个 P0 / 0 个 P1 / 5 个 P2

## 维度得分

| 维度 | 得分 | 一句话 |
|---|---|---|
| 契约一致性 | 5/5 | 4 个 API 路径、全部请求/响应 TS 类型与 `server/api/openapi.yaml` schema 完全对齐；无新造错误码 |
| 架构与分层 | 5/5 | statisticsApi 封装 4 接口 + SWR 缓存层，page 仅做展示构建 + 交互逻辑，trend-line-chart 独立公共组件；严格在 `miniprogram/` 工作区内，无跨区写 |
| 数据与持久化 | 4/5 | 无 DB migration 涉及（纯前端）；SWR 缓存 TTL 5min + LRU 20 + page-lifetime drill 缓存合理；金额全链路 cents → `toYuan` ÷ 100 精确转换（ADR-0002）；扣 1 分因 swiper height 硬编码 1800rpx 未自适应内容长度 |
| 离线与同步 | 5/5 | SYNC_DONE / ENTRY_SAVED / ENTRY_UPDATED 三事件订阅 + onUnload 取消（防泄漏）；SWR 先缓存后网络双渲染；invalidateStatisticsCache 清 monthly + yearly + drill 三缓存；展开态收起避免陈旧 L2/L3 |
| 安全与合规 | 5/5 | 无 session_key / openid / token 日志泄漏；无 console.log/warn/debug；console.error 仅在 catch 块用于诊断（不含敏感数据）；无硬编码主体字样；无 AppID 泄漏 |
| 可测与可观测 | 4/5 | typecheck 0 / vitest 113/113 / eslint 0 / appjson + tooling + whitelist 全绿；结构化错误提示（wx.showToast）；console.error 带 `[statistics]` tag 可追踪；扣 1 分因缺少 statisticsApi 单测（缓存逻辑/LRU 淘汰/invalidate 可独立测试） |
| 工程纪律 | 4/5 | Conventional Commits + `Refs: COSTRA-225, COSTRA-226, COSTRA-229`；index.ts 760 行 / index.wxss 545 行 超 500 行治理建议线（-1 分 per 项目惯例 P2 记录）；仅 1 处 TODO 明确归属后续卡 |

## P0 阻塞点（必改）

无

## P1 应改

无

## P2 建议

### P2-1 · index.ts 760 行超 500 行治理建议阈值

- **证据**：`miniprogram/pages/statistics/index.ts`（760 行 · `wc -l` 实测）
- **问题**：超出工程约束建议的 500 行治理线。月度/年度展示构建 + 三层下钻交互逻辑集中在单文件中。
- **依据**：engineering-guidelines + D-018 SBAI §3.7（>500 行 -1 分）
- **修复建议**：后续可将辅助函数（`fmtAmount` / `fmtYuan` / 时间格式化）、display builder（`_buildMonthlyDisplay` / `_buildYearlyDisplay`）抽取到 `pages/statistics/helpers.ts`；考虑到 ledger 1450 行 / family 1272 行已存在且未被 reject，当前 760 行属于项目合理范围，记为 follow-up。

### P2-2 · index.wxss 545 行轻微超线

- **证据**：`miniprogram/pages/statistics/index.wxss`（545 行 · `wc -l`）
- **问题**：超出 500 行治理线 45 行。
- **依据**：同 P2-1
- **修复建议**：可将 L2/L3 嵌套样式抽取到 `pages/statistics/drill-down.wxss` 通过 `@import` 引入；当前超出幅度小，优先级低。

### P2-3 · swiper inline style 存在冗余三目表达式

- **证据**：`miniprogram/pages/statistics/index.wxml:99`
  ```
  style="height: {{dimension === 'monthly' ? 'auto' : 'auto'}};"
  ```
- **问题**：两个分支值相同（`auto`），属于死代码 / 开发残留；且微信 swiper 不支持 `height: auto`，实际生效的是 wxss 中 `.stat-swiper { height: 1800rpx; }` 的类样式。
- **依据**：代码清洁原则
- **修复建议**：删除该 inline style 属性，直接依赖 wxss 类定义高度；或后续实现动态高度计算（wx:if 选择不同高度值）。

### P2-4 · trend-line-chart 每次 _draw 调用 wx.getSystemInfoSync

- **证据**：`miniprogram/components/trend-line-chart/index.ts:107`
  ```
  const dpr = wx.getSystemInfoSync().pixelRatio || 1;
  ```
- **问题**：observers 每次触发都同步调用 `getSystemInfoSync`，虽然对低频重绘（data 变更时）影响可忽略，但属于非必要同步阻塞。
- **依据**：微信官方建议减少同步 API 调用
- **修复建议**：在 `attached()` 或 `ready()` 中缓存 `this._dpr`，`_draw()` 中直接使用缓存值。

### P2-5 · statisticsApi 缓存逻辑无独立单测覆盖

- **证据**：`miniprogram/services/statisticsApi.ts`（293 行 · 含 SWR 缓存 + LRU 淘汰 + invalidate 逻辑）
- **问题**：LRU 淘汰（setCacheLRU）、TTL 过期判断、invalidateStatisticsCache 按 familyId 前缀清理——这些边界行为可独立测试但当前无覆盖。
- **依据**：tech-spec §4.2 "验收标准" + 可测性维度
- **修复建议**：后续 Sprint 补充 `statisticsApi.spec.ts`，测试 LRU size=20 淘汰、TTL 5min 过期、invalidate 按 familyId 隔离等边界。当前 Sprint-1 允许"可测设计 + 用例清单"替代完整测试。

## 与上轮的差异（N ≥ 2 才写）

N/A（首轮）

## 给被审 Agent 的回执指令

Orchestrator 拉起 miniapp-dev 时，请附上本文件全文，并要求其：
1. 无 P0/P1 需修复
2. P2 全部记入下一 Sprint backlog（建议优先级：P2-3 最快可修 → P2-4 → P2-5 → P2-1 → P2-2）
3. 当前产出已满足 DoD，可进入 Human 验收

## 自我反思

- 本次审核耗时估计：18 分钟
- 置信度：高
- 理由：
  - 全部 7 维度证据链完整（typecheck/vitest/eslint/appjson 全绿 + OpenAPI 逐字段对齐 + 安全扫描 0 违规）
  - 被审代码严格遵循项目已建立的范式（bootstrapPromise gate / markActive / SYNC_DONE 订阅 / toYuan 金额转换 / eventBus on/off 对称）
  - 文件行数虽超 500 但远低于项目已通过审查的同级页面（ledger 1450 / family 1272），不构成阻塞
  - 设计文档 tech-spec.md 与实装完全对齐，三层下钻、列表省略、SWR 缓存、成员 swiper 框架均按设计落地
