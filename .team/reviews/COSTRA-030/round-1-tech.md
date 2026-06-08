# COSTRA-030 · Round-1 · Review-Agent-Tech

- **被审产物**：`miniprogram/` 小程序工程骨架（app.json / app.ts / services/* / pages/* / tokens/*）
- **被审 Agent**：MiniApp-Agent
- **评审人**：Review-Agent-Tech（独立实例）
- **评审时间**：2026-04-23 20:27
- **Sprint**：Sprint-0 补审
- **轮次**：1
- **强制上下文**：`docs/design/ia.md`、`docs/design/design-system.md`、`server/api/openapi.yaml`、ADR-0004、D-007 / D-008 / D-009

---

## 0. 独立声明

独立实例，依据产物独立评审。

---

## 1. 评分卡（30 分制）

| 维度 | 满分 | 得分 | 说明 |
|---|---|---|---|
| 工程骨架完整度（入口/分包/tabBar）| 6 | **3** | app.ts/app.json/sitemap 齐；**tabBar 3 项 vs IA 定义 4 项** —— P0 不一致 |
| 登录闭环 Mock 可演示 | 6 | **5** | initAuth → token 存储 → reLaunch login OK；`refresh` 函数名 `refreshFn` 与 app.ts 调用 `refresh()` 不一致（见 P1-1）|
| 服务层抽象（env / request / auth / sync）| 6 | **5** | 6 个服务文件清晰；`env.ts` 域名硬编码且与 D-009 不符（见 P0-2）|
| Design Token 桥接 | 6 | **5** | `tokens/index.ts` 桥存在；主体字样硬编码风险（见 P1-2）|
| 与 ADR-0004 / IA 一致性 | 6 | **3** | 分包名 `stat/family` vs IA `pages-stat/pages-family` OK；但**页面数量差异极大**（pages 4 个 vs IA 11 个主包页）需说明是否骨架期合理（见 P1-3）|
| **合计** | **30** | **21** | |

---

## 2. Findings

### 🔴 P0（阻断 / 必改）

- **P0-1 · app.json tabBar 只有 3 项，IA 定义是 4 项（记账/家庭/统计/我的）**
  - **位置**：`miniprogram/app.json` L43-52
  - **当前**：`首页 / 记一笔 / 我的` 三项
  - **IA 定义**：`docs/design/ia.md` §2 冻结为 `记账 / 家庭 / 统计 / 我的` 四项，且分别指向 `pages/home/index` / `pages-family/dashboard/index` / `pages-stat/overview/index` / `pages/me/index`。
  - **影响**：
    - tabBar 结构**直接影响冷启动体验**，Sprint-1 无法按 IA 预期跑端到端；
    - 分包预下载规则（`preloadRule`）依赖 tabBar 路由，当前 preloadRule 指 `pages/home/index → stat / pages/mine/index → family`，**与 IA §2 的预下载规则（`pages/home/index → [pages-stat, pages-family]`）不同**；
    - MiniApp-Agent 与 Design-Agent 在 Sprint-0 锁时刻存在 **未对齐** 事实，必须 Round-2 前对齐。
  - **建议**：
    - 按 IA §2 重写 tabBar（4 项）与 preloadRule；
    - 页面路径按 IA 落（`pages-family/dashboard/index` 等替换当前 `pages-family/home/index`）。
  - **Sprint-1 必修**：D1 前闭合。

- **P0-2 · `services/env.ts` 域名与 D-009 决议不符**
  - **位置**：`miniprogram/services/env.ts` L27 / L37
  - **当前**：`https://staging.costra.app/v1` / `https://api.costra.app/v1`
  - **D-009 锁定**：生产域名 `costra.cloud`，API 入口 `api.costra.cloud`。
  - **影响**：与 OpenAPI `servers` 一致性 CI 校验（COSTRA-115）会失败；真机调试指向 `costra.app` 无法通过合法域名校验。
  - **建议**：改为：
    - dev: `http://127.0.0.1:3000/v1`（保持）
    - staging: `https://api-staging.costra.cloud/v1`
    - prod: `https://api.costra.cloud/v1`
  - **Sprint-1 必修**：D1 前闭合。

### 🟠 P1

- **P1-1 · `app.ts` 调用 `token.refresh?.()` 但 `auth.ts` 暴露的是 `refreshFn`**
  - **位置**：`miniprogram/app.ts` L42 `(token as any).refresh?.()` vs `services/auth.ts` L17-19 `refreshFn(): Promise<void>`
  - **问题**：方法名不一致。`(token as any).refresh` 永远 undefined，`onShow` 的自动续签逻辑**从未被触发**。
  - **建议**：改为 `token.refreshFn()`，并**移除 `as any`**（类型声明已存在）。
  - **影响**：Mock 阶段表现不出（Mock token 30 天过期），但真机一旦 access 接近 2h 会直接 401 跳登录。

- **P1-2 · `services/env.ts` / `app.wxss` / tokens/ 等缺 D-008 要求的 `subject` 配置**
  - **位置**：全局
  - **问题**：D-008（主体策略：个人先行、公司兼容）要求新建 `miniprogram/config/subject.ts`，导出 `SUBJECT_NAME / SUBJECT_TYPE / ICP_NUMBER / CONTACT_EMAIL / PRIVACY_EFFECTIVE_DATE`。**当前骨架完全未建该文件**。
  - **建议**：COSTRA-112 已立 Sprint-1 卡，但骨架 Round-2 可以先建文件占位（`export const SUBJECT_NAME = '待填'`）防止 Sprint-1 各页引用时报 import error。

- **P1-3 · 主包页面只 4 个（login/home/entry/mine），IA §3.1 主包是 11 页**
  - **位置**：`miniprogram/pages/`
  - **问题**：IA 要求主包页：launch / bind-phone / home / entry-edit / entry-filter / accounts / account-edit / categories / me / settings / about（11 页）；当前只有 4 个。
  - **判定**：**骨架期只做"最小可演示闭环"是可接受的**（Sprint-0 AC-2 Mock 登录闭环），但 README §2 目录结构声明"pages/ 主包 · tabBar 页面 + 登录"过于笼统，**需在 README 加"骨架期 vs 完整 IA 的差距清单"**，列出未落地的 7 页及其对应 Sprint。
  - **建议**：README 补一段"Sprint-0 骨架覆盖 vs IA 目标"对照表，明确 bind-phone / entry-filter / accounts / account-edit / categories / settings / about 在哪个 Sprint 落地。

- **P1-4 · `env.ts` 中 `CURRENT_ENV` 硬编码 'dev'，构建脚本替换机制未实证**
  - **位置**：`services/env.ts` L48
  - **问题**：注释说"由构建脚本替换"，但无实际脚本可证（DevOps COSTRA-040 占位）。一旦打包 staging/prod，读到的仍是 dev。
  - **建议**：要么在 README 明确"当前需手动改 CURRENT_ENV，Sprint-1 COSTRA-108 演练后自动化"；要么改用 `__wxConfig.envVersion`（微信官方方式）判断。

### 🟡 P2

- **P2-1 · `tokens/` 与 `docs/design/tokens.json` 同步机制**
  - README §2 说"tokens/ 设计 Token 桥（同步自 docs/design/tokens.json）"，但未见实际同步脚本（或 CI 校验）。Design-Agent 改 tokens.json 后，miniprogram/tokens/ 是否自动更新？建议加 `npm run tokens:sync`。

- **P2-2 · `auth.ts` 的 `getSession` 返回 `user: null`，TODO 指向 COSTRA-11x**
  - 代码层 TODO 合理。但 TODO 实际对应卡号应确定（COSTRA-111? COSTRA-112?），避免跨 Sprint 失联。

- **P2-3 · `refreshToken` 函数在 auth.ts 尾部（未展开读）**
  - 按文件截断后未读完；Round-2 需补读 auth.ts 后半部（refreshToken 实现）与 request.ts 的 401 自动重试逻辑。

- **P2-4 · `sitemap.json` 未读到内容**
  - 建议确认 `desc` 字段设为"允许被微信搜索"（MVP 默认是 OK）。

- **P2-5 · `project.config.json.example` 未在仓库出现**
  - README §3 引导 `cp project.private.config.json.example project.private.config.json`，但仓库里没有 .example 文件。新人 clone 后无法完成步骤 2。建议补一份模板文件。

---

## 3. Verdict

> **REVISE**

**原因**：P0-1 tabBar/IA 不一致、P0-2 域名漂移，都是 **Sprint-1 D1 阻断项**。P1-1 refreshFn 调用 bug 虽然隐蔽但真机必发。

**自动循环决策**：round 1 < 5，P0 级问题可修复（非红线）→ **进入自动 Round 2**。

---

## 4. 对 MiniApp-Agent 的执行提示

1. **P0-1 最优先**：按 IA §2 重写 `app.json`（4 tab + 新 preloadRule + 4 页入口占位）；
2. P0-2：改 3 行域名；
3. P1-1：`refresh` → `refreshFn`，移除 `as any`；
4. P1-2：占位 `config/subject.ts`（COSTRA-112 细落）；
5. P1-3：README 加差距对照表；
6. P1-4：CURRENT_ENV 机制说明。

---

## 5. 元信息

- 评审耗时：约 20 分钟
- 独立判定：✅
- Human 介入：否（P0 可由 MiniApp 修）

**Refs**: COSTRA-030 · **Impacts**: `miniprogram/app.json`、`services/env.ts`、`app.ts`、`README.md`
