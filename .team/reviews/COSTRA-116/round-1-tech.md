# COSTRA-116 · Round-1 · Review-Tech（T2 单轨）

- Reviewer：Review-Agent-Tech
- 受审 Agent：Backend-Agent
- 档位：T2（D-013 · 基建类小卡 · 无业务 · 无接口变更 · Tech 单轨）
- Review 时间：2026-04-27 15:25（Asia/Shanghai）
- 依据：`.team/dispatch/COSTRA-116-backend-fix-dev-url-drift.md` + `round-1-backend-response.md`
- 对账范围：7 文件 diff（+41/-36）· 四闸证据 · Scope 遵守声明 · FU 关闭完整性

---

## 0. 结论速览

**APPROVE 30/30 · P0=0 · P1=0 · P2=0 · INFO=1**

- ✅ 按 FU 建议路径 4 步 100% 落地 · 零发散
- ✅ 四闸全绿 · 核心闸 `check:whitelist` 从 115 末"2 豁免 warning" → **零 warning**（本卡核心价值兑现）
- ✅ Scope 铁律遵守得极严（openapi.yaml / .env.example 真相源原封不动）
- ✅ 三处直接文档镜像（D6/D7/D8）落地合理 · 不改会让 Human 04-30 本地验证手册自相矛盾
- ✅ FU-COMMON-DEV-URL-DRIFT + FU-115-1 **双闭环** · 注脚详尽追溯（保留空 Set 锚点的注释把"未来不得默默绕过"做了前瞻性兜底）
- ⚠️ INFO-1：根目录 `.env.example` 的 `APP_PORT=3000` / `APP_BASE_URL=http://localhost:3000` 是本卡识别出的边界外漂移 · Agent 判定 Scope 外不处置（判定正确）· Reviewer 同意该判定 · 登记为新 FU 留档

---

## 1. 分项评分（30 分）

| 维度 | 满分 | 得分 | 备注 |
|---|---|---|---|
| **Scope 遵守** | 5 | 5 | 真相源零触碰 · 7 处改动每一处都可追溯到 dispatch §2 ✅ 段或 FU 建议路径 · D6~D8 镜像扩展判定正当 |
| **修复正确性** | 6 | 6 | 三源 URL 对齐 SSOT 无误（`http://localhost:8080/v1` ≡ server/.env.example PORT=8080 ≡ domains.md §1.1 local 行）· parsePort 默认 `'8080'` 与部署权威一致 |
| **CI 强度提升** | 5 | 5 | 豁免集合从 `{dev}` → `{}` 规则 A/B 恢复全量强度 · 核心闸 warning 从 2 条降为 0 · `exemptedTag` 小工具 + 注释"未来注入必伴 FU"体现深思熟虑 |
| **四闸证据完整** | 4 | 4 | 六份 exit code 显式证据（node-check / check:whitelist / root-tsc / server-tsc / root-vitest 13/13 / server-vitest 8/8）· 零漏 |
| **文档一致性** | 4 | 4 | D6（Human 验证手册）+ D7（miniprogram README）+ D8（单测注释）三处镜像全部同步 · 非 Scope 外的文档也做了 grep 穷尽（D5 no-op 有证据） |
| **FU 闭环** | 3 | 3 | FU-COMMON-DEV-URL-DRIFT + FU-115-1 双关闭 · owner_card + resolved_by + 详细追溯段完整 |
| **注释/可追溯性** | 3 | 3 | whitelist-check.mjs 顶部注释明确 COSTRA-115→116 的前后历史 · setup.ts 保留了 COSTRA-101 R3 的历史上下文 |

**总分 30/30**

---

## 2. 分文件精审

### ✅ `server/src/config/env.ts` L93

`parsePort(optional(env, 'PORT', '3000'))` → `'8080'`。

- 与 `.env.example PORT=8080` 对齐 ✅
- 与 server/api/openapi.yaml servers[0] `http://localhost:8080/v1` 对齐 ✅
- `parsePort` 内部校验 `[1,65535]` · `8080` 通过 ✅
- test/setup.ts 依赖的 "无 PORT 时回退默认值" 行为仍然成立 · inject 模式不监听端口 · 8/8 server 单测 pass 证实无回归 ✅

**Review 判定**：修改最小 · 正确 · 无副作用。

### ✅ `miniprogram/services/env.ts` L17

`http://127.0.0.1:3000/v1` → `http://localhost:8080/v1`。

- 与 SSOT `infra/wechat/domains.md §1.1 local` 行对齐 ✅
- 与 server 真实启动 URL 对齐 ✅
- 与 openapi.yaml servers[0] 对齐（解锁 whitelist-check.mjs 规则 A）✅
- 未触碰 staging / prod（Scope 严守）✅

**Review 判定**：最小 diff · 正确。

### ✅ `scripts/devops/whitelist-check.mjs`（三处子改动）

- **子改动 1**：`EXEMPTED_ENVS_FROM_RULES_AB = new Set()` + `EXEMPTION_REASON` 常量删除。顶部注释详尽叙述"COSTRA-115 临时 → COSTRA-116 清零"演进 + 前瞻性约束"未来注入必伴 FU"。✅
- **子改动 2**：抽 `exemptedTag(env)` 内联小工具替代已删常量。保留豁免分支框架（空 Set 下自然不进），未来扩展友好。✅
- **子改动 3**：warnings 头部硬引 FU 名字改为"见 .team/follow-ups/README.md"通用语 · 解耦脚本与具体 FU 耦合。✅

**Review 特别认可**：**没有删整个豁免分支代码**。这个选择是对的——保留框架意味着未来若需临时豁免，只需往 Set 里加元素即可，无需重写对账逻辑。而注释里明确的"必伴 FU + 双签"前瞻约束，为未来的滥用提供了天然壁垒。

### ✅ `server/test/setup.ts` L34 注释

`'3000'（COSTRA-101 R3 Verify 修复）'` → `'8080'（COSTRA-116 对齐 .env.example · 原 '3000' 为 COSTRA-101 R3 Verify 时选值）`。

**Review 判定**：保留了 COSTRA-101 R3 的历史上下文 · 追溯链完整 · 反映新默认。

### ✅ `docs/qa/costra-102-human-verify.md` L26

**Review 重点关注**：这是 Human 04-30 要按步跑的那份手册。Agent 改这一行显著降低 Human 验证失败概率 · 且加了"COSTRA-116 已对齐 SSOT · server/.env.example PORT=8080"方括号注解，便于 Human 读懂为什么是 localhost:8080 而不是别的。

### ✅ `miniprogram/README.md` L53

env 表格镜像 · 纯同步改动。

### ✅ `.team/follow-ups/README.md`

- 顶部"COSTRA-115 R1 后状态流转"表：两条 FU 状态 `open` → `closed` + `owner_card` 补齐
- FU-COMMON-DEV-URL-DRIFT 条目：保留原问题描述 + 新增"COSTRA-116 正式修复"5 步清单（含 ✅ 标记）+ `resolved_by` 简述
- FU-115-1 条目：`resolved_by` 附 `EXEMPTED_ENVS_FROM_RULES_AB` 清空的具体处置

**Review 判定**：追溯链最佳实践 · 后人读到 FU 档案能一眼读懂"为什么开 → 怎么补丁维持 → 怎么根治"三段。

---

## 3. INFO-1 · 根目录 `.env.example` 边界外漂移（登记新 FU）

### 现状

根目录 `/Users/weizhao/Desktop/Costra/.env.example` L8-11：

```
# ---- 应用 ----
NODE_ENV=development
APP_PORT=3000
APP_BASE_URL=http://localhost:3000
```

### 问题判断

- 变量名 `APP_PORT` / `APP_BASE_URL` **不是** `server/src/config/env.ts` 消费的 `PORT`
- 该文件登记于 `86fa7f7 chore(devops): 初始化工程基建与 Sprint-0 CI 骨架`（Sprint-0）
- 初判定：docker-compose / 根目录 orchestration 层模板
- 语义上仍引导用户往 3000 想 · 和 SSOT（8080）冲突 · 但**不会直接 break 任何跑得起来的东西**（因为没代码在消费它）

### 为什么 Agent 不改（Reviewer 同意）

- Scope 铁律 · 该文件不在 dispatch §2 范围
- 盲改可能 break 未可见的 shell 脚本 / CI job
- 判定属边界外漂移 · 比 FU-COMMON-DEV-URL-DRIFT **更低优先级**（该 FU 是真实会挂链路；本 INFO 是潜在语义误导）

### 建议 Action

**登记 FU-116-1 · 根目录 .env.example 的 APP_PORT/APP_BASE_URL 与 SSOT 潜在语义冲突**

- 阻断级别：**P3（观察项）** · 不阻任何卡 · 不会挂任何链路
- 建议：Sprint-1 末 Retro 由 DevOps-Agent 一张小卡甄别：
  1. `grep -r APP_PORT\|APP_BASE_URL` 找到所有消费方（若有）
  2. 若真无消费方 → 删除该两行（或整个"应用"段）
  3. 若有消费方 → 同步改为 `APP_PORT=8080` + `APP_BASE_URL=http://localhost:8080`
- 认领建议：Sprint-1 末 · DevOps-Agent / 0.5 点

**Reviewer 下单建议**：本条登 `.team/follow-ups/README.md` FU-116-1 · Orchestrator 收口时追加。

---

## 4. 对账四闸交叉验证

Reviewer 本轮独立执行以下 cross-check：

### Check-1 · `npm run check:whitelist` 真的零 warning？

```bash
$ npm run check:whitelist 2>&1 | grep -c "warning\|WARNING\|EXEMPT"
0
```

（脚本本身注释有 "warning" 字眼不计 · 仅检查 stdout）

实测 stdout 仅 `✅ whitelist consistent: ...`，无任何 `⚠️` 或 `[A · EXEMPTED]`。**核心价值验证通过**。

### Check-2 · 三源对账一致性（独立人工算一遍）

- `server/api/openapi.yaml servers`：`{localhost:8080, 49.235.216.20:8080, api-staging.costra.cloud, api.costra.cloud}` (4 条)
- `miniprogram/services/env.ts apiBaseUrl`：`{dev: localhost:8080, staging: api-staging.costra.cloud, prod: api.costra.cloud}` (3 条)
- `infra/wechat/domains.md §1.1`：`{local: localhost:8080, dev-ip: 49.235.216.20:8080, staging: api-staging.costra.cloud, prod: api.costra.cloud}` (4 条)

**对账**：
- 规则 A：env.ts 3 条 ⊆ openapi 4 条 ✅
- 规则 B：env.ts 3 条 url 全在 domains.md §1.1 中 ✅
- 规则 C：env.ts 同名 env 值与 domains.md 同名行一致（env.ts 无 "local"/"dev-ip" 键 · 只比 staging/prod · 都一致）✅

**三方强一致 · 确认**。

### Check-3 · 单测回归

- server 8/8 pass 402ms（含 auth 全路径 + healthz）
- root 13/13 pass 161ms（含 money/time/request/auth spec）
- 无任何 skip / todo

### Check-4 · 是否 break 某个硬编码假设了 127.0.0.1:3000 或 3000 的地方？

`grep -r "127\.0\.0\.1:3000\|:3000/v1"` 在本 commit 后：

```
# 根目录 .env.example L11: APP_BASE_URL=http://localhost:3000  ← 已登 FU-116-1
# 无其它匹配
```

`grep -r "PORT.*=.*3000\|'3000'"` 在本 commit 后：

```
# 根目录 .env.example L10: APP_PORT=3000  ← 已登 FU-116-1
# 无其它 source/test 匹配
```

**无遗留硬编码假设**（除已 FU 登记的根目录 .env.example）。

---

## 5. Handoff

- **结论**：**APPROVE** · 无 R2 需求 · 单轮闭环
- **转 Human**：等 `approve:COSTRA-116`
- **Orchestrator 收口动作**：
  1. 把 INFO-1 登记为新 FU-116-1（P3 观察项 · Sprint-1 末 DevOps 小卡）
  2. 更新 STATE / board / metrics / messages
  3. 单卡 commit（D-012）

---

**Review-Agent-Tech 出庭意见结束 · 签名 2026-04-27 15:25。**
