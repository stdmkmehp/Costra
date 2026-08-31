# Errors

## [ERR-20260609-001] vitest_reporter_basic

**Logged**: 2026-06-09T16:15:00+08:00
**Priority**: low
**Status**: pending
**Area**: tests

### Summary
Server-side Vitest in this project/version does not support `--reporter=basic` as a built-in reporter name.

### Error
```text
Error: Failed to load custom Reporter from basic
```

### Context
- Command attempted: `cd /Users/weizhao/Desktop/Costra/server && ./node_modules/.bin/vitest run test/users.test.ts --reporter=basic`
- Purpose: rerun server `users.test.ts` with concise output.

### Suggested Fix
Use the default reporter or a supported reporter name instead of `basic` for this server Vitest version.

### Metadata
- Reproducible: yes
- Related Files: `server/vitest.config.ts`

---

## [ERR-20260609-002] server_typecheck_existing_sync_test_unused

**Logged**: 2026-06-09T16:17:00+08:00
**Priority**: low
**Status**: pending
**Area**: tests

### Summary
Server `npm run typecheck` is currently blocked by an existing unused variable in `test/sync.test.ts` unrelated to the active ledger preference changes.

### Error
```text
test/sync.test.ts(131,11): error TS6133: 'serverId' is declared but its value is never read.
```

### Context
- Command attempted: `cd /Users/weizhao/Desktop/Costra/server && npm run typecheck`
- Active task modified preference/user/family files, not `test/sync.test.ts`.

### Suggested Fix
Clean up the unused `serverId` in `server/test/sync.test.ts` or adjust that test before using full server typecheck as a gate.

### Metadata
- Reproducible: yes
- Related Files: `server/test/sync.test.ts`

---

## [ERR-20260609-003] vitest_runinband_option

**Logged**: 2026-06-09T19:20:00+08:00
**Priority**: low
**Status**: pending
**Area**: tests

### Summary
Vitest does not support Jest-style `--runInBand` option in this project.

### Error
```text
CACError: Unknown option `--runInBand`
```

### Context
- Command attempted: `npm test -- --runInBand`
- Purpose: run 小程序测试串行验证 M0 启动性能优化改动。

### Suggested Fix
Use `npm test` directly, or use Vitest-supported pool/sequence options if serial execution is required.

### Metadata
- Reproducible: yes
- Related Files: `package.json`, `vitest.config.ts`

---

## [ERR-20260721-001] iwiki_connect_missing_requests

**Logged**: 2026-07-21T17:35:00+08:00
**Priority**: low
**Status**: pending
**Area**: docs

### Summary
The local iWiki connector cannot run because its Python environment does not include the `requests` package.

### Error
```text
ModuleNotFoundError: No module named 'requests'
```

### Context
- Attempted to query the default personal iWiki space with `connect_mcp.py` before publishing a generated Markdown guide.
- Local Markdown generation completed successfully; only optional iWiki synchronization was blocked.

### Suggested Fix
Install `requests` into the Python environment used by `connect_mcp.py`, or package the connector with an isolated dependency environment.

### Metadata
- Reproducible: yes
- Related Files: `/Users/weizhao/.codebuddy/skills/iwiki-doc/scripts/connect_mcp.py`

---

## [ERR-20260721-002] analytics_static_check

**Logged**: 2026-07-21T18:00:00+08:00
**Priority**: medium
**Status**: resolved
**Area**: tests

### Summary
`analytics` 静态检查发现 `daily.mjs` 语法被并行同文件编辑破坏。

### Error
```text
SyntaxError: Unexpected end of input
```

### Context
- Command: `cd analytics && npm run check`
- 多个独立 `replace_in_file` 被错误地并行应用到同一文件，后写结果覆盖了其他修改。

### Suggested Fix
同一文件的编辑必须串行执行；修复语法后重新跑 `npm run check`。

### Metadata
- Reproducible: yes
- Related Files: `analytics/templates/daily.mjs`

---

## [ERR-20260721-003] docker_compose_cli_unavailable

**Logged**: 2026-07-21T18:00:00+08:00
**Priority**: low
**Status**: pending
**Area**: infra

### Summary
当前本机 `docker` 不支持 `docker compose config -q`，疑似未安装 Compose v2 插件。

### Error
```text
unknown shorthand flag: 'q' in -q
```

### Context
- Command: `cd analytics && docker compose config -q`
- `docker` 将 `-q` 当作顶层参数，说明 `compose` 子命令不可用或版本不兼容。

### Suggested Fix
部署机需安装 Docker Compose v2；本机验证可改用项目静态检查，或存在时使用独立 `docker-compose config -q`。

### Metadata
- Reproducible: yes
- Related Files: `analytics/docker-compose.yml`

---

## [ERR-20260721-004] zsh_reserved_status

**Logged**: 2026-07-21T18:20:00+08:00
**Priority**: low
**Status**: resolved
**Area**: tests

### Summary
在 Zsh 执行环境中使用 `status=$?` 会失败，因为 `status` 是只读特殊参数。

### Error
```text
read-only variable: status
```

### Context
- 空 inbox 集成测试的清理命令使用了 `status` 保存退出码。
- 改为普通变量 `exit_code` 后测试通过并完成临时文件清理。

### Suggested Fix
跨 shell 命令统一使用 `exit_code`，不要使用 Zsh 保留参数 `status`。

### Metadata
- Reproducible: yes
- Related Files: `analytics/scripts/analyze.sh`

---

## [ERR-20260721-005] zsh_word_splitting

**Logged**: 2026-07-21T18:35:00+08:00
**Priority**: low
**Status**: resolved
**Area**: tests

### Summary
Zsh 默认不会像 Bash 那样对未引用变量执行单词拆分，导致循环测试参数被当作一个字符串。

### Error
```text
render 输出路径变成 daily 86400000.md，随后 grep 找不到 daily.md
```

### Context
- 测试写了 `for spec in 'daily 86400000'; do set -- $spec`。
- 在 Zsh 中 `$spec` 未拆成两个参数。
- 改为三条显式 render 命令后日报、区间报、周报端到端验证全部通过。

### Suggested Fix
跨 Shell 测试避免依赖隐式 word splitting；使用显式参数或数组。

### Metadata
- Reproducible: yes
- Related Files: `analytics/scripts/render.mjs`

---

## [ERR-20260814-001] pg_hba_managed_block_portability

**Logged**: 2026-08-14T10:21:41+08:00
**Priority**: medium
**Status**: resolved
**Area**: infra

### Summary
HBA 单元测试暴露 GNU `stat` 参数和通过 `awk -v` 传多行字符串的跨平台问题。

### Error
```text
stat: illegal option -- c
awk: newline in string # BEGIN COSTRA MANAG...
```

### Context
- 在 macOS 开发机用临时 `pg_hba.conf` 验证 `replace_pg_hba_managed_block`。
- 生产是 Linux，但本地无法测试会让关键 HBA 逻辑失去快速回归能力。

### Suggested Fix
文件元数据读取同时支持 GNU/BSD `stat`；多行 block 写临时文件，再让 awk 逐行读取，不通过 `-v` 直接传递。

### Metadata
- Reproducible: yes
- Related Files: `infra/scripts/lib/common.sh`

### Resolution
- **Resolved**: 2026-08-14T10:21:41+08:00
- **Notes**: 已实现双平台 stat fallback、block 临时文件及 POSIX awk 条件；幂等、hostssl 顺序与不完整 marker 拒绝测试通过。

---

## [ERR-20260814-002] rg_unavailable_in_validation_command

**Logged**: 2026-08-14T11:28:55+08:00
**Priority**: low
**Status**: resolved
**Area**: infra

### Summary
最终验证命令直接调用 `rg`，但当前 shell 环境未安装该二进制。

### Error
```text
(eval):1: command not found: rg
```

### Context
- 仅用于确认新恢复脚本的 untracked 路径和执行权限。
- 项目工具层有内容搜索能力，但 shell 命令不能假设 `rg` 存在。

### Suggested Fix
命令行验证优先使用 POSIX `grep`/`find`，或先 `command -v rg` 再分支。

### Metadata
- Reproducible: yes
- Related Files: `infra/scripts/recover-primary-from-standby.sh`

### Resolution
- **Resolved**: 2026-08-14T11:28:55+08:00
- **Notes**: 后续验证改用 `grep`/文件搜索，不依赖 `rg`。

---

## [ERR-20260827-001] incorrect_transaction_helper_path

**Logged**: 2026-08-27T00:00:00+08:00
**Priority**: low
**Status**: resolved
**Area**: backend

### Summary
读取事务辅助文件时误猜为 `server/src/db/transaction.ts`，实际 `withTx` 定义在 `server/src/db/pool.ts`。

### Error
```text
Could not find file '/Users/weizhao/Desktop/Costra/server/src/db/transaction.ts'
```

### Context
- 审查数据导入任务的事务和重试模型时定位 `withTx`。
- 随后通过内容搜索找到正确文件。

### Suggested Fix
定位已有符号时先使用语义或内容搜索，不根据常见命名猜文件路径。

### Metadata
- Reproducible: yes
- Related Files: `server/src/db/pool.ts`

### Resolution
- **Resolved**: 2026-08-27T00:00:00+08:00
- **Notes**: 已读取正确文件并完成事务语义核查。

---

## [ERR-20260827-002] replace_in_file_stale_or_noop_match

**Logged**: 2026-08-27T00:00:00+08:00
**Priority**: low
**Status**: resolved
**Area**: backend

### Summary
缓存修复期间两次精确替换参数无效：一次新旧字符串相同，一次使用了过时的函数上下文。

### Error
```text
Search and replace strings are the same, no changes made.
The string to replace was not found in the file.
```

### Context
- 给 `recurringRepo.ts` 预留新查询时误提交了同值替换。
- 修改 `routes/users.ts` 时未先读取实际抽取后的 `handlePatch` 结构。

### Suggested Fix
构造替换前确认 `old_str !== new_str`；文件结构可能已变化时先读取目标函数的当前内容，再用最小唯一上下文编辑。

### Metadata
- Reproducible: yes
- Related Files: `server/src/repositories/recurringRepo.ts`, `server/src/routes/users.ts`

### Resolution
- **Resolved**: 2026-08-27T00:00:00+08:00
- **Notes**: 已重新读取目标代码并用准确上下文完成后续修改。

---

## [ERR-20260827-003] guessed_domain_types_path

**Logged**: 2026-08-27T00:00:00+08:00
**Priority**: low
**Status**: resolved
**Area**: backend

### Summary
复核类型定义时误猜 `server/src/domain/types.ts`，实际项目类型不在该路径。

### Error
```text
ENOENT: no such file or directory, stat '/Users/weizhao/Desktop/Costra/server/src/domain/types.ts'
```

### Context
- 为确认 `EntryEntity` 定义读取了未经文件搜索验证的猜测路径。
- 该失败不影响实现，随后改用符号引用和实际 import 关系完成核对。

### Suggested Fix
定位类型文件时优先使用符号导航或文件搜索，不按目录惯例猜路径。

### Metadata
- Reproducible: yes
- Related Files: `server/src/services/entryService.ts`

### Resolution
- **Resolved**: 2026-08-27T00:00:00+08:00
- **Notes**: 已改用 LSP/内容搜索核对类型与调用点。

---
