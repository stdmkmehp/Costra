# 微信小程序域名 SSOT（Single Source of Truth）

> **本文件为 Costra 四环境域名唯一真实源**。任何变更必须**同步更新本文件 + `server/api/openapi.yaml servers` + `miniprogram/services/env.ts`**，否则 `pr-check` CI 会红灯 block。
>
> **母决策**：`.team/decisions/D-009-domain-and-dev-server-locked.md`（2026-04-23 Approved）
> **CI 校验脚本**：`scripts/devops/whitelist-check.mjs`（COSTRA-115 · 2026-04-27 落地）
> **本卡**：COSTRA-115 · DevOps-Agent 交付

---

## 1. 四环境域名矩阵（锁定）

| env | domain | record_type | target | status | activation_condition |
|---|---|---|---|---|---|
| prod | `costra.cloud` | A | `49.235.216.20` | 🟢 已注册 · A 已配 · ICP 受理中 | 已生效 |
| dev | `dev.costra.cloud` | A | `49.235.216.20` | 🟡 待创建 | ICP 下证前仅文档记录 · 下证后在腾讯云 DNS 后台创建子记录 |
| stg | `stg.costra.cloud` | A | `49.235.216.20`（Sprint-2 末若迁预发专用机则改 IP） | 🟡 Sprint-2 末启用 | ICP 下证后 + Sprint-2 末决策启用 |
| api | `api.costra.cloud` | CNAME | `costra.cloud.`（或 A 直指 IP · 看 nginx 部署） | 🟡 ICP 下证后启用 | ICP 下证后 + 配入微信\"服务器域名\"白名单 |

> 📎 **微信小程序 request 白名单特殊性**：
> - 白名单只接受 **HTTPS + 已备案域名**
> - 因此 `dev.costra.cloud` 不进白名单（开发期用\"不校验合法域名\"模式过渡 · D-009 §2.3 方案 A）
> - 只有 `api.costra.cloud` + 未来的 `api-staging.costra.cloud`（见 §1.1）进白名单

### 1.1 预发 API 子域名补充说明

`server/api/openapi.yaml servers` 中使用的 `api-staging.costra.cloud` 为预发专用 API 入口，由 `stg.costra.cloud` 通过 nginx server_name 分流或独立 CNAME 实现：

| env | server URL（代码中 apiBaseUrl） | DNS 条目 |
|---|---|---|
| local | `http://localhost:8080/v1` | 本机 loopback · 无 DNS |
| dev-ip | `http://49.235.216.20:8080/v1` | 直连 IP · ICP 下证前过渡 · OpenAPI 保留 · env.ts 不暴露 |
| staging | `https://api-staging.costra.cloud/v1` | `api-staging.costra.cloud` CNAME → `costra.cloud.`（Sprint-2 末启用） |
| prod | `https://api.costra.cloud/v1` | `api.costra.cloud` CNAME → `costra.cloud.`（ICP 下证后启用） |

> ⚠️ 本文件 §1 矩阵列的是 **4 个根域 / 子域规划**；§1.1 表列的是**运行期实际 URL**（含 IP 直连一条）。CI 校验脚本按 §1.1 做三方对账，§1 为 Human 可读的 DNS 管理视图。

---

## 2. DNS 记录类型与 TTL 建议

| 域名 | 类型 | 指向 | TTL 建议 | 理由 |
|---|---|---|---|---|
| `costra.cloud` | A | `49.235.216.20` | 600 | 主域 · 已生效 · 变更频率低 |
| `dev.costra.cloud` | A | `49.235.216.20` | 300 | 开发期可能需要快速切换 IP |
| `stg.costra.cloud` | A | `49.235.216.20`（Sprint-2 末定） | 300 | 同上 |
| `api.costra.cloud` | CNAME | `costra.cloud.` | 600 | 生产入口 · 通过 nginx 反代 |
| `api-staging.costra.cloud` | CNAME | `costra.cloud.` | 300 | 预发入口 |

---

## 3. 与 CI 对账的三方事实源

本文件作为 SSOT 与以下两源做三方一致性校验（CI 脚本 `scripts/devops/whitelist-check.mjs`）：

| 源 | 路径 | 提取字段 |
|---|---|---|
| ① OpenAPI servers | `server/api/openapi.yaml` L22-30 | `url` 列表 |
| ② MiniApp env | `miniprogram/services/env.ts` | `apiBaseUrl` 字面量 |
| ③ 本文件（SSOT） | `infra/wechat/domains.md` §1.1 | env → url 映射 |

对账规则：
- OpenAPI servers 必须 ⊇ env.ts apiBaseUrl 集合（OpenAPI 可多一条 dev-ip 过渡条目）
- env.ts apiBaseUrl 每一条必须在本文件 §1.1 表中有对应行
- 任一方向不一致 → CI exit 1 + 打印 diff

---

## 4. Human 操作清单（ICP 下证后执行 · 对齐 COSTRA-114 v2 §4.1 三件套格式）

> **🚨 Agent 无 DNS 服务商 / 微信公众平台后台访问权**。本节为 Human 在 ICP 下证后（约 20 工作日）按步执行的手册。

### Step 4.1 · 腾讯云 DNS 后台创建三条子记录

**前置**：
- 已登录腾讯云控制台 · 账号有 `costra.cloud` 域名管理权
- 已在 DNSPod 或腾讯云 DNS 解析中确认 `costra.cloud` 管理权

**执行**（在浏览器中操作 · 无 CLI）：
1. 进入 DNSPod → 域名列表 → `costra.cloud` → 记录管理
2. 添加记录 ① · 主机记录 `dev` · 类型 `A` · 记录值 `49.235.216.20` · TTL `300`
3. 添加记录 ② · 主机记录 `stg` · 类型 `A` · 记录值 `49.235.216.20` · TTL `300`
4. 添加记录 ③ · 主机记录 `api` · 类型 `CNAME` · 记录值 `costra.cloud.`（注意末尾句点） · TTL `600`
5. 添加记录 ④ · 主机记录 `api-staging` · 类型 `CNAME` · 记录值 `costra.cloud.` · TTL `300`

**验证**（在本机终端）：
```bash
dig +short dev.costra.cloud        # 预期: 49.235.216.20
dig +short stg.costra.cloud        # 预期: 49.235.216.20
dig +short api.costra.cloud        # 预期: costra.cloud. 再 49.235.216.20
dig +short api-staging.costra.cloud  # 预期: costra.cloud. 再 49.235.216.20
```

**预期输出**：每条 `dig` 命令在 DNS 缓存生效（最多 TTL 秒 · 约 5-10 分钟）后返回对应 IP 或 CNAME 链。

### Step 4.2 · 微信公众平台填写服务器域名白名单

**前置**：
- ICP 备案已下证 · 有备案号
- `api.costra.cloud` + `api-staging.costra.cloud` HTTPS 证书已签发（Let's Encrypt）
- 已登录微信公众平台 · 账号为 Costra 小程序管理员

**执行**（浏览器操作）：
1. 进入公众平台 → 开发管理 → 开发设置 → 服务器域名
2. `request 合法域名` 填：
   - `https://api.costra.cloud`
   - `https://api-staging.costra.cloud`（Sprint-2 末启用）
3. `uploadFile 合法域名` 填：同上（如需要上传头像/凭证）
4. `downloadFile 合法域名` 填：同上（如需要下载资产）
5. 保存 · 等待微信后台审核（即时生效）

**验证**：
- 微信开发者工具 → 关闭"不校验合法域名"开关
- 真机调试关掉调试模式
- 触发一次 `wx.request({ url: 'https://api.costra.cloud/v1/healthz' })` · 预期成功返回而非 `request:fail url not in domain list`

**预期输出**：白名单填写后 CI 下一次 PR 的 `ci/pr-check → Whitelist Consistency Check` 不会因此变化（因 CI 只校验代码内三方一致 · 不 fetch 微信后台 API · 见 §5 已知限制）。

### Step 4.3 · 告知 Orchestrator 关闭 R-013

执行完 §4.1 + §4.2 后，在对话里说 `done:R-013 ICP filing` 或类似 · Orchestrator 会：
- 关闭 `.team/risks.md R-013`
- 更新 `infra/wechat/domains.md §1` 的 status 列从 🟡 改 🟢
- CI 校验脚本的对账基线自动通过（因代码侧已早就对齐 · 本卡已落地）

---

## 5. 已知限制 & 后续规划

### 5.1 本卡未实现

- ❌ **自动 fetch 微信\"服务器域名\"白名单 API 对账**：微信公众平台当前无开放 API 提供白名单查询，只能通过浏览器人工查看；本卡仅做代码三方对账，白名单填写由 Human 执行 + §4 操作清单兜底
- ❌ **实际 DNS 子记录创建**：Agent 无 DNS 后台访问权，由 Human 按 §4.1 执行

### 5.2 后续 FU

- **FU-115-WECHAT-WHITELIST-ALERT**：Sprint-2 可考虑增加一个告警机制 · 例如每周 CI 定时 job 用 curl `https://api.costra.cloud/v1/healthz` 验证白名单实际生效（间接证明白名单已填） · 本卡不做
- **FU-115-DNS-MONITORING**：DNS 解析 latency / 可用性监控（Sprint-3 APM 卡合并）

---

## 6. 变更日志

| 日期 | 变更 | 卡号 |
|---|---|---|
| 2026-04-27 | 首次落地（四环境域名矩阵 + §1.1 运行期 URL + §4 Human 操作清单 + §3 三方对账规则） | COSTRA-115 R1 |
