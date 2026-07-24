"use strict";

const PROFILE_FIELDS = Object.freeze([
  "id",
  "name",
  "role",
  "description",
  "capabilities",
  "memoryAccess"
]);
const AGENT_ID_PATTERN = /^[a-z][a-z0-9_-]{0,63}$/;
const CAPABILITY_PATTERN = /^[a-z][a-z0-9_.-]{0,63}$/;
const MAX_NAME_LENGTH = 80;
const MAX_ROLE_LENGTH = 120;
const MAX_DESCRIPTION_LENGTH = 500;
const MAX_CAPABILITIES = 20;

const BUILT_IN_AGENT_PROFILES = Object.freeze([
  Object.freeze({
    id: "chen",
    name: "沉",
    role: "AI Companion",
    description: "参与协作讨论，并可使用只读的 Companion Memory Context。",
    capabilities: Object.freeze(["discussion", "memory_context", "summary"]),
    memoryAccess: true
  }),
  Object.freeze({
    id: "chatgpt",
    name: "ChatGPT",
    role: "Independent Collaboration Agent",
    description: "在独立上下文中参与讨论，不读取 Companion Memory。",
    capabilities: Object.freeze(["discussion", "independent_context", "summary"]),
    memoryAccess: false
  })
]);

class AgentProfileRegistryError extends Error {
  constructor(message, code = "AGENT_PROFILE_INVALID") {
    super(message);
    this.name = "AgentProfileRegistryError";
    this.code = code;
  }
}

function cloneProfile(profile) {
  return {
    id: profile.id,
    name: profile.name,
    role: profile.role,
    description: profile.description,
    capabilities: [...profile.capabilities],
    memoryAccess: profile.memoryAccess
  };
}

function normalizedText(value, field, maxLength) {
  if (typeof value !== "string" || !value.trim() || value.trim().length > maxLength) {
    throw new AgentProfileRegistryError(`${field} 格式无效`);
  }
  return value.trim();
}

function validateAgentProfile(input) {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    throw new AgentProfileRegistryError("Agent Profile 必须是 object");
  }
  const unknown = Object.keys(input).find(field => !PROFILE_FIELDS.includes(field));
  if (unknown) throw new AgentProfileRegistryError(`不允许 Agent Profile 字段：${unknown}`);
  const missing = PROFILE_FIELDS.find(field => !Object.hasOwn(input, field));
  if (missing) throw new AgentProfileRegistryError(`Agent Profile 缺少字段：${missing}`);

  const id = typeof input.id === "string" ? input.id.trim() : "";
  if (!AGENT_ID_PATTERN.test(id)) {
    throw new AgentProfileRegistryError("id 格式无效", "AGENT_PROFILE_ID_INVALID");
  }
  if (typeof input.memoryAccess !== "boolean") {
    throw new AgentProfileRegistryError(
      "memoryAccess 必须是 boolean",
      "AGENT_PROFILE_MEMORY_ACCESS_INVALID"
    );
  }
  if (id === "chen" && input.memoryAccess !== true) {
    throw new AgentProfileRegistryError(
      "chen 必须允许只读 Memory Context",
      "AGENT_PROFILE_MEMORY_ACCESS_INVALID"
    );
  }
  if (id === "chatgpt" && input.memoryAccess !== false) {
    throw new AgentProfileRegistryError(
      "chatgpt 不允许读取 Memory Context",
      "AGENT_PROFILE_MEMORY_ACCESS_INVALID"
    );
  }
  if (
    !Array.isArray(input.capabilities) ||
    input.capabilities.length === 0 ||
    input.capabilities.length > MAX_CAPABILITIES
  ) {
    throw new AgentProfileRegistryError("capabilities 格式无效");
  }
  const capabilities = [...new Set(input.capabilities.map(capability => {
    if (typeof capability !== "string" || !CAPABILITY_PATTERN.test(capability.trim())) {
      throw new AgentProfileRegistryError("capability 格式无效");
    }
    return capability.trim();
  }))];
  if (capabilities.length !== input.capabilities.length) {
    throw new AgentProfileRegistryError(
      "capabilities 不允许重复",
      "AGENT_PROFILE_CAPABILITY_DUPLICATE"
    );
  }

  return Object.freeze({
    id,
    name: normalizedText(input.name, "name", MAX_NAME_LENGTH),
    role: normalizedText(input.role, "role", MAX_ROLE_LENGTH),
    description: normalizedText(input.description, "description", MAX_DESCRIPTION_LENGTH),
    capabilities: Object.freeze(capabilities),
    memoryAccess: input.memoryAccess
  });
}

class AgentProfileRegistry {
  #profiles = new Map();

  constructor({ profiles = BUILT_IN_AGENT_PROFILES } = {}) {
    if (!Array.isArray(profiles)) throw new TypeError("profiles 必须是 array");
    for (const profile of profiles) this.register(profile);
  }

  validate(profile) {
    return cloneProfile(validateAgentProfile(profile));
  }

  register(profile) {
    const validated = validateAgentProfile(profile);
    if (this.#profiles.has(validated.id)) {
      throw new AgentProfileRegistryError(
        "Agent Profile 已注册",
        "AGENT_PROFILE_ALREADY_REGISTERED"
      );
    }
    this.#profiles.set(validated.id, validated);
    return cloneProfile(validated);
  }

  get(agentId) {
    if (typeof agentId !== "string" || !AGENT_ID_PATTERN.test(agentId.trim())) {
      throw new AgentProfileRegistryError(
        "Agent id 格式无效",
        "AGENT_PROFILE_ID_INVALID"
      );
    }
    const profile = this.#profiles.get(agentId.trim());
    return profile ? cloneProfile(profile) : null;
  }

  list() {
    return [...this.#profiles.values()].map(cloneProfile);
  }
}

module.exports = {
  AGENT_ID_PATTERN,
  AgentProfileRegistry,
  AgentProfileRegistryError,
  BUILT_IN_AGENT_PROFILES,
  CAPABILITY_PATTERN,
  MAX_CAPABILITIES,
  PROFILE_FIELDS,
  validateAgentProfile
};
