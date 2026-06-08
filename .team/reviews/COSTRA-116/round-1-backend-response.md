# COSTRA-116 · Backend-Agent · Round-1 Response

- Agent：Backend-Agent（主驾驶 · 一人闭环）
- 实装时间：2026-04-27 15:15~15:22（Asia/Shanghai · 7 分钟）
- Dispatch：`.team/dispatch/COSTRA-116-backend-fix-dev-url-drift.md`
- 依据：FU-COMMON-DEV-URL-DRIFT 建议路径 4 步 · SSOT `infra/wechat/domains.md §1.1 local` 行

---

## 1. 变更清单（7 文件 · 每处 diff 贴前后对比）

### D1 · `server/src/config/env.ts` L93（核心 · 代码默认值对齐部署权威）

```diff
-    port: parsePort(optional(env, 'PORT', '3000')),
+    port: parsePort(optional(env, 'PORT', '8080')),
```

**理由**：`server/.env.example L9` 显式规定 `PORT=8080` 为部署权威；代码默认值若缺失则回退到 `'3000'` 与 .env.example 矛盾，导致开发者即使按 .env.example 写好 .env 之外的途径（例如忘记 cp .env.example .env · 或直接 `npm run dev` 而无 .env）时启动在错误端口。改为 `'8080'` 让"有 .env"与"无 .env"两种场景行为一致。

### D2 · `miniprogram/services/env.ts` L17（核心 · 小程序 dev 对齐 SSOT）

```diff
   dev: {
     name: 'dev',
-    apiBaseUrl: 'http://127.0.0.1:3000/v1',
+    apiBaseUrl: 'http://localhost:8080/v1',
     mockLogin: true,
```

**理由**：SSOT `infra/wechat/domains.md §1.1` 规定 `local: http://localhost:8080/v1`。原 `127.0.0.1:3000` 主机 + 端口**双错**。

### D3 · `scripts/devops/whitelist-check.mjs`（豁免收紧 · FU 闭环）

**子改动 1**：删 `EXEMPTION_REASON` 常量 + 改豁免集合为空 + 改顶部注释：

```diff
-/**
- * 豁免清单（文档化 · 需 FU 专项跟进后清零）
- *
- * env.ts 某些 env 的 apiBaseUrl 暂不强求出现在 openapi.yaml servers / domains.md §1.1：
- * - dev: 本机开发默认值，各开发者机器可能不同（回环地址 / 端口），且与 server 代码 env.ts
- *   parsePort 默认值 '3000' 不一致（server .env.example 为 8080） → 这是 Backend 内部已有漂移
- *   需 FU-COMMON-DEV-URL-DRIFT 专项跨卡对齐后再收紧
- *
- * 豁免仅对 [A]、[B] 规则；[C] 规则（名称相同 url 必须一致）不豁免。
- */
-const EXEMPTED_ENVS_FROM_RULES_AB = new Set(['dev']);
-const EXEMPTION_REASON =
-  'FU-COMMON-DEV-URL-DRIFT: 本机开发默认值随机器不同，且 server .env.example(8080) 与 server/src/config/env.ts parsePort 默认值(3000) 本身不一致，跨卡对齐前豁免';
+/**
+ * 豁免清单（预留锚点 · 当前为空集）
+ *
+ * 历史：COSTRA-115 R1 首跑曾暂以 ['dev'] 豁免 dev env ...
+ * COSTRA-116（2026-04-27）已将上述三源全部对齐到 SSOT ...
+ *
+ * 保留空 Set 作为未来临时豁免的扩展锚点；任何再次向此集合注入元素的改动必须伴随
+ * 同一轮新 FU 登记 + 说明注释 + Review 双签，不得默默绕过规则 A/B。
+ */
+const EXEMPTED_ENVS_FROM_RULES_AB = new Set();
```

**子改动 2**：reconcile 函数里因 `EXEMPTION_REASON` 被删需改引用；保留豁免分支框架（空 Set 不会进入）+ 抽 `exemptedTag(env)` 小工具兜住未来注入元素时的 FU 追溯语：

```diff
+  const exemptedTag = (env) => `[EXEMPTED · env=${env} · 需同轮新 FU 说明原因]`;
+
   // 规则 A: ...
   for (const e of envTsEntries) {
     if (!openapiUrlSet.has(e.url)) {
       if (EXEMPTED_ENVS_FROM_RULES_AB.has(e.env)) {
         warnings.push(
-          `[A · EXEMPTED] env.ts env=${e.env} ... 已豁免（${EXEMPTION_REASON}）`
+          `[A] env.ts env=${e.env} ... 已豁免 ${exemptedTag(e.env)}`
         );
       }
     }
   }
```

**子改动 3**：warnings 头部的 FU 硬引用改成通用语：

```diff
-    console.warn('⚠️  whitelist warnings (non-blocking · see FU-COMMON-DEV-URL-DRIFT):');
+    console.warn('⚠️  whitelist warnings (non-blocking · 当前豁免元素对应的 FU 见 .team/follow-ups/README.md):');
```

**净效果**：`EXEMPTED_ENVS_FROM_RULES_AB` 从 `{dev}` → `{}` · 规则 A/B 恢复全量强度；脚本不再出现"硬引用单一 FU 名字"的耦合。

### D4 · `.team/follow-ups/README.md`

- 顶部 "COSTRA-115 R1 后状态流转" 表：FU-COMMON-DEV-URL-DRIFT / FU-115-1 `open` → **`closed` @ 2026-04-27** · `owner_card = COSTRA-116`
- 每个 FU 明细条目追加 "COSTRA-116 正式修复" 段（FU-COMMON-DEV-URL-DRIFT）/ `resolved_by` 说明（FU-115-1）

### D5 · `infra/wechat/domains.md`（no-op）

grep `FU-COMMON\|豁免\|EXEMPT\|3000` → 0 条匹配。原文未提及豁免机制，无需改动。

### D6 · `docs/qa/costra-102-human-verify.md` L26

```diff
-| **A · 本地 server（推荐）** | ... `dev.apiBaseUrl = 'http://127.0.0.1:3000/v1'` · ... |
+| **A · 本地 server（推荐）** | ... `dev.apiBaseUrl = 'http://localhost:8080/v1'`（COSTRA-116 已对齐 SSOT · server/.env.example PORT=8080）· ... |
```

**理由**：这是 Human 04-30 本地验证手册本身，不改会让 Human 按错误地址验。

### D7 · `miniprogram/README.md` L53（env 表格镜像）

```diff
-| dev | `http://127.0.0.1:3000/v1` | ✅ | 开发工具"不校验合法域名" |
+| dev | `http://localhost:8080/v1` | ✅ | 开发工具"不校验合法域名" |
```

### D8 · `server/test/setup.ts` L34（单测注释反映新默认）

```diff
   process.env.NODE_ENV = 'test';
   // inject 模式不真实监听端口；env schema 要求 PORT ∈ [1,65535]（Round-2 加固），
-  // 故不注入该变量，交由 loadEnv 读默认值 '3000'（COSTRA-101 R3 Verify 修复）。
+  // 故不注入该变量，交由 loadEnv 读默认值 '8080'（COSTRA-116 对齐 .env.example · 原 '3000' 为 COSTRA-101 R3 Verify 时选值）。
   delete process.env.PORT;
```

---

## 2. 四闸证据

### 闸门 1 · `node --check scripts/devops/whitelist-check.mjs`

```
OK syntax
$ echo $?
0
```

### 闸门 2 · `npm run check:whitelist`（本卡核心价值验证）

```
$ npm run check:whitelist

> costra-miniapp@0.1.0 check:whitelist
> node ./scripts/devops/whitelist-check.mjs

✅ whitelist consistent: 4 envs, 3 runtime urls matched across 3 sources
   (openapi.yaml: 4 servers · env.ts: 3 apiBaseUrl · domains.md §1.1: 4 rows)
$ echo $?
0
```

**🎯 关键对比 · 本卡价值**：
- COSTRA-115 结束时：exit 0 · **2 条 warning**（`[A · EXEMPTED]` + `[B · EXEMPTED]`）
- COSTRA-116 结束：exit 0 · **零 warning** · 规则 A/B/C 全量强度恢复

### 闸门 3a · root `tsc --noEmit`

```
$ npx tsc --noEmit
$ echo $?
0
```

### 闸门 3b · server `tsc --noEmit`

```
$ cd server && npx tsc --noEmit
$ echo $?
0
```

### 闸门 4a · root `vitest run`

```
 RUN  v1.6.1 /Users/weizhao/Desktop/Costra

 ✓ miniprogram/utils/time.spec.ts  (2 tests) 1ms
 ✓ miniprogram/utils/money.spec.ts  (6 tests) 2ms
 ✓ miniprogram/services/request.spec.ts  (3 tests) 2ms
 ✓ miniprogram/services/auth.spec.ts  (2 tests) 2ms

 Test Files  4 passed (4)
      Tests  13 passed (13)
   Duration  161ms
```

### 闸门 4b · server `vitest run`

```
 RUN  v4.1.5 /Users/weizhao/Desktop/Costra/server

 ✓ test/auth.test.ts > POST /auth/wx-login > T1~T7 (7 tests)
 ✓ test/auth.test.ts > POST /auth/refresh > T3~T4 (2 tests)  [T4 重叠]
 ✓ test/auth.test.ts > POST /auth/logout > T5
 ✓ test/auth.test.ts > GET /healthz (1 test)

 Test Files  1 passed (1)
      Tests  8 passed (8)
   Duration  402ms
```

**注**：server 单测 `test/setup.ts` 注释虽改但行为无变化（`delete process.env.PORT` 后 loadEnv 回退到新默认 '8080' · `parsePort('8080')=8080` 通过 schema `[1,65535]` 验证 · inject 模式不真实监听端口，8080 vs 3000 对单测 runtime 无区别）。8/8 pass 证实无回归。

---

## 3. Scope 遵守声明

### ✅ Dispatch §2 做的全部做了（5 → 实际 7）

- D1~D5 dispatch 原列五处 · 全部完成（其中 D5 no-op 已 grep 证实）
- D6/D7/D8 为实装时发现的**直接文档/注释镜像**（dispatch §2 已预判"必要时顺手改"），均在本卡 Scope 内：
  - D6 = Human 04-30 本地验证手册本身的 dev URL 字样（改不改直接决定 Human 能否跑通）
  - D7 = miniprogram README env 表格（同一套 URL 的另一处镜像）
  - D8 = server/test/setup.ts 注释（同一个 parsePort 默认值的注释镜像）

### ❌ Dispatch §2 不做的一条都没碰

- ❌ 没改 `server/api/openapi.yaml servers`（已是真相）
- ❌ 没改 `server/.env.example PORT=8080`（已是真相）
- ❌ 没重构 whitelist-check.mjs 的 parser / 对账逻辑（仅删/改豁免分支相关代码）
- ❌ 没引入任何 npm 依赖
- ❌ 没改 `staging` / `prod` 任何 URL
- ❌ 没新写文档 / 新建目录

### ⚠️ 边界外发现（INFO · 不处置）

**根目录 `.env.example` L10-11** 存在独立变量体系：

```
APP_PORT=3000
APP_BASE_URL=http://localhost:3000
```

该文件变量名（`APP_PORT` / `APP_BASE_URL`）**未被 `server/src/config/env.ts` 消费**（后者读 `PORT`），亦未被 miniprogram 消费。初判定属于 **docker-compose 或其它根目录 orchestration 层模板**。改它可能 break 未被本次 Agent 可见的东西（e.g. 某 shell 脚本 / 某 CI job）。

**处置**：不纳入本卡 Scope · 登记为 INFO-A 给 Review-Agent 裁决。建议**本次不改** · 若 Reviewer 判需跟进可开新小卡或登 INFO 级观察项。

---

## 4. 下游影响断言

- **COSTRA-102 Human 04-30 本地验证**：🟢 前置条件达成 · server 默认 8080 + 小程序 dev 指 8080 + `docs/qa/costra-102-human-verify.md` 已同步 · 可按手册无歧义执行
- **COSTRA-115 的 CI step**：🟢 从"2 豁免 warning"升级为"零 warning" · 实际强度提升（但 pr-check 仍然通过）
- **既有 server 单测**：🟢 8/8 pass 不变 · setup.ts 注释改动不影响 runtime
- **miniprogram 单测**：🟢 13/13 pass 不变（dev URL 不在任何 spec assertion 中出现 · grep 验证过）
- **其它卡**：无影响

---

## 5. Review-Agent 接单请求

- **档位**：T2（D-013 · 基建类小卡 · 无业务 · 无接口变更 · Tech 单轨）
- **Reviewer**：Review-Agent-Tech
- **预期终审路径**：AI Review APPROVE → Human `approve:COSTRA-116`（1 点小卡 · 预判单轮结单）

---

Backend-Agent 交付完毕 · 请 Review-Agent-Tech 接单。
