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

  assert.equal(messages[0].content, "看看这张图\n[图片已省略：当前模型未启用多模态]");
  assert.equal(Array.isArray(messages[0].content), false);
  assert.doesNotMatch(JSON.stringify(messages), /PRIVATE|image_url/);
});

test("vision-enabled providers receive only explicit user chat attachments", () => {
  const protocol = loadMessageProtocol();
  const messages = protocol.toOpenAIMessages([
    {
      role: "user",
      content: "看看这张图",
      attachments: [{ url: "/api/v1/chat/uploads/images/user-selected" }],
      avatar: { imageData: "data:image/png;base64,AVATAR" },
      chatBackground: { imageData: "data:image/png;base64,BACKGROUND" }
    }
  ], { supportsImages: true });

  assert.equal(Array.isArray(messages[0].content), true);
  assert.equal(messages[0].content[0].type, "text");
  assert.equal(messages[0].content[1].type, "image_url");
  assert.equal(messages[0].content[1].image_url.url, "/api/v1/chat/uploads/images/user-selected");
  assert.doesNotMatch(JSON.stringify(messages), /AVATAR|BACKGROUND/);
});

test("chat blocks unsupported pending images and clears attachment state on failures", () => {
  const chat = fs.readFileSync(path.join(frontend, "assets/js/chat.js"), "utf8");
  assert.match(chat, /当前模型未启用图片理解，请切换支持多模态的模型或移除图片/);
  assert.match(chat, /if \(pendingFiles\.length\)[\s\S]*clearPendingFiles\(\)[\s\S]*return;/);
  assert.match(chat, /catch \(error\) \{\s*clearPendingFiles\(\);/);
  assert.match(chat, /const supportsImages = \(\) => window\.AppConfig/);
  assert.match(chat, /if \(!supportsImages\(\)\)[\s\S]*showToast\(message\)[\s\S]*return;/);
});
