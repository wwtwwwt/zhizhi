# 03 · 架构与技术选择

## 运行形态

当前为Electron桌面应用，并保留本机Web开发预览。两者共用页面、Express API、SQLite和模型adapter，桌面服务在主进程内运行，安全与打包见[12](12-electron.md)。Web预览：浏览器 → Express API → SQLite／模型 adapter。开发时 Vite 监听127.0.0.1:5173，`/api` 代理到3001；构建后 Express 同时提供 dist 与 API，默认监听127.0.0.1:3001。

浏览器不直接打开 SQLite，不直接调用外部模型；模型密钥只在本机服务读取。API 限制为本机应用来源，带 Origin 的请求检查允许的主机及端口，不作为公开代理或多用户服务器。

## 技术栈

| 层 | 当前使用 |
|---|---|
| 前端 | React 19、TypeScript、Vite、原生 CSS、Lucide 图标 |
| 本机服务 | Node.js 24、Express 5、Zod 输入校验 |
| 数据 | Node 内置 node:sqlite，server/schema.sql 初始化 |
| Markdown | unified、remark-parse／gfm／math／stringify，KaTeX 公式 |
| 网络 | 原生 fetch 处理模型流；undici／ProxyAgent 处理论文转换 |
| 测试 | Vitest、临时 SQLite、本机 HTTP stub、Playwright |

## 模块与职责

| 位置 | 职责 |
|---|---|
| src/App.tsx | 侧栏、Conversation／MessageView／BlockView、选区、分支栈和重构预览 |
| src/client.ts | 可订阅状态、HTTP、SSE任务、流缓存与删除清理 |
| src/SendComposer.tsx | 主流／分支／选区共用输入及页面内草稿 |
| src/Markdown.tsx、selection.ts、StreamingMarkdown.tsx | 渲染、DOM选区桥接、Markdown复制和流式更新 |
| src/ReasoningPanel.tsx | 折叠思考摘要及临时计时 |
| src/SettingsPage.tsx、ModelManager.tsx | 设置分类、数据页和模型编辑 |
| src/WindowPanel.tsx、useCenteredResize.ts | 共用管理弹窗、窗口尺寸同步与记忆 |
| src/DocumentImport.tsx | 文件／论文导入入口 |
| server/app.ts | HTTP路由、校验、上游生成生命周期和SSE |
| server/store.ts、schema.sql | SQLite事务、节点／版本、上下文、重构及资源回收 |
| server/model-registry.ts、attachments.ts、documents.ts | 模型／密钥、消息附件、文档资源与转换 |
| server/providers/ | Chat Completions流式adapter和固定模拟样本 |
| shared/ | 类型、Markdown AST／位置映射、预算估算、SSE解析和布局计算 |
| tests/ | 代码、协议、数据及无截图交互测试 |

## 状态与持久化

SQLite 是聊天、模型配置与偏好的权威数据源。前端按流ID缓存已加载消息，打开流时按需获取，不递归预载整个分支树。分支摘要由服务端查询，流式任务独立于弹窗挂载，关闭分支不停止生成。

前端保留当前弹窗栈、选区、菜单、页面内草稿及生成草稿。localStorage 只保存最近会话、上次模型和共享窗口尺寸。刷新不恢复完整弹窗栈或输入草稿；网络断开结束模型流，服务重启恢复残留任务为 interrupted。

服务端与前端共用 Markdown 解析规则。规范选区为 UTF-16 半开范围，DOM文本片段映射到节点 selection_text；公式按原子长度处理。高亮在 AST 渲染阶段生成，不直接修改 React 管理的正文结构。原始 HTML 不执行，链接与图片按协议规则处理。

## 发布方向

当前本地生成macOS arm64的DMG和ZIP，Windows／Linux／Intel Mac构建配置已准备但未验证。发布计划为GitHub tag触发Actions构建并上传Releases，暂未配置。开发者签名、公证和自动更新后续处理。

现有dist仍依赖本机API，不能直接当作完整纯静态网页部署。PWA、云账号和同步未实现。
