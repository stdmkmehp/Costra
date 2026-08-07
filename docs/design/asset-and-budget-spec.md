# 账本资产 + 每月预算 · 方案(评估稿 v2)

> 卡号:COSTRA-4xx(拟定)· 状态:待评估
> v2 变更:根据用户反馈重写关键章节
> - §1.1 transfer 不影响资产
> - §1.2 预算只做总预算,`budgets` 表**重建**
> - §2.3 资产修改入口只放明细页(小编辑标)
> - §4 **change_seq 到底能不能做baseline** 的深度分析(§4.1)
> - §7 并发/锁/乐观锁的完整时序推演(§7)
>
> v2.1 修订(2026-08-07落地评估):
> - §4.2 update/softDelete swap SQL 明确"JS 侧预取反 + SQL 只做加法",`balance_version` 单次业务动作只 +1
> - §5.4 敏感字段不走outbox 决策(替代原来"ledger op 走 outbox")
> - §6 停服脚本 `--verify` 扩展为同时校验 balance_cents + baseline_seq
> - §7.5 rebase 上限 ±10^15 分校验(避免 Number 精度丢失)
> - 补充 16 个 balance/budget 核心测试(server/test/balance-and-budget.test.ts)

事实源锚定:
- `server/db/migrations/0001_init.sql` `ledgers` / `entries` / `budgets` 表
- `server/src/repositories/entryRepo.ts` L141-255 `change_seq` 三条路径的更新逻辑
- `server/src/services/entryService.ts` 现有 create/update/softDelete
- `docs/api/sync-protocol.md` `change_seq` 增量协议

---

## 1. 概念定义

### 1.1 资产 asset

- **归属**:`ledgers.balance_cents`(账本级,family:ledger=1:1)
- **累加规则**:
  - `type='income'` → 资产 += amount
  - `type='expense'` → 资产 -= amount
  - **`type='transfer'` → 资产不动**(本次决策)
  - 流水软删 → 反向回退相应贡献
  - 流水update(改amount / type) → 先回退旧贡献,再叠加新贡献
- **用户手动修改(重锚rebase)**:允许用户把资产改为任意值 `X`。
  - 触发一次"重锚",把 `balance_cents = X` + baseline 更新到"当前时刻"
  - 语义:**只有此次重锚之后新产生的流水才继续叠加**;之前的历史流水视为"已消化"
- **展示**:明细页顶部第 3 行左侧 `资产 ¥28,313.88✎`

### 1.2 预算 budget

- **归属**:新建 `budgets_v2` 表(现表**删除重建** ·见 §3.2)
- **粒度**:仅"账本月度总预算"(不做分类预算)
- **上限**:`budgets.amount_cents`,用户设定
- **已消耗**:当月 `entries.type='expense' AND deleted_at IS NULL AND occurred_at ∈ [monthStart, monthEnd)` 的 `SUM(amount)`
- **剩余**:`amount_cents - spent`(可为负 = 超支)
- **展示格式**:`预算 ¥1,000.00 / ¥3,000.00`(左剩余、右上限)
- 未设置 → `预算 未设置`(灰度、点击进设置)

---

## 2. 前端展示

### 2.1 布局

明细页 `.header` 从两行扩为三行:
```
-¥3,001.29←(不动)
收入 ¥31,315.17 · 结余 ¥28,313.88                       ←(不动)
资产 ¥28,313.88 ✎    预算 ¥1,000.00 / ¥3,000.00        ←新增
```

### 2.2 视觉规范(莫兰迪 4 段色阶,你已OK)

| p = remain/total | 语义 | token | hex |
|-----------------|------|-------|-----|
| p ≥ 50% | 宽裕 | `--budget-safe` | `#8AA689` |
| 20~50%  | 提示 | `--budget-hint` | `#C4B58D` |
| 0~20%   | 警戒 | `--budget-warn` | `#C39A80` |
| p ≤ 0   | 超支 | `--budget-over` | `#A87878` |

- 上限数字永远 secondary 灰;只染剩余数字
- 深浅色模式各出一版token(Design 精修)

### 2.3 资产修改入口(第 4 问明确)

**只放明细页**,采用"小编辑标"暗示:

```
资产 ¥28,313.88 ✎
```

- `✎` 用极小的 secondary 灰度铅笔图标(20rpx),紧贴数字右侧
- 点击整个"资产 + 数字 + ✎"热区打开半屏键盘(复用现有 keypad-sheet)
- 键盘输入完成后弹二次确认:

  > 修改后仅之后的流水会继续叠加到资产上,是否确认?
  > [取消] [确认修改]

- 客户端提交后进入"资产同步中"loading 态(1s内消失,否则显示 toast)

**理由**:预算和资产都是明细页 header的显示项,把修改入口就近放在明细页,用户无需切页;`✎` 图标克制不破坏首屏视觉。

### 2.4 预算修改入口

- 点击"预算 未设置" chip 或点击已有的预算文字块→ 打开同样的半屏键盘
- 无二次确认(预算修改是幂等的,直接生效)

---

## 3. 数据模型变更

### 3.1 `ledgers` 表新增字段

```sql
-- migration 0012_ledger_asset.sql
ALTER TABLE ledgers
  ADD COLUMN IF NOT EXISTS balance_cents        BIGINT   NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS balance_baseline_seq BIGINT   NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS balance_version      INTEGER  NOT NULL DEFAULT 1;

COMMENT ON COLUMN ledgers.balance_cents        IS '账本资产净值(分)';
COMMENT ON COLUMN ledgers.balance_baseline_seq IS '资产累加基线(见 §4.1 分析)';
COMMENT ON COLUMN ledgers.balance_version      IS '资产乐观锁版本(独立于 ledgers.version)';
```

`balance_version` **独立于 `ledgers.version`**,避免"改资产"与"改账本名"互相 conflict。

### 3.2 `budgets` 表重建(第 7 问)

现有 `budgets` 表设计得更接近"分类预算",且线上未启用,直接删表重建:

```sql
-- migration 0013_budgets_v2.sql

DROP TABLE IF EXISTS budgets CASCADE;
DROP TYPE  IF EXISTS budget_period;

CREATE TABLE budgets (
  id             UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  ledger_id      UUID        NOT NULL REFERENCES ledgers(id) ON DELETE CASCADE,
  month          CHAR(7)     NOT NULL CHECK (month ~ '^[0-9]{4}-[0-9]{2}$'),
  amount_cents   BIGINT      NOT NULL CHECK (amount_cents > 0),
  currency       TEXT        NOT NULL DEFAULT 'CNY',
  updated_by     UUID        NOT NULL REFERENCES users(id),
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at     TIMESTAMPTZ,
  version        INTEGERNOT NULL DEFAULT 1
);

CREATE UNIQUE INDEX uq_budgets_ledger_month
  ON budgets (ledger_id, month) WHERE deleted_at IS NULL;

CREATE INDEX idx_budgets_updated_at ON budgets (updated_at);

-- 复用现成的 touch_updated_at 触发器
CREATE TRIGGER trg_budgets_updated_at BEFORE UPDATE ON budgets
  FOR EACH ROW EXECUTE FUNCTION touch_updated_at();
```

**变化点**:
- 去掉 `category_id`、`period`、`alert_threshold`、`alerted_at`(未来若需要再加)
- `amount` 明确改名`amount_cents`,与项目"金额字段命名"约定对齐
- 加 `updated_by` 便于多人账本审计
- 唯一键从 `(ledger_id, category_id, month)` 收敛为 `(ledger_id, month)`

### 3.3 `entries` 表不改结构

`change_seq` 已经在 INSERT/UPDATE/softDelete 三条路径都推进(见 §4.1事实源确认),本方案直接复用。

---

## 4. 核心技术分析

### 4.1 change_seq 到底能不能做 balance_baseline_seq?(第 6 问,重点)

#### 4.1.1 事实源:change_seq 是怎么更新的?

从 `server/src/repositories/entryRepo.ts` 核对:

| 路径 | change_seq 更新方式 | 事实源 |
|------|-------------------|--------|
| INSERT | `DEFAULT nextval('entries_change_seq')` | L138 注释 + `0001_init.sql` L270 |
| UPDATE | 显式 `SET change_seq = nextval('entries_change_seq')` | L219-220 |
| softDelete | 显式 `SET change_seq = nextval('entries_change_seq')` | L246-247 |

`entries_change_seq` 是**全库唯一一个 SEQUENCE**(0001_init.sql L51-52),**所有账本共用同一个 sequence**。

#### 4.1.2 关键结论:change_seq 是 entries 决定的,不是账本决定的

- change_seq 的推进是**每次 entries 写操作 nextval 一次**,与账本无关
- **同一 sequence 全局共享** → **不同账本 A、B 的 change_seq 完全交错**
  - 例:账本 A 记账 → seq=100;账本 B 记账 → seq=101;账本 A 又记账 → seq=102
  - 单个账本自己的 change_seq **不是连续的**,只是**单调递增**
- 但对**单个账本内部**而言,change_seq 依然严格单调(sequence 只增不减)

#### 4.1.3 那change_seq 能做 balance_baseline_seq吗?**能。**

我们只需要"账本内部" `new_change_seq > baseline_seq` 的语义,不需要"全球连续"。

**幂等谓词 `new_change_seq > baseline_seq` 成立的两个必要条件**:
1. 单个账本内部 change_seq 严格单调 → ✅ sequence 只增
2. 每次 entries 写(INSERT / UPDATE / softDelete)都推进一个新 seq → ✅ 三条路径都覆盖

**但要正确处理"UPDATE / softDelete 时旧贡献回退"**:

UPDATE 会把 entries 的 `change_seq` 从 old_seq 推进到 new_seq。若我们需要判"这条 entry 之前是否曾计入过balance",不能用 new_seq(推进后)判——**必须先在事务内SELECT ... FOR UPDATE 读到旧的 change_seq(old_seq),然后同时用 old_seq / new_seq 分别决定"回退旧贡献"和"叠加新贡献"是否发生**。

见 §4.2 SQL。

#### 4.1.4 换个方案:用不用 change_seq 的替代?

- ❌ **用 `updated_at`**:时钟不单调(NTP 回拨)、pg 主从可能不一致 → 现存 sync 就是因为它换成 change_seq 的(BUG-COSTRA-154)
- ❌ **用 `ledgers.version`**:粒度太粗,不能区分"某笔流水是否在 rebase 之前"
- ❌ **新建 `ledger_change_seq`(账本级独立 sequence)**:引入两个 sequence,双写不一致风险,复杂度飙升
- ✅ **复用 entries.change_seq**:三条路径已经全部覆盖,天然单调,零改造成本

**结论:change_seq 完全可以做 balance_baseline_seq,但配套 SQL 必须在事务内先读 old_seq 再做 delta 计算。**

### 4.2 事务内的完整 SQL

#### create 分支

```sql
BEGIN;

-- 1) 插入 entry,拿到新分配的 change_seq
INSERT INTO entries (...) VALUES (...)
  RETURNING id, change_seq;
-- 假设返回 new_seq

-- 2) 根据 type 决定 delta
--    income  → +amount, expense → -amount, transfer → 0
-- 3) 一次 UPDATE 完成:行锁 + 幂等谓词
UPDATE ledgers
   SET balance_cents  = balance_cents + $delta,
       balance_version = balance_version + 1
 WHERE id = $ledger_id
   AND $new_seq > balance_baseline_seq
   AND $delta <> 0;   -- transfer 时 no-op,不产生 UPDATE 锁开销

COMMIT;
```

关键点:
- **UPDATE 的 WHERE 会拿行锁**,同一账本的所有并发 entry 写自动串行,不会丢累加
- **`$new_seq > baseline_seq` 谓词** = "如果这个流水是 rebase 之前的老流水,不叠加"
- transfer 或 delta=0 时 UPDATE 无行匹配,不产生行锁 → 减少无谓竞争

#### update 分支

```sql
BEGIN;

-- 1) 事务内先 FOR UPDATE 读旧值(锁行)
SELECT amount, type, change_seq
  INTO old_amount, old_type, old_seq
  FROM entries
 WHERE id = $entry_id AND deleted_at IS NULL
 FOR UPDATE;

-- 2) UPDATE entries(触发 change_seq = nextval,得到 new_seq)
UPDATE entries
   SET amount = $new_amount, /*或其他字段 */
       version = version + 1,
       change_seq = nextval('entries_change_seq')
 WHERE id = $entry_id AND version = $base_version AND deleted_at IS NULL
 RETURNING change_seq;
-- 假设返回 new_seq;无行返回 → 409 conflict,ROLLBACK

-- 3) 计算 delta(旧贡献回退 + 新贡献叠加,两个谓词独立判)
--    old_delta = (old_type='income' ?  old_amount
--               : old_type='expense'? -old_amount : 0)
--    new_delta = (new_type='income' ?  new_amount
--               : new_type='expense'? -new_amount : 0)

UPDATE ledgers
   SET balance_cents = balance_cents
       + CASE WHEN $old_seq > balance_baseline_seq THEN $old_refund ELSE 0 END
       + CASE WHEN $new_seq > balance_baseline_seq THEN $new_delta  ELSE 0 END,
       balance_version = balance_version + 1
 WHERE id = $ledger_id;

COMMIT;
```

> **实现细节** :`old_refund = -old_delta` 由 JS 侧预先取反,SQL 只做加法。原因是 pg-mem 不支持 `-$N`(unary minus on parameter)。真PG 也接受这个形态,行为等价。
>
> **关键约束** :单条 UPDATE → `balance_version` 每次业务动作只 +1 ,乐观锁语义一致 。绝不能拆成两次 UPDATE。

**为什么两个谓词都要判**:
- rebase 之前的老流水修改 amount:old_seq ≤ baseline,new_seq > baseline
  → 旧贡献不回退(本来就没算过),新贡献叠加 → **符合"重锚之后的动作都要影响资产"语义**
- rebase 之后的新流水修改amount:old_seq > baseline,new_seq > baseline
  → 旧贡献回退,新贡献叠加 → 相当于净差额

**这是本方案最关键的语义:重锚之后对老流水的编辑,也算重锚后的新动作,应该影响资产。** 这与你在 §1.1 定义的"只有用户修改资产之后的流水会继续叠加到资产上"是一致的——update 会推进 change_seq,new_seq 就是"重锚之后的动作"。

#### softDelete 分支

```sql
BEGIN;

SELECT amount, type, change_seq INTO old_amount, old_type, old_seq
  FROM entries WHERE id = $entry_id AND deleted_at IS NULL FOR UPDATE;

UPDATE entries
   SET deleted_at = now(),
       version = version + 1,
       change_seq = nextval('entries_change_seq')
 WHERE id = $entry_id AND version = $base_version AND deleted_at IS NULL
 RETURNING change_seq;
-- new_seq;无行 → 409

-- 删除相当于"新贡献 = 0"
UPDATE ledgers
   SET balance_cents = balance_cents
       + CASE WHEN $old_seq > balance_baseline_seq THEN -$old_delta ELSE 0 END,
       balance_version = balance_version + 1
 WHERE id = $ledger_id;

COMMIT;
```

#### 用户重锚 rebase 分支

```sql
BEGIN;

-- 1) 拿到账本当前最大 change_seq(此刻的一致快照)
--    ⚠️ 用子查询而非 SELECT 后再 UPDATE,避免多语句读写间隔时的时序漂移
UPDATE ledgers
   SET balance_cents         = $new_balance_cents,
       balance_baseline_seq  = COALESCE(
         (SELECT MAX(change_seq) FROM entries WHERE ledger_id = $id),
         0
       ),
       balance_version = balance_version + 1
 WHERE id = $id
   AND balance_version = $client_base_version
 RETURNING balance_cents, balance_baseline_seq, balance_version;
-- 无行 → 409(乐观锁失败)

COMMIT;
```

**关键**:baseline 取 `MAX(change_seq)` 是"当前时刻的照片"——只要事务隔离级别 ≥ READ COMMITTED,子查询和UPDATE 在同一事务快照内一致(见 §7.4)。

---

## 5. 客户端方案

### 5.1 明细页 header 数据来源

- 资产从 `ledgers` 本地缓存读(sync-pull 已下发 ledgers 就带上新字段)
- 预算通过 `services/budgetApi.ts` 拉,缓存到 `wx.storage` 键 `budget:${ledger_id}:${month}`

### 5.2 资产的乐观更新原则

- **客户端不本地累加资产**,理由:
  - 客户端不知道服务端当前 baseline
  - 本地未 push 的流水没有 change_seq
- **策略**:每次记账/编辑/删除完成后,触发一次 `syncPull` 拉最新 balance_cents
- 中间态显示上一次的资产值 + 极小的"同步中" spinner(500ms 后再显示,避免闪烁)

### 5.3 预算的乐观更新

- spent 可以本地增量算(明细页已经有月度支出,直接减)→ 即时更新 UI
- sync 完成后按服务端权威值校准

### 5.4 outbox 变化(v2 修订 ·敏感字段不走 outbox)

**决策**:资产 rebase 与预算 upsert **不进 outbox**,客户端直接调用 REST(PATCH /ledgers/:id/balance / PUT /budgets)。

**理由**:
- §7.2 场景 B 已定义"资产是敏感字段,不允许并发写入静默胜出"。若走 outbox,弱网时用户点了确认,后续会在用户视线之外重放并可能被 409;用户看不到"你的修改被别人抢先"的即时反馈,与"敏感字段策略"矛盾。
- 预算 upsert 幂等且不涉及累加,直连 REST 语义清晰;若走 outbox,PUT 与 GET 之间的 spent 快照不一致会给用户"改完了看不到新剩余"的错觉。
- 流水/分类走 outbox 是因为它们是"多条累积"的高频动作,资产/预算是"单条低频"的边缘操作,不需要 outbox 的批量+重试能力。

**客户端策略**:
- 离线/弱网调用 rebaseBalance / upsertBudget:
  - 请求失败 → 直接抛出 ApiError,UI 显示 toast:「网络异常,请稍后再试」
  - 不排队、不静默重试
- 409 冲突:UI 弹冲突弹窗(见 §7.5)
- 用户离线期间只能查看上次 sync-pull 拉到的 balance/budget 缓存值,**修改被禁**(编辑入口置灰或点击提示"离线中")

**sync-push 契约**:
- `entity` 枚举保持 `entry | category | budget`(**不加`ledger`**);sync/push 不承接 budget 写路径(budget 走独立 REST · 服务端 sync push 中的 budget op 已废弃,返 NOT_IMPLEMENTED)
- 后续如出现"分类预算"这种多维幂等写场景,再考虑接outbox

---

## 6. 停服迁移

### 6.1 步骤

**Step A · 停服**
- API 网关切"账本只读"(POST/PATCH/DELETE 全部 503)
- 客户端弹"账本维护中,预计 5-10 分钟"

**Step B · 迁移 SQL(幂等)**

```sql
BEGIN;

-- 1) ledgers 加字段(migration 0012)已在部署时执行

-- 2) 数据回填
WITH per_ledger AS (
  SELECT
    ledger_id,
    COALESCE(MAX(change_seq), 0) AS max_seq,
    COALESCE(SUM(
      CASE type
        WHEN 'income'  THEN  amount
        WHEN 'expense' THEN -amount
        ELSE 0
      END
    ), 0) AS net_cents
  FROM entries
  WHERE deleted_at IS NULL
  GROUP BY ledger_id
)
UPDATE ledgers l
   SET balance_cents        = p.net_cents,
       balance_baseline_seq = p.max_seq,
       balance_version      = balance_version + 1
  FROM per_ledger p
 WHERE l.id = p.ledger_id;

-- 3) budgets 删表重建(migration 0013)已在部署时执行

COMMIT;
```

**Step C · 校验**

```sql
-- 抽样账本重新计算,与balance_cents 对比
SELECT l.id, l.balance_cents, calc.net_cents
  FROM ledgers l
  JOIN (
    SELECT ledger_id, SUM(...) AS net_cents FROM entries ... GROUP BY ledger_id
  ) calc ON calc.ledger_id = l.id
 WHERE l.balance_cents <> calc.net_cents;
-- 期望返回 0 行
```

**Step D · 恢复**
- API 网关关闭只读
- 客户端下次 sync-pull 拉到新字段

### 6.2 时长评估(第 5 问,你已确认千人级)

- 千人量级 × 平均每人 500 条流水 → 50 万 entries
- 单条 SUM 计算 <1μs,聚合 UPDATE 秒级完成
- **总窗口预估:< 3 分钟**(含 API 网关切换 + 校验)

### 6.3 迁移期间的写入等待

- API 只读 →客户端所有写入(记账/编辑/删除)排队在 outbox
- 恢复后 outbox 自动 drain
- 若客户端在迁移前已进入"改资产"流程,恢复后重放会409(balance_version 已 +1),客户端要先重新拉最新值再重试(见 §7.5)

---

## 7. 并发/锁/乐观锁 深度分析(第 8 问,重点)

### 7.1 用到的三类锁 + 它们的关系

| 机制 | 类型 | 何时释放 | 用途 |
|------|------|---------|------|
| **PG 行锁**(`ledgers` 行) | 悲观| 事务提交/回滚自动释放 | 多个并发 entry 写串行叠加 balance |
| **PG 行锁**(`entries` 行,`SELECT FOR UPDATE`) | 悲观 | 事务提交/回滚自动释放 | update/softDelete 内先读旧值再改 |
| **`balance_version` 乐观锁** | 乐观 | 不占资源(WHERE 谓词判定) | 用户重锚资产的冲突识别 |
| **`entries.version` 乐观锁** | 乐观 | 不占资源 | 已有 · 用于流水本身的冲突识别 |
| **PG SEQUENCE `entries_change_seq`** | 无锁(内部原子) | 不占资源 | 单调递增的水位 |

**关键原则**:
- PG 行锁**只在事务内**,commit/rollback 都释放,**不会出现锁泄漏**
- 乐观锁**不占任何 DB 资源**,只是 WHERE 谓词判断,失败返回空行 → app 层抛 409
- SEQUENCE 的 nextval 是**独立于事务的**,即使事务回滚,分配出去的 seq 也不会回退(有 gap 是正常的)

### 7.2 完整并发场景推演

#### 场景 A:两个成员并发记账(A/B 同时新增 entry)

```
时刻 T1:  A: BEGIN → INSERT entries (seq=100) → 需要 UPDATE ledgers[X]
时刻 T2:  B: BEGIN → INSERT entries (seq=101) → 需要 UPDATE ledgers[X]

T3: A 先执行 UPDATE ledgers[X] → 拿到行锁
T4: B 执行 UPDATE ledgers[X] → 等待 A 的锁
T5: A COMMIT → 释放锁
T6: B 拿到锁 → 应用累加 → COMMIT
```
**结果**:两次累加都生效,balance_cents 正确,seq 严格递增。**无锁泄漏、无丢单**。

#### 场景 B:A 记账 + B 改资产 并发

```
T1: A: BEGIN → INSERT (seq=100) → UPDATE ledgers[X]  ← A 拿行锁
T2: B: BEGIN → UPDATE ledgers[X] (rebase)             ← B 等待
T3: A COMMIT → 释放锁
T4: B 执行 UPDATE:baseline = MAX(change_seq)  → 至少是 100(因为 A 的 seq=100 已提交)
    B 用当前的 balance_version(可能已被 A 推进过一次)
    - 若 B 客户端拿的是 v1,而 A 已推到 v2 → B 的 UPDATE WHERE version=1 无匹配 → 409
    - 若 B 客户端拿的是最新 v2,A 的 UPDATE 让它变v3 → B 的 UPDATE 无匹配 → 409
    实际上 A 的 entry 写会推进 balance_version(+1),B 若不重拉,基本会 409
T5: B 收到 409 → 客户端重拉最新 balance → 弹"资产已被更新"提示
```
**结果**:B 明确知道被 A 抢先,可以选择"覆盖为我的值"或"接受最新值"。**无静默丢失**。

**注意**:场景 B 里A 的记账会推进 `balance_version`,B 的乐观锁很容易 409。这是**预期行为**——资产是敏感字段,不允许并发写入静默胜出。

#### 场景 C:两个成员同时重锚资产(A/B 都改资产)

```
T1: A: BEGIN → UPDATE ledgers[X] WHERE balance_version=v1 → 拿行锁 → 成功 → 推到 v2
T2: B: BEGIN → UPDATE ledgers[X] WHERE balance_version=v1 → 等待 A 的锁
T3: A COMMIT
T4: B 拿到锁 → 但 balance_version 已是 v2 → WHERE 不匹配 → 0 行 → 409
T5: B 重拉最新值 → 弹提示"资产已被 A 修改为 X,你的修改 Y 是否覆盖?"
```
**结果**:一方赢,一方 409。**无死锁**(串行等待,不构成循环)。

#### 场景 D:A 改资产 + B 删流水 并发

```
T1: A: BEGIN → UPDATE ledgers[X] (rebase) → 拿行锁 → 假设 baseline 更新为 N
T2: B: BEGIN → UPDATE entries SET deleted_at (seq=old_seq → seq=new_seq) → 无需 ledgers 锁?
   ⚠️ 不对:B 也需要 UPDATE ledgers[X] 来回退旧贡献 → 等待 A
T3: A COMMIT(baseline = N)
T4: B 拿到锁→ 应用 delta:
    - CASE WHEN old_seq > N THEN -old_delta ELSE 0 END
    - 如果这条流水在 rebase 之前 → old_seq ≤ N → 不回退(符合"重锚前的流水已消化"语义)
    - 如果这条流水在 rebase 之后 → old_seq > N → 回退
```
**结果**:语义正确,不会出现"删了rebase 之前的流水,资产反倒变化"。

#### 场景 E:离线 outbox 迟到上传

```
A 在飞机上离线记账 100 元(客户端本地时间 T0)
B 在地面记账 200 元(T0+5min,seq=500)
B 在 T0+10min 修改资产(rebase,baseline 更新为 500)
A 落地重连,outbox 重放 push 那笔 100 元
  服务端 INSERT entries →分配 seq=501(rebase 之后)
  → UPDATE ledgers WHERE 501 > 500 → 累加  ← 正确
```
**如果 A 的记账是在 rebase 之前发起但迟到上传**:
- outbox 上传时才INSERT,依然拿到 seq=501(recover 之后的 seq)
- **不管客户端"何时开始记这一笔",服务端视角这就是"新流水"**
- baseline 只关心服务端 change_seq,不关心客户端本地时间

这个语义是不是符合预期?建议**符合**——用户视角:"我在飞机上记的账,着陆同步后才影响资产,这是符合'服务端视角的新动作'的常识"。

#### 场景 F:同一账本同一流水 update 并发(A/B 同时改同一条 entry)

```
T1: A: BEGIN → SELECT FOR UPDATE entry[Y] → 拿 entries 行锁
T2: B: BEGIN → SELECT FOR UPDATE entry[Y] → 等待
T3: A: UPDATE entry[Y] version=1 → 2 → 推进 change_seq → UPDATE ledgers → COMMIT
T4: B 拿到锁 → SELECT 读到最新版本(version=2)
    → 但 B 的 UPDATE 用的是 base_version=1 → WHERE 不匹配 → 0 行 → 409
    → B ROLLBACK,不会污染 ledgers
```
**结果**:双重保护,无污染。

### 7.3 死锁分析

**多张表 UPDATE 的顺序**:所有事务都遵循"先 entries 后 ledgers"的顺序:

1. update/softDelete:`SELECT FOR UPDATE entries` → `UPDATE entries` → `UPDATE ledgers`
2. create:`INSERT entries` → `UPDATE ledgers`
3. rebase:直接 `UPDATE ledgers`(不动entries)

**是否会出现循环等待?**

- 事务 X 持 entries[Y] 锁,等ledgers[L] 锁
- 事务 Z 持 ledgers[L] 锁,等 entries[Y] 锁?

Z 不会去等 entries[Y]。Z 要么是:
- create 分支:先 INSERT(拿新行的锁,不与已有行冲突)再 UPDATE ledgers
- update 另一条 entry:锁的是 entries[Y'],不是 [Y]
- rebase:只锁 ledgers[L]

**结论:所有路径都按"entries 先 → ledgers 后"的顺序,不构成循环等待,不会死锁。**

### 7.4 事务隔离级别的选择

Postgres 默认 `READ COMMITTED`,本方案够用吗?

- `READ COMMITTED` 下,每条SQL 都能看到已COMMIT 的最新数据
- rebase 的子查询 `SELECT MAX(change_seq)` 会读到"此刻已 COMMIT 的最大 seq"
- 如果就在 rebase 的 SELECT 和 UPDATE 之间,又有一笔新entry 提交了seq=N+1
  → rebase 读到 baseline=N → 但这条 seq=N+1 的 entry 在插入时已经把它自己叠加到了 balance
  → rebase 用的 balance_cents 也是"包含 N+1 贡献"的最新值(读时机)
  → 语义:**"我 rebase 到值 X,而 X 已经包含了那笔迟到的 N+1"** → 符合预期

**但如果 rebase 的 UPDATE 用了子查询 `MAX(change_seq)` 而这个子查询与 UPDATE 语句不在同一 snapshot?**

PG 的 `UPDATE ... SET x = (SELECT ...) WHERE ...` 在 `READ COMMITTED` 下:
- 子查询和 UPDATE 是**同一条语句**,共享同一 snapshot
- UPDATE 加行锁后重新拿 snapshot 也不影响子查询(子查询已经在语句开始时求值)

**安全**。不需要升级到 `REPEATABLE READ`。

### 7.5 客户端 outbox / 409 处理

-ledger update op 走 outbox,base_version 用 `balance_version`
- push 收到 409 → 客户端**不重试**,而是:
  1. 抛给 UI:"资产已被其他成员修改,最新值 ¥X,是否覆盖为你的 ¥Y?"
  2. 用户选覆盖 → 重新拉最新 balance_version → 重新 enqueue
  3. 用户选放弃 → outbox 丢弃这个 op

**这是敏感字段的强制策略**,对齐 `docs/api/conflict-strategy.md`。

### 7.6 极端场景:能否卡死?

**Q: 如果一个 entry 写的事务卡在 UPDATE ledgers,其他所有 entry 都排队等,会不会雪崩?**

A: 单账本的行锁本身是必然存在的(要保证累加正确),但:
- 每个事务只涉及**极短**的两次 UPDATE(entry + ledger),微秒级
- 千人量级、平均每账本 QPS < 1,行锁排队几乎不会发生
- 若真出现慢查询,可以从慢查询日志识别,加超时(`statement_timeout`)兜底

**Q: 长事务持有锁?**

A: entryService 的 create/update/softDelete 事务里**不做任何网络 IO、不 sleep**,只有 SQL,不会长事务。

**Q: 应用崩溃导致锁泄漏?**

A: PG 行锁绑定 backend 进程,client 连接断开自动 rollback 释放锁。**只要不用 prepared transactions,不会泄漏**。

---

## 8. 契约变更

- `Ledger` schema 加 `balance_cents / balance_baseline_seq / balance_version`
- 新增 `GET /ledgers/{id}/balance` API（客户端主动拉取资产 · 明细页首屏即时校准）
- 新增 `PATCH /ledgers/{id}/balance` API
- 新增 `GET /budgets`、`PUT /budgets` API
- `sync/pull` 的 `ledgers[]`:每次都返回 family 下所有 ledger(1:1,数据量可忽略),不引入 ledger change_seq 复杂度

---

## 9. 里程碑

| 阶段 | 动作 | 闸门 |
|------|------|------|
| M0 | 本文件评审(PM + Backend + Design) | G1 |
| M1 | migration 0012 + 0013 + entryService 事务改造 + 三条 API | G3 |
| M2 | Design 出 4 段色token + `✎` 标 + 修改交互稿| G2 |
| M3 | MiniApp 明细页 header 第 3 行 + 键盘半屏 + 二次确认弹窗 | - |
| M4 | 迁移脚本在 staging 演练 | - |
| M5 | 生产停服窗口(< 3 min)+ 迁移 + 恢复 + 灰度 | G5 |

---

## 10. 遗留待定

- 资产/预算的**订阅消息推送**(超支提醒)留 FU
- 分类预算留 FU
- 资产变更审计日志(谁在什么时候把资产从 X 改到 Y)写 `audit_logs` 表 · 建议 M1 一起做
