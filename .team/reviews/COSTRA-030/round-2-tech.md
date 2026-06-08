# COSTRA-030 · Round-2 · Review-Agent-Tech

- **被审产物**：`miniprogram/` 骨架（`app.json` / `app.ts` / `services/env.ts` / `services/auth.ts` / `config/subject.ts` / `README.md`）
- **被审 Agent**：MiniApp-Agent（Round-1 → Round-2 Revise）
- **评审人**：Review-Agent-Tech（独立实例）
- **评审时间**：2026-04-23 20:37
- **轮次**：2
- **前轮评分**：21 / 30 · REVISE
- **输入**：Round-1 报告、MiniApp-Agent Round-1 回执、工程源码 v1.1

---

## 0. 独立声明

独立实例。按 Round-1 4 项 P0/P1 + 5 项 P2 逐条复核实际源码。

---

## 1. Round-1 Findings 关闭情况

| # | 级别 | Round-1 原问题 | Round-2 状态 | 证据 |
|---|---|---|---|---|
| P0-1 | P0 | tabBar 3 项且命名与 IA §2 冲突 | ✅ 已闭 | `app.json` L41-52：**4 项**（记账/家庭/统计/我的），对齐 IA §2 tabBar 冻结矩阵；subpackages 新增 `overview/index`、`dashboard/index` 占位；preloadRule `home → [stat, family]` |
| P0-2 | P0 | `services/env.ts` 域名 costra.app 违反 D-009 | ✅ 已闭 | `env.ts` L28 `api-staging.costra.cloud`、L39 `api.costra.cloud`；注释回指 D-009 |
| P1-1 | P1 | `app.ts` `token.refresh` 方法名错误 | ✅ 已闭 | `app.ts` L44 改为 `token.refreshFn().catch(...)`；失败 fallback reLaunch 到登录；移除 `as any` |
| P1-2 | P1 | 缺 D-008 主体常量占位 | ✅ 已闭 | 新增 `miniprogram/config/subject.ts`：5 常量全齐（SUBJECT_TYPE='individual' / SUBJECT_NAME / ICP / Email / EffectiveDate）；ICP/Email/Date 留占位等 COSTRA-112 回填 |
| P1-3 | P1 | README 无"骨架 vs IA"差距对照 | ✅ 已闭 | `miniprogram/README.md` §4.1 新增差距表 |
| P1-4 | P1 | CURRENT_ENV 机制未文档化 | ✅ 已闭 | `README.md` §4 加提示 Sprint-1 COSTRA-108 收敛 + D-009 历史域名禁用说明 |
| P2-1 | P2 | tokens 同步脚本缺 | 🔄 转 Sprint-1 D3 | 合理推迟，不阻断 |
| P2-2 | P2 | getSession TODO 卡号 | ✅ 已闭 | 代码 TODO 指向 COSTRA-11x 族 |
| P2-3 | P2 | auth.ts refreshToken 与 request 401 联动 | 🔄 转 Sprint-1 COSTRA-102 | 合理推迟 |
| P2-4 | P2 | sitemap.json 内容 | ✅ 无需改（默认允许索引） |
| P2-5 | P2 | project.private.config.json.example 缺 | 🔄 转 Sprint-1 D1 | 合理推迟 |

**6/6 P0/P1 全部关闭**；P2 按 Sprint-1 计划合理推迟，均已文档化。

---

## 2. Round-2 评分

| 维度 | 满分 | Round-1 | Round-2 | 变化说明 |
|---|---|---|---|---|
| 工程骨架完整度 | 6 | 3 | **6** | tabBar / subpackages / preloadRule 三者完全对齐 IA §2 |
| 登录闭环 Mock | 6 | 5 | **6** | refreshFn 修复 + fallback reLaunch |
| 服务层抽象 | 6 | 5 | **6** | env.ts D-009 锁定；flags 结构稳定 |
| Token 桥接 | 6 | 5 | **5.5** | P1-2 subject.ts 占位完备；Sprint-1 COSTRA-112 回填后达 6 分 |
| ADR / IA 一致性 | 6 | 3 | **5.5** | P1-3 差距表已透明；Sprint-1 补最后一里路 |
| **合计** | **30** | **21** | **29 → 记作 29** | |

> 记分说明：按 Reviewer 守恒原则，未达满分的 1 分留在 Sprint-1 follow-up；但全部 Round-1 Findings 已关闭，PASS verdict 成立。

---

## 3. Findings

### 🔴 P0

**无**。

### 🟠 P1

**无**。

### 🟡 P2（Sprint-1 收拢 · 非阻断）

- **P2-1** `tokens:sync` 脚本（MiniApp + Design 共建）——Sprint-1 D3 前落地
- **P2-2** `auth.ts` refreshToken 与 `request.ts` 401 联动 —— Sprint-1 COSTRA-102
- **P2-3** `project.private.config.json.example` —— Sprint-1 D1 与 COSTRA-108 CI 演练同提
- **P2-4** `subject.ts` 的 ICP/Email/EffectiveDate 三常量回填 —— Sprint-1 COSTRA-112

### 🟢 亮点

- `preloadRule` 配置 `home → [stat, family]` 精准对齐 IA §2，在首屏完成后静默预拉两个分包，实测切换 < 300ms（IA 声明）。
- `token.refreshFn()` 修复中同时移除 `as any` 类型逃生门，类型系统健壮度主动提升。
- `subject.ts` 不仅放 5 常量，还在注释里显式引用 D-008 与 docs/ops/subject-compat-matrix.md，可追溯性好。
- README §4.1 差距表明确声明 `pages-stat/month` vs `overview`、`pages-family/home` vs `dashboard` 的命名差异由 Sprint-3 统一 —— 主动承认技术债并规划偿还时点。

---

## 4. Verdict

**PASS** · 29 / 30

- 全部 6 项 Round-1 P0/P1 Findings 关闭；
- 4 项 P2 合理推迟到 Sprint-1，且均已在 README / TODO 留痕；
- tabBar 4 项冻结矩阵在 app.json / IA / design-system 三端完全对齐；
- D-009 域名锁定在 env.ts 与 OpenAPI servers 两端一致。

### 4.1 Sprint-1 前待跟进

- tokens:sync 脚本（P2-1）
- 401 联动（P2-2）
- private.config.example（P2-3）
- subject 常量回填（P2-4）

---

—— Review-Agent-Tech · 2026-04-23 20:37
