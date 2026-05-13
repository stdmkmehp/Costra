# Costra · Server · Dev Scripts

本目录承载本地开发期辅助脚本（**仅 dev 环境** · 严禁在生产部署使用）。

## 脚本清单

| 脚本 | npm script | 用途 |
|---|---|---|
| `migrate.sh` | `npm run db:migrate` | 跑齐 `db/migrations/*.sql` 全部 migrations · 幂等可重跑 |
| `reset-data.sh` | `npm run db:reset-data` | 清业务数据（保留 schema + 系统分类 + redis flushall）|
| `seed-curl-test.sh` | `USER_ID=... npm run db:seed:curl-test` | 给指定 user.id 建 family/ledger/family_members（curl 实测 § 2.5）|

## 环境变量

所有脚本默认连本地 dev DB · 可通过 env 覆盖：

| 变量 | 默认值 |
|---|---|
| `DB_URL` | `postgres://costra:costra_dev_pw@localhost:5432/costra` |
| `REDIS_URL` | `redis://localhost:6379` |
| `USER_ID` | （seed-curl-test.sh 必填）|
| `FAMILY_ID` | `00000000-0000-0000-0000-0000000000F0` |
| `LEDGER_ID` | `00000000-0000-0000-0000-000000000001` |

## 典型工作流（COSTRA-104 Human curl 实测）

```bash
# 1. 首次或脏数据后：清 + 重跑 migrations
npm run db:reset-data
npm run db:migrate    # 注：reset-data 已 TRUNCATE · 不需重跑 migrations · 此行仅在彻底重建 schema 时跑

# 2. 启 server（dev WX mock）
WX_MOCK_LOGIN=1 npm run dev

# 3. 拿 token + USER_ID（步骤 B）
RESPONSE=$(curl -s -X POST http://127.0.0.1:8080/v1/auth/wx-login \
  -H 'content-type: application/json' \
  -d '{"code":"test"}')
TOKEN=$(echo $RESPONSE | jq -r '.access_token')
USER_ID=$(echo $RESPONSE | jq -r '.user.id')

# 4. 跑 seed
USER_ID=$USER_ID npm run db:seed:curl-test

# 5. 跑 curl 实测步骤 C/D/E（按手册 docs/qa/costra-104-curl-verify.md）
```

## 安全保护

- **禁生产**：所有脚本都 hardcoded 连 `localhost`/dev URL · 即使误开 `NODE_ENV=production` 也跑在本地（不会破坏远端 staging/prod）
- **数据保护**：`reset-data.sh` 用 TRUNCATE（保留 schema）而非 DROP DATABASE · 误跑可重跑 seed 恢复
- **scope**：脚本仅访问 dev 域（pg/redis localhost）· 不操作云资源 / git / migration 文件

## 后续治理

- **FU-104-DB-MIGRATE-SCRIPT**（Sprint-3 候选）：本目录三脚本对应正式化 · 与 CI 对账族联动
- **未来**：accounts 表建立后 · `0005_entries_account_fk.sql` 补 FK 约束 · 同时本目录可加 seed-account 脚本
