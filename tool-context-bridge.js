"use strict";

const { normalizeToolResult } = require("./tool-result-normalizer");

const CLASSIFICATIONS = new Set(["ephemeral", "sensitive", "persistent_candidate"]);
const INPUT_FIELDS = new Set(["toolName", "result", "classification"]);

class ToolContextBridgeError extends Error {
  constructor(message, code = "TOOL_CONTEXT_INPUT_INVALID") {
    super(message);
    this.name = "ToolContextBridgeError";
    this.code = code;
  }
}

function bridgeToolContext(input) {
  if (!input || typeof input !== "object" || Array.isArray(input)) throw new ToolContextBridgeError("Tool Context 输入无效");
  const unknown = Object.keys(input).find(key => !INPUT_FIELDS.has(key));
  if (unknown) throw new ToolContextBridgeError(`不允许 Tool Context 字段：${unknown}`);
  const missing = [...INPUT_FIELDS].find(key => !Object.hasOwn(input, key));
  if (missing) throw new ToolContextBridgeError(`Tool Context 缺少字段：${missing}`);
  if (!CLASSIFICATIONS.has(input.classification)) throw new ToolContextBridgeError("classification 无效");

  if (input.classification === "sensitive") {
    return { allowed: false, context: null, reasonCode: "TOOL_CONTEXT_APPROVAL_REQUIRED" };
  }

  let normalized;
  try {
    normalized = normalizeToolResult({ toolName: input.toolName, result: input.result });
  } catch {
    throw new ToolContextBridgeError("Tool result 无法进入 Context");
  }
  const safeResult = { data: normalized.data, metadata: normalized.metadata };
  if (input.classification === "ephemeral") {
    return {
      allowed: true,
      context: { scope: "ephemeral", toolName: input.toolName, result: safeResult },
      reasonCode: "TOOL_CONTEXT_EPHEMERAL_ALLOWED"
    };
  }
  return {
    allowed: true,
    context: {
      scope: "persistent_candidate",
      candidate: { source: "tool", toolName: input.toolName, result: safeResult }
    },
    reasonCode: "TOOL_CONTEXT_CANDIDATE_CREATED"
  };
}

module.exports = { CLASSIFICATIONS, INPUT_FIELDS, ToolContextBridgeError, bridgeToolContext };
