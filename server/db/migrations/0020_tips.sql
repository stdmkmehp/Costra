-- ═══════════════════════════════════════════════════════════════════════════════
-- migration 0020: tip_orders + users.tip_badge_hidden —— 虚拟支付赞赏
--
-- 事实源：docs/design/monetization-tipping-tech-spec.md v1.2 §3.2/§3.3（原样落地）
--
-- 语义要点：
--   · out_trade_no = 幂等锚（一个 out_trade_no 只发放一次）
--   · wx_order_id 部分唯一索引 = 跨单占用检测（同一下游支付单不可映射两个 tip_order）
--   · openid / product_* / price_cents / support_delta / entitlement_keys = 下单时
--     商品目录快照（目录改价不追溯历史订单；support_score 由快照聚合，禁按 price 算）
--   · upstream_status / upstream_order_type 存原始枚举原值，不改写为内部字符串
--   · probe_count / next_probe_at 只由对账调度器推进；last_probed_at 为
--     webhook / 调度器 / summary 三方共用的探测租约时间戳（节流 3s）
--   · tip_badge_hidden：FALSE=公开（默认） / TRUE=仅自己可见（"仅自己可见"开关）
-- ═══════════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS tip_orders (
  id                  UUID PRIMARY KEY,
  user_id             UUID NOT NULL REFERENCES users(id),
  openid              TEXT NOT NULL,                -- 下单快照：query_order 的 openid 入参
  product_type        TEXT NOT NULL CHECK (product_type IN ('tip')),
  product_key         TEXT NOT NULL,
  product_title       TEXT NOT NULL,
  wx_product_id       TEXT NOT NULL,                -- 微信道具 ID（signData.productId 快照）
  price_cents         BIGINT NOT NULL CHECK (price_cents > 0),
  support_delta       INTEGER NOT NULL CHECK (support_delta > 0),
  entitlement_keys    TEXT[] NOT NULL,              -- 权益 key 快照（当前固定 ['supporter_badge']）
  upstream_order_type SMALLINT,                     -- 最近一次 query_order 的 order_type 原值
  out_trade_no        TEXT NOT NULL,
  wx_order_id         TEXT,                         -- 微信侧支付单号（MchOrderNo）
  channel_order_id    TEXT,                         -- AppleIAPOrderID（iOS）
  wxpay_order_id      TEXT,                         -- TransactionId（Android/鸿蒙/Windows）
  upstream_status     SMALLINT,                     -- 最近一次 query_order 的 order.status 原值
  status              TEXT NOT NULL DEFAULT 'created'
                      CHECK (status IN ('created', 'delivered', 'refunded', 'expired')),
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  paid_at             TIMESTAMPTZ,
  delivered_at        TIMESTAMPTZ,
  refunded_at         TIMESTAMPTZ,
  last_probed_at      TIMESTAMPTZ,
  next_probe_at       TIMESTAMPTZ NOT NULL,          -- 创建时写 created_at + 120s
  probe_count         INTEGER NOT NULL DEFAULT 0 CHECK (probe_count >= 0),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

COMMENT ON TABLE tip_orders IS
'赞赏订单（虚拟支付）。资金事实以微信侧 query_order 为唯一权威，本表镜像状态。'
' out_trade_no=幂等锚；商品/金额为下单快照（改价不追溯）；'
' upstream_status/upstream_order_type 存原值不改写；'
' probe_count/next_probe_at 仅由对账调度器推进，last_probed_at 为三方共用探测租约。'
' 事实源：docs/design/monetization-tipping-tech-spec.md v1.2 §3。';

-- 幂等锚唯一索引
CREATE UNIQUE INDEX IF NOT EXISTS uq_tip_orders_out_trade_no
  ON tip_orders (out_trade_no);

-- 跨单占用检测：同一下游支付单不可映射到两个 tip_order（部分唯一索引，NULL 不参与）
CREATE UNIQUE INDEX IF NOT EXISTS uq_tip_orders_wx_order_id
  ON tip_orders (wx_order_id) WHERE wx_order_id IS NOT NULL;

-- 对账调度器取数索引（partial · 生产保留；pg-mem 因列等值谓词跳过，见 server/test/setup.ts）
CREATE INDEX IF NOT EXISTS idx_tip_orders_probe_due
  ON tip_orders (next_probe_at) WHERE status = 'created';

-- 派生权益与历史查询索引（user 维度按时间倒序）
CREATE INDEX IF NOT EXISTS idx_tip_orders_user
  ON tip_orders (user_id, created_at DESC);

-- 徽章可见性开关：FALSE=公开（默认） / TRUE=仅自己可见；不使用 updated_at 做并发控制
ALTER TABLE users ADD COLUMN IF NOT EXISTS tip_badge_hidden BOOLEAN NOT NULL DEFAULT FALSE;

COMMENT ON COLUMN users.tip_badge_hidden IS
'头像徽章可见性开关：FALSE=公开（默认），TRUE=仅自己可见。'
' 仅当前用户可写（PUT /v1/tips/summary/badge-visibility）；不使用 updated_at 做并发控制。';
