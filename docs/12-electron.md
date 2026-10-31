# 12 · Electron 桌面应用

应用名称「枝知」，英文内部名 `zhizhi`，appId `com.zhizhi.app`。品牌素材来自 `src/assets/zhizhi-mark.svg`；构建自动生成平台图标。发布渠道使用 GitHub Releases＋tag 触发 Actions；工作流只构建 Windows ia32、Windows arm64 和 macOS arm64，暂未配置签名、公证或自动更新。

## 运行结构

Electron 主进程内运行同一套 Express API 和 SQLite；没有额外 Node 子进程，使用 Electron 自带 Node 的 `node:sqlite`。esbuild 将桌面入口及服务端业务打包为 ESM，schema.sql 一并复制；运行依赖由 electron-builder 收集。正式包不需要系统 Node、源码目录或外部启动命令。

生产加载内置 dist 的同源 HTTP 页面，服务仅绑定127.0.0.1。首次分配空闲端口，记录在数据目录 desktop-runtime.json，下次优先复用，保持浏览器 localStorage 偏好；端口占用时换用空闲端口，此时对话数据库保留，但当前来源的localStorage偏好需重新选择。

每次启动随机令牌，由主进程仅向内部来源的 `/api/*` 请求附加；外部请求没有令牌返回401，Origin检查继续生效。内部fake请求单独传递令牌，不把令牌传给真实模型。窗口关闭后中止生成、关闭HTTP连接并关闭数据库，macOS同样退出；单实例运行，重复启动聚焦现有窗口。

BrowserWindow禁用Node集成，启用contextIsolation、sandbox和webSecurity。没有preload或渲染侧Node桥。拒绝webview和非必要权限；HTTP(S)外链用系统浏览器打开，其他协议不放行。

## 数据

正式目录使用app.getPath('appData')下的zhizhi；开发使用zhizhi-development，测试可显式指定ZHIZHI_DATA_DIR到临时目录。均不迁移浏览器预览数据。SQLite结构不变。

Store支持注入SecretCodec，桌面入口用safeStorage加密／解密整个密钥JSON，文件仅存base64密文封装。浏览器服务不注入codec，沿用本地开发文件。无法解密时抛错，不当作空密钥覆盖原文件；全量清空通过同一codec写入空对象。POSIX权限仍为0600。系统安全存储不可用或Linux退回basic_text时拒绝启动。

## 开发及打包

- npm run dev：保留5173／3001浏览器流程。
- npm run dev:electron：5174的Vite＋3002的桌面服务，前端热更新；桌面／服务端变更重启命令。
- npm run build:electron：TypeScript、Vite、桌面ESM和图标构建。
- npm run pack：当前平台应用目录；npm run dist：当前平台安装包，不发布。
- `.github/workflows/release.yml`：推送 `v*` tag 或手动运行时，构建三种目标并上传 GitHub Release；使用自动 `GITHUB_TOKEN`，不需要额外发布密钥。
- macOS：DMG＋ZIP；Windows：NSIS；Linux：AppImage＋deb。当前只验证macOS arm64，其他平台／架构不能视为已验证。

当前未配置开发者签名、公证和自动更新。用户负责UI视觉验收，桌面测试仅执行代码和DOM/API断言。
