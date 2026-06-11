#!/usr/bin/env bash
# =============================================================================
# Costra prod bootstrap · §1 前置确认
# =============================================================================
# 对应手册：infra/prod-bootstrap-compose.md §1
# 检查项：
#   1. OS（tlinux/centos/rhel 系）
#   2. Docker 已装 + 版本 ≥20.10
#   3. docker compose v2.x
#   4. DNS 解析（域名指向本机）
#   5. 端口空闲（5432/6379/8080/80/443）
#   6. 必备工具（openssl / curl / dig / sed / tar）
#
# 用法：
#   ./01-preflight.sh                    # 完整检查
#   ./01-preflight.sh --skip-dns         # 跳过 DNS 检查（域名还没切过来时）
#   ./01-preflight.sh --domain other.com # 自定义域名
#   ./01-preflight.sh --dry-run          # 只打印不执行
#
# 退出码：
#   0 = 全部通过
#   1 = 任一项失败
# =============================================================================

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=lib/common.sh
source "${SCRIPT_DIR}/lib/common.sh"

# --- 默认参数 ---
SKIP_DNS=0
DOMAIN="${COSTRA_DOMAIN}"

# --- 解析参数 ---
parse_common_args "$@"
while [[ $# -gt 0 ]]; do
  case "$1" in
    --skip-dns)   SKIP_DNS=1; shift ;;
    --domain)     DOMAIN=$2; shift 2 ;;
    --dry-run|-y|--yes) shift ;;  # 已被 parse_common_args 处理
    -h|--help)
      grep '^#' "$0" | head -30
      exit 0
      ;;
    *) die "未知参数: $1 · 用 --help 查看用法" ;;
  esac
done

# =============================================================================
# 主流程
# =============================================================================
print_section_header "01 · 前置确认（§1）"

FAIL_COUNT=0

# --- 1. OS ---
log_step "[1/6] 检查 OS"
if [[ -f /etc/os-release ]]; then
  OS_NAME=$(grep -E '^NAME=' /etc/os-release | cut -d= -f2 | tr -d '"')
  OS_VERSION=$(grep -E '^VERSION=' /etc/os-release | cut -d= -f2 | tr -d '"')
  log_success "OS: ${OS_NAME} ${OS_VERSION}"
else
  log_warn "无法识别 OS（/etc/os-release 不存在）· 但不阻塞"
fi

# --- 2. Docker ---
log_step "[2/6] 检查 Docker"
if command -v docker >/dev/null 2>&1; then
  DOCKER_VER=$(docker --version 2>/dev/null | grep -oE '[0-9]+\.[0-9]+\.[0-9]+' | head -1)
  log_success "Docker: ${DOCKER_VER}"

  # 大版本 ≥20
  DOCKER_MAJOR=$(echo "${DOCKER_VER}" | cut -d. -f1)
  if [[ "${DOCKER_MAJOR}" -lt 20 ]]; then
    log_error "Docker 版本过低（${DOCKER_VER}）· 期望 ≥20.10"
    FAIL_COUNT=$((FAIL_COUNT + 1))
  fi
else
  log_error "未安装 docker"
  FAIL_COUNT=$((FAIL_COUNT + 1))
fi

# --- 3. docker compose v2 ---
log_step "[3/6] 检查 docker compose v2"
if docker compose version >/dev/null 2>&1; then
  COMPOSE_VER=$(docker compose version --short 2>/dev/null || docker compose version | grep -oE 'v[0-9]+\.[0-9]+\.[0-9]+' | head -1)
  log_success "docker compose: ${COMPOSE_VER}"
else
  log_error "未安装 docker compose v2 · 不接受 docker-compose v1"
  log_info "  → 安装方法：dnf install -y docker-compose-plugin"
  FAIL_COUNT=$((FAIL_COUNT + 1))
fi

# --- 4. DNS ---
log_step "[4/6] 检查 DNS"
if [[ "${SKIP_DNS}" == "1" ]]; then
  log_warn "已 --skip-dns · 跳过 DNS 检查"
elif ! command -v dig >/dev/null 2>&1; then
  log_warn "未装 dig · 跳过 DNS 检查（建议 dnf install -y bind-utils）"
else
  DNS_IP=$(dig +short "${DOMAIN}" @8.8.8.8 2>/dev/null | grep -E '^[0-9]+\.' | head -1)
  HOST_IPS=$(hostname -I 2>/dev/null | tr ' ' '\n')
  if [[ -z "${DNS_IP}" ]]; then
    log_warn "${DOMAIN} 没有 A 记录（可能还没解析）· 不阻塞 · 但 §6.1 签证书前必须解析"
  else
    if echo "${HOST_IPS}" | grep -qFx "${DNS_IP}"; then
      log_success "${DOMAIN} → ${DNS_IP}（指向本机）"
    else
      log_warn "${DOMAIN} → ${DNS_IP}（不指向本机 · 本机 IP 是: ${HOST_IPS}）"
      log_warn "  → 这台机器可能不是 prod 入口 · 或域名还没切过来"
    fi
  fi
fi

# --- 5. 端口空闲 ---
log_step "[5/6] 检查关键端口空闲（5432/6379/8080/80/443）"
PORT_BUSY=0
if command -v ss >/dev/null 2>&1; then
  for port in 5432 6379 8080 80 443; do
    # 排除 docker-proxy（docker 容器映射的不算冲突 · 因为我们就是要起这些容器）
    if ss -tlnp 2>/dev/null | grep -E ":${port}\b" | grep -v 'docker-proxy' | grep -qE 'LISTEN'; then
      log_warn "端口 ${port} 被非 docker 进程占用："
      ss -tlnp 2>/dev/null | grep -E ":${port}\b" | grep -v 'docker-proxy' >&2
      PORT_BUSY=$((PORT_BUSY + 1))
    fi
  done
  if [[ "${PORT_BUSY}" == "0" ]]; then
    log_success "5 个关键端口全空闲（或仅被 docker 占用 · 预期内）"
  else
    log_error "${PORT_BUSY} 个端口被占用 · 部署前需要让出"
    FAIL_COUNT=$((FAIL_COUNT + 1))
  fi
else
  log_warn "未装 ss 命令 · 跳过端口检查"
fi

# --- 6. 必备工具 ---
log_step "[6/6] 检查必备工具"
TOOLS=(openssl curl sed tar grep)
MISSING_TOOLS=()
for tool in "${TOOLS[@]}"; do
  if ! command -v "${tool}" >/dev/null 2>&1; then
    MISSING_TOOLS+=("${tool}")
  fi
done
if [[ ${#MISSING_TOOLS[@]} -eq 0 ]]; then
  log_success "必备工具齐全：${TOOLS[*]}"
else
  log_error "缺少工具：${MISSING_TOOLS[*]}"
  log_info "  → 安装：dnf install -y ${MISSING_TOOLS[*]}"
  FAIL_COUNT=$((FAIL_COUNT + 1))
fi

# =============================================================================
# 总结
# =============================================================================
echo ""
if [[ "${FAIL_COUNT}" == "0" ]]; then
  log_success "前置检查全部通过 · 可以进入 §3.3 (02-prepare-dirs.sh)"
  exit 0
else
  log_error "前置检查 ${FAIL_COUNT} 项失败 · 请补齐后重跑"
  exit 1
fi
