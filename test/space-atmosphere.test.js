"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { test } = require("node:test");
const {
  ATMOSPHERE_PRESETS
} = require("../ai-companion-frontend/space/atmosphere/atmosphere-presets");
const {
  AtmosphereEngine,
  resolvePresetName
} = require("../ai-companion-frontend/space/atmosphere/atmosphere-engine");
const {
  DEFAULT_SPACE_PROFILE
} = require("../ai-companion-frontend/space/space-profile");

const atmosphereRoot = path.join(
  __dirname,
  "..",
  "ai-companion-frontend",
  "space",
  "atmosphere"
);

const atHour = hour => new Date(2026, 6, 24, hour, 0, 0, 0);

test("auto mode resolves day from 06:00-18:00 and night otherwise", () => {
  assert.equal(resolvePresetName("auto", atHour(5)), "moonlight");
  assert.equal(resolvePresetName("auto", atHour(6)), "dawn");
  assert.equal(resolvePresetName("auto", atHour(12)), "dawn");
  assert.equal(resolvePresetName("auto", atHour(17)), "sunset");
  assert.equal(resolvePresetName("auto", atHour(18)), "moonlight");

  const dawn = new AtmosphereEngine({ clock: () => atHour(8) }).getCurrent();
  const evening = new AtmosphereEngine({ clock: () => atHour(19) }).getCurrent();
  assert.equal(dawn.description, "🌤️ 清晨模式");
  assert.equal(evening.description, "🌙 月夜模式");
});

test("manual day mode consistently returns Dawn", () => {
  const engine = new AtmosphereEngine({ clock: () => atHour(23) });
  const result = engine.setMode("day");
  assert.deepEqual(result, structuredClone(ATMOSPHERE_PRESETS.dawn));
});

test("manual night mode consistently returns Moonlight", () => {
  const engine = new AtmosphereEngine({ clock: () => atHour(10) });
  const result = engine.setMode("night");
  assert.deepEqual(result, structuredClone(ATMOSPHERE_PRESETS.moonlight));
});

test("apply reads but never modifies Space Profile", () => {
  const engine = new AtmosphereEngine({ clock: () => atHour(17) });
  const profile = structuredClone(DEFAULT_SPACE_PROFILE);
  const before = structuredClone(profile);
  const result = engine.apply(profile);
  assert.equal(result.description, "🌇 黄昏模式");
  assert.deepEqual(profile, before);
});

test("getCurrent and apply return deeply isolated objects", () => {
  const engine = new AtmosphereEngine({ mode: "night" });
  const first = engine.getCurrent();
  first.lighting.tint = "polluted";
  first.description = "polluted";
  const second = engine.apply(structuredClone(DEFAULT_SPACE_PROFILE));
  assert.equal(second.lighting.tint, "purple");
  assert.equal(second.description, "🌙 月夜模式");
});

test("Atmosphere Engine has no Theme Engine or Avatar Studio side effects", () => {
  let themeCalls = 0;
  let avatarCalls = 0;
  const fakeTheme = { setMode() { themeCalls += 1; } };
  const fakeAvatar = { render() { avatarCalls += 1; } };
  const engine = new AtmosphereEngine({ clock: () => atHour(9) });
  engine.apply(structuredClone(DEFAULT_SPACE_PROFILE), {
    theme: fakeTheme,
    avatar: fakeAvatar
  });
  assert.equal(themeCalls, 0);
  assert.equal(avatarCalls, 0);
});

test("Atmosphere modules do not persist or access backend runtime", () => {
  const source = [
    fs.readFileSync(path.join(atmosphereRoot, "atmosphere-engine.js"), "utf8"),
    fs.readFileSync(path.join(atmosphereRoot, "atmosphere-presets.js"), "utf8")
  ].join("\n");
  assert.doesNotMatch(
    source,
    /localStorage|sessionStorage|fetch\s*\(|XMLHttpRequest|Gateway|StructuredMemoryStore|MemoryWriter|IdentityBoundary|ChatRuntime|ThemeEngine|AvatarStudio/
  );
});

test("Space Studio provides atmosphere controls and current state", () => {
  const html = fs.readFileSync(
    path.join(atmosphereRoot, "..", "studio", "index.html"),
    "utf8"
  );
  const css = fs.readFileSync(
    path.join(atmosphereRoot, "..", "studio", "studio.css"),
    "utf8"
  );
  assert.match(html, /data-atmosphere-mode/);
  assert.match(html, /data-atmosphere-status/);
  assert.match(html, /当前空间状态/);
  assert.ok(html.indexOf("atmosphere-engine.js") < html.indexOf('src="./studio.js"'));
  assert.match(css, /data-avatar-effect="moon-glow"/);
});
