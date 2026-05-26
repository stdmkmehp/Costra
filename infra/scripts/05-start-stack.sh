#!/usr/bin/env bash
# =============================================================================
# Costra prod bootstrap · §4.2~§4.4 拉镜像 + 起 3 服务 + 验证
# =============================================================================
# 对应手册：infra/prod-bootstrap-compose.md §4.2 + §4.3 + §4.4
#
# v1.5.1 实测踩坑 6：不能一把梭 up 4 容器（nginx 在没证书时反复 restart 17 次）
# 本脚本只起 postgres / redis / server 三个 · nginx 由 08-finalize-nginx.sh 起
#
# 用法：
#   ./05-start-stack.sh                # 标准跑
#   ./05-start-stack.sh --no-pull      # 跳过 pull（已 pull 过 / 离线环境）
#   ./05-start-stack.sh --timeout 120  # healthy 等待超时（默认 90s）
#
# 退出码：
#   0 = 3 容器 healthy
#   1 = 失败 + 提示如何看 logs
# =============================================================================

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=lib/common.sh
source "${SCRIPT_DIR}/lib/common.sh"

# --- 默认参数 ---
SKIP_PULL=0
HEALTHY_TIMEOUT=90

# --- 解析参数 ---
parse_common_args "$@"
while [[ $# -gt 0 ]]; do
  case "$1" in
    --no-pull)         SKIP_PULL=1; shift ;;
    --timeout)         HEALTHY_TIMEOUT=$2; shift 2 ;;
    --dry-run|-y|--yes) shift ;;
    -h|--help)
      grep '^#' "$0" | head -20
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
print_section_header "05 · 起 3 服务 stack（§4.2~§4.4）"

# --- Step 1: 拉官方镜像（postgres/redis/nginx）---
if [[ "${SKIP_PULL}" == "1" ]]; then
  log_step "[1/3] 拉镜像 → 已 --no-pull · 跳过"
else
  log_step "[1/3] 拉 postgres/redis/nginx 官方镜像"
  cd "${COSTRA_INFRA}"
  run_cmd docker compose -f "${COSTRA_COMPOSE_FILE}" pull postgres redis nginx
  log_success "官方镜像就绪"
fi

# --- Step 2: 起 3 服务（不起 nginx · §4.3 改造）---
log_step "[2/3] 起 postgres + redis + server（不起 nginx · 见 §4.3）"

cd "${COSTRA_INFRA}"
run_cmd docker compose -f "${COSTRA_COMPOSE_FILE}" --env-file "${COSTRA_ENV_FILE}" \
  up -d postgres redis server

# --- Step 3: 等 healthy（最长 ${HEALTHY_TIMEOUT} 秒）---
log_step "[3/3] 等待 3 容器 healthy（超时 ${HEALTHY_TIMEOUT}s）"

if [[ "${DRY_RUN}" == "1" ]]; then
  log_dry "（dry-run 跳过 healthy 检查）"
  exit 0
fi

CONTAINERS=(costra-postgres costra-redis costra-server)
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
    log_success "3 容器全 healthy"
    docker compose -f "${COSTRA_COMPOSE_FILE}" ps
    break
  fi

  ELAPSED=$(( $(date +%s) - START_TS ))
  if [[ "${ELAPSED}" -ge "${HEALTHY_TIMEOUT}" ]]; then
    log_error "等待超时（${HEALTHY_TIMEOUT}s）· 当前状态："
    docker compose -f "${COSTRA_COMPOSE_FILE}" ps
    echo ""
    log_error "诊断建议（按容器名检查 logs）："
    for c in "${CONTAINERS[@]}"; do
      STATUS=$(docker inspect --format '{{.State.Health.Status}}' "$c" 2>/dev/null || echo "missing")
      if [[ "${STATUS}" != "healthy" ]]; then
        log_error "  ${c} (${STATUS}) → docker logs ${c} --tail 50"
      fi
    done
    echo ""
    log_error "redis Restarting? → 99% 是 §3.3 chown 漏做（参考手册 §8 Q8）"
    log_error "server unhealthy? → 看启动日志（migrations 是否跑过 / WX_APP_SECRET 是否对）"
    exit 1
  fi

  echo -n "."
  sleep 3
done

# =============================================================================
# 总结
# =============================================================================
echo ""
log_success "3 容器 stack 就绪 · 可以进入 §5 (06-migrate.sh)"
exit 0
