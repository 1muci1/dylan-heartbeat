# Current Task

## 已完成

- P6-9.13 Proactive Explanation Layer 第一阶段。
- P6-9.13 Explanation MCP Server 第一阶段。
- P6-9.38 Reminder Draft Integration 第一阶段。
- P6-9.38 Reminder Draft Approval/执行幂等边界设计。
- P6-9.38 Reminder Draft Companion 前台检查体验设计。
- Memory Runtime 第一阶段内部核心模块。

## 当前系统状态

- Tool Runtime 完成。
- Proactive Runtime 完成。
- Device Runtime 完成基础闭环。
- Proactive Explanation 已新增按 Delivery ID 聚合的只读数据读取层。
- 已新增认证 GET API：`/api/v1/proactive/explanations/:deliveryId`。
- Explanation 的 Tool name、input schema、字段白名单和公共输出 mapper 已收敛到 shared contract。
- `proactive_explanation_get` 已注册到现有 MCP Server；HTTP 与 MCP 使用同一公共 mapper，保持 schema 一致。
- Explanation MCP Tool 保持只读：仅使用固定 GET 路径，无 Approval、写能力、任意 URL 或任意 HTTP method。
- Explanation 只返回 Delivery、AI Job、Trigger Event 和 Feedback 的安全字段；Wake Decision 缺少可靠历史关联时返回不可用。
- Explanation 不调用模型，不写 Event、State 或 Memory，不修改 Delivery，也不调用 Device Command Channel。
- Reminder Draft 已接入现有 Approval、Audit 和 Device Command Channel。
- Android Companion 当前仅使用进程内草稿 handler，不调用真实 Reminder API。
- Reminder Draft 幂等设计已确认：当前进程内 Approval/Command 状态不足以支持跨重启、多实例和网络结果不确定场景；任何持久化实现仍未获授权。
- Companion review 设计已明确 `created/rejected/expired` 本地生命周期；本地 repository、重启恢复和 UI 尚未实现。
- Manifest 权限仍只有 INTERNET。
- Node 全量测试已覆盖 Reminder Draft 基础闭环。
- Android Companion 已在 JDK 17 和 Android SDK 35 环境完成 JVM 单元测试与 Debug APK 构建验证。
- Memory Runtime 已实现 `ai-companion-memory-import/v1` Import Contract，支持 `fact`、`preference`、`event`、`relationship` 四类长期记忆。
- Memory Import Preview 已实现严格校验、TTL、item hash 绑定，以及 `ready/duplicate/conflict/sensitive/invalid` 决策；Preview 不写 Memory，也不调用模型。
- Memory Import Commit 已实现只提交用户确认的 `ready` item、commit 前 hash/duplicate/conflict 重检和幂等结果；写入仅通过 `StructuredMemoryStore.create`。
- Agent Memory Retriever 已实现只读 active Memory、分类过滤、字段白名单、数量限制和字符预算。
- Memory Runtime 第一阶段保持为内部核心模块，没有 HTTP API、UI、MCP 写 Tool、migration、数据库字段或外部服务接入。

## 下一阶段

当前没有明确标记为 `READY` 的下一阶段。

候选方向包括：

- Companion Center Explanation 只读 UI。
- 逐 Delivery Wake Decision 可靠关联。
- 模型生成的 Explanation。
- Reminder Draft Companion 前台检查体验实现；设计已完成，仍缺本地存储、TTL、Android schema 和 receipt 事务边界授权。
- Reminder Draft Approval/执行幂等实现；设计已完成，仍缺 migration、新表、Android receipt 和结果确认协议授权。
- Memory UI；尚未明确页面入口、确认交互和敏感内容展示边界。
- Memory API；内部 Import/Preview/Commit 尚未暴露为 HTTP 能力，任何写接口仍需独立设计和授权。
- 自动聊天记忆；聊天不能自动写入长期 Memory，仍须保留候选和用户确认边界。
- Memory MCP 写能力；现有 MCP 继续只读，不注册 Import、Preview 或 Commit 写 Tool。

Explanation MCP Server 第一阶段不包含 UI、Wake Decision 关联或模型解释，也不扩展任何 Reminder 相关能力。

以上候选均未进入实现阶段，也未标记为 `READY`。Memory Runtime 内部核心模块完成不代表 UI、API、自动聊天记忆或 MCP 写能力获得授权；等待明确的阶段编号、目标、范围和安全边界后再继续。
