# COSTRA-105 · 单人记账闭环冒烟用例集（单人记账 SU-001 ~ SU-014 · 15 条 v1.1 含 SU-004A/B 拆分）

> **卡号**：COSTRA-105（Sprint-2 主线第 4 张 · qa-planner 首次实装实战）
> **Owner**：qa-planner（装扮型 subagent · D-018 SBAI v1.1）
> **依赖上游**：COSTRA-103（CLOSED 2026-05-09）+ COSTRA-104（CLOSED 2026-05-12）
> **覆盖 Epic**：Epic-A 登录 + Epic-B 单人记账 + Epic-C 离线优先架构
> **版本**：v1.1（2026-05-13 · SU-004 拆 A/B + 十类覆盖 · 同步手册 v1.4 H6）

---

## 0. 十类覆盖核对表（v1.1 扩展 · 原九类 + 集成层契约对齐）

| 类别 | 用例 | 状态 |
|---|---|---|
| 等价类 | SU-001（冷启登录）· SU-002（在线记一笔） | ✅ |
| 边界 | SU-008（金额边界） | ✅ |
| 异常 | SU-007（弱网 8s 超时）· SU-010（Token 过期续签） | ✅ |
| **幂等** | **SU-005（同 client_ref_id 重放 → 防重）** | ✅ |
| **并发** | **SU-006（version conflict 三态消费）** | ✅ |
| 兼容 | SU-012（基础库双版本） | ✅ |
| 安全 | SU-013（Token 不入日志） | ✅ |
| **弱网** | **SU-003（离线入队）· SU-004A（联网 push）· SU-004B（冷启 pull 回环）· SU-007（降级兜底）** | ✅ |
| **集成层契约对齐**（v1.1 新增 · D-022 §4.1）| **SU-004B（client⇄server 端到端协议契约 · 唯一手动捕获路径）** | ✅ |
| 授权拒绝 | SU-011（隐私拒绝 → 只读演示） | ✅ |

> 10 类覆盖（原 9 类 + 集成层契约对齐 v1.1 新增）✅

---

## 用例模板说明

每条用例字段（共 7 字段）：
- **Case ID**：`SU-XXX`
- **前置条件**：环境 + 真机/模拟器信息 + 基础库版本
- **步骤**：storage 重置 / WX_MOCK_LOGIN env / 网络模拟方式（参照 103/104 范式）
- **预期**：断言可度量（附 `wx.storage` key / Console 关键日志 / curl 输出 / DB 行）
- **实际**：首次执行留空（Human 填）
- **责任**：Backend / MiniApp / DevOps
- **严重度**：P0~P3（见 smoke-cases.md 约定）

---

## SU-001 冷启动 + 登录闭环（Mock + WX_MOCK_LOGIN 双通）

- **Category**：等价类
- **Severity**：P0
- **PRD 锚点**：COSTRA-101 AC-1（登录成功 5s 内跳转首页）+ AC-2（老用户不重复建号）
- **前置条件**：
  - 微信开发者工具 ≥ 1.06.x + 基础库 ≥ 2.32.3（本卡用 3.8.12）
  - `WX_MOCK_LOGIN=1` 环境变量（server dev 模式）
  - storage 清空（`wx.clearStorageSync()`）
- **步骤**：
  1. 清 storage：`wx.clearStorageSync()`
  2. 杀掉小程序，重新打开（冷启）
  3. 计时从点击图标到首页 `home` 可点击
  4. 点"一键微信登录"（Mock 模式）
  5. 允许获取用户信息
- **预期**：
  - TTI ≤ 2s（NFR）
  - 2s 内跳 `home`
  - `wx.getStorageSync('__costra_token_v1')` 有有效 Token（access_token 长度 ≥ 36 字符）
  - Console 无 `too eayly` 报错
  - `auth.ts:157 [auth] wx.login ok {codeLen: 32}` 日志
- **实际**：（Human 填）
- **责任**：MiniApp（login flow）+ Backend（wx-login endpoint）
- **真机信息**：（Human 填 iOS/Android 机型 + 系统 + 微信版本）

---

## SU-002 在线记一笔（POST /entries 直写 · 端到端）

- **Category**：等价类
- **Severity**：P0
- **PRD 锚点**：COSTRA-113 AC-1（支出：金额>0 + 账户+分类必选 + 保存后列表可见）
- **前置条件**：
  - 已登录（SU-001 通过）
  - `server/.env` 配置 `WX_MOCK_LOGIN=1` + `server/src/plugins/mock-login.ts` 已注入
  - `scripts/dev/migrate.sh` 已跑（含 0001~0004 migrations）+ psql seed ledger 存在（`00000000-...-001`）
  - 微信开发者工具 Network 状态：Online
- **步骤**：
  1. 进入首页 → 点击 FAB `+` → 进入记一笔页
  2. 选"支出"，金额输入 `12.34`，分类选"餐饮"，备注留空
  3. 提交（点保存）
  4. **提交前打开 Console → Storage Tab**
- **预期**：
  - Toast "已记录" 或 "保存成功"
  - `wx.getStorageSync('entry:__index')` 长度 ≥ 1
  - `wx.getStorageSync('entry:{client_ref_id}')` 存在（格式 `entry:<uuid>`）
  - `wx.getStorageSync('outbox:__index')` 可能为空（Mock 模式 pushDelta 未触发）
  - Console 无 `TypeError` / `console.error`
- **实际**：（Human 填）
- **责任**：MiniApp（UI 流程）+ Backend（POST /entries）
- **真机信息**：（Human 填）

---

## SU-003 离线记一笔（飞行模式 · outbox 入队）

- **Category**：弱网 / 离线
- **Severity**：P0
- **PRD 锚点**：COSTRA-113 AC-4（离线：无网也能保存 → 写入本地队列）
- **前置条件**：
  - 已登录（SU-001 通过）
  - SU-002 完成后 storage 中有 ≥1 条 entry
- **步骤**：
  1. 开发者工具 → **Network → Offline**（模拟断网）
  2. 在离线状态下记一笔：金额 `56.78`，备注 `离线测试`，分类"交通"
  3. 提交
- **预期**：
  - Toast "已记录"（本地排队）
  - `entry:__index` 长度 = 原长度 + 1（离线 entry 已持久化）
  - `outbox:__index` 长度 = 原长度 + 1（outbox 多 key 分片）
  - `outbox:{seq}` key payload 含 `amount: 5678`（snake_case）+ `client_ref_id`（UUID v4 格式）
  - Console 无错误（离线属正常状态）
- **实际**：（Human 填）
- **责任**：MiniApp（outbox 入队逻辑）
- **真机信息**：（Human 填）

---

## SU-004 联网恢复 → 完整闭环（拆 SU-004A push 链路 + SU-004B client 视角回环 · v1.1 补强）

> **v1.1 拆分动机**（2026-05-13 · 手册 v1.4 同步）：原 SU-004 仅验 push 链路诊断（client 真发 + DB 落库），漏过 client⇄server 协议契约对齐验证。SU-004B 补 client 视角端到端回环（冷启 → pull → 首页显示一致），与 SU-004A 互补不重叠 · 兑现 H6 硬断言。

### SU-004A · push 链路诊断（POST /v1/sync/push · 集成层联通）

- **Category**：弱网 / 离线幂等
- **Severity**：P0
- **PRD 锚点**：COSTRA-113 AC-4 + COSTRA-122 AC-3（同步可恢复 + 幂等键防重）
- **前置条件**：
  - SU-003 已完成（outbox 有 ≥1 条待推记录）
  - server 起着（WX_MOCK_LOGIN=1 · §0.4 三件套已跑）
  - Network 仍为 Offline
- **步骤**：
  1. 开发者工具 → **Network → Online**（取消离线）
  2. **手动触发 push**（FU-103-CLIENT-SYNC-SCHEDULER 未实装自动触发）：Console 执行：
     ```js
     const sync = require('./services/sync')
     sync.pushDelta().then(r => console.log('push result', r))
     ```
  3. 观察 Console + Network + Storage
- **预期**：
  - Network 面板有 `POST http://localhost:8080/v1/sync/push` 200
  - `outbox:__index` 长度 = 原长度 - 已推条数（或对应 outbox key 已 removeItem）
  - DB 查询：`psql ... -c "SELECT count(*) FROM entries WHERE note = 'offline-test-c'"` → 1
  - **幂等保证**：同一 `client_ref_id` 重推不产生重复 entry（server 24h 幂等键 · 配合 SU-005）
- **实际**：（Human 填）
- **责任**：MiniApp（client `pushDelta`）+ Backend（POST /v1/sync/push · COSTRA-156 prefix 已对齐）
- **真机信息**：（Human 填）

### SU-004B · client 视角端到端回环（GET /v1/sync/pull → 首页显示一致 · v1.1 新增）

- **Category**：弱网 / 离线幂等 / **集成层契约对齐**
- **Severity**：P0
- **PRD 锚点**：COSTRA-113 AC-4 + sync-protocol.md §3.1 / §3.2 SyncPullResponse
- **立意**：**唯一能在手动测试阶段捕获 client⇄server 协议契约 mismatch 类集成 bug 的路径**（如 COSTRA-156 修的 `/v1` URL prefix mismatch · server 单测 + curl + SU-004A 都漏不出来）。这是 D-022 §4.1 runtime 类 T2 卡 Human 实测前置铁律的真正立意兑现。
- **前置条件**：
  - SU-004A 已 PASS（offline-test-c 已落 DB）
  - 不清 storage（起点 = SU-004A 结束态）
- **步骤**：
  1. 拿 family_id（Console：`wx.getStorageSync('__costra_family_id_v1')` 或 §0.4.6 seed 输出值）
  2. 模拟"换设备 / 重装小程序"场景 · 清 watermark + entry 索引：
     ```js
     wx.removeStorageSync('watermark:<family_id>')  // 替换实际 family_id · 注意：无 sync: 前缀（事实源 db.ts:86-88）
     wx.removeStorageSync('entry:__index')
     ```
  3. **手动触发 pull**：Console 执行：
     ```js
     const sync = require('./services/sync')
     sync.syncPull('<family_id>').then(r => console.log('pull result', JSON.stringify(r, null, 2)))
     ```
  4. 冷启小程序（编译 → 普通编译）· 进首页
- **预期**：
  - Network 面板有 `GET http://localhost:8080/v1/sync/pull?family_id=...&since=...&limit=200` 200 · 响应含 `watermark` + `changes.entries` ≥ 1 条
  - `entry:__index` 重新含 `offline-test-c` 那笔的 client_ref_id（来自 server · 不是 storage 残留）
  - 冷启首页"最近账单"显示 `offline-test-c` · 金额 56.78 · 分类"交通" · 与 SU-003 输入完全一致（端到端字段无丢失/无错位/无类型变换 bug）
  - pull 响应 payload 100% snake_case（0 次 `clientRefId` / `occurredAt` / `serverVersion` 等驼峰）
- **实际**：（Human 填）
- **责任**：
  - 网络/URL 失败 → Backend（COSTRA-156 prefix · 若仍 404 立 P0）
  - applyServerChanges entry 索引未恢复 → MiniApp（COSTRA-103 R1 · `services/db.ts` line 235~252）
  - UI 显示与输入不一致 → MiniApp（amount cents↔元 / category_id 映射 / home 渲染）
  - 驼峰命名 → Backend（COSTRA-104 / 155 schema 序列化）
- **真机信息**：（Human 填）
- **注意**：
  - FU-103-CLIENT-SYNC-SCHEDULER 未实装冷启自动 pull · 步骤 3 必须 Console 手动触发
  - 失败回报：`revise:COSTRA-105 reason:<具体断言失败>`

---

## SU-005 同 client_ref_id 重放 → server 防重（idempotency_key 24h 强幂等）

- **Category**：幂等
- **Severity**：P0
- **PRD 锚点**：COSTRA-122 AC-3 + sync-protocol.md §2.5（幂等键 `client_op_id`）+ sync-protocol.md §2.5（24h 去重）
- **前置条件**：
  - 已登录 + `WX_MOCK_LOGIN=1`
  - psql seed ledger 存在（`00000000-...-001`）
- **步骤**：
  1. curl 构造同一 `client_ref_id` 两次 POST（完全相同 body）：
     ```bash
     curl -X POST http://127.0.0.1:8080/sync/push \
       -H 'content-type: application/json' \
       -H "authorization: Bearer <TOKEN>" \
       -H 'idempotency-key: 99999999-9999-9999-9999-999999999999' \
       -d '{"ops":[{"op":"create","entity":"entry","client_ref_id":"idemp-test-001","base_version":null,"payload":{"ledger_id":"00000000-0000-0000-0000-000000000001","amount":9999,"type":"expense","occurred_at":"2026-05-12T08:00:00.000Z"}}]}'
     ```
  2. 立刻重发完全相同 body（同一 idempotency-key）
- **预期**：
  - 第 1 次：`HTTP/1.1 200 OK` + `"status":"ok"` + `server_version: 1`
  - 第 2 次：`HTTP/1.1 200 OK` + `"status":"ok"` + **相同** `server_id` + **相同** `server_version: 1`（缓存命中）
  - DB 查询：`SELECT count(*) FROM entries WHERE client_ref_id = 'idemp-test-001'` → 返回 **1**（不重复入账）
- **实际**：（Human 填）
- **责任**：Backend（idempotency_keys 表 + 24h 去重逻辑）
- **真机信息**：（Human 填）

---

## SU-006 version conflict 三态消费（base_version 不匹配 → conflict）

- **Category**：并发 / 冲突
- **Severity**：P1
- **PRD 锚点**：COSTRA-123 AC-1（冲突默认服务器权威）+ sync-protocol.md §3（version conflict 三态）
- **前置条件**：
  - 已登录 + `WX_MOCK_LOGIN=1`
  - psql seed ledger 存在
- **步骤**：
  1. curl 先 POST 创建一条 entry（获得 `server_version: 1`）
  2. 再 curl 用**错误的** `base_version: 99`（不匹配 server_version=1）尝试 update：
     ```bash
     curl -X POST http://127.0.0.1:8080/sync/push \
       -H 'content-type: application/json' \
       -H "authorization: Bearer <TOKEN>" \
       -H 'idempotency-key: aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa' \
       -d '{"ops":[{"op":"update","entity":"entry","client_ref_id":"conflict-test-001","base_version":99,"payload":{"id":"<entry_id>","amount":5000}}]}'
     ```
- **预期**：
  - `HTTP/1.1 200 OK` + `"status":"conflict"` + `"server_version": 1`（返回真实 server version）
  - **不等于** `base_version: 99`（diff 说明冲突）
  - DB entry 的 `amount` **未改变**（服务器权威拒绝写入）
- **实际**：（Human 填）
- **责任**：Backend（version conflict 逻辑）
- **真机信息**：（Human 填）

---

## SU-007 弱网 8s 超时（网络限速 50KB/s）→ 错误降级 + 本地兜底不丢

- **Category**：弱网 / 异常
- **Severity**：P1
- **PRD 锚点**：NFR + smoke-cases.md S-014（API 超时与错误提示）
- **前置条件**：
  - 已登录（SU-001 通过）
- **步骤**：
  1. 开发者工具 → **Network → Slow 3G**（模拟 50KB/s 弱网）
  2. 记一笔：金额 `99.00`，备注 `弱网测试`
  3. 提交后**不等待**（立即观察 UI）
  4. 等待 8s 观察 Toast / 错误提示
- **预期（成功路径）**：
  - 若网络恢复：outbox 入队 → 联网后自动 push（见 SU-004A）
  - Toast "已记录"（本地兜底成功）
- **预期（失败路径）**：
  - ≥ 8s 无响应时 Toast/Modal 提示"网络开小差"
  - **本地 entry 不丢失**（`entry:__index` 长度 ≥ 1）
  - **outbox 不丢失**（`outbox:__index` 有记录）
  - 不崩溃、不无限 loading
- **实际**：（Human 填）
- **责任**：MiniApp（超时检测 + 本地兜底）
- **真机信息**：（Human 填）

---

## SU-008 金额边界（0 / 0.005 截断 / 999999999.99 / 负数 / decimal.js）

- **Category**：边界
- **Severity**：P1
- **PRD 锚点**：COSTRA-111 AC-3（金额 decimal.js）+ ADR-0004 §4（分存传）
- **前置条件**：已登录（SU-001 通过）
- **步骤**：
  1. 进入记一笔页，金额字段依次测试：
     - `0` → 期望拒绝或提示"请输入金额"
     - `0.005` → 期望截断为 0 分（或拒绝）
     - `999999999.99` → 期望记录成功，显示千分位
     - `-5` → 期望输入过滤禁止（不能输入负数）
     - `0.01` → 期望记录成功，`amount_cents = 1`
  2. 每次提交后检查 storage
- **预期**：
  - 边界数据驱动结果：
    - `0` → 拒绝 / 显示"0.00"
    - `0.005` → `amount_cents = 0`（截断）或拒绝
    - `999999999.99` → 成功，`amount_cents = 99999999999`
    - `-5` → 输入框过滤（无法输入）
    - `0.01` → 成功，`amount_cents = 1`
  - DB：`SELECT amount FROM entries WHERE note = '边界测试'` → 整数分（`decimal.js` 走分存）
  - Console 无 `RangeError` / `Invalid decimal`
- **实际**：（Human 填）
- **责任**：MiniApp（金额输入校验）+ Backend（decimal 存储）
- **真机信息**：（Human 填）

---

## SU-009 冷启 TTI ≤ 2s（NFR）

- **Category**：性能
- **Severity**：P1
- **PRD 锚点**：NFR（冷启 TTI ≤ 2s）+ smoke-cases.md S-001
- **前置条件**：杀掉微信进程 + 重新打开
- **步骤**：
  1. 记录点击小程序图标时刻
  2. 计时到 `home` 可点击（按钮可点 + 列表可滚动）
- **预期**：
  - TTI ≤ 2s（微信开发者工具 Performance 面板）
  - Console Launch Time ≤ 900ms（3.8.12 基线 865ms ±35ms）
- **实际**：（Human 填）
- **责任**：MiniApp（首屏性能）+ DevOps（如有体积影响）
- **真机信息**：（Human 填）

---

## SU-010 Token 过期自动续签（强制 exp 过期 → /auth/refresh）

- **Category**：异常
- **Severity**：P1
- **PRD 锚点**：COSTRA-103 AC-1（access token 2h + refresh 30d）+ smoke-cases.md S-004
- **前置条件**：已登录（SU-001 通过）
- **步骤**：
  1. Console 执行：`wx.setStorageSync('__costra_token_v1', JSON.stringify({...exp: Math.floor(Date.now()/1000) - 7200}))`（强制 exp 已过期）
  2. 下拉刷新（或切换 tab）
- **预期**：
  - 请求层自动调 `POST /v1/auth/refresh`
  - Console 有 `[auth] refreshing token` 或 `POST /auth/refresh` 日志
  - UI 无感（业务继续）
  - 新 Token 写入 storage
  - 若 refresh 也失败 → 回到登录页（不白屏死局）
- **实际**：（Human 填）
- **责任**：MiniApp（request.ts 自动续签逻辑）+ Backend（/auth/refresh）
- **真机信息**：（Human 填）

---

## SU-011 授权拒绝（隐私授权拒绝 → 只读演示）

- **Category**：授权拒绝
- **Severity**：P1
- **PRD 锚点**：COSTRA-101 AC-4 + PRD Epic-A §AC-4（隐私授权拒绝 → 只读演示）+ smoke-cases.md S-002 拒绝路径
- **前置条件**：
  - 首次启动小程序（无 storage）
  - 已读过隐私协议
- **步骤**：
  1. 启动小程序 → 隐私授权弹窗出现
  2. **拒绝**（点"拒绝"或"关闭"）
- **预期**：
  - 弹窗关闭，不崩溃
  - 进入只读演示模式（可能只显示示例账本）
  - 无法同步（无 Token）
  - Console 无报错
- **实际**：（Human 填）
- **责任**：MiniApp（隐私授权逻辑）
- **真机信息**：（Human 填）
- **参考**：[微信官方隐私授权文档](https://developers.weixin.qq.com/miniprogram/dev/framework/user-privacy/)）

---

## SU-012 兼容性（基础库 2.32.3 vs 3.8.12 双版本最小冒烟）

- **Category**：兼容
- **Severity**：P2
- **PRD 锚点**：D-022 §3.1（微信基础库版本差异）+ NFR（微信 ≥ 8.0.30）
- **前置条件**：
  - 两套微信开发者工具（或同 IDE 切换 libVersion）
  - libVersion = 2.32.3（最低）+ 3.8.12（当前）
- **步骤**：
  1. libVersion 2.32.3：启动小程序 → 登录 → 记一笔
  2. libVersion 3.8.12：重启小程序 → 同上操作
- **预期**：
  - 双版本：登录闭环 + 记一笔全流程一致
  - libVersion 差异：`too eayly` 在 2.32.3 可能出现（已知 Bug），在 3.8.12 消失
  - Console 无版本相关差异错误（除已知启动期 SDK Bug）
- **实际**：（Human 填）
- **责任**：MiniApp（跨 lib 兼容）+ DevOps（如需 polyfill）
- **真机信息**：（Human 填）

---

## SU-013 安全（Token 不入 URL/日志 grep 自查）

- **Category**：安全
- **Severity**：P2
- **PRD 锚点**：COSTRA-103 AC-3（Token 不入日志/URL）+ ADR-0004 §7（安全校验）
- **前置条件**：无（纯静态检查）
- **步骤**：
  1. grep `miniprogram/services/` 下所有 `.ts` 文件：
     ```bash
     grep -rn "access_token\|TOKEN\|token" miniprogram/services/ | grep -E "url:|URL|log|console\."
     ```
  2. 检查 Console 网络请求 Tab：Token 是否出现在请求 URL 路径中
  3. 检查 server 日志（pino JSON）：是否有 `"token":"<VALUE>"` 字段
- **预期**：
  - grep 0 命中（Token 不出现在 URL / 日志输出中）
  - 网络请求 Tab：`Authorization: Bearer <TOKEN>` 在 Header 不在 URL
  - server logs：零 `"token"` 明文字段
- **实际**：（Human 填）
- **责任**：MiniApp（Token 存储/传递）+ Backend（日志规范）
- **真机信息**：（不适用）

---

## SU-014 主包体积 ≤ 1.5MB / 总包 ≤ 16MB

- **Category**：性能 / 合规
- **Severity**：P1
- **PRD 锚点**：ADR-0004 §2 + smoke-cases.md S-013
- **前置条件**：
  - 已 `npm install` + `npm run build`（或微信开发者工具构建）
- **步骤**：
  1. `cd miniprogram && npm run build` 或在开发者工具中查看"详情 → 项目配置 → 包大小"
  2. 记录主包 + 各分包大小
- **预期**：
  - 主包 ≤ 1.5MB
  - 总包 ≤ 16MB
  - `npm run check:whitelist` exit 0（域名白名单合规）
- **实际**：（Human 填）
- **责任**：MiniApp（包体积优化）+ DevOps（CI 体积门禁）
- **真机信息**：（不适用）

---

## 附录 A：PRD 锚点索引（15 条用例 × ≥1 条 · v1.1 含 SU-004A/B 拆分）

| Case ID | PRD 锚点 |
|---|---|
| SU-001 | COSTRA-101 AC-1 · AC-2 |
| SU-002 | COSTRA-113 AC-1 |
| SU-003 | COSTRA-113 AC-4 |
| SU-004A | COSTRA-113 AC-4 · COSTRA-122 AC-3 |
| SU-004B | COSTRA-113 AC-4 · sync-protocol §3.1/§3.2 · D-022 §4.1（runtime T2 集成层）|
| SU-005 | COSTRA-122 AC-3 · sync-protocol §2.5 |
| SU-006 | COSTRA-123 AC-1 · sync-protocol §3 |
| SU-007 | NFR · S-014 |
| SU-008 | COSTRA-111 AC-3 · ADR-0004 §4 |
| SU-009 | NFR · S-001 |
| SU-010 | COSTRA-103 AC-1 · S-004 |
| SU-011 | COSTRA-101 AC-4 · S-002 拒绝路径 |
| SU-012 | D-022 §3.1 · NFR |
| SU-013 | COSTRA-103 AC-3 |
| SU-014 | ADR-0004 §2 · S-013 |

---

**修订记录**：
- v1.1 · 2026-05-13 · SU-004 拆 SU-004A（push 链路诊断）+ SU-004B（client 视角端到端回环）· 九类覆盖扩展为十类（新增"集成层契约对齐"）· 同步手册 v1.4 H6 硬断言 · 兑现 D-022 §4.1 runtime 类 T2 卡 Human 实测前置铁律真正立意
- v1.0 · 2026-05-12 · COSTRA-105 R1 实装（qa-planner 首次实战）