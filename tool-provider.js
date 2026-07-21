"use strict";

const PROVIDER_NAME_PATTERN = /^[a-z][a-z0-9_-]{0,63}$/;

class ToolProviderError extends Error {
  constructor(message, code = "TOOL_PROVIDER_INVALID") {
    super(message);
    this.name = "ToolProviderError";
    this.code = code;
  }
}

function validateProviderName(value) {
  if (typeof value !== "string" || !PROVIDER_NAME_PATTERN.test(value)) {
    throw new ToolProviderError("Provider name 格式无效");
  }
  return value;
}

function assertToolProvider(provider) {
  if (!provider || typeof provider !== "object" || Array.isArray(provider)) {
    throw new ToolProviderError("Provider 必须是 object");
  }
  validateProviderName(provider.name);
  for (const method of ["getMetadata", "listTools", "execute"]) {
    if (typeof provider[method] !== "function") throw new ToolProviderError(`Provider.${method} 必须是 function`);
  }
  return provider;
}

class ToolProvider {
  constructor({ name } = {}) {
    this.name = validateProviderName(name);
  }

  getMetadata() {
    throw new ToolProviderError("getMetadata 未实现", "TOOL_PROVIDER_NOT_IMPLEMENTED");
  }

  listTools() {
    throw new ToolProviderError("listTools 未实现", "TOOL_PROVIDER_NOT_IMPLEMENTED");
  }

  async execute(_toolName, _input) {
    throw new ToolProviderError("execute 未实现", "TOOL_PROVIDER_NOT_IMPLEMENTED");
  }
}

module.exports = { PROVIDER_NAME_PATTERN, ToolProvider, ToolProviderError, assertToolProvider, validateProviderName };
