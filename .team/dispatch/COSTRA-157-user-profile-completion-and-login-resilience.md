# COSTRA-157 · 用户资料完善 + 登录链路鲁棒性（5 FU 合并修复）

> **派单时间**：2026-05-18 17:11（Orchestrator · Human `all-A` 决策后同轮落盘）
> **修订**：2026-05-18 17:32（Card-Review R1 PASS-WITH-FOLLOWUP 25/30 · P1-1 + P1-2 + INFO-1/3 已采纳）
> **触发**：2026-05-12 follow-ups 维护批分析后 Human 决策启动 · `all-A`（Q1~Q5 全按推荐）
> **依赖**：COSTRA-101（Backend 登录 CLOSED · authService.ts 已有 wxLogin）· COSTRA-102（MiniApp 登录链路 CLOSED · login/home/mine 三页均已 bootstrap gate 化）
> **下游解锁**：无强依赖（独立用户体验闭环 · 不阻 Sprint-3）· **弱下游**：Sprint-3 Epic-D 完善资料页（COSTRA-XXX 待立）将接通本卡 E 项临时入口
>
> ✅ **本档已 Card-Review APPROVE**（PASS-WITH-FOLLOWUP 25/30 · P1 全采纳）· 等 R1 实装启动

---

## §0 SBAI 装扮路径

| 阶段 | Subagent | 状态 |
|---|---|---|
| **Card-Review R1**（D-014-a） | `costra-card-reviewer-product`（产品向 · 因为含 UI 降级决策）+ `costra-card-reviewer-tech`（技术向 · 5 项改动各域确认） | 等 Orchestrator 同轮 spawn |
| **R1 实装** | `costra-miniapp-dev`（B/C/D/E 4 项 miniapp 改动 · 主驾）+ `costra-backend-dev`（A 项 server defaults 抽取 · 协作）· 单卡双装扮档（Q4-A 决策）| 等卡审 PASS |
| **R1 Review** | `costra-review-tech`（D-014-b 自动拉起 · D-022 v2.0 评分） | 等 R1 实装完 |
| **Human T1 终审** | `approve:COSTRA-157` | 等 R1 Review APPROVE |

---

## §1 背景

### 1.1 五条 FU 合并范围（已沉淀于 follow-ups README §族 B）

| FU | 类别 | 影响范围 | 红线状态 |
|---|---|---|---|
| FU-001 | 配置化 | `server/src/services/authService.ts:121` 硬编码 `nickname: '微信用户'` | P2 体验缺口 |
| FU-118-2 | 配置化 | `miniprogram/pages/mine/index.ts:39` 硬编码 `'未命名用户'` + `home/index.ts:62` 硬编码 `'微信用户'` | P2 体验缺口 |
| FU-102-ERROR-MAPPER-INTEGRATION | 红线违反 | `miniprogram/pages/login/index.ts:94-96` 错误分支 `msg = e.message` 直渲染到 `errMsg` | **P1 红线**（error-codes.md §0.5）|
| FU-102-AVATAR-ONERROR | 鲁棒性 | `miniprogram/pages/home/index.wxml:5` `binderror="onAvatarError"` 已存在 · 但 `home/index.ts` 无 `onAvatarError` 方法 → 头像 404 时无 fallback 触发 | P1 静默失败 |
| FU-102-PROFILE-REFUSE-UI | 体验 | 用户拒绝 `wx.getUserProfile` 时 home 页 `userName` / `userAvatar` 兜底显示 | P2 体验缺口 |

### 1.2 同一产品故事

> **登录后用户资料正确呈现 + 异常降级**：从 server 默认昵称 → wxLogin 返回 → MiniApp 端展示 → 拒绝授权降级 → 头像 404 降级 → 错误提示守红线 · 全链路 5 个环节一次性兜住

### 1.3 Human 2026-05-18 17:11 决策（Q1~Q5 全 A）

- **Q1-A**：home 页用户拒绝授权 → 占位头像 + "欢迎"无名版 + 右上角"完善资料"角标入口
- **Q2-A**：`server/src/config/defaults.ts` 硬编码 fallback `'微信用户'` · 不支持 env 覆盖（MVP）
- **Q3-A**：**不**合并 FU-COMMON-MINIAPP-PATCH-LIMIT · 留 COSTRA-152 顺手做（守 INVEST small）
- **Q4-A**：单卡双装扮档（backend-dev + miniapp-dev 同对话轮顺序装扮 · 单 commit 历史 · D-016 同轮兑现）
- **Q5-A**：E 项"完善资料"入口先用临时方案 · 文字链 + `wx.showModal` 提示"功能开发中" · Sprint-3 Epic-D 完善资料页落地后再接通

---

## §2 Scope（5 项 · 严守 INVEST small）

### 2.1 主交付（5 项 · 必交）

#### A · `server/src/config/defaults.ts` 默认昵称配置化（新建文件 · ~10 行）

**注**：与 `server/src/config/{env,icp,subject,ttl}.ts` 范式一致 · `defaults.ts` 定位为"编译期常量"（非运行时配置）· **未来扩展**：当真有多环境 / 多商户 / 多主体差异化需求时，`defaultNickname` 升级为 `subjectConfig.defaultNickname`（与 D-008 主体策略联动）· MVP 阶段保持硬编码（Q2-A 决策）。

```ts
// server/src/config/defaults.ts
// Costra · 服务端默认值集中常量
// 卡号：COSTRA-157 · FU-001 转正
//
// 职责：集中暴露"业务占位/默认值"常量 · 业务代码不得硬编码字符串
// 当前消费方：authService.ts:wxLogin（首登用户昵称占位）
// 未来扩展：Q2-A 决策不引入 env 覆盖 · 真有需求时升级到 subjectConfig 联动

export const defaultNickname = '微信用户';
```

**`server/src/services/authService.ts` 改动**：
- L121 `nickname: '微信用户'` → `nickname: defaultNickname`
- 新增 import：`import { defaultNickname } from '../config/defaults.js';`

#### B · MiniApp 端硬编码昵称同步配置化（2 处）

**`miniprogram/pages/mine/index.ts:39`**：
```ts
// 改动前：nickname: s?.user?.nickname || '未命名用户',
// 改动后：nickname: s?.user?.nickname || defaultNickname,
```

**`miniprogram/pages/home/index.ts:62`**（hydrateUser）：
```ts
// 改动前：userName: (u && u.nickname) || '微信用户',
// 改动后：userName: (u && u.nickname) || defaultNickname,
```

**新增 `miniprogram/config/defaults.ts`**（与 server 端对齐 · 不直接复用 server config 因为 miniprogram 编译边界隔离）：
```ts
// miniprogram/config/defaults.ts
// 卡号：COSTRA-157 · FU-118-2 + FU-001 同步
// ⚠️ 必须与 server/src/config/defaults.ts 保持值一致（手工对齐 · COSTRA-160 tokens pipeline 可能扩展为构建期同步）
export const defaultNickname = '微信用户';
```

#### C · login 页错误分支走 mapError（FU-102-ERROR-MAPPER-INTEGRATION · 守红线）

**`miniprogram/pages/login/index.ts:87-97`**：

当前代码：
```ts
} catch (e: any) {
  let msg = '登录失败，请重试';
  if (e?.code === 'CLIENT_NETWORK_ERROR') {
    msg = '网络异常';
  } else if (e?.status === 401) {
    msg = '登录失败，请重试';
  } else if (e?.message) {     // ← 红线违反：直接拿 server message
    msg = e.message;
  }
  this.setData({ errMsg: msg });
}
```

目标代码：
```ts
} catch (e: any) {
  // FU-102-ERROR-MAPPER-INTEGRATION (COSTRA-157)
  // error-codes.md §0.5 红线：客户端不得直接展示 message 给终端用户
  const mapped = mapError(e);
  this.setData({ errMsg: mapped.title ? `${mapped.title}：${mapped.desc}` : '登录失败，请重试' });
}
```

新增 import：`import { mapError } from '../../utils/error-mapper';`

**注**：`error-mapper.ts` 现有 `MappedError.action` 字段（如 `navigate-login`）暂不消费 · 留 Sprint-3 用户体验扩展时再接（不属本卡 scope）

#### D · home 页头像 onError handler（FU-102-AVATAR-ONERROR）

**`miniprogram/pages/home/index.ts`** 新增方法（紧跟 hydrateUser 之后）：

```ts
/**
 * 头像加载失败兜底
 * 卡号：COSTRA-157 · FU-102-AVATAR-ONERROR
 * 触发：avatar URL 404 / CORS / 微信 CDN 不可达
 * 策略：清空 userAvatar · home.wxml 通过 wx:if 切换到 fallback 图标 (👤)
 */
onAvatarError() {
  this.setData({ userAvatar: '' });
}
```

**注**：`home/index.wxml:5` `binderror="onAvatarError"` 已存在（COSTRA-102 R1 已布桩）· 本卡仅补 handler 实装

#### E · home 页拒绝授权降级 UI + "完善资料"临时入口（FU-102-PROFILE-REFUSE-UI）

**`miniprogram/pages/home/index.ts` hydrateUser 改造**：
```ts
hydrateUser() {
  const tk = getToken();
  const u = tk?.raw?.user;
  // FU-102-PROFILE-REFUSE-UI (COSTRA-157 · Q1-A 占位头像 + 欢迎)
  // 区分两种状态：(a) 有真实昵称 = 用户授权过 (b) 空昵称 = 未授权 / server 默认值
  const hasProfile = !!(u && u.nickname && u.nickname !== defaultNickname);
  this.setData({
    userName: (u && u.nickname) || defaultNickname,
    userAvatar: (u && u.avatarUrl) || '',
    hasProfile,                     // ← 新增 data 字段 · 控制"完善资料"入口显示
  });
},

/**
 * 卡号：COSTRA-157 · FU-102-PROFILE-REFUSE-UI · Q5-A 临时方案
 * 用户点击右上角"完善资料 →" · 当前 Sprint-3 Epic-D 完善资料页未实装
 * 临时弹 modal · 待 Sprint-3 接通真实页面后改为 wx.navigateTo
 */
onTapCompleteProfile() {
  wx.showModal({
    title: '完善资料',
    content: '资料完善功能开发中 · 即将上线（Sprint-3 Epic-D）',
    showCancel: false,
  });
}
```

**`miniprogram/pages/home/index.wxml` 顶部新增**：
```xml
<!-- FU-102-PROFILE-REFUSE-UI (COSTRA-157 · Q1-A) · 未授权时显示完善资料入口 -->
<view wx:if="{{!hasProfile}}" class="greeting__action" bindtap="onTapCompleteProfile">
  完善资料 →
</view>
```

**`miniprogram/pages/home/index.wxss` 新增**：
```css
.greeting__action {
  position: absolute;
  top: 20rpx;
  right: 32rpx;
  font-size: 26rpx;
  color: var(--color-text-secondary, #999);
  padding: 8rpx 16rpx;
}
```

**data 段新增**（`pages/home/index.ts` Page.data）：
```ts
hasProfile: false,
```

**⚠️ 已知边界**（Card-Review P1-1 修订 · 2026-05-18 17:32）：

若用户真实昵称恰好等于 `defaultNickname`（即 `'微信用户'` · 极低概率边界），`hasProfile` 判定为 `false` → 已授权用户错误显示"完善资料 →"入口。

**MVP 接受此风险的理由**：
1. 概率极低（用户名 = 占位字符串 = 撞库情况）· 即便误显示，点击后 `wx.showModal` 提示"功能开发中"也不构成功能错误
2. Sprint-3 Epic-D 完善资料页落地后，该字段将改为消费服务端的 `user.has_completed_profile` 显式标记，不再依赖昵称比较 → 边界自然消失
3. 不引入额外字段（如 `user.is_default_nickname`）· 守 INVEST small

### 2.2 副交付（2 项 · 单测）

#### F · 单测覆盖

- 新增 `server/test/defaults.test.ts`（1~3 测）：`defaultNickname` 字符串值断言（防误删 / 误改）+ authService.wxLogin mock code2Session 后断言新建用户 nickname 为 defaultNickname
- 新增 `miniprogram/pages/home/index.spec.ts`（2~3 测）：onAvatarError 清空 userAvatar 路径 · hydrateUser 区分 hasProfile 路径 · onTapCompleteProfile mock wx.showModal 调用断言
- 修订 `miniprogram/pages/login/index.spec.ts`（如已存在）：错误分支断言 errMsg 含 mapError 文案 · grep 反向断言不再含 `e.message`

### 2.3 协议对齐（0 项）

- ✅ OpenAPI 不变（未触及契约层）
- ✅ error-codes.md 不变（仅消费）
- ✅ ADR-0002 不变

---

## §3 DoD（可度量 · 12 项）

### §3.1 主交付（5 项）

- [ ] A · `server/src/config/defaults.ts` 新建 · 导出 `defaultNickname` · authService.ts:wxLogin 改读
- [ ] B · `miniprogram/config/defaults.ts` 新建 · `home/index.ts:62` + `mine/index.ts:39` 改读
- [ ] C · `login/index.ts:87-97` 错误分支走 `mapError` · grep 反向断言 0 命中 `msg = e.message`
- [ ] D · `home/index.ts` 新增 `onAvatarError` 方法 · 清空 userAvatar
- [ ] E · home.wxml + wxss + ts 三处加"完善资料"入口 · 临时方案 wx.showModal

### §3.2 副交付（1 项）

- [ ] F · 单测全绿 · server defaults.test.ts + miniapp home.spec.ts (+ login.spec.ts 修订如有)

### §3.3 闸门（≥ 7 项 · 必跑全绿才提交）

| # | 闸门 | 命令 | 期望 |
|---|---|---|---|
| G1 | typecheck | `npm run typecheck` | 0 错 |
| G2 | lint | `npm run lint` | 0 warn |
| G3 | test | `npm run test` | 全绿（含 server + miniapp 双侧）|
| G4 | check:appjson | `npm run check:appjson` | exit 0 |
| G5 | check:tooling | `npm run check:tooling` | exit 0 |
| G6 | check:whitelist | `npm run check:whitelist` | exit 0 |
| **G7** | **defaults 双端对齐**（Card-Review P1-2 修订 · 2026-05-18 17:32）| `grep -h "defaultNickname = '" server/src/config/defaults.ts miniprogram/config/defaults.ts \| sort -u \| wc -l \| tr -d ' '` | 输出 = `1`（两端同值 · 不一致则 ≥ 2）|

### §3.4 反向验证（2 项）

- [ ] G8 · 临时改 server `defaultNickname = ''` → server defaults.test.ts FAIL · revert → PASS
- [ ] G9 · 临时把 `login/index.ts` 错误分支改回 `msg = e.message` → grep 反向断言 1 命中 / 单测 FAIL · revert → 0 命中 + PASS
- [ ] G10 · 临时改 miniapp `defaultNickname = '其他值'` → G7 输出 `2` · revert → 输出 `1`（双端对齐反向验证）

---

## §4 强制阅读清单（subagent spawn 时 §G inline）

### §4.1 必读

1. **本派单档全文**（唯一执行依据）
2. `.team/follow-ups/README.md` 族 B（5 条 FU 完整描述 + 卡号关联）
3. `docs/api/error-codes.md §0.5`（C 项红线事实源）
4. `miniprogram/utils/error-mapper.ts`（C 项 mapError 签名 + DEFAULT_MAP）
5. `miniprogram/pages/login/index.ts:87-97`（C 项当前错误分支）
6. `miniprogram/pages/home/index.ts`（D/E 项当前实装）
7. `miniprogram/pages/home/index.wxml:5`（D 项 binderror 已存在）
8. `server/src/services/authService.ts:121`（A 项 hardcoded nickname）
9. `miniprogram/pages/mine/index.ts:39`（B 项 hardcoded nickname）

### §4.2 按需

- `.team/decisions/D-008-subject-strategy.md`（Q2-A 不联动 subjectConfig 的依据）
- `.team/decisions/D-022-review-tech-evaluation-matrix-v2.md`（review-tech 评分维度）
- `miniprogram/config/subject.ts`（B 项配置文件位置范式）
- `server/src/config/`（A 项配置文件位置范式）

---

## §5 硬约束（不可违反）

### §5.1 工作区铁律（COMMON-CONTRACT §0-Bis · G8 闸门）

- ✅ **server 装扮档可写**：`server/src/config/defaults.ts` 新建 · `server/src/services/authService.ts` 改 · `server/test/defaults.test.ts` 新建
- ✅ **miniapp 装扮档可写**：`miniprogram/config/defaults.ts` 新建 · `miniprogram/pages/{login,home,mine}/index.{ts,wxml,wxss}` 改 · `miniprogram/pages/home/index.spec.ts` 新建
- ✅ **共用可写**：`.team/follow-ups/README.md`（5 条 FU 同轮 close） · `.team/members/{backend-dev,miniapp-dev}/`
- ❌ **不可写**：openapi.yaml · error-codes.md · sync-protocol.md · 其他业务路由 / 其他 page

### §5.2 Q3-A 严守 INVEST · 不扩 PATCH→PUT

- 不动 server route 的 PATCH 方法
- 不动 miniprogram request.ts 的 X-HTTP-Method-Override 降级
- FU-COMMON-MINIAPP-PATCH-LIMIT 留 COSTRA-152 顺手做

### §5.3 D-016 同轮兑现

- 派单 → Card-Review → R1 实装（backend-dev 段 + miniapp-dev 段）→ review-tech R1 在同一对话轮内连续 spawn

### §5.4 D-022 v2.0 评分表（review-tech R1 时适用 · 40 分制）

| 维度 | 满分 | 本卡重点 |
|---|---|---|
| C1 契约对齐 | 5 | A 项 server config 范式（D-008 联动暂不做但需说明）|
| C2 代码质量 | 5 | 5 项改动均为最小集 · 无超 scope |
| C3 架构合理 | 5 | server / miniapp 两端 defaults 各一份（编译边界隔离 · 手工对齐）|
| C4 数据完整 | 5 | hasProfile 字段判定逻辑（`u.nickname !== defaultNickname`）|
| C5 安全 | 5 | C 项守红线（不直出 message）· 不引入新攻击面 |
| C6 可测性 | 5 | F 项单测 + G7/G8 反向验证 |
| C7 纪律 | 5 | INVEST small（3 点）· D-016 同轮 · D-018 commit footer |
| **C8 runtime 加载性** | 5 | A 项 server config 启动期加载 · B 项 miniapp config 编译期 inline · 无 runtime 风险 |
| **C9 性能** | 0 | 不适用（无 hot path）|
| **C10 SBAI 流程合规** | 5 | 单卡双装扮档 · 严守工作区铁律 |

### §5.5 严守 INVEST small（3 点）

- 3 点 · ~ 90 分钟 R1 实装时间盒
- 5 项改动均为单点修改 · 无重构

---

## §6 提交（D-012 单卡即提交 · D-018 commit footer）

R1 commit message：

```
feat(repo): user profile completion + login resilience (COSTRA-157)

- A: extract defaultNickname to server/src/config/defaults.ts (FU-001)
- B: extract defaultNickname to miniprogram/config/defaults.ts (FU-118-2)
- C: route login error branch through mapError (FU-102-ERROR-MAPPER-INTEGRATION · §0.5 redline)
- D: implement home onAvatarError handler (FU-102-AVATAR-ONERROR)
- E: home unauthorized fallback UI + temp "complete profile" entry (FU-102-PROFILE-REFUSE-UI · Q5-A stub)

5 FUs closed in single card · INVEST small 3pt · all gates green.

Refs: .team/follow-ups/README.md §族 B · COSTRA-101 / COSTRA-102

Co-Authored-By: backend-dev <subagent>
Co-Authored-By: miniapp-dev <subagent>
```

---

## §7 估点 / 时间盒

- **估点**：3 点
- **时间盒**：R1 实装 ≤ 90 分钟（INVEST small 上限）
- **R1 拆分时长预估**：
  - A 项 server defaults：15 min
  - B 项 miniapp defaults：10 min
  - C 项 mapError：20 min
  - D 项 onAvatarError：10 min
  - E 项 home 降级 UI：30 min
  - F 项 单测：15 min（合并 A/B/C/D/E 共 6~9 测）
  - 闸门 + commit：~10 min

---

## §8 联合 Sprint-2 末 Retro 议题（如有 · 157 完成后兑现）

- 🆕 **议题候选**：FU 合并修复范式 · 5 条 P1/P2 FU 一卡清完的可复用模板（首次实战 · 与"切出去 3 件套铁律"互补）
- 🆕 **议题候选**：跨域配置同步 · server `config/defaults.ts` 与 miniprogram `config/defaults.ts` 手工对齐 · COSTRA-160 tokens pipeline 是否扩展为通用 config sync

---

## §9 附录 · Human 验证清单（R1 完成后 · 5 分钟 mock 模式）

| # | 步骤 | 期望 |
|---|---|---|
| 1 | 模拟器冷启 · 不点登录 → 看 login 页是否正常渲染 | ✅ 渲染正常 |
| 2 | 点击"一键微信登录" · 同意授权 · 跳 home → 顶部"你好，<昵称>" | ✅ 显示真实昵称 · 无"完善资料"入口 |
| 3 | 退出登录 · 重新点登录 · 拒绝授权 → 跳 home | ✅ 显示"你好，微信用户" + 右上角"完善资料 →" |
| 4 | 点击"完善资料 →" | ✅ 弹 modal "资料完善功能开发中" |
| 5 | 设置 home 页 userAvatar 为不可达 URL（DevTools 改 storage）→ 重启 | ✅ 头像 fallback 到 👤 图标（无报错）|
| 6 | 模拟登录失败（关闭 server）· 看 login 页错误提示 | ✅ 不显示 server `message` 原文 · 显示 mapError 文案 |

如全部 PASS → Human 发 `approve:COSTRA-157`。

---

_本档由 Orchestrator 在 2026-05-18 17:11 落盘 · Human all-A 决策同轮 · 2026-05-18 17:32 Card-Review R1 PASS-WITH-FOLLOWUP 25/30（P1-1/P1-2/INFO-1/3 已采纳）· 等 R1 实装启动（D-014-b 自动拉起 · D-016 同轮兑现）_
