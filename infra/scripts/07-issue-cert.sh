#!/usr/bin/env bash
# =============================================================================
# Costra prod bootstrap · §6.1+§6.2 签证书 + 取消 nginx SSL 注释
# =============================================================================
# 对应手册：infra/prod-bootstrap-compose.md §6.1 + §6.2
#
# 三种使用模式：
#
#   1. 全新签证（默认 · webroot 模式）：
#      ./07-issue-cert.sh --email you@example.com
#      → 临时 nginx 80-only + certbot webroot 签新证书
#      → renewal.conf 天然 webroot · 不需要手改
#
#   2. 复用现有证书（机器迁移 / 备机部署）：
#      ./07-issue-cert.sh --use-existing
#      → 不签 · 仅校验 /etc/letsencrypt/live/<domain>/ 已存在
#
#   3. 复用 + 从其他机器导入：
#      ./07-issue-cert.sh --use-existing --import-tar /tmp/letsencrypt.tar.gz
#      → 解压 tar 到 /etc/letsencrypt
#
# 用法：
#   ./07-issue-cert.sh [选项]
#
# 选项：
#   --email <addr>            （首次签证必选）证书邮箱
#   --domain <name>           域名（默认 costra.cloud）
#   --use-existing            复用现有证书（不重新签）
#   --import-tar <path>       与 --use-existing 配合 · 从 tar.gz 导入证书
#   --skip-ssl-uncomment      不取消 nginx conf 里 SSL 注释（仅签证书）
#   --dry-run / -y / --help
#
# 退出码：
#   0 = 证书就绪 + nginx conf SSL 已启用
# =============================================================================

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=lib/common.sh
source "${SCRIPT_DIR}/lib/common.sh"

# --- 默认参数 ---
EMAIL=""
DOMAIN="${COSTRA_DOMAIN}"
USE_EXISTING=0
IMPORT_TAR=""
SKIP_SSL_UNCOMMENT=0
# live配置路径（/data/conf/nginx）· 不是 repo 模板（./nginx/conf.d）
# 模板 → live 复制由 05-start-stack.sh 在起容器前完成（按 COSTRA_DOMAIN 选 .prod / .staging）
NGINX_CONF="${COSTRA_DATA}/conf/nginx/costra.cloud.conf"

# fallback 场景：若 live conf 缺失（05 没跑就直接跑 07），按 COSTRA_DOMAIN 选源模板
case "${COSTRA_DOMAIN}" in
  costra.cloud)      NGINX_CONF_TEMPLATE="${COSTRA_INFRA}/nginx/conf.d/costra.cloud.conf.prod" ;;
  stg.costra.cloud)  NGINX_CONF_TEMPLATE="${COSTRA_INFRA}/nginx/conf.d/costra.cloud.conf.staging" ;;
  *)                 NGINX_CONF_TEMPLATE="" ;;   # 未支持的域名 · fallback 分支后面会报错
esac

# --- 临时 nginx 容器名（签证专用 · 用完即弃）---
CERT_NGINX_NAME="costra-certbot-nginx"
CERT_NGINX_CONF="${COSTRA_INFRA}/nginx/certbot-only.conf"
WEBROOT_DIR="${COSTRA_DATA}/certbot/www"

# --- 解析参数 ---
parse_common_args "$@"
while [[ $# -gt 0 ]]; do
  case "$1" in
    --email)              EMAIL=$2; shift 2 ;;
    --domain)             DOMAIN=$2; shift 2 ;;
    --use-existing)       USE_EXISTING=1; shift ;;
    --import-tar)         IMPORT_TAR=$2; shift 2 ;;
    --skip-ssl-uncomment) SKIP_SSL_UNCOMMENT=1; shift ;;
    --dry-run|-y|--yes)   shift ;;
    -h|--help)
      grep '^#' "$0" | head -36
      exit 0
      ;;
    *) die "未知参数: $1 · 用 --help 查看" ;;
  esac
done

require_root

CERT_DIR="/etc/letsencrypt/live/${DOMAIN}"

# =============================================================================
# 清理函数（确保临时 nginx 被停掉 · 即使脚本中途失败）
# =============================================================================
cleanup_cert_nginx() {
  if docker ps --filter "name=${CERT_NGINX_NAME}" --format '{{.Names}}' 2>/dev/null | grep -q "${CERT_NGINX_NAME}"; then
    log_warn "清理：停掉临时签证 nginx（${CERT_NGINX_NAME}）"
    docker stop "${CERT_NGINX_NAME}" >/dev/null 2>&1 || true
  fi
}
trap cleanup_cert_nginx EXIT

# =============================================================================
# 主流程
# =============================================================================
print_section_header "07 · 签证书 + 取消 SSL 注释（§6.1+§6.2）· domain=${DOMAIN}"

# --- 防御：nginx 容器（compose 版 或 临时版）占 80 端口 ---
if docker ps --filter name=costra-nginx --format '{{.Status}}' 2>/dev/null | grep -q 'Restarting\|Up'; then
  log_warn "costra-nginx 容器在跑 · 签证需要 80 端口"
  log_info "  → 临时停 nginx："
  run_cmd docker compose -f "${COSTRA_COMPOSE_FILE}" rm -sf nginx 2>/dev/null || true
fi
if docker ps --filter "name=${CERT_NGINX_NAME}" --format '{{.Names}}' 2>/dev/null | grep -q "${CERT_NGINX_NAME}"; then
  log_warn "临时签证 nginx 仍在跑 · 先停掉"
  run_cmd docker stop "${CERT_NGINX_NAME}" 2>/dev/null || true
fi

# ============================================================
# 模式 A: 从 tar 导入证书
# ============================================================
if [[ -n "${IMPORT_TAR}" ]]; then
  log_step "[导入模式] 从 ${IMPORT_TAR} 解压证书"

  USE_EXISTING=1   # 隐含 use-existing
  require_file "${IMPORT_TAR}"

  # 备份现有 letsencrypt（如果有）
  if [[ -d /etc/letsencrypt ]]; then
    BACKUP="/etc/letsencrypt.bak.$(date +%Y%m%d-%H%M%S)"
    log_warn "/etc/letsencrypt 已存在 · 备份到 ${BACKUP}"
    run_cmd mv /etc/letsencrypt "${BACKUP}"
  fi

  log_info "解压到 /etc"
  run_cmd tar xzf "${IMPORT_TAR}" -C /etc

  # 验证
  if [[ "${DRY_RUN}" != "1" ]]; then
    [[ -d "${CERT_DIR}" ]] || die "导入后 ${CERT_DIR} 不存在 · tar 包内容可能不对"
    log_success "证书已导入: ${CERT_DIR}"
  fi
fi

# ============================================================
# 模式 B: 复用现有证书（仅校验）
# ============================================================
if [[ "${USE_EXISTING}" == "1" && -z "${IMPORT_TAR}" ]]; then
  log_step "[复用模式] 校验 ${CERT_DIR}"

  if [[ "${DRY_RUN}" != "1" ]]; then
    [[ -d "${CERT_DIR}" ]] || die "${CERT_DIR} 不存在 · 不能 --use-existing"
    [[ -L "${CERT_DIR}/fullchain.pem" || -f "${CERT_DIR}/fullchain.pem" ]] || die "fullchain.pem 不存在"
    [[ -L "${CERT_DIR}/privkey.pem" || -f "${CERT_DIR}/privkey.pem" ]] || die "privkey.pem 不存在"

    # 显示证书信息（有效期）
    NOT_AFTER=$(openssl x509 -in "${CERT_DIR}/fullchain.pem" -noout -enddate 2>/dev/null | cut -d= -f2)
    log_success "证书有效期至: ${NOT_AFTER}"

    DAYS_LEFT=$(( ($(date -d "${NOT_AFTER}" +%s 2>/dev/null || gdate -d "${NOT_AFTER}" +%s) - $(date +%s)) / 86400 ))
    if [[ "${DAYS_LEFT}" -lt 30 ]]; then
      log_warn "证书仅剩 ${DAYS_LEFT} 天 · 建议 cron 续期立即跑一次"
    else
      log_info "剩余 ${DAYS_LEFT} 天"
    fi
  fi
fi

# ============================================================
# 模式 C: 全新签证（webroot · 临时 nginx 容器）
# ============================================================
if [[ "${USE_EXISTING}" != "1" ]]; then
  [[ -n "${EMAIL}" ]] || die "全新签证必须 --email <addr>（用于证书到期提醒）"

  log_step "[新签模式] webroot 签 ${DOMAIN}"

  # --- 装 certbot ---
  if ! command -v certbot >/dev/null 2>&1; then
    log_info "未装 certbot · 自动安装"
    if command -v dnf >/dev/null 2>&1; then
      run_cmd dnf install -y certbot
    elif command -v yum >/dev/null 2>&1; then
      run_cmd yum install -y certbot
    elif command -v apt-get >/dev/null 2>&1; then
      run_cmd apt-get install -y certbot
    else
      die "找不到包管理器 · 请手动装 certbot"
    fi
  fi

  log_info "certbot $(certbot --version 2>&1 | head -1)"

  # --- 准备 webroot 目录 ---
  log_info "确保 webroot 目录存在: ${WEBROOT_DIR}"
  run_cmd mkdir -p "${WEBROOT_DIR}"

  # --- 确认极简 nginx 配置存在 ---
  require_file "${CERT_NGINX_CONF}"

  # --- 启动临时 nginx 容器（仅 80 端口 + ACME location）---
  log_info "启动临时签证 nginx（${CERT_NGINX_NAME}）· 仅 80 端口 + ACME"

  run_cmd docker run -d --rm \
    --name "${CERT_NGINX_NAME}" \
    -p 80:80 \
    -v "${CERT_NGINX_CONF}:/etc/nginx/conf.d/default.conf:ro" \
    -v "${WEBROOT_DIR}:/var/www/certbot" \
    nginx:1.27-alpine

  # 等临时 nginx 就绪（最多 10s）
  if [[ "${DRY_RUN}" != "1" ]]; then
    log_info "等待临时 nginx 就绪..."
    for i in $(seq 1 10); do
      if docker ps --filter "name=${CERT_NGINX_NAME}" --filter "status=running" --format '{{.Names}}' | grep -q "${CERT_NGINX_NAME}"; then
        log_success "临时签证 nginx 已启动"
        break
      fi
      [[ $i -eq 10 ]] && die "临时 nginx 启动超时"
      sleep 1
    done
  fi

  # --- certbot webroot 签证 ---
  log_info "开始 certbot webroot 签证..."
  run_cmd certbot certonly --webroot \
    -w "${WEBROOT_DIR}" \
    -d "${DOMAIN}" \
    --email "${EMAIL}" \
    --agree-tos --no-eff-email --non-interactive

  if [[ "${DRY_RUN}" != "1" ]]; then
    [[ -d "${CERT_DIR}" ]] || die "签证后 ${CERT_DIR} 仍不存在"
    log_success "证书已签: ${CERT_DIR}"
  fi

  # --- 停掉临时 nginx（释放 80 端口给后续 compose nginx）---
  log_info "停掉临时签证 nginx（释放 80 端口）"
  run_cmd docker stop "${CERT_NGINX_NAME}" 2>/dev/null || true

  log_success "webroot 签证完成 · renewal.conf 天然 authenticator=webroot · 无需手改"
fi

# ============================================================
# 取消 nginx conf 里 SSL 注释（§6.2）
# ============================================================
if [[ "${SKIP_SSL_UNCOMMENT}" == "1" ]]; then
  log_step "nginx SSL 注释 → 已 --skip-ssl-uncomment · 跳过"
else
  log_step "取消 nginx conf 里的 SSL 注释（${NGINX_CONF}）"

  # 如果 live conf 不存在· 从模板复制一份（防御：05 没跑就直接跑 07 的场景）
  if [[ ! -f "${NGINX_CONF}" ]]; then
    [[ -n "${NGINX_CONF_TEMPLATE}" ]] || die "COSTRA_DOMAIN=${COSTRA_DOMAIN} 没有对应模板 · 请先跑 05-start-stack.sh 或补充 infra/nginx/conf.d/costra.cloud.conf.<env>"
    log_info "live conf 不存在 · 从模板复制: ${NGINX_CONF_TEMPLATE} → ${NGINX_CONF}"
    require_file "${NGINX_CONF_TEMPLATE}"
    mkdir -p "$(dirname "${NGINX_CONF}")"
    cp "${NGINX_CONF_TEMPLATE}" "${NGINX_CONF}"
  fi

  require_file "${NGINX_CONF}"

  # 检查是否已经取消过（幂等）
  if grep -q '^    ssl_certificate /etc/letsencrypt' "${NGINX_CONF}"; then
    log_info "SSL 行已是非注释状态 · 跳过 sed"
  else
    backup_file "${NGINX_CONF}"

    run_cmd sed -i \
      -e 's|^    # ssl_certificate /etc/letsencrypt|    ssl_certificate /etc/letsencrypt|' \
      -e 's|^    # ssl_certificate_key /etc/letsencrypt|    ssl_certificate_key /etc/letsencrypt|' \
      -e 's|^    # ssl_protocols TLSv|    ssl_protocols TLSv|' \
      -e 's|^    # ssl_ciphers |    ssl_ciphers |' \
      -e 's|^    # ssl_prefer_server_ciphers |    ssl_prefer_server_ciphers |' \
      -e 's|^    # ssl_session_cache |    ssl_session_cache |' \
      -e 's|^    # ssl_session_timeout |    ssl_session_timeout |' \
      -e 's|^    # ssl_stapling on|    ssl_stapling on|' \
      -e 's|^    # ssl_stapling_verify |    ssl_stapling_verify |' \
      "${NGINX_CONF}"

    if [[ "${DRY_RUN}" != "1" ]]; then
      SSL_LINES=$(grep -c '^    ssl_' "${NGINX_CONF}")
      [[ "${SSL_LINES}" -ge 9 ]] || die "ssl_ 行数 ${SSL_LINES} < 9 · sed 可能没全部生效"
      log_success "SSL 行已取消注释（${SSL_LINES} 行）"
    fi
  fi
fi

# =============================================================================
# 总结
# =============================================================================
echo ""
log_success "证书 + nginx conf 就绪 · 可以进入 §6.3 (08-finalize-nginx.sh)"
exit 0
