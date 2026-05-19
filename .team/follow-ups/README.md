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

- **Sprint-1 + Sprint-2 早期已闭合 FU**（18 条 · 含同族规约盲区 5 连 + FU-LAUNCH 族 4 卡 + FU-105-URL + 2026-05-13 维护批 4 条账本同步）→ [`_archive/follow-ups-closed-sprint-1.md`](../_archive/follow-ups-closed-sprint-1.md)
- 完整治理叙事（v1→v5 翻转链 / D-017 SOP 立案 / CI 对账族五代）原文亦在归档文件中

---

## 🟢 当前 open FU 速查表（24 条 · 按主题族 + 推动优先级 · 2026-05-19 COSTRA-158 关闭 2 条）

| 主题族 | FU-ID | 优先级 | 候选卡 / 归属 | 状态 |
|---|---|---|---|---|
| **Sprint-3 同步协议核心** | FU-104-SYNC-PULL | **P0** | COSTRA-154 | open |
| **Sprint-3 同步协议核心** | FU-103-CLIENT-SYNC-SCHEDULER | P1 | COSTRA-150 | open |
| **Sprint-3 同步协议核心** | FU-104-ENTRIES-PATCH | P1 | COSTRA-152 | open |
| **Sprint-3 同步协议核心** | FU-104-ENTRIES-DELETE | P1 | COSTRA-153 | open |
| **Sprint-3 同步协议核心** | FU-103-CONFLICT-MERGE-UI | P2 | COSTRA-151 | open |
| **Epic-A 用户资料**（→ COSTRA-157 合卡）| FU-001 | P2 | COSTRA-157 | scoped |
| **Epic-A 用户资料**（→ COSTRA-157 合卡）| FU-118-2 | P2 | COSTRA-157 | scoped |
| **Epic-A 用户资料** | FU-102-PROFILE-REFUSE-UI | ~~P1~~ → **closed** | ~~COSTRA-158~~ | **closed @ COSTRA-158**（boundary risk 子项 · 157 间接判定 → 158 严格 has_completed_profile） |
| **Epic-A 用户资料**（→ COSTRA-157 合卡）| FU-102-ERROR-MAPPER-INTEGRATION | **P1**（红线违反）| COSTRA-157 | scoped |
| **Epic-A 用户资料**（→ COSTRA-157 合卡）| FU-102-AVATAR-ONERROR | **P1**（红线违反）| COSTRA-157 | scoped |
| **DevOps 基建** | FU-118-3（→ COSTRA-160）| P0 根因 / P2 优先级 | COSTRA-160（已立卡）| open |
| **DevOps 基建** | FU-CI-MP-BUILD-NPM-ENFORCE | P2 | Sprint-2 CI 升级 | open |
| **DevOps 基建** | FU-LIBVERSION-DEV-GUARD | P3 | Sprint-2 候选 | open |
| **DevOps 基建** | FU-118-5 | P2 | 合 COSTRA-903 APM | open |
| **DevOps 基建** | FU-118-4 | P2 | Sprint-2 末维护批 | open |
| **DevOps 基建** | FU-DEVOPS-NGINX-ICP-HEADER | P3 | DNS+SSL+反代上线触发 | open-observation |
| **DevOps 基建** | FU-DEVOPS-ICP-HEALTH-PROBE | P2 | 合 COSTRA-903 APM | open |
| **DevOps 基建** | FU-DEVOPS-ICP-CROSS-SSOT-CHECK | P2 | Sprint-2 CI 升级（与 FU-CI-MP-BUILD-NPM-ENFORCE 同节奏）| open |
| **DB 治理** | FU-DB-OPS-AUDIT | P3 | DAU>100 触发 | open |
| **协议 / 规约残留** | FU-COMMON-MINIAPP-PATCH-LIMIT | ~~P2~~ → **closed** | ~~COSTRA-158~~ | **closed @ COSTRA-158**（server PATCH route + K3 method-override compat · client 现有降级链路验证可用） |
| **QA 自动化** | FU-105-AUTOMATION-FULL-COVERAGE | P2 | COSTRA-155 | open |
| **QA 自动化** | FU-156-OUTBOX-FLAKY | P2 | Sprint-3 头部 miniapp-dev | open |
| **外部触发** | FU-115-2 | O 观察 | Human ICP 下证日触发 | open |
| **🆕 QA 实测发现（族 H）** | **BUG-105-D1-LEDGER-ID-DEFAULT** | **🔴 P0** | COSTRA-105 R1.x.1（miniapp-dev · 派单中）| open |
| **🆕 QA 实测发现（族 H）** | **BUG-156-SYNC-PUSH-PAYLOAD-NO-UUID-VALIDATION** | **🔴 P0** | COSTRA-105 R1.x.2（backend-dev · 派单中）| open |
| **🆕 QA 实测发现（族 H）** | FU-105-DEV-CONSOLE-HOOK | P3 | Sprint-3 头部 miniapp-dev（候选 COSTRA-150 顺带）| open |

> **2026-05-19 COSTRA-158 同步关闭 2 条 FU**：FU-COMMON-MINIAPP-PATCH-LIMIT（server PATCH route 实装 + K3 method-override 兼容 · client 降级链路验证可用）· FU-102-PROFILE-REFUSE-UI boundary risk 子项（COSTRA-157 间接判定 → 158 严格 has_completed_profile 字段判定）

---

## 登记列表（按主题族分组）

---

## 🚀 族 A · Sprint-3 同步协议核心（5 条 · 强联动 · 必须打包做）

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

---

## 👤 族 B · Epic-A 用户资料完善（5 条 · 已合卡到 COSTRA-157 · 等 Card-Review R1）

> **2026-05-18 状态流转**：Human all-A 决策 · 5 条 FU 合并到 **COSTRA-157**（3 点 · miniapp-dev + backend-dev 单卡双装扮档）· dispatch 已落盘 [`.team/dispatch/COSTRA-157-user-profile-completion-and-login-resilience.md`](../dispatch/COSTRA-157-user-profile-completion-and-login-resilience.md) · 等 Card-Review R1 启动 D-014-a 流程

### FU-001 · 业务占位昵称配置化

- **来源**：`.team/reviews/COSTRA-101/round-1-tech.md` P2-1
- **登记时间**：2026-04-24 11:50（COSTRA-101 Round 1 Revise）
- **范围**：`server/src/services/authService.ts` wxLogin 路径里的硬编码 `nickname: '微信用户'`
- **建议**：抽到 `server/src/config/defaults.ts` 导出 `defaultNickname`，支持 env 覆盖 + subjectConfig 语境化
- **阻断级别**：P2（不阻当卡 · 登录链路业务可用）
- **认领建议**：✅ **已合入 COSTRA-157**（A 项 server defaults · Q2-A 硬编码 fallback · 不引入 env 覆盖）
- **状态**：`scoped`
- **owner_card**：**COSTRA-157**（dispatch 已落盘 · 等 Card-Review R1）
- **同类拓展**：FU-118-2（miniprogram 端 "未命名用户"）· 已合并处理

### FU-118-2 · miniprogram 端硬编码昵称 "未命名用户"

- **来源**：`.team/reviews/COSTRA-118/round-1-tech.md` P2-2
- **登记时间**：2026-04-24 19:35
- **范围**：`miniprogram/pages/mine/index.ts:39` + `miniprogram/pages/home/index.ts:62`（hydrateUser 兜底也走同一字符串）
- **建议**：与 FU-001 合并处理（server 与 miniprogram 两端同时改）· 新建 `miniprogram/config/defaults.ts` 与 server 端对齐
- **阻断级别**：P2
- **认领建议**：✅ **已合入 COSTRA-157**（B 项 miniapp defaults）
- **状态**：`scoped`
- **owner_card**：**COSTRA-157**

### FU-102-PROFILE-REFUSE-UI · 用户拒绝 getUserProfile 的空窗期 UI 状态

- **来源**：`.team/reviews/COSTRA-102/round-1-product.md` P2-NEW-1
- **登记时间**：2026-04-27 10:14
- **范围**：`miniprogram/pages/login/index.ts` 调 `wx.getUserProfile` 被用户取消授权时的 home 页空头像空昵称降级显示策略
- **建议**：home 页显示占位头像 + "欢迎" 无名称版本 + 页面角标"完善资料"入口
- **阻断级别**：原 P2 → **升级 P1**（2026-05-19 09:42 Human 否决"概率极低"接受边界）
- **认领建议**：
  - 🟡 COSTRA-157 R1 已实装"基于 nickname 字符串比较的代理判定"（u.nickname !== defaultNickname）· 完成边界 + Q5-A 临时文字链入口 · 但 Human 否决概率近似判定
  - ✅ **已由 COSTRA-158 闭环**（has_completed_profile 严格字段判定 · 替换 157 间接判定）
- **状态**：`closed @ COSTRA-158`（boundary risk 子项 · 157 间接判定 → 158 严格 has_completed_profile）
- **owner_card**：~~COSTRA-158~~（已闭环）
- **🆕 2026-05-19 09:42 Human 否决记录**：`u.nickname !== defaultNickname` 是字符串代理判定 · 不是事实判定 · 用户名='微信用户'撞库时误判 → 不能用"概率极低"理由接受 → 立 COSTRA-158 走严格事实字段（has_completed_profile）
- **🆕 2026-05-19 COSTRA-158 闭环**：server has_completed_profile 字段 + client computeHasProfile 严格判定 + auth.updateLocalUserProfile 本地同步 · 157 间接判定已完全替换

### FU-102-ERROR-MAPPER-INTEGRATION · login 页错误分支直出 err.message 违反红线

- **来源**：`.team/reviews/COSTRA-102/round-1-tech.md` P1-NEW-1 + `round-1-product.md` P1-NEW-1（双签方共识）
- **登记时间**：2026-04-27 10:14
- **范围**：`miniprogram/pages/login/index.ts:87-97` 错误分支 `msg = e.message`（line 94-96）违反 `docs/api/error-codes.md §0.5` 红线"客户端不得直接展示 message 给终端用户"· 实际渲染路径是 `setData({ errMsg: msg })` 到模板（不是 toast）
- **建议**：改为 `import { mapError } from '../../utils/error-mapper'; const m = mapError(e); setData({ errMsg: m.title ? \`${m.title}：${m.desc}\` : '登录失败，请重试' })`
- **阻断级别**：**P1**（红线违反 · 双签方均判非阻塞 · 但应优先清掉）
- **认领建议**：✅ **已合入 COSTRA-157**（C 项 mapError 改造）
- **状态**：`scoped`
- **owner_card**：**COSTRA-157**

### FU-102-AVATAR-ONERROR · home.wxml binderror 对应 handler 未实现

- **来源**：`.team/reviews/COSTRA-102/round-1-tech.md` P1-NEW-2
- **登记时间**：2026-04-27 10:14
- **范围**：`miniprogram/pages/home/index.wxml:5` `<image binderror="onAvatarError">` 已存在 · `index.ts` 无 `onAvatarError` 方法 · 头像 404 时无 fallback 触发
- **建议**：补 `onAvatarError(): void { this.setData({ userAvatar: '' }) }` 走 wxml `wx:if` fallback 切换到 👤 占位
- **阻断级别**：P1（功能非致命 · 头像 URL 不达静默失败）
- **认领建议**：✅ **已合入 COSTRA-157**（D 项 onAvatarError handler）
- **状态**：`scoped`
- **owner_card**：**COSTRA-157**

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

### FU-DEVOPS-NGINX-ICP-HEADER · nginx 反代注入 X-ICP-Number 响应头

- **来源**：DevOps-Agent 自评 · 2026-05-13 ICP 下证后落地交付协作锚点
- **登记时间**：2026-05-13 16:57
- **背景**：腾讯云规范要求"网站底部显著位置 + 工信部超链"。Costra 当前后端纯 API 域名，未来 `api.costra.cloud` 上线 nginx 反代后，可在 HTTP 响应头注入 `X-ICP-Number: 沪ICP备2026017253号-2`，便于自动化合规巡检（如腾讯云抽查）证明备案号在线可见。
- **范围**：
  - `infra/nginx/api.costra.cloud.conf`（待创建）`add_header X-ICP-Number "沪ICP备2026017253号-2" always;`
  - **不取代** `server/src/config/icp.ts` 运行期 SSOT 与 `GET /v1/legal/icp` 程序化查询
  - 边界：nginx 配置中的备案号字符串若与代码 SSOT 漂移，由 FU-DEVOPS-ICP-CROSS-SSOT-CHECK 兜底
- **触发条件**：DNS §4.1 子记录创建 ✅ + SSL 证书签发 ✅ + nginx 反代上线 → 同卡顺手做
- **阻断级别**：P3
- **认领建议**：与 DNS+SSL+反代上线同卡顺手交付
- **状态**：`open-observation`

### FU-DEVOPS-ICP-HEALTH-PROBE · APM 拨测每日探活 GET /v1/legal/icp

- **来源**：DevOps-Agent 自评 · 2026-05-13 ICP 下证后落地交付协作锚点
- **登记时间**：2026-05-13 16:57
- **背景**：备案号字符串若被误改 / 误删 / 部署回滚，可能在不被察觉的情况下违反"显著位置可查"规范。APM 加入对 `GET /v1/legal/icp` 每日定时探活，并对 `service` / `miniapp` 字符串做 diff 校验，触发即告警。
- **范围**：
  - 拨测目标：`https://api.costra.cloud/v1/legal/icp`（生产）+ `https://api-staging.costra.cloud/v1/legal/icp`（预发）
  - 期望响应：HTTP 200 + body.service === `沪ICP备2026017253号-2` + body.miniapp === `沪ICP备2026017253号-1X`
  - 频率：每日一次即可（备案号字符串静态，不需高频）
  - 告警通道：与 COSTRA-903 APM 卡共用
- **阻断级别**：P2
- **认领建议**：合 COSTRA-903 APM 卡（同节奏：FU-115-WECHAT-WHITELIST-ALERT 也走 APM 拨测，可同卡打包）
- **状态**：`open`

### FU-DEVOPS-ICP-CROSS-SSOT-CHECK · whitelist-check.mjs 升级到强等值校验

- **来源**：DevOps-Agent 自评 · 2026-05-13 ICP 下证后落地交付协作锚点
- **登记时间**：2026-05-13 16:57
- **背景**：当前 `scripts/devops/whitelist-check.mjs assertIcpRecorded()` 只对 `infra/wechat/domains.md` §0 做"子串存在"轻量校验。两个 SSOT（运行期 `server/src/config/icp.ts ICP_INFO` + 文档 `infra/wechat/domains.md §0`）字符串若漂移不会被发现。
- **范围**：
  - 升级 `whitelist-check.mjs`：解析 `server/src/config/icp.ts` 导出的 `ICP_INFO.service` / `ICP_INFO.miniapp` 字面量，与 `domains.md §0` 表格中的备案号字符串做强等值断言
  - 任一漂移 → exit 1 + 打印 diff（参考现有 OpenAPI ↔ env.ts ↔ domains.md §1.1 三方对账实现）
  - 落地后可移除 `assertIcpRecorded()` 中的轻量子串校验，由强等值校验替代
- **阻断级别**：P2（不阻塞当前卡 · ICP 已下证字符串短期内不会变）
- **认领建议**：Sprint-2 CI 升级批，与 FU-CI-MP-BUILD-NPM-ENFORCE 同节奏
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

## 📋 族 E · 协议 / 规约残留（1 条 · 平台限制观察）

### FU-COMMON-MINIAPP-PATCH-LIMIT · wx.request 不支持 PATCH（平台限制登记）

- **来源**：`.team/reviews/COSTRA-102/round-1-miniapp-response.md` INFO-C
- **登记时间**：2026-04-27 10:14
- **范围**：`miniprogram/services/request.ts` PATCH 方法在 wx.request type 中不存在 · Agent 已降级 `method === 'PATCH'` 时走 POST + `X-HTTP-Method-Override: PATCH` header
- **建议**：登记为跨卡复用的平台限制 · server 侧约定处理该 header · 不可修
- **阻断级别**：原 O 观察 → **升级 P2 实装**（2026-05-19 调研发现真实根因双重 · server 路由完全未实装 + 平台限制 · 已挂 COSTRA-158）
- **认领建议**：✅ **已由 COSTRA-158 闭环**（server PATCH /users/me 路由实装 + K3 method-override 兜底 · client 现有降级链路验证可用）
- **状态**：`closed @ COSTRA-158`（server PATCH route 实装 + K3 method-override 兼容 · client 降级链路验证可用）
- **owner_card**：~~COSTRA-158~~（已闭环）
- **闭合条件**（COSTRA-158 R1 一并兑现 ✅）：
  - ✅ server PATCH /users/me 路由真实存在 + POST /users/me K3 method-override 兜底
  - ⏳ E2E 实测：client login 后真调 PATCH 200（不再撞 404 soft-fail）· 等 Human 实测（dispatch §9 步骤 4）
  - ✅ 关闭时同步移除 dispatch 中"留 COSTRA-152 顺手做"的旧建议
- **🆕 真实根因更正**（2026-05-19 调研）：原归因仅"wx.request 不支持 PATCH"只覆盖一半 · 调研 COSTRA-158 时发现 **server PATCH /users/me 路由完全未实装**（OpenAPI 早定义但 server/src/routes/ 无 users.ts · COSTRA-101 遗留 gap）· 即便 client 用真 PATCH 也会 404 · 双重原因
- **🆕 首次实触发观察**（2026-05-01 21:18 · COSTRA-123 Human 第 6 次模拟器启动）：
  - 现象：`request.ts:88 POST http://localhost:8080/v1/users/me 404` + `[login] PATCH /users/me soft-fail Error: route not found`
  - 链路精准命中 R1 Review §P1-2 预言（`.team/reviews/COSTRA-102/round-1-tech.md:74-81`）
  - 兜底有效：`pages/login/index.ts:68` `catch (e) { console.warn }` 打印 `soft-fail` · 不阻登录流程
  - **三方案预议历史**（保留 · 但 K3 兜底已被 COSTRA-158 选定）：(a) server/Fastify 加统一 `methodOverride` 中间件（K1 · 全局）· (b) MiniApp 切到 DELETE+重建语义（不可行）· (c) OpenAPI 改 PATCH → PUT（无破坏 · 语义等价 · 之前推荐 · 现被 K3 替代以保护 OpenAPI 纯净）

---

## 🧪 族 F · QA 自动化（2 条）

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

### FU-156-OUTBOX-FLAKY · client outbox.spec.ts 时间相关 flaky test 修复

- **来源**：2026-05-13 11:27 COSTRA-156 R1 review-tech 独立 5 次跑诊断（2/5 失败 3/5 通过 · 非确定性）
- **性质**：pre-existing flaky（COSTRA-103 R1 client outbox 实装时引入 · COSTRA-156 0 改动 miniprogram 仅触发显式化）
- **失败行**：`miniprogram/services/outbox.spec.ts:102` `expect(result2!.batch[0].next_retry_at > Date.now()).toBe(true)`
- **根因**：测试代码 setup `next_retry_at = Date.now() + 1` · 断言时再取 `Date.now()` · 若间隔超 1ms 则 `next_retry_at <= Date.now()` · 时间相关 race condition（毫秒级精度）
- **修复方案候选**：
  - A. 增大 buffer：`next_retry_at = Date.now() + 100`（简单粗暴 · 不彻底）
  - B. 用 `>=` 替换 `>`（语义不严格 · 能避 race）
  - **C. fake timers**（`vi.useFakeTimers()` · 标准做法 · 需重构 outbox.ts 时间依赖 · 推荐）
- **阻断级别**：P2（不阻 156/105 终审 · 影响 CI 稳定性 · 当前 root vitest 偶发 1 失败）
- **认领建议**：Sprint-3 头部 miniapp-dev · 0.5~1 点
- **PRD 锚点**：无（CI 稳定性议题）
- **依赖**：无（独立 fix）
- **状态**：`open`
- **owner_card**：（待 Sprint-3 Planning 认领）

---

## 🌐 族 G · 外部触发（1 条 · Human 主动）

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

## 🐛 族 H · QA 实测发现（2026-05-18 · COSTRA-105 D.1 真链路实测兑现 D-022 §4.1）

> **族说明**：D-022 §4.1 runtime 类 T2 卡 Human 实测前置铁律首次真兑现立意——自动化 + curl + server 单测 30+ 全绿，但 Human 真链路实测 ~30 分钟内捕获 4 个文档 gap + 1 个真 P0 双责 BUG。详见 `qa/defects/2026-05-18-COSTRA-105-D1-real-test-findings.md`。

### FU-105-DEV-CONSOLE-HOOK · client app.ts dev-only 调试钩子

- **来源**：`qa/defects/2026-05-18-COSTRA-105-D1-real-test-findings.md` §4
- **登记时间**：2026-05-18 19:5x
- **范围**：`miniprogram/app.ts` onLaunch 内加 ~5 行 dev-only 守卫：
  ```ts
  if (this.globalData.env.name === 'dev') {
    import('./services/sync').then(({ pushDelta, syncPull }) => {
      (wx as any).__costra_dev_sync__ = { pushDelta, syncPull };
    });
  }
  ```
- **价值**：D.1/D.2 实测命令回切真路径（`wx.__costra_dev_sync__.pushDelta()` / `syncPull(familyId)`） · 完整保留 H6 立意（端到端 client 调用栈含 request.ts token/idempotency-key 注入 + ackResults 自动出队 + applyServerChanges 自动落 storage）· prod 构建产物不含此钩子（编译期常量 + dev env 双重隔离）
- **依赖**：构建脚本未来需保证 prod build 时 strip dev-only 代码（COSTRA-160 设计 tokens pipeline 顺手做 · 或独立小卡）
- **阻断级别**：**P3**（fallback 模式可达成 D1.1+D1.3 PASS · H6 立意可由方式 C 真链路验证 · 不阻断双卡 approve）
- **认领建议**：Sprint-3 头部 miniapp-dev（与 COSTRA-150 sync scheduler 同轮交付 · ~ 5 分钟改动）
- **状态**：`open`
- **owner_card**：未定（候选 COSTRA-150 顺带 / 或独立 1 点小卡）

### BUG-105-D1-LEDGER-ID-DEFAULT · client `pages/entry/index.ts` 硬编码 `ledger_id: 'default'` 字面量（P0 真 BUG）

- **来源**：`qa/defects/2026-05-18-COSTRA-105-D1-real-test-findings.md` §1
- **登记时间**：2026-05-18 19:5x
- **范围**：`miniprogram/pages/entry/index.ts` line 57+73 把 `ledger_id` 硬编码字符串 `"default"`（COSTRA-103 R1 留 TODO + COSTRA-104 R1 未接续 · scope gap fall-through）· server 端推 push 时 PG 22P02 invalid uuid 错误 → 500
- **修复方案**：阶段 1 紧急止血用 `getApp().globalData.activeLedgerId || FALLBACK_LEDGER_ID`（`00000000-0000-0000-0000-000000000001` seed 默认）· 阶段 2 由 COSTRA-155 ledgers CRUD 卡接续做真选账本 UI
- **阻断级别**：**P0**（D.1 实测靠 Human 临时覆盖 `payload.ledger_id` 才能 push 200 · 无法走 client 真 outbox 路径）
- **认领建议**：**COSTRA-105 R1.x.1**（D-017 v3 §2.4 E1 例外路径 · ≤ 1 小时 · miniapp-dev · 单 commit 收尾）
- **状态**：`open`
- **owner_card**：COSTRA-105 R1.x.1（Orchestrator 派单中）

### BUG-156-SYNC-PUSH-PAYLOAD-NO-UUID-VALIDATION · server `routes/sync.ts` payload 不校验 UUID 格式（P0 真 BUG）

- **来源**：`qa/defects/2026-05-18-COSTRA-105-D1-real-test-findings.md` §2
- **登记时间**：2026-05-18 19:5x
- **范围**：`server/src/routes/sync.ts` line 93 `payload: { type: 'object', additionalProperties: true }` · 完全无 UUID format 校验 · 非法 UUID 直接喂 PG → 22P02 → 500（应返 400 BAD_REQUEST · `code: INVALID_ARGUMENT`）
- **修复方案**：阶段 1 在 schema 加 `properties: { ledger_id: { type: 'string', format: 'uuid' }, category_id: { type: ['string','null'], format: 'uuid' } }` + 加 1 个单测 case rejects-non-uuid · 阶段 2 由 COSTRA-155 完整 entry/ledger schema 校验补全
- **阻断级别**：**P0**（与 BUG-105-D1-LEDGER-ID-DEFAULT 联合触发链 · 单修任一即可止血 · 但 server 修复是 root fix · 防御未来其他客户端误传非 UUID 入参）
- **认领建议**：**COSTRA-105 R1.x.2**（D-017 v3 §2.4 E1 例外路径 · ≤ 30 分钟 · backend-dev · 单 commit 收尾 · 与 R1.x.1 同轮 · 互不依赖可并行）
- **状态**：`open`
- **owner_card**：COSTRA-105 R1.x.2（Orchestrator 派单中）

> 💡 **族 H 设计意图**：
> - **集中登记 Human 实测期发现的债务**（vs 族 A~G 的 Review/Card-Review 期发现）
> - **3 类内容混排**：FU（dev-only 调试钩子）+ BUG（client 端字段填充）+ BUG（server 端 schema 校验）—— 因为它们在同一次实测会话中根因关联（联合触发链）· 分散到不同族会丢失上下文
> - **后续族 H+ 维护**：每次 Human 真链路实测会话发现的 BUG/FU 集中追加（按时间线 · 不同会话隔行分组）

---

## 🌐 族 I · QA 流程治理（占位 · 当前空 · 留 Sprint-2 末 Retro 议题落地）

> **族说明**（占位）：本次实测会话暴露 4 项跨族议题（手册写作 dry-run 强制 / scope gap 跨卡 fall-through / server 单测 fuzz 缺失 / CI schema 对账 E 规则候选）· 待 Sprint-2 末 Retro 决议落地后转 FU 入此族 · 详见 `qa/defects/2026-05-18-COSTRA-105-D1-real-test-findings.md` §6。

---

_本文件由 Orchestrator 按需追加；不直接编辑，仅在 Agent Revision Response 产出时同步新增条目。已闭合条目归档至 `.team/_archive/follow-ups-closed-sprint-1.md`。_
