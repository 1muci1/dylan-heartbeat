"use strict";

const crypto = require("node:crypto");
const { MEMORY_IMPORT_CATEGORIES } = require("./memory-import-contract");

const MAX_USER_MESSAGE_LENGTH = 4000;
const MAX_ASSISTANT_REPLY_LENGTH = 4000;
const MAX_RECENT_CONTEXT_ITEMS = 6;
const MAX_CONTEXT_ITEM_LENGTH = 1000;
const MAX_PROPOSAL_CONTENT_LENGTH = 2000;
const MAX_PROPOSAL_TITLE_LENGTH = 200;

const GREETING_PATTERN = /^(?:你?好|嗨|哈喽|hello|hi|早上好|早安|晚安|在吗|谢谢|好的|嗯+|哦+|哈哈+)[！!。.？?\s]*$/iu;
const TEMPORARY_STATE_PATTERN = /(?:现在|今天|刚才|此刻|目前).{0,20}(?:累|困|饿|忙|无聊|难过|开心|低落|头疼|不舒服|在路上|没空)/u;
const SENSITIVE_PATTERN = /(?:\bapi[\s_-]*key\b|\b(?:access|bearer|device)?[\s_-]*token\b|\bpassword\b|\bpasswd\b|\bcookie\b|\bprivate[\s_-]*key\b|\botp\b|\bverification[\s_-]*code\b|API\s*密钥|访问令牌|密码|私钥|验证码|身份证|银行卡|银行账号|精确(?:地址|住址)|(?:家庭|居住|收货)?地址是|医疗|诊断|病历|政治|党派|党员|宗教|信仰|基督教|佛教|穆斯林|性取向|同性恋|异性恋|双性恋|system\s*prompt|系统提示词|系统\s*prompt)/iu;
const THIRD_PARTY_PRIVATE_PATTERN = /(?:朋友|同事|同学|家人|闺蜜|伴侣|他|她).{0,30}(?:手机号|电话|地址|住址|身份证|银行卡|疾病|诊断|密码|token|秘密)/iu;

const RELATIONSHIP_PATTERN = /(?:请|以后|一直)?(?:叫|称呼)我|不要叫我|你可以叫我|我们约定|我们的交流规则|和我交流时/iu;
const PREFERENCE_PATTERN = /(?:我|本人).{0,12}(?:一直|长期|通常|更|比较|最)?(?:喜欢|偏好|不喜欢|讨厌|希望|习惯)|以后.{0,30}(?:请|不要|别|希望)/iu;
const EVENT_PATTERN = /(?:我|我们).{0,30}(?:已经|刚刚|终于|成功|正式)?(?:完成|通过|毕业|入学|搬家|上线|发布|恢复|迁移|获奖|赢得).{0,40}(?:项目|毕业|学业|考试|比赛|作品|系统|环境|里程碑|阶段|任务)?/iu;
const FACT_PATTERN = /(?:我是|我的专业是|我的工作是|我长期从事|我正在长期学习|我会|我擅长|我主要使用|我长期关注)/u;

const CATEGORY_RULES = Object.freeze([
  Object.freeze({ category: "relationship", pattern: RELATIONSHIP_PATTERN, title: "互动称呼或规则", importance: 4 }),
  Object.freeze({ category: "preference", pattern: PREFERENCE_PATTERN, title: "长期偏好", importance: 3 }),
  Object.freeze({ category: "event", pattern: EVENT_PATTERN, title: "重要事件", importance: 4 }),
  Object.freeze({ category: "fact", pattern: FACT_PATTERN, title: "长期事实", importance: 3 })
]);

class AgentMemoryFormationError extends Error {
  constructor(message, code = "AGENT_MEMORY_FORMATION_INPUT_INVALID") {
    super(message);
    this.name = "AgentMemoryFormationError";
    this.code = code;
  }
}

function boundedRequiredText(value, field, maxLength) {
  if (typeof value !== "string") {
    throw new AgentMemoryFormationError(`${field} 必须是字符串`);
  }
  const normalized = value.trim().replace(/\s+/g, " ");
  if (!normalized || normalized.length > maxLength) {
    throw new AgentMemoryFormationError(`${field} 长度无效`);
  }
  return normalized;
}

function normalizeOptionalText(value, field, maxLength) {
  if (value == null || value === "") return "";
  if (typeof value !== "string") {
    throw new AgentMemoryFormationError(`${field} 必须是字符串`);
  }
  const normalized = value.trim().replace(/\s+/g, " ");
  if (normalized.length > maxLength) {
    throw new AgentMemoryFormationError(`${field} 长度无效`);
  }
  return normalized;
}

function normalizeRecentContext(value) {
  if (value == null) return [];
  if (!Array.isArray(value) || value.length > MAX_RECENT_CONTEXT_ITEMS) {
    throw new AgentMemoryFormationError("recentContext 格式无效");
  }
  return value.map((item, index) => {
    if (!item || typeof item !== "object" || Array.isArray(item)) {
      throw new AgentMemoryFormationError(`recentContext[${index}] 格式无效`);
    }
    if (!new Set(["user", "assistant"]).has(item.role)) {
      throw new AgentMemoryFormationError(`recentContext[${index}].role 无效`);
    }
    return Object.freeze({
      role: item.role,
      content: boundedRequiredText(item.content, `recentContext[${index}].content`, MAX_CONTEXT_ITEM_LENGTH)
    });
  });
}

function comparable(value) {
  return String(value || "").trim().replace(/\s+/g, " ").toLocaleLowerCase();
}

function normalizedContentHash(value) {
  return crypto.createHash("sha256").update(comparable(value)).digest("hex");
}

function proposalContent(userMessage) {
  return `用户明确表示：${userMessage}`.slice(0, MAX_PROPOSAL_CONTENT_LENGTH);
}

function falseResult() {
  return { shouldRemember: false, proposal: null };
}

function normalizeReadResult(result) {
  if (Array.isArray(result)) return { items: result, complete: true };
  if (!result || typeof result !== "object" || !Array.isArray(result.items)) {
    throw new AgentMemoryFormationError("Memory Reader 返回无效", "AGENT_MEMORY_READER_INVALID");
  }
  const truncated = result.complete === false || result.meta?.truncated === true;
  return { items: result.items, complete: !truncated };
}

class AgentMemoryFormation {
  #memoryReader;

  constructor({ memoryReader } = {}) {
    if (!memoryReader || (
      typeof memoryReader.readAll !== "function" &&
      typeof memoryReader.retrieve !== "function"
    )) {
      throw new TypeError("只读 memoryReader 必填");
    }
    this.#memoryReader = memoryReader;
  }

  form({ userMessage, assistantReply, recentContext } = {}) {
    const user = boundedRequiredText(userMessage, "userMessage", MAX_USER_MESSAGE_LENGTH);
    normalizeOptionalText(assistantReply, "assistantReply", MAX_ASSISTANT_REPLY_LENGTH);
    normalizeRecentContext(recentContext);

    if (
      GREETING_PATTERN.test(user) ||
      TEMPORARY_STATE_PATTERN.test(user) ||
      SENSITIVE_PATTERN.test(user) ||
      THIRD_PARTY_PRIVATE_PATTERN.test(user)
    ) {
      return falseResult();
    }

    const rule = CATEGORY_RULES.find(value => value.pattern.test(user));
    if (!rule || !MEMORY_IMPORT_CATEGORIES.includes(rule.category)) return falseResult();

    const proposal = {
      proposalId: crypto.randomUUID(),
      category: rule.category,
      title: rule.title.slice(0, MAX_PROPOSAL_TITLE_LENGTH),
      content: proposalContent(user),
      importance: rule.importance
    };

    let readResult;
    try {
      readResult = typeof this.#memoryReader.readAll === "function"
        ? this.#memoryReader.readAll({ category: proposal.category })
        : this.#memoryReader.retrieve({
          category: proposal.category,
          limit: 20,
          characterBudget: 20000
        });
      readResult = normalizeReadResult(readResult);
    } catch {
      return falseResult();
    }
    if (!readResult.complete) return falseResult();

    const proposalHash = normalizedContentHash(proposal.content);
    const duplicate = readResult.items.some(memory =>
      normalizedContentHash(memory?.content) === proposalHash ||
      (
        comparable(memory?.title) === comparable(proposal.title) &&
        comparable(memory?.content) === comparable(proposal.content)
      )
    );
    return duplicate ? falseResult() : { shouldRemember: true, proposal };
  }
}

module.exports = {
  AgentMemoryFormation,
  AgentMemoryFormationError,
  CATEGORY_RULES,
  normalizedContentHash
};
