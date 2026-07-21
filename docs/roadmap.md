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

## 下一阶段

### P6-9.13 Proactive Explanation Layer

状态：READY

目标：增加主动行为解释查询能力，让 Companion Center 能基于现有 Delivery、Event、State、Relationship 和决策事实说明一次主动行为为何发生、被阻止、失败或处于当前状态。

预期边界：

- 只读查询，不增加发送、Retry、Cancel 或设置写能力。
- 使用现有结构化事实，不调用模型生成解释。
- 不修改 Delivery、Memory、State、Wake Decision、Rollout 或 Behavior Policy。
- 不暴露消息正文、prompt、provider response、token、URL、错误栈、锁或内部字段。
- 不创建新的业务事实，除非后续任务明确要求 Event 类型和写入路径。
- HTTP 与 MCP 能力必须由后续任务明确指定，不自动扩展 MCP 权限模型。

本阶段暂不实现任何代码；具体输入、输出 schema 和查询范围等待 P6-9.13 任务定义。
