# Costra 小程序工程骨架（COSTRA-030）

> 家庭共享记账小程序 · MINA + TypeScript + 分包  
> Refs: COSTRA-030, ADR-0004, PRD v0.1

## 1. 技术栈

- 微信原生 MINA + TypeScript（`miniprogram-api-typings`）
- 分包：主包（登录 / 首页 / 记一笔 / 我的）+ `pages-stat/`（统计）+ `pages-family/`（家庭 · 设置 · 隐私）
- Lint：ESLint + Prettier + Husky（pre-commit）+ commitlint（Conventional Commits）
- 最低基础库：**2.32.3**（对齐 PRD NFR）
- 生产 AppID：`wxf8b0d3e3a83f9941`

## 2. 目录结构

```
miniprogram/
  app.ts / app.json / app.wxss / sitemap.json
  pages/           主包 · tabBar 页面 + 登录
    login/  home/  entry/  mine/
  pages-stat/      分包 · 统计（月度）
    month/
  pages-family/    分包 · 家庭 / 设置 / 隐私
    home/  settings/  privacy/
  services/        env · request · auth · storage · sync · flags
  utils/           money · time
  tokens/          设计 Token 桥（同步自 docs/design/tokens.json）
  components/      公共组件（COSTRA-111+ 陆续补齐）
```

## 3. 快速上手

```bash
# 安装依赖（CI 与本地 typecheck/lint 用）
npm install

# 复制私有配置示例
cp project.private.config.json.example project.private.config.json

# 打开微信开发者工具 → 导入项目
# 项目目录：本仓库根目录
# AppID：wxf8b0d3e3a83f9941（或你的体验版 AppID）
```

## 4. 环境切换

环境配置集中在 `miniprogram/services/env.ts`。默认 `dev`，构建脚本可通过替换 `CURRENT_ENV` 常量切换 `staging` / `prod`（CI 中通过 `scripts/mp-ci/build-check.mjs` 的变量注入）。

> ⚠️ **Sprint-0 骨架阶段**：`CURRENT_ENV` 为硬编码 `'dev'`。Sprint-1 COSTRA-108 CI 演练完成后，切换机制收敛为"CI 环境变量 → `__wxConfig.envVersion` 或编译期常量注入"。切换到 staging/prod 前必须手动改此常量或等 COSTRA-108 自动化。

| 环境 | API Base | Mock 登录 | 备案状态 |
|---|---|---|---|
| dev | `http://localhost:8080/v1` | ✅ | 开发工具"不校验合法域名" |
| staging | `https://api-staging.costra.cloud/v1` | ❌ | ICP 下证后可用（D-009） |
| prod | `https://api.costra.cloud/v1` | ❌ | ICP 下证后配入微信白名单（D-009） |

> 🔒 **D-009 锁定**：生产域名 `costra.cloud`，域名源引用见 `docs/devops/domains.md`。**严禁在任何代码中使用 `.costra.app` 等历史域名**；CI（COSTRA-115）会校验 `services/env.ts` 与 OpenAPI `servers` 一致性。

Feature Flag 通过 `services/flags.ts` 读取，当前支持：
- `family_sharing`：家庭共享开关
- `subscribe_msg`：订阅消息开关
- `share_card_variant`：分享卡片 AB 变体

## 4.1 骨架覆盖 vs IA 目标（Sprint-0 锁时刻 → Sprint-X 落地路径）

Sprint-0 骨架仅实现"最小可演示登录闭环"，主包与分包的**完整 IA 页面树**按以下计划逐步落地：

| IA §3 要求页面 | 路由 | 骨架状态 | 落地 Sprint | 关联卡 |
|---|---|---|---|---|
| 启动页 / 授权引导 | `pages/launch/index` | 合并到 `pages/login/index` | Sprint-1 | COSTRA-102 |
| 手机号绑定 | `pages/bind-phone/index` | ❌ 未创建 | Sprint-2 | COSTRA-102 (R2) |
| 首页·流水 | `pages/home/index` | ✅ 占位 | Sprint-1 落业务 | COSTRA-102 |
| 记一笔 | `pages/entry/index` | ✅ 占位 | Sprint-1 落业务 | COSTRA-102 |
| 流水筛选 | `pages/entry-filter/index` | ❌ 未创建 | Sprint-2 | COSTRA-114 |
| 账户管理 | `pages/accounts/index` | ❌ 未创建 | Sprint-2 | COSTRA-111 |
| 账户编辑 | `pages/account-edit/index` | ❌ 未创建 | Sprint-2 | COSTRA-111 |
| 分类管理 | `pages/categories/index` | ❌ 未创建 | Sprint-2 | COSTRA-112 |
| 我的 | `pages/mine/index` | ✅ 占位 | Sprint-1 落业务 | COSTRA-401 |
| 设置 | `pages/settings/index` | ❌ 未创建 | Sprint-2 | COSTRA-402 |
| 关于 & 隐私 | `pages/about/index` | ❌ 未创建 | Sprint-2 | Epic-G |
| 统计总览 | `pages-stat/overview/index` | ✅ 占位（tabBar 入口） | Sprint-3 | COSTRA-501 |
| 月度统计 | `pages-stat/month/index` | ✅ 存在（命名与 IA 略差） | Sprint-3 合并 | COSTRA-501 |
| 家庭面板 | `pages-family/dashboard/index` | ✅ 占位（tabBar 入口） | Sprint-3 | COSTRA-201 |
| 家庭 home | `pages-family/home/index` | ✅ 存在（命名与 IA 略差） | Sprint-3 合并 | COSTRA-201 |
| 设置 / 隐私 | `pages-family/settings/index`、`privacy/index` | ✅ 占位 | Sprint-2 | COSTRA-402 / Epic-G |

**裁决**：
- 骨架期只保留"最小登录闭环 + tabBar 入口 4 页"，其余 **IA 页面作为 Sprint-1~3 逐步落地的工作单**；
- `pages-stat/month` vs `pages-stat/overview`、`pages-family/home` vs `pages-family/dashboard` 的命名差异由 Sprint-3 一次性统一（落 Epic-D/F 时）；
- 本表每个 Sprint 末由 PM-Agent 勾选消除进度。



## 5. 登录闭环（Mock）

启动 → `pages/login/index` → 点击 **一键微信登录**  
→ `wx.login` 取 `code`  
→ `POST /v1/auth/wx-login`（`env.mockLogin=true` 时走本地 Mock）  
→ Token 存入 `wx.storage`（带版本号，`services/storage.ts`）  
→ `wx.switchTab` 跳首页

冷启动检测 `hasValidSession()` → 有效则直接跳首页，无效则回登录页。

## 6. 开发规范

- 所有新代码遵循 **Conventional Commits**（`feat/fix/chore/refactor/docs/test/build/ci/perf` + 作用域）
- 提交作用域枚举：`miniapp | backend | design | devops | qa | docs | api | db | repo`
- 金额统一按 **分（cents）** 存与传，仅在展示时用 `utils/money.ts::formatMoney` 格式化为元
- 时间统一按 **ISO 8601 + Asia/Shanghai**，通过 `utils/time.ts` 处理
- 组件/页面禁止硬编码颜色、圆角、间距，必须读取 `tokens/` 下的 token

## 7. 脚本

| 命令 | 说明 |
|---|---|
| `npm run lint` | ESLint 检查 |
| `npm run lint:fix` | ESLint 自动修复 |
| `npm run typecheck` | `tsc --noEmit` |
| `npm run format` | Prettier 格式化 |
| `npm run test` | （占位，COSTRA-121 接入） |
| `npm run mp:build:check` | miniprogram-ci 编译体积检查（DevOps 线提供） |
| `npm run analyze` | 体积分析（DevOps 线提供） |

## 8. 参考

- `docs/charter.md` · 项目章程
- `docs/PRD.md` · 产品需求
- `.team/decisions/ADR-0004-miniapp-runtime-details.md` · 运行时硬决策
- `docs/design/` · Design 线产出（IA / 设计系统 / tokens / 分享卡片）
- `docs/api/` · Backend 线产出（契约 / 冲突 / 审计）

