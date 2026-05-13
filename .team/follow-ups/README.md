# Follow-ups · Review 延后项登记

> 登记规则：Review-Agent 判为 P2（不阻断当卡）且被审 Agent 采纳"延后到后续 Sprint 处理"的条目集中登记于此，供 Sprint Planning 会议扫描认领。
>
> **维护人**：Orchestrator（在 `{Agent}-Revision-Response` 产出时同步写入本索引）
> **消费方**：PM-Agent（Sprint Planning 扫描 → 纳入新卡或并入相关卡）
>
> **状态字段**：
> - `open` — 待 Sprint 认领
> - `scoped` — 已认领到某卡/某 Sprint（填 `owner_card`）
> - `closed` — 已完成（填 `resolved_by` commit / 卡号）
> - `open-observation` — 观察项 · 不阻塞 · 等触发条件
> - `degraded-to-p3-observe` — 从原优先级降级为 P3 观察 · 留 Sprint+ 验证
>
> **隐性铁律**：Human 实测未通过前 FU 不真 closed（FU-LAUNCH 族 4 次定性翻转积累的硬约束）

---

## 📚 归档索引

- **Sprint-1 期间已闭合 FU**（13 条 · 含同族规约盲区 5 连 + FU-LAUNCH 族 4 卡）→ [`_archive/follow-ups-closed-sprint-1.md`](../_archive/follow-ups-closed-sprint-1.md)
- 完整治理叙事（v1→v5 翻转链 / D-017 SOP 立案 / CI 对账族三代）原文亦在归档文件中

---

## 🟡 当前 open FU 速查表（14 条）

按主题族 + 推动优先级排序：

| 主题族 | FU-ID | 优先级 | 候选卡 / 归属 | 状态 |
|---|---|---|---|---|
| **Sprint-3 同步协议核心** | FU-104-SYNC-PULL | **P0** | COSTRA-154 | open |
| **Sprint-3 同步协议核心** | FU-105-CLIENT-SERVER-URL-PREFIX-MISMATCH | **P0** | COSTRA-156 | open |
| **Sprint-3 同步协议核心** | FU-103-CLIENT-SYNC-SCHEDULER | P1 | COSTRA-150 | open |
| **Sprint-3 同步协议核心** | FU-104-ENTRIES-PATCH | P1 | COSTRA-152 | open |
| **Sprint-3 同步协议核心** | FU-104-ENTRIES-DELETE | P1 | COSTRA-153 | open |
| **Sprint-3 同步协议核心** | FU-103-CONFLICT-MERGE-UI | P2 | COSTRA-151 | open |
| **Epic-F 用户资料** | FU-001 | P2 | Sprint-2 Epic-F | open |
| **Epic-F 用户资料** | FU-118-2 | P2 | 合 FU-001 | open |
| **Epic-F 用户资料** | FU-102-PROFILE-REFUSE-UI | P2 | Sprint-2 Epic-F | open |
| **Epic-F 用户资料** | FU-102-ERROR-MAPPER-INTEGRATION | P1 | Sprint-2 Epic-F 或单独修 | open |
| **Epic-F 用户资料** | FU-102-AVATAR-ONERROR | P1 | Sprint-2 Epic-F 或单独修 | open |
| **DevOps 基建** | FU-118-3（→ COSTRA-160）| P0 根因 / P2 优先级 | COSTRA-160 | open |
| **DevOps 基建** | FU-118-5 | P2 | 合 COSTRA-903 APM | open |
| **DevOps 基建** | FU-CI-MP-BUILD-NPM-ENFORCE | P2 | Sprint-2 CI 升级 | open |
| **DevOps 基建** | FU-LIBVERSION-DEV-GUARD | P3 | Sprint-2 候选 | open |
| **DevOps 基建** | FU-118-4 | P2 | Sprint-2 Retro 末批 | open |
| **DB 治理** | FU-DB-OPS-AUDIT | P3 | DAU>100 触发 | open |
| **协议 / 规约残留** | FU-102-SYNC-PULL-DRIFT | INFO | 已并入 COSTRA-106 Retro | open |
| **协议 / 规约残留** | FU-COMMON-MINIAPP-PATCH-LIMIT | O 观察 | engineering-guidelines / common-contract | open-observation |
| **协议 / 规约残留** | FU-118-1 | P3 观察 | engineering-guidelines §2.5 | open-observation |
| **协议 / 规约残留** | FU-102-HUMAN-VERIFY-PARADIGM | INFO | 已并入 COSTRA-106 Retro | open |
| **QA 自动化** | FU-105-AUTOMATION-FULL-COVERAGE | P2 | COSTRA-155 | open |
| **Review 机制** | FU-REVIEW-TECH-RUNTIME-DIM | P0（已部分兑现）| 已并入 COSTRA-106 Retro D-022 | open |
| **外部触发** | FU-115-2 | O 观察 | Human ICP 下证日触发 | open |

> 注：FU-102-SYNC-PULL-DRIFT / FU-102-HUMAN-VERIFY-PARADIGM / FU-REVIEW-TECH-RUNTIME-DIM 已在 COSTRA-106 Sprint-1 Retro（2026-05-09 闭环）中议过 · 但条目本身未正式 close · 实务上视为"议题已沉淀 D-020/D-021/D-022 三决议 · FU 文档登记可在下次维护批次同步关闭"

---

## 登记列表（按主题族分组）

---

## 🚀 族 A · Sprint-3 同步协议核心（6 条 · 强联动 · 必须打包做）

### FU-104-SYNC-PULL · GET /sync/pull 增量拉取实装（替代 R1 stub 501 · PRD AC-4 核心）

- **来源**：2026-05-11 14:00 COSTRA-104 R1 切出去铁律（dispatch §2.2 · Q1.2 拍板 3 张独立卡）
- **登记时间**：2026-05-11
- **范围**：实装 `GET /sync/pull?since=<watermark>&limit=N` · 返回增量 changes + 新 watermark · 协议 §3 + §6.3 · 客户端 db.ts setWatermark 落 storage
- **协议事实源**：`server/api/openapi.yaml` paths /sync/pull + `docs/api/sync-protocol.md` §3 + §6.3
- **依赖**：COSTRA-104 R1 已实装 entries 表 + audit_logs 表（watermark 推进基础）
- **PRD 锚点**：PRD AC-4「无网也能保存 → 写入本地队列 → 联网后自动上传 + 多设备增量同步」
- **阻断级别**：**P0**（PRD 核心承诺 + FU-103 调度器无 pull 即 client watermark 永远空）
- **认领建议**：Sprint-3 头部（COSTRA-154 · 估 5 点 · **与 COSTRA-150 client 调度器一同做才有意义**）
- **状态**：`open`
- **owner_card**：COSTRA-154（待 Sprint-3 Planning 认领）

### FU-103-CLIENT-SYNC-SCHEDULER · client 端同步调度器（onShow / 网络恢复 / 周期 / 启动触发 pushDelta + syncPull）

- **来源**：2026-05-09 19:05 Human 模拟器实测 COSTRA-103 R1 步骤 D（无 POST）+ 步骤 E（watermark 空 · `keys.filter(k => k.startsWith('watermark:'))` = `[]`）
- **登记时间**：2026-05-09 19:10（COSTRA-103 R1 Tech APPROVE 后同手册修订一并登记）
- **范围**：
  - **触发时机**：① `App.onLaunch` / `Page.onShow` ② `wx.onNetworkStatusChange isConnected:true` ③ 周期 setInterval（10s · 兑现 PRD「联网 10s 自动推送」）④ 用户主动下拉刷新
  - **调度 API**：`pushDelta()`（已实装 · `miniprogram/services/sync.ts:74`）+ `syncPull(family_id, since)`（已实装 · `miniprogram/services/sync.ts:43`）+ push/pull 互斥锁（协议 §6.1）
  - **观测**：watermark 落到 storage `watermark:{family_id}` key · `entry:__index` 在 server 推送 changes 后被 `applyServerChanges` 同步
  - **兜底**：网络失败 catch → outbox 整批留 + idempotency_key 不变 + 下次重试（已实装）
- **依赖**：
  - **必须**：COSTRA-104（server `/sync/push` + `/sync/pull` 端点 + ErrorCode + idempotency_keys 实装稳定）
  - **建议**：COSTRA-103 R1 已落 syncPush/syncPull 函数体（不接调度器）· 本 FU 仅补"调度器"层（即 onShow/onNetworkStatusChange/setInterval 的 wire-up）
- **PRD 锚点**：
  - PRD AC-4：「无网也能保存 → 写入本地队列 → 联网后自动上传」
  - sync-protocol.md §6.1：push/pull 互斥锁
  - sync-protocol.md §6.3：watermark 单调推进
- **阻断级别**：P1（PRD 核心承诺 · 当前由 R1 dispatch 明示推迟 · 不阻 COSTRA-103 R1 终审）
- **认领建议**：Sprint-3 头部（COSTRA-104 server 稳定后立卡 · 估 5 点 · 候选卡号 COSTRA-150）
- **状态**：`open`
- **owner_card**：COSTRA-150（待 Sprint-3 Planning 认领）
- **不阻塞 COSTRA-103 终审依据**：D-022 v2.0 评分表 38/40 APPROVE · Human 实测 5 步 + 5 硬断言全 PASS（H1 sync API 0 / H2 outbox 多 key / H3 snake_case / H4 client_ref_id 持久 / H5 ensureVersion + lib 3.8+）· R1 dispatch §2 明示"COSTRA-104 接调度器"

### FU-104-ENTRIES-PATCH · PATCH /entries/{entry_id} 实装（替代 R1 stub 501）

- **来源**：2026-05-11 14:00 COSTRA-104 R1 切出去铁律（dispatch §2.2 · Q1.2 拍板 3 张独立卡）
- **范围**：实装 `PATCH /entries/{entry_id}` 端点 · 支持部分字段更新（amount/note/category_id/...）+ 乐观锁（base_version 头部）+ 触发 outbox 同步 · 替代 R1 stub 501
- **协议事实源**：`server/api/openapi.yaml` paths /entries/{entry_id} PATCH 完整定义 + EntryUpdate schema
- **依赖**：COSTRA-104 R1 已实装 entryService（findById/optimisticUpdate 工具方法可复用）
- **PRD 锚点**：用户记一笔后修改场景 · 高频
- **阻断级别**：P1（不阻 MVP · 但用户体验缺口）
- **认领建议**：Sprint-3 头部（COSTRA-152 · 估 3 点）
- **状态**：`open`
- **owner_card**：COSTRA-152（已在 backlog.json 占位）

### FU-104-ENTRIES-DELETE · DELETE /entries/{entry_id} 软删实装（替代 R1 stub 501）

- **来源**：同 FU-104-ENTRIES-PATCH
- **范围**：实装 `DELETE /entries/{entry_id}` 端点 · 软删（设 `deleted_at` 列）+ 触发 outbox 同步删除事件 · 客户端 syncPull 时收到 deleted_at 不为空的 entry 后从 db 移除
- **协议事实源**：`server/api/openapi.yaml` paths /entries/{entry_id} DELETE
- **依赖**：COSTRA-104 R1 已建表 entries.deleted_at 列 + entryService 已有 softDelete 工具方法（部分实装）
- **阻断级别**：P1（同 PATCH）
- **认领建议**：Sprint-3 头部（COSTRA-153 · 估 2 点 · 比 PATCH 简单）
- **状态**：`open`
- **owner_card**：COSTRA-153（已在 backlog.json 占位）

### FU-103-CONFLICT-MERGE-UI · 真实 conflict 合并 UI（替代 R1 mergeIntoConflictQueue 桩）

- **来源**：2026-05-09 同 FU-103-CLIENT-SYNC-SCHEDULER 同根因（PRD AC-4 离线优先架构最后一公里）
- **登记时间**：2026-05-09 19:10
- **范围**：
  - 替换 `miniprogram/services/outbox.ts` 当前的"立即重试 next_retry_at = now+1"消极策略（仅 R1 桩）
  - 实装真实合并 UI：`mergeIntoConflictQueue(op, server_state)` → 用户可视化 server 版本 vs client 版本 → 三选一（保留服务端 / 保留客户端 / 手动合并）
  - 协议对齐：sync-protocol.md §2.4「conflict → 保留 dirty + 等待合并」+ conflict-strategy.md（待 Sprint-3 立案）
- **依赖**：
  - **必须**：COSTRA-104 server `/sync/push` 返回 `conflict` 状态 + server_state payload
  - **建议**：FU-103-CLIENT-SYNC-SCHEDULER 已上线（让 conflict 真实在生产环境出现）
- **PRD 锚点**：
  - PRD AC-3 转账冲突场景（家庭模式下父母同时改一笔）
  - sync-protocol.md §2.4
- **阻断级别**：P2（家庭模式才会触发 · MVP 单人记账暂不阻断 · Sprint-3+ 落地）
- **认领建议**：Sprint-3 中后段（候选卡号 COSTRA-151 · 估 5 点 · 与 conflict-strategy.md 决议立案捆绑）
- **状态**：`open`
- **owner_card**：COSTRA-151（待 Sprint-3 Planning 认领）

### FU-105-CLIENT-SERVER-URL-PREFIX-MISMATCH · client/server `/v1` URL 前缀实装层 mismatch（Sprint-3 头部 P0 · 早于 COSTRA-150）

- **来源**：2026-05-12 16:1x · COSTRA-105 R1.1 手册修订时（修订方式 B 真链路实测段）显式暴露
- **登记时间**：2026-05-12（COSTRA-105 R1.1 · 2026-05-12 16:27 Human 决策方案 A）
- **根因**（三层）：
  - **L1 协议歧义**：OpenAPI 3.0.3 `servers[].url` 含 `/v1` path（COSTRA-020 G3 通过 30/30）+ `paths[]` 为相对 path · 规约允许但**不强制实装方实现 servers prefix** · fastify/express 等框架不会自动从 OpenAPI servers 推导 prefix
  - **L2 验证盲区**：server 单测全部走 `inject({ url: '/...' })` 内部路径 · client 默认 `mockLogin: true` 不发真 HTTP · COSTRA-104 curl 直打 server 绕过 client buildUrl · **三条独立路径都自洽 · 端到端契约联调用例从未存在**
  - **L3 CI 误判**：`scripts/devops/whitelist-check.mjs` 三方对账（env.ts ↔ openapi.yaml servers ↔ domains.md）按"字符串相等"全 PASS · **没核对 path 拼接后的有效 URL** · 给虚假安全感
- **事实**：
  - server `app.ts:67-70` 注册路由无 prefix · 实际监听 `/auth/wx-login` `/sync/push` `/entries`
  - server 25 处 inject test 用 `url: '/auth/...'`（auth 9 + entries 8 + sync 8）· 与 server 实装一致 · 全绿
  - OpenAPI `servers[]` 4 条全带 `/v1`（openapi.yaml:24-32）
  - client `apiBaseUrl` 4 个 env 全带 `/v1`（env.ts:17/28/39）
  - client `path` 字面量无 `/v1`（auth.ts:134/175/206 / sync.ts:87）
  - `buildUrl(base, path)` 字符串拼接（request.ts:135-143）→ 实际请求 `http://localhost:8080/v1/auth/wx-login`
  - server 收到该请求 → setNotFoundHandler → 404
- **影响**：105 R1.1 手册方式 B 步骤 D（client 联网→outbox push）撞 404 · 步骤 E（curl 直打 server · 沿用 104 范式不带 /v1）不受影响
- **决策**：✅ **Human 已选方案 A**（2026-05-12 16:27）· server 加 `/v1` prefix · 让实装服从 OpenAPI 契约 · COSTRA-104 不回归（COSTRA-105 方式 B 真链路实测 = 端到端覆盖 = 等效回归）
- **scope**（COSTRA-156 · Sprint-3 头部）：
  1. `server/src/app.ts` 加 v1 prefix 注册（`app.register(async (v1) => { ... }, { prefix: '/v1' })` · healthz 保留根路径供 K8s/SLB 健康检查）
  2. `server/test/auth.test.ts` 9 处 inject url 加 `/v1` 前缀
  3. `server/test/entries.test.ts` 8 处 inject url 加 `/v1` 前缀
  4. `server/test/sync.test.ts` 8 处 inject url 加 `/v1` 前缀
  5. `server/scripts/dev/README.md` curl 示例加 `/v1`
  6. `docs/qa/costra-104-curl-verify.md` 8 处 curl URL 加 `/v1` · v1.4→v1.5（**不要求 Human 重跑**）
  7. `docs/qa/costra-105-human-smoke.md` §0.1 警示段去 BLOCKED 注记 + 步骤 D 转 ✅ 可跑
  8. `scripts/devops/whitelist-check.mjs` 加规则 D：fastify register prefix（从 app.ts AST 抽取）vs OpenAPI servers path 段 · 强制一致性 CI 闸门（防回归）
  9. 立 `.team/decisions/D-023`：OpenAPI servers prefix 与 fastify register prefix 强制一致性规约（工具链 SSOT 层 · 类比 D-011 工具链层规约）
- **依赖**：早于 COSTRA-150（client 调度器）· 因为 150 联调 push/pull 必须先有正确 URL
- **PRD 锚点**：Epic-A AC-1（登录）/ Epic-B AC-4（离线）/ Epic-C 整体（同步引擎）联调可达性
- **阻断级别**：**P0**（Sprint-3 主线 150/154 联调依赖此 fix · 必须 Sprint-3 头部完成）
- **认领建议**：Sprint-3 头部 COSTRA-156 · **2 点** · owner=backend-dev 主驾 + qa-planner 回归 + devops-ops CI 扩展
- **Sprint-2 末 Retro 议题候选**（升 P0）：
  - **议题 A**：CI 漏检反模式 ——"三源字符串相等"对账 ≠ "端到端可达性"对账 · whitelist-check 范式扩展到 path 维度（COSTRA-115/116 CI 对账族第 5 张候选）
  - **议题 B**：server 单测 `inject` 反模式 —— 不走真 HTTP · 不经过 client buildUrl · 漏检 client/server 协议层握手 gap · 议入测试策略 v0.2（建议补 supertest + jest-openapi 真 HTTP 集成测试 · COSTRA-050 §2.2 落地）
  - **议题 C**：D-022 v2.0 评分表 C8 子项扩展 —— C8 runtime 加载性维度增加"端到端契约联调可达性"子项（C8-5 候选）
- **状态**：`open`（COSTRA-156 占位卡待 Sprint-3 Planning 认领）
- **owner_card**：COSTRA-156（待立）

---

## 👤 族 B · Sprint-2 Epic-F 用户资料完善（5 条 · 强烈建议合并到一张卡）

### FU-001 · 业务占位昵称配置化

- **来源**：`.team/reviews/COSTRA-101/round-1-tech.md` P2-1
- **登记时间**：2026-04-24 11:50（COSTRA-101 Round 1 Revise）
- **范围**：`server/src/services/authService.ts` wxLogin 路径里的硬编码 `nickname: '微信用户'`
- **建议**：抽到 `server/src/config/defaults.ts` 导出 `defaultNickname`，支持 env 覆盖 + subjectConfig 语境化
- **阻断级别**：P2（不阻当卡 · 登录链路业务可用）
- **认领建议**：Sprint-2 **Epic-F 用户资料完善**（若立项）或并入"小程序首次登录完善资料"卡
- **状态**：`open`
- **owner_card**：（待 Sprint-2 Planning 认领）
- **同类拓展**：FU-118-2（miniprogram 端 "未命名用户"）· 建议合并处理

### FU-118-2 · miniprogram 端硬编码昵称 "未命名用户"

- **来源**：`.team/reviews/COSTRA-118/round-1-tech.md` P2-2
- **登记时间**：2026-04-24 19:35
- **范围**：`miniprogram/pages/mine/index.ts:19`
- **建议**：与 FU-001 合并处理（server 与 miniprogram 两端同时改）· 统一读 `config/subject.ts` 或 `config/defaults.ts` 的 `defaultNickname`
- **阻断级别**：P2
- **认领建议**：Sprint-2 合入 FU-001 同卡
- **状态**：`open`

### FU-102-PROFILE-REFUSE-UI · 用户拒绝 getUserProfile 的空窗期 UI 状态

- **来源**：`.team/reviews/COSTRA-102/round-1-product.md` P2-NEW-1
- **登记时间**：2026-04-27 10:14
- **范围**：`miniprogram/pages/login/index.ts` 调 `wx.getUserProfile` 被用户取消授权时的 home 页空头像空昵称降级显示策略
- **建议**：home 页显示占位头像 + "欢迎" 无名称版本 + 页面角标"完善资料"入口（Sprint-2 产品细节）
- **阻断级别**：P2
- **认领建议**：Sprint-2 Epic-F 用户资料卡
- **状态**：`open`
- **owner_card**：（待 Sprint-2 Planning 认领）

### FU-102-ERROR-MAPPER-INTEGRATION · login 页错误分支直出 err.message 违反红线

- **来源**：`.team/reviews/COSTRA-102/round-1-tech.md` P1-NEW-1 + `round-1-product.md` P1-NEW-1（双签方共识）
- **登记时间**：2026-04-27 10:14
- **范围**：`miniprogram/pages/login/index.ts` 错误分支 `wx.showToast({ title: err.message })` 违反 `docs/api/error-codes.md §0.5` 红线"客户端不得直接展示 message 给终端用户"
- **建议**：改为 `import { mapError } from '../../utils/error-mapper'; const m = mapError(err); wx.showModal({ title: m.title, content: m.desc })`
- **阻断级别**：P1（双签方均判非阻塞 · 放 FU 交 Human T1 终审前修或入下一轮）
- **认领建议**：合入 Epic-F 卡 · 或单独 0.5 点小卡随时修
- **状态**：`open`
- **owner_card**：COSTRA-102（本卡兜底）→ 实测已转 Sprint-2

### FU-102-AVATAR-ONERROR · home.wxml binderror 对应 handler 未实现

- **来源**：`.team/reviews/COSTRA-102/round-1-tech.md` P1-NEW-2
- **登记时间**：2026-04-27 10:14
- **范围**：`miniprogram/pages/home/index.wxml` `<image binderror="onAvatarError">` · `index.ts` 无 `onAvatarError` 方法 · 头像 404 时无降级
- **建议**：补 `onAvatarError(): void { this.setData({ 'user.avatarUrl': '' }) }` 走 CSS fallback
- **阻断级别**：P1（功能非致命 · 头像 URL 不达可用默认）
- **认领建议**：与 FU-102-ERROR-MAPPER-INTEGRATION 同批次修
- **状态**：`open`
- **owner_card**：COSTRA-102 → 实测已转 Sprint-2

---

## 🔧 族 C · DevOps 基建 / CI 升级（5 条）

### FU-118-3 · miniprogram/tokens.json 未被任何 wxss 消费（设计-实装脱节 · → COSTRA-160）

- **来源**：`.team/reviews/COSTRA-118/round-1-tech.md` P0-9 根因分析
- **登记时间**：2026-04-24 19:35
- **范围**：`miniprogram/tokens/index.ts` 正确导出 colors/shadows/radii，但 `app.wxss` 与各页面 wxss 全部用手写 CSS 变量 · 两套完全脱节
- **建议**：Sprint-2 独立专项卡"设计系统 miniprogram 侧闭环"
  - 方案：写构建脚本 `scripts/gen-wxss-tokens.mjs` · 从 `tokens.json` 自动生成 `app.wxss` 的 `:root {}` 段
  - 副产品：保证所有页面引用的变量名都在 token 真身内
- **阻断级别**：P0 根因（本卡 P0-9 的深层修复）· 但本卡采用快修方案 A（手动补齐 app.wxss）· 彻底方案 B 延到 Sprint-2
- **认领建议**：**Sprint-2 新立 COSTRA-160** `miniapp-design-tokens-pipeline`（已在 backlog.json 占位）
- **状态**：`open`
- **owner_card**：COSTRA-160

### FU-118-5 · miniprogram 关键路径 console.* 统一日志封装

- **来源**：`.team/reviews/COSTRA-118/round-1-tech.md` P2-4
- **登记时间**：2026-04-24 19:35
- **范围**：app.ts × 3 + services/auth.ts × 4 + services/storage.ts × 3 + services/request.ts × 1 = 11 处 `console.*`
- **建议**：Sprint-2 引入统一 logger 封装
  - 方案 A：`utils/logger.ts` 包装 `wx.getRealtimeLogManager()`（微信官方实时日志）+ ring buffer
  - 方案 B：上报到后端 APM（依赖 COSTRA-903）
- **阻断级别**：P2
- **认领建议**：Sprint-2 与 APM 卡（COSTRA-903）合入
- **状态**：`open`

### FU-CI-MP-BUILD-NPM-ENFORCE · CI 引入 miniprogram-ci 真实编译冒烟

- **来源**：COSTRA-123 收官时 Sprint-1 末 Retro 议题升级 · 同族规约盲区第 5 次复发驱动
- **登记时间**：2026-05-01 21:28
- **范围**：CI 流水线引入 `miniprogram-ci` 真实编译 · 校验 `miniprogram_npm/` 构建产物可加载性 · 结构性消除"命令行五闸全绿 vs 微信 runtime 红"落差
- **建议**：参照 `check:appjson` / `check:tooling` 范式 · 新增 `scripts/devops/miniapp-build-check.mjs`（调用 miniprogram-ci API 在 CI 环境真编译一次小程序）+ `pr-check.yml` step
- **阻断级别**：P2（不阻当前 · 但属"治理性预防"）
- **认领建议**：Sprint-2 候选 CI 升级卡（与 COSTRA-117/108 联动）
- **状态**：`open`
- **owner_card**：（待 Sprint-2 Planning 认领）

### FU-LIBVERSION-DEV-GUARD · CI 加 libversion=development 拦截

- **来源**：COSTRA-126 跨 lib 实测 · Human 切到 `development` lib 立即出现 5 条 framework error `(TO:基础库开发同学)` · 暴露"无防护时易踩内部分支"
- **登记时间**：2026-05-08（COSTRA-126 同轮）
- **范围**：CI 加 `check:libversion` 脚本扫 `project.config.json.libVersion` 不得为 `development`
- **建议**：Sprint-2 加入 `scripts/devops/libversion-check.mjs`（参照 `whitelist-check.mjs` / `appjson-pages-check.mjs` 范式）+ `pr-check.yml` step
- **优先级**：P3 观察（开发期偶发 · 真机不可能用 development · 边界外漂移）
- **状态**：`open`
- **owner_card**：（待 Sprint-2 Planning 认领）

### FU-118-4 · miniprogram 占位页卡号幻觉（COSTRA-060/130/140/150 不存在）

- **来源**：`.team/reviews/COSTRA-118/round-1-tech.md` P2-1
- **登记时间**：2026-04-24 19:35
- **范围**：
  - `pages-stat/month/index.ts` → `COSTRA-130`（不存在）
  - `pages-family/home/index.ts` → `COSTRA-140`（不存在）
  - `pages-family/settings/index.ts` → `COSTRA-150`（**冲突！现已用作 FU-103-CLIENT-SYNC-SCHEDULER 候选号**）
  - `pages-family/privacy/index.wxml` → `COSTRA-060`（不存在）
- **建议**：Sprint-2 末批一次性纠正：
  - COSTRA-130 → COSTRA-202（Epic-D 家庭成员角色）或新 COSTRA-401（Epic-F 月度报表）
  - COSTRA-150 已被 FU-103 占用 → 改指 COSTRA-201（家庭设置 · Epic-D）
  - COSTRA-060 → COSTRA-109（PM 隐私指引清单）或 COSTRA-901（Epic-G 隐私协议）
- **阻断级别**：P2
- **认领建议**：Sprint-2 末文档维护批
- **状态**：`open`
- **⚠️ 卡号冲突警告**：原指引 COSTRA-150 已被 FU-103-CLIENT-SYNC-SCHEDULER 占用 · 必须重新分配占位页指向

---

## 🗄 族 D · DB 治理（1 条）

### FU-DB-OPS-AUDIT · DB 全表运营风险审查（立卡前案）

- **来源**：2026-05-08 Human 在 COSTRA-102 本地 server 验证期间提出
- **登记时间**：2026-05-08 20:12（COSTRA-128 同卡簇收官后搬迁登记）
- **范围**：12 张表 + audit_logs 分区 + idempotency_keys 横切运营态健康度审查（容量 / 清理 / 索引膨胀 / 软删-硬删策略 / GDPR 对齐）
- **建议**：Backend-Agent 主驾 · DevOps 协同清理 job 落 cron · 5 项交付物（A 增长公式 / B 清理策略 / C 索引膨胀 / D 容量阈值 / E 隐私合规对齐）
- **阻断级别**：P3（治理 · 不阻当前任何卡 · MVP ~10 用户无感）
- **触发立案的可观察阈值**：
  - DAU > 100（user_sessions 估算一年 18 万行 · 仍轻量但应建立机制）
  - 或 Sprint-2+ DBA 体检窗口
- **认领建议**：Sprint-2+ Backend-Agent 主驾 · DevOps 协同
- **状态**：`open`
- **完整前案**：[`docs/db/ops-risk-audit-todo.md`](../../docs/db/ops-risk-audit-todo.md)（横切清单 + user_sessions 单表锚点）

---

## 📋 族 E · 协议 / 规约残留（4 条）

### FU-COMMON-MINIAPP-PATCH-LIMIT · wx.request 不支持 PATCH（平台限制登记）

- **来源**：`.team/reviews/COSTRA-102/round-1-miniapp-response.md` INFO-C
- **登记时间**：2026-04-27 10:14
- **范围**：`miniprogram/services/request.ts` PATCH 方法在 wx.request type 中不存在 · Agent 已降级 `method === 'PATCH'` 时走 POST + `X-HTTP-Method-Override: PATCH` header
- **建议**：登记为跨卡复用的平台限制 · server 侧约定处理该 header · 不可修
- **阻断级别**：O-观察项（平台限制 · 已合规兜底）
- **认领建议**：server 端任一接受 PATCH 的接口（如 `PATCH /users/me`）需文档化接受 `X-HTTP-Method-Override` header · 议入 `docs/api/common-contract.md`
- **状态**：`open-observation`
- **owner_card**：跨卡通用（可入 engineering-guidelines 或 common-contract）
- **🆕 首次实触发观察**（2026-05-01 21:18 · COSTRA-123 Human 第 6 次模拟器启动）：
  - 现象：`request.ts:88 POST http://localhost:8080/v1/users/me 404` + `[login] PATCH /users/me soft-fail Error: route not found`
  - 链路精准命中 R1 Review §P1-2 预言（`.team/reviews/COSTRA-102/round-1-tech.md:74-81`）
  - 兜底有效：`pages/login/index.ts:68` `catch (e) { console.warn }` 打印 `soft-fail` · 不阻登录流程
  - **三方案预议**（保留 · 待 Sprint-2 选）：(a) server/Fastify 加统一 `methodOverride` 中间件 · (b) MiniApp 切到 DELETE+重建语义 · (c) OpenAPI 改 PATCH → PUT（无破坏 · 语义等价）

### FU-118-1 · miniprogram README 出现 AppID（灰色区 / 观察项）

- **来源**：`.team/reviews/COSTRA-118/round-1-tech.md` 灰色区二裁段
- **登记时间**：2026-04-24 19:35
- **范围**：`miniprogram/README.md:12, :42` 两处出现 `wxf8b0d3e3a83f9941`
- **问题**：Review-Tech §3.5 红线"AppID 不得出现在 miniprogram 源码中"的"源码"定义存在歧义 — 狭义（.ts/.wxml/.wxss/.json）vs 广义（含 README/文档）。Reviewer 主张务实派（README 不打包进小程序产物 · 开发可读性价值高）· 降级为观察项。
- **建议**：Sprint-2 在 `engineering-guidelines §2.5` 补一句显式澄清："AppID 红线仅针对会打包进小程序产物的文件（.ts/.wxml/.wxss/.json）· README 等文档类文件豁免"
- **阻断级别**：O-观察项
- **认领建议**：Sprint-2 PM 维护批
- **状态**：`open-observation`

### FU-102-SYNC-PULL-DRIFT · dispatch 派单推导与事实源漂移（已部分兑现 · 待正式 close）

- **来源**：`.team/reviews/COSTRA-102/round-1-miniapp-response.md` INFO-B + `round-1-tech.md` INFO
- **登记时间**：2026-04-27 10:14
- **范围**：`.team/dispatch/COSTRA-102-miniapp-login-e2e.md §D2.5` 写 "POST /sync/pull body"；事实源 `server/api/openapi.yaml L614-637` + `docs/api/sync-protocol.md §3.1` 明确为 GET + query string · Agent 按事实源实装 · Reviewer 确认正确
- **建议**：Orchestrator 派单推导机制应增加"事实源对账自查表"步骤（类似 O-R4-2 Revise 主报告自查表）· 避免派单引入次生幻觉
- **阻断级别**：INFO（本次未造成实装事故 · Agent 按事实源优先原则兜住）
- **认领建议**：**已并入 COSTRA-106 Sprint-1 Retro 议题处置（2026-05-09 闭环）**· 议题已沉淀到 D-020/D-021 · 本 FU 文档登记可在下次维护批次同步关闭
- **状态**：`open`（议题已沉淀 · 文档登记待同步）
- **owner_card**：COSTRA-106

### FU-102-HUMAN-VERIFY-PARADIGM · 首张纯前端 T1 卡范式（已部分兑现 · 待正式 close）

- **来源**：`.team/reviews/COSTRA-102/round-1-product.md` INFO + card-def-product.md INFO-2
- **登记时间**：2026-04-27 10:14
- **范围**：COSTRA-102 作为首张纯前端 T1 卡 · 建立 "Agent 交付三件套（代码 + 单测 + 手册） + Human 20 分钟本地验证 = T1 终审必要凭证" 范式 · 破解 Agent 无真机访问权的能力边界约束
- **建议**：议入 `SOP-REVIEW.md v2.1 §11`：纯前端客户端 T1 卡 R1 交付必含本地验证手册 `docs/qa/COSTRA-<xxx>-human-verify.md`（0 前置 + 步骤明确 + 失败报告模板）
- **阻断级别**：INFO（范式议入 · 非缺陷）
- **认领建议**：**已并入 COSTRA-106 Sprint-1 Retro · D-022 v2.0 评分表已包含"runtime 类 T2 卡判定 + Human 实测前置铁律"** · 范式已明文化
- **状态**：`open`（议题已沉淀 · 文档登记待同步）
- **owner_card**：COSTRA-106

---

## 🧪 族 F · QA 自动化（1 条）

### FU-105-AUTOMATION-FULL-COVERAGE · 全量 14 用例自动化 + CI 集成

- **来源**：COSTRA-105 R1 Card-Review P1-1（自动化脚手架降级路径）+ DoD §3.3（形式 ② README 占位）
- **登记时间**：2026-05-12（COSTRA-105 R1 实装 · qa-planner 首次实战）
- **范围**：
  - 安装 `miniprogram-automator`（npm 包 + 微信开发者工具端口暴露配置）
  - 实装 14 条用例自动化（SU-001~014）
  - 集成 CI 流水线（`.github/workflows/pr-check.yml` 新增 `test:e2e` step）
  - 目标：核心链路自动化覆盖 ≥ 80%
- **依赖**：
  - COSTRA-104 server `/sync/push` + `/entries` 端点稳定
  - `FU-103-CLIENT-SYNC-SCHEDULER`（client 调度器实装）
- **PRD 锚点**：Epic-B（单人记账）+ Epic-C（离线同步）全链路自动化覆盖
- **阻断级别**：P2（不阻 COSTRA-105 终审 · 但影响 Sprint-3 发版覆盖率）
- **认领建议**：Sprint-3 头部（COSTRA-155 候选 · 5 点 · owner=qa-planner+miniapp-dev）
- **状态**：`open`
- **owner_card**：（待 Sprint-3 Planning 认领）

---

## 🔍 族 G · Review 机制（1 条 · 已部分兑现）

### FU-REVIEW-TECH-RUNTIME-DIM · Review-Tech 评分表新增 runtime 加载性维度

- **来源**：COSTRA-123 收官时立 · 同族规约盲区 5 连共同根因
- **登记时间**：2026-05-01 21:28
- **范围**：Review-Tech 35 分评分表 7 维（契约/代码/架构/数据/安全/可测/纪律）无一覆盖 runtime · 119~123 五次复发本质原因
- **建议**：Review-Tech 评分表升 v2.0 · 新增第 8 维"runtime 加载性"（5 分制 · 含微信/Node/Browser 三栏可选）
- **阻断级别**：原 P0（Sprint-1 末 Retro 必议题）
- **认领建议**：**已并入 COSTRA-106 Sprint-1 Retro D-022 v2.0 · 评分表升级到 40 分制**（D-022 v2.0 已在 COSTRA-103/104/105 三次实战 · 趋势 38→36→40）
- **状态**：`open`（议题已沉淀 · 文档登记待同步关闭）
- **owner_card**：COSTRA-106

---

## 🌐 族 H · 外部触发（1 条 · Human 主动）

### FU-115-2 · ICP 下证后配 api.costra.cloud 至微信服务器域名白名单

- **来源**：`infra/wechat/domains.md §4` Human 操作手册 + `.team/risks.md` R-013 关闭条件
- **登记时间**：2026-04-27 10:54
- **范围**：ICP 备案下证后，Human 按 `infra/wechat/domains.md §4` 三步执行：
  1. 阿里云 DNS 添加 A 记录 `api.costra.cloud → 49.235.216.20`
  2. 微信公众平台后台 → 开发管理 → 开发设置 → 服务器域名 → request 合法域名添加 `https://api.costra.cloud`
  3. 发 `close:R-013`
- **建议**：Orchestrator 在 `.team/STATE` 每周提醒 `R-013 mitigate` 状态 · ICP 下证日零延迟触发
- **阻断级别**：O-观察（非 Agent 可执 · Human 主动 · 外部依赖触发）
- **认领建议**：**Human · 外部触发**（估 2026-05 中下旬 ICP 下证日）
- **状态**：`open`

---

_本文件由 Orchestrator 按需追加；不直接编辑，仅在 Agent Revision Response 产出时同步新增条目。已闭合条目归档至 `.team/_archive/follow-ups-closed-sprint-1.md`。_
