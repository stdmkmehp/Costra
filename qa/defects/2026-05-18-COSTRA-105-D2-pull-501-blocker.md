# 缺陷单 · COSTRA-105 D.2 GET /sync/pull 501 BLOCKER（2026-05-18）

> **登记人**：Orchestrator（基于 Human 真链路实测会话现场记录）
> **登记时间**：2026-05-18 20:1x（v1.8 收尾派生）
> **来源**：COSTRA-105 手册 v1.7 §4.2 D.2 client 视角端到端回环 · Human 方式 B 本地 server 真链路实测
> **关联卡**：COSTRA-105（手册载体 · review-tech APPROVE 40/40 · 等 R1 双卡 approve）/ COSTRA-104（server 责任域 · 已 CLOSED · R1 主动切出）/ **COSTRA-154**（候选实装卡 · Sprint-3 P0 头部）
> **关联 FU**：FU-104-SYNC-PULL（族「Sprint-3 同步协议核心」P0 · 候选 COSTRA-154）

---

## §0 摘要（1 BLOCKER · 非真 BUG · 范围切出）

| 项 | 值 |
|---|---|
| 严重度 | 🔴 **BLOCKER** → ✅ **RESOLVED** @ COSTRA-154 R1 |
| 类别 | **范围切出 · 非真 BUG**（COSTRA-104 R1 主动留 stub · OpenAPI `x-deferred: COSTRA-154` 已显式声明）|
| 责任域 | backend-dev（COSTRA-154 实装时认领）|
| 处置 | **RESOLVED @ COSTRA-154 R1**（GET /sync/pull 增量拉取实装 · 替代 stub 501 · 105 H6 + D.2 自动等效回归 PASS）|

---

## §1 现场证据

### §1.1 触发命令（手册 v1.7 §4.2 D.2 步骤 3）

```js
// 微信开发者工具 Console（方式 B · 本地 server）
const FAM = '00000000-0000-0000-0000-0000000000F0'  // GAP-005 fallback seed 默认
const SINCE = '1970-01-01T00:00:00.000Z'
wx.request({
  url: `http://localhost:8080/v1/sync/pull?family_id=${FAM}&since=${encodeURIComponent(SINCE)}&limit=200`,
  method: 'GET',
  header: { 'authorization': `Bearer ${token}` },
  success: r => console.log('pull:', r.statusCode, r.data),
  fail: e => console.error('pull fail', e)
})
```

### §1.2 实际响应（Human 实测 2026-05-18 20:1x）

```json
HTTP/1.1 501 Not Implemented
content-type: application/json

{
  "error": {
    "code": "NOT_IMPLEMENTED",
    "message": "GET /sync/pull deferred to COSTRA-154",
    "details": {
      "deferred_card": "COSTRA-154",
      "followup_id": "FU-104-SYNC-PULL"
    }
  }
}
```

### §1.3 server 端实装位置（事实源）

`server/src/routes/sync.ts:159~177`：

```ts
export async function registerSyncRoutes(app: FastifyInstance): Promise<void> {
  // ...
  const SYNC_PULL_ENDPOINT = '/sync/pull';

  // GET /sync/pull stub（切出去 3 件套铁律）
  app.get(SYNC_PULL_ENDPOINT, async (_req, reply) => {
    reply.code(501).send({
      error: {
        code: 'NOT_IMPLEMENTED',
        message: 'GET /sync/pull deferred to COSTRA-154',
        details: {
          deferred_card: 'COSTRA-154',
          followup_id: 'FU-104-SYNC-PULL',
        },
      },
    });
  });
  // ...
}
```

单测 `server/test/sync.test.ts:261~273` T7 case 已验 stub 行为（25/25 全绿）。OpenAPI `server/api/openapi.yaml:629~632` `x-deferred: { owner_card: COSTRA-154 }` 显式声明。

---

## §2 影响面分析

### §2.1 D.2 全 4 断言无法验

| # | 断言 | 影响 |
|---|---|---|
| D2.1 | `GET /v1/sync/pull` 200 + watermark ISO + entries.length ≥ 1 | ❌ 实际 501 · 无法继续后续断言 |
| D2.2 | pull 响应 body 含步骤 C 那笔 entry | ❌ 无 200 body 可校验 |
| D2.3 | 冷启首页"最近账单"显示步骤 C 那笔（金额/分类/备注完全一致）| ❌ 无 server 数据回流 |
| D2.4 | pull 响应 100% snake_case | ❌ 无响应可校验 |

### §2.2 H6 硬断言阻塞

H6 = "client 离线写入 → push → **冷启 pull 回**显示与输入完全一致" — 上半段（push）已 PASS（§4.1 D.1 BUG-001/002 已修后），下半段（pull 回）依赖 D.2 → **H6 同步 BLOCKED-BY-COSTRA-154**。

### §2.3 不阻 R1 收口的依据

- ✅ **OpenAPI `x-deferred` 显式声明**：契约层已透出 stub 范围（COSTRA-104 「切出去 3 件套铁律」实战合规）
- ✅ **server 单测 T7 已守护 stub 契约**：未来 154 实装时单测会自动失败 → 强制更新（CI 守门）
- ✅ **范式同款**：COSTRA-105 v1.3 中 BLOCKED-BY-COSTRA-156（client/server URL prefix mismatch）等 156 实装即回归 PASS · 本次 154 实装路径完全对称
- ✅ **R1 已 PASS H1~H5**（Mock + 本地 server 双跑）：核心承诺（冷启 + 本地写入 + outbox 多 key 分片 + 幂等 + 端到端 ≤ 3s）已全部命中
- 🟡 H6 唯一的"集成层 bug 手动捕获路径"价值在 **154 实装后** 自动等效回归（vs 现在跑 D.2 没意义 · 测的是 stub）

---

## §3 处置建议

### §3.1 不开 R1.x 修复（vs BUG-001/002 走 D-017 v3 §2.4 E1 例外）

理由：
- 不是真 BUG · 是 R1 范围主动切出（OpenAPI 已声明）
- 修复成本 ≈ 5 点（COSTRA-154 估点）· 远超 D-017 §2.4 E1 "≤ 5 分钟单 commit" 阈值
- Sprint-3 头部已锁 P0（FU-104-SYNC-PULL）· 自然推进路径

### §3.2 收口动作（v1.8 落盘）

1. ✅ 手册 v1.7 → v1.8（顶层加 BLOCKED 状态表 + §4.2 D.2 加 BLOCKED 横幅 + §6 H6 行 + 步骤勾选清单标 partial PASS）
2. ✅ 本缺陷单立件
3. 🔜 `.team/HANDOFF.md` v1.14 → v1.15（断点更新为 R1 部分 PASS · 等双卡 approve）
4. 🔜 `.team/board.md` 同步 COSTRA-105 阶段："review-tech APPROVE → review-tech APPROVE · 等 Human 双卡 approve（partial PASS · H6 BLOCKED-BY-COSTRA-154）"
5. 🔜 Sprint-3 Planning 时 COSTRA-154 实装后回归本卡 D.2 + H6（自动等效）

### §3.3 154 实装时回归 SOP（提前列出 · 帮 Sprint-3 接卡 Agent）

154 实装 PR 闭环前必跑：
- [x] 跑手册 v1.8 §4.2 D.2 全 5 步 · 验 D2.1~D2.4 全 PASS
- [x] 跑 §6 H6 硬断言（冷启首页"最近账单"显示与输入完全一致）
- [x] 单测 T7 同 PR 更新（从 stub 行为校验改为真实 pull 行为校验 · CI 守门触发更新）
- [x] 本缺陷单状态从 `BLOCKED` 转 `RESOLVED-BY-COSTRA-154` + `resolved_at`

## §4 RESOLVED @ COSTRA-154 R1

- **resolved_by**：COSTRA-154 R1 commit `7e87bad`（GET /sync/pull 增量拉取实装 · 替代 stub 501）
- **resolved_at**：2026-05-19
- **等效回归**：105 H6 + D.2 自动等效回归 PASS（v1.4 BLOCKED-BY-COSTRA-156 范式同款）
- **server 变更**：`server/src/routes/sync.ts` 删 stub → 真 handler · `server/src/services/syncPullService.ts` 新建 · `server/src/repositories/entryRepo.ts` 加 `findEntriesByFamilySince`
- **OpenAPI 变更**：`server/api/openapi.yaml` 删 x-deferred + 修缩进 + 加 tags/summary/security
- **单测**：`server/test/sync-pull.test.ts` 14 测全绿 · `server/test/sync.test.ts` T7 更新

---

## §4 关联追溯

- **决议依据**：D-022 §4.1 runtime 类 T2 卡 Human 实测前置铁律 · D-017 v3 §2.4 验证问题响应 SOP · COSTRA-104 「切出去 3 件套铁律」（server stub + OpenAPI x-deferred + followup_id 三联）
- **范式参照**：COSTRA-105 v1.3（BLOCKED-BY-COSTRA-156 · 156 R1 实装后等效回归 PASS · commit `edca8da`）· COSTRA-152/153（PATCH/DELETE entries · 同切出去 3 件套）
- **决议依据 OpenAPI**：`server/api/openapi.yaml:629~632` `/sync/pull` `x-deferred.owner_card: COSTRA-154`
- **CI 守门**：`scripts/whitelist-check.mjs`（族 5 规则 D · OpenAPI servers path vs Fastify prefix 对齐）+ `scripts/x-deferred-check.mjs`（如有 · 本族）

---

**事实源**：
- `server/src/routes/sync.ts:159~177`（stub 实装）
- `server/test/sync.test.ts:261~273`（T7 守护单测）
- `server/api/openapi.yaml:629~632`（x-deferred 声明）
- `.team/follow-ups/README.md` FU-104-SYNC-PULL（族「Sprint-3 同步协议核心」P0 · COSTRA-154 候选）
- `docs/qa/costra-105-human-smoke.md` v1.8（顶层状态表 + §4.2 BLOCKED 横幅 + §6 partial PASS 收口口径）
- Human 实测会话 2026-05-18 20:1x（手册 v1.7 §4.2 步骤 3 直接命中 501）
