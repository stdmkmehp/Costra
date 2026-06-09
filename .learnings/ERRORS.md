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
