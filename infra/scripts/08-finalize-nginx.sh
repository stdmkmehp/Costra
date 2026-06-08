#!/usr/bin/env bash
# =============================================================================
# Costra prod bootstrap · §6.3+§6.4 nginx -t + up nginx + cron 续期
# =============================================================================
# 对应手册：infra/prod-bootstrap-compose.md §6.3 + §6.4
#
# 用法：
#   ./08-finalize-nginx.sh                    # 完整跑（nginx -t + up + cron）
#   ./08-finalize-nginx.sh --skip-cron        # 不写 cron（已写过 / 容器化部署不要 cron）
#   ./08-finalize-nginx.sh --no-dry-run-renew # 不跑 certbot renew --dry-run（离线 / 测试机器）
#
# 退出码：
#   0 = nginx healthy + cron 已配 + dry-run 续期通过
# =============================================================================

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=lib/common.sh
source "${SCRIPT_DIR}/lib/common.sh"

# --- 默认参数 ---
SKIP_CRON=0
SKIP_DRY_RUN_RENEW=0
HEALTHY_TIMEOUT=60

# --- 解析参数 ---
parse_common_args "$@"
while [[ $# -gt 0 ]]; do
  case "$1" in
    --skip-cron)         SKIP_CRON=1; shift ;;
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
print_section_header "08 · 启动 nginx + 配 cron 续期（§6.3+§6.4）"

# --- Step 1: nginx -t 测语法 ---
log_step "[1/4] 容器内测 nginx conf 语法"

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
log_step "[2/4] 启动 nginx 容器"

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

# --- Step 3: 配 cron 续期（v1.5.1 修坑 7）---
if [[ "${SKIP_CRON}" == "1" ]]; then
  log_step "[3/4] cron 续期 → 已 --skip-cron · 跳过"
else
  log_step "[3/4] 配置 cron 续期（webroot · 加 -T 修 TTY 坑）"

  CRON_FILE="/etc/cron.d/costra-certbot"
  CRON_CONTENT=$(cat <<'EOF'
SHELL=/bin/bash
PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin

# 每天凌晨 03:17 检查证书续期（错峰整点 · LE 官方推荐）
# certbot 自己判断是否到期 · 没到期会静默跳过
# --deploy-hook 只在真续到新证书后才 reload nginx · 避免每天空 reload
# -T 关闭 TTY 分配（cron 没 TTY · 不加报 "input device is not a TTY"）
17 3 * * * root certbot renew --quiet --deploy-hook "docker compose -f /root/release/Costra/infra/docker-compose.prod.yml exec -T nginx nginx -s reload" >> /var/log/certbot-renew.log 2>&1
EOF
  )

  if [[ "${DRY_RUN}" == "1" ]]; then
    log_dry "写入 ${CRON_FILE} (mode=0644)"
  else
    backup_file "${CRON_FILE}"
    printf '%s\n' "${CRON_CONTENT}" > "${CRON_FILE}"
    chmod 0644 "${CRON_FILE}"
    log_success "已写入 ${CRON_FILE}"
  fi

  # 准备日志文件 + logrotate
  run_cmd touch /var/log/certbot-renew.log
  run_cmd chmod 0644 /var/log/certbot-renew.log

  # 确保 crond 在跑
  if [[ "${DRY_RUN}" != "1" ]]; then
    if systemctl is-active --quiet crond 2>/dev/null; then
      systemctl restart crond
      log_success "crond 已 restart · cron 配置生效"
    else
      log_warn "crond 服务未运行 · 请手动 systemctl enable --now crond"
    fi
  fi
fi

# --- Step 4: dry-run 验证续期能跑通 ---
if [[ "${SKIP_DRY_RUN_RENEW}" == "1" ]]; then
  log_step "[4/4] certbot renew --dry-run → 已 --no-dry-run-renew · 跳过"
else
  log_step "[4/4] certbot renew --dry-run（验证续期链路）"

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
log_success "nginx + cron 就绪 · 可以进入 §7 (09-verify-gates.sh)"
exit 0
