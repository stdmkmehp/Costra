# COSTRA-116 · 开发期三源 dev URL / 端口漂移收敛（FU-COMMON-DEV-URL-DRIFT 专项）

- 派发人：Orchestrator
- 接收人：**Backend-Agent**（主驾驶 · 两处改动均非侵入性，一人闭环不越 Scope）
- 派发时间：2026-04-27 15:15（Asia/Shanghai · Human 触发 `run backend fix-dev-url-drift`）
- 本轮截止：2026-04-27 18:00（同轮交付 R1 · **阻 COSTRA-102 04-30 Human 本地验证**）
- 优先级：**P1**（不阻 Sprint-1 其它卡交付，但阻 Human 04-30 本地验证链路联通）
- 闸门影响：G4 合并前必须到位（`pr-check.yml check:whitelist` step 从"2 豁免 warning"收敛到"全绿无豁免"）
- 分类：**基础设施一致性修复**（Follow-up 专项卡 · 单一职责 · 跨 Backend/MiniApp 两个文件）
- Review 档位：**T2**（基建类小卡 · 纯文本/常量修改 · 无业务逻辑变更 · Tech 单轨 · D-013 判定）
- 估点：1
- 依赖：COSTRA-115（已 Done · 2026-04-27 14:10）— 豁免机制 + FU 登记均来自 115 · SSOT (`infra/wechat/domains.md §1.1`) 已固化
- 能力边界：**纯代码 / 常量改动**（无 DNS / 无微信后台 · 无跨机联调需求）

---

## 0. 背景（为什么是本卡）

COSTRA-115 R1（2026-04-27 10:51）CI 脚本首跑，捕获**潜伏 3+ Sprint 的 dev URL 三源漂移**：

| 源 | 当前值 | 问题 |
|---|---|---|
| `miniprogram/services/env.ts` L17 | `dev.apiBaseUrl = 'http://127.0.0.1:3000/v1'` | 主机 + 端口**双错**（SSOT 规定 `http://localhost:8080/v1`） |
| `server/.env.example` L9 | `PORT=8080` | ✅ 真相（部署权威） |
| `server/src/config/env.ts` L93 | `parsePort(optional(env, 'PORT', '3000'))` | 代码默认值 `'3000'` 与 .env.example 不一致 |
| `scripts/devops/whitelist-check.mjs` | `EXEMPTED_ENVS_FROM_RULES_AB = new Set(['dev'])` | 豁免保 115 可 commit · 本卡收尾后应清零 |

**实际冲击**：开发同事若按 `.env.example` 跑 server（`PORT=8080`）同时小程序按默认 dev 请求 `127.0.0.1:3000` → **主机 + 端口两项都错，本地联调从第 0 秒就拉不通**。Human 04-30 按 `docs/qa/costra-102-human-verify.md` 本地验证必撞此坑。

**SSOT 权威**：`infra/wechat/domains.md §1.1` 已固化 `local: http://localhost:8080/v1`。本卡即按 SSOT 三方收敛。

---

## 1. 目标（What · 一句话）

把 dev 本地开发的 `apiBaseUrl` 和 server 代码回退默认值**全部对齐到 SSOT 的 `localhost:8080`**，并移除 whitelist-check.mjs 中针对 `dev` 的豁免，恢复完整三方对账强度。

---

## 2. Scope（做 / 不做）

### ✅ 做（四处改动 · 严格按 FU 建议路径）

- **D1** `server/src/config/env.ts` · `parsePort(optional(env, 'PORT', '3000'))` → `'8080'`（单字符串字面量改动 · 对齐 `.env.example PORT=8080` · 让代码默认值和部署权威一致）
- **D2** `miniprogram/services/env.ts` · `dev.apiBaseUrl = 'http://127.0.0.1:3000/v1'` → `'http://localhost:8080/v1'`（单字符串字面量改动 · 对齐 SSOT §1.1 local 行）
- **D3** `scripts/devops/whitelist-check.mjs` · 删除 `EXEMPTED_ENVS_FROM_RULES_AB = new Set(['dev'])` 豁免（保留空 Set 作为未来扩展锚点 · 删掉 `EXEMPTION_REASON` 常量 · 删掉豁免分支的 warning 代码路径 · 注释同步移除 FU-COMMON-DEV-URL-DRIFT 引用）
- **D4** `.team/follow-ups/README.md` · FU-COMMON-DEV-URL-DRIFT 状态 `open` → `closed`（附本卡卡号 + 日期）· FU-115-1 状态 `open` → `closed`（随本卡一并关闭 · 因 `EXEMPTED_ENVS_FROM_RULES_AB={dev}` 已被删除）
- **D5** `infra/wechat/domains.md` §1.1 注脚 · 移除"dev 环境因 FU-COMMON-DEV-URL-DRIFT 豁免"字样（如果有的话 · 先搜后改）

### ❌ 不做（Scope 铁律）

- ❌ 改 `server/api/openapi.yaml servers`（已是真相，不碰）
- ❌ 改 `server/.env.example PORT=8080`（已是真相，不碰）
- ❌ 重构 whitelist-check.mjs 的 parser / 对账逻辑（保持现状 · 只删豁免分支）
- ❌ 引入任何 npm 依赖（零依赖铁律 · 继承自 115）
- ❌ 改 `staging` / `prod` 任何 URL（本卡只碰 dev）
- ❌ 新写文档 / 新建目录（SSOT 已在 COSTRA-115 落地）

### ❓ 必要时升 ADR（本卡预判不需要）
- 若发现 SSOT（`domains.md §1.1 local` 行）值本身有疑问 → 暂停实装 · 升 Review-Agent 讨论 · 不擅改 SSOT

---

## 3. 交付物（五处 · 每处都极小）

| 编号 | 文件 | 类型 | 预计改动行数 |
|---|---|---|---|
| D1 | `server/src/config/env.ts` | 改（1 字面量） | 1 行 diff |
| D2 | `miniprogram/services/env.ts` | 改（1 字面量） | 1 行 diff |
| D3 | `scripts/devops/whitelist-check.mjs` | 改（删豁免分支） | ~20 行 diff |
| D4 | `.team/follow-ups/README.md` | 改（状态表 + 条目） | ~10 行 diff |
| D5 | `infra/wechat/domains.md` | 改或 no-op（视原文有无豁免注脚） | 0~3 行 diff |

**总计**：~35 行 diff · **绝对禁止发散**

---

## 4. DoD（完工判定 · 必须全部达成）

- [ ] D1~D5 五处改动全部落地（D5 如原文无豁免注脚可跳过，写入 response 说明）
- [ ] `npm run check:whitelist` → **exit 0 · 无任何 warning**（从 115 的"2 豁免 warning"收敛到"全绿"）
- [ ] `npm run typecheck`（server 侧）→ exit 0
- [ ] `npm run typecheck`（miniprogram 侧，如有）→ exit 0
- [ ] `npm run test` / `vitest run` → server 现有 13 tests 全绿（parsePort 默认值改动可能影响 env-loader 单测 · 必要时**同步修单测**以反映新真相，但不新增测试范畴）
- [ ] `.team/follow-ups/README.md` 顶部状态表 `FU-COMMON-DEV-URL-DRIFT: open→closed · closed_by: COSTRA-116 · closed_at: 2026-04-27`
- [ ] response 报告单独说明"为什么改 `'3000'`→`'8080'` 不会 break 现有开发者"（预期回答：parsePort 仅在 env.PORT 缺失时使用默认值，而 .env.example 显式给 8080；没有 .env 的场景下新默认对齐 .env.example 反而更正确）

---

## 5. 四闸（pre-commit 前本地跑过）

1. `node --check scripts/devops/whitelist-check.mjs` → exit 0
2. `npm run check:whitelist` → **exit 0 · 零 warning**（核心闸门 · 本卡价值验证）
3. `npm run typecheck`（按项目根 tsconfig 定义）→ exit 0
4. `npm test` → 全绿

任何一项未绿 → 不 commit · 走 Revise 或回报 Review-Agent。

---

## 6. Review 档位与 Handoff

- **档位**：T2（D-013 · 基建类小卡 · 无业务 · 无接口变更 · Tech 单轨）
- **Reviewer**：Review-Agent-Tech
- **Handoff 契约**：Backend-Agent R1 产出后**同一 tool call 循环**内触发 Review（D-016 铁律 · 115 已第 6 次实战）
- **预期终审路径**：AI Review APPROVE → Human `approve:COSTRA-116`（1 点小卡 · 审批成本极低 · 预判单轮结单）

---

## 7. 风险与对冲

| 风险 | 概率 | 影响 | 对冲 |
|---|---|---|---|
| parsePort 默认值改动 break 某单测 | 中 | 低（改字面量即可） | DoD 已授权同步修单测范畴内（反映新真相） |
| env.ts 改 dev URL 后影响其它 miniprogram 代码路径 | 低 | 低（仅 apiBaseUrl 字面量） | vitest / typecheck 两闸兜底 |
| 改 whitelist-check.mjs 后 `check:whitelist` 发现**更多**失配（非 dev 行新问题） | 极低 | 高（要升 R2 / 新卡） | 如发生立刻停手 · 写 Revise 报告 · 不擅扩 Scope |
| 改完后 `docs/qa/costra-102-human-verify.md` 里引用 `127.0.0.1:3000` 的旧地址变成陷阱 | 中 | 低 | 仅当 grep 出现才顺手改（in-scope 的文档镜像更新 · 用 search_content 一次性核查） |

---

## 8. 产出模板（响应结构要求 · 与 115 对齐）

Backend-Agent 完工后写 `.team/reviews/COSTRA-116/round-1-backend-response.md`，包含：

- **变更清单**（5 处 diff · 每处贴前后对比）
- **四闸证据**（命令 + exit code + 关键输出截段 · 特别是 `npm run check:whitelist` 的 零 warning 输出）
- **Scope 遵守声明**（哪些没碰 / 为什么）
- **D5 处置说明**（若 domains.md 原文无豁免注脚，明说 no-op + grep 证据）
- **下游影响断言**（是否需要任何文档/其它卡级联修改 · 建议默认"否"）

---

## 9. 追溯

- FU 登记：`.team/follow-ups/README.md` · FU-COMMON-DEV-URL-DRIFT 条目（2026-04-27 10:54 由 COSTRA-115 R1 登记）
- 母 Review：`.team/reviews/COSTRA-115/round-1-tech.md` INFO-A
- SSOT：`infra/wechat/domains.md §1.1 local` 行 = `http://localhost:8080/v1`
- 决策：D-009（域名与开发服务器锁定）· D-013（Review 分级 · T2）· D-016（自动拉起同轮兑现铁律）

---

**Backend-Agent · 接单 · R1 实装并触发 AI Review-Tech · 同 tool call 循环内完成。**
