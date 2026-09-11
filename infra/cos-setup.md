# COS 对象存储配置（导入导出文件 · staging/prod 独立桶）

> 状态：**已在腾讯云完成平台配置（2026-09-10）**，等代码落地（`docs/design/cos-offload-phase1-import-export.md`）接入。
> 用途：记录 Costra 一期导入导出文件 COS 化的腾讯云实际配置，作为代码落地与运维的事实源。
> 关联：`docs/design/cos-offload-phase1-import-export.md`、`docs/design/cos-offload-analysis.md`
>
> ⚠️ **密钥纪律**：SecretId/SecretKey **不入库、不入镜像明文、不进聊天记录**，只存在于两台机器的 `/data/conf/server.env`（0600）。本文档一律用占位符。

---

## 1. 实际配置一览

| 维度 | prod | staging |
|------|------|---------|
| 机器 | `49.235.216.20` | `106.54.173.55` |
| 桶地域 | `ap-shanghai`（上海） | `ap-shanghai`（上海） |
| 桶名 | `costra-prod-cos-1309318695` | `costra-staging-cos-1309318695` |
| 访问权限 | 私有读写 | 私有读写 |
| 自定义下载域名 | `cos.costra.cloud` | `cos.stg.costra.cloud` |
| DNSPod CNAME | ✅ 建在 `costra.cloud` 域主机记录 `cos` | ✅ 建在 **`stg.costra.cloud` 子域**主机记录 `cos`（见 §5.3） |
| HTTPS 证书 | ✅ `ah4MWOg7`（到期 2026-12-09） | ✅ `ah3y5VTJ`（到期 2026-12-09） |
| 通路验证 | ✅ curl 回 403（2026-09-10） | ✅ curl 回 403（2026-09-10） |
| 微信 downloadFile 白名单 | `cos.costra.cloud` 已加 ✅ | `cos.stg.costra.cloud` 已加 ✅ |
| 生命周期规则 | 对象 30 天后删（留档观察 · 用户可见过期由 DB 保证） | 同 prod |

- **APPID = `1309318695`**（桶名后缀 · 腾讯云控制台账号信息可查）。
- **为什么独立桶**：权限 / 生命周期 / 误删 / 成本统计全部环境隔离；staging 可随意压测清空不影响 prod。
- **为什么桶内不再加环境前缀**：独立桶已隔离环境，桶内对象直接 `exports/...`、`reports/...`。

## 1.1 落地决策（2026-09-10 拍板）

| 决策点 | 结论 | 理由 |
|--------|------|------|
| **生命周期天数** | COS **30 天**后删（留档观察） | 用户可见的「1 天过期」由应用层 DB `file_expires_at`（24h）保证，先于签发预签名 URL 拦截返回 `410`；COS 30 天只负责最终清理，给排查留窗口。两层职责分离。⚠️ 因对象留 30 天，`removeJobArtifacts`（重试清场删旧分片）改 COS `deleteObject` 后更关键，否则失败重试的旧分片会在 COS 堆 30 天。 |
| **预签名 URL 时效** | **Expires = 300s**，**每个分片单独签发**（现取现用） | 现有客户端本就逐分片 `downloadWithAuth`，两步下载天然按分片粒度组织；单分片最大 ~900KB 在 staging 1Mbps 下 ~8s 下完，300s 有 30× 冗余；URL 用完即弃泄漏窗口小。整任务一次签发（方案 B）省的那次 RTT 是几十字节 JSON，非带宽瓶颈，不值得换来长时效泄漏窗口。URL 失效兜底：`wx.downloadFile` 拿 COS 403 ⇒ 重新调 `/download` 换新 URL 重试一次。 |
| **sha256 权威源** | 以 **`/download` 返回的 sha256** 为准 | 校验值必须与「这次要下载的文件」同源同刻——`/download` 那一刻从 DB 读出 URL + sha256，指向同一 COS 对象，逻辑上不会不一致；列表 `files[].sha256` 是历史快照，任务被重试/重新生成时会漂移，用它校验会误报失败。列表 sha256 保留展示/调试，不作客户端校验基准。 |

## 2. CAM 子账号与密钥

- 子账号用户名：`costra-cos-user`（仅编程访问）。
- 绑定自定义策略（仅限这两个桶的最小权限）：

```json
{
  "version": "2.0",
  "statement": [
    {
      "effect": "allow",
      "action": [
        "cos:PutObject",
        "cos:GetObject",
        "cos:DeleteObject",
        "cos:DeleteMultipleObjects",
        "cos:HeadObject"
      ],
      "resource": [
        "qcs::cos:ap-shanghai:uid/1309318695:costra-prod-cos-1309318695/*",
        "qcs::cos:ap-shanghai:uid/1309318695:costra-staging-cos-1309318695/*"
      ]
    }
  ]
}
```

- 权限说明：`PutObject`（worker 写 CSV 分片）、`GetObject`（预签名下载底层）、`Delete*`（worker 重试清场删旧分片，对应 `entryExport.ts` `removeJobArtifacts` 改造后行为）、`HeadObject`（可选校验对象存在）。**故意不授** `ListBucket`/`PutBucketACL` 等。
- 一期用子账号永久密钥（最小权限）；STS 临时密钥留待二期收紧。

> ⚠️ **密钥泄露处置**：若 SecretId/SecretKey 曾出现在聊天/日志/代码等非 `server.env` 位置，须立即在 CAM 禁用该对密钥、新建一对并只写入 `server.env`。

## 3. 对象 Key 组织约定（代码落地按此写）

```
桶内（prod / staging 各自独立）
  exports/<yyyy-MM>/<jobId>_<part>.csv          ← 导出分片
  staging/<yyyy-mm>/<detectId>.rows.ndjson.gz   ← 导入规范化行产物（隐私 · 导入成功即删）
  reports/<yyyy-mm>/<detectId>.report.csv       ← 导入报告
```

## 4. 服务端环境变量（写入 /data/conf/server.env · 两机各一套）

### prod（`49.235.216.20`）
```bash
COS_SECRET_ID=<COS_SECRET_ID>
COS_SECRET_KEY=<COS_SECRET_KEY>
COS_REGION=ap-shanghai
COS_BUCKET_EXPORTS=costra-prod-cos-1309318695
COS_DOWNLOAD_BASE=https://cos.costra.cloud
```

### staging（`106.54.173.55`）
```bash
COS_SECRET_ID=<COS_SECRET_ID>            # 可复用同一子账号（策略含两桶）
COS_SECRET_KEY=<COS_SECRET_KEY>
COS_REGION=ap-shanghai
COS_BUCKET_EXPORTS=costra-staging-cos-1309318695
COS_DOWNLOAD_BASE=https://cos.stg.costra.cloud
```

- 与现状 `JWT_SECRET`/`WX_APP_SECRET` 同一注入范式（`docker-compose.prod.yml` 从 `/data/conf/server.env` 注入）。
- 改完确认 `chmod 0600 /data/conf/server.env`；代码落地后 recreate server 容器才生效。

> ⚠️ **预签名 SignHost 一致性**：服务端签发预签名 URL 的域名必须与客户端实际访问域名一致（即 `COS_DOWNLOAD_BASE`），否则 COS 403。签名时须带对应自定义域名 Host，不能用 myqcloud 默认域名。

## 5. 平台通路验证（代码落地前可先验）

```bash
# DNS 生效
dig +short cos.costra.cloud
dig +short cos.stg.costra.cloud

# 自定义域名 HTTPS 可达 + 桶私有（未签名访问应 403 而非域名不可达/证书错）
curl -I https://cos.costra.cloud/exports/probe.csv       # 预期 403 AccessDenied
curl -I https://cos.stg.costra.cloud/exports/probe.csv   # 预期 403 AccessDenied
```

预期 **403（`Server: tencent-cos`）** = 桶私有 + 自定义域名 + HTTPS 全通（403 是想要的成功信号，非故障）。

### 5.1 排障：curl 时好时坏 / 偶发 SSL 证书不匹配
现象（2026-09-10 prod 实测）：同一条 `curl -I https://cos.costra.cloud/...` 连续执行，一次返回 `403`（正常），一次报 `SSL: no alternative certificate subject name matches target host name`。

根因：COS 自定义域名 CNAME 解析到**多个接入节点/多 IP**（`dig` 可见 `...cos.ap-shanghai.myqcloud.com` + `sh.file.myqcloud.com` + 多个 IP），curl 每次可能连到不同节点。**自定义域名的 HTTPS 证书刚部署时，未在全部接入节点同步生效**——已加载新证书的节点回 403，尚未加载的节点用 COS 默认证书（SAN 无 `cos.costra.cloud`）⇒ curl 拒绝握手。属证书全网灰度，通常几分钟~几十分钟自动一致。

排查命令：
```bash
# 逐 IP 定位哪个节点缺证书
curl -I --resolve cos.costra.cloud:443:<IP> https://cos.costra.cloud/exports/probe.csv 2>&1 | head -3
# 看证书 SAN 是否含自定义域名（含 = 只是灰度；是 *.myqcloud.com = 该节点未绑自定义证书）
echo | openssl s_client -connect cos.costra.cloud:443 -servername cos.costra.cloud 2>/dev/null | openssl x509 -noout -subject -ext subjectAltName
```
处置：优先等待并复测；若等待后仍稳定失败，回 COS 控制台重新部署自定义域名证书 + 核对 DNSPod CNAME 目标值（应为 COS「自定义源站域名」页给出的那条，清理无关记录）。

### 5.2 排障：staging 域名 dig 空 / Could not resolve host（三级域名主机记录层级坑）
现象（2026-09-10）：`dig +short cos.stg.costra.cloud` 返回**空**，`curl` 报 `(6) Could not resolve host`。而 prod `cos.costra.cloud` 正常。

根因：**不是证书问题，是 DNS 层没配对**。`cos.stg.costra.cloud` 是 `costra.cloud` 域下的**三级域名**，DNSPod 在 `costra.cloud` 域里的主机记录必须填 **`cos.stg`**，而非 `cos`。误填 `cos` 只会生成 `cos.costra.cloud`（prod 那条），`cos.stg.costra.cloud` 无任何记录 ⇒ dig 空。

修复：DNSPod → `costra.cloud` → 新增 CNAME，主机记录 `cos.stg`，记录值填 **staging 桶** COS「自定义源站域名」页给出的 CNAME（`costra-exports-stg-<APPID>.cos.ap-shanghai.myqcloud.com`，勿复制成 prod 桶值），TTL 300。生效后 `dig +short cos.stg.costra.cloud` 应出 CNAME+IP，`curl -I` 回 403。并核对 COS 侧自定义域名确填了 `cos.stg.costra.cloud`、HTTPS 证书已签发（DNS 不通则证书无法验证签发）。

> 主机记录层级速查：`cos.costra.cloud`（二级）填 `cos`；`cos.stg.costra.cloud`（三级）填 `cos.stg`。**但见 §5.3 的子域委派例外**。

### 5.3 排障（根因升级）：stg.costra.cloud 是 DNSPod 独立托管子域 ⇒ cos 记录必须建在子域内
现象（2026-09-10 截图核实）：DNSPod 里 `stg.costra.cloud` 被**单独列为一个托管域名**（"子域名"标记，独立记录管理页），与 `costra.cloud` 分开。用户把 CNAME 建在 `costra.cloud` 域内、主机记录填 `cos.stg`，`dig` 仍返回空。

根因（DNS 子域委派）：一旦 `stg.costra.cloud` 被独立托管，`*.stg.costra.cloud` 的解析权全部交给 `stg.costra.cloud` 域；父域 `costra.cloud` 里的 `cos.stg` 记录**不生效**（被子域委派覆盖）。`cos.stg.costra.cloud` 只认 `stg.costra.cloud` 域里主机记录为 `cos` 的那条。佐证：证书验证记录 `_dnsauth.cos` 正确放在 `stg.costra.cloud` 子域内（故 staging 证书 `ah3y5VTJ` 已签发上线），但 CNAME 却错放在 `costra.cloud` 父域 ⇒ 证书通、CNAME 不通。

修复：
1. DNSPod → **`stg.costra.cloud`**（子域，非 costra.cloud）→ 添加 CNAME：主机记录 `cos`、记录值 `costra-staging-cos-1309318695.cos.ap-shanghai.myqcloud.com`、TTL 600。
2. 删除 `costra.cloud` 域里无效的 `cos.stg` CNAME（避免混淆）。
3. 复测 `dig +short cos.stg.costra.cloud` 出记录、`curl -I` 回 403。

> **通用教训**：判断三级域名主机记录怎么填，先确认该子域是否被 DNSPod 独立托管——独立托管 ⇒ 记录建在子域内、主机记录只填最左段（`cos`）；未独立托管 ⇒ 建在父域内、主机记录填完整前缀（`cos.stg`）。prod `cos.costra.cloud` 因 `costra.cloud` 自身托管无委派，故 `cos` 建在自身域内即通。
> 实际值备忘：prod 桶 CNAME `costra-prod-cos-1309318695...`、staging 桶 CNAME `costra-staging-cos-1309318695...`（同 APPID 1309318695，即桶名后缀）；两桶证书到期 2026-12-09，强制 HTTPS 均"未开启"（预签名走 https:// 显式声明即可，如需可后续开启）。

## 6. 剩余待代码落地项（非平台侧）

见 `docs/design/cos-offload-phase1-import-export.md`：
- worker 落点 `writeFile`→`putObject`；`removeJobArtifacts` 改 COS 删对象（保留重试清场语义）。
- 下载路由 `createReadStream` 直发 → 校验通过后签发预签名 URL 返回 JSON。
- 客户端 `fileTransfer.ts` 两步下载（先带 Bearer 取 URL，再无 Bearer `wx.downloadFile` 直连 COS）。
- 退役 `purge-exports`/`import-staging` 清理脚本；DB `file_expires_at` 判定保留维持 `410`。
