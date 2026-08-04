# 客户端账本数据导入 / 导出方案分析

> 状态：**关键产品决策已冻结 v0.2**
> 前置文档：`docs/design/data-export-format.md`（v1 后台脚本版 · CSV 格式）
> 触发背景：v1 只支持运维在服务器上跑脚本；本轮把导入 / 导出下沉到**小程序端用户自助能力**。

---

## 0. 已冻结结论

| 决策项 | 结论 |
|---|---|
| 载体格式 | **只支持 CSV**；不做 JSON / XLSX |
| 导入选文件 | `wx.chooseMessageFile` 从微信聊天中选择 CSV |
| 导出交付 | `wx.downloadFile` 下载临时文件后，使用 `wx.shareFileMessage` 转发到微信聊天 |
| 导出范围 | **按账本导出全部流水**，包含账本内所有成员创建的记录 |
| 二次同意 | 不需要；登录鉴权 + 活跃账本成员权限校验即足够 |
| 执行模型 | 导入、导出都创建**服务端异步任务** |
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
| Costra 数据迁回 | 将 Costra 导出的 CSV 再导入 | 选择目标账本 → 从聊天选择 CSV → 异步校验并导入 |
| 外部账单迁入 | 从其他平台导入 CSV | 后续通过字段映射器逐步适配；首期保证 Costra 标准 CSV |

---

## 2. 载体文件格式：仅 CSV

### 2.1 文件规格

完全沿用 `docs/design/data-export-format.md` 的 CSV 基线：

| 属性 | 值 |
|---|---|
| 格式 | CSV（RFC 4180） |
| 编码 | UTF-8 with BOM |
| 行结尾 | CRLF |
| 分隔符 | 逗号 `,` |
| 转义 | 含逗号、换行或双引号的字段使用双引号包裹；内部双引号写成 `""` |
| 内容 | 15 列标准格式：记录ID、账本ID、记账人ID、日期、时间、类型、一级分类、二级分类、金额、币种、账户、转入账户、归属、记账人、备注 |

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

### 2.3 导出数据范围

- 用户选择**一个账本**作为导出单位。
- 导出该账本日期范围内的**全部未删除流水**，不再追加 `entries.created_by = 当前用户` 条件。
- CSV 中保留 `记账人ID` 与 `记账人` 两列，用于区分家庭成员。
- 请求者必须是账本所属家庭的活跃成员；满足后不再弹二次同意。
- 文件生成操作写审计日志：请求者、账本、日期范围、记录数、任务 ID、文件摘要。

---

## 3. 问题 B · 小程序如何读入用户本地文件（导入）

### 3.1 微信小程序沙箱的能力边界

**能做**：
- ✅ `wx.chooseMessageFile`：从**当前用户微信聊天记录**里选文件（含"文件传输助手"里的文件）· 拿到 tempFilePath
- ✅ `wx.chooseMedia`：选相册图片 / 视频（对 CSV 无用）
- ✅ `wx.getFileSystemManager().readFile`：读小程序沙箱内的文件（`tempFilePath` 也算沙箱内）

**不能做**：
- ❌ 直接读用户手机文件系统（例如 `/storage/emulated/0/Download/xxx.csv`）· 微信明确不开放
- ❌ 从"我的文件 / 文件管理器"打开一个文件到小程序（iOS 也做不到，只能通过分享菜单转过来）
- ❌ 通过 URL Scheme / 深链传文件（只能传参数）

### 3.2 固定路径：**wx.chooseMessageFile**

用户旅程：

```text
① 用户先把 CSV 发到任意微信聊天（推荐"文件传输助手"）
② 打开小程序 → 我的 → 设置 → 账本导入 / 导出
③ 进入"导入账本"，先选择目标账本
④ 点击"从微信聊天选择 CSV" → wx.chooseMessageFile
⑤ 选中文件 → 页面展示文件名、大小、目标账本，并要求最终确认
⑥ wx.uploadFile 上传完成后，服务端立即返回 import_job_id
⑦ 页面进入"后台处理中"任务卡；用户可离开页面
⑧ 服务端完成后，用户再次进入页面即可看到成功 / 跳过 / 失败统计
```

**关键 API**：

```ts
const res = await wx.chooseMessageFile({
  count: 1,
  type: 'file',
  extension: ['csv'],
});
const tempFilePath = res.tempFiles[0].path;
const fileSize = res.tempFiles[0].size;
const fileName = res.tempFiles[0].name;

if (fileSize > 5 * 1024 * 1024) throw new Error('文件超过 5MB');
```

官方能力边界：
- `wx.chooseMessageFile` 从**客户端会话**选择文件，基础库 2.5.0 起支持。
- `extension` 仅在 `type: 'file'` 时生效，基础库 2.6.0 起支持。
- 返回值包含本地临时路径、文件名、字节数和原会话发送时间。
- 项目基础库为 3.8.12，满足要求。

### 3.3 上传阶段与异步处理阶段必须分开表达

`wx.uploadFile` 只负责把 CSV 传到服务端；用户必须停留到上传完成。服务端接收成功后创建异步任务并返回 `202`，从这一刻开始用户可以离开页面。

```ts
const uploadTask = wx.uploadFile({
  url: `${API_BASE}/v1/import-jobs`,
  filePath: tempFilePath,
  name: 'file',
  header: { Authorization: `Bearer ${accessToken}` },
  formData: { ledger_id: targetLedgerId },
  timeout: 60_000,
});

uploadTask.onProgressUpdate((p) => {
  // 阶段 1 文案：正在上传 42% · 请暂时不要离开
});

// HTTP 202
// { job_id, status: 'queued', status_url, created_at }
```

阶段文案必须明确区分：

| 阶段 | 是否可离开 | 页面文案 |
|---|---|---|
| 选择文件 | 可 | `从微信聊天选择 CSV 文件` |
| 上传中 | **不可** | `正在上传 42% · 请暂时不要离开` |
| 已入队 / 处理中 | 可 | `正在后台导入 · 可以离开此页面` |
| 完成 | 可 | `已导入 1,238 条 · 12 条跳过` |
| 失败 | 可 | `导入未完成 · 查看原因` |

**为什么不客户端解析 CSV**：UUID v7 生成、分类匹配、去重、成员归属与事务写入都依赖数据库；客户端只校验文件后缀和大小，避免维护第二套业务规则。

### 3.4 服务端异步任务 API

```yaml
paths:
  /import-jobs:
    post:
      summary: 上传 CSV 并创建账本导入任务
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
        '202':
          description: 文件已接收，任务已创建

  /data-jobs/{job_id}:
    get:
      summary: 查询导入或导出任务状态
      responses:
        '200':
          description: 任务状态与结果

  /data-jobs:
    get:
      summary: 查询当前用户最近的数据任务
      parameters:
        - in: query
          name: limit
          schema: { type: integer, default: 20, maximum: 50 }
```

统一任务状态：

```text
uploading（仅客户端本地态）
queued → processing → succeeded | failed | expired
```

`DataJob` 至少包含：
- `id / type(import|export) / ledger_id / ledger_name`
- `status / progress_current / progress_total / stage`
- `created_at / started_at / finished_at`
- `result_summary`（总数、成功、跳过、失败、warning）
- `download_url / download_expires_at`（导出成功或错误报告存在时）
- `error_code / error_message`（失败时）

### 3.5 权限与安全（导入侧）

| 项 | 规则 |
|---|---|
| 上传者身份 | 必须已登录 · JWT bearer |
| 目标账本 | 用户在上传前选择；必须是其所属家庭的活跃账本 |
| CSV 账本ID | 对 Costra 标准 CSV：若与目标账本不同，弹确认后**重定向写入目标账本**，不允许借 CSV UUID 越权写其他账本 |
| 记账人字段 | 能映射到目标家庭活跃成员时保留；无法映射时归属当前导入者并产生 warning |
| 文件大小 | ≤ 5MB；`@fastify/multipart` 全局/路由限制必须同步调整 |
| 后缀白名单 | 仅 `.csv` |
| 内容校验 | UTF-8（可带 BOM）+ RFC 4180 + 必填表头；拒绝 XLSX / JSON / 二进制 |
| 频控 | 单用户同时最多 1 个运行中的导入任务；5 分钟最多创建 3 个 |
| 审计 | 记录 user_id、目标账本、file_hash、任务 ID、结果统计 |

---

## 4. 导出文件如何交付给用户

### 4.1 固定交付方式：`wx.shareFileMessage`

微信小程序不能把 CSV 写入手机可见的 Download 目录。导出文件生成后：

```text
异步任务 succeeded
→ 用户点击"发送到微信"
→ wx.downloadFile 下载到临时路径
→ 校验 sha256
→ wx.shareFileMessage({ filePath, fileName })
→ 用户选择聊天 / 文件传输助手
```

官方接口约束：
- `wx.shareFileMessage` 基础库 2.16.1 起支持。
- `filePath` 必须是本地路径或临时路径。
- 可指定 `fileName`，但**不支持自定义 title、description、imageUrl 或缩略图**。
- 项目基础库 3.8.12 满足要求。

因此，真正出现在微信聊天里的内容是**原生文件消息**。我们只能控制文件名，不能给文件消息附加自定义分享文案和封面图。

### 4.2 异步导出流程

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
    "download_expires_at": "2026-07-22T17:39:00+08:00"
  }
}
```

### 4.3 下载与转发

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

### 4.4 分享文案与图片设计

#### 实际微信文件消息

`wx.shareFileMessage` 不提供文案和封面参数，因此聊天中采用原生文件消息：

- **文件名**：`Costra_我的家庭_2026-01-01至2026-07-21_20260721T173900.csv`
- **系统副信息**：微信自动展示文件类型与大小
- **不额外发送第二条文字或图片**：避免一次导出产生多条聊天消息，造成打扰

#### 小程序内分享前完成卡（可控视觉）

完成卡不是聊天封面，而是用户点击"发送到微信"之前在小程序内看到的确认区域：

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
- 白色 Inset Grouped 卡片 · `24rpx` 圆角 · 无阴影。
- 左上使用**线性 CSV 文件图标**：纸张折角 + 三条表格线，不用实心剪影。
- 图标主线 `#8AA98F` 苔绿；文件角标小字 `CSV` 用 `#A88A5E` 砂棕。
- 标题 `30rpx / 600 / #1c1b1a`；日期与文件信息 `24rpx / rgba(28,27,26,.48)`。
- 主按钮苔绿 `#8AA98F`，文案 `发送到微信`。

页面文案：
- 生成完成标题：`账本文件已准备好`
- 说明：`发送到微信聊天或文件传输助手，即可在手机或电脑上获取 CSV。`
- 转发前 loading：`正在准备文件…`
- 调起成功：`请选择接收文件的聊天`
- 用户取消：不报错，任务保持完成态，可再次点击。

如果未来确实需要"自定义图片 + 文案"出现在聊天中，只能另发一张图片或分享小程序卡片；它无法承载 CSV 文件，不纳入本期。

### 4.5 文件存储与安全

| 项 | 规则 |
|---|---|
| 请求者身份 | JWT bearer 必需 |
| 导出权限 | 请求者必须是该账本所属家庭的活跃成员；不做二次同意 |
| 数据范围 | 账本日期范围内全部未删除流水，包含所有成员 |
| 并发 | 同一用户同时最多 1 个运行中的导出任务 |
| 文件保留 | 生成后保留 24 小时；过期后可从原任务一键重新生成 |
| 下载鉴权 | 下载端点再次校验 JWT 与 job.user_id，不使用裸公网静态链接 |
| 文件摘要 | 返回 SHA-256，客户端转发前校验 |
| 审计 | user_id、ledger_id、日期范围、entry_count、job_id、sha256 |
| 清理 | 定时任务删除 24 小时前的实体文件，任务元数据保留 30 天 |

---

## 5. 页面入口与按钮交互设计

### 5.1 入口层级

现有设置页已经存在占位项：

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

### 5.2 数据管理首页

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
● 我的家庭 · 正在导出              42%
✓ 旅行账本 · 已完成          发送到微信 ›
! 我的账本 · 导入失败          查看原因 ›
```

视觉遵循项目现有 Inset Grouped：暖灰白页面、白色 `24rpx` 圆角卡片、无阴影。两个功能卡不是大面积彩色按钮；标题与说明负责解释，右下角使用紧凑苔绿操作按钮。

### 5.3 导入按钮逻辑

1. 点首页 `导入`。
2. 底部 action sheet 选择**目标账本**；默认当前 active ledger。
3. 展示简短说明：`请先将 CSV 发到微信聊天或文件传输助手。`
4. 主按钮变为 `从微信聊天选择 CSV`，点击调用 `wx.chooseMessageFile`。
5. 用户取消文件选择：静默停留，不 Toast 报错。
6. 文件校验不通过：卡片内就地展示原因；不使用一闪而过的 Toast。
7. 校验通过后展示确认卡：目标账本、文件名、大小，以及说明 `导入可能新增大量记录，开始后无法撤销。`
8. 点 `确认导入` 后上传；调用 `wx.enableAlertBeforeUnload({ message: '文件仍在上传，离开将取消本次导入。' })` 开启页面返回询问。
9. 收到 `202` 后调用 `wx.disableAlertBeforeUnload()`，立即切任务卡：`正在后台导入 · 可以离开此页面`。

> `enableAlertBeforeUnload` 不能拦截手势滑动返回，也不能阻止用户退出小程序，因此它只用于降低误操作概率；若上传尚未完成就离开，任务未创建，用户下次需重新选择并上传文件。

### 5.4 导出按钮逻辑

1. 点首页 `导出`。
2. 选择账本；默认当前 active ledger。
3. 选择日期范围：`全部 / 本年 / 本月 / 自定义`，默认 `全部`。
4. 页面明确提示：`将导出该账本范围内所有成员的流水。`
5. 点 `开始导出` 后立即创建任务，按钮在 600ms 内切到 `已加入后台任务`，不等待 CSV 生成。
6. 当前页面顶部出现可收起任务条：`正在导出「我的家庭」 · 可以离开`。
7. 若已有运行中的导出任务，再点导出时提示 `已有导出任务正在进行，请完成后再试`，不重复入队。
8. 完成后任务行主操作是 `发送到微信`；点击才下载文件并调起微信转发面板。

### 5.5 后台任务感知模型

小程序退到后台后，JS 定时器不可靠；“后台执行”必须指**服务端任务继续运行**，不能依赖小程序常驻轮询。

客户端策略：
- 页面可见：前 30 秒每 2 秒轮询，之后每 5 秒轮询。
- 页面隐藏 / 小程序后台：立即停止轮询，不影响服务端任务。
- `App.onShow` / 数据管理页 `onShow`：查询最近 20 个任务并恢复状态。
- 本地仅保存 `unseenCompletedJobIds` 与最近一次状态，不把本地状态当事实源。
- 任务完成时若页面仍可见：任务卡轻震一次 + 状态从琥珀进度态过渡为苔绿完成态。
- 用户已离开页面：下次进入设置页时用副文案和小绿点提示；不接订阅消息，避免为低频功能引入一次性订阅授权。

任务卡阶段文案：

| `stage` | 展示文案 |
|---|---|
| `queued` | `等待处理` |
| `validating` | `正在校验文件` |
| `parsing` | `正在读取第 860 / 1,280 条` |
| `writing` | `正在写入账本` |
| `exporting` | `正在整理 1,280 条记录` |
| `packaging` | `正在生成 CSV 文件` |
| `succeeded` | `已完成` |
| `failed` | `处理失败 · 查看原因` |

---

## 6. v1 脚本“抽 service 后保留”是什么意思

当前已有：
- `server/scripts/export-entries.mts`
- `server/scripts/import-entries.mts`

它们是**运维在服务器命令行手动执行的 CLI 脚本**，当前把查库、CSV 解析、校验、写入逻辑全写在脚本自身。

“抽 service”是把真正的业务逻辑搬到：
- `server/src/services/entryExport.ts`
- `server/src/services/entryImport.ts`

然后形成两种入口共用同一套逻辑：

```text
小程序 HTTP 路由 ─┐
                  ├─ entryImport / entryExport service ─ PostgreSQL
服务器 CLI 脚本 ──┘
```

**保留脚本**表示：用户界面上线后，运维仍能在以下场景直接跑命令：
- HTTP 路由故障但数据库正常时，紧急帮用户导出。
- 需要批量修复或重跑某个文件时绕开小程序。
- 灾难恢复、数据迁移、客服人工处理时使用。

**退休脚本**则是删掉 CLI 入口，以后所有操作都必须走 HTTP API。

本方案决定：**保留脚本作为运维应急入口**。脚本只负责解析命令行参数和打印报告，不能复制一份业务逻辑；这样不会出现脚本与小程序导入规则漂移。

---

## 7. 风险清单

| # | 风险 | 概率 | 影响 | 缓解 |
|---|---|---|---|---|
| R1 | 用户不知道要先把 CSV 发到微信 | 高 | 中 | 导入卡内固定三步说明，推荐文件传输助手 |
| R2 | 用户误以为离开小程序会终止任务 | 高 | 中 | 202 后明确显示 `正在后台处理 · 可以离开`；设置入口持续显示任务状态 |
| R3 | 小程序后台轮询暂停 | 必然 | 低 | 服务端任务独立执行；onShow 恢复查询 |
| R4 | CSV 上传未完成时用户离开 | 中 | 中 | 上传阶段明确“请勿离开”；离开前确认；任务创建后才允许放心离开 |
| R5 | 按账本导出暴露其他成员流水 | 已接受 | 高 | 这是已冻结产品口径；活跃成员可导出完整账本，写审计日志，不做二次同意 |
| R6 | 完成文件链接泄露 | 低 | 中 | 下载 API 同时校验 JWT + job.user_id；不暴露裸静态地址；24 小时清理 |
| R7 | 用户要求聊天自定义封面 | 中 | 低 | 明确 `shareFileMessage` 只能控制文件名；自定义视觉放在小程序完成卡中 |
| R8 | XLSX / JSON 被选中 | 中 | 低 | `extension:['csv']` + 服务端内容校验；提示另存为 CSV |
| R9 | 并发任务重复写入 / 重复导出 | 中 | 高 | 单用户同类型任务互斥 + job idempotency key + DB 事务 |

---

## 8. 工作量估算（异步任务版）

| 卡 | 内容 | 人天 |
|---|---|---|
| E1 | 后端 · 抽 import/export service，CLI 改为薄入口并保留，补单测 | 2 |
| E2 | 后端 · `data_jobs` 模型、worker、状态查询、重试与过期清理 | 2 |
| E3 | 后端 · import/export job API、下载鉴权、审计、频控 | 2 |
| E4 | 小程序 · 设置入口、数据管理页、导入/导出表单 | 2.5 |
| E5 | 小程序 · 任务中心、轮询恢复、完成卡、`wx.shareFileMessage` | 2 |
| E6 | QA · iOS / Android / PC 微信、后台切换、断网、并发与权限矩阵 | 2 |
| **合计** | | **12.5 人天** |

异步任务比原同步估算增加约 3 人天，主要来自持久化 job 状态、worker、恢复轮询与异常重试；这是“用户可离开页面但任务不丢”的必要成本。

---

## 9. 已关闭与剩余问题

### 已关闭
- 只支持 CSV。
- 导入使用 `wx.chooseMessageFile`。
- 导出使用 `wx.shareFileMessage`。
- 按账本导出全部成员流水，不做二次同意。
- 导入 / 导出都做服务端异步任务。
- 入口固定在 `我的 → 设置 → 账本导入 / 导出`。
- v1 CLI 脚本抽 service 后保留。
- 分享不走额外审核。

### 正式技术方案仍需细化（不阻塞产品方案）
- 任务 worker 采用进程内队列 + PostgreSQL 抢占，还是独立进程。
- 导入的事务粒度：整文件原子 vs 分批提交 + 可重试游标。
- 外部 CSV 字段映射首期范围。
- 数据任务表、错误报告表和 30 天任务元数据清理 SQL。

---

## 10. 关键 API 兼容性

| API | 最低基础库 | 项目 3.8.12 | 用途 |
|---|---|---|---|
| `wx.chooseMessageFile` | 2.5.0 | 支持 | 从客户端会话选择 CSV |
| `extension` 参数 | 2.6.0 | 支持 | 限制 `.csv` |
| `wx.uploadFile` | 1.0.0 | 支持 | 上传 CSV；支持进度回调 |
| `wx.enableAlertBeforeUnload` | 2.12.0 | 支持 | 上传阶段降低误返回概率；不拦截滑动返回/退出小程序 |
| `wx.downloadFile` | 1.0.0 | 支持 | 下载完成后的 CSV 到临时路径 |
| `wx.shareFileMessage` | 2.16.1 | 支持 | 转发本地 / 临时文件到聊天 |
| `getFileInfo` SHA-256 | 1.4.0 | 支持 | 文件完整性校验 |

---

## 11. 下一步

1. 输出正式技术方案 `data-import-export-tech-spec.md`，冻结任务表、worker、API 与事务模型。
2. 设计 `settings/data-management` 页面高保真交互状态，包含导入、导出、任务卡三组状态。
3. 拆成 E1~E6 六张卡并排期。
4. 真机 spike 验证 `wx.chooseMessageFile` 选择 CSV 与 `wx.shareFileMessage` 转发 CSV 在 iOS / Android 的实际表现。
