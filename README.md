# 枝知 · zhizhi

一个帮助用户理解内容的本地 AI 对话工具。选中回答中的文字，展开持久分支；在分支中继续追问或记笔记，也可以结合追问重新解释原内容，并切换独立版本。

软件文档（施工中）

## 许可证

本项目采用 **GNU Affero General Public License v3.0**，许可证标识为 `AGPL-3.0-only`。完整协议文本见 [LICENSE](LICENSE)。

版权所有 © 2026 zhizhi。

## 数据与密钥

桌面版数据保存在系统应用数据目录，不写入安装目录：

| 平台 | 正式版数据目录 |
|---|---|
| macOS | `~/Library/Application Support/zhizhi/` |
| Windows | `%APPDATA%/zhizhi/` |
| Linux | `$XDG_CONFIG_HOME/zhizhi/`，通常为 `~/.config/zhizhi/` |

Electron 开发版使用同级 `zhizhi-development/`，与正式版、浏览器预览数据隔离，不自动导入已有预览数据。实际路径和占用空间可在「设置 → 数据」查看。

聊天、分支、笔记、版本、附件和模型公开配置保存在本地 SQLite。桌面版模型密钥由 Electron `safeStorage` 加密后保存到 `secrets.json`，依赖操作系统钥匙串／凭据服务；不可用时拒绝启动，不降级为明文。迁移到其他电脑时需要重新配置密钥。没有账号或云同步。


## 软件开发

### 开发与预览

需要 Node.js **24.18 或更新的 24.x** 和 npm。

```sh
npm install
npm run dev
```

打开 <http://127.0.0.1:5173>，API 为 `127.0.0.1:3001`。浏览器预览默认把数据保存在项目 `.learnhelper/`，可用 `LEARNHELPER_DATA_DIR` 覆盖；此模式密钥为权限受限的本地明文文件，桌面版使用上述系统加密方案。


也可以使用以下命令，启动 Electron 桌面实时预览进行开发：

```sh
npm install
npm run dev:electron
```

使用独立的前端 `5174` 和内部 API `3002` 端口。桌面入口／服务端代码改动后重启此命令；页面代码修改自动更新。桌面 API 带启动时随机令牌，不能直接在普通浏览器中访问。

### 打包

在目标系统执行，默认打包当前机器架构；产物输出到 `release/`：

```sh
npm run dist
```

可显式选择平台和架构（建议使用Actions对应系统构建机）：

```sh
npm run dist -- --mac --arm64
npm run dist -- --mac --x64
npm run dist -- --win --x64
npm run dist -- --win --arm64
npm run dist -- --linux --x64
```

## GitHub Actions 发布

工作流位于 `.github/workflows/release.yml`。它在推送 `v*` 标签时构建并发布 GitHub Release，也可以在 GitHub 的 **Actions → Build and release 枝知 → Run workflow** 手动输入标签。普通分支 push 不会发布。

当前矩阵为 Windows `x64`（64 位 Intel／AMD）、Windows `arm64`（Windows on ARM）和 macOS `arm64`（Apple Silicon）。每个构建先运行 `npm ci`、TypeScript／Vite 构建和 Electron 打包，再由发布任务把 DMG、ZIP、EXE 及更新元数据上传到 Release。

仓库不需要额外发布密钥：工作流使用 GitHub 自动提供的 `GITHUB_TOKEN`，并声明了 `contents: write` 权限。首次使用前，在仓库 **Settings → Actions → General → Workflow permissions** 确认允许工作流读写仓库内容。

发布步骤：

```sh
git tag v0.1.0
git push origin v0.1.0
```

等待三个构建任务和发布任务完成后，在仓库 **Releases** 页面复制下载链接。版本号由 tag 管理，tag 应与 `package.json` 的版本保持一致。当前未配置代码签名、公证、自动更新或 GitHub App；未签名的 macOS／Windows 安装包可能显示系统安全提示。后续加入签名时，再把证书和密码放入 GitHub Actions Secrets，不写入仓库。
