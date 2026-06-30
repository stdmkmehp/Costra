# Costra 日志策略规范（Logging Strategy Spec）

> 状态：已实施 · 日期：2026-06-30 · 关联：客户端 `miniprogram/utils/logger.ts`、服务器 Fastify/pino、`infra/docker-compose.prod.yml`

本规范统一约束 Costra 客户端（微信小程序）与服务器（Fastify + pino）的日志行为，目标是：日志可读、信息全面、周期噪音可控、用户写操作可审计、长期运行不膨胀。

---

## 1. 设计目标

1. **可读**：日志时间戳人可直观读取。
2. **全面**：关键路径（尤其用户写操作）信息完整。
3. **周期降噪**：定时/轮询等周期逻辑的正常路径不在生产输出，只保留错误路径。
4. **读写分级**：非定时的用户写逻辑（记账、改分类/日期/金额）必须记录；只读逻辑只记异常路径。
5. **不膨胀**：服务器长期运行日志有轮转上限。

---

## 2. 决策记录

| # | 决策 | 结论 |
|---|------|------|
| A | release 客户端是否输出 info | **否**，release 仅输出 `warn`/`error` |
| B | 是否引入 `wx.getRealtimeLogManager` | **不引入**（console 无持久化，后续如需线上回捞再评估） |
| C | 服务器时间戳 | **保持 UTC ISO 8601**（`stdTimeFunctions.isoTime`），查看时用 `pino-pretty` 转本地 |
| D | 服务器请求日志策略 | **保留 Fastify 默认 access log + per-route 降级** |
| E | 客户端 console 迁移范围 | **全量替换**为统一 `logger` |
| — | 写操作日志脱敏 | **不脱敏**，要求字段详细（含金额/分类/日期/备注） |

---

## 3. 客户端日志

### 3.1 统一模块 `miniprogram/utils/logger.ts`

- 四级：`debug` / `info` / `warn` / `error`。
- 每条日志前缀**本地时间戳** `HH:mm:ss.SSS` + `[tag]` 模块前缀，形如：
  `14:23:01.482 [sync:pushDelta] sending {ops:3}`
- **生产门控**（按 `wx.getAccountInfoSync().miniProgram.envVersion`）：
  - `develop` / `trial`（及未知环境）→ 放行 `debug` 及以上（全开）。
  - `release` → 仅放行 `warn` / `error`。

### 3.2 分级规范

| 类别 | 级别 | 典型场景 | release 输出 |
|------|------|---------|------|
| 周期/心跳 | `debug` | periodic sync start/ok、network-recover、mutex skip、page-show 去抖 | 否 |
| 只读正常流程 | `debug` | `sync:pull` 请求/响应、outbox merge/drain 细节、ack 批次汇总 | 否 |
| 用户写操作 | `info` | outbox enqueue/ack OK、`sync:pushDelta`、登录、family preference saved | 否（dev/trial 可见） |
| 可恢复异常 | `warn` | sync fail、conflict 重试/耗尽、pull invalid、各类降级 fallback | 是 |
| 不可恢复 | `error` | dead-letter（数据丢失）、记账保存失败、页面加载失败 | 是 |

> 写操作日志**不脱敏**：`outbox:enqueue`、`sync:pushDelta` 逐 op 日志会附带完整 `payload`（金额、分类、日期、备注）作为结构化 data。

### 3.3 迁移范围（已全量替换 `console.*` → `logger`）

`services/`：`sync.ts`、`outbox.ts`、`syncScheduler.ts`、`auth.ts`、`family.ts`、`db.ts`、`storage.ts`、`prefetch.ts`、`categoryService.ts`、`eventBus.ts`；
根：`app.ts`；
页面/组件：`components/expense-overlay/index.ts`、`pages/family/index.ts`、`pages/statistics/index.ts`、`pages/profile-setup/index.ts`。

> 例外：`services/perf.ts` 保留独立（自带 records 快照 + envVersion 开关的性能埋点通道，不纳入 logger）。

---

## 4. 服务器日志

### 4.1 框架与时间戳

- Fastify 5 内置 pino；时间戳 `stdTimeFunctions.isoTime`（UTC ISO 8601）；每请求 `genReqId` 生成 trace_id。
- 默认级别 `info`（`LOG_LEVEL` 可调）。

### 4.2 healthz 降噪

`/healthz` 路由设 `{ logLevel: 'warn' }`：K8s/SLB 高频探针成功不再刷 info access log，探针失败（5xx）仍记录。

### 4.3 写操作审计日志（不脱敏、详细）

在写路由成功分支补结构化 `req.log.info`（trace_id 自动随 reqId 透传）：

- `entries.ts` POST → `action: 'entry.create'`，含 userId/entryId/ledgerId/type/amount/currency/categoryId/accountId/toAccountId/occurredAt/note/sharedType/version/clientRefId。
- `entries.ts` PATCH → `action: 'entry.update'`，含 baseVersion→newVersion + changedFields + 完整新值。
- `entries.ts` DELETE → `action: 'entry.delete'`，含 userId/entryId/baseVersion。
- `categories.ts` POST → `action: 'category.create'`，含 userId/familyId/categoryId/name/type/icon/color/parentId。

只读 GET 不加 info，异常由 `plugins/errorHandler.ts` 统一记录（AppError → warn，未识别 → error）。

---

## 5. 日志轮转（防膨胀）

| 服务 | 输出 | 轮转 |
|------|------|------|
| server (pino) | stdout → docker json-file | `max-size 100m × max-file 5`（已有） |
| nginx | **改为** `/dev/stdout`、`/dev/stderr` → docker json-file | 100m × 5 |
| postgres | stderr → docker | **新增** logging 100m × 5 |
| redis | **去掉** `--logfile`，改 stdout → docker | **新增** logging 100m × 5 |

> server 端 pino 日志本身长期运行不膨胀（500MB 上限滚动覆盖）；本轮修复的是 nginx 文件日志、redis.log、postgres docker logs 三处旁路膨胀点。

### 运维注意
- nginx 运行时配置位于宿主 `/data/conf/nginx`（由 `infra/scripts/05-start-stack.sh` 从 repo 模板复制）。改完模板需**同步 live 配置**并 `docker compose -f docker-compose.prod.yml restart nginx` 才生效。
- redis/nginx 改 stdout 后，`/data/logs/redis`、`/data/logs/nginx` 卷不再写入（保留挂载无害，可后续清理）。

---

## 6. 验证

- 客户端：`logger.ts` 单测可通过 `__test__.resetMinLevel()` 切换 envVersion 验证级别门控；现有 vitest 不依赖 console 断言。
- 服务器：`buildApp({ disableLogger: true })` 关 logger，新增审计日志不影响单测。
