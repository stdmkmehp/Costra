# COSTRA-127 · 方案 B 实装 + 闸门 + commit

- 卡号：COSTRA-127
- Refs：`COSTRA-126` · `COSTRA-125` · `FU-LAUNCH-C`
- 创建：2026-05-08
- Owner：miniapp-dev
- Driver：FU-LAUNCH-C 残留 `Expected updated data but get first rendering data`（lib 3.8.12 仍 1 次 · 仅 dev 工具冷启动复现 · COSTRA-126 §4.2 实测确认）
- 状态：v1.0（R1 实装 + commit）

---

## §0 SBAI 路径

本卡走**两段式**（D-014 豁免 fix + 已有上轮 D-017 Step 2 完整诊断）：

- **第一段**：诊断（已完成 · 上轮 P2' 冒烟 · COSTRA-127 派单前）
- **第二段**：实装（本轮 · Step 4 + Step 5）

**跳 Card-Review 依据**：D-014 §3 fix 类豁免 + 已有上轮 D-017 Step 2 完整诊断 + Human 拍板全按推荐。

---

## §1 背景

### 问题

lib 3.8.12 重新打开项目冷启动后，`Expected updated data but get first rendering data` 仍出现 1 次（仅 dev 工具复现 · 真机验证延后 Sprint-2）。

### 根因（D-017 Step 2 诊断 · 置信度 90%+）

**场景 B（app bootstrap 直达 home）**：
1. `app.ts bootstrapPromise` 开始串行 `ensureVersion()` + `initAuth()`
2. bootstrap 未完成时，home 页面已 onLoad → onShow
3. home onShow 同步调用 `hasValidSession()` → 返回 `false`（bootstrap 中 Token 未解析完）
4. home onShow 执行 `wx.reLaunch({ url: '/pages/login/index' })`（已用 reLaunch）
5. home onLoad 的 bootstrap gate `.then()` 晚于 onShow 执行 → 在 gate 内再次 `wx.reLaunch({ url: '/pages/login/index' })`
6. **两次 reLaunch**：第一次是 onShow sync 执行（home 实例 setData 未触发）；第二次是 onLoad gate 后（home 实例已部分渲染）→ 渲染层抛 `Expected updated data but get first rendering data`

**场景 D（login → reLaunch home）**：
- `login.ts onTapLogin` 调用 `wx.switchTab({ url: '/pages/home/index' })`
- `switchTab` **复用** home 已有实例，不触发完整生命周期重走
- home 旧实例的 onShow 同步执行 `hydrateUser()` + `refresh()` → 读取 Token 成功
- 但旧实例的 data 可能已被重置 → `setData` 写入的 key 与首次渲染的 data schema 不匹配 → 抛 `Expected updated data`

**方案 B 逻辑**：
- `switchTab` → `reLaunch`：强制重新初始化 home 实例，消除旧实例 data 不一致
- `onShow` 加 `bootstrapPromise.then()` gate：确保 bootstrap 完成后再执行业务 setData，消除与 onLoad gate 的竞速

---

## §2 方案

### 方案 B：4 文件 ~18 行

| 文件 | 改动位置 | 改动内容 | 行数 |
|---|---|---|---|
| `miniprogram/pages/login/index.ts` | 第 26 行 + 第 82 行 | `wx.switchTab` → `wx.reLaunch` | 2 |
| `miniprogram/pages/home/index.ts` | onShow | 加 `bootstrapPromise.then()` gate | ~8 |
| `miniprogram/pages/mine/index.ts` | onShow | 加 `bootstrapPromise.then()` gate | ~8 |
| `docs/devops/libversion-upgrade.md` | §3.4 + §3.6 | v5 措辞 + 反模式 #6 | ~20 |

---

## §3 DoD

- [ ] **(a)** login/index.ts 两处 switchTab → reLaunch（+ 注释）
- [ ] **(b)** home/index.ts onShow 加 bootstrapPromise.then gate
- [ ] **(c)** mine/index.ts onShow 加 bootstrapPromise.then gate
- [ ] **(d)** libversion-upgrade.md §3.4 v5 措辞 + §3.6 反模式 #6
- [ ] **(e)** FU/state/history 更新
- [ ] **(f)** 六闸全绿（typecheck / test / lint / check:appjson / check:tooling / check:whitelist）
- [ ] **(g)** 2 个 commit（footer 含 `Refs: COSTRA-127`）

---

## §4 工作区 + 权限

### 可写

- `miniprogram/pages/login/index.ts`
- `miniprogram/pages/home/index.ts`
- `miniprogram/pages/mine/index.ts`
- `docs/devops/libversion-upgrade.md`
- `.team/follow-ups/README.md`
- `.team/members/miniapp-dev/state.md`
- `.team/members/miniapp-dev/history/2026-05-08-costra-127-r1-implement.md`
- `.team/dispatch/COSTRA-127-*.md`

### 禁写

- `server/` / `api/` / `design/` / `infra/`
- `docs/PRD.md` / `docs/qa/test-strategy.md` / `docs/qa/smoke-cases.md` / `docs/qa/wechat-review-checklist.md`
- `.team/decisions/*.md`
- `project.config.json` / `project.private.config.json`
- `miniprogram/services/` / `miniprogram/app.ts`
- `miniprogram/pages/entry/` / `pages-stat/` / `pages-family/`

---

## §5 commit 纪律

- **scope 白名单**：`miniapp / backend / design / devops / qa / docs / api / db / repo`
- **commit 1**：`fix(miniapp): replace switchTab with reLaunch + onShow bootstrap gate (COSTRA-127)`
  - 范围：`miniprogram/pages/login/` · `home/` · `mine/`
- **commit 2**：`docs(repo): costra-127 fu-launch-c true-close + libversion v5 + anti-pattern #6 (COSTRA-127)`
  - 范围：`docs/devops/libversion-upgrade.md` + `.team/`
  - footer：`Refs: COSTRA-126, COSTRA-127`
- **body 每行 ≤ 100 字符**（commitlint body-max-line-length）
- 禁止 `--no-verify` · hooks 必 PASS

---

## §6 验收（Human 实测 SOP）

### 复现路径（改动前预期出错 · 改动后预期 0 次）

1. **完全关闭微信开发者工具**
2. **重新打开项目**（强制 webview 冷启动）
3. **清缓存 + 重新编译 + 冷启动**
4. **观察 console** · 应 0 次 `Expected updated data but get first rendering data`
5. **模拟器手动登出 → 点登录 → 观察**跳 home 后 console（应 0 次）

### 5 条断言

- ☐ 1. `Expected updated data but get first rendering data` 0 次
- ☐ 2. `too eayly` 0 次（COSTRA-125 已修 · 防御性复验）
- ☐ 3. Launch Time ≤ 900 ms（AMBER 900-935 ms）
- ☐ 4. 登录流程正常 → home 首页显示
- ☐ 5. tabBar 切换 home/mine 正常 · 无 console 错误

### FU-LAUNCH-C 状态

- `degraded-to-p3-observe` → 待 Human 实测后 `closed @ COSTRA-127`

---

**文档结束 · v1.0 · 2026-05-08 · by `costra-miniapp-dev`（COSTRA-127 R1 实装）**
