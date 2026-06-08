#!/usr/bin/env bash
# =============================================================================
# Costra prod bootstrap · §3.1+§3.4 生成密码 + 写 server.env
# =============================================================================
# 对应手册：infra/prod-bootstrap-compose.md §3.1 + §3.4
#
# 三种使用模式：
#
#   1. 全新生成（默认）：
#      ./03-generate-env.sh
#      → 自动生成 PG/Redis/JWT 三个密码 · 提示输入 WX_APP_SECRET → 写 server.env
#
#   2. 复用现有 server.env（机器迁移 / 重新部署）：
#      ./03-generate-env.sh --reuse-secrets
#      → 必须 /data/conf/server.env 已存在 · 不重生成密码 · 仅校验完整性
#
#   3. 非交互模式（CI / 自动化）：
#      ./03-generate-env.sh --wx-app-secret xxx --pg-pw 'aaa' --redis-pw 'bbb' --jwt-secret 'ccc'
#      → 全部参数从命令行传入 · 不交互
#
# 用法：
#   ./03-generate-env.sh [选项]
#
# 选项：
#   --reuse-secrets           复用现有 server.env（不重生成密码）
#   --wx-app-secret <val>     微信小程序密钥（默认交互输入）
#   --pg-pw <val>             指定 PG 密码（默认随机生成）
#   --redis-pw <val>          指定 Redis 密码（默认随机生成）
#   --jwt-secret <val>        指定 JWT 密钥（默认随机生成）
#   --wx-app-id <val>         微信小程序 AppID（默认 wxf8b0d3e3a83f9941）
#   --domain <val>            ICP 备案对应域名（默认 costra.cloud）
#   --dry-run                 只打印不写文件
#   -y, --yes                 跳过确认提示
#   -h, --help                显示帮助
#
# 退出码：
#   0 = server.env 就绪
#   1 = 失败
# =============================================================================

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=lib/common.sh
source "${SCRIPT_DIR}/lib/common.sh"

# --- 默认参数 ---
REUSE_SECRETS=0
WX_APP_SECRET=""
PG_COSTRA_PW=""
REDIS_PW=""
JWT_SECRET=""
WX_APP_ID="wxf8b0d3e3a83f9941"
DOMAIN_ARG="${COSTRA_DOMAIN}"
ICP_FILING_NUMBER="沪ICP备2026017253号-2"

# --- 解析参数 ---
parse_common_args "$@"
while [[ $# -gt 0 ]]; do
  case "$1" in
    --reuse-secrets)   REUSE_SECRETS=1; shift ;;
    --wx-app-secret)   WX_APP_SECRET=$2; shift 2 ;;
    --pg-pw)           PG_COSTRA_PW=$2; shift 2 ;;
    --redis-pw)        REDIS_PW=$2; shift 2 ;;
    --jwt-secret)      JWT_SECRET=$2; shift 2 ;;
    --wx-app-id)       WX_APP_ID=$2; shift 2 ;;
    --domain)          DOMAIN_ARG=$2; shift 2 ;;
    --dry-run|-y|--yes) shift ;;
    -h|--help)
      grep '^#' "$0" | head -45
      exit 0
      ;;
    *) die "未知参数: $1 · 用 --help 查看用法" ;;
  esac
done

require_root
require_cmd openssl

# =============================================================================
# 主流程
# =============================================================================
print_section_header "03 · 生成密码 + 写 server.env（§3.1+§3.4）"

# --- 模式 A: 复用现有 server.env ---
if [[ "${REUSE_SECRETS}" == "1" ]]; then
  log_step "[复用模式] 校验 ${COSTRA_ENV_FILE}"

  if [[ ! -f "${COSTRA_ENV_FILE}" ]]; then
    die "未找到 ${COSTRA_ENV_FILE} · 不能 --reuse-secrets · 请先全新生成"
  fi

  # 校验关键字段都在
  REQUIRED_KEYS=(
    NODE_ENV PORT TZ
    PG_COSTRA_PW REDIS_PW
    DATABASE_URL REDIS_URL
    JWT_SECRET JWT_ISSUER JWT_AUDIENCE
    WX_APP_ID WX_APP_SECRET WX_MOCK_LOGIN
    ICP_FILING_NUMBER
  )

  MISSING_KEYS=()
  for key in "${REQUIRED_KEYS[@]}"; do
    if ! grep -q "^${key}=" "${COSTRA_ENV_FILE}"; then
      MISSING_KEYS+=("${key}")
    fi
  done

  if [[ ${#MISSING_KEYS[@]} -gt 0 ]]; then
    log_error "现有 server.env 缺少字段：${MISSING_KEYS[*]}"
    die "请删除/修复 ${COSTRA_ENV_FILE} 后重跑（不带 --reuse-secrets）"
  fi

  # 校验 WX_MOCK_LOGIN=0（D-026 §2.3 C2 红线）
  WX_MOCK_VAL=$(grep '^WX_MOCK_LOGIN=' "${COSTRA_ENV_FILE}" | cut -d= -f2)
  if [[ "${WX_MOCK_VAL}" != "0" ]]; then
    die "WX_MOCK_LOGIN=${WX_MOCK_VAL} · prod 必须 =0（D-026 §2.3 C2 红线）"
  fi

  # 校验占位符全部已替换
  if grep -qE '\[(PG_COSTRA_PW|REDIS_PW|JWT_SECRET|WX_APP_SECRET)\]' "${COSTRA_ENV_FILE}"; then
    die "${COSTRA_ENV_FILE} 仍含占位符 · 必须先用真实值替换"
  fi

  # 严格权限
  CURRENT_MODE=$(stat -c '%a' "${COSTRA_ENV_FILE}")
  if [[ "${CURRENT_MODE}" != "600" ]]; then
    log_warn "${COSTRA_ENV_FILE} 权限是 ${CURRENT_MODE} · 修正为 0600"
    run_cmd chmod 0600 "${COSTRA_ENV_FILE}"
  fi

  log_success "现有 server.env 校验通过 · 复用 (${#REQUIRED_KEYS[@]} 字段全)"
  exit 0
fi

# --- 模式 B: 全新生成 ---
log_step "[1/4] 生成密码（如未通过参数指定）"

[[ -z "${PG_COSTRA_PW}" ]] && PG_COSTRA_PW=$(gen_password 32)
[[ -z "${REDIS_PW}" ]]    && REDIS_PW=$(gen_password 32)
[[ -z "${JWT_SECRET}" ]]  && JWT_SECRET=$(gen_password 64)

log_success "PG_COSTRA_PW: ${#PG_COSTRA_PW} 字符（已生成 · 不打印明文）"
log_success "REDIS_PW    : ${#REDIS_PW} 字符（已生成 · 不打印明文）"
log_success "JWT_SECRET  : ${#JWT_SECRET} 字符（已生成 · 不打印明文）"

# --- 步骤 2: WX_APP_SECRET（交互或参数）---
log_step "[2/4] 输入 WX_APP_SECRET（微信公众平台 → 开发管理 → 重置 AppSecret）"

if [[ -z "${WX_APP_SECRET}" ]]; then
  if [[ "${ASSUME_YES}" == "1" ]]; then
    die "--yes 模式下必须通过 --wx-app-secret 提供 · 拒绝从 stdin 读"
  fi
  log_warn "命令前留空格防 history 泄漏（HISTCONTROL=ignorespace 默认开）"
  prompt_secret WX_APP_SECRET "请输入 WX_APP_SECRET（32 字符 · 不回显）"
fi

if [[ ${#WX_APP_SECRET} -ne 32 ]]; then
  log_warn "WX_APP_SECRET 长度=${#WX_APP_SECRET}（期望 32）· 但仍继续 · 微信偶尔有变体"
  if [[ "${ASSUME_YES}" != "1" ]]; then
    confirm "确认继续？" || die "用户取消"
  fi
fi

log_success "WX_APP_SECRET: ${#WX_APP_SECRET} 字符（不打印明文）"

# --- 步骤 3: 输出密码备份提示（最重要的运维动作）---
log_step "[3/4] 备份提示（重要：以下密码必须立刻存到密码管理器）"

cat <<EOF

  ┌────────────────────────────────────────────────────────────────────┐
  │  ⚠️  以下密码即将写入 ${COSTRA_ENV_FILE}                  │
  │                                                                    │
  │  立即抄到密码管理器（1Password / Bitwarden / Apple 钥匙串）：       │
  │                                                                    │
  │    PG_COSTRA_PW = ${PG_COSTRA_PW}
  │    REDIS_PW     = ${REDIS_PW}
  │    JWT_SECRET   = ${JWT_SECRET}
  │    WX_APP_SECRET = (你刚输入的 / 已存)                              │
  │                                                                    │
  │  写完后清屏 (clear) · 命令历史也建议 history -c                     │
  └────────────────────────────────────────────────────────────────────┘
EOF

if [[ "${ASSUME_YES}" != "1" ]]; then
  confirm "已抄录到密码管理器 · 继续写 server.env？" || die "用户取消"
fi

# --- 步骤 4: 写 server.env ---
log_step "[4/4] 写 ${COSTRA_ENV_FILE}（mode 0600）"

# 备份现有文件
backup_file "${COSTRA_ENV_FILE}"

# 拼接内容
ENV_CONTENT=$(cat <<EOF
# Costra prod 环境变量（v1.5.1 · 由 03-generate-env.sh 生成 · $(date '+%Y-%m-%d %H:%M:%S')）
# 由 docker compose env_file 注入
# 注意：DATABASE_URL / REDIS_URL 的 host 字段在 docker-compose.prod.yml 中被覆盖为 service name

# === 进程基础 ===
NODE_ENV=production
PORT=8080
TZ=Asia/Shanghai

# === 容器间 DB 连接（compose 用 \${PG_COSTRA_PW} \${REDIS_PW} 替换 host 字段）===
PG_COSTRA_PW=${PG_COSTRA_PW}
REDIS_PW=${REDIS_PW}

# === DATABASE_URL / REDIS_URL（compose env block 会 override host · 这里写完整版供 server 兜底）===
DATABASE_URL=postgres://costra:${PG_COSTRA_PW}@postgres:5432/costra
REDIS_URL=redis://:${REDIS_PW}@redis:6379

# === JWT ===
JWT_SECRET=${JWT_SECRET}
JWT_ISSUER=https://${DOMAIN_ARG}
JWT_AUDIENCE=costra-miniapp

# === 微信 ===
WX_APP_ID=${WX_APP_ID}
WX_APP_SECRET=${WX_APP_SECRET}

# === D-026 §2.3 C2 mock 防护红线（prod 必须 0）===
WX_MOCK_LOGIN=0

# === ICP ===
ICP_FILING_NUMBER=${ICP_FILING_NUMBER}
EOF
)

write_file_safe "${COSTRA_ENV_FILE}" 0600 "${ENV_CONTENT}"

# --- 验证 ---
if [[ "${DRY_RUN}" != "1" ]]; then
  FIELD_COUNT=$(grep -c '^[A-Z_]\+=' "${COSTRA_ENV_FILE}")
  if [[ "${FIELD_COUNT}" -lt 13 ]]; then
    die "字段数 ${FIELD_COUNT} < 13 · 写入异常"
  fi
  log_success "字段数: ${FIELD_COUNT}（≥13 ✓）"

  if grep -q '^WX_MOCK_LOGIN=0$' "${COSTRA_ENV_FILE}"; then
    log_success "WX_MOCK_LOGIN=0 ✓（D-026 §2.3 C2 红线）"
  else
    die "WX_MOCK_LOGIN 未设为 0"
  fi

  if grep -qE '\[' "${COSTRA_ENV_FILE}"; then
    die "仍含占位符 · 写入异常"
  fi
  log_success "无占位符残留 ✓"
fi

# =============================================================================
# 总结
# =============================================================================
echo ""
log_success "server.env 就绪 · 可以进入 §4 (04-build-server.sh)"
log_warn "再次提醒：密码已抄录到密码管理器了吗？没抄就 cat ${COSTRA_ENV_FILE}（mode 0600 · 仅 root 可读）"
exit 0
