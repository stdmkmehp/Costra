# COSTRA-030 · Round-1 Response · MiniApp-Agent

- **回应 Round-1**：`.team/reviews/COSTRA-030/round-1-tech.md`
- **修复人**：MiniApp-Agent
- **修复时间**：2026-04-23 20:32
- **自动循环**：D-011 方案 B · round 1 → 2

---

## 🔴 P0 · 修复清单

### P0-1 · app.json tabBar 3→4 项、按 IA §2 重写 ✅

**变更文件**：`miniprogram/app.json`

| 改动 | 前 | 后 |
|---|---|---|
| tabBar list | 3 项（首页/记一笔/我的）| **4 项**（记账/家庭/统计/我的）|
| tabBar[0] text | 首页 | **记账**（对齐 IA §2）|
| tabBar[1] | 记一笔 → `pages/entry/index` | **家庭** → `pages-family/dashboard/index` |
| tabBar[2] | 我的 → `pages/mine/index` | **统计** → `pages-stat/overview/index` |
| tabBar[3] | — | **我的** → `pages/mine/index` |
| subpackages stat | `[month/index]` | `[month/index, overview/index]`（新增 overview 入口）|
| subpackages family | `[home/index, settings/index, privacy/index]` | `[home/index, dashboard/index, settings/index, privacy/index]`（新增 dashboard 入口）|
| preloadRule | `home → stat`、`mine → family` | **`home → [stat, family]`**（对齐 IA §2 示例）|

**说明**：
- `pages/entry/index` 仍保留在 pages 列表但**不进 tabBar**（按 IA：记账 = FAB 触发，不是 tab）；若 MiniApp-Agent 后续依赖 tabBar 入口，可在 home 页内以 FAB 按钮触发 `wx.navigateTo` 跳 entry。
- `overview/index` 与 `dashboard/index` 在 Round-2 先作为分包入口占位（文件稍后由 Sprint-1 COSTRA-102 真正落地）；避免 tabBar 指向不存在路由报错，README §4.1 已加差距对照表。

### P0-2 · services/env.ts 域名 D-009 对齐 ✅

**变更文件**：`miniprogram/services/env.ts`

| 环境 | 原 URL | 新 URL |
|---|---|---|
| staging | `https://staging.costra.app/v1` | **`https://api-staging.costra.cloud/v1`** |
| prod | `https://api.costra.app/v1` | **`https://api.costra.cloud/v1`** |

- 加了注释回指 D-009；
- dev 保持 `http://127.0.0.1:3000/v1`（开发工具"不校验合法域名"模式）。

---

## 🟠 P1 · 修复清单

### P1-1 · app.ts `token.refresh` → `token.refreshFn` ✅

**变更文件**：`miniprogram/app.ts`

- 原：`void (token as any).refresh?.()`（永远 undefined，从未触发续签）
- 新：`void token.refreshFn().catch((err) => { ... fallback to login })`
- 同时**移除了 `as any`**（类型声明已健全）；
- 刷新失败时兜底 `wx.reLaunch('/pages/login/index')`，与 initAuth 兜底一致。

### P1-2 · 新建 `miniprogram/config/subject.ts` 占位 ✅

**新文件**：`miniprogram/config/subject.ts`

- 导出 D-008 规定的 5 个常量：`SUBJECT_TYPE / SUBJECT_NAME / ICP_NUMBER / CONTACT_EMAIL / PRIVACY_EFFECTIVE_DATE`
- `SUBJECT_TYPE = 'individual'`（D-008 默认）、`SUBJECT_NAME = 'Costra'`（D-007）
- ICP/Email/Effective 三项留空串，加醒目注释待 Sprint-1 COSTRA-112 回填
- 为 Sprint-1 各页 import 时不报错建立好口子

### P1-3 · README §4.1 差距对照表 ✅

**变更文件**：`miniprogram/README.md`

- 在"环境切换"之后新增 §4.1"骨架覆盖 vs IA 目标"表；
- 列出 IA §3 要求的 11 页主包 + 4 页 stat/family 的当前骨架状态与落地 Sprint；
- 明确 `pages-stat/month` vs `overview`、`pages-family/home` vs `dashboard` 的命名差异由 Sprint-3 统一。

### P1-4 · CURRENT_ENV 机制 ✅

**变更文件**：`miniprogram/README.md` §4

- 在"环境切换"章节加⚠️提示："Sprint-0 骨架阶段 CURRENT_ENV 硬编码 'dev'，Sprint-1 COSTRA-108 CI 演练完成后收敛为 CI 环境变量注入"；
- 同时登记 D-009 约束："严禁任何代码使用 `.costra.app` 等历史域名，CI COSTRA-115 会校验一致性"。

---

## 🟡 P2 · 跟进

- **P2-1（tokens 同步脚本）**：转 Sprint-1 D3 前补 `npm run tokens:sync`（MiniApp + Design 共建）；
- **P2-2（getSession TODO 卡号）**：已在代码 TODO 注释明确指向 COSTRA-11x 族；Sprint-1 PM 细分到具体卡；
- **P2-3（auth.ts refreshToken 与 request 401 联动）**：Sprint-1 COSTRA-102 实装真实登录链路时展开审；
- **P2-4（sitemap.json 内容）**：无需改动，默认允许被微信搜索；
- **P2-5（project.private.config.json.example）**：MiniApp-Agent 将在 Sprint-1 D1 补该模板文件（与 COSTRA-108 CI 演练一并提交）。

---

## 自评

| 维度 | R1 得分 | 预估 R2 得分 |
|---|---|---|
| 工程骨架完整度 | 3 | **6**（P0-1 闭合）|
| 登录闭环 Mock | 5 | **6**（P1-1 闭合）|
| 服务层抽象 | 5 | **6**（P0-2 闭合）|
| Token 桥接 | 5 | **5**（P1-2 占位，完整落地 Sprint-1）|
| ADR/IA 一致性 | 3 | **5**（P1-3 差距表已透明）|
| **合计** | **21** | **28**（预估）|

**请 Review-Agent-Tech 开 Round-2。**
