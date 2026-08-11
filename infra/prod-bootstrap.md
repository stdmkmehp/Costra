# Costra · prod 服务首次 bootstrap 手册（v1.4 · 历史参考 · Plan A 宿主机 systemd / Plan B docker 容器内手动启停）

> 🚨 **2026-05-25 12:04 状态变更 · v1.5 推荐路径已分流**：
>
> - 🟢 **当前推荐**：[`infra/prod-bootstrap-compose.md`](./prod-bootstrap-compose.md)（**v1.5 · Plan C · docker compose 4 容器**）
> - 🟡 **历史参考**：本文件（v1.4 · Plan A 宿主机 systemd / Plan B 单容器内手动启停 · 已知 4 个真踩坑 + Redis 5.0.3 漂移 + PG initdb trust 等问题）· 仍保留作为知识沉淀（Plan A 在某些场景仍可用 · 比如 dedicated 单机 + 无 Docker Engine 的环境）
>
> **决策落档**：2026-05-25 11:57 Human 选 Plan D（4 服务 docker compose · Q1=bridge / Q2=alpine / Q3=重做 / Q4=立即）→ 升级为 v1.5 Plan C
>
> **不要在本文件继续推进 Phase-1** · 走 v1.5 新手册。本文件以下内容作为历史档案保留 · 不再维护。

---


> **本手册为 Costra 项目首次生产服务部署交接单**。Agent 无生产 SSH 访问权 · Agent 出手册 + Human 跑命令 · 每步含验证 + 期望输出 · 高危段标 ⚠️ Human 拍板。
>
> **母决策**：D-009（域名 + 安全基线）/ D-023（prod 入口回归根域）/ **D-026（staging↔prod 合并 · 工程纪律 4 条 · 同对话轮交付）**
> **交付者**：Orchestrator（devops-ops 装扮档工具白名单错配兜底落档 · D-026 §6.1 incident 备注）
> **日期**：2026-05-23 立案 · 2026-05-25 v1.4 修订
> **HEAD**：a2a3959+（dev 分支 · 含 0001~0006 共 6 条 migration · entries_change_seq SEQUENCE 已就绪 · 含 v1.2 PGDG 修复 commit 330a204 + CVE 修复 commit 8ed63ab + v1.3 Plan B commit 0e4bf89 + 8a0598c FU-PROD-PG-AUTH-SCRAM 登记）
> **目标读者**：Human（拥有 49.235.216.20 root SSH 访问权 + 腾讯云控制台 + 微信公众平台后台访问权）
>
> **v1.4 修订**（2026-05-25 11:22 · Phase-1 Human 反馈 §4/§5 模糊 + line 488 占位符不直观）：
> - **§0-bis 阅读约定**（新增于 v1.4 早段 commit 8dfbce5）：占位符语法 `<§N.M XXX>` / `<XXX 输出>` / `<Human XXX>` 三种 · 错误 vs 正确对比示例 · 三密码总表 · 推荐操作流程
> - **§4 整段重写**：原版仅给字段表 · 用户看不懂如何落盘。新版分 §4.0（前置准备 4 机密值 · 含状态 checkbox）+ §4.1（字段清单参考表）+ §4.2（**[Plan A]** 完整 here-doc 命令）+ §4.3（**[Plan B]** 完整 here-doc 命令 · 路径 /data/conf/server.env · 权限 0640）+ §4.4（WX_APP_SECRET 浏览器步骤 · 移到末尾）
> - **§5 整段重写 + 双路径并列**：原版仅 systemd 路径（Plan B 走不通）。新版分 §5-A（systemd · §5-A.1 unit / §5-A.2 启动验证）+ §5-B（pm2 · §5-B.1 装 / §5-B.2 启 / §5-B.3 mock 校验 / §5-B.4 容器自启）
> - **§5-B.2 启动命令修正**：v1.4 早稿误写 `npm run start:prod`（不存在）· 修正为 `node --import tsx/esm src/server.ts`（与 §5-A unit + §2.3 注释一致 · 不预编译）· 给出 3 种 server.env 加载方式（ecosystem.config.cjs / wrapper 脚本 / source）
>
> **v1.3 修订**（2026-05-24 14:20 · Phase-1 实测沉淀 · Costra prod 实际走 docker 容器内部署 · 见 §15）：
> - **§3 加 Plan A / Plan B 双形态**：Plan A（§3.1~§3.4 · 宿主机 systemd · 原版未变）+ **Plan B（§3.5 新增 · docker 容器内手动启停）**
> - **§3.5 Plan B 完整路径**：§3.5.0 容器启动 · §3.5.1 PG init+pg_ctl 启动 · §3.5.2 Redis 配置 · §3.5.3 全栈验证 · §3.5.4 容器重启自启
> - **§3.5.2 Redis 版本漂移登记**：实际装到 Redis 5.0.3（EPEL 仓 EL-8 不出 redis 7）· 代码兼容性✅
> - **§9 FAQ 加 Q10 + Q11**：Q10（docker systemd 反模式）· Q11（挂载卷 640 vs 644 权限）· 9→11 条
> - **CVE 修复同对话轮捎带**（commit 8ed63ab）：fast-jwt 6.2.2→6.2.4（CVSS 9.1 critical）+ fast-uri 3.1.0→3.1.2（CVSS 7.5 high）· 0 vulnerabilities · server vitest 70/70 PASS
>
> **v1.2 修订**（2026-05-23 22:07 · Human Phase-1 §1.1 步骤 2 实测踩坑后增补 · 见 §14 + §9 Q9）：
> - **§1.1 步骤 2 PG 15 安装**：装 PGDG repo 后**立刻 sed 锁死 rhel-8**
> - **§1.1 步骤 3 Redis 装**：装 EPEL 后加**防御性 sed**
> - **§9 FAQ 新增 Q9**：tlinux3.3 dnf 404 `rhel-3.3-x86_64` 完整根因链
>
> **v1.1 修订**（2026-05-23 21:10 · Human 反馈 2 条调整后重写）：
> - **OS 校准**：从 Debian/Ubuntu（apt）改为 **tlinux3.3**（dnf 包管理）
> - **DB/Redis 部署模式**：从 docker compose 改为**本地原生安装 PostgreSQL 15 + Redis 7**
> - **配套修订**：§1.1 工具补装命令换 dnf · §3 全段重写 · §6 migrate 命令调整 · §9 故障排查同步换

---

## §0 一句话总览

首次 prod 服务部署 · 在 49.235.216.20（**tlinux3.3**）上跑 PostgreSQL 15 + Redis 7（**本地原生 systemd**）+ Node.js Fastify server + nginx 反代 + Let's Encrypt + systemd · 预计 Human 操作时间 75~120 分钟 · 产出 prod 入口 `https://costra.cloud/v1` 可达 + Phase-2 闸门 5 条全 PASS。

---

## §0-bis 阅读约定 · 占位符语法（**v1.4 强制前置 · 必读 30 秒**）

> 🚨 本手册命令含**占位符** · 不能直接复制粘贴跑 · 必须先把占位符替换成真实值才能跑。

### 三种占位符语法

| 语法 | 含义 | 替换方式 | 示例 |
|---|---|---|---|
| `<§N.M XXX>` | 引用 §N.M 节定义的某个值 · 自己生成 / 取得 | 翻到 §N.M 节看生成方法 · 把 `<...>` 整段（含尖括号）替换成你生成的真实值 | `<§3.4 PG 强密码>` → 翻到 §3.4 跑 `openssl rand -base64 32 \| tr -d '/+='` 取输出 |
| `<XXX 输出>` | 跑某条命令 · 输出值替换此占位 | 跑命令 · 复制输出 · 替换 `<...>` | `<openssl rand -base64 64 输出>` |
| `<Human XXX>` | Human 手动操作（浏览器 / 控制台 / 邮件等）取得 | 按段落指引操作 · 把取得的值替换 `<...>` | `<Human 从微信公众平台拿 AppSecret>` |

### 真实操作示例

❌ **不要直接跑**（这样跑会撞 `password authentication failed`）：
```bash
PGPASSWORD='<§3.4 PG 强密码>' psql -h 127.0.0.1 -U costra -d costra -c '\dx'
```

✅ **正确**（假设你 §3.4 生成的密码是 `K8mP9xQ2vR5tN6wL3jH7yE0aZbF4gC1d`）：
```bash
PGPASSWORD='K8mP9xQ2vR5tN6wL3jH7yE0aZbF4gC1d' psql -h 127.0.0.1 -U costra -d costra -c '\dx'
```

### 三个独立强密码总表（**先生成 · 再跑后续步骤**）

> ⚠️ §3.4 要求三个**独立**强密码 · **互相不能相同** · 都要记到本机密码管理器。

| 占位符 | 生成方式 | 用在哪里 | 密码管理器记录名 |
|---|---|---|---|
| `<§3.4 PG 强密码>` | `openssl rand -base64 32 \| tr -d '/+='` | §3.1/§3.5.1 建 costra 用户 / §4.1 DATABASE_URL / §6 migration / §8 闸门 | `Costra · prod · PG · costra 用户` |
| `<§3.4 Redis 强密码>` | `openssl rand -base64 32 \| tr -d '/+='` | §3.2/§3.5.2 redis.conf requirepass / §4.1 REDIS_URL | `Costra · prod · Redis · requirepass` |
| `<§3.4 JWT_SECRET>` | `openssl rand -base64 64`（**注意是 64 不是 32**） | §4.1 JWT_SECRET（用于签发 access_token / refresh_token） | `Costra · prod · JWT_SECRET` |

### 推荐操作流程

1. **先**到 §3.4 看一眼 · 跑 3 次 openssl 命令 · 把 3 个密码记到本机密码管理器（30 秒）
2. **后**回来按 §3.5 / §4 / §5 / §6 顺序跑 · 命令里的占位符**都从你密码管理器粘贴真实值替换**
3. 命令历史里**绝对不要保留**含明文密码的命令 · 跑完后 `history -c && history -w` 清掉（或开启 `HISTCONTROL=ignorespace` · 命令前加空格不进 history）

---


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

# 🚨 v1.2 关键修复（tlinux3.3 踩坑 · 见 §9 FAQ Q9）
# tlinux3.3 的 $releasever=3.3 · 而 PGDG repo baseurl 用 rhel-$releasever-$basearch
# → 解析成 rhel-3.3-x86_64 (PGDG 实际只有 rhel-8 / rhel-9 子目录) → 全部 404
# 修复：把 .repo 文件里的 $releasever 全替换成 8（兼容性事实：rpm -E %{rhel} = 8）
sed -i 's/\$releasever/8/g' /etc/yum.repos.d/pgdg-redhat-all.repo

# 验证替换（应该看不到任何 rhel-$releasever 或 rhel-3.3 · 全部是 rhel-8）
grep baseurl /etc/yum.repos.d/pgdg-redhat-all.repo | head -3
# 期望：baseurl=https://download.postgresql.org/pub/repos/yum/common/redhat/rhel-8-x86_64

dnf clean all
dnf makecache

# 禁用 tlinux 自带的 postgresql 模块（避免冲突）
dnf -qy module disable postgresql

# 装 PG 15 server + client + contrib（contrib 含 pgcrypto / citext 扩展 · 0001_init.sql 必需）
dnf install -y postgresql15-server postgresql15 postgresql15-contrib

# 验证（PG 15 二进制不在 $PATH · 在 /usr/pgsql-15/bin/）
/usr/pgsql-15/bin/postgres --version  # 期望 postgres (PostgreSQL) 15.x

# 3. Redis 7（tlinux3.3 默认仓可能只有 redis 5/6 · 装 EPEL 后取最新）
dnf install -y epel-release

# 🛡 v1.2 防御性修复（EPEL 仓也可能踩 $releasever=3.3 同款坑 · 见 §9 FAQ Q9）
if grep -l '\$releasever' /etc/yum.repos.d/epel*.repo >/dev/null 2>&1; then
  sed -i 's/\$releasever/8/g' /etc/yum.repos.d/epel*.repo
  dnf clean all && dnf makecache
fi

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

## §3 本地装 PostgreSQL 15 + Redis 7（**两种部署形态 · 任选其一**）

> 📌 **v1.1 重大修订**：本节从 docker compose 改为**本地原生安装** · tlinux3.3 + systemd 是 prod 单机部署最佳实践（减少容器层 · 监控/备份/升级路径更标准）。
>
> 🚨 **v1.3 重大补充**（2026-05-24 14:20 · Human Phase-1 实测）：实际部署可能不在宿主机直接装 · 而是先起一个 docker 容器再在容器内装。本节给**两种形态平行手册**：
> - **Plan A · 宿主机 systemd 直管**（§3.1~§3.4 · v1.1 原版 · 未变）：宿主机直装 + systemctl 管 · 适合 dedicated 宿主机
> - **Plan B · docker 容器内手动启停**（§3.5 · v1.3 新增 · 基于 Phase-1 实测）：docker 容器（`tail -f /dev/null` 长驻 · `--restart always` 兜底 · `--privileged --network host`）内装 + pg_ctl/redis-server 直起 · 适合宿主机要保持干净 / 多项目隔离场景
>
> **如何选**：
> - 整台机器只跑 Costra 一个项目 · 且 root 可控 → Plan A（手册 §3.1~§3.4 · 跳过 §3.5）
> - 宿主机要保持包管理干净 / 多项目共宿主机 / 已经起好 docker 容器 → Plan B（手册 §3.5 · 跳过 §3.1~§3.4）
> - **本次 Costra prod 49.235.216.20 走 Plan B**（事实记录 · 见 §3.5 头部）

### §3.1 [Plan A] PostgreSQL 15 初始化 + 启动（宿主机 systemd 模式）

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

### §3.2 [Plan A] Redis 7 配置 + 启动（宿主机 systemd 模式）

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

### §3.3 [Plan A] 验证 PG + Redis 全栈

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

### §3.5 [Plan B] docker 容器内手动启停（v1.3 新增 · Costra prod 49.235.216.20 实际路径）

> 🚨 **本节由 Phase-1 实测沉淀**（2026-05-24 14:00~14:20 · Human 在容器内跑通 PG 15.18 + Redis 5.0.3）。Plan A（§3.1~§3.4）若不适用 · 走本节。
>
> **架构**：
> ```
> 宿主机 49.235.216.20（腾讯云 VM · tencentos）
>     └─ docker 容器 costra-prod（tencentos/tencentos3:3.3-v20260326）
>         ├─ --privileged --network host（端口直通宿主机）
>         ├─ --restart always（容器级自启 · 替代 systemd enable）
>         ├─ -v /data/logs:/data/logs（日志卷）
>         ├─ -v /data/conf:/data/conf（配置卷）
>         ├─ -v /root/Costra:/root/Costra（代码卷）
>         └─ /bin/bash -c "tail -f /dev/null"（PID 1 长驻 · 不是 systemd）
> ```
>
> **关键限制**：容器 PID 1 不是 systemd · `systemctl` / `systemd-tmpfiles` 全部不可用 · 必须用进程层工具直起（pg_ctl / redis-server --daemonize / pm2 / nohup）。

#### §3.5.0 容器启动（宿主机跑 · 仅首次部署 · 已起的跳过）

```bash
# 在宿主机 49.235.216.20 上（不是容器内）
docker run -d \
  --name costra-prod \
  --restart always \
  --privileged \
  --network host \
  --hostname costra-prod \
  --memory 4g \
  --memory-swap 4g \
  --cpus 2 \
  --ulimit nofile=65536:65536 \
  --ulimit nproc=65536:65536 \
  --log-driver json-file \
  --log-opt max-size=100m \
  --log-opt max-file=5 \
  -v /data/logs:/data/logs \
  -v /data/conf:/data/conf \
  -v /root/Costra:/root/Costra \
  -v /etc/localtime:/etc/localtime:ro \
  -e TZ=Asia/Shanghai \
  tencentos/tencentos3:3.3-v20260326 \
  /bin/bash -c "tail -f /dev/null"

# 验证容器起来
docker ps | grep costra-prod
# 期望：Up X seconds/minutes ... costra-prod

# 进入容器后续操作（所有后续命令在容器内跑）
docker exec -it costra-prod /bin/bash
```

> ⚠️ **挂载卷权限注意**：`/data/conf/`、`/data/logs/`、`/root/Costra/` 都是宿主机挂载卷 · 文件 owner UID 用宿主机的（容器内 redis 用户 UID=996 · postgres 用户 UID 也不一定与宿主一致）· 配置文件默认 644 才能保证容器内 redis/postgres 用户可读。

#### §3.5.1 [Plan B] PostgreSQL 15 init + 启动（容器内 · pg_ctl 直管）

```bash
# 容器内 root 跑

# §1.1 步骤 2 已装好 PG 15（PGDG repo + sed $releasever 修复 + dnf install postgresql15-server postgresql15 postgresql15-contrib · 见 §1.1）

# 步骤 1：建数据目录 + 改权限（不能用 postgresql-15-setup · 那个依赖 systemd）
mkdir -p /var/lib/pgsql/15/data
chown -R postgres:postgres /var/lib/pgsql/15
chmod 700 /var/lib/pgsql/15/data

# 步骤 2：initdb（不走 systemd setup 脚本 · 直接调 initdb 二进制）
sudo -iu postgres /usr/pgsql-15/bin/initdb \
  -D /var/lib/pgsql/15/data \
  --encoding=UTF8 \
  --locale=C
# 期望：Success. You can now start the database server using: ...

# 步骤 3：启 PG（pg_ctl · 后台 + 日志写到挂载卷）
mkdir -p /data/logs
chown postgres:postgres /data/logs
sudo -iu postgres /usr/pgsql-15/bin/pg_ctl \
  -D /var/lib/pgsql/15/data \
  -l /data/logs/postgres.log \
  start
# 期望：server started

# 步骤 4：验证（端口 + 日志）
ss -tlnp | grep 5432
# 期望：LISTEN ... 127.0.0.1:5432 ...
tail -10 /data/logs/postgres.log
# 期望末尾：database system is ready to accept connections

# 步骤 5：建 costra 用户 + DB（同 §3.1 步骤 3 · 但密码生成走 §3.4）
sudo -iu postgres psql <<'EOF'
CREATE USER costra WITH PASSWORD '<§3.4 生成的 PG_COSTRA_PW · 替换此占位>';
CREATE DATABASE costra OWNER costra ENCODING 'UTF8' TEMPLATE template0;
GRANT ALL PRIVILEGES ON DATABASE costra TO costra;
\c costra
CREATE EXTENSION IF NOT EXISTS "pgcrypto";
CREATE EXTENSION IF NOT EXISTS "citext";
\dx
EOF
# 期望：plpgsql / pgcrypto / citext 三行

# 步骤 6：配 pg_hba.conf SCRAM 认证（同 §3.1 步骤 4 · 路径不变）
PGHBA=/var/lib/pgsql/15/data/pg_hba.conf
cp $PGHBA $PGHBA.bak-$(date +%Y%m%d)
# 改：把 local/host 行的 ident/peer/md5 全改 scram-sha-256（参见 §3.1 步骤 4 推荐 4 行）
vim $PGHBA

# 启用 scram
PGCONF=/var/lib/pgsql/15/data/postgresql.conf
sed -i "s/^#\?password_encryption.*/password_encryption = scram-sha-256/" $PGCONF

# reload（pg_ctl 反映 · 不重启）
sudo -iu postgres /usr/pgsql-15/bin/pg_ctl -D /var/lib/pgsql/15/data reload
# 期望：server signaled

# 验证密码连接
PGPASSWORD='<§3.4 PG 强密码>' psql -h 127.0.0.1 -U costra -d costra -c '\dx'
# 期望：plpgsql / pgcrypto / citext 三行
```

#### §3.5.2 [Plan B] Redis 配置 + 启动（容器内 · redis-server --daemonize 直管）

> ⚠️ **版本漂移登记**（v1.3 实测发现 · 候选 FU-PROD-REDIS-VERSION-ALIGN 进 Sprint-4）：
> - 期望版本：Redis 7（与 staging `redis:7-alpine` 同 major）
> - **实际装到**：Redis 5.0.3（EPEL 仓 EL-8 上的 redis 包就是 5.0.3 · EPEL 不出 redis 7）
> - **代码兼容性**：✅ Costra 只用 `set/get/del/quit` 4 个基础命令（authService.ts）· redis 2.6+ 都支持 · 实际无影响
> - **后续路径**：Sprint-4 时通过 Remi 仓升级到 Redis 7.2 LTS（FU 立件）· 当前 Phase-1 接受 5.0.3 不阻塞
> - **D-026 §2.1 一致性偏差**：明示登记 · 不视为违反 D-026（无功能/安全影响）· 进 Sprint-3 末 Retro 议题 #7

```bash
# 容器内 root 跑

# §1.1 步骤 3 已装好 redis（dnf install epel-release + EPEL 防御性 sed + dnf install redis · 见 §1.1）

# 步骤 1：拷贝默认配置到挂载卷（保证容器重建后配置不丢）
mkdir -p /data/conf
cp /etc/redis.conf /data/conf/redis.conf

# ⚠️ 关键：放开权限到 644（默认 cp 后是 640 · redis 用户读不到 · 见 §9 Q11）
chmod 644 /data/conf/redis.conf

# 步骤 2：先生成 Redis 强密码（必须先生成 · 否则 sed 不知道替换什么）
REDIS_PW=$(openssl rand -base64 32 | tr -d '/+=')
echo "Redis 密码（立刻记到密码管理器 · 然后 unset）：$REDIS_PW"

# 步骤 3：sed 改 5 处关键配置
REDIS_CONF=/data/conf/redis.conf

# (a) bind 仅 localhost
sed -i 's|^bind .*|bind 127.0.0.1|' $REDIS_CONF

# (b) 设密码（兼容两种状态：注释的 / 空的）
sed -i "s|^# *requirepass .*|requirepass $REDIS_PW|" $REDIS_CONF

# (c) 启用 AOF
sed -i 's|^appendonly no|appendonly yes|' $REDIS_CONF

# (d) 日志路径到挂载卷
sed -i 's|^logfile .*|logfile /data/logs/redis.log|' $REDIS_CONF

# (e) 数据目录
sed -i 's|^dir .*|dir /var/lib/redis|' $REDIS_CONF

# 验证关键配置
grep -E "^(bind|requirepass|appendonly|logfile|dir)" $REDIS_CONF
# 期望 5 行 · requirepass 是你生成的串（不是占位符 · 不带 #）

# 步骤 4：建数据/日志目录（用 redis 用户）
mkdir -p /var/lib/redis /data/logs
chown redis:redis /var/lib/redis /data/logs

# 步骤 5：启 redis（redis 用户 + daemonize 后台）
sudo -u redis redis-server $REDIS_CONF --daemonize yes

# 步骤 6：验证（端口 + ping）
ss -tlnp | grep 6379
# 期望：LISTEN ... 127.0.0.1:6379 ...

redis-cli -a "$REDIS_PW" ping
# 期望：PONG

# 步骤 7：unset 密码变量（防 shell history 泄漏）
unset REDIS_PW
```

#### §3.5.3 [Plan B] 验证 PG + Redis 全栈

```bash
# 同 §3.3 · 用 §3.4 生成的真实强密码

PGPASSWORD='<§3.4 PG 强密码>' psql -h 127.0.0.1 -U costra -d costra -c '\dt'
# 期望：Did not find any relations.

redis-cli -a '<§3.4 Redis 强密码>' SET costra:bootstrap:test ok
redis-cli -a '<§3.4 Redis 强密码>' GET costra:bootstrap:test
# 期望：OK / "ok"
redis-cli -a '<§3.4 Redis 强密码>' DEL costra:bootstrap:test
```

#### §3.5.4 [Plan B] 容器重启自启（**Phase-2 之前必须完成 · 否则容器重启服务全没**）

> ⚠️ **关键陷阱**：Plan B 容器是 `tail -f /dev/null` 起的 · 容器重启时 PG / Redis / costra-server / nginx **都不会自动起来**（systemd 不可用 · `--restart always` 只重启容器 · 不管容器内进程）· 必须做 entrypoint 替代方案。

**Phase-2 闸门 4 之前必须做**（候选 FU-PROD-CONTAINER-AUTOSTART P0 · 进 §10 后续加固清单）：

**方案 A · 写 startup 脚本 + commit 镜像 + 重建容器**（推荐 · 但要重建容器 · 暂缓到 Phase-2 闸门通过后做）：

```bash
# 容器内创建启动脚本
cat > /usr/local/bin/costra-startup.sh <<'EOF'
#!/bin/bash
# Costra prod 容器启动脚本（systemd 替代）
sudo -iu postgres /usr/pgsql-15/bin/pg_ctl -D /var/lib/pgsql/15/data -l /data/logs/postgres.log start || true
sleep 2
sudo -u redis redis-server /data/conf/redis.conf --daemonize yes || true
sleep 1
nginx || true
pm2 resurrect || true
tail -f /dev/null
EOF
chmod +x /usr/local/bin/costra-startup.sh

# 退出容器 · 在宿主机 commit 当前状态 + 用新 entrypoint 重启
exit
docker commit costra-prod costra-prod:phase-1-baseline
docker stop costra-prod && docker rm costra-prod
docker run -d --name costra-prod ... [同 §3.5.0 全部参数] \
  costra-prod:phase-1-baseline \
  /usr/local/bin/costra-startup.sh
```

**方案 B · 暂时手动**（Phase-1 + Phase-2 验证期接受 · 容器重启后 SSH 进去手动跑 PG/Redis/server 启动命令 · 不推荐长期）

**当前选择**：Phase-1 / Phase-2 用方案 B（手动）· Phase-2 闸门 5 条全 PASS 后做方案 A 重建（不影响 Phase-2 验证 · 因为验证期容器不会重启）。

---

## §4 server `.env.prod` 配置（**不进仓库**）

### §4.1 必填字段清单（从 systemd EnvironmentFile §5.2 注入 · 不写 .env.prod 文件本身）

> ⚠️ **重要**：本节为字段清单 · 实际值通过 §5.2 systemd EnvironmentFile 注入 · **不要在 server/ 目录创建 .env.prod 文件**（避免误进仓 · 即使 .gitignore 覆盖）

## §4 server 环境变量配置（**不进仓库**）

> 🚨 **v1.4 重大改写**：原 §4 仅给字段表 · 没给"如何把字段写到机器上"的具体命令 · Phase-1 实测发现 Human 看不懂。本节改为：**§4.0 前置（先生成 3 密码 + WX_APP_SECRET）→ §4.1 字段清单 → §4.2 落盘命令（Plan A / Plan B 各一段完整 here-doc）→ §4.3 验证**

### §4.0 ⚠️ 前置 · 准备 4 个机密值（**先做完这步 · 否则 §4.2 没法跑**）

按 §3.4 + §0-bis 三密码总表 · 在密码管理器里准备好以下 4 个值（**先全部准备好 · 再跑 §4.2**）：

| 占位符 | 生成方式 | 长度 | 状态 |
|---|---|---|---|
| `[PG_COSTRA_PW]` | `openssl rand -base64 32 \| tr -d '/+='` | ~32 字符 | ☐ 已生成并存密码管理器 |
| `[REDIS_PW]` | `openssl rand -base64 32 \| tr -d '/+='` | ~32 字符 | ☐ 已生成并存密码管理器 |
| `[JWT_SECRET]` | `openssl rand -base64 64 \| tr -d '/+='` | ~64 字符（**注意 64 不是 32**） | ☐ 已生成并存密码管理器 |
| `[WX_APP_SECRET]` | 见 §4.4 浏览器步骤 | 32 字符 | ☐ 已从微信公众平台取得并存密码管理器 |

> 💡 **生成命令一次性给** · 跑完手抄到密码管理器 · 然后立刻关掉 SSH 终端 / `history -c`：
> ```bash
> echo "PG    : $(openssl rand -base64 32 | tr -d '/+=')"
> echo "REDIS : $(openssl rand -base64 32 | tr -d '/+=')"
> echo "JWT   : $(openssl rand -base64 64 | tr -d '/+=')"
> ```

### §4.1 必填字段清单（参考表 · 不是 .env 文件本身）

| 字段 | 值（替换 `[...]` 为真实值） | 来源 |
|---|---|---|
| `NODE_ENV` | `production` | 强制 |
| `PORT` | `8080` | 默认（nginx 反代到此端口） |
| `DATABASE_URL` | `postgres://costra:[PG_COSTRA_PW]@127.0.0.1:5432/costra` | §3.4 + §3.5.1 |
| `REDIS_URL` | `redis://:[REDIS_PW]@127.0.0.1:6379` | §3.4 + §3.5.2（**注意冒号前留空 · `:[PW]@host`**） |
| `JWT_SECRET` | `[JWT_SECRET]` | §3.4 + §4.0（64 字符版本） |
| `JWT_ISSUER` | `https://costra.cloud` | D-009 |
| `JWT_AUDIENCE` | `costra-miniapp` | 既有 |
| `WX_APP_ID` | `wxf8b0d3e3a83f9941` | infra/wechat/domains.md §0 |
| `WX_APP_SECRET` | `[WX_APP_SECRET]` | §4.4 浏览器取得 |
| **`WX_MOCK_LOGIN`** | **`0`（必须显式写 0 · D-026 §2.3 C2 强制 · 不能省略 / 不能空）** | **R-008 红线** |
| `ICP_FILING_NUMBER` | `沪ICP备2026017253号-2` | infra/wechat/domains.md §0 |

### §4.2 [Plan A] 落盘到 `/etc/costra/server.env`（systemd EnvironmentFile · Plan A 用）

> ⚠️ **Plan A 路径**：宿主机 systemd 模式（§3.1~§3.4）。Plan B 走 §4.3 跳过本节。

```bash
# 1. 建目录 + 权限
mkdir -p /etc/costra /var/log/costra
chmod 0700 /etc/costra
chmod 0755 /var/log/costra

# 2. 写文件（heredoc 模式 · 比 vim 更明确）
# ⚠️ 把 [PG_COSTRA_PW] / [REDIS_PW] / [JWT_SECRET] / [WX_APP_SECRET] 4 个占位符替换成你 §4.0 生成的真实值
# ⚠️ 命令前面加一个空格（不进 history · 防泄漏 · 需要 HISTCONTROL=ignorespace 或 set -o ignoreeof）

 cat > /etc/costra/server.env <<'EOF'
NODE_ENV=production
PORT=8080
DATABASE_URL=postgres://costra:[PG_COSTRA_PW]@127.0.0.1:5432/costra
REDIS_URL=redis://:[REDIS_PW]@127.0.0.1:6379
JWT_SECRET=[JWT_SECRET]
JWT_ISSUER=https://costra.cloud
JWT_AUDIENCE=costra-miniapp
WX_APP_ID=wxf8b0d3e3a83f9941
WX_APP_SECRET=[WX_APP_SECRET]
WX_MOCK_LOGIN=0
ICP_FILING_NUMBER=沪ICP备2026017253号-2
EOF

# 3. 严格权限（仅 root 可读）
chmod 0600 /etc/costra/server.env
ls -la /etc/costra/server.env
# 期望：-rw------- 1 root root ... server.env

# 4. ⚠️ 替换占位符（heredoc 用了 'EOF' 单引号 · 内部 [...] 不会被 shell 替换 · 现在用 vim 把 4 个占位符替换成真实值）
vim /etc/costra/server.env
# 在 vim 内：用 :%s/\[PG_COSTRA_PW\]/真实密码/g 替换（注意特殊字符转义）
# 或者直接 i 进入插入模式手改 4 行

# 5. 验证（不打印值 · 仅看 key 数量 + WX_MOCK_LOGIN=0）
grep -c '^[A-Z_]\+=' /etc/costra/server.env
# 期望：11

grep '^WX_MOCK_LOGIN=' /etc/costra/server.env
# 期望：WX_MOCK_LOGIN=0（D-026 §2.3 C2 强制）

# 6. 防 history 泄漏（如果你 vim 编辑过程中复制了密码到 :registers）
unset HISTFILE 2>/dev/null  # 当前 shell 不再写 history
```

### §4.3 [Plan B] 落盘到 `/data/conf/server.env`（pm2 用 · Plan B docker 容器内）

> ⚠️ **Plan B 路径**：docker 容器内手动启停（§3.5）。Plan A 用户跳过本节走 §4.2。
>
> **Plan B 路径与 A 的差异**：
> - 文件路径：`/etc/costra/server.env` → `/data/conf/server.env`（挂载卷 · 容器重建后保留）
> - 注入方式：systemd EnvironmentFile → pm2 `--env-file` 或 dotenv 读取
> - 权限：0600 → 0640（卷文件不能 chown 到容器内 root · 0640 + group readable 较稳妥）

```bash
# 容器内 root 跑

# 1. 建目录（/data/conf 已挂载 · 只需建子文件）
mkdir -p /data/conf /data/logs
chmod 0755 /data/conf /data/logs

# 2. 写文件（heredoc · 占位符稍后用 vim 替换）
 cat > /data/conf/server.env <<'EOF'
NODE_ENV=production
PORT=8080
DATABASE_URL=postgres://costra:[PG_COSTRA_PW]@127.0.0.1:5432/costra
REDIS_URL=redis://:[REDIS_PW]@127.0.0.1:6379
JWT_SECRET=[JWT_SECRET]
JWT_ISSUER=https://costra.cloud
JWT_AUDIENCE=costra-miniapp
WX_APP_ID=wxf8b0d3e3a83f9941
WX_APP_SECRET=[WX_APP_SECRET]
WX_MOCK_LOGIN=0
ICP_FILING_NUMBER=沪ICP备2026017253号-2
EOF

# 3. 替换占位符（vim 或 sed · 注意特殊字符）
vim /data/conf/server.env
# 把 [PG_COSTRA_PW] / [REDIS_PW] / [JWT_SECRET] / [WX_APP_SECRET] 4 个替换成真实值

# 4. 权限（容器卷限制 · 0640 比 0600 更稳）
chmod 0640 /data/conf/server.env
ls -la /data/conf/server.env

# 5. 验证（同 §4.2 步骤 5）
grep -c '^[A-Z_]\+=' /data/conf/server.env
# 期望：11

grep '^WX_MOCK_LOGIN=' /data/conf/server.env
# 期望：WX_MOCK_LOGIN=0
```

### §4.4 ⚠️ WX_APP_SECRET 取得操作步骤（Human 浏览器跑 · §4.0 之前做）

1. 登录 https://mp.weixin.qq.com（Costra 小程序管理员账号）
2. 左侧菜单 → 开发 → 开发管理 → 开发设置
3. 「AppSecret(小程序密钥)」段 → 点击「重置」（首次取或已忘）
4. 完成管理员扫码 → 显示 AppSecret 字符串（32 字符）
5. **立即复制到本机密码管理器** · 微信平台关闭页面后无法再次显示完整字符串

⚠️ **D-026 §2.3 C2 + R-008 红线**：AppSecret **绝对不能**进任何 git 仓库 · 不能进对话历史 · 不能进邮件 / IM。

---

## §5 server 进程管理 · Plan A 用 systemd / Plan B 用 pm2

> 🚨 **v1.4 重大改写**：原 §5 只写 systemd 路径 · Plan B（docker 容器内 PID 1 不是 systemd）走不通。本节分 §5-A（systemd）+ §5-B（pm2）两套并行。

### §5-A [Plan A] systemd service unit（宿主机 systemd 模式）

#### §5-A.1 写 unit 文件 `/etc/systemd/system/costra-server.service`

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

> 📌 **v1.1 修订**：`After=docker.service` 改为 `After=postgresql-15.service redis.service` · `Requires=...`（PG 或 Redis 挂掉 · costra-server 也跟着停 · 避免连接错误风暴）

#### §5-A.2 启动 service + 验证

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

# 自动化校验（D-026 §2.3 C2 落地）
grep -i 'mockLogin\|WX_MOCK_LOGIN enabled\|"mock"' /var/log/costra/server.log
# 期望：无任何输出（grep 退出码 1）

# 如果 grep 有输出 → 立即停服
# systemctl stop costra-server
# 检查 /etc/costra/server.env 是否漏写 WX_MOCK_LOGIN=0
# systemctl show costra-server | grep WX_MOCK
```

---

### §5-B [Plan B] pm2 进程管理（docker 容器内 · Costra prod 实际路径）

> ⚠️ **Plan B 路径**：docker 容器 PID 1 = `tail -f /dev/null` · 不是 systemd · 必须用进程层工具。pm2 是 Node 生态首选（vs nohup / forever / supervisord）。

#### §5-B.1 装 pm2

```bash
# 容器内 root 跑（npm 全局装）
npm install -g pm2
pm2 --version
# 期望：6.x.x 或更高
```

#### §5-B.2 启 server（用 §4.3 的 `/data/conf/server.env`）

> 📌 **server 启动命令事实**：Costra server 用 `tsx` 直接跑 TS 源码（不预编译 · 见 §2.3）· 启动命令是 `node --import tsx/esm src/server.ts`（与 §5-A systemd unit 一致）。`package.json` 的 `npm start` 跑的是 `node dist/server.js` 需要 `npm run build` 预编译 · prod 我们走 tsx 路径不预编译。

```bash
# 容器内 root 跑
cd /root/Costra/server   # 你 docker run -v /root/Costra:/root/Costra 挂载的路径

# pm2 启动命令（用 --interpreter node + --interpreter-args + 脚本路径）
# 关键：server 用 tsx loader · 必须 --import tsx/esm 才能跑 TS
pm2 start src/server.ts \
  --name costra-server \
  --interpreter node \
  --node-args="--import tsx/esm" \
  --log /data/logs/costra-server.log \
  --error /data/logs/costra-server.err.log \
  --time

# ⚠️ 如果上面命令 pm2 不识别 .ts 入口 · 改用 wrapper 脚本：
#   cat > /root/Costra/server/start-prod.sh <<'EOF'
#   #!/bin/bash
#   set -a && source /data/conf/server.env && set +a
#   exec node --import tsx/esm src/server.ts
#   EOF
#   chmod +x /root/Costra/server/start-prod.sh
#   pm2 start /root/Costra/server/start-prod.sh --name costra-server --log /data/logs/costra-server.log

# ⚠️ pm2 加载 server.env 的方式（任选其一）：
#
# 方式 1 · pm2 ecosystem.config.cjs（推荐 · 长期方案）：
#   cat > /root/Costra/server/ecosystem.config.cjs <<'EOF'
#   const dotenv = require('dotenv');
#   const env = dotenv.parse(require('fs').readFileSync('/data/conf/server.env'));
#   module.exports = {
#     apps: [{
#       name: 'costra-server',
#       script: 'src/server.ts',
#       interpreter: 'node',
#       node_args: '--import tsx/esm',
#       env,
#       out_file: '/data/logs/costra-server.log',
#       error_file: '/data/logs/costra-server.err.log',
#       time: true,
#     }]
#   };
#   EOF
#   pm2 start /root/Costra/server/ecosystem.config.cjs
#
# 方式 2 · 启动前 source（简单 · 但要 wrapper 脚本）：
#   见上面 start-prod.sh 那段
#
# 方式 3 · server.ts 自己读（如果 src/server.ts 头部已有 import 'dotenv/config' · 让它自己加载）：
#   set -a && source /data/conf/server.env && set +a   # 临时方法 · 不持久

# 验证 pm2 进程
pm2 list
# 期望：│ costra-server │ ... │ online │ ...

pm2 logs costra-server --lines 50
# 期望：{"level":30,"time":...,"msg":"Server listening at http://0.0.0.0:8080"}
```

#### §5-B.3 关键验证（D-026 §2.3 C2 mock 防护）

```bash
# 自动化校验（同 §5-A.2）
grep -i 'mockLogin\|WX_MOCK_LOGIN enabled\|"mock"' /data/logs/costra-server.log
# 期望：无任何输出（grep 退出码 1）

# 如果 grep 有输出 → 立即停服
# pm2 stop costra-server
# 检查 /data/conf/server.env 是否漏写 WX_MOCK_LOGIN=0
# pm2 env <id> | grep WX_MOCK   # 看 pm2 实际加载的环境变量
```

#### §5-B.4 容器重启自启（**Phase-2 闸门 4 必须**）

> ⚠️ pm2 startup 在容器内可能不生效（容器 PID 1 不是 systemd / init）· 必须做 startup 脚本 + commit 镜像（详见 §3.5.4）。

**当前 Phase-1 / Phase-2 接受手动重启**：容器重启后 SSH 进去手动 `pm2 resurrect` 或重跑 §5-B.2 命令。

**Phase-2 闸门通过后做**（FU-PROD-CONTAINER-AUTOSTART）：
```bash
# 容器内
pm2 save   # 保存当前进程列表到 ~/.pm2/dump.pm2

# 写 startup 脚本（覆盖 §3.5.4 草案）
cat > /usr/local/bin/costra-startup.sh <<'EOF'
#!/bin/bash
sudo -iu postgres /usr/pgsql-15/bin/pg_ctl -D /var/lib/pgsql/15/data -l /data/logs/postgres.log start || true
sleep 2
sudo -u redis redis-server /data/conf/redis.conf --daemonize yes || true
sleep 1
nginx || true
pm2 resurrect || true
tail -f /dev/null
EOF
chmod +x /usr/local/bin/costra-startup.sh

# 退出容器 · 宿主机 commit + 重建容器
exit
docker commit costra-prod costra-prod:phase-2-baseline
docker stop costra-prod && docker rm costra-prod
docker run -d --name costra-prod ... [§3.5.0 全部参数] \
  costra-prod:phase-2-baseline \
  /usr/local/bin/costra-startup.sh
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

## §9 故障排查（FAQ · 11 条）

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

### Q9 dnf 装 PG 15 / Redis 报 404 · `rhel-3.3-x86_64/repodata/repomd.xml not found`（tlinux3.3 特有 · 🚨 v1.2 真踩坑）

**症状**：
```
Errors during downloading metadata for repository 'pgdg-common':
  - Status code: 404 for https://download.postgresql.org/pub/repos/yum/common/redhat/rhel-3.3-x86_64/repodata/repomd.xml
```

**根因（事实链）**：
1. tlinux3.3 的 `/etc/os-release` 里 `VERSION_ID="3.3"` · dnf 把这个值填到 `$releasever`
2. PGDG / EPEL 仓的 `.repo` 文件里 baseurl 用 `rhel-$releasever-$basearch`
3. `$releasever=3.3` 解析后 → `rhel-3.3-x86_64` · 但 PGDG 实际只有 `rhel-8` / `rhel-9` 子目录 → 全 404
4. 系统其实是 RHEL 8 兼容的（`rpm -E %{rhel}` = `8`）· 只是 `$releasever` 变量映射错了

**修复（已写入 §1.1 步骤 2/3 · 此处仅作 FAQ 留档）**：
```bash
# PGDG 仓
sed -i 's/\$releasever/8/g' /etc/yum.repos.d/pgdg-redhat-all.repo

# EPEL 仓（防御性 · 同款问题）
if grep -l '\$releasever' /etc/yum.repos.d/epel*.repo >/dev/null 2>&1; then
  sed -i 's/\$releasever/8/g' /etc/yum.repos.d/epel*.repo
fi

dnf clean all && dnf makecache
```

**为什么不改 `/etc/os-release`**：动 OS 元数据风险大（影响 dnf 升级、监控、合规审计）· 只改三方仓 `.repo` 文件最小爆破半径。

**复用范围**：未来 prod-2 / staging-2 / 任何 tlinux3.x 机器装 EL-8 系第三方仓都会复发 · 此修复 SOP 是 tlinux3.3 部署的**强制前置**。

---

### Q10 docker 容器内 `systemctl` 报 `Failed to connect to bus: Host is down`（v1.3 真踩坑 · §3.5 路径强制前置）

**症状**：
```
[root@costra-prod ~]# /usr/pgsql-15/bin/postgresql-15-setup initdb
System has not been booted with systemd as init system (PID 1). Can't operate.
Failed to connect to bus: Host is down
```

或：
```
[root@costra-prod ~]# systemctl enable --now postgresql-15
Failed to get D-Bus connection: Operation not permitted
```

**根因（事实链）**：
1. docker 容器启动命令是 `tail -f /dev/null` · PID 1 = `bash -c "tail -f /dev/null"`
2. 不是 systemd · 所以容器内根本没 systemd bus 可连
3. 任何依赖 systemctl / systemd-tmpfiles / journalctl 的命令都会失败
4. `postgresql-15-setup` 是个 wrapper · 内部用 systemd 找 PGDATA 配置 · 撞同款问题

**修复（强制走 §3.5 Plan B）**：
- ❌ **不要尝试**：在容器内装 systemd / 改 PID 1 / `--privileged + /sys/fs/cgroup` 等容器圈反模式
- ✅ **正确做法**：用进程层工具直起服务 · `pg_ctl` / `redis-server --daemonize` / `pm2` / `nohup`
- ✅ **容器自启**：靠 `docker run --restart always` + 写 startup 脚本 commit 进镜像 + 容器 entrypoint 改 startup（见 §3.5.4）

**复用范围**：所有 docker 容器内部署的项目（不仅 Costra · 整个公司部署的容器化项目都该走 §3.5 Plan B 范式）· 议入 D-027 候选。

---

### Q11 docker 挂载卷文件 redis 用户读不到 · `Permission denied`（v1.3 真踩坑）

**症状**：
```
[root@costra-prod conf]# sudo -u redis cat /data/conf/redis.conf | head -3
cat: /data/conf/redis.conf: Permission denied
[root@costra-prod conf]# ls -la /data/conf/redis.conf
-rw-r----- 1 root root 62202 May 24 14:02 /data/conf/redis.conf
```

**根因**：
1. `cp /etc/redis.conf /data/conf/redis.conf` 默认权限 640（`-rw-r-----`）
2. owner = root · group = root · redis 用户既不是 owner 也不在 root 组 · 没读权限
3. `/data/conf/` 是宿主机挂载卷（`-v /data/conf:/data/conf`）· 卷权限受宿主机 umask 决定 · 默认 640 而非 644
4. **不要 chown 到容器内 redis 用户** · 因为容器内 redis UID（996）跟宿主机 UID 不一致 · chown 会污染宿主机文件 owner

**修复**：
```bash
chmod 644 /data/conf/redis.conf
sudo -u redis cat /data/conf/redis.conf | head -3   # 验证可读
```

**预防（已写入 §3.5.2 步骤 1）**：cp 后立刻 `chmod 644`。

**复用范围**：所有 docker 挂载卷下的配置文件 · 都要确认 644（配置）或 755（脚本）· **不要**用 chown 到容器内用户。

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
| **🔴 FU-PROD-PG-AUTH-SCRAM** | **pg_hba.conf 6 行全 trust → scram-sha-256 + costra 用户密码 ALTER 重 hash + reload**（initdb 默认 trust 反模式 · 2026-05-25 11:15 Phase-1 实测发现 · Human 决策暂缓不阻塞 Phase-2 但**Phase-3 真 prod 验收前必须修**）· 一行 sed 修复：`sed -i 's/\btrust\b/scram-sha-256/g' /var/lib/pgsql/15/data/pg_hba.conf` · 关联 R-008 红线 + D-026 §2.3 C2 安全语义 | **P0** | 1 pt |

> 上述 10 条 FU 累计 17 pt · 不进 Sprint-3（避免推迟 154+150 真 prod 验收）· 候选 Sprint-4 头部专项加固 sprint。
>
> ⚠️ **FU-PROD-PG-AUTH-SCRAM 特别提示**：当前 prod PG `pg_hba.conf` 是 6 行全 trust（initdb 默认）· 容器内任何进程拿到 PG 连接都不验证密码 · D-026 §2.3 C2 安全语义边界 · **必须在 Phase-3 真 prod 验收前修**（不阻塞 Phase-2 内部闸门验证 · 但任何"对外宣称 prod 已上线"的节点之前必须修）· 议入 D-027 候选范围（"prod 部署默认不安全行为必须显式覆盖"通用规约）。

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

## §14 v1.1 → v1.2 变更日志

> **触发**：2026-05-23 21:42 Human 实测 Phase-1 §1.1 步骤 2 装 PG 15 撞 `pgdg-common` 仓 404 · `rhel-3.3-x86_64/repodata/repomd.xml not found` · 根因：tlinux3.3 `$releasever=3.3` 与 PGDG/EPEL 仓 `rhel-$releasever` baseurl 拼接不兼容（PGDG 实际只有 rhel-8 / rhel-9 子目录）· Human 应用 sed 'g/$releasever/8/g' 修复后装通 PG 15.18

| § | 变更 | 原因 |
|---|---|---|
| §1.1 步骤 2 | 装 PGDG repo 后**立刻 sed 锁死 rhel-8** + grep 验证 + dnf clean/makecache · postgres --version 改 `/usr/pgsql-15/bin/postgres --version`（PG 15 二进制不在 $PATH） | tlinux3.3 + PGDG 真踩坑修复 |
| §1.1 步骤 3 | 装 EPEL 后加**防御性 sed**（grep 检测 `$releasever` · 有则 sed 修） | EPEL 同款风险预防 |
| §9 FAQ Q9（新增） | 新增 Q9 dnf 404 · `rhel-3.3` 完整根因链 + 修复 SOP + 不改 os-release 的理由 + 复用范围 | 留档供未来 prod-2 / staging-2 / 任何 tlinux3.x EL-8 三方仓部署复用 |
| §9 标题 | 8 条 → 9 条 | Q9 新增 |

**v1.2 修订带来的额外操作**：~ 2 min（一次 sed + 一次 makecache）· 不影响 §11 总时间预估

---

## §15 v1.2 → v1.3 变更日志

> **触发**：2026-05-24 14:00~14:20 · Phase-1 实测沉淀（4 个真踩坑 + 2 个架构事实登记）
>
> **真踩坑事故链**（按时间）：
> 1. 14:00 · `postgresql-15-setup initdb` 报 `System has not been booted with systemd` → 暴露架构事实：实际部署在 docker 容器内 · 不在宿主机 systemd
> 2. 14:13 · `sudo -u redis cat /data/conf/redis.conf` Permission denied → 卷权限 640 vs redis 用户读不到（cp 默认权限漂移）
> 3. 14:14 · Orchestrator 在改写 docker 路径命令时**漏掉 §3.4 强密码生成步骤** · Human 误用字面占位符 `YOUR_REDIS_STRONG_PASSWORD` 启动 redis（议入 Sprint-3 末 Retro 议题 #6 候选）
> 4. 14:00 · `redis-server --version` 是 5.0.3 不是 7.x（EPEL 仓 EL-8 不出 redis 7 · 议入候选 FU-PROD-REDIS-VERSION-ALIGN）

| § | 变更 | 原因 |
|---|---|---|
| 头部 | 副标题加 "Plan A 宿主机 systemd / Plan B docker 容器内" · 加 v1.3 修订说明段（含 CVE 修复 commit 8ed63ab 链接） | 双形态平行手册 |
| §3 标题 + 引言 | 改为 "本地装 PostgreSQL 15 + Redis 7（**两种部署形态 · 任选其一**）" · 加 v1.3 重大补充段 + Plan A/B 选择指南（哪种场景用哪个） | 双形态主纲 |
| §3.1~§3.3 标题 | 加 "[Plan A]" 前缀（标识为宿主机 systemd 模式） | 与 Plan B 区分 |
| **§3.5 Plan B（新增 · 核心）** | docker 容器内手动启停完整路径 · §3.5.0 容器启动（docker run 完整命令存档）· §3.5.1 PG init+pg_ctl 启动 · §3.5.2 Redis 配置（含密码 sed 顺序修复 + 卷权限 chmod 644）· §3.5.3 全栈验证 · §3.5.4 容器重启自启（systemd 替代方案 · FU-PROD-CONTAINER-AUTOSTART P0 候选） | Phase-1 实测沉淀 |
| §3.5.2 Redis 版本漂移登记 | 实际装到 Redis 5.0.3（EPEL 仓 EL-8 不出 redis 7）· 代码兼容性✅（authService 仅用 set/get/del/quit）· Sprint-4 Remi 仓升级 7.2 LTS（FU-PROD-REDIS-VERSION-ALIGN）· D-026 §2.1 一致性偏差明示登记不视为违反 | 透明登记 |
| §9 FAQ Q10（新增） | docker 容器 systemctl `Failed to connect to bus` · 根因（PID 1 = bash 不是 systemd）· 修复（强制走 §3.5 Plan B · 不要尝试容器内装 systemd 反模式）· 复用范围（所有公司容器化项目） | 议入 D-027 候选 |
| §9 FAQ Q11（新增） | docker 挂载卷 640 vs 644 权限 · cp 默认权限污染 · 不要 chown 到容器内用户（UID 不一致）· 修复（chmod 644）· 预防（cp 后立即 chmod） | 卷权限治理范式 |
| §9 标题 | 9 条 → 11 条 | Q10 + Q11 新增 |
| 同对话轮 CVE 修复 | server/package-lock.json: fast-jwt 6.2.2→6.2.4（CVSS 9.1 critical · JWT auth bypass · R-008 红线）+ fast-uri 3.1.0→3.1.2（CVSS 7.5 high · path traversal）· npm audit 0 vulnerabilities · server vitest 70/70 PASS · commit 8ed63ab | prod 部署前置闸 · D-026 §2.3 C2 关联 |

**v1.3 修订带来的额外操作**：
- Plan B 路径用户：~ 30 min 额外（docker run + 6 步 PG initdb/启动/建用户 + 7 步 Redis 配置）
- Plan A 路径用户：0 min（§3.1~§3.4 未变）

**新增议题 / FU**（议入 Sprint-3 末 Retro · 候选）：
- **议题 #6**：Orchestrator 对话内改写命令时漏掉密码生成步骤 · 候选 SOP 规约："Orchestrator 改写涉及密码的命令时 · 必须保留 §3.4 强密码生成段引用 · 不删 · 不简化"
- **议题 #7**：Redis 7 vs 5 版本漂移 · 候选 FU-PROD-REDIS-VERSION-ALIGN P2 进 Sprint-4
- **议题 #8**：npm audit 应该是 prod 部署前置闸门 · 候选 FU-CI-NPM-AUDIT-GUARD P0 + prod-bootstrap §1 加 npm audit 前置闸
- **议题 #9**：docker 容器内部署模式应抽象成独立决策（D-027 候选） · 涵盖："不是所有 prod 都跑宿主机 systemd · 多项目共宿主机时 docker 容器隔离是合法范式"

---

## §16 v1.3 → v1.4 变更日志

> **触发**：2026-05-25 11:15~11:22 · Phase-1 实测反馈：① §4/§5 模糊不可执行 ② line 488 `<§3.4 PG 强密码>` 占位符语法不直观（Human 不知道要替换）③ pg_hba 默认 trust 登记
>
> **真踩坑/认知盲区**（按时间）：
> 1. 11:15 · `psql -h 127.0.0.1 -U costra -d costra -c '\dx'` 不要密码也连得上 → 暴露 PG initdb 默认 trust 反模式 → 立 FU-PROD-PG-AUTH-SCRAM P0（Phase-3 真 prod 验收前修）
> 2. 11:18 · Human 决策当前阶段不修 trust（P0 但暂缓）· 议入 D-027 候选范围
> 3. 11:20 · Human 反馈 §4/§5 太模糊 + 占位符 `<§3.4 PG 强密码>` 看不懂

| § | 变更 | 原因 |
|---|---|---|
| 头部 | 副标题改 "v1.4 · §0-bis 占位符语法 + §4 §5 双路径整段重写" · 加 v1.4 修订说明段 | 可读性 |
| **§0-bis（新增）** | 占位符语法约定（30 秒必读）· 三种语法 `<§N.M XXX>` / `<XXX 输出>` / `<Human XXX>` · 错误 vs 正确对比 · 三密码总表 · 推荐操作流程 · HISTCONTROL 防泄漏 | 解决 line 488 类问题 |
| **§4 整段重写** | §4.0 前置准备 4 机密值（含 checkbox 状态）+ §4.1 字段清单参考表（占位符改 `[XXX]` 易识别）+ **§4.2 [Plan A] 完整 here-doc** + **§4.3 [Plan B] 完整 here-doc** + §4.4 WX_APP_SECRET 浏览器步骤（移末尾 · 因为 §4.0 前置已引用） | 给"如何把字段表落盘到机器"的具体命令 |
| **§5 整段重写 + 双路径** | 原版仅 systemd（Plan B 走不通）· 新版分 §5-A（systemd · A.1 unit / A.2 启动验证）+ §5-B（pm2 · B.1 装 / B.2 启 / B.3 mock 校验 / B.4 容器自启） | Plan B 用户必须 |
| §5-B.2 启动命令修正 | 早稿误写 `npm run start:prod`（package.json 不存在）· 修正为 `node --import tsx/esm src/server.ts`（与 §5-A unit + §2.3 注释一致 · 不预编译）· 给 3 种 server.env 加载方式 | 真 bug 修复 |
| §10 加 FU-PROD-PG-AUTH-SCRAM | initdb 默认 trust 反模式登记（Phase-3 验收前必须修 · 一行 sed 修复）· FU 9→10 / 15pt→17pt | 安全债务透明登记 |

**v1.4 修订带来的额外操作**：
- Plan B 路径用户：~5 min 额外（§4.0 准备 4 机密值 · 之前 §4 没说要做）
- Plan A 路径用户：~2 min 额外（§4.0 同款 + here-doc 替代 vim · 比原版更清晰）
- 占位符替换：用 `[PG_COSTRA_PW]` `[REDIS_PW]` `[JWT_SECRET]` `[WX_APP_SECRET]` 4 个明显占位 · vim `:%s/\[XXX\]/真实值/g` 一次替换

**新增议题 / FU**（议入 Sprint-3 末 Retro · 候选）：
- **议题 #10（新增）**：手册占位符语法应作为 SOP 强约束 · 无论 prod-bootstrap / qa/curl-verify / 其他执行类手册都该加 §0-bis 阅读约定段
- **议题 #11（新增）**：手册"分路径"模式作为通用范式 · 当一份手册支持多种部署形态时（systemd vs pm2 / dedicated vs 容器内 / k8s vs 单机）· 必须 §X-A / §X-B 并列展开 · 不写"如果 X 走 Y 否则走 Z"含糊话
- **议题 #12（新增）**：手册命令应"复制即跑"不应"看完再编辑" · 占位符必须明显（不用 `<...>` 含糊语法 · 改用 `[XXX]` 带 vim 替换提示）

---

> **手册版本**：v1.4 · 2026-05-25 11:22 · Orchestrator 同对话轮交付（基于 Human Phase-1 §4/§5 模糊反馈 + 占位符不直观反馈 · 3 个改进点同对话轮整段重写）
> **下次修订**：Phase-1 §6 migration / §7 nginx + certbot / §8 闸门 5 条 实测后修订 v1.5（如再撞新坑）
