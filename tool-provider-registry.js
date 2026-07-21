"use strict";

const { ToolProviderError, assertToolProvider, validateProviderName } = require("./tool-provider");
const { NAME_PATTERN } = require("./tool-registry");

class ToolProviderRegistry {
  constructor({ providers = [] } = {}) {
    if (!Array.isArray(providers)) throw new TypeError("providers 必须是 array");
    this.providers = new Map();
    this.toolProviders = new Map();
    for (const provider of providers) this.register(provider);
  }

  register(provider) {
    const valid = assertToolProvider(provider);
    if (this.providers.has(valid.name)) {
      throw new ToolProviderError("Provider 已注册", "TOOL_PROVIDER_ALREADY_REGISTERED");
    }
    let tools;
    try { tools = valid.listTools(); }
    catch { throw new ToolProviderError("Provider Tool 列表不可用", "TOOL_PROVIDER_TOOLS_INVALID"); }
    if (!Array.isArray(tools)) throw new ToolProviderError("Provider Tool 列表无效", "TOOL_PROVIDER_TOOLS_INVALID");
    const names = tools.map(item => typeof item === "string" ? item : item?.name);
    if (names.some(name => typeof name !== "string" || !NAME_PATTERN.test(name)) || new Set(names).size !== names.length) {
      throw new ToolProviderError("Provider Tool 列表无效", "TOOL_PROVIDER_TOOLS_INVALID");
    }
    const conflict = names.find(name => this.toolProviders.has(name));
    if (conflict) throw new ToolProviderError("Tool 已由其他 Provider 注册", "TOOL_PROVIDER_TOOL_CONFLICT");
    this.providers.set(valid.name, valid);
    for (const name of names) this.toolProviders.set(name, valid.name);
    return valid;
  }

  get(name) {
    return this.providers.get(validateProviderName(name)) || null;
  }

  list() {
    return [...this.providers.values()];
  }

  getForTool(toolName) {
    if (typeof toolName !== "string" || !NAME_PATTERN.test(toolName)) return null;
    const providerName = this.toolProviders.get(toolName);
    return providerName ? this.get(providerName) : null;
  }
}

module.exports = { ToolProviderRegistry };
