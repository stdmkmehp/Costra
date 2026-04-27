# COSTRA-115 · costra.cloud DNS 子记录规划 + 白名单一致性 CI 校验

- 派发人：Orchestrator
- 接收人：**DevOps-Agent**
- 派发时间：2026-04-27 10:47（Asia/Shanghai · D-016 第 6 次实战目标）
- 原定截止：2026-04-25 18:00（D-009 §3 · **已逾期 2 天**）
- 本轮截止：2026-04-27 18:00（同轮交付 R1）
- 优先级：P1（已逾期 · Sprint-1 基建 · 不阻塞主线端到端 · 但阻塞 G4 合并）
- 闸门影响：G4 合并前必须到位（CI 校验脚本须进 `pr-check.yml`）
- 分类：**基础设施文档 + CI 校验脚本**（Infrastructure Doc + CI Gate）
- Review 档位：**T2**（基建类 + 首次落地 CI 校验脚本 · D-013 判定 · Tech 单轨 Review · 等 Human 终审 `approve:COSTRA-115`）
- 估点：1
- 依赖：D-009（已 Approved）· `server/api/openapi.yaml servers` 段（事实源）· `miniprogram/services/env.ts`（事实源）
- 能力边界：**Agent 无 DNS 服务商后台访问权** · Agent 不能创建真实 DNS 子记录；交付 **DNS 规划文档 + CI 校验脚本 + workflow 接线**，**真实 DNS 子记录创建动作由 Human 在 ICP 下证后按手册执行**，不纳入本卡完工判定

---

## 0. 前提澄清（能力边界 · 对齐 COSTRA-114 v2 范式）

**🚨 Agent 能力边界（铁律 · COSTRA-114 v2 已确立）**：
- DevOps-Agent **不能** 登录域名服务商后台创建 DNS A/CNAME 记录
- DevOps-Agent **不能** 登录微信公众平台"服务器域名"白名单后台
- DevOps-Agent **能** 做的：写规划文档、写 CI 校验脚本、写 workflow 步骤、指定 Human 后台操作清单、指定预期值

**因此本卡交付本质**：
不是"把 DNS 子记录配好"，而是：
1. 交付 **`infra/wechat/domains.md`** 作为唯一 SSOT（Single Source of Truth）记录四个环境域名的规划与当前状态
2. 交付 **`scripts/devops/whitelist-check.mjs`** 作为 CI 校验脚本（检查 openapi.yaml servers 段、miniprogram/services/env.ts、`infra/wechat/domains.md` 三者一致）
3. 在 `.github/workflows/pr-check.yml` 中接线调用，让不一致时 PR 直接红 block

**真实 DNS 子记录创建** 由 Human 在 ICP 备案下证后（约 20 工作日）按 `infra/wechat/domains.md §4` 操作清单执行 · 不卡本卡完工。

---

## 1. 背景

D-009（2026-04-23 13:00 Approved）锁定了四个环境的域名命名：

| 环境 | 域名 | 状态 |
|---|---|---|
| 生产 | `costra.cloud` | 🟢 已注册 · DNS A 记录 `→ 49.235.216.20` 已配 · ICP 备案受理中 |
| 开发 | `dev.costra.cloud` | 🟡 **待 DevOps 规划 DNS 子记录**（本卡交付物） |
| 预发 | `stg.costra.cloud` | 🟡 Sprint-2 末启用（本卡预留） |
| API 入口 | `api.costra.cloud` | 🟡 备案下证后启用（本卡预留） |

同时 OpenAPI `server/api/openapi.yaml servers` 段已列出 4 条 URL（localhost / 开发 IP / 预发域名 / 生产域名），`miniprogram/services/env.ts` 已按此四条配三套 env。但**缺一个机制保证"代码里写的 URL ≡ 文档规划 ≡ 未来微信白名单"三者一致**，一旦 Backend 同学改了 openapi 没同步 env.ts，或微信白名单后台忘了填 staging，就会出上线事故。

---

## 2. 目标（What）

以 **`infra/wechat/domains.md`** 为唯一 SSOT，用 CI 脚本把三处事实源钉死一致：

```
     OpenAPI servers  ←────┐
                           │ 一致性 CI 校验（whitelist-check.mjs）
     env.ts apiBaseUrl ←──┤
                           │
     infra/wechat/domains.md（SSOT） ←──┘
```

一旦三者失配，`pr-check.yml` → `ci/pr-check` 红 · 分支保护 block 合并。

---

## 3. Scope（做 / 不做）

### ✅ 做
- **D1** 新建 `infra/wechat/domains.md`（SSOT · 四环境域名矩阵 + Human 备案下证后操作清单 + 微信白名单填写操作清单）
- **D2** 新建 `scripts/devops/whitelist-check.mjs`（CI 校验脚本 · 零依赖 Node 原生 · 读 openapi.yaml + env.ts + domains.md 三者对账）
- **D3** 在 `.github/workflows/pr-check.yml` 接一个 `- name: Whitelist Consistency Check` 步骤
- **D4** 在 `package.json` 追加 `"check:whitelist": "node scripts/devops/whitelist-check.mjs"` 脚本
- **D5** `infra/wechat/domains.md` §4 写 Human 后台操作清单（ICP 下证后 · 微信白名单填写 3 条）
- **D6** `infra/wechat/domains.md` §5 写 DNS 子记录规划（dev/stg/api 三条 · 类型 A/CNAME · 指向）
- **D7** 更新 `.team/risks.md` 的 R-013 标注（不改状态 · 加备注"CI 白名单校验已落地")
- **D8** 在 `infra/README.md` 写 infra 目录用途说明（一行引导到 `wechat/domains.md`）

### ❌ 不做
- ❌ 登录腾讯云 DNS 后台创建真实子记录（Human 在 ICP 下证后执行）
- ❌ 登录微信公众平台填白名单（Human 在 ICP 下证后执行）
- ❌ 实现自动 fetch 微信白名单 API 对账（目前微信无开放 API · 只能文档式兜底）
- ❌ 改 OpenAPI servers 段内容（已 D-009 锁定 · 本卡只做校验不做修改）
- ❌ 改 `miniprogram/services/env.ts` 内 URL 值（同上）
- ❌ 挂 pre-commit hook（CI 校验在 pr-check 已足够 · 本地 hook 会拖慢 commit 时延 · FU 观察项）

---

## 4. DoD（Definition of Done · 11 条）

| # | 条目 | 验证方式 | 阻断级 |
|---|---|---|---|
| D1.1 | `infra/wechat/domains.md` 存在 · 含四环境矩阵（prod/dev/stg/api · 各含域名/类型/指向/状态/生效前提） | 文件存在 + grep 四域名 | P0 |
| D1.2 | 文档 §4 Human 操作清单步骤可独立执行（前置 / 执行命令 / 验证方式 / 预期输出 三件套对齐 COSTRA-114 v2 §4.1） | 文档 §4 人肉走查 | P0 |
| D1.3 | 文档 §5 DNS 子记录规划完整（dev/stg/api 三条 · 类型 + 指向 + TTL 建议 + 创建时机） | §5 存在 + 3 条记录明细 | P0 |
| D2.1 | `scripts/devops/whitelist-check.mjs` 零依赖 Node 原生实现（只用 `fs` / `path` / `url` · 不引 npm 包） | 文件存在 + `node --check` 语法合法 | P0 |
| D2.2 | 脚本能正确解析 `server/api/openapi.yaml servers` 段 · 提取 URL 列表（yaml 用正则匹配即可 · 不引 yaml parser） | 脚本 dry-run 打印提取结果匹配 openapi.yaml L22-30 | P0 |
| D2.3 | 脚本能正确解析 `miniprogram/services/env.ts` · 提取 `apiBaseUrl` 字符串字面量 | 脚本 dry-run 打印提取结果匹配 env.ts 实际值 | P0 |
| D2.4 | 脚本能正确解析 `infra/wechat/domains.md` · 提取域名矩阵 | 脚本 dry-run 打印提取结果匹配 §1 矩阵 | P0 |
| D2.5 | 三者对账 · 一致退出码 0 + 打印 "✅ whitelist consistent" · 不一致退出码 1 + 打印详细 diff | 本地 `npm run check:whitelist` 干跑 exit 0 + 人为改 env.ts 制造不一致 exit 1 | P0 |
| D3.1 | `.github/workflows/pr-check.yml` 接入 `- name: Whitelist Consistency Check` 步骤 · 位于 Typecheck 之后 Test 之前（独立 job 或 step 皆可 · 建议 step） | workflow 文件 grep 存在 + 不破坏原有步骤顺序 | P0 |
| D4.1 | `package.json scripts` 追加 `check:whitelist` · 命令为 `node scripts/devops/whitelist-check.mjs` | `npm run check:whitelist --silent` 可执行 | P0 |
| D7.1 | `.team/risks.md` R-013 加备注（不改状态）："2026-04-27 CI 白名单校验已落地（COSTRA-115）· 下证后 Human 执行 §4 操作清单时 CI 会自动 block 不一致 PR" | 文件 diff 可见 | P1 |

**验收双闸**：
- ① `node scripts/devops/whitelist-check.mjs` exit 0（一致性对账全绿）
- ② `npm run typecheck` 仍 exit 0（不破坏现有工程）

---

## 5. 交付物清单（本卡 commit 范围内）

1. **新建** `infra/wechat/domains.md`（~150 行 · SSOT）
2. **新建** `infra/README.md`（~10 行 · 目录用途说明 + 指向 wechat/domains.md）
3. **新建** `scripts/devops/whitelist-check.mjs`（~150 行 · 零依赖校验脚本）
4. **修改** `.github/workflows/pr-check.yml`（+5 行 · 新 step）
5. **修改** `package.json`（+1 行 · scripts 新脚本）
6. **修改** `.team/risks.md`（+1 行 · R-013 备注）
7. **新建** `.team/reviews/COSTRA-115/round-1-devops-response.md`（Agent 交付响应报告）
8. **新建** `.team/reviews/COSTRA-115/round-1-tech.md`（Review-Tech R1 报告）

---

## 6. 关键契约（Agent 必读）

### 6.1 事实源优先级（派单漂移防御 · FU-102-SYNC-PULL-DRIFT 经验外化）

若本 dispatch 描述与以下事实源冲突，**一律以事实源为准**，Agent 必须按事实源实装 + 在响应报告中登记 INFO 条目：
1. `server/api/openapi.yaml servers` 段（L22-30）
2. `miniprogram/services/env.ts`（`EnvConfig.apiBaseUrl`）
3. `.team/decisions/D-009-domain-and-dev-server-locked.md §2.1`

### 6.2 OpenAPI servers 现值（锁定 · 对账基线）

```yaml
servers:
  - url: http://localhost:8080/v1         # 本地开发
  - url: http://49.235.216.20:8080/v1     # 开发服务器（IP · ICP 下证前）
  - url: https://api-staging.costra.cloud/v1   # 预发布
  - url: https://api.costra.cloud/v1      # 生产
```

### 6.3 env.ts 现值（锁定 · 对账基线）

```ts
dev:     apiBaseUrl: 'http://localhost:8080/v1'
staging: apiBaseUrl: 'https://api-staging.costra.cloud/v1'
prod:    apiBaseUrl: 'https://api.costra.cloud/v1'
```

> ⚠️ 注意：env.ts 没有 `49.235.216.20` 条目（因为 IP 直连仅 Backend 联调阶段用，不进小程序运行期 env）· CI 校验可接受 OpenAPI 比 env.ts 多一条 dev IP 条目（"OpenAPI ⊇ env.ts" 关系 · 脚本实现要考虑）

### 6.4 domains.md 矩阵锁定字段（对账基线）

本卡首次落地 · Agent 设计矩阵格式 · 但必须含：
- 列：`env / domain / record_type / target / status / activation_condition`
- 4 行：prod（`costra.cloud`）/ dev（`dev.costra.cloud`）/ stg（`stg.costra.cloud`）/ api（`api.costra.cloud`）

### 6.5 CI 脚本退出码契约

- `exit 0` · 一致 · 打印 `✅ whitelist consistent: 4 envs, 4 domains matched across 3 sources`
- `exit 1` · 不一致 · 打印详细 diff（哪个源哪个字段与哪个源冲突）
- `exit 2` · 解析失败（脚本自身 bug 或源文件损坏）· 打印栈

### 6.6 `.gitignore` / `.env` 红线

- 不得把 `49.235.216.20` 或任何真实密钥写进 `infra/wechat/domains.md`（仅写域名规划）
  - IP 在 D-009 §2.5 已允许出现于 `docs/devops/dev-server-bootstrap.md`（Human 手册）· 本 SSOT 文档可引用该路径但不重复登记
- 不得写任何微信 AppSecret / robot key 到本卡新增文件

---

## 7. 时间盒

- 派单 → Agent 实装 R1 交付：**同 tool call 循环内**（D-016 第 6 次实战目标）
- Agent 预估工时：~25 分钟（1 点卡 · 基建文档为主 · CI 脚本 ~100 行）
- Review-Tech 同轮兑现：~10 分钟
- 总耗时目标：~35 分钟 · 同 tool call

---

## 8. 风险与兜底

| 风险 | 影响 | 兜底 |
|---|---|---|
| CI 脚本正则解析 openapi.yaml 对 YAML 锚点/引用不支持 | 未来 openapi 用高级 YAML 特性时误报 | 脚本里加注释 `# SIMPLE_YAML_PARSER` · 若未来需要升级走 FU |
| env.ts 的 URL 字面量被改成模板字符串 / 拼接表达式 | 正则失配 | 脚本 exit 2 + 在报错信息里提示"env.ts 需保持 `apiBaseUrl: '常量字面量'` 格式" |
| pr-check.yml 增加 step 后 CI 执行时间上涨 | 开发者体验下降 | 脚本零依赖 · 纯正则 · 预计 <50ms · 可忽略 |

---

## 9. 参考

- `.team/decisions/D-009-domain-and-dev-server-locked.md`（母决策）
- `.team/dispatch/COSTRA-114-devops-dev-server-bootstrap.md`（同 Owner · 范式参考）
- `docs/devops/ci-cd.md §4`（CI 激活清单）
- `server/api/openapi.yaml L22-30`（servers 事实源）
- `miniprogram/services/env.ts`（env 事实源）
- `.team/risks.md R-013`（ICP 备案风险 · 本卡落地后备注更新）

---

**Agent 开工**：按 §3 Scope + §4 DoD + §6 契约 · 同 tool call 循环内交付 · 预期 R1 即双签 APPROVE 级别（1 点卡 · 契约简单 · 漂移风险可控）。
