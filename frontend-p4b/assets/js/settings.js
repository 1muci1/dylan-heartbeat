document.addEventListener("DOMContentLoaded", () => {
  const configStore = window.AppConfig;
  const provider = window.AppProvider;
  const form = document.querySelector(".provider-form");
  const result = document.querySelector(".provider-result");
  const testButton = document.querySelector("[data-test-connection]");
  const debugButton = document.querySelector("[data-debug-request]");
  const debugPanel = document.querySelector(".provider-debug");
  if (!configStore || !provider || !form || !result || !testButton
    || !debugButton || !debugPanel) return;

  const fields = {
    baseUrl: form.elements.baseUrl,
    model: form.elements.model,
    token: form.elements.token,
    realMode: form.elements.realMode
  };
  const storedConfig = configStore.getProviderConfig();
  fields.baseUrl.value = storedConfig.baseUrl;
  fields.model.value = storedConfig.model;
  fields.token.value = storedConfig.auth.token;
  fields.realMode.checked = storedConfig.mode === "real";
  const modeLabel = document.querySelector("[data-provider-mode]");

  const readFormConfig = () => ({
    type: "dylan",
    mode: fields.realMode.checked ? "real" : "mock",
    baseUrl: fields.baseUrl.value.trim(),
    endpoint: "/v1/chat/completions",
    model: fields.model.value.trim(),
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
    if (modeLabel) modeLabel.textContent = fields.realMode.checked ? "REAL" : "MOCK";
  };
  updateModeLabel();
  if (!storedConfig.baseUrl) showResult("未配置", "error");

  fields.realMode.addEventListener("change", updateModeLabel);

  form.addEventListener("submit", (event) => {
    event.preventDefault();
    const config = configStore.saveProviderConfig(readFormConfig());
    showResult(
      config.mode === "real" ? "配置已保存，真实模式已开启。" : "配置已保存，当前为 mock 模式。",
      "success"
    );
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

  debugButton.addEventListener("click", async () => {
    configStore.saveProviderConfig(readFormConfig());
    debugButton.disabled = true;
    const originalLabel = debugButton.textContent;
    debugButton.textContent = "请求中…";
    debugPanel.hidden = false;

    try {
      const debugResult = await provider.debugRequest();
      debugPanel.querySelector("[data-debug-url]").textContent = debugResult.url || "—";
      debugPanel.querySelector("[data-debug-status]").textContent = debugResult.status || "未发送";
      debugPanel.querySelector("[data-debug-structure]").textContent = JSON.stringify(
        debugResult.structure,
        null,
        2
      );
      debugPanel.querySelector("[data-debug-sse]").textContent = debugResult.sse ? "正常" : "否";
      showResult(debugResult.status ? "真实请求调试完成" : "真实请求未发送", debugResult.status ? "success" : "error");
    } finally {
      debugButton.disabled = false;
      debugButton.textContent = originalLabel;
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
