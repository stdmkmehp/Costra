#!/usr/bin/env bash
# =============================================================================
# Costra · 宿主机内核参数调优落地（sysctl + THP · 幂等）
# =============================================================================
# 把仓库内的宿主机调优基线安装到系统路径并使其生效：
#   infra/host/sysctl-99-costra.conf  → /etc/sysctl.d/99-costra.conf
#   infra/host/disable-thp.service    → /etc/systemd/system/disable-thp.service
#
# 用法：
#   ./apply-host-tuning.sh <task> [options]
#
# 任务：
#   status      只读体检：逐项对比期望值 vs 生效值 + THP + 冲突文件（默认任务）
#   apply       安装配置 + 清理覆盖冲突 + sysctl --system + 启用 THP unit + 校验
#   revert      移除 Costra 管理的配置并恢复最近备份（THP 需手动或重启复位）
#
# 通用选项：--dry-run（预览不改）· -y/--yes（跳过确认）· -h/--help
#
# 设计要点：
#   - 期望值与冲突键**从 sysctl-99-costra.conf 自动解析**，不维护第二份清单，
#     改 conf 后校验与冲突清理自动跟随，杜绝双事实源。
#   - 只清理冲突文件中与本 conf **同名**的 key；未被本 conf 收录的既有设置
#     （如 tcp_slow_start_after_idle / gc_thresh3 / sysrq / printk）原样保留。
#   - 全程只动宿主机，不 recreate 任何容器，无 5xx 窗口。
#
# 适用机器：prod（机器①）与 staging/从库/分析机（机器②）通用。
# 退出码：0 = 成功 / 全部符合期望 · 1 = 失败 / 存在偏差
#
# 基线文档：docs/ops/host-kernel-tuning.md
# =============================================================================

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=lib/common.sh
source "${SCRIPT_DIR}/lib/common.sh"

# --- 源文件（仓库内）与目标路径（系统内）---
SRC_SYSCTL="${COSTRA_INFRA}/host/sysctl-99-costra.conf"
DST_SYSCTL="/etc/sysctl.d/99-costra.conf"
SRC_THP_UNIT="${COSTRA_INFRA}/host/disable-thp.service"
DST_THP_UNIT="/etc/systemd/system/disable-thp.service"
THP_UNIT_NAME="disable-thp.service"
THP_SYS_PATH="/sys/kernel/mm/transparent_hugepage/enabled"
# bbr 需要内核模块；sysctl 持久化了算法名但模块不会自动加载，故单独持久化
BBR_MODULES_CONF="/etc/modules-load.d/costra-bbr.conf"

# sysctl --system 按字典序加载 /etc/sysctl.d/*.conf，最后加载 /etc/sysctl.conf。
# 这两个文件排在 99-costra.conf 之后，若含同名 key 会把我们的值覆盖回去。
declare -a CONFLICT_FILES=(
  "/etc/sysctl.d/99-sysctl.conf"
  "/etc/sysctl.conf"
)

# 备份集中存放（不散落在 /etc 下污染 sysctl 加载目录 —— *.conf.bak 不会被
# sysctl --system 读取，但堆在 /etc/sysctl.d 里易误读为生效配置）
BACKUP_DIR="/data/conf/host-tuning-backups"

# --- 解析：先让 common 扫出 --dry-run/-y，再抽任务名 ---
parse_common_args "$@"

TASK=""
while [[ $# -gt 0 ]]; do
  case "$1" in
    status|apply|revert)
      [[ -z "${TASK}" ]] || die "只能指定一个任务（已有：${TASK}）"
      TASK=$1; shift ;;
    --dry-run|-y|--yes) shift ;;   # common 已处理 · noop
    -h|--help)
      grep '^#' "$0" | sed 's/^# \{0,1\}//' | head -30
      exit 0 ;;
    *) die "未知参数：$1 · 用 -h 查看用法" ;;
  esac
done
TASK="${TASK:-status}"

# =============================================================================
# 解析 managed conf（单一事实源）
# =============================================================================
# 输出 "key|expected_value"，value 内部连续空白归一为单个空格
# （形如 `ip_local_port_range = 10000 65535` 的多值参数也能正确比对）
_managed_pairs() {
  require_file "${SRC_SYSCTL}"
  # grep 无匹配返回 1，pipefail 下会让本函数非零退出 → || true 兜住（空 conf 场景）
  { sed -E 's/#.*$//' "${SRC_SYSCTL}" \
    | grep -E '^[[:space:]]*[a-zA-Z][a-zA-Z0-9._-]*[[:space:]]*=' \
    | awk -F= '
        {
          key = $1
          sub(/^[[:space:]]+/, "", key); sub(/[[:space:]]+$/, "", key)
          val = $0; sub(/^[^=]*=/, "", val)
          gsub(/[[:space:]]+/, " ", val)
          sub(/^ /, "", val); sub(/ $/, "", val)
          print key "|" val
        }'; } || true
}

# 仅 key 列表（冲突清理用）
_managed_keys() {
  _managed_pairs | cut -d'|' -f1
}

# 读取当前生效值（空白归一 · 不存在则输出 __MISSING__）
_live_value() {
  local key=$1 val
  if ! val=$(sysctl -n "${key}" 2>/dev/null); then
    echo "__MISSING__"; return 0
  fi
  # sysctl 多值参数以 tab 分隔，归一为单空格后再比对
  echo "${val}" | tr -s '[:space:]' ' ' | sed -E 's/^ //; s/ $//'
}

# 把 key 转成可安全嵌入正则的形式（转义 . 与 -）
_key_regex() {
  local key=$1
  key="${key//./\\.}"
  echo "${key}"
}

# =============================================================================
# status：只读体检
# =============================================================================
do_status() {
  log_step "sysctl 期望值 vs 生效值"
  local pair key expect live drift=0 total=0
  printf "  %-40s %-14s %-14s %s\n" "KEY" "期望" "生效" "结果"
  while IFS= read -r pair; do
    [[ -n "${pair}" ]] || continue
    key="${pair%%|*}"
    expect="${pair#*|}"
    live=$(_live_value "${key}")
    total=$((total + 1))
    if [[ "${live}" == "${expect}" ]]; then
      printf "  %-40s %-14s %-14s ${C_GREEN}OK${C_RESET}\n" "${key}" "${expect}" "${live}"
    else
      printf "  %-40s %-14s %-14s ${C_YELLOW}DRIFT${C_RESET}\n" "${key}" "${expect}" "${live}"
      drift=$((drift + 1))
    fi
  done < <(_managed_pairs)

  log_step "配置文件安装状态"
  if [[ -f "${DST_SYSCTL}" ]]; then
    if diff -q "${SRC_SYSCTL}" "${DST_SYSCTL}" >/dev/null 2>&1; then
      log_success "${DST_SYSCTL} 已安装且与仓库一致"
    else
      log_warn "${DST_SYSCTL} 存在但与仓库版本不一致（需 apply 同步）"
      drift=$((drift + 1))
    fi
  else
    log_warn "${DST_SYSCTL} 未安装"
    drift=$((drift + 1))
  fi

  log_step "覆盖冲突检查（这些文件排在 99-costra.conf 之后加载）"
  local f k conflicts=0 regex
  for f in "${CONFLICT_FILES[@]}"; do
    [[ -f "${f}" ]] || continue
    while IFS= read -r k; do
      [[ -n "${k}" ]] || continue
      regex=$(_key_regex "${k}")
      if grep -qE "^[[:space:]]*${regex}[[:space:]]*=" "${f}" 2>/dev/null; then
        log_warn "冲突：${f} 也设置了 ${k} → 会覆盖 99-costra.conf"
        conflicts=$((conflicts + 1))
      fi
    done < <(_managed_keys)
  done
  [[ "${conflicts}" -eq 0 ]] && log_success "无覆盖冲突"

  log_step "Transparent Huge Pages"
  if [[ -r "${THP_SYS_PATH}" ]]; then
    local thp
    thp=$(cat "${THP_SYS_PATH}")
    if [[ "${thp}" == *"[never]"* ]]; then
      log_success "THP = never（${thp}）"
    else
      log_warn "THP 未关闭（${thp}）· Redis fork 会有百 ms 级 stall"
      drift=$((drift + 1))
    fi
  else
    log_info "本机无 ${THP_SYS_PATH}（内核未编译 THP）· 跳过"
  fi

  if systemctl list-unit-files "${THP_UNIT_NAME}" >/dev/null 2>&1 \
    && systemctl is-enabled --quiet "${THP_UNIT_NAME}" 2>/dev/null; then
    log_success "${THP_UNIT_NAME} 已 enabled（重启后仍生效）"
  else
    log_warn "${THP_UNIT_NAME} 未启用 · 重启后 THP 会回到内核默认"
    drift=$((drift + 1))
  fi

  log_step "运行层验证（读回 sysctl 值 != 功能已生效）"
  # --- qdisc：sysctl 只影响新建设备，已 up 的网卡要看 tc 实际挂载 ---
  local nic want_qdisc cur_qdisc
  nic=$(_primary_nic)
  want_qdisc=$(_managed_pairs | awk -F'|' '$1=="net.core.default_qdisc"{print $2}')
  if [[ -n "${nic}" && -n "${want_qdisc}" ]]; then
    cur_qdisc=$(tc qdisc show dev "${nic}" 2>/dev/null | awk 'NR==1{print $2}')
    if [[ "${cur_qdisc}" == "${want_qdisc}" ]]; then
      log_success "网卡 ${nic} 实际 qdisc = ${cur_qdisc}"
    else
      log_warn "网卡 ${nic} 实际 qdisc = ${cur_qdisc:-未知}（期望 ${want_qdisc}）· sysctl 值对不代表已挂载"
      drift=$((drift + 1))
    fi
  fi

  # --- bbr 模块与持久化 ---
  if _managed_pairs | grep -q '^net\.ipv4\.tcp_congestion_control|bbr$'; then
    if lsmod 2>/dev/null | grep -q '^tcp_bbr'; then
      log_success "tcp_bbr 模块已加载"
    else
      log_warn "tcp_bbr 模块未加载 · bbr 无法真正工作"
      drift=$((drift + 1))
    fi
    if [[ -f "${BBR_MODULES_CONF}" ]]; then
      log_success "${BBR_MODULES_CONF} 存在（重启后自动加载）"
    else
      log_warn "${BBR_MODULES_CONF} 缺失 · 重启后算法会静默回退 cubic"
      drift=$((drift + 1))
    fi

    # --- 关键：nginx 容器 netns 内的算法（tcp_congestion_control 是 per-netns）---
    # 面向公网用户的服务端 socket 在 nginx 容器的 netns 内，宿主机值管不到它。
    # 用 nsenter 借宿主机的 sysctl 读容器 netns，避免依赖 alpine 容器内有工具。
    local nginx_pid nginx_cc
    nginx_pid=$(docker inspect -f '{{.State.Pid}}' costra-nginx 2>/dev/null || echo "")
    if [[ -n "${nginx_pid}" && "${nginx_pid}" != "0" ]]; then
      nginx_cc=$(nsenter -t "${nginx_pid}" -n sysctl -n net.ipv4.tcp_congestion_control 2>/dev/null || echo "")
      if [[ "${nginx_cc}" == "bbr" ]]; then
        log_success "nginx 容器 netns 拥塞控制 = bbr（面向用户的连接已生效）"
      else
        log_warn "nginx 容器 netns 拥塞控制 = ${nginx_cc:-未取到}（期望 bbr）"
        log_warn "  → 宿主机设 bbr 不会改变已创建的 netns · 需 recreate nginx 使 compose sysctls 生效："
        log_warn "  → docker compose -f ${COSTRA_COMPOSE_FILE} --env-file ${COSTRA_ENV_FILE} up -d nginx"
        drift=$((drift + 1))
      fi
    else
      log_info "costra-nginx 未运行 · 跳过容器 netns 检查"
    fi
  fi

  # --- THP 实际效果：AnonHugePages 应趋近 0（不做断言 · 仅供观察）---
  if [[ -r /proc/meminfo ]]; then
    log_info "AnonHugePages：$(awk '/AnonHugePages/{print $2" "$3}' /proc/meminfo 2>/dev/null || echo '未取到')（THP=never 后新分配不再使用大页）"
  fi

  log_step "参考信息（不做断言 · 仅供判断是否需要追加网络栈参数）"
  log_info "可用拥塞控制算法：$(sysctl -n net.ipv4.tcp_available_congestion_control 2>/dev/null || echo '未取到')"
  log_info "容器 ulimit -n：$(docker exec costra-server sh -c 'ulimit -n' 2>/dev/null || echo '未取到（容器未运行？）')"
  log_info "连接概况：$(ss -s 2>/dev/null | sed -n '2p' || echo 'ss 不可用')"
  local overflow
  overflow=$(dmesg -T 2>/dev/null | grep -icE 'time wait bucket|possible SYN flooding' || true)
  if [[ "${overflow:-0}" -gt 0 ]]; then
    log_warn "dmesg 出现 ${overflow} 条 tw 溢出 / SYN flooding 记录 → 触发手册 §5 追加网络栈参数"
  else
    log_info "dmesg 无 tw 溢出 / SYN flooding 记录（网络栈参数暂无需追加）"
  fi

  echo ""
  if [[ "${drift}" -eq 0 && "${conflicts}" -eq 0 ]]; then
    log_success "体检通过 · ${total} 项 sysctl 全部符合期望"
    return 0
  fi
  log_warn "存在 ${drift} 项偏差 / ${conflicts} 处冲突 · 执行 ./apply-host-tuning.sh apply 修正"
  return 1
}

# =============================================================================
# apply：安装 + 清理冲突 + 生效 + 校验
# =============================================================================
# BBR 前置检查：内核不支持时 sysctl 写入会静默失败，直到第 5 步校验才暴露。
# 这里提前 modprobe 并给出明确处置建议（而非让用户对着校验失败猜原因）。
_preflight_bbr() {
  # conf 里没启用 bbr 就无需检查（保持与 conf 单一事实源同步）
  _managed_pairs | grep -q '^net\.ipv4\.tcp_congestion_control|bbr$' || return 0

  local avail
  avail=$(sysctl -n net.ipv4.tcp_available_congestion_control 2>/dev/null || echo "")
  if [[ " ${avail} " == *" bbr "* ]]; then
    log_success "内核已支持 bbr（available: ${avail}）"
    return 0
  fi

  log_info "当前可用拥塞控制算法：${avail:-未取到} · 尝试加载 tcp_bbr 模块"
  if [[ "${DRY_RUN}" == "1" ]]; then
    log_dry "modprobe tcp_bbr"
    return 0
  fi
  if modprobe tcp_bbr 2>/dev/null; then
    avail=$(sysctl -n net.ipv4.tcp_available_congestion_control 2>/dev/null || echo "")
    if [[ " ${avail} " == *" bbr "* ]]; then
      # 持久化模块加载，否则重启后 sysctl 生效但算法回退
      echo "tcp_bbr" > "${BBR_MODULES_CONF}"
      chmod 0644 "${BBR_MODULES_CONF}"
      log_success "已加载并持久化 tcp_bbr（${BBR_MODULES_CONF}）"
      return 0
    fi
  fi
  die "内核不支持 bbr（available: ${avail:-未知}）· 请从 ${SRC_SYSCTL} 移除 net.ipv4.tcp_congestion_control 与 net.core.default_qdisc 两行后重跑"
}

# 主网卡名（默认路由所在设备 · 不假定叫 eth0）
_primary_nic() {
  ip route show default 2>/dev/null | awk '/^default/ {for (i=1;i<=NF;i++) if ($i=="dev") {print $(i+1); exit}}'
}

# net.core.default_qdisc 只在**设备注册时**用作默认 qdisc，已 up 的网卡不会改变。
# 不显式 replace 的话，改了 sysctl 却要等下次重启才生效（且容易误判为已生效）。
_apply_qdisc_now() {
  _managed_pairs | grep -q '^net\.core\.default_qdisc|' || return 0

  local want nic cur
  want=$(_managed_pairs | awk -F'|' '$1=="net.core.default_qdisc"{print $2}')
  nic=$(_primary_nic)
  if [[ -z "${nic}" ]]; then
    log_warn "未能识别默认路由网卡 · 跳过 qdisc 即时替换（重启后由 default_qdisc 生效）"
    return 0
  fi

  cur=$(tc qdisc show dev "${nic}" 2>/dev/null | awk 'NR==1{print $2}')
  if [[ "${cur}" == "${want}" ]]; then
    log_success "${nic} 的 qdisc 已是 ${want}"
    return 0
  fi

  if [[ "${DRY_RUN}" == "1" ]]; then
    log_dry "tc qdisc replace dev ${nic} root ${want}（当前 ${cur:-未知}）"
    return 0
  fi
  # replace 是标准在线操作：短暂清空发送队列，不断开已建立连接
  if tc qdisc replace dev "${nic}" root "${want}" 2>/dev/null; then
    log_success "${nic} qdisc ${cur:-未知} → ${want}"
  else
    log_warn "tc qdisc replace dev ${nic} root ${want} 失败 · 重启后仍会由 default_qdisc 生效"
  fi
}

_clean_conflicts() {
  local f k regex hits
  for f in "${CONFLICT_FILES[@]}"; do
    [[ -f "${f}" ]] || continue
    hits=0
    while IFS= read -r k; do
      [[ -n "${k}" ]] || continue
      regex=$(_key_regex "${k}")
      if grep -qE "^[[:space:]]*${regex}[[:space:]]*=" "${f}" 2>/dev/null; then
        hits=$((hits + 1))
      fi
    done < <(_managed_keys)

    if [[ "${hits}" -eq 0 ]]; then
      log_info "${f}：无同名 key · 跳过"
      continue
    fi

    if [[ "${DRY_RUN}" == "1" ]]; then
      log_dry "将从 ${f} 删除 ${hits} 个与 99-costra.conf 同名的 key（先备份到 ${BACKUP_DIR}）"
      continue
    fi

    backup_file "${f}" "${BACKUP_DIR}"
    while IFS= read -r k; do
      [[ -n "${k}" ]] || continue
      regex=$(_key_regex "${k}")
      sed -i -E "/^[[:space:]]*${regex}[[:space:]]*=/d" "${f}"
    done < <(_managed_keys)
    log_success "${f}：已移除 ${hits} 个冲突 key（其余设置原样保留）"
  done
}

_verify_applied() {
  local pair key expect live fail=0
  while IFS= read -r pair; do
    [[ -n "${pair}" ]] || continue
    key="${pair%%|*}"
    expect="${pair#*|}"
    live=$(_live_value "${key}")
    if [[ "${live}" == "${expect}" ]]; then
      log_success "${key} = ${live}"
    else
      log_error "${key} 期望 ${expect} · 实际 ${live}"
      fail=$((fail + 1))
    fi
  done < <(_managed_pairs)
  [[ "${fail}" -eq 0 ]] || die "${fail} 项未生效 · 检查是否还有其他文件覆盖（sysctl --system 输出按加载顺序排查）"
}

do_apply() {
  require_file "${SRC_SYSCTL}"
  require_file "${SRC_THP_UNIT}"
  require_cmd sysctl
  [[ "${DRY_RUN}" == "1" ]] || require_root

  print_section_header "宿主机内核调优落地（$(hostname)）"
  log_info "sysctl 源：${SRC_SYSCTL}"
  log_info "THP unit 源：${SRC_THP_UNIT}"
  log_warn "本操作修改宿主机内核参数（全机器生效 · 不限于 Costra 进程）"
  log_info "不会 recreate 容器 · 无服务中断窗口"
  if [[ "${DRY_RUN}" != "1" ]] && ! confirm "确认在本机应用？"; then
    die "已取消"
  fi

  log_step "1/7 前置检查（拥塞控制算法可用性）"
  _preflight_bbr

  log_step "2/7 安装 ${DST_SYSCTL}"
  if [[ "${DRY_RUN}" == "1" ]]; then
    log_dry "install -m 0644 ${SRC_SYSCTL} ${DST_SYSCTL}（先备份原文件到 ${BACKUP_DIR}）"
  else
    backup_file "${DST_SYSCTL}" "${BACKUP_DIR}"
    install -o root -g root -m 0644 "${SRC_SYSCTL}" "${DST_SYSCTL}"
    log_success "已安装 ${DST_SYSCTL}"
  fi

  log_step "3/7 清理会覆盖它的同名 key"
  _clean_conflicts

  log_step "4/7 加载生效（sysctl --system）"
  if [[ "${DRY_RUN}" == "1" ]]; then
    log_dry "sysctl --system"
  else
    sysctl --system >/dev/null
    log_success "sysctl --system 完成"
  fi

  log_step "5/7 即时替换主网卡 qdisc（sysctl 只影响新建设备）"
  _apply_qdisc_now

  log_step "6/7 关闭 THP（即时 + 开机自动）"
  if [[ ! -w "${THP_SYS_PATH}" && ! -r "${THP_SYS_PATH}" ]]; then
    log_info "本机无 ${THP_SYS_PATH} · 跳过 THP 配置"
  elif [[ "${DRY_RUN}" == "1" ]]; then
    log_dry "install -m 0644 ${SRC_THP_UNIT} ${DST_THP_UNIT}"
    log_dry "systemctl daemon-reload && systemctl enable --now ${THP_UNIT_NAME}"
  else
    install -o root -g root -m 0644 "${SRC_THP_UNIT}" "${DST_THP_UNIT}"
    systemctl daemon-reload
    # enable --now 会立即执行 ExecStart，即时把 THP 置 never（无需单独 echo）
    systemctl enable --now "${THP_UNIT_NAME}"
    log_success "已启用 ${THP_UNIT_NAME} · 当前 THP：$(cat "${THP_SYS_PATH}")"
  fi

  log_step "7/7 校验生效值"
  if [[ "${DRY_RUN}" == "1" ]]; then
    log_dry "逐项对比 sysctl -n 与期望值"
    log_success "[dry-run] 预览结束 · 未做任何改动"
    return 0
  fi
  _verify_applied
  log_success "全部生效 · 建议 24h 后回看：dmesg -T | tail -20 与 docker ps"
}

# =============================================================================
# revert：移除 Costra 管理的配置
# =============================================================================
do_revert() {
  [[ "${DRY_RUN}" == "1" ]] || require_root
  print_section_header "回滚宿主机内核调优"
  log_warn "将移除 ${DST_SYSCTL} 与 ${THP_UNIT_NAME}"
  log_warn "冲突文件的历史备份在 ${BACKUP_DIR}，如需恢复请人工挑选副本回填"
  log_warn "THP 的 /sys 值不会自动回到 always（需手动 echo 或重启）"
  if [[ "${DRY_RUN}" != "1" ]] && ! confirm "确认回滚？"; then
    die "已取消"
  fi

  log_step "移除 sysctl 配置"
  if [[ "${DRY_RUN}" == "1" ]]; then
    log_dry "rm -f ${DST_SYSCTL} && sysctl --system"
  elif [[ -f "${DST_SYSCTL}" ]]; then
    backup_file "${DST_SYSCTL}" "${BACKUP_DIR}"
    rm -f "${DST_SYSCTL}"
    sysctl --system >/dev/null
    log_success "已移除 ${DST_SYSCTL} 并重载"
  else
    log_info "${DST_SYSCTL} 不存在 · 跳过"
  fi

  log_step "停用 THP unit"
  if [[ "${DRY_RUN}" == "1" ]]; then
    log_dry "systemctl disable --now ${THP_UNIT_NAME} && rm -f ${DST_THP_UNIT}"
  elif [[ -f "${DST_THP_UNIT}" ]]; then
    systemctl disable --now "${THP_UNIT_NAME}" >/dev/null 2>&1 || true
    rm -f "${DST_THP_UNIT}"
    systemctl daemon-reload
    log_success "已移除 ${THP_UNIT_NAME}"
  else
    log_info "${DST_THP_UNIT} 不存在 · 跳过"
  fi

  log_step "移除 bbr 模块自加载"
  if [[ "${DRY_RUN}" == "1" ]]; then
    log_dry "rm -f ${BBR_MODULES_CONF}"
  elif [[ -f "${BBR_MODULES_CONF}" ]]; then
    rm -f "${BBR_MODULES_CONF}"
    log_success "已移除 ${BBR_MODULES_CONF}（已加载的模块需重启才卸载 · 无害）"
  else
    log_info "${BBR_MODULES_CONF} 不存在 · 跳过"
  fi

  log_warn "注意：被清理过的冲突文件不会自动还原（避免覆盖你之后的人工修改）"
  log_info "恢复命令示例：ls -1 ${BACKUP_DIR} 挑选副本后 cp -p 回原路径，再 sysctl --system"
}

# =============================================================================
# 分发
# =============================================================================
case "${TASK}" in
  # do_status 用退出码表达"有偏差"，放在 || 左侧属条件上下文，
  # 避免 common.sh 的 ERR trap 把正常的偏差报告误报成"脚本第 N 行失败"
  status) do_status || exit 1 ;;
  apply)  do_apply ;;
  revert) do_revert ;;
  *)      die "未知任务：${TASK}" ;;
esac
