# Code Review: mockLogin 登录流程修复

- **审查日期**: 2026-07-21
- **审查范围**: `miniprogram/services/auth.ts` + `auth.spec.ts`
- **变更类型**: Bug fix — mockLogin 模式下小程序无法启动
- **审查重点**: 确保改动不会影响线上（staging/prod）正式登录流程

---

## 一、变更摘要

| 位置 | 变更 | 影响 |
|---|---|---|
| `auth.ts:doWxLogin()` | 删除 `mockExchange()` mock 分支，统一走 `POST /v1/auth/wx-login` | mockLogin=true 时行为改变 |
| `auth.ts:doRefreshToken()` | 删除 `mockExchange()` mock 分支，统一走 `POST /v1/auth/refresh` | mockLogin=true 时行为改变 |
| `auth.ts:logout()` | 删除 `!env.mockLogin` 条件，mock 模式也正常调远程 logout | mockLogin=true 时行为改变 |
| `auth.ts:mockExchange()` | 删除整个函数（32 行） | 无调用方残留 |
| `auth.spec.ts` | request mock 从空实现改为返回完整 TokenRaw 数据 | 测试适配 |

---

## 二、线上安全审查（核心关注点）

### 2.1 控制流分析：正式登录路径是否改变

**审查结论：正式路径零变化。**

```
doWxLogin() 控制流（修改后）：

  env = getEnv()
  code = wx.login()
  
  clientFp = env.mockLogin ? undefined : getOrCreateDeviceFp()
  //          ^^^^^^^^^^^^^^^^
  //          staging/prod: env.mockLogin = false → 走 getOrCreateDeviceFp()（与之前一致）
  //          dev: env.mockLogin = true → clientFp = undefined
  
  resp = request({ method:'POST', path:'/auth/wx-login', body:{code, client_fp:clientFp}, auth:false })
  //       ^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^
  //       staging/prod: 完全不变的请求（与之前真实链路 100% 一致）
  //       dev: 新增走服务端 /auth/wx-login（之前是客户端 mockExchange 跳过）
  
  ... 后续 restoreActiveFamilyAfterLogin / flushPendingPreference 路径完全不变 ...
```

**关键点**：
- `env.mockLogin` 在 staging 和 prod 中恒为 `false`（`env.ts` L29, L40）
- 当 `mockLogin=false` 时，`clientFp = await getOrCreateDeviceFp()`，与之前代码 L283 完全一致
- `request({...})` 调用与之前真实链路 L284-L289 完全一致
- `restoreActiveFamilyAfterLogin({...})` 调用与之前真实链路 L295-L300 完全一致

### 2.2 `client_fp` 为 `undefined` 时的服务端兼容性

**审查结论：安全。服务端 schema 中 `client_fp` 为 optional。**

验证链：
1. OpenAPI schema `required: [code]`，只有 `code` 是必填（`openapi.yaml` L75）
2. `client_fp` 有 `minLength: 1` 约束，但仅在字段存在时生效；字段不存在时不触发校验
3. Fastify schema 中 `client_fp: { type: 'string' }`（`auth.ts` L31），无 `required` 约束
4. 路由层 `body.client_fp ?? null`（`auth.ts` L65）正确将 `undefined` 转为 `null`
5. `authService.wxLogin(code, clientFp?: string | null)` 签名接受 optional + null（`authService.ts` L73）
6. `persistSession(user.id, pair.jti, pair.refreshTtl, clientFp ?? null)` 再次兜底（`authService.ts` L233）
7. `sessionRepo.insert` 中 `input.clientFp ?? null`（`sessionRepo.ts` L72）
8. `client_fp = NULL` 时回收逻辑只回收过期会话，不影响其他设备（`sessionRepo.ts` L136）

### 2.3 `logout()` 变更

**审查结论：安全。之前跳过的远程调用现在执行，但服务端 `/auth/logout` 是幂等的。**

- staging/prod 之前就走远程 logout（`!env.mockLogin` 为 true），无变化
- dev 环境现在也走远程 logout，服务端幂等实现保证多次调用安全
- `catch (e)` 吞错 + 继续本地清理的逻辑不变

### 2.4 `doRefreshToken()` 变更

**审查结论：安全。staging/prod 路径完全不变。**

- 删除了 `if (env.mockLogin)` 分支（`mockLogin=false` 时永不进入）
- 剩下的代码与之前真实链路完全一致
- `isRefreshStillCurrent` 保护 stale response 的逻辑保持不变

---

## 三、测试覆盖审查

### 3.1 测试通过情况

```
auth.spec.ts        14 tests ✅
family.spec.ts      15 tests ✅
request.spec.ts      3 tests ✅
总计                 32 tests ✅
```

### 3.2 测试场景覆盖

| 测试 | 场景 | mockLogin | 状态 |
|---|---|---|---|
| T7 | doWxLogin 双源一致性 | true | ✅ 适配（request mock 返回 TokenRaw） |
| T8 | initAuth 升级 | true | ✅ 通过 |
| T9 | initAuth 兜底 | true | ✅ 通过 |
| T10 | refresh + preference 恢复 | true | ✅ 通过 |
| T11 | refresh 空字符串保护 | true→false | ✅ 通过 |
| T12 | loginFlow 并发去重 | false | ✅ 无变化 |
| T13 | refreshToken 并发去重 | false | ✅ 无变化 |
| T14 | refresh 悬挂 + clearToken | false | ✅ 无变化 |

### 3.3 测试适配质量

T7~T10 的 request mock 从空实现改为返回完整 TokenRaw，mock 数据的 `default_family_id: 'f-default-001'` 与真实服务端返回格式一致。T12~T14 明确设置 `mockLogin: false`，验证真实链路，未受影响。

---

## 四、潜在风险与建议

### ⚠️ 中风险：mockLogin=true 时 `client_fp=undefined` 的行为差异

**问题**：mock 模式下不传 `client_fp`，服务端 session 回收逻辑不会按设备回收旧会话。但这属于 mock 环境内部行为，不影响生产。

**建议**：无需修改。mock 模式本身是开发环境，session 管理简化是可接受的。

### 💡 低风险：`getEnv` import 现在只在 `doWxLogin` 中使用

**问题**：`getEnv` 仍在 `auth.ts` 顶部 import（L8），但只在 `doWxLogin()` 的 `env.mockLogin` 一处使用。`logout()` 和 `doRefreshToken()` 不再需要 `getEnv`。

**建议**：可保留。`doWxLogin` 仍需 `getEnv`，import 不被 tree-shake 也不会造成问题。移除 `logout` 和 `doRefreshToken` 中的局部变量已足够干净。

### 💡 建议：考虑为 mockLogin 添加 e2e 冒烟测试

**问题**：当前没有覆盖"小程序 mockLogin + 服务端 WX_MOCK_LOGIN"端到端联动的自动化测试。

**建议**：可选。可在 CI 中增加一个 curl 验证（参考已有的 `docs/qa/costra-152-153-curl-verify.md` 模式），验证 `/v1/auth/wx-login` 在 mock 模式下返回合法 JWT 和 UUID 格式的 `default_family_id`。

---

## 五、总结评分

| 维度 | 评分 | 说明 |
|---|---|---|
| **线上安全性** | ✅ PASS | staging/prod 控制流零变化；所有 mockLogin 分支删除仅影响 dev |
| **代码质量** | ✅ PASS | 删除了 32 行死代码，逻辑更简洁；无硬逻辑 |
| **测试覆盖** | ✅ PASS | 14/14 全部通过；T7~T11 覆盖 mock 模式新路径；T12~T14 覆盖正式路径 |
| **向后兼容** | ✅ PASS | `client_fp=undefined` 完全兼容服务端 schema |
| **Lint** | ✅ PASS | 0 error |

**审查结论：通过。改动对线上正式登录流程无任何影响。**
