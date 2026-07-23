# AI Companion Runtime Roadmap

## 路线原则

Roadmap 只记录已经落地的能力和明确指定的下一阶段。每个阶段保持模块边界，不因实现便利自动扩展写权限、模型权限、Memory 范围或外部服务调用。

## 已完成阶段

### P6 Event System

目标：建立统一的业务事实层，以 Event 定义约束类型、category、source 和公共输出。

已完成：

- EventStore 持久化、去重、来源校验和分页查询。
- 核心业务事实通过 EventStore 记录。
- HTTP 查询过滤敏感 payload 字段。

安全边界：业务模块不得直接写 `events` 表；Event 不保存完整聊天、prompt、token、provider response 或错误栈。

### P7 State Projection

目标：从可信 Event 生成当前可查询的规则化 Companion State。

已完成：

- Companion State Store 与公共只读 API。
- 白名单 Event 投影和来源追踪。
- 用户主动联系设置保存为 `source=user` State。

安全边界：State 不保存心理判断；模型输出不能直接修改 State；投影不自动修改 Memory 或关系等级。

### P8 Relationship View

目标：将 Memory、Event 和 State 聚合为稳定的只读关系上下文。

已完成：

- 互动风格、主动联系配置来源、熟悉度展示、近期主题和重要 Memory 引用聚合。
- HTTP 与 MCP 只读查询。

安全边界：Relationship View 是派生视图，不写 Memory、State 或 Event，不自动升降关系等级。

### P8 Wake Decision

目标：为唤醒决策提供评估、Gate、影子模式、Rollout、指标和 Dashboard。

已完成：

- Decision Evaluator 与最终 Gate。
- Shadow 和稳定 Rollout。
- Metrics、Snapshot 和只读 Dashboard。

安全边界：Shadow 不改变旧流程；Rollout 不绕过 Gate；Dashboard 不参与决策或发送。

### P9 Proactive Delivery

目标：建立从候选、受限模型响应、发送 Gate 到可靠交付和只读管理面的主动互动链路。

已完成：

- Candidate、Decision、Context 和 Response Adapter。
- Proactive Send Gate。
- Delivery Store、Worker、Retry Policy 和 Bark Adapter。
- Delivery 只读 API、主动联系设置和 Companion Center Proactive View。
- Delivery 状态 Event 与敏感字段过滤。

安全边界：不提供人工 Retry、Cancel 或直接 Send API；模型响应不能绕过 Gate；Delivery 查询不暴露正文和 provider 信息。

### P6-9.12 Proactive Feedback Loop

目标：记录用户对具体主动消息的明确反馈，并形成最小、安全、可审计的闭环。

已完成：

- migration v13 与 `delivery_feedback`。
- `liked`、`dismissed`、`not_relevant`、`disable_future` 白名单反馈。
- 幂等、不可覆盖的反馈记录。
- `proactive.feedback_received` Event。
- `disable_future` 到 `proactive_contact.enabled=false` 的规则化 State 投影。
- Overview 反馈统计。

安全边界：不保存评论或消息正文；不推断情绪；不修改人格、Behavior Policy、Memory 或关系等级；MCP 保持只读。

### P6-9.13 Proactive Explanation Layer 第一阶段

目标：以 Delivery ID 为锚点，提供安全、结构化、只读的主动行为解释查询。

已完成：

- Proactive Explanation 只读数据读取层。
- Delivery、AI Job、Trigger Event 和 Feedback 的精确关联与字段白名单。
- Delivery 状态到稳定 summary code 的映射。
- 认证只读 GET API：`/api/v1/proactive/explanations/:deliveryId`。
- `proactive_explanation_get` 静态 Tool Registry 定义。
- Explanation shared contract，以及共用公共 mapper 的 HTTP/MCP schema 一致性边界。
- 现有本地 MCP Server 中只读的 `proactive_explanation_get` Tool。
- 缺失关联返回不可用，不反推历史事实。

安全边界：不调用模型；不写 Event、State 或 Memory；不修改 Delivery；不调用 Device Command；不新增 migration 或数据库字段；MCP 只允许固定 GET 路径，不开放 Approval、写能力、任意 URL 或任意 HTTP method。

### P6-9.38 Reminder Draft Integration 第一阶段

目标：通过现有 Agent Tool Runtime 和 Android Device Command Channel，在已配对设备的 Companion 应用内创建待用户检查的 Reminder Draft。

已完成：

- `android.reminder.draft_create` Tool、严格输入 schema 和逐次 Approval。
- Tool Audit、Provider、Device Authorization、Device Command 和协议校验链路。
- Android Companion 进程内 Reminder Draft handler。
- Android/Kotlin JVM 单元测试和 Debug APK 构建验证。

安全边界：仅创建 Companion 应用内草稿；不创建系统 Reminder、Alarm、Calendar 或通知；不新增 Android 权限；不接入真实系统 API；不自动修改 Memory、State 或关系等级。

## 下一阶段

当前没有明确标记为 `READY` 的下一阶段。以下仅为基于现有架构的候选方向，不代表授权、排期或实现目标：

- Companion Center Proactive Explanation 只读 UI。
- 逐 Delivery Wake Decision 历史关联；前提是先明确可信关联来源和持久化边界。
- Reminder Draft 的 Companion 前台检查体验；不包含真实系统 Reminder API。
- Reminder Draft Approval/执行幂等边界的进一步持久化设计；不得隐式修改现有 Approval 生命周期。

所有候选阶段当前状态均为 `NOT_READY`。在阶段编号、目标、输入输出、安全边界和明确授权确定之前，不创建实现任务、不修改代码、不新增 migration，也不扩展 HTTP、MCP、Device 或 Android 权限。
