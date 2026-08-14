#!/usr/bin/env bash
# =============================================================================
# Costra · PG 主库流复制配置（机器① · 一次性 · 幂等可重跑）
# =============================================================================
# 方案文档：docs/ops/pg-standby-backup.md §3
#
# 前置（先手工完成再跑本脚本）：
#   1. server.env 已追加三项：REPLICATOR_PW / PG_PRIMARY_LAN_IP / PG_STANDBY_LAN_IP
#   2. docker-compose.prod.yml 已含内网端口映射 + max_slot_wal_keep_size=10GB
#      （git pull 拿到最新仓库即可）
#   3. 云安全组已放行：机器② 内网 IP → 机器① TCP 5432
#
# 本脚本做（全部幂等）：
#   ① 校验上述前置 + 容器端口绑定是否已生效
#   ② [--apply-compose] 需要时 recreate postgres 容器（PG 短暂重启 · 建议低峰）
#   ③ 建 replicator 复制专用账号（REPLICATION + LOGIN · 最小权限）
#   ④ 建物理复制槽 costra_standby（从库断连期间主库保留其 WAL）
#   ⑤ 原子维护 pg_hba managed block：只放行从库物理复制，拒绝其普通连接
#   ⑥ pg_reload_conf + 异步复制/HBA 自检输出（供核对）
#
# 用法：
#   ./setup-replication-primary.sh                  # 校验 + 配置（容器未生效则停止）
#   ./setup-replication-primary.sh --apply-compose  # 需要时一并 recreate postgres
#   ./setup-replication-primary.sh --recreate-lost-slot  # 仅 lost 槽：确认后重建
#   ./setup-replication-primary.sh --rotate-replicator-password  # 已按文档同步更新 standby passfile 后轮换
#   ./setup-replication-primary.sh --dry-run        # 只打印不执行
#
# 退出码：0 = 主库复制配置就绪 · 1 = 失败
# =============================================================================

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=lib/common.sh
source "${SCRIPT_DIR}/lib/common.sh"

PG_CONTAINER="costra-postgres"
HBA_FILE="/data/pgsql/pg_hba.conf"
REPLICATION_SLOT="costra_standby"
APPLY_COMPOSE=0
RECREATE_LOST_SLOT=0
ROTATE_REPLICATOR_PASSWORD=0
ROTATE_PASSWORD_PENDING=0
PASSWORD_ROTATED=0
HBA_ROLLBACK=""
HBA_FILE_SHA256=""
HBA_CHANGED=0
HBA_RELOADED=0
SETUP_COMMITTED=0

# --- 解析参数 ---
parse_common_args "$@"
while [[ $# -gt 0 ]]; do
  case "$1" in
    --apply-compose) APPLY_COMPOSE=1; shift ;;
    --recreate-lost-slot) RECREATE_LOST_SLOT=1; shift ;;
    --rotate-replicator-password) ROTATE_REPLICATOR_PASSWORD=1; shift ;;
    --dry-run|-y|--yes) shift ;;
    -h|--help)
      grep '^#' "$0" | sed 's/^# \{0,1\}//' | head -28
      exit 0
      ;;
    *) die "未知参数: $1 · 用 --help 查看" ;;
  esac
done

require_root
require_cmd docker
require_cmd sha256sum "yum install -y coreutils / apt install -y coreutils"
require_file "${COSTRA_ENV_FILE}"
require_file "${COSTRA_COMPOSE_FILE}"

# =============================================================================
# 工具函数
# =============================================================================
_load_env_kv() {
  local key=$1
  local val
  val=$(grep "^${key}=" "${COSTRA_ENV_FILE}" | tail -1 | cut -d= -f2- || true)
  [[ -n "${val}" ]] || die "${COSTRA_ENV_FILE} 缺少 ${key} · 见方案文档 §2.3"
  printf '%s' "${val}"
}

# _pg_scalar <sql> : 通过容器内 Unix socket 执行 SQL，不把业务密码暴露给进程环境。
_pg_scalar() {
  docker exec "${PG_CONTAINER}" \
    psql -U costra -d costra -tA -v ON_ERROR_STOP=1 -c "$1"
}

# _pg_stdin <sql> [psql args...] : 经 stdin 送入 SQL。
# psql 的 -c 不做变量插值（:'var' 会被原样发给服务端，报 syntax error at or near ":"），
# 凡是带 :'var' 的语句必须走 stdin 才能展开，docker exec 需加 -i 接管 stdin。
_pg_stdin() {
  local sql=$1; shift
  printf '%s\n' "${sql}" | docker exec -i "${PG_CONTAINER}" \
    psql -U costra -d costra -tA -v ON_ERROR_STOP=1 "$@"
}

_assert_pg_healthy() {
  local health
  health=$(docker inspect --format '{{.State.Health.Status}}' "${PG_CONTAINER}" 2>/dev/null || echo "missing")
  [[ "${health}" == "healthy" ]] || die "${PG_CONTAINER} 状态异常（${health}）· 请先恢复主库健康"
}

_cleanup_primary_setup() {
  local exit_code=$?
  trap - EXIT
  set +e
  if [[ "${exit_code}" -ne 0 && "${SETUP_COMMITTED}" != "1" \
    && "${HBA_CHANGED}" == "1" && -n "${HBA_ROLLBACK}" && -f "${HBA_ROLLBACK}" ]]; then
    cp -p "${HBA_ROLLBACK}" "${HBA_FILE}"
    if [[ "${HBA_RELOADED}" == "1" ]]; then
      _pg_scalar "SELECT pg_reload_conf()" >/dev/null 2>&1 || true
      log_warn "主库配置未提交 · 已恢复原 pg_hba.conf 并尝试 reload"
    else
      log_warn "主库配置未提交 · 已恢复原 pg_hba.conf（候选规则尚未 reload）"
    fi
  fi
  if [[ "${exit_code}" -ne 0 && "${PASSWORD_ROTATED}" == "1" ]]; then
    log_warn "replicator 密码已成功轮换，不会随脚本失败回滚 · standby.env 与 PGDATA passfile 必须继续保留新值"
  fi
  [[ -z "${HBA_ROLLBACK}" ]] || rm -f "${HBA_ROLLBACK}"
  exit "${exit_code}"
}
trap _cleanup_primary_setup EXIT

# =============================================================================
# 主流程
# =============================================================================
print_section_header "PG 主库流复制配置（机器① · setup-replication-primary）"

log_step "[1/6] 读取环境变量"
REPLICATOR_PW=$(_load_env_kv "REPLICATOR_PW")
PG_PRIMARY_LAN_IP=$(_load_env_kv "PG_PRIMARY_LAN_IP")
PG_STANDBY_LAN_IP=$(_load_env_kv "PG_STANDBY_LAN_IP")
[[ "${PG_PRIMARY_LAN_IP}" != "${PG_STANDBY_LAN_IP}" ]] || die "主从库内网 IP 相同（${PG_PRIMARY_LAN_IP}）· 检查 ${COSTRA_ENV_FILE}"

# 格式校验：env 行尾内联注释会被 cut -d= -f2- 整串取出（"1.2.3.4  # 注释"），
# 导致 compose bind IP 非法 / TCP 探测失败。这里提前拦住，别等 recreate 时才炸。
for _kv in "PG_PRIMARY_LAN_IP=${PG_PRIMARY_LAN_IP}" "PG_STANDBY_LAN_IP=${PG_STANDBY_LAN_IP}"; do
  is_valid_ipv4 "${_kv#*=}" \
    || die "${_kv%%=*} 不是合法 IPv4：'${_kv#*=}' · 检查 ${COSTRA_ENV_FILE} 是否写了行尾注释或多余空格（注释必须独占一行）"
done

# 防呆：本脚本必须在主库机器上跑（与 setup-replication-standby.sh 的检查对称）。
# 在从库机器（staging 机器）误跑会在 staging 的库上建 replicator / 建槽 / 改
# /data/pgsql/pg_hba.conf —— 恰好踩中"绝不污染 staging"的红线。
if ! hostname -I 2>/dev/null | tr ' ' '\n' | grep -qxF "${PG_PRIMARY_LAN_IP}"; then
  die "本机网卡无 ${PG_PRIMARY_LAN_IP}（PG_PRIMARY_LAN_IP）· 本脚本必须在主库机器（机器①）上执行 · 当前网卡：$(hostname -I 2>/dev/null)"
fi

# 密码安全校验：REPLICATOR_PW 将经 psql 变量注入 · 不允许含单引号（gen_password 产物天然不含）
[[ "${REPLICATOR_PW}" != *"'"* ]] || die "REPLICATOR_PW 不允许含单引号 · 请用 openssl rand -base64 32 | tr -d '/+=\\n' 重新生成"
[[ ${#REPLICATOR_PW} -ge 24 ]] || die "REPLICATOR_PW 过短（${#REPLICATOR_PW} 字符 < 24）· 请重新生成"

log_step "[2/6] 校验主库容器健康 + 异步复制红线"
_assert_pg_healthy
SYNC_STANDBY_NAMES=$(_pg_scalar "SHOW synchronous_standby_names")
[[ -z "${SYNC_STANDBY_NAMES}" ]] \
  || die "synchronous_standby_names 非空（${SYNC_STANDBY_NAMES}）· 当前主库可能等待从库 COMMIT，违反纯异步红线 · 先清理遗留 ALTER SYSTEM 配置"
log_success "${PG_CONTAINER} healthy · synchronous_standby_names 为空 ✓"

log_step "[3/6] 校验 compose 改动已生效（实测运行态 · 非文本匹配）"
# 两项判据都查"当前运行的 PG 实际是什么样"，而非 grep compose 文件文本：
#   ① 端口绑定：docker port 实测
#   ② WAL 护栏：SHOW max_slot_wal_keep_size 实测（0 = 未生效/未限制）
# 这样无论 compose 写法怎么变（兜底 IP 调整、参数换行），判据都不会失真。
COMPOSE_EFFECTIVE=1
docker port "${PG_CONTAINER}" 5432/tcp 2>/dev/null | grep -qF "${PG_PRIMARY_LAN_IP}:5432" || {
  log_warn "容器尚未绑定 ${PG_PRIMARY_LAN_IP}:5432"
  COMPOSE_EFFECTIVE=0
}
CUR_WAL_GUARD=$(_pg_scalar "SHOW max_slot_wal_keep_size")
if [[ "${CUR_WAL_GUARD}" == "-1" ]] || [[ "${CUR_WAL_GUARD}" == "0" ]]; then
  log_warn "max_slot_wal_keep_size 未生效（当前 ${CUR_WAL_GUARD}）· 从库久挂会让 WAL 无限堆积"
  COMPOSE_EFFECTIVE=0
fi

if [[ "${COMPOSE_EFFECTIVE}" == "0" ]]; then
  log_warn "compose 变更尚未落地到运行容器"
  if [[ "${APPLY_COMPOSE}" == "1" ]]; then
    log_warn "即将 recreate ${PG_CONTAINER} · 主库 PG 会短暂重启（秒级~十几秒）· 建议低峰执行"
    confirm "确认 recreate postgres 容器？" || die "用户取消"
    cd "${COSTRA_INFRA}"
    run_cmd docker compose -f "${COSTRA_COMPOSE_FILE}" --env-file "${COSTRA_ENV_FILE}" up -d postgres
    if [[ "${DRY_RUN}" != "1" ]]; then
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
        || die "等待 healthy 超时（90s）· 检查 /data/logs/postgres/postgresql.log 与 docker logs ${PG_CONTAINER} --tail 50"
      # recreate 后复验两项判据，避免"以为改了其实没改"
      docker port "${PG_CONTAINER}" 5432/tcp 2>/dev/null | grep -qF "${PG_PRIMARY_LAN_IP}:5432" \
        || die "recreate 后仍未绑定 ${PG_PRIMARY_LAN_IP}:5432 · 检查 ${COSTRA_ENV_FILE} 的 PG_PRIMARY_LAN_IP 是否含行尾注释/空格，以及仓库是否已 git pull"
      CUR_WAL_GUARD=$(_pg_scalar "SHOW max_slot_wal_keep_size")
      [[ "${CUR_WAL_GUARD}" != "-1" && "${CUR_WAL_GUARD}" != "0" ]] \
        || die "recreate 后 max_slot_wal_keep_size 仍未生效（${CUR_WAL_GUARD}）· 检查 compose command 是否已 git pull"
    fi
  else
    die "请带 --apply-compose 重跑（确认低峰窗口后）· 或先在机器① git pull 最新仓库（见方案文档 §3.1）"
  fi
fi
log_success "端口绑定 ${PG_PRIMARY_LAN_IP}:5432 + WAL 护栏 ${CUR_WAL_GUARD} 均已生效 ✓"

log_step "[4/6] 配置 replicator 最小权限属性（既有密码默认不变）"
if [[ "${DRY_RUN}" == "1" ]]; then
  log_dry "psql: 不存在则创建最小权限角色；已存在则规范化角色属性且不改密码；显式轮换延后到全部 preflight 通过后"
else
  ROLE_EXISTS=$(_pg_scalar "SELECT 1 FROM pg_roles WHERE rolname='replicator'")
  if [[ -z "${ROLE_EXISTS}" ]]; then
    ROLE_SQL="CREATE ROLE replicator WITH REPLICATION LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOBYPASSRLS PASSWORD :'pw'"
    _pg_stdin "${ROLE_SQL}" -v pw="${REPLICATOR_PW}" >/dev/null
    log_info "replicator 不存在 · 已按最小权限创建"
  else
    ROLE_MEMBERSHIPS=$(_pg_scalar "SELECT count(*) FROM pg_auth_members m JOIN pg_roles r ON r.oid=m.member WHERE r.rolname='replicator'")
    [[ "${ROLE_MEMBERSHIPS}" == "0" ]] \
      || die "replicator 意外属于 ${ROLE_MEMBERSHIPS} 个角色 · 拒绝自动修改，请先人工撤销成员关系"
    _pg_scalar "ALTER ROLE replicator WITH REPLICATION LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOBYPASSRLS" >/dev/null
    log_info "replicator 已存在 · 最小权限属性已规范化，密码保持不变"
    [[ "${ROTATE_REPLICATOR_PASSWORD}" != "1" ]] || ROTATE_PASSWORD_PENDING=1
  fi
fi
log_success "replicator 角色属性就绪 ✓"

log_step "[5/6] 配置物理复制槽 costra_standby（幂等）"
if [[ "${DRY_RUN}" == "1" ]]; then
  log_dry "psql: 不存在则创建复制槽；lost 且带 --recreate-lost-slot 时确认后 drop + create"
else
  SLOT_ROW=$(_pg_scalar "SELECT slot_type || '|' || temporary::int || '|' || COALESCE(wal_status, 'unknown') || '|' || active::int FROM pg_replication_slots WHERE slot_name='${REPLICATION_SLOT}'")
  if [[ -z "${SLOT_ROW}" ]]; then
    _pg_scalar "SELECT pg_create_physical_replication_slot('${REPLICATION_SLOT}')" >/dev/null
    log_info "复制槽不存在 · 已创建"
  else
    IFS='|' read -r SLOT_TYPE SLOT_TEMPORARY SLOT_WAL_STATUS SLOT_ACTIVE <<< "${SLOT_ROW}"
    [[ "${SLOT_TYPE}" == "physical" && "${SLOT_TEMPORARY}" == "0" ]] \
      || die "同名槽类型异常：slot_type=${SLOT_TYPE} temporary=${SLOT_TEMPORARY} · 拒绝覆盖，请人工核查"
    if [[ "${SLOT_WAL_STATUS}" == "lost" ]]; then
      [[ "${RECREATE_LOST_SLOT}" == "1" ]] \
        || die "复制槽 ${REPLICATION_SLOT} 已 lost · 旧从库无法追平。先停止从库，再带 --recreate-lost-slot 重跑，随后必须清空从库数据并重新 pg_basebackup（文档 §8.3）"
      [[ "${SLOT_ACTIVE}" == "0" ]] \
        || die "lost 复制槽仍显示 active=1 · 拒绝重建；先停止从库并确认槽 inactive"
      confirm "确认 drop + recreate lost 复制槽 ${REPLICATION_SLOT}？旧从库必须随后全量重建" \
        || die "用户取消"
      _pg_scalar "SELECT pg_drop_replication_slot('${REPLICATION_SLOT}')" >/dev/null
      _pg_scalar "SELECT pg_create_physical_replication_slot('${REPLICATION_SLOT}')" >/dev/null
      log_warn "lost 复制槽已重建 · 旧从库不能继续使用，必须重新 pg_basebackup"
    elif [[ "${SLOT_WAL_STATUS}" == "unreserved" ]]; then
      log_warn "复制槽处于 unreserved · 不自动重建；立即恢复从库追赶，若转为 lost 再走全量重建"
    elif [[ "${RECREATE_LOST_SLOT}" == "1" ]]; then
      log_info "复制槽状态为 ${SLOT_WAL_STATUS}，不是 lost · 忽略 --recreate-lost-slot"
    fi
  fi
fi
log_success "复制槽就绪 ✓"

log_step "[6/6] 原子维护 pg_hba 最小权限区块 + reload"
LEGACY_HBA_LINE="host replication replicator ${PG_STANDBY_LAN_IP}/32 scram-sha-256"
HBA_BLOCK="# BEGIN COSTRA MANAGED REPLICATION
# 仅允许机器②建立物理复制连接；普通数据库连接即使知道 prod 密码也明确拒绝。
host replication replicator ${PG_STANDBY_LAN_IP}/32 scram-sha-256
host replication all 0.0.0.0/0 reject
host replication all ::/0 reject
# replicator 只能走 replication protocol，任何来源的普通数据库连接都拒绝。
host all replicator 0.0.0.0/0 reject
host all replicator ::/0 reject
host all all ${PG_STANDBY_LAN_IP}/32 reject
# END COSTRA MANAGED REPLICATION"
if [[ "${DRY_RUN}" == "1" ]]; then
  log_dry "原子替换 ${HBA_FILE} 的 Costra managed block（放在首条 host 规则之前）"
  log_dry "psql: SELECT pg_reload_conf() + 校验 pg_hba_file_rules"
else
  backup_file "${HBA_FILE}" "${COSTRA_CONF_DIR}/primary-hba-backups"
  HBA_ROLLBACK=$(mktemp "${HBA_FILE}.costra-rollback.XXXXXX")
  cp -p "${HBA_FILE}" "${HBA_ROLLBACK}"
  HBA_CHANGED=1
  replace_pg_hba_managed_block "${HBA_FILE}" "${HBA_BLOCK}" "${LEGACY_HBA_LINE}"
  if ! HBA_ERRORS=$(_pg_scalar "SELECT count(*) FROM pg_hba_file_rules WHERE error IS NOT NULL"); then
    cp -p "${HBA_ROLLBACK}" "${HBA_FILE}"
    rm -f "${HBA_ROLLBACK}"
    die "无法解析 pg_hba_file_rules · 已自动回滚磁盘文件，未 reload"
  fi
  if [[ "${HBA_ERRORS}" != "0" ]]; then
    cp -p "${HBA_ROLLBACK}" "${HBA_FILE}"
    rm -f "${HBA_ROLLBACK}"
    die "pg_hba_file_rules 发现 ${HBA_ERRORS} 条错误 · 已自动回滚磁盘文件，未 reload"
  fi
  RELOAD_OK=$(_pg_scalar "SELECT pg_reload_conf()")
  if [[ "${RELOAD_OK}" != "t" ]]; then
    cp -p "${HBA_ROLLBACK}" "${HBA_FILE}"
    _pg_scalar "SELECT pg_reload_conf()" >/dev/null || true
    rm -f "${HBA_ROLLBACK}"
    HBA_CHANGED=0
    die "pg_reload_conf() 未返回 t · 已回滚磁盘文件并尝试恢复运行态"
  fi
  HBA_RELOADED=1
  HBA_FILE_SHA256=$(sha256sum "${HBA_FILE}" | awk '{print $1}')
  log_success "pg_hba managed block 已生效：复制最小放行 + standby 普通连接拒绝 ✓"
fi

# 密码轮换是本流程唯一不可自动回滚的 mutation，必须晚于槽与 HBA 全部成功。
if [[ "${DRY_RUN}" == "1" ]]; then
  [[ "${ROTATE_REPLICATOR_PASSWORD}" != "1" ]] \
    || log_dry "全部 preflight 成功后才 ALTER ROLE replicator PASSWORD"
elif [[ "${ROTATE_PASSWORD_PENDING}" == "1" ]]; then
  confirm "确认机器② standby.env 与 PGDATA/.replication.pgpass 已写入同一个新值，并现在提交主库密码轮换？" \
    || die "用户取消密码轮换"
  _pg_stdin "ALTER ROLE replicator WITH PASSWORD :'pw'" -v pw="${REPLICATOR_PW}" >/dev/null
  PASSWORD_ROTATED=1
  log_warn "replicator 密码已轮换 · 不可自动回滚；下一步必须重启 standby 验证新凭据"
fi

# =============================================================================
# 自检输出（dry-run 跳过）
# =============================================================================
if [[ "${DRY_RUN}" == "1" ]]; then
  log_info "（dry-run · 跳过自检）"
  exit 0
fi

ROLE_STATE=$(_pg_scalar "SELECT rolreplication::text || '|' || rolcanlogin::text || '|' || rolsuper::text || '|' || rolcreatedb::text || '|' || rolcreaterole::text || '|' || rolinherit::text || '|' || rolbypassrls::text FROM pg_roles WHERE rolname='replicator'")
[[ "${ROLE_STATE}" == "true|true|false|false|false|false|false" ]] \
  || die "replicator 属性不满足最小权限契约：${ROLE_STATE:-missing}"
ROLE_MEMBERSHIPS=$(_pg_scalar "SELECT count(*) FROM pg_auth_members m JOIN pg_roles r ON r.oid=m.member WHERE r.rolname='replicator'")
[[ "${ROLE_MEMBERSHIPS}" == "0" ]] || die "replicator 仍有角色成员关系：${ROLE_MEMBERSHIPS}"
if [[ "${HBA_CHANGED}" == "1" ]]; then
  [[ "$(sha256sum "${HBA_FILE}" | awk '{print $1}')" == "${HBA_FILE_SHA256}" ]] \
    || die "pg_hba.conf 在 reload 后被非预期改写 · EXIT 将恢复原文件"
fi
FINAL_SYNC_STANDBY_NAMES=$(_pg_scalar "SHOW synchronous_standby_names")
[[ -z "${FINAL_SYNC_STANDBY_NAMES}" ]] || die "最终自检发现同步复制被开启：${FINAL_SYNC_STANDBY_NAMES}"
FINAL_SLOT_STATE=$(_pg_scalar "SELECT slot_type || '|' || temporary::text || '|' || COALESCE(wal_status, 'unknown') FROM pg_replication_slots WHERE slot_name='${REPLICATION_SLOT}'")
[[ "${FINAL_SLOT_STATE}" == physical\|false\|* && "${FINAL_SLOT_STATE}" != *"|lost" ]] \
  || die "最终复制槽状态不满足契约：${FINAL_SLOT_STATE:-missing}"
SETUP_COMMITTED=1

echo ""
log_step "自检"
echo "  replicator 角色 : $(_pg_scalar "SELECT rolname || ' (repl=' || rolreplication || ', login=' || rolcanlogin || ')' FROM pg_roles WHERE rolname='replicator'")"
echo "  复制槽          : $(_pg_scalar "SELECT slot_name || ' (active=' || active || ')' FROM pg_replication_slots WHERE slot_name='${REPLICATION_SLOT}'")"
echo "  WAL 护栏        : $(_pg_scalar "SHOW max_slot_wal_keep_size")"
echo "  wal_level       : $(_pg_scalar "SHOW wal_level")"
echo "  max_wal_senders : $(_pg_scalar "SHOW max_wal_senders")"
echo "  同步候选        : '$(_pg_scalar "SHOW synchronous_standby_names")'（期望空）"
echo "  端口绑定        :"
docker port "${PG_CONTAINER}" 5432/tcp | sed 's/^/                    /'
echo "  pg_hba managed  :"
sed -n '/^# BEGIN COSTRA MANAGED REPLICATION$/,/^# END COSTRA MANAGED REPLICATION$/p' "${HBA_FILE}" \
  | sed 's/^/                    /'

echo ""
log_success "主库复制配置完成 · 下一步：从库机器执行 setup-replication-standby.sh（方案文档 §4）"
exit 0
