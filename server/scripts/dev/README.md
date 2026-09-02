# Costra · Server · Dev Scripts

本目录承载本地开发期辅助脚本（**仅 dev 环境** · 严禁在生产部署使用）。

## 脚本清单

| 脚本 | npm script | 用途 |
|---|---|---|
| `migrate.sh` | `npm run db:migrate` | 跑齐 `db/migrations/*.sql` 全部 migrations · 幂等可重跑 |
| `reset-data.sh` | `npm run db:reset-data` | DROP schema → 重建（migrate.sh 或从 SQL 备份导入）+ redis flushall |
| `seed-curl-test.sh` | `USER_ID=... npm run db:seed:curl-test` | 给指定 user.id 建 family/ledger/family_members（curl 实测 § 2.5）|

## 环境变量

所有脚本默认连本地 dev DB · 可通过 env 覆盖：

| 变量 | 默认值 |
|---|---|
| `DB_URL` | `postgres://costra:costra_dev_pw@localhost:5432/costra` |
| `REDIS_URL` | `redis://localhost:6379` |
| `SQL_FILE` | （reset-data.sh 可选）指定则从 SQL 备份导入而非跑 migrate.sh · 支持 `.sql` / `.sql.gz` · 亦可作首个位置参数传入 |
| `USER_ID` | （seed-curl-test.sh 必填）|
| `FAMILY_ID` | `00000000-0000-0000-0000-0000000000F0` |
| `LEDGER_ID` | `00000000-0000-0000-0000-000000000001` |

## 典型工作流（COSTRA-104 Human curl 实测）

```bash
# 1. 首次或脏数据后：清 + 重跑 migrations
npm run db:reset-data
npm run db:migrate    # 注：reset-data 已 TRUNCATE · 不需重跑 migrations · 此行仅在彻底重建 schema 时跑

# 2. 启 server
npm run dev

# 3. 拿 USER_ID：先在微信开发者工具完成一次真实登录，再从 DB 查
psql "postgres://costra:costra_dev_pw@localhost:5432/costra" \
  -c "SELECT id, nickname, created_at FROM users ORDER BY created_at DESC LIMIT 5;"
USER_ID=<上一步选定的 user.id>

# 4. 跑 seed
USER_ID=$USER_ID npm run db:seed:curl-test
```

> ⚠️ `WX_MOCK_LOGIN` 已随 mock login 功能整体移除（2026-08-20）：`curl /auth/wx-login`
> 不再接受任意 code，必须真实 wx.login 换取。免扫码的指定账号登录已由 GM impersonate
> 实装（`docs/ops/gm-impersonate-design.md`）：运维 SQL 授权 `users.is_gm` 后（授权/回收 SQL 见
> `docs/ops/gm-access.md`），小程序内「设置 → GM 工具 · 切换登录身份」即可登录任意账号
> 或新建伪造账号（`gm_fake_` 前缀 · 与真实账号物理隔离）。

## 安全保护

- **禁生产**：所有脚本都 hardcoded 连 `localhost`/dev URL · 即使误开 `NODE_ENV=production` 也跑在本地（不会破坏远端 staging/prod）
- **数据保护**：`reset-data.sh` 用 TRUNCATE（保留 schema）而非 DROP DATABASE · 误跑可重跑 seed 恢复
- **scope**：脚本仅访问 dev 域（pg/redis localhost）· 不操作云资源 / git / migration 文件

## 后续治理

- **FU-104-DB-MIGRATE-SCRIPT**（Sprint-3 候选）：本目录三脚本对应正式化 · 与 CI 对账族联动
- **未来**：accounts 表建立后 · `0005_entries_account_fk.sql` 补 FK 约束 · 同时本目录可加 seed-account 脚本
