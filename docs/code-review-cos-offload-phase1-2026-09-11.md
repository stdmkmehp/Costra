# Code Review · 导入导出 COS 化一期（cos-offload-phase1）

> 日期：2026-09-11
> 范围：dev 分支工作区未提交改动（19 文件 + 4 新增 · +1024/−353）
> 需求依据：`docs/design/cos-offload-phase1-import-export.md` v0.2 · `infra/cos-setup.md`
> 结论：**可提交（修复 1 个测试断言 + 1 个运维脚本残留后）** · 核心链路与方案逐项吻合，无逻辑/安全缺陷

---

## 1. 基本信息

| 维度 | 内容 |
|------|------|
| 服务端 | `cosClient.ts`（新）、`entryExport.ts`、`entryImport.ts`、`dataJobs.ts`、`importJobs.ts`、`importDetectRepo.ts`、`env.ts`、`.env.example`、`openapi.yaml` |
| 客户端 | `fileTransfer.ts`、`data-management/index.ts`、`error-mapper.ts`（+ 两个 spec） |
| 运维 | `docker-compose.prod.yml`、`maintenance.sh`、`cos-setup.md`（新） |
| 测试 | `memoryCos.ts`（新）、`dataJobs.test.ts`、`dataImport.test.ts` |

## 2. 需求符合性（对照方案 v0.2 §5）

| 方案条目 | 状态 | 说明 |
|---------|------|------|
| §5.2.1 COS 依赖 + 惰性单例 + 5 个 env | ✅ | `getCosClient()` 对齐 `getPool()` 范式；COS_* 全 optional 惰性失败，守「运行时不读 process.env」纪律 |
| §5.2.2 导出 worker putObject + 重试清场 | ✅ | `flushPart` 直传、sha256/size 对内存 Buffer 算不变；`removeJobArtifacts` 因 CAM 无 ListBucket 改 **headObject 逐片探测**（当前月+上月双前缀），best-effort 语义对齐旧版 |
| §5.2.3 导入三类产物改造 | ✅ | 写（putObject ×2）/读（getObject + 404→ImportArtifactError 终态）/删（deleteObjects）全换 COS；两列语义改 object key，无 schema 变更 |
| §5.2.4 本地脚手架删除 | ⚠️ | 代码删净（无 `EXPORT_DIR`/`setExportRootForTests` 等残留引用），**但 `infra/scripts/02-prepare-dirs.sh` 仍 mkdir+chown 两个旧目录**（见发现 #2） |
| §5.2.5 下载路由改造（双侧） | ✅ | 鉴权/归属/未过期判定全部先于签发；410/404 语义保留；`storageMonth` 缺失兜底 404；sha256 以 /download 响应为权威源 |
| §5.2.6 purge 退役 | ⚠️ | 脚本改名 `purge-data-jobs`/`purge-detect-sessions`、30 天 DB 元数据清理保留、顺序约束注释保留；**线上旧 crontab 须靠重跑 install-cron 覆盖自愈**（见发现 #3） |
| §5.2.7 demo-csv 不动 | ✅ | 保留 `compress:false` + 服务端直出 + `downloadWithAuth` |
| §5.2.8 OpenAPI 同步 | ✅ | 双端点 200 改 JSON schema；`X-Content-Sha256` 头移除；410 保留 |
| §5.3.1/2/3/4 客户端 | ✅ | `wxDownloadNoAuth` 不带 header；`downloadViaPresign` 403 换 URL 重试一次；三调用点迁移正确；COS XML 错误体不进 JSON 解析、fallback `CLIENT_HTTP_403` 且有 spec 覆盖 |
| §5.4 测试替身 | ✅ | `MemoryCosStore` 注入两个测试文件；导出断言改 object key + 内存内容 + sha256；无 fs 残留 |

## 3. 深度审查结果

### 🛑 严重

**#1 `error-mapper.spec.ts:60` 断言与文案不自洽，单测必失败（已知预存 · 提交前须修）**

- `error-mapper.ts:91` 新文案 `账本已达 ${maxLedgerEntries} 条上限，导入受限`，代入 8000 实测 **18 字符**；
- spec 断言 `expect(mapped.desc.length).toBeLessThanOrEqual(16)` ⇒ 必红。
- 工作记忆已记录此为「用户未提交改动的预存失败，stash 验证与 COS 无关」——审查确认属实、与 COS 化无关，但**当前 working tree 里它仍然是红的**，随这批改动提交前必须修。
- 修法二选一：① 文案去两个空格 → `账本已达8000条上限，导入受限`（恰 16 字）；② 调整断言阈值。建议①，保住 toast 两行可完整显示的设计意图。

### ⚠️ 重要

**#2 `infra/scripts/02-prepare-dirs.sh` 残留旧目录创建（方案 §5.2.4「整体移除」未闭环）**

- `:60-61` 仍 mkdir `${COSTRA_DATA}/exports`、`${COSTRA_DATA}/import-staging`；`:95-96` 仍在 `RUN_AS_1000` 里 chown 这两个目录。
- compose 已撤 bind mount ⇒ 这两个目录从此无任何消费者；新部署会建出两个永久闲置目录。
- 修复：删除上述 4 行（新部署不再创建；存量机器上的旧目录可随运维窗口手动清理）。

**#3 部署顺序硬依赖：必须重跑 `install-cron`（否则旧 crontab 每日 loud fail）**

- 线上 `/etc/cron.d/costra-maintenance` 当前仍是 `purge-exports`/`purge-import-staging` 两行；新版脚本参数解析不再识别旧任务名 ⇒ 每日 04:37/04:47 两次 die 报错。
- 已核实 `do_install_cron` 是**覆盖式**写入（`printf > cron_file`），重跑即自愈，无残留风险。
- 部署 checklist 固化：① 两机 `/data/conf/server.env` 配齐 COS_* 五变量（0600）→ ② `redeploy.sh`（compose up 按 config hash 重建 server 容器，`restart` 不生效）→ ③ 重跑 `install-cron` → ④ staging 真机回归下载链路。

### 💡 建议

- **#4** `__resetCosForTests`（`cosClient.ts:177`）目前无使用方——两个测试文件都是 `__setCosForTests` 注入后即覆盖单例。对称保留可接受，亦可删。
- **#5** 历史文档未加注：`data-import-export-client-analysis.md` v1.0（§2/§7.4 仍以本地盘为现状）与 `cos-offload-analysis.md` 建议在头部加一行指针「现状已 COS 化，见 cos-offload-phase1-import-export.md」，防后人误读旧事实。
- **#6** staging 实测验证点（非代码问题）：① 服务端 putObject 走同区内网、不占 2Mbps 公网出口（导向上传方向也解耦）；② 真机预签名 URL 可下、进度条正常（COS 回 Content-Length）；③ 403 换 URL 重试路径；④ 证书 2026-12-09 到期纳入续期巡检。

### 已逐项排查确认无问题的关键点

- **安全**：私有桶 + 300s 预签名 + 鉴权/归属/过期先于签发；`report_path` 下发的是路由路径非 COS key（`importJobs.ts:109`），无 key 泄漏；CAM 五个 action 与代码调用面精确一致（签名本地计算不需额外权限）；密钥只落 server.env。
- **并发/时序**：重试清场先于人写；分片编号自 1 连续 ⇒ headObject 首个 404 即止的探测法与旧「读目录删 `<jobId>_*`」语义等价；月前缀双探覆盖跨月重试。
- **Fastify 压缩坑**：两个下载路由均为 `return reply.code(200).send({...})`，符合「async handler 必须 return」纪律；demo-csv 保留路由级 `compress:false` 正确。
- **数据一致性**：sha256 写读两侧都对 gzip 后字节计算（R16 语义不变）；`readDetectArtifactRows` 仅 404 转终态、网络/5xx 原样抛由调度层归类；orphan 对象（putObject 成功但 markReady 失败）由 30 天生命周期兜底且注释明示。
- **隐私**：commit 成功即删行产物、report 24h、僵尸会话 reaper 三处清理全部改 COS 删 + DB 清位，语义无损。
- **测试**：`app.inject` 不带 accept-encoding 零回归；MemoryCosStore getObject 返回副本防污染；X3 重试清场用例同步更新。

## 4. 总结评分

| 维度 | 评分 | 说明 |
|------|------|------|
| 需求符合性 | A− | §5 清单全落地，唯 02-prepare-dirs.sh 4 行残留 |
| 安全性 | A | 预签名/最小权限/密钥纪律/无泄漏面均到位 |
| 逻辑正确性 | A | 未发现功能性 bug；清场/重试/过期语义与旧版逐点对齐 |
| 测试质量 | B+ | 替身与断言改造到位；唯 error-mapper 一处断言自红（非 COS 引起） |
| 可运维性 | A− | 部署顺序依赖明确，须按 checklist 执行 |

## 5. Todo 清单

### 🛑 Critical（提交前必须修复）
- [ ] [Bug] `error-mapper.ts:91` desc（18 字）与 `error-mapper.spec.ts:60` ≤16 断言不自洽 —— 文案去空格至 16 字或调断言

### ⚠️ Major（建议随本批修复）
- [ ] [Cleanup] `infra/scripts/02-prepare-dirs.sh` 删除 exports/import-staging 的 mkdir（:60-61）与 chown（:95-96）
- [ ] [Ops] 部署 checklist 固化：server.env → redeploy → 重跑 install-cron（覆盖式自愈旧 crontab）

### 💡 Minor（可选）
- [ ] [Style] `cosClient.ts:177` `__resetCosForTests` 无使用方，去留皆可
- [ ] [Docs] 两份历史设计文档头部加 COS 化指针注记
- [ ] [Verify] staging 实测：putObject 内网不占出口带宽 / 真机下载链路 / 403 重试

---

## 6. 处置闭环（2026-09-11 · 发现修复记录）

- **#1（🛑）处置**：经需求方裁定，「toast 短文案必须 ≤16 字」前提不成立——`ledger_entry_limit` 恒走 modal，短文案信息不足已废弃。已从 `BUSINESS_RULE_TEXT` 删除该 key（desc 落通用兜底、modal 不展示），spec 改为锁定 detail 内容（条数 + `2026.12.31` 排期承诺）。同时修正了 detail 文案更新后 spec 未同步的 `两个月` 断言。
- **#2（⚠️）已修复**：`02-prepare-dirs.sh` 删除 exports/import-staging 的 mkdir 与 chown 共 4 行（留注释指明存量目录由运维窗口手动清理）。
- **#3（⚠️）保持部署 checklist**：server.env → redeploy → 重跑 install-cron，不变。
- **#5（💡）已修复**：`data-import-export-client-analysis.md` / `cos-offload-analysis.md` 头部各加一行 COS 化指针注记（后者区分 P2 已落地 / P1 头像未施工）。
- **#4（💡）保留**：`__resetCosForTests` 与项目既有 `set*ForTests`/`__reset*ForTests` 成对模式一致（code2Session/virtualPayClient/accessToken 均成对），保留作对称逃生舱。
