# AI Companion Memory Import / Runtime Design

## 1. 背景与目标

本设计定义 AI Companion 的长期 Memory export/import contract、受控导入流程和 Agent Runtime 检索边界。

目标：

- 将外部或备份中的长期记忆转换为可审查的候选。
- 使用 `fact`、`preference`、`event`、`relationship` 四类稳定语义。
- 导入前检测格式、重复、冲突和明显敏感信息。
- 每一条写入都必须经过用户明确确认。
- 导入只做 merge，不覆盖或改写已有历史事实。
- Agent Runtime 只读取已确认、active 的长期 Memory。
- 不新增数据库、表、字段或 migration。

本设计不授权代码实现、新 API、MCP 写能力或模型自动写 Memory。

## 2. 当前 Memory 系统分析

### 2.1 Structured Memory

当前 `StructuredMemoryStore` 使用既有 `memory_items`，公共字段包括：

- `id`
- `type`
- `title`
- `content`
- `source`
- `sourceSessionId`
- `importance`
- `status`
- `occurredAt`
- `createdAt`
- `updatedAt`
- `deletedAt`

现有类型：

```text
MEMORY
EVENT
MOMENT
PROMISE
WISHLIST
NOTE
```

现有状态：

```text
active
archived
deleted
```

Store 支持 create/update、soft delete/restore、分页、关键词、日期、importance 排序和 content hash 精确去重。Memory 生命周期写操作会通过 `StructuredMemoryStore -> EventStore` 记录最小 `memory.created/updated/deleted/restored` 事实。

### 2.2 当前导出/导入

现有 admin 能力：

- `GET /admin/memory/export`
- `POST /admin/memory/import`
- backup/restore
- legacy `memory.json` 与 structured store 同步

现有 admin import 支持 `merge|replace`，会创建备份并按 legacy dedupe key 处理。该能力是管理/迁移工具，不适合作为 Agent Runtime 导入入口：

- `replace` 可能删除或替换既有集合语义。
- 没有逐条 runtime approval contract。
- legacy 格式没有 `fact/preference/event/relationship` 分类。
- 不应让 Agent 或 MCP 直接调用 admin 写接口。

### 2.3 当前 Seed Preview / Commit

`MemorySeedPreviewRegistry` 和 `MemorySeedCommitter` 已提供更合适的安全基础：

```text
strict document validation
    -> preview decisions
    -> explicit approvedItemIds
    -> StructuredMemoryStore.create
    -> memory.created Event
```

当前 preview 能识别：

- invalid
- sensitive
- duplicate
- ready

当前 commit：

- 只创建用户批准的 item。
- 不提交 preview 中未选择的 item。
- 重复 commit 依赖 content hash 幂等跳过。
- 不直接更新已有 Memory。

该流程应成为 Memory Import Runtime 的基础，但 runtime contract 需要补充语义分类、冲突状态、来源边界和权限模型。

### 2.4 AI Memory Pipeline

当前聊天提取流程为：

```text
Chat Session
    -> AI Job
    -> model candidate
    -> pending Memory Candidate
    -> human approve
    -> Structured Memory
```

模型只能生成候选，不能直接创建正式 Memory。该原则必须扩展到 import：模型可以辅助分类或提出冲突说明，但不能自动批准、覆盖、删除或修改已有 Memory。

### 2.5 HTTP / MCP / Agent 边界

- Memory HTTP 已有认证 CRUD 和管理能力。
- Memory MCP 当前只提供 search/get/list/stats，保持只读。
- `MemoryApiClient` 使用固定路径 allowlist，不能访问 admin import/export。
- Relationship View、Proactive Context 和 Agent 只能消费已存在的白名单 Memory 视图。

Import Runtime 不得借机增加 MCP 写能力或任意 HTTP/file import。

## 3. 长期记忆分类

四类是 Import Runtime 的语义分类，不替换现有数据库 `type`，也不新增字段。

### 3.1 `fact`

定义：相对稳定、可陈述且不依赖一次具体事件的用户事实。

示例：

- 用户长期从事软件开发。
- 用户通常使用中文交流。

边界：

- 不保存凭据、身份号码、精确住址、健康诊断等敏感事实，除非未来有独立高风险确认策略。
- 不把模型推断、心理判断或关系等级当作 fact。
- 外部输入不能宣称覆盖系统已有事实。

默认映射：`MEMORY`。

### 3.2 `preference`

定义：用户明确表达的稳定偏好、交互选择或禁用要求。

示例：

- 用户偏好重要记忆保存前人工确认。
- 用户希望回答保持简洁。

边界：

- preference 不是 Companion State 设置；导入 Memory 不自动修改 `proactive_contact.enabled`、quiet hours 或其他 State。
- 新旧偏好冲突时必须人工处理，不能用新文件自动覆盖旧 Memory。

默认映射：`MEMORY`。导入来源 metadata 保留 runtime category，避免将其误作普通 fact。

### 3.3 `event`

定义：发生在明确或可接受时间范围内的历史事件或时刻。

示例：

- 用户在某日完成了项目里程碑。
- 用户参加过一次明确活动。

边界：

- `occurredAt` 必填。
- 历史事件不可被后续 import 原地改写。
- 同一事件的不同描述如果无法证明完全相同，必须作为 conflict 候选，而不是覆盖。

默认映射：`EVENT`。只有明确为个人时刻且来源已经如此标记时才可映射 `MOMENT`；Runtime 不根据情感推断 MOMENT。

### 3.4 `relationship`

定义：用户明确确认的、关于人与人或用户与 Companion 互动边界的长期语义信息。

示例：

- 用户希望 Companion 在不确定时先询问。
- 用户明确描述某联系人关系，但不包含不必要的身份或联系方式。

边界：

- 不保存模型推断的亲密度、依恋、信任或心理状态。
- 不自动修改 Relationship View 的熟悉度、关系等级或 State。
- 不把聊天频率自动转为 relationship Memory。
- 涉及第三方个人信息时默认标记 `sensitive`，需要逐条强化确认；第一阶段可以直接拒绝高风险内容。

默认映射：`MEMORY`。Relationship View 只把它当作已确认 Memory 来源之一，不获得写权限。

## 4. Runtime 分类与现有类型映射

由于本阶段不新增数据库字段，分类通过 import/export adapter 表达。

### 4.1 导入映射

| Runtime category | Structured type | 规则 |
| --- | --- | --- |
| `fact` | `MEMORY` | 稳定事实 |
| `preference` | `MEMORY` | 不投影 State |
| `event` | `EVENT` | occurredAt 必填 |
| `relationship` | `MEMORY` | 不修改关系等级 |

导入 Memory 的 `source` 使用受限标记：

```text
memory-import:v1:<category>:<source-id>
```

约束：

- 总长度不超过现有 source 上限 200。
- source-id 只允许安全 slug，不含 URL、文件路径、token 或用户正文。
- category 可从该前缀无损恢复。

### 4.2 现有 Memory 导出分类

对不是由 Runtime 导入、没有 category source marker 的现有 Memory，使用显式 legacy mapping：

| Existing type | Export category |
| --- | --- |
| `EVENT`, `MOMENT` | `event` |
| `WISHLIST` | `preference` |
| `PROMISE` | `relationship` |
| `MEMORY`, `NOTE` | `fact` |

导出 item 必须携带：

```text
categorySource: explicit | legacy_mapping
```

`legacy_mapping` 只是兼容映射，不宣称系统已经理解其真实语义。Import preview 对 legacy-mapped relationship/preference 不能因此自动批准。

## 5. Memory Export 格式

### 5.1 顶层 contract

格式标识：

```text
ai-companion-memory-export/v1
```

示例：

```json
{
  "format": "ai-companion-memory-export/v1",
  "exportId": "opaque-export-id",
  "exportedAt": "2026-07-23T12:00:00.000Z",
  "source": {
    "runtime": "dylan-heartbeat",
    "instanceId": "opaque-instance-id"
  },
  "count": 1,
  "items": [
    {
      "externalId": "opaque-memory-id",
      "category": "preference",
      "categorySource": "explicit",
      "title": "记忆确认偏好",
      "content": "用户希望重要记忆保存前经过确认。",
      "importance": 5,
      "occurredAt": null,
      "source": "memory-import:v1:preference:personal-backup",
      "status": "active",
      "createdAt": "2026-07-20T10:00:00.000Z",
      "updatedAt": "2026-07-20T10:00:00.000Z",
      "contentHash": "sha256-normalized-content"
    }
  ]
}
```

### 5.2 导出字段边界

允许导出：

- opaque Memory ID。
- category/categorySource。
- title/content。
- importance。
- occurredAt。
- safe source marker。
- active/archived status。
- createdAt/updatedAt。
- normalized content hash。

默认不导出：

- deleted Memory。
- comments。
- sourceSessionId。
- Event payload。
- chat/session content。
- AI candidate confidence/reason、model、provider 或 job metadata。
- prompt、token、Memory extraction response。
- API/Bearer token、URL、文件路径或 stack。

导出包含长期 Memory 正文，属于敏感用户数据操作。必须由管理员/用户明确触发，使用现有强认证边界，响应 `no-store`，不得写入日志或自动上传。

## 6. Memory Import 格式

### 6.1 顶层 contract

格式标识：

```text
ai-companion-memory-import/v1
```

```json
{
  "format": "ai-companion-memory-import/v1",
  "importId": "user-supplied-safe-id",
  "mode": "merge",
  "source": {
    "kind": "user_export",
    "sourceId": "personal-backup"
  },
  "items": [
    {
      "externalId": "source-memory-1",
      "category": "fact",
      "title": "长期项目",
      "content": "用户正在持续开发 AI Companion Runtime。",
      "importance": 4,
      "occurredAt": null
    }
  ]
}
```

### 6.2 严格 schema

顶层只允许：

- `format`
- `importId`
- `mode`
- `source`
- `items`

第一阶段 `mode` 只能是：

```text
merge
```

禁止 `replace`、`overwrite`、`sync`、`delete_missing`。

每个 item 只允许：

- `externalId`
- `category`
- `title`
- `content`
- `importance`
- `occurredAt`

限制复用现有 Memory 上限：

- title：1～200。
- content：1～20000。
- importance：1～5。
- category：四个白名单值。
- event occurredAt 必填且必须是合法 UTC/带时区时间。
- 其他 category 的 occurredAt 可空。
- externalId/importId/sourceId 必须是长度受限的安全 opaque/slug，不允许 URL 或路径。
- additional properties 一律拒绝。

导入文件中的 `reviewed:true`、`approved:true`、`trusted:true` 等字段一律拒绝。文件自身不能代表本系统用户确认。

## 7. 导入流程

固定为两阶段：

```text
Upload / local document selection
    -> size and JSON parse boundary
    -> strict schema validation
    -> normalize without mutating input
    -> sensitive classification
    -> exact duplicate detection
    -> semantic conflict detection
    -> preview
    -> explicit per-item selection
    -> confirmation summary
    -> commit selected ready items only
    -> StructuredMemoryStore.create
    -> memory.created EventStore fact
```

### 7.1 Parse 与 normalize

- 限制总 body/file 大小和 item 数量。
- 不允许压缩包、目录、远程 URL 或任意文件读取。
- JSON 解析错误返回稳定 code，不记录原始正文或 stack。
- trim title/content，但 preview 同时展示规范化结果。
- 时间统一为 UTC ISO。
- 计算现有 `hashContent` 兼容的 content hash。
- 输入对象保持不可变。

### 7.2 Preview decision

每条 item 必须得到一个决策：

```text
ready
duplicate
conflict
sensitive
invalid
```

Preview 返回：

- import item ID。
- category、title、content、importance、occurredAt 的规范化值。
- decision。
- 稳定 reason code 和安全用户说明。
- exact duplicate 时的 existing Memory opaque ID。
- conflict 时最多若干 existing Memory opaque ID 和安全摘要。

Preview 不写 Memory、Event、State 或关系等级。

### 7.3 Confirmation

- 用户逐条选择 `ready` item。
- `conflict` 必须进入单独详情并明确选择“作为新 Memory 保留”；不能选择覆盖。
- `sensitive` 第一阶段默认不可 commit；如未来允许，必须独立高风险确认设计。
- `invalid`、`duplicate` 不可 commit。
- 最终确认页显示将创建数量和不会覆盖既有 Memory 的声明。
- approval 绑定 previewId、importId 和每个规范化 item hash。

### 7.4 Commit

- 只接受 preview 中已确认的 item IDs。
- commit 时重新校验 preview、hash 和当前 duplicate/conflict 状态。
- 每条通过 `StructuredMemoryStore.create` 写入，不直接写 `memory_items`。
- 每条创建使用 `source=memory-import:v1:<category>:<source-id>`。
- 每条重要事实通过现有 `memory.created` EventStore 路径。
- 部分失败返回逐条结果；不得因一条失败而覆盖已有 Memory。
- 重复 commit 对已创建内容返回 duplicate/idempotent result，不创建第二条相同 content hash。

第一阶段不执行 bulk replace、update、archive、delete 或 restore。

## 8. 冲突处理

### 8.1 Exact duplicate

使用现有 normalized content hash：

- 相同 hash -> `duplicate`。
- 不创建新 Memory。
- 不更新 title、importance、source 或时间。

### 8.2 Potential semantic conflict

在不新增数据库的前提下，候选召回使用现有 Memory 搜索/type/date，再由确定性规则或可选模型辅助标记。模型结果只能产生 `conflict` 候选，不能产生自动 merge 决策。

潜在冲突包括：

- 相同/高度相似标题但 content 不同。
- 同一 preference 的肯定与否定描述。
- 同一 event 时间窗口内互斥事实。
- relationship 内容涉及同一主体但边界不同。

### 8.3 允许的选择

第一阶段冲突详情只允许：

- 跳过导入项。
- 将导入项作为新的独立 Memory 创建（强化确认）。

禁止：

- 覆盖 existing Memory。
- 自动 update/archive/delete existing Memory。
- 把两段内容由模型合成后直接保存。
- 修改既有 occurredAt 或 source。

如果用户认为旧 Memory 错误，必须退出 import 流程并使用现有明确 Memory 管理能力单独修正；该修正产生正常 `memory.updated` Event。

### 8.4 历史事实

event 一旦存在，import 不修改该记录。补充信息作为新的 event/fact Memory，经用户确认后创建。系统不得重写历史 EventStore 事实，也不得删除旧 `memory.created/updated` Event。

## 9. 敏感信息策略

### 9.1 默认禁止自动保存

以下内容默认 `sensitive`，第一阶段不能 commit：

- password、API/access/Bearer token、cookie、private key、device token。
- 身份证件、银行/支付账号、验证码。
- 精确住址、实时位置、门禁信息。
- 医疗诊断、极敏感健康信息。
- 第三方联系方式或未经确认的第三方隐私。
- 聊天全文、prompt、provider response 或 model reasoning。

敏感扫描必须先用确定性模式。模型可以提高召回，但模型未标记为敏感不能降低确定性阻断结果。

### 9.2 日志

Import Runtime 日志只允许：

- import operation opaque ID。
- item count。
- decision count。
- 稳定 error code。

禁止记录：

- title/content。
- import/export JSON。
- Memory content。
- token、URL、文件路径、provider response 或 stack。

不得复用会序列化原始 Error/请求正文的日志方式。

## 10. 记忆权限和确认机制

### 10.1 权限等级

- Export：用户/管理员明确触发的敏感读取操作。
- Preview：处理用户选择的本地/import document，不产生 Memory 写入。
- Commit：高影响 Memory 写操作，必须逐次明确确认。

### 10.2 Approval 约束

Commit approval 必须绑定：

- importId。
- previewId。
- selected item IDs。
- 每条规范化 item hash。
- source ID。
- 到期时间。

不得：

- 使用文件内 `reviewed/approved` 标记替代确认。
- 将一次 approval 复用于另一个 import/selection。
- 在 preview 后内容变化时继续 commit。
- 无确认覆盖、更新、归档或删除已有 Memory。
- 让模型代表用户批准。

如果复用现有 Memory Seed preview/commit，必须保留 `approvedItemIds` 精确匹配，并补充 preview expiration/单次或幂等 commit 设计。现有进程内 preview 丢失时只能重新 preview，不能从日志恢复内容。

### 10.3 HTTP / MCP

- MCP 继续只读，不增加 `memory_import` 写 Tool。
- Agent 不能直接调用 `/admin/memory/import`。
- 若未来增加 Runtime HTTP write endpoint，必须是窄的 preview/commit API，使用现有 Bearer 认证和额外用户确认，不开放 replace 或任意文件路径。
- Export 不进入 MCP，避免把完整 Memory 集暴露给通用 Tool 调用。

## 11. 检索策略

### 11.1 可检索集合

只检索：

- `status=active`。
- 已正式 commit 的 Structured Memory。
- 未 deleted/archived 的 Memory。

不检索：

- preview item。
- pending/rejected AI candidate。
- import sensitive/invalid/conflict 未确认项。
- deleted/archived 内容。
- backup/export 文件。

### 11.2 查询分类映射

Runtime category filter 转换为现有 type/source 条件：

- event -> EVENT/MOMENT。
- fact/preference/relationship -> MEMORY/NOTE/PROMISE/WISHLIST 与 runtime source marker 的组合。

由于 legacy classification 不是精确字段，第一阶段 category filter 必须标明 best-effort。不得为了提高召回而把未确认分类写回数据库。

### 11.3 排序与预算

候选召回采用确定性信号：

1. exact keyword/title match。
2. category/type match。
3. importance DESC。
4. event 查询按 occurredAt 相关性/新近度。
5. updatedAt/id 作为稳定 tie-breaker。

发送给 Agent/模型前：

- 限制条数和总字符预算。
- 使用公共字段白名单。
- 不包含 sourceSessionId、comments、deletedAt、内部 hash 或数据库字段。
- 不把完整 Memory 库拼入 prompt。
- 记录只允许 Memory opaque IDs 和计数，不记录 content。

### 11.4 语义检索

当前没有向量字段或 embedding store。本阶段不新增数据库，因此不设计持久化向量索引。

可选模型只允许对已经由确定性搜索召回的少量 active Memory 重排；不得：

- 扫描全部 Memory 并上传外部服务。
- 自动创建或修改 Memory。
- 将模型推断作为历史事实。
- 保存 provider response 或 reasoning。

## 12. 与 Agent Runtime 集成边界

### 12.1 Agent 可做

- 使用现有只读 Memory search/get/list/stats。
- 请求受限分类/关键词检索。
- 将用户提供的 import document送入 preview 边界。
- 向用户展示 preview decision 和冲突说明。
- 在用户明确确认后，把精确 selection 交给受控 commit service。

### 12.2 Agent 不可做

- 直接调用 StructuredMemoryStore.create/update/delete。
- 直接写数据库或 Event 表。
- 自动批准 preview。
- 自动保存敏感信息。
- 自动覆盖、archive、delete 既有 Memory。
- 修改历史 Event 或伪造 source/occurredAt。
- 根据模型输出修改 State、Relationship level 或人格。
- 将 Memory 正文写日志、Audit Event 或 Tool result trace。

### 12.3 Runtime 组件边界

推荐未来组件：

```text
MemoryImportContract
    -> MemoryImportPreviewService
    -> MemoryConflictDetector
    -> MemoryImportApproval
    -> MemoryImportCommitService
    -> StructuredMemoryStore
    -> EventStore

MemoryRuntimeRetriever
    -> StructuredMemoryStore read API
    -> bounded public Memory context
    -> Agent Runtime
```

Import 组件不依赖模型才能正确运行。模型适配器必须是可选的 fake-able classifier/reranker，失败时回退到更保守的 conflict/sensitive 决策，而不是自动 ready。

## 13. Export / Import 数据持久化边界

- 不新增数据库、表、字段、索引或 migration。
- Preview 保存在短期进程内 registry，具有 TTL，重启后失效。
- 不把原始 import document 保存到数据库、Event、Memory comment 或日志。
- 正式 commit 后只保存现有 Memory 字段。
- Export 结果按请求生成，不在服务器长期保存。
- Backup 仍是现有管理能力，不自动成为 Agent 可访问资源。
- Import source marker 不包含本地文件名、路径或 URL。

## 14. Event / Audit 行为

- 每条正式创建继续通过 StructuredMemoryStore 产生 `memory.created` Event。
- Event payload 只包含现有最小 type/importance/source，不包含 content/title/import JSON。
- Preview、duplicate、invalid、sensitive、conflict 不创建 Memory Event，因为它们不是已接受业务事实。
- 不直接写 events 表。
- Import operation audit 如未来需要，只保存 operation ID、counts 和稳定状态；不得保存 item content。
- 不修改或删除历史 Memory Event。

## 15. 错误处理

稳定错误类别：

- `MEMORY_IMPORT_FORMAT_INVALID`
- `MEMORY_IMPORT_TOO_LARGE`
- `MEMORY_IMPORT_ITEM_INVALID`
- `MEMORY_IMPORT_SENSITIVE`
- `MEMORY_IMPORT_DUPLICATE`
- `MEMORY_IMPORT_CONFLICT`
- `MEMORY_IMPORT_PREVIEW_EXPIRED`
- `MEMORY_IMPORT_APPROVAL_REQUIRED`
- `MEMORY_IMPORT_SELECTION_MISMATCH`
- `MEMORY_IMPORT_COMMIT_FAILED`

错误响应不得包含：

- 原始 import item/content。
- existing Memory content。
- token、文件路径、SQL、provider response 或 stack。

部分 commit 结果只返回 import item opaque ID、status、created Memory opaque ID 或稳定 reason code。

## 16. 测试计划

所有测试使用临时现有数据库、fake model adapter 和内存 preview registry；禁止真实模型、外部服务或真实用户 Memory 文件。

### 16.1 Contract

1. 合法 v1 import/export round-trip 保持 category、内容和时间。
2. additional properties 被拒绝。
3. 只允许 merge。
4. 四类 category 白名单。
5. event 缺少 occurredAt 被拒绝。
6. title/content/importance/item count/body size 边界。
7. 输入不可变。
8. 文件内 reviewed/approved/trusted 字段被拒绝。

### 16.2 Preview

1. ready、duplicate、conflict、sensitive、invalid 全部可复现。
2. Preview 不改变 memory_items、Event、State 或 Relationship。
3. 明显凭据和第三方敏感信息被阻断。
4. 模型不可用时保守决策，不自动 ready。
5. preview TTL 到期后不能 commit。
6. preview 输出不包含内部数据库字段。

### 16.3 Confirmation / Commit

1. 无 confirmation 不创建 Memory。
2. 只创建 selected ready items。
3. conflict 需要强化确认且只能创建新 Memory。
4. sensitive/invalid/duplicate 不能 commit。
5. selection/hash/source/importId 不匹配拒绝。
6. 重复 commit 不创建 duplicate。
7. commit 期间新出现 duplicate/conflict 时重新阻断。
8. 不调用 update/archive/delete/replace。
9. 每条创建通过 StructuredMemoryStore 和 EventStore。

### 16.4 历史与冲突

1. event conflict 不修改 existing content/occurredAt/source。
2. preference conflict 不修改旧偏好。
3. relationship import 不修改关系等级或 State。
4. 用户跳过 conflict 时数据库完全不变。
5. import 失败不修改历史 Event。

### 16.5 Retrieval

1. 只返回 active confirmed Memory。
2. pending preview/candidate、archived/deleted 不进入 Agent context。
3. category mapping 和 legacy_mapping 标记稳定。
4. importance/keyword/date 排序确定且有 tie-breaker。
5. 条数和字符预算生效。
6. Agent context 不含内部字段或完整 Memory 库。

### 16.6 Security / regression

1. 日志、Event、error 和 Audit 不含 title/content/token/path/stack。
2. MCP 工具列表仍全部只读，不增加 import/export Tool。
3. MemoryApiClient 不开放 admin/import path。
4. 不访问真实模型或外部服务。
5. 现有 Memory CRUD、seed preview/commit、AI candidate review 和 Relationship View 测试通过。
6. `npm test` 通过。
7. `git diff --check` 通过。

## 17. 实现前结论

Memory Import / Runtime 可以复用现有 StructuredMemoryStore、content hash、Memory Event 和 seed preview/commit 流程，在不新增数据库的前提下实现受控 merge 导入和有界检索。

关键安全结论：

- Import 文件不具备自我批准能力。
- 模型只生成分类/冲突候选，不能保存 Memory。
- 敏感信息默认阻断。
- 同内容 duplicate 跳过。
- 冲突只能跳过或经强化确认创建新 Memory。
- 不覆盖已有 Memory，不修改历史事实。
- MCP 保持只读，Agent 不直接获得 Memory 写权限。

进入实现前仍需明确阶段编号、preview TTL、import body/item 上限、强化确认交互和是否新增窄 HTTP preview/commit endpoint。本文不修改 roadmap，也不构成实现授权。
