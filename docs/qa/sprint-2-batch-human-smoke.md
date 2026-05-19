# Sprint-2 批量实测清单 · COSTRA-157 + COSTRA-158（Round 1）

> **触发依据**：D-024 §2.2 C1（队列累计 2 张）+ C4（Human 主动反馈节奏 · 2026-05-19 14:30）双命中
> **执行人**：Human · **预计耗时**：~10 分钟（vs 单卡串行 ~15 分钟 · 节省 ~5 分钟 + 单次 setup）
> **验证模式**：mock 模式（Sprint-2 主线两张卡均为 T1-non-runtime / 不依赖真机 / 不依赖真 wx 链路）
> **覆盖卡**：
> - **COSTRA-157**（commit `ac204e3` · 5 FU 合并修复 · R1 review-tech APPROVE 38/40 · D-022 v2.0 第 5 次实战）
> - **COSTRA-158**（commit `c7ea7f7` · /users/me 完整实装 + has_completed_profile 严格资料判定 · R1 review-tech APPROVE 38/45 · D-022 v2.0 第 6 次实战）

---

## §0 前置（一次 setup · 两卡共用）

### §0.1 工具 & 凭证（≤ 2 min）

- [ ] **微信开发者工具** ≥ 1.06.x（基础库 3.8.12 · COSTRA-126）
- [ ] **项目根**：`/Users/weizhao/Desktop/Costra` · `dev` 分支 · HEAD 含 commit `ac204e3` + `c7ea7f7`（验：`git log --oneline -5` 应见 `c7225a7`/`c7ea7f7`/`3838412`/`0983f6f`/`ac204e3`）
- [ ] 装扮档已销毁 + 工作树干净（验：`git status --short` 应空）
- [ ] **可选 server 验证**：本批主走 mock 模式 · server 启动**仅在步骤 2 / 步骤 4 验真 PATCH 链路时需要** · 不想跑 server 可只验 mock 路径（mockExchange 已设 `has_completed_profile: true` · 158 §9 步骤 2/3 仍可视觉验证）

### §0.2 模拟器准备

1. 以**项目根**打开（不是 `miniprogram/` 子目录）
2. 顶部菜单 **工具 → 构建 npm**
3. 右上角 详情 → 本地设置 → 勾选 "不校验合法域名/TLS/证书"（mock 模式无影响 · 但若步骤 2/4 跑真 server 需勾）
4. **mockLogin 默认开启**（`miniprogram/services/env.ts` `dev.mockLogin: true`）· 不需改

### §0.3 起点重置（每步开始前）

```js
// Console 跑 · 仅清 client storage（不影响 DB）
wx.clearStorageSync()
console.log('storage cleared')
```

杀小程序 + 编译 → 普通编译，回 login 页。

### §0.4 可选：本地 server（仅步骤 2/4 真链路验证 · 跳过本节也可 · mock 模式 8 步全 PASS 即可双 approve）

```bash
# 终端 1
cd /Users/weizhao/Desktop/Costra/server && WX_MOCK_LOGIN=1 npm run dev

# 终端 2 · 验 158 DB migration
cd /Users/weizhao/Desktop/Costra/server && npm run db:migrate
psql 'postgres://costra:costra_dev_pw@localhost:5432/costra' -c "\d users" | grep has_completed_profile
# 期望：has_completed_profile | boolean | not null | default false
```

> 切真链路：`miniprogram/services/env.ts` line 14~24 `dev.mockLogin: false` · **实测后 `git checkout` 还原** · 禁止 commit。

---

## §1 步骤 1 · 冷启 login 页渲染（COSTRA-157）

**操作**：模拟器冷启动 · **不点登录** · 看 login 页是否正常渲染

**断言**：

| # | 断言 | 期望 | 卡号 |
|---|---|---|---|
| S1.1 | login 页正常渲染 · 无白屏无报错 | UI ✅ | 157 |
| S1.2 | Console 无 `TypeError` / `console.error` | 0 次 | 157 |

> **失败分流**：login 页渲染异常 → `revise:COSTRA-157 reason:login-page-render-fail`

---

## §2 步骤 2 · 同意授权登录 → home 真昵称 + 无完善资料入口（COSTRA-157 + 158 合并）

**操作**：

1. login 页点"一键微信登录"
2. **同意** `getUserProfile` 弹窗（mock 模式直接走 mockExchange · `has_completed_profile: true`）
3. 跳 home 页 · 看顶部展示

**断言**（合并 157 步 2 + 158 步 3 + 158 步 4）：

| # | 断言 | 期望 | 卡号 |
|---|---|---|---|
| S2.1 | 顶部显示"你好，<真实昵称>"（不是"微信用户"） | UI ✅ | 157 |
| S2.2 | 右上角**无**"完善资料 →"入口（has_completed_profile=true 触发） | UI ✅ | 157+158 |
| S2.3 | DevTools → Storage → `__costra_token_v1` → `.d.raw.user.has_completed_profile` === `true` | Storage ✅ | 158 |
| S2.4 | （仅真链路）DevTools → Network → 看 `POST /v1/users/me` 200（含 `X-HTTP-Method-Override: PATCH` header · K3 兜底链路 · 不再 404 soft-fail） | Network ✅（mock 模式 SKIP） | 158 |

> **失败分流**：
> - S2.1 显示"微信用户" → `revise:COSTRA-157 reason:nickname-default-fallthrough`
> - S2.2 仍显示完善资料入口 → `revise:COSTRA-158 reason:hascompletedprofile-not-respected`
> - S2.3 字段缺失 → `revise:COSTRA-158 reason:tokenraw-user-schema-mismatch`
> - S2.4 真链路 404 → `revise:COSTRA-158 reason:k3-method-override-server-not-recognized`（P0 · backend-dev）

---

## §3 步骤 3 · 退出 + 拒绝授权登录 → "微信用户" + 完善资料入口（COSTRA-157 + 158 合并）

**操作**：

1. mine 页或 Console 跑 `wx.clearStorageSync()` 后冷启 · 回 login 页
2. 点"一键微信登录"
3. **拒绝** `getUserProfile` 弹窗
4. 跳 home 页

**断言**（合并 157 步 3 + 158 步 2 严格判定升级）：

| # | 断言 | 期望 | 卡号 |
|---|---|---|---|
| S3.1 | 顶部显示"你好，微信用户"（默认昵称兜底） | UI ✅ | 157 |
| S3.2 | 右上角显示"完善资料 →"入口 | UI ✅ | 157 |
| S3.3 | 触发条件 = `has_completed_profile === false`（**严格事实判定** · 替代 COSTRA-157 旧 `nickname !== '微信用户'` 字符串代理判定） | 语义 ✅ | 158（核心） |
| S3.4 | DevTools → Storage → `__costra_token_v1` → `.d.raw.user.has_completed_profile` === `false`（mock 模式：除非你改了 mockExchange · 否则 mock 默认 `true` · **此步骤需真链路或手动改 mock 才能复现**） | Storage ✅ | 158 |

> **mock 模式覆盖说明**（dispatch §2.1 H Card-Review P2-3 修订标注）：
> mockExchange 默认设 `has_completed_profile: true` · 因此 **mock 模式下 S3 步骤无法验"完善资料"入口显示**。两种验证方式：
>
> - **方式 A · 真 server 模式**（推荐）：开 server + `mockLogin: false` · 真 wxLogin 拒绝授权后 server toUserView 返回 `has_completed_profile: false`（首登 DB DEFAULT FALSE 触发）
> - **方式 B · 手动改 mock**（5 秒）：DevTools → Sources → `miniprogram/services/auth.ts` → 找 `mockExchange` → 临时把 `has_completed_profile: true` 改为 `false` → 重新冷启 → 看 home 页 · 验完 revert 不 commit
>
> 若两种都不便跑 → S3 标 ⏸️ SKIP（不阻 approve · 因为 mock 路径已由 home.spec.ts 单测覆盖 · 真路径由 158 server users.test.ts T2 + auth.test.ts T1 has_completed_profile=false 断言覆盖）

> **失败分流**：
> - S3.1 显示真昵称（不是兜底）→ `revise:COSTRA-157 reason:refuse-fallback-broken`
> - S3.2 无入口 → `revise:COSTRA-157 reason:profile-entry-missing`
> - S3.3 真链路 has_completed_profile=true 误判 → `revise:COSTRA-158 reason:server-toUserView-mapping-bug`

---

## §4 步骤 4 · 点击"完善资料 →" 弹 modal（COSTRA-157）

**操作**：基于步骤 3 状态 · home 页点击右上角"完善资料 →"

**断言**：

| # | 断言 | 期望 | 卡号 |
|---|---|---|---|
| S4.1 | 弹 modal 提示"资料完善功能开发中"或类似临时文案（COSTRA-157 R1 临时入口 · Sprint-3 Epic-D 完善资料页接通） | UI ✅ | 157 |

> **失败分流**：S4.1 无反应或报错 → `revise:COSTRA-157 reason:profile-entry-modal-missing`

---

## §5 步骤 5 · 头像 fallback（COSTRA-157）

**操作**：

1. 基于步骤 2 的登录状态（home 页已加载真昵称 + 真头像）
2. DevTools → Storage → `__costra_token_v1` → `.d.raw.user.avatar_url` 改为不可达 URL（如 `https://example.invalid/404.jpg`）
3. 杀小程序 + 重启 + 进 home 页

**断言**：

| # | 断言 | 期望 | 卡号 |
|---|---|---|---|
| S5.1 | 头像 fallback 到 👤 占位图标（不是裂图）· 触发 `binderror="onAvatarError"` | UI ✅ | 157 |
| S5.2 | Console 无 `TypeError` / 无 unhandled image error | 0 次 | 157 |

> **失败分流**：S5.1 裂图无 fallback → `revise:COSTRA-157 reason:onAvatarError-not-wired`（FU-102-AVATAR-ONERROR 红线复活 · P1）

---

## §6 步骤 6 · 模拟登录失败 错误提示守 §0.5 红线（COSTRA-157）

**操作**：

1. 仅真链路场景：关闭 server（`Ctrl+C` 终止 step §0.4 启动的 server）
2. mock 模式场景跳过此步骤（mock 不发 HTTP · 无 server error 路径） · 改为：DevTools → Sources → 临时 throw 一个 `e.message='internal sql syntax error'` 注入到 login error 处理分支 · 验客户端是否吞此 message
3. login 页点"一键微信登录"
4. 看 login 页 errMsg 文案

**断言**：

| # | 断言 | 期望 | 卡号 |
|---|---|---|---|
| S6.1 | errMsg **不显示** server `message` 原文（如 SQL/stack trace 等内部信息）· 显示客户端 mapError 文案（如"登录失败，请重试" / "网络异常"等） | UI ✅ | 157 |
| S6.2 | docs/api/error-codes.md §0.5 红线"客户端不直出 server message" 守住 | 语义 ✅ | 157 |

> **失败分流**：S6.1 直显 server message → `revise:COSTRA-157 reason:error-mapper-bypass`（FU-102-ERROR-MAPPER-INTEGRATION 红线复活 · P1）

---

## §7 步骤 7 · 退出重登 has_completed_profile 持久（COSTRA-158 独有）

> 仅在步骤 2 是真链路 / 或步骤 3 用方式 A 真链路验证后 · 才能跑此步骤（验"用户曾 PATCH 过资料 · 退出重登后仍 has_completed_profile=true 不再显示完善资料入口"）。

**操作**（真链路必跑 · mock 模式 SKIP）：

1. 步骤 2 真链路 PATCH 200 后 · DB 中 `has_completed_profile` 已升级为 `true`
2. mine 页点"退出登录" · 回 login 页
3. 重新点"一键微信登录" · **同意**授权
4. 跳 home

**断言**：

| # | 断言 | 期望 | 卡号 |
|---|---|---|---|
| S7.1 | 顶部显示真昵称 | UI ✅ | 158 |
| S7.2 | 右上角**仍无**"完善资料 →"入口（has_completed_profile=true 持久 · server toUserView 返 true · client 同步） | UI ✅ | 158 |
| S7.3 | DB 验证：`psql 'postgres://...' -c "SELECT id, has_completed_profile FROM users WHERE id = '<your_user_id>'"` → `t` | DB ✅（可选） | 158 |

> **失败分流**：S7.2 重显"完善资料"入口 → `revise:COSTRA-158 reason:has_completed_profile-not-persisted`（DB 单调性破坏 · P0）

---

## §8 步骤 8 · 极端：撞库 nickname='微信用户' 但 has_completed_profile=true（COSTRA-158 边界核心）

> **此步骤是 COSTRA-158 的灵魂验证**：替代 COSTRA-157 概率边界判定（"用户真名='微信用户'撞库" · Human 2026-05-19 09:42 否决）的事实判定路径。

**操作**：

1. 基于步骤 2 / 步骤 7 的登录状态（has_completed_profile=true）
2. DevTools → Storage → `__costra_token_v1` → `.d.raw.user.nickname` 改为 `'微信用户'`（但 `has_completed_profile` 保持 `true` 不动）
3. 杀小程序 + 重启 + 进 home 页

**断言**：

| # | 断言 | 期望 | 卡号 |
|---|---|---|---|
| S8.1 | 顶部显示"你好，微信用户"（nickname 字符串原样展示） | UI ✅ | 158 |
| S8.2 | 右上角**仍无**"完善资料 →"入口（has_completed_profile=true 严格判定不受 nickname 撞库影响） | UI ✅ | 158（核心） |
| S8.3 | 与 COSTRA-157 旧逻辑对比：旧逻辑会**误显**"完善资料"入口（`u.nickname !== '微信用户'` → false → hasProfile=false）· 新逻辑无此误判 | 语义对比 ✅ | 158 |

> **失败分流**：S8.2 显示"完善资料"入口 → 严格判定未生效 → `revise:COSTRA-158 reason:computeHasProfile-still-uses-nickname-proxy`（P0 · I 项 utils/profile.ts 实装回退）
> S8.3 是逻辑回归对比 · 无需运行旧逻辑 · 由 G11 反向验证（`revert computeHasProfile to nickname comparison → home.spec.ts 用例 FAIL`）已自动验证

---

## §9 ≥ 9 硬断言聚合（合并 157 + 158）

| # | 硬断言 | 验证位置 | 必跑模式 |
|---|---|---|---|
| **HC-1** | login 页冷启渲染正常 · 无报错 | §1 S1.1+S1.2 | mock |
| **HC-2** | 同意授权 → 真昵称 + 无完善资料入口（has_completed_profile=true）| §2 S2.1+S2.2 | mock 必跑 / 真链路推荐 |
| **HC-3** | （真链路）PATCH /users/me 200 不再 404 · K3 method-override 兼容生效 | §2 S2.4 | 真链路（FU-COMMON-MINIAPP-PATCH-LIMIT 闭环验证）|
| **HC-4** | 拒绝授权 → 默认昵称兜底 + 完善资料入口 | §3 S3.1+S3.2 | mock A（改 mockExchange）/ B（真 server）|
| **HC-5** | 完善资料入口 → 临时 modal | §4 S4.1 | mock 必跑 |
| **HC-6** | 头像 fallback 不裂图（FU-102-AVATAR-ONERROR）| §5 S5.1+S5.2 | mock 必跑 |
| **HC-7** | 错误提示守 §0.5 红线（FU-102-ERROR-MAPPER-INTEGRATION）| §6 S6.1+S6.2 | 真链路推荐 / mock 注入也可 |
| **HC-8** | 退出重登 has_completed_profile 持久 | §7 S7.2 | 真链路必跑（mock 不持久） |
| **HC-9** | 撞库 nickname='微信用户' 但 has_completed_profile=true 不误判（COSTRA-158 灵魂） | §8 S8.2 | mock 必跑（DevTools 改 storage） |

**步骤勾选清单**：

| 步骤 | mock 模式 | 真链路模式 |
|---|---|---|
| §1 step 1 | ☐ PASS / ☐ FAIL | ☐ PASS / ☐ FAIL |
| §2 step 2 | ☐ PASS / ☐ FAIL | ☐ PASS / ☐ FAIL |
| §3 step 3 | ☐ PASS / ☐ FAIL / ☐ SKIP（mock 不便） | ☐ PASS / ☐ FAIL |
| §4 step 4 | ☐ PASS / ☐ FAIL | ☐ PASS / ☐ FAIL |
| §5 step 5 | ☐ PASS / ☐ FAIL | ☐ PASS / ☐ FAIL |
| §6 step 6 | ☐ PASS / ☐ FAIL / ☐ SKIP（无注入） | ☐ PASS / ☐ FAIL |
| §7 step 7 | ☐ SKIP（mock 不持久） | ☐ PASS / ☐ FAIL |
| §8 step 8 | ☐ PASS / ☐ FAIL | ☐ PASS / ☐ FAIL |

---

## §10 双卡 approve 触发命令

**全部 PASS**（或 SKIP 项与上述声明一致）→ Human 单次输入：

```
approve:COSTRA-157 + approve:COSTRA-158
```

**任一关键步骤 FAIL** → 按 §1~§8 失败分流单卡 revise · 不影响另一张：

- `revise:COSTRA-157 reason:<具体步骤>`
- `revise:COSTRA-158 reason:<具体步骤>`

---

## §11 实测后 Orchestrator 收尾动作（双 approve 后）

1. backlog v0.2.13：COSTRA-157 + COSTRA-158 status `Doing` → `Done` · disposition 改 `CLOSED @ 2026-05-19` · Sprint-2 完成 7/7 张主线卡（100%）
2. follow-ups README：FU-COMMON-MINIAPP-PATCH-LIMIT + FU-102-PROFILE-REFUSE-UI boundary risk + FU-001 + FU-118-2 + FU-102-ERROR-MAPPER-INTEGRATION + FU-102-AVATAR-ONERROR 全 closed @ COSTRA-157/158 · 验"Human 实测未通过前 FU 不真 closed"铁律解除
3. Sprint-2 收官 · 进入 Sprint-3 Planning（候选头部 COSTRA-154 sync/pull · 与 COSTRA-150 client 调度器同期）· Sprint-2 末 Retro 议题候选已沉淀（D-024 立案 + 契约-实装 gap 防漏检 + 代理判定反模式 + 概率极低反模式）

---

## §12 修订记录

| 版本 | 时间 | 修订 |
|---|---|---|
| v1.0 | 2026-05-19 14:30 | 初版 · D-024 §2.4 命名 · 157 §9 6 步 + 158 §9 6 步去重合并为 8 步 + §0 单次 setup + §10 双 approve 命令 |

---

**事实源 / 依据**：

- COSTRA-157 dispatch §9：`.team/dispatch/COSTRA-157-user-profile-completion-and-login-resilience.md`
- COSTRA-158 dispatch §9：`.team/dispatch/COSTRA-158-users-me-and-has-completed-profile.md`
- D-024 SOP：`.team/decisions/D-024-human-test-batching-trigger.md`
- COSTRA-157 R1 commit：`ac204e3`（review-tech 38/40 APPROVE）
- COSTRA-158 R1 commit：`c7ea7f7`（review-tech 38/45 APPROVE）
- 范式参照：`docs/qa/costra-105-human-smoke.md` v1.8
