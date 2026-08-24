#!/usr/bin/env bash
# =============================================================================
# Costra · 从库（机器②）cron 安装（唯一事实源 · 幂等 · 替代手工 heredoc）
# =============================================================================
# 适用场景：仅机器②（staging 机器 + 分析机 · costra-prod-slave）。
# 安装内容（对应 docs/ops/pg-standby-backup.md §5.2）：
#   1. /etc/cron.d/costra-standby
#      - 每小时 check-replication.sh（latest-end/receive/replay 三段新鲜度门禁）
#      - 每 6h（0 分）check && backup
#        组合：复制健康才产出，防"格式正常但陈旧"的备份；
#        落 /data/slave/backups（= analytics DUMP_INBOX）
#      - 每天 6:27 restore-staging-from-prod.sh -y（无人值守）
#        在 6:00 备份窗口之后，用最新 standby-*.sql.gz + scheduled-*.avatars.tar.gz
#        自动刷新本机 staging 栈（prod 数据 → stg.costra.cloud）
#   2. /data/logs/maintenance 下 touch check-replication.log / standby-backup.log / staging-restore.log（0600）
#   3. 安装共用 logrotate 模板 /etc/logrotate.d/costra-ops
#
# 红线：
#   - 严禁在机器①（prod）运行：本脚本以防呆校验 costra-standby-pg 容器存在。
#   - 严禁在机器② 运行 maintenance.sh install-cron（purge-* 会误伤同机 staging 栈）。
#   - backup-db.sh 自带 flock，cron 外层不加锁；组合命令必须 { ...; } 同日志。
#
# 用法：
#   ./install-standby-cron.sh            # 正式安装（幂等 · 覆盖写 cron 文件）
#   ./install-standby-cron.sh --dry-run  # 仅打印将写入的内容
#
# 退出码：0 = 成功 · 1 = 失败
# =============================================================================

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=lib/common.sh
source "${SCRIPT_DIR}/lib/common.sh"

CRON_FILE="/etc/cron.d/costra-standby"
STANDBY_ENV="${COSTRA_CONF_DIR}/standby.env"
BACKUP_DIR="/data/slave/backups"
# 与主库 maintenance.sh 对齐：运维脚本日志统一落子目录，/data/logs 根目录只留服务日志
LOG_DIR="/data/logs/maintenance"

parse_common_args "$@"
while [[ $# -gt 0 ]]; do
  case "$1" in
    --dry-run|-y|--yes) shift ;;       # common 已处理 · noop
    -h|--help)
      grep '^#' "$0" | sed 's/^# \{0,1\}//' | head -28
      exit 0 ;;
    *) die "未知参数: $1 · 用 --help 查看" ;;
  esac
done

# =============================================================================
# 前置校验（dry-run 同样执行 · 都是只读检查）
# =============================================================================
require_cmd docker

# 防呆①：必须在机器②——costra-standby-pg 容器存在（stopped 也算存在，
# cron 装好后再由 check-replication 持续告警其健康）。
if ! docker inspect costra-standby-pg >/dev/null 2>&1; then
  die "本机无 costra-standby-pg 容器 · 本脚本只允许在机器②（从库）运行"
fi

# 防呆②：standby.env 必须存在（cron 行以 COSTRA_ENV_FILE 引用它读取可选 webhook）。
require_file "${STANDBY_ENV}"

# =============================================================================
# 生成 cron 内容（cron 不展开 shell 变量 · 全部展开为字面绝对路径）
# =============================================================================
CHECK_CMD="COSTRA_ENV_FILE=${STANDBY_ENV} ${SCRIPT_DIR}/check-replication.sh --container costra-standby-pg"
BACKUP_CMD="COSTRA_ENV_FILE=${STANDBY_ENV} ${SCRIPT_DIR}/backup-db.sh --db-only --container costra-standby-pg --prefix standby --backup-dir ${BACKUP_DIR}"
RESTORE_CMD="${SCRIPT_DIR}/restore-staging-from-prod.sh -y"

content="SHELL=/bin/bash
PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin

# ── Costra 从库定时任务（由 install-standby-cron.sh 生成 · 勿手改）──
# 方案：docs/ops/pg-standby-backup.md §5.2 · 日志统一落在 ${LOG_DIR}

# 复制健康检查（每小时 · 47 分）
47 * * * * root ${CHECK_CMD} >> ${LOG_DIR}/check-replication.log 2>&1

# 从库 DB 备份（每 6h · 0 分 · 异机无需错峰）
# 复制健康才产出（防陈旧备份）· 直接落 ${BACKUP_DIR} = analytics 的 DUMP_INBOX
0 0,6,12,18 * * * root { ${CHECK_CMD} && ${BACKUP_CMD}; } >> ${LOG_DIR}/standby-backup.log 2>&1

# staging 数据刷新（每天 6:27 · 紧跟 6:00 备份窗口之后 · 用最新备份刷 stg.costra.cloud）
# restore-staging-from-prod.sh 自带机器②防呆与 -y 全链路自动确认 · 无需 check 门禁
# （备份 cron 已保证只有复制健康才产出新备份 · 即便当天未产出也只会用到更旧备份）
27 6 * * * root ${RESTORE_CMD} >> ${LOG_DIR}/staging-restore.log 2>&1"

if [[ "${DRY_RUN}" == "1" ]]; then
  log_dry "将写入 ${CRON_FILE}："
  printf '%s\n' "${content}"
  log_dry "将 touch ${LOG_DIR}/check-replication.log ${LOG_DIR}/standby-backup.log ${LOG_DIR}/staging-restore.log（0600）"
  log_dry "将安装 ${COSTRA_INFRA}/logrotate/costra-ops → /etc/logrotate.d/costra-ops"
  log_dry "将 mkdir -p ${BACKUP_DIR}（0700 · backup-db.sh 正式执行时也会自建）"
  exit 0
fi

# =============================================================================
# 正式安装（幂等）
# =============================================================================
require_root
# 备份必须移出 /etc/cron.d：RHEL 系 cronie 只忽略点开头的文件，
# 同目录的 .bak.* 副本会被当作合法 crontab 片段重复调度执行
backup_file "${CRON_FILE}" "${COSTRA_CONF_DIR}/backups"
printf '%s\n' "${content}" > "${CRON_FILE}"
chmod 0644 "${CRON_FILE}"
log_success "已写入 ${CRON_FILE}"

mkdir -p "${LOG_DIR}"
touch "${LOG_DIR}/check-replication.log" "${LOG_DIR}/standby-backup.log" "${LOG_DIR}/staging-restore.log"
chmod 0600 "${LOG_DIR}/check-replication.log" "${LOG_DIR}/standby-backup.log" "${LOG_DIR}/staging-restore.log"
log_success "日志文件已就绪（0600）"

# 备份目录预建并收紧权限（与分析栈约定目录一致 · root 可写即可）
mkdir -p "${BACKUP_DIR}"
chmod 0700 "${BACKUP_DIR}"
log_success "备份目录 ${BACKUP_DIR} 已就绪（0700）"

logrotate_source="${COSTRA_INFRA}/logrotate/costra-ops"
require_file "${logrotate_source}"
install -m 0644 "${logrotate_source}" /etc/logrotate.d/costra-ops
log_success "已安装 /etc/logrotate.d/costra-ops"

if systemctl is-active --quiet crond 2>/dev/null; then
  systemctl restart crond
  log_success "crond 已 restart · cron 配置生效"
else
  log_warn "crond 未运行 · 请手动 systemctl enable --now crond"
fi

exit 0
