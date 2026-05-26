# Costra · prod 服务首次 bootstrap 手册（v1.6 · Plan C · docker compose 多容器）

> **本手册取代 v1.4 `infra/prod-bootstrap.md` · 作为 Costra prod 部署当前推荐路径**。
>
> **母决策**：D-009（域名 + 安全基线）/ D-023（prod 入口回归根域）/ **D-026（staging↔prod 合并 · 工程纪律 4 条）**
> **决策落档**：2026-05-25 11:57 Human 选 Plan D（4 服务 docker compose）→ 升级为 v1.5 Plan C
> **首次实测落地**：2026-05-25 19:50 · **2026-05-26 10:30 全流程脚本化**（v1.5.1 · 实测踩 7 坑）· **2026-05-26 15:20 v1.6**（§6 首次签证改 webroot + 临时 nginx · 根除 standalone→webroot 手改 renewal.conf 风险源）
> **日期**：2026-05-25 立案 · 2026-05-25 实测修订
> **HEAD**：a2a3959+（dev 分支 · 含 0001~0006 共 6 条 migration）
> **目标读者**：Human（拥有 49.235.216.20 root SSH 访问权 + 腾讯云控制台 + 微信公众平台后台访问权）
> **预计 Human 操作时间**：60~90 分钟（首次 docker compose pull 镜像 + nginx 签证书较慢）
>
> **架构**：宿主机 docker compose 起 4 容器（postgres / redis / server / nginx）· 数据 bind mount 宿主机 `/data/{pgsql,redis,logs,conf,certbot}` · 容器删了数据不丢 · 单服务重启不影响其他。
>
> **Plan C 解决的 Plan A/B 痛点**：① systemctl 报错（容器 PID 1 不是 systemd） ② Redis 5.0.3 漂移 ③ PG initdb 默认 trust ④ PGDG `$releasever` 仓踩坑 ⑤ npm 占位符替换繁琐 ⑥ pm2 复杂启动命令 ⑦ 容器自启脚本难写 —— **官方镜像默认行为已经全包覆**。
>
> **历史参考**：`infra/prod-bootstrap.md`（v1.4 · Plan A 宿主机 systemd / Plan B docker 内手动启停 · 作为知识沉淀保留 · 不再是推荐路径）。

---

## §0 一句话总览

在 49.235.216.20（**tlinux3.3 + Docker Engine**）上跑 docker compose stack（**4 容器**：postgres:15-alpine / redis:7-alpine / costra-server:latest / nginx:1.27-alpine）· 数据持久化到宿主机 `/data/{pgsql,redis,logs,conf,certbot}` · 产出 prod 入口 `https://costra.cloud/v1` 可达 + Phase-2 闸门 5 条全 PASS。

```
宿主机 49.235.216.20 (tlinux3.3 · 仅 Docker Engine)
└─ docker compose stack (cd /root/release/Costra/infra)
    ├─ costra-postgres   (postgres:15-alpine · port 127.0.0.1:5432)
    ├─ costra-redis      (redis:7-alpine     · port 127.0.0.1:6379)
    ├─ costra-server     (自构建 · expose 8080 · 容器内部网络)
    └─ costra-nginx      (nginx:1.27-alpine  · port 80/443 公网)

数据持久化 → 宿主机 /data/  (⚠️ owner 必须 §3.3 预先 chown · 否则 redis 启动 fatal · 见 §8 Q8)
├─ pgsql/        (PG 数据 · 999:999 · PG 镜像会自己 chown · 可不动)
├─ redis/        (Redis AOF/RDB · 必须 chown 999:999)
├─ conf/         (server.env · 0700 · root)
├─ logs/         (各服务日志)
│  ├─ postgres/  (必须 chown 999:999)
│  ├─ redis/     (必须 chown 999:999 · ⚠️ 漏 chown 这里 redis 启动会 fatal)
│  ├─ server/    (必须 chown 1000:1000 · server node 用户)
│  └─ nginx/     (root · 不用 chown)
├─ certbot/www/  (ACME challenge)
└─ backups/      (FU-PROD-PG-BACKUP)
```

---

## §0-bis 阅读约定 · 占位符语法（30 秒必读）

本手册命令含**占位符** `[XXX]` · 必须先替换成真实值才能跑。

| 占位符 | 含义 | 替换方式 |
|---|---|---|
| `[PG_COSTRA_PW]` | PG costra 用户密码 | §3.1 跑 `openssl rand -base64 32 \| tr -d '/+='` 生成 + 记密码管理器 |
| `[REDIS_PW]` | Redis requirepass | 同上（独立密码 · 不复用 PG） |
| `[JWT_SECRET]` | JWT 签发密钥 | `openssl rand -base64 64 \| tr -d '/+='`（**注意 64 不是 32**） |
| `[WX_APP_SECRET]` | 微信小程序密钥 | §3.2 浏览器从微信公众平台取得 |

✅ **正确**（替换 `[PG_COSTRA_PW]` 为你生成的真实密码）：
```bash
PGPASSWORD='K8mP9xQ2vR5tN6wL3jH7yE0aZbF4gC1d' psql -h 127.0.0.1 -U costra -d costra
```

❌ **错误**（直接复制粘贴 · 真的会用字面字符串当密码）：
```bash
PGPASSWORD='[PG_COSTRA_PW]' psql -h 127.0.0.1 -U costra -d costra
```

> 💡 **防 history 泄漏**：命令前留一个空格（`HISTCONTROL=ignorespace` 默认开启）· 含明文密码的命令不会进 `~/.bash_history`。

---

## §0-ter 快速路径（脚本化部署 · v1.5.1 新增）

> 嫌手动操作慢？整个 §1~§7 已经脚本化在 [`infra/scripts/`](./scripts/) · 5-10 min 完成（不含 build server 镜像 · 见 §4.1）。
>
> **手册 vs 脚本**：手册是权威文档（含决策背景 + 7 坑 FAQ）· 脚本是快速路径。两者步骤一一对应 · 失败时脚本会指向手册对应章节。

### 一键全新部署（首台机器）

```bash
ssh root@<prod-ip>
cd /root/release/Costra/infra/scripts
chmod +x *.sh lib/*.sh

./deploy-all.sh \
    --email you@example.com \
    --build-mode local \
    --wx-app-secret '<32 字符微信 AppSecret>' \
    -y
```

### 备机迁移（复用现有 server.env + 证书 + 镜像）

```bash
# 旧机器导出（一次性）：
tar czf /tmp/letsencrypt.tar.gz -C /etc letsencrypt/
docker save costra-server:latest | gzip > /tmp/costra-server.tar.gz
scp /tmp/{letsencrypt.tar.gz,costra-server.tar.gz} root@<新机器>:/tmp/
scp /data/conf/server.env root@<新机器>:/data/conf/

# 新机器一键：
cd /root/release/Costra/infra/scripts
./deploy-all.sh \
    --reuse-secrets \
    --import-cert /tmp/letsencrypt.tar.gz \
    --build-mode load \
    --image-tar /tmp/costra-server.tar.gz \
    --skip 06 \
    -y
```

### 单步执行（调试 / 部分重做）

每个脚本独立可跑：

```bash
./01-preflight.sh                  # §1 前置检查
./02-prepare-dirs.sh               # §3.3 建目录 + chown
./03-generate-env.sh --reuse-secrets   # §3.1+§3.4 复用现有密码
./07-issue-cert.sh --use-existing  # §6.1+§6.2 仅校验现有证书
./09-verify-gates.sh               # §7 闸门 5 条
```

详细文档见 [`infra/scripts/README.md`](./scripts/README.md)。

---

## §1 前置确认（先核对 · 5 min）

```bash
# 在宿主机 49.235.216.20 上跑（不是容器内）

# 1. OS 与 Docker
cat /etc/os-release | head -3
docker --version          # 期望 20.10+ 或更高
docker compose version    # 期望 v2.x（compose v2 · 不是 docker-compose v1）

# 2. 当前清理（如果之前按 v1.3/v1.4 起过 costra-prod 容器）
docker ps -a | grep costra-prod
# 如果有 · 跑下面 stop + rm（数据空 · 无损失 · §1.4 决策已确认）
# docker stop costra-prod
# docker rm costra-prod

# 3. 防火墙基线（D-009 §2.4 · 仅放 22/80/443）
firewall-cmd --list-all 2>/dev/null || iptables -L -n | head -20

# 4. DNS 已生效
dig +short costra.cloud
# 期望：49.235.216.20

# 5. 端口空闲检查（5432/6379/8080/80/443）
ss -tlnp | grep -E ':(5432|6379|8080|80|443)\b' || echo "端口全空闲 · OK"
```

⚠️ 任一项不通 · 先补齐再进 §2。

---

## §2 拉代码到宿主机

```bash
# Plan C 不需要在容器内拉代码 · 代码挂载到 server 容器 build context
cd /root/release
ls -la
# 期望：costra/ 目录已存在（你之前 docker run -v /root/release/Costra:... 已挂）

cd /root/release/Costra
git status -s    # 期望：工作树干净
git log --oneline -3
# 期望：HEAD 是 a2a3959 或更新（含 v1.5 commit）

# 拉最新（含 v1.5 docker compose 文件 + Dockerfile + nginx.conf）
git fetch origin
git checkout dev
git pull origin dev

# 验证 v1.5 文件已就位
ls -la server/Dockerfile server/.dockerignore
ls -la infra/docker-compose.prod.yml
ls -la infra/nginx/conf.d/costra.cloud.conf
ls -la infra/postgres/initdb.d/01-extensions.sql
```

⚠️ **CVE 修复确认**（commit 8ed63ab · fast-jwt 6.2.4 + fast-uri 3.1.2）：

```bash
cd /root/release/Costra/server
grep -E '"fast-jwt"|"fast-uri"' package-lock.json | head -5
# 期望：fast-jwt": "6.2.4 (或更高) · fast-uri": "3.1.2 (或更高)
# 如果还是 6.2.2 / 3.1.0 → 跑 npm install 拉新 lockfile
```

---

## §3 准备秘密值 + 环境变量文件

### §3.1 生成 3 个独立强密码（**必做 · 跑完手抄到密码管理器**）

```bash
# 命令前留一个空格（不进 history · HISTCONTROL=ignorespace 默认开）
 echo "PG_COSTRA_PW : $(openssl rand -base64 32 | tr -d '/+=')"
 echo "REDIS_PW     : $(openssl rand -base64 32 | tr -d '/+=')"
 echo "JWT_SECRET   : $(openssl rand -base64 64 | tr -d '/+=')"

# 立刻：
# 1. 复制 3 个值到密码管理器（推荐 1Password / Bitwarden / Apple 钥匙串）
# 2. 关闭终端历史回显（防误操作）：
 history -c
```

### §3.2 取 WX_APP_SECRET（Human 浏览器跑 · 5 min）

1. 登录 https://mp.weixin.qq.com（Costra 小程序管理员账号）
2. 左侧菜单 → 开发 → 开发管理 → 开发设置
3. 「AppSecret(小程序密钥)」段 → 点击「重置」
4. 完成管理员扫码 → 复制 32 字符 AppSecret 字符串到密码管理器

⚠️ **D-026 §2.3 C2 + R-008 红线**：AppSecret **绝对不能**进 git / IM / 邮件 / 对话历史。

### §3.3 建持久化目录 + 关键 chown（**漏一步 redis 起不来 · v1.5.1 实测踩坑**）

> 🚨 **必读**：本节是 v1.5.1 第 3 坑（实测 Phase-1 撞过）。如果跳过 chown 直接 `up -d` · **redis 容器会反复重启 fatal exit** · 错误日志：`*** FATAL CONFIG FILE ERROR (Redis 7.4.9) *** Can't open the log file: Permission denied`。
>
> **根因**：宿主机 root 创建的目录 owner 是 root · 但 redis 容器内进程是 `redis` 用户（uid=999）· 没权限写日志/AOF · 立即 fatal · `restart: unless-stopped` 反复重启。
>
> **为什么 PG 不踩？**：PG 镜像 entrypoint 主动 chown 数据目录；redis 镜像不会，挂载目录权限必须人工准备。

#### Step 1 · 建目录

```bash
mkdir -p /data/conf /data/pgsql /data/redis /data/logs/{postgres,redis,server,nginx} /data/certbot/www /data/backups
chmod 0700 /data/conf /data/backups
```

#### Step 2 · chown（**关键 · 不可跳过**）

容器内进程 uid 与宿主机不一致，必须预先 chown：

| 路径 | 期望 owner | 容器内进程 | 可否跳过 |
|---|---|---|---|
| `/data/redis` | 999:999 | redis 用户（uid=999） | ❌ **必做** · 跳过 redis 启动 fatal |
| `/data/logs/redis` | 999:999 | redis 写日志 | ❌ **必做** · 跳过 redis 启动 fatal（v1.5.1 真踩坑点） |
| `/data/logs/postgres` | 999:999 | postgres 用户（uid=999） | ⚠️ 建议做 · PG 自己不会 chown 日志目录 |
| `/data/logs/server` | 1000:1000 | node 用户（uid=1000 · Dockerfile §43） | ⚠️ 建议做 · server 写 audit log |
| `/data/pgsql` | (任意) | PG entrypoint 自动 chown | ✅ 可不动 |
| `/data/logs/nginx` | (任意) | nginx 容器跑 root | ✅ 可不动 |

```bash
# 一键 chown（精确对应上表 · 不要省略）
chown -R 999:999  /data/redis /data/logs/redis /data/logs/postgres
chown -R 1000:1000 /data/logs/server
```

#### Step 3 · 验证 owner

```bash
ls -ld /data/redis /data/logs/{redis,postgres,server}
# 期望 owner 全部对齐（前两个是 redis 必坑点）：
#   drwxr-xr-x ... 999  999  /data/redis
#   drwxr-xr-x ... 999  999  /data/logs/redis
#   drwxr-xr-x ... 999  999  /data/logs/postgres
#   drwxr-xr-x ... 1000 1000 /data/logs/server
```

如果你看到任何一行 owner 是 `root root` → 回到 Step 2 重 chown，否则后面 §4.3 起 redis 必 fatal。

### §3.4 写 `/data/conf/server.env`（**关键**）

```bash
# 写 server.env（heredoc · 占位符稍后用 vim 替换）
 cat > /data/conf/server.env <<'EOF'
# Costra prod 环境变量（v1.5 · 由 docker compose env_file 注入）
# 注意：DATABASE_URL / REDIS_URL 的 host 字段在 docker-compose.prod.yml 中被覆盖为 service name
#       这里的 PG_COSTRA_PW / REDIS_PW 同时被 compose 的 ${VAR} 引用 (postgres / redis 容器启动时用)

# === 进程基础 ===
NODE_ENV=production
PORT=8080
TZ=Asia/Shanghai

# === 容器间 DB 连接（compose 会用 ${PG_COSTRA_PW} ${REDIS_PW} 替换 host 字段）===
PG_COSTRA_PW=[PG_COSTRA_PW]
REDIS_PW=[REDIS_PW]

# === DATABASE_URL / REDIS_URL（compose env block 会 override host · 这里写完整版供 server 兜底）===
DATABASE_URL=postgres://costra:[PG_COSTRA_PW]@postgres:5432/costra
REDIS_URL=redis://:[REDIS_PW]@redis:6379

# === JWT ===
JWT_SECRET=[JWT_SECRET]
JWT_ISSUER=https://costra.cloud
JWT_AUDIENCE=costra-miniapp

# === 微信 ===
WX_APP_ID=wxf8b0d3e3a83f9941
WX_APP_SECRET=[WX_APP_SECRET]

# === D-026 §2.3 C2 mock 防护红线 ===
WX_MOCK_LOGIN=0

# === ICP ===
ICP_FILING_NUMBER=沪ICP备2026017253号-2
EOF

# 替换 4 个占位符（vim 模式 · 一个个改）
vim /data/conf/server.env
# 在 vim 内：
#   :%s/\[PG_COSTRA_PW\]/真实PG密码/g
#   :%s/\[REDIS_PW\]/真实Redis密码/g
#   :%s/\[JWT_SECRET\]/真实JWT密钥/g
#   :%s/\[WX_APP_SECRET\]/真实微信密钥/g
#   :wq

# 严格权限
chmod 0600 /data/conf/server.env
ls -la /data/conf/server.env
# 期望：-rw------- 1 root root ... server.env

# 验证字段数 + WX_MOCK_LOGIN
grep -c '^[A-Z_]\+=' /data/conf/server.env
# 期望：13

grep '^WX_MOCK_LOGIN=' /data/conf/server.env
# 期望：WX_MOCK_LOGIN=0（D-026 §2.3 C2 强制）

# 验证占位符全部已替换（应该没有任何 [XXX] 残留）
grep '\[' /data/conf/server.env || echo "✅ 所有占位符已替换"
```

---

## §4 构建 server 镜像 + 起 docker compose stack

### §4.1 build server 镜像

> ⚠️ **小机器警告（v1.5.1 实测踩坑 · 见 §8 Q9）**：腾讯云 prod 机器是 **2 核 2G**，本地直接 `docker compose build server` 实测 4000+ 秒未完成（卡在 `npm ci` + native 模块编译，2G 内存触发 swap 雪崩）。
>
> **推荐路径（任选其一）**：
> - **方式 A · 同架构高性能机器构建 + scp 镜像** → §4.1-A（适合 prod 机器同样是 x86_64 amd64 · 比如内网另一台 tlinux 3.3）
> - **方式 B · Docker Hub 推送** → §4.1-B（标准做法 · 后续接 CI/CD 也用同一套）
> - **方式 C · 直接在 prod build**（仅当机器 ≥4 核 4G 时考虑）→ §4.1-C
>
> ⚠️ **CPU 架构必须匹配**：prod 是 x86_64 (amd64)。如果在 **Apple Silicon Mac (M1/M2/M3/M4)** 上构建，必须显式 `--platform linux/amd64`，否则 push 上去无法运行。

#### §4.1-A 跨机器构建 + scp 传镜像（最快上手）

```bash
# === build 机器（同架构高性能机器 · 比如另一台 tlinux 3.3 · 4核8G+）===
cd /root/release/Costra/infra
docker compose -f docker-compose.prod.yml build server

# 验证镜像
docker images | grep costra-server
# 期望：costra-server   latest   ...   ~250MB

# 导出为 tar.gz（gzip 压缩省 50%+ 体积）
docker save costra-server:latest | gzip > /tmp/costra-server.tar.gz
ls -lh /tmp/costra-server.tar.gz

# scp 到 prod 机器
scp /tmp/costra-server.tar.gz root@49.235.216.20:/root/release/

# === prod 机器 ===
cd /root/release
gunzip -c costra-server.tar.gz | docker load
# 期望：Loaded image: costra-server:latest

docker images | grep costra-server   # 验证
rm /root/release/costra-server.tar.gz # 清理
```

#### §4.1-B 推到 Docker Hub（标准做法 · 后续 CI/CD 用）

```bash
# === build 机器 · 一次性配置 ===
docker login
# Username: <your-dockerhub-username>
# Password: <Docker Hub Access Token · 推荐用 token 不用密码>
# Token 生成：https://hub.docker.com → Account Settings → Security → New Access Token (Read & Write)

# 打 tag（双 tag · latest 给开发用 · 版本 tag 方便回滚）
DOCKERHUB_USER="<your-dockerhub-username>"
VERSION="v1.5.1-$(date +%Y%m%d)"
docker tag costra-server:latest ${DOCKERHUB_USER}/costra-server:latest
docker tag costra-server:latest ${DOCKERHUB_USER}/costra-server:${VERSION}

# 推送（首次 200~400MB · 国内可能慢 · 后续增量 push 快）
docker push ${DOCKERHUB_USER}/costra-server:latest
docker push ${DOCKERHUB_USER}/costra-server:${VERSION}

# ⚠️ 第一次 push 后立刻去网页改成 Private（默认 Public）：
#   https://hub.docker.com/repositories → 找到 costra-server → Settings → Visibility → Private

# === prod 机器 · 一次性 docker login（拉私有仓库必须）===
docker login   # 推荐单独建 Read-only token 给 prod 用 · 更安全

# 修改 docker-compose.prod.yml · 把 server 的 image 改成线上路径：
#   image: costra-server:latest
# 改为：
#   image: <your-dockerhub-username>/costra-server:latest

cd /root/release/Costra/infra
docker compose -f docker-compose.prod.yml pull server
```

> 💡 **国内拉取慢的备选**：换腾讯云 TCR（容器镜像服务）个人版 · 免费 · 国内极快 · 同样支持 private · 用法类似 Docker Hub · 登录地址变成 `ccr.ccs.tencentyun.com`。

#### §4.1-C 直接在 prod build（机器规格 ≥4 核 4G 才考虑）

```bash
cd /root/release/Costra/infra
# build server image（首次 ~5-10 min · 后续增量 ~30s · ⚠️ 2核2G 机器实测 4000s+ 不会完成）
docker compose -f docker-compose.prod.yml build server

# 验证镜像
docker images | grep costra-server
# 期望：costra-server   latest   ...   ~250MB
```

### §4.2 拉 PG / Redis / nginx 官方镜像

```bash
# 提前 pull · 避免 up 时拉镜像超时
docker compose -f docker-compose.prod.yml pull postgres redis nginx
# 期望：3 个镜像全部 Pulled successfully
```

### §4.3 启动 stack（**先不起 nginx · 见 v1.5.1 实测踩坑**）

> ⚠️ **v1.5.1 实测踩坑（§8 Q13）**：如果一把 `up -d` 把 nginx 也起来 · 而 §6 的 TLS 证书还没签 + nginx conf 第 41-49 行 `ssl_certificate` 还在注释状态 → **nginx 启动报 `no "ssl_certificate" is defined for the "listen ... ssl" directive` · 反复 restart（实测 17 次）**。
>
> **正确顺序**：先起 postgres/redis/server 三个 → 跑 §5 migrations → §6 签证书 + 改 conf → 最后才 up nginx。

```bash
cd /root/release/Costra/infra

# ⚠️ 显式只起 3 服务 · 不起 nginx（避免无证书 restart 循环）
docker compose -f docker-compose.prod.yml --env-file /data/conf/server.env up -d \
  postgres redis server

# 看启动日志（首次 PG initdb · 自动跑 01-extensions.sql 装 pgcrypto + citext · ~30s）
docker compose -f docker-compose.prod.yml logs -f postgres | head -40
# 期望末尾：database system is ready to accept connections

# Ctrl+C 停止 logs（容器还在跑）

# 验证 3 容器都 healthy（nginx 此时不在列表中是预期的）
docker compose -f docker-compose.prod.yml ps
# 期望：
#   costra-postgres   ... Up X seconds (healthy)   127.0.0.1:5432->5432/tcp
#   costra-redis      ... Up X seconds (healthy)   127.0.0.1:6379->6379/tcp
#   costra-server     ... Up X seconds (healthy)   8080/tcp
```

### §4.4 验证 stack 全栈

```bash
# 1. 3 容器全部 healthy（nginx 在 §6 签完证书后才启动 · 此时不在列表）
docker compose -f docker-compose.prod.yml ps
# 期望：3 行全部 Up X seconds (healthy)
#   costra-postgres   ... Up X seconds (healthy)   127.0.0.1:5432->5432/tcp
#   costra-redis      ... Up X seconds (healthy)   127.0.0.1:6379->6379/tcp
#   costra-server     ... Up X seconds (healthy)   8080/tcp

# ⚠️ 如果 redis 状态是 Restarting · 99% 是 §3.3 chown 漏做（v1.5.1 实测踩坑）
#   立刻确认：
#   docker logs costra-redis --tail 5
#   如果看到 "*** FATAL CONFIG FILE ERROR *** Can't open the log file: Permission denied"
#   → 跳到 §8 Q8 救火步骤（chown 999:999 /data/redis /data/logs/redis · 重启）

# 2. PG 连接（宿主机用 psql client 测 · 容器内 5432 已映射 127.0.0.1）
# 安装 psql client（如果没装 · 一次性命令）：
# dnf install -y postgresql15

# 用密码连
 PGPASSWORD='[PG_COSTRA_PW]' psql -h 127.0.0.1 -U costra -d costra -c '\dx'
# 期望：plpgsql / pgcrypto / citext 三行（initdb.d/01-extensions.sql 已自动装）

# 3. Redis 连接（用 docker exec 进容器测 · 不污染宿主）
docker exec costra-redis redis-cli -a '[REDIS_PW]' ping
# 期望：PONG
```

---

## §5 跑 migrations（含 0001~0006 全部）

> 📌 **D-026 §2.3 C3 三件套**（dump → migrate → verify）· 首次 prod 数据为空 · 仍走流程惯例。

### §5.1 dump（首次为空 · 建立流程）

```bash
mkdir -p /data/backups
chmod 0700 /data/backups

# 用 docker exec 进 postgres 容器跑 pg_dump（避开宿主机装 psql client）
docker exec costra-postgres pg_dump -U costra -d costra \
  > /data/backups/pre-migrate-init-$(date +%Y%m%d-%H%M%S).sql

ls -lh /data/backups/
# 期望：新生成 .sql 文件 · 因为还没跑 migration · 文件极小（~1KB · 仅含 schema 头）
```

### §5.2 migrate（容器内跑）

```bash
# 把 server 容器内代码拷一份 · 跑 migrate.sh
# server 容器已挂载 /root/release/Costra/server 到 /app · 但默认 build 时 COPY · 不是挂载
# 用 docker compose run 临时跑（一次性容器 · 跑完自动删）

cd /root/release/Costra/infra

# 方式 1（推荐）: 用 server image 跑 migrate · 用 compose 网络连 postgres
docker compose -f docker-compose.prod.yml --env-file /data/conf/server.env run --rm \
  -e DB_URL='postgres://costra:[PG_COSTRA_PW]@postgres:5432/costra' \
  server bash scripts/dev/migrate.sh

# 注意 ⚠️：server/.dockerignore 排除了 scripts/dev/ · migrate 时需要单独挂载或临时改
# 备选方式：在 postgres 容器内用 psql + 挂载 migrations 目录跑

# 方式 2（备选 · 更可靠）: postgres 容器 + 挂载 migrations
docker run --rm \
  --network costra_default \
  -v /root/release/Costra/server/db/migrations:/migrations:ro \
  -e PGPASSWORD='[PG_COSTRA_PW]' \
  postgres:15-alpine \
  bash -c 'for f in /migrations/*.sql; do echo "=== $(basename $f) ==="; psql -h postgres -U costra -d costra -f "$f"; done'

# 期望：6 个 migration 全部 successfully · 无 ERROR
```

### §5.3 verify

```bash
# 验证表已建好（期望 ~10+ 张表 · users / family / entries / outbox / etc）
 PGPASSWORD='[PG_COSTRA_PW]' psql -h 127.0.0.1 -U costra -d costra -c '\dt'
# 或用 docker exec
docker exec costra-postgres psql -U costra -d costra -c '\dt'
# 期望：用户/家庭/账目/同步等表清单（具体表数量见 db/migrations/0001~0006）

# 验证 entries_change_seq 序列已建（0006 migration 关键）
docker exec costra-postgres psql -U costra -d costra -c "SELECT last_value FROM entries_change_seq;"
# 期望：last_value = 1（初始）
```

---

## §6 nginx + TLS 证书

> ⚠️ **v1.6 注意**：本节执行前 compose 版 nginx 容器**应该不存在**（§4.3 已改成只起 3 服务）。§6.1 会用一个**独立的临时 nginx 容器**（脱离 compose）跑 80 端口完成 webroot 签证 · 签完即停 · 然后 §6.3 才启动正式 compose nginx。

### §6.0 ACME challenge 模式说明（webroot 全程 · v1.6 简化）

> Let's Encrypt 签 / 续证书前要验证你拥有这个域名 · 通过 **HTTP-01 challenge** 让你在 `http://costra.cloud/.well-known/acme-challenge/<随机串>` 返回它指定的内容。

**Costra 部署策略（v1.6 决策 · 简化 v1.5.1）**：
- **首次签证 + 续期** → 统一用 **webroot**（renewal.conf 天然正确 · 无需任何手动修改）
- **首次签证时 nginx 还没起** → 用一个极简临时 nginx 容器（`infra/nginx/certbot-only.conf`）仅跑 80 端口 + ACME location · 签完即停
- **续期 cron（§6.4）** → 用 webroot · compose nginx 一直跑 · 业务零中断

**优势 vs v1.5.1（standalone → 手改 renewal.conf → webroot）**：
- ❌ ~~不再需要 sed 改 renewal.conf（根除 authenticator/webroot_path 格式踩坑风险源）~~
- certbot 生成的 renewal.conf **天然** `authenticator = webroot` + `webroot_path = /data/certbot/www` · 零人工干预
- 临时 nginx 与 compose 完全隔离 · 不碰依赖链 · 签完 `docker stop` 干净释放端口

**链路示意**（首次签证 + 续期 · 统一 webroot）：
```
certbot → 写挑战文件到 /data/certbot/www/.well-known/acme-challenge/<随机串>
                                ↑ 宿主机
                                ↓ 通过 docker volume mount → /var/www/certbot
nginx（临时 or compose）收到 LE 访问 → location /.well-known/acme-challenge/ { root /var/www/certbot; }
                       → 读到文件 → 返回 → LE 验证通过 → 签发证书
                       → (续期时) certbot 跑 deploy-hook → docker compose exec -T nginx nginx -s reload
```

相关配置文件：
- `infra/nginx/certbot-only.conf` — 极简签证专用 nginx 配置（仅 80 + ACME）
- `infra/nginx/conf.d/costra.cloud.conf` — 正式业务配置（80 重定向 + 443 SSL 反代）
- `docker-compose.prod.yml` nginx service — `/data/certbot/www:/var/www/certbot:ro` 卷挂载

### §6.1 首次签 cert（webroot 模式 · 临时 nginx 容器）

```bash
cd /root/release/Costra/infra

# 0. 防御性确认 80 端口空闲（compose nginx 没在跑）
docker ps -a --filter name=costra-nginx --format '{{.Names}} {{.Status}}'
# 期望：空输出 · 或显示 Created/Exited 状态
# 如果在 Restarting：docker compose -f docker-compose.prod.yml rm -sf nginx

# 1. 装 certbot（宿主机 · 一次性）
which certbot || dnf install -y certbot
certbot --version

# 2. 确保 webroot 目录存在
mkdir -p /data/certbot/www

# 3. 启动临时签证 nginx（极简 80-only · 仅为 ACME challenge 服务）
docker run -d --rm \
  --name costra-certbot-nginx \
  -p 80:80 \
  -v $(pwd)/nginx/certbot-only.conf:/etc/nginx/conf.d/default.conf:ro \
  -v /data/certbot/www:/var/www/certbot \
  nginx:1.27-alpine

# 验证临时 nginx 在跑
sleep 2
docker ps --filter name=costra-certbot-nginx
# 期望：1 行 · STATUS = Up

# 4. certbot webroot 签证
# ⚠️ 替换 <Human 邮箱> 为真实邮箱（用于证书到期提醒）
certbot certonly --webroot \
  -w /data/certbot/www \
  -d costra.cloud \
  --email <Human 邮箱> \
  --agree-tos --no-eff-email --non-interactive

# 期望：Successfully received certificate.
# 文件：/etc/letsencrypt/live/costra.cloud/fullchain.pem + privkey.pem
# renewal.conf 天然: authenticator = webroot · webroot_path = /data/certbot/www ✅

# 5. 验证证书
ls -la /etc/letsencrypt/live/costra.cloud/
# 期望看到 fullchain.pem / privkey.pem / cert.pem / chain.pem

# 6. 验证 renewal.conf 天然 webroot（无需手改 · 仅确认）
grep -E "^authenticator|^webroot" /etc/letsencrypt/renewal/costra.cloud.conf
# 期望：
#   authenticator = webroot
#   webroot_path = /data/certbot/www

# 7. 停掉临时签证 nginx（释放 80 端口给后续 compose nginx）
docker stop costra-certbot-nginx
# 期望：容器停掉（--rm 已设 · 自动删除）

# 验证 80 端口已释放
ss -tlnp | grep :80 || echo "80 端口已释放 ✓"
```

### §6.2 取消 nginx conf 里的 SSL 注释（用 sed 一把梭）

> nginx conf 第 49-57 行 9 个 SSL 指令原本注释 · 签完证书后必须取消注释 · 否则启动报 `no "ssl_certificate" is defined for the "listen ... ssl" directive` 反复 restart。

```bash
cd /root/release/Costra/infra

# 用 sed 一把梭取消注释（精确匹配 9 行 SSL 配置）
sed -i \
  -e 's|^    # ssl_certificate /etc/letsencrypt|    ssl_certificate /etc/letsencrypt|' \
  -e 's|^    # ssl_certificate_key /etc/letsencrypt|    ssl_certificate_key /etc/letsencrypt|' \
  -e 's|^    # ssl_protocols TLSv|    ssl_protocols TLSv|' \
  -e 's|^    # ssl_ciphers |    ssl_ciphers |' \
  -e 's|^    # ssl_prefer_server_ciphers |    ssl_prefer_server_ciphers |' \
  -e 's|^    # ssl_session_cache |    ssl_session_cache |' \
  -e 's|^    # ssl_session_timeout |    ssl_session_timeout |' \
  -e 's|^    # ssl_stapling on|    ssl_stapling on|' \
  -e 's|^    # ssl_stapling_verify |    ssl_stapling_verify |' \
  nginx/conf.d/costra.cloud.conf

# 验证（应看到 9 行不带 # 的 ssl_xxx 配置）
grep -n "^    ssl_" nginx/conf.d/costra.cloud.conf
# 期望 9 行匹配

# 备选验证：原 9 行注释应该已经没有了
grep -n "^    # ssl_" nginx/conf.d/costra.cloud.conf
# 期望：无输出
```

### §6.3 nginx -t 测语法 + 启动 nginx

```bash
# 1. 容器内测 nginx conf 语法（不真正启动 · 防 ssl_certificate 路径错）
#    注意：需要连 compose 网络才能解析 upstream "server" DNS
docker run --rm \
  --network costra_default \
  -v /root/release/Costra/infra/nginx/conf.d:/etc/nginx/conf.d:ro \
  -v /etc/letsencrypt:/etc/letsencrypt:ro \
  nginx:1.27-alpine nginx -t
# 期望：nginx: configuration file /etc/nginx/nginx.conf test is successful
# 如果网络不存在：docker network create costra_default（08 脚本会自动处理）

# 2. 启动 nginx 容器（4 个容器全栈正式 up · 80 端口此时空闲 ✓）
docker compose -f docker-compose.prod.yml --env-file /data/conf/server.env up -d nginx

# 3. 等 5 秒看状态
sleep 5
docker compose -f docker-compose.prod.yml ps
docker logs costra-nginx --tail 20
# 期望：start worker process · 无 SSL_CTX_use_certificate error
# 4 容器全部 Up X (healthy)
```

### §6.4 自动续期（cron · 用 webroot · nginx 不停 · 加 -T 修 TTY 坑）

> ⚠️ **注意**：cron 跑 `docker compose exec` 必须加 `-T`（cron 没 TTY · 不加报 `the input device is not a TTY`）。

```bash
cat > /etc/cron.d/costra-certbot <<'EOF'
SHELL=/bin/bash
PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin

# 每天凌晨 03:17 检查续期（错峰 · LE 官方推荐避开整点）
# certbot 自己判断是否到期（默认到期前 30 天才真续）· 没到期会静默跳过
# --deploy-hook 只在真续到新证书后才 reload nginx · 避免每天空 reload
# -T 关闭 TTY 分配（cron 没 TTY · 不加报错）
17 3 * * * root certbot renew --quiet --deploy-hook "docker compose -f /root/release/Costra/infra/docker-compose.prod.yml exec -T nginx nginx -s reload" >> /var/log/certbot-renew.log 2>&1
EOF

# 让 crond 重载
systemctl restart crond

# 验证 cron 已生效
cat /etc/cron.d/costra-certbot
systemctl status crond --no-pager | head -5

# 验证续期能跑通（dry-run · 不真签 · 走完整流程）
certbot renew --dry-run
# 期望末尾：Congratulations, all simulated renewals succeeded.
# ✅ v1.6 天然 webroot · 不会报 "Could not bind to IPv4" 错误

# 验证 deploy-hook 命令本身能跑（手动模拟）
docker compose -f /root/release/Costra/infra/docker-compose.prod.yml exec -T nginx nginx -s reload
# 期望：无输出（success）
docker logs costra-nginx --tail 5
# 期望：... signal process started 或 reloading configuration
```

---

## §7 闸门验证（Phase-2 · 5 条全 PASS 才进 Phase-3）

```bash
# 闸门 1 · /healthz 200
curl -fsS https://costra.cloud/healthz | jq .
# 期望：{"status":"ok","ts":"...","wxMockLogin":false,...}

# 闸门 2 · ICP 响应头
curl -sI https://costra.cloud/healthz | grep -i x-icp
# 期望：x-icp-filing: 沪ICP备2026017253号-2

# 闸门 3 · 401 守门（无 token 访问 /v1/users/me 应 401）
curl -fsS -o /dev/null -w "%{http_code}\n" https://costra.cloud/v1/users/me
# 期望：401

# 闸门 4 · 4 容器 healthy
docker compose -f /root/release/Costra/infra/docker-compose.prod.yml ps --format json | jq -r '.[] | "\(.Name) \(.Health)"'
# 期望：4 行 "... healthy"

# 闸门 5 · D-026 §2.3 C2 mock 红线 grep
docker compose -f /root/release/Costra/infra/docker-compose.prod.yml logs server | grep -i 'mockLogin.*true\|WX_MOCK_LOGIN enabled\|"mock"' | head -5
# 期望：无任何输出（grep exit 1）

# 反向验证（应该 wxMockLogin=false）
docker compose -f /root/release/Costra/infra/docker-compose.prod.yml logs server | grep -i 'wxMockLogin.*false' | head -3
# 期望：至少 1 行
```

**5 条全 PASS** → 反馈 PASS 表给 Orchestrator → Phase-3 由 Orchestrator 派 qa-planner 出 154+150 真 prod 测试手册。

---

## §8 故障排查（FAQ）

### Q1 docker compose up 报错 "permission denied" 访问 /data/pgsql

**根因**：bind mount 卷 owner 不匹配 postgres 容器内 uid（默认 999）。
**修复**：`chown -R 999:999 /data/pgsql` 或首次启动让 PG 容器自己 chown（默认会做）。

### Q2 server 容器 unhealthy · logs 看 "Connection refused" to postgres

**根因**：postgres 还没 ready · server 启动太快。
**修复**：等 30s · 或 `docker compose restart server`（healthcheck depends_on 应该已经处理）。

### Q3 nginx 容器报 "host not found in upstream 'server'"

**根因**：server 容器没起 · 或 compose 网络没建。
**修复**：`docker compose ps` 看 server 状态 · 重启 nginx。

### Q4 server.env 里 PG_COSTRA_PW 含特殊字符 · DATABASE_URL 拼接报错

**根因**：openssl rand -base64 32 不带 `tr -d '/+='` · `/+=` 会破坏 URL。
**修复**：重生成密码 · 加 `tr -d '/+='`。

### Q5 stack 重启后数据没了

**根因**：忘记 bind mount · 或用了 named volume 然后 docker volume rm。
**修复**：检查 docker-compose.prod.yml volumes · 必须是 `/data/pgsql:/var/lib/postgresql/data` 不是 `pgdata:/var/lib/...`。

### Q6 docker compose down -v 删了 named volume · 但 bind mount 数据还在

**事实**：`-v` 只删 named volume · bind mount 不动。这是设计预期 · 不是 bug。

### Q7 `openssl rand -base64 64 | tr -d '/+='` 输出有两行（v1.5.1 实测）

**根因**：base64 编码每 64 字符自动插入 `\n` · `tr -d '/+='` 没删换行符。
**修复**：把 `\n` 也删掉：
```bash
openssl rand -base64 64 | tr -d '/+=\n'
```
（推荐写法：`openssl rand -base64 64 | tr -d '/+=\n'; echo` · 末尾 echo 仅供终端显示换行 · 不进入复制内容）

### Q8 redis 容器 unhealthy · logs 报 `Can't open the log file: Permission denied`（v1.5.1 实测）

**根因**：宿主机 `/data/logs/redis` owner 是 root · 但 redis 容器内进程是 `redis` 用户（uid=999）· 写不进日志 → 进程 fatal exit · `restart: unless-stopped` 反复重启。
**修复**：§3.3 已加 `chown -R 999:999 /data/redis /data/logs/redis /data/logs/postgres` 和 `chown -R 1000:1000 /data/logs/server`。如果已踩坑：
```bash
docker compose -f docker-compose.prod.yml down
chown -R 999:999  /data/redis /data/logs/redis /data/logs/postgres
chown -R 1000:1000 /data/logs/server
docker compose -f docker-compose.prod.yml --env-file /data/conf/server.env up -d
```
**对照**：postgres 容器没踩坑是因为 PG 镜像 entrypoint 主动 chown 数据目录；redis 镜像 entrypoint 不会，所以挂载目录权限必须人工准备好。

### Q9 server 容器启动报 `Cannot find module './app.js'`（v1.5.1 实测）

**根因**：`server/tsconfig.json` 是 `module: "CommonJS"`，但 `src/server.ts` 用 ESM 风格 `.js` 后缀 import（如 `import { buildApp } from './app.js'`）；Dockerfile CMD 用 `node --import tsx/esm src/server.ts`，ESM loader 在 CJS tsconfig 下不能解析这种混合写法。
**为什么 dev 没事**：`npm run dev` 用 `tsx watch src/server.ts`（直接 tsx CLI），CLI 模式能正确处理这种混合 import。
**修复**：`server/Dockerfile` 最后一行 CMD 改成 tsx CLI（v1.5.1 已修）：
```dockerfile
# 原（错误）：CMD ["node", "--import", "tsx/esm", "src/server.ts"]
# 改为：
CMD ["node_modules/.bin/tsx", "src/server.ts"]
```

### Q10 server / nginx healthcheck 报 `Connection refused` · 但手动 curl 能通（v1.5.1 实测）

**根因**：alpine 容器 `/etc/hosts` 里 `localhost` 同时映射 IPv4 `127.0.0.1` 和 IPv6 `::1`。BusyBox wget 解析 `localhost` 时**优先走 IPv6**，但 Fastify / nginx 默认只 bind IPv4，于是 `[::1]:8080` 被拒连。
**修复**：`infra/docker-compose.prod.yml` 所有 healthcheck 把 `localhost` 替换成 `127.0.0.1`（v1.5.1 已修）：
```yaml
# server
test: ["CMD-SHELL", "wget -qO- http://127.0.0.1:8080/healthz || exit 1"]
# nginx
test: ["CMD-SHELL", "wget -qO- http://127.0.0.1/healthz || exit 1"]
```
**更稳的备选**（不依赖 wget · 用 node 内置 http）：
```yaml
test:
  - CMD-SHELL
  - node -e "require('http').get('http://127.0.0.1:8080/healthz',r=>process.exit(r.statusCode===200?0:1)).on('error',()=>process.exit(1))"
```
**顺便**：server 的 `start_period` 从 30s 提到 60s（tsx 启动 + Fastify 注册路由 + 等 PG/Redis 慢于 tsc 编译版）。

### Q11 `docker exec -it costra-server /bin/bash` 报 `no such file or directory`

**根因**：alpine 镜像极简，**默认不带 bash**，只有 `/bin/sh`（BusyBox ash）。
**修复**：alpine 容器一律用 sh：
```bash
docker exec -it costra-server sh
```
基本调试命令（cd / ls / cat / ps / wget / vi）都可用，但是 BusyBox 阉割版，部分参数与 GNU 版不同。如果非要 bash，可在 Dockerfile 加 `RUN apk add --no-cache bash`，但徒增 5MB 镜像体积，**不推荐**。

### Q12 docker compose `--env-file` 给的密码没替换 · yaml 里 `${REDIS_PW}` 解析为空（防御性提醒）

**根因**：compose 的 `${VAR}` 解析依赖 shell 环境变量 + `--env-file` 文件；如果 `/data/conf/server.env` 里没有该变量名，会被替换为空字符串，redis 等于 `--requirepass ""`，启动可能拒绝或健康检查用空密码连不上。
**验证**：
```bash
docker compose -f docker-compose.prod.yml --env-file /data/conf/server.env config | grep -A 30 "redis:"
# 看 --requirepass 后面是不是真实密码
```
**修复**：确保 server.env 包含 `PG_COSTRA_PW=xxx` 和 `REDIS_PW=xxx` 两行（§3.3 已含）。

### Q13 nginx 容器反复 restart · `no "ssl_certificate" is defined for the "listen ... ssl" directive`（v1.5.1 实测）

**根因**：手册 §4.3 旧版让 `up -d` 一把梭起所有 4 容器，但此时 §6 的 TLS 证书还没签 + nginx conf 第 41-49 行 `ssl_certificate` 还在注释状态。nginx 启动时因 `listen 443 ssl` 没有对应证书指令立即 fatal exit · `restart: unless-stopped` 反复重启（实测 RestartCount=17）。
**修复（v1.5.1 已落地）**：§4.3 改为只起 3 服务（postgres/redis/server）· §6 完整路径：①签证书 → ②sed 取消注释 → ③`nginx -t` 测语法 → ④`up -d nginx`。
**踩坑后救火**：
```bash
cd /root/release/Costra/infra

# 1. 干掉反复 restart 的 nginx
docker compose -f docker-compose.prod.yml rm -sf nginx

# 2. 按 §6.1 签证书
which certbot || dnf install -y certbot
certbot certonly --standalone -d costra.cloud \
  --email <你的邮箱> --agree-tos --no-eff-email --non-interactive
ls /etc/letsencrypt/live/costra.cloud/   # 验证证书已签

# 3. 按 §6.2 sed 取消 SSL 注释（9 行）
sed -i \
  -e 's|^    # ssl_certificate /etc/letsencrypt|    ssl_certificate /etc/letsencrypt|' \
  -e 's|^    # ssl_certificate_key /etc/letsencrypt|    ssl_certificate_key /etc/letsencrypt|' \
  -e 's|^    # ssl_protocols TLSv|    ssl_protocols TLSv|' \
  -e 's|^    # ssl_ciphers |    ssl_ciphers |' \
  -e 's|^    # ssl_prefer_server_ciphers |    ssl_prefer_server_ciphers |' \
  -e 's|^    # ssl_session_cache |    ssl_session_cache |' \
  -e 's|^    # ssl_session_timeout |    ssl_session_timeout |' \
  -e 's|^    # ssl_stapling on|    ssl_stapling on|' \
  -e 's|^    # ssl_stapling_verify |    ssl_stapling_verify |' \
  nginx/conf.d/costra.cloud.conf

# 4. 重新 up nginx
docker compose -f docker-compose.prod.yml --env-file /data/conf/server.env up -d nginx
sleep 5
docker compose -f docker-compose.prod.yml ps
```

### Q14 cron 跑 `docker compose exec` 报 `the input device is not a TTY`（v1.5.1 实测）

**根因**：`docker compose exec` 默认带 `-it`（交互式 + 分配 TTY）· 但 cron 没有 TTY → 命令直接失败 · 续期 hook 无效 · nginx 不会 reload 新证书。
**修复（v1.5.1 已落地 §6.4）**：加 `-T`（关闭 TTY 分配）：
```bash
# ❌ 旧版（cron 跑会失败）
0 3 * * * root certbot renew --quiet --deploy-hook "docker compose -f /root/release/Costra/infra/docker-compose.prod.yml exec nginx nginx -s reload"

# ✅ v1.5.1 新版（加 -T + PATH + 日志 + 错峰 17 分）
SHELL=/bin/bash
PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin
17 3 * * * root certbot renew --quiet --deploy-hook "docker compose -f /root/release/Costra/infra/docker-compose.prod.yml exec -T nginx nginx -s reload" >> /var/log/certbot-renew.log 2>&1
```

**配套修复**：v1.5 旧版 §6.1 用 `--standalone` · 续期时会撞 nginx 的 80 端口 → **v1.6 §6.1 已统一用 webroot 模式**（临时 nginx 容器 + certbot --webroot）· renewal.conf 天然 webroot · 续期不需停 nginx（业务零中断）· 详见 §6.0 模式说明。

**验证**：
```bash
# dry-run 测续期能跑通（不真签）
certbot renew --dry-run
# 期望末尾：Congratulations, all simulated renewals succeeded.

# 手动测 deploy-hook 命令本身
docker compose -f /root/release/Costra/infra/docker-compose.prod.yml exec -T nginx nginx -s reload
# 期望：无输出 + nginx logs 显示 reloading configuration
```

---

## §9 后续加固清单（FU 进 Sprint-4）

| FU-ID | 描述 | 优先级 | 估点 |
|---|---|---|---|
| FU-PROD-CI-DEPLOY | GitHub Actions / 工蜂 CI 自动 build + compose pull + up · 含蓝绿 / 回滚 | P1 | 3pt |
| FU-PROD-PG-BACKUP | cron + pg_dump 每日 → 腾讯云 COS / 7 日保留 / 异地 | P1 | 2pt |
| FU-PROD-MONITORING | postgres_exporter + redis_exporter + node_exporter + Prometheus + AlertManager | P2 | 3pt |
| FU-PROD-LOG-ROTATE | docker logging driver 已配 max-size · 但 PG/Redis log 还需 logrotate | P2 | 1pt |
| FU-PROD-PG-TUNE | postgresql.conf 调优（已含基础 · 后续 work_mem / WAL 等） | P2 | 1pt |
| FU-PROD-SECURITY-HEADERS | nginx 加 HSTS / CSP / Permissions-Policy 完整集 | P2 | 1pt |
| FU-PROD-CI-MOCK-GUARD | scripts/devops/whitelist-check.mjs 加规则 E（CI 静态扫描 WX_MOCK_LOGIN=1 红灯） | P0 | 1pt |
| FU-PROD-FW-AUDIT | D-009 §2.4 防火墙 + fail2ban + SSH 改非 22 + 登录失败告警 | P0 | 2pt |
| FU-PROD-NON-ROOT-USER | server 容器内已用 node uid 1000 · 但宿主机 docker 仍 root 跑 · 需 rootless docker | P1 | 2pt |

> 上述 9 条 FU 累计 16 pt · 不进 Sprint-3 · 候选 Sprint-4 头部专项加固 sprint。

---

## §10 v1.5 变更日志（vs v1.4）

| § | 变更 | 原因 |
|---|---|---|
| 文件 | 新建 `infra/prod-bootstrap-compose.md` 取代 `infra/prod-bootstrap.md` 作为推荐路径 | Plan C 决策（2026-05-25 11:57 Q1=A Q2=A Q3=A Q4=A） |
| 架构 | 4 容器 docker compose · 替代 v1.4 Plan A（宿主 systemd）/ Plan B（单容器内手动启停） | Plan A/B 痛点全消除 |
| Redis 版本 | 5.0.3 → **7-alpine 官方镜像**（解决 v1.3 §3.5.2 漂移登记） | 与 staging redis:7 对齐 |
| PG 认证 | initdb 默认 trust → **postgres:15-alpine 默认 scram-sha-256**（POSTGRES_PASSWORD 注入） | FU-PROD-PG-AUTH-SCRAM 自动消除 |
| systemd 路径 | systemctl 全部不需 · 容器自启靠 `restart: unless-stopped` | Q10 反模式自动消除 |
| `$releasever` 仓踩坑 | dnf install 全部不需 · 用官方镜像 | Q9 自动消除 |
| 数据持久化 | bind mount /data/{pgsql,redis,...} | 容器删了数据不丢 |
| 服务隔离 | 各容器独立 restart · 不会一起挂 | Plan A/B 单进程崩全停问题消除 |
| 配套文件（新建） | `server/Dockerfile` + `server/.dockerignore` + `infra/docker-compose.prod.yml` + `infra/nginx/conf.d/costra.cloud.conf` + `infra/postgres/initdb.d/01-extensions.sql` | docker compose 标准布局 |

**v1.5 vs v1.4 时间预估**：
- v1.4 Plan B 预估 95 min（实际 Phase-1 跑了 ~3h · 因为 4 个真踩坑）
- v1.5 预估 60~90 min（首次 docker compose pull + build server image 约 15 min · 其他步骤命令化 · 几乎无踩坑空间）

---

## §11 v1.5.1 实测修订日志（2026-05-25 17:11 立 · 17:34 / 17:58 / 19:50 三轮增订）

> 首次按 v1.5 手册在腾讯云 prod（49.235.216.20 · tlinux 3.3 · 2核2G）实测落地，撞到 7 个坑，已沉淀进对应章节。

| 坑序号 | 现象 | 沉淀位置 | 修复 |
|---|---|---|---|
| 1 | `openssl rand -base64 64 \| tr -d '/+='` 输出有两行 | §8 Q7 | tr -d 加 `\n` |
| 2 | 2核2G prod 机器 `docker compose build` 4000s+ 不完成 | §4.1（重写）+ §8 Q9 提示 | 跨机构建（§4.1-A scp）/ Docker Hub（§4.1-B）/ 直接 prod build 仅限 ≥4 核 4G（§4.1-C） |
| 3 | redis 容器 unhealthy · `Can't open the log file: Permission denied` | §0 总览（owner 标注）+ **§3.3 拆出独立章节 3 步式 + chown 表** + §4.4 预警 + §8 Q8 救火 | §3.3 Step 2 强制 chown：`chown 999:999 /data/redis /data/logs/redis /data/logs/postgres` 和 `chown 1000:1000 /data/logs/server` |
| 4 | server 容器启动 `Cannot find module './app.js'` | §8 Q9 | `server/Dockerfile` CMD 从 `node --import tsx/esm` 改为 `node_modules/.bin/tsx`（已落地） |
| 5 | server / nginx healthcheck `Connection refused` 但手动 curl 通 | §8 Q10 | `infra/docker-compose.prod.yml` healthcheck 把 `localhost` 全部换成 `127.0.0.1`，server `start_period` 从 30s 提到 60s（已落地） |
| 6 | nginx 反复 restart 17 次 · `no "ssl_certificate" is defined for the "listen ... ssl"` | §4.3 改造 + §6 重写 + §8 Q13 | §4.3 改为只起 3 服务（postgres/redis/server）· §6 加 sed 取消 9 行 SSL 注释 + `nginx -t` 测语法 + 最后才 up nginx |
| 7 | cron 续期命令缺 `-T` · 跑会报 `the input device is not a TTY` · 旧版 standalone 续期还会撞 nginx 80 端口 | §6.0 新增 + §6.1 第 4 步 + §6.4 重写 + §8 Q14 | §6.0 解释 webroot vs standalone · §6.1 末尾 sed 切 renewal 配置到 webroot · §6.4 cron 加 `-T` + PATH + 日志 + 错峰 17 分 + `--deploy-hook` |
| bonus | `docker exec -it ... /bin/bash` 报 not found | §8 Q11 | alpine 没有 bash · 用 `sh` |

**v1.5.1 已落地的代码改动**（已在 dev 分支）：
- `server/Dockerfile` line 50-52：CMD 改为 `tsx` CLI（修坑 4）
- `infra/docker-compose.prod.yml` line 184-200：server healthcheck 改用 node http + `127.0.0.1` + `start_period: 60s`（修坑 5）
- `infra/docker-compose.prod.yml` line 235-240：nginx healthcheck `localhost` → `127.0.0.1`（修坑 5）
- `infra/prod-bootstrap-compose.md`（本文件）多处：
  - §0 总览：目录树加 owner 标注（修坑 3 醒目度）
  - §3.3（**新拆**）：建目录 + chown（3 步式 · 强制不可跳过 · 含 owner 表）
  - §3.4（**原 §3.3 重命名**）：写 server.env
  - §4.1：跨机构建三方案（修坑 2）
  - §4.3：拆 nginx 不一起起（修坑 6）
  - §4.4：redis Restarting 预警提示（修坑 3 救火链路）
  - §6.0（**新增**）：webroot vs standalone 模式说明 + 链路示意（修坑 7 设计文档化）
  - §6.1 末尾：sed 切 renewal 配置到 webroot（修坑 7 续期不停 nginx）
  - §6（重写）：sed 取消 SSL 注释 + nginx -t（修坑 6）
  - §6.4（重写）：cron 加 `-T` + PATH + 日志 + 错峰 + dry-run 验证（修坑 7）
  - §8 Q7~Q14：8 条 FAQ
  - §0-ter（**新增 · 2026-05-26**）：快速路径入口 → `infra/scripts/`
  - §11：本节
- `infra/scripts/`（**新增 · 2026-05-26**）：v1.5.1 全流程脚本化
  - `lib/common.sh`：日志 / 交互 / 密码生成 / 校验
  - `01-preflight.sh` ~ `09-verify-gates.sh`：9 个独立步骤脚本
  - `deploy-all.sh`：主入口 · 编排 9 步 · 支持 `--reuse-secrets` / `--use-existing-cert` / `--from` / `--skip`
  - `README.md`：脚本使用文档（覆盖全新部署 / 备机迁移 / CI/CD 三场景）

**正确部署顺序（v1.5.1 验证版）**：
1. §1 前置确认 → §2 拉代码
2. §3.1 生密码 → §3.2 取 WX_APP_SECRET → **§3.3 建目录 + chown（漏做 redis fatal）** → §3.4 写 server.env
3. §4.1 build server 镜像（**不在 2核2G 机器上 build**）→ §4.2 pull 官方镜像
4. §4.3 **只起 3 服务**（postgres/redis/server）→ §4.4 验证 3 healthy
5. §5 跑 migrations
6. §6.0 看模式说明 → §6.1 standalone 签证书 + 立刻切 webroot renewal → §6.2 sed 取消 SSL 注释 → §6.3 `nginx -t` + up nginx → §6.4 cron 续期（dry-run 验证）
7. §7 闸门 5 条全 PASS

**Phase-1 实际耗时**（v1.5.1 实测）：
- v1.5 预估 60~90 min
- 实测 ~5h（含 7 坑排查 · 但每个坑都已沉淀 · 后续重跑应在 60 min 内）

---

> **手册版本**：v1.5.1 · 2026-05-25 17:11 立 · 17:34 增订（nginx 顺序坑） · 17:58 增订（redis 权限坑强化 §0/§3.3 拆分/§4.4 预警）· 19:50 增订（cert renewal webroot 化 §6.0 新增 / §6.1 切 renewal / §6.4 cron 加 -T / §8 Q14）· 2026-05-26 10:30 增订（§0-ter 快速路径 + infra/scripts/ 全流程脚本化）· Orchestrator 同对话轮交付（v1.5 立案 12:04 · v1.5.1 实测修订 · Plan D 决策落档 + 7 坑沉淀 + 9 步脚本化）
> **下次修订**：Phase-2 闸门 5 条全 PASS 后由 Orchestrator 派 qa-planner 出 Phase-3 改造手册
