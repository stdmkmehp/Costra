# Costra · 信息架构（IA）v0.1

> **卡号**：COSTRA-010 · **Owner**：Design-Agent · **产出日期**：2026-04-21
> **依赖**：`docs/PRD.md` v0.1、`docs/charter.md` v2.2、`ADR-0004` §2/§3/§7/§8
> **对齐**：本文件所有页面路径、分包归属、登录态要求 **对 MiniApp-Agent（COSTRA-030）直接可消费**。

---

## 1. 设计目标

1. 把 PRD 的 7 个 Epic / 21 个 Story 翻译成**小程序端可落地的页面树**
2. 冻结 **TabBar** / **分包边界** / **登录态边界**，供工程骨架一次到位
3. 与 ADR-0004 §2（分包策略）严格一致，主包体积红线 ≤ 1.5MB

---

## 2. TabBar（冻结）

4 个 Tab，对齐 PRD Epic-B/C/D/F 与微信《内容设计规范》的底部导航≤5项建议。

| # | Tab 名 | 图标占位 | 默认路由（冷启）| 所属分包 | 登录态 |
|---|---|---|---|---|---|
| 1 | 记账 | `icon-ledger` | `pages/home/index` | main | ✅ 必须 |
| 2 | 家庭 | `icon-family` | `pages-family/dashboard/index` | **pages-family** | ✅ 必须 |
| 3 | 统计 | `icon-stat` | `pages-stat/overview/index` | **pages-stat** | ✅ 必须 |
| 4 | 我的 | `icon-me` | `pages/me/index` | main | ✅ 必须 |

> 📌 说明：Tab 2/3 指向分包页面，利用微信[分包预下载](https://developers.weixin.qq.com/miniprogram/dev/framework/subpackages/preload.html)在首屏完成后静默预拉，实测可做到点击切换 < 300ms。
>
> 📌 **tabBar custom 切换计划**（Round-1 P2-3 · 与 design-system `c-tab-bar` 对齐）：Sprint-0 骨架期 `custom: false`，走原生 tabBar 最稳；**Sprint-2 D1 配合 design-system `c-tab-bar` 深色模式/红点/Badge 能力**切换到 `custom: true` + `pages/custom-tab-bar/index`，切换动作由单独 PR 完成并跑全量回归。

**`app.json` tabBar 草案**：
```json
{
  "tabBar": {
    "custom": false,
    "color": "#7A7E83",
    "selectedColor": "#07C160",
    "backgroundColor": "#FFFFFF",
    "list": [
      { "pagePath": "pages/home/index", "text": "记账" },
      { "pagePath": "pages-family/dashboard/index", "text": "家庭" },
      { "pagePath": "pages-stat/overview/index", "text": "统计" },
      { "pagePath": "pages/me/index", "text": "我的" }
    ]
  },
  "preloadRule": {
    "pages/home/index": { "network": "all", "packages": ["pages-stat", "pages-family"] }
  }
}
```

---

## 3. 页面树（完整覆盖 21 Story）

### 3.1 主包 `pages/`（预估 0.8MB）

| 页面 | 路由 | 覆盖 Story | 依赖 API | 登录态 |
|---|---|---|---|---|
| 启动页/授权引导 | `pages/launch/index` | COSTRA-101 | `POST /v1/auth/wx-login` | 否（登录入口） |
| 手机号绑定 | `pages/bind-phone/index` | COSTRA-102 | `POST /v1/auth/bind-phone` | Token（未绑手机） |
| 首页·流水 | `pages/home/index` | COSTRA-113/114/121 | `GET /v1/ledger/entries`、`GET /v1/sync/pull` | ✅ |
| 记一笔 | `pages/entry-edit/index` | COSTRA-113 | `POST /v1/ledger/entries` | ✅ |
| 流水筛选 | `pages/entry-filter/index` | COSTRA-114 | 同上（带 query） | ✅ |
| 账户管理 | `pages/accounts/index` | COSTRA-111 | `GET/POST /v1/accounts` | ✅ |
| 账户编辑 | `pages/account-edit/index` | COSTRA-111 | `PATCH /v1/accounts/{id}` | ✅ |
| 分类管理 | `pages/categories/index` | COSTRA-112 | `GET/POST /v1/categories` | ✅ |
| 我的 | `pages/me/index` | COSTRA-401（入口汇总）| — | ✅ |
| 设置 | `pages/settings/index` | COSTRA-402 | — | ✅ |
| 关于 & 隐私 | `pages/about/index` | Epic-G 合规 | — | 否 |

### 3.2 分包 `pages-stat/`（预估 0.6MB，懒加载）

| 页面 | 路由 | 覆盖 Story | 依赖 API | 登录态 |
|---|---|---|---|---|
| 统计总览 | `pages-stat/overview/index` | COSTRA-501 | `GET /v1/ledger/stats/monthly` | ✅ |
| 分类占比（饼图） | `pages-stat/category-pie/index` | COSTRA-502 | `GET /v1/ledger/stats/categories` | ✅ |
| 趋势（折线图） | `pages-stat/trend/index` | COSTRA-503 | `GET /v1/ledger/stats/trend` | ✅ |
| 年度报告 | `pages-stat/annual/index` | COSTRA-504 | `GET /v1/ledger/stats/annual` | ✅ |

### 3.3 分包 `pages-family/`（预估 0.5MB，懒加载）

| 页面 | 路由 | 覆盖 Story | 依赖 API | 登录态 |
|---|---|---|---|---|
| 家庭面板 | `pages-family/dashboard/index` | COSTRA-201 | `GET /v1/families/{id}` | ✅ |
| 创建家庭 | `pages-family/create/index` | COSTRA-201 | `POST /v1/families` | ✅ |
| 加入家庭（输入邀请码） | `pages-family/join/index` | COSTRA-202 | `POST /v1/families/join` | ✅ |
| 邀请分享卡片预览 | `pages-family/invite/index` | COSTRA-202 | `POST /v1/families/{id}/invites` | ✅ |
| 成员管理 | `pages-family/members/index` | COSTRA-204 | `GET/PATCH/DELETE /v1/families/{id}/members` | ✅（owner/admin）|
| 预算设置 | `pages-family/budget/index` | COSTRA-301 | `GET/PUT /v1/budgets` | ✅ |
| 订阅消息授权 | `pages-family/subscribe/index` | COSTRA-203/302 | `POST /v1/subscribe-tokens` | ✅ |

### 3.4 体积预算核算

| 分包 | 预估 | 红线（ADR-0004 §2）|
|---|---|---|
| 主包 | ~0.8MB | **≤ 1.5MB**（预留 0.7MB）|
| `pages-stat` | ~0.6MB | ≤ 2MB |
| `pages-family` | ~0.5MB | ≤ 2MB |
| 合计 | ~1.9MB | ≤ 16MB |

骨架期基线由 `scripts/mp-ci/size-check.mjs` 在每次 PR 跑一次（对接 DevOps COSTRA-040）。

> 📌 **主包硬约束**（Round-1 P2-2）：主包预留 0.7MB 较为紧张。**任何向主包 `pages/` 目录新增页面或引入 >50KB 的依赖的 PR，必须先本地跑 `npm run size-check` 通过再提交**；CI 侧 `size-check.mjs` 对 `main` 分支包体阈值从 1.5MB 下调硬警戒线为 **1.3MB**（留 0.2MB 安全垫），超过即 block。如确需突破，走 ADR 决策流程。

---

## 4. 登录态与路由守卫

### 4.1 页面登录态分级

- `AuthRequired`：所有 `pages/home`、`pages-stat/*`、`pages-family/*`、`pages/me/*`
- `AuthOptional`：`pages/launch`、`pages/about`
- `AuthPartial`（拿到 token 但未绑手机）：仅 `pages/bind-phone`；**用户可自由浏览 AuthRequired 页面**（详见 §4.2 判定 3）

### 4.2 守卫策略（MiniApp 工程侧落地建议）

```
onAppShow → 检查 wx.storage.accessToken
  ├─ 判定 1：无 token → redirectTo pages/launch（除非当前已是 AuthOptional）
  ├─ 判定 2：过期 → silent refresh（POST /v1/auth/refresh），失败回 launch
  ├─ 判定 3：AuthPartial（有 token, 未绑手机）
  │     ├─ 当前路由 ∈ AuthOptional/AuthRequired → **不拦截**，正常放行
  │     └─ 仅当用户触发"关键操作"（创建家庭 / 订阅消息 / 数据导出）
  │         时 wx.showModal 引导 redirectTo pages/bind-phone
  │         （冷却期 7 天，对齐 flows/login.md §4 分支策略）
  └─ 兜底：任何异常态 → 清 storage → redirectTo pages/launch
```

**判定 3 的设计考量**（Round-1 P1-2）：
- MVP 不强拦：避免用户"刚进小程序就被要求绑手机"的高弃率场景；
- 未绑手机不等于未登录：`accessToken` 已有效，`pages/home` 记账、`pages-stat` 浏览均可正常使用；
- 关键操作再拦：创建家庭（需发短信/客服回访）、订阅消息（合规留痕）等触发时再引导绑定。

详见 `docs/design/flows/login.md` §4。

---

## 5. 导航与场景串联

### 5.1 Deep Link / 场景值覆盖

| 场景值 | 来源 | 落地页 | 备注 |
|---|---|---|---|
| 1001 | 发现栏 | `pages/launch` | 默认 |
| 1007/1008 | 单人/群聊会话 | `pages-family/join?code=xxx` | 微信分享卡片打开家庭邀请 |
| 1037 | 小程序直接打开 | `pages/launch` | — |
| 1047 | 扫描二维码 | `pages-family/join?code=xxx` | 海报引流 |

> 📌 **失效 code 兜底**（Round-1 P2-1）：1007/1008/1047 携带的邀请 `code` 可能为空串、格式非法、或已过期/撤销。`pages-family/join` 入口必须做兜底判断：
> - `code` 为空或长度异常 → 展示"邀请链接无效，请联系邀请人"+ 返回首页按钮；
> - `code` 校验（`POST /v1/families/join` 返回 4xx `invitation_expired` / `invitation_revoked` / `invitation_exhausted`）→ 展示对应文案 + 返回首页按钮；
> - 服务端 5xx → "稍后再试" toast，保留输入框允许重试。

### 5.2 关键跳转链路

```
launch → home ──┬─→ entry-edit（FAB "+"）
                ├─→ entry-filter（顶部筛选图标）
                └─→ entry-detail（列表点击，modal 形态）

home → accounts → account-edit
me → settings / about / categories

home(tabBar) → pages-family/dashboard → invite
                                      → members → budget
                                      → subscribe（预算超支授权入口）

pages-family/subscribe → subscribe-result（成功 toast，自动回退）
```

---

## 6. 关键流程时序索引

4 条核心链路单独成文，本节只做索引：

1. [微信登录闭环](./flows/login.md) — COSTRA-101/102/103
2. [记一笔 · 本地先写 + 异步同步](./flows/add-entry.md) — COSTRA-113/121/122
3. [家庭邀请 · 邀请码 + 分享卡片](./flows/family-invite.md) — COSTRA-201/202
4. [预算超支订阅消息下发](./flows/budget-subscribe-msg.md) — COSTRA-301/302

每张时序图均标注耗时预算（首屏 ≤ 2s、接口 p95 ≤ 800ms）。

---

## 7. 与其他 Agent 的接口

| 对手 | 约定 | 状态 |
|---|---|---|
| MiniApp-Agent (COSTRA-030) | 以本文件 §2/§3 为 `app.json` pages / tabBar / subpackages 的唯一来源 | ✅ 直接可用 |
| Backend-Agent (COSTRA-020) | 本文 §3 "依赖 API" 列为 OpenAPI 路径出厂值；字段命名以 OpenAPI 为准 | ⏳ 待双签 |
| QA-Agent (COSTRA-050) | 冒烟集路径命名以本文件路由为准 | ⏳ 待引用 |
| DevOps-Agent (COSTRA-040) | 体积红线由本文 §3.4 冻结 | ✅ 一致 |

---

## 8. 引用（官方锚点）

- 微信小程序分包加载：https://developers.weixin.qq.com/miniprogram/dev/framework/subpackages/
- 分包预下载：https://developers.weixin.qq.com/miniprogram/dev/framework/subpackages/preload.html
- 场景值列表：https://developers.weixin.qq.com/miniprogram/dev/reference/scene-list.html
- tabBar 配置：https://developers.weixin.qq.com/miniprogram/dev/reference/configuration/app.html#tabBar
- 路由 API：https://developers.weixin.qq.com/miniprogram/dev/api/route/wx.redirectTo.html

---

**Refs**: COSTRA-010 · **Impacts**: COSTRA-020, COSTRA-030, COSTRA-050
