"use strict";

((root, factory) => {
  const api = factory(root?.CompanionModelRegistry);
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.CompanionModelSwitcher = Object.freeze(api);
  if (typeof document !== "undefined") api.mount(document, root);
})(typeof window !== "undefined" ? window : null, registry => {
  const fallbackRegistry = { list: () => [], byId: () => null, requireId: id => id };
  const models = registry || fallbackRegistry;

  class ModelSwitcher {
    #config;
    #registry;
    #preferences;
    constructor({ configStore, modelRegistry = models, preferenceStore = null } = {}) {
      if (!configStore?.getProviderConfig || !configStore?.saveProviderConfig) {
        throw new TypeError("AppConfig 必填");
      }
      this.#config = configStore;
      this.#registry = modelRegistry;
      this.#preferences = preferenceStore;
    }
    list() { return this.#registry.list({ enabledOnly: true }); }
    current() {
      const config = this.#config.getProviderConfig();
      return this.#registry.byId(config.model) || null;
    }
    config() { return this.#config.getProviderConfig(); }
    select(id) {
      this.#registry.requireId(id);
      const current = this.#config.getProviderConfig();
      const next = this.#config.saveProviderConfig({
        ...current,
        model: id,
        defaultModel: id
      });
      this.#preferences?.saveModel?.(next.model);
      return next;
    }
    setAutoSelect(enabled) {
      const current = this.#config.getProviderConfig();
      return this.#config.saveProviderConfig({
        ...current,
        autoSelectModel: Boolean(enabled)
      });
    }
  }

  const text = (documentRef, value) => {
    const node = documentRef.createElement("span");
    node.textContent = value;
    return node;
  };

  const modelLabel = model => model ? `${model.name}` : "未配置模型";

  const renderCard = (documentRef, model, selected) => {
    const card = documentRef.createElement("button");
    card.type = "button";
    card.className = `model-option${selected ? " is-selected" : ""}`;
    card.dataset.modelId = model.id;
    const icon = documentRef.createElement("span");
    icon.className = "model-option__icon";
    icon.append(text(documentRef, model.icon));
    const copy = documentRef.createElement("span");
    copy.className = "model-option__copy";
    const title = documentRef.createElement("strong");
    title.append(text(documentRef, model.name));
    const provider = documentRef.createElement("small");
    provider.append(text(documentRef, model.provider));
    const description = documentRef.createElement("span");
    description.className = "model-option__description";
    description.append(text(documentRef, model.description));
    const capabilities = documentRef.createElement("span");
    capabilities.className = "model-option__capabilities";
    model.capabilityLabels.forEach(label => {
      const tag = documentRef.createElement("i");
      tag.append(text(documentRef, label));
      capabilities.append(tag);
    });
    copy.append(title, provider, description, capabilities);
    const check = documentRef.createElement("span");
    check.className = "model-option__check";
    check.append(text(documentRef, selected ? "✓" : ""));
    card.append(icon, copy, check);
    return card;
  };

  const mount = (documentRef, windowRef) => {
    const config = windowRef?.AppConfig;
    if (!config || !windowRef?.CompanionModelRegistry) return null;
    const PreferenceStore = windowRef?.CompanionUserPreferences?.UserPreferenceStore;
    const preferences = PreferenceStore ? new PreferenceStore() : null;
    const switcher = new ModelSwitcher({ configStore: config, modelRegistry: windowRef.CompanionModelRegistry, preferenceStore: preferences });
    const currentNode = documentRef.querySelector("[data-current-model]");
    const providerNode = documentRef.querySelector("[data-current-model-provider]");
    const statusNode = documentRef.querySelector("[data-model-switcher-status]");
    const listNode = documentRef.querySelector("[data-model-list]");
    const toggleNode = documentRef.querySelector("[data-model-toggle]");
    const autoToggle = documentRef.querySelector("[data-auto-model]");
    const render = () => {
      const current = switcher.current();
      if (currentNode) currentNode.textContent = modelLabel(current);
      if (providerNode) providerNode.textContent = current?.provider || "Provider 未配置";
      if (autoToggle) autoToggle.checked = Boolean(switcher.config().autoSelectModel);
      if (listNode) {
        listNode.replaceChildren(...switcher.list().map(model => {
          const card = renderCard(documentRef, model, current?.id === model.id);
          card.addEventListener("click", () => {
            try {
              switcher.select(model.id);
              render();
              if (statusNode) statusNode.textContent = `已切换至 ${model.name}`;
              documentRef.dispatchEvent(new CustomEvent("companion:model-change", { detail: { modelId: model.id } }));
            } catch (error) {
              if (statusNode) statusNode.textContent = error.message;
            }
          });
          return card;
        }));
      }
      documentRef.querySelectorAll("[data-model-badge]").forEach(node => {
        node.textContent = current ? `${current.name} · ${current.provider}` : "未配置模型";
      });
    };
    autoToggle?.addEventListener("change", () => {
      switcher.setAutoSelect(autoToggle.checked);
      if (statusNode) statusNode.textContent = autoToggle.checked ? "自动选择已开启（v1 仅保存偏好）" : "自动选择已关闭";
    });
    toggleNode?.addEventListener("click", () => {
      if (!listNode) return;
      const hidden = listNode.hasAttribute("hidden");
      listNode.toggleAttribute("hidden", !hidden);
      toggleNode.textContent = hidden ? "收起模型" : "切换模型";
    });
    documentRef.querySelectorAll("[data-model-badge]").forEach(node => {
      node.addEventListener("click", () => {
        if (!windowRef?.location) return;
        const currentRoute = `${windowRef.location.pathname || "/frontend-p4b/chat.html"}${windowRef.location.search || ""}${windowRef.location.hash || ""}`;
        windowRef.location.href = `settings.html?returnTo=${encodeURIComponent(currentRoute)}#model-settings-title`;
      });
    });
    render();
    return switcher;
  };

  return { ModelSwitcher, modelLabel, mount, renderCard };
});
