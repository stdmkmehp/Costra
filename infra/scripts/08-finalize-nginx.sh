#!/usr/bin/env bash
# =============================================================================
# Costra prod bootstrap · §6.3 nginx -t + up nginx
# =============================================================================
# 对应手册：infra/prod-bootstrap-compose.md §6.3
#
# 注：证书续期（含 dry-run 验证）已完全并入 maintenance.sh（renew-cert 子命令 ·
#     由 install-cron 统一安装 cron）。本脚本只负责启动 nginx（语法校验 + up + 等 healthy）。
#
# 用法：
#   ./08-finalize-nginx.sh                    # nginx -t + up nginx
#
# 退出码：
#   0 = nginx healthy
# =============================================================================

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=lib/common.sh
source "${SCRIPT_DIR}/lib/common.sh"

# --- 默认参数 ---
HEALTHY_TIMEOUT=60

# --- 解析参数 ---
parse_common_args "$@"
while [[ $# -gt 0 ]]; do
  case "$1" in
    --timeout)           HEALTHY_TIMEOUT=$2; shift 2 ;;
    --dry-run|-y|--yes)  shift ;;
    -h|--help)
      grep '^#' "$0" | head -14
      exit 0
      ;;
    *) die "未知参数: $1" ;;
  esac
done

require_root
require_cmd docker
require_file "${COSTRA_COMPOSE_FILE}"
require_file "${COSTRA_ENV_FILE}"

# =============================================================================
# 主流程
# =============================================================================
print_section_header "08 · 启动 nginx（§6.3）"

# --- Step 1: nginx -t 测语法 ---
log_step "[1/2] 容器内测 nginx conf 语法"

# 需要连 Compose 网络 · 否则解析不了 upstream "server"（service name DNS）
# 网络名由 docker-compose.prod.yml 顶层 name: costra 决定 → costra_default
COMPOSE_NET="${COSTRA_COMPOSE_NET}"

# 若网络还不存在（首次部署 · 其他容器还没 up），先创建
if ! docker network inspect "${COMPOSE_NET}" >/dev/null 2>&1; then
  log_info "Compose 网络 ${COMPOSE_NET} 不存在 · 先创建"
  run_cmd docker network create "${COMPOSE_NET}"
fi

run_cmd docker run --rm \
  --network "${COMPOSE_NET}" \
  -v "${COSTRA_DATA}/conf/nginx:/etc/nginx/conf.d:ro" \
  -v "/etc/letsencrypt:/etc/letsencrypt:ro" \
  nginx:1.27-alpine nginx -t

log_success "nginx 配置语法 OK"

# --- Step 2: up nginx ---
log_step "[2/2] 启动 nginx 容器"

cd "${COSTRA_INFRA}"
run_cmd docker compose -f "${COSTRA_COMPOSE_FILE}" --env-file "${COSTRA_ENV_FILE}" up -d nginx

# 等 healthy
log_info "等待 nginx healthy（超时 ${HEALTHY_TIMEOUT}s）"

if [[ "${DRY_RUN}" != "1" ]]; then
  START_TS=$(date +%s)
  while true; do
    STATUS=$(docker inspect --format '{{.State.Health.Status}}' costra-nginx 2>/dev/null || echo "missing")
    [[ "${STATUS}" == "healthy" ]] && { log_success "costra-nginx healthy"; break; }

    ELAPSED=$(( $(date +%s) - START_TS ))
    if [[ "${ELAPSED}" -ge "${HEALTHY_TIMEOUT}" ]]; then
      log_error "nginx healthy 超时（${HEALTHY_TIMEOUT}s）· 当前: ${STATUS}"
      log_error "查日志: docker logs costra-nginx --tail 30"
      exit 1
    fi
    echo -n "."
    sleep 2
  done
fi

# =============================================================================
# 总结
# =============================================================================
echo ""
log_success "nginx 就绪 · 证书续期（含 dry-run 验证）由 maintenance.sh 统一负责 · 可进入 §7 (09-verify-gates.sh)"
exit 0
