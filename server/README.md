# Costra Server

> **Backend** · Node.js 20 + TypeScript · **卡号**: COSTRA-020 / COSTRA-021
> 本目录包含：OpenAPI 契约（`api/openapi.yaml`）、数据库迁移（`db/migrations/`）、本地开发环境编排（`docker-compose.yml`）。

---

## 目录结构

```
server/
├── api/
│   └── openapi.yaml           # OpenAPI v0.1（主位，另见仓库根 api/openapi.yaml 镜像位）
├── db/
│   └── migrations/
│       ├── 0001_init.sql      # v1 初始表结构
│       └── 0002_seed_system_categories.sql
├── docker-compose.yml         # pg:15 + redis:7（+ minio 可选）
├── package.json               # 脚本位：lint / test / build（占位，真实实现 v0.2 补）
└── README.md
```

---

## 快速开始

### 1. 环境要求

- Docker 24+ / Docker Compose v2
- Node.js 20.x（后续 API 实现阶段使用，v0.1 仅契约）
- `.env` 文件：从仓库根 `.env.example` 复制

### 2. 启动依赖栈

```bash
cd server
docker compose up -d
# 验证：
docker compose ps
```

默认端口：
- Postgres 5432（`costra` / `costra` / `costra_dev_pw`）
- Redis 6379

### 3. 应用 Schema 迁移

**方式 A · psql 直连（开发默认）**：
```bash
docker compose exec -T postgres psql -U costra -d costra < db/migrations/0001_init.sql
docker compose exec -T postgres psql -U costra -d costra < db/migrations/0002_seed_system_categories.sql
```

**方式 B · 批量脚本**（v0.2 会提供 `npm run db:migrate`）：
```bash
for f in db/migrations/*.sql; do
  echo "==> $f"
  docker compose exec -T postgres psql -U costra -d costra < "$f"
done
```

### 4. 验证

```bash
docker compose exec postgres psql -U costra -d costra -c "\dt"
# 应列出 10 张表：users / families / family_members / accounts / categories /
#                ledger_entries / sync_versions / audit_logs / subscribe_tokens / feature_flags
```

### 5. 清理

```bash
docker compose down -v   # 删除数据卷
```

---

## 契约与文档

| 资源 | 位置 | 说明 |
|---|---|---|
| OpenAPI | `api/openapi.yaml` | 主位；仓库根 `api/openapi.yaml` 为镜像 |
| API 指南 | `../docs/api/README.md` | 字段约定、错误码、分页、鉴权 |
| 冲突策略 | `../docs/api/conflict-strategy.md` | LWW + 审计 |
| 审计日志 | `../docs/api/audit-log.md` | `audit_logs` 记录规则 |
| DB Schema | `../docs/db/schema.md` | 表结构 + ER 图 + 索引说明 |
| 关键决策 | `../.team/decisions/ADR-0004-miniapp-runtime-details.md` | 金额/时区/灰度 |

---

## 脚本位（package.json）

> 真实实现随 Epic-B API 落地，v0.1 仅占位以满足 DevOps COSTRA-040 契约。

| 脚本 | 用途 | 状态 |
|---|---|---|
| `npm run lint` | ESLint | 占位 |
| `npm run typecheck` | TypeScript 类型检查 | 占位 |
| `npm run test` | Jest 单测 | 占位 |
| `npm run build` | tsc 编译 | 占位 |

---

## 工程约束（摘自 `.team/engineering-guidelines.md`）

- 提交：Conventional Commits，`feat(server): ...` / `Refs: COSTRA-xxx`
- 金额分存、时间 UTC、软删除、乐观锁 → 见 `ADR-0004`
- 字段命名：契约层（HTTP/JSON）**camelCase**；DB 层 **snake_case**（适配层负责映射）

---

## 备案信息

- 服务备案号：沪ICP备2026017253号-2（域名 costra.cloud · 公网 IP 49.235.216.20）
- 小程序备案号：沪ICP备2026017253号-1X
- 主体：上海 · 下证：2026-05-13
- 工信部查询：https://beian.miit.gov.cn/
- 程序化查询：`GET /v1/legal/icp`（公开端点 · 无鉴权 · SSOT 见 `src/config/icp.ts`）
- `/healthz` 响应 JSON 同步附带 `icp` 字段，便于运维 probe 一并校验

---

## 环境域名

- prod：`https://costra.cloud/v1`（D-009 §2.1 + D-023 · ICP 下证 2026-05-13）
- staging：`https://costra.cloud/v1`（D-023 临时复用 prod · 子域 api-staging 搁置）
- dev-ip：`http://49.235.216.20:8080/v1`（开发期过渡）
- local：`http://localhost:8080/v1`

