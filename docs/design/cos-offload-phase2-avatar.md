# 二期 COS 化方案：用户头像迁移对象存储

> 状态：**v1.8 · 已完结（2026-10-17：staging 全流程演练 + prod 部署/预搬/切指针/`--verify` 对账 + 2 周观察期（D4）全部通过 · §9 运维清场已执行——bind mount / nginx `/uploads/` / `backup-avatars` cron / 恢复脚本 avatars 段 / 目录脚本全退役 · `--revert` 回退能力随清场关闭）**
> 日期：2026-10-16（v0.1 初稿 → v1.0 决策关闭 + 脚本形态对齐 `infra/scripts/` 公约）→ 2026-10-17（v1.1：实测存量 180+ 文件 / 1.6 MB；迁移改**预搬 + 切指针**两段式、预搬全量覆盖、默认节流 200ms）→ 2026-10-17 二审（v1.2：**修正迁移候选集为 DB 驱动**——原目录驱动 + 全量覆盖在代码先上线时会静默把新头像覆盖成旧图，见 §8.0/§8.2/§8.7；补上传超时与错误码、WEBP 魔数收窄、11 处渲染点与 mine 页无占位兜底的事实纠正、清场前置断言，见 §7.3/§7.4/§9/§12/§13）→ 2026-10-17 晚（v1.3：**步 0 平台侧落地**——双桶 + 域名 + 证书 + DNS 全通；CAM 拍板保持 `resource:"*"`，见 §6.3 注记；`infra/cos-setup.md` §7 联动落笔）→ 2026-10-17（v1.4：**上线顺序重排为「部署 → 核验 → 预搬 → 切指针」**，取消"预搬须早于部署"硬约束——DB 谓词已使顺序与安全无关；预搬单行并发覆盖窗口拍板接受，见 §8.0.1/§11/§13）→ 2026-10-17（v1.5：**review 修订落笔**——渲染点 11→**13 处**（snake_case `avatar_url` 补漏 `filter-panel`/`pages-gm`）、§9.0 断言②改两域名白名单消除 staging 清场死锁、§5.1 带宽论证与 §11 回滚栏事实纠正、`--verify` 补秒级精度注记）
> 上游：`docs/design/cos-offload-analysis.md` v0.5 §4（P1 头像 · **本文推翻其"双写 + 双 URL"结论**，见 §4）、`docs/design/cos-offload-phase1-import-export.md` v0.2（一期导入导出 · 已落地，COS 接入范式的事实源）
> 平台事实源：`infra/cos-setup.md`（一期两私有桶 + 自定义域名 + CAM + DNS/证书三坑）
> 关联：`docs/design/avatar-image-component-design.md`（为双 URL 降级设计的客户端组件 · **本方案下不再需要**，见 §4.4）
> 事实源（代码）：`server/src/routes/upload.ts`、`server/src/services/cosClient.ts`、`server/src/config/env.ts`、`server/src/repositories/userRepo.ts`、`miniprogram/pages/profile-setup/index.ts`、`infra/nginx/conf.d/costra.cloud.conf.{prod,staging}`、`infra/docker-compose.prod.yml`、`infra/scripts/{lib/common.sh,migrate-ledger-asset.sh,maintenance.sh,backup-db.sh,restore-staging-from-prod.sh,02-prepare-dirs.sh,README.md}`
> 落地代码（v1.7）：`server/src/utils/imageMagic.ts`（新增 · 魔数共用模块）、`server/src/services/cosClient.ts`（多桶化）、`server/src/routes/upload.ts`（落点切 COS）、`server/src/config/env.ts` + `server/.env.example`（两键）、`server/test/upload.test.ts`（新增）、`server/test/helpers/memoryCos.ts`（扩展）、`server/scripts/migrate-avatars-to-cos.ts` + `infra/scripts/migrate-avatars-to-cos.sh`（迁移两件套）、`infra/scripts/README.md`（登记）

---

## 1. 结论摘要

| # | 结论 | 依据 |
|---|------|------|
| C1 | **可以一步切 COS：单列 `avatar_url` 不变、零契约变更、零客户端改动、零 migration**。上传落点由本地磁盘改 COS putObject，返回的 URL 换成 COS 公有读域名即可——`avatar_url` 本就是"服务端产出、客户端只读透传"的完整 URL 字符串 | §4 / §5 |
| C2 | **上游 P1「始终双写 + 双 URL + 客户端 binderror 降级」的前提不成立，应废弃**。该方案的唯一支柱是"老客户端无降级逻辑，`avatar_url` 必须恒指本地"，但老客户端渲染头像走 `<image>`，**`<image>` 不校验小程序合法域名**，拿到 COS URL 照样正常显示。所谓"兼容锚点"实际防的不是**兼容性**，而是**COS 可用性**——而降级目标（本机 nginx）的可用性比 COS 更低 | §4.1 / §4.2 |
| C3 | 代价对比悬殊：双写方案要永久背 1 个新列 + 13+ 契约加字段 + **13 处**头像渲染组件化 + 存量双轨，换来的是"COS 挂时头像先破图再降级闪一下"；一步切方案把同一风险交给**一次性可逆的回退脚本**（本地文件保留 2 周 + nginx `/uploads/` 不动 ⇒ 一条脚本把 `avatar_url` 精确改回本地） | §4.3 / §8.7 |
| C4 | **必须新建独立的公有读桶**，不能复用一期私有产物桶：①一期桶挂着**30 天生命周期规则**，头像进去会被自动删（致命）；②私有桶里混放公有读对象，靠对象级 ACL 维持，是权限误操作的长期隐患。新桶 `costra-{prod,staging}-avatar-1309318695` + 新域名 `img[.stg].costra.cloud`、**不设生命周期** | §6.1 |
| C5 | 头像**不能用预签名 URL**：`avatar_url` 是持久化入库、经 13+ 响应契约广播、并被 Redis 与客户端 TTL 缓存反复复用的值，与 300s 时效的签名 URL 在语义上不相容。头像桶必须"公有读私有写"；key 为 UUID（`users.id`）不可枚举、桶级禁 list，头像本身非敏感数据 | §6.2 |
| C6 | **顺带拿下一个现状缺陷**：nginx `/uploads/` 是 `no-cache + etag`，每次看头像都要走一次 304 往返（仍压在 prod 2Mbps / staging 1Mbps 固定出口上）。COS 化后对象带 `Cache-Control: public, max-age=31536000`，配合 2026-09-13 已落地的 `?v=` 版本化 URL（上传即换 URL），**重复加载彻底零请求**，收益大于单纯省字节 | §2 / §5.3 |
| C7 | **运维面大幅收敛**：退役 `backup-avatars` cron（每日 4 次 tar + scp 异地副本，依赖 `/data/conf/slave.env`）、`backup-db.sh --avatars-only`、`restore-staging-from-prod.sh` 的 avatars 段、`/data/uploads` 两个 bind mount、`02-prepare-dirs.sh` 目录与属主、nginx `/uploads/` location、`UPLOAD_DIR`/`UPLOAD_URL_BASE` 两个 env 及按请求头推导 URL 前缀的历史补丁 | §9 |
| C8 | `cosClient.ts` 需一次**多桶化重构**（现为单桶硬绑 `COS_BUCKET_EXPORTS`）：抽 SDK 进程单例 + 桶维度 store 工厂 `getCosClient('exports'\|'avatars')`，`putObject` 支持 `ContentType`/`CacheControl`，store 暴露 `objectUrl(key)` 作公开 URL 唯一出口。这是本期唯一的结构性改动 | §7.1 |
| C9 | **迁移候选集必须是 DB 驱动，不能是目录驱动**（v1.2 核心修正）。代码上线后本地盘即**冻结**，此后再"读本地目录 → 全量覆盖 COS"会拿旧图盖掉用户已上传的新图，且随后的 `UPDATE … ?v=<本地 mtime>` 让它变成**确定性显示旧图**、无任何报错。故预搬/切指针/回退三者的候选集统一由 `users.avatar_url` 的取值形态决定。也正因候选集由 DB 谓词保证，**v1.4 起预搬置于代码部署之后**（部署后上传的行天然出候选集，顺序与安全无关，§8.0.1） | §8.0 / §8.2 / §8.4 / §8.7 |

### 1.1 已拍板决策（2026-10-16）

| 决策 | 结论 | 落地含义 | 详述 |
|------|------|---------|------|
| **D1 · 桶形态** | **新建独立公有读桶**（不复用一期私有桶） | `costra-{prod,staging}-avatar-1309318695`（ap-shanghai · 公有读私有写 · **禁止任何生命周期规则**）+ 域名 `img[.stg].costra.cloud`；CAM 子账号 `resource` 追加两桶 | §6.1 |
| **D2 · 对象 Key** | **`avatars/<userId>`，去后缀**（类型靠 `ContentType` 元数据） | 一人恒一个对象；换图片格式不留孤儿、桶内无垃圾、**无需任何清理逻辑**；上线前以 staging 真机核验 `<image>` 对无后缀 URL 的表现（验不过退保留下后缀方案，见 §5.2） | §5.2 |
| **D3 · 鉴权** | **公有读，不用预签名** | 头像桶「公有读私有写」；`avatar_url` 为入库 + 13 契约广播 + Redis/客户端缓存复用的持久值，与 300s 时效签名互斥；`<image>` 无法携带 `Authorization`；安全暴露面与现状 nginx `/uploads/` 等价（Key 为不可枚举的 `users.id` UUID、桶禁 list） | §6.2 |
| **D4 · 观察期** | **2 周** | 观察期内本地文件与 nginx `/uploads/` 一律不动 ⇒ `--revert` 回退窗口为 2 周；观察期结束（且验收通过）才执行 §9 运维清场 | §8.7 / §11 |
| **D5 · 迁移形态** | **两段式：预搬 + 切指针**，候选集 = **`avatar_url` 仍指本地的行**（DB 驱动），预搬对其**无条件全量覆盖**（不做 ETag/存在性跳过） | `--upload-only`（不碰 DB · 可反复执行 · 跑崩重跑）与 `--switch-only`（只 UPDATE · 秒级）解耦，切换窗口的风险暴露压缩到秒级。**候选集由 DB 决定而非目录**（v1.2 修正）：代码上线后本地盘冻结，目录里已有"落后于 COS"的陈旧文件，以目录为驱动会把它覆盖上去 ⇒ 静默回退用户头像（§8.0）。重跑幂等由 DB 谓词保证；**v1.4 起预搬改在代码部署后执行**（同一谓词使部署后上传的行天然出候选集，"须早于部署"的硬约束取消） | §8.0 / §8.2 |
| **D6 · 预搬位置与节流** | **直接在 prod 机器预搬** + 串行 + **默认 `--sleep-ms 200`** | 实测存量仅 **180+ 文件 / 约 1.6 MB**，满速约 6 秒；节流后约 36 秒、占出口约 18%，在线请求无感。**不采用**"从库机器预搬以实现 prod 零流量"的跨机器方案（复杂度远大于收益） | §8.3 |

> 决策纪律：D1 的"禁止生命周期规则"与 D4 的"清场必须晚于观察期"是**两条不可协商的硬约束**——前者违反即静默删头像，后者违反即拆掉唯一回退路径。

---

## 2. 为什么要迁（收益）

Costra 全部服务跑单台 Lighthouse，**出口带宽固定硬顶：prod 2Mbps（≈250KB/s）、staging 1Mbps（≈125KB/s）**，无弹性（一期文档 §2 已实锤大文件下载打满出口导致全站 API 10s 超时）。头像的问题形态与导出文件不同，但同样压在这条管道上：

| 维度 | 现状 | 迁 COS 后 |
|------|------|-----------|
| **下行带宽** | 单张 5~10KB，但家庭汇总页/统计页/明细页**批量拉多成员头像**，全部走同一出口；nginx 虽不经 Fastify，但**绕过应用层不等于绕过带宽** | 全部走 COS，彻底移出固定带宽 |
| **重复加载** | `no-cache + etag` ⇒ 每次加载都发请求等 304（往返延迟 + 连接开销压在 2Mbps 链路上），只省了图片体字节 | `max-age=1y` + `?v=` 版本化 URL ⇒ **命中本地缓存零请求**，换头像时 URL 变、天然击穿 |
| **磁盘** | `/data/uploads/avatars` **唯一无限增长且永不回收**的产物（随注册用户线性增长） | 对象存储弹性容量 |
| **备份运维** | prod cron 每日 4 次 `backup-avatars`：tar 打包 → scp 异地副本到从库（依赖 `slave.env` 四件套、走 VPC/公网） | COS 自带多 AZ 冗余，整条链路退役 |
| **跨环境同步** | `restore-staging-from-prod.sh` 解压 tar 原子替换目录 + 对齐属主 | 不再需要（见 §9.3） |

> **实测量级（prod · 2026-10-17）：180+ 个头像 · 合计约 1.6 MB · 均值约 9 KB/张。** 据此修正收益排序：**运维收敛 > 缓存改善 > 带宽 > 磁盘**。
> - **磁盘不是真问题**：1.6 MB 可忽略，按 9 KB/人推算 1 万用户也仅约 90 MB。原"无限增长"一条在可见规模内不构成压力。
> - **最大收益是运维收敛**：为 1.6 MB 数据维护着「每日 4 次 tar 打包 + scp 异地副本（依赖 `slave.env` 四件套）+ 跨环境解包恢复 + 两个 bind mount + nginx location + 目录属主脚本」一整套链路，投入产出严重倒挂。
> - **缓存改善次之**：`no-cache + etag` ⇒ 每次加载一次 304 往返，改为 1 年长缓存后重复加载零请求（§5.3）。
> - **带宽收益真实但有限**：多成员页批量拉头像仍压在固定出口上，只是绝对量不大。

> 与 `response-compression-design.md`（gzip 省 JSON 字节）、一期导入导出 COS 化**正交互补**：分别针对 JSON API、CSV 大文件、图片静态产物三类流量。

---

## 3. 现状事实（代码级证据）

### 3.1 写入：唯一落点，极窄
- `POST /v1/upload/avatar`（`upload.ts`）：JWT → multipart 单文件 → 全量读入内存 Buffer → **魔数校验**（JPEG/PNG/GIF/WEBP，不信 Content-Type）→ 2MB 上限 → 写 `UPLOAD_DIR`（默认 `/var/costra/uploads`）`/avatars/<userId>.<ext>`（`.tmp`→rename 原子写，同名覆盖不累积）→ 返回 `201 { url }`。
- URL 形态：`<base>/uploads/avatars/<userId>.<ext>?v=<ms>`。`<base>` 由 `resolveUrlBase(req)` 决定：`UPLOAD_URL_BASE` env 优先，否则按请求 `X-Forwarded-Proto` + `Host` 推导（**2026-09-13 修**：原先硬编码默认 `https://costra.cloud`，导致 staging 上传的头像 URL 指向 prod ⇒ 404）。
- `?v=<ms>` 版本化（**2026-09-13 落地**）：文件按 `userId` 同名覆盖 ⇒ 裸 URL 恒定；微信 `<image>` 按 URL 做**持久磁盘缓存**，URL 不变则永远拿旧图。故每次上传返回全新 `?v=`，经 `PATCH /users/me` 落库后随各下发点传播，用"新旧 URL 不同"击穿缓存。
- **DB 只有一处写入**：`users.avatar_url TEXT`（`0001_init.sql:63`），由 `userRepo.updateProfile`（`:280`）写入客户端 PATCH 上来的完整 URL。登录链路**不写头像**（只占位 nickname）⇒ 值形态规整，不存在微信外链等杂形态。
- **无任何删除路径**：换头像=覆盖，账号/用户删除不清理头像文件（现状如此，本期不改变该语义）。

### 3.2 读出：全是 JOIN 透传，无副本
`avatar_url` 在 `authService` / `users` / `familyService` / `familySummaryService`(4 处) / `statisticsRepo` / `familySummaryRepo`(2 处) / `familyMemberRepo` / `gm`(2 处) 等 13+ 契约下发，但**全部是 `JOIN users` 现读现发**，数据库里**没有第二份副本**（无反范式快照列）。
⇒ **改 `users.avatar_url` 一列的值，即全链路生效**，这是一步切方案成立的结构基础。

### 3.3 客户端：只读透传，零解析
- 上传：`profile-setup/index.ts` 自带内联 `wx.uploadFile`（不走 `fileTransfer`）→ 读 `res.url` → `PATCH /users/me` → `updateLocalUserProfile` + emit `PROFILE_UPDATED`（并就地修补 `familyApi`/`statisticsApi` 缓存，防 TTL 内 SWR 把旧 URL 重新上屏）。
- 渲染：**13 处** `<image src="...">`（v1.5 按代码复核：`mine`×1 / `profile-setup`×1 / `ledger`×1 / `statistics`×1 / `statistics/tpl-rank-section`×1 / `family`×6 / **`filter-panel`×1** / **`pages-gm/impersonate`×2**——后三处字段为 snake_case `avatar_url` 直传，纯按 `avatarUrl` 检索会漏），**无一处解析 URL 的域名、路径或后缀**，也无一处 `binderror`。**其中 `mine` 无 `wx:if/wx:else`**（`pages/mine/index.wxml:7`），其余 12 处都带首字母或 CSS 剪影兜底——这决定"COS 挂掉"时的观感差异，见 §13。
  > 计数次第：v1.1 记 9 处；v1.2 改 11 处、但误判 `filter-panel`/`pages-gm/impersonate` 无头像（只检索了 `avatarUrl`，这两处实为 `avatar_url` 直传：`filter-panel/index.wxml:87`、`pages-gm/impersonate/index.wxml:22,50`）；v1.5 复核定为 **13 处**，验收清单 §12-2 同步。
- ⇒ 服务端换什么 URL，客户端就渲染什么 URL。**`<image>` 加载外部图片不需要配置小程序合法域名**（`downloadFile` 白名单只约束 `wx.downloadFile`/`getImageInfo` 等 API）。

### 3.4 COS 现状（一期已落地）
- `cosClient.ts`：惰性**单桶**单例，硬绑 `COS_BUCKET_EXPORTS` + `COS_DOWNLOAD_BASE`；能力面 `putObject`/`getObject`/`headObject`/`deleteObjects`/`presignGet`；`__setCosForTests` 注入 `MemoryCosStore` 内存替身。
- `env.ts`：5 个 `cos*` 可选字段（惰性失败，测试环境不配）。
- 平台侧：两私有桶 `costra-{prod,staging}-cos-1309318695`（ap-shanghai）+ 域名 `cos[.stg].costra.cloud` + CAM 子账号 `costra-cos-user`（5 个 action、两桶 `/*`）+ **生命周期 30 天**。

---

## 4. 关键判断：为什么推翻上游的"双写 + 双 URL"

上游 `cos-offload-analysis.md` v0.5 §4 的 P1 方案是：服务端本地+COS 始终双写、`avatar_url` 恒指本地作"兼容锚点"、新增 nullable `avatar_cos_url` 旁路下发、新客户端 `cos_url || url` 主 src + `binderror` 降级本地（并为此配套 `avatar-image` 组件收敛 9 处渲染）。

### 4.1 支柱前提是错的
该方案的论证原话是："老客户端**没有任何 `binderror` 降级逻辑**，若把 `avatar_url` 改成 COS，COS 一旦故障老客户端就是永久破图。只有让 `avatar_url` 恒本地，老客户端兼容性才成立。"

但这段把两件事混成了一件：

| 问题 | 老客户端拿到 COS URL 会怎样 |
|------|---------------------------|
| **兼容性**（能不能显示） | **完全正常**。`<image>` 对 src 域名无白名单要求、不解析路径/后缀；公有读 COS URL 与本机 nginx URL 对客户端是同一类东西（一个 HTTPS 图片 URL）。**零风险** |
| **可用性**（COS 挂了会怎样） | 头像不显示（13 处里 12 处有占位兜底，`mine` 页会空白）。这确实是风险，但它**与客户端版本无关**——新客户端的"降级"也只在 COS 挂时才有意义 |

⇒ "兼容锚点"保护的从来不是兼容性。把一个可用性兜底包装成兼容性硬约束，才导出了"必须双列 + 双写 + 客户端改造"的结论。

### 4.2 降级目标比主目标更不可靠
双 URL 降级的兜底落点是**本机 nginx**——即这次要剥离流量的那台单机 Lighthouse（单点、无冗余、带宽硬顶、维护重启就不可用）。COS 是多 AZ 冗余服务，可用性量级高于单台轻量服务器。**为可用性更低的东西做降级，是净负收益。**

另：一期已把导入导出的**存储与下载全量押在 COS、刻意不留本地回退**（`cos-offload-phase1 §6`："因未上线，无需保留本地直发回退"）。头像若反过来搞双写，等于同一套基础设施在两个功能上用两种可靠性假设。

### 4.3 代价对比

| | 一步切（本方案） | 双写 + 双 URL（上游 P1） |
|---|---|---|
| DB | **零改动**（无新列、无 migration） | 新增 `avatar_cos_url` 列 + migration |
| 契约/OpenAPI | **零改动** | 13+ schema 加 nullable 字段 |
| 客户端 | **零改动** | 13 处渲染组件化 + 数据结构加 `avatarCosUrl` + `auth`/`eventBus` 扩字段 |
| 服务端 | `upload.ts` 落点 + `cosClient` 多桶化 | 同左 + 双写编排 + 失败降级分支 + 两列下发 |
| 永久复杂度 | 无 | 双列语义、双写失败策略、13 处降级分支长期维护（新增头像点必漏） |
| COS 故障时 | 头像不显示（12 处占位符兜底、`mine` 空白）；可执行回退脚本改回本地 | 新客户端破图闪一下后降级；老客户端走本地 |

按项目纪律（**不追求最简改动，而追求最干净彻底，不为修复问题写硬逻辑**），一步切是更干净的那个：它把"COS 故障"当作**运维事件用一次性可逆脚本处理**，而不是在数据模型、契约和 13 处视图里永久铺一条降级分支。

### 4.4 `avatar-image` 组件方案随之作废
`avatar-image-component-design.md` 的全部存在理由是"把双 URL 降级收敛到一处"。单 URL 方案下**不需要降级**，组件没有职责。建议：该文档**不删**（项目纪律：删文件前须核查引用/决策链），在文首加状态头标注「**已作废 · 随 `cos-offload-phase2-avatar.md` 的单 URL 方案一并取消**」，并同步修订 `cos-offload-analysis.md` §4 的状态标注（见 §10）。
> 若将来确实想统一 13 处占位符视觉（当前 4 种形态，且 `mine` 占位是空缺），那是独立的 UI 一致性议题，与 COS 无关。

---

## 5. 目标形态

### 5.1 上传链路
```
POST /v1/upload/avatar（契约不变：multipart file ⇒ 201 { url }）
  → JWT + multipart + 2MB 上限 + 魔数校验              【全部保留，一字不改】
  → putObject 到头像桶（公有读私有写）
        Key          : avatars/<userId>                 （§5.2 决策 D2）
        ContentType  : image/jpeg | image/png | image/gif | image/webp（由魔数推导）
        CacheControl : public, max-age=31536000
  → url = <store.objectUrl(key)> + "?v=" + Date.now()
  → 201 { url }
（客户端照旧 PATCH /users/me 落库 users.avatar_url，全链路下发不变）
```
- **不再有本地写盘**：`UPLOAD_DIR`、`mkdir`、`.tmp`→rename 全部移除。
- **不再按请求头推导 URL 前缀**：`resolveUrlBase(req)` 整体删除，URL 域名来自该桶的 `objectUrl()`（env 固定值）。2026-09-13 那个"staging URL 指向 prod"的坑，在"每台机器只配自己那套桶+域名"下天然不复存在——但**配错 env 的后果同形**（staging 服务器配了 prod 桶 ⇒ 文件进 prod 桶、URL 指 prod 域名、prod 看得见 staging 的头像），故列入部署清单硬核验（§11，刻意不做域名字符串启发式自检，避免硬逻辑）。
- **上行对出口压力可忽略**（v1.5 修正论证）：客户端→服务端是**入方向**（Lighthouse 硬顶只管出方向），而服务端 `putObject`→COS 走的是**出方向**——与 §8.3 预搬是同一条 2Mbps 管道，原文"不占出口"的表述有误。但单张约 9 KB、上传频次极低，egress 占用可忽略 ⇒ 仍没有"客户端直传 COS"的必要（后者要引入 STS 临时密钥 + 客户端签名链路，且会把魔数校验与 2MB 闸口挪到可绕过的客户端侧，见 §15 非目标）。

### 5.2 对象 Key（决策 D2 · **已定稿：`avatars/<userId>`，去后缀**）

```
avatars/9f1c8d2e-…-uuid        ← 一人恒一个对象，无扩展名
```
类型信息**不由 URL 后缀承载**，而由两件事保证：① `putObject` 时显式写 `Content-Type` 元数据（由魔数已判出的 ext 映射，COS 在 GET 时回该头）；② `<image>` 按图片**真实字节**渲染、不看后缀（这正是服务端做魔数校验、不信任文件名的原因）。无后缀图片 URL 在 CDN/图床领域是通行形态。

**为什么去后缀（定稿理由）**：`<ext>` 随用户换图片格式而变（jpg→png），带后缀则"同名覆盖"不成立，旧后缀对象成为**孤儿**。本地盘时代这个孤儿一直存在、只是无人清理；但头像桶**刻意不设生命周期规则**（否则头像会被删，§6.1），意味着孤儿将**永久堆积且无任何自动回收路径**。去后缀是唯一"产生不了孤儿、因此不需要清理逻辑"的形态，与"一人一头像、覆盖即最新"的既有语义完全一致。

被排除的两个形态（存档备查）：
| 选项 | Key | 为何不选 |
|------|-----|---------|
| B | `avatars/<userId>.<ext>`（对齐现状） | 换格式留孤儿并永久堆积 ⇒ 要么容忍垃圾，要么写"删其余 3 个后缀"的清理分支（为维护一个本不必要的命名约定而引入硬逻辑） |
| C | `avatars/<userId>/<v>.<ext>`（每次上传新对象） | 对象随上传次数无限累积，且无法用生命周期区分"最新版"，回收需额外账本 |

**唯一待验证点**：微信 `<image>` 对无后缀 URL 的真机表现（列入 §12 验收清单）。风险低；若验不过则退 B，并同时决定"容忍孤儿"或"补清理分支"——该决定不影响本方案其余部分。

> `?v=` 与 Key 形态**正交**：`?v=` 是 query 参数，不属于 Key。Key 恒定 + query 变 = 对象覆盖写 + URL 唯一，缓存击穿不依赖后缀（§5.3）。

### 5.3 URL 与缓存
```
https://img.costra.cloud/avatars/9f1c…-uuid?v=1760600000123
       └ 公有读自定义域名 ┘ └ 对象 Key ┘ └ 版本参数（上传时刻 ms）┘
```
- `Cache-Control: public, max-age=31536000` 写在对象元数据上（putObject 时设）。URL 因 `?v=` 每次上传都变 ⇒ 长缓存零风险，换头像立即可见。
- 这是对现状 `no-cache + etag` 的**严格改进**：从"每次加载一次 304 往返"变成"同一 URL 永不再请求"。
- `?v=` 继续保留（**不是冗余**）：Key 固定、对象覆盖写，裸 URL 不变就会被微信 `<image>` 的持久磁盘缓存钉死——这正是 2026-09-13 的实锤教训。

### 5.4 存量 URL 的共存
切指针（§8.4）把 `users.avatar_url` 改成 COS URL，但**本地文件与 nginx `/uploads/` 在 2 周观察期内保持不动**。因此：
- Redis 缓存的 family/statistics 响应、客户端 TTL 缓存里残留的旧本地 URL，在各自过期前仍然**可正常加载**（不破图，无需刷缓存）。
- 这同时就是回退窗口（§8.7）。观察期后统一清场（§9）。

---

## 6. 平台侧配置（腾讯云 · 本期新增）

### 6.1 新建独立头像桶（决策 D1 · **已定稿：新建，不复用一期桶**）
| 维度 | prod | staging |
|------|------|---------|
| 桶名 | `costra-prod-avatar-1309318695` | `costra-staging-avatar-1309318695` |
| 地域 | `ap-shanghai`（与一期、与 Lighthouse 同区） | 同 |
| 访问权限 | **公有读私有写** | 同 |
| 自定义域名 | `img.costra.cloud` | `img.stg.costra.cloud` |
| HTTPS 证书 | 需签发 | 需签发 |
| **生命周期规则** | **无（头像永久保留）** | 同 |
| 阻止公有访问 | **关闭**（否则公有读 ACL 不生效） | 同 |

**为什么不复用一期私有桶**（两条都是硬理由）：
1. 一期桶挂着「对象 30 天后删」的生命周期规则。头像是永久数据，放进去**会被静默删除**。要复用就得把规则改成按前缀限定（`exports/`、`detect/`、`reports/`），平添一条"谁也不会记得的前缀耦合"，且一旦前缀写漏就是丢头像。
2. 头像必须公有读、产物必须私有读。在私有桶里靠**对象级 ACL** 开放 `avatars/*`，等于把安全边界从"桶"下沉到"每个对象"——任何一次桶策略调整、SDK 默认值变化或漏传 ACL 参数，都可能让头像 403（或更糟，反向让产物可读）。**公/私分桶是最干净的安全边界。**

> 两桶独立还顺带保住一期"staging 可随意压测清空"的性质。
>
> ⚠️ **此桶禁止任何生命周期规则**（D1 硬约束）。建桶后截图留档；日后任何"统一两桶生命周期"的提议都应被拒绝——头像是永久数据，规则一旦误配即静默丢数据，且**丢了无从察觉**（表象只是用户头像变占位符）。

### 6.2 为什么公有读、而非预签名（决策 D3 · 已定稿）

三条约束叠加后只剩公有读一个解：

1. **消费方是 `<image>`，带不了任何请求头**。13 处头像渲染全是 `<image src="...">`，小程序 `<image>` 无自定义 header 能力 ⇒ **无法携带 `Authorization`**。这一条直接排除"私有桶 + 客户端带 token 取对象"。
2. **`avatar_url` 是被反复复用的持久值，不是一次性凭证**。它的生命周期是：`putObject` → 拼 URL → `PATCH /users/me` 落库 → 经 13+ 响应契约广播给全家成员 → 进 Redis 缓存 → 进客户端 TTL 缓存 → 被微信 `<image>` 按 URL 做持久磁盘缓存。预签名是 300s 时效凭证，而上述每一环的 TTL 都远长于 300s ⇒ **入库签名 URL 几分钟后全端 403**。
3. **改为"下发时实时签名"会把代价放大到不可接受**。`family-summary`/`statistics` 单条响应含多个成员头像 ⇒ 响应组装阶段签 N 次；且签名 URL 进 Redis/客户端缓存后**必然过期**（缓存里先天存着不可用的值，缓存语义被污染）；`<image>` 长缓存收益归零（每次都要先换 URL）。为鉴权拆掉缓存这根最重要的性能杠杆，得不偿失。

被排除的第四条路——**私有桶 + 服务端代理回源**——恰好是本期要剥离的东西（图片字节重新经 Fastify + nginx 从固定出口挤出），且 `<image>` 带不了 token，还得改成 `wx.downloadFile` + 临时文件 + 手动渲染，改造面大于重做整条头像链路。

**安全评估：暴露面是平移，不是新增**

| | 现状（本地 nginx `/uploads/`） | COS 公有读私有写 |
|---|---|---|
| 谁能读 | 任何人拿到 URL 即可 GET（location 无任何鉴权） | 匿名可 `GetObject` |
| 路径可枚举性 | `avatars/<users.id>.<ext>`，`users.id` 是 **UUID** | `avatars/<users.id>`，同一个 UUID |
| 能否列举全部 | 不能（nginx 无 autoindex） | 不能（桶"私有写" ⇒ 匿名无 `ListBucket`，CAM 亦不授） |
| 谁能写 | 仅 server 容器（本地盘） | 仅持 CAM 密钥者 |
| 内容敏感度 | 用户自选的微信头像，非敏感 | 同 |

⇒ 公有读只是把现状的匿名可读性质平移到 COS，暴露面未扩大。真正需要私有读的是**用户全量流水**（一期导出产物），那类才配预签名——两类产物鉴权语义不同，这也是 §6.1 分桶的第二条理由。

### 6.3 CAM 权限（扩现有子账号策略）
沿用 `costra-cos-user`，在 `resource` 数组追加两个新桶：
```json
"resource": [
  "qcs::cos:ap-shanghai:uid/1309318695:costra-prod-cos-1309318695/*",
  "qcs::cos:ap-shanghai:uid/1309318695:costra-staging-cos-1309318695/*",
  "qcs::cos:ap-shanghai:uid/1309318695:costra-prod-avatar-1309318695/*",
  "qcs::cos:ap-shanghai:uid/1309318695:costra-staging-avatar-1309318695/*"
]
```
action 维持现有 5 个（`PutObject`/`GetObject`/`DeleteObject`/`DeleteMultipleObjects`/`HeadObject`）即够：头像只用 `PutObject`（上传）+ `HeadObject`/`GetObject`（迁移校验）。**不需要** `PutObjectACL`（公有读在桶级，对象继承），也**仍然不授** `ListBucket`。密钥不新增、不轮换。

> 实施注记（2026-10-17）：实际控制台中该策略的 `resource` 本就是 `"*"`，**拍板保持不收紧**——上述 resource 追加未执行，两新桶被 `"*"` 天然覆盖。约束面仍在 action 白名单（5 个 · 仍不含 `ListBucket`/`PutObjectACL`）；密钥泄露时的暴露面大于最小权限形态，属已拍板接受的取舍。实况已记录于 `infra/cos-setup.md` §2 注记与 §7。

### 6.4 DNS 与证书（照抄一期踩过的坑）
- prod `img.costra.cloud`：在 **`costra.cloud`** 域内加 CNAME，主机记录 `img` → 新桶的 COS「自定义源站域名」CNAME 值。
- staging `img.stg.costra.cloud`：**必须建在 DNSPod 里独立托管的 `stg.costra.cloud` 子域内**，主机记录只填 `img`（父域里填 `img.stg` 不生效——子域委派覆盖，`infra/cos-setup.md §5.3` 实锤）。
- 证书签发的 `_dnsauth.img` 验证记录同样放各自域内。
- 验收：`dig +short img[.stg].costra.cloud` 出记录；`curl -I https://img.stg.costra.cloud/avatars/probe` 回 **404 NoSuchKey**（注意：公有读桶的预期信号是 404，**不是**一期私有桶的 403）。
- 证书刚部署时多接入节点可能灰度不一致（偶发 SSL SAN 不匹配），等几分钟复测（`§5.1` 同款）。

### 6.5 小程序后台
`<image>` 渲染**不需要**白名单。但建议**顺手把 `img.costra.cloud` / `img.stg.costra.cloud` 加入 downloadFile 合法域名**（零成本，避免将来用 `wx.getImageInfo`/`downloadFile`/`saveImageToPhotosAlbum` 处理头像时再卡一次审核流程）。

---

## 7. 服务端改造清单

### 7.1 `cosClient.ts` 多桶化（唯一结构性改动）
现状单桶硬绑，须改为桶维度：

```ts
export type CosBucketName = 'exports' | 'avatars';   // 'exports' 保持原名，不动一期 env

export interface PutObjectOptions { contentType?: string; cacheControl?: string }

export interface CosObjectStore {
  putObject(key: string, body: Buffer, opts?: PutObjectOptions): Promise<void>;
  getObject(key: string): Promise<Buffer>;
  headObject(key: string): Promise<boolean>;
  deleteObjects(keys: string[]): Promise<void>;
  presignGet(key: string, expiresSec: number): Promise<string>;
  /** 不签名的公开对象 URL（基于该桶的 base 域名）· 公有读桶用 */
  objectUrl(key: string): string;
}

export function getCosClient(bucket: CosBucketName): CosObjectStore;
export function __setCosForTests(bucket: CosBucketName, fake: CosObjectStore): void;
export function __resetCosForTests(): void;   // 清空全部桶实例
```
要点：
1. **SDK 实例仍是进程单例**（官方建议一进程一个 `COS`），两个 store 共享它，各自绑定 `bucket`/`region`/`base`——即"SDK 单例"与"桶绑定 store"职责分离。
2. `readEnvConfig(bucket)`：共用 `COS_SECRET_ID/KEY/REGION`；桶与域名按桶名取（`exports` → `COS_BUCKET_EXPORTS` + `COS_DOWNLOAD_BASE`；`avatars` → `COS_BUCKET_AVATARS` + `COS_AVATAR_BASE`）。缺失仍是**惰性失败**（首次用到该桶才抛，测试环境不配）。
3. `objectUrl(key)` 是**公开 URL 的唯一出口**（路由里不再拼 env 域名），与 `presignGet` 共用同一 base 常量 ⇒ 域名来源单一。
4. 接口**不拆**（头像桶照样实现 `presignGet`，只是没人调）：拆成两个接口会让 `MemoryCosStore` 与 4 个一期调用点一起做类型体操，收益为零。
5. 4 个一期调用点（`entryExport`/`entryImport`/`dataJobs`/`importJobs`）只改为 `getCosClient('exports')`，**显式传桶名、不给默认值**（默认值等于隐式耦合）。
6. **超时按桶配置，不共用一套**（v1.2 新增）：`CosEnvConfig` 增 `timeoutMs`；`avatars` = **5000ms**，`exports` 保持 SDK 默认。
   > 理由是两者走的是完全不同的网络路径与体量：头像 9 KB、经 `/v1/upload/avatar`（nginx `proxy_read_timeout 10s`，`costra.cloud.conf.prod:79`），SDK 默认超时远大于 10s ⇒ COS 抖动时用户先被 nginx 掐成 **504 HTML**（破坏 JSON 错误契约）。导出分片 ~900 KB 且是 worker 内部调用（不经 nginx），压到 5s 反而容易误判超时。**故只能按桶给值**，别用一个全局常量。
   > 不调大 nginx 的 `proxy_read_timeout`：它是 `/v1/` 整段的公共值，为单个上传路由放宽会连带所有在线接口。

### 7.2 `env.ts`
追加两个可选字段（与现有 5 个 `cos*` 同范式、同注释纪律）：
```
cosBucketAvatars  ← COS_BUCKET_AVATARS   （costra-{prod,staging}-avatar-1309318695）
cosAvatarBase     ← COS_AVATAR_BASE      （https://img[.stg].costra.cloud）
```
同步 `server/.env.example`。

### 7.3 `upload.ts`
| 删除 | 新增/保留 |
|------|-----------|
| `getUploadDir()`、`UPLOAD_DIR` | 保留：JWT、multipart、2MB、魔数校验、`?v=` 版本化 |
| `resolveUrlBase(req)`、`UPLOAD_URL_BASE`、`X-Forwarded-Proto`/`Host` 推导 | 新增：`extToContentType(ext)`（魔数已判出 ext，映射 4 个 MIME，纯函数） |
| `mkdir` / `writeFile` / `rename` / `node:path` 依赖 | 新增：`getCosClient('avatars').putObject(key, buf, { contentType, cacheControl })` + `objectUrl(key)` 拼 URL |
| — | 文件头注释改写：记录"落点 COS + 为何仍需 `?v=` + 为何公有读不预签名"（取代现有本地磁盘与 URL 推导的长注释） |
| — | **`putObject` 失败必须映射为既有错误码**（见下），不允许裸抛 500 |
响应契约 `201 { url }` 不变 ⇒ **OpenAPI 零改动**（`url` 仍是 `format: uri`）。

**失败语义（v1.2 新增 · 现状写本地盘几乎不可能失败，改成跨公网写后必须定义）**：
- `putObject` 超时/网络错误/5xx ⇒ `AppError(ErrorCode.INTERNAL)`，`message` 与 `details { step: 'cos_put' }` 如实标注，路由层返回既有 `500 INTERNAL`。
- **刻意不新增错误码**：新增码要同步 `ErrorCode.ts` 三张映射表 + `docs/api/error-codes.md` + `openapi.yaml` + 客户端 `KNOWN_SERVER_CODES`，为一个"用户可以按重试解决"的瞬时故障付这套成本不划算；客户端的正确反应本就是提示重试。
- **上游语义变化须在 §13 明确**：COS 故障时用户**无法更换头像**（不是"能换但看不到"）。
- 2MB 上限与魔数校验**仍留在服务端**：上传经服务端代理，闸口不动（§15 已否决客户端直传）。

### 7.4 迁移脚本两件套
`infra/scripts/migrate-avatars-to-cos.sh`（运维入口）+ `server/scripts/migrate-avatars-to-cos.ts`（能力实现）。两段式（预搬 / 切指针）、分层理由、参数与调用形式见 §8；须同步登记 `infra/scripts/README.md`（目录结构树 + 新增一节，照「停服迁移 · 账本资产回填」那节的结构）。
> 连带小改动：把 `upload.ts` 的 `MAGIC_MAP`/`detectExt` 抽成共用模块（如 `server/src/utils/imageMagic.ts`），供上传路由与预搬脚本**同源**使用——预搬按魔数而非文件名后缀判 MIME（§8.2）。
> **抽取时必须收窄 WEBP 判定（v1.2 修正）**：现 `MAGIC_MAP` 只比对 `RIFF`（`upload.ts:52`），而 WAV/AVI 同头 ⇒ 一个 `.wav` 会被判成 `image/webp`。D2 去后缀后 `Content-Type` 是类型信息的**唯一载体**，写错即渲染失败，故 WEBP 须同时校验 `offset 8..12 == 'WEBP'`。这是既有缺陷，但**由本期放大**（现状错类型只是无用文件躺盘；COS 化后会被当成图片对外服务），一并修掉。

### 7.5 测试
- 现状**无 `upload` 路由测试**（既有缺口）。本期**补 `server/test/upload.test.ts`**：注入 `MemoryCosStore`（`__setCosForTests('avatars', fake)`），断言
  ① 魔数通过 ⇒ 对象落在 `avatars/<userId>`、内容字节一致、`contentType`/`cacheControl` 正确；
  ② 返回 URL = `https://<avatar base>/avatars/<userId>?v=<数字>`（正则断言）；
  ③ 非图片字节 / >2MB / 非 multipart / 无 token ⇒ 既有错误语义不变；
  ④ **`putObject` 抛错 ⇒ `500 INTERNAL`（Costra JSON 契约，非裸异常/HTML）**（§7.3 失败语义）；
  ⑤ **`RIFF` 头但非 WEBP 的字节 ⇒ 判为不支持类型**（§7.4 魔数收窄）。
- `MemoryCosStore` 加 `objectUrl(key)` 实现（已有 `downloadBase` 字段，复用）与可选的 `putObject` opts 记录（供①断言），以及一个**可开关的失败注入**（供④）。
- **`__setCosForTests` 的实际消费点只有 2 个测试文件**（`test/dataJobs.test.ts`、`test/dataImport.test.ts`，v1.2 核对；v1.1 写的"4 个调用点的测试"不实）。签名改为带桶名后，这 2 个文件各改 1 行即可 —— 一期调用点本身不直接持有注入。
- 不需要 DB/pg-mem 变更（无新列）。

---

## 8. 存量迁移（预搬 + 切指针）与回退

存量（**2026-10-17 实测 · prod**）：`/data/uploads/avatars/<uuid>.<ext>`，**180+ 个文件 · 合计约 1.6 MB · 单个几 KB**；对应 `users.avatar_url` 形如 `https://costra.cloud/uploads/avatars/<uuid>.<ext>[?v=…]`。已确认**不存在同一 uuid 多后缀并存**的情况（一人一文件）。

### 8.0 两段式：搬数据与切指针解耦（决策 D5 · 2026-10-17 · 候选集修正见 §8.0.1）

原设计把"传文件 + 改 DB"耦合在一次执行里；改为拆成两个独立阶段：

| 阶段 | 命令 | 动作 | 碰 DB | 风险 | 时机 |
|---|---|---|---|---|---|
| **预搬** | `--upload-only` | 本地盘 → COS，**无条件全量覆盖** | ❌ 否（只读 DB 取候选集） | 纯增量写，跑崩重跑即可 | **代码部署之后**（v1.4 · §8.0.1） |
| **切指针** | `--switch-only` | 只 `UPDATE users.avatar_url` | ✅ 是 | 有，但秒级完成 | 切换窗口内 |

**收益**：切换窗口里只剩一条 UPDATE，风险暴露从"整个传输过程"压缩到秒级；预搬因为不写 DB，可以随便跑、随时中断、反复重来。

**预搬是无条件全量覆盖，不做任何"已存在就跳过"的判断**（D5 定稿）：
- `putObject` 同 key 本就是覆盖语义，重跑天然全量刷新；
- 刻意**不引入 ETag/MD5 比对跳过**——在 180 文件 / 1.6 MB / 满速约 6 秒的量级下，"跳过已传的"省不出任何可观成本，却要引入 `headObject` 返回值扩展、MD5 比对、分块上传 ETag 格式差异等一整套复杂度。**全量覆盖是这里更干净的选择**（与"不为优化写硬逻辑"的纪律一致）。

#### 8.0.1 候选集必须由 DB 决定（**v1.2 核心修正**）

v1.1 的预搬/切指针/回退都是**目录驱动**（遍历本地 `avatars/`），并声称"预搬后若有用户更新头像，重跑一次预搬即可——本地盘是最新的"。**这个前提在代码部署之后就失效了**：

1. §7.3 删除了本地写盘 ⇒ 代码上线那一刻起，本地 `/data/uploads/avatars/<uuid>.<ext>` **冻结**，不再更新；
2. 上线后用户换头像只写 COS ⇒ **本地是旧图 A、COS 是新图 B**、`users.avatar_url` 已是 `img…?v=T1`；
3. 此时跑目录驱动的 `--upload-only` ⇒ 用 A **覆盖** B；
4. 随后的 `--switch-only` 再把 `avatar_url` 写成 `<base>/avatars/<uuid>?v=<A 的 mtime>` ⇒ 用户头像被**确定性退回上一张**，且新 URL 击穿缓存，无任何报错。

**故候选集改为 `users.avatar_url` 的取值形态**（仍是"一人一个对象"的同源依据，只是权威源从磁盘换成 DB）：

```sql
-- 候选集：指针仍指向本机的行（代码上线后换过头像的行已是 COS 域名，天然被排除）
SELECT id, avatar_url
  FROM users
 WHERE avatar_url IS NOT NULL
   AND avatar_url LIKE '%/avatars/%'
   AND left(avatar_url, length($1)) <> $1;   -- $1 = COS_AVATAR_BASE（server.env 原值）
```

- **预搬**：对候选集逐行取 `avatar_url` 里的 `<uuid>`，读本地对应文件（一人一文件、无多后缀并存，§8 已核）。**本地文件不存在即跳过并计入报告**（该行可能早已是 COS），绝不在缺源时把空内容或旧内容写上去。
- **切指针**：同一谓词筛选 + `LIMIT`，即 §8.4 的 SQL；执行完这批行的指针离开本地，**重跑幂等**（已被改写的行不再入选）。
- **回退**：见 §8.7，改为"精确等于切换时写入的 COS URL"匹配。
- **不依赖 `--sleep-ms` 之外的人工一致性**：v1.1 的"人工保证重跑一次即可"整句删除——它从未可执行。

> **这不违反"不做域名字符串启发式自检"（§8.1）**：那条拒绝的是"脚本自己猜 env 配错没配错"（判断**环境**），这里判断的是"**这一行的指针是否仍指本地**"（判断**数据**，是迁移幂等性的必要条件）。两者性质不同，须在实现时保持区分，别把后者误删。

> **顺序定为"部署后预搬"（v1.4 拍板 · 2026-10-17，取代 v1.2 的"须早于部署"硬约束）**：上述 DB 谓词使顺序与安全无关——部署后上传的行 `avatar_url` 已是 COS 域名、天然出候选集；本地盘冻结后，候选行的本地文件即终态，预搬不可能拿到"比 COS 更新的本地旧图"。v1.2 的硬约束防的是**目录驱动**覆盖缺陷，候选集改 DB 驱动后它不再承载安全职责。**每次预搬仍必须先打印"候选集 N 行 / 本地缺源 M 行"**，M>0 时逐个确认来源（部署后的常见原因：历史数据不一致或文件被手工移除；staging 库里指向 prod 域名的行亦会表现为缺源，属正常）。
>
> **残留竞争窗口（已拍板接受 · 不处理 · 2026-10-17）**：预搬处理某一行期间（~0.2s/行 · 全程约 36s）若该用户并发上传，且预搬的 `putObject` 后至，COS 对象被回写成冻结时的旧图而 DB 已是新 URL ⇒ 该用户**确定性地看到上一张头像**，重传即恢复。全程仅一次 36 秒运行、单行窗口亚秒级，概率与后果都足够低，拍板允许出现（§13 同名风险行）。

### 8.1 脚本形态（对齐 `infra/scripts/` 公约 · 双层）

`infra/scripts/migrate-ledger-asset.sh` 的文件头记录了一条明确的历史决策——它**替代了旧版 `server/scripts/migrate-ledger-asset.mts`**，理由是"遵循 infra/scripts 规范：docker exec 操作容器不直连 `DATABASE_URL` / 密码从 `server.env` 读 / prod 强制 confirm + 提示先 backup / 支持 `--dry-run`·`-y`·`--help` / SQL 内联不依赖 server 仓库层 TS 函数"。因此**运维入口必须是 `infra/scripts/*.sh`**，不能是一条裸 `docker compose exec … tsx`。

但头像迁移**无法照搬"SQL 内联"那一条**：它必须 `putObject` 到 COS，而凭据读取、SDK 单例、`ContentType`/`CacheControl` 设置都在 `cosClient.ts` 里。纯 bash 要做到就得引入 `coscmd`/`coscli` 新依赖并把密钥再传一遍给 CLI——更差。故采用**双层**，并显式记录这次偏离：

| 层 | 落位 | 职责 | 为什么在这一层 |
|---|---|---|---|
| **运维入口** | `infra/scripts/migrate-avatars-to-cos.sh` | 参数解析、防呆、如实回显真实目标、confirm、dry-run 语义、日志、退出码、总结 | `infra/scripts` 公约的全部要求都在这一层满足 |
| **能力实现** | `server/scripts/migrate-avatars-to-cos.ts` | 查候选集（DB）→ 读本地文件 → `putObject`（节流）→ `headObject` 复核 → `UPDATE users` → 统计输出 | 必须复用 `cosClient.ts`（SDK + 凭据 + 单例）与容器内 `getPool()`；**不是用户入口，只被 bash 层调用** |

> 这仍满足"不直连 `DATABASE_URL`"的本意：TS 在 server 容器内跑、用容器自己的注入配置，宿主机脚本不持有任何连接串。
>
> **调用前提（v1.4）**：预搬/切指针/回退全部在代码部署后执行（§11），运行中的 `costra-server` 容器必然已是含本脚本与多桶版 `cosClient` 的新镜像，`docker exec` 委托形态对所有阶段成立——不存在"代码未部署却要跑新脚本"的投递问题。

**bash 层骨架（照 `migrate-ledger-asset.sh` 范式）**
```bash
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "${SCRIPT_DIR}/lib/common.sh"   # log_* / die / run_cmd / confirm / require_* / DRY_RUN / ASSUME_YES

parse_common_args "$@"                  # 扫全部参数设 DRY_RUN / ASSUME_YES
while [[ $# -gt 0 ]]; do case "$1" in
  --upload-only) MODE=upload; shift ;;
  --switch-only) MODE=switch; shift ;;
  --sleep-ms)    SLEEP_MS=$2; shift 2 ;;
  --limit)       LIMIT=$2; shift 2 ;;
  --revert)      MODE=revert; shift ;;
  --base)        BASE=$2; shift 2 ;;
  --verify)      MODE=verify; shift ;;
  --dry-run|-y|--yes) shift ;;          # common 已处理 · noop
  -h|--help) grep '^#' "$0" | sed 's/^# \{0,1\}//' | head -NN; exit 0 ;;   # NN = 文件头注释行数
  *) die "未知参数: $1 · 用 --help 查看" ;;
esac; done

require_root; require_cmd docker
require_file "${COSTRA_ENV_FILE}"       # /data/conf/server.env
# 1. 前置：server.env 必须已配 COS_BUCKET_AVATARS / COS_AVATAR_BASE（缺失即 die · 早失败）
# 2. 容器 costra-server 必须 running（否则 die 并指向 ./05-start-stack.sh）
# 3. 如实回显即将操作的真实目标（不做任何域名字符串启发式，只回显 + 人工核对）
# 4. 候选集谓词的 $1 直接取 server.env 里 COS_AVATAR_BASE 的原值透传给 TS（§8.0.1）
print_section_header "🖼  Costra · migrate-avatars-to-cos (${MODE})"
log_info "容器      : costra-server"
log_info "候选集    : users 表中 avatar_url 仍指本地的行（N 行 · §8.0.1 谓词）"
log_info "本地目录  : ${COSTRA_DATA}/uploads/avatars（作为候选行的源文件 · 缺源行须逐条确认）"
log_info "目标桶    : <server.env 里 COS_BUCKET_AVATARS 的原值>"
log_info "目标域名  : <server.env 里 COS_AVATAR_BASE 的原值>"
log_info "节流      : ${SLEEP_MS}ms/文件（预计耗时 …s · 约占出口 …KB/s）"
# 5. 碰 DB 的模式（switch / revert / 合一）才高危确认；--upload-only 与 --verify 不改 DB，可免
if [[ "${MODE}" != "upload" && "${MODE}" != "verify" ]]; then
  log_warn "⚠️  将修改 users.avatar_url · 强烈建议先跑 ./backup-db.sh"
  confirm "确认切换头像 URL 指向上述桶？" || die "用户取消"
fi
# 6. 委托容器内 TS（dry-run 语义见下）
```

**为什么不用 `--target prod|verify`**：`migrate-ledger-asset.sh` 的 `verify` 是 `replay-db.sh` 拉起的隔离 PG 容器；头像迁移没有对应的"隔离 COS 桶"——**staging 桶本身就是演练场**（§8.6 先 staging 后 prod）。且两台机器上容器名同为 `costra-server`，脚本在哪台跑就操作哪台栈，与 `restore-staging-from-prod.sh` 同模型。故改为「如实回显真实目标 + 一律 confirm」，既对齐 `log_info` + `confirm` 范式，又不引入 §13 已明确拒绝的域名字符串启发式。

**dry-run 语义（易写错，必须明确）**：项目约定是"只读操作 dry-run 也执行、写操作 dry-run 跳过"（`restore-staging-from-prod.sh` 的 tar 完整性校验就是 dry-run 也跑）。本脚本的 `--dry-run` 属**只读**（查候选集行数、列缺源行、算总字节、报预计耗时），故 bash 层要把 `--dry-run` **透传给 TS 真正跑一遍**，而**不是**用 `run_cmd` 把整条 `docker exec` 跳过——后者会让 `--dry-run` 什么也看不到，失去意义。TS 侧则须保证 dry-run 下**不 putObject、不 UPDATE**（读取 DB 与本地文件属只读，照跑）。

### 8.2 预搬（`--upload-only` · 本地盘 → COS · 对候选集全量覆盖）

**候选集来自 DB（§8.0.1），不是目录**；逐行串行处理（**绝不并发**：瓶颈是带宽不是 RTT，并发只会更快打满、无任何收益）：

1. `SELECT id, avatar_url FROM users WHERE …`（§8.0.1 谓词）取候选集，按 `id` 排序；
2. 从 `avatar_url` 解析出 `<uuid>`（与 `<base>/avatars/<uuid>[?v=…]` 同解），映射到本地文件 `<uuid>.<ext>`——**本地文件缺失即跳过并单独列报告**，绝不猜后缀、绝不用其他用户/其他版本的文件顶替；
   > **本地目录来源（v1.6 补齐）**：§7.3 删除的是 `upload.ts` 内的 `getUploadDir()`/`UPLOAD_DIR`——那是"写盘落点"，与本脚本无关；本脚本读的是**冻结存量**，须在容器内自带同源解析：读同一 `UPLOAD_DIR` env、缺省 `/var/costra/uploads`（与 upload.ts 历史默认一致），**不得写死默认值**——某机若配过非默认 `UPLOAD_DIR`，写死会让候选行静默变成"全部缺源"。bash 层回显的 `${COSTRA_DATA}/uploads/avatars` 是宿主机视角（bind mount 另一侧），仅供人工核对。
3. **魔数检测得类型**（复用 `upload.ts` 的 `MAGIC_MAP`/`detectExt`，抽成共用模块两边同源）→ MIME；
   > 不按文件名后缀推 MIME：`upload.ts` 的既有纪律是「不信任 Content-Type 与 filename、只信魔数」，同一系统对同一件事不应有两套判据；且 D2 去后缀后 `Content-Type` 元数据是类型信息的**唯一载体**，写错即渲染失败。顺带能发现本地盘上被手工改名或损坏的文件。
   > 魔数检测失败（本地文件损坏/并非图片）⇒ **跳过该行并计入失败清单**，不上传、不覆盖已有对象。
4. `putObject('avatars/<uuid>', buf, { contentType, cacheControl: 'public, max-age=31536000' })`——**对候选集无条件覆盖**（同 key 覆盖语义，重跑天然全量刷新）；
5. `headObject` 复核写入成功；
6. **`sleep(--sleep-ms)` 后再处理下一个**（节流，见 §8.3）。

**只读 DB 不写**。输出：候选集行数 / 成功数 / 本地缺源清单 / 魔数失败清单 / 总字节 / 实际耗时。单条失败只跳过该条并最终非零退出（不中断整体），便于补跑。

### 8.3 带宽与节流（实测量级 · 决策 D6）

| 项 | 实测值（prod · 2026-10-17） |
|---|---|
| 文件数 | 180+ |
| 总大小 | **约 1.6 MB** |
| 单个大小 | 几 KB（均值约 9 KB） |
| prod 出口硬顶 | 2 Mbps ≈ 250 KB/s |
| **满速理论耗时** | **约 6 秒** |

方向上这是**出方向**流量（从 Lighthouse 推向 COS），与 2026-09-09 打满出口导致全站 API 10s 超时的是同一条管道。但在 1.6 MB 这个量级下，总量尚不足两个导出 CSV 分片（900 KB/片），**带宽风险实际很低**。

即便如此仍加节流（成本近乎为零的保险）：

| `--sleep-ms` | 总耗时 | 平均速率 | 占 prod 出口 |
|---|---|---|---|
| 0（不节流） | ~6 s | 250 KB/s | 100%（不采用） |
| **200（默认）** | **~36 s** | ~44 KB/s | **~18%** |
| 500 | ~90 s | ~18 KB/s | ~7% |

**默认 `--sleep-ms 200`**：36 秒跑完、只占约 1/5 出口，在线请求无感。串行 + 每文件后 sleep 天然是脉冲式低占用——单个文件几 KB，一次 `putObject` 根本形不成持续高速流。

> **刻意不做跨机器预搬**：曾评估"在从库机器（机器②）解包 `scheduled-*.avatars.tar.gz` 后上传，实现 prod 零出口流量"。在 1.6 MB / 6 秒的量级下，这套跨机器操作的复杂度（两地执行、备份最多 6 小时陈旧、需额外一致性校验）远大于收益。**决策：直接在 prod 机器预搬**（D6）。该路径仅在未来总量涨到 GB 级时才重新评估。

### 8.4 切指针（`--switch-only` · 只改 DB）

逐行 `UPDATE`，**驱动与预搬同为 DB 候选集**（§8.0.1 谓词 + `LIMIT`），保证"传了什么就指向什么"、且重跑幂等：
```sql
UPDATE users
   SET avatar_url = $base || '/avatars/' || $uuid || '?v=' || $mtimeMs
 WHERE id = $uuid
   AND avatar_url IS NOT NULL
   AND avatar_url LIKE '%/avatars/%'
   AND left(avatar_url, length($1)) <> $1;   -- $1 = COS_AVATAR_BASE · 已被改写的行不再入选
```
- `WHERE` 里的三条限定是**幂等与安全的核心**：去掉即可能把已切 COS 的行改写回去（含 `--upload-only` 之后才换过头像的行）。
- **`?v=` 取文件 mtime 毫秒**而非 `Date.now()` ⇒ 同一输入恒产出同一 URL，重跑不产生 URL 抖动（避免白白击穿全端缓存）。
- **实现注记（v1.6 · mtimeMs 取整）**：`fs.stat().mtimeMs` 是**浮点数**（如 `1760600000123.4`）。写入 URL 前必须取整，且切指针与 §8.7 `--revert` 重建匹配串**必须共用同一取整函数**（如 `Math.trunc`）——两处各写各的，会让 revert 的"精确等于"匹配静默漂移为 0 行。
- **不用一条大 regexp SQL**（上游 `cos-offload-analysis.md` §4.3 的写法）：逐行更新更稳，且 Key 已去后缀（D2），用 SQL 正则剥后缀反而更绕。
- **每条 UPDATE 前先 `headObject` 确认对象存在**：对象缺失说明预搬漏了该行（源文件缺失/上传失败），此时**跳过该行**而非写入一个 404 的 URL。
- 输出：更新行数 / 跳过数（本地缺源 / COS 无对象）/ 失败清单。
- 本阶段几乎零网络流量（N 次 `headObject` + N 条 UPDATE），180 行秒级完成。

### 8.5 参数与调用

| 参数 | 含义 |
|---|---|
| `--upload-only` | 只预搬（对 DB 候选集全量覆盖，不写 DB）。可反复执行；**代码部署后执行**（v1.4 · §8.0.1） |
| `--switch-only` | 只切指针（只 `UPDATE users.avatar_url`，候选集同预搬 + 逐行 `headObject` 前置校验） |
| `--sleep-ms N` | 每文件处理后的节流间隔，**默认 200** |
| `--limit N` | 本次最多处理 N 行（**切指针阶段的灰度**：先 10 行真机核验，再跑第二次处理剩余行；预搬阶段 6 秒跑完，一般用不上） |
| `--verify` | 只读对账：逐行断言 ① `avatar_url` 域名前缀 ∈ {prod, staging} 两个已知 `COS_AVATAR_BASE`（v1.5 修正：staging 库经恢复后合法持有 prod 域名行，见 §9.0/§9.3）② 对应 key 的 `headObject` 存在 ③ 对象的 `LastModified` 不早于本地文件 mtime（发现"新图被旧图覆盖"，见 §13）；指向**另一环境**域名的行只做①、跳过②③（对象不在本机桶）。实现注记：COS `LastModified` 为**秒级**精度（ISO8601），与毫秒级 mtime 比较须先截断到秒（或留 1s 容差），否则批量误报。不写任何东西 |
| `--revert` | 回退模式（§8.7），须配 `--base` |
| `--base <url>` | `--revert` 时的本机 URL 前缀，**显式传入不猜** |
| `--dry-run` | 只读预演：候选集行数、本地缺源行、总字节、预计耗时，不 putObject、不 UPDATE |
| `-y` / `--yes` | 跳过 confirm（慎用） |
| `-h` / `--help` | 文件头注释即帮助 |

```bash
cd /root/Costra/infra/scripts

./migrate-avatars-to-cos.sh --dry-run                     # 预演：候选集 / 缺源行 / 总字节 / 预计耗时
./migrate-avatars-to-cos.sh --upload-only                 # 预搬（默认节流 200ms · 约 36s）
./migrate-avatars-to-cos.sh --upload-only --sleep-ms 500  # 更保守
./migrate-avatars-to-cos.sh --switch-only --limit 10      # 切指针灰度：先 10 行
./migrate-avatars-to-cos.sh --switch-only                 # 切指针全量（候选集自动剔除已切行）
./migrate-avatars-to-cos.sh --verify                      # 只读对账
```

### 8.6 执行顺序与验证
1. **staging 先全流程**：部署代码（§11 步 1）→ staging 侧部署核验（§11 步 2）→ `--dry-run` → `--upload-only` → `--switch-only --limit 10` → 真机核验 → `--switch-only` 全量 → `--verify` 对账；再跑 §12 十一条（含换头像、重装、老版本正式版渲染）。
2. **prod**：代码部署（§11 步 1）→ 步 2 双机核验 → `--dry-run` → `--upload-only`（低峰执行 · 约 36s · 与切指针可拉开数天）→ `./backup-db.sh` → `--switch-only --limit 10` + 真机抽查 → `--switch-only` 全量 → `--verify`；再 `curl -I` 抽查对象可达与 `Cache-Control` 头。
3. **部署之后（含预搬与切指针之间）若有用户换头像**：这些行的 `avatar_url` 已是 COS 域名，**不在候选集内**，预搬不会碰、切指针也不会改写它（§8.0.1）。无需重跑，旧图不会覆盖新图。唯一例外是预搬单行处理瞬间的并发竞争，已拍板接受（§8.0.1 末注）。
4. **Redis 不必清**：旧本地 URL 在观察期仍可用（§5.4）。

### 8.7 回退预案（可逆性由"本地文件仍在"保证）
**观察期 = 2 周**（决策 D4）。期内本地文件与 nginx `/uploads/` **一律不动**，故回退是纯运维动作：
```bash
./migrate-avatars-to-cos.sh --revert --base https://costra.cloud
```
`--revert` **只处理"指针精确等于本次切换写入的 COS URL"的行**（该串可由 `COS_AVATAR_BASE || '/avatars/' || <uuid> || '?v=' || <本地 mtimeMs>` 重建），把它们改回 `<base>/uploads/avatars/<uuid>.<ext>?v=<mtimeMs>`（本机域名由 `--base` **显式传入，不猜**；后缀从本地文件名取——已确认一人一文件，无歧义）。

**为什么必须是"精确等于"而非"按目录遍历"（v1.2 修正）**：一个老用户本地留着旧图 A、在观察期内换成 B 时，按目录驱动 revert **不会"不处理"，而是把指针改回旧图 A**——回退动作本身制造静默回退。精确匹配天然排除这类行。

**已知边界（须接受并记录）**：
- 观察期内**新上传**的头像（本地无源文件）`avatar_url` 是切换之后写入的另一个 `?v=`，不等于"切换时写入的 URL" ⇒ revert 不改写，**保持 COS URL**，可正常显示（COS 桶未动）。即回退是"把存量拉回本地"，不是"全量退回"。
- 观察期内换过头像的老用户 ⇒ 同上，保持 COS URL（不回退到旧图）。这正是想要的语义。
- 真要"连新上传也回退"只能人工通知重传；2 周窗口内属个位数级，可接受。

---

## 9. 运维面收敛（**2 周观察期之后**执行）

> 这一节是**观察期结束后的清场**，与 §7/§8 分开发布，避免"刚切就把回退路径拆了"。**硬约束（D4）**：本节任一条目都不得早于 prod 切指针完成 + 2 周执行。

### 9.0 清场前置断言（v1.2 新增 · v1.5 修正跨环境判定 · 缺这一步就可能拆掉仍在使用的回退路径）

执行 §9.1–§9.3 中**任何**一条之前，先跑三条只读断言，**任一不满足即中止清场**：

```sql
-- ① 已无任何行指向 /uploads/ 本地形态：应为 0
SELECT count(*) FROM users
 WHERE avatar_url IS NOT NULL AND avatar_url LIKE '%/uploads/avatars/%';

-- ② 除两个已知头像 COS 域名外，无任何行指向别处（切指针全量完成的确认）：应为 0
SELECT count(*) FROM users
 WHERE avatar_url IS NOT NULL
   AND avatar_url LIKE '%/avatars/%'
   AND left(avatar_url, length($1)) <> $1    -- $1 = prod 的 COS_AVATAR_BASE
   AND left(avatar_url, length($2)) <> $2;   -- $2 = staging 的 COS_AVATAR_BASE
```

```sql
-- ③ 非 NULL 且不含 /avatars/ 的杂形态行（①②的覆盖缝 · v1.6 新增）：应为 0
SELECT count(*) FROM users
 WHERE avatar_url IS NOT NULL AND avatar_url NOT LIKE '%/avatars/%';
```

- ② 的谓词是**两域名白名单**而非"本机 base"（v1.5 修正）：staging 库经 `restore-staging-from-prod` 恢复后，大量行**合法地**指向 prod 的 `img.costra.cloud`（§9.3），单 base 谓词在 staging 永不为 0、清场会被永久阻塞。白名单语义 = "合法终态只有两种：NULL 或任一环境的头像 COS 域名"。这与 §8.1 拒绝的"域名字符串启发式自检"性质不同：那里是猜**环境**配没配错，这里是校验**数据**的合法取值集合。
- ① 非 0 ⇒ 说明有行被漏切（例如切指针时本地缺源、`headObject` 校验未过而被跳过，见 §8.4），这些行**一旦删掉 nginx `/uploads/` 就是永久破图**。先补跑 `--switch-only` 再用 §8.4 的跳过清单逐条处理。
- ② 非 0 ⇒ 切指针未全量完成，退回 §8.6。
- ③ 是 ①② 的**托底**（v1.6 新增）：①② 都只匹配含 `/avatars/` 的行，一条不含该路径的杂形态 URL（历史遗留或手工改写）会**同时逃逸两条断言**、在清场后静默失效。§3.1 的审计结论是"不存在杂形态"，③ 用一行 SQL 把该结论变成清场前的强制核验。非 0 ⇒ 逐行人工核查来源，不得清场。
- **staging 清场前置**：先执行一次 `restore-staging-from-prod`（须在 prod 步 4 切指针完成之后），把库内残留的 prod 本地 URL 刷成 COS 域名，再跑上述断言——否则 staging 库里指向 prod `/uploads/` 的恢复行会让 ① 永不为 0（这些行不归 staging 的迁移管，prod 清场后它们必然 404，重恢复是唯一干净的解法）。
- 断言通过后再动 bind mount / nginx location / 备份 cron；`--verify` 通过**不能替代**这三条（它验的是对象存在性，不验"还有没有行指着本地"）。

### 9.1 容器与 nginx
- `infra/docker-compose.prod.yml`：撤 server 的 `/data/uploads:/var/costra/uploads` 与 nginx 的 `/data/uploads:/data/uploads:ro` 两个 bind mount（注释照一期范式写明"已 COS 化"）。
- `infra/nginx/conf.d/costra.cloud.conf.{prod,staging}`：删除 `location /uploads/` 段（`location ~ /\.` 防扫探段**保留**，它不止服务 uploads）。
- **prod live 配置在 `/data/conf/nginx/`，改模板后须手动合并并 reload**（项目既有纪律）。

### 9.2 目录与备份
- `infra/scripts/02-prepare-dirs.sh`：移除 `${COSTRA_DATA}/uploads/avatars` 创建与 `uploads` 的 uid 1000 属主对齐。
- `infra/scripts/backup-db.sh`：移除 `--avatars-only` 与 avatars 打包段（`AVATARS_SRC` 等）。
- `infra/scripts/maintenance.sh`：**退役 `backup-avatars` 任务**（`CRON_SCHEDULE` 里 `0 0,6,12,18 * * *` 那条）、`do_push_avatars_offsite()`、`list` 文案、参数解析分支；连带评估 `SLAVE_ENV_FILE`（`/data/conf/slave.env`）是否还有别的消费者——若无，`install-cron` 里那条缺失预警也一并移除。**改完必须重跑 `install-cron`**（一期已有同款教训）。
- **宿主机 `/data/uploads` 的删除单独做**，且在确认最后一份 avatars 归档已入异地后再动。

### 9.3 跨环境恢复
`infra/scripts/restore-staging-from-prod.sh`：移除 avatars 归档段（`--skip-avatars`、`AVATARS_FILE`、tar 校验/解压/原子替换/属主对齐、步骤计数从 3 步降为 2 步）。
> 顺带澄清一个长期的运维错觉：该脚本恢复的 **DB 里存的是 prod 的头像 URL**，所以 staging 恢复后头像本来就是从 prod 域名加载的，tar 拷过来的本地文件只服务于"在 staging 自己上传过头像"的少数行。COS 化后同理——staging 恢复后头像 URL 指向 **prod 头像桶**（公有读，可正常显示），staging 自己新上传的进 staging 桶。行为与现状等价，无需任何额外处理。

### 9.4 文档
- `infra/cos-setup.md`：加「头像桶」一节（桶名/域名/证书/**无生命周期**/CAM resource 扩充/env 两键/DNS 子域坑复述/公有读桶 curl 预期 404），更新 §1 表格与 §3 key 组织约定（追加 `avatars/<userId>`）。
- `docs/db/schema.md`：`avatar_url` 的取值形态说明更新为 COS 公有读域名（列定义本身不变）。
- `infra/scripts/README.md`：**随 §7.4 脚本一并登记**（不等观察期），清场时再补一条"本地 avatars 链路已退役"。
- 见 §10 文档联动。

---

## 10. 文档联动（本期须一并修订）

| 文档 | 动作 | 时点 |
|------|------|------|
| `infra/scripts/README.md` | 目录结构树加 `migrate-avatars-to-cos.sh` 一行 + 新增一节（照「停服迁移 · 账本资产回填」结构：说明 + bash 代码块 + 参数表 + 两段式与全量覆盖说明） | **随脚本落地** |
| `infra/cos-setup.md` | 新增头像桶章节（§9.4 所列） | **✅ 已随步 0 落笔（2026-10-17 · §7；CAM 实况为 resource:"\*" 未扩充）** |
| `docs/design/cos-offload-analysis.md` | §4 / C3 / C7 / §7.1 的"P1 头像 = 双写 + 双 URL"标注为**已被本文推翻**，指向本文；§4.6 的 CDN 存档说明保留（**注意该文有两个 §4.6，需同时处理编号重复**） | **✅ 已随 v1.2 落笔** |
| `docs/design/avatar-image-component-design.md` | 文首加「**已作废**（随单 URL 方案取消）」状态头，不删文件（§4.4） | **✅ 已随 v1.2 落笔** |
| `docs/design/cos-offload-phase1-import-export.md` | §1 表格里"头像本期不做/需双写"的描述加一行后置注记，指向本文的新结论 | **✅ 已随 v1.2 落笔** |
| `docs/design/redis-cache-tech-spec.md` §328 | 头像 URL 版本化那条注记补"`?v=` 已落地（2026-09-13），COS 化后继续沿用" | **✅ 已随 v1.2 落笔** |
| `docs/db/schema.md` | `avatar_url` 取值形态说明 | 随切指针完成 |

> v1.2 已把表中「随本文定稿」的四项一次性落笔——**此前仓库里同时存在"必须双写"（analysis C3/§4）与"一步切"（本文）两份互相否定的结论**，施工前必须先消除这个冲突，故不等脚本。`docs/db/schema.md` 仍守在切指针之后（那时取值形态才真正改变）。

---

## 11. 上线顺序（每步可独立回滚）

| 步 | 内容 | 回滚方式 |
|---|------|---------|
| **0** | 平台侧：建两桶（公有读、**无生命周期**）、两域名 + 证书、DNS、CAM resource 扩充、两机 `server.env` 加 `COS_BUCKET_AVATARS`/`COS_AVATAR_BASE`、小程序白名单顺手加、**配云监控流量/费用告警**（§14-2 · 公有读下的成本护栏） | 纯新增，无影响 |
| **1** | **代码部署**：`cosClient` 多桶化 + `env` 两键 + `upload.ts` 落点切 COS + `upload.test.ts` 新增 + 迁移脚本两件套（§7）。此后新上传进 COS、**存量仍是本地 URL**（两种 URL 共存，都可用）；**本地盘自此冻结** | 回滚镜像即恢复本地落盘（存量本地 URL 不受影响；期间进 COS 的新头像 URL 由客户端直连 COS 渲染，**不受回滚影响**——桶与域名未动，v1.5 修正：原文"URL 会失效 ⇒ 重上传"有误） |
| **2** | **部署硬核验**（防 2026-09-13 同形事故）：在**两台机器分别** `curl` 上传一张头像，确认 ①返回 URL 域名 = 本机环境域名 ②对象只出现在**本机环境的桶**里 ③prod 桶里**没有** staging 的测试对象 | — |
| **3** | **预搬存量**：`--dry-run` → `--upload-only`（约 36s · 低峰执行 · 与步 4 可拉开数天）。代码已在跑 ⇒ 运行中容器即含迁移脚本的新镜像，`docker exec` 直接可用；本地盘已冻结，候选行本地文件即终态（§8.0.1） | 无需回滚（COS 多出几个无人引用的对象而已、无人引用） |
| **4** | **prod 切指针**：`./backup-db.sh` → `--switch-only --limit 10` + 真机抽查 → `--switch-only` 全量 → `--verify` 对账（§8.6） | `--revert --base …`（§8.7） |
| **5** | **观察 2 周**（D4）。期内须至少各发生一次：换头像、小程序重装、老版本正式版在网渲染；并抽查 COS 用量与错误率 | 同上 |
| **6** | 运维清场（§9）：**先跑 §9.0 两条断言**，再动 bind mount / nginx location / 备份 cron / 恢复脚本 / 目录脚本 + 文档。**必须晚于步 5 结束** | 配置回滚（此后不再有本地回退能力，故必须等观察期结束） |

> **步 0 进度（2026-10-17）**：两头像桶建成（公有读私有写）、`img[.stg].costra.cloud` + 证书 + DNS 全通（curl 双 404 · 详见 `infra/cos-setup.md` §7）；CAM 拍板保持 `resource:"*"` 不扩充（§6.3 注记）。**剩余**：两机 `server.env` 两键、云监控告警、MP 白名单、生命周期为空截图留档。
> **预搬在代码部署后执行**（v1.4 拍板 · 2026-10-17，取代 v1.2"预搬须早于部署"的硬约束）：候选集 DB 谓词使顺序与安全无关——部署后上传的行 `avatar_url` 已是 COS 域名、天然出候选集；本地盘冻结后候选行的本地文件即终态。v1.2 当年加这条硬约束防的是**目录驱动**的覆盖缺陷，候选集改 DB 驱动后它不再承载安全职责。附带收益：预搬/切指针/回退全部运行在"新镜像已在跑"的状态，§8.1 的 `docker exec` 委托形态对所有阶段成立，无需为预搬单独准备脚本投递通道。残留的单行并发覆盖窗口拍板接受（§8.0.1 末注）。
> **staging 全流程演练**（部署 → staging 侧核验 → `--dry-run` → `--upload-only` → `--switch-only --limit 10` → 全量 → `--verify`）+ §12 十一条验收，全部通过才允许进入 prod 步 4。

---

## 12. 真机验收清单（沿用"涉 wx API 的编排不写单测、靠真机清单"纪律）

**必须在 staging 全部通过后，才动 prod 切指针（§11 步 4）。**

1. `profile-setup` 换头像 → 立即生效（`?v=` 击穿缓存）→ 杀进程重进仍在 → **删除小程序重装后仍在**（验持久化落 COS 非临时路径）。
2. **13 处渲染全覆盖**（v1.5 按代码复核）：`mine` / `profile-setup` / `ledger` 条目 / `statistics`（含 `tpl-rank-section`）/ **`family` 6 处**（成员列表 / 排行 ×2 / l3 头像 ×2 / color-picker）/ **`filter-panel`** / **`pages-gm/impersonate` ×2**。
   > 计数次第：v1.1 记"9 处"→ v1.2 按 `avatarUrl` 检索改 11 处、并误判 `filter-panel` 与 `pages-gm/impersonate` 无头像 → v1.5 复核：这两处**真实渲染头像**，只是字段为 snake_case `avatar_url` 直传（`filter-panel/index.wxml:87`、`pages-gm/impersonate/index.wxml:22,50`），全量定为 **13 处**。验收时逐处核对，**避免漏验**。
3. **老版本（线上正式版）小程序 + 新 server**：头像正常显示（验 §4.1 的核心论断）。
4. 多成员家庭汇总页：全成员头像齐出；二次进入**不再发起网络请求**（devtools Network 确认长缓存生效）。
5. staging 与 prod 各自桶隔离（§11 步 2）。
6. 存量用户（切指针后）与新上传用户混排页面均正常。
7. 换头像时**变更图片格式**（jpg→png）后仍正常显示，且对象数不增（验 D2 去后缀的核心收益）。
8. **无后缀 URL 专项**（D2 唯一待验证点）：`<image>` 对 `https://img…/avatars/<uuid>?v=…` 正常渲染；`curl -I` 响应含正确 `Content-Type: image/*` 与 `Cache-Control: public, max-age=31536000`。
9. **顺序专项（v1.4 更新场景）**：「部署 → 预搬 → 预搬后换头像 → 切指针」全程走一遍，确认该用户的头像**显示的是新图**（预搬后上传的行已是 COS URL，验 DB 候选集谓词与切指针 WHERE 真的把它排除了；若被切回旧图即 §8.0.1 谓词失效）。
10. 边界：非图片文件、>2MB、无头像用户（占位符）、COS 故障模拟。
    > **COS 故障时两种表现都要看**：① 既有头像**拉不到** ⇒ 各处显示占位/首字母，**`mine` 页无 `wx:else` 兜底，会是空白块**（`pages/mine/index.wxml:7`），须确认这是可接受的观感而非"白屏崩溃"；② 此时**换头像应失败并提示重试**（§7.3），不是静默成功。

---

## 13. 风险矩阵

| 风险 | 等级 | 缓解 |
|------|------|------|
| COS 故障 ⇒ 全端头像不显示（**无运行时降级**，这是方案的明确取舍） | 中低 | 13 处渲染里 **12 处有占位兜底**（首字母 / CSS 剪影），**`mine` 页无 `wx:else`（`pages/mine/index.wxml:7`）会显示空白块**（v1.5 按实复核：v1.2 的"11 处"漏了 snake_case `avatar_url` 的 3 处；§15 已把"统一占位视觉"列为非目标）；COS 可用性高于单台 Lighthouse；2 周观察期内本地文件 + nginx 保留 ⇒ `--revert` 一次性回退（§8.7） |
| **COS 故障 ⇒ 用户无法更换头像**（v1.2 新增；现状写本地盘几乎不失败，改成跨公网写后是新失败模式） | 中低 | 上传经服务端代理 + SDK 超时按桶设为 5s ⇒ 失败在 nginx 10s 前返回既有 `500 INTERNAL` JSON 契约，客户端提示重试（§7.3）；**不新增错误码**（瞬时故障，重试即可） |
| 头像桶被误配生命周期规则 ⇒ 静默删头像 | **高后果** | 独立桶（D1）、`infra/cos-setup.md` 与本文 §6.1 均显式写明"**此桶禁止任何生命周期规则**"；建桶后截图留档；与一期桶物理隔离（最根本的防线） |
| `server.env` 配错（staging 配成 prod 桶/域名） | 中 | §11 步 2 双机交叉核验；刻意**不做**域名字符串启发式自检（硬逻辑） |
| `<image>` 对无后缀 URL 异常（D2） | 低 | staging 真机先验（§12 第 8 条）；验不过退"保留后缀"形态，并同时决定容忍孤儿或补清理分支 |
| **预搬把用户新头像覆盖成旧图**（v1.1 的真缺陷：目录驱动 + 本地盘在代码上线后冻结 + 切指针沿用 mtime） | 主路径**已结构性消除**；残留并发窗口 **低 · 已拍板接受**（2026-10-17） | v1.2：候选集改 DB 驱动（`avatar_url` 仍指本地的行，§8.0.1）、切指针 SQL 带同一谓词（§8.4，部署后上传的行 UPDATE 命中 0 行）、`--verify` 增 `LastModified ≥ 本地 mtime` 校验（§8.5）、§12 第 9 条专项验收；v1.4：预搬改部署后执行，"须早于部署"硬约束取消。**残留窗口（拍板接受）**：预搬处理单行期间（~0.2s）该用户并发上传且预搬 `putObject` 后至 ⇒ COS 为旧图 + DB 新 URL ⇒ 该用户看到上一张头像，重传即恢复；全程一次约 36s、单行亚秒窗口，不处理（§8.0.1 末注） |
| 切指针把 `avatar_url` 写错/写空 | 中 | 六重：`--dry-run` 只读预演 → `--switch-only --limit 10` 灰度 → **DB 候选集驱动**（缺源/无对象即跳过该行，§8.2/§8.4）+ `WHERE id = $uuid AND avatar_url IS NOT NULL AND …谓词` → `--verify` 事后对账 → 切指针前 `./backup-db.sh` → bash 层强制 confirm 与真实目标回显；失败仍有 `--revert` |
| **预搬打满出口 ⇒ 在线 API 超时**（与 2026-09-09 同形：同一条出方向管道） | **低**（实测 1.6 MB · 满速约 6 秒，不足两个导出分片） | 串行绝不并发 + 默认 `--sleep-ms 200`（约 36s · 占出口约 18%）+ 低峰执行 + `--dry-run` 预报总字节与耗时；预搬与切指针解耦（§11 步 3/4），可与切换窗口拉开数天 |
| 预搬后、切指针前有用户换头像 | 低 | **已结构性消除**：这些行指针已是 COS 域名 ⇒ 不在候选集，预搬不碰、切指针不改写（§8.0.1）；仍刻意不做 ETag 比对跳过（1.6 MB 量级下不值那套复杂度） |
| 公有读被外部盗链刷流量 | 低 | Key 为 UUID 不可枚举、桶禁 list；小程序无 Referer 故防盗链不适用 ⇒ 改用**云监控流量告警**兜底（§14-2） |
| 2 周窗口内新上传/换过的头像不在 `--revert` 范围内 | 低 | 设计内语义（§8.7 精确匹配"切换时写入的 URL"）：这些行保持 COS URL 且可正常显示；量级为个位数，必要时人工通知重传 |
| 一期 4 个调用点改 `getCosClient('exports')` 时漏改 | 低 | 显式参数 ⇒ 漏改即 TS 编译失败（`npm run typecheck` 拦住） |

---

## 14. 待决问题（D1–D6 已关闭 · 以下为**非阻塞**遗留）

> 已关闭：✅ 桶形态 = 新建独立公有读桶（D1）· ✅ 对象 Key = `avatars/<userId>` 去后缀（D2）· ✅ 鉴权 = 公有读不预签名（D3）· ✅ 观察期 = 2 周（D4）· ✅ 迁移 = 预搬 + 切指针两段式、**候选集由 DB 决定**（D5 · v1.2 修正，原文"目录驱动 + 全量覆盖"已废；v1.4 起预搬在代码部署后执行）· ✅ prod 机器直接预搬 + 默认节流 200ms（D6）。另：Key 去后缀的 `<image>` 真机验证已转为**上线前置的验收项**（§12 第 8 条），不再是待决问题。

1. **是否叠加 CDN**（头像走 CDN 边缘缓存）——建议**暂不**：对象已带 1 年长缓存、客户端命中后零请求，CDN 的边际收益主要在"首次加载跨地域延迟"，可上线后看监控再评估。
2. **COS 流量/费用告警阈值**（云监控）——建议与一期产物桶一并配置。**公有读（D3）下这是主要的成本护栏**，建议在 §11 步 0 就配好。
3. ~~**是否引入图片处理压缩头像**~~ —— **实测否决（2026-10-17）**：均值约 9 KB/张（180+ 张共 1.6 MB），已远小于 160rpx 显示所需，原先"用户原图可能远大于显示尺寸"的担心**不成立**（上传链路显然已有有效约束）。不再列为待办；若未来均值显著上升再重评。
4. **是否补一个"头像更新"的埋点/看板**（上传成功率、COS 错误率）——本期靠 §11 步 5 的人工观察即可；若 2 周内出现异常再补。
5. **账号注销时是否清理头像对象**——现状（本地文件）同样不清理，本期**刻意不改变语义**；若将来做注销数据清理，是独立卡。

---

## 15. 非目标（本期明确不做）

- **客户端直传 COS（STS 临时密钥）**：会把魔数校验与 2MB 闸口挪到客户端（可绕过），并引入 STS 签名链路；而上传是入方向流量、不受 Lighthouse 出口硬顶约束 ⇒ 无收益。
- **跨机器预搬（从库机器解包备份后上传，实现 prod 零出口流量）**：已评估并否决（D6）——1.6 MB / 6 秒量级下，两地操作 + 备份最多 6 小时陈旧 + 额外一致性校验的复杂度远大于收益。仅在总量涨到 GB 级时重评。
- **预搬的 ETag/MD5 增量跳过**：已评估并否决（D5）——同量级下省不出可观成本，却要扩 `headObject` 返回值、做 MD5 比对、处理分块上传 ETag 格式差异。全量覆盖更干净。
- **把上传与资料更新合并成一个接口**（现为 `upload/avatar` + `PATCH /users/me` 两步）：属接口形态重构，与 COS 化无关。
- **统一 13 处头像占位符视觉**（当前 4 种形态，`mine` 页无占位）：UI 一致性议题，单 URL 方案下不再被 COS 化牵连。
- **STS 替代永久子账号密钥**：与一期同步推进，不在本期范围。
- **按桶统一 nginx `proxy_read_timeout`**：不为此改 `/v1/` 段公共配置（§7.1-6）；改为按桶设 SDK 超时。
- **新增 `COS_PUT_FAILED` 之类错误码**：瞬时故障重试即可，不值得同步四张错误码表（§7.3）。

---

## 16. 修订记录

### v1.8（2026-10-17 · 上线完结 + 运维清场落地）

| # | 修订 | 位置 | 性质 |
|---|------|------|------|
| 1 | staging 全流程演练（§12 十一条验收）+ prod 部署核验（步 2）、预搬（步 3）、切指针（步 4）、`--verify` 对账全部通过；2 周观察期（步 5 · D4）结束无异常 | §11 步 1–5 | 落地记录 |
| 2 | §9 运维清场执行：`docker-compose.prod.yml` 撤两个 `/data/uploads` bind mount；nginx 双环境删 `location /uploads/`（防 dotfile 段保留）；`02-prepare-dirs.sh` 移除 uploads 目录与 uid 1000 属主；`backup-db.sh` 移除 `--avatars-only` 与打包段（`--db-only` 兼容保留给 redeploy.sh / 从库 cron，历史 avatars 归档仍按保留期自然老化）；`maintenance.sh` 退役 `backup-avatars` 及 slave.env 机制（`_load_slave_env` / `_resolve_slave_host` / `do_push_avatars_offsite` 全删，install-cron 预警与 `maintenance-backup.log` touch 同步移除）；`restore-staging-from-prod.sh` 移除 avatars 段（3 步降 2 步、`--skip-db`/`--skip-avatars` 移除）；`scp-latest-backup.sh` 去 avatars 段 | §9.1–§9.3 | 清场落地 |
| 3 | 文档联动收尾：`docs/db/schema.md` `avatar_url` 取值形态、`infra/scripts/README.md` 退役注记、`infra/cos-setup.md` 状态头与 §7.2、`pg-standby-backup.md` 与 `maintenance-cron-plan.md` 的现行事实描述 | §9.4 / §10 | 文档联动 |
| 4 | `--revert` 回退窗口随清场关闭（本地文件与 nginx `/uploads/` 不再保留 · §8.7 仅存档）；宿主机 `/data/uploads` 目录删除按 §9.2 约定单独执行 | §8.7 / §9.2 | 状态记录 |

### v1.7（2026-10-17 · §7 代码落地）

| # | 修订 | 位置 | 性质 |
|---|------|------|------|
| 1 | §7 全项落地：imageMagic 共用模块（含 WEBP 收窄）/ cosClient 多桶化 / env 两键 / upload 落点切 COS / 一期 4 调用点显式传桶名 / MemoryCosStore 扩展（objectUrl + opts 记录 + 失败注入）/ upload.test.ts 新增（11 用例）/ 迁移脚本两件套 / README 登记。typecheck（含 scripts/ 纳入 tsconfig.test.json）与全量 836 测试全绿 | §7 全部 | 落地记录 |
| 2 | **SDK 实例按桶各一，而非"两个 store 共享一个 SDK 实例"**（§7.1-1 字面修正）：Timeout 是 SDK **构造级**参数（无单次请求级入口 · sdk/cos.js 默认 0=不超时），§7.1-6 的按桶超时（avatars 5s / exports 默认）在共享单实例下无法成立。两约束冲突时保超时语义；仍为桶维度惰性单例（非每请求新建），SDK 连接池复用意图不受影响 | §7.1 | 实现修正（冲突解法记录） |
| 3 | **>2MB 上传的"既有错误语义"事实纠正**：探针实锤 busboy 在 fileSize 上限**截断**而非报错，路由 `totalSize > MAX` 分支为死代码，>2MB 此前被**静默截断后 201 成功**（非文档假定的 400）。落地时按 `data.file.truncated` 判定把 2MB 闸口修活（400 INVALID_ARGUMENT），upload.test.ts U3 按修复后语义断言 | §3.1 / §7.3 / §7.5-③ | 既有缺陷实锤 + 修复（§15"2MB 闸口"论证成立的前提） |
| 4 | `--verify` ③的 LastModified 经**公开 URL HEAD** 获取（公有读桶 · 顺带验客户端真实访问路径）：§7.1 接口面 `headObject→boolean` 不扩（§15 已否决扩返回值），fetch HEAD 取 Last-Modified 头 | §8.5 | 实现注记 |

### v1.6（2026-10-17 · 方案评估复查落笔）

| # | 修订 | 位置 | 性质 |
|---|------|------|------|
| 1 | 预搬脚本的本地目录来源明确：§7.3 删的是 `upload.ts` 的写盘落点（`getUploadDir()`/`UPLOAD_DIR`），迁移脚本读冻结存量须自带同源解析（读同一 `UPLOAD_DIR` env · 缺省 `/var/costra/uploads`），写死默认值会在配过非默认 `UPLOAD_DIR` 的机器上静默"全部缺源" | §8.2 | 实现缺口补齐 |
| 2 | `mtimeMs` 浮点取整注记：`fs.stat().mtimeMs` 为浮点，切指针写 `?v=` 与 `--revert` 重建匹配串须共用同一取整函数（如 `Math.trunc`），否则 revert"精确等于"匹配静默漂移为 0 行 | §8.4 | 实现注记 |
| 3 | §9.0 新增断言③（非 NULL 且不含 `/avatars/` 的杂形态行应为 0）：①② 只覆盖含 `/avatars/` 的行，杂形态会同时逃逸两条断言、在清场后静默失效；同步"两条"→"三条"计数 | §9.0 | 校验补齐 |
| 4 | §7.1 引用行号修正：`costra.cloud.conf.prod:78` → `:79` | §7.1 | 事实纠正 |

### v1.5（2026-10-17 · 方案 review 修订落笔）

| # | 修订 | 位置 | 性质 |
|---|------|------|------|
| 1 | 渲染点 11 → **13 处**：v1.2 只按 `avatarUrl` 检索，漏了 snake_case `avatar_url` 直传的 `filter-panel`×1（`index.wxml:87`）与 `pages-gm/impersonate`×2（`index.wxml:22,50`），三处均带 `wx:if` 兜底；兜底数 10 → 12，`mine` 仍唯一无兜底 | §1 C3、§3.3、§4.2、§4.3、§4.4、§6.2、§12-2、§13、§15 | 事实纠正（二次复核） |
| 2 | §5.1"上行不占出口带宽"论证修正：客户端→服务端是入方向，但服务端 `putObject`→COS 是**出方向**（与 §8.3 同一管道）；结论（不做客户端直传）不变，理由改为"约 9 KB/次、频次极低，egress 可忽略"。顺带修正引用"§13 非目标"→ §15 | §5.1 | 事实纠正 |
| 3 | §9.0 断言②改**两域名白名单**（prod + staging 的 `COS_AVATAR_BASE`）：staging 库经 `restore-staging-from-prod` 恢复后合法持有 prod 域名行（§9.3），单 base 谓词在 staging 永不为 0、清场被永久阻塞；补"staging 清场前先重恢复"前置；`--verify` ① 同步按两域名判定，跨环境行只做① | §9.0、§8.5 | **逻辑修正**（消除 staging 清场死锁） |
| 4 | §11 步 1 回滚栏修正：回滚镜像不影响 COS 侧，期间进 COS 的新头像 URL 由客户端直连 COS 渲染、**不受回滚影响**（原文"URL 会失效 ⇒ 重上传"有误，实际回滚无损） | §11 步 1 | 事实纠正（有利方向） |
| 5 | `--verify` 补实现注记：COS `LastModified` 为秒级精度（ISO8601），与毫秒 mtime 比较须截断到秒或留 1s 容差，否则批量误报 | §8.5 | 实现注记 |

### v1.4（2026-10-17 · 预搬顺序拍板）

| # | 修订 | 位置 | 性质 |
|---|------|------|------|
| 1 | 上线顺序重排为「部署 → 部署核验 → 预搬 → 切指针 → 观察 → 清场」，**取消 v1.2"预搬须早于代码部署"的硬约束**：候选集 DB 谓词使顺序与安全无关（部署后上传的行 `avatar_url` 已是 COS 域名、天然出候选集；本地盘冻结后候选行的本地文件即终态），该硬约束防的是目录驱动覆盖缺陷，v1.2 后不再承载安全职责 | §1 C9、§1.1 D5、§8.0、§8.0.1、§8.5、§8.6、§11 | **决策变更**（2026-10-17 拍板） |
| 2 | 预搬单行处理瞬间（~0.2s/行）的并发覆盖窗口拍板接受、不处理：预搬 `putObject` 后至则 COS 为旧图 + DB 新 URL ⇒ 该用户看到上一张头像，重传即恢复 | §8.0.1 末注、§8.6、§13 | 风险接受记录 |
| 3 | 步序重排的附带收益：预搬/切指针/回退全部运行在"新镜像已在跑"的状态，§8.1 的 `docker exec` 委托形态对所有阶段成立，无需为预搬单独投递脚本 | §8.1、§11 步 3 | 附带收益记录 |
| 4 | 步号引用全量跟随（步 2.5→2、步 3→4、步 4→5、步 5→6）；§12 第 9 条顺序专项场景更新为「部署 → 预搬 → 换头像 → 切指针」 | §11、§12、§13、§14 | 跟随修订 |

### v1.3（2026-10-17 · 步 0 平台侧落地）

| # | 修订 | 位置 | 性质 |
|---|------|------|------|
| 1 | 步 0 平台侧落地：两头像桶（公有读私有写）+ `img[.stg].costra.cloud` + 证书 + DNS 全通（双 404 实测）；剩余 server.env 两键 / 云监控告警 / MP 白名单 / 生命周期截图 | §11、状态头 | 进度记录 |
| 2 | CAM 拍板保持 `resource:"*"`（控制台现状），不执行 §6.3 的 resource 扩充；约束面仍在 action 白名单 | §6.3 | 实施偏离记录（已拍板接受） |
| 3 | `infra/cos-setup.md` 新增 §7 头像桶章节（配置一览 / 404 预期信号 / CAM 实况 / env 两键 / 步 0 剩余待办），§2 加 CAM 实况注记 | §10 | 文档联动落笔 |

### v1.2（2026-10-17 · 方案二审）

| # | 修订 | 位置 | 性质 |
|---|------|------|------|
| 1 | 迁移候选集由**目录驱动**改为 **DB 驱动**（`avatar_url` 仍指本地的行）；预搬/切指针/回退三者统一；删除"人工保证重跑一次即可"的失效前提 | §1 C9、§1.1 D5、§8.0.1、§8.2、§8.4、§8.5、§8.7、§13 | **结构修正 · 消除静默回退头像的缺陷** |
| 2 | 上线顺序重排为「预搬 → 部署 → 部署核验 → 切指针 → 观察 → 清场」，预搬硬约束早于代码部署 | §11 | **结构修正**（原顺序是 #1 缺陷的触发条件） |
| 3 | `--revert` 改为**精确匹配"切换时写入的 COS URL"**；原"对这些行不处理"的描述纠正为"回退到旧图" | §8.7、§13 | 语义修正 |
| 4 | 补上传失败的失败语义：按桶设 SDK 超时（avatars 5s）+ 映射既有 `500 INTERNAL`，不新增错误码 | §7.1-6、§7.3、§13 | 缺口补齐 |
| 5 | WEBP 魔数收窄为 `RIFF` + `offset 8..12 == 'WEBP'` | §7.4 | 既有缺陷 · 由本期放大 |
| 6 | 渲染点数由 9 → **11**（`family` 6 处，`filter-panel`/`pages-gm` 无命中）；明确 `mine` 页**无占位兜底** | §1 C3、§3.3、§4.2、§4.3、§4.4、§6.2、§12-2、§13、§15 | 事实纠正 |
| 7 | `--verify` 增加域名前缀、对象存在性、`LastModified ≥ 本地 mtime` 三项校验（原仅 `headObject`） | §8.5 | 校验能力补齐 |
| 8 | 新增 §9.0 清场前置断言（两条 SQL，任一非 0 即中止清场） | §9.0、§11 步 5 | 缺口补齐 |
| 9 | 测试面纠正：`__setCosForTests` 实际消费点 2 个测试文件（非"4 个调用点"）；补 `putObject` 失败与 WEBP 判定的用例 | §7.5 | 事实纠正 |
| 10 | 落笔 §10 的四项文档联动（analysis 状态推翻 + `avatar-image` 作废 + phase1 后置注记 + redis-cache 补记），并修掉 analysis 的重复编号（两个 §4.6 → §4.6/§4.7/§4.8） | §10 及四个关联文档 | 消除仓库内互相否定的结论 |

> **v1.1 的缺陷一句话**：它假设"本地盘永远是最新的权威源"，而 §7.3 恰恰在上线后删掉了本地写盘。两者在同一份文档里共存，叠加"目录驱动 + 无条件覆盖 + mtime 做版本号"就变成一次**静默的、面向真实用户的头像回退**。v1.2 的修法不是给这条链路打补丁，而是把"该不该迁这一行"的判定从磁盘挪到 DB——那里才有"这一行的指针现在指着什么"这个事实。
