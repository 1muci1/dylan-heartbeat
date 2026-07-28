// AI Provider 适配层：负责选择提供方、构造请求并解析普通或流式响应。
(() => {
  const data = window.AppData;
  if (!data) return;

  const { ai, API_MODE, API_CONFIG, PROVIDER_CONFIG, mockReplies } = data;
  const getProviderConfig = () => window.AppConfig?.getProviderConfig() || PROVIDER_CONFIG;

  class ProviderError extends Error {
    constructor(message, { code = "PROVIDER_ERROR", status = 0, cause } = {}) {
      super(message, { cause });
      this.name = "ProviderError";
      this.code = code;
      this.status = status;
    }
  }

  const createRequestControl = (options = {}) => {
    const controller = new AbortController();
    let timedOut = false;
    const abortFromCaller = () => controller.abort();
    if (options.signal?.aborted) controller.abort();
    options.signal?.addEventListener("abort", abortFromCaller, { once: true });
    const timeoutId = window.setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, options.timeoutMs || API_CONFIG.timeoutMs);

    return {
      controller,
      get timedOut() {
        return timedOut;
      },
      cleanup() {
        window.clearTimeout(timeoutId);
        options.signal?.removeEventListener("abort", abortFromCaller);
      }
    };
  };

  const wait = (duration, signal) => new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(new ProviderError("生成已停止", { code: "ABORTED" }));
      return;
    }
    const timeoutId = window.setTimeout(() => {
      signal?.removeEventListener("abort", handleAbort);
      resolve();
    }, duration);
    const handleAbort = () => {
      window.clearTimeout(timeoutId);
      reject(new ProviderError("生成已停止", { code: "ABORTED" }));
    };
    signal?.addEventListener("abort", handleAbort, { once: true });
  });

  const buildUrlFromConfig = (config) => {
    const baseUrl = config.baseUrl.replace(/\/$/, "");
    if (!baseUrl) {
      throw new ProviderError("Provider 地址尚未配置", { code: "CONFIG_ERROR" });
    }
    const endpoint = config.endpoint.startsWith("/")
      ? config.endpoint
      : `/${config.endpoint}`;
    return `${baseUrl}${endpoint}`;
  };

  const buildUrl = () => buildUrlFromConfig(getProviderConfig());

  const buildHeaders = (extraHeaders = {}) => {
    const config = getProviderConfig();
    const headers = { "Content-Type": "application/json", ...extraHeaders };
    if (config.auth?.type === "bearer" && config.auth.token) {
      headers.Authorization = `Bearer ${config.auth.token}`;
    }
    return headers;
  };

  const logRealRequest = (body) => {
    const config = getProviderConfig();
    console.info("[AppProvider] Dylan 请求配置", {
      baseUrl: config.baseUrl,
      model: String(body?.model || ""),
      hasBearerToken: Boolean(config.auth?.type === "bearer" && config.auth.token)
    });
  };

  const parseResponse = (payload) => {
    const config = getProviderConfig();
    const choice = payload?.choices?.[0];
    const content = choice?.message?.content;
    if (typeof content !== "string" || !content.trim()) {
      throw new ProviderError("Provider 返回了无法识别的消息格式", {
        code: "INVALID_RESPONSE"
      });
    }
    return {
      role: choice.message.role || "assistant",
      content,
      provider: config.type,
      model: payload.model || null,
      finishReason: choice.finish_reason || null
    };
  };

  const normalizeRequestError = (error, control) => {
    if (error instanceof ProviderError) return error;
    if (error.name === "AbortError") {
      return new ProviderError(
        control.timedOut ? "请求超时，请稍后再试" : "生成已停止",
        { code: control.timedOut ? "TIMEOUT" : "ABORTED", cause: error }
      );
    }
    return new ProviderError("网络连接不可用，请检查后重试", {
      code: "NETWORK_ERROR",
      cause: error
    });
  };

  const readPayload = async (response) => {
    const contentType = response.headers.get("content-type") || "";
    return contentType.includes("application/json")
      ? response.json()
      : response.text();
  };

  const ensureSuccessfulResponse = async (response) => {
    if (response.ok) return;
    const payload = await readPayload(response);
    const serverMessage = typeof payload === "object"
      ? payload?.error?.message || payload?.message
      : payload;
    throw new ProviderError(serverMessage || `请求失败（${response.status}）`, {
      code: "HTTP_ERROR",
      status: response.status
    });
  };

  const sendMock = async (options = {}) => {
    await wait(ai.statusConfig.replyDelayMs, options.signal);
    const replyIndex = Number(options.chatCount || 0) % mockReplies.length;
    return {
      role: "assistant",
      content: mockReplies[replyIndex],
      provider: "mock",
      model: null,
      finishReason: "stop"
    };
  };

  const streamMock = async function* (options = {}) {
    await wait(Math.min(ai.statusConfig.replyDelayMs, 320), options.signal);
    const replyIndex = Number(options.chatCount || 0) % mockReplies.length;
    for (const character of Array.from(mockReplies[replyIndex])) {
      await wait(24, options.signal);
      yield character;
    }
  };

  const sendHttp = async (body, options = {}) => {
    const control = createRequestControl(options);
    try {
      logRealRequest(body);
      const response = await fetch(buildUrl(), {
        method: "POST",
        headers: buildHeaders(options.headers),
        body: JSON.stringify(body),
        signal: control.controller.signal
      });
      await ensureSuccessfulResponse(response);
      const payload = await readPayload(response);
      if (typeof payload !== "object") {
        throw new ProviderError("Provider 未返回 JSON 响应", { code: "INVALID_RESPONSE" });
      }
      return parseResponse(payload);
    } catch (error) {
      throw normalizeRequestError(error, control);
    } finally {
      control.cleanup();
    }
  };

  const streamHttp = async function* (body, options = {}) {
    const control = createRequestControl(options);
    try {
      logRealRequest(body);
      const response = await fetch(buildUrl(), {
        method: "POST",
        headers: buildHeaders({
          Accept: "text/event-stream",
          ...options.headers
        }),
        body: JSON.stringify(body),
        signal: control.controller.signal
      });
      await ensureSuccessfulResponse(response);

      const contentType = (response.headers.get("content-type") || "").toLowerCase();
      if (!contentType.includes("text/event-stream")) {
        const payload = await readPayload(response);
        yield parseResponse(payload).content;
        return;
      }

      if (!response.body) {
        throw new ProviderError("浏览器未提供流式响应体", { code: "INVALID_RESPONSE" });
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      let streamFinished = false;

      const parseEvent = (event) => {
        const chunks = [];
        const dataLines = event.split(/\r?\n/)
          .filter((line) => line.startsWith("data:"))
          .map((line) => line.slice(5).trim());

        for (const dataLine of dataLines) {
          if (!dataLine) continue;
          if (dataLine === "[DONE]") {
            streamFinished = true;
            break;
          }
          try {
            const payload = JSON.parse(dataLine);
            const delta = payload?.choices?.[0]?.delta || {};
            const reasoning = delta.reasoning_content ?? delta.reasoning ?? delta.thinking;
            if (typeof reasoning === "string" && reasoning) chunks.push({ type: "thinking", content: reasoning });
            if (typeof delta.content === "string" && delta.content) chunks.push({ type: "content", content: delta.content });
          } catch (error) {
            throw new ProviderError("Provider 返回了无法解析的 SSE 数据", {
              code: "INVALID_RESPONSE",
              cause: error
            });
          }
        }
        return chunks;
      };

      while (!streamFinished) {
        const { done, value } = await reader.read();
        if (done) {
          buffer += decoder.decode();
          break;
        }
        buffer += decoder.decode(value, { stream: true });

        const events = buffer.split(/\r?\n\r?\n/);
        buffer = events.pop() || "";
        for (const event of events) {
          for (const chunk of parseEvent(event)) yield chunk;
          if (streamFinished) break;
        }
      }

      if (!streamFinished && buffer.trim()) {
        for (const chunk of parseEvent(buffer)) yield chunk;
      }
    } catch (error) {
      throw normalizeRequestError(error, control);
    } finally {
      control.cleanup();
    }
  };

  const validateBody = (body) => {
    if (!body || !Array.isArray(body.messages)) {
      throw new ProviderError("请求体缺少 messages", { code: "VALIDATION_ERROR" });
    }
    if (!isMockMode() && !String(body.model || "").trim()) {
      throw new ProviderError("真实模式尚未配置模型 ID", { code: "CONFIG_ERROR" });
    }
  };

  const isRemoteProvider = () => {
    const config = getProviderConfig();
    return ["dylan", "openai", "anthropic", "gateway"].includes(config.type);
  };
  const isMockMode = () => (getProviderConfig().mode || API_MODE) !== "real";

  const send = async (body, options = {}) => {
    const config = getProviderConfig();
    validateBody(body);
    if (isMockMode()) return sendMock(options);
    if (isRemoteProvider()) return sendHttp(body, options);
    throw new ProviderError(`不支持的 Provider：${config.type}`, {
      code: "UNSUPPORTED_PROVIDER"
    });
  };

  const stream = async function* (body, options = {}) {
    const config = getProviderConfig();
    validateBody(body);
    if (isMockMode()) {
      yield* streamMock(options);
      return;
    }
    if (isRemoteProvider()) {
      yield* streamHttp(body, options);
      return;
    }
    throw new ProviderError(`不支持的 Provider：${config.type}`, {
      code: "UNSUPPORTED_PROVIDER"
    });
  };

  const testConnection = async (overrides = {}) => {
    const current = getProviderConfig();
    const config = {
      ...current,
      ...overrides,
      auth: { ...current.auth, ...(overrides.auth || {}) }
    };
    let parsedUrl;
    try {
      parsedUrl = new URL(config.baseUrl);
    } catch {
      return { status: "unconfigured" };
    }
    if (!['https:', 'http:'].includes(parsedUrl.protocol)
      || !String(config.endpoint || "").startsWith("/")) {
      return { status: "unconfigured" };
    }

    const control = createRequestControl({ timeoutMs: 8000 });
    const headers = {};
    if (config.auth.type === "bearer" && config.auth.token) {
      headers.Authorization = `Bearer ${config.auth.token}`;
    }

    try {
      const response = await fetch(buildUrlFromConfig(config), {
        method: "HEAD",
        headers,
        cache: "no-store",
        signal: control.controller.signal
      });
      return {
        status: response.ok || [400, 405].includes(response.status)
          ? "available"
          : "network-error"
      };
    } catch {
      return { status: "network-error" };
    } finally {
      control.cleanup();
    }
  };

  const inspectSSE = async (response) => {
    if (!response.body) {
      return {
        structure: { format: "sse", validEvents: 0, deltaContent: false, doneReceived: false },
        valid: false
      };
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    let validEvents = 0;
    let deltaContent = false;
    let doneReceived = false;

    const inspectEvent = (event) => {
      event.split(/\r?\n/)
        .filter((line) => line.startsWith("data:"))
        .map((line) => line.slice(5).trim())
        .forEach((dataLine) => {
          if (dataLine === "[DONE]") {
            doneReceived = true;
            return;
          }
          if (!dataLine) return;
          try {
            const payload = JSON.parse(dataLine);
            validEvents += 1;
            if (payload?.choices?.[0]?.delta
              && Object.prototype.hasOwnProperty.call(payload.choices[0].delta, "content")) {
              deltaContent = true;
            }
          } catch {
            // 调试结果会通过 validEvents 反映无法解析的事件。
          }
        });
    };

    while (!doneReceived) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const events = buffer.split(/\r?\n\r?\n/);
      buffer = events.pop() || "";
      events.forEach(inspectEvent);
    }
    if (buffer.trim()) inspectEvent(buffer);

    return {
      structure: {
        format: "sse",
        validEvents,
        deltaContent,
        doneReceived
      },
      valid: validEvents > 0 && deltaContent && doneReceived
    };
  };

  const summarizeJson = (payload) => ({
    format: "json",
    topLevelKeys: payload && typeof payload === "object" ? Object.keys(payload) : [],
    hasChoices: Array.isArray(payload?.choices),
    messageContent: typeof payload?.choices?.[0]?.message?.content === "string"
  });

  const debugRequest = async () => {
    const config = getProviderConfig();
    let url = "";
    try {
      url = buildUrlFromConfig(config);
      new URL(url);
    } catch {
      return {
        url,
        status: 0,
        structure: { format: "error", code: "CONFIG_ERROR" },
        sse: false
      };
    }
    if (!config.model) {
      return {
        url,
        status: 0,
        structure: { format: "error", code: "MODEL_NOT_CONFIGURED" },
        sse: false
      };
    }

    const control = createRequestControl({ timeoutMs: API_CONFIG.timeoutMs });
    try {
      const body = {
        model: config.model,
        messages: [{ role: "user", content: "ping" }],
        stream: true
      };
      logRealRequest(body);
      const response = await fetch(url, {
        method: "POST",
        headers: buildHeaders(),
        body: JSON.stringify(body),
        cache: "no-store",
        signal: control.controller.signal
      });
      const contentType = response.headers.get("content-type") || "";
      if (contentType.includes("text/event-stream")) {
        const inspection = await inspectSSE(response);
        return {
          url,
          status: response.status,
          structure: inspection.structure,
          sse: inspection.valid
        };
      }

      const payload = await readPayload(response);
      return {
        url,
        status: response.status,
        structure: summarizeJson(payload),
        sse: false
      };
    } catch (error) {
      const normalizedError = normalizeRequestError(error, control);
      return {
        url,
        status: 0,
        structure: { format: "error", code: normalizedError.code },
        sse: false
      };
    } finally {
      control.cleanup();
    }
  };

  window.AppProvider = Object.freeze({ send, stream, testConnection, debugRequest });
})();
