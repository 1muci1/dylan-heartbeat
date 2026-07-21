"use strict";

const crypto = require("node:crypto");
const { evaluateToolCapability } = require("./tool-capability-policy");
const { approvalRequestFromRecord } = require("./tool-approval-request");

const REQUEST_FIELDS = new Set(["toolName", "input", "approvalId"]);

class ToolExecutionGatewayError extends Error {
  constructor(message, code) {
    super(message);
    this.name = "ToolExecutionGatewayError";
    this.code = code;
  }
}

function plainObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function inputError(message = "Tool input 无效") {
  return new ToolExecutionGatewayError(message, "TOOL_INPUT_INVALID");
}

function validateValue(value, schema, path = "input") {
  if (!plainObject(schema)) throw inputError();
  if (Array.isArray(schema.enum) && !schema.enum.some(item => Object.is(item, value))) {
    throw inputError(`${path} 不在允许范围内`);
  }
  if (schema.type === "object") {
    if (!plainObject(value)) throw inputError(`${path} 必须是 object`);
    const properties = plainObject(schema.properties) ? schema.properties : {};
    const required = Array.isArray(schema.required) ? schema.required : [];
    for (const key of required) {
      if (!Object.hasOwn(value, key)) throw inputError(`${path}.${key} 必填`);
    }
    if (schema.additionalProperties === false) {
      const unknown = Object.keys(value).find(key => !Object.hasOwn(properties, key));
      if (unknown) throw inputError(`${path}.${unknown} 不允许`);
    }
    for (const [key, item] of Object.entries(value)) {
      if (Object.hasOwn(properties, key)) validateValue(item, properties[key], `${path}.${key}`);
    }
    return;
  }
  if (schema.type === "array") {
    if (!Array.isArray(value)) throw inputError(`${path} 必须是 array`);
    if (Number.isInteger(schema.minItems) && value.length < schema.minItems) throw inputError(`${path} 数量不足`);
    if (Number.isInteger(schema.maxItems) && value.length > schema.maxItems) throw inputError(`${path} 数量过多`);
    if (schema.items) value.forEach((item, index) => validateValue(item, schema.items, `${path}[${index}]`));
    return;
  }
  if (schema.type === "string") {
    if (typeof value !== "string") throw inputError(`${path} 必须是 string`);
    if (Number.isInteger(schema.minLength) && value.length < schema.minLength) throw inputError(`${path} 长度不足`);
    if (Number.isInteger(schema.maxLength) && value.length > schema.maxLength) throw inputError(`${path} 长度过长`);
    if (typeof schema.pattern === "string") {
      let pattern;
      try { pattern = new RegExp(schema.pattern); } catch { throw inputError(); }
      if (!pattern.test(value)) throw inputError(`${path} 格式无效`);
    }
    return;
  }
  if (schema.type === "boolean") {
    if (typeof value !== "boolean") throw inputError(`${path} 必须是 boolean`);
    return;
  }
  if (schema.type === "integer") {
    if (!Number.isSafeInteger(value)) throw inputError(`${path} 必须是 integer`);
  } else if (schema.type === "number") {
    if (typeof value !== "number" || !Number.isFinite(value)) throw inputError(`${path} 必须是 number`);
  } else if (schema.type === "null") {
    if (value !== null) throw inputError(`${path} 必须是 null`);
    return;
  } else if (schema.type != null) {
    throw inputError();
  }
  if (typeof value === "number") {
    if (typeof schema.minimum === "number" && value < schema.minimum) throw inputError(`${path} 小于最小值`);
    if (typeof schema.maximum === "number" && value > schema.maximum) throw inputError(`${path} 超过最大值`);
  }
}

function validateToolInput(input, inputSchema) {
  validateValue(input, inputSchema);
  return input;
}

function canonicalJson(value) {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (plainObject(value)) return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(",")}}`;
  return JSON.stringify(value);
}

function inputHash(value) {
  return crypto.createHash("sha256").update(canonicalJson(value)).digest("hex");
}

class ToolExecutionGateway {
  constructor({ registry, executor = null, providerRegistry = null, approvalStore = null, policy = evaluateToolCapability } = {}) {
    if (!registry || typeof registry.get !== "function") throw new TypeError("registry 必填");
    if (!(executor == null || typeof executor === "function" || executor && typeof executor.execute === "function")) {
      throw new TypeError("executor 无效");
    }
    if (providerRegistry && typeof providerRegistry.getForTool !== "function") {
      throw new TypeError("providerRegistry 无效");
    }
    if (!providerRegistry && !(typeof executor === "function" || executor && typeof executor.execute === "function")) {
      throw new TypeError("executor 或 providerRegistry 必填");
    }
    this.registry = registry;
    this.executor = executor;
    this.providerRegistry = providerRegistry;
    if (approvalStore && (typeof approvalStore.create !== "function" || typeof approvalStore.get !== "function")) {
      throw new TypeError("approvalStore 无效");
    }
    this.approvalStore = approvalStore;
    if (!(typeof policy === "function" || policy && typeof policy.evaluate === "function")) {
      throw new TypeError("policy 无效");
    }
    this.policy = policy;
  }

  async execute(request) {
    if (!plainObject(request)) throw inputError("Tool execution request 无效");
    const unknown = Object.keys(request).find(key => !REQUEST_FIELDS.has(key));
    if (unknown) throw inputError(`不允许 request 字段：${unknown}`);
    if (typeof request.toolName !== "string" || !request.toolName) throw inputError("toolName 无效");
    if (!Object.hasOwn(request, "input")) throw inputError("input 必填");

    let tool;
    try { tool = this.registry.get(request.toolName); }
    catch { throw new ToolExecutionGatewayError("Tool 不存在", "TOOL_NOT_FOUND"); }
    if (!tool) throw new ToolExecutionGatewayError("Tool 不存在", "TOOL_NOT_FOUND");
    let policyDecision;
    const riskLevel = tool.permissionLevel === "automatic" ? "low" : tool.permissionLevel === "user_confirm" ? "medium" : "high";
    try {
      policyDecision = typeof this.policy === "function"
        ? await this.policy({ toolName: tool.name, permission: tool.permissionLevel, riskLevel, context: {} })
        : await this.policy.evaluate({ toolName: tool.name, permission: tool.permissionLevel, riskLevel, context: {} });
    } catch {
      throw new ToolExecutionGatewayError("Tool Policy 不可用", "TOOL_POLICY_UNAVAILABLE");
    }
    if (!plainObject(policyDecision) || typeof policyDecision.allowed !== "boolean" ||
        !["automatic", "user_confirm", "blocked"].includes(policyDecision.decision) ||
        typeof policyDecision.reasonCode !== "string" || !/^[A-Z][A-Z0-9_]{0,63}$/.test(policyDecision.reasonCode)) {
      throw new ToolExecutionGatewayError("Tool Policy 不可用", "TOOL_POLICY_UNAVAILABLE");
    }

    const effectiveDecision = tool.permissionLevel === "blocked" || policyDecision.decision === "blocked"
      ? "blocked"
      : tool.permissionLevel === "user_confirm" || policyDecision.decision === "user_confirm"
        ? "user_confirm" : "automatic";
    if (effectiveDecision === "blocked") {
      throw new ToolExecutionGatewayError("Tool Policy 阻断", "TOOL_POLICY_BLOCKED");
    }
    validateToolInput(request.input, tool.inputSchema);
    if (effectiveDecision === "user_confirm") {
      if (!this.approvalStore) throw new ToolExecutionGatewayError("Tool Policy 要求确认", "TOOL_POLICY_CONFIRM_REQUIRED");
      const hash = inputHash(request.input);
      if (request.approvalId == null) {
        const approval = this.approvalStore.create({
          toolName: tool.name, inputHash: hash, riskLevel,
          reasonCode: policyDecision.reasonCode, summary: tool.description.slice(0, 240)
        });
        return { errorCode: "TOOL_APPROVAL_REQUIRED", approval: approvalRequestFromRecord(approval) };
      }
      const approval = this.approvalStore.get(request.approvalId);
      if (!approval || approval.toolName !== tool.name || approval.inputHash !== hash) {
        throw new ToolExecutionGatewayError("Tool 权限拒绝", "TOOL_PERMISSION_DENIED");
      }
      if (approval.status === "pending") {
        return { errorCode: "TOOL_APPROVAL_REQUIRED", approval: approvalRequestFromRecord(approval) };
      }
      if (approval.status !== "approved") {
        throw new ToolExecutionGatewayError("Tool 权限拒绝", "TOOL_PERMISSION_DENIED");
      }
    } else if (!policyDecision.allowed || policyDecision.decision !== "automatic") {
      throw new ToolExecutionGatewayError("Tool Policy 不可用", "TOOL_POLICY_UNAVAILABLE");
    }

    try {
      let output;
      if (this.providerRegistry) {
        const provider = this.providerRegistry.getForTool(tool.name);
        if (!provider) throw new ToolExecutionGatewayError("Tool Provider 不存在", "TOOL_PROVIDER_NOT_FOUND");
        try { output = await provider.execute(tool.name, request.input); }
        catch { throw new ToolExecutionGatewayError("Tool Provider 执行失败", "TOOL_PROVIDER_EXECUTION_FAILED"); }
      } else {
        output = typeof this.executor === "function"
          ? await this.executor({ tool, input: request.input })
          : await this.executor.execute({ tool, input: request.input });
      }
      return { success: true, toolName: tool.name, output };
    } catch (error) {
      if (["TOOL_PROVIDER_NOT_FOUND", "TOOL_PROVIDER_EXECUTION_FAILED"].includes(error?.code)) throw error;
      throw new ToolExecutionGatewayError("Tool 执行失败", "TOOL_EXECUTION_FAILED");
    }
  }
}

module.exports = {
  ToolExecutionGateway,
  ToolExecutionGatewayError,
  canonicalJson,
  inputHash,
  validateToolInput,
  validateValue
};
