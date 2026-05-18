# D-023 · prod 入口临时回归根域 `costra.cloud` · 子域搁置至 Phase-2

> **日期**：2026-05-18
> **发起人**：Human
> **登记人**：Orchestrator
> **状态**：Approved（当场生效）
> **关联**：D-009 §2.1（域名策略 · 渐进式启用补丁）/ R-013（已关闭）/ R-019（公安联网备案 30 日窗口）/ COSTRA-107（ICP 备案）

> 📌 **ID 占用说明**：原派单使用编号 **D-021**，但 D-021 已被 `D-021-d-017-v3-cross-version-precheck.md`（D-017 v3 升级定稿 · 2026-05-09）占用，D-022 已被 `D-022-review-tech-runtime-dimension.md`（review-tech 评分表 v2.0 · 2026-05-09）占用。按决策登记单调递增原则使用 **D-023**（参照 `.team/risks.md` R-014→R-019 同款占用顺延先例）。

> 📌 **本决议性质**：**非 supersede D-009**。D-009 §2.1 表格中 prod 行原本就是 `costra.cloud`，子域 `dev.* / stg.* / api.*` 在 D-009 §2.1 列为 🟡「建议」状态。本决议是 D-009 §2.1 表格的「**渐进式启用补丁**」——把子域从 🟡「建议」临时下调到 ⚪「Phase-2 启用」，prod 入口先用根域跑通端到端验收。子域规划保留不删除。

---

## §1 背景

### §1.1 ICP 下证事实（2026-05-13）

- 小程序：**沪ICP备2026017253号-1X**
- 后端服务：**沪ICP备2026017253号-2**（域名 `costra.cloud` · IP `49.235.216.20`）
- 备案主体：上海
- 详见 `docs/legal/compliance-registry.md` v0.1（PM-Agent 维护的合规事实 SSOT）

### §1.2 子域架构在 ICP 下证后部署链路上的真实摩擦

D-009 §2.1 子域规划（`api.costra.cloud` / `api-staging.costra.cloud` / `dev.costra.cloud` / `stg.costra.cloud`）在 ICP 备案受理期是合理的设计假设，但在备案下证后立刻进入 prod 验收阶段时，引入了部署链路上的多层依赖：

1. **DNS 层**：腾讯云后台需逐条创建子记录（A/CNAME），每条记录 TTL 生效 + 解析回源验证
2. **SSL 层**：每个对外子域需独立申请 Let's Encrypt 证书（或腾讯云免费 DV 证书），并配置 nginx server_name 与证书路径映射
3. **nginx 层**：多 server_name 段配置 + 反向代理回源 + 健康检查路径区分

这三层依赖对**首次 prod 端到端验收**而言是不必要的——prod 入口的核心价值是「**让小程序经微信白名单可达 server 并跑通完整业务链路**」，而非「子域分流架构本身」。

### §1.3 决策动机

**尽快跑通 prod 端到端验收**：把 prod 入口先固定在 ICP 下证主域 `costra.cloud`，跳过子域架构的 DNS+SSL+nginx 多层依赖，让小程序「服务器域名」白名单、公安联网备案、Sprint-2 提审前真 staging 实测三件事**最短路径达成**。子域架构的真实价值（staging 与 prod 隔离 / WebSocket 推送 / CDN 静态资源拆分 / 多并行开发分支）等到具体触发条件出现时再重启立卡。

---

## §2 决议

### §2.1 prod 入口临时回归根域

| env | apiBaseUrl | 状态 | 备注 |
|---|---|---|---|
| prod | `https://costra.cloud/v1` | 🟢 D-023 生效 · 与 ICP 下证主域一致 | 原 D-009 §2.1 prod 行就是 `costra.cloud`，本决议只是显式取消子域 `api.*` 的「建议」 |

prod 入口与 ICP 下证主域字面量保持一致，无需独立子域记录。微信小程序「服务器域名」白名单填 `https://costra.cloud`。

### §2.2 staging env 名保留 · apiBaseUrl 临时复用 prod URL

为保持代码骨架（`miniprogram/services/env.ts` 四环境枚举 / `server/api/openapi.yaml servers` 多 server URL 矩阵 / CI 三方对账规则）**结构不破坏**，staging env 名保留，但 apiBaseUrl 临时复用 prod URL：

```ts
// miniprogram/services/env.ts（示意 · 由 MiniApp-Agent 同轮交付）
export const ENV_API_BASE_URL: Record<Env, string> = {
  local:   'http://localhost:8080/v1',
  dev:     'http://49.235.216.20:8080/v1',
  staging: 'https://costra.cloud/v1', // D-023 临时复用，子域启用时切回 https://api-staging.costra.cloud/v1
  prod:    'https://costra.cloud/v1', // D-023
};
```

**复用边界注解强制规约**：所有 staging 字段处必须保留显式注释 `// D-023 临时复用，子域启用时切回 ...`，方便子域重启时精确回切（防止注释漂移导致回切遗漏）。

### §2.3 子域搁置（不删除）· 状态从 🟡 改 ⚪

`infra/wechat/domains.md §1` 矩阵中 4 条子域的 status 列从 🟡「建议」/「待启用」改为 ⚪「Phase-2 启用」：

| 子域 | D-009 原状态 | D-023 新状态 | 触发重启条件（详见 §2.4） |
|---|---|---|---|
| `dev.costra.cloud` | 🟡 待 DevOps 创建 DNS 子记录 | ⚪ Phase-2 启用 | (d) 多并行 Sprint-2+ 开发分支需要公开联调 |
| `stg.costra.cloud` | 🟡 Sprint-2 末启用 | ⚪ Phase-2 启用 | (a) staging 环境实际需要与 prod 隔离 |
| `api.costra.cloud` | 🟡 ICP 下证后启用 | ⚪ Phase-2 启用 | (a) 同上 / 默认 prod 进 §2.4 重启候选 |
| `api-staging.costra.cloud` | 🟡 Sprint-2 末启用 | ⚪ Phase-2 启用 | (a) 同上 |

> ⚪ 圆点专门用于「**搁置 / 未启用**」语义，与 🟡「**短期待办 / 观察**」语义区分。规划文字保留不删除——子域规划本身仍是合理设计假设，只是当前不进入实施期。

### §2.4 重启子域的触发条件（任一满足即重新立卡）

| 触发条件 | 优先级 | 重启子域 | 备注 |
|---|---|---|---|
| **(a)** staging 环境实际需要与 prod 隔离（如 DB / 数据集 / 灰度名单 / 实验 SDK 不同版本） | P1 | `stg.*` + `api-staging.*` | 当 R-020「微信白名单 staging 边界模糊」从 🟡 升 🟠 时强制触发 |
| **(b)** WebSocket 订阅消息推送上线（charter §订阅消息能力 / Sprint-3+ Epic-D 家庭共享主线）需要独立 WS 域名 | P0 | 新增 `ws.costra.cloud`（不在 D-009 原规划，需新立 ADR 补） | 微信 `connectSocket` 白名单与 `request` 白名单分开管理 |
| **(c)** CDN 静态资源拆分需要独立域名做缓存策略（小程序分包资源 / 大尺寸图片素材 / 共享图床） | P2 | 新增 `static.costra.cloud`（不在 D-009 原规划） | Sprint-3+ 或上线观察期才会触发 |
| **(d)** 多套并行的 Sprint-2+ 开发分支需要 `dev.costra.cloud` 公开联调 | P2 | `dev.*` | 单分支开发期用「不校验合法域名」模式即可（D-009 §2.3 方案 A） |

> 💡 **触发即立卡**：任一条件满足时由 Orchestrator + DevOps + PM 联合立卡，新决议号码顺延（候选 D-024 / D-025 ...），重启时按各子域具体 DNS+SSL+nginx 三件套交付清单实施，不需要再走 D-009 全流程。

### §2.5 与 D-009 的兼容关系（明示）

- **D-009 §2.1 表格**：保持原文不动（决策不可变性）。本决议仅作为 D-009 §2.1 的「渐进式启用补丁」存在。
- **D-009 §2.2 开发服务器用途边界 / §2.3 备案期间过渡方案 / §2.4 安全基线 / §2.5 工程配置约束 / §3 派生任务 / §4 风险变更**：全部不变。
- **D-009 §2.6 DNS 子记录规划**（如有）：进入"暂缓执行"语义，DevOps-Agent 不主动在腾讯云后台创建子记录。

---

## §3 影响范围

> 📎 本节仅做**清单层登记**，具体 diff 由本团队 4 agent 同轮并行交付，不在 PM 决议文档内复述代码细节。

### §3.1 运行期

| 文件 | 变更要点 | Owner |
|---|---|---|
| `miniprogram/services/env.ts` | staging/prod apiBaseUrl 切到 `https://costra.cloud/v1` + D-023 注释 | MiniApp-Agent |
| `server/api/openapi.yaml servers` | 收敛 servers 列表 + 注释 D-023 | Backend-Agent |

### §3.2 基建 SSOT

| 文件 | 变更要点 | Owner |
|---|---|---|
| `infra/wechat/domains.md §1` | 4 条子域 status 🟡 → ⚪ + 引用 D-023 §2.3 | DevOps-Agent |
| `infra/wechat/domains.md §1.1` | 运行期 URL 矩阵 staging/prod 行更新 | DevOps-Agent |
| `infra/wechat/domains.md §2` | DNS TTL 表 4 条子域行标"⏸ Phase-2" | DevOps-Agent |
| `infra/wechat/domains.md §4` | Human 操作清单 step 4.1 暂缓注记 + step 4.2 微信白名单填 `https://costra.cloud` | DevOps-Agent |

### §3.3 CI

| 文件 | 变更要点 | Owner |
|---|---|---|
| `scripts/devops/whitelist-check.mjs` | 三方对账规则适配 staging/prod 复用根域（不应误报为漂移）+ D-023 注释 | DevOps-Agent |

### §3.4 合规

| 文件 | 变更要点 | Owner |
|---|---|---|
| `docs/legal/compliance-registry.md §3` | 域名清单收敛为 1 行 `costra.cloud` + 子域整体说明搁置 Phase-2 | PM-Agent |
| `docs/legal/compliance-registry.md §6` | 变更日志追加 v0.2 / 2026-05-18 / D-023 | PM-Agent |
| `docs/devops/icp-filing.md §6` | 微信白名单填 `https://costra.cloud`（D-023） | PM-Agent |
| `docs/devops/icp-filing.md` 附录 B | 变更记录追加 v0.3 / 2026-05-18 / D-023 | PM-Agent |

### §3.5 文档同步

| 文件 | 变更要点 | Owner |
|---|---|---|
| `miniprogram/README.md` | env 表 staging/prod 行 + D-023 注释 | MiniApp-Agent |

---

## §4 不变项（明示防止误改）

> 🚨 本节为「**红线清单**」。任何 agent 在本轮交付时**禁止**触碰下列对象。

### §4.1 D-009 决议本身不动（决策不可变性）

`.team/decisions/D-009-domain-and-dev-server-locked.md` 全文保持原状。本决议（D-023）作为 D-009 §2.1 的「渐进式启用补丁」存在，不修改 D-009 文本本身。

### §4.2 历史 QA / Retro 文档保持原叙事

下列文档中关于「子域架构」「`api.costra.cloud` 上线时序」「ICP 下证后子域启用」等表述保持原文不动（这些表述在历史时序上是真实的，体现当时的决策环境，不应回溯改写）：

- `docs/qa/costra-102-human-verify.md`（手册 §0.2 方式 C 真 staging）
- `docs/qa/costra-104-curl-verify.md` v1.5
- `docs/qa/costra-105-human-smoke.md` v1.4（手册 §方式 C）
- `docs/retrospectives/sprint-1-retro.md`（Sprint-1 末 Retro）
- `.team/reviews/COSTRA-115/final.md` / `COSTRA-116/final.md`（CI 对账族建立期）

> 这些文档若在 Phase-2 子域重启后需更新，由当时的执行卡同轮交付，不属于本决议 scope。

### §4.3 三条 FU 保留 · 仅拨测目标改根域

| Follow-up ID | 原 scope | D-023 后 scope |
|---|---|---|
| FU-DEVOPS-NGINX-ICP-HEADER | 配置 nginx 在 `api.costra.cloud` 响应头注入 ICP 备案号 | 改为在 `costra.cloud` 响应头注入 ICP 备案号 |
| FU-DEVOPS-ICP-HEALTH-PROBE | 拨测 `https://api.costra.cloud/healthz` icp 字段 | 改为拨测 `https://costra.cloud/healthz` icp 字段 |
| FU-DEVOPS-ICP-CROSS-SSOT-CHECK | 文档 SSOT vs 运行期 SSOT 强等值校验 | 不变（与域名无关 · 校验 ICP 备案号字符串） |

> FU 本体保留不删除（FU 是工程债务的最小颗粒度记录），仅拨测目标 URL 替换。

---

## §5 风险变更

| ID | 名称 | D-023 前 | D-023 后 | 变更说明 |
|---|---|---|---|---|
| R-013 | 生产域名迟迟未定 | 🟢 Closed @ 2026-05-13 | 🟢 Closed（不变） | ICP 下证条件不依赖子域 · 关闭条件已满足 |
| R-019 | 公安联网备案 30 日窗口（截止 2026-06-12） | 🟠 Open | 🟠 Open（不变） | 公安备案表填根域 `costra.cloud` 即可 · 不需要等子域配齐 |
| **R-020** 🆕 | **微信白名单 staging 边界模糊** | — | 🟡 Open（新增） | staging env 与 prod 共用 `https://costra.cloud` 白名单 · 短期通过 `env.ts` 编译期常量隔离避免误用 · 长期由 §2.4 触发条件 (a) 重启子域解决 |

### §5.1 R-020 详细描述

- **风险描述**：D-023 §2.2 决议下，staging env 与 prod env 在小程序「服务器域名」白名单层共用 `https://costra.cloud`，从微信平台视角无法区分两者。若开发期误把 staging 数据 push 到 prod 数据库 / 反之 / 灰度实验配置漂移，将造成生产数据污染。
- **概率 × 影响**：低概率 × 中影响 = 🟡
- **短期缓解（D-023 §2.2）**：`env.ts` 编译期常量隔离 + 注释强约束 + Backend `WX_MOCK_LOGIN` env switch 不在 prod 构建产物中
- **长期缓解（D-023 §2.4 触发 (a)）**：staging 环境实际需要与 prod 隔离时立卡重启 `stg.* / api-staging.*` 子域
- **owner**：DevOps-Agent

---

## §6 派生任务

> 📌 **本决议无新立 Sprint 卡**。D-023 与本团队 4 agent（pm-writer + miniapp-dev + backend-dev + devops）**同轮并行交付**完成所有 §3 影响范围清单内的文件变更。Sprint-2 backlog 不增加估点。

子域重启卡（候选 D-024 / D-025+）按 §2.4 触发条件出现时由 Orchestrator + DevOps + PM 联合立卡，不预先占点。

---

## §7 Human 后续操作清单

> 🚨 D-023 落地后 Human 需做的事**只有 3 件**（vs D-009 子域规划下需做 ~7 件）：

| # | 操作 | 入口 | 截止 |
|---|---|---|---|
| 1 | 微信公众平台「服务器域名」白名单填 `https://costra.cloud` | https://mp.weixin.qq.com → 开发 → 开发管理 → 开发设置 → 服务器域名 | Sprint-2 提审前 |
| 2 | 公安联网备案表填根域 `costra.cloud`（**不**填子域） | https://beian.mps.gov.cn/ | 2026-06-12（R-019 30 日窗口） |
| 3 | DNS **不需要**再加 `dev.* / stg.* / api.* / api-staging.*` 子记录（搁置至 §2.4 触发） | 腾讯云控制台 → DNSPod | 等 §2.4 触发条件出现时再做 |

> ✅ 相比 D-009 子域规划，Human 操作面收敛 ~57%（7 件 → 3 件），首次 prod 验收路径缩短约 5~10 工作日（节省 DNS+SSL+nginx 多层依赖等待时间）。

---

## §8 决议落盘自检

- [x] §1 背景：ICP 下证事实 + 子域架构摩擦 + 决策动机三段
- [x] §2 决议：5 子节（prod 回归 + staging 复用 + 子域搁置 + 重启触发条件 + 与 D-009 兼容）
- [x] §3 影响范围：5 区（运行期 / 基建 SSOT / CI / 合规 / 文档同步）· 9 文件清单
- [x] §4 不变项：3 红线（D-009 / 历史 QA·Retro / 三条 FU）
- [x] §5 风险变更：R-013 不变 · R-019 不变 · R-020 新增（含详细描述子节 §5.1）
- [x] §6 派生任务：明示无新立卡 · 4 agent 同轮并行交付
- [x] §7 Human 操作清单：3 件 · 含截止日 · 含入口 URL
- [x] 全角中文标点 · 备案号严格 `沪ICP备2026017253号-1X` / `沪ICP备2026017253号-2`
- [x] 状态圆点严格 🟢🟠🔴🟡⚪（⚪ 用于「搁置 / 未启用」）
- [x] D-009 同款 ADR 章节体例

---

> **本决议落盘后**：board.md 外部资源进度区「服务器域名白名单」状态描述同轮更新；risks.md 新增 R-020；compliance-registry.md §3 + §6 同轮更新；icp-filing.md §6 + 附录 B 同轮更新；运行期 / 基建 SSOT / CI 文件由其他 3 agent 同轮交付（不在本 PM agent scope）。
