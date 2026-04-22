# 任务派单 · COSTRA-030 小程序工程骨架（MINA + TS + 分包 + ESLint）

> ✅ **DONE**（Orchestrator `execute-now` 代笔落地 · 2026-04-21 17:45）
> 产物回链：`miniprogram/app.{ts,json,wxss}` · `miniprogram/sitemap.json` · `miniprogram/pages/{login,home,entry,mine}/` · `miniprogram/pages-stat/month/` · `miniprogram/pages-family/{home,settings,privacy}/` · `miniprogram/services/{env,storage,request,auth,sync,flags}.ts` · `miniprogram/utils/{money,time}.ts` · `miniprogram/tokens/{index.ts,tokens.json}` · 根工程：`project.config.json` · `project.private.config.json.example` · `tsconfig.json` · `package.json` · `.eslintrc.json` · `.prettierrc.json` · `commitlint.config.js` · `.husky/{pre-commit,commit-msg}` · `.gitignore` · `miniprogram/README.md`
> 闸门：**G2/G3 后可验证**（用微信开发者工具导入仓库根即可跑 Mock 登录闭环）
> 备注：初版 `app.json` subpackages 路径误写 `dashboard/invite`，已修正为 `month/settings/privacy` 与实际目录对齐。

---

- **Owner**: MiniApp-Agent
- **Priority**: P0
- **派发时间**: 2026-04-21 15:29（Orchestrator）
- **完工时间**: 2026-04-21 17:00（Orchestrator 代笔）
- **依赖**: 生产 AppID `wxf8b0d3e3a83f9941` ✅、`ADR-0004` §2 分包 / §3 Token / §7 Flag、Design 产物可延后替换为 Token 占位
- **产物路径**: `miniprogram/` 目录、`project.config.json`、`project.private.config.json.example`
- **预计工期**: 1 个工作日

---

## 1. 目标

搭起**一次性通过微信开发者工具编译、能跑通 `wx.login` Mock 闭环**的工程骨架，后续所有 Epic 在此之上增量。

## 2. 必须包含的脚手架能力

- 原生 MINA 框架 + **TypeScript**（自带 miniprogram-api-typings）
- **分包配置**：主包 `pages/`（登录、首页、记一笔、我的）；分包 `pages-stat/`（统计）、`pages-family/`（家庭）
- **ESLint + Prettier + Husky**（pre-commit 检查 + Conventional Commits 校验，可用 commitlint）
- **请求层封装**：统一 baseURL、超时、错误码、Token 自动续签（对齐 ADR-0004 §3）
- **wx.storage 封装**：带版本号 + LRU（占位，COSTRA-121 落细）
- **Feature Flag 读取**：`flags.ts` 从 `env.{dev,staging,prod}.json` 读
- **登录闭环 Mock**：`wx.login → POST /v1/auth/wx-login（Mock 返回 Token）→ wx.storage 落盘 → 跳首页`
- **体积分析脚本**（`npm run analyze`，可用 `miniprogram-ci` 本地分析）

## 3. 验收标准（AC）

### AC-1 工程结构
- [ ] 目录结构：
  ```
  miniprogram/
    pages/ (tabBar 页面 + 登录)
    pages-stat/
    pages-family/
    components/
    services/ (request, auth, storage, sync)
    utils/
    tokens/ (设计 token 占位，从 design-system 同步)
    app.ts, app.json, app.wxss, sitemap.json
  ```
- [ ] `app.json` 的 `subpackages` 配置正确
- [ ] **主包体积 ≤ 1.5MB** 初始值（空骨架应远低于此）

### AC-2 登录闭环跑通
- [ ] 微信开发者工具能编译、预览、真机调试（使用 AppID `wxf8b0d3e3a83f9941`）
- [ ] 启动即调 `wx.login`，调 Mock 接口（暂用本地 mock，等 Backend-Agent 的 OpenAPI 冻结后切真实）
- [ ] Token 正确存入 `wx.storage`，冷启动能自动续期

### AC-3 工程卫生
- [ ] ESLint 无 error；pre-commit 钩子生效
- [ ] Conventional Commits lint（commitlint-config-conventional）
- [ ] `README.md` 写清：如何安装、如何导入开发者工具、如何切换环境

### AC-4 工程约束
- [ ] 涉及的微信 API 在注释中附官方文档链接
- [ ] 敏感文件（`project.private.config.json`）列入 `.gitignore`，只提交 `.example`
- [ ] 提交：`feat(miniapp): project skeleton with ts + subpackages + eslint`
- [ ] `Refs: COSTRA-030, ADR-0004`

## 4. 兼容性要求（来自 PRD NFR）
- 基础库 ≥ 2.32.3；覆盖近 1 年微信客户端
- 首屏 TTI ≤ 2s（骨架阶段必须先量一次 baseline）

## 5. 完成时动作（同 COSTRA-010 §5）

**特别注意**：工程骨架初次可运行 = 工程约束 §2.1 触发条件 4，**必须单独产生一次提交**，不能与后续 Story 提交混在一起。
