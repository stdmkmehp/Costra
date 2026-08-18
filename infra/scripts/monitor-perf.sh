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
# 容器资源（collect 同步采集 · 独立文件 · 不动宿主 13 列契约）：
#   数据源 `timeout 15 docker stats --no-stream`（单帧快照 · 一次调用全容器）。
#   四项指标全部来自同一次 stats 调用的内核计数器（cgroup cpu/memory/io + 容器 netns
#   的 /proc/net/dev），只读不干预业务；docker 屏蔽 cgroup v1/v2 差异。
#   2026-08-17 prod 实测定论：dockerd 流式 stats 推送系统性挂死（多容器流式 15s 连
#   首帧都推不出；单容器流式第 2 帧也不到达），one-shot 快照路径健康（1.5s 秒出）——
#   故用单帧采集，无流式、无延迟等待机制：
#   - CPU% 依赖 dockerd 缓存的前次采样（precpu）：首次调用（daemon 或容器重启后）
#     显示 0.00%，其后每次=距上次调用的区间平均（每小时一采即"上一小时平均 CPU"，
#     0.00% 下次采集自愈）；
#   - MemUsage=working set 口径（usage 扣 inactive_file，与宿主机 MemAvailable 语义一致）；
#   - NetIO/BlockIO=容器启动以来累计收发（report 侧相邻样本差分；负增量=容器重启
#     计数器归零，该点按重启后新值计）；
#   - 单位统一折算 MiB：MemUsage 源为 1024 进制（MiB/GiB），NetIO/BlockIO 源为
#     SI 1000 进制（kB/MB/GB），解析时按后缀分别换算。
#   无 docker CLI / daemon 无响应 / 超时 → 整体跳过容器采集（宿主行不受影响，次日报告
#   经样本对账暴露）；采集范围=compose 固定 4 容器（EXPECTED_CONTAINERS），stats 输出
#   中缺席的容器记 "-" 行（宕机/未起 与 未采集 可区分）。
#   开销：一次 one-shot 快照 ≈2s，每小时一次，对线上服务无感知；
#   timeout 15 仅为 daemon 挂死的护栏，正常路径从不触发。
#
# 容器数据行（${CONTAINERS_FILE} 默认 /data/logs/maintenance/perf-containers.log
#   · 11 列 TSV · 无表头 · 与宿主行同一次 date 取值 · 数值列缺席一律记 -）：
#   1  ts         ISO8601 带时区
#   2  epoch      秒级时间戳（窗口过滤唯一依据）
#   3  name       容器名（costra-postgres / costra-redis / costra-server / costra-nginx）
#   4  mem_mb     内存使用 MiB（working set）
#   5  limit_mb   compose deploy.limits 上限 MiB
#   6  mem_pct    相对 limit 的使用率 %
#   7  cpu_pct    CPU 使用率 %（占宿主机总核 · 流式第 2 帧）
#   8  net_rx_mb  网络累计接收 MiB        9  net_tx_mb  网络累计发送 MiB
#   10 blk_r_mb   块设备累计读 MiB        11 blk_w_mb   块设备累计写 MiB
#
# 轮转：costra-ops 按 /data/logs/maintenance/*.log 目录 glob 自动覆盖本文件，
#   无需改 logrotate；report 与宿主行同款并集读（当前 + .1 + .N.gz 去重排序）。
#
# 报告（report · cron 每日 05:13）：
#   按行内 epoch 过滤窗口（不走 offset 增量——每行自带时间戳，天然幂等）：
#   - 最近 24h：逐时样本表 + 各核心指标 均值/峰值/峰值时刻；
#   - 最近 7 天：逐日日均表 + "24h 均值 vs 7 天日均"差值（平均变化）；
#   - 容器资源按容器分组汇总（同容器内纵向对比才有意义：24h vitals + IO 窗口累计、
#     7d 逐日趋势各居其小节，不同容器不混表）；
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
#   ./monitor-perf.sh report            # 汇总 24h + 7d 并推送（cron 每日 05:13）
#   ./monitor-perf.sh report --dry-run  # 打印完整报告与 eml 预览，不发送
#   ./monitor-perf.sh --test-send       # 跳过采集/汇总，发通道测试邮件（465 出站冒烟）
#
# 测试接缝（本地 fixture 验证用 · 生产不设）：
#   COSTRA_PERF_METRICS_FILE      覆盖 /data/logs/maintenance/perf-metrics.log
#   COSTRA_PERF_CONTAINERS_FILE   覆盖 /data/logs/maintenance/perf-containers.log
#   COSTRA_PERF_PROC_ROOT         覆盖 /proc（fixture 目录 · 需含 stat/meminfo/loadavg）
#   COSTRA_PERF_DOCKER_STATS_FILE 覆盖 docker stats 数据源（fixture=one-shot 输出原文 ·
#                                 每容器一行，与真实路径同一解析 awk）；
#                                 设置后不调用 docker CLI，macOS 本地验证走此路径·无 timeout 依赖）
#   COSTRA_PERF_ENV_FILE          覆盖 /data/conf/report.env
#
# 退出码：0 = 完成（含通道禁用/发送失败的降级路径）· 1 = 脚本自身故障
# =============================================================================

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=lib/common.sh
source "${SCRIPT_DIR}/lib/common.sh"
# shellcheck source=lib/mail.sh
source "${SCRIPT_DIR}/lib/mail.sh"

METRICS_FILE="${COSTRA_PERF_METRICS_FILE:-/data/logs/maintenance/perf-metrics.log}"
CONTAINERS_FILE="${COSTRA_PERF_CONTAINERS_FILE:-/data/logs/maintenance/perf-containers.log}"
PROC_ROOT="${COSTRA_PERF_PROC_ROOT:-/proc}"
DOCKER_STATS_FILE="${COSTRA_PERF_DOCKER_STATS_FILE:-}"
REPORT_ENV_FILE="${COSTRA_PERF_ENV_FILE:-${COSTRA_CONF_DIR}/report.env}"

# 采集范围=compose 编排的固定 4 容器（container_name 恒定 · 与 docker-compose.prod.yml 一一对应）
# 缺席 stats 输出的容器记 "-" 行；非本清单容器不纳入（保持 costra 栈 scoped）
EXPECTED_CONTAINERS="costra-postgres costra-redis costra-server costra-nginx"

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

# _container_rows : 输出规范化容器资源行（9 列 TSV · 无表头）：
#   name mem_mb limit_mb mem_pct cpu_pct net_rx_mb net_tx_mb blk_r_mb blk_w_mb
# 源优先级：COSTRA_PERF_DOCKER_STATS_FILE fixture > `docker stats --no-stream`（单帧快照）。
#
# 为什么用 one-shot 单帧而不是流式（2026-08-17 prod 实测定论）：
#   dockerd 的流式 stats 推送在这台机器上系统性挂死——多容器流式 timeout 15s 连首帧
#   都推不出（被 Terminated）；单容器流式第 2 帧 8s 内也不到达。而 one-shot 快照路径
#   健康（单容器 1.5s 秒出、数据完整）。单帧即满足采集目的，无需任何延迟/等待机制：
#   - mem/limit/mem%/net/io 单帧天然准确（瞬时值与累计值，不依赖前一帧）；
#   - CPU% 依赖 dockerd 缓存的前次采样（precpu）：首次调用（daemon 或容器重启后）
#     显示 0.00%，其后每次调用=距上次调用的区间平均——每小时一采的语义恰好是
#     "上一小时平均 CPU"，比 2 秒瞬时窗口更贴合趋势监控，且 0.00% 下次采集自愈。
# 缺席容器（未运行 → 不在 stats 输出中）由 _format_container_rows 兜底记 "-"。
# 失败（无 docker CLI / daemon 无响应 / 超时 / 无输出）→ log_warn + 返回 1，
# 调用方整体跳过容器采集（宿主行照常 · 不 die）。
_container_rows() {
  local rawf
  if [[ -n "${DOCKER_STATS_FILE}" ]]; then
    [[ -r "${DOCKER_STATS_FILE}" ]] || { log_warn "docker stats fixture 不可读 ${DOCKER_STATS_FILE}"; return 1; }
    rawf="${DOCKER_STATS_FILE}"
  else
    command -v docker >/dev/null 2>&1 || { log_warn "docker CLI 不在 PATH · 跳过容器资源采集"; return 1; }
    rawf="${TMPD}/docker-stats.raw"
    # timeout 15 纯挂死护栏（one-shot 正常 ~2s 返回 · 不是延迟/等待机制）：
    # 极端情况下 daemon 无响应时防 CLI 无限阻塞拖垮整个 collect。
    # （timeout 属 coreutils · prod RHEL 系自带；macOS 本地验证走 fixture 路径不触此）
    local raw
    raw=$(timeout 15 docker stats --no-stream \
            --format $'{{.Name}}\t{{.CPUPerc}}\t{{.MemUsage}}\t{{.MemPerc}}\t{{.NetIO}}\t{{.BlockIO}}' 2>/dev/null) \
      || { log_warn "docker stats 失败或超时（15s）· 跳过容器资源采集"; return 1; }
    [[ -n "${raw}" ]] || { log_warn "docker stats 无输出（无运行中容器？）· 跳过容器资源采集"; return 1; }
    printf '%s\n' "${raw}" > "${rawf}"
  fi
  # 单帧解析 · 仅 EXPECTED 清单（与 _format_container_rows 的 scoping 一致 · 清单外容器
  # 不纳入）；"180.5MiB / 1GiB" / "1.2MB / 3.4MB" → MiB（MemUsage 系 1024 进制 ·
  # NetIO/BlockIO 系 SI 1000 进制）；"x.y%" 去 %
  awk -F'\t' -v expect="${EXPECTED_CONTAINERS}" '
    BEGIN { nw = split(expect, e, " "); for (i = 1; i <= nw; i++) isexp[e[i]] = 1 }
    NF >= 6 && ($1 in isexp) {
      cpu = $2; gsub(/%/, "", cpu)
      split($3, m, " / "); memp = $4; gsub(/%/, "", memp)
      split($5, n, " / "); split($6, b, " / ")
      printf "%s\t%.1f\t%.1f\t%s\t%s\t%.1f\t%.1f\t%.1f\t%.1f\n", \
        $1, _mb(m[1]), _mb(m[2]), memp, cpu, _mb(n[1]), _mb(n[2]), _mb(b[1]), _mb(b[2])
    }
    function _mb(s,   v, u) {
      v = s + 0
      u = s; sub(/^[0-9.]+/, "", u)
      if (u == "KiB") return v / 1024
      if (u == "GiB") return v * 1024
      if (u == "TiB") return v * 1048576
      if (u == "kB")  return v * 1000 / 1048576
      if (u == "MB")  return v * 1000000 / 1048576
      if (u == "GB")  return v * 1000000000 / 1048576
      if (u == "TB")  return v * 1000000000000 / 1048576
      if (u == "B")   return v / 1048576
      return v
    }' "${rawf}"
}

# _format_container_rows <ts> <epoch> <stats_tsv> : 输出 11 列容器 TSV 行（缺席容器全记 -）
_format_container_rows() {
  local ts=$1 epoch=$2 stats=$3 name row
  for name in ${EXPECTED_CONTAINERS}; do
    row=$(awk -F'\t' -v n="${name}" '$1 == n { print; exit }' "${stats}")
    if [[ -n "${row}" ]]; then
      printf '%s\t%s\t%s\n' "${ts}" "${epoch}" "${row}"
    else
      printf '%s\t%s\t%s\t-\t-\t-\t-\t-\t-\t-\t-\n' "${ts}" "${epoch}" "${name}"
    fi
  done
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

  # 容器资源（独立文件 · 失败整体跳过不影响宿主行）
  local cstats="${TMPD}/container-stats.tsv" crows="" crow_note="跳过"
  if _container_rows > "${cstats}"; then
    crows=$(_format_container_rows "${ts}" "${epoch}" "${cstats}")
    crow_note=$(grep -c '' "${cstats}" || true)
  fi

  if [[ "${DRY_RUN}" == "1" ]]; then
    log_dry "将追加一行到 ${METRICS_FILE}："
    printf '%s\n' "${line}"
    if [[ -n "${crows}" ]]; then
      log_dry "将追加容器行到 ${CONTAINERS_FILE}："
      printf '%s\n' "${crows}"
    else
      log_dry "容器采集跳过（docker 不可用 · 见上 warn）"
    fi
    return 0
  fi

  mkdir -p "$(dirname "${METRICS_FILE}")"
  [[ -f "${METRICS_FILE}" ]] || install -m 0600 /dev/null "${METRICS_FILE}"
  printf '%s\n' "${line}" >> "${METRICS_FILE}"
  if [[ -n "${crows}" ]]; then
    mkdir -p "$(dirname "${CONTAINERS_FILE}")"
    [[ -f "${CONTAINERS_FILE}" ]] || install -m 0600 /dev/null "${CONTAINERS_FILE}"
    printf '%s\n' "${crows}" >> "${CONTAINERS_FILE}"
  fi
  log_success "已采集 → ${METRICS_FILE}（load1=${l1} cpu=${cpu}% mem=${mem_pct}% disk_data=${data_pct}% avail=${data_avail}G）· 容器样本=${crow_note}"
}

# =============================================================================
# 报告：轮转兼容并集读取 → 窗口过滤 → 分节汇总
# =============================================================================

# _read_merged <file> <min_nf> : 当前 + .1 + .N.gz 并集 · 校验行格式 · 去重 · 按 epoch 排序
_read_merged() {
  local target=$1 min_nf=${2:-13} f
  {
    shopt -s nullglob
    for f in "${target}" "${target}.1" "${target}".*.gz; do
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
  } | awk -v min_nf="${min_nf}" \
    '$1 ~ /^[0-9]{4}-[0-9]{2}-[0-9]{2}T/ && $2 ~ /^[0-9]+$/ && NF >= min_nf' \
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

# _awk_container_24h <name> <file> : 单容器 24h 汇总两行（报告按容器分组 · 同容器纵向对比）
#   行1 vitals：mem avg/peak/peak_at/peak%（相对 limit）+ cpu avg/peak
#   行2 IO 窗口累计（相邻样本差分求和 · 负增量=容器重启计数器归零按新值计）
#   窗口内该容器无有效样本 → 单行说明（配合文末样本对账区分 缺席 与 采集跳过）
_awk_container_24h() {
  awk -F'\t' -v want="$1" '
    $3 == want && $4 != "-" {
      msum += $4; mcnt++
      if ($5 != "-") lim = $5
      if (mcnt == 1 || $4 + 0 > peak + 0) { peak = $4; pat = substr($1, 6, 5) " " substr($1, 12, 5) }
      if ($7 != "-") { csum += $7; ccnt++; if (ccnt == 1 || $7 + 0 > cpeak + 0) cpeak = $7 }
      for (i = 8; i <= 11; i++) {
        if ($i == "-") continue
        v = $i + 0
        if (seen[i]) { d = v - prev[i]; iosum[i] += (d >= 0 ? d : v) }
        prev[i] = v; seen[i] = 1
      }
    }
    END {
      if (mcnt == 0) { printf "  24h 无有效样本（容器缺席或 docker 采集跳过）\n"; exit }
      printf "  24h  mem avg %.1f · peak %.1f @%s（占 limit %.0f 的 %.1f%%）· cpu avg %s%% · peak %s%%\n", \
        msum / mcnt, peak, pat, lim, (lim > 0 ? 100 * peak / lim : 0), \
        (ccnt > 0 ? sprintf("%.1f", csum / ccnt) : "-"), \
        (ccnt > 0 ? sprintf("%.1f", cpeak) : "-")
      printf "       IO 累计 MiB  net_rx %.1f · net_tx %.1f · blk_r %.1f · blk_w %.1f\n", \
        iosum[8], iosum[9], iosum[10], iosum[11]
    }' "$2"
}

# _awk_container_daily_one <name> <file> : 单容器 7d 逐日（mem/cpu 日均 + IO 当日累计 ·
#   跨零点差分计入后一日 · 负增量=重启按新值计）；输出无序，调用方 | sort
_awk_container_daily_one() {
  awk -F'\t' -v want="$1" '
    $3 == want && $4 != "-" {
      d = substr($1, 1, 10)
      msum[d] += $4; mcnt[d]++
      if ($7 != "-") { csum[d] += $7; ccnt[d]++ }
      for (i = 8; i <= 11; i++) {
        if ($i == "-") continue
        v = $i + 0
        if (seen[i]) { dd = v - prev[i]; iosum[d, i] += (dd >= 0 ? dd : v) }
        prev[i] = v; seen[i] = 1
      }
    }
    END {
      for (d in mcnt)
        printf "  %-10s %8.1f %8s %9.1f %9.1f %9.1f %9.1f\n", \
          d, msum[d] / mcnt[d], \
          (ccnt[d] > 0 ? sprintf("%.1f", csum[d] / ccnt[d]) : "-"), \
          iosum[d, 8], iosum[d, 9], iosum[d, 10], iosum[d, 11]
    }' "$2"
}

do_report() {
  require_cmd curl
  local now_epoch from24 from7 merged f24 f7 n24 n7
  local cmerged fc24 fc7 nc24 nc7
  now_epoch=$(date +%s)
  from24=$((now_epoch - 86400))
  from7=$((now_epoch - 7 * 86400))

  merged="${TMPD}/merged.tsv"
  _read_merged "${METRICS_FILE}" 13 > "${merged}"
  f24="${TMPD}/last24h.tsv"
  f7="${TMPD}/last7d.tsv"
  awk -v from="${from24}" '$2 + 0 >= from' "${merged}" > "${f24}"
  awk -v from="${from7}"  '$2 + 0 >= from' "${merged}" > "${f7}"
  n24=$(grep -c '' "${f24}" || true)
  n7=$(grep -c '' "${f7}" || true)

  # 容器内存（独立文件 · 与宿主窗口同一 from 基准）
  cmerged="${TMPD}/containers-merged.tsv"
  _read_merged "${CONTAINERS_FILE}" 11 > "${cmerged}"
  fc24="${TMPD}/containers-24h.tsv"
  fc7="${TMPD}/containers-7d.tsv"
  awk -v from="${from24}" '$2 + 0 >= from' "${cmerged}" > "${fc24}"
  awk -v from="${from7}"  '$2 + 0 >= from' "${cmerged}" > "${fc7}"
  nc24=$(grep -c '' "${fc24}" || true)
  nc7=$(grep -c '' "${fc7}" || true)
  log_info "样本对账：宿主 24h=${n24} 条 · 7d=${n7} 条 · 容器 24h=${nc24} 条 · 7d=${nc7} 条（${METRICS_FILE} + ${CONTAINERS_FILE}）"

  local body="${TMPD}/body.txt"
  {
    printf '[Costra] perf-report · %s · %s\n' "$(hostname)" "$(date '+%F %T %z')"
    printf '数据源：%s + %s · 采集节奏：每小时 03 分 · 窗口样本：宿主 24h=%s/7d=%s 条 · 容器 24h=%s/7d=%s 条\n\n' \
      "${METRICS_FILE}" "${CONTAINERS_FILE}" "${n24}" "${n7}" "${nc24}" "${nc7}"

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

    # ── 容器资源 · 按容器分组（同容器纵向对比才有意义 · 独立于宿主分支照常展示）──
    printf '\n== 容器资源 · 按容器分组（MiB · cpu%% 占宿主机总核 · IO 为累计差分）==\n'
    if [[ "${nc24}" -eq 0 && "${nc7}" -eq 0 ]]; then
      printf '无容器样本（docker 采集持续跳过，或该主机未升级含容器采集的 monitor-perf.sh）。\n'
    else
      [[ "${nc24}" -gt 0 ]] || printf '24h 窗口无容器样本。\n'
      [[ "${nc7}" -gt 0 ]]  || printf '7d 窗口无容器样本。\n'
      local cname cdaily
      for cname in ${EXPECTED_CONTAINERS}; do
        printf '\n── %s ──\n' "${cname}"
        if [[ "${nc24}" -gt 0 ]]; then
          _awk_container_24h "${cname}" "${fc24}"
        fi
        if [[ "${nc7}" -gt 0 ]]; then
          cdaily=$(_awk_container_daily_one "${cname}" "${fc7}" | sort)
          if [[ -n "${cdaily}" ]]; then
            printf '  7d 逐日（mem/cpu 日均 · IO 当日累计）：\n'
            printf '  %-10s %8s %8s %9s %9s %9s %9s\n' 'date' 'mem_avg' 'cpu_avg' 'net_rx' 'net_tx' 'blk_r' 'blk_w'
            printf '%s\n' "${cdaily}"
          else
            printf '  7d 无有效样本（容器缺席或 docker 采集跳过）。\n'
          fi
        fi
      done
      if [[ "${n24}" -gt 0 && "${nc24}" -lt $((n24 * 4)) ]]; then
        printf '\n提示：容器 24h 样本 %s 条，低于预期 ≈%s 条（24h 宿主样本 × 4 容器）：docker 采集跳过或容器缺席（缺席行不计数值）。\n' \
          "${nc24}" "$((n24 * 4))"
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
