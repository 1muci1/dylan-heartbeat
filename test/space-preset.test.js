"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { test } = require("node:test");
const {
  BUILTIN_SPACE_PRESETS
} = require("../ai-companion-frontend/space/presets/presets");
const {
  SpacePresetManager
} = require("../ai-companion-frontend/space/presets/preset-manager");
const {
  DEFAULT_SPACE_PROFILE,
  SpaceProfileManager
} = require("../ai-companion-frontend/space/space-profile");

const presetRoot = path.join(
  __dirname,
  "..",
  "ai-companion-frontend",
  "space",
  "presets"
);

const customProfile = () => ({
  ...structuredClone(DEFAULT_SPACE_PROFILE),
  id: "quiet-garden",
  name: "安静花园",
  theme: { mode: "auto", color: "rose" },
  atmosphere: { autoDayNight: true }
});

test("default purple moon preset and all four built-ins exist", () => {
  const manager = new SpacePresetManager();
  const presets = manager.list();
  assert.equal(presets.length, 4);
  assert.equal(presets[0].id, "purple-moon-room");
  assert.equal(presets[0].name, "紫月小屋");
  assert.deepEqual(
    presets.map(item => item.name),
    ["紫月小屋", "晨雾房间", "深空房间", "古典书房"]
  );
});

test("list returns deeply isolated copies", () => {
  const manager = new SpacePresetManager();
  const first = manager.list();
  first[0].name = "污染";
  first[0].profile.theme.color = "blue";
  const second = manager.list();
  assert.equal(second[0].name, "紫月小屋");
  assert.equal(second[0].profile.theme.color, "purple");
});

test("get reads a preset correctly and returns an isolated copy", () => {
  const manager = new SpacePresetManager();
  const preset = manager.get("morning-mist-room");
  assert.equal(preset.name, "晨雾房间");
  assert.equal(preset.profile.theme.mode, "day");
  preset.profile.avatar.frame = "none";
  assert.equal(manager.get("morning-mist-room").profile.avatar.frame, "soft");
  assert.equal(manager.get("missing"), null);
});

test("applying purple moon uses Space Profile Manager schema", () => {
  const profiles = new SpaceProfileManager();
  profiles.update("default-space", {
    theme: { mode: "day", color: "rose" },
    avatar: { frame: "none" }
  });
  const applied = new SpacePresetManager().apply("purple-moon-room", profiles);
  assert.equal(applied.name, "紫月小屋");
  assert.deepEqual(applied.theme, { mode: "night", color: "purple" });
  assert.equal(applied.avatar.frame, "moon");
  assert.deepEqual(applied, profiles.snapshot());
});

test("applying deep space changes the complete style atomically", () => {
  const profiles = new SpaceProfileManager();
  const applied = new SpacePresetManager().apply("deep-space-room", profiles);
  assert.equal(applied.name, "深空房间");
  assert.deepEqual(applied.theme, { mode: "night", color: "blue" });
  assert.equal(applied.avatar.frame, "minimal");
  assert.equal(applied.background.opacity, 0.56);
  assert.equal(applied.font.family, "Inter");
});

test("built-in presets cannot be polluted or removed", () => {
  const manager = new SpacePresetManager();
  const sourceName = BUILTIN_SPACE_PRESETS[0].name;
  const copy = manager.get("purple-moon-room");
  copy.description = "污染";
  assert.equal(manager.get("purple-moon-room").description.includes("月光"), true);
  assert.equal(BUILTIN_SPACE_PRESETS[0].name, sourceName);
  assert.throws(
    () => manager.removeCustom("purple-moon-room"),
    error => error.code === "SPACE_PRESET_BUILTIN_IMMUTABLE"
  );
});

test("custom preset is created only after Space Profile schema validation", () => {
  const manager = new SpacePresetManager();
  const created = manager.createCustom(customProfile());
  assert.equal(created.id, "quiet-garden");
  assert.equal(created.name, "安静花园");
  assert.deepEqual(created.profile.theme, { mode: "auto", color: "rose" });
  assert.equal(manager.list().length, 5);
  assert.equal(manager.removeCustom("quiet-garden"), true);
  assert.equal(manager.get("quiet-garden"), null);
});

test("invalid schema and unknown fields are rejected", () => {
  const manager = new SpacePresetManager();
  const invalid = customProfile();
  invalid.profile = { unexpected: true };
  assert.throws(
    () => manager.createCustom(invalid),
    error => error.code === "SPACE_PRESET_PROFILE_INVALID"
  );
});

test("Memory, Identity, and other forbidden fields are rejected recursively", () => {
  for (const field of ["memory", "identity", "chat", "gateway", "token", "secret"]) {
    const manager = new SpacePresetManager();
    const profile = customProfile();
    profile[field] = { value: "forbidden" };
    assert.throws(
      () => manager.createCustom(profile),
      error => error.code === "SPACE_PRESET_FIELD_FORBIDDEN"
    );
  }
});

test("preset modules and Studio integration have no storage, API, or backend dependency", () => {
  const source = [
    fs.readFileSync(path.join(presetRoot, "presets.js"), "utf8"),
    fs.readFileSync(path.join(presetRoot, "preset-manager.js"), "utf8"),
    fs.readFileSync(
      path.join(presetRoot, "..", "studio", "studio.js"),
      "utf8"
    )
  ].join("\n");
  assert.doesNotMatch(
    source,
    /localStorage|sessionStorage|fetch\s*\(|XMLHttpRequest|StructuredMemoryStore|MemoryWriter|IdentityBoundary|ChatRuntime|Bearer/
  );
});

test("Space Studio exposes preset selection, preview, and apply controls", () => {
  const html = fs.readFileSync(
    path.join(presetRoot, "..", "studio", "index.html"),
    "utf8"
  );
  assert.match(html, /data-preset-select/);
  assert.match(html, /data-preset-description/);
  assert.match(html, /data-preset-preview/);
  assert.match(html, /data-preset-apply/);
  assert.ok(html.indexOf("../presets/presets.js") < html.indexOf('src="./studio.js"'));
  assert.ok(html.indexOf("preset-manager.js") < html.indexOf('src="./studio.js"'));
});
