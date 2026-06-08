# COSTRA-114 · 开发服务器 Bootstrap 手册（Human 按步执行版）

> 📋 **卡定义状态**：🔴 **WAITING-HUMAN-REVIEW**（revise 第 2 轮 · 2026-04-24 13:14）
> **本轮修订重点**（Human revise-card · 2026-04-24 13:14）：
> - ❌ 旧版错误前提：假设 DevOps-Agent 能 SSH 真机执行命令
> - ✅ 新版正确定位：**Agent 无真机访问权限** → 本卡交付**一份 Human 可按步执行的 bootstrap 手册**；手册 = 最终交付物；真机执行由 Human 按手册操作，Agent 只写文档、审命令、定验证方式
> - ❌ 删除 §6.1.b "真机执行阶段"（Agent 无法做的事不列为 Agent 职责）
> - ✅ 新增 §4.1 "每步三件套"强制格式：**执行命令 + 验证命令 + 预期输出**
> - ✅ 新增 §5.4 "Human 可执行性 DoD"：手册必须是 Human 不动脑拷贝粘贴就能跑完的级别
> - ✅ 新增 §6 简化为两阶段：**Agent 写手册 → Review 审 → Human 终审 approve:COSTRA-114**（真机执行与否由 Human 决定，不卡本卡完工）
>
> Human 审批触发词：
> - ✅ `approve-card:COSTRA-114` — 卡定义放行 · DevOps-Agent 按本单开干
> - ✏️ `revise-card:COSTRA-114 <修改点>` — 再次驳回修改
> - 🚫 `skip-card-review COSTRA-114` — 跳过（记 incident · 按 §8.2 豁免直接进 Todo）

---

- 派发人：Orchestrator
- 接收人：**DevOps-Agent**
- 派发时间：2026-04-24 13:14（Asia/Shanghai · 修订版）
- 首版时间：2026-04-24 13:04
- 截止：**2026-04-25 18:00**（D-009 §3 · 剩约 28h 46m）
- 优先级：P1（Sprint-1 关键路径 · COSTRA-102 端到端依赖）
- 闸门影响：无直接闸门，但 G4 合并前必须到位
- 分类：**基础设施文档**（Infrastructure Runbook）
- 估点：2

---

## 0. 前提澄清（本次修订的根本变更）

**🚨 Agent 能力边界（铁律）**：
- DevOps-Agent **不能** SSH 到 `49.235.216.20`
- DevOps-Agent **不能** 在真机执行任何命令
- DevOps-Agent **不能** 读取真机 `uname -a` / `cat /etc/os-release` 等运行时状态
- DevOps-Agent **能** 做的：写文档、写脚本模板、指定命令、指定验证方式、指定预期输出范式

**因此本卡的交付本质**：
不是"把服务器配好"，而是"交付一份**使任何人（含 Human）能把服务器配好**的手册 + 配套脚本模板"。真机执行动作由 **Human 在手册完工后按需执行**，**不纳入本卡完工判定**。

**原 dispatch 的 §6.1.b "真机执行" 段删除**。若 Human 执行手册过程中发现手册问题，走 follow-up 卡（COSTRA-114-F1/F2...）修补，不回滚本卡。

---

## 1. 背景

D-009（2026-04-23 13:00 Approved）锁定了生产域名 `costra.cloud` 和开发期云服务器 `49.235.216.20`（腾讯云 3 个月期 · 2026-07-23 到期）。现需**以手册形式**把这台"裸机"推进到"可承载 Backend 联调镜像 + 真机调试"的**安全基线可用态**的完整路径沉淀下来。

**红线**（R-018）：服务器首次暴露公网，SSH/web 攻击面骤增，配置不当可能数据泄漏 🟠。Human 按手册执行完**之前**，不得将任何真实用户数据、真实密钥、生产镜像推到该服务器。

---

## 2. 目标（What）

交付一份**Human（或后继 DevOps 接手人）可独立按步执行**的 bootstrap 手册 + 配套模板脚本。完工后 Human 拿着这份手册能在 1~2 小时内把一台新腾讯云主机从零推进到 D-009 §2.4 安全基线可用态。

具体包括：
1. SSH 加固章节（非 22 端口 · key-only · 禁 root 密码登录）
2. 系统级防火墙章节（仅开放 SSH 改口 / 80 / 443 · 其他默认拒绝）
3. docker + docker compose 安装章节（最新稳定版 · 国内镜像加速）
4. nginx 反向代理 + 自签 HTTPS 证书章节（备案未下证前过渡方案）
5. fail2ban 章节（SSH 默认策略即可）
6. 登录失败告警章节（≥5 次/分钟 → Human 邮箱）
7. 开发库每日 dump 到腾讯云 COS 章节（演练流程）
8. 全流程文档化 → `docs/devops/dev-server-bootstrap.md`
9. 配套模板脚本 → `infra/` 下

**非目标**（明确不做）：
- ❌ **Agent 不在真机执行任何命令**（本次修订核心前提）
- ❌ **不配 Let's Encrypt 正式证书**（备案未下证 · D-009 §2.4 下证后另卡处理）
- ❌ **不部署任何真实 Backend 镜像**（COSTRA-102 之后的卡负责）
- ❌ **不配置 DNS 子记录**（COSTRA-115 职责）
- ❌ **不配置 CI 推镜像流水线**（COSTRA-108 之后的卡负责）
- ❌ **不做应用级性能基线 / 监控告警接入**（Sprint-2 以后）
- ❌ **不采购 / 变更任何云资源**
- ❌ **不做真机截图归档**（Agent 做不到 · 交付时无截图亦可验收 · Human 自行执行时按需留存）

---

## 3. 输入（Inputs）

| 来源 | 文件 / 资源 | 关键点 |
|---|---|---|
| D-009 §2.4 安全基线 | `.team/decisions/D-009-domain-and-dev-server-locked.md` | 7 项强制要求（SSH / FW / HTTPS / 密钥 / 告警 / fail2ban / 备份）|
| D-009 §2.5 工程约束 | 同上 | `SUBJECT_TYPE` / `DOMAIN_*` / `DEV_SERVER_IP` / `DEV_SERVER_EXPIRY` 字段命名 |
| 风险册 R-018 | `.team/risks.md` | 🟠 首次公网暴露攻击面 |
| 风险册 R-017 | 同上 | 🟡 3 个月硬过期（2026-07-23）|
| 章程 §7 | `docs/charter.md` | DevOps 工作区：`infra/` + `.github/workflows/` |
| engineering-guidelines | `.team/engineering-guidelines.md` | 敏感文件禁进仓 · 密钥走 `infra/secrets.vault` 或对象存储 |
| 云服务器 | 腾讯云 ECS/轻量 `49.235.216.20` | **Agent 不直接访问** · OS 发行版假设取 Ubuntu 22.04 LTS（主流默认 · 手册中明示"若实际非此版本 Human 按 §Appendix D 替换对应命令"）|

> **依赖状态**：D-009 ✅ 已 Approved · 无上游阻塞 · COSTRA-113 ✅ 不阻塞本卡

---

## 4. 交付物（Deliverables）

### 4.1 主交付：`docs/devops/dev-server-bootstrap.md`

**🔑 核心规范（Review-Tech 评分最硬指标）· 每步必须"三件套"齐全**：

对手册里每一个具体操作步骤，**强制**包含以下三部分，缺一不可：

1. **【执行】命令块**：可直接复制粘贴的 shell 命令（含运行身份标注 root / admin · 注释说明意图）
2. **【验证】命令块**：执行完该步后用于**确认生效**的命令（必须是只读命令 · 不引入副作用）
3. **【预期】输出范式**：验证命令应得到的输出样例（含允许变化的部分用 `<...>` 标注 · 失败特征也要写）

**格式示例**（手册中每一步必须遵循此结构）：

```markdown
### Step 2.3 · 改 SSH 端口为 ${SSH_PORT}

#### 执行（身份：root · 一次性不可重做 · 改前确保 §2.2 已完成 key 登录测试）
```bash
# 修改 sshd_config
sudo sed -i "s/^#\?Port .*/Port ${SSH_PORT}/" /etc/ssh/sshd_config
# 防火墙放行新端口（先加规则再重启 sshd · 保留 22 端口直至确认新端口登录成功）
sudo ufw allow ${SSH_PORT}/tcp comment 'ssh-custom'
# 重启 sshd
sudo systemctl restart sshd
```

#### 验证（另开一个本地终端 · 不要关闭当前 22 端口会话！）
```bash
ssh -p ${SSH_PORT} ${ADMIN_USER}@${DEV_SERVER_IP} 'whoami'
```

#### 预期输出
```
${ADMIN_USER}
```
失败特征：
- `Connection refused` → sshd 未监听新端口 · 回看 `/etc/ssh/sshd_config` 的 `Port` 行
- `Connection timed out` → ufw 未放行 · 执行 `sudo ufw status` 确认新端口在列表

#### 回滚（若新端口登录失败）
保留原 22 端口 session，执行：
```bash
sudo sed -i "s/^Port ${SSH_PORT}/#Port 22/" /etc/ssh/sshd_config  # 回改
sudo systemctl restart sshd
```
```

**其他规范要求**：

1. **Prerequisites 段**：明确假设的发行版（Ubuntu 22.04 LTS）、初始用户、访问方式、Human 本地所需工具（ssh 客户端 / scp / 可选 docker CLI）
2. **变量占位**：所有可配置值用 `${VAR}` 形式（`${DEV_SERVER_IP}` / `${SSH_PORT}` / `${ADMIN_USER}` / `${SERVER_NAME}` 等）· 真值写在文末 **Appendix A "本机实际值"** 段（该段明示"仅本地 · 不入仓 · Human 自行维护"）
3. **幂等性标注**：每一步开头标 🟢(可重复执行) / 🟡(一次性但可回滚) / 🔴(一次性不可重做 · 执行前需再三确认)
4. **回滚节**：🟡 / 🔴 步骤必须配回滚路径（SSH 端口 / ufw 默认拒绝 / nginx 上线三处必写）
5. **章节连贯性**：前后步骤能从头跑到尾 · 不跳跃 · 不引用未提到的工具

**章节框架（强制结构 · DevOps-Agent 按此落地）**：
```
0. 元数据（Owner / 最后更新 / 版本 / 适用 OS）
1. Prerequisites（Human 本地工具 / 云服务器前置状态 / 所需凭证清单）
2. Step 1 · 初始 root 会话 · 创建 admin 用户 · 上传 ssh key
3. Step 2 · 禁 root 密码登录 · 改 SSH 端口 · 重启 sshd（含回滚）
4. Step 3 · UFW 防火墙 · 仅放行 ${SSH_PORT}/80/443
5. Step 4 · 安装 docker + docker compose（含国内镜像加速配置）
6. Step 5 · 安装 nginx · 自签 HTTPS 证书生成（有效期 365 天 · CN=dev.costra.cloud）
7. Step 6 · nginx 反向代理模板（80 强制跳 443 · 443 转发 127.0.0.1:3000 占位）
8. Step 7 · fail2ban 安装 + SSH 默认策略
9. Step 8 · 登录失败告警（logwatch + sendmail 或 cron 脚本 + 腾讯云 SES · 给两种方案让 Human 二选一）
10. Step 9 · 开发库备份脚本（cron daily · 推 COS · 保留 7 天）
11. Step 10 · 全量验证清单（把全部步骤的【验证】命令汇总成 checklist · Human 一口气跑一遍确认全部 OK）
12. Appendix A · 本机实际值模板（仅本地 · 不入仓 · 给变量名清单让 Human 填）
13. Appendix B · 回滚全流程（若 SSH 完全锁死如何通过腾讯云控制台 VNC 挽救 · 文字步骤 · Agent 无需真机空跑）
14. Appendix C · 2026-07-23 到期前迁移选项（R-017 跟踪 · 续费 vs 迁云托管 vs 迁 Lighthouse 利弊对比）
15. Appendix D · OS 差异补丁（若 Human 的服务器非 Ubuntu 22.04 · 给出 CentOS/Debian 关键命令替换对照表）
```

### 4.2 配套产出（入仓模板脚本）

| 产物 | 路径 | 说明 |
|---|---|---|
| nginx 配置模板 | `infra/nginx/dev.conf.tpl` | 可参数化模板（`${UPSTREAM_HOST}` / `${SERVER_NAME}`）· 入仓 |
| 备份脚本模板 | `infra/scripts/dev-db-backup.sh.tpl` | 可参数化 cron 脚本模板 · 入仓 · 开头配注释说明如何替换变量并安装到 crontab |
| 自签证书生成脚本 | `infra/scripts/gen-selfsigned-cert.sh` | openssl 一键生成 · 入仓 · 参数化 CN / 有效期 |
| systemd EnvironmentFile 样例 | `infra/systemd/costra-backend.env.example` | 规范密钥不进仓的组织方式（D-009 §2.4）|
| fail2ban 配置样例 | `infra/fail2ban/jail.local.example` | SSH 默认策略 · 入仓 |
| logwatch / 告警脚本模板 | `infra/scripts/login-alert.sh.tpl` | 可参数化告警脚本（邮件接收地址占位）· 入仓 |
| `.env.production.example` DEV_SERVER_* 补齐 | `server/.env.production.example` | 追加 `DEV_SERVER_IP` / `DEV_SERVER_EXPIRY` 两个注释变量（与 D-009 §2.5 字段对齐）· 值仅写占位 `<填本机实际 IP>` |

**模板脚本统一规范**：
- 文件头注释：用途 / 参数列表 / 依赖 / 安装位置
- 所有真实值用 `${VAR}` 占位
- 带 `# shellcheck` 注释（如适用）· 确保模板本身通过 shellcheck

### 4.3 状态回写（本卡完工时动作）

- `.team/board.md` · COSTRA-114 进 AI-Review（Orchestrator 按 D-014-b 自动拉起产出 Review）
- `.team/STATE` · 更新 Sprint-1 进度
- `.team/risks.md` · R-018 加备注"bootstrap 手册已交付 · 执行与否由 Human 自行决定 · 执行后可降 🟡"
- `.team/risks.md` · R-017 加备注"bootstrap 手册已完成 · 到期迁移决策卡占位 R-017-mig-decision · 2026-07-16 前"
- `git commit`（D-012 铁律 · 单卡交付即提交）

---

## 5. 验收标准（DoD）

### 5.1 技术 DoD（Review-Tech 评分点）

- [ ] D-009 §2.4 七项强制要求**逐条**在 `dev-server-bootstrap.md` 里有对应章节
- [ ] **每一步都有"执行 / 验证 / 预期输出"三件套**（缺一不可 · 这是本卡最硬指标）
- [ ] 所有命令块标注运行身份（root / admin user）
- [ ] 所有命令标注幂等性等级（🟢🟡🔴）
- [ ] 所有敏感值走占位变量 · 真值不入仓
- [ ] 关键变更配回滚路径（至少 SSH 端口 / ufw 默认拒绝 / nginx 上线三处）
- [ ] `infra/` 下模板脚本**不含**真实密钥、真实 IP、真实域名
- [ ] `.env.production.example` 新增的 DEV_SERVER_* 字段与 D-009 §2.5 对齐（命名一致）
- [ ] 自签证书 CN 为 `dev.costra.cloud`（将来 COSTRA-115 解 DNS 后可直连）· 有效期 ≥ 365 天
- [ ] 备份脚本模板有 shell 语法校验通过标记（Agent 能力内：用 `bash -n` 或 shellcheck 静态校验）

### 5.2 安全 DoD（手册内容红线）

- [ ] 手册明示最终态：SSH 22 端口不监听 · 仅新端口可达
- [ ] 手册明示：新 SSH 端口**仅 key 登录** · `PasswordAuthentication no`
- [ ] 手册明示：`PermitRootLogin no`
- [ ] 手册明示：ufw 默认拒绝入站 · 仅放行 `${SSH_PORT}/tcp`、`80/tcp`、`443/tcp`
- [ ] 手册在任何步骤**不出现**真实密钥、真实 IP（均以占位符）
- [ ] 手册 §Prerequisites 明示"执行前 Human 需本地生成 ssh keypair 并妥善保存私钥"

### 5.3 可维护 DoD

- [ ] 文档头部写"最后更新时间 / Owner / 版本 / 适用 OS"四行元数据
- [ ] Appendix B "SSH 完全锁死挽救"步骤详细到**腾讯云控制台第几个菜单第几个按钮**（Agent 可查官方文档 · 不需真机空跑）
- [ ] Appendix C 明确标注 2026-07-23 到期 · 给出三种迁移方向（续费 / 云托管 / Lighthouse）各自利弊矩阵
- [ ] Appendix D OS 差异补丁至少覆盖 Ubuntu 22.04（主）+ Debian 12 + CentOS Stream 9 三个发行版的关键命令差异

### 5.4 Human 可执行性 DoD（🆕 本次新增 · Review-Tech 必查）

- [ ] **"思想执行"走查通过**：Review-Tech 假装自己是 Human 从头到尾照文档跑一遍 · 每步是否有歧义 / 缺失前置 / 命令依赖未装的包 / 变量未定义
- [ ] **变量收口**：所有出现在命令里的 `${VAR}` 都在 Appendix A 模板里有对应条目，无一遗漏
- [ ] **命令"纯拷贝可跑"级**：不存在"请将 xxx 替换为你的 yyy 后执行"这种需要脑内替换的命令 · 统一走 `${VAR}` + 手册开头 `export VAR=...` 引导
- [ ] **验证命令只读无副作用**：Review-Tech 逐条检查验证命令不会改变服务器状态
- [ ] **预期输出可机读**：能让 Human 肉眼一秒对比通过 / 失败 · 避免"看上去差不多就行"式描述

---

## 6. 工作流 / 执行阶段（🆕 简化为两段）

### 6.1 · DevOps-Agent 写手册（approve-card 后 4~6h）

- 按 §4.1 章节框架落地 `docs/devops/dev-server-bootstrap.md`
- 每步严格"三件套"
- `infra/` 下全部模板脚本一次性交付
- 用 `bash -n` / `shellcheck` 对 shell 脚本静态校验（Agent 能力内）
- 写完 `git commit` · 触发 D-014-b 产出 Review

### 6.2 · Review-Tech Round N 循环

- D-014-b 自动 60 秒内拉起 Round 1
- Review-Tech 按 §5 四类 DoD 全量走查
- REVISE → DevOps-Agent 按 D-015 `revise-round-N` 修复
- 上限 5 轮 · 触顶 ESCALATE Human
- 全绿 → 走 T1 准入 Human 终审

### 6.3 · Human T1 终审

- Human 发 `approve:COSTRA-114`
- COSTRA-114 进 Done · STATE/board 更新
- **是否真机按手册执行由 Human 自行决定**：
  - 若 Human 执行：发现手册问题 → 起 follow-up 卡修补（不回滚本卡）
  - 若 Human 暂不执行：手册先作为规程沉淀 · COSTRA-102 真机联调前再执行即可

**原 §6.1.b "真机执行阶段" 已删除**。

---

## 7. 失败 / 异常路径

| 场景 | 处理 |
|---|---|
| 手册写到一半发现 D-009 §2.4 某项在 Ubuntu 22.04 官方文档里没有推荐实现路径 | pause + 呼 Human 裁定（是降级方案 / 换 OS 假设 / 加 follow-up） |
| Appendix B 挽救路径查腾讯云官方文档仍不确定 | 允许在手册里写"此路径未实机验证 · Human 首次触发时实测后补丁本附录"· 不阻断本卡 |
| 某模板脚本 shellcheck 报 warning 但功能正确 | 允许 · 但需在脚本头注释声明忽略原因 |
| COS 备份脚本在 Human 实际执行时失败（权限 / 额度） | 不阻断本卡 · Human 发 follow-up 卡 COSTRA-114-F1 处理 |
| 2026-07-23 到期迁移决策延迟 | 本卡不兜底 · Orchestrator 在 2026-07-16 主动提醒 Human |

---

## 8. 依赖与下游

**上游**（均已就绪）：
- D-009 域名 + 服务器决议 ✅
- COSTRA-113 SUBJECT 配置加载器 ✅

**下游解锁**：
- COSTRA-102（MiniApp 真机登录端到端 · 04-30 Human 验收）— **弱依赖**（需 Human 在 COSTRA-102 开始前把手册真机执行一遍 · 不过这步动作由 Human 自己做 · 本卡 approve 即解锁）
- COSTRA-115（DNS 子记录 · 04-25 deadline）— 独立卡 · 可并行跑
- COSTRA-108（miniprogram-ci 上传演练）— 独立卡 · 不依赖本卡
- COSTRA-104（`/entries` CRUD · Sprint-1 后半）— 弱依赖

---

## 9. 时间盒与节奏

| 节点 | 时间 | 产物 |
|---|---|---|
| Human 审卡定义（revise 第 2 轮） | 2026-04-24 13:14 → 等 approve-card | 本卡 dispatch 定版 |
| §6.1 手册 + 模板交付 | approve-card 后 4~6h | `dev-server-bootstrap.md` + `infra/` 模板脚本 |
| Review-Tech Round 1 | D-014-b 自动 60s 内拉起 | Round 1 报告 |
| Round N 循环（D-011 上限 5） | - | 每轮 revise + 产出 Round N+1 |
| Human T1 终审 | Review 全绿 | `approve:COSTRA-114` |

**总预算**：≤ **28h 46m**（deadline 04-25 18:00）· 缓冲：手册 + Review 链 ≤ 20h · 终审 ≤ 4h · 缓冲 ≥ 4h

**较原版节省**：删除"真机执行 6h"段（Agent 做不到 · 原本也不该排进本卡时间盒）

---

## 10. Reviewer 视角清单（给 Review-Tech / Human 的检查项摘要）

1. 每步"三件套"（执行 / 验证 / 预期输出）是否齐全？
2. 手册是否能由"未见过本服务器、只知道 IP 和 root 密码的 Human"独立跑通？
3. D-009 §2.4 七项是否**逐条落地且每项都有自己的验证命令**？
4. 所有破坏性操作是否有回滚路径？
5. 所有 `${VAR}` 是否在 Appendix A 有对应条目？
6. 验证命令是否都是只读（不会改变服务器状态）？
7. Appendix B 控制台挽救路径是否具体到菜单级？
8. Appendix C（R-017 到期迁移）是否给出可对比的选项矩阵？
9. Appendix D（OS 差异）是否覆盖主流三个发行版？
10. 是否存在任何需要 Agent 真机执行才能完工的 TODO？（若有则违反本卡前提 · 必须全部转化为"Human 按手册执行时自行确认"）

---

## 11. 工程纪律回顾

- D-012 铁律：单卡交付即提交 · 本卡完工后立即 `git commit`
- D-015 触发词：Review-Tech 有异议 · 走 `revise-round-N` 三合一语义 · 异议由 Review-Tech 在 Round N+1 二裁
- 敏感文件：真 IP / 真 key / 真密码 **一律**不入仓 · 走 `Appendix A`（本地文件）或 `infra/secrets.vault`
- 密钥管理：严格按 D-009 §2.4 · systemd EnvironmentFile 或 docker secret · 本卡先出样例模板
- **Agent 能力边界**：本卡确立惯例 · 所有涉及真机 / 真服务的 DevOps 卡一律"Agent 写手册 + Human 执行" · 不再假设 Agent 有真机访问权

---

## 12. SOP 漂移说明（I-002 · 2026-04-24 13:04 · 沿用）

**冲突三方**：
1. `.team/SOP-CARD-REVIEW.md §2` 分流表明确 "DevOps-Agent → Review-Tech"
2. `.team/agents/07-review-agent-tech.md §1` 明确 "你**不审** PM / Design / **DevOps** / QA 的产出"
3. `.team/SOP-CARD-REVIEW.md §8.2` 历史卡豁免（本卡 D-009 §3 派生 2026-04-23 13:00 · 早于 D-014 立案 22:26）

**Human 裁定（13:04）**：选项 C · Human 直审卡定义。

**后续动作**：
1. 本卡按 Human 直审走
2. 登记 I-002
3. **Sprint-1 末立 D-016 决议**修订
4. D-016 落地前 · 所有 DevOps 卡定义统一走 Human 直审

---

## 13. 修订历史

| 版本 | 时间 | 修订人 | 修订点 |
|---|---|---|---|
| v1 | 2026-04-24 13:04 | Orchestrator | 初稿 · 默认 Agent 可真机执行（错） |
| **v2** | **2026-04-24 13:14** | **Orchestrator（Human revise 触发）** | **更正前提：Agent 无真机权限 · 本卡交付=可执行手册本身 · 删除 §6.1.b 真机执行阶段 · 新增"每步三件套"强制格式（§4.1）+ Human 可执行性 DoD（§5.4）+ Appendix D OS 差异补丁 + §0 能力边界铁律段** |
| **v2-approved** | **2026-04-24 13:49** | **Human** | **`approve-card:COSTRA-114` · v2 放行无进一步修订 · DevOps-Agent 进 §6.1 写手册阶段 · 能力边界铁律（§0）正式生效全 DevOps 卡族（COSTRA-115/108/117 起按此模板）** |

---

## 14. 签字栏

- Orchestrator（起草 v1）：2026-04-24 13:04
- Orchestrator（修订 v2）：2026-04-24 13:14
- **Human（卡定义审批）：✅ `approve-card:COSTRA-114` 2026-04-24 13:49 放行**
- DevOps-Agent（接单开干）：🟢 已接单 · 进 §6.1 写手册阶段（预计 ~19:30 交付初稿至 `docs/ops/dev-server-bootstrap.md`）
- Review-Tech（§6.2 产出审 · D-014-b 自动触发）：⏳ 等 Agent 交付 · ⚠️ I-002 余留：产出 Review 归属需 Human 交付时再裁
- Human（T1 准入终审）：⏳ 等 `approve:COSTRA-114`
- Human（自行真机执行 · 不在本卡验收范围）：自主决定时机
