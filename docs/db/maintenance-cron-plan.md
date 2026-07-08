# maintenance.sh · 运维定时任务统一入口方案（待评估）

> **日期**：2026-07-08
> **背景**：`docs/db/data-bloat-audit-report.md` 采纳方案 B（系统 cron 脚本）。本方案进一步规范——**所有定时任务（备份 + 各表清理）统一走一个 `maintenance.sh` 入口，crontab 只调它，用子命令区分任务**。
> **决策边界**：audit_logs 暂缓；本轮任务集 = `backup` + `purge-idempotency` + `purge-sessions`。

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
| `purge-idempotency` | 清过期幂等键 | 每小时 | — |
| `purge-sessions` | 清已过期 session | 每日 | — |
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
#   purge-idempotency                                 清过期幂等键（每小时）
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
    backup|purge-idempotency|purge-sessions|purge-all|install-cron|list)
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
    log_info "可用任务：backup · purge-idempotency · purge-sessions · purge-all · install-cron · list"
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
# 备份：每 4h 错峰（偏移 17 分）
17 1,5,9,13,17,21 * * * root /root/Costra/infra/scripts/maintenance.sh backup           >> /data/logs/maintenance-backup.log 2>&1
# 幂等键：每小时（偏移 7 分 · 错开备份整点）
7  *              * * * root /root/Costra/infra/scripts/maintenance.sh purge-idempotency >> /data/logs/maintenance-purge.log  2>&1
# session：每日 03:30
30 3              * * * root /root/Costra/infra/scripts/maintenance.sh purge-sessions    >> /data/logs/maintenance-purge.log  2>&1
# 证书续期：每天 03:17（certbot 自判到期 · 续到才 reload nginx · 原 08 的 certbot cron 已并入）
17 3 * * *              root /root/Costra/infra/scripts/maintenance.sh renew-cert        >> /data/logs/maintenance-cert.log   2>&1
```

`install-cron` 子命令的生成逻辑（用非引号 heredoc 展开 `${COSTRA_ROOT}` · 与 `08-finalize-nginx.sh` certbot cron 同款做法）：
```bash
  install-cron)
    CRON_FILE="/etc/cron.d/costra-maintenance"
    CRON_CONTENT=$(cat <<EOF
SHELL=/bin/bash
PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin

17 1,5,9,13,17,21 * * * root ${COSTRA_ROOT}/infra/scripts/maintenance.sh backup           >> /data/logs/maintenance-backup.log 2>&1
7  *              * * * root ${COSTRA_ROOT}/infra/scripts/maintenance.sh purge-idempotency >> /data/logs/maintenance-purge.log  2>&1
30 3              * * * root ${COSTRA_ROOT}/infra/scripts/maintenance.sh purge-sessions    >> /data/logs/maintenance-purge.log  2>&1
17 3 * * *              root ${COSTRA_ROOT}/infra/scripts/maintenance.sh renew-cert        >> /data/logs/maintenance-cert.log   2>&1
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

**日志分流**：备份写 `maintenance-backup.log`，清理合并写 `maintenance-purge.log`（量小、便于对照）。均在 `/data/logs/`，与现有日志同源，可纳入后续 logrotate。

---

## §5 与现状的迁移关系（重要）

1. **路径事实源已修正**：本轮已改 `lib/common.sh`，让 `COSTRA_ROOT` 从 `common.sh` 自身位置（`<根>/infra/scripts/lib/`）向上三级**自动派生**，不再硬编码。现在无论部署在 `/root/Costra` 还是开发机，`COSTRA_ROOT` 都自解释、永远正确；仍支持环境变量覆盖。`install-cron` 生成 cron 时用它展开，杜绝手写死路径。
2. **旧 backup cron**：若此前已按 `backup-db.sh` 旧注释单独配过 backup 的 cron，落地本方案时必须**移除旧行**，避免与 `maintenance.sh backup` 重复备份（如何检查/删除见对话说明）。
3. **`backup-db.sh` 保留独立可用**：委托模式下它仍可被手动直接调用（`./backup-db.sh --dry-run`），不影响。

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

## §8 待你确认的点

1. 子命令风格用 `maintenance.sh <task>`（git 风格 · 本方案）还是你原提的 `--task <name>`？
2. 清理频率：幂等键每小时 / session 每日 —— 是否 OK？
3. `purge-sessions` 已简化为纯 `expires_at < now()`（删除所有已过期行 · 已吊销未过期行随自身过期被删 · 不设人为缓冲期）——确认无异议？
4. 日志分 `backup` / `purge` 两文件，还是全并一个 `maintenance.log`？
5. 确认后是否直接实装（脚本 + migration + test 双写 + README）？
