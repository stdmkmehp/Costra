# 静态产物剥离对象存储（COS）可行性分析

> 状态：**v0.5 · 待拍板（可行性评估，非施工方案）**（v0.5：存储形态定稿——**库存两列完整 URL**（`avatar_url` 不动作本地兼容锚点 + 新增 nullable `avatar_cos_url`），放弃相对 key（双 URL 本就是契约字段，key 是多余间接）；存量只回填 `avatar_cos_url` 一列、`avatar_url` 零改；v0.4：始终双写 + 双 URL 客户端降级定稿）
> 日期：2026-09-09（v0.1 → v0.4）→ 2026-09-10（v0.5）
> 触发：账本导入导出文件下载与成员头像下载占用服务器出口带宽与磁盘；prod Lighthouse 出口带宽 2Mbps、staging 1Mbps 是硬顶，大文件（导出 ~500KB）与头像（5~10KB × 多成员）挤占同一带宽，影响 sync/pull 等在线请求。
> 事实源（代码）：`server/src/routes/upload.ts`、`server/src/routes/dataJobs.ts`、`server/src/routes/importJobs.ts`、`server/src/services/entryExport.ts`、`server/src/services/entryImport.ts`、`server/src/repositories/userRepo.ts`、`miniprogram/services/fileTransfer.ts`、`infra/nginx/conf.d/costra.cloud.conf.prod`、`infra/docker-compose.prod.yml`、`infra/scripts/restore-staging-from-prod.sh`、`server/package.json`
> 事实源（COS 官方）：腾讯云 COS Node.js SDK 快速入门（`cloud.tencent.com/document/product/436/8629`，2025-12-24）、使用预签名 URL 访问 COS（`.../436/68284`）、生成预签名 URL（`.../436/35153`，2026-06-11）

---

## 1. 结论摘要

| # | 结论 | 依据 |
|---|------|------|
| C1 | **可行，且收益明确**：两类静态产物（头像、导入导出文件）均可剥离到 COS，把下行流量与磁盘从 Lighthouse 固定带宽/本地盘搬走。带宽剥离是核心价值——2Mbps 固定带宽是硬顶，一个用户下 500KB 导出即挤占全站在线请求 | §2 / §6 |
| C2 | 两类产物**鉴权语义不同，须分别设计**：头像=公有读、URL 已入库、nginx 静态直服；导出/报告=私有（含用户全量流水）、JWT 鉴权、有 24h 寿命。头像走「公有读 bucket/CDN」，导出走「私有 bucket + 预签名 URL」 | §4 / §5 |
| C3 | **头像已上线 ⇒ 始终双写 + 双 URL 客户端降级（用户终版决策）**：服务端本地+COS 始终双写；`avatar_url` **恒指服务器本地**（兼容锚点，**老客户端连新 server 照常从本地拿头像**）；新增 nullable `avatar_cos_url` 旁路下发 COS URL；新客户端 `cos_url||url` 主 src + `binderror` 降级本地。明确不采用 CDN 回源。客户端需改 10+ 处（建议抽 `avatar-image` 组件收敛） | §4 |
| C4 | **导入导出未上线 ⇒ 直接重构（不双写）**：存取全部走 COS，删除本地落盘/purge，一步到位；下载改预签名 URL、清理交 COS 生命周期。收益最大、改造面更大；`wx.downloadFile` 目标域名**必须**进小程序「downloadFile 合法域名」白名单 | §5 |
| C5 | **前置依赖（阻塞项）**：① 开通 COS + 独立域名（COS 默认域名/CDN 域名）并完成 **ICP 备案 + HTTPS**；② 小程序后台配置 downloadFile 合法域名（仅导出下载需要，头像 `<image>` 不需要）；③ 新增 COS SDK 依赖与密钥管理（环境变量，不入库不入镜像明文） | §7 / §8 |
| C6 | **成本模型翻转**：从「固定带宽包硬顶 + 本地磁盘 + 自维护 purge/跨环境 tar 同步」转为「COS 按量存储 + 按量下行流量 + 生命周期自动清理」。以当前量级，COS 流量/存储费预计远低于升带宽包，且把突发流量与固定带宽解耦（本质收益） | §6 |
| C7 | 建议**分两期**：P1 头像（低风险、改动小、先验证 COS 接入范式）；P2 导入导出（收益大、依赖预签名与客户端改造）。两期解耦、可独立上线 | §7.1 |
| C8 | **接入路径已核验**：Node SDK `cos-nodejs-sdk-v5`（putObject 支持 async/await；`getObjectUrl` 仅回调式需 Promise 化，`Sign:true`+`Expires`+`Method:GET` 出预签名下载 URL）；平台侧需建桶（`name-APPID`、选地域、头像公有读/导出私有读写）、CAM 子账号最小权限密钥、自定义域名+HTTPS+ICP、生命周期规则替代 purge | §8 |

---

## 2. 问题原因与背景

### 2.0 为什么会有这个问题（根因）

Costra 的所有服务（Fastify server、nginx、PostgreSQL、Redis）跑在**单台腾讯云 Lighthouse 轻量应用服务器**上，出口带宽是**套餐固定值、且是硬顶**：

- **prod = 2Mbps（≈250KB/s）**、**staging = 1Mbps（≈125KB/s）**（2026-09-09 用户确认）。
- 固定带宽的特性是**没有弹性**：一旦被打满，所有共享该出口的请求一起变慢/排队，不会像云 CDN 那样弹性扩容。

在这条固定管道上，当前有**两类"重"的下行流量**与在线 API（sync/pull、账目查询等）**争抢同一出口**：

1. **账本导出/导入报告文件下载**：单个导出 CSV 分片可达 ~500KB~900KB（`entryExport.ts` 双阈值 5000 行 / 900KB），多分片任务累计可达数 MB；下载经 Fastify → nginx `/v1/` 反代出口。
2. **成员头像下载**：单张 5~10KB，但家庭汇总页/统计页会**批量拉取多个成员头像**，且首次加载/头像变更时是完整传输（nginx `no-cache`，仅"未变"才 304）。

**已实锤的后果（2026-09-09 排查）**：真机导出页曾出现所有轻量 API 精确 10s 超时刷屏；nginx `error.log` 同时段连续多条 `upstream response is buffered to a temporary file`（上游发得比客户端收得快的铁证），全部是大 CSV 分片下载；当时 DevTools + 真机双端同账号在线，各自触发导出页"全分片并行预下载"，~3MB 并发下载**打满 staging 1Mbps 出方向**，同窗口的 `/data-jobs` 轮询与 `/sync/pull` 挤不出响应 → 客户端硬超时。这证明：**静态大文件下载与在线 API 共享固定带宽时，前者会直接拖垮后者**。

**根因归纳**：静态产物（头像、导入导出文件）的下行流量与磁盘占用，本不该占用**应用服务器的固定带宽与本地盘**——它们是"冷"的、可缓存的、可弹性分发的内容，天然适合放对象存储/CDN。当前把它们压在单台 Lighthouse 上，等于用最稀缺的固定带宽去扛最不需要低延迟保证的流量。

### 2.1 磁盘占用现状

三类产物均落**容器本地盘**（docker bind mount 到宿主机 `/data`，`docker-compose.prod.yml:217-228`）：

| 产物 | 容器路径 | 宿主机路径 | 寿命 | 增长特征 |
|------|---------|-----------|------|---------|
| 头像 | `/var/costra/uploads/avatars/` | `/data/uploads` | **永久**（同名覆盖，不累积历史） | 随注册用户数线性增长、无回收 |
| 导出 CSV | `/var/costra/exports/<yyyy-MM>/` | `/data/exports` | 24h + purge | 峰值受并发导出限制，有清理 |
| 导入暂存/报告 | `/var/costra/import-staging/<yyyy-mm>/` | `/data/import-staging` | 报告 24h；行产物导入成功即删 | 同上 |

头像是**唯一无限增长**的一类，长期看会持续吃盘；且 staging 环境要靠 `restore-staging-from-prod.sh` 把 prod 头像 tar 打包再解包同步（`:152-185`），属额外运维负担。

### 2.2 带宽占用现状

- prod 2Mbps / staging 1Mbps 固定硬顶（见 §2.0）。
- 头像虽走 nginx 静态直服（不经 Fastify），但**仍走同一台机器的同一出口带宽**——绕过应用层不等于绕过带宽。
- 导出下载经 Fastify `createReadStream` 流式回源（不阻塞事件循环），但**字节仍要从这条 2Mbps 管道挤出去**。
- 上游相邻方案 `response-compression-design.md`（Fastify gzip）针对的是 **JSON API 的字节数**，对二进制/已压缩的头像图片、CSV 文件收益有限（CSV 可压，但下载路由已刻意 `compress:false` 保 `Content-Length`）——两者针对不同流量构成，**正交互补**。

---

## 3. 现状事实（代码级证据）

### 3.1 头像链路（公有读 · nginx 静态直服）
- 上传：`POST /v1/upload/avatar`（`upload.ts`）→ 魔数校验（JPEG/PNG/GIF/WEBP）→ 写 `UPLOAD_DIR`（默认 `/var/costra/uploads`）`/avatars/<userId>.<ext>`，同名覆盖不累积（`upload.ts:16/130-140`）。
- URL：`https://costra.cloud/uploads/avatars/<userId>.<ext>`（`getUrlBase()` 读 `UPLOAD_URL_BASE`，默认 `https://costra.cloud`，`upload.ts:72-74/142`），**完整 URL 字符串**写入 `users.avatar_url`（`userRepo.ts:280`）。
- 下发：`avatar_url` 在 sync/family-summary/statistics/auth/gm 等**大量响应**里回传（`familySummaryService.ts`、`statisticsRepo.ts`、`authService.ts` 等 65+ 引用）。
- 下载：nginx `location /uploads/` `alias /data/uploads/` **静态直服、不经 Fastify**，`no-cache + etag`（未变返 304）（`costra.cloud.conf.prod:97-108`）。
- 磁盘/运维：头像**永久保留**（无过期）；staging 需从 prod tar 打包恢复（`restore-staging-from-prod.sh:152-185`）。
- **占带宽点**：虽不经 Fastify，但仍走**同一台 Lighthouse 的出口带宽**；304 只在「客户端已缓存且文件未变」时省流，首次加载/头像变更/多成员汇总页仍是完整传输。

### 3.2 导入导出文件链路（私有 · Fastify 鉴权直发）
- 导出 CSV：`entryExport.ts` 写 `EXPORT_DIR`（默认 `/var/costra/exports`）`/<yyyy-MM>/<jobId>_<part>.csv`，`.tmp`→rename 原子写，逐分片算 `sha256`/`size_bytes`；分片双阈值 5000 行 / 900KB（`entryExport.ts:38-51/234-259`）。
- 导入报告 CSV：`entryImport.ts` 写 `IMPORT_STAGING_DIR`（默认 `/var/costra/import-staging`）`/<yyyy-MM>/<detectId>.report.csv`（0600），另有 `.rows.ndjson.gz` 隐私产物导入成功即删。
- 下载：走 Fastify —— `GET /v1/data-jobs/{id}/download`（`dataJobs.ts:326-374`）、`GET /v1/import-detect-sessions/{id}/report`（`importJobs.ts:568-605`）、`GET /v1/import-jobs/demo-csv`（内存生成不落盘，`importJobs.ts:372-419`）。均 **JWT 鉴权 + 任务归属校验**、`createReadStream` 磁盘直发、`Content-Disposition` 附件、显式 `Content-Length`、`X-Content-Sha256`、路由级 `compress:false`。
- 寿命/清理：导出产物 24h `file_expires_at`；过期/purge 后下载返回 `410 EXPORT_FILE_EXPIRED` 或「已清理」；worker 重试前清自己旧分片、空月目录顺手删（`entryExport.ts:181-189`）。
- 客户端：`fileTransfer.ts` `downloadWithAuth` 自带「刷 token → 注入 `Authorization: Bearer` → 401 重放一次 → 错误分类」，`wx.downloadFile` 打 `env.apiBaseUrl` 相对路径，`onProgress` 依赖 `Content-Length`（`fileTransfer.ts:138-191`）。
- **占带宽点**：导出单文件可达 ~500KB~MB 级，经 Fastify + nginx `/v1/` 反代出口，**与 sync/pull 争抢同一 2Mbps**。

### 3.3 COS 现状
- 全仓库**零对象存储集成**（`cos`/`qcloud`/`putObject`/`presign` 等 0 命中）；无 SDK 依赖、无密钥配置。属**从零接入**。

---

## 4. P1 方案：头像迁移 COS（公有读 · 已上线 · 始终双写 + 双 URL 兼容）

> ⚠️ 头像**已上线**、是**不可丢失的重要数据**。**用户决策（2026-09-09 终版）**：**服务端始终双写（本地 + COS），下发双 URL，客户端优先 COS、加载失败降级本地；接受客户端改造，但硬约束是「老客户端连新 server 仍能从服务器本地正常拿到头像」。** 明确**不采用 CDN 回源方案**（对比见 §4.5）。

### 4.1 目标形态（终态）
```
上传 POST /v1/upload/avatar
  → 魔数校验（不变）
  → 始终双写：writeFile 本地 /var/costra/uploads/avatars/<userId>.<ext>
             + putObject COS avatars/<userId>.<ext>（同名覆盖）
  → 返回 { url: <本地URL>, cos_url: <COS URL 或 null> }

下发（/users/me、family-summary、statistics、gm 等 13+ 契约）
  avatar_url     : 恒为服务器本地 URL（costra.cloud/uploads/...）—— 兼容锚点，永不改语义
  avatar_cos_url : COS URL（COS 写成功才有值，否则 null）—— 新增 nullable 旁路字段

客户端 <image>（新版）
  src = avatar_cos_url || avatar_url          // 优先 COS
  binderror → 把该项 src 切回 avatar_url      // COS 失败降级本地
客户端（老版）
  只认 avatar_url → 恒本地 → 完全正常（零感知）
```

### 4.2 兼容性设计（核心 · 保证老客户端连新 server 正常）

**唯一正确做法：`avatar_url` 语义不变（永远指向服务器本地），COS URL 用新增独立字段 `avatar_cos_url` 旁路下发。**

| 字段 | 值 | 老客户端 | 新客户端 |
|------|----|---------|---------|
| `avatar_url`（**语义不变**） | **服务器本地 URL** `costra.cloud/uploads/...` | 照常读 → 走本地 nginx，**行为与现在完全一致** | 作 `binderror` **降级兜底** src |
| `avatar_cos_url`（**新增 nullable**） | COS URL；无 COS 或写失败时 `null` | **忽略未知字段**（JSON 多字段不报错） | 作**主 src** 优先加载 |

- **为什么 `avatar_url` 必须恒为本地（硬约束）**：老客户端**没有任何 `binderror` 降级逻辑**（现网 10+ 处 `<image>` 一处都没有）。若把 `avatar_url` 改成 COS，COS 一旦故障老客户端就是**永久破图**。只有让 `avatar_url` 恒本地，老客户端兼容性才成立——这正是「老客户端连新 server 从本地拿头像」的落地方式。
- **向后兼容性**：新增 `avatar_cos_url` 一律 `nullable: true`、**不进 `required`**。JSON 增字段对新老客户端都安全（老忽略、新可选读）。
- **上传链路已闭环**：`profile-setup` `wx.uploadFile` → `POST /upload/avatar` → `PATCH /users/me`（`profile-setup/index.ts:22-31`、`users.ts:128-132`）。
- **微信合法域名不阻塞**：头像走 `<image>` src，`<image>` 不校验合法域名，无需白名单。

### 4.3 存储形态（定稿：两列完整 URL）

现状 `users.avatar_url` 存**客户端 PATCH 上来的完整 URL 字符串**（`userRepo.ts:280`）。要同时下发本地 + COS 两个 URL：

**定稿：库存两列完整 URL（`avatar_url` 不动 + 新增 `avatar_cos_url`），不引入相对 key。**

理由：`avatar_url`/`avatar_cos_url` 无论如何都要作为**独立字段下发**（双 URL 客户端降级的契约要求）。既然两个完整 URL 本就是契约必需，再引入 `avatar_key` 中间层就是**多余的间接**——为"单一事实源"引入 key↔url 派生，反而不干净。故：

- `users.avatar_url`（**保持不变**）：完整**本地 URL** `https://costra.cloud/uploads/avatars/<userId>.<ext>`。天然满足「兼容锚点恒本地」。
- `users.avatar_cos_url`（**新增 `TEXT` 列，nullable**）：完整 **COS URL**；无 COS / 写失败时 `NULL`。
- 下发层**直接透传两列，不拼前缀、不派生**：`avatar_url` 现有 13+ 处下发代码**一字不改**（读什么发什么），只在需要处补一列 `avatar_cos_url`。

**存量数据处理（`avatar_url` 完全不动，只回填 `avatar_cos_url`）**：迁移脚本先把本地文件 putObject 到 COS，成功后一条幂等 SQL 回填 COS URL——
```sql
-- 值形态规整：登录不写头像（只占位 nickname），唯一写入点是 profile-setup 上传后
-- PATCH 的持久 URL，前缀恒为 <本地域名>/uploads/，无微信外链等杂形态 ⇒ 正则可靠、可重跑。
UPDATE users
   SET avatar_cos_url = regexp_replace(
         avatar_url,
         '^https?://[^/]+/uploads/',   -- 剥掉本地域名 + /uploads/
         'https://<cos-base>/'         -- 换成 COS 域名前缀
       )
 WHERE avatar_url IS NOT NULL;
```
staging 先验证再 prod；`avatar_url` 无需任何改写（它已是正确的本地 URL）。

**为什么放弃相对 key（曾倾向的选项 A）**：相对 key 的唯一卖点是"单一事实源、两 URL 由前缀派生不漂移"，但它要求下发层统一拼 `LOCAL_BASE`/`COS_BASE`、改所有读列代码、且列名与内容语义错位（列叫 url 存 key）。在"两个完整 URL 本就是契约字段"的前提下，这些成本换不来实质收益——两列完整 URL 更直白、下发零改动、存量只回填一列。

### 4.4 平滑上线阶段（每步可回滚、不丢头像）

| 阶段 | 服务端写 | `avatar_url` | `avatar_cos_url` | 客户端 | 本地文件 |
|------|---------|-------------|-----------------|--------|---------|
| **0 现状** | 只本地 | 本地 URL | 无此字段 | 老版读 avatar_url | 唯一源 |
| **1 服务端双写 + 加字段**（老客户端在网） | **本地 + COS** | 恒本地 | COS URL/null | 老版仍只读 avatar_url，正常 | 权威 |
| **1.5 存量迁移** | 双写 | 恒本地 | 存量 putObject 后回填 COS URL | 同上 | 保留 |
| **2 客户端发版** | 双写 | 恒本地 | COS URL | 新版 `cos_url||url` + binderror 降级；老版仍正常 | 保留 |
| **终态** | **始终双写** | 恒本地 | COS URL | 新老并存均正常 | **永久保留**（容灾 + 兜底源） |

要点：
- 服务端双写 + 新增字段**先上**，此时全是老客户端在网，`avatar_url` 恒本地 ⇒ 老客户端零感知；`avatar_cos_url` 老客户端忽略。**这一步就已满足「老客户端连新 server 正常」**。
- 客户端发版后逐步用上 COS 主 src；新老长期并存都正常（老走本地、新走 COS+本地降级）。
- **始终双写、本地永久保留**（用户核心诉求）：本地是容灾源，也是老客户端与新客户端降级的落点。头像总量小（~百 MB 级），磁盘代价可忽略；痛点是带宽——绝大多数流量走 COS 已达成剥离。
- **双写失败策略**：本地写成功即算上传成功；COS putObject 失败仅告警、`avatar_cos_url` 置 null（新客户端自然回落 `avatar_url` 本地）。任何一侧抖动都不致用户设置头像失败。

### 4.5 改造清单

**服务端**
1. `upload.ts`：本地 `writeFile` + COS `putObject` **并行双写**（COS 失败仅告警）；返回 `{ url, cos_url }`。
2. 各下发点（`users.ts`/`familySummaryService`/`statisticsRepo`/`authService`/`gm` 等 13+ 契约）：新增 `avatar_cos_url` 字段（nullable，不进 required）；`avatar_url` 保持本地。OpenAPI 同步 13+ schema。
3. 存储形态（§4.3 定稿）：新增 `users.avatar_cos_url TEXT`（nullable）；`avatar_url` 列保持原样（完整本地 URL）。需一个 migration（下一个编号，见运维记忆）。
4. 存量离线迁移脚本：`/data/uploads/avatars/*` putObject 到 COS 成功后，一条幂等 SQL 回填 `avatar_cos_url`（§4.3 SQL）；staging 先验。`avatar_url` 不动。
5. 密钥：COS 凭据走环境变量注入（§8.2）。

**客户端（新版 · 已接受改造）**
6. 数据结构：头像项 `avatarUrl: string` → `{ url: string, cosUrl: string|null }`（本地 URL 恒有值作兜底）。
7. **强烈建议抽 `avatar-image` 自定义组件**封装「主 src = cosUrl||url + binderror 降级到 url」，替代在 6+ 文件 10+ 处（`mine`/`family`×3/`statistics`×2/`gm`×2/`filter-panel`/`color-picker`…）逐个手写 `binderror` + 列表按 index 回写（易错、后续新增头像点会漏）。**组件完整方案与评估见 `docs/design/avatar-image-component-design.md`（薄组件 + 具名 slot：只封降级，占位符/装饰交调用方 slot；全项目实为 9 处头像渲染，占位符有 4 种形态不可强统一）。**
8. `auth.ts` 会话缓存、`eventBus` ProfileUpdatedPayload 等同步扩 `cosUrl`。

### 4.6 关于 CDN 回源方案（已评估 · 用户决定不采用，存档备查）

曾建议「`avatar_url` 保持单 URL 指向 CDN，CDN 源站优先 COS、故障回源本地 nginx」——优点是客户端/契约零改动、切换对客户端透明、无破图。**用户明确不采用此方案，坚持服务端双写 + 客户端双 URL 降级。** 该决策的已知取舍：客户端需改造 10+ 处（已用 §4.5.7 自定义组件收敛）、契约新增字段（已用 §4.2 向后兼容字段解决）、COS 故障时新客户端有「先失败再降级」的一次破图闪烁（老客户端不受影响，恒本地）。均在可接受范围。

### 4.7 风险/成本
- 中风险：客户端 10+ 处改造（建议组件化收敛）、13+ 契约加字段（向后兼容）、双写失败策略、存量脚本正确性（staging 先验）。
- 兼容性风险低：`avatar_url` 语义不变是硬保证，老客户端零感知。
- 成本：头像小，存储/流量费极低；绝大多数流量走 COS，带宽剥离达成。

### 4.6 风险/成本
- 中低风险：客户端零改动；每阶段可回滚；双写保证不丢数据。主要风险在双写失败策略（§4.3 已定：COS 写失败不阻断）与存量脚本的正确性（staging 先验）。
- 成本：头像小（5~10KB），存储/流量费极低；收益是把多成员汇总页/统计页的头像批量拉取彻底移出固定带宽。

---

## 5. P2 方案：导入导出文件迁移 COS（未上线 · 直接重构，不双写）

> 导入导出**尚未上线、重要性低、产物有 24h TTL** ⇒ **无存量、无兼容包袱**。直接把「存储 + 读取」全部改为 COS，**删除本地落盘与 purge 相关逻辑**，不搞双写过渡（与 P1 头像的关键差异）。

### 5.1 目标形态
```
worker 生成 CSV 分片
  → putObject 到 COS 私有 bucket：exports/<yyyy-MM>/<jobId>_<part>.csv
  → data_jobs.files 存 COS object key（替代/并存本地路径）；sha256/size 不变

客户端下载（两步，替代直发）
  1) GET /v1/data-jobs/{id}/download → 服务端 JWT + 归属校验 → 签发短时效预签名 URL（如 5min）→ 200 { url, size_bytes, sha256 } 或 302 重定向
  2) wx.downloadFile(url)  // 直连 COS，不带 Authorization
  → COS 返回 Content-Length（进度正常）；客户端仍按 X-Content-Sha256/返回 sha256 校验
```

### 5.2 关键判断与难点
- **私有语义 ⇒ 必须预签名**：导出含用户全量流水，不能公有读。服务端在**校验 JWT + 任务归属**后签发**短时效预签名 URL**，把鉴权留在 Costra、把流量交给 COS。
- **客户端下载链路要改**：现有 `downloadWithAuth` 强制注入 `Authorization`，直连 COS 时**不能带**该头（预签名 URL 自带鉴权，多带头可能触发 COS 签名/403）。需新增「先取签名 URL，再无鉴权 `wx.downloadFile`」路径；或服务端 302 重定向（但需确认 `wx.downloadFile` 跟随 302 时不透传 `Authorization` 到 COS，且目标域名已在白名单）。倾向**返回 JSON `{url}` 由客户端二次下载**，链路最可控。
- **微信 downloadFile 合法域名（阻塞前置）**：`wx.downloadFile` 目标域名**必须**在小程序后台「downloadFile 合法域名」白名单，且需 **ICP 备案 + HTTPS**。这是 P2 的硬前置。
- **过期清理交给 COS 生命周期**：设对象生命周期规则（如 1 天后自动删），替代现有 purge-exports/import-staging 定时清理与空目录回收，**磁盘与清理运维一并剥离**。`410 EXPORT_FILE_EXPIRED` 语义保留（`file_expires_at` 仍由 DB 判，先于签发 URL 拦截）。
- **进度条/校验兼容**：COS 直下返回 `Content-Length`，`onProgress` 正常；`sha256` 可放对象元数据或随取 URL 的 JSON 下发，客户端校验逻辑基本不变。
- **demo-csv**：内存生成、不落盘、量小，可**维持现状不迁**（无磁盘/寿命问题，仅少量带宽）。

### 5.3 改造清单（直接重构 · 无本地落盘 · 无双写）
> 因未上线无存量，**一步到位切 COS**，不保留本地路径、不做双写过渡（区别于 P1 头像）。
1. worker 落点：`entryExport.ts`/`entryImport.ts` 由本地 `writeFile`/`.tmp`+rename **改为直接 putObject**；`data_jobs.files`/report 存 **COS object key**（替代本地路径）。sha256/size 计算不变（可对内存 Buffer 算再上传）。
2. **删除本地存储逻辑**：`EXPORT_DIR`/`IMPORT_STAGING_DIR` 及其目录创建、`getExportRootForTests`/`getImportStagingRoot`、空月目录回收、旧分片清理等**整体移除**；`docker-compose.prod.yml` 对应 bind mount 卷（`/var/costra/exports`、`/var/costra/import-staging`）可撤除。
3. 下载路由：`/data-jobs/:id/download`、`.../report` 由「`createReadStream` 直发」改「校验通过后**签发预签名 URL** 返回 JSON `{url, size_bytes, sha256}`」；`compress:false` 排除不再需要（不再由 Fastify 发文件体）；错误码（404 未就绪 / 410 过期 / 归属校验）语义保留。
4. 客户端 `fileTransfer.ts`：新增「取签名 URL → **无 Authorization** `wx.downloadFile`」路径，保留错误分类、`.csv` 后缀落地、分享草稿逻辑。
5. **清理交给 COS 生命周期规则**（对象创建 1 天后自动删）：**退役 purge-exports/import-staging 脚本**；DB 侧 `file_expires_at` 判定保留（先于签发 URL 拦截，维持 `410 EXPORT_FILE_EXPIRED` 语义）。
6. **demo-csv 不迁**：内存生成、不落盘、量小，维持现状直发（无磁盘/寿命问题）。
7. 测试：`entryExport`/`entryImport`/下载路由单测由「写真实临时目录 + 读文件」改为 **mock COS 客户端**（putObject/getObjectUrl 注入内存替身），断言 object key 与签名 URL 而非磁盘文件。
8. 前置：申请域名 + ICP + HTTPS + 小程序 downloadFile 合法域名白名单。

### 5.4 风险
- 中风险：客户端下载链路改造 + 微信白名单前置 + 预签名时效/时钟一致性。
- 缓解：分环境灰度（staging 先接，curl/真机验签名 URL 可下、进度正常、校验通过）。**因未上线，无需保留本地直发回退**——若 COS 接入受阻，直接推迟导入导出功能上线即可，不影响存量用户。

---

## 6. 成本与带宽模型

| 维度 | 现状（Lighthouse 本地） | 迁移 COS 后 |
|------|------------------------|-------------|
| 下行带宽 | 头像+大文件挤占固定 2Mbps（prod）/1Mbps（staging）硬顶，与在线 sync 争抢 | 流量走 COS/CDN，**不占服务器固定带宽**（本质收益） |
| 磁盘 | `/var/costra/{uploads,exports,import-staging}` 本地盘 + purge/空目录维护 | 对象存储弹性容量 + 生命周期自动清理 |
| 运维 | 跨环境头像 tar 同步、purge 定时任务 | bucket 权限 + 生命周期规则，运维面收敛 |
| 计费 | 固定带宽包（硬顶，突发即拥塞） | 按量：存储 GB/月 + 下行流量 GB + 请求数 |

- **本质收益**：固定带宽是硬顶，突发大文件下载会直接拖慢全站在线请求；COS 把突发流量与固定带宽**解耦**。当前量级下 COS 按量费预计远低于升带宽包成本。
- 需一次核算：预估月活头像加载次数、导出下载次数 × 平均大小，套 COS 现价（存储/下行/请求）得月成本，与「升带宽包」做对比后拍板。

---

## 7. 前置依赖清单（阻塞项）

1. 开通 COS bucket：头像=公有读、导出=私有（建议分 bucket）。
2. 域名与备案：COS 自定义域名或 CDN 域名 + **ICP 备案 + HTTPS 证书**。
3. 小程序后台：**downloadFile 合法域名**加导出下载域名（仅 P2 需要；P1 头像 `<image>` 不需要）。
4. 密钥管理：COS SecretId/SecretKey 走环境变量注入，不入库/不入镜像明文。
5. 依赖：引入腾讯云 COS Node SDK（新增 `server/package.json` 依赖）。

### 7.1 分期建议

- **P1 · 头像（已上线，先做）**：始终双写 + 双 URL 客户端降级（§4，`avatar_url` 恒本地保兼容、新增 `avatar_cos_url` 旁路、新客户端优先 COS + binderror 降级本地）。服务端双写+加字段可先上（老客户端零感知即满足兼容），客户端随后发版；建议抽 `avatar-image` 组件收敛 10+ 处改造。无微信白名单依赖。
- **P2 · 导入导出（未上线，后做）**：直接重构（§5.3，存取全走 COS、删本地落盘与 purge、不双写）。收益最大，但依赖预签名 URL + 客户端下载改造 + 微信 downloadFile 白名单 + ICP。待 P1 验证 COS 接入无误、域名备案就绪后推进。demo-csv 维持现状不迁。若受阻可直接推迟该功能上线，不影响存量。
- 两期与 `response-compression-design.md`（Fastify gzip）**正交且互补**：压缩省 JSON API 字节、COS 剥离静态大文件流量，分别针对不同流量构成，可并行推进。

---

## 8. COS 接入指南（项目代码 + 腾讯云平台配置）

> 本章为接入调研，基于腾讯云官方文档核验（快速入门 `436/8629`、预签名 URL `436/68284`/`436/35153`）。作为施工前的技术底稿，非最终代码。

### 8.1 腾讯云平台侧要做的配置（控制台）

按顺序完成，粗体为阻塞前置：

1. **开通 COS 服务**：控制台开通对象存储 COS（首次需实名认证）。
2. **创建存储桶（Bucket）**：
   - 命名规则强制为 `<自定义名>-<APPID>`（如 `costra-avatars-1250000000`），APPID 是账号固定后缀，**创建时自动拼接**。
   - **地域（Region）** 选离用户近、且与 Lighthouse 同城/同大区的（如 `ap-shanghai`），降低回源延迟；地域一经确定不可改。
   - 建议**分两个桶**：`costra-avatars`（P1 头像，**公有读私有写**）、`costra-exports`（P2 导出/报告，**私有读写**）。分环境可再各拆 staging/prod 或用前缀区分（§9 待决）。
3. **访问权限（ACL）**：
   - 头像桶设「**公有读私有写**」——匿名可 GET、只有持密钥者可写（对齐现状 nginx 公有静态服务语义）。
   - 导出桶设「**私有读写**」——所有访问都需签名（预签名 URL 是唯一下载入口）。
4. **子账号密钥（CAM · 最小权限）**：
   - 不用主账号密钥。在访问管理 CAM 建**子账号/角色**，授予**仅限本项目桶**的最小权限策略（头像桶 `PutObject`；导出桶 `PutObject`/`GetObject`/预签名）。
   - 生成 **SecretId / SecretKey**，交由服务端环境变量注入（§8.2）。官方强烈建议进一步用 **STS 临时密钥**（见 §8.5），但一期可先用子账号永久密钥落地、后续再收紧。
5. **自定义域名 + HTTPS + ICP（P2 阻塞前置）**：
   - 2024-01-01 后创建的桶**不支持默认域名在浏览器/客户端直接预览**（官方明确），需绑**自定义域名**并配 **HTTPS 证书**；域名需 **ICP 备案**（Costra 已有 `costra.cloud` 备案，可用子域如 `cdn.costra.cloud` / `files.costra.cloud`）。
   - 头像桶可叠加 **CDN 加速域名**（边缘缓存，进一步降回源与首屏延迟）。
6. **生命周期规则（替代 purge）**：导出桶配「对象创建后 N 天自动删除」（对齐现有 24h TTL，可设 1 天），彻底把清理交给 COS，退役 purge 脚本。
7. **跨域 CORS**：`wx.downloadFile` 直连下载**通常不需要 CORS**（非浏览器 fetch）；若未来有浏览器端/`wx.request` 直取对象再评估配置。
8. **小程序后台域名白名单（P2 阻塞前置）**：微信公众平台 → 开发管理 → 服务器域名 → **downloadFile 合法域名** 加入导出下载的自定义域名（P1 头像走 `<image>` 不需要）。

### 8.2 项目侧：依赖与密钥注入

- **SDK 包**：`cos-nodejs-sdk-v5`（官方 XML API Node SDK，环境要求 Node ≥ 6；本项目 Node ≥ 20 满足）。加入 `server/package.json` dependencies。
- **密钥注入范式**（对齐现有做法）：prod/staging 的 server 容器已从 `/data/conf/server.env` 注入环境变量（`docker-compose.prod.yml:207-208`，已有 `JWT_SECRET`/`WX_APP_SECRET` 等）。新增：
  ```
  COS_SECRET_ID=...
  COS_SECRET_KEY=...
  COS_REGION=ap-shanghai
  COS_BUCKET_AVATARS=costra-avatars-1250000000
  COS_BUCKET_EXPORTS=costra-exports-1250000000
  COS_PUBLIC_BASE=https://cdn.costra.cloud      # 头像公有读域名（拼 avatar_url）
  ```
  **不入库、不入镜像明文**（与 SecretKey 现状一致，仅存在于 `/data/conf/server.env`）。
- **单例复用**：官方建议全进程**只 new 一个 `COS` 实例**并复用。新增 `server/src/services/cosClient.ts` 惰性单例，对齐 `getPool()`/`getRedis()` 范式。

### 8.3 服务端上传封装（P1 头像 · putObject）

`upload.ts` 的落点从本地 `writeFile` 改为 putObject（`Body` 直接用已在内存的 `fileBuffer`）：

```ts
// cosClient.ts（惰性单例，示意）
import COS from 'cos-nodejs-sdk-v5';
let _cos: COS | null = null;
export function getCos(): COS {
  if (!_cos) {
    _cos = new COS({
      SecretId: process.env['COS_SECRET_ID'],
      SecretKey: process.env['COS_SECRET_KEY'],
    });
  }
  return _cos;
}

// upload.ts 落点（示意，替换本地 writeFile + rename）
await getCos().putObject({
  Bucket: process.env['COS_BUCKET_AVATARS']!,
  Region: process.env['COS_REGION']!,
  Key: `avatars/${userId}.${ext}`,   // 同名覆盖，语义同现状
  Body: fileBuffer,
  ContentType: mimeOf(ext),          // image/jpeg 等
});
const url = `${process.env['COS_PUBLIC_BASE']}/avatars/${userId}.${ext}`;
// 写库 users.avatar_url = url（客户端 <image> 直连 COS/CDN）
```

关键点：`putObject` 支持 Promise/`async-await`（官方三种调用方式）；`Body` 可传 Buffer 或 `createReadStream`；魔数校验、2MB 限制等现有逻辑**全部保留**，只换落盘为上云。

### 8.4 服务端预签名下载（P2 导出/报告 · 私有读）

现有下载路由（`dataJobs.ts` `/data-jobs/:id/download`、`importJobs.ts` `.../report`）在**完成 JWT + 任务归属 + 未过期校验后**，不再 `createReadStream` 直发，而是**签发短时效预签名 URL** 返回 JSON：

```ts
// Node SDK getObjectUrl（官方：目前仅回调式，需 Promise 包裹）
function presignGet(bucket: string, region: string, key: string, expiresSec: number): Promise<string> {
  return new Promise((resolve, reject) => {
    getCos().getObjectUrl(
      { Bucket: bucket, Region: region, Key: key, Sign: true, Method: 'GET', Expires: expiresSec },
      (err, data) => (err ? reject(err) : resolve(data.Url)),
    );
  });
}

// 路由 handler（示意）：校验通过后
const url = await presignGet(EXPORTS_BUCKET, REGION, objectKey, 300); // 300s 有效
reply.code(200).send({ url, size_bytes: file.size_bytes, sha256: file.sha256 });
```

官方核验要点：
- `getObjectUrl` 在 Node SDK **目前只支持回调式**（须自行 Promise 化）；参数 `Sign: true` + `Expires`(秒) + `Method: 'GET'` 生成私有读下载签名 URL。
- 预签名**默认把请求域名算入签名**（`SignHost`）——若走自定义域名分发，需保证签名时的域名与实际访问域名一致，否则 403。
- 用**临时密钥（STS）**签发时，URL 失效时间取「密钥过期」与「Expires」**二者更早**者。
- 有效期建议短（如 300s）：URL 是一次性下载入口，泄漏窗口越小越好；客户端拿到即用、失效则重新调 `/download` 换新 URL。

### 8.5 安全强化（可选 · 收紧密钥）

官方最佳实践是**服务端不持有永久密钥**，改用 **STS 临时密钥**（`getAuthorization` 回调式初始化，或服务端签发临时凭证）。一期可先用子账号永久密钥（最小权限）落地，二期视安全要求再引入 STS。无论哪种，密钥都不落库/不落镜像明文。

### 8.6 与现有测试的相容性

- `entryExport.ts` 的 `setExportRootForTests`/`getExportRootForTests` 在单测里真实写临时目录——迁 COS 后需为 COS 调用做**测试替身**（mock `getCos()` 或注入内存实现），避免单测打真实 COS。这是改造的测试面主项，需在施工方案里明确。
- P1 头像上传单测同理需 mock putObject。

---

## 9. 待决问题

1. COS 与 CDN 是否叠加（头像走 CDN 边缘缓存收益 vs 成本）。
2. 预签名 URL 时效取值（300s？）与客户端「取 URL→下载」的失效重取策略。
3. 存量头像迁移的灰度窗口与 nginx `/uploads/` 回收时点。
4. bucket 分环境策略（staging/prod 独立 bucket vs 共享带前缀）；地域选择（`ap-shanghai` 是否与 Lighthouse 同区）。
5. 成本实测：按预估流量套 COS 现价，与升带宽包做定量对比。
6. 密钥模式：一期子账号永久密钥（最小权限）vs 直接上 STS 临时密钥。
7. 自定义下载域名命名（`files.costra.cloud` / `cdn.costra.cloud`）与证书签发方式。
