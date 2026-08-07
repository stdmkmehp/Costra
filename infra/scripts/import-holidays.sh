#!/usr/bin/env bash
# =============================================================================
# Costra · 节假日数据导入 DB 脚本（prod 运维版）
# =============================================================================
# 读取 server/src/data/workday-cn-*.json，导入到 workday_calendars 表。
#
# 本脚本替代旧版 scripts/import-holidays.mjs，遵循 infra/scripts 规范：
#   - 通过 docker exec 操作 prod/verify 容器，不直连 DATABASE_URL
#   - 密码从 /data/conf/server.env 读取（prod）或固定约定值（verify）
#   - prod 目标强制 confirm + 提示先 backup-db.sh
#   - 支持 --dry-run / -y / --help
#   - JSON 校验用 jq（prod 机器需安装 jq · 可通过 apk/apt）
#
# 语义：
#   - INSERT ... ON CONFLICT (year) DO UPDATE（upsert · 幂等 · 可重复执行）
#   - 导入前校验 JSON schema（year / 数组 / MM-DD / 升序 / 无交集）
#
# 用法：
#   # 默认对 verify 容器跑（隔离）
#   ./import-holidays.sh
#   ./import-holidays.sh 2026 2027
#
#   # 对 prod 跑（高危 · 必 confirm + 建议先 backup）
#   ./import-holidays.sh --target prod
#   ./import-holidays.sh --target prod 2026
#
#   # 一路 yes（搭配 prod 也跳 confirm · 慎用）
#   ./import-holidays.sh --target prod -y
#
#   # 只看会跑什么不执行
#   ./import-holidays.sh --dry-run
#
# 退出码：
#   0 = 全部导入成功
#   1 = 失败 / 校验未过 / 用户取消
# =============================================================================

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=lib/common.sh
source "${SCRIPT_DIR}/lib/common.sh"

# --- 默认参数 ---
TARGET="verify"                        # verify | prod
PROD_CONTAINER="costra-postgres"
PROD_DB="costra"
PG_USER="costra"
DATA_DIR="${COSTRA_ROOT}/server/src/data"
TARGET_YEARS=()

# --- 解析参数 ---
parse_common_args "$@"
while [[ $# -gt 0 ]]; do
  case "$1" in
    --target)
      [[ $# -ge 2 ]] || die "--target 需要一个值: prod | verify"
      TARGET=$2
      shift 2
      ;;
    --dry-run|-y|--yes) shift ;;
    -h|--help)
      grep '^#' "$0" | sed 's/^# \{0,1\}//' | head -42
      exit 0
      ;;
    -*)
      die "未知参数: $1 · 用 --help 查看"
      ;;
    [0-9]*)
      TARGET_YEARS+=("$1")
      shift
      ;;
    *)
      die "未知参数: $1 · 用 --help 查看"
      ;;
  esac
done

# --- 校验 ---
require_cmd docker
require_cmd jq
[[ "${TARGET}" == "prod" || "${TARGET}" == "verify" ]] \
  || die "--target 只接受 prod 或 verify · got: ${TARGET}"
[[ -d "${DATA_DIR}" ]] || die "数据目录不存在：${DATA_DIR}"

# --- 根据 target 选择容器 / 库 / 密码 ---
if [[ "${TARGET}" == "prod" ]]; then
  CONTAINER="${PROD_CONTAINER}"
  DB="${PROD_DB}"
  require_file "${COSTRA_ENV_FILE}"
  PG_PW=$(grep '^PG_COSTRA_PW=' "${COSTRA_ENV_FILE}" | cut -d= -f2-)
  [[ -n "${PG_PW}" ]] || die "未能从 ${COSTRA_ENV_FILE} 读取 PG_COSTRA_PW"
  RISKY=1
else
  # verify 容器：约定固定密码 · 见 lib/common.sh VERIFY_PG_PW
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
print_section_header "📦 Costra · import-holidays → ${TARGET}"

log_info "目标          : ${TARGET}"
log_info "容器          : ${CONTAINER}"
log_info "数据库        : ${DB}"
log_info "用户          : ${PG_USER}"
log_info "数据目录      : ${DATA_DIR}"
if [[ ${#TARGET_YEARS[@]} -gt 0 ]]; then
  log_info "指定年份      : ${TARGET_YEARS[*]}"
else
  log_info "指定年份      : 全部"
fi
echo ""

if [[ "${RISKY}" == "1" ]]; then
  log_warn "⚠️  目标是 prod 数据库 · 强烈建议先跑 ./backup-db.sh 做备份再继续"
  confirm "确认对 prod 数据库（${CONTAINER} · ${DB}）导入节假日数据？" || die "用户取消"
fi

if [[ "${DRY_RUN}" == "1" ]]; then
  log_warn "DRY-RUN 模式 · 不真正执行命令"
fi

# =============================================================================
# 工具函数
# =============================================================================

# 校验单个 JSON 文件，校验通过后输出 year（供调用方使用）
# 校验失败则 die
validate_holiday_json() {
  local file=$1
  local year holidays workdays source generated_at

  year=$(jq -r '.year' "${file}")
  holidays=$(jq -r '.holidays[]?' "${file}")
  workdays=$(jq -r '.workdays[]?' "${file}")
  source=$(jq -r '.source // empty' "${file}")
  generated_at=$(jq -r '.generated_at // empty' "${file}")

  # 1. year
  [[ "${year}" =~ ^[0-9]{4}$ ]] || die "${file}: year 不是合法年份（${year}）"

  # 2. 数组类型（jq .holidays[] 对非数组会报错或输出 null，这里再检查原始类型）
  local h_type w_type
  h_type=$(jq -r '.holidays | type' "${file}")
  w_type=$(jq -r '.workdays | type' "${file}")
  [[ "${h_type}" == "array" ]] || die "${file}: holidays 必须是数组（got ${h_type}）"
  [[ "${w_type}" == "array" ]] || die "${file}: workdays 必须是数组（got ${w_type}）"

  # 3. MM-DD 格式 + 升序
  local MM_DD_RE='^[0-9]{2}-[0-9]{2}$'
  local prev="" d
  while IFS= read -r d; do
    [[ -n "${d}" ]] || continue
    [[ "${d}" =~ ${MM_DD_RE} ]] || die "${file}: 无效 MM-DD 格式（${d}）"
    if [[ -n "${prev}" && "${prev}" > "${d}" ]]; then
      die "${file}: holidays 非升序（${prev} > ${d}）"
    fi
    prev="${d}"
  done <<< "${holidays}"

  prev=""
  while IFS= read -r d; do
    [[ -n "${d}" ]] || continue
    [[ "${d}" =~ ${MM_DD_RE} ]] || die "${file}: 无效 MM-DD 格式（${d}）"
    if [[ -n "${prev}" && "${prev}" > "${d}" ]]; then
      die "${file}: workdays 非升序（${prev} > ${d}）"
    fi
    prev="${d}"
  done <<< "${workdays}"

  # 4. holidays ∩ workdays = ∅
  local overlap
  overlap=$(comm -12 \
    <(echo "${holidays}" | sort -u) \
    <(echo "${workdays}" | sort -u))
  [[ -z "${overlap}" ]] || die "${file}: holidays 与 workdays 有交集（${overlap//$'\n'/, }）"

  # 5. 元数据字段
  [[ -n "${source}" ]] || die "${file}: source 缺失"
  [[ -n "${generated_at}" ]] || die "${file}: generated_at 缺失"

  echo "${year}"
}

# 将 bash 字符串安全转义为 SQL 单引号字符串字面量
sql_escape() {
  local s=$1
  s="${s//\'/\'\'}"
  printf '%s' "${s}"
}

# 将 JSON 数组转为 PostgreSQL TEXT[] 字面量，如 '{"01-01","02-15"}'
# 输入：文件路径
build_pg_array_literal() {
  local file=$1 field=$2
  jq -r --arg f "$field" '
    .[$f] | map(tojson) | join(",") | "{" + . + "}"
  ' "${file}"
}

# =============================================================================
# 主流程
# =============================================================================

# 收集目标文件
ALL_FILES=$(find "${DATA_DIR}" -maxdepth 1 -name 'workday-cn-*.json' -type f | sort)
if [[ -z "${ALL_FILES}" ]]; then
  die "${DATA_DIR} 下无 workday-cn-*.json 文件"
fi

FILES_TO_IMPORT=()
while IFS= read -r f; do
  [[ -z "${f}" ]] && continue
  if [[ ${#TARGET_YEARS[@]} -gt 0 ]]; then
    # 从文件名提取年份做预筛
    fname=$(basename "${f}")
    file_year=${fname#workday-cn-}
    file_year=${file_year%.json}
    local_match=0
    for y in "${TARGET_YEARS[@]}"; do
      if [[ "${file_year}" == "${y}" ]]; then
        local_match=1
        break
      fi
    done
    [[ "${local_match}" == "1" ]] && FILES_TO_IMPORT+=("${f}")
  else
    FILES_TO_IMPORT+=("${f}")
  fi
done <<< "${ALL_FILES}"

if [[ ${#FILES_TO_IMPORT[@]} -eq 0 ]]; then
  if [[ ${#TARGET_YEARS[@]} -gt 0 ]]; then
    die "未找到匹配年份 ${TARGET_YEARS[*]} 的 JSON 文件"
  else
    die "未找到任何 JSON 文件"
  fi
fi

log_info "待导入 ${#FILES_TO_IMPORT[@]} 个文件"

IMPORTED=0
SKIPPED=0

for file in "${FILES_TO_IMPORT[@]}"; do
  fname=$(basename "${file}")
  log_step "处理 ${fname}"

  # 校验
  log_info "校验 JSON ..."
  if [[ "${DRY_RUN}" == "1" ]]; then
    log_dry "（dry-run 跳过校验）"
    year=$(jq -r '.year' "${file}")
    h_count=$(jq -r '.holidays | length' "${file}")
    w_count=$(jq -r '.workdays | length' "${file}")
  else
    year=$(validate_holiday_json "${file}")
    h_count=$(jq -r '.holidays | length' "${file}")
    w_count=$(jq -r '.workdays | length' "${file}")
    log_success "校验通过 · ${year} 年 · ${h_count} holidays, ${w_count} workdays"
  fi

  # 构建 SQL
  holidays_literal=$(build_pg_array_literal "${file}" "holidays")
  workdays_literal=$(build_pg_array_literal "${file}" "workdays")
  source_val=$(jq -r '.source' "${file}")
  source_url_val=$(jq -r '.source_url // empty' "${file}")

  source_escaped=$(sql_escape "${source_val}")
  source_url_escaped=$(sql_escape "${source_url_val}")

  SQL="INSERT INTO workday_calendars (year, holidays, workdays, source, source_url, updated_at)
       VALUES (${year}, '${holidays_literal}', '${workdays_literal}', '${source_escaped}', '${source_url_escaped}', now())
       ON CONFLICT (year)
       DO UPDATE SET
         holidays   = EXCLUDED.holidays,
         workdays   = EXCLUDED.workdays,
         source     = EXCLUDED.source,
         source_url = EXCLUDED.source_url,
         updated_at = now();"

  # 执行
  log_info "upsert → ${DB}.workday_calendars (year=${year})"

  if [[ "${DRY_RUN}" == "1" ]]; then
    log_dry "docker exec -i -e PGPASSWORD=*** '${CONTAINER}' psql -h 127.0.0.1 -U '${PG_USER}' -d '${DB}' -v ON_ERROR_STOP=1 -c \"INSERT ... ON CONFLICT ...\""
  else
    docker exec -i -e "PGPASSWORD=${PG_PW}" "${CONTAINER}" \
      psql -h 127.0.0.1 -U "${PG_USER}" -d "${DB}" -v ON_ERROR_STOP=1 -c "${SQL}" \
      || die "${file}: upsert 失败"
  fi

  log_success "${year} 年节假日数据已导入"
  ((IMPORTED++))
done

# =============================================================================
# 总结
# =============================================================================
echo ""
print_section_header "✅ ${TARGET} · import-holidays 完成"

log_info "导入 : ${IMPORTED} 个年份"
if [[ "${TARGET}" == "verify" ]]; then
  log_info "进入 verify 库验证："
  log_info "  docker exec -it -e PGPASSWORD='${VERIFY_PG_PW}' ${CONTAINER} psql -U ${PG_USER} -d ${DB} -c 'SELECT year, array_length(holidays,1), array_length(workdays,1) FROM workday_calendars ORDER BY year;'"
else
  log_info "进入 prod 库验证："
  log_info "  docker exec -it -e PGPASSWORD=\"\$(grep ^PG_COSTRA_PW= ${COSTRA_ENV_FILE} | cut -d= -f2-)\" \\"
  log_info "    ${CONTAINER} psql -h 127.0.0.1 -U ${PG_USER} -d ${DB} -c 'SELECT year, array_length(holidays,1), array_length(workdays,1) FROM workday_calendars ORDER BY year;'"
fi

exit 0
