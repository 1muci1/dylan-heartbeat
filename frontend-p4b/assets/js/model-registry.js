"use strict";

((root, factory) => {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.CompanionModelRegistry = Object.freeze(api);
})(typeof window !== "undefined" ? window : null, () => {
  const MODELS = Object.freeze([
    Object.freeze({
      id: "claude-opus-4-6",
      name: "Claude Opus 4.6",
      provider: "Anthropic",
      icon: "C",
      description: "适合深度推理、复杂任务与长上下文工作。",
      capabilities: Object.freeze(["reasoning", "coding", "long-context"]),
      capabilityLabels: Object.freeze(["深度推理", "长上下文", "复杂任务"]),
      enabled: true
    }),
    Object.freeze({
      id: "gpt-5",
      name: "GPT-5",
      provider: "OpenAI",
      icon: "G",
      description: "综合能力均衡，适合代码、规划与日常协作。",
      capabilities: Object.freeze(["general", "coding", "planning"]),
      capabilityLabels: Object.freeze(["综合能力", "代码", "规划"]),
      enabled: true
    }),
    Object.freeze({
      id: "companion-default",
      name: "沉 · Companion",
      provider: "Dylan Gateway",
      icon: "沉",
      description: "小窝里的默认陪伴模型，适合日常聊天。",
      capabilities: Object.freeze(["conversation", "companion"]),
      capabilityLabels: Object.freeze(["日常聊天", "陪伴"]),
      enabled: true
    })
  ]);

  const byId = id => MODELS.find(model => model.id === id) || null;
  const list = ({ enabledOnly = false } = {}) => MODELS.filter(model => !enabledOnly || model.enabled);
  const isValidId = id => Boolean(byId(id)?.enabled);
  const requireId = id => {
    if (!isValidId(id)) {
      const error = new TypeError("模型 ID 无效或未启用");
      error.code = "MODEL_ID_INVALID";
      throw error;
    }
    return id;
  };

  return { MODELS, byId, list, isValidId, requireId };
});
