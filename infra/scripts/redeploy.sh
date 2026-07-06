#!/usr/bin/env bash
# =============================================================================
# Costra · 快速重部署（构建 → 停止 → 启动 → 迁移）
# =============================================================================
# 适用场景：prod 环境已搭建完毕（01~03 + 07~08 已跑过），只需要：
#   1. 重新构建镜像（旧服务仍在线，构建失败不影响线上）
#   2. 停止服务（构建成功后才停，最小化停机窗口）
#   3. 启动服务
#   4. （可选）跑 migrations（幂等 · 已跑过的自动跳过）
#
# 默认跳过的步骤：01-preflight / 02-prepare-dirs / 03-generate-env /
#              06-migrate / 07-issue-cert / 08-finalize-nginx / 09-verify-gates
# 说明：默认不跑 migration（纯重启/更新），如需迁移请显式加 --migrate。
#       本脚本不会更新代码仓库，请自行确保代码已是目标版本。
#
# 用法：
#   ./redeploy.sh --build-mode local                    # 本地重新 build
#   ./redeploy.sh --build-mode registry --registry-image weizhao/costra-server:v2.0
#   ./redeploy.sh --build-mode load --image-tar /tmp/costra-server.tar.gz
#   ./redeploy.sh --migrate                             # 重部署并跑 migration
#   ./redeploy.sh --skip-build                          # 跳过构建（只重启）
#
# 选项：
#   --build-mode <local|load|registry>  镜像构建方式（默认 local）
#   --image-tar <path>                  load 模式：tar.gz 路径
#   --registry-image <full>             registry 模式：完整镜像名
#   --migrate                           跑 migration 步骤（默认跳过）
#   --skip-build                        跳过构建步骤（只停止+启动）
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
SKIP_MIGRATE=1
SKIP_BUILD=0
RESTART_NGINX=0

# --- 解析参数 ---
parse_common_args "$@"
while [[ $# -gt 0 ]]; do
  case "$1" in
    --build-mode)       BUILD_MODE=$2; shift 2 ;;
    --image-tar)        IMAGE_TAR=$2; shift 2 ;;
    --registry-image)   REGISTRY_IMAGE=$2; shift 2 ;;
    --migrate)          SKIP_MIGRATE=0; shift ;;
    --skip-build)       SKIP_BUILD=1; shift ;;
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
log_info "restart nginx  = ${RESTART_NGINX}"
[[ "${DRY_RUN}" == "1" ]] && log_warn "DRY-RUN 模式 · 不真正执行命令"

if [[ "${ASSUME_YES}" != "1" ]]; then
  echo ""
  confirm "确认开始重部署？（将停止服务）" || die "用户取消"
fi

TOTAL_STEPS=4
[[ "${SKIP_BUILD}" == "1" ]]   && TOTAL_STEPS=$((TOTAL_STEPS - 1))
[[ "${SKIP_MIGRATE}" == "1" ]] && TOTAL_STEPS=$((TOTAL_STEPS - 1))
CURRENT=0

# 注意：bash `set -e` 下 `((var++))` 当 var 自增前为 0 时整条命令退出码为 1，
# 会触发 ERR trap。统一改用 `var=$((var + 1))` 形式（赋值语句退出码恒为 0）。

# --- Step 1: 构建（先构建，旧服务仍在线，构建失败不影响线上）---
if [[ "${SKIP_BUILD}" != "1" ]]; then
  CURRENT=$((CURRENT + 1))
  log_step "[${CURRENT}/${TOTAL_STEPS}] 构建镜像"

  # 调用 04-build-server.sh
  BUILD_ARGS=("${COMMON_FLAGS[@]}" --mode "${BUILD_MODE}")
  [[ -n "${IMAGE_TAR}" ]] && BUILD_ARGS+=(--image-tar "${IMAGE_TAR}")
  [[ -n "${REGISTRY_IMAGE}" ]] && BUILD_ARGS+=(--registry-image "${REGISTRY_IMAGE}")

  if ! "${SCRIPT_DIR}/04-build-server.sh" "${BUILD_ARGS[@]}"; then
    die "构建失败 · 请检查日志（服务未停止，线上不受影响）"
  fi
  log_success "镜像构建完成"
fi

# --- Step 2: 停止服务（构建成功后才停，最小化停机窗口）---
CURRENT=$((CURRENT + 1))
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

# --- Step 3: 启动服务 ---
CURRENT=$((CURRENT + 1))
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
  CURRENT=$((CURRENT + 1))
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
