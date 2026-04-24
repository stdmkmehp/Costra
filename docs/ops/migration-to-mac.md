# Costra 工程 Mac 端迁移操作手册

> **目的**：把 Costra 工程从 Windows 开发机迁到 Mac 开发机后，在 Mac 上重建完整开发环境。
> **生成时间**：2026-04-24 · Windows 侧 commit `f83283e` 推送后
> **配套资产**：`H:\Costra-migration\costra-secrets.zip`（无密码 · 内含 `key/private.wxf8b0d3e3a83f9941.key` · 需用私人加密渠道传输到 Mac）
>
> **遵循顺序执行。每一小节都可独立验证，上一节没绿不要进下一节。**

---

## 0. 迁移前的事实清单（本仓库实际状态）

- **远端**：`origin = https://github.com/stdmkmehp/Costra.git`
- **主开发分支**：`dev`（本手册基于 commit `f83283e`）
- **Node 要求**：`>=20`（见 `server/package.json` engines）
- **依赖栈**：Postgres 15 / Redis 7 / MinIO（开发可选）/ MailHog（开发可选）· 全部走 `server/docker-compose.yml`
- **微信小程序 AppID**：`wxf8b0d3e3a83f9941`（生产号临时共用体验 · D-007）
- **必须手工带走的文件**：`key/private.wxf8b0d3e3a83f9941.key`（miniprogram-ci 上传密钥 · gitignore 外）
- **可选带走的文件**：无（`.env` / `.env.*` / `project.private.config.json` 在 Windows 侧均不存在；`project.private.config.json.example` 已在 git 中，需要时按模板补）
- **跨平台规约**：`.gitattributes` 已落（强制文本 LF · 二进制扩展名显式标记）

---

## 1. Mac 基础环境安装

### 1.1 Xcode Command Line Tools（git / clang / make）

```bash
xcode-select --install
# 弹窗同意即可，等装完（约 5~10 分钟）
git --version   # 验证
```

### 1.2 Homebrew

```bash
/bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"

# 安装完按终端提示把 brew 加入 PATH（Apple Silicon 机型）：
echo 'eval "$(/opt/homebrew/bin/brew shellenv)"' >> ~/.zprofile
eval "$(/opt/homebrew/bin/brew shellenv)"

brew --version   # 验证
```

### 1.3 Node 20（通过 nvm 管理）

```bash
brew install nvm
mkdir -p ~/.nvm

# 加到 ~/.zshrc
cat >> ~/.zshrc <<'EOF'

# ---- nvm ----
export NVM_DIR="$HOME/.nvm"
[ -s "/opt/homebrew/opt/nvm/nvm.sh" ] && . "/opt/homebrew/opt/nvm/nvm.sh"
[ -s "/opt/homebrew/opt/nvm/etc/bash_completion.d/nvm" ] && . "/opt/homebrew/opt/nvm/etc/bash_completion.d/nvm"
EOF

source ~/.zshrc

nvm install 20
nvm alias default 20
nvm use default

node -v   # 应输出 v20.x.x
npm -v
```

> Intel Mac 把 `/opt/homebrew` 替换为 `/usr/local`。

### 1.4 Docker Desktop

```bash
brew install --cask docker
# 首次启动 Docker Desktop（应用程序 → Docker），同意权限与协议
docker --version
docker compose version
```

### 1.5 微信开发者工具

去 https://developers.weixin.qq.com/miniprogram/dev/devtools/download.html 下 Mac 版 DMG，拖进 Applications。用微信扫码登录（使用注册了 AppID `wxf8b0d3e3a83f9941` 的那个微信号）。

---

## 2. Git 配置（跨平台最关键一步）

```bash
git config --global user.name  "你的名字"
git config --global user.email "你的邮箱"

# 行尾策略：Mac 保持 LF，commit 时不做换行转换
git config --global core.autocrlf input

# 换行警告转成错误（可选，帮你在误引入 CRLF 时及时发现）
git config --global core.safecrlf warn

# 大小写敏感（Mac APFS 默认不敏感；设 true 强制 git 按实际记录处理，避免与 Linux CI 表现不一致）
git config --global core.ignorecase false
```

### 2.1 配 GitHub SSH key（推荐，免 token）

```bash
ssh-keygen -t ed25519 -C "你的邮箱"
# 一路回车（passphrase 可填可不填；填了更安全）

# 启动 ssh-agent 并加进去
eval "$(ssh-agent -s)"
cat >> ~/.ssh/config <<'EOF'

Host github.com
  AddKeysToAgent yes
  UseKeychain yes
  IdentityFile ~/.ssh/id_ed25519
EOF
ssh-add --apple-use-keychain ~/.ssh/id_ed25519

# 复制公钥
pbcopy < ~/.ssh/id_ed25519.pub
# 粘贴到 https://github.com/settings/keys → New SSH key

# 验证
ssh -T git@github.com
# 看到 "Hi <你的用户名>! You've successfully authenticated..." 就成
```

---

## 3. Clone 仓库

```bash
mkdir -p ~/Projects && cd ~/Projects

# 用 SSH（推荐）
git clone git@github.com:stdmkmehp/Costra.git
# 或 HTTPS
# git clone https://github.com/stdmkmehp/Costra.git

cd Costra
git checkout dev
git pull

# 确认拿到最新的迁移 commit
git log --oneline -3
# 期望最上面两行是：
#   f83283e chore(repo): snapshot .team state before cross-machine migration
#   de3aef9 chore(repo): introduce .gitattributes to enforce LF eol
```

---

## 4. 放回私密文件（从 `costra-secrets.zip`）

把 Windows 端 `H:\Costra-migration\costra-secrets.zip` 通过**私人加密渠道**（AirDrop / 私人加密网盘 / 加密 U 盘 / 1Password Secure Note）传到 Mac。不要走普通邮件 / 聊天群 / 公开网盘。

```bash
cd ~/Projects/Costra

# 解压到工程根目录（zip 内含 key/ 目录，直接解即合位）
unzip /path/to/costra-secrets.zip -d .

# 验证
ls -la key/
# 应看到：
#   -rw-r--r--  ...  private.wxf8b0d3e3a83f9941.key

# 确认 git 不会误跟踪（.gitignore 覆盖 key/）
git status
# 应输出：nothing to commit, working tree clean
```

### 4.1 若未来需要 `project.private.config.json`

```bash
# 以模板为基础按需增字段（该文件已被 .gitignore，绝不要 commit）
cp project.private.config.json.example project.private.config.json
# 按需编辑，微信开发者工具打开工程后会自动读取其中的调试配置
```

### 4.2 若未来需要本地 `server/.env`

```bash
cd server
cp .env.example .env
# 按注释填值；本地开发默认可直接用 docker compose 起的 costra / costra_dev_pw
cd ..
```

---

## 5. 装依赖（根 workspace + server workspace）

工程是双 package 结构：根目录管小程序工具链，`server/` 是 Node 后端。

```bash
cd ~/Projects/Costra

# 5.1 根目录（小程序侧）
npm install
# 若遇到 husky DEPRECATED 警告（v10 预警），可暂时忽略——COSTRA-117 正在排期清理

# 5.2 server
cd server
npm install
cd ..
```

### 5.1 已知警告（非错误，无需处理）

- `husky - DEPRECATED`：项目有卡 COSTRA-117 追踪，不影响提交。
- `vitest 2.1.9 Vite CJS` 弃用警告：Follow-up O-V-1 追踪，不影响跑测。

---

## 6. 三绿灯（迁移成功的硬验收）

### 6.1 根目录 typecheck

```bash
cd ~/Projects/Costra
npm run typecheck
# 期望：无 error，进程退出码 0
```

### 6.2 server typecheck + 单测

```bash
cd server

npm run typecheck
# 期望：src + test 两段 tsc 全绿

npm test
# 期望：vitest 8/8 passed（COSTRA-101 §6.1.b R4 三绿灯基线）

cd ..
```

### 6.3 docker-compose 起依赖栈

```bash
cd server
docker compose up -d
docker compose ps
# 期望：postgres / redis / minio / mailhog 四个 service，STATUS 全部 (healthy)

# 连通性快验
docker compose exec -T postgres psql -U costra -d costra -c "\dt"
# 能列出表名（若为空库说明 migrations 已跑完即可）

cd ..
```

> **ARM Mac 兼容性**：所有镜像（postgres:15-alpine / redis:7-alpine / minio / mailhog）在 Apple Silicon 下均有原生镜像，无需 `--platform`。若未来添加了某个无 ARM 版镜像，报 `exec format error` 时在 `docker-compose.yml` 对应 service 下加 `platform: linux/amd64`。

### 6.4 起后端开发服务

```bash
cd server
npm run dev
# 期望：fastify listening on 0.0.0.0:3000 （具体见日志）
# 新开终端验证健康检查端点（若有 /health 路由可打 curl；否则看 pino 日志无 ERROR 即可）
```

Ctrl+C 停掉。

### 6.5 微信开发者工具导入

1. 打开微信开发者工具 → **导入项目**
2. **目录**：`~/Projects/Costra`（**根目录**，不是 `miniprogram/` 子目录——因为 `project.config.json` 在根）
3. **AppID**：自动从 `project.config.json` 读到 `wxf8b0d3e3a83f9941`
4. 打开后 → **工具菜单 → 构建 npm**（首次必做 · 生成 `miniprogram/miniprogram_npm/`）
5. 顶部无红色编译错误 = 成功

---

## 7. 行尾与跨平台验证

这一步确认 `.gitattributes` 在 Mac 端按预期工作，避免未来 Windows ↔ Mac 互推时产生"整文件 diff"假象。

```bash
cd ~/Projects/Costra

# 随便改一行 .team 里的文件
echo "" >> .team/STATE

git status
git diff .team/STATE
# 期望：看到干净的 1 行 diff，没有"整文件换行"的伪 diff

# 还原
git checkout -- .team/STATE
```

---

## 8. 跨机器开发的风险点速查

| 风险 | 现象 | 处理 |
|---|---|---|
| Husky hook 不可执行 | commit 时报 `.husky/pre-commit: Permission denied` | `chmod +x .husky/pre-commit .husky/commit-msg` |
| Husky shebang CRLF 残留 | commit 报 `bad interpreter: /bin/sh^M` | `dos2unix .husky/pre-commit .husky/commit-msg`（需 `brew install dos2unix`），或用编辑器另存为 LF |
| 端口被占 | `docker compose up` 报 5432/6379 bind failed | `brew services list` 看本机是否跑了 postgres/redis，停掉再起 |
| Node 版本不对 | `npm install` 或 `npm test` 报语法错 | `nvm use 20`；或在项目根加 `.nvmrc` 写 `20` 后 `nvm use` |
| 大小写文件名冲突 | Linux CI 挂但 Mac/Win 过 | 执行 `find . -path ./node_modules -prune -o -type f -print \| awk -F/ '{print tolower($0)"\t"$0}' \| sort \| uniq -d -f0 -w300` 自查 |
| docker compose v2 警告 `version` 字段弃用 | 启动时 stderr 有 WARN | 可忽略；或日后把 `docker-compose.yml` 第 6 行 `version: "3.9"` 删掉（独立 PR） |
| `.team/STATE` 持久化冲突 | Mac / Windows 交替写同一快照 | 规约：`.team/STATE` 一律用 `write_to_file` 整文覆盖（I-001）· 跨机器只由一方维护 |

---

## 9. Windows 侧收尾（确认 Mac 跑通一周后再做）

```powershell
# 在 Windows 上
cd H:\Costra
git status                          # 必须 clean
git log origin/dev..dev             # 必须为空（无未推送 commit）
git log origin/dev..HEAD --all      # 所有分支都没有未推送的 commit

# 保留"冷备份"（可选，排除产物与依赖）
# 方案：直接把 H:\Costra 压缩一份存到安全位置
Compress-Archive -Path H:\Costra\* `
                 -DestinationPath H:\Costra-cold-backup-2026-04-24.zip `
                 -Exclude "node_modules","dist","coverage","miniprogram_npm",".husky\_"
# （PowerShell Compress-Archive 的 -Exclude 对子目录递归受限，必要时用 7-Zip GUI 更可靠）

# 确认无误后清理工作目录（可选）
# Remove-Item H:\Costra -Recurse -Force
# Remove-Item H:\Costra-migration -Recurse -Force   # 清理私密资产打包
```

---

## 10. 首次在 Mac 上触发 Agent（Orchestrator 状态连续性）

迁移后第一次干活，Orchestrator 会从 `.team/STATE` 加载快照。当前状态（迁移时点）：

- **MODE**：`awaiting-human`
- **在飞**：COSTRA-118 Round-1 REJECT 等 Human 终审
- **压线**：COSTRA-115 DNS 白名单 CI（04-25 截止）

也就是说，Mac 端第一次触发时，直接按 `.team/board.md §Doing / Human-Review` 的提示选一条指令即可（比如 `approve:COSTRA-118 路径 A` 或 `run devops COSTRA-115`）。`.team/STATE` 的连续性已经保住，不用重建。

> 📌 **铁律提醒**：任何 Agent 干活都需要 Human 发一句触发词。Mac 侧不会自动接着跑——Orchestrator 无守护进程 / 无跨会话。

---

## 11. 一页 Checklist（打印/贴窗）

**Mac 端一次性**：
- [ ] Xcode CLT / Homebrew / nvm / Node 20 / Docker Desktop / 微信开发者工具
- [ ] `git config --global core.autocrlf input` + user.name + user.email
- [ ] GitHub SSH key 配好 · `ssh -T git@github.com` 通
- [ ] `git clone git@github.com:stdmkmehp/Costra.git` + `git checkout dev`
- [ ] 解压 `costra-secrets.zip` 放回 `key/`
- [ ] 根目录 `npm install` + `cd server && npm install`
- [ ] `npm run typecheck`（根）通过
- [ ] `cd server && npm run typecheck && npm test` 全绿
- [ ] `docker compose up -d` 四服务 healthy
- [ ] `npm run dev` 后端可起
- [ ] 微信开发者工具导入 → 构建 npm → 可编译
- [ ] 随便改一行 + commit + push，Windows 侧 pull 看 diff 干净（验证行尾）

**稳定一周后**：
- [ ] Windows 侧冷备份归档
- [ ] （可选）清理 Windows 工程目录

---

_文档维护：Orchestrator · 若你发现任何一步失效，请更新这里并 commit。_
