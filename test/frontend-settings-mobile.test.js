"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { test } = require("node:test");
const {
  safeInternalPath,
  resolveReturnTarget
} = require("../frontend-p4b/assets/js/settings-return");
const { UserPreferenceStore } = require("../ai-companion-frontend/storage/user-preference-store");

const root = path.join(__dirname, "..", "frontend-p4b");
const read = relative => fs.readFileSync(path.join(root, relative), "utf8");
const image = `data:image/png;base64,${"a".repeat(64)}`;
const memoryStorage = () => {
  const values = new Map();
  return {
    getItem: key => values.get(key) || null,
    setItem: (key, value) => values.set(key, value),
    removeItem: key => values.delete(key)
  };
};

test("settings exposes both avatar entries and opens the native file input from the click handler", () => {
  const html = read("settings.html");
  const script = read("assets/js/avatar-chat.js");
  const picker = fs.readFileSync(path.join(__dirname, "..", "ai-companion-frontend", "avatar", "avatar-picker.js"), "utf8");
  const css = read("assets/css/settings.css");
  assert.match(html, /data-avatar-target="user"[^>]*>更改我的头像/);
  assert.match(html, /data-avatar-target="chen"[^>]*>更改沉沉头像/);
  assert.match(script, /CompanionAvatarPicker\?\.mount/);
  assert.match(picker, /data-avatar-editor-file/);
  assert.match(picker, /fileInput\.click\(\)/);
  assert.match(picker, /reader\.readAsDataURL\(file\)/);
  assert.match(picker, /store\.saveAvatar\([^;]+target\)/s);
  assert.match(css, /\.avatar-editor-modal/);
  assert.match(css, /\.avatar-editor__pick input/);
});

test("saving my avatar persists imageData and emits a preference change without storing blob URLs", () => {
  const storage = memoryStorage();
  const events = [];
  const store = new UserPreferenceStore({
    storage,
    eventTarget: { dispatchEvent: event => events.push(event), addEventListener() {}, removeEventListener() {} }
  });
  store.saveAvatar({ source: "upload", imageData: image }, "user");
  assert.equal(store.loadSync().avatar.userAvatar.imageData, image);
  assert.equal(events.some(event => event.type === "user-preferences-change"), true);
  store.saveAvatar({ source: "upload", imageData: "blob:https://chat.example/avatar" }, "user");
  assert.equal(store.loadSync().avatar.userAvatar.imageData, null);
});

test("settings returnTo accepts same-origin chat and rejects open redirects", () => {
  const options = {
    origin: "https://chat.example",
    settingsPath: "/settings.html"
  };
  assert.equal(
    safeInternalPath("/chat.html", options),
    "/chat.html"
  );
  assert.equal(
    resolveReturnTarget({ ...options, returnTo: "/chat.html" }),
    "/chat.html"
  );
  assert.equal(safeInternalPath("https://evil.example/phish", options), null);
  assert.equal(safeInternalPath("//evil.example/phish", options), null);
});

test("settings return falls back to the internal referrer and finally home", () => {
  const options = {
    origin: "https://chat.example",
    settingsPath: "/settings.html"
  };
  assert.equal(
    resolveReturnTarget({ ...options, referrer: "https://chat.example/game/" }),
    "/game/"
  );
  assert.equal(resolveReturnTarget(options), "/index.html");
});

test("chat model settings navigation carries its current route", () => {
  const switcher = read("assets/js/model-switcher.js");
  const settings = read("settings.html");
  const chat = read("chat.html");
  assert.match(switcher, /settings\.html\?returnTo=\$\{encodeURIComponent\(currentRoute\)\}/);
  assert.match(chat, /settings\.html\?returnTo=%2Fchat\.html/);
  assert.match(settings, /data-settings-back/);
  assert.match(settings, /assets\/js\/settings-return\.js/);
});

test("every static P4B settings entry carries an internal returnTo", () => {
  const htmlFiles = fs.readdirSync(root).filter(file => file.endsWith(".html"));
  const settingsLinks = htmlFiles.flatMap(file => {
    const html = read(file);
    return [...html.matchAll(/href="([^"]*settings\.html[^"]*)"/g)]
      .map(match => ({ file, href: match[1] }));
  });
  assert.ok(settingsLinks.length >= 3);
  for (const { file, href } of settingsLinks) {
    assert.match(href, /[?&]returnTo=%2F/, `${file}: ${href}`);
    assert.doesNotMatch(href, /(?:https?:)?\/\//, `${file}: ${href}`);
  }
});
