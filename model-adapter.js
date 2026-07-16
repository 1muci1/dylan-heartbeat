"use strict";

class ModelAdapterError extends Error {
  constructor(message, code = "MODEL_ADAPTER_ERROR", statusCode = 502) {
    super(message);
    this.name = "ModelAdapterError";
    this.code = code;
    this.statusCode = statusCode;
  }
}

class OpenAIJsonAdapter {
  constructor(options = {}) {
    this.url = options.url || process.env.TARGET_API_URL || "";
    this.apiKey = options.apiKey || process.env.TARGET_API_KEY || "";
    this.provider = options.provider || "openai-compatible";
    this.fetch = options.fetch || global.fetch;
    this.timeoutMs = Number.isFinite(options.timeoutMs) && options.timeoutMs > 0 ? options.timeoutMs : 60000;
  }

  isConfigured() {
    return Boolean(this.url && this.apiKey && this.fetch);
  }

  configurationStatus() {
    return {
      provider: this.provider,
      endpointConfigured: Boolean(this.url),
      apiKeyConfigured: Boolean(this.apiKey),
      transportConfigured: typeof this.fetch === "function",
      configured: this.isConfigured()
    };
  }

  async generate({ model, system, input, signal }) {
    if (!this.isConfigured()) throw new ModelAdapterError("AI 模型未配置", "AI_MODEL_NOT_CONFIGURED", 503);
    if (!model) throw new ModelAdapterError("该功能的模型名称未配置", "AI_MODEL_NAME_MISSING", 503);
    if (signal?.aborted) throw new ModelAdapterError("AI 模型请求已取消", "AI_MODEL_ABORTED", 499);
    const controller = new AbortController();
    let timedOut = false;
    const abort = () => controller.abort(signal?.reason);
    signal?.addEventListener("abort", abort, { once: true });
    const timer = setTimeout(() => { timedOut = true; controller.abort(new Error("model timeout")); }, this.timeoutMs);
    let response;
    const startedAt = Date.now();
    try {
      response = await this.fetch(this.url, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${this.apiKey}` },
        body: JSON.stringify({ model, stream: false, response_format: { type: "json_object" }, messages: [
          { role: "system", content: system }, { role: "user", content: JSON.stringify(input) }
        ] }),
        signal: controller.signal
      });
    } catch (error) {
      if (timedOut) throw new ModelAdapterError("AI 模型请求超时", "AI_MODEL_TIMEOUT", 504);
      if (signal?.aborted || error?.name === "AbortError") throw new ModelAdapterError("AI 模型请求已取消", "AI_MODEL_ABORTED", 499);
      throw new ModelAdapterError("无法连接 AI 上游", "AI_UPSTREAM_NETWORK_ERROR", 502);
    } finally {
      clearTimeout(timer);
      signal?.removeEventListener("abort", abort);
    }
    if (!response || typeof response.ok !== "boolean") throw new ModelAdapterError("AI 上游响应无效", "AI_UPSTREAM_INVALID_RESPONSE", 502);
    if (!response.ok) {
      const status = Number(response.status);
      if (status === 401 || status === 403) throw new ModelAdapterError("AI 上游鉴权失败", "AI_UPSTREAM_AUTH_ERROR", 502);
      if (status === 429) throw new ModelAdapterError("AI 上游请求过于频繁", "AI_UPSTREAM_RATE_LIMIT", 503);
      if (status >= 400 && status < 500) throw new ModelAdapterError("AI 上游拒绝请求", "AI_UPSTREAM_CLIENT_ERROR", 502);
      if (status >= 500) throw new ModelAdapterError("AI 上游服务错误", "AI_UPSTREAM_SERVER_ERROR", 502);
      throw new ModelAdapterError("AI 上游请求失败", "AI_UPSTREAM_HTTP_ERROR", 502);
    }
    let payload;
    try { payload = await response.json(); }
    catch { throw new ModelAdapterError("AI 上游返回了非 JSON 响应", "AI_RESPONSE_NOT_JSON", 502); }
    const latencyMs = Date.now() - startedAt;
    if (!Array.isArray(payload?.choices) || !payload.choices.length) {
      throw new ModelAdapterError("AI 上游响应缺少 choices", "AI_RESPONSE_CHOICES_MISSING", 502);
    }
    const content = payload?.choices?.[0]?.message?.content;
    if (typeof content !== "string") throw new ModelAdapterError("AI 上游 content 不是字符串", "AI_RESPONSE_CONTENT_INVALID", 502);
    return {
      content,
      usage: payload.usage ?? null,
      model: payload.model ?? model,
      latencyMs
    };
  }
}

module.exports = { ModelAdapterError, OpenAIJsonAdapter };
