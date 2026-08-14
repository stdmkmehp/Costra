#!/usr/bin/env bash
# =============================================================================
# Costra · 运维定时任务统一入口（cron 唯一入口 · 子命令分发）
# =============================================================================
# 主库定时任务（avatars 备份 + 复制检查 + 各表清理）统一走本脚本；standby 用独立
# cron（install-standby-cron.sh · DB 备份职责已迁从库，见 pg-standby-backup.md §5）。
#
# 用法：
#   ./maintenance.sh <task> [options]
#
# 任务：
#   backup [--retain-days N|--no-cleanup|--prefix P]  委托 backup-db.sh 全量（仅手动 · 不进 cron）
#   backup-avatars                                    委托 backup-db.sh --avatars-only（cron）
#   replication-check                                主库复制槽/WAL/异步状态检查
#   purge-idempotency                                 清过期幂等键（每日）
#   purge-sessions                                    清已过期 session（每日）
#   purge-invites                                     清过期邀请（每日）
#   purge-all                                         顺序跑全部 purge-*
#   renew-cert                                        certbot renew（到期才续 · 续到新证书才 reload nginx）
#   error-report                                      扫 /data/logs ≥error 级日志并邮件推送（每日 09:00 · 委托 report-error-logs.sh）
#   install-cron                                      用 ${COSTRA_ROOT} 展开生成 /etc/cron.d/costra-maintenance
#   list                                              列出可用任务
#
# 通用选项：--dry-run（预览不改）· -y/--yes · -h/--help
#
# 退出码：0 = 成功 · 1 = 失败
# =============================================================================

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=lib/common.sh
source "${SCRIPT_DIR}/lib/common.sh"

PG_CONTAINER="costra-postgres"
PG_USER="costra"
PG_DB="costra"

# 所有定时任务日志统一目录（唯一定义处 · cron 任务与手动执行的输出都落在这里）
LOG_DIR="/data/logs"

# =============================================================================
# ★ cron 调度表（统一管理执行时间 · 任务与时间解耦 · 改执行时间只改这里）
# 格式：<任务名>|<cron 时间表达式>|<日志文件名（自动落在 ${LOG_DIR} 下）>
# 任务名必须是本脚本支持的子命令；install-cron 遍历本表生成 /etc/cron.d/costra-maintenance。
# 调整时间 / 增删定时任务：只改本数组即可，无需改 install-cron 或任务逻辑。
# =============================================================================
# 注：DB 备份已迁往从库（/data/slave/backups · install-standby-cron.sh），
# prod 不再跑全量 backup；backup-avatars 只打包 uploads/avatars（文件不经复制流，
# 只有 prod 能备份）。
declare -a CRON_SCHEDULE=(
  "backup-avatars|27 3,7,11,15,19,23 * * *|maintenance-backup.log"
  "replication-check|47 * * * *|check-replication.log"
  "purge-idempotency|7 4 * * *|maintenance-purge.log"
  "purge-sessions|17 4 * * *|maintenance-purge.log"
  "purge-invites|27 4 * * *|maintenance-purge.log"
  "renew-cert|17 3 * * *|maintenance-cert.log"
  "error-report|0 9 * * *|maintenance-error-report.log"
)

# --- 解析：先让 common 扫出 --dry-run/-y，再抽任务名 + 透传参数 ---
parse_common_args "$@"

TASK=""
declare -a PASSTHRU=()
while [[ $# -gt 0 ]]; do
  case "$1" in
    backup|backup-avatars|replication-check|purge-idempotency|purge-sessions|purge-invites|purge-all|renew-cert|error-report|install-cron|list)
      [[ -z "${TASK}" ]] || die "只能指定一个任务（已有：${TASK}）"
      TASK=$1; shift ;;
    --dry-run|-y|--yes) shift ;;       # common 已处理 · noop
    -h|--help)
      grep '^#' "$0" | sed 's/^# \{0,1\}//' | head -26
      exit 0 ;;
    *) PASSTHRU+=("$1"); shift ;;       # 透传给委托脚本（如 backup 的 --retain-days）
  esac
done
[[ -n "${TASK}" ]] || die "缺少任务名 · 用 ./maintenance.sh list 查看可用任务"

# =============================================================================
# 共用：非交互 SQL 执行（cron 友好 · 不走 psql-exec.sh 的 prod confirm 交互）
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

do_purge_idempotency() {
  # 过期 + 30 天审计保留期后物理删除
  task_purge "idempotency" "idempotency_keys" "expires_at < now() - interval '30 days'"
}

do_purge_sessions() {
  # 过期 + 30 天审计保留期后物理删除。
  # 已吊销但未过期的行不影响业务（findActive 过滤 revoked_at IS NULL），
  # 随其 expires_at 自然过期后进入 30 天倒计时。
  task_purge "sessions" "user_sessions" "expires_at < now() - interval '30 days'"
}

do_purge_invites() {
  # 过期 + 30 天审计保留期后物理删除（不区分是否已使用）
  task_purge "invites" "family_invites" "expires_at < now() - interval '30 days'"
}

# =============================================================================
# renew-cert：certbot 证书续期（原 08-finalize-nginx.sh 的 cron 已并入这里）
# certbot 自判是否到期（未到期静默跳过）· --deploy-hook 仅在真续到新证书后 reload nginx。
# -T 关闭 TTY 分配（cron 无 TTY · 不加会报 "input device is not a TTY"）。
# =============================================================================
do_renew_cert() {
  require_cmd certbot
  local hook="docker compose -f ${COSTRA_COMPOSE_FILE} exec -T nginx nginx -s reload"
  if [[ "${DRY_RUN}" == "1" ]]; then
    log_dry "certbot renew --quiet --deploy-hook \"${hook}\""
    return 0
  fi
  require_root
  certbot renew --quiet --deploy-hook "${hook}"
  log_success "certbot renew 完成（未到期则静默跳过）"
}

# =============================================================================
# install-cron：用 ${COSTRA_ROOT} 展开生成 cron 文件（cron 自身不展开 shell 变量，
# 故必须在生成时展开成字面绝对路径）
# =============================================================================
do_install_cron() {
  local cron_file="/etc/cron.d/costra-maintenance"
  local content entry task sched logf replication_enabled logrotate_source
  # 头部（SHELL/PATH + 说明）· 任务行由顶部 CRON_SCHEDULE 遍历生成。
  # 时间与任务解耦：改执行时间只改 CRON_SCHEDULE；日志一律落在 ${LOG_DIR}（统一路径）。
  content="SHELL=/bin/bash
PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin

# ── Costra 运维定时任务 · 全部走 maintenance.sh 统一入口（由 install-cron 生成）──
# 执行时间集中定义在 maintenance.sh 顶部 CRON_SCHEDULE · 日志统一落在 ${LOG_DIR}"
  # 用完整配置三件套作为显式启用标志，避免单个 secret 键漂移时误启用/误关闭。
  replication_enabled=1
  for _key in REPLICATOR_PW PG_PRIMARY_LAN_IP PG_STANDBY_LAN_IP; do
    grep -qE "^${_key}=.+" "${COSTRA_ENV_FILE}" 2>/dev/null || replication_enabled=0
  done
  if [[ "${replication_enabled}" == "1" ]] && command -v docker >/dev/null 2>&1 \
    && docker inspect costra-postgres >/dev/null 2>&1; then
    if ! docker exec costra-postgres psql -U costra -d costra -tAc \
      "SELECT 1 FROM pg_replication_slots WHERE slot_name='costra_standby' AND slot_type='physical'" \
      2>/dev/null | grep -qx '1'; then
      log_warn "复制三件套存在但运行态无 costra_standby 物理槽 · cron 仍保留 replication-check 以持续告警"
    fi
  fi
  for entry in "${CRON_SCHEDULE[@]}"; do
    IFS='|' read -r task sched logf <<< "${entry}"
    if [[ "${task}" == "replication-check" ]] && [[ "${replication_enabled}" != "1" ]]; then
      log_info "${COSTRA_ENV_FILE} 未配置完整复制三件套 · cron 跳过 replication-check"
      continue
    fi
    content+=$(printf '\n%-24s root %s/maintenance.sh %-17s >> %s/%s 2>&1' \
      "${sched}" "${SCRIPT_DIR}" "${task}" "${LOG_DIR}" "${logf}")
  done
  if [[ "${DRY_RUN}" == "1" ]]; then
    log_dry "将写入 ${cron_file}："
    printf '%s\n' "${content}"
    log_dry "将安装 ${COSTRA_INFRA}/logrotate/costra-ops → /etc/logrotate.d/costra-ops"
    return 0
  fi
  require_root
  backup_file "${cron_file}"
  printf '%s\n' "${content}" > "${cron_file}"
  chmod 0644 "${cron_file}"
  log_success "已写入 ${cron_file}"

  logrotate_source="${COSTRA_INFRA}/logrotate/costra-ops"
  require_file "${logrotate_source}"
  install -m 0644 "${logrotate_source}" /etc/logrotate.d/costra-ops
  log_success "已安装 /etc/logrotate.d/costra-ops"

  mkdir -p "${LOG_DIR}"
  local log_name
  for log_name in maintenance-backup.log check-replication.log maintenance-purge.log maintenance-cert.log maintenance-error-report.log; do
    touch "${LOG_DIR}/${log_name}"
    chmod 0600 "${LOG_DIR}/${log_name}"
  done
  if systemctl is-active --quiet crond 2>/dev/null; then
    systemctl restart crond
    log_success "crond 已 restart · cron 配置生效"
  else
    log_warn "crond 未运行 · 请手动 systemctl enable --now crond"
  fi
}

# =============================================================================
# 分发（flock 防重入 · cron 重叠保护）
# flock 仅 Linux（util-linux）有 · prod 为 Linux 一定存在；开发机（如 macOS）无则跳过锁。
# 所有 purge 类任务共享一把 purge 锁：避免手动 purge-all 与 cron 单项 purge 并发。
# backup / replication-check / install-cron / list 各用独立锁名。
# =============================================================================
case "${TASK}" in
  purge-idempotency|purge-sessions|purge-invites|purge-all) LOCK_NAME="purge" ;;
  *)                                          LOCK_NAME="${TASK}" ;;
esac
if command -v flock >/dev/null 2>&1; then
  LOCK_FILE="/tmp/costra-maint-${LOCK_NAME}.lock"
  exec 9>"${LOCK_FILE}"
  flock -n 9 || die "另一个 [${LOCK_NAME}] 任务仍在运行 · 本次跳过"
fi

TASK_START_EPOCH=$(date +%s)
TASK_START_TIME=$(date '+%F %T %z')

on_task_error() {
  local lineno=$1 exit_code=$2
  local task_end_epoch task_end_time elapsed
  task_end_epoch=$(date +%s)
  task_end_time=$(date '+%F %T %z')
  elapsed=$((task_end_epoch - TASK_START_EPOCH))
  log_error "maintenance · ${TASK} 失败 · 开始：${TASK_START_TIME} · 结束：${task_end_time} · 耗时：${elapsed}s · 退出码：${exit_code} · 行：${lineno}"
  exit "${exit_code}"
}
trap 'on_task_error ${LINENO} $?' ERR

print_section_header "🧹 Costra maintenance · ${TASK}"
log_info "开始时间：${TASK_START_TIME}"

case "${TASK}" in
  backup)
    # 委托 backup-db.sh · export 让子脚本继承 DRY_RUN/ASSUME_YES（common.sh 用 := 不覆盖已存在值）
    export DRY_RUN ASSUME_YES
    log_info "委托 → backup-db.sh ${PASSTHRU[*]:-}"
    "${SCRIPT_DIR}/backup-db.sh" ${PASSTHRU[@]+"${PASSTHRU[@]}"}
    ;;
  backup-avatars)
    # prod cron 唯一备份任务：只打包 avatars（DB 备份已迁从库）
    export DRY_RUN ASSUME_YES
    log_info "委托 → backup-db.sh --avatars-only ${PASSTHRU[*]:-}"
    "${SCRIPT_DIR}/backup-db.sh" --avatars-only ${PASSTHRU[@]+"${PASSTHRU[@]}"}
    ;;
  replication-check)
    export DRY_RUN ASSUME_YES
    log_info "委托 → check-replication.sh ${PASSTHRU[*]:-}"
    "${SCRIPT_DIR}/check-replication.sh" ${PASSTHRU[@]+"${PASSTHRU[@]}"}
    ;;
  error-report)
    export DRY_RUN ASSUME_YES
    log_info "委托 → report-error-logs.sh ${PASSTHRU[*]:-}"
    "${SCRIPT_DIR}/report-error-logs.sh" ${PASSTHRU[@]+"${PASSTHRU[@]}"}
    ;;
  purge-idempotency)
    require_cmd docker; _assert_pg_healthy; _load_pg_pw
    do_purge_idempotency
    ;;
  purge-sessions)
    require_cmd docker; _assert_pg_healthy; _load_pg_pw
    do_purge_sessions
    ;;
  purge-invites)
    require_cmd docker; _assert_pg_healthy; _load_pg_pw
    do_purge_invites
    ;;
  purge-all)
    require_cmd docker; _assert_pg_healthy; _load_pg_pw
    do_purge_idempotency
    do_purge_sessions
    do_purge_invites
    ;;
  install-cron)
    do_install_cron
    ;;
  renew-cert)
    require_cmd docker
    do_renew_cert
    ;;
  list)
    log_info "可用任务：backup · backup-avatars · replication-check · purge-idempotency · purge-sessions · purge-invites · purge-all · renew-cert · error-report · install-cron · list"
    ;;
esac

TASK_END_EPOCH=$(date +%s)
TASK_END_TIME=$(date '+%F %T %z')
TASK_ELAPSED=$((TASK_END_EPOCH - TASK_START_EPOCH))
log_success "maintenance · ${TASK} 完成 · 开始：${TASK_START_TIME} · 结束：${TASK_END_TIME} · 耗时：${TASK_ELAPSED}s"
exit 0
