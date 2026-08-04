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
