document.addEventListener("DOMContentLoaded", () => {
  const applySettingsSection = () => window.CompanionSettingsSection?.apply(document, window.location.hash);
  applySettingsSection();
  window.addEventListener("hashchange", applySettingsSection);

  const backLink = document.querySelector("[data-settings-back]");
  const returnResolver = window.CompanionSettingsReturn;
  if (backLink && returnResolver) {
    backLink.href = returnResolver.resolveReturnTarget({
      returnTo: new URLSearchParams(window.location.search).get("returnTo"),
      referrer: document.referrer,
      origin: window.location.origin,
      settingsPath: window.location.pathname,
      fallback: "/home/"
    });
  }
  const appearance = window.CompanionAppearance;
  if (appearance) {
    const current = appearance.read();
    const resultNode = document.querySelector("[data-appearance-result]");
    const activate = (selector, value) => document.querySelectorAll(`${selector} [data-value]`).forEach(button => {
      button.classList.toggle("is-active", button.dataset.value === value);
    });
    activate("[data-appearance-mode]", current.mode || "night");
    activate("[data-appearance-style]", current.style || "purple");
    const fontSelect = document.querySelector("[data-appearance-font]");
    if (fontSelect) fontSelect.value = current.font || "default";
    document.querySelectorAll("[data-appearance-mode] [data-value]").forEach(button => button.addEventListener("click", () => {
      appearance.save({ mode: button.dataset.value });
      activate("[data-appearance-mode]", button.dataset.value);
      if (resultNode) resultNode.textContent = "主题模式已更新";
    }));
    document.querySelectorAll("[data-appearance-style] [data-value]").forEach(button => button.addEventListener("click", () => {
      appearance.save({ style: button.dataset.value });
      activate("[data-appearance-style]", button.dataset.value);
      if (resultNode) resultNode.textContent = "主题风格已更新";
    }));
    fontSelect?.addEventListener("change", () => {
      appearance.save({ font: fontSelect.value });
      if (resultNode) resultNode.textContent = "字体已更新";
    });
  }
  const preferenceStore = window.CompanionUserPreferences?.UserPreferenceStore
    ? new window.CompanionUserPreferences.UserPreferenceStore() : null;
  const preferenceResult = document.querySelector("[data-preference-result]");
  const preferenceMessage = message => { if (preferenceResult) preferenceResult.textContent = message; };
  document.querySelector("[data-preference-save]")?.addEventListener("click", () => {
    if (!preferenceStore) return;
    try {
      preferenceStore.save(preferenceStore.loadSync());
      preferenceMessage("设置已保存到本设备");
    } catch (error) {
      preferenceMessage(error.message || "设置保存失败，请重试");
    }
  });
  document.querySelector("[data-preference-reset]")?.addEventListener("click", () => {
    if (!preferenceStore) return;
    preferenceStore.reset();
    preferenceMessage("已恢复默认设置");
  });
  document.querySelector("[data-preference-clear]")?.addEventListener("click", () => {
    if (!preferenceStore || !window.confirm("清除本地主题、头像、空间和模型偏好吗？Provider 配置不会被删除。")) return;
    preferenceStore.clear();
    preferenceMessage("本地偏好已清除");
  });
  const backgroundFile = document.querySelector("[data-chat-background-file]");
  const backgroundPreview = document.querySelector("[data-chat-background-preview]");
  const backgroundSave = document.querySelector("[data-chat-background-save]");
  const backgroundResult = document.querySelector("[data-chat-background-result]");
  let pendingBackground = null;
  const showBackgroundResult = message => { if (backgroundResult) backgroundResult.textContent = message; };
  backgroundFile?.addEventListener("change", async () => {
    const file = backgroundFile.files?.[0];
    if (!file) return;
    if (!/^image\/(?:png|jpeg|webp)$/iu.test(file.type) || file.size > 12 * 1024 * 1024) {
      pendingBackground = null;
      if (backgroundSave) backgroundSave.disabled = true;
      showBackgroundResult("请选择 12MB 以内的 PNG、JPG 或 WebP 图片");
      return;
    }
    if (backgroundSave) backgroundSave.disabled = true;
    showBackgroundResult("正在压缩背景图片…");
    try {
      pendingBackground = await window.CompanionAvatarPicker?.optimizeImageFile?.(file, {
        windowRef: window,
        documentRef: document,
        maxDimension: 1600,
        quality: .8
      });
      if (!pendingBackground?.startsWith("data:image/") || pendingBackground.length > 2.8 * 1024 * 1024) {
        throw new Error("图片压缩后仍然过大，请选择更小的图片");
      }
      if (backgroundPreview) { backgroundPreview.hidden = false; backgroundPreview.style.backgroundImage = `url(${JSON.stringify(pendingBackground)})`; }
      if (backgroundSave) backgroundSave.disabled = false;
      showBackgroundResult("已预览，点击应用背景保存");
    } catch (error) {
      pendingBackground = null;
      showBackgroundResult(error.message || "背景图片处理失败，请重试");
    }
  });
  backgroundSave?.addEventListener("click", () => {
    if (!preferenceStore || !pendingBackground) return;
    try {
      preferenceStore.saveChatBackground({ imageData: pendingBackground, position: "center", size: "cover", overlay: .35 });
      showBackgroundResult("聊天背景已应用");
    } catch (error) {
      showBackgroundResult(error.message || "背景保存失败，请重试");
    }
  });
  document.querySelector("[data-chat-background-clear]")?.addEventListener("click", () => {
    if (!preferenceStore) return;
    try {
      preferenceStore.saveChatBackground({ imageData: null, position: "center", size: "cover", overlay: .35 });
      pendingBackground = null;
      if (backgroundPreview) { backgroundPreview.hidden = true; backgroundPreview.style.backgroundImage = "none"; }
      if (backgroundSave) backgroundSave.disabled = true;
      showBackgroundResult("聊天背景已清除");
    } catch (error) {
      showBackgroundResult(error.message || "背景清除失败，请重试");
    }
  });
  const configStore = window.AppConfig;
  const provider = window.AppProvider;
  const dialog = document.querySelector("[data-global-provider-dialog]");
  const providerPanel = window.CompanionProviderConfigPanel?.bind(dialog);
  const form = dialog?.querySelector("[data-provider-config-form]");
  const result = document.querySelector(".provider-result");
  const testButton = document.querySelector("[data-test-connection]");
  if (!configStore || !provider || !providerPanel || !form || !result || !testButton) return;

  const fields = providerPanel.fields;
  const storedConfig = configStore.getProviderConfig();
  try { preferenceStore?.saveModel(storedConfig.model); } catch { /* selectedModelId 仅为镜像 */ }
  providerPanel.fill({
    ...storedConfig,
    token: storedConfig.auth.token,
    enabled: storedConfig.mode === "real"
  });
  const modeLabel = document.querySelector("[data-provider-mode]");
  const currentModel = document.querySelector("[data-current-model]");
  const currentProvider = document.querySelector("[data-current-model-provider]");
  const configStatus = {
    provider: document.querySelector("[data-provider-configured]"),
    model: document.querySelector("[data-model-configured]"),
    token: document.querySelector("[data-token-configured]"),
    images: document.querySelector("[data-images-configured]")
  };
  const diagnosticResult = document.querySelector("[data-provider-diagnostic-result]");
  const providerNames = {
    dylan: "Dylan Gateway",
    gateway: "OpenAI-compatible Gateway",
    openai: "OpenAI",
    anthropic: "Anthropic-compatible"
  };

  const readFormConfig = () => ({
    type: fields.type.value,
    mode: fields.enabled.checked ? "real" : "mock",
    baseUrl: fields.baseUrl.value.trim(),
    endpoint: fields.endpoint.value.trim(),
    displayName: fields.displayName.value.trim(),
    model: fields.model.value.trim(),
    supportsImages: fields.supportsImages?.checked === true,
    auth: {
      type: "bearer",
      token: fields.token.value.trim()
    }
  });

  const showResult = (message, type) => {
    result.textContent = message;
    result.className = `provider-result ${type ? `is-${type}` : ""}`.trim();
  };
  const updateModeLabel = () => {
    if (modeLabel) modeLabel.textContent = fields.enabled.checked ? "REAL" : "MOCK";
  };
  const updateCurrentSummary = (config) => {
    const registeredModel = window.CompanionModelRegistry?.byRequestModel?.(config.model)
      || window.CompanionModelRegistry?.byId?.(config.model);
    if (currentModel) currentModel.textContent = config.displayName || registeredModel?.name || config.model || "Claude Opus 4.6";
    if (currentProvider) currentProvider.textContent = providerNames[config.type] || config.type || "Provider 未配置";
    if (configStatus.provider) configStatus.provider.textContent = config.type && config.baseUrl ? "已配置" : "未配置";
    if (configStatus.model) configStatus.model.textContent = config.model ? "已配置" : "未配置";
    if (configStatus.token) configStatus.token.textContent = config.auth?.token ? "已填写" : "未填写";
    if (configStatus.images) configStatus.images.textContent = config.supportsImages ? "已开启" : "未开启";
  };
  updateModeLabel();
  updateCurrentSummary(storedConfig);
  if (!storedConfig.baseUrl) showResult("未配置", "error");

  fields.enabled.addEventListener("change", updateModeLabel);
  const buildSafeDiagnostic = () => {
    const config = configStore.getProviderConfig();
    const preferences = preferenceStore?.loadSync?.();
    return {
      appVersion: window.CompanionP4BShell?.APP_VERSION || "v44",
      swCacheName: window.CompanionP4BShell?.SW_CACHE_NAME || "xinban-shell-v56-p4b",
      providerConfigured: Boolean(config.type && config.baseUrl),
      modelConfigured: Boolean(config.model),
      displayNameConfigured: Boolean(config.displayName),
      tokenConfigured: Boolean(config.auth?.token),
      supportsImages: config.supportsImages === true,
      badgeText: document.querySelector("[data-model-badge]")?.textContent?.trim()
        || currentModel?.textContent?.trim()
        || "",
      userAvatarExists: Boolean(preferenceStore?.getUserAvatarImage?.(preferences)),
      chenAvatarExists: Boolean(preferenceStore?.getChenAvatarImage?.(preferences)),
      sourceKey: "xinban-provider-config-v1"
    };
  };
  window.CompanionSettingsDiagnostics = Object.freeze({ build: buildSafeDiagnostic });
  document.querySelector("[data-copy-provider-diagnostic]")?.addEventListener("click", async () => {
    const diagnostic = JSON.stringify(buildSafeDiagnostic(), null, 2);
    try {
      await navigator.clipboard.writeText(diagnostic);
      if (diagnosticResult) diagnosticResult.textContent = "诊断信息已复制";
    } catch {
      if (diagnosticResult) diagnosticResult.textContent = "无法自动复制，请检查浏览器剪贴板权限";
    }
  });
  document.querySelector("[data-open-global-provider]")?.addEventListener("click", () => {
    const config = configStore.getProviderConfig();
    providerPanel.open({
      title: "配置聊天模型",
      values: {
        ...config,
        token: config.auth.token,
        enabled: config.mode === "real"
      }
    });
  });

  form.addEventListener("submit", (event) => {
    event.preventDefault();
    try {
      const config = configStore.saveProviderConfig(readFormConfig());
      try { preferenceStore?.saveModel(config.model); } catch { /* selectedModelId 仅为镜像 */ }
      updateCurrentSummary(config);
      updateModeLabel();
      showResult("模型配置已保存", "success");
      window.setTimeout(() => providerPanel.close(), 700);
    } catch (error) {
      showResult(error.message || "模型配置保存失败，请重试", "error");
    }
  });

  testButton.addEventListener("click", async () => {
    testButton.disabled = true;
    const originalLabel = testButton.textContent;
    testButton.textContent = "测试中…";
    try {
      const testResult = await provider.testConnection(readFormConfig());
      if (testResult.status === "unconfigured") {
        showResult("未配置", "error");
      } else if (testResult.status === "available") {
        showResult("Gateway 可用", "success");
      } else {
        showResult("网络错误", "error");
      }
    } finally {
      testButton.disabled = false;
      testButton.textContent = originalLabel;
    }
  });

  const memoryEndpoint = "https://api.xiaowo.homes/admin/memory/import";
  const memoryFileInput = document.querySelector("[data-memory-file]");
  const memoryDetails = document.querySelector("[data-memory-details]");
  const memoryPreview = document.querySelector("[data-memory-preview]");
  const memoryResult = document.querySelector("[data-memory-result]");
  const memorySummary = document.querySelector("[data-memory-summary]");
  const memoryButtons = [...document.querySelectorAll("[data-memory-import]")];
  if (!memoryFileInput || !memoryDetails || !memoryPreview || !memoryResult
    || !memorySummary || memoryButtons.length !== 2) return;

  let selectedMemoryData = null;
  let selectedMemoryCount = 0;

  const showMemoryResult = (message, type = "") => {
    memoryResult.textContent = message;
    memoryResult.className = `memory-import__result ${type ? `is-${type}` : ""}`.trim();
  };

  const formatFileSize = (bytes) => {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  };

  const getMemoryEntries = (data) => {
    if (Array.isArray(data)) return data;
    if (!data || typeof data !== "object") return [];
    const containers = ["memories", "items", "records", "data"];
    for (const key of containers) {
      if (Array.isArray(data[key])) return data[key];
    }
    if (Array.isArray(data.memory?.recent)) return data.memory.recent;
    return [data];
  };

  const getPreviewText = (entry) => {
    if (typeof entry === "string") return entry;
    if (entry === null || typeof entry !== "object") return String(entry);
    const value = entry.content ?? entry.text ?? entry.summary ?? entry.memory ?? entry.title;
    const text = value === undefined ? JSON.stringify(entry) : String(value);
    return text.length > 140 ? `${text.slice(0, 140)}…` : text;
  };

  const resetMemorySelection = () => {
    selectedMemoryData = null;
    selectedMemoryCount = 0;
    memoryDetails.hidden = true;
    memorySummary.hidden = true;
    memoryPreview.replaceChildren();
    memoryButtons.forEach((button) => { button.disabled = true; });
  };

  memoryFileInput.addEventListener("change", async () => {
    resetMemorySelection();
    showMemoryResult("");
    const [file] = memoryFileInput.files;
    if (!file) return;

    try {
      const parsedData = JSON.parse(await file.text());
      const entries = getMemoryEntries(parsedData);
      if (!entries.length) throw new Error("JSON 中没有可导入的记忆数据");

      selectedMemoryData = parsedData;
      selectedMemoryCount = entries.length;
      memoryDetails.querySelector("[data-memory-filename]").textContent = file.name;
      memoryDetails.querySelector("[data-memory-filesize]").textContent = formatFileSize(file.size);
      memoryDetails.querySelector("[data-memory-count]").textContent = String(entries.length);
      entries.slice(0, 3).forEach((entry) => {
        const item = document.createElement("li");
        item.textContent = getPreviewText(entry);
        memoryPreview.append(item);
      });
      memoryDetails.hidden = false;
      memoryButtons.forEach((button) => { button.disabled = false; });
      showMemoryResult("文件解析成功，请确认导入方式。", "success");
    } catch (error) {
      memoryFileInput.value = "";
      showMemoryResult(`文件解析失败：${error.message}`, "error");
    }
  });

  const readResponse = async (response) => {
    const text = await response.text();
    if (!text) return {};
    try {
      return JSON.parse(text);
    } catch {
      return { message: text };
    }
  };

  const getErrorMessage = (payload, status) => (
    payload?.error?.message
    || (typeof payload?.error === "string" ? payload.error : "")
    || payload?.message
    || `导入失败（HTTP ${status}）`
  );

  const importMemories = async (mode, activeButton) => {
    if (selectedMemoryData === null) return;
    const isReplace = mode === "replace";
    const confirmation = isReplace
      ? `严重警告：覆盖导入会替换当前全部记忆，并可能无法撤销。\n\n确认用文件中的 ${selectedMemoryCount} 条记忆覆盖现有数据吗？`
      : `确认合并导入 ${selectedMemoryCount} 条记忆吗？现有记忆将保留。`;
    if (!window.confirm(confirmation)) return;

    const token = configStore.getProviderConfig().auth?.token;
    if (!token) {
      showMemoryResult("未找到已保存的 Bearer Token，请先保存 Provider 配置。", "error");
      return;
    }

    memoryButtons.forEach((button) => { button.disabled = true; });
    memorySummary.hidden = true;
    const originalLabel = activeButton.textContent;
    activeButton.textContent = "导入中…";
    showMemoryResult("正在安全导入记忆…");

    try {
      const response = await fetch(memoryEndpoint, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`
        },
        body: JSON.stringify({ mode, data: selectedMemoryData })
      });
      const payload = await readResponse(response);
      if (!response.ok) throw new Error(getErrorMessage(payload, response.status));

      const importedCount = payload.importedCount ?? payload.imported_count
        ?? payload.imported ?? payload.count ?? selectedMemoryCount;
      const totalCount = payload.totalMemoryCount ?? payload.total_memory_count
        ?? payload.totalCount ?? payload.total_count ?? payload.total ?? "—";
      const backupFilename = payload.backupFilename ?? payload.backup_filename
        ?? payload.backupFile ?? payload.backup_file ?? "—";
      memorySummary.querySelector("[data-imported-count]").textContent = String(importedCount);
      memorySummary.querySelector("[data-total-memory-count]").textContent = String(totalCount);
      memorySummary.querySelector("[data-backup-filename]").textContent = String(backupFilename);
      memorySummary.hidden = false;
      showMemoryResult("记忆导入成功。", "success");
    } catch (error) {
      showMemoryResult(`记忆导入失败：${error.message}`, "error");
    } finally {
      activeButton.textContent = originalLabel;
      memoryButtons.forEach((button) => { button.disabled = false; });
    }
  };

  memoryButtons.forEach((button) => {
    button.addEventListener("click", () => importMemories(button.dataset.memoryImport, button));
  });
});
