// AI API 层：负责请求体、请求状态和流生命周期，连接细节交由 AppProvider。
(() => {
  const data = window.AppData;
  const messageProtocol = window.MessageProtocol;
  const provider = window.AppProvider;
  if (!data || !messageProtocol || !provider) return;

  const { MODEL_CONFIG } = data;
  const getModelConfig = () => {
    const providerConfig = window.AppConfig?.getProviderConfig?.() || {};
    return {
      ...MODEL_CONFIG,
      model: providerConfig.model || MODEL_CONFIG.model,
      supportsImages: providerConfig.supportsImages === true
    };
  };
  const loadingListeners = new Set();
  let isLoading = false;
  let activeStreamController = null;

  const setLoading = (nextLoading) => {
    isLoading = nextLoading;
    loadingListeners.forEach((listener) => listener(isLoading));
  };

  const onLoadingChange = (listener) => {
    if (typeof listener !== "function") return () => {};
    loadingListeners.add(listener);
    listener(isLoading);
    return () => loadingListeners.delete(listener);
  };

  const buildRequestBody = (history, stream = MODEL_CONFIG.stream, { imageMessageId = null, fileMessageId = null } = {}) => {
    const modelConfig = getModelConfig();
    return {
      model: modelConfig.model,
      messages: messageProtocol.toOpenAIMessages(history, {
        supportsImages: modelConfig.supportsImages,
        activeImageMessageId: imageMessageId,
        activeFileMessageId: fileMessageId
      }),
      stream
    };
  };

  const request = async (body, options = {}) => {
    setLoading(true);
    try {
      return await provider.send(body, options);
    } finally {
      setLoading(false);
    }
  };

  const getHistory = (message, options) => (
    Array.isArray(options.history) && options.history.length
      ? options.history
      : [messageProtocol.createUserMessage(message)]
  );

  const sendMessage = async (message, options = {}) => {
    const normalizedMessage = String(message || "").trim();
    if (!normalizedMessage) throw new TypeError("message 不能为空");
    return request(buildRequestBody(getHistory(normalizedMessage, options), false, {
      imageMessageId: options.imageMessageId
      ,fileMessageId: options.fileMessageId
    }), options);
  };

  const sendStreamMessage = async function* (message, options = {}) {
    const normalizedMessage = String(message || "").trim();
    if (!normalizedMessage) throw new TypeError("message 不能为空");

    activeStreamController?.abort();
    const controller = new AbortController();
    activeStreamController = controller;
    setLoading(true);

    try {
      const body = buildRequestBody(getHistory(normalizedMessage, options), true, {
        imageMessageId: options.imageMessageId
        ,fileMessageId: options.fileMessageId
      });
      for await (const chunk of provider.stream(body, {
        ...options,
        signal: controller.signal
      })) {
        if ((typeof chunk === "string" && chunk) || (chunk && typeof chunk.content === "string")) yield chunk;
      }
    } catch (error) {
      if (error?.code !== "ABORTED") throw error;
    } finally {
      if (activeStreamController === controller) activeStreamController = null;
      setLoading(false);
    }
  };

  const stopStream = () => activeStreamController?.abort();

  window.AppAPI = Object.freeze({
    request,
    sendMessage,
    sendStreamMessage,
    stopStream,
    buildRequestBody,
    onLoadingChange,
    get loading() {
      return isLoading;
    }
  });
})();
