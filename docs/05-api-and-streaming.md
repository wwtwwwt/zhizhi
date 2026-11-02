# 05 · API 与模型流

## HTTP约定

路径以 `/api` 开头，JSON 输入经 Zod 校验；错误结构为 `{ error: { code, message } }`。requestId 为 UUID，创建生成任务及笔记使用幂等重放，冲突返回409。API不返回密钥。

| 方法／路径 | 输入与行为 |
|---|---|
| GET /health | 本机服务健康状态 |
| GET／POST /sessions | 获取概览／用可选title新建会话和主流 |
| PATCH／DELETE /sessions/:id | 更新title／停止相关生成并删除会话 |
| GET /streams/:id | 消息、块、当前节点、可用版本、anchors、source、待完成重构 |
| GET /streams/:id/context | 估算已用预算，可选sourceNodeId截取祖先前缀 |
| POST /streams/:id/messages | text、requestId、可选modelId／attachments，保存问题与回复任务 |
| POST /branches | sourceNodeId、start、end、selectedText、requestId、kind及正文，原子创建分支 |
| DELETE /branches/:id | 删除分支树，返回streamIds、parentStreamId |
| PATCH /slots/:id/content | markdown、expectedActiveNodeId，编辑并重新切块 |
| POST /slots/:id/after | markdown、expectedActiveNodeId，在下方插入独立块 |
| DELETE /slots/:id | expectedActiveNodeId、必填scope（all／current），返回被删streamIds |
| PATCH /slots/:id/active-version | nodeId、expectedActiveNodeId，切版后返回ok；客户端重载流 |
| POST /nodes/:id/rewrites | requestId、可选modelId（界面传目标流输入框所选模型），捕获后代上下文并创建重构任务 |
| POST /rewrite-proposals/:id/accept | expectedActiveNodeId，采用候选 |
| POST /rewrite-proposals/:id/reject | 保留原文，拒绝候选 |
| GET /generations/:id/events | 启动queued任务并订阅SSE，单任务只执行一次 |
| POST /generations/:id/cancel | 停止任务并保存草稿 |
| GET／PUT /settings | 获取／部分更新通用偏好、fakeDelay |
| GET／POST /models | 获取模型列表／添加模型 |
| PUT／DELETE /models/:id | 更新／删除模型，包含图片能力；fake只允许更新fakeDelay且不可删除 |
| 模型切换 | 在输入框模型菜单中选择并保存上次选择到浏览器 localStorage |
| POST /models/discover | baseUrl、可选apiKey／configuredModelId，读取上游/models |
| GET /attachments/:id | 返回主动发送的附件内容 |
| POST /documents/import | name、markdown、可选documentPath及resources，导入文档 |
| POST /documents/paper | url，经InkToMd转换并导入 |
| GET /document-resources/:id | 返回展示图片，设置nosniff及sandbox CSP |
| GET／DELETE /storage | 存储统计／以confirm=DELETE_ALL_DATA全量清除 |
| POST /fake/v1/chat/completions | 内置模拟端点，使用messages、stream和专用__fake字段 |

发送消息允许仅附件输入。分支kind默认question：问题放question，可携带模型和附件；kind=note必须以question提交非空笔记，不创建generation，返回streamId和branch。追问返回generationId、streamId、messageId及branch。模型和文档字段详见[08](08-models-and-attachments.md)与[09](09-document-import.md)。

流中anchor的preview包含question／answer／status，来自首条用户与AI消息当前可见块，纯文本各截取最多180字符。source带parent_stream_id供结束后刷新父流摘要；预览不进入模型上下文。

## 生成与SSE

创建任务为queued；首次订阅events启动，上游执行时标streaming。每流同一时刻最多一个未结束生成；其他流独立。重复执行同一任务返回冲突。

| 事件 | JSON data |
|---|---|
| start | generationId、kind |
| reasoning | text，服务商公开输出的思考摘要增量 |
| delta | text，正文增量 |
| complete | generationId、messageId；重构为proposalId、candidateNodeId |
| error | code、message |

complete只在数据库提交成功后发送。异常断流不能当完成；停止、错误和断连保存终态及草稿。任务完成时，前端同时替换持久化流并移除流式job，防止定稿正文与草稿同时出现。服务端约250ms节流保存正文草稿，终态立即保存。

SSE解析支持跨chunk UTF-8、CRLF、多行data、注释和多个事件；网络chunk不等于完整事件。关闭弹窗保留全局生成连接；离开页面／刷新断连会中断任务，不支持断点续传。普通回复手动停止时将已生成正文切块并纳入后续上下文，保留stopped状态；停止接口读取内存中的最新正文，避免遗漏尚未周期落库的末尾。失败／意外中断只保留草稿。重构停止不创建部分候选。不提供重试操作，用户可在底部继续提问。

## Chat Completions adapter

生成快照为 `{ modelConfig }`，密钥按模型ID在执行时读取。adapter发送到Base URL的`/chat/completions`：启用参数、model、messages、stream=true。本地预算context_length不发上游。

解析choices[0].delta.content；有reasoning_content时单独回调。收到[DONE]才算协议完成。非SSE、错误JSON、空正文、提前断连均进入错误路径。等待响应和事件间空闲超时为60秒；用户停止会abort上游，不自动重试或降级模拟模型。

fake经loopback调用内置端点，复用相同adapter和SSE解析器。固定样本覆盖Markdown、公式、分支与重构；先输出明确模拟的reasoning_content，再正文。默认间隔30ms，支持中途error／disconnect测试场景，不访问外部模型。当前输入框模型选择显示所选模型，无额外常驻状态灯。

## 错误与边界

400为无效输入、模型配置或预算问题；404为资源不存在；409为选区重叠、忙状态、版本或请求冲突；422为选区／公式校验或空笔记；502为上游和协议错误，504为模型等待超时。具体以错误code和message为准。

API面向本机应用，不支持任意跨域访问。模型协议已在本机stub验证；没有用真实外部模型做端到端验证，不保证每家供应商支持全部可选参数。

`DELETE /api/messages/:id`删除整条消息及其版本分支，返回`{streamIds,parentStreamId}`；生成中的流拒绝删除，客户端清除已删流缓存并重新读取父流。`DELETE /api/slots/:id`的scope支持all／current／history，history保留当前版本。
