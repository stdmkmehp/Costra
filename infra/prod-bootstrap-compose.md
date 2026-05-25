# Costra · prod 服务首次 bootstrap 手册（v1.5 · Plan C · docker compose 多容器）

> **本手册取代 v1.4 `infra/prod-bootstrap.md` · 作为 Costra prod 部署当前推荐路径**。
>
> **母决策**：D-009（域名 + 安全基线）/ D-023（prod 入口回归根域）/ **D-026（staging↔prod 合并 · 工程纪律 4 条）**
> **决策落档**：2026-05-25 11:57 Human 选 Plan D（4 服务 docker compose）→ 升级为 v1.5 Plan C
> **日期**：2026-05-25 立案
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

数据持久化 → 宿主机 /data/
├─ pgsql/        (PG 数据)
├─ redis/        (Redis AOF/RDB)
├─ conf/         (server.env · postgres.env · 见 §3)
├─ logs/         (各服务日志)
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

### §3.3 写 `/data/conf/server.env`（**关键**）

```bash
# 建目录
mkdir -p /data/conf /data/pgsql /data/redis /data/logs/{postgres,redis,server,nginx} /data/certbot/www /data/backups
chmod 0700 /data/conf /data/backups

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

```bash
cd /root/release/Costra/infra

# build server image（首次 ~5-10 min · 后续增量 ~30s）
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

### §4.3 启动 stack

```bash
cd /root/release/Costra/infra

# 用 server.env 作为 compose 的 ${VAR} 来源 + 各容器 env_file
docker compose -f docker-compose.prod.yml --env-file /data/conf/server.env up -d

# 看启动日志（首次 PG initdb · 自动跑 01-extensions.sql 装 pgcrypto + citext · ~30s）
docker compose -f docker-compose.prod.yml logs -f postgres | head -40
# 期望末尾：database system is ready to accept connections

# Ctrl+C 停止 logs（容器还在跑）
```

### §4.4 验证 stack 全栈

```bash
# 1. 4 容器全部 healthy
docker compose -f docker-compose.prod.yml ps
# 期望：4 行全部 Up X seconds (healthy)
#   costra-postgres   ... Up X seconds (healthy)   127.0.0.1:5432->5432/tcp
#   costra-redis      ... Up X seconds (healthy)   127.0.0.1:6379->6379/tcp
#   costra-server     ... Up X seconds (healthy)   8080/tcp
#   costra-nginx      ... Up X seconds (healthy)   0.0.0.0:80->80/tcp, 0.0.0.0:443->443/tcp

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

### §6.1 首次签 cert（用 standalone · nginx 还没绑 443）

```bash
# 1. 临时停 nginx 容器（让 80 端口空出 · certbot standalone 用）
docker compose -f docker-compose.prod.yml stop nginx

# 2. 装 certbot（宿主机 · 一次性）
dnf install -y certbot
certbot --version

# 3. 签 cert（standalone 模式 · certbot 临时起 80）
certbot certonly --standalone \
  -d costra.cloud \
  --email <Human 邮箱> \
  --agree-tos --no-eff-email --non-interactive

# 期望：Successfully received certificate.
# 文件：/etc/letsencrypt/live/costra.cloud/fullchain.pem + privkey.pem

# 4. 验证证书
ls -la /etc/letsencrypt/live/costra.cloud/
```

### §6.2 启用 nginx TLS + 重启

```bash
# 编辑 nginx conf · 取消 ssl_certificate / ssl_certificate_key 两行注释
vim /root/release/Costra/infra/nginx/conf.d/costra.cloud.conf
# 找到这两行 · 去掉 # 前缀：
#   # ssl_certificate /etc/letsencrypt/live/costra.cloud/fullchain.pem;
#   # ssl_certificate_key /etc/letsencrypt/live/costra.cloud/privkey.pem;
#   # ssl_protocols ... (整段去 #)

# 重启 nginx 容器（重新加载 conf · /etc/letsencrypt 已 read-only mount）
docker compose -f docker-compose.prod.yml up -d nginx
docker compose -f docker-compose.prod.yml logs nginx | tail -20
# 期望：start worker process · 无 SSL_CTX_use_certificate error
```

### §6.3 自动续期（cron · 宿主机）

```bash
# certbot 默认 90 天到期 · 每 60 天自动续 · 续完通知 nginx 容器 reload
cat > /etc/cron.d/costra-certbot <<'EOF'
0 3 * * * root certbot renew --quiet --deploy-hook "docker compose -f /root/release/Costra/infra/docker-compose.prod.yml exec nginx nginx -s reload"
EOF

systemctl restart crond
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

> **手册版本**：v1.5 · 2026-05-25 12:04 · Orchestrator 同对话轮交付（Plan D 决策落档 · 4 配套文件 + 1 新手册）
> **下次修订**：Phase-1 实测后修订 v1.6（如再撞新坑）· Phase-2 闸门 5 条 PASS 后由 Orchestrator 派 qa-planner 出 Phase-3 改造手册
