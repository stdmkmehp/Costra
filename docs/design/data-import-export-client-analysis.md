# 客户端账本数据导入 / 导出方案

> 状态：**v0.6 · 方案冻结**（v0.6 收敛二轮代码级 review：规模上限全链路取交集 / 客户端衔接改为修 sync 根因 / commit 前复核 / detect 覆盖 DB 硬约束 / 删除 preamble）
> 2026-08-28 后置修订：服务端 Redis 业务缓存已回滚移除，§7.5 的「导入缓存失效」要求随之作废（R21 消解）。
> 前置文档：`docs/design/data-export-format.md`（v1 脚本版 · 已被本文档取代部分口径）
> 触发背景：v1 只支持运维在服务器上跑脚本；本方案把导入 / 导出下沉到小程序端用户自助能力。
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
> **v0.5 保留不变的决策**：阶段型模拟进度（§7.2）、detect 产物落 server-only 私有磁盘（§7.4）、导入原子幂等重试（§7.5）、CSV Formula Injection 防护（§9.3）。

---

## 0. 已冻结决策

| 决策项 | 结论 |
|---|---|
| 载体格式 | **只支持 CSV**；不做 JSON / XLSX |
| 导入选文件 | `wx.chooseMessageFile` 从微信聊天中选择 CSV |
| 导出交付 | `wx.downloadFile` 下载临时文件后，使用 `wx.shareFileMessage` 转发到微信聊天 |
| 导出范围 | **按账本导出全部流水**，包含账本内所有成员创建的记录 |
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
| 客户端数据到达 | **不做导入专用推送/旁路**；依赖既有 sync（周期 / 切页 / mutation）。**前置依赖：先修 `has_more` 无人消费**（§5.1）|
| 导出文件 | 存 `/data/exports/<yyyy-mm>/<job_id>.csv`；保留 24h；下载走应用层鉴权 + 应用流式返回（不走 nginx） |
| CSV 安全 | 所有导出（含错误报告）单元格走 **Formula Injection 防护**（`apostrophe-v1` 可逆编码 + quote-all，§9.3） |
| 文件格式 | **纯 RFC 4180**（UTF-8 BOM + CRLF + quote-all）；**无 preamble / 无注释行**；Costra 格式由 9 列表头指纹识别（§2.1） |
| 规模上限 | 单次导入 ≤ **5,000 行**且 ≤ **1MB**（§9.1）；上限为全链路交集，非单侧推导 |
| 过期清理 | 新增宿主机 cron `maintenance.sh purge-exports` + `purge-import-staging`（孤儿产物兜底）；任务元数据保留 30 天 |
| 页面入口 | `我的 → 设置 → 账本导入 / 导出` |
| v1 CLI 脚本 | 核心逻辑抽成 service 后**保留**，作为运维应急入口 |
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
| 声明 Formula 防护编码 | **由指纹推定**：判定为 Costra 自产 → `formula-guard = apostrophe-v1`（当前唯一实现）；否则 → `none`。§9.3 的解码规则不变。 |

判定规则（严格、无歧义）：

1. 读取第一条逻辑记录作为表头，对每个列名做 trim + 小写归一。
2. 若归一后的列名集合**恰好等于** `{日期,时间,类型,金额,一级分类,二级分类,归属,记账人,备注}` → `is_costra_export = true`，`formula_guard = apostrophe-v1`。
3. 否则 → `is_costra_export = false`，`formula_guard = none`，走 §3.1 别名映射解析外部 CSV。
4. **不识别任何注释语法**：以 `#` 开头的行一律当普通记录（符合 RFC 4180）。

> **兼容性说明**：若已有 v0.5 preamble 的文件流入（本功能上线前不存在此类文件，仅为防御），第一条逻辑记录会是 `#costra-csv;...` 单列记录，表头指纹不匹配且缺少必填列 → 检测阶段返回 ERROR「文件格式不识别：首行不是表头」。不做静默跳过，避免为不存在的历史包袱写兼容分支。

### 2.2 文件命名

```text
Costra_{账本名}_{起始日期}至{结束日期}_{导出时刻}.csv

示例：
Costra_我的家庭_2026-01-01至2026-07-21_20260721T173900.csv
```

规则：
- 账本名中的 `/`、`\`、`:`、`*`、`?`、`"`、`<`、`>`、`|` 替换为 `_`。
- 文件名即微信原生文件消息的主要可识别信息，必须包含 `Costra + 账本名 + 日期范围`。
- 导出时刻用于避免同一区间多次导出发生同名覆盖。

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
3. 同一格式 CSV 既能导出也能导入回（但不保证精确还原 ID）

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
| `记账人` | 归属当前导入操作者 | 正常入库 + WARNING |
| `备注` | 留空 | 正常入库 |

### 3.3 「记账人」列的匹配逻辑

导入时 `记账人` 列是**昵称文本**，需要映射到 `users.id`。匹配规则：

```text
1. 在目标账本所属家庭的活跃成员中，按 nickname 精确匹配（不区分大小写）
2. 若匹配到唯一成员 → 使用该成员的 user_id 作为 created_by
3. 若匹配到多个同名成员 → 【该行 ERROR】：记账人"小赵"在本家庭存在多个同名成员，无法确定归属
4. 若未匹配 → 归属当前导入操作者 + WARNING
5. 若列不存在或行值为空 → 归属当前导入操作者
```

> **规则 3 为什么是 ERROR 而不是 WARNING**（v0.6 修正）：`users.nickname` **没有 UNIQUE 约束**，家庭内昵称重复是完全可能的。v0.5 的"取第一个匹配（按 join 时间排序）+ WARNING"意味着**静默把 A 的支出记到 B 名下** —— 在家庭共享账本里这是实质错账，会直接污染成员统计（成员统计按 `entries.created_by`），且用户几乎不可能从一条 warning 里察觉。跳过该行并明确报错，引导用户先改昵称或删除该列，是唯一安全的处理。

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
- 记账人未匹配到家庭成员 → 归属当前导入操作者
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
| `note CHECK char_length(COALESCE(note,'')) <= 200` | `entries` | **截断到 200 + WARNING**（外部账单把"商品/交易对方"映射进备注极易超限，不应因此丢行）|
| `amount CHECK (amount > 0)` | `entries` | 金额为 0 / 负数取绝对值后仍为 0 → ERROR（§3.5 已覆盖，此处确认对齐）|
| `chk_entries_shared_type_scope`（`shared_type IS NULL OR type='expense'`）| `entries` | 收入/转账行的归属值强制置 NULL + WARNING（§3.8 已覆盖）|
| `currency NOT NULL DEFAULT 'CNY'` | `entries` | 恒填 `CNY`（不导出/不导入币种列，§2.3）|
| `category_id REFERENCES categories(id)` | `entries` | 必须解析为**真实存在且未软删**的 category_id（§3.7）；**不可依赖 FK 兜底**（见 §7.5）|
| `created_by REFERENCES users(id)` | `entries` | 必须解析为目标家庭的**活跃成员** user_id；**不可依赖 FK 兜底**（见 §7.5）|
| `name CHECK char_length BETWEEN 1 AND 16` | `categories` | 仅影响分类匹配（不创建分类），无需校验 |

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
          description: 该账本已有导入任务在执行 / 该用户已有检测在进行
        '413':
          description: 文件超过 1MB（§9.1）
        '429':
          description: detect 频控触发（§9.1）
```

#### detect 幂等：同文件重复上传复用 ready 会话（v0.6 新增）

detect 是**纯 CPU + 磁盘密集**操作。若客户端因弱网超时重发，会重复消耗单核算力。故：

- 会话建立后先算上传内容的 `file_sha256`。
- 若存在同 `(user_id, ledger_id, file_sha256)` 且 `status='ready'` 且 `expires_at > now()` 的会话 → **直接返回该会话的 DetectReport**，不重新解析。
- 索引：`import_detect_sessions (user_id, ledger_id, file_sha256)`（§7.3）。
- 注意：这不影响"重复导入产生重复记录"的既定语义（§3.9）—— 幂等只作用于 **detect 的 15 分钟有效期内**，用户主动重新检测（超期后）仍会得到新 `detect_id`。

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
  "formula_guard": "apostrophe-v1",
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
  "report_download_url": "https://costra.cloud/v1/import-detect-sessions/019.../report",
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
- `report_download_url`：指向 §7.6 的完整问题报告 CSV（应用层鉴权 · 校验属主）；本身也是导出，走 §9.3 Formula 防护。
- `expires_at`：`ready` 会话有效期 15 分钟；超时后 `commit` 返回 `410`，需重新检测。

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
          description: 该账本已有导入任务在执行
        '410':
          description: 检测报告已过期，请重新检测
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
| 确认导入阶段 | 若该账本已有 `queued` / `processing` 状态的导入任务，返回 `409` |
| 释放时机 | 任务进入 `succeeded` / `failed` 终态时释放 |
| **检测阶段 · 约束对象** | **用户**：同一用户同时只允许 1 个 `detecting` 会话，返回 `409`（v0.6 新增）|
| 用户提示 | 导入：`该账本已有导入任务正在进行，请完成后再试`；检测：`上一个文件还在检测中，请稍候` |

> **检测为什么也要限并发**（v0.6 修正）：v0.5 明确"检测不占并发槽"，配合 §9.1 的"5 分钟 5 次"频控，用户连点即可**同时**触发 5 个流式解析。生产是 2 核 4G 单进程，Node 的 CPU 是主瓶颈，5 个并发解析会直接拖垮所有在线 API 的 P99。频控限的是"一段时间内的总次数"，并发限的是"同时进行数"，两者都需要。
> 实现：`import_detect_sessions` 上加 partial unique index `(user_id) WHERE status='detecting'`；解析结束（ready/failed）即释放。异常退出导致的僵死 `detecting` 会话由 §7.4 的定时清理按 `created_at` 超时回收。

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

### 5.1 导入数据如何到达客户端（v0.6 重写 · 关键）

#### 结论：不做导入专用旁路，依赖既有 sync

Costra 客户端已有完整的增量下行机制，导入**不需要**任何新通道：

- 服务端 `entries.change_seq` 是全库单调序列，客户端按 family 维护 watermark（`GET /sync/pull?since=<change_seq>`）。
- 导入写入的 entries 天然带上更大的 `change_seq`，**自动落在下一次 pull 的窗口内**。
- 触发源已足够密集：`periodic`(60s) / `page-show`(5s debounce) / `mutation` / `network-recover` / `launch`。
- `applyServerChanges` 逐条 `reindexEntry` 增量维护月索引，明细页 `SYNC_DONE` → `_refreshIfChanged`（签名 diff）刷新。

因此 v0.6 明确：**导入完成后不推送、不新增端点、不做"清本地月缓存"之类的定向失效**。唯一动作是任务转 `succeeded` 后客户端调一次现成的 `triggerOnMutation()`，把等待从"最长 60s"缩短到"秒级"。

> **为什么不做定向失效**（推翻上一轮 review 中我方的提议）：设想"清掉受影响月份的月索引，让用户切到该月时走 `_hydrateRemoteMonthEntries` 全量拉"。这条路**不可行**：`listMonthEntries` 在月索引缺失时会 `rebuildEntryMonthIndex`，从 `entry:__index` **实体库重建**；sync 已拉回的部分实体仍在本地，重建后 `entries.length > 0`，走不进 `_loadEntries` 的空态分支，hydrate 永远不触发。要真触发就得删该月 entry 实体本身，会与 outbox pending op 冲突 —— 属于"为修问题写硬逻辑"。**既有 sync 已能保证最终一致，不该为导入加旁路。**

#### 前置依赖（必须先修）：`sync/pull` 的 `has_more` 无人消费

这是一个**独立于导入的既有缺陷**，但导入会显著放大它，必须作为前置卡修掉：

| 事实 | 位置 |
|---|---|
| 服务端已正确返回 `has_more`（多取一行判定）| `entryRepo.findEntriesByFamilySince` |
| 客户端 `syncPull` 只把 `has_more` 打进 debug 日志，**没有任何循环消费** | `miniprogram/services/sync.ts` |
| 单轮 limit = 200（协议 schema 支持 `maximum: 500`）| `syncScheduler.ts` / `routes/sync.ts` |

后果：任何单次超过 200 条的增量，都要靠 `periodic`(60s) 一轮一轮补。导入 5,000 条需 25 轮 ≈ **25 分钟**。更糟的是这期间**没有任何"数据不完整"的提示** —— 明细页的 `complete` 判定的是"本地索引条数 vs 请求 limit"，与"服务端还有没有"无关，于是页面会停在 `ready-full` 并显示**错误的月度合计**。静默错误比慢更严重。

> **这个缺陷今天就存在**：新设备首次登录一个有几千条流水的老账号，症状完全相同。导入只是让它从"低频边缘场景"变成"每次导入必然发生"。

> **跟踪与方案**：本问题已录入 `docs/follow-up/sync-p2-improvements.md` **L13**（含完整问题描述、设计约束与验收口径）；本节下述修复要点仅为方向草案，**正式解决方案另行设计**。

#### 为什么不需要"按月拉取"

`_hydrateRemoteMonthEntries`（`/entries` 游标分页拉完整月）只在"本地该月完整为空 且 remote-empty 未确认"时触发，是为**冷启动/清缓存**场景设计的兜底，不是增量通道。导入后走 sync 增量即可，两条路径职责清晰，不应混用。

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
              required: [ledger_id, from, to]
              properties:
                ledger_id: { type: string, format: uuid }
                from: { type: string, format: date }
                to: { type: string, format: date }
      responses:
        '202':
          description: 导出任务已创建
```

任务完成结果：

```json
{
  "job_id": "019...",
  "status": "succeeded",
  "result": {
    "entry_count": 1280,
    "file_name": "Costra_我的家庭_2026-01-01至2026-07-21_20260721T173900.csv",
    "file_size": 248830,
    "sha256": "...",
    "download_url": "https://costra.cloud/v1/data-jobs/019.../download",
    "file_expires_at": "2026-08-06T16:00:00+08:00"
  }
}
```

### 6.3 下载与转发

```ts
const downloadRes = await wx.downloadFile({
  url: job.result.download_url,
  header: { Authorization: `Bearer ${accessToken}` },
});
if (downloadRes.statusCode !== 200) throw new Error('下载失败');

await wx.shareFileMessage({
  filePath: downloadRes.tempFilePath,
  fileName: job.result.file_name,
});
```

按钮的状态文案：

| 状态 | 主按钮 | 辅助文案 |
|---|---|---|
| queued / processing | `后台生成中`（禁用） | `可以离开此页面，稍后回来查看` |
| succeeded · 未下载 | `发送到微信` | `共 1,280 条 · 243 KB · 文件保留 24 小时` |
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
- **下载不依赖创建任务时的那次会话**：`download_url` 指向 `GET /v1/data-jobs/{id}/download`，只要用户带合法 JWT 且是 job 属主、且文件未过期，任何时候都能下载并转发。

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

**是。新增一张统一任务表 `data_jobs`（迁移编号接 `0019_data_jobs.sql`），导入和导出共用。**

采用与 `recurring_rules` 一致的"状态字段自持久化"范式。

```sql
-- 0019_data_jobs.sql（草案 · v0.6）
--
-- ⚠️ 建表顺序：import_detect_sessions 必须先建（data_jobs.detect_id 引用它）。
--    v0.5 草案把 data_jobs 放前面并引用后面才创建的表，DDL 直接报错。
--    两表不做互相 FK：sessions.job_id 只作普通列（避免循环依赖 + 插入顺序死锁）。

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
-- 1) 检测会话表：元数据落 PG（规范化行数据落私有磁盘，见 §7.4）
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
    formula_guard    TEXT,                                    -- apostrophe-v1 / none

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
    expires_at       TIMESTAMPTZ NOT NULL,                    -- ready 后 15 分钟
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
-- 2) 统一任务表（导入 / 导出共用）
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
    -- 导出入参
    date_from        DATE,
    date_to          DATE,

    -- 结果摘要（JSONB：imported/skipped/error_count/warning_count/entry_count 等）
    result_summary   JSONB,

    -- 产物文件（仅 export succeeded / import 错误报告）
    file_path        TEXT,                                    -- 服务器本地绝对路径
    file_name        TEXT,                                    -- 下发给客户端的文件名
    file_size        BIGINT,
    file_sha256      TEXT,
    file_expires_at  TIMESTAMPTZ,                             -- 文件失效时间（见 §7.4）

    -- 失败信息
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

    version          INTEGER NOT NULL DEFAULT 1
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

> **DB migration 双写约定**：`0019_data_jobs.sql` 落地时必须同步在 `server/test/setup.ts` 内嵌 DDL 里对齐两张表与索引；pg-mem 不支持的 partial unique index（`WHERE ... status IN (...)` / `WHERE status='detecting'`）在测试环境跳过，约束由真实 PG 兜底 —— 因此**并发约束的行为测试必须放到真实 PG 的集成测试**，不能只靠 pg-mem。

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
| **用户上传的原始 CSV（导入源）** | 流式解析完**即删**，不落盘长期保留 | 单次请求内，秒级 | 请求结束即释放 |
| **导入检测元数据** | PG `import_detect_sessions` | ready 后 15 分钟；已 consumed 则跟随任务生命周期 | 定时清理 + cron 兜底 |
| **导入规范化行产物** | **server-only** `/data/import-staging/<yyyy-mm>/<detect_id>.rows.ndjson.gz` | 同检测会话；任务终态后删 | 应用清理 + `purge-import-staging` cron |
| **导入问题报告 CSV** | **server-only** `/data/import-staging/<yyyy-mm>/<detect_id>.report.csv` | **24 小时**（v0.6：与导出文件同寿，见下）| `purge-import-staging` cron |
| **导出 CSV** | 服务器本地 `/data/exports/<yyyy-mm>/<job_id>.csv` | **24 小时** | `purge-exports` cron |

> 检测行数据不进 Redis：生产 Redis 512MB + `allkeys-lru` + AOF everysec，把完整账单塞进单 key 会挤掉缓存/会话、产生大 key 延迟、写进 AOF、故障时让已完成检测报告消失。故落 **server-only 私有磁盘**，Redis 不参与。

> **问题报告为什么保留 24h 而不随行产物一起删**（v0.6 修正）：v0.5 只规定"导入成功后删除规范化行产物"，未定义 report 的去留。而"导入成功但有 7 条 warning，想看看具体是哪些记录被降级了"是完全自然的需求 —— 若 report 随任务终态即删，用户点开只会得到 404。故 report 与导出文件同口径保留 24h；它只含行号/字段名/值片段（不含整行原文），隐私风险可控。

#### 检测阶段：流式解析 → 规范化行落私有磁盘

1. 创建 `detecting` 会话（PG 插一行；`uq_detect_sessions_active_per_user` 保证同用户单并发，§4.4）。
2. `wx.uploadFile` 输入流**直接进标准 CSV parser**（须支持 RFC 4180 quoted multiline，见 §2.1；不复用现有手写逐物理行 parser）。
3. 预加载目标家庭活跃成员映射（nickname→user_id）与**按 type 分组的**分类映射（§3.7），避免逐行查库。
4. 流式解析、校验、规范化每一行；合法记录写入 `.tmp` 压缩 NDJSON 产物，字段含：`row_no / entry_id(v7,预生成) / client_ref_id / occurred_at / amount_cents / type / category_id / created_by / shared_type / note`。
5. 完整问题（错误 + warning）写另一份报告文件；响应只回汇总 + 各前 100 条（§4.2）。
6. 完成后算产物 SHA-256，**原子 rename** `.tmp → 正式名`，会话置 `ready`、写汇总与 `report_preview`。
7. **删除上传的原始 CSV**。

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
    <job_id>.csv
```

- server 读写挂载：`/data/exports:/var/costra/exports`
- **nginx 不挂载、不静态服务导出/暂存目录**（含全量账本数据必须鉴权）。

下载走应用层 `GET /v1/data-jobs/{id}/download`：

1. 校验 JWT + `job.user_id == 当前用户`；
2. 校验 `file_expires_at > now()`，否则 `410 Gone`；
3. 命中则**由应用直接流式返回**（`createReadStream` → reply.send），带 `Content-Disposition`（文件名按 §9.2 做控制字符防护）。

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

- `ready` 未确认：15 分钟过期 → commit 返回 `410`。
- 已 `consumed`：即使超 15 分钟也**不清理**，直到关联任务终态。
- 僵死 `detecting`（进程异常退出遗留）：按 `created_at` 超时（如 10 分钟）回收，释放 §4.4 的并发槽。
- 导入成功：提交完成后删除规范化行产物（隐私最小化）；**问题报告保留 24h**。
- 可重试失败：保留行产物到重试结束；最终失败：删行产物，仅留任务结果摘要与问题报告。
- 应用侧每分钟清理过期 `ready` / 僵死 `detecting` 会话及其孤儿产物；启动时补偿清理一次。
- 宿主机 cron `maintenance.sh purge-import-staging` / `purge-exports` 作为孤儿兜底（参照 `purge-idempotency`，建议每日 04:37）。
- **任务元数据保留 30 天**：文件过期后行仍在（`file_expires_at < now()`），客户端展示"文件已过期，可重新生成"。

#### 过期后的用户体验

- 导出文件过期：任务卡显示 `文件已过期` + `重新生成`，复用原 `ledger_id/date_from/date_to` 一键重建。**注意 job 状态仍是 `succeeded`**，"已过期"是客户端按 `file_expires_at < now()` 派生的展示态（§7.3 已删除 `expired` 状态值）。
- 检测报告过期（15 分钟）：commit 返回 `410`，提示 `检测已过期，请重新选择文件`。

---

### 7.5 worker 执行模型（复用 recurringScheduler 骨架 + 原子提交 / 幂等重试）

```text
setInterval(POLL_INTERVAL_MS) 或 事件触发
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

#### 导入必须"数据 + 成功状态"同一事务提交（核心）

导入任务的以下操作必须在**同一个 PostgreSQL 事务**内完成，且**顺序有讲究**：

1. **复核 detect 上下文有效性**（v0.6 新增 · 见下方"为什么 FK 兜底不成立"）；
2. 从规范化产物批量 `INSERT entries`（带预生成 `entry_id` + `client_ref_id`，走 `entries` 现有列语义）；
3. 正确生成 `change_seq`（`nextval('entries_change_seq')`，与 entryRepo 同源）；
4. 汇总 delta，**在事务末尾一次性**更新 `ledgers.balance_cents / balance_version`（对齐 `ledgerRepo.applyBalanceDelta`，transfer 不产生 delta）；
5. **批量写入第二条铁律（L13 E1）**：对本次导入受影响的每个账本执行 `UPDATE ledgers SET sync_epoch = sync_epoch + 1`（**必须与上述 INSERT 同一事务**）。理由见 `docs/design/sync-pull-pagination-design.md` §4.2：`change_seq` 走 `nextval` 有"已取号未提交"洞（§3.1），批量长事务在 COMMIT 前若同 family 有并发单笔写入先提交，会把客户端 watermark 推过本批号段区间 → 导入数据被客户端永久拉不到。`sync_epoch + 1` 与 INSERT 同事务原子可见，客户端下一轮 pull 比对 epoch 不一致即清零 watermark 全量重拉。**忘记 +1 = 退化回 R1 洞（洞无人知）**，是本方案唯一靠约定守住的失败模式，须列入 review 检查项。
6. `UPDATE data_jobs SET status='succeeded', finished_at, result_summary`（**条件更新**，见下）。

> **导入上线前置（决策 16 · L13 §8 决策 23）**：`sync_epoch` 的客户端消费能力（epoch 前置比对 + 全量重拉）必须**先于**任何生产批量写入入口上线。若导入功能上线时仍有旧版本客户端未具备 epoch 消费能力，这些客户端仍会踩 R1 洞。故导入上线的前置条件 = **客户端 epoch 消费版本已达目标覆盖率**。

**成功状态不能在事务提交后再单独更新**，否则：

```text
entries 已 COMMIT → 进程崩溃 → job 仍是 processing → 恢复重跑 → 重复导入
```

同事务后只有两种结局：entries + 余额 + job=succeeded 一起成功，或一起回滚。回滚后行产物仍在，重试用同一组 `entry_id/client_ref_id`，靠 `uq_entries_ledger_client_ref` 保证不重复。

> **余额 UPDATE 必须放在事务末尾**（v0.6 补充）：`ledgers` 是**同账本所有记账的公共热点行** —— `entryService.createWithIdempotency` 每次记账都要 `applyBalanceDelta` 更新它。导入大事务一旦碰过这一行，行锁就持有到 COMMIT，期间该账本所有成员的记账请求全部排队（PG pool `max=10`，很容易连带耗尽连接）。把它挪到最末尾可把持锁窗口从"整个导入时长"压缩到"最后一次 UPDATE 到 COMMIT"。
> 另需设 `lock_timeout` / `statement_timeout` 兜底，避免导入被其它长事务卡住时无限等待。
> 注意 `entries_change_seq` 已被 `0016` 改为 `CACHE 1`（为修资产 stale 问题保证严格单调），故 N 条导入 = N 次序列往返，是耗时的隐藏放大项 —— 这也是 §9.1 把上限降到 5,000 行的原因之一。

#### 为什么"靠 FK 兜底"不成立，必须显式复核（v0.6 新增 · P0）

v0.5 的 R12 论证是："detect→commit 之间上下文失效时，遇 FK 失效则整批回滚"。**在 Costra 的软删模型下这条完全不成立**：

| detect→commit 之间的变化 | v0.5 假设 | 实际行为 |
|---|---|---|
| 记账人退出家庭 | FK 失效 → 回滚 | ❌ 退出只写 `family_members.left_at`，**`users` 行永在** → FK 正常 → 静默写入一条归属**已退出成员**的流水 |
| 分类被删除 | FK 失效 → 回滚 | ❌ 分类是 `deleted_at` **软删** → FK 正常 → 写入指向**已软删分类**的流水，客户端渲染分类名落空 |
| 用户失去账本权限 | — | FK 与此无关，必须应用层校验 |

即 R12 的"缓解"实际是空的，会静默产生脏数据。commit 事务内必须显式复核：

```sql
-- 1) 操作者仍是该账本所属家庭的活跃成员（否则整批 failed · 不可重试）
-- 2) 产物中所有 distinct created_by 仍是该家庭活跃成员
SELECT user_id FROM family_members
 WHERE family_id = $1 AND user_id = ANY($2) AND left_at IS NULL;
-- 3) 产物中所有 distinct category_id 仍存在且未软删且 type 匹配
SELECT id, type FROM categories
 WHERE id = ANY($3) AND deleted_at IS NULL;
```

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
| DB 连接瞬断 / deadlock | 检测产物缺失或 SHA 不匹配 |
| 临时 IO 错误 | 用户已失去账本权限 |
| 事务提交前进程退出 | detect 上下文失效（成员退出 / 分类软删 · 见上方复核） |
| `lock_timeout` 超时 | 数据违反业务约束（CHECK/FK） |
| | 文件格式不支持 |

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
1. **游标分页读**（复用 `entryService.list` 的 cursor 语义，每批 500~1000 条），不做 `SELECT` 全量；
2. 每批序列化后**直接 append 写入文件流**，不在内存累积完整 CSV；
3. **批间 `await setImmediate()`** 主动让出 event loop，保证在线请求不被饿死；
4. 导出任务全局并发受 `uq_data_jobs_active_export_per_user` 约束；若后续观测到 CPU 压力，再收紧为全局单并发。

如此内存恒定、不设行数上限，也不需要为导出引入分页下载。

---

### 7.6 任务查询 API 与展示字段

```yaml
paths:
  /data-jobs/{job_id}:
    get:
      summary: 查询单个导入 / 导出任务状态
      responses:
        '200': { description: 任务状态与结果 }

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
      responses:
        '200': { description: 文件流 }
        '410': { description: 文件已过期 }

  /import-detect-sessions/{detect_id}/report:
    get:
      summary: 下载完整检测问题报告 CSV（应用层鉴权 · 校验属主）· 走 §9.3 Formula 防护
      responses:
        '200': { description: 文件流 }
        '404': { description: 会话不存在或已清理 }
```

客户端消费的 `DataJob` 字段：
- `id / type(import|export) / ledger_id / ledger_name`
- `status / stage / stage_started_at` + 顶层 `server_now`（客户端据此做阶段型渐近模拟，§7.2）
- `created_at / started_at / finished_at`
- `result_summary`（导入：`imported / skipped / error_count / warning_count`；导出：`entry_count`）
- `file_name / file_size / file_expires_at`（导出成功时）
- `error_code / error_message / retryable`（失败时）

> **字段命名统一**（v0.6）：文件过期时间在全文统一为 **`file_expires_at`**（v0.5 的 §6.2 曾写作 `download_expires_at`，与 §7.3 表定义、§7.6 客户端字段不一致）。
> **`result_summary` 不含 `affected_months`**：v0.6 已决定不做定向失效（§5.1），无需下发受影响月份。

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
7. 若已有运行中的导出任务，再点导出时提示 `已有导出任务正在进行，请完成后再试`
8. 完成后任务行主操作是 `发送到微信`；点击才下载文件并调起微信转发面板

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
| 文件大小 | ≤ **1MB**（见下方"规模上限的全链路推导"）；客户端先校验，服务端按路由二次校验 |
| 行数上限 | 单次导入 ≤ **5,000 行**；超限检测阶段 ERROR |
| 后缀白名单 | 仅 `.csv`（**大小写不敏感**：`.CSV` / `.Csv` 同样放行；`wx.chooseMessageFile` 的 `extension` 参数亦按小写传入并在服务端归一后比对）|
| 内容校验 | UTF-8（可带 BOM）+ RFC 4180 + 必填表头；拒绝 XLSX / JSON / 二进制 |
| DB 硬约束校验 | detect 必须覆盖 `entries` 全部 CHECK / 引用约束（§3.11），否则"可导入 N 条"与实际写入不一致 |
| 导入并发 | **同一账本同时只允许一个导入任务在执行**（DB 唯一索引兜底）|
| 检测并发 | **同一用户同时只允许一个 `detecting` 会话**（DB 唯一索引兜底，§4.4）|
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
| 客户端本地库 | `entity:__index` **单 key 数组**（微信单 key 1MB / 总量 10MB），`appendToIndex` 全量重写 → O(n²) | ❌ 20,000 条的 index 约 1MB+ 触顶，且 applyServerChanges 会卡死 |
| sync 下行通道 | 单轮 limit 200/500 | ⚠️ 条数越多，收敛越慢（§5.1 前置修复后可控）|

**真实业务量反推**：9 列中文 CSV 每行约 60~120 字节（quote-all 后取上界）。个人一年记账 1,000~3,000 条 ≈ **150~400KB**；微信/支付宝导出一年账单同量级。5MB ≈ 5 万行，**对家庭记账是不存在的场景**。

因此 v0.6 取 **1MB / 5,000 行**（5,000 行 × 120B ≈ 600KB，1MB 留足 BOM + quote-all 冗余）。收益是连锁的：

| 原本需要的改造 | 降级后 |
|---|---|
| 抬高 `@fastify/multipart` 全局 fileSize | **不改**（1MB 天然在 2MB 内）—— 避免为单一功能放宽全局上传策略 |
| detect 改 `202 + 轮询`（防 60s 超时）| **不改**（5,000 行解析为秒级），保持 `200` 同步返回，交互更简单 |
| 大事务长时间持 `ledgers` 行锁 | 秒级，配合 §7.5 的"余额 UPDATE 放末尾"可接受 |
| 客户端本地库改造 / 分片 | **不需要** |

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
| 数据范围 | 账本日期范围内全部未删除流水，包含所有成员；时区显式 `Asia/Shanghai`（不沿用现有脚本的进程本地 `Date`） |
| 生成方式 | **必须流式**：游标分页读 + 逐批 append 落盘 + 批间 `await setImmediate()` 让出 event loop（§7.5）|
| 规模上限 | **不设行数上限**（靠流式保证内存恒定）；但必须验证大账本导出不拖慢在线 API P99 |
| 并发 | 同一用户同时最多 1 个运行中的导出任务（**DB 唯一索引 `uq_data_jobs_active_export_per_user` 兜底**，不只应用层 check） |
| CSV 安全 | 所有单元格走 §9.3 Formula Injection 防护 + quote-all |
| 文件名安全 | 文件名与 `Content-Disposition` 删除 CR/LF、C0 控制字符、路径符号，限长（防 header 注入/路径问题） |
| 文件保留 | 生成后保留 24 小时；过期后可从原任务一键重新生成 |
| 下载鉴权 | 下载端点再次校验 JWT 与 job.user_id；**应用层流式返回**，不用 `X-Accel-Redirect`、不挂 nginx 静态（§7.4）|
| 文件摘要 | 返回 SHA-256，客户端转发前校验 |
| 审计 | user_id、ledger_id、日期范围、entry_count、job_id、sha256 |
| 清理 | 定时任务删除 24 小时前的实体文件，任务元数据保留 30 天 |

### 9.3 CSV Formula Injection 防护

导出 CSV 会被用户在 Excel / WPS / Google Sheets 打开，以 `=`、`+`、`-`、`@` 等开头的单元格会被当作**公式执行**（OWASP CSV Injection）。当前 `csvEscape` 只做 RFC 4180 引号转义，**不能阻止公式执行**。

**受用户控制的导出字段**：一级/二级分类名、记账人昵称、备注、问题报告里的原始值片段；账本名进入文件名/header 另行防护。

#### 两层分开处理

1. **公式防护**（防表格软件执行）；
2. **RFC 4180 序列化**（处理逗号/引号/换行）。二者缺一不可，只做第 2 层无效。

#### 防护编码 `apostrophe-v1`（可逆）

当字段满足任一条件时，在最前面加一个 ASCII 单引号 `'`：
- 首个**有效字符**是 `=`、`+`、`-`、`@`；
- 首字符是 Tab(0x09)、CR(0x0D)、LF(0x0A)；
- 上述字符的**全角变体**（`＝＋－＠`）；
- 危险字符前只有空格 / Unicode 空白 / 控制字符（不能只看原始首字符，防边界注入）。

为可逆，已带前导单引号的危险值再加一层：

| 原始值 | 导出值 | Costra 重新导入还原 |
|---|---|---|
| `=SUM(A1:A2)` | `'=SUM(A1:A2)` | `=SUM(A1:A2)` |
| `'=SUM(A1:A2)` | `''=SUM(A1:A2)` | `'=SUM(A1:A2)` |
| `  =1+1` | `'  =1+1` | `  =1+1` |
| `普通备注` | `普通备注`（不变） | 不变 |

随后由 CSV 序列化器：双引号转义 + **每字段统一 quote-all** + CRLF 输出（表头行同样 quote-all，保持全表一致）。

#### 导入解码

- 只有被 §2.1.1 的**9 列表头指纹**判定为 Costra 自产（`is_costra_export = true` → `formula_guard = apostrophe-v1`）的文件，导入时**移除一层** Costra 防护（`'x`→`x`、`''x`→`'x`）。
- **外部 CSV（`formula_guard = none`）不做任何反解**，避免篡改用户原始数据里本就存在的前导单引号。
- 解码发生在 CSV 反序列化**之后**、字段语义解析**之前**（顺序与导出侧严格镜像）。

> **v0.6 变化**：判定依据从"preamble 声明"改为"表头指纹"（preamble 已删除，§2.1）。可逆性保证不变 —— 因为 Costra 导出的表头恒为固定 9 列，指纹与 `formula-guard` 声明是一一对应的。

#### 防护范围

主账本导出、导入问题报告 CSV、以及后续任何 CSV 下载功能都必须应用。**数据库内仍存原始业务文本**，不在入库时永久加单引号——防护只发生在导出序列化那一刻。

### 9.4 审计日志的落地形式（v0.6 新增）

§2.5 / §9.1 / §9.2 三处都要求"写审计日志"，但**仓库中既没有审计表也没有审计服务** —— 这条要求此前没有载体，等于没落地。

v0.6 决策：**不新建审计表，走结构化 pino 日志**。

- 复用现有日志基建：生产 pino 写固定文件 `/var/log/costra/server.log` → 宿主机 `/data/logs/server`，由 logrotate 唯一轮转；已有 `maintenance.sh error-report` 每日扫描通道。
- 审计事件用固定字段前缀便于检索：`{ audit: 'data_export' | 'data_import', user_id, ledger_id, family_id, job_id, detect_id, file_sha256, entry_count | imported, skipped, date_from, date_to }`。
- **不记录任何行明文**（备注、昵称、金额明细一律不进日志），与 §7.4"日志不得记录行内容"一致。
- 为什么不建表：审计只用于事后追溯与安全排查，无查询/关联需求；新建表会带来 migration、清理 cron、容量增长三份长期成本，而收益仅是"能用 SQL 查"。若后续出现合规检索需求再升级为表。
- **工作量已在 §12 的 E3 中计入**（v0.5 曾漏计）。

---

## 10. v1 脚本与 v2 客户端的关系

当前已有：
- `server/scripts/export-entries.mts`
- `server/scripts/import-entries.mts`

它们是运维在服务器命令行手动执行的 CLI 脚本，当前把查库、CSV 解析、校验、写入逻辑全写在脚本自身。

"抽 service"是把真正的业务逻辑搬到：
- `server/src/services/entryExport.ts`
- `server/src/services/entryImport.ts`

然后两种入口共用同一套逻辑：

```text
小程序 HTTP 路由 ─┐
                  ├─ entryImport / entryExport service ─ PostgreSQL
服务器 CLI 脚本 ──┘
```

**保留脚本**的价值：
- HTTP 路由故障但数据库正常时，紧急帮用户导出
- 需要批量修复或重跑某个文件时绕开小程序
- 灾难恢复、数据迁移、客服人工处理时使用

脚本只负责解析命令行参数和打印报告，不能复制一份业务逻辑。

### 10.1 v1 → v2 格式变更对照

| 维度 | v1 · CLI 脚本 | v2 · 客户端 |
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
| 公式防护 | 无 | 导出 `apostrophe-v1` 可逆防护 + quote-all（§9.3）|
| 重试幂等 | 保留 ID 去重 | 稳定 `client_ref_id` + 数据/成功状态同事务（§7.5）|
| 时区 | 进程本地 `Date` | 显式 `Asia/Shanghai`（导入导出双侧，§3.6 / §9.2）|
| 缓存失效 | 无缓存 | 无（服务端业务缓存已移除，实时聚合；§7.5）|

> **CLI 脚本的行为反转必须做成入参**：归属默认（`共同`→家庭语义）、金额超两位小数（ERROR→四舍五入 + WARNING）在 v2 中改变了语义。CLI 与 HTTP 共用同一 service，若直接改会**连带改掉运维脚本的历史行为**。要求 service 把这两项做成显式选项，CLI 保留 v1 默认值，HTTP 路由传 v2 值。

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
| R12 | 检测后账本上下文变化（成员退出 / 分类软删 / 失去权限）导致引用失效 | 中 | **高** | **不能依赖 FK**（成员退出只写 `left_at`、分类是软删，FK 都不会报错）。commit 事务内**显式复核** active 成员 + 分类未软删 + type 匹配，任一失败整批回滚 failed（不可重试）（§7.5）|
| R13 | 服务重启导致 `processing` 任务僵死 | 低 | 中 | `lease_expires_at` 超时才复位；导入"数据+成功状态同事务"保证未提交即无副作用，可安全重试（§7.5）|
| R14 | 导出/暂存文件占满磁盘 | 低 | 中 | 24h TTL + 按月分桶 + `purge-exports`/`purge-import-staging` cron；导入文件受 1MB/5,000 行上限约束；导出流式生成不占内存 |
| R15 | 导出 CSV 被表格软件当公式执行 | 中 | 高 | §9.3 `apostrophe-v1` 可逆防护 + quote-all；文件名/header 控制字符防护 |
| R16 | 检测产物损坏 / SHA 不匹配 | 低 | 中 | commit 前校验 `artifact_sha256`；不匹配直接 failed（不可重试），提示重新检测 |
| R17 | 旧/超时 worker 覆盖新执行结果 | 低 | 中 | 终态用 `run_token` 条件更新，token 不匹配则 0 行放弃写回（§7.5）|
| R18 | detect 端点被反复上传放大 CPU/磁盘 | 中 | 中 | detect 单独频控（独立 Redis 计数器）+ **同用户单并发** + 1MB/5,000 行上限 + 流式解析 + sha256 幂等复用（§9.1）|
| R19 | **导入后数据迟迟不出现在客户端** | **高** | **高** | 根因是 `sync/pull` 的 `has_more` 无人消费（既有缺陷），5,000 条需 25 轮 ≈ 25 分钟且期间月度合计静默错误。**必须先修 sync 循环消费作为前置依赖**（§5.1）；任务成功后客户端调 `triggerOnMutation()` 加速收敛 |
| R20 | 导入 detect 通过但 commit 撞 DB 约束致整批失败 | 中 | 高 | detect 校验集必须是 `entries` 全部硬约束的超集（§3.11）；`note` 超长截断 + WARNING 而非丢行 |
| R21 | ~~导入后统计/预算显示旧数字~~ | — | — | **已消解**：服务端业务缓存已于 2026-08-28 移除，统计/预算实时聚合，无陈旧窗口（§7.5）。重新引入读缓存时需重开此项 |
| R22 | 导入大事务阻塞同账本记账 | 中 | 中 | 余额 UPDATE 放事务末尾缩短持锁窗口 + `lock_timeout` 兜底 + 5,000 行上限（§7.5）|
| R23 | 大账本导出拖慢在线 API | 中 | 中 | 游标流式读 + 逐批落盘 + 批间 `setImmediate()` 让出 event loop（§7.5 / §9.2）|
| R24 | 同名成员导致错归属 | 中 | 高 | `users.nickname` 无 UNIQUE，同名时**该行 ERROR** 而非静默取第一个（§3.3）|
| R25 | 导入时区错误致跨月漂移 | 中 | 高 | 显式按 `Asia/Shanghai` 构造 `occurred_at`，禁止依赖进程本地时区（§3.6）|

---

## 12. 工作量估算

| 卡 | 内容 | 人天 |
|---|---|---|
| **E0** | **前置 · 修 `sync/pull` 的 `has_more` 无人消费**。独立缺陷、独立卡，问题记录与设计约束见 `docs/follow-up/sync-p2-improvements.md` L13；**正式方案待设计**，本卡仅为导入功能的硬前置占位（§5.1）| 1（估算待方案确定后校准）|
| E1 | 后端 · 抽 import/export service（引入真正的 RFC 4180 CSV parser/stringifier）+ §9.3 Formula 防护编解码 + 9 列表头指纹判定 + CLI 改薄入口并保留（行为反转做成入参）+ 单测 | 3 |
| E2 | 后端 · `0019` 迁移（`import_detect_sessions` + `data_jobs` + 三处 partial unique）+ repo + worker（advisory lock + SKIP LOCKED + run_token/lease）+ 阶段更新 + 僵死恢复 + 原子成功提交 + commit 前复核 + `purge-*` cron | 3.5 |
| E3 | 后端 · detect（流式解析 + 私有产物落盘 + sha256 幂等 + DB 硬约束校验）/commit（FOR UPDATE 原子消费）API、export **流式**生成、`/download` 应用流式 + `/report` 鉴权、nginx `client_max_body_size`、detect 频控（Redis 计数器）、审计日志 | 3.5 |
| E4 | 小程序 · 设置入口、数据管理页、导入/导出表单 | 2.5 |
| E5 | 小程序 · 检测报告页（汇总+预览+完整报告下载）、任务中心、阶段型模拟进度（`server_now` 基准）、轮询恢复、完成卡、shareFileMessage、成功后 `triggerOnMutation()` | 2.5 |
| E6 | QA · iOS / Android / PC 微信、后台切换、断网、并发、过期、重试幂等、CSV 注入、自产自入闭环、权限矩阵、**大批量导入后的 sync 收敛验证** | 3 |
| **合计** | | **19 人天** |

> 相比 v0.5 的 16.5 人天：新增 E0（1）、E2 +0.5（复核 + 多一处唯一索引）、E3 +0.5（导出流式 + DB 约束校验 + 审计）、E6 +0.5（sync 收敛验证）。**同时省掉了**"抬高 multipart 全局上限""detect 改 202 轮询""客户端本地库改造"三项 —— 这是把规模上限降到 1MB/5,000 行换来的。

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

1. **优先 · 真机 spike（导出交付命门）**：验证 `wx.chooseMessageFile` 选择 CSV 与 `wx.shareFileMessage` 转发 CSV 在 iOS / Android 的实际表现（历史上 .csv 分享存在端差异，须在动工前证伪风险）。
2. **优先 · 基建 spike**：验证 nginx `client_max_body_size 2m` 生效后 1MB CSV 上传通路完整（含 multipart 未改动的前提下），以及 5,000 行 detect 的实测端到端耗时是否稳定落在 `proxy_read_timeout 60s` 内。
3. **先落 E0**（修 `sync/pull` 的 `has_more` 消费，问题记录见 `docs/follow-up/sync-p2-improvements.md` L13，方案待设计）：它是独立缺陷、也是本功能的硬前置；顺带验证"新设备登录含数千条流水的账号"这一既有场景的收敛表现（§5.1）。
4. 输出正式技术方案 `data-import-export-tech-spec.md`，冻结两张表、worker、API、事务模型、commit 前复核清单与 §9.3 编解码。
5. 设计 `settings/data-management` 页面高保真交互状态。
6. 拆成 E0~E6 七张卡并排期。

---

## 15. 修订记录

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
