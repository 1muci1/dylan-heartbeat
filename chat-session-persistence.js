"use strict";

function latestUserContent(messages, normalizeContent) {
  for (let index = messages.length - 1; index >= 0; index--) {
    if (messages[index]?.role === "user") return normalizeContent(messages[index].content).trim();
  }
  return "";
}

function createSseAccumulator() {
  const decoder = new TextDecoder();
  let buffer = "";
  let content = "";
  let thinking = "";
  let doneReceived = false;

  function parseEvent(event) {
    for (const line of event.split(/\r?\n/)) {
      if (!line.startsWith("data:")) continue;
      const data = line.slice(5).trim();
      if (data === "[DONE]") {
        doneReceived = true;
        continue;
      }
      if (!data) continue;
      try {
        const payload = JSON.parse(data);
        const choice = payload?.choices?.[0];
        const delta = choice?.delta?.content;
        if (typeof delta === "string") content += delta;
        const reasoning = choice?.delta?.reasoning_content ?? choice?.delta?.reasoning ?? choice?.delta?.thinking
          ?? payload?.delta?.reasoning_content ?? payload?.delta?.thinking;
        if (typeof reasoning === "string") thinking += reasoning;
      } catch {
        // Persistence is observational: malformed upstream events are still forwarded unchanged.
      }
    }
  }

  return {
    push(bytes) {
      buffer += decoder.decode(bytes, { stream: true });
      const events = buffer.split(/\r?\n\r?\n/);
      buffer = events.pop() || "";
      events.forEach(parseEvent);
    },
    finish() {
      buffer += decoder.decode();
      if (buffer.trim()) parseEvent(buffer);
      return { content, thinking, doneReceived };
    }
  };
}

function beginSessionTurn(store, sessionId, messages, normalizeContent, options = {}) {
  if (!sessionId) return null;
  store.getSession(sessionId);
  const userContent = latestUserContent(messages, normalizeContent);
  if (!userContent) {
    const error = new Error("Session 请求缺少用户消息");
    error.statusCode = 400;
    error.code = "USER_MESSAGE_REQUIRED";
    throw error;
  }
  const userMessageId = store.addMessage(sessionId, "user", userContent, "completed", {
    type: options.messageType || "text",
    attachmentIds: options.attachmentIds || [],
    stickerId: options.stickerId || null
  });
  const assistantMessageId = store.addMessage(sessionId, "assistant", "", "pending");
  let finalized = false;
  const finalize = (status, content, code, thinking) => {
    if (finalized) return;
    store.updateMessage(assistantMessageId, status, content, code, thinking);
    finalized = true;
    if (status === "completed" && typeof options.onCompleted === "function") {
      queueMicrotask(() => options.onCompleted({ sessionId, userMessageId, assistantMessageId }));
    }
  };
  return {
    assistantMessageId,
    userMessageId,
    complete(content, thinking) { finalize("completed", content, null, thinking); },
    interrupt(content, thinking) { finalize("interrupted", content, "STREAM_INTERRUPTED", thinking); },
    fail(content, code, thinking) { finalize("error", content, code || "UPSTREAM_ERROR", thinking); }
  };
}

module.exports = { beginSessionTurn, createSseAccumulator, latestUserContent };
