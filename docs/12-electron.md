# 12 · Electron 桌面应用

应用名称「枝知」，英文内部名 `zhizhi`，appId `com.zhizhi.app`。品牌素材来自 `src/assets/zhizhi-mark.svg`；构建自动生成平台图标。发布渠道使用 GitHub Releases＋tag 触发 Actions；工作流只构建 Windows x64、Windows arm64 和 macOS arm64，暂未配置签名、公证或自动安装更新。

## 运行结构

Electron 主进程内运行同一套 Express API 和 SQLite；没有额外 Node 子进程，使用 Electron 自带 Node 的 `node:sqlite`。esbuild 将桌面入口及服务端业务打包为 ESM，schema.sql 一并复制；运行依赖由 electron-builder 收集。正式包不需要系统 Node、源码目录或外部启动命令。

生产加载内置 dist 的同源 HTTP 页面，服务仅绑定127.0.0.1。首次分配空闲端口，记录在数据目录 desktop-runtime.json，下次优先复用，保持浏览器 localStorage 偏好；端口占用时换用空闲端口，此时对话数据库保留，但当前来源的localStorage偏好需重新选择。

每次启动随机令牌，由主进程仅向内部来源的 `/api/*` 请求附加；外部请求没有令牌返回401，Origin检查继续生效。内部fake请求单独传递令牌，不把令牌传给真实模型。窗口关闭后中止生成、关闭HTTP连接并关闭数据库，macOS同样退出；单实例运行，重复启动聚焦现有窗口。

BrowserWindow禁用Node集成，启用contextIsolation、sandbox和webSecurity。sandbox preload通过contextBridge暴露平台信息及单一的侧栏材质开关，主进程校验调用窗口、主frame和布尔参数，不暴露通用Node或IPC操作。拒绝webview和非必要权限；HTTP(S)外链用系统浏览器打开，其他协议不放行。

## 数据

正式目录使用app.getPath('appData')下的zhizhi；开发使用zhizhi-development，测试可显式指定ZHIZHI_DATA_DIR到临时目录。均不迁移浏览器预览数据。SQLite结构不变。

Store支持注入SecretCodec，桌面入口用safeStorage加密／解密整个密钥JSON，文件仅存base64密文封装。浏览器服务不注入codec，沿用本地开发文件。无法解密时抛错，不当作空密钥覆盖原文件；全量清空通过同一codec写入空对象。POSIX权限仍为0600。系统安全存储不可用或Linux退回basic_text时拒绝启动。

## 开发及打包

- npm run dev：保留5173／3001浏览器流程。
- npm run dev:electron：5174的Vite＋3002的桌面服务，前端热更新；桌面／服务端变更重启命令。
- npm run build:electron：TypeScript、Vite、桌面ESM和图标构建。
- npm run pack：当前平台应用目录；npm run dist：当前平台安装包，不发布。
- `.github/workflows/release.yml`：推送 `v*` tag 或手动运行时，构建三种目标并只上传三个安装包（Windows x64／arm64 EXE、macOS arm64 DMG）到 GitHub Release；构建前从tag同步临时版本号；使用自动 `GITHUB_TOKEN`，不需要额外发布密钥。
- macOS发布只保留DMG；Windows发布只保留NSIS EXE。Linux仍可在本地用electron-builder打包，但不在当前Actions发布矩阵中。当前只验证macOS arm64，其他平台／架构不能视为已验证。GitHub自动附带的Source code压缩包不由Actions生成。

Release工作流使用原生Node.js 24运行时的官方Actions（checkout／setup-node／upload-artifact v7、download-artifact v8），发布任务固定ubuntu-24.04；macOS构建使用macos-15 ARM64。GitHub托管macOS ARM64容量排队提示由平台产生，工作流无法消除。

当前未配置开发者签名、公证和自动安装更新。用户负责UI视觉验收，桌面测试仅执行代码和DOM/API断言。

文档导入：主进程使用系统文件选择器，server/local-document.ts读取所选Markdown及同目录树中引用的图片；通过现有鉴权本地API提供给统一导入窗口，不向渲染进程开放任意路径读写。

菜单：macOS 保留应用／编辑菜单与开发菜单；Windows及Linux不设置应用菜单，避免窗口顶部出现单独的编辑菜单栏。

## 版本与更新提醒

CI的ZHIZHI_RELEASE_TAG同时由Vite注入前端、build-electron.mjs注入Electron主进程，两端共用shared/updates.ts中的releaseVersion。开发构建为空，不检查更新。server/updates.ts负责GitHub最新正式Release读取、12小时尝试缓存与版本比较；前端仅在启动时按偏好触发，手动按钮可绕过间隔。新版本由用户前往GitHub Release下载，不使用electron-updater、自动安装或后台下载。详细行为见10的更新检查。

## macOS 窗口外观

通用设置中的“侧栏系统模糊（Beta）”默认关闭，保存于现有preferences。开启时macOS使用sidebar vibrancy，Windows 11 22H2及以上使用Acrylic；旧Windows保持普通背景。仅左栏页面背景透明、正文保持不透明。隐藏独立标题栏，原生红黄绿按钮放在左上角（16px,16px），侧栏顶部预留48px；顶部空白和正文顶栏可拖动窗口，按钮保留点击交互。材质活跃状态跟随窗口，系统辅助功能可能调整模糊效果。浏览器预览及Windows不启用此样式。

侧栏收起时macOS正文顶栏左侧预留96px给原生窗口按钮。系统材质开启时，侧栏hover／选中背景和分隔线采用低透明度颜色。材质切换即时生效，无需重启；独立弹窗背景模糊仍由原有设置控制。

系统材质侧栏覆盖一层轻微半透明白色提亮（浅色约19%、深色约5%），并确保该规则优先于普通深色侧栏底色，避免深色主题下不透明背景遮挡原生材质。
