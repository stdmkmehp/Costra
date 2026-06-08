# 任务派单 · COSTRA-021 DB Schema v1 + Docker Compose 本地环境

> ✅ **DONE**（Orchestrator `execute-now` 代笔落地 · 2026-04-21 17:45）
> 产物回链：`server/db/migrations/0001_init.sql` · `server/db/migrations/0002_seed_system_categories.sql` · `server/docker-compose.yml` · `server/package.json` · `server/README.md` · `docs/db/schema.md` · `.env.example`
> 闸门：**G3 Ready for Review**（随 COSTRA-020 同批双签）

---

- **Owner**: Backend-Agent
- **Priority**: P0
- **派发时间**: 2026-04-21 15:29（Orchestrator）
- **完工时间**: 2026-04-21 17:37（Orchestrator 代笔）
- **依赖**: COSTRA-020 OpenAPI（字段命名对齐）、`ADR-0004` §8 金额 / §10 时区
- **产物路径**: `server/db/migrations/`、`server/docker-compose.yml`、`docs/db/schema.md`
- **预计工期**: 1 个工作日

---

## 1. 目标

1. 可执行的 **v1 初始建表迁移脚本**（PostgreSQL 15）
2. 本地一键启动的 **docker-compose.yml**（Postgres + Redis + MinIO 可选）
3. ER 图 + 关键字段说明

## 2. 表清单（v1 最小集）

| 表 | 说明 |
|---|---|
| `users` | 微信 openid / unionid / phone / nickname |
| `families` | 家庭（邀请码 / 创建者 / 成员数） |
| `family_members` | 用户-家庭关联 + 角色（owner/admin/member） |
| `accounts` | 资金账户 |
| `categories` | 分类（系统预置 + 用户自定义） |
| `ledger_entries` | 流水主表 |
| `sync_versions` | 每用户/每家庭的版本号游标（同步引擎） |
| `audit_logs` | 审计（家庭变更 / 敏感写入） |
| `subscribe_tokens` | 订阅消息一次性 token（Epic-D/E） |
| `feature_flags` | 运行时 Flag（ADR-0004 §7） |

## 3. 验收标准（AC）

### AC-1 Schema 正确性
- [ ] 金额字段统一 `BIGINT` 存分；币种 `CHAR(3)`；时间戳 `TIMESTAMPTZ`（见 ADR §10 时区）
- [ ] 所有表包含 `created_at / updated_at / deleted_at`（软删除）+ `version BIGINT`（乐观锁）
- [ ] 必要唯一键 / 外键 / 索引（明细查询 `user_id + occurred_at DESC` 必须有复合索引）
- [ ] 家庭表对共享数据使用 `family_id`，用户私有数据使用 `user_id`，共享/私有互斥

### AC-2 迁移脚本
- [ ] 以 `001_init.sql` / `002_audit.sql` 等编号，幂等可重跑
- [ ] 每个迁移脚本有对应 `down` 回滚（或使用迁移工具 flyway/goose 约定）

### AC-3 本地环境
- [ ] `docker-compose up -d` 能起 pg:15 + redis:7
- [ ] `.env.example` 列出所有必需变量（不含密钥）
- [ ] `README` 说明如何跑迁移 + 灌种子数据

### AC-4 工程约束
- [ ] 提交：`feat(server): db schema v1 + compose dev env`
- [ ] `Refs: COSTRA-021, ADR-0004`

## 4. 完成时动作（同 COSTRA-010 §5）
