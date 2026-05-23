# Costra · prod 服务首次 bootstrap 手册（v1.1 · tlinux3.3 + 本地 PG/Redis）

> **本手册为 Costra 项目首次生产服务部署交接单**。Agent 无生产 SSH 访问权 · Agent 出手册 + Human 跑命令 · 每步含验证 + 期望输出 · 高危段标 ⚠️ Human 拍板。
>
> **母决策**：D-009（域名 + 安全基线）/ D-023（prod 入口回归根域）/ **D-026（staging↔prod 合并 · 工程纪律 4 条 · 同对话轮交付）**
> **交付者**：Orchestrator（devops-ops 装扮档工具白名单错配兜底落档 · D-026 §6.1 incident 备注）
> **日期**：2026-05-23
> **HEAD**：a2a3959（dev 分支 · 含 0001~0006 共 6 条 migration · entries_change_seq SEQUENCE 已就绪）
> **目标读者**：Human（拥有 49.235.216.20 root SSH 访问权 + 腾讯云控制台 + 微信公众平台后台访问权）
>
> **v1.1 修订**（2026-05-23 21:10 · Human 反馈 2 条调整后重写）：
> - **OS 校准**：从 Debian/Ubuntu（apt）改为 **tlinux3.3**（腾讯定制 RHEL/CentOS Stream 8 系 · dnf/yum 包管理 · systemd 原生 · firewalld 默认）
> - **DB/Redis 部署模式**：从 docker compose 改为**本地原生安装 PostgreSQL 15 + Redis 7**（systemd 直管 · 减少容器层 · 更贴 prod 单机部署最佳实践）
> - **配套修订**：§1.1 工具补装命令换 dnf · §3 全段重写 · §6 migrate 命令调整（DB_URL 而非 DATABASE_URL · 跟 server/scripts/dev/migrate.sh:13 实际默认值对齐）· §9 故障排查同步换 PG/Redis 本地排查命令
> - **pgcrypto + citext 扩展**：本地装时需 `postgresql15-contrib` 包 + 在 DB 内 `CREATE EXTENSION`（事实源：`server/db/migrations/0001_init.sql:10-11`）

---

## §0 一句话总览

首次 prod 服务部署 · 在 49.235.216.20（**tlinux3.3**）上跑 PostgreSQL 15 + Redis 7（**本地原生 systemd**）+ Node.js Fastify server + nginx 反代 + Let's Encrypt + systemd · 预计 Human 操作时间 75~120 分钟 · 产出 prod 入口 `https://costra.cloud/v1` 可达 + Phase-2 闸门 5 条全 PASS。

**部署架构（运行后）**：

```
微信小程序  →  https://costra.cloud  (443/SSL · Let's Encrypt)
                ↓ nginx 反代（含 X-ICP-Filing header）
                127.0.0.1:8080  (Fastify · systemd costra-server.service)
                ↓
                127.0.0.1:5432  (postgresql · systemd postgresql-15.service · 本地原生)
                127.0.0.1:6379  (redis · systemd redis.service · 本地原生)
```

**所有服务统一 systemd 管理**（无 docker 层）：
- `postgresql-15.service`（PG 15 · prod 主库）
- `redis.service`（Redis 7 · 同步队列 / 缓存）
- `costra-server.service`（Fastify Node.js）
- `nginx.service`（反代 + SSL termination）
- `certbot-renew.timer`（证书自动续期）

**D-026 §2.3 红线在本手册落地位置**：
- C1 灰度隔离 → §4 .env.prod 不引入 staging-only feature flag
- **C2 mock 防护 → §4.1 + §5.2 + §5.3 + §8（最严 · 三处显式）**
- C3 DB 操作三件套 → §6 migrations
- C4 测试数据隔离 → §10 后续加固清单（Phase-3 实测时落实）

---

## §1 前置确认（5 条 · Human 自检 · 全 PASS 才进 §2）

| # | 项 | 验证命令（Human 本机或 SSH 后跑） | 期望 |
|---|---|---|---|
| 1 | SSH 可登 | `ssh root@49.235.216.20 hostname` | 返回主机名 · 不报权限错 |
| 2 | OS 确认 tlinux3.3 | `ssh root@49.235.216.20 'cat /etc/os-release \| head -5'` | 含 `TencentOS Server 3.3` 或 `tlinux 3.3` 字样 · 含 `ID_LIKE=rhel fedora` |
| 3 | DNS 已生效 | `dig +short costra.cloud` | 返回 `49.235.216.20` |
| 4 | 防火墙基线（D-009 §2.4） | `ssh root@49.235.216.20 'firewall-cmd --list-all 2>/dev/null \|\| iptables -L -n \| head -20'` | 仅放 22(改后)/80/443 · 其他默认拒绝 |
| 5 | 基础工具 | `ssh root@49.235.216.20 'dnf --version && git --version'` | dnf 4.x+ · git 2.x+（任一缺失走 §1.1） |

> ⚠️ **前置闸门**：若第 4 项（防火墙基线 D-009 §2.4 SSH 改非 22 端口 / fail2ban / 登录失败告警 / `R-018 🟠`）未到位，**先补齐再进 §2**。不要在公网开 5432/6379/8080 端口暴露未配 SSL 的服务。

### §1.1 缺失工具补装（tlinux3.3 · dnf 包管理）

```bash
ssh root@49.235.216.20

# 0. 系统更新（推荐 · 但费时 · 可跳过）
# dnf update -y

# 1. Node.js 20（NodeSource 官方仓 · 兼容 RHEL 8 系）
curl -fsSL https://rpm.nodesource.com/setup_20.x | bash -
dnf install -y nodejs
node --version  # 期望 v20.x.x
npm --version

# 2. PostgreSQL 15（PGDG 官方仓 · tlinux3.3 = RHEL 8 系）
# 添加 PGDG 仓
dnf install -y https://download.postgresql.org/pub/repos/yum/reporpms/EL-8-x86_64/pgdg-redhat-repo-latest.noarch.rpm

# 禁用 tlinux 自带的 postgresql 模块（避免冲突）
dnf -qy module disable postgresql

# 装 PG 15 server + client + contrib（contrib 含 pgcrypto / citext 扩展 · 0001_init.sql 必需）
dnf install -y postgresql15-server postgresql15 postgresql15-contrib

postgres --version  # 期望 postgres (PostgreSQL) 15.x

# 3. Redis 7（tlinux3.3 默认仓可能只有 redis 5/6 · 装 EPEL 后取最新）
dnf install -y epel-release
dnf install -y redis
redis-server --version  # 期望 v=7.x.x

# 4. nginx（tlinux 默认仓有）
dnf install -y nginx
nginx -v

# 5. certbot（Let's Encrypt nginx 插件）
dnf install -y certbot python3-certbot-nginx
certbot --version

# 6. 实用工具
dnf install -y jq vim openssl ca-certificates
```

> 📌 **tlinux3.3 与 CentOS Stream 8 / RHEL 8 兼容**：上述 PGDG / EPEL / NodeSource 三方仓的 `EL-8` 包都可用。如某仓签名校验失败，临时加 `--nogpgcheck` 通过（不推荐 prod 长期使用）。

---

## §2 拉代码 + 安装依赖

### §2.1 ⚠️ Human 拍板段：仓库 URL

仓库 URL 由 Human 提供 · 推荐两路：

| 路径 | 命令 | 优势 | 劣势 |
|---|---|---|---|
| **P1（推荐）** | `git clone <Human 提供的仓库 URL> /opt/costra` | 标准 · 后续可 `git pull` 增量更新 · 与本地一致 | 需要先在工蜂 / GitHub 内建仓 |
| **P2** | `rsync -avz --exclude=node_modules --exclude=.git /Users/weizhao/Desktop/Costra/ root@49.235.216.20:/opt/costra/` | 首次部署快 · 无需建仓 | 后续手动同步 · 不留 git 历史 |

### §2.2 拉代码

```bash
ssh root@49.235.216.20
mkdir -p /opt
cd /opt

# P1 路径（推荐）
git clone <仓库 URL> costra
cd /opt/costra/server
git checkout dev   # D-019 决议 G4 合并闸门 · Sprint-3 阶段 prod 仍以 dev HEAD 跑
git log --oneline -1
# 期望：a2a3959 ... 或更新（如本地之后又 push 了新 commit · 取最新 dev HEAD）
```

### §2.3 安装依赖

```bash
cd /opt/costra/server
npm install
# 期望：依赖装完无 error · vulnerabilities 列表可有但不要 critical
```

> 📌 注意：**含 dev deps**（不带 `--production` 标志）· 因为 server 用 `tsx --import tsx/esm src/server.ts` 跑 .ts 源码（不预编译）· tsx 在 devDependencies 中。

---

## §3 本地装 PostgreSQL 15 + Redis 7（systemd 直管）

> 📌 **v1.1 重大修订**：本节从 docker compose 改为**本地原生安装** · tlinux3.3 + systemd 是 prod 单机部署最佳实践（减少容器层 · 监控/备份/升级路径更标准）。

### §3.1 PostgreSQL 15 初始化 + 启动

#### 步骤 1：初始化数据目录（首次启动前必做 · 否则 systemd 起不来）

```bash
# PG 15 数据目录默认 /var/lib/pgsql/15/data
/usr/pgsql-15/bin/postgresql-15-setup initdb
# 期望：Initializing database ... OK
```

#### 步骤 2：启动 + 自启

```bash
systemctl enable --now postgresql-15
systemctl status postgresql-15
# 期望：Active: active (running)

# 验证端口
ss -tlnp | grep 5432
# 期望：LISTEN ... 127.0.0.1:5432 ...（默认仅监听 localhost · 不暴露公网 · 安全合规）
```

#### 步骤 3：建 costra 用户 + costra DB（**§3.4 强密码生成** + 复用）

```bash
# 切到 postgres 系统用户跑 psql（PG 默认 peer 认证）
sudo -iu postgres

# 生成 prod 强密码（在 root shell 跑 · 记到本机密码管理器）
# 提前离开 postgres 用户：exit
# 在 root shell 跑：
#   PG_PW=$(openssl rand -base64 32 | tr -d '/+=')   # 去掉特殊字符避免 URL encode
#   echo "$PG_PW"   # 复制到密码管理器 · 然后 unset
# 假设强密码已生成 · 下面继续 postgres 用户内：

# 进 psql
psql

# 在 psql 里执行：
CREATE USER costra WITH PASSWORD '<§3.4 强密码>';
CREATE DATABASE costra OWNER costra ENCODING 'UTF8' LC_COLLATE 'en_US.UTF-8' LC_CTYPE 'en_US.UTF-8' TEMPLATE template0;
GRANT ALL PRIVILEGES ON DATABASE costra TO costra;

-- 在 costra DB 里建扩展（pgcrypto + citext · 0001_init.sql 必需 · server/db/migrations/0001_init.sql:10-11）
\c costra
CREATE EXTENSION IF NOT EXISTS "pgcrypto";
CREATE EXTENSION IF NOT EXISTS "citext";
\dx
-- 期望：plpgsql / pgcrypto / citext 三行

\q
exit  # 回 root shell
```

#### 步骤 4：配置认证（pg_hba.conf）

```bash
# tlinux3.3 / RHEL 8 默认 pg_hba.conf 路径
PGHBA=/var/lib/pgsql/15/data/pg_hba.conf

# 备份
cp $PGHBA $PGHBA.bak-$(date +%Y%m%d)

# 改为 SCRAM 认证（PG 13+ 推荐 · 比 md5 安全）
# 编辑 pg_hba.conf · 把 local/host 行的 ident/peer/md5 改 scram-sha-256
vim $PGHBA

# 推荐配置（仅保留下面 4 行 · 注释或删除其他默认行）：
# local   all             postgres                                peer
# local   all             all                                     scram-sha-256
# host    all             all             127.0.0.1/32            scram-sha-256
# host    all             all             ::1/128                 scram-sha-256

# 编辑 postgresql.conf · 启用 scram
PGCONF=/var/lib/pgsql/15/data/postgresql.conf
sed -i "s/^#\?password_encryption.*/password_encryption = scram-sha-256/" $PGCONF

# reload（不重启 · 配置层面改动）
systemctl reload postgresql-15

# 验证连接
PGPASSWORD='<§3.4 强密码>' psql -h 127.0.0.1 -U costra -d costra -c '\dx'
# 期望：plpgsql / pgcrypto / citext 三行
```

> ⚠️ **如果连接失败 `password authentication failed`**：
> - 看 PG 日志：`tail -50 /var/lib/pgsql/15/data/log/postgresql-*.log`
> - 在 psql 里重置密码：`sudo -iu postgres psql -c "ALTER USER costra WITH PASSWORD '<新密码>'"`
> - 确认 pg_hba.conf 改的是 scram-sha-256 不是 md5

### §3.2 Redis 7 配置 + 启动

#### 步骤 1：配置（/etc/redis.conf · tlinux3.3 路径）

```bash
# 备份
cp /etc/redis.conf /etc/redis.conf.bak-$(date +%Y%m%d)

# 关键配置项（vim 编辑 · 或 sed 批改）
REDIS_CONF=/etc/redis.conf

# 1. 仅监听 localhost（不暴露公网 · 安全合规）
sed -i "s/^bind .*/bind 127.0.0.1 ::1/" $REDIS_CONF

# 2. 关闭 protected-mode（既然只 bind localhost · protected-mode 多余 · 但保留 yes 更稳）
# protected-mode yes 默认 · 不改

# 3. 设置 Redis 密码（**§3.4 同样从强密码生成**）
REDIS_PW='<openssl rand -base64 32 | tr -d "/+=" 生成 · 与 PG 不同串>'
sed -i "s/^# requirepass.*/requirepass $REDIS_PW/" $REDIS_CONF
# 或：echo "requirepass $REDIS_PW" >> $REDIS_CONF

# 4. 启用 AOF 持久化（PG 已有 WAL · Redis 用 AOF 防进程崩）
sed -i "s/^appendonly no/appendonly yes/" $REDIS_CONF

# 5. 内存上限（防 OOM 击穿系统 · 看你机器 RAM · 这里设 512M）
echo "maxmemory 512mb" >> $REDIS_CONF
echo "maxmemory-policy allkeys-lru" >> $REDIS_CONF

# 验证关键配置已写入
grep -E "^(bind|requirepass|appendonly|maxmemory)" $REDIS_CONF
```

#### 步骤 2：启动 + 自启

```bash
systemctl enable --now redis
systemctl status redis
# 期望：Active: active (running)

# 验证端口
ss -tlnp | grep 6379
# 期望：LISTEN ... 127.0.0.1:6379 ...

# 验证密码连通
redis-cli -a "$REDIS_PW" ping
# 期望：PONG

# unset 密码变量（防 shell history 泄漏）
unset REDIS_PW
```

### §3.3 验证 PG + Redis 全栈

```bash
# 1. PG 表查询（应为空 · 表 §6 才建）
PGPASSWORD='<§3.4 PG 强密码>' psql -h 127.0.0.1 -U costra -d costra -c '\dt'
# 期望：Did not find any relations.

# 2. Redis SET/GET smoke
redis-cli -a '<§3.4 Redis 强密码>' SET costra:bootstrap:test ok
redis-cli -a '<§3.4 Redis 强密码>' GET costra:bootstrap:test
# 期望：OK / "ok"
redis-cli -a '<§3.4 Redis 强密码>' DEL costra:bootstrap:test
```

### §3.4 ⚠️ 强密码生成统一指引（PG + Redis + JWT 都用此方法）

```bash
# 生成方式（在 root shell 跑 · 不在 SSH 里循环跑 · 防 history 残留）
openssl rand -base64 32 | tr -d '/+='
# 输出形如：xK7mP9...（30~32 字符 · 已去掉 URL 特殊字符 · 不需 URL encode）

# 三个独立强密码：
#   PG_COSTRA_PW    · §3.1 步骤 3 + §4.1 DATABASE_URL
#   REDIS_PW        · §3.2 步骤 1 + §4.1 REDIS_URL
#   JWT_SECRET      · §4.1（建议用 openssl rand -base64 64 更长）

# **绝对不能**：
#   - 进对话 / IM / 邮件 / 截图
#   - 进 git 仓库（即使是私仓）
#   - 用 export 后忘记 unset（shell history 残留）
#   - 三密码相同（独立轮换原则）

# 推荐：生成后立刻 vim /etc/costra/server.env（§5.2）填入 + 同时记本机密码管理器
```

> 🚨 **D-026 §2.3 C2 关联 + R-008 红线**：以上 3 个密码任一泄漏 → 立即触发安全事件 · 走 D-026 §2.4 (δ) 重启子域 + 全密钥轮换。

---

## §4 server `.env.prod` 配置（**不进仓库**）

### §4.1 必填字段清单（从 systemd EnvironmentFile §5.2 注入 · 不写 .env.prod 文件本身）

> ⚠️ **重要**：本节为字段清单 · 实际值通过 §5.2 systemd EnvironmentFile 注入 · **不要在 server/ 目录创建 .env.prod 文件**（避免误进仓 · 即使 .gitignore 覆盖）

| 字段 | 值 | 来源 / 取得方式 |
|---|---|---|
| `NODE_ENV` | `production` | 强制 |
| `PORT` | `8080` | 默认（nginx 反代到此端口） |
| `DATABASE_URL` | `postgres://costra:<§3.4 PG 强密码>@127.0.0.1:5432/costra` | §3.1 + §3.4 |
| `REDIS_URL` | `redis://:<§3.4 Redis 强密码>@127.0.0.1:6379` | §3.2 + §3.4（**注意**：Redis 密码用法 `redis://:PASSWORD@host` · 冒号前空 user） |
| `JWT_SECRET` | `openssl rand -base64 64` 生成 | **本机生成** · 记录到密码管理器 · 不进任何文件 |
| `JWT_ISSUER` | `https://costra.cloud` | D-009 |
| `JWT_AUDIENCE` | `costra-miniapp` | 既有 |
| `WX_APP_ID` | `wxf8b0d3e3a83f9941` | infra/wechat/domains.md §0 |
| `WX_APP_SECRET` | `<Human 从微信公众平台拿>` | **D-026 §2.3 C2 红线** · 微信公众平台 → 开发 → 开发管理 → 开发设置 → AppSecret（重置 / 显示） |
| **`WX_MOCK_LOGIN`** | **`0`（必须显式写 0）** | **D-026 §2.3 C2 强制 · 不能省略 / 不能注释 / 不能空** |
| `ICP_FILING_NUMBER` | `沪ICP备2026017253号-2` | infra/wechat/domains.md §0（如 server/src/config/icp.ts 已硬编码可省） |

> 📌 **JWT_SECRET 与本地 dev 不一样**：dev 环境 JWT_SECRET 在 server/.env 是 dev 值；prod 必须用 `openssl rand -base64 64` 全新生成 · 与 dev 隔离 · 一旦泄漏需要轮换全部 user token。

### §4.2 ⚠️ WX_APP_SECRET 取得操作步骤（Human 浏览器跑）

1. 登录 https://mp.weixin.qq.com（Costra 小程序管理员账号）
2. 左侧菜单 → 开发 → 开发管理 → 开发设置
3. 「AppSecret(小程序密钥)」段 → 点击「重置」（首次取或已忘）
4. 完成管理员扫码 → 显示 AppSecret 字符串（32 字符）
5. **立即复制到本机密码管理器** · 微信平台关闭页面后无法再次显示完整字符串

⚠️ **D-026 §2.3 C2 + R-008 红线**：AppSecret **绝对不能**进任何 git 仓库 · 不能进对话历史 · 不能进邮件 / IM。

---

## §5 systemd service unit 落盘

### §5.1 `/etc/systemd/system/costra-server.service`

```bash
cat > /etc/systemd/system/costra-server.service <<'EOF'
[Unit]
Description=Costra Server (Fastify · Node.js 20)
After=network-online.target postgresql-15.service redis.service
Wants=network-online.target
Requires=postgresql-15.service redis.service

[Service]
Type=simple
User=root
# ⚠️ FU-PROD-NON-ROOT-USER（§10 后续加固）：建议改 costra 非特权用户
WorkingDirectory=/opt/costra/server
EnvironmentFile=/etc/costra/server.env
ExecStart=/usr/bin/node --import tsx/esm src/server.ts
Restart=on-failure
RestartSec=5s
StandardOutput=append:/var/log/costra/server.log
StandardError=append:/var/log/costra/server.err.log

[Install]
WantedBy=multi-user.target
EOF
```

> 📌 **v1.1 修订**：`After=docker.service` 改为 `After=postgresql-15.service redis.service` · `Requires=postgresql-15.service redis.service`（PG 或 Redis 挂掉 · costra-server 也跟着停 · 避免连接错误风暴）

### §5.2 `/etc/costra/server.env`（EnvironmentFile · 0600 权限）

```bash
mkdir -p /etc/costra /var/log/costra
chmod 0700 /etc/costra

# 编辑 /etc/costra/server.env（按 §4.1 清单字段填）
# 推荐用 vim · 不要用 echo 链式（防 shell history 残留）
vim /etc/costra/server.env

# 文件内容（一行一字段 · KEY=VALUE 格式 · 末行无空格 · 无引号 · 注意 # 不可作为行内注释）：
# NODE_ENV=production
# PORT=8080
# DATABASE_URL=postgres://costra:<§3.4 PG 强密码>@127.0.0.1:5432/costra
# REDIS_URL=redis://:<§3.4 Redis 强密码>@127.0.0.1:6379
# JWT_SECRET=<openssl rand -base64 64 输出>
# JWT_ISSUER=https://costra.cloud
# JWT_AUDIENCE=costra-miniapp
# WX_APP_ID=wxf8b0d3e3a83f9941
# WX_APP_SECRET=<微信公众平台取得>
# WX_MOCK_LOGIN=0

# 设置严格权限
chmod 0600 /etc/costra/server.env
ls -la /etc/costra/server.env
# 期望：-rw------- 1 root root ... server.env
```

### §5.3 启动 service + 验证启动日志（关键 D-026 §2.3 C2）

```bash
systemctl daemon-reload
systemctl enable costra-server
systemctl start costra-server
systemctl status costra-server
# 期望：Active: active (running)
```

**关键验证**（D-026 §2.3 C2 mock 防护）：

```bash
tail -n 50 /var/log/costra/server.log
# 期望 pino JSON 输出包含：
# {"level":30,"time":...,"msg":"Server listening at http://0.0.0.0:8080"}
#
# **绝对不能**包含以下字段（出现立即 systemctl stop · 排查 EnvironmentFile）：
# - "wxMockLogin":true
# - "WX_MOCK_LOGIN enabled"
# - 任何 "mock" 字样
```

```bash
# 自动化校验（D-026 §2.3 C2 落地）
grep -i 'mockLogin\|WX_MOCK_LOGIN enabled\|"mock"' /var/log/costra/server.log
# 期望：无任何输出（grep 退出码 1）

# 如果 grep 有输出 → 立即停服
# systemctl stop costra-server
# 检查 /etc/costra/server.env 是否漏写 WX_MOCK_LOGIN=0 · systemctl show costra-server | grep WX_MOCK
```

---

## §6 跑 migrations（含 0006 entries_change_seq）

### §6.1 D-026 §2.3 C3 三件套（dump → migrate → verify）

⚠️ **D-026 §2.3 C3 强制流程**：prod DB 任何 schema 改动需 dump + migrate + verify 三件套。

#### 步骤 1：dump（首次 prod migrate 数据为空 · 但建立流程惯例）

```bash
mkdir -p /backup
chmod 0700 /backup

# 用 PG_COSTRA_PW 跑 pg_dump（不是 pg_dumpall · 因为只关心 costra DB 数据）
PGPASSWORD='<§3.4 PG 强密码>' pg_dump \
  -h 127.0.0.1 -U costra -d costra \
  -F c -f /backup/pre-migrate-init-$(date +%Y%m%d-%H%M%S).dump

# 也可用纯 SQL 文本（更易 grep / diff · 但文件大）
PGPASSWORD='<§3.4 PG 强密码>' pg_dump \
  -h 127.0.0.1 -U costra -d costra \
  > /backup/pre-migrate-init-$(date +%Y%m%d-%H%M%S).sql

ls -lh /backup/
# 期望：dump 文件存在（首次为空数据 · 仅 schema 头）· 文件 < 100K
```

#### 步骤 2：migrate

```bash
cd /opt/costra/server

# migrate.sh 用 DB_URL 环境变量（事实源：server/scripts/dev/migrate.sh:13）
# **不是** DATABASE_URL · 这是 dev 脚本与 server 运行期 env 命名不一致的现状
export DB_URL='postgres://costra:<§3.4 PG 强密码>@127.0.0.1:5432/costra'

npm run db:migrate
# 期望终端输出 6 条 migration（按文件名顺序）：
# === 0001_init.sql ===
# === 0002_seed_system_categories.sql ===
# === 0003_*.sql ===
# === 0004_*.sql ===
# === 0005_*.sql ===
# === 0006_add_change_seq.sql ===  （或最新 changeset 命名）
# ✅ All migrations applied.

unset DB_URL  # 清环境变量
```

> 📌 **migrate.sh 幂等性提醒**：脚本按文件名顺序跑 .sql · 不防重复（无 schema_migrations 表跟踪）· 0001 用 `IF NOT EXISTS` 是幂等的 · 但**部分 0003+ ALTER 语句若不带 IF NOT EXISTS 会重复跑出错** · 首次 prod migrate 数据为空 · 没有重复风险。

#### 步骤 3：verify（D-026 §2.3 C3 验证三连）

```bash
PGPASSWORD='<§3.4 PG 强密码>' psql -h 127.0.0.1 -U costra -d costra -c '\dt' | tee /tmp/dt-output.txt
# 期望：≥ 10 张表（users / families / family_members / accounts / categories /
#                 entries / sync_versions / audit_logs / subscribe_tokens / feature_flags · + outbox / schema_migrations 等后续扩展）

PGPASSWORD='<§3.4 PG 强密码>' psql -h 127.0.0.1 -U costra -d costra -c '\d entries' | grep change_seq
# 期望：1 行 · change_seq | bigint | not null

PGPASSWORD='<§3.4 PG 强密码>' psql -h 127.0.0.1 -U costra -d costra -c "SELECT last_value FROM entries_change_seq"
# 期望：last_value = 1（SEQUENCE 已建 · 未消费）

PGPASSWORD='<§3.4 PG 强密码>' psql -h 127.0.0.1 -U costra -d costra -c "SELECT count(*) FROM entries"
# 期望：0（首次 prod · 数据为空）
```

> 💡 **防 PGPASSWORD 反复敲**：可临时 `export PGPASSWORD='...'` 跑完 verify 再 `unset PGPASSWORD`（**不要**进 ~/.bashrc）· 或用 `~/.pgpass` 文件（mode 0600 · 格式 `127.0.0.1:5432:costra:costra:<密码>`）

---

## §7 nginx 反代配置

### §7.1 `/etc/nginx/conf.d/costra.cloud.conf`

> 📌 **v1.1 修订**：tlinux3.3 / RHEL 系 nginx 默认配置目录是 `/etc/nginx/conf.d/`（include 在 nginx.conf · 不是 Debian 的 sites-available/sites-enabled 模式）

```bash
cat > /etc/nginx/conf.d/costra.cloud.conf <<'NGINXEOF'
# HTTP 80 → 重定向 HTTPS（certbot 在 §7.3 后会改写此段）
server {
    listen 80;
    listen [::]:80;
    server_name costra.cloud;

    location /.well-known/acme-challenge/ {
        root /var/www/certbot;
    }

    location / {
        return 301 https://$host$request_uri;
    }
}

# HTTPS 443 反代（§7.3 certbot --nginx 后启用 ssl_certificate）
server {
    listen 443 ssl http2;
    listen [::]:443 ssl http2;
    server_name costra.cloud;

    # ICP 响应头（沪ICP备2026017253号-2 · FU-DEVOPS-NGINX-ICP-HEADER）
    add_header X-ICP-Filing "沪ICP备2026017253号-2" always;

    # certbot --nginx 自动填这两行（§7.3 后）
    # ssl_certificate /etc/letsencrypt/live/costra.cloud/fullchain.pem;
    # ssl_certificate_key /etc/letsencrypt/live/costra.cloud/privkey.pem;

    # /healthz 根路径（K8s/SLB liveness · D-009 + server/src/app.ts:69 既有约定）
    location = /healthz {
        proxy_pass http://127.0.0.1:8080/healthz;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
    }

    # /v1/* 业务路由
    location /v1/ {
        proxy_pass http://127.0.0.1:8080/v1/;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_read_timeout 60s;
        proxy_connect_timeout 5s;
    }

    # 默认页（防爬虫扫探 · 不暴露任何信息）
    location / {
        return 404;
    }
}
NGINXEOF

mkdir -p /var/www/certbot
```

### §7.2 启用配置

```bash
# tlinux3.3 / RHEL 系无需 ln -s · 直接放 /etc/nginx/conf.d/*.conf 自动 include
# 移除 nginx 默认 server 块（避免冲突 · 默认 server_name _ 抢占 80）
# 看 nginx.conf 是否含默认 server 块：
grep -A5 "server {" /etc/nginx/nginx.conf | head -10
# 如果有默认 server_name _ + listen 80 default_server · 注释或删除该段
# 或保留默认但确认 default_server 标志只在我们自己的 conf 里

nginx -t
# 期望：syntax is ok / test is successful

systemctl enable --now nginx
systemctl reload nginx  # 已启动则 reload · 未启动 enable --now 已经起
```

### §7.3 ⚠️ Let's Encrypt 签证书（首次 + 自动续期）

```bash
# Human 拍板段：邮箱由 Human 提供（推荐 Costra 项目专用邮箱 · 用于证书过期通知）
EMAIL='<Human 提供>'

certbot --nginx \
  -d costra.cloud \
  --non-interactive \
  --agree-tos \
  --email "$EMAIL"
# certbot 自动改 §7.1 nginx conf 加 ssl_certificate / ssl_certificate_key 两行
# certbot 自动加 80→443 重定向

nginx -t && systemctl reload nginx
```

**验证证书 + 自动续期 timer**：

```bash
ls -la /etc/letsencrypt/live/costra.cloud/
# 期望：fullchain.pem / privkey.pem 两个软链

# tlinux3.3 / RHEL 系 certbot 自动装 timer
systemctl list-timers | grep certbot
# 期望：certbot-renew.timer · next 时间在未来

# 测试一次干跑续期
certbot renew --dry-run
# 期望：Congratulations, all renewals succeeded
```

---

## §8 闸门验证（5 条 · Phase-2 checklist 前置 · 全 PASS 才进 Phase-3）

```bash
# 1. healthz（不带 /v1 · server/src/app.ts:69 注释明示）
curl -i https://costra.cloud/healthz
# 期望：HTTP/2 200 · {"status":"ok","build_sha":"...","now_utc":"...","icp":{...}}
# 期望 header 含：x-icp-filing: 沪ICP备2026017253号-2

# 2. ICP 公开端点
curl -s https://costra.cloud/v1/legal/icp | jq
# 期望：{"小程序":"沪ICP备2026017253号-1X","后端服务":"沪ICP备2026017253号-2",...}

# 3. 401 unauthenticated（验 JWT 守门）
curl -i 'https://costra.cloud/v1/sync/pull?family_id=00000000-0000-0000-0000-000000000000&since=0'
# 期望：HTTP/2 401 · {"code":"UNAUTHENTICATED",...}

# 4. systemd 状态（4 个 service · 全 active+enabled）
for svc in postgresql-15 redis costra-server nginx; do
  echo "=== $svc ==="
  systemctl is-active $svc
  systemctl is-enabled $svc
done
# 期望：4 个 service 各 2 行 · 都是 active / enabled

# 5. **D-026 §2.3 C2 红线**：日志无 mock
grep -i 'mockLogin\|WX_MOCK_LOGIN enabled\|"mock"' /var/log/costra/server.log
# 期望：无任何输出（grep 退出码 1）
echo "Exit: $?"
# 期望：Exit: 1
```

**5 条全 PASS** → Phase-1 prod-bootstrap 闸门完成 → 进 Phase-3 154+150 真 prod 实测。

**任一 FAIL** → 看 §9 故障排查。

---

## §9 故障排查（FAQ · 8 条）

### Q1 systemctl status 显示 Failed / Activating（restart loop）

```bash
journalctl -u costra-server -n 100 --no-pager
tail -n 100 /var/log/costra/server.err.log
```

常见根因：
- `EnvironmentFile` 路径错或权限错（`stat /etc/costra/server.env` 期望 `0600 root root`）
- `tsx` 未装（`ls /opt/costra/server/node_modules/tsx` 期望存在）
- 端口冲突（`ss -tlnp | grep 8080` 看是否被占）
- PG 或 Redis 没起（`systemctl is-active postgresql-15 redis`）
- `Requires=postgresql-15.service` 依赖链断了 · 看 `systemctl list-dependencies costra-server`

### Q2 healthz 返 502 Bad Gateway

- server 没起：`systemctl status costra-server`
- 端口冲突：`ss -tlnp | grep 8080`
- nginx 反代到错地方：`grep proxy_pass /etc/nginx/conf.d/costra.cloud.conf`（应该是 `127.0.0.1:8080`）
- SELinux 拦截了 nginx → localhost 的 HTTP 反代（tlinux3.3 默认 enforcing）：
  ```bash
  getenforce  # 期望 Enforcing 或 Permissive
  # 如果 Enforcing 且 nginx 反代被拦：
  setsebool -P httpd_can_network_connect 1
  systemctl reload nginx
  ```

### Q3 Let's Encrypt 签证书失败

- DNS A 记录是否指对：`dig +short costra.cloud`（期望 `49.235.216.20`）
- nginx 80 端口是否能访问：`curl http://costra.cloud/.well-known/acme-challenge/test`（期望 404 而非 connection refused · 表示 80 端口和 location /.well-known 配对）
- 防火墙 80 端口是否放：`firewall-cmd --list-ports`（期望含 80/tcp 443/tcp）
  ```bash
  firewall-cmd --add-port=80/tcp --permanent
  firewall-cmd --add-port=443/tcp --permanent
  firewall-cmd --reload
  ```
- certbot 限速：5/周/域名 · 短期重试多次会被锁

### Q4 ⚠️ healthz 日志含 mock 警告（D-026 §2.3 C2 红线触发）

**立即操作**：
```bash
systemctl stop costra-server
# 检查 EnvironmentFile
cat /etc/costra/server.env | grep WX_MOCK_LOGIN
# 应输出：WX_MOCK_LOGIN=0
# 如果输出 WX_MOCK_LOGIN=1 或无输出 → 修正后重启
```

```bash
# 验证 systemd 实际加载的环境变量
systemctl show costra-server | grep WX_MOCK
# 期望：Environment 段含 WX_MOCK_LOGIN=0
```

### Q5 PG 连不上

- `systemctl status postgresql-15` 看是否 Active
- `ss -tlnp | grep 5432` 看是否 LISTEN 127.0.0.1:5432（**不应**是 0.0.0.0:5432 · 暴露公网严重违规）
- 密码错：`tail -50 /var/lib/pgsql/15/data/log/postgresql-*.log` 看错误日志
- pg_hba.conf 拒绝：检查 §3.1 步骤 4 的 4 行配置是否生效
- DATABASE_URL 字符串特殊字符是否需要 URL encode（**§3.4 已用 `tr -d '/+='` 去掉特殊字符 · 不需要 URL encode** · 如果你额外加了 `@` 或 `?` 等需替换）

### Q6 Redis 连不上 · NOAUTH Authentication required

- `redis-cli ping` 不带 `-a` 报 NOAUTH = 配置生效（这是好的 · 说明密码生效了）
- 用 `redis-cli -a '<§3.4 Redis 密码>' ping` 应该返 PONG
- `REDIS_URL` 在 .env 里的格式：`redis://:PASSWORD@127.0.0.1:6379`（冒号前空 user · 这是 ioredis / node-redis 标准格式）
- `systemctl status redis` 看 Redis 是否 Active

### Q7 migration 跑失败

```bash
# 确认 migration 文件存在
ls /opt/costra/server/db/migrations/
# 期望：0001~0006 共 6 个 .sql 文件

# 看错误位置
PGPASSWORD='<密码>' psql -h 127.0.0.1 -U costra -d costra \
  -c "SELECT * FROM information_schema.tables WHERE table_schema='public' ORDER BY table_name"
# 看哪些表已建 · 哪些缺失

# 单独跑某一条
psql "$DB_URL" -f /opt/costra/server/db/migrations/0006_*.sql -v ON_ERROR_STOP=1
```

### Q8 SELinux / firewalld 拦截（tlinux3.3 特有）

tlinux3.3 默认开启 SELinux + firewalld · 历史踩坑路径：

```bash
# SELinux 状态
getenforce
# 如果是 Enforcing 且服务异常 · 临时改 Permissive 测试
# setenforce 0
# 测试完恢复：setenforce 1

# firewalld 状态
systemctl status firewalld
firewall-cmd --list-all

# 放通 80/443（HTTP/HTTPS）
firewall-cmd --add-service=http --permanent
firewall-cmd --add-service=https --permanent
firewall-cmd --reload

# 5432/6379 不应放公网（已 bind 127.0.0.1）· 不需要 firewalld 放
```

---

## §10 后续加固清单（不在本次 bootstrap scope · 进 follow-ups）

| FU-ID | 描述 | 优先级 | 预估卡 |
|---|---|---|---|
| **FU-PROD-NON-ROOT-USER** | systemd User 改 costra 非特权用户（当前 root · §5.1 注释已标 ⚠️）+ /opt/costra owner 改 costra:costra | P1 | 1 pt |
| **FU-PROD-LOG-ROTATE** | /var/log/costra/*.log + PG 日志 + Redis 日志 加 logrotate 配置（防磁盘溢出） | P2 | 1 pt |
| **FU-PROD-PG-BACKUP** | D-009 §2.4 数据备份（pg_dump + Redis BGSAVE 每日 → 腾讯云 COS / 7 日保留 / 异地） | P1 | 2 pt |
| **FU-PROD-MONITORING** | Prometheus node_exporter + postgres_exporter + redis_exporter + 微信小程序后台 JS 异常监控 + AlertManager | P2 | 3 pt |
| **FU-PROD-CI-DEPLOY** | 从手动 git pull 改为 GitHub Actions / 工蜂 CI 自动 deploy（含 systemd reload + 健康检查 + 回滚） | P1 | 3 pt |
| **FU-PROD-CI-MOCK-GUARD** | scripts/devops/whitelist-check.mjs 加规则 E（D-026 §2.3 C2 静态扫描 prod 部署脚本含 WX_MOCK_LOGIN=1 即 CI 红灯） | P0 | 1 pt |
| **FU-PROD-FW-AUDIT** | D-009 §2.4 防火墙 + fail2ban + SSH 改非 22 端口 + 登录失败告警一次性补齐审计 | P0 | 2 pt |
| **FU-PROD-PG-TUNE** | PG 15 prod 配置调优（shared_buffers / effective_cache_size / max_connections / WAL · 默认值不适合 prod） | P2 | 1 pt |
| **FU-PROD-SCHEMA-MIGRATIONS-TABLE** | migrate.sh 加 schema_migrations 跟踪表 + 防重复跑（v1.1 §6 步骤 2 备注议题） | P1 | 1 pt |

> 上述 9 条 FU 累计 15 pt · 不进 Sprint-3（避免推迟 154+150 真 prod 验收）· 候选 Sprint-4 头部专项加固 sprint。

---

## §11 Human 操作时间预估

| 阶段 | 时间 | 备注 |
|---|---|---|
| §1 前置确认 + §1.1 dnf 装基础工具 | 15 min | dnf 装 Node / PG 15 / Redis / nginx / certbot · 大陆从 PGDG 拉慢可换镜像 |
| §2 拉代码 + npm install | 5 min | 取决于网络 · 大陆从 GitHub 拉慢 → 用工蜂 / rsync |
| §3 PG 初始化 + Redis 配置 + §3.4 强密码 | 20 min | initdb + pg_hba + 建 user/DB/扩展 + Redis bind/密码 |
| §4 .env 字段清单准备（不落盘） | 10 min | 含 WX_APP_SECRET 取（微信平台扫码） + JWT_SECRET 生成 |
| §5 systemd unit + EnvironmentFile | 10 min | §5.3 启动日志验证 5 min |
| §6 migrations 三件套 | 10 min | dump（首次空）+ migrate（6 条 SQL）+ verify（4 条 psql） |
| §7 nginx + Let's Encrypt | 15 min | LE 签证书 ~3 min · nginx 配置 + reload ~10 min |
| §8 闸门验证 5 条 | 10 min | |
| **合计** | **95 min** | **± 30 min**（看现有工具 / 网络 / 微信平台流程） |

> 📌 v1.1 比 v1.0 多约 30 min（dnf 装 PG/Redis 比 docker compose pull 多步骤 + initdb + pg_hba 配置 + Redis 配置）

---

## §12 完成后向 Orchestrator 反馈

Phase-1 完成后在对话中回：

```
prod-bootstrap §8 闸门验证：
1. healthz: PASS / FAIL
2. /v1/legal/icp: PASS / FAIL
3. 401 守门: PASS / FAIL
4. systemd active+enabled (4 svc): PASS / FAIL
5. **C2 mock 红线**: PASS / FAIL（grep 输出空）

5/5 PASS → 进 Phase-3
任一 FAIL → 贴 §9 故障排查证据 · 等 Orchestrator 派 fix
```

Orchestrator 收到后：
- 5/5 PASS → 派 qa-planner 改造 154+150 实测手册到 v1.4 prod 版（移除 WX_MOCK_LOGIN 段 + apiBaseUrl 切 prod + 真 wx.login 路径）→ Human 跑 5 条断言 A~E → 进 Phase-4 152+153 prod 回归
- 任一 FAIL → 看故障类型派 devops-ops 装扮档（如 nginx / systemd / PG / Redis 调整）或 backend-dev（如 server 配置缺陷）

---

## §13 v1.0 → v1.1 变更日志

| § | 变更 | 原因 |
|---|---|---|
| 头部 | 标题加 v1.1 + tlinux3.3 + 本地 PG/Redis 标识 · 加 v1.1 修订说明段 | Human 反馈 OS + 部署模式调整 |
| §0 部署架构图 | postgres + redis 行从 docker compose 改本地 systemd | v1.1 调整 |
| §1 前置 | 第 4 项 ufw → firewalld · 加第 2 项 OS 确认 tlinux3.3 | tlinux3.3 适配 |
| §1.1 工具补装 | apt → dnf · 加 PGDG 仓 + EPEL · 装 PG 15 + Redis 7 + contrib | tlinux3.3 包管理切换 |
| §3 整段 | 从 docker compose（4 服务）改 PostgreSQL 15 本地原生 + Redis 7 本地原生 + §3.4 强密码生成统一指引 | 核心变更 · 移除 docker 层 |
| §4.1 | DATABASE_URL 改 127.0.0.1（不是 localhost）· REDIS_URL 加密码（`redis://:PW@host`） | 本地 PG/Redis 配置精确 |
| §5.1 | After/Requires 从 docker.service 改 postgresql-15.service + redis.service | systemd 依赖链对齐 |
| §6.1 步骤 1 | docker compose exec pg_dumpall → 本地 pg_dump | 本地 PG |
| §6.1 步骤 2 | DATABASE_URL → DB_URL（事实源 migrate.sh:13）· export 后 unset | 修正命名错配 |
| §6.1 步骤 3 | 用 PGPASSWORD + psql -h 127.0.0.1 替代 docker compose exec | 本地 PG |
| §7.1 | nginx conf 路径从 sites-available/sites-enabled 改 conf.d/ | RHEL 系标准目录 |
| §7.2 | 启用方式从 ln -s 改直接放 conf.d/ + 移默认 server | RHEL 系无需 ln |
| §8 闸门 4 | systemd 服务从 1 个（costra-server）改 4 个（postgresql-15 / redis / costra-server / nginx） | 本地服务架构 |
| §9 故障排查 | Q5 docker → 本地 PG · Q6 新增 Redis 排查 · Q7 migration · Q8 新增 SELinux/firewalld（tlinux 特有） · 6→8 条 | tlinux3.3 + 本地 PG/Redis 适配 |
| §10 FU | 加 FU-PROD-PG-TUNE + FU-PROD-SCHEMA-MIGRATIONS-TABLE · 7→9 条 13pt→15pt | 本地 PG 调优 + migrate 防重 |
| §11 时间预估 | 65min → 95min | dnf 装 PG/Redis 比 docker pull 多步骤 |

---

> **手册版本**：v1.1 · 2026-05-23 21:10 · Orchestrator 兜底落档（D-026 §6.1 incident 备注）
> **下次修订**：Phase-1 实测后根据 Human 反馈修订 v1.2（如发现命令错 / 期望不准 / 步骤遗漏）
