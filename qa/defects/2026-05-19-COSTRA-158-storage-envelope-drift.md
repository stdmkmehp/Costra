# BUG-COSTRA-158-R1-STORAGE-ENVELOPE-DRIFT

> **缺陷单时间**：2026-05-19 19:13（Human 实测 sprint-2-batch-human-smoke step 3 触发 · COSTRA-158 R1 H 项 · 真链路 BUG）
> **来源会话**：sprint-2 批量实测 step 2/3 中 Human Console `t.d.raw.user...` 报 `Cannot read property 'raw' of undefined` · 诊断后发现 storage envelope 一致性破坏
> **严重级别**：**P0**（重启即登出 · 用户体验阻断）
> **关联卡**：COSTRA-158 R1 commit `c7ea7f7`（H 项 §2.1 H + §2.4 P1-1 修订 client 消费策略）
> **R1 Review 漏检**：D-022 v2.0 第 6 次实战 38/45 APPROVE · §3 §4 §5 反向核查全过 · **未识别 storage 写入路径不一致**
> **D-022 §4.1 真兑现**：runtime 类 T2 卡 Human 实测前置铁律第 2 次正向兑现（第 1 次为 105 H6 BLOCKED-BY-COSTRA-154）
> **复现 Human 操作环境**：微信开发者工具 macOS 2.01.2510290 · 基础库 3.8.12 · COSTRA-158 R1 commit c7ea7f7（HEAD = 0ce8b9c）

---

## §1 现象

### §1.1 Human 实测路径

1. Human 在真链路下（dev env · `mockLogin: false`）冷启 + 点"一键微信登录"
2. wx.getUserProfile 静默成功（微信 2022 起返回"微信用户" + 灰头像 thirdwx.qlogo.cn 默认）
3. POST /v1/auth/wx-login 200 → 拿到 token + user payload
4. PATCH /v1/users/me 200 → server 设 has_completed_profile=true
5. **client `pages/login/index.ts` PATCH 成功后调 `auth.updateLocalUserProfile({...})`**（COSTRA-158 H 项 + §2.4 P1-1 修订实装）
6. `updateLocalUserProfile` 用 `wx.setStorageSync(TOKEN_KEY, { raw, access_expires_at, refresh_expires_at })` **裸对象覆盖 storage**
7. home 页 hydrateUser 从 current 内存读 · 显示正常（has_completed_profile=true → 无完善资料入口）

### §1.2 触发的副作用（Human 实测中尝试 Console 改 storage 暴露）

Human Console 命令：
```js
const t = wx.getStorageSync('__costra_token_v1')
t.d.raw.user.has_completed_profile = false   // ← 报错
```

报错：
```
Uncaught TypeError: Cannot read property 'raw' of undefined
```

诊断命令：
```js
const t = wx.getStorageSync('__costra_token_v1')
console.log('keys:', Object.keys(t))         // ["raw", "access_expires_at", "refresh_expires_at"]
console.log('has .d?', 'd' in t)              // false
console.log('has .raw?', 'raw' in t)          // true
```

→ storage 中 token 是裸对象 · **没有 storage.ts envelope `{v, t, ttl, d}` 包装**。

### §1.3 真正的 P0 影响（未发生但必然发生）

如果 Human 此时杀小程序 + 重启：

1. `app.ts onLaunch` → `initAuth()` 调用 → `await getItem<TokenStored>(TOKEN_KEY)`
2. `storage.ts:58-76 getItem` 实装：
   ```ts
   const res = await wx.getStorage<Envelope<T>>({ key });
   const env = res.data;                              // env = { raw: {...}, access_expires_at, refresh_expires_at }
   if (!env || typeof env !== 'object') return null;  // pass · 是 object
   if (env.ttl && Date.now() - env.t > env.ttl) {     // env.ttl undefined · skip
     ...
   }
   return env.d;                                      // ← env.d 是 undefined！返回 undefined
   ```
3. `auth.ts initAuth:75-80`：
   ```ts
   const saved = await getItem<TokenStored>(TOKEN_KEY);  // saved = undefined
   if (saved && saved.access_expires_at > Date.now()) {  // saved 是 undefined · 短路 · 不进
     ...
   }
   // current 不被设置 · 视作未登录 · 跳 login 页
   ```
4. **用户重启即被强制重新登录** · access_expires_at 2h TTL 永远走不到

**关键**：因为 Human 当前会话**还没杀进程** · current 内存里还有 token · 所以截图显示登录态正常。**任何重启都会暴露这个 BUG**。

---

## §2 根因（3 层）

### §2.1 直接根因 · auth.ts:264-272 storage 写入路径不一致

文件：`miniprogram/services/auth.ts`

```ts
// L257-272 updateLocalUserProfile（COSTRA-158 H 项 · §2.4 P1-1 修订追加）
export function updateLocalUserProfile(
  partial: Partial<{
    nickname: string;
    avatar_url: string | null;
    has_completed_profile: boolean;
  }>,
): void {
  if (!current) return;
  Object.assign(current.raw.user, partial);
  // storage 同步写入 · 保持与 initAuth/clearToken 一致
  wx.setStorageSync(TOKEN_KEY, {                    // ❌ 错误路径：裸对象 + 同步 API
    raw: current.raw,
    access_expires_at: current.access_expires_at,
    refresh_expires_at: current.refresh_expires_at,
  });
}
```

**注释自相矛盾**："保持与 initAuth/clearToken 一致" → 但 initAuth/clearToken 用 `setItem`/`removeItem`（来自 storage.ts · 自带 envelope 包装）· **此处反而是不一致**。

### §2.2 中层根因 · review-tech R1 漏检 · D-022 评分维度盲点

D-022 v2.0 §3.4 维度对账：
- C2 代码质量 5/5：未扫"storage 写入是否经过 storage.ts setItem"
- C3 架构合理 5/5：未识别 auth.ts 直接 setStorageSync 绕过 storage.ts 抽象
- C8 runtime 加载性 5/5：纸面审无法触发"重启 → initAuth → getItem 读不到"链路

→ D-022 评分矩阵需补一条："凡 wx.setStorage*\* 直接调用必须由 storage.ts setItem 中介"（D-025 候选 AP-004）。

### §2.3 深层根因 · D-025 AP-003 契约-实装漂移变种

storage.ts envelope `{v, t, ttl, d}` 是 storage 层契约 · auth.ts L264-272 实装绕过契约直接 setStorageSync · 是 **AP-003 契约-实装漂移在模块内的微观变种**。

之前 AP-003 立案时只看到"OpenAPI vs server 路由"宏观漂移 · 未覆盖"模块抽象 vs 调用方"微观漂移。本 BUG 提示 AP-003 需扩展到模块层契约。

---

## §3 修复方案（option 1 推荐 · ≤ 5 行）

### §3.1 option 1（推荐）：改用 storage.ts setItem · 与其他写入路径一致

```ts
import { setItem, getItem, removeItem, type TokenStored } from './storage';
// ...
export async function updateLocalUserProfile(  // ← async 化（与 initAuth/doWxLogin 范式一致）
  partial: Partial<{
    nickname: string;
    avatar_url: string | null;
    has_completed_profile: boolean;
  }>,
): Promise<void> {
  if (!current) return;
  Object.assign(current.raw.user, partial);
  // storage 同步写入 · 走 storage.ts envelope · 与 initAuth/clearToken 一致
  await setItem<TokenStored>(TOKEN_KEY, {
    raw: current.raw,
    access_expires_at: current.access_expires_at,
    refresh_expires_at: current.refresh_expires_at,
  });
}
```

**调用方改动**：`miniprogram/pages/login/index.ts` PATCH 成功后的 `auth.updateLocalUserProfile(...)` 加 `await`。

### §3.2 option 2（不推荐）：保留裸对象 · 修 storage.ts getItem 兜底裸对象

复杂度高 · 破坏 storage.ts 抽象 · 反向兼容历史数据成本不可控 · **不采纳**。

### §3.3 单测补强

`miniprogram/services/auth.spec.ts` 加测：

```ts
test('updateLocalUserProfile 写入后 · initAuth 重启可读到新值', async () => {
  // 1. 模拟首登态
  __test__.setCurrent(stored);
  // 2. 调 updateLocalUserProfile
  await updateLocalUserProfile({ nickname: '张三', has_completed_profile: true });
  // 3. 重置内存 · 模拟杀进程
  __test__.reset();
  // 4. initAuth 重启
  await initAuth();
  // 5. 期望 current 被恢复 · 且 user.nickname='张三' has_completed_profile=true
  expect(getCurrentToken()?.raw.user.nickname).toBe('张三');
  expect(getCurrentToken()?.raw.user.has_completed_profile).toBe(true);
});
```

→ 这条测试如果 R1 写了 · 当时就能拦住 BUG。**review-tech 应在 C6 维度扣分要求加此测**（漏检根因）。

---

## §4 修复路径决策（待 Human）

| 选项 | 含义 | 估时 | 影响 |
|---|---|---|---|
| **A** | 立 R1.x.1 紧急修补卡 · backend-dev/miniapp-dev 修 auth.ts L264-272（option 1） + 加单测 + R1.x review | ~30 min 单 commit | 阻 158 approve · 重测 step 3+7 |
| **B** | Human 测完 step 3+8（用 Console hotfix 续测）+ 整体实测后立 R1.x | ~5 min 续测 + ~30 min 修 | 不阻实测节奏 |
| **C** | 暂停实测 · 立刻修 P0 | ~30 min | 强制阻塞 |

**Orchestrator 推荐 B**：
- 当前会话 token 内存有 · 不重启不暴露表层 BUG
- step 3+8 都可以用 Console hotfix（裸对象包成 envelope 写回）继续验
- 完整实测后立 R1.x · 修 + 加单测 + 重启验证 · 单 commit 收尾
- 不阻 D-024 §2.4 攒批节奏

---

## §5 续测 hotfix（Human 跑完即可继续 step 3）

```js
// 临时把 storage 改成 envelope 格式 + has_completed_profile=false（验 step 3）
const raw = wx.getStorageSync('__costra_token_v1')
raw.raw.user.has_completed_profile = false
const wrapped = { v: 1, t: Date.now(), d: raw }
wx.setStorageSync('__costra_token_v1', wrapped)
console.log('hotfix done · envelope wrapped + has_completed_profile=false')
console.log('verify:', wx.getStorageSync('__costra_token_v1').d.raw.user.has_completed_profile)
```

跑完 → 杀小程序 → 重启 → 看 home 页右上角是否出现"完善资料 →"。

---

## §6 联合 Sprint-2 末 Retro 议题候选（沉淀）

- 🆕 **议题候选 · D-022 v2.0 评分表加 "storage 写入路径一致性" 检查**：C3 架构合理维度增加"凡 wx.setStorage* 直接调用必须由 storage.ts setItem 中介"扫描项 · 与 D-025 AP-004 候选条目同步立案
- 🆕 **议题候选 · D-025 AP-003 契约-实装漂移升级**：从"宏观契约（OpenAPI vs server）"扩展到"微观契约（模块抽象 vs 调用方）"· 增加扫描范围
- 🆕 **议题候选 · 单测覆盖盲点**：updateLocalUserProfile R1 已加 5 测（auth.spec.ts G' 项）· 但**未加"写入后 initAuth 重启回读"路径** · review-tech C6 维度漏检 · 议入"runtime 持久化测试范式"

---

## §7 修订记录

| 版本 | 时间 | 修订 |
|---|---|---|
| v1.0 | 2026-05-19 19:15 | 初版立案 · Human 实测 step 3 触发 · 诊断 envelope 一致性破坏 · option 1 修复方案 + R1.x.1 路径建议 |

---

**事实源 / 依据**：

- COSTRA-158 R1 commit `c7ea7f7`（auth.ts L264-272 H 项实装）
- COSTRA-158 dispatch §2.1 H + §2.4 P1-1 修订（client 消费策略）
- COSTRA-158 Card-Review R1 27/30 PASS（未识别）+ R1 Review 38/45 APPROVE（未识别）
- storage.ts L48-76 setItem/getItem envelope 范式（来自 COSTRA-103/125 历史）
- Human 实测会话：sprint-2-batch-human-smoke step 2/3 · 2026-05-19 19:13
- Human 控制台输出：`keys: ["raw", "access_expires_at", "refresh_expires_at"]` · `has .d? false`
- 关联范式：D-022 §4.1 runtime 类 T2 卡铁律（第 2 次实战触发） · D-025 AP-003 契约-实装漂移（微观变种）
