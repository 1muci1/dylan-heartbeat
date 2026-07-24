"use strict";

((root, factory) => {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.CollaborationRoom = Object.freeze(api);
  if (typeof document !== "undefined") api.mount(document, root);
})(typeof window !== "undefined" ? window : null, () => {
  const ROOMS_API = "/api/collaboration/rooms";
  const AGENTS = Object.freeze({
    chen: Object.freeze({ id: "chen", label: "沉", role: "AI Companion" }),
    chatgpt: Object.freeze({ id: "chatgpt", label: "ChatGPT", role: "协作 Agent" })
  });

  class CollaborationApiError extends Error {
    constructor(message, code = "COLLABORATION_API_FAILED") {
      super(message);
      this.name = "CollaborationApiError";
      this.code = code;
    }
  }

  const cleanTopic = value => String(value || "").trim().replace(/\s+/g, " ");
  const normalizeAgentIds = values => [...new Set(values || [])]
    .filter(value => Object.hasOwn(AGENTS, value));

  const readApiConfig = appConfig => {
    const config = appConfig?.getProviderConfig?.();
    const baseUrl = String(config?.baseUrl || "").replace(/\/+$/, "");
    const token = config?.auth?.type === "bearer"
      ? String(config.auth.token || "").trim()
      : "";
    if (!baseUrl || !token) {
      throw new CollaborationApiError(
        "请先在设置中配置 Gateway 地址和 Bearer Token",
        "COLLABORATION_API_NOT_CONFIGURED"
      );
    }
    return Object.freeze({ baseUrl, token });
  };

  const normalizeRoom = input => {
    if (!input || typeof input !== "object" || typeof input.id !== "string") {
      throw new CollaborationApiError("Gateway 返回了无效房间", "COLLABORATION_ROOM_INVALID");
    }
    const participants = normalizeAgentIds(input.participants);
    const messages = Array.isArray(input.messages)
      ? input.messages.flatMap(message => {
        const agent = AGENTS[message?.agent];
        const content = typeof message?.content === "string" ? message.content.trim() : "";
        if (!agent || !content) return [];
        return [{
          id: String(message.id || `${message.agent}-${input.messages.indexOf(message)}`),
          agent: agent.id,
          content,
          createdAt: typeof message.createdAt === "string" ? message.createdAt : null
        }];
      })
      : [];
    return {
      id: input.id,
      topic: cleanTopic(input.topic),
      participants,
      messages,
      summary: typeof input.summary === "string" && input.summary.trim()
        ? input.summary.trim()
        : null,
      createdAt: typeof input.createdAt === "string" ? input.createdAt : null
    };
  };

  const createApiClient = ({ appConfig, fetchImpl } = {}) => {
    if (typeof fetchImpl !== "function") throw new TypeError("fetch 必填");
    const request = async (path, { method = "GET", body } = {}) => {
      const config = readApiConfig(appConfig);
      let response;
      try {
        response = await fetchImpl(`${config.baseUrl}${path}`, {
          method,
          headers: {
            ...(body ? { "Content-Type": "application/json" } : {}),
            Authorization: `Bearer ${config.token}`
          },
          ...(body ? { body: JSON.stringify(body) } : {}),
          cache: "no-store"
        });
      } catch {
        throw new CollaborationApiError("无法连接 Collaboration 服务");
      }
      let payload;
      try {
        payload = await response.json();
      } catch {
        throw new CollaborationApiError(
          "Collaboration 服务返回了无效数据",
          "COLLABORATION_API_INVALID_JSON"
        );
      }
      if (!response.ok || payload?.error) {
        throw new CollaborationApiError(
          payload?.error?.message || "Collaboration 请求失败",
          payload?.error?.code
        );
      }
      return normalizeRoom(payload.room);
    };
    return Object.freeze({
      createRoom({ topic, participants }) {
        return request(ROOMS_API, {
          method: "POST",
          body: { topic: cleanTopic(topic), participants: normalizeAgentIds(participants) }
        });
      },
      runRoom(roomId) {
        return request(`${ROOMS_API}/${encodeURIComponent(roomId)}/run`, { method: "POST" });
      },
      getRoom(roomId) {
        return request(`${ROOMS_API}/${encodeURIComponent(roomId)}`);
      }
    });
  };

  const summarizeRoom = room => {
    if (room?.summary) return room.summary;
    if (!room?.messages?.length) return null;
    const speakers = [...new Set(room.messages.map(message => AGENTS[message.agent]?.label).filter(Boolean))];
    return `围绕「${room.topic}」已产生 ${room.messages.length} 条讨论消息，参与发言：${speakers.join("、")}。`;
  };

  const renderMessage = (documentRef, container, message) => {
    const agent = AGENTS[message.agent];
    if (!agent || !container || typeof documentRef?.createElement !== "function") return null;
    const article = documentRef.createElement("article");
    article.className = `message message--${agent.id}`;
    article.dataset.messageId = message.id;
    const avatar = documentRef.createElement("span");
    avatar.className = "message__avatar";
    avatar.setAttribute("aria-hidden", "true");
    avatar.textContent = agent.id === "chen" ? "沉" : "GPT";
    const body = documentRef.createElement("div");
    body.className = "message__body";
    const name = documentRef.createElement("strong");
    name.textContent = agent.label;
    const text = documentRef.createElement("p");
    text.textContent = message.content;
    body.append(name, text);
    article.append(avatar, body);
    container.append(article);
    return article;
  };

  const mount = (documentRef, windowRef) => {
    const form = documentRef.querySelector("[data-room-form]");
    if (!form) return null;
    const client = createApiClient({
      appConfig: windowRef?.AppConfig,
      fetchImpl: windowRef?.fetch?.bind(windowRef)
    });
    const state = { room: null, busy: false };
    const select = selector => documentRef.querySelector(selector);
    const setText = (selector, value) => {
      const target = select(selector);
      if (target) target.textContent = value;
    };
    const setRoomStatus = (message, error = false) => {
      const target = select("[data-room-status]");
      if (!target) return;
      target.textContent = message;
      target.classList.toggle("is-error", error);
    };
    const setBusy = busy => {
      state.busy = busy;
      const createButton = form.querySelector('button[type="submit"]');
      const runButton = select("[data-run-discussion]");
      if (createButton) createButton.disabled = busy;
      if (runButton) runButton.disabled = busy;
    };

    const renderRoom = () => {
      const room = state.room;
      const view = select("[data-room-view]");
      if (!room || !view) return;
      view.hidden = false;
      setText("[data-room-id]", room.id.slice(0, 8));
      setText("[data-room-topic]", room.topic);
      const participants = select("[data-participants]");
      if (participants) {
        participants.replaceChildren();
        room.participants.forEach(agentId => {
          const agent = AGENTS[agentId];
          const avatar = documentRef.createElement("span");
          avatar.className = `participant-avatar participant-avatar--${agent.id}`;
          avatar.title = `${agent.label} · ${agent.role}`;
          avatar.textContent = agent.id === "chen" ? "沉" : "GPT";
          participants.append(avatar);
        });
      }
      const messages = select("[data-message-list]");
      if (messages) {
        messages.replaceChildren();
        room.messages.forEach(message => renderMessage(documentRef, messages, message));
      }
      const empty = select("[data-empty-room]");
      if (empty) empty.hidden = room.messages.length > 0;
      const summaryButton = select("[data-generate-summary]");
      if (summaryButton) summaryButton.disabled = room.messages.length === 0 || state.busy;
      const summaryCard = select("[data-summary-card]");
      if (summaryCard) summaryCard.hidden = !room.summary;
      setText("[data-summary-text]", room.summary || "");
    };

    form.addEventListener("submit", async event => {
      event.preventDefault();
      const topic = cleanTopic(select("#discussion-topic")?.value);
      const participants = [...documentRef.querySelectorAll('input[name="agents"]:checked')]
        .map(input => input.value);
      if (!topic || topic.length > 240 || !normalizeAgentIds(participants).length) {
        setText("[data-form-status]", !topic ? "请输入讨论主题" : "至少选择一个参与 Agent");
        return;
      }
      setBusy(true);
      setText("[data-form-status]", "正在创建房间…");
      try {
        state.room = await client.createRoom({ topic, participants });
        setText("[data-form-status]", "");
        setRoomStatus("房间已连接 Gateway");
        renderRoom();
        select("[data-room-view]")?.scrollIntoView({ behavior: "smooth", block: "start" });
      } catch (error) {
        setText("[data-form-status]", error.message);
      } finally {
        setBusy(false);
        renderRoom();
      }
    });

    select("[data-run-discussion]")?.addEventListener("click", async () => {
      if (!state.room || state.busy) return;
      const roomBeforeRequest = state.room;
      setBusy(true);
      setRoomStatus("Agent 正在讨论…");
      try {
        await client.runRoom(state.room.id);
        state.room = await client.getRoom(state.room.id);
        setRoomStatus("本轮讨论已完成");
      } catch (error) {
        state.room = roomBeforeRequest;
        setRoomStatus(`${error.message}，当前房间内容已保留`, true);
      } finally {
        setBusy(false);
        renderRoom();
      }
    });

    select("[data-generate-summary]")?.addEventListener("click", async () => {
      if (!state.room || state.busy) return;
      try {
        state.room = await client.getRoom(state.room.id);
        const summary = summarizeRoom(state.room);
        const card = select("[data-summary-card]");
        if (card) card.hidden = !summary;
        setText("[data-summary-text]", summary || "");
      } catch (error) {
        setRoomStatus(`${error.message}，当前房间内容已保留`, true);
      }
    });

    return state;
  };

  return {
    AGENTS,
    CollaborationApiError,
    ROOMS_API,
    createApiClient,
    mount,
    normalizeRoom,
    readApiConfig,
    renderMessage,
    summarizeRoom
  };
});
