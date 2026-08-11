#!/usr/bin/env bash
# =============================================================================
# Costra · 安全重部署（备份镜像 → [构建] → 停止 → [migration] → 启动 → healthy）
# =============================================================================
# 适用场景：prod 环境已搭建完毕，需要更新服务并可选执行 DB migration。
#
# 核心安全机制：
#   1. 构建新镜像前备份当前 server 镜像（以便回滚）
#   2. 构建成功后才停止服务（最小化停机窗口）
#   3. migration 执行前自动 DB 备份（复用 backup-db.sh --db-only · 不可跳过）
#   4. migration 失败时自动回滚：还原 DB（复用 restore-db.sh）+ 用老镜像拉起服务
#   5. 感知 postgres 重启：若需重启 postgres，则在其 healthy 后再跑 migration
#
# 流程（带 migration + pre-start-hook）：
#   1. 备份当前 server 镜像（tag → backup）
#   2. 构建新镜像（旧服务仍在线 · 失败不影响线上）
#   3. 停止服务
#   4. 若需重启 postgres：先启动 postgres，等待 healthy
#   5. DB 备份（backup-db.sh --db-only · 只备份 DB · 最小化停机窗口）
#   6. 执行 migration SQL 文件（失败则还原 DB + 老镜像拉起 → 退出）
#   7. 执行 pre-start-hook 脚本（可选 · 失败则回滚 → 退出）
#   8. 启动剩余服务（用新镜像）
#   9. 等待容器 healthy
#
# 重启目标：
#   默认只重启 server。可通过 --restart-* 额外添加，--no-restart-server 移除。
#
# 用法：
#   ./redeploy.sh                                          # 默认：只重启 server（不构建 · 不跑 migration）
#   ./redeploy.sh --build-mode local                       # 本地构建 + 重启 server
#   ./redeploy.sh --build-mode local --migrate             # 构建 + migration + 重启
#   ./redeploy.sh --build-mode local --migrate --migration-files "0011_recurring_entries.sql"
#   ./redeploy.sh --migrate --migration-dir server/db/migrations  # 跑目录下全部 SQL
#   ./redeploy.sh --build-mode registry --registry-image weizhao/costra-server:v2.0 --migrate
#   ./redeploy.sh --restart-psql --migrate                 # 重启 postgres + 跑 migration
#   ./redeploy.sh --timeout 120 -y
#
#   # migration 后、启动前插入自定义脚本（pre-start-hook）
#   ./redeploy.sh --build-mode local --migrate \
#     --migration-files "0011_recurring_entries.sql" \
#     --pre-start-hook ./import-holidays.sh --hook-args "-y --target prod 2026"
#   ./redeploy.sh --pre-start-hook /path/to/custom-script.sh  # 不跑 migration 也可以用 hook
#
# 选项：
#   --restart-nginx                     额外重启 nginx
#   --restart-redis                     额外重启 redis
#   --restart-psql                      额外重启 postgres
#   --no-restart-server                 不重启 server（默认会重启）
#   --build-mode <local|load|registry>  指定后才会构建镜像（不传则跳过构建）
#   --image-tar <path>                  load 模式：tar.gz 路径
#   --registry-image <full>             registry 模式：完整镜像名
#   --migrate                           启用 migration（构建后、启动前执行）
#   --migration-files <names>           指定 migration SQL（逗号分隔 · 纯文件名带 .sql · 自动拼 server/db/migrations/）
#   --migration-dir <dir>               指定 migration 目录（执行目录下所有 .sql）
#   --pre-start-hook <path>             停服/migration 后、启动服务前执行的自定义脚本（可选）
#   --hook-args <args>                  传给 pre-start-hook 的参数（空格分隔的字符串）
#   --timeout <seconds>                 healthy 等待超时（默认 90s）
#   -y / --yes / -h / --help
#
# 退出码：
#   0 = 重部署成功
#   1 = 失败（migration 失败时已自动回滚）
# =============================================================================

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=lib/common.sh
source "${SCRIPT_DIR}/lib/common.sh"

# --- 关键路径时间戳 ---
# 重部署关键路径（各 Step 标题 + healthy 等待）统一带时间戳，便于事后核查各阶段耗时。
# 仅覆盖本脚本用到的 log_step，不改动 common.sh，不影响其他脚本。
_ts() { date '+%Y-%m-%d %H:%M:%S'; }
log_step() {
  printf "\n${C_BOLD}${C_CYAN}===> %s %s${C_RESET}\n" "$(_ts)" "$*"
}

# --- 默认参数 ---
RESTART_SERVER=1
RESTART_NGINX=0
RESTART_REDIS=0
RESTART_PSQL=0
BUILD_MODE=""
IMAGE_TAR=""
REGISTRY_IMAGE=""
HEALTHY_TIMEOUT=90
DO_MIGRATE=0
MIGRATION_FILES=""
MIGRATION_DIR=""
PRE_START_HOOK=""
HOOK_ARGS=""
IMAGE_TAG="costra-server:latest"

# --- 解析参数 ---
parse_common_args "$@"
while [[ $# -gt 0 ]]; do
  case "$1" in
    --restart-nginx)     RESTART_NGINX=1; shift ;;
    --restart-redis)     RESTART_REDIS=1; shift ;;
    --restart-psql)      RESTART_PSQL=1; shift ;;
    --no-restart-server) RESTART_SERVER=0; shift ;;
    --build-mode)        BUILD_MODE=$2; shift 2 ;;
    --image-tar)         IMAGE_TAR=$2; shift 2 ;;
    --registry-image)    REGISTRY_IMAGE=$2; shift 2 ;;
    --migrate)           DO_MIGRATE=1; shift ;;
    --migration-files)   MIGRATION_FILES=$2; shift 2 ;;
    --migration-dir)     MIGRATION_DIR=$2; shift 2 ;;
    --pre-start-hook)    PRE_START_HOOK=$2; shift 2 ;;
    --hook-args)         HOOK_ARGS=$2; shift 2 ;;
    --timeout)           HEALTHY_TIMEOUT=$2; shift 2 ;;
    -y|--yes)            shift ;;
    -h|--help)
      grep '^#' "$0" | sed 's/^# \{0,1\}//' | head -55
      exit 0
      ;;
    *) die "未知参数: $1 · 用 --help 查看" ;;
  esac
done

require_root
require_cmd docker
require_file "${COSTRA_COMPOSE_FILE}"
require_file "${COSTRA_ENV_FILE}"

# --- 根据参数构建重启服务列表 ---
# 依赖序（启动顺序）：postgres → redis → server → nginx
# 停止顺序为其逆序：nginx → server → redis → postgres
UP_SERVICES=()
HEALTH_CONTAINERS=()

if [[ "${RESTART_PSQL}" == "1" ]]; then
  UP_SERVICES+=("postgres"); HEALTH_CONTAINERS+=("costra-postgres")
fi
if [[ "${RESTART_REDIS}" == "1" ]]; then
  UP_SERVICES+=("redis"); HEALTH_CONTAINERS+=("costra-redis")
fi
if [[ "${RESTART_SERVER}" == "1" ]]; then
  UP_SERVICES+=("server"); HEALTH_CONTAINERS+=("costra-server")
fi
if [[ "${RESTART_NGINX}" == "1" ]]; then
  UP_SERVICES+=("nginx"); HEALTH_CONTAINERS+=("costra-nginx")
fi

# 停止顺序 = 启动顺序的逆序
STOP_SERVICES=()
for ((i=${#UP_SERVICES[@]}-1; i>=0; i--)); do
  STOP_SERVICES+=("${UP_SERVICES[i]}")
done

# 至少要重启一个服务
if [[ ${#UP_SERVICES[@]} -eq 0 ]]; then
  die "未选择任何重启目标 · 至少需要一个 --restart-* 或不加 --no-restart-server"
fi

RESTART_DESC="${UP_SERVICES[*]}"

# --- 通用透传参数（给子脚本）---
COMMON_FLAGS=()
[[ "${ASSUME_YES}" == "1" ]] && COMMON_FLAGS+=(--yes)

# --- 停服后、migration 前的早期失败：用老镜像把服务拉起，避免长期停服 ---
# 适用：DB 备份失败 / postgres 未就绪 等「尚未变更 DB」的阶段。
# 这些阶段 DB 未动，只需恢复老镜像并拉起服务即可回到停服前状态（无需还原 DB）。
bring_up_old_and_exit() {
  set +e
  trap - ERR
  log_error "═══════════════════════════════════════════════════════════"
  log_error "  部署中止 · 自动恢复服务到停服前状态（DB 未变更）"
  log_error "═══════════════════════════════════════════════════════════"
  if [[ -n "${BACKUP_TAG}" ]]; then
    docker tag "${BACKUP_TAG}" "${IMAGE_TAG}" || log_warn "恢复镜像 tag 失败"
  fi
  cd "${COSTRA_INFRA}"
  docker compose -f "${COSTRA_COMPOSE_FILE}" --env-file "${COSTRA_ENV_FILE}" \
    up -d "${UP_SERVICES[@]}" || log_warn "拉起服务失败 · 请手动处理"
  set -e
  trap 'on_error ${LINENO}' ERR
  exit 1
}

# --- Migration 文件解析 ---
# migration 文件名白名单：只允许字母/数字/点/下划线/中划线 · 防止 shell 注入
_MIG_NAME_RE='^[A-Za-z0-9._-]+\.sql$'

RESOLVED_MIGRATION_FILES=()
if [[ "${DO_MIGRATE}" == "1" ]]; then
  if [[ -z "${MIGRATION_FILES}" && -z "${MIGRATION_DIR}" ]]; then
    die "--migrate 必须搭配 --migration-files 或 --migration-dir · 显式指定要执行的 SQL"
  fi

  if [[ -n "${MIGRATION_FILES}" ]]; then
    # 逗号分隔的文件列表 · 只接受纯文件名（带 .sql）· 自动拼 server/db/migrations/
    # 例：--migration-files "0011_recurring_entries.sql"
    IFS=',' read -ra _FILES <<< "${MIGRATION_FILES}"
    for f in "${_FILES[@]}"; do
      f=$(echo "$f" | xargs)  # trim whitespace
      # 校验文件名安全性（必须纯文件名 · 带路径分隔符则拒绝）
      if [[ "${f}" == */* ]]; then
        die "--migration-files 只接受纯文件名（不允许含路径）：${f}"
      fi
      if [[ ! "${f}" =~ ${_MIG_NAME_RE} ]]; then
        die "migration 文件名不合法（格式：NNNN_name.sql · 仅字母/数字/点/下划线/中划线）：${f}"
      fi
      _full="${COSTRA_ROOT}/server/db/migrations/${f}"
      require_file "${_full}"
      RESOLVED_MIGRATION_FILES+=("${_full}")
    done
  elif [[ -n "${MIGRATION_DIR}" ]]; then
    # 指定目录
    _mig_dir="${MIGRATION_DIR}"
    if [[ "${_mig_dir}" != /* ]]; then
      _mig_dir="${COSTRA_ROOT}/${_mig_dir}"
    fi
    [[ -d "${_mig_dir}" ]] || die "migration 目录不存在：${_mig_dir}"
    while IFS= read -r filepath; do
      [[ -z "${filepath}" ]] && continue
      RESOLVED_MIGRATION_FILES+=("${filepath}")
    done < <(find "${_mig_dir}" -maxdepth 1 -name '*.sql' -type f | sort)
  fi

  if [[ ${#RESOLVED_MIGRATION_FILES[@]} -eq 0 ]]; then
    die "启用了 --migrate 但未找到任何 .sql 文件"
  fi

  # 校验所有文件名（包括从目录扫描的）· 防止恶意文件名注入到容器内 shell 脚本
  for filepath in "${RESOLVED_MIGRATION_FILES[@]}"; do
    fname=$(basename "${filepath}")
    if [[ ! "${fname}" =~ ${_MIG_NAME_RE} ]]; then
      die "migration 文件名不合法（仅允许字母/数字/点/下划线/中划线）：${fname}"
    fi
  done
fi

# --- Pre-start-hook 解析与校验 ---
# 在停服/migration 完成后、启动服务前执行的自定义脚本。
# 不带 --migrate 也可以用：停服后直接跑 hook 再启动。
if [[ -n "${PRE_START_HOOK}" ]]; then
  # 解析路径（支持相对路径 · 相对于脚本 CWD）
  HOOK_PATH="${PRE_START_HOOK}"
  if [[ "${HOOK_PATH}" != /* ]]; then
    HOOK_PATH="$(pwd)/${HOOK_PATH}"
  fi
  [[ -f "${HOOK_PATH}" ]] || die "--pre-start-hook 脚本不存在：${HOOK_PATH}"
  [[ -x "${HOOK_PATH}" ]] || die "--pre-start-hook 脚本不可执行 · 请 chmod +x：${HOOK_PATH}"
  log_info "pre-start-hook  = ${HOOK_PATH}"
  if [[ -n "${HOOK_ARGS}" ]]; then
    log_info "hook args       = ${HOOK_ARGS}"
  fi
fi

# --- Postgres 连接信息 ---
PG_CONTAINER="costra-postgres"
COMPOSE_NETWORK="${COSTRA_COMPOSE_NET}"

if [[ "${DO_MIGRATE}" == "1" ]]; then
  PG_COSTRA_PW=$(grep '^PG_COSTRA_PW=' "${COSTRA_ENV_FILE}" | cut -d= -f2-)
  [[ -n "${PG_COSTRA_PW}" ]] || die "未能从 ${COSTRA_ENV_FILE} 读取 PG_COSTRA_PW（migration 执行需要）"
fi

# =============================================================================
# 主流程
# =============================================================================
print_section_header "Costra · 安全重部署"

log_info "restart         = ${RESTART_DESC}"
if [[ -n "${BUILD_MODE}" ]]; then
  log_info "build mode      = ${BUILD_MODE}"
else
  log_info "build mode      = (skip · 未指定 --build-mode)"
fi
if [[ "${DO_MIGRATE}" == "1" ]]; then
  log_info "migration       = ✓（${#RESOLVED_MIGRATION_FILES[@]} 个 SQL 文件）"
  for mf in "${RESOLVED_MIGRATION_FILES[@]}"; do
    log_info "                  - $(basename "${mf}")"
  done
else
  log_info "migration       = (skip · 未指定 --migrate)"
fi
if [[ -n "${PRE_START_HOOK}" ]]; then
  log_info "pre-start-hook  = ✓（${HOOK_PATH##*/}）"
else
  log_info "pre-start-hook  = (skip · 未指定 --pre-start-hook)"
fi
log_info "healthy timeout = ${HEALTHY_TIMEOUT}s"

if [[ "${ASSUME_YES}" != "1" ]]; then
  echo ""
  if [[ "${DO_MIGRATE}" == "1" ]]; then
    log_warn "本次部署将执行 migration · 失败时自动回滚（还原 DB + 老镜像拉起）"
  fi
  confirm "确认开始重部署？将停止 ${RESTART_DESC}" || die "用户取消"
fi

# 部署实际开始时刻（用于末尾统计总耗时 · 不含交互确认等待）
DEPLOY_START=$(date +%s)

# 计算总步数
TOTAL_STEPS=2                # 停止 + 启动
TOTAL_STEPS=$((TOTAL_STEPS + 1))                # 镜像备份（始终执行）
[[ -n "${BUILD_MODE}" ]] && TOTAL_STEPS=$((TOTAL_STEPS + 1))      # 构建
[[ "${DO_MIGRATE}" == "1" ]] && TOTAL_STEPS=$((TOTAL_STEPS + 1))  # migration（含 DB 备份）
[[ -n "${PRE_START_HOOK}" ]] && TOTAL_STEPS=$((TOTAL_STEPS + 1))  # pre-start-hook
CURRENT=0

# =============================================================================
# Step: 备份当前 server 镜像
# =============================================================================
CURRENT=$((CURRENT + 1))
log_step "[${CURRENT}/${TOTAL_STEPS}] 备份当前 server 镜像"

BACKUP_TAG="costra-server:backup-$(date +%Y%m%d-%H%M%S)"

# 检查当前镜像是否存在
if docker images --format '{{.Repository}}:{{.Tag}}' | grep -qFx "${IMAGE_TAG}"; then
  docker tag "${IMAGE_TAG}" "${BACKUP_TAG}"
  log_success "镜像已备份: ${IMAGE_TAG} → ${BACKUP_TAG}"
else
  log_warn "当前镜像 ${IMAGE_TAG} 不存在 · 跳过备份（首次部署？）"
  BACKUP_TAG=""
fi

# =============================================================================
# Step（可选）: 构建新镜像（旧服务仍在线 · 失败不影响线上）
# =============================================================================
if [[ -n "${BUILD_MODE}" ]]; then
  CURRENT=$((CURRENT + 1))
  log_step "[${CURRENT}/${TOTAL_STEPS}] 构建镜像（mode=${BUILD_MODE}）"

  BUILD_ARGS=("${COMMON_FLAGS[@]}" --mode "${BUILD_MODE}")
  [[ -n "${IMAGE_TAR}" ]] && BUILD_ARGS+=(--image-tar "${IMAGE_TAR}")
  [[ -n "${REGISTRY_IMAGE}" ]] && BUILD_ARGS+=(--registry-image "${REGISTRY_IMAGE}")

  if ! "${SCRIPT_DIR}/04-build-server.sh" "${BUILD_ARGS[@]}"; then
    die "构建失败 · 请检查日志（服务未停止 · 线上不受影响）"
  fi
  log_success "镜像构建完成"
fi

# =============================================================================
# Step: 停止服务（构建成功后才停 · 最小化停机窗口）
# =============================================================================
CURRENT=$((CURRENT + 1))
log_step "[${CURRENT}/${TOTAL_STEPS}] 停止服务（${RESTART_DESC}）"

cd "${COSTRA_INFRA}"
docker compose -f "${COSTRA_COMPOSE_FILE}" --env-file "${COSTRA_ENV_FILE}" \
  stop "${STOP_SERVICES[@]}"
log_success "已停止 ${RESTART_DESC}"

# =============================================================================
# Step（可选）: Migration（DB 备份 → migrate · 失败回滚）
# =============================================================================
if [[ "${DO_MIGRATE}" == "1" ]]; then
  CURRENT=$((CURRENT + 1))
  log_step "[${CURRENT}/${TOTAL_STEPS}] 执行 DB Migration"

  # --- 如果需要重启 postgres，先把 postgres 拉起来 ---
  if [[ "${RESTART_PSQL}" == "1" ]]; then
    log_info "本次需要重启 postgres · 先启动 postgres 以便执行 migration"
    cd "${COSTRA_INFRA}"
    docker compose -f "${COSTRA_COMPOSE_FILE}" --env-file "${COSTRA_ENV_FILE}" \
      up -d postgres

    # 等待 postgres healthy
    log_info "$(_ts) 等待 postgres healthy..."
    PG_WAIT_START=$(date +%s)
    while true; do
      PG_STATUS=$(docker inspect --format '{{.State.Health.Status}}' "${PG_CONTAINER}" 2>/dev/null || echo "missing")
      PG_ELAPSED=$(( $(date +%s) - PG_WAIT_START ))
      if [[ "${PG_STATUS}" == "healthy" ]]; then
        log_success "$(_ts) postgres healthy ✓（耗时 ${PG_ELAPSED}s）"
        break
      fi
      if [[ "${PG_ELAPSED}" -ge "${HEALTHY_TIMEOUT}" ]]; then
        log_error "$(_ts) postgres 未能在 ${HEALTHY_TIMEOUT}s 内 healthy（status=${PG_STATUS}）· migration 中止"
        bring_up_old_and_exit
      fi
      log_info "$(_ts) 等待 postgres healthy · 已 ${PG_ELAPSED}s · status=${PG_STATUS}"
      sleep 3
    done
  else
    # 不重启 postgres 时，确认 postgres 在运行
    PG_STATUS=$(docker inspect --format '{{.State.Status}}' "${PG_CONTAINER}" 2>/dev/null || echo "missing")
    if [[ "${PG_STATUS}" != "running" ]]; then
      log_error "${PG_CONTAINER} 不在运行（status=${PG_STATUS}）· 无法执行 migration"
      bring_up_old_and_exit
    fi
  fi

  # --- DB 备份（复用 backup-db.sh --db-only · 不可跳过 · 失败回滚依赖此备份）---
  # 使用唯一 prefix（含 PID）· 避免并发或同分钟内多次执行时拿错文件
  BACKUP_PREFIX="pre-redeploy-$(date +%Y%m%d-%H%M%S)-$$"
  log_info "调用 backup-db.sh 备份当前 DB（--db-only · 跳过 avatars · 最小化停机）..."

  if ! "${SCRIPT_DIR}/backup-db.sh" \
    --prefix "${BACKUP_PREFIX}" \
    --db-only \
    --no-cleanup \
    -y; then
    log_error "backup-db.sh 失败 · migration 中止（DB 未变更）"
    bring_up_old_and_exit
  fi

  # 找到刚生成的备份文件（唯一 prefix · 精确匹配）
  DUMP_FILE=$(find "${COSTRA_DATA}/backups" -maxdepth 1 -name "${BACKUP_PREFIX}-*.sql.gz" -type f 2>/dev/null | head -1)
  [[ -n "${DUMP_FILE}" && -f "${DUMP_FILE}" ]] || die "备份文件未找到 · 请检查 ${COSTRA_DATA}/backups/"
  log_success "DB 备份完成: ${DUMP_FILE}"

  # --- 执行 migration SQL ---
  log_info "执行 ${#RESOLVED_MIGRATION_FILES[@]} 个 migration SQL..."

  # 构建执行脚本（文件名已通过白名单校验 · 安全拼接到容器内 shell 脚本）
  MIGRATE_SCRIPT='set -e
'
  for filepath in "${RESOLVED_MIGRATION_FILES[@]}"; do
    fname=$(basename "${filepath}")
    MIGRATE_SCRIPT+="echo \"=== ${fname} ===\"
psql -v ON_ERROR_STOP=1 -h postgres -U costra -d costra -f \"/migrations/${fname}\"
"
  done

  # 收集 migration 文件到临时目录统一挂载
  MIGRATE_TMP=$(mktemp -d)
  for filepath in "${RESOLVED_MIGRATION_FILES[@]}"; do
    cp "${filepath}" "${MIGRATE_TMP}/"
  done

  # 临时关闭 errexit · 让失败进入回滚逻辑而非直接退出脚本
  set +e
  trap - ERR
  docker run --rm \
    --network "${COMPOSE_NETWORK}" \
    -v "${MIGRATE_TMP}:/migrations:ro" \
    -e PGPASSWORD="${PG_COSTRA_PW}" \
    postgres:15-alpine \
    bash -c "${MIGRATE_SCRIPT}"
  MIGRATE_EXIT=$?
  set -e
  trap 'on_error ${LINENO}' ERR

  rm -rf "${MIGRATE_TMP}"

  # --- Migration 失败：回滚 ---
  if [[ ${MIGRATE_EXIT} -ne 0 ]]; then
    echo ""
    log_error "═══════════════════════════════════════════════════════════"
    log_error "  Migration 失败！正在自动回滚..."
    log_error "═══════════════════════════════════════════════════════════"

    # 回滚过程中关闭 errexit · 尽力恢复每一步
    set +e
    trap - ERR

    # 还原 DB（复用 restore-db.sh --no-restart · 跳过 server 生命周期管理 · -y 跳过确认）
    log_info "调用 restore-db.sh 还原数据库（从 ${DUMP_FILE}）..."

    if "${SCRIPT_DIR}/restore-db.sh" \
      --backup-file "${DUMP_FILE}" \
      --no-restart \
      -y; then
      log_success "数据库已还原"
    else
      log_error "数据库还原也失败！请手动用 restore-db.sh 恢复"
      log_error "备份文件: ${DUMP_FILE}"
    fi

    # 用老镜像拉起服务
    if [[ -n "${BACKUP_TAG}" ]]; then
      log_info "使用老镜像 ${BACKUP_TAG} 拉起服务..."
      docker tag "${BACKUP_TAG}" "${IMAGE_TAG}" || log_warn "恢复镜像 tag 失败"
    fi

    # 拉起服务（用老镜像）
    log_info "拉起服务（回滚到更新前状态）..."
    cd "${COSTRA_INFRA}"
    docker compose -f "${COSTRA_COMPOSE_FILE}" --env-file "${COSTRA_ENV_FILE}" \
      up -d "${UP_SERVICES[@]}" || log_warn "拉起服务失败 · 请手动处理"

    echo ""
    log_error "═══════════════════════════════════════════════════════════"
    log_error "  回滚完成 · 服务已恢复到更新前状态"
    log_error "  Migration 失败详情请检查上方输出"
    log_error "  备份文件: ${DUMP_FILE}"
    log_error "  老镜像: ${BACKUP_TAG:-无}"
    log_error "═══════════════════════════════════════════════════════════"
    exit 1
  fi

  log_success "所有 migration 执行成功"
fi

# =============================================================================
# Step（可选）: Pre-start-hook（migration 完成后、启动服务前执行自定义脚本）
# =============================================================================
if [[ -n "${PRE_START_HOOK}" ]]; then
  CURRENT=$((CURRENT + 1))
  log_step "[${CURRENT}/${TOTAL_STEPS}] 执行 pre-start-hook"

  log_info "脚本: ${HOOK_PATH}"
  if [[ -n "${HOOK_ARGS}" ]]; then
    log_info "参数: ${HOOK_ARGS}"
  fi

  # 将 hook-args 按空格拆分为数组（支持带引号的参数）
  # shellcheck disable=SC2206
  HOOK_ARG_ARRAY=(${HOOK_ARGS})

  # hook 失败时的回滚策略：
  #   - 若已执行 migration（DB 已变更）：需要还原 DB + 老镜像拉起
  #   - 若未执行 migration（DB 未变更）：只需老镜像拉起（bring_up_old_and_exit）
  set +e
  trap - ERR
  "${HOOK_PATH}" "${HOOK_ARG_ARRAY[@]}"
  HOOK_EXIT=$?
  set -e
  trap 'on_error ${LINENO}' ERR

  if [[ ${HOOK_EXIT} -ne 0 ]]; then
    echo ""
    log_error "═══════════════════════════════════════════════════════════"
    log_error "  Pre-start-hook 失败！退出码=${HOOK_EXIT} · 正在回滚..."
    log_error "═══════════════════════════════════════════════════════════"

    # 若 migration 已跑 · 还原 DB
    if [[ "${DO_MIGRATE}" == "1" && -n "${DUMP_FILE:-}" ]]; then
      set +e
      trap - ERR
      log_info "调用 restore-db.sh 还原数据库（从 ${DUMP_FILE}）..."
      if "${SCRIPT_DIR}/restore-db.sh" \
        --backup-file "${DUMP_FILE}" \
        --no-restart \
        -y; then
        log_success "数据库已还原"
      else
        log_error "数据库还原也失败！请手动用 restore-db.sh 恢复"
        log_error "备份文件: ${DUMP_FILE}"
      fi
      set -e
      trap 'on_error ${LINENO}' ERR
    fi

    # 用老镜像拉起服务
    if [[ -n "${BACKUP_TAG}" ]]; then
      log_info "使用老镜像 ${BACKUP_TAG} 拉起服务..."
      docker tag "${BACKUP_TAG}" "${IMAGE_TAG}" || log_warn "恢复镜像 tag 失败"
    fi

    log_info "拉起服务（回滚到更新前状态）..."
    cd "${COSTRA_INFRA}"
    docker compose -f "${COSTRA_COMPOSE_FILE}" --env-file "${COSTRA_ENV_FILE}" \
      up -d "${UP_SERVICES[@]}" || log_warn "拉起服务失败 · 请手动处理"

    echo ""
    log_error "═══════════════════════════════════════════════════════════"
    log_error "  回滚完成 · 服务已恢复到更新前状态"
    log_error "  Pre-start-hook 失败详情请检查上方输出"
    if [[ "${DO_MIGRATE}" == "1" && -n "${DUMP_FILE:-}" ]]; then
      log_error "  备份文件: ${DUMP_FILE}"
    fi
    log_error "  老镜像: ${BACKUP_TAG:-无}"
    log_error "═══════════════════════════════════════════════════════════"
    exit 1
  fi

  log_success "pre-start-hook 执行成功"
fi

# =============================================================================
# Step: 启动服务
# =============================================================================
CURRENT=$((CURRENT + 1))
log_step "[${CURRENT}/${TOTAL_STEPS}] 启动服务（${RESTART_DESC}）"

# 确定本步需要启动哪些服务
# 如果 postgres 已在 migration 阶段启动，则此处不需要再启动它
FINAL_UP_SERVICES=()
for svc in "${UP_SERVICES[@]}"; do
  if [[ "${svc}" == "postgres" && "${DO_MIGRATE}" == "1" && "${RESTART_PSQL}" == "1" ]]; then
    # postgres 已在 migration 阶段启动 · 跳过
    continue
  fi
  FINAL_UP_SERVICES+=("${svc}")
done

if [[ ${#FINAL_UP_SERVICES[@]} -gt 0 ]]; then
  # 用 up -d 而不是 start：up 会用最新镜像重新创建容器（拿到刚 build 的新镜像）
  # start 只会启动旧容器（拿不到新镜像），这是关键差别
  cd "${COSTRA_INFRA}"
  docker compose -f "${COSTRA_COMPOSE_FILE}" --env-file "${COSTRA_ENV_FILE}" \
    up -d "${FINAL_UP_SERVICES[@]}"
fi

# 等待 healthy
log_info "$(_ts) 开始等待容器 healthy..."
START_TS=$(date +%s)

while true; do
  ALL_HEALTHY=1
  NOT_HEALTHY_STATUS=""
  for c in "${HEALTH_CONTAINERS[@]}"; do
    STATUS=$(docker inspect --format '{{.State.Health.Status}}' "$c" 2>/dev/null || echo "missing")
    if [[ "${STATUS}" != "healthy" ]]; then
      ALL_HEALTHY=0
      NOT_HEALTHY_STATUS+=" ${c}=${STATUS}"
    fi
  done

  ELAPSED=$(( $(date +%s) - START_TS ))
  if [[ "${ALL_HEALTHY}" == "1" ]]; then
    log_success "$(_ts) 所有容器 healthy（耗时 ${ELAPSED}s）"
    break
  fi

  if [[ "${ELAPSED}" -ge "${HEALTHY_TIMEOUT}" ]]; then
    log_error "$(_ts) 等待超时（${HEALTHY_TIMEOUT}s）· 当前状态：${NOT_HEALTHY_STATUS}"
    docker compose -f "${COSTRA_COMPOSE_FILE}" ps
    echo ""
    log_error "诊断建议："
    log_error "  docker logs <container> --tail 80"
    log_error "  docker compose -f ${COSTRA_COMPOSE_FILE} ps"
    die "容器未能在 ${HEALTHY_TIMEOUT}s 内变为 healthy"
  fi

  log_info "$(_ts) 等待 healthy · 已 ${ELAPSED}s ·${NOT_HEALTHY_STATUS}"
  sleep 3
done

# =============================================================================
# 总结
# =============================================================================
echo ""
print_section_header "✅ 重部署完成（${RESTART_DESC}）"
log_info "$(_ts) 总耗时 $(( $(date +%s) - DEPLOY_START ))s"

echo ""
docker compose -f "${COSTRA_COMPOSE_FILE}" ps
echo ""
log_info "验证建议："
log_info "  - curl -s http://localhost:8080/healthz"
log_info "  - curl -s https://${COSTRA_DOMAIN}/healthz"
log_info "  - docker logs costra-server --tail 50"
if [[ -n "${BACKUP_TAG}" ]]; then
  echo ""
  log_info "老镜像备份: ${BACKUP_TAG}"
  log_info "  若需回滚: docker tag ${BACKUP_TAG} ${IMAGE_TAG} && docker compose up -d server"
fi

exit 0
