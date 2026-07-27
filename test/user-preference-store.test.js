"use strict";

const assert = require("node:assert/strict");
const { test } = require("node:test");
const { DEFAULTS, UserPreferenceStore } = require("../ai-companion-frontend/storage/user-preference-store");

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
  const avatar = new UserPreferenceStore({ storage: shared }).loadSync().avatar;
  assert.equal(avatar.source, "upload");
  assert.equal(avatar.crop.x, 22);
  assert.equal(avatar.border, "soft");
  assert.equal(avatar.imageData, "data:image/png;base64,AAAA");
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
