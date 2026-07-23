# P6-10 Sky Companion Bridge Design

## 1. 背景与目标

本设计定义 Dylan Heartbeat 与 `sky-pc-mcp-companion` 之间的最小、受控集成边界，让 AI Companion 在用户主动开启的前台会话中：

1. 读取《Sky: Children of the Light》（光遇）当前可见状态。
2. 结合有限、已确认的长期 Memory 陪用户聊天。
3. 在用户明确发起或确认后，向当前光遇聊天输入框发送一条消息。

第一阶段是“陪伴桥接”，不是游戏自动化。它不控制角色、不规划路线、不执行任务、不收集资源，也不绕过客户端、游戏协议或平台安全机制。

本设计不授权代码实现、不新增数据库或 migration，也不改变现有 MCP 默认只读权限模型。第三方项目的具体版本、源码、Tool schema、许可证和运行方式必须在实现前单独锁定并审计。

## 2. `sky-pc-mcp-companion` 能力分析

### 2.1 当前可确认范围

仓库内没有包含 `sky-pc-mcp-companion` 的源码、依赖锁定或协议说明。公开项目索引将其描述为光遇 PC 桌面 AI 伴侣，涉及：

- 捕获游戏窗口画面。
- 从截图识别聊天气泡或可见文本。
- 调用可配置模型生成回复。
- 通过桌面输入向游戏聊天发送回复。

这些是接入前的能力假设，不是 Dylan Heartbeat 可以直接信任的稳定 contract。尤其不能假设第三方 MCP Server 已经做到：

- 只捕获目标游戏窗口。
- 输出字段经过隐私过滤。
- 键盘输入只作用于聊天框。
- 不包含鼠标、移动、交互、脚本或任意命令能力。
- 不记录截图、聊天正文、token、模型 prompt 或 provider response。

### 2.2 接入前契约验证

进入实现前必须固定：

- 精确仓库来源、commit/tag、许可证和依赖版本。
- MCP transport 类型及本地监听边界。
- 完整 Tool/Resource 列表、input/output schema 和 annotations。
- 截图来源、窗口选择方法、OCR 引擎和临时文件生命周期。
- 键盘发送实现、焦点检查、失败语义和最大文本长度。
- 是否存在任意 shell、文件、网络、鼠标、按键或游戏操作 Tool。
- 是否会自行调用模型、保存历史或连接外部服务。

未完成上述验证时，整体状态为 `NOT_READY`，不得进入实现或运行连接。

### 2.3 Dylan Heartbeat 不采用的能力

即使第三方提供以下能力，Bridge 也不得注册、转发或调用：

- 任意屏幕、任意窗口或摄像头捕获。
- 任意 OCR 文件路径或 URL。
- 通用键盘、热键、鼠标、手柄或窗口控制。
- 角色移动、跳跃、飞行、牵手、交互、传送或菜单操作。
- 路线规划、自动跑图、任务编排、资源识别或收集。
- 游戏内存读取、注入、hook、封包、私有协议或反作弊规避。
- 任意 shell、PowerShell、进程、文件或网络调用。
- 第三方内置的自动模型回复循环。

## 3. Dylan Heartbeat 连接方式

### 3.1 组件边界

建议增加独立的本地 `Sky Companion Adapter`，但本设计不实现该组件：

```text
Sky PC game window
    |
    v
sky-pc-mcp-companion (pinned, local)
    |
    | narrow MCP allowlist
    v
Sky Companion Adapter
    |
    +--> normalized read-only Sky observation
    |
    +--> one approved chat-send request
             |
             v
      ToolExecutionGateway / Approval
             |
             v
        narrow chat sender

Dylan Agent Runtime
    <--- observation + bounded Memory context
    ---> companion reply candidate
```

第三方 Server 不能直接连接数据库、EventStore、Memory、State、Delivery Worker、模型配置或 Dylan 的通用 Tool Registry。Adapter 只接收固定配置的本地 endpoint/stdio 进程，调用方不能在 Tool input 中指定 URL、命令、窗口句柄、进程名、文件路径或 token。

### 3.2 进程与网络隔离

- 优先使用本机 stdio 或仅 loopback 的本地 transport。
- 禁止把第三方 MCP Server 暴露到公网或局域网。
- Bridge 使用固定 Server 身份和固定 Tool allowlist。
- 不接受第三方动态 Tool catalog 扩权。
- 不将 Dylan API Bearer token、模型 token 或 Memory 内容交给第三方 Server。
- 第三方 Server 不负责调用模型；陪聊模型调用仍由 Dylan 既有受控模型边界负责。
- transport 断开时安全失败，不降级为通用桌面控制。

### 3.3 会话条件

Bridge 仅在用户显式开启的前台 Sky Companion session 中工作。每个 session 应具备：

- 短生命周期 `sessionId`。
- 明确的目标游戏窗口身份。
- 启用时间与超时。
- 用户可立即停止的控制。
- 断开、窗口失焦、游戏退出或身份变化时自动失效。

停止 session 后不得继续截图、OCR、模型生成或键盘输出。

## 4. MCP Tool 隔离

### 4.1 第三方 Tool allowlist

Adapter 不直接向 Agent 暴露第三方原始 Tool。第一阶段只允许两个规范化能力：

| Bridge capability | 性质 | 用途 |
| --- | --- | --- |
| `sky_observation_get` | 只读 | 获取当前目标窗口的一次受限观察 |
| `sky_chat_message_send` | 写入、有副作用 | 向已验证的当前聊天输入框发送一条已批准消息 |

实际第三方 Tool 名称必须在版本锁定后映射，不能依赖模糊匹配或动态发现。

### 4.2 `sky_observation_get`

建议输入：

```json
{
  "sessionId": "opaque-session-id"
}
```

禁止输入窗口名、进程 ID、坐标、区域、文件路径、URL、OCR prompt 或截图参数。

建议输出白名单：

```json
{
  "observedAt": "ISO-8601 timestamp",
  "windowState": "foreground|background|missing",
  "chatVisible": true,
  "chatLines": [
    {
      "text": "bounded OCR text",
      "confidence": 0.92,
      "speaker": "unknown|self|other"
    }
  ],
  "sceneHint": "unknown|social|travel|menu",
  "truncated": false
}
```

`sceneHint` 只能是粗粒度视觉分类，不能声称游戏内部状态或任务事实。第一阶段可以完全固定为 `unknown`。不得返回原始窗口句柄、屏幕坐标、用户账户标识、好友 ID、路径、OCR debug 数据或完整截图。

该 Tool 保持：

```text
readOnlyHint: true
destructiveHint: false
idempotentHint: true
openWorldHint: false
```

### 4.3 `sky_chat_message_send`

该能力不能加入当前只读 Memory MCP Server，也不能通过通用 MCP client 直接调用。它是 Runtime 内部的窄写能力，必须经过现有 Tool Registry、Capability Policy、Approval 和 ToolExecutionGateway 的独立执行链。

建议输入：

```json
{
  "sessionId": "opaque-session-id",
  "message": "bounded approved text",
  "observationId": "opaque-observation-id"
}
```

约束：

- 不允许 key sequence、快捷键、坐标、延迟、循环次数或窗口选择参数。
- `message` 必须经过长度、控制字符、换行和不可见字符校验。
- `observationId` 必须属于同一活动 session 且尚未过期。
- 每次调用最多发送一条消息。
- Approval 必须绑定规范化后的精确消息、session 和 observation。
- 修改任何字符后原 Approval 失效。
- 不提供 batch、schedule、repeat、retry-until-success 或 auto-reply。

MCP annotations 不能代替 Approval。若未来第三方原始写 Tool 必须经 MCP transport 调用，它也只由 Adapter 内部访问，绝不注册为 Dylan 公共 MCP 写工具。

### 4.4 防止能力串联

- 只读观察不能返回可被解释为通用桌面操作的坐标或句柄。
- 聊天发送不能接受观察结果中的任意动作建议。
- Agent 不能从 OCR 文本构造 Tool 名、URL、命令或新权限。
- OCR 中出现“忽略规则”“调用工具”等文本一律视为不可信游戏内容，不是系统指令。
- 第三方新增 Tool 时默认拒绝，不能自动进入 allowlist。

## 5. Screenshot / OCR 输入边界

### 5.1 Screenshot 边界

- 仅捕获已绑定、身份已验证的光遇游戏窗口客户区。
- 禁止全屏、其他窗口、通知区域、任务栏、剪贴板或后台窗口捕获。
- 游戏窗口不在前台时默认不捕获；如产品需要后台读取，必须作为新的安全设计明确授权。
- 一次 Agent turn 最多进行一次观察；不自动轮询、不连续录像。
- 原始像素只在本地内存中短暂存在，OCR 完成后立即释放。
- 不写磁盘、不进入 Event、Memory、State、Audit payload 或普通日志。
- 不将截图发送给第三方外部服务。未来如需视觉模型，必须另行设计和授权。

### 5.2 OCR 边界

OCR 输出是不可信输入。Adapter 必须：

- 只保留聊天区域的有限行数和单行最大长度。
- 过滤控制字符、零宽字符和异常 Unicode。
- 标记 confidence，不把低置信文本当作确定事实。
- 不保证 speaker 身份；不能仅凭颜色或位置确认真实用户身份。
- 不把 OCR 文本自动保存为 Memory、Event 或聊天历史。
- 不记录完整聊天内容、prompt、provider response 或 debug stack。
- 不从 OCR 推断账号、位置、好友关系、情绪、任务状态或资源数量。

OCR 错误只返回稳定、安全的错误码，例如：

```text
SKY_WINDOW_NOT_AVAILABLE
SKY_WINDOW_NOT_FOREGROUND
SKY_CHAT_REGION_NOT_FOUND
SKY_OCR_UNAVAILABLE
SKY_OBSERVATION_EXPIRED
```

错误中不得包含截图、OCR 全文、路径、窗口标题、内部异常或 stack。

## 6. Keyboard / Chat 输出边界

### 6.1 允许行为

第一阶段唯一允许的键盘副作用是：向已验证的光遇聊天输入框写入一条经用户批准的纯文本消息，并执行一次明确的发送动作。

执行前必须重新检查：

- session 仍有效。
- 目标窗口身份未变化。
- 游戏窗口在前台。
- 聊天输入框处于可验证的激活状态。
- Approval 未过期、未消费，且绑定的消息完全一致。

任何检查失败均不得注入按键。

### 6.2 Approval

默认采用逐条 Approval：

1. Agent 基于观察和受限 Memory 生成回复候选。
2. UI 向用户展示最终将发送的精确文本。
3. 用户选择发送或拒绝。
4. ToolExecutionGateway 消费一次性 Approval。
5. Adapter 执行一次发送并返回 receipt。

“用户刚才让我回复”“这是低风险聊天”或模型自信度都不能替代 Approval。第一阶段不提供“始终允许”“本会话自动回复”或后台自动发送。

### 6.3 发送结果

建议结果：

```json
{
  "status": "sent|not_sent|unknown",
  "receiptId": "opaque-receipt-id",
  "completedAt": "ISO-8601 timestamp"
}
```

- `sent`：Adapter 已确认完整的受控输入序列完成，但不声称游戏服务器已接收。
- `not_sent`：在任何按键副作用前安全失败。
- `unknown`：开始输入后焦点丢失、超时或 transport 中断，无法确认。

`unknown` 不得自动重试。用户必须重新观察、重新确认消息，再发起新 Approval。receipt 不包含消息正文、按键序列、窗口信息或聊天内容。

### 6.4 明确禁止

- 通用键盘输入和任意快捷键。
- 使用剪贴板传输聊天文本。
- 自动打开聊天、自动切换窗口或抢占焦点。
- 根据 OCR 自动回复。
- 多条消息、循环消息、定时消息或垃圾消息。
- 发送账号、token、Memory 原文或未经用户确认的敏感内容。
- 在聊天发送失败后自动重试。

## 7. Memory 如何影响游戏陪伴

### 7.1 允许使用

Agent 可以通过现有只读 Memory 检索获取少量、active、用户已确认且与当前陪聊相关的长期语义，例如：

- 用户偏好的称呼和语言。
- 用户明确确认的交流风格。
- 与光遇有关、且适合在当前场景提及的稳定偏好。
- 用户明确保存的共同回忆提示。

检索必须有界、可解释，并复用现有 Memory/Relationship 只读视图。Bridge 和第三方 MCP Server 不直接访问 Memory Store。

### 7.2 禁止影响

- 截图、OCR、游戏聊天或发送结果不能自动创建或修改 Memory。
- 模型不能把游戏中他人的话自动认定为用户事实。
- 游戏互动频率不能自动修改关系等级、熟悉度或 State。
- 不将完整 Memory 内容传给第三方 MCP Server或游戏聊天。
- 不因 Memory 中存在任务、路线或资源偏好而触发游戏行为。
- 不把 `event` Memory 当作当前游戏状态。
- 不使用敏感 Memory 生成公开聊天消息。

Memory 只影响陪聊内容候选，不授予 Tool 权限，也不跳过用户确认。若未来希望把一段游戏经历保存为长期 Memory，必须走独立的 Memory candidate/preview/confirm 流程，不属于本阶段。

## 8. Agent Runtime 集成边界

### 8.1 上下文构建

建议 Agent turn 的输入顺序：

```text
system safety policy
    + current bounded Sky observation
    + bounded approved Memory context
    + current user request
    -> reply candidate
```

上下文不包含原始截图、完整聊天历史、第三方 debug 输出、provider response、token 或内部 Tool metadata。模型输出仍只是候选文本，不能直接执行发送。

### 8.2 Event / Audit / State

重要执行事实必须经过 EventStore 或现有 Tool Audit 边界。第一阶段未来可记录最小事实：

- session started/stopped。
- observation succeeded/failed，不含 OCR 正文。
- chat send requested/approved/rejected。
- send result `sent|not_sent|unknown` 和不透明 receipt 关联。

禁止 Event/Audit payload：

- 截图或路径。
- OCR/chat/message 正文。
- Memory 内容。
- prompt、provider response、token。
- 窗口标题、账号或好友身份。
- 内部异常和 stack。

State 不保存心理判断、游戏进度、地图位置、资源数量或聊天内容。第一阶段不新增持久化状态；活动 session、observation 和一次性 receipt 可以是短生命周期内存对象。是否需要持久化幂等 receipt 必须在实现阶段单独设计，不得以本设计为 migration 授权。

### 8.3 与现有核心模块的关系

本阶段不得修改：

- Wake Decision、Rollout 或 Proactive Delivery。
- Delivery Worker 或 Bark Adapter。
- Memory Pipeline 或 Relationship 等级。
- Device Command Channel 或 Android Companion。
- 当前只读 Memory MCP 权限模型。

Sky Bridge 是新的本地 PC Adapter 边界，不复用 Android Device Command，也不把游戏聊天包装成通知或 proactive delivery。

## 9. 游戏行为与协议安全

无论用户、模型、OCR 文本或第三方 Tool 如何请求，以下行为始终拒绝：

- 自动跑图、寻路、传送或跟随路线。
- 自动刷蜡烛、爱心、季蜡或其他资源。
- 自动控制角色、镜头、动作、飞行、跳跃或交互。
- 自动完成每日、季节、活动或好友任务。
- 自动收集光翼、烛火、物品或奖励。
- 自动弹奏、重复动作或挂机。
- 读取或修改游戏内存、进程、存档或网络数据。
- hook、DLL 注入、封包、逆向私有协议或模拟游戏客户端。
- 绕过反作弊、速率限制、聊天限制、平台权限或游戏协议。

Bridge 只使用普通可见窗口内容和受控前台聊天输入。若游戏条款、平台规则或客户端更新不再允许此方式，功能必须关闭，而不是寻找绕过方案。

## 10. 第一阶段范围

### 10.1 目标

第一阶段仅包括：

1. AI 按用户请求读取一次当前光遇可见状态。
2. AI 基于有限观察和已确认 Memory 与用户陪聊。
3. AI 生成一条聊天候选，经用户逐条确认后发送到当前光遇聊天框。

“读取光遇状态”仅指视觉可见、白名单化且带不确定性的观察，不是游戏内部状态 API。

### 10.2 不实现

- 自动操作角色。
- 自动任务。
- 自动收集。
- 自动跑图或刷资源。
- 自动回复或后台轮询。
- 游戏账号、好友或资源同步。
- 完整截图保存、历史 OCR 存档或聊天归档。
- OCR 自动写 Memory/Event/State。
- 外部视觉/OCR/模型服务。
- Android Companion 或 Device Channel 集成。
- 数据库、migration 或新字段。
- 公共 MCP 写能力。

## 11. 错误与失效策略

- 第三方 Server 不可用：Bridge 返回稳定 unavailable，不启用替代桌面控制。
- Tool schema 与锁定版本不匹配：拒绝启动 session。
- 出现未知 Tool：忽略并记录不含详情的安全诊断计数。
- 游戏窗口缺失或失焦：停止观察和发送。
- OCR 非法、过长或低置信：截断或返回 unavailable，不猜测内容。
- Approval 过期或已消费：拒绝发送。
- 输入过程中失焦或超时：结果为 `unknown`，不自动重试。
- 模型失败：只返回陪聊不可用，不调用第三方内置模型。
- 用户停止 session：取消后续读取和未开始的发送；已开始且结果未知的发送不重放。

所有日志遵循现有安全规则，不记录 API/Bearer token、prompt、聊天全文、Memory 内容、provider response 或 stack。

## 12. 实现前测试计划

所有测试使用 fake MCP transport、fake screenshot/OCR adapter、fake model adapter 和 fake keyboard sender；禁止启动真实游戏、调用真实模型或访问真实外部服务。

### 12.1 契约与隔离

1. 只接受锁定版本和精确 Tool schema。
2. 未知 Tool、动态 Tool、任意 URL/path/window 参数均被拒绝。
3. 第三方原始 Tool 不进入 Agent Tool Registry。
4. `sky_observation_get` 保持只读 annotations。
5. `sky_chat_message_send` 不进入公共只读 MCP Server。
6. Adapter 不 import database、Memory Store、State Store、Delivery、Bark 或 Android 模块。

### 12.2 Screenshot / OCR

1. 仅 fake 目标窗口前台时允许一次捕获。
2. 全屏、其他窗口、后台窗口和任意区域请求被拒绝。
3. 原始像素不写文件、Event、Audit、State 或 Memory。
4. OCR 行数、长度、Unicode 和 confidence 边界正确。
5. prompt injection 文本仍作为普通不可信 chat line。
6. 输出仅包含白名单字段，未知 OCR metadata 被丢弃。

### 12.3 Chat 发送

1. 没有 Approval、Approval 过期/已消费或消息变化时零按键调用。
2. session、observation 和 Approval 必须严格绑定。
3. 窗口失焦、输入框未激活时零按键调用。
4. 每次 Approval 最多调用一次 fake sender。
5. 发送开始后超时返回 `unknown` 且不重试。
6. 控制字符、换行、过长内容和 key sequence 输入被拒绝。
7. 无 batch、schedule、repeat、auto-reply 或角色控制路径。

### 12.4 Memory / Agent

1. 只检索 active、用户确认、数量和长度有界的 Memory。
2. Memory 只影响回复候选，不改变 Tool permission。
3. OCR 和聊天结果不创建或修改 Memory、State 或 Relationship。
4. 敏感 Memory 不进入游戏消息候选或第三方 Server。
5. 模型输出未经 Approval 不调用 fake sender。

### 12.5 Event / Audit 与回归

1. 执行事实只经 EventStore/既有 Audit 边界记录最小 metadata。
2. Event、Audit、日志和错误不包含截图、OCR/chat/message 正文、Memory、token、prompt、provider response 或 stack。
3. 不新增数据库或 migration。
4. Memory MCP 保持只读。
5. Wake Decision、Rollout、Delivery Worker、Bark、Memory Pipeline、Device/Android 测试保持不变。
6. 运行完整 `npm test` 和 `git diff --check`。

## 13. READY 前置条件

本设计本身不将 P6-10 标记为 `READY`。进入实现前至少需要明确：

1. 锁定并审计 `sky-pc-mcp-companion` 的来源、版本、许可证和完整 Tool contract。
2. 确认游戏与平台规则允许目标窗口读取及普通聊天输入。
3. 明确第一阶段的产品入口、session 生命周期和停止机制。
4. 明确逐条 Approval UI 和 `unknown` 结果的用户体验。
5. 明确截图/OCR 是否完全本地，以及实现选用的固定引擎。
6. 明确 Tool/Event/Audit 名称、限额和阶段编号。
7. 单独授权新增窄写能力；不得通过当前 MCP 默认只读规则隐式获得。

在这些条件满足前，只保留设计，不实现、不连接真实游戏、不接入真实外部 MCP Server。
