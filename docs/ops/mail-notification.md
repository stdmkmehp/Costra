# Costra · 告警邮件发送技术规范（curl SMTPS → QQ 邮箱中继）

> **状态**：✅ 链路已实测走通（2026-08-14 · 机器② 端到端投递成功）· 已固化为 `infra/scripts/lib/mail.sh`（2026-08-16 从 `report-error-logs.sh` 抽取为公共库 · 供全部邮件消费方复用）
> **日期**：2026-08-14
> **适用机器**：机器②（costra-prod-slave）已实测；机器①（prod）465 出站**待复验**（§2.4）
> **消费方**：后续 `report-error-logs.sh`（每日错误日志扫描推送）及任何需要邮件告警的运维脚本
>
> **本文是"发邮件"这一子方案的唯一事实源**。完整 error-report 方案（日志扫描 / 增量 offset /
> 聚合降噪 / cron 接入）另行实现，实现时邮件发送部分照本文 §3 执行，不要重新探索。

---

## §0 关键结论（先看这 5 条）

1. **方案 = curl 原生 SMTPS → `smtp.qq.com:465`，且必须带 `--login-options 'AUTH=LOGIN'`**。
   零新增安装（curl 系统自带），无 msmtp/postfix 依赖。
2. **465 出站未被腾讯云封**（机器②实测 TCP/TLS/投递全通）；**25 出站被封死**，任何方案都不走 25。
3. **QQ 的 XMail 与 curl 默认的 `AUTH PLAIN` 不兼容**：EHLO 宣告支持 PLAIN，但收到合法凭据后
   回第二个 `334`（"重试"怪癖而非标准 535），curl 报 `(67) Login denied`。**这是本方案最大
   的坑**，症状极具迷惑性（凭据明明是对的）。显式 `AUTH=LOGIN` 后一切正常。
4. **邮件文件必须 CRLF 行尾**（`printf '%s\r\n'` 生成，heredoc/编辑器存出的 LF 可能被拒或
   格式错乱）；**中文 Subject 必须 RFC 2047 编码**；**信封发件人（MAIL FROM）必须等于
   SMTP_USER**，否则 QQ 拒收（550）。
5. **凭据只走 env 文件（0600）+ 环境变量**，键名 `SMTP_*` / `MAIL_*`，绝不进仓库
   （当前用的授权码已在沟通中明文出现过，正式配置前必须重新生成，见 §6）。

---

## §1 选型记录与已排除路线

| 路线 | 结论 | 原因 |
|---|---|---|
| **curl SMTPS 465（本方案）** | ✅ 采纳 | 零安装、已实测、与现有 `_notify`（webhook）同形态（一次 curl 调用） |
| 587 + STARTTLS | 备用变体 | 语法不同（`smtp://` + `--ssl-reqd`，见 §4），465 不通时切换 |
| msmtp / mailx | 备选 | 需 yum 装包 + `/etc/msmtprc`，无必要不引入 |
| SendCloud / Resend HTTPS API | 备选 | 零安装但需注册服务商 + 配发信域名；免费额度到件率一般 |
| 本地 postfix 直发 | ❌ 否决 | 无 PTR/SPF/DKIM 必进垃圾箱，还要管邮件队列，运维负担最重 |
| 25 端口直连任何中继 | ❌ 否决 | 腾讯云轻量平台级封 25 出站（可申请解封，但没必要） |
| Telegram bot | ❌ 否决 | 国内服务器不可达 |
| 企业微信 webhook | 并行通道 | 已有实现（`check-replication.sh` `_notify`），可与邮件同时启用 |

QQ 邮箱侧前提：**设置 → 账号 → SMTP 服务已开启**，并生成**授权码**（非 QQ 登录密码）。
注意：**重新生成授权码会使旧码立即失效**。

---

## §2 实测记录（2026-08-14 · 机器② `costra-prod-slave`）

### 2.1 网络与 TLS
- `smtp.qq.com:465` TCP 连接 ✓、TLS 1.3 握手 ✓、证书链校验 ✓（DigiCert，`*.mail.qq.com`）。
- 服务器 banner：`220 ... XMail Esmtp QQ Mail Server`；EHLO 宣告 `AUTH LOGIN PLAIN XOAUTH XOAUTH2`。

### 2.2 失败样本（curl 默认 AUTH PLAIN）
```
> AUTH PLAIN
< 334
> <base64(authzid\0user\0pass)>     ← 报文格式正确（已解码核对）
< 334                               ← XMail 不回 235/535，回第二个 334
curl: (67) Login denied
```
结论：不是凭据问题，是 PLAIN 交互兼容性问题。

### 2.3 成功样本（openssl 手工 AUTH LOGIN 隔离变量）
```
openssl s_client -connect smtp.qq.com:465 -quiet -crlf
EHLO test
AUTH LOGIN
MTYyODI4NDUyMEBxcS5jb20=          ← base64(SMTP_USER)
cG5x...                             ← base64(授权码)
235 Authentication successful
```
随后 curl 加 `--login-options 'AUTH=LOGIN'` 重发：`250 Ok: queued as ...`，收件箱确认收到。

### 2.4 待办：机器①复验
error-report 计划跑在机器①（prod 主库机）。部署前把 §3.3 的成功命令**在机器①原样跑一次**，
确认其 465 出站同样放行（同云同区域大概率一致，但需实证）。

---

## §3 实现规范（后续脚本照此写）

### 3.1 配置键与读取

env 文件（`/data/conf/report.env`，0600 · 独立于 `server.env`，授权码不混进应用配置）约定键：

```dotenv
SMTP_HOST=smtp.qq.com
SMTP_PORT=465
SMTP_USER=<发件邮箱>
SMTP_PASS=<授权码>          # 非 QQ 密码；重新生成即旧码失效
MAIL_FROM=<发件邮箱>         # 必须 == SMTP_USER
MAIL_TO=<收件邮箱>           # 多收件人用逗号分隔
```

读取模式对齐 `check-replication.sh` 的 `WECOM_WEBHOOK_URL`：**环境变量优先**，为空时再
`grep '^KEY=' "${REPORT_ENV_FILE}" | tail -1 | cut -d= -f2-`（`REPORT_ENV_FILE` 默认
`/data/conf/report.env`，可用 `COSTRA_ERROR_REPORT_ENV_FILE` 覆盖）。`SMTP_PASS` 为空 →
邮件通道整体禁用（只写日志），与 webhook 未配置时的语义一致。

### 3.2 邮件文件构造（CRLF 是硬要求）

```bash
# LF → CRLF 的可靠做法（正文每行逐一处理）
{
  printf '%s\r\n' "From: ${MAIL_FROM}"
  printf '%s\r\n' "To: ${MAIL_TO}"
  printf '%s\r\n' "Subject: ${encoded_subject}"   # 中文见下
  printf '%s\r\n' "Date: $(date -R)"
  printf '%s\r\n' 'Content-Type: text/plain; charset=utf-8'
  printf '%s\r\n' ''
  sed 's/$/\r/' "${body_file}"                     # 正文整体 LF→CRLF
} > "${eml_file}"
```

**中文 Subject 必须 RFC 2047 编码**，否则乱码或被拒：

```bash
encoded_subject="=?UTF-8?B?$(printf '%s' "${raw_subject}" | base64 | tr -d '\n')?="
```

（`printf '%s'` 不带 `\n`；base64 输出的换行也要去掉。）ASCII 主题可直接用原文。

### 3.3 发送命令模板

```bash
# 多收件人：按逗号拆分，每个地址一个 --mail-rcpt
curl --ssl-reqd --silent --show-error --max-time 15 \
  --url "smtps://${SMTP_HOST}:${SMTP_PORT}" \
  --login-options 'AUTH=LOGIN' \
  --user "${SMTP_USER}:${SMTP_PASS}" \
  --mail-from "${MAIL_FROM}" \
  --mail-rcpt "${recipient}" ... \
  --upload-file "${eml_file}"
```

成功判定：**curl 退出码 0** 即可（SMTP 会话任一环节失败 curl 都非零退出）。
需要更强校验时捕获 `-v` 的 stderr 找 `250 Ok: queued as`。

### 3.4 失败语义约定

- 发送失败**不阻断**主任务：`log_warn` + 继续（对齐 `_notify` 的"告警通道故障不拖累业务检查"）。
- `--dry-run`：构造 eml 并打印头部预览，**不真正发送**。
- 临时 eml 文件用 `mktemp`，用完即删。

---

## §4 排障手册

| 现象 | 原因 | 处置 |
|---|---|---|
| connect 超时 / timeout | 465 出站被拦 | 换 587 变体（§4.1）；仍不通则该平台 SMTP 不可达，回退 webhook |
| `curl: (67) Login denied`，且日志里是第二个 `334` | **漏了 `--login-options 'AUTH=LOGIN'`** | 补上（本方案最大的坑，见 §0.3） |
| `535 Login Fail` | 授权码失效 / SMTP 服务未开启 | QQ 邮箱设置里确认服务开启，重新生成授权码（旧码即废） |
| `550`（MAIL FROM 阶段） | 信封发件人 ≠ SMTP_USER | 令 `MAIL_FROM == SMTP_USER` |
| `SSL certificate problem` | 本机 CA 问题 | 诊断可加 `-k`，**生产配置禁止 `-k`** |
| 发送成功但收不到 | 进了垃圾箱 / QQ 对数据中心 IP 风控 | 先查垃圾箱并加白名单；疑风控时在本机（家庭宽带 IP）跑同一命令对照——本机通则 QQ 路对该服务器 IP 不可用，转 163/企业邮/webhook |
| `--login-options: unrecognized option` | curl 太老（< 7.34） | 升级 curl；或用 §5 的 openssl 手工会话兜底 |
| 中文主题乱码 | 未做 RFC 2047 编码 | 见 §3.2 |

### 4.1 587 备用变体（STARTTLS，语法不同）

```bash
curl -v --ssl-reqd \
  --url "smtp://${SMTP_HOST}:587" \
  --login-options 'AUTH=LOGIN' \
  --user "${SMTP_USER}:${SMTP_PASS}" \
  --mail-from "${MAIL_FROM}" --mail-rcpt "${recipient}" \
  --upload-file "${eml_file}"
```

注意：587 用 `smtp://` + `--ssl-reqd`；465 用 `smtps://`。两者混用必失败。

---

## §5 openssl 手工调试套路（隔离"凭据问题 vs 客户端问题"的金标准）

```bash
printf '%s' "${SMTP_USER}" | base64   # 不带换行
printf '%s' "${SMTP_PASS}" | base64

openssl s_client -connect smtp.qq.com:465 -quiet -crlf
# 交互逐行输入：
EHLO test
AUTH LOGIN
<base64 用户名>
<base64 授权码>
QUIT
```

- `235 Authentication successful` → 凭据与账号完好，问题在客户端调用方式。
- `535 ...` → 凭据问题（重新生成授权码）。
- 连不上 / 无 banner → 网络问题（出站被拦）。

---

## §6 安全

1. **授权码 = 密码**。只写 0600 的 env 文件，绝不进仓库、不进脚本源码、不进命令行历史
   （正式脚本从 env 读，不在命令行内联）。
2. 本方案探索阶段的授权码曾在沟通中明文出现，**正式配置前在 QQ 邮箱重新生成**（旧码即废）。
3. env 文件注释独占一行（项目红线），`SMTP_PASS` 行尾严禁内联注释。

---

## §7 首个消费方：error-report（已实现 · 2026-08-14）

`infra/scripts/report-error-logs.sh` 是本邮件通道的首个消费方（每日 09:00 扫
/data/logs ≥error 级日志并推送），由 `maintenance.sh error-report` 委托、cron 调度
（`docs/db/maintenance-cron-plan.md` §4）。实现要点与本文档的对应关系：

- 发送照 §3 执行（`smtps://` + `--login-options 'AUTH=LOGIN'` + CRLF + RFC 2047 主题）；
- 通道可插拔：`SMTP_USER/SMTP_PASS/MAIL_TO` 任一为空即禁用（只写日志、退出码 0），
  与 `WECOM_WEBHOOK_URL` 语义一致；后续脚本要接邮件通道直接复用同一组 env 键；
- **零命中也推送"平安邮件"**（心跳语义：连续收不到平安邮件本身即说明任务/通道挂了）；
- 报告按日志类别分节，每类配额 4KB 封顶（防单类刷屏挤掉其他类别），全局正文另设
  16KB 双保险（远低于 QQ `SIZE 73400320`）；
- 增量扫描用 **inode 追踪**（状态 `path|dev:ino|offset` + stat 比对）而非 size 倒挂猜测，
  copytruncate/rename/手工 truncate 三类轮转场景均有无遗漏或诚实告警（fixture 已验证）；
- `--test-send` 子命令即 §2.4 的 465 出站验证手段（机器① 部署时先跑它）；
- 部署步骤：机器① 新建 `/data/conf/report.env`（0600）写入 `SMTP_*`/`MAIL_*` 六键
  （授权码重新生成，旧码已暴露）→ `./maintenance.sh error-report --test-send` 冒烟
  → `./maintenance.sh install-cron` 重装 cron
  → 确认 `timedatectl` 时区为 Asia/Shanghai（cron 09:00 按系统时区）。

未验证项（目前告警量级下无影响，先不证）：QQ 免费邮箱的日发送频率/额度上限。

---

## §8 消费方与公共库（2026-08-16 起）

发送实现已从 `report-error-logs.sh` 抽取为公共库 **`infra/scripts/lib/mail.sh`**
（本文 §3 的代码化：`mail_load_config` / `mail_channel_ready` / `mail_build_eml` /
`mail_send_eml` / `mail_deliver`）。后续脚本接邮件通道一律 source 该库，不再各自
复制发送逻辑；发送行为要改，先改本文再改库。当前消费方：

| 消费方 | 用途 | 调度 |
|---|---|---|
| `report-error-logs.sh` | /data/logs ≥error 级日志扫描推送（§7） | 每日 09:00（`maintenance.sh error-report`） |
| `monitor-perf.sh` | 宿主机性能时序采集 + 24h/7d 汇总推送 | 每小时 03 分 collect · 每日 07:13 report（`maintenance.sh perf-collect`/`perf-report`） |
