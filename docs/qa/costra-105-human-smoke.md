# COSTRA-105 · Human 端到端实测手册（单人记账闭环 + 离线弱网）

> **卡号**：COSTRA-105（Sprint-2 主线第 4 张）
> **验证类别**：T2-with-runtime · Human 模拟器实测前置（D-022 §4.1 强制铁律）
> **执行人**：Human（本项目唯一持真微信开发者工具者）
> **计划执行时间**：COSTRA-105 R1 review-tech PASS 后立刻
> **预计耗时**：25~35 分钟（5 个步骤 + ≥ 5 硬断言）
> **验证对象**：单人记账完整闭环（client 103 + server 104 拼接）+ 离线弱网专项
> **runtime 类 T2 铁律**：D-022 §4.1 命中（平台 API 运行时行为 + 微信基础库版本差异）· 断言全 PASS 才能 T1 终审

---

## 0. 前置环境清单

### 0.1 工具 & 凭证

- [ ] **微信开发者工具** ≥ 1.06.x（含基础库 3.8.12）
- [ ] **项目目录**：`/Users/weizhao/Desktop/Costra`（已 checkout 当前分支 `dev` · HEAD = `a586e95`）
- [ ] **本地 Node.js**：≥ 18.x
- [ ] **npm install** 已完成
- [ ] **已构建 npm**（工具 → 构建 npm）

### 0.2 前置条件

```bash
cd /Users/weizhao/Desktop/Costra
npm install
npm run typecheck   # 期望：exit 0
npm run test        # 期望：21~34 tests passed
```

### 0.3 Server 启动（WX_MOCK_LOGIN 模式）

```bash
# 终端 1：启动 server（dev WX mock · 任意 code 都能登入）
cd server
WX_MOCK_LOGIN=1 npm run dev

# 期望日志：
# {"level":30,...,"msg":"Server listening at http://127.0.0.1:8080"}
# {"level":40,...,"wxMockLogin":true,"msg":"⚠️  WX_MOCK_LOGIN enabled · code2Session mocked"}
```

### 0.4 DB Migrations（全跑齐）

```bash
cd server
for f in db/migrations/*.sql; do
  echo "=== $f ==="
  psql 'postgres://costra:costra_dev_pw@localhost:5432/costra' -f "$f"
done
```

### 0.5 R1 范围声明

> **本卡 R1 实装范围**：
>
> - `qa/strategy.md`（~120 行）
> - `qa/cases/single-user-smoke.md`（14 条用例 · 九类覆盖）
> - **本手册**（Human 模拟器实测 5 步 + 5 硬断言）
> - `qa/automation/` 脚手架（两种形式择一）
> - `qa/checklists/wechat-review.md`（占位骨架）
>
> **不实装**：全量自动化 / 微信审核深填 / 真机矩阵实跑 / k6 / ZAP
>
> **与 103/104 关系**：
> - 103：client outbox 本地 KV 持久化（5 步已通）· 本卡复用其断言逻辑
> - 104：server `/sync/push` + `/entries` POST/GET（curl 5 步已通）· 本卡复用其 dev DX 三件套

---

## 1. 步骤 A · 冷启动 + 登录闭环（SU-001 对应）

### 1.1 操作

1. **清 storage**（Console 执行）：
   ```js
   wx.clearStorageSync()
   console.log('storage cleared, ready for step A')
   ```
2. **杀掉微信进程**，重新打开小程序
3. **计时**：从点击图标到 `home` 可点击
4. 点"一键微信登录"（Mock 模式 · WX_MOCK_LOGIN=1）
5. 允许获取用户信息

### 1.2 断言（4 条）

| # | 断言 | 期望 |
|---|---|---|
| A1 | TTI ≤ 2s（NFR） | 可度量 |
| A2 | 2s 内跳 `home` | 页面可见 |
| A3 | `wx.getStorageSync('__costra_token_v1')` 有有效 Token（access_token ≥ 36 字符）| 可度量 |
| A4 | Console 无 `too eayly` 报错 | 0 次 |

### 1.3 Pass/Fail

- [ ] Pass · [ ] Fail（如 A4 FAIL：`revise:COSTRA-105 reason:too eayly in login flow`）

---

## 2. 步骤 B · 在线记一笔（SU-002 对应 · 端到端）

### 2.1 操作

1. 进入首页 → 点击 FAB `+` → 进入记一笔页
2. 选"支出"，金额输入 `12.34`，分类选"餐饮"，备注 `manual-test-b`
3. 提交（点保存）
4. **提交前打开 Console → Storage Tab**

### 2.2 断言（5 条）

| # | 断言 | 期望 |
|---|---|---|
| B1 | Toast "已记录" 或 "保存成功" | UI 可见 |
| B2 | `entry:__index` 长度 ≥ 1 | Storage Tab |
| B3 | `entry:{client_ref_id}` 存在（格式 `entry:<uuid>`）| Storage Tab |
| B4 | payload 100% snake_case（ledger_id / amount / category_id / occurred_at）| Console grep |
| B5 | Console 无 `TypeError` / `console.error` | 0 次 |

### 2.3 Pass/Fail

- [ ] Pass · [ ] Fail（如 B4 FAIL：`revise:COSTRA-105 reason:camelCase payload leak`）

---

## 3. 步骤 C · 离线记一笔 + outbox 入队（SU-003 对应）

### 3.1 操作

1. 开发者工具 → **Network → Offline**（模拟断网）
2. 在离线状态下记一笔：金额 `56.78`，备注 `offline-test-c`，分类"交通"
3. 提交

### 3.2 断言（5 条）

| # | 断言 | 期望 |
|---|---|---|
| C1 | Toast "已记录"（本地排队）| UI 可见 |
| C2 | `entry:__index` 长度 = 原长度 + 1 | Storage Tab |
| C3 | `outbox:__index` 长度 = 原长度 + 1 | Storage Tab |
| C4 | `outbox:{seq}` payload 含 `amount: 5678`（snake_case）| Console |
| C5 | `client_ref_id` 格式 UUID v4（36 字符）| Console |

### 3.3 Pass/Fail

- [ ] Pass · [ ] Fail（如 C4 FAIL：`revise:COSTRA-105 reason:outbox payload camelCase`）

---

## 4. 步骤 D · 联网恢复 → outbox 自动 push（SU-004 对应）

### 4.1 操作

1. 开发者工具 → **Network → Online**（取消离线）
2. 等待 10~30s 观察 Console
3. Console 搜索 `POST /sync/push` 或 `[outbox]`

### 4.2 断言（3 条）

| # | 断言 | 期望 |
|---|---|---|
| D1 | Console 有 `POST /sync/push` 请求 | 日志可见 |
| D2 | `outbox:__index` 长度 = 原长度 - 已推条数（或 outbox 有 pushed_at 标记）| Storage Tab |
| D3 | DB 查询：`SELECT count(*) FROM entries WHERE note = 'offline-test-c'` → 1 | psql |

### 4.3 Pass/Fail

- [ ] Pass · [ ] Fail（如 D1 未出现：可能是 FU-103-CLIENT-SYNC-SCHEDULER 未触发 → **不阻断本卡** · 记录到 follow-up）

---

## 5. 步骤 E · 幂等验证（SU-005 对应 · curl）

### 5.1 操作

```bash
# 5.1.1 拿 Token（如步骤 A 的 Token 仍有效可复用）
cd server
# 确保 server 运行中（WX_MOCK_LOGIN=1）

# 5.1.2 seed family/ledger（如首次需先 seed）
psql 'postgres://costra:costra_dev_pw@localhost:5432/costra' \
  -v user_id="'$(psql 'postgres://costra:costra_dev_pw@localhost:5432/costra' -t -c "SELECT id FROM users LIMIT 1" | xargs)'" <<'SQL'
INSERT INTO families (id, name, owner_id) VALUES ('00000000-0000-0000-0000-0000000000F0', 'ManualTestFamily', :user_id) ON CONFLICT DO NOTHING;
INSERT INTO ledgers (id, family_id, name) VALUES ('00000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-0000000000F0','Main') ON CONFLICT DO NOTHING;
INSERT INTO family_members (family_id, user_id, role) VALUES ('00000000-0000-0000-0000-0000000000F0', :user_id, 'owner') ON CONFLICT DO NOTHING;
SELECT 'seed done' AS status;
SQL

# 5.1.3 登录拿 Token
TOKEN=$(curl -s -X POST http://127.0.0.1:8080/auth/wx-login \
  -H 'content-type: application/json' \
  -d '{"code":"manual-test-105"}' | jq -r '.access_token')
echo "TOKEN=$TOKEN"

# 5.1.4 第一次 POST idempotent test
curl -s -X POST http://127.0.0.1:8080/sync/push \
  -H 'content-type: application/json' \
  -H "authorization: Bearer $TOKEN" \
  -H 'idempotency-key: 88888888-8888-8888-8888-888888888888' \
  -d '{"ops":[{"op":"create","entity":"entry","client_ref_id":"manual-idemp-001","base_version":null,"payload":{"ledger_id":"00000000-0000-0000-0000-000000000001","amount":8888,"type":"expense","occurred_at":"2026-05-12T09:00:00.000Z"}}]}' | jq .

# 5.1.5 立刻重发（同一 idempotency-key）
curl -s -X POST http://127.0.0.1:8080/sync/push \
  -H 'content-type: application/json' \
  -H "authorization: Bearer $TOKEN" \
  -H 'idempotency-key: 88888888-8888-8888-8888-888888888888' \
  -d '{"ops":[{"op":"create","entity":"entry","client_ref_id":"manual-idemp-001","base_version":null,"payload":{"ledger_id":"00000000-0000-0000-0000-000000000001","amount":8888,"type":"expense","occurred_at":"2026-05-12T09:00:00.000Z"}}]}' | jq .
```

### 5.2 断言（4 条）

| # | 断言 | 期望 |
|---|---|---|
| E1 | 第 1 次响应：`"status":"ok"` + `server_version: 1` | 可度量 |
| E2 | 第 2 次响应：`"status":"ok"` + **相同** `server_id` + **相同** `server_version: 1` | 完全一致 |
| E3 | DB：`SELECT count(*) FROM entries WHERE client_ref_id = 'manual-idemp-001'` → **1** | psql |
| E4 | 协议 100% snake_case（0 次 `amountCents` / `categoryId` 等驼峰）| 响应字段 |

### 5.3 Pass/Fail

- [ ] Pass · [ ] Fail（如 E3 返回 > 1：`revise:COSTRA-105 reason:idempotency-broken`）

---

## 6. ≥ 5 硬断言（H1~H5 · 全 PASS 才可 T1 终审）

| # | 断言 | 验证位置 | 对应 DoD |
|---|---|---|---|
| **H1** | 冷启 TTI ≤ 2s + Launch Time ≤ 900ms（3.8.12 基线）| 步骤 A A1 | DoD §3.2 |
| **H2** | `entry:__index` 离线写入持久化不丢（`offline-test-c` 在）| 步骤 C C2 | DoD §3.2 |
| **H3** | `outbox:__index` 多 key 分片正确（0 次单 key 数组残留）| 步骤 C C3 | DoD §3.2 |
| **H4** | idempotency 重放不重复入账（DB count = 1）| 步骤 E E3 | DoD §3.2 |
| **H5** | payload 100% snake_case（`ledger_id` / `amount` / `category_id`）| 步骤 B B4 / 步骤 E E4 | DoD §3.2 |

**H1~H5 全 PASS = T1 终审放行** · **任意 FAIL = 卡退回 R1 修复**

---

## 7. 真机矩阵填充表

| 机型 | 系统 | 微信版本 | 基础库版本 | A 步骤 | B 步骤 | C 步骤 | D 步骤 | E 步骤 | 通过/失败 |
|---|---|---|---|---|---|---|---|---|---|
| （Human 填） | | | | | | | | | |
| （Human 填） | | | | | | | | | |

---

## 8. 失败分流

| 步骤 FAIL | 转介 Agent | 说明 |
|---|---|---|
| A（login flow）| miniapp-dev + backend-dev | 登录链路问题 |
| B（entry save）| miniapp-dev | 前端写本地问题 |
| C（offline entry）| miniapp-dev（COSTRA-103 相关）| outbox 入队问题 |
| D（outbox push）| miniapp-dev（FU-103-CLIENT-SYNC-SCHEDULER）| client 调度器未触发（follow-up）|
| E（idempotency）| backend-dev（COSTRA-104 相关）| server 幂等逻辑问题 |

---

## 9. 与 102/103/104 手册关系

| 手册 | 角色 | 本卡复用/扩展 |
|---|---|---|
| `costra-103-human-verify.md` | client outbox 本地 KV 持久化（5 步已通）| 复用步骤 B/C 断言逻辑（entry key / outbox key）|
| `costra-104-curl-verify.md` | server curl 5 步实测（已通）| 复用 dev DX 三件套（WX_MOCK_LOGIN/migrate/seed）+ 步骤 E 幂等 curl 格式 |
| `costra-102-human-verify.md` | 登录→首页→记一笔 E2E（已通）| 本卡步骤 A 复用登录闭环 + 步骤 B 复用记一笔格式 |

---

**协议事实源**：
- `server/api/openapi.yaml` v0.1
- `docs/api/sync-protocol.md` §2（sync/push 三态）/ §2.5（幂等）/ §3（version conflict）
- `docs/api/id-strategy.md`（client_ref_id / idempotency_key 格式）

**修订记录**：
- v1.0 · 2026-05-12 · COSTRA-105 R1 实装