#!/usr/bin/env bash
# =============================================================================
# Costra · PG 从库搭建（机器② = staging 机器 · 一次性 · 数据目录为空才可跑）
# =============================================================================
# 方案文档：docs/ops/pg-standby-backup.md §4
#
# ⚠️ 与 staging 服务栈并存约定（机器② 上 staging 栈可能同时运行）：
#   容器 costra-standby-pg · 数据 /data/pgsql-standby · 日志 /data/logs/standby
#   端口 15433（宿主机侧）· env 文件 /data/conf/standby.env
#   以上全部避开 staging 栈（costra-postgres / /data/pgsql / 5432 / server.env）
#
# 前置（先手工完成再跑本脚本）：
#   1. 机器② 已装 docker、clone 仓库（staging 部署时已具备）
#   2. 机器② /data/conf/standby.env 已就绪（独立文件 · 只含复制密码、主从 IP
#      与可选告警地址 · 切勿复制 prod 业务密码或覆盖 staging 的 server.env）
#   3. 机器① 已完成 setup-replication-primary.sh（replicator 账号 + 复制槽 + pg_hba）
#   4. 云安全组已放行：机器② 内网 IP → 机器① TCP 5432
#   5. 机器② /data/pgsql-standby 必须为空（从库数据完全来自主库）
#
# 本脚本做：
#   ① 校验前置（env / 目录 / 端口 / 主库连通 / 镜像）
#   ② 临时 .pgpass 执行 pg_basebackup，固化 PGDATA 内 0600 复制 passfile
#   ③ 原子维护从库 managed HBA，再以 hot standby 模式启动
#   ④ 验证 recovery / streaming / hot_standby_feedback 红线
#
# 用法：
#   ./setup-replication-standby.sh           # 标准跑（basebackup 前会 confirm）
#   ./setup-replication-standby.sh --repair-existing  # 修复已完成 basebackup 但启动失败的 PGDATA
#   ./setup-replication-standby.sh --repair-existing --prepare-credentials-only # 仅预置新复制凭据，不启动
#   ./setup-replication-standby.sh --dry-run # 只打印不执行
#
# 退出码：0 = 从库就绪 · 1 = 失败
# =============================================================================

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=lib/common.sh
source "${SCRIPT_DIR}/lib/common.sh"

PG_CONTAINER="costra-standby-pg"
PG_DATA_DIR="/data/pgsql-standby"
PG_LOG_DIR="/data/logs/standby"
HBA_FILE="${PG_DATA_DIR}/pg_hba.conf"
STANDBY_ENV_FILE="/data/conf/standby.env"
STANDBY_COMPOSE_FILE="${COSTRA_INFRA}/docker-compose.standby.yml"
REPLICATION_SLOT="costra_standby"
APPLICATION_NAME="costra_standby"
# 宿主机侧监听端口（避开 staging 栈的 5432 与分析栈 costra-analyze-pg 的 15432）
HOST_PORT=15433
# postgres:15-alpine 镜像内 postgres 用户 uid=70（debian 变体是 999 · 见 common.sh 说明）
PG_UID="${UID_POSTGRES_ALPINE}"
REPAIR_EXISTING=0
PREPARE_CREDENTIALS_ONLY=0
PGPASS_DIR=""
HBA_ROLLBACK=""
HBA_CHANGED=0
START_ATTEMPTED=0
SETUP_COMMITTED=0

# --- 解析参数 ---
parse_common_args "$@"
while [[ $# -gt 0 ]]; do
  case "$1" in
    --repair-existing) REPAIR_EXISTING=1; shift ;;
    --prepare-credentials-only) PREPARE_CREDENTIALS_ONLY=1; shift ;;
    --dry-run|-y|--yes) shift ;;
    -h|--help)
      grep '^#' "$0" | sed 's/^# \{0,1\}//' | head -32
      exit 0
      ;;
    *) die "未知参数: $1 · 用 --help 查看" ;;
  esac
done
[[ "${PREPARE_CREDENTIALS_ONLY}" != "1" || "${REPAIR_EXISTING}" == "1" ]] \
  || die "--prepare-credentials-only 必须与 --repair-existing 同时使用"

require_root
require_cmd docker
require_cmd timeout "yum install -y coreutils / apt install -y coreutils"
require_cmd install "yum install -y coreutils / apt install -y coreutils"
require_cmd sha256sum "yum install -y coreutils / apt install -y coreutils"
# ss 用于端口占用检查：缺失时 grep 恒返回 1 会被误判为"端口空闲"，必须硬性要求
require_cmd ss "yum install -y iproute / apt install -y iproute2"
require_file "${STANDBY_ENV_FILE}"
require_file "${STANDBY_COMPOSE_FILE}"

# =============================================================================
# 工具函数
# =============================================================================
_load_env_kv() {
  local key=$1
  local val
  val=$(grep "^${key}=" "${STANDBY_ENV_FILE}" | tail -1 | cut -d= -f2- || true)
  [[ -n "${val}" ]] || die "${STANDBY_ENV_FILE} 缺少 ${key} · 见方案文档 §2.4"
  printf '%s' "${val}"
}

# _pg_scalar <sql> : 通过容器内 Unix socket 执行 SQL，不需要在机器②常驻 prod 业务密码。
_pg_scalar() {
  docker exec "${PG_CONTAINER}" \
    psql -U costra -d costra -tA -v ON_ERROR_STOP=1 -c "$1"
}

_render_replication_passfile() {
  local target=$1 password_escaped
  password_escaped=${REPLICATOR_PW//\\/\\\\}
  password_escaped=${password_escaped//:/\\:}
  printf '%s:5432:replication:replicator:%s\n' \
    "${PG_PRIMARY_LAN_IP}" "${password_escaped}" > "${target}"
  chown "${PG_UID}:${PG_UID}" "${target}"
  chmod 0600 "${target}"
}

_write_replication_passfile() {
  local pass_tmp
  pass_tmp=$(mktemp "${PG_DATA_DIR}/.replication.pgpass.tmp.XXXXXX")
  _render_replication_passfile "${pass_tmp}"
  mv -f "${pass_tmp}" "${PG_DATA_DIR}/.replication.pgpass"
}

_prepare_replication_credentials_only() {
  local pass_target="${PG_DATA_DIR}/.replication.pgpass"
  local pass_tmp pass_backup="" expected
  pass_tmp=$(mktemp "${PG_DATA_DIR}/.replication.pgpass.tmp.XXXXXX")
  _render_replication_passfile "${pass_tmp}"
  if [[ -f "${pass_target}" ]]; then
    pass_backup=$(mktemp "${PG_DATA_DIR}/.replication.pgpass.rollback.XXXXXX")
    cp -p "${pass_target}" "${pass_backup}"
  fi
  if ! mv -f "${pass_tmp}" "${pass_target}"; then
    rm -f "${pass_tmp}" "${pass_backup}"
    die "原子预置复制 passfile 失败"
  fi
  expected=$(cat "${pass_target}")
  if [[ -z "${expected}" || "$(stat -c '%a:%u' "${pass_target}")" != "600:${PG_UID}" ]]; then
    if [[ -n "${pass_backup}" ]]; then
      mv -f "${pass_backup}" "${pass_target}"
    else
      rm -f "${pass_target}"
    fi
    die "新 passfile 自检失败 · 已恢复旧凭据"
  fi
  rm -f "${pass_backup}"
}

_normalize_recovery_config() {
  local auto_conf="${PG_DATA_DIR}/postgresql.auto.conf"
  local conf_tmp owner group mode
  require_file "${auto_conf}"
  conf_tmp=$(mktemp "${PG_DATA_DIR}/.postgresql.auto.conf.tmp.XXXXXX")
  owner=$(stat -c '%u' "${auto_conf}")
  group=$(stat -c '%g' "${auto_conf}")
  mode=$(stat -c '%a' "${auto_conf}")
  awk '!/^[[:space:]]*(primary_conninfo|primary_slot_name)[[:space:]]*=/' \
    "${auto_conf}" > "${conf_tmp}"
  cat >> "${conf_tmp}" <<EOF
primary_conninfo = 'host=${PG_PRIMARY_LAN_IP} port=5432 user=replicator application_name=${APPLICATION_NAME} passfile=/var/lib/postgresql/data/.replication.pgpass'
primary_slot_name = '${REPLICATION_SLOT}'
EOF
  chown "${owner}:${group}" "${conf_tmp}"
  chmod "${mode}" "${conf_tmp}"
  mv -f "${conf_tmp}" "${auto_conf}"
  install -o "${PG_UID}" -g "${PG_UID}" -m 0600 /dev/null "${PG_DATA_DIR}/standby.signal"
}

_cleanup_standby_setup() {
  local exit_code=$?
  trap - EXIT
  set +e
  [[ -z "${PGPASS_DIR}" ]] || rm -rf "${PGPASS_DIR}"
  if [[ "${exit_code}" -ne 0 && "${SETUP_COMMITTED}" != "1" ]]; then
    if [[ "${START_ATTEMPTED}" == "1" ]]; then
      docker compose -f "${STANDBY_COMPOSE_FILE}" --env-file "${STANDBY_ENV_FILE}" down >/dev/null 2>&1 || true
    fi
    if [[ "${HBA_CHANGED}" == "1" && -n "${HBA_ROLLBACK}" && -f "${HBA_ROLLBACK}" ]]; then
      cp -p "${HBA_ROLLBACK}" "${HBA_FILE}"
      log_warn "从库初始化未提交 · 已停止半启动容器并恢复原 pg_hba.conf"
    fi
  fi
  [[ -z "${HBA_ROLLBACK}" ]] || rm -f "${HBA_ROLLBACK}"
  exit "${exit_code}"
}
trap _cleanup_standby_setup EXIT

# =============================================================================
# 主流程
# =============================================================================
print_section_header "PG 从库搭建（机器② = staging 机器 · setup-replication-standby）"

log_step "[1/8] 读取最小复制环境变量（${STANDBY_ENV_FILE}）"
REPLICATOR_PW=$(_load_env_kv "REPLICATOR_PW")
PG_PRIMARY_LAN_IP=$(_load_env_kv "PG_PRIMARY_LAN_IP")
PG_STANDBY_LAN_IP=$(_load_env_kv "PG_STANDBY_LAN_IP")

for _kv in "PG_PRIMARY_LAN_IP=${PG_PRIMARY_LAN_IP}" "PG_STANDBY_LAN_IP=${PG_STANDBY_LAN_IP}"; do
  is_valid_ipv4 "${_kv#*=}" \
    || die "${_kv%%=*} 不是合法 IPv4：'${_kv#*=}' · 注释必须独占一行，值不能带空格"
done
[[ "${PG_PRIMARY_LAN_IP}" != "${PG_STANDBY_LAN_IP}" ]] \
  || die "主从库内网 IP 相同（${PG_PRIMARY_LAN_IP}）"
[[ ${#REPLICATOR_PW} -ge 24 ]] || die "REPLICATOR_PW 过短（${#REPLICATOR_PW} 字符 < 24）"

# 防呆：必须明确命中本机 standby IP，而不只是“本机不是主库”。
if ! hostname -I 2>/dev/null | tr ' ' '\n' | grep -qxF "${PG_STANDBY_LAN_IP}"; then
  die "本机网卡无 ${PG_STANDBY_LAN_IP}（PG_STANDBY_LAN_IP）· 本脚本必须在从库机器（机器②）执行 · 当前网卡：$(hostname -I 2>/dev/null)"
fi

log_step "[2/8] 准备数据目录（${PG_DATA_DIR} · 避开 staging 的 /data/pgsql）"
if [[ "${DRY_RUN}" == "1" ]]; then
  log_dry "mkdir -p ${PG_DATA_DIR} ${PG_LOG_DIR} && chown -R ${PG_UID}:${PG_UID} ${PG_DATA_DIR} ${PG_LOG_DIR}"
else
  if [[ "${PREPARE_CREDENTIALS_ONLY}" == "1" ]]; then
    [[ "$(docker inspect --format '{{.State.Running}}' "${PG_CONTAINER}" 2>/dev/null || echo false)" == "true" ]] \
      || die "仅凭据预置要求 ${PG_CONTAINER} 正在运行，以保持旧复制连接不中断"
  elif [[ "$(docker inspect --format '{{.State.Running}}' "${PG_CONTAINER}" 2>/dev/null || echo false)" == "true" ]]; then
    die "${PG_CONTAINER} 正在运行 · 修复/重建模式会改 PGDATA，必须先 down；密码轮换预置请加 --prepare-credentials-only"
  fi
  if [[ -d "${PG_DATA_DIR}" ]] && [[ -n "$(ls -A "${PG_DATA_DIR}")" ]]; then
    if [[ "${REPAIR_EXISTING}" != "1" ]]; then
      die "${PG_DATA_DIR} 非空 · 标准模式只接受空目录；若这是本脚本刚完成 basebackup 但启动失败的目录，核实后带 --repair-existing"
    fi
    require_file "${PG_DATA_DIR}/PG_VERSION"
    require_file "${PG_DATA_DIR}/backup_manifest"
    require_file "${PG_DATA_DIR}/postgresql.auto.conf"
    require_file "${PG_DATA_DIR}/pg_hba.conf"
    [[ "$(<"${PG_DATA_DIR}/PG_VERSION")" == "15" ]] \
      || die "repair-existing 仅接受 PG15 basebackup，实际 PG_VERSION=$(<"${PG_DATA_DIR}/PG_VERSION")"
    log_warn "repair-existing：先复验既有 basebackup，再幂等重建 standby.signal、recovery config 与 passfile"
  elif [[ "${REPAIR_EXISTING}" == "1" ]]; then
    die "--repair-existing 仅用于非空且具备完整 standby 标记的 PGDATA"
  fi
  mkdir -p "${PG_DATA_DIR}" "${PG_LOG_DIR}"
  CUR_OWNER=$(stat -c '%u' "${PG_DATA_DIR}")
  if [[ "${CUR_OWNER}" != "${PG_UID}" ]]; then
    chown -R "${PG_UID}:${PG_UID}" "${PG_DATA_DIR}"
    log_info "数据目录 owner 已修正为 ${PG_UID}"
  fi
  # 日志目录：logging_collector 写固定 postgresql.log，owner 必须与容器内
  # postgres 用户一致，避免 permission denied 导致启动失败。
  chown -R "${PG_UID}:${PG_UID}" "${PG_LOG_DIR}"
fi
if [[ "${REPAIR_EXISTING}" == "1" ]]; then
  log_success "既有 standby 数据目录基础标记就绪 ✓"
else
  log_success "数据目录就绪（空）✓"
fi

log_step "[3/8] 校验 standby 端口状态（避开 staging 栈 5432 / 分析栈 15432）"
if [[ "${DRY_RUN}" == "1" ]]; then
  if [[ "${PREPARE_CREDENTIALS_ONLY}" == "1" ]]; then
    log_dry "仅凭据预置模式允许当前 ${PG_CONTAINER} 占用 ${HOST_PORT}"
  else
    log_dry "ss -tln | grep ':${HOST_PORT} ' 应为空"
  fi
elif ss -tln | grep -q ":${HOST_PORT} "; then
  if [[ "${PREPARE_CREDENTIALS_ONLY}" == "1" ]] \
    && [[ "$(docker inspect --format '{{.State.Running}}' "${PG_CONTAINER}" 2>/dev/null || echo false)" == "true" ]]; then
    log_info "仅凭据预置：${HOST_PORT} 由当前 ${PG_CONTAINER} 占用，允许在线原子替换 passfile"
  else
    die "端口 ${HOST_PORT} 已被占用 · 请排查后释放（ss -tlnp | grep :${HOST_PORT}）"
  fi
fi
log_success "standby 端口状态符合当前模式 ✓"

if [[ "${PREPARE_CREDENTIALS_ONLY}" == "1" ]]; then
  log_step "仅凭据预置：原子替换 passfile（不校验历史 manifest、不改 recovery config、不重启）"
  if [[ "${DRY_RUN}" == "1" ]]; then
    log_dry "原子替换 ${PG_DATA_DIR}/.replication.pgpass 并校验 0600:${PG_UID}"
  else
    grep -qF "passfile=/var/lib/postgresql/data/.replication.pgpass" \
      "${PG_DATA_DIR}/postgresql.auto.conf" \
      || die "当前 primary_conninfo 未引用持久 passfile · 不能在线预置凭据"
    [[ -f "${PG_DATA_DIR}/standby.signal" ]] || die "当前 PGDATA 缺少 standby.signal"
    _prepare_replication_credentials_only
  fi
  SETUP_COMMITTED=1
  log_success "新复制凭据已原子预置；当前旧 walreceiver 连接未重启。现在去机器①提交密码轮换"
  exit 0
fi

log_step "[4/8] 校验主库连通性（${PG_PRIMARY_LAN_IP}:5432）"
if [[ "${DRY_RUN}" == "1" ]]; then
  log_dry "TCP 连通性测试 ${PG_PRIMARY_LAN_IP}:5432"
else
  [[ "${REPAIR_EXISTING}" != "1" ]] \
    || log_info "repair-existing：仍校验主库 TCP 可达，避免修复后启动即永久重连失败"
  if ! timeout 5 bash -c "exec 3<>/dev/tcp/${PG_PRIMARY_LAN_IP}/5432" 2>/dev/null; then
    die "无法连接主库 ${PG_PRIMARY_LAN_IP}:5432 · 检查安全组放行 + 主库容器端口绑定 + ip route get ${PG_PRIMARY_LAN_IP} 是否走 eth0"
  fi
fi
log_success "主库可达 ✓"

log_step "[5/8] 确认 postgres 镜像存在"
if ! docker image inspect postgres:15-alpine >/dev/null 2>&1; then
  log_info "镜像不存在 · 拉取 postgres:15-alpine"
  run_cmd docker pull postgres:15-alpine
else
  log_info "镜像已存在 · 跳过 pull"
fi

log_step "[6/8] pg_basebackup / manifest 校验 / standby 身份规范化"
if [[ "${DRY_RUN}" == "1" ]]; then
  if [[ "${REPAIR_EXISTING}" == "1" ]]; then
    log_dry "复验既有 backup_manifest（仅忽略本脚本合法修改的 pg_hba.conf/passfile）"
  else
    log_dry "docker run --rm --user postgres ... pg_basebackup -h ${PG_PRIMARY_LAN_IP} ...（不带 -R）"
    log_dry "对原始 basebackup 运行 pg_verifybackup"
  fi
  log_dry "原子写入 PGDATA/.replication.pgpass、standby.signal、primary_conninfo 与 primary_slot_name"
else
  if [[ "${REPAIR_EXISTING}" != "1" ]]; then
    log_warn "将从主库 ${PG_PRIMARY_LAN_IP} 物理复制全量数据到 ${PG_DATA_DIR}"
    log_warn "耗时与数据量相关（记账数据量通常 1~5 分钟）· 期间主库零影响（异步）"
    confirm "确认开始 pg_basebackup？" || die "用户取消"
    # 不带 -R：先验证服务端原始备份，再由本脚本确定性写入恢复配置，避免临时
    # passfile 路径进入 primary_conninfo，也让 repair-existing 能恢复任意中断点。
    PGPASS_DIR=$(mktemp -d /run/costra-standby-pgpass.XXXXXX)
    PGPASS_FILE="${PGPASS_DIR}/pgpass"
    PGPASS_PASSWORD=${REPLICATOR_PW//\\/\\\\}
    PGPASS_PASSWORD=${PGPASS_PASSWORD//:/\\:}
    printf '%s:5432:replication:replicator:%s\n' "${PG_PRIMARY_LAN_IP}" "${PGPASS_PASSWORD}" > "${PGPASS_FILE}"
    chown "${PG_UID}:${PG_UID}" "${PGPASS_DIR}" "${PGPASS_FILE}"
    chmod 0700 "${PGPASS_DIR}"
    chmod 0600 "${PGPASS_FILE}"

    docker run --rm \
      --user postgres \
      -e PGPASSFILE=/run/costra/pgpass \
      -v "${PGPASS_DIR}:/run/costra:ro" \
      -v "${PG_DATA_DIR}:/var/lib/postgresql/data" \
      postgres:15-alpine \
      pg_basebackup \
        -h "${PG_PRIMARY_LAN_IP}" -p 5432 -U replicator \
        -D /var/lib/postgresql/data \
        -Fp -Xs -S "${REPLICATION_SLOT}" \
        -d "application_name=${APPLICATION_NAME}"

    docker run --rm \
      --user postgres \
      -v "${PG_DATA_DIR}:/var/lib/postgresql/data:ro" \
      postgres:15-alpine \
      pg_verifybackup /var/lib/postgresql/data
  else
    # repair 模式复验除本脚本确定性修改项之外的全部物理备份文件。旧版本可能
    # 把 pg_hba.conf.bak.* 纳入了原始 manifest；必须先保留它们完成复验，再移出 PGDATA。
    HBA_BACKUP_DIR="/data/conf/standby-hba-backups"
    mkdir -p "${HBA_BACKUP_DIR}"
    chmod 0700 "${HBA_BACKUP_DIR}"
    while IFS= read -r -d '' legacy_hba_backup; do
      legacy_name=$(basename "${legacy_hba_backup}")
      [[ "${legacy_name}" =~ ^pg_hba\.conf\.bak\.[0-9]{8}-[0-9]{6}$ ]] \
        || die "发现未知 PGDATA HBA 备份文件：${legacy_name}"
    done < <(find "${PG_DATA_DIR}" -maxdepth 1 -type f -name 'pg_hba.conf.bak.*' -print0)
    docker run --rm \
      --user postgres \
      -v "${PG_DATA_DIR}:/var/lib/postgresql/data:ro" \
      postgres:15-alpine \
      pg_verifybackup --ignore=pg_hba.conf --ignore=postgresql.auto.conf \
        --ignore=.replication.pgpass --ignore=standby.signal \
        /var/lib/postgresql/data
    while IFS= read -r -d '' legacy_hba_backup; do
      legacy_name=$(basename "${legacy_hba_backup}")
      mv "${legacy_hba_backup}" "${HBA_BACKUP_DIR}/${legacy_name}"
    done < <(find "${PG_DATA_DIR}" -maxdepth 1 -type f -name 'pg_hba.conf.bak.*' -print0)
  fi

  _write_replication_passfile
  _normalize_recovery_config
  rm -rf "${PGPASS_DIR}"
  PGPASS_DIR=""
fi

log_step "[7/8] 校验 basebackup 产物 + 收紧从库 pg_hba"
STANDBY_HBA_BLOCK="# BEGIN COSTRA MANAGED REPLICATION
# 仅供灾难恢复时机器①反向 pg_basebackup；日常由安全组关闭 15433 入站。
host replication replicator ${PG_PRIMARY_LAN_IP}/32 scram-sha-256
host replication all 0.0.0.0/0 reject
host replication all ::/0 reject
# 普通 TCP 数据库连接全部拒绝；本机运维只走容器内 Unix socket。
host all all 0.0.0.0/0 reject
host all all ::/0 reject
# END COSTRA MANAGED REPLICATION"
LEGACY_PRIMARY_HBA_LINE="host replication replicator ${PG_PRIMARY_LAN_IP}/32 scram-sha-256"
if [[ "${DRY_RUN}" == "1" ]]; then
  log_dry "校验 standby.signal + primary_conninfo"
  log_dry "原子替换 ${HBA_FILE} managed block：只允许 ${PG_PRIMARY_LAN_IP}/32 反向物理复制，拒绝全部普通 TCP"
else
  [[ -f "${PG_DATA_DIR}/standby.signal" ]] \
    || die "缺少 standby.signal · basebackup 产物异常"
  grep -q "application_name=${APPLICATION_NAME}" "${PG_DATA_DIR}/postgresql.auto.conf" \
    || die "primary_conninfo 缺少 application_name=${APPLICATION_NAME}"
  grep -qF "/var/lib/postgresql/data/.replication.pgpass" "${PG_DATA_DIR}/postgresql.auto.conf" \
    || die "primary_conninfo 未指向持久复制密码文件 · standby 启动后将无法重连"
  PGPASS_PASSWORD=${REPLICATOR_PW//\\/\\\\}
  PGPASS_PASSWORD=${PGPASS_PASSWORD//:/\\:}
  PGPASS_EXPECTED="${PG_PRIMARY_LAN_IP}:5432:replication:replicator:${PGPASS_PASSWORD}"
  [[ "$(cat "${PG_DATA_DIR}/.replication.pgpass")" == "${PGPASS_EXPECTED}" ]] \
    || die ".replication.pgpass 与当前 standby.env 不一致 · 先按文档 §12 完成密码同步，拒绝启动"
  [[ "$(stat -c '%a:%u' "${PG_DATA_DIR}/.replication.pgpass")" == "600:${PG_UID}" ]] \
    || die ".replication.pgpass 权限/属主异常（期望 600:${PG_UID}）"
  backup_file "${HBA_FILE}" "/data/conf/standby-hba-backups"
  HBA_ROLLBACK=$(mktemp "${HBA_FILE}.costra-rollback.XXXXXX")
  cp -p "${HBA_FILE}" "${HBA_ROLLBACK}"
  HBA_CHANGED=1
  replace_pg_hba_managed_block "${HBA_FILE}" "${STANDBY_HBA_BLOCK}" "${LEGACY_PRIMARY_HBA_LINE}"
  HBA_FILE_SHA256=$(sha256sum "${HBA_FILE}" | awk '{print $1}')
fi
log_success "standby 身份标记 + 最小权限 pg_hba 就绪 ✓"

log_step "[8/8] 启动从库容器 + 验证流复制"
if [[ "${DRY_RUN}" == "1" ]]; then
  log_dry "docker compose -f docker-compose.standby.yml --env-file ${STANDBY_ENV_FILE} up -d"
else
  confirm "确认启动从库容器？" || die "用户取消"
  cd "${COSTRA_INFRA}"
  START_ATTEMPTED=1
  docker compose -f "${STANDBY_COMPOSE_FILE}" --env-file "${STANDBY_ENV_FILE}" up -d

  log_info "等待 ${PG_CONTAINER} healthy..."
  WAIT_OK=0
  for _ in $(seq 1 30); do
    sleep 3
    if [[ "$(docker inspect --format '{{.State.Health.Status}}' "${PG_CONTAINER}" 2>/dev/null || echo missing)" == "healthy" ]]; then
      WAIT_OK=1
      break
    fi
  done
  [[ "${WAIT_OK}" == "1" ]] \
    || die "等待 healthy 超时（90s）· 统一清理会停止容器并回滚 HBA · 先查看宿主机 ${PG_LOG_DIR}/postgresql.log"
fi

# =============================================================================
# 验证输出（dry-run 跳过）
# =============================================================================
if [[ "${DRY_RUN}" == "1" ]]; then
  log_info "（dry-run · 跳过验证）"
  exit 0
fi

echo ""
log_step "验证"
IS_RECOVERY=$(_pg_scalar "SELECT pg_is_in_recovery()")
echo "  pg_is_in_recovery : ${IS_RECOVERY}（期望 t）"
[[ "${IS_RECOVERY}" == "t" ]] \
  || die "从库未处于 recovery 模式 · 统一清理会停止容器并回滚 HBA"

HOT_STANDBY_FEEDBACK=$(_pg_scalar "SHOW hot_standby_feedback")
echo "  hot_standby_feedback: ${HOT_STANDBY_FEEDBACK}（期望 off）"
[[ "${HOT_STANDBY_FEEDBACK}" == "off" ]] \
  || die "hot_standby_feedback=${HOT_STANDBY_FEEDBACK} · 统一清理会停止容器并回滚 HBA，避免反压主库 vacuum"

HBA_ERRORS=$(_pg_scalar "SELECT count(*) FROM pg_hba_file_rules WHERE error IS NOT NULL")
[[ "${HBA_ERRORS}" == "0" ]] \
  || die "pg_hba_file_rules 发现 ${HBA_ERRORS} 条错误 · 统一清理会停止容器并回滚 HBA"

[[ "$(sha256sum "${HBA_FILE}" | awk '{print $1}')" == "${HBA_FILE_SHA256}" ]] \
  || die "容器启动期间 pg_hba.conf 被非预期改写 · 拒绝提交初始化"
WAL_RX_STATUS=$(_pg_scalar "SELECT status FROM pg_stat_wal_receiver" || true)
echo "  walreceiver 状态  : ${WAL_RX_STATUS:-（无）}（期望 streaming）"
[[ "${WAL_RX_STATUS}" == "streaming" ]] \
  || die "walreceiver 未进入 streaming · 统一清理会停止容器并回滚 HBA · 检查 ${PG_LOG_DIR}/postgresql.log"

RECEIVE_LSN=$(_pg_scalar "SELECT COALESCE(pg_last_wal_receive_lsn()::text, '(无)')")
REPLAY_LSN=$(_pg_scalar "SELECT COALESCE(pg_last_wal_replay_lsn()::text, '(无)')")
echo "  已接收 WAL LSN    : ${RECEIVE_LSN}"
echo "  已回放 WAL LSN    : ${REPLAY_LSN}"
SETUP_COMMITTED=1

echo ""
log_success "从库就绪 · 后续步骤见方案文档 §5~§7（备份 cron / 监控告警 / 只读查询）"
exit 0
