"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { test } = require("node:test");
const Fastify = require("fastify");
const multipart = require("@fastify/multipart");
const { openDatabase } = require("../database");
const { SessionStore } = require("../session-store");
const { MediaStore, detectImage } = require("../media-store");
const { registerMediaRoutes } = require("../media-routes");

const png = Buffer.from("89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c489", "hex");
const gif = Buffer.from("47494638396101000100", "hex");
const jpeg = Buffer.from("ffd8ffe000104a46494600010100000100010000ffd9", "hex");
const webp = Buffer.from("524946460400000057454250", "hex");

function form(files, fields = {}) {
  const boundary = `----p4a${Date.now()}`; const chunks = [];
  for (const [name, value] of Object.entries(fields)) chunks.push(Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="${name}"\r\n\r\n${value}\r\n`));
  for (const file of files) {
    chunks.push(Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="${file.name || "file"}"; filename="${file.filename || "image.png"}"\r\nContent-Type: ${file.mime}\r\n\r\n`));
    chunks.push(file.buffer, Buffer.from("\r\n"));
  }
  chunks.push(Buffer.from(`--${boundary}--\r\n`));
  return { payload: Buffer.concat(chunks), headers: { "content-type": `multipart/form-data; boundary=${boundary}`, authorization: "Bearer media-token" } };
}

async function fixture(t) {
  const dir = await fs.promises.mkdtemp(path.join(os.tmpdir(), "p4a-media-"));
  const connection = openDatabase(path.join(dir, "test.sqlite"));
  const sessionStore = new SessionStore({ database: connection.db, filename: connection.filename });
  const store = new MediaStore({ database: connection.db, imageDir: path.join(dir, "images"), stickerDir: path.join(dir, "stickers") });
  const app = Fastify({ logger: false });
  await app.register(multipart);
  registerMediaRoutes(app, { store, sessionStore, apiKey: "media-token" });
  await app.ready();
  t.after(async () => { await app.close(); connection.db.close(); await fs.promises.rm(dir, { recursive: true, force: true }); });
  return { app, store, sessionStore, dir };
}

test("detects jpeg/png/webp/gif signatures and rejects forged images", () => {
  assert.equal(detectImage(png).mimeType, "image/png");
  assert.equal(detectImage(gif).mimeType, "image/gif");
  assert.equal(detectImage(jpeg).mimeType, "image/jpeg");
  assert.equal(detectImage(webp).mimeType, "image/webp");
  assert.throws(() => detectImage(Buffer.from("not an image")), /允许的图片格式/);
});

test("image upload authenticates, limits count, validates MIME, serves controlled media, and links history", async t => {
  const { app, sessionStore } = await fixture(t); const session = sessionStore.createSession("images");
  let input = form([
    { buffer: png, mime: "image/png", filename: "../../escape.png" },
    { buffer: jpeg, mime: "image/jpeg", filename: "photo.jpg" },
    { buffer: webp, mime: "image/webp", filename: "photo.webp" },
    { buffer: gif, mime: "image/gif", filename: "photo.gif" }
  ]);
  input.headers["x-session-id"] = session.id;
  let response = await app.inject({ method: "POST", url: "/api/v1/chat/uploads/images", ...input });
  assert.equal(response.statusCode, 201); const image = response.json().data[0];
  assert.equal(response.json().data.length, 4); assert.match(image.id, /^[0-9a-f-]{36}$/); assert.equal(image.width, 1);
  const messageId = sessionStore.addMessage(session.id, "user", "photo", "completed", { type: "image", attachmentIds: [image.id] });
  const history = sessionStore.listMessages(session.id).messages;
  assert.equal(history[0].attachments[0].id, image.id); assert.equal(history[0].type, "image"); assert.ok(messageId);
  response = await app.inject({ method: "GET", url: image.url, headers: { authorization: "Bearer media-token" } });
  assert.equal(response.statusCode, 200); assert.equal(response.headers["content-type"], "image/png");
  response = await app.inject({ method: "GET", url: "/api/v1/chat/media/../../etc/passwd", headers: { authorization: "Bearer media-token" } });
  assert.notEqual(response.statusCode, 200);
  response = await app.inject({ method: "POST", url: "/api/v1/chat/uploads/images", ...form([{ buffer: png, mime: "image/jpeg" }]) });
  assert.equal(response.statusCode, 415);
  response = await app.inject({ method: "POST", url: "/api/v1/chat/uploads/images", ...form(Array.from({ length: 5 }, () => ({ buffer: png, mime: "image/png" }))) });
  assert.equal(response.statusCode, 413);
  response = await app.inject({ method: "POST", url: "/api/v1/chat/uploads/images", ...form([{ buffer: Buffer.concat([png, Buffer.alloc(10 * 1024 * 1024)]), mime: "image/png" }]) });
  assert.equal(response.statusCode, 413);
  for (const headers of [{}, { authorization: "Bearer wrong" }]) {
    response = await app.inject({ method: "POST", url: "/api/v1/chat/uploads/images", headers, payload: Buffer.alloc(0) });
    assert.equal(response.statusCode, 401);
  }
});

test("Sticker upload, search, edit, soft delete, restore, history and descriptor", async t => {
  const { app, sessionStore } = await fixture(t);
  let response = await app.inject({ method: "POST", url: "/api/v1/stickers", ...form([{ buffer: gif, mime: "image/gif", filename: "wave.gif" }], { label: "开心地挥手", tags: "开心 问候" }) });
  assert.equal(response.statusCode, 201); const sticker = response.json().data;
  response = await app.inject({ method: "GET", url: "/api/v1/stickers?keyword=" + encodeURIComponent("问候"), headers: { authorization: "Bearer media-token" } });
  assert.equal(response.json().data[0].id, sticker.id);
  response = await app.inject({ method: "PATCH", url: `/api/v1/stickers/${sticker.id}`, headers: { authorization: "Bearer media-token" }, payload: { label: "挥手", tags: "hello" } });
  assert.equal(response.json().data.label, "挥手");
  const session = sessionStore.createSession("sticker");
  sessionStore.addMessage(session.id, "user", "[Sticker: 挥手]", "completed", { type: "sticker", stickerId: sticker.id });
  assert.equal(sessionStore.listMessages(session.id).messages[0].sticker.id, sticker.id);
  assert.equal((await app.inject({ method: "DELETE", url: `/api/v1/stickers/${sticker.id}`, headers: { authorization: "Bearer media-token" } })).statusCode, 200);
  assert.equal((await app.inject({ method: "POST", url: `/api/v1/stickers/${sticker.id}/restore`, headers: { authorization: "Bearer media-token" } })).statusCode, 200);
  response = await app.inject({ method: "POST", url: "/api/v1/stickers", ...form([{ buffer: Buffer.concat([gif, Buffer.alloc(5 * 1024 * 1024)]), mime: "image/gif" }]) });
  assert.equal(response.statusCode, 413);
  response = await app.inject({ method: "POST", url: "/api/v1/stickers", ...form([{ buffer: Buffer.from("fake"), mime: "image/png" }]) });
  assert.equal(response.statusCode, 415);
});
