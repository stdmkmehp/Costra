# Costra · prod readiness checklist（Phase-2 闸门速查）

> **本文件为 prod-bootstrap 完成后 Phase-2 闸门 5 条核对清单**。Human 在 bootstrap 完成后 ≤ 5 分钟跑完 · 全 PASS 才进 Phase-3。
>
> **上游手册**：`infra/prod-bootstrap.md` §8
> **关联决议**：D-026 §2.3 工程纪律（C2/C3 在本 checklist 落地验证）
> **日期**：2026-05-23

---

## 跑前确认

```bash
ssh root@49.235.216.20
# 进入 prod server · 准备跑下面 5 条
```

---

## ✅ 闸门 1 · healthz 200 + ICP header

```bash
curl -i https://costra.cloud/healthz 2>&1 | head -20
```

**PASS 判据**：
- HTTP `200`
- body 含 `"status":"ok"`
- header 含 `x-icp-filing: 沪ICP备2026017253号-2`

**FAIL 排查**：见 prod-bootstrap §9 Q2

---

## ✅ 闸门 2 · /v1/legal/icp 公开端点

```bash
curl -s https://costra.cloud/v1/legal/icp | jq
```

**PASS 判据**：返回 JSON · 包含字符串 `沪ICP备2026017253号-2`

**FAIL 排查**：检查 server/src/config/icp.ts + server/src/routes/legal.ts 是否被注册

---

## ✅ 闸门 3 · 401 守门验证

```bash
curl -i 'https://costra.cloud/v1/sync/pull?family_id=00000000-0000-0000-0000-000000000000&since=0' 2>&1 | head -10
```

**PASS 判据**：HTTP `401` · body 含 `"code":"UNAUTHENTICATED"`

**FAIL 排查**：
- 返 200 → JWT 中间件未生效 · 严重 P0 · 立即停服
- 返 502 → server 没起 · 看 §9 Q2

---

## ✅ 闸门 4 · systemd 状态 + 自启

```bash
systemctl is-active costra-server && systemctl is-enabled costra-server
```

**PASS 判据**：两条都返
```
active
enabled
```

**FAIL 排查**：见 prod-bootstrap §9 Q1

---

## ✅ 闸门 5 · **D-026 §2.3 C2 红线**：mock 日志为空

```bash
grep -i 'mockLogin\|WX_MOCK_LOGIN enabled\|"mock"' /var/log/costra/server.log
echo "Exit: $?"
```

**PASS 判据**：
- grep 无任何输出（**最关键**）
- `Exit: 1`（grep 找不到匹配 · 退出码 1）

**FAIL 排查**：⚠️ **D-026 §2.3 C2 红线触发** · 立即按 prod-bootstrap §9 Q4 操作（停服 → 检查 EnvironmentFile → 修正后重启）

---

## 反馈格式

跑完 5 条后向 Orchestrator 回：

```
Phase-2 闸门验证 @ 2026-05-__ HH:MM

| 闸门 | 结果 | 证据（1 行）|
|---|---|---|
| 1 healthz + ICP header | PASS / FAIL | `HTTP/2 200` + `x-icp-filing: 沪ICP备2026017253号-2` |
| 2 /v1/legal/icp | PASS / FAIL | `沪ICP备2026017253号-2` 字符串匹配 |
| 3 401 守门 | PASS / FAIL | `401 UNAUTHENTICATED` |
| 4 systemd active+enabled | PASS / FAIL | `active / enabled` |
| 5 C2 mock 红线 | PASS / FAIL | grep Exit 1（无 mock 字样） |

5/5 PASS → 进 Phase-3 154+150 真 prod 实测
任一 FAIL → 见 prod-bootstrap §9 + 贴证据
```

---

> **本 checklist 由 Orchestrator 同对话轮交付**（D-026 §6.1 incident 备注 · devops-ops 装扮档工具白名单错配兜底）
