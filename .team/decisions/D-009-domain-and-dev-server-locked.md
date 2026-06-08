# D-009 · 生产域名锁定 + 开发期云服务器到位

- **日期**：2026-04-23 13:00
- **发起人**：Human
- **登记人**：Orchestrator
- **状态**：Approved（当场生效）
- **关联**：D-007（外部资源批次 1）、D-008（主体策略）、R-007、R-013

---

## 1. 背景
D-008 将域名决策时效从"ICP 受理后 7 日内"收紧为"本周内"。Human 今日中午完成三件事：
1. 注册生产域名 **`costra.cloud`**
2. 腾讯云购买 **3 个月期**开发用云服务器（ECS/轻量，待补规格），公网 IP **`49.235.216.20`**
3. 已在域名服务商配置 **DNS A 记录 `costra.cloud → 49.235.216.20`**
4. 个人主体 ICP 备案已向接入商提交（等待通管局短信审核 3~5 日）

---

## 2. 决议

### 2.1 域名策略（正式锁定）
| 环境 | 域名 | 用途 | 状态 |
|---|---|---|---|
| 生产 | `costra.cloud` | 小程序服务器域名（上架后正式使用） | 🟢 已注册，DNS 已解析，**ICP 备案受理中** |
| 开发 | `dev.costra.cloud`（建议） | 开发/联调，不进小程序白名单 | 🟡 待 DevOps 创建 DNS 子记录 |
| 预发 | `stg.costra.cloud`（建议） | Sprint-2 末启用 | 🟡 待启用 |
| API 入口 | `api.costra.cloud`（建议） | 生产 API 正式域名 | 🟡 备案下证后启用 |

> **R-013 关闭前置条件**：ICP 备案下证后将 `api.costra.cloud` 配进微信后台"服务器域名"白名单，并从 CI 校验。

### 2.2 开发服务器用途边界
**仅限开发/联调/本地真机调试**，不作为提审或线上生产：
- ✅ 允许：Backend 本地镜像推上去跑、MiniApp 真机调试指到 `https://dev.costra.cloud`（**需备案后才可被微信白名单接受**）、冒烟脚本跑
- ❌ 禁止：承接任何真实用户流量、作为正式上架时的 request 域名
- ⏰ **3 个月硬过期**（2026-07-23），Sprint-4 末必须决策是否续费或迁移至微信云托管/Lighthouse

### 2.3 备案期间的"可跑通"过渡方案（关键）
微信小程序 `request` 白名单**必须是 HTTPS + 已备案域名**，备案期间 20 工作日内无法用 `costra.cloud`。给出三条路径，按优先级选择：

| 方案 | 可行性 | 成本 | 决策 |
|---|---|---|---|
| **A. 开发期走"不校验合法域名"** | ✅ 微信开发者工具可开关；真机调试用"调试"模式也不校验 | 0 | 🟢 **Sprint-1 默认采用** |
| B. 临时挂微信云托管自动域名 | ✅ 云托管域名已备案可直接用 | 云托管实例 ¥30~/月 | 🟡 降级预案，若 A 路不足再启 |
| C. 等备案下证再联调 | ❌ 会卡 Sprint-1 端到端 | — | ❌ 否决 |

**采用 A**：Sprint-1 端到端（COSTRA-102）在开发者工具 + 真机调试模式下跑；一旦 `costra.cloud` 备案下证，立刻切到 `api.costra.cloud`。

### 2.4 安全基线（开发服务器强制项）
| 项 | 要求 | Owner |
|---|---|---|
| SSH 端口 | 改非 22，key-only，禁 root 密码登录 | DevOps |
| 云防火墙 | 仅开放 22(改后)/80/443，其他默认拒绝 | DevOps |
| HTTPS | 备案下证前用自签 / 开发工具不校验；下证后立即 Let's Encrypt | DevOps |
| 密钥管理 | `.env` 绝不进仓；服务器侧用 systemd EnvironmentFile 或 docker secret | DevOps |
| 告警 | 登录失败 ≥5 次/分钟告警到 Human 邮箱 | DevOps |
| fail2ban | 启用 | DevOps |
| 数据备份 | 开发库每日 dump 到腾讯云 COS（开发数据不值钱但演练流程） | DevOps |

### 2.5 工程配置约束
在 `docs/devops/` 和 `.env.*.example` 中统一字段命名：
```
SUBJECT_TYPE=individual
DOMAIN_PROD=costra.cloud
DOMAIN_API_PROD=api.costra.cloud
DOMAIN_DEV=dev.costra.cloud
DEV_SERVER_IP=49.235.216.20        # 仅文档提及，不进代码
DEV_SERVER_EXPIRY=2026-07-23       # 3 个月到期提醒
```

---

## 3. 派生任务（追加到 Sprint-1）

| 卡号 | Owner | 点 | 说明 | 交付物 |
|---|---|---|---|---|
| **COSTRA-114** | DevOps-Agent | 2 | 开发服务器初始化：SSH 加固、防火墙、docker、nginx（自签 HTTPS） | `docs/devops/dev-server-bootstrap.md` + 执行截图 |
| **COSTRA-115** | DevOps-Agent | 1 | `costra.cloud` DNS 子记录规划 + CI 校验脚本（检查 `api/openapi.yaml` servers 与白名单一致） | `infra/wechat/domains.md` 更新 |
| **COSTRA-116** | PM-Agent | 1 | ICP 备案进度追踪卡（每 3 日 ping Human 一次，直到下证） | `.team/risks.md` R-013 每 3 日刷新一次 |

Sprint-1 估点：37 → **41 点**（**首次越过 40 工时软上限 ⚠️**）

**越限应对**：
- 选项①：**COSTRA-116** 并入 PM 常规操作（不计点）→ 回到 40 点 ✅
- 选项②：**COSTRA-106**（Sprint-0 Retro）延至 Sprint-2 头部（非关键路径）→ 回到 40 点 ✅

Orchestrator 默认采用 **选项① + ②**，Sprint-1 重新计点 **39 点**。

---

## 4. 风险变更

| ID | 变更 |
|---|---|
| R-013 | 🟠 → 🟢（域名已定）。**保留 Open 直到 ICP 下证**，下证后关闭 |
| R-017 | 🆕 开发服务器 3 个月到期（2026-07-23）后若未迁移将中断联调 · 🟡 |
| R-018 | 🆕 开发服务器首次暴露公网，SSH/web 攻击面骤增，配置不当可能数据泄漏 · 🟠 |

---

## 5. Human 后续仅需做的事
1. **备案短信审核到达时**：按短信提示 5 分钟内回复验证
2. **备案下证后**（约 20 工作日）：把 `api.costra.cloud` 填入微信后台"服务器域名"白名单，并告知 Orchestrator 关闭 R-013
3. **2026-07-23 前 7 日**：决定开发服务器续费 or 迁移（Orchestrator 会提前提醒）

其余全部由 DevOps-Agent / PM-Agent 驱动。

---

## 6. 归档
- 域名注册记录：`docs/devops/domains.md`（DevOps COSTRA-115 创建）
- 服务器 bootstrap 流水：`docs/devops/dev-server-bootstrap.md`（DevOps COSTRA-114 创建）
- 本决议永久有效，切公司主体时 D-008 附件更新 `SUBJECT_TYPE` 即可，不影响本决议
