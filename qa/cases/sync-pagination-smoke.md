# L13 · sync/pull 分页收敛冒烟用例集（SP-001 ~ SP-005）

> **卡号**：L13（`docs/follow-up/sync-p2-improvements.md`）
> **方案**：`docs/design/sync-pull-pagination-design.md` v0.8
> **协议锚点**：`docs/api/sync-protocol.md` §3.3 / §8 —— 其中 **SP-001 即协议 §8 的 `smoke_sync_05`**
> **覆盖**：C1 分页循环 · E1 epoch 全量重拉 · C2 批量落盘 · R5 月索引串行队列
> **版本**：v1.0（2026-09-02）

---

## 0. 通用前置

- 微信开发者工具 + 基础库 3.8.12；`miniprogram/services/env.ts` 指向 staging（**提交前须还原 `localhost:8080`**）。
- 登录：`WX_MOCK_LOGIN` 已移除，走 **GM impersonate** 免扫码。
- 每条用例开始前清本地：登录后在 Console 执行 `wx.clearStorageSync()` 再冷启（或走 logout → 重新登录）。
- 观测点统一为三处：
  - Console 关键日志：`[sync:pull] requesting · … page=N`、`epoch diff detected`、`no ledgers in response`；
  - `wx.getStorageInfoSync().keys`：`watermark:{familyId}`、`sync:epoch:{familyId}`、`entry:index:{ledgerId}:{YYYY-MM}`；
  - 明细页月度合计与列表条数。

> **禁止项**：任何用例都不得通过"手动删月索引 key 触发全量重拉"来制造可见性；可见性只能由 sync 链路自身给出（L13 决策）。

---

## SP-001 `has_more=true` → 立即续拉，watermark 单调推进（协议 §8 `smoke_sync_05`）

- **Category**：等价类 / 集成层契约对齐
- **Severity**：P0
- **前置条件**：
  - 账号在服务端已有 **≥ 1,200 条**流水（跨 ≥ 3 个自然月），本地 storage 已清空；
  - `PULL_LIMIT = 500`，故预期 ≥ 3 轮。
- **步骤**：
  1. 清 storage → 冷启 → 登录，停留前台不切页；
  2. Console 观察 `[sync:pull] requesting` 日志序列；
  3. 收敛后进入明细页，逐月核对合计。
- **预期**：
  - 单次 `syncOnce` 内出现 **多轮** `requesting … page=0/1/2…`，**不是**每 60s 一轮；
  - 每轮 `since` 严格递增，**无重复、无回退**；
  - `SYNC_DONE` 只在收敛后广播 **一次**（明细页不逐轮跳动）；
  - 全部流水在 **≤ 60s** 内可见（§6 验收口径 1）；
  - `categories_revision` 仅在最后一轮消费（`has_more=true` 的轮次服务端不返回该字段）。
- **实际**：（首次执行留空）
- **责任**：MiniApp + Backend
- **严重度**：P0

---

## SP-002 中断后从落盘 watermark 续拉，不从头重来

- **Category**：异常 / 弱网
- **Severity**：P0
- **前置条件**：同 SP-001 的数据量，本地已清空。
- **步骤**：
  1. 冷启登录，在日志出现 `page=1` 后**立刻杀掉小程序**（或断网）；
  2. 记录此时 `wx.getStorageSync('watermark:{familyId}')` 的值 `W1`；
  3. 重新冷启（恢复网络）。
- **预期**：
  - 第二次首轮请求的 `since` **等于 `W1`**，不是 0；
  - 最终条数与 SP-001 收敛后一致，无重复条目（同 `client_ref_id` 只有一条）。
- **实际**：
- **责任**：MiniApp
- **严重度**：P0

---

## SP-003 导入触发 epoch 变化 → 全量重拉（R1 洞验收）

- **Category**：并发 / 集成层契约对齐
- **Severity**：P0
- **前置条件**：
  - 客户端已收敛（`sync:epoch:{familyId}` 已有记录，值记为 `E0`）；
  - 服务端可执行 `server/scripts/import-entries.mts`（staging），导入 **≥ 500 行**，且导入目标账本即当前账本；
  - 当前月**本地已有手工流水**（确保 `_hydrateRemoteMonthEntries` 不会兜底，暴露真实链路）。
- **步骤**：
  1. 客户端保持前台，持续触发 pull（可反复切 tab）；
  2. 服务端执行导入（不加 `--dry-run`）；
  3. 观察客户端 Console 与明细页。
- **预期**：
  - 出现 `[sync:pull] epoch diff detected · watermark cleared → full re-pull`；
  - 日志顺序为 **先 strict 清零、后写 epoch**（`sync:epoch` 的新值只在清零成功后落盘）；
  - 导入的 **全部行可达**，出现在对应月份，月度合计正确；
  - 重拉过程中明细页**无逐轮跳动**（仅收敛后刷新一次）；
  - 重拉完成后 `sync:epoch:{familyId}` 的值 = `E0 + 1`。
- **实际**：
- **责任**：MiniApp + Backend + DevOps
- **严重度**：P0

---

## SP-004 重拉/批量落盘期间并发记账，月索引两侧都不丢（R5 验收）

- **Category**：并发
- **Severity**：P0
- **前置条件**：同 SP-003（借用导入触发的全量重拉窗口），或用 SP-001 的首登多轮窗口。
- **步骤**：
  1. 在客户端进入多轮拉取窗口（Console 已出现 `page=1` 及以后）；
  2. 窗口内立即**手动记一笔**当月流水，再**改一笔**、**删一笔**已有流水；
  3. 等待收敛，进入明细页。
- **预期**：
  - 新记的那笔**始终可见**，不会中途消失；
  - 改动/删除不被同轮拉取覆盖回旧值（相等档 pending 闸门生效）；
  - 服务端拉回的行同样都在，**两侧都不丢**；
  - 若某月月索引 key 此前缺失，收敛后该月**不出现"只含部分条目"**的情况（全月条数与服务端一致）。
- **实际**：
- **责任**：MiniApp
- **严重度**：P0

---

## SP-005 稳态零成本 + 灰度兼容

- **Category**：兼容 / 边界
- **Severity**：P1
- **前置条件**：客户端已收敛，无导入发生。
- **步骤**：
  1. 前台静置 3 个 periodic 周期（≥ 3 分钟），观察日志；
  2. （灰度校验）把 `env.ts` 指到**未部署 migration 0019 / 旧版本**的服务端，冷启一次；
  3. 再切回新服务端，冷启一次。
- **预期**：
  - 步骤 1：每个周期只有 **1 轮** `requesting`，无 `epoch diff detected`，无重拉；
  - 步骤 2：服务端不返回 `sync_epoch` → 客户端归一化为 0 → **不触发任何重拉**；
  - 步骤 3：服务端返回 `sync_epoch=0` → 与本地记录一致 → **仍不触发重拉**（§6 验收口径 9）；
  - 任一步骤都不得出现 `watermark` 被清零。
- **实际**：
- **责任**：MiniApp + Backend
- **严重度**：P1

---

## 附：失败时的定位切口

| 现象 | 首查 |
|---|---|
| 收敛慢 / 每 60s 才一轮 | `syncPull` 是否真的进了 `while` 循环；`has_more` 是否被服务端返回 |
| 某月条数少于服务端 | 该月 `entry:index:…` 是否"存在但只含子集"（纪律 5/6 故障形态）；实体 key 是否齐全 |
| 导入数据拉不到 | `sync:epoch` 是否变化；导入是否走了同事务 `sync_epoch + 1` |
| 反复全量重拉 | `changes.ledgers` 是否为空（应跳过比对而非判 diff）；服务端 epoch 是否被单笔写入误加 |
| 本地删除的流水复活 | 该 op 是否已进 `outbox:__dead_letter`（**已知取舍**，见 L14） |
