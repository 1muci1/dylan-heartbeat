"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { after, test } = require("node:test");

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "heartbeat-server-chat-"));
process.env.SESSION_DB_FILE = path.join(dir, "sessions.sqlite");
process.env.TIMELINE_FILE = path.join(dir, "timeline.json");
process.env.TIMESTAMP_DB_FILE = path.join(dir, "timestamps.json");
process.env.TARGET_API_URL = "https://upstream.invalid/v1/chat/completions";
process.env.TARGET_API_KEY = "upstream-test-key";
process.env.GATEWAY_API_KEY = "gateway-test-key";
process.env.CHAT_IMAGE_UPLOAD_DIR = path.join(dir, "images");
process.env.STICKER_UPLOAD_DIR = path.join(dir, "stickers");
process.env.DRAW_ROUND_STORE_FILE = path.join(dir, "draw-rounds.json");
process.env.UPLOAD_STORE_DIR = path.join(dir, "uploads");
process.env.UPLOAD_INDEX_FILE = path.join(dir, "upload-index.json");
process.env.STICKER_PACK_FILE = path.join(dir, "sticker-packs.json");
process.env.MEMORY_SUGGESTION_FILE = path.join(dir, "memory-suggestions.json");
fs.writeFileSync(process.env.TIMELINE_FILE, "[]\n");
fs.writeFileSync(process.env.TIMESTAMP_DB_FILE, "{}\n");

const {
  app,
  latestUserContentOf,
  memoryQueryOf,
  extractTimestampWithMemory,
  selectTimelineContextEvents,
  buildTimelineEventContext,
  buildStickerInstructionContext,
  assertLastUserMessagePreserved
} = require("../server");
const auth = { authorization: "Bearer gateway-test-key" };

test("Sticker system context teaches the safe directive protocol without exposing URLs", () => {
  const context = buildStickerInstructionContext({
    list: () => [{
      label: "小白猫哭",
      tags: "小白猫 哭 爱心",
      url: "https://private.example/sticker.gif"
    }]
  });
  assert.equal(context.role, "system");
  assert.match(context.content, /\[\[sticker:关键词\]\]/);
  assert.match(context.content, /小白猫/);
  assert.match(context.content, /哭/);
  assert.match(context.content, /不要说自己不能发图片或表情包/);
  assert.doesNotMatch(context.content, /https?:\/\/|private\.example|sticker\.gif/);
});

test("chat runtime reserves a create-only internal Memory write hook", () => {
  assert.equal(typeof app.agentMemoryWriteHook?.create, "function");
  assert.equal(app.agentMemoryWriteHook.update, undefined);
  assert.equal(app.agentMemoryWriteHook.delete, undefined);
  assert.equal(app.agentMemoryWriteHook.archive, undefined);
});

test("latest user content selects the current user message", () => {
  assert.equal(latestUserContentOf([
    { role: "user", content: "较早的问题" },
    { role: "assistant", content: "较早的回答" },
    { role: "user", content: "我们什么时候认识的？" }
  ]), "我们什么时候认识的？");
  assert.equal(latestUserContentOf([{ role: "assistant", content: "没有用户消息" }]), "");
});

test("Memory query combines the latest six conversation messages without system prompts", () => {
  const query = memoryQueryOf([
    { role: "system", content: "must-not-enter-query" },
    { role: "user", content: "我的专业是什么？" },
    { role: "assistant", content: "我们先聊专业。" },
    { role: "user", content: "沉沉" }
  ]);
  assert.match(query, /我的专业是什么/);
  assert.match(query, /我们先聊专业/);
  assert.match(query, /沉沉/);
  assert.doesNotMatch(query, /must-not-enter-query/);
  assert.ok(query.length <= 2000);
});

test("timeline timestamp resolution prefers message fields before legacy sources", () => {
  const message = {
    role: "assistant",
    content: "2024-01-01 00:00 刚刚给用户发了 Bark",
    timestamp: "2026-07-29T10:00:00.000Z",
    createdAt: "2025-01-01T00:00:00.000Z",
    created_at: "2023-01-01T00:00:00.000Z"
  };
  const timestamp = extractTimestampWithMemory(message, {
    "assistant::2024-01-01 00:00 刚刚给用户发了 Bark": "2022-01-01T00:00:00.000Z"
  });
  assert.equal(timestamp.toISOString(), "2026-07-29T10:00:00.000Z");
});

test("timeline events are deduplicated, capped, and summarized as system context", () => {
  const events = Array.from({ length: 49 }, (_, index) => ({
    role: "assistant",
    content: `（2026-07-${String(index + 1).padStart(2, "0")} 10:00 刚刚给用户发了 Bark：事件 ${index}。）`,
    timestamp: new Date(Date.UTC(2026, 6, index + 1, 10)).toISOString()
  }));
  events.push({ ...events.at(-1) });
  const selected = selectTimelineContextEvents(events, {}, 5);
  const context = buildTimelineEventContext(events, {}, 5);
  assert.equal(selected.length, 5);
  assert.equal(context.selected.length, 5);
  assert.equal(context.message.role, "system");
  assert.match(context.message.content, /^\[时间线事件摘要\]/);
  assert.equal((context.message.content.match(/^- /gm) || []).length, 5);
});

test("unknown timeline timestamps remain context before the current user", () => {
  const unknown = {
    role: "assistant",
    content: "刚刚给用户发了 Bark：未知时间事件。"
  };
  const context = buildTimelineEventContext([unknown], {});
  const messages = [context.message, { role: "user", content: "当前问题" }];
  assert.equal(messages[0].role, "system");
  assert.equal(assertLastUserMessagePreserved(messages, "当前问题"), true);
});

test("last-user guard rejects assistant timeline events appended after current user", () => {
  assert.throws(
    () => assertLastUserMessagePreserved([
      { role: "user", content: "当前问题" },
      { role: "assistant", content: "旧时间线事件" }
    ], "当前问题"),
    error => error.code === "LAST_USER_MESSAGE_NOT_PRESERVED"
  );
});

function jsonUpstream(content = "json reply", status = 200, thinking = null) {
  global.fetch = async () => new Response(JSON.stringify({
    id: "chatcmpl-test",
    choices: [{ message: { role: "assistant", content, ...(thinking ? { reasoning_content: thinking } : {}) }, finish_reason: "stop" }]
  }), { status, headers: { "content-type": "application/json" } });
}

function streamUpstream({ done = true, status = 200, thinking = "" } = {}) {
  global.fetch = async () => new Response(new ReadableStream({
    start(controller) {
      if (thinking) controller.enqueue(new TextEncoder().encode(`data: ${JSON.stringify({ choices: [{ delta: { reasoning_content: thinking } }] })}\n\n`));
      controller.enqueue(new TextEncoder().encode('data: {"choices":[{"delta":{"content":"stream "}}]}\n\n'));
      controller.enqueue(new TextEncoder().encode('data: {"choices":[{"delta":{"content":"reply"}}]}\n\n'));
      if (done) controller.enqueue(new TextEncoder().encode("data: [DONE]\n\n"));
      controller.close();
    }
  }), { status, headers: { "content-type": "text/event-stream" } });
}

test("gomoku chat intent returns its game link without relying on upstream wording", async () => {
  let upstreamCalled = false;
  global.fetch = async () => {
    upstreamCalled = true;
    throw new Error("upstream must not be called");
  };
  const response = await app.inject({
    method: "POST",
    url: "/v1/chat/completions",
    payload: { model: "test", stream: false, messages: [{ role: "user", content: "陪我下棋" }] }
  });
  assert.equal(response.statusCode, 200);
  assert.match(response.json().choices[0].message.content, /\/game\/#gomoku/);
  assert.equal(upstreamCalled, false);
});

test("chat answers recent game questions from EventStore without calling the model", async () => {
  const created = await app.inject({
    method: "POST",
    url: "/api/game/events",
    headers: auth,
    payload: {
      eventType: "game_result",
      title: "五子棋结果",
      metadata: {
        game: "gomoku", winner: "user", moves: 23, chenMoveCount: 11,
        chenSourceCount: 8, fallbackCount: 3, fallbackReasons: ["MODEL_TIMEOUT"],
        endedAt: "2026-08-07T00:00:00.000Z",
        summary: "辞辞刚刚和沉下五子棋，辞辞赢了。"
      }
    }
  });
  assert.equal(created.statusCode, 201, created.body);
  let upstreamCalled = false;
  global.fetch = async () => { upstreamCalled = true; throw new Error("must not call upstream"); };
  const response = await app.inject({
    method: "POST",
    url: "/v1/chat/completions",
    payload: { stream: false, messages: [{ role: "user", content: "刚刚那局有记忆吗" }] }
  });
  assert.equal(response.statusCode, 200);
  const content = response.json().choices[0].message.content;
  assert.match(content, /记得/);
  assert.match(content, /五子棋/);
  assert.match(content, /辞辞赢了/);
  assert.match(content, /23 步/);
  assert.match(content, /要我记下来吗/);
  assert.equal(upstreamCalled, false);

  const repeated = await app.inject({
    method: "POST", url: "/v1/chat/completions",
    payload: { stream: false, messages: [{ role: "user", content: "刚刚谁赢了" }] }
  });
  assert.doesNotMatch(repeated.json().choices[0].message.content, /要我记下来吗/);

});

async function createSession(title) {
  const response = await app.inject({
    method: "POST", url: "/api/v1/chat/sessions", headers: auth, payload: { title }
  });
  assert.equal(response.statusCode, 201);
  return response.json().session.id;
}

async function history(id) {
  const response = await app.inject({
    method: "GET", url: `/api/v1/chat/sessions/${id}/messages`, headers: auth
  });
  assert.equal(response.statusCode, 200);
  return response.json().messages;
}

after(async () => {
  await app.close();
  await fs.promises.rm(dir, { recursive: true, force: true });
});

test("legacy chat without X-Session-Id remains non-persistent for stream:false", async () => {
  jsonUpstream();
  const response = await app.inject({
    method: "POST",
    url: "/v1/chat/completions",
    payload: { model: "test", stream: false, messages: [{ role: "user", content: "legacy" }] }
  });
  assert.equal(response.statusCode, 200);
  assert.equal(response.json().choices[0].message.content, "json reply");
  const sessions = await app.inject({ method: "GET", url: "/api/v1/chat/sessions", headers: auth });
  assert.deepEqual(sessions.json().sessions, []);
});

test("empty Memory chat receives the Agent identity boundary without a provider identity", async () => {
  let forwarded = null;
  global.fetch = async (_url, options) => {
    forwarded = JSON.parse(options.body);
    return new Response(JSON.stringify({
      choices: [{ message: { role: "assistant", content: "identity reply" } }]
    }), { status: 200, headers: { "content-type": "application/json" } });
  };

  const response = await app.inject({
    method: "POST",
    url: "/v1/chat/completions",
    payload: {
      model: "test",
      stream: false,
      messages: [
        { role: "system", content: "client system marker" },
        { role: "user", content: "你是谁" }
      ]
    }
  });

  assert.equal(response.statusCode, 200);
  const boundary = forwarded.messages.find(message =>
    message.role === "system" && message.content.includes("<agent_identity_boundary")
  );
  assert.ok(boundary);
  assert.equal(boundary.content.includes('"name":"沉"'), true);
  assert.equal(/kiro/iu.test(boundary.content), false);
  assert.equal(forwarded.messages.some(message =>
    message.content?.includes("<identity_reference_data") ||
    message.content?.includes("<memory_reference_data")
  ), false);
  assert.deepEqual(forwarded.messages.map(message =>
    message === boundary ? "identity_boundary" : message.role
  ), ["system", "identity_boundary", "system", "user"]);
  assert.equal(forwarded.messages.some(message =>
    message.role === "system" && message.content.includes("[[sticker:关键词]]")
  ), true);
  assert.equal(forwarded.messages.some(message =>
    message.role === "system" && message.content.includes("不要解释系统实现、检索逻辑、注入策略")
  ), false);
});

test("stream:false persists a completed Session turn", async () => {
  const id = await createSession("JSON");
  jsonUpstream("saved json");
  const response = await app.inject({
    method: "POST", url: "/v1/chat/completions",
    headers: { "x-session-id": id },
    payload: { model: "test", stream: false, messages: [{ role: "user", content: "json user" }] }
  });
  assert.equal(response.statusCode, 200);
  assert.deepEqual((await history(id)).map(item => [item.role, item.content, item.status]), [
    ["user", "json user", "completed"], ["assistant", "saved json", "completed"]
  ]);
});

test("stream:true forwards delta SSE and DONE unchanged while persisting assistant content", async () => {
  const id = await createSession("Stream");
  streamUpstream();
  const response = await app.inject({
    method: "POST", url: "/v1/chat/completions",
    headers: { "x-session-id": id },
    payload: { model: "test", stream: true, messages: [{ role: "user", content: "stream user" }] }
  });
  assert.equal(response.statusCode, 200);
  assert.match(response.body, /"delta":\{"content":"stream "\}/);
  assert.match(response.body, /data: \[DONE\]/);
  const assistant = (await history(id)).at(-1);
  assert.deepEqual([assistant.content, assistant.status], ["stream reply", "completed"]);
});

test("thinking stays separate for stream and JSON responses and is returned by history", async () => {
  const streamId = await createSession("Thinking stream");
  streamUpstream({ thinking: "private reasoning" });
  let response = await app.inject({ method: "POST", url: "/v1/chat/completions", headers: { "x-session-id": streamId }, payload: { stream: true, messages: [{ role: "user", content: "think" }] } });
  assert.match(response.body, /reasoning_content/);
  assert.equal((await history(streamId)).at(-1).thinking, "private reasoning");
  assert.equal((await history(streamId)).at(-1).content, "stream reply");

  const jsonId = await createSession("Thinking JSON");
  jsonUpstream("final", 200, "json reasoning");
  response = await app.inject({ method: "POST", url: "/v1/chat/completions", headers: { "x-session-id": jsonId }, payload: { stream: false, messages: [{ role: "user", content: "think json" }] } });
  assert.equal(response.json().choices[0].message.reasoning_content, "json reasoning");
  assert.equal((await history(jsonId)).at(-1).thinking, "json reasoning");
});

test("missing DONE records an interrupted assistant response", async () => {
  const id = await createSession("Interrupted");
  streamUpstream({ done: false, thinking: "partial thought" });
  await app.inject({
    method: "POST", url: "/v1/chat/completions",
    headers: { "x-session-id": id },
    payload: { model: "test", stream: true, messages: [{ role: "user", content: "interrupt user" }] }
  });
  const assistant = (await history(id)).at(-1);
  assert.deepEqual([assistant.content, assistant.status], ["stream reply", "interrupted"]);
  assert.equal(assistant.thinking, "partial thought");
});

test("uploaded images return a clear error while MULTIMODAL_MODE=text", async () => {
  const id = await createSession("Images disabled");
  const boundary = "----p4atest";
  const png = Buffer.from("89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c489", "hex");
  const payload = Buffer.concat([Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="x.png"\r\nContent-Type: image/png\r\n\r\n`), png, Buffer.from(`\r\n--${boundary}--\r\n`)]);
  const upload = await app.inject({ method: "POST", url: "/api/v1/chat/uploads/images", headers: { ...auth, "x-session-id": id, "content-type": `multipart/form-data; boundary=${boundary}` }, payload });
  assert.equal(upload.statusCode, 201);
  const response = await app.inject({ method: "POST", url: "/v1/chat/completions", headers: { "x-session-id": id }, payload: { stream: false, messages: [{ role: "user", content: [{ type: "text", text: "看图" }, { type: "image_url", image_url: { url: upload.json().data[0].url } }] }] } });
  assert.equal(response.statusCode, 400);
  assert.match(response.json().error, /MULTIMODAL_MODE/);
});

test("Sticker messages persist as sticker and become a short model descriptor", async () => {
  const id = await createSession("Sticker chat");
  const boundary = "----p4asticker";
  const gif = Buffer.from("47494638396101000100", "hex");
  const payload = Buffer.concat([
    Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="label"\r\n\r\n开心地挥手\r\n--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="wave.gif"\r\nContent-Type: image/gif\r\n\r\n`), gif, Buffer.from(`\r\n--${boundary}--\r\n`)
  ]);
  const uploaded = await app.inject({ method: "POST", url: "/api/v1/stickers", headers: { ...auth, "content-type": `multipart/form-data; boundary=${boundary}` }, payload });
  assert.equal(uploaded.statusCode, 201); const sticker = uploaded.json().data;
  let forwarded = null;
  global.fetch = async (_url, options) => { forwarded = JSON.parse(options.body); return new Response(JSON.stringify({ choices: [{ message: { role: "assistant", content: "收到" } }] }), { status: 200, headers: { "content-type": "application/json" } }); };
  const response = await app.inject({ method: "POST", url: "/v1/chat/completions", headers: { "x-session-id": id }, payload: { stream: false, messages: [{ role: "user", content: [{ type: "sticker", sticker_id: sticker.id }] }] } });
  assert.equal(response.statusCode, 200);
  assert.equal(forwarded.messages.at(-1).content, "[Sticker: 开心地挥手]");
  const user = (await history(id))[0]; assert.equal(user.type, "sticker"); assert.equal(user.sticker.id, sticker.id);
});

test("chat file text is injected only into the current upstream turn and not persisted as full content", async () => {
  const id = await createSession("File chat");
  const boundary = "----p4afile";
  const privateFileText = "甲".repeat(1400) + "FULL_TEXT_MUST_NOT_REACH_MODEL_8f1d";
  const suppliedPreview = "客户端安全预览_8f1d";
  const payload = Buffer.concat([
    Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="files"; filename="notes.txt"\r\nContent-Type: text/plain\r\n\r\n${privateFileText}\r\n--${boundary}--\r\n`)
  ]);
  const uploaded = await app.inject({
    method: "POST", url: "/api/v1/uploads/chat-file",
    headers: { ...auth, "content-type": `multipart/form-data; boundary=${boundary}` }, payload
  });
  assert.equal(uploaded.statusCode, 201);
  const file = uploaded.json().data[0];
  let forwarded = null;
  global.fetch = async (_url, options) => {
    forwarded = JSON.parse(options.body);
    return new Response(JSON.stringify({ choices: [{ message: { role: "assistant", content: "读完了" } }] }), {
      status: 200, headers: { "content-type": "application/json" }
    });
  };
  const response = await app.inject({
    method: "POST", url: "/v1/chat/completions", headers: { "x-session-id": id },
    payload: {
      stream: false,
      messages: [{ role: "user", content: [
        { type: "text", text: "请读附件" },
        { type: "file", file_id: file.fileId, name: file.name, mime: file.mime, kind: "document", preview: suppliedPreview }
      ] }]
    }
  });
  assert.equal(response.statusCode, 200);
  const forwardedContent = JSON.stringify(forwarded.messages.at(-1).content);
  assert.match(forwardedContent, new RegExp(suppliedPreview));
  assert.doesNotMatch(forwardedContent, /FULL_TEXT_MUST_NOT_REACH_MODEL_8f1d/);
  assert.ok(forwardedContent.length < 1200);
  const user = (await history(id))[0];
  assert.match(user.content, /附件：notes\.txt/);
  assert.doesNotMatch(user.content, /FULL_TEXT_MUST_NOT_REACH_MODEL_8f1d|客户端安全预览_8f1d/);
});

test("chat consumes memory context without logging or persisting memory content", async () => {
  const memoryContent = "PRIVATE_MEMORY_CONTEXT_TEST_7c2e";
  const identityContent = "ASSISTANT_IDENTITY_CONTEXT_TEST_4a91";
  const nicknameContent = "USER_NICKNAME_CONTEXT_TEST_8b13";
  const created = await app.inject({
    method: "POST",
    url: "/api/v1/memories",
    headers: auth,
    payload: { type: "MEMORY", title: "Context test", content: memoryContent, importance: 5 }
  });
  assert.equal(created.statusCode, 201);
  for (const [title, content] of [
    ["Companion名称", identityContent],
    ["用户称呼", nicknameContent]
  ]) {
    const identity = await app.inject({
      method: "POST",
      url: "/api/v1/memories",
      headers: auth,
      payload: {
        type: "MEMORY",
        title,
        content,
        source: "memory-import:v1:relationship:server-regression",
        importance: 5
      }
    });
    assert.equal(identity.statusCode, 201);
  }

  const id = await createSession("Memory context");
  let forwarded = null;
  const logs = [];
  const originalLog = console.log;
  console.log = (...values) => { logs.push(values.map(String).join(" ")); };
  try {
    global.fetch = async (_url, options) => {
      forwarded = JSON.parse(options.body);
      return new Response(JSON.stringify({
        choices: [{ message: { role: "assistant", content: "memory-aware reply" } }]
      }), { status: 200, headers: { "content-type": "application/json" } });
    };
    const response = await app.inject({
      method: "POST",
      url: "/v1/chat/completions",
      headers: { "x-session-id": id },
      payload: { model: "test", stream: false, messages: [{ role: "user", content: "context user" }] }
    });
    assert.equal(response.statusCode, 200);
  } finally {
    console.log = originalLog;
  }

  const context = forwarded.messages.find(message =>
    message.role === "system" && message.content.includes("<memory_reference_data")
  );
  const identityContext = forwarded.messages.find(message =>
    message.role === "system" && message.content.includes("<identity_reference_data")
  );
  const identityBoundary = forwarded.messages.find(message =>
    message.role === "system" && message.content.includes("<agent_identity_boundary")
  );
  assert.ok(context);
  assert.ok(identityContext);
  assert.ok(identityBoundary);
  assert.match(context.content, new RegExp(memoryContent));
  assert.match(identityContext.content, new RegExp(identityContent));
  assert.match(identityContext.content, new RegExp(nicknameContent));
  const boundaryIndex = forwarded.messages.indexOf(identityBoundary);
  const identityIndex = forwarded.messages.indexOf(identityContext);
  const memoryIndex = forwarded.messages.indexOf(context);
  const conversationIndex = forwarded.messages.findIndex(message => message.role === "user");
  assert.ok(boundaryIndex < identityIndex && identityIndex < memoryIndex && memoryIndex < conversationIndex);
  const logged = logs.join("\n");
  assert.equal(logged.includes(memoryContent), false);
  assert.equal(logged.includes(identityContent), false);
  assert.equal(logged.includes(nicknameContent), false);
  assert.equal(logged.includes("<agent_identity_boundary"), false);
  assert.deepEqual((await history(id)).map(message => message.content), [
    "context user",
    "memory-aware reply"
  ]);
});

test("chat passes the latest user message to Memory Retriever and prioritizes relevant Memory", async () => {
  const meetingContent = "CHAT_QUERY_MEETING_MEMORY_91f4";
  const noiseContent = "CHAT_QUERY_UNRELATED_MEMORY_7a20";
  for (const payload of [
    {
      type: "MEMORY",
      title: "完全无关的重要事项",
      content: noiseContent,
      source: "memory-import:v1:relationship:chat-query-noise",
      importance: 5
    },
    {
      type: "MEMORY",
      title: "相遇日期",
      content: meetingContent,
      source: "memory-import:v1:relationship:chat-query-meeting",
      importance: 1
    }
  ]) {
    const created = await app.inject({
      method: "POST",
      url: "/api/v1/memories",
      headers: auth,
      payload
    });
    assert.equal(created.statusCode, 201);
  }

  let forwarded = null;
  global.fetch = async (_url, options) => {
    forwarded = JSON.parse(options.body);
    return new Response(JSON.stringify({
      choices: [{ message: { role: "assistant", content: "meeting reply" } }]
    }), { status: 200, headers: { "content-type": "application/json" } });
  };
  const response = await app.inject({
    method: "POST",
    url: "/v1/chat/completions",
    payload: {
      model: "test",
      stream: false,
      messages: [{ role: "user", content: "我们什么时候认识的？" }]
    }
  });
  assert.equal(response.statusCode, 200);

  const context = forwarded.messages.find(message =>
    message.role === "system" && message.content.includes("<memory_reference_data")
  );
  assert.ok(context);
  const matchingIndex = context.content.indexOf(meetingContent);
  const unrelatedIndex = context.content.indexOf(noiseContent);
  assert.ok(matchingIndex >= 0);
  assert.ok(unrelatedIndex < 0 || matchingIndex < unrelatedIndex);
});

test("memory overview questions inject grouped details without replacing the latest user turn", async () => {
  for (const payload of [
    { title: "概览关系设定", content: "OVERVIEW_RELATIONSHIP_DETAIL", source: "memory-import:v1:relationship:chat-overview", importance: 5 },
    { title: "概览学习专业", content: "OVERVIEW_ACADEMIC_DETAIL 数字媒体艺术毕设", source: "memory-import:v1:fact:chat-overview-academic", importance: 5 },
    { title: "概览 dylan-heartbeat 项目", content: "OVERVIEW_PROJECT_DETAIL Gateway 小窝聊天页", source: "memory-import:v1:fact:chat-overview-project", importance: 5 },
    { title: "概览互动语气偏好", content: "OVERVIEW_PREFERENCE_DETAIL 焦虑时需要具体回应", source: "memory-import:v1:preference:chat-overview", importance: 5 },
    { title: "概览闺蜜日常", content: "OVERVIEW_PEOPLE_DETAIL 闺蜜与社交习惯", source: "memory-import:v1:fact:chat-overview-people", importance: 4 },
    { type: "EVENT", title: "概览近期状态变化", content: "OVERVIEW_RECENT_DETAIL 这几天的重要调整", source: "memory-import:v1:event:chat-overview", importance: 5 }
  ]) {
    const created = await app.inject({
      method: "POST",
      url: "/api/v1/memories",
      headers: auth,
      payload: { type: "MEMORY", ...payload }
    });
    assert.equal(created.statusCode, 201);
  }

  let forwarded = null;
  global.fetch = async (_url, options) => {
    forwarded = JSON.parse(options.body);
    return new Response(JSON.stringify({
      choices: [{ message: { role: "assistant", content: "overview reply" } }]
    }), { status: 200, headers: { "content-type": "application/json" } });
  };
  const currentQuestion = "沉沉现在记忆方面怎么样有细节了吗";
  const response = await app.inject({
    method: "POST",
    url: "/v1/chat/completions",
    payload: { model: "test", stream: false, messages: [{ role: "user", content: currentQuestion }] }
  });
  assert.equal(response.statusCode, 200);
  const context = forwarded.messages.find(message =>
    message.role === "system" && message.content.includes("【记忆概览：")
  );
  const instruction = forwarded.messages.find(message =>
    message.role === "system" && message.content.includes("不要解释系统实现、检索逻辑、注入策略")
  );
  assert.ok(context);
  assert.ok(instruction);
  for (const detail of [
    "OVERVIEW_RELATIONSHIP_DETAIL",
    "OVERVIEW_ACADEMIC_DETAIL",
    "OVERVIEW_PROJECT_DETAIL",
    "OVERVIEW_PREFERENCE_DETAIL",
    "OVERVIEW_PEOPLE_DETAIL",
    "OVERVIEW_RECENT_DETAIL"
  ]) {
    assert.match(context.content, new RegExp(detail));
  }
  assert.match(context.content, /具体事实：/);
  assert.doesNotMatch(context.content, /whySelected|sourceGroup|selectedReason|tokenEstimate|rejectedReasons|检索|注入/);
  assert.match(instruction.content, /至少覆盖 4 个有资料的类别/);
  assert.match(instruction.content, /每类给 2～4 个具体例子/);
  assert.match(instruction.content, /不要.*骨架有了.*代替细节/);
  assert.ok(forwarded.messages.indexOf(context) < forwarded.messages.indexOf(instruction));
  assert.ok(forwarded.messages.indexOf(instruction) < forwarded.messages.length - 1);
  assert.equal(forwarded.messages.at(-1).role, "user");
  assert.equal(forwarded.messages.at(-1).content, currentQuestion);
});

test("chat summarizes old timeline events before preserving the full current user as final turn", async () => {
  const previousTimeline = fs.readFileSync(process.env.TIMELINE_FILE, "utf8");
  const events = Array.from({ length: 49 }, (_, index) => ({
    role: "assistant",
    content: `（2026-06-01 10:${String(index).padStart(2, "0")} 刚刚给用户发了 Bark：timeline ${index}。）`,
    timestamp: new Date(Date.UTC(2026, 5, 1, 10, index)).toISOString(),
    position: index + 0.3
  }));
  fs.writeFileSync(process.env.TIMELINE_FILE, `${JSON.stringify(events)}\n`);

  let forwarded = null;
  try {
    global.fetch = async (_url, options) => {
      forwarded = JSON.parse(options.body);
      return new Response(JSON.stringify({
        choices: [{ message: { role: "assistant", content: "timeline-safe reply" } }]
      }), { status: 200, headers: { "content-type": "application/json" } });
    };
    const currentQuestion = "沉沉现在记忆方面怎么样有细节了吗";
    const response = await app.inject({
      method: "POST",
      url: "/v1/chat/completions",
      payload: {
        model: "test",
        stream: false,
        messages: [
          { role: "user", content: "前一轮问题", timestamp: "2026-07-29T10:00:00.000Z" },
          { role: "assistant", content: "前一轮回答", timestamp: "2026-07-29T10:00:01.000Z" },
          { role: "user", content: currentQuestion, timestamp: "2026-07-29T10:00:02.000Z" }
        ]
      }
    });
    assert.equal(response.statusCode, 200);
    const timeline = forwarded.messages.find(message =>
      message.role === "system" && message.content.startsWith("[时间线事件摘要]")
    );
    const memory = forwarded.messages.find(message =>
      message.role === "system" && message.content.includes("【记忆概览：")
    );
    const instruction = forwarded.messages.find(message =>
      message.role === "system" && message.content.includes("不要解释系统实现、检索逻辑、注入策略")
    );
    assert.ok(timeline);
    assert.ok(memory);
    assert.ok(instruction);
    assert.equal((timeline.content.match(/^- /gm) || []).length, 5);
    const memoryIndex = forwarded.messages.indexOf(memory);
    const timelineIndex = forwarded.messages.indexOf(timeline);
    const instructionIndex = forwarded.messages.indexOf(instruction);
    const currentUserIndex = forwarded.messages.length - 1;
    assert.ok(memoryIndex < timelineIndex);
    assert.ok(timelineIndex < instructionIndex);
    assert.ok(instructionIndex < currentUserIndex);
    assert.equal(forwarded.messages.at(-1).role, "user");
    assert.equal(forwarded.messages.at(-1).content, currentQuestion);
    assert.equal(forwarded.messages.some(message =>
      message.role === "assistant" && String(message.content).includes("刚刚给用户发了 Bark")
    ), false);
  } finally {
    fs.writeFileSync(process.env.TIMELINE_FILE, previousTimeline);
  }
});

test("last-user guard accepts a current multimodal user message", () => {
  const content = [
    { type: "text", text: "请看这张图" },
    { type: "image_url", image_url: { url: "data:image/png;base64,REDACTED" } }
  ];
  assert.equal(
    assertLastUserMessagePreserved([{ role: "user", content }], "请看这张图\n[图片]"),
    true
  );
});

test("server source logs only lengths instead of request bodies or previews", () => {
  const source = fs.readFileSync(path.join(__dirname, "..", "server.js"), "utf8");
  assert.doesNotMatch(source, /收到 Kelivo 完整请求 Body/);
  assert.doesNotMatch(source, /JSON\.stringify\(sanitizeForLog\(body\)/);
  assert.doesNotMatch(source, /示例事件内容/);
  assert.match(source, /lastUserContentLength:\s*normalizeContentToText/);
  assert.match(source, /filePreviewLengths/);
  assert.match(source, /fileExtractedTextLengths/);
  assert.doesNotMatch(source, /lastUserContentPreview|safeChatPreview/);
  assert.match(source, /memoryInjectedCount/);
  assert.match(source, /timelineEventCount/);
});

test("recent multi-turn query and long chat history do not displace core Memory context", async () => {
  const coreContent = "CORE_MAJOR_MEMORY_7db4";
  const created = await app.inject({
    method: "POST",
    url: "/api/v1/memories",
    headers: auth,
    payload: {
      type: "MEMORY",
      title: "学习专业长期画像",
      content: coreContent,
      source: "memory-import:v1:fact:chat-core",
      importance: 5
    }
  });
  assert.equal(created.statusCode, 201);

  let forwarded = null;
  global.fetch = async (_url, options) => {
    forwarded = JSON.parse(options.body);
    return new Response(JSON.stringify({
      choices: [{ message: { role: "assistant", content: "core reply" } }]
    }), { status: 200, headers: { "content-type": "application/json" } });
  };
  const messages = Array.from({ length: 24 }, (_, index) => ({
    role: index % 2 ? "assistant" : "user",
    content: index === 20 ? "我们刚才说到我的专业" : `历史消息 ${index}`
  }));
  messages.push({ role: "user", content: "沉沉，你记得吗？" });
  const response = await app.inject({
    method: "POST",
    url: "/v1/chat/completions",
    payload: { model: "test", stream: false, messages }
  });
  assert.equal(response.statusCode, 200);
  const context = forwarded.messages.find(message =>
    message.role === "system" && message.content.includes("<memory_reference_data")
  );
  assert.ok(context);
  assert.match(context.content, new RegExp(coreContent));
  assert.ok(forwarded.messages.indexOf(context) < forwarded.messages.findIndex(message => message.role === "user"));
});

test("empty latest user content keeps Memory Retriever fallback", async () => {
  const relationshipContent = "CHAT_QUERY_EMPTY_RELATIONSHIP_3c61";
  const factContent = "CHAT_QUERY_EMPTY_FACT_d882";
  for (const payload of [
    {
      type: "MEMORY",
      title: "空查询关系回退",
      content: relationshipContent,
      source: "memory-import:v1:relationship:chat-query-empty",
      importance: 5
    },
    {
      type: "MEMORY",
      title: "空查询事实回退",
      content: factContent,
      source: "memory-import:v1:fact:chat-query-empty",
      importance: 5
    }
  ]) {
    const created = await app.inject({
      method: "POST",
      url: "/api/v1/memories",
      headers: auth,
      payload
    });
    assert.equal(created.statusCode, 201);
  }

  let forwarded = null;
  global.fetch = async (_url, options) => {
    forwarded = JSON.parse(options.body);
    return new Response(JSON.stringify({
      choices: [{ message: { role: "assistant", content: "fallback reply" } }]
    }), { status: 200, headers: { "content-type": "application/json" } });
  };
  const response = await app.inject({
    method: "POST",
    url: "/v1/chat/completions",
    payload: {
      model: "test",
      stream: false,
      messages: [{ role: "user", content: "   " }]
    }
  });
  assert.equal(response.statusCode, 200);

  const context = forwarded.messages.find(message =>
    message.role === "system" && message.content.includes("<memory_reference_data")
  );
  assert.ok(context);
  assert.match(context.content, new RegExp(relationshipContent));
  assert.match(context.content, new RegExp(factContent));
});

test("upstream errors record error status instead of completed", async () => {
  const id = await createSession("Error");
  jsonUpstream("upstream rejected", 502);
  const response = await app.inject({
    method: "POST", url: "/v1/chat/completions",
    headers: { "x-session-id": id },
    payload: { model: "test", stream: false, messages: [{ role: "user", content: "error user" }] }
  });
  assert.equal(response.statusCode, 502);
  const assistant = (await history(id)).at(-1);
  assert.equal(assistant.status, "error");
});

test("chat approves or rejects only the latest pending suggestion", async () => {
  let upstreamCalled = 0;
  global.fetch = async () => { upstreamCalled += 1; throw new Error("approval must not call upstream"); };
  const beforeApproval = (await app.inject({ method: "GET", url: "/api/v1/memories?limit=1", headers: auth })).json().meta.total;
  const approved = await app.inject({ method: "POST", url: "/v1/chat/completions",
    payload: { stream: false, messages: [{ role: "user", content: "那局记下来" }] } });
  const approvedText = approved.json().choices[0].message.content;
  assert.match(approvedText, /长期记忆/);
  assert.doesNotMatch(approvedText, /只在当前轮对话有效|等接口|下次.*忘/);
  assert.equal((await app.inject({ method: "GET", url: "/api/v1/memories?limit=1", headers: auth })).json().meta.total, beforeApproval + 1);
  assert.equal(upstreamCalled, 0);

  const duplicate = await app.inject({ method: "POST", url: "/v1/chat/completions",
    payload: { stream: false, messages: [{ role: "user", content: "记下来" }] } });
  assert.match(duplicate.json().choices[0].message.content, /想让我记哪件事/);
  assert.equal((await app.inject({ method: "GET", url: "/api/v1/memories?limit=1", headers: auth })).json().meta.total, beforeApproval + 1);
  assert.equal(upstreamCalled, 0);

  const created = await app.inject({
    method: "POST", url: "/api/game/events", headers: auth,
    payload: { eventType: "game_result", title: "五子棋结果", metadata: {
      game: "gomoku", winner: "chen", moves: 19, chenMoveCount: 10,
      chenSourceCount: 10, fallbackCount: 0, fallbackReasons: [],
      endedAt: "2026-08-07T01:00:00.000Z", summary: "辞辞和沉下了一局五子棋，沉赢了。"
    } }
  });
  assert.equal(created.statusCode, 201);
  const beforeSecondApproval = (await app.inject({ method: "GET", url: "/api/v1/memories?limit=1", headers: auth })).json().meta.total;
  const secondApproved = await app.inject({ method: "POST", url: "/v1/chat/completions",
    payload: { stream: false, messages: [{ role: "user", content: "把刚刚那局记下来" }] } });
  assert.match(secondApproved.json().choices[0].message.content, /长期记忆/);
  assert.equal((await app.inject({ method: "GET", url: "/api/v1/memories?limit=1", headers: auth })).json().meta.total, beforeSecondApproval + 1);
  assert.equal(upstreamCalled, 0);

  const rejectedGame = await app.inject({
    method: "POST", url: "/api/game/events", headers: auth,
    payload: { eventType: "game_result", title: "五子棋结果", metadata: {
      game: "gomoku", winner: "draw", moves: 31, chenMoveCount: 15,
      chenSourceCount: 14, fallbackCount: 1, fallbackReasons: ["MODEL_TIMEOUT"],
      endedAt: "2026-08-07T02:00:00.000Z", summary: "辞辞和沉下了一局五子棋，平局。"
    } }
  });
  assert.equal(rejectedGame.statusCode, 201);
  const beforeRejection = (await app.inject({ method: "GET", url: "/api/v1/memories?limit=1", headers: auth })).json().meta.total;
  const rejected = await app.inject({ method: "POST", url: "/v1/chat/completions",
    payload: { stream: false, messages: [{ role: "user", content: "不用记" }] } });
  assert.match(rejected.json().choices[0].message.content, /不记进长期记忆/);
  assert.equal((await app.inject({ method: "GET", url: "/api/v1/memories?limit=1", headers: auth })).json().meta.total, beforeRejection);
  const noPending = await app.inject({ method: "POST", url: "/v1/chat/completions",
    payload: { stream: false, messages: [{ role: "user", content: "记下来" }] } });
  assert.match(noPending.json().choices[0].message.content, /想让我记哪件事/);
  assert.equal((await app.inject({ method: "GET", url: "/api/v1/memories?limit=1", headers: auth })).json().meta.total, beforeRejection);
  assert.equal(upstreamCalled, 0);
});
