# DB 全表运营风险审查（立卡前案）

> **状态**：📋 立卡前案（pre-work · 未进入 Sprint 认领）
>
> **触发线索**：2026-05-08 Human 在 COSTRA-102 本地 server 验证期间提出
>
> **关联 FU**：`FU-DB-OPS-AUDIT`（见 `.team/follow-ups/README.md`）
>
> **触发立卡的可观察阈值**：
> - DAU > 100 时启动该卡（`user_sessions` 估算 · 一年 18 万行 · 仍轻量但应建立机制 · 不要等到撞 GB 级才回头补）
> - 或 Sprint-2+ DBA 体检窗口
>
> **认领建议**：Sprint-2+ Backend-Agent 主驾 · DevOps 协同（清理 job 落 cron）

---

## §1 触发背景

COSTRA-102 本地 server 通路验证时 · 发现登录 / 登出每次会向 `user_sessions`（见 `server/db/migrations/0003_user_sessions.sql`）写入一行 · 引出疑问"持续累积是否会膨胀过快"。

但问题不止 `user_sessions` —— 本仓 12 张表 + audit_logs 分区表 + idempotency_keys 都需要按"运营态健康度"统一审查。

**阻断级别**：P3（治理 · 不阻当前任何卡 · MVP 量级 ~10 用户无感）

---

## §2 审查范围（横切 · 必须全表覆盖 · 不可单表治理）

### 2.1 持续追加型表（核心风险）

| 表 | 风险点 | 现状 |
|---|---|---|
| `audit_logs` | 持续追加 | ✅ 已有月分区先例（`0001_init.sql:184-192`）· 可作其他表的范本 |
| `idempotency_keys` | 持续追加 | ⚠️ 已有 `expires_at` 但**无清理 job** · `TTL_IDEMPOTENCY_HOURS=24` 在 `.env.example` · 但 `server/db/` 下找不到 `DELETE FROM ... WHERE expires_at<now()` 的实装路径 |
| `subscription_messages` | 持续追加 | ⚠️ 无 `deleted_at` · 无清理路径 |
| `user_sessions` | 持续追加 | ⚠️ 见 `0003_user_sessions.sql` · 部分索引已有上界 · 但表本身无清理 |

### 2.2 软删表（次要风险）

| 表 | 风险 |
|---|---|
| `users` / `families` / `ledgers` / `categories` / `entries` / `budgets` | `deleted_at` 仅做软删 · 实际物理空间从未释放 · 需评估"软删后 N 天硬删"策略（GDPR / 隐私合规也涉及 · 见 `docs/PRD.md`）|

### 2.3 关联记录爆炸点

| 表 | 关注点 |
|---|---|
| `entries` | `idx_entries_ledger_occurred` 部分索引随活跃用户线性增长 · 家庭多人多账本场景下需评估每月分区或冷热分离 |
| `audit_logs` | 已分区但**未声明滚动创建策略** · `0001_init.sql:186` 注释只说"按月滚动创建" · 实际由谁/在哪触发 `CREATE TABLE audit_logs_yYYYYmMM` 未定 |

---

## §3 立卡时必须输出的清单

| ID | 交付物 |
|---|---|
| **A** | 每张表的"年增长行数估算公式"（如 `user_sessions: DAU × 5 次/天 × 365`）|
| **B** | 每张表的"清理/归档策略"决策（DELETE / 分区 detach / 冷热分离 / 硬删 / 永留）|
| **C** | 索引膨胀评估（部分索引 vs 全索引 · 在持续写入下的实际上界）|
| **D** | 容量阈值告警机制（什么 DAU 量级触发立案 · 如 1000 DAU / 100k entries / 10GB audit_logs）|
| **E** | 与 `docs/PRD.md` / 隐私合规 / GDPR 的对齐（用户注销时的数据保留期）|

---

## §4 user_sessions 单表锚点细节

### 4.1 容量估算

- 每行约 100~120 字节 + 两个部分索引开销 → **~250 字节/行**
- 单用户日均增量上限：**~5 行/天**（按 5 次冷启 wx.login 估算）
- 1 万 DAU × 5 行/天 × 365 = **1825 万行/年 ≈ 4.4 GB/年**（含索引）
- MVP（~10 用户）一年 ~9000 行 / ~2 MB · 完全无感 · 不紧急

### 4.2 已有的先天保护

- 主键 `jti UUID` · `WHERE jti = $1` 走 B-tree O(log n) · 不受表大小拖累
- `idx_user_sessions_user_active` 是部分索引 `WHERE revoked_at IS NULL` · 索引大小 ≈ 当前活跃 session 数（有上界）
- `refresh_token` 30 天后 `expires_at` 自然失效 · 业务侧不再命中

### 4.3 待立卡时确认的具体问题

1. **缺清理 job**：表注释（`0003_user_sessions.sql:34`）说"按 expires_at 批量清理过期 session" · 但实际 DELETE 路径未实装 · 未找到 cron / pg_cron / 应用层调度入口
2. **`idx_user_sessions_expires` 设计反讽**：该索引带 `WHERE revoked_at IS NULL` 过滤 · 意味着"已吊销 + 已过期的行"恰好不在这个索引里 · 反而让批量清理 SQL `DELETE FROM user_sessions WHERE expires_at < now()` 走全表扫 · 立卡时需评估是否调整索引谓词为 `revoked_at IS NOT NULL OR expires_at < now()` 或干脆做无谓词全索引
3. **用户注销时的级联删除**：当前 `ON DELETE CASCADE` 依赖 `users` 真删（硬删）· 但 `users` 是软删模式 · 所以注销用户的 session 实际**不会被级联清** · 与隐私合规期望可能不一致

---

## §5 当前事实源（立卡时一并复核）

- `server/api/openapi.yaml`（接口侧无清理端点 · 也不需暴露）
- `docs/api/audit-log.md`（`audit_logs` 写入规则 · 但未定保留期）
- `.env.example` `TTL_*`（部分 TTL 已声明 · 但实装侧未必接到清理逻辑）
- `docs/api/conflict-strategy.md`（软删的 LWW + 审计 · 影响硬删策略选型）
- `server/db/migrations/0001_init.sql`（schema 主体 + audit_logs 分区先例）
- `server/db/migrations/0003_user_sessions.sql`（user_sessions schema）

---

## §6 历史

- 2026-05-08 19:1x · Human 在 COSTRA-102 本地 server 验证时提出 · 留 SQL 末尾 TODO 注释（49 + 33 行）
- 2026-05-08 20:12 · COSTRA-128 同卡簇收官后 Orchestrator 搬迁到本文档 · SQL 仅留 1 行指针 · 登记 FU-DB-OPS-AUDIT
