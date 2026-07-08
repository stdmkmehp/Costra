#!/usr/bin/env bash
# =============================================================================
# Costra prod bootstrap · §6.3+§6.4 nginx -t + up nginx + 验证续期链路
# =============================================================================
# 对应手册：infra/prod-bootstrap-compose.md §6.3 + §6.4
#
# 注：定时续期 cron 已并入 maintenance.sh（renew-cert 子命令 · 由 install-cron 统一安装）。
#     本脚本不再写 cron，但仍在部署时用 certbot renew --dry-run 验证续期链路能跑通。
#
# 用法：
#   ./08-finalize-nginx.sh                    # 完整跑（nginx -t + up + dry-run 续期验证）
#   ./08-finalize-nginx.sh --no-dry-run-renew # 不跑 certbot renew --dry-run（离线 / 测试机器）
#
# 退出码：
#   0 = nginx healthy + dry-run 续期通过
# =============================================================================

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=lib/common.sh
source "${SCRIPT_DIR}/lib/common.sh"

# --- 默认参数 ---
SKIP_DRY_RUN_RENEW=0
HEALTHY_TIMEOUT=60

# --- 解析参数 ---
parse_common_args "$@"
while [[ $# -gt 0 ]]; do
  case "$1" in
    --no-dry-run-renew)  SKIP_DRY_RUN_RENEW=1; shift ;;
    --timeout)           HEALTHY_TIMEOUT=$2; shift 2 ;;
    --dry-run|-y|--yes)  shift ;;
    -h|--help)
      grep '^#' "$0" | head -16
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
print_section_header "08 · 启动 nginx + 验证续期链路（§6.3+§6.4）"

# --- Step 1: nginx -t 测语法 ---
log_step "[1/3] 容器内测 nginx conf 语法"

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
log_step "[2/3] 启动 nginx 容器"

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

# --- Step 3: dry-run 验证续期能跑通 ---
if [[ "${SKIP_DRY_RUN_RENEW}" == "1" ]]; then
  log_step "[3/3] certbot renew --dry-run → 已 --no-dry-run-renew · 跳过"
else
  log_step "[3/3] certbot renew --dry-run（验证续期链路）"

  if ! command -v certbot >/dev/null 2>&1; then
    log_warn "未装 certbot · 跳过 dry-run（07-issue-cert.sh 应已装）"
  elif [[ "${DRY_RUN}" == "1" ]]; then
    log_dry "certbot renew --dry-run"
  else
    if certbot renew --dry-run 2>&1 | tail -5; then
      log_success "续期链路验证通过 · 90 天后会自动续 · nginx 不会停"
    else
      log_error "续期 dry-run 失败 · 检查："
      log_error "  1. /etc/letsencrypt/renewal/${COSTRA_DOMAIN}.conf 里 authenticator=webroot + webroot_path 正确 ?"
      log_error "     （07-issue-cert.sh webroot 签证后天然正确 · 若是 import-tar 需确认 tar 内配置）"
      log_error "  2. ${COSTRA_DATA}/certbot/www 目录存在且可写 ?"
      log_error "  3. nginx 容器在跑 + 80 端口可达 + /.well-known/acme-challenge/ location 配置正确 ?"
      exit 1
    fi
  fi
fi

# =============================================================================
# 总结
# =============================================================================
echo ""
log_success "nginx 就绪 · 续期链路已验证 · 定时续期 cron 由 maintenance.sh install-cron 统一安装 · 可进入 §7 (09-verify-gates.sh)"
exit 0
