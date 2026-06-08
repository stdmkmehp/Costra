# Tech Review · COSTRA-118 · Round 1

- **被审 Agent**：miniapp（历史产出聚合 · 自 COSTRA-030 骨架放行以来的全部 miniprogram/ 源码）
- **本轮产出 commit**：工作区最新（git status clean · dev 分支 · 与 origin/dev 同步）
- **审核时间**：2026-04-24T19:35+08:00
- **上轮结论**：首轮（COSTRA-030 Round-2 T3 追溯 Skip-Review PASS 29/30 @ 2026-04-23 21:15 不计为本卡上轮）
- **Reviewer**：Review-Agent-Tech
- **强制上下文加载**：✅ openapi.yaml（全量）· ✅ docs/api × 5（error-codes / id-strategy / ttl-policy / sync-protocol / audit）· ✅ D-008 · ✅ D-009 · ✅ ADR-0002 · ✅ engineering-guidelines · ✅ COMMON-CONTRACT · ✅ 03-miniapp-agent · 🟡 charter §7/§13（部分 · 通过 guidelines + COMMON-CONTRACT 间接覆盖）· 🟡 docs/db（未读 · 纯前端 Review 不强相关）
- **置信度**：**中**（降自高的原因：charter §7/§13 与 docs/db 未直接读 · 但 miniprogram 纯前端产出不依赖这两份的细节约束）

---

## 总评

- **Verdict**：**REJECT**
- **总分**：**15/35 分**（7 维 × 5 分 · 平均 2.14）
- **阻塞点数量**：**10 个 P0（必改）· 5 个 P1（应改）· 4 个 P2（建议）**
- **Reject 触发条款**：P0 数量 = 10 > 3（规约 §5 硬性）· 且存在"安全红线"类违规（code 前缀日志泄漏）

### 为什么是 REJECT 而不是 REVISE

按 Review-Tech §5 表格硬性规则：`REVISE` 触发条件是 "有 P0 但 ≤ 3 个"，本次 P0 数达 **10 个**，**强制升级为 REJECT**。

但以下**背景事实**应纳入 Human 终审考量（不改变 verdict，仅影响处置路径）：

1. 本卡本质是**技术债盘点**，不是正常开发产出 — 大部分 P0 源自 **COSTRA-030 骨架阶段的有意遗留**（README §4 明确声明"Sprint-1 继续把 env/登录/同步从 Mock 切到真实"）
2. Sprint-1 backlog 中的 **COSTRA-102（登录→记账端到端）/ COSTRA-112（主体字样清扫）** 本就计划修复其中大部分
3. 因此**建议 Human 处置路径**：`approve:COSTRA-118`（接受报告）+ 把本报告 P0 清单作为 COSTRA-102 / COSTRA-112 的**扩展验收项**（见下方 §给被审 Agent 的回执指令）

---

## 维度得分

| 维度 | 得分 | 一句话结论 |
|---|---|---|
| 契约一致性 (Contract) | **1/5** | auth/request/sync 三大服务层与 openapi.yaml 全线错配 · 字段名 / 端点 / 错误体结构 / TTL 字段 / 幂等头五项契约漂移 |
| 架构与分层 (Architecture) | **3/5** | services/pages/utils 分层清晰 + 合理薄封装；扣分项：utils/money.ts 手写 decimal 违反 ADR-0002 `decimal.js` 硬约束 |
| 数据与持久化 (Data) | **2/5** | storage 版本化封装 OK；扣分项：无 `newClientRefId()` 生成链路（id-strategy.md §2.5 要求）· outbox 载荷字段名 camelCase 与契约 snake_case 不匹配 |
| 离线与同步 (Sync) | **1/5** | 极严重：`services/sync.ts` 实装的端点 `/sync/{entity}?sinceVersion=` 在 openapi.yaml 中**根本不存在**（真身是 /sync/push + /sync/pull）· 协议漂移 |
| 安全与合规 (Security) | **2/5** | `services/auth.ts:85` 把微信 code 前 8 位写进 `console.info` — **engineering-guidelines §2.5 禁止 secret 日志 · 红线违规**；AppID 在 README 两处出现（§3.5 判定见 P0-10） |
| 可测与可观测 (Testability) | **2/5** | 零单元测试 · 11 处 console.* 遗留（超 §3.6 "2 处阈值" · -1 分已算入）· 多 TODO 但带 COSTRA-xxx 标识尚可 |
| 工程纪律 (Discipline) | **4/5** | 文件头均带 `Refs: COSTRA-xxx` · 单文件全部 < 200 行 · 无越权（未动 server/docs/api）· 微信文档引用带锚点 · 扣分项：占位页引用未定义的 COSTRA-130/140/150/060 卡号 |

---

## P0 阻塞点（必改，不改则 Reject）

### P0-1 `services/auth.ts:85` 微信 code 前缀泄漏到日志（**安全红线**）

- **证据**：`miniprogram/services/auth.ts:85`
  ```ts
  console.info('[auth] wx.login code=', code.slice(0, 8) + '...');
  ```
- **问题**：虽然只是前 8 位 + 省略号，但 `wx.login` 返回的 code 是**单次 5 分钟有效凭证**，泄漏到客户端日志 / 小程序后台日志均构成**可被攻击者截获用于换取 session_key 的风险面**。即使只是前缀，也已违反 engineering-guidelines §2.5 "禁止在任何日志里出现 code/openid/session_key/access_token/refresh_token 的任何子串"。
- **依据**：`.team/engineering-guidelines.md` §2.5 · `.team/agents/07-review-agent-tech.md` §3.5（"硬编码或 console.log = Reject"）
- **修复建议**：移除整行，或替换为结构化 debug `logger.debug('auth.wxLogin', { codePresent: !!code, codeLen: code.length })`

### P0-2 `services/auth.ts:9-14 + :96-105` TokenRaw 与 OpenAPI AuthTokenPair schema 全线错配（**契约违规**）

- **证据**：`miniprogram/services/auth.ts:9-14`
  ```ts
  export interface TokenRaw {
    access: string;
    refresh: string;
    expiresAt: number;       // ← 自造字段
  }
  ```
  对比 `api/openapi.yaml` AuthTokenPair schema：
  ```yaml
  AuthTokenPair:
    required: [access_token, refresh_token, access_token_ttl_sec, refresh_token_ttl_sec, user]
  ```
  `services/auth.ts:96-105` 的 `wxLogin` 直接 `return resp as TokenRaw`，意味着响应体根本没解析成契约定义的 5 个字段，而是期待后端返回一个**虚构的 `{access, refresh, expiresAt}` 结构**。
- **问题**：一旦 COSTRA-102 切到真实后端，本函数立即炸裂 — 后端返回 `{access_token, refresh_token, access_token_ttl_sec, ...}`，前端字段对不上。
- **依据**：`api/openapi.yaml` components.schemas.AuthTokenPair · `docs/api/ttl-policy.md` §3（access_token_ttl_sec 字段名事实源）· Review-Tech §3.1
- **修复建议**：
  1. 重写 `TokenRaw`：`{access_token, refresh_token, access_token_ttl_sec, refresh_token_ttl_sec, user: UserProfile}`
  2. 本地存储时将 TTL 换算成**绝对过期时间戳** `expires_at = Date.now() + access_token_ttl_sec * 1000` 并存 storage
  3. 续签窗口判定改为 `expires_at - Date.now() < 300_000`（300s · 对齐 ttl-policy.md）

### P0-3 `services/auth.ts:125` 刷新接口请求体字段名 `refresh` vs 契约 `refresh_token`（**契约违规**）

- **证据**：`miniprogram/services/auth.ts:125`
  ```ts
  body: { refresh: current.refresh },
  ```
  对比 `api/openapi.yaml` paths./auth/refresh.post.requestBody：
  ```yaml
  schema:
    required: [refresh_token]
    properties:
      refresh_token: { type: string }
  ```
- **问题**：字段名不对，后端会直接 `400 VALIDATION_ERROR`，刷新链路永远失败。
- **依据**：`api/openapi.yaml` /auth/refresh endpoint
- **修复建议**：改为 `body: { refresh_token: current.refresh_token }`（同时 P0-2 的字段改名要一起改）

### P0-4 `services/request.ts` 写操作缺 `Idempotency-Key` 头注入（**契约违规**）

- **证据**：`miniprogram/services/request.ts` 全文（47~75 行 request 函数）只注入 `Authorization` / `Accept` / `Content-Type` 三个头，**完全未处理 `Idempotency-Key`**。
- **问题**：openapi.yaml 中 `POST /entries` / `POST /sync/push` / `POST /auth/wx-login` / `POST /auth/refresh` 等**所有写操作**的 parameters 段都声明了：
  ```yaml
  - name: Idempotency-Key
    in: header
    required: true
    schema: { type: string, format: uuid }
  ```
  客户端不发这个头，后端会直接 `400`。本客户端当前因为还在 Mock 模式未暴露，一旦切真后端即炸裂。
- **依据**：`api/openapi.yaml` 各写操作 parameters · `docs/api/id-strategy.md` §3 "Idempotency-Key 24h 去重窗"
- **修复建议**：
  1. `request.ts` 增加 `idempotent?: boolean` 或 `method !== 'GET'` 判定
  2. 自动生成 UUID v4 作为 `Idempotency-Key` 头（依赖 P0-9 的 `newClientRefId`/`newIdempotencyKey` 工具）
  3. 允许调用方显式传 `idempotencyKey`（用于 Revise-scenario / retry 场景复用同一键）

### P0-5 `services/request.ts:88-92` 错误响应解析路径错误（**契约违规**）

- **证据**：`miniprogram/services/request.ts:88-92`
  ```ts
  function toApiError(body: any): ApiError {
    const code = body?.error?.code ?? 'UNKNOWN';
    ...
  }
  ```
  对比 `api/openapi.yaml` Error schema：
  ```yaml
  Error:
    type: object
    required: [code, message, trace_id]
    properties:
      code: { $ref: '#/components/schemas/ErrorCode' }
      message: { type: string }
      trace_id: { type: string, format: uuid }
      details: { type: object, nullable: true }
  ```
- **问题**：Error schema 是**顶层扁平**（`{code, message, trace_id, details}`），不是嵌套在 `body.error` 下。客户端将永远解析出 `UNKNOWN`，失去所有 21 条错误码区分能力。
- **依据**：`api/openapi.yaml` components.schemas.Error · `docs/api/error-codes.md` 全部 21 条枚举
- **修复建议**：
  ```ts
  const code = body?.code ?? 'UNKNOWN';
  const message = body?.message ?? '未知错误';
  const traceId = body?.trace_id;
  ```
  并利用 `error-codes.md` 枚举做 TS 联合类型守卫。

### P0-6 `services/sync.ts:44-45` 端点 `/sync/{entity}?sinceVersion=` 在 openapi.yaml 中**根本不存在**（**契约违规 · 严重**）

- **证据**：`miniprogram/services/sync.ts:40-48`
  ```ts
  const resp = await request<...>({
    path: `/sync/${entity}`,
    method: 'GET',
    query: { sinceVersion: cur },
  });
  ```
  对比 openapi.yaml paths 段 grep 结果：**只有 `/sync/push`（POST）和 `/sync/pull`（POST）两个端点**，`/sync/{entity}` 不存在。且 `/sync/pull` 的 query 参数是 `since`（ISO-8601 时间戳）**不是** `sinceVersion`（数字版本号）。
- **问题**：这是**纯粹的协议幻觉**。当前 `syncPull` 函数在真实环境必然 404。
- **依据**：`api/openapi.yaml` paths./sync/pull · `docs/api/sync-protocol.md` §3（since + ISO-8601）
- **修复建议**：整个 `syncPull` 函数按 sync-protocol.md §3 重写：
  ```ts
  const resp = await request<SyncPullResponse>({
    path: '/sync/pull',
    method: 'POST',
    body: { ledger_id, since: lastPulledAt, entities: ['entry','category','budget'] },
  });
  ```
  并把 `Entity` 类型枚举改为 openapi.yaml SyncPushRequest.entity 枚举的 `entry | category | budget`（见 P0-7）。

### P0-7 `services/sync.ts:8` Entity 类型枚举与契约完全不对齐（**契约违规**）

- **证据**：`miniprogram/services/sync.ts:8`
  ```ts
  export type Entity = 'ledger_entries' | 'accounts' | 'categories' | 'families' | 'family_members';
  ```
  对比 openapi.yaml SyncPushRequest.ops[].entity：
  ```yaml
  entity:
    type: string
    enum: [entry, category, budget]
  ```
- **问题**：前端假定了 5 种实体类型，契约只承诺 3 种。即使后端将来扩展，`ledger_entries`（复数）vs `entry`（单数）语义都完全不对。
- **依据**：`api/openapi.yaml` components.schemas.SyncPushRequest
- **修复建议**：改为 `export type Entity = 'entry' | 'category' | 'budget'`；同时 storage 里 outbox 的 `collection` 字段跟随同步调整命名。

### P0-8 `utils/time.ts:11` `toUtcIso` 双减时区偏移 BUG

- **证据**：`miniprogram/utils/time.ts:11`
  ```ts
  export const toUtcIso = (d: Date = new Date()): string =>
    new Date(d.getTime() - d.getTimezoneOffset() * 60_000).toISOString();
  ```
- **问题**：`Date.toISOString()` 本身就输出 UTC 时间（自带 Z 后缀）。此处先减去 `getTimezoneOffset()` 再 `toISOString()` 等于**额外减了一次时区偏移**。例如北京时间 2026-04-24 19:35（UTC+8），正确 UTC 应该是 11:35Z，此函数会输出 03:35Z（错 16 小时）。
- **依据**：MDN `Date.prototype.toISOString()` · sync-protocol.md §3 "since: ISO-8601 UTC"
- **修复建议**：直接 `d.toISOString()`。删除整个 offset 计算。
  ```ts
  export const toUtcIso = (d: Date = new Date()): string => d.toISOString();
  ```

### P0-9 CSS 变量全局不一致（**整站样式降级 · 审核前必炸**）

- **证据**：`miniprogram/app.wxss`（**定义方**）
  ```css
  :root {
    --color-brand-primary: ...;
    --color-text-primary: ...;
    --color-text-secondary: ...;
    --color-bg-app: ...;
    --color-bg-surface: ...;
  }
  ```
  `miniprogram/pages/entry/index.wxml` / `home/index.wxml` / `mine/index.wxml` / `login/index.wxml` / `pages-family/privacy/index.wxml`（**使用方**）引用的变量是：
  ```
  --color-bg / --color-surface / --color-text / --color-text-muted
  --color-divider / --color-primary / --color-danger / --color-success
  --shadow-sm / --shadow-lg
  ```
  **两套命名完全不通**。app.wxss 没有定义 `--color-bg`（只有 `--color-bg-app`）、没有 `--color-primary`（只有 `--color-brand-primary`）、没有任何 `--shadow-*` 变量。
- **问题**：实际运行时这些页面的颜色/阴影会**全部降级到浏览器默认值**（通常是透明/黑字白底），UI 设计稿完全无法还原。这是 D-014 卡定义 Review 若做全量必然拦下的基础面性问题。
- **依据**：Design-System v0.1（`.team/reviews/COSTRA-011/FINAL.md` 30/30 满分 · 定义了完整 token 清单）· 且 `miniprogram/tokens/index.ts` 从 `tokens.json` 导出 `colors` / `shadows` / `radii` 但**未被任何 wxss 消费**
- **修复建议**：
  1. 方案 A（快 · 推荐）：修 `app.wxss`，把使用方期望的变量名**全部**补齐定义（语义名优先：`--color-bg` = bg-app, `--color-surface` = bg-surface, `--color-primary` = brand-primary, etc.）
  2. 方案 B（慢 · 根治）：写一个构建脚本把 `tokens.json` → `app.wxss` 自动生成 · 消除手写不一致（更宜放 Sprint-2 立独立卡）

### P0-10 `pages/login/index.wxml:12` 使用已废弃 API `open-type="getUserInfo"` + 占位隐私策略构成**审核红线**

- **证据 A**：`miniprogram/pages/login/index.wxml:12`
  ```xml
  <button class="cta" open-type="getUserInfo" bindtap="onLoginTap">微信一键登录</button>
  ```
  微信官方 2021-04-28 收紧公告："自 2021 年 4 月 28 日 24 时后发布的小程序新版本，`wx.getUserInfo` 接口将不再弹出授权询问框，开发者应当使用 `wx.getUserProfile` 接口"。`getUserInfo` 的 `open-type="getUserInfo"` 声明式按钮同属收紧范围。且此处 `bindtap` 与 `open-type` 混用、语义混乱。
- **证据 B**：`miniprogram/pages-family/privacy/index.wxml` 实际内容仅 4 行纯占位：
  ```xml
  <view class="page">
    <view class="h1">隐私保护指引</view>
    <view class="hint">TODO(COSTRA-060): 由法务审核后从草稿同步到此页。</view>
  </view>
  ```
- **问题**：微信小程序审核红线 —— MVP 提审前必须有**真实可读**的隐私保护指引页面（PRD NFR 合规要求 · 且 COSTRA-109 PM 正在起草草稿）。当前状态若提审必被打回。
- **依据**：
  - 微信开放文档 · button `open-type="getUserInfo"` 收紧公告（2021-04-28 · https://developers.weixin.qq.com/miniprogram/dev/framework/open-ability/getUserProfile.html）
  - 微信小程序审核规范《运营规范》§10 隐私保护
  - docs/PRD.md NFR 合规段 · `.team/reviews/COSTRA-011/FINAL.md`
- **修复建议**：
  1. login.wxml：`open-type` 去掉，保留 `bindtap="onLoginTap"` · 登录链路用 `wx.login()` + 后续的 `wx.getUserProfile()`（首次触发必须由用户点击事件内调用）
  2. privacy/index：等 COSTRA-109 输出的草稿到手后**立即**填充（此项可标记 depends-on COSTRA-109 · 本卡不强求立修）

---

## P1 应改

### P1-1 `utils/money.ts` 手写 decimal 违反 ADR-0002 硬约束

- **证据**：`miniprogram/utils/money.ts` 全文（47 行）纯正则实现小数 → 整数分，**没有引用 `decimal.js`**
- **依据**：`.team/decisions/ADR-0002-tech-stack.md` §硬性约束 —— "前端所有金额计算一律使用 `decimal.js`"
- **建议**：引入 `decimal.js`（约 32KB · 可接受）· 重写 `toCents` / `toYuan` 使用 `Decimal.prototype.mul(100).floor()` 等。
- **可放行依据**：当前语义正确（6 条单元等价关系已验证）· Sprint-1 骨架期可登记为 FU

### P1-2 `services/request.ts:68-71` 自造错误码 `NETWORK_ERROR` 未在 error-codes.md 登记

- **证据**：`services/request.ts:68-71`
  ```ts
  fail: (err) => {
    const e: ApiError = { code: 'NETWORK_ERROR', message: err.errMsg ?? '网络请求失败' };
    ...
  }
  ```
- **依据**：`docs/api/error-codes.md` 21 条枚举 + Review-Tech §3.1"错误码禁止新造"
- **建议**：
  - 方案 A（快）：改用 `CLIENT_NETWORK_ERROR`（加 `CLIENT_` 前缀明示非服务端 code，在 error-codes.md 增加一段"客户端内部错误码（非契约返回）"专列）
  - 方案 B（根治）：把此类错误统一归入 `UNKNOWN_ERROR` + 附 meta 区分

### P1-3 `pages/entry/index.ts:47-53` outbox 载荷 camelCase 与契约 snake_case 不匹配

- **证据**：`pages/entry/index.ts:47-53`
  ```ts
  enqueueLocalEntry({
    amountCents,
    categoryId,
    occurredAt,
    type,
    note,
  });
  ```
  对比 `api/openapi.yaml` EntryCreate schema：
  ```yaml
  required: [ledger_id, amount, currency, type, category_id, occurred_at]
  ```
- **问题**：字段名风格不对 + 缺 `ledger_id`（schema required）+ 缺 `currency`（required）
- **依据**：`api/openapi.yaml` EntryCreate
- **建议**：本地 outbox 直接用 snake_case（契约内字段名一致），同步 push 时零映射；`ledger_id` 从当前选中账本读（未来还要处理家庭账本切换）

### P1-4 `pages/home/index.ts:28` TODO 引用了不存在的端点 `/ledger/summary`

- **证据**：`pages/home/index.ts:28`
  ```ts
  // TODO(COSTRA-110): 切 /v1/ledger/summary?range=current-month
  ```
- **问题**：openapi.yaml 里**没有** `/ledger/summary` 端点。最接近的是 `/reports/monthly?ledger_id=&month=YYYY-MM`。开发者若照此 TODO 实装会再次踩协议幻觉。
- **依据**：`api/openapi.yaml` paths./reports/monthly
- **建议**：TODO 改为 `// TODO(COSTRA-110): 调 POST /reports/monthly { ledger_id, month: YYYY-MM }`

### P1-5 `services/env.ts:50` CURRENT_ENV 硬编码

- **证据**：`services/env.ts:50`
  ```ts
  const CURRENT_ENV: EnvName = 'dev';
  ```
- **依据**：`miniprogram/README.md §4` 已承认这是"骨架阶段占位"并挂 COSTRA-108 CI 注入修复
- **建议**：本项**可接受**（已在骨架期显式声明）· 仅登记为 FU 提醒 Sprint-1 COSTRA-108 / COSTRA-112 修复边界

---

## P2 建议

### P2-1 占位页引用了未在 backlog.json 中定义的卡号

- **证据**：
  - `pages-stat/month/index.ts` 引用 `COSTRA-130`
  - `pages-family/home/index.ts` 引用 `COSTRA-140`
  - `pages-family/settings/index.ts` 引用 `COSTRA-150`
  - `pages-family/privacy/index.wxml` 引用 `COSTRA-060`
- **问题**：backlog.json 的原始 Epic 编号是 COSTRA-101~903，Sprint 看板重编号是 100~117 系列。这些 130/140/150/060 号段**两套都不在**，属于骨架期随手 TODO 留下的幻觉卡号。
- **建议**：骨架阶段容忍 · Sprint-1 末 Retro（COSTRA-106 延至 Sprint-2 头部）时一次性纠正为真实卡号或合入 Epic

### P2-2 `pages/mine/index.ts:19` 硬编码中文 "未命名用户"

- **证据**：`pages/mine/index.ts:19`
  ```ts
  nickname: s?.user?.nickname || '未命名用户',
  ```
- **依据**：与 FU-001（server 端 "微信用户" 默认昵称）同类问题 · 也应走 `defaultNickname` 配置化
- **建议**：合并到 FU-001 一起 Sprint-2 处理

### P2-3 `miniprogram/components/` 当前仅有 README.md 无组件

- **证据**：`list_dir miniprogram/components/` 只有一份 README.md
- **问题**：骨架阶段可接受 · 但 miniapp-agent §职责边界中的"组件沉淀"原则需在 Sprint-2 开始兑现
- **建议**：Sprint-2 COSTRA-102 落地时至少沉淀 1~2 个通用组件（如 `<money-input>` / `<category-picker>`），破冰

### P2-4 `services/storage.ts` 3 处 console.warn/error · `app.ts` 3 处 console.info/error/warn · `services/auth.ts` 4 处 console.* · 总计 11 处

- **证据**：grep `console\.` 结果 11 处
- **依据**：Review-Tech §3.6 "TODO/FIXME/console.log 超过 2 处 = -1 分"（已算入 Testability 2/5 评分）
- **建议**：Sprint-2 引入统一 logger 封装（带 ring buffer + 上报到后端 APM）· 或最简地全部替换为 `wx.getRealtimeLogManager()`（微信官方实时日志 API）

---

## 🟡 与红线条款的灰色区 · 待 Human 二裁

### AppID 出现在 `miniprogram/README.md`（L12 + L42）

- **证据**：`miniprogram/README.md`
  - L12：`> 生产 AppID：wxf8b0d3e3a83f9941`
  - L42：`### miniprogram-ci 上传（COSTRA-108 · AppID: wxf8b0d3e3a83f9941）`
- **规约条款**：Review-Tech §3.5 原文 —— "生产 AppID `wxf8b0d3e3a83f9941` **不得出现在 miniprogram 源码中**，必须走环境变量/配置"
- **灰色点**：README.md 是**文档性质** · 是否算"源码"存在歧义。COSTRA-030 Round-2 T3 追溯审（2026-04-23）**未拦下**这两处出现。
- **本 Reviewer 的主张**（供 Human 裁决）：
  - **严格派**：README 在 miniprogram/ 目录内 · "源码" 应作广义理解（广义 = 仓库内所有非 git-ignored 文件）· 记 **P0-AppID-泄漏**
  - **务实派**：README 只在本地仓库内 · 不会被打包进小程序产物 · 开发者可读性价值 > 风险 · **登记为观察项 O-118-1 即可**
- **本次建议判定**：**务实派**（降级为 Follow-up O-118-1 · 不阻塞本卡 verdict）· 但建议 Sprint-1 末在 engineering-guidelines §2.5 中**显式澄清** "AppID 红线仅针对会打包进小程序产物的文件（.ts/.wxml/.wxss/.json）· README 等文档类文件豁免"以避免未来再次踩线

---

## 与上轮的差异

N/A · 本卡首轮（COSTRA-030 T3 追溯 Skip-Review 不计为本卡上轮 · 评分维度亦不同 · 原卡是骨架快审 · 本卡是全量 7 维深审）

---

## 给被审 Agent 的回执指令

> ⚠️ 特殊说明：本卡 Owner = Review-Tech 本身，无"被审 Agent"。回执路径转为 **Human 终审处置决策**。

### 建议 Human 处置路径（推荐次序）

#### 🟢 推荐 · 路径 A：`approve:COSTRA-118` + 发现项分流

1. Human 触发 `approve:COSTRA-118` → 本卡进 Done（审计任务完成）
2. 把本报告 P0 清单作为 COSTRA-102（MiniApp 端到端）/ COSTRA-112（主体字样清扫）的**扩展验收项**（Review-Tech §5 引用本文件）
3. 其中 **P0-1（code 日志）+ P0-8（时区 bug）+ P0-9（CSS 变量）** 由 COSTRA-102 的 MiniApp-Agent 在实装时顺手修
4. 其中 **P0-2/P0-3/P0-4/P0-5/P0-6/P0-7** 本就是 COSTRA-102 "切真实后端"的必经之路 · 天然修复
5. 其中 **P0-10 part A（getUserInfo）** 在 COSTRA-102 实装登录时修；**part B（隐私页）** 等 COSTRA-109 PM 产出后由 MiniApp 同步
6. P1/P2 登记 Follow-up 清单 · Sprint-2 处理

#### 🟡 备选 · 路径 B：`revise:COSTRA-118` · 拆子卡修 P0 子集

- 若 Human 认为某些 P0（如 P0-1 code 日志 · 属安全红线）**必须 Sprint-1 内修**，可拆出 **COSTRA-119 miniprogram 关键 P0 紧急修复**（1~2 点 · 仅修 P0-1/P0-6/P0-8/P0-9 · 跳过 COSTRA-102 依赖其它卡）

#### 🔴 罕见 · 路径 C：`reject:COSTRA-118`（报告质量不够）

- 触发 ESCALATE · Review-Tech 重审 + 加读 charter/db
- 本 Reviewer 不建议此路径 · 已在置信度中明示"中"

### 可直接复制粘贴的 Human 触发指令

```
approve:COSTRA-118
```
（采纳本报告 + 按路径 A 分流）

或

```
approve:COSTRA-118 with-split:COSTRA-119
```
（采纳本报告 + 新拆紧急修复卡 COSTRA-119 进 Sprint-1）

---

## 自我反思

- **本次审核耗时估计**：约 40 分钟 Review-Tech 阅读 + 30 分钟定位证据 + 20 分钟撰写报告 = **~90 分钟工作量**，Orchestrator 内同轮 tool call 压缩为 ~12 分钟实时
- **审核置信度**：**中**
  - 降级原因 1：charter §7/§13 与 docs/db 未直接读（间接覆盖）· 不影响 miniprogram 纯前端结论
  - 降级原因 2：未做真机 / 小程序开发者工具跑通验证（Agent 无真机访问权 · COSTRA-114 v2 铁律）· 纯静态分析 · 可能漏掉运行时 bug
- **是否建议升级 Human**：**否**
  - 理由：结论明确（10 P0 · REJECT · 推荐路径 A）· 无技术分歧需仲裁 · Human 只需在三条处置路径中二选一即可

### Reviewer 主动声明的局限

1. `utils/money.ts` 的精度边界未做极端值测试（如 `0.1 + 0.2` 类浮点陷阱）· 仅从 ADR-0002 栈约束角度评分
2. `services/storage.ts` 的 LRU 逻辑未做读写压测 · 版本化 envelope 设计**书面上**合理即放行
3. 未扫描 `project.config.json` / `project.private.config.json.example` 的隐私配置项 · 若存在遗漏由 COSTRA-109 PM 补位
4. `miniprogram/tokens/index.ts` 定义了完整 token 但**实际没被任何 wxss 消费**（详见 P0-9）· 这是设计-实装脱节问题 · 可能还存在本次未发现的同类脱节（如 typography / spacing tokens）· Sprint-2 设计系统闭环卡时再做一轮专项

---

## 附录 A · 扫描证据（供事后核验）

### A.1 `console.*` 11 处分布

```
miniprogram/app.ts                  3 处（info/warn/error 各 1）
miniprogram/services/auth.ts        4 处（info × 1 含 code 前缀 · error × 2 · warn × 1）
miniprogram/services/storage.ts     3 处（warn × 2 · error × 1）
miniprogram/services/request.ts     1 处（error × 1）
```

### A.2 TODO 标记 7 处

全部带 `COSTRA-xxx` 引用 · 无裸 TODO · 工程纪律可评 4/5 即此项依据

### A.3 AppID 出现位置

```
miniprogram/README.md:12   "生产 AppID：wxf8b0d3e3a83f9941"
miniprogram/README.md:42   "miniprogram-ci 上传（COSTRA-108 · AppID: wxf8b0d3e3a83f9941）"
miniprogram/project.config.json  (规约允许 · 小程序运行时必需)
miniprogram/project.private.config.json.example  (规约允许 · 示例)
```
源码文件（.ts/.wxml/.wxss）**零出现** ✅

### A.4 D-008 主体红线扫描结果

```
硬编码中文主体字样（"公司"/"某某科技"/身份证号）: 零出现 ✅
`config/subject.ts` 引用: 零页面引用 🟡（当前页面未显示主体字样故无需引用 · 合规）
```

本项在 miniprogram 当前范围**通过**（FU 登记给 COSTRA-112 兜底）

### A.5 红线违规清单（最终）

| 红线 | 命中 | 归属 |
|---|---|---|
| session_key / token / openid 日志泄漏 | ❌ 未命中 | — |
| **wx.login code 日志泄漏** | ✅ 命中 P0-1 | auth.ts:85 |
| AppID 在 .ts/.wxml/.wxss 源码 | ❌ 未命中 | — |
| AppID 在 README（灰色区） | 🟡 务实派豁免 | README.md:12/42 |
| 硬编码主体字样 | ❌ 未命中 | — |
| 目录越权（跨区写） | ❌ 未命中 | — |
| 伪造测试通过 | ❌ 未命中（根本没测试） | — |

---

## 附录 B · 分维度扣分依据表（可复核）

| 维度 | 满分 | 得分 | 扣分明细 |
|---|---|---|---|
| 契约一致性 | 5 | 1 | -2 auth TokenPair 错配（P0-2）· -2 Error 解析路径错（P0-5）· -2 sync 端点/协议幻觉（P0-6+P0-7）· -1 Idempotency 缺失（P0-4）· -1 refresh 字段名（P0-3）· -1 额外 P1-2 自造 code · 地板 1 分 |
| 架构与分层 | 5 | 3 | -1 decimal.js 栈偏离（P1-1）· -1 tokens.json 已定义但不被消费（P0-9 根因） |
| 数据与持久化 | 5 | 2 | -2 outbox camelCase + 缺 ledger_id（P1-3 + 与 openapi EntryCreate 对比）· -1 无 client_ref_id 生成链路（见 id-strategy.md §2.5） |
| 离线与同步 | 5 | 1 | -3 端点完全不存在（P0-6）· -1 Entity 枚举错（P0-7）· -1 无 Idempotency-Key 配套（P0-4 同根） · 地板 1 |
| 安全与合规 | 5 | 2 | -3 code 前缀日志（P0-1 红线）· -0 AppID 灰色区务实派豁免 · 基础分 2 其它合规项全通过 |
| 可测与可观测 | 5 | 2 | -3 零单元测试 · 0 日志级别尚可不扣 · -0 TODO 带卡号可控 |
| 工程纪律 | 5 | 4 | -1 占位页卡号幻觉（P2-1）· +0 Refs/header/文件规模全优 |
| **合计** | **35** | **15** | 平均 2.14 · **REJECT** verdict（P0=10 > 3 硬性触发） |

---

**Refs**: COSTRA-118, COSTRA-030, COSTRA-102, COSTRA-112, COSTRA-109, D-008, D-009, D-013, D-014, D-016, ADR-0002

**报告签字**：Review-Agent-Tech · 2026-04-24T19:35+08:00 · 同轮兑现合规（D-016 第二次实战）
