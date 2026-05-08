# Follow-ups · Review 延后项登记

> 登记规则：Review-Agent 判为 P2（不阻断当卡）且被审 Agent 采纳"延后到后续 Sprint 处理"的条目集中登记于此，供 Sprint Planning 会议扫描认领。
>
> **维护人**：Orchestrator（在 `{Agent}-Revision-Response` 产出时同步写入本索引）
> **消费方**：PM-Agent（Sprint Planning 扫描 → 纳入新卡或并入相关卡）
>
> **状态字段**：
> - `open` — 待 Sprint 认领
> - `scoped` — 已认领到某卡/某 Sprint（填 `owner_card`）
> - `closed` — 已完成（填 `resolved_by` commit / 卡号）

---

## 登记列表

### FU-001 · 业务占位昵称配置化

- **来源**：`.team/reviews/COSTRA-101/round-1-tech.md` P2-1
- **登记时间**：2026-04-24 11:50（COSTRA-101 Round 1 Revise）
- **范围**：`server/src/services/authService.ts` wxLogin 路径里的硬编码 `nickname: '微信用户'`
- **建议**：抽到 `server/src/config/defaults.ts` 导出 `defaultNickname`，支持 env 覆盖 + subjectConfig 语境化
- **阻断级别**：P2（不阻当卡 · 登录链路业务可用）
- **认领建议**：Sprint-2 **Epic-F 用户资料完善**（若立项）或并入"小程序首次登录完善资料"卡
- **状态**：`open`
- **owner_card**：（待 Sprint-2 Planning 认领）
- **同类拓展**：FU-118-2（miniprogram 端 "未命名用户"）· 建议合并处理

---

### FU-118-1 · miniprogram README 出现 AppID（灰色区 / 观察项）

- **来源**：`.team/reviews/COSTRA-118/round-1-tech.md` 灰色区二裁段
- **登记时间**：2026-04-24 19:35
- **范围**：`miniprogram/README.md:12, :42` 两处出现 `wxf8b0d3e3a83f9941`
- **问题**：Review-Tech §3.5 红线原文"AppID 不得出现在 miniprogram 源码中"的"源码"定义存在歧义 — 狭义（.ts/.wxml/.wxss/.json）vs 广义（含 README/文档）。Reviewer 主张务实派（README 不打包进小程序产物 · 开发可读性价值高）· 降级为观察项。
- **建议**：Sprint-1 末在 `engineering-guidelines §2.5` 补一句显式澄清："AppID 红线仅针对会打包进小程序产物的文件（.ts/.wxml/.wxss/.json）· README 等文档类文件豁免"
- **阻断级别**：O-观察项（不阻 COSTRA-118）
- **认领建议**：Sprint-1 末由 PM-Agent 在 engineering-guidelines 维护批次一起改
- **状态**：`open-observation`

---

### FU-118-2 · miniprogram 端硬编码昵称 "未命名用户"

- **来源**：`.team/reviews/COSTRA-118/round-1-tech.md` P2-2
- **登记时间**：2026-04-24 19:35
- **范围**：`miniprogram/pages/mine/index.ts:19`
- **建议**：与 FU-001 合并处理（server 与 miniprogram 两端同时改）· 统一读 `config/subject.ts` 或 `config/defaults.ts` 的 `defaultNickname`
- **阻断级别**：P2
- **认领建议**：Sprint-2 合入 FU-001 同卡
- **状态**：`open`

---

### FU-118-3 · miniprogram/tokens.json 未被任何 wxss 消费（设计-实装脱节）

- **来源**：`.team/reviews/COSTRA-118/round-1-tech.md` P0-9 根因分析
- **登记时间**：2026-04-24 19:35
- **范围**：`miniprogram/tokens/index.ts` 正确导出 colors/shadows/radii，但 `app.wxss` 与各页面 wxss 全部用手写 CSS 变量 · 两套完全脱节
- **建议**：Sprint-2 独立专项卡"设计系统 miniprogram 侧闭环"
  - 方案：写构建脚本 `scripts/gen-wxss-tokens.mjs` · 从 `tokens.json` 自动生成 `app.wxss` 的 `:root {}` 段
  - 副产品：保证所有页面引用的变量名都在 token 真身内
- **阻断级别**：P0 根因（本卡 P0-9 的深层修复）· 但本卡采用快修方案 A（手动补齐 app.wxss）· 彻底方案 B 延到 Sprint-2
- **认领建议**：Sprint-2 新立 COSTRA-160 `miniapp-design-tokens-pipeline`（暂定号段）
- **状态**：`open`

---

### FU-118-4 · miniprogram 占位页卡号幻觉（COSTRA-060/130/140/150 不存在）

- **来源**：`.team/reviews/COSTRA-118/round-1-tech.md` P2-1
- **登记时间**：2026-04-24 19:35
- **范围**：
  - `pages-stat/month/index.ts` → `COSTRA-130`（不存在）
  - `pages-family/home/index.ts` → `COSTRA-140`（不存在）
  - `pages-family/settings/index.ts` → `COSTRA-150`（不存在）
  - `pages-family/privacy/index.wxml` → `COSTRA-060`（不存在）
- **建议**：Sprint-1 末 Retro 一次性纠正：
  - COSTRA-130 → COSTRA-202（Epic-D 家庭成员角色）或新 COSTRA-401（Epic-F 月度报表）
  - COSTRA-060 → COSTRA-109（PM 隐私指引清单）或 COSTRA-901（Epic-G 隐私协议）
- **阻断级别**：P2
- **认领建议**：Sprint-2 头部 COSTRA-106 Retro 合并处理
- **状态**：`open`

---

### FU-118-5 · miniprogram 关键路径 console.* 统一日志封装

- **来源**：`.team/reviews/COSTRA-118/round-1-tech.md` P2-4
- **登记时间**：2026-04-24 19:35
- **范围**：app.ts × 3 + services/auth.ts × 4 + services/storage.ts × 3 + services/request.ts × 1 = 11 处 `console.*`
- **建议**：Sprint-2 引入统一 logger 封装
  - 方案 A：`utils/logger.ts` 包装 `wx.getRealtimeLogManager()`（微信官方实时日志）+ ring buffer
  - 方案 B：上报到后端 APM（依赖 COSTRA-903）
- **阻断级别**：P2
- **认领建议**：Sprint-2 与 APM 卡（COSTRA-903）合入
- **状态**：`open`

---

### FU-118-6 · miniprogram/utils/money.ts 引入 decimal.js（ADR-0002 硬约束）

- **来源**：`.team/reviews/COSTRA-118/round-1-tech.md` P1-1
- **登记时间**：2026-04-24 19:35
- **范围**：`miniprogram/utils/money.ts` 手写正则解析小数，违反 ADR-0002 `decimal.js` 硬约束
- **建议**：引入 `decimal.js@^10.4.3`（约 32KB · 可接受 · 小程序包大小预算 2MB 主包内无压力）
- **阻断级别**：P1（当前语义正确 · 非紧急 · 但属栈偏离应矫正）
- **认领建议**：COSTRA-102 实装时顺手切换（涉及金额输入的 entry 页最先受益）
- **状态**：`closed` @ 2026-04-27 10:12
- **owner_card**：COSTRA-102
- **resolved_by**：COSTRA-102 R1 实装 · `miniprogram/utils/money.ts` 全量重写 · 引入 `decimal.js@^10.4.3` · 3 函数（toCents / toYuan / parseAmountInputToCents）全部走 Decimal · 单测断言 `toCents('0.1') + toCents('0.2') === 30`（浮点数学典型坑位正向兜住）· ADR-0002 硬约束恢复合规

---

### FU-102-ERROR-MAPPER-INTEGRATION · login 页错误分支直出 err.message 违反红线

- **来源**：`.team/reviews/COSTRA-102/round-1-tech.md` P1-NEW-1 + `round-1-product.md` P1-NEW-1（双签方共识）
- **登记时间**：2026-04-27 10:14
- **范围**：`miniprogram/pages/login/index.ts` 错误分支 `wx.showToast({ title: err.message })` 违反 `docs/api/error-codes.md §0.5` 红线"客户端不得直接展示 message 给终端用户"
- **建议**：改为 `import { mapError } from '../../utils/error-mapper'; const m = mapError(err); wx.showModal({ title: m.title, content: m.desc })`
- **阻断级别**：P1（双签方均判非阻塞 · 放 FU 交 Human T1 终审前修或入下一轮）
- **认领建议**：Human 04-30 本地验证前 Agent 随手修 · 或入 Sprint-1 末批次
- **状态**：`open`
- **owner_card**：COSTRA-102（本卡兜底）

---

### FU-102-AVATAR-ONERROR · home.wxml binderror 对应 handler 未实现

- **来源**：`.team/reviews/COSTRA-102/round-1-tech.md` P1-NEW-2
- **登记时间**：2026-04-27 10:14
- **范围**：`miniprogram/pages/home/index.wxml` `<image binderror="onAvatarError">` · `index.ts` 无 `onAvatarError` 方法 · 头像 404 时无降级
- **建议**：补 `onAvatarError(): void { this.setData({ 'user.avatarUrl': '' }) }` 走 CSS fallback
- **阻断级别**：P1（功能非致命 · 头像 URL 不达可用默认）
- **认领建议**：与 FU-102-ERROR-MAPPER-INTEGRATION 同批次修
- **状态**：`open`
- **owner_card**：COSTRA-102

---

### FU-102-PROFILE-REFUSE-UI · 用户拒绝 getUserProfile 的空窗期 UI 状态

- **来源**：`.team/reviews/COSTRA-102/round-1-product.md` P2-NEW-1
- **登记时间**：2026-04-27 10:14
- **范围**：`miniprogram/pages/login/index.ts` 调 `wx.getUserProfile` 被用户取消授权时的 home 页空头像空昵称降级显示策略
- **建议**：home 页显示占位头像 + "欢迎" 无名称版本 + 页面角标"完善资料"入口（Sprint-2 产品细节）
- **阻断级别**：P2
- **认领建议**：Sprint-2 Epic-F 用户资料卡
- **状态**：`open`
- **owner_card**：（待 Sprint-2 Planning 认领）

---

### FU-COMMON-MINIAPP-PATCH-LIMIT · wx.request 不支持 PATCH（平台限制登记）

- **来源**：`.team/reviews/COSTRA-102/round-1-miniapp-response.md` INFO-C
- **登记时间**：2026-04-27 10:14
- **范围**：`miniprogram/services/request.ts` PATCH 方法在 wx.request type 中不存在 · Agent 已降级 `method === 'PATCH'` 时走 POST + `X-HTTP-Method-Override: PATCH` header
- **建议**：登记为跨卡复用的平台限制 · server 侧约定处理该 header · 不可修
- **阻断级别**：O-观察项（平台限制 · 已合规兜底）
- **认领建议**：server 端任一接受 PATCH 的接口（如 `PATCH /users/me`）需文档化接受 `X-HTTP-Method-Override` header · 议入 `docs/api/common-contract.md`
- **状态**：`open-observation`
- **owner_card**：跨卡通用（可入 engineering-guidelines 或 common-contract）

---

### FU-102-SYNC-PULL-DRIFT · dispatch 派单推导与事实源漂移（Retro 高优先）

- **来源**：`.team/reviews/COSTRA-102/round-1-miniapp-response.md` INFO-B + `round-1-tech.md` INFO
- **登记时间**：2026-04-27 10:14
- **范围**：`.team/dispatch/COSTRA-102-miniapp-login-e2e.md §D2.5` 写 "POST /sync/pull body"；事实源 `server/api/openapi.yaml L614-637` + `docs/api/sync-protocol.md §3.1` 明确为 GET + query string · Agent 按事实源实装 · Reviewer 确认正确
- **建议**：Orchestrator 派单推导机制应增加"事实源对账自查表"步骤（类似 O-R4-2 Revise 主报告自查表）· 避免派单引入次生幻觉
- **阻断级别**：INFO（本次未造成实装事故 · Agent 按事实源优先原则兜住）
- **认领建议**：**Sprint-1 末 Retro 议题（高优先）** · 配合 O-R4-2 一并议
- **状态**：`open`
- **owner_card**：Sprint-1 Retro（COSTRA-106 头部）

---

### FU-102-HUMAN-VERIFY-PARADIGM · 首张纯前端 T1 卡范式

- **来源**：`.team/reviews/COSTRA-102/round-1-product.md` INFO + card-def-product.md INFO-2
- **登记时间**：2026-04-27 10:14
- **范围**：COSTRA-102 作为首张纯前端 T1 卡 · 建立 "Agent 交付三件套（代码 + 单测 + 手册） + Human 20 分钟本地验证 = T1 终审必要凭证" 范式 · 破解 Agent 无真机访问权的能力边界约束
- **建议**：议入 `SOP-REVIEW.md v2.1 §11`：纯前端客户端 T1 卡 R1 交付必含本地验证手册 `docs/qa/COSTRA-<xxx>-human-verify.md`（0 前置 + 步骤明确 + 失败报告模板）
- **阻断级别**：INFO（范式议入 · 非缺陷）
- **认领建议**：Sprint-1 末 SOP 批次维护
- **状态**：`open`
- **owner_card**：Sprint-1 末 SOP 批次

---

## 📌 COSTRA-118 终审后状态流转（2026-04-27 09:39）

Human T2 `approve:COSTRA-118` 路径 A 收口 · 全部 FU-118-* 状态补齐 `owner_card`：

| FU-ID | 状态 | owner_card |
|---|---|---|
| FU-001 | `open` | Sprint-2 用户资料卡（合并 FU-118-2 同时处理） |
| FU-118-1 | `open-observation` | Sprint-1 末 engineering-guidelines §2.5 澄清（PM 维护批次） |
| FU-118-2 | `scoped` | Sprint-2 合并 FU-001 同卡 |
| FU-118-3 | `open` | Sprint-2 COSTRA-160（暂定）`miniapp-design-tokens-pipeline` |
| FU-118-4 | `open` | Sprint-2 COSTRA-106 Retro 头部合并处理 |
| FU-118-5 | `open` | Sprint-2 合入 COSTRA-903 APM 卡 |
| FU-118-6 | **`closed`** | **COSTRA-102 R1 已落地（2026-04-27 10:12 · decimal.js ^10.4.3 引入）** |

---

## 📌 COSTRA-102 R1 实装双签后状态流转（2026-04-27 10:14）

R1 Tech + Product 双签 APPROVE · 新增 6 条 FU-102-* 条目 · FU-118-6 关闭：

| FU-ID | 状态 | owner_card |
|---|---|---|
| FU-102-ERROR-MAPPER-INTEGRATION | `open` | COSTRA-102（Human 终审前随手修） |
| FU-102-AVATAR-ONERROR | `open` | COSTRA-102（同上） |
| FU-102-PROFILE-REFUSE-UI | `open` | Sprint-2 Epic-F |
| FU-COMMON-MINIAPP-PATCH-LIMIT | `open-observation` | 跨卡通用（engineering-guidelines / common-contract） |
| FU-102-SYNC-PULL-DRIFT | `open` | **Sprint-1 末 Retro 高优先议题** |
| FU-102-HUMAN-VERIFY-PARADIGM | `open` | Sprint-1 末 SOP-REVIEW v2.1 §11 |

---

## 📌 COSTRA-115 R1 T2 Tech APPROVE 后状态流转（2026-04-27 10:54 · COSTRA-116 后更新 14:30）

R1 DevOps 交付 · T2 Tech 单轨 APPROVE 28/30 · 新增 3 条 FU · 经 COSTRA-116 处置后：

| FU-ID | 状态 | owner_card |
|---|---|---|
| FU-COMMON-DEV-URL-DRIFT | **`closed`** @ 2026-04-27 | **COSTRA-116 已落地**（三源对齐 `http://localhost:8080/v1`） |
| FU-115-1 | **`closed`** @ 2026-04-27 | **COSTRA-116 已一并关闭**（豁免集合清空 · 规则 A/B 恢复全量强度） |
| FU-115-2 | `open` | **Human 主动**（ICP 下证日触发 · R-013 关闭条件） |

---

### FU-COMMON-DEV-URL-DRIFT · 开发期三源 dev URL / 端口不一致

- **来源**：`scripts/devops/whitelist-check.mjs` 首跑（2026-04-27 10:48）+ `.team/reviews/COSTRA-115/round-1-tech.md` INFO-A
- **登记时间**：2026-04-27 10:54（COSTRA-115 R1 T2 Tech APPROVE）
- **范围（四处 SSOT 冲突）**：
  - `miniprogram/services/env.ts` · `dev.apiBaseUrl = 'http://127.0.0.1:3000/v1'`（主机 127.0.0.1 · 端口 3000）
  - `server/api/openapi.yaml servers[1]` · `http://localhost:8080/v1`（主机 localhost · 端口 8080）
  - `server/.env.example` · `PORT=8080`（部署权威）
  - `server/src/config/env.ts` · `parsePort(optional(env, 'PORT', '3000'))`（代码回退默认 3000）
- **问题**：小程序 dev 调的地址（127.0.0.1:3000）与 server 真实启动地址（localhost:8080）**主机 + 端口两项均不一致**；server 内部 `.env.example` 与代码默认值也不一致。开发同事若直接克隆跑，连本地联调都拉不通。
- **COSTRA-115 临时处置（已作废）**：
  - 脚本加 `EXEMPTED_ENVS_FROM_RULES_AB = new Set(['dev'])` 豁免机制
  - 保证 COSTRA-115 commit 可过 pr-check；但 warning 持续提醒
- **COSTRA-116 正式修复**（2026-04-27）：
  1. ✅ `server/src/config/env.ts` L93 · `parsePort(optional(env, 'PORT', '3000'))` → `'8080'`（对齐 `.env.example PORT=8080`）
  2. ✅ `miniprogram/services/env.ts` L17 · `dev.apiBaseUrl = 'http://127.0.0.1:3000/v1'` → `'http://localhost:8080/v1'`（对齐 SSOT `infra/wechat/domains.md §1.1 local` 行）
  3. ✅ `server/api/openapi.yaml` 保持不动（本就是真相）
  4. ✅ `scripts/devops/whitelist-check.mjs` · 豁免集合清空为 `new Set()`（保留空锚点）+ 删 `EXEMPTION_REASON` 常量 · 规则 A/B 恢复全量强度
  5. ✅ 文档镜像同步：`docs/qa/costra-102-human-verify.md` 方式 A + `miniprogram/README.md` env 表 + `server/test/setup.ts` 注释（'3000' → '8080'）
- **阻断级别**：P1（不阻 COSTRA-115 · 但阻 COSTRA-102 真实联调 · Human 04-30 本地验证前建议 Backend-Agent 一张小卡修）
- **状态**：`closed` @ 2026-04-27
- **owner_card**：**COSTRA-116**
- **resolved_by**：COSTRA-116 R1 实装 · 5 文件改动 · `npm run check:whitelist` exit 0 零 warning · Human 04-30 本地验证链路联通前置条件达成

---

### FU-115-1 · whitelist-check.mjs 规则 B 对 dev env 的豁免待收紧

- **来源**：`scripts/devops/whitelist-check.mjs` L13-L23 + `.team/reviews/COSTRA-115/round-1-tech.md` P2-1
- **登记时间**：2026-04-27 10:54
- **范围**：豁免机制 `EXEMPTED_ENVS_FROM_RULES_AB = new Set(['dev'])`
- **建议**：等 FU-COMMON-DEV-URL-DRIFT 关闭后，从豁免集合中移除 `'dev'` · 规则 A/B 对所有 env 一视同仁 · 恢复完整三方对账强度
- **阻断级别**：P2（不阻 · 仅一条技术债自动清理项）
- **状态**：`closed` @ 2026-04-27
- **owner_card**：**COSTRA-116**
- **resolved_by**：COSTRA-116 一并落地 · `EXEMPTED_ENVS_FROM_RULES_AB` 清空为 `new Set()` · 保留空锚点供未来临时豁免扩展（附注释要求同轮新 FU 登记）· `EXEMPTION_REASON` 常量已删 · warning 路径仍在（空 Set 下自然不触发）

---

### FU-115-2 · ICP 下证后配 api.costra.cloud 至微信服务器域名白名单（Human 主动）

- **来源**：`infra/wechat/domains.md §4` Human 操作手册 + `.team/risks.md` R-013 关闭条件
- **登记时间**：2026-04-27 10:54
- **范围**：ICP 备案下证后，Human 按 `infra/wechat/domains.md §4` 三步执行：
  1. 阿里云 DNS 添加 A 记录 `api.costra.cloud → 49.235.216.20`
  2. 微信公众平台后台 → 开发管理 → 开发设置 → 服务器域名 → request 合法域名添加 `https://api.costra.cloud`
  3. 发 `close:R-013`
- **建议**：Orchestrator 在 `.team/STATE` 每周提醒 `R-013 mitigate` 状态 · ICP 下证日零延迟触发
- **阻断级别**：O-观察（非 Agent 可执 · Human 主动 · 外部依赖触发）
- **认领建议**：**Human · 外部触发**（估 2026-05 中下旬 ICP 下证日）
- **状态**：`open`

---

## 📌 COSTRA-116 R1 T2 Tech APPROVE 后状态流转（2026-04-27 15:25）

R1 Backend 交付 · T2 Tech 单轨 APPROVE 30/30 · 2 条 FU 关闭 · 新增 1 条 FU：

| FU-ID | 状态 | owner_card |
|---|---|---|
| FU-COMMON-DEV-URL-DRIFT | **`closed`** @ 2026-04-27 | COSTRA-116（已关闭） |
| FU-115-1 | **`closed`** @ 2026-04-27 | COSTRA-116（一并关闭） |
| FU-116-1 | `open` | Sprint-1 末 DevOps 小卡（P3 观察项） |

---

### FU-116-1 · 根目录 .env.example 的 APP_PORT/APP_BASE_URL 与 SSOT 潜在语义冲突（边界外漂移）

- **来源**：`.team/reviews/COSTRA-116/round-1-tech.md` INFO-1
- **登记时间**：2026-04-27 15:25（COSTRA-116 R1 T2 Tech APPROVE）
- **范围**：根目录 `.env.example` L8-11

  ```
  # ---- 应用 ----
  NODE_ENV=development
  APP_PORT=3000
  APP_BASE_URL=http://localhost:3000
  ```

- **问题判断**：
  - 变量名 `APP_PORT` / `APP_BASE_URL` **不是** `server/src/config/env.ts` 消费的 `PORT`
  - 该文件登记于 `86fa7f7 chore(devops): 初始化工程基建与 Sprint-0 CI 骨架`
  - 初判定：docker-compose / 根目录 orchestration 层模板 · 也可能只是历史遗留模板
  - 语义上仍引导用户往 3000 想 · 和 SSOT（8080）冲突 · 但**不会直接 break 任何跑得起来的东西**（因为没代码在消费它）
- **COSTRA-116 不处置理由**：Scope 铁律 · 文件不在 dispatch §2 范围 · 盲改可能 break 未可见的 shell 脚本 / CI job
- **建议 Action**（Sprint-1 末或下一张 DevOps 小卡）：
  1. `grep -r "APP_PORT\|APP_BASE_URL"` 找到所有消费方（若有）
  2. 若真无消费方 → 删除该两行（或整个"应用"段）
  3. 若有消费方 → 同步改为 `APP_PORT=8080` + `APP_BASE_URL=http://localhost:8080`
- **阻断级别**：**P3（观察项）** · 不阻任何卡 · 不会挂任何链路（比 FU-COMMON-DEV-URL-DRIFT 更低优先级）
- **认领建议**：Sprint-1 末 · DevOps-Agent / 0.5 点
- **状态**：`open`

---

## 📌 COSTRA-119 R1 T2 Tech APPROVE 后状态流转（2026-04-27 20:xx）

R1 MiniApp 交付 · T2 Tech 单轨 APPROVE · 新增 1 条 FU 并同轮关闭：

| FU-ID | 状态 | owner_card |
|---|---|---|
| FU-COMMON-APP-JSON-DRIFT | **`closed`** @ 2026-04-27 | COSTRA-119（已关闭） |

---

### FU-COMMON-APP-JSON-DRIFT · app.json 分包声明与文件系统不一致（Human 现场撞坑）

- **来源**：Human 2026-04-27 20:24 微信开发者工具模拟器启动失败 + COSTRA-119 dispatch §0 根因链
- **登记时间**：2026-04-27 20:28
- **范围（Sprint-0 至今潜伏约 6 天 · 两处文件系统缺失 + 一处文档断言漂移 + 一处 CI 盲区）**：
  - `miniprogram/app.json subpackages[0].pages[1] = overview/index` 但 `pages-stat/overview/` 目录不存在（L1 表面）
  - `miniprogram/app.json subpackages[1].pages[1] = dashboard/index` 但 `pages-family/dashboard/` 目录不存在（L1 表面）
  - `miniprogram/README.md §4.1` 表格将两页标为"✅ 占位（tabBar 入口）" · 与现实不符（L2 文档-代码断层）
  - COSTRA-030 骨架期产出回链未列该两页但 tabBar 已指向（L3 骨架卡 DoD 不完备 · 本卡不回溯）
  - `scripts/devops/whitelist-check.mjs` 只查域名方向 · 无 app.json↔文件系统对账（L4 CI 盲区）
- **问题**：Agent 无真微信开发者工具（COSTRA-114 v2 能力边界铁律）· 该错误只能在 Human 第一次真跑时暴露 · 恰好撞上 COSTRA-102 04-30 本地验证 · Human 04-27 20:24 即撞坑（比预期早 3 天）
- **COSTRA-119 正式修复**（2026-04-27）：
  1. ✅ 新建 `miniprogram/pages-stat/overview/{index.wxml,wxss,ts,json}` 占位四件套（tabBar 入口）
  2. ✅ 新建 `miniprogram/pages-family/dashboard/{index.wxml,wxss,ts,json}` 占位四件套（tabBar 入口）
  3. ✅ 新增 `scripts/devops/appjson-pages-check.mjs`（零依赖 · ~160 行 · 参考 whitelist-check.mjs 风格）· 契约 exit 0/1/2
  4. ✅ `package.json` 新增 `check:appjson` script · 紧随 `check:whitelist` 成对账族
  5. ✅ `.github/workflows/pr-check.yml` 新增 `AppJson Pages Consistency Check` step · 带 `if: success() || failure()`（吸取 FU-115-WHITELIST-STEP-ALWAYS 教训直接到位）
  6. ✅ `miniprogram/README.md §4.1` 两行表格文案从"✅ 占位（tabBar 入口）"改为"✅ 占位四件套已补齐（COSTRA-119）· 业务逻辑 Sprint-3 落地" · 同轮顺手把两行的"关联卡"从幻觉 `COSTRA-501` 修正为 backlog.json 真实存在的 `COSTRA-401`（Epic-F 月度饼图/趋势折线）
- **阻断级别**：P0（阻 Human 当场打开项目 · 比 FU-COMMON-DEV-URL-DRIFT 更硬 · 零秒撞坑）
- **状态**：`closed` @ 2026-04-27（**L1 文件侧** · L3 tabBar 规约侧由 COSTRA-120 补完 · 见本文件下方 FU-COMMON-APP-JSON-DRIFT-TABBAR）
- **owner_card**：**COSTRA-119**
- **resolved_by**：COSTRA-119 R1 实装 · 11 新文件 + 4 改 · `npm run check:appjson` exit 0 首跑零告警 · **注**：119 只解决了文件存在性问题 · 但未识别到 tabBar 指向分包违反微信规约 · 2026-04-28 13:53 Human 重开微信开发者工具再次启动失败 · 由 **COSTRA-120 衍生 FU-COMMON-APP-JSON-DRIFT-TABBAR 专项** 补完完整闭环（tabBar 入口上提主包 + CI Rule-4 规约级校验）
- **与白名单对账脚本族的同构价值**：CI 对账范式本卡第二个实例（第一例 COSTRA-115 whitelist-check） · 双脚本共担"Agent 无真环境访问权的能力边界盲区" · 未来再有类似单源真相被误用场景 · 复用同模板

---

## 📌 COSTRA-120 R1 T2 Tech APPROVE 后状态流转（2026-04-28 14:xx）

R1 MiniApp 交付 · T2 Tech 单轨 APPROVE · 新增 1 条 FU 并同轮关闭 · 修订 1 条既有 FU：

| FU-ID | 状态 | owner_card |
|---|---|---|
| FU-COMMON-APP-JSON-DRIFT | `closed`（修订备注） | COSTRA-119 + COSTRA-120 协同闭环 |
| FU-COMMON-APP-JSON-DRIFT-TABBAR | **`closed`** @ 2026-04-28 | COSTRA-120（同轮登记 + 同轮关闭） |

---

### FU-COMMON-APP-JSON-DRIFT-TABBAR · tabBar.list 指向分包违反微信规约（COSTRA-119 P0 逃逸）

- **来源**：Human 2026-04-28 13:53 按 COSTRA-119 收官汇报重开微信开发者工具 · 模拟器二次启动失败 · 错误文本 `["tabBar"][N]["pagePath"]: "xxx" need in ["pages"]`
- **登记时间**：2026-04-28 14:00（COSTRA-120 dispatch 派单）
- **范围（COSTRA-119 未识别的第 L3 根因层）**：
  - `miniprogram/app.json tabBar.list[1].pagePath = "pages-family/dashboard/index"` 指向分包（违反微信规约）
  - `miniprogram/app.json tabBar.list[2].pagePath = "pages-stat/overview/index"` 指向分包（违反微信规约）
  - 微信规约：tabBar 页属"启动首帧必加载" · 必须在主包 `pages[]` · 禁止在 `subpackages[].pages[]`（分包是"按需延迟下载" · 两者语义冲突）
- **问题（COSTRA-119 逃逸根因 · 治理反思）**：
  - **根因识别偏差**：119 时 Orchestrator 直接把错误"未找到 overview/index.wxml"解读为"文件不存在 → 补文件" · 未做专业的文本精读 + 微信规约查证 · 派单方向偏差（方案 B 只解表面症状）
  - **T2 档位结构性局限**：Review-Agent-Tech 纸面审 + 命令行五闸 · 不跑微信开发者工具 · 所以"runtime 才爆"的规约违反类问题结构性漏检 · 119 T2 APPROVE 33/35 未能抓到
  - **CI 脚本单向性陷阱**：119 新增的 `appjson-pages-check.mjs` 只查"声明→文件"单向 · 未查"tabBar→主包 pages 规约" · 以 Human 当下症状正向补而非以"微信 builder 错误字典"反向设计 · 漏掉了 `need in ['pages']` 这条同样高频的规约错误
- **COSTRA-120 正式修复**（2026-04-28）：
  1. ✅ 迁移 `miniprogram/pages-family/dashboard/` → `miniprogram/pages/family-dashboard/`（四件套原样保留 · ts 注释增补位置变更说明 + COSTRA-120 Refs）
  2. ✅ 迁移 `miniprogram/pages-stat/overview/` → `miniprogram/pages/stat-overview/`（同上）
  3. ✅ 删除 `miniprogram/pages-family/dashboard/` + `miniprogram/pages-stat/overview/` 空目录（Human Q3 彻底删除裁决）
  4. ✅ `miniprogram/app.json` 三处同步：`pages[]` +2 主包路径 · `subpackages[*].pages[]` -2 原分包条目 · `tabBar.list[1/2].pagePath` 改指主包新路径
  5. ✅ `scripts/devops/appjson-pages-check.mjs` 扩展 · 新增 **Rule-4 tabBar 主包规约校验**（~35 行增 · 零依赖）· 错误消息含微信规约文案"tabBar 页必须在主包 pages[] · 禁止在 subpackages[].pages[]（启动首帧冲突）"
  6. ✅ `miniprogram/README.md` §1 描述 / §3 目录树 / §4.1 表格 4 行 + 裁决段同步
  7. ✅ 新增 `.team/decisions/D-017-verification-problem-response-sop.md` 规约（Human 2026-04-28 13:59 立案 · 验证问题拉责任 Agent 做根因分析 + 提方案流程）
  8. ✅ `.team/reviews/COSTRA-119/round-1-tech.md` 文末追加"逃逸修正说明"段（Human Q5 裁决）
- **阻断级别**：P0（阻 Human 重复打开项目 · 与 FU-COMMON-APP-JSON-DRIFT 同级）
- **状态**：`closed` @ 2026-04-28
- **owner_card**：**COSTRA-120**
- **resolved_by**：COSTRA-120 R1 实装 · 8 新文件（4+4 迁移）+ 1 新规约 + 5 改 - 8 删除 · `npm run check:appjson` 正向 exit 0（`tabBar main-package rule: 4/4 pass`）+ 反向验证 exit 1（篡改 tabBar 指向分包）+ revert 后再 exit 0 · 三段证据闭环 · Human 重开微信开发者工具可立即启动模拟器
- **治理价值（超越当卡）**：
  - **D-017 立案首次实战**：Human 反馈验证问题 → Orchestrator 拉 MiniApp-Agent 做根因分析 + 多方案对比 → Human 裁决 → 派单 · 5 步 SOP 正式沉淀
  - **CI 脚本族从"表象检查"升级到"规约检查"**：Rule-1/2/3 查文件存在性 · Rule-4 查微信规约合规 · 未来可继续扩展（如 entryPagePath 必须主包 · preloadRule 必须指向分包等）
  - **T2 档位已知局限显性化**：COSTRA-119 逃逸暴露了 T2 不跑 runtime 的结构性漏洞 · Sprint-1 末 Retro 建议讨论是否给 Tech Review 增加"模拟器冒烟"能力或该类问题升 T3
- **同族规约盲区追溯**：本条为"Sprint-0 骨架期遗留微信规约债务"同族第 **2 次**暴露（第 1 次 = FU-COMMON-APP-JSON-DRIFT 文件侧 · 第 2 次 = 本条 tabBar 规约侧 · 第 3 次 = **FU-COMMON-PROJECT-CONFIG-DRIFT 工具链单源 @ COSTRA-121** · 见本文件下方）

---

## 📌 COSTRA-121 R1 T2 Tech APPROVE 后状态流转（2026-04-28 17:xx）

R1 MiniApp 交付 · T2 Tech 单轨 APPROVE · 新增 1 条 FU 并同轮关闭 · 修订前两条 FU 追加同族备注：

| FU-ID | 状态 | owner_card |
|---|---|---|
| FU-COMMON-APP-JSON-DRIFT | `closed`（同族备注修订 · 三连第 1 次） | COSTRA-119 |
| FU-COMMON-APP-JSON-DRIFT-TABBAR | `closed`（同族备注修订 · 三连第 2 次） | COSTRA-120 |
| FU-COMMON-PROJECT-CONFIG-DRIFT | **`closed`** @ 2026-04-29 10:48（121 物理修复 + 122 runtime 层两卡累加 · 完整闭环） | COSTRA-121（物理）+ COSTRA-122（runtime 补位 · 已收官）|
| FU-TOKENS-JSON-RUNTIME-IMPORT | **`closed`** @ 2026-04-29 10:48（同族规约盲区第 4 次 · Human 第五次模拟器启动验证通过 · 登录页正常渲染） | COSTRA-122（R1 APPROVE 35/35 · Human T2 APPROVED） |
| 🆕 FU-LAUNCH-FIRST-RENDER-RACE | **`open`** @ 2026-04-29 10:48（首渲染时序警告 `Expected updated data but get first rendering data` · 微信基础库 2.32.3 启动期 · 非 122 引入 · UI 正常无功能影响） | Sprint-1 · P2 观察项（等 Human 决策是否立独立卡）|

---

### FU-COMMON-PROJECT-CONFIG-DRIFT · 微信工具链配置单源漂移（COSTRA-119/120 同族规约盲区第 3 次）

- **来源**：Human 2026-04-28 15:58 按 COSTRA-120 收官汇报重开微信开发者工具 · 模拟器**第三次启动**推进到 app.ts 执行期但报 `module 'tokens/tokens.json.js' is not defined · require args is './tokens.json' · at app.ts:6` · 根因两层：
  - **第 1 层 · 根 `project.config.json` 工作区缺失**（HEAD 仍有 · git status 显 `deleted:` · 可 `git restore` 恢复）
  - **第 2 层 · `miniprogram/project.config.json` GUI 自建副本**（从未被 git 追踪 · 微信工具打开 miniprogram/ 子目录时自动生成 · `useCompilerPlugins: false` · 未启用 TS 编译插件 → TS JSON import 无法转译）
- **登记时间**：2026-04-28 17:xx（COSTRA-121 dispatch R1 同轮）
- **范围**：
  - `project.config.json`（根 · SSOT · `miniprogramRoot: "miniprogram/"` + `useCompilerPlugins: ["typescript"]`）· 工作区缺失 → 工具无法打开项目
  - `miniprogram/project.config.json`（GUI 自建副本 · 与根 config 漂移 · 违反 D-011 SSOT 规约）
  - Human 习惯："打开 `miniprogram/` 子目录作为项目根"是反范式 · 正确姿势 = 打开 `Costra/` 项目根（Human 2026-04-28 16:52 确认：**"根目录 json 缺失时微信工具无法打开工程，miniprogram 目录下的 json 似乎可以不需要存在"**）
- **问题（治理反思 · 三次核查才定稿）**：
  - **Orchestrator 事实源核查链二次逆转**：第 1 次核查误判为"源码 require JSON 需改造" · 第 2 次核查误判为"双 config 漂移 · 子覆盖根" · 第 3 次 `git ls-files` + `git log` 才定稿"根 config 工作区缺失 + 子 config GUI 噪声"双破坏 · 印证 D-017 第 2 步"事实源三证齐全"的价值 + 对 `git ls-files/log/show HEAD:` 事实源工具链的依赖
  - **先前"工具噪声暂留"建议的误判**：COSTRA-119 收官时 Orchestrator 建议"miniprogram/project.config.json 作为工具噪声暂留 · 等 Human 后续决策" · 120 继承该建议又暂留一轮 · 本卡 121 纠偏 · 并已在 119 Review §13 v1.2 补遗中致歉
  - **T2 档位结构性局限第 3 次兑现**：五闸全部走"编译期 + 文件系统"视角 · 无人以"微信工具 runtime 视角"对账工具链配置 · 与 119/120 同族 · Sprint-1 末 Retro 议题第 10 条
- **COSTRA-121 正式修复**（2026-04-28）：
  1. ✅ 恢复根 `project.config.json`（`git restore` · HEAD 里完整 58 行 · 含 `miniprogramRoot` + `useCompilerPlugins: ["typescript"]`）
  2. ✅ 删除 `miniprogram/project.config.json`（untracked · `rm`）
  3. ✅ `.gitignore` 追加 `miniprogram/project.config.json` 精确路径规则 + 说明注释 · 兜底防再生后误入 git
  4. ✅ 新建 `scripts/devops/miniapp-tooling-check.mjs`（零依赖 · ~140 行 · 参照 appjson-pages-check 范式）· **三子规约硬拦截**：Rule-5a 根 config 存在 · Rule-5b useCompilerPlugins 含 typescript · Rule-5c 子 config 禁出现
  5. ✅ `package.json` scripts 段新增 `check:tooling` · 紧随 `check:appjson` 成对账族第 3 脚本
  6. ✅ `README.md` 新增"本地开发 · 微信开发者工具"段 · 明确"必须打开 `Costra/` 项目根" + TS JSON import 运行期依赖解释 + GUI 副本清理指引
  7. ✅ `.team/reviews/COSTRA-119/round-1-tech.md` §13 v1.1→v1.2 追加"COSTRA-121 同族第 3 次"补遗（Orchestrator 核查链二次逆转致歉 + 同族规约盲区三连总结）
  8. ✅ 本 FU 同轮登记 + 同轮关闭 + 修订前两条 FU 追加同族备注
- **阻断级别**：P0（阻 Human 本地验证 · 与前两条 FU 同级）
- **状态**：`closed` @ 2026-04-28
- **owner_card**：**COSTRA-121**
- **resolved_by**：COSTRA-121 R1 实装 · 1 新脚本 + 5 文件改 + 1 文件恢复 + 1 文件删 · `npm run check:tooling` 正向 exit 0（3/3 rules pass）+ **三向反向验证**（Rule-5a/5b/5c 分别临时篡改 → exit 1 带规约文案 → revert → exit 0）· 五+回归闸全绿 · Human 以打开 `Costra/` 项目根方式重开微信工具可立即启动模拟器（第四次验证）
- **治理价值（超越当卡）**：
  - **D-011 SSOT 规约工具链层首次实战**：D1~D6 五位一体兜底（恢复 + 删除 + gitignore + CI + 操作指引 + 规约沉淀）· 从代码机制 + 操作姿势双层永久消除漂移
  - **CI 对账族从文件/规约层扩到工具链层**：Rule-1~3 文件存在性（119）→ Rule-4 微信规约（120）→ **Rule-5a/5b/5c 工具链单源（121）** · 三代积累
  - **D-017 规约事实源工具链扩展**：核查链二次逆转教训 → 事实源工具必须包含 `git ls-files` / `git log` / `git show HEAD:` 三工具组合 · 仅 `ls` + `cat` 不够 · 议入 Sprint-1 末 D-017 v1→v2 升级
  - **能力边界铁律第 3 次兑现**：Agent 无真微信开发者工具 · CI + README 双层兜底替代
- **同族规约盲区追溯**：本条为"Sprint-0 骨架期遗留微信规约债务"同族第 **3 次**暴露（第 1 次 = FU-COMMON-APP-JSON-DRIFT · 第 2 次 = FU-COMMON-APP-JSON-DRIFT-TABBAR · 第 3 次 = 本条）· Sprint-1 末 Retro 议题：是否一次性系统化盘点微信规约债务（当前是被动剥洋葱式遭遇）

### 📌 收官后复盘 · 核心假设证伪（2026-04-28 19:57 · COSTRA-122 第四次模拟器启动实测后）

- **假设证伪**：COSTRA-121 dispatch `§事件时序还原⑦` 的核心假设**"`useCompilerPlugins: ["typescript"]` 启用后 TS JSON import 会被微信 runtime 正确转译"**被实测证伪
- **证伪证据**：Human 2026-04-28 19:5x 以"打开 `Costra/` 项目根"正确姿势第四次重开微信开发者工具 · 五证齐全（HEAD = `c9826c4` 收官 commit · 根 config 完整 · `useCompilerPlugins: ["typescript"]` 启用 · 子副本不存在 · `check:tooling` 3/3 pass）但**报同一错误** `module 'tokens/tokens.json.js' is not defined at index.ts:5 at app.ts:6`
- **真根因定稿**：`useCompilerPlugins: ["typescript"]` 只负责 `.ts → .js` 转译 · **不改变 JSON 模块 runtime 解析语义**。微信小程序 runtime CommonJS `require` loader **不识别 `.json` 扩展名作为可加载模块**——这是 **runtime 契约层盲区**，与工具链配置无关
- **COSTRA-121 物理修复的实际价值**：D1 根 config 恢复 + D2 子副本删除 + D3 `.gitignore` 兜底 + D4 CI Rule-5a/5b/5c + D5 `package.json` + D6 README § 本地开发 + D7 FU + D8 119 §13.6 v1.2 → **全部必要且正确**（工具链 SSOT 本就该这样修 · 满足微信官方范式 · 消除潜在双 config 漂移 · Sprint-1 末 Retro D-011 工具链层范式仍成立）· 但**不足以解决 runtime 层** · 由 **COSTRA-122 补位**（1 点极小卡 · 单文件 `tokens/index.ts` 改写为内联 TS 常量）
- **Orchestrator 事实源核查链第四次逆转教训**（D-017 v2 升级强证据）：
  - 第 1 次（COSTRA-118 P0-9 · 2026-04-27 09:37）：tokens.json→wxss 桥接未闭合 → 聚焦 wxss 快修 · **漏查 runtime 可加载性**
  - 第 2 次（121 事前 · 2026-04-28 16:00）：误判 app.ts:6 源码 require JSON 需改造
  - 第 3 次（121 事前 · 16:30）：误判双 config 漂移 · 子覆盖根
  - 第 4 次（121 dispatch §7 定稿 · 16:55）：假设"插件启用后 runtime 能转译" · **第四次模拟器启动实测证伪**（19:5x）
  - → **D-017 v2 必加项**：**"runtime 实测必须作为 runtime 规约类 T2 卡的终审证据"** · 纯文档推理 + 命令行五闸不够 · 微信工具是最终裁决者
- **Sprint-1 末 Retro 新增议题 ⑪⑫**：① Review 35/35 也可能基于错误假设（121 无评审瑕疵但核心因果链错误） · 需"**Human 实测闸**"作为 runtime 规约类 T2 卡的终审绝对证据 · ② 同族规约盲区**第 4 次暴露**紧迫性远超之前评估 · Sprint-0 骨架期微信规约债务系统化盘点必须列入 Sprint-1 末 Retro 最高议题

---

### FU-TOKENS-JSON-RUNTIME-IMPORT · tokens/index.ts JSON import runtime 兼容性（COSTRA-121 假设证伪的 runtime 层补位 · 同族规约盲区第 4 次）

- **来源**：Human 2026-04-28 19:5x 按 COSTRA-121 收官（19:26）后约 30 分钟以"打开 `Costra/` 项目根"正确姿势第四次重开微信开发者工具 · 模拟器启动推进到 app.ts:6 但**报同一错误** `module 'tokens/tokens.json.js' is not defined at index.ts:5` → 121 核心假设被实测证伪 · 真根因定稿：**微信 runtime CommonJS loader 不识别 `.json` 扩展名加载**（runtime 契约层盲区 · 与工具链配置无关）
- **登记时间**：2026-04-28 19:57（COSTRA-122 dispatch 同轮）
- **范围**：
  - `miniprogram/tokens/index.ts:5` `import tokensJson from './tokens.json'`（标准 TS JSON import · 编译期 `resolveJsonModule: true` 绿 · runtime 被微信 CommonJS loader 转成 `require('./tokens.json')` → 自动补 `.js` → `tokens/tokens.json.js` not defined）
  - `miniprogram/tokens/tokens.json`（设计 SSOT 来源 · 不受本 FU 影响 · 保留）
  - `app.ts:6` `import { tokens } from './tokens/index'` 为启动链首行消费方 · 受 index.ts 影响但本 FU 不改
- **问题（治理反思 · 三个维度）**：
  - **假设证伪链**：COSTRA-118 预警 → 121 假设 runtime 能转译 → 第四次实测证伪 · D-017 v2 升级强证据就位
  - **T2 档位结构性局限第 4 次兑现**：五闸 + CI 规约族（whitelist + appjson + tooling）全绿仍然漏 · 无人以"微信工具 runtime loader 视角"对账源码层 JSON import 写法 · 与 119/120/121 同族第 4 次
  - **CI 规约族当前无法覆盖**：check:appjson 只查 app.json · check:tooling 只查工具链配置 · **源码层 JSON import 尚无硬拦截**（本 FU 不扩展 CI · 由后续卡立案同族第 5 次 · 避免 scope 扩散）
- **COSTRA-122 正式修复计划**（2026-04-28 19:57 派单 · 等 Human 选路径 A/B）：
  1. 🟡 D1 · `tokens/index.ts` 把 `import tokensJson from './tokens.json'` 改写为内联 TS 常量 `const tokensData = { ... } as const; export const tokens = tokensData;` · 导出签名完全不变
  2. 🟡 D2 · `tokens.json` 保留不动（Sprint-2 FU-118-3 构建脚本根治 · 手工 1:1 对齐作为过渡）
  3. 🟡 D3 · 顶部注释硬约束：`// ⚠️ 不要改为 "import x from './tokens.json'"——微信 runtime 不支持 .json loader（COSTRA-122 实证）`
  4. 🟡 五闸 + 静态对账（`grep -r "from '.*\.json'" miniprogram/` 应为空 + tokens.json vs 内联字段 1:1）+ 反向验证 3 次
  5. 🟡 Human 第五次模拟器启动验证 · app.ts:6 不再报错 · 启动链推进到 `wx.reLaunch({ url: '/pages/login/index' })`
- **阻断级别**：P0（阻 Human 本地验证 · 与 119/120/121 同级 · 启动链运行期首行）
- **状态**：**`closed`** @ 2026-04-29 10:48（Human 第五次模拟器启动验证通过 · 登录页完整渲染 · app.ts:6 `module 'tokens/tokens.json.js' is not defined` 彻底消失）
- **owner_card**：**COSTRA-122**
- **resolved_by**：COSTRA-122 R1 实装 · 单文件 `miniprogram/tokens/index.ts` · +50/-2 · 六闸 + 静态对账 + 字段 1:1 严格对齐全绿 · R1 Tech APPROVE 35/35 · Human T2 APPROVED @ 2026-04-29 10:41 · 第五次模拟器启动贯通至 `wx.reLaunch('/pages/login/index')` · Console 无 122 相关报错（残留为微信基础库 2.32.3 启动期内部 Bug + 首渲染时序警告 · 与 122 无因果关系 · 已分流到 FU-LAUNCH-FIRST-RENDER-RACE）
- **治理价值（Sprint-1 末 Retro 最高议题候选）**：
  - **D-017 v2 升级的最强证据**："runtime 实测作为 runtime 规约类 T2 卡的终审证据"议题从"推导中"升级为"必选项"· 121 的纯推理收官判断证伪就是活教训
  - **同族规约盲区系统化盘点的紧迫性**：119 + 120 + 121 + 122 已连续四张紧急卡 · Sprint-0 骨架期遗留微信规约债务被动剥洋葱式遭遇 · 必须在 Sprint-1 末启动主动盘点（Epic F 或独立专项）
  - **Review 机制增强议题**：Review-Tech 显式增加"运行期契约对账"表（覆盖 JSON import / CSS var / API 扩展名 / module resolution 等 runtime-only 检查项） · 与 CI 规约族互补
  - **COSTRA-011 / COSTRA-030 的倒查议题**：tokens/index.ts 在 COSTRA-030 R1 Review 时未被标注"runtime 可加载性待验证" · 骨架期 Review 档位对"代码是否能 runtime 运行"的覆盖度不足
- **同族规约盲区追溯**：本条为"Sprint-0 骨架期遗留微信规约债务"同族第 **4 次**暴露（第 1 次 = FU-COMMON-APP-JSON-DRIFT · 第 2 次 = FU-COMMON-APP-JSON-DRIFT-TABBAR · 第 3 次 = FU-COMMON-PROJECT-CONFIG-DRIFT · **第 4 次 = 本条**）· **Sprint-1 末 Retro 议题最高优先级**：系统化盘点必须做（当前被动剥洋葱式已到第 4 层 · 本次收官后虽第 5 次未实测暴露，但 Human 第五次模拟器启动 Console 显示 1 条类 B 警告 `Expected updated data but get first rendering data` 已单立 FU-LAUNCH-FIRST-RENDER-RACE 追踪 · **当前无法确定是否 Sprint-0 还有其他层**）

---

## 📌 COSTRA-122 R1 T2 Tech APPROVE + Human T2 APPROVED 后状态流转（2026-04-29 10:41）

R1 MiniApp 交付 · T2 Tech 单轨 APPROVE 35/35 · Human 第五次模拟器启动实测验证通过 · 同轮关闭 2 条 FU · 新立 1 条 FU：

| FU-ID | 状态 | owner_card |
|---|---|---|
| FU-COMMON-PROJECT-CONFIG-DRIFT | **`closed`** @ 2026-04-29（两卡累加完整闭环 · 121 物理 + 122 runtime） | COSTRA-121 + COSTRA-122 |
| FU-TOKENS-JSON-RUNTIME-IMPORT | **`closed`** @ 2026-04-29 | COSTRA-122（已关闭） |
| FU-LAUNCH-FIRST-RENDER-RACE | **`open`** @ 2026-04-29（新立 · P2 观察 · 非 122 引入） | Sprint-1 候选 |

---

### FU-LAUNCH-FIRST-RENDER-RACE · 启动期首渲染时序警告（非 122 引入 · 观察项）

- **来源**：Human 2026-04-29 10:41 第五次模拟器启动 Console 输出
- **登记时间**：2026-04-29 10:48（COSTRA-122 收官同轮登记）
- **范围**：
  - Console 警告 `[渲染层错误] Expected updated data but get first rendering data`
  - `[渲染层错误] SystemError (webviewScriptError) Expected updated data but get first rendering data`
  - 出现时点：`No. of subpackages: 2` / `LazyCodeLoading: true` 之后 · `onLaunch` 之前
  - 微信基础库：2.32.3 · 开发者工具：2.01.2510290 · macOS
- **判定**：
  - **非 COSTRA-122 引入**（122 改的是 tokens 常量加载路径 · 不影响 setData 时序）
  - **非业务代码致命**（UI 完整渲染 · onLaunch 正常 · `wx.reLaunch` 到登录页 · Launch Time 3547 ms 正常）
  - **可能触发源（4 候选）**：
    1. 登录页 `pages/login/index.ts` 在 `onLoad` / `attached` 前同步 `setData`
    2. 分包懒加载（`LazyCodeLoading: true`）导致启动期 data 投递竞态
    3. `globalData` 初始化时机（含 `tokens` / `env` 即时计算）
    4. 自动热重载在页面未就绪时重投 data
  - 另有一组 `[jsbridge] invoke getGlobalStorage/setGlobalStorage/removeGlobalStorage/traceEvent fail: too eayly` 报错 · 调用栈全在 `http://127.0.0.1:28677/__pageframe__/__dev__/WAWebview.js` · 微信 SDK 内部 · 拼写 `eayly`（官方拼错 early）为 SDK 内置字符串 · 我方 `services/storage.ts` 仅用 `wx.getStorageSync/setStorageSync`（同步 API）从未调用 `getGlobalStorage` 等 · **定性为微信开发者工具 2.01.2510290 + 基础库 2.32.3 启动时序内部 Bug**（非业务）· 合并到本 FU 追踪（同属"启动期内部时序"族）
- **阻断级别**：P2（观察项 · 不阻任何链路 · UI 正常 · 功能正常）
- **认领建议**：Sprint-1 候选小卡（若 `setData` 可定位到具体页面触发点则立延伸卡 · 若确认全在微信 SDK 内部则不修仅文档化）
- **状态**：`open`
- **owner_card**：待 Sprint-1 末 Planning 决策
- **🆕 第 2 次观察**（2026-05-01 21:18 · COSTRA-123 Human 第 6 次模拟器启动）：
  - 现象重现：`[渲染层错误] invoke getGlobalStorage fail: too eayly` + `setGlobalStorage fail` + `removeGlobalStorage fail` 各 1 次 · 含 `SystemError (webviewSDKScriptError) Failed get/delete storage group metadata/data` 包装
  - 时序锚点：`[system] WeChatLib: 2.32.3` → `No. of subpackages: 2` → `LazyCodeLoading: true` → `app.ts:23 [Costra] onLaunch env= dev` → **本 3 条报错** → `[system] Launch Time: 865 ms`
  - 定性保持："微信开发者工具 2.01.2510290 + 基础库 2.32.3 启动时序内部 Bug" · Launch Time 从 122 收官的 3547 ms 降至 865 ms（COSTRA-123 npm 桥接生效 · 无 JSON loader fallback 延迟）· 功能侧完全贯通至 `auth.ts:157 [auth] wx.login ok {codeLen: 32}`
  - **二级事实登记**（MiniApp-Agent D-017 Step 2 新发现 · 未坐实因果）：`miniprogram/services/storage.ts:29` 存在模块顶层副作用 `ensureVersion()` · 调用链 `app.ts:4 import './services/auth'` → `services/auth.ts:7 import './storage'` → top-level 同步执行 `wx.getStorageSync(VERSION_KEY) / 可能 wx.clearStorageSync / wx.setStorageSync` · 发生在 `App()` 注册之前 · 与 `too eayly` 时序**吻合但未坐实因果**（业务侧同步 API vs SDK 侧渲染层 `createOrGetStorageGroup/_prepare` · 两者可能只是并发发生 · grep 业务代码 `getGlobalStorage/setGlobalStorage/removeGlobalStorage` 零命中）
  - **再次确认不阻任何链路**：登录按钮可点 · `wx.login` 成功 · Launch Time 865 ms · 后续业务 storage 读写正常
- **🆕 第 3 次观察**（2026-05-02 19:32 · D-018 SBAI v1.0 P2 冒烟首战）：
  - 现象：**仅 1 条** `[渲染层错误] [jsbridge] invoke getGlobalStorage fail: too eayly. Error: invoke too eayly`（不同于前 2 次的 3 条齐现 get/set/remove · 本次只 get 单条）
  - 端口号变化：第 1 次 `28677` → 第 2 次 `28677` → 第 3 次 **`17559`**（微信开发者工具每次启动随机本地端口 · 与 bug 无关）
  - 拼写 `eayly` 保持（SDK 内置字符串 · 官方拼错 early）
  - 调用栈：`WAWebview.js:1:123691` → `invoke` → `v` → `M` → `N` → `Qt` → `Tt._prepare` → `createOrGetStorageGroup` · 全在微信 SDK 内部 · 与前 2 次栈结构一致
  - **独立复核证据**（装扮 subagent · SBAI v1.0 P2 冒烟 @ 2026-05-02 19:34）：
    - `miniprogram/` 全量 grep 以下关键字 **全部 0 命中**：`getGlobalStorage` / `setGlobalStorage` / `removeGlobalStorage` / `createOrGetStorageGroup` / `traceEvent` / `storageGroup`
    - 我方唯一 storage 调用是**同步 API**（`wx.getStorageSync` / `wx.setStorageSync` / `wx.removeStorageSync` / `wx.clearStorageSync`）· 7 处命中 · 全在 `miniprogram/services/storage.ts`
    - 官方同步 API 路径**不走** `createOrGetStorageGroup` / `_prepare`（只有异步 Global Storage API 才走 storage group metadata / prepare）· 因果链**物理阻断**
  - **定性加固**：从"吻合但未坐实"（第 2 次）升级为**"100% 非业务 · 微信 SDK 内部启动时序 Bug 确认"**——我方代码在任何路径上都未触达异步 Global Storage API 栈
  - **不阻任何链路**（本次场景）：本次仅模拟器启动现象上报 · 无业务操作中断
  - **治理价值**：SBAI v1.0 P2 冒烟独立复核首次实战 · 验证了"装扮 subagent 独立核查历史定性"的有效性——FU 原定性（2026-04-29 登记）**完全正确** · 经过 2 次复现 + 1 次独立复核 · 可 Sprint-1 末 Retro 议题中降级为"**闭合观察** · 不立卡修 · 文档化存档"（理由：三次观察全部证明是微信 SDK 内部 Bug · 无业务触发点 · 我方无可修改点 · 升级基础库版本是唯一路径但需 Human 决策时机）
- **同族观察次数**：首次 2026-04-29 10:41（COSTRA-122 收官）· **第 2 次 2026-05-01 21:18（COSTRA-123 收官）** · **第 3 次 2026-05-02 19:32（D-018 SBAI v1.0 P2 冒烟首战 · 独立核查确认非业务）** · **第 4 次 2026-05-02 20:15-20:25（Human 新线索 + 装扮 subagent D-017 Step 2 根因重做 · 定性翻转 v2）** · **第 5 次 2026-05-02 21:xx（COSTRA-124 R1 修复完成 + Review 33/35）** · **第 6 次 2026-05-03 12:41（HANDOFF.md 立案）** · **第 7 次 2026-05-03 20:09（Human 第 7 次模拟器实测 · R1 假设证伪 · 定性翻转 v3 · 详见 f.3）**

---

#### 🆕 f.3 · 第 7 次观察（R1 假设证伪 · 定性翻转 v3）+ FU 分裂为 A/B/C 三子 FU · COSTRA-125 接力卡

**追写时间**：2026-05-03 20:32（by Orchestrator · Human 2026-05-03 20:32 D1/D2/D3 全按推荐后同轮）

**追写依据**：COSTRA-124 R2 诊断（`.team/members/miniapp-dev/history/2026-05-03-costra-124-r2-diagnose.md`）+ 本 FU 文档纪律"Human 实测未通过前 FU 不真 closed"（f.1.B 预闭合变成实测失败 · 按承诺不做假 close）

##### f.3.A · 第 7 次观察（2026-05-03 20:09 · Human 模拟器实测 · R1 失败）

- **触发**：Human 2026-05-03 20:09 按 HANDOFF.md §1.3 指引做第 7 次冷启动（已清缓存 + 重新编译 · R1 `a296be0` + `221b074` 在 HEAD `42494f1` 前已落）
- **Console 实证**（完整保留）：
  - `app.ts:31 [Costra] onLaunch env= dev` 打印在前（R1 已生效 · onLaunch 进入）
  - **随后爆出 7+ 次 × 4 种 API**：`getGlobalStorage fail: too eayly` ×2 + `setGlobalStorage fail: too eayly` ×1 + `removeGlobalStorage fail: too eayly` ×1 + `SystemError` 包装 ×3
  - 错误栈均含 `Tt._prepare` / `Tt._setMetadata` / `Tt.get` / `Tt.delete` / `createOrGetStorageGroup`
  - 错误归属 **`[渲染层错误]`**（不是 AppService 逻辑层）
  - **Launch Time: 1864 ms**（基线 865 · ×2.16 重度劣化 · 与错误反复抛出吻合）
- **Human 关键补充**："wx.login 没跑到是因为还没点登录 · 这个问题只要一打开小程序就会出现 · 点登录后 wx.login 正常"
- **意义**：证明错误与用户交互无关 · 纯 App 生命周期早期问题 · **R1 方案 A 的核心假设"onLaunch 够晚"被实测证伪**

##### f.3.B · R2 根因重做（装扮 subagent D-017 Step 5 派单 · SBAI v1.1 P2' 冒烟第 3 回）

- **Spawn**：2026-05-03 20:12（by Orchestrator · 传 16 文件强制阅读清单 + 实测证据 + 硬约束"只诊断不改"）
- **事实源三证**：`git ls-files` 60 文件 / `git log` 确认 `a296be0` R1 已落 / `git show HEAD` 确认 app.ts:28 + storage.ts 架构正确
- **L3 调用点普查发现**（关键新证据）：
  - 冷启动期同步 storage 调用 **仅 2 处 · 共 4 次**（数学对账闭合）
  - ① `app.ts:28 ensureVersion()` → storage.ts:31/33/34（get/clear/set）
  - ② **`app.ts:35 initAuth()` → auth.ts:70 `getItem(TOKEN_KEY)`** ← **R1 漏网点**（`async function` 体内 await 之前同步执行）
- **L2 WebFetch 证据**（3 次微信官方文档取证）：
  - 官方承诺"onLaunch 内 wx.getStorageSync 可用" · 但实测打脸 · 说明 2.32.3+ 实现细节与文档脱节
  - 错误归属 `[渲染层错误]` · 证明 SDK 把 storage 委托给渲染层 storage group · 而 `_prepare` 就绪**晚于** AppService 的 onLaunch
- **定性升级 v2→v3**：
  - **v3（新 · 2026-05-03）**：**"SDK 2.32.3+ 启动期 · 渲染层 storage group `_prepare` 就绪时刻晚于 App.onLaunch 触发 · 任何从逻辑层同步发起的 `wx.*StorageSync` 调用都会经 jsbridge 委托到渲染层并报 `too eayly` · SDK + 业务共同责任"**
  - 相对 v2 的修正：v2 归因单点（storage.ts:29 顶层）· v3 扩展为"整个 onLaunch 同步 storage 调用族都会撞 `_prepare` 未就绪"
- **产出**：`.team/members/miniapp-dev/history/2026-05-03-costra-124-r2-diagnose.md`（500 行 · L1-L4 + 6 方案对比 + 8 Q 决策点 + 工具冒烟）
- **冒烟合规**：miniprogram/ 0 写入 · git commit 0 次 · 严格 D-017 Step 2 纪律

##### f.3.C · Human 2026-05-03 20:32 决策

- **D1 方案**：**B' + E' 合并版**（异步 API 全量替换 + bootstrap Promise 统一门控）
- **D2 卡边界**：**COSTRA-124 部分闭合 · 立 COSTRA-125 接力卡**（保持 1 点估点纪律 + commit 历史清晰）
- **D3 范围**：**`sync.ts` / `auth.ts` 其他写入点一并改 async**（不留半拉子技术债）
- R1 commit `a296be0` + `221b074` **保留不撤回**（作为 COSTRA-125 的必要前置 · 架构上更合理）

##### f.3.D · FU 分裂为 A/B/C 三子 FU（本 FU 结束顶层单态 · 转为族管理）

| 子 FU | 定义 | 状态 | owner_card |
|---|---|---|---|
| **FU-LAUNCH-A** · 顶层副作用分支 | `storage.ts` 模块顶层 `ensureVersion()` 裸调（前 3 次观察误判的旧归因 · v2 定性范围）| **closed** @ COSTRA-124 R1（commit `a296be0`）· 观察 4 驱动修复 · 架构上消除了公认反模式 | COSTRA-124（整卡状态=**部分闭合** · 此子目标完成）|
| **FU-LAUNCH-B** · 渲染层 storage group `_prepare` 时序 | onLaunch 内任何同步 storage 调用都会撞渲染层 `_prepare` 未就绪（v3 定性范围）· 真实根因 | **open** · 等 COSTRA-125 方案 B'+E' 修复 + Human 第 8 次实测 | **COSTRA-125**（本 FU 主力接力卡）|
| **FU-LAUNCH-C** · 首渲染数据投递错位 | `Expected updated data but get first rendering data`（观察 1 独立报告 · 观察 2-7 未复现 · 可能与 B 同源也可能独立）| **open** · 等 COSTRA-125 实测后判定（若随 B 修复自然消失 → close · 否则保持观察）| COSTRA-125 或 Sprint-2 |

**顶层 FU-LAUNCH-FIRST-RENDER-RACE 状态处理**：保留 `open` 作为父 FU · 状态 = "已分裂为 A/B/C · 见 §f.3.D" · 待 A/B/C 全部 close 后父 FU 同步 close。

##### f.3.E · 下游议题（Sprint-1 末 Retro · 2026-05-06 前 · 累增至 3 条）

- **议题 15**（继承 f.2 · 加固）："独立复核可翻转历史定性"范式——本次 v2→v3 是第 **2 次翻转** · 范式已被证实"翻转不是一次性事件 · 是过程产物"
- **议题 16**（继承 f.2 · 不变）：审查档 tools 白名单差异化
- **议题 17**（新增 · 本次驱动）：**"Review-Tech 纸面审不能拦住运行时假设漏洞"** · Review-Tech Round-1 给 R1 打 33/35 过审 · 但因为无模拟器访问 · 无法验"onLaunch 时 storage group 是否就绪"这种 runtime 假设 · **建议**：
  - 规约类 T2 卡的 Review 必须要求"Human 模拟器实测作为 Round-N+1 前置"（或 Review-Tech 获得 mini-ci 等 mock 模拟器工具）
  - 与议题 11"Review 35/35 可能基于错误假设"并链升级为 **P0 必议**
  - 与议题 13"Review-Tech 评分表加 runtime 加载性维度"合并

##### f.3.F · 反模式 #4 追写（`docs/devops/libversion-upgrade.md §3`）

本次 f.3 同轮追写方法论文档新反模式：

- **反模式 #4 · "过度信赖 onLaunch 作为 storage 就绪时刻"**
- **坏例**：R1 方案 A（把 `wx.*StorageSync` 从模块顶层挪到 onLaunch 首行 · 假设 onLaunch 够晚）
- **好例**：异步 API 全量替换（`wx.getStorage({key})` Promise 形态）· SDK 内部在 `_prepare` 就绪后 resolve · 业务无需猜测时刻
- **原因**：**文档承诺 ≠ 运行时实现** · 特别是 SDK 内部状态机（如 storage group `_prepare`）属黑盒 · 业务不应把"生命周期 hook 名称"当作"底层设施就绪"的代理信号 · 异步 API 是 SDK 把"等就绪"的责任收回去的正确机制

---

#### 🆕 f.4 · COSTRA-125 R1 实装（方案 B'+E' 落盘 · 2026-05-04 · 等 Human 第 8 次实测）

**追写时间**：2026-05-04（COSTRA-125 R1 实装交付时 · 由装扮 subagent `costra-miniapp-dev` 落盘）

**追写依据**：dispatch §3 DoD (h) FU 分裂明细 · 严守"Human 实测未通过前 FU 不真 closed"硬约束（沿袭 f.1.B 范式）

##### f.4.A · COSTRA-125 R1 改动落盘（2026-05-04）

- **DoD (a) storage.ts 全量 async**：`getItem / setItem / removeItem / ensureVersion` 4 个导出 API 全部返回 `Promise<T>` / `Promise<void>` · 内部走 `wx.getStorage({key})` Promise 形态（基础库 2.21.0+） · 4 条不变量注释（顶部 ⚠️ 段）+ data not found 错误路径吞错 · `*StorageSync` 同步 API 全部消灭（grep 0 命中 · 详见 `docs/devops/startup-api-call-audit.md §7.3`）
- **DoD (b) auth.ts 全路径 async**：initAuth `await getItem(TOKEN_KEY)`（**R1 漏网点** · async function 体内 await 之前同步执行）+ doWxLogin/refreshToken 4 处 `await setItem` + clearToken 改 `async` + logout `await clearToken`
- **DoD (c) sync.ts 全路径 async**：getCursor / setCursor / enqueueLocalEntry / __peekOutbox 全改 async · syncPull 内 `await getCursor()/setCursor()`
- **DoD (d) app.ts bootstrapPromise**：声明 `bootstrapPromise: Promise<void>` 占位 → onLaunch 内 IIFE 串行 `await ensureVersion(); await initAuth(); 无登录态跳 login` · onShow 走 `void this.bootstrapPromise.then(...)` gate · 错误兜底兼容 R1 行为（`wx.reLaunch` 跳 login）
- **DoD (e) 3 个 Page onLoad gate**：login / home / mine 三页 `onLoad` 改 `getApp<{bootstrapPromise:Promise<void>}>().bootstrapPromise.then(...)` 内判定 hasValidSession · home/mine 的 onShow 同步检查保留（onShow 必触发于 onLoad 之后 · bootstrap 已完成 · 不破坏 tabBar 进入语义）
- **DoD (f) 单测**：新建 `services/storage.spec.ts`（8 测：3 无 wx 环境兼容 + 5 mock wx 异步 API · 含 ttl 过期 + ensureVersion 首次/幂等 + data not found 路径）· `auth.spec.ts` 现状不调 storage（仅测 buildStored / wrap 同步逻辑）· 无需改 mock · 全 21 测 PASS
- **顺扫漏点**：`request.ts:113` 401 兜底分支 `clearToken()` 改 `await clearToken()`（clearToken 改 async 后调用方未 await · typecheck PASS 因为表达式语句兼容 · 但 race 漏点修复）

##### f.4.B · 第 8 次模拟器实测（2026-05-0x · 待 Human 触发）

**触发预期**：COSTRA-125 R1 commit 落盘后 · Human 清缓存 + 重新编译 + 冷启动 · 按 dispatch §9 附录 5 条检查清单验证。

**5 条断言**（AND 语义 · Launch Time AMBER 容差继承 P2-2）：

- ☐ 1. `too eayly`（任意变种：get/set/remove/metadata）Console 错误 0 次上报
- ☐ 2. `Expected updated data but get first rendering data` 0 次上报
- ☐ 3. Launch Time ≤ 900 ms（基线 865 ms · AMBER 900-935 ms Human 个案裁决）
- ☐ 4. 一键微信登录 → `auth.ts:157 [auth] wx.login ok {codeLen: 32}`
- ☐ 5. 首页 → 记一笔 · 可进入 · 无白屏 · 无报错

**实测结果**：**（待 Human 实测 @ 2026-05-0x · pending）**

##### f.4.C · 子 FU 状态流转（待 Human 第 8 次实测后由 Orchestrator 改写）

| 子 FU | 当前 | 第 8 次实测后预期 |
|---|---|---|
| FU-LAUNCH-A · 顶层副作用 | `closed` @ COSTRA-124 R1（commit `a296be0` 已落） | 保持 `closed`（不变） |
| **FU-LAUNCH-B · 渲染层 storage group `_prepare` 时序** | `open`（COSTRA-125 R1 已实装 · 等实测） | **断言 1 PASS → `closed` @ COSTRA-125** · 断言 1 FAIL → 触发 dispatch §0 P2-3 降级路径（C' 回退 libVersion 2.30.x 应急 + Sprint-2 E' 完整 bootstrap 重构） |
| FU-LAUNCH-C · 首渲染数据投递错位 | `open`（独立观察） | 断言 2 PASS → `closed` @ COSTRA-125 · 断言 2 FAIL → 保持 `open` 转 Sprint-2 |

**父 FU `FU-LAUNCH-FIRST-RENDER-RACE`**：A/B/C 三子全 `closed` 后由 Orchestrator 同步 close。

##### f.4.D · COSTRA-125 R1 涉及范围（commit 预设 sha 占位）

- commit 1（待落盘）：`fix(miniapp): migrate storage/auth/sync to async api + bootstrap promise (COSTRA-125)`
  - `miniprogram/services/storage.ts` · `auth.ts` · `sync.ts` · `request.ts` · `app.ts`
  - `miniprogram/pages/login/index.ts` · `home/index.ts` · `mine/index.ts`
  - 新建 `miniprogram/services/storage.spec.ts`
- commit 2（待落盘）：`docs(repo): costra-125 fu split + libversion-upgrade anti-pattern #4 (COSTRA-125)`
  - `.team/follow-ups/README.md`（本段 §f.4）
  - `docs/devops/startup-api-call-audit.md §7`（R2 普查追写）
  - `docs/devops/libversion-upgrade.md §3.4`（反模式 #4 · 已在 COSTRA-124 R2 翻转时随 dispatch 落盘 · 本卡仅核对存在性）
  - `.team/members/miniapp-dev/state.md`（§2/§3/§7）
  - `.team/members/miniapp-dev/history/2026-05-04-costra-125-r1-implement.md`（新建）

---

#### 🆕 f.5 · COSTRA-126 跨 lib 实测证伪 + FU 状态终结流转（2026-05-08）

**追写时间**：2026-05-08 17:30（COSTRA-126 整卡同轮落盘 · Human 第 8 次跨 lib 实测后）

**追写依据**：Human 第 8 次模拟器实测（2026-05-08 16:33 ~ 17:00）跨 5 lib 版本对照 + 业务代码 grep 三重 0 命中 → COSTRA-124 R2 v3 定性"SDK + 业务共责"被实测证伪 → 修正定性 v4"lib 2.32.x ~ 2.33.x dev 工具冷启动 SDK 内部 race · 业务无责"

##### f.5.A · 跨 lib 实测证据（5 版本对照）

**清缓存 + 重新编译**（IDE 进程已预热 · webview 复用）：

| lib | too eayly | Expected updated data | Launch Time | 业务流程 |
|---|---|---|---|---|
| 2.33.0 | 0 | 0 | 2156 ms | ✅ |

**重新打开项目**（IDE webview 冷启动）：

| lib | too eayly | Expected updated data | Launch Time | 业务流程 |
|---|---|---|---|---|
| 2.33.0 | 多次（getGlobalStorage / setGlobalStorage / removeGlobalStorage / traceEvent）| 1 次 | 3485 ms | ✅ 但 SDK 报错 |
| 3.8.12 | **0**（整族消失）| 1 次（残留）| 4216 ms | ✅ |
| 3.14.3 | （未测，留 Sprint-2 真机预览补全）| —— | —— | —— |
| `development` | 0 too eayly · 5 条 framework error `(TO:基础库开发同学)` `__wxConfig.useWebWorker / isFirstPage / isLazyLoad / plugins / subPackages` | —— | —— | 启动期 framework error（不可用于业务验证）|

##### f.5.B · 4 条独立证据链（业务无责）

1. **业务代码 grep 三重 0 命中**：`wx.*StorageSync` / `traceEvent` / `getSystemInfo` 全仓 0 命中
2. **报错栈 100% 在 SDK 内部**：lib 2.33.0 场景 B 全部报错栈在 `WAWebview.js` 的 `Tt._prepare` / `_setMetadata` / `traceEvent` · 0 行进业务代码
3. **报错时刻 100% 在 onLaunch 之前**：lib 2.33.0 场景 B 所有 `[渲染层错误]` 在 `[Costra] onLaunch env= dev` 之前打印 · 业务代码尚未执行
4. **lib 升级直接证伪**：lib 2.33.0 → 3.8.12 业务代码零变更 · `too eayly` 整族消失 → 不是业务能修的

##### f.5.C · 子 FU 终结流转（COSTRA-126 同轮）

| 子 FU | 旧状态 | 新状态 | 闭合依据 |
|---|---|---|---|
| FU-LAUNCH-A · 顶层副作用 | `closed` @ COSTRA-124 R1 | `closed`（不变） | commit `a296be0` 物理消除 · 架构治理价值保留 |
| **FU-LAUNCH-B · 渲染层 storage group `_prepare` 时序** | `open` @ COSTRA-125 R1 等实测 | **`closed` @ COSTRA-125 R1 + COSTRA-126 lib 升级** | 业务侧已通过 COSTRA-125 全 async 化（commit `4643f89`）· 无论 SDK 是否 race · 业务代码均已是充分必要正确实践 · lib 3.8.12 同时把 SDK 内部 race 修了 |
| **FU-LAUNCH-C · 首渲染数据投递错位** | `open` @ 等实测 | **`degraded-to-p3-observe`** · 真机延后验证 | lib 3.8.12 仍残留 1 次 · 仅 IDE 冷启动复现 · 与 LazyCodeLoading + dev 工具相关 · 与业务代码无关 · 真机不复现的概率高 · 留 Sprint-2 提审前真机验证 |

**父 FU `FU-LAUNCH-FIRST-RENDER-RACE`**：A 真 close + B 真 close + C 降 P3 观察 → **父 FU 状态 `closed`**（业务侧治理已完整 · C 残留只在 dev 工具 · 不阻 Sprint-1 收官）

##### f.5.D · 新立 FU-LIBVERSION-DEV-GUARD（P3 观察 · 不计点 · Sprint-2 候选）

- **范围**：CI 加 `check:libversion` 脚本扫 `project.config.json.libVersion` 不得为 `development`
- **背景**：本次 Human 实测时切到 `development` lib 立即出现 5 条 framework error `(TO:基础库开发同学)` · 暴露"无防护时易踩内部分支"
- **建议**：Sprint-2 加入 `scripts/devops/libversion-check.mjs`（参照 `whitelist-check.mjs` / `appjson-pages-check.mjs` 范式）+ `pr-check.yml` step
- **优先级**：P3 观察（开发期偶发 · 真机不可能用 development · 边界外漂移）
- **状态**：`open`
- **owner_card**：（待 Sprint-2 Planning 认领）

##### f.5.E · COSTRA-126 实装范围

- commit 1：`chore(miniapp): bump libversion 2.32.3 → 3.8.12 dev (COSTRA-126)`
  - `project.config.json` libVersion `2.32.3` → `3.8.12`（开发期）
  - `miniprogram/services/storage.ts` 顶部不变量注释收紧（开发期 lib + NFR 最低基础库分离）
  - `miniprogram/README.md` 区分"开发期基础库"vs"NFR 最低基础库"+ 禁用 `development` 警告
- commit 2：`docs(repo): costra-126 libversion-upgrade v4 + anti-pattern #5 + costra-125 close (COSTRA-126)`
  - `docs/devops/libversion-upgrade.md` §3.4 措辞修正 v4 + §3.5 反模式 #5 + §4 跨 lib 对照表 + §3.6 R1 假设证伪定稿
  - `.team/follow-ups/README.md`（本段 §f.5）
  - `.team/members/miniapp-dev/state.md`（§2/§3/§7）
  - `.team/members/miniapp-dev/history/2026-05-08-costra-126-libversion-upgrade.md`（新建）

##### f.5.F · NFR 最低基础库不动（明文声明）

- `docs/PRD.md` / `docs/qa/test-strategy.md` / `docs/qa/smoke-cases.md` / `docs/qa/wechat-review-checklist.md` 的 **"最低基础库 2.32.3"** 一律不改
- 理由：开发期 libVersion（开发者工具调试基础库）vs 上架 NFR 最低基础库（影响真机用户覆盖率）是两个独立概念
- 抬高 NFR 是产品决策（Epic-G 上架合规） · COSTRA-126 不在 Scope · 留 Sprint-2 PM 评估

---

#### 🆕 f.6 · COSTRA-127 实装 + FU-LAUNCH-C 真 closed（2026-05-08）

**追写时间**：2026-05-08（COSTRA-127 R1 实装 + Human 拍板全按推荐）

**追写依据**：COSTRA-127 dispatch + D-017 Step 2 诊断（方案 B） + Human 拍板 Q1-A/Q2-A/Q3-A/Q4-A

##### f.6.A · COSTRA-127 实装范围

- **commit 1**：`fix(miniapp): replace switchTab with reLaunch + onShow bootstrap gate (COSTRA-127)`
  - `miniprogram/pages/login/index.ts`（两处 switchTab → reLaunch + 注释）
  - `miniprogram/pages/home/index.ts`（onShow 加 bootstrapPromise.then gate）
  - `miniprogram/pages/mine/index.ts`（onShow 加 bootstrapPromise.then gate）
- **commit 2**：`docs(repo): costra-127 fu-launch-c true-close + libversion v5 + anti-pattern #6 (COSTRA-127)`
  - `docs/devops/libversion-upgrade.md`（§3.4 v5 措辞 + §3.6 反模式 #6）
  - `.team/follow-ups/README.md`（本段 §f.6）
  - `.team/members/miniapp-dev/state.md`（§2/§3/§7）
  - `.team/members/miniapp-dev/history/2026-05-08-costra-127-r1-implement.md`（新建）

##### f.6.B · FU-LAUNCH-C 状态流转

| 子 FU | 旧状态 | 新状态 | 闭合依据 |
|---|---|---|---|
| **FU-LAUNCH-C · 首渲染数据投递错位** | `degraded-to-p3-observe` @ COSTRA-126 | **`closed` @ COSTRA-127** | 方案 B 实装（login reLaunch + home/mine onShow bootstrap gate）+ **Human 模拟器实测 5 条断言全 PASS @ 2026-05-08 17:55**（0 次 `Expected updated data` · 0 次 `too eayly` · 登录链路贯通 · tabBar 切换正常）|

**父 FU `FU-LAUNCH-FIRST-RENDER-RACE`**：A/B 真 closed + C 真 closed → **父 FU `closed @ COSTRA-127` @ 2026-05-08 17:55（Human 实测兑现）**

**FU-LAUNCH 族 4 卡治理叙事完整收官**：
- COSTRA-124（顶层副作用）→ FU-LAUNCH-A close
- COSTRA-125（业务全 async）→ 治理充分必要正确实践
- COSTRA-126（lib 升级 + 跨版本实测）→ FU-LAUNCH-B close + 证伪 v3 假设
- COSTRA-127（业务 onShow 时序）→ FU-LAUNCH-C close + 证伪 v4 "业务无责" 假设

##### f.6.C · v4 → v5 措辞修正记录

§3.4 反模式 #4 措辞从 v4 修正为 v5：
- **v4（COSTRA-126）**：`Expected updated data` 1 次 → `degraded-to-p3-observe`
- **v5（COSTRA-127）**：`Expected updated data` 双因（SDK race + 业务时序）→ C 真 closed

##### f.6.D · 反模式 #6 立案

`docs/devops/libversion-upgrade.md §3.6` 新增反模式 #6：
- **坏例**：`login → switchTab(home) · home onShow 同步 hydrateUser + refresh`
- **好例**：`login → reLaunch(home) · home onShow 内 await bootstrapPromise`
- **原因**：switchTab 复用 home 旧实例 + onShow 同步执行无 gate · 与 bootstrap 完成时序竞速 · 渲染层抛 `Expected updated data`

---



**追写时间**：2026-05-02 21:xx（COSTRA-124 R1 实装交付时 · 由装扮 subagent `costra-miniapp-dev` 落盘）

**追写依据**：dispatch §3 DoD (f) 修订版（采纳 card-review-1-tech P2-3 建议 · 扩展为 f.1 + f.2 两段）

##### f.1.A · 第 4 次观察（2026-05-02 20:15-20:25 · 定性翻转事件）

- **触发**：Human 2026-05-02 20:15 给出新线索 "不是微信基础库的 bug · 而是高版本库对时序有要求" · 直接挑战前 3 次（2026-04-29 / 2026-05-01 / 2026-05-02 19:32）"100% SDK 内部 Bug · 非业务"的定性
- **响应**：Orchestrator 派单 · 装扮 subagent `costra-miniapp-dev`（SBAI v1.1 P2' 冒烟）按 D-017 Step 2 **只诊断不修复** 重做四层根因
- **产出**：`.team/members/miniapp-dev/history/2026-05-02-getglobalstorage-v2-diagnose.md`（L1-L4 根因 + 方案 A/B/C + Q1-Q6 决策点）
- **根因定位**：`miniprogram/services/storage.ts:29` 模块顶层裸调 `ensureVersion()` · 通过 `app.ts → auth.ts → storage.ts` 三级 import 链 · 在 `App()` 注册**之前**触发 `wx.getStorageSync(VERSION_KEY)` · 命中基础库 2.32.3+ 的 `createOrGetStorageGroup._prepare` 未就绪 · 抛 `too eayly`
- **定性**：**翻转** · 从"100% SDK 内部 Bug · 非业务"（前 3 次定性）改为"**业务代码触发 · 非 SDK Bug**"（第 4 次定性）
- **Human 拍板**：2026-05-02 20:31 · Q1-Q6 全"按推荐" · 方案 A（迁入 onLaunch · 零风险）· 立 COSTRA-124（Sprint-1 末小卡）

##### f.1.B · 第 5 次观察（2026-05-02 21:xx 预计 · 修复验证 · **待 Human 模拟器实测**）

- **触发预期**：COSTRA-124 R1 修复落盘后 · Human 第 7 次模拟器启动（按 dispatch §9 附录 5 条检查清单）
- **修复内容**：
  - `miniprogram/services/storage.ts`：删除 line 29 顶层 `ensureVersion()` 裸调 · 函数改 `export`
  - `miniprogram/app.ts`：`onLaunch()` 首行加 `ensureVersion()` 调用 + 对应 import
  - 顺扫确认 `miniprogram/**/*.ts` 无其他模块顶层 `wx.*` 副作用（0 命中 · 见 `docs/devops/startup-api-call-audit.md`）
  - 新建 `docs/devops/libversion-upgrade.md`（基础库升级影响评估方法论）
- **验证断言**（dispatch §3 DoD (e) · Human 实测 · AND 语义 + Launch Time AMBER 容差）：
  - ☐ 1. `getGlobalStorage fail: too eayly` 0 次上报
  - ☐ 2. `Expected updated data but get first rendering data` 0 次上报
  - ☐ 3. Launch Time ≤ 900 ms（基线 865 ms ± 35 · 900-935 ms 为 AMBER · 走 Human 个案裁决）
  - ☐ 4. `wx.login` 成功（`auth.ts:157 [auth] wx.login ok`）
  - ☐ 5. 首页 → 记一笔可进入
- **实测结果**：**（待 Human 实测 @ 2026-05-02 21:xx · pending）** · 通过后由 Orchestrator 或下次 spawn 补写实测结果 + 闭合依据 commit sha
- **FU 状态**：**保持 `open` · 待 Human 实测第 7 次通过后由 Orchestrator 改 `closed` 并补闭合依据**（严格遵守"Human 实测未通过前 FU 不真 closed"硬约束）

##### f.2 · 定性翻转追写段（治理价值沉淀）· 本 FU 独有范式

**翻转链完整复述**：

```
[观察 1 · 2026-04-29 · COSTRA-122 收官 · Human 第 5 次启动]
  定性：SDK 内部 Bug（误判 · 依据：拼写 eayly 是 SDK 内置字符串 · 我方 grep 0 命中 getGlobalStorage）
         ↓
[观察 2 · 2026-05-01 · COSTRA-123 收官 · Human 第 6 次启动]
  定性：SDK 内部 Bug 保持（误判加固）
  二级事实：storage.ts:29 顶层副作用"吻合但未坐实因果"（首次登记嫌疑点 · 未追查）
         ↓
[观察 3 · 2026-05-02 19:32 · D-018 SBAI v1.0 P2 冒烟首战]
  定性：加固为"100% 非业务 · SDK 内部 Bug 确认"（误判最强化版）
  理由："同步 API 不走 storage group metadata"（错误假设 · 后被 L2 SDK 机制推翻）
         ↓
[观察 4 · 2026-05-02 20:15-20:25 · 定性翻转]
  驱动：Human 20:15 新线索 "高版本库对时序有要求"
  响应：Orchestrator 派单装扮 subagent costra-miniapp-dev（SBAI v1.1 P2' 冒烟）独立核查
  动作：D-017 Step 2 只诊断不修复 · L1-L4 根因重做 · WebFetch 微信官方文档取证
  发现：L2 层证明"同步 API 在 native 层仍走 storage group prepare 基础设施"
        旧定性的核心假设被物理推翻 · storage.ts:29 坐实为唯一业务触发点
  翻转：SDK Bug → 业务触发 · 装扮 subagent 独立核查首次翻转 3 次历史定性
         ↓
[观察 5 · 2026-05-02 21:xx 预计 · COSTRA-124 R1 修复验证]
  状态：待 Human 实测（本 f.1.B 段）
  预期：5 条断言全过 → FU closed
```

**下游议题（Sprint-1 末 Retro · 2026-05-06 前）**：

- **议题 15**（新增 · 本 FU 直接驱动）："独立复核可翻转历史定性"范式 · 明文化为 SBAI v1.1 工作流程的一部分——**任何 FU 当出现 Human 新线索或第三方观察时 · Orchestrator 应主动派装扮 subagent 独立核查 · 不得以"已观察 N 次都是同定性"拒绝重审**
- **议题 16**（card-reviewer-tech 冒烟副产物）："SBAI v1.1 审查档 tools 白名单差异化设计验证通过 · 可沉淀为 D-018 §3.5 附录"（实装档 {Read+Grep+Glob+Write+Edit+WebFetch+Bash} / 审查档 {Read+Grep+Glob+LS+WebFetch}）

**方法论沉淀文档**：`docs/devops/libversion-upgrade.md`（COSTRA-124 同批产出 · DoD (d) · 未来每次微信基础库 minor 版本跃迁时走一遍 §2 四步评估）

**自我反思**：

- 前 3 次定性的共同漏洞：**用"grep 业务代码 0 命中异步 API"论证"因果链物理阻断"** · 忽略了 SDK 内部同步 API 的 native 层仍可能走异步 storage group 基础设施（JS 层语义 ≠ native 层桥接路径）
- 触发修正的关键：**Human 带来外部信息"高版本库对时序有要求"** · 装扮 subagent 原本受限于既有定性 · 若无外部挑战 · 误判可能持续数月
- 治理启示：Orchestrator / Human / 装扮 subagent 三方协同时 · Human 的直觉性假设（即便无 grep 证据）不应被"我方证据链自洽"压制 · 必须设置**独立复核通道**（本 FU 即是 D-017 Step 2 的激活实例）

---

### FU-MINIAPP-NPM-BRIDGE · MiniApp npm 构建桥接（decimal.js runtime 加载）

- **来源**：Human 2026-05-01 20:33 按 `docs/qa/costra-102-human-verify.md §1.1` 点击"一键微信登录" · 模拟器报 `module 'utils/decimal.js' is not defined, require args is 'decimal.js' at money.ts:6`（同族规约盲区**第 5 次**复发）
- **登记时间**：2026-05-01 21:02（COSTRA-123 dispatch 同轮）
- **范围**：
  - `project.config.json:42-48` · `packNpmManually:true` + `packNpmRelationList` 桥接根 `package.json` 到 `./miniprogram/`（微信工具在此目录下自动创建 `miniprogram_npm/` 子目录）
  - `docs/qa/costra-102-human-verify.md §0.3.1` · 新增 5 步"微信开发者工具首次准备（构建 npm）"
  - `miniprogram/README.md §3` · 末尾追加"构建 npm"首次必做提示
- **问题（治理反思 · 三个维度）**：
  - **盲区链第 5 次**：119 文件 → 120 tabBar → 121 工具链 → 122 .json loader → **123 npm 包 loader** · 共同结构"编译期工具链 ≠ runtime 加载契约"
  - **七环链共同漏检**：ADR-0002 硬约束 / 118 技术债 Review / 118 FINAL 分流 / 102 实装响应 / 102 卡定义 Review / 102 R1 Tech Review / 102 Human 验证手册 · 七个环节无一提及"小程序 npm 桥接"（Review-Agent-Tech 在 20:35~20:55 的过程复盘报告 R1 独立证实）
  - **CI 规约族当前无法覆盖**：`check:appjson` + `check:tooling` + `check:whitelist` 全绿 · 命令行 `tsc --noEmit` 能解析根 `node_modules/decimal.js` · 但微信 runtime 要求 `<miniprogramRoot>/miniprogram_npm/decimal.js/` 构建产物才能加载
- **修复方案**（Human 2026-05-01 21:00 裁决 · 选 A）：
  - 方案 A（采纳）：配置桥接根 `node_modules` · 无代码改动 · 与 `docs/ops/migration-to-mac.md:274-275` 既有约定自洽
  - 方案 B（否决）：新建 `miniprogram/package.json` · 双 package.json 版本漂移风险
  - 方案 C（否决）：vendor copy `decimal.min.js` · 违反 npm 语义 · 每次加 dep 都要手工
- **阻断级别**：P0（阻 Human COSTRA-102 §1.1 本地验证 · 同族第 5 次）
- **状态**：**`closed`** @ 2026-05-01 21:28（Human 第 6 次模拟器启动验证通过 · `auth.ts:157 [auth] wx.login ok {codeLen: 32}` · decimal.js 运行时错误彻底消失 · Launch Time 865 ms）
- **owner_card**：**COSTRA-123**
- **resolved_by**：COSTRA-123 R1 实装 · 3 文件 · `project.config.json` +5/-1 + 两份 markdown 共 +16 行 · 九闸全绿 + 反向验证 3 次 + Scope 严守 · 卡定义 Tech APPROVE 34/35 + R1 Tech APPROVE 34/35 · Human T2 APPROVED @ 2026-05-01 21:28 · D-016 第 12 次实战合规 · D-017 第 3 次实战完整闭环
- **治理价值**：
  - **D-017 第 3 次实战**（120 首次 · 121/122 第 2/3 次 · 123 第 3 次）· 首次完整走完 Step 1~5 全流程（含 Review-Agent-Tech 过程复盘独立产出）· 议题 D-017 v1→v2 升级证据第 3 组就位
  - **同族盲区第 5 次复发实证**：122 Retro 议题 3（"同族盲区紧迫性"）精准预言第 5 次 · 升级为 **Sprint-2 头部 Epic-F 或独立专项 P0 强制立案**
  - **Orchestrator 代职边界议题成立**：D-017 反模式 A 弱合规自报 · Sprint-1 末 Retro 新增第 14 条议题（D-017 §2.3 新增 E4 例外候选：Human 默示/明示接受代职分析合规化）
  - **CI 升级候选立案**：FU-CI-MP-BUILD-NPM-ENFORCE（Sprint-2 候选 COSTRA-124）把 miniprogram-ci 真实编译引入 CI · 结构性消除"命令行五闸全绿 vs 微信 runtime 红"落差
  - **Review-Tech 评分表增维候选**：FU-REVIEW-TECH-RUNTIME-DIM · 35 分制新增"runtime 加载性"维度 · Sprint-1 末 Retro 必议题第 13 条升级为 P0
- **同族规约盲区追溯**：本条为"Sprint-0 骨架期遗留微信规约债务"同族第 **5 次**暴露（第 1 次 = FU-COMMON-APP-JSON-DRIFT · 第 2 次 = -TABBAR · 第 3 次 = -PROJECT-CONFIG-DRIFT · 第 4 次 = -TOKENS-JSON-RUNTIME-IMPORT · **第 5 次 = 本条**）· Sprint-1 末 Retro 议题 10 紧迫性升级为 P0 强制

---

### FU-COMMON-MINIAPP-PATCH-LIMIT · 首次实触发观察（COSTRA-102 R1 预言精准验证）

- **现有 FU**：见下方索引 / COSTRA-102 R1 Review INFO-C 登记（2026-04-27 10:13）· 状态 `open-observation`
- **🆕 首次实触发观察**（2026-05-01 21:18 · COSTRA-123 Human 第 6 次模拟器启动）：
  - 现象原文：
    ```
    request.ts:88 POST http://localhost:8080/v1/users/me 404 (Not Found)
    index.ts:68 [login] PATCH /users/me soft-fail Error: route not found: POST /v1/users/me
    ```
  - 链路精准命中 R1 Review §P1-2 预言（`.team/reviews/COSTRA-102/round-1-tech.md:74-81`）：`wx.request` 不支持 PATCH → `request.ts` 降级为 `POST + X-HTTP-Method-Override:PATCH` → server/Fastify 不识别该头 → 请求落到 POST 路由 → OpenAPI `/users/me` 只有 GET + PATCH 无 POST → **404 · 用户不可见的静默失败**
  - 兜底有效：`pages/login/index.ts:68` `catch (e) { console.warn }` 打印 `soft-fail` · 登录流程继续推进至后续动作
  - **不阻 COSTRA-123 · 不阻 COSTRA-102 §1.1 Pass**（R1 Review 已判 P1 非阻塞）
- **FU 状态**：保持 `open-observation` · 归 **Sprint-2 基础能力改造**（非单卡）
- **备选三方案**（R1 Review §P1-2 预议 · 保留）：
  - (a) server/Fastify 加统一 `methodOverride` 中间件
  - (b) MiniApp-Agent 自己切到 DELETE+重建语义
  - (c) OpenAPI 改 PATCH → PUT（无破坏 · 语义等价）
- **治理价值**：R1 Review 在撞坑前 4 天（2026-04-27 10:13）精准预言此 P1 失败 · 证明 T2 档位 Tech Review 的"预言性 FU 登记"机制有效 · 减少未来同类问题的响应时长

---

## 📌 COSTRA-123 R1 T2 Tech APPROVE + Human T2 APPROVED 后状态流转（2026-05-01 21:28）

R1 MiniApp 交付 · T2 Tech 单轨 APPROVE 34/35 · Human 第 6 次模拟器启动实测验证通过（`auth.ts:157 [auth] wx.login ok {codeLen: 32}` · Launch Time 865 ms） · 同轮新立 1 条 FU + 追加 2 条 FU 观察证据：

| FU-ID | 状态 | owner_card |
|---|---|---|
| 🆕 FU-MINIAPP-NPM-BRIDGE | **`closed`** @ 2026-05-01（同族第 5 次完整闭环 · 本卡解决） | COSTRA-123 |
| FU-LAUNCH-FIRST-RENDER-RACE | **`open`**（第 2 次观察 · 2026-05-01 21:18 · 二级事实 `ensureVersion()` top-level 副作用登记但未坐实因果） | Sprint-1 候选 |
| FU-COMMON-MINIAPP-PATCH-LIMIT | **`open-observation`**（首次实触发 · R1 Review 预言精准兑现 · Sprint-2 三方案预议保留） | Sprint-2 基础能力 |
| 🆕 FU-CI-MP-BUILD-NPM-ENFORCE | **`open`**（本卡新立候选 · CI 层引入 miniprogram-ci 真实编译冒烟 · 结构性消除命令行五闸 vs 微信 runtime 落差） | Sprint-2 候选 COSTRA-124 |
| 🆕 FU-REVIEW-TECH-RUNTIME-DIM | **`open`**（本卡新立 · Review-Tech 35 分评分表新增"runtime 加载性"维度 · Sprint-1 末 Retro 必议题第 13 条升级 P0） | Sprint-1 末 Retro |

---

_本文件由 Orchestrator 按需追加；不直接编辑，仅在 Agent Revision Response 产出时同步新增条目。_
