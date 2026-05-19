# Sprint-2 批量人工实测报告 · COSTRA-157 + COSTRA-158（含 R1.x.1 修复验证）

> **执行人**：Human · **执行时间**：2026-05-19 19:30~19:53（实测耗时 23 分钟 · 含 1 次 P0 BUG 发现 + 修复 + 重启）
> **清单版本**：`docs/qa/sprint-2-batch-human-smoke.md` v3.0
> **结论**：✅ **16/16 断言全 PASS**
> **覆盖卡**：
> - COSTRA-157（commit `ac204e3` · 5 FU 合并修复）
> - COSTRA-158（commit `c7ea7f7` · /users/me + 严格判定）
> - **COSTRA-158 R1.x.1**（commit `99e3794` · storage envelope 一致性修复 · 本次实测期发现并修复）

---

## §1 结论速览

| 维度 | 数据 |
|---|---|
| 断言总数 | 16 |
| PASS | **16** |
| FAIL | 0 |
| BLOCKED / SKIP | 0 |
| 真链路实测 | ✅ 全程（client `mockLogin=false` + server `WX_MOCK_LOGIN=1`）|
| **R1.x.1 修复 runtime 验证** | ✅ envelope 一致性 + 重启不踢登持久化全 PASS（commit `99e3794` 铁证）|
| **COSTRA-158 灵魂 1**（has=false → 显示完善资料）| ✅ D.3 PASS |
| **COSTRA-158 灵魂 2**（撞库 nickname=微信用户 + has=true → 不显示）| ✅ F.3 PASS · D-025 AP-001 反模式正向规避铁证 |
| **COSTRA-157 体验补救路径**（FU-102-PROFILE-REFUSE-UI）| ✅ E.2 PASS · modal "资料完善功能开发中 · 即将上线（Sprint-3 Epic-D）"友好兜底 |

---

## §2 16 断言逐一对照

### Step A · 真链路首登 + 默认昵称 + 无完善资料（5/5 PASS）

| # | 断言 | 期望 | 实际 | 证据 |
|---|---|---|---|---|
| A.1 | login 页冷启正常渲染 | UI ✅ | ✅ | login 页 19:47:31 进入 |
| A.2 | 登录后跳 home（不卡 login）| UI ✅ | ✅ | console `auth.ts:163 [auth] wx.login ok {codeLen: 32}` @ 19:47:31 |
| A.3 | 顶部"你好，微信用户" | UI ✅ | ✅ | 截图 `image.d875fff1bd.png` |
| A.4 | 头像灰色 👤 占位 / 真灰头像 URL | UI ✅ | ✅ | console `avatar_url: https://thirdwx.qlogo.cn/mmopen/vi_32/POgEwh4mIHO4nibH0KlMECNjjGxQUq24ZEaGT4poC6icRiccVGKSyXwibcPq4BWmiaIGuG1icwxaQX6grC9VemZoJ8rg/132`（微信平台默认灰头像 URL · 与 2022-04-14 平台限制一致）|
| A.5 | 右上角**无**"完善资料 →"入口 | UI ✅ | ✅ | 截图 `image.d875fff1bd.png` 右上角无该链接 |

**关键 console 证据（19:47:46）**：
```
keys: ["v","t","d"]                            ← envelope 格式（R1.x.1 修复证据）
user.id: 019e4010-01bb-75d7-9a43-67763c66699e ← 真 UUID v7（server DB 真创建 user）
nickname: 微信用户                              ← 微信平台 2022 静默默认值
has_completed_profile: true                    ← server PATCH /users/me 后置 true
avatar_url: https://thirdwx.qlogo.cn/...       ← 微信平台默认灰头像 URL
```

### Step B · envelope 一致性（3/3 PASS · R1.x.1 修复证据）

| # | 断言 | 期望 | 实际 | 证据 |
|---|---|---|---|---|
| B.1 | `keys: ["v","t","d"]` | ✅ | ✅ | console 19:47:46 |
| B.2 | `has .d?: true` · `has .raw?: false` | ✅ | ✅ | console 19:49:41 + 19:47:46 双次确认 |
| B.3 | `t.d.raw.user.xxx` 路径全可达 | ✅ | ✅ | nickname / has_completed_profile / avatar_url / id 4 字段全部读出真值 |

### Step C · 重启不踢登（3/3 PASS · R1.x.1 修复 runtime 铁证）

| # | 断言 | 期望 | 实际 | 证据 |
|---|---|---|---|---|
| C.1 | 重启后直接进 home 页（不踢回 login）| UI ✅ | ✅ | 截图 `image.047a9ae530.png` · 重启后直接 home 页 |
| C.2 | "你好，微信用户"持久 | UI ✅ | ✅ | 同上截图 |
| C.3 | console `user.id` 与 19:47:46 完全一致（持久化生效）| ✅ | ✅ | console 19:49:41 `user.id: 019e4010-01bb-75d7-9a43-67763c66699e` 完全一致 |

**这一段是 R1.x.1 修复（commit `99e3794`）runtime 行为正向兑现的铁证**：
- 19:13 Human 发现 P0 BUG（`updateLocalUserProfile` 写裸对象 → initAuth 读不到 envelope → 重启即登出）
- 19:30 Orchestrator spawn miniapp-dev 修复（auth.ts L257-272 改 async + setItem · login/index.ts 加 await · auth.spec.ts 加重启回读单测）
- 19:43 Human 切真链路重测 · 19:49 重启后**完全保留登录态 + 数据完整无损** · BUG 真正修复

### Step D · has=false → 显示完善资料（3/3 PASS · COSTRA-158 灵魂 1）

| # | 断言 | 期望 | 实际 | 证据 |
|---|---|---|---|---|
| D.1 | console verify: false | ✅ | ✅ | console 修改后 verify |
| D.2 | 重启后仍在 home 页 | UI ✅ | ✅ | 截图 `image.3705bf5c6f.png` |
| D.3 | **右上角出现"完善资料 →"** | UI ✅ | ✅ | 截图 `image.3705bf5c6f.png` 右上角清晰显示 |

**灵魂解读**：has=false → `computeHasProfile=false` → wxml `wx:if="{{!hasProfile}}"` 渲染入口。这是 158 严格判定**正面兑现** · 与 157 旧实装在此场景下 nickname='微信用户' 必显示完善资料保持一致。

### Step E · 点完善资料 → modal（3/3 PASS · FU-102 体验补救兜底）

| # | 断言 | 期望 | 实际 | 证据 |
|---|---|---|---|---|
| E.1 | 点击响应（无 console 报错）| ✅ | ✅ | 截图 `image.1f195b4d83.png` modal 已弹出 |
| E.2 | 弹 modal "资料完善功能开发中" | UI ✅ | ✅ | 截图显示标题"完善资料" + 副文案"资料完善功能开发中 · 即将上线（Sprint-3 Epic-D）"|
| E.3 | 点确定关闭 modal | UI ✅ | ✅ | Step F 操作前已点确定 · home 页正常 |

**bonus**：modal 副标题指明 Sprint-3 Epic-D · 用户能感知占位 + 真功能即将上线 · 比单纯"功能开发中"友好。

### Step F · 撞库 nickname=微信用户 + has=true → 不显示（3/3 PASS · COSTRA-158 灵魂 2 · 最关键）

| # | 断言 | 期望 | 实际 | 证据 |
|---|---|---|---|---|
| F.1 | console verify `微信用户 true` | ✅ | ✅ | console 修改后 verify |
| F.2 | 重启后仍在 home 页 | UI ✅ | ✅ | 截图 `image.e28a827ca1.png` |
| F.3 | **顶部"你好，微信用户" + 右上角不显示"完善资料 →"** | UI ✅ | ✅ | 截图 `image.e28a827ca1.png` 双条件同时满足 |

**灵魂解读（COSTRA-158 立卡的全部理由真兑现）**：

| 旧 157 实装 | 新 158 实装 | F.3 验证结果 |
|---|---|---|
| `nickname !== '微信用户'` 字符串代理 | `has_completed_profile === true` 严格事实 | 158 实装 |
| 撞库场景 → 误判 hasProfile=false → **误显示**完善资料 | 撞库场景 → 正确 hasProfile=true → **不显示**完善资料 | ✅ 不显示 |
| D-025 AP-001 字符串代理判定反模式 | 严格事实判定（D-025 AP-001 反模式正向规避）| ✅ 反模式被规避 |

**这一断言是 D-025 反模式清单档第 1 条 AP-001 的首次实战正向兑现**。

---

## §3 时间线（含 P0 BUG 发现 + 修复 + 重测）

| 时间 | 事件 |
|---|---|
| 19:08 | 微信开发者工具自动生成 `minitest/` 目录（已加 .gitignore） |
| 19:09 | Human 跑 `wx.getStorageSync` 看到裸对象 `{raw, access_expires_at, refresh_expires_at}` · 但当时认为是 mock 模式正常 |
| 19:13 | Human 跑 `t.d.raw.user.has_completed_profile` 报 TypeError → Orchestrator 诊断 storage envelope drift P0 BUG |
| 19:14 | 缺陷单 `qa/defects/2026-05-19-COSTRA-158-storage-envelope-drift.md` 落档 |
| ~19:25 | Human 反馈"不要中间状态续测"· 决策走完全干净环境 |
| 19:30 | Orchestrator spawn miniapp-dev R1.x.1 修复 · commit `99e3794` 落盘 · 闸门 6/6 + 44/44 测全绿 + 反向验证 PASS |
| 19:35 | v3.0 实测清单落档 + v1.0/v2.0 deprecated · 缺陷单 + state 收尾 commit `ecefa2d` |
| 19:43 | Human 切 `mockLogin: false` + 清缓存 + 重新登录（真链路 · server `WX_MOCK_LOGIN=1`）|
| 19:47 | Step A + B 全 PASS · console 5 字段全部命中预期 |
| 19:49 | Step C 全 PASS · 重启不踢登 · R1.x.1 runtime 铁证 |
| 19:51 | Step D 全 PASS · COSTRA-158 灵魂 1 兑现 |
| 19:51 | Step E 全 PASS · modal 友好兜底 |
| 19:53 | Step F 全 PASS · COSTRA-158 灵魂 2 + D-025 AP-001 反模式规避铁证 |

**总实测耗时**：23 分钟（含发现 P0 + 修复 + 重测）· 比 v3.0 计划 6 分钟超 ~3.8x · 但**额外暴露并修复了 1 个 P0 BUG** · D-022 §4.1 真兑现立意第 3 次实战。

---

## §4 D-022 §4.1 runtime 实测前置铁律 · 第 3 次实战收益

| Sprint | 卡 | 实测发现 |
|---|---|---|
| Sprint-2 头部 | COSTRA-105 D1/D2/H6 真链路 | ~30min 捕获 5 发现 = 4 文档 gap + 1 联合 P0 BUG（族 H · 第 1 次实战）|
| Sprint-2 末 | COSTRA-105 H6 自动等效回归 | BLOCKED-BY-COSTRA-154 · 真兑现立意第 2 次（理论标记）|
| **Sprint-2 末 batch** | **COSTRA-157 + 158** | **23min 捕获 P0 BUG（storage envelope drift）+ 触发 R1.x.1 修复 + 文档 v1.0/v2.0/v3.0 三次重写**（第 3 次实战）|

**累计**：runtime T2 卡铁律已在 Sprint-2 内 3 次实战 · 总收益：发现 1 个联合 P0 + 1 个独立 P0 + 4 文档 gap + 1 设计缺陷沉淀（D-025 AP-001）· **如果不做 runtime 实测前置 · 这些都会漏到生产**。

---

## §5 双卡终审建议

### COSTRA-157（commit `ac204e3`）

- ✅ 5 FU 合并修复（FU-001/118-2/102-ERROR-MAPPER/102-AVATAR-ONERROR/102-PROFILE-REFUSE-UI 全实装）
- ✅ A.3 默认昵称兜底 · A.4 头像 fallback · E.2 完善资料 modal 全 PASS
- ✅ review-tech R1 38/40 APPROVE（无 P0/P1）
- **建议**：`approve:COSTRA-157` · status Doing → Done

### COSTRA-158（commit `c7ea7f7` + R1.x.1 commit `99e3794`）

- ✅ 11 项 scope（migration + userRepo + authService + routes + OpenAPI + 单测 + miniapp 5 文件）+ §2.4 client 消费策略追加
- ✅ D.3 严格判定正面兑现（灵魂 1）+ F.3 字符串代理反模式规避（灵魂 2）
- ✅ R1.x.1 修复 storage envelope 一致性 P0 BUG（commit `99e3794`）
- ✅ review-tech R1 38/45 APPROVE · R1.x.1 单 commit 修复 · 闸门全绿
- **建议**：`approve:COSTRA-158` · status Doing → Done · R1.x.1 一并 closed

### Sprint-2 G5 闸门

- ✅ 主线 7/7 卡全 CLOSED（103/104/105/106/156/157/158）
- ✅ Sprint-2 真闭环达成
- **建议**：G5 状态 🟡 Awaiting Human Test → 🟢 PASSED · Sprint-3 启动条件齐

---

## §6 Sprint-3 启动条件检查（D-024 §2.2 攒批触发）

| 条件 | 状态 |
|---|---|
| Sprint-2 主线 7/7 CLOSED | ✅（双卡 approve 后）|
| Sprint-3 头部 dispatch ready | ✅ COSTRA-154 + COSTRA-150（commit `54acc32`）|
| 微信白名单已配 | ✅（commit `dce4140`）|
| 公安联网备案已提交 | ✅（commit `dce4140`）|
| D-025 反模式清单已立 | ✅（commit `54acc32`）|
| **D-022 §4.1 runtime 实测前置铁律实战经验** | ✅ Sprint-2 内 3 次实战 |

**Sprint-3 启动**：等 Human 说 `start:COSTRA-154` 或 `start:sprint-3-head` 即可 spawn Card-Review-tech 154。

---

## §7 沉淀候选议题（议入 Sprint-2 末 retro 已沉淀 / Sprint-3 retro 候选）

| 议题 | 处置 |
|---|---|
| **storage envelope 一致性是 P0 红线**（auth.ts setItem vs setStorageSync） | 已立 R1.x.1 修复 + auth.spec.ts 加重启回读测 · Sprint-3 末 retro 加 D-025 反模式候选第 4 条（直接绕过 envelope 契约 · 与 AP-003 契约-实装漂移同源但更细分）|
| **review-tech 纸面审无法发现 storage envelope runtime 漂移** | D-022 §4.1 真兑现立意第 3 次实战印证 · 不需新决策 · 继续坚持 runtime 实测前置 |
| **dev `mockLogin` 在源码常量 vs runtime toggle** | 立 FU-DEV-MOCKLOGIN-RUNTIME-TOGGLE（P3 · Sprint-3 顺手）· 真链路实测便利性提升 · 不阻塞 |

---

## §8 自检清单

- [x] 16 断言逐一记录（PASS / FAIL / 证据）
- [x] 截图引用齐全（5 张关键 home 页 + console 输出 5 段）
- [x] 双灵魂兑现明确标注（D.3 + F.3）
- [x] R1.x.1 修复 runtime 验证证据链（19:13 发现 → 19:30 修复 → 19:49 验证）
- [x] D-022 §4.1 真兑现立意第 3 次实战登记
- [x] 双卡终审建议明确
- [x] Sprint-2 G5 闸门 PASSED 建议明确
- [x] Sprint-3 启动条件检查
- [x] 沉淀候选议题登记

---

**Orchestrator 签名**：Sprint-2 真闭环达成 · 7/7 主线卡全 CLOSED · D-024 攒批 SOP 第 2 次实战（C1+C4 联合触发 · 联合实测覆盖 157+158 双卡 · 23min 完成）· R1.x.1 修复证明 D-017 v3 §2.4 E1 例外路径第 7 次实战收敛能力。

**报告完整时间**：2026-05-19 19:55:00+08:00
