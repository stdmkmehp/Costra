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

_本文件由 Orchestrator 按需追加；不直接编辑，仅在 Agent Revision Response 产出时同步新增条目。_
