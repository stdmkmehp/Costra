# 工具调用审计日志目录

每个 Agent 在调用写类工具（write_to_file / replace_in_file / execute_command / git push ...）前后
必须追加一行到当日 `YYYY-MM-DD.jsonl`，格式：

```json
{
  "ts": "2026-04-20T19:54:00+08:00",
  "agent": "Backend-Agent",
  "task_id": "COSTRA-201",
  "tool": "write_to_file",
  "target": "server/internal/family/invite.go",
  "action": "create|modify|delete|exec",
  "diff_summary": "新增 generateInviteCode()，24h 过期",
  "result": "success|failed",
  "cost_ms": 120
}
```

审计文件是**追加写**，不允许修改历史条目。
