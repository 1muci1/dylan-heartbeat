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

  const OMITTED_IMAGE_TEXT = "[图片已省略：当前模型未启用图片理解]";
  const OMITTED_HISTORY_IMAGE_TEXT = "[历史图片已省略：避免重复发送图片上下文]";
  const toOpenAIMessages = (
    history = getConversationHistory(),
    { supportsImages = false, activeImageMessageId = null } = {}
  ) => normalizeHistory(history)
    .map(({ id, role, content, attachments, sticker }) => {
      if (role !== "user") return { role, content };
      if (Array.isArray(attachments) && attachments.length) {
        if (supportsImages && activeImageMessageId && id === activeImageMessageId) return {
          role,
          content: [
            ...(content && content !== "[图片]" ? [{ type: "text", text: content }] : []),
            ...attachments
              .filter(item => typeof item?.url === "string" && item.url)
              .map(item => ({ type: "image_url", image_url: { url: item.url } }))
          ]
        };
        const placeholder = supportsImages ? OMITTED_HISTORY_IMAGE_TEXT : OMITTED_IMAGE_TEXT;
        const text = content && content !== "[图片]" ? `${content}\n${placeholder}` : placeholder;
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
