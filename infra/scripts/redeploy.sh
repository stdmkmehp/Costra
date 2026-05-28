#!/usr/bin/env bash
# =============================================================================
# Costra · 快速重部署（停止 → 构建 → 启动 → 迁移）
# =============================================================================
# 适用场景：prod 环境已搭建完毕（01~03 + 07~08 已跑过），只需要：
#   1. 停止服务
#   2. 拉取最新代码 / 重新构建镜像
#   3. 启动服务
#   4. 跑 migrations（幂等 · 已跑过的自动跳过）
#
# 跳过的步骤：01-preflight / 02-prepare-dirs / 03-generate-env /
#              07-issue-cert / 08-finalize-nginx / 09-verify-gates
#
# 用法：
#   ./redeploy.sh --build-mode local                    # 本地重新 build
#   ./redeploy.sh --build-mode registry --registry-image weizhao/costra-server:v2.0
#   ./redeploy.sh --build-mode load --image-tar /tmp/costra-server.tar.gz
#   ./redeploy.sh --skip-migrate                        # 跳过 migration（纯重启）
#   ./redeploy.sh --skip-build                          # 跳过构建（只重启）
#   ./redeploy.sh --git-pull                            # 先 git pull 再 build
#
# 选项：
#   --build-mode <local|load|registry>  镜像构建方式（默认 local）
#   --image-tar <path>                  load 模式：tar.gz 路径
#   --registry-image <full>             registry 模式：完整镜像名
#   --skip-migrate                      跳过 migration 步骤
#   --skip-build                        跳过构建步骤（只停止+启动）
#   --git-pull                          构建前先 git pull
#   --restart-nginx                     同时重启 nginx 容器
#   --dry-run / -y / --yes / -h / --help
#
# 退出码：
#   0 = 重部署成功
#   1 = 失败
# =============================================================================

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=lib/common.sh
source "${SCRIPT_DIR}/lib/common.sh"

# --- 默认参数 ---
BUILD_MODE="local"
IMAGE_TAR=""
REGISTRY_IMAGE=""
SKIP_MIGRATE=0
SKIP_BUILD=0
GIT_PULL=0
RESTART_NGINX=0

# --- 解析参数 ---
parse_common_args "$@"
while [[ $# -gt 0 ]]; do
  case "$1" in
    --build-mode)       BUILD_MODE=$2; shift 2 ;;
    --image-tar)        IMAGE_TAR=$2; shift 2 ;;
    --registry-image)   REGISTRY_IMAGE=$2; shift 2 ;;
    --skip-migrate)     SKIP_MIGRATE=1; shift ;;
    --skip-build)       SKIP_BUILD=1; shift ;;
    --git-pull)         GIT_PULL=1; shift ;;
    --restart-nginx)    RESTART_NGINX=1; shift ;;
    --dry-run|-y|--yes) shift ;;
    -h|--help)
      grep '^#' "$0" | sed 's/^# \{0,1\}//' | head -40
      exit 0
      ;;
    *) die "未知参数: $1 · 用 --help 查看" ;;
  esac
done

require_root
require_cmd docker
require_file "${COSTRA_COMPOSE_FILE}"
require_file "${COSTRA_ENV_FILE}"

# --- 通用透传参数 ---
COMMON_FLAGS=()
[[ "${DRY_RUN}" == "1" ]]    && COMMON_FLAGS+=(--dry-run)
[[ "${ASSUME_YES}" == "1" ]] && COMMON_FLAGS+=(--yes)

# =============================================================================
# 主流程
# =============================================================================
print_section_header "Costra · 快速重部署"

log_info "build mode     = ${BUILD_MODE}"
log_info "skip build     = ${SKIP_BUILD}"
log_info "skip migrate   = ${SKIP_MIGRATE}"
log_info "git pull       = ${GIT_PULL}"
log_info "restart nginx  = ${RESTART_NGINX}"
[[ "${DRY_RUN}" == "1" ]] && log_warn "DRY-RUN 模式 · 不真正执行命令"

if [[ "${ASSUME_YES}" != "1" ]]; then
  echo ""
  confirm "确认开始重部署？（将停止服务）" || die "用户取消"
fi

TOTAL_STEPS=4
[[ "${SKIP_BUILD}" == "1" ]] && ((TOTAL_STEPS--))
[[ "${SKIP_MIGRATE}" == "1" ]] && ((TOTAL_STEPS--))
CURRENT=0

# --- Step 1: 停止服务 ---
((CURRENT++))
log_step "[${CURRENT}/${TOTAL_STEPS}] 停止服务"

cd "${COSTRA_INFRA}"

if [[ "${RESTART_NGINX}" == "1" ]]; then
  run_cmd docker compose -f "${COSTRA_COMPOSE_FILE}" --env-file "${COSTRA_ENV_FILE}" \
    stop server postgres redis nginx
  log_success "已停止 server + postgres + redis + nginx"
else
  run_cmd docker compose -f "${COSTRA_COMPOSE_FILE}" --env-file "${COSTRA_ENV_FILE}" \
    stop server postgres redis
  log_success "已停止 server + postgres + redis（nginx 保持运行）"
fi

# --- Step 2: git pull（可选）+ 构建 ---
if [[ "${SKIP_BUILD}" != "1" ]]; then
  ((CURRENT++))
  log_step "[${CURRENT}/${TOTAL_STEPS}] 构建镜像"

  # git pull（可选）
  if [[ "${GIT_PULL}" == "1" ]]; then
    log_info "git pull..."
    cd "${COSTRA_ROOT}"
    run_cmd git pull --ff-only
    log_success "git pull 完成"
  fi

  # 调用 04-build-server.sh
  BUILD_ARGS=("${COMMON_FLAGS[@]}" --mode "${BUILD_MODE}")
  [[ -n "${IMAGE_TAR}" ]] && BUILD_ARGS+=(--image-tar "${IMAGE_TAR}")
  [[ -n "${REGISTRY_IMAGE}" ]] && BUILD_ARGS+=(--registry-image "${REGISTRY_IMAGE}")

  if ! "${SCRIPT_DIR}/04-build-server.sh" "${BUILD_ARGS[@]}"; then
    die "构建失败 · 请检查日志"
  fi
  log_success "镜像构建完成"
fi

# --- Step 3: 启动服务 ---
((CURRENT++))
log_step "[${CURRENT}/${TOTAL_STEPS}] 启动服务"

cd "${COSTRA_INFRA}"

if [[ "${RESTART_NGINX}" == "1" ]]; then
  run_cmd docker compose -f "${COSTRA_COMPOSE_FILE}" --env-file "${COSTRA_ENV_FILE}" \
    up -d postgres redis server nginx
else
  run_cmd docker compose -f "${COSTRA_COMPOSE_FILE}" --env-file "${COSTRA_ENV_FILE}" \
    up -d postgres redis server
fi

# 等待 healthy
if [[ "${DRY_RUN}" != "1" ]]; then
  log_info "等待容器 healthy..."
  CONTAINERS=(costra-postgres costra-redis costra-server)
  [[ "${RESTART_NGINX}" == "1" ]] && CONTAINERS+=(costra-nginx)
  HEALTHY_TIMEOUT=90
  START_TS=$(date +%s)

  while true; do
    ALL_HEALTHY=1
    for c in "${CONTAINERS[@]}"; do
      STATUS=$(docker inspect --format '{{.State.Health.Status}}' "$c" 2>/dev/null || echo "missing")
      if [[ "${STATUS}" != "healthy" ]]; then
        ALL_HEALTHY=0
        break
      fi
    done

    if [[ "${ALL_HEALTHY}" == "1" ]]; then
      log_success "所有容器 healthy"
      break
    fi

    ELAPSED=$(( $(date +%s) - START_TS ))
    if [[ "${ELAPSED}" -ge "${HEALTHY_TIMEOUT}" ]]; then
      log_error "等待超时（${HEALTHY_TIMEOUT}s）· 当前状态："
      docker compose -f "${COSTRA_COMPOSE_FILE}" ps
      die "容器未能在 ${HEALTHY_TIMEOUT}s 内变为 healthy"
    fi

    echo -n "."
    sleep 3
  done
fi

# --- Step 4: 跑 migrations ---
if [[ "${SKIP_MIGRATE}" != "1" ]]; then
  ((CURRENT++))
  log_step "[${CURRENT}/${TOTAL_STEPS}] 跑 migrations（幂等）"

  if ! "${SCRIPT_DIR}/06-migrate.sh" "${COMMON_FLAGS[@]}"; then
    die "migration 失败 · 请检查日志"
  fi
  log_success "migrations 完成"
fi

# =============================================================================
# 总结
# =============================================================================
echo ""
print_section_header "🎉 重部署完成"
log_success "服务已更新并启动"

if [[ "${DRY_RUN}" != "1" ]]; then
  echo ""
  docker compose -f "${COSTRA_COMPOSE_FILE}" ps
  echo ""
  log_info "验证建议："
  log_info "  - curl -s http://localhost:8080/healthz"
  log_info "  - curl -s https://${COSTRA_DOMAIN}/healthz"
fi

exit 0
