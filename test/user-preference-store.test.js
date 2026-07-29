"use strict";

const assert = require("node:assert/strict");
const { test } = require("node:test");
const {
  CHANGE_EVENT,
  DEFAULTS,
  UserPreferenceStore,
  getChatBackground,
  getUserAvatarImage,
  getChenAvatarImage
} = require("../ai-companion-frontend/storage/user-preference-store");

const storage = () => {
  const values = new Map();
  return {
    getItem(key) { return values.has(key) ? values.get(key) : null; },
    setItem(key, value) { values.set(key, String(value)); },
    removeItem(key) { values.delete(key); }
  };
};

test("UserPreferenceStore saves and reads the unified preference shape", () => {
  const store = new UserPreferenceStore({ storage: storage() });
  const result = store.save({ theme: { mode: "day", preset: "mist" }, model: { selectedModelId: "gpt-5" } });
  assert.equal(result.version, 1);
  assert.equal(result.theme.mode, "day");
  assert.equal(result.model.selectedModelId, "gpt-5");
  assert.ok(result.avatar && result.space && result.ui);
});

test("a new store instance restores preferences after a refresh", () => {
  const shared = storage();
  new UserPreferenceStore({ storage: shared }).saveSpace({ profileId: "room-1", presetId: "deep-space" });
  assert.deepEqual(new UserPreferenceStore({ storage: shared }).loadSync().space, {
    ...DEFAULTS.space, profileId: "room-1", presetId: "deep-space"
  });
});

test("avatar crop, scale, border, and image data are restored", () => {
  const shared = storage();
  const store = new UserPreferenceStore({ storage: shared });
  store.saveAvatar({ source: "upload", imageData: "data:image/png;base64,AAAA", crop: { x: 22, y: 73 }, scale: 1.4, border: "soft" });
  const avatar = new UserPreferenceStore({ storage: shared }).loadSync().avatar.chenAvatar;
  assert.equal(avatar.source, "upload");
  assert.equal(avatar.crop.x, 22);
  assert.equal(avatar.border, "soft");
  assert.equal(avatar.imageData, "data:image/png;base64,AAAA");
});

test("quota failures are safe and do not emit preference changes", () => {
  const events = [];
  const quota = Object.assign(new Error("data:image/png;base64,SECRET"), { name: "QuotaExceededError" });
  const failingStorage = {
    getItem() { return null; },
    setItem() { throw quota; },
    removeItem() {}
  };
  const eventTarget = {
    CustomEvent: class { constructor(type, init) { this.type = type; this.detail = init.detail; } },
    dispatchEvent(event) { events.push(event); },
    addEventListener() {},
    removeEventListener() {}
  };
  const store = new UserPreferenceStore({ storage: failingStorage, eventTarget });
  assert.throws(
    () => store.saveAvatar({ imageData: "data:image/png;base64,SECRET" }, "user"),
    error => error.code === "STORAGE_QUOTA_EXCEEDED" && !/SECRET|base64/iu.test(error.message)
  );
  assert.equal(events.length, 0);
});

test("new avatars use nested fields and duplicate legacy roots migrate safely", () => {
  const shared = storage();
  new UserPreferenceStore({ storage: shared }).saveAvatar({
    source: "upload",
    imageData: "data:image/png;base64,USER"
  }, "user");
  let raw = JSON.parse(shared.getItem("xinban-user-preferences-v1"));
  assert.equal(Object.hasOwn(raw.avatar, "imageData"), false);
  assert.equal(raw.avatar.userAvatar.imageData, "data:image/png;base64,USER");

  shared.setItem("xinban-user-preferences-v1", JSON.stringify({
    avatar: {
      imageData: "data:image/png;base64,USER",
      userAvatar: { imageData: "data:image/png;base64,USER" },
      chenAvatar: { imageData: "data:image/png;base64,CHEN" }
    }
  }));
  new UserPreferenceStore({ storage: shared }).loadSync();
  raw = JSON.parse(shared.getItem("xinban-user-preferences-v1"));
  assert.equal(Object.hasOwn(raw.avatar, "imageData"), false);
  assert.equal(raw.avatar.userAvatar.imageData, "data:image/png;base64,USER");
  assert.equal(raw.avatar.chenAvatar.imageData, "data:image/png;base64,CHEN");

  shared.setItem("xinban-user-preferences-v1", JSON.stringify({
    avatar: { imageData: "data:image/png;base64,LEGACY" }
  }));
  const legacy = new UserPreferenceStore({ storage: shared });
  assert.equal(legacy.getChenAvatarImage(), "data:image/png;base64,LEGACY");
  assert.equal(JSON.parse(shared.getItem("xinban-user-preferences-v1")).avatar.imageData, "data:image/png;base64,LEGACY");
});

test("mirrored model selection is restored independently of chat state", () => {
  const shared = storage();
  new UserPreferenceStore({ storage: shared }).saveModel("gpt-5");
  const restored = new UserPreferenceStore({ storage: shared }).loadSync();
  assert.equal(restored.model.selectedModelId, "gpt-5");
  assert.equal(Object.hasOwn(restored, "messages"), false);
});

test("theme and background preferences survive reload", () => {
  const shared = storage();
  const store = new UserPreferenceStore({ storage: shared });
  store.saveTheme({ mode: "night", preset: "mono" });
  store.saveBackground({ url: "/images/room.webp", blur: 4 });
  const restored = new UserPreferenceStore({ storage: shared }).loadSync();
  assert.deepEqual(restored.theme, { ...DEFAULTS.theme, mode: "night", preset: "mono" });
  assert.equal(restored.background.url, "/images/room.webp");
  assert.equal(restored.background.blur, 4);
});

test("sensitive fields are filtered and Blob URLs are never persisted", () => {
  const shared = storage();
  const store = new UserPreferenceStore({ storage: shared });
  const saved = store.save({ token: "secret", apiKey: "secret", theme: { authorization: "Bearer x" }, space: { profile: { background: { url: "blob:temporary" } } } });
  const serialized = JSON.stringify(saved);
  assert.doesNotMatch(serialized, /secret|Bearer|blob:temporary/);
  assert.doesNotMatch(serialized, /memory|messages|identity/i);
});

test("clear and reset restore defaults without touching another store", () => {
  const shared = storage();
  const store = new UserPreferenceStore({ storage: shared });
  store.saveModel("gpt-5");
  assert.equal(store.clear().model.selectedModelId, DEFAULTS.model.selectedModelId);
  assert.deepEqual(new UserPreferenceStore({ storage: shared }).loadSync(), DEFAULTS);
});

test("space adapter persists profiles through the unified store", async () => {
  const shared = storage();
  const store = new UserPreferenceStore({ storage: shared });
  const adapter = store.adapter();
  const profile = { id: "default-space", name: "小屋", theme: {}, avatar: {}, background: {}, font: {}, atmosphere: {} };
  await adapter.save(profile);
  assert.equal((await adapter.load()).id, "default-space");
  assert.equal(new UserPreferenceStore({ storage: shared }).loadSync().space.profile.name, "小屋");
});

test("preference changes notify same-page subscribers and can be unsubscribed", () => {
  const listeners = new Map();
  class FakeCustomEvent {
    constructor(type, options) { this.type = type; this.detail = options.detail; }
  }
  const eventTarget = {
    CustomEvent: FakeCustomEvent,
    addEventListener(type, listener) {
      const values = listeners.get(type) || new Set();
      values.add(listener);
      listeners.set(type, values);
    },
    removeEventListener(type, listener) { listeners.get(type)?.delete(listener); },
    dispatchEvent(event) { listeners.get(event.type)?.forEach(listener => listener(event)); }
  };
  const store = new UserPreferenceStore({ storage: storage(), eventTarget });
  const changes = [];
  const unsubscribe = store.subscribe(value => changes.push(value));
  store.saveAvatar({ source: "upload", imageData: "data:image/png;base64,AAAA" }, "chen");
  store.saveChatBackground({ imageData: "data:image/png;base64,BBBB" });
  assert.equal(CHANGE_EVENT, "user-preferences-change");
  assert.equal(changes.length, 2);
  assert.equal(changes[0].avatar.chenAvatar.imageData, "data:image/png;base64,AAAA");
  assert.equal(changes[1].chatBackground.imageData, "data:image/png;base64,BBBB");
  unsubscribe();
  store.reset();
  assert.equal(changes.length, 2);
});

test("Chen avatar image resolver supports the current and legacy persistent fields", () => {
  const imageData = "data:image/png;base64,AAAA";
  assert.equal(getChenAvatarImage({ avatar: { chenAvatar: { imageData } } }), imageData);
  for (const field of ["dataUrl", "imageUrl", "url", "src"]) {
    const value = field === "dataUrl" ? "data:image/webp;base64,BBBB" :
      field === "imageUrl" ? "https://cdn.example/avatar.webp" : "/avatars/chen.webp";
    assert.equal(getChenAvatarImage({ avatar: { chenAvatar: { [field]: value } } }), value);
  }
  assert.equal(getChenAvatarImage({ avatar: { imageData } }), imageData);
});

test("Chen avatar image resolver rejects transient and unsafe URLs", () => {
  for (const value of ["blob:https://example.test/transient", "http://example.test/avatar.png", "javascript:alert(1)", ""]) {
    assert.equal(getChenAvatarImage({ avatar: { chenAvatar: { imageData: value } } }), null);
  }
  const shared = storage();
  new UserPreferenceStore({ storage: shared }).saveAvatar({
    source: "upload",
    imageData: "blob:https://example.test/transient"
  }, "chen");
  const restored = new UserPreferenceStore({ storage: shared });
  assert.equal(restored.getChenAvatarImage(), null);
  assert.equal(restored.loadSync().avatar.chenAvatar.imageData, null);
});

test("user avatar resolver supports current and legacy fields with a null fallback", () => {
  const imageData = "data:image/png;base64,USER";
  assert.equal(getUserAvatarImage({ avatar: { userAvatar: { imageData } } }), imageData);
  for (const [field, value] of [
    ["dataUrl", "data:image/webp;base64,USER"],
    ["imageUrl", "https://cdn.example/user.webp"],
    ["url", "/avatars/user.webp"],
    ["src", "/avatars/legacy-user.webp"]
  ]) {
    assert.equal(getUserAvatarImage({ avatar: { userAvatar: { [field]: value } } }), value);
  }
  assert.equal(getUserAvatarImage({ avatar: { meAvatar: { imageData } } }), imageData);
  assert.equal(getUserAvatarImage({ avatar: { ownerAvatar: { imageData } } }), imageData);
  assert.equal(getUserAvatarImage({ avatar: {} }), null);
});

test("user avatar resolver rejects blob, http, empty, and non-image values", () => {
  for (const value of ["blob:https://example.test/user", "http://example.test/user.png", "", "not-an-image"]) {
    assert.equal(getUserAvatarImage({ avatar: { userAvatar: { imageData: value } } }), null);
  }
});

test("user and Chen avatar persistence use independent preference fields", () => {
  const store = new UserPreferenceStore({ storage: storage() });
  store.saveAvatar({ source: "upload", imageData: "data:image/png;base64,USER" }, "user");
  store.saveAvatar({ source: "upload", imageData: "data:image/png;base64,CHEN" }, "chen");
  const preferences = store.loadSync();
  assert.equal(preferences.avatar.userAvatar.imageData, "data:image/png;base64,USER");
  assert.equal(preferences.avatar.chenAvatar.imageData, "data:image/png;base64,CHEN");
});

test("chat background resolver normalizes the real chat and space preference fields", () => {
  const chat = getChatBackground({
    chatBackground: {
      imageData: "data:image/png;base64,BG",
      position: "top center",
      size: "cover",
      overlay: 0.42
    }
  });
  assert.equal(chat.image, "data:image/png;base64,BG");
  assert.equal(chat.position, "top center");
  assert.equal(chat.overlay, 0.42);

  const rootBackground = getChatBackground({
    chatBackground: { imageData: null },
    background: { url: "/images/room.webp", blur: 6, opacity: 0.28 }
  });
  assert.equal(rootBackground.image, "/images/room.webp");
  assert.equal(rootBackground.blur, 6);
  assert.equal(rootBackground.overlay, 0.28);
  assert.equal(rootBackground.opacity, 1);

  assert.equal(getChatBackground({
    space: { profile: { background: { url: "https://cdn.example/room.webp" } } }
  }).image, "https://cdn.example/room.webp");
});

test("chat background resolver rejects transient images and preserves the default state", () => {
  const background = getChatBackground({
    chatBackground: { imageData: "blob:https://example.test/background" }
  });
  assert.equal(background.image, null);
  assert.equal(background.overlay, 0);
  assert.equal(getChatBackground({}).image, null);
});
