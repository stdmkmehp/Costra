# Costra Redis 业务缓存 · 技术设计文档

- 状态：**⚠️ 实现已回滚 · 本文档仅作决策留档，不再描述线上现状**
  - **2026-08-28 回滚**：v1.0~v1.3 的全部实现（`server/src/services/cache.ts`、`cachePreheat.ts`、统计/预算/members 读缓存、全部 generation 失效挂钩、登录预热）已从工作区撤销，统计与预算回归 PostgreSQL 实时聚合。详见 §14。
  - 回滚时**保留**了两部分与缓存无因果关系的代码修复，它们不在本文档范围内：`entryService` 跨账本写入漏洞修复（事务内 active membership 校验 + canonical ledger UUID + 事务内读）、`statisticsService` 一级分类直记折叠修复。
- 日期：2026-08-24（2026-08-27 修订 · 2026-08-28 回滚）
- 版本：v1.4（回滚留档）
- 实现落点：
  - 缓存唯一出口：`server/src/services/cache.ts`（`cachedGet` / `invalidateLedgerCache` / `invalidateFamilyCache` / `invalidateFamilyCaches` / `acquireCachePreheatLock` / `registerCacheLogger` / `getCacheMetrics`）
  - 登录预热：`server/src/services/cachePreheat.ts`（`authService.wxLogin` 登记为 app 后台任务并经 `setImmediate` 延后执行；GM impersonate/refresh 不触发）
  - 读路径接入：`statisticsService`（完整聚合 loader + 缓存外展示装配/排序/截断）、`budgetService`、`familyService.getMembersCached`
  - 失效挂钩：`entryService`（create/update/softDelete）、`sync push`（批末按 ledger 去重）、`recurringScheduler`（COMMIT 后）、`budgetService`、`familyService`、`routes/users` PATCH me
  - 日志：生产 `buildApp` 用 `registerCacheLogger(app.log)` 注册并在 close 时精确注销，缓存模块不创建独立 stdout logger
  - TTL 集中配置：`ttl().cacheHitSec / cacheNullSec / cachePreheatLockSec`（`.env.example` 已登记）
  - 测试：`server/test/cache.test.ts`、`server/test/cache-invalidation.test.ts`，并在 recurring E2E 覆盖调度写后失效
- 关联：
  - 服务端 Redis 基建：`server/src/db/redis.ts`（getRedis 单例 · setRedisForTests 注入 ioredis-mock）
  - TTL 集中配置：`server/src/config/ttl.ts`
  - 同步协议事实源：`server/src/services/syncPullService.ts`（change_seq watermark · categories_revision）
  - 部署配置：`infra/docker-compose.prod.yml`（redis 服务 §130-189）
  - 日志规范：`docs/design/logging-strategy-spec.md`（级别语义 · 周期降噪）
  - 客户端缓存体系：`miniprogram/services/{statisticsApi,familyApi,budgetApi,ledgerBalanceApi,prefetch}.ts`

---

## 0. 背景与目标

### 0.1 改造前现状

- Redis（prod：redis:7-alpine · AOF everysec · maxmemory 512mb allkeys-lru；宿主机端口仅发布到 127.0.0.1，容器内监听 0.0.0.0）原先仅承载 `refresh:{jti}` 会话热路径探测，DB 永远为真源，尚无通用业务缓存封装。
- 服务端 GET 原先直打 PostgreSQL，读路径成本分层明显：
  - **贵**：统计 monthly（多路 GROUP BY + 区间行拉取）与 yearly（一年全量原始行拉回 JS 分桶，`statisticsRepo.ts:110-152`，P95 目标 ≤800ms）；
  - **中**：`GET /budgets`（3 次 SQL，含 `SUM(amount)` 月支出 `budgetService.ts:86-101`）、`GET /entries` 排序分页（缺 `(ledger_id, updated_at)` 复合索引）；
  - **便宜**：余额（`ledgers.balance_cents` 物化主键单查）、members JOIN 单查。
- 客户端已有完整本地层：流水本地 KV 直读秒出，各 API 模块级 SWR（5min TTL 为主）+ SYNC_DONE 失效 + prefetch 预热。**服务端缓存的价值定位：客户端 SWR 失效后那次回源的加速，以及削 PG CPU。**

### 0.2 目标

1. 统计页回源从数百 ms 降至 ~1ms（命中时），削掉重复聚合的 PG CPU。
2. 数据一致性：读写之间秒级最终一致；两条红线——sync 协议不被缓存污染、记账后统计不失效超过 TTL。
3. 登录后预热用户大概率用到的数据，与客户端 prefetch 形成接力。

### 0.3 非目标

- 不缓存 sync pull 响应、鉴权结果、账本余额、refresh token 之外的会话数据。
- 不改动任何 API 契约（响应体/错误码/OpenAPI 全部不变，缓存对客户端透明）。
- 不动 PG schema（无 migration）。

---

## 1. 决策记录（2026-08-24 评审拍板）

| # | 决策点 | 结论 |
|---|--------|------|
| A | 失效机制 | **随机 generation 版本戳**（key 内嵌高熵 token，写后替换；不做通配 DEL）。禁止把缺失/读取失败映射成固定默认值，彻底避免 LRU 淘汰指针后旧 key 复活 |
| B | Redis 持久化 | **保留 AOF everysec 现状**。业务 key 与 generation 均随 AOF 持久化；即使 generation 被 `allkeys-lru` 单独淘汰，重新初始化的新随机 token 也不会指向历史 key |
| C | 预热范围 | 当月统计 all 视图 + members + 当月预算，**三者一起** |
| D | entries 水合缓存 | **暂不进入范围**（流水客户端本地直读已覆盖感知延迟；冷启动水合为低频路径） |
| E | 落地节奏 | **不做"先观测一周"的保守停顿**，P0→P1→P2 连续推进；观测指标照常内建 |

---

## 2. 缓存范围与 Key 设计

### 2.1 Key 形态总表

业务 key 统一使用显式 schema namespace `cache:v1:`（与既有无前缀的 `refresh:{jti}` 区分，也允许未来 payload/key 语义升级时整体切换 namespace）。值统一 JSON envelope `{"v":<payload>}` 序列化——envelope 使"缓存了 null"（`{"v":null}`）与"未命中"（Redis nil）可区分，支撑预算空态缓存。

**展示名不入缓存原则（统计域）**：统计响应体内嵌的 `family_name` / `ledger_name` / `category_ranks[].category_name` / `icon` 等展示名字段**不写入缓存 payload**，缓存保存全部一级分类的聚合数值与 `category_id`，不在 loader 内按名称排序或按 topN 截断。service 每次读取当前名称后再排序并截断（见 §7），因此分类改名时连 topN 边界集合也保持实时正确；不同 topN 请求复用同一份聚合缓存。

| Key 形态 | 示例 | TTL | 说明 |
|---|---|---|---|
| `cache:v1:stats:monthly:{ledgerId}:{YYYY-MM}:{userId\|all}:g{generation}` | `cache:v1:stats:monthly:7f3…:2026-08:all:g550e…` | 300s ±10% 抖动 | 完整月度聚合；不含 topN/展示名 |
| `cache:v1:stats:yearly:{ledgerId}:{YYYY}:{userId\|all}:g{generation}` | `cache:v1:stats:yearly:7f3…:2026:all:g550e…` | 300s ±10% | 完整年度聚合；不含 topN/展示名 |
| `cache:v1:family:members:{familyId}:g{generation}` | `cache:v1:family:members:9c1…:g550e…` | 300s ±10% | `listMembersWithUsers` JOIN 结果 |
| `cache:v1:budget:{ledgerId}:{YYYY-MM}:g{generation}` | `cache:v1:budget:7f3…:2026-08:g550e…` | 命中 300s ±10%；**null 60s ±10%** | null 防穿透；spent 随流水变化，与流水共用 ledger generation |
| `cache:v1:generation:ledger:{ledgerId}` | UUID token | 不过期（可被 LRU） | 账本域 generation；缺失时 `SET NX` 原子初始化随机 token |
| `cache:v1:generation:family:{familyId}` | UUID token | 不过期（可被 LRU） | 家庭域 generation；淘汰后生成新 token，不会回退旧值 |
| `cache:preheat:lock:{userId}` | `1` | 300s（SET NX） | 登录预热限流锁；通过缓存唯一出口访问 |

### 2.2 明确不缓存

| 对象 | 理由 |
|---|---|
| sync pull 响应 | watermark 单调性是同步协议铁律（`entries_change_seq` CACHE 1，`0016` 迁移）；缓存引入漏行风险且零收益 |
| 鉴权/membership 校验 | `family_members` JOIN 每次请求照常执行；缓存只存授权之后的业务 payload，杜绝"成员被移出后仍读到缓存" |
| 账本余额 | `balance_cents` 已物化，主键单查极便宜 |
| 统计 drill-down（L2/L3） | 低频 + 组合爆炸；客户端已有 `_drillCache`，列为后续项 |
| entries 分页 | 决策 D |
| 头像二进制 | 头像由 nginx `/uploads/` 直服静态文件，不经过 Node（见 §12 后续项） |

### 2.3 容量估算

单活跃家庭单代热数据 ≈ 月度统计（2 个热月 × (1 all + ≤8 成员视图) × ~5KB）+ 年度（(1+8) × ~10KB）+ members ~2KB + budget ~0.2KB ≈ **<300KB**。generation 轮换不会立即删除旧 payload；高频“写入后立即读取”会在 TTL 窗口内留下多代不可达 key，因此实际峰值还需乘以窗口内回填代数，不能仅凭单代估算断言无容量风险。上线观测 `used_memory`、`evicted_keys` 与 `cache:v1:*` key 数，接近内存水位时降低 TTL 或扩容。

`cache:v1:generation:*` 指针不设 TTL（每 ledger / family 各一个 UUID，约百字节量级），长期总量随家庭数线性增长且远小于业务 payload；内存压力下由 `allkeys-lru` 正常淘汰，淘汰后重新初始化的随机 token 不会指向历史 key（§4.1）。

---

## 3. 读写模式：`server/src/services/cache.ts`（新建 · 唯一出口）

全项目业务缓存的唯一读写出口，禁止业务代码直接调 `getRedis()` 操作 `cache:*` key。API 面：

```ts
// 读：cache-aside。scope 用于 generation 隔离；命中返回值，未命中回源并写回。
cachedGet(domain, scope, keyParts, ttlSec, loader, opts?): Promise<T>

// 失效：写事务提交后 await；内部吞 Redis 异常并聚合 warn，不反转已提交业务事务。
invalidateLedgerCache(ledgerId): Promise<void>
invalidateFamilyCache(familyId): Promise<void>
invalidateFamilyCaches(familyIds): Promise<void>  // familyIds 由业务层在资料写入前解析

// 预热锁与观测。
acquireCachePreheatLock(userId, ttlSec): Promise<boolean>
registerCacheLogger(app.log): () => void  // 返回仅注销当前 app 的 cleanup
getCacheMetrics(): CacheMetrics
```

### 3.1 cachedGet 读路径（伪码）

```
generation = GET cache:v1:generation:{scope}
if generation == nil:
    candidate = randomUUID()
    SET generationKey candidate NX
    generation = candidate 或重读并发胜者
if generation 读取/初始化失败:
    miss++ → singleflight(degradedKey, loader)   // 完全绕过业务缓存

key = `cache:v1:{domain}:{keyParts}:g{generation}`
raw = GET key
if raw != nil: hit++ → return decodeEnvelope(raw)
miss++ → singleflight(key, async () => {
    二次 GET 复查（防并发重复回源）
    value = await loader()
    SET key JSON.stringify({v:value}) EX jitter(ttlSec)
    return value
})
```

### 3.2 内建横切能力

| 能力 | 实现 |
|---|---|
| **Fail-open 降级** | Redis 客户端通过 `REDIS_COMMAND_TIMEOUT_MS`（默认 1000ms）限制单命令等待；业务 GET/SET 异常或超时不影响请求，generation 读取/初始化失败时禁止猜测默认值，直接回源 PG。失效写失败不反转已提交事务，由 TTL 兜底 |
| **Singleflight** | 进程内 `Map<key, Promise>` 合并同 generation/key 的并发回源；Redis 整体不可用时也按 degraded key 合并回源，防故障期间击穿 PG |
| **TTL 抖动** | `ttl * (0.9 + random*0.2)`，防同时过期雪崩 |
| **序列化/版本化** | JSON envelope `{"v":...}`；loader 返回 undefined 视为错误；key namespace `cache:v1:` 隔离未来 schema 变更 |
| **null 缓存** | 仅 budget 域启用，独立 60s 短 TTL 参数 |

---

## 4. 一致性保证：随机 Generation 失效机制

### 4.1 原理

1. 填充缓存前读取 `cache:v1:generation:{scope}`；缺失时用 `SET NX` 原子初始化 UUID，并把 token 拼进业务 key。
2. 任何写事务**提交后**以新 UUID 替换对应 generation，调用方等待 Redis 命令完成后再返回；Redis 异常在缓存层吞掉并记录聚合 warn，不反转已提交业务事务。
3. 替换生效瞬间，旧 generation 的所有 key **逻辑失联不可达**；旧 key 不主动删，靠 TTL 自然回收。
4. **并发填充安全**：填充途中发生写入时，即使旧 generation key 随后写回，也已经不可达；新 generation 下次读必然回源。
5. **淘汰安全**：`allkeys-lru` 若只淘汰 generation 指针，下一次读取会生成全新随机 token，不会像固定默认 `0` 那样重新指向尚存的历史业务 key。
6. **读取故障安全**：generation GET/初始化异常返回“不可用”状态，读路径直接回源，绝不把异常映射成某个可能存在的 generation。

不采用 `KEYS`/`SCAN` 通配删除的原因：无法枚举某 ledger 被缓存了哪些月份×成员组合，且线上 SCAN 有性能风险。

### 4.2 失效触发点挂钩清单（写路径全覆盖）

统一原则：**写事务提交后、业务响应返回前等待失效完成**。Redis 失败由失效 API 内部吞掉并聚合 warn，因此不会反转已经提交的 PostgreSQL 事务；异常时由 TTL 最长 330s（300s 基准 +10% 抖动）兜底。唯一例外是登录预热本身按设计异步执行。

| 写入源 | 位置 | 失效动作 |
|---|---|---|
| 流水 create | `entryService.createWithIdempotency` | 同一事务内按 ledger→family 校验 active membership，所有读写使用 DB 返回的 canonical ledger UUID；service 自持事务提交后 `await invalidateLedgerCache(ledgerId)` |
| 流水 update | `entryService.updateWithVersion` | 提交后同上（当前模型单 entry 不跨 ledger） |
| 流水 softDelete | `entryService.softDelete` | 提交后同上 |
| sync push 批次 | `routes/sync.ts` 逐 op 走 entryService | service 通过 `onCommittedLedgerWrite` 登记成功提交的 ledger；路由在 `finally` 批末去重并逐 ledger 等待一次失效，部分成功后异常也不会漏失效 |
| 定时记账调度器 | `recurringScheduler.processRuleInTx` | 注入 client 时 entryService 不提前失效；scheduler 在 COMMIT 完成且 client 释放后 `await invalidateLedgerCache`；`stop()` 等待所有在途 tick 落定后才允许关闭 Redis |
| `PUT /budgets`；`deleteBudget`（service-only，当前无 DELETE 路由） | `budgetService` 写成功后 | 先 `await invalidateLedgerCache`，再执行可能失败的 spent 响应装配查询，避免“写已提交但失效未执行” |
| 成员增减/离开/移除/邀请接受/解散 | `familyService` 各 mutation | 事务提交后 `await invalidateFamilyCache(familyId)` |
| 成员改色 | `familyService.updateMyColorChoice` | 写成功后 `await invalidateFamilyCache` |
| family 改名 | `familyService.updateFamily` | **不失效**：members payload 不含 family name；统计的 family/ledger 展示名缓存外实时读取，聚合数值不受改名影响 |
| `PATCH /users/me` 或兼容 `POST + X-HTTP-Method-Override: PATCH`（昵称/头像） | `routes/users.ts` | 资料写入前后各查询一次全部在册家庭（含 left），失效两次快照并集，覆盖并发加入家庭；写前查询失败则不写，写后查询失败只记录 warn 并用写前集合兜底，避免已提交更新误报失败 |
| `PATCH /ledgers/:id/balance` | `ledgerRepo.rebaseBalance` | **不挂钩**（余额不入缓存） |

### 4.3 两条红线（不可违背）

1. **sync pull 一律不缓存**：watermark 推进、软删行下发、`categories_revision`、`ledgers[]` 全量状态下发，全部实时查 PG。
2. **鉴权不进缓存**：membership JOIN 每次请求照常执行，缓存键/值均不含权限判定。

### 4.4 一致性窗口

- 正常路径：写提交 → 等待 generation 轮换完成 → 返回业务响应 → **紧随响应的下一次读即新数据**。
- 异常路径：generation 轮换失败 → 聚合 warn + 旧缓存存活至 TTL（普通最长 330s，budget null 最长 66s）；缓存故障不把已经提交的业务写误报为失败。

---

## 5. 预热能力

### 5.1 登录预热（决策 C：三者一起）

- **触发点**：`POST /auth/wx-login` 登录签发成功后（`authService` persistSession 之后），`setImmediate` fire-and-forget，**不阻塞登录响应**。token 静默续签不触发（session 延续，缓存大概率仍热）。
- **预热内容**（按有效的 `preferred_family_id` 定位，失效时回退个人家庭）：
  1. 当月统计 all 视图；调用参数仍取 `top_n=50`，但缓存保存完整排行且 key 不含 topN，后续任意 topN 均可复用；
  2. `GET /families/{id}/members` 对应 payload；
  3. 当月 budget（含 null 语义）。
- **明确不预热单成员统计**：成员组合随家庭人数线性增长且命中率低，避免一次登录并行打出 `1 + activeMembers` 份昂贵聚合。
- **填充方式**：调用与实时请求相同的 public service，复用同一 `cachedGet` loader/key 与 singleflight，禁止维护第二套预热 key。
- **限流与失败**：`acquireCachePreheatLock` 执行 `SET cache:preheat:lock:{userId} 1 NX EX 300`；Redis 锁失败由缓存层聚合 warn 后跳过。三个预热子任务并行且全部落定，业务子任务失败汇总后由 `authService` warn 并吞掉，不影响登录响应。
- **生命周期与接力**：预热 Promise 在登录返回前已登记到 app 后台任务集合，实际工作经 `setImmediate` 延至下一轮事件循环；`app.close()` 会排空已登记任务，避免关停/测试重置后继续写缓存。生产默认开启，`NODE_ENV=test` 的 `buildApp` 默认关闭，专项测试可用 `enableLoginPreheat: true` 开启。客户端 `prefetch.ts` 通常随后发起请求；月份与 family/ledger 定位一致是命中的前提，topN 已不再构成错位维度。

### 5.1.1 已知风险：预热与客户端请求的"重复拉取"（显式接受，不做重防护）

预热的收益前提是"预热填充的 key 与客户端后续请求的 key 完全一致"。**绝大多数登录场景下该前提成立，属净提效**；但存在少数边界场景会退化为"同一份数据在 PG 上被聚合两次"（预热一次 + 客户端未命中再回源一次），反而多压一次最贵查询：

| 边界场景 | 是否已被防住 | 说明 |
|---|---|---|
| 预热与客户端请求**同时在途**（预热未跑完，客户端已到同一 key） | ✅ 已防 | 进程内 singleflight（`Map<key,Promise>`）合并为一次回源，两请求共享结果 |
| 预热已跑完、客户端稍后到达同一 key | ✅ 本就是目标路径 | 客户端命中热 Redis，零重复回源 |
| **key 参数错位**：月份 / family·ledger 定位与客户端实际请求不一致 | ❌ 不防（显式接受） | 预热回源白做，客户端对另一 key 再回源。典型诱因：服务端按 `preferred_*` 定位而客户端按本地 active family，或跨月瞬间月份不同。topN 已从 key 移除，不再造成错位 |

**决策（2026-08-27）：接受该退化，不为其加重防护逻辑。** 理由：

1. 上述错位场景是登录路径中的少数派。错位时客户端感知延迟退化到无预热基线，但服务端会发生“预热错误目标一次 + 客户端正确目标一次”共两次回源，PG 成本高于无预热的一次回源；该额外成本通过命中率与预热归因采样持续评估。
2. 要 100% 消除剩余错位，需让服务端预热与客户端 prefetch 共享同一套 family/ledger/月份推导口径，或把预热延迟到与客户端请求窗口精确重叠——这类逻辑重、耦合前后端时序，性价比不成立。topN 已通过缓存完整排行彻底解耦。
3. `preferred_*` 与客户端 active 的一致性由既有登录/切账本链路负责收敛，缓存层不承担该职责。

**观测兜底**：现有 `cache:metrics` 只能反映业务域总体 hit/fill，不能单独归因预热。若需判断错位浪费，应临时增加带采样的 preheat source/目标日志，并结合登录量与真实请求流量评估，而不是从全局 fills/hits 直接推断。

### 5.2 不做写后预热

流水写入轮换 generation 后不做异步回填（写后读通常由客户端本地直读先行满足，服务端下次回源走懒加载即可）；若上线后观测到"写后首读"延迟毛刺再评估。

### 5.3 不预热的内容

yearly、drill-down、历史月份、单成员视图——组合爆炸且命中率低，懒加载 + TTL 足够。GM impersonate 登录不预热（管理路径）。

---

## 6. 部署配置（决策 B：不动 AOF）

- `infra/docker-compose.prod.yml` Redis 服务**维持现状**：`--appendonly yes --appendfsync everysec`、`--maxmemory 512mb --maxmemory-policy allkeys-lru`；进程在容器内 `--bind 0.0.0.0`，宿主机仅发布 `127.0.0.1:6379`，并由密码与 Docker 网络控制访问。本次零 Redis 服务配置变更。
- 应用侧 `REDIS_COMMAND_TIMEOUT_MS=1000`（`.env.example` 与生产 env 生成脚本均登记），网络半开或 Redis 无响应时在有界时间内进入 fail-open/错误处理。
- 业务 key 与 generation 随 AOF 持久化，正常重启后保留热数据；若 generation 因 LRU 缺失，则随机重建且不会重新指向历史业务 key。
- dev compose（`server/docker-compose.yml:29-42`）无需改动。

---

## 7. 读路径改造点

| 端点 | 位置 | 改造 |
|---|---|---|
| `GET /families/{id}/statistics/monthly` | `routes/statistics.ts` → `statisticsService.getMonthlyStatistics` | 缓存**仅稳定聚合层**：key 为 ledger/month/user，不含 topN；loader 返回 totals / daily_trend / 稳定 extremes 与**完整**一级分类聚合；`avg_daily_expense`、展示名、排序、topN 截断在缓存外完成 |
| `GET .../statistics/yearly` | `routes/statistics.ts` → `statisticsService.getYearlyStatistics` | 同上；`avg_monthly_expense` 按当前月份在缓存外实时计算，避免跨月陈旧 |
| `GET /families/{id}/members` 与 `GET /families/{id}` 的 `members` 字段 | `routes/families.ts` → `familyService.listMembers/getFamilyDetail` → `getMembersCached` → `familyMemberRepo.listMembersWithUsers` | 鉴权后读取同一 `cachedGet('family:members', family scope, familyId, 300, loader)`，family generation |
| `GET /budgets` | `budgetService.getBudget`（`budgetService.ts:127-159`） | 包 `cachedGet('budget', {ledger,month}, 300/60, loader)`；返回 null 走 60s 短 TTL |

约束：membership 守门在 cachedGet **之外**照常先执行（§4.3）；对外 HTTP 契约与响应体不变，缓存为内部实现细节。

**统计域展示名装配（方案 A 落地要点）**：

- 统计 service 拆两段——① `aggLoader`（进缓存）：现有的 `statsRepo.listEntriesInRange` / `getCategoryAggregates` + JS 分桶逻辑原样迁入，产出**只含数值与 `category_id`** 的中间结构；二级分类按 parent_id 折叠，合法的一级分类直记按自身 id 计入；排行保存全部一级分类，不按名称排序、不截断；② 装配段（缓存外，每次执行）：读取 family/ledger/category 当前展示字段，补名后按 `(amount desc, category_name localeCompare)` 排序，最后应用请求的 topN。
- 装配查询均为主键 / 小集合单查，成本远低于行拉取 + 聚合；分类改名后不仅名称立即更新，同额排行的 topN 边界集合也会按当前名称重新计算。不同 topN 请求共用同一聚合 key。
- `filtered_user_id` / `range_start` / `range_end` / `timezone` / `currency` / `month`(或 `year`) 等由入参直接决定的字段可留在缓存 payload 内或装配段拼接，均可（不涉及可变外部状态）。
- 回归不变式（§9）据此校验：拆分前后统计端点响应体逐字节一致。

---

## 8. 观测与日志（对齐 logging-strategy-spec）

- **统一日志出口**：生产 `buildApp` 通过 `registerCacheLogger(app.log)` 注册并在自身 close 时精确注销；多 app 并存互不清空。缓存模块不自行创建 pino，确保指标与错误进入生产固定 `server.log`。test 环境不注册 app logger，可注入 fallback logger。
- **进程内指标**：cache.ts 按业务域累计 `{hits, misses, fills, fillMsSum, errors}`，每 300s 输出一行 info。`errors` 只统计 `cachedGet` 的 generation/业务 GET/SET 错误；失效轮换与预热锁错误仅进入聚合 warn。
- **预热观测边界**：预热复用普通 service/domain，当前指标无法区分 fill 来自预热还是正常冷读，也不能直接判断某次预热是否被后续真实请求消费；评估预热浪费需结合登录量、端点流量和日志采样，不能仅凭全局 fills/hits 下结论。
- **错误路径**：Redis 调用异常 → warn；每类操作 60s 内聚合一次，防 Redis 宕机刷屏。generation 读取错误除日志外还计入对应 domain errors。
- **慢回源**：单次 fill >200ms 记 debug。
- 不新增 error code、不动 `ErrorHttpStatus` 契约——缓存故障对外不可见。

---

## 9. 测试策略

全部在 `server/` 内，复用既有 `setRedisForTests()`（ioredis-mock）注入；**pg-mem DDL 零改动**（无 schema 变更）。

| 层 | 用例 |
|---|---|
| cache.ts 单测 | 命中/未命中、null envelope、TTL 抖动、正常/degraded singleflight、undefined 拒绝缓存；generation GET 失败完全绕过业务缓存；指针被淘汰后旧 key 不复活；轮换失败由 TTL 兜底；UUID 大小写共用同一 key/generation |
| generation 失效 | ledger/family 轮换后同 keyParts 必然 miss 重填；失效 API 可等待且自身吞 Redis 异常 |
| service 集成 | create/update/delete 与 scheduler 写后统计立即更新；sync push 同账本批次仅轮换一次；预算与成员改色写后立即失效；PATCH /users/me 响应后在 personal/shared 两类已预填家庭立刻可见新昵称 |
| 权限回归 | 普通 POST 与 sync create 均不得向非成员账本写流水或修改余额，返回不暴露资源存在性的 NOT_FOUND |
| 统计语义 | monthly/yearly 使用完整排行聚合；时间派生日均/月均在缓存外实时计算；分类改名后缓存命中仍按当前名称重新决定同额 topN；不同 topN 共用一份聚合缓存 |
| 预热 | all 统计/预算/members 被填充；不同 topN 可命中；单成员视图不预热；主动轮换 generation 后 5min 内重复登录仍被锁阻止；失败不影响登录响应 |
| 日志生命周期 | 多 app 并存时注销其一不影响仍存活实例的缓存日志出口 |
| 回归 | 统计/budget/members 对外响应契约不变 |

CI：pre-commit lint+typecheck 照常；服务端全测在 server/ 跑。

---

## 10. 分阶段落地（决策 E：连续推进）

| 阶段 | 内容 | 验收 |
|---|---|---|
| P0 | `cache.ts` 封装（cachedGet/random generation/invalidate*/singleflight/抖动/统一日志/指标）+ 单测 | 无行为变化；指标进入统一日志；generation 故障与淘汰不返回历史缓存 |
| P1 | monthly/yearly 缓存接入 + §4.2 流水/预算全部失效挂钩 | 统计二次请求 repo 零调用；写后首读数据正确 |
| P2 | members/budget 缓存（含 null 60s）+ 家庭/用户失效挂钩 + 登录预热 | 登录后首访统计页回源命中；PATCH /users/me 跨家庭失效正确 |

每阶段按 Conventional Commits 单卡提交（scope=backend）。entries 复合索引评估（§12）与缓存工作解耦，不阻塞排期。

---

## 11. 风险与缓解

| 风险 | 影响 | 缓解 |
|---|---|---|
| generation 轮换失败（Redis 抖动） | 旧缓存存活至 TTL（普通最长 330s；null 最长 66s） | 失效 API 聚合 warn 并正常 resolve，不反转已提交业务事务；TTL 兜底 |
| generation 读取/初始化失败 | 若猜固定默认值可能命中历史 key | **禁止猜值**：完全绕过业务缓存，按 degraded key singleflight 回源 PG |
| generation key 被 `allkeys-lru` 淘汰 | 指针缺失 | `SET NX` 初始化全新 UUID；旧业务 key 的 generation 不匹配，无法复活 |
| Redis 整体宕机或网络半开 | 缓存层消失或命令悬挂 | `REDIS_COMMAND_TIMEOUT_MS` 将等待限制为默认 1s，缓存读 fail-open 直回 PG；错误日志 60s 聚合防刷屏 |
| 热 key 集中过期 | 回源尖刺 | singleflight + TTL 抖动 |
| 高频写后读产生多代不可达 payload | TTL 窗口内内存放大 | 监控 `used_memory`/`evicted_keys`/业务 key 数，必要时降低 TTL 或扩容 |
| 登录风暴回填 | PG 瞬时压力 | 每用户 5min 限流锁 + singleflight；只预热 all，不按成员线性展开 |
| 预热与客户端请求"重复拉取"（family/month 错位） | 少数场景下多一次聚合 | 显式接受；同时在途由 singleflight 合并；需要评估时加采样 preheat 日志并结合流量，topN 已从 key 移除 |
| 缓存了越权数据 | 数据泄露 | 鉴权在缓存层之外每次执行（§4.3）；缓存 payload 不含权限判定 |

---

## 12. 明确不做 / 后续项

1. **entries 水合缓存**（决策 D）——暂不实施；若做，先评估补 `(ledger_id, updated_at)` 复合索引是否更治本（独立卡）。
2. **头像 URL 版本化**——头像覆盖式写 `<userId>.<ext>` 导致 URL 不变、客户端/CDN 旧图缓存，与 Redis 无关；正确解法为 `avatar_url` 带版本参数（如 `?v={users.version}`）。建议单列卡。
   > **2026-10-17 补记**：`?v=<上传时刻 ms>` 已落地（2026-09-13，`server/src/routes/upload.ts`），换头像即换 URL、天然击穿微信 `<image>` 的按 URL 持久缓存。头像 COS 化（`docs/design/cos-offload-phase2-avatar.md` v1.2）**继续沿用**该机制：Key 固定为 `avatars/<userId>`、对象覆盖写，仅 query 变 ⇒ 配合对象级 `Cache-Control: public, max-age=31536000` 实现"重复加载零请求、换头像立即可见"。该条不再是待办。
3. **统计 drill-down 服务端缓存**——低频，客户端已有 `_drillCache`；视 P1 观测数据再定。
4. **写后预热**——§5.2，视观测再定。
5. **GM impersonate 路径**——管理操作不预热、不挂钩（读到的 members 缓存可能短暂过期语义，可接受）。

---

## 13. 评审记录

### 2026-08-27 · 代码级 review（采纳方案 A）

- **背景**：v1.0 statistics 缓存 key 仅内嵌 ledger 纪元，但统计响应体内嵌 `family_name`（`statisticsService.ts:498`）、`ledger_name`（`:501`）及排行项 `category_name` / `icon`（来自 category 表）。而 `PATCH /families/:id`（`routes/families.ts:252` → `familyService.updateFamily`）改名会同时改 `family.name` + `ledger.name`（`familyService.ts:309-317`），该 mutation 未在 v1.0 §4.2 失效清单内，且即便补挂 family 纪元也无法失效以 ledger 纪元构键的统计缓存 → 改名后统计里的展示名 stale 至 TTL；分类名/图标同理存在潜在隐患。
- **决策**：采纳**方案 A**——展示名不入缓存，缓存只承载昂贵聚合（数值 + `category_id`），名字在 service 返回前实时装配（§2.1 / §7）。相比"key 再纳入 family 纪元"（治标、且不覆盖分类改名），方案 A 从根本上让名字永远新鲜，并让缓存聚焦真正贵的聚合，符合成本分层与"干净彻底"原则。
- **同步修订**：§2.1 新增"展示名不入缓存原则"；§7 拆分统计 service 为 aggLoader（进缓存）+ 装配段（缓存外）并明确回归不变式；§4.2 补 family 改名条目并注明统计/预算展示名不依赖失效。
- **当时核实项**：budget `spent` 与流水共用 ledger 失效域正确；统计按 `ledgerRepo.findFirstByFamilyId` 单账本聚合、key 使用 ledgerId 合理。后续 v1.2 已进一步移除 key 的 topN 维度。

### 2026-08-27 · 登录预热保留 + 重复拉取风险显式接受

- **背景讨论**：服务端预热会早于客户端 `prefetch.ts` 抢跑，正常时序为净提效；但 family/month 定位错位时仍可能退化为双回源。v1.2 已移除统计 key 的 topN 维度，因此 topN 不一致不再导致重复聚合。客户端额外预取的 family summary/user overview 不在本缓存范围。
- **决策**：**保留登录预热并实施**（不降级为后续项）；同时在方案中**显式披露**双回源风险，**不为极少数错位场景加重防护逻辑**（100% 防护需前后端共享推导口径或时序对齐，逻辑重、违背"干净彻底"原则，低 DAU 下多一两次聚合可吸收）。客户端延迟退化至无预热基线，但 PG 会承担错误目标预热与正确目标回源两次聚合。
- **同步修订**：新增 §5.1.1（接力时序模型、三类边界场景与显式接受决策）；§11 风险表补"预热重复拉取（key 错位）"；v1.2 进一步澄清现有 `cache:metrics` 不能单独归因预热；v1.3 修正双回源的 PG 成本表述。

### 2026-08-27 · v1.2 实现复审修复

- **generation 安全性**：废弃“缺失视为 0”的数值 epoch，改为 `cache:v1:generation:*` UUID token；缺失时 `SET NX` 初始化，读取失败完全绕过业务缓存，解决瞬时 GET 故障和 `allkeys-lru` 淘汰指针导致旧 `e0` key 复活的问题。
- **统计排行正确性**：loader 缓存全部一级分类聚合，key 移除 topN；装配段读取当前分类名后排序并截断，保证分类改名后的同额 topN 边界与实时计算一致，也消除预热与请求的 topN key 错位。
- **一致性时序**：普通写路径在响应前等待 generation 轮换；用户昵称/头像先查询全部家庭再等待并行失效；budget 在可能失败的 spent 装配查询前完成失效；scheduler 在 COMMIT 和 client release 后失效；sync push 批末按 ledger 去重且用 `finally` 覆盖部分成功。
- **预热与日志**：预热只做 all 统计、members、budget，不再按 active member 展开；子任务失败汇总可观测，并登记为 app 后台任务，`close()` 时排空。缓存模块不再创建独立 stdout pino，生产用 `registerCacheLogger(app.log)` 注册并精确注销，多 app 并存互不干扰；test 默认不注册全局 logger、不自动预热。
- **验证说明**：补充 generation 故障/淘汰、update/delete/yearly、sync 批末去重、scheduler、动态分类名 topN、预热范围与 app logger 生命周期等回归用例；本次修改按约定未代执行测试命令。

### 2026-08-27 · v1.3 安全与边界复审修复

- **授权与 canonical ID**：流水 create 在同一事务内锁定 active membership，普通 POST 与 sync 均使用 DB 返回的 canonical ledger UUID，修复跨家庭写入与 UUID 大小写导致的缓存漏失效。
- **故障与时间边界**：Redis 单命令默认 1s 超时；月度日均、年度月均移出聚合缓存并按当前日期实时装配。
- **生命周期与竞态**：scheduler 关闭等待在途 tick；资料更新使用写前/写后家庭快照并集失效，写后查询失败不反转已提交资料更新。
- **容量与测试**：容量模型纳入 TTL 窗口多代 payload；补充 UUID、degraded singleflight、业务 GET/SET 故障、跨家庭 create、跨月派生均值和有效预热锁回归；全局 Redis test reset 改为等待完成。本次按项目约定未代执行测试命令。

---

## 14. 2026-08-28 · 实现整体回滚（本文档降级为决策留档）

### 14.1 回滚动因

缓存的收益前提是"同一 key 在 TTL 窗口内被重复查询"。复盘后确认该前提在本项目中大面积不成立：

1. **客户端已有一层 SWR**（`miniprogram/services/{statisticsApi,familyApi,budgetApi}.ts`，5min TTL 为主，`SYNC_DONE` 失效）。服务端 300s 缓存要生效，必须正好落在"客户端 SWR 刚失效后那一次回源"这个窄窗口里。
2. **写路径是净成本**：`create` / `update` / `softDelete` / sync 批末 / scheduler / budget / family mutation / `PATCH /users/me` 全部要在**业务响应返回前 `await` 一次 generation 轮换**，即每次写入多一次 Redis 写 + 一次往返等待。
3. **低 DAU 下读侧命中率不足以摊销写侧成本**，且预热还会引入"错误目标预热 + 正确目标回源"的双回源（§5.1.1 已显式接受，但回滚后该风险整体消失）。

结论：**这套缓存属于"无效/低效缓存"，反而拖累正常逻辑的写性能**，故整体撤销。

### 14.2 回滚范围（已执行）

| 类别 | 内容 |
|---|---|
| 删除文件 | `server/src/services/cache.ts`、`server/src/services/cachePreheat.ts`、`server/test/cache.test.ts`、`server/test/cache-invalidation.test.ts` |
| 整文件回滚 | `app.ts`（后台任务装饰器 + `registerCacheLogger` + `enableLoginPreheat`）、`config/ttl.ts`（`cacheHitSec`/`cacheNullSec`/`cachePreheatLockSec`）、`config/env.ts` + `db/redis.ts`（`REDIS_COMMAND_TIMEOUT_MS` / `commandTimeout`）、`routes/auth.ts`、`routes/users.ts`、`routes/sync.ts`、`services/authService.ts`、`services/budgetService.ts`、`services/familyService.ts`、`services/recurringScheduler.ts`、`test/auth.test.ts`、`.env.example`、`infra/scripts/03-generate-env.sh` |
| 部分回滚 | `services/entryService.ts`（删 `EntryMutationOpts` / `invalidateCommittedLedger` / 三处失效调用）、`services/statisticsService.ts`（删 aggLoader + 装配段拆分，恢复直算）、`repositories/familyMemberRepo.ts`（删 `listFamilyIdsForUser`） |

### 14.3 回滚中**保留**的改动（与缓存无因果关系，属项目固有 bug 修复）

| 保留项 | 说明 |
|---|---|
| `entryService` 跨账本写入修复 | 回滚前的 create 路径**完全没有 membership 校验**：任意登录用户拿他人 `ledger_id` 即可写入 entry 并**同事务改动他人账本余额**；`type='income'` 或显式 `shared_type` 时连账本查询都不会发生。保留事务内 `FOR UPDATE` 锁定的 active membership 校验、事务内读、canonical ledger UUID，以及"不存在与非成员统一 `NOT_FOUND`"。配套：`routes/entries.ts` 补 `NOT_FOUND` 映射、`server/api/openapi.yaml` 为 `POST /entries` 补 `404` |
| `statisticsService` 一级分类直记折叠 | 旧 `foldL2ToL1` 对 `meta.parent_id` 为空（家庭自建一级分类、导入 / sync / 历史数据写入的一级 id）直接 `continue`，会**静默丢掉这些金额并缩小 `ratio_bps` 分母**。改为 `parentId = meta.parent_id ?? meta.id` |
| `familyMemberRepo.lockActiveMember` | 上述事务内校验的依赖（保留）；仅服务于缓存失效的 `listFamilyIdsForUser` 已删 |
| `test/setup.ts` 的 `await resetRedisMock()` | 消除 flushall 与下一用例的并发竞态；Redis 仍存 refresh token，隔离卫生依然成立 |
| `test/entries.test.ts` 跨家庭 create 回归、`test/categories-shared-type.test.ts` 断言更新 | 上述授权修复的守门用例 |

**显式不保留**：`recurringScheduler` 的 `inFlightTicks` / `stop()` 等待在途 tick（唯一动机是"关 Redis 前等失效完成"，无缓存即无收益）；`db/redis.ts` 的 `commandTimeout`（随 §6 引入，且会改变 refresh token 热路径语义，属未评估的行为变更）。

### 14.4 回滚后的现状

- 统计 monthly/yearly、`GET /budgets`、`GET /families/{id}/members` **全部回归 PostgreSQL 实时聚合**，无陈旧窗口。
- Redis 恢复为**仅承载 `refresh:{jti}` 会话热路径**的单一职责（§0.1 改造前状态）。
- 连带文档已同步：`docs/design/data-import-export-client-analysis.md` §7.5「导入缓存失效」作废、R21 消解；`docs/design/share-cards/receipt.md` 的 Refs 改为指向 `statisticsService.ts`。

### 14.5 复用提示（若未来重新引入服务端读缓存）

- §1 决策表（随机 generation 失效、不做通配 DEL）、§4 一致性保证、§11 风险表**仍然成立**，可直接复用。
- **必须先回答 §14.1 的三条成本质疑**：给出实测命中率，或把缓存范围收窄到真正高频的单一端点，而不是全量铺开。
- 写路径**不要**在响应前 `await` 失效；可改为提交后异步失效并接受 ≤TTL 的陈旧窗口（取舍需重新论证）。
- 若届时导入功能已上线，需重开 `data-import-export-client-analysis.md` 的 R21（导入绕过 `entryService`，必须自行失效）。
