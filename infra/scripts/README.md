# Costra · prod bootstrap 脚本集（v1.5.1）

> 把 [`prod-bootstrap-compose.md`](../prod-bootstrap-compose.md) v1.5.1 全流程脚本化 · 60-90 min 手动操作 → 5-10 min 一键部署。
>
> **设计原则**：每个脚本独立可跑 + 幂等 + 失败时给出回退指引 + 关键决策点参数化。

---

## 目录结构

```
infra/scripts/
├── README.md                  # 本文件
├── deploy-all.sh              # ⭐ 主入口（编排 9 步）
├── lib/
│   └── common.sh              # 公共库（日志 / 交互 / 密码生成 / 校验）
├── 01-preflight.sh            # 前置检查（OS / Docker / 端口 / DNS）
├── 02-prepare-dirs.sh         # 建目录 + chown（修 redis 权限坑）
├── 03-generate-env.sh         # 生成密码 + 写 server.env
├── 04-build-server.sh         # build server 镜像
├── 05-start-stack.sh          # pull 镜像 + 起 3 服务 + 等 healthy
├── 06-migrate.sh              # 跑 migrations（dump→migrate→verify）
├── 07-issue-cert.sh           # 签证书 + sed 取消 SSL 注释
├── 08-finalize-nginx.sh       # nginx -t + up nginx + cron 续期
├── 09-verify-gates.sh         # 闸门 5 条验证
│
├── backup-db.sh               # DB 定时备份（pg_dump + gzip · 被 maintenance.sh backup 委托）
└── maintenance.sh             # ⭐ 运维定时任务统一入口（backup / purge-* / install-cron）
```

---

## 运维定时任务（maintenance.sh · 日常）

> 与一次性 bootstrap（9 步）不同，`maintenance.sh` 是**长期运行的定时任务统一入口**：crontab 只调它，用子命令区分。详见 [`docs/db/maintenance-cron-plan.md`](../../docs/db/maintenance-cron-plan.md)。

```bash
# 一次性：生成 /etc/cron.d/costra-maintenance（用 ${COSTRA_ROOT} 展开真实路径）
./maintenance.sh install-cron          # 先 --dry-run 预览

# 手动执行（cron 亦调这些）：
./maintenance.sh backup                # 委托 backup-db.sh（pg_dump + gzip）
./maintenance.sh purge-idempotency     # 清过期幂等键（每小时）
./maintenance.sh purge-sessions        # 清已过期 session（每日）
./maintenance.sh purge-all             # 顺序跑全部 purge
./maintenance.sh list                  # 列出可用任务

# 预览不改（purge 跑 SELECT count 预览将删行数）：
./maintenance.sh purge-idempotency --dry-run
```

清理任务依赖 migration `0009_session_index_fix.sql`（把 `idx_user_sessions_expires` 改为无谓词，使 `purge-sessions` 走索引而非全表扫）。

---

## 快速开始

### 全新部署（首台 prod 机器）

```bash
ssh root@<prod-ip>
cd /root/Costra/infra/scripts

chmod +x *.sh lib/*.sh

# 一键全流程
./deploy-all.sh \
    --email you@example.com \
    --build-mode local \
    --wx-app-secret '<32 字符微信 AppSecret>' \
    -y
```

### 备机 / 迁移机器（复用现有 server.env + 证书）

```bash
# 假设已经从主 prod scp 过来：
#   /data/conf/server.env       （来自主 prod · scp 过来）
#   /tmp/letsencrypt.tar.gz     （主 prod 上 tar czf - /etc/letsencrypt | scp ...）
#   /tmp/costra-server.tar.gz   （主 prod 上 docker save | gzip | scp ...）

./deploy-all.sh \
    --reuse-secrets \
    --import-cert /tmp/letsencrypt.tar.gz \
    --build-mode load \
    --image-tar /tmp/costra-server.tar.gz \
    -y
```

### 用 Docker Hub / 私有仓库

```bash
docker login   # 一次性配置

./deploy-all.sh \
    --email you@example.com \
    --build-mode registry \
    --registry-image weizhao/costra-server:v1.5.1-20260525 \
    --wx-app-secret '<32 字符密钥>' \
    -y
```

---

## 单步执行 / 调试

每个脚本都可以独立跑，调试时很有用。

```bash
# 只跑前置检查
./01-preflight.sh

# 只重做证书（保留现有部署）
./07-issue-cert.sh --use-existing

# 只重启 nginx + 重跑 cron
./08-finalize-nginx.sh

# 只跑闸门验证
./09-verify-gates.sh

# 跳过前两步（已经做过）
./deploy-all.sh --from 03 ...

# 跳过指定步骤（逗号分隔）
./deploy-all.sh --skip 01,06 ...
```

---

## 关键参数速查

### 通用（所有脚本支持）

| 参数 | 含义 |
|---|---|
| `--dry-run` | 只打印命令不执行 |
| `-y` / `--yes` | 跳过交互确认 |
| `-h` / `--help` | 显示帮助 |

### deploy-all.sh

| 参数 | 含义 |
|---|---|
| `--email <addr>` | 证书邮箱（首次签证必选） |
| `--domain <name>` | 域名（默认 costra.cloud） |
| `--reuse-secrets` | 复用现有 server.env（不重生成密码） |
| `--wx-app-secret <val>` | 微信小程序密钥（避免交互输入） |
| `--use-existing-cert` | 复用现有 /etc/letsencrypt 证书 |
| `--import-cert <tar.gz>` | 从 tar 导入证书 |
| `--build-mode <local\|load\|registry>` | server 镜像构建方式 |
| `--image-tar <path>` | load 模式：tar.gz 路径 |
| `--registry-image <full>` | registry 模式：完整镜像名 |
| `--from <01-09>` | 从指定步骤开始 |
| `--skip <01,02>` | 跳过指定步骤 |

### 03-generate-env.sh（密码相关）

| 参数 | 含义 |
|---|---|
| `--reuse-secrets` | 复用现有 server.env |
| `--pg-pw <val>` | 指定 PG 密码（避免随机生成） |
| `--redis-pw <val>` | 指定 Redis 密码 |
| `--jwt-secret <val>` | 指定 JWT 密钥 |
| `--wx-app-secret <val>` | 指定微信密钥 |

### 07-issue-cert.sh（证书相关）

| 参数 | 含义 |
|---|---|
| `--email <addr>` | 证书邮箱 |
| `--use-existing` | 复用现有证书（仅校验） |
| `--import-tar <path>` | 从 tar.gz 导入证书 |

---

## 三种典型场景

### 场景 1：新机器全新部署

```bash
./deploy-all.sh --email you@example.com --build-mode local --wx-app-secret 'xxx' -y
```

预计耗时：5-10 min（不含 `npm ci` build 时长）

### 场景 2：迁移机器（旧机器证书 + 密码 + 镜像都要复用）

#### Step 1 · 在旧机器导出资源

```bash
# 旧机器
tar czf /tmp/letsencrypt.tar.gz -C /etc letsencrypt/
scp /data/conf/server.env root@<新机器>:/data/conf/
scp /tmp/letsencrypt.tar.gz root@<新机器>:/tmp/

docker save costra-server:latest | gzip > /tmp/costra-server.tar.gz
scp /tmp/costra-server.tar.gz root@<新机器>:/tmp/
```

#### Step 2 · 在新机器一键

```bash
ssh root@<新机器>
cd /root/Costra/infra/scripts

./deploy-all.sh \
    --reuse-secrets \
    --import-cert /tmp/letsencrypt.tar.gz \
    --build-mode load \
    --image-tar /tmp/costra-server.tar.gz \
    --skip 06 \
    -y
```

> ⚠️ 注意：迁移场景已带数据 (`/data/pgsql`)，**不应再跑 06 migrate**（可能重复执行 migration 导致冲突）。
> 因此加 `--skip 06`。如果是空数据迁移，去掉这个 flag。

预计耗时：3-5 min（不需 build · 不需签证书）

### 场景 3：CI/CD 自动部署

```bash
# 假设镜像已推到私有仓库
./deploy-all.sh \
    --reuse-secrets \
    --use-existing-cert \
    --build-mode registry \
    --registry-image ${CI_REGISTRY_IMAGE}:${CI_COMMIT_SHA} \
    --skip 01 \
    -y
```

> 在 CI 已经验证过环境的情况下可以 `--skip 01`。

---

## 失败处理

### 任一步骤失败会显示

```
[ERROR]  [05] 步骤失败 · 终止部署
[ERROR]  可以单独重跑这一步：./05-start-stack.sh ...
[ERROR]  也可以 --from 05 从这一步重新开始
```

### 常见失败 → 排查指引

| 步骤 | 现象 | 排查 |
|---|---|---|
| 01 | 端口 80/443 被占用 | 看 `ss -tlnp` 谁在用，让出端口 |
| 02 | chown 失败 | 必须 root 跑（`sudo` 或 `su -`） |
| 03 | 缺 WX_APP_SECRET | 加 `--wx-app-secret <val>` 或交互式输入 |
| 04 | local build 几千秒不动 | 改用 `--build-mode load` 或 `registry` |
| 05 | redis Restarting | 99% 是 02 chown 漏做（参考手册 §8 Q8） |
| 05 | server unhealthy | `docker logs costra-server --tail 50` |
| 07 | 80 端口冲突 | 脚本自动 `rm -sf nginx`，仍冲突看其他进程 |
| 08 | dry-run 续期失败 | 检查 `/etc/letsencrypt/renewal/<domain>.conf` 是否切到 webroot |
| 09 | 闸门 1 (https/healthz) FAIL | nginx 健康但代理不通：`docker exec costra-nginx wget -qO- http://server:8080/healthz` |

详细 FAQ 见 [`prod-bootstrap-compose.md` §8](../prod-bootstrap-compose.md)。

---

## 与手册的关系

| 文档 | 角色 |
|---|---|
| [`prod-bootstrap-compose.md`](../prod-bootstrap-compose.md) | **权威文档** · 完整流程 + 决策背景 + 7 坑 FAQ |
| `infra/scripts/` (本目录) | **快速路径** · 把手册流程脚本化 |

**两者的关系**：
- 脚本失败时 → 看手册对应章节排查
- 手册改动时 → 脚本里的步骤序号也要同步
- 新手第一次部署 → 建议看一遍手册再跑脚本（理解每步在做什么）

---

## v1.5.1 沉淀的踩坑全部嵌入脚本

| 坑 | 嵌入位置 |
|---|---|
| 坑 1: `tr -d` 缺 `\n` 输出两行 | `lib/common.sh::gen_password` 强制 `\n` |
| 坑 2: 2核2G build 4000s+ | `04-build-server.sh` 内存检查 + 推荐 load/registry |
| 坑 3: redis 权限 fatal | `02-prepare-dirs.sh` 强制 chown + verify · `05-start-stack.sh` 失败时指向 §8 Q8 |
| 坑 4: tsx ESM/CJS 混用 | 已在 `server/Dockerfile` v1.5.1 修复 |
| 坑 5: localhost IPv6 | 已在 `docker-compose.prod.yml` v1.5.1 修复 |
| 坑 6: nginx restart 17 次 | `05-start-stack.sh` 只起 3 服务 · `07-issue-cert.sh` 自动 `rm -sf nginx` |
| 坑 7: cron `-T` + standalone 撞 80 | `08-finalize-nginx.sh` 加 `-T` + 自动切 webroot renewal |

---

## 修改 / 扩展脚本

### 改路径默认值

`lib/common.sh` 顶部的 `: "${COSTRA_ROOT:=...}"` 都可以通过环境变量覆盖：

```bash
COSTRA_ROOT=/opt/costra COSTRA_DOMAIN=other.com ./deploy-all.sh ...
```

### 新增步骤

1. 写 `10-xxx.sh` · 模仿 `09` 结构（顶部 source common.sh + 解析参数 + 主流程）
2. 在 `deploy-all.sh` 的 `STEPS` 数组里加一行 `"10:10-xxx.sh"`
3. 如果有特殊参数透传，在 deploy-all.sh 的 case 分支里加

---

> **维护**：v1.5.1 · 2026-05-26 · 与手册同版本号
> **测试机器**：tlinux 3.3 + Docker 24.x + docker compose v2 (49.235.216.20)
