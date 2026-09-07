/**
 * Costra · Server · tips（虚拟支付赞赏）路由
 *
 * 事实源：docs/design/monetization-tipping-tech-spec.md v1.2 §4.1/§4.2/§4.5
 *
 * 端点：
 *   POST /tips/orders                     下单（{product_key, code} → signData 三要素）
 *   GET  /tips/products                   商品目录 + purchasable
 *   GET  /tips/summary                    派生权益聚合 + fire-and-forget 加速探测
 *   PUT  /tips/summary/badge-visibility   徽章可见性开关
 *   GET  /tips/notify                     微信消息推送握手（echostr 回显 · text/plain + nosniff）
 *   POST /tips/notify                     虚拟支付明文 XML 推送（发货/退款/iOS 退款查询）
 *
 * 鉴权：用户端点一律 requireUserId（jwtVerify + token_type='access' 判定 · B0 新范式）；
 *       webhook 不走用户鉴权（微信平台回调 · 明文推送以 query_order 复核为唯一资金凭证）。
 */

import { createHash } from 'node:crypto';
import Ajv from 'ajv';
import type { FastifyInstance, FastifyReply } from 'fastify';
import { appEnv } from '../config/env.js';
import { ttl } from '../config/ttl.js';
import { AppError } from '../errors/AppError.js';
import { ErrorCode } from '../errors/ErrorCode.js';
import { requireUserId } from '../plugins/requireUser.js';
import * as tipOrderRepo from '../repositories/tipOrderRepo.js';
import * as tipService from '../services/tipService.js';
import { decodeXpayXml, XPAY_NOTIFY_ACK_XML } from '../wx/xpayNotifyDecoder.js';

// --- Schema ---

const createOrderBodySchema = {
  type: 'object',
  required: ['product_key', 'code'],
  additionalProperties: false,
  properties: {
    product_key: { type: 'string', minLength: 1, maxLength: 32 },
    code: { type: 'string', minLength: 1, maxLength: 128, description: 'wx.login() 返回的 code（下单时当场换取 session_key）' },
  },
} as const;

const badgeVisibilityBodySchema = {
  type: 'object',
  required: ['badge_hidden'],
  additionalProperties: false,
  properties: {
    badge_hidden: { type: 'boolean' },
  },
} as const;

// --- webhook 辅助 ---

function sendAck(reply: FastifyReply): FastifyReply {
  return reply.type('text/xml').send(XPAY_NOTIFY_ACK_XML);
}

/**
 * 回 retry（tech-spec §4.3.1 执行层）：仅 schedule_probe / retry 决策与租约竞争失败时
 * 返回非成功响应，让平台按重试策略再次推送（15 次 · 重推仍受租约节流）。
 */
function sendRetry(reply: FastifyReply): FastifyReply {
  return reply.code(500).type('text/plain').send('retry');
}

export async function registerTipsRoutes(app: FastifyInstance): Promise<void> {
  // tips 路由族独立封装层 + 独立 validator：契约外字段（channel / device_platform /
  // query 参数）必须 400 拒绝（tech-spec v1.2 §10 防渠道维度回退）。
  // 不复用 Fastify 默认 AJV 的 removeAdditional 静默剥离行为；
  // 独立 register 作用域保证 strict validator 不污染 v1 内其他路由族的既有行为。
  await app.register(async (tips) => {
    // coerceTypes 必须为 false：开着它，`badge_hidden: "true"` / `1` 会被静默强转成布尔，
    // 与本作用域「契约外输入一律 400」的取向自相矛盾。tips 全部入参来自 JSON body
    // （无 path/query 的数字或布尔参数），关闭它不影响任何合法请求。
    const strictAjv = new Ajv({ coerceTypes: false, removeAdditional: false, allErrors: false });
    tips.setValidatorCompiler(({ schema }) => strictAjv.compile(schema));

  // POST /tips/orders · 下单
  tips.post<{ Body: { product_key: string; code: string } }>(
    '/tips/orders',
    { schema: { body: createOrderBodySchema } },
    async (req, reply) => {
      const userId = await requireUserId(req);
      const result = await tipService.createTipOrder({
        userId,
        productKey: req.body.product_key,
        code: req.body.code,
        log: req.log,
      });
      req.log.info({ action: 'tip.order.create', userId, outTradeNo: result.outTradeNo }, 'tip order created');
      reply.code(200).send({
        out_trade_no: result.outTradeNo,
        pay_data: {
          signData: result.payData.signData,
          paySig: result.payData.paySig,
          signature: result.payData.signature,
          mode: result.payData.mode,
        },
      });
    },
  );

  // GET /tips/products · 商品目录（无 query 参数 · 无渠道维度 · tech-spec §10 防回退）
  tips.get(
    '/tips/products',
    { schema: { querystring: { type: 'object', additionalProperties: false } } },
    async (req, reply) => {
      const userId = await requireUserId(req);
      reply.code(200).send(tipService.listTipProducts(userId));
    },
  );

  // GET /tips/summary · 派生权益聚合（fire-and-forget 加速探测在 service 内 · 不 await）
  tips.get('/tips/summary', async (req, reply) => {
    const userId = await requireUserId(req);
    const summary = await tipService.buildTipSummary(userId, req.log);
    reply.code(200).send(summary);
  });

  // PUT /tips/summary/badge-visibility · 徽章可见性开关（tech-spec §4.7 · body {badge_hidden}）
  tips.put<{ Body: { badge_hidden: boolean } }>(
    '/tips/summary/badge-visibility',
    { schema: { body: badgeVisibilityBodySchema } },
    async (req, reply) => {
      const userId = await requireUserId(req);
      const hidden = req.body.badge_hidden;
      await tipOrderRepo.setBadgeHidden(userId, hidden);
      const agg = await tipOrderRepo.aggregateTipSummary(userId);
      const supporterBadge = agg.tipCount > 0;
      reply.code(200).send({
        badge_hidden: hidden,
        badge_visible: supporterBadge && !hidden,
      });
    },
  );

  // webhook（独立封装作用域：注册 XML 明文 content-type parser · bodyLimit 64KB）
  await tips.register(async (notify) => {
    // text/xml + application/xml 为微信推送实际 Content-Type；text/plain 与 application/octet-stream
    // 为零成本兜底（tech-spec §4.2.0：多注册几个 MIME 防止推送方 Content-Type 漂移直接 415）。
    // application/json 由 Fastify 默认解析器继承，无需重复注册。
    notify.addContentTypeParser(
      ['text/xml', 'application/xml', 'text/plain', 'application/octet-stream'],
      { parseAs: 'buffer' },
      (_req, body, done) => {
        done(null, body);
      },
    );

    // GET /tips/notify · 消息推送握手（tech-spec §4.2.1 GET 回显约束）
    notify.get('/tips/notify', async (req, reply) => {
      const q = req.query as {
        signature?: string;
        timestamp?: string;
        nonce?: string;
        echostr?: string;
      };
      const token = appEnv().wxMsgPushToken;
      if (token) {
        // 配置了 token 即强制校验：签名参数缺失或 mismatch 一律 401
        const valid =
          q.signature != null &&
          q.timestamp != null &&
          q.nonce != null &&
          createHash('sha1').update([token, q.timestamp, q.nonce].sort().join('')).digest('hex') ===
            q.signature;
        if (!valid) {
          throw new AppError(ErrorCode.UNAUTHENTICATED, { message: 'invalid msg signature' });
        }
      }
      reply.type('text/plain').header('X-Content-Type-Options', 'nosniff');
      const echostr = q.echostr;
      if (echostr && echostr.length <= 128 && /^[A-Za-z0-9_-]+$/.test(echostr)) {
        reply.send(echostr);
        return;
      }
      reply.send('success');
    });

    // POST /tips/notify · 虚拟支付明文 XML 推送
    notify.post('/tips/notify', { bodyLimit: 64 * 1024 }, async (req, reply) => {
      let signal;
      try {
        signal = decodeXpayXml(req.body as Buffer);
      } catch (err) {
        // POST handler 内自行捕获（tech-spec §4.2.4 · 不复用面向客户端的 JSON errorHandler）：
        // 解析失败回 400 文本，平台按非成功回包重推，下一份明文包仍可恢复
        req.log.warn({ err }, 'xpay notify decode failed · 400 for platform retry');
        return reply.code(400).type('text/plain').send('fail');
      }

      switch (signal.event) {
        case 'unknown':
          req.log.debug({ eventName: signal.eventName, authenticated: signal.authenticated }, 'xpay notify unknown event');
          return sendAck(reply);
        case 'ios_refund_query':
          req.log.info({ authenticated: signal.authenticated }, 'xpay ios refund query notify (no action)');
          return sendAck(reply);
        case 'refund_succeeded':
          // 只告警 + 成功回包（不做自动资金变更 · 人工复核入口）
          req.log.warn(
            {
              wxOrderId: signal.wxOrderId,
              mchOrderId: signal.mchOrderId,
              refundFee: signal.refundFee,
              retCode: signal.retCode,
              authenticated: signal.authenticated,
            },
            'xpay refund notify received · manual reconcile required',
          );
          return sendAck(reply);
        case 'goods_delivery':
          break;
      }

      // goods_delivery：查单 → 状态守卫 → 弱校验 → 租约 → query_order 复核
      const order = await tipOrderRepo.findByOutTradeNo(signal.outTradeNo);
      if (!order) {
        req.log.warn({ outTradeNo: signal.outTradeNo }, 'xpay notify for unknown order · no query_order');
        return sendAck(reply);
      }
      if (order.status === 'delivered' || order.status === 'refunded') {
        req.log.warn({ outTradeNo: signal.outTradeNo, status: order.status }, 'xpay notify for terminal order · ack only');
        return sendAck(reply);
      }
      if (order.status === 'expired') {
        req.log.error(
          { outTradeNo: signal.outTradeNo },
          'xpay notify arrived for expired order · manual conflict (no state change)',
        );
        return sendAck(reply);
      }

      // created：推送字段弱校验（只告警不阻断 · 资金判定交给 query_order 复核）
      if (signal.quantity != null && signal.quantity !== 1) {
        req.log.warn({ outTradeNo: signal.outTradeNo, quantity: signal.quantity }, 'notify Quantity != 1');
      }
      if (signal.productId != null && signal.productId !== order.wxProductId) {
        req.log.warn(
          { outTradeNo: signal.outTradeNo, productId: signal.productId, expect: order.wxProductId },
          'notify ProductId mismatch',
        );
      }

      // 探测租约（webhook 与 scheduler/summary 共用 · 抢不到 ⇒ 回 retry 让平台重推）
      const claimed = await tipOrderRepo.claimProbe(signal.outTradeNo, ttl().tipProbeMinIntervalSec);
      if (!claimed) {
        return sendRetry(reply);
      }
      const fresh = await tipOrderRepo.findByOutTradeNo(signal.outTradeNo);
      if (!fresh || fresh.status !== 'created') {
        return sendAck(reply);
      }

      const decision = await tipService.probeAndApply(fresh, 'notify', req.log);
      if (decision.type === 'schedule_probe' || decision.type === 'retry') {
        return sendRetry(reply);
      }
      return sendAck(reply);
    });
  });
  });
}
