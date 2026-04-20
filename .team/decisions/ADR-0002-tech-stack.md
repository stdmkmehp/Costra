# ADR-0002：技术栈选型

- 状态：Accepted
- 日期：2026-04-20

## 决策

| 层 | 选型 | 关键理由 |
|---|---|---|
| iOS 语言 | Swift 5.10+ | 原生、生态、性能 |
| iOS UI | SwiftUI + 少量 UIKit | 声明式、开发效率 |
| iOS 架构 | MVVM + Clean (UseCase/Repository) | 可测试、易维护 |
| iOS 本地库 | GRDB (SQLite) | 轻量 + SQL 灵活 |
| iOS 工程化 | Tuist + SPM | 多模块 |
| 后端语言 | Go 1.22+ | 高并发、部署简单 |
| 后端框架 | Gin + gRPC | REST 对外 / gRPC 内部 |
| 主存储 | MySQL 8.0（DECIMAL(18,4) 存金额） | 事务 |
| 缓存 | Redis 7 | 会话 / 同步游标 / 热点 |
| 消息 | Kafka | 异步解耦 |
| 对象存储 | 腾讯云 COS / S3 | 小票图片 + CDN |
| CI/CD | GitHub Actions + Fastlane | iOS 签名与分发 |
| 部署 | Docker + K8s (Helm) | 灰度 + 回滚 |
| 监控 | Prometheus + Grafana + AlertManager | 指标 + 告警 |
| APM | SkyWalking / 自建 | 链路追踪 |

## 硬性约束
- **金额字段绝不使用 float / double**
- **客户端 Token 只存 Keychain**
- **生产禁止明文密码，bcrypt + salt**
- **所有对外接口 HTTPS + 证书锁定**
