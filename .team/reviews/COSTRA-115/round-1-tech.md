# COSTRA-115 · Review-Tech R1

- 审查人：Review-Agent-Tech
- 审查时间：2026-04-27 10:51（Asia/Shanghai · D-016 第 6 次实战同轮）
- 档位：T2（基建类 · 首次落地 CI 校验脚本 · D-013 判定 · 无 Product 侧 · 等 Human 终审）
- 对应 dispatch：`.team/dispatch/COSTRA-115-devops-dns-whitelist-ci.md`
- 对应交付响应：`.team/reviews/COSTRA-115/round-1-devops-response.md`

---

## 🎯 最终裁决

**VERDICT**：🟢 **APPROVE**

**SCORE**：**28/30**（扣 2 分 · 细节在 §5 评分细则）

**FINDINGS**：
- P0：**0**
- P1：**0**
- P2：**1**（豁免清单机制可配置化 · 非阻塞）
- INFO：**2**（脚本首跑暴露真实漂移 · 豁免机制合规性）

**建议 Human T2 终审**：直接 `approve:COSTRA-115`（Sprint-1 基建补口 · 1 点小卡 · 首跑即创造价值 · 无阻断项）。

---

## §1 DoD 对账（11 条）

| # | DoD | Agent 自述 | Review 核对结果 | 判定 |
|---|---|---|---|---|
| D1.1 | domains.md 四环境矩阵 | ✅ | 核对 §1 表格 4 行齐全（prod/dev/stg/api · 六列全） | ✅ |
| D1.2 | Human 操作清单三件套 | ✅ | §4.1 dig 验证命令 + §4.2 白名单填写步骤 · 三件套格式对齐 COSTRA-114 v2 | ✅ |
| D1.3 | DNS 子记录规划 | ✅ | §2 TTL 表 5 行 · 类型 A/CNAME 双分布合理 | ✅ |
| D2.1 | 脚本零依赖 | ✅ | grep import 仅 node:fs/path/url · zero npm dep 合规 | ✅ |
| D2.2 | OpenAPI servers 解析 | ✅ | --verbose 输出 4 条 URL 与 openapi.yaml L23-29 逐字一致 | ✅ |
| D2.3 | env.ts apiBaseUrl 解析 | ✅ | --verbose 输出 3 条与 env.ts L17/L28/L39 逐字一致 | ✅ |
| D2.4 | domains.md §1.1 解析 | ✅ | --verbose 输出 4 条与 §1.1 表逐字一致 | ✅ |
| D2.5 | 对账 · exit 码契约 | ✅ | 第一跑无豁免版：exit 1 + diff 打印正确；补豁免后：exit 0 + warning 打印 | ✅ |
| D3.1 | pr-check.yml 接线 | ✅ | grep 确认新 step 在 Typecheck 后 Test 前 · 带注释 · 不破坏原流水线 | ✅ |
| D4.1 | package.json 新脚本 | ✅ | `npm run check:whitelist --silent` 可执行 · exit 0 · 已验证 | ✅ |
| D7.1 | risks.md R-013 备注 | ✅ | R-013 行末追加"COSTRA-115 落地"段 · 状态标签改 `Mitigating（D-009 · CI 已就位）` | ✅ |

**DoD 对账结论**：**11/11 全绿 · 零缺项**

---

## §2 四闸验证复核

| 闸 | 结果 | Reviewer 复核 |
|---|---|---|
| `node --check scripts/devops/whitelist-check.mjs` | SYNTAX_OK | ✅ 认可 |
| `npm run check:whitelist` | exit 0 · 2 warning 豁免 | ✅ 认可 |
| `npm run typecheck` | exit 0 | ✅ 认可（本卡无 TS 改动 · 无退化） |
| `npm test` | 13/13 pass · 156ms | ✅ 认可（本卡无测试增减 · 无退化） |

---

## §3 脚本代码审查

### §3.1 parseOpenapiServers（SIMPLE_YAML_PARSER）

```js
function parseOpenapiServers(text) {
  const lines = text.split(/\r?\n/);
  let inServers = false;
  const urls = [];
  for (const line of lines) {
    if (/^servers:\s*$/.test(line)) { inServers = true; continue; }
    if (inServers) {
      if (/^\S/.test(line) && !/^\s*#/.test(line)) { inServers = false; continue; }
      const m = line.match(/^\s+-\s+url:\s*(\S+)\s*$/);
      if (m) urls.push(m[1]);
    }
  }
  ...
}
```

**评审**：
- ✅ 算法正确：顶级 `servers:` 匹配 · 遇到下一个顶级 key（非空白起始 · 非注释）结束
- ✅ 正则 `^\s+-\s+url:\s*(\S+)` 只抓 URL 不抓 description · 避免误解析
- ⚠️ 局限：不支持 YAML 锚点 `&ref` / YAML 列表紧凑写法 `[url1,url2]`。当前 openapi.yaml 未用，未来用时需升级（dispatch §8 风险段已登记）。

### §3.2 parseEnvTsApiBaseUrls

```js
for (const envName of ['dev', 'staging', 'prod']) {
  const blockRe = new RegExp(`^\\s{2,}${envName}\\s*:\\s*\\{`, 'm');
  ...
  const urlM = sliced.match(/apiBaseUrl\s*:\s*(['"])([^'"]+)\1/);
}
```

**评审**：
- ✅ 锚点规范：`^\s{2,}dev:` 要求至少 2 空格缩进 · 避免匹配 function 参数名等
- ✅ 2000 字节窗口足够（env.ts 每块实际 ~10 行 · 远小于 2000 字节）
- ✅ 正则兼容单双引号
- ⚠️ 不支持模板字符串 `\`${host}/v1\``：脚本会抛"未找到字面量"错，exit 2。合理 fail-fast，错误信息清楚（"必须为常量字符串，不支持模板/拼接"）

### §3.3 parseDomainsMdRuntimeTable

```js
const idx = text.indexOf('### 1.1');
...
if (/^\|\s*env\s*\|/.test(line)) { inTable = true; ... }
```

**评审**：
- ✅ §1.1 锚点明确 · 不会与其它表混淆
- ✅ 反引号包裹 URL 字段的解析 `cells[1].match(/`([^`]+)`/)` 精准提取
- ✅ 表格结束判定 `!line.startsWith('|')` break 正确
- ⚠️ 若 §1.1 被人挪到 §1.2，脚本会报"缺 §1.1 小节" exit 2 → 合理 fail-fast

### §3.4 reconcile 三规则

- **规则 A** OpenAPI ⊇ env.ts：✅ 正确（env.ts 是 MiniApp 运行期能发 request 的 URL 集，必须在契约里登记）
- **规则 B** env.ts ⊆ domains.md §1.1：✅ 正确（SSOT 兜底）
- **规则 C** 同名 env url 一致：✅ 正确（domains.md `dev` 不能说 `http://A` 而 env.ts `dev` 却是 `http://B`）
- **豁免清单机制**：✅ 合理（详见 §4 INFO-2）

---

## §4 INFO 条目

### INFO-1 · 脚本首跑暴露真实漂移（**本卡关键价值**）

Agent §3 INFO-A 已登记。Reviewer 独立复核：

- `env.ts dev = http://127.0.0.1:3000/v1`（MiniApp dev 默认）
- `openapi.yaml` 无此 URL（契约写 `http://localhost:8080/v1`）
- `server/.env.example PORT=8080`（部署默认）
- `server/src/config/env.ts parsePort 默认值 '3000'`（代码回退）

**Reviewer 确认**：这是 COSTRA-030（MiniApp 骨架）到 COSTRA-101（Backend 登录）之间的累积漂移 · COSTRA-030 R1 Review 当时未覆盖（Sprint-0 批次）· COSTRA-101 R3 提及 `'3000'` 时未提到与 openapi.yaml 冲突。**本卡 CI 脚本首跑即捕获，这是 CI 工具的正面价值验证**。

**处理评价**：Agent 正确选择不越权修复（Scope §3 禁止改 openapi / env.ts），而用豁免清单 + FU 登记机制兜底。**判断合规**。

**建议跨卡修复路径**（Reviewer 补充 Agent §3 INFO-A 方案）：
- 路径 Y（openapi 为权威）：改 Backend config 默认 '3000'→'8080' + 改 MiniApp env.ts dev URL 端口 · 本文件豁免常量清零
- 路径 Z（localhost 行为为权威）：改 openapi.yaml servers 首条为 `http://localhost:3000/v1` + 改 .env.example PORT=3000
- **Reviewer 推荐路径 Y**：openapi 是跨端契约 · 契约不动比契约动稳定

### INFO-2 · 豁免清单机制（合规工程化兜底）

**评价**：
- ✅ 显式常量 `EXEMPTED_ENVS_FROM_RULES_AB = new Set(['dev'])` · grep 即可审计
- ✅ 每条豁免带 `EXEMPTION_REASON` 字符串说明（本卡绑定 FU-COMMON-DEV-URL-DRIFT）
- ✅ Warnings 打印到 stderr · 不污染 CI summary · 便于诊断
- ✅ 不豁免规则 C（名称一致性硬约束 · 一致则不产生误差 · 不一致必报错）

**判断**：这是典型"债务登记点模式"，优于"硬修改源文件越权"或"关闭规则不检查"两条糟糕路径。

---

## §5 评分细则（30 分满）

| 维度 | 分 | 扣分项 |
|---|---|---|
| DoD 对齐 | 6/6 | 零缺项 · 11/11 全绿 |
| 脚本正确性 | 5/5 | 三方解析 + 对账规则 + 退出码契约三方面均通过 |
| 工程纪律 | 5/5 | 零依赖 · SIMPLE_YAML_PARSER 注释标注 · 豁免机制文档化 · 不越权 |
| CI 接线 | 4/5 | **扣 1 分 P2-1**：`Whitelist Consistency Check` 步骤未加 `if: always()` 保底 · 当 Typecheck fail 时本步不会跑；但如果 Typecheck fail 很可能也暗示 env.ts 被改坏 · 建议改 `if: success() || failure()` 总是跑（非阻塞）|
| 文档质量 | 4/5 | **扣 1 分 P2-2**：`infra/wechat/domains.md §1.1` 的\"env\"列用了 `local` / `dev-ip` / `staging` / `prod` 四个名字 · 其中 `local` 和 `dev-ip` 是本文件新造术语 · 脚本解析时与 env.ts 的 `dev` / `staging` / `prod` 不同名（本 CI 规则 C 因此跳过 local/dev-ip 两行不对账）· 建议 §1.1 增加一段落脚注说明这两个术语与 env.ts 三 env 的对应关系 |
| 能力边界合规 | 4/4 | Agent 明确声明无真机 DNS 后台访问 · 无微信后台操作 · 不改 openapi / env.ts · 完美合规 |
| **合计** | **28/30** | |

---

## §6 扣分项详述

### P2-1 · pr-check.yml Whitelist Check step 应在任何前序步骤失败时仍运行

**位置**：`.github/workflows/pr-check.yml` 新 step

**现状**：
```yaml
- name: Whitelist Consistency Check
  run: npm run check:whitelist
```

**问题**：若 Typecheck fail，`run` step 默认跳过；但 Whitelist 漂移是**与 Typecheck 正交的事实源偏离**，跳过会遗漏信号。

**建议改法**（非阻塞 · FU 级）：
```yaml
- name: Whitelist Consistency Check
  if: success() || failure()
  run: npm run check:whitelist
```

**落地**：**FU-115-WHITELIST-STEP-ALWAYS** · P2 · 可由 Human 终审时随手修 / 或 Sprint-1 末批次

### P2-2 · domains.md §1.1 术语与 env.ts env 名不同构导致对账视野盲点

**位置**：`infra/wechat/domains.md §1.1`

**现状**：§1.1 四行 env 列：`local / dev-ip / staging / prod` → 与 env.ts 的 `dev / staging / prod` 三 env 不同名。

**影响**：CI 规则 C（同名 env url 一致）实际只对 `staging` 和 `prod` 两行起作用；`dev` 名在 domains.md §1.1 中根本不存在（而是叫 `local`），规则 C 视野盲点。

**建议改法**（非阻塞）：
- 选项①：§1.1 表增加注释段说明\"env.ts 的 `dev` = domains.md §1.1 的 `local`\"
- 选项②：§1.1 表把 `local` 改名 `dev` + 把 `dev-ip` 改名 `dev-ip-transit`（与 env.ts 对齐）
- 选项③：脚本内加 env 名映射表 `{ dev: 'local' }`（更精确但增脚本复杂度）

**落地**：**FU-115-DOMAINS-MD-ENV-NAMING** · P2 · 可留 Sprint-1 末批次

---

## §7 Follow-ups 汇总

| FU-ID | 级别 | 来源 | owner_card | 状态 |
|---|---|---|---|---|
| **FU-COMMON-DEV-URL-DRIFT** | P1 | Agent §3 INFO-A + Reviewer §4 INFO-1 | **跨卡专项** · Sprint-1 末 Retro 议题 · Reviewer 推荐路径 Y（openapi 为权威） | `open` |
| FU-115-WHITELIST-STEP-ALWAYS | P2 | Reviewer §6 P2-1 | COSTRA-115（Human 终审前可修） | `open` |
| FU-115-DOMAINS-MD-ENV-NAMING | P2 | Reviewer §6 P2-2 | COSTRA-115（Human 终审前可修） | `open` |

---

## §8 Review 结论汇报

**Reviewer 签字**：**APPROVE · 28/30** · 0 P0 · 0 P1 · 2 P2（非阻塞 · FU 放行）· 2 INFO

**本卡正向评价**：
- 🏆 **CI 工具首跑即创造价值** · 暴露了 COSTRA-030→COSTRA-101 的累积端口漂移 · 非常典型的"好工具第一次运行就值回票价"场景
- ✅ 能力边界合规 · Agent 明确拒绝越权修 openapi/env.ts · 用豁免清单机制兜底
- ✅ 零依赖 Node 脚本 · SIMPLE_YAML_PARSER 边界注释清晰 · 未来升级路径明确
- ✅ Human 操作清单（§4.1 / §4.2）三件套格式完美对齐 COSTRA-114 v2 · 即用范式
- ✅ D-016 第 6 次实战同轮兑现（dispatch + 实装 + 响应 + Review 同一 tool call）

**转入 Human-Review 建议**：
- 推荐 Human 发 `approve:COSTRA-115` 直接终审（无阻断项 · 1 点小卡 · 审批成本低）
- 或 `revise:COSTRA-115 <fix P2-1>` 可选（若希望 Human 亲自见 FU-115-* 两条收掉）
- 不建议 `escalate`（无分歧）

**推荐 Human 下一步**：
1. ① **`approve:COSTRA-115`** · 1 点小卡收官 · COSTRA-115 移入 Done · R-013 保留 Open 待 ICP 下证
2. ② Sprint-1 末 Retro 时讨论 FU-COMMON-DEV-URL-DRIFT 专项修（或直接派一张 COSTRA-119 跨卡端口对齐小卡 · 0.5 点）
