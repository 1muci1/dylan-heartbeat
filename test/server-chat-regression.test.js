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
fs.writeFileSync(process.env.TIMELINE_FILE, "[]\n");
fs.writeFileSync(process.env.TIMESTAMP_DB_FILE, "{}\n");

const { app } = require("../server");
const auth = { authorization: "Bearer gateway-test-key" };

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
