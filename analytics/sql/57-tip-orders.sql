-- 57-tip-orders.sql · 窗口内赞赏订单明细
-- 数据源：tip_orders（product_title/price_cents/support_delta 均为下单时商品目录快照）
-- status 状态机：created（待支付）→ delivered（已交付）/ expired（过期）；delivered → refunded（退款）。
-- 参数: :window_start, :window_end

SELECT
  to_char(t.created_at AT TIME ZONE 'Asia/Shanghai', 'MM-DD HH24:MI') AS created_at_cst,
  u.nickname                                          AS user_nickname,
  t.product_key                                       AS product_key,        -- encourage/coffee/server
  t.product_title                                     AS product_title,
  t.price_cents                                       AS price_cents,
  t.support_delta                                     AS support_delta,
  t.status                                            AS status,             -- created/delivered/refunded/expired
  to_char(t.paid_at      AT TIME ZONE 'Asia/Shanghai', 'MM-DD HH24:MI') AS paid_at_cst,
  to_char(t.delivered_at AT TIME ZONE 'Asia/Shanghai', 'MM-DD HH24:MI') AS delivered_at_cst,
  CASE
    WHEN t.delivered_at IS NOT NULL
    THEN EXTRACT(EPOCH FROM (t.delivered_at - t.created_at))::bigint
    ELSE NULL
  END                                                 AS deliver_seconds
FROM tip_orders t
JOIN users u ON u.id = t.user_id
WHERE t.created_at >= :'window_start'::timestamptz AND t.created_at < :'window_end'::timestamptz
ORDER BY t.created_at ASC;
