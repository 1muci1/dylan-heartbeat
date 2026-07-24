"use strict";

((root, factory) => {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.CollaborationHistory = Object.freeze(api);
  if (typeof document !== "undefined") api.mount(document, root);
})(typeof window !== "undefined" ? window : null, () => {
  const HISTORY_API = "/api/collaboration/history";

  class CollaborationHistoryApiError extends Error {
    constructor(message, code = "COLLABORATION_HISTORY_API_FAILED") {
      super(message);
      this.name = "CollaborationHistoryApiError";
      this.code = code;
    }
  }

  const readApiConfig = appConfig => {
    const config = appConfig?.getProviderConfig?.();
    const baseUrl = String(config?.baseUrl || "").replace(/\/+$/, "");
    const token = config?.auth?.type === "bearer"
      ? String(config.auth.token || "").trim()
      : "";
    if (!baseUrl || !token) {
      throw new CollaborationHistoryApiError(
        "请先在设置中配置 Gateway 地址和 Bearer Token",
        "COLLABORATION_HISTORY_NOT_CONFIGURED"
      );
    }
    return { baseUrl, token };
  };

  const normalizeRecord = input => {
    if (
      !input ||
      typeof input !== "object" ||
      typeof input.id !== "string" ||
      typeof input.topic !== "string" ||
      typeof input.summary !== "string" ||
      !Array.isArray(input.participants) ||
      typeof input.createdAt !== "string"
    ) {
      throw new CollaborationHistoryApiError(
        "Gateway 返回了无效议事记录",
        "COLLABORATION_HISTORY_INVALID"
      );
    }
    return {
      id: input.id,
      roomId: typeof input.roomId === "string" ? input.roomId : null,
      topic: input.topic.trim(),
      participants: input.participants.filter(value => typeof value === "string")
        .map(value => value.trim()).filter(Boolean),
      summary: input.summary.trim(),
      createdAt: input.createdAt
    };
  };

  const createApiClient = ({ appConfig, fetchImpl } = {}) => {
    if (typeof fetchImpl !== "function") throw new TypeError("fetch 必填");
    const request = async path => {
      const config = readApiConfig(appConfig);
      let response;
      try {
        response = await fetchImpl(`${config.baseUrl}${path}`, {
          method: "GET",
          headers: { Authorization: `Bearer ${config.token}` },
          cache: "no-store"
        });
      } catch {
        throw new CollaborationHistoryApiError("无法连接议事厅历史服务");
      }
      let payload;
      try {
        payload = await response.json();
      } catch {
        throw new CollaborationHistoryApiError(
          "议事厅历史服务返回了无效数据",
          "COLLABORATION_HISTORY_INVALID_JSON"
        );
      }
      if (!response.ok || payload?.error) {
        throw new CollaborationHistoryApiError(
          payload?.error?.message || "议事厅历史请求失败",
          payload?.error?.code
        );
      }
      return payload;
    };
    return Object.freeze({
      async list() {
        const payload = await request(HISTORY_API);
        if (!Array.isArray(payload.records)) {
          throw new CollaborationHistoryApiError(
            "Gateway 返回了无效历史列表",
            "COLLABORATION_HISTORY_INVALID"
          );
        }
        return payload.records.map(normalizeRecord);
      },
      async get(id) {
        const payload = await request(`${HISTORY_API}/${encodeURIComponent(id)}`);
        return normalizeRecord(payload.record);
      }
    });
  };

  const formatDate = value => {
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return "时间未知";
    return new Intl.DateTimeFormat("zh-CN", {
      year: "numeric",
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit"
    }).format(date);
  };

  const renderHistoryItem = (documentRef, container, record, onSelect) => {
    const button = documentRef.createElement("button");
    button.type = "button";
    button.className = "history-item";
    button.dataset.historyId = record.id;
    const topic = documentRef.createElement("strong");
    topic.textContent = record.topic;
    const meta = documentRef.createElement("span");
    meta.textContent = `${record.participants.join(" · ")} · ${formatDate(record.createdAt)}`;
    const summary = documentRef.createElement("p");
    summary.textContent = record.summary;
    button.append(topic, meta, summary);
    button.addEventListener("click", () => onSelect(record.id));
    container.append(button);
    return button;
  };

  const renderDetail = (documentRef, record) => {
    const detail = documentRef.querySelector("[data-history-detail]");
    if (!detail) return;
    detail.hidden = false;
    const setText = (selector, value) => {
      const target = documentRef.querySelector(selector);
      if (target) target.textContent = value;
    };
    setText("[data-detail-topic]", record.topic);
    setText("[data-detail-created-at]", formatDate(record.createdAt));
    setText("[data-detail-summary]", record.summary);
    const participants = documentRef.querySelector("[data-detail-participants]");
    if (participants) {
      participants.replaceChildren();
      record.participants.forEach(agent => {
        const item = documentRef.createElement("span");
        item.className = "participant";
        item.textContent = agent;
        participants.append(item);
      });
    }
  };

  const mount = (documentRef, windowRef) => {
    const list = documentRef.querySelector("[data-history-list]");
    if (!list) return null;
    const client = createApiClient({
      appConfig: windowRef?.AppConfig,
      fetchImpl: windowRef?.fetch?.bind(windowRef)
    });
    const state = { records: [], selected: null };
    const status = documentRef.querySelector("[data-history-status]");
    const empty = documentRef.querySelector("[data-history-empty]");
    const setStatus = (message, error = false) => {
      if (!status) return;
      status.textContent = message;
      status.classList.toggle("is-error", error);
    };
    const showDetail = async id => {
      setStatus("正在读取会议详情…");
      try {
        state.selected = await client.get(id);
        renderDetail(documentRef, state.selected);
        setStatus("");
        documentRef.querySelector("[data-history-detail]")
          ?.scrollIntoView({ behavior: "smooth", block: "start" });
      } catch (error) {
        setStatus(error.message, true);
      }
    };
    const load = async () => {
      setStatus("正在读取议事记录…");
      try {
        state.records = await client.list();
        list.replaceChildren();
        state.records.forEach(record =>
          renderHistoryItem(documentRef, list, record, showDetail)
        );
        if (empty) empty.hidden = state.records.length > 0;
        setStatus(state.records.length ? `共 ${state.records.length} 条议事记录` : "");
      } catch (error) {
        state.records = [];
        list.replaceChildren();
        if (empty) empty.hidden = true;
        setStatus(error.message, true);
      }
    };
    documentRef.querySelector("[data-refresh-history]")?.addEventListener("click", load);
    void load();
    return state;
  };

  return {
    CollaborationHistoryApiError,
    HISTORY_API,
    createApiClient,
    formatDate,
    mount,
    normalizeRecord,
    readApiConfig,
    renderDetail,
    renderHistoryItem
  };
});
