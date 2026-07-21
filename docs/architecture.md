# AI Companion Runtime Architecture

## 系统定位

本项目是私人 AI Companion Runtime。系统将长期语义、业务事实、规则化状态和运行时决策分层保存，避免模型输出直接改变系统状态。

核心边界：

- 重要业务事实统一通过 `EventStore` 写入。
- Memory 只保存长期语义记忆，不承担系统日志职责。
- State 只保存可验证、规则化的当前状态，不保存心理判断。
- 模型输出必须经过适配、校验和 Gate，不能直接发送或修改状态。
- HTTP 与 MCP 默认只读；写能力必须明确授权并采用白名单输入。

## Event System

主要模块：

- `event-definitions.js`：定义 Event 类型、category 和允许的 source。
- `event-store.js`：校验并持久化 Event，处理去重、时间、来源权限和 payload 大小限制。
- `event-routes.js`：提供经过认证、字段过滤后的 Event 查询接口。

Event 是重要业务事实的统一入口。聊天完成、Memory 生命周期、AI Job、Delivery 状态、用户偏好和主动反馈均通过 `EventStore` 记录。业务模块不得直接写 `events` 表，Event payload 不保存完整聊天、prompt、provider response 或敏感凭据。

数据流：

```text
业务动作 -> EventStore.create -> events 表 -> StateProjector / 只读查询 / 聚合视图
```

## State Projection

主要模块：

- `state-store.js`：读写 `companion_state`，维护 scope、来源、有效时间和版本。
- `state-projector.js`：将白名单 Event 投影为规则化 State。
- `state-routes.js`：提供 `companion/default` 范围的只读公共 State。

State Projection 只处理明确规则。例如聊天完成时间、AI Job 完成时间、近期 Memory 创建事实，以及 `disable_future` 反馈对应的 `proactive_contact.enabled=false`。其他反馈只保留 Event，不推断情绪、人格或关系等级。

数据流：

```text
EventStore -> StateProjector -> StateStore -> companion_state
用户设置 ---------------------> StateStore（source=user）
```

## Memory Pipeline

主要模块：

- `structured-memory-store.js`：长期 Memory 的结构化存储与生命周期管理。
- `ai-memory-store.js`：AI Job、摘要和候选 Memory 的持久化协调。
- `conversation-summary-service.js`：通过模型适配器生成摘要或候选结果。
- `memory-routes.js`、`memory-admin.js`、`memory-seed-*`：查询、明确管理和受控导入。

聊天内容不会自动成为长期 Memory。模型只生成候选或结构化结果，最终状态变化必须经过既有受控流程。系统日志、Delivery、反馈和运行指标不写入 Memory。

数据流：

```text
Chat Session -> AI Job -> fake/real adapter boundary -> Summary/Candidate
                                              -> 明确审批或受控流程 -> Structured Memory
```

## Relationship View

主要模块：

- `relationship-view.js`：从 Memory、Event 和 State 聚合只读关系上下文。
- `relationship-routes.js`：提供认证后的只读 Relationship View。

Relationship View 计算互动风格、主动联系配置来源、熟悉度展示、近期主题和重要 Memory 引用。它是派生视图，不写 State、不修改 Memory，也不自动升降用户关系等级。

## Wake Decision

主要模块：

- `wake-decision-evaluator.js`：计算候选决策。
- `wake-decision-gate.js`：执行最终模式和安全边界。
- `wake-decision-shadow.js`：影子评估。
- `wake-decision-rollout.js`：稳定分流。
- `wake-decision-metrics.js`、`wake-decision-rollout-metrics.js`：内存指标。
- `wake-decision-dashboard-view.js`、`wake-decision-routes.js`：只读 Dashboard 数据。

Wake Decision 与 Rollout 保持独立。影子模式不会改变旧流程，enforced 模式仍需经过 Gate；Dashboard 只读取快照和指标，不参与决策。

## Proactive Delivery

主要模块：

- `proactive-candidate-generator.js`、`proactive-decision-service.js`：生成和评估主动互动候选。
- `proactive-context-builder.js`、`proactive-response-adapter.js`：构建受限上下文并校验模型响应。
- `proactive-send-gate.js`：在发送前检查开关、静默时段、预算、冷却和重复主题等约束。
- `delivery-store.js`：保存 Delivery 及其状态转换、锁和 Retry 元数据。
- `proactive-delivery-worker.js`：领取 Delivery，通过 Push Adapter 发送并记录 Delivery Event。
- `delivery-retry-policy.js`：计算受限重试计划。
- `bark-push-adapter.js`：封装 Bark 网络边界。
- `proactive-contact-settings.js`：只允许用户修改主动联系开关和静默时段。
- `proactive-delivery-routes.js`：提供 Delivery 查询、设置、Overview 和明确授权的反馈入口。
- `proactive-view.js`：聚合只读 Companion Center 主动互动数据。

数据流：

```text
Event/State/Relationship
        -> Candidate -> Decision -> Context -> Response Adapter
        -> Proactive Send Gate -> DeliveryStore(pending)
        -> Delivery Worker -> Bark Adapter
        -> sent/failed/retry Event -> EventStore
```

Delivery 查询使用严格字段白名单，不返回消息正文、provider、token、URL、错误栈、锁信息或内部字段。Retry 由 Worker 和 Retry Policy 管理，不提供人工绕过策略的 Retry API。

## Feedback Loop

主要模块：

- `proactive-feedback-store.js`：记录每个 Delivery 唯一且不可覆盖的用户反馈。
- `state-projector.js`：仅将 `disable_future` 规则化投影为关闭主动联系。
- `proactive-view.js`：只返回反馈类型统计，不暴露用户行为细节。

支持 `liked`、`dismissed`、`not_relevant` 和 `disable_future`。反馈记录与 `proactive.feedback_received` Event 在同一事务内完成；重复的相同反馈幂等返回，不同反馈不允许覆盖。

反馈不会自动修改 Behavior Policy、Memory、AI 人格或关系等级，也不会自动触发模型或发送。

## MCP 只读层

主要模块：

- `memory-api-client.js`：通过 Bearer 认证访问受限 HTTP 查询路径。
- `memory-mcp-server.js`：注册 Memory、State、Relationship 和 Proactive Overview 工具。

当前 MCP 工具全部为只读，统一声明：

```text
readOnlyHint: true
destructiveHint: false
idempotentHint: true
openWorldHint: false
```

MCP 不提供 proactive send、Delivery retry/cancel、Memory 写入或 State 写入能力。输出在工具层再次按白名单整理。

## 聚合数据流

```text
Memory ---------------------> Relationship View ------+
EventStore -> StateProjector -> Companion State ------+-> Proactive View -> HTTP / MCP
DeliveryStore ----------------------------------------+
FeedbackStore ----------------------------------------+

Wake Decision -> Proactive Send Gate -> Delivery Worker -> Bark
                         ^                    |
                         +-- State/Policy ----+-> Delivery Events -> EventStore
```
