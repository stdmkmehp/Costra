# 客户端账本数据导入 / 导出方案

> 状态：**v0.5 · 方案冻结**（v0.5 收敛 review 的 5 项 P0：阶段型模拟进度 / detect 产物落私有磁盘 / 导入原子幂等重试 / CSV Formula Injection 防护 / Costra CSV Profile v2 preamble）
> 前置文档：`docs/design/data-export-format.md`（v1 脚本版 · 已被本文档取代部分口径）
> 触发背景：v1 只支持运维在服务器上跑脚本；本方案把导入 / 导出下沉到小程序端用户自助能力。
>
> **v0.5 变更摘要**（详见 §15 修订记录）：
> - 进度不再声称"真实百分比"；改为客户端基于 `stage + stage_started_at` 的**阶段型渐近模拟进度**，服务端删除 `progress_current/progress_total`。
> - detect 解析结果**不再存 Redis**；改为 PG 表 `import_detect_sessions`（元数据）+ server-only 私有目录 `/data/import-staging` 的压缩 NDJSON 产物（规范化行）。
> - 导入重试改为**可证明幂等**：detect 阶段预生成 `entry_id`(UUID v7) + `client_ref_id`；entries + 余额 + `job=succeeded` **同一事务提交**；run_token/lease 防旧 worker 覆盖；仅瞬态错误重试。
> - 所有 CSV 导出（含错误报告）单元格走 **Formula Injection 防护**（`apostrophe-v1` 可逆编码 + quote-all）。
> - `#` 头改为严格机读 **Costra CSV Profile v2 preamble**，格式描述从"严格 RFC 4180"改为"可选 Costra preamble + RFC 4180 body"。

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
| 归属默认 | 支出缺省归属为**个人**（不再默认 `共同`） |
| 导入并发约束 | **同一账本同时只允许一个导入任务在执行** |
| 导入两阶段 | **先检测 → 再确认导入**；检测阶段返回所有错误和 warning，由用户决定是否继续 |
| 记账人匹配 | 按昵称匹配家庭成员；未匹配时归属当前导入操作者 + warning |
| 任务持久化 | 任务落 PG 表 `data_jobs`（导入导出共用）；用户退出后可再回来查看进度与下载 |
| 进度显示 | **不承诺真实百分比**；客户端按 `stage + stage_started_at` 做**阶段型渐近模拟进度**，成功才跳 100%（§7.2） |
| worker | 复用 recurringScheduler 范式：进程内轮询 + advisory lock + `FOR UPDATE SKIP LOCKED`，不引入队列中间件 |
| 上传源文件 | 检测流式解析完**即删原始 CSV**；规范化行数据落 **server-only 私有磁盘**（压缩 NDJSON），检测元数据落 PG `import_detect_sessions`（§7.4）；**Redis 不存任何 CSV 行内容** |
| 导入幂等 | detect 阶段预生成 `entry_id`(v7) + `client_ref_id=import:<detect_id>:<row>`；entries + 余额 + `job=succeeded` **同一事务提交**；导入任务**仅瞬态错误可重试**（§7.5） |
| 导出文件 | 存 `/data/exports/<yyyy-mm>/<job_id>.csv`；保留 24h；下载走应用层鉴权 |
| CSV 安全 | 所有导出（含错误报告）单元格走 **Formula Injection 防护**（`apostrophe-v1` 可逆编码 + quote-all，§9.3） |
| 文件格式 | **Costra CSV Profile v2**：可选严格机读 preamble（`#costra-csv;...`）+ RFC 4180 body（§2.1） |
| 行数上限 | 单次导入 ≤ **20,000 行**且 ≤ 5MB（§9.1）；防超长事务 |
| 过期清理 | 新增宿主机 cron `maintenance.sh purge-exports` + `purge-import-staging`（孤儿产物兜底）；任务元数据保留 30 天 |
| 页面入口 | `我的 → 设置 → 账本导入 / 导出` |
| v1 CLI 脚本 | 核心逻辑抽成 service 后**保留**，作为运维应急入口 |
| 分享审核 | 不做额外审核；设计简洁的文件名、完成态文案与分享前视觉卡片 |

**能力边界**：
- 不直接读取手机文件系统；微信小程序只能从客户端会话选文件。
- 不把"下载到手机目录"作为承诺；手机端通过转发到聊天 / 文件传输助手让用户拿到文件。
- 不在客户端解析并入库 CSV；客户端只做后缀、大小等前置校验，完整校验和事务写入由后端执行。

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

### 2.1 文件规格：Costra CSV Profile v2

载体格式为 **Costra CSV Profile v2 = 可选 Costra preamble（1 行）+ RFC 4180 CSV body**。

> ⚠️ 不再宣称"严格 RFC 4180"。RFC 4180 本身**没有注释语法**（以 `#` 开头的行按 RFC 应被当作普通记录），故 Costra preamble 是本项目在 RFC 4180 之上的显式扩展，只由 Costra 自己的解析器识别。

| 属性 | 值 |
|---|---|
| body 格式 | RFC 4180 |
| 编码 | UTF-8 with BOM |
| 行结尾 | CRLF |
| 分隔符 | 逗号 `,` |
| 转义 | 含逗号、换行或双引号的字段用双引号包裹；内部双引号写成 `""`；**导出侧对每个字段统一 quote-all**（配合 §9.3 Formula Injection 防护） |
| 多行字段 | body 必须按 RFC 4180 支持 **quoted multiline field**（备注含换行合法），解析器须维护引号状态，不能按物理行拆分 |
| preamble | 见 §2.1.1，导出必写、导入可选 |

#### 2.1.1 Costra preamble 规范

导出文件在 BOM 之后的**第一行**写一条固定机读 preamble：

```text
#costra-csv;version=2;formula-guard=apostrophe-v1;timezone=Asia/Shanghai
```

解析规则（严格、机读、不做通用注释）：

1. 仅识别 **BOM 之后第一行**、且**精确以 `#costra-csv;` 开头**的行为 preamble；最多 1 行。
2. **不启用通用 `#` 注释语义**——body 数据区内出现 `#` 一律当普通字段内容。
3. preamble 用 `;` 分隔 `key=value`，已定义键：
   - `version`：Profile 主版本。**未知 major → 检测阶段 ERROR 拒绝整文件**，不猜测解析。
   - `formula-guard`：导出所用的 Formula Injection 编码版本（§9.3）。**未知值 → 拒绝**（避免错误反解用户数据）。
   - `timezone`：导出时的时区（当前恒为 `Asia/Shanghai`），仅供人类参考。
4. preamble **不含账本名 / 昵称 / 日期范围等任何用户数据**（这些放文件名与任务元数据，避免用户数据混入协议头）。
5. preamble 之后的**下一条逻辑记录必须是表头**。
6. **外部 CSV 无 preamble** 时：第一条逻辑记录直接作为表头；`formula-guard` 视为 `none`，导入侧不做任何 Formula 反解（§9.3）。

**为什么保留 preamble 而不删除**：它承担两个不可省的机读职责——声明格式版本、声明 Formula 防护编码（保证"导出→再导入"可逆，§9.3）。账本名等展示信息仍在文件名（§2.2）与任务元数据里。

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
| 1 | 日期 | TEXT | ISO 日期 `YYYY-MM-DD` | `2026-06-10` | ✅ |
| 2 | 时间 | TEXT | 24h 格式 `HH:mm` | `14:30` | ✅ |
| 3 | 类型 | TEXT | `支出` / `收入` / `转账` | `支出` | ✅ |
| 4 | 金额 | NUMBER | 正数，单位：元，两位小数 | `35.50` | ✅ |
| 5 | 一级分类 | TEXT | 一级分类名称 | `餐饮` | ✅ |
| 6 | 二级分类 | TEXT | 二级分类名称 | `外卖` | ✅ |
| 7 | 归属 | TEXT | `共同` / `个人`，仅支出有值 | `共同` | 仅支出 |
| 8 | 记账人 | TEXT | 用户昵称 | `小赵` | ✅ |
| 9 | 备注 | TEXT | 用户备注 | `公司楼下` | 可空 |

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

> 说明：为可读性，下例省略了每字段的 quote-all 包裹（实际导出每个单元格都用双引号包裹，见 §9.3）。首行为 §2.1.1 的机读 preamble。备注 `=1+1` 演示 Formula 防护后的 `'=1+1`。

```csv
#costra-csv;version=2;formula-guard=apostrophe-v1;timezone=Asia/Shanghai
日期,时间,类型,金额,一级分类,二级分类,归属,记账人,备注
2026-06-10,14:30,支出,35.50,餐饮,外卖,共同,小赵,公司楼下
2026-06-10,09:00,收入,15000.00,职业收入,工资,,小赵,6月工资
2026-06-09,20:15,转账,5000.00,转账,转账,,小赵,
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
| `归属` | `shared_type`、`公/私` | ❌ | 支出默认 `个人`；收入/转账忽略 |
| `记账人` | `成员`、`操作人`、`member` | ❌ | 默认当前导入操作者 |
| `备注` | `note`、`说明`、`摘要`、`商品`、`交易对方` | ❌ | 留空 |

**显式拒绝的列**：
- `记录ID` / `id` / `entry_id` — **不允许传入**；若 CSV 表头包含此列，检测阶段返回 ERROR：`本系统不支持保留原记录ID，请在导出前删除此列`

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
| `归属` | 支出行全部默认 `个人` | 合理：Costra 支出默认归属个人 |
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
| `归属` | 支出默认 `个人`；收入/转账留 NULL | 正常入库 |
| `记账人` | 归属当前导入操作者 | 正常入库 + WARNING |
| `备注` | 留空 | 正常入库 |

### 3.3 「记账人」列的匹配逻辑

导入时 `记账人` 列是**昵称文本**，需要映射到 `users.id`。匹配规则：

```text
1. 在目标账本所属家庭的活跃成员中，按 nickname 精确匹配（不区分大小写）
2. 若匹配到唯一成员 → 使用该成员的 user_id 作为 created_by
3. 若匹配到多个同名成员 → WARNING，使用第一个匹配到的（按 join 时间排序）
4. 若未匹配 → 归属当前导入操作者 + WARNING
5. 若列不存在或行值为空 → 归属当前导入操作者
```

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

### 3.7 「一级分类」匹配策略

```text
1. 精确匹配目标家庭自定义分类（family_id + type + parent_id IS NULL + name）
2. 精确匹配系统预设分类（is_system + type + parent_id IS NULL + name）
3. 模糊匹配：去掉尾部空格、全角→半角、繁→简 后再试一次
4. 仍未命中 → ERROR，该行不入库
```

**不做自动创建分类**：用户可能把错别字或旧分类名传进来，自动建会产生垃圾分类。提示用户导入前先在小程序中确认分类体系与 CSV 中的名称对齐。

二级分类匹配：
- 非空时：在已匹配的一级分类下查找 `name` 精确匹配的子分类；未找到 → WARNING，降级到该一级下的**默认子分类**
- 为空时 → 直接取该一级下的**默认子分类**

> **默认子分类的判定**（P1 落差修正）：不使用"取 `sort_order = 1`"这一想当然口径——`categories.sort_order DEFAULT 0`，不保证存在 `sort_order = 1` 的行。改用库中权威标记 `is_direct_default`（0001_init.sql 有对应唯一索引）。落库口径：`WHERE parent_id = <一级> AND is_direct_default = true`；理论上兜底不到时再退回同一级 `ORDER BY sort_order, name LIMIT 1`，并与 `entryService.resolveCategoryId` 的同 type 兜底逻辑对齐（server/src/services/entryService.ts）。

### 3.8 「归属」列的解析

| 输入值 | 映射 |
|---|---|
| `共同` / `shared` | `shared` |
| `个人` / `personal` | `personal` |
| 空（支出行）| **默认 `personal`** |
| 空（收入/转账行）| NULL（忽略） |
| 非支出类型填了归属 | WARNING：`非支出类型的归属列将被忽略` |

### 3.9 去重策略与稳定幂等键

- **不保留任何用户传入的记录ID**：`记录ID` / `id` / `entry_id` 列仍禁止传入（§3.1）。
- **每次导入的 `entry_id` 全部由服务端在 detect 阶段生成 UUID v7**，不做跨次去重。
- 重复导入同一份文件会产生重复记录，这是**已接受的代价**；用户若需重来应先在小程序删除上次导入的记录。

**稳定幂等键（v0.5 新增 · 服务本次重试幂等，不做跨次去重）**：
- detect 阶段为每条合法记录同时生成：
  - `entry_id = UUID v7`（服务端生成，落 detect 产物 NDJSON，§7.4）
  - `client_ref_id = import:<detect_id>:<logical_row_no>`
- 这不违反"不允许传入记录ID"——ID 由服务端生成，用户不可控；用户重新检测同一文件会得到**新的** `detect_id`，因此仍可再次导入并产生重复记录，符合上面的已接受代价。
- 作用：**同一个导入任务重试时复用同一组 `entry_id/client_ref_id`**，配合 §7.5 的原子提交与 entries 唯一约束 `uq_entries_ledger_client_ref`，保证"重试不产生重复"。
- 服务端在导入成功后返回 `job_id`，用户可从任务记录回溯。

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
          description: 该账本已有导入任务在执行
```

#### DetectReport 结构（v0.5：汇总 + 预览 + 完整报告分离）

检测仍"检查所有行"，但**不把全部错误塞进一个 HTTP 响应**（上万行错误会撑爆响应体、拖慢单核）。响应只返回精确汇总 + 各前 100 条预览 + 截断标志；完整问题报告另走下载端点。

```json
{
  "detect_id": "019...",
  "ledger_id": "019...",
  "ledger_name": "我的家庭",
  "file_name": "data.csv",
  "file_size": 12345,
  "file_sha256": "...",
  "parser_version": 2,
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
- `parser_version` / `formula_guard`：来自文件 preamble（§2.1.1）；外部无 preamble 时分别为服务端默认解析版本与 `none`。
- `errors_preview` / `warnings_preview`：各**最多前 100 条**；条目结构改为 `{ row, field, code, value_preview }`：
  - **删除 v0.4 的 `raw: "整行原文"`**——整行原文可能含其它成员敏感数据、体积大、且日志留存有隐私风险。
  - `value_preview`：仅该出错字段的值，**截断至 120 字符**。
  - `code`：机读错误码，客户端据此本地化文案，不依赖服务端中文串。
- `errors_truncated` / `warnings_truncated`：为 true 时表示还有更多，引导用户下载完整报告。
- `report_download_url`：指向 §7.6 的完整问题报告 CSV（应用层鉴权 · 校验属主）；本身也是导出，走 §9.3 Formula 防护。
- `expires_at`：`ready` 会话有效期 15 分钟；超时后 `commit` 返回 `410`，需重新检测。

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

### 4.4 同一账本并发约束

| 规则 | 说明 |
|---|---|
| 约束对象 | **账本**（不是用户） |
| 检测阶段 | 允许多次检测同一账本；检测不写入数据，不占并发槽 |
| 确认导入阶段 | 若该账本已有 `queued` / `processing` 状态的导入任务，返回 `409` |
| 释放时机 | 任务进入 `succeeded` / `failed` / `expired` 终态时释放 |
| 用户提示 | `该账本已有导入任务正在进行，请完成后再试` |

### 4.5 检测报告过期与重新检测

- 检测报告有效期 **15 分钟**
- 超时后 `commit` 返回 `410 Gone`，客户端提示 `检测报告已过期，请重新选择文件检测`
- 检测阶段不保留 CSV 文件本体，只保留解析结果和摘要
- 服务端可清理过期 `detect_id` 的解析结果

---

## 5. 导入端到端流程

```text
① 用户先把 CSV 发到任意微信聊天（推荐"文件传输助手"）
② 打开小程序 → 我的 → 设置 → 账本导入 / 导出
③ 进入"导入账本"，选择目标账本
④ 点击"从微信聊天选择 CSV" → wx.chooseMessageFile
⑤ 选中文件 → 页面展示文件名、大小、目标账本
⑥ 点"开始检测" → wx.uploadFile 上传到 /v1/import-jobs/detect
   - 上传中：enableAlertBeforeUnload 防误返回
   - 服务端接收文件 → 解析 → 校验 → 返回 DetectReport
   - 收到报告后 disableAlertBeforeUnload
⑦ 展示检测报告：可导入 N 条 / 错误 M 条 / warning K 条
⑧ 用户决策：
   - 点"确认导入 N 条" → POST /v1/import-jobs/commit { detect_id }
   - 服务端创建异步任务 → 返回 202 + job_id
   - 或点"取消 · 重新选择文件" → 回到步骤 ④
⑨ 页面切到任务卡：`正在后台导入 · 可以离开此页面`
⑩ 服务端完成后，用户再次进入页面即可看到成功 / 跳过统计
```

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
    "download_expires_at": "2026-08-06T16:00:00+08:00"
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
| expired | `重新生成` | `文件已过期，原任务记录仍保留` |

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
  - 已过期 → 显示 `重新生成` / `重新导入`
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
elapsed = now - stage_started_at
p = floor + (cap - floor) * (1 - e^(-elapsed / τ))   # τ 为阶段时间常数，如 8s
```

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
-- 0019_data_jobs.sql（草案 · v0.5）

DO $$ BEGIN
  CREATE TYPE data_job_type AS ENUM ('import', 'export');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE data_job_status AS ENUM ('queued', 'processing', 'succeeded', 'failed', 'expired');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE TABLE IF NOT EXISTS data_jobs (
    id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    type             data_job_type   NOT NULL,
    status           data_job_status NOT NULL DEFAULT 'queued',

    -- 归属
    user_id          UUID NOT NULL REFERENCES users(id),      -- 创建者
    ledger_id        UUID NOT NULL REFERENCES ledgers(id) ON DELETE CASCADE,

    -- 阶段（v0.5：不存条数进度，只存阶段 + 阶段进入时刻，客户端据此做渐近模拟）
    stage            TEXT,                                    -- queued/validating/writing/querying/packaging
    stage_started_at TIMESTAMPTZ,

    -- 导入入参（检测→确认两阶段）
    detect_id        UUID REFERENCES import_detect_sessions(id), -- 关联检测会话（仅 import · 见下方表）
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
    retryable        BOOLEAN NOT NULL DEFAULT false,          -- v0.5：仅瞬态错误可重试（§7.5）

    -- worker 抢占与生命周期（v0.5：run_token/lease 防旧 worker 覆盖新结果）
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

-- v0.5 P2 修正：导出并发也用 DB 约束兜底（原方案只在应用层 check，有竞态）
-- 同一用户同时只允许一个 export 任务在执行
CREATE UNIQUE INDEX IF NOT EXISTS uq_data_jobs_active_export_per_user
  ON data_jobs (user_id)
  WHERE type = 'export' AND status IN ('queued', 'processing');

-- 检测会话表：元数据落 PG（行数据落私有磁盘，见 §7.4）
DO $$ BEGIN
  CREATE TYPE import_detect_status AS ENUM ('detecting', 'ready', 'consumed', 'failed', 'expired');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE TABLE IF NOT EXISTS import_detect_sessions (
    id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id          UUID NOT NULL REFERENCES users(id),
    ledger_id        UUID NOT NULL REFERENCES ledgers(id) ON DELETE CASCADE,
    status           import_detect_status NOT NULL DEFAULT 'detecting',

    -- 上传摘要
    file_name        TEXT,
    file_size        BIGINT,
    file_sha256      TEXT,
    parser_version   INTEGER,
    formula_guard    TEXT,                                    -- apostrophe-v1 / none

    -- 规范化行产物（server-only 私有磁盘，见 §7.4）
    artifact_path    TEXT,
    artifact_sha256  TEXT,

    -- 汇总 + 预览（完整问题报告另落磁盘，见 §4.2 / §7.4）
    total_rows       INTEGER NOT NULL DEFAULT 0,
    importable_rows  INTEGER NOT NULL DEFAULT 0,
    error_count      INTEGER NOT NULL DEFAULT 0,
    warning_count    INTEGER NOT NULL DEFAULT 0,
    report_preview   JSONB,                                   -- errors/warnings 各前 100 条

    -- 生命周期
    job_id           UUID REFERENCES data_jobs(id),           -- 确认后关联的唯一导入任务
    created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
    expires_at       TIMESTAMPTZ NOT NULL,                    -- ready 后 15 分钟
    consumed_at      TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_detect_sessions_user
  ON import_detect_sessions (user_id, created_at DESC);

-- 过期清理走全表 DELETE，不加会拖慢的谓词索引（参照 idempotency_keys 的处理）
```

> **DB migration 双写约定**：`0019_data_jobs.sql` 落地时必须同步在 `server/test/setup.ts` 内嵌 DDL 里对齐两张表与索引；pg-mem 不支持的 partial unique index（`WHERE ... status IN (...)`）在测试环境跳过，约束由真实 PG 兜底。

> **ID 生成一致性**（P3 修正）：业务 repo 统一走 `newId()`（UUID v7，见 `server/src/id/idGen.ts`）。`data_jobs` / `import_detect_sessions` 的 `DEFAULT gen_random_uuid()` 仅作 DB 兜底；应用层 INSERT 应显式传 v7 id，与 entries 一致，避免 v4/v7 混用。

**检测会话为什么改建表 + 落盘（推翻 v0.4 的"存 Redis"）**：
- 生产 Redis 512MB + `allkeys-lru` + AOF everysec。5MB CSV 展开成结构化 JSON 可达 10~20MB，放进单个 Redis key 会：挤掉缓存/会话、产生大 key 延迟、把完整账单写进 AOF、Redis 故障时让已完成的检测报告凭空消失。
- 故 v0.5：**检测元数据落 PG `import_detect_sessions`，规范化行数据落 server-only 私有磁盘（压缩 NDJSON），Redis 不参与**（见 §7.4）。

---

### 7.4 问题四：上传/下载文件存哪里，过期策略

分三类文件，存储位置和 TTL 各不相同：

| 文件 | 存哪里 | 保留时长 | 清理方式 |
|---|---|---|---|
| **用户上传的原始 CSV（导入源）** | 流式解析完**即删**，不落盘长期保留 | 单次请求内，秒级 | 请求结束即释放 |
| **导入检测元数据** | PG `import_detect_sessions` | ready 后 15 分钟；已 consumed 则跟随任务生命周期 | 定时清理 + cron 兜底 |
| **导入规范化行产物** | **server-only** `/data/import-staging/<yyyy-mm>/<detect_id>.rows.ndjson.gz` | 同检测会话；任务终态后删 | 应用清理 + `purge-import-staging` cron |
| **导出 CSV / 导入错误报告 CSV** | 服务器本地 `/data/exports/<yyyy-mm>/<job_id>.csv` | **24 小时** | `purge-exports` cron |

> v0.5 推翻 v0.4"检测结果存 Redis"：生产 Redis 512MB + `allkeys-lru` + AOF everysec，5MB CSV 展开成 JSON 可达 10~20MB，放单 key 会挤掉缓存/会话、产生大 key 延迟、把完整账单写进 AOF、故障时让已完成检测报告消失。故检测行数据改落 **server-only 私有磁盘**，Redis 不参与。

#### 检测阶段：流式解析 → 规范化行落私有磁盘

1. 创建 `detecting` 会话（PG 插一行）。
2. `wx.uploadFile` 输入流**直接进标准 CSV parser**（须支持 RFC 4180 quoted multiline，见 §2.1；不复用现有手写逐物理行 parser）。
3. 预加载目标家庭活跃成员映射（nickname→user_id）与分类映射（§3.7），避免逐行查库。
4. 流式解析、校验、规范化每一行；合法记录写入 `.tmp` 压缩 NDJSON 产物，字段含：`row_no / entry_id(v7,预生成) / client_ref_id / occurred_at / amount_cents / type / category_id / created_by / shared_type / note`。
5. 完整问题（错误 + warning）写另一份报告文件；响应只回汇总 + 各前 100 条（§4.2）。
6. 完成后算产物 SHA-256，**原子 rename** `.tmp → 正式名`，会话置 `ready`、写汇总与 `report_preview`。
7. **删除上传的原始 CSV**。

> **关键收益**：commit 直接读规范化产物入库，**不再重做昵称/分类/金额模糊匹配**——"用户看到的检测结果"与"实际写入内容"逐字段一致，杜绝 detect→commit 之间上下文漂移。

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
- **nginx 不静态服务导出/暂存目录**（含全量账本数据必须鉴权）。下载走应用层 `GET /v1/data-jobs/{id}/download`：
  1. 校验 JWT + `job.user_id == 当前用户`
  2. 校验 `file_expires_at > now()`，否则 `410 Gone`
  3. 命中则 `X-Accel-Redirect` 交 nginx internal location 回源（或应用直接流式返回）

#### commit 阶段：原子消费检测会话

`POST /import-jobs/commit`（详见 §4.3）在一个事务内：
1. `SELECT ... FOR UPDATE` 锁定 `import_detect_sessions` 行；
2. 校验属主、账本权限、`status='ready'`、`expires_at > now()`；
3. 若 `status='consumed'` 且已有 `job_id` → **幂等返回原 `job_id`**（防连点/超时重发建双任务）；
4. 同事务 `INSERT data_jobs`（`detect_id` 唯一约束保证一对一）；
5. 会话置 `consumed`、写 `job_id`；
6. 提交。

#### 生命周期与清理

- `ready` 未确认：15 分钟过期 → commit 返回 `410`。
- 已 `consumed`：即使超 15 分钟也**不清理**，直到关联任务终态。
- 导入成功：提交完成后删除规范化行产物（隐私最小化）。
- 可重试失败：保留行产物到重试结束；最终失败：删行产物，仅留任务结果摘要。
- 应用侧每分钟清理过期 `ready` 会话及其孤儿产物；启动时补偿清理一次。
- 宿主机 cron `maintenance.sh purge-import-staging` / `purge-exports` 作为孤儿兜底（参照 `purge-idempotency`，建议每日 04:37）。
- **导出任务元数据保留 30 天**：文件过期后行仍在（`file_expires_at < now()`），客户端展示"文件已过期，可重新生成"。

#### 过期后的用户体验

- 导出文件过期：任务卡显示 `文件已过期` + `重新生成`，复用原 `ledger_id/date_from/date_to` 一键重建。
- 检测报告过期（15 分钟）：commit 返回 `410`，提示 `检测已过期，请重新选择文件`。

---

### 7.5 worker 执行模型（复用 recurringScheduler 骨架 + v0.5 原子提交/幂等重试）

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

#### 导入必须"数据 + 成功状态"同一事务提交（核心修正）

导入任务的以下操作必须在**同一个 PostgreSQL 事务**内完成：

1. 从规范化产物批量 `INSERT entries`（带预生成 `entry_id` + `client_ref_id`，走 `entries` 现有列语义）；
2. 正确生成 `change_seq`（`nextval('entries_change_seq')`，与 entryRepo 同源）；
3. 汇总 delta，更新 `ledgers.balance_cents / balance_version`（对齐 `ledgerRepo.applyBalanceDelta`，transfer 不产生 delta）；
4. `UPDATE data_jobs SET status='succeeded', finished_at, result_summary`（**条件更新**，见下）。

**成功状态不能在事务提交后再单独更新**，否则：

```text
entries 已 COMMIT → 进程崩溃 → job 仍是 processing → 恢复重跑 → 重复导入
```

同事务后只有两种结局：entries + 余额 + job=succeeded 一起成功，或一起回滚。回滚后行产物仍在，重试用同一组 `entry_id/client_ref_id`，靠 `uq_entries_ledger_client_ref` 保证不重复。

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
| 事务提交前进程退出 | detect 上下文失效（成员退出/分类删除） |
| | 数据违反业务约束（CHECK/FK） |
| | 文件或 parser_version 不支持 |

- 可重试：`status='queued'`、`retryable=true`、`next_attempt_at=now()+退避`（`attempts < 3`）。
- 不可重试：直接 `status='failed'`，删行产物。
- 崩溃恢复：`processing` 且 `lease_expires_at < now()` 的僵死任务才允许复位；复位前按上表判定，导入类默认按"事务未提交=可安全重试"处理（因为成功与数据同事务，未提交即无副作用）。
- **若某类导入无法保证"数据+成功状态同事务"，则该类导入必须关闭自动重试。**
- `timerHandle.unref()` + `onClose` 里 `stop()`，与 recurringScheduler 一致，保证 SIGTERM 快速关停。

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

客户端消费的 `DataJob` 字段（v0.5：去掉 `progress_current/total`）：
- `id / type(import|export) / ledger_id / ledger_name`
- `status / stage / stage_started_at`（客户端据此做阶段型渐近模拟，§7.2）
- `created_at / started_at / finished_at`
- `result_summary`（imported / skipped / error_count / warning_count / entry_count）
- `file_name / file_size / file_expires_at`（导出成功时）
- `error_code / error_message / retryable`（失败时）

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

---

## 9. 权限与安全

### 9.1 导入侧

| 项 | 规则 |
|---|---|
| 上传者身份 | 必须已登录 · JWT bearer |
| 目标账本 | 用户在上传前选择；必须是其所属家庭的活跃账本 |
| 记录ID | **不允许传入**；若 CSV 表头包含 `记录ID` / `id` / `entry_id`，检测阶段返回 ERROR |
| 记账人字段 | 按昵称匹配家庭成员；未匹配时归属当前导入操作者 + warning |
| 文件大小 | ≤ 5MB；**`@fastify/multipart` 全局 `fileSize` 现为 2MB（`server/src/app.ts`），必须提升或按路由覆盖**，否则 5MB 在框架层即被拒 |
| 行数上限 | 单次导入 ≤ **20,000 行**（仅限 5MB 不够——极短记录可产生数万行 + 超长事务）；超限检测阶段 ERROR |
| 后缀白名单 | 仅 `.csv` |
| 内容校验 | UTF-8（可带 BOM）+ Costra CSV Profile v2 body（RFC 4180）+ 必填表头；拒绝 XLSX / JSON / 二进制 |
| 并发约束 | **同一账本同时只允许一个导入任务在执行**（DB 唯一索引兜底）；检测阶段不占并发槽 |
| 频控 | 单用户 5 分钟最多创建 3 个导入任务；**detect 端点单独频控**（如 5 分钟 5 次），防反复上传大文件解析放大单核 CPU/磁盘（无现成 rate-limit 组件，建议按 `data_jobs`/`import_detect_sessions` 计数实现，参照 `recurringRepo.countByUser`） |
| 私有产物 | 规范化行产物落 server-only `/data/import-staging`（`0700`/`0600`/UID 1000，不挂 nginx，不进备份，日志不记行内容，§7.4） |
| 审计 | 记录 user_id、目标账本、file_sha256、detect_id、任务 ID、结果统计（不记录行明文） |

### 9.2 导出侧

| 项 | 规则 |
|---|---|
| 请求者身份 | JWT bearer 必需 |
| 导出权限 | 请求者必须是该账本所属家庭的活跃成员；不做二次同意 |
| 数据范围 | 账本日期范围内全部未删除流水，包含所有成员；时区显式 `Asia/Shanghai`（不沿用现有脚本的进程本地 `Date`） |
| 并发 | 同一用户同时最多 1 个运行中的导出任务（**DB 唯一索引 `uq_data_jobs_active_export_per_user` 兜底**，不只应用层 check） |
| CSV 安全 | 所有单元格走 §9.3 Formula Injection 防护 + quote-all |
| 文件名安全 | 文件名与 `Content-Disposition` 删除 CR/LF、C0 控制字符、路径符号，限长（防 header 注入/路径问题） |
| 文件保留 | 生成后保留 24 小时；过期后可从原任务一键重新生成 |
| 下载鉴权 | 下载端点再次校验 JWT 与 job.user_id，不使用裸公网静态链接 |
| 文件摘要 | 返回 SHA-256，客户端转发前校验 |
| 审计 | user_id、ledger_id、日期范围、entry_count、job_id、sha256 |
| 清理 | 定时任务删除 24 小时前的实体文件，任务元数据保留 30 天 |

### 9.3 CSV Formula Injection 防护（v0.5 新增）

导出 CSV 会被用户在 Excel / WPS / Google Sheets 打开，以 `=`、`+`、`-`、`@` 等开头的单元格会被当作**公式执行**（OWASP CSV Injection）。当前 `csvEscape` 只做 RFC 4180 引号转义，**不能阻止公式执行**。

**受用户控制的导出字段**：一级/二级分类名、记账人昵称、备注、错误报告里的原始值；账本名进入文件名/header 另行防护。

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

随后由 CSV 序列化器：双引号转义 + **每字段统一 quote-all** + CRLF 输出。

#### 导入解码

- 只有明确 Costra 格式且 preamble 声明 `formula-guard=apostrophe-v1` 的文件，导入时**移除一层** Costra 防护（`'x`→`x`、`''x`→`'x`）。
- **外部 CSV（`formula-guard=none`）不做任何反解**，避免篡改用户原始数据里本就存在的前导单引号。

#### 防护范围

主账本导出、导入错误报告 CSV、以及后续任何 CSV 下载功能都必须应用。**数据库内仍存原始业务文本**，不在入库时永久加单引号——防护只发生在导出序列化那一刻。

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
| 归属默认 | 支出默认 `共同` | 支出默认 `个人` |
| 执行模型 | 同步 | 异步任务 |
| 导入流程 | 一步到位 | **检测 → 确认导入** 两阶段 |
| 并发约束 | 无 | 同账本单导入 + 同用户单导出（DB 唯一索引兜底）|
| 文件名 | `{账本名}_{起始}_{结束}.csv` | `Costra_{账本名}_{起始}至{结束}_{时刻}.csv` |
| 文件头 | 无 / 自由文本注释 | 严格机读 preamble `#costra-csv;version=2;...`（§2.1.1）|
| CSV 解析 | 手写逐物理行（不支持 quoted multiline）| 标准 RFC 4180 parser（支持多行字段）|
| 公式防护 | 无 | 导出 `apostrophe-v1` 可逆防护 + quote-all（§9.3）|
| 重试幂等 | 保留 ID 去重 | 稳定 `client_ref_id` + 数据/成功状态同事务（§7.5）|

---

## 11. 风险清单

| # | 风险 | 概率 | 影响 | 缓解 |
|---|---|---|---|---|
| R1 | 用户不知道要先把 CSV 发到微信 | 高 | 中 | 导入卡内固定三步说明，推荐文件传输助手 |
| R2 | 用户误以为离开小程序会终止任务 | 高 | 中 | 202 后明确显示 `正在后台处理 · 可以离开` |
| R3 | 小程序后台轮询暂停 | 必然 | 低 | 服务端任务独立执行；onShow 恢复查询 |
| R4 | CSV 上传未完成时用户离开 | 中 | 中 | enableAlertBeforeUnload 防误返回；任务未创建则需重选文件 |
| R5 | 按账本导出暴露其他成员流水 | 已接受 | 高 | 已冻结产品口径；活跃成员可导出完整账本，写审计日志 |
| R6 | 完成文件链接泄露 | 低 | 中 | 下载 API 同时校验 JWT + job.user_id；24 小时清理 |
| R7 | 用户要求聊天自定义封面 | 中 | 低 | shareFileMessage 只能控制文件名；自定义视觉放在小程序完成卡中 |
| R8 | XLSX / JSON 被选中 | 中 | 低 | `extension:['csv']` + 服务端内容校验；提示另存为 CSV |
| R9 | 并发任务重复写入 | 中 | 高 | 同账本单导入 + 同用户单导出（均 DB 唯一索引兜底）+ 稳定 `client_ref_id` + `uq_entries_ledger_client_ref` |
| R10 | 重复导入同一份无 ID 文件产生重复 | 已接受 | 中 | 不跨次去重是已冻结决策；用户需先删除上次导入的记录（同一 job 重试不重复，§7.5）|
| R11 | 检测报告过期 | 中 | 低 | ready 15 分钟有效期；过期 commit 返 410 提示重新检测 |
| R12 | 检测后账本上下文变化（成员退出/分类删除/账本删除）导致匹配失效 | 低 | 中 | detect 已把匹配结果固化进规范化产物；commit 只读产物入库，遇 FK 失效则整批回滚并 failed（不可重试）|
| R13 | 服务重启导致 `processing` 任务僵死 | 低 | 中 | `lease_expires_at` 超时才复位；导入"数据+成功状态同事务"保证未提交即无副作用，可安全重试（§7.5）|
| R14 | 导出/暂存文件占满磁盘 | 低 | 中 | 24h TTL + 按月分桶 + `purge-exports`/`purge-import-staging` cron；单文件受 5MB/20000 行上限约束 |
| R15 | 导出 CSV 被表格软件当公式执行 | 中 | 高 | §9.3 `apostrophe-v1` 可逆防护 + quote-all；文件名/header 控制字符防护 |
| R16 | 检测产物损坏 / SHA 不匹配 | 低 | 中 | commit 前校验 `artifact_sha256`；不匹配直接 failed（不可重试），提示重新检测 |
| R17 | 旧/超时 worker 覆盖新执行结果 | 低 | 中 | 终态用 `run_token` 条件更新，token 不匹配则 0 行放弃写回（§7.5）|
| R18 | detect 端点被反复上传大文件放大 CPU/磁盘 | 中 | 中 | detect 单独频控 + 5MB/20000 行上限 + 流式解析（§9.1）|
| R19 | 自产 CSV 再导入被 `#` preamble 干扰 | 中 | 中 | 严格机读 preamble（§2.1.1），仅解首行精确 magic，未知 version/guard 拒绝 |

---

## 12. 工作量估算

| 卡 | 内容 | 人天 |
|---|---|---|
| E1 | 后端 · 抽 import/export service（引入真正的 RFC 4180 CSV parser/stringifier）+ §9.3 Formula 防护编解码 + CLI 改薄入口并保留 + 单测 | 3 |
| E2 | 后端 · `0019` 迁移（`data_jobs` + `import_detect_sessions`）+ repo + worker（advisory lock + SKIP LOCKED + run_token/lease）+ 阶段更新 + 僵死恢复 + 原子成功提交 + `purge-exports`/`purge-import-staging` cron | 3 |
| E3 | 后端 · detect（流式解析 + 私有产物落盘）/commit（FOR UPDATE 原子消费）API、export API、`/download` + `/report` 鉴权、multipart 提限、detect 频控、审计 | 3 |
| E4 | 小程序 · 设置入口、数据管理页、导入/导出表单 | 2.5 |
| E5 | 小程序 · 检测报告页（汇总+预览+完整报告下载）、任务中心、阶段型模拟进度、轮询恢复、完成卡、shareFileMessage | 2.5 |
| E6 | QA · iOS / Android / PC 微信、后台切换、断网、并发、过期、重试幂等、CSV 注入、自产自入闭环、权限矩阵 | 2.5 |
| **合计** | | **16.5 人天** |

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

1. **优先**：真机 spike 验证 `wx.chooseMessageFile` 选择 CSV 与 `wx.shareFileMessage` 转发 CSV 在 iOS / Android 的实际表现（导出交付命门，历史上 .csv 分享存在端差异，须在动工前证伪风险）
2. 输出正式技术方案 `data-import-export-tech-spec.md`，冻结两张表、worker、API、事务模型与 §9.3 编解码
3. 设计 `settings/data-management` 页面高保真交互状态
4. 拆成 E1~E6 六张卡并排期

---

## 15. 修订记录

### v0.5（2026-08-27）· 收敛 review 的 5 项 P0

基于代码级适配性评审（核对 `server/` 现状），本版修订以下五点，均已在正文对应章节落地：

| # | 问题 | v0.4 | v0.5 决策 | 影响章节 |
|---|---|---|---|---|
| 1 | 进度模型与大事务矛盾 | 声称"真实百分比 = current/total"，但大事务内进度提交前不可见 | 进度非必须；改**阶段型渐近模拟**，服务端删 `progress_current/total`、加 `stage_started_at`；保留导入单大事务 | §0 §7.2 §7.3 §7.6 §8 |
| 2 | detect 全量行存 Redis 不可行 | 解析结果存 Redis TTL 15min | 元数据落 PG `import_detect_sessions`，规范化行落 **server-only 私有磁盘**（压缩 NDJSON），Redis 不参与 | §7.3 §7.4 §4.2 §9.1 |
| 3 | 导入任务不可裸重试 | attempts<3 复位重跑（会重复导入） | detect 预生成 `entry_id`+`client_ref_id`；entries+余额+`job=succeeded` **同事务提交**；`run_token`/lease 防覆盖；仅瞬态错误重试 | §3.9 §7.3 §7.5 |
| 4 | CSV Formula Injection 缺失 | 仅 RFC 4180 引号转义 | 所有导出单元格走 **`apostrophe-v1` 可逆防护 + quote-all**；文件名/header 控制字符防护 | §2.1 §2.4 §9.2 §9.3 |
| 5 | `#` 注释头解析未定义 | 自由文本 `# Costra 导出 · ...` | 严格机读 **Costra CSV Profile v2 preamble**（`#costra-csv;version=...`）；格式描述从"严格 RFC 4180"改为"preamble + RFC 4180 body" | §2.1 §2.1.1 §2.4 |

**顺带修正的 P1/P2/P3 落差**（正文已改）：
- multipart 全局 `fileSize=2MB` 会拦 5MB → §9.1 明列必须提限。
- 默认子分类"取 `sort_order=1`"想当然 → 改用 `is_direct_default` 标记（§3.7）。
- 导出并发只有应用层 check → 补 DB 唯一索引 `uq_data_jobs_active_export_per_user`（§7.3 §9.2）。
- detect 端点无频控 → §9.1 补 detect 单独频控。
- 导出时区用进程本地 `Date` → §9.2 明确显式 `Asia/Shanghai`。
- 单次导入新增 **20,000 行**上限（§0 §9.1），防超长事务。
- ID 生成 v4/v7 混用 → 统一走 `newId()`（v7），DB `gen_random_uuid()` 仅兜底（§7.3）。
- 现有手写逐物理行 parser 不支持 quoted multiline → §2.1 要求引入标准 CSV parser（E1 工作量已含）。
- 完整错误报告不再塞进 HTTP 响应 → 汇总 + 各前 100 条预览 + `/report` 下载端点（§4.2 §7.6）；`raw` 整行原文删除，改 `field/code/value_preview`（隐私）。

工作量 14 → **16.5 人天**（E1 引入 CSV 库 + Formula 编解码；E2 加检测会话表/run_token/原子提交/新 cron；E3 加流式解析落盘 + FOR UPDATE 消费 + multipart 提限）。

### v0.4
补齐任务持久化 / 进度百分比 / 文件存储与过期策略。
