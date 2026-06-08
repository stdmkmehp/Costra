#!/usr/bin/env bash
# =============================================================================
# Costra prod bootstrap · §4.1 build server 镜像
# =============================================================================
# 对应手册：infra/prod-bootstrap-compose.md §4.1（A/B/C 三方案）
#
# v1.5.1 实测踩坑：2核2G prod 机器 build 4000s+ 不完成。本脚本支持 3 种模式：
#
#   - local   : 本地 build · 适合 build 机器规格 ≥4 核 4G
#   - load    : 从 tar.gz 加载（其他机器 build 后 scp 过来）
#   - registry: 从镜像仓库 pull（Docker Hub / 腾讯云 TCR）
#
# 用法：
#   ./04-build-server.sh --mode local
#   ./04-build-server.sh --mode load --image-tar /tmp/costra-server.tar.gz
#   ./04-build-server.sh --mode registry --registry-image weizhao/costra-server:latest
#
# 选项：
#   --mode <local|load|registry>    （必选）
#   --image-tar <path>              load 模式：镜像 tar.gz 路径
#   --registry-image <full-name>    registry 模式：完整镜像名（含仓库前缀）
#   --platform <linux/amd64>        local 模式：指定 build 平台（Apple Silicon Mac 必选）
#   --tag <tag>                     local 模式：镜像 tag（默认 costra-server:latest）
#   --dry-run / -y / --help
#
# 退出码：
#   0 = 镜像就绪（docker images 能查到 costra-server 或目标镜像）
# =============================================================================

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=lib/common.sh
source "${SCRIPT_DIR}/lib/common.sh"

# --- 默认参数 ---
MODE=""
IMAGE_TAR=""
REGISTRY_IMAGE=""
PLATFORM=""
IMAGE_TAG="costra-server:latest"

# --- 解析参数 ---
parse_common_args "$@"
while [[ $# -gt 0 ]]; do
  case "$1" in
    --mode)              MODE=$2; shift 2 ;;
    --image-tar)         IMAGE_TAR=$2; shift 2 ;;
    --registry-image)    REGISTRY_IMAGE=$2; shift 2 ;;
    --platform)          PLATFORM=$2; shift 2 ;;
    --tag)               IMAGE_TAG=$2; shift 2 ;;
    --dry-run|-y|--yes)  shift ;;
    -h|--help)
      grep '^#' "$0" | head -32
      exit 0
      ;;
    *) die "未知参数: $1 · 用 --help 查看" ;;
  esac
done

[[ -z "${MODE}" ]] && die "必须指定 --mode local|load|registry"

require_cmd docker

# =============================================================================
# 主流程
# =============================================================================
print_section_header "04 · build server 镜像（§4.1）· mode=${MODE}"

case "${MODE}" in

  # ============================================================
  # 模式 A: 本地 build（仅适合 ≥4 核 4G 机器）
  # ============================================================
  local)
    log_step "[local] docker compose build server"

    # 警告小机器
    MEM_GB=$(free -g 2>/dev/null | awk '/^Mem:/{print $2}' || echo "?")
    if [[ "${MEM_GB}" =~ ^[0-9]+$ ]] && [[ "${MEM_GB}" -lt 4 ]]; then
      log_warn "本机内存仅 ${MEM_GB}G · v1.5.1 实测 2G 机器 build 4000s+ 不完成"
      log_warn "建议改用 --mode load 或 --mode registry"
      if [[ "${ASSUME_YES}" != "1" ]]; then
        confirm "仍要本地 build？" || die "用户取消"
      fi
    fi

    require_file "${COSTRA_COMPOSE_FILE}"
    cd "${COSTRA_INFRA}"

    BUILD_ARGS=()
    [[ -n "${PLATFORM}" ]] && BUILD_ARGS+=(--build-arg "TARGETPLATFORM=${PLATFORM}")

    if [[ -n "${PLATFORM}" ]]; then
      log_info "使用 buildx · 平台 ${PLATFORM}"
      run_cmd docker buildx build --platform "${PLATFORM}" \
        -f "${COSTRA_ROOT}/server/Dockerfile" \
        -t "${IMAGE_TAG}" \
        "${COSTRA_ROOT}/server"
    else
      run_cmd docker compose -f "${COSTRA_COMPOSE_FILE}" build server
    fi
    ;;

  # ============================================================
  # 模式 B: 从 tar.gz 加载（跨机构建 + scp）
  # ============================================================
  load)
    [[ -z "${IMAGE_TAR}" ]] && die "load 模式必须指定 --image-tar <path>"
    require_file "${IMAGE_TAR}"

    log_step "[load] 从 ${IMAGE_TAR} 加载镜像"
    log_info "tar 大小: $(ls -lh "${IMAGE_TAR}" | awk '{print $5}')"

    if [[ "${IMAGE_TAR}" == *.gz ]]; then
      run_cmd bash -c "gunzip -c '${IMAGE_TAR}' | docker load"
    else
      run_cmd docker load -i "${IMAGE_TAR}"
    fi
    ;;

  # ============================================================
  # 模式 C: 从镜像仓库 pull
  # ============================================================
  registry)
    [[ -z "${REGISTRY_IMAGE}" ]] && die "registry 模式必须指定 --registry-image <full-name>"

    log_step "[registry] docker pull ${REGISTRY_IMAGE}"

    # 检查 docker 是否登录目标仓库（私有仓库需要）
    log_info "如果是 private 仓库 · 请先 docker login"

    run_cmd docker pull "${REGISTRY_IMAGE}"

    # 给本地打 costra-server:latest tag · 让 compose 可以直接用
    if [[ "${REGISTRY_IMAGE}" != "${IMAGE_TAG}" ]]; then
      log_info "tag ${REGISTRY_IMAGE} → ${IMAGE_TAG}"
      run_cmd docker tag "${REGISTRY_IMAGE}" "${IMAGE_TAG}"
    fi
    ;;

  *)
    die "未知 mode: ${MODE}（应为 local | load | registry）"
    ;;
esac

# --- 验证镜像在位 ---
if [[ "${DRY_RUN}" != "1" ]]; then
  log_step "验证镜像"
  if docker images --format '{{.Repository}}:{{.Tag}}' | grep -qFx "${IMAGE_TAG}"; then
    SIZE=$(docker images --format '{{.Repository}}:{{.Tag}} {{.Size}}' | grep -F "${IMAGE_TAG}" | awk '{print $2}')
    log_success "镜像 ${IMAGE_TAG} 已就绪（${SIZE}）"
  else
    die "镜像 ${IMAGE_TAG} 没找到 · 请检查上一步输出"
  fi
fi

# =============================================================================
# 总结
# =============================================================================
echo ""
log_success "server 镜像就绪 · 可以进入 §4.2 (05-start-stack.sh)"
exit 0
