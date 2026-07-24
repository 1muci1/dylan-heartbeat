"use strict";

const { MEMORY_IMPORT_CATEGORIES } = require("./memory-import-contract");

const APPROVAL_STATUSES = Object.freeze(["approved", "rejected", "needs_review"]);
const PROPOSAL_FIELDS = new Set([
  "proposalId", "category", "title", "content", "importance"
]);
const SAFE_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,99}$/;
const MAX_TITLE_LENGTH = 200;
const MAX_CONTENT_LENGTH = 2000;

const SENSITIVE_PATTERN = /(?:\bapi[\s_-]*key\b|\b(?:access|bearer|device)?[\s_-]*token\b|\bpassword\b|\bpasswd\b|\bcookie\b|\bprivate[\s_-]*key\b|\botp\b|\bverification[\s_-]*code\b|API\s*密钥|访问令牌|密码|私钥|验证码|身份证|银行卡|银行账号|精确(?:地址|住址)|(?:家庭|居住|收货)?地址是|医疗|诊断|病历|政治|党派|党员|宗教|信仰|性取向|system\s*prompt|系统提示词)/iu;
const ASSISTANT_INFERENCE_PATTERN = /(?:assistant|模型|AI|助手).{0,12}(?:推断|推测|认为用户|判断用户)|(?:推测|猜测|可能|大概)(?:用户|对方)/iu;
const TEMPORARY_STATE_PATTERN = /(?:现在|今天|刚才|此刻|目前).{0,24}(?:累|困|饿|忙|无聊|难过|开心|低落|生气|焦虑|头疼|不舒服|在路上|没空)/u;
const EMOTION_JUDGMENT_PATTERN = /(?:用户|对方|他|她).{0,16}(?:依赖|离不开|缺爱|孤独|焦虑|抑郁|脆弱|情绪不稳定|爱上|嫉妒|占有欲)/u;
const USER_NICKNAME_PATTERN = /(?:用户称呼|用户昵称|称呼偏好|请叫我|称呼我|用户希望被称为)/u;
const IDENTITY_PATTERN = /(?:Companion名称|Agent身份|AI身份|assistant.identity|runtime.identity|身份边界|自我身份)/iu;
const LONG_TERM_PROJECT_PATTERN = /(?:长期项目|项目背景|项目方向|毕业设计|毕设|长期维护|正在开发|持续建设|项目里程碑)/u;

class AgentMemoryApprovalError extends Error {
  constructor(message, code = "AGENT_MEMORY_APPROVAL_INPUT_INVALID") {
    super(message);
    this.name = "AgentMemoryApprovalError";
    this.code = code;
  }
}

function requiredText(value, field, maxLength) {
  if (typeof value !== "string") {
    throw new AgentMemoryApprovalError(`${field} 必须是字符串`);
  }
  const normalized = value.trim().replace(/\s+/g, " ");
  if (!normalized || normalized.length > maxLength) {
    throw new AgentMemoryApprovalError(`${field} 长度无效`);
  }
  return normalized;
}

function normalizeProposal(input) {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    throw new AgentMemoryApprovalError("proposal 必须是对象");
  }
  const unknown = Object.keys(input).find(field => !PROPOSAL_FIELDS.has(field));
  if (unknown) {
    throw new AgentMemoryApprovalError(
      `proposal 包含不允许的字段：${unknown}`,
      "AGENT_MEMORY_APPROVAL_FIELD_FORBIDDEN"
    );
  }
  const proposalId = requiredText(input.proposalId, "proposalId", 100);
  if (!SAFE_ID_PATTERN.test(proposalId)) {
    throw new AgentMemoryApprovalError("proposalId 格式无效");
  }
  const category = String(input.category || "");
  if (!MEMORY_IMPORT_CATEGORIES.includes(category)) {
    throw new AgentMemoryApprovalError("category 无效");
  }
  const title = requiredText(input.title, "title", MAX_TITLE_LENGTH);
  const content = requiredText(input.content, "content", MAX_CONTENT_LENGTH);
  const importance = Number(input.importance);
  if (!Number.isInteger(importance) || importance < 1 || importance > 5) {
    throw new AgentMemoryApprovalError("importance 必须是 1 到 5");
  }
  return Object.freeze({ proposalId, category, title, content, importance });
}

function result(status, proposal) {
  return Object.freeze({ status, proposal });
}

class AgentMemoryApproval {
  evaluate(input) {
    const proposal = normalizeProposal(input);
    const searchable = `${proposal.title}\n${proposal.content}`;

    if (
      SENSITIVE_PATTERN.test(searchable) ||
      ASSISTANT_INFERENCE_PATTERN.test(searchable) ||
      TEMPORARY_STATE_PATTERN.test(searchable) ||
      EMOTION_JUDGMENT_PATTERN.test(searchable)
    ) {
      return result("rejected", proposal);
    }

    if (proposal.category === "preference" || proposal.category === "event") {
      return result("approved", proposal);
    }
    if (
      proposal.category === "relationship" &&
      USER_NICKNAME_PATTERN.test(searchable) &&
      !IDENTITY_PATTERN.test(searchable)
    ) {
      return result("approved", proposal);
    }
    if (proposal.category === "relationship" || IDENTITY_PATTERN.test(searchable)) {
      return result("needs_review", proposal);
    }
    if (proposal.category === "fact" && LONG_TERM_PROJECT_PATTERN.test(searchable)) {
      return result("approved", proposal);
    }
    return result("needs_review", proposal);
  }
}

module.exports = {
  APPROVAL_STATUSES,
  AgentMemoryApproval,
  AgentMemoryApprovalError,
  normalizeProposal
};
