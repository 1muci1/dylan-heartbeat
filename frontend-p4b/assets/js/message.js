// AI 消息协议层：负责本地消息结构、会话保存和 OpenAI 格式转换。
(() => {
  const store = window.AppStore;
  if (!store) return;

  const validRoles = new Set(["system", "user", "assistant"]);
  const formatTime = (date) => new Intl.DateTimeFormat("zh-CN", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false
  }).format(date);

  const createId = (role) => {
    const randomId = window.crypto?.randomUUID?.()
      || `${Date.now()}-${Math.random().toString(16).slice(2)}`;
    return `message-${role}-${randomId}`;
  };

  const createMessage = (role, content, metadata = {}) => {
    const normalizedContent = String(content || "").trim();
    if (!validRoles.has(role)) throw new TypeError(`不支持的消息角色：${role}`);
    if (!normalizedContent) throw new TypeError("消息内容不能为空");

    const now = new Date();
    return {
      id: metadata.id || createId(role),
      role,
      content: normalizedContent,
      time: metadata.time || formatTime(now),
      timestamp: metadata.timestamp || now.toISOString(),
      ...metadata
    };
  };

  const createUserMessage = (content, metadata) => createMessage("user", content, metadata);
  const createAssistantMessage = (content, metadata) => createMessage("assistant", content, metadata);

  const normalizeHistory = (history) => {
    if (!Array.isArray(history)) return [];
    return history
      .filter((message) => validRoles.has(message?.role) && String(message?.content || "").trim())
      .map((message) => createMessage(message.role, message.content, message));
  };

  const saveConversationHistory = (history, currentState = store.getState()) => {
    currentState.messages = normalizeHistory(history);
    return store.saveState(currentState);
  };

  const getConversationHistory = () => normalizeHistory(store.getState().messages);

  const OMITTED_IMAGE_TEXT = "[图片已省略：当前模型未启用多模态]";
  const toOpenAIMessages = (history = getConversationHistory()) => normalizeHistory(history)
    .map(({ role, content, attachments, sticker }) => {
      if (role !== "user") return { role, content };
      if (Array.isArray(attachments) && attachments.length) {
        const text = content && content !== "[图片]" ? `${content}\n${OMITTED_IMAGE_TEXT}` : OMITTED_IMAGE_TEXT;
        return { role, content: text };
      }
      if (sticker?.id) return { role, content: content || `[Sticker: ${sticker.label || "Sticker"}]` };
      return { role, content };
    });

  window.MessageProtocol = Object.freeze({
    createUserMessage,
    createAssistantMessage,
    saveConversationHistory,
    getConversationHistory,
    toOpenAIMessages
  });
})();
