# ADR-0004：小程序运行时细节与 MVP 关键参数锁定

- 状态：Proposed（待 G1 附带签字）
- 日期：2026-04-21
- 决策人：PM-Agent（提出）+ Backend-Agent / MiniApp-Agent / DevOps-Agent / QA-Agent（会签）+ Human（批准）
- 关联：`ADR-0002`（v2 技术栈）、`ADR-0003`（平台切换）、`docs/PRD.md` v0.1

## 背景

`ADR-0002`/`ADR-0003` 已锁定主线技术栈（MINA + TS + Go + MySQL + 微信生态），但仍有若干 **MVP 范围内的关键运行时参数 / 流程约定** 未明确，为避免各 Agent 在 Sprint-1 各自作主产生漂移，此处统一固化。

## 决策

### D1. 小程序分包策略
- 主包：`pages/index`（首页）、`pages/auth/*`、`pages/add-transaction`（记一笔），目标 ≤ 2MB。
- 分包：
  - `packageStat`：月度/年度图表、`packageReport` 报告分享。
  - `packageFamily`：家庭管理、邀请、成员权限、审计。
  - `packageReport`：年度报告画布生成 / 海报。
- 启用 `subPackages.independent = false`（需登录态共享）。
- 启用**分包预下载**：进入首页后静默预下载 `packageStat`。

### D2. 业务 Token 参数
- access token：JWT，HS256，有效期 **2h**；签发 claim = `{ uid, fid(可为空), rol, iat, exp }`。
- refresh token：不透明 ID（UUIDv4）+ Redis 记录，有效期 **30d**，每次刷新滚动。
- Token 存储：小程序侧 `wx.storage` key=`__costra_token_v1`；服务端禁止写日志。
- 失效路径：refresh 过期 → 强制 `wx.login` 重新走登录流程。

### D3. 同步与幂等
- 客户端操作幂等键：`client_op_id = uuidv4()`，服务端**按幂等键去重 24h**。
- 同步游标：`{updated_at_ts}_{id}`，单次请求 `limit=500`。
- 冲突策略：服务器权威 + 必要时客户端弹窗（详见 PRD COSTRA-123）。

### D4. 审计与日志
- `audit_logs` 保留 **180 天**；敏感字段仅存哈希。
- 服务端应用日志采样：200 全采样、4xx 全采样、2xx GET 采样 10%。
- 小程序端 `wx.onError / onUnhandledRejection` 统一上报至 `POST /v1/obs/js-error`（无鉴权，IP 限流）。

### D5. 域名与 CDN
- 请求域名：`api.costra.app`（request、upload、download）。
- WebSocket：`wss://rt.costra.app`。
- 静态/分享图：`cdn.costra.app`（COS 绑定自定义域名 + CDN）。
- 以上 3 域名均需在小程序后台**服务器域名**表白名单，DevOps 负责登记 `infra/wechat/domains.md`。

### D6. 订阅消息模板 ID 管理
- 模板 ID 写入 `infra/wechat/subscribe-templates.md`，服务端从环境变量加载；**禁止硬编码**。
- 用户授权记录存 `subscribe_authorizations`（`openid / template_id / scene / expire_at`）。

### D7. Feature Flag
- MVP 采用**配置中心 minimal**：服务端下发 `GET /v1/config/flags`（2 小时缓存），小程序读取后决定分支。
- 初版 Flag：`feature_family / feature_budget / feature_annual_report`（默认 on，便于灰度时按需关闭）。

### D8. 金额与货币
- 全链路 `DECIMAL(18,4)` ↔ `decimal.js`，禁止 `Number`（由 ESLint 自定义规则 + 后端 `go vet` 钩子强制）。
- MVP 仅支持 `CNY`；币种字段预留，解析层已具备扩展点。

### D9. 灰度与回滚操作
- 小程序发布：1% → 10% → 50% → 100%，每档 Human 点击 G5 通过按钮 + DevOps 在 `ops-log.md` 记录。
- 回滚：任意档出现 P0 → 后台"回退版本"+ 5 分钟内产出 `incidents/YYYY-MM-DD-*.md`。

### D10. 时区与国际化
- 服务端统一 UTC 存储；客户端展示 UTC+8；不做多语言（MVP）。

## 影响与会签范围

| 条款 | 需会签 Agent | 主要影响 |
|---|---|---|
| D1 | MiniApp / DevOps | 工程骨架 + CI 体积门禁 |
| D2 | Backend / MiniApp | 登录/存储封装 |
| D3 | Backend / MiniApp | 同步引擎 |
| D4 | Backend / DevOps / QA | 日志与合规 |
| D5 | DevOps | 域名白名单 |
| D6 | Backend / DevOps / PM | 订阅消息配置 |
| D7 | Backend / MiniApp | 配置拉取与缓存 |
| D8 | Backend / MiniApp / QA | 金额测试 |
| D9 | DevOps / QA | 发布流水线 |
| D10 | Backend / MiniApp | 时区处理 |

## 会签记录（Pending，G1 通过时同步签字）

- [ ] Backend-Agent：
- [ ] MiniApp-Agent：
- [ ] DevOps-Agent：
- [ ] QA-Agent：
- [ ] Design-Agent：（只涉 D1/D6，作知情）
- [ ] Human 批准：

## 备注

本 ADR 不推翻 ADR-0002/0003 任何一条决策；仅为 Sprint-1 起开发提供统一参数。
若任一条款在 Sprint 执行中证明不可行，需按 `COMMON-CONTRACT.md` §4 走变更流程（新增 ADR-0005+）。
