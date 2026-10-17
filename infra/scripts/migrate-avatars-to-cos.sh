#!/usr/bin/env bash
# =============================================================================
# Costra · 存量头像迁移 COS（两段式：预搬 + 切指针 · 运维入口）
# =============================================================================
# 事实源：docs/design/cos-offload-phase2-avatar.md v1.6 §8（迁移与回退）/ §11（上线顺序）
#
# 职责：
#   - upload  预搬：候选行本地文件 → COS 全量覆盖（不写 DB · 可反复执行 · 跑崩重跑）
#   - switch  切指针：只 UPDATE users.avatar_url → COS URL（秒级 · 重跑幂等）
#   - verify  只读对账：域名白名单 + 对象存在性 + LastModified 不早于本地 mtime
#   - revert  回退：仅把"指针精确等于切换时写入串"的行改回本地 URL（观察期内有效）
#
# 双层形态（§8.1 · 对"SQL 内联"公约的显式偏离及理由）：
#   本脚本 = 运维入口层：参数解析 / 防呆 / 真实目标回显 / confirm / dry-run 透传 / 退出码。
#   server/scripts/migrate-avatars-to-cos.ts = 能力实现层：候选集（DB）→ 读本地文件 →
#   putObject（节流）→ headObject 复核 → UPDATE users。迁移必须 putObject 到 COS，
#   凭据读取 / SDK 单例 / ContentType·CacheControl 设置都在 cosClient.ts 里，
#   纯 bash 实现须引入 coscmd/coscli 新依赖并再传一遍密钥——更差，故双层。
#   仍满足"不直连 DATABASE_URL"本意：TS 在 server 容器内跑、用容器自己的注入配置。
#
# 候选集纪律（§8.0.1 · v1.2 核心修正）：候选集 = users.avatar_url 仍指本地的行
#   （DB 驱动，绝不目录驱动——代码部署后本地盘冻结，目录驱动会拿旧图盖新图）。
#
# 执行时机（§11 · v1.4）：代码部署之后。预搬/切指针/回退全部运行在
#   "新镜像已在跑"的状态，docker exec 委托形态对所有阶段成立。
#
# dry-run 语义（§8.1）：本脚本属只读预演（查候选集 / 列缺源行 / 算总字节 / 报耗时），
#   --dry-run 透传给 TS 真正跑一遍（不 putObject、不 UPDATE），而非跳过整条 docker exec。
#
# 用法：
#   ./migrate-avatars-to-cos.sh --dry-run                     # 预演：候选集/缺源/总字节/耗时
#   ./migrate-avatars-to-cos.sh --upload-only                 # 预搬（默认节流 200ms · 约 36s）
#   ./migrate-avatars-to-cos.sh --upload-only --sleep-ms 500  # 更保守
#   ./migrate-avatars-to-cos.sh --switch-only --limit 10      # 切指针灰度：先 10 行
#   ./migrate-avatars-to-cos.sh --switch-only                 # 全量（候选集自动剔除已切行）
#   ./migrate-avatars-to-cos.sh --verify                      # 只读对账
#   ./migrate-avatars-to-cos.sh --revert --base https://costra.cloud   # 回退（观察期内）
#
# 退出码：
#   0 = 成功
#   1 = 失败 / 校验不一致 / 用户取消
# =============================================================================

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=lib/common.sh
source "${SCRIPT_DIR}/lib/common.sh"

# --- 默认参数 ---
MODE=""                 # upload | switch | verify | revert
SLEEP_MS=200            # 默认节流 200ms/文件（§8.3 决策 D6 · 约 36s · 占出口约 18%）
LIMIT=""                # --limit N · 切指针灰度用
BASE=""                 # --revert 的本机 URL 前缀（显式传入不猜 · §8.7）
SERVER_CONTAINER="costra-server"

# --- 解析参数 ---
parse_common_args "$@"
while [[ $# -gt 0 ]]; do
  case "$1" in
    --upload-only) MODE="upload"; shift ;;
    --switch-only) MODE="switch"; shift ;;
    --revert)      MODE="revert"; shift ;;
    --verify)      MODE="verify"; shift ;;
    --sleep-ms)
      [[ $# -ge 2 ]] || die "--sleep-ms 需要一个值（毫秒 · 非负整数）"
      SLEEP_MS=$2
      shift 2
      ;;
    --limit)
      [[ $# -ge 2 ]] || die "--limit 需要一个值（正整数）"
      LIMIT=$2
      shift 2
      ;;
    --base)
      [[ $# -ge 2 ]] || die "--base 需要一个值（如 https://costra.cloud）"
      BASE=$2
      shift 2
      ;;
    --dry-run|-y|--yes) shift ;;  # common 已处理 · noop
    -h|--help)
      grep '^#' "$0" | sed 's/^# \{0,1\}//' | head -42
      exit 0
      ;;
    *)
      die "未知参数: $1 · 用 --help 查看"
      ;;
  esac
done

# --- 校验 ---
require_root
require_cmd docker
[[ -n "${MODE}" ]] || die "必须指定模式：--upload-only | --switch-only | --verify | --revert（--help 查看）"
[[ "${SLEEP_MS}" =~ ^[0-9]+$ ]] || die "--sleep-ms 必须是非负整数 · got: ${SLEEP_MS}"
if [[ -n "${LIMIT}" ]]; then
  [[ "${LIMIT}" =~ ^[0-9]+$ ]] && [[ "${LIMIT}" -ge 1 ]] || die "--limit 必须是正整数 · got: ${LIMIT}"
fi
if [[ "${MODE}" == "revert" && -z "${BASE}" ]]; then
  die "--revert 必须配 --base（本机 URL 前缀 · 显式传入不猜 · §8.7）"
fi
require_file "${COSTRA_ENV_FILE}"

# 前置（§8.1 · 早失败）：server.env 必须已配头像桶两键
COS_BUCKET_AVATARS_V=$(grep '^COS_BUCKET_AVATARS=' "${COSTRA_ENV_FILE}" | cut -d= -f2- || true)
COS_AVATAR_BASE_V=$(grep '^COS_AVATAR_BASE=' "${COSTRA_ENV_FILE}" | cut -d= -f2- || true)
[[ -n "${COS_BUCKET_AVATARS_V}" ]] || die "${COSTRA_ENV_FILE} 未配置 COS_BUCKET_AVATARS（二期 §11 步 0 · infra/cos-setup.md §7）"
[[ -n "${COS_AVATAR_BASE_V}" ]] || die "${COSTRA_ENV_FILE} 未配置 COS_AVATAR_BASE（二期 §11 步 0 · infra/cos-setup.md §7）"

# 容器必须在跑（dry-run 也要跑 TS 只读预演 · 故不做 dry-run 豁免）
STATUS=$(docker inspect --format '{{.State.Status}}' "${SERVER_CONTAINER}" 2>/dev/null || echo "missing")
[[ "${STATUS}" == "running" ]] \
  || die "${SERVER_CONTAINER} 不在运行（status=${STATUS}）· 请先跑 ./05-start-stack.sh（§8.1：新镜像部署后本脚本才可用）"

# =============================================================================
# 确认（如实回显真实目标 · 不做域名字符串启发式 · §8.1）
# =============================================================================
print_section_header "🖼  Costra · migrate-avatars-to-cos (${MODE})"

log_info "容器      : ${SERVER_CONTAINER}（docker exec tsx · 容器内读自身注入配置）"
log_info "候选集    : users 表中 avatar_url 仍指本地的行（DB 驱动 · §8.0.1 谓词）"
log_info "本地目录  : ${COSTRA_DATA}/uploads/avatars（宿主机视角 · bind mount 另一侧 · 供人工核对）"
log_info "目标桶    : ${COS_BUCKET_AVATARS_V}（server.env 原值）"
log_info "目标域名  : ${COS_AVATAR_BASE_V}（server.env 原值 · 候选集谓词 \$1 透传 TS）"
if [[ "${MODE}" == "upload" ]]; then
  log_info "节流      : ${SLEEP_MS}ms/文件（候选集 N 行与预计耗时由 TS 打印 · §8.3 量级：180 行约 36s）"
fi
if [[ -n "${LIMIT}" ]]; then
  log_info "LIMIT     : 本次最多处理 ${LIMIT} 行（切指针灰度）"
fi
if [[ "${MODE}" == "revert" ]]; then
  log_info "回退目标  : ${BASE}/uploads/avatars/<uuid>.<ext>?v=<mtimeMs>（仅精确匹配切换时写入串的行 · §8.7）"
fi
echo ""

# 碰 DB 的模式（switch / revert）才高危确认；upload 与 verify 不改 DB，可免（§8.1）
if [[ "${MODE}" == "switch" || "${MODE}" == "revert" ]]; then
  log_warn "⚠️  将修改 users.avatar_url · 强烈建议先跑 ./backup-db.sh"
  confirm "确认对上述目标执行 ${MODE}？" || die "用户取消"
fi

if [[ "${DRY_RUN}" == "1" ]]; then
  log_warn "DRY-RUN 模式 · TS 只读预演（不 putObject、不 UPDATE）"
fi

# =============================================================================
# 委托容器内 TS（dry-run 透传 · 不是跳过整条 docker exec · §8.1）
# =============================================================================
TS_ARGS=(--mode "${MODE}" --cos-base "${COS_AVATAR_BASE_V}" --sleep-ms "${SLEEP_MS}")
[[ -n "${LIMIT}" ]] && TS_ARGS+=(--limit "${LIMIT}")
[[ -n "${BASE}" ]] && TS_ARGS+=(--base "${BASE}")
[[ "${DRY_RUN}" == "1" ]] && TS_ARGS+=(--dry-run)

log_step "委托 ${SERVER_CONTAINER} 内 migrate-avatars-to-cos.ts（${MODE}）"

ts_exit=0
docker exec "${SERVER_CONTAINER}" \
  node_modules/.bin/tsx scripts/migrate-avatars-to-cos.ts "${TS_ARGS[@]}" || ts_exit=$?
[[ "${ts_exit}" -eq 0 ]] || die "迁移执行失败（exit=${ts_exit}）· 详见上方 TS 输出"

# =============================================================================
# 总结
# =============================================================================
echo ""
print_section_header "✅ migrate-avatars-to-cos (${MODE}) 完成"
if [[ "${MODE}" == "upload" ]]; then
  log_info "下一步：./migrate-avatars-to-cos.sh --switch-only --limit 10（灰度）→ 全量 → --verify"
fi

exit 0
