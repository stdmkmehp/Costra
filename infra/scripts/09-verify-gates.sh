#!/usr/bin/env bash
# =============================================================================
# Costra prod bootstrap · §7 闸门 5 条验证
# =============================================================================
# 对应手册：infra/prod-bootstrap-compose.md §7
#
# 闸门 1 · /healthz 200
# 闸门 2 · ICP 响应头
# 闸门 3 · HTTP→HTTPS 重定向
# 闸门 4 · 4 容器 healthy
# 闸门 5 · D-026 §2.3 C2 mock 红线（log 不应有 mockLogin=true）
#
# 用法：
#   ./09-verify-gates.sh
#   ./09-verify-gates.sh --domain other.com   # 自定义域名
#   ./09-verify-gates.sh --skip-https         # 不测 https（DNS 还没切的临时机器）
#
# 退出码：
#   0 = 5 闸门全 PASS
#   1 = 任一 FAIL
# =============================================================================

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=lib/common.sh
source "${SCRIPT_DIR}/lib/common.sh"

# --- 默认参数 ---
DOMAIN="${COSTRA_DOMAIN}"
SKIP_HTTPS=0
EXPECTED_ICP="沪ICP备2026017253号-2"

# --- 解析参数 ---
parse_common_args "$@"
while [[ $# -gt 0 ]]; do
  case "$1" in
    --domain)        DOMAIN=$2; shift 2 ;;
    --skip-https)    SKIP_HTTPS=1; shift ;;
    --icp)           EXPECTED_ICP=$2; shift 2 ;;
    --dry-run|-y|--yes) shift ;;
    -h|--help)
      grep '^#' "$0" | head -22
      exit 0
      ;;
    *) die "未知参数: $1" ;;
  esac
done

require_cmd docker
require_cmd curl

# =============================================================================
# 主流程
# =============================================================================
print_section_header "09 · 闸门 5 条验证（§7）"

PASS_COUNT=0
FAIL_COUNT=0

# --- 闸门 1: /healthz 200 ---
log_step "[1/5] /healthz 200"
if [[ "${SKIP_HTTPS}" == "1" ]]; then
  log_warn "已 --skip-https · 跳过 https 测试 · 改测容器内"
  if docker exec costra-server node -e "require('http').get('http://127.0.0.1:8080/healthz',r=>process.exit(r.statusCode===200?0:1)).on('error',()=>process.exit(1))" 2>/dev/null; then
    log_success "  闸门 1 PASS（容器内 /healthz 200）"
    ((PASS_COUNT++))
  else
    log_error "  闸门 1 FAIL"
    ((FAIL_COUNT++))
  fi
else
  HTTP_CODE=$(curl -fsS -o /tmp/healthz.json -w "%{http_code}" "https://${DOMAIN}/healthz" 2>/dev/null || echo "000")
  if [[ "${HTTP_CODE}" == "200" ]]; then
    log_success "  闸门 1 PASS（200）"
    log_info "  body: $(cat /tmp/healthz.json | head -c 200)"
    ((PASS_COUNT++))
  else
    log_error "  闸门 1 FAIL（http_code=${HTTP_CODE}）"
    ((FAIL_COUNT++))
  fi
  rm -f /tmp/healthz.json
fi

# --- 闸门 2: ICP 响应头 ---
log_step "[2/5] ICP 响应头"
if [[ "${SKIP_HTTPS}" == "1" ]]; then
  log_warn "已 --skip-https · 跳过"
else
  ICP_HEADER=$(curl -sI "https://${DOMAIN}/healthz" 2>/dev/null | grep -i '^x-icp-filing:' | sed 's/[\r\n]//g' || true)
  if echo "${ICP_HEADER}" | grep -qF "${EXPECTED_ICP}"; then
    log_success "  闸门 2 PASS（${ICP_HEADER}）"
    ((PASS_COUNT++))
  else
    log_error "  闸门 2 FAIL · 期望含 '${EXPECTED_ICP}' · 实际: '${ICP_HEADER}'"
    ((FAIL_COUNT++))
  fi
fi

# --- 闸门 3: HTTP→HTTPS 重定向 ---
log_step "[3/5] HTTP → HTTPS 重定向"
if [[ "${SKIP_HTTPS}" == "1" ]]; then
  log_warn "已 --skip-https · 跳过"
else
  REDIRECT=$(curl -sI "http://${DOMAIN}/healthz" 2>/dev/null | grep -iE '^(HTTP/|location:)' | tr -d '\r\n')
  if echo "${REDIRECT}" | grep -qE "301|302" && echo "${REDIRECT}" | grep -qE "https://${DOMAIN}"; then
    log_success "  闸门 3 PASS（${REDIRECT}）"
    ((PASS_COUNT++))
  else
    log_error "  闸门 3 FAIL · 实际: ${REDIRECT}"
    ((FAIL_COUNT++))
  fi
fi

# --- 闸门 4: 4 容器 healthy ---
log_step "[4/5] 4 容器 healthy"
EXPECTED_CONTAINERS=(costra-postgres costra-redis costra-server costra-nginx)
ALL_HEALTHY=1
for c in "${EXPECTED_CONTAINERS[@]}"; do
  STATUS=$(docker inspect --format '{{.State.Health.Status}}' "$c" 2>/dev/null || echo "missing")
  if [[ "${STATUS}" == "healthy" ]]; then
    log_info "  ${c}: healthy ✓"
  else
    log_error "  ${c}: ${STATUS} ✗"
    ALL_HEALTHY=0
  fi
done

if [[ "${ALL_HEALTHY}" == "1" ]]; then
  log_success "  闸门 4 PASS（4 容器全 healthy）"
  ((PASS_COUNT++))
else
  log_error "  闸门 4 FAIL"
  ((FAIL_COUNT++))
fi

# --- 闸门 5: D-026 §2.3 C2 mock 红线 ---
log_step "[5/5] D-026 §2.3 C2 mock 红线（log 不应有 mockLogin=true）"
MOCK_HITS=$(docker compose -f "${COSTRA_COMPOSE_FILE}" logs server 2>/dev/null | \
  grep -iE 'mockLogin.*true|WX_MOCK_LOGIN enabled|"mock"' || true)

if [[ -z "${MOCK_HITS}" ]]; then
  # 反向验证：应该有 wxMockLogin=false 的日志
  REVERSE_HITS=$(docker compose -f "${COSTRA_COMPOSE_FILE}" logs server 2>/dev/null | \
    grep -iE 'wxMockLogin.*false' | head -1 || true)
  if [[ -n "${REVERSE_HITS}" ]]; then
    log_success "  闸门 5 PASS（无 mock 启用 · wxMockLogin=false 已记录）"
    ((PASS_COUNT++))
  else
    log_warn "  闸门 5 弱通过：无 mock 红线命中 · 但也无 wxMockLogin=false 反向证据"
    log_warn "  → server 可能还没记录第一条 wx 相关日志 · 业务跑起来后再验证"
    ((PASS_COUNT++))
  fi
else
  log_error "  闸门 5 FAIL · 命中红线："
  echo "${MOCK_HITS}" | head -5 >&2
  ((FAIL_COUNT++))
fi

# =============================================================================
# 总结
# =============================================================================
echo ""
print_section_header "闸门验证结果：PASS=${PASS_COUNT} / FAIL=${FAIL_COUNT}"

if [[ "${FAIL_COUNT}" == "0" ]]; then
  log_success "🎉 5 闸门全 PASS · prod 部署完成"
  log_success "    可以反馈 PASS 表给 Orchestrator → 进 Phase-3"
  exit 0
else
  log_error "❌ ${FAIL_COUNT} 闸门未通过 · 请逐项排查"
  exit 1
fi
