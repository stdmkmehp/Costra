# Costra · prod 服务首次 bootstrap 手册（v1.0）

> **本手册为 Costra 项目首次生产服务部署交接单**。Agent 无生产 SSH 访问权 · Agent 出手册 + Human 跑命令 · 每步含验证 + 期望输出 · 高危段标 ⚠️ Human 拍板。
>
> **母决策**：D-009（域名 + 安全基线）/ D-023（prod 入口回归根域）/ **D-026（staging↔prod 合并 · 工程纪律 4 条 · 同对话轮交付）**
> **交付者**：Orchestrator（devops-ops 装扮档工具白名单错配兜底落档 · D-026 §6.1 incident 备注）
> **日期**：2026-05-23
> **HEAD**：91b01d2（dev 分支 · 含 0001~0006 共 6 条 migration · entries_change_seq SEQUENCE 已就绪）
> **目标读者**：Human（拥有 49.235.216.20 root SSH 访问权 + 腾讯云控制台 + 微信公众平台后台访问权）

---

## §0 一句话总览

首次 prod 服务部署 · 在 49.235.216.20 上跑 Node.js Fastify server + nginx 反代 + Let's Encrypt + systemd · 预计 Human 操作时间 60~90 分钟 · 产出 prod 入口 `https://costra.cloud/v1` 可达 + Phase-2 闸门 5 条全 PASS。

**部署架构（运行后）**：

```
微信小程序  →  https://costra.cloud  (443/SSL · Let's Encrypt)
                ↓ nginx 反代（含 X-ICP-Filing header）
                127.0.0.1:8080  (Fastify · systemd costra-server.service)
                ↓
                127.0.0.1:5432  (postgres · docker compose) + 127.0.0.1:6379 (redis · docker compose)
```

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
| 2 | DNS 已生效 | `dig +short costra.cloud` | 返回 `49.235.216.20` |
| 3 | 防火墙基线（D-009 §2.4） | `ssh root@49.235.216.20 'ufw status \|\| iptables -L -n \| head -20'` | 仅放 22(改后)/80/443 · 其他默认拒绝 |
| 4 | 已装基础工具 | `ssh root@49.235.216.20 'docker --version && node --version && nginx -v 2>&1'` | docker 24+ / node 20+ / nginx 已装 · 任一缺失走 §1.1 |
| 5 | git + 仓库可拉 | `ssh root@49.235.216.20 'git --version'` | git 2.x+ |

> ⚠️ **前置闸门**：若第 3 项（防火墙基线 D-009 §2.4 SSH 改非 22 端口 / fail2ban / 登录失败告警 / `R-018 🟠`）未到位，**先补齐再进 §2**。不要在公网开 8080 端口暴露未配 SSL 的 Node 服务。

### §1.1 缺失工具补装（Human 跑）

```bash
ssh root@49.235.216.20

# Docker（如缺）
curl -fsSL https://get.docker.com | sh
systemctl enable --now docker

# Node 20（如缺）
curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
apt install -y nodejs

# nginx（如缺）
apt install -y nginx

# certbot（Let's Encrypt nginx 插件）
apt install -y certbot python3-certbot-nginx

# psql client + jq（验证用）
apt install -y postgresql-client jq
```

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
# 期望：91b01d2 ... 或更新（如本地之后又 push 了新 commit · 取最新 dev HEAD）
```

### §2.3 安装依赖

```bash
cd /opt/costra/server
npm install
# 期望：依赖装完无 error · vulnerabilities 列表可有但不要 critical
```

> 📌 注意：**含 dev deps**（不带 `--production` 标志）· 因为 server 用 `tsx --import tsx/esm src/server.ts` 跑 .ts 源码（不预编译）· tsx 在 devDependencies 中。

---

## §3 起 docker compose 依赖栈（postgres + redis + minio + mailhog）

```bash
cd /opt/costra/server
docker compose up -d
docker compose ps
# 期望 4 服务全 Up + healthy（postgres / redis / minio / mailhog）
```

### §3.1 ⚠️ Postgres 密码改 prod 强密码（D-026 §2.3 C2 关联 + R-008 红线）

**默认 docker-compose.yml** L16 `POSTGRES_PASSWORD: costra_dev_pw`（dev 弱密码 · 不能上 prod）。

**Human 操作**：
1. 生成强密码：
   ```bash
   openssl rand -base64 32
   # 示例输出：x7K2mP9...（请记录到本机密码管理器 · 不要进对话/邮件）
   ```
2. 编辑 `/opt/costra/server/docker-compose.yml` L16：
   ```yaml
   POSTGRES_PASSWORD: <openssl 生成的强密码>
   ```
   ⚠️ **绝对不要 commit 这个改动到仓库**（如果走 P1 路径需要 `git update-index --assume-unchanged docker-compose.yml` 或更稳妥地走 §3.2 override 文件）

3. 重启：
   ```bash
   docker compose down
   docker compose up -d
   docker compose ps
   ```

### §3.2 推荐做法（更稳）：docker-compose.override.yml

替代 §3.1 直接改 docker-compose.yml，创建本地 override：

```bash
cat > /opt/costra/server/docker-compose.override.yml <<'EOF'
version: "3.9"
services:
  postgres:
    environment:
      POSTGRES_PASSWORD: <openssl 生成的强密码>
EOF

# 加 .gitignore（如果未加）
grep -q docker-compose.override.yml /opt/costra/.gitignore || \
  echo "server/docker-compose.override.yml" >> /opt/costra/.gitignore

docker compose down
docker compose up -d
```

### §3.3 验证 postgres 可连

```bash
docker compose exec -T postgres psql -U costra -d costra -c '\dt'
# 期望：(0 rows) · 表还没建（migrations 在 §6 跑）
# 如果报 password authentication failed → §3.1/§3.2 密码改动未生效 · 先 docker compose down -v 清卷再起
```

---

## §4 server `.env.prod` 配置（**不进仓库**）

### §4.1 必填字段清单（从 systemd EnvironmentFile §5.2 注入 · 不写 .env.prod 文件本身）

> ⚠️ **重要**：本节为字段清单 · 实际值通过 §5.2 systemd EnvironmentFile 注入 · **不要在 server/ 目录创建 .env.prod 文件**（避免误进仓 · 即使 .gitignore 覆盖）

| 字段 | 值 | 来源 / 取得方式 |
|---|---|---|
| `NODE_ENV` | `production` | 强制 |
| `PORT` | `8080` | 默认（nginx 反代到此端口） |
| `DATABASE_URL` | `postgres://costra:<§3.1强密码 URL encode>@localhost:5432/costra` | §3.1 |
| `REDIS_URL` | `redis://localhost:6379` | docker-compose |
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
After=docker.service network-online.target
Requires=docker.service

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

### §5.2 `/etc/costra/server.env`（EnvironmentFile · 0600 权限）

```bash
mkdir -p /etc/costra /var/log/costra
chmod 0700 /etc/costra

# 编辑 /etc/costra/server.env（按 §4.1 清单字段填）
# 推荐用 vim / nano · 不要用 echo 链式（防 shell history 残留）
vim /etc/costra/server.env

# 文件内容（一行一字段 · KEY=VALUE 格式 · 末行无空格）：
# NODE_ENV=production
# PORT=8080
# DATABASE_URL=postgres://costra:<URL_encode_pw>@localhost:5432/costra
# REDIS_URL=redis://localhost:6379
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
docker compose exec -T postgres pg_dumpall -U costra > /backup/pre-migrate-init-$(date +%Y%m%d-%H%M%S).sql
ls -lh /backup/
# 期望：dump 文件存在（首次为空数据 · 仅 schema 头）· 文件 < 100K
```

#### 步骤 2：migrate

```bash
cd /opt/costra/server

# 用 systemd EnvironmentFile 中的 DATABASE_URL（避免明文敲密码到 shell history）
source /etc/costra/server.env
export DATABASE_URL

npm run db:migrate
# 期望终端输出 6 条 migration（按 0001 → 0006 顺序）：
# ==> db/migrations/0001_init.sql
# ==> db/migrations/0002_seed_system_categories.sql
# ==> db/migrations/0003_*.sql
# ==> db/migrations/0004_*.sql
# ==> db/migrations/0005_*.sql
# ==> db/migrations/0006_add_change_seq.sql
# 全部成功无 ERROR
```

#### 步骤 3：verify（D-026 §2.3 C3 验证三连）

```bash
psql "$DATABASE_URL" -c '\dt' | tee /tmp/dt-output.txt
# 期望：≥ 10 张表（users / families / family_members / accounts / categories /
#                 entries / sync_versions / audit_logs / subscribe_tokens / feature_flags · + outbox / schema_migrations 等后续扩展）

psql "$DATABASE_URL" -c '\d entries' | grep change_seq
# 期望：1 行 · change_seq | bigint | not null

psql "$DATABASE_URL" -c "SELECT last_value FROM entries_change_seq"
# 期望：last_value = 1（SEQUENCE 已建 · 未消费）

psql "$DATABASE_URL" -c "SELECT count(*) FROM entries"
# 期望：0（首次 prod · 数据为空）

unset DATABASE_URL  # 清环境变量
```

---

## §7 nginx 反代配置

### §7.1 `/etc/nginx/sites-available/costra.cloud.conf`

```bash
cat > /etc/nginx/sites-available/costra.cloud.conf <<'NGINXEOF'
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

### §7.2 启用站点

```bash
ln -sf /etc/nginx/sites-available/costra.cloud.conf /etc/nginx/sites-enabled/
# 移除默认站点（避免冲突）
rm -f /etc/nginx/sites-enabled/default

nginx -t
# 期望：syntax is ok / test is successful

systemctl reload nginx
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

**验证证书 + 自动续期 cron**：

```bash
ls -la /etc/letsencrypt/live/costra.cloud/
# 期望：fullchain.pem / privkey.pem 两个软链

systemctl list-timers | grep certbot
# 期望：1 行 certbot.timer 或 snap.certbot.renew.timer · next 时间在未来
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

# 4. systemd 状态
systemctl is-active costra-server
# 期望：active

systemctl is-enabled costra-server
# 期望：enabled

# 5. **D-026 §2.3 C2 红线**：日志无 mock
grep -i 'mockLogin\|WX_MOCK_LOGIN enabled\|"mock"' /var/log/costra/server.log
# 期望：无任何输出（grep 退出码 1）
echo "Exit: $?"
# 期望：Exit: 1
```

**5 条全 PASS** → Phase-1 prod-bootstrap 闸门完成 → 进 Phase-3 154+150 真 prod 实测。

**任一 FAIL** → 看 §9 故障排查。

---

## §9 故障排查（FAQ · 6 条）

### Q1 systemctl status 显示 Failed / Activating（restart loop）

```bash
journalctl -u costra-server -n 100 --no-pager
tail -n 100 /var/log/costra/server.err.log
```

常见根因：
- `EnvironmentFile` 路径错或权限错（`stat /etc/costra/server.env` 期望 `0600 root root`）
- `tsx` 未装（`ls /opt/costra/server/node_modules/tsx` 期望存在）
- 端口冲突（`lsof -i :8080` 看是否被占）
- Postgres 连不上（先 `systemctl restart docker` + `docker compose up -d`）

### Q2 healthz 返 502 Bad Gateway

- server 没起：`systemctl status costra-server`
- 端口冲突：`lsof -i :8080`
- nginx 反代到错地方：`grep proxy_pass /etc/nginx/sites-enabled/costra.cloud.conf`（应该是 `127.0.0.1:8080`）

### Q3 Let's Encrypt 签证书失败

- DNS A 记录是否指对：`dig +short costra.cloud`（期望 `49.235.216.20`）
- nginx 80 端口是否能访问：`curl http://costra.cloud/.well-known/acme-challenge/test`（期望 404 而非 connection refused · 表示 80 端口和 location /.well-known 配对）
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

### Q5 psql 连不上

- `docker compose ps` 看 postgres 是否 Up + healthy
- `POSTGRES_PASSWORD` 是否一致（§3.1 改了密码 · §4.1 DATABASE_URL 也要同步改）
- DATABASE_URL 字符串特殊字符是否 URL encode（密码含 `+/=` 需替换 `%2B / %2F / %3D`）

### Q6 migration 0006 跑失败

```bash
# 确认 migration 文件存在
ls /opt/costra/server/db/migrations/ | grep 0006
# 期望：0006_add_change_seq.sql（或类似命名）

# 看当前 migration 版本
psql "$DATABASE_URL" -c "SELECT version FROM schema_migrations ORDER BY version DESC LIMIT 5"
# 期望：含 0001~0006 的版本号

# 如果中间某条失败 · 单独跑剩余
docker compose exec -T postgres psql -U costra -d costra < /opt/costra/server/db/migrations/0006_*.sql
```

---

## §10 后续加固清单（不在本次 bootstrap scope · 进 follow-ups）

| FU-ID | 描述 | 优先级 | 预估卡 |
|---|---|---|---|
| **FU-PROD-NON-ROOT-USER** | systemd User 改 costra 非特权用户（当前 root · §5.1 注释已标 ⚠️）+ /opt/costra owner 改 costra:costra | P1 | 1 pt |
| **FU-PROD-LOG-ROTATE** | /var/log/costra/*.log 加 logrotate 配置（防磁盘溢出） | P2 | 1 pt |
| **FU-PROD-PG-BACKUP** | D-009 §2.4 数据备份（每日 dump 到腾讯云 COS / 7 日保留 / 异地） | P1 | 2 pt |
| **FU-PROD-MONITORING** | Prometheus node_exporter + 微信小程序后台 JS 异常监控对接 + AlertManager | P2 | 3 pt |
| **FU-PROD-CI-DEPLOY** | 从手动 git pull 改为 GitHub Actions / 工蜂 CI 自动 deploy（含 systemd reload + 健康检查 + 回滚） | P1 | 3 pt |
| **FU-PROD-CI-MOCK-GUARD** | scripts/devops/whitelist-check.mjs 加规则 E（D-026 §2.3 C2 静态扫描 prod 部署脚本含 WX_MOCK_LOGIN=1 即 CI 红灯） | P0 | 1 pt |
| **FU-PROD-FW-AUDIT** | D-009 §2.4 防火墙 + fail2ban + SSH 改非 22 端口 + 登录失败告警一次性补齐审计 | P0 | 2 pt |

> 上述 7 条 FU 累计 13 pt · 不进 Sprint-3（避免推迟 154+150 真 prod 验收）· 候选 Sprint-4 头部专项加固 sprint。

---

## §11 Human 操作时间预估

| 阶段 | 时间 | 备注 |
|---|---|---|
| §1 前置确认 + §1.1 补装 | 10 min | 取决于现有工具情况 |
| §2 拉代码 + npm install | 5 min | 取决于网络 · 大陆从 GitHub 拉慢 → 用工蜂 / rsync |
| §3 docker compose + §3.1 改密码 | 5 min | |
| §4 .env.prod 字段清单准备（不落盘） | 5 min | 含 WX_APP_SECRET 取（微信平台扫码） + JWT_SECRET 生成 |
| §5 systemd unit + EnvironmentFile | 10 min | §5.3 启动日志验证 5 min |
| §6 migrations 三件套 | 5 min | dump + migrate + verify |
| §7 nginx + Let's Encrypt | 15 min | LE 签证书 ~3 min · nginx 配置 + reload ~10 min |
| §8 闸门验证 5 条 | 10 min | |
| **合计** | **65 min** | **± 30 min**（看现有工具 / 网络 / 微信平台流程） |

---

## §12 完成后向 Orchestrator 反馈

Phase-1 完成后在对话中回：

```
prod-bootstrap §8 闸门验证：
1. healthz: PASS / FAIL
2. /v1/legal/icp: PASS / FAIL
3. 401 守门: PASS / FAIL
4. systemd active+enabled: PASS / FAIL
5. **C2 mock 红线**: PASS / FAIL（grep 输出空）

5/5 PASS → 进 Phase-3
任一 FAIL → 贴 §9 故障排查证据 · 等 Orchestrator 派 fix
```

Orchestrator 收到后：
- 5/5 PASS → 派 qa-planner 改造 154+150 实测手册到 v1.4 prod 版（移除 WX_MOCK_LOGIN 段 + apiBaseUrl 切 prod + 真 wx.login 路径）→ Human 跑 5 条断言 A~E → 进 Phase-4 152+153 prod 回归
- 任一 FAIL → 看故障类型派 devops-ops 装扮档（如 nginx / systemd 调整）或 backend-dev（如 server 配置缺陷）

---

> **手册版本**：v1.0 · 2026-05-23 · Orchestrator 兜底落档（D-026 §6.1 incident 备注）
> **下次修订**：Phase-1 实测后根据 Human 反馈修订 v1.1（如发现命令错 / 期望不准 / 步骤遗漏）
