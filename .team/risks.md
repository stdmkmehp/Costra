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

**等级说明**：🔴 红（立即处理） / 🟠 橙（一周内） / 🟡 黄（观察） / 🟢 绿（已缓解）

**最后刷新**：2026-04-21（COSTRA-001 by PM-Agent，新增 R-009/R-010/R-011）

