"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const vm = require("node:vm");
const { test } = require("node:test");
const Fastify = require("fastify");
const multipart = require("@fastify/multipart");
const { extractDocxText, extractFile, readZipEntries } = require("../file-extractors");
const { UploadStore } = require("../upload-store");
const { StickerImporter, parseUrlDescriptionText } = require("../sticker-importer");
const { registerUploadRoutes } = require("../upload-routes");

function zip(entries) {
  const locals = [];
  const centrals = [];
  let offset = 0;
  for (const [name, value] of entries) {
    const filename = Buffer.from(name);
    const data = Buffer.from(value);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0, 8);
    local.writeUInt32LE(data.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(filename.length, 26);
    locals.push(local, filename, data);
    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(0, 10);
    central.writeUInt32LE(data.length, 20);
    central.writeUInt32LE(data.length, 24);
    central.writeUInt16LE(filename.length, 28);
    central.writeUInt32LE(offset, 42);
    centrals.push(central, filename);
    offset += local.length + filename.length + data.length;
  }
  const centralBuffer = Buffer.concat(centrals);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(entries.length, 8);
  eocd.writeUInt16LE(entries.length, 10);
  eocd.writeUInt32LE(centralBuffer.length, 12);
  eocd.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, centralBuffer, eocd]);
}

function multipartForm(file) {
  const boundary = "----upload-test";
  return {
    headers: {
      authorization: "Bearer upload-test",
      "content-type": `multipart/form-data; boundary=${boundary}`
    },
    payload: Buffer.concat([
      Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="files"; filename="${file.name}"\r\nContent-Type: ${file.mime}\r\n\r\n`),
      file.buffer,
      Buffer.from(`\r\n--${boundary}--\r\n`)
    ])
  };
}

async function fixture(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "upload-test-"));
  const store = new UploadStore({
    rootDir: path.join(dir, "uploads"),
    indexFile: path.join(dir, "upload-index.json")
  });
  const importer = new StickerImporter({ uploadStore: store, packFile: path.join(dir, "sticker-packs.json") });
  const app = Fastify({ logger: false });
  await app.register(multipart);
  registerUploadRoutes(app, { uploadStore: store, stickerImporter: importer, apiKey: "upload-test" });
  await app.ready();
  t.after(async () => { await app.close(); fs.rmSync(dir, { recursive: true, force: true }); });
  return { app, dir, importer, store };
}

test("txt, markdown, json and docx extract bounded chat text", () => {
  for (const [name, buffer] of [
    ["notes.txt", Buffer.from("hello")],
    ["notes.md", Buffer.from("# hello")],
    ["notes.json", Buffer.from('{"hello":"world"}')]
  ]) {
    const result = extractFile({ name, buffer, mime: "text/plain" });
    assert.equal(result.canUseInChat, true);
    assert.match(result.extractedText, /hello/);
  }
  const document = zip([["word/document.xml", Buffer.from("<w:document><w:body><w:p><w:r><w:t>表情包说明</w:t></w:r></w:p></w:body></w:document>")]]);
  const result = extractFile({ name: "stickers.docx", buffer: document, mime: "application/vnd.openxmlformats-officedocument.wordprocessingml.document" });
  assert.equal(result.extractedText, "表情包说明");
});

test("docx OOXML extracts field and relationship hyperlinks with adjacent descriptions", () => {
  const document = zip([
    ["word/document.xml", Buffer.from([
      "<w:document><w:body>",
      "<w:p><w:r><w:fldChar w:fldCharType=\"begin\"/></w:r>",
      "<w:r><w:instrText> HYPERLINK &quot;https://example.test/field.gif&quot; </w:instrText></w:r>",
      "<w:r><w:t>https://example.test/field.gif</w:t></w:r>",
      "<w:r><w:t>（小猫偷看）</w:t></w:r></w:p>",
      "<w:p><w:hyperlink r:id=\"rId7\"><w:r><w:t>图片</w:t></w:r></w:hyperlink>",
      "<w:r><w:t>(小猫思考)</w:t></w:r></w:p>",
      "</w:body></w:document>"
    ].join(""))],
    ["word/_rels/document.xml.rels", Buffer.from(
      "<Relationships><Relationship Id=\"rId7\" Type=\"http://schemas.openxmlformats.org/officeDocument/2006/relationships/hyperlink\" Target=\"https://example.test/related.png\" TargetMode=\"External\"/></Relationships>"
    )]
  ]);
  const text = extractDocxText(document);
  assert.match(text, /https:\/\/example\.test\/field\.gif（小猫偷看）/);
  assert.match(text, /https:\/\/example\.test\/related\.png图片\(小猫思考\)/);
});

test("upload route stores safe paths, returns previews, rejects dangerous and oversized files", async t => {
  const { app, store } = await fixture(t);
  let response = await app.inject({
    method: "POST", url: "/api/v1/uploads/chat-file",
    ...multipartForm({ name: "../../notes.txt", mime: "text/plain", buffer: Buffer.from("safe content") })
  });
  assert.equal(response.statusCode, 201);
  const item = response.json().data[0];
  assert.equal(item.canUseInChat, true);
  assert.equal(item.name, "notes.txt");
  const stored = store.readBuffer(item.fileId);
  assert.match(path.basename(stored.filename), /^[0-9a-f-]{36}\.txt$/);
  assert.ok(stored.filename.startsWith(store.rootDir));
  assert.throws(() => store.save({
    buffer: Buffer.from("x"), originalName: "bad.js", mime: "text/javascript",
    extraction: { kind: "text", extractedText: "x", extractedTextLength: 1, extractedTextPreview: "x", canUseInChat: true }
  }), error => error.code === "UPLOAD_TYPE_UNSUPPORTED");
  const tiny = new UploadStore({ rootDir: store.rootDir, indexFile: store.indexFile, maxFileSize: 2 });
  assert.throws(() => tiny.save({
    buffer: Buffer.from("too large"), originalName: "large.txt", mime: "text/plain",
    extraction: { kind: "text", extractedText: "", extractedTextLength: 0, extractedTextPreview: "", canUseInChat: false }
  }), error => error.code === "UPLOAD_TOO_LARGE");
});

test("sticker text parser supports Chinese/English parentheses, next-line descriptions and tags", () => {
  const items = parseUrlDescriptionText([
    "https://example.test/a.jpg（小猫躲在墙边偷看）",
    "https://example.test/b.png (小猫开心收到爱心)",
    "https://example.test/c.webp",
    "小猫睡觉",
    "https://example.test/d.gif"
  ].join("\n"), "小猫合集.docx");
  assert.equal(items.length, 4);
  assert.equal(items[0].description, "小猫躲在墙边偷看");
  assert.ok(items[0].tags.includes("偷看"));
  assert.ok(items[0].tags.includes("小猫"));
  assert.ok(items[1].tags.includes("开心"));
  assert.equal(items[1].needsReview, false);
  assert.equal(items[2].description, "小猫睡觉");
  assert.equal(items[3].needsReview, true);
});

test("sticker text parser supports HYPERLINK fields, plain inline descriptions and expanded keywords", () => {
  const items = parseUrlDescriptionText([
    "HYPERLINK \"https://example.test/a.gif\"（小猫偷看）",
    "https://example.test/b.gif小猫思考",
    "https://example.test/c.gif（小猫不爽）",
    "https://example.test/d.gif",
    "小猫收到猫饼"
  ].join("\n"), "daimao.docx");
  assert.deepEqual(items.map(item => item.description), [
    "小猫偷看", "小猫思考", "小猫不爽", "小猫收到猫饼"
  ]);
  assert.ok(items.every(item => item.needsReview === false));
  assert.ok(items.every(item => item.tags.includes("小猫")));
  assert.ok(items[0].tags.includes("偷看"));
  assert.ok(items[1].tags.includes("思考"));
  assert.ok(items[2].tags.includes("不爽"));
  assert.ok(items[3].tags.includes("收到"));
  assert.ok(items[3].tags.includes("猫饼"));
  assert.ok(items.every(item => item.tags.includes("呆猫")));
});

test("sticker preview does not save a pack; confirm saves metadata without downloading remote images", async t => {
  const { importer, store, dir } = await fixture(t);
  const buffer = Buffer.from("https://example.test/cat.jpg（小猫害羞）");
  const extraction = extractFile({ name: "pack.txt", buffer, mime: "text/plain" });
  const upload = store.save({ buffer, originalName: "pack.txt", mime: "text/plain", extraction });
  const preview = importer.preview(upload.fileId);
  assert.equal(preview.items.length, 1);
  assert.equal(fs.existsSync(path.join(dir, "sticker-packs.json")), false);
  const result = importer.confirm(upload.fileId, [0]);
  assert.equal(result.importedCount, 1);
  assert.equal(importer.list()[0].url, "https://example.test/cat.jpg");
  assert.equal(fs.readdirSync(store.rootDir).filter(name => /\.(?:png|jpg)$/i.test(name)).length, 0);
});

test("zip reader rejects path traversal and imports only safe image entries", async t => {
  assert.throws(() => readZipEntries(zip([["../escape.png", Buffer.from("x")]])), /不安全路径/);
  const { importer, store } = await fixture(t);
  const buffer = zip([["cats/happy.png", Buffer.from("image")], ["notes.txt", Buffer.from("ignore")]]);
  const extraction = extractFile({ name: "pack.zip", buffer, mime: "application/zip" });
  const upload = store.save({ buffer, originalName: "pack.zip", mime: "application/zip", extraction });
  const preview = importer.preview(upload.fileId);
  assert.equal(preview.items.length, 1);
  const imported = importer.confirm(upload.fileId, [0]);
  assert.match(imported.items[0].imageUrl, /^\/api\/v1\/sticker-imports\/assets\//);
});

test("single image sticker imports through preview and confirm without using its original filename as storage path", async t => {
  const { importer, store } = await fixture(t);
  const buffer = Buffer.from("image-bytes");
  const extraction = extractFile({ name: "开心小猫.png", buffer, mime: "image/png" });
  const upload = store.save({ buffer, originalName: "开心小猫.png", mime: "image/png", extraction });
  const preview = importer.preview(upload.fileId);
  assert.equal(preview.items[0].description, "开心小猫");
  const result = importer.confirm(upload.fileId, [0]);
  assert.match(result.items[0].imageUrl, /^\/api\/v1\/sticker-imports\/assets\/[0-9a-f-]{36}\.png$/);
});

test("frontend file chips, removal and current-turn file protocol do not persist extracted text", () => {
  const root = path.join(__dirname, "..", "frontend-p4b");
  const chat = fs.readFileSync(path.join(root, "assets/js/chat.js"), "utf8");
  const html = fs.readFileSync(path.join(root, "chat.html"), "utf8");
  const historySource = fs.readFileSync(path.join(root, "storage/chat-history-store.js"), "utf8");
  assert.match(html, /class="file-picker"/);
  assert.match(chat, /attachment-preview--file/);
  assert.match(chat, /移除文件/);
  assert.match(chat, /uploadChatFile/);
  assert.match(chat, /uploadState: "uploading"/);
  assert.match(chat, /上传失败，点此重试/);
  assert.match(chat, /uploadState: "ready"/);
  assert.ok(chat.indexOf("pendingDocuments.push(...pending)") < chat.indexOf("Promise.allSettled"));
  assert.match(chat, /pendingDocuments\.splice\(index, 1\)/);
  assert.doesNotMatch(historySource, /extractedText:/);

  const state = { messages: [] };
  const window = { AppStore: { getState: () => state, saveState: value => value }, crypto: { randomUUID: () => "id" } };
  vm.runInNewContext(fs.readFileSync(path.join(root, "assets/js/message.js"), "utf8"), { window, Intl, Date, Math });
  const messages = window.MessageProtocol.toOpenAIMessages([{
    id: "current", role: "user", content: "请读附件",
    files: [{ fileId: "file-id", name: "notes.txt", mime: "text/plain" }]
  }], { activeFileMessageId: "current" });
  assert.equal(messages[0].content[1].type, "file");
  assert.equal(messages[0].content[1].file_id, "file-id");
  assert.doesNotMatch(JSON.stringify(messages), /extractedText/);
});

test("shared sticker normalization displays imported packs and filters description and tags", async () => {
  const source = fs.readFileSync(path.join(__dirname, "..", "frontend-p4b/assets/js/stickers.js"), "utf8");
  const imported = Array.from({ length: 35 }, (_, index) => ({
    id: `sticker-${index}`, imageUrl: `https://example.test/${index}.gif`,
    description: index === 4 ? "小白猫无语" : `小白猫动作${index}`,
    tags: index === 4 ? ["小猫", "无语"] : ["小猫"]
  }));
  const fetch = async url => ({
    ok: true,
    headers: { get: () => "application/json" },
    json: async () => url.endsWith("/api/v1/sticker-imports")
      ? { data: [{ id: "pack", items: imported }] }
      : { data: [] }
  });
  const window = {
    AppConfig: { getProviderConfig: () => ({ baseUrl: "https://gateway.test", auth: { type: "bearer", token: "test" } }) }
  };
  vm.runInNewContext(source, { window, fetch, FormData, Blob, URL, XMLHttpRequest: function () {} });
  const all = await window.AppMedia.list("");
  assert.equal(all.length, 35);
  assert.equal(all[4].label, "小白猫无语");
  assert.equal(all[4].tags, "小猫 无语");
  assert.equal(all[4].status, "active");
  const filtered = await window.AppMedia.list("无语");
  assert.deepEqual([...filtered.map(item => item.id)], ["sticker-4"]);
  assert.equal(window.AppMedia.normalizeStickerPack({ items: imported }).length, 35);
  assert.equal(window.AppMedia.normalizeStickerPack({ active: false, items: imported })[0].status, "disabled");
});

test("chat sticker refresh, friendly empty/error states, click send and file status transitions are wired", () => {
  const chat = fs.readFileSync(path.join(__dirname, "..", "frontend-p4b/assets/js/chat.js"), "utf8");
  assert.match(chat, /stickerButton\?\.addEventListener\("click"[\s\S]*loadStickers\(\)/);
  assert.match(chat, /await media\.list\(stickerSearch\?\.value \|\| ""\)/);
  assert.match(chat, /empty\.hidden = Boolean\(items\.length\)/);
  assert.match(chat, /empty\.textContent = "表情包暂时没加载出来，稍后再试。"/);
  assert.match(chat, /button\.onclick = \(\) => sendSticker\(sticker\)/);
  assert.match(chat, /createUserMessage\(`\[Sticker:/);
  assert.match(chat, /uploadState === "uploading"/);
  assert.match(chat, /uploadState === "error"/);
  assert.match(chat, /retryDocumentUpload/);
  assert.match(chat, /clearPendingFiles\(\);[\s\S]*requestAssistantReply\(message\)/);
});

test("runtime upload and sticker pack paths are ignored by git", () => {
  const ignore = fs.readFileSync(path.join(__dirname, "..", ".gitignore"), "utf8");
  assert.match(ignore, /runtime-data\/uploads\//);
  assert.match(ignore, /runtime-data\/upload-index\.json/);
  assert.match(ignore, /runtime-data\/sticker-packs\.json/);
});
