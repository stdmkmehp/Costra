# ADR-0006：后端运行时（Go → Node.js + TypeScript）与主存储（MySQL → PostgreSQL 15）对齐

- **状态**：Accepted
- **决策日期**：2026-04-23
- **编号背景**：ADR-0005 已预留给"部署平台最终选型"（见 ADR-0002 §部署策略补丁，2026-04-22 · D-007），故本次独立变更占用 ADR-0006
- **触发卡**：COSTRA-100（D-006 §5 补齐项落盘）· Review-Tech Round-1 P0-3
- **追溯范围**：ADR-0002 §决策表"后端语言 / 后端框架 / 主存储" 三行
- **评审记录**：`.team/reviews/COSTRA-100/round-1-tech.md` P0-3

---

## 1. 背景（为什么过去是 Go + MySQL）

- ADR-0002 v1（2026-04-20，iOS 原生版）登记的后端选型为 **Go 1.22 + Gin + gRPC + MySQL 8.0**，理由是"高并发、事务、部署简单"。
- ADR-0002 v2（2026-04-21）因客户端由 iOS 原生切换为微信小程序而整体重写，但后端条目**原样保留**，未触发过单独评审。
- 到 2026-04-23 落盘 COSTRA-100 补齐项（`server/src/errors/ErrorCode.ts` / `server/src/config/subject.ts` / `server/api/openapi.yaml` / `docs/api/id-strategy.md` / `docs/db/schema.md`）时，**事实上的实现**出现以下与 ADR-0002 v2 的对立：

| 维度 | ADR-0002 v2 登记 | 实际落地（2026-04-23 工作区） | 证据 |
|---|---|---|---|
| 后端语言 | Go 1.22+ | TypeScript（Node.js 运行时） | `server/package.json` / `server/src/**/*.ts` / `server/tsconfig.json` |
| 后端框架 | Gin + gRPC | （MVP 暂未定型 HTTP 框架；OpenAPI 先行） | `server/api/openapi.yaml` 为契约事实源 |
| 主存储 | MySQL 8.0 | PostgreSQL 15 | `docs/db/schema.md` §0 "运行环境 PostgreSQL 15"；`server/db/migrations/0001_init.sql` 使用 `uuid` / `TIMESTAMPTZ` 等 PG 特性 |
| UUID 生成 | 未单独登记（隐含 v4） | **UUID v7**（应用层生成；后续切 `pg_uuidv7` 扩展） | `docs/api/id-strategy.md` |

**结论**：这是"**历史债显性化**"——决策已在实现中发生，但 ADR 长期未同步；Review-Tech 把这一漂移升级为 P0 要求本卡闭环。

---

## 2. 决策

### 2.1 后端运行时：**Node.js (LTS) + TypeScript 5.x**

- **语言**：TypeScript 5.x（严格模式 `strict: true`）
- **运行时**：Node.js 20.x LTS（生产）/ 18.x 兼容（开发下限）
- **包管理**：npm（工作区 `package.json` 已就位）
- **HTTP 框架**：**待 COSTRA-101 落定**（候选：Fastify 5.x / Hono 4.x / Express 5.x），OpenAPI 为契约事实源，框架选型不得破坏 `server/api/openapi.yaml` 契约
- **进程内 gRPC**：**本 MVP 不引入**。跨服务调用以 REST over HTTPS 承担；若 Sprint-N 出现性能瓶颈再评估 gRPC-node
- **热更新 / 测试**：tsx / vitest（测试框架跟随 MiniApp 侧 Jest 或独立定型，由 COSTRA-101 定案）

### 2.2 主存储：**PostgreSQL 15**

- **版本**：PostgreSQL 15.x（容器化；开发/测试/生产同版本）
- **金额类型**：`NUMERIC(18, 4)`（PG 原生精度，等价于 MySQL DECIMAL(18,4)）
- **时间类型**：`TIMESTAMPTZ`（UTC 强制，参见 ADR-0004 §时区）
- **UUID**：
  - MVP 阶段：应用层 `newId()`（`uuidv7` npm 包）生成 v7 字符串写入 `uuid` 列（与 `gen_random_uuid()` 产出格式兼容）
  - 下一阶段：升级 PG 16+ 并启用 `pg_uuidv7` 扩展，把各表 `DEFAULT` 改为 `gen_random_uuid_v7()`，应用层 `newId()` 保留用于离线场景（`client_ref_id`）
- **UUID 契约**：见 [`docs/api/id-strategy.md`](../../docs/api/id-strategy.md)（**事实源**）

### 2.3 迁移 / 运维

- `server/db/migrations/` 继续使用 `.sql` 文件；MVP 用节点脚本或 `node-pg-migrate` 驱动
- 备份策略、连接池、读写分离等条目由 DevOps-Agent 在 COSTRA-10x 的基础设施卡中落地，不在本 ADR 决议

---

## 3. 与 ADR-0002 的关系

本 ADR 对 ADR-0002 v2 §决策表执行**定点修订**（**不新开 v3**，保持 ADR-0002 的日期/修订历史清晰），具体修订见同步 patch：

- `后端语言`：`Go 1.22+` → `TypeScript 5.x + Node.js 20 LTS`（理由行补：见 ADR-0006）
- `后端框架`：`Gin + gRPC` → `REST 优先（HTTP 框架由 COSTRA-101 定案）；本 MVP 不引入 gRPC`
- `主存储`：`MySQL 8.0（DECIMAL(18,4) 存金额）` → `PostgreSQL 15（NUMERIC(18,4) 存金额）`

其他行**保持不变**（客户端栈、鉴权、缓存、消息、对象存储、CI/CD、监控、部署架构约束均继续生效）。

---

## 4. 影响面清单

| 受影响对象 | 变更动作 | 负责方 |
|---|---|---|
| `ADR-0002-tech-stack.md` | 定点修订 3 行 + 追加 "2026-04-23 · ADR-0006" 补丁段 | Backend-Agent（本卡） |
| `docs/db/schema.md` | P8 改写为 UUID v7；§0 头部保持 PostgreSQL 15；全表 `gen_random_uuid()` 表述改为应用层 `newId()` | Backend-Agent（本卡 Round-2 已完成） |
| `docs/api/id-strategy.md` | 已就位，无需再改 | — |
| `docs/api/README.md` | UUID 行已更新 | Backend-Agent（本卡 Round-2 已完成） |
| `server/Dockerfile` | 需要以 Node.js 20 base image，**而非** Go toolchain；DevOps 在 COSTRA-13x 做 | DevOps-Agent |
| `server/db/migrations/**` | SQL 需校验 PG 语法（`UUID` 类型 / `TIMESTAMPTZ` / `ON CONFLICT` 等），**禁止** MySQL-only 语法 | Backend-Agent |
| `docker-compose.yml` | 数据库容器应为 `postgres:15-alpine`（或带 `pg_uuidv7` 的镜像），**不得**为 `mysql:8.0` | DevOps-Agent |
| `.env.production.example` | 补齐 `DATABASE_URL=postgres://...`（不出现 `mysql://`） | Backend-Agent |
| MiniApp 侧 | 无直接影响（契约不变，`format: uuid` 兼容 v4/v7） | — |

---

## 5. 代价与风险

- **PostgreSQL vs MySQL 运维差异**：团队若过去偏 MySQL 运维经验（备份、主从、慢查询分析），需要补齐 PG 侧工具链（`pg_dump` / `pg_basebackup` / `pg_stat_statements` / 逻辑复制等）。**缓解**：MVP 期单节点 docker-compose 部署，Sprint-2 末再决策云侧托管方案（见 ADR-0002 §部署策略补丁 + 规划中的 ADR-0005）
- **Node.js 单线程模型**：CPU-bound 场景（大批报告生成）不如 Go 高效。**缓解**：Costra MVP 场景为 I/O bound（记账、同步、查询），Node.js 足够；后续若出现 CPU-bound 需求走独立 worker
- **UUID v7 库依赖**：MVP 依赖 `uuidv7` npm 包，后续切 `pg_uuidv7` 扩展时需要双写过渡。**缓解**：id-strategy.md §6 已说明迁移兼容性

---

## 6. 被替代 / 废弃

- ADR-0002 v2 §决策表中"后端语言 = Go 1.22+ / 后端框架 = Gin + gRPC / 主存储 = MySQL 8.0" **三行**自本 ADR 生效日起作废；所有 Agent **不得**再以这三行作为假设前提

---

## 7. 验证路径（Review 可核验的 Anchor）

| 断言 | 核验方法 |
|---|---|
| 工作区 `server/` 下不再存在 `.go` 源文件 | `rg --files -g '*.go' server/` 无结果 |
| `docs/db/schema.md` 不再出现 `gen_random_uuid()`（除了迁移说明上下文） | `rg 'gen_random_uuid' docs/db/schema.md` |
| `docs/api/README.md §1` UUID 行指向 v7 + id-strategy.md | grep |
| `docs/api/id-strategy.md` §1 明确 v7 | 已存在 |
| ADR-0002 §决策表三行完成修订，并带 "见 ADR-0006" 引用 | grep `ADR-0006` |

---

## 8. 相关文档

- [`ADR-0002-tech-stack.md`](./ADR-0002-tech-stack.md)（被修订）
- [`ADR-0004-*`](./)（金额 / 时区 / 审计——硬性约束在 PG 上等价实现）
- [`docs/api/id-strategy.md`](../../docs/api/id-strategy.md)（UUID v7 事实源）
- [`docs/db/schema.md`](../../docs/db/schema.md)（Schema 事实源）
- [`.team/reviews/COSTRA-100/round-1-tech.md`](../reviews/COSTRA-100/round-1-tech.md)（P0-3 触发原文）

---

## 9. 修订历史

| 版本 | 日期 | 变更 |
|---|---|---|
| v1.0 | 2026-04-23 | 首版。由 COSTRA-100 Round-2 Backend-Fix 发起，闭环 Review-Tech Round-1 P0-3 |
