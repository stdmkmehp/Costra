#!/usr/bin/env bash
# =============================================================================
# Costra prod bootstrap · 主部署入口（编排 9 个步骤脚本）
# =============================================================================
# 对应手册：infra/prod-bootstrap-compose.md（v1.6 全流程）
#
# 9 个步骤：
#   01 preflight     · 前置检查（OS / Docker / 端口 / DNS）
#   02 prepare-dirs  · 建目录 + chown（修 redis 权限坑）
#   03 generate-env  · 生成密码 + 写 server.env（支持 --reuse-secrets）
#   04 build-server  · build server 镜像（local / load / registry）
#   05 start-stack   · 起 3 服务 + 等 healthy
#   06 migrate       · 跑 migrations（dump → migrate → verify）
#   07 issue-cert    · 签证书（webroot + 临时 nginx） + sed 取消 SSL 注释
#   08 finalize-nginx · nginx -t + up nginx + cron 续期
#   09 verify-gates  · 闸门 5 条验证
#
# 用法：
#
#   # 全新部署（首台机器）：
#   ./deploy-all.sh \
#       --email you@example.com \
#       --build-mode local \
#       --wx-app-secret '<32 字符密钥>'
#
#   # 备机部署（复用现有 server.env + 证书 + 用 registry 拉镜像）：
#   ./deploy-all.sh \
#       --reuse-secrets \
#       --use-existing-cert \
#       --build-mode registry \
#       --registry-image weizhao/costra-server:latest
#
#   # 从其他机器导入证书 + tar 加载镜像：
#   ./deploy-all.sh \
#       --reuse-secrets \
#       --import-cert /tmp/letsencrypt.tar.gz \
#       --build-mode load \
#       --image-tar /tmp/costra-server.tar.gz
#
#   # 跳过某些步骤（已经做过）：
#   ./deploy-all.sh --from 04   # 从 04 开始
#   ./deploy-all.sh --skip 01,02 # 跳过 01 / 02
#
# 选项：
#   --email <addr>             证书邮箱（首次签证必选）
#   --domain <name>            域名（默认 costra.cloud）
#   --reuse-secrets            复用现有 /data/conf/server.env
#   --wx-app-secret <val>      微信小程序密钥（透传给 03）
#   --use-existing-cert        复用现有 /etc/letsencrypt 证书
#   --import-cert <tar.gz>     从 tar 导入证书（隐含 --use-existing-cert）
#   --build-mode <local|load|registry>  build server 模式（默认 local）
#   --image-tar <path>         load 模式：tar.gz 路径
#   --registry-image <full>    registry 模式：完整镜像名
#   --from <01-09>             从指定步骤开始（之前的跳过）
#   --skip <01,02,...>         跳过指定步骤（逗号分隔）
#   --skip-cron                不写 cron（08 透传）
#   --skip-https               闸门验证跳过 https（09 透传）
#   --dry-run                  全程 dry-run
#   -y, --yes                  全程跳过确认
#   -h, --help                 显示此帮助
#
# 退出码：
#   0 = 全流程成功
#   1 = 任一步骤失败（已打印失败步骤）
# =============================================================================

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=lib/common.sh
source "${SCRIPT_DIR}/lib/common.sh"

# --- 参数 ---
EMAIL=""
DOMAIN="${COSTRA_DOMAIN}"
REUSE_SECRETS=0
WX_APP_SECRET=""
USE_EXISTING_CERT=0
IMPORT_CERT=""
BUILD_MODE="local"
IMAGE_TAR=""
REGISTRY_IMAGE=""
FROM_STEP=""
SKIP_STEPS=""
SKIP_CRON=0
SKIP_HTTPS=0

parse_common_args "$@"
while [[ $# -gt 0 ]]; do
  case "$1" in
    --email)              EMAIL=$2; shift 2 ;;
    --domain)             DOMAIN=$2; shift 2 ;;
    --reuse-secrets)      REUSE_SECRETS=1; shift ;;
    --wx-app-secret)      WX_APP_SECRET=$2; shift 2 ;;
    --use-existing-cert)  USE_EXISTING_CERT=1; shift ;;
    --import-cert)        IMPORT_CERT=$2; USE_EXISTING_CERT=1; shift 2 ;;
    --build-mode)         BUILD_MODE=$2; shift 2 ;;
    --image-tar)          IMAGE_TAR=$2; shift 2 ;;
    --registry-image)     REGISTRY_IMAGE=$2; shift 2 ;;
    --from)               FROM_STEP=$2; shift 2 ;;
    --skip)               SKIP_STEPS=$2; shift 2 ;;
    --skip-cron)          SKIP_CRON=1; shift ;;
    --skip-https)         SKIP_HTTPS=1; shift ;;
    --dry-run|-y|--yes)   shift ;;
    -h|--help)
      grep '^#' "$0" | sed 's/^# \{0,1\}//' | head -65
      exit 0
      ;;
    *) die "未知参数: $1 · 用 --help 查看" ;;
  esac
done

# --- 步骤映射 ---
declare -a STEPS=(
  "01:01-preflight.sh"
  "02:02-prepare-dirs.sh"
  "03:03-generate-env.sh"
  "04:04-build-server.sh"
  "05:05-start-stack.sh"
  "06:06-migrate.sh"
  "07:07-issue-cert.sh"
  "08:08-finalize-nginx.sh"
  "09:09-verify-gates.sh"
)

# 解析 skip 列表
SKIP_LIST=()
if [[ -n "${SKIP_STEPS}" ]]; then
  IFS=',' read -ra SKIP_LIST <<< "${SKIP_STEPS}"
fi

is_skipped() {
  local step=$1
  for s in "${SKIP_LIST[@]}"; do
    [[ "${s}" == "${step}" ]] && return 0
  done
  return 1
}

# --- 通用透传参数 ---
COMMON_FLAGS=()
[[ "${DRY_RUN}" == "1" ]]    && COMMON_FLAGS+=(--dry-run)
[[ "${ASSUME_YES}" == "1" ]] && COMMON_FLAGS+=(--yes)

# =============================================================================
# 主流程
# =============================================================================
print_section_header "Costra prod 部署主入口（v1.6 · 9 步全流程）"

log_info "domain         = ${DOMAIN}"
log_info "build mode     = ${BUILD_MODE}"
log_info "reuse secrets  = ${REUSE_SECRETS}"
log_info "use existing cert = ${USE_EXISTING_CERT}"
[[ -n "${FROM_STEP}" ]] && log_info "from step     = ${FROM_STEP}"
[[ -n "${SKIP_STEPS}" ]] && log_info "skip steps    = ${SKIP_STEPS}"
[[ "${DRY_RUN}" == "1" ]] && log_warn "DRY-RUN 模式 · 不真正执行命令"

if [[ "${ASSUME_YES}" != "1" ]]; then
  echo ""
  confirm "确认开始？" || die "用户取消"
fi

# --- 跳过 from 之前的步骤 ---
SKIP_BEFORE_FROM=1
if [[ -z "${FROM_STEP}" ]]; then
  SKIP_BEFORE_FROM=0
fi

# --- 逐步执行 ---
TOTAL_STEPS=${#STEPS[@]}
CURRENT=0

# 注意：bash `set -e` 下 `((var++))` 当 var 自增前为 0 时整条命令退出码为 1，
# 会触发 ERR trap。统一改用 `var=$((var + 1))` 形式（赋值语句退出码恒为 0）。

for entry in "${STEPS[@]}"; do
  IFS=':' read -r step_id script <<< "${entry}"
  CURRENT=$((CURRENT + 1))

  # from 跳过
  if [[ "${SKIP_BEFORE_FROM}" == "1" ]]; then
    if [[ "${step_id}" != "${FROM_STEP}" ]]; then
      log_warn "[${CURRENT}/${TOTAL_STEPS}] [${step_id}] 跳过（--from ${FROM_STEP}）"
      continue
    else
      SKIP_BEFORE_FROM=0
    fi
  fi

  # skip 列表
  if is_skipped "${step_id}"; then
    log_warn "[${CURRENT}/${TOTAL_STEPS}] [${step_id}] 跳过（--skip）"
    continue
  fi

  # 构造每个 step 的参数
  ARGS=("${COMMON_FLAGS[@]}")
  case "${step_id}" in
    01)
      ARGS+=(--domain "${DOMAIN}")
      ;;
    02)
      :
      ;;
    03)
      [[ "${REUSE_SECRETS}" == "1" ]] && ARGS+=(--reuse-secrets)
      [[ -n "${WX_APP_SECRET}" ]] && ARGS+=(--wx-app-secret "${WX_APP_SECRET}")
      [[ -n "${DOMAIN}" ]] && ARGS+=(--domain "${DOMAIN}")
      ;;
    04)
      ARGS+=(--mode "${BUILD_MODE}")
      [[ -n "${IMAGE_TAR}" ]] && ARGS+=(--image-tar "${IMAGE_TAR}")
      [[ -n "${REGISTRY_IMAGE}" ]] && ARGS+=(--registry-image "${REGISTRY_IMAGE}")
      ;;
    05|06)
      :
      ;;
    07)
      ARGS+=(--domain "${DOMAIN}")
      if [[ -n "${IMPORT_CERT}" ]]; then
        ARGS+=(--import-tar "${IMPORT_CERT}")
      elif [[ "${USE_EXISTING_CERT}" == "1" ]]; then
        ARGS+=(--use-existing)
      else
        [[ -n "${EMAIL}" ]] || die "07 (issue-cert) 需要 --email · 或加 --use-existing-cert / --import-cert"
        ARGS+=(--email "${EMAIL}")
      fi
      ;;
    08)
      [[ "${SKIP_CRON}" == "1" ]] && ARGS+=(--skip-cron)
      ;;
    09)
      ARGS+=(--domain "${DOMAIN}")
      [[ "${SKIP_HTTPS}" == "1" ]] && ARGS+=(--skip-https)
      ;;
  esac

  log_step "[${CURRENT}/${TOTAL_STEPS}] [${step_id}] ${script} ${ARGS[*]}"

  if ! "${SCRIPT_DIR}/${script}" "${ARGS[@]}"; then
    log_error "[${step_id}] 步骤失败 · 终止部署"
    log_error "可以单独重跑这一步：${SCRIPT_DIR}/${script} ${ARGS[*]}"
    log_error "也可以 --from ${step_id} 从这一步重新开始"
    exit 1
  fi

  log_success "[${step_id}] 步骤完成"
done

# =============================================================================
# 总结
# =============================================================================
echo ""
print_section_header "🎉 全流程完成"
log_success "Costra prod 已部署 · 入口 https://${DOMAIN}"
log_info "下一步建议："
log_info "  - 浏览器访问 https://${DOMAIN}/healthz 二次验证"
log_info "  - 检查 docker compose ps 4 容器全 healthy"
log_info "  - 进 Phase-3 测试"
exit 0
