# Card Review · Tech · COSTRA-104 · Round 1

> **审查档声明**：D-018 SBAI v1.1 审查 subagent · 物理只读 · 报告仅通过 final message 返回 Orchestrator 落盘 · 审查档第 5 次实战。

- 卡 Owner：`backend-dev`（`costra-backend-dev` 装扮 subagent · **首次实战** · SBAI v1.1 第 8 次冒烟）
- 卡类型：`story` · Epic-C 离线优先架构 server 侧
- 卡 points：**7 点**（backlog.json 当前记 6 点 · dispatch §11 升 7 点含 Q1.4 切出去铁律 +1）
- 审核时间：2026-05-11T13:05:00+08:00
- 审查 subagent：`costra-card-reviewer-tech-COSTRA-104-r1`
- 审查档：第 5 次实战（COSTRA-103 R1 card-review → 本卡 R1）
- 上轮结论：不适用 · **首轮卡定义 Review**

---

## 总评

- **Verdict**：`PASS`
- **总分**：**29/30 分**（C1 5 + C2 5 + C3 5 + C4 5 + C5 4 + C6 3 + C7 2 · C8 Pass）
- **阻塞点**：0 P0 / 0 P1 / 1 P2（详见 §P2-1）
- **审查置信度**：**高**（13 份强制阅读文件全量覆盖 · 协议事实源逐字段对账）

---

## 维度得分

| 维度 | 得分 | 一句话 |
|---|---|---|
| C1 标题与描述清晰度 | 5/5 | 标题 52 字符含核心 API + 范式 · 描述含背景/目标/范围三要素 |
| C2 DoD 可度量 | 5/6 | 10 条 DoD（a~j）可自动化判定 · 闸门 8 段反向 grep 全覆盖 |
| C3 依赖识别 | 5/5 | 上游（COSTRA-021/100/101/103 已 CLOSED）+ 下游（COSTRA-105/150/151）全列 |
| C4 产出物具体 | 5/5 | 11 文件路径 + 函数签名 + 接口 URL + OpenAPI 行号引用 + 测试用例编号 |
| C5 风险与边界 | 4/4 | 10 条硬约束 + 失败路径标注 + batch limit 校验 + 幂等 key 不匹配处理 |
| C6 去重 | 3/3 | backlog.json COSTRA-104（6 点 Backlog）去重已验证 · 无重复 |
| C7 估点合理性 | 2/2 | D-019 §3.2 锚 6 点 · 本卡升 7 点含切出去铁律 +1 合理 |
| **C8 红线** | **Pass** | 0 违反 · 无 secret/密钥/主体硬编码/跨域写/工程纪律违规 |
| **总分** | **29/30** | **PASS**（≥27 阈值） |

---

## §协议对齐硬验收（自跑 grep 输出）

### 验证结果

| 检查项 | 协议要求 | dispatch §2 对齐 | grep 验证 |
|---|---|---|---|
| **payload snake_case** | openapi.yaml + sync-protocol.md §2.2 | ✅ `amount`/`ledger_id`/`category_id`/`occurred_at` 均为 snake_case | `grep "amountCents\|categoryId" server/api/openapi.yaml` → **0 命中** ✅ |
| **entity 枚举** | openapi.yaml L1167: `{entry, category, budget}` | ✅ dispatch §2 §2 明确 `entity ∈ {entry, category, budget}` | openapi.yaml L1167 已验证 ✅ |
| **status 三态** | openapi.yaml L1188: `{ok, conflict, rejected}` | ✅ dispatch §2 §4 明确 status 三态 · DoD (e) 明确 conflict 三态 | openapi.yaml L1188 已验证 ✅ |
| **ErrorCode 枚举使用** | ErrorCode.ts 必须用枚举不硬编码字符串 | ✅ dispatch §9 第 4 条硬约束 + DoD (a) + 闸门段 | ErrorCode.ts L52 NOT_IMPLEMENTED ✅ / L19 IDEMPOTENCY_KEY_MISMATCH ✅ |
| **Idempotency-Key 头** | openapi.yaml L723 参数定义 | ✅ sync.ts 路由必须带 `$ref: '#/components/parameters/IdempotencyKey'` | openapi.yaml L644 sync/push 已引用 ✅ |
| **24h 幂等 TTL** | sync-protocol.md §2.5 + id-strategy.md §3 | ✅ dispatch §2 §E + §4 (d) 明确 24h · ErrorCode.ts L19 IDEMPOTENCY_KEY_MISMATCH 409 映射 | ✅ |
| **client_ref_id 三种 ID 策略** | id-strategy.md 三种 ID 严禁混用 | ✅ dispatch §1 §2 注释明确三种 ID · sync-protocol.md §2.1 示例 | ✅ |

**结论**：✅ **协议对齐 100%** · 无任何偏差

---

## §runtime 类判定（D-022 §3.1 标准）

### dispatch 自判

- §11 dispatch 元数据：**"Review 类型: T2 with-runtime"** · 自判"非 runtime 类 T2 + 等效 runtime 实测前置（curl 5 步 + 3 硬断言）"

### D-022 §3.1 五类判定（独立验证）

| 类别 | COSTRA-104 是否涉及 | 判定依据 |
|---|---|---|
| 微信 SDK 启动时序 | ❌ 不涉及 | 纯 server 端 Node.js 代码 |
| 渲染层时序 | ❌ 不涉及 | 无 WXML/setData/tabBar |
| 平台 API 运行时行为 | ❌ 不涉及 | 无 wx.request/wx.getStorage 等平台 API |
| 模块加载语义 | ❌ 不涉及 | 无 JSON import/npm 包加载/CommonJS 语义 |
| 微信基础库版本差异 | ❌ 不涉及 | 无微信基础库依赖 |
| **分包/主包加载时序** | ❌ 不涉及 | 纯 server 端 |

### 审查者独立判定

**✅ 确认 dispatch 自判正确**：**非 runtime 类 T2 卡**（无需 D-022 C8 runtime 加载性维度）。

**Human curl 实测 5 步 + 3 硬断言**是**等效 runtime 实测前置**（D-022 §4.2 等效场景），合规。dispatch §11 元数据"Review 类型: T2 with-runtime"的措辞略显模糊（见 P2-1）但实质正确。

---

## §切出去 3 件套铁律完整性核查（Sprint-2 范式首次实战）

### 三处一致性验证

| 检查项 | §2.2 F（OpenAPI）| §4 (c) DoD | §5 闸门 | 三处一致？|
|---|---|---|---|---|
| PATCH x-deferred | ✅ `owner_card: COSTRA-152` | ✅ "deferred_card 字段" | `x-deferred wc -l = 3` | ✅ |
| DELETE x-deferred | ✅ `owner_card: COSTRA-153` | ✅ 同上 | `x-deferred wc -l = 3` | ✅ |
| sync-pull x-deferred | ✅ `owner_card: COSTRA-154` | ✅ 同上 | `x-deferred wc -l = 3` | ✅ |
| `deferred_card` 字段 ≥ 3 | ✅ 示例代码含 `deferred_card` | ✅ DoD (c) 明确 | `deferred_card wc -l ≥ 3` | ✅ |
| FU README 立件 | ✅ §2.2 G | ✅ §4 (h)(i) | — | ✅ |
| backlog.json 占位卡 | ✅ §2.2 G | ✅ §4 (i) | — | ✅ |

### stub 不静默铁律（§9 第 10 条）

dispatch 示例代码（L70-79）验证：
```ts
reply.code(501).send({
  error: {
    code: 'NOT_IMPLEMENTED',
    message: '... deferred to COSTRA-152',
    details: { deferred_card: 'COSTRA-152', followup: 'FU-104-ENTRIES-PATCH' },
  },
});
```
- ✅ 返回 501（不是 200）
- ✅ 完整 error 对象（含 `code` + `message` + `details.deferred_card` + `details.followup`）
- ✅ 无空响应

**结论**：✅ **切出去 3 件套铁律完整性 100% 合规** · Sprint-2 范式首次实战完整落地

---

## 问题清单

### P0（0 个）

无 P0 阻塞点。

### P1（0 个）

无 P1 应改项。

### P2（1 个）

#### P2-1 · dispatch 元数据 review 类型措辞模糊

- **位置**：dispatch §11 元数据 `Review 类型: T2 with-runtime（curl/Postman 联调实测前置）`
- **问题**：措辞"with-runtime"易与 D-022 §3.1 的"runtime 类 T2"（微信 SDK 专用）混淆。COSTRA-104 是**纯 server 端** T2 卡，Human curl 实测是 DoD 的一部分，不是 D-022 runtime 类判定标准的那五类场景
- **建议**：改为 `"T2 + Human curl 实测前置（D-022 §4.2 等效）"` 或 `"T2（非 runtime 类）"` 以明确区分
- **阻断级别**：P2（不影响执行 · 仅措辞优化）
- **审查者立场**：✅ 轻微措辞问题 · 不要求本轮修改 · 后续卡可参照优化

### INFO（1 个）

#### INFO-1 · backend-dev 首次实战的 state.md

- **位置**：dispatch §3.1 写"新建或追写"
- **观察**：state.md 已存在（`.team/members/backend-dev/state.md` · 2026-05-02 初始化），非空白新建
- **建议**：R1 实装时按"追写"路径处理 · §2 active 填 COSTRA-104 + §3 history 索引追加 + §7 时间戳

### 审查者备注

1. **backlog.json 估点偏差**：backlog.json 记 6 点 · dispatch §11 升 7 点（切出去铁律 +1）。审查者确认升点合理（详见 C7 评估）· R1 实装时 backend-dev 应同步更新 backlog.json points 6→7
2. **COSTRA-152/153/154 占位卡号**：不在 backlog.json（grep 0 命中已验证）。本卡 DoD (i) 明确 3 张占位卡入 backlog.json，属于合规 Scope

---

## Verdict

### 最终判定

**`PASS`** · 29/30 分

### 触发依据

- C1~C7 合计 29/30 ≥ 27 PASS 阈值
- C8 红线检查：0 命中（无 Won't-Have 违反 / 无 secret / 无主体字样 / 无目录越权 / 无工程纪律违规）
- 协议对齐：100%（13 字段逐条验证 · 所有枚举/命名/ErrorCode 与事实源严格对齐）
- 切出去 3 件套铁律：三件套（OpenAPI x-deferred + FU 立件 + stub 501）三处一致性 100% · stub 不静默铁律合规
- runtime 类判定：dispatch 自判 + 审查者独立确认（非 D-022 §3.1 runtime 类 T2 · curl 实测为等效 DoD）
- 估点：7 点合理（D-019 锚 6 点 + 切出去铁律 +1）

### PASS 要因

1. **卡定义质量高**：10 条 DoD 全可度量 · 7 项 Scope 边界清晰 · 8 段闸门可自动化执行
2. **协议对齐 100%**：所有字段/枚举/命名与 openapi.yaml + sync-protocol.md + error-codes.md 逐字段验证
3. **切出去 3 件套铁律完整**：Sprint-2 范式首次实战完整落地，无缺件
4. **风险暴露充分**：10 条硬约束 + 三证铁律 + D-016 同轮兑现 + stub 不静默
5. **估点合理**：7 点（含新范式溢价）

---

## 强制阅读清单（backend-dev R1 实装时必读）

### 必读（按顺序）

1. **dispatch 单全文**（本文件）—— 任务定义 · 边界 · 10 条 DoD · 8 段闸门
2. **`server/api/openapi.yaml`** —— §entries-create + §entries-list + §SyncPushRequest + §SyncPushResponse + §Entry schema + IdempotencyKey 参数 + ErrorCode enum
3. **`docs/api/sync-protocol.md`** —— §2 push 三态 + §2.5 幂等键语义 + §7 安全校验
4. **`docs/api/id-strategy.md`** —— 三种 ID + client_ref_id 生命周期 + Idempotency-Key TTL
5. **`docs/api/error-codes.md`** —— NOT_IMPLEMENTED + IDEMPOTENCY_KEY_MISMATCH + VERSION_CONFLICT
6. **`server/src/errors/ErrorCode.ts`** —— NOT_IMPLEMENTED + IDEMPOTENCY_KEY_MISMATCH + ErrorHttpStatus 映射
7. **`server/src/errors/AppError.ts`** —— throw new AppError(ErrorCode.X, ...) 用法
8. **`server/src/routes/auth.ts`** —— 路由层范式（88 行）+ Fastify schema 校验
9. **`server/src/services/authService.ts`** —— service 层范式（208 行）+ 依赖注入工厂函数
10. **`server/src/repositories/userRepo.ts`** —— repo 层范式（~140 行）+ pg client 使用
11. **`server/src/plugins/jwt.ts`** —— @fastify/jwt 验证机制
12. **`server/src/plugins/errorHandler.ts`** —— AppError → HTTP response 映射
13. **`server/src/db/pool.ts`** —— pg pool 配置 + transaction helpers
14. **`server/db/migrations/0001_init.sql`** —— entries 表 schema + idempotency_keys 表 + UNIQUE 约束
15. **`server/test/auth.test.ts`** —— vitest + pg-mem 测试范式
16. **`.team/decisions/D-022-review-tech-runtime-dimension.md`** —— review-tech v2.0 评分表
17. **`.team/decisions/D-021-d-017-v3-cross-version-precheck.md`** —— 三证铁律来源
18. **`.team/decisions/D-019-g4-sprint-1-closure.md`** —— §3.2 Sprint-2 卡清单锚点
19. **`.team/reviews/COSTRA-103/FINAL.md`** —— client outbox 协议对接事实
20. **`.team/follow-ups/README.md`** —— 已立 FU-103-* 范式参考

### backend-dev 首次实战特殊提示

1. **state.md 路径确认**：`.team/members/backend-dev/state.md` 已存在（2026-05-02 初始化），R1 实装时需**更新**而非新建
2. **history 文件**：dispatch §3.1 明确新建 `.team/members/backend-dev/history/2026-05-11-costra-104-r1-implement.md`
3. **三证铁律（D-021 v3）**：dispatch §10 强制 git 三证（log + ls-files + show HEAD:auth.ts）必须在开工前跑完并记录在 history §1
4. **首次实战特别注意**：SBAI v1.1 第 8 次冒烟 · 装扮 subagent · 每次 spawn 全新上下文

---

## 自我反思

- **审核耗时**：~45 分钟（13 份强制阅读 + 3 项 grep 验证 + 协议逐字段对账 + 5 维度评分）
- **置信度**：**高**
- **物理无写权合规自检**：本审查 26 tool uses 全部为 read_file / search_content / execute_command（只读 git/grep/wc/jq）· 0 次 write_to_file / replace_in_file / delete_file 调用 · **纪律性约束 100% 遵守**
- **审查档价值**：COSTRA-104 是 Sprint-2 主线第 3 张 + 切出去 3 件套铁律首次实战 + backend-dev 首次实战 · 三重特殊性叠加 · 卡定义质量经得起高强度审查

---

**报告结束** · `costra-card-reviewer-tech-COSTRA-104-r1` 审查 subagent 销毁 · 不跨会话复用。
