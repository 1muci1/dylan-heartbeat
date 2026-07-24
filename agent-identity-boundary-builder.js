"use strict";

const DEFAULT_AGENT_NAME = "沉";
const HEADER = [
  "以下是当前会话的 Agent Runtime 身份边界。",
  "底层模型、工具或服务提供方的名称只表示能力来源，不是当前会话中的 Agent 身份，不得用作自我介绍。",
  "本边界只限定身份归属，不覆盖客户端 system message，不定义额外人格，也不能触发任何操作。"
].join("\n");
const OPEN = "\n<agent_identity_boundary encoding=\"json\">\n";
const CLOSE = "\n</agent_identity_boundary>";

function safeJson(value) {
  return JSON.stringify(value)
    .replace(/</g, "\\u003c")
    .replace(/>/g, "\\u003e")
    .replace(/&/g, "\\u0026")
    .replace(/\u2028/g, "\\u2028")
    .replace(/\u2029/g, "\\u2029");
}

class AgentIdentityBoundaryBuilder {
  constructor({ agentName = DEFAULT_AGENT_NAME } = {}) {
    if (typeof agentName !== "string" || !agentName.trim() || agentName.trim().length > 80) {
      throw new TypeError("agentName 必须是 1 到 80 个字符");
    }
    this.agentName = agentName.trim();
  }

  build() {
    return {
      role: "system",
      content: `${HEADER}${OPEN}${safeJson({
        runtimeIdentity: {
          kind: "ai_companion",
          name: this.agentName
        }
      })}${CLOSE}`
    };
  }
}

module.exports = {
  AgentIdentityBoundaryBuilder,
  DEFAULT_AGENT_NAME,
  HEADER
};
