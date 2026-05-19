# 风险登记册

| ID | 风险描述 | 影响 | 概率 | 等级 | 负责人 | 缓解措施 | 状态 |
|----|---------|------|------|------|--------|---------|------|
| R-001 | 微信小程序审核拒绝（类目/隐私指引/诱导分享） | 高 | 中 | 🟠 | PM | 按微信《小程序审核指南》自查清单预审 + QA 出审核自查单 | Open |
| R-002 | 多人同步冲突导致金额错乱 | 高 | 中 | 🔴 | Backend | 版本号 + 服务器权威 + 冲突弹窗 | Open |
| R-003 | 金额字段精度丢失（误用 float / JS Number） | 高 | 低 | 🟠 | Backend / MiniApp | DECIMAL(18,4) + decimal.js + 单测校验 | Open |
| R-004 | 家庭成员数据越权访问 | 高 | 低 | 🟠 | Backend | 所有查询强制 family_id 鉴权 | Open |
| R-005 | 微信订阅消息模板未申请/类目不符导致推送阻塞 | 中 | 中 | 🟡 | DevOps / PM | Sprint-0 前完成订阅消息模板申请 + 类目合规 | Open |
| R-006 | 主包体积超 2MB 上传失败 | 中 | 中 | 🟡 | MiniApp | 分包 + 图片走 CDN + CI 体积检查 | Open |
| R-007 | 服务器域名未白名单导致真机网络失败 | 高 | 低 | 🟠 | DevOps | 微信后台配置清单 `infra/wechat/domains.md` + CI 校验 | Open |
| R-008 | session_key / appsecret 泄漏 | 极高 | 低 | 🔴 | DevOps / Backend | Vault 存储 + 禁止下发 + 代码扫描阻断 | Open |
| R-009 | Human 侧外部资源（AppID/主体/类目/域名/订阅消息模板/robot key）到位延迟 | 中 | 中 | 🟡 | PM / Human | charter.md §9 登记 + 降级预案：本地打包/人工上传兜底，不阻塞骨架开发 | Open |
| R-010 | PRD v0.1 范围蔓延（Won't-Have 项被带入 MVP） | 中 | 中 | 🟡 | PM | 每 Sprint 评审 Won't-Have 边界；变更走 ADR | Open |
| R-011 | 微信平台政策变更（API 能力收紧 / 订阅消息规则调整 / 类目细则） | 中 | 低 | 🟡 | DevOps / PM | DevOps 每月扫描"小程序最新公告"一次，产出平台变更监听周报 | Open |
| R-012 | 体验号与生产号长期共用同一 AppID（wxf8b0d3e3a83f9941），导致真机调试冲撞审核/正式版，或 robot 上传污染生产 | 中 | 中 | 🟡 | PM / DevOps | ① 小程序首次进入审核前必须拆号 ② CI 上传演练仅走"体验版"通道不走"提审" ③ robot id 预留 ≥2，切号时零改动 | Open（D-007 登记） |
| R-013 | 生产域名迟迟未定，ICP 表单无法填写具体 hostname，导致备案延期 | 高 | 中 | 🟢 | PM / Human | **已关闭**：2026-04-23 `costra.cloud` 注册 + DNS 解析到 `49.235.216.20` + 个人主体 ICP 已提交 → 2026-05-13 ICP 实际下证（小程序 `沪ICP备2026017253号-1X` · 后端 `沪ICP备2026017253号-2` · 主体上海）。**关闭原因**：ICP 已下证 2026-05-13，关闭条件已满足。COSTRA-115 CI 白名单一致性校验（`scripts/devops/whitelist-check.mjs`）已接入 `pr-check`，下游 Human 按 `infra/wechat/domains.md §4` 配置微信"服务器域名"白名单。详见 `docs/legal/compliance-registry.md` | **Closed @ 2026-05-13** |
| R-014 | 主体切换债务累积：硬编码主体字样散落在代码/文案/合规文档，未来个人→公司迁移工作量失控 | 高 | 中 | 🟠 | PM / MiniApp / Backend | ① 强制走 `config/subject.ts` 集中配置 ② 每 Sprint 末按 `docs/ops/subject-compat-matrix.md` 自查 ③ CI 加 grep 规则拦截硬编码 | Open（D-008 登记） |
| R-015 | 个人主体小程序提审被拒概率高于企业主体（文案边界敏感） | 中 | 中 | 🟡 | PM / QA | COSTRA-050 自查清单新增"个人主体文案禁区"条目；避免"财务咨询/投资建议/商业经营"字样 | Open（D-008 登记） |
| R-016 | 个人主体无法开通微信支付商户号，若 Sprint-3+ 不慎纳入付费能力将导致返工 | 高 | 低 | 🟠 | PM | D-008 明列付费/商户/交易组件为 Won't-Have；需求评审必过此闸 | Open（D-008 登记） |
| R-017 | 开发用腾讯云服务器（49.235.216.20）3 个月到期（2026-07-23），未迁移将中断 Sprint-4/5 联调 | 中 | 中 | 🟡 | DevOps / Human | Orchestrator 在 2026-07-16 提醒；候选迁移目标：微信云托管 / Lighthouse 年付 | Open（D-009 登记） |
| R-018 | 开发服务器首次暴露公网，SSH/web 攻击面骤增，若未做基线加固可能被爆破或利用跳板 | 高 | 中 | 🟠 | DevOps | COSTRA-114 强制完成：SSH 改端口+key-only / 云防火墙仅放 22(改)/80/443 / fail2ban / 告警。未完成不进 Sprint-1 端到端 | Open（D-009 登记） |
| R-019 | 公安联网备案 30 日窗口（截止 2026-06-12），逾期可能被通报或限制访问 | 中 | 中 | 🟡 | Human | ICP 备案下证（2026-05-13）后 30 日内必须到 https://beian.mps.gov.cn/ 提交公安联网备案；PM-Agent 在 `docs/legal/compliance-registry.md §4` 跟踪 · 公安备案下证后回填 §4 公安备案号 + §5 悬挂位置同步追加 · 不阻塞小程序提审 / M4 上线，但 M5 观察期前必须完成 · D-023 决议下公安备案表填根域 `costra.cloud` 即可 · **2026-05-19 Human 已提交申请**（在 30 日窗口内 · 风险等级 🟠→🟡 · 待公安系统 15~20 工作日审核下证 · 下证后回填备案号触发 §5 悬挂位置追加） | Open · Submitted（2026-05-19 已提交 · 等下证）|
| R-020 | 微信白名单 staging 边界模糊（D-023 短期内 staging env 与 prod 共用 `costra.cloud` 白名单） | 中 | 低 | 🟡 | DevOps | 短期：通过 `miniprogram/services/env.ts` 编译期常量隔离避免误用 + Backend `WX_MOCK_LOGIN` env switch 不在 prod 构建产物中 · 长期：由 D-023 §2.4 触发条件 (a)（staging 环境实际需要与 prod 隔离 · 如 DB / 数据集 / 灰度名单）重启 `stg.* / api-staging.*` 子域解决 · 详见 `.team/decisions/D-023-prod-rollout-on-root-domain.md §5.1` · **2026-05-19 Human 已在微信公众平台填白名单 `https://costra.cloud`**（4 类 request/socket/uploadFile/downloadFile 全填 · 即时生效 · D-023 §7 #1 解锁条件已满足） | Open · Mitigated（2026-05-19 白名单已配 · staging/prod 共用边界由编译期常量 + WX_MOCK_LOGIN 隔离持续生效） |

**等级说明**：🔴 红（立即处理） / 🟠 橙（一周内） / 🟡 黄（观察） / 🟢 绿（已缓解 / 已关闭）

**最后刷新**：2026-05-19 14:50（Orchestrator · Human 完成两项强阻塞清空：① 微信白名单已配 `https://costra.cloud` · ② 公安联网备案已提交申请 · R-019 🟠→🟡 / R-020 mitigation 落实）

> **ID 占用说明**：原任务派单中要求新增"R-014 公安联网备案"，但 R-014~R-018 在 D-008 / D-009 时已占用（R-014 主体切换 / R-015 个人主体文案 / R-016 微信支付 / R-017 服务器到期 / R-018 SSH 攻击面）。本次新增按风险登记册 ID 单调递增原则使用 **R-019**（公安联网备案）。`docs/legal/compliance-registry.md §4` 中关联风险编号已同步指向 R-019。R-020（D-023 派生 · 2026-05-18）按 ID 顺延。

