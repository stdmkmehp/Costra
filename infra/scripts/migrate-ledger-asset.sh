#!/usr/bin/env bash
# =============================================================================
# Costra · 停服迁移 · 账本资产回填（prod 运维版）
# =============================================================================
# 事实源：docs/design/asset-and-budget-spec.md §6
#
# 职责：
#   - 在停服窗口执行：把所有 ledgers 的 balance_cents 回填为历史 entries 净值
#   - balance_baseline_seq 设为 MAX(entries.change_seq)
#   - balance_version +1
#
# 幂等：跑第二遍时 balance_baseline_seq 已是最大，SUM 不变 → delta=0，无影响。
#
# 本脚本替代旧版 server/scripts/migrate-ledger-asset.mts，遵循 infra/scripts 规范：
#   - 通过 docker exec 操作 prod/verify 容器，不直连 DATABASE_URL
#   - 密码从 /data/conf/server.env 读取（prod）或固定约定值（verify）
#   - prod 目标强制 confirm + 提示先 backup-db.sh
#   - 支持 --dry-run / -y / --help
#   - SQL 直接内联（spec §6.1 Step B/C 的 SQL），不依赖 server 仓库层 TS 函数
#
# 用法：
#   # 默认对 verify 容器跑（隔离 · 先在 staging 演练）
#   ./migrate-ledger-asset.sh
#   ./migrate-ledger-asset.sh --verify   # 仅校验不回填
#
#   # 对 prod 跑（高危 · 必 confirm + 建议先 backup）
#   ./migrate-ledger-asset.sh --target prod
#   ./migrate-ledger-asset.sh --target prod --verify
#
#   # 一路 yes（搭配 prod 也跳 confirm · 慎用）
#   ./migrate-ledger-asset.sh --target prod -y
#
#   # 只看会跑什么不执行
#   ./migrate-ledger-asset.sh --dry-run
#
# 退出码：
#   0 = 回填/校验成功
#   1 = 失败 / 校验不一致 / 用户取消
# =============================================================================

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=lib/common.sh
source "${SCRIPT_DIR}/lib/common.sh"

# --- 默认参数 ---
TARGET="verify"                        # verify | prod
MODE="run"                              # run | verify（--verify 切到 verify）
PROD_CONTAINER="costra-postgres"
PROD_DB="costra"
PG_USER="costra"

# --- 解析参数 ---
parse_common_args "$@"
while [[ $# -gt 0 ]]; do
  case "$1" in
    --target)
      [[ $# -ge 2 ]] || die "--target 需要一个值: prod | verify"
      TARGET=$2
      shift 2
      ;;
    --verify)
      MODE="verify"
      shift
      ;;
    --dry-run|-y|--yes) shift ;;
    -h|--help)
      grep '^#' "$0" | sed 's/^# \{0,1\}//' | head -48
      exit 0
      ;;
    *)
      die "未知参数: $1 · 用 --help 查看"
      ;;
  esac
done

# --- 校验 ---
require_cmd docker
[[ "${TARGET}" == "prod" || "${TARGET}" == "verify" ]] \
  || die "--target 只接受 prod 或 verify · got: ${TARGET}"

# --- 根据 target 选择容器 / 库 / 密码 ---
if [[ "${TARGET}" == "prod" ]]; then
  CONTAINER="${PROD_CONTAINER}"
  DB="${PROD_DB}"
  require_file "${COSTRA_ENV_FILE}"
  PG_PW=$(grep '^PG_COSTRA_PW=' "${COSTRA_ENV_FILE}" | cut -d= -f2-)
  [[ -n "${PG_PW}" ]] || die "未能从 ${COSTRA_ENV_FILE} 读取 PG_COSTRA_PW"
  RISKY=1
else
  DB_SLUG="verify"
  CONTAINER="costra-replay-pg-${DB_SLUG}"
  DB="costra_verify"
  PG_PW="${VERIFY_PG_PW}"
  RISKY=0
fi

# 容器必须在跑
if [[ "${DRY_RUN}" != "1" ]]; then
  STATUS=$(docker inspect --format '{{.State.Status}}' "${CONTAINER}" 2>/dev/null || echo "missing")
  if [[ "${STATUS}" != "running" ]]; then
    if [[ "${TARGET}" == "verify" ]]; then
      die "${CONTAINER} 不在运行（status=${STATUS}）· 请先跑 ./replay-db.sh <backup-file> 拉起验证容器"
    else
      die "${CONTAINER} 不在运行（status=${STATUS}）· 请先跑 ./05-start-stack.sh"
    fi
  fi
fi

# =============================================================================
# 确认
# =============================================================================
print_section_header "💰 Costra · migrate-ledger-asset → ${TARGET} (${MODE})"

mode_desc=
if [[ "${MODE}" == "verify" ]]; then
  mode_desc="仅校验不回填"
else
  mode_desc="回填 balance"
fi
log_info "目标          : ${TARGET}"
log_info "模式          : ${MODE}（${mode_desc}）"
log_info "容器          : ${CONTAINER}"
log_info "数据库        : ${DB}"
log_info "用户          : ${PG_USER}"
echo ""

if [[ "${RISKY}" == "1" ]]; then
  log_warn "⚠️  目标是 prod 数据库 · 强烈建议先跑 ./backup-db.sh 做备份再继续"
  if [[ "${MODE}" == "run" ]]; then
    log_warn "⚠️  回填模式会修改 ledgers.balance_cents / balance_baseline_seq / balance_version"
    confirm "确认对 prod 数据库（${CONTAINER} · ${DB}）回填账本资产？" || die "用户取消"
  else
    confirm "确认对 prod 数据库（${CONTAINER} · ${DB}）执行只读校验？" || die "用户取消"
  fi
fi

if [[ "${DRY_RUN}" == "1" ]]; then
  log_warn "DRY-RUN 模式 · 不真正执行命令"
fi

# =============================================================================
# 工具函数
# =============================================================================

# run_sql <sql> : 执行并返回 psql 原始输出
run_sql() {
  docker exec -e "PGPASSWORD=${PG_PW}" "${CONTAINER}" \
    psql -h 127.0.0.1 -U "${PG_USER}" -d "${DB}" -v ON_ERROR_STOP=1 -c "$1"
}

# run_sql_scalar <sql> : 取单值（-At 无表头无对齐）
run_sql_scalar() {
  docker exec -e "PGPASSWORD=${PG_PW}" "${CONTAINER}" \
    psql -h 127.0.0.1 -U "${PG_USER}" -d "${DB}" -v ON_ERROR_STOP=1 -At -c "$1"
}

# =============================================================================
# Step C · 校验（spec §6.1 Step C）
# 校验所有 ledgers 的 balance_cents == entries 净值 AND baseline_seq == MAX(change_seq)
# =============================================================================
do_verify() {
  log_step "校验 ledger balance（balance_cents + baseline_seq）"

  # SQL 语义：对每个未软删 ledger，重新从 entries 算 net_cents + max_seq，
  # 与 ledgers 表里存的值对比，返回不一致的行。
  # 无 entries 的 ledger 不会出现在 per_ledger CTE 里 → 单独 LEFT JOIN 处理为 net=0 / max=0。
  local mismatch_count
  if [[ "${DRY_RUN}" == "1" ]]; then
    log_dry "SELECT count(*) FROM ( ... balance_cents <> net_cents OR baseline_seq <> max_seq ... ) mismatches"
    mismatch_count=0
  else
    mismatch_count=$(run_sql_scalar "
      WITH per_ledger AS (
        SELECT
          ledger_id,
          COALESCE(SUM(
            CASE type
              WHEN 'income'  THEN  amount
              WHEN 'expense' THEN -amount
              ELSE 0
            END
          ), 0)::bigint AS net_cents,
          COALESCE(MAX(change_seq), 0)::bigint AS max_seq
        FROM entries
        WHERE deleted_at IS NULL
        GROUP BY ledger_id
      )
      SELECT count(*)
      FROM ledgers l
      LEFT JOIN per_ledger p ON p.ledger_id = l.id
      WHERE l.deleted_at IS NULL
        AND (
          l.balance_cents        <> COALESCE(p.net_cents, 0)
          OR l.balance_baseline_seq <> COALESCE(p.max_seq, 0)
        );
    ")
  fi

  local total
  if [[ "${DRY_RUN}" == "1" ]]; then
    total="(dry-run 跳过)"
  else
    total=$(run_sql_scalar "SELECT count(*) FROM ledgers WHERE deleted_at IS NULL;")
  fi

  if [[ "${mismatch_count}" == "0" ]]; then
    log_success "校验通过 · 共 ${total} 个账本，0 个不一致"
  else
    log_error "校验失败 · 共 ${total} 个账本，${mismatch_count} 个不一致"
    # 列出不一致明细（最多 20 行）
    if [[ "${DRY_RUN}" != "1" ]]; then
      log_info "不一致明细："
      run_sql "
        WITH per_ledger AS (
          SELECT
            ledger_id,
            COALESCE(SUM(
              CASE type
                WHEN 'income'  THEN  amount
                WHEN 'expense' THEN -amount
                ELSE 0
              END
            ), 0)::bigint AS net_cents,
            COALESCE(MAX(change_seq), 0)::bigint AS max_seq
          FROM entries
          WHERE deleted_at IS NULL
          GROUP BY ledger_id
        )
        SELECT
          l.id,
          l.balance_cents        AS stored_cents,
          COALESCE(p.net_cents, 0) AS expected_cents,
          l.balance_baseline_seq AS stored_seq,
          COALESCE(p.max_seq, 0)   AS expected_seq
        FROM ledgers l
        LEFT JOIN per_ledger p ON p.ledger_id = l.id
        WHERE l.deleted_at IS NULL
          AND (
            l.balance_cents        <> COALESCE(p.net_cents, 0)
            OR l.balance_baseline_seq <> COALESCE(p.max_seq, 0)
          )
        LIMIT 20;
      "
    fi
    die "校验未通过 · 请排查后再恢复服务"
  fi
}

# =============================================================================
# Step B · 回填（spec §6.1 Step B）
# 一次性 UPDATE 所有 ledgers，把 balance_cents 设为 entries 历史净值，
# balance_baseline_seq 设为 MAX(change_seq)，balance_version +1。
# 幂等：跑第二遍 delta = 0。
# =============================================================================
do_migrate() {
  log_step "回填 ledger balance（balance_cents / baseline_seq / version）"

  local UPDATE_SQL
  UPDATE_SQL="
    WITH per_ledger AS (
      SELECT
        ledger_id,
        COALESCE(MAX(change_seq), 0) AS max_seq,
        COALESCE(SUM(
          CASE type
            WHEN 'income'  THEN  amount
            WHEN 'expense' THEN -amount
            ELSE 0
          END
        ), 0)::bigint AS net_cents
      FROM entries
      WHERE deleted_at IS NULL
      GROUP BY ledger_id
    )
    UPDATE ledgers l
      SET balance_cents        = p.net_cents,
          balance_baseline_seq = p.max_seq,
          balance_version      = balance_version + 1
      FROM per_ledger p
     WHERE l.id = p.ledger_id;"

  if [[ "${DRY_RUN}" == "1" ]]; then
    log_dry "docker exec -e PGPASSWORD=*** '${CONTAINER}' psql ... -c \"UPDATE ledgers SET balance_cents = net_cents ...\""
    log_dry "（dry-run 跳过执行）"
    return 0
  fi

  local result
  result=$(run_sql "${UPDATE_SQL}" | tail -1)
  log_success "回填完成 · ${result}"

  # 自校验（幂等性检查）：再跑一遍校验
  log_step "自校验（幂等性检查）"
  do_verify
}

# =============================================================================
# 主分发
# =============================================================================
if [[ "${MODE}" == "verify" ]]; then
  do_verify
else
  do_migrate
fi

# =============================================================================
# 总结
# =============================================================================
echo ""
print_section_header "✅ ${TARGET} · migrate-ledger-asset (${MODE}) 完成"

exit 0
