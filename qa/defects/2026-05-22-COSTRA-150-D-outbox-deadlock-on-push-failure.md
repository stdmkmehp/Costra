# BUG-COSTRA-150-D-OUTBOX-DEADLOCK-ON-PUSH-FAILURE

> **缺陷单时间**：2026-05-22 11:48（Human 实测 `qa/costra-154-150-joint-smoke.md` §3.D 断言 D 触发 · COSTRA-154 + COSTRA-150 联合冒烟 · 真链路 BUG）
> **来源会话**：双卡联合 staging 实测 · 切 Offline → 写一笔 entry → 切 Online → **未触发 `[sync] network recover`** · DB 无新 entry · 4 步 outbox storage 诊断证实死锁
> **严重级别**：**P0**（任何 push 失败场景都导致 op 永久卡死 · 真机用户也受影响 · 不限 offline）
> **关联卡**：
> - **根因引入**：COSTRA-103 R1 commit `1e723c7`（`sync.ts:95-97` catch 静默吞错 + `outbox.ts:147` recover 分支只捞 `retries > 0`）
> - **暴露放大**：COSTRA-150 R1 commit `ee97a7a`（periodic 60s 调度器把潜伏 bug 暴露到联合冒烟）
> - **手册附带 BUG**：`qa/costra-154-150-joint-smoke.md` §3.D.1 误把 IDE Network 调试面板 Offline 当作 `wx.onNetworkStatusChange` 触发源
>
> **R1 Review 漏检**：
> - COSTRA-103 R1 review-tech 未识别 catch 静默 + drained-only-conflict-recover 组合形成的死锁路径
> - COSTRA-150 R1 review-tech 38/45 APPROVE · 未识别 periodic 触发器会放大 COSTRA-103 历史 bug
>
> **D-022 §4.1 真兑现**：runtime 类 T2 卡 Human 实测前置铁律第 3 次正向兑现（前两次：COSTRA-105 H6 BLOCKED-BY-154 / COSTRA-158 R1 storage envelope drift）
>
> **D-025 AP-001 第 2 次 Orchestrator 命中**：之前 Orchestrator 第 1 次错误把 Console 异常归为"IDE 自身行为"敷衍 · 经 Human 严肃纠偏 → 拉 miniapp-dev 重排查 → 定位到代码层根因
>
> **复现 Human 操作环境**：微信开发者工具 macOS 2.01.2510290 · 基础库 3.8.12 · COSTRA-150 R1.x.1 commit `5ac8153`（HEAD = `6200e15`）

---

## §1 现象

### §1.1 Human 实测路径（2026-05-22 11:00 ~ 11:48）

1. 按 `qa/costra-154-150-joint-smoke.md` §1 ~ §2 完成前置：dev server 启动 · 登录 · seed family/ledger · `__costra_family_id_v1` 注入 · §3.A 断言 A 通过
2. 进入 §3.D 断言 D：**在微信开发者工具 Network 调试面板切换为 Offline**
3. 在小程序中点击 `+` → 输入金额 12.34 元 → 保存（`pages/entry/index.ts:onSubmit` 调 `putEntry` + `enqueue` 双写本地）
4. 切回 Online · 等待 ≥5 秒 + ≥60 秒（覆盖 `network-recover` + 1 次 periodic）
5. **预期**：
   - Console 出现 `[sync] network recover · trigger sync`
   - Console 出现 `[sync] ok · pushed=1 pulled=0 watermark=... (trigger=network-recover)`
   - DB `entries` 表新增 1 行 amount=1234
6. **实际**：
   - Console **未出现** `[sync] network recover`
   - 60 秒后出现的是 `[sync] fail · CLIENT_NETWORK_ERROR request:fail (trigger=periodic)`（offline 阶段触发）
   - 切回 Online 后无任何 sync 行为
   - DB 无新行

### §1.2 outbox storage 诊断结果（4 步铁证）

Human 在 Console 执行：

```js
// 1. outbox 索引
wx.getStorageSync('outbox:__index')
// 返回：空数组 []

// 2. drained 队列
wx.getStorageSync('outbox:__drained')
// 返回：非空数组（含死锁 seq）

// 3. 反查 op 状态（取 drained[0]）
wx.getStorageSync('outbox:<seq>')
// 返回：{ retries: 0, ack_batch_key: 'idem-...', payload: {...}, ... }

// 4. wx.onNetworkStatusChange 监听验证
wx.onNetworkStatusChange(res => console.log('[TEST]', JSON.stringify(res)));
// 然后切 Offline → Online · [TEST] 一次都没打印
```

**4 条诊断结果联合解读**：

| 现象 | 含义 |
|---|---|
| `outbox:__index` 空 | drainBatch 已把 seq 从 index 移除（`outbox.ts:185-186`）|
| `outbox:__drained` 非空 | seq 卡死在 drained · 未被 ack 处理 |
| `op.retries === 0` | `incrementRetry` 未被调用 → ackResults 未被调用 → catch 静默吞错路径 |
| `onNetworkStatusChange` 不触发 | IDE Network 调试面板的 Offline 是请求拦截器 · 与 `wx.onNetworkStatusChange` 是两套独立机制 |

---

## §2 根因（双 BUG · 协同形成 P0）

### §2.1 直接根因 A · `sync.ts:95-97` catch 静默吞错（COSTRA-103 R1 引入）

文件：`miniprogram/services/sync.ts`

```ts
// L74-103 pushDelta 当前实装
export async function pushDelta(): Promise<{
  pushed: number;
  conflicts: number;
  rejected: number;
}> {
  const batch = await drainBatch(200);                    // ← 把 seq 从 index 移到 drained
  if (!batch) return { pushed: 0, conflicts: 0, rejected: 0 };

  const { batch: ops, batchKey } = batch;

  try {
    const resp = await request<{ results: PushResultItem[] }>({...});
    if (resp?.results) {
      await ackResults(batchKey, resp.results);           // ← 成功路径 · 处理 drained
    }
  } catch {
    // ❌ 注释自欺：自称"留 outbox · 等下次重试"
    // ❌ 实际：drained 中的 seq 永远不会被复原 · index 永远不会取回
    // 网络级别失败：整批留 outbox · idempotency_key 不变 · 等下次重试
  }

  // ❌ 历史包袱：永远返回 0 · void 抑制 lint · 让上层永远不知道实际推了几条
  const pushed = 0, conflicts = 0, rejected = 0;
  void pushed; void conflicts; void rejected;
  return { pushed, conflicts, rejected };
}
```

**注释撒谎**："等下次重试" —— 但 drainBatch 下次运行时不会捞它（见 §2.2）。

### §2.2 直接根因 B · `outbox.ts:147` recover 分支只捞 conflict（COSTRA-103 R1 引入）

文件：`miniprogram/services/outbox.ts`

```ts
// L143-160 drainBatch 内部 recover 分支
if (drained.length > 0) {
  for (const seq of drained) {
    const op = await getItem<SyncOp>(opKey(seq));
    if (!op) { pendingDrained = pendingDrained.filter(s => s !== seq); continue; }
    if (op.retries > 0) {                                  // ❌ 只 recover retries>0 的 op
      // conflict op（retries > 0）：直接 append 到本轮 batch
      ...
      batch.push({ ...op });
    }
    // ⚠️ retries === 0 的 drained op 被静默忽略 · 永远不进 batch
  }
  ...
}
```

**设计缺陷**：drained 状态被赋予了"专属于 conflict 重试"的隐式语义 · 但 drained 的真正物理含义应是"已 drain 出去 · 待 ack"。当 push 失败但未走 ackResults 路径时（catch 吞错），retries=0 的 drained op 成为孤岛。

### §2.3 协同效应 · 死锁三段论

```
阶段 1 (offline 阶段 · periodic 60s 触发或 launch 触发)：
  syncOnce → pushDelta → drainBatch
  → 把 op[seq] 从 index=[seq] 移到 drained=[seq]
  → POST /sync/push 网络失败
  → catch 块吞错 · 不调 ackResults
  → outbox 状态：index=[] · drained=[seq] · op.retries=0 · ack_batch_key 已写

阶段 2 (offline 阶段 · 用户记一笔 entry)：
  enqueue(newOp) → 写 outbox:{newSeq} + index=[newSeq]
  → outbox 状态：index=[newSeq] · drained=[seq] (旧死锁项不动)

阶段 3 (online 恢复后 · 任意触发)：
  syncOnce → pushDelta → drainBatch
  → recover 分支扫 drained=[seq]：op.retries=0 → 跳过
  → 主循环扫 currentIdx=[newSeq]：取出 newSeq · 加入 batch · 移到 drained
  → POST /sync/push（这次成功 · server 处理 newOp）
  → ackResults(batchKey, results) 处理 newSeq → 物理删除
  → outbox 状态：index=[] · drained=[seq] (旧 op 仍卡死 · newOp 已上传)

⚠️ 但本次 BUG 报告的现象是切 Online 后 DB 无新 entry · 所以阶段 3 没发生
   原因：onNetworkStatusChange 不触发 → 没有 network-recover trigger
        + Human 没等够下一个 60s periodic 周期就停止观察
        + 即使等够 · 死锁的 op 永远在 drained 不会被推送
```

### §2.4 第 3 个根因 · 手册 §3.D.1 IDE Network 面板理解错误（COSTRA-150 配套手册引入）

文件：`qa/costra-154-150-joint-smoke.md` §3.D.1 步骤 1

```
1. 在微信开发者工具 Network 面板 → 切换为 **Offline**
```

**事实**：IDE 的 Network 调试面板 Offline 模式底层是 Chromium CDP `Network.emulateNetworkConditions`，仅拦截 HTTP 请求，**不修改运行时网络状态**，因此 **不触发** `wx.onNetworkStatusChange`。

要触发 `wx.onNetworkStatusChange`，必须用以下任一方式：
- 微信开发者工具**模拟器面板**（顶部手机图标处的网络类型切换：WiFi / 2G / 3G / 4G / 无网络）
- 真机切换 WiFi / 飞行模式
- 真机物理拔网线

**Human Console 验证（4 步诊断第 4 条）证实**：用 IDE Network 面板切 Offline/Online · 监听 callback 一次都没触发。

### §2.5 深层根因 · D-025 AP-002 概率极低就接受变种

`sync.ts:95` catch 块的"网络级别失败：整批留 outbox · idempotency_key 不变 · 等下次重试" 注释是 D-025 AP-002 的**典型反模式表现**：

- 程序员凭印象写下"留 outbox" → 默认这条路径"应该没事"
- 没有断点验证 drained 中的 seq 在下次 drainBatch 时是否真能被取出
- COSTRA-103 单测覆盖了 ackResults ok / conflict / rejected NOT_FOUND 三态 · **但未覆盖"pushDelta 完整调用且 POST 失败"的端到端路径**

→ 单测覆盖盲点：缺一条"网络失败 · drained op 必须能在下次 drainBatch 时被取回"的端到端测试。

---

## §3 修复方案（彻底干净 · 不背历史包袱）

### §3.1 设计哲学

> **drained 的语义统一为"已 drain 出去等待 ack"**。pushDelta 作为唯一向 drained 写入的入口，必须为**所有结束路径**（成功 / 部分成功 / 全网络失败 / 全异常失败）承担清理 drained 的责任。

### §3.2 修复点 1 · `outbox.ts` 新增 `ackBatchFailure` API

**目的**：让 pushDelta 在 catch 路径中显式标记本批次为"网络失败"·把 drained 中本批次的 seq 复原到 index · 让下次 drainBatch 自然能取出 · 同时 retries 递增（用于未来指数退避兜底）。

新增导出：

```ts
// outbox.ts · 新增（紧邻 ackResults 之后）
/**
 * 标记本批次整体失败（POST /sync/push 网络异常 · 没有 results 可消费）
 * 设计：从 drained 取出本批次所有 seq · retries 递增 · 复原到 index · 等下次 drainBatch 自然取出
 * 与 ackResults 互斥：成功响应（含部分 conflict/rejected）走 ackResults · 完全网络失败走 ackBatchFailure
 * @param batchKey 批次 idempotency_key
 */
export async function ackBatchFailure(batchKey: string): Promise<number> {
  const allDrained = await readDrained();
  const thisBatchSeqs: number[] = [];
  const otherDrained: number[] = [];

  for (const seq of allDrained) {
    const op = await getItem<SyncOp>(opKey(seq));
    if (op && op.idempotency_key === batchKey) {
      thisBatchSeqs.push(seq);
    } else {
      otherDrained.push(seq);
    }
  }

  // 从 drained 移除本批次 + 写回 index + retries 递增（用于将来指数退避）
  await writeDrained(otherDrained);
  if (thisBatchSeqs.length === 0) return 0;

  const newIdx = await readIndex();
  const now = Date.now();
  for (const seq of thisBatchSeqs) {
    const op = await getItem<SyncOp>(opKey(seq));
    if (!op) continue;
    op.retries = await incrementRetry(op.client_ref_id);
    op.next_retry_at = now;  // 立即可重试 · 不走指数退避（R1 决定）
    await setItem(opKey(seq), op);
    if (!newIdx.includes(seq)) newIdx.push(seq);
  }
  await writeIndex(newIdx);

  return thisBatchSeqs.length;
}
```

### §3.3 修复点 2 · `sync.ts:74-103` 重写 pushDelta

**彻底删除**：
- ❌ `pushed=0,conflicts=0,rejected=0` 假返回值 + `void` 抑制
- ❌ catch 静默吞错的注释欺骗
- ❌ 文件头部"COSTRA-103 R1"卡号注释（保留 · 不动 · 但更新关键注释）

**重写后**：

```ts
export async function pushDelta(): Promise<{
  pushed: number;
  conflicts: number;
  rejected: number;
  failed: number;       // 新增：网络/异常失败的 op 数（已复原到 index）
}> {
  const batch = await drainBatch(200);
  if (!batch) return { pushed: 0, conflicts: 0, rejected: 0, failed: 0 };

  const { batch: ops, batchKey } = batch;

  try {
    const resp = await request<{ results: PushResultItem[] }>({
      method: 'POST',
      path: '/sync/push',
      body: { ops },
      idempotencyKey: batchKey,
    });

    // 服务端响应（含部分 conflict/rejected）走 ackResults 三态消费
    const results = resp?.results || [];
    await ackResults(batchKey, results);

    let pushed = 0, conflicts = 0, rejected = 0;
    for (const r of results) {
      if (r.status === 'ok') pushed++;
      else if (r.status === 'conflict') conflicts++;
      else rejected++;
    }
    return { pushed, conflicts, rejected, failed: 0 };
  } catch (e) {
    // 网络/超时/HTTP 4xx/5xx 异常 → 整批没有 results 可消费 → ackBatchFailure 复原
    const failed = await ackBatchFailure(batchKey);
    return { pushed: 0, conflicts: 0, rejected: 0, failed };
  }
}
```

### §3.4 修复点 3 · `outbox.ts:143-160` 修正 recover 分支语义

**当前**只 recover `retries > 0` 的 conflict op。**修复后**：drained 的物理含义统一为"已 drain · 等待 ack 或失败处理"。如果 ackResults 已正确处理则 drained 不会有遗留；如果出现遗留（理论上不应有 · 防御性编程），无差别 recover。

```ts
// outbox.ts:143-160 重写
if (drained.length > 0) {
  // 防御性 recover：理论上 ackResults / ackBatchFailure 已清理 drained
  // 此分支仅兜底"遗留孤儿"场景（异常中断 · storage 损坏等）
  // 任何 drained 中的 op 都视作"已发出但未 ack"· 无差别复原到本轮 batch
  for (const seq of drained) {
    const op = await getItem<SyncOp>(opKey(seq));
    if (!op) {
      pendingDrained = pendingDrained.filter(s => s !== seq);
      continue;
    }
    op.next_retry_at = now + 1;  // 防止本轮主循环重复取（next_retry_at > now 过滤）
    pendingDrained = pendingDrained.filter(s => s !== seq);
    currentIdx = currentIdx.filter(s => s !== seq);
    batch.push({ ...op });
  }
  if (pendingDrained.length !== drained.length) {
    await writeDrained(pendingDrained);
  }
}
```

⚠️ 这个分支保留为**纯兜底**。正常路径下 drained 在 pushDelta 一次完整调用后必为空。

### §3.5 修复点 4 · 手册 `qa/costra-154-150-joint-smoke.md` §3.D.1

把"在微信开发者工具 Network 面板 → 切换为 **Offline**"改为：

```
1. 在微信开发者工具**模拟器面板**（顶部手机图标位置）→ 切换网络类型为"无网络"
   ⚠️ 不要使用 Network 调试面板的 Offline · 那是请求拦截器 · 不触发 wx.onNetworkStatusChange
   事实源：本 BUG 卡 §2.4 · Human Console 4 步验证铁证

   备选：用真机预览 + 飞行模式（最接近真实用户场景）
```

并在 §3.A.2 / §3.D.5 PASS 判据中明确："IDE Network 调试面板的 Offline 不触发 network-recover · 必须用模拟器网络类型切换或真机飞行模式"。

### §3.6 单测补强（必须加）

**T-NEW-1**：`outbox.spec.ts` 加 `ackBatchFailure` 端到端测试

```ts
it('ackBatchFailure → drained 中的本批次 seq 复原到 index · retries 递增 · 下次 drainBatch 取回', async () => {
  await enqueue({ op: 'create', entity: 'entry', client_ref_id: 'net-fail-1', base_version: null, payload: { amount: 100, ... } });
  const result = await drainBatch(200);
  expect(result).not.toBeNull();
  expect(await __peek()).toHaveLength(1);  // 仍在（drained 也算 peek）

  // 模拟网络失败：调 ackBatchFailure 而非 ackResults
  const recovered = await ackBatchFailure(result!.batchKey);
  expect(recovered).toBe(1);

  // 下次 drainBatch 必须能取回
  const result2 = await drainBatch(200);
  expect(result2).not.toBeNull();
  expect(result2!.batch).toHaveLength(1);
  expect(result2!.batch[0].client_ref_id).toBe('net-fail-1');
  expect(result2!.batch[0].retries).toBe(1);
});
```

**T-NEW-2**：`outbox.spec.ts` 加多轮失败死锁防御测试

```ts
it('连续 3 次网络失败 + 1 次成功 · op 最终能上传', async () => {
  await enqueue({ op: 'create', entity: 'entry', client_ref_id: 'persist-1', ... });

  // 失败 3 次
  for (let i = 0; i < 3; i++) {
    const r = await drainBatch(200);
    expect(r).not.toBeNull();
    await ackBatchFailure(r!.batchKey);
  }

  // 第 4 次成功
  const r4 = await drainBatch(200);
  expect(r4).not.toBeNull();
  expect(r4!.batch[0].retries).toBe(3);  // 累积 3 次
  await ackResults(r4!.batchKey, [{ client_ref_id: 'persist-1', status: 'ok', server_id: 's1', server_version: 1 }]);
  expect(await __peek()).toHaveLength(0);  // 物理删除
});
```

**T-NEW-3**：`syncScheduler.spec.ts` 改 T3 · 验证 pushed 真值传递

```ts
// 现有 T3 mock 返回 pushed=2 · 但因 sync.ts 历史 bug · 实际 pushed 永远是 0
// 修复后 T3 应能验证 pushed 真值（mock 已是 2 · 现在 sync.ts 真返回 2）
expect(result!.pushed).toBe(2);  // 修复前：实际 pushDelta 返回 0 · 此处会 fail
```

→ T-NEW-3 是回归保护：未来再出现 pushed 假返回会被立即拦截。

---

## §4 修复路径决策（待 Human）

| 选项 | 含义 | 估时 | 影响 |
|---|---|---|---|
| **A** | R1.x.2 同轮修订 · miniapp-dev 改 sync.ts + outbox.ts + 加 3 个单测 + 修订手册 §3.D · 单 commit | ~60 min | 阻 154+150 联合 approve · 必须重测断言 D（用模拟器面板）|
| **B** | 新立 R2 · 含 dispatch 重写 + review-tech + Human 重测 | ~3 h | 流程过重 · 不必要 |
| **C** | 暂跳过断言 D · 仅 approve A/B/C/E 4/5 · D 留 Sprint-3 后续 | 0 | 留 P0 隐患到生产 · 严禁 |

**Orchestrator 推荐 A**（R1.x.2 同轮修订）：
- 修复量：sync.ts ~30 行 + outbox.ts ~40 行 + 单测 ~80 行 + 手册 ~10 行 ≈ 160 行
- 虽 > 5 行但仍属"集中修复 · 不引入新功能"· 符合 R1.x 范式
- 阻 approve 是必要的（P0 真机也复现 · 不能放过）
- 修完后必须重测：断言 A（无 fail）+ 断言 D（用模拟器面板）+ 单测全绿
- 顺带带上手册修订 · 防止下次实测重蹈覆辙

---

## §5 回滚 / 清死锁 outbox 的临时 hotfix（Human 修复前继续观察用）

如果 Human 想先清掉当前死锁的 outbox 状态再观察后续行为：

```js
// Console 一次性清空 outbox（仅开发环境 · 生产不要用）
wx.removeStorageSync('outbox:__index')
wx.removeStorageSync('outbox:__drained')
wx.removeStorageSync('outbox:__retries')
// 注：单条 op key（outbox:<seq>）会成为孤儿 · 但不影响下次 enqueue
//     真要彻底清理：wx.getStorageInfoSync().keys.filter(k => k.startsWith('outbox:')).forEach(wx.removeStorageSync)
console.log('outbox cleared · 下次 enqueue 重置')
```

---

## §6 联合 Sprint-3 末 Retro 议题候选（沉淀）

- 🆕 **议题 · D-025 AP-001 第 2 次 Orchestrator 命中**：本次首轮 Orchestrator 把 Console 错误归为"IDE 行为"敷衍 · Human 严肃纠偏后 才进入正确排查链。AP-001 反模式扩展到 Orchestrator 自身（不只是 dispatch / review-tech）
- 🆕 **议题 · D-025 AP-002 概率极低就接受变种**：`sync.ts:95` catch 块的"等下次重试"注释是典型 AP-002 · 程序员凭印象写代码不验证。建议 review-tech 加扫描项："任何 catch 块的 // 等下次重试 / // 应该没事 / // 一般不会 注释必须配套断言或单测验证"
- 🆕 **议题 · 单测覆盖盲点**：outbox.spec.ts 当前覆盖 ackResults 三态 · 但缺"端到端 push 网络失败"路径。review-tech C6 维度漏检 · 议入 "outbox 单测覆盖范式 v2"
- 🆕 **议题 · 手册编写范式**：`qa/costra-154-150-joint-smoke.md` §3.D.1 误把 IDE Network 面板等同 `wx.onNetworkStatusChange` 触发 · qa-planner 编写手册前必须手动在 IDE 验证一次而非凭文档假设。议入 "qa-planner 手册事实源验证铁律"
- 🆕 **议题 · 状态机一致性铁律**：`outbox.ts` 的 drained / index 双状态机当前缺一致性不变量校验。建议加运行时断言："drained 中的任何 seq 在 pushDelta 一次完整调用后必为空（除并发竞态）"

---

## §7 修订记录

| 版本 | 时间 | 修订 |
|---|---|---|
| v1.0 | 2026-05-22 11:48 | 初版立案 · Human 联合冒烟 §3.D 触发 · 4 步 Console 诊断证实双 BUG · 修复方案彻底干净版（不背历史包袱）+ R1.x.2 路径建议 |

---

**事实源 / 依据**：

- COSTRA-103 R1 commit `1e723c7`（`sync.ts:95-97` catch 静默 + `outbox.ts:147` recover only-conflict 实装）
- COSTRA-150 R1 commit `ee97a7a`（`syncScheduler.ts` periodic 60s 调度器）
- COSTRA-150 R1.x.1 commit `5ac8153`（`startScheduler` `[未经验测]` 标注）
- 手册 `qa/costra-154-150-joint-smoke.md` §3.D.1 / §3.A.2 / §3.D.5
- Human 实测 Console 4 步 outbox 诊断输出（2026-05-22 11:35 ~ 11:48）：
  - `wx.getStorageSync('outbox:__index')` = `[]`
  - `wx.getStorageSync('outbox:__drained')` = 非空数组
  - `wx.getStorageSync('outbox:<seq>')` = `{ retries: 0, ack_batch_key: 'idem-...', ... }`
  - `wx.onNetworkStatusChange` callback 在 IDE Network 面板 Offline/Online 切换时未触发
- 代码事实源：
  - `miniprogram/services/sync.ts` L74-103（pushDelta 当前实装）
  - `miniprogram/services/outbox.ts` L143-160（drainBatch recover 分支）+ L182-186（drained 写入逻辑）+ L197-268（ackResults 三态消费）
  - `miniprogram/services/syncScheduler.ts` L120-125（onNetworkStatusChange 注册）+ L128-130（periodic 60s）
  - `miniprogram/services/outbox.spec.ts`（6 个单测覆盖 · 缺端到端网络失败路径）
- 关联范式：
  - D-022 §4.1 runtime 类 T2 卡铁律（第 3 次正向兑现）
  - D-025 AP-001 字符串代理判定（Orchestrator 第 2 次自我命中）
  - D-025 AP-002 概率极低就接受（catch 注释"等下次重试"）
  - 关联 BUG：`qa/defects/2026-05-19-COSTRA-158-storage-envelope-drift.md`（同属"模块抽象 vs 调用方"微观契约漂移类）
