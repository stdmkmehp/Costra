# COSTRA-103 · Human 本地验证手册（本地 KV 持久化 + outbox 多 key 分片 + 冲突三态消费）

> **卡号**：COSTRA-103（Sprint-2 主线主头 · Epic-C 离线优先架构客户端层）
> **验证类别**：T2-with-runtime · Human 模拟器实测前置（D-022 §4.1 强制铁律）
> **执行人**：Human（本项目唯一持真微信开发者工具者）
> **计划执行时间**：COSTRA-103 R1 review-tech PASS 后立刻
> **预计耗时**：20 分钟（5 个步骤）
> **验证对象**：本地 KV 持久化 + outbox 多 key 分片 + 冲突三态消费 + payload snake_case + client_ref_id 持久化
> **runtime 类 T2 铁律**：D-022 §4.1 命中（平台 API 运行时行为 + 微信基础库版本差异）· 断言全 PASS 才能 T1 终审

---

## 0. 前置环境清单

### 0.1 工具 & 凭证
- [ ] **微信开发者工具** ≥ 1.06.2405090（含基础库 ≥ 2.21.0）
- [ ] **项目目录**：`/Users/weizhao/Desktop/Costra`（已 checkout 当前分支 `dev`）
- [ ] **本地 Node.js**：≥ 18.x
- [ ] **npm install** 已完成（含 decimal.js + vitest）
- [ ] **已构建 npm**（工具 → 构建 npm）

### 0.2 依赖安装（首次）
```bash
cd /Users/weizhao/Desktop/Costra
npm install
npm run typecheck   # 期望：exit 0
npm run test        # 期望：29+ tests passed
```

### 0.3 验证手册执行模式
**先跑 Mock 通路**（不依赖后端 COSTRA-104）：步骤 1/2/3/5 可在 Mock 模式下完成。
步骤 4（断网→联网 push）需等 COSTRA-104 后端实装或本地 mock server。

### 0.4 R1 范围声明（重要 · 避免误判 BUG）

> **本卡 R1 实装范围 · Human 实测前必读**：
>
> COSTRA-103 R1 仅交付**本地 KV 持久化 + outbox 入队 + 三态消费函数体** · **不实装 client 端调度器**（即不接 `App.onLaunch` / `Page.onShow` / `wx.onNetworkStatusChange` / 周期 setInterval 的 wire-up）。原因：调度器需要 COSTRA-104 server `/sync/push` + `/sync/pull` 端点稳定后才能联调 · 此前实装是空跑 · 不符合 INVEST。
>
> **R1 不实装 · 留 follow-up 的明确范围**：
>
> | 不实装项 | 后续 owner | FU 登记 |
> |---|---|---|
> | client `pushDelta()` 调度触发（onShow / 网络恢复 / 10s 周期）| Sprint-3 候选 COSTRA-150 | `FU-103-CLIENT-SYNC-SCHEDULER` |
> | client `syncPull()` 调度触发（同上 · 拉取 server changes）| 同上 | 同上 |
> | watermark 推进（依赖 syncPull 触发后 server 返回）| 同上 | 同上 |
> | conflict 真实合并 UI（替代当前"立即重试 next_retry_at = now+1"桩位）| Sprint-3 候选 COSTRA-151 | `FU-103-CONFLICT-MERGE-UI` |
>
> **Human 实测时**：步骤 D 看不到 `POST /sync/push` 是**预期**（不是 R1 BUG）· 步骤 E `watermark:` keys 为空数组 `[]` 也是**预期**（syncPull 没人触发就不会写）。详见各步骤断言文案。
>
> **R1 验证目标 = 函数体正确性**：H1~H5 全 PASS = 函数体无 bug · 调度层留 FU。

### 0.5 实测起点重置（步骤 C 计数对齐铁律）

**重要**：步骤 B 已记 1 笔 + 步骤 C 记 3 笔 = 累计 4 笔（不是 3）· 这会让步骤 C 断言 C1/C2 文案误读。**步骤 C 实测前必须清 storage**：

```js
// Console 执行（步骤 B 完成 · 步骤 C 开始前）
wx.clearStorageSync()
console.log('storage cleared, ready for step C')
```

或者 · 不清 storage 但**手动调整断言期望**：B+C 后 entry/outbox count 应该 = 4（不是 3）· 心算对齐即可。

---

## 1. 步骤 A · 启动检查（runtime 加载性基础验证）

### 1.1 操作
1. 打开微信开发者工具 → 打开项目根 `Costra/`
2. 顶部菜单 **工具 → 构建 npm**（如有变更）
3. 点击"真机调试"或模拟器
4. 打开 Console，筛选 `[storage]`

### 1.2 断言（5 条全 PASS 才可继续）

| # | 断言 | 期望 |
|---|---|---|
| A1 | Console 无 `too eayly` 错误 | 0 次 |
| A2 | Console 无 `db.ts is not defined` 错误 | 0 次 |
| A3 | Console 有 `[storage] ensureVersion` 通过日志 | ≥ 1 条 |
| A4 | 无 console.error / console.warn（启动期） | 0 次 |
| A5 | 登录页正常渲染（tabBar 存在） | 可见 |

### 1.3 Pass/Fail
- [ ] Pass · [ ] Fail（如 A1/A2 任一 FAIL：立即 BLOCKED + 发 `revise:COSTRA-103 reason:too early or module error`）

---

## 2. 步骤 B · 登录 → 记一笔在线（Storage key 命名空间验证）

### 2.1 操作
1. 登录（Mock 模式：`env.ts mockLogin: true`）
2. 进入首页 → 点击 FAB `+` 记一笔
3. 金额输入 `12.34` → 备注 `COSTRA-103 实测` → 类型选"支出" → 提交
4. **提交前打开 Console → Storage Tab**

### 2.2 断言（5 条全 PASS）

| # | 断言 | 期望 |
|---|---|---|
| B1 | Storage 出现 `entry:{uuid}` key | 格式 `entry:<client_ref_id>` |
| B2 | Storage 出现 `entry:__index` key | 值为数组，含 1 条 client_ref_id |
| B3 | Storage 出现 `outbox:{seq}` key | 格式 `outbox:<timestamp>` |
| B4 | Storage 出现 `outbox:__index` key | 值为数组，含 1 条 seq |
| B5 | payload 100% snake_case（ledger_id / amount / category_id / occurred_at） | 0 次驼峰 |

### 2.3 验证方法（Console）

```js
// 检查 entry key
const keys = wx.getStorageInfoSync().keys
const entryKeys = keys.filter(k => k.startsWith('entry:'))
console.log('entry keys:', entryKeys)

// 检查 outbox key（Mock 模式下可能为空，因 pushDelta 未调用）
const outboxKeys = keys.filter(k => k.startsWith('outbox:'))
console.log('outbox keys:', outboxKeys)

// 检查 payload snake_case
const entryData = wx.getStorageSync('entry:__index')
console.log('index:', entryData)
```

### 2.4 Pass/Fail
- [ ] Pass · [ ] Fail（如 B5 FAIL：立即 BLOCKED + 发 `revise:COSTRA-103 reason:camelCase payload leak`）

---

## 3. 步骤 C · 断网记 3 笔（outbox 多 key 分片验证）

### 3.0 前置（必读 · §0.5 已说明）

**前提**：已执行 `wx.clearStorageSync()` 清空 storage 或重置项目。**否则 entry/outbox 计数会变成 4**（B 1 笔 + C 3 笔 = 4 · 这是手册描述漏洞 v1 → v1.1 修订点 · 见 §0.5）。

如不想清 storage：手动把下列断言"长度 = 3"读作"长度 = 步骤 B 笔数 + 3"。

### 3.1 操作
1. 开发者工具 → **Network → Offline**（模拟断网）
2. 快速记 3 笔（金额随意，备注 `断网1` / `断网2` / `断网3`）
3. 每次提交后**立即观察 Console + Storage Tab**

### 3.2 断言（5 条全 PASS · 假设步骤 C 起点 storage 已清）

| # | 断言 | 期望 |
|---|---|---|
| C1 | `entry:__index` 长度 = 3 | 3 条 entry（步骤 C 起点已清 storage 时）|
| C2 | `outbox:__index` 长度 = 3 | 3 条 seq（多 key 分片）|
| C3 | **0 次**单 key 数组残留（不存在 `__costra_outbox_v1` 旧 key）| 0 |
| C4 | payload 100% snake_case（`ledger_id` / `amount` / `category_id`）| 0 次驼峰 `amountCents` |
| C5 | `client_ref_id` 持久化且格式为 UUID v4（36 字符）| 每条都有 + 正则 `/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i` |

### 3.3 验证方法（断网状态）

```js
// 检查 outbox 多 key 分片
const idx = wx.getStorageSync('outbox:__index')
console.log('outbox count:', idx?.d?.length, '(expect 3)')

// 逐条读 outbox 内容
idx?.d?.forEach(seq => {
  const op = wx.getStorageSync(`outbox:${seq}`)
  console.log('op payload keys:', Object.keys(op?.d?.payload || {}))
  console.log('op client_ref_id:', op?.d?.client_ref_id)
  console.log('op idempotency_key:', op?.d?.idempotency_key)
})

// 检查 payload snake_case（0 次驼峰）
const allKeys = Object.keys((wx.getStorageSync(`outbox:${idx.d[0]}`) || {}).d?.payload || {})
console.log('payload fields:', allKeys)
const camelCase = allKeys.filter(k => /[A-Z]/.test(k))
console.log('camelCase leak:', camelCase, '(expect [])')
```

### 3.4 Pass/Fail
- [ ] Pass · [ ] Fail（如 C3/C4 任一 FAIL：立即 BLOCKED + 发 `revise:COSTRA-103 reason:single-key array or camelCase leak`）

---

## 4. 步骤 D · 联网推送（pushDelta 链路 + 三态消费预验证）

### 4.0 R1 范围声明（重要）

**预期：本步骤看不到 `POST /sync/push` 是正常的**（不是 BUG）。原因：

- COSTRA-103 R1 **不实装** client 端调度器（即不接 `App.onLaunch` / `Page.onShow` / `wx.onNetworkStatusChange` / 周期 setInterval）
- `pushDelta()` 函数体已实装（`miniprogram/services/sync.ts:74`）但**没人触发**
- client 调度器实装留 follow-up `FU-103-CLIENT-SYNC-SCHEDULER`（Sprint-3 候选 COSTRA-150）

**本步骤目标 = 验证模块加载无 runtime 错误**（D1/D2）· 不验证 push 实际触发。

### 4.1 操作
1. **恢复 Network**（取消 Offline）
2. 等待 30 秒观察 Console
3. Console 搜索 `POST /sync/push` 或 `[outbox]`

### 4.2 断言（2 条 · 仅模块加载验证）

> **注**：本卡 outbox 多 key 分片实装正确性可在本地验证（步骤 B/C/E）；真正 push 触发需等 `FU-103-CLIENT-SYNC-SCHEDULER` 转正卡（Sprint-3）。本步骤仅预验证链路连通性 · **看不到 POST 是预期 · 不算 FAIL**。

| # | 断言 | 期望 |
|---|---|---|
| D1 | Console 无 `TypeError: Cannot read property`（outbox API 调用链路）| 0 次 |
| D2 | db.ts / outbox.ts 模块加载正常（无 `module not defined`）| 0 次 |
| D3（INFO）| Console 无 `POST /sync/push` | **预期** · 不算 FAIL · 留 FU |

### 4.3 Pass/Fail
- [ ] Pass · [ ] Fail（如 D1/D2 FAIL：发 `revise:COSTRA-103 reason:runtime module error`）· **D3 看不到 POST 不算 FAIL**

---

## 5. 步骤 E · 重启持久化验证（client_ref_id + watermark 不丢失）

### 5.0 R1 范围声明（重要）

**预期：本步骤 `watermark:` keys 为空数组 `[]` 是正常的**（不是 BUG）。原因：

- watermark 的写入路径只有 `db.ts:271 setWatermark` · 唯一调用者 = `sync.ts:63 syncPull`
- COSTRA-103 R1 **不触发 syncPull**（同 §4.0 client 调度器留 FU 原因）
- watermark 永远没机会写入 storage · `keys.filter(k => k.startsWith('watermark:'))` 必然返回 `[]`
- watermark 推进闭环留 follow-up `FU-103-CLIENT-SYNC-SCHEDULER`（Sprint-3 候选 COSTRA-150）

**本步骤目标 = 验证 entry 持久化 + client_ref_id 不丢**（E1/E2）· 不验证 watermark 有值。

### 5.1 操作
1. **重启小程序**（开发者工具 → 刷新，或点"编译"重新热加载）
2. 重新登录 → 进入首页
3. Console 执行：

```js
// 验证 entry 持久化
const entryIdx = wx.getStorageSync('entry:__index')
console.log('entry index after restart:', entryIdx?.d?.length, '(expect ≥ 3 if step C cleared storage / ≥ 4 otherwise)')

// 验证 watermark 持久化（R1 预期为空 · 见 §5.0）
const keys = wx.getStorageInfoSync().keys
const wmKeys = keys.filter(k => k.startsWith('watermark:'))
console.log('watermark keys:', wmKeys, '(expect [] · R1 不接调度器 · FU-103-CLIENT-SYNC-SCHEDULER)')
```

### 5.2 断言（3 条 · 含 1 INFO）

| # | 断言 | 期望 |
|---|---|---|
| E1 | `entry:__index` 长度 ≥ 3（断网 3 笔不丢失）| 持久化生效 |
| E2 | `client_ref_id` 格式 UUID v4 仍正确 | 不损坏 |
| E3（INFO）| `watermark:` keys 为 `[]` | **预期** · 不算 FAIL · 留 FU |

### 5.3 Pass/Fail
- [ ] Pass · [ ] Fail（如 E1 FAIL：发 `revise:COSTRA-103 reason:persistent failure after restart`）· **E3 watermark 为 `[]` 不算 FAIL**

---

## 6. 失败回报模板

> **提交位置**：`.team/reviews/COSTRA-103/human-verify-fail-report.md`
> **触发重审**：`revise:COSTRA-103 reason:<一句话摘要>`

### 模板
```markdown
# COSTRA-103 · Human 本地验证失败报告

- 卡号：COSTRA-103
- 验证执行时间：2026-05-09 HH:mm
- 失败步骤：<A/B/C/D/E>
- 失败分级：<Hard（DoD 未达成）/ Soft（能用有偏差）>
- 现象描述：
  -
  -
- 期望行为：
  -
- 实际现象（含截图/日志）：
  -
- 已尝试的排查：
  -
- 建议修复方向：
  -
```

---

## 7. 验证完成后的动作

### 7.1 全 Pass
- Human 发 `approve:COSTRA-103` → Orchestrator 整卡收口
- 触发下游：COSTRA-104（后端 /sync/push 真实接收）/ COSTRA-105（端到端冒烟）

### 7.2 任一步 Hard-Fail
- Human 填 §6 模板 → 发 `revise:COSTRA-103 reason:...` → Agent 按 D-011 方案 B 自动续跑

### 7.3 全 Soft-Fail（可用但有偏差）
- Human 发 `approve:COSTRA-103 with-follow-ups:FU-103-X,...`
- Orchestrator 收口并登记到 Sprint-2 FU 队列

---

## 8. 硬断言汇总（5 条 · 全 PASS 才能 T1 终审）

| # | 断言 | 验证位置 | 对应 DoD |
|---|---|---|---|
| **H1** | db.ts API 全异步 · 0 次 sync API 调用 | Console grep `wx\.setStorageSync\|wx\.getStorageSync` 在 db.ts/outbox.ts 0 命中 | DoD (a) |
| **H2** | outbox 多 key 分片 · 0 次单 key 数组残留 | Console 执行 `keys.filter(k => k === '__costra_outbox_v1')` → 0 | DoD (b) |
| **H3** | payload 100% snake_case · 0 次驼峰泄漏 | `Object.keys(payload).filter(k => /[A-Z]/.test(k))` → [] | DoD (e) |
| **H4** | client_ref_id 持久化 · 重启不丢 | 步骤 E E1 | DoD (c) |
| **H5** | ensureVersion + bootstrap 兼容 lib 3.8+ | 步骤 A A1/A3 | DoD (i) |

**H1~H5 全 PASS = T1 终审放行** · **任意 FAIL = 卡退回 R1 修复**

---

## 9. 相关事实源 & 佐证

- 派单：`.team/dispatch/COSTRA-103-miniapp-local-persistence-outbox.md`
- Card-Review：`.team/reviews/COSTRA-103/card-review-round-1-tech.md`（PASS-WITH-FOLLOWUP 26.5/30）
- 协议事实源：`docs/api/sync-protocol.md` / `docs/api/id-strategy.md`
- D-022 runtime 类铁律：`.team/decisions/D-022-review-tech-runtime-dimension.md`
- 单测覆盖：`miniprogram/services/db.spec.ts`（≥ 5 测）/ `outbox.spec.ts`（≥ 3 测）
