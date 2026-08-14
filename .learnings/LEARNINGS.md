# Learnings

## [LRN-20260601-001] correction

**Logged**: 2026-06-01T19:08:00+08:00
**Priority**: medium
**Status**: pending
**Area**: frontend

### Summary
微信小程序列表行内 `<text>` 不要把插值内容写成多行缩进，视觉对齐时应先排除 text 节点保留换行/空白造成的行盒偏移。

### Details
用户指出明细页条目行中分类图标、分类文字、金额三者中心线仍不一致。前一次只调整 `line-height` 没有效果，原因是金额 `<text>` 内部写成多行：换行 + 缩进 + `{{entry.amountText}}` + 换行，微信 `text` 组件可能保留空白/形成异常行盒；同时仅依赖 `align-items:center` 对齐的是 flex item 外框，不一定等于可见字形中心。

### Suggested Action
处理小程序行内视觉对齐时：1) 插值 `<text>` 改为单行无内部空白；2) 图标、文字容器、金额使用同一固定高度对齐框（如 48rpx），再在框内居中。

### Metadata
- Source: user_feedback
- Related Files: miniprogram/pages/ledger/index.wxml, miniprogram/pages/ledger/index.wxss
- Tags: wechat-miniprogram, text, alignment, ui

---

## [LRN-20260814-001] knowledge_gap

**Logged**: 2026-08-14T10:11:57+08:00
**Priority**: high
**Status**: resolved
**Area**: infra

### Summary
`pg_basebackup -R` 会把 libpq 的非默认 `passfile` 路径写入 `primary_conninfo`；临时 `.pgpass` 不能在 basebackup 后直接删除。

### Details
为避免通过 Docker Env 暴露复制密码，初版改为临时 `PGPASSFILE=/run/costra/pgpass`。PG15 的 `-R` 会使用 `PQconninfo` 生成恢复配置，非默认 `passfile` 会进入 `postgresql.auto.conf`。若容器退出后删除临时文件，walreceiver 后续启动/重连会找不到密码文件。

### Suggested Action
basebackup 完成后，把临时文件以 `0600`、postgres 属主固化到 PGDATA（例如 `.replication.pgpass`），并将 `primary_conninfo` 中的临时容器路径替换为容器内持久 PGDATA 路径；启动前同时校验路径、权限和属主。

### Metadata
- Source: error
- Related Files: infra/scripts/setup-replication-standby.sh
- Tags: postgresql, pg-basebackup, passfile, replication, docker

### Resolution
- **Resolved**: 2026-08-14T10:11:57+08:00
- **Notes**: standby 初始化脚本已固化复制 passfile，并增加启动前硬校验。

---
