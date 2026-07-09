#!/usr/bin/env bash
# =============================================================================
# Costra · 快速重部署（[可选构建] → 停止 → 启动 → 等待 healthy）
# =============================================================================
# 适用场景：prod 环境已搭建完毕，只需要：
#   1. （可选）重新构建镜像（旧服务仍在线，构建失败不影响线上）
#   2. 停止服务（构建成功后才停，最小化停机窗口）
#   3. 启动服务
#   4. 等待容器 healthy
#
# 本脚本不会跑 migration，也不会 git pull。
# 如需 migration，请单独执行 ./06-migrate.sh。
# 如需更新代码，请自行 git pull。
#
# 重启目标：
#   默认只重启 server。可通过 --restart-* 额外添加，--no-restart-server 移除。
#
# 与现有脚本的关系（不要混用）：
#   - 05-start-stack.sh  : 首次/全量启动 stack（拉镜像 · 起四服务）
#   - 04-build-server.sh : 只 build 镜像（不停服 · 不重启）
#   - 06-migrate.sh      : 单独跑 migration（幂等）
#   - 本脚本             : [可选 build] + 按参数重启指定服务 · 不跑 migration
#
# 用法：
#   ./redeploy.sh                                          # 默认：只重启 server（不构建）
#   ./redeploy.sh --build-mode local                       # 本地构建 + 重启 server
#   ./redeploy.sh --build-mode registry --registry-image weizhao/costra-server:v2.0
#   ./redeploy.sh --build-mode load --image-tar /tmp/costra-server.tar.gz
#   ./redeploy.sh --restart-nginx                          # 重启 server + nginx（不构建）
#   ./redeploy.sh --restart-psql --restart-redis           # 重启 server + postgres + redis
#   ./redeploy.sh --restart-nginx --no-restart-server      # 只重启 nginx（不动 server）
#   ./redeploy.sh --timeout 120                            # healthy 等待超时（默认 90s）
#   ./redeploy.sh --dry-run / -y / --yes / -h / --help
#
# 选项：
#   --restart-nginx                     额外重启 nginx
#   --restart-redis                     额外重启 redis
#   --restart-psql                      额外重启 postgres
#   --no-restart-server                 不重启 server（默认会重启）
#   --build-mode <local|load|registry>  指定后才会构建镜像（不传则跳过构建）
#   --image-tar <path>                  load 模式：tar.gz 路径
#   --registry-image <full>             registry 模式：完整镜像名
#   --timeout <seconds>                 healthy 等待超时（默认 90s）
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
RESTART_SERVER=1
RESTART_NGINX=0
RESTART_REDIS=0
RESTART_PSQL=0
BUILD_MODE=""
IMAGE_TAR=""
REGISTRY_IMAGE=""
HEALTHY_TIMEOUT=90

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
    --timeout)           HEALTHY_TIMEOUT=$2; shift 2 ;;
    --dry-run|-y|--yes)  shift ;;
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
[[ "${DRY_RUN}" == "1" ]]    && COMMON_FLAGS+=(--dry-run)
[[ "${ASSUME_YES}" == "1" ]] && COMMON_FLAGS+=(--yes)

# =============================================================================
# 主流程
# =============================================================================
print_section_header "Costra · 快速重部署"

log_info "restart         = ${RESTART_DESC}"
if [[ -n "${BUILD_MODE}" ]]; then
  log_info "build mode      = ${BUILD_MODE}"
else
  log_info "build mode      = (skip · 未指定 --build-mode)"
fi
log_info "healthy timeout = ${HEALTHY_TIMEOUT}s"
[[ "${DRY_RUN}" == "1" ]] && log_warn "DRY-RUN 模式 · 不真正执行命令"

if [[ "${ASSUME_YES}" != "1" ]]; then
  echo ""
  log_warn "本脚本不会跑 migration · 如需迁移请单独执行 ./06-migrate.sh"
  confirm "确认开始重部署？将停止 ${RESTART_DESC}" || die "用户取消"
fi

TOTAL_STEPS=2
[[ -n "${BUILD_MODE}" ]] && TOTAL_STEPS=$((TOTAL_STEPS + 1))
CURRENT=0

# 注意：bash `set -e` 下 `((var++))` 当 var 自增前为 0 时整条命令退出码为 1，
# 会触发 ERR trap。统一改用 `var=$((var + 1))` 形式（赋值语句退出码恒为 0）。

# --- Step 1（可选）: 构建（先构建，旧服务仍在线，构建失败不影响线上）---
if [[ -n "${BUILD_MODE}" ]]; then
  CURRENT=$((CURRENT + 1))
  log_step "[${CURRENT}/${TOTAL_STEPS}] 构建镜像（mode=${BUILD_MODE}）"

  BUILD_ARGS=("${COMMON_FLAGS[@]}" --mode "${BUILD_MODE}")
  [[ -n "${IMAGE_TAR}" ]]      && BUILD_ARGS+=(--image-tar "${IMAGE_TAR}")
  [[ -n "${REGISTRY_IMAGE}" ]] && BUILD_ARGS+=(--registry-image "${REGISTRY_IMAGE}")

  if ! "${SCRIPT_DIR}/04-build-server.sh" "${BUILD_ARGS[@]}"; then
    die "构建失败 · 请检查日志（服务未停止，线上不受影响）"
  fi
  log_success "镜像构建完成"
fi

# --- Step 2: 停止服务（构建成功后才停，最小化停机窗口）---
CURRENT=$((CURRENT + 1))
log_step "[${CURRENT}/${TOTAL_STEPS}] 停止服务（${RESTART_DESC}）"

cd "${COSTRA_INFRA}"
run_cmd docker compose -f "${COSTRA_COMPOSE_FILE}" --env-file "${COSTRA_ENV_FILE}" \
  stop "${STOP_SERVICES[@]}"
log_success "已停止 ${RESTART_DESC}"

# --- Step 3: 启动服务 ---
CURRENT=$((CURRENT + 1))
log_step "[${CURRENT}/${TOTAL_STEPS}] 启动服务（${RESTART_DESC}）"

# 用 up -d 而不是 start：up 会用最新镜像重新创建容器（拿到刚 build 的新镜像）
# start 只会启动旧容器（拿不到新镜像），这是关键差别
cd "${COSTRA_INFRA}"
run_cmd docker compose -f "${COSTRA_COMPOSE_FILE}" --env-file "${COSTRA_ENV_FILE}" \
  up -d "${UP_SERVICES[@]}"

# 等待 healthy
if [[ "${DRY_RUN}" != "1" ]]; then
  log_info "等待容器 healthy..."
  START_TS=$(date +%s)

  while true; do
    ALL_HEALTHY=1
    for c in "${HEALTH_CONTAINERS[@]}"; do
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
      echo ""
      log_error "诊断建议："
      log_error "  docker logs <container> --tail 80"
      log_error "  docker compose -f ${COSTRA_COMPOSE_FILE} ps"
      die "容器未能在 ${HEALTHY_TIMEOUT}s 内变为 healthy"
    fi

    echo -n "."
    sleep 3
  done
fi

# =============================================================================
# 总结
# =============================================================================
echo ""
print_section_header "✅ 重部署完成（${RESTART_DESC}）"

if [[ "${DRY_RUN}" != "1" ]]; then
  echo ""
  docker compose -f "${COSTRA_COMPOSE_FILE}" ps
  echo ""
  log_info "验证建议："
  log_info "  - curl -s http://localhost:8080/healthz"
  log_info "  - curl -s https://${COSTRA_DOMAIN}/healthz"
  log_info "  - docker logs costra-server --tail 50"
fi

exit 0
