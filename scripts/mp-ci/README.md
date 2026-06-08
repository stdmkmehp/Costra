# `scripts/mp-ci/` 使用说明

> 所有脚本均为**占位骨架**，在缺少 robot key / AppID 时**友好短路**（不抛栈、退出码 0 或 1 明确）。
> Refs: COSTRA-040

## 脚本清单

| 脚本 | 用途 | 入口 |
|---|---|---|
| `preview.mjs` | 预览版上传，生成二维码 | `npm run mp:preview`（如定义）或 `node scripts/mp-ci/preview.mjs` |
| `upload.mjs`  | 正式版上传 | CI 调用（`mp-release.yml` tag 触发） |
| `size-check.mjs` | 主包/分包/总包体积红线检查（**不**调 miniprogram-ci） | `node scripts/mp-ci/size-check.mjs` |
| `analyze.mjs` | Top 20 大文件快速扫描 | `npm run analyze` |
| `build-check.mjs` | PR 检查（`tsc --noEmit` + size-check） | `npm run mp:build:check` |

## 本地运行

robot key **禁止**提交到仓库。放到仓库外的 `~/.costra/mp-ci/`：

```bash
mkdir -p ~/.costra/mp-ci
# 从微信公众平台下载 private.<APPID>.key 放到此目录

export MP_APPID=wxf8b0d3e3a83f9941
export MP_CI_KEY_PATH=~/.costra/mp-ci/private.wxf8b0d3e3a83f9941.key
export MP_PROJECT_PATH=$(pwd)
export MP_ENV=staging

node scripts/mp-ci/preview.mjs
```

## 缺 key 时的预期行为

```
$ node scripts/mp-ci/preview.mjs
[mp-ci/preview] 缺少必要环境变量：MP_APPID, MP_CI_KEY_PATH
[mp-ci/preview] 配置示例请见 docs/devops/secrets.md §激活清单
# exit 1
```

## 红线

| 指标 | 阈值 | 脚本 |
|---|---|---|
| 主包 | ≤ 1.5MB | `size-check.mjs`, `upload.mjs` |
| 总包 | ≤ 16MB | `size-check.mjs`, `upload.mjs` |
| 版本号 | `^\d+\.\d+\.\d+$` | `upload.mjs` |
| 生产环境 2nd confirm | 非 CI 下交互式 `yes` | `upload.mjs` |

## 依赖

首次激活时：

```bash
npm i -D miniprogram-ci
```

脚本会通过 `await import('miniprogram-ci')` 动态加载，未安装时直接提示并退出。
