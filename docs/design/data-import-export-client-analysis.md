# 客户端账本数据导入 / 导出方案

> 状态：**v0.8 · 待评审**（v0.7 曾标记"方案冻结"，第四轮 code-level review 发现 3 项 P0 + 9 项 P1，冻结状态撤销；v0.8 逐条收敛后重新提交评审）
> 2026-08-28 后置修订：服务端 Redis 业务缓存已回滚移除，§7.5 的「导入缓存失效」要求随之作废（R21 消解）。
> 前置文档：`docs/design/data-export-format.md`（v1 脚本版 · 已废弃留档）
> 触发背景：v1 只支持运维在服务器上跑脚本；本方案把导入 / 导出下沉到小程序端用户自助能力。
>
> ⚠️ **文档边界（v0.8 确立）**：`docs/design/sync-pull-pagination-design.md`（L13）已于 2026-09-01 全量落地并**进入完成态，不再接受新增修订**。本方案对 sync-pull 通道所需的任何增量改动，一律在**本文档 §5.2** 中定义与冻结，L13 文档只作为既有不变量的引用来源。
>
> **v0.8 变更摘要**（详见 §15 修订记录 · 2026-09-02）：
> - **P0 · 全文补齐错误码契约**：原文只写裸 HTTP status，违反"客户端依 `code` 判分支"铁律，且现有 `ErrorCode` 枚举无一可表达本方案语义（`413` 根本不存在）。新增 §9.5，定义 5 个新 code 与 multipart 超限映射（§9.5）。
> - **P0 · 修正 §9.3 formula guard 不可逆**：原编解码规则非互逆，备注原文 `'备注` 自产自入后会丢掉前导单引号。改为"首字符为 `'` 无条件加一层"（§9.3）。
> - **P0 · 修正导入后客户端重拉量级**：原文"5,000 条 ≈ 10 页，秒级收敛"把导入行数当成重拉量。epoch diff 实际触发 `since=0` 全量重拉（含软删行）且 family 内**每台设备**各一次，老账本会撞 `MAX_PULL_PAGES=40` 硬顶。新增 **`ledgers.sync_epoch_floor_seq`**，把全量重拉收敛为"从导入批次起点重拉"（§5.1、§5.2）。
> - **P1 · 导出侧补分片**：原"导出不设上限 + 导入 5,000 行"使「自产自入闭环」在大账本上直接不成立（§2.3、§9.2）。
> - **P1 · detect 幂等执行顺序重排**：原"先建会话再算 sha"与并发唯一索引冲突，弱网重发主场景走不到幂等（§4.2、§4.4）。
> - **P1 · 其余**：记账人未匹配在自产文件下判 ERROR（§3.3）；上传/下载绕过 `request.ts` 需专用鉴权封装（§6.3）；worker poll 间隔（2s）与并发模型（全局串行）定义（§7.5）；`/report` 生命周期与会话行解耦（新增 `report_expires_at`，端点不迁，§7.4）；导出游标补时区与微秒安全编码（§7.5）；`data_jobs` 补三条一致性 CHECK（§7.3）；`from/to` 改可选（§6.2）。
> - **工作量重估 17.5 → 28 人天**（§12）；导出先行发布的 DoD 明确列出 5 项必做前置（§14）。
>
> **v0.6 变更摘要**（详见 §15 修订记录）：
> - **规模上限从 5MB/20,000 行降到 1MB/5,000 行**：原数字只按"PG 事务能扛多久"单侧推导，实际同时受 nginx 默认体、multipart 全局配置、proxy 超时、客户端本地库容量、sync 通道吞吐五重夹逼（§9.1）。降级后无需改动任何全局基建。
> - **客户端衔接不做导入专用旁路**：导入后的数据到达完全依赖既有 sync（周期 / 切页 / mutation）；但必须先修 `has_more` 无人消费这一**既有缺陷**（前置依赖，§5.1）。
> - 导入写入路径**无需缓存失效**：服务端业务缓存已移除，统计/预算实时聚合（§7.5）。
> - commit 事务内**显式复核成员 / 分类有效性**：软删模型下 FK 不会失效，原"靠 FK 兜底"不成立（§7.5、R12）。
> - detect **必须覆盖 DB 侧硬约束**（尤其 `note ≤ 200`），否则"可导入 N 条"与实际写入不一致（§3.11）。
> - **删除 Costra preamble**，回归纯 RFC 4180；格式识别改用 9 列表头指纹（§2.1）。
> - 导入时区显式 `Asia/Shanghai`；缺省归属改为**沿用账本所属家庭的默认语义**；修正转账分类名（§3.6、§3.8、§3.7）。
>
> **v0.7 变更摘要**（⚠️ 其中第 2 条「epoch 全量重拉」与工作量数字**已被 v0.8 推翻**，保留仅作演进留档 · 2026-09-02）：
> - **E0 前置已关闭**：`sync/pull` 的 `has_more` 消费已按 `docs/design/sync-pull-pagination-design.md` v0.8 全量落地（分页循环 + 批量落盘 + `ledgers.sync_epoch` + 月索引串行队列，migration `0019`）；导入上线唯一剩余前置 = **客户端 epoch 消费版本覆盖率**（§5.1）。
> - **导入数据到达路径明确为 epoch 全量重拉**：导入事务 `sync_epoch + 1` → 客户端下一轮 pull 前置比对不一致 → 清零 watermark 全量重拉（并非"落在增量窗口内"）（§5.1）。
> - **`data_jobs` 迁移编号 0019 → 0020**：`0019` 已被 `ledgers.sync_epoch` 占用（§7.3）。
> - **commit 复核补行锁**：复核 SQL 由纯 `SELECT` 改 `SELECT ... FOR UPDATE`，堵住"复核通过 → 成员并发退出 → 仍写入"的 TOCTOU（§7.5、R12）。
> - **导出游标独立**：不复用 `entryService.list` 的 `updated_at DESC` 游标，改 `occurred_at ASC, id ASC` 专用游标（§7.5）。
> - **释放策略**：导出只读、无 epoch 依赖，**可先行发布**；导入入口等客户端版本覆盖率达标后开放（§5.1、§14）。
> - **v1 CLI 脚本删除**：`export-entries.mts` / `import-entries.mts` 是旧时代产物，已随本轮删除；E1 的 CLI 适配工作取消，service 只有 v2 一套语义（§10）。
>
> **v0.5 保留不变的决策**：阶段型模拟进度（§7.2）、detect 产物落 server-only 私有磁盘（§7.4）、导入原子幂等重试（§7.5）、CSV Formula Injection 防护（§9.3）。

---

## 0. 已冻结决策

| 决策项 | 结论 |
|---|---|
| 载体格式 | **只支持 CSV**；不做 JSON / XLSX |
| 导入选文件 | `wx.chooseMessageFile` 从微信聊天中选择 CSV |
| 导出交付 | `wx.downloadFile` 下载临时文件后，使用 `wx.shareFileMessage` 转发到微信聊天 |
| 导出范围 | **按账本 + 日期范围导出范围内全部流水**，包含账本内所有成员创建的记录（不按 `created_by` 过滤）；单文件 ≤ 5,000 行，超出自动分片为多文件（§9.2）|
| 二次同意 | 不需要；登录鉴权 + 活跃账本成员权限校验即足够 |
| 执行模型 | 导入、导出都创建**服务端异步任务** |
| 导出列设计 | **不保留**账本ID / 记账人ID / 记录ID；仅保留昵称、分类名等人类可读字段 |
| 导入记录ID | **不需要也不允许**传入记录ID；每次导入全部新生成 UUID v7 |
| 归属默认 | 支出缺省归属**沿用账本所属家庭的默认语义**（个人家庭→个人 / 共同家庭→共同，复用 `entryService.resolveDefaultSharedType`）|
| 导入并发约束 | **同一账本同时只允许一个导入任务在执行**；detect **同一用户同时只允许一个** |
| 导入两阶段 | **先检测 → 再确认导入**；检测阶段返回所有错误和 warning，由用户决定是否继续 |
| 记账人匹配 | 按昵称匹配家庭成员；未匹配时归属当前导入操作者 + warning；**同名多个成员 → ERROR**（§3.3）|
| 任务持久化 | 任务落 PG 表 `data_jobs`（导入导出共用）；用户退出后可再回来查看进度与下载 |
| 进度显示 | **不承诺真实百分比**；客户端按 `stage + stage_started_at` 做**阶段型渐近模拟进度**，成功才跳 100%（§7.2） |
| worker | 复用 recurringScheduler 范式：进程内轮询 + advisory lock + `FOR UPDATE SKIP LOCKED`，不引入队列中间件 |
| 上传源文件 | 检测流式解析完**即删原始 CSV**；规范化行数据落 **server-only 私有磁盘**（压缩 NDJSON），检测元数据落 PG `import_detect_sessions`（§7.4）；**Redis 不存任何 CSV 行内容** |
| 导入幂等 | detect 阶段预生成 `entry_id`(v7) + `client_ref_id=import:<detect_id>:<row>`；entries + 余额 + `job=succeeded` **同一事务提交**；导入任务**仅瞬态错误可重试**（§7.5） |
| 导入缓存失效 | 导入不走 `entryService`；但服务端业务缓存已移除，**无需任何失效调用**（§7.5）|
| 客户端数据到达 | **不做导入专用推送/旁路**；依赖既有 sync（周期 / 切页 / mutation）。~~前置依赖：先修 `has_more` 无人消费~~ **已修复（L13 落地）**；导入后经 **`sync_epoch` + `sync_epoch_floor_seq` 定点重拉**到达（§5.1、§5.2）|
| **sync-pull 增量改动** | L13 文档已完成态、不再修订。本方案所需的 sync-pull 改动（`ledgers.sync_epoch_floor_seq` 服务端下发 + 客户端定点回退）**由本文档 §5.2 定义与冻结**，随 `0020` 迁移一并落地 |
| 错误码契约 | 全部端点必须返回 `ErrorCode`，客户端依 `code` 判分支。新增 5 个 code + multipart 超限映射（§9.5）；**不允许只写裸 HTTP status** |
| 导出文件 | 存 `/data/exports/<yyyy-mm>/<job_id>.csv`；保留 24h；下载走应用层鉴权 + 应用流式返回（不走 nginx） |
| CSV 安全 | 所有导出（含错误报告）单元格走 **Formula Injection 防护**（`apostrophe-v2` 可逆编码 + quote-all，§9.3） |
| 文件格式 | **纯 RFC 4180**（UTF-8 BOM + CRLF + quote-all）；**无 preamble / 无注释行**；Costra 格式由 9 列表头指纹识别（§2.1） |
| 规模上限 | 单次导入 ≤ **5,000 行**且 ≤ **1MB**（§9.1）；上限为全链路交集，非单侧推导。**导出单文件同取 5,000 行**，保证自产自入闭环（§9.2）|
| 过期清理 | 新增宿主机 cron `maintenance.sh purge-exports` + `purge-import-staging`（孤儿产物兜底）；任务元数据保留 30 天 |
| 页面入口 | `我的 → 设置 → 账本导入 / 导出` |
| v1 CLI 脚本 | **已删除（2026-09-02）**，不再保留运维 CLI 入口；应急导数走 `infra/scripts/psql-exec.sh` 直连 SQL |
| 分享审核 | 不做额外审核；设计简洁的文件名、完成态文案与分享前视觉卡片 |

**能力边界**：
- 不直接读取手机文件系统；微信小程序只能从客户端会话选文件。
- 不把"下载到手机目录"作为承诺；手机端通过转发到聊天 / 文件传输助手让用户拿到文件。
- 不在客户端解析并入库 CSV；客户端只做后缀、大小等前置校验，完整校验和事务写入由后端执行。
- **不为导入新建数据下行通道**；导入后的可见性由既有 sync 保证（§5.1）。

---

## 1. 用户场景

| 场景 | 用户目标 | 方案 |
|---|---|---|
| 账本备份 | 保存某本账的全部流水 | 选择账本与日期范围 → 异步生成 CSV → 转发到文件传输助手 |
| 月度 / 年度对账 | 在 Excel / WPS 中核对 | 导出 CSV 后在聊天中接收文件 |
| 家庭数据交接 | 把完整账本交给家庭成员 | 按账本导出全部成员流水，不按请求者过滤 |
| Costra 数据迁回 | 将 Costra 导出的 CSV 再导入 | 选择目标账本 → 从聊天选择 CSV → 检测 → 确认导入 |
| 外部账单迁入 | 从其他平台导入 CSV | 通过字段别名映射逐步适配；首期保证 Costra 标准 CSV |

---

## 2. 载体文件格式

### 2.1 文件规格：纯 RFC 4180

载体格式为**纯 RFC 4180 CSV**，不含任何 Costra 私有扩展。

> ⚠️ **v0.6 删除 v0.5 的 `#costra-csv` preamble**。理由：§1 排在第一位的用户场景是"在 Excel / WPS 中核对"，而**表格软件没有 CSV 注释语法** —— `#costra-csv;...` 会实打实占据第 1 行，把表头挤到第 2 行，导致筛选 / 排序 / 透视表全部需要用户手工调整区域。而 v0.5 论证的"preamble 承担两个不可省的机读职责"并不成立（见 §2.1.1）。

| 属性 | 值 |
|---|---|
| 格式 | RFC 4180（无扩展、无注释行）|
| 编码 | UTF-8 with BOM |
| 行结尾 | CRLF |
| 分隔符 | 逗号 `,` |
| 转义 | 含逗号、换行或双引号的字段用双引号包裹；内部双引号写成 `""`；**导出侧对每个字段统一 quote-all**（配合 §9.3 Formula Injection 防护） |
| 多行字段 | 必须按 RFC 4180 支持 **quoted multiline field**（备注含换行合法），解析器须维护引号状态，不能按物理行拆分 |
| 首条逻辑记录 | **必须是表头**（无例外） |

#### 2.1.1 Costra 格式识别：9 列表头指纹

preamble 原本承担两个职责，两者都有更好的实现：

| 原 preamble 职责 | v0.6 替代方案 |
|---|---|
| 声明格式版本 | **9 列固定表头本身即指纹**：表头精确等于 §2.3 的 9 个标准列名（顺序无关、trim + 大小写归一后比对）→ 判定为 Costra 自产文件。未来格式演进通过列名集合变化区分，无需版本号。 |
| 声明 Formula 防护编码 | **由指纹推定**：判定为 Costra 自产 → `formula-guard = apostrophe-v2`（当前唯一实现，§9.3）；否则 → `none`。 |

判定规则（严格、无歧义）：

1. 读取第一条逻辑记录作为表头，对每个列名做 trim + 小写归一。
2. 若归一后的列名集合**恰好等于** `{日期,时间,类型,金额,一级分类,二级分类,归属,记账人,备注}` → `is_costra_export = true`，`formula_guard = apostrophe-v2`。
3. 否则 → `is_costra_export = false`，`formula_guard = none`，走 §3.1 别名映射解析外部 CSV。
4. **不识别任何注释语法**：以 `#` 开头的行一律当普通记录（符合 RFC 4180）。

> **兼容性说明**：若已有 v0.5 preamble 的文件流入（本功能上线前不存在此类文件，仅为防御），第一条逻辑记录会是 `#costra-csv;...` 单列记录，表头指纹不匹配且缺少必填列 → 检测阶段返回 ERROR「文件格式不识别：首行不是表头」。不做静默跳过，避免为不存在的历史包袱写兼容分支。

### 2.2 文件命名

```text
单文件：Costra_{账本名}_{起始日期}至{结束日期}_{导出时刻}.csv
分片：  Costra_{账本名}_{起始日期}至{结束日期}_{导出时刻}_{N}of{M}.csv

示例：
Costra_我的家庭_2026-01-01至2026-07-21_20260721T173900.csv
Costra_我的家庭_2026-01-01至2026-07-21_20260721T173900_1of2.csv
```

规则：
- 账本名中的 `/`、`\`、`:`、`*`、`?`、`"`、`<`、`>`、`|` 替换为 `_`。
- 文件名即微信原生文件消息的主要可识别信息，必须包含 `Costra + 账本名 + 日期范围`。
- 导出时刻用于避免同一区间多次导出发生同名覆盖。
- **`_NofM` 后缀仅在 `part_count > 1` 时追加**（§9.2 分片）；单文件保持原格式，不写 `_1of1`。
- 日期范围选"全部"时（§6.2 `from`/`to` 省略），用**实际数据的首末 `occurred_at`** 填充；空账本用当天日期。文件名不允许出现空缺段。

### 2.3 导出列定义

导出文件采用**固定 9 列**格式，全部为人类可读字段：

| # | 列名 | 类型 | 说明 | 示例 | 是否总有值 |
|---|---|---|---|---|---|
| 1 | 日期 | TEXT | ISO 日期 `YYYY-MM-DD`（`Asia/Shanghai`）| `2026-06-10` | ✅ |
| 2 | 时间 | TEXT | 24h 格式 `HH:mm`（`Asia/Shanghai`）| `14:30` | ✅ |
| 3 | 类型 | TEXT | `支出` / `收入` / `转账` | `支出` | ✅ |
| 4 | 金额 | NUMBER | 正数，单位：元，两位小数 | `35.50` | ✅ |
| 5 | 一级分类 | TEXT | 一级分类名称 | `餐饮` | ✅ |
| 6 | 二级分类 | TEXT | 二级分类名称 | `外卖` | ✅ |
| 7 | 归属 | TEXT | `共同` / `个人`，仅支出有值 | `共同` | 仅支出 |
| 8 | 记账人 | TEXT | 用户昵称 | `小赵` | ✅ |
| 9 | 备注 | TEXT | 用户备注（**≤ 200 字符**，DB 硬约束）| `公司楼下` | 可空 |

> **列 3「类型」与列 5/6「分类」的对应关系**：`类型` 是 `entries.type`（income/expense/transfer），`一级/二级分类` 是 `categories` 的名称且**分类自带 type**。三者必须同 type（§3.7）。特别注意 **`转账` 类型下不存在名为"转账"的分类** —— 系统 transfer 一级实际是 `储值` / `账户互转` / `赊销`（见 §2.4 示例与 §3.7）。

**显式不导出的列**：
- ❌ `记录ID`（entry UUID）— 导入时全部新生成，不保留原 ID
- ❌ `账本ID`（ledger UUID）— 导出按账本进行，账本信息在文件名和注释头；导入时目标账本由用户在小程序选择
- ❌ `记账人ID`（user UUID）— 导入时通过「记账人」昵称列做成员匹配
- ❌ `账户` / `转入账户` — 功能未实装
- ❌ `币种` — 当前所有账本均为 CNY，不导出冗余列

**设计原则**：
1. 用户在 Excel 打开时首先看到有意义的业务字段
2. 不暴露任何 UUID，避免用户困惑或误用
3. **同一格式 CSV 既能导出也能导入回**（v0.8 补齐边界，见下）

> **"自产自入闭环"的两条明确代价**（v0.8 新增 · 原文只写"不保证精确还原 ID"，掩盖了两个更大的损失）：
> 1. **`created_by` 归属可能整体漂移**：导出只保留昵称，导入按昵称匹配活跃成员。若成员改过昵称或已退出家庭，该成员的记录在自产自入后会归到导入操作者名下，污染按 `entries.created_by` 聚合的成员统计。§3.3 已把"自产文件未匹配"提升为 ERROR 来阻断静默漂移。
> 2. **行数受导入上限约束**：导入硬顶 5,000 行 / 1MB（§9.1）。若导出不设限，30,000 条的账本导出后**根本导不回去**，本原则与 §1「Costra 数据迁回」场景一起失效。v0.8 因此给导出也加了 5,000 行单文件上限 + 自动分片（§9.2），使闭环在任意规模下成立。

### 2.4 导出文件示例

> 说明：为可读性，下例省略了每字段的 quote-all 包裹（实际导出每个单元格都用双引号包裹，见 §9.3）。**首条逻辑记录即表头，无 preamble、无注释行**。备注 `=1+1` 演示 Formula 防护后的 `'=1+1`。转账行的分类使用系统真实 transfer 分类名（`账户互转`），**不是"转账"**。

```csv
日期,时间,类型,金额,一级分类,二级分类,归属,记账人,备注
2026-06-10,14:30,支出,35.50,餐饮,外卖,共同,小赵,公司楼下
2026-06-10,09:00,收入,15000.00,职业收入,工资,,小赵,6月工资
2026-06-09,20:15,转账,5000.00,账户互转,账户互转,,小赵,
2026-06-09,12:00,支出,12.00,交通,地铁,个人,小李,'=1+1
```

### 2.5 导出数据范围

- 用户选择**一个账本**作为导出单位。
- 导出该账本日期范围内的**全部未删除流水**，包含所有成员创建的记录，不按 `created_by` 过滤。
- CSV 中 `记账人` 列保留用户昵称，用于区分家庭成员。
- 请求者必须是账本所属家庭的活跃成员；满足后不再弹二次同意。
- 文件生成操作写审计日志：请求者、账本、日期范围、记录数、任务 ID、文件摘要。

---

## 3. 导入文件解析规则

### 3.1 列名匹配（按名称而非位置）

导入解析器按**列名匹配**（不区分大小写 · 忽略首尾空格），对已知列名做兼容解析，对未知列名静默忽略。

| 标准列名 | 别名（不区分大小写 · 忽略空格） | 必填 | 缺省逻辑 |
|---|---|---|---|
| `日期` | `date`、`交易日期`、`记账日期` | ✅ | — |
| `时间` | `time`、`交易时间`（若此列包含完整 datetime，拆出时间部分）| ❌ | 默认 `12:00` |
| `类型` | `type`、`收/支`、`收支类型`、`交易类型` | ✅ | — |
| `金额` | `amount`、`金额(元)`、`交易金额` | ✅ | — |
| `一级分类` | `分类`、`category`、`大类` | ✅ | — |
| `二级分类` | `子分类`、`subcategory`、`小类` | ❌ | 取一级下**默认子分类**（判定见 §3.7）|
| `归属` | `shared_type`、`公/私` | ❌ | 支出沿用家庭默认语义（§3.8）；收入/转账忽略 |
| `记账人` | `成员`、`操作人`、`member` | ❌ | 默认当前导入操作者 |
| `备注` | `note`、`说明`、`摘要`、`商品`、`交易对方` | ❌ | 留空；**超 200 字符截断 + WARNING**（§3.11）|

**显式拒绝的列**：
- `记录ID` / `id` / `entry_id` — **不允许传入**；若 CSV 表头包含此列，检测阶段返回 ERROR：`本系统不支持保留原记录ID，请在导出前删除此列`

**重复列名处理**：若归一后出现两个映射到同一标准列的表头（如同时有 `金额` 和 `amount`），检测阶段返回 ERROR：`表头存在重复列「金额」，请删除多余列`。不做"取第一个"的静默处理——用户无法预期哪一列生效。

### 3.2 字段缺失时的兼容处理

#### 3.2.1 列完全不存在于表头

| 列 | 表头中不存在时 | 处理 |
|---|---|---|
| `日期` | **拒绝整个文件** | 无日期的数据无法入库 |
| `类型` | **拒绝整个文件** | 不知道收支方向无法入库 |
| `金额` | **拒绝整个文件** | 无金额无意义 |
| `一级分类` | **拒绝整个文件** | 无分类无法写 `category_id` |
| `时间` | 所有行默认 `12:00` | 合理：很多外部账单不含精确时间 |
| `二级分类` | 所有行取一级下默认子分类 | 合理：外部账单通常只有一级 |
| `归属` | 支出行沿用家庭默认语义（§3.8） | 与 App 内手工记账缺省口径一致 |
| `记账人` | 所有行归属当前导入操作者 | 合理：个人账本只有一人 |
| `备注` | 所有行备注为空 | 无影响 |

**文件级拒绝**只在 4 个核心列缺失时发生。错误信息示例：

```text
文件格式不完整：缺少必填列「一级分类」。
Costra 导入 CSV 需要至少包含：日期、类型、金额、一级分类 四列。
```

#### 3.2.2 列存在但某行值为空

| 列 | 行值为空 | 处理 |
|---|---|---|
| `日期` | **该行 ERROR** | 跳过，报告 `第 X 行：日期为空` |
| `类型` | **该行 ERROR** | 跳过 |
| `金额` | **该行 ERROR** | 跳过 |
| `一级分类` | **该行 ERROR** | 跳过 |
| `时间` | 默认 `12:00` | 正常入库 |
| `二级分类` | 取一级下默认子分类（§3.7） | 正常入库 |
| `归属` | 支出沿用家庭默认语义（§3.8）；收入/转账留 NULL | 正常入库 |
| `记账人` | 归属当前导入操作者 | 正常入库（**空值不产生 WARNING**，对齐 §3.3 规则 5；只有"填了值但匹配不上"才按 §3.3 规则 4 分级）|
| `备注` | 留空 | 正常入库 |

### 3.3 「记账人」列的匹配逻辑

导入时 `记账人` 列是**昵称文本**，需要映射到 `users.id`。匹配规则：

```text
1. 在目标账本所属家庭的活跃成员中，按 nickname 精确匹配（不区分大小写）
2. 若匹配到唯一成员 → 使用该成员的 user_id 作为 created_by
3. 若匹配到多个同名成员 → 【该行 ERROR】：记账人"小赵"在本家庭存在多个同名成员，无法确定归属
4. 若未匹配：
   4a. is_costra_export = true（自产文件，§2.1.1）→ 【该行 ERROR】
       记账人"老王"不是本家庭的活跃成员，无法确定归属
   4b. is_costra_export = false（外部 CSV）→ 归属当前导入操作者 + WARNING
5. 若列不存在或行值为空 → 归属当前导入操作者
```

> **规则 3 为什么是 ERROR 而不是 WARNING**（v0.6 修正）：`users.nickname` **没有 UNIQUE 约束**，家庭内昵称重复是完全可能的。v0.5 的"取第一个匹配（按 join 时间排序）+ WARNING"意味着**静默把 A 的支出记到 B 名下** —— 在家庭共享账本里这是实质错账，会直接污染成员统计（成员统计按 `entries.created_by`），且用户几乎不可能从一条 warning 里察觉。跳过该行并明确报错，引导用户先改昵称或删除该列，是唯一安全的处理。

> **规则 4 为什么按文件来源分级**（v0.8 修正 · P1）：v0.7 对"未匹配"一律 WARNING，但**它的后果与规则 3 完全相同**（记录归到错误的人名下、污染成员统计），却给了两种截然不同的处置，逻辑不自洽。
>
> 区分依据是"该文件的昵称本应能匹配吗"：
> - **自产文件**（9 列表头指纹命中）：昵称来自本系统导出，匹配不上只可能是"成员改过昵称"或"成员已退出家庭"—— 两者都是用户必须知情的家庭状态变化，尤其在 §1「家庭数据交接」这一主场景里，静默漂移会让接手方的成员统计从第一天起就是错的。故判 **ERROR**，错误文案引导用户改回昵称或删除该列（删列后全部归操作者，是用户显式选择的结果）。
> - **外部 CSV**：昵称本就与 Costra 家庭无关（微信账单里根本没有这一列语义），匹配不上是常态而非异常，保持 WARNING + 归操作者。
>
> 该分级同时保证了 §2.3 的闭环承诺：自产自入路径上不存在"静默的 `created_by` 漂移"。

### 3.4 「类型」列的模糊兼容

| 输入值（不区分大小写 · trim 后）| 映射结果 |
|---|---|
| `支出` / `expense` / `花费` / `消费` / `-` | `expense` |
| `收入` / `income` / `进账` / `+` | `income` |
| `转账` / `transfer` / `内部转账` / `转移` | `transfer` |
| 其他 | **该行 ERROR**：`类型无法识别: "退款"` |

### 3.5 「金额」列的容错解析

```text
原始值 → 清洗步骤 → 结果
"¥1,234.56"  → 去符号前缀 → 去千分位逗号 → 取绝对值 → 1234.56
"-35.5"      → 取绝对值 → 35.50
"35.567"     → 四舍五入到分 → 35.57（同时产生 WARNING：精度截断）
"0"          → ERROR：金额为 0
""           → ERROR：金额为空
"abc"        → ERROR：金额非法
```

### 3.6 「日期」+「时间」列的容错解析

**日期**支持格式：

| 格式 | 示例 | 处理 |
|---|---|---|
| `YYYY-MM-DD` | `2026-06-10` | 直接使用 |
| `YYYY/MM/DD` | `2026/06/10` | 替换 `/` 为 `-` |
| `YYYY.MM.DD` | `2026.06.10` | 替换 `.` 为 `-` |
| `MM/DD/YYYY` | `06/10/2026` | 重排为 ISO |
| `YYYY-MM-DD HH:mm:ss` | `2026-06-10 14:30:00` | 拆出日期和时间 |
| `YYYY-MM-DDTHH:mm:ss` | `2026-06-10T14:30:00` | 拆出日期和时间 |

**时间**支持格式：
- `HH:mm` → 直接使用
- `HH:mm:ss` → 截取 `HH:mm`
- `H:mm` → 补零为 `0H:mm`

如果日期列本身包含了完整的 datetime（如微信账单的 `交易时间` = `2026-06-10 14:30:00`），且 CSV 没有独立的时间列，解析器自动从日期列中拆出时间。

#### 时区口径（v0.6 补充 · 必须显式）

`entries.occurred_at` 是 `TIMESTAMPTZ`，而 CSV 里的日期/时间是**不带时区的本地墙钟时间**。必须显式声明：

- **导入侧**：解析出的 `YYYY-MM-DD HH:mm` 一律按 **`Asia/Shanghai`** 构造 `occurred_at`，与导出侧（§9.2）同口径。
- **禁止按 UTC 解析**：否则 `2026-06-01 00:30` 会被存成 `2026-05-31T16:30Z`，在 Asia/Shanghai 口径下仍是 6 月 1 日 —— 但若实现误用 `new Date('2026-06-01 00:30')` 依赖进程本地时区，在 UTC 容器里会产生真实的**跨月漂移**，直接错月归属、污染月度统计与预算。
- CSV 中若出现带时区偏移的 datetime（如 `2026-06-10T14:30:00+09:00`），按其自带偏移解析后转换为 `Asia/Shanghai` 展示口径入库；不静默丢弃偏移。

### 3.7 分类匹配策略（按 type + 名称）

> **前置铁律**：`categories.type` 与 `entries.type` 必须一致（`entryService.resolveCategoryId` 对不一致直接拒绝）。因此分类匹配**必须先由「类型」列确定 type，再在该 type 的分类树内查找**。

```text
1. 由「类型」列解析出 entryType（income / expense / transfer，§3.4）
2. 精确匹配目标家庭自定义分类（family_id + type = entryType + parent_id IS NULL + name）
3. 精确匹配系统预设分类（family_id IS NULL + type = entryType + parent_id IS NULL + name）
4. 模糊匹配：去掉尾部空格、全角→半角、繁→简 后再试一次
5. 仍未命中 → ERROR，该行不入库
```

**不做自动创建分类**：用户可能把错别字或旧分类名传进来，自动建会产生垃圾分类。提示用户导入前先在小程序中确认分类体系与 CSV 中的名称对齐。

**跨 type 命中的专用错误文案**（v0.6 补充）：若分类名在**其它 type** 下存在（如收入行填了 `餐饮`），错误信息必须指出真因，而不是笼统的"分类不存在"：

```text
第 12 行：分类「餐饮」属于支出类型，不能用于收入记录。
```

**transfer 类型的分类名**（v0.6 修正）：系统 transfer 一级分类是 **`储值` / `账户互转` / `赊销`**，**不存在名为「转账」的分类**。外部账单若把转账类记录的分类写成"转账"，会在步骤 5 报 ERROR。这是符合预期的行为（不自动创建分类），但导入引导文案应提示：`转账类记录请使用 储值 / 账户互转 / 赊销 作为一级分类`。

二级分类匹配：
- 非空时：在已匹配的一级分类下查找 `name` 精确匹配的子分类；未找到 → WARNING，降级到该一级下的**默认子分类**
- 为空时 → 直接取该一级下的**默认子分类**

> **默认子分类的判定**：不使用"取 `sort_order = 1`"这一想当然口径——`categories.sort_order DEFAULT 0`，不保证存在 `sort_order = 1` 的行。改用库中权威标记：**优先 `is_parent_default = true`**（migration 0013 引入，语义精确为"点父一级时自动选中的默认子"，且有唯一索引 `uq_categories_parent_default` 保证每父级至多一个），理论上兜底不到时再退回同一级 `ORDER BY sort_order, name LIMIT 1`。与 `categoryRepo.findFallbackCategoryId` 的同 type 兜底逻辑对齐（该函数正是用 `is_parent_default`）。

### 3.8 「归属」列的解析

| 输入值 | 映射 |
|---|---|
| `共同` / `shared` | `shared` |
| `个人` / `personal` | `personal` |
| 空（支出行）| **沿用账本所属家庭的默认语义**（见下）|
| 空（收入/转账行）| NULL（忽略） |
| 非支出类型填了归属 | WARNING：`非支出类型的归属列将被忽略` |

#### 支出缺省归属：沿用家庭默认语义（v0.6 修正）

v0.5 冻结"支出缺省一律 `个人`"。这条在**共同家庭**里是错的：

```text
现有语义（entryService.resolveDefaultSharedType）：
  personal family → 'personal'
  shared   family → 'shared'
```

App 内手工记账的缺省归属由家庭类型推导。若导入硬编码为 `个人`，则在共同家庭里导入一份无归属列的外部账单（正是"外部账单迁入"这一主场景）会把**全部支出打成个人**，共同/个人统计口径与家庭协作账目直接失真，而用户完全没有察觉的入口。

v0.6 决策：**导入复用 `resolveDefaultSharedType`**，与手工记账保持同一缺省语义。

- 检测报告中，当"归属列缺失或存在空值 且 目标家庭为共同家庭"时，追加一条**汇总级 WARNING**：`N 条支出未指定归属，将按共同家庭默认记为「共同」`，让用户在确认前可见。
- `shared_type` 只允许出现在 expense 行（DB 约束 `chk_entries_shared_type_scope`），收入/转账恒为 NULL。

#### 跨家庭类型导入的归属污染

把共同家庭的导出（含「共同」）导入**个人家庭**账本时，DB 层不禁止 `shared_type='shared'`，会在个人账本产生"共同支出"。处理：**个人家庭为目标账本时，忽略 CSV 的归属值并强制 `personal`，追加 WARNING** `目标为个人账本，归属列已统一按「个人」处理`。

### 3.9 去重策略与稳定幂等键

- **不保留任何用户传入的记录ID**：`记录ID` / `id` / `entry_id` 列仍禁止传入（§3.1）。
- **每次导入的 `entry_id` 全部由服务端在 detect 阶段生成 UUID v7**，不做跨次去重。
- 重复导入同一份文件会产生重复记录，这是**已接受的代价**；用户若需重来应先在小程序删除上次导入的记录。

**稳定幂等键**（服务本次重试幂等，不做跨次去重）：
- detect 阶段为每条合法记录同时生成：
  - `entry_id = UUID v7`（服务端生成，落 detect 产物 NDJSON，§7.4）
  - `client_ref_id = import:<detect_id>:<logical_row_no>`
- 这不违反"不允许传入记录ID"——ID 由服务端生成，用户不可控；用户重新检测同一文件（超过 15 分钟幂等窗口后）会得到**新的** `detect_id`，因此仍可再次导入并产生重复记录，符合上面的已接受代价。
- 作用：**同一个导入任务重试时复用同一组 `entry_id/client_ref_id`**，配合 §7.5 的原子提交与 entries 唯一约束 `uq_entries_ledger_client_ref`，保证"重试不产生重复"。
- 服务端在导入成功后返回 `job_id`，用户可从任务记录回溯。

> **`client_ref_id` 不只是幂等键，它同时是客户端本地库的主键**（v0.6 补充 · 防止后人误删）：小程序本地库以 `entry:<client_ref_id>` 为 key 存储实体、月索引也以 `client_ref_id` 为元素（`miniprogram/services/db.ts`），且 `wireToEntry` 直接读取 `wire.client_ref_id`。若导入写入的 entries **没有** `client_ref_id`，sync 下发后客户端根本无法落库。因此"导入必须写 client_ref_id"是**功能前提**，不是可选的幂等优化 —— 任何"简化"掉它的重构都会导致导入数据在客户端整体丢失。

### 3.10 校验结果分级

| 级别 | 含义 | 处理 |
|---|---|---|
| **ERROR** | 该行数据不合法，无法入库 | 跳过该行，记入检测报告 |
| **WARNING** | 数据可入库但存在潜在问题 | 正常入库，记入检测报告 |

Warning 场景举例：
- 二级分类不存在但一级存在 → 降级到默认子分类
- 非支出类型填了归属 → 忽略归属值
- 金额精度超限 → 四舍五入到分
- **外部 CSV** 的记账人未匹配到家庭成员 → 归属当前导入操作者（自产文件的未匹配是 ERROR，§3.3 规则 4）
- 备注超 200 字符 → 截断到 200（§3.11）
- 共同家庭缺归属列 → 汇总级提示将记为「共同」（§3.8）

### 3.11 detect 必须覆盖 DB 侧硬约束（v0.6 新增 · P0）

§7.4 承诺"用户看到的检测结果与实际写入内容逐字段一致"。要让这条成立，**detect 的校验集必须是 `entries` 表全部硬约束的超集**，否则会出现最糟的失败模式：

```text
检测报告：✅ 可导入 1,268 条
   ↓ 用户确认
commit：第 837 行 note 超 200 字符 → INSERT 违反 CHECK
   ↓ §7.5 归类为"数据违反业务约束"
整批回滚 + failed + 不可重试
```

用户为一条超长备注失去整批导入，且**在检测阶段完全没有得到预警**。

必须在 detect 逐行校验的约束（事实源 `server/db/migrations/0001_init.sql` entries 表）：

| DB 约束 | 来源 | detect 侧处理 |
|---|---|---|
| `note CHECK char_length(COALESCE(note,'')) <= 200` | `entries` | **截断到 200 + WARNING**（外部账单把"商品/交易对方"映射进备注极易超限，不应因此丢行）。⚠️ **必须按 Unicode code point 截断**（见下）|
| `amount CHECK (amount > 0)` | `entries` | 金额为 0 / 负数取绝对值后仍为 0 → ERROR（§3.5 已覆盖，此处确认对齐）|
| `chk_entries_shared_type_scope`（`shared_type IS NULL OR type='expense'`）| `entries` | 收入/转账行的归属值强制置 NULL + WARNING（§3.8 已覆盖）|
| `currency NOT NULL DEFAULT 'CNY'` | `entries` | 恒填 `CNY`（不导出/不导入币种列，§2.3）|
| `category_id REFERENCES categories(id)` | `entries` | 必须解析为**真实存在且未软删**的 category_id（§3.7）；**不可依赖 FK 兜底**（见 §7.5）|
| `created_by REFERENCES users(id)` | `entries` | 必须解析为目标家庭的**活跃成员** user_id；**不可依赖 FK 兜底**（见 §7.5）|
| `name CHECK char_length BETWEEN 1 AND 16` | `categories` | 仅影响分类匹配（不创建分类），无需校验 |

> **note 截断必须按 code point，不能用 `String.prototype.slice`**（v0.8 新增 · P2）：PG 的 `char_length` 按**字符**计数，而 JS 字符串索引是 **UTF-16 code unit**。备注含 emoji 或其它 BMP 外字符时（如 `😀` 占 2 个 code unit），`note.slice(0, 200)` 会：① 计数偏小，实际字符数不足 200 就被砍；② **可能从代理对中间切断**，产生孤立代理项（lone surrogate），这类字符串写入 PG 会触发 `invalid byte sequence for encoding "UTF8"`，把"截断 + WARNING 的柔性降级"变成整批事务失败 —— 恰恰是本节要消除的失败模式。
> 正确实现：`Array.from(note).slice(0, 200).join('')`（按 code point 切分）。单测必须覆盖"200 个 emoji 的备注"。

> **实现约束**：这张表必须与 `0001_init.sql` 的 entries DDL 做**人工对照**，且在 `entryImport` service 的单测里逐条覆盖。后续任何给 `entries` 加 CHECK 的 migration，都必须同步更新 detect 校验集 —— 建议在 migration 模板的 checklist 里登记这条依赖。

---

## 4. 导入两阶段流程：检测 → 确认导入

### 4.1 设计目标

导入必须分两个阶段执行，让用户在真正写入数据前看到完整的检测报告：

```text
阶段 1 · 检测（dry-run）
  - 用户上传 CSV
  - 服务端完整解析 + 校验所有行
  - 不写入数据库
  - 返回结构化检测报告：总行数 / 可导入 / 错误 / warning

阶段 2 · 确认导入（commit）
  - 用户查看检测报告
  - 用户决定是否继续
  - 用户点"确认导入"后，服务端执行真正的入库
  - 返回导入结果
```

### 4.2 阶段 1 · 检测

#### API

```yaml
paths:
  /import-jobs/detect:
    post:
      summary: 上传 CSV 并执行检测（不写入数据库）
      security: [{ bearerAuth: [] }]
      requestBody:
        content:
          multipart/form-data:
            schema:
              type: object
              required: [file, ledger_id]
              properties:
                file: { type: string, format: binary }
                ledger_id: { type: string, format: uuid }
      responses:
        '200':
          description: 检测完成
          content:
            application/json:
              schema:
                $ref: '#/components/schemas/DetectReport'
        '409':
          description: |
            code=IMPORT_JOB_IN_PROGRESS 该账本已有导入任务在执行
            code=DETECT_IN_PROGRESS    该用户已有检测在进行
        '413':
          description: code=PAYLOAD_TOO_LARGE · 文件超过 1MB（§9.1、§9.5）
        '429':
          description: code=RATE_LIMITED · detect 频控触发（§9.1）
```

> 所有错误响应体遵循既有统一错误格式（`errorHandler.ts` 单出口），**必须含 `code`**；客户端依 `code` 判分支，不得依 HTTP status（§9.5）。

#### detect 幂等：同文件重复上传复用 ready 会话（v0.8 重排执行顺序）

detect 是**纯 CPU + 磁盘密集**操作。若客户端因弱网超时重发，会重复消耗单核算力。

> ⚠️ **v0.7 的顺序不可实现**（P1 修正）：v0.7 §4.2 写"会话建立后先算 `file_sha256`"，§7.4 步骤 1 又写"先创建 `detecting` 会话"再解析。两者与并发唯一索引 `uq_detect_sessions_active_per_user (user_id) WHERE status='detecting'` 组合后产生两个死结：
> 1. 为算 sha 必须先收完流，此时 `detecting` 行已插入并**占住了并发槽**；幂等命中后这行如何收场未定义 —— 置 `failed` 会在用户任务列表里凭空多出失败记录。
> 2. **弱网重发这一主场景根本走不到幂等**：第一个请求仍在 `detecting`，第二个请求会先撞 `409 DETECT_IN_PROGRESS`。sha256 幂等实际只覆盖"首次已完成 + 用户 15 分钟内重传同文件"这个窄窗口，远小于 v0.7 宣称的收益。

v0.8 执行顺序（**收流与建会话解耦**）：

```text
1. 校验 JWT + ledger 权限 + 频控（Redis 计数器，§9.1）
2. 收流到内存/临时缓冲（≤1MB，受 multipart fileSize 兜底），同时增量计算 file_sha256
   —— 此阶段【不建会话】，不占并发槽
3. 查 (user_id, ledger_id, file_sha256) 且 status='ready' 且 expires_at > now() 的会话
   命中 → 直接返回该会话的 DetectReport（不建会话、不解析、不占槽）
4. 未命中 → INSERT status='detecting' 会话行
   唯一索引冲突 → 409 DETECT_IN_PROGRESS
5. 开始流式解析 + 校验 + 落产物（§7.4 步骤 2 起）
6. 解析结束 → ready / failed，释放并发槽
```

- 索引：`import_detect_sessions (user_id, ledger_id, file_sha256)`（§7.3）。
- 注意：这不影响"重复导入产生重复记录"的既定语义（§3.9）—— 幂等只作用于 **detect 的 15 分钟有效期内**，用户主动重新检测（超期后）仍会得到新 `detect_id`。

> **显式承认的边界**：步骤 2 的收流阶段不受"同用户单并发"保护。这是有意的取舍 —— 并发槽要防的是**解析**（单核 CPU 大头，§4.4），而收 1MB 流的成本可忽略，且频控（步骤 1）已在更外层限制总量。把并发判定挪到收流之后，是让 sha256 幂等真正覆盖弱网重发场景的必要代价。

#### DetectReport 结构（汇总 + 预览 + 完整报告分离）

检测仍"检查所有行"，但**不把全部错误塞进一个 HTTP 响应**（上千行错误会撑爆响应体、拖慢单核）。响应只返回精确汇总 + 各前 100 条预览 + 截断标志；完整问题报告另走下载端点。

```json
{
  "detect_id": "019...",
  "ledger_id": "019...",
  "ledger_name": "我的家庭",
  "family_kind": "shared",
  "file_name": "data.csv",
  "file_size": 12345,
  "file_sha256": "...",
  "is_costra_export": true,
  "formula_guard": "apostrophe-v2",
  "total_rows": 1280,
  "importable_rows": 1268,
  "error_count": 5,
  "warning_count": 7,
  "errors_preview": [
    { "row": 12, "field": "日期", "code": "EMPTY_REQUIRED", "value_preview": "" },
    { "row": 45, "field": "类型", "code": "TYPE_UNRECOGNIZED", "value_preview": "退款" }
  ],
  "warnings_preview": [
    { "row": 3, "field": "二级分类", "code": "SUBCATEGORY_FALLBACK", "value_preview": "快餐" },
    { "row": 8, "field": "记账人", "code": "MEMBER_UNMATCHED", "value_preview": "老王" }
  ],
  "errors_truncated": false,
  "warnings_truncated": false,
  "report_path": "/import-detect-sessions/019.../report",
  "created_at": "2026-08-05T16:00:00+08:00",
  "expires_at": "2026-08-05T16:15:00+08:00"
}
```

- `detect_id`：检测会话 ID（对应 PG `import_detect_sessions.id`，§7.3），用于阶段 2 确认导入与拉完整报告。
- `is_costra_export` / `formula_guard`：由 §2.1.1 的 9 列表头指纹判定；非 Costra 自产文件时分别为 `false` / `none`。
- `family_kind`：目标账本所属家庭类型（`personal` / `shared`）。客户端据此渲染 §3.8 的归属缺省提示（共同家庭要明确告知"将记为共同"）。
- `errors_preview` / `warnings_preview`：各**最多前 100 条**；条目结构为 `{ row, field, code, value_preview }`：
  - **不含整行原文**——整行原文可能含其它成员敏感数据、体积大、且日志留存有隐私风险。
  - `value_preview`：仅该出错字段的值，**截断至 120 字符**。
  - `code`：机读错误码，客户端据此本地化文案，不依赖服务端中文串。
- `errors_truncated` / `warnings_truncated`：为 true 时表示还有更多，引导用户下载完整报告。
- `report_path`：§7.6 完整问题报告 CSV 的**相对路径**（应用层鉴权 · 校验属主）；本身也是导出，走 §9.3 Formula 防护。
- `expires_at`：`ready` 会话有效期 15 分钟；超时后 `commit` 返回 `410 DETECT_SESSION_EXPIRED`，需重新检测。

> **为什么是相对路径而不是绝对 URL**（v0.8 修正 · P2）：v0.7 下发 `https://costra.cloud/v1/...` 硬编码域名，在 staging（`stg.costra.cloud`）上会把客户端指向生产域。所有下发给客户端的资源地址一律用相对路径，由客户端拼 `miniprogram/config/env.ts` 的 baseURL。§6.2 的 `download_url` 同此处理。

> **`row` 的口径**：指 CSV 的**逻辑记录序号**（表头为第 0 条，首条数据行为 `row=1`），**不是物理行号** —— 因为备注可能含 quoted multiline（§2.1），物理行与逻辑记录不是 1:1。客户端文案统一用"第 N 条记录"而非"第 N 行"，避免用户在 Excel 里数不对位置。完整报告 CSV 同时给出逻辑序号与该记录起始物理行号，便于定位。

#### 客户端检测中交互

```text
选择目标账本
→ 从微信聊天选择 CSV
→ 上传中（请勿离开）
→ 检测中...
→ 展示检测报告
```

上传和检测阶段任务卡文案：

| 阶段 | 是否可离开 | 页面文案 |
|---|---|---|
| 上传中 | **不可** | `正在上传 42% · 请暂时不要离开` |
| 检测中 | **不可** | `正在检测文件 · 请稍候` |
| 检测完成 | 可 | 展示检测报告 |

### 4.3 阶段 2 · 确认导入

#### 检测报告展示

检测报告页面分三部分：

```text
┌─ 检测结果 ──────────────────────────────┐
│                                          │
│  文件：data.csv · 1,280 行               │
│  ✅ 可导入：1,268 条                      │
│  ⚠️ 警告：7 条                            │
│  ❌ 错误：5 条（将跳过）                  │
│                                          │
│  目标账本：我的家庭                       │
│                                          │
└──────────────────────────────────────────┘

┌─ 错误详情（5 条） ──────────────────────┐
│  第 12 行：日期为空                       │
│  第 45 行：类型无法识别: "退款"           │
│  ...                                     │
│  查看全部错误 ›                           │
└──────────────────────────────────────────┘

┌─ 警告详情（7 条） ──────────────────────┐
│  第 3 行：二级分类"快餐"不存在，          │
│           已降级到默认子分类              │
│  第 8 行：记账人"老王"未匹配到家庭成员，  │
│           归属当前操作者                  │
│  ...                                     │
│  查看全部警告 ›                           │
└──────────────────────────────────────────┘

[          确认导入 1,268 条          ]
[          取消 · 重新选择文件          ]
```

#### 用户决策路径

| 检测结果 | 用户可选项 |
|---|---|
| 全部可导入，0 错误 | `确认导入` / `取消` |
| 有错误，但有可导入行 | `确认导入 N 条`（跳过错误行）/ `取消` |
| 全部错误，0 可导入 | 仅显示 `重新选择文件`（无确认按钮） |
| 有 warning 但无错误 | `确认导入`（warning 不阻塞）/ `取消` |

#### 确认导入 API

```yaml
paths:
  /import-jobs/commit:
    post:
      summary: 基于检测结果执行真正导入
      security: [{ bearerAuth: [] }]
      requestBody:
        content:
          application/json:
            schema:
              type: object
              required: [detect_id]
              properties:
                detect_id: { type: string, format: uuid }
      responses:
        '202':
          description: 导入任务已创建
          content:
            application/json:
              schema:
                type: object
                properties:
                  job_id: { type: string, format: uuid }
                  status: { type: string, enum: [queued] }
        '409':
          description: code=IMPORT_JOB_IN_PROGRESS · 该账本已有导入任务在执行
        '410':
          description: code=DETECT_SESSION_EXPIRED · 检测报告已过期，请重新检测
```

#### 确认后异步任务

用户点"确认导入"后：
1. 服务端校验 `detect_id` 未过期
2. 服务端校验目标账本当前无运行中的导入任务（**同一账本同时只允许一个导入任务**）
3. 创建异步导入任务，返回 `202 + job_id`
4. 客户端切到任务卡模式，用户可离开页面

### 4.4 并发约束

| 规则 | 说明 |
|---|---|
| 导入任务 · 约束对象 | **账本**（不是用户）；DB 唯一索引 `uq_data_jobs_active_import_per_ledger` 兜底 |
| 确认导入阶段 | 若该账本已有 `queued` / `processing` 状态的导入任务，返回 `409 IMPORT_JOB_IN_PROGRESS` |
| 释放时机 | 任务进入 `succeeded` / `failed` 终态时释放 |
| **检测阶段 · 约束对象** | **用户**：同一用户同时只允许 1 个 `detecting` 会话，返回 `409 DETECT_IN_PROGRESS`（v0.6 新增）|
| 检测并发的生效起点 | **收流 + sha256 完成之后**才判并发（§4.2 v0.8 顺序）；收流阶段不占槽 |
| 用户提示 | 导入：`该账本已有导入任务正在进行，请完成后再试`；检测：`上一个文件还在检测中，请稍候` |

> **检测为什么也要限并发**（v0.6 修正）：v0.5 明确"检测不占并发槽"，配合 §9.1 的"5 分钟 5 次"频控，用户连点即可**同时**触发 5 个流式解析。生产是 2 核 4G 单进程，Node 的 CPU 是主瓶颈，5 个并发解析会直接拖垮所有在线 API 的 P99。频控限的是"一段时间内的总次数"，并发限的是"同时进行数"，两者都需要。
> 实现：`import_detect_sessions` 上加 partial unique index `(user_id) WHERE status='detecting'`；解析结束（ready/failed）即释放。异常退出导致的僵死 `detecting` 会话由 §7.4 的定时清理按 `created_at` 超时回收。
> **并发槽保护的是解析而非收流**（v0.8 补充）：判定点后移到 sha256 之后，见 §4.2 的顺序说明与边界承认。

### 4.5 检测报告过期与重新检测

- 检测报告有效期 **15 分钟**
- 超时后 `commit` 返回 `410 Gone`，客户端提示 `检测报告已过期，请重新选择文件检测`
- 检测阶段不保留 CSV 文件本体，只保留规范化行产物与摘要（§7.4）
- 服务端定时清理过期 `ready` 会话及其产物

---

## 5. 导入端到端流程

```text
① 用户先把 CSV 发到任意微信聊天（推荐"文件传输助手"）
② 打开小程序 → 我的 → 设置 → 账本导入 / 导出
③ 进入"导入账本"，选择目标账本
④ 点击"从微信聊天选择 CSV" → wx.chooseMessageFile
⑤ 选中文件 → 页面展示文件名、大小、目标账本（客户端先校验 ≤1MB / .csv）
⑥ 点"开始检测" → wx.uploadFile 上传到 /v1/import-jobs/detect
   - 上传中：enableAlertBeforeUnload 防误返回
   - 服务端接收文件 → 流式解析 → 校验 → 返回 DetectReport
   - 收到报告后 disableAlertBeforeUnload
⑦ 展示检测报告：可导入 N 条 / 错误 M 条 / warning K 条
⑧ 用户决策：
   - 点"确认导入 N 条" → POST /v1/import-jobs/commit { detect_id }
   - 服务端创建异步任务 → 返回 202 + job_id
   - 或点"取消 · 重新选择文件" → 回到步骤 ④
⑨ 页面切到任务卡：`正在后台导入 · 可以离开此页面`
⑩ 任务 succeeded 后，客户端调 triggerOnMutation() 主动推一轮 sync（§5.1）
⑪ 数据经既有 sync 通道落本地库，明细页 / 统计页按既有 SYNC_DONE 机制刷新
```

### 5.1 导入数据如何到达客户端（v0.8 修正 · 关键）

#### 结论：不做导入专用旁路，依赖既有 sync

Costra 客户端已有完整的增量下行机制，导入**不需要**任何新通道：

- 服务端 `entries.change_seq` 是全库单调序列，客户端按 family 维护 watermark（`GET /sync/pull?since=<change_seq>`）；`syncPull` 已按 L13 落地为**分页循环**（`limit=500` / `MAX_PULL_PAGES=40` / 截断 300ms `pull-continue` 续拉 / `SYNC_DONE` 收敛后一次广播）。
- 导入写入的 entries 天然带上更大的 `change_seq`；且导入事务对受影响账本推进 `sync_epoch` 与 `sync_epoch_floor_seq`（§7.5 步骤 5），客户端下一轮 pull **前置比对 epoch 不一致 → 把 watermark 回退到 `floor_seq` → 定点重拉**（见下方"导入后的实际路径"与 §5.2）。
- 触发源已足够密集：`periodic`(60s) / `page-show`(5s debounce) / `mutation` / `network-recover` / `launch`。
- `applyServerEntriesBatch` 批量落盘，经**月索引写串行队列**维护月索引，明细页 `SYNC_DONE` → `_refreshIfChanged`（签名 diff）刷新。

因此 v0.6 明确、v0.7 维持：**导入完成后不推送、不新增端点、不做"清本地月缓存"之类的定向失效**。唯一动作是任务转 `succeeded` 后客户端调一次现成的 `triggerOnMutation()`，把等待从"最长 60s"缩短到"秒级"。

> **为什么不做定向失效**（推翻上一轮 review 中我方的提议）：设想"清掉受影响月份的月索引，让用户切到该月时走 `_hydrateRemoteMonthEntries` 全量拉"。这条路**不可行**：`listMonthEntries` 在月索引缺失时会 `rebuildEntryMonthIndex`（L13 后从**键枚举**重建，`entry:__index` 已废除）；sync 已拉回的部分实体仍在本地，重建后 `entries.length > 0`，走不进 `_loadEntries` 的空态分支，hydrate 永远不触发。要真触发就得删该月 entry 实体本身，会与 outbox pending op 冲突 —— 属于"为修问题写硬逻辑"。**既有 sync 已能保证最终一致，不该为导入加旁路。**

#### 前置依赖：已修复（L13 · 2026-09-01 落地）

v0.6 列出的前置缺陷「`sync/pull` 的 `has_more` 无人消费」已按 `docs/design/sync-pull-pagination-design.md` **v0.8** 全量落地修复：

| 落地项 | 内容 |
|---|---|
| C1 分页循环 | 客户端 `syncPull` 循环消费 `has_more`（`limit=500` / `MAX_PULL_PAGES=40` / 截断 300ms `pull-continue` 续拉 / `SYNC_DONE` 收敛后一次广播且 `pulled=applied`） |
| C2 批量落盘 | `applyServerEntriesBatch` 批量写入，废除 `entry:__index` 单 key 数组（O(n²) 写放大消失），rebuild 改 `wx.getStorageInfo` 键枚举 |
| E1 epoch 版本戳 | `ledgers.sync_epoch`（migration `0019`）；任何绕过 `entryService` 的批量写入必须**同事务** `+1`；客户端 epoch 不一致（含 key 集合缺失）即清零 watermark 全量重拉。**v0.8 在此基础上增加 `sync_epoch_floor_seq`，把"清零全量"收窄为"定点回退"，改动定义见 §5.2** |
| R5 月索引串行队列 | mutation / hydrate / 批量 / rebuild 四方写者入队；批末重读为 null 走不入队的裸推导重建 |
| 服务端配套 | `has_more=true` 轮跳过 `computeSystemCategoriesRevision()`；`ledgers[]` 透传 `sync_epoch` |

由此 v0.6 担心的"导入 5,000 条需 25 轮 ≈ 25 分钟、期间月度合计静默错误"已不存在；「新设备首次登录有几千条流水的老账号」这一既有场景同样收敛。

#### 导入后的实际路径（v0.8 修正 · 从"全量重拉"改为"定点重拉"）

> ⚠️ **v0.7 的量级算错了**（P0 修正）。原文写"5,000 条量级账本 ≈ 10 页 × 500，秒级收敛"，这句把**导入行数**当成了**重拉量**。实际上 epoch diff 触发的是 `setWatermarkStrict(familyId, 0)`，客户端从 `since=0` 重拉的是该 family 的**全部历史 entries**，而且：
>
> - `entryRepo.findEntriesByFamilySince` **不过滤 `deleted_at`**（sync 协议 §3.5：软删行必须在窗口内返回），历史删除的记录也全部重传；
> - 客户端硬顶是 `MAX_PULL_PAGES=40`（20,000 条）。一个用了两年的账本（2 万条 + 历史软删）再导入 5,000 条 ≈ 25,000 行 → **撞顶截断**，转入 300ms `pull-continue` 续拉，不是"秒级收敛"；
> - `sync_epoch` 是 **ledger 级**的，family 内**所有成员的所有设备**各自触发一次全量重拉，一次导入被放大成 N 份全量下行；
> - `miniprogram/services/db.ts` 目前**没有微信 storage 配额（单 key 1MB / 总量 10MB）超限的降级分支**，全量重拉恰恰是最逼近容量上限的场景，行为未定义。
>
> 结论：v0.7 的路径能保证正确性，但代价与"导入了多少"完全脱钩，只与"账本活了多久"相关 —— 这是不可接受的成本模型。

v0.8 引入 **`ledgers.sync_epoch_floor_seq`**（定义与客户端改动见 §5.2），把重拉区间从"全量"收敛为"导入批次起点之后"：

1. 导入事务 COMMIT，原子可见：entries + 余额 + `sync_epoch + 1` + **`sync_epoch_floor_seq = MIN(本批 change_seq) - 1`** + `job=succeeded`（§7.5 步骤 5）；
2. 客户端下一轮 `syncPull` 前置比对 epoch，不一致时**不再清零**，而是把 watermark 置为 `min(localWatermark, serverFloorSeq)`，随后从该点循环拉取；
3. 重拉量 = 导入条数 + 导入事务开启期间的并发写入量，与账本历史规模**无关**。5,000 行导入 ≈ 10 页 × 500，此时"秒级收敛"才成立；
4. `SYNC_DONE` 仍只在收敛后广播一次，页面不呈现中间态；
5. 落盘判定 `serverVer > localVer || (serverVer === localVer && !pendingRefs.has(ref) && !sameEntryContent)` 保证与本地 outbox pending op 不冲突，重拉幂等。

**为什么 `floor_seq` 仍能完整堵住 `change_seq`「已取号未提交」洞**：该洞的成因是导入长事务先取了号段 `[a, b]` 但未提交，期间并发单笔写入取号 `c > b` 并**先**提交，客户端 watermark 被推到 `c`，导入提交后 `[a, b]` 永远落在 watermark 之后（永久拉不到）。`floor_seq = a - 1` 取在整个号段之前，客户端回退到 `a - 1` 后必然重新覆盖 `[a, b]` 与 `c`，洞被完整包住。**清零全量重拉只是这个正确解的过度加强版，`floor_seq` 是它的最小充分形式。**

**上线前置（唯一剩余门槛）**：客户端 epoch 消费能力必须先于导入入口达到目标版本覆盖率（决策 16、§7.5）。旧版本客户端无 epoch 逻辑，遇到导入这类批量写入会踩上述洞（导入数据永久拉不到）。

> ⚠️ **v0.8 使门槛的版本口径发生了变化**：目标覆盖率现在指"**已消费 `sync_epoch_floor_seq` 的版本**"，而非 L13 落地的那个 epoch 版本。§5.2 定义了对"只认 `sync_epoch`、不认 `floor_seq`"的中间版本客户端的兼容降级（自动回退到清零全量重拉），因此中间版本**不会丢数据**，只是成本回到 v0.7 水平 —— 门槛可按"不丢数据"放行，按"成本可接受"择机收紧。

**导出功能只读、无 epoch 依赖，可先行发布；导入入口等覆盖率达标后开放**（§14）。

#### 为什么不需要"按月拉取"

`_hydrateRemoteMonthEntries`（`/entries` 游标分页拉完整月）只在"本地该月完整为空 且 remote-empty 未确认"时触发，是为**冷启动/清缓存**场景设计的兜底，不是增量通道。导入后走 sync（epoch 定点重拉）即可，两条路径职责清晰，不应混用。

---

### 5.2 本方案对 sync-pull 的增量改动（v0.8 新增 · 在本文档冻结）

> **文档边界**：`docs/design/sync-pull-pagination-design.md`（L13）已于 2026-09-01 全量落地并**进入完成态，不再接受新增修订**。本节是本方案对 sync-pull 通道所需改动的**唯一事实源**；L13 文档仅作为既有不变量的引用来源，实现时**不要回头去改它**。
>
> 之所以把改动放在这里而不是那里：`sync_epoch_floor_seq` 是**为批量写入场景服务的**，它的唯一生产写入方就是本方案的导入事务。L13 的职责是"修 `has_more` 无人消费"，已经收口；把只服务于导入的字段追加进一个已完成的设计文档，会让那份文档的"完成"状态失真，也让后人分不清哪些是 L13 验收过的、哪些是后续追加的。

#### 5.2.1 为什么需要这个改动（而不是沿用清零）

见 §5.1「导入后的实际路径」的量级分析：沿用 `setWatermarkStrict(0)` 会让**一次 5,000 行的导入**在老账本上退化成 **family 内每台设备各一次 2.5 万行全量重拉 + 撞 40 页硬顶**。正确性没问题，成本模型不可接受。

`floor_seq` 不是为绕过问题而加的补丁，而是把"清零"这一过度加强的解**收窄到它的最小充分形式**（论证见 §5.1）。

#### 5.2.2 服务端改动

**① DB（并入 `0020` 迁移，§7.3）**

```sql
-- ledgers 增列：批量写入号段下界
-- 语义：最近一次批量写入所占 change_seq 号段的【前一个值】。
--       客户端 epoch diff 时把 watermark 回退到这里，即可完整覆盖该号段。
-- 默认 0：与 sync_epoch DEFAULT 0 对齐；0 等价于"回退到全量"，是安全侧默认值。
ALTER TABLE ledgers
  ADD COLUMN IF NOT EXISTS sync_epoch_floor_seq BIGINT NOT NULL DEFAULT 0;

COMMENT ON COLUMN ledgers.sync_epoch_floor_seq IS
'最近一次批量写入（导入等绕过 entryService 的路径）所占 change_seq 号段的下界-1。
 必须与 sync_epoch 在同一事务内更新。客户端 epoch diff 时回退 watermark 至此值，
 用于覆盖 change_seq「已取号未提交」洞，替代成本高昂的清零全量重拉。';
```

⚠️ 同步 `server/test/setup.ts` 的 pg-mem 内嵌 DDL（与 `0019` 同一硬约定）。

**② 写入方（导入事务内，§7.5 步骤 5）**

```sql
-- 与 INSERT entries 同一事务；min_change_seq 取本批实际写入的最小 change_seq
UPDATE ledgers
   SET sync_epoch           = sync_epoch + 1,
       sync_epoch_floor_seq = LEAST(
         CASE WHEN sync_epoch_floor_seq = 0 THEN $2 ELSE sync_epoch_floor_seq END,
         $2
       )
 WHERE id = $1;
```

`LEAST(...)` 的作用：若上一次批量写入的 floor 尚未被所有客户端消费完（如短时间内连续两次导入），floor **只能向更小的方向移动**，绝不能被后一次导入抬高 —— 抬高会把前一次的号段漏在回退区间之外，重新打开洞。

> **不变量 F1（必须列入 review 检查项）**：`sync_epoch_floor_seq` **只减不增**，直到有明确证据表明所有客户端已消费。本方案不实现"消费确认"机制，因此该字段在生产中**永远单调不增**（除非人工重置）。代价是长期多次导入后 floor 会逐渐逼近历史早期、重拉区间变大；这在导入是低频用户操作的前提下可接受，且始终不劣于 v0.7 的"每次都全量"。

> **不变量 F2**：`sync_epoch` 与 `sync_epoch_floor_seq` **必须同一条 UPDATE、同一个事务**。只更新前者 = 客户端回退到陈旧 floor（可能拉不全）；只更新后者 = 客户端根本不触发回退（epoch 没变）。两者分离是本节唯一靠约定守住的失败模式。

**③ 下发（`syncPullService.ts` 的 `LedgerWire`）**

`ledgers[]` 每项新增 `sync_epoch_floor_seq: number`，与既有 `sync_epoch` 并列，随每轮（含分页轮）全量下发。`ledgerRepo` 的 `SELECT_COLUMNS` 与 `rowToEntity` 同步增列。

#### 5.2.3 客户端改动

**① epoch 记录结构升级**

L13 现有本地结构是 `familyId → { ledgerId: epoch }`。升级为同时记录 floor：

```ts
type LedgerEpochRecord = { epoch: number; floorSeq: number };
type LedgerEpochs = Record<string, LedgerEpochRecord>;
```

**读取旧格式（`number`）时按 `{ epoch: n, floorSeq: 0 }` 升级**，避免版本切换时全量重拉一次（`floorSeq: 0` 只在真的发生 diff 时才退化为全量，不会主动触发）。

**② diff 后的回退取值（替代 `setWatermarkStrict(0)`）**

```text
diff 命中时：
  serverFloor = server.floorSeq ?? 0        // 服务端未下发该字段 ⇒ 0 ⇒ 退化为全量（安全侧）
  target      = Math.min(localWatermark, serverFloor)
  setWatermarkStrict(familyId, target)      // 仍是 strict：写失败即中止本轮、不写 epoch
  writeLedgerEpochs(familyId, serverEpochs) // 仍在 setWatermarkStrict 成功之后
  since = target
```

**③ 必须原样保留的 L13 不变量**（回归风险最高的四条，实现时逐条对照）：

| 不变量 | 内容 |
|---|---|
| 写序 | **先** `setWatermarkStrict` 成功，**才** `writeLedgerEpochs`。反序或清零失败仍写 epoch → 落到「epoch 新 + watermark 旧高值」的真丢数据态 |
| 空 ledgers | `changes.ledgers` 为空 ⇒ 跳过整个 epoch 环节（"没下发" ≠ "账本消失"） |
| 顺序 | watermark 合法性校验与资产覆盖写都排在 epoch 判定**之前**（epoch 轮 `continue` 会跳过其后逻辑） |
| 预算 | epoch 重置轮**计入** `pages` 并受 `MAX_PULL_PAGES` 截断约束，截断后由 `pull-continue` 兜底 |

**④ 单调性防御**：`target` 恒 `≤ localWatermark`，即回退只会让 watermark 变小或不变，不会前跳。若服务端返回的 `floorSeq > localWatermark`（理论上不应发生），`Math.min` 自动退化为"不回退"，此时仅靠 epoch 已变的事实无法保证覆盖 —— 故实现需对该情况打 `logger.error` 并**回退到清零**，不静默放行。

#### 5.2.4 版本兼容矩阵

| 客户端版本 | 服务端行为 | 结果 |
|---|---|---|
| 无 epoch 逻辑（L13 之前） | 正常下发 | ❌ **踩洞，导入数据永久拉不到** —— 这正是 §14 版本覆盖率门槛要挡的对象 |
| 有 epoch、无 floor（L13 ~ v0.8 之间） | 下发的 `sync_epoch_floor_seq` 被忽略 | ✅ 数据正确；成本回到 v0.7 的清零全量重拉 |
| 有 epoch + floor（v0.8 起） | 正常消费 | ✅ 数据正确；定点重拉，成本与导入量成正比 |
| 任意版本 + 老服务端（未下发 floor） | 字段缺失 | ✅ 客户端 `?? 0` ⇒ 退化为全量，安全侧 |

四种组合中**没有"丢数据"的新增格子**：新增字段只影响成本，不影响正确性。这是把改动做成"增量字段 + 安全侧默认"而非"改变既有语义"的直接收益。

#### 5.2.5 测试要求

- 服务端：同事务更新两字段的单测；`LEAST` 单调性单测（连续两次导入，floor 不被抬高）。
- 客户端：`{epoch, floorSeq}` 新旧格式读取兼容；diff 后 `target = min(local, floor)` 取值；`floorSeq > localWatermark` 时回退清零 + 打 error；四条 L13 不变量的回归用例**必须复用 L13 既有测试，不得重写**。
- 集成：导入 5,000 行到一个已有 2 万条历史的账本，断言客户端本轮拉取条数落在 `[5000, 5000 + 并发窗口]`，而非 25,000（这是本节唯一的收益断言，缺了它整个改动无从验收）。

---

## 6. 导出端到端流程

### 6.1 异步导出流程

```text
① 我的 → 设置 → 账本导入 / 导出 → 导出账本
② 选择账本、日期范围
③ 点"开始导出"
④ POST /v1/export-jobs → HTTP 202 { job_id }
⑤ 页面立即显示任务卡："正在后台生成 · 可以离开此页面"
⑥ 服务端按账本拉取全部成员流水 → 生成 CSV → 任务 succeeded
⑦ 用户回到页面，任务卡切换为完成态
⑧ 点"发送到微信" → wx.downloadFile → wx.shareFileMessage
⑨ 用户选择文件传输助手、联系人或群聊
```

### 6.2 导出 API

```yaml
paths:
  /export-jobs:
    post:
      summary: 创建账本 CSV 导出任务
      security: [{ bearerAuth: [] }]
      requestBody:
        content:
          application/json:
            schema:
              type: object
              required: [ledger_id]
              properties:
                ledger_id: { type: string, format: uuid }
                # from/to 均可选：省略表示"全部"（§8.4 的默认选项）
                # 只给 from = 从该日至今；只给 to = 开天辟地至该日
                from: { type: string, format: date, nullable: true }
                to:   { type: string, format: date, nullable: true }
      responses:
        '202':
          description: 导出任务已创建
        '409':
          description: code=EXPORT_JOB_IN_PROGRESS · 该用户已有导出任务在执行
```

> **`from`/`to` 为什么改为可选**（v0.8 修正 · P1）：v0.7 声明 `required: [ledger_id, from, to]`，而 §8.4 步骤 3 的日期范围**默认就是「全部」**，两者直接冲突且"全部"该传什么值未定义（省略？空串？`1970-01-01`？）。改为可选，服务端 null 即不加对应日期谓词。
> 配套：§2.2 的文件名规则强制含日期范围，"全部"时用**实际数据的首末 `occurred_at`** 填充（空账本导出用当天日期），保证文件名始终自解释。

任务完成结果（**v0.8 改为分片数组**，见 §9.2）：

```json
{
  "job_id": "019...",
  "status": "succeeded",
  "result": {
    "entry_count": 6280,
    "part_count": 2,
    "files": [
      {
        "part": 1,
        "file_name": "Costra_我的家庭_2026-01-01至2026-07-21_20260721T173900_1of2.csv",
        "file_size": 248830,
        "sha256": "...",
        "download_path": "/data-jobs/019.../download?part=1"
      },
      {
        "part": 2,
        "file_name": "Costra_我的家庭_2026-01-01至2026-07-21_20260721T173900_2of2.csv",
        "file_size": 63120,
        "sha256": "...",
        "download_path": "/data-jobs/019.../download?part=2"
      }
    ],
    "file_expires_at": "2026-08-06T16:00:00+08:00"
  }
}
```

- `download_path` 是**相对路径**（理由同 §4.2：绝对 URL 会把 staging 客户端指向生产域）。
- `part_count = 1` 时 `files` 仍是长度 1 的数组，客户端不做单/多两套分支。
- 单文件命名不带 `_1of1` 后缀（保持 §2.2 原格式）；仅 `part_count > 1` 时追加 `_NofM`。

### 6.3 下载与转发

> ⚠️ **`wx.downloadFile` / `wx.uploadFile` 绕过 `request.ts` 拦截器**（v0.8 新增 · P1）。这两个 API 不走项目统一的请求层，因此**拿不到**任何既有能力：`TOKEN_EXPIRED → refresh-once` 自动重试、`code` 解析与错误映射、统一 header 注入、PATCH 降级。
>
> 这不是理论风险：一次导出可能耗时数分钟，用户放下手机、回来再点"发送到微信"时 access token 大概率已过期 → 401 → v0.7 示例代码只会 `throw new Error('下载失败')`，且**重试仍然失败**（token 永远不会被刷新），用户只能杀小程序重进。上传侧同理。
>
> **要求**：新增一个上传/下载专用的鉴权封装（E5 显式子项），职责三条：
> 1. 发起前 `ensureFreshToken()` —— 复用 `request.ts` 既有的 token 有效性判定，必要时先刷新；
> 2. `statusCode === 401` 时**手动**触发一次 refresh 并重放一次（对齐 `refresh-once` 语义，不做无限重试）；
> 3. 把 `statusCode` + 响应体解析为 `ErrorCode`，交给既有 error-mapper 出文案；`errMsg` 里的网络类失败（`request:fail`）单独归为可重试网络错误。

```ts
// 经封装后的调用形态（示意 · 具体签名见 E5 实现）
const local = await downloadWithAuth({
  path: file.download_path,           // 相对路径，内部拼 env.baseURL
});                                    // 内部已处理 ensureFreshToken / 401 重放 / code 映射

await wx.shareFileMessage({
  filePath: local.tempFilePath,
  fileName: file.file_name,
});
```

- 多分片（`part_count > 1`）时**逐个下载、逐个 `shareFileMessage`**，每次转发之间给用户明确提示（`第 1 / 2 个文件已发送`）；不做打包 zip（微信侧 zip 的可用性未验证，且 §1 首要场景是"在 Excel 打开"，zip 反而多一步解压）。
- 转发前用 `getFileInfo` 校验 SHA-256 与 `files[].sha256` 一致，不一致提示重新下载。

按钮的状态文案：

| 状态 | 主按钮 | 辅助文案 |
|---|---|---|
| queued / processing | `后台生成中`（禁用） | `可以离开此页面，稍后回来查看` |
| succeeded · 未下载 | `发送到微信` | `共 1,280 条 · 243 KB · 文件保留 24 小时`（分片时：`共 6,280 条 · 2 个文件 · 保留 24 小时`）|
| downloading | `正在准备文件 42%`（禁用） | `下载完成后将打开微信转发面板` |
| download failed | `重新准备文件` | `网络异常，后台文件不会丢失` |
| 文件已过期（派生态）| `重新生成` | `文件已过期，原任务记录仍保留` |

> 最后一行不是 job status。job 仍为 `succeeded`，客户端按 `file_expires_at < now()` 派生此展示态（§7.3 已从 `data_job_status` 删除 `expired`）。

### 6.4 分享文案与图片设计

`wx.shareFileMessage` 不提供文案和封面参数，因此聊天中采用原生文件消息：

- **文件名**：`Costra_我的家庭_2026-01-01至2026-07-21_20260721T173900.csv`
- **系统副信息**：微信自动展示文件类型与大小
- **不额外发送第二条文字或图片**：避免一次导出产生多条聊天消息

#### 小程序内分享前完成卡

```text
┌──────────────────────────────────┐
│  [CSV 文件折角图标]              │
│                                  │
│  我的家庭 · 账本数据             │
│  2026-01-01 — 2026-07-21         │
│                                  │
│  1,280 条记录        243 KB       │
│                                  │
│  已准备好，可发送到微信           │
│  [          发送到微信          ] │
└──────────────────────────────────┘
```

视觉规格：
- 白色 Inset Grouped 卡片 · `24rpx` 圆角 · 无阴影
- 左上使用**线性 CSV 文件图标**：纸张折角 + 三条表格线，不用实心剪影
- 图标主线 `#8AA98F` 苔绿；文件角标小字 `CSV` 用 `#A88A5E` 砂棕
- 标题 `30rpx / 600 / #1c1b1a`；日期与文件信息 `24rpx / rgba(28,27,26,.48)`
- 主按钮苔绿 `#8AA98F`，文案 `发送到微信`

页面文案：
- 生成完成标题：`账本文件已准备好`
- 说明：`发送到微信聊天或文件传输助手，即可在手机或电脑上获取 CSV。`
- 转发前 loading：`正在准备文件…`
- 调起成功：`请选择接收文件的聊天`
- 用户取消：不报错，任务保持完成态，可再次点击

---

## 7. 统一任务模型 · 持久化 · 进度 · 文件存储

> 本节回答四个核心工程问题：任务能否退出后再回来看、进度百分比怎么算、任务是否落 PG 表、上传/下载文件存在哪里及过期策略。

### 7.0 现状约束（决定架构选型）

调研 `server/` 现状后的关键事实：

| 事实 | 影响 |
|---|---|
| Redis 只做缓存 / 会话 / 限流，**没有队列**（无 BullMQ / Streams）| 不引入新队列基础设施；用 **PG 表当队列** |
| 生产**单实例**（single container，无 replicas）| worker 直接进程内跑；但沿用 advisory lock 为未来多实例预留 |
| 已有成熟范式：`recurringScheduler.ts` = `setInterval(60s) + pg_try_advisory_lock + FOR UPDATE SKIP LOCKED` | 导入/导出 worker **直接复用这套骨架** |
| 文件落盘范式：`upload.ts` 写 `/data/uploads`，nginx `/uploads/` 只读静态服务 | 导出文件复用同一 bind mount 通道 |
| 清理范式：宿主机 cron `maintenance.sh` 的 `purge-*` 子命令 + `docker exec psql DELETE` | 过期文件 / 任务清理**新增一个 purge 子命令**，不做进程内定时删除 |

**结论**：整套异步任务不需要引入任何新中间件，完全复用项目已验证的"PG 表 + 进程内轮询 worker + 宿主机 cron 清理"三件套。

---

### 7.1 问题一：任务能否退出界面、下次回来查看与下载

**能。这正是"任务落 PG 表 + 客户端无状态轮询"的设计目的。**

任务的唯一事实源是数据库表 `data_jobs`（见 §7.3），不是客户端内存，也不是某个 WebSocket 长连接。因此：

- 用户创建任务后拿到 `job_id`，服务端 worker 独立推进，**与客户端是否在线完全无关**。
- 用户退出页面 / 切后台 / 杀小程序 / 关手机，服务端任务照常执行。
- 用户下次任意时刻回到「设置 → 账本导入 / 导出」，页面 `onShow` 调 `GET /v1/data-jobs?limit=20` 拉取最近任务，按 `status` 恢复展示：
  - 仍在跑 → 显示进度条
  - 已完成的导出 → 显示 `发送到微信`（只要文件未过期）
  - 已完成的导入 → 显示 `已导入 N 条 · M 条跳过`
  - 导出成功但文件已过期（`file_expires_at < now()`）→ 显示 `重新生成`
- **下载不依赖创建任务时的那次会话**：`files[].download_path` 指向 `GET /v1/data-jobs/{id}/download?part=N`，只要用户带合法 JWT 且是 job 属主、且文件未过期，任何时候都能下载并转发（走 §6.3 的鉴权封装，token 过期会自动刷新）。

客户端本地只缓存 `unseenCompletedJobIds`（用于设置入口的小绿点），**从不把本地状态当事实源**，一切以服务端返回为准。

---

### 7.2 问题二：进度如何显示（阶段型模拟进度）

**不承诺"真实百分比"。** v0.4 曾设计"进度 = `progress_current / progress_total` 批级真实百分比"，但它与 §7.5"导入用单个大事务保证原子"存在内在矛盾：大事务内对 `progress_current` 的写入在 COMMIT 前对其它连接不可见，客户端轮询会一直看到初值、直到提交瞬间跳到 100%——反而是最糟的假进度。

v0.5 决策：**保留导入单大事务（原子性优先）**，进度改为**客户端基于服务端 `stage` 的阶段型渐近模拟**。

#### 服务端只维护阶段，不维护条数

`data_jobs` **删除** `progress_current / progress_total`，改为：
- `stage`：当前阶段（见下表）
- `stage_started_at`：进入该阶段的时刻

worker 在跨阶段边界时更新这两个字段（阶段切换是稀疏事件，不在大事务热路径上频繁写库）。

#### 客户端渐近模拟

客户端按 `stage` 映射一个进度区间 `[floor, cap]`，用进入阶段后的经过时间做渐近逼近，**永不自行到 100%**，只有服务端返回 `succeeded` 才跳 100%：

```text
elapsed = server_now - stage_started_at        # 见下方"时钟基准"
p = floor + (cap - floor) * (1 - e^(-elapsed / τ))
```

> **时钟基准必须用服务端时间**（v0.6 修正）：`stage_started_at` 是服务端时刻，若客户端用本机 `Date.now()` 相减，遇到用户改系统时间 / 时钟漂移会算出**负数或极大值**，进度条直接跳变或瞬间打满。故任务查询响应必须附带 `server_now`，客户端计算 `elapsed = server_now - stage_started_at`，并在本地轮询间隔内用单调递增的相对时间推进（不再读系统时钟绝对值）。

> **τ 取值**：不用固定 8s。按阶段分别设定，且**以该阶段的典型耗时为量级**（导入 `writing` 在 5,000 行上限下典型 3~10s，取 τ=6s；导出 `querying` 取 τ=8s）。τ 过小会让进度在阶段实际耗时的前 1/3 就贴住 cap 然后长时间静止，用户观感等同卡死。上限 5,000 行使各阶段耗时可预期，这是 §9.1 降低规模上限的附带收益。

> **τ 的前提是 worker 能被及时观测到**（v0.8 补充 · P1）：上表把 `queued` 定为**恒 0%、无 τ**。这个设计只在"排队时间远短于执行时间"时成立。而 §7.5 的 worker 是 `advisory lock + LIMIT 1` 的**全局串行**模型，若再沿用 `recurringScheduler` 的 60s 轮询间隔，用户点完"确认导入"最长要盯着一个**纹丝不动的 0% 进度条 60 秒**，然后才开始 3~10s 的真实工作 —— 模拟进度做得再平滑也救不回来。
> 故 §7.5 明确了两件事：poll 间隔取 **2s**，且 commit / 创建导出任务的事务提交后**立即事件触发**一次 worker。`queued` 的期望停留时间因此被压到"前面排队任务的执行时长"，通常为 0。若未来观测到排队常态化，再给 `queued` 补 τ（区间 0% → 5%），而不是先做一个假动画掩盖排队。

| `stage` | 进度区间 | 展示文案 |
|---|---:|---|
| `queued` | 0% | `等待处理` |
| `validating` | 5% → 20% | `正在校验导入环境`（导入）|
| `writing` | 20% → 90% | `正在导入流水`（导入）|
| `querying` | 20% → 90% | `正在整理数据`（导出）|
| `packaging` | 90% → 98% | `正在生成 CSV 文件…`（导出）|
| `succeeded` | 100%（立即） | `已完成` |
| `failed` | 不显示百分比 | `处理失败 · 查看原因` |

#### 明确禁止的文案

- ❌ `正在写入第 794 / 1,268 条`（会暴露不存在的真实条数进度）
- ❌ "真实百分比" / "近似等于真实进度"

客户端展示改为**进度条 + 阶段文案**：

```text
导入中
[███████████░░░░░░░]
正在导入流水…
```

**结论**：以牺牲"真实条数百分比"换取导入的事务原子性；阶段型模拟进度对用户是平滑、可解释的，且不会出现"进度走完但任务没完"的假象（因为只有服务端 `succeeded` 才 100%）。

---

### 7.3 问题三：任务是否对应一张 PostgreSQL 表

**是。新增一张统一任务表 `data_jobs`（迁移编号接 `0020_data_jobs.sql`；`0019` 已被 `ledgers.sync_epoch` 占用），导入和导出共用。同一迁移还包含 §5.2 的 `ledgers.sync_epoch_floor_seq` 增列。**

采用与 `recurring_rules` 一致的"状态字段自持久化"范式。

```sql
-- 0020_data_jobs.sql（草案 · v0.8）
--
-- ⚠️ 建表顺序：import_detect_sessions 必须先建（data_jobs.detect_id 引用它）。
--    v0.5 草案把 data_jobs 放前面并引用后面才创建的表，DDL 直接报错。
--    两表不做互相 FK：sessions.job_id 只作普通列（避免循环依赖 + 插入顺序死锁）。
--
-- 本迁移包含三部分：
--    A) ledgers.sync_epoch_floor_seq 增列（§5.2 · 定点重拉）
--    B) import_detect_sessions
--    C) data_jobs

-- ─────────────────────────────────────────────────────────────────────
-- A) §5.2：批量写入号段下界（与 sync_epoch 配套 · 同事务更新）
-- ─────────────────────────────────────────────────────────────────────
ALTER TABLE ledgers
  ADD COLUMN IF NOT EXISTS sync_epoch_floor_seq BIGINT NOT NULL DEFAULT 0;

DO $$ BEGIN
  CREATE TYPE data_job_type AS ENUM ('import', 'export');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- v0.6：删除 'expired'。文件过期是 file_expires_at < now() 的【派生态】，
-- 不是 job 状态；没有任何代码路径会把 job 置为 expired（原设计无写入方）。
DO $$ BEGIN
  CREATE TYPE data_job_status AS ENUM ('queued', 'processing', 'succeeded', 'failed');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE data_job_stage AS ENUM ('queued', 'validating', 'writing', 'querying', 'packaging');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE import_detect_status AS ENUM ('detecting', 'ready', 'consumed', 'failed');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ─────────────────────────────────────────────────────────────────────
-- B) 检测会话表：元数据落 PG（规范化行数据落私有磁盘，见 §7.4）
-- ─────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS import_detect_sessions (
    id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id          UUID NOT NULL REFERENCES users(id),
    ledger_id        UUID NOT NULL REFERENCES ledgers(id) ON DELETE CASCADE,
    status           import_detect_status NOT NULL DEFAULT 'detecting',

    -- 上传摘要
    file_name        TEXT,
    file_size        BIGINT,
    file_sha256      TEXT,
    is_costra_export BOOLEAN NOT NULL DEFAULT false,          -- 9 列表头指纹判定（§2.1.1）
    formula_guard    TEXT,                                    -- apostrophe-v2 / none

    -- 规范化行产物（server-only 私有磁盘，见 §7.4）
    artifact_path    TEXT,
    artifact_sha256  TEXT,
    report_path      TEXT,                                    -- 完整问题报告 CSV

    -- 汇总 + 预览（完整问题报告另落磁盘，见 §4.2 / §7.4）
    total_rows       INTEGER NOT NULL DEFAULT 0,
    importable_rows  INTEGER NOT NULL DEFAULT 0,
    error_count      INTEGER NOT NULL DEFAULT 0,
    warning_count    INTEGER NOT NULL DEFAULT 0,
    report_preview   JSONB,                                   -- errors/warnings 各前 100 条

    -- 生命周期
    job_id           UUID,                                    -- 确认后关联的导入任务（不设 FK · 见文件头说明）
    created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
    expires_at       TIMESTAMPTZ NOT NULL,                    -- ready 后 15 分钟（行产物有效期）
    -- v0.8：报告文件与导出文件同寿 24h，独立于 expires_at（§7.4 生命周期冲突修复）
    report_expires_at TIMESTAMPTZ,
    consumed_at      TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_detect_sessions_user
  ON import_detect_sessions (user_id, created_at DESC);

-- §4.2 detect 幂等：同 (user, ledger, sha256) 的 ready 会话可复用
CREATE INDEX IF NOT EXISTS idx_detect_sessions_dedup
  ON import_detect_sessions (user_id, ledger_id, file_sha256);

-- §4.4 检测并发：同一用户同时只允许 1 个 detecting 会话
CREATE UNIQUE INDEX IF NOT EXISTS uq_detect_sessions_active_per_user
  ON import_detect_sessions (user_id)
  WHERE status = 'detecting';

-- ─────────────────────────────────────────────────────────────────────
-- C) 统一任务表（导入 / 导出共用）
-- ─────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS data_jobs (
    id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    type             data_job_type   NOT NULL,
    status           data_job_status NOT NULL DEFAULT 'queued',

    -- 归属
    user_id          UUID NOT NULL REFERENCES users(id),      -- 创建者
    ledger_id        UUID NOT NULL REFERENCES ledgers(id) ON DELETE CASCADE,

    -- 阶段（不存条数进度，只存阶段 + 阶段进入时刻，客户端据此做渐近模拟 §7.2）
    stage            data_job_stage,
    stage_started_at TIMESTAMPTZ,

    -- 导入入参（检测→确认两阶段）
    -- UNIQUE：保证一个检测会话最多产生一个导入任务（§7.4 commit 原子消费依赖此约束）
    detect_id        UUID UNIQUE REFERENCES import_detect_sessions(id),
    -- 导出入参（v0.8：均可空 · NULL 表示"全部"，§6.2）
    date_from        DATE,
    date_to          DATE,

    -- 结果摘要（JSONB：imported/skipped/error_count/warning_count/entry_count 等）
    result_summary   JSONB,

    -- 产物文件（v0.8：导出支持分片 → 由 4 个单文件列改为 JSONB 数组，§9.2）
    -- 元素结构：{ part, path, file_name, file_size, sha256 }
    files            JSONB,
    file_expires_at  TIMESTAMPTZ,                             -- 所有分片同寿（见 §7.4）

    -- 失败信息（error_code 取值见 §9.5）
    error_code       TEXT,
    error_message    TEXT,
    retryable        BOOLEAN NOT NULL DEFAULT false,          -- 仅瞬态错误可重试（§7.5）

    -- worker 抢占与生命周期（run_token/lease 防旧 worker 覆盖新结果）
    attempts         INTEGER NOT NULL DEFAULT 0,
    run_token        UUID,                                    -- 本次执行令牌 · 终态条件更新须匹配
    lease_expires_at TIMESTAMPTZ,                             -- 租约到期 · 超时才允许被复位
    next_attempt_at  TIMESTAMPTZ,                             -- 可重试任务的下次可抢占时刻（退避）
    created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
    started_at       TIMESTAMPTZ,
    finished_at      TIMESTAMPTZ,

    version          INTEGER NOT NULL DEFAULT 1,

    -- v0.8：type 与入参字段的一致性（原本全可空且无约束，靠代码自觉）
    CONSTRAINT chk_data_jobs_type_fields CHECK (
      (type = 'import' AND detect_id IS NOT NULL
                       AND date_from IS NULL AND date_to IS NULL)
      OR
      (type = 'export' AND detect_id IS NULL)
    ),
    -- v0.8：stage 必须属于该 type 的合法阶段集（§7.2 表）
    CONSTRAINT chk_data_jobs_stage_scope CHECK (
      stage IS NULL
      OR (type = 'import' AND stage IN ('queued', 'validating', 'writing'))
      OR (type = 'export' AND stage IN ('queued', 'querying', 'packaging'))
    ),
    -- v0.8：日期范围顺序
    CONSTRAINT chk_data_jobs_date_range CHECK (
      date_from IS NULL OR date_to IS NULL OR date_from <= date_to
    )
);

-- worker 拉取待处理任务（配合 FOR UPDATE SKIP LOCKED）
CREATE INDEX IF NOT EXISTS idx_data_jobs_pick
  ON data_jobs (status, created_at)
  WHERE status IN ('queued', 'processing');

-- 用户查询最近任务
CREATE INDEX IF NOT EXISTS idx_data_jobs_user_recent
  ON data_jobs (user_id, created_at DESC);

-- §4.4 并发约束：同一账本同时只允许一个 import 任务在执行
CREATE UNIQUE INDEX IF NOT EXISTS uq_data_jobs_active_import_per_ledger
  ON data_jobs (ledger_id)
  WHERE type = 'import' AND status IN ('queued', 'processing');

-- 导出并发也用 DB 约束兜底（只在应用层 check 有竞态）
-- 同一用户同时只允许一个 export 任务在执行
CREATE UNIQUE INDEX IF NOT EXISTS uq_data_jobs_active_export_per_user
  ON data_jobs (user_id)
  WHERE type = 'export' AND status IN ('queued', 'processing');

-- 过期清理走全表 DELETE，不加会拖慢的谓词索引（参照 idempotency_keys 的处理）
```

> **为什么补这三条 CHECK**（v0.8 · P1）：v0.7 的 `detect_id` / `date_from` / `date_to` 全部可空且无任何约束，"import 必须有 detect_id""export 不该有 detect_id""import 不该出现 `querying` 阶段"三条语义完全靠代码自觉。本项目的既定口径是**不靠约定守不变量**（同 §7.5 的 `sync_epoch` 铁律讨论），能下沉到 DB 的约束就不要留在文档里。三条 CHECK 的写入成本为零，却能让任何越界写入在开发期就炸出来。

> **DB migration 双写约定**：`0020_data_jobs.sql` 落地时必须同步在 `server/test/setup.ts` 内嵌 DDL 里对齐**三部分**（`ledgers.sync_epoch_floor_seq` + 两张表 + 索引）。pg-mem 不支持的 partial unique index（`WHERE ... status IN (...)` / `WHERE status='detecting'`）在测试环境跳过 —— 由此产生的验证缺口见下方"真实 PG 测试通道"。

> **真实 PG 测试通道（v0.8 新增 · 必须先决策，不能悬空）**：v0.7 写下"并发约束的行为测试必须放到真实 PG 的集成测试"，但**仓库当前没有这条通道** —— `npm test` 是 vitest + pg-mem，`server/test/setup.ts` 用内嵌 DDL 起 pg-mem。这与 v0.6 修掉的"§9.4 审计无载体"是同一类问题：**提了要求却没有载体 = 等于没落地**，只会在验收时被当成"已覆盖"。
> 二选一，必须在动工前定：
> - **A（推荐）**：新增 docker-compose 起真 PG 的集成测试 profile（`vitest --project integration`），只跑约束/并发/事务这类 pg-mem 覆盖不到的用例。**计入工作量 E2 +2 人天**，长期收益是 `FOR UPDATE`、partial unique、advisory lock、锁顺序这些本方案重度依赖的语义终于有了自动化验证。
> - **B**：明确承认"三处 partial unique 与 commit 行锁**无自动化验证**，仅靠 code review + 生产观测"，并把这条写进 §11 风险清单（作为已接受风险），不再声称"必须放到集成测试"。
> 不允许保留 v0.7 那种"要求存在、载体不存在"的中间状态。

> **ID 生成一致性**：业务 repo 统一走 `newId()`（UUID v7，见 `server/src/id/idGen.ts`）。`data_jobs` / `import_detect_sessions` 的 `DEFAULT gen_random_uuid()` 仅作 DB 兜底；应用层 INSERT 应显式传 v7 id，与 entries 一致，避免 v4/v7 混用。

> **`stage` 用 ENUM 而非 TEXT**（v0.6）：同表 `type` / `status` 都是 ENUM，`stage` 用裸 TEXT 会让"客户端按 stage 映射进度区间"这个契约失去 DB 层校验，拼错值只会静默退化成无进度。新增 `data_job_stage` ENUM 与 §7.2 的表一一对应。

**检测会话为什么建表 + 落盘（而非存 Redis）**：
- 生产 Redis 512MB + `allkeys-lru` + AOF everysec。CSV 展开成结构化 JSON 体积可达原文数倍，放进单个 Redis key 会：挤掉缓存/会话、产生大 key 延迟、把完整账单写进 AOF、Redis 故障时让已完成的检测报告凭空消失。
- 故：**检测元数据落 PG `import_detect_sessions`，规范化行数据落 server-only 私有磁盘（压缩 NDJSON），Redis 不参与**（见 §7.4）。

---

### 7.4 问题四：上传/下载文件存哪里，过期策略

分三类文件，存储位置和 TTL 各不相同：

| 文件 | 存哪里 | 保留时长 | 清理方式 |
|---|---|---|---|
| **用户上传的原始 CSV（导入源）** | **全程不落盘**（multipart 流直接进 parser） | 单次请求内，秒级 | 请求结束即释放 |
| **导入检测元数据** | PG `import_detect_sessions` | 行产物 15 分钟；报告字段 24h（见下） | 定时清理 + cron 兜底 |
| **导入规范化行产物** | **server-only** `/data/import-staging/<yyyy-mm>/<detect_id>.rows.ndjson.gz` | 同检测会话；任务终态后删 | 应用清理 + `purge-import-staging` cron |
| **导入问题报告 CSV** | **server-only** `/data/import-staging/<yyyy-mm>/<detect_id>.report.csv` | **24 小时**（与导出文件同寿，见下）| `purge-import-staging` cron |
| **导出 CSV（含分片）** | 服务器本地 `/data/exports/<yyyy-mm>/<job_id>_<part>.csv` | **24 小时** | `purge-exports` cron |

> **"全程不落盘"而非"解析完即删"**（v0.8 表述修正 · P2）：v0.7 写"流式解析完**即删**原始 CSV"，会让实现者以为存在一个落盘路径、需要写一步删除。实际上 `@fastify/multipart` 的流被直接管进 CSV parser，原始字节从不写入磁盘 —— 没有可删的东西。表述改为"全程不落盘"，避免后人凭空实现一个删除步骤（并因为找不到文件而写出兜底分支）。

> 检测行数据不进 Redis：生产 Redis 512MB + `allkeys-lru` + AOF everysec，把完整账单塞进单 key 会挤掉缓存/会话、产生大 key 延迟、写进 AOF、故障时让已完成检测报告消失。故落 **server-only 私有磁盘**，Redis 不参与。

> **问题报告的生命周期必须独立于会话行**（v0.8 修正 · P1）：v0.7 一边规定"report 保留 24h，导入成功后仍可查 warning 明细"，一边在生命周期里规定"已 `consumed` 的会话**直到关联任务终态**（即清理）"。导入成功 = 任务终态 → 会话行被清 → `/import-detect-sessions/{id}/report` 直接 404，两条规则互相拆台。
>
> v0.8 的解法：**会话行本身保留 24h，只删行产物**。
> - 新增 `report_expires_at`（= ready 时刻 + 24h），与 `expires_at`（行产物 / commit 有效期 15 分钟）**解耦**；
> - 任务终态时删 `.rows.ndjson.gz`，但**保留会话行与 report 文件**至 `report_expires_at`；
> - 端点仍是 `/import-detect-sessions/{detect_id}/report`，**不迁到 `data_jobs`** —— 因为 report 在 detect 阶段就要能下载（此时 job 还不存在），迁走会导致检测报告页拿不到下载入口。客户端从任务卡上的 `detect_id`（§7.6 已下发）即可拼出 URL。
> - `commit` 的 410 判定只看 `expires_at`，与 `report_expires_at` 无关。

#### 检测阶段：流式解析 → 规范化行落私有磁盘

> 前置步骤（收流 + sha256 + 幂等查询）见 §4.2 的 v0.8 顺序；本节从"确定要解析"之后开始。

1. 创建 `detecting` 会话（PG 插一行；`uq_detect_sessions_active_per_user` 保证同用户单并发，§4.4）。
2. 已收取的 CSV 字节**直接进标准 CSV parser**（须支持 RFC 4180 quoted multiline，见 §2.1；不复用现有手写逐物理行 parser）。
3. 预加载目标家庭活跃成员映射（nickname→user_id）与**按 type 分组的**分类映射（§3.7），避免逐行查库。
4. 流式解析、校验、规范化每一行；合法记录写入 `.tmp` 压缩 NDJSON 产物，字段含：`row_no / entry_id(v7,预生成) / client_ref_id / occurred_at / amount_cents / type / category_id / created_by / shared_type / note`。
5. 完整问题（错误 + warning）写另一份报告文件；响应只回汇总 + 各前 100 条（§4.2）。
6. 完成后算产物 SHA-256，**原子 rename** `.tmp → 正式名`，会话置 `ready`、写汇总与 `report_preview`、写 `expires_at`（+15min）与 `report_expires_at`（+24h）。
7. 释放收流缓冲（原始字节从不落盘，见上）。

> **关键收益**：commit 直接读规范化产物入库，**不再重做昵称/分类/金额模糊匹配**——"用户看到的检测结果"与"实际写入内容"逐字段一致。但注意这**不能替代 commit 前的有效性复核**（§7.5）：产物固化的是"匹配结果"，而被引用的成员/分类可能在这 15 分钟内失效。

#### 私有目录安全要求（不同于头像目录）

```text
/data/import-staging/            # 新增 bind mount · 仅挂给 server · 绝不挂 nginx
  2026-08/
    <detect_id>.rows.ndjson.gz
    <detect_id>.report.csv
```

- server 读写挂载：`/data/import-staging:/var/costra/import-staging`（**nginx 无此挂载**）。
- 目录 `0700`、文件 `0600`、owner UID 1000（node 用户）。
- 文件名只用服务端生成的 `detect_id`，杜绝路径穿越/猜测。
- **不进入备份**；日志**不得记录行内容**。

#### 导出文件目录设计

```text
/data/exports/                          # 新增 bind mount（与 /data/uploads 平级 · 但不挂 nginx）
  2026-08/
    <job_id>_1.csv                      # 单文件时 part 恒为 1
    <job_id>_2.csv                      # 分片（§9.2）
```

- server 读写挂载：`/data/exports:/var/costra/exports`
- **nginx 不挂载、不静态服务导出/暂存目录**（含全量账本数据必须鉴权）。

> **两个新 bind mount 是有成本的基建改动**（v0.8 补充 · P2 · 原工作量表只计了 nginx 一行）：`/data/exports` 与 `/data/import-staging` 需要同步改动 `infra/docker-compose.prod.yml` 与 `.staging`（server 服务加两个 volume，**确认 nginx 不加**）、`infra/scripts/05-start-stack.sh`（宿主机目录创建 + `0700` + chown UID 1000）、以及 `maintenance.sh` 的两个 purge 子命令。这些已计入 v0.8 的 E3。

下载走应用层 `GET /v1/data-jobs/{id}/download?part=N`：

1. 校验 JWT + `job.user_id == 当前用户`；
2. 校验 `file_expires_at > now()`，否则 `410 EXPORT_FILE_EXPIRED`；
3. 校验 `part` 在 `files[]` 范围内，否则 `404 NOT_FOUND`；
4. 命中则**由应用直接流式返回**（`createReadStream` → reply.send），带 `Content-Disposition`（文件名按 §9.2 做控制字符防护）。

> **不使用 `X-Accel-Redirect`**（v0.6 修正 · 消除自相矛盾）：v0.5 一边写"nginx 无此挂载"，一边写"命中则 X-Accel-Redirect 交 nginx internal location 回源" —— 两者互斥，X-Accel-Redirect 要求 nginx 能读到该文件。生产 compose 中 nginx 只挂了 `/data/uploads:ro`，本就没有导出目录。且导出文件受上限约束、体积小，Node 流式返回的代价可忽略，不值得为此给 nginx 增加一个含全量账本数据的挂载点（挂载即扩大攻击面）。**明确选择应用层流式返回。**

#### commit 阶段：原子消费检测会话

`POST /import-jobs/commit`（详见 §4.3）在一个事务内：
1. `SELECT ... FOR UPDATE` 锁定 `import_detect_sessions` 行；
2. 校验属主、账本权限、`status='ready'`、`expires_at > now()`；
3. 若 `status='consumed'` 且已有 `job_id` → **幂等返回原 `job_id`**（防连点/超时重发建双任务）；
4. 同事务 `INSERT data_jobs`（`detect_id` 的 **UNIQUE 约束**保证一对一，§7.3）；
5. 会话置 `consumed`、写 `job_id`；
6. 提交。

#### 生命周期与清理

- `ready` 未确认：15 分钟过期（`expires_at`）→ commit 返回 `410 DETECT_SESSION_EXPIRED`。
- 已 `consumed`：即使超 15 分钟也**不清理**，直到关联任务终态。
- 僵死 `detecting`（进程异常退出遗留）：按 `created_at` 超时（如 10 分钟）回收，释放 §4.4 的并发槽。
- 导入成功：提交完成后删除规范化行产物（隐私最小化）；**会话行与问题报告保留至 `report_expires_at`（24h）**。
- 可重试失败：保留行产物到重试结束；最终失败：删行产物，仅留任务结果摘要与问题报告（同样 24h）。
- 应用侧每分钟清理过期 `ready` / 僵死 `detecting` 会话及其孤儿产物；启动时补偿清理一次。
- **会话行的最终删除条件**：`report_expires_at < now()` **且**（无关联 job 或关联 job 已终态）。两者缺一都不能删 —— 前者会打断 24h 报告承诺，后者会让运行中的 job 丢失 `detect_id` 引用。
- 宿主机 cron `maintenance.sh purge-import-staging` / `purge-exports` 作为孤儿兜底（参照 `purge-idempotency`，建议每日 04:37）。
- **任务元数据保留 30 天**：文件过期后行仍在（`file_expires_at < now()`），客户端展示"文件已过期，可重新生成"。

#### 过期后的用户体验

- 导出文件过期：任务卡显示 `文件已过期` + `重新生成`，复用原 `ledger_id/date_from/date_to` 一键重建。**注意 job 状态仍是 `succeeded`**，"已过期"是客户端按 `file_expires_at < now()` 派生的展示态（§7.3 已删除 `expired` 状态值）。
- 检测报告过期（15 分钟）：commit 返回 `410`，提示 `检测已过期，请重新选择文件`。

---

### 7.5 worker 执行模型（复用 recurringScheduler 骨架 + 原子提交 / 幂等重试）

```text
setInterval(POLL_INTERVAL_MS = 2000) 或 事件触发（commit / 创建导出后立即 kick 一次）
  → pg_try_advisory_lock(DATA_JOB_LOCK_KEY)   # 多实例互斥（本期单实例仍加，为未来准备）
  → SELECT ... FROM data_jobs
     WHERE status = 'queued'
       AND (next_attempt_at IS NULL OR next_attempt_at <= now())
     ORDER BY created_at
     FOR UPDATE SKIP LOCKED LIMIT 1
  → run_token = gen v7；UPDATE status='processing', started_at=now(),
       attempts=attempts+1, run_token=$tok, lease_expires_at=now()+lease
  → 执行（导出/导入）
  → 终态用【条件更新】写回（见下）
  → releaseLock
```

#### 并发模型与轮询间隔（v0.8 明确 · P1）

> v0.7 在两处给出了互斥的说法：§7.5 的骨架是 `advisory lock + LIMIT 1`（**全局串行**），§9.2 却写"导出并发受 per-user 唯一索引约束，**若后续观测到 CPU 压力再收紧为全局单并发**"—— 按骨架它本来就已经是全局单并发了。同时**轮询间隔从未定义**，若照抄 `recurringScheduler` 的 60s，会与 §7.2 的进度设计正面冲突（见该节说明）。

v0.8 冻结：

| 项 | 取值 | 理由 |
|---|---|---|
| 并发度 | **全局串行**（advisory lock + `LIMIT 1`） | 生产 2 核 4G 单进程，CSV 解析/序列化是 CPU 密集，并行只会互相拖慢并抬高在线 API 的 P99。§9.2 中"再收紧为全局单并发"的表述作废 |
| `POLL_INTERVAL_MS` | **2000ms** | 与 `recurringScheduler` 的 60s 分开取值：定时记账是"到点执行"，本任务是"用户在盯着进度条"。2s 的空转成本是一条走索引的 `SELECT ... LIMIT 1`，可忽略 |
| 事件触发 | commit 事务提交后、创建导出任务后各 **kick 一次** worker | 把 `queued` 的期望停留压到 0；轮询退化为"崩溃/漏触发"的兜底 |
| 任务选取 | 单队列 `ORDER BY created_at`，**import / export 不分队列** | 两者都受 5,000 行上限约束（导出经 §9.2 分片后每片同样有界），单个任务时长可预期，不存在"长任务饿死短任务"。若后续观测到排队，再拆队列而不是先加复杂度 |
| per-user / per-ledger 唯一索引 | 保留 | 它们约束的是"用户能同时创建几个任务"（防连点、防刷），与 worker 的执行并发度是两件事，两者都需要 |

`timerHandle.unref()` + `onClose` 里 `stop()`，与 recurringScheduler 一致，保证 SIGTERM 快速关停。

#### 导入必须"数据 + 成功状态"同一事务提交（核心）

导入任务的以下操作必须在**同一个 PostgreSQL 事务**内完成，且**顺序有讲究**：

1. **复核 detect 上下文有效性**（v0.6 新增 · 见下方"为什么 FK 兜底不成立"）；
2. 从规范化产物批量 `INSERT entries`（带预生成 `entry_id` + `client_ref_id`，走 `entries` 现有列语义）；
3. 正确生成 `change_seq`（`nextval('entries_change_seq')`，与 entryRepo 同源）；
4. 汇总 delta，**在事务末尾一次性**更新 `ledgers.balance_cents / balance_version`（对齐 `ledgerRepo.applyBalanceDelta`，transfer 不产生 delta）；
5. **批量写入第二条铁律（epoch + floor）**：对本次导入受影响的每个账本执行 `sync_epoch + 1` **与** `sync_epoch_floor_seq = LEAST(..., MIN(本批 change_seq))`（**必须与上述 INSERT 同一事务、同一条 UPDATE**，SQL 见 §5.2.2）。理由：`change_seq` 走 `nextval` 有"已取号未提交"洞，批量长事务在 COMMIT 前若同 family 有并发单笔写入先提交，会把客户端 watermark 推过本批号段区间 → 导入数据被客户端永久拉不到。epoch 变化触发客户端回退，floor 决定回退到哪里。**忘记这一步 = 洞重新打开且无人知晓**，是本方案唯一靠约定守住的失败模式，须列入 review 检查项（不变量 F1 / F2 见 §5.2.2）。
6. `UPDATE data_jobs SET status='succeeded', finished_at, result_summary`（**条件更新**，见下）。

> **导入上线前置（决策 16）**：`sync_epoch` / `sync_epoch_floor_seq` 的客户端消费能力必须**先于**任何生产批量写入入口上线。版本兼容矩阵与"哪种旧版本会丢数据、哪种只是变慢"见 §5.2.4。

**成功状态不能在事务提交后再单独更新**，否则：

```text
entries 已 COMMIT → 进程崩溃 → job 仍是 processing → 恢复重跑 → 重复导入
```

同事务后只有两种结局：entries + 余额 + job=succeeded 一起成功，或一起回滚。回滚后行产物仍在，重试用同一组 `entry_id/client_ref_id`，靠 `uq_entries_ledger_client_ref` 保证不重复。

> **余额 UPDATE 必须放在事务末尾**（v0.6 补充）：`ledgers` 是**同账本所有记账的公共热点行** —— `entryService.createWithIdempotency` 每次记账都要 `applyBalanceDelta` 更新它。导入大事务一旦碰过这一行，行锁就持有到 COMMIT，期间该账本所有成员的记账请求全部排队（PG pool `max=10`，很容易连带耗尽连接）。把它挪到最末尾可把持锁窗口从"整个导入时长"压缩到"最后一次 UPDATE 到 COMMIT"。
> **v0.8 补充**：步骤 5 的 `sync_epoch` / `sync_epoch_floor_seq` 也写 `ledgers` 行，**必须与余额 UPDATE 合并为同一条 `UPDATE ledgers SET balance_cents=..., balance_version=..., sync_epoch=..., sync_epoch_floor_seq=... WHERE id=$1`**，而不是分两条。分两条会把热点行锁的持有窗口翻倍，且在 `delta = 0`（全 transfer 的导入）时 `applyBalanceDelta` 会跳过 UPDATE —— 若 epoch 搭在它上面就会被一起跳过，直接触发不变量 F2 的失败模式。
> 另需设 `lock_timeout` / `statement_timeout` 兜底，避免导入被其它长事务卡住时无限等待。
> 注意 `entries_change_seq` 已被 `0016` 改为 `CACHE 1`（为修资产 stale 问题保证严格单调），故 N 条导入 = N 次序列往返，是耗时的隐藏放大项 —— 这也是 §9.1 把上限降到 5,000 行的原因之一。同时它保证了 §5.2 的 `MIN(本批 change_seq)` 是一个稳定可取的值。

#### 为什么"靠 FK 兜底"不成立，必须显式复核（v0.6 新增 · P0）

v0.5 的 R12 论证是："detect→commit 之间上下文失效时，遇 FK 失效则整批回滚"。**在 Costra 的软删模型下这条完全不成立**：

| detect→commit 之间的变化 | v0.5 假设 | 实际行为 |
|---|---|---|
| 记账人退出家庭 | FK 失效 → 回滚 | ❌ 退出只写 `family_members.left_at`，**`users` 行永在** → FK 正常 → 静默写入一条归属**已退出成员**的流水 |
| 分类被删除 | FK 失效 → 回滚 | ❌ 分类是 `deleted_at` **软删** → FK 正常 → 写入指向**已软删分类**的流水，客户端渲染分类名落空 |
| 用户失去账本权限 | — | FK 与此无关，必须应用层校验 |

即 R12 的"缓解"实际是空的，会静默产生脏数据。commit 事务内必须显式复核**并加行锁**（v0.7 修订）：

```sql
-- 1) 操作者仍是该账本所属家庭的活跃成员（否则整批 failed · 不可重试）
-- 2) 产物中所有 distinct created_by 仍是该家庭活跃成员
--    FOR UPDATE：锁成员行至事务结束，堵住「复核通过 → 成员并发退出 → 仍写入」的 TOCTOU
--    （对齐 familyMemberRepo.lockActiveMember 既有语义；leave/remove 的 UPDATE 会与此锁冲突）
SELECT user_id FROM family_members
 WHERE family_id = $1 AND user_id = ANY($2) AND left_at IS NULL
 ORDER BY user_id            -- 固定加锁顺序，防并发路径间死锁
 FOR UPDATE;
-- 3) 产物中所有 distinct category_id 仍存在且未软删且 type 匹配
--    （只读复核即可：分类仅软删、运行时无硬删路径，无 FK 风险）
SELECT id, type FROM categories
 WHERE id = ANY($3) AND deleted_at IS NULL;
```

> **锁顺序不变量**：本事务加锁顺序必须是 `family_members 行 → entries 行 → ledgers 行`，与 `entryService` 三条写路径一致（`entryService.ts` 文件头有记录）。复核锁成员行在最前、余额与 `sync_epoch` 更新锁 `ledgers` 行在事务末尾，天然满足该顺序；**事务中间禁止穿插任何 `ledgers` 行读写**，否则可能与 create/update/delete 路径形成循环等待。

任一复核不通过 → 整批回滚、`status='failed'`、`retryable=false`，错误文案指向"账本或分类已变化，请重新检测"。**不做部分导入**（部分成功会让用户无法判断该删哪些、重导哪些）。

#### 导入后无需服务端缓存失效

导入**不经过 `entryService`**（走批量 INSERT 路径）。服务端 **Redis 业务缓存（统计 / 预算 / members）已于 2026-08-28 回滚移除**（见 `docs/design/redis-cache-tech-spec.md` §14），统计与预算均为 PostgreSQL 实时聚合，因此导入 COMMIT 后**不存在"页面之间自相矛盾"的陈旧窗口**，无需任何失效调用。

> 若未来重新引入服务端读缓存，本条需重新评估：届时导入路径绕过 `entryService`，必须自行在 COMMIT 后失效该账本域。

#### 终态条件更新（run_token 防旧 worker 覆盖）

```sql
UPDATE data_jobs
   SET status = $newStatus, finished_at = now(), result_summary = $summary, ...
 WHERE id = $jobId
   AND status = 'processing'
   AND run_token = $myToken;   -- 旧/超时 worker 的 token 不匹配 → 0 行 → 放弃写回
```

#### 重试分类（导入不裸重试）

| 可重试（瞬态）| 不可重试（直接 failed） |
|---|---|
| DB 连接瞬断 / deadlock（`TRANSIENT_DB`）| 检测产物缺失或 SHA 不匹配（`ARTIFACT_MISSING`）|
| 临时 IO 错误（`TRANSIENT_IO`）| 用户已失去账本权限（`CONTEXT_INVALIDATED`）|
| 事务提交前进程退出（`TRANSIENT_DB`）| detect 上下文失效（成员退出 / 分类软删 · 见上方复核）（`CONTEXT_INVALIDATED`）|
| `lock_timeout` 超时（`TRANSIENT_DB`）| 数据违反业务约束（CHECK/FK）（`CONSTRAINT_VIOLATION`）|
| | 文件格式不支持（`CONSTRAINT_VIOLATION`）|

> `error_code` 取值域与客户端文案映射见 §9.5 末尾的表。`CONSTRAINT_VIOLATION` 意味着 §3.11 的 detect 校验集有遗漏（属 bug），应触发告警而不只是提示用户。

- 可重试：`status='queued'`、`retryable=true`、`next_attempt_at=now()+退避`（`attempts < 3`）。
- 不可重试：直接 `status='failed'`，删行产物。
- 崩溃恢复：`processing` 且 `lease_expires_at < now()` 的僵死任务才允许复位；复位前按上表判定，导入类默认按"事务未提交=可安全重试"处理（因为成功与数据同事务，未提交即无副作用）。
- **COMMIT 结果不确定时（如提交期间连接断开）绝不盲目重跑**：先重读 `data_jobs.status`，为 `succeeded` 则说明事务已提交，直接结束。
- **若某类导入无法保证"数据+成功状态同事务"，则该类导入必须关闭自动重试。**
- `timerHandle.unref()` + `onClose` 里 `stop()`，与 recurringScheduler 一致，保证 SIGTERM 快速关停。

#### 导出必须流式生成（v0.6 新增）

导入有 5,000 行上限，**导出的"全部"范围没有上限** —— 长期使用的账本可能几万条。若一次性查全量并在内存拼字符串：

- Node 单进程（生产 2 核 4G，CPU 是主瓶颈）会被 CSV 序列化长时间占满 event loop，**拖慢所有在线 API 的 P99**；
- 内存峰值随数据量线性增长，有 OOM 风险。

要求：
1. **游标分页读**（**专用导出游标**，每批 500~1000 条），不做 `SELECT` 全量。**不复用 `entryService.list` 的 cursor**（v0.7 修订）——它按 `updated_at DESC, id DESC` 排序，是增量同步语义，按更新时间导出的 CSV 不符合账单直觉。导出游标定义（v0.8 补齐时区与精度）：

```sql
-- 过滤：ledger + 未删除 + 日期范围（from/to 可为 NULL，见 §6.2）
-- ⚠️ occurred_at 是 TIMESTAMPTZ，from/to 是 DATE：必须显式按 Asia/Shanghai 换算边界，
--    否则会按会话 TZ（生产容器 UTC）解释，首末日各错约 8 小时的记录。
WHERE e.ledger_id = $1
  AND e.deleted_at IS NULL
  AND ($2::date IS NULL OR e.occurred_at >= ($2::date)::timestamp AT TIME ZONE 'Asia/Shanghai')
  AND ($3::date IS NULL OR e.occurred_at <  (($3::date) + 1)::timestamp AT TIME ZONE 'Asia/Shanghai')
  AND ($4::timestamptz IS NULL OR (e.occurred_at, e.id) > ($4, $5))   -- 游标
ORDER BY e.occurred_at ASC, e.id ASC
LIMIT $6
```

> **游标编码必须微秒安全**（v0.8 补充 · P1）：cursor 编码 `occurred_at|id`，其中 `occurred_at` **不能用 JS `toISOString()`**（只有毫秒精度），而 PG `TIMESTAMPTZ` 是微秒精度 —— 同毫秒内的多条记录会在翻页处漏读或重读。这正是 COSTRA-154 v1.2 踩过并已修复的坑（watermark 从 ISO 微秒改为 `change_seq` 的直接动因），不要在导出侧重蹈。实现取 PG 侧原样文本（`to_char(occurred_at, 'YYYY-MM-DD"T"HH24:MI:SS.US OF')` 或直接用 `row(occurred_at, id)` 元组比较并把游标存为 PG 返回的原始字符串），并在单测中构造"同微秒 3 条记录跨页"的用例。
>
> 时区处理统一用已有依赖 **`luxon`**（`server/package.json` 已含），不要手写偏移量常量 —— 硬编码 `+08:00` 在未来任何时区调整下都会静默出错。导入侧（§3.6）同此要求。

2. 每批序列化后**直接 append 写入当前分片文件流**，不在内存累积完整 CSV；
3. **批间 `await setImmediate()`** 主动让出 event loop，保证在线请求不被饿死；
4. **满 5,000 行切下一个分片**（§9.2），每个分片独立带 BOM + 表头，保证任一分片单独打开或单独回导都合法；
5. 导出任务全局串行执行（§7.5 并发模型），并受 `uq_data_jobs_active_export_per_user` 约束创建。

如此内存恒定、导出侧不设总行数上限，同时每个产物文件都落在导入上限内（闭环成立，§2.3）。

---

### 7.6 任务查询 API 与展示字段

```yaml
paths:
  /data-jobs/{job_id}:
    get:
      summary: 查询单个导入 / 导出任务状态
      responses:
        '200': { description: 任务状态与结果（含顶层 server_now） }

  /data-jobs:
    get:
      summary: 查询当前用户最近的数据任务
      parameters:
        - in: query
          name: limit
          schema: { type: integer, default: 20, maximum: 50 }

  /data-jobs/{job_id}/download:
    get:
      summary: 下载导出产物（应用层鉴权 · 校验属主 + 未过期）
      parameters:
        - in: query
          name: part
          required: false
          schema: { type: integer, default: 1, minimum: 1 }
          description: 分片序号（§9.2）；单文件导出省略即可
      responses:
        '200': { description: 文件流 }
        '404': { description: code=NOT_FOUND · part 越界或任务无产物 }
        '410': { description: code=EXPORT_FILE_EXPIRED · 文件已过期 }

  /import-detect-sessions/{detect_id}/report:
    get:
      summary: 下载完整检测问题报告 CSV（应用层鉴权 · 校验属主）· 走 §9.3 Formula 防护
      description: |
        报告独立保留 24h（report_expires_at），不随 commit 有效期（15min）失效，
        也不随任务终态被清理 —— 见 §7.4 生命周期。
      responses:
        '200': { description: 文件流 }
        '404': { description: code=NOT_FOUND · 会话不存在或报告已过期清理 }
```

客户端消费的 `DataJob` 字段：
- `id / type(import|export) / ledger_id / ledger_name`
- `status / stage / stage_started_at` + 顶层 `server_now`（客户端据此做阶段型渐近模拟，§7.2）
- `created_at / started_at / finished_at`
- `detect_id`（**导入任务必带**，客户端据此拼 `/import-detect-sessions/{detect_id}/report` 查 warning 明细，§7.4）
- `result_summary`（导入：`imported / skipped / error_count / warning_count`；导出：`entry_count / part_count`）
- `files[]`（导出成功时：`part / file_name / file_size / sha256 / download_path`）+ `file_expires_at`
- `error_code / error_message / retryable`（失败时；`error_code` 取值见 §9.5）

> **字段命名统一**（v0.6）：文件过期时间在全文统一为 **`file_expires_at`**（v0.5 的 §6.2 曾写作 `download_expires_at`，与 §7.3 表定义、§7.6 客户端字段不一致）。
> **`result_summary` 不含 `affected_months`**：v0.6 已决定不做定向失效（§5.1），无需下发受影响月份。
> **v0.8**：单文件字段 `file_name / file_size / file_sha256` 由 `files[]` 数组取代（§6.2），客户端不做单/多分支。

stage → 进度区间与展示文案（无真实条数）：

| `stage` | 进度区间 | 展示文案 |
|---|---:|---|
| `queued` | 0% | `等待处理` |
| `validating` | 5% → 20% | `正在校验导入环境` |
| `writing` | 20% → 90% | `正在导入流水` |
| `querying` | 20% → 90% | `正在整理数据` |
| `packaging` | 90% → 98% | `正在生成 CSV 文件…` |
| `succeeded` | 100% | `已完成` |
| `failed` | 不显示百分比 | `处理失败 · 查看原因` |

---

## 8. 小程序端交互与页面

### 8.1 入口层级

```text
我的
└─ 设置  /pages-family/settings/index
   └─ 账本导入 / 导出  /pages-family/settings/data-management/index（新增）
```

设置页入口行：

```text
账本导入 / 导出                         ›
管理 CSV 导入、导出及后台任务
```

状态副文案按优先级动态变化：

| 条件 | 副文案 |
|---|---|
| 有运行中任务 | `1 个任务正在后台处理` |
| 有刚完成且未查看任务 | `导出已完成 · 待发送到微信` |
| 无任务 | `导入或导出账本 CSV` |

入口右侧不做常驻红点；只在有未查看完成结果时显示一个 `8rpx` 苔绿点，进入数据管理页即标记已查看。

### 8.2 数据管理首页

页面标题：`账本导入 / 导出`

```text
┌─ 导入账本 ─────────────────────────┐
│ 从微信聊天选择 CSV，将记录导入指定账本 │
│                              [导入] │
└────────────────────────────────────┘

┌─ 导出账本 ─────────────────────────┐
│ 将整本账导出为 CSV，并发送到微信聊天   │
│                              [导出] │
└────────────────────────────────────┘

最近任务
● 我的家庭 · 正在导入流水…
✓ 旅行账本 · 已完成          发送到微信 ›
! 我的账本 · 导入失败          查看原因 ›
```

视觉遵循项目现有 Inset Grouped：暖灰白页面、白色 `24rpx` 圆角卡片、无阴影。

### 8.3 导入按钮逻辑

1. 点首页 `导入`
2. 底部 action sheet 选择**目标账本**；默认当前 active ledger
3. 展示简短说明：`请先将 CSV 发到微信聊天或文件传输助手。`
4. 主按钮变为 `从微信聊天选择 CSV`，点击调用 `wx.chooseMessageFile`
5. 用户取消文件选择：静默停留，不 Toast 报错
6. 文件校验不通过：卡片内就地展示原因；不使用一闪而过的 Toast
   - 后缀非 `.csv`（大小写不敏感）→ `请选择 CSV 文件，Excel 可用「另存为 → CSV」导出`
   - 超过 1MB → `文件超过 1MB（约 5,000 条记录），请拆分后分批导入`
7. 校验通过后展示确认卡：目标账本、文件名、大小，以及说明 `点击开始检测，查看文件中的错误和警告。`
8. 点 `开始检测` 后上传；调用 `wx.enableAlertBeforeUnload({ message: '文件仍在上传，离开将取消本次检测。' })`
9. 收到检测报告后调用 `wx.disableAlertBeforeUnload()`，展示检测报告页
10. 用户查看报告，决定是否继续
11. 点 `确认导入 N 条` → POST /v1/import-jobs/commit → 收到 202 + job_id → 切任务卡
12. 或点 `取消 · 重新选择文件` → 回到步骤 4

### 8.4 导出按钮逻辑

1. 点首页 `导出`
2. 选择账本；默认当前 active ledger
3. 选择日期范围：`全部 / 本年 / 本月 / 自定义`，默认 `全部`
4. 页面明确提示：`将导出该账本范围内所有成员的流水。`
5. 点 `开始导出` 后立即创建任务，按钮在 600ms 内切到 `已加入后台任务`
6. 当前页面顶部出现可收起任务条：`正在导出「我的家庭」 · 可以离开`
7. 若已有运行中的导出任务，再点导出时提示 `已有导出任务正在进行，请完成后再试`（服务端 `409 EXPORT_JOB_IN_PROGRESS`）
8. 完成后任务行主操作是 `发送到微信`；点击才下载文件并调起微信转发面板。**多分片时逐个下载并转发**，每次之间提示 `第 N / M 个文件已发送`（§6.3）

### 8.5 后台任务感知模型

小程序退到后台后，JS 定时器不可靠；"后台执行"必须指**服务端任务继续运行**。

客户端策略：
- 页面可见：前 30 秒每 2 秒轮询，之后每 5 秒轮询
- 页面隐藏 / 小程序后台：立即停止轮询，不影响服务端任务
- `App.onShow` / 数据管理页 `onShow`：查询最近 20 个任务并恢复状态
- 本地仅保存 `unseenCompletedJobIds` 与最近一次状态，不把本地状态当事实源
- 任务完成时若页面仍可见：任务卡轻震一次 + 状态从琥珀进度态过渡为苔绿完成态
- 用户已离开页面：下次进入设置页时用副文案和小绿点提示
- **导入任务首次观测到 `succeeded` 时**：调用 `triggerOnMutation()` 推一轮 sync，把数据到达从"最长 60s"缩短到秒级（§5.1）。需按 `job_id` 去重，避免多次轮询重复触发。

> **导入完成态的文案必须诚实**：数据写入服务端成功 ≠ 本地已全部可见（sync 需要若干轮）。任务卡完成文案用 `已导入 N 条 · M 条跳过`，**不要**写"账本已更新完成"。若用户此时切到明细页而本地尚未收齐，页面会先展示已同步的部分 —— 这是 §5.1 的既有 sync 语义，不额外加拦截或 loading 遮罩（否则又变成为导入加旁路）。

---

## 9. 权限与安全

### 9.1 导入侧

| 项 | 规则 |
|---|---|
| 上传者身份 | 必须已登录 · JWT bearer |
| 目标账本 | 用户在上传前选择；必须是其所属家庭的活跃账本 |
| 记录ID | **不允许传入**；若 CSV 表头包含 `记录ID` / `id` / `entry_id`，检测阶段返回 ERROR |
| 记账人字段 | 按昵称匹配家庭成员；未匹配归属操作者 + warning；**同名多个成员 → ERROR**（§3.3）|
| 文件大小 | ≤ **1MB**（见下方"规模上限的全链路推导"）；客户端先校验，服务端按路由二次校验，超限 `413 PAYLOAD_TOO_LARGE`（三层阈值顺序见 §9.5）|
| 行数上限 | 单次导入 ≤ **5,000 行**；超限检测阶段 ERROR |
| 后缀白名单 | 仅 `.csv`（**大小写不敏感**：`.CSV` / `.Csv` 同样放行；`wx.chooseMessageFile` 的 `extension` 参数亦按小写传入并在服务端归一后比对）|
| 内容校验 | UTF-8（可带 BOM）+ RFC 4180 + 必填表头；拒绝 XLSX / JSON / 二进制 |
| DB 硬约束校验 | detect 必须覆盖 `entries` 全部 CHECK / 引用约束（§3.11），否则"可导入 N 条"与实际写入不一致 |
| 导入并发 | **同一账本同时只允许一个导入任务在执行**（DB 唯一索引兜底）；`409 IMPORT_JOB_IN_PROGRESS` |
| 检测并发 | **同一用户同时只允许一个 `detecting` 会话**（DB 唯一索引兜底，§4.4）；`409 DETECT_IN_PROGRESS`。判定点在收流+sha 之后（§4.2）|
| 频控 | 单用户 5 分钟最多创建 3 个导入任务；**detect 端点单独频控**（5 分钟 5 次）。**计数器必须独立于会话表**（见下）|
| detect 幂等 | 同 `(user, ledger, file_sha256)` 的 ready 会话在有效期内直接复用，不重复解析（§4.2）|
| 私有产物 | 规范化行产物落 server-only `/data/import-staging`（`0700`/`0600`/UID 1000，不挂 nginx，不进备份，日志不记行内容，§7.4） |
| 审计 | 记录 user_id、目标账本、file_sha256、detect_id、任务 ID、结果统计（不记录行明文） |

#### 规模上限的全链路推导（v0.6 · 从 5MB/20,000 行降到 1MB/5,000 行）

v0.5 的 `5MB / 20,000 行` 是**只按"PG 单事务能扛多久"单侧推导**得出的。实际上，一次导入要穿过五道互不相干的关卡，上限必须取**它们的交集**：

| 关卡 | 现状事实 | 5MB 是否可行 |
|---|---|---|
| nginx `client_max_body_size` | **全仓库 0 处配置 → 默认 1MB** | ❌ 5MB 在反代层直接 413，Fastify 收不到 |
| `@fastify/multipart` | 全局 `fileSize: 2MB, files: 1`（`server/src/app.ts`）| ❌ 需为导入抬高全局上传上限（副作用波及头像等所有上传）|
| nginx `proxy_read_timeout` | `60s`（`costra.cloud.conf.prod`）| ⚠️ 20,000 行流式解析+校验+gzip+SHA256 在 2 核上可能超时，而服务端已写完产物 → 用户拿不到报告却已耗掉算力 |
| 客户端本地库 | 微信单 key 1MB / 总量 10MB 约束仍在（L13 已废除 `entry:__index`，原 `appendToIndex` 全量重写 O(n²) 消失）| ⚠️ 20,000 条实体占用可观，10MB 总量仍是硬顶；O(n²) 卡死风险已消失。**v0.8 补记：`db.ts` 当前无 quota 超限降级分支，这是既有缺口**（R26 相关，§14.1 spike 3 需实测） |
| sync 下行通道 | L13 已落地分页循环（limit 500 × 最多 40 页 + 截断 300ms 续拉）；v0.8 再加 `floor_seq` 定点重拉（§5.2）| ✅ 已修复；但 5MB 仍被 nginx / multipart / 超时 / 存储四道关卡否决 |

**真实业务量反推**：9 列中文 CSV 每行约 60~120 字节（quote-all 后取上界）。个人一年记账 1,000~3,000 条 ≈ **150~400KB**；微信/支付宝导出一年账单同量级。5MB ≈ 5 万行，**对家庭记账是不存在的场景**。

因此 v0.6 取 **1MB / 5,000 行**（5,000 行 × 120B ≈ 600KB，1MB 留足 BOM + quote-all 冗余）。收益是连锁的：

| 原本需要的改造 | 降级后 |
|---|---|
| 抬高 `@fastify/multipart` 全局 fileSize | **不改**（1MB 天然在 2MB 内）—— 避免为单一功能放宽全局上传策略 |
| detect 改 `202 + 轮询`（防 60s 超时）| **不改**（5,000 行解析为秒级），保持 `200` 同步返回，交互更简单 |
| 大事务长时间持 `ledgers` 行锁 | 秒级，配合 §7.5 的"余额 UPDATE 放末尾"可接受 |
| 客户端本地库改造 / 分片 | 导入**无需额外改造**；所需改造（批量落盘 + 废除 `entry:__index` + 月索引串行队列）已由 L13 完成（§5.1） |

唯一必须做的基建改动：**nginx 显式声明 `client_max_body_size 2m`**（1MB 文件 + multipart 封装开销，留一倍余量），写在 `/v1/` location 或 server 块。这一行是全部基建成本。

> **设计原则（可复用）**：任何"上限类参数"（文件大小、行数、批量条数、分页 limit）都必须做**全链路交集校验**，不能只算最熟悉的那一层。上限设得过大不会带来收益，只会把成本转移成一串隐藏的基建改造。

#### 频控计数器必须独立于会话表

§7.4 规定"应用侧每分钟清理过期 `ready` 会话及僵死 `detecting` 会话"。若频控按 `import_detect_sessions` 行数统计（v0.5 的建议），**清理任务会把计数依据一起擦掉**，用户等一分钟即可重置额度，频控形同虚设。

要求：频控计数走**独立 Redis 计数器**（固定窗口 `INCR` + `EXPIRE`），key 与业务缓存分域（不使用 `cache:` 前缀，不参与 §7 的 generation 失效体系）。导入任务频控（5 分钟 3 个）可按 `data_jobs` 计数（该表元数据保留 30 天，不会被清理干扰）。

### 9.2 导出侧

| 项 | 规则 |
|---|---|
| 请求者身份 | JWT bearer 必需 |
| 导出权限 | 请求者必须是该账本所属家庭的活跃成员；不做二次同意 |
| 数据范围 | 账本日期范围内全部未删除流水，包含所有成员；日期边界**显式按 `Asia/Shanghai` 换算**（SQL 见 §7.5，用 `luxon`，禁止硬编码 `+08:00`）|
| 生成方式 | **必须流式**：游标分页读 + 逐批 append 落盘 + 批间 `await setImmediate()` 让出 event loop（§7.5）|
| 规模上限 | **总行数不设上限**（靠流式保证内存恒定）；但**单文件 ≤ 5,000 行，超出自动分片**（见下）。必须验证大账本导出不拖慢在线 API P99 |
| 并发 | 同一用户同时最多 1 个运行中的导出任务（**DB 唯一索引 `uq_data_jobs_active_export_per_user` 兜底**，不只应用层 check）；执行侧为全局串行（§7.5）|
| CSV 安全 | 所有单元格走 §9.3 Formula Injection 防护 + quote-all |
| 文件名安全 | 文件名与 `Content-Disposition` 删除 CR/LF、C0 控制字符、路径符号，限长（防 header 注入/路径问题） |
| 文件保留 | 生成后保留 24 小时；过期后可从原任务一键重新生成 |
| 下载鉴权 | 下载端点再次校验 JWT 与 job.user_id；**应用层流式返回**，不用 `X-Accel-Redirect`、不挂 nginx 静态（§7.4）|
| 文件摘要 | 返回 SHA-256，客户端转发前校验 |
| 审计 | user_id、ledger_id、日期范围、entry_count、job_id、sha256 |
| 清理 | 定时任务删除 24 小时前的实体文件，任务元数据保留 30 天 |

#### 导出分片：单文件 5,000 行（v0.8 新增 · P1）

v0.7 让导出"不设上限"而导入硬顶 5,000 行 / 1MB，这个不对称直接**推翻了三处已冻结的承诺**：

| 被推翻的承诺 | 出处 |
|---|---|
| "同一格式 CSV 既能导出也能导入回" | §2.3 设计原则 3 |
| 用户场景「Costra 数据迁回」 | §1 |
| E6 验收项「自产自入闭环」 | §12 |

一个 3 万条的账本导出后是 ~3MB / 3 万行的单文件，**在导入侧连 detect 都进不去**。用户唯一的补救办法是自己用 Excel 切分 —— 而 §1 排第一的用户画像恰恰是"不想折腾的记账用户"。

v0.8 规则：

- 导出 writer 每写满 **5,000 行**切下一个分片，文件名追加 `_NofM`（§2.2 / §6.2）；
- **每个分片都是独立完整的 CSV**：各自带 UTF-8 BOM + 9 列表头 + CRLF + quote-all，任一分片单独在 Excel 打开或单独回导都合法；
- 分片数 `part_count` 与 `files[]` 一并下发（§6.2），客户端逐个下载并转发（§6.3）；
- 记录**不跨分片切分**（一条记录必然完整落在一个分片内，含 multiline 备注）。

> 为什么不用"导出也不限、只在文档里提醒用户分批"：那是把设计缺口转嫁为用户操作负担，且用户在**导出时**根本无从得知未来导入会失败。分片让闭环在任意规模下自动成立，实现成本仅是 writer 里的一个计数器与文件切换。

### 9.3 CSV Formula Injection 防护

导出 CSV 会被用户在 Excel / WPS / Google Sheets 打开，以 `=`、`+`、`-`、`@` 等开头的单元格会被当作**公式执行**（OWASP CSV Injection）。当前 `csvEscape` 只做 RFC 4180 引号转义，**不能阻止公式执行**。

**受用户控制的导出字段**：一级/二级分类名、记账人昵称、备注、问题报告里的原始值片段；账本名进入文件名/header 另行防护。

#### 两层分开处理

1. **公式防护**（防表格软件执行）；
2. **RFC 4180 序列化**（处理逗号/引号/换行）。二者缺一不可，只做第 2 层无效。

#### 防护编码 `apostrophe-v2`（可逆 · v0.8 修正 P0）

> ⚠️ **`apostrophe-v1` 的编解码不是互逆的，会静默损坏用户数据。**
>
> v1 规则：编码侧"**危险值**加前导单引号"，解码侧"Costra 自产文件**无条件移除一层**前导单引号"。反例：
>
> | 步骤 | 值 |
> |---|---|
> | 用户原始备注 | `'备注`（前导单引号 + 普通字符） |
> | v1 编码判定 | 首个有效字符是 `'`，既不在 `=+-@`、也不是 Tab/CR/LF、也不是全角变体 → **判定安全，不加防护** |
> | 导出单元格 | `'备注` |
> | v1 解码（自产自入） | 无条件剥一层 → **`备注`** ❌ 单引号丢失 |
>
> v0.7 的可逆性表格只列了 `'=SUM(...)` 这一种"前导单引号 + 危险字符"的组合，恰好绕开了反例。而 §2.3 明确承诺"同一格式既能导出也能导入回"，这是一条**必须成立的契约**。

**v2 编码规则**（在任一条件成立时，于最前面加一个 ASCII 单引号 `'`）：

1. 首字符是 `'`（**v2 新增 · 无条件**）—— 这条使编解码严格互逆；
2. 首个**有效字符**是 `=`、`+`、`-`、`@`；
3. 首字符是 Tab(0x09)、CR(0x0D)、LF(0x0A)；
4. 上述字符的**全角变体**（`＝＋－＠`）；
5. 危险字符前只有空格 / Unicode 空白 / 控制字符（不能只看原始首字符，防边界注入）。

**v2 解码规则**（仅对 `formula_guard = apostrophe-v2` 的文件）：移除**恰好一层**前导单引号。

可逆性验证（编码 → 解码必须回到原值）：

| 原始值 | v2 导出值 | 重新导入还原 | v1 是否正确 |
|---|---|---|---|
| `=SUM(A1:A2)` | `'=SUM(A1:A2)` | `=SUM(A1:A2)` | ✅ |
| `'=SUM(A1:A2)` | `''=SUM(A1:A2)` | `'=SUM(A1:A2)` | ✅ |
| **`'备注`** | **`''备注`** | **`'备注`** | ❌ v1 会丢单引号 |
| **`''两个引号`** | **`'''两个引号`** | **`''两个引号`** | ❌ v1 会丢一个 |
| `  =1+1` | `'  =1+1` | `  =1+1` | ✅ |
| `普通备注` | `普通备注`（不变） | 不变 | ✅ |

> **规则 1 的代价与取舍**：以单引号开头的普通备注（如 `'临时'`）在 Excel 里会显示为 `''临时'` —— 多出一个引号，观感上略怪。但这是**可见的、可逆的**小瑕疵，而 v1 的行为是**不可见的、不可逆的**数据丢失。在"人类可读"与"数据无损"冲突时，本方案一律选后者。
> 另：Excel 打开 CSV 时会把首个 `'` 当作"文本前缀符"吞掉显示，实际观感通常仍是 `'临时'`，代价比字面看起来更小。

**单测要求（必须逐条覆盖，缺一不可）**：上表 6 行全部走 `encode → decode` 往返断言，另加"空串""纯空白""仅一个 `'`"三个边界。

> **为什么改名 v1 → v2 而不是原地修**：`formula_guard` 是写进 `import_detect_sessions` 且随 DetectReport 下发的**契约字段**。改名让"按 v1 规则编码过的文件"与"按 v2 规则编码的文件"在语义上可区分。虽然本功能上线前不存在任何 v1 文件（v1 从未发布），改名的成本为零，而保留一个已知有缺陷的版本号会让后人误以为 v1 是可用的。
> 若未来真的出现 `formula_guard=apostrophe-v1` 的文件（不应发生），检测阶段直接 ERROR，不写兼容分支。

随后由 CSV 序列化器：双引号转义 + **每字段统一 quote-all** + CRLF 输出（表头行同样 quote-all，保持全表一致）。

#### 导入解码

- 只有被 §2.1.1 的**9 列表头指纹**判定为 Costra 自产（`is_costra_export = true` → `formula_guard = apostrophe-v2`）的文件，导入时**移除一层** Costra 防护（`'x`→`x`、`''x`→`'x`）。
- **外部 CSV（`formula_guard = none`）不做任何反解**，避免篡改用户原始数据里本就存在的前导单引号。
- 解码发生在 CSV 反序列化**之后**、字段语义解析**之前**（顺序与导出侧严格镜像）。

> **v0.6 变化**：判定依据从"preamble 声明"改为"表头指纹"（preamble 已删除，§2.1）。可逆性保证不变 —— 因为 Costra 导出的表头恒为固定 9 列，指纹与 `formula-guard` 声明是一一对应的。
> **v0.8 变化**：编码规则升级为 `apostrophe-v2`（首字符为 `'` 时无条件加一层），修复 v1 的不可逆缺陷（见上）。

#### 防护范围

主账本导出、导入问题报告 CSV、以及后续任何 CSV 下载功能都必须应用。**数据库内仍存原始业务文本**，不在入库时永久加单引号——防护只发生在导出序列化那一刻。

> **注意：仓库中已无 `csvEscape`**（v0.8 修正 · P2）。v0.7 写"当前 `csvEscape` 只做 RFC 4180 引号转义，不能阻止公式执行"，该函数原属 v1 CLI 脚本，已随 2026-09-02 的脚本删除一并消失。`server/src` 下**没有任何现存 CSV 序列化工具**，E1 需要从零引入 parser 与 stringifier（选型见 §12 E1 备注）。此处保留这句话只为说明"RFC 4180 转义 ≠ 公式防护"这一原则，不要按图索骥去找那个函数。

### 9.4 审计日志的落地形式（v0.6 新增）

§2.5 / §9.1 / §9.2 三处都要求"写审计日志"，但**仓库中既没有审计表也没有审计服务** —— 这条要求此前没有载体，等于没落地。

v0.6 决策：**不新建审计表，走结构化 pino 日志**。

- 复用现有日志基建：生产 pino 写固定文件 `/var/log/costra/server.log` → 宿主机 `/data/logs/server`，由 logrotate 唯一轮转；已有 `maintenance.sh error-report` 每日扫描通道。
- 审计事件用固定字段前缀便于检索：`{ audit: 'data_export' | 'data_import', user_id, ledger_id, family_id, job_id, detect_id, file_sha256, entry_count | imported, skipped, date_from, date_to }`。
- **不记录任何行明文**（备注、昵称、金额明细一律不进日志），与 §7.4"日志不得记录行内容"一致。
- 为什么不建表：审计只用于事后追溯与安全排查，无查询/关联需求；新建表会带来 migration、清理 cron、容量增长三份长期成本，而收益仅是"能用 SQL 查"。若后续出现合规检索需求再升级为表。
- **工作量已在 §12 的 E3 中计入**（v0.5 曾漏计）。

### 9.5 错误码契约（v0.8 新增 · P0）

> v0.7 全文的 API 只写裸 HTTP status（`409` / `410` / `413` / `429`），这**直接违反项目铁律**：
>
> ```text
> server/src/errors/ErrorCode.ts 文件头约束 3：
>   客户端依 `code` 判分支，严禁依 HTTP status 判分支。
> ```
>
> 而现有 `ErrorCode` 枚举**没有任何一个 code 能表达本方案的语义**：
> - `409` 现有三个候选（`VERSION_CONFLICT` / `DUPLICATE_RESOURCE` / `ALREADY_MEMBER`），但"账本已有导入任务"与"用户已有检测在跑"是**两种需要不同文案**的 409（§4.4 明确要求两套提示语），复用任何一个都无法区分；
> - `410` 只有 `INVITE_EXPIRED`（语义是邀请码），而本方案有"检测报告过期"与"导出文件过期"两个新语义；
> - **`413` 在枚举里根本不存在**。

#### 新增 ErrorCode

| code | HTTP | 触发场景 | 客户端行为 |
|---|---:|---|---|
| `IMPORT_JOB_IN_PROGRESS` | 409 | 该账本已有 `queued`/`processing` 的导入任务（§4.4）| 就地提示 `该账本已有导入任务正在进行，请完成后再试` |
| `DETECT_IN_PROGRESS` | 409 | 该用户已有 `detecting` 会话（§4.4）| 就地提示 `上一个文件还在检测中，请稍候` |
| `EXPORT_JOB_IN_PROGRESS` | 409 | 该用户已有运行中的导出任务（§9.2）| 就地提示 `已有导出任务正在进行，请完成后再试` |
| `DETECT_SESSION_EXPIRED` | 410 | commit 时 `expires_at < now()`（§4.5）| 回到选文件步骤，提示 `检测已过期，请重新选择文件` |
| `EXPORT_FILE_EXPIRED` | 410 | 下载时 `file_expires_at < now()`（§7.4）| 任务卡切"重新生成"（复用原参数） |
| `PAYLOAD_TOO_LARGE` | 413 | 上传超 1MB（§9.1）| 就地提示 `文件超过 1MB（约 5,000 条记录），请拆分后分批导入` |

频控命中复用既有 `RATE_LIMITED`（429，`retry-after` 策略），不新增。

#### 落地清单（缺一项则启动期自检失败）

新增 code 必须**同步**六处，`ErrorCode.ts` 的 `assertErrorCodeCoverage()` 会在模块加载期强制校验前三张表：

1. `server/src/errors/ErrorCode.ts` → `ErrorCode` 枚举
2. 同文件 → `ErrorHttpStatus` 映射
3. 同文件 → `ErrorRetryStrategy` 映射（**六个全部为 `'none'`** —— 都是确定性业务态，自动重试只会放大无效请求）
4. 同文件 → `ErrorLogLevels` 映射（建议：三个 `*_IN_PROGRESS` 与两个 `*_EXPIRED` 为 `'info'`（预期内业务分支）；`PAYLOAD_TOO_LARGE` 为 `'warn'`（客户端本应先做本地校验，走到服务端说明客户端校验被绕过））
5. `docs/api/error-codes.md`
6. `server/api/openapi.yaml` 的 `components.schemas.ErrorCode` + 客户端 error-mapper

#### multipart 超限的映射（易漏）

`@fastify/multipart` 在超过 `limits.fileSize` 时抛的是 `FST_REQ_FILE_TOO_LARGE`，**不是 `AppError`**。`errorHandler.ts` 当前没有对应分支，现状会漏成 `500 INTERNAL`（用户看到"服务异常"而不是"文件太大"）。

需在 `errorHandler.ts` 增一条映射：`error.code === 'FST_REQ_FILE_TOO_LARGE'` → `PAYLOAD_TOO_LARGE`。

> 注意两级限制的关系：nginx `client_max_body_size 2m` 会在**反代层**直接返回 nginx 自己的 413 HTML（不带 `code`）。因此客户端**必须先做本地 1MB 校验**（§8.3 步骤 6），把这条路径变成兜底而非常规路径；服务端 multipart 的 2MB 限制是第二道兜底。三层阈值（客户端 1MB < multipart 2MB ≤ nginx 2MB）的顺序不能颠倒。

#### `data_jobs.error_code` 的取值域

任务**执行期**失败写入 `data_jobs.error_code`（§7.3），它与上面的 HTTP 错误码是**两套东西**（前者是任务结果，不是请求响应）。取值枚举：

| error_code | retryable | 含义 |
|---|:---:|---|
| `ARTIFACT_MISSING` | false | 检测产物缺失或 SHA 不匹配（§7.5 R16）|
| `CONTEXT_INVALIDATED` | false | detect 上下文失效：成员退出 / 分类软删 / 失去权限（§7.5 复核）|
| `CONSTRAINT_VIOLATION` | false | 数据违反 DB 业务约束（detect 校验集有漏，属 bug，需告警）|
| `TRANSIENT_DB` | true | 连接瞬断 / deadlock / `lock_timeout` |
| `TRANSIENT_IO` | true | 临时 IO 错误 |
| `INTERNAL` | false | 未分类异常（需人工排查）|

客户端按此渲染失败原因文案，不解析 `error_message`（后者仅供服务端排查，可能含技术细节）。

---

## 10. v1 脚本与 v2 客户端的关系

> **v0.7 更新**：v1 CLI 脚本（`export-entries.mts` / `import-entries.mts`）**已于 2026-09-02 删除**。它们是 v1 旧时代产物：15 列含 UUID 的旧格式、手写逐物理行 parser（不支持 quoted multiline）、同步内存读写、无并发约束，与 v2 格式和行为已全面分叉，保留只会成为绕过 v2 约束（两阶段、频控、`sync_epoch` 铁律）的旁路。原"保留作运维应急入口"的决策随之作废——应急导数走 `infra/scripts/psql-exec.sh` 直连 SQL（正式 UPDATE 带期望旧值做 CAS 的既有纪律不变）。

业务逻辑直接落在 service，不再有 CLI 适配层：

- `server/src/services/entryExport.ts`
- `server/src/services/entryImport.ts`

```text
小程序 HTTP 路由 ── entryImport / entryExport service ─ PostgreSQL
```

由此 E1 的"CLI 改薄入口 / 行为反转做成入参"工作取消：归属默认、金额精度等行为只有 v2 一套语义，无需参数化兼容 v1。

### 10.1 v1 → v2 格式变更对照（历史留档）

v1 脚本已删除，下表保留作为格式演进对照与"为什么 v2 不兼容 v1 文件"的依据：

| 维度 | v1 · CLI 脚本（已删除） | v2 · 客户端 |
|---|---|---|
| 列数 | 15 列（含 UUID） | **9 列**（仅人类可读字段） |
| 记录ID | 条件必填 | **不允许传入** |
| 账本ID | 必填 | **不导出 · 不导入**（由用户选择目标账本） |
| 记账人ID | 必填 | **不导出 · 不导入**（按昵称匹配） |
| 归属默认 | 支出默认 `共同`（硬编码）| 支出**沿用家庭默认语义**（§3.8）|
| 执行模型 | 同步 | 异步任务 |
| 导入流程 | 一步到位 | **检测 → 确认导入** 两阶段 |
| 并发约束 | 无 | 同账本单导入 + 同用户单导出 + 同用户单检测（DB 唯一索引兜底）|
| 文件名 | `{账本名}_{起始}_{结束}.csv` | `Costra_{账本名}_{起始}至{结束}_{时刻}.csv` |
| 文件头 | 无 / 自由文本注释 | **无**（纯 RFC 4180；格式由 9 列表头指纹识别，§2.1.1）|
| CSV 解析 | 手写逐物理行（不支持 quoted multiline）| 标准 RFC 4180 parser（支持多行字段）|
| 公式防护 | 无 | 导出 `apostrophe-v2` 可逆防护 + quote-all（§9.3）|
| 重试幂等 | 保留 ID 去重 | 稳定 `client_ref_id` + 数据/成功状态同事务（§7.5）|
| 时区 | 进程本地 `Date` | 显式 `Asia/Shanghai`（导入导出双侧，§3.6 / §9.2）|
| 缓存失效 | 无缓存 | 无（服务端业务缓存已移除，实时聚合；§7.5）|

> ~~**CLI 脚本的行为反转必须做成入参**~~（v0.7 作废）：原要求 service 把归属默认、金额精度做成显式选项以兼容 CLI 的 v1 行为；v1 CLI 已删除，service 只有 v2 一套语义（归属沿用家庭默认语义、金额超两位小数 ERROR），无需兼容选项。

---

## 11. 风险清单

| # | 风险 | 概率 | 影响 | 缓解 |
|---|---|---|---|---|
| R1 | 用户不知道要先把 CSV 发到微信 | 高 | 中 | 导入卡内固定三步说明，推荐文件传输助手 |
| R2 | 用户误以为离开小程序会终止任务 | 高 | 中 | 202 后明确显示 `正在后台处理 · 可以离开` |
| R3 | 小程序后台轮询暂停 | 必然 | 低 | 服务端任务独立执行；onShow 恢复查询 |
| R4 | CSV 上传未完成时用户离开 | 中 | 中 | enableAlertBeforeUnload 防误返回；任务未创建则需重选文件 |
| R5 | 按账本导出暴露其他成员流水 | 已接受 | 高 | 已冻结产品口径；活跃成员可导出完整账本，写审计日志（§9.4）|
| R6 | 完成文件链接泄露 | 低 | 中 | 下载 API 同时校验 JWT + job.user_id；应用层流式返回不挂 nginx；24 小时清理 |
| R7 | 用户要求聊天自定义封面 | 中 | 低 | shareFileMessage 只能控制文件名；自定义视觉放在小程序完成卡中 |
| R8 | XLSX / JSON 被选中 | 中 | 低 | `extension:['csv']` + 服务端内容校验；提示另存为 CSV |
| R9 | 并发任务重复写入 | 中 | 高 | 同账本单导入 + 同用户单导出（均 DB 唯一索引兜底）+ 稳定 `client_ref_id` + `uq_entries_ledger_client_ref` |
| R10 | 重复导入同一份无 ID 文件产生重复 | 已接受 | 中 | 不跨次去重是已冻结决策；用户需先删除上次导入的记录（同一 job 重试不重复，§7.5）|
| R11 | 检测报告过期 | 中 | 低 | ready 15 分钟有效期；过期 commit 返 410 提示重新检测 |
| R12 | 检测后账本上下文变化（成员退出 / 分类软删 / 失去权限）导致引用失效 | 中 | **高** | **不能依赖 FK**（成员退出只写 `left_at`、分类是软删，FK 都不会报错）。commit 事务内**显式复核并 `FOR UPDATE` 锁成员行**（堵住复核→写入之间成员退出的 TOCTOU）+ 分类未软删 + type 匹配，任一失败整批回滚 failed（不可重试）（§7.5）|
| R13 | 服务重启导致 `processing` 任务僵死 | 低 | 中 | `lease_expires_at` 超时才复位；导入"数据+成功状态同事务"保证未提交即无副作用，可安全重试（§7.5）|
| R14 | 导出/暂存文件占满磁盘 | 低 | 中 | 24h TTL + 按月分桶 + `purge-exports`/`purge-import-staging` cron；导入文件受 1MB/5,000 行上限约束；导出流式生成不占内存 |
| R15 | 导出 CSV 被表格软件当公式执行 | 中 | 高 | §9.3 `apostrophe-v2` 可逆防护 + quote-all；文件名/header 控制字符防护 |
| R16 | 检测产物损坏 / SHA 不匹配 | 低 | 中 | commit 前校验 `artifact_sha256`；不匹配直接 failed（不可重试），提示重新检测 |
| R17 | 旧/超时 worker 覆盖新执行结果 | 低 | 中 | 终态用 `run_token` 条件更新，token 不匹配则 0 行放弃写回（§7.5）|
| R18 | detect 端点被反复上传放大 CPU/磁盘 | 中 | 中 | detect 单独频控（独立 Redis 计数器）+ **同用户单并发** + 1MB/5,000 行上限 + 流式解析 + sha256 幂等复用（§9.1）|
| R19 | ~~导入后数据迟迟不出现在客户端~~ → **未升级的旧客户端踩 `change_seq` 洞** | 中 | **高** | 原根因（`has_more` 无人消费）已随 L13 修复关闭（§5.1）：任务成功后客户端调 `triggerOnMutation()`，导入数据经 epoch **定点重拉**秒级可见。残余风险：导入入口开放时仍有未升级的旧版本客户端（无 epoch 逻辑）→ 导入数据永久拉不到。**缓解 = 版本覆盖率门槛**（决策 16、§5.1）；版本兼容矩阵见 §5.2.4 |
| R20 | 导入 detect 通过但 commit 撞 DB 约束致整批失败 | 中 | 高 | detect 校验集必须是 `entries` 全部硬约束的超集（§3.11）；`note` 超长截断 + WARNING 而非丢行（**按 code point 截断**，防 lone surrogate 反而炸事务）|
| R21 | ~~导入后统计/预算显示旧数字~~ | — | — | **已消解**：服务端业务缓存已于 2026-08-28 移除，统计/预算实时聚合，无陈旧窗口（§7.5）。重新引入读缓存时需重开此项 |
| R22 | 导入大事务阻塞同账本记账 | 中 | 中 | 余额 + epoch 合并为**同一条**末尾 UPDATE 缩短持锁窗口 + `lock_timeout` 兜底 + 5,000 行上限（§7.5）|
| R23 | 大账本导出拖慢在线 API | 中 | 中 | 游标流式读 + 逐批落盘 + 批间 `setImmediate()` 让出 event loop + 全局串行执行（§7.5 / §9.2）|
| R24 | 同名成员导致错归属 | 中 | 高 | `users.nickname` 无 UNIQUE，同名时**该行 ERROR** 而非静默取第一个（§3.3）|
| R25 | 导入时区错误致跨月漂移 | 中 | 高 | 显式按 `Asia/Shanghai` 构造 `occurred_at`，禁止依赖进程本地时区；统一用 `luxon`（§3.6）|
| **R26** | **epoch 重拉把一次导入放大成全 family 全量下行** | 高 | **高** | v0.7 的清零重拉在老账本上 = 每台设备 2.5 万行、撞 40 页硬顶。新增 `sync_epoch_floor_seq` 定点回退，重拉量与账本历史规模解耦（§5.1、§5.2）|
| **R27** | **`sync_epoch` 与 `floor_seq` 未同事务/同语句更新** | 中 | **高** | 只更新前者 → 回退到陈旧 floor（可能拉不全）；只更新后者 → 客户端根本不触发回退。强制合并进末尾那条 `UPDATE ledgers`（不变量 F2，§5.2.2 / §7.5）|
| **R28** | **`floor_seq` 被后续导入抬高，重新打开号段洞** | 中 | 高 | `LEAST(...)` 保证只减不增（不变量 F1，§5.2.2）+ 单测断言连续两次导入 floor 不上移 |
| **R29** | **formula guard 不可逆致备注被静默改写** | 中 | **高** | v1 编解码非互逆，`'备注` 自产自入后丢单引号。改 `apostrophe-v2`（首字符 `'` 无条件加一层）+ 6 行往返单测（§9.3）|
| **R30** | **错误响应无 `code`，客户端只能按 status 猜** | 高 | 中 | 两种 409、两种 410 无法区分，413 根本没有 code。新增 6 个 code + multipart 超限映射（§9.5）|
| **R31** | **导出无上限使自产自入闭环失效** | 高 | 中 | 导出单文件 5,000 行自动分片，每片独立完整可回导（§9.2）|
| **R32** | **上传/下载绕过 `request.ts`，token 过期即死** | 高 | 中 | 导出耗时数分钟后 token 常已过期，裸 `wx.downloadFile` 401 后重试仍失败。新增鉴权封装：`ensureFreshToken` + 401 重放一次 + code 映射（§6.3）|
| **R33** | **partial unique / 行锁 / advisory lock 无自动化验证** | 中 | 中 | pg-mem 不支持这些语义，而本方案的并发正确性重度依赖它们。§7.3 给出 A（建真 PG 集成测试通道，+2 人天）/ B（明确承认无验证并接受）二选一，**不允许保留"要求存在、载体不存在"的中间态** |

---

## 12. 工作量估算（v0.8 重估）

> v0.7 的 17.5 人天是在**漏掉四类工作**、且 E1 严重低估的前提下算出来的。v0.8 逐项补齐后为 **28 人天**（含 §7.3 选项 A 的真 PG 测试通道）。

| 卡 | 内容 | v0.7 | v0.8 |
|---|---|---:|---:|
| ~~E0~~ | ~~前置 · 修 `sync/pull` 的 `has_more` 无人消费~~ **✅ 已完成（2026-09-01）**（L13 落地，§5.1）| 已消耗 | 已消耗 |
| E1 | 后端 · import/export service：引入 RFC 4180 流式 parser/stringifier（**选型见下**）+ §9.3 `apostrophe-v2` 编解码 + 9 列表头指纹 + §3 全部解析规则（9 组别名、类型模糊、金额清洗、6 种日期格式、分类匹配含全角/繁简、成员匹配、归属推导）+ §3.11 九条 DB 约束校验 + 单测 | 2.5 | **5** |
| E2 | 后端 · `0020` 迁移（`sync_epoch_floor_seq` + 两表 + 三处 partial unique + 三条 CHECK）+ repo + worker（advisory lock / SKIP LOCKED / run_token / lease / 2s poll / 事件 kick）+ 阶段更新 + 僵死恢复 + 原子成功提交（含 epoch & floor 同语句）+ commit 前复核（含 `FOR UPDATE` 行锁）+ `purge-*` cron | 3.5 | **4** |
| **E2b** | **后端 · §5.2 sync-pull 增量改动**：`ledgerRepo` / `LedgerWire` 下发 `sync_epoch_floor_seq` + `LEAST` 单调性 + 服务端单测 | — | **0.5** |
| E3 | 后端 · detect（v0.8 新顺序：收流→sha→幂等→建会话→流式解析→私有产物）/commit API、export **流式 + 分片**、`/download?part` 应用流式 + `/report` 鉴权、nginx `client_max_body_size`、**两个 bind mount 的 compose + 目录初始化**、detect 频控（Redis 计数器）、审计日志 | 3.5 | **4** |
| **E3b** | **后端 · §9.5 错误码契约**：6 个新 code × 三张映射表 + `error-codes.md` + `openapi.yaml` + 客户端 mapper + multipart `FST_REQ_FILE_TOO_LARGE` 映射 | — | **1** |
| E4 | 小程序 · 设置入口、数据管理页、导入/导出表单（含"全部"日期范围） | 2.5 | 2.5 |
| E5 | 小程序 · 检测报告页、任务中心、阶段型模拟进度（`server_now` 基准）、轮询恢复、完成卡、**多分片逐个 shareFileMessage**、成功后 `triggerOnMutation()` | 2.5 | **3** |
| **E5b** | **小程序 · 上传/下载鉴权封装**（`ensureFreshToken` + 401 重放一次 + errMsg/code 映射，§6.3）| — | **1** |
| **E5c** | **小程序 · §5.2 客户端改动**：epoch 记录升级为 `{epoch, floorSeq}`（含旧格式兼容）+ diff 后 `min(local, floor)` 回退 + 四条 L13 不变量回归 + 单测 | — | **1.5** |
| E6 | QA · iOS / Android / PC 微信、后台切换、断网、并发、过期、重试幂等、CSV 注入、**自产自入闭环（含分片）**、权限矩阵、**老账本（>2 万条）导入后多端 sync 收敛验证** | 3 | **3.5** |
| **E7** | **真 PG 集成测试通道**（§7.3 选项 A）：compose profile + vitest project + 约束/并发/锁顺序用例 | — | **2** |
| **合计** | | **17.5** | **28** |

> **E1 为什么从 2.5 涨到 5**：原估值只覆盖了"写一个 CSV 解析器"，但 §3 是本方案信息密度最高的一节 —— 9 组列名别名、3 类类型模糊匹配、5 步金额清洗、6 种日期格式 + 时区构造、5 步分类匹配（含全角/繁简归一与跨 type 专用文案）、4 分支成员匹配、3 分支归属推导、9 条 DB 硬约束校验，每一条都要配单测（§3.11 明确要求"逐条覆盖"）。再加上 `apostrophe-v2` 的 6 行往返断言与表头指纹。这是一整个解析层，不是一个函数。
>
> **CSV 库选型是 E1 的前置决策**：`server/package.json` 当前**无任何 CSV 依赖**（v1 CLI 删除后 `csvEscape` 也一并消失，§9.3）。需要一个支持**流式 + quoted multiline** 的 parser。选型约束：体积可控、无原生扩展（生产是 alpine 容器）、维护活跃。建议在 E1 动工前用半天做选型 spike 并记入决策。
>
> **E7 若选 §7.3 的方案 B（不建通道）**：合计降为 **26 人天**，但必须把 R33 作为已接受风险写入验收记录，且三处 partial unique 与 commit 行锁的正确性只由 code review 保证。

> **释放策略与工作量的关系**：导出相关部分（E1 的导出侧、E2 导出 worker、E3 导出流式/download、E4/E5 导出页面、E5b、E3b）**不受客户端版本覆盖率门槛约束，可先行发布**；但**不等于可以少做**——§14 列出了导出发布的 5 项必做 DoD。仅导入入口（含 E2b/E5c 的 floor 链路）需等覆盖率达标。

---

## 13. 关键 API 兼容性

| API | 最低基础库 | 项目 3.8.12 | 用途 |
|---|---|---|---|
| `wx.chooseMessageFile` | 2.5.0 | 支持 | 从客户端会话选择 CSV |
| `extension` 参数 | 2.6.0 | 支持 | 限制 `.csv` |
| `wx.uploadFile` | 1.0.0 | 支持 | 上传 CSV；支持进度回调 |
| `wx.enableAlertBeforeUnload` | 2.12.0 | 支持 | 上传阶段降低误返回概率 |
| `wx.downloadFile` | 1.0.0 | 支持 | 下载完成后的 CSV 到临时路径 |
| `wx.shareFileMessage` | 2.16.1 | 支持 | 转发本地 / 临时文件到聊天 |
| `getFileInfo` SHA-256 | 1.4.0 | 支持 | 文件完整性校验 |

---

## 14. 下一步

### 14.1 动工前必须完成（spike / 决策）

1. **真机 spike（导出交付命门）**：验证 `wx.chooseMessageFile` 选择 CSV 与 `wx.shareFileMessage` 转发 CSV 在 iOS / Android 的实际表现（历史上 .csv 分享存在端差异，须在动工前证伪风险）。**分片场景一并验证**：连续多次 `shareFileMessage` 是否会被微信限频或折叠。
2. **基建 spike**：验证 nginx `client_max_body_size 2m` 生效后 1MB CSV 上传通路完整（multipart 保持 2MB 不改），以及 5,000 行 detect 的实测端到端耗时稳定落在 `proxy_read_timeout 60s` 内。
3. **老账本重拉 spike（P0 相关）**：在 staging 造一个 2 万条 + 历史软删的账本，实测 §5.2 定点重拉的实际拉取量与耗时，并观察微信 storage 占用是否逼近 10MB。**这是 `floor_seq` 方案的证伪前提** —— 若定点重拉仍不可接受，需要在动工前改设计而不是上线后补救。
4. **CSV 库选型**（半天）：流式 + quoted multiline + alpine 友好，见 §12 E1 备注。
5. **决策 §7.3 的 A/B**：真 PG 集成测试通道做还是不做。不做就把 R33 写进验收记录，**不允许悬空**。

### 14.2 释放策略

**导出先行发布**（只读、无 epoch 依赖），**导入入口等客户端 `floor_seq` 消费版本覆盖率达标后开放**（§5.1、§5.2.4）。

> ⚠️ **"导出先行"不等于"导出可以少做"**。以下 5 项**全部属于导出侧**，是导出发布的 DoD，一项都不能推迟到导入阶段：
>
> | # | 项 | 出处 | 不做的后果 |
> |---|---|---|---|
> | 1 | `apostrophe-v2` 可逆编码 + 6 行往返单测 | §9.3 / R29 | 导出的备注被静默改写，且用户在导回时才发现 |
> | 2 | 单文件 5,000 行分片 | §9.2 / R31 | 大账本导出物永远导不回，闭环承诺失效 |
> | 3 | 上传/下载鉴权封装 | §6.3 / R32 | 导出完成后 token 已过期，"发送到微信"必定失败且无法重试 |
> | 4 | 导出游标的时区边界 + 微秒安全编码 | §7.5 / R25 | 首末日各错 8 小时的记录；同微秒记录跨页漏读 |
> | 5 | `from`/`to` 可选 + 错误码契约 | §6.2 / §9.5 / R30 | "全部"这一默认选项无法表达；错误只能按 status 猜 |

### 14.3 后续产出

6. 输出正式技术方案 `data-import-export-tech-spec.md`，冻结：`0020` 迁移三部分（含 `sync_epoch_floor_seq`）、worker 执行模型、API 与错误码、事务模型、commit 前复核清单（含 `FOR UPDATE` 行锁）、§9.3 编解码、§5.2 的 F1/F2 不变量。
7. 设计 `settings/data-management` 页面高保真交互状态（含多分片完成卡）。
8. 拆成 E1~E7 七张卡并排期。

---

## 15. 修订记录

### v0.8（2026-09-02）· 第四轮 code-level review · 撤销冻结

背景：v0.7 标记"方案冻结"后，第四轮评审逐条核对 `server/src`、`miniprogram/services`、`infra/` 现状，发现 **3 项 P0 + 9 项 P1 + 9 项 P2**，其中两项（错误码契约缺失、formula guard 不可逆）会直接导致线上数据损坏或违反项目铁律，冻结状态因此撤销。

> **本轮确立的文档边界**：`sync-pull-pagination-design.md`（L13）已完成、不再修订。本方案所需的 sync-pull 改动全部收敛到本文档 **§5.2**（新增章节），L13 只作引用来源。理由见 §5.2 开头。

#### 一等修订（P0）

| # | 问题 | v0.7 | v0.8 决策 | 影响章节 |
|---|---|---|---|---|
| 1 | **全文只写裸 HTTP status，无 `ErrorCode`** | `409` / `410` / `413` / `429` 直接出现在 API 定义里 | 违反 `ErrorCode.ts` 铁律"客户端依 code 判分支"；且现有枚举中两种 409 无法区分、`410` 只有邀请码语义、**`413` 根本不存在**。新增 §9.5：6 个新 code × 三张映射表 + `FST_REQ_FILE_TOO_LARGE` 映射 + `data_jobs.error_code` 取值域。**新增 E3b 卡 1 人天** | §4.2 §4.3 §6.2 §7.3 §7.6 §9.5 R30 |
| 2 | **`apostrophe-v1` 编解码不可逆，静默损坏数据** | "危险值加引号" + "自产文件无条件剥一层" | 两条规则非互逆：`'备注` 导出时判定为安全不加防护，导回时被剥掉单引号。改 **`apostrophe-v2`**：首字符为 `'` 时**无条件**加一层；6 行往返单测强制 | §0 §9.3 R29 |
| 3 | **导入后重拉量级算错**（把导入行数当重拉量）| "5,000 条 ≈ 10 页 × 500，秒级收敛" | epoch diff 实际触发 `since=0` **全量重拉**（含软删行），老账本 2.5 万行**撞 `MAX_PULL_PAGES=40` 硬顶**，且 family 内每台设备各一次。新增 **`ledgers.sync_epoch_floor_seq`**，回退到 `min(local, floor)` 而非 0，重拉量与账本历史规模解耦；`LEAST` 保证 floor 只减不增 | §5.1 **§5.2（新增）** §7.3 §7.5 R26 R27 R28 |

#### 二等修订（P1）

| # | 问题 | v0.8 决策 | 章节 |
|---|---|---|---|
| 4 | detect 幂等的执行顺序自相矛盾（先建会话 vs 先算 sha），且弱网重发主场景走不到幂等 | 重排为 收流→sha→查 ready→命中直接返回（不建会话）→未命中再建 `detecting`；显式承认收流阶段不受并发保护 | §4.2 §4.4 §7.4 |
| 5 | "记账人未匹配→WARNING"与"同名→ERROR"后果相同却分级不同 | 按文件来源分级：**自产文件未匹配 = ERROR**，外部 CSV = WARNING | §3.3 §3.10 |
| 6 | 导出不设上限 + 导入 5,000 行 ⇒ 自产自入闭环在大账本上不成立 | 导出**单文件 5,000 行自动分片**，每片独立完整可回导；`files[]` 数组下发 | §2.3 §6.2 §6.3 §9.2 R31 |
| 7 | `wx.uploadFile/downloadFile` 绕过 `request.ts`，token 过期即死且无法重试 | 新增上传/下载鉴权封装：`ensureFreshToken` + 401 重放一次 + code 映射。**新增 E5b 卡 1 人天** | §6.3 R32 |
| 8 | `/report` 保留 24h 与"会话行随任务终态清理"互相拆台 | 会话行保留 24h（新增 `report_expires_at`，与 15 分钟 `expires_at` 解耦），只删行产物；端点**不迁**到 `data_jobs`（detect 阶段就要能下载） | §7.3 §7.4 §7.6 |
| 9 | worker 并发模型两处矛盾（§7.5 全局串行 vs §9.2 "再收紧为单并发"），poll 间隔未定义 | 冻结：全局串行 + `POLL_INTERVAL_MS=2000` + commit/创建后事件 kick + 单队列不拆 import/export | §7.2 §7.5 §9.2 |
| 10 | 导出游标日期边界无时区、cursor 精度不足 | SQL 显式 `AT TIME ZONE 'Asia/Shanghai'`；cursor 用微秒安全编码（重蹈 COSTRA-154 的风险）；统一用 `luxon` | §7.5 §9.2 R25 |
| 11 | `/export-jobs` 的 `from`/`to` required 与"默认全部"冲突 | 改可选，NULL = 不加谓词；文件名用实际数据首末日填充 | §6.2 |
| 12 | `data_jobs` 的 type 与入参字段无一致性约束 | 补三条 CHECK：type↔字段、type↔stage、日期顺序 | §7.3 |

#### 三等修订（P2 · 一致性与遗漏工作量）

- **`csvEscape` 引用已失效** → v1 CLI 删除后 `server/src` 无任何 CSV 工具，E1 需从零引入；文档明示不要按图索骥（§9.3）。
- **绝对 URL 硬编码 `costra.cloud`** → 全部改相对路径，由客户端拼 `env.ts` baseURL（§4.2 §6.2）。
- **CSV 库选型未定** → 列为 E1 前置 spike（流式 + quoted multiline + alpine 友好）（§12 §14.1）。
- **两个 bind mount 的基建成本被漏计** → compose prod/staging + `05-start-stack.sh` 目录初始化与权限，计入 E3（§7.4 §12）。
- **`resolveDefaultSharedType` 需从 `entryService` 抽为可复用纯函数**（导入不走 entryService）（§12 E1）。
- **"解析完即删原始 CSV"是无操作** → 改为"全程不落盘"，避免后人实现一个不存在的删除步骤（§7.4）。
- **note 截断按 UTF-16 会切断代理对** → 必须按 code point（`Array.from`），否则 lone surrogate 写入 PG 会把柔性降级变成整批事务失败（§3.11 R20）。
- **真 PG 集成测试通道不存在** → v0.7 要求"并发约束测试放真实 PG"却无载体（与 v0.6 修掉的"审计无载体"同构）。给出 A/B 二选一并计入 E7，**禁止悬空**（§7.3 R33）。
- **`sync_epoch` 与余额 UPDATE 必须合并为同一条语句** → 分两条会翻倍热点行锁窗口，且全 transfer 导入时 `delta=0` 跳过 UPDATE 会连带跳过 epoch（§7.5 R27）。

#### 工作量

**17.5 → 28 人天**（选项 B 则 26）。主因：E1 从 2.5 涨到 5（§3 是一整个解析层而非一个函数），新增 E2b/E3b/E5b/E5c/E7 五张卡。详见 §12。

---

### v0.7（2026-09-02）· 同步 L13 落地与三轮 review 收尾

背景：`sync/pull` 的 `has_more` 消费（L13）已按 `docs/design/sync-pull-pagination-design.md` **v0.8** 于 2026-09-01 全量落地（C1 分页循环 + C2 批量落盘 + E1 `ledgers.sync_epoch` + R5 月索引串行队列，migration `0019`），本方案的 E0 硬前置随之关闭。三轮 review 核对了落地后的工程状态，推翻了 v0.6 的若干残留口径。

| # | 问题 | v0.6 | v0.7 决策 | 影响章节 |
|---|---|---|---|---|
| 1 | **`has_more` 前置缺陷已修复但文档仍按"待修"叙述** | §0/§5.1/§12/§14/R19 均写"必须先修 / 正式方案待设计" | 全部改写为"已修复（L13 · v0.8 落地）"；E0 卡标记已完成，剩余工作量重算为 **18 人天** | §0 §5.1 §9.1 §12 §14 R19 |
| 2 | **导入数据到达路径描述错误** | "导入写入的 entries 天然带上更大的 `change_seq`，自动落在下一次 pull 的窗口内" | 导入事务 `sync_epoch + 1` → 客户端前置比对不一致 → **清零 watermark 全量重拉**（5,000 条量级 ≈ 10 页 × 500，秒级）；正常增量窗口路径仅适用于非批量写入 | §5.1 |
| 3 | **`data_jobs` 迁移编号冲突** | `0019_data_jobs.sql` | `0019` 已被 `ledgers.sync_epoch` 占用 → 改 **`0020`** | §7.3 §12 |
| 4 | **commit 复核是纯 SELECT，复核→写入间存在 TOCTOU** | "显式复核 active 成员 + 分类未软删" | 复核 SQL 改 **`SELECT ... FOR UPDATE`** 锁成员行（操作者 + 所有 distinct `created_by`，`ORDER BY user_id` 固定加锁顺序），对齐 `lockActiveMember` 语义；明示锁顺序不变量 `family_members → entries → ledgers` | §7.5 R12 |
| 5 | **导出游标语义错误** | "复用 `entryService.list` 的 cursor 语义"（`updated_at DESC, id DESC`）| **专用导出游标**：`occurred_at ASC, id ASC`，过滤 `deleted_at IS NULL` + 日期范围，cursor 编码 `occurred_at|id` | §7.5 |
| 6 | **释放策略未定义** | 导入导出并列排期 | **导出先行发布**（只读、无 epoch 依赖）；**导入入口等客户端 epoch 消费版本覆盖率达标后开放**（决策 16 仍是唯一剩余前置） | §5.1 §12 §14 |
| 7 | 导出范围表述不一致 | §0"按账本导出全部流水" vs §6/§9.2"日期范围" | 统一为"按账本 + 日期范围导出范围内全部流水" | §0 |
| 8 | **v1 CLI 脚本成为过期旁路** | §0 决策"抽 service 后保留 CLI 作运维应急入口"；`import-entries.mts` 为配合 L13 还做过 `sync_epoch` 改造 | **两个脚本整体删除**（旧 15 列格式、手写 parser、无 v2 约束，保留即旁路）；E1 取消 CLI 适配（3 → 2.5 人天），合计 18 → 17.5；应急导数走 `psql-exec.sh` 直连 SQL | §0 §10 §12 §14 |

同步更新的机制引用（结论不变、论据换新）：`applyServerChanges` → `applyServerEntriesBatch`（C2）；`entry:__index` 实体库重建 → 键枚举重建（C2 已废除该索引）；§9.1 全链路推导表中"客户端本地库 O(n²)"与"sync 单轮 200/500"两行更新为 L13 后现状（1MB/5,000 行结论不变，且更稳）。

### v0.6（2026-08-27）· 收敛二轮代码级 review

第二轮评审逐条核对了 `miniprogram/` 与 `server/` 现状，推翻了 v0.5 的两处判断、补齐四处 P0。

#### 一等修订（P0）

| # | 问题 | v0.5 | v0.6 决策 | 影响章节 |
|---|---|---|---|---|
| 1 | **规模上限只按单侧推导** | `5MB / 20,000 行`（仅考虑 PG 事务时长）| 降为 **`1MB / 5,000 行`**，按 nginx 默认体 / multipart 全局配置 / proxy 超时 / 客户端本地库 / sync 吞吐**五重交集**取值 | §0 §9.1 |
| 2 | **导入后客户端何时看到数据未定义** | 只说"再次进入页面即可看到统计" | 明确**不做导入专用旁路**，依赖既有 sync；但必须先修 `has_more` 无人消费这一既有缺陷（新增 E0 前置卡）| §0 §5 §5.1 §12 |
| 3 | **导入绕过 entryService 导致漏缓存失效** | 未提及 | v0.6 曾要求导入 COMMIT 后自行 `invalidateLedgerCache`；**2026-08-28 服务端业务缓存整体移除后本条自动失效**（§7.5 R21），仅在未来重新引入读缓存时重开 | §0 §7.5 R21 |
| 4 | **R12「靠 FK 兜底」不成立** | "遇 FK 失效则整批回滚" | 软删模型下 FK 不会失效（成员退出只写 `left_at`、分类软删）→ commit 事务内**显式复核** active 成员 + 分类未软删 + type 匹配 | §7.5 R12 |
| 5 | **detect 未覆盖 DB 硬约束** | 未定义 | 新增 §3.11：detect 校验集必须是 `entries` 全部 CHECK/引用约束的超集；`note` 超 200 截断 + WARNING | §3.11 R20 |
| 6 | **§7.3 DDL 不可执行** | `data_jobs` 引用了 76 行后才创建的表，且 `detect_id` 漏 UNIQUE | 调整建表顺序（sessions 先）+ 去掉 sessions→jobs 的反向 FK + 补 `detect_id UNIQUE` | §7.3 |

#### 二等修订（P1）

| # | 问题 | v0.6 决策 | 章节 |
|---|---|---|---|
| 7 | preamble 污染 Excel 首行（首要场景是"在 Excel 核对"）| **删除 preamble**，回归纯 RFC 4180；格式识别改用 **9 列表头指纹** | §2.1 §2.1.1 §2.4 §9.3 |
| 8 | 导入侧时区完全未定义（UTC 解析会跨月漂移）| 显式按 `Asia/Shanghai` 构造 `occurred_at` | §3.6 R25 |
| 9 | "支出缺省个人"与线上按 family kind 推导冲突 | 改为**沿用 `resolveDefaultSharedType`**；共同家庭追加汇总级 WARNING；个人账本强制 `personal` | §0 §3.8 |
| 10 | 转账分类名写错（系统无"转账"分类）| 修正为 `储值` / `账户互转` / `赊销`；§3.7 匹配**必须带 type 维度** + 跨 type 专用错误文案 | §2.3 §2.4 §3.7 |
| 11 | 导出无任何规模上限，可拖慢在线 API | 要求**流式生成**：游标分页 + 逐批落盘 + 批间 `setImmediate()` | §7.5 §9.2 R23 |
| 12 | 大事务持 `ledgers` 热点行锁阻塞同账本记账 | 余额 UPDATE 挪到事务末尾 + `lock_timeout` 兜底 | §7.5 R22 |
| 13 | 同名成员静默取第一个（`users.nickname` 无 UNIQUE）| 同名 → **该行 ERROR**，不静默错归属 | §0 §3.3 R24 |
| 14 | 默认子分类用 `is_direct_default` 语义不精确 | 改用 `is_parent_default`（语义正是"点父级时的默认子"，有唯一索引），与 `findFallbackCategoryId` 一致 | §3.7 |

#### 三等修订（P2/P3 · 一致性与收尾）

- **`X-Accel-Redirect` 与"nginx 不挂载"自相矛盾** → 明确选**应用层流式返回**，nginx 不挂载导出目录（§7.4 §9.2 R6）。
- **`data_job_status.expired` 无写入方** → 从 ENUM 删除；"文件已过期"是客户端按 `file_expires_at` 派生的展示态（§7.3 §7.4）。
- **detect 并发未约束**（v0.5 明确"不占并发槽"，连点可并发 5 个解析打满单核）→ 新增同用户单 `detecting` 唯一索引（§4.4 §9.1）。
- **频控计数源会被自己的清理任务擦掉** → 改用独立 Redis 计数器，与 `cache:` 域分开（§9.1）。
- **detect 无幂等** → 同 `(user, ledger, sha256)` 的 ready 会话在有效期内复用，不重复解析（§4.2）。
- **问题报告 CSV 生命周期未定义** → 与导出文件同寿保留 24h（导入成功后仍可查 warning 明细）（§7.4）。
- **`stage_started_at` 用客户端时钟算 elapsed** → 响应附带 `server_now`；τ 按阶段设定而非固定 8s（§7.2 §7.6）。
- **字段命名不一致** → `download_expires_at` 统一为 `file_expires_at`（§6.2 §7.6）。
- **`stage` 用裸 TEXT** → 改 `data_job_stage` ENUM，与同表 type/status 一致（§7.3）。
- **审计无载体**（仓库无审计表/服务）→ 新增 §9.4 明确走结构化 pino 日志、不建表，并计入 E3 工作量。
- **`row` 口径歧义**（quoted multiline 下物理行 ≠ 逻辑记录）→ 统一为逻辑记录序号，文案用"第 N 条记录"（§4.2）。
- **重复列名未定义** → 映射到同一标准列的重复表头 → ERROR，不静默取第一个（§3.1）。
- **`.CSV` 大写后缀未定义** → 后缀比对大小写不敏感（§9.1）。
- **CLI 行为反转风险** → 归属默认与金额精度处理做成 service 入参，CLI 保留 v1 默认值（§10.1）。
- **`client_ref_id` 的隐藏依赖** → 它同时是客户端本地库主键，不只是幂等键，文档明示防被当"可选优化"删掉（§3.9）。
- 风险清单从 R19 扩到 **R25**；工作量 16.5 → **19 人天**（新增 E0，E2/E3/E6 各 +0.5）。

#### 被推翻的上一轮 review 提议（记录以免重复走弯路）

二轮 review 初稿曾提议"导入后按 `affected_months` 定向失效本地月缓存"。**该方案不可行且已废弃**：`listMonthEntries` 在月索引缺失时会从 `entry:__index` 实体库 `rebuildEntryMonthIndex`，sync 已拉回的实体仍在本地 → 重建后非空 → 走不进 `_loadEntries` 的空态分支 → `_hydrateRemoteMonthEntries` 永不触发。要真触发就得删该月 entry 实体，会与 outbox pending op 冲突。**既有 sync 已保证最终一致，正确做法是修 sync 的 `has_more` 根因，而不是为导入加旁路。**（§5.1）

---

### v0.5（2026-08-27）· 收敛首轮 review 的 5 项 P0

基于代码级适配性评审（核对 `server/` 现状），本版修订以下五点：

| # | 问题 | v0.4 | v0.5 决策 | 影响章节 |
|---|---|---|---|---|
| 1 | 进度模型与大事务矛盾 | 声称"真实百分比 = current/total"，但大事务内进度提交前不可见 | 进度非必须；改**阶段型渐近模拟**，服务端删 `progress_current/total`、加 `stage_started_at`；保留导入单大事务 | §0 §7.2 §7.3 §7.6 §8 |
| 2 | detect 全量行存 Redis 不可行 | 解析结果存 Redis TTL 15min | 元数据落 PG `import_detect_sessions`，规范化行落 **server-only 私有磁盘**（压缩 NDJSON），Redis 不参与 | §7.3 §7.4 §4.2 §9.1 |
| 3 | 导入任务不可裸重试 | attempts<3 复位重跑（会重复导入） | detect 预生成 `entry_id`+`client_ref_id`；entries+余额+`job=succeeded` **同事务提交**；`run_token`/lease 防覆盖；仅瞬态错误重试 | §3.9 §7.3 §7.5 |
| 4 | CSV Formula Injection 缺失 | 仅 RFC 4180 引号转义 | 所有导出单元格走 **`apostrophe-v1` 可逆防护 + quote-all**；文件名/header 控制字符防护 | §2.1 §2.4 §9.2 §9.3 |
| 5 | `#` 注释头解析未定义 | 自由文本 `# Costra 导出 · ...` | 引入严格机读 Costra preamble（**v0.6 已改为删除 preamble + 表头指纹**）| §2.1 §2.4 |

**顺带修正的 P1/P2/P3 落差**：
- 导出并发只有应用层 check → 补 DB 唯一索引 `uq_data_jobs_active_export_per_user`（§7.3 §9.2）。
- detect 端点无频控 → §9.1 补 detect 单独频控。
- 导出时区用进程本地 `Date` → §9.2 明确显式 `Asia/Shanghai`。
- ID 生成 v4/v7 混用 → 统一走 `newId()`（v7），DB `gen_random_uuid()` 仅兜底（§7.3）。
- 现有手写逐物理行 parser 不支持 quoted multiline → §2.1 要求引入标准 CSV parser（E1 工作量已含）。
- 完整错误报告不再塞进 HTTP 响应 → 汇总 + 各前 100 条预览 + `/report` 下载端点（§4.2 §7.6）；`raw` 整行原文删除，改 `field/code/value_preview`（隐私）。

> v0.5 的"multipart 提限到 5MB""默认子分类用 `is_direct_default`""20,000 行上限"三项已被 **v0.6 推翻或修正**。

### v0.4
补齐任务持久化 / 进度百分比 / 文件存储与过期策略。
