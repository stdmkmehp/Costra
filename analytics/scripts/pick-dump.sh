#!/usr/bin/env bash
# scripts/pick-dump.sh · 选定 dump 文件（由 analyze-in-container.sh source 后调用 pick_dump）

_pick_dump_recent_list() {
  [[ -d "${DUMP_INBOX}" ]] || return 0
  find "${DUMP_INBOX}" -maxdepth 1 -type f -name '*.sql.gz' -mtime -3 2>/dev/null \
    | while IFS= read -r file; do
        printf '%s  %s\n' "$(epoch_to_cst_iso "$(file_mtime_epoch "${file}")")" "${file}"
      done | sort -r || true
}

_pick_dump_alert() {
  local reason="$1"
  log_warn "无可用 dump：${reason}"

  local inbox_list=""
  if [[ -d "${DUMP_INBOX}" ]]; then
    inbox_list="$(_pick_dump_recent_list)"
  else
    inbox_list="目录不存在: ${DUMP_INBOX}"
  fi
  [[ -n "${inbox_list}" ]] || inbox_list="(空)"

  set +e
  node "${SCRIPT_DIR}/send-failure-mail.mjs" \
    --reason no-dump --inbox "${DUMP_INBOX}" --inbox-list "${inbox_list}" \
    || log_warn "告警邮件发送失败（SMTP 可能不可用）"
  set -e

  log_warn "无可用 dump，本次不生成报告"
  [[ ! -d "${TMP_DIR}" ]] || rm -rf "${TMP_DIR}"
  NO_DUMP=1
  export NO_DUMP
}

pick_dump() {
  local was_explicit=0
  NO_DUMP=0

  if [[ -n "${DUMP_FILE}" ]]; then
    was_explicit=1
    [[ -f "${DUMP_FILE}" ]] || die "指定的 dump 文件不存在: ${DUMP_FILE}"
    [[ -r "${DUMP_FILE}" ]] || die "指定的 dump 文件不可读: ${DUMP_FILE}"
    [[ "${DUMP_FILE}" == *.sql.gz ]] || die "dump 文件必须以 .sql.gz 结尾: ${DUMP_FILE}"
    log_info "使用指定 dump: ${DUMP_FILE}"
  else
    if [[ ! -d "${DUMP_INBOX}" ]]; then
      _pick_dump_alert "DUMP_INBOX 目录不存在: ${DUMP_INBOX}"
      return 0
    fi

    DUMP_FILE=$(find "${DUMP_INBOX}" -maxdepth 1 -type f -name '*.sql.gz' 2>/dev/null \
      | while IFS= read -r file; do
          printf '%s\t%s\n' "$(file_mtime_epoch "${file}")" "${file}"
        done | sort -rn | head -1 | cut -f2-)

    if [[ -z "${DUMP_FILE}" ]]; then
      _pick_dump_alert "DUMP_INBOX 目录为空（无 .sql.gz 文件）"
      return 0
    fi
    log_info "自动选定最新 dump: ${DUMP_FILE}"
  fi

  DUMP_MTIME_EPOCH=$(file_mtime_epoch "${DUMP_FILE}")
  DUMP_MTIME_ISO=$(file_mtime_iso "${DUMP_FILE}")
  local age_sec=$(( $(date +%s) - DUMP_MTIME_EPOCH ))

  if [[ "${age_sec}" -gt 172800 ]]; then
    if [[ "${was_explicit}" == "1" ]]; then
      log_warn "指定 dump 已超过 48 小时（${DUMP_MTIME_ISO}），按手动回看请求继续"
    else
      _pick_dump_alert "最新 dump 已超过 48 小时：${DUMP_FILE}（${DUMP_MTIME_ISO}）"
      return 0
    fi
  fi

  export DUMP_FILE DUMP_MTIME_ISO DUMP_MTIME_EPOCH NO_DUMP
}
