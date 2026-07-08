# DB / Redis 全表数据膨胀审查报告

> **审查日期**：2026-07-07
> **数据来源**：正式环境数据库备份（本地 `postgres://costra@localhost:5432/costra`）实测 + 全量代码路径审查
> **关联**：`docs/db/ops-risk-audit-todo.md`（立卡前案 · 本报告为其 §3 交付物 A~E 的落地）
> **结论一句话**：真正在无界累积的只有 **1 张表（`idempotency_keys`）**；其余"疑似膨胀点"要么是**伪风险**（功能未实装），要么是**慢速累积**（MVP 无感但需建机制）。根因是"**清理逻辑齐备、调度器全缺**"。

---

## §1 实测现状（备份库快照）

### 1.1 全表体量（按物理大小降序）

| 表 | 行数 | 物理总大小 | 说明 |
|---|---|---|---|
| `entries` | 248 | 312 kB | 核心业务表 · 26 行软删 |
| `idempotency_keys` | 418 | 248 kB | ⚠️ **393/418（94%）已过期未清** |
| `categories` | 107 | 152 kB | 系统预设 91 + 家庭自定义 · 0 软删 |
| `users` | 27 | 80 kB | 0 软删 |
| `families` | 40 | 80 kB | 11 软删 |
| `user_sessions` | 235 | 80 kB | 26 已吊销 · 0 过期 |
| `family_invites` | 10 | 64 kB | 9 过期 / 7 已用 |
| `ledgers` | 40 | 64 kB | 0 软删 |
| `family_members` | 47 | 56 kB | 17 已离开（left_at 非空）|
| `category_redirects` | 2 | 48 kB | — |
| `announcement_reads` | 4 | 40 kB | — |
| `audit_logs_*`（3 分区）| **0** | 各 40 kB | ⚠️ **全空 · 见 §2.2** |
| `budgets` | 0 | 40 kB | 功能未使用 |
| `announcements` | 3 | 32 kB | — |
| `subscription_messages` | **0** | 32 kB | ⚠️ 功能未实装 |

**总体**：整库 < 2 MB，MVP 量级完全无压力。膨胀是**趋势性**问题，不是当前问题。

### 1.2 Redis 现状

- 唯一 key 模式：`refresh:{jti}`（`authService.ts:74`），`SET ... EX (refreshTtl+60)` 写入，登出 `DEL`。
- **自带 TTL → 到期自动淘汰 → 无膨胀风险**。
- 限流令牌桶（`redis.ts` 注释里的 "Sprint-2 落地"）实际**未实装**，无遗留 key。

---

## §2 根因分析：不是"设计缺失"，是"调度缺失"

### 2.1 唯一确证的膨胀源：`idempotency_keys`（P1）

- 每次带 `Idempotency-Key` 的写请求（记账 / sync）都 `INSERT`（`idempotencyService.ts:102 save()`），TTL 24h 写在 `expires_at`。
- 清理函数 **`idempotencyService.cleanup()` 存在**（`:117`，`DELETE ... WHERE expires_at < now()`），但**全代码库无任何调用点**——注释挂着 `FU-104-IDEMPOTENCY-CRON`（DevOps 负责），该 FU 从未落地。
- 实测：6-08 到 7-06 的记录**一条没删**，94% 是死数据。
- **增长模型**：`日写请求数 × 保留天数`。1000 DAU × 20 写/天 → 若永不清理，一年 ≈ 730 万行。清理后稳态仅 ≈ 2 万行（24h 窗口）。这是**清理 vs 不清理相差 300+ 倍**的表。

### 2.2 伪风险：`audit_logs`（需澄清 · 非膨胀）

- 立卡前案假设它"持续追加膨胀"，**实测 0 行**。
- 全 server 代码**没有任何 `INSERT INTO audit_logs` 路径**（仅出现在 `config/subject.ts` 主体红线占位 / README / migration）。**审计功能根本没接入写入**。
- 真正的隐患是另一面：分区只建到 `audit_logs_y2026m06`（`0001_init.sql:374-388`），**7 月及以后无分区**。"按月滚动创建"注释存在但**无实装**。→ 一旦审计写入被接上，`occurred_at` 落在 2026-07 的 INSERT 会因 `no partition found` **直接报错**。
- 属于"哑功能 + 定时炸弹"，不属于膨胀。需产品决策：审计到底做不做。

### 2.3 慢速累积（P2 · MVP 无感 · 需建机制）

| 表 | 累积源 | 现状 | 备注 |
|---|---|---|---|
| `user_sessions` | 每次签发 refresh 写一行 | 无清理 · 26 已吊销堆积 | `idx_user_sessions_expires` 带 `WHERE revoked_at IS NULL`，导致 `DELETE WHERE expires_at<now()` **走全表扫**（吊销行不在索引里）|
| `family_invites` | 每次邀请写一行 | `familyInviteRepo` 只在取消时按 `id` 删（`:158`），**无按 expires_at/used_at 批量清理** |
| `subscription_messages` | 每次订阅授权写一行 | UNIQUE 键含 `authorized_at`，同模板反复授权会**多行累积** · 但目前 0 行 |

### 2.4 软删空间不回收（P3 · 合规相关）

- `users/families/ledgers/categories/entries/budgets` 全部 `deleted_at` 软删，**物理空间永不释放**。
- 实测：`entries` 26 行软删、`families` 11 行软删。当前无感。
- 关联 GDPR / 用户注销数据保留期（`docs/PRD.md`）：注销用户因 `users` 软删，`ON DELETE CASCADE` 不触发 → session / 明细**不会级联清**，与隐私预期可能不符。

---

## §3 交付物 A：年增长行数估算公式

| 表 | 公式 | 有清理时稳态 | 无清理一年（1000 DAU）|
|---|---|---|---|
| `idempotency_keys` | 日写请求 × 保留天 | 日写 × 1（24h 窗口）≈ 2 万 | ≈ 730 万 ⚠️ |
| `user_sessions` | DAU × 冷启次数/天 × 365 | 活跃 session 数（有界）| ≈ 1825 万（含吊销）|
| `family_invites` | 建家庭次数 × 邀请人数 | 待处理邀请数（极小）| 线性小量 |
| `audit_logs` | 写操作数 × 保留期 | 分区滚动 · 老分区 detach | （当前 0 · 未写入）|
| `entries`（软删） | 记账数 × 删除率 | 硬删后仅活跃行 | 只增不减 |

---

## §4 交付物 B~E：分级解决方案（供评估）

### 核心判断
项目**已经具备清理所需的一切**（`expires_at`/`revoked_at`/`deleted_at` 列 + `cleanup()` 函数），缺的只是**一个统一的维护调度入口**。因此方案应聚焦"**建一个干净的调度层**"，而非到处补硬删 SQL。

### 4.1 调度载体三选一（请评估选型）

| 方案 | 载体 | 优点 | 缺点 | 适配度 |
|---|---|---|---|---|
| **A · pg_cron** | Postgres 扩展，DB 内定时跑 SQL | 零应用改动 · 与数据同源 · 重启不丢 | 需 DB 装扩展（prod 是自建容器，可控）| ⭐ 推荐 |
| **B · 系统 cron + psql 脚本** | `infra/scripts/maintenance.sh` + `/etc/cron.d` | 与现有 certbot/backup cron 同构 · 运维可见 | 又多一个 cron 文件 · 跨容器执行需 `docker exec -T` | ⭐ 次选 |
| **C · 应用内调度** | server 启动挂 `node-cron`/`setInterval` | 部署即生效 · 无需碰 DB/宿主机 | 多实例会重复跑（需加分布式锁）· 与 web 进程耦合 | 适合单实例 MVP |

> 建议：**A（pg_cron）为主**——它天然解决"多实例重复执行"和"重启丢任务"，且清理任务本就是纯 SQL。若不想给 DB 装扩展，退 B（与现有 `backup-db.sh` cron 风格一致，运维心智统一）。

### 4.2 统一维护任务清单（无论选哪种载体，任务集相同）

| 任务 | SQL / 动作 | 频率 | 依赖前置改动 |
|---|---|---|---|
| T1 清幂等键 | `DELETE FROM idempotency_keys WHERE expires_at < now()` | 每小时 | 复用现成 `cleanup()` |
| T2 清过期 session | `DELETE FROM user_sessions WHERE expires_at < now()`（删所有已过期行 · 含已吊销的过期行）| 每日 | **需先改 §4.3 索引** |
| T3 清失效邀请 | `DELETE FROM family_invites WHERE expires_at < now() OR used_at IS NOT NULL` | 每日 | 新增 repo 方法 |
| T4 审计分区滚动 | `CREATE TABLE IF NOT EXISTS audit_logs_yYYYYmMM ...`（滚动建下月分区）| 每月 | 与"审计是否启用"决策绑定 |
| T5 老分区归档 | `DETACH PARTITION` + 导出冷存 / DROP | 保留期到 | 需定保留期（建议 12 个月）|

### 4.3 索引修正（配合 T2 · 消除全表扫）

当前 `idx_user_sessions_expires ON (expires_at) WHERE revoked_at IS NULL` 的谓词让"已吊销"行落在索引外，清理 SQL 反而全表扫。建议改为**无谓词全索引**或谓词对齐清理语义：

```sql
DROP INDEX idx_user_sessions_expires;
CREATE INDEX idx_user_sessions_expires ON user_sessions (expires_at);
```

> 注意 MEMORY 里的 pg-mem 双写约定：约束性 DDL 改动需同步 `server/test/setup.ts`。本索引为纯性能索引且未在 setup.ts 建模，不影响 pg-mem 行为，故无需同步（保持当前测试基线 222）。

### 4.4 软删硬删策略（交付物 B/E · 需产品拍板保留期）

- 建议引入统一 `deleted_at < now() - interval 'N days'` 的**延迟硬删**（默认 N=90，合规安全期）。
- 注销用户：由于 `users` 软删阻断了 CASCADE，需在硬删 job 里显式级联清该用户的 `user_sessions` / `subscription_messages`，与 GDPR 保留期对齐。
- 此项风险最高（真删不可逆），建议**最后做**，且先只对 `idempotency_keys`/`user_sessions` 这类无引用表开刀，`entries` 等业务表留到有明确合规需求再动。

### 4.5 容量阈值告警（交付物 D）

将阈值挂到 `infra` 已规划的 `postgres_exporter + Prometheus`（`prod-bootstrap-compose.md` FU-PROD-MONITORING）：

| 指标 | 立案阈值 |
|---|---|
| `idempotency_keys` 行数 | > 5 万（说明 T1 未在跑）|
| `user_sessions` 行数 | > 10 万 |
| 单分区 `audit_logs` 大小 | > 1 GB |
| DAU（`user_sessions` 估算）| > 100 触发本审查正式立卡 |

---

## §5 建议的落地顺序（增量 · 每步独立可验证）

1. **P1 · 立即**：接上 `idempotencyService.cleanup()` 调度（选 §4.1 载体）——唯一真实膨胀源，改动最小、收益最大。
2. **P1 · 同批**：`audit_logs` 决策——要么补上"月度分区滚动 + 审计写入"，要么明确"暂不启用"并在 migration 注明（拆掉定时炸弹）。
3. **P2**：session / invite 清理任务 + §4.3 索引修正。
4. **P3**：软删硬删策略（需产品定保留期）+ 阈值告警接入监控。

---

## §6 待你评估的决策点

1. **调度载体**：A（pg_cron）/ B（系统 cron 脚本）/ C（应用内）——倾向哪个？
2. ~~**audit_logs**~~：✅ **已决策 · 暂不处理（2026-07-07）**——审计写入本就未实装，属哑功能；MVP 阶段暂缓，分区炸弹待真正启用审计时再一并处理。
3. **软删保留期**：硬删延迟 N 天设多少？是否现在就做，还是等合规需求？
4. 是否需要我按选定方案**直接实装**（含 migration + 测试 setup 双写 + infra 脚本/cron）？

---

## §7 附录 · idempotency_keys + user_sessions 清理落地详案

> 决策边界：audit_logs 暂缓，本轮只处理这两张表。索引修正与清理 SQL **与调度载体无关**。

### 7.1 前置事实（部署实际）
- 生产 PG = `postgres:15-alpine`（官方镜像 · **不含 pg_cron**）；compose 有 `command:` 可加启动参数、`initdb.d` 装扩展约定。
- 已有成熟 cron 体系：`backup-db.sh`（cron 每 4h）、`psql-exec.sh`（封装容器内执行 SQL）。

### 7.2 清理 SQL（核心 · 两方案通用）

```sql
-- idempotency_keys：复用现成 idempotencyService.cleanup() 的语义；idx_idempotency_expires 无谓词 → 走索引
DELETE FROM idempotency_keys WHERE expires_at < now();          -- 每小时

-- user_sessions：删除所有已过期 session（含已吊销的过期行）· 单条件走 idx_user_sessions_expires
-- 已吊销未过期行不影响业务（findActive 过滤 revoked_at），随其 expires_at 自然过期后被删
DELETE FROM user_sessions
 WHERE expires_at < now();  -- 每日
```

### 7.3 必做的索引修正（收益最高单点）
现 `idx_user_sessions_expires ... WHERE revoked_at IS NULL` 把"已吊销"行排除在索引外，导致清理 SQL 全表扫。改无谓词：
```sql
DROP INDEX IF EXISTS idx_user_sessions_expires;
CREATE INDEX IF NOT EXISTS idx_user_sessions_expires ON user_sessions (expires_at);
```
⚠️ 该索引为纯性能索引且未在 `server/test/setup.ts` 建模，不影响 pg-mem 行为，无需同步 setup.ts（保持测试基线 222）。

### 7.4 pg_cron 落地（方案 A）
1. `infra/postgres/Dockerfile`：`FROM postgres:15` + `apt-get install postgresql-15-cron`（Alpine 无官方包，需换 Debian 基础镜像；数据目录 PG15 主版本一致可直接复用）。
2. compose：`build: ./postgres` + `command` 加 `-c shared_preload_libraries=pg_cron -c cron.database_name=costra` + **重启 PG**。
3. migration `0009_pg_cron.sql`：`CREATE EXTENSION pg_cron` + `cron.schedule(...)`（注册前先 `cron.unschedule` 保幂等）。
4. **额外**：`cron.job_run_details` 自身会膨胀，须再挂一个 job 清 7 天前历史。

### 7.5 系统 cron 脚本（方案 B · 更契合本项目）
- 新增 `infra/scripts/maintenance.sh`（复用 `psql-exec.sh` 容器执行逻辑），跑 §7.2 两条 DELETE。
- 挂 `/etc/cron.d/costra-maintenance`：幂等键每小时、session 每日 03:30。
- 优点：零镜像改动、零 PG 重启、无 job_run_details 二次坑、运维心智与 backup-db.sh 一致。

### 7.6 载体对比结论
| 维度 | pg_cron | 系统 cron 脚本 |
|---|---|---|
| 镜像/重启 | 换镜像+重启 PG | 无 |
| 二次膨胀 | 有（job_run_details）| 无 |
| 与现有体系契合 | 新增机制 | 复用现成脚本 |
| 可观测 | `cron.job_run_details` | `/data/logs/maintenance.log` |

**建议**：方案 B 更贴合当前 alpine 栈 + 成熟 scripts 体系；索引修正无论选哪个都必做。
