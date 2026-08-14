# Costra · 宿主机内核参数调优基线（sysctl + THP）

> **状态**：✅ 可执行 · 已脚本化
> **日期**：2026-08-14
> **适用机器**：prod（机器① · 49.235.216.20 · 2核4G）与 staging/从库/分析机（机器②）通用
> **落地脚本**：[`infra/scripts/apply-host-tuning.sh`](../../infra/scripts/apply-host-tuning.sh)
> **配置源文件**：[`infra/host/sysctl-99-costra.conf`](../../infra/host/sysctl-99-costra.conf) · [`infra/host/disable-thp.service`](../../infra/host/disable-thp.service)
>
> **本文是宿主机内核参数的唯一执行基线**。凡对 `/etc/sysctl.d/99-costra.conf` 与 THP
> 的改动，必须先改仓库源文件再跑脚本，不允许在机器上直接手改（否则下次 `apply` 会覆盖）。

---

## §0 关键结论（先看这 7 条）

1. **判据是"在宿主机设了是否有效"，不是"服务器调优最佳实践"**。绝大多数网络栈 sysctl
   是 **per-netns** 的，compose 默认 bridge 下每个容器持有独立 net namespace，新 netns 由
   内核编译期默认值初始化、**不继承宿主机**。在宿主机调它们对业务链路**完全无效**（§6）。
2. **最终只落 5 个 sysctl + 关 THP**：`vm.swappiness` / `vm.dirty_ratio` /
   `vm.dirty_background_ratio` / `net.core.default_qdisc=fq` / `net.ipv4.tcp_congestion_control=bbr`。
3. **优先级排序**：THP→never（ROI 最高）> `dirty_ratio` > `fq + bbr` > 其余不做。
4. **`sysctl --system` 有加载顺序陷阱**：按字典序读 `/etc/sysctl.d/*.conf`，最后读
   `/etc/sysctl.conf`。`99-sysctl.conf` 与 `/etc/sysctl.conf` 排在 `99-costra.conf`
   **之后**，同名 key 会覆盖我们的值。脚本第 3 步专门清理，不清等于白改。
5. **宿主机部分不 recreate 容器**，`sysctl --system` 热生效，无 5xx 窗口。**但 bbr 例外**：
   它是 per-netns 的，已存在的 nginx 容器不会更新，**必须 recreate nginx**（§3.5.1），
   否则这一项对终端用户完全无效。
6. **验证必须分三层**：配置层（`sysctl -n` 读回值）→ 运行层（`tc qdisc show`、`lsmod`、
   `nsenter` 查容器 netns、`ss -tin` 看逐连接算法）→ 持久层（重启后还在）。
   **读回 sysctl 值 ≠ 功能生效**，bbr 尤其如此（值对但模块没加载 = 实际跑 cubic）。
7. **bbr 需要内核模块**：`sysctl` 只持久化算法名，模块不会自动加载。脚本会 `modprobe tcp_bbr`
   并写 `/etc/modules-load.d/costra-bbr.conf` 持久化，否则重启后算法静默回退 CUBIC。

---

## §1 实测基线（2026-08-14 · prod `VM-0-3-tencentos`）

| 参数 | 实测值 | 处置 | 说明 |
|---|---|---|---|
| THP | **`[always]`** | → `never` | **唯一现役性能地雷** |
| `vm.dirty_ratio` | **40** | → 15 | 桌面默认值，1.6GB 脏页一次刷 |
| `vm.dirty_background_ratio` | 默认 | → 5 | 与上一条配套 |
| `vm.swappiness` | 1 | 保持 1 · 纳入版控 | 原先只存在于机器上，未版本管理 |
| `net.core.default_qdisc` | `fq_codel` | → `fq` | BBR 官方推荐配套 |
| `net.ipv4.tcp_congestion_control` | cubic | → `bbr` | 移动弱网尾延迟 |
| `net.ipv4.tcp_max_tw_buckets` | 4096 | **不在宿主机改** | per-netns，宿主机改对业务无效（§5） |
| `net.core.somaxconn` | 4096 | 不动 | per-netns + 默认已够 |
| `vm.overcommit_memory` | 0 | **不动** | 改 1 有反作用（§5） |
| `fs.file-max` | 372223 | **不动** | 当前 172 socket，无收益（§5） |
| `net.ipv4.tcp_tw_reuse` | 2 | 不动 | 只作用 connect 侧且覆盖不到 bridge（§5） |
| 容器 `ulimit -n` | 1048576 | 记为待办 | 应**降**到 65535，非抬 file-max（§5） |
| `dmesg` tw 溢出 / SYN flooding | **0 条** | — | 无事故史 → 纯预防性 |
| `ss -s` | estab 5 · timewait 0 · total 172 | — | 网络栈**完全空载** |

> **"网络栈完全空载 + per-netns"是本方案取舍的全部依据**。

---

## §2 收录的 5 项 + THP 及其理由

| 项 | 生效范围 | 理由 |
|---|---|---|
| **THP → never** | 全局（`/sys`） | THP 下 fork 的 COW 粒度是 2MB 而非 4KB。prod 开着 `appendonly yes` + `appendfsync everysec`，Redis 的 AOF rewrite 是常态，每次 fork 产生**百 ms 级 stall**，PG 亦受影响。Redis 官方明确建议 never。**ROI 最高的一项。** |
| **`vm.dirty_ratio = 15`**<br>**`vm.dirty_background_ratio = 5`** | 全局（非 namespaced） | 默认 40 = 40% × 4G = **1.6GB 脏页积压后才强制刷盘**，届时整机 IO 阻塞。轻量云盘 IOPS 本就低，PG checkpoint 叠加 `pg_dump` 极易撞上。改小让刷盘均匀，**不会更慢，只会更稳**。四服务全部受益。 |
| **`vm.swappiness = 1`** | 全局 | 机器上已是 1，收进本文件是为了**纳入版本管理**。不用 0（0 禁用交换、反使 OOM killer 更激进地杀 PG）；不用 10（从库机大量 swap 会拉长 WAL 回放延迟 → 更易触发 `max_standby_streaming_delay` → `pg_dump` 被取消，违反"从库绝不反向影响主库"红线）。 |
| **`net.core.default_qdisc = fq`**<br>**`net.ipv4.tcp_congestion_control = bbr`** | 见右栏警告 | 用户端是微信小程序（移动网络，丢包率远高于机房内网）。CUBIC 把丢包当拥塞信号，弱网下过度退让；BBR 以带宽/RTT 建模，能显著改善弱网 API 尾延迟与大响应体（如统计接口）传输时间。`fq` 提供 pacing，是 BBR 官方推荐配套。<br>⚠️ **这两项都不是"改了 sysctl 就生效"**：`default_qdisc` 只影响新建设备（已 up 的网卡需 `tc qdisc replace`，脚本第 5/7 步做）；`tcp_congestion_control` 是 per-netns 且已存在的容器 netns 不会更新（**必须 recreate nginx**，见 §3.5.1）。 |

---

## §3 落地步骤

### 3.1 前置

```bash
ssh root@49.235.216.20
cd /root/Costra
git pull
cd infra/scripts
chmod +x apply-host-tuning.sh
```

### 3.2 体检（只读 · 先看差距）

```bash
./apply-host-tuning.sh status
```

输出四段：期望 vs 生效逐项对比、配置文件安装状态、**覆盖冲突检查**、THP 状态；
末尾打印可用拥塞控制算法、容器 `ulimit -n`、`ss -s` 概况与 dmesg 溢出计数（用于判断是否触发 §5）。

退出码：`0` = 全部符合期望；`1` = 存在偏差（首次跑必然是 1）。

### 3.3 预览（不改任何东西）

```bash
./apply-host-tuning.sh apply --dry-run
```

逐条打印将执行的动作，包括**会从哪个文件删掉哪些冲突 key**。

### 3.4 执行

```bash
./apply-host-tuning.sh apply
```

6 步，全部幂等：

| 步 | 动作 | 说明 |
|---|---|---|
| 1/6 | bbr 前置检查 | 查 `tcp_available_congestion_control`；不含 bbr 则 `modprobe tcp_bbr` 并写 `/etc/modules-load.d/costra-bbr.conf` 持久化；仍失败则 `die` 并提示从 conf 移除两行 |
| 2/6 | 安装 `/etc/sysctl.d/99-costra.conf` | 原文件先备份到 `/data/conf/host-tuning-backups/` |
| 3/6 | 清理覆盖冲突 | 从 `99-sysctl.conf` 与 `/etc/sysctl.conf` 删掉**与本 conf 同名**的 key，其余原样保留 |
| 4/6 | `sysctl --system` | 热加载，不重启 |
| 5/6 | 安装并 `enable --now disable-thp.service` | `--now` 立即执行，即时把 THP 置 never |
| 6/6 | 校验 | 逐项对比 `sysctl -n` 与期望值，任一不符即 `die` |

**冲突清理与校验都是自动的**：脚本从 `sysctl-99-costra.conf` 解析 key 列表，只删同名项。
未来往 conf 加参数时，冲突清理、校验、bbr 前置检查**自动跟随**，不需要改脚本——不存在第二份清单。

被刻意保留的既有设置：`tcp_max_tw_buckets`、`tcp_slow_start_after_idle`、`neigh.*.gc_thresh3`、
`kernel.sysrq`、`kernel.printk`、IPv6 开关（均不在本 conf 中，故不被第 3 步触碰）。

> 注：`/usr/lib/sysctl.d/50-default.conf` 里的 `default_qdisc=fq_codel` **无需清理**——
> `/usr/lib` 加载顺序在 `/etc` 之前，我们的值天然胜出，且不应改系统自带文件。

### 3.5 验收（三层验证 · 读回 sysctl 值 ≠ 功能已生效）

**最省事的方式**：`./apply-host-tuning.sh status` 已内置全部三层检查，退出码 `0` 即全部通过。
下面是它检查什么、以及如何手工复核。

#### 第 1 层 · 配置层（值是否被写进去）

```bash
sysctl vm.swappiness vm.dirty_ratio vm.dirty_background_ratio \
       net.core.default_qdisc net.ipv4.tcp_congestion_control
cat /sys/kernel/mm/transparent_hugepage/enabled     # 期望 always madvise [never]
```

这层只证明"内核接受了这个值"，**不证明功能在工作**。

#### 第 2 层 · 运行层（功能是否真的在生效）★ 最关键

| 项 | 验证命令 | 判据 |
|---|---|---|
| **qdisc** | `tc qdisc show dev $(ip route show default \| awk '/dev/{print $5}')` | 首行第 2 列是 `fq`。**`sysctl` 值对 ≠ 已挂载**：`default_qdisc` 只影响新建设备，已 up 的网卡必须 `tc qdisc replace`（脚本第 5/7 步做的事） |
| **bbr 模块** | `lsmod \| grep tcp_bbr` | 有输出。没有则 bbr 无法工作，`sysctl` 值只是个字符串 |
| **bbr 对用户生效** | `nsenter -t $(docker inspect -f '{{.State.Pid}}' costra-nginx) -n sysctl -n net.ipv4.tcp_congestion_control` | **必须是 `bbr`**。见下方 §3.5.1，这是最容易漏的一项 |
| **逐连接实证** | `nsenter -t $(docker inspect -f '{{.State.Pid}}' costra-nginx) -n ss -tin \| grep -o 'bbr' \| head` | 有 `bbr` 输出 = 真实用户连接正在使用 BBR。**这是最硬的证据** |
| **THP** | `grep AnonHugePages /proc/meminfo` | 数值趋近 0（已分配的大页不会立刻回收，观察趋势即可） |
| **dirty 阈值** | `docker exec costra-postgres grep -i checkpoint /var/log/postgresql/postgresql.log \| tail` | 观察 `write=`/`sync=` 耗时是否更平滑、无长尖峰（需积累一天数据对比） |

> `nsenter` 借宿主机的 `ss` / `sysctl` 进入容器 netns，**不依赖 alpine 容器内装工具**，
> 是查容器网络参数的通用手法。

#### 第 3 层 · 持久层（重启后是否还在）

```bash
test -f /etc/sysctl.d/99-costra.conf          && echo "sysctl 持久化 OK"
test -f /etc/modules-load.d/costra-bbr.conf   && echo "bbr 模块持久化 OK"
systemctl is-enabled disable-thp.service      # 期望 enabled
```

三者缺一都会导致**重启后静默回退**（尤其 bbr：`sysctl` 值还在，但模块没加载 → 实际跑 cubic）。

#### 服务面回归

```bash
docker ps                            # 四服务全 healthy
curl -sS https://costra.cloud/healthz
dmesg -T | tail -20                  # 无新增 error
```

---

### 3.5.1 ⚠️ bbr 必须额外 recreate nginx（否则对用户完全无效）

**这是本方案最容易漏的一步。**

`net.ipv4.tcp_congestion_control` 是 **per-netns** 的。新 netns 创建时会继承 `init_net`
（宿主机初始 namespace）**当时**的值——这一点与 `tcp_keepalive_time` 那类"用内核编译期默认值"
的参数不同。推论：

- 宿主机设成 bbr → **只对之后新建的 netns 生效**
- **nginx 容器的 netns 早已创建**，里面仍然是 cubic
- 而面向微信小程序用户的 TCP 服务端 socket **就在 nginx 容器的 netns 内**
- **拥塞控制算法由 socket 所在 netns 决定，不由数据包路径上的设备决定**

所以 `docker-compose.prod.yml` 的 nginx 服务已声明：

```yaml
    sysctls:
      - net.ipv4.tcp_congestion_control=bbr
```

**必须 recreate nginx 才会生效**（低峰执行，nginx 启动 < 2s，窗口极小）：

```bash
cd /root/Costra/infra
docker compose -f docker-compose.prod.yml --env-file /data/conf/server.env up -d nginx
```

只重建 nginx，不动 postgres / redis / server。之后用 §3.5 第 2 层的 `nsenter` 命令确认。

> **为什么只给 nginx 加**：四服务中只有 nginx 直面公网移动弱网。server→PG/Redis 走
> bridge 内网（RTT 亚毫秒、无丢包），换 BBR 无意义。
>
> **前置依赖**：容器无法自行加载内核模块，宿主机必须已 `modprobe tcp_bbr`
> （`apply-host-tuning.sh` 第 1/7 步负责，并写 `modules-load.d` 持久化）。
> 若宿主机没加载，nginx 容器会**启动失败**——这是期望行为（fail fast，
> 而非静默回退 cubic 让人误判已生效）。

### 3.6 回滚

```bash
./apply-host-tuning.sh revert
```

移除 `/etc/sysctl.d/99-costra.conf`、`disable-thp.service`、`/etc/modules-load.d/costra-bbr.conf` 并重载。

**三个注意**：
- 被清理过的 `99-sysctl.conf` / `/etc/sysctl.conf` **不会自动还原**（避免覆盖你之后的人工修改）。
  历史副本在 `/data/conf/host-tuning-backups/`，需人工挑选后 `cp -p` 回填再 `sysctl --system`。
- THP 的 `/sys` 值不会自动回到 `always`，需手动 `echo always > ...` 或重启。
- 已加载的 `tcp_bbr` 模块需重启才卸载（无害，因为 sysctl 已回退到 cubic）。

---

## §4 关于 THP unit 的实现选择

用 systemd unit 而不是 `rc.local`：TencentOS 不保证 `rc.local` 存在且已启用，而 `/sys`
写入重启即失效，必须有开机重放机制。unit 排在 `basic.target` 之前
（`DefaultDependencies=no` + `Before=basic.target`），确保 **docker 与容器起来之前
THP 已经是 never**——否则 Redis 可能在 THP 仍为 always 的窗口内启动。

`defrag` 节点在部分内核不存在，故用独立的 `ExecStart` + `|| true` 兜底，不让整个 unit 失败。

---

## §5 刻意不加的参数（含推翻常见建议的理由）

### 5.1 因 per-netns 而在宿主机无效

`net.core.somaxconn`、`net.ipv4.tcp_max_syn_backlog`、`net.ipv4.tcp_max_tw_buckets`、
`net.ipv4.tcp_tw_reuse`、`net.ipv4.tcp_keepalive_*`、`net.ipv4.ip_local_port_range`、
`net.ipv4.tcp_slow_start_after_idle`

**这些在宿主机 `99-costra.conf` 里设了对业务链路完全无效**（四服务各在自己的 bridge netns）。
宿主机上只有 certbot / cron 备份 / `pg_dump` / ssh 会用到，而那点连接量离任何阈值都差几个数量级。
要生效必须写进 compose `sysctls:`（见 §6，当前评估为负 ROI）。

补充事实：
- **`tcp_max_tw_buckets=4096` 保留不动**。虽然 4096 偏低，但宿主机侧连接量极小，
  且容器内该值是内核默认（远高于 4096），业务不受影响。
- **nginx 默认 `listen backlog=511`**，不在 `listen` 指令写 `backlog=` 的话，
  `somaxconn` 调到多少都不起作用——这是常被忽略的一环。
- **`tcp_tw_reuse` 只作用于 connect（客户端）侧**，不减少服务端 TIME_WAIT；
  且 TencentOS 的 `=2` 语义是"仅回环"，而 nginx→server / server→PG 走 bridge 而非
  loopback，**`=2` 本就覆盖不到这些链路**，改成 `1` 也解决不了不存在的问题。

### 5.2 收益为零或有反作用

| 参数 | 为什么不加 |
|---|---|
| **`vm.overcommit_memory = 1`** | 常见建议来自 Redis 官方，但**本机不适用**：redis `maxmemory` 仅 512M，在 4G 机上 `overcommit=0` 的启发式判定**不会拒绝**这个 fork。而 `=1` 允许无限超卖，真耗尽时交由 OOM killer 随机裁决，**PG 官方明确反对 `=1`**（postmaster 被杀会导致整实例重启）。收益是想象的，代价是真实的。**保持 0。** |
| **`fs.file-max` 抬到 1048576** | 当前 172 个 socket，离 372223 差 2000 倍。所谓"容器 `ulimit -n`=1048576 与宿主 37w 倒挂"不是 bug，是正常的分层限制。**真正该做的是把容器 `ulimits.nofile` 降到 65535**（防单容器耗尽宿主 fd），而不是抬宿主上限。已记为待办，不在本方案内。 |
| `fs.inotify.max_user_watches` | prod 无任何 inotify watcher（server 日志写固定文件由 logrotate cron 轮转，无 fs watcher）。纯浪费。 |
| `net.ipv4.ip_local_port_range` | 每 netns 有独立端口池，宿主机放宽零收益；且起点降到 10000 有抢占固定服务端口的风险。 |
| `net.core.netdev_max_backlog` | 2核轻量机软中断压力可忽略，dmesg 无丢包记录，默认值够用。 |
| `net.ipv4.conf.all.rp_filter = 1` | 已是 1（`/usr/lib/sysctl.d/50-default.conf` 提供），且**Docker 主机上对 `docker0`/`br-*` 强制严格 RPF 有丢包风险**；防 XFF 伪造是 `trustProxy` 的应用层问题，不是 RPF 能解决的。 |
| `net.ipv4.tcp_syncookies` | 默认 1，别关。 |
| `net.core.rmem_max` / `wmem_max` | 4G 小机不折腾 socket buffer，改大反而挤内存。 |
| `vm.nr_hugepages` | PG `shared_buffers=256MB` 太小不值得；配了忘清会白白扣掉可用内存。 |
| `kernel.pid_max` | TencentOS 默认已 4194304。 |
| 禁用 IPv6 | 腾讯云 DNS / 内网服务链路可能走 IPv6。 |
| `kernel.panic=5` | TencentOS 默认。生产宁可 panic 重启也别 hang 死。 |
| `net.ipv4.tcp_tw_recycle` | **新内核已删除，且 NAT 后面全乱。永久禁用。** |

### 5.3 触发条件（满足任一，回来补对应参数）

| 现象 | 应对 |
|---|---|
| `dmesg` 出现 `TCP: time wait bucket table overflow` 或 `possible SYN flooding` | 给 nginx/server 容器加 `sysctls`（§6），**同时**给 nginx `listen` 加 `backlog=` |
| PG 日志出现 `too many connections` | 先查 server 连接池 `idleTimeoutMillis`，再考虑容器 keepalive |
| `ss -s` 常态 timewait > 2000 | 容器侧 `tcp_max_tw_buckets` + `ip_local_port_range` |
| DAU 上到 500+ 或开始做 nginx 限流压测 | 整体复评 §5.1，并补 `nf_conntrack_max` 体检（Docker 全链路 NAT，真实上限可能在此） |

`apply-host-tuning.sh status` 会自动检测第一项并 warn。

---

## §6 宿主机 vs 容器：sysctl 的 namespace 边界

### 分类

| 类别 | 是否 namespaced | 生效点 |
|---|---|---|
| `vm.*`、`fs.*`、`kernel.*`、THP（`/sys`） | **否** | **只能宿主机**；容器直接读宿主值 |
| `net.core.default_qdisc` | 全局，但**只影响新建设备** | 宿主机 + 对已 up 网卡显式 `tc qdisc replace` |
| `net.ipv4.tcp_congestion_control` | **是**，但新 netns **继承 `init_net` 当时的值** | 宿主机（决定此后新建 netns 的默认）+ **已存在的容器需 recreate 或声明 `sysctls:`** |
| `net.core.netdev_max_backlog`、`net.netfilter.*` | **否**（全局） | **只能宿主机**；写进 compose `sysctls:` 会导致**容器启动失败** |
| `net.ipv4.*` 绝大多数、`net.core.somaxconn` | **是**（per netns，用内核编译期默认值） | 宿主机改了**容器完全不继承**；容器内需要则必须写进 compose `sysctls:` |

**两种 per-netns 行为要分清**（这是最容易踩的坑）：

- **`tcp_congestion_control` 型**：新 netns **继承 `init_net` 当时的值**。所以宿主机改了之后，
  *新建*的容器会继承，*已存在*的容器不会 → **recreate 即可生效**。
- **`tcp_keepalive_time` / `somaxconn` 型**：新 netns 用**内核编译期默认值**，永不继承宿主机。
  → recreate 也没用，**必须显式写 `sysctls:`**。

### 本方案的处置

| 参数 | 宿主机 | 容器 |
|---|---|---|
| `vm.*`、THP | ✅ 唯一生效点，已覆盖全部容器 | 无需处理 |
| `net.core.default_qdisc=fq` | ✅ + 脚本对主网卡 `tc qdisc replace` | 容器 veth 在 recreate 时继承 |
| `net.ipv4.tcp_congestion_control=bbr` | ✅（决定此后新建 netns）+ `modprobe tcp_bbr` | ⚠️ **nginx 已加 `sysctls:`，需 recreate 才生效**（§3.5.1） |

**除 nginx 外不改其他服务**：server→PG/Redis 走 bridge 内网（RTT 亚毫秒、无丢包），
换 BBR 无意义；而当前网络栈空载（estab 5 / tw 0），队列类参数加了也是零收益。

### 将来真要给容器加时（§5.3 触发后）

```yaml
  # nginx（最该加的一个 · 面向公网突发）
    sysctls:
      - net.core.somaxconn=4096
      - net.ipv4.tcp_max_syn_backlog=4096
      - net.ipv4.tcp_max_tw_buckets=32768
      - net.ipv4.tcp_slow_start_after_idle=0
    ulimits:
      nofile: 65535
```

四条硬约束：

1. **`netdev_max_backlog` / 任何 `vm.*` `fs.*` 绝不能进 `sysctls:`**（非 namespaced，
   runc 写入失败 → 容器起不来）。
2. **必须同时改 nginx 配置**：`listen 443 ssl http2 backlog=4096;` + upstream `keepalive 32;`，
   否则 `somaxconn` 白调（nginx 默认 backlog=511 会自己截断）。
3. `sysctls` 变更**必须 recreate 容器** → 有 5xx 窗口，**必须低峰执行**。
4. Docker 的 `daemon.json` **没有**全局默认 sysctls 支持，逐服务 `sysctls:` 是唯一干净做法。

---

## §7 与其他运维基线的关系

| 文档 / 文件 | 关系 |
|---|---|
| [`pg-standby-backup.md`](pg-standby-backup.md) | 机器②（staging + 从库 + 分析栈三栈共机）同样适用本文。该机已有 swap 配置写在 `99-costra.conf`，本文 conf 也含 `vm.swappiness=1`（值一致）；但 **apply 会覆盖该文件**，若机器上有本文未收录的自定义项，**先合并进仓库源文件再 apply**。 |
| swap 方案（1G swapfile + `swappiness=1`） | 与本文互补：swap 防死不防慢；本文的 `dirty_ratio` 与 THP 才治毛刺。两者都不治内存泄漏。 |
| [`maintenance-cron-plan.md`](../db/maintenance-cron-plan.md) | 本文**不安装任何 cron**。宿主机内核参数是一次性配置 + 版本管理，靠 `status` 子命令按需体检。 |
| `infra/logrotate/costra-ops` | 同类先例：宿主机侧配置文件放仓库 `infra/<类别>/`，由脚本 `install -m 0644` 装到系统路径，机器上不手改。 |

### 未纳入本方案的关联待办

| 项 | 说明 |
|---|---|
| 容器 `ulimits.nofile` 降到 65535 | 属 compose 改动（需 recreate），比抬 `fs.file-max` 更正确的加固方向 |
| `nf_conntrack_max` / `count` 体检 | Docker 全链路 NAT，高并发时真实上限可能在 conntrack 而非 TCP 参数 |
| nginx `listen backlog=` + upstream `keepalive` | 与容器 `sysctls` 是配套项，单独改任一方无效 |

---

## §8 变更记录

| 日期 | 变更 |
|---|---|
| 2026-08-14 | 初版。**关键修正 1**：初评建议的 `vm.overcommit_memory=1`、`fs.file-max=1048576`、宿主机 `tcp_max_tw_buckets=65536` 三项经复核**全部撤销**（分别因 PG 官方反对 / 无收益且方向错 / per-netns 无效）；补入初评遗漏的 `fq + bbr`。**关键修正 2**：原以为 `fq + bbr` 在宿主机设置即对容器流量生效，复核后确认 `tcp_congestion_control` 是 per-netns（已存在容器不更新）且 `default_qdisc` 只影响新建设备 → 补 nginx `sysctls:` + 脚本 `tc qdisc replace` + 三层验证。最终收录 5 项 sysctl + THP + nginx 单服务 `sysctls`。 |
| 2026-08-14 | 修正：`apply-host-tuning.sh` 对 `tc`/`ip` 缺失从 pipefail 硬失败改为**降级跳过**（status 跳过运行层 qdisc 检查、apply 跳过第 5 步，均提示安装 `iproute`/`iproute2`；qdisc 重启后由 sysctl 值生效）。在从库机（costra-prod-slave）精简镜像上首次暴露。 |
