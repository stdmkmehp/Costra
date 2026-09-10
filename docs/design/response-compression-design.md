# 响应压缩（gzip）技术方案

> 状态：**v0.5 · 已落地待验证**（v0.5：§4.6 落地实况修正——「67 处」更正为 **75 处 / 19 文件**（v0.4 漏掉 8 处**幂等重放分支**，其中 `sync.ts` 那处已实锤返回空 body，根因链补至 Fastify `wrap-thenable.js` + `reply.sent` 源码级）；纠正 v0.4「试 syncThreshold=0 无效 ⇒ 与该项无关」的错误推断（`<=0` 是强制全流式，方向相反）；新增 T7 空 body 回归锁 + T8 源码静态扫描护栏。v0.4：区分双环境带宽基线——**staging 1Mbps / prod 2Mbps**（2026-09-09 用户确认）。§2.1 真机实测归 staging 基线；收益测算改以 **prod 2Mbps** 为主口径，prod 收益为按带宽比例外推的理论值、无 prod 实测佐证已如实标注；staging curl 验证数字按 1Mbps 折算避免误判。v0.3：按 `@fastify/compress@9.2.0` 源码实读修正落地细节——排除机制改路由级 `compress: false`、显式关闭请求体解压、版本线改 ^9、耗时预期与 H2 口径收紧）
> 日期：2026-09-09（v0.1）→ 2026-09-09（v0.2）→ 2026-09-09（v0.3）→ 2026-09-09（v0.4）→ 2026-09-10（v0.5）
> 上游：2026-09-09 冷启动 sync/pull「每 3 秒一页」排查（**staging 真机 vConsole 实测**）
> 事实源：`server/src/app.ts`、`server/src/routes/sync.ts`、`server/src/repositories/entryRepo.ts`、`server/src/plugins/errorHandler.ts`、`miniprogram/services/sync.ts`、`miniprogram/services/request.ts`、`miniprogram/services/fileTransfer.ts`、`infra/nginx/conf.d/costra.cloud.conf.prod`、`docs/design/sync-pull-pagination-design.md`（L13）、`@fastify/compress@9.2.0` 源码（`index.js`，v0.3 实读核验）、`fastify@5` 源码（`lib/wrap-thenable.js`、`lib/reply.js`，v0.5 实读核验）

---

## 1. 结论摘要

| # | 结论 | 依据 |
|---|------|------|
| C1 | 冷启动「每 ~3s 拉一页」**不是人为节流**：分页循环内无 delay，每页周期 = 请求 ela（2.3~2.9s）+ 落盘/让出（~0.3s） | §2.3 |
| C2 | **全链路无压缩**：Fastify 未注册 `@fastify/compress`（0 引用），nginx 生产配置无 `gzip` 指令 | §2.3 |
| C3 | 瓶颈是**未压缩 JSON 传输 × 服务器出口带宽**：**staging 1Mbps**（§2.1 实测有效吞吐 0.7~0.8Mbps 与其完全吻合），**prod 2Mbps**（250KB/s 理论上限，无 prod 实测）；DB 查询毫秒级、服务端处理预估 <100ms，均非瓶颈 | §2.3 / §2.4 |
| C4 | 之前优化不覆盖本场景：L13 管稳态增量与 UI 刷新时序，「启动秒出」管有本地缓存的设备；冷登录本地为空必须走全量串行拉取 | §2.5 |
| C5 | 方案 = **Fastify 层 `@fastify/compress`（gzip 单编码 + 1KB 阈值 + 全局压缩 + 显式关闭全局请求体解压）+ 三处文件下载路由 `compress: false` 排除**；客户端/nginx/协议零改动 | §3 / §4 |
| C6 | 预期收益（**prod 2Mbps 主口径**）：单页 230~300KB → 25~60KB（5~10x）；8,000 条全量冷启动 **~20~24s → ~8~13s**（下限受 16 轮串行的 RTT + 落盘固定成本约束，压缩后传输不再是主项）；全部 JSON API 同享。staging 1Mbps 下 ~40~48s → ~10~16s（仅供 staging 验证折算，见 §2.4 / §7） | §2.4 / §7 |

核心取舍：压缩放 Fastify 层而非 nginx 层——随镜像部署自洽（live nginx 配置需手动合并、易漂移）、压缩单出口无双重压缩风险、`app.inject` 单测可达。

---

## 2. 背景与问题原因

### 2.1 现象（2026-09-09 **staging** 真机 vConsole 实测）

> 环境说明：本节实测在 **staging（1Mbps 出口带宽）** 上采集。生产为 **2Mbps**，实测数据不直接代表 prod，仅作根因定位与压缩比佐证；prod 收益见 §2.4 按带宽比例外推。

8,000+ 条流水的账本在冷启动登录时，`/sync/pull` 以 500 条/页、每页约 3 秒的速度分页拉取，16+ 轮才能收敛：

```
19:02:00.925 [sync:pull] requesting · since=142582 limit=500 page=2
             [perf] network.request.done {"path":"/sync/pull","status":200,"ela":2383}
19:02:03.694 [sync:pull] requesting · since=143581 limit=500 page=3   (ela 2618)
19:02:06.662 [sync:pull] requesting · since=144584 limit=500 page=4   (ela 2879)
19:02:09.925 [sync:pull] requesting · since=145585 limit=500 page=5
```

读数要点：
- 相邻请求起点间隔 2.77s / 2.97s / 3.26s ≈ `ela`（2.3~2.9s）+ 页间落盘与让出（~0.3s）；
- `ela` = 客户端 `Date.now() - requestStartedAt`，截止 wx.request success 回调，即**完整往返**（连接 + 服务端处理 + 响应传输 + 原生层 JSON 解析），无更细拆分（`miniprogram/services/request.ts:122`）；
- `since=142582` 说明本机已有高水位、在补 backlog；`change_seq`（~14.5 万）远超条数——update/delete 同样烧 seq。

### 2.2 现行拉取策略（L13 已施工）

| 层 | 行为 | 出处 |
|---|------|------|
| 客户端 | `PULL_LIMIT = 500`，`while` 循环**串行**（下一页 `since` = 上一页 watermark，链式依赖无法并行）；`MAX_PULL_PAGES = 40`（2 万条/次）截断后 300ms `pull-continue` 续拉；每页 watermark 落盘可断点续传；epoch 前置比对 diff 则清零全量重拉 | `miniprogram/services/sync.ts:74-78`、`syncScheduler.ts:39` |
| 服务端 | `limit` schema 上限 500 / 默认 200；SQL 走 `idx_entries_ledger_change_seq (ledger_id, change_seq)` 索引范围扫描 | `server/src/routes/sync.ts:85`、`entryRepo.ts:389-401`、`0001_init.sql:290` |

`PULL_CONTINUE_DELAY_MS = 300` 仅在 40 页截断后启用——本场景 page=2~5 远未触及，**循环内部不存在任何人为间隔**。

### 2.3 耗时拆解与根因定位（证据链）

每页 ~3s 的逐段拆解：

| 段 | 估算耗时 | 依据 |
|---|---------|------|
| 连接建立 | ~0ms（稳态） | 客户端走 HTTP/1.1（`wx.request` 的 `enableHttp2` 默认 false，`request.ts` 未开；nginx `http2 on` 只是服务端能力），但分页间隔 <1s ⇒ keep-alive 连接复用，握手成本只在首次支付 |
| 服务端处理 | **预估 <100ms** | JWT 验签 + `isUserInFamily` + `findAllActiveByFamilyId` + 主查询（索引范围扫 501 行）+ `entryToWire`×500 序列化，全部毫秒级 |
| **响应传输 230~300KB（未压缩）** | **~2.2~2.8s · 主项**（staging 实测） | **出口带宽是硬顶**：staging 1Mbps ⇒ 理论上限 125KB/s，250KB ≈ 2.0s；实测反推有效吞吐 80~100KB/s（0.7~0.8Mbps），折损来自 TCP 慢启动/TLS 记录开销与并发竞争，与 1Mbps 完全吻合。**prod 2Mbps ⇒ 理论上限 250KB/s，同页传输下限 ~1.0s**（无 prod 实测，按带宽比例外推） |
| 客户端 JSON 解析 | <50ms | 原生层解析 250KB，可忽略 |

（上表「响应传输」段的耗时口径为 **staging 1Mbps 实测**；prod 2Mbps 下该段约减半，见 §2.4 双档测算。）

**无压缩实锤**：
- Fastify 依赖与代码中 `@fastify/compress` 0 引用（`server/package.json`、全 `src/` 搜索）；
- nginx 生产配置无 `gzip` 指令，仅 `client_max_body_size 2m`（`costra.cloud.conf.prod:121`，该限制管请求体、不管响应）；
- nginx 限流当前仅日志识别、不真限，可排除。

**带宽实锤（2026-09-09 用户确认 · 双环境）**：
- **staging 出口带宽 1Mbps** = 125KB/s 理论上限 ⇒ 250KB 单页传输下限 ~2.0s，叠加慢启动与开销即实测 2.3~2.9s——§2.1 每页 ~3s 是 staging 1Mbps 下的物理下限，不是异常；
- **prod 出口带宽 2Mbps** = 250KB/s 理论上限 ⇒ 250KB 单页传输下限 ~1.0s（无 prod 实测，按带宽比例外推；实际会因慢启动/开销略高于 1.0s）。**prod 是真实用户环境，收益测算与拍板依据以 prod 2Mbps 为主口径**（§2.4）。

次级因素（不改变主结论，但解释波动项）：
1. TCP 慢启动——新连接拥塞窗口从 ~14KB 起步，250KB 需 5~6 个 RTT 爬满，连接被回收重建时每页重新爬坡；
2. Node 事件循环被同步 CPU 阻塞——import detect 的解析 + `gzipSync` + `writeFileSync` 会让所有并发请求挨饿（2026-09-09 另一课题同日线索）。

佐证传输主导的细节：四页 `ela` 逐页增大（2315→2383→2618→2879）。每页条数相同、DB 索引扫描成本恒定，若纯服务端处理应平稳；递增更符合带宽竞争/负载爬升特征。

### 2.4 量化测算（双环境带宽 · **prod 2Mbps 为主口径**）

单条流水 wire 约 **500~600B**（`entryToWire` 输出 20 个字段：5 个 UUID、3 个 ISO 时间戳、多个常驻 null 如 `deleted_at`/`account_id`/`source_recurring_id`；`syncPullService.ts:247-269`）。

带宽换算基准：**staging 1Mbps = 125KB/s**（§2.1 实测环境）、**prod 2Mbps = 250KB/s**（真实用户环境，无 prod 实测，按带宽比例外推）。

| 项 | staging 1Mbps | **prod 2Mbps（主）** |
|---|---|---|
| 单页（500 条）未压缩 | ~230~300KB（L13 口径 ~200KB/轮） | 同（字节数与带宽无关） |
| 未压缩单页传输下限 | 250KB ÷ 125KB/s ≈ **2.0s**（实测 2.3~2.9s） | 250KB ÷ 250KB/s ≈ **1.0s**（外推，实际略高） |
| 8,000 条全量 | ~4~4.8MB · 16 轮串行 | 同 |
| 冷启动全量总耗时（压缩前） | **~40~48s**（与实测吻合） | **~20~24s**（外推：传输减半 + 16 轮 RTT/落盘固定成本） |
| gzip 后（重复键/UUID/时间戳模式） | 单页 ~25~60KB · 总量 ~500~900KB | 同 |
| 压缩后单页传输 | 25~60KB ÷ 125KB/s ≈ **0.2~0.5s** | 25~60KB ÷ 250KB/s ≈ **0.1~0.25s** |
| 压缩后单页周期 | ~0.5~0.8s | ~0.4~0.7s（RTT + 服务端 <100ms + 传输 0.1~0.25s + JSON 解析） |
| **压缩后预期总耗时** | **~10~16s** | **~8~13s** |

**关键洞察——压缩后两档带宽趋于收敛**：压缩把单页降到 25~60KB 后，传输已不是主项，单页周期转由 **RTT + 服务端 <100ms + 页间落盘/让出（16×0.3s≈4.8s 固定成本）** 主导；带宽从 1Mbps 翻到 2Mbps 对压缩后总时长的边际收益已很小（10~16s → 8~13s）。这也意味着：**压缩才是收益主体，prod 的 2Mbps 相对 staging 的 1Mbps 在压缩后差异不大**——拍板依据应落在「压缩带来的字节数下降」而非带宽档位。

压缩比取 **5~10x**（比常规文本 gzip 更高）的依据：单条 ~500B 中约 250B 是逐条完全重复的 JSON key；5 个 UUID 里 `ledger_id`/`family_id`/`category_id`/`user_id` 在 32KB 滑窗内高度重复，`id` 为 UUIDv7 前缀近似；3 个 ISO 时间戳同样共前缀；多个常驻 `null` 字段完全同形——LZ77 窗口内可匹配度远高于自然文本。

> ⚠️ prod 列全部为**按带宽比例外推的理论值，无 prod 实测佐证**（§2.1 实测归 staging）。慢启动/TLS 开销在小响应上占比更高，prod 实际单页传输会略高于 1.0s（压缩前）/ 0.1~0.25s（压缩后）。prod 真机数字须在 §7 上线后补测校准。

### 2.5 历史优化为何未覆盖本场景

- **L13 分页收敛改造**（`sync-pull-pagination-design.md`，已施工）：把「每次 sync 只拉一页」改为单 sync 内 while 循环收敛 + 每页 watermark 落盘 + 收敛后一次 SYNC_DONE 广播。解决的是**稳态增量**正确性与 UI 刷新时序，未触碰批量吞吐（其自身口径表已标「响应体 ~200KB/轮」）。
- **启动秒出**：流水/收支走本地数据库直读（`listMonthEntries`），只对**已有本地缓存**的设备有效；冷登录（新设备/清缓存/epoch 重置全量重拉）本地为空，全量拉取在首屏数据的关键路径上。

即：现状是设计内行为，不是回归；缺的是传输层优化。

---

## 3. 方案选型：Fastify 层（@fastify/compress），不动 nginx

| | Fastify 层（选用） | nginx 层 |
|---|------|------|
| 部署 | 随镜像重建 + redeploy，自洽 | 生产 live 配置在 `/data/conf/nginx/`，模板更新后需**手动合并 reload**，易漂移 |
| 压缩出口 | 唯一发生处，无双重压缩风险 | 与未来应用层压缩叠加可致双重压缩 |
| 测试可达 | `app.inject` 单测直接断言 | 单测不可达，只能 curl/真机验 |

依赖：`@fastify/compress` **^9**（v9.2.0 的 fastify-plugin 元数据声明 `fastify: '5.x'`，`index.js:735`；README 兼容表 `>=8.x → ^5.x`，v9 是当前 latest 线。v9 相对 v8 新增 `compressPayloadSync`——小 payload 走同步一次性压缩，不分配 zlib 上下文与流管道，且能给出**精确 `Content-Length`**）。

## 4. 具体改动

### 4.1 依赖

`server/package.json` dependencies 增加 `@fastify/compress`（^9，安装时取 9.x 最新）。

### 4.2 注册（`server/src/app.ts` 基础插件区，cors/sensible/multipart 之后、业务路由之前）

```ts
import compress from '@fastify/compress';

// 响应压缩：gzip 唯一协商编码（微信客户端对 br/zstd/deflate 支持未文档化，不开）；
// threshold 1KB 以下不压（小响应压缩反而可能变大 + 白付 CPU）；
// globalDecompression: false —— 本插件默认还会挂 preParsing 请求体解压 hook，
//   但客户端（wx.request / wx.uploadFile）从不压缩请求体，该路径无消费者；
//   开着反而引入未评估的失败模式：插件抛的 FST_CP_ERR_INVALID_CONTENT 不是 AppError，
//   会落进 errorHandler 分支 4 变成 500 INTERNAL（违背错误码契约）。
await app.register(compress, {
  global: true,
  globalDecompression: false,
  encodings: ['gzip'],
  threshold: 1024,
});
```

根作用域注册 ⇒ `onSend` 钩子覆盖全部路由（`/healthz`、`/v1/*` 子作用域、errorHandler 单出口的错误响应），无路由白名单硬逻辑。

`syncThreshold` 用默认值（按 `os.availableParallelism()` 推导，2 核 ⇒ 8192）：`/sync/pull` 的 250KB 响应远超阈值 ⇒ 走**流式路径**，zlib 在 libuv 线程池执行，**不阻塞事件循环**（这点同时加固 §2.3 次因 2 的顾虑）。

### 4.3 三处文件下载路由排除（路由级选项，非补丁）

`dataJobs.ts` 导出分片下载（`dataJobs.ts:326-374`）、`importJobs.ts` 检测报告下载（`importJobs.ts:567-603`）、`importJobs.ts` demo CSV（`importJobs.ts:377-418`）——均为 `Content-Disposition: attachment`，前两处**显式设置 `Content-Length`**。

排除写法是路由选项 `compress: false`（插件 `onRoute` 钩子读 `routeOptions.compress`，`index.js:65-78`）：

```ts
app.get<{ Params: { job_id: string }; Querystring: { part?: number } }>(
  '/data-jobs/:job_id/download',
  { compress: false, schema: { querystring: downloadQuerySchema } },
  async (req, reply) => { /* ... */ },
);
```

demo CSV 与报告下载两处当前无 options 对象/无 schema，需补 `{ compress: false }`。

> ⚠️ **不能用 `reply.header('x-no-compression', ...)`**（v0.2 的写法是错的）：`x-no-compression` 是**请求侧**逃生开关，插件读的是 `req.headers['x-no-compression']`（`index.js:349`），在 handler 里设响应头不会跳过压缩，只会把无意义的头发给客户端。

必须排除的理由：
- 三处响应 `Content-Type: text/csv`，mime-db 判定为 compressible ⇒ **默认会被压**；而 `removeContentLengthHeader` 默认 `true`（`index.js:135/409`）⇒ 压缩时 `Content-Length` 被移除 ⇒ 客户端 `fileTransfer.ts:147` 的 `onProgressUpdate` 进度失效。导出 CSV 可达 MB 级，进度是真实体验需求；
- 磁盘文件直发（`createReadStream`）+ 一次性下载，压缩的 CPU/收益比不划算；
- `X-Content-Sha256` 契约本就兼容（微信透明解压后字节与源文件一致，`verifyFileSha256` 不受影响），但关掉压缩语义更直白。

### 4.4 明确不动项

- **客户端**：`request.ts` / `fileTransfer.ts` 零改动。`wx.request` 由原生网络库（iOS NSURLSession / Android OkHttp）自动带 `Accept-Encoding` 并透明解压；**刻意不手动设该头**——手设后部分平台会认为"调用方自行解压"而返回原始字节，反而拿到乱码；
- **nginx**：保持无 gzip，避免双重压缩；
- **协议 / OpenAPI**：wire 字段、错误码、状态码不变；`Content-Encoding` / `Vary: Accept-Encoding` 属传输层头，不进契约。

### 4.5 与既有响应头的相容性

插件的 `setVaryHeader`（`index.js:574-583`）对已存在的 `Vary` 走 **append** 分支而非覆盖 ⇒ 与 `@fastify/cors` 可能写入的 `Vary: Origin` 共存，不会互相踩掉。

## 4.6 落地实况补记（2026-09-09 实装 · 关键修正）

实装时发现一个**方案阶段未预见、但影响正确性的硬约束**，必须配套改动，否则压缩后响应体为空：

> **`@fastify/compress` 与「async handler 里 `reply.send()` 但不 `return`」不兼容**：当响应体超过 `threshold` 触发压缩、且 handler 是 `async (req, reply) => { …; reply.code(x).send(y); }`（末尾不 `return reply`）时，Fastify 的 async handler 会 resolve 成 `undefined`，与 compress 的 `onSend` 压缩流时序冲突 ⇒ **最终响应 `Content-Length: 0`、body 为空**（`content-encoding: gzip` 头仍在，客户端解压得到空）。

- **复现边界**（实测，非推测）：`return obj` ✅；`return reply.send(obj)` ✅；`reply.send(obj)`（不 return）❌空；`reply.send(obj); return;` ❌空。与插件版本（9.1.1 / 9.2.0 同样复现）、`/v1` 子作用域、完整插件栈均无关——唯一变量是 handler 是否 `return` 了 `reply.send()` 的结果。
- **佐证**：社区有同类报告（fastify/fastify-compress Issue #237「Empty reply data in Fastify async route」）。但本仓库的精确边界以上表实测为准。

#### 4.6.1 根因链（v0.5 · Fastify 5 源码级，替代 v0.4 的现象描述）

`reply.sent` 的语义是「响应**已写完**」而非「已调用过 send」：

```js
// fastify/lib/reply.js:98-103
  sent: { get () { return (this[kReplyHijacked] || this.raw.writableEnded) === true } },
```

async handler resolve 后由 `wrapThenable` 兜底补发：

```js
// fastify/lib/wrap-thenable.js:31-42
      if (payload !== undefined ||
        (reply.sent === false && reply.raw.headersSent === false && …)
      ) {
          reply.send(payload)
```

于是两条路径分岔：

| 场景 | handler resolve 时状态 | wrapThenable 行为 |
|---|---|---|
| **无压缩**：onSend 链同步完成，`res.end()` 当场执行 | `writableEnded=true` ⇒ `sent=true` | 条件 false ⇒ 不补发，正常 |
| **压缩生效**：compress 的 onSend 是 **async**、返回压缩流，`send()` 立即返回而响应未落地 | `writableEnded=false`、`headersSent=false` | 条件成立 ⇒ `reply.send(undefined)` ⇒ 走 `payload === undefined` 分支重跑 onSend ⇒ `res.end()` 空体，把压缩流那条路顶掉 |

推论：**只要 handler 显式 `return reply`，`payload !== undefined` 即短路补发**，与压缩是否异步无关 ⇒ 修法是根治而非规避。

> ⚠️ **v0.4 的一处错误推断已纠正**：v0.4 写「已试 `syncThreshold: 0` 无效 ⇒ 与 syncThreshold 无关」。但插件源码 `compressPayloadSync` 首行是 `if (params.syncThreshold <= 0 || payloadSize > params.syncThreshold) return null`（`index.js:231`）——`<= 0` 是**强制全部走流式**，与意图相反，故"无效"是必然。真要靠该项规避须设极大值（如 `Infinity`）让压缩全同步。**仍否决该路线**：同步 zlib 把 250KB 压缩 CPU 压在事件循环上，直接推翻 §4.2「zlib 在 libuv 线程池、不阻塞事件循环」的前提，并与 §2.3 次因 2 撞车——属于用全局性能换局部写法自由。

#### 4.6.2 根治改动（v0.5 修正范围：67 → **75 处 / 19 文件**）

把 `server/src/routes/*.ts` 中所有「表达式语句形态的 `reply.send(...)`」统一改为 `return reply.code(x).send(y)`，并删除其后冗余的 `return;`。这是 Fastify 官方对 async handler 的推荐写法（始终显式 return），语义等价、非为插件打的硬补丁。

v0.4 声称 67 处，实际**漏 8 处**——全部是**幂等重放分支**（缩进在 `if (cached)` 内、不在行首，v0.4 的批量检索按行首模式匹配故整类漏掉）：

| 位置 | 端点 | 重放响应 | v0.4 下的状态 |
|---|---|---|---|
| `sync.ts:241` | `POST /sync/push` | 200 + `{results:[…]}`（200 op 时数 KB） | **已实锤空 body** |
| `families.ts:230` | `POST /families` | 201 + family | 越 1KB 即炸 |
| `families.ts:366` | `POST /families/{id}/invites` | 201 + invite | 同上 |
| `families.ts:413` | `POST /families/invites/accept` | 200 + 家庭详情（含成员列表） | 同上，最易越 1KB |
| `families.ts:292` / `:446` | `DELETE /families/{id}` / `members/me/leave` | 204 + null | 无 body 恒不压，安全但同构 |
| `budgets.ts:95` | `GET /budgets` 无预算 | 200 + 字面 `'null'`（4B） | 恒低于 threshold，安全但同构 |
| `importJobs.ts:414` | `GET /import-jobs/demo-csv` | text/csv | 靠 §4.3 `compress:false` 兜住，安全但同构 |

实锤方式（临时探针，验证后删除）：同一 `Idempotency-Key` 先以 `identity` 打一次落幂等缓存（4,523B），再带 `accept-encoding: gzip` 重放，真实 HTTP 取原始字节 ⇒ `status 200 / content-encoding: gzip / rawLen 0`。

线上触发面（客观说明，不改变必修判断）：客户端 `drainBatch` 每次生成新 `batchKey`（`outbox.ts:316`），`request.ts:129` 的 401 续签重放虽复用 key 但首请求未进 handler、不落缓存 ⇒ **当前线上不可达**。一旦触发，`pushDelta` 拿到空体 ⇒ `results=[]` ⇒ 全批按 `NO_RESULT` 走 `ackResultsBySeq` 可重试分支重入 index（非永久丢数，但 retries 虚增 + 易转 conflict）。

**豁免项**：`plugins/errorHandler.ts:97` 的 `reply.code().send()` 不 return 是安全的——`setErrorHandler` / `setNotFoundHandler` 传入的是**同步** handler，不经 `wrapThenable`，无竞态。已在该处加注释锁定「若改 async 必须同步改 return」。

#### 4.6.3 测试侧限制与护栏

- `app.inject`（light-my-request）对「压缩后走流式 pipeline」的响应**捕获不到 body**（`rawPayload` 为空、`content-length: 0`）。故 T1/T7 的字节级 gunzip 断言用**真实 HTTP server**（`app.listen({port:0})` + Node `http.request`，Node 不自动解压，正好拿原始 gzip 字节）；T2/T3/T5/T6 只看响应头/行为，继续走 inject。
- **护栏为何不是 ESLint**：server 侧 ESLint 尚未接线（`server/package.json` 的 `lint` 是 `echo … && exit 0` stub，COSTRA-117 deferred）。为一条规则引入整套 eslint 依赖不划算，故改用**源码静态扫描测试**（T8）落在 vitest 里——零新依赖，且 CI `pr-check.yml` 已跑 `npm test`（server），新增违规会被直接挡下。
- **反向验证（非假绿）**：临时把 `sync.ts:241` 改回旧写法后，T7 报 `expected 0 to be greater than 0`、T8 精确输出 `sync.ts:241: reply.code(check.cached.statusCode).send(check.cached.body);`，二者同时红灯；改回后 7/7 绿。

## 5. 测试方案

既有测试全部走 `app.inject` 且**不带 `Accept-Encoding` 头** ⇒ 插件在 `onSend` 里 `getEncodingHeader` 返回 null ⇒ 恒走 identity 路径，零回归面（选 Fastify 层的关键测试优势，已对源码 `index.js:353` 核验）。

新增 `server/test/compress.test.ts`（**7 用例全绿**；T4 落在 `dataJobs.test.ts` 的下载测试，贴近唯一消费者）：

| 用例 | 内容 |
|------|------|
| T1 | 带 `accept-encoding: gzip` 请求大 JSON（`/v1/sync/pull` 造 40 条）⇒ `content-encoding: gzip`、`vary` 含 accept-encoding、`gunzipSync(body)` 后与 identity 响应逐字节一致。**用真实 HTTP server 而非 inject**（见 §4.6 测试侧限制），Node http 客户端拿原始 gzip 字节 |
| T2 | 不带 `accept-encoding` ⇒ 无 `content-encoding`，body 原文 |
| T3 | 小响应（`/healthz`，<1KB）带 gzip 头也不压缩（threshold 生效） |
| T4 | 导出下载路由带 `accept-encoding: gzip` ⇒ 无 `content-encoding`、**`Content-Length` 保留**、`X-Content-Sha256` 不变（锁定 `compress: false` 语义；落在 `dataJobs.test.ts`） |
| T5 | `accept-encoding: identity` 显式 ⇒ 不压缩 |
| T6 | 带 `content-encoding: gzip` 的**未压缩明文** JSON 请求体 ⇒ 插件**不介入**解压（`globalDecompression: false` 生效），Fastify 忽略该头按明文解析，登录正常走通（200），不出现 `FST_CP_ERR_*` 非契约错误 |
| **T7** | **空 body 回归锁（§4.6）**：同一 `Idempotency-Key` 二次打 `/v1/sync/push`（40 op）走幂等重放分支 —— 先断言首发 >1KB 确保压缩真会介入，再断言重放 `content-encoding: gzip` 且 **body 非空、gunzip 后与首发逐字节一致**。用真实 HTTP server |
| **T8** | **护栏（源码静态扫描）**：扫 `src/routes/*.ts`，禁止出现「语句以 `reply` 开头且本行调用 `.send(`」的表达式语句（即未 return 的 send）。链式换行写法（`return reply` 起头、`.send(csv)` 单独成行）不误判 |

## 6. 部署与回滚

- 部署：常规 `redeploy.sh` 镜像重建；**无 migration、无 nginx 变更、无新环境变量、无新错误码**；
- 回滚：镜像回滚即恢复（压缩无状态、无持久化副作用）；
- 顺序：先 staging（`stg.costra.cloud`）curl 验证，再上生产。

## 7. 验证方案

> 环境口径：**staging（1Mbps）用于 curl 快速验证**，其 `time_total` 须按 1Mbps 折算解读、不可直接套到 prod；**prod（2Mbps）是真实收益环境**，上线后补真机计时校准 §2.4 的外推值。

**staging curl 量化对比**（压缩率与传输耗时）：
- `curl -H "Accept-Encoding: gzip" -w '%{size_download} %{time_total}'` vs 不带头，打 `/v1/sync/pull`；
- 检查响应头 `content-encoding: gzip` + `vary: accept-encoding`；
- 注意：`size_download` 降幅（≥5x）与带宽无关，是**跨环境稳定判据**；`time_total` 在 staging 1Mbps 下会比 prod 2Mbps 慢约一倍，只看 staging↔staging 压缩前后的相对降幅，不横比 prod。

**服务端耗时观测**（顺带补上排查缺口）：Fastify 在 logger 开启时**默认每请求输出含 `responseTime` 的完成日志**（本仓库未设 `disableRequestLogging`）——先 grep 生产 `server.log` 确认（取决于生产 `logLevel` 是否 info；缺 request 行则把「补齐请求耗时日志」作为前置小改动）。压缩前后对比 `/sync/pull` 的 `responseTime`，增量应 <10ms/页（250KB gzip level 6 约 2~6ms CPU）。`responseTime` 是服务端处理耗时、不含出口传输，与带宽档位无关，staging/prod 同口径。

**真机回归（iOS + Android，项目惯例）**：
1. **放行门**：用 `RequestTask.onHeadersReceived` 打一条响应头日志，确认真机确实收到 `content-encoding: gzip` 且 `res.data` 正常解析——这是本方案唯一需要真机证伪的假设（见 §8）；
2. 冷启动全量拉取计时（**prod 2Mbps 环境**）：压缩前 ~20~24s → 预期 **~8~13s**；vConsole 单页 `ela` 压缩前 ~1.0~1.5s → 预期 ~0.4~0.7s。（staging 1Mbps 对照：压缩前 ~40~48s → 10~16s、单页 2.3~2.9s → 0.5~0.8s）；
3. 导出 CSV 下载：进度显示正常、不出现 `CLIENT_CHECKSUM_MISMATCH`、分享打开正常；
4. 导入报告 / demo CSV 下载回归；
5. 稳态增量同步、记账 mutation 推拉回归（小响应不压缩行为不变）。

**验收判据**（避免"生效了却被判不达标"）：以**与带宽无关、可直接归因**的两项为硬判据——①响应头含 `content-encoding: gzip`；②staging curl `size_download` 降幅 ≥5x。总时长（prod ~8~13s / staging ~10~16s）与单页 `ela` 均为**外推/推论值，仅作参考**，不作达标红线——因压缩后瓶颈让位于串行 RTT + 落盘固定成本，且 prod 数字无实测基线（§2.4）。

## 8. 风险与缓解

| 风险 | 等级 | 缓解 |
|------|------|------|
| 微信端 gzip 行为端差异（带了 `Accept-Encoding` 却不解压 ⇒ JSON.parse 乱码） | 低 | **失败模式非对称**：若微信压根不带该头，插件直接不压（`index.js:353`），改动退化为 no-op、不会坏；真正需证伪的只有"带头却不解压"一种 ⇒ 只协商 gzip 单一编码 + §7 真机放行门验证 + 兜底镜像回滚 |
| 下载路由 `Content-Length` 丢失 → 进度失效 | 中 | §4.3 路由级 `compress: false` 排除 + T4 测试锁定（v0.2 的 `x-no-compression` 响应头写法无效，v0.3 已修） |
| 插件默认请求体解压引入非契约 500 | 中 | §4.2 `globalDecompression: false` 显式关闭 + T6 锁定 |
| **async handler 未 return `reply.send` ⇒ 静默返回空 body**（症状不报错、极难归因） | **中** | §4.6 全量 75 处改为 `return reply.send(…)` + T7 回归锁 + T8 源码扫描护栏（CI `npm test` 拦新增）；`errorHandler.ts` 同步 handler 已注释豁免 |
| 压缩 CPU 开销 / 阻塞事件循环 | 低 | 250KB 走流式路径，zlib 在 libuv 线程池执行，不阻塞事件循环；量级 2~6ms/页；上线后 `server.log` `responseTime` 监控 |
| 双重压缩 | 已消除 | nginx 保持无 gzip（已核 `infra/nginx/conf.d/` 无任何 `gzip` 指令），压缩单出口在 Fastify |

## 9. 与相邻决策的关系

- **出口带宽硬顶下（staging 1Mbps / prod 2Mbps），「减少字节数」是唯一能缩短总时长的杠杆**：提页大小（500→1000）只省 RTT/固定开销、对传输总时长几乎无效；分段并行在单连接已占满带宽时也无总收益。这从根本上论证了压缩是本场景的第一优先级，与带宽档位无关（§2.4 已示压缩后两档趋于收敛）。
- 与 **PULL_LIMIT 500→1000**（需同步 `routes/sync.ts` schema maximum + OpenAPI + 客户端常量）完全解耦，可独立先上；压缩落地实测后再决定是否仍需提页大小（压缩后单页 ~25~60KB、传输在 prod 2Mbps 下仅 ~0.1~0.25s，串行 RTT 与页间落盘占比上升到主导地位，提页大小省往返的边际收益需重新测算——按 §2.4 推算此时反而可能成为下一个杠杆）。
- 不阻塞、也不解决 **storage 10MB 撞顶** 课题（2026-09-09 实锤，客户端落盘侧：P0 写失败中止 + 水位不推进 / tombstone 不落本地 / 去双层 envelope，照旧独立排期）。若后续提页大小，单页落盘量翻倍会更快撞顶，两课题有耦合。
- **prod 已是 2Mbps**（2026-09-09 用户确认）：升档本身只把压缩前传输减半（§2.4 40~48s→20~24s），对压缩后总时长边际很小（压缩后两档仅 10~16s→8~13s）；**字节数与带宽是两个独立乘子**，压缩的收益在 2Mbps 下依然完整成立，且 staging（1Mbps）会因压缩获益更明显。若未来数据量继续增长（用户账本已达 ~1.6 万条且仍在增长）需进一步升档，属成本决策，与本方案正交。
