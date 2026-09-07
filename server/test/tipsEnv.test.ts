/**
 * Costra · Server · 虚拟支付 env 配置单测
 *
 * 事实源：tech-spec v1.2 §2.5 / §10.1
 *
 * 覆盖：
 *   E1  WX_PAY_MODE 白名单解析：off/allowlist/on 通过 · 非法值启动失败
 *   E2  WX_PAY_TEST_USER_IDS 非法 UUID ⇒ 启动失败
 *   E3  非 off 模式缺 WX_PAY_OFFER_ID / WX_PAY_APP_KEY ⇒ 启动失败；off 模式可缺省
 *   E4  不存在 WX_PAY_WEBHOOK_CODEC / WX_PAY_QUERY_ORDER_URL / WX_STABLE_TOKEN_URL 环境变量
 *       （v1.2 已删除的三态 codec 与 URL 覆盖 · 防回潮静态检查）
 *   E5  B2 发布闸门：wx_product_id 占位未回填 ⇒ assertTipProductsPublishable 抛错
 *   E6  migration 0020 生产 DDL 静态断言（pg-mem 侧无 CHECK ⇒ 只能查源文件）
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { loadEnv } from '../src/config/env.js';
import {
  assertTipProductsPublishable,
  listUnpublishedProducts,
  TIP_PRODUCTS,
  WX_PRODUCT_ID_PLACEHOLDER_PREFIX,
  type TipProduct,
} from '../src/config/tipProducts.js';

const BASE_ENV: NodeJS.ProcessEnv = {
  NODE_ENV: 'test',
  DATABASE_URL: 'postgres://mock:mock@127.0.0.1:5432/costra_test',
  REDIS_URL: 'redis://127.0.0.1:6379/0',
  JWT_SECRET: 'test-secret-aaaaaaaaaaaaaaaaaaaaaaaa',
  JWT_AUDIENCE: 'wx-test-appid',
  WX_APP_ID: 'wx-test-appid',
  WX_APP_SECRET: 'wx-test-appsecret',
};

describe('tips env 解析（tech-spec §2.5）', () => {
  it('E1 · WX_PAY_MODE 白名单：off/allowlist/on 通过 · 非法值抛错', () => {
    for (const mode of ['off', 'allowlist', 'on'] as const) {
      const cfg = loadEnv({
        ...BASE_ENV,
        WX_PAY_MODE: mode,
        WX_PAY_OFFER_ID: 'o',
        WX_PAY_APP_KEY: 'k',
      });
      expect(cfg.wxPayMode).toBe(mode);
    }
    expect(() => loadEnv({ ...BASE_ENV, WX_PAY_MODE: 'prod' })).toThrow(/WX_PAY_MODE/);
    expect(() => loadEnv({ ...BASE_ENV, WX_PAY_MODE: 'test' })).toThrow(/WX_PAY_MODE/);
  });

  it('E2 · WX_PAY_TEST_USER_IDS 非法 UUID ⇒ 抛错；合法列表通过', () => {
    expect(() =>
      loadEnv({ ...BASE_ENV, WX_PAY_MODE: 'allowlist', WX_PAY_OFFER_ID: 'o', WX_PAY_APP_KEY: 'k', WX_PAY_TEST_USER_IDS: 'not-a-uuid' }),
    ).toThrow(/WX_PAY_TEST_USER_IDS/);

    const cfg = loadEnv({
      ...BASE_ENV,
      WX_PAY_MODE: 'allowlist',
      WX_PAY_OFFER_ID: 'o',
      WX_PAY_APP_KEY: 'k',
      WX_PAY_TEST_USER_IDS: '123e4567-e89b-42d3-a456-426614174000, 123e4567-e89b-42d3-a456-426614174001',
    });
    expect(cfg.wxPayTestUserIds).toEqual([
      '123e4567-e89b-42d3-a456-426614174000',
      '123e4567-e89b-42d3-a456-426614174001',
    ]);
  });

  it('E3 · 非 off 模式缺 OfferID/AppKey ⇒ 抛错；off 模式可缺省（默认 off）', () => {
    expect(() => loadEnv({ ...BASE_ENV, WX_PAY_MODE: 'on' })).toThrow(/WX_PAY_OFFER_ID/);
    expect(() => loadEnv({ ...BASE_ENV, WX_PAY_MODE: 'on', WX_PAY_OFFER_ID: 'o' })).toThrow(/WX_PAY_APP_KEY/);
    expect(() => loadEnv({ ...BASE_ENV, WX_PAY_MODE: 'allowlist', WX_PAY_OFFER_ID: 'o', WX_PAY_APP_KEY: 'k' })).not.toThrow();

    // 默认 off：无需支付配置即可启动（B13 灰度第①步场景）
    const cfg = loadEnv({ ...BASE_ENV });
    expect(cfg.wxPayMode).toBe('off');
    expect(cfg.wxPayOfferId).toBeUndefined();
  });

  it('E4 · 已删除的三态 codec / URL 覆盖 env 不得回潮（静态检查）', () => {
    // vitest 从 server/ 目录运行（tsconfig module=CommonJS · 不可用 import.meta）
    const envSrc = readFileSync(`${process.cwd()}/src/config/env.ts`, 'utf8');
    for (const banned of ['WX_PAY_WEBHOOK_CODEC', 'WX_PAY_QUERY_ORDER_URL', 'WX_STABLE_TOKEN_URL', 'WX_XPAY_QUERY_ORDER_URL']) {
      expect(envSrc.includes(banned), `env.ts must not reference ${banned}`).toBe(false);
    }
  });
});

describe('tips 商品目录 · B2 发布闸门（tech-spec §5.4 / §12 B2）', () => {
  const filled: TipProduct[] = TIP_PRODUCTS.map((p) => ({ ...p, wxProductId: `real-${p.productKey}` }));

  it('E5 · 占位未回填 ⇒ 抛错并列出档位；全部回填 ⇒ 通过', () => {
    // 当前目录仍是占位（B2 未完成）：闸门必须拦住，且错误信息点名档位
    expect(listUnpublishedProducts()).toEqual(TIP_PRODUCTS.filter((p) => p.enabled).map((p) => p.productKey));
    expect(() => assertTipProductsPublishable()).toThrow(/wx_product_id/);
    expect(() => assertTipProductsPublishable()).toThrow(/coffee/);

    // B2 回填后：闸门放行（未来回填真实道具 ID 时本用例自动转绿，无需改动）
    expect(listUnpublishedProducts(filled)).toEqual([]);
    expect(() => assertTipProductsPublishable(filled)).not.toThrow();
  });

  it('E5b · 禁用档位不参与闸门判定（enabled=false 的占位不阻塞启动）', () => {
    const disabledPlaceholder: TipProduct[] = [
      ...filled,
      { ...TIP_PRODUCTS[0]!, productKey: 'legacy', wxProductId: `${WX_PRODUCT_ID_PLACEHOLDER_PREFIX}legacy`, enabled: false },
    ];
    expect(listUnpublishedProducts(disabledPlaceholder)).toEqual([]);
  });

  it('E6 · migration 0020 生产 DDL：status CHECK 四态且不含 unresolved（pg-mem 无 CHECK ⇒ 静态断言）', () => {
    const sql = readFileSync(`${process.cwd()}/db/migrations/0020_tips.sql`, 'utf8');
    const check = /CHECK \(status IN \(([^)]+)\)\)/.exec(sql);
    expect(check).not.toBeNull();
    const states = check![1]!.split(',').map((s) => s.trim().replace(/'/g, ''));
    expect(states.sort()).toEqual(['created', 'delivered', 'expired', 'refunded']);
    expect(sql.includes('unresolved')).toBe(false);
    // upstream_order_type 可空（原值留痕列 · 不得加 NOT NULL）
    expect(sql).toMatch(/upstream_order_type\s+SMALLINT\s*,/);
    // 探测索引在生产侧保留（pg-mem 侧按 §3.5 跳过）
    expect(sql).toContain('idx_tip_orders_probe_due');
  });
});
