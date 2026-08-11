# shellcheck shell=bash
# =============================================================================
# Costra · prod bootstrap 脚本公共库（v1.5.1 · 2026-05-26）
# =============================================================================
# 用法：在每个脚本顶部 source 这个文件
#   SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
#   source "${SCRIPT_DIR}/lib/common.sh"
#
# 提供：
#   - 彩色日志：log_info / log_warn / log_error / log_step / log_success
#   - 交互工具：confirm / prompt / require_root
#   - 密码生成：gen_password (长度参数 · 默认 32)
#   - 工具检查：require_cmd
#   - 文件操作：backup_file / write_file_safe (chmod 0600)
#   - 全局变量：DRY_RUN / ASSUME_YES（由各脚本参数解析后设置）
# =============================================================================

# --- 严格模式 ---
set -Eeuo pipefail

# --- 颜色（仅 TTY 输出时启用）---
if [[ -t 1 ]]; then
  C_RED=$'\033[0;31m'
  C_GREEN=$'\033[0;32m'
  C_YELLOW=$'\033[0;33m'
  C_BLUE=$'\033[0;34m'
  C_CYAN=$'\033[0;36m'
  C_BOLD=$'\033[1m'
  C_RESET=$'\033[0m'
else
  C_RED='' C_GREEN='' C_YELLOW='' C_BLUE='' C_CYAN='' C_BOLD='' C_RESET=''
fi

# --- 全局开关（脚本可覆盖）---
: "${DRY_RUN:=0}"
: "${ASSUME_YES:=0}"

# --- 路径基线（从本文件位置自动派生 · 不硬编码 · 仍可被环境变量覆盖）---
# common.sh 固定位于 <项目根>/infra/scripts/lib/common.sh · 向上三级即项目根。
# 这样无论部署在 /root/Costra 还是开发机 / 任意目录，COSTRA_ROOT 都自解释、
# 永远等于仓库实际所在路径，杜绝硬编码路径与真实部署路径漂移。
# 若需覆盖（如非标准挂载），仍可通过环境变量 COSTRA_ROOT=... 传入（:= 会短路命令替换）。
_COMMON_LIB_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
if [[ -z "${COSTRA_ROOT:-}" ]]; then
  # 显式派生（失败即报错退出）· 比放进 ${:=} 命令替换更利于严格模式诊断。
  # 注：此处早于 die() 定义（见下文），故用内联 echo+exit。
  COSTRA_ROOT="$(cd "${_COMMON_LIB_DIR}/../../.." && pwd)" \
    || { echo "[common.sh] 派生 COSTRA_ROOT 失败（无法定位项目根）" >&2; exit 1; }
fi
: "${COSTRA_INFRA:=${COSTRA_ROOT}/infra}"
: "${COSTRA_DATA:=/data}"
: "${COSTRA_CONF_DIR:=${COSTRA_DATA}/conf}"
: "${COSTRA_ENV_FILE:=${COSTRA_CONF_DIR}/server.env}"
: "${COSTRA_COMPOSE_FILE:=${COSTRA_INFRA}/docker-compose.prod.yml}"
: "${COSTRA_COMPOSE_NET:=costra_default}"
: "${COSTRA_DOMAIN:=costra.cloud}"

# 验证库（replay-db.sh 拉起的隔离 PG 容器）的约定固定密码：
# 容器 --network none 完全隔离 · 不暴露端口 · 不接 prod 网络
# 这里只是脚本间共享的"团队约定值"，让 replay-db / psql-exec 走同一条命令路径
: "${VERIFY_PG_PW:=costra-verify}"

# --- 容器内进程 uid（修 redis 权限坑用）---
readonly UID_REDIS=999
readonly UID_POSTGRES=999
readonly UID_NODE=1000

# =============================================================================
# 日志函数
# =============================================================================
log_info()    { printf "${C_BLUE}[INFO]${C_RESET}    %s\n" "$*"; }
log_warn()    { printf "${C_YELLOW}[WARN]${C_RESET}    %s\n" "$*" >&2; }
log_error()   { printf "${C_RED}[ERROR]${C_RESET}   %s\n" "$*" >&2; }
log_success() { printf "${C_GREEN}[OK]${C_RESET}      %s\n" "$*"; }
log_step()    { printf "\n${C_BOLD}${C_CYAN}===> %s${C_RESET}\n" "$*"; }
log_dry()     { printf "${C_YELLOW}[DRY]${C_RESET}     %s\n" "$*"; }

# 错误退出（带行号）
die() {
  log_error "$*"
  exit 1
}

# trap 错误（脚本崩了告诉用户在哪一行）
on_error() {
  local lineno=$1
  log_error "脚本在第 ${lineno} 行失败 · 退出"
  exit 1
}
trap 'on_error ${LINENO}' ERR

# =============================================================================
# 执行工具（dry-run 兼容）
# =============================================================================
# run_cmd <cmd...>: dry-run 时只打印不执行
run_cmd() {
  if [[ "${DRY_RUN}" == "1" ]]; then
    log_dry "$*"
  else
    "$@"
  fi
}

# =============================================================================
# 交互工具
# =============================================================================
# confirm <prompt>: 询问 y/N · 默认 N · ASSUME_YES=1 时跳过
confirm() {
  local prompt="${1:-是否继续？}"
  if [[ "${ASSUME_YES}" == "1" ]]; then
    log_info "[--yes] ${prompt} → Y"
    return 0
  fi
  local reply
  read -rp "${prompt} [y/N] " reply
  [[ "${reply}" =~ ^[Yy]$ ]]
}

# prompt <var_name> <prompt> [default]: 提示输入到变量
prompt() {
  local var_name=$1 prompt_text=$2 default_val=${3:-}
  local reply
  if [[ -n "${default_val}" ]]; then
    read -rp "${prompt_text} [${default_val}]: " reply
    reply="${reply:-${default_val}}"
  else
    read -rp "${prompt_text}: " reply
  fi
  printf -v "${var_name}" '%s' "${reply}"
}

# prompt_secret <var_name> <prompt>: 提示输入密码（不回显）
prompt_secret() {
  local var_name=$1 prompt_text=$2
  local reply
  read -rsp "${prompt_text}: " reply
  echo
  printf -v "${var_name}" '%s' "${reply}"
}

# =============================================================================
# 工具检查
# =============================================================================
# require_root: 必须 root 跑
require_root() {
  if [[ ${EUID} -ne 0 ]]; then
    die "本脚本需要 root 权限 · 请用 sudo 或切到 root 用户"
  fi
}

# require_cmd <cmd> [<install_hint>]
require_cmd() {
  local cmd=$1 hint=${2:-}
  if ! command -v "${cmd}" >/dev/null 2>&1; then
    if [[ -n "${hint}" ]]; then
      die "缺少命令：${cmd} · 安装方法：${hint}"
    else
      die "缺少命令：${cmd}"
    fi
  fi
}

# require_file <path>
require_file() {
  local path=$1
  [[ -f "${path}" ]] || die "文件不存在：${path}"
}

# =============================================================================
# 密码生成（v1.5.1 · 修坑 1：tr -d 必须含 \n 否则输出两行）
# =============================================================================
# gen_password [length=32]: 输出指定字节数的随机字符串（base64 去 /+= 和 \n）
gen_password() {
  local bytes=${1:-32}
  openssl rand -base64 "${bytes}" | tr -d '/+=\n'
}

# =============================================================================
# 文件操作
# =============================================================================
# backup_file <path>: 加时间戳后缀备份
backup_file() {
  local src=$1
  if [[ -f "${src}" ]]; then
    local dst="${src}.bak.$(date +%Y%m%d-%H%M%S)"
    run_cmd cp "${src}" "${dst}"
    log_info "已备份: ${src} → ${dst}"
  fi
}

# write_file_safe <path> <mode> <content>: heredoc 安全写文件 + 设权限
# 用法：write_file_safe /data/conf/server.env 0600 "$content"
write_file_safe() {
  local path=$1 mode=$2 content=$3
  if [[ "${DRY_RUN}" == "1" ]]; then
    log_dry "写入 ${path} (mode=${mode}) · 内容 ${#content} 字节"
    return 0
  fi
  local dir
  dir=$(dirname "${path}")
  mkdir -p "${dir}"
  printf '%s' "${content}" > "${path}"
  chmod "${mode}" "${path}"
  log_success "已写入 ${path} (mode=${mode})"
}

# =============================================================================
# 通用参数解析
# =============================================================================
# 扫描全部 "$@"，把 --dry-run / -y / --yes 设置到 DRY_RUN / ASSUME_YES。
# 不认识的参数不报错（留给业务侧的 while case 处理）。
#
# 关键：扫描全部参数（不在第一个不认识的参数处 return），这样无论 -y 出现在
# 命令行哪个位置都能生效。例如：
#   ./redeploy.sh --scope server -y            # -y 在尾部
#   ./04-build-server.sh --mode local -y       # -y 在尾部
# 之前实现遇到 --git-pull / --mode 就 return，导致后置的 -y 被忽略 ·
# 是历史踩坑。
#
# 用法：
#   parse_common_args "$@"
#   # 之后业务侧自己 while 解析（业务侧 case 里把 -y/--yes/--dry-run 当 noop shift 掉即可）
parse_common_args() {
  while [[ $# -gt 0 ]]; do
    case "$1" in
      --dry-run) DRY_RUN=1; shift ;;
      -y|--yes)  ASSUME_YES=1; shift ;;
      *)         shift ;;  # 不认识的参数：跳过继续扫，不 return
    esac
  done
}

# =============================================================================
# 摘要 / 收尾
# =============================================================================
# print_section_header <title>
print_section_header() {
  local title=$1
  echo ""
  printf "${C_BOLD}${C_BLUE}╔══════════════════════════════════════════════════════════════════╗${C_RESET}\n"
  printf "${C_BOLD}${C_BLUE}║${C_RESET} %-64s ${C_BOLD}${C_BLUE}║${C_RESET}\n" "${title}"
  printf "${C_BOLD}${C_BLUE}╚══════════════════════════════════════════════════════════════════╝${C_RESET}\n"
}
