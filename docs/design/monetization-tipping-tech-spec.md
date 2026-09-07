# 商业化：用户赞赏（虚拟支付 · **个人主体**）· 技术方案 v1.3（单阶段交付定稿 · 含 iOS · 已实现）

- 卡号占位：**COSTRA-6xx**（与产品方案同批，正式入池待分配）
- 作者：Tech（起草）
- 日期：2026-09-04
- 上游依据（采信规则见 §0.0，**不可随意跨版本迁移结论**）：
  - 产品方案 `docs/design/monetization-tipping-product-spec.md` v1.2
  - 微信官方文档《**虚拟支付：个人**》（platform-capabilities → business-capabilities → virtual-payment → **person**）—— **本方案的主体依据**
  - 微信官方文档《虚拟支付：企业、个体户》—— **仅在 §0.0 允许的"平台机制"范畴内引用**
  - 微信官方文档《服务端 API · 虚拟支付 · 查询创建的订单》`api_query_order`
  - `wx.requestVirtualPayment` API 文档
- 现有基础设施事实源（本方案落地要动的既有代码）：
  - `server/src/plugins/jwt.ts`、`server/src/routes/*.ts`（12 处重复鉴权 helper，见 §4.0）、`server/src/routes/auth.ts`
  - `server/src/wx/code2Session.ts`、`server/src/repositories/userRepo.ts`
  - `server/src/errors/ErrorCode.ts`、`server/src/plugins/errorHandler.ts`、`server/src/app.ts`
  - `server/src/config/env.ts`、`server/src/config/ttl.ts`、`server/src/db/pool.ts`、`server/src/db/redis.ts`
  - `server/src/services/recurringScheduler.ts`（仅复用 timer / advisory lock 生命周期范式）、`server/db/migrations/*`、`server/test/setup.ts`
  - `miniprogram/services/request.ts`、`miniprogram/services/auth.ts`、`miniprogram/services/budgetApi.ts`、`miniprogram/pages/mine/*`
  - `infra/nginx/conf.d/costra.cloud.conf.prod`（`location /v1/` → `server:8080`，443 + 有效证书）
- 状态：**v1.3 · 已全栈实现**（2026-09-04 落地，2026-09-07 实现期 review 回写三项缺陷修复，见 §14 v1.3）。剩余非代码项：B1 小程序简称、B2 道具发布（有启动期闸门）、B5 推送 URL、B13 真单联调（R1/R2）。原估算：**约 16～19 人天（单阶段，含 iOS；v1.2 上修，理由见 §11）**。
- **开工顺序（v1.2 简化）**：**没有 Day 0 闸门**。v1.1 曾把 B5（后台确认推送格式）设为 webhook 编码的硬前置，v1.2 核实官方原文后取消——推送格式是文档已明确的事实（XML），不是待收敛的未知量（§4.2.1）。B0 亦不再是 tips 的时序前置（§4.0）。

> 本文只描述「如何实现」。产品边界（不代币化 / 固定档位 / 徽章不进协作视图等）作为强约束继承。

---

## 0.0 主体路径声明与官方文档采信规则（**开工前必读，v1.0 新增**）

### 0.0.1 我们走的是「虚拟支付：**个人**」，不是「企业、个体户」

Costra 是**个人主体**小程序，接入的是微信面向个人开发者开放的虚拟支付路径。这两条路径**不是同一套准入、也不是同一套能力集合**，实现与排障时**严禁混为一谈**：

| 维度 | **虚拟支付：个人（我们走这条）** | 虚拟支付：企业、个体户（**不适用于我们**） |
|---|---|---|
| 主体资格 | 个人主体 + 开发者持中国大陆居民身份证 | 企业 / 事业单位 / 个体工商户 |
| 服务类目 | **必须含「工具」**（已满足） | 无此项要求 |
| 认证备案 | 已认证 + 已备案（已满足） | 已认证 |
| 审核时长 | 一般 5 分钟内 | 1~7 个工作日 |
| 商品模型 | **只做道具直购，明文禁止引入代币等额外功能** | 道具 / **代币**二选一或并用 |
| 支付限额 | **全终端合计 10 万元/月** | 无个人限额条款 |
| 可用服务端接口 | 下单签名、`query_order`、发货推送 | 另有代币族、道具批量上传/发布、退款、账单下载、提现、广告金、投诉处理等 |
| 后台入口 | 微信开放平台【支付与交易 → 虚拟支付】 | MP 左侧栏【虚拟支付】商户管理模块 |

**由此产生的三条硬约束**（在本方案中已落地，勿在后续维护中被企业版文档"带偏"）：

1. **不得引入任何代币/余额结构**——个人版页面明文「只做道具直购，不引入代币等额外功能」。企业版的 `xpay/currency_pay`、`present_currency`、代币配置、`xpay_coin_pay_notify` 全部**与我们无关**，看到也不要接。
2. **不得假设企业版的商户管理能力可用**——批量上传道具、账单下载、提现 API、广告金、投诉处理接口族均属企业版商户后台；我们的运营动作（建道具、查订单、提现）走个人版后台页面完成，不走 API。
3. **月限额 10 万元是个人主体特有条款**，属必须向用户告知项（产品 §7.3）。

### 0.0.2 什么时候可以引用企业版文档（v1.0 修正的方法论）

v0.8 曾立下「**文档的沉默不是许可**——企业版有、个人版没写的应默认未验证」。这条原则在 v0.8～v0.9 被**用过头**了：它导致三件事被当成"未验证假设"推迟到第二阶段，而其中两件半在官方文档里本就有明确答案（详见 §0.2）。

**v1.0 的判据改为按内容分类，而不是按文档来源一刀切**：

| 内容类型 | 采信规则 | 例子 |
|---|---|---|
| **主体资质、权限、商业条款** | **只认个人版页面**，企业版结论一律不可迁移 | 谁能开通、能否用代币、费率、结算周期、月限额、可用接口清单 |
| **平台机制**（两版共用同一套底层系统） | **企业版可采信**，因为它是同一套系统的更完整描述 | 设备路由、签名算法与自校验向量、推送消息结构与字段表、`order.status` 枚举、道具双端互通、iOS 端下单条件 |

**理由**：个人版页面的开篇即是「复制下方提示词，发给开发小程序的 Agent」——它是**接入引导教程，不是接口规范**。教程省略字段级细节属于编辑取舍，不构成"该能力不存在"的证据。事实上本方案早已从企业版取用了签名算法与官方自校验向量、从 `api_query_order` 独立页取用了 `order.status` 全枚举；对这些采信、却对设备路由与道具互通不采信，是不自洽的。

**但反过来同样成立**：凡属上表左列第一行（资质/权限/条款）的内容，即便企业版写得再清楚，也不得推定我们拥有。

### 0.0.3 本方案引用企业版文档的**全部**位置（便于审计）

| 引用内容 | 用途 | 分类归属 |
|---|---|---|
| 设备路由表（Android/鸿蒙/Windows → 微信支付；iOS → Apple 支付） | §2.4 平台闸门的**唯一依据** | 平台机制 |
| 道具 Android/iOS 双端互通 | §2.4 / §5.4 删除 channel 维度的依据 | 平台机制 |
| iOS 端用户下单条件（iOS ≥ 15、微信 ≥ 8.0.68、最低 1 元、仅大陆 App Store、无沙箱） | §2.4 客户端闸门 | 平台机制 |
| 签名算法与官方自校验向量 | §2.2 黄金测试 | 平台机制 |
| 推送消息结构与字段表（`xpay_goods_deliver_notify` / `xpay_refund_notify`） | §4.2 codec | 平台机制 |
| 推送响应格式三选一（空/`success` 亦视为成功） | §4.2.2 回包极简化 | 平台机制 |
| `notify_provide_goods` 的「推送回包成功即无需调用」 | §5.3 永久不做的依据 | 平台机制 |
| `xpay_subscribe_ios_refund_query_notify`（iOS 退款问询） | §5.5 已知不应答 | 平台机制 |

---

## 0. 一页结论（Executive Summary）

| 决策项 | 结论 |
|---|---|
| **主体路径** | **虚拟支付：个人**（个人主体 + 工具类目 + 已认证已备案）。**只做道具直购、不引入代币**；企业/个体户版的代币族与商户管理接口一律不适用（§0.0） |
| **交付形态** | **单阶段交付，一次上线即含 iOS**（§0.2）。v0.8/v0.9 的两段式切片**已取消**——其三个前提中两个半被官方文档直接证否 |
| **iOS 支持方式** | 开通 Apple IAP。**设备路由由平台强制决定**（iOS → Apple 支付，Android/鸿蒙/Windows → 微信支付），开发者无法选择；**不开 IAP 则 iOS 用户完全无法支付且无任何替代路径**（§2.4） |
| **道具配置** | **Android / iOS 双端互通**，同一道具 ID 与价格直接在 iOS 生效。**无需分端建道具、无需 App Store Connect**（我方也没有该账号） |
| **`channel` 维度** | **整体删除**。`signData` 无 channel、道具双端互通、平台按设备自动路由 ⇒ 服务端下单不需要知道设备。**v1.1：连 `tip_orders.channel` 列也不存**，改落 `upstream_order_type` 原值，渠道归因在查询层映射（§2.4.2） |
| **支付身份闸门（唯一）** | 下单时 `code2Session(code).openid` 必须 === 当前 JWT 用户的 `users.wx_openid`。**这一条同时覆盖了 GM impersonation、账号错绑与代付**，不需要额外的 token claim（§4.1.1） |
| 鉴权改造 | 既有 12 处路由 helper 都用 `request.jwtVerify()` 而**不校验 `token_type`** ⇒ refresh token 可调用全部用户 API。修法是在共享 helper 里加三行 `token_type` 检查（**不**改 `signAccessToken` 签名、**不**新增 claim）。**v1.2：helper 随 tips PR 落地，其余 11 处替换走独立 PR，两条线真正并行**——B0 对 tips 的安全增益≈0（§4.0） |
| 两套 HMAC | `paySig` = HMAC-SHA256(**AppKey**, `uri + "&" + postBody`)；`signature` = HMAC-SHA256(**sessionKey**, `postBody`)。C 端 `uri='requestVirtualPayment'`；`query_order` 用 `/xpay/query_order` |
| signData 字段集合 | 严格为官方 8 字段；`attach` 固定为非敏感协议标识 |
| 支付真相源 | 发货推送（主）+ `query_order`（兜底）；**前端 success 永不作为发货依据**；所有权益变更共用 `settleOrder` |
| webhook 协议 | **明文 XML，单一实现**。官方个人版原文：发货推送配置**只填一个 URL**，正文明写「支付成功后平台以 **XML** 推送到该 URL」，**不存在数据格式选项**（v1.2 核实，§4.2.1）。回包采用个人版原文的 XML 常量 |
| **webhook 必做项** | ① **Fastify `addContentTypeParser`** 接管 `text/xml`、`application/xml`、`text/plain` 取原始 buffer，否则 body 为空（§4.2.0）；② 同路径 `GET` 接入验证 handler（约 10 行的廉价保险，**须限 Content-Type / 长度 / 字符集**，§4.2.0） |
| **平台发货确认** | **永久不做**。官方原文：「正常通过 `xpay_goods_deliver_notify` 消息推送返回成功**就不需要调用**这个 API」。v0.8 说的"未验证"已被证否——是**官方明说不需要**（§5.3） |
| 纵深核实的**硬阻断**范围 | 只有 `order_id`、`order_fee`、`wx_order_id` 漂移/跨单占用三项。`env_type` / `biz_meta` / `order_type` / `Quantity` / `ProductId` **一律只告警不阻断**（§4.3.1）。⚠️ `order_fee` 在 Apple 渠道存在**待证实风险 R1**，见 §4.3.2 |
| 权益存储 | **不建权益表、也不建偏好表**。徽章 / 次数 / 支持度全部由 `tip_orders` 派生；唯一无法派生的 `badge_hidden` 落 `users` 表一列 |
| 幂等锚 | `out_trade_no` + 行锁状态机（与官方建议的 `wx_order_id` 有意偏离，理由与提审自查口径见 §5.7） |
| 订单状态机 | `created` → `delivered` / `expired` / `refunded`。**无 `paying`、无 pay-claim、无 `unresolved`**（探测窗口收敛到 30 分钟后，`unresolved` 已无存在意义，§3.3） |
| 锁 | `settleOrder` **只锁 `tip_orders` 单行**；claim 用普通 `FOR UPDATE`（**不用 `SKIP LOCKED`**：单实例 + advisory lock 已互斥，且 pg-mem 不支持） |
| 探测窗口（**v1.2 改**） | **T3 是优先于 outcome 的前置判定**：`now() >= created_at + tipProbeWindowSec`（1800s）时，**除"确认已支付"外的一切结果都收敛为 `expired` 并停止上行**。scheduler 节奏仍为 2/5/10/30 分钟四次，由 `probe_count` 推出；**webhook / summary 的加速探测不消耗该节奏游标**（§6.1） |
| **加速探测（v1.2 修正）** | webhook 与 `GET /tips/summary` 的 probe **同权**：均可越过远期 `next_probe_at`，只受 `tipProbeMinIntervalSec`（**3s**）约束；summary **每次最多 probe 一单**（最近一张 `created` 单）。v1.1 的 10s 在 8 秒轮询窗口内恒等于"只有第一次生效"，见 §4.6.1 的算术 |
| 退款 | **本期不实现任何退款逻辑**（产品定位为自愿赞赏）。收到 `xpay_refund_notify` 只 warn + 成功回包，人工在后台处理；仅保留零成本的 `status ∈ {5,8} → refunded` 映射防止落入 `unknown` 永久重试（§5.5） |
| 重复购买 | **允许**（对齐产品决策 1）。无 purchase scope、无复签、无跨档位拒绝 |
| 客户端登录时序 | 支付前 `await app.bootstrapPromise` 即可，**不建全局 `wx.login` 串行器** |
| 平台闸门 | 只有**客户端**闸门：开发者工具禁付、iOS 版本不达标禁付（iOS ≥ 15 且微信 ≥ 8.0.68）。**服务端不做设备判断** |
| 新增表 | `tip_orders`（一张）+ `users` 加一列；商品目录用静态 TS 种子 |
| migration 编号 | 合入时按真实目录取下一连续编号（**已核实当前最后为 `0019`**，`0020` 仅被导入/导出方案预留） |
| access_token | `query_order` 需 `access_token + pay_sig`。单实例部署 ⇒ 一把 mutex + Redis 缓存即可 |
| 灰度 | 单个 `WX_PAY_MODE = off \| allowlist \| on` 枚举（v0.9 的三个 boolean 存在无效组合，§2.5） |
| 调度 | 单个 `tipReconcileScheduler`，**只有一类候选**（支付核实） |
| 新增 ErrorCode | 只新增 `PAYMENT_PRODUCT_INVALID` |

### 0.1 累计删除清单（v0.5 → v0.6 → v0.7 → v0.8 → **v1.0**）

保留本表是为了防止后续版本把这些机制重新加回来。**判据统一为：说不出「唯一消费者」或「失败场景的发生条件 + 不覆盖时的实际后果」的机制，一律不建。**

| 被删机制 | 删于 | 理由 |
|---|---|---|
| `abandoned` 状态 + `/abandon` 端点 | v0.6 | 唯一收益是把 `next_probe_at` 从 +120s 改成 +5min，已被 `created` 分级探测覆盖 |
| `purchase_scope_key` + active scope 唯一索引 + 复签 + `reused_order` + `already_owned` | v0.6 | 禁购分支产品上不成立（§5.6） |
| `channel_order_id` / `wxpay_order_id` 唯一索引 | v0.6 | 仅人工对账用，唯一性无消费者（列保留） |
| `transportAuth` 三级 | v0.6 | 唯一消费者是「能否乐观 ack」，该耦合已被消除 |
| B9 阻塞式协议 spike | v0.6 | 官方页面已明文给出格式、字段表与回包 |
| 对 Android 渠道的周期性退款核对 | v0.6 | Android 退款由我方主动发起，必然知情 |
| 平台确认延迟校验队列（每单一次额外 `query_order`） | v0.7 | 覆盖的「15 次重试全部丢失且服务器可用」在概率上不成立 |
| `user_entitlement_grants` + `user_support_profiles` 两张表 | v0.7 | 权益/次数/支持度全部可由 `tip_orders` 派生 |
| 全局 `withWxSessionLease()` + `request.ts` 的 `noAuthRetry` | v0.7 | 防的是一个**本就自愈**的失败，代价却是改造所有 `wx.login()` 调用点并制造 401 重入死锁 |
| `impersonated_by` token claim 全链路 | v0.7 | 与 §4.1.1 的 openid 绑定完全重复，而后者更强且本就必需 |
| `catalog_version`、两级能力标志、access_token generation 防覆盖、`cold_probe_active` / `probe_deadline_at` / `upstream_order_type` | v0.7 | 均无消费者或可由既有字段推出 |
| `platform_delivery` 三态 + `platform_ack_attempts` + `next_platform_ack_at` + `notify_provide_goods` 调用 + scheduler 候选 B + 2 个 ttl 配置 + 1 个 partial index | v0.8 | v0.8 的理由是"未验证"；**v1.0 更正为"官方明说不需要"**，性质从暂缓变为永久删除（§5.3） |
| Apple 渠道周期性退款核对 + `last_refund_checked_at` / `next_refund_check_at` 两列 + 1 个 partial index + 3 个 ttl 配置 + `refund_check` trigger | v0.8 | 退款推送对 iOS 同样存在；漏一笔退款在口径 A 下零差异；`tipRefundWatchDays=180` 的依据与"退款何时发生"无因果关系 |
| `POST /tips/orders/:outTradeNo/pay-claim` 端点 + `paying` 状态 | v0.8 | 与 `GET /tips/summary` 的 fire-and-forget probe 完全重叠；`paying` 是为了让端点有意义才补的，方向是反的（§5.8） |
| `user_tip_prefs` 表 | v0.8 | 一张表只存一个 boolean ⇒ 改为 `users.tip_badge_hidden` 一列 |
| `env_type` / `biz_meta` 的硬阻断语义 | v0.8 | 二者皆为我方常量的回显，误判后果是**每一笔真单都不发货**（§4.3.1） |
| 鸿蒙 / Windows / macOS / 未知平台的默认禁付 | v0.8 | 官方设备路由表明确它们走微信支付，禁付是无依据的自设闸门 |
| `userOverviewApi` 的 userId 分区缓存改造 | v0.8 | 属**既有缺陷**，与 B0 同等处理：拆独立 issue，不绑进 tips PR（§7.3） |
| **两段式交付切片本身（iOS 推迟到第二阶段）** | **v1.0** | 三个前提中两个半被官方文档直接证否；且 iOS 的代码成本≈0，切片等于确定性砍掉约一半潜在赞赏者（§0.2） |
| **`channel` 请求参数 + 目录 `channels` 嵌套 + `?channel=` 浏览态 + `purchasable` 的 channel 分量 + `ios_iap_unavailable` 分支** | **v1.0** | 道具双端互通 + 平台自动路由 + signData 无 channel ⇒ **服务端下单根本不需要知道设备**（§2.4） |
| **`unresolved` 状态 + `tipProbeDeadlineSec` 7 天窗口** | **v1.0** | 探测窗口收敛到 30 分钟后，"超期放弃追踪"与"订单已关闭"不再有区分价值；省一个状态、一套 history 过滤与一批测试（§3.3） |
| **`FOR UPDATE SKIP LOCKED`** | **v1.0** | 单实例 + advisory lock 已保证互斥；pg-mem 不支持，为它写"已接受风险"是自找的（§6.1） |
| **三个灰度 boolean（`wxPayBackendEnabled` / `wxPayEntryVisible` / `wxPayTestUserIds` 的三层组合）** | **v1.0** | 存在 `backend=false && entry=true` 这类无效组合 ⇒ 合并为单一 `WX_PAY_MODE` 枚举（allowlist 名单保留）（§2.5） |
| **`tipWxOutboundConcurrency` 出站 semaphore** | **v1.0** | 日订单个位数，`LIMIT 50` 批次内并发 5 与串行无可观测差异 |
| **`tip_orders.device_platform` 列** | **v1.1** | 服务端一律不读、不可信、不参与任何决策；R1 的渠道归因由权威的 `upstream_order_type` 承担 ⇒ 说不出唯一消费者（§3.3） |
| **codec 的 `success()` / `retry()` 方法** | **v1.1** | 回包与"如何解码请求"无关且恒为常量；抽象一个常量只会让人以为它会变（§4.2.2） |
| **未被实际选中的两个 webhook codec 分支** | **v1.1** | 推送格式由**我方在 MP 后台自己配置**，B5 做完即唯一确定；预先实现三选二正是本方案反复批判的"为未验证假设预留分支"（§4.2.1） |
| **退款状态迁移逻辑、B12 口径选择** | **v1.0** | 产品定位为自愿赞赏、本期不做退款 ⇒ B12 直接定口径 A（不回冲），`$settledStatuses` 成为固定常量，无需再作为待决策项（§5.5） |
| **`WX_PAY_WEBHOOK_CODEC` 三态枚举 + codec 多实现抽象 + §4.2.4 AES 分支 + B5 的 Day 0 闸门地位** | **v1.2** | **官方个人版原文已核实：发货推送配置只填一个 URL，正文明写「平台以 XML 推送」，没有任何数据格式选项**。三选一是【开发设置 → 消息推送】那套**另一个入口**的形态，被误移植到了虚拟支付。⇒ 这是一个**自造的不确定性**，B5 的收益为零、人天区间挂在伪未知上。直接定 XML 单实现（§4.2.1） |
| **`wxPayQueryOrderUrl` / `wxStableTokenUrl` 两个环境变量** | **v1.2** | 微信官方域名不是部署差异项；仓库已有 `_fetch` 可注入范式，测试不需要靠 env 换 URL ⇒ 改为模块常量（§2.5） |
| **`out_trade_no` 撞唯一索引后的"整套重新取号一次"** | **v1.2** | 120 bit 随机（`randomBytes(15)`）的碰撞概率是永不执行的死代码路径；写进方案会让人以为需要为它写测试（§4.1.2） |
| **B0 作为 tips 的时序硬前置** | **v1.2** | tips 的支付边界是 `code2Session.openid === users.wx_openid`——refresh token 即便调得到 tips 端点也**付不了钱**，B0 对 tips 的安全增益≈0。硬前置是自造的排期依赖（§4.0） |

### 0.2 为什么取消两段式切片（v0.8/v0.9 的切片依据已被证否）

v0.8 把 iOS、退款推送、`notify_provide_goods` 三项推到第二阶段，理由是它们"只能靠先有真单来验证"。v1.0 对照官方文档逐条核对后，**三个前提中有两个半是不成立的**：

| v0.8 声称的"未验证假设" | 官方文档的实际答案 | 结论 |
|---|---|---|
| `notify_provide_goods` 是否对个人主体开放 | 官方接口说明原文：「正常通过 `xpay_goods_deliver_notify` 消息推送返回成功**就不需要调用这个 API 接口**」 | **不做是对的，但理由变了**：从"未验证所以暂缓"变为"官方明说不需要" ⇒ 永久删除，连实测都不必安排 |
| 退款推送走哪个 URL、什么格式 | `xpay_refund_notify` 与 `xpay_goods_deliver_notify` 是**同一消息推送通道的两个 Event**，官方已给完整字段表（`WxOrderId` / `MchOrderId` / `RefundFee` / `RetCode` 等） | 假设不成立。且本期根本不处理退款 ⇒ 该项**整体消失** |
| Apple 价格档能否对齐 ¥187.4 | **道具 Android/iOS 双端互通**，同一道具 ID 与价格直接在 iOS 生效；我方**没有也不需要 App Store Connect** | 前提性质变了：不再是"能否对齐"，而是"微信侧是否对 iOS 单做价格档映射"⇒ 降级为**待证实风险 R1**（§4.3.2），不阻塞交付 |

**同时，切片的代价被严重低估**：Costra 是记账工具，iOS 用户占比通常在 40%~60%。"第一阶段只支持 Android"等于**确定性地让约一半用户看到一个不能用的赞赏页**，而换来的风险规避在文档核实后已基本不存在。

**iOS 的实际接入成本**：
- 运营侧：MP 后台配置**小程序简称**（Apple 支付需展示 display name）→ 虚拟支付 → 基本配置开通苹果 IAP。登记为 **B3**。
- 代码侧：**≈ 0**。平台按设备自动路由，`signData` 与下单链路完全一致，道具无需分端配置。
- 客户端侧：仅需把版本闸门从"仅微信 ≥ 8.0.68"扩为"iOS ≥ 15 且微信 ≥ 8.0.68"（§2.4）。

### 0.3 为什么这份文档连续四轮都被评出 P0（v1.2 新增 · 收敛纪律）

到 v1.1 为止，四次外部评审各挖出至少一个 P0：

| 版本 | P0 | 实质 |
|---|---|---|
| v0.6 | `order.status` 枚举缺失、cold-probe 无界 | 判据没有覆盖全部上游取值 |
| v0.8 | `env_type`/`biz_meta` 被做成硬阻断 | 判据没有区分"我方常量回显"与"上游事实" |
| v1.1 | P0-1 `probe_count` 三来源共享；P0-2 summary claim 恒失败 | 判据只在一条路径上成立 |
| **v1.2** | **P0-A T3 只被一个 outcome 分支消费；P0-B 3s 之外的节流值在 8 秒窗口内恒等于 1 次** | **同上** |

**这四次不是四个独立缺陷，是同一个错误的四次复发。** 根因有三条，且都不是"想得不够多"，而是**验证方式错了**：

1. **只校对文档的内部自洽，不推演系统的实际行为。** T3「探测有界」写了三版论证，却从未把「outcome × 本地状态 × 窗口内外」的格子填满——一填就会看到 `retry` / `manual_conflict` / `keep_current` 三条路根本不受窗口约束（P0-A）。
2. **改参数不做算术。** v1.1 把节流从 60s 降到 10s 并写下"窗口内能触发 1～2 次"，但 8 秒窗口 ÷ 10s 节流恒等于 1 次——这句话是**推测出来的，不是算出来的**（P0-B）。
3. **把可查证的事实登记为"待确认"，再围绕它设计分支。** 官方页面白纸黑字写着「以 XML 推送」、配置项只有一个 URL 框，方案却虚构出"数据格式下拉框"，为它造了三态枚举 + Day 0 闸门 + 人天区间（v1.2 删除项）。**这不是谨慎，是拿不确定性当设计理由。**

**因此 v1.2 起立三条硬纪律，后续任何修订必须遵守**：

| # | 纪律 | 落地形式 |
|---|---|---|
| **D1 · 判据必须穷举成表，不得用散文表达** | 凡是"什么时候停 / 什么时候放行 / 什么时候告警"这类判据，必须以**全格填满的矩阵**呈现，任何一格不得留空或写"其余同上" | §4.3.1 的 decision 矩阵已按此重写：**行 = 全部 outcome，列 = 窗口内 / 窗口外**，无空格 |
| **D2 · 涉及时间、次数、节流的参数必须附算术** | 写下"能触发 N 次"必须同时写出除法式；改动任一侧（客户端轮询节奏 / 服务端节流 / 窗口长度）必须重算并更新另一侧 | §4.6.1 与 §7.2 已成对给出算式，并互相标注了耦合 |
| **D3 · 可在官方文档或仓库中查证的事项，不得登记为"待确认"，更不得为其预留分支** | 只有**必须靠真单才能回答**的问题才能进 B13（当前仅剩 R1 与 ¥1 档 iOS 边界两项） | v1.2 已据此删除 B5 的闸门地位与整套 codec 多实现 |

> **一条元判据**：如果某个"不确定性"可以通过读一遍文档或 grep 一次仓库消除，那么围绕它做的任何设计都是过度设计——**包括为它写一条"待验证"的登记**。

---

## 1. 端到端时序

### 1.0 链路方向

发货推送**不是小程序收消息**，而是微信服务器直接请求我方后端的 webhook。小程序在发货链路中完全不参与——这正是前端 success 不能作为发货凭证的原因。

```
链路1  小程序 ──HTTPS──> Costra 后端      下单，拿 payData
链路2  小程序 ──────────> 微信客户端       wx.requestVirtualPayment 调起原生支付面板
链路3  微信服务器 ──HTTPS──> Costra 后端  ★ 发货推送（低延迟主路径）
链路4  Costra 后端 ──HTTPS──> 微信服务器   query_order（支付事实的唯一发放凭证）
```

链路 3 与链路 4 互为推拉备份，**且链路 4 是唯一的发放依据**——链路 3 只负责"告诉我们有事发生了"，具体发不发货由链路 4 的查单结果决定。

我方无需新增公网基础设施：`/v1/*` 已由 nginx 转发到 server，443 与证书满足微信要求。回调不带 `Authorization`；codec 输出的 `authenticated` 仅用于日志与告警分级，不参与任何发货决策。

### 1.1 下单 → 支付 → webhook 发货主链路

```
小程序赞赏页                         Costra 后端                         微信平台
   │                                   │                                   │
   │ 1. await bootstrapPromise         │                                   │
   │    客户端闸门（工具/iOS版本）      │                                   │
   │    wx.login 取 code               │                                   │
   │ POST /v1/tips/orders              │ 2. code2Session(code)             │
   │ {product_key, code}               │──────── jscode2session ─────────>│
   │        （v1.1：仅两个字段）        │<──── openid + session_key ───────│
   │──────────────────────────────────>│ 3. openid === JWT user.wx_openid │
   │                                   │ 4. 校验商品，写 created 订单      │
   │                                   │    （服务端不做设备判断）          │
   │                                   │ 5. 一次 stringify + 两套 HMAC    │
   │<──── {out_trade_no, pay_data} ────│ （session_key 用完即弃）          │
   │ 6. 立即 requestVirtualPayment                                          │
   │──────────────────────────────────────────────────────────────────────>│
   │                          平台按设备路由：iOS→Apple 支付                │
   │                                    其余→微信支付                       │
   │<──── success（仅提示，不可信）────────────────────────────────────────│
   │ UI 进入 settling                  │                                   │
   │                                   │ 7. POST /v1/tips/notify          │
   │                                   │<──── 发货推送（XML/JSON）─────────│
   │                                   │ codec 解析                        │
   │                                   │ → query_order 核实（唯一凭证）    │
   │                                   │ → settleOrder(source='notify')   │
   │                                   │ → 回包 XML 成功常量（§4.2.1）      │
   │ 8. GET /tips/summary（退避 2/2/4/8/15s）│                              │
   │──────────────────────────────────>│ 若本人有 10 分钟内的 created 单： │
   │<──── entitlement + support ───────│ 响应后对**最近一单**             │
   │ UI done                           │ fire-and-forget 一次 probe        │
   │                                   │ （可越过 next_probe_at，§4.6.1）  │
```

**注意第 8 步承担了原 pay-claim 的全部职责**：客户端 success 后本来就要轮询 summary，summary 侧的 fire-and-forget probe 就是"提前核实"信号，无需一个专门的端点重复表达同一件事（§5.8）。

**注意第 4 步不含渠道判断**：`signData` 无 channel 字段、道具双端互通、路由由平台在第 6 步自行完成 ⇒ 服务端在下单时**不需要也无法**知道用户设备（§2.4）。

### 1.2 兜底：回调丢失时的补发

```
tipReconcileScheduler（单 tick，advisory lock 互斥，只有一类候选）
   │
   └─ 支付核实（有界）
        status = 'created' AND next_probe_at <= now()
        短事务 claim（probe_count+1、算下一次 next_probe_at）→ COMMIT
        → 事务外 query_order
        → **先判 T3**：now() >= created_at + tipProbeWindowSec ?
           ├─ 是 → 除"确认已支付(2/3/4)"外一律 mark_expired，停止一切上行
           └─ 否 → 按 outcome 分流
                  ├─ 2/3/4  → settleOrder(source='probe')
                  ├─ 5/8    → mark_refunded（仅状态标记，本期不做退款逻辑）
                  ├─ 6      → mark_expired
                  ├─ 0/1    → 安排下一次
                  └─ 7/9/10/unknown/conflict/上游错误 → 见 §4.3.1 矩阵
```

**关键不变量**

- **T1（本地只发一次）**：notify 与 sweep 都只调用 `settleOrder(outTradeNo, verified, source)`；`out_trade_no` 行锁 + 终态守卫 + 条件 UPDATE 行数断言保证同一订单只翻转一次。
- **T2（发放凭证唯一）**：本地权益只能由一次成功的 `query_order` 且 `status ∈ {2,3,4}` 触发。webhook 的到达、其认证等级、前端 success 均不构成凭证。网络调用永远在 DB 事务之外。
- **T3（探测有界）**：任何订单都不得无限期驻留补偿队列。**判据是时间窗口，且优先于 outcome**：当 `now() >= created_at + tipProbeWindowSec`（默认 30 分钟）时，**除"本次查单确认已支付（2/3/4）"以外的一切结果——含 `unknown`、`transient_error`、`conflict`、`unrelated`——都收敛为 `expired`，并停止一切上行**。该判据与探测次数、触发来源、上游返回内容均无关（**v1.2 修正**，§3.3 / §4.3.1）。
  > **v1.2 为什么改成"前置"**：v1.1 把窗口判定放进 decision 矩阵，但矩阵里**只有 `unpaid 0/1` 那一行消费了它** ⇒ `retry`（unknown / 上游超时）、`manual_conflict`（确定性冲突）、`keep_current`（9/10）三类订单永远停在 `created`、永远命中 `idx_tip_orders_probe_due`，形成**每 tick 一次查单 + 一次告警的死循环**。T3 声称的"任何订单"当时只覆盖了六分之一的分支。

---

## 2. 签名与凭证

### 2.1 signData 构造

`signData` 是一个 **JSON 字符串**（不是对象），字段严格如下（顺序即序列化顺序）：

```jsonc
{
  "offerId": "<WX_PAY_OFFER_ID>",
  "buyQuantity": 1,               // 固定 1，见 §4.3.1 关于数量校验的说明
  "env": 0,                       // 固定 0（正式环境）
  "currencyType": "CNY",
  "productId": "<道具ID>",
  "goodsPrice": <分>,             // 必须 === 后台道具价格（道具双端互通，只有一个价格）
  "outTradeNo": "<T+30位hex>",    // 31 位纯字母数字，不以下划线开头，唯一
  "attach": "costra-tip-v1"        // 固定非敏感协议标识
}
```

**不变量 S1（逐字节一致 + 字段集合闭合）**：`signData` 只允许 `JSON.stringify(obj)` 一次，得到的字符串同时用于 ① 计算 `signature`；② 计算 `paySig`；③ 下发前端的 `payData.signData`。三者引用同一个 `const signDataStr`，**严禁**任何一处再做格式化 / 重排键 / 二次 `parse+stringify`。这是官方「post_body 必须与实际请求体完全一致」的落地约束。

字段集合必须**闭合**为上述 8 项。**注意 signData 中没有任何渠道/设备字段**——这正是 §2.4 删除 channel 维度的第一条依据：协议层面就不存在"为某个渠道下单"这回事。

> **因果纠正（影响排障方向）**：早期版本把该约束的理由写成"多带 `platform` 必现 `-15005`，社区已实证"，**此因果链不成立**——两套签名都是对整串做 HMAC，多一个字段只会让串变长，不会造成签名前后不一致。真实理由是官方字段表闭合为 8 项、未列字段行为未定义。
>
> `-15005`（用户态签名错误）的真因优先级：① S1 被破坏；② `session_key` 已失效（下单与调起之间发生了另一次 `wx.login`，见 §5.2）；③ 沙箱 AppKey 配 `env=0`（可由 `query_order.order.env_type` 事后**参考**，但该字段不作阻断，见 §4.3.1）。

### 2.2 两套 HMAC

```ts
// server/src/wx/virtualPaySign.ts（新增）
import { createHmac } from 'node:crypto';

/** signature：用户态签名，密钥 = 本次 code2Session 得到的 session_key */
export function calcSignature(signDataStr: string, sessionKey: string): string {
  return createHmac('sha256', sessionKey).update(signDataStr, 'utf8').digest('hex');
}

/** paySig：仅用于官方明确要求 pay_sig 的调用；密钥 = 现网 AppKey */
export function calcPaySig(uri: string, postBody: string, appKey: string): string {
  return createHmac('sha256', appKey).update(`${uri}&${postBody}`, 'utf8').digest('hex');
}
```

- 下单：`uri = 'requestVirtualPayment'`，`postBody = signDataStr`。
- `query_order`：`uri = '/xpay/query_order'`（带前导斜杠、去掉 query），`postBody` 为实际发送的 JSON 字符串。本接口不带 `signature`。
- **官方给了可离线自校验的向量**，黄金测试直接用它验证实现，无需等联调：
  ```
  uri='/xpay/query_user_balance'  appkey='12345'
  post_body='{"openid": "xxx", "user_ip": "127.0.0.1", "env": 0}'
  → pay_sig   = c37809f27c6d7fd1837ad2500a04512b66b34fd793a39a385fade56dca89a4b5
  session_key='9hAb/NEYUlkaMBEsmFgzig=='（直接 UTF-8 取字节，不做 base64 解码）
  → signature = 089d9e8dc5d308977360c4b79ec600a93d736802802a807d634192328032f6c7
  ```
- 回调不套用这两套 HMAC。

### 2.3 attach 字段

`attach` 必填且随 `signData` 下发客户端、由推送原样透传，因此**不得放内部 UUID、用户 ID、openid 或任何秘密**。本期固定为 `"costra-tip-v1"`。

`query_order.order.biz_meta` 会回显下单时传入的信息，可与本常量比对作为「查到的订单确实由本系统创建」的**弱证据**——弱证据只写日志，不阻断发放（§4.3.1）。

### 2.4 设备路由是平台行为：删除 channel 维度，闸门只在客户端

#### 2.4.1 权威事实：路由由平台强制决定，开发者无法选择

官方设备路由表（分类归属"平台机制"，采信规则见 §0.0.2）：

| 设备类型 | 对接支付系统 |
|---|---|
| Android、鸿蒙、Windows | 微信支付 |
| **iOS** | **Apple 支付** |

> 原文：「调用 `wx.requestVirtualPayment` 后，**平台会根据不同的设备类型，路由至对应的支付系统**」。

**三条直接推论**：

1. **不开通 Apple IAP，iOS 用户完全无法赞赏，且不存在任何替代路径。** 不能改走普通微信支付（`wx.requestPayment`）——虚拟商品与打赏被平台规范强制要求走虚拟支付，且个人主体本就拿不到微信支付商户号；更不能引导站外收款码/转账（违反小程序运营规范与 Apple 规则）。**故本方案开通 IAP，登记 B3。**
2. **道具 Android / iOS 双端互通**——官方原文：「开发者配置的道具、代币均为 Android、iOS 双端互通，已配置的道具可直接在 iOS 端使用」。⇒ 同一个 `wx_product_id` 与同一个 `priceCents` 双端生效，**不需要分端建道具，也不需要 App Store Connect（我方没有该账号）**。
3. **iOS 开通成本 = 配置小程序简称 + 后台开通**（Apple 支付需展示 display name），代码侧改动约等于零。

#### 2.4.2 因此 `channel` 维度整体删除

把三条事实合起来看：`signData` 里没有渠道字段（§2.1）+ 道具双端同价 + 路由由平台在调起时自行完成 ⇒ **服务端在下单时既不需要、也无法可靠知道用户设备**（客户端上报的 `platform` 本就不可信，而方案又不允许服务端相信它）。

v0.9 遗留的 channel 维度**全部删除**：

| 删除项 | 原位置 |
|---|---|
| 下单 body 的 `channel` 字段及其校验 | §4.1 |
| 目录的 `channels: { wechat_pay: {...}, apple_iap: {...} }` 嵌套结构 | §5.4 |
| `GET /tips/products?channel=` 查询参数与整套"浏览态"语义 | §4.5 |
| `purchasable` 的 channel 分量、"渠道整体未开通"判定 | §4.5 |
| `BUSINESS_RULE_VIOLATION + details.reason='ios_iap_unavailable'` 分支 | §9 |
| 「服务端按 channel 选择目录价格」「客户端伪造 channel 不能低价成交」整段论证 | 原 §2.4 |

**v1.1：连 `tip_orders.channel` 列本身也删除，改存 `upstream_order_type SMALLINT` 原值**（与 `upstream_status` 同为快照）。

> **为什么不留语义化的 `channel`**：v1.0 让它由 `order_type` 映射回填（7/8 ⇒ `apple_iap`，0/1 ⇒ `wechat_pay`，**其余 ⇒ NULL** + 告警）。但方案自己在 §4.3.1 承认"官方枚举可能扩展"——一旦扩展，映射失败就把**原始事实丢掉了**，只剩一个 NULL 和一条过期告警。存原值则永远不丢：渠道归因（Android 1% vs iOS 12% 的账单对账）在查询/展示层做一次映射即可，且新枚举出现时只需改查询、不需要回溯修数据。
>
> 这也是本方案通用判据的一次应用：**能存原值就不要存推导值**。同理适用于 `upstream_status`（早已如此）。

创建订单时该列为 `NULL`，由 `settleOrder` / reconciler 回填。

> **为什么这不是"少做了校验"**：原设计中 channel 的唯一实质作用是选价与置灰，而双端同价使选价消失、置灰属客户端职责。删除后没有任何安全性损失——真正的资金校验是 `order_fee === price_cents`（§4.3.1），它与设备无关。

#### 2.4.3 闸门只在客户端，服务端不做设备判断

| 闸门 | 条件 | 落点 |
|---|---|---|
| **API 可用性（v1.2 改为双判，第一道）** | `wx.canIUse('requestVirtualPayment')` 为 false **或** `typeof wx.requestVirtualPayment !== 'function'` | 客户端置灰 + "请升级微信后再试" |
| 开发者工具禁付 | `wx.getDeviceInfo().platform === 'devtools'` | 客户端置灰 + 一行说明 |
| iOS 版本闸门 | `platform === 'ios'` 时要求 **iOS 系统 ≥ 15** 且 **微信 ≥ 8.0.68** | 客户端置灰 + "请升级"，**不允许调起后再报错**（产品 AC-6） |
| iOS 最低金额 | Apple 支付**最低支付金额 1 元** | 我方最低档正好 ¥1，**B13 需实测确认边界是 `>=` 而非 `>`**；若为 `>` 则 iOS 端隐藏 ¥1 档 |
| 大陆 App Store 账户 | 仅支持中国大陆账户 | **无法前置检测**，由平台在支付面板内报错，我方按普通支付失败处理 |
| Apple 无沙箱 | Apple 支付不支持沙箱环境 | 联调只能用现网真单（`env` 恒为 0，本就如此） |

> **为什么需要第一道闸门**：官方只给出了 **iOS 侧**的微信版本下限（8.0.68），**没有给 Android 侧的下限**。旧版微信上 `wx.requestVirtualPayment` 可能**根本不存在**，直接调用会抛错，而**点击后失败正是产品 AC-6 明令禁止的**。
>
> **v1.2 改为双判（`canIUse` 单判不足）**：`wx.canIUse()` 查询的是**基础库**的能力清单，而 `requestVirtualPayment` 的真实门槛在**微信客户端版本**。二者是两条独立的版本线——**旧客户端 + 新基础库**（基础库可被独立更新）时 `canIUse` 可能返回 `true`，闸门形同虚设，仍会走到"点击后失败"。因此必须叠加 `typeof wx.requestVirtualPayment === 'function'` 的运行时存在性判定。
>
> **且闸门不能只做在渲染层**：以上两判都无法覆盖"API 存在但客户端不支持虚拟支付能力"的残留情形，故 `fail` 回调仍须对该类错误（`errMsg` 含 `not supported` / `function does not exist` 等）做一次兜底文案降级——这不违反 AC-6，AC-6 禁止的是**可前置判定却不前置**。

> **v1.0 撤销 v0.8 的「iOS ≥ 15 不得作为置灰条件」**：v0.8 以"该条只见于企业版材料"为由拒绝设此闸门。按 §0.0.2 的分类，iOS 端下单条件属**平台机制**（两版共用同一套 Apple 支付系统），可以采信。不设闸门的实际后果是 iOS 14 用户点击后遭遇一次无法解释的失败，比误置灰更糟。

- 版本检测**不得使用 `wx.getSystemInfoSync()`**（官方示例用的是它，但该 API 在当前基础库已废弃）。本仓库基线 3.8.12，改用 `wx.getDeviceInfo()`（取 `platform`、`system`）+ `wx.getAppBaseInfo()`（取微信 `version`）。
- **`getDeviceInfo().system` 带平台前缀**（形如 `"iOS 15.4"`、`"Android 13"`），比较前必须先剥前缀再逐段数值比较；`getAppBaseInfo().version` 则是裸版本号（`"8.0.68"`）。两者格式不同，不能共用同一个解析函数而不做归一化（v1.1 补充）。
- **v1.1 删除 `device_platform` 上报**：服务端从不读它、也不允许相信它，R1 的渠道归因由权威的 `upstream_order_type` 承担（§2.4.2）。下单 body 因此只剩 `product_key` 与 `code`。

### 2.5 凭证与开关（`env.ts` 增量）

```ts
// AppEnv 新增字段
wxPayMode: 'off' | 'allowlist' | 'on';  // WX_PAY_MODE，见下表
wxPayTestUserIds: string[];             // WX_PAY_TEST_USER_IDS：allowlist 模式下的真单账号
wxPayOfferId: string;                   // WX_PAY_OFFER_ID
wxPayAppKey: string;                    // WX_PAY_APP_KEY（现网 AppKey，高价值密钥）
wxMsgPushToken?: string;                // 可选：仅用于 §4.2.0 的 GET 接入握手校验
```

> **v1.2 删除三项**：
> - `wxPayWebhookCodec`——推送格式是官方文档已明确的事实（XML），不是部署差异项（§4.2.1）；
> - `wxPayQueryOrderUrl` / `wxStableTokenUrl`——微信官方域名同理，且仓库已有 `_fetch` 可注入范式，测试不需要靠 env 换 URL。二者改为 `server/src/wx/endpoints.ts` 的模块常量；
> - `wxMsgEncodingAesKey`——安全模式（AES）分支整体删除（原 §4.2.4 小节已移除，§4.2.1）。

**`WX_PAY_MODE` 三态**（v1.0 合并 v0.9 的三个 boolean）：

| 值 | 下单 | 入口横幅 | 用途 |
|---|---|---|---|
| `off` | 一律拒绝 | 仅对已有已结算订单的用户可见（保证已支持者仍能看历史） | 功能未上线 / 紧急关停 |
| `allowlist` | 仅 `WX_PAY_TEST_USER_IDS` 内的用户可下单 | 同上 + allowlist 用户可见 | **真单灰度（B13）** |
| `on` | 全量放行 | 全量可见 | 正式上线 |

> **为什么合并**：v0.9 的 `wxPayBackendEnabled` / `wxPayEntryVisible` / `wxPayTestUserIds` 三个独立开关存在 `backend=false && entry=true`（用户看得到入口但一点就报错）这类**无效组合**，且三者的合法组合恰好就是上表三行。用枚举表达可使非法状态不可表示。

- **既有代码增量 E1（`env.ts` 无 boolean 解析能力）**：`env.ts` 当前**没有任何 boolean 字段**，helper 只有 `required / optional / parseNodeEnv / parsePort / parseLogLevel / parseIntOrDefault`。虽然 `WX_PAY_MODE` 改为枚举后不再需要 boolean，但仍需按 `parseNodeEnv` 的白名单抛错范式新增 `parsePayMode`；**若未来引入任何 boolean 环境变量，必须写严格 `parseBool`，禁止 `Boolean(process.env.X)`**（`'false'` 会被判为 true）。
- **既有代码增量 E2（脱敏正则覆盖面不足）**：`code2Session.ts::redactUrlSecret` 现有正则只匹配 `([?&](?:secret|SECRET|Secret))=`，**不覆盖 `access_token=` 与 `pay_sig=`**。本方案要新增这两类 URL，必须扩展该函数（或抽出共享 `redactUrl`），否则 token 会随错误 `cause` 进日志。这是对既有函数的修改，需同步其既有测试。
- AppKey、sessionKey、access_token 均不得进入日志；回调原始报文不长期落盘。
- **不设 `WX_PAY_REFUND_ORDER_URL`**：本期不做退款（§5.5）。
- **不设 `WX_PAY_NOTIFY_GOODS_URL`**：官方明说推送回包成功即无需调用该接口（§5.3）。
- `.env.example` 补全；`server/test/setup.ts` 的 `setupEnv()` 注入测试值，并覆盖非法 mode / 非法 UUID 启动失败。

### 2.6 access_token 管理（最小实现）

官方 `api_query_order` 请求行明文 `?access_token=ACCESS_TOKEN&pay_sig=PAY_SIG`，二者皆必填。

**实现（`server/src/wx/accessToken.ts`，新增）**：

```ts
export async function getAccessToken(opts?: { forceRefresh?: boolean }): Promise<string>
```

| 关注点 | 决策 |
|---|---|
| 获取接口 | `POST /cgi-bin/stable_token`（URL 为模块常量，非 env），body 的 `force_refresh` 与函数参数一一对应：普通获取发 `false`，仅在收到明确失效码后发 `true` |
| 新增密钥 | **无**。复用现有 `WX_APP_SECRET` |
| 缓存 | Redis key `cache:v1:wx:access-token`（对齐现有 `cache:v1:` 前缀）。`expires_in` 通常 7200s，**提前 300s 过期** |
| 并发 | 一把进程内 `Promise` 单飞锁（同时只允许一个在途请求，其余复用其 Promise）。**不做 generation 防覆盖**——单实例部署、QPS 个位数/天，被覆盖的最坏后果是多刷一次 token |
| 失效重试 | 调用方收到 `40001` / `42001` → `getAccessToken({forceRefresh:true})` 后**只重试业务请求一次**；仍失败按 `UNAVAILABLE` 处理 |
| Redis 不可用 | 降级为进程内内存缓存（单实例下等价）；不因缓存故障阻断查单 |
| 日志 | token 值全程不入日志；错误 `cause` 走 E2 扩展后的脱敏 |

**部署前置**：MP 后台若启用了 `access_token` 的 IP 白名单，必须把生产固定 IP 加入（登记 §12 B10）。

---

## 3. 数据模型

### 3.1 编号与可重复执行

**已核实**：`server/db/migrations/` 当前最后一个是 `0019_ledgers_sync_epoch.sql`；导入/导出方案只是**预留** `0020`，不是已落盘事实。合入时重新扫描目录：若 `0020` 已存在则用 `0021_tips.sql`，否则用 `0020_tips.sql`。

生产迁移脚本会重跑全部 SQL，因此所有 DDL 必须 `IF NOT EXISTS` / `ADD COLUMN IF NOT EXISTS`。

### 3.2 商品目录

本期不建商品表，使用 §5.4 的静态 TS 目录；但领域模型从第一版就包含 `type`、`entitlement_keys`、标题与价格（**无 channel 维度**，§2.4）。未来迁表时保持同一 API DTO。

### 3.3 `tip_orders`（唯一的新表）

```sql
CREATE TABLE IF NOT EXISTS tip_orders (
  id                    UUID PRIMARY KEY,
  user_id               UUID NOT NULL REFERENCES users(id),
  openid                TEXT NOT NULL, -- 下单快照，仅服务端查单使用
  product_type          TEXT NOT NULL CHECK (product_type IN ('tip')),
  product_key           TEXT NOT NULL,
  product_title         TEXT NOT NULL, -- 历史显示快照，不受目录改名影响
  wx_product_id         TEXT NOT NULL,
  price_cents           BIGINT NOT NULL CHECK (price_cents > 0),
  support_delta         INTEGER NOT NULL CHECK (support_delta > 0), -- 档位映射快照
  entitlement_keys      TEXT[] NOT NULL, -- 权益快照；徽章/皮肤所有权由它派生（§3.4）
  -- v1.1：不再落语义化的 channel（映射会丢信息），改存 query_order.order_type 原值（§2.4.2）
  upstream_order_type   SMALLINT,      -- 最近一次 query_order 的 order.order_type 原值；渠道归因在查询层映射
  -- v1.1 删除 device_platform：客户端上报、服务端不读、无唯一消费者（§0.1）

  out_trade_no          TEXT NOT NULL, -- 我方 order_id；唯一业务幂等锚
  wx_order_id           TEXT,          -- 微信内部单号；唯一索引用于检测跨单占用
  channel_order_id      TEXT,          -- 用户支付详情页"商户单号"，仅人工客服定位
  wxpay_order_id        TEXT,          -- 用户支付详情页"交易单号"，仅人工客服定位
  upstream_status       SMALLINT,      -- 最近一次 query_order 的 order.status 原值

  status                TEXT NOT NULL DEFAULT 'created'
                        CHECK (status IN ('created','delivered','expired','refunded')),

  created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  paid_at               TIMESTAMPTZ,
  delivered_at          TIMESTAMPTZ,
  refunded_at           TIMESTAMPTZ,
  -- v1.1：last_probed_at 由所有触发源共同推进（节流用）；probe_count / next_probe_at 只由 scheduler 推进（节奏用）
  last_probed_at        TIMESTAMPTZ,
  next_probe_at         TIMESTAMPTZ NOT NULL, -- 创建时写 created_at + 120s
  probe_count           INTEGER NOT NULL DEFAULT 0 CHECK (probe_count >= 0),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_tip_orders_out_trade_no
  ON tip_orders (out_trade_no);
CREATE UNIQUE INDEX IF NOT EXISTS uq_tip_orders_wx_order_id
  ON tip_orders (wx_order_id) WHERE wx_order_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_tip_orders_probe_due
  ON tip_orders (next_probe_at)
  WHERE status = 'created';
CREATE INDEX IF NOT EXISTS idx_tip_orders_user
  ON tip_orders (user_id, created_at DESC);
```

```sql
-- 唯一无法派生的用户偏好：一个 boolean 不值得一张表
ALTER TABLE users ADD COLUMN IF NOT EXISTS tip_badge_hidden BOOLEAN NOT NULL DEFAULT FALSE;
```

**不落列的东西及其推导方式**：

| 曾经的列 | 现在怎么得到 |
|---|---|
| `cold_probe_active` / `probe_deadline_at` | **v1.1：由 `created_at + tipProbeWindowSec` 直接推出**（不再由 `probe_count` 推，理由见 §6.1） |
| `platform_delivery` / `platform_ack_attempts` / `next_platform_ack_at` | 机制整体删除（§5.3） |
| `last_refund_checked_at` / `next_refund_check_at` | 机制整体删除（§5.5） |
| `badge_hidden` | `users.tip_badge_hidden` |
| `channel`（v1.1 删） | 由 `upstream_order_type` 在查询/展示层映射（7/8 ⇒ Apple 支付，0/1 ⇒ 微信支付），**原值不丢** |
| `device_platform`（v1.1 删） | 不需要——服务端从不读它 |

**订单号语义不可互换**：

| 列 | 官方字段 | 用途 |
|---|---|---|
| `out_trade_no` | 下单 `outTradeNo` / `order.order_id` | 我方唯一业务锚、所有本地查找与幂等 |
| `wx_order_id` | `order.wx_order_id` / 推送 `WeChatPayInfo.MchOrderNo` | 微信内部单号；唯一索引用于检测跨单占用 |
| `channel_order_id` | `order.channel_order_id` | 用户在微信支付详情页看到的"商户单号"，用户报障时按此定位 |
| `wxpay_order_id` | `order.wxpay_order_id` | 同上，"交易单号" |

三种上游 ID 均允许为空（官方注明非微信支付渠道如 Apple 支付可能缺失 `WeChatPayInfo`），不替代 `out_trade_no`。

**订单状态机（v1.0：4 态 → 3 个终态，删除 `unresolved`）**：

```
created ──(query_order 确认 status 2/3/4)───────────> delivered
created ──(query_order 明确 status 6 已关闭)────────> expired
created ──(超出 30 分钟探测窗口且本次未确认已支付)──> expired   ← v1.2：不再限定 0/1
created/delivered ──(已核实退款成功 5/8)────────────> refunded
```

- **`status ∈ {0,1}` 只表示本次查询时尚未支付**，不能立即判死。
- **但探测必须有界（T3）**：**判据是时间且优先于 outcome——`now() >= created_at + tipProbeWindowSec`（默认 1800s）时，除本次查单确认已支付（2/3/4）外一律 `expired`**，与探测了几次、由谁触发、上游返回什么无关。
  > **v1.2 修正（P0-A）**：v1.1 把 T3 写成"超窗口**且仍为 0/1**"，并把它做成 decision 矩阵里的一行。但矩阵共有六类 outcome，**只有 `unpaid 0/1` 那一行消费了窗口判据**：
  > - `unknown` / `transient_error` → `retry`
  > - `conflict` → `manual_conflict`
  > - `unrelated 9/10` → `keep_current`
  >
  > 这三类 decision **都不写入终态**，订单于是永久停在 `created`、永久命中 `idx_tip_orders_probe_due`。两个具体后果：① §6.1 节奏表在 `probe_count >= 4` 时**未定义 `next_probe_at`**，实现者若写成"保持不变"即是每 tick 一次的忙轮询 + 持续上行微信；② **`manual_conflict` 在 sweep 侧没有终止出口**——§4.2.3 已为 webhook 侧写了"确定性冲突返回成功回包终止重试"，理由是"重复重试无法修复确定性冲突"，但同一条理由在 sweep 侧当时没有对应实现，结果是每 tick 一次 `error` 告警的死循环。这正是 v1.1 P0-1 极力避免的"正常/异常链路批量产生人工告警"，只是换了个入口。
  >
  > **修法不新增状态**：把 T3 提升为**先于 outcome 分流的前置判定**。确定性 `conflict` 的账实问题由已发出的 `error` 告警 + `upstream_status` / `upstream_order_type` 快照留痕承载，**不靠"继续重试"来表达**——重试既修不好它，也不产生新信息。
  > **v1.1 修正（P0-1）保持有效**：`probe_count` / `next_probe_at` 只由 scheduler 推进（纯节奏游标），`last_probed_at` 由三方共同推进（纯节流），T3 的界与三者都无关。
  > **v1.0 从 7 天收敛到 30 分钟并删除 `unresolved`** 的论证不变：payData 不可复用、支付面板是同步的、`session_key` 会被后续 `wx.login` 轮换 ⇒ 数十分钟后仍未支付的订单此后被支付的概率实质为零；而 `unresolved`（"我方放弃追踪"）与 `expired`（"平台已关闭"）对用户、权益、聚合口径完全一致，仅在人工排障时可由 `upstream_status IS NULL` 区分。
  > **安全性未减**：即使一笔订单在 30 分钟后才被支付（实际不可能，payData 已失效），发货推送仍会到达并触发 `settleOrder`；§4.3.1 的 `expired + paid` 组合已定义为 `manual_conflict`，不会静默丢货。
- 本期**不实现退款逻辑**，但保留 `refunded` 状态值与 `status ∈ {5,8}` 的映射（§5.5）。


### 3.4 权益、次数与支持度：全部派生，不建表

```sql
-- 是否拥有某项权益（徽章，以及未来的皮肤，逻辑完全相同）
-- 用 = ANY(...) 而非 @>：语义等价，且 pg-mem 对数组包含运算符支持不稳定
SELECT EXISTS (
  SELECT 1 FROM tip_orders
  WHERE user_id = $1 AND status = ANY($settledStatuses)
    AND delivered_at IS NOT NULL AND $2 = ANY(entitlement_keys)
);
-- ⚠️ v1.3：上式是「单点判定某个已知 key」的写法。/tips/summary 要输出 entitlements[] 明细
-- （每个 key 及其 MIN(delivered_at)），已知 key 集合为空 ⇒ 不能用它。实现改为
-- `SELECT entitlement_keys, delivered_at ... ` 后在 JS 侧按 key 聚合（tipOrderRepo.deriveEntitlements）：
-- 单用户订单量个位数（见下），等价 unnest + GROUP BY，且规避 pg-mem 对 unnest 的支持风险。
-- 未来新增皮肤 key 无需改查询——这仍是"同一段派生逻辑"，只是聚合发生在 JS 而非 SQL。

-- 汇总（一次查询同时得到三项）
SELECT count(*)                       AS tip_count,
       coalesce(sum(support_delta),0) AS support_score,
       min(delivered_at)              AS first_tipped_at,
       max(delivered_at)              AS last_tipped_at
FROM tip_orders
WHERE user_id = $1 AND status = ANY($settledStatuses)
  AND delivered_at IS NOT NULL;
```

> **v1.2 补 `delivered_at IS NOT NULL`（零成本的正确性收口）**：`$settledStatuses` 含 `refunded`，而状态机允许 `created → refunded`（§4.3.1 矩阵中"非终态 + refunded 5/8 ⇒ `mark_refunded`"）——这是一笔**从未发货**的订单。不加该条件，它会被计入 `tip_count` 与 `support_score`，且 `min(delivered_at)` 会把 NULL 混进 `granted_at`。所有派生查询（含 §7.3 的 overview 聚合）统一带上该条件。

- **`$settledStatuses` 在 v1.0 定为固定常量 `{'delivered','refunded'}`**（即"退款不回冲"，原 B12 口径 A）。**B12 不再是待决策项**：产品定位为自愿赞赏且本期不做退款（§5.5），"退款是否回冲权益"没有实现载体；且 v0.8 已论证漏掉一笔退款在用户侧与数据侧零差异。补充理由：Android 退款只能由我方在后台发起、iOS 退款需向 Apple 申诉，"付款→拿徽章→退款"的滥用成本远高于一个装饰徽章的收益。
- 单用户订单量是个位数，`idx_tip_orders_user` 下这是零成本聚合。
- **`support_score` 必须由订单快照 `support_delta` 聚合，禁止按 `price_cents` 计算**。理由：目录改价会**追溯篡改历史订单的支持度**（用户过去赞赏 ¥9.9 得 99，改价后历史记录跟着变），这是数据正确性问题而非合规问题。
  > v0.9 给的理由是"分端价格可能不一致"，该理由**已被 v1.0 证否**——道具双端互通，只有一个价格（§2.4.1）。但约束本身必须保留，只是换成上面这条更硬的依据。
- **对产品 §6.2「entitlement 概念本期落地供皮肤复用」的满足**：皮肤所有权 = 「有没有一笔已结算订单的 `entitlement_keys` 含该 key」，与徽章共用同一段派生逻辑，未来上皮肤不需要新增表或改协议。

### 3.5 pg-mem 同步与已接受风险

生产 DDL、`server/test/setup.ts::applyMigrations()` 与 `resetPgMem()` 同步维护（新增删除项只有 `tip_orders`；`users.tip_badge_hidden` 随既有 users 清理覆盖）。

**v1.0 主动规避了两处 pg-mem 兼容坑**（而不是写"已接受风险"）：`@>` 改 `= ANY(...)`（§3.4）、`FOR UPDATE SKIP LOCKED` 改普通 `FOR UPDATE`（§6.1）。

**v1.2：partial index 不再写"待验证"，仓库已有实证结论**（`server/test/setup.ts` 的注释即事实源，D3 纪律）：

| pg-mem 实测行为 | 对本方案的影响 |
|---|---|
| partial **unique** index 在 `WHERE bool_col = true` 谓词下**会污染所有针对索引列的等值查询** | — |
| partial index 在 `WHERE col IS NULL` 谓词下**正常** | `uq_tip_orders_wx_order_id ... WHERE wx_order_id IS NOT NULL` 属同族谓词，风险低，直接建 |
| 既有 `uq_families_one_personal_per_owner`（`WHERE kind='personal' AND deleted_at IS NULL`）的处理方式 = **生产建、pg-mem 跳过，约束由应用层 + 真实 PG 兜底** | `idx_tip_orders_probe_due ... WHERE status = 'created'` 是**列等值谓词**，形态最接近已知污染场景（sweep 的 claim 恰好就是对 `status` 做等值查询）⇒ **照既有做法在 `applyMigrations()` 中跳过该 index**，仅在生产 DDL 中保留 |

pg-mem 无真实并发锁语义，无法证明两条推送竞争同一订单时的串行化。本期不悬空要求不存在的真 PG 通道：登记为已接受风险，结构性防线是 `FOR UPDATE`、终态短路、条件 UPDATE 行数断言和唯一索引。

---

## 4. 服务端接口

所有端点进 `/v1` 前缀。**全部端点（含请求/响应 schema）同步进 `server/api/openapi.yaml`**——OpenAPI 是本仓库契约源。

### 4.0 B0：用户端点统一 access-only（既有安全债，**独立 PR 且与 tips 并行**）

#### 问题（已在仓库中核实）

`server/src/plugins/jwt.ts` 提供的 `app.verifyAccessToken()` 会校验 `token_type === 'access'`（`:99-105`），但**没有任何路由使用它**。所有用户路由走 `request.jwtVerify()`，它只校验签名 / iss / aud / exp，**不看 `token_type`**；而 access 与 refresh 用的是同一个 `JWT_SECRET`、同一组 iss/aud：

```ts
// server/src/routes/users.ts:27-36（10 个路由文件的同构副本 + sync.ts 的 parseUserIdFromRequest）
async function parseUserId(request: FastifyRequest): Promise<string> {
  try {
    await request.jwtVerify();
  } catch {
    throw new AppError(ErrorCode.UNAUTHENTICATED, { message: 'invalid token' });
  }
  const user = request.user as JwtPayload | undefined;
  if (!user?.sub) throw new AppError(ErrorCode.UNAUTHENTICATED, { message: 'invalid token' });
  return user.sub;
}
```

后果：**refresh token 目前可以调用全部用户 API**（entries / statistics / families / ledgers / budgets / categories / recurring / announcements / upload / users / sync）。refresh TTL 30 天且不受 access TTL 约束，泄漏面显著大于设计意图。

#### 落地方式：最小 diff，不改签发链路

```ts
// server/src/plugins/requireUser.ts（新增，约 15 行）
import type { FastifyRequest } from 'fastify';
import { AppError } from '../errors/AppError.js';
import { ErrorCode } from '../errors/ErrorCode.js';
import type { AccessTokenClaims } from './jwt.js';

/** 全部用户端点的唯一鉴权入口：access token only。 */
export async function requireUserId(request: FastifyRequest): Promise<string> {
  try {
    await request.jwtVerify();
  } catch {
    throw new AppError(ErrorCode.UNAUTHENTICATED, { message: 'invalid token' });
  }
  const claims = request.user as Partial<AccessTokenClaims> | undefined;
  if (!claims?.sub) {
    throw new AppError(ErrorCode.UNAUTHENTICATED, { message: 'invalid token' });
  }
  if (claims.token_type !== 'access') {
    throw new AppError(ErrorCode.UNAUTHENTICATED, { message: 'access token required' });
  }
  return claims.sub;
}
```

**刻意保留 `request.jwtVerify()`**，只追加 `token_type` 判定。改用 `app.verifyAccessToken()` 需要自己解析 `Authorization` 头、自己处理 Bearer 前缀与 `request.user` 填充，diff 面反而更大且容易与 `@fastify/jwt` 的行为产生偏差。

#### 改造清单（共 12 处）

| 文件 | 现有符号 | 处数 |
|---|---|---:|
| `routes/users.ts` / `entries.ts` / `statistics.ts` / `families.ts` / `ledgers.ts` / `budgets.ts` / `categories.ts` / `recurring.ts` / `announcements.ts` / `upload.ts` | `parseUserId`（同构副本，删除后改 import） | 10 |
| `routes/sync.ts` | `parseUserIdFromRequest`（同上） | 1 |
| `routes/gm.ts` | `requireGm` 内部的前半段替换为 `requireUserId(request)`，再叠加实时查库 `is_gm` 判定（该判定保持不变） | 1 |

> v0.7 在同一份文档里出现过 "11 处 / 11+1 处 / 12 处" 三种口径，v0.8 统一为 **12 处**。

#### 影响面核查（已验证，不是假设）

- **续签链路不受影响**：`routes/auth.ts` 的 `/auth/refresh`（`:70-79`）与 `/auth/logout`（`:81-90`）都从 **body** 读 `refresh_token`，schema 为 `{ refresh_token: string }`，全程不调用 `jwtVerify`。
- **客户端不需要改**：`request.ts` 注入的始终是 access token，401 后的 refresh-once 走 `/auth/refresh` body 通道。
- **GM 通道不受影响**：`gm.ts` 的 `requireGm` 只是把前半段换成共享 helper，`is_gm` 实时查库语义（D2）原样保留。

#### 回归用例

每个路由族至少一条「用 refresh token 调用 → 401 `UNAUTHENTICATED`」；外加一条「refresh token 仍可正常走 `/auth/refresh`」防回归。

本方案的所有 tips 端点直接使用 `requireUserId`。

#### B0 与 tips 的关系（**v1.2 推翻 v1.1 的"硬前置"结论**）

v1.1 曾统一口径为「B0 是 tips 的硬前置，但可以是独立且极小的 PR」。**v1.2 取消这个前置。**

**理由：B0 对 tips 的安全增益≈0。** tips 的支付边界不是鉴权强度，而是 §4.1.1 的 openid 绑定——**持 refresh token 的攻击者即便能调用 `POST /tips/orders`，也拿不出与受害者 `wx_openid` 匹配的 `code`，付不了钱**；而 `GET /tips/summary` 与 `PUT .../badge-visibility` 的敏感度不高于既有的 `GET /users/me`（后者今天就接受 refresh token）。也就是说，"B0 未完成时 tips 会更危险"这个论断不成立，前置是**自造的排期依赖**。

**v1.2 的拆法**：

| 单元 | 归属 PR | 说明 |
|---|---|---|
| 新增 `plugins/requireUser.ts`（约 15 行） | **tips PR**（tips 是它的第一个消费者） | 新增文件，与既有路由零耦合，不产生回归面 |
| 12 处既有 helper 替换 + 回归用例 | **B0 独立 PR**，与 tips **真正并行** | 它才是有回归面的那部分，需要独立验证 |

两条线的唯一交汇是 `requireUser.ts` 这个文件：B0 PR 若先合入则直接复用，若后合入则把 12 处指向已存在的 helper。任一顺序都不阻塞另一方。

> 仍然保留的约束：**tips 不得自建第二套鉴权**——那会让 `users.ts` 内部出现「tips 拒 refresh、`GET /users/me` 接受 refresh」的不一致，既没修洞又污染约定。tips 只使用 `requireUserId`，其语义与 B0 收敛后的全局语义完全一致。

### 4.1 下单 `POST /v1/tips/orders`

- 鉴权：`requireUserId()`（§4.0）。
- Body（AJV，`additionalProperties:false`）：
  ```jsonc
  { "product_key": "coffee", "code": "<wx.login code>" }
  ```
  **v1.1 下单 body 只剩两个字段**：`channel` 于 v1.0 删除（signData 无渠道字段、道具双端互通、路由由平台完成，§2.4.2）；`device_platform` 于 v1.1 删除（服务端从不读取，渠道归因由 `upstream_order_type` 承担，§2.4.3）。

#### 4.1.1 支付身份闸门：openid 绑定是唯一且充分的检查

```
code2Session(code).openid  ===  userRepo.findById(jwt.sub).wxOpenid
```

不一致返回 `PERMISSION_DENIED` + `details.reason='payment_identity_mismatch'`，且不落订单。

**为什么这一条就够了，不需要 `impersonated_by` claim**：`code` 由**当前设备上登录的那个微信账号**产生，服务端换出的 openid 必然是操作者本人的。逐场景验证：

| 场景 | JWT `sub` | code2Session 得到的 openid | 结果 |
|---|---|---|---|
| GM 通过 `user_id` 代登他人（`gm.ts:150-158`） | 目标用户 U | GM 本人的 openid | ≠ `U.wx_openid` ⇒ **拒绝** |
| GM 通过 `create_fake` 代登伪造号（`gm.ts:163-166`） | 伪造用户（`wx_openid = 'gm_fake_…'`） | GM 本人的 openid | ≠ `gm_fake_…` ⇒ **拒绝** |
| token 与账号错绑 / 被盗 token 在他人设备使用 | 受害者 | 攻击者的 openid | ≠ ⇒ **拒绝** |
| GM 代登自己 | GM 自己 | GM 自己的 openid | 相符 ⇒ 放行。**这本来就是 GM 用自己的微信给自己的账号付钱，是合法交易** |

删除该 claim 的收益是**鉴权核心一行不用改**：`plugins/jwt.ts` 的 `AccessTokenClaims` / `RefreshTokenClaims` / `signAccessToken(sub)` / `signRefreshToken(sub, jti)` 四处签名不动，`authService.signPair` / `loginAsOpenid` 的参数列表不动，`gm.ts` 不动，`refresh()` 的 claim 传播逻辑不需要新建。

> 留痕：GM impersonate 的审计仍由 `gm.ts:155/164` 的 warn 日志承担（既有 D5 设计），不受影响。

#### 4.1.2 下单流程

1. 校验 `WX_PAY_MODE`（`off` ⇒ 拒绝；`allowlist` ⇒ 要求 `user_id ∈ WX_PAY_TEST_USER_IDS`）与用户日限 20 单（护 `code2Session` 的 45011 配额）。**不做任何设备/渠道判断**（§2.4.3）。
2. `code2Session(code)` → `{openid, session_key}`；`userRepo.findById(jwt.sub)` 已返回 `wxOpenid`，执行 §4.1.1 的绑定校验。
3. 按 `product_key` 查静态目录；未知/下架商品返回 `PAYMENT_PRODUCT_INVALID`。
4. 事务：插入订单。`out_trade_no = 'T' + randomBytes(15).toString('hex')`（31 位纯字母数字），`next_probe_at = created_at + 120s`，`probe_count = 0`，`upstream_order_type = NULL`（待 `query_order` 回填，§2.4.2）。**无 purchase scope 检查、无活动单复用**——重复赞赏始终新建订单（§5.6）。
   > `next_probe_at` 是**定时兜底**的第一次触发点，**不约束加速探测**：webhook 与 summary 的 probe 可越过它（§4.6）。
   - **日限计数不加 `users` 行锁**：它是一个防滥用软限额，用 `count(*) WHERE user_id=$1 AND created_at > now()-1day` 判定即可，并发下允许 ±1 的偏差。为一个软限额在核心表上加行锁，代价是与登录/资料更新等无关事务争用（同 §4.4 的理由）。
5. 事务提交后从订单持久快照组装一次 `signDataStr` 并计算两套 HMAC，返回 payData。任何约束错误一律不重试、直接抛出。`session_key` 离开函数栈即弃。
   > **v1.2 删除"撞唯一索引时整套重新取号一次"**：`randomBytes(15)` 是 120 bit 随机，碰撞概率使这条分支永不执行；写进方案只会让实现者以为需要为它构造测试。若真的撞上，`23505` 按普通 `INTERNAL` 抛出即可。

- 响应：`{ out_trade_no, pay_data: { signData, paySig, signature, mode:'short_series_goods' } }`。
- 本端点不消费 `request.ts` 自动注入的 `Idempotency-Key`：每次确认都创建新单，这正是"允许重复赞赏"的语义。
- `RATE_LIMITED` 客户端没有通用自动退避（`request.ts` 只有 401 refresh-once，没有 5xx 重试），赞赏页必须显示产品 §3.4 的单行错误。

### 4.2 发货 webhook `POST /v1/tips/notify`

#### 4.2.0 两个必须先解决的传输层前置（**v1.0 新增，缺一即联调阻塞**）

##### （1）Fastify 默认不解析 XML / 纯文本 body

Fastify 只内置注册了 `application/json` 与 `application/x-www-form-urlencoded` 两个 content type parser。发货推送以 `text/xml`（或 `application/xml`）发送，若不显式注册，**handler 拿到的 body 会是空的，或请求直接被拒为 415**。

```ts
// 仅对 tips webhook 路由所在的 encapsulation scope 注册，不影响全局 JSON 行为
app.addContentTypeParser(
  ['text/xml', 'application/xml', 'text/plain', 'application/octet-stream'],
  { parseAs: 'buffer' },
  (_req, body, done) => done(null, body),   // 交给 decoder，保持原始字节
);
```

- 用 `parseAs: 'buffer'` 而非 `'string'`：由 decoder 统一按 UTF-8 解码，避免 Fastify 与解析器对编码的处理产生分歧。
- 同时对该路由设置独立的 `bodyLimit`（建议 64KB）与解析超时。
- **保留 `application/json` 与 `application/octet-stream` 的兜底注册**：不是为了支持"后台可能改格式"（该假设已于 v1.2 证否，§4.2.1），而是因为**上游 Content-Type 头的具体取值不在我方控制内**，多注册几个 MIME 的成本为零。

##### （2）推送 URL 的 `GET` 接入验证（低成本保险，随手实现）

在 MP 后台保存推送 URL 时，平台**可能**先发一次 `GET` 校验请求（`signature` / `timestamp` / `nonce` / `echostr`）——这是微信「消息推送」通用配置的握手方式。

```
GET /v1/tips/notify
  - 若配置了 wxMsgPushToken：校验 SHA1(sort(token,timestamp,nonce)) === signature，通过则原样返回 echostr
  - 若未配置 token（明文模式下平台可能不校验）：在下列约束内原样返回 echostr
  - 无 echostr 参数：返回 'success'（健康探测容错）
```

回包必须是**纯文本 echostr 本身**，不能包 JSON、不能加引号、不能带 BOM。

**v1.2 补：未配置 token 时的回显约束（缺一即成为公开的任意文本回显端点）**

`wxMsgPushToken` 在明文 XML 模式下不是必填项，此时上面第二条分支会**无条件回显任意输入**。风险等级不高（无 cookie、无同源上下文、`Content-Type` 非 HTML 时浏览器不渲染），但收口成本为零，必须做：

| 约束 | 值 |
|---|---|
| 响应 `Content-Type` | 固定 `text/plain; charset=utf-8`（**禁止** `text/html`） |
| 响应头 | 附 `X-Content-Type-Options: nosniff` |
| `echostr` 长度 | 上限 128 字符，超出直接返回 `success` 而非回显 |
| `echostr` 字符集 | 仅允许 `[A-Za-z0-9_-]`，不匹配则返回 `success` |

> 微信握手的 `echostr` 实际是一串随机数字，以上约束不会误伤真实握手。

> **v1.1 修正措辞（原 v1.0 写成"缺失会卡在配置阶段"）**：虚拟支付的发货推送 URL 是在【虚拟支付 → 基本配置 → 发货推送配置】单独填写的，**未必复用小程序「消息推送」那套 `GET` 握手**——官方个人版页面对此没有任何描述。因此"不实现就配不上"是**推测而非既定事实**，不应作为定位它的理由。
>
> 但它仍然该做，理由换成：**实现成本约 10 行、无外部依赖，而万一平台确实握手、我们又没实现，B5/B13 会卡在一个当场看不出原因的地方**。这是一笔典型的廉价保险，按其真实性质登记即可，不需要夸大成必然。B5 执行时**记录实际是否触发 `GET` 及其 query 形态**，据此在后续版本中决定保留或删除。

#### 4.2.1 协议：**明文 XML，单一实现**（v1.2 定稿）

| 项 | 官方明文 |
|---|---|
| 配置入口 | MP 后台【虚拟支付 → 基本配置 → 基础配置 → 发货推送配置】，**只填一个服务器 URL** |
| 数据格式 | **XML**。个人版正文原句：「支付成功后平台以 **XML** 推送到该 URL」。**该配置项没有数据格式选项**（v1.2 核实，见下方纠正） |
| 事件 | `Event = xpay_goods_deliver_notify` |
| 核心字段 | `OpenId`、`OutTradeNo`（我方单号）、`Env`、`WeChatPayInfo.{MchOrderNo, TransactionId, PaidTime}`（**非微信支付渠道可能整个缺失**）、`GoodsInfo.{ProductId, Quantity, OrigPrice, ActualPrice, Attach}` |
| 成功回包 | `<xml><ErrCode>0</ErrCode><ErrMsg><![CDATA[success]]></ErrMsg></xml>` |
| 失败行为 | 未被判定为成功则平台**最多重试 15 次**（间隔 2/4/8/16… 秒） |

##### v1.2 纠正：三态格式假设是自造的不确定性，B5 的闸门地位取消

v1.0～v1.1 声称"请求格式取决于 MP 后台消息推送配置（明文 XML / 明文 JSON / 安全模式）"，并据此设计了 `WX_PAY_WEBHOOK_CODEC` 三态枚举、codec 多实现抽象、§4.2.4 的 AES 分支，还把 B5 提为 **Day 0 硬闸门**、让 §11 的人天变成一个区间。

**核对官方个人版页面后，这个前提不成立**：

1. 【虚拟支付 → 基本配置 → 基础配置 → **发货推送配置**】**只是一个填 URL 的输入框**，页面没有任何"数据格式"选择项；
2. 正文对格式的表述是**确定的陈述句**——「支付成功后平台以 XML 推送到该 URL」，不是"取决于配置"；
3. "明文/JSON/安全模式三选一"是小程序【开发设置 → **消息推送**】那套**通用配置**的形态，属于**另一个入口**，被误移植到了虚拟支付的发货推送上。

**这是 §0.3 纪律 D3 的典型反例**：一个读一遍文档就能消除的问题，被登记成"待确认"，然后围绕它建了枚举、抽象、启动失败分支和一个 Day 0 闸门。

**v1.2 定稿**：

- **只实现 XML 解码**，不设 `WX_PAY_WEBHOOK_CODEC` 配置项，不做 codec 多实现（§4.2.2）；
- **原 §4.2.4 的安全模式（AES）小节整体删除**；
- **B5 降级为一次普通的后台配置动作**（填 URL 并保存），不再是 Day 0 闸门、不再决定人天区间；
- 若将来平台真的提供了格式选项并被我方切换，那时按一次正常的功能变更处理（改实现 + 改测试），而不是现在预留分支。

##### 依赖影响（v1.2 收敛为确定值）

`server/package.json` 现有依赖为 `fastify` / `@fastify/*` / `pg` / `ioredis` / `luxon` / `pino` / `uuidv7` / `dotenv`，**没有任何 XML 解析库**（已实证）。格式定为 XML ⇒ **必然需要新增一个 XML 解析依赖**（如 `fast-xml-parser`），并按仓库既有约定完成供应链评审（体积、维护活跃度、无传递依赖膨胀），解析器配置须**禁 DTD / 外部实体、限制嵌套深度与节点数**。

这笔成本在 v1.2 是**确定发生**的，因此 §11 的 webhook 行取固定值而非区间。

##### 回包：个人版原文的 XML 常量

**回包固定为**：

```xml
<xml><ErrCode>0</ErrCode><ErrMsg><![CDATA[success]]></ErrMsg></xml>
```

它是一个字符串常量，与请求解析无关，由 handler 直接返回。

#### 4.2.2 解码：一个纯函数，不做 codec 抽象（v1.2）

```ts
// server/src/wx/xpayNotifyDecoder.ts（新增）
export function decodeXpayXml(raw: Buffer): NormalizedXpaySignal;   // 含 authenticated: boolean
```

> **v1.2 删除 `VirtualPayWebhookCodec` 接口**。v1.1 已按"说不出它会怎么不同的抽象不该存在"删掉了 `success()` / `retry()`，但**同一把尺子没有量到接口本身**：
> - `decode` 的多实现前提（格式三选一）在 §4.2.1 被证否 ⇒ 只剩一个实现的接口不是抽象，是间接层；
> - `verifyHandshake?` 与"如何解码请求体"无关，它只依赖 `wxMsgPushToken`，**按删 `success()` 的同一理由应移出**——v1.2 把它直接放在 `GET` route handler 里（§4.2.0）。
>
> 保留的是**函数边界**而非接口：业务 handler 仍然只见标准化的 `NormalizedXpaySignal`，不接触 XML 字段名。这一点与 v1.1 的意图一致，只是不需要为它声明一个 interface。

`authenticated` 只影响日志级别与告警，不参与任何决策。

解析器安全配置（随 XML 依赖一并评审）：**禁 DTD / 外部实体**、限制嵌套深度与节点数、非法编码直接拒绝，叠加 §4.2.0 的 body 上限与解析超时。

#### 4.2.3 发货处理

```
decode → 标准化 outTradeNo / productId / quantity / authenticated
  → 查本地订单；未知订单 warn + success（不查微信，避免伪造请求放大配额）
  → 已 delivered / refunded：warn + success
  → 已 expired 但推送称已支付：error 告警 + success，转人工（manual_conflict，不静默丢货）
  → 推送侧弱校验（只告警不阻断）：Quantity !== 1、ProductId !== 本单 wx_product_id
  → 原子 claim 本单探测租约（只更新 last_probed_at，不动 probe_count/next_probe_at）
  → 事务外 query_order(openid, outTradeNo)
  → validateQueryOrderOutcome（三项硬校验 + 若干弱证据，§4.3.1）
  → status ∈ {2,3,4}：settleOrder(source='notify')
  → 回包 §4.2.1 的 XML 成功常量
```

webhook 与 summary 触发的 probe 共用「每订单探测租约」，**二者同权**：都可越过远期 `next_probe_at`，都只受 `tipProbeMinIntervalSec` 保护，都**不消耗 scheduler 的节奏游标 `probe_count`**（v1.1，§3.3 P0-1）。抢不到租约就返回 retry。

> **v1.0 删除全局出站 semaphore**：日订单量个位数、scheduler 每 tick 最多 50 单，"并发 5"与串行没有任何可观测差异。限流的实际载体已经是 `tipProbeBatchSize` 与探测租约。

确定性账实冲突（`order_id` 不符、`order_fee` 不符、平台 ID 已属其他单）：不发放、`error` 告警、返回 **成功回包**终止重试，转人工——重复重试无法修复确定性冲突。

> **v1.2：同一条理由必须在 sweep 侧也有出口**。本段自 v0.6 起就写明"重复重试无法修复确定性冲突"，但直到 v1.1 该终止**只实现在 webhook 侧**（靠成功回包让平台停止重试）；sweep 侧的 `manual_conflict` 既不写终态也不停探测，于是每 tick 一次查单 + 一次 `error` 告警。**v1.2 由 §4.3.1 的 T3 前置判定统一收口**：窗口内的 conflict 仍每轮告警（此时人工介入尚有意义），窗口外一律 `expired` 并停止上行。

#### 4.2.4 事件分流与错误出口

| 标准化事件 | 处理 |
|---|---|
| `goods_delivery`（`xpay_goods_deliver_notify`） | 进入 §4.2.3 |
| `refund_succeeded`（`xpay_refund_notify`） | **本期不实现退款逻辑**：warn 记录（含脱敏后的订单定位字段 `MchOrderId` / `WxOrderId` / `RefundFee` / `RetCode`）+ 成功回包，人工在后台处理（§5.5） |
| `ios_refund_query`（`xpay_subscribe_ios_refund_query_notify`） | **有意不应答**：info 日志 + 成功回包。官方规则是连续 3 次、3 秒内未应答则微信向 Apple 返回"不确定"，把决定权交回 Apple——这正是我方期望的行为（自愿赞赏不拦截退款）。**建模它只是为了不把它当成 unknown 反复告警** |
| `unknown` | debug 日志 + 成功回包，避免无意义重试 |

POST handler 内自行 try/catch，不复用面向客户端的 JSON `errorHandler`；成功回包一律为 §4.2.1 的 XML 常量。该路由豁免未来的用户 API 限流，但仍设置严格 body 大小、解析超时和并发上限。

### 4.3 微信 B 端客户端（内部，不暴露给小程序）

`server/src/wx/virtualPayClient.ts` 复用 `code2Session.ts` 的 `_fetch` 可注入、5s 超时与日志脱敏范式（脱敏需先完成 E2）。

#### 4.3.1 `query_order`

```http
POST https://api.weixin.qq.com/xpay/query_order?access_token=<token>&pay_sig=<sig>
Content-Type: application/json

{"openid":"<下单快照>","env":0,"order_id":"<outTradeNo>"}
```

- `pay_sig` 对 `uri='/xpay/query_order'`（不含 query）和**实际发送的同一 body 字符串**计算。本接口不带 `signature`。
- `order_id` 与 `wx_order_id` 二选一；我方始终传 `order_id`，不传空 `wx_order_id`。

**`order.status` 官方枚举共 11 个值，必须全部建模**：

| status | 官方含义 | 我方语义 |
|---|---|---|
| 0 | 订单初始化（不可支付） | `unpaid` |
| 1 | 订单创建成功 | `unpaid` |
| 2 | 已支付，待发货 | `paid` |
| 3 | 订单发货中 | `paid` |
| 4 | 订单已发货 | `paid` |
| 5 | 订单已经退款 | `refunded` |
| 6 | 订单已经关闭 | `closed` ⇒ 唯一可置 `expired` 的依据 |
| **7** | **订单退款失败** | **`refund_failed`**：订单实际仍已支付已发货，**保持 delivered**，仅告警。漏建模会让它落进 `unknown` 并被永久重试 |
| 8 | 用户退款完成 | `refunded` |
| **9 / 10** | 回收广告金完成 / 分账回退完成 | **`unrelated`**：与本业务无关，保持现状、停止本轮重试。保留建模是因为删掉它反而要解释为什么漏了两个枚举值 |

```ts
type QueryTransientReason = 'timeout' | 'network' | 'rate_limited' | 'token_failed' | 'upstream_5xx';

export type RawQueryOrderOutcome =
  | { kind: 'paid'; status: 2 | 3 | 4; order: QueryOrderSnapshot }
  | { kind: 'unpaid'; status: 0 | 1; order: QueryOrderSnapshot }
  | { kind: 'refunded'; status: 5 | 8; order: QueryOrderSnapshot }
  | { kind: 'closed'; status: 6; order: QueryOrderSnapshot }
  | { kind: 'refund_failed'; status: 7; order: QueryOrderSnapshot }
  | { kind: 'unrelated'; status: 9 | 10; order: QueryOrderSnapshot }
  | { kind: 'unknown'; status: number; order?: QueryOrderSnapshot }
  | { kind: 'transient_error'; reason: QueryTransientReason };

export type ValidatedQueryOrderOutcome =
  | Exclude<RawQueryOrderOutcome, { kind: 'paid' }>
  | { kind: 'paid'; status: 2 | 3 | 4; order: VerifiedPaidOrder }
  | { kind: 'conflict'; reason: 'order_id' | 'order_fee' | 'wx_order_id' };
```

`validateQueryOrderOutcome(localOrder, rawOutcome)` 是唯一校验入口，禁止调用方旁路。**校验分两级**：

**A. 硬阻断（不符 ⇒ `conflict` ⇒ 不发放、告警、转人工）——只有三项**

| 校验 | 规则 | 为什么必须硬阻断 |
|---|---|---|
| `order_id` | 必须 === `out_trade_no` | 不符意味着我们在给错误的订单发货 |
| `order_fee` | 必须 === `price_cents` | 金额不符意味着账实不符。`buyQuantity` 恒为 1，故该等式已隐含数量校验——官方 `order` 对象**没有数量字段**，不要伪造"数量校验"（此处显式留痕，以免后续版本又把它补回来）。⚠️ **Apple 渠道存在待证实风险 R1，见 §4.3.2** |
| `wx_order_id` | 已存值不得漂移；非空值撞其他业务单视为冲突 | 跨单占用是真实的账实错乱 |

**B. 弱证据（不符 ⇒ 只记日志/告警，照常发放）**

| 项 | 期望 | 为什么不能阻断 |
|---|---|---|
| `env_type` | 1（现网） | 它只是我方 `env=0` 常量的回显。若官方在个人主体下的取值语义与企业版文档有出入，硬阻断的后果是**每一笔真单都不发货**——这正是本方案最不能出的故障。排障价值保留在日志里即可 |
| `biz_meta` | === `attach`（`costra-tip-v1`） | 同上：我方常量的回显，对资金安全零贡献 |
| `order_type` | 7/8 ⇔ Apple 支付，0/1 ⇔ 微信支付 | 官方枚举可能扩展，误伤代价大于收益。**v1.1：原值直接落 `upstream_order_type`**（§2.4.2），不做映射也不因"无法识别"而丢弃；渠道归因在查询层完成。仍不作发放前提 |
| 推送 `GoodsInfo.Quantity` | === 1 | 已被 `order_fee` 等式隐含 |
| 推送 `GoodsInfo.ProductId` | === 本单 `wx_product_id` | 零成本的额外证据，但不作发放前提 |
| `paid_fee` | 可能受渠道优惠影响 | **仅留作对账，不做相等断言**；`paid_time` 按 Unix 秒转换 |

> **判据**：一项校验能否硬阻断，取决于「它不符时是否意味着资金/账实真的出了问题」。`order_id` / `order_fee` / `wx_order_id` 是；`env_type` / `biz_meta` / `order_type` / `Quantity` / `ProductId` 都只是我方已知常量的回显或可扩展枚举，把它们做成阻断是**用误判风险换取零安全收益**。

#### 4.3.2 待证实风险 R1：`order_fee` 硬阻断在 Apple 渠道的表现（**v1.0 登记，暂不调整实现**）

**风险陈述**：Apple IAP 使用固定价格档表。若微信侧在 iOS 渠道对我方道具价格做了**价格档映射**（例如 ¥187.4 → Apple 最近可用档），那么 `query_order` 返回的 `order_fee` 会与我方 `price_cents` 不等，触发 §4.3.1 的 `conflict` ⇒ **每一笔该档位的 iOS 单都会"钱收了不发货"**。

这与本方案 §4.3.1 反复强调的"最不能出的故障"是同一种，只是藏在硬阻断项里而非弱证据项里。

**当前状态：`order_fee === price_cents` 的硬阻断按原样实现，本期不做任何降级或分渠道处理。** 理由：

1. **风险未经证实**。官方明文「道具 Android / iOS 双端互通，已配置的道具可直接在 iOS 端使用」，最直接的读法就是价格也直接生效、不做映射；"存在价格档映射"目前只是推测。
2. **为一个推测预先削弱资金校验，代价不对称**。`order_fee` 是三道硬阻断中唯一防"金额被篡改"的，提前放宽它等于用确定的安全性去换不确定的可用性。
3. 风险**可被观测且后果可逆**：若真发生，表现是 iOS 单集中落 `conflict` + `error` 告警，订单停在 `created`，**钱在平台侧、用户可申诉、我方可人工补发**，不会丢账。

**验证方式（进 B13）**：开通 IAP 后，用一笔 **¥9.9 的 iOS 真单**走完整链路，记录 `query_order` 返回的 `order_fee`、`paid_fee`、`order_type` 实际取值。

> **v1.2 由 ¥187.4 改为 ¥9.9**：v1.0 选 ¥187.4 的理由是"整数价大概率恰好落在 Apple 档上、验不出问题"——这个理由只要求**非整档价**，而 **¥9.9 同样不是 Apple 中国区的整档价**，证伪能力完全等价。成本却相差 19 倍，且 iOS 结算周期 45~60 天、抽成 12%，若 R1 被证实还需改完再验一次。¥187.4 档改为放量前的确认单（B13 第 ⑧ 步）。

**若证实存在映射，届时的修法**（现在不写代码，只固定方向，避免临场乱改）：

- **不是**把 `order_fee` 整体降为弱证据——那会同时放掉微信支付渠道的保护；
- 而是按 `order_type` 分渠道：微信支付渠道保持 `order_fee === price_cents` 严格相等；Apple 渠道改为 **`order_fee >= price_cents`**（收到的不少于标价即认为账实相符）+ 不等时告警并把实际值落 `upstream_status` 旁的诊断字段。
- 同时产品侧需决策 ¥187.4 档在 iOS 的展示价是否随之调整（`support_delta` **不随价格变动**，见 §3.4）。

> **登记纪律**：R1 在 B13 完成前**不得被当作已知事实写进代码注释或测试断言**。它现在是一条待证伪的假设，不是一个待修的缺陷。

错误码：`268490003`（签名错误）配置告警；`268490015`（频率限制）退避；`40001/42001` 强刷 token 后只重试一次。客户端"刷新状态"只请求我方 summary，不暴露查单代理端点。

所有调用方共用同一个纯决策层：

```ts
type QueryTrigger = 'notify' | 'summary' | 'payment_sweep';

reconcileQueryOutcome(input: {
  localStatus: TipOrderStatus;
  outcome: ValidatedQueryOrderOutcome;
  trigger: QueryTrigger;
  probeWindowExpired: boolean;   // now() >= created_at + tipProbeWindowSec（时间界，与次数/触发源无关）
}): ReconcileDecision;
```

**决策表（v1.2 重写为全格填满的矩阵，纪律 D1）**

判定分两步，**顺序不可交换**：

**第 1 步 · 终态与已交付守卫**（与窗口无关，因为它们已经不在补偿队列里）

| 本地状态 | 上游结果 | decision |
|---|---|---|
| delivered | paid 2/3/4 | `settle`（幂等成功，只补齐平台 ID） |
| delivered | **refund_failed 7** | **`keep_delivered`** + warn，不重试 |
| delivered | refunded 5/8 | `mark_refunded` |
| delivered | unpaid 0/1 或 closed 6 | `manual_conflict`，**不得把已交付订单改 expired** |
| **expired** | **paid 2/3/4** | **`manual_conflict`** + error 告警。窗口收敛到 30 分钟后这是理论情形，但必须显式建模，否则"迟到的支付"会被静默丢弃 |
| expired / refunded | 其余任一 | `keep_current`，info 日志 |

**第 2 步 · 非终态（`created`）：先看窗口，再看 outcome**

| 上游结果 | **窗口内**（`!probeWindowExpired`） | **窗口外**（`probeWindowExpired`） |
|---|---|---|
| paid 2/3/4 | `settle` → §4.4 | **`settle`**（唯一穿透窗口的结果——钱确实收到了，必须发货） |
| refunded 5/8 | `mark_refunded` | `mark_refunded`（已是终态，无需再判窗口） |
| closed 6 | `mark_expired` | `mark_expired` |
| unpaid 0/1 | `schedule_probe` | **`mark_expired`**（T3） |
| refund_failed 7 | `manual_conflict` + error（`created` + 退款失败 = 账实错乱） | **`mark_expired`** + error 告警 |
| unrelated 9/10 | `keep_current`，info 日志，不重排 | **`mark_expired`** + info |
| unknown | `retry`，按队列退避 | **`mark_expired`** + error 告警 |
| transient_error | `retry`，按队列退避 | **`mark_expired`** + warn |
| conflict | `manual_conflict` + error，不改账 | **`mark_expired`** + error 告警（**账实冲突已在窗口内告警过，此处只停止上行，不改账**） |

> **v1.2 修正（P0-A）——为什么必须是"窗口优先"而不是矩阵里的一行**
>
> v1.1 把窗口判据写成矩阵中的**一行**（"unpaid 0/1 且 `probeWindowExpired`"）。但矩阵共有 9 类 outcome，**只有那一行消费了 `probeWindowExpired`**，剩下的 `retry` / `manual_conflict` / `keep_current` 都不写入终态 ⇒ 订单永久停在 `created`、永久命中 `idx_tip_orders_probe_due`：
>
> - **`unknown` / `transient_error`**：上游持续异常（例如微信改了枚举、或我方 AppKey 配错）时，订单以 tick 频率无限重试；
> - **`conflict`**：本方案自 v0.6 起就写明"重复重试无法修复确定性冲突"，却只在 webhook 侧给了终止出口，sweep 侧每 tick 一次 `error` 告警；
> - **`unrelated 9/10`**：`keep_current` 字面意思就是"什么都不改"，于是永远留在队列里。
>
> 这与 v1.1 P0-1 是同一类故障（**正常/异常链路批量产生人工告警**），只是入口从"节奏游标"换成了"矩阵覆盖不全"。**根因是判据用散文表达而非穷举表**——这也是 §0.3 立 D1 纪律的直接来源。
>
> **窗口外只放行 `settle` 一项**的理由：T3 保护的是"我方不再无限期上行查单"，而不是"我方拒绝承认已收到的钱"。已确认支付必须发货，否则就是 §4.3.1 反复强调的最不能出的故障。
>
> **`mark_expired` 不等于丢货**：`expired + paid` 已在第 1 步定义为 `manual_conflict` + error 告警，迟到的支付推送仍会触发人工补发。

> **v1.1 把 `probeBudgetExhausted` 改为 `probeWindowExpired`**（P0-1，结论保持有效）：前者由 `probe_count >= 4` 推出，而 `probe_count` 会被 webhook / summary 的加速探测共同消耗 ⇒ 一笔正常订单可能在用户还在 `settling` 时就被判 `expired`。判据改为纯时间后，"探测了几次""谁触发的"都不再影响订单生死。

执行层按 trigger 消费 decision：webhook 对已落账、确定性冲突、`keep_*`、`mark_*` 回成功回包，仅对 `schedule_probe` / `retry` 回 retry；summary 无 wire 回包；sweep 执行对应动作。所有路径严格执行 `raw → validate → reconcile → execute`。

### 4.4 结算发放（单一出口）`settleOrder`

```ts
/** source 仅用于日志与指标，不驱动任何状态 */
type SettlementSource = 'notify' | 'probe';

settleOrder(
  outTradeNo: string,
  verified: VerifiedPaidOrder,
  source: SettlementSource,
): Promise<SettlementResult>
```

`VerifiedPaidOrder` 只能来自成功的 `query_order` 且 `status ∈ {2,3,4}`。事务步骤：

1. **只锁 `tip_orders WHERE out_trade_no=$1 FOR UPDATE`**（不存在返回 `order-not-found`），重新读全行。
   > **不锁 `users`**：权益改派生后，本事务不读也不写任何 user 维度数据，锁 `users` 锁的是一个与本事务无关的行。它带来两个纯粹的坏处：与登录、资料更新、家庭成员变更等事务争用；把死锁面从 tips 内部扩散到核心表。锁一个不参与本事务的行，不构成任何保护。
2. 再次校验 `order_id`、`order_fee` 与已有平台 ID；冲突返回 `order-conflict`，不改账。
3. 终态守卫：`delivered` 返回幂等成功（只允许补齐不冲突的平台 ID）；`refunded` / `expired` 不发放，`refunded` 记 warn、`expired` 记 error 升级人工。
4. 条件更新 `created → delivered`，回填平台 ID、`upstream_status`、**`upstream_order_type` 原值**（§2.4.2）；`paid_at` 优先取 `verified.paid_time`（缺失才取当前时间），`delivered_at=now()`。**断言影响行数为 1**。
5. **没有第 5 步**。徽章、次数、支持度全部由订单派生（§3.4），状态翻转即权益生效——这也让 T1 从"多处写路径都必须只执行一次"退化为"一次条件 UPDATE"，幂等性由 SQL 本身保证。

任何唯一约束冲突都会使整个事务回滚，不允许捕获 `23505` 后继续。notify 与 sweep 都必须走该函数。

### 4.5 商品目录 `GET /v1/tips/products`

- 鉴权：`requireUserId()`。
- **无任何 query 参数**（v1.0 删除 `?channel=`，见 §2.4.2）。
- 响应：
  ```jsonc
  {
    "purchasable": true,
    "products": [{
      "type": "tip",
      "product_key": "coffee",
      "title": "请开发者喝一杯咖啡",
      "price_cents": 990,
      "support_delta": 99,
      "entitlement_keys": ["supporter_badge"],
      "sub_desc": "..."
    }]
  }
  ```
- **单一顶层 `purchasable`** = `WX_PAY_MODE === 'on' || (WX_PAY_MODE === 'allowlist' && user ∈ testUserIds)`。**不含任何渠道分量**——道具双端同价同 ID，iOS 与 Android 看到的目录完全一致。
- `wx_product_id` 是服务端签名配置，不下发。下单事务必须重检能力，不信任目录响应。客户端持久缓存只保存商品公共字段，不保存 `purchasable`；离线恢复时强制不可购买。
- **iOS 相关的置灰不由本端点表达**，而由客户端闸门（§2.4.3）在渲染层处理：目录是"卖什么"，闸门是"这台设备现在能不能买"，两者不应耦合。

### 4.6 权益汇总 `GET /v1/tips/summary`

- 一次派生查询（§3.4）+ 最近 N 条 `status IN ('delivered','refunded')` 的订单。
- 响应：`entitlements:[{key, granted_at}]`（`granted_at = MIN(delivered_at)`）、派生的 `supporter_badge`、`tip_count / support_score`、来自 `users.tip_badge_hidden` 的 `badge_hidden`、`has_pending_orders`，以及历史 `{out_trade_no, time, title, status, support_delta}`。
- 历史标题读订单 `product_title` 快照；退款订单保留并标 `refunded`。**不返回金额、openid 或任何平台 ID**（`wx_order_id` / `channel_order_id` / `wxpay_order_id`）。
  > **v1.3 修正：历史必须带 `out_trade_no`（原文写"不返回订单号"，已推翻）。** 客户端 settling 的 done 判据只能有两种：①「`tip_count` 比下单前变大」——需要一个**下单前基线**，而 `GET /tips/summary` 首拉失败或用户在首拉返回前抢先点击档位时该基线不存在，取 0 兜底会让**已有赞赏记录的用户在第一拍就误判"到账"**（违反产品 AC-4，且是"钱没到账先点亮权益"这一侧的错误）；②「本单出现在 history 中」——精确、无基线、与历史单数无关。选 ②。
  > 暴露面未扩大：`out_trade_no` 是**本人**业务单号，`POST /tips/orders` 的响应已经把它交给同一个客户端；它不参与任何签名密钥推导（`paySig` 的密钥是 AppKey）。真正敏感的金额、openid 与平台 ID 一项未加。
- **本端点承担原 pay-claim 的职责**：若存在本人 10 分钟内的 `created` 单，响应发送后 `void claimProbe(outTradeNo).catch(err => req.log.warn({err},'tip probe failed'))` 触发一次受租约保护的 probe。**绝不 await 上游**，HTTP 响应不等待微信 RTT。
- **每次请求最多 probe 一单（v1.2 新增，必须守住）**：取**最近一张** `created` 单（`ORDER BY created_at DESC LIMIT 1`），不遍历。
  > **为什么这不是优化而是必须**：下单日限是 20 单/人（§4.1.2），用户完全可以在 10 分钟内点出多张 `created` 单（每次点档位取消支付即产生一张）。若 summary 对每张都 probe，则**一次带正常鉴权的 GET 请求会放大成最多 20 次微信出站调用**——这是一个看起来完全合规的配额放大器，且 `tipProbeMinIntervalSec` 是**每订单**节流，拦不住它（20 张单各有自己的 `last_probed_at`）。
  > 取最近一单即可满足全部实际需求：用户正在 `settling` 等待的必然是刚下的那一单；更早的单由 scheduler 的定时节奏兜底。

#### 4.6.1 `claimProbe` 的 claim 条件与节流值（**v1.2 修正，关键**）

```sql
-- 加速探测（webhook / summary 共用）：只看节流，不看 next_probe_at
UPDATE tip_orders
   SET last_probed_at = now(), updated_at = now()
 WHERE out_trade_no = $1
   AND status = 'created'
   AND (last_probed_at IS NULL OR last_probed_at <= now() - ($2 || ' seconds')::interval)
RETURNING *;   -- 影响行数 0 ⇒ 未抢到租约
```

**三条必须守住的点**：

1. **不带 `next_probe_at <= now()` 条件**；
2. **不递增 `probe_count`、不改写 `next_probe_at`**（那是 scheduler 的节奏游标，§6.1）；
3. 节流量由 `tipProbeMinIntervalSec` 承担，**且该值必须与客户端轮询节奏一起算**（见下）。

> **为什么 claim 条件必须去掉 `next_probe_at`（P0-2，v1.1 已修，结论保持）**：v1.0 在 §4.1.2 规定 `next_probe_at = created_at + 120s`，又在本节规定 claim 用「`last_probed_at` 最小间隔 **+ `next_probe_at` 条件** UPDATE」。两者相乘的后果是——**下单后 120 秒内，summary 的 claim 条件恒不成立**。
>
> 影响有两层：① **webhook 一旦丢失，用户最快也要等到 T+2min 才到账**；② **§5.8「删除 pay-claim 端点」的全部论证前提是"summary 已经在做同一件事"**——按 v1.0 的写法它并没有在做，等于把能力删掉了却以为还在。
>
> §4.2.3 早就为 webhook 写了"可越过远期 `next_probe_at`"的豁免，唯独 summary 没写。加速探测的存在意义就是"不等定时"，给它加一个"必须等到定时时间"的条件是自相矛盾的。

##### 节流值必须与客户端轮询节奏成对计算（**v1.2 修正 P0-B，纪律 D2**）

v1.1 把 `tipProbeMinIntervalSec` 从 60s 降到 10s，并写下"10s 既能让窗口内触发 1～2 次"。**这句话没有经过算术**：

| 参数组合 | 客户端请求时刻 | 能抢到租约的次数 | 结论 |
|---|---|---|---|
| v1.1：每 2s × 4 次（窗口 8s）+ 节流 10s | t=0, 2, 4, 6 | **恒 1 次**（t=0；下一次可 claim 要到 t=10，已超窗口） | "1～2 次"是错的 |
| v1.1 的实际效果 | — | 唯一那次落在 **t=0** | **最坏的时刻**：用户刚拿到 success，微信侧订单极可能仍是 0/1 |

也就是说 v1.1 修完之后，加速核实**仍然近似失效**——从"恒失败"变成了"恒失败于最不可能成功的那一刻"，§5.8 的删除前提**依旧不成立**。

**v1.2 定值（两侧同时改，任一侧单独改都会重新破坏该性质）**：

| 侧 | 值 | 算术 |
|---|---|---|
| 服务端 `tipProbeMinIntervalSec` | **3** | — |
| 客户端 settling 轮询 | **退避 2 / 2 / 4 / 8 / 15 秒，累计约 31 秒**（§7.2） | 请求时刻 t=0, 2, 4, 8, 16, 31 |
| **窗口内可抢到租约的时刻** | **t=0, 4, 8, 16, 31（共 5 次）** | 相邻间隔 ≥3s 者均通过：0→4(4s✓)、4→8(4s✓)、8→16(8s✓)、16→31(15s✓)；仅 t=2 被 3s 节流挡掉 |

**这样才真正达成 §5.8 所需的性质**：探测不再集中在最不可能成功的瞬间，而是覆盖 0～31 秒；即便 webhook 完全丢失，用户也能在**十几秒内**看到到账，而不是 T+2min。

**防滥用未削弱**：3s 节流是**每订单**的；叠加 §4.6 的"每次请求只 probe 最近一单"、下单日限 20 单、未知订单不查微信三道防线，单用户可制造的微信出站上限仍是可算的小量。

> **耦合登记（D2）**：`tipProbeMinIntervalSec`、客户端退避序列、`tipProbeWindowSec` 三者互相约束。**改动任一个都必须重算上表并同步另外两个**，同时复核 §5.8 的删除论证是否仍成立。产品侧的对应约束见产品 §3.3 与 Q7。

### 4.7 隐藏徽章 `PUT /v1/tips/summary/badge-visibility`

`requireUserId()`；Body `{badge_hidden:boolean}` → `UPDATE users SET tip_badge_hidden=$1`。使用 PUT 规避小程序 PATCH 降级；没有徽章时仍可保存偏好，但 UI 不展示开关。

---

## 5. 关键技术决策与取舍

### 5.1 migration 让号

合入时扫描真实目录取下一连续编号（**已核实当前最后为 `0019`**），不把其他未落盘方案的预留号当成事实；migration 自身可重复执行。

### 5.2 下单为何仍需当场 `wx.login`，以及为何不建全局串行器

- `signature` 必须使用本次 `code2Session` 得到的 `session_key`；密钥不落库，避免新增高价值密钥的存储与轮转责任。
- 存在一个竞态：若在「我方取 code 换 session_key」与「调起支付」之间发生了另一次 `wx.login`（例如 bootstrap 静默登录、401 后的重新登录），session_key 被轮换，签名失效 ⇒ `-15005`。
- **不为此建全局 lease**。这个失败**本就自愈**：方案已规定「签名类失败丢弃 payData、允许用户重新下单」，用户看到一次单行错误后重试即可成功，不丢钱、不产生脏订单（原订单停在 `created`，由 sweep 在 30 分钟窗口内收敛为 `expired`）。
- 为把一个 2 秒窗口内的罕见、可自愈、无损失的失败降为零，v0.5/v0.6 要求改造**所有** `wx.login()` 调用点并引入全局串行器；该串行器又与 `request.ts` 的 401 → refresh → 重新登录路径构成重入死锁，于是还要再加 `noAuthRetry` 去补。代价与收益严重不匹配。
- 保留的做法只有一条：支付前 `await app.bootstrapPromise`。
- 服务端的 openid/JWT 绑定（§4.1.1）是最终安全边界，与该竞态无关。

### 5.3 平台发货确认（`notify_provide_goods`）：**永久不做**

v0.7 曾搭了一整套 `platform_delivery` 三态机；v0.8 以"未验证"为由删除并推到第二阶段实测。**v1.0 把结论从"未验证所以暂缓"改为"官方明说不需要，永久删除"。**

官方对该接口的说明原文：

> `/xpay/notify_provide_goods` —— 通知已经发货完成（只能通知现金单），**正常通过 `xpay_goods_deliver_notify` 消息推送返回成功就不需要调用这个 API 接口**。

同时，个人版页面的兜底路径原文只有「定时调用 `query_order` 查单，查到已支付就发货」，接入流程图与部署前检查清单里都没有"再通知平台一次"的步骤。

两条合起来足以定论：

- **推送回包成功的订单**：官方明确说不需要调用；
- **靠查单补发的订单**（推送丢失）：官方给的兜底流程到"发货"为止，没有后续动作。

因此 `platform_delivery` / `platform_ack_attempts` / `next_platform_ack_at` 三列、对应 partial index、scheduler 候选 B、`tipPlatformAckRetrySec` / `tipPlatformAckMaxAttempts` 两个配置、`delivery_reconcile` trigger **永久删除**，且 **B13 不再为它安排实测**（v0.8 曾计划"调一次看返回"，既然官方说不需要，实测本身就是多余动作）。

> **方法论留痕**：v0.8 把这条判成"未验证"，是因为它只在个人版页面里搜索接口名。按 §0.0.2 的分类，接口的**行为说明**属平台机制，可采信企业版/服务端 API 页；属于个人主体的限制（"只能通知现金单"与我方道具直购单是否兼容）才需要单独确认——而既然根本不需要调用，这个确认也不必做。

### 5.4 商品目录：本期静态种子

`server/src/config/tipProducts.ts` 使用冻结配置（**v1.0 拍平 channel 嵌套**）：

```ts
{
  products: [{
    type: 'tip',
    productKey: 'coffee',
    title: '请开发者喝一杯咖啡',
    subDesc: '...',
    supportDelta: 99,          // 档位映射快照，随目录下发；客户端禁止按价格推算（产品 §4.1）
    entitlementKeys: ['supporter_badge'],
    wxProductId: '...',        // MP 后台道具 ID，双端通用
    priceCents: 990,           // 双端同价（道具双端互通，§2.4.1）
    enabled: true,
  }]
}
```

- 本期仅 3 条固定商品，建表和后台不会减少发版次数。
- `type`、`entitlementKeys` 现在就进入 DTO；未来迁为商品表时 API 不变。
- `priceCents` 与 `wxProductId` 必须与 MP 后台道具配置逐档一致（**只需核对一套，不分端**）。下单只从服务端目录取价。
- 客户端只缓存商品公共字段；logout 由 `clearAllForReset()` 清除，若另有模块级镜像才在 `localReset.ts` 登记。

### 5.5 退款：**本期不实现任何退款逻辑**

#### 5.5.1 产品前提

Costra 的收费形态是**用户自愿赞赏**，不是商品交易：没有交付争议、没有服务未履约、没有质量问题。因此本期**不实现任何退款业务逻辑**——不接退款推送处理、不做状态回冲、不做周期核对、不提供应用内退款入口。

#### 5.5.2 保留与不保留的分界

| 保留（零成本） | 不保留 |
|---|---|
| `tip_orders.status` 的 `'refunded'` 枚举值与 `refunded_at` 列 | 退款推送的业务处理 |
| `query_order` 的 `status ∈ {5,8} → mark_refunded` 映射 | 退款后的权益回冲 |
| `status = 7`（退款失败）保持 `delivered` + 告警 | 周期性退款核对队列 |
| 收到 `xpay_refund_notify` 时 warn + 成功回包 | `refund_order` 接口调用 |
| 收到 `xpay_subscribe_ios_refund_query_notify` 时 info + 成功回包（**有意不应答**） | iOS 退款问询的自动裁决逻辑 |

**为什么保留 `status ∈ {5,8}` 的映射而不是彻底不管**：这是**零成本的必需品**，不是退款功能。`query_order` 本来就会返回这些值，不建模它们会落进 `unknown` 分支被**永久重试**（这正是 v0.6 修复 `status=7` 时的同一个坑）。保留一行映射的代价是零，不保留的代价是一条死循环。

**为什么 iOS 退款问询有意不应答**：官方规则是「连续 3 次、3 秒内均未应答，微信平台会向 Apple 返回『不确定』，退款决定权交由 Apple 处理」。对自愿赞赏而言，这**正是我们想要的行为**——我方不拦截用户退款。建模该事件仅仅是为了不让它落进 `unknown` 反复告警。

#### 5.5.3 实际发生退款时怎么办

| 终端 | 退款发起方 | 我方动作 |
|---|---|---|
| Android 等 | 开发者主动（MP 后台【虚拟支付 → 交易订单】） | 人工在后台操作；如需同步本地状态，用 `infra/scripts/psql-exec.sh` 按 `out_trade_no` 单笔改 `status='refunded'` |
| iOS | 用户向 App Store 申请，Apple 裁定 | 不干预；收到推送只落 warn 日志，人工按需处理 |

由于 `$settledStatuses = {'delivered','refunded'}`（§3.4），**即使完全不处理，用户侧与聚合口径也零差异**——徽章、次数、支持度都不回冲，只有 history 上少一个标记。

> ⚠️ **不做退款功能 ≠ 不告知退款规则**。官方部署前检查清单明确要求「已向用户说明退款规则、结算周期与费率」，这是提审自查项。产品 §7.3 的四项告知（费率 / 结算周期 / 退款规则 / 月限额）**全部保留**，不因本节而削减。

### 5.6 重复购买定稿为"允许"

早期版本为「禁止重复购买」保留了 `purchase_scope_key` + active scope 唯一索引 + 复签 + 跨档位 `purchase_pending`。该分支**产品上不成立**：唯一索引覆盖的非终态可能长期不终结，于是「用户在 ¥1 档点了取消 → 想买 ¥9.9 档 → 被拒绝」会长期存在，同时违反产品决策 1、决策 4 与 §3.4 异常表。

徽章由派生查询天然去重（`EXISTS`），重复购买只增加次数与支持度。

### 5.7 幂等锚与官方建议的有意偏离（必须留痕）

官方《虚拟支付：个人》页面明写：「`wx_order_id`：平台单号，跟踪订单、发货、对账、**幂等去重均以此为准**」，且**部署前检查清单里就有「发货推送已做幂等（以 `wx_order_id` 去重）」这一条**。

我方**不采用**该建议，幂等只锚 `out_trade_no`：

1. 官方字段说明同时注明 `WeChatPayInfo` 在非微信支付渠道（如 Apple 支付）**可能缺失** ⇒ 开通 iOS IAP 后 `wx_order_id` 可能为 NULL，无法承担唯一锚；
2. `out_trade_no` 由我方生成、下单即落库、全链路必然存在，且 `query_order` 与推送都会原样返回；
3. 我方幂等实现是「行锁 + 条件 UPDATE + 行数断言」，锚点只需唯一且必然存在。

**提审 / 自查表口径（v0.8 补充）**：官方清单那一条问的是「是否做了幂等」，不是「是否用了某个字段」。回答口径为：**已做幂等，锚点为我方业务单号 `out_trade_no`，并对 `wx_order_id` 建了唯一索引用于检测跨单占用**——即官方建议的字段仍被用于一致性校验，只是不作为主锚。B13 自查时按此措辞填写，不要因为清单原文而临时把主锚改回去。

`wx_order_id` 保留唯一索引，用途为**检测跨单占用**。

**此处必须留痕**，否则后续维护者对照官方页面会把幂等键改回 `wx_order_id`，在 iOS 渠道直接失效。

### 5.8 删除 pay-claim 端点与 `paying` 状态

- `POST /tips/orders/:outTradeNo/pay-claim` 的唯一实质作用是「把 `next_probe_at` 提前并触发一次 probe」。但 `GET /tips/summary`（§4.6）对本人 10 分钟内的非终态单**已经在做同一件事**，而客户端在 success 后本来就要轮询 summary。两条路径完全重叠，保留其一即可。
  > **⚠️ 该论证成立的前提是 §4.6.1，且该前提在 v1.0 与 v1.1 下都不成立过**：
  > - **v1.0**：claim 带 `next_probe_at` 条件 ⇒ 前 120 秒恒失败（"能力删掉了却以为还在"）；
  > - **v1.1**：条件已去掉，但 `tipProbeMinIntervalSec=10s` 配 8 秒轮询窗口 ⇒ **窗口内恒只有 t=0 一次**，而那一刻微信侧订单极可能仍是 0/1（§4.6.1 的算术）⇒ 本节前提**仍然不成立**，只是从"恒失败"变成"恒失败于最不可能成功的时刻"。
  > - **v1.2**：节流 3s + 客户端退避 2/2/4/8/15（覆盖 0～31 秒、5 次有效探测）后，本节结论**才真正成立**。
  >
  > **改动 §4.6.1 的任一参数（节流值、客户端退避序列、窗口长度）时必须重算并复核本节。** 这条交叉约束已被违反两次，不是形式主义。
- `paying` 状态本身的来历见修订记录 v0.2：「补 pay-claim 解决 `paying` 不可达」。也就是说，**它是为了让一个状态有意义才被引入的端点**，方向是反的。删掉端点后 `paying` 立刻回到不可达，应一并删除。
- 删除后状态机降为 4 态（v1.0 再删 `unresolved` 后为 3 个终态），探测节奏表由两组降为一组，`QueryTrigger` 少一个，openapi 少一个端点，客户端少一个方法。**没有任何能力损失**：前端 success 之后的加速核实由 summary 承担，webhook 丢失时的兜底由 scheduler 承担。

---

## 6. 补偿调度 `tipReconcileScheduler`

复用 `recurringScheduler.ts` 的启动、停止、测试环境禁 timer 与 `tickOnce()` 形式（`isTestEnv()` 下 advisory lock mock 为永远拿到），但不复用其业务事务结构。独立 advisory lock key `0x54495053` 只保护本轮 claim：持锁完成 lease 写入并提交后立即 unlock/release connection，再并发调用微信。挂载于 `app.ts`，`onClose` 停止。

**只有一类候选**（支付核实）。

### 6.1 支付核实（有界，唯一候选）

1. 短事务选 `status = 'created' AND next_probe_at<=now()`，**`FOR UPDATE LIMIT 50`**。
   > **v1.0 去掉 `SKIP LOCKED`**：本 tick 已被 advisory lock 全局互斥，不存在第二个 sweeper 与之竞争同一批行；唯一可能的并发方是 webhook / summary 的单行 `claimProbe`，那种情况下短暂等待一个行锁反而是正确行为。而 `SKIP LOCKED` **pg-mem 不支持**，保留它就得写一条"已接受风险"——为一个用不上的优化引入测试盲区，不划算。
2. 同事务更新 `last_probed_at / probe_count / next_probe_at` 完成 claim 后立即 COMMIT；不得持行锁或事务调用微信。
3. 事务外执行 `query_order`，以 `trigger='payment_sweep'` 和 `probeWindowExpired = now() >= created_at + tipProbeWindowSec` 交给 §4.3.1 的 reconciler。**reconciler 先判窗口再看 outcome**（v1.2 P0-A）。
4. 按 decision 用独立短事务收敛。**除 `schedule_probe` 与 `retry` 外的一切 decision 都写入终态**，因此订单必然离开 `idx_tip_orders_probe_due`。

**两个游标必须分清（v1.1 P0-1）**：

| 字段 | 谁推进 | 表达什么 |
|---|---|---|
| `probe_count` / `next_probe_at` | **只有 scheduler** | 定时兜底的**节奏**："下一次自动查单在什么时候" |
| `last_probed_at` | scheduler + webhook + summary **共同** | **节流**：距上次任何一次查单是否已过 `tipProbeMinIntervalSec` |
| `created_at + tipProbeWindowSec` | —（纯派生） | **T3 的界**：订单何时停止一切探测并置 `expired` |

定时探测节奏由 `probe_count` 推出，不依赖进程内 timer：

| `probe_count` | 下一次探测 `next_probe_at` | 距下单 |
|---|---|---|
| 0 | 2 分钟后 | T+2min |
| 1 | 3 分钟后 | T+5min |
| 2 | 5 分钟后 | T+10min |
| 3 | 20 分钟后 | T+30min |
| **≥ 4** | **`created_at + tipProbeWindowSec + 1s`**（v1.2 显式定义） | T+30min+1s |

> **v1.2 补：`probe_count >= 4` 时的 `next_probe_at` 必须显式定义（P0-A 的一半）**。v1.1 这一行写的是"落在窗口外，由 T3 时间界置 `expired`"——**这是一句说明，不是一个赋值**。claim 事务必须给 `next_probe_at` 写入某个值，实现者面前只有三个选择，而其中两个是错的：
>
> | 实现者可能的写法 | 后果 |
> |---|---|
> | 保持不变（仍是 T+30min） | 该行已到期 ⇒ **每 tick 都被重新 claim**，忙轮询 + 持续上行微信 |
> | 写 `now() + tickSec` | 同上，只是间隔变成 60s |
> | **`created_at + tipProbeWindowSec + 1s`**（v1.2 定值） | 下一轮 claim 时 `probeWindowExpired` 必为 true ⇒ reconciler 前置判定直接置 `expired`，订单离开队列 |
>
> 选这个值而非"直接在 claim 时就置 `expired`"的理由：**T3 的判定必须只有一处**（reconciler 的前置判定）。若 claim 也能判死，就又出现两个真相源——这正是 v1.0→v1.1→v1.2 反复踩的同一个坑。

> **v1.1 修正（P0-1，结论保持有效）**：v1.0 把最后一行写成"`probe_count >= 4` ⇒ 置 `expired`"，把**节奏游标当成了探测预算**。由于 webhook 与 summary 的加速探测也曾共享这个计数器，一笔正常订单可能在用户还在 `settling` 界面时就被判 `expired`。
>
> 现在两件事彻底解耦：**`probe_count` 只回答"下次什么时候查"，时间窗口只回答"什么时候放弃"**。加速探测不再影响任何一个。
>
> **v1.0 从 7 天 / 约 10 次收敛到 30 分钟**的依据不变：payData 不可复用、支付面板是同步的、`session_key` 会被后续 `wx.login` 轮换 ⇒ 一笔在数十分钟后仍未支付的订单此后被支付的概率实质为零。官方对兜底查单的建议是"每 5 分钟查一次"，本节奏在前 10 分钟内比官方更密，之后收尾。
> **迟到支付不会丢货**：即便出现理论上的迟到支付，发货推送仍会到达，`expired + paid` 已被定义为 `manual_conflict` + error 告警（§4.3.1 矩阵），转人工补发。

任意时刻收到 webhook 或 summary 刷新信号均可在 `tipProbeMinIntervalSec` 约束下提前核实，且**不影响上表节奏**（§4.6.1）。

### 6.2 配置（`ttl.ts`）

`ttl.ts` 现有形态是 `TTLConfig` 接口 + `parseIntOr(env.X, default, key)` 逐项解析 + 末尾一致性校验，新增项按同一范式追加：

| 键 | 默认 | 含义 |
|---|---|---|
| `tipSchedulerTickSec` | 60 | 扫描周期 |
| `tipProbeMinIntervalSec` | **3** | 加速探测（summary / webhook）的**每订单**最小间隔。**v1.2 由 10 降为 3**：与客户端退避序列 2/2/4/8/15 成对计算，使窗口内有 5 次有效探测（覆盖 0～31 秒）。10s 配旧的"每 2 秒 4 次"只会产生**恒 1 次且落在 t=0**——最不可能查到已支付的时刻（算术见 §4.6.1） |
| `tipProbeWindowSec` | **1800** | **T3 的时间界**：`created_at + 该值` 之后，**除本次查单确认已支付外一律置 `expired`**（v1.2：不再限定 outcome 为 0/1，§4.3.1） |
| `tipProbeBatchSize` | 50 | 每 tick 最多核实的订单数 |

> **沿革**：v0.9 的 `tipProbeDeadlineSec` → v1.0 的 `tipProbeMaxCount` → v1.1 的 `tipProbeWindowSec`（值域改对了）→ **v1.2 修正其覆盖面**（从"矩阵里的一行"改为"前置判定"）。
> `tipWxOutboundConcurrency` 已于 v1.0 删除（§4.2.3）。ttl 新增项仍为 4。

一致性校验（违反则启动失败）：

- `tipProbeWindowSec > 0`、`tipProbeMinIntervalSec > 0`、`tipProbeBatchSize > 0`；
- **节奏表最后一档（T+30min）不得晚于 `tipProbeWindowSec`**（否则最后一次定时探测永远等不到就被判过期）；
- **`tipProbeMinIntervalSec` 必须小于客户端退避序列的最小非零间隔**（当前为 2s ⇒ 该值须 ≤2 才能让每次轮询都可能触发；取 3 是有意让 t=2 那次被挡掉、避免紧邻的两次重复上行）。**该约束无法在服务端启动时校验**（客户端节奏不在服务端可见），因此登记为 §4.6.1 的文档级耦合 + §10 的成对测试。

客户端 settling 的**文案超时**（约 31 秒，§7.2）只控制 UI；但其**轮询节奏**与服务端节流值是耦合的（§4.6.1），二者不可独立调整。

---

## 7. 客户端实现

### 7.1 新增页面 `pages-family/support/index`

- 归属 `pages-family` 子包（与 about/privacy 同组），在 `app.json` 的 `subpackages[name=family].pages` 追加 `"support/index"`。
- `index.json` 设 `navigationBarTitleText: "支持 Costra"`（产品 §5.2）。
- 状态机 `idle / paying / settling / done`（产品 §3.3）由页面 data 驱动。**注意这是纯 UI 状态机，与服务端订单状态机无对应关系**——服务端已无 `paying` 态（§5.8）。

### 7.2 新增 service 与支付动作

`miniprogram/services/tipApi.ts` 对齐 `budgetApi.ts`，传给 `request()` 的路径**不重复 `/v1`**（`env.apiBaseUrl` 已含该前缀）：

```ts
fetchProducts(): Promise<TipCatalog>               // GET  /tips/products（无 query 参数）
createOrder(productKey, code): Promise<CreateTipOrderResult>   // v1.1：不再传 devicePlatform
fetchSummary(): Promise<TipSummary>                // GET  /tips/summary
setBadgeHidden(hidden): Promise<void>              // PUT  /tips/summary/badge-visibility
```

API wire DTO 保持 snake_case；`tipApi.ts` 在单一 adapter 中转换成页面使用的 camelCase，并对 `type/status` 做运行时枚举校验。

**客户端支付闸门**（唯一做设备判断的地方，§2.4.3）：

```ts
// utils 或 tipApi 内的纯函数，便于单测
function checkPayEligibility(): { ok: true } | { ok: false; reason: string } {
  // v1.2 第一道：API 可用性双判（canIUse 查基础库能力表，typeof 查运行时实际存在性）
  if (!wx.canIUse('requestVirtualPayment') || typeof wx.requestVirtualPayment !== 'function') {
    return { ok: false, reason: 'wechat_version' };
  }
  const dev = wx.getDeviceInfo();      // platform: 'ios' | 'android' | 'windows' | 'mac' | 'devtools' | 'ohos'
  const base = wx.getAppBaseInfo();    // version: 微信版本号，形如 '8.0.68'
  if (dev.platform === 'devtools') return { ok: false, reason: 'devtools' };
  if (dev.platform === 'ios') {
    // dev.system 形如 'iOS 15.4'，必须先剥平台前缀
    if (!atLeast(stripPlatformPrefix(dev.system), '15')) return { ok: false, reason: 'ios_version' };
    if (!atLeast(base.version, '8.0.68')) return { ok: false, reason: 'wechat_version' };
  }
  return { ok: true };   // Android / 鸿蒙 / Windows / macOS / 未知：一律放行
}
```

- **第一道必须是双判（v1.2 修正 v1.1 的单判）**：官方只给了 iOS 侧的微信版本下限，**没给 Android 侧**；旧版微信上该 API 可能根本不存在，直接调用会抛错，而"点击后失败"正是产品 AC-6 明令禁止的。
  > **为什么 `canIUse` 单独不够**：`wx.canIUse()` 查询的是**基础库**的能力清单，而 `requestVirtualPayment` 的真实门槛在**微信客户端版本**——二者是两条可独立更新的版本线。**旧客户端 + 新基础库**时 `canIUse` 可能返回 `true`，闸门形同虚设。叠加 `typeof` 判定即可覆盖，成本为零。
  > **且 `fail` 回调仍须兜底**：以上两判无法覆盖"API 存在但客户端不支持该能力"的残留情形，`fail` 中对 `errMsg` 含 `not supported` / `function does not exist` 之类的错误做一次文案降级。这不违反 AC-6——AC-6 禁止的是**可前置判定却不前置**。
- **禁止使用 `wx.getSystemInfoSync()`**（官方示例用的是它，但该 API 在当前基础库已废弃）。
- **两个版本号来源格式不同，不能共用未归一化的解析**（v1.1）：`getDeviceInfo().system` 带平台前缀（`'iOS 15.4'` / `'Android 13'`），`getAppBaseInfo().version` 是裸版本号（`'8.0.68'`）。`stripPlatformPrefix()` 需单独单测。
- 版本比较必须逐段数值比较，不能用字符串字典序（`'8.0.9' > '8.0.68'` 会判错）。
- 未知平台一律放行：官方设备路由表覆盖 Android / 鸿蒙 / Windows，禁付的代价是确定性损失用户，放行的代价只是一次失败提示。

支付动作（**无全局 lease、无 `request.ts` 改造、无 pay-claim、无 channel、无 device_platform 上报**）：

1. `await app.bootstrapPromise`，确认会话有效；
2. `checkPayEligibility()`：不通过则**在渲染阶段就置灰档位卡片**并显示对应说明，**绝不允许点击后再报错**（产品 AC-6）；
3. `wx.login → createOrder → 立即 wx.requestVirtualPayment`，中间不插入其他等待；禁止预生成或复用 payData；
4. success：立即进入 settling，**按退避序列 2 / 2 / 4 / 8 / 15 秒拉 summary（共 5 次，累计约 31 秒）**；**只在本单 `out_trade_no` 出现在 `summary.history` 后进入 done**（v1.3 改：原"新权益/次数出现"依赖下单前的 `tip_count` 基线，基线缺失时会误判到账，见 §4.6），提前命中即停止后续轮询。**summary 请求本身就是给服务端的"提前核实"信号**（§4.6），无需额外上报端点；
   > 判据落在纯函数 `isOrderSettled(history, outTradeNo)` 里（`utils/virtualPay.ts`），页面只负责轮询节奏——页面代码在本仓库没有单测载体，判据不外提就等于没有回归。
   > **退避序列不是 UI 偏好，是与服务端节流值成对计算出来的（v1.2，§4.6.1）**：固定"每 2 秒 4 次"配 `tipProbeMinIntervalSec=10s` 时，窗口内**恒只有 t=0 一次**能触发服务端探测，而那一刻微信侧订单极可能仍未支付 ⇒ 加速核实近似失效、§5.8 删除 pay-claim 的前提不成立。当前序列配 3s 节流可得 **5 次有效探测（t=0/4/8/16/31）**。
   > **改动本序列必须回到 §4.6.1 重算，并复核 §5.8。**
5. fail：静默回 `idle`（用户取消）或显示单行提示（其他错误）；
6. 签名类失败丢弃 payData，允许用户重新创建订单，绝不重放旧请求。

### 7.3 mine 页入口横幅

- `pages/mine/index.wxml`：在 `.overview` 与 `.menu` 之间插入独立 `.support-banner`，不复用 menu 结构。
- 为满足产品「与宏观数据总览同一数据源下发、不单独请求」，扩展现有 `GET /users/me/overview`，固定增加 `tip_entry_visible / supporter_badge / badge_hidden / tip_count / support_score`（均由 §3.4 派生 + `users.tip_badge_hidden`）。`tip_entry_visible = (WX_PAY_MODE === 'on') || user ∈ testUserIds || EXISTS(已结算订单)`，保证停购后已支持用户仍能查看历史。UI 用 `supporter_badge && !badge_hidden` 判定头像徽章，不混淆"拥有"与"可见"。
  > **overview 侧只做一次聚合查询（v1.1）**：本期 `entitlement_keys` 只有 `supporter_badge` 一个 key 且每笔订单都带它，因此 `supporter_badge = (tip_count > 0)`、`tip_entry_visible` 的 `EXISTS` 分量同样 `= (tip_count > 0)`——三者可由 §3.4 的那条聚合查询一次得出，**不需要再跑一次 `EXISTS`**。overview 是 mine 页每次进入都打的高频端点，而生产是 2核4G 单进程，省一次查询是实打实的。**该聚合同样须带 `delivered_at IS NOT NULL`**（v1.2，§3.4）。
  > **但 `/tips/summary` 仍用通用的 `EXISTS` 派生**（§3.4），因为它要输出 `entitlements[]` 明细、且未来皮肤会引入第二个 key。这里做的是"高频端点上的特化"，不是把通用逻辑改窄——两处共用同一张表、同一个 `$settledStatuses`，特化处需注释说明其成立前提（单一 key），皮肤上线时同步复核。
- **`userOverviewApi` 的 userId 分区缓存改造不在本方案范围内**。若「无 userId 单值缓存 + 旧请求跨账号回填」的缺陷成立，它**今天就已经会导致跨账号串号展示总收支**，属既有缺陷，应拆独立 issue 修复，不绑进 tips PR。tips 只在该缺陷修复后复用其结果；在此之前，付费字段与既有 overview 字段承担同等风险，不额外加固。
- `GET /users/me/overview` 的 access-only 由 B0 的 12 处替换统一提供（与 tips 并行，§4.0）。
- mine 页仅在 `tip_entry_visible=true` 时展示横幅。赞赏页用 `/tips/summary` 获取明细；完成发货或修改徽章可见性后发 `TIP_SUMMARY_UPDATED`，mine 页按 eventBus 生命周期约定订阅并刷新 overview。

### 7.4 KNOWN_SERVER_CODES 同步

`request.ts` 的 `KNOWN_SERVER_CODES` 需补入 `PAYMENT_PRODUCT_INVALID`，否则新错误码会被守卫逻辑视为未知、走 `CLIENT_HTTP_xxx` 分支。

### 7.5 商品缓存、eventBus 与本地重置

- `tipApi` 持久化最后成功的**商品公共字段**，不保存 `purchasable`；联网成功后覆盖，离线回退时强制不可购买。**v1.0 起缓存不再按 channel 分键**（目录无渠道维度）。
- 持久化缓存由 logout 的 `clearAllForReset()` 全量清除；若 `tipApi` 另有模块级内存镜像，则导出 `clearTipCatalogCache()` 并在 `localReset.ts` 登记（微信运行时不支持动态 `import()`，模块级缓存必须显式登记）。
- 权益不走 `SYNC_DONE`；赞赏页状态变化时发 `TIP_SUMMARY_UPDATED`，订阅者按 onLoad/onUnload 成对管理。

---

## 8. 安全与合规（技术侧硬项）

| 项 | 落地 |
|---|---|
| **主体路径** | **虚拟支付：个人**。只做道具直购、**不得引入任何代币/余额结构**（官方对个人主体的明文限制）；企业版的代币族接口一律不接（§0.0.1） |
| 鉴权强度 | **B0**：全部用户端点统一 access-only（共享 `requireUserId`，三行 `token_type` 判定），修复 refresh token 可调用用户 API 的既有洞。**tips 的支付边界不依赖它**（下一行才是），故 B0 与 tips 并行（§4.0） |
| 支付身份绑定 | `code2Session.openid === users.wx_openid` 是**唯一且充分**的支付闸门，覆盖 GM 代登、账号错绑与 token 盗用（§4.1.1） |
| 密钥不入日志 | AppKey / sessionKey / access_token 全程不打印；URL 脱敏须先完成 E2；原始回调 body 不长期落盘 |
| signData 一致性 | 一次 stringify，签名与下发复用同一字符串；字段集合严格为官方 8 项（**其中不含任何渠道字段**） |
| webhook 传输层 | 必须注册 `addContentTypeParser`（XML/text → buffer）；body 上限 64KB + 解析超时；`GET` 握手回包须限 `text/plain` + `nosniff` + 长度 128 + 字符集白名单（§4.2.0）；XML 解析器禁 DTD/外部实体、限深度与节点数（§4.2.2） |
| webhook 信任 | `authenticated` 只影响日志分级；发放凭证只能是 `query_order` |
| 纵深核实 | **硬阻断三项**（`order_id` / `order_fee` / `wx_order_id` 漂移或跨单占用）；`env_type` / `biz_meta` / `order_type` / `Quantity` / `ProductId` 为弱证据，只告警不阻断（§4.3.1）。⚠️ `order_fee` 的 Apple 渠道表现为**待证实风险 R1**，按原样实现、B13 验证（§4.3.2） |
| 幂等 | `out_trade_no` 行锁 + 条件 UPDATE + 行数断言；权益派生使幂等退化为单条 SQL 的原子性；与官方建议的偏离及提审口径见 §5.7 |
| 事务边界 | 所有微信网络请求在 DB 事务外；`settleOrder` 只锁 `tip_orders` 单行，不触碰核心表 |
| 资源有界 | 探测有硬性时间界（**`created_at + 30 分钟` ⇒ 除已确认支付外一律 `expired`**，与 outcome、探测次数、触发来源均无关，§3.3 / §4.3.1）；每 tick ≤50 单；加速探测受**每订单** `tipProbeMinIntervalSec` 节流；**summary 每次请求只 probe 最近一单**（§4.6，防 20× 配额放大）；用户日限 20 单；未知订单不查微信 |
| 金额单位 | 全程"分"，目录与订单双快照；用 `order_fee` 核对标价，不以 `paid_fee` 误判优惠 |
| `env=0` 固定 | 服务端常量，不接受客户端输入；`env_type` 回显只作日志参考 |
| openid 最小暴露 | 只存订单服务端快照，不进入客户端响应或业务日志 |
| 非代币化 | entitlement 只有装饰性权益；**支持度无充值入口、无消费兑换出口、无转让提现**（产品 §1.2 P1 的实际判据）。支持度与价格存在固定倍率是**已知且被接受**的，不作为风险项；表达纪律由 AC-11 覆盖 |
| 灰度开关 | 单一 `WX_PAY_MODE = off \| allowlist \| on`（§2.5），非法组合不可表示 |
| 告知义务 | 费率、结算周期、退款规则、月限额四项按官方部署清单实际展示（产品 §7.3）。**本期不做退款功能不影响该告知义务**（§5.5.3） |

真单 allowlist 只允许正常微信登录产生、可通过 openid 绑定的测试账号；不得使用 GM impersonation（它会被 §4.1.1 直接拒绝），也不把支付路由放进 `GM_ONLY`。

---

## 9. ErrorCode 增量（四处同步铁律）

**只新增 1 条**，必须**同步四处**：`ErrorCode.ts` 三张表 + `docs/api/error-codes.md` + `server/api/openapi.yaml` + 客户端 `request.ts` `KNOWN_SERVER_CODES`。

| Code | HTTP | RetryStrategy | LogLevel | 语义 |
|---|---|---|---|---|
| `PAYMENT_PRODUCT_INVALID` | 400 | none | warn | 下单 `product_key` 不在目录（客户端目录过期或伪造） |

复用既有 code：

| 场景 | 复用 | 载体 |
|---|---|---|
| 服务端签名内部失败 | `INTERNAL` | `details.stage='sign'` |
| `WX_PAY_MODE=off` 或 allowlist 未命中 | `BUSINESS_RULE_VIOLATION` | `details.reason='payment_disabled'` |
| openid 与 JWT 用户不一致 | `PERMISSION_DENIED` | `details.reason='payment_identity_mismatch'` |
| refresh token 调用用户端点（B0） | `UNAUTHENTICATED` | 沿用既有语义，无需新 code |

> **v1.0 删除 `details.reason='ios_iap_unavailable'`**：渠道概念已从服务端移除（§2.4.2），iOS 的可用性由客户端闸门表达，服务端不再有"渠道未开通"这一状态。

- `PAYMENT_PRODUCT_INVALID` 保留的理由：客户端需要**特有恢复动作**——重新 `fetchProducts()` 刷新目录后再试。
- `assertErrorCodeCoverage` 会在漏填任一表时启动失败。

---

## 10. 测试策略

| 层 | 必测行为 | 载体 |
|---|---|---|
| **B0 鉴权** | 每个路由族用 refresh token 调用返回 401；access token 正常；**`/auth/refresh` 与 `/auth/logout` 仍接受 refresh_token（防回归）**；`gm.ts` 的 is_gm 判定未被削弱。**该组随 B0 独立 PR 交付，不阻塞 tips**（§4.0） | vitest + pg-mem |
| 两套 HMAC | 官方公开向量；signData 一次 stringify；**字段恰为官方 8 项且不含任何渠道/设备字段** | vitest 纯函数 |
| **支付身份** | openid 与 JWT 用户一致才落单；**GM `user_id` 代登他人、GM `create_fake`、token 跨账号使用三种场景全部返回 `PERMISSION_DENIED`**；GM 代登自己允许支付 | vitest + pg-mem |
| **客户端闸门（v1.2 改写）** | **`canIUse` 为 false 时置灰且不调起**（含 Android）；**`canIUse` 为 true 但 `typeof wx.requestVirtualPayment !== 'function'` 时同样置灰**（v1.2 双判回归：旧客户端 + 新基础库）；开发者工具禁付；**iOS 系统 <15 或微信 <8.0.68 时档位置灰且不调起支付**；iOS 达标可支付；**Android / 鸿蒙 / Windows / macOS / 未知平台一律可支付**（防回退到 v0.7 的默认禁付）；**版本比较逐段数值（`8.0.9` 不得被判为 ≥ `8.0.68`）**；**`stripPlatformPrefix('iOS 15.4') === '15.4'`** | miniapp vitest |
| **无渠道维度（防回退）** | `GET /tips/products` **不接受任何 query 参数**；下单 body 含 `channel` **或 `device_platform`** 时被 AJV `additionalProperties:false` 拒绝；目录响应无 `channel` 字段；**表中不存在 `channel` / `device_platform` 列，`upstream_order_type` 落原值**（v1.1） | server + miniapp vitest |
| **tips validator 刚性（v1.3 补）** | `badge_hidden: "true"` / `1` **返回 400 而非被强转**（`coerceTypes: false`：与"契约外输入一律 400"同向；开着强转等于给回退留口子），且非法请求不产生任何写入 | server vitest |
| **B2 发布闸门（v1.3 补）** | `wx_product_id` 带 `TODO_B2_` 前缀时 `assertTipProductsPublishable()` 抛错并点名档位，`WX_PAY_MODE !== 'off'` 时进程入口拒绝启动；全部回填后放行；`enabled=false` 的占位不阻塞 | server vitest |
| 商品契约 | `purchasable` 单一开关，随 `WX_PAY_MODE` 三态正确变化；allowlist 命中/未命中 | server vitest |
| migration | 新 migration 连续编号；同一 SQL 连跑两次均成功（含 `ADD COLUMN IF NOT EXISTS`）；reset 删除 `tip_orders`；**`status` CHECK 恰为四态且不含 `unresolved`**；`upstream_order_type` 列可空；**`idx_tip_orders_probe_due` 在 pg-mem 侧被跳过**（§3.5） | **CHECK 与索引两项只能静态断言生产 SQL 文件**（`test/setup.ts` 的 pg-mem 建表刻意不带任何 CHECK ⇒ pg-mem 侧测不到）；其余 pg-mem |
| **webhook 传输层** | **XML body 能被完整读到**（`text/xml` / `application/xml` / `text/plain` 均可，防 Fastify 默认 parser 导致空 body）；**`GET` 握手原样回 echostr 且为纯文本**（无引号无 JSON 包裹、`Content-Type: text/plain`、带 `nosniff`）；**echostr 超 128 字符或含非白名单字符时返回 `success` 而非回显**（v1.2）；超 body 上限被拒 | vitest + HTTP route |
| webhook 解码 | XML 解析安全（禁 DTD 与实体、深度节点上限、非法编码拒绝）；**成功回包逐字节等于 `<xml><ErrCode>0</ErrCode><ErrMsg><![CDATA[success]]></ErrMsg></xml>`**；未知事件返成功；未知订单不触发查单；**退款事件只 warn + 成功回包，不改账**；**iOS 退款问询只 info + 成功回包，不应答裁决** | vitest + HTTP route |
| `query_order` | URL/token/pay_sig 与字段映射；**status 0~10 全枚举各产出正确 decision（尤其 7 不进入重试、9/10 不改状态）**；三种 trigger 矩阵；**`order_type` 原值落入 `upstream_order_type`，未知取值同样落原值而非 NULL**（v1.1） | vitest mock fetch + pg-mem |
| **校验分级** | `order_id` / `order_fee` / `wx_order_id` 不符 ⇒ `conflict` 且**不发放**；**`env_type=2`、`biz_meta` 不符、`order_type` 不符、`Quantity≠1`、`ProductId` 不符 ⇒ 照常发放且产生 warn**（防回退到硬阻断） | vitest + pg-mem |
| access_token | 普通 body=false、失效强刷 body=true；并发单飞；业务请求最多重试一次 | vitest mock fetch |
| 结算 | 重复调用只计一次；条件 UPDATE 行数断言；终态守卫；**事务内不出现 `users` 表的 `FOR UPDATE`**（防回退）；**同一单 `wx_order_id` 漂移（本地已记 A、上游报 B）⇒ `order-id-drift` + error 告警且一个字段都不改**（v1.3：`backfillPlatformIds` 的 `COALESCE` 会静默保留 A ⇒ 不显式阻断就等于把账实错乱吞掉） | vitest + pg-mem |
| **order_type 原值全路径（v1.3 补）** | 不只 `settle`：`mark_refunded` / `mark_expired` / `manual_conflict` / `keep_current` / `schedule_probe` / `retry` 六条路径同样把 `order.order_type` 原值落 `upstream_order_type`（决策统一携带 `snapshot`，执行层用 `decisionSnapshot()` 取）。**它是 R1（Apple 价格档映射）唯一的渠道归因依据，任一路径写 NULL 都削弱取证面** | vitest + pg-mem |
| **权益派生** | 徽章/次数/支持度与订单一致；`$settledStatuses = {'delivered','refunded'}` 固定常量正确；`expired` 不计入；**`created → refunded`（未发货即退款）不计入 `tip_count` / `support_score`，且不污染 `granted_at`**（v1.2 `delivered_at IS NOT NULL` 回归）；未来皮肤 key 用同一段派生逻辑；**`entitlements[]` 明细由 `deriveEntitlements` 的 JS 侧聚合产出，同一 key 多单取 `MIN(delivered_at)`**（v1.3：`$2 = ANY(...)` 只适用于单点判定已知 key，见 §3.4） | vitest + pg-mem |
| **支持度口径** | `support_score` = 已结算订单 `support_delta` 之和，**取自订单快照而非按 `price_cents` 计算**（防止有人"优化"成价格函数）；**目录改价后历史订单的支持度不变** | vitest + pg-mem |
| **探测有界（T3，v1.2 改写为全枚举）** | **窗口外的每一种 outcome 各一条用例**：`unpaid 0/1` / `unknown` / `transient_error` / `conflict` / `unrelated 9/10` / `refund_failed 7` **全部收敛为 `expired` 并不再产生任何上行**（P0-A 回归——v1.1 只有第一种会收敛）；**唯独 `paid 2/3/4` 穿透窗口正常 `settle`**；**窗口内无论被加速探测多少次都不得 `expired`**（P0-1 回归：连续 10 次 summary probe 后订单仍须为 `created`）；**`expired` 后收到 paid 推送 ⇒ `manual_conflict` + error 告警，且不静默丢货** | vitest + pg-mem |
| **scheduler（v1.2 补）** | claim 事务在 fetch 前提交；`probe_count` 推出的节奏正确（2/5/10/30 分钟）；**`probe_count >= 4` 时 `next_probe_at` 被写为 `created_at + tipProbeWindowSec + 1s`，且该订单在下一 tick 被判 `expired` 后不再入队**（P0-A 回归：断言连续 5 个 tick 内该订单的 `query_order` 调用次数 ≤1，防忙轮询）；窗口内的 0/1 不 expired，随后变 2/3/4 仍正常发货；重启续跑；**只有一类候选**；**claim 不使用 `SKIP LOCKED`**；**加速探测不改变 `probe_count` 与 `next_probe_at`** | vitest + pg-mem |
| **summary 加速核实（v1.2 改写，含算术回归）** | **下单后立刻（`next_probe_at` 尚在未来）调用 summary 即可触发一次 probe**（P0-2 回归：这是 §5.8 删除 pay-claim 的前提）；**按客户端退避序列 t=0/2/4/8/16/31 依次请求时，实际触发 probe 的次数为 5 次**（P0-B 回归：`tipProbeMinIntervalSec=3` 下只有 t=2 被挡；若有人把节流改回 10s 该用例必须失败）；**同一用户有 5 张 10 分钟内的 `created` 单时，一次 summary 只产生 1 次微信出站**（防 20× 放大器）；**响应不等待微信 RTT**；触发后 `probe_count` 不变 | vitest + pg-mem |
| 重复购买 | 同用户连续两单均成功创建并各自结算；徽章派生仍为单一存在；次数累加两次 | vitest + pg-mem |
| env 解析 | 非法 `WX_PAY_MODE` 启动失败；**不存在 `WX_PAY_WEBHOOK_CODEC` / `WX_PAY_QUERY_ORDER_URL` / `WX_STABLE_TOKEN_URL` 三个环境变量**（v1.2 防回退）；`allowlist` 模式下非名单用户 `purchasable=false` 且下单被拒 | vitest |
| 客户端 | 商品缓存只展示不支付；success 不直接 done；签名失败后可重新下单；**缓存不按 channel 分键**；**settling 轮询为退避序列而非固定 2s**（v1.2，与 §4.6.1 成对）；**`isOrderSettled`：历史里只有旧单时必须为 `false`**（v1.3 AC-4 回归——按 `tip_count>基线` 的旧判据在基线缺失时会误判到账）；**`out_trade_no` 经 adapter 透传** | miniapp vitest |
| 并发结算 | 两路同时处理同一 out_trade_no | pg-mem 无真实锁语义，登记已接受风险 |

---

## 11. 工作量估算（人天，粗估）

### 11.1 单阶段交付（含 iOS，可一次上线）

| 模块 | 人天 | 说明 |
|---|---:|---|
| B0 access-only 收敛 | 1 | 15 行 helper + 12 处替换 + 回归用例（**独立 PR，与 tips 并行**，§4.0） |
| env（mode 解析）、签名、access_token、脱敏扩展 | 2.5 | stable_token 单飞、E1/E2 既有代码改造 |
| migration + repositories + pg-mem | 1.5 | 一张表 + users 一列、派生查询、单类补偿游标 |
| 下单与身份绑定 | 1.5 | code2Session、openid 绑定、限频、静态目录（**无渠道分支**） |
| **webhook 传输层 + XML 解码 + 业务 handler + 结算** | **3** | 含新增 XML 解析依赖及其供应链评审与安全配置（**v1.2：格式已确定为 XML，不再是区间**）、`addContentTypeParser`、`GET` 握手及其回显约束 |
| query_order（全枚举 + 两级校验）+ 单候选 scheduler | 2 | 无平台 ack、无退款核对、无 semaphore |
| products / summary（含加速核实）/ overview 字段 / visibility | 1.5 | 派生查询；overview 缓存改造已移出 |
| 小程序 service / adapter / 缓存 / 页面 / 横幅 / 闸门 | 3 | 无 lease、无 request.ts 改造、无 pay-claim、无 channel |
| 徽章视觉资产 | 1.5 ～ 2.5 | 依赖 UI 出稿，**可并行**。产品 Q6 仍在产出中且需验证 28rpx 小尺寸可读性 ⇒ 上界含方向 A 被否后重做一轮 |
| OpenAPI、ErrorCode、单测与集成测试 | **4** | **v1.2 上修（原 2.5 不现实）**：§10 已有 22 行测试矩阵，其中 status 0~10 全枚举 × 3 trigger、窗口外 6 种 outcome 各一条、校验分级双向防回退、退避序列算术回归、pg-mem 索引跳过等都是逐条构造的用例 |
| **B13 真单联调** | **1** | **v1.2 独立成行（原隐含在上一行）**：真单支付、推送报文捕获、**手工制造 webhook 丢失以验证加速核实**、iOS 真单（R1）、报文脱敏固化 fixture |
| **iOS 增量** | **0.5** | 仅客户端版本闸门扩展。**平台自动路由、道具双端互通 ⇒ 服务端零改动**（真单验证已计入 B13 行） |
| **小计** | **约 16～19** | 不含 MP 审核等待、道具配置和产品文案审批 |

> **v1.2 为什么把 13～15 上修到 16～19**（三笔，均为**登记遗漏**而非范围扩大）：
>
> | 调整 | 幅度 | 原因 |
> |---|---:|---|
> | 测试行 2.5 → 4 | +1.5 | §10 的矩阵在 v1.0～v1.2 持续加行（尤其 v1.2 的全枚举回归），但估算行一直没动 |
> | B13 独立成行 | +1 | 真单联调此前隐含在"测试与真单回归"里，而它包含手工故障注入与 iOS 真单，不是写单测的同一件事 |
> | 徽章行给出上界 | +0～1 | 产品 Q6 未定稿，方向 A 需验证小尺寸可读性 |
> | webhook 行 2～3.5 → 3 | 区间消失 | 格式已确定为 XML（§4.2.1），XML 依赖成本必然发生 ⇒ 取确定值 |
>
> **注意这不是"又要多花 3 人天"**：v1.1 的 13～15 里那部分工作本来就要做，只是没被计入。按 §0.3 的 D2 纪律，估算也必须可核算。

> **沿革**：v0.5 估 37～40（含大量未证实协议的双分支预案）；v0.6 逐项核算 27～30；v0.7 删五类过度设计后 22～25；v0.8/v0.9 两阶段合计 21～25；v1.0/v1.1 单阶段 13～15（**低估**）；**v1.2 修正为 16～19**。
>
> **五条安全不变量一条未减**：T1/T2/T3、openid 绑定、校验分级全部保留。减掉的都是"为未验证假设预留的分支"和"没有消费者的机制"。

---

## 12. 开工与上线前置

| # | 阶段 | 事项 | 清零标准 |
|---|---|---|---|
| **B0** | **开工（独立 PR，与 tips 并行）** | **§4.0 用户端点 access-only 收敛** | 15 行共享 helper + 12 处替换完成；refresh token 调用用户 API 返回 401、`/auth/refresh` 不受影响两类回归用例通过。**v1.2 取消其对 tips 的时序前置**：tips 的支付边界是 openid 绑定，B0 对 tips 的安全增益≈0（§4.0）。`requireUser.ts` 随先合入的那一方落地 |
| B1 | 开工 | 虚拟支付能力、OfferID、现网 AppKey 已取得 | **走「虚拟支付：个人」开通流程**（开放平台【支付与交易 → 虚拟支付】）；沙箱/现网资产明确且不混用 |
| B2 | 开工 | 三档道具建立并发布 | `wx_product_id + price_cents` 双人逐档核对。**只需核对一套**——道具双端互通，无需分端配置（§2.4.1）。**v1.3：清零由机器把关**——目录中未回填的 `wx_product_id` 带 `TODO_B2_` 前缀，`assertTipProductsPublishable()` 在 `WX_PAY_MODE !== 'off'` 时**拒绝进程启动**（占位 ID 与后台不一致 ⇒ 每笔真单下单即失败，这类事实不靠"记得看清单"） |
| **B3** | **开工** | **iOS IAP 开通** | ① MP 后台【虚拟支付 → 基础配置】**配置小程序简称**（Apple 支付需展示 display name）；② 基本配置中开通苹果 IAP；③ 客户端闸门实现 `canIUse` + `typeof` 双判 + iOS ≥ 15 + 微信 ≥ 8.0.68（用 `getDeviceInfo`/`getAppBaseInfo`，剥平台前缀后逐段数值比较） |
| B4 | 开工 | migration 取号 | **已核实当前最后为 `0019`**；合入时再确认一次，SQL 可重跑两次 |
| **B5** | **开工（普通配置动作，非闸门）** | **发货推送 URL 配置** | MP 后台【虚拟支付 → 基本配置 → 发货推送配置】填 `https://costra.cloud/v1/tips/notify` 并保存成功。**v1.2 取消其 Day 0 闸门地位**：推送格式是官方文档已明确的事实（XML），该配置项没有格式选项（§4.2.1）。**顺手记录保存时是否触发 `GET` 握手及其 query 形态**，用于决定 §4.2.0 的握手实现在后续版本中保留或删除 |
| B6 | 上线 | `about` / `privacy` 先发布 | 免费边界、订单信息和留存说明已更新 |
| B7 | 上线 | 支付相关文案与视觉完成 | 退款说明、徽章资产、异常文案通过评审 |
| B8 | 上线 | ~~告知义务口径冲突~~ **已定稿** | 产品 §7.3：费率、结算周期、退款规则、月限额四项均在赞赏页说明尾与 `privacy` 告知。**不因"本期不做退款功能"而削减告知**（§5.5.3）。剩余动作 = 文案落地 |
| B10 | 开工 | stable_token 联通 | 生产固定 IP 已按需加入白名单；token 获取与强刷成功 |
| ~~B11~~ | — | ~~支持度数值口径~~ **已定稿** | 保留数值支持度与 10/99/1874 映射。技术侧唯一须守住：**`support_score` 由订单快照 `support_delta` 聚合，禁止按 `price_cents` 计算**（§3.4），已加测试用例 |
| ~~B12~~ | — | ~~退款展示口径~~ **已定稿** | `$settledStatuses = {'delivered','refunded'}` 固定常量（退款不回冲）。本期不实现退款逻辑（§3.4 / §5.5） |
| **B13** | **上线灰度与真单验证** | 灰度、真单验证与对账演练 | ① 先 `WX_PAY_MODE=off` 部署；② 切 `allowlist` 仅对 `WX_PAY_TEST_USER_IDS` 开真单；③ **必测项**：推送实际 method/Content-Type/**原始 body 确为 XML**、**成功回包（§4.2.1 的 XML 常量）被平台接受不再重试**、`OutTradeNo`/`MchOrderNo` 映射闭合、`query_order` 的 `env_type`/`order_type`/`biz_meta` **实际取值记录在案**（验证 §4.3.1 降级判断）、账单金额一致；④ **iOS 真单验证 R1**：用一笔 **¥9.9 的 iOS 单**核对 `order_fee` 是否等于 `price_cents`（§4.3.2），并记录 `order_type` 实际值与 `upstream_order_type` 落库是否为原值；⑤ **确认 ¥1 档在 iOS 可下单**（Apple 最低支付金额 1 元，边界是 `>=` 还是 `>`）；⑥ **验证 webhook 丢失场景下 summary 加速探测确实生效**（P0-B 回归：断开推送后按客户端退避节奏轮询 summary，权益应在**十几秒内**到账，而非 T+2min）；⑦ 报文脱敏后固化为 fixture 并删原始载荷；⑧ 切 `on` 之前**补一笔 ¥187.4 真单**做最终确认（金额最大档、结算周期最长，作为放量前的收尾单）；⑨ 全链路覆盖后才切 `WX_PAY_MODE=on` |

> **v1.2 把 R1 的验证金额由 ¥187.4 改为 ¥9.9**：R1 要证伪的是"微信对 iOS 单是否做 Apple 价格档映射"。**¥9.9 与 ¥187.4 同样不落在 Apple 中国区的整档价上，证伪能力完全等价**，而成本相差 19 倍——且 iOS 侧结算周期 45~60 天、抽成 12%，大额真单的占款与损耗都不小；若 R1 被证实还要改完再验一次。¥187.4 档保留为第 ⑧ 步放量前的确认单，此时代码已定型，只需跑通一笔。

> B9（回调协议 spike）已取消并入 B13。原 B5（支付身份策略）已并入 §4.1.1，编号 B5 在 v1.0 被复用于发货推送配置；**v1.1 曾将其提前为 Day 0 闸门，v1.2 取消该闸门地位**（§4.2.1）。
>
> **`notify_provide_goods` 的实测已从 B13 移除**：官方明说推送回包成功即无需调用（§5.3），实测本身是多余动作。
>
> **B13 已是唯一的"必须靠真单"清单**（纪律 D3）：其中只有 R1、**R2（iOS 系统版本门槛，v1.3 新增）**与 ¥1 档 iOS 边界三项属于真正无法靠读文档或查仓库消除的不确定性——R2 与 ¥1 档同源（二者均来自企业版页面，个人版原文两项都没提），详见 `docs/testing/tips-known-limits.md` §1。

---

## 13. 明确不做（技术侧 Non-Goals）

**主体路径相关（v1.0 新增，见 §0.0.1）**：

- **引入任何代币 / 余额 / 充值结构**——官方对个人主体的明文限制，且与产品反代币边界一致。
- 接入企业版商户管理接口族（代币充值扣减、道具批量上传发布、账单下载、提现 API、广告金、投诉处理）——这些不属于个人主体路径。
- 把企业版的**资质与商业条款**结论迁移到个人主体（费率、限额、可用接口清单一律以个人版为准，§0.0.2）。

**架构与实现**：

- 落库 `session_key`。
- 建商品管理后台或 `tip_products` 表；静态目录替代，但 API 已含 `type` 与 `entitlement_keys`。
- **建权益表或偏好表**：徽章/次数/支持度一律派生；唯一的偏好 boolean 落 `users` 一列。
- **在协议或数据模型中引入"支付渠道"维度**（§2.4.2）：signData 无渠道字段、道具双端互通、平台自动路由；**v1.1 起连语义化的 `channel` 列也不存**，只落 `upstream_order_type` 原值。
- **落库客户端上报的 `device_platform`**（v1.1）：服务端从不读、不可信、无唯一消费者。
- **让加速探测（webhook / summary）消耗 scheduler 的节奏游标 `probe_count`，或给它加 `next_probe_at` 条件**（v1.1 P0-1 / P0-2）：前者会让正常订单被提前判 `expired`，后者会让下单后 120 秒内的加速核实恒失败。
- **用探测次数而非时间窗口表达 T3**（v1.1，§3.3）。
- **把 T3 写成 decision 矩阵里的一行而非前置判定**（v1.2 P0-A，§4.3.1）：那样只有 `unpaid 0/1` 会收敛，`retry` / `manual_conflict` / `keep_current` 三类订单永久驻留补偿队列并每 tick 告警。
- **让 `tipProbeMinIntervalSec` 与客户端轮询节奏各自独立调整**（v1.2 P0-B，§4.6.1）：二者相乘才决定"窗口内实际触发几次探测"，单独改任一侧都会让加速核实失效。
- **让 `GET /tips/summary` 遍历用户的全部 `created` 单做 probe**（v1.2，§4.6）：日限 20 单 ⇒ 一次合规 GET 会放大成最多 20 次微信出站；每次只 probe 最近一单。
- **只用 `wx.canIUse` 单判虚拟支付可用性**（v1.2，§2.4.3）：`canIUse` 查基础库能力表，而真实门槛在微信客户端版本，旧客户端 + 新基础库时闸门失效。
- 客户端直连或代理 `query_order`；客户端只读我方 summary。
- **实现任何退款业务逻辑**：不接退款处理、不做权益回冲、不做周期核对、不提供应用内退款入口、不自动应答 iOS 退款问询（§5.5）。
- 服务端相信客户端 platform/version 或前端 success 来发货。
- **为"上报支付结果"单设端点**（summary 已承担该信号，§5.8）。
- 离线下单、预生成全部档位 payData、复用旧 payData。
- 把任一平台订单号当成业务幂等键，或把不同订单号字段写进同一列。
- 在数据库事务中等待微信网络请求。
- **在 `settleOrder` 中锁 `users` 行**（本事务不读写 user 维度数据，锁它只扩散死锁面，§4.4）。
- 为 webhook 复用客户端 JSON `errorHandler`；回调 IP 白名单。
- 为支付身份新增 token claim（openid 绑定已充分且更强，§4.1.1）。
- 建全局 `wx.login` 串行器（防的是可自愈失败，§5.2）。
- **把我方常量的回显（`env_type` / `biz_meta`）或可扩展枚举（`order_type`）做成发放前的硬阻断**（§4.3.1）。
- **实现任何"平台发货确认"状态机**（官方明说推送回包成功即无需调用，§5.3）。
- 无界探测：任何订单都不得永久驻留补偿队列。
- 禁止重复购买 / 活动单复签 / 跨档位 pending 拒绝。
- 默认禁止鸿蒙 / 桌面端 / 未知平台支付（官方路由表明确它们走微信支付，§2.4）。
- **在 claim 中使用 `FOR UPDATE SKIP LOCKED`**（advisory lock 已互斥，pg-mem 不支持，§6.1）。
- 为微信出站调用加全局并发 semaphore（日订单个位数，§4.2.3）。
- **为 webhook 请求格式保留多实现分支或配置项**（v1.2，§4.2.1）：官方文档已明确为 XML，该"三选一"是被误移植的另一个入口的形态。
- **为恒定的回包常量保留 codec 方法，或为单一实现声明 codec interface**（§4.2.2）。
- **把微信官方 API 域名做成环境变量**（v1.2，§2.5）：不是部署差异项，且 `_fetch` 可注入已满足测试需要。
- **把 B0 设为 tips 的时序前置**（v1.2，§4.0）：tips 的支付边界是 openid 绑定，B0 对 tips 的安全增益≈0。
- 在 tips PR 内顺手改造 `userOverviewApi` 的既有缓存缺陷（§7.3）。
- **为可在官方文档或仓库中查证的事项登记"待验证"并预留分支**（v1.2 纪律 D3，§0.3）。
- 赞赏解锁功能、积分消费、转让、兑换或与皮肤挂钩。

---

## 14. 修订记录

| 版本 | 日期 | 变更 |
|---|---|---|
| v0.1 | 2026-09-03 | 首版。两套 HMAC 与 signData 逐字节一致、下单当场 wx.login 不落库 session_key、推送(主)+查单(兜底)、单一发放出口、静态商品目录、pg-mem 并发风险标注 |
| v0.2 | 2026-09-03 | signData 剔除 `platform`；补 pay-claim 解决 `paying` 不可达；notify 验签分支预案；23505 表述修正；日限 20 单；openapi 同步。≈25.5 人天 |
| v0.3 | 2026-09-03 | pay-claim 路径统一 `outTradeNo`；结算终态守卫 + 行数断言；登记 B8 |
| v0.4 | 2026-09-03 | 【阻塞】`query_order` 必须带 `access_token`（新增 stable_token 管理器）；【阻塞】推送验签改走消息推送配置；幂等锚正名 `out_trade_no`；新增 `abandoned` 与探测预算；ErrorCode 3→1；纠正 `-15005` 因果链。≈29 人天 |
| v0.5 | 2026-09-03 | 撤回 JSON+安全模式定稿，B9 升为 coding gate；新增平台确认队列；四类订单号分列；access-only 与 openid 绑定；`abandoned` 与 0/1 不按时间过期；通用 entitlement grants；B11/B12 登记。≈37～40 人天 |
| v0.6 | 2026-09-04 | 四轮评审：修四阻塞（平台 ack 判据错位 / `order.status` 枚举缺失 / cold-probe 无界 / refresh token 越权面被局部化）与四严重（删禁购分支、lease 死锁、B9 取消、退款核对收窄）；新增 §0.1 删除清单。≈27～30 人天 |
| v0.7 | 2026-09-04 | 去过度设计。删除平台确认延迟校验队列、`user_entitlement_grants` + `user_support_profiles` 两表（改派生）、全局 `withWxSessionLease()` + `noAuthRetry`、`impersonated_by` claim 全链路；B0 收敛为最小 diff。≈22～25 人天 |
| **v0.8** | **2026-09-04** | **对照官方个人版文档逐条复核 + 切片交付定稿。核心变化是把「按推断先写代码」改为「先拿真单再决定做不做」。**<br>**【P0 修正 · 4 项】**<br>**① 校验分级（防"钱收了不发货"）**：v0.7 把 `env_type` / `biz_meta` 与 `order_id` / `order_fee` 同列为硬阻断。前两者只是**我方常量的回显**，对资金安全零贡献，而一旦官方在个人主体下的语义与企业版文档有出入，后果是**每一笔真单都不发货**。现收敛为硬阻断三项（`order_id` / `order_fee` / `wx_order_id` 漂移）+ 弱证据五项（`env_type` / `biz_meta` / `order_type` / `Quantity` / `ProductId`，只告警）。`conflict.reason` 联合类型 6 → 3。<br>**② 删除 `platform_delivery` 全套**：官方个人版页面**通篇没有 `notify_provide_goods`**，兜底路径原文只有「查单→发货」；v0.7 把企业版接口页的结论套到了个人主体上，且说不出"不调用的后果"。三列 + 1 索引 + scheduler 候选 B + 2 配置 + §4.3.2 整节 + `delivery_reconcile` trigger 全删，移入第二阶段并以实测为前提（实测不可用即永久删除，无 fallback）。<br>**③ 退款推送通道列为待实测**：官方只说"退款成功会收到 `xpay_refund_notify`"，**没说走哪个 URL、什么格式**。v0.7 的"到达同一路由由 codec 分流"是假设；若实际走通用消息推送安全模式，§4.2.4 就从"备用分支"变成必做（+2 人天 + 一处新配置）。第一阶段不接入，B13 用一笔 Android 真单退款实测。<br>**④ `settleOrder` 删除 `users FOR UPDATE`**：权益改派生后本事务不读写任何 user 维度数据，锁 `users` 已无保护对象，只会与登录/资料更新争用并把死锁面扩散到核心表。下单侧日限计数同理改为无锁 count（软限额容忍 ±1）。<br>**【删除过度设计 · 5 项】**<br>**⑤ Apple 渠道周期性退款核对整体删除**：三条独立理由——退款推送对 iOS 同样存在（备份的备份）；B12 取口径 A 时漏一笔退款**在用户侧与数据侧零差异**；`tipRefundWatchDays=180` 的依据（官方手续费退还规则）与"退款何时发生"无因果关系。顺带在 §3.4 点明 v0.7 未写出的隐藏耦合：**B12 选 A ⇒ 该队列不存在；选 B ⇒ 必须存在**。<br>**⑥ 删除 pay-claim 端点 + `paying` 状态**：pay-claim 的唯一作用与 `GET /tips/summary` 的 fire-and-forget probe 完全重叠；而 `paying` 态本身是 v0.2 为了让 pay-claim 有意义才补的（见本表 v0.2 行），方向是反的。状态机 5 态 → 4 态，trigger 5 → 3。<br>**⑦ 探测窗口 90 天 → 7 天**：payData 不可复用 + 面板同步 + session_key 轮换 ⇒ 数小时后仍 0/1 的订单此后被支付概率实质为零；`tipColdProbeIntervalSec` 随之删除。ttl 新增项 10 → 5。<br>**⑧ `user_tip_prefs` 表 → `users.tip_badge_hidden` 一列**：一张表只存一个 boolean，与"不建权益表"是同一把尺子。<br>**⑨ `userOverviewApi` 缓存改造移出本方案**：若该缺陷成立，它今天就已导致跨账号串号展示总收支，属既有缺陷，与 B0 同等处理拆独立 issue。<br>**【官方文档复核 · 5 项】**<br>⑩ 平台闸门放宽：官方无任何鸿蒙/桌面端限制表述，v0.7 的默认禁付是无依据的自设闸门，代价是确定性损失可支付用户 ⇒ 除开发者工具与未开通的 iOS IAP 外一律放行。⑪ 版本检测改用 `wx.getDeviceInfo()` + `wx.getAppBaseInfo()`（官方示例用的 `getSystemInfoSync` 在当前基础库已废弃）。⑫ 推送 `GoodsInfo.Quantity` / `ProductId` 纳入弱校验（v0.7 完全未用）。⑬ §5.7 补**提审自查表口径**（官方清单原文要求"以 `wx_order_id` 去重"，我方答"已做幂等、主锚为 `out_trade_no`、`wx_order_id` 建唯一索引用于跨单占用检测"），防止 B13 自查时把主锚改回去。⑭ B8 定稿：官方部署清单逐条要求告知费率/结算/退款/月限额，产品 §7.3 已相应修订。<br>**【一致性修复】**⑮ 鉴权改造点数统一为 **12 处**（v0.7 同文档内并存 11 / 11+1 / 12 三种口径）；⑯ 上游依据更新为产品 v0.8；⑰ migration 编号已实际核实为 `0019`。<br>**【交付切片】**新增 §0.2：第一阶段（`wechat_pay` 单渠道完整闭环，**约 18～20 人天，可独立上线**）／第二阶段（iOS IAP、退款推送、`notify_provide_goods`，**约 3.5～5.5 人天，三项均可能整体取消**）。合计约 21～25，较 v0.7 净减约 2 人天——**切片的收益不在省人天，而在把三个未验证假设前置为真单实测**。五条安全不变量一条未减。 |
| **v0.9** | **2026-09-04** | **B11 清零，技术方案再无阻塞闸门。**<br>产品 v0.9 拍板：**取消「不存在元→点固定换算公式」这条要求本身**，保留数值支持度与 10/99/1874 映射。反代币边界改由「无充值入口 / 无消费兑换出口 / 无转让提现」三条承担。<br>**技术侧净变更：无删除，只是把条件表述转为定稿。** 新增一条必守约束：`support_score` 必须由订单快照 `support_delta` 聚合，禁止按 `price_cents` 计算（当时给的理由"分端价格可能不一致"已被 v1.0 证否，约束保留但换了依据）。 |
| **v1.0** | **2026-09-04** | **对照官方两页文档（个人版 + 企业版）完成外部评审，取消切片、iOS 全量支持、删除 channel 维度。估算 18~20（首阶段）→ 13~15（单阶段含 iOS）。**<br>**【新增 §0.0 主体路径声明】**<br>**① 全文明确我们走的是「虚拟支付：个人」，不是「企业、个体户」**，两条路径的准入、商品模型、可用接口、限额、后台入口逐项列表对照；由此固化三条硬约束（不得引入代币结构、不得假设企业版商户管理能力可用、月限额 10 万属个人主体特有告知项）。<br>**② 修正 v0.8 立的「文档的沉默不是许可」——它被用过头了。** 新判据按**内容分类**而非文档来源：**主体资质/权限/商业条款只认个人版**；**平台机制**（设备路由、签名、推送字段、道具双端互通、`order.status` 枚举、iOS 下单条件）**两版共用同一套系统，企业版可采信**。依据是个人版页面开篇即"发给 Agent 的提示词"，本质是**接入教程而非接口规范**，其省略属编辑取舍。§0.0.3 列出本方案引用企业版的全部 8 处以便审计。<br>**【iOS：从第二阶段提前到第一阶段，切片取消】**<br>**③ 设备路由是平台强制行为**（Android/鸿蒙/Windows→微信支付，**iOS→Apple 支付**），开发者无法选择 ⇒ **不开 IAP 则 iOS 用户完全无法支付且无任何替代路径**（不能改走普通微信支付，个人主体也拿不到微信支付商户号）。<br>**④ v0.8/v0.9 的切片三前提中两个半被证否**：`notify_provide_goods` 官方原文「推送回包成功**就不需要调用**」（不是"未验证"而是"明说不需要"）；退款推送与发货推送**同通道同格式**且官方已给完整字段表；**道具 Android/iOS 双端互通**，同一道具 ID 与价格直接在 iOS 生效，**我方没有也不需要 App Store Connect**。而切片的代价是确定性损失约一半用户（记账工具 iOS 占比高）。**iOS 实际增量 = 0.5 人天**（仅客户端版本闸门 + 一笔真单验证）。<br>**⑤ 撤销「iOS ≥ 15 不得作为置灰条件」**：按新判据它属平台机制可采信；不设该闸门的后果是 iOS 14 用户遭遇无法解释的失败。同时补入 Apple 最低支付 1 元、仅大陆 App Store 账户、无沙箱三条。<br>**【P0 修正 · 3 项】**<br>**⑥ 登记待证实风险 R1（§4.3.2）**：若微信侧对 iOS 单做价格档映射，`order_fee !== price_cents` 会让每笔 ¥187.4 的 iOS 单被判 conflict＝"钱收了不发货"——与本方案反复强调的最不能出的故障同类，只是藏在硬阻断项里。**当前按原样实现不做降级**（风险未证实、提前放宽等于用确定的安全换不确定的可用性、且后果可逆可观测），B13 用一笔 ¥187.4 iOS 真单验证，并预先固定"若证实"的修法方向（按 `order_type` 分渠道而非整体降级）。<br>**⑦ `GET` 接入验证升为第一阶段必做**（原埋在"安全模式备用分支"第 7 条）：它是**配置阶段门槛**，不实现则推送 URL 根本保存不了，B13 全部真单验证都无法开始。<br>**⑧ 新增 `addContentTypeParser`**：Fastify 默认只解析 JSON，XML/text 推送不注册则 body 为空或 415。两份 spec 此前均未提及。<br>**⑨ 推送格式判断修正**：**请求**格式取决于 MP 后台配置（XML/JSON/安全模式）**不是固定 XML** ⇒ codec 抽象是必需的（比 v0.9 认为的更有必要）；但**回包**官方接受"空或 `success`" ⇒ 统一返回纯文本 `success`，**不需要两套 encoder**，也消除了"改了推送格式忘了改回包格式"的故障模式。<br>**【删除过度设计 · 6 项】**<br>**⑩ `channel` 维度整体删除**：signData 无渠道字段 + 道具双端同价 + 平台自动路由 ⇒ **服务端下单既不需要也无法可靠知道设备**。删下单 body 的 `channel`、目录 `channels` 嵌套、`?channel=` 与浏览态、`purchasable` 的 channel 分量、`ios_iap_unavailable` 分支。`tip_orders.channel` 保留但**语义反转**为由 `order_type` 回填的下游事实（用于账单对账与费率归因）。<br>**⑪ 删 `unresolved` 状态 + 探测窗口 7 天 → 30 分钟 4 次**：v0.8 已论证"数小时后仍未支付的概率实质为零"却仍选 7 天，与自身论证不一致；窗口收敛后 `unresolved` 与 `expired` 不再有可观测区分价值。同时新增 `expired + paid → manual_conflict` 矩阵项，保证迟到支付不被静默丢弃。`tipProbeDeadlineSec` 由 `tipProbeMaxCount` 取代（消除同一件事的两个真相源）。<br>**⑫ 三个灰度 boolean → 单一 `WX_PAY_MODE` 枚举**：原设计存在 `backend=false && entry=true`（看得到入口一点就报错）这类无效组合，合法组合恰好就是三行，用枚举使非法状态不可表示。<br>**⑬ 删 `FOR UPDATE SKIP LOCKED`**：advisory lock 已全局互斥，pg-mem 又不支持 ⇒ 保留它就得写一条"已接受风险"，为用不上的优化引入测试盲区。**⑭ 删出站 semaphore**（日订单个位数）。**⑮ `@>` 改 `= ANY(...)`**（语义等价、pg-mem 兼容，再省一条已接受风险）。<br>**【退款】**<br>**⑯ 本期不实现任何退款逻辑**（用户拍板：自愿赞赏不涉退款）。B12 随之定稿为 `$settledStatuses = {'delivered','refunded'}` 固定常量，不再是待决策项。**保留三项零成本项**：`refunded` 状态值、`status ∈ {5,8} → mark_refunded` 映射（不建模会落进 `unknown` **永久重试**，与 v0.6 修 `status=7` 是同一个坑）、`xpay_subscribe_ios_refund_query_notify` 的**有意不应答**（官方 3 次 3 秒无应答即交回 Apple 裁定，正是我方期望）。⚠️ **不做退款功能 ≠ 不告知退款规则**——官方自查项，四项告知全部保留。<br>**【口径修正】**<br>**⑰ `support_score` 禁按价格计算的理由更换**：v0.9 的"分端价格可能不一致"已被"道具双端互通"证否；新理由是**目录改价会追溯篡改历史订单的支持度**（数据正确性问题，比原理由更硬）。<br>**⑱ `notify_provide_goods` 从"暂缓待实测"改为"永久不做"**，B13 相应移除该实测项——官方明说不需要调用，实测本身是多余动作。<br>**【元问题记录】**本轮评审同时指出：产品 13 版 / 技术 9 版的修订记录中，相当篇幅在论证"为什么删掉上一版加的东西"，文档维护成本已接近实现成本。v1.0 后**停止方案迭代，进入实现**；剩余不确定性（R1、推送实际格式、¥1 档 iOS 边界）都属于"一笔真单即可答完"的问题，再写十版文档也答不了。 |
| **v1.1** | **2026-09-04** | **对照官方个人版页面 + 仓库实证的外部评审：修复两个会导致线上错误行为的缺陷（P0），并纠正一处顺序颠倒的过度设计。方案骨架未变，五条安全不变量一条未减。**<br>**【P0-1 · `probe_count` 语义冲突会让正常订单被提前判 `expired`】**<br>v1.0 让 `probe_count` **同时**充当 scheduler 的节奏游标（§6.1 的 2/5/10/30 表）与 T3 的探测预算（`probeBudgetExhausted = probe_count >= 4`），而 webhook（§4.2.3）与 summary（§4.6）的加速探测也走 claim ⇒ **同一个计数器被三个来源共享消耗**。若加速探测递增它，用户 success 后的 4 次 summary 轮询加一次 webhook 就能吃掉预算，订单可能**在用户还停在 `settling` 界面时就被置 `expired`**，随后真实支付到达落 `manual_conflict` + error 告警 ⇒ **正常链路批量产生人工告警**；若不递增，claim 又无法给出新的 `next_probe_at`，节奏表失效。两种读法都坏，说明这是模型缺陷而非表述疏漏。<br>**修法**：把"节奏"与"放弃"彻底解耦——① `probe_count` / `next_probe_at` **只由 scheduler 推进**，纯表达"下次定时查单在什么时候"；② **T3 的界改为时间**：`now() >= created_at + tipProbeWindowSec`（默认 1800s），与探测次数、触发来源均无关；③ `last_probed_at` 由三方共同推进，只承担节流。配置项 `tipProbeMaxCount` → `tipProbeWindowSec`，reconciler 入参 `probeBudgetExhausted` → `probeWindowExpired`。<br>**顺带纠正 v1.0 的一处方向性误判**：v1.0 把 `tipProbeDeadlineSec` 改成次数，理由是"消除两个真相源"——方向对但**选错了留下来的那个**。节奏表是可变的实现细节，"30 分钟后放弃"才是稳定语义；现在改为节奏表决定"查几次"、窗口决定"何时停"，前者变化不影响后者。<br>**【P0-2 · summary 加速核实在下单后 120 秒内恒不可用】**<br>§4.1.2 规定 `next_probe_at = created_at + 120s`，§4.6 又规定 claim 用「`last_probed_at` 最小间隔 **+ `next_probe_at` 条件**」⇒ **客户端 success 后 8 秒窗口内的 4 次轮询，claim 条件每一次都不成立**。后果有二：① webhook 一旦丢失，用户最快也要等到 T+2min 才到账，`settling` 必然走到超时降级；② 更严重的是 **§5.8「删除 pay-claim 端点」的全部论证前提是"summary 已经在做同一件事"——按 v1.0 的写法它并没有在做**，等于把能力删掉了却以为还在。§4.2.3 早就给 webhook 写了"可越过远期 `next_probe_at`"的豁免，唯独 summary 没写。<br>**修法**：新增 §4.6.1 明确给出 claim SQL——加速探测**不带 `next_probe_at` 条件、不动 `probe_count`**，只受节流约束；webhook 与 summary **同权**。`tipProbeMinIntervalSec` 由 60s 降为 **10s**（8 秒轮询窗口内 60s 节流会让最多只有第一次生效）。§5.8 补一条"改动 §4.6.1 时必须复核本节"的交叉约束。<br>**【P1-1 · B5 与 codec 的顺序颠倒（过度设计）】**<br>v1.0 的排布是"先按三种格式设计 codec 抽象 → 把 B5 排进开工清单"。但**推送格式是我方自己在 MP 后台配置的**，B5 是一次约 10 分钟的后台操作，做完即唯一确定；在此之前实现三选二的分支，正是本方案 §0.1 反复批判的"为未验证假设预留分支"，而这里的假设甚至不需要真单就能消除。**B5 提前为 Day 0 首个动作**，只实现选定的那一个 codec，其余配置值在启动时显式失败。<br>**同时补记一项此前未登记的成本**：`server/package.json` 现有依赖中**没有任何 XML 解析库**（已实证：仅 fastify / @fastify/* / pg / ioredis / luxon / dotenv 等）。若 B5 结论为 XML，需新增解析依赖 + 供应链评审 + 安全配置（禁 DTD/实体、限深度与节点数）；若为 JSON 则零新增依赖。§11 的 webhook 行由固定 3 人天改为 **2～3.5**，13～15 的区间来源由此显式化。<br>**【P1-2 · 回包改用个人版原文的 XML 常量】**<br>v1.0 依据企业版「响应为空或 `success` 亦可」把回包简化为纯文本，逻辑自洽；但个人版正文明写的是 `<xml><ErrCode>0</ErrCode><ErrMsg><![CDATA[success]]></ErrMsg></xml>`，而**两者实现成本完全相同**（都是一个常量、都不需要 encoder、都与请求格式无关）。**成本相同时应选证据最强的那个**——用个人版原文等于同时满足两版文档，直接消灭"回包不被识别 ⇒ 平台重试 15 次"这一整类故障。这不会退回两套 encoder：回包与请求格式无关的结论仍然成立，只是常量内容变了。<br>**【P1-3 · 客户端缺 `wx.canIUse` 闸门】**<br>官方只给了 **iOS 侧**的微信版本下限（8.0.68），**没给 Android 侧**；旧版微信上 `wx.requestVirtualPayment` 可能根本不存在，直接调用会抛错——而"点击后失败"正是产品 AC-6 明令禁止的。`checkPayEligibility()` 新增 `wx.canIUse('requestVirtualPayment')` 作为**第一道**闸门（零成本、不依赖任何版本号常量）。<br>**【P1-4 · `channel` 存推导值改为存原值】**<br>v1.0 让 `channel` 由 `order_type` 映射回填，且"无法识别时写 NULL"——而方案自己承认"官方枚举可能扩展"，一旦扩展就**把原始事实丢掉了**。改为落 `upstream_order_type SMALLINT` 原值（与 `upstream_status` 同构），渠道归因（Android 1% vs iOS 12% 对账）在查询层映射。**通用判据：能存原值就不要存推导值。**<br>**【P1-5 · 版本号格式归一化】**<br>`getDeviceInfo().system` 带平台前缀（`'iOS 15.4'`），`getAppBaseInfo().version` 是裸版本号（`'8.0.68'`），两者不能共用未归一化的解析函数。v1.0 专门强调了 `'8.0.9' > '8.0.68'` 的字典序坑，却没提这个前缀，实现时大概率会踩。新增 `stripPlatformPrefix()` 及其单测。<br>**【P2 · 若干收敛】**<br>⑦ 删 `tip_orders.device_platform` 列与下单 body 的该字段——服务端从不读、不可信、无唯一消费者，按方案自己的判据就该删；下单 body 因此只剩 `product_key` + `code`。⑧ 删 codec 的 `success()` / `retry()` 方法——回包是与解码无关的两个常量，把恒定值放进接口只会让后来者以为它随 codec 变化。⑨ `GET` 接入验证**保留但改写理由**：虚拟支付推送 URL 未必复用小程序消息推送的握手，"不实现就配不上"是推测而非事实；正确理由是"约 10 行、零依赖的廉价保险"，B5 时记录实际是否触发。⑩ overview 端点的徽章判定合并为一次聚合查询（本期单一 entitlement key 时 `supporter_badge = tip_count > 0`），`/tips/summary` 仍用通用 `EXISTS` 派生；高频端点特化处需注释成立前提，皮肤上线时复核。⑪ 统一 B0 的口径矛盾——§12 表格"独立 PR，可并行"与 §4.0"未完成则 tips 不得自建鉴权"冲突；澄清为"**独立 PR 指变更边界，前置指时序**"，二者不矛盾但必须分开表述，否则排期误判。<br>**【评审同时确认不要再动的部分】**R1 的处理方式（`order_fee` 硬阻断按原样实现 + ¥187.4 iOS 真单验证 + 预先固定修法方向）、`raw → validated → reconciler → executor` 四层决策链、`status = 7/9/10` 的建模、幂等锚偏离官方建议及 §5.7 留痕——这四项都不是过度设计，删任何一项都会造成实际损失。 |
| **v1.2** | **2026-09-04** | **第四轮外部评审（对照官方个人版页面原文抓取 + 仓库实证）：修两个与 v1.1 同源的 P0，删一处自造的不确定性，修正低估的估算，并立下三条收敛纪律。骨架未变，五条安全不变量一条未减。**<br>**【元问题先行 · 新增 §0.3 收敛纪律】**<br>本文档连续四轮被评出 P0（v0.6 枚举缺失 / v0.8 硬阻断误设 / v1.1 P0-1、P0-2 / v1.2 P0-A、P0-B），**它们不是四个独立缺陷，而是同一个错误的四次复发**。根因不在"想得不够多"，而在验证方式：① 只校对文档内部自洽、不推演系统实际行为（判据用散文表达，从未把 outcome × 状态 × 窗口的格子填满）；② 改参数不做算术（v1.1 写"10s 能触发 1～2 次"，而 8÷10 恒等于 1）；③ 把可查证的事实登记为"待确认"再围绕它设计分支。<br>因此立三条硬纪律：**D1 判据必须穷举成表（不得留空、不得写"其余同上"）；D2 时间/次数/节流参数必须附算术且两侧联动重算；D3 可在官方文档或仓库中查证的事项不得登记"待确认"、更不得为其预留分支**。元判据：**如果一个"不确定性"读一遍文档或 grep 一次仓库就能消除，那么围绕它做的任何设计都是过度设计——包括为它写一条"待验证"的登记。**<br>**【P0-A · T3 只覆盖六分之一的分支，其余订单永久驻留补偿队列并每 tick 告警】**<br>v1.1 把 T3 的时间界做成 §4.3.1 decision 矩阵里的**一行**（"unpaid 0/1 且 `probeWindowExpired`"），但矩阵共有 9 类 outcome，**只有那一行消费了窗口判据**：`unknown` / `transient_error` → `retry`、`conflict` → `manual_conflict`、`unrelated 9/10` → `keep_current` **三类都不写入终态** ⇒ 订单永久停在 `created`、永久命中 `idx_tip_orders_probe_due`。两个具体后果：① §6.1 节奏表 `probe_count >= 4` 那一行写的是"由 T3 置 expired"——**这是一句说明不是一个赋值**，claim 事务必须给 `next_probe_at` 写值，实现者若写"保持不变"或"now()+tick"即是**每 tick 忙轮询 + 持续上行微信**；② **`manual_conflict` 在 sweep 侧没有终止出口**——§4.2.3 自 v0.6 起就写明"重复重试无法修复确定性冲突"并为 webhook 侧给了终止（成功回包），但 sweep 侧一直没有对应实现，结果是每 tick 一次 `error` 告警的死循环。**这与 v1.1 P0-1 是同一类故障（正常/异常链路批量产生人工告警），只是入口从"节奏游标共享"换成了"矩阵覆盖不全"。**<br>**修法（不新增状态）**：① T3 提升为**优先于 outcome 的前置判定**——窗口外**除"本次查单确认已支付（2/3/4）"外一律 `mark_expired` 并停止上行**（只放行 settle 的理由：T3 保护的是"不再无限期上行"，不是"拒绝承认已收到的钱"）；② §4.3.1 按 D1 重写为**两步、全格填满**的矩阵（第 1 步终态/已交付守卫，第 2 步行=9 类 outcome × 列=窗口内/外）；③ §6.1 显式定义 `probe_count >= 4` 时 `next_probe_at = created_at + tipProbeWindowSec + 1s`（而非在 claim 时判死——T3 的判定必须只有一处，否则又是两个真相源）；④ §10 新增"窗口外 6 种 outcome 各一条"与"连续 5 个 tick 内 query_order 调用 ≤1"的回归。<br>**【P0-B · v1.1 对 P0-2 的修复没有达成目的，加速核实仍近似失效】**<br>v1.1 把 `tipProbeMinIntervalSec` 由 60s 降到 10s 并写下"窗口内能触发 1～2 次"。**算一下是恒 1 次**：客户端 t=0/2/4/6 共 4 次、窗口 8 秒，10s 节流下只有 t=0 能抢到租约。更要命的是**那唯一一次落在 t=0**——用户刚拿到 success 的瞬间，微信侧订单最可能仍是 0/1，即探测机会被用在成功率最低的时刻。于是 **§5.8「删除 pay-claim」的前提在 v1.1 下仍不成立**，只是从"恒失败"变成"恒失败于最不可能成功的时刻"。<br>**修法（两侧成对改，D2）**：`tipProbeMinIntervalSec` **10s → 3s**；客户端 settling 由"固定每 2 秒 4 次（8 秒）"改为**退避 2/2/4/8/15 秒（共 5 次、累计约 31 秒）**。算术：请求时刻 t=0/2/4/8/16/31，相邻间隔 ≥3s 者通过 ⇒ **实际触发 5 次探测，覆盖 0～31 秒**，仅 t=2 被节流挡掉。§4.6.1 与 §7.2 成对给出算式并互相标注耦合，§6.2 登记三参数（节流值 / 客户端退避 / 窗口长度）互相约束，§10 加"若有人把节流改回 10s 该用例必须失败"的回归。**产品侧 Q7 的 8 秒阈值随之改为约 31 秒**（产品 v1.2 §3.3）。<br>**【过度设计 · 删除自造的不确定性】**<br>**`WX_PAY_WEBHOOK_CODEC` 三态枚举 + codec 多实现抽象 + §4.2.4 AES 分支 + B5 的 Day 0 闸门地位，全部删除。** 核对官方个人版页面原文后：【虚拟支付 → 基本配置 → 发货推送配置】**只是一个填 URL 的输入框，页面没有任何数据格式选项**；正文对格式的表述是确定的陈述句「支付成功后平台以 **XML** 推送到该 URL」。所谓"明文/JSON/安全模式三选一"是小程序【开发设置 → **消息推送**】那套**另一个入口**的形态，被误移植了过来。⇒ B5 的收益为零、§11 的人天区间挂在一个伪未知上。**这正是 D3 的典型反例。** 现定为 **XML 单实现**（`decodeXpayXml()` 纯函数，不声明 interface），XML 依赖成本变为确定发生，§11 webhook 行由 2～3.5 收敛为 **3**；B5 降级为普通后台配置动作。<br>**顺带按同一把尺子删掉 v1.1 漏量的部分**：`VirtualPayWebhookCodec` interface 本身（只剩一个实现的接口不是抽象而是间接层）、`verifyHandshake?`（与解码无关，只依赖 token，移入 GET route handler）。<br>**【P1 · 五项】**<br>**① `canIUse` 单判不足 ⇒ 改双判**：`wx.canIUse()` 查的是**基础库**能力清单，而 `requestVirtualPayment` 的门槛在**微信客户端版本**——两条可独立更新的版本线，**旧客户端 + 新基础库**时 `canIUse` 可能返回 true，闸门形同虚设、仍会"点击后失败"（AC-6 明令禁止）。改为 `canIUse(...) && typeof wx.requestVirtualPayment === 'function'`，并要求 `fail` 回调对"API 不支持"类错误兜底。<br>**② `GET /tips/summary` 的 probe 单数未定义 ⇒ 限最近一单**：下单日限 20 单，用户可在 10 分钟内点出多张 `created` 单（点档位再取消即产生一张）。若对每张都 probe，**一次带正常鉴权的 GET 会放大成最多 20 次微信出站**，而 `tipProbeMinIntervalSec` 是**每订单**节流、拦不住它。<br>**③ B0 不再是 tips 的时序前置**：tips 的支付边界是 `code2Session.openid === users.wx_openid`——**持 refresh token 者即便调得到 `POST /tips/orders`，也拿不出匹配受害者 openid 的 code，付不了钱**；而 summary / badge-visibility 的敏感度不高于今天就接受 refresh token 的 `GET /users/me`。即 B0 对 tips 的安全增益≈0，"硬前置"是自造的排期依赖。改为：`requireUser.ts`（新增文件、零回归面）随先合入的一方落地，**12 处替换走独立 PR 与 tips 真正并行**。<br>**④ R1 验证金额 ¥187.4 → ¥9.9**：v1.0 选 ¥187.4 的理由只要求"非 Apple 整档价"，而 **¥9.9 同样不是整档价、证伪能力完全等价**，成本却相差 19 倍（且 iOS 结算 45~60 天、抽成 12%，若 R1 证实还需改完再验一次）。¥187.4 改为放量前的确认单（B13 第 ⑧ 步）。<br>**⑤ 无 token 时 `GET` 无条件回显 echostr = 任意文本回显端点**：`wxMsgPushToken` 在明文模式下非必填。收口成本为零：固定 `text/plain; charset=utf-8` + `X-Content-Type-Options: nosniff` + 长度 ≤128 + 字符集 `[A-Za-z0-9_-]`，不匹配则返回 `success` 而非回显（微信握手的 echostr 是随机数字串，不会误伤）。<br>**【P2 · 收敛与正确性收口】**<br>⑥ 删 `wxPayQueryOrderUrl` / `wxStableTokenUrl` 两个 env（微信官方域名不是部署差异项，且 `_fetch` 可注入已满足测试需要）⇒ 改模块常量。⑦ 删"`out_trade_no` 撞唯一索引则整套重新取号"（120 bit 随机，永不执行的死代码路径，写进方案会让人以为需要为它写测试）。⑧ **派生查询统一补 `delivered_at IS NOT NULL`**：`$settledStatuses` 含 `refunded`，而状态机允许 `created → refunded`（未发货即退款），不加该条件会把它计入 `tip_count` / `support_score` 并让 NULL 混进 `min(delivered_at)`。⑨ **pg-mem partial index 不再写"待验证"**（D3）：`server/test/setup.ts` 已实证「`WHERE bool_col = true` 会污染所有针对索引列的等值查询、`WHERE col IS NULL` 正常」；`idx_tip_orders_probe_due`（`WHERE status='created'`）是列等值谓词、且 sweep 的 claim 恰好对 `status` 做等值查询 ⇒ 照既有 `uq_families_one_personal_per_owner` 的做法**在 pg-mem 侧跳过该 index**，生产 DDL 保留。<br>**【估算修正 · 13～15 → 16～19】**<br>三笔均为**登记遗漏**而非范围扩大：测试行 2.5 → **4**（§10 矩阵已有 22 行、含 v1.2 的全枚举回归，而估算行从 v1.0 起未动）；**B13 真单联调独立成行 +1**（含手工制造 webhook 丢失、iOS 真单、报文脱敏固化，与写单测不是同一件事）；徽章行给出上界 1.5～**2.5**（产品 Q6 未定稿、方向 A 需验证 28rpx 可读性）。webhook 行区间消失取 3。按 D2，估算也必须可核算。<br>**【评审确认不要再动】**R1 的处理方式、四层决策链（`raw → validated → reconciler → executor`）、`status 7/9/10` 建模、幂等锚偏离 + §5.7 留痕、openid 唯一闸门、权益全派生、`settleOrder` 只锁单行——七项均非过度设计。<br>**【本轮之后】**剩余不确定性只有 R1 与 ¥1 档 iOS 边界两项，**都必须靠真单回答**（D3 已把其余全部清空）。方案进入实现，不再迭代版本。 |
| **v1.3** | **2026-09-07** | **实现期 review 回写（不是方案迭代，是让文档追上已落地代码 + 三项实测缺陷）。**<br>**① §4.6 推翻"历史不返回订单号"**：`summary.history[]` 增 `out_trade_no`。原判据「`tip_count` 比下单前变大」需要下单前基线，而 summary 首拉失败或用户抢先点击时基线不存在，取 0 兜底会让**已有赞赏记录的用户第一拍就误判到账**（违反 AC-4）。改为「本单出现在 history」——精确、无基线。暴露面未扩大：`out_trade_no` 是本人单号且 `POST /tips/orders` 已返回给同一客户端，金额/openid/平台 ID 一项未加。判据外提为纯函数 `isOrderSettled()`（页面在本仓库无单测载体）。<br>**② `order_type` 原值补齐六条路径**：此前只有 `settle` 落原值，`mark_refunded` / `mark_expired` / `manual_conflict` / `keep_current` / `schedule_probe` / `retry` 全部写 NULL，违反 §4.3.1 且**削弱 R1 的渠道归因取证面**。修法：`manual_conflict` 决策补 `snapshot` 字段（它此前根本不携带快照，"created 单留痕"实为 COALESCE 空操作），执行层统一用 `decisionSnapshot()`。<br>**③ `settleOrder` 补同单 `wx_order_id` 漂移阻断**：`existsWxOrderIdOnOtherOrder` 排除自身 ⇒ 本地已记 A、上游报 B 时 `backfillPlatformIds` 的 `COALESCE` 静默保留 A，既不阻断也不告警。新增终态 `order-id-drift`：一个字段都不改 + error 告警。（`order_fee` 不做锁内复核：`price_cents` 建表后不可变，外层 validate 已逐笔比对，属可接受）<br>**④ B2 从清单提醒升级为机器闸门**：`wx_product_id` 占位改用 `TODO_B2_` 前缀，`assertTipProductsPublishable()` 在 `WX_PAY_MODE !== 'off'` 时由进程入口拒绝启动。官方硬要求 productId/goodsPrice 与后台双一致，忘回填的后果是每笔真单下单即失败——这类事实不该靠人记得看清单。<br>**⑤ tips validator `coerceTypes` 关闭**：开着它 `badge_hidden: "true"` 会被静默强转，与本作用域"契约外输入一律 400"自相矛盾。<br>**⑥ §3.4 / §10 判据与实现对齐**：`entitlements[]` 明细由 `deriveEntitlements` JS 侧聚合产出（`$2 = ANY(...)` 只适用于单点判定已知 key）；`status` CHECK 与探测索引两项**只能静态断言生产 SQL**（pg-mem 建表刻意不带 CHECK ⇒ 原"pg-mem 载体"是悬空的，已补 E6 用例）。<br>**⑦ 官方事实更正（person.html 原文抓取）**：iOS 侧官方硬门槛只有**微信 ≥8.0.68 + 小程序简称 + 开通 IAP**，**未提系统 ≥15、未提最低 1 元**。v1.0 第⑤条"撤销 iOS ≥15 不得作为置灰条件"据此降级为**待证实**（登记进 `docs/testing/tips-known-limits.md` R2）：代码里的 iOS 15 闸门是保守多判，不致错单但确定性置灰 iOS 12~14 用户，B13 真机核实后按结论删留。 |
