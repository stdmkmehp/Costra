# Sprint-1 计划 · Costra 单人记账端到端 + G3 补齐

- **周期**：2026-04-23 ~ 2026-05-06（2 周，10 个工作日）
- **起草**：Orchestrator · 2026-04-22 16:50
- **基线决策**：`.team/decisions/D-006-human-approvals-g2-g3.md`
- **速度约束**：charter §5 规定 ≤ 40 工时 / sprint，本 sprint 估点 29 点（约 29~35 工时），✅ 合规

---

## 🎯 Sprint Goal（单一聚焦目标）

> **实现"微信登录 → 首页 → 记一笔 → 本地落库 → 云同步成功"的最小闭环**，覆盖主链路 Epic-A（账号）+ Epic-B（单人记账）+ Epic-C（本地+同步）的核心路径；同时补齐 G3 契约遗留缺口，为 Sprint-2 家庭共享做准备。

**Definition of Done**：
1. 真实微信登录（非 Mock）可通，拿到 access_token/refresh_token
2. 记一笔的数据能在服务端 `entries` 表查到
3. 断网记账 → 联网后 10 秒内自动 `/sync/push` 成功
4. QA 执行冒烟用例 S-01 ~ S-08 全部通过
5. G3 补齐 5 项全部 approve

---

## 📋 卡片明细

### COSTRA-100 · G3-gaps-plus 契约补齐 🔴 P0

- **Owner**：Backend-Agent
- **估点**：3
- **DoD**：
  - `docs/api/error-codes.md` 独立交付（12+ 错误码）
  - `api/openapi.yaml` 补 `ErrorCode` 枚举 + 登录/刷新响应 TTL 字段
  - `docs/api/id-strategy.md` 交付（ULID 规范 + 幂等机制 + 兜底）
  - `docs/api/sync-protocol.md` 交付（批量协议 + 离线场景）
  - `docs/api/README.md` 目录索引更新
- **闸门**：Human approve:COSTRA-100 后转 Done
- **时间盒**：D1（2026-04-23）18:00 前

### COSTRA-101 · 微信登录服务端实装

- **Owner**：Backend-Agent
- **估点**：5
- **依赖**：COSTRA-100（ErrorCode/TTL 定义稳定）
- **DoD**：
  - `/auth/login`（code → session_key → user + token 对）
  - `/auth/refresh`（refresh_token → access_token）
  - `/auth/logout`（refresh_token → 立即吊销）
  - `users` / `user_sessions` 表 CRUD 打通
  - Redis 缓存 wx_session_key（3 天 TTL）
  - 单测覆盖 3 条主路径 + 4 条错误路径（过期/重复/篡改/解密失败）

### COSTRA-102 · MiniApp 登录端到端

- **Owner**：MiniApp-Agent
- **估点**：5
- **依赖**：COSTRA-101
- **DoD**：
  - `pages/login/index` 调用 `wx.login()` → `/auth/login` 拿到 token
  - token 存 `wx.setStorageSync`（refresh_token 加密）
  - `utils/request.ts` 自动注入 Authorization + 静默刷新
  - 首页展示用户昵称 + 家庭占位
  - 已有 camelCase ↔ snake_case 映射层激活
  - 登出按钮 → `/auth/logout` → 清本地 → 跳登录

### COSTRA-103 · 本地持久化 + outbox_queue

- **Owner**：MiniApp-Agent
- **估点**：5
- **依赖**：COSTRA-100（sync-protocol 规范）
- **DoD**：
  - `services/db` 基于 `wx.cloud` 或 IndexedDB 抽象的 entries / outbox 表
  - `services/outbox.ts`：入队 / 出队 / 指数退避 / 网络事件钩子
  - `utils/id.ts`：ULID 生成（monotonic 模式）
  - 单测：离线记 3 笔 → 联网 → 全部推送成功

### COSTRA-104 · 记账 CRUD + 批量同步接口

- **Owner**：Backend-Agent
- **估点**：6
- **依赖**：COSTRA-100 / COSTRA-103
- **DoD**：
  - `POST /entries`（单条，UPSERT + Idempotency-Key）
  - `GET /entries` 分页 + 游标
  - `PATCH /entries/:id`（version 校验）
  - `DELETE /entries/:id`（软删 + version）
  - `POST /sync/push` 批量（事务 + accepted/conflicts 返回）
  - 集成测试：模拟 4 种客户端场景（首次/增量/冲突/离线攒单）

### COSTRA-105 · 单人闭环冒烟

- **Owner**：QA-Agent
- **估点**：3
- **依赖**：COSTRA-102 / COSTRA-104
- **DoD**：
  - 执行 `docs/qa/smoke-cases.md` S-01 ~ S-08
  - 额外补充：弱网 3 种场景（2G / 频繁断连 / 飞行模式回归）
  - 出具 `docs/qa/sprint-01-report.md`

### COSTRA-106 · Sprint-0 Retro + 工程度量

- **Owner**：PM-Agent
- **估点**：1
- **依赖**：D-006
- **DoD**：
  - `.team/sprints/sprint-00-retro.md`（已做/待改进/行动项各 3 条）
  - `metrics.json` 刷新（velocity / review-throughput / decision-lead-time）

### COSTRA-107 · ICP 备案辅助文档

- **Owner**：PM-Agent
- **估点**：1
- **依赖**：无
- **DoD**：
  - `docs/ops/icp-checklist.md`（主体材料 / 时间轴 / 关键回执 / 20 工作日节奏提醒）
  - 同步更新 charter §9 外部资源进度
- **目的**：协助 Human 今日即可启动 ICP，避免 20 工作日关键路径堵塞 Sprint-2 真实上线

---

## 📅 时间节奏（按工作日）

```
W1
D1 (04-23) ├─ COSTRA-100 Backend 补齐 5 项 → Human review
           └─ COSTRA-106 PM Retro
           └─ COSTRA-107 PM ICP 清单
D2 (04-24) ├─ COSTRA-101 Backend 登录实装 开工
D3 (04-25) └─ COSTRA-101 完成 + 自测
D4 (04-28) ├─ COSTRA-102 MiniApp 登录端到端 开工
           ├─ COSTRA-103 MiniApp 本地存储 开工
D5 (04-29) └─ COSTRA-102 / 103 联调

W2
D6 (04-30) ├─ COSTRA-104 Backend CRUD + 批量 开工
           ├─ Human 中点验证 COSTRA-102 端到端
D7 (05-04) └─ COSTRA-104 完成 + 联调
D8 (05-05) ├─ COSTRA-105 QA 冒烟
D9 (05-06) ├─ G4 合并闸门 review
           └─ Sprint-1 收官 + Sprint-2 预启动会
```

---

## ⚠️ 风险与对策

| 风险 | 概率 | 影响 | 对策 |
|---|---|---|---|
| 微信 `code2Session` 返回异常 / 配额耗尽 | 中 | 高 | Backend 实装 retry + 降级提示；体验号 AppID 早日申请备用 |
| OpenAPI TypeScript codegen 字段映射错 | 中 | 中 | COSTRA-100 完成后立刻跑 codegen 冒烟 |
| 小程序包体超限（主包 2MB） | 低 | 中 | DevOps 的 size-check 脚本每次 PR 拦截 |
| ICP 备案延迟堵 Sprint-2 | 高 | 高 | COSTRA-107 今日启动，20 工作日倒推 |
| Redis 未部署导致 session 管理裸奔 | 中 | 高 | docker-compose 已包含，部署清单 doublecheck |

---

## 👤 Human 介入节点

| 日期 | 动作 | 预计耗时 |
|---|---|---|
| 2026-04-22（今日） | 发起 ICP 备案 | 15 分钟 |
| 2026-04-23 晚 | `approve:COSTRA-100`（G3 补齐产物） | 20 分钟 |
| 2026-04-30 | 本地手动验证 COSTRA-102 真实登录 | 20 分钟 |
| 2026-05-06 | G4 合并闸门决策 | 30 分钟 |

**本 sprint Human 总占用预估：≈ 90 分钟**，其余时间全部由 Agent 自驱。

---

## 🔁 Sprint 退出条件

- ✅ 8/8 卡进入 Done（或经 Human 明确 defer 到 Sprint-2）
- ✅ G4 合并闸门 Approved
- ✅ Sprint-1 Retro 落盘
- ✅ Sprint-2 草案起草（家庭共享 + 邀请码）

---

_Orchestrator 将在 PM-Agent 完成 COSTRA-106 Sprint-0 Retro 之后，广播 Sprint-1 开工。_
