# Sprint-2 批量实测清单 · v3.0 全干净环境版（COSTRA-157 + COSTRA-158）

> **状态**：v1.0 + v2.0 已废弃 · v3.0 是唯一权威版本
> **重写时间**：2026-05-19 19:30（Orchestrator · 基于 R1.x.1 修复 commit `99e3794`）
> **触发依据**：D-024 §2.2 C1 + C4 联合 + Human 实测期触发 P0 BUG（已修）+ Human 反馈"不要中间状态续测"
> **执行人**：Human · **预计耗时**：~6 分钟
> **覆盖卡**：
> - **COSTRA-157**（commit `ac204e3` · 5 FU 合并修复）
> - **COSTRA-158**（commit `c7ea7f7` · /users/me + 严格判定）
> - **COSTRA-158 R1.x.1**（commit `99e3794` · storage envelope 一致性修复）

---

## 设计原则（与 v1.0/v2.0 不同）

1. **每步从已知干净状态出发**：每个 step 起点明确（清缓存或重启）· 不依赖前一步遗留
2. **每步独立可达**：失败的 step 可单独重跑 · 不需要从头来
3. **每步只验 1~2 个核心断言**：不堆叠 · 不连环
4. **真链路 + 微信平台限制现实**：不假设 wx.getUserProfile 弹窗会出现（微信 2022 起静默返回默认值）
5. **不用 hotfix 续测**：BUG 已修 · 干净环境直接跑

---

## §0 前置（10 分钟一次性 setup · 之后所有 step 复用）

> **跑下面所有命令前 · 你需要 3 个东西**：服务器 / DB / 模拟器。

### §0.1 启动 server（终端 1 · 保留运行）

```bash
cd /Users/weizhao/Desktop/Costra/server
WX_MOCK_LOGIN=1 npm run dev
```

期望日志（按顺序出现 3 行即视成功）：
- `port: 8080`
- `costra-server listening`
- `wxMockLogin: true`

> WX_MOCK_LOGIN：server 内置 mock fetch · 任意 wx.login code 都返成功 · 不调腾讯真接口

### §0.2 准备 DB（终端 2 · 跑完即关）

```bash
cd /Users/weizhao/Desktop/Costra/server
npm run db:migrate
psql 'postgres://costra:costra_dev_pw@localhost:5432/costra' -c "\d users" | grep has_completed_profile
```

期望最后输出：
```
has_completed_profile | boolean | not null | default false
```

### §0.3 准备模拟器

1. 微信开发者工具打开项目根 `/Users/weizhao/Desktop/Costra`
2. 顶部菜单 → **工具 → 构建 npm**
3. 详情 → 本地设置 → 勾选"不校验合法域名/TLS/证书"

### §0.4 git 状态确认

```bash
cd /Users/weizhao/Desktop/Costra && git log --oneline -5
```

期望首行包含 `99e3794`（R1.x.1 修复）或更新的 commit · 表示代码已含修复。

### §0.5 心智模型（开始测之前读一次）

| 概念 | 说明 |
|---|---|
| `wx.getUserProfile` 弹窗 | 微信 2022-04-14 起策略变更 · 用户**永远看不到弹窗** · 接口静默返回 `nickname='微信用户'` + 灰头像 |
| storage envelope | `{v, t, ttl?, d}` 包装格式 · 由 `storage.ts setItem` 写入 · `auth.ts initAuth` 读取 |
| `__costra_token_v1` 内容 | 经修复后**永远是 envelope 格式**（裸对象路径已废）· 访问真数据走 `t.d.raw.user.xxx` |
| has_completed_profile 触发条件 | server 端 PATCH /users/me 调用一次（哪怕 client 传"微信用户"默认值）就标 true · 这是 158 dispatch §2.1 B 设计 |

---

## §1 Step A · 全清缓存 · 首登 · 验默认昵称兜底（2 min）

> **核心**：验证 COSTRA-157 拒绝授权 / 微信平台静默 → home 显示默认昵称 + 完善资料入口

### §1.1 操作

1. **顶部菜单 → 清缓存 → 清除全部缓存**（关键 · 起点干净）
2. **关闭项目** → **重新打开项目** → 普通编译
3. login 页 · 点"一键微信登录"
4. 等跳转到 home 页

### §1.2 期望

| # | 断言 | 期望 | PASS / FAIL |
|---|---|---|---|
| A.1 | login 页冷启正常渲染 | UI ✅ | ☐ |
| A.2 | 登录后跳 home（不卡 login） | UI ✅ | ☐ |
| A.3 | 顶部"你好，微信用户"显示 | UI ✅（微信平台静默默认值）| ☐ |
| A.4 | 头像灰色 👤 占位 | UI ✅（thirdwx.qlogo.cn 默认头像）| ☐ |
| A.5 | 右上角**无**"完善资料 →"入口 | UI ✅（has_completed_profile=true · 158 严格判定）| ☐ |

### §1.3 解读

- A.3 是默认昵称兜底（COSTRA-157 FU-001 + FU-118-2）
- A.4 是头像 fallback 不阻塞登录（COSTRA-157 FU-102-AVATAR-ONERROR · 灰头像本身不裂图就算 pass）
- A.5 验 COSTRA-158 严格判定（PATCH /users/me 成功后 has_completed_profile=true）

### §1.4 失败处理

- A.1/A.2 ✗ → 截图 · 阻塞终止
- A.3 ✗（显示其他昵称）→ 截图 · 报告 default fallback 路径异常
- A.5 ✗（出现完善资料入口）→ 截图 · PATCH 失败诊断 · 不阻塞 step B

---

## §2 Step B · 验 storage envelope 修复（30 秒）

> **核心**：验 R1.x.1 修复生效 · storage 是 envelope 格式 · 不是裸对象

### §2.1 操作

不需要重启。Step A 完成后直接 Console 跑：

```js
const t = wx.getStorageSync('__costra_token_v1')
console.log('keys:', Object.keys(t))
console.log('has .d?', 'd' in t)
console.log('has .raw?', 'raw' in t)
console.log('has_completed_profile:', t?.d?.raw?.user?.has_completed_profile)
console.log('nickname:', t?.d?.raw?.user?.nickname)
```

### §2.2 期望

```
keys: ["v", "t", "d"]   ← 注意是这个！不是 ["raw", "access_expires_at", ...]
has .d? true
has .raw? false
has_completed_profile: true
nickname: 微信用户
```

| # | 断言 | 期望 | PASS / FAIL |
|---|---|---|---|
| B.1 | storage 是 envelope 格式 | keys 含 `v` `t` `d` · 不含 `raw`（顶层）| ☐ |
| B.2 | has_completed_profile=true（PATCH 成功）| `t.d.raw.user.has_completed_profile === true` | ☐ |
| B.3 | nickname='微信用户' | `t.d.raw.user.nickname === '微信用户'` | ☐ |

### §2.3 失败处理

- B.1 ✗（keys 含 raw 不含 d）→ R1.x.1 修复未生效 · 立刻 stop · git log 看 commit 是否含 99e3794
- B.2 ✗（false） → PATCH /users/me 失败 · 看 server 日志
- B.3 通常 PASS（除非 wx.getUserProfile 罕见返回非默认值）

---

## §3 Step C · 重启验 envelope 一致性 · 不被踢回 login（30 秒）

> **核心**：验 R1.x.1 P0 BUG 真修了 · 重启不再登出

### §3.1 操作

1. **微信开发者工具左上角 → 重新启动**（不清缓存）
2. 看小程序首页

### §3.2 期望

| # | 断言 | 期望 | PASS / FAIL |
|---|---|---|---|
| C.1 | 重启后**仍然在 home 页**（不被踢回 login）| UI ✅ | ☐ |
| C.2 | 顶部仍显示"你好，微信用户" | UI ✅ | ☐ |
| C.3 | Console 0 错（无 `NO_TOKEN` / `initAuth fail` 等）| 0 错 | ☐ |

### §3.3 解读

如果在 R1.x.1 修复**之前**跑这步 · 必然踢回 login（envelope 破坏 → initAuth 读不到 token）。修复后必须 PASS · 否则修复无效。

### §3.4 失败处理

- C.1 ✗（被踢回 login）→ R1.x.1 修复未生效 · 紧急回查 commit 99e3794 是否被 revert

---

## §4 Step D · 强制 has_completed_profile=false · 验完善资料入口（60 秒）

> **核心**：验 COSTRA-158 严格判定的另一半（has_completed_profile=false → 显示完善资料入口）

### §4.1 操作

Console 跑（**注意路径是 `t.d.raw.user`**）：

```js
const t = wx.getStorageSync('__costra_token_v1')
t.d.raw.user.has_completed_profile = false
wx.setStorageSync('__costra_token_v1', t)
console.log('verify:', wx.getStorageSync('__costra_token_v1').d.raw.user.has_completed_profile)
// 期望 false
```

然后 → **微信开发者工具左上角 → 重新启动**（不清缓存）→ 看 home 页

### §4.2 期望

| # | 断言 | 期望 | PASS / FAIL |
|---|---|---|---|
| D.1 | 重启后仍登录态 | UI ✅ | ☐ |
| D.2 | 顶部"你好，微信用户" | UI ✅ | ☐ |
| **D.3** | **右上角显示"完善资料 →"** | **UI ✅（COSTRA-158 严格判定灵魂）**| ☐ |

### §4.3 失败处理

- D.3 ✗（不显示）→ COSTRA-158 严格判定失效 · 立 P0 · 阻 158 approve

---

## §5 Step E · 点击"完善资料 →" 弹 modal（30 秒）

> **核心**：验 COSTRA-157 临时入口

### §5.1 操作

基于 step D 状态（不重启 · 直接接续）· home 页点击右上角"完善资料 →"

### §5.2 期望

| # | 断言 | 期望 | PASS / FAIL |
|---|---|---|---|
| E.1 | 弹 modal | UI ✅ | ☐ |
| E.2 | modal 标题"完善资料" + 内容含"资料完善功能开发中"+ "Sprint-3 Epic-D" | UI ✅ | ☐ |
| E.3 | 点确定关闭 modal · 不报错 | Console 0 错 | ☐ |

---

## §6 Step F · 验撞库 nickname 严格判定（90 秒 · COSTRA-158 灵魂）

> **核心**：D-025 AP-001 字符串代理判定反模式正向规避验证

### §6.1 操作

Console 跑：

```js
const t = wx.getStorageSync('__costra_token_v1')
t.d.raw.user.nickname = '微信用户'             // 撞库 default
t.d.raw.user.has_completed_profile = true     // 但保持 true
wx.setStorageSync('__costra_token_v1', t)
console.log('verify:',
  wx.getStorageSync('__costra_token_v1').d.raw.user.nickname,
  wx.getStorageSync('__costra_token_v1').d.raw.user.has_completed_profile,
)
// 期望：微信用户 true
```

然后 → **微信开发者工具左上角 → 重新启动** → 看 home 页

### §6.2 期望

| # | 断言 | 期望 | PASS / FAIL |
|---|---|---|---|
| F.1 | 重启后仍登录态 | UI ✅ | ☐ |
| F.2 | 顶部"你好，微信用户" | UI ✅ | ☐ |
| **F.3** | **右上角无"完善资料 →"** | **UI ✅（D-025 AP-001 严格判定灵魂兑现）**| ☐ |

### §6.3 解读

D.3 + F.3 两条断言**对比**正是 COSTRA-158 替代 COSTRA-157 的灵魂：
- D.3：has_completed_profile=false → 显示完善资料 ✅
- F.3：has_completed_profile=true（即使 nickname='微信用户' 撞 default）→ 不显示完善资料 ✅
- 对比 COSTRA-157 旧逻辑：用 nickname 字符串判定 · F.3 场景会**误显**完善资料入口 · COSTRA-158 修复此误判

### §6.4 失败处理

- F.3 ✗（出现完善资料入口）→ 严格判定失效 · 不可 approve

---

## §7 收口 · 单独 approve 命令

### §7.1 全 PASS 路径（推荐）

如果 §1~§6 全 PASS（含 A.5 / D.3 / F.3 三个核心 UI 断言 + B.1 / C.1 envelope 一致性 + R1.x.1 已通过）：

```
approve:COSTRA-157
approve:COSTRA-158
```

或一行：
```
approve:COSTRA-157 + approve:COSTRA-158
```

→ Sprint-2 7/7 主线真闭环 · 进 Sprint-3 头部启动条件

### §7.2 部分 FAIL 路径

| FAIL 项 | 处置 |
|---|---|
| A.5 ✗ 或 D.3 ✗ 或 F.3 ✗ | 严格判定失效 · COSTRA-158 不可 approve · 立 R1.x.2 修补卡 |
| B.1 ✗（envelope 不对）| R1.x.1 修复未生效 · 紧急 git status 检查 |
| C.1 ✗（重启踢回 login）| 同上 |
| E.1~E.3 ✗（modal 异常）| COSTRA-157 onTapCompleteProfile 路径 BUG · 立 R1.x.1 单独修 |
| 其他单步异常 | 截图 + step 编号上报 |

---

## §8 步骤勾选总表（实测时填）

| Step | 状态 | 关键断言 | 备注 |
|---|---|---|---|
| §0 setup | ☐ DONE | server + DB + 模拟器 | |
| §1 Step A 首登 | ☐ PASS / ☐ FAIL | A.1~A.5 | A.5 是核心 |
| §2 Step B envelope 验证 | ☐ PASS / ☐ FAIL | B.1~B.3 | B.1 是修复证据 |
| §3 Step C 重启不踢登 | ☐ PASS / ☐ FAIL | C.1~C.3 | C.1 是 R1.x.1 修复证据 |
| §4 Step D has_completed=false | ☐ PASS / ☐ FAIL | D.1~D.3 | **D.3 是灵魂** |
| §5 Step E 完善资料 modal | ☐ PASS / ☐ FAIL | E.1~E.3 | |
| §6 Step F 撞库 nickname | ☐ PASS / ☐ FAIL | F.1~F.3 | **F.3 是灵魂** |

---

## §9 修订记录

| 版本 | 时间 | 状态 |
|---|---|---|
| ~~v1.0~~ | 2026-05-19 14:30 | 废弃（step 3 wx.getUserProfile 弹窗依赖不可达 · step 7 触发 P0 BUG 不能跑）|
| ~~v2.0~~ | 2026-05-19 19:20 | 废弃（基于中间状态续测 · Human 反馈不接受）|
| **v3.0** | **2026-05-19 19:30** | **当前唯一权威版本**：基于 R1.x.1 修复 commit 99e3794 · 完全干净环境 · 6 step（A~F）独立可达 · 16 硬断言（A.1~A.5 + B.1~B.3 + C.1~C.3 + D.1~D.3 + E.1~E.3 + F.1~F.3）|

---

**事实源 / 依据**：

- COSTRA-157 commit `ac204e3` + dispatch §9
- COSTRA-158 commit `c7ea7f7` + dispatch §9
- **COSTRA-158 R1.x.1 commit `99e3794`**（storage envelope 一致性修复 · 本清单的修复前提）
- 缺陷单：`qa/defects/2026-05-19-COSTRA-158-storage-envelope-drift.md`
- D-024 §2.4 攒批清单命名规范
- D-025 AP-001 字符串代理判定（D.3 + F.3 灵魂验证目标）
- D-022 §4.1 runtime T2 卡铁律（第 2 次正向兑现）
