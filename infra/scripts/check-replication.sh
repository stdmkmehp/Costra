#!/usr/bin/env bash
# =============================================================================
# Costra · PG 主从复制健康检查（主库 / 从库机器均可跑 · cron 定期调用）
# =============================================================================
# 方案文档：docs/ops/pg-standby-backup.md §6
#
# 自动探测本机角色：
#   主库 → 查复制槽 wal_status/safe_wal_size（WAL 护栏是否即将/已经触发）
#          + pg_stat_replication（从库是否 streaming / replay_lag 是否超阈值）
#   从库 → 查 pg_stat_wal_receiver（walreceiver / 距上次消息 / 上游已知 WAL
#          末端 → receive → replay 三段进度）
#
# 异常判定（任一命中 → 退出码 1 + 可选企业微信告警）：
#   主库视角：同步复制被意外开启 · 复制槽缺失/unreserved/lost · safe_wal_size
#             低于阈值 · 从库非唯一 async streaming · replay_lag 超阈值
#   从库视角：hot_standby_feedback 非 off · walreceiver 停止 · 消息超时
#             · 上游已知末端到 receive/replay 或 receive 到 replay 超阈值
#
# 关于 --receiver-timeout 的判据（别按"10s"理解）：
#   10s 是 wal_receiver_status_interval，方向是「从库 → 主库」上报。
#   主库 → 从库的 keepalive 由 wal_sender_timeout（默认 60s）的一半决定，
#   因此空闲期 last_msg_receipt_time 落后 ~30s 属正常，默认阈值 120s 留足余量。
#
# 告警：配置 WECOM_WEBHOOK_URL（企业微信群机器人 · 写在 env 文件或环境变量）
#   未配置时仅写日志 + 非零退出码（cron 可自行接 `|| 其他告警通道`）。
#
# 用法：
#   ./check-replication.sh                          # 一次性检查（默认阈值）
#   ./check-replication.sh --max-lag-seconds 120    # 自定义主库 lag 阈值
#   ./check-replication.sh --container costra-standby-pg   # 指定容器（从库机器用）
#   ./check-replication.sh --dry-run                # 只打印计划
#
# 从库机器（= staging 机器 + 分析机）跑法（容器名 + env 文件都要换）：
#   COSTRA_ENV_FILE=/data/conf/standby.env \
#     ./check-replication.sh --container costra-standby-pg
#
# 退出码：0 = 复制健康 · 1 = 异常（或本机 PG 容器不健康）
# =============================================================================

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=lib/common.sh
source "${SCRIPT_DIR}/lib/common.sh"

PG_CONTAINER="costra-postgres"
APPLICATION_NAME="costra_standby"
REPLICATION_SLOT="costra_standby"
MAX_LAG_SECONDS=60          # 主库：replay_lag 阈值（秒）
MAX_APPLY_BYTES=268435456   # 从库：接收-回放字节差阈值（默认 256MB）
RECEIVER_TIMEOUT=120        # 从库：距上次收到主库消息阈值（秒 · 见 --help 说明）
SAFE_WAL_MIN_BYTES=2147483648   # 主库：复制槽 safe_wal_size 低水位（默认 2GB · 护栏 10GB 的 20%）

# --- 解析参数 ---
parse_common_args "$@"
while [[ $# -gt 0 ]]; do
  case "$1" in
    --max-lag-seconds)
      [[ $# -ge 2 ]] || die "--max-lag-seconds 需要一个秒数"
      MAX_LAG_SECONDS=$2
      shift 2
      ;;
    --max-apply-bytes)
      [[ $# -ge 2 ]] || die "--max-apply-bytes 需要一个字节数"
      MAX_APPLY_BYTES=$2
      shift 2
      ;;
    --receiver-timeout)
      [[ $# -ge 2 ]] || die "--receiver-timeout 需要一个秒数"
      RECEIVER_TIMEOUT=$2
      shift 2
      ;;
    --safe-wal-min-bytes)
      [[ $# -ge 2 ]] || die "--safe-wal-min-bytes 需要一个字节数"
      SAFE_WAL_MIN_BYTES=$2
      shift 2
      ;;
    --container)
      [[ $# -ge 2 ]] || die "--container 需要一个容器名"
      PG_CONTAINER=$2
      shift 2
      ;;
    --dry-run|-y|--yes) shift ;;
    -h|--help)
      grep '^#' "$0" | sed 's/^# \{0,1\}//' | head -38
      exit 0
      ;;
    *) die "未知参数: $1 · 用 --help 查看" ;;
  esac
done

[[ "${MAX_LAG_SECONDS}" =~ ^[0-9]+$ ]] || die "--max-lag-seconds 必须是非负整数"
[[ "${MAX_APPLY_BYTES}" =~ ^[0-9]+$ ]] || die "--max-apply-bytes 必须是非负整数"
[[ "${RECEIVER_TIMEOUT}" =~ ^[0-9]+$ ]] || die "--receiver-timeout 必须是非负整数"
[[ "${SAFE_WAL_MIN_BYTES}" =~ ^[0-9]+$ ]] || die "--safe-wal-min-bytes 必须是非负整数"

require_cmd docker

# =============================================================================
# 工具函数
# =============================================================================
# 告警 webhook：优先环境变量；env 文件存在时再读取可选配置。SQL 始终走容器内
# Unix socket，因此从库不需要保存 prod 的 PG_COSTRA_PW。
if [[ -z "${WECOM_WEBHOOK_URL:-}" ]] && [[ -f "${COSTRA_ENV_FILE}" ]]; then
  WECOM_WEBHOOK_URL=$(grep '^WECOM_WEBHOOK_URL=' "${COSTRA_ENV_FILE}" 2>/dev/null | tail -1 | cut -d= -f2- || true)
fi

_pg_scalar() {
  docker exec "${PG_CONTAINER}" \
    psql -U costra -d costra -tA -v ON_ERROR_STOP=1 -c "$1"
}

# _notify <title> <detail> : 异常时发企业微信（未配置 webhook 则仅日志）
_notify() {
  local title=$1 detail=$2 msg body_file http_code body body_preview
  log_warn "${title} · ${detail}"
  if [[ -n "${WECOM_WEBHOOK_URL}" ]]; then
    if ! command -v curl >/dev/null 2>&1; then
      log_warn "缺少 curl · 企业微信告警未发送"
      return 0
    fi
    msg="[Costra] $(hostname) · ${title} · ${detail}"
    msg=${msg//\\/\\\\}
    msg=${msg//\"/\\\"}
    msg=${msg//$'\n'/\\n}
    msg=${msg//$'\r'/}
    msg=${msg//$'\t'/\\t}
    body_file=$(mktemp /tmp/costra-wecom-response.XXXXXX)
    if ! http_code=$(curl -sS -m 10 -o "${body_file}" -w '%{http_code}' \
      "${WECOM_WEBHOOK_URL}" \
      -H 'Content-Type: application/json' \
      -d "{\"msgtype\":\"text\",\"text\":{\"content\":\"${msg}\"}}"); then
      log_warn "企业微信告警发送失败（网络或 curl 错误）"
      rm -f "${body_file}"
      return 0
    fi
    body=$(cat "${body_file}")
    rm -f "${body_file}"
    if [[ ! "${http_code}" =~ ^2[0-9][0-9]$ ]] \
      || ! grep -Eq '"errcode"[[:space:]]*:[[:space:]]*0([,}])' <<< "${body}"; then
      body_preview=${body//$'\n'/ }
      log_warn "企业微信告警被拒绝（HTTP=${http_code} · response=${body_preview:0:200}）"
    fi
  fi
}

_register_failure() {
  FAILURES=$((FAILURES + 1))
}

# =============================================================================
# 主流程
# =============================================================================
FAILURES=0

if [[ "${DRY_RUN}" == "1" ]]; then
  log_dry "检查 ${PG_CONTAINER} 健康 → 探测角色 → 按角色校验复制指标（阈值 lag=${MAX_LAG_SECONDS}s · apply=${MAX_APPLY_BYTES}B · timeout=${RECEIVER_TIMEOUT}s）"
  exit 0
fi

HEALTH=$(docker inspect --format '{{.State.Health.Status}}' "${PG_CONTAINER}" 2>/dev/null || echo "missing")
if [[ "${HEALTH}" != "healthy" ]]; then
  _notify "PG 复制检查无法执行" "本机 ${PG_CONTAINER} 状态异常（${HEALTH}）"
  exit 1
fi

IS_RECOVERY=$(_pg_scalar "SELECT pg_is_in_recovery()")
if [[ "${IS_RECOVERY}" == "t" ]]; then
  ROLE_LABEL="从库（standby）"
else
  ROLE_LABEL="主库（primary）"
fi
log_info "本机角色：${ROLE_LABEL}"

if [[ "${IS_RECOVERY}" == "f" ]]; then
  # ============================ 主库视角 ============================
  SYNC_STANDBY_NAMES=$(_pg_scalar "SHOW synchronous_standby_names")
  if [[ -n "${SYNC_STANDBY_NAMES}" ]]; then
    _notify "主库意外启用同步复制" "synchronous_standby_names=${SYNC_STANDBY_NAMES} · 从库故障可能阻塞 COMMIT，违反纯异步红线"
    _register_failure
  fi

  # ── 先查复制槽状态：这是 max_slot_wal_keep_size=10GB 护栏的唯一可观测出口 ──
  # wal_status 语义（PG13+）：
  #   reserved   = 所需 WAL 都在 max_wal_size 之内（健康）
  #   extended   = 已超出 max_wal_size，但仍在 max_slot_wal_keep_size 之内（可接受）
  #   unreserved = 已超出护栏、WAL 正在被回收 —— 仍有救：立刻抢救从库还能追平
  #   lost       = 所需 WAL 已被删除 —— 从库无法再追平，必须重做 pg_basebackup
  # 只报"从库失联"无法区分 unreserved / lost，而这两者的处置动作完全不同，
  # 因此必须单独暴露。safe_wal_size = 距离槽失效还剩多少字节（负值即已越界）。
  SLOT_ROW=$(_pg_scalar "SELECT COALESCE(wal_status, 'unknown') || '|' || COALESCE(safe_wal_size::text, 'null') || '|' || active FROM pg_replication_slots WHERE slot_name='${REPLICATION_SLOT}'")
  if [[ -z "${SLOT_ROW}" ]]; then
    _notify "复制槽不存在" "pg_replication_slots 无 ${REPLICATION_SLOT} · 从库将无法保留 WAL（是否被误删？重跑 setup-replication-primary.sh）"
    _register_failure
  else
    SLOT_WAL_STATUS=${SLOT_ROW%%|*}
    SLOT_REST=${SLOT_ROW#*|}
    SLOT_SAFE_SIZE=${SLOT_REST%%|*}
    SLOT_ACTIVE=${SLOT_REST##*|}
    log_info "复制槽 ${REPLICATION_SLOT}: wal_status=${SLOT_WAL_STATUS} · active=${SLOT_ACTIVE} · safe_wal_size=${SLOT_SAFE_SIZE}"
    case "${SLOT_WAL_STATUS}" in
      lost)
        _notify "复制槽已失效（lost）" "所需 WAL 已被回收 · 从库无法追平 · 必须重做 pg_basebackup（方案文档 §8.3）"
        _register_failure
        ;;
      unreserved)
        _notify "复制槽越过 WAL 护栏（unreserved）" "WAL 正在被回收 · 立刻抢救从库仍可追平，再拖将变为 lost（方案文档 §8.3）"
        _register_failure
        ;;
      reserved)
        ;;
      extended)
        log_warn "复制槽 WAL 已超 max_wal_size（extended）· 仍在 10GB 护栏内 · 关注从库是否在追平"
        ;;
      *)
        _notify "复制槽状态未知" "wal_status=${SLOT_WAL_STATUS} 不在 PG15 合法集合 reserved/extended/unreserved/lost 内 · fail closed"
        _register_failure
        ;;
    esac
    # safe_wal_size 低水位预警（< SAFE_WAL_MIN_BYTES 即将 unreserved）
    if [[ "${SLOT_SAFE_SIZE}" != "null" ]] && [[ "${SLOT_SAFE_SIZE}" =~ ^-?[0-9]+$ ]]; then
      if [[ "${SLOT_SAFE_SIZE}" -lt "${SAFE_WAL_MIN_BYTES}" ]]; then
        _notify "复制槽 WAL 余量不足" "safe_wal_size=$((SLOT_SAFE_SIZE / 1048576))MB 低于阈值 $((SAFE_WAL_MIN_BYTES / 1048576))MB · 槽即将失效"
        _register_failure
      fi
    fi
  fi

  REPL_COUNT=$(_pg_scalar "SELECT count(*) FROM pg_stat_replication WHERE application_name='${APPLICATION_NAME}'")
  ASYNC_STREAM_COUNT=$(_pg_scalar "SELECT count(*) FROM pg_stat_replication WHERE application_name='${APPLICATION_NAME}' AND state='streaming' AND sync_state='async'")
  if [[ "${REPL_COUNT}" != "1" || "${ASYNC_STREAM_COUNT}" != "1" ]]; then
    REPL_STATE=$(_pg_scalar "SELECT COALESCE(string_agg(state || '/' || sync_state, ','), '(无)') FROM pg_stat_replication WHERE application_name='${APPLICATION_NAME}'")
    _notify "从库连接状态异常" "要求唯一 async/streaming 行，实际 count=${REPL_COUNT} · async_streaming=${ASYNC_STREAM_COUNT} · state=${REPL_STATE}"
    _register_failure
  else
    REPLAY_LAG=$(_pg_scalar "SELECT COALESCE((EXTRACT(EPOCH FROM replay_lag))::int, 0) FROM pg_stat_replication WHERE application_name='${APPLICATION_NAME}'")
    SENT_REPLAY_DIFF=$(_pg_scalar "SELECT GREATEST(COALESCE(pg_wal_lsn_diff(sent_lsn, replay_lsn), 0), 0)::bigint FROM pg_stat_replication WHERE application_name='${APPLICATION_NAME}'")
    log_info "从库 async/streaming ✓ · replay_lag=${REPLAY_LAG}s · 已发送-已回放=${SENT_REPLAY_DIFF}B"
    if [[ "${REPLAY_LAG}" -gt "${MAX_LAG_SECONDS}" ]]; then
      _notify "从库回放滞后" "replay_lag=${REPLAY_LAG}s 超过阈值 ${MAX_LAG_SECONDS}s"
      _register_failure
    fi
  fi
else
  # ============================ 从库视角 ============================
  HOT_STANDBY_FEEDBACK=$(_pg_scalar "SHOW hot_standby_feedback")
  if [[ "${HOT_STANDBY_FEEDBACK}" != "off" ]]; then
    _notify "从库反向反馈已开启" "hot_standby_feedback=${HOT_STANDBY_FEEDBACK} · 可能阻碍主库 vacuum"
    _register_failure
  fi

  RX_COUNT=$(_pg_scalar "SELECT count(*) FROM pg_stat_wal_receiver WHERE status='streaming'")
  if [[ "${RX_COUNT}" != "1" ]]; then
    _notify "从库 walreceiver 异常" "要求唯一 streaming 行，实际 ${RX_COUNT} 行"
    _register_failure
  else
    # latest_end_lsn 是上游 WAL sender 最近告知的 WAL 尾部。只比较 receive-replay
    # 会漏掉“刚重连、两者同步追赶但仍整体落后主库”的陈旧从库。
    FRESHNESS_ROW=$(_pg_scalar "SELECT
      COALESCE((EXTRACT(EPOCH FROM (now() - last_msg_receipt_time)))::bigint, 99999)::text || '|' ||
      CASE WHEN latest_end_lsn IS NULL OR pg_last_wal_receive_lsn() IS NULL
        THEN 'null'
        ELSE GREATEST(pg_wal_lsn_diff(latest_end_lsn, pg_last_wal_receive_lsn()), 0)::bigint::text END || '|' ||
      CASE WHEN pg_last_wal_receive_lsn() IS NULL OR pg_last_wal_replay_lsn() IS NULL
        THEN 'null'
        ELSE GREATEST(pg_wal_lsn_diff(pg_last_wal_receive_lsn(), pg_last_wal_replay_lsn()), 0)::bigint::text END || '|' ||
      CASE WHEN latest_end_lsn IS NULL OR pg_last_wal_replay_lsn() IS NULL
        THEN 'null'
        ELSE GREATEST(pg_wal_lsn_diff(latest_end_lsn, pg_last_wal_replay_lsn()), 0)::bigint::text END
      FROM pg_stat_wal_receiver WHERE status='streaming'")
    IFS='|' read -r LAST_MSG_AGE RECEIVE_BACKLOG APPLY_DIFF TOTAL_BACKLOG <<< "${FRESHNESS_ROW}"
    if [[ "${RECEIVE_BACKLOG}" == "null" || "${APPLY_DIFF}" == "null" || "${TOTAL_BACKLOG}" == "null" ]]; then
      _notify "从库新鲜度不可判定" "latest_end/receive/replay LSN 任一为空 · fail closed，不允许本轮备份"
      _register_failure
    else
      log_info "walreceiver streaming ✓ · 消息=${LAST_MSG_AGE}s · 上游→接收=${RECEIVE_BACKLOG}B · 接收→回放=${APPLY_DIFF}B · 总积压=${TOTAL_BACKLOG}B"
      if [[ "${RECEIVE_BACKLOG}" -gt "${MAX_APPLY_BYTES}" ]]; then
        _notify "从库传输积压" "上游已知 WAL 尾部到接收位置相差 $((RECEIVE_BACKLOG / 1048576))MB，超过阈值 $((MAX_APPLY_BYTES / 1048576))MB"
        _register_failure
      fi
      if [[ "${APPLY_DIFF}" -gt "${MAX_APPLY_BYTES}" ]]; then
        _notify "从库回放积压" "已接收未回放 WAL $((APPLY_DIFF / 1048576))MB，超过阈值 $((MAX_APPLY_BYTES / 1048576))MB"
        _register_failure
      fi
      if [[ "${TOTAL_BACKLOG}" -gt "${MAX_APPLY_BYTES}" ]]; then
        _notify "从库总体陈旧" "上游已知 WAL 尾部到回放位置相差 $((TOTAL_BACKLOG / 1048576))MB，超过阈值 $((MAX_APPLY_BYTES / 1048576))MB"
        _register_failure
      fi
    fi
    if [[ "${LAST_MSG_AGE}" -gt "${RECEIVER_TIMEOUT}" ]]; then
      _notify "主库失联" "距上次收到主库消息 ${LAST_MSG_AGE}s 超过阈值 ${RECEIVER_TIMEOUT}s"
      _register_failure
    fi
  fi
fi

if [[ "${FAILURES}" -gt 0 ]]; then
  log_error "复制检查发现 ${FAILURES} 项异常"
  exit 1
fi

log_success "复制健康（${ROLE_LABEL}）"
exit 0
