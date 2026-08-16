#!/usr/bin/env bash
# =============================================================================
# Costra · 宿主机性能时序采集 + 每日汇总邮件（cron · maintenance.sh perf-collect/perf-report 委托）
# =============================================================================
# 采集（collect · cron 每小时 03 分）：
#   读 /proc/{stat,meminfo,loadavg} + df，向 ${METRICS_FILE}（默认
#   /data/logs/maintenance/perf-metrics.log）追加一行 TSV。CPU% 为 /proc/stat 两次采样（间隔 1s）
#   的区间使用率；磁盘同时记录 / 与 /data 两目标（/data 非独立挂载时与 / 同值）。
#
# 数据行格式（TSV · 13 列 · 无表头）：
#   1  ts          ISO8601 带时区（2026-08-16T03:03:01+0800 · 展示/按日分组用）
#   2  epoch       秒级时间戳（窗口过滤唯一依据 · 与时区无关）
#   3  load1       4  load5      5  load15      （/proc/loadavg）
#   6  cpu_pct     CPU 使用率 %（/proc/stat 双采样 · 含 iowait 计入 idle）
#   7  mem_mb      内存总量 MB（MemTotal）
#   8  mem_pct     内存使用率 %（100*(MemTotal-MemAvailable)/MemTotal · 扣 buffers/cache）
#   9  swap_pct    swap 使用率 %（无 swap 记 0.0）
#   10 disk_root_pct   / 分区使用率 %（df -P /）
#   11 disk_data_pct   /data 分区使用率 %（df -P /data · 路径不存在记 -）
#   12 disk_data_avail_gb  /data 可用 GB（df -Pk · 路径不存在记 -）
#   13 inode_data_pct  /data inode 使用率 %（df -Pi · 路径不存在记 -）
#
# 报告（report · cron 每日 07:13）：
#   按行内 epoch 过滤窗口（不走 offset 增量——每行自带时间戳，天然幂等）：
#   - 最近 24h：逐时样本表 + 各核心指标 均值/峰值/峰值时刻；
#   - 最近 7 天：逐日日均表 + "24h 均值 vs 7 天日均"差值（平均变化）；
#   - 样本数对账：24h 窗口预期约 24 条，不足时显式提示（collect 停机诚实暴露）。
#
# 轮转兼容（copytruncate · infra/logrotate/costra-ops）：
#   报告读取时取 当前文件 + .1 + .N.gz（zcat）并集，sort -u 去重后按 epoch 排序
#   再过滤窗口——copytruncate 造成的当前文件与 .1 交叠由去重吸收，不丢不重；
#   无须 report-error-logs.sh 那套 inode/offset 状态机（时序数据有行内 epoch）。
#
# 推送语义（对齐 report-error-logs.sh · 实现复用 lib/mail.sh）：
#   - env 键：SMTP_HOST / SMTP_PORT / SMTP_USER / SMTP_PASS / MAIL_FROM / MAIL_TO
#     （环境变量优先，其次 ${REPORT_ENV_FILE}（默认 /data/conf/report.env））；
#   - SMTP_USER/SMTP_PASS/MAIL_TO 任一为空 → 通道禁用，只写日志，退出码仍 0；
#   - 无数据也推送（心跳语义同 error-report · 连续收不到说明任务/通道挂了）；
#   - 发送失败 log_error（进自身 cron 日志 maintenance-perf.log，次日被 error-report 扫到）但不以非零退出。
#
# 用法：
#   ./monitor-perf.sh collect           # 采集一行（cron 每小时 03 分）
#   ./monitor-perf.sh collect --dry-run # 打印将追加的行，不写文件
#   ./monitor-perf.sh report            # 汇总 24h + 7d 并推送（cron 每日 07:13）
#   ./monitor-perf.sh report --dry-run  # 打印完整报告与 eml 预览，不发送
#   ./monitor-perf.sh --test-send       # 跳过采集/汇总，发通道测试邮件（465 出站冒烟）
#
# 测试接缝（本地 fixture 验证用 · 生产不设）：
#   COSTRA_PERF_METRICS_FILE  覆盖 /data/logs/maintenance/perf-metrics.log
#   COSTRA_PERF_PROC_ROOT     覆盖 /proc（fixture 目录 · 需含 stat/meminfo/loadavg）
#   COSTRA_PERF_ENV_FILE      覆盖 /data/conf/report.env
#
# 退出码：0 = 完成（含通道禁用/发送失败的降级路径）· 1 = 脚本自身故障
# =============================================================================

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=lib/common.sh
source "${SCRIPT_DIR}/lib/common.sh"
# shellcheck source=lib/mail.sh
source "${SCRIPT_DIR}/lib/mail.sh"

METRICS_FILE="${COSTRA_PERF_METRICS_FILE:-/data/logs/maintenance/perf-metrics.log}"
PROC_ROOT="${COSTRA_PERF_PROC_ROOT:-/proc}"
REPORT_ENV_FILE="${COSTRA_PERF_ENV_FILE:-${COSTRA_CONF_DIR}/report.env}"

ACTION=""
TEST_SEND=0

# --- 参数解析 ---
parse_common_args "$@"
while [[ $# -gt 0 ]]; do
  case "$1" in
    collect|report)
      [[ -z "${ACTION}" ]] || die "只能指定一个动作（已有：${ACTION}）"
      ACTION=$1; shift ;;
    --test-send) TEST_SEND=1; shift ;;
    --dry-run|-y|--yes) shift ;;   # common 已处理 · noop
    -h|--help)
      awk 'NR == 1 { next } /^#/ { print; next } { exit }' "$0" | sed 's/^# \{0,1\}//'
      exit 0 ;;
    *) die "未知参数: $1 · 用 --help 查看" ;;
  esac
done

TMPD=$(mktemp -d /tmp/costra-perf.XXXXXX)
trap 'rm -rf "${TMPD}"' EXIT

# =============================================================================
# 采集原语
# =============================================================================

# _cpu_pct : /proc/stat 首行两次采样（间隔 1s）算区间 CPU 使用率；样本静止输出 -
_cpu_pct() {
  local stat_file="${PROC_ROOT}/stat" line1 line2
  line1=$(grep '^cpu ' "${stat_file}") || return 1
  sleep 1
  line2=$(grep '^cpu ' "${stat_file}") || return 1
  awk -v a="${line1#cpu }" -v b="${line2#cpu }" 'BEGIN {
    split(a, x, " "); split(b, y, " ")
    idle1 = x[4] + x[5]; idle2 = y[4] + y[5]
    t1 = 0; t2 = 0
    for (i = 1; i <= 8; i++) { t1 += x[i]; t2 += y[i] }
    dt = t2 - t1
    if (dt <= 0) { printf "-"; exit }
    printf "%.1f", 100 * (dt - (idle2 - idle1)) / dt
  }'
}

# _mem_line : 输出 "mem_mb mem_pct swap_pct"（/proc/meminfo · 不可用项输出 -）
_mem_line() {
  awk '
    /^MemTotal:/     { t = $2 }
    /^MemAvailable:/ { a = $2 }
    /^SwapTotal:/    { st = $2 }
    /^SwapFree:/     { sf = $2 }
    END {
      mem_mb = (t > 0) ? int(t / 1024) : "-"
      mem_pct = (t > 0) ? sprintf("%.1f", 100 * (t - a) / t) : "-"
      swap_pct = (st > 0) ? sprintf("%.1f", 100 * (st - sf) / st) : "0.0"
      printf "%s %s %s", mem_mb, mem_pct, swap_pct
    }' "${PROC_ROOT}/meminfo"
}

# _df_field <path> <pct|avail_gb|ipct> : df 取数；路径不存在/失败输出 -
_df_field() {
  local path=$1 mode=$2 out=""
  [[ -d "${path}" ]] || { printf -- '-'; return 0; }
  case "${mode}" in
    pct)      out=$(df -P "${path}" 2>/dev/null | awk 'NR==2 { gsub(/%/, "", $5); print $5 }') ;;
    avail_gb) out=$(df -Pk "${path}" 2>/dev/null | awk 'NR==2 { printf "%.1f", $4 / 1048576 }') ;;
    ipct)     out=$(df -Pi "${path}" 2>/dev/null | awk 'NR==2 { gsub(/%/, "", $5); print $5 }') ;;
  esac
  printf '%s' "${out:--}"
}

do_collect() {
  local stat_f="${PROC_ROOT}/stat" meminfo_f="${PROC_ROOT}/meminfo" loadavg_f="${PROC_ROOT}/loadavg"
  [[ -r "${stat_f}" && -r "${meminfo_f}" && -r "${loadavg_f}" ]] \
    || die "无法读取 ${PROC_ROOT}/{stat,meminfo,loadavg} · 需 Linux /proc（本地验证用 COSTRA_PERF_PROC_ROOT 指定 fixture）"

  local ts epoch l1 l5 l15 cpu mem_mb mem_pct swap_pct root_pct data_pct data_avail data_ipct mem_line
  ts=$(date '+%Y-%m-%dT%H:%M:%S%z')
  epoch=$(date +%s)
  read -r l1 l5 l15 _ < "${loadavg_f}"
  cpu=$(_cpu_pct)
  mem_line=$(_mem_line)
  read -r mem_mb mem_pct swap_pct <<< "${mem_line}"
  root_pct=$(_df_field / pct)
  data_pct=$(_df_field /data pct)
  data_avail=$(_df_field /data avail_gb)
  data_ipct=$(_df_field /data ipct)

  local line
  line=$(printf '%s\t%s\t%s\t%s\t%s\t%s\t%s\t%s\t%s\t%s\t%s\t%s\t%s' \
    "${ts}" "${epoch}" "${l1}" "${l5}" "${l15}" "${cpu}" \
    "${mem_mb}" "${mem_pct}" "${swap_pct}" "${root_pct}" "${data_pct}" "${data_avail}" "${data_ipct}")

  if [[ "${DRY_RUN}" == "1" ]]; then
    log_dry "将追加一行到 ${METRICS_FILE}："
    printf '%s\n' "${line}"
    return 0
  fi

  mkdir -p "$(dirname "${METRICS_FILE}")"
  [[ -f "${METRICS_FILE}" ]] || install -m 0600 /dev/null "${METRICS_FILE}"
  printf '%s\n' "${line}" >> "${METRICS_FILE}"
  log_success "已采集 → ${METRICS_FILE}（load1=${l1} cpu=${cpu}% mem=${mem_pct}% disk_data=${data_pct}% avail=${data_avail}G）"
}

# =============================================================================
# 报告：轮转兼容并集读取 → 窗口过滤 → 分节汇总
# =============================================================================

# _read_merged : 当前 + .1 + .N.gz 并集 · 校验行格式 · 去重 · 按 epoch 排序
_read_merged() {
  local f
  {
    shopt -s nullglob
    for f in "${METRICS_FILE}" "${METRICS_FILE}.1" "${METRICS_FILE}".*.gz; do
      [[ -f "${f}" ]] || continue
      case "${f}" in
        *.gz)
          # gzip -dc 而非 zcat：macOS 的 zcat 属 compress 只认 .Z，gzip -dc 全平台一致
          if command -v gzip >/dev/null 2>&1; then
            { gzip -dc "${f}" 2>/dev/null || true; }
          else
            log_warn "缺少 gzip · 跳过压缩归档 ${f}"
          fi ;;
        *) cat "${f}" ;;
      esac
    done
    shopt -u nullglob
  } | awk '$1 ~ /^[0-9]{4}-[0-9]{2}-[0-9]{2}T/ && $2 ~ /^[0-9]+$/ && NF >= 13' \
    | sort -u | sort -k2,2n
}

# _awk_24h_rows : 逐时样本表（stdin = 24h 窗口行）
_awk_24h_rows() {
  awk '{
    printf "%s %s   %5s %6s %6s %6s %6s %9s %7s %6s\n", \
      substr($1, 6, 5), substr($1, 12, 5), $3, $6, $8, $9, $10, $11, $12, $13
  }'
}

# _awk_stats <file> : 各核心指标 均值/峰值/峰值时刻
_awk_stats() {
  awk '
    BEGIN {
      n = split("3:load1 6:cpu% 8:mem% 9:swap% 10:dsk_root% 11:dsk_data%", pairs, " ")
      for (i = 1; i <= n; i++) { split(pairs[i], kv, ":"); idx[i] = kv[1]; name[i] = kv[2] }
    }
    {
      for (i = 1; i <= n; i++) {
        v = $(idx[i]); if (v == "-") continue
        s[i] += v; c[i]++
        if (c[i] == 1 || v + 0 > m[i] + 0) { m[i] = v; mt[i] = substr($1, 6, 5) " " substr($1, 12, 5) }
      }
    }
    END {
      for (i = 1; i <= n; i++) {
        if (c[i] > 0) printf "%-11s %8.1f %8.1f   %s\n", name[i], s[i] / c[i], m[i], mt[i]
        else printf "%-11s %8s %8s   %s\n", name[i], "-", "-", "-"
      }
    }' "$1"
}

# _awk_daily <file> : 逐日日均（输出无序 · 调用方 | sort）
_awk_daily() {
  awk '
    BEGIN {
      n = split("3:load1 6:cpu% 8:mem% 11:dsk_data%", pairs, " ")
      for (i = 1; i <= n; i++) { split(pairs[i], kv, ":"); idx[i] = kv[1] }
    }
    {
      d = substr($1, 1, 10); cnt[d]++
      for (i = 1; i <= n; i++) {
        v = $(idx[i]); if (v == "-") continue
        sum[d, i] += v; c[d, i]++
      }
    }
    END {
      for (d in cnt) {
        line = sprintf("%-10s", d)
        for (i = 1; i <= n; i++) {
          line = (c[d, i] > 0) ? line sprintf(" %8.1f", sum[d, i] / c[d, i]) : line sprintf(" %8s", "-")
        }
        printf "%s %6d\n", line, cnt[d]
      }
    }' "$1"
}

# _awk_delta <f24> <f7> : 24h 均值 vs 7 天日均 差值（平均变化）
_awk_delta() {
  awk '
    BEGIN {
      n = split("3:load1 6:cpu% 8:mem% 9:swap% 10:dsk_root% 11:dsk_data%", pairs, " ")
      for (i = 1; i <= n; i++) { split(pairs[i], kv, ":"); idx[i] = kv[1]; name[i] = kv[2] }
    }
    FILENAME == ARGV[1] {
      for (i = 1; i <= n; i++) {
        v = $(idx[i]); if (v == "-") continue
        s24[i] += v; c24[i]++
      }
      next
    }
    {
      for (i = 1; i <= n; i++) {
        v = $(idx[i]); if (v == "-") continue
        s7[i] += v; c7[i]++
      }
    }
    END {
      for (i = 1; i <= n; i++) {
        a24 = (c24[i] > 0) ? s24[i] / c24[i] : ""
        a7  = (c7[i] > 0)  ? s7[i] / c7[i]  : ""
        if (a24 != "" && a7 != "") printf "%-11s %8.1f %8.1f %+8.2f\n", name[i], a24, a7, a24 - a7
        else printf "%-11s %8s %8s %8s\n", name[i], \
          (a24 != "" ? sprintf("%.1f", a24) : "-"), (a7 != "" ? sprintf("%.1f", a7) : "-"), "-"
      }
    }' "$1" "$2"
}

do_report() {
  require_cmd curl
  local now_epoch from24 from7 merged f24 f7 n24 n7
  now_epoch=$(date +%s)
  from24=$((now_epoch - 86400))
  from7=$((now_epoch - 7 * 86400))

  merged="${TMPD}/merged.tsv"
  _read_merged > "${merged}"
  f24="${TMPD}/last24h.tsv"
  f7="${TMPD}/last7d.tsv"
  awk -v from="${from24}" '$2 + 0 >= from' "${merged}" > "${f24}"
  awk -v from="${from7}"  '$2 + 0 >= from' "${merged}" > "${f7}"
  n24=$(grep -c '' "${f24}" || true)
  n7=$(grep -c '' "${f7}" || true)
  log_info "样本对账：24h=${n24} 条 · 7d=${n7} 条（数据源 ${METRICS_FILE}）"

  local body="${TMPD}/body.txt"
  {
    printf '[Costra] perf-report · %s · %s\n' "$(hostname)" "$(date '+%F %T %z')"
    printf '数据源：%s · 采集节奏：每小时 03 分 · 窗口样本：24h=%s 条 · 7d=%s 条\n\n' \
      "${METRICS_FILE}" "${n24}" "${n7}"

    if [[ "${n7}" == "0" ]]; then
      printf '最近 7 天无任何性能样本：metrics 文件不存在/为空，或 collect cron 未运行。\n'
      printf '请检查 /etc/cron.d/costra-maintenance 的 perf-collect 行与 %s。\n' "${METRICS_FILE}"
    else
      if [[ "${n24}" -gt 0 ]]; then
        printf '== 最近 24 小时 · 逐时样本 ==\n'
        printf '%s\n' 'date   time    load1   cpu%   mem%  swap%  dsk/%  dsk_data%  avail_g  inode%'
        if [[ "${n24}" -gt 48 ]]; then
          head -48 "${f24}" | _awk_24h_rows
          printf '……（共 %s 条 · 仅展示前 48 条）\n' "${n24}"
        else
          _awk_24h_rows < "${f24}"
        fi
        printf '\n== 最近 24 小时 · 汇总 ==\n'
        printf '%-11s %8s %8s   %s\n' 'metric' 'avg' 'peak' 'peak_at'
        _awk_stats "${f24}"
        printf '\n'
      else
        printf '== 最近 24 小时 · 无样本（collect 停机？）==\n\n'
      fi
      printf '== 最近 7 天 · 逐日日均 ==\n'
      printf '%-10s %8s %8s %8s %11s %6s\n' 'date' 'load1' 'cpu%' 'mem%' 'dsk_data%' 'samples'
      _awk_daily "${f7}" | sort
      printf '\n== 平均变化 · 24h 均值 vs 7 天日均 ==\n'
      printf '%-11s %8s %8s %8s\n' 'metric' 'avg_24h' 'avg_7d' 'delta'
      _awk_delta "${f24}" "${f7}"
      if [[ "${n24}" -lt 24 ]]; then
        printf '\n提示：24h 窗口预期约 24 条样本，实际 %s 条（collect cron 停机或样本缺失）。\n' "${n24}"
      fi
    fi
  } > "${body}"

  if [[ "${DRY_RUN}" == "1" ]]; then
    log_dry "报告正文预览："
    cat "${body}"
  fi
  mail_deliver "${REPORT_ENV_FILE}" "[Costra] perf-report · $(hostname) · $(date '+%F')" "${body}"
}

# =============================================================================
# --test-send：跳过采集/汇总，直接验证 465 出站 + 认证 + 投递
# =============================================================================
if [[ "${TEST_SEND}" == "1" ]]; then
  require_cmd curl
  mail_load_config "${REPORT_ENV_FILE}"
  if ! mail_channel_ready; then
    die "--test-send 需要 SMTP_USER/SMTP_PASS/MAIL_TO 配齐（环境变量或 ${REPORT_ENV_FILE}）"
  fi
  TEST_BODY="${TMPD}/test-body.txt"
  {
    printf 'costra perf-report 邮件通道测试\n'
    printf '主机：%s\n' "$(hostname)"
    printf '时间：%s\n' "$(date '+%F %T %z')"
    printf '若收到本邮件，说明 curl SMTPS(%s)→%s 链路已走通。\n' "${SMTP_PORT}" "${SMTP_HOST}"
  } > "${TEST_BODY}"
  mail_deliver "${REPORT_ENV_FILE}" "[Costra] perf-report 通道测试 · $(hostname) · $(date '+%F %T')" "${TEST_BODY}"
  exit 0
fi

[[ -n "${ACTION}" ]] || die "缺少动作（collect|report）· 用 --help 查看"

case "${ACTION}" in
  collect) do_collect ;;
  report)  do_report ;;
esac
exit 0
