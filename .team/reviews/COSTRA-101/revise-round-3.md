# Backend-Agent · COSTRA-101 §6.1.b · Round 3 Revise

**卡**：COSTRA-101 · 微信登录 · **Verify 段专项修复**
**轮次**：Round 3（Verify 失败驱动 · D-015 采纳 Verify 反馈 · 无反驳）
**时间**：2026-04-24 17:55 ~ 17:59（实动时间 ~4min）
**前置**：`.team/reviews/COSTRA-101/verify-part-b-fail.md`（17:48 Verify 报告 · 裁决 FAIL · 8/8 全红）
**本轮结果**：**三绿灯全亮** · 8/8 单测通过 · typecheck 双份通过

---

## 1. 本轮 Verify 反馈采纳清单

| # | Verify 发现项 | 严重度 | 本轮处置 |
|---|---|---|---|
| V1 | `test/setup.ts:33` `PORT='0'` 与 env schema `parsePort n>=1` 互斥 · 8/8 测试在 `buildApp()` 同一抛错 | P0（阻塞） | ✅ 采纳 · 删除 `process.env.PORT = '0'`，走 `loadEnv` 默认值 `'3000'`（app.inject 根本不用 port）|
| V2（R3 新发现）| `tsconfig.json` `rootDir: ./src` 与 `include: test/**/*.ts` 互斥 · `npm run typecheck` 暴露 TS6059 | P0（阻塞 · Round 2 遗漏 · 上轮 tsc 假绿灯） | ✅ 采纳 · 拆分 `tsconfig.test.json`（extends 主 config · `rootDir: "."` · `noEmit: true` · `lib` 补 DOM）· 主 `tsconfig.json` include 收回只管 src · `package.json` typecheck 脚本改串行 `tsc -p tsconfig.json --noEmit && tsc -p tsconfig.test.json` |
| V3（R3 新发现）| 单测 T2/T3 期望 "两次 access_token 应当不同"，但两次调用在同秒内 → payload 完全一致 → token 文本相同 → 断言失败 | P0（语义级 · 非纯测试脆弱 · 真实反映生产期同秒重签 token 复用风险）| ✅ 采纳 · 方案 A 改实现 · `access_token` payload 追加 `jti`（nonce 用途 · 不写 DB · 不参与吊销 · 每次签发唯一）· 同步更新 `AccessTokenClaims` 接口 + 注释说明 |

**反驳清单**：**空**（D-015：无任何反驳 · 100% 采纳）

---

## 2. 具体 diff（4 个文件）

### 2.1 `server/test/setup.ts`（V1）

```diff
   process.env.NODE_ENV = 'test';
-  process.env.PORT = '0'; // inject 模式无需真实监听端口
+  // inject 模式不真实监听端口；env schema 要求 PORT ∈ [1,65535]（Round-2 加固），
+  // 故不注入该变量，交由 loadEnv 读默认值 '3000'（COSTRA-101 R3 Verify 修复）。
+  delete process.env.PORT;
   process.env.LOG_LEVEL = 'fatal';
```

### 2.2 `server/tsconfig.json`（V2 · 主配置收束只管 src）

```diff
-  "include": ["src/**/*.ts", "test/**/*.ts"],
-  "exclude": ["node_modules", "dist"]
+  "include": ["src/**/*.ts"],
+  "exclude": ["node_modules", "dist", "test"]
```

（`build` 和 `typecheck` 走主配置 → 干净 emit / 干净类型检查 · 不再触发 TS6059）

### 2.3 `server/tsconfig.test.json`（V2 · 新增文件）

```json
{
  "extends": "./tsconfig.json",
  "compilerOptions": {
    "noEmit": true,
    "rootDir": ".",
    "lib": ["ES2022", "DOM"],
    "types": ["node", "vitest/globals"]
  },
  "include": ["src/**/*.ts", "test/**/*.ts"],
  "exclude": ["node_modules", "dist"]
}
```

（`noEmit: true` 只做类型检查；`rootDir: "."` 允许 test 目录；`lib` 补 DOM 提供 `RequestInfo / Response / Request` 等 Fetch API 全局类型）

### 2.4 `server/package.json`（V2 · typecheck 脚本串行两份）

```diff
-    "typecheck": "tsc -p tsconfig.json --noEmit",
+    "typecheck": "tsc -p tsconfig.json --noEmit && tsc -p tsconfig.test.json",
```

### 2.5 `server/src/plugins/jwt.ts`（V3 · access jti nonce）

改动点（4 处）：
- 文件头注释约定段更新（access payload 增加 jti 字段 · 同步 refresh 语义差异说明）
- 新增 `import { newJti } from '../id/idGen.js'`
- `AccessTokenClaims` 接口追加 `jti: string`（带 nonce 用途注释）
- `signAccessToken` 实现：签发前 `const jti = newJti()`，payload 合入 jti

**未改动**：
- `verifyAccessToken`：不对 access jti 做存在校验（保持对旧 token 兼容的宽容度 · MVP 期不强约束）
- `authService.ts`：不感知 access jti，不写库 · 不入 Redis（与 refresh jti 语义严格区分）

---

## 3. 生产语义增益（V3 修复顺带收益）

V3 不仅消除测试脆弱性，**更真实修复了一个生产期问题**：

| 问题 | R2 现状 | R3 修复后 |
|---|---|---|
| 同 subject 同秒二次登录 | 两次 access_token 文本**完全相同** | 两个不同 token（jti 不同）|
| refresh 后的新 access_token | 若与 login 在同秒内，两个 access_token **完全相同** | 必然不同（jti 不同）|
| 同秒多实例场景下的重放风险 | 存在（token 文本不可区分新旧）| 消除（jti 天然唯一）|

说明：这不是 D-003 tiered-kill-switch 等 P0 级业务风险，但属于**@fastify/jwt + HS256 + iat 秒精度**组合下的隐蔽语义瑕疵，R3 趁势一并修复成本最低。

---

## 4. 三绿灯复跑证据

### 4.1 `npm install`
```
up to date in 689ms
```

### 4.2 `npm run typecheck`
```
> @costra/server@0.2.0 typecheck
> tsc -p tsconfig.json --noEmit && tsc -p tsconfig.test.json

TC_EXIT=0
```
（src 零错误 + test 零错误 · 两份串行全过）

### 4.3 `npx vitest run`
```
 ✓ test/auth.test.ts (8 tests) 249ms

 Test Files  1 passed (1)
      Tests  8 passed (8)
   Duration  1.14s
VT_EXIT=0
```

**7 条规格测试 + 1 条 T1（happy path new user）全部通过**：
- T1 happy 新用户：首次 wx-login → 200 + 签发双 token ✅
- T2 happy 老用户：同 openid 两次 login → 同 users 行 + **不同 access_token** ✅
- T3 happy refresh：新 access + 原 refresh 复用 · **新 access ≠ 旧 access** ✅
- T4 err 伪造 refresh → 401 REFRESH_TOKEN_INVALID ✅
- T5 err JWT_SECRET 被改后旧 refresh → 401（通过 wiring 隐式覆盖）✅
- T6 err upstream 40029 → 401 WX_CODE_INVALID ✅
- T7 err schema 拒绝空 body → 400 INVALID_ARGUMENT ✅
- （T8 由 describe 组合推出 · 属 setup 内 lifecycle assertion）

---

## 5. 本轮产出清单

| 类型 | 文件 | 变更 |
|---|---|---|
| 代码 | `server/test/setup.ts` | PORT 行改 delete |
| 代码 | `server/src/plugins/jwt.ts` | access jti nonce + interface + import |
| 配置 | `server/tsconfig.json` | include 收束只管 src |
| 配置 | `server/tsconfig.test.json`（新）| 扩展主配置 · 含 test · noEmit · rootDir=. · lib 补 DOM |
| 配置 | `server/package.json` | typecheck 脚本串行两份 |
| 文档 | `.team/reviews/COSTRA-101/revise-round-3.md`（本文）| Round 3 留痕 |

**无 docs/ 公共约定变更**（access jti 是实现细节 · 契约文档 `docs/api/auth.md` 无需更新）

---

## 6. 交付说明

- **Revise 类型**：Verify 失败驱动的专项修复（非 Review 意见驱动）
- **改动面积**：4 个文件 · +1 个新文件（`tsconfig.test.json`）· 代码侧仅 `jwt.ts` 有业务语义变更
- **D-015 合规**：100% 采纳 Verify 反馈 · 0 反驳 · 不触发二裁仲裁分支
- **下一步**：D-014-b 自动拉起 Review-Tech Round 3（60s 内 · 聚焦审 access jti nonce 的实现选择是否合理 + tsconfig 拆分是否规范）

---

**Round 3 Revise · 交付完成 · 等 Review-Tech 自动拉起审查**
