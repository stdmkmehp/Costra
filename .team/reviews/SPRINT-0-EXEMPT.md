# Sprint-0 免审卡登记（B 档）

> 生成时间：2026-04-23 20:09
> 依据：`SOP-REVIEW-LOOP.md` §2 角色分工矩阵 + 例外规则
> 状态：一次性登记，不走 AI-Review 闭环，直接 Human 终审（若需要）

---

## 为什么豁免

SOP-REVIEW-LOOP §2 明文规定：
- **DevOps-Agent** 产出 → **不走 Review-Agent**（涉及生产/密钥/域名，风险太高，Human 直审）
- **QA-Agent** 产出 → **不走 Review-Agent**（测试策略本身就是质量标准，不能由另一个 AI 批）
- **决策类文档（D-xxx / ADR-*）** → 不走 Review-Agent，直接 Human 决策

---

## 免审卡清单

### COSTRA-003 · 技术栈 ADR 评审

- **Owner**：PM-Agent（+ Backend-Agent 会签）
- **主产物**：`.team/decisions/ADR-0002-tech-stack.md`
- **免审类别**：`EXEMPT-DECISION`
- **依据**：SOP-REVIEW-LOOP §2 例外 — "决策类文档（.team/decisions/D-xxx.md、ADR）→ 不走 Review-Agent，直接 Human 决策"
- **Human 终审状态**：✅ 已通过 G1 评审（2026-04-21），且 ADR-0002 于 2026-04-23 由 ADR-0006 以"Go→Node 切换"的方式追溯修订，当时 Human 确认生效
- **结论**：**EXEMPT-PASS**（无需补审）

### COSTRA-040 · CI/CD 占位流水线 + mp-ci 脚本

- **Owner**：DevOps-Agent
- **主产物**：`.github/workflows/*` + `docs/devops/secrets.md` + `scripts/miniprogram-ci/*`
- **免审类别**：`EXEMPT-DEVOPS`
- **依据**：SOP-REVIEW-LOOP §2 — "DevOps-Agent → 不走 Review-Agent，Human 直审"
- **Human 终审状态**：✅ 已通过 G5-Preempt（2026-04-22），`board.md §闸门` 明确标注
- **残余风险**：COSTRA-040 的"真实上传链路激活"仍依赖外部资源（见 `board.md §Blocked`），不影响免审结论——那是实施层残留而非评审缺陷
- **结论**：**EXEMPT-PASS**

### COSTRA-050 · 测试策略 + 冒烟 + 微信审核自查

- **Owner**：QA-Agent
- **主产物**：`docs/qa/test-strategy.md` + `docs/qa/smoke/*` + `docs/qa/wechat-self-audit.md`（若存在）
- **免审类别**：`EXEMPT-QA`
- **依据**：SOP-REVIEW-LOOP §2 — "QA-Agent → 不走 Review-Agent，Human 直审"
- **Human 终审状态**：✅ G2/G3 同步通过（2026-04-22）
- **结论**：**EXEMPT-PASS**

---

## 结论汇总

| 卡号 | 免审类别 | Human 历史终审 | 本次处置 |
|---|---|---|---|
| COSTRA-003 | EXEMPT-DECISION | ✅ G1 通过 | EXEMPT-PASS |
| COSTRA-040 | EXEMPT-DEVOPS | ✅ G5-Preempt 通过 | EXEMPT-PASS |
| COSTRA-050 | EXEMPT-QA | ✅ G2/G3 通过 | EXEMPT-PASS |

**3 张免审卡全部状态保持 Done，无需任何追加动作。**

若 Human 对任一张卡仍有技术疑虑，可单独发 `run review-tech COSTRA-040`（强制覆盖 SOP 豁免），但不建议——那会破坏 SOP §2 建立的边界。
