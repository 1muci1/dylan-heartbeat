"use strict";

const { NAME_PATTERN } = require("./tool-registry");

const PERMISSIONS = new Set(["automatic", "user_confirm", "blocked"]);
const RISK_LEVELS = new Set(["low", "medium", "high"]);
const INPUT_FIELDS = new Set(["toolName", "permission", "riskLevel", "context"]);

class ToolCapabilityPolicyError extends Error {
  constructor(message, code = "TOOL_CAPABILITY_POLICY_INVALID") {
    super(message);
    this.name = "ToolCapabilityPolicyError";
    this.code = code;
  }
}

function plainObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function evaluateToolCapability(input) {
  if (!plainObject(input)) throw new ToolCapabilityPolicyError("Policy 输入无效");
  const unknown = Object.keys(input).find(key => !INPUT_FIELDS.has(key));
  if (unknown) throw new ToolCapabilityPolicyError(`不允许 Policy 字段：${unknown}`);
  const missing = [...INPUT_FIELDS].find(key => !Object.hasOwn(input, key));
  if (missing) throw new ToolCapabilityPolicyError(`Policy 缺少字段：${missing}`);
  if (typeof input.toolName !== "string" || !NAME_PATTERN.test(input.toolName)) {
    throw new ToolCapabilityPolicyError("toolName 格式无效");
  }
  if (!PERMISSIONS.has(input.permission)) throw new ToolCapabilityPolicyError("permission 无效");
  if (!RISK_LEVELS.has(input.riskLevel)) throw new ToolCapabilityPolicyError("riskLevel 无效");
  if (!plainObject(input.context)) throw new ToolCapabilityPolicyError("context 必须是 object");

  if (input.permission === "blocked" || input.riskLevel === "high") {
    return { allowed: false, decision: "blocked", reasonCode: "TOOL_CAPABILITY_BLOCKED" };
  }
  if (input.permission === "user_confirm" || input.riskLevel === "medium") {
    return { allowed: false, decision: "user_confirm", reasonCode: "TOOL_USER_CONFIRM_REQUIRED" };
  }
  return { allowed: true, decision: "automatic", reasonCode: "TOOL_AUTOMATIC_ALLOWED" };
}

module.exports = {
  INPUT_FIELDS,
  PERMISSIONS,
  RISK_LEVELS,
  ToolCapabilityPolicyError,
  evaluateToolCapability
};
