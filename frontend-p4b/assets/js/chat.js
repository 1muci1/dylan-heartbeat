document.addEventListener("DOMContentLoaded", () => {
  const data = window.AppData;
  const store = window.AppStore;
  const api = window.AppAPI;
  const sessions = window.AppSessions;
  const messageProtocol = window.MessageProtocol;
  const ChatHistoryStore = window.ChatHistoryStore;
  const ChatSyncController = window.CompanionChatSync?.ChatSyncController;
  if (!data || !store || !api || !messageProtocol) return;

  const { ai, user } = data;
  const messageList = document.querySelector(".message-list");
  const messageContent = document.querySelector(".message-list__content");
  const composer = document.querySelector(".composer");
  const input = document.querySelector("#message-input");
  const sendButton = document.querySelector(".composer__send");
  const toast = document.querySelector(".chat-toast");
  const media = window.AppMedia;
  if (!messageList || !messageContent || !composer || !input || !sendButton) return;
  const GAME_SUMMARY_KEY = "xinban-recent-game-summary-v1";
  const recentGameContext = (() => {
    const fromGame = new URLSearchParams(window.location.search).get("fromGame");
    if (!["gomoku", "draw"].includes(fromGame)) return null;
    try {
      const value = JSON.parse(window.sessionStorage?.getItem(GAME_SUMMARY_KEY) || "null");
      if (!value || value.game !== fromGame) return null;
      const result = String(value.result || "").slice(0, 24);
      const lastMessage = String(value.lastMessage || "").trim().slice(0, 120);
      return { game: fromGame, result, lastMessage };
    } catch { return null; }
  })();
  const withRecentGameContext = history => {
    if (!recentGameContext || !Array.isArray(history)) return history;
    const gameName = recentGameContext.game === "gomoku" ? "五子棋" : "你画我猜";
    return [{
      role: "system",
      content: `用户刚从和沉玩的${gameName}页面回来。最近结果：${recentGameContext.result || "未记录"}；页面留言：${recentGameContext.lastMessage || "无"}。请自然接话，不要写入 Memory，不要声称自己决定了棋盘规则。`
    }, ...history];
  };

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

  let toastTimer = 0;
  const showToast = (message) => {
    if (!toast) return;
    window.clearTimeout(toastTimer);
    toast.textContent = message;
    toast.hidden = false;
    toast.classList.add("is-visible");
    toastTimer = window.setTimeout(() => {
      toast.classList.remove("is-visible");
      toast.hidden = true;
    }, 1600);
  };

  const actionIcons = {
    copy: '<rect x="8" y="8" width="11" height="11" rx="2"></rect><path d="M16 8V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h2"></path>',
    regenerate: '<path d="M20 7v5h-5"></path><path d="M18.5 15a7 7 0 1 1-.2-6.2L20 12"></path>',
    voice: '<path d="M5 10v4h3l4 4V6L8 10H5Z"></path><path d="M16 9a4 4 0 0 1 0 6M18.5 6.5a7.5 7.5 0 0 1 0 11"></path>',
    translate: '<circle cx="12" cy="12" r="9"></circle><path d="M3 12h18M12 3a14 14 0 0 1 0 18M12 3a14 14 0 0 0 0 18"></path>',
    more: '<circle cx="5" cy="12" r="1"></circle><circle cx="12" cy="12" r="1"></circle><circle cx="19" cy="12" r="1"></circle>',
    edit: '<path d="m4 20 4.2-1 10.6-10.6a2 2 0 0 0-2.8-2.8L5.4 16.2 4 20Z"></path><path d="m14.5 7.1 2.8 2.8"></path>',
    resend: '<path d="m4 12 16-7-6 14-2.5-5L4 12Z"></path><path d="m11.5 14 8.5-9"></path>'
  };

  const createActionBar = (message) => {
    const bar = document.createElement("div");
    bar.className = "message-actions";
    bar.setAttribute("role", "group");
    bar.setAttribute("aria-label", message.role === "assistant" ? "助理消息操作" : "用户消息操作");
    const actions = message.role === "assistant"
      ? [["copy", "复制"], ["regenerate", "重新生成"], ["voice", "语音播放"], ["translate", "翻译"], ["more", "更多"]]
      : [["copy", "复制"], ["edit", "编辑"], ["resend", "重新发送"], ["more", "更多"]];
    actions.forEach(([action, label]) => {
      const button = document.createElement("button");
      button.className = "message-action";
      button.type = "button";
      button.dataset.messageAction = action;
      button.setAttribute("aria-label", label);
      button.title = label;
      const icon = document.createElementNS("http://www.w3.org/2000/svg", "svg");
      icon.setAttribute("viewBox", "0 0 24 24");
      icon.setAttribute("aria-hidden", "true");
      icon.innerHTML = actionIcons[action];
      button.append(icon);
      bar.append(button);
    });
    return bar;
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

  const assistantPresentation = message => {
    if (message?.role !== "assistant") {
      return { content: String(message?.content || ""), gameLinks: [] };
    }
    const stickerParsed = media?.parseAssistantStickerDirectives?.(message.content)
      || { text: String(message.content || "") };
    const gameParsed = media?.parseAssistantGameLinks?.(stickerParsed.text)
      || { text: stickerParsed.text, gameLinks: [] };
    return {
      content: gameParsed.text,
      gameLinks: Array.isArray(message.gameLinks) && message.gameLinks.length
        ? message.gameLinks.slice(0, 2)
        : gameParsed.gameLinks
    };
  };
  const gameLinkLabel = href => href.includes("#gomoku")
    ? "去和沉下五子棋"
    : href.includes("#draw")
      ? "去玩你画我猜"
      : "打开游戏";

  const createMessageElement = (message, isLast = false) => {
    const row = document.createElement("article");
    row.className = `message-row message-row--${message.role === "assistant" ? "ai" : "user"}`;
    row.dataset.messageId = message.id;
    if (message.retryUserMessageId) row.dataset.retryUserMessageId = message.retryUserMessageId;
    if (isLast) row.classList.add("message-row--last");

    if (message.role === "assistant") {
      const avatar = document.createElement("div");
      avatar.className = "message-avatar message-avatar--assistant";
      avatar.setAttribute("aria-hidden", "true");
      const chenAvatarImage = window.CompanionChatAvatars?.getImage("chen");
      if (!window.CompanionChatAvatars?.applyTo(avatar, "chen", chenAvatarImage)) avatar.textContent = "沉";
      row.append(avatar);
    }

    const group = document.createElement("div");
    group.className = "message-group";
    const bubble = document.createElement("div");
    bubble.className = "message-bubble";
    const presentation = assistantPresentation(message);
    if (message.role === "assistant" && message.thinking) {
      const details = document.createElement("details"); details.className = "thinking-panel";
      const summary = document.createElement("summary"); summary.textContent = "思考过程";
      const thinking = document.createElement("div"); thinking.className = "thinking-content"; thinking.textContent = message.thinking;
      details.append(summary, thinking); group.append(details);
    }
    const messageStickers = [
      ...(message.sticker ? [message.sticker] : []),
      ...(Array.isArray(message.stickers) ? message.stickers : [])
    ].slice(0, 2);
    messageStickers.forEach(sticker => {
      if (!sticker?.url) return;
      const image = document.createElement("img");
      image.className = "message-sticker";
      image.alt = sticker.description || sticker.label || "Sticker";
      image.loading = "lazy";
      media?.blobUrl(sticker.url).then(value => { image.src = value; }).catch(() => { image.alt = "Sticker 加载失败"; });
      bubble.append(image);
    });
    presentation.gameLinks.forEach(href => {
      const link = document.createElement("a");
      link.className = "message-game-link";
      link.href = href;
      link.textContent = gameLinkLabel(href);
      link.setAttribute("aria-label", `${link.textContent}，站内游戏入口`);
      bubble.append(link);
    });
    if (message.attachments?.length) {
      const gallery = document.createElement("div"); gallery.className = "message-images";
      message.attachments.forEach(attachment => { const link = document.createElement("a"); link.target = "_blank"; link.rel = "noopener"; const image = document.createElement("img"); image.alt = "聊天图片"; media?.blobUrl(attachment.url).then(value => { image.src = value; link.href = value; }).catch(() => { image.alt = "图片加载失败"; }); link.append(image); gallery.append(link); });
      bubble.append(gallery);
    }
    if (message.files?.length) {
      const files = document.createElement("div"); files.className = "message-files";
      message.files.forEach(file => {
        const chip = document.createElement("span"); chip.className = "message-file";
        chip.textContent = `📎 ${file.name || "文件"}`;
        files.append(chip);
      });
      bubble.append(files);
    }
    presentation.content.split("\n").filter(line => line || (!message.sticker && !message.attachments?.length && !message.files?.length)).forEach((line) => {
      const paragraph = document.createElement("p");
      paragraph.textContent = line;
      bubble.append(paragraph);
    });

    const time = document.createElement("time");
    time.dateTime = message.timestamp;
    time.textContent = message.time;
    group.append(bubble, time);
    if (!message.actionsDisabled) group.append(createActionBar(message));
    row.append(group);
    if (message.role === "user") {
      const avatar = document.createElement("div");
      avatar.className = "message-avatar message-avatar--user";
      avatar.setAttribute("aria-hidden", "true");
      const userAvatarImage = window.CompanionChatAvatars?.getImage("user");
      if (!window.CompanionChatAvatars?.applyTo(avatar, "user", userAvatarImage)) avatar.textContent = "我";
      row.append(avatar);
    }
    return row;
  };

  const renderMessages = (messages) => {
    document.querySelectorAll(".message-row").forEach((row) => row.remove());
    setText(".time-divider span", messages.length ? `今天 ${messages[0].time}` : "今天");
    messages.forEach((message, index) => {
      messageContent.append(createMessageElement(message, index === messages.length - 1));
    });
    window.CompanionChatAvatars?.apply();
    window.CompanionChatPreferences?.apply();
    scrollToLatest();
    hydrateAssistantMessages(messages);
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
  let localHistory = null;
  let localHistorySessionId = "";
  let localCacheError = null;
  let chatSync = null;

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

  const showServerSyncStatus = () => {
    if (sessionStatus) {
      sessionStatus.textContent = localCacheError
        ? "本地缓存不可用，服务器同步仍可用"
        : "服务器历史已连接";
    }
    if (sessionFallback) sessionFallback.hidden = true;
    if (sessionNew) sessionNew.disabled = false;
  };

  const ensureServerSession = async () => {
    if (!sessions || !ChatSyncController) throw new Error("服务器 Session 同步组件不可用");
    if (!chatSync) {
      chatSync = new ChatSyncController({
        historyStore: localHistory,
        sessionApi: sessions,
        localSessionId: localHistorySessionId,
        mapMessage: formatServerMessage
      });
    }
    if (activeSessionId && chatSync.serverSessionId === activeSessionId) return activeSessionId;
    const ensured = await chatSync.ensureServerSession();
    if (ensured.cacheError && !localCacheError) {
      localCacheError = ensured.cacheError;
      console.warn("Chat 本地缓存不可用，继续使用服务器 Session 同步。", ensured.cacheError);
    }
    serverSessions = ensured.sessions;
    activeSessionId = ensured.serverSessionId;
    sessions.setActiveId(activeSessionId);
    sessionApiAvailable = true;
    showServerSyncStatus();
    renderSessionList();
    return activeSessionId;
  };

  async function switchSession(id) {
    if (!sessionApiAvailable || api.loading) return;
    try {
      const synchronized = chatSync
        ? await chatSync.select(id)
        : null;
      const history = synchronized
        ? synchronized.serverMessages
        : await sessions.messages(id);
      activeSessionId = id;
      sessions.setActiveId(id);
      const state = store.getState();
      state.messages = synchronized
        ? synchronized.messages
        : history.map(formatServerMessage).filter(message => message.content);
      store.saveState(state);
      renderMessages(state.messages);
      if (!synchronized) persistLocalMessages(state.messages);
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
        persistLocalMessages(state.messages);
        if (localHistory && localHistorySessionId) {
          await localHistory.updateSyncState(localHistorySessionId, {
            serverSessionId: null,
            lastServerMessageId: null,
            lastSyncedAt: null,
            syncState: "local-only"
          });
        }
        chatSync = null;
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
      await ensureServerSession();
      const synchronized = await chatSync.pull();
      if (synchronized.cacheError && !localCacheError) {
        localCacheError = synchronized.cacheError;
        console.warn("Chat 本地缓存不可用，继续使用服务器 Session 同步。", synchronized.cacheError);
      }
      const state = store.getState();
      state.messages = synchronized.messages;
      store.saveState(state);
      renderMessages(state.messages);
      sessionApiAvailable = true;
      showServerSyncStatus();
      await refreshAiConfiguration();
      renderSessionList();
    } catch (error) {
      console.warn("服务器 Session 初始化失败，进入本地单会话模式。", error);
      useLocalFallback();
    }
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
    persistLocalMessages(savedState.messages);
  };

  const initializeLocalHistory = async (initialMessages) => {
    if (!ChatHistoryStore) {
      localCacheError = new Error("ChatHistoryStore 未加载");
      console.warn("Chat 本地缓存不可用，仍将继续初始化服务器 Session。", localCacheError);
      return;
    }
    try {
      localHistory = new ChatHistoryStore();
      const recent = (await localHistory.listSessions())[0];
      const session = recent
        ? await localHistory.loadSession(recent.id)
        : await localHistory.createSession("最近会话");
      localHistorySessionId = session.id;
      if (session.messages.length) {
        const state = store.getState();
        state.messages = messageProtocol.saveConversationHistory(session.messages, state).messages;
        legacyMessages = state.messages.map(message => ({ ...message }));
        renderMessages(state.messages);
      } else {
        await localHistory.saveMessages(session.id, initialMessages);
      }
    } catch (error) {
      localCacheError = error;
      localHistory = null;
      localHistorySessionId = "";
      console.warn("Chat 本地缓存初始化失败，仍将继续初始化服务器 Session。", error);
    }
  };

  const persistLocalMessages = messages => {
    if (!localHistory || !localHistorySessionId) return;
    localHistory.saveMessages(localHistorySessionId, messages).catch(() => {});
  };

  const friendlySendError = (error, hasFiles = false) => {
    if (error?.code === "CONFIG_ERROR") return "连接还没有配置好，请稍后再试。";
    if (error?.code === "NETWORK_ERROR") return "网络暂时连不上，稍后再试。";
    if (error?.status === 401 || error?.status === 403) return "连接授权失效了，刷新后再试。";
    if (error?.status === 413) return "这次文件内容太大了，换个小一点的文件或删掉附件再试。";
    if (error?.status === 400 && hasFiles) return "这个附件暂时不能发送，删掉后再试。";
    if (error?.code === "INVALID_RESPONSE") return "回复中途断了一下，内容没有完整收到。";
    if (error?.status >= 500 || error?.code === "TIMEOUT") return "沉刚刚没有接住这条消息，稍后再试。";
    return "这次发送失败了，稍后再试。";
  };

  const requestAssistantReply = async (userMessage, requestHistory = null, options = {}) => {
    const state = store.getState();
    const history = withRecentGameContext(
      Array.isArray(requestHistory) ? requestHistory : state.messages
    );
    const pendingMessage = messageProtocol.createAssistantMessage("…", { transient: true, actionsDisabled: true });
    document.querySelector(".message-row--last")?.classList.remove("message-row--last");
    const pendingRow = createMessageElement(pendingMessage, true);
    messageContent.append(pendingRow);
    const pendingText = pendingRow.querySelector(".message-bubble p");
    let completeReply = "";
    let completeThinking = "";
    scrollToLatest();

    try {
      let serverSessionId = "";
      try {
        serverSessionId = await ensureServerSession();
      } catch (error) {
        console.warn("服务器 Session 创建或绑定失败，本次消息仅保存在本地。", error);
        useLocalFallback();
      }
      for await (const chunk of api.sendStreamMessage(userMessage.content, {
        history,
        imageMessageId: userMessage.attachments?.length ? userMessage.id : null,
        fileMessageId: userMessage.files?.length ? userMessage.id : null,
        chatCount: state.stats.chatCount,
        headers: serverSessionId
          ? { "X-Session-Id": serverSessionId }
          : {},
        timeoutMs: Number(options.timeoutMs) || 60000
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
      const normalizedReply = await normalizeAssistantMessage({ role: "assistant", content: completeReply });
      const reply = messageProtocol.createAssistantMessage(normalizedReply.content, {
        provider: activeProvider.mode === "real" ? activeProvider.type : "mock",
        model: activeProvider.model || null,
        thinking: completeThinking || null,
        stickers: normalizedReply.stickers,
        gameLinks: normalizedReply.gameLinks
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
      if (serverSessionId && chatSync && serverSessionId === chatSync.serverSessionId) {
        try {
          const synchronized = await chatSync.pull();
          const state = store.getState();
          state.messages = synchronized.messages;
          store.saveState(state);
          renderMessages(state.messages);
        } catch {
          // 保留刚写入 IndexedDB 的本地消息，下一次进入页面时再同步。
        }
      } else if (localHistory && localHistorySessionId) {
        localHistory.updateSyncState(localHistorySessionId, {
          syncState: "local-only"
        }).catch(() => {});
      }
    } catch (error) {
      pendingRow.remove();
      const friendlyMessage = friendlySendError(error, Boolean(userMessage.files?.length));
      options.onFailure?.(error);
      const errorMessage = messageProtocol.createAssistantMessage(
        friendlyMessage,
        { transient: true, retryUserMessageId: userMessage.id }
      );
      messageContent.querySelector(".message-row--last")?.classList.remove("message-row--last");
      messageContent.append(createMessageElement(errorMessage, true));
      updateStatusLine(friendlyMessage);
      scrollToLatest();
    } finally {
      if (pendingRow.isConnected) pendingRow.remove();
    }
  };

  const picker = document.querySelector(".image-picker");
  const filePicker = document.querySelector(".file-picker");
  const imageButton = document.querySelector(".composer__image");
  const fileButton = document.querySelector(".composer__file");
  const tray = document.querySelector(".attachment-tray");
  const previews = document.querySelector(".attachment-previews");
  const uploadStatus = document.querySelector(".attachment-status");
  const stickerButton = document.querySelector(".composer__sticker");
  const stickerPanel = document.querySelector(".sticker-panel");
  const stickerGrid = document.querySelector(".sticker-grid");
  const stickerSearch = document.querySelector(".sticker-panel input");
  let pendingFiles = [];
  let pendingDocuments = [];
  let stickerCache = [];
  let visibleStickerCount = 0;
  let stickerSearchTimer = 0;
  let stickerHydrationPending = false;
  const STICKER_PAGE_SIZE = 40;
  const supportsImages = () => window.AppConfig?.getProviderConfig?.().supportsImages === true;
  const formatFileSize = size => {
    const bytes = Number(size) || 0;
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${Math.ceil(bytes / 1024)} KiB`;
    return `${(bytes / 1024 / 1024).toFixed(1)} MiB`;
  };

  const clearPendingFiles = () => {
    pendingFiles = [];
    pendingDocuments = [];
    renderPendingFiles();
    if (picker) picker.value = "";
    if (filePicker) filePicker.value = "";
  };
  const renderPendingFiles = () => {
    previews?.replaceChildren(); tray.hidden = !pendingFiles.length && !pendingDocuments.length;
    pendingFiles.forEach((file, index) => { const item = document.createElement("div"); item.className = "attachment-preview"; const img = document.createElement("img"); img.src = URL.createObjectURL(file); const remove = document.createElement("button"); remove.type = "button"; remove.textContent = "×"; remove.setAttribute("aria-label", "移除图片"); remove.onclick = () => { pendingFiles.splice(index, 1); renderPendingFiles(); }; item.append(img, remove); previews.append(item); });
    pendingDocuments.forEach((file, index) => {
      const item = document.createElement("div"); item.className = "attachment-preview attachment-preview--file";
      const name = document.createElement("strong"); name.textContent = file.name || "文件";
      const meta = document.createElement("small");
      if (file.uploadState === "uploading") meta.textContent = `${formatFileSize(file.size)} · 上传中`;
      else if (file.uploadState === "error") meta.textContent = "上传失败，点此重试";
      else meta.textContent = file.canUseInChat
        ? `${formatFileSize(file.size)} · 可发送`
        : `${formatFileSize(file.size)} · 无法解析文字`;
      if (file.uploadState === "error") {
        item.classList.add("attachment-preview--error");
        item.tabIndex = 0; item.setAttribute("role", "button");
        item.onclick = event => {
          if (event.target.closest("button")) return;
          retryDocumentUpload(file.clientId);
        };
        item.onkeydown = event => {
          if (event.key === "Enter" || event.key === " ") { event.preventDefault(); retryDocumentUpload(file.clientId); }
        };
      }
      const remove = document.createElement("button"); remove.type = "button"; remove.textContent = "×";
      remove.setAttribute("aria-label", "移除文件");
      remove.onclick = () => { pendingDocuments.splice(index, 1); renderPendingFiles(); };
      item.append(name, meta, remove); previews.append(item);
    });
  };
  const uploadPendingDocument = async pending => {
    try {
      const uploaded = await media.uploadChatFile(pending.sourceFile);
      const current = pendingDocuments.find(file => file.clientId === pending.clientId);
      if (!current) return;
      Object.assign(current, uploaded, { uploadState: "ready", sourceFile: pending.sourceFile });
      if (uploadStatus) uploadStatus.textContent = current.canUseInChat
        ? "文件已准备好"
        : "文件已上传，但暂时不能提取文字";
    } catch {
      const current = pendingDocuments.find(file => file.clientId === pending.clientId);
      if (!current) return;
      current.uploadState = "error";
      if (uploadStatus) uploadStatus.textContent = "文件上传失败，可点击附件重试";
    }
    renderPendingFiles();
  };
  const retryDocumentUpload = clientId => {
    const pending = pendingDocuments.find(file => file.clientId === clientId);
    if (!pending || pending.uploadState !== "error") return;
    pending.uploadState = "uploading";
    if (uploadStatus) uploadStatus.textContent = "文件上传中…";
    renderPendingFiles();
    uploadPendingDocument(pending);
  };
  const renderStickerPage = reset => {
    const empty = document.querySelector(".sticker-empty");
    if (reset) {
      visibleStickerCount = 0;
      stickerGrid.replaceChildren();
    }
    const nextItems = stickerCache.slice(visibleStickerCount, visibleStickerCount + STICKER_PAGE_SIZE);
    visibleStickerCount += nextItems.length;
    empty.textContent = "暂无 Sticker";
    empty.hidden = Boolean(stickerCache.length);
    for (const sticker of nextItems) {
      const button = document.createElement("button"); button.type = "button";
      button.title = `${sticker.description || sticker.label || "Sticker"} ${sticker.tags || ""}`.trim();
      const image = document.createElement("img");
      image.alt = sticker.description || sticker.label || "Sticker";
      image.loading = "lazy";
      media.blobUrl(sticker.url).then(value => image.src = value).catch(() => { image.alt = "Sticker 加载失败"; });
      button.append(image); button.onclick = () => sendSticker(sticker); stickerGrid.append(button);
    }
  };
  const loadStickers = async () => {
    const empty = document.querySelector(".sticker-empty");
    const status = document.querySelector(".sticker-status");
    try {
      const items = await media.list(stickerSearch?.value || "");
      stickerCache = media.dedupeStickers ? media.dedupeStickers(items) : items;
      renderStickerPage(true);
      status.hidden = true;
    } catch {
      empty.hidden = Boolean(stickerCache.length);
      status.hidden = false;
      status.textContent = "表情包暂时没加载出来，稍后再试。";
    }
  };
  const normalizeAssistantMessage = async message => {
    if (message?.role !== "assistant") return message;
    const content = String(message.content || "");
    const parsed = media.parseAssistantStickerDirectives?.(content);
    const parsedGame = media.parseAssistantGameLinks?.(parsed?.text ?? content)
      || { text: parsed?.text ?? content, gameLinks: [] };
    if (!parsed?.keywords?.length) {
      return { ...message, content: parsedGame.text, gameLinks: parsedGame.gameLinks };
    }
    let available = stickerCache;
    try {
      available = await media.list("");
      stickerCache = media.dedupeStickers ? media.dedupeStickers(available) : available;
      available = stickerCache;
    } catch {
      // 使用上一次成功加载的 Sticker；directive 仍会从可见文本中安全移除。
    }
    const resolved = media.resolveAssistantStickers?.(content, available);
    const game = media.parseAssistantGameLinks?.(resolved?.text ?? parsed.text)
      || { text: resolved?.text ?? parsed.text, gameLinks: [] };
    const stickers = resolved?.stickers || [];
    const normalizedContent = game.text || (stickers.length || game.gameLinks.length
      ? ""
      : parsed.keywords.join("、"));
    return { ...message, content: normalizedContent, stickers, gameLinks: game.gameLinks };
  };
  const hydrateAssistantMessages = messages => {
    if (stickerHydrationPending || !Array.isArray(messages)
      || !messages.some(message => message.role === "assistant"
        && (media.parseAssistantStickerDirectives?.(message.content)?.keywords?.length
          || media.parseAssistantGameLinks?.(message.content)?.gameLinks?.length))) return;
    stickerHydrationPending = true;
    Promise.all(messages.map(async message => {
      const normalized = await normalizeAssistantMessage(message);
      if (normalized === message) return message;
      const changed = normalized.content !== message.content
        || JSON.stringify(normalized.stickers || []) !== JSON.stringify(message.stickers || [])
        || JSON.stringify(normalized.gameLinks || []) !== JSON.stringify(message.gameLinks || []);
      return changed ? normalized : message;
    })).then(nextMessages => {
      const changed = nextMessages.some((message, index) => message !== messages[index]);
      if (!changed) return;
      const state = store.getState();
      state.messages = nextMessages;
      const saved = messageProtocol.saveConversationHistory(nextMessages, state);
      persistLocalMessages(saved.messages);
      renderMessages(saved.messages);
    }).catch(() => {}).finally(() => { stickerHydrationPending = false; });
  };
  const sendSticker = sticker => {
    if (api.loading) return; stickerPanel.hidden = true; stickerButton.setAttribute("aria-expanded", "false");
    const description = String(sticker.description || sticker.label || "Sticker").trim().slice(0, 160);
    const tags = String(sticker.tags || "").trim().slice(0, 160);
    const semantic = `用户发送了一个表情：[Sticker: ${description}${tags ? `；标签：${tags}` : ""}]`;
    const message = messageProtocol.createUserMessage(semantic, { type: "sticker", sticker });
    appendAndPersist(message, state => { state.stats.chatCount += 1; });
    requestAssistantReply(message, null, { timeoutMs: 60000 });
  };

  const handleSend = async () => {
    if (api.loading) {
      api.stopStream();
      return;
    }

    const content = input.value.trim();
    if (!content && !pendingFiles.length && !pendingDocuments.length) return;
    if (pendingDocuments.some(file => file.uploadState === "uploading")) {
      if (uploadStatus) uploadStatus.textContent = "文件仍在上传，请稍候";
      return;
    }
    if (pendingDocuments.some(file => file.uploadState === "error")) {
      if (uploadStatus) uploadStatus.textContent = "请重试或移除上传失败的文件";
      return;
    }

    if (pendingFiles.length && !supportsImages()) {
      const message = "当前模型未启用图片理解。请到 模型设置 → 支持图片理解 开启后再发送图片。";
      if (uploadStatus) uploadStatus.textContent = message;
      showToast(message);
      input.focus();
      return;
    }

    let attachments = [];
    const draftImages = [...pendingFiles];
    const draftDocuments = pendingDocuments.map(file => ({ ...file }));
    if (pendingFiles.length) {
      try { attachments = await media.uploadImages(pendingFiles, sessionApiAvailable ? activeSessionId : "", text => { if (uploadStatus) uploadStatus.textContent = text; }); }
      catch { if (uploadStatus) uploadStatus.textContent = "图片上传失败，请稍后重试"; input.focus(); return; }
    }

    const fallbackContent = attachments.length ? "[图片]" : pendingDocuments.length
      ? `[文件：${pendingDocuments.map(file => file.name).join("、")}]`
      : "";
    const message = messageProtocol.createUserMessage(content || fallbackContent, {
      type: attachments.length ? "image" : pendingDocuments.length ? "file" : "text",
      attachments,
      files: pendingDocuments.map(({ fileId, name, mime, size, kind, canUseInChat, extractedTextPreview, extractedTextLength }) => (
        {
          fileId, name, mime, size, kind, canUseInChat,
          extractedTextPreview: String(extractedTextPreview || "").slice(0, 500),
          extractedTextLength: Number(extractedTextLength) || 0
        }
      ))
    });

    appendAndPersist(message, (state) => {
      state.stats.chatCount += 1;
      updateChatActivity(state, content, message.time, message.timestamp);
    });

    input.value = "";
    clearPendingFiles();
    input.style.height = "";
    input.focus();
    requestAssistantReply(message, null, {
      onFailure: () => {
        if (content && !input.value.includes(content)) {
          input.value = input.value.trim() ? `${content}\n${input.value}` : content;
          input.dispatchEvent(new Event("input"));
        }
        pendingFiles = [...draftImages, ...pendingFiles];
        const existingDocuments = new Set(pendingDocuments.map(file => file.fileId || file.clientId));
        pendingDocuments = [
          ...draftDocuments.filter(file => !existingDocuments.has(file.fileId || file.clientId)),
          ...pendingDocuments
        ];
        renderPendingFiles();
        if (uploadStatus) uploadStatus.textContent = "文件已经上传，但这次发送失败了，稍后再试。";
      }
    });
  };

  const findMessageContext = (messageId) => {
    const messages = store.getState().messages;
    const index = messages.findIndex(message => message.id === messageId);
    return { messages, index, message: index >= 0 ? messages[index] : null };
  };

  const copyText = async (text) => {
    const value = String(text || "");
    try {
      if (navigator.clipboard?.writeText) await navigator.clipboard.writeText(value);
      else {
        const helper = document.createElement("textarea");
        helper.value = value;
        helper.setAttribute("readonly", "");
        helper.className = "clipboard-helper";
        document.body.append(helper);
        helper.select();
        if (!document.execCommand("copy")) throw new Error("copy failed");
        helper.remove();
      }
      showToast("已复制");
    } catch {
      showToast("复制失败，请重试");
    }
  };

  const retryFromUserMessage = (userMessage, messages, index) => {
    if (!userMessage || userMessage.role !== "user") {
      showToast("找不到可重试的消息");
      return;
    }
    if (api.loading) {
      showToast("请等待当前回复完成");
      return;
    }
    requestAssistantReply(userMessage, messages.slice(0, index + 1));
  };

  messageContent.addEventListener("click", (event) => {
    const button = event.target.closest("[data-message-action]");
    const row = button?.closest(".message-row");
    if (!button || !row) return;
    const { messages, index, message } = findMessageContext(row.dataset.messageId);
    const action = button.dataset.messageAction;

    if (action === "copy") {
      copyText(message?.content || row.querySelector(".message-bubble")?.textContent);
      return;
    }
    if (action === "regenerate") {
      const retryId = message?.retryUserMessageId || row.dataset.retryUserMessageId;
      const userIndex = retryId
        ? messages.findIndex(item => item.id === retryId)
        : messages.slice(0, index).findLastIndex(item => item.role === "user");
      retryFromUserMessage(messages[userIndex], messages, userIndex);
      return;
    }
    if (action === "resend") {
      retryFromUserMessage(message, messages, index);
      return;
    }
    if (action === "edit") {
      if (!message || message.role !== "user") return;
      input.value = message.content;
      input.dispatchEvent(new Event("input"));
      input.focus();
      showToast("已放入输入框，可修改后发送");
      return;
    }
    if (action === "voice") {
      if (!message?.content || !("speechSynthesis" in window)) {
        showToast("当前浏览器不支持语音播放");
        return;
      }
      window.speechSynthesis.cancel();
      const utterance = new SpeechSynthesisUtterance(message.content);
      utterance.lang = "zh-CN";
      window.speechSynthesis.speak(utterance);
      showToast("正在播放");
      return;
    }
    showToast(action === "translate" ? "翻译功能即将开放" : "更多操作即将开放");
  });

  const initialState = store.saveState(store.getState());
  legacyMessages = initialState.messages.map(message => ({ ...message }));
  renderMessages(initialState.messages);
  sessionToggle?.addEventListener("click", () => openSessions(!sessionDrawer?.classList.contains("is-open")));
  sessionClose?.addEventListener("click", () => openSessions(false));
  sessionOverlay?.addEventListener("click", () => openSessions(false));
  sessionNew?.addEventListener("click", createSession);
  document.querySelector("[data-generate-summary]")?.addEventListener("click", () => runSessionAi("summary"));
  document.querySelector("[data-generate-candidates]")?.addEventListener("click", () => runSessionAi("candidates"));
  initializeLocalHistory(initialState.messages).finally(initializeSessions);
  api.onLoadingChange(setRequestState);
  sendButton.addEventListener("click", handleSend);
  imageButton?.addEventListener("click", () => picker?.click());
  fileButton?.addEventListener("click", () => filePicker?.click());
  picker?.addEventListener("change", () => {
    const files = [...picker.files];
    if (files.length + pendingFiles.length > 4) {
      if (uploadStatus) uploadStatus.textContent = "每次最多选择 4 张图片";
    } else {
      pendingFiles.push(...files);
      renderPendingFiles();
    }
    picker.value = "";
  });
  filePicker?.addEventListener("change", async () => {
    const files = [...filePicker.files];
    filePicker.value = "";
    if (!files.length) return;
    if (files.length + pendingDocuments.length > 5) {
      if (uploadStatus) uploadStatus.textContent = "每次最多选择 5 个文件";
      return;
    }
    if (uploadStatus) uploadStatus.textContent = "文件上传中…";
    const pending = files.map(file => ({
      clientId: crypto.randomUUID(), name: file.name, size: file.size,
      sourceFile: file, uploadState: "uploading"
    }));
    pendingDocuments.push(...pending);
    renderPendingFiles();
    await Promise.allSettled(pending.map(uploadPendingDocument));
  });
  stickerButton?.addEventListener("click", () => { stickerPanel.hidden = !stickerPanel.hidden; stickerButton.setAttribute("aria-expanded", String(!stickerPanel.hidden)); if (!stickerPanel.hidden) loadStickers(); });
  stickerPanel?.addEventListener("scroll", () => {
    if (stickerPanel.scrollTop + stickerPanel.clientHeight >= stickerPanel.scrollHeight - 48
      && visibleStickerCount < stickerCache.length) renderStickerPage(false);
  });
  stickerSearch?.addEventListener("input", () => {
    window.clearTimeout(stickerSearchTimer);
    stickerSearchTimer = window.setTimeout(loadStickers, 200);
  });
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
  const reapplyUiState = () => {
    window.CompanionModelSwitcher?.refresh?.(document);
    window.CompanionChatAvatars?.apply?.();
    window.CompanionChatPreferences?.apply?.();
  };
  window.addEventListener("pageshow", reapplyUiState);
  window.addEventListener("focus", reapplyUiState);
  window.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") reapplyUiState();
  });
  window.addEventListener("storage", reapplyUiState);
  window.addEventListener("provider-config-change", reapplyUiState);
  window.addEventListener("user-preferences-change", reapplyUiState);
});
