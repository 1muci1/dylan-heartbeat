document.addEventListener("DOMContentLoaded", () => {
  const data = window.AppData;
  const store = window.AppStore;
  const api = window.AppAPI;
  const sessions = window.AppSessions;
  const messageProtocol = window.MessageProtocol;
  if (!data || !store || !api || !messageProtocol) return;

  const { ai, user } = data;
  const messageList = document.querySelector(".message-list");
  const messageContent = document.querySelector(".message-list__content");
  const composer = document.querySelector(".composer");
  const input = document.querySelector("#message-input");
  const sendButton = document.querySelector(".composer__send");
  const media = window.AppMedia;
  if (!messageList || !messageContent || !composer || !input || !sendButton) return;

  const setText = (selector, value) => {
    const element = document.querySelector(selector);
    if (element) element.textContent = value;
  };
  const scrollToLatest = () => {
    const previousBehavior = messageList.style.scrollBehavior;
    messageList.style.scrollBehavior = "auto";
    messageList.scrollTop = messageList.scrollHeight;
    requestAnimationFrame(() => {
      messageList.style.scrollBehavior = previousBehavior;
    });
  };

  const updateStatusLine = (text) => {
    const statusLine = document.querySelector(".chat-companion p");
    if (!statusLine) return;
    const dot = statusLine.querySelector(".online-dot");
    statusLine.replaceChildren(dot, text);
  };

  const setRequestState = (isLoading) => {
    composer.setAttribute("aria-busy", String(isLoading));
    messageList.setAttribute("aria-busy", String(isLoading));
    input.disabled = isLoading;
    sendButton.disabled = false;
    sendButton.setAttribute("aria-label", isLoading ? "停止生成" : "发送消息");
    updateStatusLine(isLoading ? `${ai.name}正在输入…` : `${ai.status} · ${ai.presence}`);
  };

  setText(".chat-avatar > span:last-child", ai.avatar.label);
  setText(".chat-companion h1", ai.name);
  updateStatusLine(`${ai.status} · ${ai.presence}`);
  setText(".conversation-note span", `这里是只属于${user.name}和${ai.name}的安静空间`);

  const createMessageElement = (message, isLast = false) => {
    const row = document.createElement("article");
    row.className = `message-row message-row--${message.role === "assistant" ? "ai" : "user"}`;
    row.dataset.messageId = message.id;
    if (isLast) row.classList.add("message-row--last");

    if (message.role === "assistant") {
      const avatar = document.createElement("div");
      avatar.className = "message-avatar";
      avatar.setAttribute("aria-hidden", "true");
      avatar.textContent = ai.avatar.label;
      row.append(avatar);
    }

    const group = document.createElement("div");
    group.className = "message-group";
    const bubble = document.createElement("div");
    bubble.className = "message-bubble";
    if (message.role === "assistant" && message.thinking) {
      const details = document.createElement("details"); details.className = "thinking-panel";
      const summary = document.createElement("summary"); summary.textContent = "思考过程";
      const thinking = document.createElement("div"); thinking.className = "thinking-content"; thinking.textContent = message.thinking;
      details.append(summary, thinking); group.append(details);
    }
    if (message.sticker?.url) {
      const image = document.createElement("img"); image.className = "message-sticker"; image.alt = message.sticker.label || "Sticker";
      media?.blobUrl(message.sticker.url).then(value => { image.src = value; }).catch(() => { image.alt = "Sticker 加载失败"; });
      bubble.append(image);
    }
    if (message.attachments?.length) {
      const gallery = document.createElement("div"); gallery.className = "message-images";
      message.attachments.forEach(attachment => { const link = document.createElement("a"); link.target = "_blank"; link.rel = "noopener"; const image = document.createElement("img"); image.alt = "聊天图片"; media?.blobUrl(attachment.url).then(value => { image.src = value; link.href = value; }).catch(() => { image.alt = "图片加载失败"; }); link.append(image); gallery.append(link); });
      bubble.append(gallery);
    }
    String(message.content || "").split("\n").filter(line => line || (!message.sticker && !message.attachments?.length)).forEach((line) => {
      const paragraph = document.createElement("p");
      paragraph.textContent = line;
      bubble.append(paragraph);
    });

    const time = document.createElement("time");
    time.dateTime = message.timestamp;
    time.textContent = message.time;
    group.append(bubble, time);
    row.append(group);
    return row;
  };

  const renderMessages = (messages) => {
    document.querySelectorAll(".message-row").forEach((row) => row.remove());
    setText(".time-divider span", messages.length ? `今天 ${messages[0].time}` : "今天");
    messages.forEach((message, index) => {
      messageContent.append(createMessageElement(message, index === messages.length - 1));
    });
    scrollToLatest();
  };

  const sessionToggle = document.querySelector("#session-toggle");
  const sessionDrawer = document.querySelector("#session-drawer");
  const sessionOverlay = document.querySelector(".session-overlay");
  const sessionClose = document.querySelector(".session-close");
  const sessionNew = document.querySelector(".session-new");
  const sessionList = document.querySelector(".session-list");
  const sessionStatus = document.querySelector(".session-status");
  const sessionFallback = document.querySelector(".session-fallback");
  let sessionApiAvailable = false;
  let activeSessionId = sessions?.getActiveId?.() || "";
  let serverSessions = [];
  const summaryText = document.querySelector("[data-summary-text]");
  const summaryMeta = document.querySelector("[data-summary-meta]");
  const aiStatus = document.querySelector("[data-session-ai-status]");
  const summaryButton = document.querySelector("[data-generate-summary]");
  const candidatesButton = document.querySelector("[data-generate-candidates]");

  const setAiStatus = (message, state = "") => {
    if (!aiStatus) return;
    aiStatus.textContent = message;
    aiStatus.dataset.state = state;
  };

  const aiErrorMessage = error => {
    const code = String(error?.code || "");
    if (["AI_MODEL_NOT_CONFIGURED","AI_MODEL_NAME_MISSING"].includes(code)) return "模型尚未配置，请联系管理员完成摘要和记忆模型配置。";
    if (code === "AI_MODEL_TIMEOUT" || code.startsWith("AI_UPSTREAM_")) return "模型上游调用失败，请稍后重试或由管理员检查连接配置。";
    if (code === "AI_OUTPUT_INVALID" || code.startsWith("AI_RESPONSE_")) return "模型返回格式不符合要求，本次结果未保存，请重试。";
    return error?.message || "手动 AI 任务失败，请稍后重试。";
  };

  const refreshAiConfiguration = async () => {
    try {
      const status = await sessions.modelStatus();
      const adapterReady = Boolean(status.adapterConfigured);
      if (summaryButton) summaryButton.disabled = !adapterReady || !status.summaryModelConfigured;
      if (candidatesButton) candidatesButton.disabled = !adapterReady || !status.memoryExtractionModelConfigured;
      if (!adapterReady || !status.summaryModelConfigured || !status.memoryExtractionModelConfigured) {
        setAiStatus("手动 AI 功能尚未完整配置，请联系管理员。", "warning");
      } else setAiStatus("模型已配置。自动功能关闭，仅在你点击时运行。", "ready");
    } catch (error) { setAiStatus(aiErrorMessage(error), "error"); }
  };

  const showSummary = async id => {
    if (!id) return;
    try {
      const value = await sessions.summary(id);
      summaryText.textContent = value?.summary || "当前还没有摘要。";
      summaryMeta.textContent = value ? `覆盖至消息 ${value.coveredUntilMessageId} · ${new Date(value.updatedAt).toLocaleString()}` : "";
    } catch (error) { setAiStatus(aiErrorMessage(error), "error"); }
  };

  const runSessionAi = async kind => {
    if (!activeSessionId || api.loading) { setAiStatus("请先选择服务器 Session。", "warning"); return; }
    const button = document.querySelector(kind === "summary" ? "[data-generate-summary]" : "[data-generate-candidates]");
    button.disabled = true; setAiStatus(kind === "summary" ? "正在生成摘要…" : "正在提取候选记忆…", "running");
    try {
      if (kind === "summary") { await sessions.generateSummary(activeSessionId); await showSummary(activeSessionId); setAiStatus("摘要生成成功。", "success"); }
      else { const result = await sessions.generateCandidates(activeSessionId); setAiStatus(`完成：新增 ${result.candidates.length} 条候选。`, "success"); }
    } catch (error) { setAiStatus(aiErrorMessage(error), "error"); }
    finally { button.disabled = false; }
  };
  let legacyMessages = [];

  const openSessions = (open) => {
    if (!sessionDrawer || !sessionOverlay || !sessionToggle) return;
    sessionDrawer.classList.toggle("is-open", open);
    sessionDrawer.setAttribute("aria-hidden", String(!open));
    sessionToggle.setAttribute("aria-expanded", String(open));
    sessionOverlay.hidden = !open;
  };

  const formatServerMessage = (message) => {
    const timestamp = message.createdAt || new Date().toISOString();
    const time = new Intl.DateTimeFormat("zh-CN", {
      hour: "2-digit", minute: "2-digit", hour12: false
    }).format(new Date(timestamp));
    return {
      id: `server-message-${message.id}`,
      role: message.role,
      content: message.content || (message.status === "error" ? "回复生成失败" : ""),
      time,
      timestamp,
      serverStatus: message.status
      ,thinking: message.thinking || null
      ,attachments: message.attachments || []
      ,sticker: message.sticker || null
      ,type: message.type || "text"
    };
  };

  const renderSessionList = () => {
    if (!sessionList) return;
    sessionList.replaceChildren();
    serverSessions.forEach((session) => {
      const item = document.createElement("div");
      item.className = "session-item";
      item.classList.toggle("is-active", session.id === activeSessionId);
      item.setAttribute("role", "listitem");
      const select = document.createElement("button");
      select.className = "session-item__select";
      select.type = "button";
      select.textContent = session.title;
      select.addEventListener("click", () => switchSession(session.id));
      const actions = document.createElement("div");
      actions.className = "session-item__actions";
      const rename = document.createElement("button");
      rename.type = "button";
      rename.textContent = "✎";
      rename.setAttribute("aria-label", `重命名${session.title}`);
      rename.addEventListener("click", () => renameSession(session));
      const remove = document.createElement("button");
      remove.type = "button";
      remove.textContent = "×";
      remove.setAttribute("aria-label", `删除${session.title}`);
      remove.addEventListener("click", () => deleteSession(session));
      actions.append(rename, remove);
      item.append(select, actions);
      sessionList.append(item);
    });
  };

  const useLocalFallback = () => {
    sessionApiAvailable = false;
    activeSessionId = "";
    if (sessionStatus) sessionStatus.textContent = "本地单会话模式";
    if (sessionFallback) sessionFallback.hidden = false;
    if (sessionNew) sessionNew.disabled = true;
    sessions?.setActiveId?.("");
  };

  async function switchSession(id) {
    if (!sessionApiAvailable || api.loading) return;
    try {
      const history = await sessions.messages(id);
      activeSessionId = id;
      sessions.setActiveId(id);
      const state = store.getState();
      state.messages = history.map(formatServerMessage).filter(message => message.content);
      store.saveState(state);
      renderMessages(state.messages);
      await showSummary(id);
      renderSessionList();
      openSessions(false);
    } catch {
      useLocalFallback();
    }
  }

  async function renameSession(session) {
    const title = window.prompt("新的会话名称", session.title)?.trim();
    if (!title || title === session.title) return;
    try {
      const updated = await sessions.rename(session.id, title);
      serverSessions = serverSessions.map(item => item.id === updated.id ? updated : item);
      renderSessionList();
    } catch { useLocalFallback(); }
  }

  async function deleteSession(session) {
    if (!window.confirm(`确定删除会话“${session.title}”及其服务器聊天历史吗？`)) return;
    try {
      await sessions.remove(session.id);
      serverSessions = serverSessions.filter(item => item.id !== session.id);
      if (activeSessionId === session.id) {
        activeSessionId = "";
        sessions.setActiveId("");
        const state = store.getState();
        state.messages = legacyMessages;
        store.saveState(state);
        renderMessages(state.messages);
      }
      renderSessionList();
    } catch { useLocalFallback(); }
  }

  const createSession = async () => {
    const title = window.prompt("给新会话起个名字", "新会话")?.trim();
    if (!title) return;
    try {
      const session = await sessions.create(title);
      serverSessions.unshift(session);
      renderSessionList();
      await switchSession(session.id);
    } catch { useLocalFallback(); }
  };

  const initializeSessions = async () => {
    if (!sessions) return useLocalFallback();
    try {
      serverSessions = await sessions.list();
      sessionApiAvailable = true;
      if (sessionStatus) sessionStatus.textContent = "服务器历史已连接";
      if (sessionFallback) sessionFallback.hidden = true;
      if (sessionNew) sessionNew.disabled = false;
      await refreshAiConfiguration();
      renderSessionList();
      if (activeSessionId && serverSessions.some(session => session.id === activeSessionId)) {
        await switchSession(activeSessionId);
      } else {
        activeSessionId = "";
        sessions.setActiveId("");
      }
    } catch { useLocalFallback(); }
  };

  const updateChatActivity = (state, message, time, timestamp) => {
    const chatActivity = {
      id: "activity-chat",
      type: "chat",
      title: "最近一次聊天",
      description: `你和${ai.name}聊了：“${message.slice(0, 18)}${message.length > 18 ? "…”" : "”"}`,
      time: `今天 ${time}`,
      timestamp
    };
    state.activities = [
      chatActivity,
      ...state.activities.filter((activity) => activity.type !== "chat")
    ].slice(0, 3);
  };

  const appendAndPersist = (message, updateState) => {
    const state = store.getState();
    state.messages.push(message);
    if (updateState) updateState(state);
    const savedState = messageProtocol.saveConversationHistory(state.messages, state);
    renderMessages(savedState.messages);
  };

  const requestAssistantReply = async (userMessage) => {
    const state = store.getState();
    const pendingMessage = messageProtocol.createAssistantMessage("…", { transient: true });
    document.querySelector(".message-row--last")?.classList.remove("message-row--last");
    const pendingRow = createMessageElement(pendingMessage, true);
    messageContent.append(pendingRow);
    const pendingText = pendingRow.querySelector(".message-bubble p");
    let completeReply = "";
    let completeThinking = "";
    scrollToLatest();

    try {
      for await (const chunk of api.sendStreamMessage(userMessage.content, {
        history: state.messages,
        chatCount: state.stats.chatCount,
        headers: sessionApiAvailable && activeSessionId
          ? { "X-Session-Id": activeSessionId }
          : {}
      })) {
        const event = typeof chunk === "string" ? { type: "content", content: chunk } : chunk;
        if (event.type === "thinking") {
          completeThinking += event.content;
          let panel = pendingRow.querySelector(".thinking-panel");
          if (!panel) { panel = document.createElement("details"); panel.className = "thinking-panel"; const summary = document.createElement("summary"); summary.textContent = "思考过程（生成中）"; const value = document.createElement("div"); value.className = "thinking-content"; panel.append(summary, value); pendingRow.querySelector(".message-group").prepend(panel); }
          panel.querySelector(".thinking-content").textContent = completeThinking;
          scrollToLatest();
          continue;
        }
        completeReply += event.content;
        pendingText.textContent = completeReply;
        scrollToLatest();
      }

      if (!completeReply) {
        pendingRow.remove();
        renderMessages(store.getState().messages);
        return;
      }

      const activeProvider = window.AppConfig?.getProviderConfig() || data.PROVIDER_CONFIG;
      const reply = messageProtocol.createAssistantMessage(completeReply, {
        provider: activeProvider.mode === "real" ? activeProvider.type : "mock",
        model: activeProvider.model || null,
        thinking: completeThinking || null
      });

      appendAndPersist(reply, (nextState) => {
        nextState.memory.count += 1;
        nextState.memory.recent.unshift({
          id: `memory-${reply.id}`,
          title: "一段新的陪伴对话",
          summary: completeReply,
          time: "刚刚"
        });
        nextState.memory.recent = nextState.memory.recent.slice(0, 5);
      });
    } catch (error) {
      pendingRow.remove();
      const errorMessage = messageProtocol.createAssistantMessage(
        error?.code === "CONFIG_ERROR"
          ? "连接还没有配置好，请稍后再试。"
          : "连接暂时中断了，请检查网络后再试。",
        { transient: true }
      );
      messageContent.querySelector(".message-row--last")?.classList.remove("message-row--last");
      messageContent.append(createMessageElement(errorMessage, true));
      updateStatusLine("连接遇到了一点问题");
      scrollToLatest();
    }
  };

  const picker = document.querySelector(".image-picker");
  const imageButton = document.querySelector(".composer__image");
  const tray = document.querySelector(".attachment-tray");
  const previews = document.querySelector(".attachment-previews");
  const uploadStatus = document.querySelector(".attachment-status");
  const stickerButton = document.querySelector(".composer__sticker");
  const stickerPanel = document.querySelector(".sticker-panel");
  const stickerGrid = document.querySelector(".sticker-grid");
  const stickerSearch = document.querySelector(".sticker-panel input");
  let pendingFiles = [];

  const renderPendingFiles = () => {
    previews?.replaceChildren(); tray.hidden = !pendingFiles.length;
    pendingFiles.forEach((file, index) => { const item = document.createElement("div"); item.className = "attachment-preview"; const img = document.createElement("img"); img.src = URL.createObjectURL(file); const remove = document.createElement("button"); remove.type = "button"; remove.textContent = "×"; remove.setAttribute("aria-label", "移除图片"); remove.onclick = () => { pendingFiles.splice(index, 1); renderPendingFiles(); }; item.append(img, remove); previews.append(item); });
  };
  const loadStickers = async () => {
    try { const items = await media.list(stickerSearch?.value || ""); stickerGrid.replaceChildren(); document.querySelector(".sticker-empty").hidden = Boolean(items.length); for (const sticker of items) { const button = document.createElement("button"); button.type = "button"; button.title = sticker.label || "Sticker"; const image = document.createElement("img"); image.alt = sticker.label || "Sticker"; media.blobUrl(sticker.url).then(value => image.src = value); button.append(image); button.onclick = () => sendSticker(sticker); stickerGrid.append(button); } } catch (error) { if (uploadStatus) uploadStatus.textContent = error.message; }
  };
  const sendSticker = sticker => {
    if (api.loading) return; stickerPanel.hidden = true; stickerButton.setAttribute("aria-expanded", "false");
    const message = messageProtocol.createUserMessage(`[Sticker: ${sticker.label || "Sticker"}]`, { type: "sticker", sticker });
    appendAndPersist(message, state => { state.stats.chatCount += 1; }); requestAssistantReply(message);
  };

  const handleSend = async () => {
    if (api.loading) {
      api.stopStream();
      return;
    }

    const content = input.value.trim();
    if (!content && !pendingFiles.length) return;

    let attachments = [];
    if (pendingFiles.length) {
      try { attachments = await media.uploadImages(pendingFiles, sessionApiAvailable ? activeSessionId : "", text => { if (uploadStatus) uploadStatus.textContent = text; }); }
      catch (error) { if (uploadStatus) uploadStatus.textContent = error.message; input.focus(); return; }
    }

    const message = messageProtocol.createUserMessage(content || "[图片]", { type: attachments.length ? "image" : "text", attachments });

    appendAndPersist(message, (state) => {
      state.stats.chatCount += 1;
      updateChatActivity(state, content, message.time, message.timestamp);
    });

    input.value = "";
    pendingFiles = []; renderPendingFiles();
    input.style.height = "";
    input.focus();
    requestAssistantReply(message);
  };

  const initialState = store.saveState(store.getState());
  legacyMessages = initialState.messages.map(message => ({ ...message }));
  renderMessages(initialState.messages);
  sessionToggle?.addEventListener("click", () => openSessions(!sessionDrawer?.classList.contains("is-open")));
  sessionClose?.addEventListener("click", () => openSessions(false));
  sessionOverlay?.addEventListener("click", () => openSessions(false));
  sessionNew?.addEventListener("click", createSession);
  document.querySelector("[data-generate-summary]")?.addEventListener("click", () => runSessionAi("summary"));
  document.querySelector("[data-generate-candidates]")?.addEventListener("click", () => runSessionAi("candidates"));
  initializeSessions();
  api.onLoadingChange(setRequestState);
  sendButton.addEventListener("click", handleSend);
  imageButton?.addEventListener("click", () => picker?.click());
  picker?.addEventListener("change", () => { const files = [...picker.files]; if (files.length + pendingFiles.length > 4) { if (uploadStatus) uploadStatus.textContent = "每次最多选择 4 张图片"; } else { pendingFiles.push(...files); renderPendingFiles(); } picker.value = ""; });
  stickerButton?.addEventListener("click", () => { stickerPanel.hidden = !stickerPanel.hidden; stickerButton.setAttribute("aria-expanded", String(!stickerPanel.hidden)); if (!stickerPanel.hidden) loadStickers(); });
  stickerSearch?.addEventListener("input", loadStickers);
  composer.addEventListener("submit", (event) => {
    event.preventDefault();
    handleSend();
  });
  input.addEventListener("keydown", (event) => {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      handleSend();
    }
  });
  input.addEventListener("input", () => {
    input.style.height = "auto";
    input.style.height = `${Math.min(input.scrollHeight, 96)}px`;
  });
});
