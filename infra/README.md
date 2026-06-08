# Costra Infra

本目录承载**不进运行期代码、不进文档目录**的基础设施规划与 CI 对账所需事实源。

| 子目录/文件 | 用途 | 相关卡 |
|---|---|---|
| `wechat/domains.md` | 四环境域名 SSOT（prod/dev/stg/api · DNS 记录规划 · 微信白名单填写清单） · D-023 prod 入口回归根域 · 子域搁置 | COSTRA-115 |
| `docs/legal/compliance-registry.md` | 备案号 / 公安备案 / 主体登记（合规 SSOT） | COSTRA-107 / FU-LEGAL-COMPLIANCE |

> 📌 **CI 白名单一致性校验**（`scripts/devops/whitelist-check.mjs`）读取本目录的 `wechat/domains.md` 与 `server/api/openapi.yaml servers` + `miniprogram/services/env.ts` 做三方对账，不一致时 `pr-check` 流水线直接红灯 block 合并。
