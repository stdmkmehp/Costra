# Tech Review · COSTRA-103 R1 · Round 1 · D-022 v2.0 首次实战

## 元数据

- **被审 Agent**：`miniapp-dev`（装扮 subagent · D-018 SBAI v1.1 · 第 7 次冒烟）
- **本轮产出 commit**：`561e884`（HEAD · `chore: backlog title sync + d-017 step2 diagnosis`）
- **审核时间**：2026-05-09T18:40+08:00
- **审核 subagent**：`costra-review-tech-COSTRA-103-r1`（D-018 SBAI v1.1 审查档第 4 次实战）
- **覆盖范围**：COSTRA-103 R1 实装产出（D-022 v2.0 评分表 40 分制首次实战）
- **产出文件清单（9~10 文件）**：

| 文件 | 行数 | 类型 |
|---|---|---|
| `miniprogram/services/db.ts` | 273 | 主代码 |
| `miniprogram/services/outbox.ts` | 296 | 主代码 |
| `miniprogram/utils/id.ts` | 33 | 工具 |
| `miniprogram/services/sync.ts` | 103 | 重构 |
| `miniprogram/pages/entry/index.ts` | 90 | 接入 |
| `miniprogram/services/db.spec.ts` | 104 | 测试 |
| `miniprogram/services/outbox.spec.ts` | 124 | 测试 |
| `docs/qa/costra-103-human-verify.md` | 257 | Human 实测手册 |

- **参照事实源**：
  - `.team/dispatch/COSTRA-103-miniapp-local-persistence-outbox.md`（验收基准）
  - `.team/reviews/COSTRA-103/card-review-round-1-tech.md`（卡审 PASS-WITH-FOLLOWUP 26.5/30）
  - `.team/reviews/COSTRA-103/d-017-step2-r1.3-diagnosis.md`（D-017 v3 诊断报告）
  - `.team/decisions/D-022-review-tech-runtime-dimension.md`（v2.0 评分表）
  - `.team/decisions/D-021-d-017-v3-cross-version-precheck.md`（三证铁律）
  - `.team/decisions/D-020-d-016-final-canonical.md`（同轮兑现规约）
  - `docs/api/sync-protocol.md` / `id-strategy.md` / `error-codes.md`（协议事实源）

**D-022 v2.0 首次实战声明**：

> 本次审查是 D-022 v2.0 评分表（35→40 分制）首次实战：
> - 新增 **C8 runtime 加载性**维度（5 分）—— COSTRA-103 命中平台 API 运行时行为 + 微信基础库版本差异两类 runtime 类 T2 判定
> - 新增 **C10 SBAI 流程合规**维度（2 分）—— D-016 同轮兑现 + D-021 三证铁律 + D-017 v3 流程合规 + state.md/history 完整
> - 评分严格按 v2.0 执行

---

## 结论速览

**Verdict**：`APPROVE`
**总分**：**38/40** 分
**阻塞点**：0 P0 · 0 P1 · 1 P2（minor）

**关键判断**（≤ 5 行）：
1. R1.3 fix commit `6c0b404` 正确实现了 D-017 Step 2 方案 A（off-by-1 + handleRetry 死代码清理），测试 34/34 全绿 ✅
2. 协议对齐 100%：payload snake_case / entity 枚举 / 三种 ID 不混用 / idempotency_key 持久化 / 重试策略指数退避
3. D-022 v2.0 runtime 类 T2 命中：Human 实测手册 5 步 + 5 硬断言齐全（D-022 §4.1 强制铁律）
4. D-016 同轮兑现合规：2 commit + state/history 同轮落盘（c8b6c06 + 561e884）
5. 唯一 P2：1e723c7 commit message 中 `commit cb3a83b` 应为 `commit 1e723c7`（hash 笔误），不影响功能但建议修复

---

## D-022 v2.0 评分表实战

| 维度 | 满分 | 得分 | 证据源 |
|---|---|---|---|
| C1 · 合约合规（契约/接口/数据格式）| 6 | **6** | db.ts Entry 接口 100% snake_case（`client_ref_id`/`amount`/`category_id`/`occurred_at`）；outbox.ts SyncOp entity 枚举 `entry\|category\|budget`；base_version null 语义；idempotency_key `idem-{timestamp}-{random}` 前缀；重试指数退避 2s→1h |
| C2 · 类型严格性 | 5 | **5** | `tsc --noEmit` → 0 errors；db.ts/outbox.ts 类型签名精准（Omit/Pick/泛型 EntityEnvelope）；无 any 滥用 |
| C3 · 不变量守护 | 5 | **5** | COSTRA-125 async 不变量：0 `wx.setStorageSync`/`wx.getStorageSync` 泄漏（grep 验证）；三种 ID 不混用（client_ref_id v4/Idempotency-Key v4/服务端 id v7）；recover 重试幂等 |
| C4 · 测试覆盖 | 4 | **4** | db.spec.ts 7 测 + outbox.spec.ts 6 测 = 13 测（≥ 5+3 DoD 要求）；覆盖 conflict 重入 + 截断剩余 + ok/rejected 三态；34/34 全绿 |
| C5 · lint/格式合规 | 3 | **3** | `npm run lint` → 0 errors, 0 warnings；handleRetry 死代码已删除（6c0b404）；无死代码/console.log 残留 |
| C6 · 错误处理/防御编程 | 4 | **4** | outbox.ts recover 逻辑（retries>0 conflict op 兜底）；drainBatch maxBatch=200 截断；drained 待重试 op recover；`mergeIntoConflictQueue` 冲突桩；网络失败 catch 整批留 outbox |
| C7 · 可维护性 | 3 | **3** | 注释一致性（协议 Refs 标注）；函数粒度合理（db.ts 8 API/outbox.ts 6 API）；命名规范；文件分层清晰（service/utils/spec/qa）|
| C8 · runtime 加载性（D-022 v2.0 新增）| 5 | **4** | ✅ Human 实测手册 257 行 + 5 步 + 5 硬断言；✅ ensureVersion 兼容 lib 3.8+；✅ 0 副作用陷阱；⚠️ dispatch §2.7 模板中未显式标注"未经验测"的微信 SDK 纸面假设（扣 1 分）|
| C9 · 体量/工程性价比 | 3 | **3** | 代码 895 行 / 测 228 行 / 文档 257 行 = 1380 行；5 点卡估点对齐；Sprint-2 主线主头 |
| C10 · SBAI 流程合规（D-022 v2.0 新增）| 2 | **1** | ✅ D-021 三证铁律已跑（history §1 记录）；✅ D-017 v3 首次完整流程实战（Step 1~5 + Q1~Q4）；⚠️ D-016 同轮兑现合规但有 1 处细节：6c0b404 commit message 中 `commit cb3a83b` 应为 `commit 1e723c7`（hash 笔误）；✅ state.md/history 同轮收尾 |
| **总分** | **40** | **38** | |

**v1.0 → v2.0 差异说明**：

| 维度 | v1.0 | v2.0 | 本卡体现 |
|---|---|---|---|
| C8 runtime 加载性 | 无 | 新增 5 分 | COSTRA-103 命中 runtime 类 T2（平台 API 运行时行为 + 微信基础库版本差异）；Human 实测手册 5 步 + 5 断言齐全 |
| C10 SBAI 流程合规 | 无 | 新增 2 分 | D-017 v3 首次完整流程实战；D-016 同轮兑现合规（1 处 hash 笔误扣 1 分）|
| 总分 | 35 | 40 | +5 分新增维度 |

---

## 红线检查（5 项）

| 红线项 | 结果 | 证据 |
|---|---|---|
| 协议事实源被改 | ✅ PASS | `git diff HEAD~5..HEAD -- server/ api/ docs/api/` 返回空 |
| 测期望被改 | ✅ PASS | `git log -- miniprogram/services/outbox.spec.ts miniprogram/services/db.spec.ts` 仅 1e723c7 创建后未改动 |
| 后端代码被改 | ✅ PASS | `git diff --name-only HEAD~5..HEAD -- server/ api/` 返回空 |
| 业务主体红线（D-008）| ✅ PASS | grep 未发现主体字样硬编码 |
| async 回退（wx.setStorageSync）| ✅ PASS | `grep -n "wx\.setStorageSync\|wx\.getStorageSync" miniprogram/services/db.ts miniprogram/services/outbox.ts` 返回空 |

---

## 自跑硬验收结果

### 1. 协议对齐 grep 验证

| 验证项 | 命令 | 结果 |
|---|---|---|
| 驼峰 payload 残留 | `grep "amountCents\|categoryId\|occurredAt" outbox.ts entry/index.ts` | `categoryId` 仅在 Page.data 字段定义中（UI 状态，非 payload）；传 outbox 前已映射为 `category_id` ✅ |
| 旧符号残留 | `grep "OUTBOX_KEY\|enqueueLocalEntry\|__peekOutbox" miniprogram/` | 0 命中 ✅ |
| sync API 泄漏 | `grep "wx\.setStorageSync\|wx\.getStorageSync" db.ts outbox.ts` | 0 命中 ✅ |

### 2. 闸门自跑

| 闸门 | 命令 | 结果 |
|---|---|---|
| typecheck | `npm run typecheck` | ✅ exit 0 · 0 errors |
| lint | `npm run lint` | ✅ exit 0 · 0 errors, 0 warnings |
| test | `npm run test` | ✅ 34 tests passed（7 files）|
| check:appjson | `npm run check:appjson` | ✅ |
| check:tooling | `npm run check:tooling` | ✅ |
| check:whitelist | `npm run check:whitelist` | ✅ |

### 3. 测期望不可改验证

```
git log -- miniprogram/services/outbox.spec.ts miniprogram/services/db.spec.ts
→ 仅 1e723c7 feat(miniapp) 创建后未改动 ✅
```

### 4. runtime 完备性验证

```
docs/qa/costra-103-human-verify.md
→ 257 行 ≥ 200 行要求 ✅
→ 5 步实测（A/B/C/D/E）✅
→ 5 硬断言（H1~H5）✅
```

### 5. 1e723c7 vs acfcf0a 判断

| 项目 | 结论 |
|---|---|
| 是否重复 commit？| **否** |
| 1e723c7 scope | `feat(miniapp)` - 7 个代码文件（db.ts/outbox.ts/id.ts/sync.ts/entry/index.ts + 2 spec）|
| acfcf0a scope | `docs(qa)` - 5 个文档文件（human-verify.md/dispatch/state.md/history/card-review）|
| diff 重叠 | 0 文件重叠 ✅ |

### 6. D-016 同轮兑现合规性

| 要求 | 状态 | 证据 |
|---|---|---|
| commit 1 feat | ✅ | 1e723c7 `feat(miniapp): db + outbox + id utils + sync.ts refactor` |
| commit 2 docs | ✅ | acfcf0a `docs(qa): costra-103 human verify manual + state/history` |
| state.md/history 同轮 | ✅ | acfcf0a + c8b6c06 + 561e884 同轮完成 |
| footer Refs | ✅ | 1e723c7 footer: `Refs: COSTRA-103, COSTRA-100, COSTRA-118, sync-protocol.md, id-strategy.md` |
| ⚠️ commit message hash 笔误 | P2 | 6c0b404: `R1 实装 (commit cb3a83b)` 应为 `commit 1e723c7` |

### 7. R1.3 方案 A 边界评估

| 修复项 | D-017 Step 2 方案 A | 实际实现 | 评估 |
|---|---|---|---|
| conflict off-by-1 修复 | `next_retry_at = now + 1` | outbox.ts:150 ✅ | ✅ 守住 |
| handleRetry 死代码清理 | 删除 line 293-306 | handleRetry 函数已不存在 ✅ | ✅ 守住 |
| drainBatch recover 重构 | 新增 recover 逻辑 | outbox.ts:143-160 ✅ | ✅ 超出方案 A 范围但合理 |

**评估结论**：R1.3 修复正确实现了方案 A 并额外引入 drainBatch recover 重构，超出原方案范围但属于合理扩展（commit message 第 4 项已诚实声明该扩展）。

---

## 问题清单

### P0（阻塞）：**无**

### P1（应改）：**无**

### P2（建议 · minor）

#### P2-1 · commit message hash 笔误

- **位置**：`6c0b404` commit message
- **问题**：写的是 `R1 实装 (commit cb3a83b)` 但实际应为 `commit 1e723c7`
- **影响**：不影响功能，影响 commit 历史可追溯性
- **修复建议**：留 Sprint-2 空闲时 amend 或在 Retro 卡记 follow-up · 不阻塞 APPROVE
- **阻断级别**：P2（建议修复，不阻塞 APPROVE）

### INFO（观察）

#### INFO-1 · dispatch §2.7 模板中未显式标注微信 SDK 纸面假设

- **位置**：docs/qa/costra-103-human-verify.md 或代码注释
- **问题**：D-022 C8-3 要求涉及微信 SDK 的纸面假设需显式标注"未经验测"
- **当前状态**：Human 实测手册本身是实测前置文档，未在代码中标注"未经验测"假设
- **影响**：C8 runtime 加载性维度扣 1 分（已体现在评分中）
- **修复建议**：如需补标，在相关代码注释中增加 `[未经验测]` 标注
- **阻断级别**：INFO（已在评分中体现，不单独阻塞）

---

## Verdict

**APPROVE** · **38/40 分** · **0 P0 / 0 P1 / 1 P2**

**触发依据**（D-022 v2.0）：
- ✅ 总分 38 ≥ 36 阈值 → **APPROVE**
- ✅ 0 个 P0 阻塞点
- ✅ 0 个 P1 应改项
- ✅ 红线 0 命中

---

## Human 实测前置 checklist（D-022 v2.0 强制）

根据 D-022 §4.1 runtime 类 T2 卡 Human 实测前置铁律，COSTRA-103 必须 Human 模拟器实测 5 条断言全 PASS 才能 T1 终审。

### Human 实测步骤对照清单

| 步骤 | 操作 | 成功证据标准 |
|---|---|---|
| **步骤 A · 启动检查** | 微信开发者工具 → Console 筛选 `[storage]` | ✅ A1: 0 次 `too early` |
|  |  | ✅ A2: 0 次 `db.ts is not defined` |
|  |  | ✅ A3: ≥ 1 条 `[storage] ensureVersion` 通过日志 |
|  |  | ✅ A4: 0 次 console.error / console.warn（启动期）|
|  |  | ✅ A5: 登录页正常渲染 |
| **步骤 B · 登录→记一笔在线** | Mock 登录 → FAB `+` → 金额 12.34 → 备注 → 提交 | ✅ B1: Storage 出现 `entry:{uuid}` key |
|  |  | ✅ B2: Storage 出现 `entry:__index` key |
|  |  | ✅ B3: Storage 出现 `outbox:{seq}` key |
|  |  | ✅ B4: Storage 出现 `outbox:__index` key |
|  |  | ✅ B5: payload 100% snake_case |
| **步骤 C · 断网记 3 笔** | Network → Offline → 记 3 笔 | ✅ C1: `entry:__index` 长度 = 3 |
|  |  | ✅ C2: `outbox:__index` 长度 = 3 |
|  |  | ✅ C3: 0 次 `__costra_outbox_v1` 旧 key |
|  |  | ✅ C4: payload 100% snake_case |
|  |  | ✅ C5: `client_ref_id` 格式 UUID v4（36 字符）|
| **步骤 D · 联网推送** | 取消 Offline → 等待 30s | ✅ D1: 0 次 `TypeError: Cannot read property` |
|  |  | ✅ D2: 0 次 `module not defined` |
| **步骤 E · 重启持久化** | 重启小程序 → 重新登录 | ✅ E1: `entry:__index` 长度 ≥ 3 |
|  |  | ✅ E2: `client_ref_id` UUID v4 仍正确 |

### 5 硬断言成功标准

| # | 断言 | 验证方法 | 成功标准 |
|---|---|---|---|
| **H1** | db.ts API 全异步 · 0 次 sync API 调用 | `grep "wx\.setStorageSync\|wx\.getStorageSync" db.ts outbox.ts` | 0 命中 |
| **H2** | outbox 多 key 分片 · 0 次单 key 数组残留 | Console 执行 `keys.filter(k => k === '__costra_outbox_v1')` | 0 |
| **H3** | payload 100% snake_case · 0 次驼峰泄漏 | `Object.keys(payload).filter(k => /[A-Z]/.test(k))` | [] |
| **H4** | client_ref_id 持久化 · 重启不丢 | 步骤 E E1 | 长度 ≥ 3 |
| **H5** | ensureVersion + bootstrap 兼容 lib 3.8+ | 步骤 A A1/A3 | 通过 |

**H1~H5 全 PASS = T1 终审放行** · **任意 FAIL = 卡退回 R1.4 修复**

---

## 给 Orchestrator 的回执指令

Orchestrator 拉起 Human 实测时，请附上本文件全文，并要求 Human：

1. **执行 5 步实测手册**（docs/qa/costra-103-human-verify.md §1~§5）
2. **验证 5 硬断言**（§8 H1~H5）
3. **全 PASS → 发 `approve:COSTRA-103`**
4. **任意 FAIL → 发 `revise:COSTRA-103 reason:<一句话摘要>`**

**P2 修复（非强制，延迟到 Sprint-2 空闲时）**：
- `6c0b404` commit message 中的 `commit cb3a83b` → `commit 1e723c7`

---

## 自我反思

- **本次审核耗时**：约 60 分钟（44 tool uses · 15 文件 Read + 10 轮 grep/bash 验证）
- **置信度**：**高**
- **关键判断依据**：
  - 协议对齐 100%（payload/entity/op/base_version/idempotency_key/retry 全链路）
  - D-017 v3 首次完整流程实战合规（Step 1~5 + Q1~Q4 全 a Human 拍板）
  - D-022 v2.0 runtime 类 T2 判定命中，Human 实测手册完备
  - 测试 34/34 全绿，闸门 6/6 通过
- **物理无写权合规自检**：本审查 44 tool uses 全部为 read_file / search_content / execute_command（只读 git/grep/wc/npm）· 0 次 write_to_file / replace_in_file / delete_file 调用 · **纪律性约束 100% 遵守**
- **D-022 v2.0 首次实战心得**：C8 runtime 加载性和 C10 SBAI 流程合规两个新增维度有效补充了 v1.0 盲区；Human 实测前置铁律是不可绕过的 T2 卡终审必要条件

---

**审查完成 · 本 agent 一次性销毁 · 报告由 Orchestrator 原样落盘。**
