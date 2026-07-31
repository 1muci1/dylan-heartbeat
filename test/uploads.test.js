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
const { StickerImporter, dedupePacks, parseUrlDescriptionText } = require("../sticker-importer");
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
  assert.equal(result.skippedDuplicateCount, 0);
  assert.equal(importer.list()[0].url, "https://example.test/cat.jpg");
  assert.equal(fs.readdirSync(store.rootDir).filter(name => /\.(?:png|jpg)$/i.test(name)).length, 0);
});

test("sticker packs dedupe repeated imports by normalized URL and merge useful metadata", () => {
  const base = Array.from({ length: 35 }, (_, index) => ({
    id: `base-${index}`,
    imageUrl: `https://EXAMPLE.test/${index}.gif#copy`,
    description: index === 0 ? "哭" : `动作${index}`,
    tags: index === 0 ? ["哭"] : ["小猫"],
    needsReview: true
  }));
  const packs = {
    version: 1,
    packs: Array.from({ length: 6 }, (_, packIndex) => ({
      id: `pack-${packIndex}`,
      active: packIndex === 0,
      items: base.map((item, index) => ({
        ...item,
        id: `${packIndex}-${index}`,
        imageUrl: item.imageUrl.replace("#copy", packIndex % 2 ? "" : "#copy"),
        description: index === 0 && packIndex === 5 ? "小白猫哭得很伤心" : item.description,
        tags: index === 0 && packIndex === 4 ? ["小猫", "委屈"] : item.tags,
        needsReview: packIndex !== 3
      }))
    }))
  };
  const result = dedupePacks(packs);
  assert.equal(result.data.packs.length, 1);
  assert.equal(result.data.packs[0].items.length, 35);
  assert.equal(result.removedCount, 175);
  const crying = result.data.packs[0].items[0];
  assert.equal(crying.description, "小白猫哭得很伤心");
  assert.deepEqual(crying.tags, ["哭", "小猫", "委屈"]);
  assert.equal(crying.needsReview, false);
  assert.equal(result.data.packs[0].active, true);
});

test("confirming the same sticker document twice skips duplicates without growing storage", async t => {
  const { importer, store } = await fixture(t);
  const buffer = Buffer.from([
    "https://example.test/a.gif（小猫哭）",
    "https://example.test/b.gif（小猫收到）"
  ].join("\n"));
  const extraction = extractFile({ name: "daimao.txt", buffer, mime: "text/plain" });
  const upload = store.save({ buffer, originalName: "daimao.txt", mime: "text/plain", extraction });
  const first = importer.confirm(upload.fileId);
  const second = importer.confirm(upload.fileId);
  assert.equal(first.importedCount, 2);
  assert.equal(second.importedCount, 0);
  assert.equal(second.skippedDuplicateCount, 2);
  assert.equal(importer.list().length, 2);
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
    files: [{
      fileId: "file-id", name: "notes.txt", mime: "text/plain", size: 1200,
      kind: "document", extractedTextPreview: "甲".repeat(600),
      extractedTextLength: 1200, extractedText: "不得发送的完整正文"
    }]
  }], { activeFileMessageId: "current" });
  assert.equal(messages[0].content[1].type, "file");
  assert.equal(messages[0].content[1].file_id, "file-id");
  assert.equal(messages[0].content[1].preview.length, 500);
  assert.equal(messages[0].content[1].extracted_text_length, 1200);
  assert.doesNotMatch(JSON.stringify(messages), /不得发送的完整正文|extractedText/);
  const stickerMessages = window.MessageProtocol.toOpenAIMessages([{
    id: "sticker-current", role: "user",
    content: "用户发送了一个表情：[Sticker: 小白猫哭；标签：小猫 哭]",
    sticker: {
      id: "sticker-id", description: "小白猫哭", tags: "小猫 哭",
      url: "https://example.test/private-sticker.gif"
    }
  }]);
  assert.match(stickerMessages[0].content, /小白猫哭/);
  assert.doesNotMatch(JSON.stringify(stickerMessages), /private-sticker|image_url/);
  const assistantSticker = window.MessageProtocol.createAssistantMessage("", {
    stickers: [{
      id: "assistant-sticker", label: "小白猫爱心", description: "小白猫爱心",
      tags: "小白猫 爱心", url: "https://example.test/assistant.gif"
    }]
  });
  const assistantProtocol = window.MessageProtocol.toOpenAIMessages([assistantSticker]);
  assert.match(assistantProtocol[0].content, /小白猫爱心/);
  assert.doesNotMatch(JSON.stringify(assistantProtocol), /assistant\.gif|https?:\/\//);
});

test("shared sticker normalization displays imported packs and filters description and tags", async () => {
  const source = fs.readFileSync(path.join(__dirname, "..", "frontend-p4b/assets/js/stickers.js"), "utf8");
  const imported = Array.from({ length: 35 }, (_, index) => ({
    id: `sticker-${index}`, imageUrl: `https://example.test/${index}.gif`,
    description: index === 1 ? "小白猫哭"
      : index === 2 ? "小白猫爱心"
        : index === 4 ? "小白猫无语"
          : `小白猫动作${index}`,
    tags: index === 1 ? ["小猫", "哭"]
      : index === 2 ? ["小猫", "爱心"]
        : index === 4 ? ["小猫", "无语"]
          : ["小猫"]
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
  assert.equal(window.AppMedia.dedupeStickers([
    ...all,
    { ...all[0], id: "duplicate", url: `${all[0].url}#copy` }
  ]).length, 35);
  const parsed = window.AppMedia.parseAssistantStickerDirectives(
    "我陪着你。\n[[sticker:哭]]\n[[sticker:爱心]]\n[[sticker:无语]]"
  );
  assert.equal(parsed.text, "我陪着你。");
  assert.deepEqual([...parsed.keywords], ["哭", "爱心"]);
  assert.equal(window.AppMedia.matchStickerKeyword(all, "无语").id, "sticker-4");
  assert.equal(window.AppMedia.matchStickerKeyword(all, "动作7").id, "sticker-7");
  const resolved = window.AppMedia.resolveAssistantStickers("收到啦。\n[[sticker:哭]]", all);
  assert.equal(resolved.text, "收到啦。");
  assert.equal(resolved.stickers.length, 1);
  assert.equal(resolved.stickers[0].id, "sticker-1");
  const compatible = window.AppMedia.resolveAssistantStickers("别难过。\n[sticker:哭]", all);
  assert.equal(compatible.text, "别难过。");
  assert.equal(compatible.stickers.length, 1);
  assert.equal(compatible.stickers[0].id, "sticker-1");
  const descriptionMatch = window.AppMedia.resolveAssistantStickers("[sticker:趴着发呆]", [{
    id: "resting", url: "https://example.test/resting.gif",
    label: "小白猫休息", description: "小白猫趴着发呆", tags: "小猫 安静"
  }]);
  assert.equal(descriptionMatch.text, "");
  assert.equal(descriptionMatch.stickers[0].id, "resting");
  const capped = window.AppMedia.resolveAssistantStickers(
    "[sticker:哭]\n[[sticker:爱心]]\n[sticker:无语]",
    all
  );
  assert.equal(capped.stickers.length, 2);
  assert.deepEqual([...capped.stickers.map(item => item.id)], ["sticker-2", "sticker-1"]);
  assert.doesNotMatch(capped.text, /sticker:/i);
  const missing = window.AppMedia.resolveAssistantStickers("[sticker:不存在]", all);
  assert.equal(missing.stickers.length, 0);
  for (const unsafe of [
    "[sticker:<script>]",
    "[sticker:https://example.test/x.gif]",
    "[sticker:../../.env]"
  ]) {
    const unsafeResult = window.AppMedia.resolveAssistantStickers(unsafe, all);
    assert.equal(unsafeResult.stickers.length, 0);
    assert.equal(unsafeResult.text, unsafe);
  }
});

test("chat sticker refresh, friendly empty/error states, click send and file status transitions are wired", () => {
  const chat = fs.readFileSync(path.join(__dirname, "..", "frontend-p4b/assets/js/chat.js"), "utf8");
  const manager = fs.readFileSync(path.join(__dirname, "..", "frontend-p4b/assets/js/sticker-manager.js"), "utf8");
  assert.match(manager, /已导入 \$\{result\.importedCount\} 个，跳过 \$\{result\.skippedDuplicateCount \|\| 0\} 个重复表情/);
  assert.match(chat, /stickerButton\?\.addEventListener\("click"[\s\S]*loadStickers\(\)/);
  assert.match(chat, /await media\.list\(stickerSearch\?\.value \|\| ""\)/);
  assert.match(chat, /empty\.hidden = Boolean\(stickerCache\.length\)/);
  assert.match(chat, /stickerCache = media\.dedupeStickers/);
  assert.match(chat, /STICKER_PAGE_SIZE = 40/);
  assert.match(chat, /stickerCache\.slice\(visibleStickerCount, visibleStickerCount \+ STICKER_PAGE_SIZE\)/);
  assert.match(chat, /image\.loading = "lazy"/);
  assert.match(chat, /window\.setTimeout\(loadStickers, 200\)/);
  assert.match(chat, /media\.dedupeStickers/);
  assert.match(chat, /status\.textContent = "表情包暂时没加载出来，稍后再试。"/);
  const stickerCatch = chat.slice(chat.indexOf("const loadStickers"), chat.indexOf("const sendSticker"));
  assert.doesNotMatch(stickerCatch.slice(stickerCatch.indexOf("catch")), /stickerGrid\.replaceChildren/);
  assert.match(chat, /button\.onclick = \(\) => sendSticker\(sticker\)/);
  assert.match(chat, /用户发送了一个表情：\[Sticker:/);
  assert.match(chat, /requestAssistantReply\(message, null, \{ timeoutMs: 60000 \}\)/);
  assert.match(chat, /if \(pendingRow\.isConnected\) pendingRow\.remove\(\)/);
  assert.match(chat, /resolveAssistantStickerReply\(completeReply\)/);
  assert.match(chat, /stickers: resolvedStickerReply\.stickers/);
  assert.match(chat, /hydrateAssistantStickerMessages\(messages\)/);
  assert.match(chat, /message\.stickers/);
  const stickerSend = chat.slice(chat.indexOf("const sendSticker"), chat.indexOf("const handleSend"));
  assert.doesNotMatch(stickerSend, /sticker\.url|image_url/);
  const historySource = fs.readFileSync(path.join(__dirname, "..", "frontend-p4b/storage/chat-history-store.js"), "utf8");
  assert.match(historySource, /value\.stickers/);
  assert.match(historySource, /message\.stickers = stickers/);
  assert.match(chat, /uploadState === "uploading"/);
  assert.match(chat, /uploadState === "error"/);
  assert.match(chat, /retryDocumentUpload/);
  assert.match(chat, /onFailure:\s*\(\) =>/);
  assert.match(chat, /\.\.\.draftDocuments\.filter/);
  for (const text of [
    "网络暂时连不上，稍后再试。",
    "连接授权失效了，刷新后再试。",
    "这次文件内容太大了，换个小一点的文件或删掉附件再试。",
    "这个附件暂时不能发送，删掉后再试。",
    "沉刚刚没有接住这条消息，稍后再试。",
    "回复中途断了一下，内容没有完整收到。",
    "这次发送失败了，稍后再试。"
  ]) assert.match(chat, new RegExp(text.replace(/[。]/g, "\\。")));
  assert.doesNotMatch(chat, /连接暂时中断了，请检查网络后再试/);
});

test("runtime upload and sticker pack paths are ignored by git", () => {
  const ignore = fs.readFileSync(path.join(__dirname, "..", ".gitignore"), "utf8");
  assert.match(ignore, /runtime-data\/uploads\//);
  assert.match(ignore, /runtime-data\/upload-index\.json/);
  assert.match(ignore, /runtime-data\/sticker-packs\.json/);
});
