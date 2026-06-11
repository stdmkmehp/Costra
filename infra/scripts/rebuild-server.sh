#!/usr/bin/env bash
# =============================================================================
# Costra · 只重建并重启 server 容器（build → stop server → up server）
# =============================================================================
# 适用场景：prod 上"只改了 server 代码、没改 schema、没改 nginx/SSL"时的快速发布。
#
# 与现有脚本的关系（必须搞清楚 · 不要混用）：
#   - redeploy.sh        : 全量重部署（停 server+postgres+redis · 跑 migration）
#   - 05-start-stack.sh  : 首次/全量启动 stack（拉镜像 · 起三服务）
#   - 04-build-server.sh : 只 build 镜像（不停服 · 不重启）
#   - 本脚本             : build + 重启 server 一个容器 · 不碰 postgres/redis/nginx
#                          不跑 migration · 假设 schema 没变
#
# 流程：
#   1. （可选 --git-pull）git pull --ff-only
#   2. 调 04-build-server.sh 构建 server 镜像
#   3. docker compose stop server
#   4. docker compose up -d server
#   5. 等 costra-server healthy
#
# 用法：
#   ./rebuild-server.sh                                          # 默认本地 build
#   ./rebuild-server.sh --git-pull                               # 先 git pull 再 build
#   ./rebuild-server.sh --build-mode load --image-tar /tmp/x.tar.gz
#   ./rebuild-server.sh --build-mode registry --registry-image weizhao/costra-server:v2.0
#   ./rebuild-server.sh --skip-build                             # 不 build · 仅 stop+up（镜像已就位）
#   ./rebuild-server.sh --timeout 120                            # healthy 等待超时（默认 90s）
#   ./rebuild-server.sh --dry-run / -y / --yes / -h / --help
#
# 退出码：
#   0 = server 重建并 healthy
#   1 = 失败
# =============================================================================

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=lib/common.sh
source "${SCRIPT_DIR}/lib/common.sh"

# --- 默认参数 ---
BUILD_MODE="local"
IMAGE_TAR=""
REGISTRY_IMAGE=""
SKIP_BUILD=0
GIT_PULL=0
HEALTHY_TIMEOUT=90
SERVER_CONTAINER="costra-server"

# --- 解析参数 ---
parse_common_args "$@"
while [[ $# -gt 0 ]]; do
  case "$1" in
    --build-mode)       BUILD_MODE=$2; shift 2 ;;
    --image-tar)        IMAGE_TAR=$2; shift 2 ;;
    --registry-image)   REGISTRY_IMAGE=$2; shift 2 ;;
    --skip-build)       SKIP_BUILD=1; shift ;;
    --git-pull)         GIT_PULL=1; shift ;;
    --timeout)          HEALTHY_TIMEOUT=$2; shift 2 ;;
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

# 通用透传参数（给子脚本）
COMMON_FLAGS=()
[[ "${DRY_RUN}" == "1" ]]    && COMMON_FLAGS+=(--dry-run)
[[ "${ASSUME_YES}" == "1" ]] && COMMON_FLAGS+=(--yes)

# =============================================================================
# 主流程
# =============================================================================
print_section_header "Costra · 重建并重启 server（仅 server）"

log_info "build mode    = ${BUILD_MODE}"
log_info "skip build    = ${SKIP_BUILD}"
log_info "git pull      = ${GIT_PULL}"
log_info "healthy timeout = ${HEALTHY_TIMEOUT}s"
[[ "${DRY_RUN}" == "1" ]] && log_warn "DRY-RUN 模式 · 不真正执行命令"

if [[ "${ASSUME_YES}" != "1" ]]; then
  echo ""
  log_warn "本脚本不会跑 migration · 不会动 postgres/redis/nginx"
  log_warn "如果本次发布包含 schema 变更 · 请改用 ./redeploy.sh"
  confirm "确认只重建并重启 server？" || die "用户取消"
fi

TOTAL_STEPS=3
[[ "${GIT_PULL}" == "1" ]] && ((TOTAL_STEPS++))
[[ "${SKIP_BUILD}" == "1" ]] && ((TOTAL_STEPS--))
CURRENT=0

# --- Step (可选): git pull ---
if [[ "${GIT_PULL}" == "1" ]]; then
  ((CURRENT++))
  log_step "[${CURRENT}/${TOTAL_STEPS}] git pull"
  cd "${COSTRA_ROOT}"
  run_cmd git pull --ff-only
  log_success "git pull 完成"
fi

# --- Step: 构建镜像 ---
if [[ "${SKIP_BUILD}" != "1" ]]; then
  ((CURRENT++))
  log_step "[${CURRENT}/${TOTAL_STEPS}] 构建 server 镜像（mode=${BUILD_MODE}）"

  BUILD_ARGS=("${COMMON_FLAGS[@]}" --mode "${BUILD_MODE}")
  [[ -n "${IMAGE_TAR}" ]]       && BUILD_ARGS+=(--image-tar "${IMAGE_TAR}")
  [[ -n "${REGISTRY_IMAGE}" ]]  && BUILD_ARGS+=(--registry-image "${REGISTRY_IMAGE}")

  if ! "${SCRIPT_DIR}/04-build-server.sh" "${BUILD_ARGS[@]}"; then
    die "构建失败 · 请检查 04-build-server.sh 输出"
  fi
  log_success "镜像构建完成"
fi

# --- Step: stop server ---
((CURRENT++))
log_step "[${CURRENT}/${TOTAL_STEPS}] 停止 ${SERVER_CONTAINER}"

cd "${COSTRA_INFRA}"
run_cmd docker compose -f "${COSTRA_COMPOSE_FILE}" --env-file "${COSTRA_ENV_FILE}" stop server
log_success "server 已停止（postgres/redis/nginx 保持运行）"

# --- Step: up server ---
((CURRENT++))
log_step "[${CURRENT}/${TOTAL_STEPS}] 启动 ${SERVER_CONTAINER}"

# 用 up -d 而不是 start：up 会用最新镜像重新创建容器（拿到刚 build 的新镜像）
# start 只会启动旧容器（拿不到新镜像），这是关键差别
run_cmd docker compose -f "${COSTRA_COMPOSE_FILE}" --env-file "${COSTRA_ENV_FILE}" up -d server

# 等 healthy
if [[ "${DRY_RUN}" != "1" ]]; then
  log_info "等待 ${SERVER_CONTAINER} healthy..."
  START_TS=$(date +%s)

  while true; do
    HEALTH=$(docker inspect --format '{{.State.Health.Status}}' "${SERVER_CONTAINER}" 2>/dev/null || echo "missing")
    if [[ "${HEALTH}" == "healthy" ]]; then
      log_success "${SERVER_CONTAINER} healthy ✓"
      break
    fi

    ELAPSED=$(( $(date +%s) - START_TS ))
    if [[ "${ELAPSED}" -ge "${HEALTHY_TIMEOUT}" ]]; then
      log_error "等待超时（${HEALTHY_TIMEOUT}s）· 当前状态：${HEALTH}"
      echo ""
      log_error "诊断建议："
      log_error "  docker logs ${SERVER_CONTAINER} --tail 80"
      log_error "  docker compose -f ${COSTRA_COMPOSE_FILE} ps"
      die "${SERVER_CONTAINER} 未能在 ${HEALTHY_TIMEOUT}s 内 healthy"
    fi

    echo -n "."
    sleep 3
  done
fi

# =============================================================================
# 总结
# =============================================================================
echo ""
print_section_header "✅ server 重建完成"

if [[ "${DRY_RUN}" != "1" ]]; then
  docker compose -f "${COSTRA_COMPOSE_FILE}" ps
  echo ""
  log_info "验证建议："
  log_info "  - curl -s http://localhost:8080/healthz"
  log_info "  - curl -s https://${COSTRA_DOMAIN}/healthz"
  log_info "  - docker logs ${SERVER_CONTAINER} --tail 50"
fi

exit 0
