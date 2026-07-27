"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { test } = require("node:test");
const { UserPreferenceStore } = require("../ai-companion-frontend/storage/user-preference-store");

const frontend = path.join(__dirname, "..", "frontend-p4b");
const memoryStorage = () => { const values = new Map(); return { getItem: key => values.get(key) || null, setItem: (key, value) => values.set(key, value), removeItem: key => values.delete(key) }; };
const image = "data:image/png;base64," + "a".repeat(64);

test("user and Chen avatars persist independently and reload", () => {
  const storage = memoryStorage();
  const first = new UserPreferenceStore({ storage });
  first.saveAvatar({ source: "upload", imageData: image }, "user");
  first.saveAvatar({ source: "upload", imageData: image + "b" }, "chen");
  const restored = new UserPreferenceStore({ storage }).loadSync();
  assert.equal(restored.avatar.userAvatar.imageData, image);
  assert.equal(restored.avatar.chenAvatar.imageData, image + "b");
  assert.equal(restored.avatar.userAvatar.imageData.startsWith("blob:"), false);
});

test("chat background persists and can be cleared", () => {
  const storage = memoryStorage();
  const store = new UserPreferenceStore({ storage });
  store.saveChatBackground({ imageData: image, overlay: .35 });
  assert.equal(new UserPreferenceStore({ storage }).loadSync().chatBackground.imageData, image);
  store.saveChatBackground({ imageData: null });
  assert.equal(new UserPreferenceStore({ storage }).loadSync().chatBackground.imageData, null);
});

test("chat exposes Chen avatar editor and background preference hooks", () => {
  const html = fs.readFileSync(path.join(frontend, "chat.html"), "utf8");
  const chat = fs.readFileSync(path.join(frontend, "assets/js/chat.js"), "utf8");
  const script = fs.readFileSync(path.join(frontend, "assets/js/avatar-chat.js"), "utf8");
  const preferences = fs.readFileSync(path.join(frontend, "assets/js/chat-preferences.js"), "utf8");
  const settings = fs.readFileSync(path.join(frontend, "assets/js/settings.js"), "utf8");
  const home = fs.readFileSync(path.join(__dirname, "..", "ai-companion-frontend/home/home.js"), "utf8");
  assert.match(html, /data-avatar-target="chen"/);
  assert.match(html, /data-chat-avatar-fallback/);
  assert.doesNotMatch(html, /chat-avatar__moon/);
  assert.match(html, /assets\/js\/avatar-chat\.js/);
  assert.match(preferences, /store\.subscribe\(apply\)/);
  assert.match(preferences, /store\.load\(\)\.then\(apply\)\.catch/);
  assert.match(preferences, /getChatBackground/);
  assert.match(preferences, /--chat-bg-image/);
  assert.match(script, /saveAvatar/);
  assert.match(script, /message-avatar--assistant/);
  assert.match(script, /message-avatar--user/);
  assert.match(script, /getUserAvatarImage/);
  assert.match(script, /applyTo/);
  assert.match(script, /getImage/);
  assert.match(script, /getChenAvatarImage/);
  assert.doesNotMatch(script, /if \(avatar\?\.imageData\)/);
  assert.match(script, /store\.loadSync\(\)/);
  assert.match(script, /store\.subscribe\(applyAvatars\)/);
  assert.match(script, /store\.load\(\)\.then\(applyAvatars\)\.catch/);
  assert.match(chat, /CompanionChatAvatars\?\.apply\(\)/);
  assert.match(chat, /CompanionChatAvatars\?\.getImage\("chen"\)/);
  assert.match(chat, /CompanionChatAvatars\?\.getImage\("user"\)/);
  assert.match(chat, /CompanionChatAvatars\?\.applyTo\(avatar, "chen", chenAvatarImage\)/);
  assert.match(chat, /CompanionChatAvatars\?\.applyTo\(avatar, "user", userAvatarImage\)/);
  assert.match(chat, /avatar\.textContent = "沉"/);
  assert.match(chat, /avatar\.textContent = "我"/);
  assert.doesNotMatch(chat, /avatar\.textContent = ai\.avatar\.label/);
  assert.match(chat, /CompanionChatPreferences\?\.apply\(\)/);
  assert.doesNotMatch(chat, /saveAvatar|saveChatBackground/);
  assert.match(settings, /preferenceStore\.saveChatBackground/);
  assert.match(home, /preferences\?\.subscribe\?\.\(renderPreferenceAvatars\)/);
  assert.match(home, /avatarStudio\.defaultChen\(\)/);
});
