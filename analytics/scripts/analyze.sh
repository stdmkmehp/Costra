#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# scripts/analyze.sh · 宿主机薄 wrapper
# 宿主机只负责启动独立 compose 并进入 analyzer 容器执行真正分析。
# 按需启停：分析跑完（无论成败）立即 docker compose stop，释放资源给
# 同机 staging 栈与 standby 从库；下次运行由本脚本重新 up。
#
# 用法:
#   ./analyze.sh [选项]
#
# 选项:
#   --dump   <file>    指定 dump 文件路径（默认: DUMP_INBOX 内 mtime 最新的 .sql.gz）
#   --window <dur>     统计周期 / 分析窗口时长（默认: 24h）
#                      格式: <数字><单位>，单位: m(分钟) h(小时) d(天)
#                      示例: 24h → 最近 24 小时
#                            7d  → 最近 7 天
#                            30d → 最近 30 天
#                            15m → 最近 15 分钟（调试用）
#   --anchor <ISO>     分析窗口的右端时间点（默认: dump 文件的 mtime）
#                      必须为带时区的 ISO 8601 格式
#                      例如: 2026-07-21T23:59:00+08:00
#   --stdout           强制将报告输出到 stdout，不发送邮件（调试/验收用）
#   -h, --help         显示帮助信息
#
# 统计周期说明:
#   分析窗口 = [anchor - window, anchor)
#   即以 anchor 为右端点，向前推 window 时长作为统计范围（右端点不包含）。
#   - 若未指定 --anchor，默认使用 dump 文件的修改时间作为右端点。
#   - 若未指定 --window，默认统计最近 24 小时。
#
# 示例:
#   # 默认：最新 dump · 最近 24h
#   ./analyze.sh
#
#   # 统计最近 7 天
#   ./analyze.sh --window 7d
#
#   # 统计最近 30 天
#   ./analyze.sh --window 30d
#
#   # 指定截止时间，回看该时间点之前 24h
#   ./analyze.sh --window 24h --anchor 2026-07-15T23:59:00+08:00
#
#   # 完整指定：dump 文件 + 统计周期 + 锚点
#   ./analyze.sh --dump /path/to/dump.sql.gz --window 7d --anchor 2026-07-21T21:17:23+08:00
#
#   # stdout 模式（不发邮件，直接输出报告）
#   ./analyze.sh --stdout --window 7d
#
#环境变量（需在 analytics/.env 中配置）:
#   DUMP_INBOX   dump 文件存放目录
#   REPORTS_DIR  生成报告的输出目录
#   LOG_DIR      日志目录（可选，默认: analytics/logs）
# ─────────────────────────────────────────────────────────────────────────────
set -Eeuo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ANALYZE_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"

# shellcheck source=lib/common.sh
source "${SCRIPT_DIR}/lib/common.sh"

ENV_FILE="${ANALYZE_ROOT}/.env"
require_env_file "${ENV_FILE}"
load_env "${ENV_FILE}"

: "${DUMP_INBOX:?需要设置 DUMP_INBOX}"
: "${REPORTS_DIR:?需要设置 REPORTS_DIR}"
LOG_DIR="${LOG_DIR:-${ANALYZE_ROOT}/logs}"

mkdir -p "${DUMP_INBOX}" "${REPORTS_DIR}" "${LOG_DIR}"

compose() {
  if docker compose version >/dev/null 2>&1; then
    docker compose "$@"
  elif command -v docker-compose >/dev/null 2>&1; then
    docker-compose "$@"
  else
    die "依赖命令不存在: docker compose 或 docker-compose"
  fi
}

cd "${ANALYZE_ROOT}"

# 按需启停：分析完成后立即 stop 两个容器，释放 CPU/内存给同机 staging 栈与
# standby 从库（三栈并存 · 见 docs/ops/pg-standby-backup.md §2.1）。
# 无论成功失败（含 Ctrl+C / SIGTERM）都执行；容器未创建时 stop 幂等失败，忽略。
shutdown_stack() {
  compose stop postgres analyzer >/dev/null 2>&1 || true
}
trap 'shutdown_stack' EXIT
trap 'exit 130' INT
trap 'exit 143' TERM

log_step "启动分析容器（按需启停 · 跑完即停）"
compose up -d --build postgres analyzer
compose exec -T analyzer bash /app/scripts/analyze-in-container.sh "$@"
