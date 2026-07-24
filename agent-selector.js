"use strict";

const MAX_TASK_LENGTH = 1000;
const AGENT_RULES = Object.freeze([
  Object.freeze({
    agentId: "chen",
    requiredCapabilities: Object.freeze(["discussion", "memory_context"]),
    keywords: Object.freeze([
      "relationship",
      "companion",
      "creative",
      "story",
      "memory",
      "关系",
      "陪伴",
      "创意",
      "故事",
      "记忆"
    ])
  }),
  Object.freeze({
    agentId: "chatgpt",
    requiredCapabilities: Object.freeze(["discussion", "independent_context"]),
    keywords: Object.freeze([
      "analysis",
      "planning",
      "architecture",
      "engineering",
      "分析",
      "规划",
      "架构",
      "工程"
    ])
  })
]);

class AgentSelectorError extends Error {
  constructor(message, code = "AGENT_SELECTOR_INVALID") {
    super(message);
    this.name = "AgentSelectorError";
    this.code = code;
  }
}

function normalizeTask(input) {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    throw new AgentSelectorError("Selector 输入必须是 object");
  }
  const unknown = Object.keys(input).find(field => field !== "task");
  if (unknown) throw new AgentSelectorError(`不允许 Selector 字段：${unknown}`);
  if (
    typeof input.task !== "string" ||
    !input.task.trim() ||
    input.task.trim().length > MAX_TASK_LENGTH
  ) {
    throw new AgentSelectorError("task 格式无效");
  }
  return input.task.trim().toLocaleLowerCase();
}

function supports(profile, capabilities) {
  return Boolean(profile) &&
    Array.isArray(profile.capabilities) &&
    capabilities.every(capability => profile.capabilities.includes(capability));
}

class AgentSelector {
  #profileRegistry;

  constructor({ profileRegistry } = {}) {
    if (
      !profileRegistry ||
      typeof profileRegistry.get !== "function" ||
      typeof profileRegistry.list !== "function"
    ) {
      throw new TypeError("AgentProfileRegistry 必填");
    }
    this.#profileRegistry = profileRegistry;
  }

  select(input) {
    const task = normalizeTask(input);
    const selected = [];

    for (const rule of AGENT_RULES) {
      const profile = this.#profileRegistry.get(rule.agentId);
      if (!supports(profile, rule.requiredCapabilities)) continue;
      const matches = rule.keywords.filter(keyword => task.includes(keyword));
      if (matches.length) {
        selected.push({
          agentId: rule.agentId,
          reason: `${profile.name} 的 ${rule.requiredCapabilities.join("、")} 能力匹配关键词：${matches.join("、")}`
        });
      }
    }

    if (!selected.length) {
      for (const rule of AGENT_RULES) {
        const profile = this.#profileRegistry.get(rule.agentId);
        if (supports(profile, ["discussion"])) {
          selected.push({
            agentId: rule.agentId,
            reason: `${profile.name} 具备 discussion 能力，作为未知任务的默认圆桌参与者`
          });
        }
      }
    }

    return Object.freeze({
      agents: Object.freeze(selected.map(item => item.agentId)),
      reasons: Object.freeze(selected.map(item => item.reason))
    });
  }
}

module.exports = {
  AGENT_RULES,
  AgentSelector,
  AgentSelectorError,
  MAX_TASK_LENGTH,
  normalizeTask,
  supports
};
