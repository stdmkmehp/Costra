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

# --- Step 1: 同步 nginx 模板 → live（/data/conf/nginx）---
log_step "[1/4] 同步 nginx 配置模板 → live（/data/conf/nginx）"

NGINX_TMPL_DIR="${COSTRA_INFRA}/nginx/conf.d"
NGINX_LIVE_DIR="${COSTRA_DATA}/conf/nginx"
NGINX_LIVE_CONF="${NGINX_LIVE_DIR}/costra.cloud.conf"

# 按 COSTRA_DOMAIN 选源模板：
#   costra.cloud       → costra.cloud.conf.prod
#   stg.costra.cloud   → costra.cloud.conf.staging
#   其他值             → 报错（防止误部署到未预期环境）
#
# 注意：源文件带 .prod / .staging 后缀 · 不会被 nginx 直接加载（nginx 只加载 *.conf）
#复制到 live 时统一改名为 costra.cloud.conf（这样 nginx 才会认）
case "${COSTRA_DOMAIN}" in
  costra.cloud)
    NGINX_TMPL_SRC="${NGINX_TMPL_DIR}/costra.cloud.conf.prod"
    ENV_LABEL="prod"
    ;;
  stg.costra.cloud)
    NGINX_TMPL_SRC="${NGINX_TMPL_DIR}/costra.cloud.conf.staging"
    ENV_LABEL="staging"
    ;;
  *)
    die "不支持的 COSTRA_DOMAIN=${COSTRA_DOMAIN} · 仅支持 costra.cloud / stg.costra.cloud · 如需新增环境请在 infra/nginx/conf.d/ 补一份 costra.cloud.conf.<env> 并在此 case 加分支"
    ;;
esac

require_file "${NGINX_TMPL_SRC}"

mkdir -p "${NGINX_LIVE_DIR}"

# 策略：如果 live conf 已存在（非首次部署）· 不覆盖（保护已启用 SSL 的运行时配置）
# 只在 live conf 缺失时（首次部署）才从模板复制
if [[ ! -f "${NGINX_LIVE_CONF}" ]]; then
  log_info "live conf 不存在（首次部署 · ${ENV_LABEL}）· 从模板复制"
  log_info "  src : ${NGINX_TMPL_SRC}"
  log_info "  dst : ${NGINX_LIVE_CONF}"
  run_cmd cp -a "${NGINX_TMPL_SRC}" "${NGINX_LIVE_CONF}"
  log_success "${ENV_LABEL} 模板已复制到 ${NGINX_LIVE_CONF}"
else
  log_info "live conf 已存在 · 跳过覆盖（git pull 安全）"
  log_info "如需强制更新: rm ${NGINX_LIVE_CONF} && 重跑 05-start-stack.sh"
  log_info "或手动: cp ${NGINX_TMPL_SRC} ${NGINX_LIVE_CONF}"
fi

# --- Step 2: 拉官方镜像（postgres/redis/nginx）---
if [[ "${SKIP_PULL}" == "1" ]]; then
  log_step "[2/4] 拉镜像 → 已 --no-pull · 跳过"
else
  log_step "[2/4] 拉 postgres/redis/nginx 官方镜像"
  cd "${COSTRA_INFRA}"
  run_cmd docker compose -f "${COSTRA_COMPOSE_FILE}" pull postgres redis nginx
  log_success "官方镜像就绪"
fi

# --- Step 3: 起 3 服务（不起 nginx · §4.3 改造）---
log_step "[3/4] 起 postgres + redis + server（不起 nginx · 见 §4.3）"

cd "${COSTRA_INFRA}"
run_cmd docker compose -f "${COSTRA_COMPOSE_FILE}" --env-file "${COSTRA_ENV_FILE}" \
  up -d postgres redis server

# --- Step 4: 等 healthy（最长 ${HEALTHY_TIMEOUT} 秒）---
log_step "[4/4] 等待 3 容器 healthy（超时 ${HEALTHY_TIMEOUT}s）"

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
