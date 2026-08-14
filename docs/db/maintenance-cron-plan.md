# maintenance.sh · 运维定时任务统一入口方案（待评估）

> **日期**：2026-07-08；2026-08-14 同步 PostgreSQL standby 监控落地
> **背景**：`docs/db/data-bloat-audit-report.md` 采纳方案 B。主库定时任务统一走 `maintenance.sh`；从库因与 staging 共机，保持独立 `/etc/cron.d/costra-standby`。
> **当前任务集**：`backup` + `replication-check`（仅复制已配置的主库生成 cron）+ purge-* + `renew-cert`。

---

## §1 架构总览

```
crontab (/etc/cron.d/costra-maintenance)
        │  每行只调 maintenance.sh <task>
        ▼
infra/scripts/maintenance.sh   ← 唯一入口 · 子命令分发器
        ├── backup            → 委托 exec backup-db.sh（保留其成熟逻辑，不重写）
        ├── purge-idempotency → 内联 run_sql DELETE
        ├── purge-sessions    → 内联 run_sql DELETE
        ├── purge-all         → 顺序跑全部 purge-*（不含 backup）
        └── list              → 打印可用任务
        │
        └── source lib/common.sh（复用日志/参数/DRY_RUN/ERR trap/confirm）
```

**两条设计原则**：
1. **backup 用委托不用重写**——`backup-db.sh` 已成熟（ionice、PIPESTATUS 捕获、gzip 校验、保留期清理），`maintenance.sh backup` 只做 `exec backup-db.sh "$@"`，透传参数。零重复代码。
2. **purge 用内联**——清理是一句 `DELETE`，不值得每个建 SQL 文件；且不走 `psql-exec.sh`（那个带 prod confirm 交互，cron 里会卡死）。maintenance.sh 内建一个非交互 `run_sql()`。

---

## §2 子命令与参数

| 子命令 | 作用 | 频率建议 | 透传参数 |
|---|---|---|---|
| `backup` | 委托 `backup-db.sh` | 每 4h 错峰 | `--retain-days N` / `--no-cleanup` / `--prefix` |
| `replication-check` | 主库复制槽/WAL/纯异步检查 | 每 5 分钟；仅 `server.env` 有完整复制三件套时生成 | 透传给 `check-replication.sh` |
| `purge-idempotency` | 清过期幂等键（过期 +30 天审计保留） | 每日 | — |
| `purge-sessions` | 清已过期 session（过期 +30 天审计保留） | 每日 | — |
| `purge-invites` | 清过期邀请（过期 +30 天审计保留） | 每日 | — |
| `purge-all` | 顺序跑全部 purge | 手动/兜底 | — |
| `renew-cert` | certbot 证书续期（到期才续 · 续到才 reload nginx）| 每日 | — |
| `install-cron` | 用 `${COSTRA_ROOT}` 展开生成 `/etc/cron.d/costra-maintenance` | 一次性 | — |
| `list` | 列出所有任务 | 手动 | — |

**通用选项**（复用 `common.sh`）：
- `--dry-run`：purge 时跑 `SELECT count(*)` 预览将删行数（不真删）；backup 透传给 `backup-db.sh`。
- `-y/--yes`：purge-all 跳过确认。
- `-h/--help`：打印用法。

---

## §3 完整脚本（供评审 · 遵循现有约定与 shell 硬规矩）

```bash
#!/usr/bin/env bash
# =============================================================================
# Costra · 运维定时任务统一入口（cron 唯一入口 · 子命令分发）
# =============================================================================
# 用法：
#   ./maintenance.sh <task> [options]
#
# 任务：
#   backup [--retain-days N|--no-cleanup|--prefix P]  委托 backup-db.sh
#   replication-check                                主库复制槽/WAL/异步状态检查
#   purge-idempotency                                 清过期幂等键（每日）
#   purge-sessions                                    清已过期 session（每日）
#   purge-all                                         顺序跑全部 purge-*
#   list                                              列出可用任务
#
# 通用选项：--dry-run（预览不改）· -y/--yes · -h/--help
#
# cron 配置见 /etc/cron.d/costra-maintenance（本方案 §4）
#
# 退出码：0 = 成功 · 1 = 失败
# =============================================================================

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=lib/common.sh
source "${SCRIPT_DIR}/lib/common.sh"

PG_CONTAINER="costra-postgres"
PG_USER="costra"
PG_DB="costra"

# --- 解析：先让 common 扫出 --dry-run/-y，再抽任务名 + 透传参数 ---
parse_common_args "$@"

TASK=""
declare -a PASSTHRU=()
while [[ $# -gt 0 ]]; do
  case "$1" in
    backup|replication-check|purge-idempotency|purge-sessions|purge-all|install-cron|list)
      [[ -z "${TASK}" ]] || die "只能指定一个任务（已有：${TASK}）"
      TASK=$1; shift ;;
    --dry-run|-y|--yes) shift ;;       # common 已处理 · noop
    -h|--help)
      grep '^#' "$0" | sed 's/^# \{0,1\}//' | head -22
      exit 0 ;;
    *) PASSTHRU+=("$1"); shift ;;       # 透传给委托脚本（如 backup 的 --retain-days）
  esac
done
[[ -n "${TASK}" ]] || die "缺少任务名 · 用 ./maintenance.sh list 查看可用任务"

# =============================================================================
# 共用：非交互 SQL 执行（cron 友好 · 不走 psql-exec.sh 的 confirm）
# =============================================================================
_load_pg_pw() {
  require_file "${COSTRA_ENV_FILE}"
  PG_COSTRA_PW=$(grep '^PG_COSTRA_PW=' "${COSTRA_ENV_FILE}" | cut -d= -f2-)
  [[ -n "${PG_COSTRA_PW}" ]] || die "未能从 ${COSTRA_ENV_FILE} 读取 PG_COSTRA_PW"
}

_assert_pg_healthy() {
  local health
  health=$(docker inspect --format '{{.State.Health.Status}}' "${PG_CONTAINER}" 2>/dev/null || echo "missing")
  [[ "${health}" == "healthy" ]] || die "${PG_CONTAINER} 状态异常（${health}）· 跳过本次任务"
}

# run_sql <sql> : 执行并返回 psql 原始输出（含 "DELETE n"）
run_sql() {
  docker exec -e "PGPASSWORD=${PG_COSTRA_PW}" "${PG_CONTAINER}" \
    psql -U "${PG_USER}" -d "${PG_DB}" -v ON_ERROR_STOP=1 -c "$1"
}

# run_sql_scalar <sql> : 取单值（-At 无表头无对齐）
run_sql_scalar() {
  docker exec -e "PGPASSWORD=${PG_COSTRA_PW}" "${PG_CONTAINER}" \
    psql -U "${PG_USER}" -d "${PG_DB}" -v ON_ERROR_STOP=1 -At -c "$1"
}

# task_purge <label> <table> <where> : dry-run 预览行数 · 否则 DELETE
task_purge() {
  local label=$1 table=$2 where=$3
  if [[ "${DRY_RUN}" == "1" ]]; then
    local n
    n=$(run_sql_scalar "SELECT count(*) FROM ${table} WHERE ${where}")
    log_dry "[${label}] 将删除 ${n} 行 · ${table} WHERE ${where}"
  else
    local out
    out=$(run_sql "DELETE FROM ${table} WHERE ${where}" | tail -1)
    log_success "[${label}] ${out}"
  fi
}

# =============================================================================
# 各任务定义
# =============================================================================
do_purge_idempotency() {
  task_purge "idempotency" "idempotency_keys" "expires_at < now()"
}

do_purge_sessions() {
  # 删除所有已过期 session（含"已吊销且已过期"的行）· 单条件完全走 idx_user_sessions_expires。
  # 已吊销但未过期的行不影响业务（findActive 过滤 revoked_at IS NULL），随其 expires_at 自然过期后被删。
  task_purge "sessions" "user_sessions" "expires_at < now()"
}

# =============================================================================
# 分发（flock 防重入 · cron 重叠保护 · 所有 purge 共享一把 purge 锁）
# =============================================================================
case "${TASK}" in
  purge-idempotency|purge-sessions|purge-all) LOCK_NAME="purge" ;;
  *)                                          LOCK_NAME="${TASK}" ;;
esac
if command -v flock >/dev/null 2>&1; then
  LOCK_FILE="/tmp/costra-maint-${LOCK_NAME}.lock"
  exec 9>"${LOCK_FILE}"
  flock -n 9 || die "另一个 [${LOCK_NAME}] 任务仍在运行 · 本次跳过"
fi

print_section_header "🧹 Costra maintenance · ${TASK}"

case "${TASK}" in
  backup)
    # 委托 backup-db.sh · export 让子脚本继承 DRY_RUN/ASSUME_YES（common.sh 用 := 不覆盖已存在值）
    export DRY_RUN ASSUME_YES
    log_info "委托 → backup-db.sh ${PASSTHRU[*]}"
    exec "${SCRIPT_DIR}/backup-db.sh" "${PASSTHRU[@]}"
    ;;
  purge-idempotency)
    require_cmd docker; _assert_pg_healthy; _load_pg_pw
    do_purge_idempotency
    ;;
  purge-sessions)
    require_cmd docker; _assert_pg_healthy; _load_pg_pw
    do_purge_sessions
    ;;
  purge-all)
    require_cmd docker; _assert_pg_healthy; _load_pg_pw
    do_purge_idempotency
    do_purge_sessions
    ;;
  list)
    log_info "可用任务：backup · replication-check · purge-idempotency · purge-sessions · purge-all · install-cron · list"
    ;;
  # install-cron) 见 §4（生成 /etc/cron.d/costra-maintenance）
esac

log_success "maintenance · ${TASK} 完成"
exit 0
```

> **合规点核对**：无 `((var++))`（改用 for/顺序调用）；`parse_common_args` 扫全 `$@`（`-y`/`--dry-run` 位置任意）；`backup` 委托用 `export` 继承而非拼参数（干净）；purge 用 flock 防 cron 重叠；健康检查异常即 `die`（退出码 1 进日志）。

---

## §4 统一 crontab（由 `maintenance.sh install-cron` 生成 · 不手写死路径）

> ⚠️ **关键约束**：cron daemon **不展开 shell 变量**，`/etc/cron.d/` 文件里的命令路径必须是字面绝对路径，不能写 `${COSTRA_ROOT}`。
> 因此不手抄路径，而由 `maintenance.sh install-cron` 读取 `${COSTRA_ROOT}`（`common.sh` 已自动派生 · 见 §5）在**生成时展开**后写入。这样源头用变量、落盘是正确的字面路径，两全。

生成的 `/etc/cron.d/costra-maintenance` 内容（以 `COSTRA_ROOT=/root/Costra` 展开为例）：

```cron
SHELL=/bin/bash
PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin

# ── Costra 运维定时任务 · 全部走 maintenance.sh 统一入口（由 install-cron 生成）──
# 备份：每 4h 错峰（偏移 27 分）
27 3,7,11,15,19,23 * * * root /root/Costra/infra/scripts/maintenance.sh backup           >> /data/logs/maintenance-backup.log 2>&1
# 主库复制检查：仅 server.env 配置了 REPLICATOR_PW + 主从 IP 时生成
*/5 * * * * root /root/Costra/infra/scripts/maintenance.sh replication-check >> /data/logs/check-replication.log 2>&1
# 幂等键 / session / invite：每日 04 点错峰
7 4 * * * root /root/Costra/infra/scripts/maintenance.sh purge-idempotency >> /data/logs/maintenance-purge.log 2>&1
17 4 * * * root /root/Costra/infra/scripts/maintenance.sh purge-sessions >> /data/logs/maintenance-purge.log 2>&1
27 4 * * * root /root/Costra/infra/scripts/maintenance.sh purge-invites >> /data/logs/maintenance-purge.log 2>&1
# 证书续期：每天 03:17
17 3 * * * root /root/Costra/infra/scripts/maintenance.sh renew-cert >> /data/logs/maintenance-cert.log 2>&1
```

`install-cron` 子命令的生成逻辑（用非引号 heredoc 展开 `${COSTRA_ROOT}` · 与 `08-finalize-nginx.sh` certbot cron 同款做法）：
```bash
  install-cron)
    CRON_FILE="/etc/cron.d/costra-maintenance"
    CRON_CONTENT=$(cat <<EOF
SHELL=/bin/bash
PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin

27 3,7,11,15,19,23 * * * root ${COSTRA_ROOT}/infra/scripts/maintenance.sh backup >> /data/logs/maintenance-backup.log 2>&1
*/5 * * * * root ${COSTRA_ROOT}/infra/scripts/maintenance.sh replication-check >> /data/logs/check-replication.log 2>&1
7 4 * * * root ${COSTRA_ROOT}/infra/scripts/maintenance.sh purge-idempotency >> /data/logs/maintenance-purge.log 2>&1
17 4 * * * root ${COSTRA_ROOT}/infra/scripts/maintenance.sh purge-sessions >> /data/logs/maintenance-purge.log 2>&1
27 4 * * * root ${COSTRA_ROOT}/infra/scripts/maintenance.sh purge-invites >> /data/logs/maintenance-purge.log 2>&1
17 3 * * * root ${COSTRA_ROOT}/infra/scripts/maintenance.sh renew-cert >> /data/logs/maintenance-cert.log 2>&1
EOF
)
    if [[ "${DRY_RUN}" == "1" ]]; then
      log_dry "写入 ${CRON_FILE}:"; printf '%s\n' "${CRON_CONTENT}"
    else
      backup_file "${CRON_FILE}"
      printf '%s\n' "${CRON_CONTENT}" > "${CRON_FILE}"
      chmod 0644 "${CRON_FILE}"
      systemctl restart crond 2>/dev/null || log_warn "请手动 systemctl restart crond"
      log_success "已写入 ${CRON_FILE}"
    fi
    ;;
```

**日志分流**：备份写 `maintenance-backup.log`，复制检查写 `check-replication.log`，清理合并写 `maintenance-purge.log`。`install-cron` 同时安装 `infra/logrotate/costra-ops`，按每日轮转、超过 20M 提前轮转、保留 14 轮并压缩；主从 PG 固定写 `postgresql.log`，server/redis/nginx 固定写 `/data/logs/{server/server.log,redis/redis.log,nginx/*.log}`，同样由该配置统一轮转（copytruncate），应用自身不做轮转，避免双事实源。

---

## §5 与现状的迁移关系（重要）

1. **路径事实源已修正**：本轮已改 `lib/common.sh`，让 `COSTRA_ROOT` 从 `common.sh` 自身位置（`<根>/infra/scripts/lib/`）向上三级**自动派生**，不再硬编码。现在无论部署在 `/root/Costra` 还是开发机，`COSTRA_ROOT` 都自解释、永远正确；仍支持环境变量覆盖。`install-cron` 生成 cron 时用它展开，杜绝手写死路径。
2. **旧 backup cron**：若此前已按 `backup-db.sh` 旧注释单独配过 backup 的 cron，落地本方案时必须**移除旧行**，避免与 `maintenance.sh backup` 重复备份（如何检查/删除见对话说明）。
3. **`backup-db.sh` 保留独立可用**：它自身持有按容器+目录区分的 `flock`，因此经 maintenance、从库 cron 或人工直调都不会重入；归档以 partial 校验后原子发布。
4. **复制任务条件生成**：只有 `REPLICATOR_PW`、`PG_PRIMARY_LAN_IP`、`PG_STANDBY_LAN_IP` 三项均非空才写入 `replication-check` cron；配置变化后必须重跑 `maintenance.sh install-cron`。

---

## §6 依赖的一次性 migration（与本脚本解耦 · 但需同批落地）

清理脚本要高效，`user_sessions` 的索引必须先修（否则 `purge-sessions` 走全表扫）。新增 `server/db/migrations/0009_session_index_fix.sql`：

```sql
BEGIN;
-- 原 idx_user_sessions_expires 带 WHERE revoked_at IS NULL 谓词，
-- 使"已吊销"行落在索引外，导致清理 DELETE 全表扫。改为无谓词。
DROP INDEX IF EXISTS idx_user_sessions_expires;
CREATE INDEX IF NOT EXISTS idx_user_sessions_expires ON user_sessions (expires_at);
COMMIT;
```
> pg-mem 双写：本索引未在 `server/test/setup.ts` 内嵌 DDL 中建模（该文件一贯省略纯性能 session 索引），且为纯性能索引不影响 pg-mem 行为，故**无需同步 setup.ts**；若未来在 setup.ts 补建性能索引再保持一致。
> `idempotency_keys` 已有无谓词 `idx_idempotency_expires`，无需改。

---

## §7 落地 checklist（评估通过后执行）

1. [ ] 新建 `infra/scripts/maintenance.sh`（§3）+ `chmod +x`
2. [ ] 新建 `0009_session_index_fix.sql`（setup.ts 无需改 · 纯性能索引）· 跑测试保基线（当前 222）
3. [ ] prod 跑 `06-migrate.sh`（顺序执行含 0009）
4. [ ] `./maintenance.sh purge-idempotency --dry-run` / `purge-sessions --dry-run` 验证预览行数合理
5. [ ] 写 `/etc/cron.d/costra-maintenance`（§4 · 用实际部署路径）+ 移除旧 backup cron
6. [ ] `systemctl restart crond`，观察 `/data/logs/maintenance-*.log`
7. [ ] 更新 `infra/scripts/README.md` 脚本清单 + `data-bloat-audit-report.md` 收口

---

## §8 当前状态

方案已实装；事实源是 `infra/scripts/maintenance.sh` 顶部 `CRON_SCHEDULE`。本文保留设计背景，具体命令和时间以脚本生成的 `/etc/cron.d/costra-maintenance` 为准。
