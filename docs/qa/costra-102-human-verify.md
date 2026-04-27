# COSTRA-102 · Human 本地验证手册（MiniApp 登录 → 首页 → 记一笔端到端）

> **卡号**：COSTRA-102（Sprint-1 主线第三卡）  
> **验证类别**：T1 终审前置 · Human 本地验证（能力边界铁律替代凭证）  
> **执行人**：Human（本项目拥有者 · 唯一持真机 / 真微信开发者工具 / 真后端服务器访问权限者）  
> **计划执行时间**：2026-04-30（Sprint-1 中点 · `sprint-01-plan.md §Human 介入节点` 硬锁定）  
> **预计耗时**：20 分钟（5 个步骤 · 每步约 3~4 分钟）  
> **验证对象**：本卡所有 D2.x + COSTRA-118 §分流矩阵 14 项（MiniApp 运行时真实表现）  
> **能力边界铁律**：Agent 无真机 / 无真微信开发者工具 / 无真服务器访问权 · 本手册为 Agent 不可验证部分的替代凭证

---

## 0. 前置环境清单

### 0.1 工具 & 凭证
- [ ] **微信开发者工具** 稳定版 1.06.2405090 或更高（≥ 基础库 2.21.2 · 含 getUserProfile 2.10.4 语义）
- [ ] **项目目录**：`/Users/weizhao/Desktop/Costra`（已 checkout 当前分支 `dev` · 最新 commit 含 COSTRA-102 交付）
- [ ] **本地 Node.js**：≥ 18.x（`node -v` 确认）
- [ ] **COSTRA-115 DNS**：如已完成则 staging/prod 域名可用；未完成时使用 dev（local server）链路验证即可

### 0.2 后端服务器
本卡 MiniApp 侧需联通 `/auth/wx-login` `/auth/refresh` `/auth/logout` 三端点。选择下列方式之一：

| 方式 | 适用场景 | 操作 |
|---|---|---|
| **A · 本地 server（推荐）** | COSTRA-115 DNS 未就绪 / 想独立验证 MiniApp 侧 | `cd server && npm run dev` · MiniApp `services/env.ts` 确认 `dev.apiBaseUrl = 'http://127.0.0.1:3000/v1'` · 微信开发者工具打开"不校验合法域名"开关 |
| **B · Mock 通路** | 仅想验证登录流 / 首页 / 记一笔本地入 outbox，不依赖后端 | 保持 `services/env.ts` 的 `dev.mockLogin: true`（骨架默认）· 此模式下 wx.login 的 code 直接在客户端侧造假 Token · 无需启 server |
| **C · 真 staging（可选 · 仅 COSTRA-115 + COSTRA-116 就绪后）** | 贯通真实链路 | 手动改 `services/env.ts` 的 `CURRENT_ENV: EnvName = 'staging'`（本卡不动 P1-5 · 归 COSTRA-108） |

> **本次 2026-04-30 验证推荐**：先跑 **B · Mock 通路**（5 分钟完整 5 步），再跑 **A · 本地 server**（复跑步骤 1/2/5 即可 · 贯通真实 wx.login → 真 JWT）。

### 0.3 依赖安装（首次）
```bash
cd /Users/weizhao/Desktop/Costra
npm install                    # 装 decimal.js（运行时）+ vitest（开发时）
npm run typecheck              # 期望：无错误退出（exit 0）
npm test                       # 期望：11 条单测全绿（含 money P0-1 防浮点 · time P0-8 防双减）
```

---

## 1. 步骤 A · 登录（E.P0-10-partA · E.P0-1/2/3 现场验证）

### 1.1 操作
1. 打开微信开发者工具 → 打开项目 `miniprogram/`
2. 左侧"真机调试" or 模拟器任选
3. 点击页面中央的 **"一键微信登录"** 按钮
4. **首次会弹 `getUserProfile` 授权弹窗** · 点击"允许"（若拒绝 · 也应可继续登录流程仅无昵称/头像）

### 1.2 期望
- [ ] 按钮**没有** `open-type="getUserInfo"`（右键审查元素 · E.P0-10-partA 验证）
- [ ] Console 打印 `[auth] wx.login ok { codeLen: xx }`，**不**包含 code 片段（E.P0-1 日志脱敏验证）
- [ ] 3 秒内跳转到首页（tabBar #1）· 无红字错误
- [ ] Mock 模式：网络面板无请求；本地 server 模式：网络面板有 **POST /v1/auth/wx-login** · 请求 body `{ code: "..." }` · 响应 200 · body 含 **`access_token` / `refresh_token` / `access_token_ttl_sec` / `refresh_token_ttl_sec` / `user`** 五字段（E.P0-2 验证）

### 1.3 截图位置
- 登录按钮（截图） → 填入 `docs/qa/costra-102-local-verify-screenshots/01-login-btn.png`
- Console 输出（截图） → `02-login-console.png`
- 真实模式下的网络请求 → `03-login-network.png`（Mock 模式此步可跳）

### 1.4 Pass/Fail
- [ ] Pass · [ ] Fail（Fail 填 §6 失败回报模板）

---

## 2. 步骤 B · 首页昵称 & 头像（E.P1-4 + 新增画像区验证）

### 2.1 操作
1. 登录后自动跳到首页
2. 观察首页顶部新增的"问候区"

### 2.2 期望
- [ ] 顶部显示 `你好，[昵称]` · 昵称来源：
  - Mock 模式 → "测试用户"（`services/auth.ts mockExchange` 默认值）
  - 本地 server 模式 → 真实微信授权昵称（若 getUserProfile 通过）或 "微信用户"（若拒绝）
- [ ] 左侧头像：
  - 有 avatar_url → 正常显示圆形头像
  - 无 avatar_url → 显示 👤 fallback 图标
- [ ] TODO 注释已纠正（查 `pages/home/index.ts refresh()` · 应引用 COSTRA-401 或 Epic-F /reports/monthly · E.P1-4 验证）

### 2.3 Pass/Fail
- [ ] Pass · [ ] Fail

---

## 3. 步骤 C · 记一笔（E.P0-8 时间 + E.P1-1 金额 decimal 验证）

### 3.1 操作
1. 首页右下角 FAB `+` 点击 → 跳记一笔页
2. 输入金额 **`0.1`**（故意触发浮点精度雷区）
3. 记录备注 `测试第一笔`
4. 点击提交

### 3.2 期望
- [ ] 金额输入框显示 `0.10`（decimal.js 格式化 · E.P1-1 验证）
- [ ] 提交后 Toast "已记录"
- [ ] 回到首页
- [ ] **再打开 microtask**：
  - 微信开发者工具 Console 执行：
    ```js
    wx.getStorageSync('__costra_outbox_v1')
    ```
  - 预期返回一个 envelope，其 `.d` 数组里有一条 `amountCents: 10`（E.P1-1 0.1 元 = 10 分 · 若为 `9.999...` 或 NaN 则 Fail）
  - 该条的 `occurredAt` 是一个 **合法 ISO UTC 字符串**（形如 `2026-04-30T07:xx:xx.xxxZ`）且对应当前真实时间 ± 5 秒 · **不是** 8 小时前或 16 小时前（E.P0-8 验证）

### 3.3 Pass/Fail
- [ ] Pass · [ ] Fail

---

## 4. 步骤 D · 检查 outbox & Entity 枚举（E.P0-7 验证）

### 4.1 操作
1. Console 执行：
   ```js
   const ob = wx.getStorageSync('__costra_outbox_v1');
   console.table(ob.d);
   ```

### 4.2 期望
- [ ] 表格显示至少 1 条记录
- [ ] 列名应含：`type` / `amountCents` / `categoryId` / `note` / `occurredAt` / `localId` / `createdAt`
- [ ] `type` 值为 `expense` 或 `income`（与 OpenAPI Entry.type 枚举一致 · 骨架幻觉 `ledger_entries` 不复现 · E.P0-7 验证）

### 4.3 Pass/Fail
- [ ] Pass · [ ] Fail

---

## 5. 步骤 E · 退出登录（D2.2 新增 logout 真调验证）

### 5.1 操作
1. 切到"我的"tab（tabBar #3）
2. 点击"退出登录" → 弹窗"确定要退出吗？" → 确认
3. 观察网络面板 + 自动跳转

### 5.2 期望
- [ ] 网络面板有 **POST /v1/auth/logout** 请求
  - Mock 模式：无此请求（env.mockLogin=true 下跳过远程调用 · 可接受）
  - 本地 server 模式：**状态码 204**（OpenAPI 契约）
- [ ] 跳回登录页（`pages/login/index`）
- [ ] Console 执行 `wx.getStorageSync('__costra_token_v1')` 返回 `''`（已清）

### 5.3 Pass/Fail
- [ ] Pass · [ ] Fail

---

## 6. 失败回报模板（任一步 Fail 时填写）

> **提交位置**：`.team/reviews/COSTRA-102/human-verify-fail-report.md`（如无则新建）  
> **同步发送方式**：发 orchestrator trigger `revise:COSTRA-102 reason:<一句话摘要>`  
> **分级**：
> - **🔴 Hard-Fail**：D2.x DoD 未达成 · 直接拒收 → 发 `revise`
> - **🟠 Soft-Fail**：能用但有偏差 · 允许进入 T1 终审时登记 FU 不阻塞收口
>
> 分级由 Human 依据手册条目重要性主观判断：步骤 A/B/C 任一 Fail = Hard；步骤 D/E 边缘问题 = Soft。

### 模板
```markdown
# COSTRA-102 · Human 本地验证失败报告

- 卡号：COSTRA-102
- 验证执行时间：2026-04-30 HH:mm
- 失败步骤：<A/B/C/D/E>
- 失败分级：<Hard / Soft>
- 现象描述（3~5 句）：
  -
  -
- 期望行为（参照手册 §<x>.<y>.期望）：
  -
- 实际现象（含截图/日志）：
  -
- 已尝试的排查（可选）：
  -
- 建议修复方向（可选）：
  -
```

---

## 7. 验证完成后的动作

### 7.1 全 Pass（推荐路径）
- Human 发 `approve:COSTRA-102` → Orchestrator 整卡收口
- 触发下游：COSTRA-103 本地持久化卡 · COSTRA-104 批量推送卡（Sprint-1 剩余主线）
- COSTRA-118 剩余 P0-10 part B 待 COSTRA-109 PM 产出后同步填入（归 FU-118-4 范围）

### 7.2 部分 Fail
- Human 填 §6 模板 → 发 `revise:COSTRA-102 reason:...` → Agent 按 D-011 方案 B 自动续跑第 2 轮 Review/Revise

### 7.3 Soft-Fail 允许带 FU 通过
- Human 发 `approve:COSTRA-102 with-follow-ups:FU-102-X,...` → Orchestrator 收口并登记到 Sprint-2 FU 队列

---

## 8. 相关事实源 & 佐证

- 派单：`.team/dispatch/COSTRA-102-miniapp-login-e2e.md`
- 上游分流：`.team/reviews/COSTRA-118/FINAL.md §分流矩阵`
- OpenAPI 契约事实源：`server/api/openapi.yaml`（AuthTokenPair §L820-839 · /auth/wx-login §L61-92 · /sync/pull §L614-637）
- 错误码事实源：`docs/api/error-codes.md`
- 同步协议事实源：`docs/api/sync-protocol.md`（与 dispatch 差异点见 §3 INFO-1）
- Sprint-1 计划锁：`.team/sprints/sprint-01-plan.md §Human 介入节点`（2026-04-30 20 分钟）
- 能力边界铁律：`.team/decisions/` 下 COSTRA-114 v2 定义
- Mock 策略边界：本 dispatch §1.3
