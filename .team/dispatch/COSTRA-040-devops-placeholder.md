# COSTRA-040 · DevOps 占位流水线（不依赖 robot key / 备案域名）

> ✅ **DONE**（Orchestrator `execute-now` 代笔落地 · 2026-04-21 17:45）
> 产物回链：`.github/workflows/{pr-check,main-build,mp-preview,mp-release}.yml` · `scripts/mp-ci/{preview,upload,size-check,analyze,build-check,_lib}.mjs` · `scripts/mp-ci/README.md` · `docs/devops/{ci-cd,secrets,branch-protection}.md` · `.env.example`
> 闸门：**G5 Preempt-Ready**（占位链路可跑；真实上传待 `miniprogram-ci` robot key / 备案域名到位后按 `docs/devops/secrets.md §激活清单` 激活）
> 固定 status check：`ci/pr-check`；主包红线 1.5MB、总包 16MB 已在 `size-check.mjs` 落地。

---

> 派发人：Orchestrator
> 接收人：**DevOps-Agent**
> 派发时间：2026-04-21 15:44 (Asia/Shanghai)
> 完工时间：2026-04-21 17:14（Orchestrator 代笔）
> 截止：2026-04-23 EOD
> 优先级：P1
> 闸门影响：G5（发布闸门预埋，不激活）
> 分类：**占位交付**（Placeholder Delivery）

---

## 1. 背景

Human 在 2026-04-21 15:29 batch approve 了"continue"并补充指令 **`dispatch-devops`**：
在 robot key / 备案域名 / HTTPS 证书到位前，先搭 **占位 CI/CD 流水线 + `miniprogram-ci` 本地脚本骨架**，等资源到位一键激活，避免 Sprint-1 生产发布前才开始做 CI 导致发布闸门延期。

**红线**：本轮禁止消耗任何真实密钥，禁止触发真实微信小程序上传，禁止创建云资源。所有敏感字段以 `${{ secrets.XXX }}` 或 `.env.example` 占位。

---

## 2. 目标（What）

交付一套**能跑 lint/typecheck/test/build，但在"上传预览版/正式版"阶段优雅短路**的流水线，产物包括：

1. GitHub Actions workflow 套件（PR 校验 / 主干构建 / 预览上传占位 / 正式上传占位）
2. `miniprogram-ci` 本地脚本骨架（preview + upload，robot key 由环境变量注入）
3. 依赖缓存与工件上传策略（跨 job 复用 node_modules / 构建产物）
4. Secrets 清单与运维手册（`docs/devops/ci-cd.md`）
5. 分支保护与合并策略建议（写进手册，供 Human 在 GitHub 端开启）
6. `.env.example` + 本地一键 `pnpm run mp:preview` / `pnpm run mp:upload` 入口（仅骨架，缺 key 时友好报错）

**非目标**：不做服务端部署流水线（Backend 暂未定部署形态，等 COSTRA-021 compose 落地后再在 Sprint-1 补）；不做真实微信侧预览上传；不做 CDN / 监控接入。

---

## 3. 输入（Inputs）

| 来源 | 文件 | 关键点 |
|---|---|---|
| charter | `docs/charter.md` §9/§13 | 外部资源缺口、Conventional Commits、关键节点提交 |
| 工程约束 | `.team/engineering-guidelines.md` | 分支策略 `feat/*` `fix/*` `chore/*`；提交类型集 |
| ADR-0004 | `.team/decisions/ADR-0004-miniapp-runtime-details.md` | 分包体积红线（主包 ≤ 1.5MB）、Flag/金额/灰度 |
| MiniApp 骨架（同步交付） | `miniprogram/`（COSTRA-030） | 入口路径、`project.config.json`、TS 配置 |
| Backend 契约（同步交付） | `server/`（COSTRA-020/021） | 仅读 lint/test 脚本位置，不触发部署 |
| 微信官方 | https://developers.weixin.qq.com/miniprogram/dev/devtools/ci.html | `miniprogram-ci` API |

> 注：DevOps 与 MiniApp 并行进行，若 04-22 EOD 前 `miniprogram/` 未就绪，workflow 可在 `if: hashFiles('miniprogram/project.config.json') != ''` 条件下跳过小程序相关 job，并在 job summary 中标注 "skipped: miniapp skeleton pending"。

---

## 4. 交付物（Deliverables）

### 4.1 GitHub Actions Workflows

路径 `.github/workflows/`，共 4 个文件：

#### 4.1.1 `pr-check.yml`（PR 校验 · 必须通过）

触发：`pull_request` to `main` / `dev`
Jobs：
1. **setup**：checkout、安装 pnpm、缓存 `~/.pnpm-store` 与 `node_modules`
2. **lint**：
   - 根目录 `pnpm run lint`（聚合 miniprogram + server 的 lint 脚本）
   - commitlint 对 PR 标题执行 `@commitlint/config-conventional` 校验
3. **typecheck**：`pnpm run typecheck`（miniprogram TS + server TS）
4. **test**：`pnpm run test`（允许空用例集通过，但必须产出 junit.xml）
5. **miniapp-build-check**（条件执行，`hashFiles('miniprogram/project.config.json') != ''`）：
   - 执行 `pnpm run mp:build:check`（只做 `tsc --noEmit` + 体积预估脚本，**不调用** `miniprogram-ci`）
   - 输出 `main package size` 与 `≤1.5MB` 红线判定，超标直接 fail
6. **summary**：汇总 lint/typecheck/test/size 结果到 GitHub Job Summary（Markdown 表格）

#### 4.1.2 `main-build.yml`（主干构建 · artifact 产出）

触发：`push` to `main` / `dev`
Jobs：
1. 继承 pr-check 全量
2. **package-miniapp**（条件执行）：
   - 产出 `dist/miniprogram-${{ github.sha }}.zip`（仅 `miniprogram/` 目录，排除 `node_modules` / `.cache`）
   - `actions/upload-artifact`，保留 14 天
3. **package-server**（条件执行，`hashFiles('server/package.json') != ''`）：
   - `pnpm --filter server build` → `server/dist/`
   - upload-artifact 保留 14 天

#### 4.1.3 `mp-preview.yml`（预览上传占位 · 手动触发）

触发：`workflow_dispatch`，输入参数 `branch`、`desc`
Jobs：
1. 从 `main-build.yml` 下载最新 miniapp artifact
2. **guard-secrets**：若 `secrets.MP_CI_KEY_STAGING` 为空，打印 `::warning::MP_CI_KEY_STAGING missing, skipping preview upload (placeholder run OK)` 并直接 success 退出
3. **run-preview**（仅在 secret 齐全时）：
   - 写 robot key 到 `/tmp/private.${APPID}.key`（runner 结束自动销毁）
   - 执行 `node scripts/mp-ci/preview.mjs --env staging`
   - 产物：预览二维码 PNG → upload-artifact

#### 4.1.4 `mp-release.yml`（正式上传占位 · tag 触发 + 人工审批）

触发：`push` tags `v*.*.*` + `environment: production`（GitHub Environment，需 Human approve）
Jobs：
1. 同 preview 的 guard-secrets 逻辑（`MP_CI_KEY_PROD` 缺失时打印 warning 并 skip）
2. **run-upload**（仅在 secret 齐全时）：
   - `node scripts/mp-ci/upload.mjs --env production --version ${{ github.ref_name }} --desc "release ${{ github.ref_name }}"`
   - 将 `ci.upload()` 返回结果写入 job summary（subPackageInfo、size、分包明细）
   - **体积红线**：主包 > 1.5MB 或总包 > 16MB 时，job fail 并附红色汇总

> 四个 workflow 顶部统一加 `concurrency: { group: "${{ github.workflow }}-${{ github.ref }}", cancel-in-progress: true }`，避免资源浪费。

### 4.2 `miniprogram-ci` 本地脚本骨架

路径 `scripts/mp-ci/`：

- `preview.mjs`：
  - 读取环境变量 `MP_APPID` / `MP_CI_KEY_PATH` / `MP_PROJECT_PATH` / `MP_ENV`
  - 若任一缺失，打印**红色友好提示**（列出缺失项 + 配置示例链接）并退出码 1（不抛栈）
  - 调用 `ci.preview({ project, desc, qrcodeFormat: 'image', qrcodeOutputDest })`
  - 支持 `--env staging|production` 切换（但本轮只允许 staging 真实跑，production 走 release workflow）
- `upload.mjs`：
  - 入参 `--version` `--desc`，版本号强校验 `^\d+\.\d+\.\d+$`
  - 调用 `ci.upload({ project, version, desc, setting: { es6: true, minify: true, codeProtect: true } })`
  - 上传完成后 `ci.packNpm()` 前置可选（默认开）
  - 将返回的 `subPackageInfo` 打印为表格，同时写入 `reports/mp-upload-${version}.json`
- `size-check.mjs`：
  - 本地静态扫描 `miniprogram/` 目录体积（排除 `miniprogram_npm` 中 devDeps），输出主包 + 各分包 size
  - 用于 `pnpm run mp:build:check`（CI 调用）
- `README.md`：本地使用说明（robot key 放 `~/.costra/mp-ci/` 外部目录，**仓库内永不出现**）

### 4.3 Secrets / 环境变量清单

路径 `docs/devops/secrets.md`，列全：

| Key | 作用 | 注入位置 | 当前状态 |
|---|---|---|---|
| `MP_APPID` | 生产小程序 AppID | repo variable | ✅ `wxf8b0d3e3a83f9941` |
| `MP_APPID_STAGING` | 体验版 AppID | repo variable | ⏳ 待 Human |
| `MP_CI_KEY_PROD` | 生产 robot key（pem 内容） | repo secret | ⏳ 待 Human |
| `MP_CI_KEY_STAGING` | 预发 robot key | repo secret | ⏳ 待 Human |
| `SERVER_API_BASE_PROD` | 生产后端基址 | repo variable | ⏳ 待 ICP + 域名 |
| `SERVER_API_BASE_STAGING` | 预发后端基址 | repo variable | ⏳ 待 ICP + 域名 |
| `SENTRY_DSN`（可选） | 错误上报 | repo secret | 🔵 Sprint-2 再议 |

并在仓库根 `.env.example` 同步 key 列表（仅名称，无值）。

### 4.4 分支保护与合并策略手册

路径 `docs/devops/branch-protection.md`：

- `main`：禁止直接 push；PR 必须 `pr-check.yml` 全绿；至少 1 人 review；强制 squash merge；禁止 force-push
- `dev`：同 `main` 但允许 rebase merge
- `feat/*` / `fix/*` / `chore/*`：无保护，但 PR 必须对 `dev` 发起
- Tag `v*.*.*`：仅允许从 `main` 打；打 tag 自动触发 `mp-release.yml`（需 production environment 审批）
- 以上配置 Human 需在 GitHub repo Settings 手动开启，手册给出截图占位 + 文案

### 4.5 CI/CD 总览文档

路径 `docs/devops/ci-cd.md`：

- 架构图（Mermaid）：开发者 → PR → pr-check → merge → main-build → artifact → (手动) mp-preview → (tag) mp-release
- 各 workflow 触发矩阵表
- 失败兜底：pr-check 红 → 禁止合并；main-build 红 → 自动回滚到上个 green commit（Sprint-1 再做）
- Rollback 策略（占位条目）：小程序灰度回滚通过微信后台"回滚到历史版本"完成，CI 不介入
- **激活清单**（Activation Checklist）：当 robot key / 域名就绪时，Human 按此清单 1-5 步即可激活真实链路

---

## 5. 验收标准（DoD）

1. 4 个 workflow YAML `actionlint` 全绿，`pnpm dlx action-validator` 或 `rhysd/actionlint` 本地跑通
2. `pr-check.yml` 在当前仓库 push 一次能跑到底（miniapp 相关 job 可 skip，但 lint/typecheck/test 必须执行或友好 skip 并给出 summary）
3. `mp-preview.yml` / `mp-release.yml` 在 secret 缺失时**不报错**，job summary 明确写 "placeholder run - secrets missing"
4. `scripts/mp-ci/*.mjs` 能本地 `node` 执行且缺 key 时友好退出（输出示例见交付验证命令）
5. `docs/devops/ci-cd.md` 包含架构图 + 激活清单 + 故障排查 FAQ ≥ 5 条
6. `.env.example` 与 `docs/devops/secrets.md` key 列表**严格一致**
7. 所有敏感信息仅以 `${{ secrets.* }}` 或变量名出现，仓库内**不得有任何真实密钥 / token / 证书**（可加 `gitleaks` config 占位，Sprint-1 再接入扫描）
8. 完成后**必须独立提交**：`chore(devops): bootstrap placeholder ci/cd pipelines`（工程约束触发条件：关键功能模块完成）
9. 在 `.team/messages/` 发 `artifact_ready` 消息，附 `gate_impact: G5-preempt`

---

## 6. 与其他 Agent 的接口约束

| 对手 Agent | 依赖方向 | 约束 |
|---|---|---|
| MiniApp-Agent (COSTRA-030) | DevOps 依赖其 | 需要 `miniprogram/project.config.json` + `pnpm run mp:build:check` 脚本。若 04-22 EOD 前未产出，DevOps 的 miniapp job 走 skip 分支，不 block 合入 |
| Backend-Agent (COSTRA-020/021) | DevOps 依赖其 | 需要 `server/package.json` 存在 `lint` / `test` / `build` 三个脚本名。若缺失，DevOps 在 `pnpm-workspace.yaml` 中预留 filter |
| QA-Agent (COSTRA-050) | 互相感知 | PR QA Gate 模板（COSTRA-050 产出）需引用 `pr-check.yml` 的 status check 名；DevOps 先固定 status check 名为 `ci/pr-check`，供 QA 引用 |

---

## 7. 风险与护栏

| 风险 | 对策 |
|---|---|
| robot key 误提交 | `.gitignore` 显式加 `*.key`, `private.*.key`, `.env.local`；README 顶部红字警告 |
| workflow 在 fork PR 中拿不到 secret | 所有 secret 相关 job 加 `if: github.event.pull_request.head.repo.full_name == github.repository`，外部 fork PR 自动 skip 并打 warning |
| Node / pnpm 版本飘移 | 锁 `node: 20.12.2`、`pnpm: 9.1.0`（`.nvmrc` + `packageManager` 字段同步） |
| artifact 体积失控 | upload-artifact 前执行 `du -sh`，超过 50MB 打 warning，超过 200MB fail |
| 本地误跑 production upload | `upload.mjs` 在 `MP_ENV=production` 且非 CI 环境时，强制交互式 `readline` 二次确认（`--yes` 参数可跳过，但 README 说明仅 CI 用） |

---

## 8. 状态汇报协议

DevOps-Agent 在以下节点必须发消息到 `.team/messages/2026-04-21.jsonl`（或次日文件）：

1. **开工确认**（收到本派单后 15min 内）：`heartbeat`，state=RUNNING
2. **4 个 workflow YAML 草稿就绪**：`status_report`，附 `actionlint` 输出
3. **本地脚本骨架跑通**：`status_report`，附 `node scripts/mp-ci/preview.mjs --env staging` 缺 key 时的友好报错截图/文本
4. **文档齐备、可提交**：`artifact_ready`，列出全部文件路径
5. **独立提交完成**：`status_report`，附 `git log -1 --format='%H %s'` 输出
6. **若发现 MiniApp / Backend 脚本契约缺失**：`blocker_raised` 并明确指出对手 Agent 应补的脚本名

---

## 9. 不做清单（Out of Scope，明确划线）

- ❌ 不真实上传小程序（无论体验 / 生产）
- ❌ 不做后端服务器部署流水线（Sprint-1 再起 COSTRA-041）
- ❌ 不接 Sentry / APM（Sprint-2）
- ❌ 不做 CDN / OSS 发布
- ❌ 不做 release notes 自动生成（可作为 P3 backlog）
- ❌ 不写单元测试（留给各业务 Agent）
- ❌ 不配置 GitHub Environment 的 reviewer 名单（Human 自行设置）

---

## 10. 参考链接（官方优先）

- `miniprogram-ci`：https://developers.weixin.qq.com/miniprogram/dev/devtools/ci.html
- GitHub Actions 最佳实践：https://docs.github.com/actions
- `actionlint`：https://github.com/rhysd/actionlint
- Conventional Commits：https://www.conventionalcommits.org/zh-hans/v1.0.0/
- pnpm workspaces：https://pnpm.io/workspaces

---

**DevOps-Agent，请以本文件为唯一派单源；遇到与 ADR-0004 / engineering-guidelines 冲突，以 ADR 为准，并发 `clarification_request` 上报 Orchestrator。**
