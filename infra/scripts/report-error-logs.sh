#!/usr/bin/env bash
# =============================================================================
# Costra · /data/logs error 级日志每日扫描 + 邮件推送（cron · maintenance.sh error-report 委托）
# =============================================================================
# 事实源：
#   - 邮件发送实现（curl SMTPS 465 + --login-options 'AUTH=LOGIN' + CRLF + RFC 2047 主题）：
#     docs/ops/mail-notification.md §3 —— 不要在本文件重新探索，改动先改该文档。
#   - grep 判定表 / offset 增量 / 聚合降噪：本文件（2026-08-14 方案 v2）。
#
# 扫描对象与"≥error 级"判定（五种日志格式各异 · 逐格式显式级别判定，不用文本模糊匹配）：
#   server/server.log          pino NDJSON → "level":[56]0（50=error · 60=fatal · [^0-9] 防未来自定义 3 位级别误配）
#   nginx/*error*.log          nginx 级别 → [error]/[crit]/[alert]/[emerg]
#                              （error_log 阈值配的 warn，会混入 [warn]，必须显式过滤 ≥error 四级）
#   redis/redis.log            redis 级别字符 → 行首锚定 `pid:role ... #`
#                              （redis 无 error 级，`#`=warning 已是最高非正常级；`.`/`-`/`*` 不报）
#   postgres|standby/postgresql.log  PG → \b(ERROR|FATAL|PANIC):（排除 NOTICE/WARNING/LOG 等正常噪音）
#   maintenance-*.log / check-replication.log / standby-backup.log
#                              运维脚本（common.sh log_error）→ [ERROR]
#                              （ANSI 色码只包裹标记外围，[ERROR] 字节连续，纯文本匹配即可）
#   明确排除：nginx access.log（无 level 字段，5xx 判定属另一维度）与 .gz 历史轮转文件。
#
# 增量窗口（inode 追踪 · 不用时间戳过滤——四种日志时间戳格式/时区各异，逐个解析太脆）：
#   - 状态文件 ${STATE_DIR}/offsets 逐文件记录 `path|dev:ino|offset`；
#   - 每次扫描先 stat 当前文件与 <file>.1，按四级判定（从最可靠到最弱）：
#       ① inode 变 → 文件被替换（rename 轮转/重建）：.1 保留旧 inode，按旧 offset 补扫尾巴 + 从 0 扫新文件；
#       ② inode 同 + .1 是 cp 副本（inode 不同且 mtime ≥ 当前文件）→ copytruncate：
#          cp 出 .1 后 truncate 重写，旧内容只完整保留在 .1 → 补扫 .1 尾巴 + 从 0 扫当前；
#          （关键：size 方向不可信——truncate 后立刻重写 size 仍可能 > offset，这是 size 倒挂方案的实锤漏洞）
#       ③ inode 同 + 无 .1 cp 副本 + size<offset → 就地截断但无 .1（手工 truncate）→ 报空隙不猜；
#       ④ inode 同 + size≥offset → 正常追加。
#   - 全局首跑（状态文件尚不存在）时所有文件从当前 size 起跳，不追溯历史；
#     运行期新出现的日志文件（状态已存在但该文件无记录）从 0 全扫；
#   - offset 扫描后即更新，不以推送成功为条件——推送故障会以 [ERROR] 写进自身 cron 日志
#     （maintenance-error-report.log），次日被本任务扫到，形成自愈回路而非重复轰炸。
#
# 推送语义（对齐 check-replication.sh 的 webhook 约定）：
#   - env 键：SMTP_HOST / SMTP_PORT / SMTP_USER / SMTP_PASS / MAIL_FROM / MAIL_TO
#     （环境变量优先，其次 ${COSTRA_ENV_FILE}；MAIL_TO 多收件人逗号分隔）；
#   - SMTP_USER/SMTP_PASS/MAIL_TO 任一为空 → 通道禁用，只写日志，退出码仍 0；
#   - 零命中也推送"平安邮件"（心跳语义：连收不到平安邮件本身就说明任务/通道挂了 · 2026-08-14 变更）；
#   - 发送失败 log_error（进自身日志被次日扫到）但不以非零退出，不阻断主任务。
#
# 报告格式（2026-08-14 v3）：
#   - 按日志类别分节（server / nginx / redis / postgres / standby / maintenance），
#     类别 = 文件按 _pattern_for 族归组（如 nginx/error.log 与 nginx/costra.error.log 同节）；
#   - 每类别配额封顶 CATEGORY_BODY_CAP（默认 4096 字节 · 环境变量可覆盖），
#     防单类刷屏挤掉其他类别；全局正文另设 BODY_LIMIT 双保险；
#
# 用法：
#   ./report-error-logs.sh                # 扫描 + 有命中才推送
#   ./report-error-logs.sh --test-send    # 跳过扫描发通道测试邮件（465 出站验证/通道冒烟用这个）
#   ./report-error-logs.sh --dry-run      # 打印扫描结果与 eml 预览，不写 offset、不发送
#
# 测试接缝（本地 fixture 验证用 · 生产不设）：
#   COSTRA_ERROR_REPORT_LOG_DIR    覆盖 /data/logs
#   COSTRA_ERROR_REPORT_STATE_DIR  覆盖 /var/lib/costra/error-report
#
# 退出码：0 = 扫描完成（含通道禁用/发送失败的降级路径）· 1 = 脚本自身故障
# =============================================================================

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=lib/common.sh
source "${SCRIPT_DIR}/lib/common.sh"

LOG_DIR="${COSTRA_ERROR_REPORT_LOG_DIR:-/data/logs}"
STATE_DIR="${COSTRA_ERROR_REPORT_STATE_DIR:-/var/lib/costra/error-report}"
STATE_FILE="${STATE_DIR}/offsets"

BODY_LIMIT=16384        # 邮件正文全局字节上限（远低于 QQ SIZE 73400320 · 双保险）
CATEGORY_BODY_CAP=${COSTRA_ERROR_REPORT_CATEGORY_CAP:-4096}   # 每日志类别正文字节配额（防单类刷屏）
TOP_N=5                 # 每文件展示的指纹类数上限
SAMPLE_WIDTH=500        # 样本行展示截断宽度
FP_WIDTH=200            # 指纹展示截断宽度

TEST_SEND=0

# --- 参数解析 ---
parse_common_args "$@"
while [[ $# -gt 0 ]]; do
  case "$1" in
    --test-send) TEST_SEND=1; shift ;;
    --dry-run|-y|--yes) shift ;;   # common 已处理 · noop
    -h|--help)
      grep '^#' "$0" | sed 's/^# \{0,1\}//' | head -46
      exit 0 ;;
    *) die "未知参数: $1 · 用 --help 查看" ;;
  esac
done

require_cmd curl

TMPD=$(mktemp -d /tmp/costra-error-report.XXXXXX)
trap 'rm -rf "${TMPD}"' EXIT

# =============================================================================
# 扫描目标（glob 展开 · 缺失文件按 missingok 语义自然跳过）
# =============================================================================
_scan_targets() {
  local g
  shopt -s nullglob
  for g in "${LOG_DIR}/server/server.log" \
           "${LOG_DIR}/nginx/"*error*.log \
           "${LOG_DIR}/redis/redis.log" \
           "${LOG_DIR}/postgres/postgresql.log" \
           "${LOG_DIR}/standby/postgresql.log" \
           "${LOG_DIR}/maintenance-"*.log \
           "${LOG_DIR}/check-replication.log" \
           "${LOG_DIR}/standby-backup.log"; do
    # 字面路径（无通配符）不受 nullglob 过滤 · 存在性判断统一在这里（missingok 语义）
    [[ -f "${g}" ]] && printf '%s\n' "${g}"
  done
  shopt -u nullglob
}

# _pattern_for <path> : 该日志格式的"≥error 级"ERE（全部走 grep -E · 未识别返回 1）
_pattern_for() {
  local path=$1
  case "${path}" in
    */server/server.log)
      printf '%s' '"level":[56]0[^0-9]' ;;
    */nginx/*error*.log)
      printf '%s' '\[(error|crit|alert|emerg)\]' ;;
    */redis/redis.log)
      printf '%s' '^[0-9]+:[A-Z] [0-9]{1,2} [A-Za-z]{3}( [0-9]{4})? [0-9:.]+ # ' ;;
    */postgres/postgresql.log|*/standby/postgresql.log)
      printf '%s' '\b(ERROR|FATAL|PANIC):' ;;
    */maintenance-*.log|*/check-replication.log|*/standby-backup.log)
      printf '%s' '\[ERROR\]' ;;
    *) return 1 ;;
  esac
}

# _category_of <path> : 报告分节用类别名（与 _pattern_for 同族）
_category_of() {
  local path=$1
  case "${path}" in
    */server/server.log)      printf 'server' ;;
    */nginx/*error*.log)      printf 'nginx' ;;
    */redis/redis.log)        printf 'redis' ;;
    */postgres/postgresql.log) printf 'postgres' ;;
    */standby/postgresql.log) printf 'standby' ;;
    */maintenance-*.log|*/check-replication.log|*/standby-backup.log) printf 'maintenance' ;;
    *) return 1 ;;
  esac
}

# =============================================================================
# offset 状态（path|dev:ino|offset 逐行 · 原子改写）
# =============================================================================
_size_of() { wc -c < "$1" | tr -d '[:space:]'; }

# _file_id <path> : 输出 dev:ino（文件身份）· 跨平台（GNU stat -c / BSD stat -f）
_file_id() {
  local id
  id=$(stat -c '%d:%i' -- "$1" 2>/dev/null || stat -f '%d:%i' -- "$1" 2>/dev/null || true)
  printf '%s' "${id}"
}

# _state_get <path> : 输出 `dev:ino|offset`；无记录/损坏 → 空
_state_get() {
  local path=$1 rec id off
  [[ -f "${STATE_FILE}" ]] || return 0
  rec=$({ grep -F "${path}|" "${STATE_FILE}" 2>/dev/null || true; } | tail -1)
  [[ -n "${rec}" ]] || return 0
  id=$(printf '%s' "${rec}" | cut -d'|' -f2)
  off=$(printf '%s' "${rec}" | cut -d'|' -f3)
  [[ "${id}" =~ ^[0-9]+:[0-9]+$ && "${off}" =~ ^[0-9]+$ ]] || return 0
  printf '%s|%s' "${id}" "${off}"
}

_state_set() {
  local path=$1 id=$2 offset=$3 tmp
  [[ "${DRY_RUN}" == "1" ]] && return 0
  mkdir -p "${STATE_DIR}"
  chmod 0700 "${STATE_DIR}"
  tmp=$(mktemp "${STATE_DIR}/.offsets.XXXXXX")
  if [[ -f "${STATE_FILE}" ]]; then
    { grep -vF "${path}|" "${STATE_FILE}" || true; } > "${tmp}"
  fi
  printf '%s|%s|%s\n' "${path}" "${id}" "${offset}" >> "${tmp}"
  mv -f "${tmp}" "${STATE_FILE}"
}

# =============================================================================
# 指纹归一化（剥 ANSI 色码 + 按格式剥易变字段 · 只为分组计数，不影响命中判定）
# =============================================================================
_strip_ansi() { sed -E "s/$(printf '\033')\\[[0-9;]*[A-Za-z]//g"; }

_normalize() {
  local path=$1
  case "${path}" in
    */server/server.log)
      _strip_ansi | sed -E \
        -e 's/"time":"[^"]*",?//' \
        -e 's/"pid":[0-9]+,?//' \
        -e 's/"hostname":"[^"]*",?//' \
        -e 's/"reqId":"[^"]*",?//' \
        -e 's/"msg":"[^"]*",?//' \
        -e 's/[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}//g' \
        ;;
    */nginx/*)
      _strip_ansi | sed -E \
        -e 's|^[0-9]{4}/[0-9]{2}/[0-9]{2} [0-9]{2}:[0-9]{2}:[0-9]{2} ||' \
        -e 's/ [0-9]+#[0-9]+:/ #:/' \
        -e 's/client: [^,]*,/client:,/' \
        ;;
    */redis/*)
      _strip_ansi | sed -E \
        -e 's/^[0-9]+:[A-Z] [0-9]{1,2} [A-Za-z]{3}( [0-9]{4})? [0-9:.]+ //' \
        ;;
    */postgres/*|*/standby/*)
      _strip_ansi | sed -E \
        -e 's/^[0-9]{4}-[0-9]{2}-[0-9]{2} [0-9:.]+ [A-Z]+ \[[0-9]+\] //' \
        ;;
    *)
      _strip_ansi ;;
  esac
}

# =============================================================================
# 单文件扫描：增量取字节 → 级别 grep → 指纹聚合 → 追加到对应类别文件
# 命中数累加到全局 TOTAL_HITS；轮转异常追加到 GAP_NOTES。
# 每类别输出封顶 CATEGORY_BODY_CAP 字节（防单类刷屏挤掉其他类别）。
# =============================================================================
_scan_one() {
  local path=$1
  local pat category size offset new_bytes hits_file norm_file counts_file hits classes gap_note
  local cur_id state prev_id prev_offset

  pat=$(_pattern_for "${path}" || true)
  if [[ -z "${pat}" ]]; then
    log_warn "${path} 无匹配的判定模式 · 跳过"
    return 0
  fi
  category=$(_category_of "${path}" || true)
  if [[ -z "${category}" ]]; then
    log_warn "${path} 无匹配的类别 · 跳过"
    return 0
  fi

  size=$(_size_of "${path}")
  cur_id=$(_file_id "${path}")
  if [[ -z "${cur_id}" ]]; then
    log_warn "${path} 无法 stat 获取 inode · 跳过（missingok）"
    return 0
  fi

  state=$(_state_get "${path}")
  prev_id=""
  prev_offset=""
  if [[ -n "${state}" ]]; then
    prev_id=${state%%|*}
    prev_offset=${state##*|}
  fi

  # 首次纳入分流：全局首跑（状态文件尚不存在）→ 从当前 size 起跳不追溯历史；
  # 状态文件已存在但该文件无记录 → 运行期新出现的日志文件，其全部内容都是新增，从 0 扫。
  if [[ -z "${prev_offset}" ]]; then
    if [[ -f "${STATE_FILE}" ]]; then
      log_info "${path} · 新出现文件（inode=${cur_id}）· 从 0 全扫"
      prev_offset=0
      prev_id=""
    else
      log_info "${path} · 首次纳入（offset=${size} · 不追溯历史）"
      _state_set "${path}" "${cur_id}" "${size}"
      printf '%s\n' "${path}" >> "${TMPD}/scanned-${category}"
      return 0
    fi
  fi

  new_bytes="${TMPD}/new.bytes"
  : > "${new_bytes}"
  gap_note=""

  # 判定顺序（从最可靠到最弱）：
  #   1. inode 变 → 文件被替换（rename 轮转/重建）：旧文件尾巴从 .1 按 inode 找回
  #   2. inode 同 + 存在 .1 且 .1 是"cp 副本"（mtime ≥ 当前文件）→ copytruncate：
  #      当前文件被截断重写过，offset 之后的旧内容只完整保留在 .1 里 → 补扫 .1 尾巴 + 从 0 扫当前
  #      （size 方向不可信：truncate 后立刻重写，size 仍可能 > offset —— 用户质疑的实锤）
  #   3. inode 同 + 无 .1 cp 副本 + size<offset → 就地截断但无 .1（手工 truncate）→ 报空隙
  #   4. inode 同 + size≥offset → 正常追加
  local dot1="${path}.1"
  local dot1_id="" dot1_mtime=0 cur_mtime
  cur_mtime=$(stat -c '%Y' -- "${path}" 2>/dev/null || stat -f '%m' -- "${path}" 2>/dev/null || echo 0)
  if [[ -f "${dot1}" ]]; then
    dot1_id=$(_file_id "${dot1}")
    dot1_mtime=$(stat -c '%Y' -- "${dot1}" 2>/dev/null || stat -f '%m' -- "${dot1}" 2>/dev/null || echo 0)
  fi

  if [[ "${cur_id}" != "${prev_id}" ]]; then
    # 情形 1：文件被替换
    log_info "${path} · 检测到文件被替换（inode ${prev_id:-?} → ${cur_id}）· 尝试从 .1 补齐旧文件尾巴"
    if [[ -n "${prev_id}" && -f "${dot1}" && "${dot1_id}" == "${prev_id}" ]]; then
      tail -c +$((prev_offset + 1)) "${dot1}" > "${new_bytes}"
    elif [[ -n "${prev_id}" ]]; then
      gap_note="${path}：文件被替换且 .1（inode ${dot1_id:-不存在}）对不上旧文件（${prev_id}）· 旧文件尾巴可能已丢失"
    fi
    tail -c +1 "${path}" >> "${new_bytes}"
  elif [[ -n "${dot1_id}" && "${dot1_id}" != "${cur_id}" && "${dot1_mtime}" -ge "${cur_mtime}" && "${dot1_mtime}" -gt 0 ]]; then
    # 情形 2：copytruncate（.1 是 cp 副本，mtime ≥ 当前文件被 truncate 重写的最后写入时间）
    log_info "${path} · 检测到 copytruncate（.1 为 cp 副本 · inode ${cur_id} → ${dot1_id}）· 补扫 .1 尾巴后从 0 扫当前文件"
    local s1
    s1=$(_size_of "${dot1}")
    if [[ "${s1}" -ge "${prev_offset}" ]]; then
      tail -c +$((prev_offset + 1)) "${dot1}" > "${new_bytes}"
    else
      gap_note="${path}：.1 大小（${s1}）小于上次偏移（${prev_offset}）· 截断空隙可能有遗漏"
    fi
    tail -c +1 "${path}" >> "${new_bytes}"
  elif [[ "${size}" -lt "${prev_offset}" ]]; then
    # 情形 3：就地截断但无 .1（手工 truncate / 异常）
    log_warn "${path} · 检测到就地截断（offset=${prev_offset} > size=${size}）但无 .1 · 报空隙"
    gap_note="${path}：就地截断但无 .1 副本 · offset ${prev_offset} 之后的内容已丢失"
    tail -c +1 "${path}" >> "${new_bytes}"
  elif [[ "${size}" -eq "${prev_offset}" ]]; then
    log_info "${path} · 无新增字节"
    printf '%s\n' "${path}" >> "${TMPD}/scanned-${category}"
    return 0
  else
    # 情形 4：正常追加
    tail -c +$((prev_offset + 1)) "${path}" > "${new_bytes}"
  fi
  _state_set "${path}" "${cur_id}" "${size}"

  hits_file="${TMPD}/hits"
  { grep -E "${pat}" "${new_bytes}" || true; } > "${hits_file}"
  hits=$(grep -c '' "${hits_file}" || true)
  if [[ "${hits}" == "0" ]]; then
    [[ -n "${gap_note}" ]] && GAP_NOTES+=("${gap_note}")
    log_info "${path} · 无 ≥error 级命中"
    printf '%s\n' "${path}" >> "${TMPD}/scanned-${category}"
    return 0
  fi

  # 指纹聚合：归一化 → 计数 → top N + 样本
  norm_file="${TMPD}/norm"
  counts_file="${TMPD}/counts"
  _normalize "${path}" < "${hits_file}" > "${norm_file}"
  sort "${norm_file}" | uniq -c | sort -rn > "${counts_file}"
  classes=$(grep -c '' "${counts_file}" || true)

  TOTAL_HITS=$((TOTAL_HITS + hits))
  [[ -n "${gap_note}" ]] && GAP_NOTES+=("${gap_note}")
  log_info "${path} · 命中 ${hits} 条（去重 ${classes} 类）"

  printf '%s\n' "${path}" >> "${TMPD}/scanned-${category}"
  local cat_file="${TMPD}/category-${category}"
  {
    printf '%s · 命中 %s 条 · 去重 %s 类\n' "${path}" "${hits}" "${classes}"
    local cnt fp ln sample
    while read -r cnt fp; do
      [[ -n "${fp}" ]] || continue
      ln=$({ grep -nF -m 1 -- "${fp}" "${norm_file}" || true; } | cut -d: -f1)
      sample=""
      [[ -n "${ln}" ]] && sample=$(sed -n "${ln}p" "${hits_file}" | cut -c 1-${SAMPLE_WIDTH})
      printf '[%sx] %s\n' "${cnt}" "$(printf '%s' "${fp}" | cut -c 1-${FP_WIDTH})"
      [[ -n "${sample}" ]] && printf '  样本：%s\n' "${sample}"
    done < <(head -n "${TOP_N}" "${counts_file}")
    if [[ "${classes}" -gt "${TOP_N}" ]]; then
      printf '  ……其余 %s 类略（完整日志 SSH 查 %s）\n' "$((classes - TOP_N))" "${path}"
    fi
    printf '\n'
  } >> "${cat_file}"
}

# =============================================================================
# 邮件（实现照 docs/ops/mail-notification.md §3 · 不要在此重新探索）
# =============================================================================
_load_mail_config() {
  local key val
  for key in SMTP_HOST SMTP_PORT SMTP_USER SMTP_PASS MAIL_FROM MAIL_TO; do
    if [[ -z "${!key:-}" ]] && [[ -f "${COSTRA_ENV_FILE}" ]]; then
      val=$(grep "^${key}=" "${COSTRA_ENV_FILE}" 2>/dev/null | tail -1 | cut -d= -f2- || true)
      [[ -n "${val}" ]] && printf -v "${key}" '%s' "${val}"
    fi
  done
  SMTP_HOST="${SMTP_HOST:-smtp.qq.com}"
  SMTP_PORT="${SMTP_PORT:-465}"
  MAIL_FROM="${MAIL_FROM:-${SMTP_USER:-}}"
}

_channel_ready() {
  [[ -n "${SMTP_USER:-}" && -n "${SMTP_PASS:-}" && -n "${MAIL_TO:-}" ]]
}

# _build_eml <subject_raw> <body_file> <eml_out>
_build_eml() {
  local subject=$1 body=$2 out=$3 encoded_subject
  # 非 ASCII → RFC 2047 base64 编码（QQ 对超长 encoded-word 宽容 · 单段即可）
  # 判定用 grep 而非 glob `*[! -~]*`：bash 3.2 的 case 解析器不接受方括号内空格开头的 range
  if LC_ALL=C grep -q '[^ -~]' <<< "${subject}"; then
    encoded_subject="=?UTF-8?B?$(printf '%s' "${subject}" | base64 | tr -d '\n')?="
  else
    encoded_subject=${subject}
  fi
  {
    printf '%s\r\n' "From: ${MAIL_FROM}"
    printf '%s\r\n' "To: ${MAIL_TO}"
    printf '%s\r\n' "Subject: ${encoded_subject}"
    printf '%s\r\n' "Date: $(date -R)"
    printf '%s\r\n' 'Content-Type: text/plain; charset=utf-8'
    printf '%s\r\n' ''
    sed 's/$/\r/' "${body}"
  } > "${out}"
}

# _send_eml <eml_file> : 成功 0 · 失败 1（调用方决定降级语义）
_send_eml() {
  local eml=$1
  local -a rcpt_args=()
  local rcpt old_ifs=${IFS}
  IFS=','   # for 循环的分词在求值时一次性完成 · 循环体内无需保持
  for rcpt in ${MAIL_TO}; do
    IFS=${old_ifs}
    rcpt=$(printf '%s' "${rcpt}" | tr -d '[:space:]')
    [[ -n "${rcpt}" ]] && rcpt_args+=("--mail-rcpt" "${rcpt}")
    IFS=','
  done
  IFS=${old_ifs}
  [[ ${#rcpt_args[@]} -gt 0 ]] || { log_error "MAIL_TO 解析后无有效收件人"; return 1; }

  curl --ssl-reqd --silent --show-error --max-time 15 \
    --url "smtps://${SMTP_HOST}:${SMTP_PORT}" \
    --login-options 'AUTH=LOGIN' \
    --user "${SMTP_USER}:${SMTP_PASS}" \
    --mail-from "${MAIL_FROM}" \
    ${rcpt_args[@]+"${rcpt_args[@]}"} \
    --upload-file "${eml}"
}

# _deliver <subject> <body_file> : 统一出口（dry-run 预览 / 通道禁用降级 / 发送失败降级）
_deliver() {
  local subject=$1 body=$2
  local eml="${TMPD}/report.eml"

  if [[ "${DRY_RUN}" == "1" ]]; then
    _load_mail_config
    MAIL_FROM="${MAIL_FROM:-<未配置>}" MAIL_TO="${MAIL_TO:-<未配置>}" _build_eml "${subject}" "${body}" "${eml}"
    log_dry "将发送邮件（主题：${subject}）· eml 预览（前 40 行）："
    head -40 "${eml}"
    log_dry "不写 offset · 不发送"
    return 0
  fi

  _load_mail_config
  if ! _channel_ready; then
    log_warn "SMTP_USER/SMTP_PASS/MAIL_TO 未配齐（${COSTRA_ENV_FILE}）· 邮件通道禁用 · 报告仅留日志"
    cat "${body}"
    return 0
  fi

  _build_eml "${subject}" "${body}" "${eml}"
  if _send_eml "${eml}"; then
    log_success "邮件已投递至 ${SMTP_HOST}:${SMTP_PORT}（收件人：${MAIL_TO}）"
  else
    # [ERROR] 进自身 cron 日志 · 次日被本任务扫到（自愈回路）· 但退出码保持 0 不阻断
    log_error "邮件发送失败（${SMTP_HOST}:${SMTP_PORT}）· 主题：${subject}"
  fi
}

# =============================================================================
# --test-send：跳过扫描，直接验证 465 出站 + 认证 + 投递
# =============================================================================
if [[ "${TEST_SEND}" == "1" ]]; then
  _load_mail_config
  if ! _channel_ready; then
    die "--test-send 需要 SMTP_USER/SMTP_PASS/MAIL_TO 配齐（环境变量或 ${COSTRA_ENV_FILE}）"
  fi
  TEST_BODY="${TMPD}/test-body.txt"
  {
    printf 'costra error-report 邮件通道测试\n'
    printf '主机：%s\n' "$(hostname)"
    printf '时间：%s\n' "$(date '+%F %T %z')"
    printf '若收到本邮件，说明 curl SMTPS(%s)→%s 链路已走通。\n' "${SMTP_PORT}" "${SMTP_HOST}"
  } > "${TEST_BODY}"
  _deliver "[Costra] error-report 通道测试 · $(hostname) · $(date '+%F %T')" "${TEST_BODY}"
  exit 0
fi

# =============================================================================
# 主流程：扫描 → 按类别组装（每类配额封顶）→ 推送（零命中也发"平安"心跳 · 2026-08-14 变更）
# =============================================================================
TOTAL_HITS=0
declare -a GAP_NOTES=()

log_info "扫描目录：${LOG_DIR} · 状态文件：${STATE_FILE}"
while IFS= read -r file; do
  _scan_one "${file}"
done < <(_scan_targets)

BODY_FILE="${TMPD}/body.txt"
{
  printf '[Costra] error-report · %s · %s\n' "$(hostname)" "$(date '+%F %T %z')"
  printf '窗口：自上次扫描起（offset 增量）· 命中 %s 条\n\n' "${TOTAL_HITS}"
} > "${BODY_FILE}"

# 按类别分节：命中内容按配额封顶 · 无命中的已扫描类别展示文件清单
for _cat in server nginx redis postgres standby maintenance; do
  _cat_file="${TMPD}/category-${_cat}"
  _scanned_file="${TMPD}/scanned-${_cat}"
  if [[ -f "${_cat_file}" ]]; then
    _cat_size=$(_size_of "${_cat_file}")
    {
      printf '== %s ==\n' "${_cat}"
      if [[ "${_cat_size}" -le "${CATEGORY_BODY_CAP}" ]]; then
        cat "${_cat_file}"
      else
        head -c "${CATEGORY_BODY_CAP}" "${_cat_file}"
        printf '……（本类别 %s 字节超配额 %s，已截断 · 完整日志 SSH 查 /data/logs）\n\n' "${_cat_size}" "${CATEGORY_BODY_CAP}"
      fi
    } >> "${BODY_FILE}"
  elif [[ -f "${_scanned_file}" ]]; then
    {
      printf '== %s · 无 ≥error 级命中 ==\n' "${_cat}"
      while IFS= read -r _sf; do
        printf '  %s\n' "${_sf}"
      done < "${_scanned_file}"
      printf '\n'
    } >> "${BODY_FILE}"
  fi
done

if [[ ${#GAP_NOTES[@]} -gt 0 ]]; then
  {
    printf '轮转提示：\n'
    for _note in ${GAP_NOTES[@]+"${GAP_NOTES[@]}"}; do
      printf -- '- %s\n' "${_note}"
    done
  } >> "${BODY_FILE}"
fi

# 全局双保险截断（正常不会触发 · 类别配额之和已低于此值）
body_size=$(_size_of "${BODY_FILE}")
if [[ "${body_size}" -gt "${BODY_LIMIT}" ]]; then
  TRIMMED="${TMPD}/body-trimmed.txt"
  head -c "${BODY_LIMIT}" "${BODY_FILE}" > "${TRIMMED}"
  printf '\n……（正文 %s 字节超限，已截断至 %s · 完整日志 SSH 查 /data/logs）\n' "${body_size}" "${BODY_LIMIT}" >> "${TRIMMED}"
  BODY_FILE="${TRIMMED}"
fi

if [[ "${TOTAL_HITS}" == "0" ]]; then
  # 平安心跳：连续收不到它本身即是"任务/通道挂了"的信号
  log_success "无新增 ≥error 级日志 · 推送平安邮件"
fi
_deliver "[Costra] error-report · $(hostname) · $(date '+%F') · 命中 ${TOTAL_HITS} 条" "${BODY_FILE}"
exit 0
