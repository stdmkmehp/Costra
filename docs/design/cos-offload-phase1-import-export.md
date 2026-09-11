# 一期 COS 化方案：账本导入导出文件迁移对象存储

> 状态：**v0.2 · 可施工（平台侧已就绪 + 三决策已拍板 + 缺口纠偏，待代码落地）**
> 日期：2026-09-10 v0.1 → 2026-09-11 v0.2
> 上游：`docs/design/cos-offload-analysis.md` v0.5（两类静态产物 COS 化可行性分析，P1 头像 / P2 导入导出）
> 平台事实源：`infra/cos-setup.md`（腾讯云实际配置 · 两独立私有桶 + 自定义域名 + CAM + 生命周期 + 三条 DNS/证书排障）
> 关联：`docs/design/avatar-image-component-design.md`（头像组件方案，**本期不做**，见 §1）
>
> **本期范围界定**：只做**尚未上线的账本导入导出文件** COS 化；**头像 COS 化本期不做**。理由见 §1。
> **v0.2 变更**：①纳入平台侧已就绪事实（§5.1 改为"已完成"引 `infra/cos-setup.md`）；②纳入三个已拍板决策（生命周期 30 天 / 预签名 300s 每分片签发 / sha256 以 /download 为准，见 §4）；③纠正 4 个 v0.1 缺口（§4.4 `removeJobArtifacts` 保留语义改 COS 删、§4.6 客户端 COS 错误分支、§5.2 导入侧三类产物全貌、§5.4 单测注入点，见 §5/§6）；④补 `importJobs.ts` report 路由与 `entryImport.ts` 导入侧改造细节（v0.1 仅"同范式"带过，实际复杂度显著更高）。
> 事实源（代码）：`server/src/routes/dataJobs.ts`、`server/src/routes/importJobs.ts`、`server/src/services/entryExport.ts`、`server/src/services/entryImport.ts`、`server/src/repositories/importDetectRepo.ts`、`miniprogram/services/fileTransfer.ts`、`miniprogram/pages-family/settings/data-management/index.ts`、`infra/docker-compose.prod.yml`、`server/package.json`
> 事实源（COS 官方）：腾讯云 COS Node.js SDK 快速入门（`cloud.tencent.com/document/product/436/8629`）、预签名 URL 访问 COS（`.../436/68284`）、生成预签名 URL（`.../436/35153`）

---

## 1. 本期为什么只做导入导出、不做头像

上游可行性分析把静态产物 COS 化拆成两类，二者**改造模型截然不同**：

| 维度 | 头像（本期**不做**） | 导入导出文件（本期**做**） |
|------|---------------------|--------------------------|
| 上线状态 | **已上线**，是不可丢失的重要数据 | **尚未上线**，无任何存量 |
| 历史存量 | 有：`/data/uploads/avatars/*` 全量用户头像 | **无**：产物 24h TTL，无历史包袱 |
| 兼容包袱 | 大：老客户端无降级逻辑，须**始终双写 + 双 URL 客户端降级**（`avatar_url` 恒本地作兼容锚点、新增 `avatar_cos_url` 旁路），并需存量迁移脚本 + 客户端 10+ 处改造（建议抽 `avatar-image` 组件收敛） | **无**：可直接一步切 COS |
| 复杂度 | 高：双写策略、存量正则回填、契约加字段、9 处头像渲染的组件化降级 | 中：改存取落点 + 下载改预签名 + 客户端下载链路调整 |

**结论**：头像方案（`avatar-image-component-design.md` + 上游 §4）为兼容历史数据背负了双写、双 URL 降级、存量迁移、组件化收敛等一整套复杂度，风险与工作量都显著更高。本期先把**没有历史包袱、可一步到位**的导入导出文件迁走，用它验证 COS 接入范式（建桶、密钥、SDK、预签名、生命周期），为后续头像迁移铺路。头像 COS 化留待后续独立评估上线。

---

## 2. 为什么要把导入导出文件迁到 COS（收益）

Costra 全部服务跑在**单台腾讯云 Lighthouse**，出口带宽是**套餐固定硬顶**：**prod 2Mbps（≈250KB/s）/ staging 1Mbps（≈125KB/s）**，无弹性，一旦打满所有共享该出口的在线请求一起变慢。

- **导出/导入报告是"重"的下行流量**：单个导出 CSV 分片 ~500KB~900KB（`entryExport.ts` 双阈值 5000 行 / 900KB），多分片任务累计可达数 MB，下载经 Fastify → nginx `/v1/` 反代出口，**与 sync/pull 等在线 API 争抢同一条固定带宽**。
- **已实锤后果（2026-09-09 排查）**：真机导出页曾出现所有轻量 API 精确 10s 超时刷屏；nginx `error.log` 同时段连续 `upstream response is buffered to a temporary file`（上游发得比客户端收得快），全是大 CSV 分片下载——双端同账号触发"全分片并行预下载"约 3MB 并发，**打满 staging 1Mbps 出方向**，同窗口 `/data-jobs` 轮询与 `/sync/pull` 挤不出响应而硬超时。
- **磁盘与运维**：产物落容器本地盘（bind mount 到宿主机 `/data/exports`、`/data/import-staging`），需自维护 24h purge 定时清理 + 空月目录回收。

**本质收益**：这些产物是"冷"的、可弹性分发的内容，天然适合对象存储。迁到 COS 后，把突发大文件下载流量与**固定带宽解耦**，磁盘与清理运维一并剥离，改为 COS 按量存储 + 生命周期自动清理。与上游 `response-compression-design.md`（Fastify gzip 省 JSON API 字节）**正交互补**——一个针对二进制/CSV 大文件，一个针对 JSON API。

---

## 3. 现状事实（代码级证据）

### 3.1 服务端：私有产物，Fastify 鉴权直发
- **导出 CSV**（元数据定位方式 A · 月目录 + 命名约定）：`entryExport.ts` 写 `EXPORT_DIR`（默认 `/var/costra/exports`）`/<yyyy-MM>/<jobId>_<part>.csv`，`.tmp`→rename 原子写，逐分片对内存 Buffer 算 `sha256`/`size_bytes`；分片双阈值 5000 行 / 900KB（`entryExport.ts:38-51`）。**下载路由靠 `result_summary.storage_month` + `<jobId>_<part>.csv` 拼路径**（`dataJobs.ts:358`），DB 不存完整路径。
- **导入产物**（元数据定位方式 B · **绝对路径存库**，与导出不同）：`entryImport.ts` `writeDetectArtifacts` 用**同步 `writeFileSync`**（非导出的 async fs）写 `IMPORT_STAGING_DIR`（默认 `/var/costra/import-staging`）`/<yyyy-mm>/`，产**两类文件**：
  - `.rows.ndjson.gz`（gzip 隐私产物 · 0600）：worker `readDetectArtifactRows` 事务外读回做导入（`entryImport.ts:296`），**导入成功即 `deleteDetectFile` 删**（隐私最小化 §7.4，`:445`）。
  - `.report.csv`（问题报告 · 0600）：仅当有 error/warning 时产出（`:184`）；报告独立 24h `report_expires_at`。
  - **关键差异**：`importDetectRepo` 把 **`artifactPath`/`reportPath` 完整绝对路径写库**（`:589-591`），report 下载路由直接 `fs.stat(session.reportPath)` + `createReadStream(session.reportPath)`（`importJobs.ts:612/625`）——**不是**导出那种"月目录 + 命名"拼接。COS 化时这两列语义须从"本地绝对路径"改为"COS object key"。
- **下载路由**（均 **JWT 鉴权 + 任务归属校验** + `createReadStream` 磁盘直发 + `Content-Disposition` 附件 + 显式 `Content-Length` + 路由级 `compress:false`）：
  - `GET /v1/data-jobs/{id}/download?part=N`（`dataJobs.ts:325-375`）：校验 succeeded/未过期/分片存在，另发 `X-Content-Sha256` 头；磁盘产物被清理 ⇒ `410 EXPORT_FILE_EXPIRED`。
  - `GET /v1/import-detect-sessions/{id}/report`（`importJobs.ts:588-627`）：校验 `reportPath` 非空 + `reportExpiresAt` 未过期；**过期/缺文件一律 `404`**（非 410——报告寿命与会话 commit 有效期已解耦，见 `:604-608` 注释），**无 `X-Content-Sha256` 头**（导入报告下载现状不校验 sha256）。
  - `GET /v1/import-jobs/demo-csv`（`importJobs.ts:371-373`）：**内存生成不落盘**、量小。
- **清理（3 处 · COS 化须全部对齐）**：①导出 worker 重试前 `removeJobArtifacts` 清旧分片 + 空月目录（`entryExport.ts:160-190`）；②导入 commit 成功删 `.rows.ndjson.gz`（`:445`）；③导入 reaper 清僵尸/过期会话的 artifact + report 并 `clearArtifactPath`/`clearReportPath`（`:614-634`）。DB 侧 `file_expires_at`（导出）/`report_expires_at`（导入报告）判定是用户可见过期语义。

### 3.2 客户端：`fileTransfer.ts` 带鉴权下载
- `downloadWithAuth`（`fileTransfer.ts:158-192`）自带闭环：发起前 `ensureFreshToken`（临期续签）→ `wx.downloadFile` **强制注入 `Authorization: Bearer`**（`:142` `wxDownload`）→ 401 刷 token 重放一次 → 非 200 读临时文件里的错误体 `classifyDownloadErrorBody` 分类。
- `wx.downloadFile` 打 `env.apiBaseUrl` 的相对路径；`onProgress` 依赖 `Content-Length`；成功后 `verifyFileSha256` 强校验（`:198-215`）。
- **三处调用点**（`data-management/index.ts`）：导出分片 `downloadWithAuth({path: file.downloadPath})` + `verifyFileSha256(_, file.sha256)`（`:690-696`）；导入报告 `downloadWithAuth({path: report.reportPath})`（`:735`，**无 sha256 校验**）；示例 `downloadWithAuth({path: demoCsvPath})`（`:776`）。三者下载后都 `prepareCsvShareDraft` 转 `.csv` 草稿分享。
- 真机硬约束：分享须先 `prepareCsvShareDraft` 复制到带 `.csv` 后缀的本地草稿，`sharePreparedCsv` 必须在 tap 手势同步栈内调用（`:294-360`）。

### 3.3 COS 现状（v0.2 更新：平台侧已就绪）
- **代码侧**：全仓库仍**零对象存储集成**（无 SDK 依赖、无客户端封装）。属从零接入。
- **平台侧已完成**（2026-09-10，详见 `infra/cos-setup.md`）：两独立私有桶 `costra-prod-cos-1309318695` / `costra-staging-cos-1309318695`（ap-shanghai）、自定义下载域名 `cos.costra.cloud` / `cos.stg.costra.cloud`（DNS+HTTPS 已验 curl 回 403）、CAM 子账号 `costra-cos-user` 两桶最小权限、生命周期 30 天、微信 downloadFile 白名单已加两域名。

---

## 4. 一期目标形态

> 因未上线、无存量、无兼容包袱 ⇒ **直接把「存储 + 读取」全部改为 COS，删除本地落盘与 purge，不搞双写过渡**（这是相对头像方案最大的简化）。

### 4.0 三个已拍板决策（2026-09-10 · 详见 `infra/cos-setup.md` §1.1）
| 决策 | 结论 | 落地含义 |
|------|------|---------|
| 生命周期 | COS **30 天**留档观察 | 用户可见「过期」由 DB `file_expires_at`(导出 24h) / `report_expires_at`(导入报告 24h) 保证，先于签发 URL 拦截；COS 30 天只兜底清理。**因对象留 30 天，重试清场（§4.4）必须删旧 COS 对象，否则堆积。** |
| 预签名时效 | **Expires = 300s** + **每分片单独签发** | `/download?part=N` 每次只签发该分片 URL，现取现用；不整任务一次签发（省的是几十字节 JSON RTT，非带宽瓶颈）。 |
| sha256 权威源 | 以 **`/download` 返回值** 为准 | 校验值与 URL 同源同刻；列表 `files[].sha256` 仅展示不作校验基准（避免任务重试后快照漂移误报）。 |

### 4.1 存储链路（worker 落点：本地写盘 → COS putObject）
```
worker 生成产物
  → 对内存 Buffer 算 sha256 / size_bytes（不变）
  → putObject 到 COS 对应私有 bucket（prod/staging 独立桶）：
       导出分片       exports/<yyyy-MM>/<jobId>_<part>.csv
       导入报告       reports/<yyyy-mm>/<detectId>.report.csv
       导入隐私产物   staging/<yyyy-mm>/<detectId>.rows.ndjson.gz   ← 详见 §5.2（导入成功即删）
  → 元数据存 COS object key（不再存本地路径/绝对路径）：
       导出：result_summary.storage_month 保留（仍作 key 前缀拼接，与命名约定一致）
       导入：importDetectRepo 的 artifactPath/reportPath 两列语义改为「COS object key」
     sha256/size 计算不变
```

### 4.2 下载链路（Fastify 直发 → 预签名 URL 两步下载）
```
1) GET /v1/data-jobs/{id}/download?part=N   （导入报告为 GET /import-detect-sessions/{id}/report）
     → 服务端 JWT + 任务归属 + 未过期校验（沿用现有逻辑，先于签发拦截）
     → 校验通过 ⇒ getObjectUrl 签发 300s 预签名 URL（每分片单独签发）
     → 200 { url, size_bytes, sha256, filename }   （sha256 此处为权威源）
2) 客户端两步下载：
     a. request（带 Authorization）调 /download 取 { url, sha256, ... }
     b. wx.downloadFile(url)  // 直连 COS，【绝不带 Authorization】
     → COS 返回 Content-Length（进度正常）
     → verifyFileSha256(tempFilePath, 步骤 a 返回的 sha256)   // 权威源改为 /download 返回值
     → COS 403（URL 过期）⇒ 重新走步骤 a 换新 URL 重试一次（§4.6 新增错误分支）
```
> **导入报告特例**：现状 report 下载**无 sha256 校验**（`index.ts:735` 不校验），且过期一律 `404`。COS 化后 report 的 `/report` 可选择是否补 sha256——保持现状不校验最小改动，也可顺带补上（施工时定，见 §5.2）。

### 4.3 私有语义 ⇒ 必须预签名
导出/报告含用户全量流水，**不能公有读**（桶已设私有读写）。服务端在校验 JWT + 任务归属 + 未过期后，签发**短时效预签名 URL**，把鉴权留在 Costra、把流量交给 COS。预签名要点（官方核验）：
- `getObjectUrl` 在 Node SDK 目前**仅回调式**，需 Promise 化；参数 `Sign:true` + `Method:'GET'` + `Expires:300`。
- 预签名默认把请求域名算入签名（`SignHost`）——**必须用自定义域名 `COS_DOWNLOAD_BASE`（`cos.costra.cloud`/`cos.stg.costra.cloud`）签名并访问，签名域名与访问域名一致**，否则 403。不能用 myqcloud 默认域名（且客户端白名单也只加了自定义域名）。
- 有效期 300s：URL 一次性下载入口，失效则客户端重新调 `/download` 换新（§4.6 兜底）。

### 4.4 过期清理交给 COS 生命周期（保留重试清场，仅改删除介质）
- COS 桶配「30 天自动删」（`infra/cos-setup.md` 已设），**退役 purge-exports / purge-import-staging 定时脚本**。
- DB 侧 `file_expires_at`（导出）/`report_expires_at`（导入报告）判定**保留**（先于签发 URL 拦截，维持导出 `410 EXPORT_FILE_EXPIRED` / 导入报告 `404` 语义）。
- **⚠️ 纠正 v0.1「旧分片清理整体移除」**：以下 3 处清场**逻辑保留、仅把 `fs.rm`/`unlink` 换成 COS `deleteObject`/`deleteMultipleObject`**，不能整体删除（否则重试残留对象在 COS 堆 30 天）：
  1. `entryExport.ts` `removeJobArtifacts`（重试前清 `<jobId>_*` 旧分片）：改为按 key 前缀 `deleteObject`（不再需要读目录/删空目录）。
  2. `entryImport.ts` commit 成功删 `.rows.ndjson.gz`（`:445`）：改 COS `deleteObject`。
  3. `entryImport.ts` reaper 清僵尸/过期会话 artifact+report（`:614-634`）：改 COS `deleteObject` + 保留 `clearArtifactPath`/`clearReportPath` DB 清位。

### 4.5 demo-csv 维持现状不迁
`GET /v1/import-jobs/demo-csv` 内存生成、不落盘、量小，**无磁盘/寿命问题**，维持 Fastify 直发不迁。

### 4.6 客户端两步下载 + COS 错误分支（v0.1 缺口纠偏）
- **新增无鉴权下载分支**：现有 `wxDownload`（`fileTransfer.ts:138-152`）恒注入 `Authorization: Bearer`，直连 COS 时**多带头会触发 COS 签名 403**。须拆一条**不带 header** 的 `wxDownloadNoAuth(url)`。
- **两步封装**：新增 `downloadViaPresign({ presignPath })` = ① `request`（带 Bearer）调 `/download` 取 `{url, sha256, ...}` → ② `wxDownloadNoAuth(url)` → ③ `verifyFileSha256(_, sha256)`。三处调用点（导出分片/导入报告/示例）迁到此路径（demo-csv 仍是 Costra 直发，走原 `downloadWithAuth`）。
- **COS XML 错误分支**：第二步失败时错误体是 **COS XML（非 Costra JSON 契约）**，现有 `classifyDownloadErrorBody` 解析不了。新增分支：`wx.downloadFile` 返回 403/COS 错误 ⇒ 视为**预签名过期**，自动重走步骤 ① 换新 URL 重试一次；再失败才报错引导用户重试。

---

## 5. 改造清单

### 5.1 平台侧（✅ 已完成 · 2026-09-10 · 详见 `infra/cos-setup.md`）
1. ✅ 两独立私有桶 `costra-prod-cos-1309318695` / `costra-staging-cos-1309318695`（`ap-shanghai`，与 Lighthouse 同区，私有读写）。
2. ✅ CAM 子账号 `costra-cos-user`（仅编程访问）+ 两桶最小权限策略（`PutObject`/`GetObject`/`DeleteObject`/`DeleteMultipleObjects`/`HeadObject`）；密钥走 `/data/conf/server.env` 注入。
3. ✅ 自定义下载域名 `cos.costra.cloud` / `cos.stg.costra.cloud` + HTTPS（curl 验回 403，链路全通）。
4. ✅ 微信 downloadFile 合法域名已加 `cos.costra.cloud` / `cos.stg.costra.cloud`。
5. ✅ 生命周期规则 30 天（留档观察，用户可见过期由 DB 保证 · §4.0/§4.4）。

### 5.2 服务端
1. **新增 COS 依赖与单例**：`server/package.json` 加 `cos-nodejs-sdk-v5`；新增 `server/src/services/cosClient.ts` 惰性单例（对齐 `getPool()`/`getRedis()` 范式），读 `COS_SECRET_ID/KEY/REGION/BUCKET_EXPORTS/DOWNLOAD_BASE` 环境变量；封装 `putObject`/`deleteObjects`/`presignGet(key, 300)`（Promise 化 `getObjectUrl`，用 `COS_DOWNLOAD_BASE` 作 SignHost）。
2. **导出 worker 改造**（`entryExport.ts`）：`flushPart` 由 `.tmp`+rename 本地写 **改 putObject**（key=`exports/<yyyy-MM>/<jobId>_<part>.csv`）；sha256/size 对内存 Buffer 算（不变）；`removeJobArtifacts` 由读目录 `fs.rm` **改 COS 按前缀 `deleteObjects`**（保留重试清场语义，去掉空目录回收）；下载路由不再用 `getExportRootForTests` 拼盘路径。
3. **导入 worker 改造**（`entryImport.ts` · 比导出复杂，三类产物）：
   - `writeDetectArtifacts` 的 `.rows.ndjson.gz` + `.report.csv` 由同步 `writeFileSync`+rename **改 putObject**（key=`staging/...rows.ndjson.gz`、`reports/...report.csv`）；`importDetectRepo` 的 `artifactPath`/`reportPath` 两列**语义改为存 COS object key**（不再是本地绝对路径）。
   - `readDetectArtifactRows`（worker 事务外读回隐私产物做导入）由 `readFileSync` **改 COS getObject 取 Buffer**（sha256 校验逻辑不变）。
   - `deleteDetectFile`（commit 成功删隐私产物 + reaper 清过期）由 `unlink` **改 COS `deleteObject`**。
4. **删除本地存储脚手架**：`EXPORT_DIR`/`IMPORT_STAGING_DIR` env、`setExportRootForTests`/`getExportRootForTests`、`getImportStagingRoot`/`__resetImportStagingRootForTests`、空目录回收整体移除；`docker-compose.prod.yml` 撤 `/var/costra/exports`、`/var/costra/import-staging` 两个 bind mount 卷（`/var/costra/uploads` 头像卷**保留**——本期不动头像）。
5. **下载路由改造**：
   - `/data-jobs/:id/download`（`dataJobs.ts`）：校验（succeeded/未过期/分片存在/归属）后，**签发该分片 300s 预签名 URL**，返回 JSON `{ url, size_bytes, sha256, filename }`；去掉 `createReadStream`/`Content-Disposition`/`Content-Length`/`X-Content-Sha256`/`compress:false`；`410 EXPORT_FILE_EXPIRED`（DB 判定）保留，`404`（未就绪/归属）保留。
   - `/import-detect-sessions/:id/report`（`importJobs.ts`）：同上签发预签名 URL 返回 JSON；**保留 `404`（reportPath 空/`report_expires_at` 过期，非 410）语义**；sha256 是否补入 JSON 由施工定（现状不校验，最小改动可不补，见 §4.2 特例）。
6. **清理退役**：删 `purge-exports`/`purge-import-staging` 定时脚本（`infra/scripts/` 及 crontab 引用）；DB `file_expires_at`/`report_expires_at` 判定保留。
7. **demo-csv 不动**（§4.5）。
8. **OpenAPI 同步**：`/data-jobs/{id}/download`、`/import-detect-sessions/{id}/report` 响应从「二进制流 + 头」改为 JSON `{url,...}` schema；`import-detect-sessions` report 若补 sha256 一并登记。

### 5.3 客户端
1. **拆无鉴权下载分支**（`fileTransfer.ts`）：新增 `wxDownloadNoAuth(url)`（**不带任何 header**）；保留现有 `wxDownload`（带 Bearer）供 demo-csv 走原路径。
2. **新增两步下载封装** `downloadViaPresign({ presignPath, onProgress })`：① `request`（带 Bearer）调 presignPath 取 `{url, sha256, size_bytes, filename}` → ② `wxDownloadNoAuth(url)` → ③ `verifyFileSha256(_, sha256)`（**sha256 用步骤①返回值，权威源**）；COS 403 ⇒ 重走①换新 URL 重试一次（§4.6）。
3. **三处调用点迁移**（`data-management/index.ts`）：导出分片（`:690`）、导入报告（`:735`，报告若不下发 sha256 则跳校验）迁到 `downloadViaPresign`；示例（`:776`）走 demo-csv 保持原 `downloadWithAuth`。`prepareCsvShareDraft`/分享/`.csv` 后缀/`onProgress` 逻辑不变（COS 直下仍返回 `Content-Length`）。
4. **错误分类扩展**：`classifyDownloadErrorBody` 增 COS XML 错误体识别（或在 `downloadViaPresign` 内先判 statusCode=403 触发换 URL 重试，不进通用 JSON 分类）。

### 5.4 测试（v0.1 缺口纠偏 · 明确注入方式）
- **COS 客户端测试替身**：`cosClient.ts` 暴露可覆盖注入点（如 `__setCosForTests(fake)`，对齐现有 `setExportRootForTests` 范式但改为注入内存 COS 替身）；替身实现 `putObject`（存内存 Map）/`getObject`（取回 Buffer）/`deleteObjects`/`presignGet`（返回可断言的假 URL）。
- `entryExport`/`entryImport` 单测由「写真实临时目录 + 读文件」改为断言 **object key + 内存替身内容 + sha256**；下载路由单测断言返回 JSON `{url,...}` 而非流响应头。
- 移除对 `getExportRootForTests`/`getImportStagingRoot` 的测试依赖。
- 服务端**当前无 `importJobs` 路由测试**（既有缺口，本期不强制补，但导入侧改动大，建议至少补 report 下载签发 URL 的 happy path）。

---

## 6. 风险与缓解

| 风险 | 缓解 |
|------|------|
| 导入侧改造被低估（三类产物 + 绝对路径存库 + worker 读回 + 3 处清理） | v0.2 已在 §3.1/§5.2 展开；`artifactPath`/`reportPath` 两列语义从绝对路径改 key 是关键，需连带改 `importDetectRepo` 读写与 worker `readDetectArtifactRows` getObject |
| 客户端两步下载 + 去 Authorization + COS XML 错误 | staging 先接，curl/真机验签名 URL 可下、进度正常、sha256 校验通过、403 换 URL 重试生效；两步链路最可控（优于 302 透传） |
| 预签名 SignHost / 域名一致 | 必须用 `COS_DOWNLOAD_BASE` 自定义域名签名与访问（`cos.costra.cloud`/`cos.stg.costra.cloud`），否则 403 |
| 30 天生命周期下重试残留 | §4.4 三处清场保留、改 COS deleteObject，避免旧对象堆 30 天 |
| COS 接入受阻 | **因未上线，无需保留本地直发回退**——直接推迟导入导出功能上线，不影响存量用户 |

---

## 7. 待决问题（v0.2 · 大部分已关闭）
- ✅ ~~bucket 分环境 / 地域~~：独立桶、ap-shanghai 同区（已建）。
- ✅ ~~预签名时效 / 重取策略~~：300s + 每分片签发 + 403 换 URL 重试（§4.0/§4.6）。
- ✅ ~~自定义域名 / 证书~~：`cos.costra.cloud`/`cos.stg.costra.cloud` + HTTPS（已配）。
- ✅ ~~生命周期天数~~：COS 30 天，DB 24h 保证用户可见过期（§4.0）。
- ✅ ~~sha256 权威源~~：以 `/download` 返回值为准（§4.0）。
- ⬜ **密钥模式**：一期子账号永久密钥（已落地）；STS 临时密钥留二期。
- ⬜ **成本实测**：按预估导出下载次数 × 平均大小套 COS 现价，与「升带宽包」定量对比（非阻塞，可上线后观测）。
- ⬜ **导入报告是否补 sha256 校验**：现状不校验，COS 化时决定保持现状（最小改动）或顺带补齐（施工时定）。
