"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const { test } = require("node:test");

const frontend = path.join(__dirname, "..", "frontend-p4b");

function loadMessageProtocol() {
  const state = { messages: [] };
  const window = {
    AppStore: {
      getState: () => state,
      saveState: value => value
    },
    crypto: { randomUUID: () => "test-id" }
  };
  vm.runInNewContext(
    fs.readFileSync(path.join(frontend, "assets/js/message.js"), "utf8"),
    { window, Intl, Date, Math }
  );
  return window.MessageProtocol;
}

test("text requests omit UI images and keep OpenAI message content textual", () => {
  const protocol = loadMessageProtocol();
  const messages = protocol.toOpenAIMessages([
    {
      role: "system",
      content: "system",
      avatar: { imageData: "data:image/png;base64,AVATAR" },
      chatBackground: { imageData: "data:image/png;base64,BACKGROUND" }
    },
    { role: "user", content: "纯文本消息" }
  ]);

  assert.equal(messages[1].content, "纯文本消息");
  assert.equal(Array.isArray(messages[1].content), false);
  assert.doesNotMatch(JSON.stringify(messages), /AVATAR|BACKGROUND|image_url/);
});

test("historical image attachments become a text placeholder for a text-only provider", () => {
  const protocol = loadMessageProtocol();
  const messages = protocol.toOpenAIMessages([
    {
      role: "user",
      content: "看看这张图",
      attachments: [{ url: "data:image/png;base64,PRIVATE" }]
    }
  ]);

  assert.equal(messages[0].content, "看看这张图\n[图片已省略：当前模型未启用图片理解]");
  assert.equal(Array.isArray(messages[0].content), false);
  assert.doesNotMatch(JSON.stringify(messages), /PRIVATE|image_url/);
});

test("vision-enabled providers receive only explicit user chat attachments", () => {
  const protocol = loadMessageProtocol();
  const messages = protocol.toOpenAIMessages([
    {
      id: "current-image",
      role: "user",
      content: "看看这张图",
      attachments: [{ url: "/api/v1/chat/uploads/images/user-selected" }],
      avatar: { imageData: "data:image/png;base64,AVATAR" },
      chatBackground: { imageData: "data:image/png;base64,BACKGROUND" }
    }
  ], { supportsImages: true, activeImageMessageId: "current-image" });

  assert.equal(Array.isArray(messages[0].content), true);
  assert.equal(messages[0].content[0].type, "text");
  assert.equal(messages[0].content[1].type, "image_url");
  assert.equal(messages[0].content[1].image_url.url, "/api/v1/chat/uploads/images/user-selected");
  assert.doesNotMatch(JSON.stringify(messages), /AVATAR|BACKGROUND/);
});

test("vision-enabled providers send only the current image and omit historical image replay", () => {
  const protocol = loadMessageProtocol();
  const messages = protocol.toOpenAIMessages([
    {
      id: "historical-image",
      role: "user",
      content: "旧图片",
      attachments: [{ url: "/uploads/old-image" }]
    },
    {
      id: "current-image",
      role: "user",
      content: "当前图片",
      attachments: [{ url: "/uploads/current-image" }]
    }
  ], { supportsImages: true, activeImageMessageId: "current-image" });

  assert.equal(Array.isArray(messages[0].content), false);
  assert.equal(messages[0].content, "旧图片\n[历史图片已省略：避免重复发送图片上下文]");
  assert.equal(Array.isArray(messages[1].content), true);
  assert.equal(messages[1].content[1].image_url.url, "/uploads/current-image");
  assert.doesNotMatch(JSON.stringify(messages), /old-image/);
});

test("chat blocks unsupported image sending while preserving preview and clears state on request failures", () => {
  const chat = fs.readFileSync(path.join(frontend, "assets/js/chat.js"), "utf8");
  const unsupportedStart = chat.indexOf("if (pendingFiles.length && !supportsImages())");
  const unsupportedEnd = chat.indexOf("let attachments = []", unsupportedStart);
  const unsupported = chat.slice(unsupportedStart, unsupportedEnd);
  assert.match(unsupported, /模型设置 → 支持图片理解 开启后再发送图片/);
  assert.match(unsupported, /showToast\(message\)/);
  assert.match(unsupported, /return;/);
  assert.doesNotMatch(unsupported, /clearPendingFiles|uploadImages|requestAssistantReply/);
  assert.match(chat, /catch \(error\) \{\s*clearPendingFiles\(\);/);
  assert.match(chat, /const supportsImages = \(\) => window\.AppConfig/);
  assert.match(chat, /imageMessageId: userMessage\.attachments\?\.length \? userMessage\.id : null/);
});

test("mobile image input opens synchronously without camera capture or display-none hiding", () => {
  const html = fs.readFileSync(path.join(frontend, "chat.html"), "utf8");
  const css = fs.readFileSync(path.join(frontend, "assets/css/chat.css"), "utf8");
  const chat = fs.readFileSync(path.join(frontend, "assets/js/chat.js"), "utf8");
  assert.match(html, /class="image-picker" type="file" accept="image\/\*" multiple/);
  assert.doesNotMatch(html, /\bcapture=/);
  assert.doesNotMatch(html, /class="image-picker"[^>]*\shidden(?:\s|>)/);
  assert.match(css, /\.image-picker\s*\{[^}]*clip-path:\s*inset\(50%\)/s);
  const clickHandler = chat.slice(
    chat.indexOf('imageButton?.addEventListener("click"'),
    chat.indexOf('picker?.addEventListener("change"')
  );
  assert.match(clickHandler, /picker\?\.click\(\)/);
  assert.doesNotMatch(clickHandler, /\bawait\b|setTimeout|Promise|supportsImages|getProviderConfig|showToast/);
  const changeHandler = chat.slice(
    chat.indexOf('picker?.addEventListener("change"'),
    chat.indexOf('stickerButton?.addEventListener("click"')
  );
  assert.match(changeHandler, /pendingFiles\.push\(\.\.\.files\)/);
  assert.match(changeHandler, /renderPendingFiles\(\)/);
  assert.doesNotMatch(changeHandler, /supportsImages|clearPendingFiles/);
});
