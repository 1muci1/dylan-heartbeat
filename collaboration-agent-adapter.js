"use strict";

const SUPPORTED_AGENTS = Object.freeze(["chen", "chatgpt"]);
const MESSAGE_ROLES = new Set(["system", "user", "assistant"]);
const MAX_MESSAGES = 100;
const MAX_MESSAGE_CHARACTERS = 12000;

class CollaborationAgentAdapterError extends Error {
  constructor(message, code = "COLLABORATION_AGENT_INVALID") {
    super(message);
    this.name = "CollaborationAgentAdapterError";
    this.code = code;
  }
}

function normalizeMessages(messages) {
  if (!Array.isArray(messages) || messages.length > MAX_MESSAGES) {
    throw new CollaborationAgentAdapterError("messages 格式无效");
  }
  return messages.map(message => {
    if (!message || typeof message !== "object" || Array.isArray(message)) {
      throw new CollaborationAgentAdapterError("message 格式无效");
    }
    const role = String(message.role || "");
    const content = typeof message.content === "string" ? message.content.trim() : "";
    if (!MESSAGE_ROLES.has(role) || !content || content.length > MAX_MESSAGE_CHARACTERS) {
      throw new CollaborationAgentAdapterError("message role 或 content 无效");
    }
    return { role, content };
  });
}

function normalizeResponse(agent, response) {
  const content = typeof response === "string" ? response : response?.content;
  if (typeof content !== "string" || !content.trim()) {
    throw new CollaborationAgentAdapterError(
      "Agent 响应无效",
      "COLLABORATION_AGENT_RESPONSE_INVALID"
    );
  }
  return Object.freeze({ agent, content: content.trim() });
}

function insertRuntimeContext(messages, context) {
  if (!context) return messages;
  if (
    context.role !== "system" ||
    typeof context.content !== "string" ||
    !context.content.trim()
  ) {
    throw new CollaborationAgentAdapterError(
      "Memory Context 无效",
      "COLLABORATION_MEMORY_CONTEXT_INVALID"
    );
  }
  const output = messages.map(message => ({ ...message }));
  const firstConversationMessage = output.findIndex(message => message.role !== "system");
  output.splice(
    firstConversationMessage < 0 ? output.length : firstConversationMessage,
    0,
    { role: "system", content: context.content }
  );
  return output;
}

class ChenCollaborationAgentAdapter {
  #gateway;
  #memoryReader;
  #memoryContextBuilder;
  #gatewayProvidesMemoryContext;

  constructor({
    gateway,
    memoryReader,
    memoryContextBuilder,
    gatewayProvidesMemoryContext = false
  } = {}) {
    if (!gateway || typeof gateway.generate !== "function") {
      throw new TypeError("chen Gateway transport 必填");
    }
    if (!gatewayProvidesMemoryContext &&
        (!memoryReader || typeof memoryReader.retrieve !== "function")) {
      throw new TypeError("AgentMemoryRetriever 必填");
    }
    if (!gatewayProvidesMemoryContext &&
        (!memoryContextBuilder || typeof memoryContextBuilder.build !== "function")) {
      throw new TypeError("AgentMemoryContextBuilder 必填");
    }
    this.#gateway = gateway;
    this.#memoryReader = memoryReader;
    this.#memoryContextBuilder = memoryContextBuilder;
    this.#gatewayProvidesMemoryContext = gatewayProvidesMemoryContext === true;
  }

  async invoke({ messages, signal } = {}) {
    const normalized = normalizeMessages(messages);
    const memoryContext = this.#gatewayProvidesMemoryContext
      ? null
      : this.#memoryContextBuilder.build(
        this.#memoryReader.retrieve({ limit: 8, characterBudget: 3000 })
      );
    const response = await this.#gateway.generate({
      messages: insertRuntimeContext(normalized, memoryContext),
      signal
    });
    return normalizeResponse("chen", response);
  }
}

class ChatGptCollaborationAgentAdapter {
  #adapter;

  constructor({ adapter } = {}) {
    if (!adapter || typeof adapter.generate !== "function") {
      throw new TypeError("chatgpt transport 必填");
    }
    this.#adapter = adapter;
  }

  async invoke({ messages, signal } = {}) {
    const response = await this.#adapter.generate({
      messages: normalizeMessages(messages),
      signal
    });
    return normalizeResponse("chatgpt", response);
  }
}

class CollaborationAgentAdapter {
  #adapters;

  constructor({ chen, chatgpt } = {}) {
    if (!chen || typeof chen.invoke !== "function") throw new TypeError("chen adapter 必填");
    if (!chatgpt || typeof chatgpt.invoke !== "function") throw new TypeError("chatgpt adapter 必填");
    this.#adapters = new Map([["chen", chen], ["chatgpt", chatgpt]]);
  }

  invoke(agent, input) {
    const adapter = this.#adapters.get(agent);
    if (!adapter) {
      throw new CollaborationAgentAdapterError(
        "不支持的 Collaboration Agent",
        "COLLABORATION_AGENT_UNSUPPORTED"
      );
    }
    return adapter.invoke(input);
  }
}

module.exports = {
  ChatGptCollaborationAgentAdapter,
  ChenCollaborationAgentAdapter,
  CollaborationAgentAdapter,
  CollaborationAgentAdapterError,
  MAX_MESSAGES,
  MAX_MESSAGE_CHARACTERS,
  SUPPORTED_AGENTS,
  insertRuntimeContext,
  normalizeMessages
};
