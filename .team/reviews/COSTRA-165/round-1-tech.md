# Tech Review · COSTRA-165 · Round 1

- 被审 Agent：miniapp-dev
- 本轮产出 commit：`3472864`
- 审核时间：2026-05-27T17:30:00+08:00
- 上轮结论：首轮实装审（Card-Review R2 PASS 28/30 已闭合 · 无前轮 P0/P1 承接）
- 审查者装扮：costra-review-tech（D-022 v2.0 + D-025 §2 反模式扫描 + C8-3 runtime）

> **注**：本报告由 Orchestrator 在 spawn `costra-review-tech` 后接收 final message · 物理落盘（SBAI v1.1 · D-014）

## 总评

- **Verdict**：`APPROVE`
- **总分**：**38/40 分**（≥36 APPROVE · 一轮过 · 与 COSTRA-164 R1.x APPROVE 38/40 范式对齐）
- **阻塞点**：0 个 P0 / 0 个 P1 / 2 个 P2

## 维度得分

| 维度 | 得分 | 一句话 |
|---|---|---|
| C1 实装契合度 | 5/5 | dispatch v1.1 全 5 项 scope A~E 完整落地 + R2 P2 实装期处理（mockLogin 分支同步补字段 + refreshToken mock 路径写 family-context）已兑现 |
| C2 测试充分性 | 5/5 | 69/69 全绿（含 11 新测 T1~T11）· family.spec 6 测覆盖设/读/清/legacy/envelope · auth.spec 5 测覆盖双源一致性/升级 fallback/refresh 失败兜底/空字符串保护/契约对齐 · syncScheduler.spec T2 mock 重构已落地 |
| C3 协议契合 | 5/5 | TokenRaw 与 server AuthTokenPair（authService.ts:39-59）1:1 对齐 · buildStored 兼容新增字段 · mockExchange 已同步补齐 expires_in/timezone/created_at/updated_at/default_family_id/default_ledger_id |
| C4 错误处理 | 5/5 | initAuth fallback：refresh 失败 → clearToken + clearActiveFamily（不弹 toast 强制）· refreshToken 空字符串保护 `if (resp.default_family_id && resp.default_ledger_id)` 正确利用 JS falsy · logout 流程 clearActiveFamily 在 clearToken 之前调（顺序正确） |
| C5 可读性 | 5/5 | 注释密度高：COSTRA-165 + ADR-0007 + FU-164 + P1-1/P1-3 锚点交叉引用齐全 · 函数命名与 dispatch 一致 · family.ts 全新独立 · auth.ts 接入点不打散原结构 |
| C6 边界与防御 | 4/5 | LEGACY_FAMILY_ID_KEY 一次性清理到位 · 双源一致性 T7 覆盖 · entry FALLBACK 防御层 + 诊断日志 · mockLogin 隔离 · 扣 1 分：getActiveFamilyId/getActiveLedgerId 各自独立调 getItem 导致理论上两次 storage 读取不完全原子（极低概率不一致 · 实际 storage 是同步缓存底层 · 不影响运行时） |
| C7 文档同步 | 5/5 | state.md 已更新 · history 已落盘 · FU-150-FAMILY-CONTEXT-SERVICE 状态 `partial-closed`（等联合 approve · 非 closed 时机正确）· 不需 docs/api/ 改动（client 卡） |
| C8 红线 | 4/5 | C8-1 runtime 实测必须性已标注 · C8-3 syncScheduler.ts:99 `[未经验测]` 标注到位 · C8-4 错误路径单测覆盖 · 扣 1 分：auth.ts doWxLogin 真实链路 L238-247 的 `setActiveFamily` + `globalData` 同步写入无 `[未经验测]` 标注（虽然 initAuth fallback 有标注 · 但 doWxLogin 也是 storage 跨页 + globalData 共享的 runtime 场景） |

## P0 阻塞点（必改）

（无）

## P1 应改

（无）

## P2 建议

### P2-1 getActiveFamilyId/getActiveLedgerId 非原子双读

- **证据**：`miniprogram/services/family.ts:32-43`（getActiveFamilyId 读一次 getItem + getActiveLedgerId 再读一次 getItem）
- **问题**：两个函数各自独立调 `getItem<FamilyContext>(FAMILY_CONTEXT_KEY)` 理论上不是原子操作 · 若 setActiveFamily 在两次读取之间被调（极低概率 · 仅在并发登录/refresh 场景），family_id 和 ledger_id 可能来自不同版本的 context · 实际上微信小程序 storage 底层是同步缓存 + getItem 是 async 但无真正 I/O 竞争 · 当前 R1 阶段风险极低
- **依据**：C6 边界与防御维度
- **修复建议**：R2 加 family 切换器时考虑提供 `getActiveFamilyContext(): Promise<FamilyContext | null>` 一次读取接口 · 供需要同时消费 family_id + ledger_id 的调用方使用
- **严重度**：P2 · 当前不影响运行时 · R2 切 family UI 时顺带优化
- **FU 候选**：FU-165-GET-CONTEXT-ATOMIC

### P2-2 doWxLogin 真实链路 setActiveFamily 无 [未经验测] 标注

- **证据**：`miniprogram/services/auth.ts:238-247`（doWxLogin 真实链路 setActiveFamily + globalData 同步写入）
- **问题**：与 syncScheduler.ts:99 的 `[未经验测]` 标注范式一致 · doWxLogin 同样涉及 storage 跨页持久化 + globalData 共享 · 但缺少 C8-3 平台 SDK 假设标注 · 虽然 Human 实测 DoD 已明确覆盖 4 场景（含全新登录）· 标注有助于 review 后续维护者理解哪些路径需真机验证
- **依据**：D-022 C8-3 平台 SDK 假设标注规约
- **修复建议**：在 doWxLogin 真实链路 setActiveFamily 调用前加 `// [未经验测]（D-022 C8-3）: storage 写入后跨页面读取依赖微信 storage 实现 · 需真机验证` 注释
- **严重度**：P2 · 不影响功能正确性 · 仅标注完备性
- **FU 候选**：FU-165-DOWXLOGIN-RUNTIME-ANNOTATION

## D-025 反模式扫描结论

| AP | 命中 | 证据 / 否决理由 |
|---|---|---|
| AP-001（字符串代理判定） | 不命中 | family.ts FamilyContext 接口显式类型定义（`{ family_id: string; ledger_id: string }`）· storage key 常量不作为状态判定依据 · 无业务字段字符串硬比较推断语义 |
| AP-002（概率极低就接受） | 不命中 | v1.1 修正后 initAuth 走 refresh 触发刷新（透明无 UX 退化）· 不再是"toast 重登不当接受" · AP-002 在 Card-Review R1 命中 · R2 闭合 · R1 实装兑现 |
| AP-003（契约-实装漂移） | 不命中 | TokenRaw 加字段是对齐 server AuthTokenPair 已有字段（不是漂移）· 不动 openapi.yaml（164 范围）· 不引入新 deferred |

**结论**：命中 0 条 · 无新引入反模式

## C8 红线判定

| C8 项 | 判定 | 证据 |
|---|---|---|
| C8-1 runtime 实测必须性 | ✅ 命中 D-022 §4.1 | storage 跨页持久化 + 登录链路 + sync 调度联动 · DoD 已标注 Human 实测覆盖 4 场景 · 单测 + Review 不可单独 approve |
| C8-2 跨版本对照 | N/A | 不涉及 SDK 版本变更 |
| C8-3 平台 SDK 假设标注 | ⚠️ 部分缺失 | syncScheduler.ts:99 已标注 `[未经验测]` · auth.ts doWxLogin 真实链路缺标注（P2-2）· initAuth fallback 有注释说明 refresh 路径依赖 |
| C8-4 错误路径 runtime 验证 | ✅ 单测覆盖 | T9（refresh 失败兜底）/ T10（空字符串保护）/ T5（syncScheduler 5xx 静默失败） |

**C8 总判定**：PASS（C8-1 命中但 DoD 已登记 Human 实测前置 · C8-3 标注缺失记 P2-2 · 不阻塞 approve）

## 物理验证汇总表

| 验证项 | 命令 | 期望 | 实际 | 结果 |
|---|---|---|---|---|
| 单测全绿 | `cd miniprogram && npm test` | 69/69 | 69/69 ✅ | PASS |
| TypeScript typecheck | `npx tsc --noEmit` | 0 error | 0 error ✅ | PASS |
| ESLint | `npm run lint` | 0 error | 0 error ✅ | PASS |
| check:appjson | `npm run check:appjson` | 全绿 | 10 pages · 4/4 pass ✅ | PASS |
| check:tooling | `npm run check:tooling` | 全绿 | 3/3 rules pass ✅ | PASS |
| check:whitelist | `npm run check:whitelist` | 全绿 | 3 envs · 3 URLs matched ✅ | PASS |
| 工作区铁律 | `git show 3472864 --name-only` | 仅 miniprogram/ + .team/members/miniapp-dev/ | 9 文件全在工作区内 ✅ | PASS |
| D-008 主体红线 | `grep -rn 'tencent\|腾讯\|company\|inc\|corp'` 7 文件 | 0 命中 | 0 命中（grep 返回的 'income' 是 type 枚举 · 非主体字样）✅ | PASS |
| AppID 红线 | `grep -rn 'wxf8b0d3e3a83f9941' miniprogram/` | 仅 README.md | 仅 README.md L15/L45（非打包源码 · 是开发者文档）✅ | PASS |
| 敏感数据泄漏 | `grep 'access_token\|refresh_token' auth.ts \| grep console` | 0 命中 | 0 命中 ✅ | PASS |
| 单文件行数 | `wc -l` 7 文件 | 均 ≤ 500 行 | 最大 auth.spec.ts 396 行 ✅ | PASS |
| commit 规范 | `git log 3472864 -1 --format='%s'` | feat(miniapp): + lowercase subject | `feat(miniapp): costra-165 r1 family-context service + auth 接入` ✅ | PASS |

## TokenRaw ↔ AuthTokenPair 1:1 对齐验证

| 字段 | server AuthTokenPair (authService.ts:39-59) | client TokenRaw (auth.ts:21-42) | 对齐 |
|---|---|---|---|
| access_token | `string` | `string` | ✅ |
| refresh_token | `string` | `string` | ✅ |
| access_token_ttl_sec | `number` | `number` | ✅ |
| refresh_token_ttl_sec | `number` | `number` | ✅ |
| expires_in | `number`（@deprecated） | `number`（required） | ✅ |
| user.id | `string` | `string` | ✅ |
| user.nickname | `string` | `string` | ✅ |
| user.avatar_url | `string \| null` | `string \| null` | ✅ |
| user.timezone | `string` | `string` | ✅ |
| user.has_completed_profile | `boolean` | `boolean` | ✅ |
| user.created_at | `string` | `string` | ✅ |
| user.updated_at | `string` | `string` | ✅ |
| default_family_id | `string` | `string` | ✅ |
| default_ledger_id | `string` | `string` | ✅ |

**结论**：14/14 字段完全对齐 · 无漂移

## 给被审 Agent 的回执指令

COSTRA-165 R1 **APPROVE 38/40** · 可进入 Human T1 终审 + 164 联合 staging 实测阶段。

2 项 P2 为非阻塞性建议（记入下一 Sprint backlog 或 R2 实装时顺带处理）：
1. P2-1：提供 `getActiveFamilyContext()` 一次读取接口（优化双读原子性）→ FU-165-GET-CONTEXT-ATOMIC
2. P2-2：doWxLogin 真实链路补 `[未经验测]` 标注（标注完备性）→ FU-165-DOWXLOGIN-RUNTIME-ANNOTATION

## 自我反思

- 本次审核耗时估计：35 分钟
- 置信度：**高**
  - 9 文件全读 + 源码逐行对照 dispatch v1.1 §2.1 A~E 五项 scope ✓
  - 14 项物理验证命令执行（6 闸门 + 工作区铁律 + D-008 + AppID + 敏感数据 + 行数 + commit 规范）✓
  - TokenRaw ↔ AuthTokenPair 14 字段逐项对齐验证 ✓
  - server refresh 路径（authService.ts:256-277）返回 default_family_id/default_ledger_id 确认 ✓
  - D-025 三项反模式逐项扫描 ✓
  - C8 四项红线逐项判定 ✓
- 无需转 Human 二裁
