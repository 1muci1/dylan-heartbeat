"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { test } = require("node:test");

const frontend = path.join(__dirname, "..", "frontend-p4b");
const read = relativePath => fs.readFileSync(path.join(frontend, relativePath), "utf8");

test("chat renders role-specific message action bars with accessible icon buttons", () => {
  const chat = read("assets/js/chat.js");
  const html = read("chat.html");

  for (const label of ["复制", "重新生成", "语音播放", "翻译", "更多", "编辑", "重新发送"]) {
    assert.match(chat, new RegExp(`"${label}"`));
  }
  assert.match(chat, /createActionBar\(message\)/);
  assert.match(chat, /data-message-action/);
  assert.match(chat, /setAttribute\("aria-label", label\)/);
  assert.match(html, /class="chat-toast" role="status" aria-live="polite"/);
});

test("message retry reuses the selected user message and history without appending it", () => {
  const chat = read("assets/js/chat.js");
  const retryStart = chat.indexOf("const retryFromUserMessage");
  const retryEnd = chat.indexOf("messageContent.addEventListener", retryStart);
  const retry = chat.slice(retryStart, retryEnd);

  assert.ok(retryStart >= 0 && retryEnd > retryStart);
  assert.match(retry, /requestAssistantReply\(userMessage, messages\.slice\(0, index \+ 1\)\)/);
  assert.doesNotMatch(retry, /appendAndPersist|createUserMessage|state\.messages\.push/);
  assert.match(chat, /retryUserMessageId: userMessage\.id/);
  assert.match(chat, /serverSessionId = await ensureServerSession\(\)/);
});

test("message actions provide text copy feedback and compact purple mobile styling", () => {
  const chat = read("assets/js/chat.js");
  const css = read("assets/css/chat.css");

  assert.match(chat, /navigator\.clipboard\.writeText\(value\)/);
  assert.match(chat, /showToast\("已复制"\)/);
  assert.match(css, /\.message-actions\s*\{[^}]*display:\s*flex/s);
  assert.match(css, /\.message-action\s*\{[^}]*width:\s*27px[^}]*height:\s*27px/s);
  assert.match(css, /\.message-row:hover \.message-actions/);
  assert.match(css, /@media \(hover: none\), \(pointer: coarse\)/);
  assert.match(css, /rgba\(130, 102, 153, \.16\)/);
});
