#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# scripts/lib/parse-args.sh · CLI 参数解析
# 解析 --dump / --window / --anchor / --stdout / -h
# 调用后导出：DUMP_FILE / WINDOW_MS / ANCHOR_ISO / STDOUT_MODE
# ─────────────────────────────────────────────────────────────────────────────

# 默认值（在 pick-dump.sh 里覆盖 DUMP_FILE）
DUMP_FILE=""
WINDOW_STR="24h"
ANCHOR_ISO=""
STDOUT_MODE="0"

# ─── 参数解析 ─────────────────────────────────────────────────────────────────

_parse_args_usage() {
  cat >&2 <<'EOF'
用法: analyze.sh [选项]

选项:
  --dump   <file>    指定 dump 文件（默认: DUMP_INBOX 内 mtime 最新的 .sql.gz）
  --window <dur>     分析窗口时长（默认: 24h）
                     格式: <数字><单位>，单位: m(分钟) h(小时) d(天)
                     示例: 24h, 7d, 30d, 168h, 15m
  --anchor <ISO>     分析窗口右端时间（默认: dump 文件的 mtime）
                     格式: ISO 8601，例如 2026-07-21T23:59:00+08:00
  --stdout           强制输出到 stdout，不发邮件（调试/验收用）
  -h, --help         显示此帮助

分析窗口 = [anchor - window, anchor)（右端点不包含）

示例:
  # 默认：最新 dump · 最近 24h · anchor=dump mtime
  ./analyze.sh

  # 最近 7 天
  ./analyze.sh --window 7d

  # 回看指定时间点
  ./analyze.sh --window 24h --anchor 2026-07-15T23:59:00+08:00

  # 完整指定
  ./analyze.sh --dump /path/to/dump.sql.gz --window 24h --anchor 2026-07-21T21:17:23+08:00

  # stdout 模式（不发邮件）
  ./analyze.sh --stdout
EOF
}

# 解析 duration 字符串为毫秒数
# 格式: ^([0-9]+)(m|h|d)$
_parse_duration_ms() {
  local dur="$1"
  local num unit
  if [[ "${dur}" =~ ^([0-9]+)(m|h|d)$ ]]; then
    num="${BASH_REMATCH[1]}"
    unit="${BASH_REMATCH[2]}"
    case "${unit}" in
      m) echo $(( num * 60 * 1000 )) ;;
      h) echo $(( num * 3600 * 1000 )) ;;
      d) echo $(( num * 86400 * 1000 )) ;;
    esac
  else
    die "无效的 window 格式: '${dur}'  合法格式示例: 24h, 7d, 30d, 15m"
  fi
}

# ─── 主解析逻辑 ───────────────────────────────────────────────────────────────

parse_args() {
  local args=("$@")
  local i=0
  while [[ $i -lt ${#args[@]} ]]; do
    local arg="${args[$i]}"
    case "${arg}" in
      --dump)
        i=$(( i + 1 ))
        [[ $i -lt ${#args[@]} ]] || die "--dump 需要参数"
        DUMP_FILE="${args[$i]}"
        ;;
      --window)
        i=$(( i + 1 ))
        [[ $i -lt ${#args[@]} ]] || die "--window 需要参数"
        WINDOW_STR="${args[$i]}"
        ;;
      --anchor)
        i=$(( i + 1 ))
        [[ $i -lt ${#args[@]} ]] || die "--anchor 需要参数"
        ANCHOR_ISO="${args[$i]}"
        ;;
      --stdout)
        STDOUT_MODE="1"
        ;;
      -h|--help)
        _parse_args_usage
        exit 0
        ;;
      *)
        die "未知参数: ${arg}  使用 --help 查看帮助"
        ;;
    esac
    i=$(( i + 1 ))
  done

  # anchor 必须显式携带时区，避免不同宿主机产生不同分析窗口。
  if [[ -n "${ANCHOR_ISO}" && ! "${ANCHOR_ISO}" =~ ^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}(:[0-9]{2})?(Z|[+-][0-9]{2}:[0-9]{2})$ ]]; then
    die "--anchor 必须是带时区的 ISO 8601，例如 2026-07-21T23:59:00+08:00"
  fi

  WINDOW_MS=$(_parse_duration_ms "${WINDOW_STR}")
  export DUMP_FILE WINDOW_STR WINDOW_MS ANCHOR_ISO STDOUT_MODE
}

# 如果直接 source 此文件，则解析 $@ 参数
# 若在 analyze.sh 里 source 后手动调用 parse_args "$@"，则不自动执行
