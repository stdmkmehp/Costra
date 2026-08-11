# Costra · PG 主从复制实施方案（B 主库改造 / C 从库搭建 · 操作级）

> **状态**：📋 实施方案 · 待评估后执行
> **日期**：2026-07-08
> **目标**：现有单机 docker compose 的 PG → **2 台 CVM · 1 主 1 从 · 原生流复制 · 同步（`synchronous_commit=on`）· 从库故障手动降级**。
> **范围**：本轮只做主从复制 + 从库降级；pgBackRest/对象存储暂缓（沿用现有 4h `pg_dump`）；主库故障切换（promote）先手动、可后置。
> **现状事实**：主库 = `costra-postgres`（`postgres:15-alpine`），数据 bind mount `/data/pgsql`，仅 `127.0.0.1:5432` 暴露，`command` 已含 `password_encryption=scram-sha-256`。server 经 compose service name `postgres` 连库。

---

## §0 关键结论（先看这几条，能省很多功夫）

1. **PG 15 的复制相关默认值大多已经就绪**，主库几乎不用改这些：
   - `wal_level=replica`（PG15 默认就是 replica）✓
   - `max_wal_senders=10` ✓、`max_replication_slots=10` ✓、`hot_standby=on` ✓
   - → **真正必须显式设的只有两项**：`max_slot_wal_keep_size`（默认 -1 无限制，**危险，必须设**）和 `synchronous_standby_names`（默认空，要开同步必设）。
2. **主库改造几乎可以"零重启"**：上面两项都是 `reload` 级参数，用 `ALTER SYSTEM ... + SELECT pg_reload_conf()` **在线生效**；建复制用户、复制槽、改 pg_hba 也都在线。
   - **唯一需要重启主库容器的是"端口绑定变更"**（加内网 IP 映射），因为 `ports` 是 docker 层、改了必须 recreate 容器 → PG 会重启一次（秒级~十几秒），**建议低峰执行**。
3. **从库不跑 initdb、不跑 migration**：数据目录由 `pg_basebackup` 从主库物理复制而来，schema/扩展/数据全都带过来；migration 后续也通过复制流自动同步。

---

## §1 前置：新增的配置项（server.env）

在 `/data/conf/server.env` 增加两项（主库机器需要；从库机器只需知道主库 IP + 复制密码）：
```ini
# === PG 主从复制 ===
REPLICATOR_PW=<openssl rand -base64 32 | tr -d '/+=' 生成>   # 复制专用账号密码
PG_PRIMARY_LAN_IP=10.0.x.x        # 机器①（主）的 VPC 内网 IP
PG_STANDBY_LAN_IP=10.0.y.y        # 机器②（从）的 VPC 内网 IP（供 pg_hba 放行）
```
> `REPLICATOR_PW` 存入密码管理器。这三项不影响现有字段，`03-generate-env.sh --reuse-secrets` 的必填校验不涉及它们（如需纳入校验可后续补）。

---

## §2 阶段 B：主库改造（机器①）

### B-1 · 修改 `infra/docker-compose.prod.yml` 的 postgres 服务

**改动一：`ports` —— 增加内网 IP 映射（让机器②能连）**

现状：
```yaml
    ports:
      - "127.0.0.1:5432:5432"
```
改为：
```yaml
    ports:
      - "127.0.0.1:5432:5432"              # 保留：本机 server 连库
      - "${PG_PRIMARY_LAN_IP}:5432:5432"   # 新增：仅绑内网网卡 · 供机器② 复制
```
- 只绑内网 IP，**不绑 `0.0.0.0`、不进公网**。
- 需 `--env-file` 注入 `PG_PRIMARY_LAN_IP`（05-start-stack.sh 已用 `--env-file`，OK）。

**改动二：`command` —— 追加护栏参数（其余复制参数走 PG15 默认，不必写）**

在现有 `command` 末尾（`password_encryption=scram-sha-256` 之后）追加：
```yaml
      - "-c"
      - "max_slot_wal_keep_size=10GB"   # 护栏：防从库久挂→复制槽让主库 WAL 无限堆积撑爆盘
```
> `synchronous_standby_names` **不写在 command 里**——因为降级脚本要在线改它，放 command 会与 `ALTER SYSTEM` 打架。它由 B-4 用 `ALTER SYSTEM` 设置，作为运行时单一事实源。
> `wal_level/max_wal_senders/max_replication_slots/hot_standby` 若想显式也可加（PG15 默认已满足，可不加）。`synchronous_commit` 保持默认 `on`。

**改动三：`initdb.d` 挂载** —— **不动**。数据目录非空，initdb 不会再触发，保留无害。

### B-2 · 应用 compose 改动（这是主库唯一的一次重启）
```bash
cd /root/Costra/infra
docker compose -f docker-compose.prod.yml --env-file /data/conf/server.env up -d postgres
# compose 检测到 ports/command 变化 → recreate costra-postgres 容器（PG 重启一次）
docker inspect --format '{{.State.Health.Status}}' costra-postgres   # 等 healthy
```
> 只 recreate `postgres`；`server` 不会重建，但主库重启的几秒内 server 到库连接会瞬断后自动重连（Fastify/pg pool 会重连，健康检查短暂波动）。**建议低峰执行**。

### B-3 · 建复制账号 + 复制槽（在线 · 一次性）
新增脚本 `infra/scripts/setup-replication-primary.sh`，核心是 `docker exec` 执行：
```bash
# 复制专用角色（最小权限：只有 REPLICATION + LOGIN）
docker exec -e PGPASSWORD="$PG_COSTRA_PW" costra-postgres \
  psql -U costra -d costra -v ON_ERROR_STOP=1 -c \
  "DO \$\$ BEGIN
     IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='replicator') THEN
       CREATE ROLE replicator WITH REPLICATION LOGIN PASSWORD '$REPLICATOR_PW';
     END IF;
   END \$\$;"

# 物理复制槽（保证从库断开后主库保留其所需 WAL；配合 B-1 的 max_slot_wal_keep_size 上限）
docker exec -e PGPASSWORD="$PG_COSTRA_PW" costra-postgres \
  psql -U costra -d costra -tA -c \
  "SELECT pg_create_physical_replication_slot('costra_standby')
   WHERE NOT EXISTS (SELECT 1 FROM pg_replication_slots WHERE slot_name='costra_standby');"
```

### B-4 · 放行复制连接（pg_hba）+ 开启同步（在线 · reload）

**pg_hba.conf**：数据目录是 bind mount，所以 `pg_hba.conf` 就在宿主机 `/data/pgsql/pg_hba.conf`，**直接在宿主机 append** 最简单：
```bash
HBA=/data/pgsql/pg_hba.conf
LINE="host replication replicator ${PG_STANDBY_LAN_IP}/32 scram-sha-256"
grep -qxF "$LINE" "$HBA" || echo "$LINE" >> "$HBA"     # 幂等
```
**设置同步从库名 + reload（在线生效，不重启）**：
```bash
docker exec -e PGPASSWORD="$PG_COSTRA_PW" costra-postgres psql -U costra -d costra -c \
  "ALTER SYSTEM SET synchronous_standby_names = 'FIRST 1 (costra_standby)';"
docker exec -e PGPASSWORD="$PG_COSTRA_PW" costra-postgres psql -U costra -d costra -c \
  "SELECT pg_reload_conf();"
```
> ⚠️ **首次落地建议：先不设 `synchronous_standby_names`（留空 = 异步）**，等 §3 从库搭好、异步复制跑通、验证无误后，再执行这一步切同步。降低首次风险（见 §4）。

---

## §3 阶段 C：从库搭建（机器②）

### C-0 · 前置
- 机器② 已装 docker、clone 仓库、跑过 `02-prepare-dirs.sh`（建 `/data/pgsql` 等目录）。
- `/data/pgsql` **必须为空**（从库数据完全来自主库）。
- 机器② server.env 里有 `REPLICATOR_PW`、`PG_PRIMARY_LAN_IP`。
- 安全组已放行：机器① 的 5432 对机器② 内网 IP 开放。

### C-1 · `pg_basebackup` 初始化从库数据目录（一次性）
新增脚本 `infra/scripts/setup-replication-standby.sh`，核心：
```bash
docker run --rm \
  --user postgres \                                  # 关键：以 postgres 用户跑，避免生成 root 属主文件
  -e PGPASSWORD="$REPLICATOR_PW" \
  -v /data/pgsql:/var/lib/postgresql/data \
  postgres:15-alpine \
  pg_basebackup \
    -h "$PG_PRIMARY_LAN_IP" -p 5432 -U replicator \
    -D /var/lib/postgresql/data \
    -Fp -Xs -R -S costra_standby \
    -d "application_name=costra_standby"
```
参数说明：
- `-R`：自动写 `standby.signal` + `primary_conninfo`（含 host/user/slot/application_name）到 `postgresql.auto.conf` → 容器一启动即以 standby 模式连主库。
- `-Xs`（stream）：边备份边拉 WAL，保证一致性。
- `-S costra_standby`：绑定 B-3 建的复制槽。
- `-d "application_name=costra_standby"`：**必须**，否则主库 `synchronous_standby_names='FIRST 1 (costra_standby)'` 匹配不上、同步不生效。

**权限坑（务必注意）**：
- 直接 `docker run ... pg_basebackup` 会绕过镜像 entrypoint。若不加 `--user postgres`，会以 root 生成文件，PG 启动会因"数据目录属主/权限不对"拒绝启动。
- 加 `--user postgres` 的前提：宿主机 `/data/pgsql` 对镜像内 postgres 用户（alpine 版 uid=70）可写。若报权限错，先 `chown -R 70:70 /data/pgsql`（空目录，安全）。
- 备份完成后校验：`ls /data/pgsql/standby.signal` 存在、`grep primary_conninfo /data/pgsql/postgresql.auto.conf` 含 `application_name=costra_standby`。

### C-2 · 新增 `infra/docker-compose.standby.yml`（从库编排）
与主库 postgres 服务基本一致，差异：**不挂 initdb.d、不暴露公网、供 promote 后本机连接**。
```yaml
name: costra
services:
  postgres:
    image: postgres:15-alpine
    container_name: costra-postgres            # 与主库同名无妨（不同机器）
    restart: unless-stopped
    ports:
      - "127.0.0.1:5432:5432"                  # 仅本机（promote 后给本机 server 用）
      - "${PG_STANDBY_LAN_IP}:5432:5432"       # 内网（可选：反向复制/监控）
    environment:
      TZ: Asia/Shanghai
      # 注意：不设 POSTGRES_USER/PASSWORD/DB —— 数据目录已存在，不触发 initdb
    volumes:
      - /data/pgsql:/var/lib/postgresql/data   # 已由 pg_basebackup 填充
      - /data/logs/postgres:/var/log/postgresql
      # 不挂 ./postgres/initdb.d（关键区别）
    command:
      - "postgres"
      - "-c"
      - "hot_standby=on"                       # 允许从库只读查询
      - "-c"
      - "max_slot_wal_keep_size=10GB"          # 与主库对等（promote 后即成主）
      - "-c"
      - "password_encryption=scram-sha-256"
      # synchronous_standby_names 不设（从库无下游）
      # primary_conninfo / standby.signal 已由 basebackup -R 写入数据目录，无需在此重复
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U costra -d costra"]
      interval: 5s
      timeout: 3s
      retries: 10
      start_period: 30s
    deploy:
      resources:
        limits: { memory: 1G, cpus: '1.0' }
    logging:
      driver: json-file
      options: { max-size: "100m", max-file: "5" }
```
> 从库 `command` 里的静态参数应与主库对等（因为一旦 promote，它就变成主库）。`shared_buffers` 等按机器②规格设。

### C-3 · 启动从库
```bash
cd /root/Costra/infra
docker compose -f docker-compose.standby.yml --env-file /data/conf/server.env up -d
docker logs costra-postgres --tail 30      # 应看到 "started streaming WAL from primary"
```
> 从库 **不跑** `06-migrate.sh`（migration 通过复制自动到达），**不跑** initdb。

---

## §4 Docker 启动方式的变化（汇总回答）

| | 现在 | 主从后 |
|---|---|---|
| **主库（机器①）日常启动** | `05-start-stack.sh` / `docker compose -f docker-compose.prod.yml up -d` | **不变**（同命令） |
| **主库一次性变更** | — | ①compose 改 ports/command 后 `up -d postgres`（**一次重启**）②`setup-replication-primary.sh`（在线，无重启） |
| **从库启动** | 无 | ①`setup-replication-standby.sh`（pg_basebackup 一次性）②`docker compose -f docker-compose.standby.yml up -d`（**不 initdb、不 migrate**） |
| **主库 server/redis/nginx** | 不变 | **完全不变**（复制是 PG 层的事，server 仍连本机 `postgres`） |

---

## §5 建议落地顺序（稳妥路径）

1. 机器② 就位 + 网络/安全组通（§3 C-0）。
2. 主库改 compose（ports + max_slot_wal_keep_size）→ `up -d postgres`（一次重启）。
3. 主库 `setup-replication-primary.sh` 建用户/槽/pg_hba，**但先不设 synchronous_standby_names（异步）**。
4. 从库 `pg_basebackup` + 启动 → 验证异步复制跑通（`pg_stat_replication` 见 streaming）。
5. 主库 `ALTER SYSTEM SET synchronous_standby_names='FIRST 1 (costra_standby)'` + reload → **切同步**，验证 `sync_state=sync`。
6. 加降级脚本（`maintenance.sh sync-degrade/sync-restore`）+ 监控告警。

> **先异步跑通、再切同步**：这是把首次落地风险降到最低的关键顺序——异步阶段即使配置有误也不会阻塞主库写入。
