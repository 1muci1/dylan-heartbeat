"use strict";

const {
  EXECUTION_TYPES,
  PERMISSION_LEVELS,
  TOOL_DEFINITIONS,
  TOOL_DEFINITION_FIELDS
} = require("./tool-definitions");

const NAME_PATTERN = /^(?:[a-z][a-z0-9_]*(?:\.[a-z][a-z0-9_]*){1,7}|[a-z][a-z0-9]*(?:_[a-z][a-z0-9]*){1,7})$/;
const MAX_NAME_LENGTH = 120;
const MAX_DESCRIPTION_LENGTH = 500;

class ToolRegistryError extends Error {
  constructor(message, code = "TOOL_DEFINITION_INVALID") {
    super(message);
    this.name = "ToolRegistryError";
    this.code = code;
  }
}

function plainObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function cloneJson(value, field) {
  let json;
  try {
    json = JSON.stringify(value, (_key, item) => {
      if (["undefined", "function", "symbol", "bigint"].includes(typeof item)) throw new TypeError("non-JSON value");
      if (typeof item === "number" && !Number.isFinite(item)) throw new TypeError("non-finite number");
      return item;
    });
  } catch {
    throw new ToolRegistryError(`${field} 必须是有效 JSON`);
  }
  if (json === undefined) throw new ToolRegistryError(`${field} 必须是有效 JSON`);
  return JSON.parse(json);
}

function validateInputSchema(value) {
  if (!plainObject(value)) throw new ToolRegistryError("inputSchema 必须是 object");
  const schema = cloneJson(value, "inputSchema");
  if (schema.type !== "object") throw new ToolRegistryError("inputSchema.type 必须是 object");
  if (schema.properties != null && !plainObject(schema.properties)) {
    throw new ToolRegistryError("inputSchema.properties 必须是 object");
  }
  if (schema.required != null && (!Array.isArray(schema.required) ||
      schema.required.some(item => typeof item !== "string" || !item))) {
    throw new ToolRegistryError("inputSchema.required 必须是 string array");
  }
  if (schema.additionalProperties !== false) {
    throw new ToolRegistryError("inputSchema.additionalProperties 必须为 false");
  }
  return schema;
}

function validateToolDefinition(input) {
  if (!plainObject(input)) throw new ToolRegistryError("Tool definition 必须是 object");
  const unknown = Object.keys(input).find(key => !TOOL_DEFINITION_FIELDS.includes(key));
  if (unknown) throw new ToolRegistryError(`不允许 Tool metadata 字段：${unknown}`);
  const missing = TOOL_DEFINITION_FIELDS.find(key => !Object.hasOwn(input, key));
  if (missing) throw new ToolRegistryError(`Tool metadata 缺少字段：${missing}`);

  if (typeof input.name !== "string" || input.name.length > MAX_NAME_LENGTH || !NAME_PATTERN.test(input.name)) {
    throw new ToolRegistryError("Tool name 格式无效");
  }
  if (typeof input.description !== "string" || !input.description.trim() ||
      input.description.trim().length > MAX_DESCRIPTION_LENGTH) {
    throw new ToolRegistryError("Tool description 格式无效");
  }
  if (!PERMISSION_LEVELS.includes(input.permissionLevel)) {
    throw new ToolRegistryError("permissionLevel 无效", "TOOL_PERMISSION_LEVEL_INVALID");
  }
  if (!EXECUTION_TYPES.includes(input.executionType)) {
    throw new ToolRegistryError("executionType 无效", "TOOL_EXECUTION_TYPE_INVALID");
  }

  return Object.freeze({
    name: input.name,
    description: input.description.trim(),
    inputSchema: Object.freeze(validateInputSchema(input.inputSchema)),
    permissionLevel: input.permissionLevel,
    executionType: input.executionType
  });
}

class ToolRegistry {
  constructor({ definitions = TOOL_DEFINITIONS } = {}) {
    if (!Array.isArray(definitions)) throw new TypeError("definitions 必须是 array");
    this.tools = new Map();
    for (const definition of definitions) this.register(definition);
  }

  register(definition) {
    const tool = validateToolDefinition(definition);
    if (this.tools.has(tool.name)) {
      throw new ToolRegistryError("Tool 已注册", "TOOL_ALREADY_REGISTERED");
    }
    this.tools.set(tool.name, tool);
    return cloneJson(tool, "Tool definition");
  }

  get(name) {
    if (typeof name !== "string" || !NAME_PATTERN.test(name)) {
      throw new ToolRegistryError("Tool name 格式无效", "TOOL_NAME_INVALID");
    }
    const tool = this.tools.get(name);
    return tool ? cloneJson(tool, "Tool definition") : null;
  }

  list() {
    return [...this.tools.values()].map(tool => cloneJson(tool, "Tool definition"));
  }
}

module.exports = {
  MAX_DESCRIPTION_LENGTH,
  MAX_NAME_LENGTH,
  NAME_PATTERN,
  ToolRegistry,
  ToolRegistryError,
  validateInputSchema,
  validateToolDefinition
};
