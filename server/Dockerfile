# Costra Server · prod Dockerfile（v1.5 · 2026-05-25）
# Multi-stage 构建：deps 层缓存 npm install + final 层装应用
# 基础镜像：node:20-alpine（~50MB · 标准选择）
# 启动方式：tsx 直跑 .ts 源码（不预编译 · 与 server/scripts dev 一致）
# 关联：infra/docker-compose.prod.yml · server.env 通过 docker compose env_file 注入

# ============== Stage 1 · deps（缓存 npm install）==============
FROM node:20-alpine AS deps
WORKDIR /app

# alpine 装 native 模块依赖（pg / argon2 等可能用到）
RUN apk add --no-cache python3 make g++ \
    && rm -rf /var/cache/apk/*

# 仅 copy package*.json · 让 npm install 进 docker layer cache
COPY package.json package-lock.json ./

# 装全部依赖（含 dev · 因为 tsx 在 devDependencies）
# --omit=optional 避开可选依赖减小体积
# --no-audit --no-fund 减少 build 噪音
RUN npm ci --omit=optional --no-audit --no-fund

# ============== Stage 2 · runtime（最终镜像）==============
FROM node:20-alpine AS runtime
WORKDIR /app

# 安全基线：升级 alpine 包 + 装 tini（PID 1 · 防 zombie + 优雅信号传递）
RUN apk add --no-cache tini ca-certificates tzdata \
    && rm -rf /var/cache/apk/*

# 时区（与 docker compose env TZ 配合）
ENV TZ=Asia/Shanghai

# 从 deps 阶段拷过来 node_modules（已编译 · 不需重装）
COPY --from=deps /app/node_modules ./node_modules

# 拷应用源码（注意 .dockerignore 已排除 node_modules / .env / dist 等）
COPY . .

# 非特权用户跑（FU-PROD-NON-ROOT-USER 提前实现）
# alpine node 镜像默认有 node 用户（uid 1000）
RUN chown -R node:node /app
USER node

EXPOSE 8080

# tini 作 PID 1 · 优雅传递 SIGTERM 给 node（容器 stop 时干净退出）
ENTRYPOINT ["/sbin/tini", "--"]

# 启动命令（与 v1.4 §5-A.1 + §5-B.2 一致）
CMD ["node", "--import", "tsx/esm", "src/server.ts"]
