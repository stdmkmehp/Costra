# COSTRA-101 §6.1.b Verify 实跑验证 · 裁决：FAIL

- **时间**：2026-04-24 17:48+08:00
- **触发指令**：Human `verify backend COSTRA-101`
- **执行位置**：`h:\Costra\server`
- **执行者**：Orchestrator（Review-Tech 视角 · 实跑验证）
- **裁决**：❌ **FAIL · 8/8 单测全红 · 统一病灶**
- **性质**：§6.1.b 分段 Verify（T1 准入的实跑段 · 不等于 §6.1.a Review 回退，§6.1.a Human T1 approve **仍然有效**）

---

## 1. 三绿灯实跑结果

| 步骤 | 命令 | 结果 | 证据 |
|---|---|---|---|
| 1. install | `npm install --no-audit --no-fund` | ✅ **PASS** | `up to date in 689ms`（`server/package-lock.json` 已存在 · 依赖齐全） |
| 2. type-check | `npx tsc --noEmit` | ✅ **PASS** | 零错误零输出 · exit 0（Round 2 Runner 重构类型收敛有效） |
| 3. unit-test | `npx vitest run` | ❌ **FAIL · 8/8** | 统一失败 · 根因锁定 · 详见 §2 |

**结论**：前两绿灯有效，**第三绿灯全红**。Verify **不通过**。

---

## 2. 根因定位（单点病灶 · 高置信度）

### 病灶

所有 8 条单测都在 `test/auth.test.ts:24` 的 `buildApp()` 调用处抛同一异常：

```
Error: [env] PORT must be integer in [1, 65535], got: 0
  ❯ parsePort    src/config/env.ts:70:11
  ❯ loadEnv      src/config/env.ts:93:11
  ❯ Module.appEnv src/config/env.ts:126:18
  ❯ Module.buildApp src/app.ts:34:15
  ❯ test/auth.test.ts:24:15
```

### 根因

**Round 2 Revise 的 env schema 加固**与**测试 setup 的端口约定**互斥：

| 侧面 | 事实 |
|---|---|
| `src/config/env.ts:67-72` `parsePort` | `!Number.isInteger(n) \|\| n < 1 \|\| n > 65535` → 抛错（Round 2 Revise 新增的启动期校验 · 属 P1 安全加固范畴） |
| `test/setup.ts:33` | `process.env.PORT = '0'` · 注释：`// inject 模式无需真实监听端口` |
| 冲突 | `0` 被严格校验拒绝 · test 路径完全进不去 `buildApp` |

### 二者都没错 · 但必须二选一迁就

- **选项 A（建议）**：test 端改 `PORT=3000`（任意合法占位即可 · vitest 走 `app.inject()` 根本不 `app.listen()`，PORT 是"必填但不真用"的配置值）
- **选项 B**：env.ts 的 `parsePort` 对 `nodeEnv === 'test'` 放宽到 `n >= 0`（允许 0 表示"inject 模式占位"）
- **选项 C**：test/setup.ts 整列删 `PORT` 行 · 让 env.ts 走 optional 默认值 `'3000'`

**推荐 A**：改动面最小（1 行） · 语义最直白 · 不破坏生产 schema 的严格性。

### 为什么 Round 2 Review 没抓到？

- Round 2 **是静态审查 + 代码阅读**，Review-Tech 确实在 Runner/JWT/MALFORMED_JSON/redact 四条线做了深查，但**未实跑单测**（Review 角色无此义务，实跑是 Verify 段的职责）
- 这正是分段交付 §6.1.a 骨架段 → §6.1.b Verify 段**存在独立 Gate** 的设计价值：§6.1.a 终审放行不代表"能跑"，§6.1.b Verify 专门兜实跑回归
- **结论**：Verify 段正确兜住了这个回归缺陷 · 分段规约有效

---

## 3. 失败用例清单（全部同根）

| # | 用例 | 失败信息 |
|---|---|---|
| T1 | `POST /auth/wx-login` happy 首登 | `[env] PORT must be integer in [1, 65535], got: 0` |
| T2 | `POST /auth/wx-login` happy 老用户复用 | 同上 |
| T6 | `POST /auth/wx-login` err code 过期 | 同上 |
| T7 | `POST /auth/wx-login` Schema 拒绝空 body | 同上 |
| T3 | `POST /auth/refresh` happy | 同上 |
| T4 | `POST /auth/refresh` 伪造 token | 同上 |
| T5 | `POST /auth/logout` 幂等 | 同上 |
| — | `GET /healthz` | 同上（setup 里 `buildApp` 就炸，测试文件里第 8 个用例 healthz 随同陪葬） |

**总计**：Test Files 1 failed · Tests 8 failed · Duration 1.43s · exit 1

> 注：报告头标 7 条用例（dispatch §1 DoD D6）· 实际测试文件 8 条（含 `GET /healthz` 健康检查用例 · 非 DoD 要求 · Backend 主动加码 · 不违约）

---

## 4. 附加发现（观察项 · 不阻本 Verify）

### O-V-1 · Vite/Vitest CJS 弃用警告（非阻塞）

```
The CJS build of Vite's Node API is deprecated. See https://vite.dev/guide/troubleshooting.html#vite-cjs-node-api-deprecated for more details.
```

- **触发**：vitest 2.1.9 在 Node 环境下走 CJS 路径
- **影响**：仅 warn · 不影响结果
- **处置**：Sprint-2 可随 Vitest 3.x 升级一并处理（或加 `"type": "module"` 到 `server/package.json` · 但需配合 ESM import 扩展名全扫 · 成本较大）
- **结论**：不阻 Verify · 不计入 finding · 与 FU-001/O-1 同档位

### O-V-2 · 健康检查用例陪葬（已在 §3 脚注说明）

Backend 在测试文件末尾多加了 `GET /healthz` 一条（DoD D6 原本只要 T1-T7 七条）· 由于 setup 在 `beforeEach` 建 app 即炸 · 第 8 条也 fail。该"加码测试"本身是正向的 · Backend 态度加分 · 修复后会一起回绿 · 无需单独处置。

---

## 5. 处置建议（等 Human 拍板）

### 路径 1 · Round 3 Revise（推荐 · 最小改动）

- **触发**：Human 发 `run backend COSTRA-101 revise-round-3`（D-015 规约 · revise 承担"采纳+修复"）
- **修复范围**（极小 · 预计 10 分钟交付）：
  - **方案 A**（首选）：`test/setup.ts:33` `process.env.PORT = '0'` → `process.env.PORT = '3000'`（或删除该行走默认值）
  - 同时在 test/setup.ts 开头注释登记："PORT 走合法占位 · vitest 走 inject 不实际监听 · Round 3 Verify 回归修复 2026-04-24"
- **Round 3 Review-Tech 裁决**：本修复属"回归最小修 · 不触发新 P0/P1"· 预期 PASS 一轮收 · 按 D-011/D-013 T1 档位仍需 Human T1 终审（但 §6.1.a 终审已 approve · 本次是"Verify 段 T1 二审 · 仅看修复是否合规 + 三绿灯是否真绿"）
- **D-015 适用**：Round 3 不是 §6.1.a 的延续 · 是 §6.1.b Verify 段的第 1 次 Revise · metrics 独立记录

### 路径 2 · Backend 直接自修自 Verify（快速 · 不走 Review）

- 适用条件：Human 主张"单点 typo 级 · 不值得再走 Review 一遍"
- 触发：`skip-review backend COSTRA-101 verify-fix` + Human 自己 review 修复 diff 后拍 `verify backend COSTRA-101`（re-run 三绿灯）
- 风险：偏离 D-011/D-013/D-014-b 的"AI-Review 兜底"机制 · 不建议除非明确紧急
- **不推荐**：此次失败性质偏"配置契约对齐疏漏"· 属 Round 2 交付质量负面信号 · 建议仍过 Round 3 Review 留痕

### 路径 3 · 跳过 Verify · Force-pass（最不推荐）

- 触发：`force-pass backend COSTRA-101 verify-part-b`
- 风险：**测试永久不跑** · 线上一旦启动即抛 env 错 · **生产级红线**
- **拒绝**：除非 Human 显式接受风险并在 STATE 登记 · 本 Verify 报告保持 FAIL 留痕

---

## 6. Verify 段裁决

| 维度 | 结论 |
|---|---|
| **§6.1.a Review 是否回退** | ❌ **不回退** · §6.1.a Human T1 approve 维持有效（分段独立 Gate） |
| **§6.1.b Verify 当前结果** | ❌ **FAIL** · 待 Round 3 Revise 修复后复跑三绿灯 |
| **Backend 交付质量** | 🟡 **扣分**（Round 2 未本地跑单测即交付 · 回归风险暴露） |
| **Review-Tech 责任** | ⚪ **无过** · 静态审查不含实跑义务（SOP-REVIEW-LOOP §4 未要求） |
| **分段规约价值** | ✅ **兑现**（Verify 段正确兜住） |

---

## 7. 下一触发窗口

| 优先级 | 指令 | 作用 |
|---|---|---|
| 🔴 **最高** | `run backend COSTRA-101 revise-round-3` | 走 Round 3 Revise · 单点 fix + 重跑 Verify |
| 🟡 替代 | `skip-review backend COSTRA-101 verify-fix` | Backend 自修自 Verify · 绕过 Round 3 Review（风险见 §5 路径 2） |
| 🔒 不推荐 | `force-pass backend COSTRA-101 verify-part-b` | 跳过实跑 · 风险详见 §5 路径 3 |

---

**VERIFY · COSTRA-101 §6.1.b · FAIL · 2026-04-24 17:48 · 根因单点 · 修复极小 · 等 Human 选路径**
