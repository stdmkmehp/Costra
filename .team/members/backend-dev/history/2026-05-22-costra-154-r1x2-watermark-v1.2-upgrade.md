# COSTRA-154 R1.x.2 · watermark 协议 v1.2 升级（BIGINT change_seq）

> **日期**：2026-05-22 17:30
> **装扮**：backend-dev（Orchestrator 直接执行 · 非 spawn · 性质属修复型而非装扮档实战）
> **commit**：`31fb893`（server 端单 commit · `2b28210` client 端不计入此装扮）
> **触发**：Human 联合 154+150 staging 实测 · 5 条断言期间发现 P1 watermark 微秒精度截断 BUG（实测 137μs 差 · 同条 entry 永久重传）
> **决策**：Human 选项 B · 不背历史包袱同轮彻底升级 ISO 时间戳 → BIGINT change_seq

---

## §1 背景与根因

### 联合实测发现的 P1 BUG（COSTRA-154 watermark 精度截断）

- **实测现象**：sync pull 反复返回同一条 entry · watermark 看似推进但客户端再次 pull 仍命中相同记录
- **SQL 验证**：手工 query 验证 `entries.updated_at` 与 client 持有 watermark 值差 137μs（微秒级）
- **根因 L1**：JS Date 对象毫秒精度（`.toISOString()` 输出 `.999Z` 末位为毫秒）vs PG TIMESTAMPTZ 微秒精度
- **根因 L2**：v1.0 协议 watermark 用 ISO 字符串字典序作为时序边界 · 客户端持有的 watermark = `entries.updated_at` 在毫秒边界处截断 · 服务端 `WHERE updated_at > $watermark::timestamptz` 永远命中同一条
- **根因 L3**（Human 追问后暴露）：即使 v1.1 把字符串精度提到微秒解决精度问题，仍残留 3 类风险：
  1. 同微秒并发 INSERT（SERIAL `now()` 调用相同 timestamp）
  2. NTP 回拨场景 updated_at 倒退
  3. 主从切换时序漂移

### Human 决策选项 B：彻底升级到 BIGINT change_seq

> 用自增序列号承担一致性表达 · `updated_at` 保留语义（人类可读时间）

**协议演化纪律**：
- v1.0 ISO ms（已上线）→ v1.1 ISO μs（中途方案 · 被证伪未上线）→ **v1.2 BIGINT change_seq**（本轮 · 破坏性升级）

---

## §2 实装 scope（commit `31fb893` · 8 文件 +550/-78）

| # | 文件 | 改动 |
|---|---|---|
| A | `server/db/migrations/0006_entries_change_seq.sql` | **新建** · CREATE SEQUENCE entries_change_seq + ALTER TABLE entries ADD COLUMN change_seq BIGINT + 历史回填（按 created_at 排序赋值）+ UNIQUE 索引 |
| B | `server/src/repositories/entryRepo.ts` | EntryEntity 加 changeSeq 字段 · INSERT 走 DEFAULT nextval · UPDATE/softDelete 显式 SET change_seq = nextval('entries_change_seq') · findEntriesByFamilySince 改 since:bigint · WHERE/ORDER BY change_seq 替代 updated_at |
| C | `server/src/services/syncPullService.ts` | since 参数 number · watermark = rows[末位].changeSeq（number 而非 ISO 字符串）· entryToWire 新增 change_seq 字段输出 |
| D | `server/src/routes/sync.ts` | pullQuerySchema since: integer minimum=0（替代原 string format=date-time） |
| E | `server/test/setup.ts` | pg-mem 注册 setval mock（pg-mem 不支持 setval · 需 hand-rolled）+ entries DDL 加 SEQUENCE 声明 |
| F | `server/test/sync-pull.test.ts` | T1~T17 沿用 + T18（UPDATE 推进 watermark）/ T19（同事务多 INSERT change_seq 严格递增）/ T20（软删触发 change_seq 推进）共 21 测 |
| G | `server/test/sync.test.ts` | 微调 1 处 watermark 类型 |
| H | `server/api/openapi.yaml` | watermark schema integer + format int64 · Entry schema 加 change_seq 字段 |

**测试基线**：server 56/56 PASS（vs R1.x.1 49/49 · 新增 7 条 v1.2 回归）

---

## §3 pg-mem 兼容性记录（公共 helper 候选）

实测验证：
- ✅ **CREATE SEQUENCE / nextval()**：pg-mem 原生支持
- ❌ **setval()**：需手动 mock（已写入 `test/setup.ts`）
- ❌ **trigger（BEFORE INSERT）**：pg-mem 不支持 → 改应用层显式 nextval
- ❌ **AT TIME ZONE / to_char()**（v1.1 中途方案的微秒输出依赖）：pg-mem 不支持

议入 Sprint-3 末 Retro 候选议题：**pg-mem 测试基础设施补强 · setval/timezone/to_char mock 沉淀公共 helper**（`test/setup.ts` 当前为本卡内联实现 · 后续多卡复用需提取）

---

## §4 闸门 + 反向验证

| 闸门 | 结果 | 备注 |
|---|---|---|
| G1 typecheck | ✅ | tsc --noEmit 干净 |
| G2 eslint | ✅ | 0 warnings |
| G3 协议事实源对齐 | ✅ | OpenAPI watermark int64 + Entry.change_seq 同步落地 |
| G4 单测全绿 | ✅ | 56/56（含 T18/T19/T20 新增）|
| G5 commit subject 小写 | ✅ | `fix(backend): sync watermark v1.2 bigint change_seq (costra-154)` |
| G6 commit footer | ✅ | `Refs: COSTRA-154` 大写 |
| G7 migration 命名 | ✅ | 0006_entries_change_seq.sql 沿用编号 |
| G8 历史回填 | ✅ | 按 created_at 排序赋值 change_seq · UNIQUE 约束验证不冲突 |
| G15 D-016 反例预防 | ✅ | commit 前 `git status -s .team/members/backend-dev/` wc -l = 0（本档案 + state.md 同 commit 落盘） |

**反向验证**：
- 旧 ISO 字符串 watermark 的 query 路径已全删 · grep `watermark.*timestamp` 0 命中
- T18（UPDATE 推进）证明 change_seq 自增 · T19（同事务多 INSERT）证明严格单调 · T20（软删）证明 status 变更也推进

---

## §5 协议演化与破坏性升级声明

详见 `qa/defects/2026-05-22-COSTRA-154-watermark-microsecond-precision.md` §11 v1.2 升级声明（693 行）。

**对客户端的影响**（已在 client 端 commit `2b28210` 内适配）：
- legacy ISO 字符串 watermark 自动重置为 0（防御性兼容历史 wx.storage 数据）
- 首次 pull 全量回灌一次 · 之后用 BIGINT change_seq 增量推进

---

## §6 等再次 staging 实测

下一步 Human 操作：
1. server staging 重启 + 跑 migration 0006（PG SEQUENCE + ALTER + 回填）
2. 重跑联合 smoke 5 条断言 A~E（断言 D/E 重点验证 v1.2 watermark BIGINT）
3. `approve:COSTRA-154 + COSTRA-150` 联合双卡同轮 approve

**风险评估**：低 · server 56/56 测全绿 · pg-mem 模拟覆盖三类典型 case · staging migration 0006 是叠加式（不破坏既有 entries 表 · UNIQUE index 守护）

---

## §7 议入 Sprint-3 末 Retro 议题（候选）

1. **协议演化版本号变更条件**：什么级别的 BUG 触发协议 v1.x → v2.x · 区别 doc-only sync 与破坏性 schema 升级
2. **微秒精度 vs 自增序列号在分布式时序上的取舍范式**：本卡 Human Q "watermark 靠精度就一定能完美解决吗" 追问产物
3. **pg-mem 测试基础设施补强**：setval/timezone/to_char mock 沉淀公共 helper（`test/setup.ts` 当前内联）
4. **联合实测 = 真闭环最后一道闸新范式**：单测+curl 都漏不出 watermark 精度截断 · D-024 §2.2 C1 立意首次得到协议升级级别证据

---

**装扮 subagent SBAI 实战记录**：本卡为 Orchestrator 直接执行（非 spawn 装扮档）· 修复型 + 协议升级型双重定性 · 时长 ~3.5h（含 Human 多轮 Q 追问 + 选项 A/B 决策 + 实装 + 测试调试 pg-mem 兼容性问题）
