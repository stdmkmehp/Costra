# Costra · Secrets 与环境变量清单

> Refs: COSTRA-040 · `.env.example` · `.github/workflows/*.yml`

本文是**唯一的** Secrets 真源。任何新增敏感配置必须先在此文档登记，再在代码中引用。

---

## 1. 分类

| 分类 | 注入位置 | 说明 |
|---|---|---|
| **repo variable** | Settings → Secrets and variables → Actions → Variables | 非敏感（AppID、API Base、区域） |
| **repo secret** | Settings → Secrets and variables → Actions → Secrets | 敏感（robot key、AppSecret、DB 密码） |
| **environment secret** | Settings → Environments → `production` → Secrets | 仅 release 可读 |
| **local .env** | `cp .env.example .env` | 开发机，不入库 |

---

## 2. 清单

### 2.1 小程序侧

| Key | 类型 | 作用 | 状态 |
|---|---|---|---|
| `MP_APPID` | repo variable | 生产小程序 AppID | ✅ `wxf8b0d3e3a83f9941` |
| `MP_APPID_STAGING` | repo variable | 体验版 AppID | ⏳ 待 Human 补 |
| `MP_CI_KEY_PROD` | repo secret | 生产 robot key（pem 内容） | ⏳ 待 Human |
| `MP_CI_KEY_STAGING` | repo secret | 预发 robot key | ⏳ 待 Human |
| `MP_CI_KEY_PATH` | local .env | 本地开发使用的 key 路径 | 本地 |
| `MP_PROJECT_PATH` | local .env | 小程序项目根 | 本地 |
| `MP_ENV` | local / CI | `staging` / `production` | 动态 |

### 2.2 后端侧

| Key | 类型 | 作用 | 状态 |
|---|---|---|---|
| `SERVER_API_BASE_PROD` | repo variable | 生产后端基址 | ⏳ 待 ICP + 域名 |
| `SERVER_API_BASE_STAGING` | repo variable | 预发后端基址 | ⏳ 待 ICP + 域名 |
| `WX_APP_SECRET` | repo secret | 微信 AppSecret（`wx.login` code2Session 用） | ⏳ 待 Human |
| `POSTGRES_PASSWORD` | env secret (production) | 生产 PG 密码 | ⏳ 待 Human |
| `SESSION_SECRET` | env secret | JWT/Session 签名密钥（≥ 32B 随机） | ⏳ 待 Human |
| `JWT_ISSUER` | repo variable | `costra` | ✅ 默认 |
| `REDIS_PASSWORD` | env secret | 可选（Sprint-1 接入） | 🔵 |

### 2.3 第三方（Sprint-1/2）

| Key | 状态 |
|---|---|
| `SENTRY_DSN` | 🔵 Sprint-2 |
| OSS（MinIO / COS） `OSS_ACCESS_KEY` / `OSS_SECRET_KEY` | 🔵 Sprint-1 |

---

## 3. 与 `.env.example` 的契约

`.env.example` 中出现的**所有 key 必须在本表登记**；反之本表中 repo-level 的 key 也应在 `.env.example` 里以空值占位出现（便于开发者自检）。CI 每次 `pr-check` 会打印 `diff <(sort .env.example) <(sort docs/devops/secrets.md)` 提醒差异（Sprint-1 接入）。

---

## 4. 轮换策略（占位）

- robot key：每 180 天轮换一次
- `SESSION_SECRET`：重大事件（员工离职、疑似泄露）立即轮换，历史 JWT 强制失效
- `POSTGRES_PASSWORD`：每 365 天；数据库用户密码强制 12+ 位包含大小写数字符号

---

## 5. 审计

- 谁读了 secret：由 GitHub Actions 审计日志记录
- 谁改了 secret：Settings → Audit log

---

## 6. 激活时机（Checklist）

跟随 `docs/devops/ci-cd.md §激活清单`。Human 补齐后请在对应 Key 的"状态"列从 ⏳ 改为 ✅ 并 commit，提交信息：`chore(devops): activate <KEY_NAME>`。
