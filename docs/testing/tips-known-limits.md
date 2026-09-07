# tips（虚拟支付赞赏）已知限制与排查手册

> 事实源：`docs/design/monetization-tipping-tech-spec.md` v1.3（§4.3.1 / §4.6 / §4.6.1 / §5.7 / §6.1 / §12）。
> 本文登记**已接受风险与有意为之的语义**，供告警研判与人工对账时对照；非缺陷清单。

## 1. 待真单证实的假设

| 编号 | 假设 | 影响 | 验证方式 |
|---|---|---|---|
| R1 | iOS（Apple 支付）下 `query_order.order_fee` 是否被 Apple 价格档映射（不再等于下单 `goodsPrice`） | 若证实，硬校验 `order_fee === price_cents` 会把**正常 iOS 已支付单**判为 conflict 并转人工 | B13 用 ¥9.9 iOS 真单验证（¥9.9 非 Apple 整档价，具备证伪能力）；证实前**不得**改代码。若证实：按 `order_type`（7/8=Apple）分渠道，Apple 侧改 `>=` 或豁免。取证依赖 `upstream_order_type`，该列已在**全部**对账路径落原值（v1.3） |
| R2 | iOS 是否真有「系统 ≥ 15」门槛 | 官方 `person.html` 原文只要求**微信 ≥8.0.68 + 配置小程序简称 + 开通 IAP**，**未提系统版本下限**。代码 `virtualPay.ts::checkPayEligibility` 仍保留 iOS 15 判定 ⇒ 属**保守多判**：不会造成错单，但会确定性置灰 iOS 12~14 用户 | B13 用一台 iOS <15 真机（微信 ≥8.0.68）尝试调起：能支付 ⇒ 删除该分支及其用例；不能 ⇒ 保留并把官方依据补进注释 |
| — | iOS 最低支付 1 元（¥1 档在 iOS 的边界行为） | ¥1 档可能在 iOS 无法支付 | 同上，B13 真单回答。注：`person.html` 亦**未**提最低金额，该假设与 R2 同源（来自企业版页面），最低档已是 ¥1 故无论结论如何都不影响定价 |

## 2. 有界重试（P0-A）：不保证理论最终到账

到账链路 = 发货推送（平台重推 ≤15 次）+ 调度器探测（T+2/5/10/30min 节奏表）+ summary 加速探测，**全部受 30 分钟 T3 窗口约束**。窗口耗尽仍未确认支付 ⇒ `mark_expired`。

- 若用户**实际已支付**但 30 分钟内所有确认通道均失败（极端情形：推送全丢 + query_order 持续故障）：订单置 `expired`，之后 query_order 返回已支付 ⇒ `manual_conflict` + **error 告警**，不会自动补发，需人工处理（见 §5）。
- 这是有意取舍：无限探测的代价（常驻探测队列 + 微信出站配额）远高于人工兜底。

## 3. 探测租约语义（排查"为什么不探测/为什么在探测"）

- `probe_count` / `next_probe_at` **只由调度器推进**（节奏表 T+2/5/10/30min，`probe_count>=4` ⇒ `created_at + window + 1s` 越过 T3 边界）。
- `last_probed_at` 是 **webhook / 调度器 / summary 三方共用**的租约时间戳（节流 `tipProbeMinIntervalSec`=3s）。
- 因此调度器扫描候选 (`status='created' AND next_probe_at <= now`) 与租约节流是两套机制：调度器到点必取，webhook/summary 触发受 3s 节流。
- 客户端 summary 退避 [0,2,2,4,8,15]s ⇒ 请求时刻 t=0/2/4/8/16/31，其中 t=2 那次**预期被 3s 租约挡住**（5 次有效探测），不是 bug。

## 4. 明文推送信任模型

- 发货推送为明文 XML、**无签名校验**（`Sign` 字段仅用于日志分级）。推送内容不作为任何资金依据——唯一资金凭证是推送触发的 `query_order` 复核。
- 伪造推送的最坏结果 = 触发一次真实 `query_order`（受租约节流），无法造成发放。
- GET 握手（`GET /v1/tips/notify`）：未配置 `WX_MSG_PUSH_TOKEN` 时直接回显 echostr；echostr 不满足约束（≤128 字符、`[A-Za-z0-9_-]`）时回 `success` 而非回显（防任意文本回显端点）。

## 5. 需要人工介入的告警（error 级）

| 告警 | 含义 | 处置 |
|---|---|---|
| `tip settle blocked: wx_order_id occupied` | CI3 撞单：同一下游支付单映射两个 tip_order | 人工核对两单，退一赔一 |
| `tip settle blocked: wx_order_id drifted on the same order` | 同一业务单先后对上两个平台单号（本地已记 A、上游报 B） | **不改任何字段**（结算已回滚）。先在 MP 后台核对该 `out_trade_no` 究竟对应哪个平台单，再决定补发或退款；日志的 `localWxOrderId` / `wxOrderId` 即 A / B |
| `manual_conflict: paid order arrived after local expired` | §2 的极端情形（已支付但被 T3 收口） | 人工补发：SQL 改 `delivered`（见下）或协商退款 |
| `manual_conflict: * hard conflict: order_*` | 硬校验失败（单号/金额/支付单漂移） | 数据错乱信号，需排查根因，**不要**直接改状态 |
| `created order reported refund_failed upstream` | 本地从未交付但上游称退款失败（账实错乱） | 人工对账 |
| `xpay refund notify received` | 退款成功推送（只告警不自动变更，delivered→refunded 由对账矩阵处理） | 确认对账已收敛即可 |

人工补发标准动作（`infra/scripts/psql-exec.sh`，WHERE 带期望旧值 CAS）：

```sql
UPDATE tip_orders
   SET status='delivered', delivered_at=now(), paid_at=COALESCE(paid_at, now()), updated_at=now()
 WHERE out_trade_no='<单号>' AND status='expired';
-- 补发后派生权益（徽章/次数/支持度）自动生效，无需其他写入
```

## 6. 测试环境（pg-mem）与生产的已知差异

- `idx_tip_orders_probe_due`（partial index `WHERE status='created'`）在 pg-mem 侧**跳过**（列等值谓词会污染索引列等值查询），生产 DDL 保留。探测取数在生产有索引、测试全表扫——数据量小，无行为差异。
- pg-mem 不支持 `FOR UPDATE OF` / `SKIP LOCKED` / advisory lock / `AT TIME ZONE`：调度器的 advisory lock 单飞语义、settleOrder 的行锁并发语义**无法**在单测中真实复现，靠真 PG 集成验证（B13）或代码评审兜底。
- 为兼容 pg-mem 已主动规避：数组包含 `@>` 改 `= ANY(...)`（§3.4）、`FOR UPDATE SKIP LOCKED` 改普通 `FOR UPDATE`（§6.1）、`entitlements[]` 明细改 JS 侧聚合而非 `unnest + GROUP BY`（§3.4）。
- **pg-mem 建表刻意不带任何 `CHECK`**（`test/setup.ts`）⇒ `status` 四态约束、`price_cents > 0` 等在单测中**不会**被强制。因此「`status` CHECK 不含 `unresolved`」「`upstream_order_type` 可空」「探测索引存在」三项改为**静态断言生产 SQL 文件**（`tipsEnv.test.ts::E6`），而不是靠 pg-mem——后者是个测不到的载体。

## 7. 派生口径（排查看板数字时对表）

- 所有派生查询统一 `status IN ('delivered','refunded') AND delivered_at IS NOT NULL`：**created→refunded（未发货即退款）不计入** tip_count / support_score / history。
- `support_score` = 订单快照 `support_delta` 求和，**禁按 price_cents 算**（改价不追溯历史）。
- `granted_at` = `MIN(delivered_at)`（首次发放时间）。
- 退款**不回冲**徽章/次数/支持度（B12 口径 A：自愿赞赏定位 + 滥用成本远高于装饰徽章收益）。
- overview 端点的 `supporter_badge` 用 `tip_count>0` 特化（高频端点省一次查询，§7.3 获准）；`/tips/summary` 用通用 `entitlement_keys` 派生（皮肤预留）。两者在当前单 key 目录下恒等价。
