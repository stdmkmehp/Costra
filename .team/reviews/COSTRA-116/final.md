# COSTRA-116 · FINAL 终审收官报告

- **终审时间**：2026-04-27 15:57（Asia/Shanghai）
- **终审人**：Human（`approve:COSTRA-116`）
- **终审档位**：T2（基建类 · Tech 单轨 · 无 R2 需求）
- **终裁 Verdict**：🟢 **APPROVE · CLOSED**
- **卡类型**：FU 专项修复卡（FU-COMMON-DEV-URL-DRIFT 正式收敛）
- **Sprint**：Sprint-1（Backend/DevOps 串联第三卡）
- **总耗时**：**派单 15:15 → R1 交付 15:22 → AI Review 15:25 → Human 终审 15:57 · 合 42 分钟**（其中 Agent 实战 7 分钟 · Review 3 分钟 · Human 审批排队 32 分钟）

---

## §1 终裁依据

| 维度 | 结论 | 证据 |
|---|---|---|
| R1 Tech Review | APPROVE 30/30 · P0=0 P1=0 P2=0 INFO=1 | `.team/reviews/COSTRA-116/round-1-tech.md` |
| R1 Backend 响应 | 8 项 DoD 全数落地（D1~D4 核心 + D5~D8 边界内文档镜像）· Scope 铁律严守 | `.team/reviews/COSTRA-116/round-1-backend-response.md` |
| 四闸全绿 | node-check / `check:whitelist` **零 warning** / root+server tsc / root vitest 13/13 + server vitest 8/8 | 本报告 §4 |
| D-016 合规 | 第 7 次实战 · 同一 tool call 循环 · 跨轮异步反模式零复现 | `.team/STATE` §规约 6 |
| FU 闭环价值 | FU-COMMON-DEV-URL-DRIFT + FU-115-1 双闭环 · 新增 FU-116-1 P3 观察 | `.team/follow-ups/README.md` |
| Human 终审触发 | `approve:COSTRA-116`（2026-04-27 15:57） | 本报告 |

---

## §2 交付物清单（commit `bddbd4a` · 14 files · +805/-51）

### 新增（3）
- `.team/dispatch/COSTRA-116-backend-fix-dev-url-drift.md`（派单 · Scope 铁律 + D1~D4 核心 4 步）
- `.team/reviews/COSTRA-116/round-1-backend-response.md`（Agent R1 自证 · Scope 边界内 D5~D8 自主增补）
- `.team/reviews/COSTRA-116/round-1-tech.md`（Review-Tech R1 APPROVE 30/30）

### 修改（7 · 产品代码 / 文档镜像）

**核心 3 文件（SSOT 三源对齐）**：
- `server/src/config/env.ts` L93 · `parsePort` 默认值 `'3000'` → `'8080'`（对齐 `.env.example PORT=8080`）
- `miniprogram/services/env.ts` L17 · `dev.apiBaseUrl = 'http://127.0.0.1:3000/v1'` → `'http://localhost:8080/v1'`
- `scripts/devops/whitelist-check.mjs` · `EXEMPTED_ENVS_FROM_RULES_AB = new Set(['dev'])` → `new Set()` · 删 `EXEMPTION_REASON` · warning 文案泛化（空 Set 下不触发 · 保留为未来临时豁免锚点）

**文档镜像 3 文件（Scope 边界内直接依赖）**：
- `docs/qa/costra-102-human-verify.md` · 方式 A 的 `dev.apiBaseUrl` 样例同步
- `miniprogram/README.md` · env 表格 dev 行同步
- `server/test/setup.ts` L34 · `PORT` 默认值注释 `'3000'` → `'8080'`

**FU 登记 1 文件**：
- `.team/follow-ups/README.md` · FU-COMMON-DEV-URL-DRIFT + FU-115-1 状态 `open` → `closed` · 新增 FU-116-1 P3 观察项

### 其他 4（收口同步）
- `.team/STATE`（15:25 快照）
- `.team/board.md`（顶部 last-updated + Human-Review 列 + 底部 Orchestrator 状态块）
- `.team/metrics.json`（第 7 条卡记录）
- `.team/messages/2026-04-27.jsonl`（+6 条事件）

---

## §3 价值兑现

🏆 **主干 CI 闸门从"豁免 warning"收敛到"零 warning"**（本卡最高价值点）：

| 指标 | 115 交付末 | 116 交付后 |
|---|---|---|
| `npm run check:whitelist` exit code | 0 | 0 |
| `[EXEMPTED]` warning 计数 | **2**（规则 A + 规则 B 各一）| **0** |
| 规则 A/B 作用域 | dev env 豁免 | **全 env 强制**（恢复全量强度）|
| 豁免机制锚点 | 保留 `new Set(['dev'])` + `EXEMPTION_REASON` | **清空为 `new Set()`** · 常量删除 · 注释要求未来临时豁免同轮登 FU |

🏆 **SSOT 三源对齐到 `http://localhost:8080/v1`**：

| SSOT | 终审前（漂移态） | 终审后（对齐态） |
|---|---|---|
| `server/api/openapi.yaml servers[1]` | `http://localhost:8080/v1`（真相源 · 未动）| 未动 |
| `server/.env.example PORT` | `8080`（真相源 · 未动）| 未动 |
| `server/src/config/env.ts parsePort` | 默认 `'3000'`（漂移）| **`'8080'`**（对齐）|
| `miniprogram/services/env.ts dev` | `http://127.0.0.1:3000/v1`（漂移）| **`http://localhost:8080/v1`**（对齐）|

🏆 **解锁 04-30 COSTRA-102 Human 本地验证前置条件**：
- 小程序 dev 调的地址 = server 真实启动地址
- Human 按 `docs/qa/costra-102-human-verify.md` 方式 A 执行 20 分钟本地验证将无"联调拉不通"的前置阻塞

🏆 **Scope 铁律首次在多作用域 FU 专项卡上完整落地**：
- 触碰文件：server 配置 1 + miniprogram 配置 1 + DevOps 脚本 1 + 文档镜像 3 + FU 登记 1 = **7 文件 +41/-36**
- **零触碰**：`server/api/openapi.yaml`（事实源）· 根目录 `.env.example`（边界外 · 登 FU-116-1 P3 观察）· `infra/wechat/domains.md`（无豁免注脚可清）
- 为后续"跨作用域 SSOT 对齐类"FU 专项卡建立范式

---

## §4 四闸全绿证据

| 闸门 | 命令 | 结果 |
|---|---|---|
| 语法 | `node --check scripts/devops/whitelist-check.mjs` | exit 0 · SYNTAX_OK |
| 白名单一致性 | `npm run check:whitelist` | **exit 0 · 零 warning**（从 115 末 2 warning 收敛）|
| 类型（root）| `npx tsc --noEmit` | exit 0 |
| 类型（server）| `cd server && npx tsc --noEmit` | exit 0 |
| 单测（root）| `npm run test:unit` (vitest) | 4 files · 13/13 pass · 161ms |
| 单测（server）| `cd server && npx vitest run` | 1 file · 8/8 pass · 402ms |

**合计：6 闸全绿 · 21/21 test pass**

---

## §5 FU 跟踪变更

| FU-ID | 终审前 | 终审后 | 动作 |
|---|---|---|---|
| **FU-COMMON-DEV-URL-DRIFT** | `open`（阻 04-30 Human 本地验证）| 🟢 **`closed`** @ 2026-04-27 | 本卡 resolved |
| FU-115-1 | `open` | 🟢 **`closed`** @ 2026-04-27 | 本卡一并 resolved |
| **FU-116-1**（新）| — | 🟡 **`open` · P3 观察** | 新建（根目录 `.env.example APP_PORT/APP_BASE_URL` 边界外漂移 · Sprint-1 末 DevOps 小卡 0.5 点评估）|
| FU-115-2 | `open` | `open` · 保持 | Human 主动（ICP 下证日 · R-013 关闭条件 · 与本卡无关）|

---

## §6 Sprint-1 串联状态更新

| 卡 | 类型 | 状态 | 备注 |
|---|---|---|---|
| COSTRA-102 | MiniApp 登录→首页→记一笔 端到端 | 🟡 **Human-Review · 等 04-30 本地验证**（前置已解锁）| 硬节点 2026-04-30 |
| COSTRA-114 | 开发服务器 bootstrap 手册（D-009）| ⏳ **Todo · 🟠 卡定义已 approve 但未开工** | 等 Human `run devops COSTRA-114` |
| COSTRA-115 | DNS + 白名单一致性 CI | 🟢 **Done** @ 2026-04-27 14:10 | FU 已随 116 闭环 |
| **COSTRA-116** | FU 专项 · 开发期三源漂移收敛 | 🟢 **Done** @ 2026-04-27 15:57 | 本卡 |
| R-013 | `api.costra.cloud` 微信白名单 | 🟡 **Mitigated** · 等 ICP 下证日 · FU-115-2 跟踪 | `.team/risks.md` |

---

## §7 指标汇总

| 指标 | 值 |
|---|---|
| 派单→R1 时长 | **7 分钟**（15:15 → 15:22） |
| R1→AI Review 时长 | **3 分钟**（D-016 同轮兑现）|
| AI Review→Human 终审时长 | 32m |
| **全程耗时**（派单→终审）| **42 分钟** |
| R1 AI Review 得分 | **30/30** · Tech 单轨 |
| 轮数 | 1（无 R2 需求）|
| P0 捕获（Review）| 0 |
| P0 逃逸到 Human | **0** |
| P1 捕获（Review）| 0 |
| P2 捕获（Review）| 0 |
| INFO 标记（Review）| 1（FU-116-1 P3 观察）|
| autoloop 触发 | 是（D-016 第七次实战合规）|
| 代码变更 | +805 / -51 · 14 files · 3 新 11 改 |
| SSOT 对齐 | 三源 → 一源（`http://localhost:8080/v1`）|
| CI 闸门收敛 | 2 豁免 warning → 零 warning |

---

## §8 教训与沉淀

1. **FU 专项卡范式首次完整跑通** · 值得沉淀：
   - **Dispatch 派 D1~D4 核心 4 步** · Agent 在 Scope 边界判断基础上**自主增补 D5~D8**（3 处文档镜像 + 1 处注释）· 既不越权也不漏修 · Review 确认增补合理 → 证明 Scope 铁律 + Agent 判断力的双重保障有效
   - **FU 专项卡是否纳入正式卡类别**议入 Sprint-1 Retro（目前以"1 点基建小卡"形式走常规流程，但上下游 FU 状态流转、价值兑现维度、多作用域 Scope 设计均具备专项范式特征）
2. **T2 单轨 Tech Review 第二次落地**（115 首次 · 116 第二次）· 两张卡总耗时都在 10~15 分钟内收齐 AI Review，比 T1 双签范式节省 ~40%。对基建类 / FU 专项类小卡的适用性已经过两次验证，建议 D-013 T2 档位描述补充"FU 专项 / SSOT 对齐"作为典型触发场景。
3. **D-016 第七次实战连续合规**（七次零跨轮异步反模式）· 规约稳定性进一步验证 · Sprint-1 末 Retro 建议将 D-016 从"观察期"正式升级为"定稿规约"。
4. **CI 闸门收敛曲线有明确正反馈**：115 故意留 2 warning 迫使 116 承接修复 → 116 收敛到零 warning → 主干 CI 从此刻起恢复全量强度。这种"先落地工具 + 立即升 FU + 下卡专项修复"的节奏比"必须先修好再落地"节省了 1 个 Sprint Loop 的等待时间。

---

## §9 状态迁移

```
COSTRA-116  Todo → Doing(15:15) → R1-delivered(15:22) → AI-Review-APPROVE(15:25)
            → Human-Review(15:25) → DONE(2026-04-27 15:57 · approve:COSTRA-116)
```

**球 → 无人持有**（本卡整卡收官）· Human 下一步视线（并行可选）：
- 🟡 **2026-04-30 本地验证 COSTRA-102 → `approve:COSTRA-102`**（硬节点 3 天后 · 前置已达成）
- 🟢 可并行：`run miniapp COSTRA-103`（本地持久化）/ `run devops COSTRA-114`（开发手册）
- 🟡 Sprint-1 末：认领 FU-116-1（根目录 `.env.example` 观察项 · 0.5 点 DevOps 小卡）

---

**归档**：本报告作为 COSTRA-116 最终交付闭环证据 · `.team/metrics.json` 第 7 条同步 `human_final_decision = approve` · 后续议题均在 FU 跟踪。
