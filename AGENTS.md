# AI Companion Runtime Development Rules

## 架构原则

这是一个私人 AI Companion Runtime 项目。

所有重要业务事实必须经过 EventStore。

禁止：
- 业务模块直接写 events 表
- 自动修改 Memory
- 自动修改用户关系等级
- 模型输出直接改变系统状态


## 数据边界

Memory:
- 保存长期语义记忆
- 不保存系统日志

Event:
- 保存系统事实
- 不保存完整聊天内容

State:
- 保存规则化状态
- 不保存心理判断


## 安全要求

禁止日志记录：

- API token
- Bearer token
- prompt
- chat全文
- Memory content
- provider response
- stack


## API原则

默认：

- HTTP只读
- MCP只读

新增写接口必须明确说明。


## 测试要求

每次修改必须：

- npm test

测试禁止：

- 调用真实模型
- 调用真实Bark
- 访问真实外部服务

使用：

- fake adapter


## Migration要求

数据库修改必须：

测试：

1. 新数据库初始化
2. 旧版本升级
3. 重复migration幂等


## 修改边界

未经明确要求，不修改：

- Wake Decision
- Rollout
- Delivery Worker
- Bark Adapter
- Memory Pipeline
- MCP权限模型


修改前先分析现有代码路径。

优先：
- 小模块新增
- 明确边界
- 保持旧流程兼容
