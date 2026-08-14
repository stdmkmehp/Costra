#!/usr/bin/env bash
# shellcheck shell=bash
# =============================================================================
# Costra · 从 hot standby 反向重建主库（机器① · 双阶段灾难恢复）
# =============================================================================
# 方案文档：docs/ops/pg-standby-backup.md §8.2
#
# 阶段：
#   prepare  停业务/cron/旧 PG → 从 standby 拉候选 basebackup → verify → 清 standby 身份
#   activate 确认来源 standby 已停且临时安全组已删 → 原子切换 PGDATA → 验证主库 → 恢复业务
#   status   查看持久状态文件；支持 SSH 中断后换会话继续
#
# 用法：
#   ./recover-primary-from-standby.sh prepare --standby-caught-up
#   ./recover-primary-from-standby.sh status
#   ./recover-primary-from-standby.sh activate \
#     --source-standby-stopped --reverse-rule-removed
#
# 硬约束：不 promote、不覆盖原 PGDATA、不跨代码块依赖 shell 临时变量。
# =============================================================================

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=lib/common.sh
source "${SCRIPT_DIR}/lib/common.sh"

PG_CONTAINER="costra-postgres"
STATE_FILE="${COSTRA_CONF_DIR}/costra-primary-recovery.state"
LOCK_FILE="/run/lock/costra-primary-recovery.lock"
READY_MARKER=".costra-primary-recovery-ready"
ACTION=""
STANDBY_CAUGHT_UP=0
SOURCE_STANDBY_STOPPED=0
REVERSE_RULE_REMOVED=0
PGPASS_DIR=""

# 持久状态字段
RECOVERY_STATUS=""
RECOVERY_STAMP=""
RECOVERY_DIR=""
CORRUPT_DIR=""
CRON_SERVICE=""
CRON_FILE_MOVED=0
MANIFEST_SHA256=""

parse_common_args "$@"
while [[ $# -gt 0 ]]; do
  case "$1" in
    prepare|activate|status)
      [[ -z "${ACTION}" ]] || die "只能指定一个阶段（已有 ${ACTION}）"
      ACTION=$1; shift ;;
    --standby-caught-up) STANDBY_CAUGHT_UP=1; shift ;;
    --source-standby-stopped) SOURCE_STANDBY_STOPPED=1; shift ;;
    --reverse-rule-removed) REVERSE_RULE_REMOVED=1; shift ;;
    --dry-run|-y|--yes) shift ;;
    -h|--help)
      grep '^#' "$0" | sed 's/^# \{0,1\}//' | head -26
      exit 0 ;;
    *) die "未知参数: $1 · 用 --help 查看" ;;
  esac
done
[[ -n "${ACTION}" ]] || die "缺少阶段：prepare | activate | status"

require_root
require_cmd docker
require_cmd timeout "yum install -y coreutils / apt install -y coreutils"
require_cmd sha256sum "yum install -y coreutils / apt install -y coreutils"
require_cmd ss "yum install -y iproute / apt install -y iproute2"
require_cmd systemctl
require_cmd pgrep "yum install -y procps-ng / apt install -y procps"
require_cmd flock "yum install -y util-linux / apt install -y util-linux"
mkdir -p "$(dirname "${LOCK_FILE}")"
exec 8>"${LOCK_FILE}"
if [[ "${ACTION}" == "status" ]]; then
  if ! flock -n 8; then
    log_warn "另一个恢复进程正在运行；以下状态是持久快照"
  fi
else
  flock -n 8 || die "另一个主库恢复进程正在运行 · 不允许并发 prepare/activate"
fi

_load_env_kv() {
  local key=$1 val
  val=$(grep "^${key}=" "${COSTRA_ENV_FILE}" | tail -1 | cut -d= -f2- || true)
  [[ -n "${val}" ]] || die "${COSTRA_ENV_FILE} 缺少 ${key}"
  printf '%s' "${val}"
}

_write_state() {
  local tmp
  mkdir -p "${COSTRA_CONF_DIR}"
  tmp=$(mktemp "${STATE_FILE}.tmp.XXXXXX")
  {
    printf 'RECOVERY_STATUS=%q\n' "${RECOVERY_STATUS}"
    printf 'RECOVERY_STAMP=%q\n' "${RECOVERY_STAMP}"
    printf 'RECOVERY_DIR=%q\n' "${RECOVERY_DIR}"
    printf 'CORRUPT_DIR=%q\n' "${CORRUPT_DIR}"
    printf 'CRON_SERVICE=%q\n' "${CRON_SERVICE}"
    printf 'CRON_FILE_MOVED=%q\n' "${CRON_FILE_MOVED}"
    printf 'MANIFEST_SHA256=%q\n' "${MANIFEST_SHA256}"
  } > "${tmp}"
  chmod 0600 "${tmp}"
  mv -f "${tmp}" "${STATE_FILE}"
}

_load_state() {
  require_file "${STATE_FILE}"
  local owner_mode
  owner_mode=$(stat -c '%u:%a' "${STATE_FILE}")
  [[ "${owner_mode}" == "0:600" ]] \
    || die "状态文件权限异常（${owner_mode}，期望 0:600）：${STATE_FILE}"
  # shellcheck disable=SC1090
  source "${STATE_FILE}"
  [[ "${RECOVERY_STATUS}" =~ ^(PREPARING|READY|ACTIVATING|ACTIVATED)$ ]] \
    || die "状态文件 RECOVERY_STATUS 非法：${RECOVERY_STATUS}"
  [[ "${RECOVERY_STAMP}" =~ ^[0-9]{8}-[0-9]{6}$ ]] \
    || die "状态文件时间戳非法：${RECOVERY_STAMP}"
  [[ "${RECOVERY_DIR}" == "/data/pgsql.restore.${RECOVERY_STAMP}" ]] \
    || die "状态文件候选目录不符合约定：${RECOVERY_DIR}"
  [[ "${CORRUPT_DIR}" == "/data/pgsql.corrupt.${RECOVERY_STAMP}" ]] \
    || die "状态文件旧库目录不符合约定：${CORRUPT_DIR}"
  [[ "${CRON_SERVICE}" =~ ^(crond|cron|none)$ ]] \
    || die "状态文件 cron service 非法：${CRON_SERVICE}"
  [[ "${CRON_FILE_MOVED}" =~ ^[01]$ ]] || die "状态文件 CRON_FILE_MOVED 非法"
  [[ -z "${MANIFEST_SHA256}" || "${MANIFEST_SHA256}" =~ ^[0-9a-f]{64}$ ]] \
    || die "状态文件 manifest SHA256 非法"
}

_assert_primary_host() {
  if ! hostname -I 2>/dev/null | tr ' ' '\n' | grep -qxF "${PG_PRIMARY_LAN_IP}"; then
    die "本机网卡无 ${PG_PRIMARY_LAN_IP} · 仅允许在机器①执行"
  fi
}

_cleanup_temp() {
  local exit_code=$?
  trap - EXIT
  set +e
  [[ -z "${PGPASS_DIR}" ]] || rm -rf "${PGPASS_DIR}"
  exit "${exit_code}"
}
trap _cleanup_temp EXIT

_detect_cron_service() {
  if systemctl is-active --quiet crond 2>/dev/null; then
    printf 'crond'
  elif systemctl is-active --quiet cron 2>/dev/null; then
    printf 'cron'
  else
    printf 'none'
  fi
}

_wait_pg_healthy() {
  local ok=0
  for _ in $(seq 1 30); do
    sleep 3
    if [[ "$(docker inspect --format '{{.State.Health.Status}}' "${PG_CONTAINER}" 2>/dev/null || echo missing)" == "healthy" ]]; then
      ok=1
      break
    fi
  done
  [[ "${ok}" == "1" ]] \
    || die "主库 90s 内未 healthy · 检查 /data/logs/postgres/postgresql.log 与 docker logs ${PG_CONTAINER} --tail 50"
}

_prepare() {
  [[ "${STANDBY_CAUGHT_UP}" == "1" ]] \
    || die "先在机器②确认 receive LSN = replay LSN，再带 --standby-caught-up"
  if [[ -e "${STATE_FILE}" ]]; then
    _load_state
    [[ "${RECOVERY_STATUS}" == "PREPARING" ]] \
      || die "已有恢复状态 ${RECOVERY_STATUS} · 不允许重复 prepare"
    log_warn "检测到上次 prepare 中断，将只重建状态文件约束的候选目录 ${RECOVERY_DIR}"
    confirm "确认重试 PREPARING 阶段并重建候选目录？" || die "用户取消"
  else
    RECOVERY_STAMP=$(date +%Y%m%d-%H%M%S)
    RECOVERY_STATUS="PREPARING"
    RECOVERY_DIR="/data/pgsql.restore.${RECOVERY_STAMP}"
    CORRUPT_DIR="/data/pgsql.corrupt.${RECOVERY_STAMP}"
    CRON_SERVICE=$(_detect_cron_service)
    [[ ! -e "${RECOVERY_DIR}" && ! -e "${CORRUPT_DIR}" ]] \
      || die "恢复候选/归档目录已存在，拒绝覆盖"
  fi
  timeout 5 bash -c "exec 3<>/dev/tcp/${PG_STANDBY_LAN_IP}/15433" 2>/dev/null \
    || die "无法连接 standby ${PG_STANDBY_LAN_IP}:15433 · 先临时放行机器①/32 到该端口"

  log_warn "将停止业务、系统 cron 和旧 PostgreSQL；原 /data/pgsql 此阶段保持不动"
  confirm "确认 standby 已追平，且现在进入主库灾难恢复 prepare？" || die "用户取消"

  if [[ "${DRY_RUN}" == "1" ]]; then
    log_dry "写持久状态 ${STATE_FILE}"
    log_dry "停止 cron/server/postgres，反向 basebackup 到 ${RECOVERY_DIR}，verify 后清除 standby 身份"
    return 0
  fi

  _write_state
  if [[ -f /etc/cron.d/costra-maintenance ]]; then
    [[ ! -e /etc/cron.d/costra-maintenance.recovery-disabled ]] \
      || die "cron recovery-disabled 文件已存在，拒绝覆盖"
    mv /etc/cron.d/costra-maintenance /etc/cron.d/costra-maintenance.recovery-disabled
    CRON_FILE_MOVED=1
    _write_state
  elif [[ -f /etc/cron.d/costra-maintenance.recovery-disabled ]]; then
    [[ "${CRON_FILE_MOVED}" == "1" ]] \
      || die "发现 recovery-disabled cron 但状态文件未记录，拒绝猜测"
  fi
  [[ "${CRON_SERVICE}" == "none" ]] || systemctl stop "${CRON_SERVICE}"
  if [[ "${CRON_SERVICE}" == "none" ]]; then
    ! pgrep -x crond >/dev/null 2>&1 && ! pgrep -x cron >/dev/null 2>&1 \
      || die "检测到非 systemd 管理的 cron 进程 · 请人工停止后重试"
  fi

  cd "${COSTRA_INFRA}"
  docker compose -f "${COSTRA_COMPOSE_FILE}" --env-file "${COSTRA_ENV_FILE}" stop -t 60 server
  [[ "$(docker inspect --format '{{.State.Running}}' costra-server 2>/dev/null || echo false)" == "false" ]] \
    || die "costra-server 仍在运行 · 拒绝继续"
  if docker inspect "${PG_CONTAINER}" >/dev/null 2>&1; then
    docker stop -t 60 "${PG_CONTAINER}" >/dev/null 2>&1 || docker kill "${PG_CONTAINER}" >/dev/null
    docker rm "${PG_CONTAINER}" >/dev/null
  fi
  ! ss -tlnp | grep -q ':5432 ' || die "宿主机仍有 5432 监听 · 拒绝移动 PGDATA"

  if [[ -e "${RECOVERY_DIR}" ]]; then
    [[ "${RECOVERY_STATUS}" == "PREPARING" ]] \
      || die "候选目录存在但状态不是 PREPARING，拒绝清理"
    rm -rf --one-file-system "${RECOVERY_DIR}"
  fi
  mkdir -p "${RECOVERY_DIR}"
  chown "${UID_POSTGRES_ALPINE}:${UID_POSTGRES_ALPINE}" "${RECOVERY_DIR}"
  PGPASS_DIR=$(mktemp -d /run/costra-recovery-pgpass.XXXXXX)
  local pass_file pass_escaped
  pass_file="${PGPASS_DIR}/pgpass"
  pass_escaped=${REPLICATOR_PW//\\/\\\\}
  pass_escaped=${pass_escaped//:/\\:}
  printf '%s:15433:replication:replicator:%s\n' "${PG_STANDBY_LAN_IP}" "${pass_escaped}" > "${pass_file}"
  chown "${UID_POSTGRES_ALPINE}:${UID_POSTGRES_ALPINE}" "${PGPASS_DIR}" "${pass_file}"
  chmod 0700 "${PGPASS_DIR}"
  chmod 0600 "${pass_file}"

  docker run --rm --user postgres \
    -e PGPASSFILE=/run/costra/pgpass \
    -v "${PGPASS_DIR}:/run/costra:ro" \
    -v "${RECOVERY_DIR}:/var/lib/postgresql/data" \
    postgres:15-alpine \
    pg_basebackup -h "${PG_STANDBY_LAN_IP}" -p 15433 -U replicator \
      -D /var/lib/postgresql/data -Fp -Xs --progress

  docker run --rm --user postgres \
    -v "${RECOVERY_DIR}:/var/lib/postgresql/data:ro" \
    postgres:15-alpine pg_verifybackup /var/lib/postgresql/data

  rm -rf "${PGPASS_DIR}"
  PGPASS_DIR=""

  rm -f "${RECOVERY_DIR}/standby.signal" \
    "${RECOVERY_DIR}/recovery.signal" \
    "${RECOVERY_DIR}/.replication.pgpass"
  local auto_conf auto_tmp owner group mode
  auto_conf="${RECOVERY_DIR}/postgresql.auto.conf"
  require_file "${auto_conf}"
  auto_tmp=$(mktemp "${RECOVERY_DIR}/.postgresql.auto.conf.recovery.XXXXXX")
  owner=$(stat -c '%u' "${auto_conf}")
  group=$(stat -c '%g' "${auto_conf}")
  mode=$(stat -c '%a' "${auto_conf}")
  awk '!/^[[:space:]]*(primary_conninfo|primary_slot_name|recovery_target[a-z_]*|restore_command)[[:space:]]*=/' \
    "${auto_conf}" > "${auto_tmp}"
  chown "${owner}:${group}" "${auto_tmp}"
  chmod "${mode}" "${auto_tmp}"
  mv -f "${auto_tmp}" "${auto_conf}"
  [[ ! -e "${RECOVERY_DIR}/standby.signal" && ! -e "${RECOVERY_DIR}/recovery.signal" ]] \
    || die "候选目录仍有 recovery signal"
  ! grep -Eq '^[[:space:]]*(primary_conninfo|primary_slot_name|recovery_target[a-z_]*|restore_command)[[:space:]]*=' "${auto_conf}" \
    || die "候选目录仍有 recovery 参数"

  printf 'verified_at=%s\nsource=%s:15433\n' "$(date -Is)" "${PG_STANDBY_LAN_IP}" \
    > "${RECOVERY_DIR}/${READY_MARKER}"
  chmod 0600 "${RECOVERY_DIR}/${READY_MARKER}"
  chown -R "${UID_POSTGRES_ALPINE}:${UID_POSTGRES_ALPINE}" "${RECOVERY_DIR}"
  MANIFEST_SHA256=$(sha256sum "${RECOVERY_DIR}/backup_manifest" | awk '{print $1}')
  RECOVERY_STATUS="READY"
  _write_state

  log_success "候选主库已验证：${RECOVERY_DIR}"
  log_warn "下一步：机器②停止 costra-standby-pg → 删除反向 15433 安全组 → 本机执行 activate"
}

_activate() {
  _load_state
  if [[ "${RECOVERY_STATUS}" == "ACTIVATED" ]]; then
    local completed_state="${STATE_FILE%.state}.${RECOVERY_STAMP}.done"
    [[ ! -e "${completed_state}" ]] || die "完成态归档已存在：${completed_state}"
    rm -f "/data/pgsql/${READY_MARKER}"
    mv "${STATE_FILE}" "${completed_state}"
    chmod 0600 "${completed_state}"
    log_success "恢复主体已完成 · 已补齐状态归档"
    return 0
  fi
  [[ "${RECOVERY_STATUS}" == "READY" || "${RECOVERY_STATUS}" == "ACTIVATING" ]] \
    || die "当前状态 ${RECOVERY_STATUS} 不能 activate"
  [[ "${SOURCE_STANDBY_STOPPED}" == "1" ]] || die "缺少 --source-standby-stopped"
  [[ "${REVERSE_RULE_REMOVED}" == "1" ]] || die "缺少 --reverse-rule-removed"
  if timeout 3 bash -c "exec 3<>/dev/tcp/${PG_STANDBY_LAN_IP}/15433" 2>/dev/null; then
    die "standby ${PG_STANDBY_LAN_IP}:15433 仍可连接 · 来源未停或临时安全组未删除"
  fi

  if [[ -d "${RECOVERY_DIR}" ]]; then
    require_file "${RECOVERY_DIR}/${READY_MARKER}"
    require_file "${RECOVERY_DIR}/backup_manifest"
    [[ "$(sha256sum "${RECOVERY_DIR}/backup_manifest" | awk '{print $1}')" == "${MANIFEST_SHA256}" ]] \
      || die "候选 backup_manifest SHA256 与 prepare 状态不一致"
    docker run --rm --user postgres \
      -v "${RECOVERY_DIR}:/var/lib/postgresql/data:ro" \
      postgres:15-alpine \
      pg_verifybackup --ignore=postgresql.auto.conf --ignore=.replication.pgpass \
        --ignore=standby.signal --ignore=recovery.signal \
        --ignore="${READY_MARKER}" /var/lib/postgresql/data
  elif [[ -f "/data/pgsql/${READY_MARKER}" ]]; then
    log_warn "检测到上次 activate 已切换 PGDATA，将从主库启动验证阶段继续"
  else
    die "恢复候选既不在 ${RECOVERY_DIR}，也未检测到已切换 marker · 拒绝猜测"
  fi

  log_warn "activate 将把旧 /data/pgsql 归档到 ${CORRUPT_DIR}，启动候选主库后恢复业务"
  confirm "确认来源 standby 已停止、反向规则已删除，并提交 PGDATA 切换？" || die "用户取消"
  if [[ "${DRY_RUN}" == "1" ]]; then
    log_dry "切换 ${RECOVERY_DIR} → /data/pgsql，启动并验证主库，恢复 server/cron"
    return 0
  fi

  RECOVERY_STATUS="ACTIVATING"
  _write_state
  cd "${COSTRA_INFRA}"
  docker compose -f "${COSTRA_COMPOSE_FILE}" --env-file "${COSTRA_ENV_FILE}" stop -t 60 server >/dev/null 2>&1 || true
  if docker inspect "${PG_CONTAINER}" >/dev/null 2>&1; then
    docker stop -t 60 "${PG_CONTAINER}" >/dev/null 2>&1 || docker kill "${PG_CONTAINER}" >/dev/null
    docker rm "${PG_CONTAINER}" >/dev/null
  fi
  ! ss -tlnp | grep -q ':5432 ' || die "宿主机仍有 5432 监听 · 拒绝切换"

  if [[ -d "${RECOVERY_DIR}" ]]; then
    if [[ -d /data/pgsql ]]; then
      if [[ -e "${CORRUPT_DIR}" ]]; then
        log_warn "归档目录已存在，视为上次切换在两次 mv 之间中断：${CORRUPT_DIR}"
      else
        mv /data/pgsql "${CORRUPT_DIR}"
      fi
    fi
    [[ ! -e /data/pgsql ]] || die "切换目标 /data/pgsql 仍存在，拒绝覆盖"
    mv "${RECOVERY_DIR}" /data/pgsql
  fi
  require_file "/data/pgsql/${READY_MARKER}"
  chown -R "${UID_POSTGRES_ALPINE}:${UID_POSTGRES_ALPINE}" /data/pgsql
  [[ ! -e /data/pgsql/standby.signal && ! -e /data/pgsql/recovery.signal ]] \
    || die "新 PGDATA 仍有 recovery signal"

  docker compose -f "${COSTRA_COMPOSE_FILE}" --env-file "${COSTRA_ENV_FILE}" up -d postgres
  _wait_pg_healthy
  [[ "$(docker exec "${PG_CONTAINER}" psql -U costra -d costra -tAc 'SELECT pg_is_in_recovery();')" == "f" ]] \
    || die "候选 PostgreSQL 启动后仍处于 recovery，拒绝恢复业务"

  "${SCRIPT_DIR}/setup-replication-primary.sh"
  docker compose -f "${COSTRA_COMPOSE_FILE}" --env-file "${COSTRA_ENV_FILE}" up -d server nginx
  SERVER_WAIT_OK=0
  for _ in $(seq 1 30); do
    sleep 3
    if [[ "$(docker inspect --format '{{.State.Health.Status}}' costra-server 2>/dev/null || echo missing)" == "healthy" ]]; then
      SERVER_WAIT_OK=1
      break
    fi
  done
  [[ "${SERVER_WAIT_OK}" == "1" ]] \
    || die "costra-server 90s 内未 healthy · 保持 cron 停止，先检查 docker logs costra-server --tail 100"

  if [[ "${CRON_FILE_MOVED}" == "1" && -f /etc/cron.d/costra-maintenance.recovery-disabled ]]; then
    mv /etc/cron.d/costra-maintenance.recovery-disabled /etc/cron.d/costra-maintenance
  fi
  [[ "${CRON_SERVICE}" == "none" ]] || systemctl start "${CRON_SERVICE}"

  local done_state="${STATE_FILE%.state}.${RECOVERY_STAMP}.done"
  RECOVERY_STATUS="ACTIVATED"
  _write_state
  mv "${STATE_FILE}" "${done_state}"
  rm -f "/data/pgsql/${READY_MARKER}"
  chmod 0600 "${done_state}"
  log_success "主库已从 standby 恢复并重新承接业务 · 旧数据保留于 ${CORRUPT_DIR}"
  log_warn "旧 standby 不得原地接回：按方案 §8.3 重建复制槽/从库，并完成双侧检查"
}

_status() {
  _load_state
  printf 'status=%s\nstamp=%s\ncandidate=%s\nold_pgdata=%s\ncron_service=%s\ncron_file_moved=%s\n' \
    "${RECOVERY_STATUS}" "${RECOVERY_STAMP}" "${RECOVERY_DIR}" "${CORRUPT_DIR}" \
    "${CRON_SERVICE}" "${CRON_FILE_MOVED}"
}

require_file "${COSTRA_ENV_FILE}"
require_file "${COSTRA_COMPOSE_FILE}"
REPLICATOR_PW=$(_load_env_kv REPLICATOR_PW)
PG_PRIMARY_LAN_IP=$(_load_env_kv PG_PRIMARY_LAN_IP)
PG_STANDBY_LAN_IP=$(_load_env_kv PG_STANDBY_LAN_IP)
is_valid_ipv4 "${PG_PRIMARY_LAN_IP}" || die "PG_PRIMARY_LAN_IP 非法"
is_valid_ipv4 "${PG_STANDBY_LAN_IP}" || die "PG_STANDBY_LAN_IP 非法"
[[ ${#REPLICATOR_PW} -ge 24 ]] || die "REPLICATOR_PW 过短"
_assert_primary_host

print_section_header "PG 主库反向恢复 · ${ACTION}"
case "${ACTION}" in
  prepare) _prepare ;;
  activate) _activate ;;
  status) _status ;;
esac
