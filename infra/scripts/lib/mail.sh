# shellcheck shell=bash
# =============================================================================
# Costra · 邮件发送公共库（curl SMTPS 465 → QQ 邮箱中继）
# =============================================================================
# 事实源：docs/ops/mail-notification.md §3 —— 不要在本文件重新探索，改动先改该文档。
# 依赖：调用方先 source lib/common.sh（log_* / DRY_RUN）；2026-08-16 从
#   report-error-logs.sh 抽取，供全部邮件消费方复用（report-error-logs.sh · monitor-perf.sh）。
#
# 提供：
#   mail_load_config <env_file>                读 SMTP_HOST/SMTP_PORT/SMTP_USER/SMTP_PASS/MAIL_FROM/MAIL_TO
#                                              （环境变量优先 · env 文件兜底；HOST 默认 smtp.qq.com ·
#                                                PORT 默认 465 · MAIL_FROM 默认 =SMTP_USER）
#   mail_channel_ready                         SMTP_USER/SMTP_PASS/MAIL_TO 配齐返回 0，否则 1
#   mail_build_eml <subject> <body> <eml_out>  CRLF 行尾 + 中文主题 RFC 2047 编码
#   mail_send_eml <eml_file>                   成功 0 · 失败 1（调用方决定降级语义）
#   mail_deliver <env_file> <subject> <body>   统一出口：加载配置 → dry-run 预览 /
#                                              通道禁用降级（只写日志退出 0）/ 发送失败 log_error
#                                              但不以非零退出（[ERROR] 进调用方自身 cron 日志形成自愈回路）
# =============================================================================

mail_load_config() {
  local env_file=$1 key val
  for key in SMTP_HOST SMTP_PORT SMTP_USER SMTP_PASS MAIL_FROM MAIL_TO; do
    if [[ -z "${!key:-}" ]] && [[ -f "${env_file}" ]]; then
      val=$(grep "^${key}=" "${env_file}" 2>/dev/null | tail -1 | cut -d= -f2- || true)
      [[ -n "${val}" ]] && printf -v "${key}" '%s' "${val}"
    fi
  done
  SMTP_HOST="${SMTP_HOST:-smtp.qq.com}"
  SMTP_PORT="${SMTP_PORT:-465}"
  MAIL_FROM="${MAIL_FROM:-${SMTP_USER:-}}"
}

mail_channel_ready() {
  [[ -n "${SMTP_USER:-}" && -n "${SMTP_PASS:-}" && -n "${MAIL_TO:-}" ]]
}

mail_build_eml() {
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

mail_send_eml() {
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

mail_deliver() {
  local env_file=$1 subject=$2 body=$3
  local eml
  eml=$(mktemp /tmp/costra-mail.XXXXXX)

  mail_load_config "${env_file}"

  if [[ "${DRY_RUN}" == "1" ]]; then
    MAIL_FROM="${MAIL_FROM:-<未配置>}" MAIL_TO="${MAIL_TO:-<未配置>}" mail_build_eml "${subject}" "${body}" "${eml}"
    log_dry "将发送邮件（主题：${subject}）· eml 预览（前 40 行）："
    head -40 "${eml}"
    log_dry "dry-run · 不发送"
    rm -f "${eml}"
    return 0
  fi

  if ! mail_channel_ready; then
    log_warn "SMTP_USER/SMTP_PASS/MAIL_TO 未配齐（${env_file}）· 邮件通道禁用 · 报告仅留日志"
    cat "${body}"
    rm -f "${eml}"
    return 0
  fi

  mail_build_eml "${subject}" "${body}" "${eml}"
  if mail_send_eml "${eml}"; then
    log_success "邮件已投递至 ${SMTP_HOST}:${SMTP_PORT}（收件人：${MAIL_TO}）"
  else
    # [ERROR] 进调用方自身 cron 日志 · 次日被 error-report 扫到（自愈回路）· 但退出码保持 0 不阻断
    log_error "邮件发送失败（${SMTP_HOST}:${SMTP_PORT}）· 主题：${subject}"
  fi
  rm -f "${eml}"
}
