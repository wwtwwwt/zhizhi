# 08 · 模型与附件

## 模型管理

设置的供应商Tab直接显示模型列表，添加／编辑模型使用共用WindowPanel弹窗，点击保存后才生效；取消或关闭丢弃草稿。固定「模拟模式」保留用于调试，不可删除，可调整fakeDelay；不再存在独立的旧单模型配置。

| 配置 | 行为 |
|---|---|
| Base URL | HTTP／HTTPS接口根地址，自动去除末尾斜杠，不接受URL内嵌凭据、查询参数及片段 |
| 接口类型 | Chat Completions／Responses／Anthropic Messages，独立于供应商品牌选择 |
| API Key | 不回填已保存值；右侧按钮清除草稿值，点击保存才提交；取消或关闭保留原配置 |
| 模型ID | 添加引导中展示模型列表、支持筛选及自由输入；编辑时可重新读取列表 |
| 显示名称 | 模型ID最后一个“/”右侧部分为默认名；保留用户自定义名 |
| 上下文长度 | 独立于高级设置，默认128000，作为本地预算 |
| 图片输入 | 用户显式配置，不根据模型ID猜测 |
| 高级参数 | 默认折叠，键值表编辑、启停、添加和删除 |

地址／密钥变化使模型候选及在途发现结果失效。模型发现可使用当前输入Key，或复用对应模型已保存的Key；清除Key后不复用旧值。发现结果只提供ID，不证明图片能力或上下文上限。

## 参数与快照

新建引导保留temperature=0.7但默认不启用，max_tokens=4096默认启用，reasoning_effort=medium默认禁用。context_length以参数形式保存但不透传。max_tokens／max_completion_tokens／max_output_tokens只允许启用一种，预算检查识别三者；Responses将输出上限转为max_output_tokens，Messages转为max_tokens，Chat按所选参数名发送。Responses将reasoning_effort转为reasoning.effort；Messages不接受reasoning_effort，需禁用后按Anthropic规范配置thinking等参数。其他启用参数按服务商规范发送，不自动推断模型能力。重复键及model／messages／input／system／stream／store等保留字段拒绝。

任务创建时冻结所选模型配置，修改模型配置不改变已有任务。执行时按模型ID读取当前Key；停止、失败或中断的任务不提供重试。

配置保存于SQLite models表；fakeDelay存settings.preferences；上次模型选择存浏览器localStorage.lastModelId。密钥按内部ID存私有secrets.json的modelKeys，POSIX权限0600。空Key保持原值，显式清除删除对应索引；GET只返回hasApiKey，不返回Key正文。浏览器预览为本地明文文件，Electron版通过safeStorage加密并使用系统安全存储；见[12](12-electron.md)。

apiType及Messages可选authType保存在现有模型config_json和生成快照中，无新表或库迁移；未指定apiType时使用Chat Completions。默认Bearer认证；Messages官方使用x-api-key及anthropic-version:2023-06-01，也允许选择Bearer以适配中转。远程模型仍要求密钥，本机127.0.0.1／localhost／::1可无密钥。

## 从本机配置导入

`server/model-import.ts`只在用户打开添加／复制弹窗时读取固定来源，不递归扫描目录、不修改来源文件：

- Claude Code：`~/.claude/settings.json`（支持CLAUDE_CONFIG_DIR），读取env.ANTHROPIC_BASE_URL、ANTHROPIC_API_KEY／ANTHROPIC_AUTH_TOKEN，以及model／env.ANTHROPIC_MODEL。API_KEY使用x-api-key，AUTH_TOKEN使用Bearer。
- Codex：`$CODEX_HOME/config.toml`与auth.json，默认`~/.codex/`。读取当前model_provider及profiles中的模型／供应商组合、base_url（或openai_base_url）、wire_api、experimental_bearer_token。env_key只查询枝知进程可见环境；内置openai也识别进程OPENAI_API_KEY。auth.json只使用明确的OPENAI_API_KEY，适用于内置openai或requires_openai_auth供应商。

仅API地址与密钥均完整时提供导入；不读取OAuth登录令牌、钥匙串、项目级配置或shell文件，不运行apiKeyHelper等命令。包含动态鉴权、AWS／OAuth或额外请求头要求的Codex供应商不作为可直接导入来源。订阅登录凭据不能作为通用API Key使用。桌面启动的环境变量可能不同于终端环境，因此未识别的配置需手动填写。DeepSeek Harness不在本轮范围。

导入候选的密钥只在服务端内存保存，前端只收到不透明id、来源、地址、接口类型和模型。id有效30分钟，读取列表、检测及保存通过id在服务端解析密钥，且绑定原地址／协议／认证方式；修改连接需手动填密钥。确认保存才写入枝知密钥存储，来源文件保持原样。用户只看到找到的可用来源；无完整配置或文件不可读／格式异常时直接进入手动流程。解析使用smol-toml，不执行配置内容。

## 三种生成接口

统一上下文仍由枝知组装，`server/providers/protocol.ts`负责请求转换及统一ModelEvent，`chat.ts`复用超时、中断和SSE读取。Responses每轮发送完整input，store=false，不使用previous_response_id或服务端会话；Messages提取system并将图片转换为base64／URL source。Chat保留原messages格式。文本、图片附件、主流、分支及重构共用此转换层。

这轮只支持普通生成，不执行工具调用或Agent循环。ModelEvent保留metadata事件供后续扩展，当前不会将完整协议块／工具调用历史持久化，也不会把思考摘要重放到后续上下文。后续引入Agent时仍需补齐工具记录及协议附加数据的持久化。

## 共用输入框

主流、分支与选区追问共用SendComposer，正文等宽，右侧功能区留空。底部左侧为图片／文本附件，右侧为上下文环、模型选择和发送／停止；模型菜单可直接跳转供应商。聚焦不使整框边框变亮。

上下文环深色为已用预算（含本次输入和输出预留），浅色为剩余，悬停显示估算余量。采用本地字符估算，图片按固定预算估算，不等于真实tokenizer或计费。预算不足时阻止发送，服务端再次检查。

图片按钮使用简洁图片图标，仅支持图片输入的模型显示；文本按钮使用简洁文件图标，悬停显示支持格式；非纯文本文档提示先用 MinerU 转换。已加图片后切到不支持的模型会阻止发送。当前上下文继承了图片时，服务端同样拒绝文本模型，不能静默丢图。笔记模式无模型、发送和附件控件，仅取消／保存。

## 消息附件

| 项目 | 限制 |
|---|---|
| 图片 | JPG／PNG，检查扩展名、MIME和文件头；每个最多5 MiB |
| 文本 | UTF-8纯文本，包括txt、md及源代码，拒绝二进制；每个最多1 MiB |
| 数量及总大小 | 一条最多6个，总计12 MiB |

发送时事务内跟消息保存到attachments表，图片用BLOB、文本用UTF-8字节。文本加入带文件名的数据段；图片在请求时展开为image_url。祖先快照通过消息ID继承，不重复存字节，兄弟分支不互读。

会话删除级联回收附件；块／分支删除按现存冻结引用保留必要资源。导入文档的展示图片另存document_resources，不是模型附件，见[文档导入](09-document-import.md)。

## 思考摘要

adapter将Chat的reasoning_content、Responses的reasoning_summary_text.delta及Messages的thinking_delta与正文分开处理，SSE发reasoning事件，SQLite独立保存reasoning_text。折叠面板显示服务商返回的内容；流式首段摘要到首段正文期间显示计时，正文开始后停表。计时仅属页面临时状态，不持久化。

fake先输出明确标注的固定模拟摘要，再输出Markdown正文。没有返回思考内容的服务不显示面板，不主动索取内部私有思考。摘要不分块、不创建追问、不进入后续上下文。

## 验证边界

模型发现、参数和多模态流使用本机HTTP stub验证，未调用付费外部模型。OpenAI官方文档核查受访问限制，不能把stub通过等同于供应商兼容保证；模型可选参数需按实际服务启停。

## 粘贴、拖入与恢复附件

主对话、分支及追问悬浮框共用 SendComposer：支持将剪贴板中的文件／图片粘贴到输入框，或将文件拖入输入区域；普通文本粘贴保持原生行为。仅能读取系统／浏览器实际提供的 File，不读取剪贴板里的本地路径字符串。图片仅在模型支持图片输入时接收；所有入口共用 JPG／PNG、UTF-8 纯文本、数量及大小限制，常见 PDF／Office／压缩包引导到 MinerU 转换。笔记悬浮框仍只编辑文字。

重新提问前，服务端在事务中取回上一条用户消息当前可见正文与原附件字节，再删除问答和相关分支。前端将内容放到本流草稿最前面，不自动发送，保留原模型选择。合并后的附件仍需通过正常发送限制，超限时由用户移除；不会静默丢弃附件。导入文档的展示图片引用在恢复时转为内联data URL，避免资源清理后失效。
